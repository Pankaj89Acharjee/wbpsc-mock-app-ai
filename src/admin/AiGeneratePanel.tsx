import React, { useEffect, useMemo, useState } from "react";
import { ChevronRight, Layers, Sparkles, XCircle } from "lucide-react";
import {
  AI_QUESTION_COUNT_OPTIONS,
  SERIES_KIND_LABELS,
  type ExamDto,
  type GenerateFullQuestionSetResult,
  type GenerateQuestionsInput,
  type GenerateQuestionsResult,
  type GenerationMode,
  type SeriesDto,
  type VacancyDto,
} from "../../packages/shared-types/src/index";
import { adminApi, findNode, type SyllabusTrees } from "./adminApi";
import { FullSetAiGeneratorPanel } from "./SeriesToolsModals";
import SyllabusPicker, { type SyllabusValue } from "./SyllabusPicker";
import { btn, inputCls } from "./ui";

// ============================================================================
// AI question generator:
//   Mode A: "Full Question Set (By Subject Counts)" — 1-click generation across
//           chosen subjects (e.g. 100 Qs for PSC Clerkship: GS 40, Maths 30, English 30)
//   Mode B: "Single Topic / Subtopic" — explicit Subject → Chapter → Subtopic
// ============================================================================

type Difficulty = GenerateQuestionsInput["difficulty"];

