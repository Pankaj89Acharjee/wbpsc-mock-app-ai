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
  type ExamDto,
  type ExamOverviewDto,
  type GenerateFullQuestionSetResult,
  type PublishStatus,
  type SeriesDto,
  type SeriesImportSetBody,
  type SeriesImportSetResult,
  type SeriesInput,
  type SeriesKind,
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
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <Stat label="Series" value={e.seriesCount} />
                    <Stat label="Published" value={e.publishedSeriesCount} />
                    <Stat label="Bank Qs" value={e.bankQuestionCount} />
                  </dl>
                  <ProgressBar value={e.assignedQuestions} max={e.targetQuestions} label="Questions selected" />
                  <p className="text-[11px] text-slate-400">
                    {e.assignedQuestions}/{e.targetQuestions} questions selected across its series
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
                {examOverview?.bankQuestionCount ?? 0} questions in this exam's bank ·{" "}
                {examOverview?.publishedSeriesCount ?? 0} of {examOverview?.seriesCount ?? 0} series published
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
                    <span className="text-[11px] text-slate-400 font-mono">
                      {s.durationMinutes} min · +{s.marksPerCorrect}/−{s.negativeMarksPerWrong}
                      {s.estimatedCutoffMarks ? ` · cutoff ${s.estimatedCutoffMarks}` : ""}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-slate-400">Total questions</span>
                    <span className="text-lg font-mono tabular-nums text-white">{s.totalQuestions}</span>
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
                    {s.attemptCount > 0 && ` · ${s.attemptCount} attempt(s)`}
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
              <h2 id="series-title" className="text-sm font-bold text-white flex items-center gap-2">
                {currentSeries.name.en} <StatusBadge status={currentSeries.status} />
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
          durationMinutes: defaults.durationMinutes,
          marksPerCorrect: defaults.marksPerCorrect,
          negativeMarksPerWrong: defaults.negativeMarksPerWrong,
          estimatedCutoffMarks: defaults.estimatedCutoffMarks,
        }
  );
  const set = (patch: Partial<SeriesInput>) => setV((prev) => ({ ...prev, ...patch }));
  const num = (k: keyof SeriesInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ [k]: e.target.value === "" ? 0 : Number(e.target.value) } as Partial<SeriesInput>);

  // Pre-populate subjectCounts with the exam's configured weightageQuestions when creating a new series
  const [subjectCounts, setSubjectCounts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (!initial && tree) {
      for (const s of tree.subjects) {
        if ((s.weightageQuestions ?? 0) > 0) {
          map[s.id] = String(s.weightageQuestions);
        }
      }
    }
    return map;
  });

  useEffect(() => {
    if (!initial && tree && Object.keys(subjectCounts).length === 0) {
      const map: Record<string, string> = {};
      for (const s of tree.subjects) {
        if ((s.weightageQuestions ?? 0) > 0) {
          map[s.id] = String(s.weightageQuestions);
        }
      }
      if (Object.keys(map).length > 0) setSubjectCounts(map);
    }
  }, [initial, tree]);

  // Creation-time Question Set Populate Mode: "none" | "import" | "ai_full_set"
  const [populateMode, setPopulateMode] = useState<"none" | "import" | "ai_full_set">("none");
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
      setImportMime(
        (f.type as "application/pdf" | "image/png" | "image/jpeg" | "image/webp") ||
          "application/pdf"
      );
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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const seriesInput: SeriesInput = initial
          ? v
          : {
              ...v,
              subjectTargets: Object.entries(subjectCounts).map(([subjectId, c]) => ({
                subjectId,
                targetCount: Number(c),
              })),
            };

        if (initial || populateMode === "none") {
          onSubmit(seriesInput, { mode: "none" });
          return;
        }
        if (populateMode === "ai_full_set") {
          onSubmit(seriesInput, { mode: "ai_full_set" });
          return;
        }
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
        onSubmit(seriesInput, { mode: "import", importPayload });
      }}
      className="bg-slate-900 border border-emerald-500/30 rounded-xl p-4 space-y-4"
    >
      <h3 className="text-sm font-bold text-white">{initial ? "Edit series" : "New series"}</h3>
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
        {!initial && (
          <>
            <div className="md:col-span-2 space-y-2">
              <p className="text-xs font-semibold text-white">
                Subjects and questions per subject *{" "}
                <span className="font-normal text-slate-400">
                  — Pre-filled from {defaults.titleEn} exam settings (e.g. General Studies 40 ·
                  English 30 · Mathematics 30 = 100 Qs). Adjust as needed.
                </span>
              </p>
              <SubjectCountsEditor tree={tree} value={subjectCounts} onChange={setSubjectCounts} />
            </div>

            {/* Populate Questions Option Right During Test Creation */}
            <div className="md:col-span-2 p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <p className="text-xs font-semibold text-white">
                How would you like to populate questions for this test?
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <label
                  className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs cursor-pointer ${
                    populateMode === "none"
                      ? "bg-emerald-500/10 border-emerald-500/40 text-white"
                      : "border-slate-800 text-slate-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="populateMode"
                    checked={populateMode === "none"}
                    onChange={() => setPopulateMode("none")}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="block font-semibold">Pick / Add Later</span>
                    <span className="block text-[11px] text-slate-400">
                      Create test structure first, then pick from bank or generate
                    </span>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs cursor-pointer ${
                    populateMode === "import"
                      ? "bg-sky-500/15 border-sky-400/50 text-white"
                      : "border-slate-800 text-slate-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="populateMode"
                    checked={populateMode === "import"}
                    onChange={() => setPopulateMode("import")}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="block font-semibold flex items-center gap-1">
                      <FileUp className="w-3.5 h-3.5 text-sky-400" /> Import Whole Question Set
                    </span>
                    <span className="block text-[11px] text-slate-400">
                      Upload CSV, JSON, or PDF/Image Paper into DB &amp; attach now
                    </span>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs cursor-pointer ${
                    populateMode === "ai_full_set"
                      ? "bg-violet-500/15 border-violet-400/50 text-white"
                      : "border-slate-800 text-slate-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="populateMode"
                    checked={populateMode === "ai_full_set"}
                    onChange={() => setPopulateMode("ai_full_set")}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="block font-semibold flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-violet-300" /> 1-Click AI Full Set (
                      {totalConfigured} Qs)
                    </span>
                    <span className="block text-[11px] text-slate-400">
                      AI generates exact count for each chosen subject above
                    </span>
                  </div>
                </label>
              </div>

              {populateMode === "import" && (
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setImportKind("csv");
                        setImportFileName("");
                      }}
                      className={`px-2.5 py-1 rounded border cursor-pointer ${
                        importKind === "csv"
                          ? "bg-sky-500/20 border-sky-400 text-white"
                          : "border-slate-800 text-slate-400"
                      }`}
                    >
                      CSV / JSON File
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setImportKind("media");
                        setImportFileName("");
                      }}
                      className={`px-2.5 py-1 rounded border cursor-pointer ${
                        importKind === "media"
                          ? "bg-violet-500/20 border-violet-400 text-white"
                          : "border-slate-800 text-slate-400"
                      }`}
                    >
                      PDF / Image Question Paper
                    </button>
                  </div>

                  <label className="flex items-center justify-center gap-2 p-4 border border-dashed border-slate-700 hover:border-sky-400 rounded-lg cursor-pointer text-xs text-slate-300">
                    <Upload className="w-4 h-4 text-sky-400" />
                    <span>
                      {importFileName ||
                        (importKind === "csv"
                          ? "Choose .csv or .json question set file…"
                          : "Choose .pdf or image question paper…")}
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

              {populateMode === "ai_full_set" && (
                <p className="text-xs text-violet-200 bg-violet-500/10 border border-violet-500/30 p-2.5 rounded-lg">
                  When you click <strong>Create &amp; Generate {totalConfigured} Questions</strong>,
                  AI will immediately generate the bilingual questions for each selected subject in
                  your blueprint above, insert them into the <strong>{defaults.titleEn}</strong>{" "}
                  Question Bank, and assign them to this test.
                </p>
              )}
            </div>
          </>
        )}
      </fieldset>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={
            busy ||
            v.nameEn.trim().length < 2 ||
            noSubjects ||
            countsIncomplete ||
            (populateMode === "import" &&
              (importKind === "csv" ? !importText.trim() : !importBase64))
          }
          title={noSubjects ? "Choose at least one subject" : countsIncomplete ? "Give every chosen subject a count" : undefined}
          className={btn.primary}
        >
          {busy
            ? populateMode === "ai_full_set"
              ? `Creating & Generating ${totalConfigured} Qs with AI…`
              : populateMode === "import"
                ? "Creating & Importing Question Set…"
                : "Saving…"
            : !initial && populateMode === "ai_full_set"
              ? `Create & Generate ${totalConfigured} Questions (AI)`
              : !initial && populateMode === "import"
                ? "Create & Import Question Set"
                : "Save series"}
        </button>
        <button type="button" onClick={onCancel} className={btn.secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
