import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  GripVertical,
  Replace,
  Search,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  OptionKeySchema,
  type ApproveJobsResult,
  type AssignQuestionsResult,
  type BankQuestionDto,
  type BilingualText,
  type ExamDto,
  type IngestionJobDto,
  type OptionKey,
  type QuestionOptions,
  type RejectJobsResult,
  type RosterDto,
  type RosterSlotDto,
  type SyllabusTreeDto,
} from "../../packages/shared-types/src/index";
import { adminApi, type SyllabusTrees } from "./adminApi";
import AiGeneratePanel from "./AiGeneratePanel";
import type { SyllabusValue } from "./SyllabusPicker";
import { ConfirmDialog, NoticeBox, ProgressBar, btn, inputCls, type Notice } from "./ui";

// ============================================================================
// One test series: select its questions subject by subject (bank → series),
// blueprint-aware AI generation and the review queue of AI drafts made for it.
// The subjects, counts and topic split come from the series blueprint.
// The server validates every selection (capacity, duplicates, syllabus);
// the board only shows what the server answered.
// ============================================================================

export type WorkspaceTab = "board" | "ai" | "review";

const TABS: Array<[WorkspaceTab, string]> = [
  ["board", "1. Select questions"],
  ["ai", "2. Generate with AI"],
  ["review", "3. Review AI drafts"],
];

const DRAG_TYPE = "application/x-wbpsc-question";