export default function AiGeneratePanel({
  exam,
  trees,
  series: fixedSeries = null,
  initialPath,
  initialCount,
  onGenerated,
  onFullSetGenerated,
  onClose,
}: {
  exam: ExamDto;
  trees: SyllabusTrees;
  /** Lock the target to this test series (series workspace) */
  series?: SeriesDto | null;
  initialPath?: Partial<SyllabusValue>;
  /** Pre-selected amount, e.g. the shortfall of a blueprint topic */
  initialCount?: number;
  onGenerated: (r: GenerateQuestionsResult) => void | Promise<void>;
  onFullSetGenerated?: (r: GenerateFullQuestionSetResult) => void | Promise<void>;
  onClose?: () => void;
}) {
  const [generatorTab, setGeneratorTab] = useState<"full_set" | "single_topic">(
    initialPath?.subtopicSlug ? "single_topic" : "full_set"
  );
  const [path, setPath] = useState<SyllabusValue>({
    examSlug: exam.slug,
    subjectSlug: initialPath?.subjectSlug ?? "",
    chapterSlug: initialPath?.chapterSlug ?? "",
    subtopicSlug: initialPath?.subtopicSlug ?? "",
  });
  const [count, setCount] = useState(initialCount ?? 10);
  const [difficulty, setDifficulty] = useState<Difficulty>("mixed");
  const [mode, setMode] = useState<GenerationMode>(fixedSeries ? "roster" : "bank");
  const [seriesList, setSeriesList] = useState<SeriesDto[]>([]);
  const [seriesId, setSeriesId] = useState(fixedSeries?.id ?? "");
  const [vacancy, setVacancy] = useState<VacancyDto | null>(null);
  const [vacancyError, setVacancyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<GenerateQuestionsResult | null>(null);

  useEffect(() => {
    if (initialPath) setPath((p) => ({ ...p, ...initialPath, examSlug: exam.slug }));
  }, [initialPath?.subjectSlug, initialPath?.chapterSlug, initialPath?.subtopicSlug]);
  useEffect(() => {
    if (initialCount) setCount(Math.min(50, initialCount));
  }, [initialCount]);

  // Series picker (only when the target series isn't fixed)
  useEffect(() => {
    if (fixedSeries || mode !== "roster") return;
    adminApi<{ series: SeriesDto[] }>(`/series/exams/${exam.id}`)
      .then((r) => setSeriesList(r.series))
      .catch((err) => setError((err as Error).message));
  }, [exam.id, fixedSeries, mode]);

  // Resolve the picked slugs to node ids/names for the breadcrumb and vacancy lookup
  const tree = trees.trees[exam.slug];
  const resolved = useMemo(() => {
    const subject = path.subjectSlug ? findNode(tree?.subjects ?? [], path.subjectSlug) : undefined;
    const chapter = subject && path.chapterSlug ? findNode(subject.chapters, path.chapterSlug) : undefined;
    const subtopic = chapter && path.subtopicSlug ? findNode(chapter.subtopics, path.subtopicSlug) : undefined;
    return { subject, chapter, subtopic };
  }, [tree, path]);

  const targetSeriesId = fixedSeries?.id ?? seriesId;
  const targetSeries = fixedSeries ?? seriesList.find((x) => x.id === seriesId) ?? null;

  useEffect(() => {
    setVacancy(null);
    setVacancyError(null);
    if (mode !== "roster" || !targetSeriesId || !resolved.subtopic) return;
    adminApi<{ vacancy: VacancyDto }>(
      `/series/${targetSeriesId}/vacancy?subtopicId=${resolved.subtopic.id}`
    )
      .then((r) => {
        setVacancy(r.vacancy);
        if (r.vacancy.generatable > 0) setCount((c) => Math.min(c, r.vacancy.generatable));
      })
      .catch((err) => setVacancyError((err as Error).message));
  }, [mode, targetSeriesId, resolved.subtopic?.id, last]);

  const maxCount = mode === "roster" ? (vacancy?.generatable ?? 0) : 50;
  const countOptions = useMemo(() => {
    const base = mode === "roster" ? [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50] : [...AI_QUESTION_COUNT_OPTIONS];
    const opts = base.filter((n) => n <= maxCount);
    if (mode === "roster" && maxCount > 0 && !opts.includes(maxCount)) opts.push(maxCount);
    // Offer the exact shortfall the panel was opened for
    if (mode === "bank" && initialCount && initialCount <= 50 && !opts.includes(initialCount)) {
      opts.push(initialCount);
    }
    return opts.sort((a, b) => a - b);
  }, [mode, maxCount, initialCount]);

  const blockedReason =
    !resolved.subtopic
      ? "Pick a subject, chapter and subtopic"
      : mode === "roster" && !targetSeriesId
        ? "Pick the test series these questions are for"
        : mode === "roster" && vacancy && !vacancy.eligible
          ? vacancy.message
          : mode === "roster" && vacancy && vacancy.generatable === 0
            ? vacancy.message
            : mode === "roster" && !vacancy
              ? "Checking vacancies…"
              : null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi<GenerateQuestionsResult>("/ingestion/generate", {
        method: "POST",
        body: {
          ...path,
          count: Math.min(count, maxCount),
          difficulty,
          mode,
          seriesId: mode === "roster" ? targetSeriesId : null,
        },
      });
      setLast(r);
      await onGenerated(r);
    } catch (err) {
      setError((err as Error).message);
      setLast(null); // re-fetches vacancy
    } finally {
      setBusy(false);
    }
  };

  const crumb = [
    exam.titleEn,
    resolved.subject?.name.en ?? "Subject?",
    resolved.chapter?.name.en ?? "Chapter / topic?",
    resolved.subtopic?.name.en ?? "Subtopic?",
  ];

  return (
    <div className="bg-slate-900 border border-violet-500/40 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-300" /> Generate Questions with AI
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setGeneratorTab("full_set")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                generatorTab === "full_set"
                  ? "bg-violet-500 text-white border-violet-400"
                  : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              1-Click Full Question Set (By Subject Counts — e.g. {exam.totalQuestions} Qs)
            </button>
            <button
              type="button"
              onClick={() => setGeneratorTab("single_topic")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                generatorTab === "single_topic"
                  ? "bg-violet-500 text-white border-violet-400"
                  : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Single Topic / Subtopic Generator (10–50 Qs)
            </button>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer" aria-label="Close">
            <XCircle className="w-4 h-4" />
          </button>
        )}
      </div>

      {generatorTab === "full_set" ? (
        <FullSetAiGeneratorPanel
          exam={exam}
          tree={tree}
          series={fixedSeries}
          onGenerated={async (res) => {
            if (onFullSetGenerated) {
              await onFullSetGenerated(res);
            } else {
              await onGenerated({
                batchId: res.batchId,
                modelUsed: res.modelUsed,
                vacancy: null,
                total: res.totalGenerated,
                pendingReview: res.totalPendingReview,
                pendingAi: 0,
                skippedEmpty: 0,
                errors: [],
                requested: res.totalRequested,
                uniqueGenerated: res.totalGenerated,
                attempts: res.subjectSummaries.length,
                failed: 0,
                duplicatesDropped: { exact: 0, near: 0, inBatch: 0 },
                cacheTier: "gemini",
              });
            }
          }}
        />
      ) : (
        <>
          <p className="text-xs text-slate-400 max-w-2xl">
            New bilingual MCQs in WBPSC style for one subtopic. Repeats of bank, pending or
            rejected questions are removed automatically (exact and reworded copies), and the AI is
            asked again for fresh ones. Everything lands in the review queue first.
          </p>

          <fieldset disabled={busy} className="space-y-4">
            {/* Target */}
            <div className="space-y-2">
              <span className="block text-xs font-semibold text-white">1. Where will these questions go?</span>
          {fixedSeries ? (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Generation target">
              {(["roster", "bank"] as const).map((m) => (
                <label
                  key={m}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer ${
                    mode === m ? "border-violet-400 bg-violet-500/10 text-white" : "border-slate-800 text-slate-300"
                  }`}
                >
                  <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
                  {m === "roster"
                    ? `For ${fixedSeries.name.en} (capped by vacancies)`
                    : "Extra reusable questions for the Question Bank (test untouched)"}
                </label>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-xs text-slate-400 space-y-1">
                <span>Target</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as GenerationMode)} className={inputCls}>
                  <option value="bank">Central Question Bank (reusable)</option>
                  <option value="roster">A test series (capped by vacancies)</option>
                </select>
              </label>
              {mode === "roster" && (
                <label className="text-xs text-slate-400 space-y-1 md:col-span-2">
                  <span>Test series</span>
                  <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={inputCls}>
                    <option value="">— choose series —</option>
                    {seriesList.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name.en} ({SERIES_KIND_LABELS[x.kind]}) · {x.selectedCount}/{x.totalQuestions}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>

        {/* Syllabus node */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-white">2. Subject → Chapter / topic → Subtopic</span>
          <SyllabusPicker exams={[exam]} trees={trees} inputCls={inputCls} value={path} onChange={setPath} />
          <nav aria-label="Selected syllabus" className="flex flex-wrap items-center gap-1 text-xs">
            {crumb.map((c, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight className="w-3 h-3 text-slate-600" aria-hidden="true" />}
                <span className={c.endsWith("?") ? "text-slate-500" : "text-violet-200 font-medium"}>{c}</span>
              </React.Fragment>
            ))}
          </nav>
        </div>

        {/* Vacancy */}
        {mode === "roster" && targetSeriesId && resolved.subtopic && (
          <div
            className={`p-3 rounded-lg border text-xs ${
              vacancy && vacancy.generatable > 0
                ? "bg-emerald-500/5 border-emerald-500/30 text-emerald-200"
                : "bg-amber-500/5 border-amber-500/30 text-amber-200"
            }`}
            aria-live="polite"
          >
            {vacancyError ? (
              vacancyError
            ) : !vacancy ? (
              "Checking vacancies…"
            ) : (
              <>
                <p className="font-semibold">{vacancy.message}</p>
                {vacancy.limits.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-slate-300">
                    {vacancy.limits.map((l, i) => (
                      <li key={i} className={l.slotId === vacancy.bindingSlotId ? "text-white" : ""}>
                        {l.label}: {l.used} used (selected + pending AI) of {l.target} → {l.remaining} left
                      </li>
                    ))}
                  </ul>
                )}
                {targetSeries && (
                  <p className="mt-1.5 text-slate-400">
                    {targetSeries.name.en} — {targetSeries.selectedCount}/{targetSeries.totalQuestions} selected
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Amount */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400 space-y-1">
            <span>3. How many?</span>
            <select
              value={Math.min(count, maxCount) || ""}
              onChange={(e) => setCount(Number(e.target.value))}
              className={`${inputCls} w-36`}
              disabled={countOptions.length === 0}
            >
              {countOptions.map((n) => (
                <option key={n} value={n}>
                  {n} question{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400 space-y-1">
            <span>Difficulty</span>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              className={`${inputCls} w-44`}
            >
              <option value="mixed">Mixed (like the real exam)</option>
              <option value="easy">Easy</option>
              <option value="moderate">Moderate</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <span className="text-xs text-slate-400 pb-1.5">Language: English + বাংলা · Format: MCQ (4 options)</span>
          <button onClick={run} disabled={!!blockedReason || busy} title={blockedReason ?? undefined} className={btn.ai}>
            <Sparkles className={`w-3.5 h-3.5 ${busy ? "animate-pulse" : ""}`} />
            {busy ? "Generating & de-duplicating…" : `Generate ${Math.min(count, maxCount) || ""} questions`}
          </button>
        </div>
        {blockedReason && !busy && <p className="text-xs text-amber-300">{blockedReason}</p>}
      </fieldset>

      {error && (
        <p role="alert" className="p-3 rounded-lg border bg-rose-500/10 border-rose-500/30 text-rose-200 text-xs">
          {error}
        </p>
      )}
      {last && <GenerationSummary result={last} />}
        </>
      )}
    </div>
  );
}

export function GenerationSummary({ result: r }: { result: GenerateQuestionsResult }) {
  const dropped = r.duplicatesDropped.exact + r.duplicatesDropped.near + r.duplicatesDropped.inBatch;
  return (
    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1" role="status">
      <p className="text-white font-semibold">
        {r.uniqueGenerated} of {r.requested} requested unique question(s) staged for review
        {r.cacheTier !== "gemini" && " (served from cache — no AI cost)"}
      </p>
      <p className="text-slate-400">
        {r.attempts} AI call(s) · {dropped} duplicate(s) removed ({r.duplicatesDropped.exact} exact,{" "}
        {r.duplicatesDropped.near} reworded, {r.duplicatesDropped.inBatch} within the batch)
        {r.failed - dropped > 0 && ` · ${r.failed - dropped} other row(s) not staged`}
      </p>
      {r.uniqueGenerated < r.requested && (
        <p className="text-amber-300">
          Fewer than requested: the AI kept producing questions that already exist. Try another
          subtopic or difficulty.
        </p>
      )}
    </div>
  );
}
