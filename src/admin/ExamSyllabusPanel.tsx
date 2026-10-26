import React, { useEffect, useMemo, useState } from "react";
import {
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
  X,
} from "lucide-react";
import {
  SYLLABUS_CSV_COLUMNS,
  SYLLABUS_TEMPLATE_EXAMPLES,
  WBPSC_EXAM_PRESETS,
  WBPSC_SUBJECT_PRESETS,
  toCsv,
  type ExamConfigInput,
  type ExamDto,
  type SyllabusTreeDto,
  type SyllabusUploadResult,
} from "../../packages/shared-types/src/index";
import { adminApi, downloadCsv, type SyllabusTrees } from "./adminApi";

// ============================================================================
// Admin Console → Tab 2: Exams & Syllabus
// Designed for non-technical educators & admins:
// 1. One-click WBPSC Exam Presets (WBCS, Clerkship, Food SI, Misc, WBP, TET)
// 2. AI Bulk Syllabus Generator (Mathematics, History, Geography, Polity,
//    Science, Current Affairs, General Awareness, Reasoning, English, Bengali)
// 3. Guided Manual / Pre-populated Subject -> Chapter -> Subtopic Builder
//    (Bengali auto-filled from presets or translated automatically by AI)
// 4. Full Interactive CRUD Tree (Inline Rename/Edit, Add Child, Delete)
// ============================================================================

