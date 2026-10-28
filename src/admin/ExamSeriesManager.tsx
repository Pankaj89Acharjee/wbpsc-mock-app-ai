import React, { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ChevronRight,
  Download,
  FileUp,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  SERIES_KIND_LABELS,
  SUBSCRIPTION_TIER_LABELS,
  SUBSCRIPTION_TIER_PLANS,
  getSubscriptionTierLabel,
  type ExamDto,
  type ExamOverviewDto,
  type GenerateFullQuestionSetResult,
  type PublishStatus,
  type SeriesAccessType,
  type SeriesDto,
  type SeriesImportSetBody,
  type SeriesImportSetResult,
  type SeriesInput,
  type SeriesKind,
  type SubscriptionPlanDto,
  type SubscriptionTier,
  type SyllabusTreeDto,
} from "../../packages/shared-types/src/index";
import { adminApi, type SyllabusTrees } from "./adminApi";
import SeriesWorkspace, { type WorkspaceTab } from "./SeriesWorkspace";
import SeriesBlueprint, { SubjectCountsEditor } from "./SeriesBlueprint";
import {
  FullSetAiGeneratorPanel,
  SeriesExportModal,
  SeriesImportSetModal,
} from "./SeriesToolsModals";
import { ConfirmDialog, NoticeBox, ProgressBar, StatusBadge, btn, inputCls, type Notice } from "./ui";

// ============================================================================
// Admin Console → Exam Series
//   Exam type  →  Test series (subjects × questions, marking, selected questions)
//   A series IS the test students take; it is published once every subject
//   has its questions. Every number on these cards comes from the server.
// ============================================================================

type ListStatus = "active" | "archived" | "all";

const KIND_TONE: Record<SeriesKind, string> = {
  previous_year: "bg-sky-500/15 text-sky-300",
  mock_test: "bg-emerald-500/15 text-emerald-300",
  practice: "bg-violet-500/15 text-violet-300",
  custom: "bg-slate-700/40 text-slate-300",
};

const seriesToInput = (s: SeriesDto, patch: Partial<SeriesInput> = {}): SeriesInput => ({
  slug: s.slug,
  nameEn: s.name.en,
  nameBn: s.name.bn,
  descriptionEn: s.description.en,
  descriptionBn: s.description.bn,
  kind: s.kind,
  status: s.status,
  displayOrder: s.displayOrder,
  durationMinutes: s.durationMinutes,
  marksPerCorrect: s.marksPerCorrect,
  negativeMarksPerWrong: s.negativeMarksPerWrong,
  estimatedCutoffMarks: s.estimatedCutoffMarks,
  accessType: s.accessType || "free",
  requiredTier: s.requiredTier || "free",
  priceInr: s.priceInr ?? 0,
  ...patch,
});

const isComplete = (s: SeriesDto) => s.totalQuestions > 0 && s.selectedCount === s.totalQuestions;

