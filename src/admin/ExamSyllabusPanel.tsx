import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FolderPlus,
  Layers,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  SERIES_KIND_LABELS,
  SYLLABUS_CSV_COLUMNS,
  SYLLABUS_TEMPLATE_EXAMPLES,
  WBPSC_EXAM_PRESETS,
  WBPSC_SUBJECT_PRESETS,
  toCsv,
  type ExamConfigInput,
  type ExamDto,
  type ExamOverviewDto,
  type SyllabusTreeDto,
  type SyllabusUploadResult,
} from "../../packages/shared-types/src/index";
import { adminApi, downloadCsv, type SyllabusTrees } from "./adminApi";

// ============================================================================
// Admin Console → Tab 2: Exams & Syllabus
// Designed for non-technical educators & admins:
// 1. Live Exam Category & Test Series Statistics Banner (Series count, questions
//    per series, students attempted, and average score for each series)
// 2. AI Bulk Syllabus Generator with live Subject Add, Inline Edit & Cascade Delete
// 3. Guided Manual / Pre-populated Subject -> Chapter -> Subtopic Builder
// 4. Full Interactive CRUD Tree with Transactional Cascade Delete for Subjects,
//    Chapters, Subtopics, Entire Syllabus, and Exam Categories
// ============================================================================

type Notice = { kind: "success" | "error" | "info"; text: string; details?: string[] };

type CascadeDeleteTarget = {
  kind: "subject" | "chapter" | "subtopic" | "entire_syllabus" | "exam";
  id?: string;
  slug?: string;
  label: string;
  details: string;
};

const EMPTY_EXAM: ExamConfigInput = {
  titleEn: "",
  titleBn: "",
  descriptionEn: "",
  descriptionBn: "",
  totalQuestions: 100,
  durationMinutes: 120,
  marksPerCorrect: 1,
  negativeMarksPerWrong: 0.25,
  estimatedCutoffMarks: 40,
  isActive: true,
};

