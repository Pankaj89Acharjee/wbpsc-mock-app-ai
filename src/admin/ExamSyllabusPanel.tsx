import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Pencil, Plus, Upload } from "lucide-react";
import {
  SYLLABUS_CSV_COLUMNS,
  SYLLABUS_TEMPLATE_EXAMPLES,
  slugify,
  toCsv,
  type ExamConfigInput,
  type ExamDto,
  type SyllabusTreeDto,
  type SyllabusUploadResult,
} from "../../packages/shared-types/src/index";
import { adminApi, downloadCsv, type SyllabusTrees } from "./adminApi";

// ============================================================================
// Admin Console → Question Bank → Exams & Syllabus
// Create exams, then add Subject → Chapter → Subtopic via a simple CSV.
// Slugs are generated from English names; nobody has to type them.
// ============================================================================

type Notice = { kind: "success" | "error"; text: string; details?: string[] };

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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uploading, setUploading] = useState(false);

  const selected = exams.find((e) => e.slug === selectedSlug) ?? null;
  const tree = selected ? trees.trees[selected.slug] : undefined;
  const { loadTree, setTree } = trees;

  useEffect(() => {
    if (!selectedSlug && exams.length > 0) setSelectedSlug(exams[0].slug);
  }, [exams, selectedSlug]);

  // Refetch only when the selected exam changes (loadTree identity changes with every cache update)
  useEffect(() => {
    if (selectedSlug) loadTree(selectedSlug, true);
  }, [selectedSlug]);

  const handleSyllabusFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selected) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setNotice({ kind: "error", text: "Use a .csv file (Excel → Save As → CSV UTF-8)." });
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
        text: `Added ${c.subjects} subjects, ${c.chapters} chapters, ${c.subtopics} subtopics · ${result.updated} renamed${
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

  /** Current syllabus with slugs — edit names and re-upload to rename. */
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
      {/* ── Exam list ─────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2 h-fit">
        <button
          onClick={() => {
            setFormMode("create");
            setNotice(null);
          }}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> New exam
        </button>
        {exams.map((e) => (
          <button
            key={e.slug}
            onClick={() => {
              setSelectedSlug(e.slug);
              setFormMode(null);
              setNotice(null);
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer ${
              selectedSlug === e.slug && formMode !== "create"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:bg-slate-800/50"
            }`}
          >
            <span className="block font-medium truncate">{e.titleEn}</span>
            <span className="block text-[11px] text-slate-500">
              {e.subtopicCount} subtopics · {e.questionCount} questions
              {!e.isActive && <span className="text-rose-300"> · inactive</span>}
            </span>
          </button>
        ))}
        {exams.length === 0 && <p className="text-xs text-slate-500 px-1">No exams yet.</p>}
      </div>

      {/* ── Detail ───────────────────────────────────────────────────── */}
      <div className="space-y-4 min-w-0">
        {notice && (
          <div
            className={`p-3 rounded-lg border text-xs ${
              notice.kind === "error"
                ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
            }`}
          >
            <p className="font-medium">{notice.text}</p>
            {notice.details && notice.details.length > 0 && (
              <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                {notice.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
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
                    : await adminApi<{ exam: ExamDto }>(
                        `/syllabus/exams/${selected!.slug}`,
                        { method: "PUT", body: input }
                      );
                await reloadExams();
                setSelectedSlug(exam.slug);
                setFormMode(null);
                setNotice({
                  kind: "success",
                  text:
                    formMode === "create"
                      ? `Created "${exam.titleEn}". Next: upload its syllabus below.`
                      : `Saved "${exam.titleEn}".`,
                });
              } catch (err) {
                setNotice({ kind: "error", text: (err as Error).message });
              }
            }}
          />
        ) : selected ? (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white">{selected.titleEn}</h3>
                  <p className="text-xs text-slate-400 font-bengali">{selected.titleBn}</p>
                  <p className="text-[11px] text-slate-500 mt-1 font-mono">{selected.slug}</p>
                </div>
                <button
                  onClick={() => setFormMode("edit")}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit config
                </button>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                <span>{selected.totalQuestions} questions / test</span>
                <span>{selected.durationMinutes} min</span>
                <span>+{selected.marksPerCorrect} / −{selected.negativeMarksPerWrong}</span>
                <span>cutoff {selected.estimatedCutoffMarks}</span>
                <span className={selected.isActive ? "text-emerald-300" : "text-rose-300"}>
                  {selected.isActive ? "active" : "inactive"}
                </span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Syllabus</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xl">
                    One subtopic per CSV row, English + Bengali names. Re-uploading is safe:
                    existing items are matched by name, new ones are added, nothing is deleted.
                  </p>
                </div>
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
                    <Download className="w-3.5 h-3.5" /> Syllabus template
                  </button>
                  <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    {uploading ? "Uploading…" : "Upload syllabus CSV"}
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

              {tree && tree.subjects.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={downloadCurrentSyllabus}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Current syllabus (edit &amp; re-upload to rename)
                  </button>
                </div>
              )}

              {!tree ? (
                <p className="text-xs text-slate-500">Loading…</p>
              ) : tree.subjects.length === 0 ? (
                <p className="text-xs text-amber-300">
                  No syllabus yet. Download the template, fill one row per subtopic, and upload it.
                </p>
              ) : (
                <SyllabusTreeView tree={tree} />
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500">Create an exam to get started.</p>
        )}
      </div>
    </div>
  );
}