export default function ExamSeriesManager({
  exams,
  trees,
}: {
  exams: ExamDto[];
  trees: SyllabusTrees;
}) {
  const [overview, setOverview] = useState<ExamOverviewDto[]>([]);
  const [examId, setExamId] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesDto[]>([]);
  const [seriesStatus, setSeriesStatus] = useState<ListStatus>("active");
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("board");
  const [form, setForm] = useState<{ editing: SeriesDto | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SeriesDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showBlueprint, setShowBlueprint] = useState(false);
  /** Bumped when the subjects change, so the question board reloads */
  const [blueprintVersion, setBlueprintVersion] = useState(0);
  const [exportingSeries, setExportingSeries] = useState<SeriesDto | null>(null);
  const [importingSeries, setImportingSeries] = useState<SeriesDto | null>(null);
  const [aiFullSetSeries, setAiFullSetSeries] = useState<SeriesDto | null>(null);

  const fail = (err: unknown) => setNotice({ kind: "error", text: (err as Error).message });

  const loadOverview = useCallback(async () => {
    try {
      setOverview((await adminApi<{ exams: ExamOverviewDto[] }>("/series/overview")).exams);
    } catch (err) {
      fail(err);
    }
  }, []);

  const loadSeries = useCallback(async () => {
    if (!examId) return;
    setLoading(true);
    try {
      setSeries((await adminApi<{ series: SeriesDto[] }>(`/series/exams/${examId}?status=${seriesStatus}`)).series);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  }, [examId, seriesStatus]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);
  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  const exam = exams.find((e) => e.id === examId) ?? null;
  const { loadTree } = trees;
  useEffect(() => {
    if (exam) loadTree(exam.slug);
  }, [exam?.slug, loadTree]);
  const examTree = exam ? trees.trees[exam.slug] : undefined;
  const examOverview = overview.find((e) => e.id === examId) ?? null;
  const currentSeries = series.find((s) => s.id === seriesId) ?? null;
  useEffect(() => {
    setShowBlueprint(!!currentSeries && currentSeries.totalQuestions === 0);
  }, [currentSeries?.id]);

  const refreshAll = async () => {
    await Promise.all([loadOverview(), loadSeries()]);
  };

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveSeries = async (
    input: SeriesInput,
    editing: SeriesDto | null,
    postCreateAction?: {
      mode: "none" | "import" | "ai_full_set";
      importPayload?: SeriesImportSetBody;
    }
  ) => {
    setBusy(true);
    try {
      if (editing) {
        await adminApi(`/series/${editing.id}`, { method: "PUT", body: input });
        setForm(null);
        setNotice({ kind: "success", text: `Series “${input.nameEn}” saved` });
      } else {
        const r = await adminApi<{ series: SeriesDto }>(`/series/exams/${examId}`, {
          method: "POST",
          body: input,
        });
        const created = r.series;
        let statusMsg = `Series “${input.nameEn}” created`;

        try {
          if (postCreateAction?.mode === "import" && postCreateAction.importPayload) {
            const impRes = await adminApi<SeriesImportSetResult>(
              `/series/${created.id}/import-set`,
              {
                method: "POST",
                body: postCreateAction.importPayload,
              }
            );
            statusMsg = `Created “${input.nameEn}” · Imported ${impRes.insertedToBank} question(s) into DB & assigned ${impRes.assignedToSeries} to this test!`;
          } else if (
            postCreateAction?.mode === "ai_full_set" &&
            exam &&
            input.subjectTargets &&
            input.subjectTargets.length > 0
          ) {
            const subjectsPayload = input.subjectTargets
              .map((st) => ({
                subjectId: st.subjectId,
                count: st.targetCount,
              }))
              .filter((s) => s.count > 0);

            if (subjectsPayload.length > 0) {
              const aiRes = await adminApi<GenerateFullQuestionSetResult>(
                "/ingestion/generate-full-set",
                {
                  method: "POST",
                  body: {
                    examSlug: exam.slug,
                    seriesId: created.id,
                    difficulty: "mixed",
                    insertDirectlyToBank: true,
                    syncSeriesBlueprint: true,
                    subjects: subjectsPayload,
                  },
                }
              );
              statusMsg = `Created “${input.nameEn}” · AI generated ${aiRes.totalGenerated} question(s) across ${subjectsPayload.length} subjects & assigned ${aiRes.totalAssignedToSeries} to this test!`;
            }
          }
        } catch (postErr) {
          if (postCreateAction?.mode === "import") {
            await adminApi(`/series/${created.id}`, { method: "DELETE" }).catch(() => {});
          }
          throw postErr;
        }

        setSeriesId(created.id);
        setWorkspaceTab("board");
        setForm(null);
        setNotice({ kind: "success", text: statusMsg });
      }
      await refreshAll();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const setSeriesStatusOf = (s: SeriesDto, status: PublishStatus) => saveSeries(seriesToInput(s, { status }), s);

  const runDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await adminApi(`/series/${confirmDelete.id}`, { method: "DELETE" });
      if (seriesId === confirmDelete.id) setSeriesId(null);
      setNotice({ kind: "success", text: "Deleted" });
      await refreshAll();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const crumbs: Array<{ label: string; onClick?: () => void }> = [
    {
      label: "Exam types",
      onClick: () => {
        setExamId(null);
        setSeriesId(null);
      },
    },
  ];
  if (exam) crumbs.push({ label: exam.titleEn, onClick: () => setSeriesId(null) });
  if (currentSeries) crumbs.push({ label: currentSeries.name.en });

  /** Publish / Unpublish, only allowed once every question is in. */
  const publishButton = (s: SeriesDto, cls: string) =>
    s.status !== "archived" && (
      <button
        onClick={() => setSeriesStatusOf(s, s.status === "published" ? "draft" : "published")}
        disabled={busy || (s.status !== "published" && !isComplete(s))}
        title={
          s.status !== "published" && !isComplete(s)
            ? `Select all ${s.totalQuestions} questions before publishing (${s.selectedCount} so far)`
            : undefined
        }
        className={cls}
      >
        <Upload className="w-3.5 h-3.5" /> {s.status === "published" ? "Unpublish" : "Publish"}
      </button>
    );

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />}
            {c.onClick && i < crumbs.length - 1 ? (
              <button onClick={c.onClick} className="text-sky-300 hover:text-sky-200 cursor-pointer">
                {c.label}
              </button>
            ) : (
              <span className="text-white font-semibold" aria-current="page">
                {c.label}
              </span>
            )}
          </React.Fragment>
        ))}
        <button onClick={refreshAll} className={`${btn.ghost} ml-auto`} aria-label="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </nav>

      <NoticeBox notice={notice} onClose={() => setNotice(null)} />

      {/* ── Level 1: exam types ────────────────────────────────────────── */}
      {!examId && (
        <section aria-labelledby="exam-types" className="space-y-3">
          <div>
            <h2 id="exam-types" className="text-sm font-bold text-white">
              Exam types
            </h2>
            <p className="text-xs text-slate-400">
              Each exam type keeps its own syllabus and any number of test series (mock tests,
              previous-year papers, practice sets). Create exam types in <strong>Exams &amp; Syllabus</strong>.
            </p>
          </div>
          {overview.length === 0 ? (
            <EmptyState text="No exam types yet — create one in the Exams & Syllabus tab first." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {overview.map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setExamId(e.id);
                    setSeriesId(null);
                  }}
                  className="text-left bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-xl p-4 space-y-3 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-white">{e.title.en}</span>
                    {!e.isActive && <span className="text-[11px] text-slate-400">inactive</span>}
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <Stat label="Test Series" value={`${e.seriesCount} (${e.publishedSeriesCount} pub)`} />
                    <Stat label="Series Qs" value={`${e.assignedQuestions}/${e.targetQuestions}`} />
                    <Stat label="Students" value={`${e.totalStudentsAttempted ?? 0} (${e.totalAttempts ?? 0})`} />
                    <Stat
                      label="Avg Score"
                      value={e.averageScore !== null && e.averageScore !== undefined ? `${e.averageScore}` : "—"}
                    />
                  </dl>
                  <ProgressBar value={e.assignedQuestions} max={e.targetQuestions} label="Questions selected" />
                  <p className="text-[11px] text-slate-400">
                    {e.assignedQuestions}/{e.targetQuestions} questions set across {e.seriesCount} series ·{" "}
                    {e.bankQuestionCount} Qs in Exam Bank
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Level 2: series of one exam ────────────────────────────────── */}
      {exam && !seriesId && (
        <section aria-labelledby="series-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="series-heading" className="text-sm font-bold text-white">
                Test series in {exam.titleEn}
              </h2>
              <p className="text-xs text-slate-400">
                {examOverview?.seriesCount ?? 0} test series ({examOverview?.publishedSeriesCount ?? 0} published) ·{" "}
                {examOverview?.totalStudentsAttempted ?? 0} students attempted ({examOverview?.totalAttempts ?? 0} attempts) ·{" "}
                Avg Score:{" "}
                {examOverview?.averageScore !== null && examOverview?.averageScore !== undefined
                  ? `${examOverview.averageScore} marks`
                  : "No attempts yet"}{" "}
                · {examOverview?.bankQuestionCount ?? 0} Qs in bank
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusTabs value={seriesStatus} onChange={setSeriesStatus} />
              <button onClick={() => setForm({ editing: null })} className={btn.primary}>
                <Plus className="w-3.5 h-3.5" /> New series
              </button>
            </div>
          </div>

          {form && (
            <SeriesForm
              initial={form.editing}
              defaults={exam}
              tree={examTree}
              busy={busy}
              onCancel={() => setForm(null)}
              onSubmit={(input, postCreateAction) => saveSeries(input, form.editing, postCreateAction)}
            />
          )}

          {series.length === 0 && !loading ? (
            <EmptyState text="No series here yet. Create e.g. “Clerkship Mock Test 1 - 2026”." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {series.map((s) => (
                <article key={s.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white truncate">{s.name.en}</h3>
                      {s.name.bn !== s.name.en && (
                        <p className="font-bengali text-xs text-slate-400 truncate">{s.name.bn}</p>
                      )}
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] ${KIND_TONE[s.kind]}`}>
                      {SERIES_KIND_LABELS[s.kind]}
                    </span>
                    {s.accessType === "paid" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/35">
                        PAID · {SUBSCRIPTION_TIER_LABELS[s.requiredTier] || "Pro Prelims"}
                        {s.priceInr > 0 ? ` (₹${s.priceInr})` : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/35">
                        FREE TEST
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400 font-mono">
                      {s.durationMinutes} min · +{s.marksPerCorrect}/−{s.negativeMarksPerWrong}
                      {s.estimatedCutoffMarks ? ` · cutoff ${s.estimatedCutoffMarks}` : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 text-xs">
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                        Questions
                      </span>
                      <span className="font-mono font-bold text-white">
                        {s.selectedCount}/{s.totalQuestions}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                        Students Attempted
                      </span>
                      <span className="font-mono font-bold text-amber-300">
                        {s.studentCount ?? 0} ({s.attemptCount})
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                        Avg Score
                      </span>
                      <span className="font-mono font-bold text-emerald-400">
                        {s.averageScore !== null && s.averageScore !== undefined
                          ? `${s.averageScore}/${Math.round(s.totalQuestions * s.marksPerCorrect * 100) / 100}`
                          : "—"}
                      </span>
                    </div>
                  </div>
                  {s.subjects.length === 0 ? (
                    <p className="text-xs text-amber-300">No subjects yet — open Manage Subjects to add them.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <caption className="sr-only">Questions per subject</caption>
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                          <th className="text-left font-normal pb-1">Subject</th>
                          <th className="text-right font-normal pb-1 pl-3 whitespace-nowrap" title="Questions in the test">
                            Need
                          </th>
                          <th className="text-right font-normal pb-1 pl-3 whitespace-nowrap" title="Approved questions in this exam's bank">
                            Bank
                          </th>
                          <th className="text-right font-normal pb-1 pl-3 whitespace-nowrap" title="Selected for the test / needed">
                            Selected
                          </th>
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums">
                        {s.subjects.map((x) => (
                          <tr key={x.subjectId} className="border-t border-slate-800/70">
                            <td className="py-1 pr-2 font-sans text-slate-300 truncate max-w-0 w-full" title={x.label}>
                              {x.label}
                            </td>
                            <td className="py-1 pl-3 text-right text-white">{x.targetCount}</td>
                            <td
                              className={`py-1 pl-3 text-right ${x.inBank < x.targetCount ? "text-amber-300" : "text-emerald-300"}`}
                              title={x.inBank < x.targetCount ? "Fewer approved questions than the test needs" : undefined}
                            >
                              {x.inBank}
                            </td>
                            <td
                              className={`py-1 pl-3 text-right whitespace-nowrap ${x.selected >= x.targetCount ? "text-emerald-300" : "text-slate-300"}`}
                            >
                              {x.selected}/{x.targetCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <ProgressBar value={s.selectedCount} max={s.totalQuestions} label="Questions selected" />
                  <p className="text-[11px] text-slate-400">
                    {s.selectedCount}/{s.totalQuestions} questions selected
                    {s.reservedCount > 0 && ` · ${s.reservedCount} AI draft(s) awaiting review`}
                    {s.attemptCount > 0 && ` · ${s.studentCount ?? 0} student(s) (${s.attemptCount} attempts)`}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => {
                        setSeriesId(s.id);
                        setWorkspaceTab("board");
                      }}
                      className={btn.primary}
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> Manage Subjects
                    </button>
                    <button
                      onClick={() => setExportingSeries(s)}
                      className={btn.secondary}
                      title="Export Test Series questions in PDF or Excel"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-400" /> Export (PDF / Excel)
                    </button>
                    <button
                      onClick={() => setImportingSeries(s)}
                      className={btn.secondary}
                      title="Import a whole question set (CSV/JSON/PDF/Image) into this test"
                    >
                      <FileUp className="w-3.5 h-3.5 text-sky-400" /> Import Set
                    </button>
                    <button
                      onClick={() => setAiFullSetSeries(s)}
                      className={btn.ai}
                      title="Generate full question set across subjects with AI in 1 click"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> 1-Click AI Set
                    </button>
                    <button onClick={() => setForm({ editing: s })} className={btn.secondary}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    {publishButton(s, btn.secondary)}
                    <button
                      onClick={() => setSeriesStatusOf(s, s.status === "archived" ? "draft" : "archived")}
                      disabled={busy}
                      className={btn.secondary}
                    >
                      <Archive className="w-3.5 h-3.5" /> {s.status === "archived" ? "Restore" : "Archive"}
                    </button>
                    {s.status !== "published" && s.attemptCount === 0 && (
                      <button
                        onClick={() => setConfirmDelete(s)}
                        className={btn.ghost}
                        aria-label={`Delete ${s.name.en}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Level 3: one series — subjects, then its questions ─────────── */}
      {exam && currentSeries && (
        <section aria-labelledby="series-title" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="series-title" className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
                {currentSeries.name.en} <StatusBadge status={currentSeries.status} />
                {currentSeries.accessType === "paid" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/35">
                    PAID · {SUBSCRIPTION_TIER_LABELS[currentSeries.requiredTier] || "Pro Prelims"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/35">
                    FREE TEST
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                {SERIES_KIND_LABELS[currentSeries.kind]} · {currentSeries.totalQuestions} questions ·{" "}
                {currentSeries.durationMinutes} min · +{currentSeries.marksPerCorrect}/−
                {currentSeries.negativeMarksPerWrong} · students see it once it is published
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setExportingSeries(currentSeries)}
                className={btn.secondary}
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" /> Export (PDF / Excel)
              </button>
              <button
                onClick={() => setImportingSeries(currentSeries)}
                className={btn.secondary}
              >
                <FileUp className="w-3.5 h-3.5 text-sky-400" /> Import Whole Question Set
              </button>
              <button
                onClick={() => setAiFullSetSeries(currentSeries)}
                className={btn.ai}
              >
                <Sparkles className="w-3.5 h-3.5" /> 1-Click AI Full Question Set
              </button>
              <button onClick={() => setForm({ editing: currentSeries })} className={btn.secondary}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              {publishButton(currentSeries, btn.primary)}
            </div>
          </div>

          {form?.editing?.id === currentSeries.id && (
            <SeriesForm
              initial={form.editing}
              defaults={exam}
              tree={examTree}
              busy={busy}
              onCancel={() => setForm(null)}
              onSubmit={(input) => saveSeries(input, form.editing)}
            />
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl">
            <button
              onClick={() => setShowBlueprint((v) => !v)}
              aria-expanded={showBlueprint}
              className="w-full flex flex-wrap items-center justify-between gap-2 p-4 text-left cursor-pointer"
            >
              <span>
                <span className="block text-sm font-bold text-white">Subjects &amp; questions per subject</span>
                <span className="block text-xs text-slate-400">
                  {currentSeries.subjects.length
                    ? `${currentSeries.subjects.map((x) => `${x.label} ${x.targetCount}`).join(" · ")} = ${currentSeries.totalQuestions} questions`
                    : "Choose the subjects and how many questions each"}
                </span>
              </span>
              <span className="text-xs text-sky-300">{showBlueprint ? "Close" : "Edit subjects"}</span>
            </button>
            {showBlueprint && (
              <div className="p-4 border-t border-slate-800">
                <SeriesBlueprint
                  series={currentSeries}
                  exam={exam}
                  trees={trees}
                  setNotice={setNotice}
                  onSaved={() => {
                    setBlueprintVersion((v) => v + 1);
                    refreshAll();
                  }}
                />
              </div>
            )}
          </div>

          {currentSeries.totalQuestions > 0 && (
            <SeriesWorkspace
              key={`${currentSeries.id}-${blueprintVersion}`}
              exam={exam}
              trees={trees}
              seriesId={currentSeries.id}
              tab={workspaceTab}
              onTabChange={setWorkspaceTab}
              onChanged={refreshAll}
            />
          )}
        </section>
      )}

      {exportingSeries && (
        <SeriesExportModal
          seriesId={exportingSeries.id}
          seriesName={exportingSeries.name.en}
          onClose={() => setExportingSeries(null)}
        />
      )}

      {importingSeries && exam && (
        <SeriesImportSetModal
          exam={exam}
          series={importingSeries}
          tree={examTree}
          onClose={() => setImportingSeries(null)}
          onImported={async (res) => {
            setBlueprintVersion((v) => v + 1);
            await trees.loadTree(exam.slug, true);
            await refreshAll();
            setNotice({
              kind: "success",
              text: `Imported ${res.insertedToBank} question(s) into ${exam.titleEn} bank & assigned ${res.assignedToSeries} to “${importingSeries.name.en}”.`,
            });
          }}
        />
      )}

      {aiFullSetSeries && exam && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-4xl w-full">
            <FullSetAiGeneratorPanel
              exam={exam}
              tree={examTree}
              series={aiFullSetSeries}
              onClose={() => setAiFullSetSeries(null)}
              onGenerated={async (res) => {
                setBlueprintVersion((v) => v + 1);
                await trees.loadTree(exam.slug, true);
                await refreshAll();
                setNotice({
                  kind: "success",
                  text: `AI generated ${res.totalGenerated} question(s) across ${res.subjectSummaries.length} subjects & assigned ${res.totalAssignedToSeries} to “${aiFullSetSeries.name.en}”!`,
                });
              }}
            />
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.name.en}?`}
          body="The series, its subjects and its question selection are removed. Bank questions are not affected."
          confirmLabel="Delete"
          busy={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={runDelete}
        />
      )}
    </div>
  );
}

// ─── Small pieces ───────────────────────────────────────────────────────────

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-mono tabular-nums text-white">{value}</dd>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-slate-900 border border-dashed border-slate-700 rounded-xl p-6 text-center text-xs text-slate-400">
      {text}
    </div>
  );
}

function StatusTabs({ value, onChange }: { value: ListStatus; onChange: (v: ListStatus) => void }) {
  return (
    <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg" role="tablist">
      {(["active", "archived", "all"] as const).map((v) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`px-2.5 py-1 text-xs rounded-md cursor-pointer ${
            value === v ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          {v === "active" ? "Active" : v === "archived" ? "Archived" : "All"}
        </button>
      ))}
    </div>
  );
}

function SeriesForm({
  initial,
  defaults,
  tree,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: SeriesDto | null;
  /** New series start from the exam type's own duration and marking */
  defaults: ExamDto;
  /** The exam's syllabus — its subjects are offered for the pattern */
  tree: SyllabusTreeDto | undefined;
  busy: boolean;
  onSubmit: (
    input: SeriesInput,
    postCreateAction?: {
      mode: "none" | "import" | "ai_full_set";
      importPayload?: SeriesImportSetBody;
    }
  ) => void;
  onCancel: () => void;
}) {
  const maxExamQuestions =
    defaults.slug === "wbpsc-clerkship" &&
    (defaults.totalQuestions === 20 || defaults.totalQuestions === 300)
      ? 100
      : defaults.totalQuestions > 0
        ? defaults.totalQuestions
        : 100;

  const [v, setV] = useState<SeriesInput>(
    initial
      ? seriesToInput(initial)
      : {
          nameEn: "",
          nameBn: "",
          descriptionEn: "",
          descriptionBn: "",
          kind: "mock_test",
          status: "draft",
          displayOrder: 1,
          durationMinutes:
            defaults.slug === "wbpsc-clerkship" && defaults.durationMinutes === 20
              ? 90
              : defaults.durationMinutes,
          marksPerCorrect: defaults.marksPerCorrect,
          negativeMarksPerWrong: defaults.negativeMarksPerWrong,
          estimatedCutoffMarks:
            defaults.slug === "wbpsc-clerkship" && defaults.estimatedCutoffMarks === 2.5
              ? 65
              : defaults.estimatedCutoffMarks,
          accessType: "free",
          requiredTier: "free",
          priceInr: 0,
        }
  );
  const set = (patch: Partial<SeriesInput>) => setV((prev) => ({ ...prev, ...patch }));
  const num = (k: keyof SeriesInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ [k]: e.target.value === "" ? 0 : Number(e.target.value) } as Partial<SeriesInput>);

  const [availablePlans, setAvailablePlans] = useState(SUBSCRIPTION_TIER_PLANS);
  useEffect(() => {
    adminApi<{ plans: SubscriptionPlanDto[] }>("/subscription-plans")
      .then((res) => {
        if (res.plans && res.plans.length > 0) setAvailablePlans(res.plans);
      })
      .catch(() => {});
  }, []);

  // Subject counts start empty so Admin selects subjects up to maxExamQuestions (set in Tab 2),
  // avoiding the 12 subjects × 25 default = 300 overflow.
  const [subjectCounts, setSubjectCounts] = useState<Record<string, string>>({});

  const autoDistributeSubjects = () => {
    if (!tree || tree.subjects.length === 0) return;
    const total = maxExamQuestions;
    const n = tree.subjects.length;
    const base = Math.floor(total / n);
    let rem = total - base * n;
    const map: Record<string, string> = {};
    for (const s of tree.subjects) {
      const count = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      if (count > 0) map[s.id] = String(count);
    }
    setSubjectCounts(map);
  };

  // Two strictly isolated creation paths so the admin never gets confused:
  // Path 1 ("subject_pattern"): Manually configure number of questions per subject -> then either Generate by AI or Add from Question Bank
  // Path 2 ("full_paper_import"): Upload a complete question paper (100 Qs Clerkship, 200 Qs WBCS, etc.) -> auto-imports questions & builds blueprint
  const [creationPath, setCreationPath] = useState<"subject_pattern" | "full_paper_import">(
    "subject_pattern"
  );
  const [patternPopulateMethod, setPatternPopulateMethod] = useState<"ai_full_set" | "question_bank">(
    "ai_full_set"
  );
  const [importKind, setImportKind] = useState<"csv" | "media">("csv");
  const [importFileName, setImportFileName] = useState("");
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [importText, setImportText] = useState("");
  const [importBase64, setImportBase64] = useState("");
  const [importMime, setImportMime] = useState<
    "application/pdf" | "image/png" | "image/jpeg" | "image/webp"
  >("application/pdf");

  const handleCreationFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImportFileName(f.name);
    if (importKind === "csv") {
      setImportFormat(f.name.toLowerCase().endsWith(".json") ? "json" : "csv");
      setImportText(await f.text());
    } else {
      const lower = f.name.toLowerCase();
      const inferredMime: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" =
        f.type === "application/pdf" || lower.endsWith(".pdf")
          ? "application/pdf"
          : f.type === "image/png" || lower.endsWith(".png")
            ? "image/png"
            : f.type === "image/webp" || lower.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg";
      setImportMime(inferredMime);
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        setImportBase64(dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl);
      };
      reader.readAsDataURL(f);
    }
  };

  const countsIncomplete = Object.values(subjectCounts).some((c) => !Number(c));
  const noSubjects = !initial && Object.keys(subjectCounts).length === 0;
  const totalConfigured = Object.values(subjectCounts).reduce(
    (sum, c) => sum + (Number(c) || 0),
    0
  );
  const needMoreQuestions = Math.max(0, maxExamQuestions - totalConfigured);
  const exceedsMaxQuestions = maxExamQuestions > 0 && totalConfigured > maxExamQuestions;

  const isSubmitDisabled = () => {
    if (busy || v.nameEn.trim().length < 2) return true;
    if (initial) return false;
    if (creationPath === "subject_pattern") {
      return noSubjects || countsIncomplete || exceedsMaxQuestions;
    }
    // creationPath === "full_paper_import"
    return importKind === "csv" ? !importText.trim() : !importBase64;
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (initial) {
          onSubmit(v, { mode: "none" });
          return;
        }

        if (creationPath === "full_paper_import") {
          // Option 2: Fully import a question paper — blueprint subjects & counts are built automatically from the imported paper
          const importPayload: SeriesImportSetBody =
            importKind === "csv"
              ? {
                  format: importFormat,
                  fileName: importFileName,
                  content: importText,
                  source: "educator",
                  autoUpdateBlueprint: true,
                }
              : {
                  format: "media",
                  fileName: importFileName,
                  mimeType: importMime,
                  base64Data: importBase64,
                  source: "educator",
                  autoUpdateBlueprint: true,
                };
          onSubmit(v, { mode: "import", importPayload });
          return;
        }

        // Option 1: Subject-wise question counts configured by Admin
        const seriesInputWithSubjects: SeriesInput = {
          ...v,
          subjectTargets: Object.entries(subjectCounts).map(([subjectId, c]) => ({
            subjectId,
            targetCount: Number(c),
          })),
        };

        if (patternPopulateMethod === "ai_full_set") {
          onSubmit(seriesInputWithSubjects, { mode: "ai_full_set" });
        } else {
          onSubmit(seriesInputWithSubjects, { mode: "none" });
        }
      }}
      className="bg-slate-900 border border-emerald-500/30 rounded-xl p-5 space-y-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">
          {initial ? `Edit Test Series — ${initial.name.en}` : `Create New Test Series in ${defaults.titleEn}`}
        </h3>
      </div>

      <fieldset disabled={busy} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-slate-400 space-y-1">
          <span>Name (English) *</span>
          <input
            required
            value={v.nameEn}
            placeholder="Clerkship Mock Test 1 - 2026"
            onChange={(e) => set({ nameEn: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="text-xs text-slate-400 space-y-1">
          <span>নাম (বাংলা)</span>
          <input
            value={v.nameBn}
            onChange={(e) => set({ nameBn: e.target.value })}
            className={`${inputCls} font-bengali`}
          />
        </label>
        <label className="text-xs text-slate-400 space-y-1">
          <span>Series type</span>
          <select value={v.kind} onChange={(e) => set({ kind: e.target.value as SeriesKind })} className={inputCls}>
            {(Object.keys(SERIES_KIND_LABELS) as SeriesKind[]).map((k) => (
              <option key={k} value={k}>
                {SERIES_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400 space-y-1">
          <span>Display order</span>
          <input
            type="number"
            min={0}
            value={v.displayOrder}
            onChange={(e) => set({ displayOrder: Number(e.target.value) })}
            className={inputCls}
          />
        </label>
        <label className="text-xs text-slate-400 space-y-1 md:col-span-2">
          <span>Description</span>
          <input
            value={v.descriptionEn}
            onChange={(e) => set({ descriptionEn: e.target.value })}
            className={inputCls}
          />
        </label>

        {/* ── Free Test vs Paid Test Selector (Admin Configurable) ── */}
        <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                Test Access Type — Free Test or Paid Test *
              </p>
              <p className="text-[11px] text-slate-400">
                Select whether any student can take this test for free, or if a paid subscription tier is required.
              </p>
            </div>
            <span
              className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                v.accessType === "paid"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              }`}
            >
              {v.accessType === "paid"
                ? `PAID TEST (${getSubscriptionTierLabel(v.requiredTier || "pro_prelims", availablePlans)})`
                : "FREE TEST (Open to All Aspirants)"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                set({
                  accessType: "free" as SeriesAccessType,
                  requiredTier: "free" as SubscriptionTier,
                  priceInr: 0,
                })
              }
              className={`text-left p-3.5 rounded-xl border-2 transition-all cursor-pointer ${
                v.accessType !== "paid"
                  ? "bg-emerald-500/15 border-emerald-400 text-white shadow-md shadow-emerald-950/30"
                  : "bg-slate-900/70 border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                  Free Test Series
                </span>
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    v.accessType !== "paid"
                      ? "border-emerald-400 bg-emerald-500 text-slate-950"
                      : "border-slate-600"
                  }`}
                >
                  {v.accessType !== "paid" && <span className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Every signed-in aspirant (including Free Tier) can attempt this test series without payment.
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                const paidList = availablePlans.filter((p) => p.tier !== "free");
                const defaultPaidTier: SubscriptionTier =
                  v.requiredTier && v.requiredTier !== "free"
                    ? v.requiredTier
                    : paidList[0]?.tier || "pro_prelims";
                const tierPrice =
                  availablePlans.find((p) => p.tier === defaultPaidTier)?.priceInr ?? 299;
                set({
                  accessType: "paid" as SeriesAccessType,
                  requiredTier: defaultPaidTier,
                  priceInr: v.priceInr && v.priceInr > 0 ? v.priceInr : tierPrice,
                });
              }}
              className={`text-left p-3.5 rounded-xl border-2 transition-all cursor-pointer ${
                v.accessType === "paid"
                  ? "bg-amber-500/15 border-amber-400 text-white shadow-md shadow-amber-950/30"
                  : "bg-slate-900/70 border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  Paid Test Series (Subscription Required)
                </span>
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    v.accessType === "paid"
                      ? "border-amber-400 bg-amber-500 text-slate-950"
                      : "border-slate-600"
                  }`}
                >
                  {v.accessType === "paid" && <span className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Requires an active Paid Subscription (Prelims, Mains Tier, Part-II Tier, WBCS Executive Pass, or custom tier).
              </p>
            </button>
          </div>

          {v.accessType === "paid" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
              <label className="text-xs text-slate-300 space-y-1">
                <span className="font-semibold text-amber-300">Required Subscription Tier *</span>
                <select
                  value={v.requiredTier && v.requiredTier !== "free" ? v.requiredTier : "pro_prelims"}
                  onChange={(e) => {
                    const nextTier = e.target.value as SubscriptionTier;
                    const tierMeta = availablePlans.find((p) => p.tier === nextTier);
                    set({
                      requiredTier: nextTier,
                      priceInr: tierMeta ? tierMeta.priceInr : v.priceInr,
                    });
                  }}
                  className={inputCls}
                >
                  {availablePlans
                    .filter((p) => p.tier !== "free")
                    .map((p) => (
                      <option key={p.tier} value={p.tier}>
                        {p.shortLabel} — ₹{p.priceInr} ({p.labelEn})
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs text-slate-300 space-y-1">
                <span className="font-semibold text-amber-300">Indicative Plan / Test Price (₹ INR)</span>
                <input
                  type="number"
                  min={0}
                  max={50000}
                  value={v.priceInr ?? 299}
                  onChange={num("priceInr")}
                  className={inputCls}
                />
              </label>
            </div>
          )}
        </div>

        <div className="md:col-span-2 space-y-2">
          <p className="text-xs font-semibold text-white">Marking scheme</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="text-xs text-slate-400 space-y-1">
              <span>Duration (min) *</span>
              <input type="number" required min={1} max={600} value={v.durationMinutes} onChange={num("durationMinutes")} className={inputCls} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span>Marks per correct *</span>
              <input type="number" required step="0.25" min={0.25} max={10} value={v.marksPerCorrect} onChange={num("marksPerCorrect")} className={inputCls} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span>Negative per wrong *</span>
              <input type="number" required step="0.01" min={0} max={5} value={v.negativeMarksPerWrong} onChange={num("negativeMarksPerWrong")} className={inputCls} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span>Expected cutoff</span>
              <input type="number" min={0} value={v.estimatedCutoffMarks} onChange={num("estimatedCutoffMarks")} className={inputCls} />
            </label>
          </div>
        </div>

        {/* ── Strictly Isolated Two Creation Modes (Only when creating a new series) ── */}
        {!initial && (
          <div className="md:col-span-2 space-y-4 pt-2 border-t border-slate-800">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
                Choose How to Build This Test Series (2 Isolated Options)
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Pick Option 1 to set subject-wise question counts (for AI generation or Question Bank
                selection), OR pick Option 2 to directly import a complete question paper.
              </p>
            </div>

            {/* 2 Isolated Mode Selector Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCreationPath("subject_pattern")}
                className={`text-left p-4 rounded-xl border-2 transition-all cursor-pointer space-y-1.5 ${
                  creationPath === "subject_pattern"
                    ? "bg-violet-500/15 border-violet-400 text-white shadow-lg shadow-violet-950/30"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-violet-300">
                    Option 1 · Subject-Wise Blueprint
                  </span>
                  <span
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      creationPath === "subject_pattern"
                        ? "border-violet-400 bg-violet-500 text-white"
                        : "border-slate-600"
                    }`}
                  >
                    {creationPath === "subject_pattern" && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                </div>
                <p className="text-sm font-bold text-white">
                  Set Questions per Subject (AI Generate or Add from Bank)
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Manually set how many questions come from each subject, then either generate the
                  entire set by AI in 1 click or pick questions from the Question Bank.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setCreationPath("full_paper_import")}
                className={`text-left p-4 rounded-xl border-2 transition-all cursor-pointer space-y-1.5 ${
                  creationPath === "full_paper_import"
                    ? "bg-sky-500/15 border-sky-400 text-white shadow-lg shadow-sky-950/30"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-sky-300">
                    Option 2 · Full Paper Upload
                  </span>
                  <span
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      creationPath === "full_paper_import"
                        ? "border-sky-400 bg-sky-500 text-white"
                        : "border-slate-600"
                    }`}
                  >
                    {creationPath === "full_paper_import" && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                </div>
                <p className="text-sm font-bold text-white">
                  Fully Import a Question Paper (100 Qs Clerkship / 200 Qs WBCS)
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Upload a complete question paper (CSV, Excel, JSON, PDF, or Image). Automatically
                  inserts all questions into DB and builds the test series in one step.
                </p>
              </button>
            </div>

            {/* ── OPTION 1 ISOLATED PANEL: Subject Counts + AI or Bank ── */}
            {creationPath === "subject_pattern" && (
              <div className="p-4 rounded-xl bg-slate-950 border border-violet-500/35 space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-white">
                      Step 1: Set Number of Questions from Each Subject *
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={autoDistributeSubjects}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-violet-300 cursor-pointer"
                      >
                        Auto-fill {maxExamQuestions} Qs across all subjects
                      </button>
                      {Object.keys(subjectCounts).length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSubjectCounts({})}
                          className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-400 cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                      <span
                        className={`px-2.5 py-0.5 rounded border text-xs font-mono ${
                          exceedsMaxQuestions
                            ? "bg-rose-500/20 border-rose-500/40 text-rose-200 font-bold"
                            : needMoreQuestions === 0
                              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200 font-bold"
                              : "bg-violet-500/20 border-violet-500/30 text-violet-200 font-semibold"
                        }`}
                      >
                        {exceedsMaxQuestions
                          ? `${totalConfigured} Selected - Exceeds ${maxExamQuestions} Max by ${totalConfigured - maxExamQuestions}`
                          : `${totalConfigured} Selected - Need more ${needMoreQuestions}`}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    Total questions configured for <strong>{defaults.titleEn}</strong> in Tab 2:{" "}
                    <strong className="text-white">{maxExamQuestions} questions</strong>. Tick
                    subjects below and enter how many questions each subject will have in this test
                    series.
                  </p>
                  <SubjectCountsEditor
                    tree={tree}
                    value={subjectCounts}
                    onChange={setSubjectCounts}
                    maxQuestions={maxExamQuestions}
                  />
                </div>

                <div className="space-y-2 pt-3 border-t border-slate-800">
                  <p className="text-xs font-bold text-white">
                    Step 2: How do you want to add these {totalConfigured || 0} questions?
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label
                      className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
                        patternPopulateMethod === "ai_full_set"
                          ? "bg-violet-500/15 border-violet-400 text-white"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      <input
                        type="radio"
                        name="patternPopulateMethod"
                        checked={patternPopulateMethod === "ai_full_set"}
                        onChange={() => setPatternPopulateMethod("ai_full_set")}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-bold flex items-center gap-1.5 text-white">
                          <Sparkles className="w-3.5 h-3.5 text-violet-300" />
                          Generate Full Question Set by AI ({totalConfigured} Qs)
                        </span>
                        <span className="block text-[11px] text-slate-300 mt-0.5">
                          AI generates the exact number of bilingual questions for each subject
                          chosen above and assigns them to this test series automatically.
                        </span>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
                        patternPopulateMethod === "question_bank"
                          ? "bg-emerald-500/15 border-emerald-400 text-white"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      <input
                        type="radio"
                        name="patternPopulateMethod"
                        checked={patternPopulateMethod === "question_bank"}
                        onChange={() => setPatternPopulateMethod("question_bank")}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-bold flex items-center gap-1.5 text-white">
                          <FolderOpen className="w-3.5 h-3.5 text-emerald-300" />
                          Add / Select from Question Bank
                        </span>
                        <span className="block text-[11px] text-slate-300 mt-0.5">
                          Creates the test series with your subject counts above and opens the
                          Question Board so you can pick or add questions subject-by-subject.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* ── OPTION 2 ISOLATED PANEL: Full Question Paper Import ── */}
            {creationPath === "full_paper_import" && (
              <div className="p-4 rounded-xl bg-slate-950 border border-sky-500/40 space-y-3.5">
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <FileUp className="w-4 h-4 text-sky-400" />
                    Import Complete Question Paper (100 Qs Clerkship / 200 Qs WBCS / Full Set)
                  </h4>
                  <p className="text-xs text-slate-300 mt-1">
                    No manual subject count entry is required here. Upload your full question paper
                    below — all questions will be extracted, inserted into the{" "}
                    <strong>{defaults.titleEn}</strong> Question Bank, grouped by subject, and
                    attached to this test series automatically.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setImportKind("csv");
                      setImportFileName("");
                    }}
                    className={`px-3 py-1.5 rounded-lg border font-medium cursor-pointer ${
                      importKind === "csv"
                        ? "bg-sky-500/20 border-sky-400 text-white"
                        : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}
                  >
                    Excel (.csv) / JSON Question Paper
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportKind("media");
                      setImportFileName("");
                    }}
                    className={`px-3 py-1.5 rounded-lg border font-medium cursor-pointer ${
                      importKind === "media"
                        ? "bg-violet-500/20 border-violet-400 text-white"
                        : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}
                  >
                    PDF / Scanned Image Question Paper (AI OCR)
                  </button>
                </div>

                <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-700 hover:border-sky-400 bg-slate-900/60 rounded-xl cursor-pointer text-xs text-slate-200 transition-colors">
                  <Upload className="w-6 h-6 text-sky-400" />
                  <span className="font-semibold">
                    {importFileName
                      ? `Selected File: ${importFileName}`
                      : importKind === "csv"
                        ? "Click to choose a full .csv or .json question paper (e.g. 100 Qs Clerkship / 200 Qs WBCS)…"
                        : "Click to choose a .pdf or image question paper to extract & import…"}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Automatically maps subjects &amp; topics, translates missing Bengali text, and
                    populates this test series.
                  </span>
                  <input
                    type="file"
                    accept={
                      importKind === "csv"
                        ? ".csv,.json,text/csv,application/json"
                        : ".pdf,image/png,image/jpeg,image/webp,application/pdf"
                    }
                    onChange={handleCreationFilePick}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={isSubmitDisabled()}
          title={
            !initial && creationPath === "subject_pattern" && noSubjects
              ? "Choose at least one subject"
              : !initial && creationPath === "subject_pattern" && countsIncomplete
                ? "Give every chosen subject a question count"
                : undefined
          }
          className={btn.primary}
        >
          {busy
            ? !initial && creationPath === "full_paper_import"
              ? "Creating Series & Importing Full Question Paper…"
              : !initial && patternPopulateMethod === "ai_full_set"
                ? `Creating Series & Generating ${totalConfigured} Qs with AI…`
                : "Saving…"
            : initial
              ? "Save Changes"
              : creationPath === "full_paper_import"
                ? "Create Test Series & Import Full Question Paper"
                : patternPopulateMethod === "ai_full_set"
                  ? `Create Series & Generate ${totalConfigured} Questions by AI`
                  : `Create Series (${totalConfigured} Qs Blueprint) & Pick from Bank`}
        </button>
        <button type="button" onClick={onCancel} className={btn.secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