export default function ExamSyllabusPanel({
  exams,
  reloadExams,
  trees,
}: {
  exams: ExamDto[];
  reloadExams: () => Promise<void>;
  trees: SyllabusTrees;
}) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [activeTool, setActiveTool] = useState<"ai" | "manual" | "csv" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uploading, setUploading] = useState(false);
  const [overviewList, setOverviewList] = useState<ExamOverviewDto[]>([]);
  const [cascadeTarget, setCascadeTarget] = useState<CascadeDeleteTarget | null>(null);
  const [cascadeBusy, setCascadeBusy] = useState(false);

  const selected = exams.find((e) => e.slug === selectedSlug) ?? null;
  const tree = selected ? trees.trees[selected.slug] : undefined;
  const { loadTree, setTree } = trees;

  const loadOverview = useCallback(async () => {
    try {
      const res = await adminApi<{ exams: ExamOverviewDto[] }>("/series/overview");
      setOverviewList(res.exams);
    } catch {
      // ignore if overview fails transiently
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview, exams]);

  useEffect(() => {
    if (!selectedSlug && exams.length > 0) setSelectedSlug(exams[0].slug);
  }, [exams, selectedSlug]);

  useEffect(() => {
    if (selectedSlug) loadTree(selectedSlug, true);
  }, [selectedSlug]);

  const selectedOverview = useMemo(
    () =>
      selected
        ? overviewList.find((o) => o.id === selected.id || o.slug === selected.slug) ?? null
        : null,
    [overviewList, selected]
  );

  const handleSyllabusFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selected) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setNotice({ kind: "error", text: "Please select a .csv file (Excel → Save As → CSV UTF-8)." });
      return;
    }
    setUploading(true);
    setNotice(null);
    try {
      const { result, tree: updated } = await adminApi<{
        result: SyllabusUploadResult;
        tree: SyllabusTreeDto;
      }>(`/syllabus/exams/${selected.slug}/upload`, {
        method: "POST",
        body: { fileName: file.name, content: await file.text() },
      });
      setTree(updated);
      await reloadExams();
      await loadOverview();
      const c = result.created;
      setNotice({
        kind: result.errors.length ? "error" : "success",
        text: `Imported ${c.subjects} new subjects, ${c.chapters} chapters, ${c.subtopics} topics · ${result.updated} updated${
          result.errors.length ? ` · ${result.errors.length} rows skipped` : ""
        }`,
        details: result.errors.map((er) => `Row ${er.rowNumber}: ${er.message}`),
      });
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const downloadCurrentSyllabus = () => {
    if (!selected || !tree) return;
    const rows = tree.subjects.flatMap((s) =>
      s.chapters.flatMap((c) =>
        c.subtopics.map((t) => ({
          subject_en: s.name.en,
          subject_bn: s.name.bn,
          chapter_en: c.name.en,
          chapter_bn: c.name.bn,
          subtopic_en: t.name.en,
          subtopic_bn: t.name.bn,
          subject_slug: s.slug,
          chapter_slug: c.slug,
          subtopic_slug: t.slug,
        }))
      )
    );
    downloadCsv(`${selected.slug}-syllabus.csv`, toCsv(rows, SYLLABUS_CSV_COLUMNS));
  };

  const executeCascadeDelete = async () => {
    if (!cascadeTarget || !selected) return;
    setCascadeBusy(true);
    try {
      if (cascadeTarget.kind === "exam" && cascadeTarget.slug) {
        const res = await adminApi<{ deleted: boolean; deletedQuestions?: number }>(
          `/syllabus/exams/${cascadeTarget.slug}`,
          { method: "DELETE" }
        );
        await reloadExams();
        await loadOverview();
        const remaining = exams.filter((e) => e.slug !== cascadeTarget.slug);
        setSelectedSlug(remaining[0]?.slug ?? null);
        setNotice({
          kind: "success",
          text: `Cascade deleted exam "${cascadeTarget.label}"${
            res.deletedQuestions ? ` along with ${res.deletedQuestions} linked question(s).` : "."
          }`,
        });
      } else if (cascadeTarget.kind === "entire_syllabus" && cascadeTarget.slug) {
        const res = await adminApi<{
          deleted: boolean;
          deletedQuestions?: number;
          tree: SyllabusTreeDto | null;
        }>(`/syllabus/exams/${cascadeTarget.slug}/tree`, { method: "DELETE" });
        if (res.tree) setTree(res.tree);
        await reloadExams();
        await loadOverview();
        setNotice({
          kind: "success",
          text: `Cascade deleted entire syllabus for "${cascadeTarget.label}"${
            res.deletedQuestions ? ` and removed ${res.deletedQuestions} linked question(s).` : "."
          }`,
        });
      } else if (cascadeTarget.id) {
        const endpoint =
          cascadeTarget.kind === "subject"
            ? `/syllabus/subjects/${cascadeTarget.id}`
            : cascadeTarget.kind === "chapter"
              ? `/syllabus/chapters/${cascadeTarget.id}`
              : `/syllabus/subtopics/${cascadeTarget.id}`;
        const res = await adminApi<{
          deleted: boolean;
          deletedQuestions?: number;
          tree: SyllabusTreeDto | null;
        }>(endpoint, { method: "DELETE" });
        if (res.tree) setTree(res.tree);
        await reloadExams();
        await loadOverview();
        setNotice({
          kind: "success",
          text: `Cascade deleted ${cascadeTarget.kind} "${cascadeTarget.label}"${
            res.deletedQuestions ? ` and ${res.deletedQuestions} linked question(s).` : "."
          }`,
        });
      }
      setCascadeTarget(null);
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setCascadeBusy(false);
    }
  };

  const totalChapters = useMemo(
    () => tree?.subjects.reduce((sum, s) => sum + s.chapters.length, 0) ?? 0,
    [tree]
  );
  const totalSubtopics = useMemo(
    () =>
      tree?.subjects.reduce(
        (sum, s) => sum + s.chapters.reduce((cSum, c) => cSum + c.subtopics.length, 0),
        0
      ) ?? 0,
    [tree]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-5">
      {/* ── Left Column: Exam Selector ────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 h-fit">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Target Exams ({exams.length})
          </h3>
        </div>
        <button
          onClick={() => {
            setFormMode("create");
            setNotice(null);
          }}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg cursor-pointer transition-colors"
        >
          <Plus className="w-4 h-4" /> Create New Exam
        </button>

        <div className="space-y-1.5 pt-1">
          {exams.map((e) => {
            const isSelected = selectedSlug === e.slug && formMode !== "create";
            const ov = overviewList.find((o) => o.id === e.id || o.slug === e.slug);
            return (
              <button
                key={e.slug}
                onClick={() => {
                  setSelectedSlug(e.slug);
                  setFormMode(null);
                  setNotice(null);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs cursor-pointer transition-colors border ${
                  isSelected
                    ? "bg-slate-800/90 border-amber-500/40 text-white"
                    : "border-transparent text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
                }`}
              >
                <span className="block font-semibold truncate">{e.titleEn}</span>
                <span className="block text-[11px] font-bengali text-slate-400 truncate mt-0.5">
                  {e.titleBn}
                </span>
                <span className="block text-[11px] text-slate-500 mt-1">
                  {ov?.seriesCount ?? 0} test series · {e.subtopicCount} topics · {e.questionCount} bank Qs
                  {!e.isActive && <span className="text-rose-400"> · Hidden</span>}
                </span>
              </button>
            );
          })}
          {exams.length === 0 && (
            <p className="text-xs text-slate-500 px-1 py-4 text-center">
              No exams configured yet. Click “Create New Exam” above.
            </p>
          )}
        </div>
      </div>

      {/* ── Right Column: Exam Statistics Banner & Syllabus Builder ───── */}
      <div className="space-y-4 min-w-0">
        {notice && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
              notice.kind === "error"
                ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
                : notice.kind === "info"
                  ? "bg-sky-500/10 border-sky-500/30 text-sky-200"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
            }`}
          >
            <div className="space-y-1">
              <p className="font-semibold">{notice.text}</p>
              {notice.details && notice.details.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-y-auto list-disc pl-4">
                  {notice.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => setNotice(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {formMode ? (
          <ExamForm
            key={formMode === "edit" ? selected?.slug : "new"}
            mode={formMode}
            exam={formMode === "edit" ? selected : null}
            tree={formMode === "edit" ? tree : undefined}
            onTreeUpdated={async (updated, msg) => {
              setTree(updated);
              await reloadExams();
              await loadOverview();
              if (msg) setNotice({ kind: "success", text: msg });
            }}
            onCancel={() => setFormMode(null)}
            onSave={async (input) => {
              try {
                const { exam } =
                  formMode === "create"
                    ? await adminApi<{ exam: ExamDto }>("/syllabus/exams", {
                        method: "POST",
                        body: input,
                      })
                    : await adminApi<{ exam: ExamDto }>(`/syllabus/exams/${selected!.slug}`, {
                        method: "PUT",
                        body: input,
                      });
                await reloadExams();
                await loadOverview();
                await loadTree(exam.slug, true);
                setSelectedSlug(exam.slug);
                setFormMode(null);
                if (formMode === "create") {
                  setActiveTool("ai");
                }
                setNotice({
                  kind: "success",
                  text:
                    formMode === "create"
                      ? `Created "${exam.titleEn}" with its subject-wise question distribution. Now generate its full syllabus with AI or add topics below.`
                      : `Updated "${exam.titleEn}".`,
                });
              } catch (err) {
                setNotice({ kind: "error", text: (err as Error).message });
              }
            }}
          />
        ) : selected ? (
          <>
            {/* ── Exam Category & Test Series Statistics Banner ──────────── */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-bold text-white">{selected.titleEn}</h3>
                    <span
                      className={`text-[11px] font-medium ${
                        selected.isActive ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      • {selected.isActive ? "Visible to students" : "Hidden from students"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-bengali mt-0.5">{selected.titleBn}</p>
                  {selected.descriptionEn && (
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                      {selected.descriptionEn}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFormMode("edit")}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit Exam Settings
                  </button>
                  <button
                    onClick={() =>
                      setCascadeTarget({
                        kind: "exam",
                        slug: selected.slug,
                        label: selected.titleEn,
                        details: `This will cascade-delete the entire exam "${selected.titleEn}", all ${tree?.subjects.length ?? 0} subjects, ${totalSubtopics} topics, ${selected.questionCount} bank questions, and ${selectedOverview?.seriesCount ?? 0} test series.`,
                      })
                    }
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/25 rounded-lg cursor-pointer"
                    title="Cascade & delete this exam category"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Exam
                  </button>
                </div>
              </div>

              {/* Category-Wide Live Test Series & Student Statistics KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-slate-800/80 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                  <span className="block text-[11px] text-slate-400">Test Series in Category</span>
                  <span className="text-sm font-bold font-mono text-white">
                    {selectedOverview?.seriesCount ?? 0} Series
                  </span>
                  <span className="block text-[11px] text-emerald-400 mt-0.5">
                    {selectedOverview?.publishedSeriesCount ?? 0} Published ·{" "}
                    {(selectedOverview?.seriesCount ?? 0) -
                      (selectedOverview?.publishedSeriesCount ?? 0)}{" "}
                    Draft
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                  <span className="block text-[11px] text-slate-400">Series Questions Set</span>
                  <span className="text-sm font-bold font-mono text-sky-300">
                    {selectedOverview?.assignedQuestions ?? 0} /{" "}
                    {selectedOverview?.targetQuestions || selected.totalQuestions} Qs
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    {selected.questionCount} Qs in Exam Bank
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                  <span className="block text-[11px] text-slate-400">Students Attempted</span>
                  <span className="text-sm font-bold font-mono text-amber-300">
                    {selectedOverview?.totalStudentsAttempted ?? 0} Students
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    {selectedOverview?.totalAttempts ?? 0} Total Attempts
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                  <span className="block text-[11px] text-slate-400">Category Average Score</span>
                  <span className="text-sm font-bold font-mono text-emerald-400">
                    {selectedOverview?.averageScore !== null &&
                    selectedOverview?.averageScore !== undefined
                      ? `${selectedOverview.averageScore} marks`
                      : "No attempts yet"}
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    Target Cutoff: {selected.estimatedCutoffMarks} marks
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                  <span className="block text-[11px] text-slate-400">Default Exam Pattern</span>
                  <span className="text-sm font-bold font-mono text-white">
                    {selected.totalQuestions} MCQs · {selected.durationMinutes}m
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    <span className="text-emerald-400">+{selected.marksPerCorrect}</span> /{" "}
                    <span className="text-rose-400">−{selected.negativeMarksPerWrong}</span>
                  </span>
                </div>
              </div>

              {/* Per-Test-Series Breakdown Banner Table */}
              <div className="pt-2 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
                    Test Series Breakdown in {selected.titleEn} (
                    {selectedOverview?.seriesStats?.length ?? 0})
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Live question count, student participation &amp; average score per test series
                  </span>
                </div>

                {!selectedOverview ||
                !selectedOverview.seriesStats ||
                selectedOverview.seriesStats.length === 0 ? (
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400">
                    No test series created for <strong>{selected.titleEn}</strong> yet. Open the{" "}
                    <strong>Test Series</strong> tab to create mock tests or import full question
                    papers.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400 bg-slate-900/60">
                          <th className="text-left py-2 px-3 font-semibold">Test Series Name</th>
                          <th className="text-left py-2 px-3 font-semibold">Type &amp; Status</th>
                          <th className="text-right py-2 px-3 font-semibold">
                            Number of Questions
                          </th>
                          <th className="text-right py-2 px-3 font-semibold">
                            Students Attempted
                          </th>
                          <th className="text-right py-2 px-3 font-semibold">Average Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {selectedOverview.seriesStats.map((st) => (
                          <tr key={st.id} className="hover:bg-slate-900/40">
                            <td className="py-2 px-3 font-medium text-white">
                              <span>{st.name.en}</span>
                              {st.name.bn && st.name.bn !== st.name.en && (
                                <span className="block text-[11px] font-bengali text-slate-400">
                                  {st.name.bn}
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-300">
                              <span className="inline-block px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-200 mr-1.5">
                                {SERIES_KIND_LABELS[st.kind]}
                              </span>
                              <span
                                className={`text-[11px] font-medium ${
                                  st.status === "published"
                                    ? "text-emerald-400"
                                    : st.status === "draft"
                                      ? "text-amber-300"
                                      : "text-slate-500"
                                }`}
                              >
                                • {st.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-sky-300">
                              {st.selectedCount} / {st.totalQuestions} Qs
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-amber-300">
                              <span className="inline-flex items-center gap-1">
                                <Users className="w-3 h-3 text-amber-400" />
                                {st.studentCount} student{st.studentCount === 1 ? "" : "s"}
                              </span>
                              <span className="block text-[10px] text-slate-400">
                                ({st.attemptCount} attempt{st.attemptCount === 1 ? "" : "s"})
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono">
                              {st.averageScore !== null ? (
                                <span className="text-emerald-400 font-semibold">
                                  {st.averageScore} / {st.maxMarks}
                                </span>
                              ) : (
                                <span className="text-slate-500">No attempts</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* ── Syllabus Action Bar (AI / Guided Entry / CSV / Cascade Delete) ── */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    Exam Syllabus ({tree?.subjects.length ?? 0} Subjects · {totalChapters} Chapters ·{" "}
                    {totalSubtopics} Topics)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                    Build or edit the complete syllabus for <strong>{selected.titleEn}</strong>. Use{" "}
                    <strong>Generate Syllabus with AI</strong> for a complete 1-click setup,{" "}
                    <strong>Add Subject / Topic</strong> for guided manual entry with presets, or
                    use the edit/delete buttons on any subject, chapter, or subtopic below.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setActiveTool(activeTool === "ai" ? null : "ai")}
                    className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                      activeTool === "ai"
                        ? "bg-violet-500 text-white"
                        : "bg-violet-500/90 hover:bg-violet-500 text-white"
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Generate Syllabus with AI
                  </button>

                  <button
                    onClick={() => setActiveTool(activeTool === "manual" ? null : "manual")}
                    className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                      activeTool === "manual"
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-emerald-500/90 hover:bg-emerald-400 text-slate-950"
                    }`}
                  >
                    <FolderPlus className="w-3.5 h-3.5" /> + Add Subject / Topic
                  </button>

                  <button
                    onClick={() => setActiveTool(activeTool === "csv" ? null : "csv")}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                      activeTool === "csv"
                        ? "bg-slate-700 text-white"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" /> Excel / CSV
                  </button>

                  {tree && tree.subjects.length > 0 && (
                    <button
                      onClick={() =>
                        setCascadeTarget({
                          kind: "entire_syllabus",
                          slug: selected.slug,
                          label: `${selected.titleEn} Syllabus`,
                          details: `This will cascade-delete all ${tree.subjects.length} subjects, ${totalChapters} chapters, ${totalSubtopics} subtopics, and all ${selected.questionCount} questions linked to this syllabus so you can start fresh.`,
                        })
                      }
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/25 rounded-lg cursor-pointer transition-colors"
                      title="Cascade delete all subjects, topics, and linked questions in this syllabus"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete Entire Syllabus
                    </button>
                  )}
                </div>
              </div>

              {/* ── Tool 1: AI Bulk Syllabus Generator ─────────────────── */}
              {activeTool === "ai" && (
                <AiSyllabusBuilder
                  exam={selected}
                  tree={tree}
                  existingSubjects={tree?.subjects.map((s) => s.name.en) ?? []}
                  onClose={() => setActiveTool(null)}
                  onTreeUpdated={async (updatedTree, msg) => {
                    setTree(updatedTree);
                    await reloadExams();
                    await loadOverview();
                    if (msg) setNotice({ kind: "success", text: msg });
                  }}
                  onGenerated={async (updatedTree, result, modelUsed, skippedDuplicates) => {
                    setTree(updatedTree);
                    await reloadExams();
                    await loadOverview();
                    setActiveTool(null);
                    const added = result.created.subjects + result.created.chapters + result.created.subtopics;
                    setNotice({
                      kind: added ? "success" : "info",
                      text: added
                        ? `AI (${modelUsed}) added ${result.created.subjects} subjects, ${result.created.chapters} chapters and ${result.created.subtopics} subtopics that were missing` +
                          (skippedDuplicates ? ` · ${skippedDuplicates} already existed (same concept) and were skipped.` : ".")
                        : `Nothing new: everything the AI suggested already exists in this syllabus${skippedDuplicates ? ` (${skippedDuplicates} duplicates skipped)` : ""}.`,
                    });
                  }}
                  onError={(msg) => setNotice({ kind: "error", text: msg })}
                />
              )}

              {/* ── Tool 2: Guided Manual / Preset Builder ─────────────── */}
              {activeTool === "manual" && tree && (
                <GuidedNodeBuilder
                  exam={selected}
                  tree={tree}
                  onClose={() => setActiveTool(null)}
                  onSaved={async (updatedTree, msg) => {
                    setTree(updatedTree);
                    await reloadExams();
                    await loadOverview();
                    setNotice({ kind: "success", text: msg });
                  }}
                  onError={(msg) => setNotice({ kind: "error", text: msg })}
                />
              )}

              {/* ── Tool 3: CSV Upload & Download ──────────────────────── */}
              {activeTool === "csv" && (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-white">
                      Import or Export Syllabus via Excel (.csv)
                    </h4>
                    <button
                      onClick={() => setActiveTool(null)}
                      className="text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Download the sample template, edit in Excel or Google Sheets, and upload. Existing
                    topics are matched automatically so nothing gets duplicated.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() =>
                        downloadCsv(
                          "syllabus-template.csv",
                          toCsv(SYLLABUS_TEMPLATE_EXAMPLES, SYLLABUS_CSV_COLUMNS)
                        )
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" /> Download Sample CSV
                    </button>
                    {tree && tree.subjects.length > 0 && (
                      <button
                        onClick={downloadCurrentSyllabus}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" /> Export Current Syllabus ({totalSubtopics}{" "}
                        topics)
                      </button>
                    )}
                    <label className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      {uploading ? "Uploading…" : "Upload CSV File"}
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleSyllabusFile}
                        disabled={uploading}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* ── Interactive Editable Syllabus Tree ─────────────────── */}
              {!tree ? (
                <p className="text-xs text-slate-500 py-6 text-center">Loading syllabus…</p>
              ) : tree.subjects.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-slate-800 bg-slate-950/60 text-center space-y-3">
                  <BookOpen className="w-8 h-8 text-amber-400 mx-auto opacity-80" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">
                      No syllabus added for {selected.titleEn} yet
                    </p>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      Click <strong>Generate Syllabus with AI</strong> to automatically populate all
                      Mathematics, History, Geography, Polity, Science, Current Affairs, Reasoning,
                      and English topics in one click.
                    </p>
                  </div>
                  <div className="flex justify-center gap-2 pt-1">
                    <button
                      onClick={() => setActiveTool("ai")}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-violet-500 hover:bg-violet-400 text-white rounded-lg cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Generate Syllabus with AI
                    </button>
                    <button
                      onClick={() => setActiveTool("manual")}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Manually with Presets
                    </button>
                  </div>
                </div>
              ) : (
                <EditableSyllabusTree
                  exam={selected}
                  tree={tree}
                  onRequestCascadeDelete={(target) => setCascadeTarget(target)}
                  onTreeUpdated={async (updated, message) => {
                    setTree(updated);
                    await reloadExams();
                    await loadOverview();
                    if (message) setNotice({ kind: "success", text: message });
                  }}
                  onError={(msg) => setNotice({ kind: "error", text: msg })}
                />
              )}
            </div>
          </>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
            <p className="text-xs text-slate-400">
              Select an exam on the left or click “Create New Exam” to begin.
            </p>
          </div>
        )}
      </div>

      {/* ── Cascade & Delete Confirmation Modal ───────────────────────── */}
      {cascadeTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/40 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white">
                  Cascade &amp; Delete “{cascadeTarget.label}”?
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">{cascadeTarget.details}</p>
                <p className="text-[11px] text-rose-300 font-medium pt-1">
                  All child topics, linked questions in the Question Bank, and test series slots
                  referencing this item will be automatically cascade-deleted.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={cascadeBusy}
                onClick={() => setCascadeTarget(null)}
                className="px-3.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={cascadeBusy}
                onClick={executeCascadeDelete}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {cascadeBusy ? "Cascade Deleting…" : "Yes, Cascade & Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 1. AI Bulk Syllabus Generator Component (with Add, Edit & Delete Subject)
// ============================================================================

function AiSyllabusBuilder({
  exam,
  tree,
  existingSubjects,
  onClose,
  onTreeUpdated,
  onGenerated,
  onError,
}: {
  exam: ExamDto;
  tree: SyllabusTreeDto | undefined;
  /** Subjects the exam already has — pre-selected so the AI fills their gaps */
  existingSubjects: string[];
  onClose: () => void;
  onTreeUpdated: (tree: SyllabusTreeDto, message?: string) => Promise<void>;
  onGenerated: (
    tree: SyllabusTreeDto,
    result: SyllabusUploadResult,
    modelUsed: string,
    skippedDuplicates: number
  ) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(
    () => new Set(existingSubjects)
  );
  // Track custom/renamed preset items and hidden preset names so every item in the list is editable & deletable
  const [customPresets, setCustomPresets] = useState<Array<{ en: string; bn: string }>>([]);
  const [hiddenPresetNames, setHiddenPresetNames] = useState<Set<string>>(() => new Set());
  const [customSubject, setCustomSubject] = useState("");
  const [customSubjectBn, setCustomSubjectBn] = useState("");
  const [addingSubject, setAddingSubject] = useState(false);
  const [editingSubjectKey, setEditingSubjectKey] = useState<string | null>(null);
  const [editEn, setEditEn] = useState("");
  const [editBn, setEditBn] = useState("");
  const [subjectBusy, setSubjectBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Merge DB subjects + default WBPSC presets + custom added subjects into one unified list
  const subjectItems = useMemo(() => {
    const list: Array<{ id?: string; en: string; bn: string; questionCount?: number }> = [];
    const seen = new Set<string>();

    // First include all presets that haven't been deleted/hidden, attaching DB id if present in tree
    for (const p of WBPSC_SUBJECT_PRESETS) {
      if (hiddenPresetNames.has(p.en.toLowerCase())) continue;
      const dbMatch = tree?.subjects.find(
        (s) => s.name.en.toLowerCase() === p.en.toLowerCase()
      );
      const qCount = dbMatch
        ? dbMatch.chapters.reduce(
            (n, c) => n + c.subtopics.reduce((m, t) => m + t.questionCount, 0),
            0
          )
        : 0;
      seen.add(p.en.toLowerCase());
      if (dbMatch) seen.add(dbMatch.name.en.toLowerCase());
      list.push({
        id: dbMatch?.id,
        en: dbMatch?.name.en ?? p.en,
        bn: dbMatch?.name.bn || p.bn,
        questionCount: qCount,
      });
    }

    // Next include any DB subjects in tree not already in WBPSC_SUBJECT_PRESETS
    for (const s of tree?.subjects ?? []) {
      const key = s.name.en.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const qCount = s.chapters.reduce(
        (n, c) => n + c.subtopics.reduce((m, t) => m + t.questionCount, 0),
        0
      );
      list.push({
        id: s.id,
        en: s.name.en,
        bn: s.name.bn,
        questionCount: qCount,
      });
    }

    // Finally include any custom added subjects not yet in DB
    for (const c of customPresets) {
      const key = c.en.toLowerCase();
      if (seen.has(key) || hiddenPresetNames.has(key)) continue;
      seen.add(key);
      list.push({ en: c.en, bn: c.bn });
    }

    return list;
  }, [tree?.subjects, customPresets, hiddenPresetNames]);

  const toggleSubject = (name: string) => {
    setSelectedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Add a new subject: immediately displays in the grid AND saves to the exam's syllabus in DB
  const handleAddCustom = async () => {
    const trimmed = customSubject.trim();
    if (!trimmed) return;
    const trimmedBn = customSubjectBn.trim();

    // Ensure it isn't hidden if it was previously removed
    setHiddenPresetNames((prev) => {
      const next = new Set(prev);
      next.delete(trimmed.toLowerCase());
      return next;
    });
    setCustomPresets((prev) => [
      ...prev.filter((p) => p.en.toLowerCase() !== trimmed.toLowerCase()),
      { en: trimmed, bn: trimmedBn },
    ]);
    setSelectedSubjects((prev) => new Set([...prev, trimmed]));
    setCustomSubject("");
    setCustomSubjectBn("");

    setAddingSubject(true);
    try {
      const res = await adminApi<{ tree: SyllabusTreeDto }>(
        `/syllabus/exams/${exam.slug}/nodes`,
        {
          method: "POST",
          body: {
            subjectEn: trimmed,
            subjectBn: trimmedBn || undefined,
            chapterEn: `${trimmed} — Core Topics`,
            subtopicEn: `${trimmed} — Fundamentals & Practice`,
          },
        }
      );
      await onTreeUpdated(res.tree, `Added subject "${trimmed}" to ${exam.titleEn} syllabus.`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setAddingSubject(false);
    }
  };

  const handleSaveSubjectEdit = async (item: { id?: string; en: string; bn: string }) => {
    const nextEn = editEn.trim();
    const nextBn = editBn.trim();
    if (!nextEn) return;

    setSubjectBusy(item.en);
    try {
      if (item.id) {
        const res = await adminApi<{ tree: SyllabusTreeDto }>(`/syllabus/subjects/${item.id}`, {
          method: "PATCH",
          body: {
            nameEn: nextEn,
            nameBn: nextBn || undefined,
          },
        });
        await onTreeUpdated(res.tree, `Renamed subject "${item.en}" to "${nextEn}".`);
      } else {
        // Rename preset/custom item and persist to DB so it's saved
        setHiddenPresetNames((prev) => new Set([...prev, item.en.toLowerCase()]));
        setCustomPresets((prev) => [
          ...prev.filter(
            (p) =>
              p.en.toLowerCase() !== item.en.toLowerCase() &&
              p.en.toLowerCase() !== nextEn.toLowerCase()
          ),
          { en: nextEn, bn: nextBn },
        ]);
        const res = await adminApi<{ tree: SyllabusTreeDto }>(
          `/syllabus/exams/${exam.slug}/nodes`,
          {
            method: "POST",
            body: {
              subjectEn: nextEn,
              subjectBn: nextBn || undefined,
              chapterEn: `${nextEn} — Core Topics`,
              subtopicEn: `${nextEn} — Fundamentals & Practice`,
            },
          }
        );
        await onTreeUpdated(res.tree, `Saved subject "${nextEn}" to syllabus.`);
      }

      setSelectedSubjects((prev) => {
        const next = new Set(prev);
        if (next.has(item.en)) {
          next.delete(item.en);
          next.add(nextEn);
        }
        return next;
      });
      setEditingSubjectKey(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSubjectBusy(null);
    }
  };

  const handleDeleteSubjectItem = async (item: { id?: string; en: string; bn: string }) => {
    setSubjectBusy(item.en);
    try {
      if (item.id) {
        const res = await adminApi<{
          deleted: boolean;
          deletedQuestions?: number;
          tree: SyllabusTreeDto | null;
        }>(`/syllabus/subjects/${item.id}`, {
          method: "DELETE",
        });
        if (res.tree) {
          await onTreeUpdated(
            res.tree,
            `Deleted subject "${item.en}"${
              res.deletedQuestions ? ` and ${res.deletedQuestions} linked question(s).` : "."
            }`
          );
        }
      }
      setHiddenPresetNames((prev) => new Set([...prev, item.en.toLowerCase()]));
      setCustomPresets((prev) =>
        prev.filter((p) => p.en.toLowerCase() !== item.en.toLowerCase())
      );
      setSelectedSubjects((prev) => {
        const next = new Set(prev);
        next.delete(item.en);
        return next;
      });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSubjectBusy(null);
    }
  };

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const res = await adminApi<{
        result: SyllabusUploadResult;
        tree: SyllabusTreeDto;
        modelUsed: string;
        skippedDuplicates?: number;
      }>(`/syllabus/exams/${exam.slug}/generate-ai`, {
        method: "POST",
        body: {
          subjectsFocus: [...selectedSubjects],
        },
      });
      await onGenerated(res.tree, res.result, res.modelUsed, res.skippedDuplicates ?? 0);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 rounded-xl bg-violet-950/20 border border-violet-500/40 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-violet-300" />
            AI Bulk Syllabus Generator for {exam.titleEn}
          </h4>
          <p className="text-xs text-slate-300 mt-1">
            AI builds the complete bilingual (English + বাংলা) <strong>Subjects → Chapters →
            Subtopics</strong> tree for this exam. You can also <strong>+ Add</strong> a new subject,
            or click the <strong>Edit (Pencil)</strong> / <strong>Delete (Trash)</strong> icons on
            any subject card below.
          </p>
        </div>
        <button
          onClick={onClose}
          disabled={busy}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-300 font-medium">
            Included Subjects ({selectedSubjects.size} selected of {subjectItems.length})
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setSelectedSubjects(new Set(subjectItems.map((s) => s.en)))}
              className="text-violet-300 hover:underline cursor-pointer"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => setSelectedSubjects(new Set())}
              className="text-slate-400 hover:underline cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {subjectItems.map((item) => {
            const checked = selectedSubjects.has(item.en);
            const isEditing = editingSubjectKey === item.en;
            const isBusy = subjectBusy === item.en;

            if (isEditing) {
              return (
                <div
                  key={item.en}
                  className="p-2.5 rounded-lg border border-amber-500/50 bg-slate-950 space-y-2 text-xs"
                >
                  <input
                    value={editEn}
                    onChange={(e) => setEditEn(e.target.value)}
                    placeholder="Subject Name (English) *"
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white"
                  />
                  <input
                    value={editBn}
                    onChange={(e) => setEditBn(e.target.value)}
                    placeholder="বিষয়ের নাম (বাংলা — optional)"
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white font-bengali"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy || !editEn.trim()}
                      onClick={() => handleSaveSubjectEdit(item)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded cursor-pointer"
                    >
                      <Check className="w-3 h-3" /> {isBusy ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSubjectKey(null)}
                      className="px-2 py-1 text-slate-400 hover:text-white cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={item.en}
                className={`flex items-start justify-between gap-2 p-2.5 rounded-lg border text-xs transition-colors ${
                  checked
                    ? "bg-violet-500/15 border-violet-500/40 text-white"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <label className="flex items-start gap-2.5 flex-1 min-w-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSubject(item.en)}
                    disabled={busy || isBusy}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <span className="block font-medium truncate" title={item.en}>
                      {item.en}
                    </span>
                    {item.bn && (
                      <span className="block text-[11px] font-bengali text-slate-400 truncate">
                        {item.bn}
                      </span>
                    )}
                    {item.id && (
                      <span className="inline-block text-[10px] text-emerald-400 mt-0.5">
                        Saved in Syllabus
                        {item.questionCount ? ` · ${item.questionCount} Qs` : ""}
                      </span>
                    )}
                  </div>
                </label>

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={busy || isBusy}
                    onClick={() => {
                      setEditingSubjectKey(item.en);
                      setEditEn(item.en);
                      setEditBn(item.bn || "");
                    }}
                    className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                    title={`Edit "${item.en}"`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy || isBusy}
                    onClick={() => handleDeleteSubjectItem(item)}
                    className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 cursor-pointer"
                    title={
                      item.id
                        ? `Cascade delete "${item.en}" from syllabus`
                        : `Remove "${item.en}" from list`
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom subject input — adds to list AND saves directly into syllabus */}
        <div className="flex flex-wrap gap-2 pt-1">
          <input
            value={customSubject}
            onChange={(e) => setCustomSubject(e.target.value)}
            placeholder="Add another subject (e.g. Computer Literacy)…"
            disabled={busy || addingSubject}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCustom();
              }
            }}
            className="flex-1 min-w-[220px] max-w-sm px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
          <input
            value={customSubjectBn}
            onChange={(e) => setCustomSubjectBn(e.target.value)}
            placeholder="বাংলা নাম (optional — auto-translated)"
            disabled={busy || addingSubject}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCustom();
              }
            }}
            className="flex-1 min-w-[180px] max-w-xs px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white font-bengali"
          />
          <button
            type="button"
            onClick={handleAddCustom}
            disabled={busy || addingSubject || !customSubject.trim()}
            className="px-3.5 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
          >
            {addingSubject ? "Adding…" : "+ Add Subject"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white rounded-lg cursor-pointer"
        >
          <Sparkles className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
          {busy
            ? "Generating missing syllabus… (15–60s)"
            : selectedSubjects.size
              ? `Generate missing parts (${selectedSubjects.size} subjects)`
              : "Generate missing parts (AI picks the exam's subjects)"}
        </button>
        <span className="text-[11px] text-slate-400">
          Includes English &amp; Bengali names for all subjects, chapters, and topics.
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// 2. Guided Manual / Pre-populated Node Builder (No technical slugs required!)
// ============================================================================

function GuidedNodeBuilder({
  exam,
  tree,
  onClose,
  onSaved,
  onError,
}: {
  exam: ExamDto;
  tree: SyllabusTreeDto;
  onClose: () => void;
  onSaved: (tree: SyllabusTreeDto, message: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [subjectEn, setSubjectEn] = useState("");
  const [subjectBn, setSubjectBn] = useState("");
  const [chapterEn, setChapterEn] = useState("");
  const [chapterBn, setChapterBn] = useState("");
  const [subtopicEn, setSubtopicEn] = useState("");
  const [subtopicBn, setSubtopicBn] = useState("");
  const [saving, setSaving] = useState(false);

  // Match selected subject in presets or existing tree to offer smart chapter & subtopic suggestions
  const matchedPresetSubject = useMemo(
    () =>
      WBPSC_SUBJECT_PRESETS.find(
        (s) => s.en.toLowerCase() === subjectEn.trim().toLowerCase()
      ),
    [subjectEn]
  );

  const matchedExistingSubject = useMemo(
    () =>
      tree.subjects.find((s) => s.name.en.toLowerCase() === subjectEn.trim().toLowerCase()),
    [tree.subjects, subjectEn]
  );

  const matchedPresetChapter = useMemo(
    () =>
      matchedPresetSubject?.chapters.find(
        (c) => c.en.toLowerCase() === chapterEn.trim().toLowerCase()
      ),
    [matchedPresetSubject, chapterEn]
  );

  const handlePickPresetSubject = (en: string) => {
    setSubjectEn(en);
    const preset = WBPSC_SUBJECT_PRESETS.find((s) => s.en === en);
    const existing = tree.subjects.find((s) => s.name.en === en);
    if (existing) {
      setSubjectBn(existing.name.bn);
    } else if (preset) {
      setSubjectBn(preset.bn);
      if (preset.chapters[0]) {
        setChapterEn(preset.chapters[0].en);
        setChapterBn(preset.chapters[0].bn);
        if (preset.chapters[0].subtopics[0]) {
          setSubtopicEn(preset.chapters[0].subtopics[0].en);
          setSubtopicBn(preset.chapters[0].subtopics[0].bn);
        }
      }
    }
  };

  const handlePickPresetChapter = (en: string) => {
    setChapterEn(en);
    const presetChap = matchedPresetSubject?.chapters.find((c) => c.en === en);
    const existingChap = matchedExistingSubject?.chapters.find((c) => c.name.en === en);
    if (existingChap) {
      setChapterBn(existingChap.name.bn);
    } else if (presetChap) {
      setChapterBn(presetChap.bn);
      if (presetChap.subtopics[0]) {
        setSubtopicEn(presetChap.subtopics[0].en);
        setSubtopicBn(presetChap.subtopics[0].bn);
      }
    }
  };

  const handlePickPresetSubtopic = (en: string) => {
    setSubtopicEn(en);
    const presetSub = matchedPresetChapter?.subtopics.find((t) => t.en === en);
    if (presetSub) {
      setSubtopicBn(presetSub.bn);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectEn.trim() || !chapterEn.trim() || !subtopicEn.trim()) {
      onError("Please provide Subject, Chapter, and Topic in English.");
      return;
    }
    setSaving(true);
    try {
      const res = await adminApi<{ tree: SyllabusTreeDto }>(
        `/syllabus/exams/${exam.slug}/nodes`,
        {
          method: "POST",
          body: {
            subjectEn: subjectEn.trim(),
            subjectBn: subjectBn.trim() || undefined,
            chapterEn: chapterEn.trim(),
            chapterBn: chapterBn.trim() || undefined,
            subtopicEn: subtopicEn.trim(),
            subtopicBn: subtopicBn.trim() || undefined,
          },
        }
      );
      await onSaved(
        res.tree,
        `Added "${subtopicEn.trim()}" under ${subjectEn.trim()} → ${chapterEn.trim()}.`
      );
      setSubtopicEn("");
      setSubtopicBn("");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white";

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 rounded-xl bg-emerald-950/15 border border-emerald-500/35 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
            <FolderPlus className="w-4 h-4 text-emerald-400" />
            Add Subject, Chapter &amp; Topic (Guided Builder)
          </h4>
          <p className="text-xs text-slate-300 mt-0.5">
            Click a pre-populated preset chip below or type your own.{" "}
            <strong>Bengali fields are optional</strong> — if left blank, they are automatically
            translated into Bengali when you save!
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Step 1: Quick Subject Presets */}
      <div className="space-y-2">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
          Step 1: Pick or Type a Subject
        </span>
        <div className="flex flex-wrap gap-1.5">
          {WBPSC_SUBJECT_PRESETS.map((s) => (
            <button
              key={s.en}
              type="button"
              onClick={() => handlePickPresetSubject(s.en)}
              className={`px-2.5 py-1 text-[11px] rounded-md border cursor-pointer transition-colors ${
                subjectEn === s.en
                  ? "bg-emerald-500 text-slate-950 border-emerald-400 font-semibold"
                  : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
              }`}
            >
              {s.en}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <label className="text-xs text-slate-300 space-y-1">
            <span>Subject Name (English) *</span>
            <input
              required
              value={subjectEn}
              onChange={(e) => setSubjectEn(e.target.value)}
              placeholder="e.g. Arithmetic & Quantitative Aptitude"
              className={inputCls}
            />
          </label>
          <label className="text-xs text-slate-300 space-y-1">
            <span>বিষয়ের নাম (বাংলা — optional, auto-translated if blank)</span>
            <input
              value={subjectBn}
              onChange={(e) => setSubjectBn(e.target.value)}
              placeholder="স্বয়ংক্রিয় বাংলা অনুবাদ"
              className={`${inputCls} font-bengali`}
            />
          </label>
        </div>
      </div>

      {/* Step 2: Chapter */}
      <div className="space-y-2">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
          Step 2: Pick or Type a Chapter
        </span>
        {(matchedPresetSubject || matchedExistingSubject) && (
          <div className="flex flex-wrap gap-1.5">
            {matchedPresetSubject?.chapters.map((c) => (
              <button
                key={c.en}
                type="button"
                onClick={() => handlePickPresetChapter(c.en)}
                className={`px-2.5 py-1 text-[11px] rounded-md border cursor-pointer ${
                  chapterEn === c.en
                    ? "bg-emerald-500 text-slate-950 border-emerald-400 font-semibold"
                    : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                {c.en}
              </button>
            ))}
            {matchedExistingSubject?.chapters
              .filter(
                (ec) =>
                  !matchedPresetSubject?.chapters.some(
                    (pc) => pc.en.toLowerCase() === ec.name.en.toLowerCase()
                  )
              )
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setChapterEn(c.name.en);
                    setChapterBn(c.name.bn);
                  }}
                  className={`px-2.5 py-1 text-[11px] rounded-md border cursor-pointer ${
                    chapterEn === c.name.en
                      ? "bg-emerald-500 text-slate-950 border-emerald-400 font-semibold"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  {c.name.en}
                </button>
              ))}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <label className="text-xs text-slate-300 space-y-1">
            <span>Chapter Name (English) *</span>
            <input
              required
              value={chapterEn}
              onChange={(e) => setChapterEn(e.target.value)}
              placeholder="e.g. Commercial Mathematics"
              className={inputCls}
            />
          </label>
          <label className="text-xs text-slate-300 space-y-1">
            <span>অধ্যায়ের নাম (বাংলা — optional, auto-translated if blank)</span>
            <input
              value={chapterBn}
              onChange={(e) => setChapterBn(e.target.value)}
              placeholder="স্বয়ংক্রিয় বাংলা অনুবাদ"
              className={`${inputCls} font-bengali`}
            />
          </label>
        </div>
      </div>

      {/* Step 3: Topic / Subtopic */}
      <div className="space-y-2">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
          Step 3: Pick or Type a Topic (Subtopic)
        </span>
        {matchedPresetChapter && (
          <div className="flex flex-wrap gap-1.5">
            {matchedPresetChapter.subtopics.map((t) => (
              <button
                key={t.en}
                type="button"
                onClick={() => handlePickPresetSubtopic(t.en)}
                className={`px-2.5 py-1 text-[11px] rounded-md border cursor-pointer ${
                  subtopicEn === t.en
                    ? "bg-emerald-500 text-slate-950 border-emerald-400 font-semibold"
                    : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                {t.en}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <label className="text-xs text-slate-300 space-y-1">
            <span>Topic Name (English) *</span>
            <input
              required
              value={subtopicEn}
              onChange={(e) => setSubtopicEn(e.target.value)}
              placeholder="e.g. Profit, Loss & Discount"
              className={inputCls}
            />
          </label>
          <label className="text-xs text-slate-300 space-y-1">
            <span>টপিকের নাম (বাংলা — optional, auto-translated if blank)</span>
            <input
              value={subtopicBn}
              onChange={(e) => setSubtopicBn(e.target.value)}
              placeholder="স্বয়ংক্রিয় বাংলা অনুবাদ"
              className={`${inputCls} font-bengali`}
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {saving ? "Saving & Translating…" : "Save to Syllabus"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
        >
          Done
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// 3. Interactive Editable Syllabus Tree (Full CRUD: Edit, Add Child, Delete)
// ============================================================================

type EditingNode = {
  kind: "subject" | "chapter" | "subtopic";
  id: string;
  nameEn: string;
  nameBn: string;
  weightageQuestions?: number;
};

type QuickAddChild = {
  kind: "chapter" | "subtopic";
  parentId: string;
  subjectEn: string;
  subjectBn: string;
  chapterEn: string;
  chapterBn: string;
};

function EditableSyllabusTree({
  exam,
  tree,
  onRequestCascadeDelete,
  onTreeUpdated,
  onError,
}: {
  exam: ExamDto;
  tree: SyllabusTreeDto;
  onRequestCascadeDelete: (target: CascadeDeleteTarget) => void;
  onTreeUpdated: (tree: SyllabusTreeDto, message?: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(
    () => new Set(tree.subjects.slice(0, 3).map((s) => s.id))
  );
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EditingNode | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddChild | null>(null);
  const [quickEn, setQuickEn] = useState("");
  const [quickBn, setQuickBn] = useState("");
  const [quickSubEn, setQuickSubEn] = useState("");
  const [quickSubBn, setQuickSubBn] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleSubject = (id: string) =>
    setOpenSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filteredSubjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tree.subjects;
    return tree.subjects
      .map((s) => {
        const subjMatches =
          s.name.en.toLowerCase().includes(q) || s.name.bn.toLowerCase().includes(q);
        if (subjMatches) return s;
        const chapters = s.chapters
          .map((c) => {
            const chapMatches =
              c.name.en.toLowerCase().includes(q) || c.name.bn.toLowerCase().includes(q);
            if (chapMatches) return c;
            const subtopics = c.subtopics.filter(
              (t) =>
                t.name.en.toLowerCase().includes(q) || t.name.bn.toLowerCase().includes(q)
            );
            return subtopics.length > 0 ? { ...c, subtopics } : null;
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);
        return chapters.length > 0 ? { ...s, chapters } : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [tree.subjects, search]);

  const handleSaveEdit = async () => {
    if (!editing || !editing.nameEn.trim()) return;
    setBusyId(editing.id);
    try {
      const endpoint =
        editing.kind === "subject"
          ? `/syllabus/subjects/${editing.id}`
          : editing.kind === "chapter"
            ? `/syllabus/chapters/${editing.id}`
            : `/syllabus/subtopics/${editing.id}`;
      const { tree: updated } = await adminApi<{ tree: SyllabusTreeDto }>(endpoint, {
        method: "PATCH",
        body: {
          nameEn: editing.nameEn.trim(),
          nameBn: editing.nameBn.trim() || undefined,
          ...(editing.kind === "subject" && editing.weightageQuestions !== undefined
            ? { weightageQuestions: editing.weightageQuestions }
            : {}),
        },
      });
      setEditing(null);
      await onTreeUpdated(updated, `Updated "${editing.nameEn.trim()}".`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteNode = (
    kind: "subject" | "chapter" | "subtopic",
    id: string,
    label: string,
    details: string
  ) => {
    onRequestCascadeDelete({
      kind,
      id,
      label,
      details,
    });
  };

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAdd || !quickEn.trim()) return;
    setBusyId(quickAdd.parentId);
    try {
      const body =
        quickAdd.kind === "subtopic"
          ? {
              subjectEn: quickAdd.subjectEn,
              subjectBn: quickAdd.subjectBn,
              chapterEn: quickAdd.chapterEn,
              chapterBn: quickAdd.chapterBn,
              subtopicEn: quickEn.trim(),
              subtopicBn: quickBn.trim() || undefined,
            }
          : {
              subjectEn: quickAdd.subjectEn,
              subjectBn: quickAdd.subjectBn,
              chapterEn: quickEn.trim(),
              chapterBn: quickBn.trim() || undefined,
              subtopicEn: quickSubEn.trim() || `${quickEn.trim()} — Core Concepts`,
              subtopicBn: quickSubBn.trim() || undefined,
            };

      const { tree: updated } = await adminApi<{ tree: SyllabusTreeDto }>(
        `/syllabus/exams/${exam.slug}/nodes`,
        {
          method: "POST",
          body,
        }
      );
      setQuickAdd(null);
      setQuickEn("");
      setQuickBn("");
      setQuickSubEn("");
      setQuickSubBn("");
      await onTreeUpdated(updated, `Added "${quickEn.trim()}" to syllabus.`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Search & Expand/Collapse Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subjects, chapters, or topics (English / বাংলা)…"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setOpenSubjects(new Set(tree.subjects.map((s) => s.id)))}
            className="px-2.5 py-1 text-slate-400 hover:text-white bg-slate-950 border border-slate-800 rounded-lg cursor-pointer"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={() => setOpenSubjects(new Set())}
            className="px-2.5 py-1 text-slate-400 hover:text-white bg-slate-950 border border-slate-800 rounded-lg cursor-pointer"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Subjects Accordion */}
      <div className="space-y-2">
        {filteredSubjects.map((s) => {
          const questionCount = s.chapters.reduce(
            (n, c) => n + c.subtopics.reduce((m, t) => m + t.questionCount, 0),
            0
          );
          const topicCount = s.chapters.reduce((n, c) => n + c.subtopics.length, 0);
          const isOpen = Boolean(search.trim()) || openSubjects.has(s.id);
          const isEditingSubj = editing?.kind === "subject" && editing.id === s.id;

          return (
            <div
              key={s.id}
              className="rounded-xl border border-slate-800 bg-slate-950/90 overflow-hidden"
            >
              {/* Subject Row */}
              <div className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-900/60">
                <button
                  type="button"
                  onClick={() => toggleSubject(s.id)}
                  className="flex items-center gap-2 flex-1 text-left text-xs cursor-pointer min-w-0"
                >
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span className="font-bold text-white truncate">{s.name.en}</span>
                  <span className="font-bengali text-slate-400 truncate">· {s.name.bn}</span>
                </button>

                <span className="text-[11px] text-slate-400 shrink-0">
                  {(s.weightageQuestions ?? 0) > 0 && (
                    <span className="inline-block mr-2 px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 font-semibold">
                      Exam Pattern: {s.weightageQuestions} Qs/test
                    </span>
                  )}
                  {s.chapters.length} chapters · {topicCount} topics ·{" "}
                  <strong className="text-slate-300">{questionCount} Q in bank</strong>
                </span>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenSubjects((prev) => new Set([...prev, s.id]));
                      setQuickAdd({
                        kind: "chapter",
                        parentId: s.id,
                        subjectEn: s.name.en,
                        subjectBn: s.name.bn,
                        chapterEn: "",
                        chapterBn: "",
                      });
                      setQuickEn("");
                      setQuickBn("");
                      setQuickSubEn("");
                      setQuickSubBn("");
                    }}
                    className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded cursor-pointer"
                    title="Add a new chapter to this subject"
                  >
                    + Chapter
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        kind: "subject",
                        id: s.id,
                        nameEn: s.name.en,
                        nameBn: s.name.bn,
                        weightageQuestions: s.weightageQuestions ?? 0,
                      })
                    }
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    title="Rename subject or edit questions per test"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() =>
                      handleDeleteNode(
                        "subject",
                        s.id,
                        s.name.en,
                        `Delete subject "${s.name.en}" along with its ${s.chapters.length} chapter(s), ${topicCount} subtopic(s), and ${questionCount} linked question(s) in the Question Bank.`
                      )
                    }
                    className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer disabled:opacity-40"
                    title="Cascade & delete subject"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Inline Edit for Subject */}
              {isEditingSubj && (
                <InlineEditBar
                  editing={editing}
                  setEditing={setEditing}
                  onSave={handleSaveEdit}
                  busy={busyId === s.id}
                />
              )}

              {/* Quick Add Chapter Form */}
              {quickAdd?.kind === "chapter" && quickAdd.parentId === s.id && (
                <form
                  onSubmit={handleQuickAddSubmit}
                  className="p-3 bg-emerald-950/20 border-t border-emerald-500/30 space-y-2 text-xs"
                >
                  <p className="font-semibold text-emerald-300">
                    Add New Chapter under {s.name.en}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      required
                      value={quickEn}
                      onChange={(e) => setQuickEn(e.target.value)}
                      placeholder="Chapter Name (English) *"
                      className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-white"
                    />
                    <input
                      value={quickBn}
                      onChange={(e) => setQuickBn(e.target.value)}
                      placeholder="অধ্যায়ের নাম (বাংলা — optional, auto-translated)"
                      className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-white font-bengali"
                    />
                    <input
                      required
                      value={quickSubEn}
                      onChange={(e) => setQuickSubEn(e.target.value)}
                      placeholder="First Topic inside this Chapter (English) *"
                      className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-white"
                    />
                    <input
                      value={quickSubBn}
                      onChange={(e) => setQuickSubBn(e.target.value)}
                      placeholder="টপিকের নাম (বাংলা — optional, auto-translated)"
                      className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-white font-bengali"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busyId === s.id}
                      className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded cursor-pointer"
                    >
                      {busyId === s.id ? "Saving…" : "Save Chapter & Topic"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickAdd(null)}
                      className="px-2.5 py-1 text-slate-400 hover:text-white cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Chapters & Subtopics */}
              {isOpen && (
                <div className="p-3 space-y-3 border-t border-slate-800/80">
                  {s.chapters.map((c) => {
                    const isEditingChap = editing?.kind === "chapter" && editing.id === c.id;
                    const chapQuestionCount = c.subtopics.reduce(
                      (m, t) => m + t.questionCount,
                      0
                    );
                    return (
                      <div
                        key={c.id}
                        className="pl-3 border-l-2 border-slate-800 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs min-w-0">
                            <span className="font-semibold text-slate-200">{c.name.en}</span>
                            <span className="font-bengali text-slate-400 ml-1.5">
                              · {c.name.bn}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setQuickAdd({
                                  kind: "subtopic",
                                  parentId: c.id,
                                  subjectEn: s.name.en,
                                  subjectBn: s.name.bn,
                                  chapterEn: c.name.en,
                                  chapterBn: c.name.bn,
                                });
                                setQuickEn("");
                                setQuickBn("");
                              }}
                              className="px-2 py-0.5 text-[11px] bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-800 rounded cursor-pointer"
                            >
                              + Subtopic
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditing({
                                  kind: "chapter",
                                  id: c.id,
                                  nameEn: c.name.en,
                                  nameBn: c.name.bn,
                                })
                              }
                              className="p-1 text-slate-500 hover:text-white cursor-pointer"
                              title="Rename chapter"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={busyId === c.id}
                              onClick={() =>
                                handleDeleteNode(
                                  "chapter",
                                  c.id,
                                  c.name.en,
                                  `Delete chapter "${c.name.en}" under ${s.name.en} along with its ${c.subtopics.length} subtopic(s) and ${chapQuestionCount} linked question(s).`
                                )
                              }
                              className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer disabled:opacity-40"
                              title="Cascade & delete chapter"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {isEditingChap && (
                          <InlineEditBar
                            editing={editing}
                            setEditing={setEditing}
                            onSave={handleSaveEdit}
                            busy={busyId === c.id}
                          />
                        )}

                        {quickAdd?.kind === "subtopic" && quickAdd.parentId === c.id && (
                          <form
                            onSubmit={handleQuickAddSubmit}
                            className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 space-y-2 text-xs"
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input
                                required
                                value={quickEn}
                                onChange={(e) => setQuickEn(e.target.value)}
                                placeholder="Subtopic name (English) *"
                                className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded text-white"
                              />
                              <input
                                value={quickBn}
                                onChange={(e) => setQuickBn(e.target.value)}
                                placeholder="টপিকের নাম (বাংলা — optional, auto-translated)"
                                className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded text-white font-bengali"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                disabled={busyId === c.id}
                                className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded cursor-pointer"
                              >
                                {busyId === c.id ? "Saving…" : "Add Subtopic"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setQuickAdd(null)}
                                className="px-2 py-1 text-slate-400 hover:text-white cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}

                        <ul className="space-y-1 pl-3 pt-0.5">
                          {c.subtopics.map((t) => {
                            const isEditingSub =
                              editing?.kind === "subtopic" && editing.id === t.id;
                            return (
                              <li key={t.id} className="space-y-1">
                                <div className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-slate-900/80 group">
                                  <span className="text-slate-300">• {t.name.en}</span>
                                  <span className="font-bengali text-slate-500">{t.name.bn}</span>
                                  <span className="ml-auto text-[11px] text-slate-500">
                                    {t.questionCount} questions
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditing({
                                        kind: "subtopic",
                                        id: t.id,
                                        nameEn: t.name.en,
                                        nameBn: t.name.bn,
                                      })
                                    }
                                    className="p-1 text-slate-500 hover:text-white opacity-75 group-hover:opacity-100 cursor-pointer"
                                    title="Rename subtopic"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === t.id}
                                    onClick={() =>
                                      handleDeleteNode(
                                        "subtopic",
                                        t.id,
                                        t.name.en,
                                        `Delete subtopic "${t.name.en}" (${s.name.en} → ${c.name.en}) and ${t.questionCount} linked question(s).`
                                      )
                                    }
                                    className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer disabled:opacity-40"
                                    title="Cascade & delete subtopic"
                                    aria-label={`Delete subtopic ${t.name.en}`}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                                {isEditingSub && (
                                  <InlineEditBar
                                    editing={editing}
                                    setEditing={setEditing}
                                    onSave={handleSaveEdit}
                                    busy={busyId === t.id}
                                  />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InlineEditBar({
  editing,
  setEditing,
  onSave,
  busy,
}: {
  editing: EditingNode;
  setEditing: React.Dispatch<React.SetStateAction<EditingNode | null>>;
  onSave: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 p-2.5 bg-slate-900 border-y border-amber-500/30 text-xs">
      <input
        value={editing.nameEn}
        onChange={(e) => setEditing((prev) => (prev ? { ...prev, nameEn: e.target.value } : null))}
        placeholder="English name *"
        className="flex-1 min-w-[180px] px-2.5 py-1 bg-slate-950 border border-slate-800 rounded text-white"
      />
      <input
        value={editing.nameBn}
        onChange={(e) => setEditing((prev) => (prev ? { ...prev, nameBn: e.target.value } : null))}
        placeholder="বাংলা নাম (optional — auto-translated if blank)"
        className="flex-1 min-w-[180px] px-2.5 py-1 bg-slate-950 border border-slate-800 rounded text-white font-bengali"
      />
      {editing.kind === "subject" && (
        <label className="flex items-center gap-1.5 text-slate-300">
          <span>Qs per Test:</span>
          <input
            type="number"
            min={0}
            max={500}
            value={editing.weightageQuestions ?? 0}
            onChange={(e) =>
              setEditing((prev) =>
                prev ? { ...prev, weightageQuestions: Math.max(0, Number(e.target.value) || 0) } : null
              )
            }
            className="w-20 px-2 py-1 bg-slate-950 border border-slate-800 rounded text-white text-right font-mono"
          />
        </label>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={busy || !editing.nameEn.trim()}
        className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded cursor-pointer"
      >
        <Check className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(null)}
        className="px-2 py-1 text-slate-400 hover:text-white cursor-pointer"
      >
        Cancel
      </button>
    </div>
  );
}

// ============================================================================
// 4. Exam Creation / Edit Form with 1-Click WBPSC Exam Presets & Subject Counts
// ============================================================================

function ExamForm({
  mode,
  exam,
  tree,
  onTreeUpdated,
  onSave,
  onCancel,
}: {
  mode: "create" | "edit";
  exam: ExamDto | null;
  tree?: SyllabusTreeDto;
  onTreeUpdated?: (tree: SyllabusTreeDto, msg?: string) => Promise<void>;
  onSave: (input: ExamConfigInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState<ExamConfigInput>(() =>
    exam
      ? {
          titleEn: exam.titleEn,
          titleBn: exam.titleBn,
          descriptionEn: exam.descriptionEn,
          descriptionBn: exam.descriptionBn,
          totalQuestions: exam.totalQuestions,
          durationMinutes: exam.durationMinutes,
          marksPerCorrect: exam.marksPerCorrect,
          negativeMarksPerWrong: exam.negativeMarksPerWrong,
          estimatedCutoffMarks: exam.estimatedCutoffMarks,
          isActive: exam.isActive,
        }
      : EMPTY_EXAM
  );
  const [presetSlug, setPresetSlug] = useState<string>("");
  const [subjectCounts, setSubjectCounts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (tree && tree.subjects.length > 0) {
      for (const s of tree.subjects) {
        if ((s.weightageQuestions ?? 0) > 0) {
          map[s.name.en] = String(s.weightageQuestions);
        }
      }
    }
    return map;
  });
  const [customSubjects, setCustomSubjects] = useState<Array<{ en: string; bn: string }>>([]);
  const [hiddenSubjects, setHiddenSubjects] = useState<Set<string>>(() => new Set());
  const [newSubjEn, setNewSubjEn] = useState("");
  const [newSubjBn, setNewSubjBn] = useState("");
  const [newSubjCount, setNewSubjCount] = useState("25");
  const [editingSubjKey, setEditingSubjKey] = useState<string | null>(null);
  const [editSubjEn, setEditSubjEn] = useState("");
  const [editSubjBn, setEditSubjBn] = useState("");
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ExamConfigInput>(k: K, v: ExamConfigInput[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const applyPreset = (preset: (typeof WBPSC_EXAM_PRESETS)[number]) => {
    setPresetSlug(preset.slug);
    setF({
      titleEn: preset.titleEn,
      titleBn: preset.titleBn,
      descriptionEn: preset.descriptionEn,
      descriptionBn: preset.descriptionBn,
      totalQuestions: preset.totalQuestions,
      durationMinutes: preset.durationMinutes,
      marksPerCorrect: preset.marksPerCorrect,
      negativeMarksPerWrong: preset.negativeMarksPerWrong,
      estimatedCutoffMarks: preset.estimatedCutoffMarks,
      isActive: true,
    });
    if (preset.subjectWeightages) {
      const next: Record<string, string> = {};
      for (const sw of preset.subjectWeightages) {
        next[sw.subjectEn] = String(sw.weightageQuestions);
      }
      setSubjectCounts(next);
    }
  };

  // All subjects to display in the per-subject question count configurator
  const subjectOptions = useMemo(() => {
    const items: Array<{ id?: string; en: string; bn: string }> = [];
    const seen = new Set<string>();

    for (const p of WBPSC_SUBJECT_PRESETS) {
      if (hiddenSubjects.has(p.en.toLowerCase())) continue;
      const dbMatch = tree?.subjects.find((s) => s.name.en.toLowerCase() === p.en.toLowerCase());
      seen.add(p.en.toLowerCase());
      if (dbMatch) seen.add(dbMatch.name.en.toLowerCase());
      items.push({
        id: dbMatch?.id,
        en: dbMatch?.name.en ?? p.en,
        bn: dbMatch?.name.bn || p.bn,
      });
    }
    for (const s of tree?.subjects ?? []) {
      const k = s.name.en.toLowerCase();
      if (!seen.has(k) && !hiddenSubjects.has(k)) {
        seen.add(k);
        items.push({ id: s.id, en: s.name.en, bn: s.name.bn });
      }
    }
    for (const c of customSubjects) {
      const k = c.en.toLowerCase();
      if (!seen.has(k) && !hiddenSubjects.has(k)) {
        seen.add(k);
        items.push({ en: c.en, bn: c.bn });
      }
    }
    for (const k of Object.keys(subjectCounts)) {
      if (!seen.has(k.toLowerCase()) && !hiddenSubjects.has(k.toLowerCase())) {
        seen.add(k.toLowerCase());
        items.push({ en: k, bn: "" });
      }
    }
    return items;
  }, [tree?.subjects, customSubjects, hiddenSubjects, subjectCounts]);

  const configuredSubjectSum = useMemo(
    () =>
      Object.values(subjectCounts).reduce((acc, v) => {
        const n = Number(v);
        return acc + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [subjectCounts]
  );

  const toggleSubjectCount = (en: string) => {
    setSubjectCounts((prev) => {
      const next = { ...prev };
      if (next[en] !== undefined) {
        delete next[en];
      } else {
        next[en] = "25";
      }
      return next;
    });
  };

  const handleAddSubjectOption = () => {
    const trimmed = newSubjEn.trim();
    if (!trimmed) return;
    setHiddenSubjects((prev) => {
      const next = new Set(prev);
      next.delete(trimmed.toLowerCase());
      return next;
    });
    setCustomSubjects((prev) => [
      ...prev.filter((c) => c.en.toLowerCase() !== trimmed.toLowerCase()),
      { en: trimmed, bn: newSubjBn.trim() },
    ]);
    setSubjectCounts((prev) => ({
      ...prev,
      [trimmed]: String(Number(newSubjCount) || 25),
    }));
    setNewSubjEn("");
    setNewSubjBn("");
  };

  const handleSaveSubjectRename = async (subj: { id?: string; en: string; bn: string }) => {
    const nextEn = editSubjEn.trim();
    const nextBn = editSubjBn.trim();
    if (!nextEn) return;

    if (subj.id && onTreeUpdated) {
      try {
        const res = await adminApi<{ tree: SyllabusTreeDto }>(`/syllabus/subjects/${subj.id}`, {
          method: "PATCH",
          body: { nameEn: nextEn, nameBn: nextBn || undefined },
        });
        await onTreeUpdated(res.tree, `Renamed subject "${subj.en}" to "${nextEn}".`);
      } catch {
        // fallback to local update
      }
    }

    setHiddenSubjects((prev) => new Set([...prev, subj.en.toLowerCase()]));
    setCustomSubjects((prev) => [
      ...prev.filter(
        (c) =>
          c.en.toLowerCase() !== subj.en.toLowerCase() &&
          c.en.toLowerCase() !== nextEn.toLowerCase()
      ),
      { en: nextEn, bn: nextBn },
    ]);
    setSubjectCounts((prev) => {
      const next = { ...prev };
      if (next[subj.en] !== undefined) {
        const countVal = next[subj.en];
        delete next[subj.en];
        next[nextEn] = countVal;
      }
      return next;
    });
    setEditingSubjKey(null);
  };

  const handleDeleteSubjectOption = async (subj: { id?: string; en: string; bn: string }) => {
    if (subj.id && onTreeUpdated) {
      try {
        const res = await adminApi<{ tree: SyllabusTreeDto | null }>(
          `/syllabus/subjects/${subj.id}`,
          { method: "DELETE" }
        );
        if (res.tree) {
          await onTreeUpdated(res.tree, `Deleted subject "${subj.en}".`);
        }
      } catch {
        // fallback to local removal
      }
    }
    setHiddenSubjects((prev) => new Set([...prev, subj.en.toLowerCase()]));
    setCustomSubjects((prev) => prev.filter((c) => c.en.toLowerCase() !== subj.en.toLowerCase()));
    setSubjectCounts((prev) => {
      const next = { ...prev };
      delete next[subj.en];
      return next;
    });
  };

  const inputCls =
    "w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white";
  const num = (k: keyof ExamConfigInput, label: string, step = "1") => (
    <label className="text-xs text-slate-300 space-y-1">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={String(f[k])}
        onChange={(e) => set(k, Number(e.target.value) as never)}
        className={inputCls}
      />
    </label>
  );

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const subjectWeightages = Object.entries(subjectCounts)
          .map(([subjectEn, countStr]) => {
            const opt = subjectOptions.find((o) => o.en.toLowerCase() === subjectEn.toLowerCase());
            return {
              subjectEn,
              subjectBn: opt?.bn ?? "",
              weightageQuestions: Number(countStr) || 0,
            };
          })
          .filter((sw) => sw.weightageQuestions > 0);

        const payload: ExamConfigInput = {
          ...(mode === "create" && presetSlug ? { ...f, slug: presetSlug } : f),
          ...(subjectWeightages.length > 0
            ? {
                totalQuestions: configuredSubjectSum || f.totalQuestions,
                subjectWeightages,
              }
            : {}),
        };
        await onSave(payload);
        setSaving(false);
      }}
      className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">
          {mode === "create" ? "Create New Exam" : `Edit ${exam?.titleEn}`}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {mode === "create" && (
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
          <span className="block text-xs font-semibold text-amber-300">
            Quick Fill from Official WBPSC / WBP Exam Presets (1-Click):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {WBPSC_EXAM_PRESETS.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => applyPreset(p)}
                className={`px-2.5 py-1.5 text-xs rounded-lg border cursor-pointer transition-colors ${
                  presetSlug === p.slug
                    ? "bg-amber-500 text-slate-950 border-amber-400 font-semibold"
                    : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                {p.titleEn}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-slate-300 space-y-1">
          <span>Exam Name (English) *</span>
          <input
            required
            value={f.titleEn}
            onChange={(e) => set("titleEn", e.target.value)}
            placeholder="e.g. WBPSC Clerkship Part-I"
            className={inputCls}
          />
        </label>
        <label className="text-xs text-slate-300 space-y-1">
          <span>পরীক্ষার নাম (বাংলা) *</span>
          <input
            required
            value={f.titleBn}
            onChange={(e) => set("titleBn", e.target.value)}
            placeholder="যেমন: ডব্লিউবিপিএসসি ক্লার্কশিপ পার্ট-১"
            className={`${inputCls} font-bengali`}
          />
        </label>
        <label className="text-xs text-slate-300 space-y-1">
          <span>Short Description (English)</span>
          <textarea
            rows={2}
            value={f.descriptionEn}
            onChange={(e) => set("descriptionEn", e.target.value)}
            placeholder="Brief overview of the exam pattern…"
            className={inputCls}
          />
        </label>
        <label className="text-xs text-slate-300 space-y-1">
          <span>সংক্ষিপ্ত বিবরণ (বাংলা)</span>
          <textarea
            rows={2}
            value={f.descriptionBn}
            onChange={(e) => set("descriptionBn", e.target.value)}
            placeholder="পরীক্ষার সংক্ষিপ্ত বিবরণ…"
            className={`${inputCls} font-bengali`}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {num("totalQuestions", "Total Questions")}
        {num("durationMinutes", "Duration (Minutes)")}
        {num("marksPerCorrect", "Marks per Correct", "0.01")}
        {num("negativeMarksPerWrong", "Negative per Wrong", "0.01")}
        {num("estimatedCutoffMarks", "Expected Cutoff", "0.01")}
      </div>

      {/* Subject-wise Question Distribution Configurator */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="block text-xs font-bold text-white">
              Subjects &amp; Number of Questions per Subject (Exam Pattern)
            </span>
            <span className="block text-[11px] text-slate-400">
              Set how many questions each subject has in this exam (e.g. Clerkship: GS 40, Arithmetic 30,
              English 30 = 100 Qs). You can also add, rename, or delete subjects below.
            </span>
          </div>
          {configuredSubjectSum > 0 && (
            <span className="px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-xs font-mono text-emerald-300">
              Subject Total: {configuredSubjectSum} Qs
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {subjectOptions.map((subj) => {
            const checked = subjectCounts[subj.en] !== undefined;
            const isEditing = editingSubjKey === subj.en;

            if (isEditing) {
              return (
                <div
                  key={subj.en}
                  className="p-2.5 rounded-lg border border-amber-500/50 bg-slate-900 space-y-2 text-xs"
                >
                  <input
                    value={editSubjEn}
                    onChange={(e) => setEditSubjEn(e.target.value)}
                    placeholder="Subject Name (English) *"
                    className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                  />
                  <input
                    value={editSubjBn}
                    onChange={(e) => setEditSubjBn(e.target.value)}
                    placeholder="বিষয়ের নাম (বাংলা)"
                    className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-white font-bengali"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSaveSubjectRename(subj)}
                      className="px-2.5 py-1 bg-amber-500 text-slate-950 font-semibold rounded cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSubjKey(null)}
                      className="px-2 py-1 text-slate-400 hover:text-white cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={subj.en}
                className={`flex items-center justify-between gap-2 p-2 rounded-lg border text-xs ${
                  checked
                    ? "bg-amber-500/10 border-amber-500/40 text-white"
                    : "bg-slate-900/70 border-slate-800 text-slate-400"
                }`}
              >
                <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSubjectCount(subj.en)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <span className="block font-medium truncate">{subj.en}</span>
                    {subj.bn && (
                      <span className="block text-[11px] font-bengali text-slate-400 truncate">
                        {subj.bn}
                      </span>
                    )}
                  </div>
                </label>
                <div className="flex items-center gap-1 shrink-0">
                  {checked && (
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={subjectCounts[subj.en]}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^\d]/g, "");
                        setSubjectCounts((prev) => ({ ...prev, [subj.en]: val }));
                      }}
                      placeholder="Qs"
                      className="w-14 px-1.5 py-1 text-xs text-right font-mono bg-slate-950 border border-slate-700 rounded text-white"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSubjKey(subj.en);
                      setEditSubjEn(subj.en);
                      setEditSubjBn(subj.bn || "");
                    }}
                    className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                    title={`Edit "${subj.en}"`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSubjectOption(subj)}
                    className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 cursor-pointer"
                    title={`Delete "${subj.en}"`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Custom Subject in Exam Form */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            value={newSubjEn}
            onChange={(e) => setNewSubjEn(e.target.value)}
            placeholder="Add another subject (e.g. Computer Literacy)…"
            className="flex-1 min-w-[200px] max-w-xs px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white"
          />
          <input
            value={newSubjBn}
            onChange={(e) => setNewSubjBn(e.target.value)}
            placeholder="বাংলা নাম (optional)"
            className="flex-1 min-w-[160px] max-w-xs px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white font-bengali"
          />
          <input
            type="number"
            min={1}
            max={200}
            value={newSubjCount}
            onChange={(e) => setNewSubjCount(e.target.value)}
            placeholder="Qs"
            className="w-20 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white font-mono text-right"
          />
          <button
            type="button"
            onClick={handleAddSubjectOption}
            disabled={!newSubjEn.trim()}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
          >
            + Add Subject
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
        <input
          type="checkbox"
          checked={f.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
        />
        Make this exam active &amp; visible to students on the dashboard
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
        >
          {saving ? "Saving…" : mode === "create" ? "Create Exam" : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-xs text-slate-300 hover:text-white cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