function SyllabusTreeView({ tree }: { tree: SyllabusTreeDto }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-1.5">
      {tree.subjects.map((s) => {
        const count = s.chapters.reduce(
          (n, c) => n + c.subtopics.reduce((m, t) => m + t.questionCount, 0),
          0
        );
        const isOpen = open.has(s.id);
        return (
          <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-950">
            <button
              onClick={() => toggle(s.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs cursor-pointer"
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span className="font-semibold text-white">{s.name.en}</span>
              <span className="font-bengali text-slate-400">{s.name.bn}</span>
              <span className="ml-auto text-slate-500">
                {s.chapters.length} chapters · {count} questions
              </span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 space-y-2">
                {s.chapters.map((c) => (
                  <div key={c.id} className="pl-5">
                    <p className="text-xs text-slate-200">
                      {c.name.en} <span className="font-bengali text-slate-500">· {c.name.bn}</span>
                    </p>
                    <ul className="pl-4 mt-1 space-y-0.5">
                      {c.subtopics.map((t) => (
                        <li key={t.id} className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span>• {t.name.en}</span>
                          <span className="font-bengali text-slate-500">{t.name.bn}</span>
                          <span className="ml-auto font-mono text-slate-600">{t.slug}</span>
                          <span className="w-16 text-right text-slate-500">
                            {t.questionCount} Q
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ExamConfigInput>(k: K, v: ExamConfigInput[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const inputCls =
    "w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white";
  const num = (k: keyof ExamConfigInput, label: string, step = "1") => (
    <label className="text-xs text-slate-400 space-y-1">
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
        await onSave(mode === "create" && slug.trim() ? { ...f, slug: slug.trim() } : f);
        setSaving(false);
      }}
      className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4"
    >
      <h3 className="text-sm font-bold text-white">
        {mode === "create" ? "New exam" : `Edit ${exam?.titleEn}`}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-slate-400 space-y-1">
          <span>Title (English)</span>
          <input
            required
            value={f.titleEn}
            onChange={(e) => set("titleEn", e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-xs text-slate-400 space-y-1">
          <span>শিরোনাম (বাংলা)</span>
          <input
            required
            value={f.titleBn}
            onChange={(e) => set("titleBn", e.target.value)}
            className={`${inputCls} font-bengali`}
          />
        </label>
        <label className="text-xs text-slate-400 space-y-1">
          <span>Description (English)</span>
          <textarea
            rows={2}
            value={f.descriptionEn}
            onChange={(e) => set("descriptionEn", e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-xs text-slate-400 space-y-1">
          <span>বিবরণ (বাংলা)</span>
          <textarea
            rows={2}
            value={f.descriptionBn}
            onChange={(e) => set("descriptionBn", e.target.value)}
            className={`${inputCls} font-bengali`}
          />
        </label>
      </div>

      {mode === "create" && (
        <label className="block text-xs text-slate-400 space-y-1 max-w-md">
          <span>Short code (slug) — optional</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={slugify(f.titleEn) || "auto from English title"}
            className={`${inputCls} font-mono`}
          />
          <span className="block text-[11px] text-slate-500">
            Used in CSV files. Leave blank to use “{slugify(f.titleEn) || "…"}”. Cannot be changed later.
          </span>
        </label>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {num("totalQuestions", "Questions / test")}
        {num("durationMinutes", "Duration (min)")}
        {num("marksPerCorrect", "Marks per correct", "0.01")}
        {num("negativeMarksPerWrong", "Negative per wrong", "0.01")}
        {num("estimatedCutoffMarks", "Cutoff marks", "0.01")}
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={f.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
        />
        Active (visible to students)
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
        >
          {saving ? "Saving…" : mode === "create" ? "Create exam" : "Save"}
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