type Notice = { kind: "success" | "error" | "info"; text: string; details?: string[] };

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

  const selected = exams.find((e) => e.slug === selectedSlug) ?? null;
  const tree = selected ? trees.trees[selected.slug] : undefined;
  const { loadTree, setTree } = trees;

  useEffect(() => {
    if (!selectedSlug && exams.length > 0) setSelectedSlug(exams[0].slug);
  }, [exams, selectedSlug]);

  useEffect(() => {
    if (selectedSlug) loadTree(selectedSlug, true);
  }, [selectedSlug]);

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

  const handleDeleteExam = async (exam: ExamDto) => {
    try {
      await adminApi(`/syllabus/exams/${exam.slug}`, { method: "DELETE" });
      await reloadExams();
      const remaining = exams.filter((e) => e.slug !== exam.slug);
      setSelectedSlug(remaining[0]?.slug ?? null);
      setNotice({ kind: "success", text: `Deleted exam "${exam.titleEn}".` });
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
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
                  {e.subtopicCount} topics · {e.questionCount} questions
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

      {/* ── Right Column: Exam Details & Syllabus Builder ─────────────── */}
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
                setSelectedSlug(exam.slug);
                setFormMode(null);
                if (formMode === "create") {
                  setActiveTool("ai");
                }
                setNotice({
                  kind: "success",
                  text:
                    formMode === "create"
                      ? `Created "${exam.titleEn}". Now generate its full syllabus with AI or add topics below.`
                      : `Updated "${exam.titleEn}".`,
                });
              } catch (err) {
                setNotice({ kind: "error", text: (err as Error).message });
              }
            }}
          />
        ) : selected ? (
          <>
            {/* ── Exam Header Summary ──────────────────────────────────── */}
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
                  {selected.questionCount === 0 && (
                    <button
                      onClick={() => handleDeleteExam(selected)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded-lg cursor-pointer"
                      title="Delete this exam"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-slate-800/80 text-xs">
                <div>
                  <span className="block text-slate-500">Questions / Test</span>
                  <span className="font-semibold text-white">{selected.totalQuestions} MCQs</span>
                </div>
                <div>
                  <span className="block text-slate-500">Duration</span>
                  <span className="font-semibold text-white">{selected.durationMinutes} mins</span>
                </div>
                <div>
                  <span className="block text-slate-500">Correct Answer</span>
                  <span className="font-semibold text-emerald-400">+{selected.marksPerCorrect}</span>
                </div>
                <div>
                  <span className="block text-slate-500">Wrong Answer</span>
                  <span className="font-semibold text-rose-400">−{selected.negativeMarksPerWrong}</span>
                </div>
                <div>
                  <span className="block text-slate-500">Target Cutoff</span>
                  <span className="font-semibold text-amber-300">
                    {selected.estimatedCutoffMarks} marks
                  </span>
                </div>
              </div>
            </div>

            {/* ── Syllabus Action Bar (AI / Guided Entry / CSV) ────────── */}
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
                    click any item in the tree below to rename or delete it.
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
                </div>
              </div>

              {/* ── Tool 1: AI Bulk Syllabus Generator ─────────────────── */}
              {activeTool === "ai" && (
                <AiSyllabusBuilder
                  exam={selected}
                  existingSubjects={tree?.subjects.map((s) => s.name.en) ?? []}
                  onClose={() => setActiveTool(null)}
                  onGenerated={async (updatedTree, result, modelUsed, skippedDuplicates) => {
                    setTree(updatedTree);
                    await reloadExams();
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
                  onTreeUpdated={async (updated, message) => {
                    setTree(updated);
                    await reloadExams();
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
    </div>
  );
}

// ============================================================================
// 1. AI Bulk Syllabus Generator Component
// ============================================================================

function AiSyllabusBuilder({
  exam,
  existingSubjects,
  onClose,
  onGenerated,
  onError,
}: {
  exam: ExamDto;
  /** Subjects the exam already has — pre-selected so the AI fills their gaps */
  existingSubjects: string[];
  onClose: () => void;
  onGenerated: (
    tree: SyllabusTreeDto,
    result: SyllabusUploadResult,
    modelUsed: string,
    skippedDuplicates: number
  ) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const allSubjectNames = useMemo(() => WBPSC_SUBJECT_PRESETS.map((s) => s.en), []);
  // Nothing ticked = the AI decides this exam's subjects itself
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(() => new Set(existingSubjects));
  const presets = useMemo(
    () => [
      ...WBPSC_SUBJECT_PRESETS,
      ...existingSubjects
        .filter((n) => !WBPSC_SUBJECT_PRESETS.some((p) => p.en === n))
        .map((n) => ({ en: n, bn: "" })),
    ],
    [existingSubjects]
  );
  const [customSubject, setCustomSubject] = useState("");
  const [busy, setBusy] = useState(false);

  const toggleSubject = (name: string) => {
    setSelectedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAddCustom = () => {
    const trimmed = customSubject.trim();
    if (!trimmed) return;
    setSelectedSubjects((prev) => new Set([...prev, trimmed]));
    setCustomSubject("");
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
            Subtopics</strong> tree for this exam. It sees what already exists and only adds what is
            missing — headings that mean the same as an existing one (e.g. “National Movement” vs
            “Indian National Movement”) are skipped. Leave every subject unticked to let the AI pick
            this exam's subjects.
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

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-300 font-medium">
            Included Subjects ({selectedSubjects.size} selected)
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setSelectedSubjects(new Set(allSubjectNames))}
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
          {presets.map((preset) => {
            const checked = selectedSubjects.has(preset.en);
            return (
              <label
                key={preset.en}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                  checked
                    ? "bg-violet-500/15 border-violet-500/40 text-white"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSubject(preset.en)}
                  disabled={busy}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <span className="block font-medium truncate">{preset.en}</span>
                  <span className="block text-[11px] font-bengali text-slate-400 truncate">
                    {preset.bn}
                  </span>
                </div>
              </label>
            );
          })}
        </div>

        {/* Custom subject input */}
        <div className="flex gap-2 pt-1 max-w-md">
          <input
            value={customSubject}
            onChange={(e) => setCustomSubject(e.target.value)}
            placeholder="Add another subject (e.g. Computer Literacy)…"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCustom();
              }
            }}
            className="flex-1 px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
          <button
            type="button"
            onClick={handleAddCustom}
            disabled={busy || !customSubject.trim()}
            className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg cursor-pointer"
          >
            + Add
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
  onTreeUpdated,
  onError,
}: {
  exam: ExamDto;
  tree: SyllabusTreeDto;
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
        },
      });
      setEditing(null);
      await onTreeUpdated(updated, `Renamed to "${editing.nameEn.trim()}".`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteNode = async (
    kind: "subject" | "chapter" | "subtopic",
    id: string,
    label: string
  ) => {
    if (!window.confirm(`Delete ${kind} "${label}"${kind === "subtopic" ? "" : " and everything under it"}?`)) return;
    setBusyId(id);
    try {
      const endpoint =
        kind === "subject"
          ? `/syllabus/subjects/${id}`
          : kind === "chapter"
            ? `/syllabus/chapters/${id}`
            : `/syllabus/subtopics/${id}`;
      const { tree: updated } = await adminApi<{ tree: SyllabusTreeDto }>(endpoint, {
        method: "DELETE",
      });
      await onTreeUpdated(updated, `Deleted ${kind} "${label}".`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusyId(null);
    }
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
                  {s.chapters.length} chapters · {topicCount} topics ·{" "}
                  <strong className="text-slate-300">{questionCount} Q</strong>
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
                      })
                    }
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    title="Rename subject"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => handleDeleteNode("subject", s.id, s.name.en)}
                    className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer disabled:opacity-40"
                    title="Delete subject"
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
                              onClick={() => handleDeleteNode("chapter", c.id, c.name.en)}
                              className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer disabled:opacity-40"
                              title="Delete chapter"
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
                                    onClick={() => handleDeleteNode("subtopic", t.id, t.name.en)}
                                    className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer disabled:opacity-40"
                                    title="Delete subtopic"
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
// 4. Exam Creation / Edit Form with 1-Click WBPSC Exam Presets
// ============================================================================

function ExamForm({
  mode,
  exam,
  onSave,
  onCancel,
}: {
  mode: "create" | "edit";
  exam: ExamDto | null;
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
        await onSave(mode === "create" && presetSlug ? { ...f, slug: presetSlug } : f);
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