export default function SeriesWorkspace({
  exam,
  trees,
  seriesId,
  tab,
  onTabChange,
  onChanged,
}: {
  exam: ExamDto;
  trees: SyllabusTrees;
  seriesId: string;
  tab: WorkspaceTab;
  onTabChange: (t: WorkspaceTab) => void;
  onChanged: () => void;
}) {
  const [roster, setRoster] = useState<RosterDto | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [aiPath, setAiPath] = useState<Partial<SyllabusValue> | undefined>(undefined);
  const { loadTree } = trees;

  const reload = useCallback(async () => {
    try {
      setRoster((await adminApi<{ roster: RosterDto }>(`/series/${seriesId}/roster`)).roster);
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    }
  }, [seriesId]);

  useEffect(() => {
    reload();
    loadTree(exam.slug);
  }, [reload, loadTree, exam.slug]);

  const update = (r: RosterDto) => {
    setRoster(r);
    onChanged();
  };

  const tree = trees.trees[exam.slug];

  /** Slugs of a slot's node, for pre-filling the AI picker. */
  const slugPath = (slot: RosterSlotDto): Partial<SyllabusValue> => {
    const subject = tree?.subjects.find((s) => s.id === slot.subjectId);
    const chapter = subject?.chapters.find((c) => c.id === slot.chapterId);
    const subtopic = chapter?.subtopics.find((t) => t.id === slot.subtopicId);
    return {
      subjectSlug: subject?.slug ?? "",
      chapterSlug: chapter?.slug ?? "",
      subtopicSlug: subtopic?.slug ?? "",
    };
  };

  if (!roster) {
    return <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-xs text-slate-400">Loading questions…</div>;
  }
  const { series } = roster;

  return (
    <section aria-labelledby="series-questions-title" className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="series-questions-title" className="text-sm font-bold text-white">
              Questions of this test
            </h3>
            <p className="text-xs text-slate-400">
              Pick each subject's questions from the bank, or generate them with AI.
            </p>
          </div>
          <div className="text-right text-xs">
            <p className="text-white font-mono tabular-nums text-lg">{roster.completionPct}%</p>
            <p className="text-slate-400">
              {roster.assignedTotal}/{series.totalQuestions} selected ·{" "}
              {Math.max(0, series.totalQuestions - roster.assignedTotal)} vacancies
              {series.reservedCount ? ` · ${series.reservedCount} AI drafts pending` : ""}
            </p>
          </div>
        </div>
        <ProgressBar value={roster.assignedTotal} max={series.totalQuestions} label="Questions selected" />
        {roster.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-300">
            {w}
          </p>
        ))}
        <div className="flex flex-wrap gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg w-fit" role="tablist">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => onTabChange(value)}
              className={`px-3 py-1.5 text-xs rounded-md cursor-pointer ${
                tab === value ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {label}
              {value === "review" && series.reservedCount > 0 ? ` (${series.reservedCount})` : ""}
            </button>
          ))}
        </div>
      </div>

      <NoticeBox notice={notice} onClose={() => setNotice(null)} />

      {tab === "board" && (
        <RosterBoard
          exam={exam}
          roster={roster}
          tree={tree}
          onRoster={update}
          setNotice={setNotice}
          onGenerate={(slot) => {
            setAiPath(slugPath(slot));
            onTabChange("ai");
          }}
        />
      )}
      {tab === "ai" && (
        <AiGeneratePanel
          exam={exam}
          trees={trees}
          series={series}
          initialPath={aiPath}
          onGenerated={async (r) => {
            await reload();
            onChanged();
            setNotice({
              kind: r.uniqueGenerated > 0 ? "success" : "info",
              text: `${r.uniqueGenerated} AI draft(s) are waiting in “Review AI drafts”. They hold their seats until approved or rejected.`,
            });
          }}
        />
      )}
      {tab === "review" && (
        <SeriesReview
          seriesId={series.id}
          onChanged={async () => {
            await reload();
            onChanged();
          }}
          setNotice={setNotice}
        />
      )}
    </section>
  );
}

// ============================================================================
// Kanban board, one subject at a time: Available (bank) → Selected, plus
// "needs more" / "full" topic columns for that subject
// ============================================================================

interface BankFilters {
  /** "exam": this exam's bank; "all": every exam's bank, mapped onto this subject */
  scope: "exam" | "all";
  chapterId: string;
  subtopicId: string;
  difficulty: string;
  source: string;
  q: string;
  availability: "eligible" | "unassigned" | "all";
}

const BANK_PAGE = 20;

function RosterBoard({
  exam,
  roster,
  tree,
  onRoster,
  setNotice,
  onGenerate,
}: {
  exam: ExamDto;
  roster: RosterDto;
  tree: SyllabusTreeDto | undefined;
  onRoster: (r: RosterDto) => void;
  setNotice: (n: Notice | null) => void;
  onGenerate: (slot: RosterSlotDto) => void;
}) {
  const { series } = roster;
  const subjectSlots = roster.slots.filter((x) => x.level === "subject");
  const [subjectId, setSubjectId] = useState<string>(subjectSlots[0]?.subjectId ?? "");
  const [filters, setFilters] = useState<BankFilters>({
    scope: "exam",
    chapterId: "",
    subtopicId: "",
    difficulty: "",
    source: "",
    q: "",
    availability: "eligible",
  });
  const [bank, setBank] = useState<BankQuestionDto[]>([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classifyAs, setClassifyAs] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<{ questionId: string; stem: string } | null>(null);
  const [slotFilter, setSlotFilter] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!subjectSlots.some((x) => x.subjectId === subjectId)) setSubjectId(subjectSlots[0]?.subjectId ?? "");
  }, [roster.slots]);

  const subj = tree?.subjects.find((x) => x.id === subjectId);
  const chap = subj?.chapters.find((c) => c.id === filters.chapterId);

  const loadBank = useCallback(async () => {
    if (!subjectId) {
      setBank([]);
      setBankTotal(0);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        seriesId: series.id,
        targetSubjectId: subjectId,
        availability: filters.availability,
        limit: String(BANK_PAGE),
        offset: String(offset),
      });
      if (filters.scope === "exam") {
        params.set("examId", series.examId);
        params.set("subjectId", subjectId);
        if (filters.chapterId) params.set("chapterId", filters.chapterId);
        if (filters.subtopicId) params.set("subtopicId", filters.subtopicId);
      }
      for (const k of ["difficulty", "source", "q"] as const) {
        if (filters[k]) params.set(k, filters[k]);
      }
      const r = await adminApi<{ questions: BankQuestionDto[]; total: number }>(`/series/bank?${params}`);
      setBank(r.questions);
      setBankTotal(r.total);
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [series.id, series.examId, subjectId, filters, offset, setNotice]);

  useEffect(() => {
    const t = setTimeout(loadBank, 250);
    return () => clearTimeout(t);
  }, [loadBank, roster.assignedTotal]);

  const setFilter = (patch: Partial<BankFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setOffset(0);
    setSelected(new Set());
  };

  const report = (r: AssignQuestionsResult) => {
    onRoster(r.roster);
    const parts: string[] = [];
    if (r.assigned.length) parts.push(`${r.assigned.length} question(s) selected`);
    if (r.failed.length) parts.push(`${r.failed.length} not selected`);
    r.slotsFilled.forEach((label) => parts.push(`${label} is now full`));
    setNotice({
      kind: r.assigned.length === 0 ? "error" : r.failed.length ? "info" : "success",
      text: parts.join(" · ") || "Nothing changed",
      details: r.failed.map((f) => {
        const q = bank.find((b) => b.id === f.questionId);
        return `${q ? `“${q.stem.en.slice(0, 60)}…”` : f.questionId.slice(0, 8)} — ${f.reason}`;
      }),
    });
    setSelected(new Set());
  };

  const assign = async (questionIds: string[], subtopicId?: string | null) => {
    if (questionIds.length === 0 || busy) return;
    setBusy(true);
    try {
      report(
        await adminApi<AssignQuestionsResult>(`/series/${series.id}/assignments`, {
          method: "POST",
          body: { questionIds, subtopicId: subtopicId || null },
        })
      );
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (questionId: string) => {
    setBusy(true);
    try {
      const r = await adminApi<{ roster: RosterDto }>(`/series/${series.id}/assignments/${questionId}`, {
        method: "DELETE",
      });
      onRoster(r.roster);
      setNotice({ kind: "success", text: "Question removed from this test (it stays in the bank)" });
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const replaceWith = async (addQuestionId: string, subtopicId?: string | null) => {
    if (!replacing) return;
    setBusy(true);
    try {
      const r = await adminApi<{ roster: RosterDto }>(`/series/${series.id}/assignments/replace`, {
        method: "POST",
        body: { removeQuestionId: replacing.questionId, addQuestionId, subtopicId: subtopicId || null },
      });
      onRoster(r.roster);
      setReplacing(null);
      setNotice({ kind: "success", text: "Question replaced" });
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent, slot?: RosterSlotDto) => {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (!id) return;
    // Dropping on a slot classifies cross-exam questions under that subtopic
    assign([id], slot?.subtopicId ?? classifyAs[id] ?? null);
  };
  const dropProps = (target: string, slot?: RosterSlotDto) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(DRAG_TYPE)) {
        e.preventDefault();
        setDropTarget(target);
      }
    },
    onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
    onDrop: (e: React.DragEvent) => onDrop(e, slot),
  });

  const subjectSlotsHere = roster.slots.filter((x) => x.subjectId === subjectId);
  const needsMore = subjectSlotsHere.filter((x) => !x.isFull).sort((a, b) => b.vacancies - a.vacancies);
  const full = subjectSlotsHere.filter((x) => x.isFull);
  const assignedHere = roster.assigned.filter((a) => a.subjectId === subjectId);
  const assignedShown = slotFilter ? assignedHere.filter((a) => a.slotId === slotFilter) : assignedHere;
  const subjectSubtopics = (subj ? [subj] : []).flatMap((x) =>
    x.chapters.flatMap((c) => c.subtopics.map((t) => ({ id: t.id, label: `${c.name.en} → ${t.name.en}` })))
  );
  const fsel = "px-2 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white min-w-0";

  const showSlotInBank = (slot: RosterSlotDto) =>
    setFilter({
      scope: "exam",
      chapterId: slot.chapterId ?? "",
      subtopicId: slot.subtopicId ?? "",
      availability: "eligible",
    });

  return (
    <div className="space-y-3">
      {subjectSlots.length === 0 ? (
        <p className="p-3 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-200 text-xs">
          This series has no subjects yet. Set its subjects and questions per subject above first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg w-fit" role="tablist" aria-label="Subject">
          {subjectSlots.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={subjectId === x.subjectId}
              onClick={() => {
                setSubjectId(x.subjectId);
                setFilters((f) => ({ ...f, chapterId: "", subtopicId: "" }));
                setOffset(0);
                setSelected(new Set());
                setSlotFilter(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-md cursor-pointer ${
                subjectId === x.subjectId ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {x.label} <span className={`font-mono ${x.isFull ? "text-emerald-300" : "text-slate-500"}`}>
                {x.assignedCount}/{x.targetCount}
              </span>
            </button>
          ))}
        </div>
      )}
      {replacing && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-sky-500/10 border-sky-500/30 text-sky-200 text-xs" role="status">
          <Replace className="w-4 h-4" /> Choose a replacement for “{replacing.stem.slice(0, 80)}…” from Available
          questions.
          <button onClick={() => setReplacing(null)} className={btn.ghost}>
            Cancel
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-3 items-start">
        {/* ── Column 1: Available ─────────────────────────────────────── */}
        <Column title="Available questions" count={bankTotal} tone="border-sky-500/40">
          <div className="space-y-2 pb-2 border-b border-slate-800" role="search" aria-label="Filter bank questions">
            <label className="relative block">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <span className="sr-only">Search question text</span>
              <input
                value={filters.q}
                onChange={(e) => setFilter({ q: e.target.value })}
                placeholder="Search question text…"
                className={`${inputCls} pl-8`}
              />
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                aria-label="Which question bank"
                value={filters.scope}
                onChange={(e) =>
                  setFilter({ scope: e.target.value as BankFilters["scope"], chapterId: "", subtopicId: "" })
                }
                className={fsel}
              >
                <option value="exam">{exam.titleEn} bank</option>
                <option value="all">All exams' banks</option>
              </select>
              <select
                aria-label="Availability"
                value={filters.availability}
                onChange={(e) => setFilter({ availability: e.target.value as BankFilters["availability"] })}
                className={fsel}
              >
                <option value="eligible">Fits a vacancy</option>
                <option value="unassigned">Not in this test</option>
                <option value="all">All</option>
              </select>
              <select
                aria-label="Chapter"
                value={filters.chapterId}
                disabled={!subj || filters.scope !== "exam"}
                onChange={(e) => setFilter({ chapterId: e.target.value, subtopicId: "" })}
                className={fsel}
              >
                <option value="">All chapters</option>
                {subj?.chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.en}
                  </option>
                ))}
              </select>
              <select
                aria-label="Subtopic"
                value={filters.subtopicId}
                disabled={!chap || filters.scope !== "exam"}
                onChange={(e) => setFilter({ subtopicId: e.target.value })}
                className={fsel}
              >
                <option value="">All subtopics</option>
                {chap?.subtopics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name.en}
                  </option>
                ))}
              </select>
              <select aria-label="Difficulty" value={filters.difficulty} onChange={(e) => setFilter({ difficulty: e.target.value })} className={fsel}>
                <option value="">Any difficulty</option>
                <option value="easy">Easy</option>
                <option value="moderate">Moderate</option>
                <option value="hard">Hard</option>
              </select>
              <select aria-label="Source" value={filters.source} onChange={(e) => setFilter({ source: e.target.value })} className={`${fsel} col-span-2`}>
                <option value="">Any source</option>
                <option value="pyq">Previous-year (PYQ)</option>
                <option value="educator">Educator-framed</option>
                <option value="ai_generated">AI generated (approved)</option>
              </select>
            </div>
            <p className="text-[11px] text-slate-500">Only approved bank questions appear here.</p>
            {selected.size > 0 && (
              <button onClick={() => assign([...selected])} disabled={busy} className={`${btn.primary} w-full justify-center`}>
                Add selected ({selected.size})
              </button>
            )}
          </div>
          {loading && bank.length === 0 && <p className="text-xs text-slate-500">Loading…</p>}
          {!loading && bank.length === 0 && (
            <p className="text-xs text-slate-500">
              No questions match. Try “All” availability, another exam's bank, or generate with AI.
            </p>
          )}
          {bank.map((q) => {
            const elig = q.eligibility;
            const needsClass = !q.inSeries && elig && !elig.ok && elig.subtopicId === null;
            return (
              <article
                key={q.id}
                draggable={!q.inSeries}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, q.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5"
              >
                <div className="flex items-start gap-2">
                  {!q.inSeries && (
                    <input
                      type="checkbox"
                      aria-label="Select question"
                      checked={selected.has(q.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(q.id)) next.delete(q.id);
                          else next.add(q.id);
                          return next;
                        })
                      }
                      className="mt-0.5"
                    />
                  )}
                  {!q.inSeries && <GripVertical className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" aria-hidden="true" />}
                  <QuestionPeek stem={q.stem} options={q.options} correctOption={q.correctOption} explanation={q.explanation} />
                </div>
                <p className="text-[11px] text-slate-500 truncate" title={q.pathLabel}>
                  {q.pathLabel}
                </p>
                <div className="flex flex-wrap gap-1 text-[10px]">
                  <Chip>{q.difficulty}</Chip>
                  <Chip>{q.previousYearTag ?? q.source}</Chip>
                  {q.usedInSeries > 0 && <Chip>in {q.usedInSeries} series</Chip>}
                  {q.examId !== series.examId && <Chip tone="text-violet-300">other exam</Chip>}
                  {q.inSeries ? (
                    <Chip tone="text-emerald-300">in this test</Chip>
                  ) : (
                    elig && <Chip tone={elig.ok ? "text-emerald-300" : "text-amber-300"}>{elig.reason}</Chip>
                  )}
                </div>
                {needsClass && (
                  <select
                    aria-label="Classify under subtopic"
                    value={classifyAs[q.id] ?? ""}
                    onChange={(e) => setClassifyAs((c) => ({ ...c, [q.id]: e.target.value }))}
                    className={`${fsel} w-full`}
                  >
                    <option value="">Classify under… (this exam's syllabus)</option>
                    {subjectSubtopics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
                {!q.inSeries && (
                  <div className="flex gap-1.5">
                    {replacing ? (
                      <button
                        onClick={() => replaceWith(q.id, classifyAs[q.id])}
                        disabled={busy || (needsClass && !classifyAs[q.id])}
                        className={btn.primary}
                      >
                        <Replace className="w-3.5 h-3.5" /> Use as replacement
                      </button>
                    ) : (
                      <button
                        onClick={() => assign([q.id], classifyAs[q.id])}
                        disabled={busy || (needsClass ? !classifyAs[q.id] : elig ? !elig.ok : false)}
                        className={btn.primary}
                      >
                        Add →
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {bankTotal > BANK_PAGE && (
            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
              <span>
                {offset + 1}–{Math.min(offset + BANK_PAGE, bankTotal)} of {bankTotal}
              </span>
              <div className="flex gap-1">
                <button onClick={() => setOffset(Math.max(0, offset - BANK_PAGE))} disabled={offset === 0} className={btn.secondary}>
                  Prev
                </button>
                <button onClick={() => setOffset(offset + BANK_PAGE)} disabled={offset + BANK_PAGE >= bankTotal} className={btn.secondary}>
                  Next
                </button>
              </div>
            </div>
          )}
        </Column>

        {/* ── Column 2: Assigned ─────────────────────────────────────── */}
        <Column
          title={`Selected for ${subj?.name.en ?? "this subject"}`}
          count={assignedHere.length}
          tone={dropTarget === "assigned" ? "border-emerald-400 bg-emerald-500/5" : "border-emerald-500/40"}
          dropProps={dropProps("assigned")}
        >
          <p className="text-[11px] text-slate-500">Drag questions here or press “Add”.</p>
          {slotFilter && (
            <button onClick={() => setSlotFilter(null)} className={btn.ghost}>
              <XCircle className="w-3.5 h-3.5" /> Showing one slot — show all
            </button>
          )}
          {assignedShown.length === 0 && <p className="text-xs text-slate-500">Nothing selected yet.</p>}
          {assignedShown.map((a, i) => (
            <article key={a.assignmentId} className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-start gap-2">
                <span className="text-[11px] font-mono text-slate-500 w-5 shrink-0">{i + 1}</span>
                <QuestionPeek stem={a.stem} options={a.options} correctOption={a.correctOption} explanation={a.explanation} />
              </div>
              <p className="text-[11px] text-slate-500 truncate" title={a.pathLabel}>
                {a.pathLabel}
              </p>
              <div className="flex flex-wrap items-center gap-1 text-[10px]">
                <Chip>{a.difficulty}</Chip>
                <Chip>{a.previousYearTag ?? a.source}</Chip>
                {a.crossExam && <Chip tone="text-violet-300">from another exam</Chip>}
                <span className="flex-1" />
                <button
                  onClick={() => setReplacing({ questionId: a.questionId, stem: a.stem.en })}
                  disabled={busy}
                  className={btn.ghost}
                >
                  <Replace className="w-3 h-3" /> Replace
                </button>
                <button
                  onClick={() => remove(a.questionId)}
                  disabled={busy || series.status === "published"}
                  title={series.status === "published" ? "A published test must stay complete — use Replace" : undefined}
                  className={btn.ghost}
                  aria-label="Remove from test"
                >
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              </div>
            </article>
          ))}
        </Column>

        {/* ── Column 3: Needs more ───────────────────────────────────── */}
        <Column title="Needs more questions" count={needsMore.length} tone="border-amber-500/40">
          <p className="text-[11px] text-slate-500">
            {subj?.name.en} and the topics it is split into.
          </p>
          {needsMore.length === 0 && subjectSlotsHere.length > 0 && (
            <p className="text-xs text-emerald-300">{subj?.name.en} is complete.</p>
          )}
          {needsMore.map((s) => (
            <article
              key={s.id}
              {...dropProps(s.id, s)}
              className={`border rounded-lg p-2.5 space-y-1.5 ${
                dropTarget === s.id ? "border-amber-400 bg-amber-500/10" : "bg-slate-950 border-slate-800"
              }`}
            >
              <SlotHeader slot={s} />
              <ProgressBar value={s.assignedCount} max={s.targetCount} label={`${s.label} filled`} />
              <p className="text-[11px] text-slate-400">
                {s.vacancies} seat(s) open here
                {s.freeTarget !== s.targetCount && ` (sub-slots hold ${s.targetCount - s.freeTarget})`}
                {s.reservedCount > 0 && ` · ${s.reservedCount} AI draft(s) pending`}
              </p>
              {s.vacancies === 0 && (
                <p className="text-[11px] text-amber-300">
                  Its open seats are given to the topics below it — add questions from those topics, or lower
                  their counts in “Subjects &amp; questions per subject” to take questions from other topics.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => showSlotInBank(s)} className={btn.secondary}>
                  <Search className="w-3 h-3" /> Find questions
                </button>
                <button onClick={() => onGenerate(s)} className={btn.ai} disabled={s.vacancies === 0}>
                  <Sparkles className="w-3 h-3" /> Generate
                </button>
                <button onClick={() => setSlotFilter(s.id)} className={btn.ghost}>
                  Show selected
                </button>
              </div>
            </article>
          ))}
        </Column>

        {/* ── Column 4: Full ─────────────────────────────────────────── */}
        <Column title="Full" count={full.length} tone="border-emerald-500/40">
          {full.length === 0 && <p className="text-xs text-slate-500">Nothing is full yet.</p>}
          {full.map((s) => (
            <article key={s.id} className="bg-slate-950 border border-emerald-500/20 rounded-lg p-2.5 space-y-1.5">
              <SlotHeader slot={s} />
              <p className="text-[11px] text-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Full — raise its count in the subjects above to add more
              </p>
              <button onClick={() => setSlotFilter(s.id)} className={btn.ghost}>
                Show selected
              </button>
            </article>
          ))}
        </Column>
      </div>
    </div>
  );
}

function Column({
  title,
  count,
  tone,
  dropProps,
  children,
}: {
  title: string;
  count: number;
  tone: string;
  dropProps?: React.HTMLAttributes<HTMLElement>;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      {...dropProps}
      className={`bg-slate-900 border-t-2 border rounded-xl p-3 space-y-2 lg:max-h-[75vh] lg:overflow-y-auto ${tone}`}
    >
      <h3 className="text-xs font-bold text-white flex items-center justify-between sticky top-0">
        {title}
        <span className="font-mono text-slate-400">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function SlotHeader({ slot }: { slot: RosterSlotDto }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-white">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-1">{slot.level}</span>
        {slot.label}
      </span>
      <span className="text-xs font-mono tabular-nums text-slate-300 shrink-0">
        {slot.assignedCount}/{slot.targetCount}
      </span>
    </div>
  );
}

function Chip({ children, tone = "text-slate-300" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`px-1.5 py-0.5 rounded bg-slate-800 ${tone}`}>{children}</span>;
}

/** Stem with an expandable view of options, answer and explanation. */
function QuestionPeek({
  stem,
  options,
  correctOption,
  explanation,
}: {
  stem: BilingualText;
  options: QuestionOptions;
  correctOption: OptionKey;
  explanation: BilingualText;
}) {
  return (
    <details className="min-w-0 flex-1 group">
      <summary className="text-xs text-white cursor-pointer list-none line-clamp-2 group-open:line-clamp-none">
        {stem.en}
      </summary>
      <div className="mt-2 space-y-1 text-[11px]">
        <p className="font-bengali text-slate-400">{stem.bn}</p>
        <ul className="space-y-0.5">
          {OptionKeySchema.options.map((k) => (
            <li key={k} className={k === correctOption ? "text-emerald-300 font-semibold" : "text-slate-300"}>
              {k}. {options[k].en}
              <span className="font-bengali text-slate-500"> · {options[k].bn}</span>
              {k === correctOption && " ✓"}
            </li>
          ))}
        </ul>
        <p className="text-slate-400">{explanation.en}</p>
      </div>
    </details>
  );
}

// ============================================================================
// Review queue for AI drafts generated for this series
// ============================================================================

function SeriesReview({
  seriesId,
  onChanged,
  setNotice,
}: {
  seriesId: string;
  onChanged: () => Promise<void>;
  setNotice: (n: Notice | null) => void;
}) {
  const [jobs, setJobs] = useState<IngestionJobDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState(true);
  const [confirm, setConfirm] = useState<{ kind: "reject"; ids: string[] } | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminApi<{ jobs: IngestionJobDto[] }>(
        `/ingestion/jobs?targetSeriesId=${seriesId}&status=pending_review&limit=200`
      );
      setJobs(r.jobs);
      setSelected(new Set());
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [seriesId, setNotice]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (ids: string[]) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await adminApi<ApproveJobsResult>("/ingestion/jobs/approve", {
        method: "POST",
        body: { ids, assignToTargetSeries: assign },
      });
      setNotice({
        kind: r.inserted === 0 ? "error" : r.results.some((x) => x.status !== "inserted") ? "info" : "success",
        text: `${r.inserted} approved into the bank · ${r.assigned} added to this test`,
        details: r.results
          .filter((x) => x.status !== "inserted")
          .map((x) => `${jobs.find((j) => j.id === x.id)?.draft?.stem.en.slice(0, 60) ?? x.id} — ${x.message ?? x.status}`),
      });
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const reject = async (ids: string[]) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await adminApi<RejectJobsResult>("/ingestion/jobs/reject", {
        method: "POST",
        body: { ids, reviewNotes: reason.trim() || undefined },
      });
      setNotice({ kind: "success", text: `${r.rejected} rejected — their seats are free again` });
      setReason("");
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const allSelected = jobs.length > 0 && jobs.every((j) => selected.has(j.id));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-800">
        <label className="flex items-center gap-1.5 text-xs text-white">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(jobs.map((j) => j.id)))}
            disabled={jobs.length === 0}
          />
          Select all ({jobs.length})
        </label>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-slate-300">
          <input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} />
          Add approved to this test
        </label>
        <button onClick={() => approve([...selected])} disabled={busy || selected.size === 0} className={btn.primary}>
          <CheckCircle2 className="w-3.5 h-3.5" /> Approve selected ({selected.size})
        </button>
        <button
          onClick={() => setConfirm({ kind: "reject", ids: [...selected] })}
          disabled={busy || selected.size === 0}
          className={btn.danger}
        >
          <XCircle className="w-3.5 h-3.5" /> Reject selected
        </button>
      </div>
      {loading && <p className="p-4 text-xs text-slate-500">Loading…</p>}
      {!loading && jobs.length === 0 && (
        <p className="p-4 text-xs text-slate-500">No AI drafts waiting for this test.</p>
      )}
      <ul className="divide-y divide-slate-800">
        {jobs.map((j) => {
          const d = j.draft;
          if (!d) return null;
          return (
            <li key={j.id} className="p-3 flex items-start gap-3">
              <input
                type="checkbox"
                aria-label="Select draft"
                checked={selected.has(j.id)}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(j.id)) next.delete(j.id);
                    else next.add(j.id);
                    return next;
                  })
                }
                className="mt-1"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <QuestionPeek stem={d.stem} options={d.options} correctOption={d.correctOption} explanation={d.explanation} />
                <div className="flex flex-wrap gap-1 text-[10px]">
                  <Chip>{d.subtopicSlug}</Chip>
                  <Chip>{d.difficulty}</Chip>
                  {j.aiConfidenceScore !== null && (
                    <Chip tone={j.aiConfidenceScore < 0.7 ? "text-amber-300" : "text-slate-300"}>
                      AI confidence {Math.round(j.aiConfidenceScore * 100)}%
                    </Chip>
                  )}
                  <Chip>{new Date(j.createdAt).toLocaleDateString()}</Chip>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => approve([j.id])} disabled={busy} className={btn.primary}>
                  Approve
                </button>
                <button onClick={() => reject([j.id])} disabled={busy} className={btn.danger}>
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {confirm?.kind === "reject" && (
        <ConfirmDialog
          title={`Reject ${confirm.ids.length} draft(s)?`}
          body="They are kept (with your reason) so the AI never proposes them again, and their seats are released."
          confirmLabel={`Reject ${confirm.ids.length}`}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => reject(confirm.ids)}
        >
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            aria-label="Rejection reason"
            className={inputCls}
          />
        </ConfirmDialog>
      )}
    </div>
  );
}
