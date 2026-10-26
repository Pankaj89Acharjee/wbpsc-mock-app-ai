import React, { useCallback, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileUp,
  Languages,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import {
  BULK_IMPORT_CSV_COLUMNS,
  BULK_IMPORT_MAX_ROWS,
  BULK_IMPORT_TEMPLATE_EXAMPLES,
  EXAM_SLUG_LABELS,
  OptionKeySchema,
  csvTableToRecords,
  isDraftTextComplete,
  parseCsv,
  pyqLabel,
  toCsv,
  type ExamDto,
  type ExtractMediaQuestionsResult,
  type IngestionBatchSummary,
  type IngestionJobDto,
  type IngestionStatus,
  type IngestionUploadResult,
  type ApproveJobsResult,
  type RejectJobsResult,
  type SyllabusTreeDto,
  type OptionKey,
  type StagedQuestionDraft,
} from "../../packages/shared-types/src/index";
import { adminApi, downloadCsv, type SyllabusTrees } from "./adminApi";
import SyllabusPicker from "./SyllabusPicker";
import AiGeneratePanel from "./AiGeneratePanel";
import { ConfirmDialog } from "./ui";

// ============================================================================
// Admin Console → Tab 4: Question Bank (Add · Bulk · AI · PDF/Image Paper)
// ============================================================================

const PAGE_SIZE = 50;

type StatusFilter = IngestionStatus | "all";

const STATUS_TABS: Array<[StatusFilter, string]> = [
  ["pending_review", "Ready for review"],
  ["pending_ai", "Needs Bengali / explanation"],
  ["failed", "Needs fixing / duplicates"],
  ["inserted", "Live"],
  ["rejected", "Rejected"],
  ["all", "All"],
];

const STATUS_BADGE: Record<IngestionStatus, string> = {
  pending_review: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  pending_ai: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  inserted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rejected: "bg-slate-700/40 text-slate-400 border-slate-600",
  failed: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const isEditable = (job: IngestionJobDto) =>
  job.status === "pending_ai" ||
  job.status === "pending_review" ||
  (job.status === "failed" && job.draft !== null);

interface SelectedFile {
  name: string;
  format: "csv" | "json";
  content: string;
  rowCount: number;
  warning: string | null;
}

/** Review-queue filters beyond status and batch (all optional). */
interface ReviewFilters {
  subjectId: string;
  chapterId: string;
  subtopicId: string;
  difficulty: string;
  source: string;
  createdFrom: string;
  createdTo: string;
}
const NO_FILTERS: ReviewFilters = {
  subjectId: "",
  chapterId: "",
  subtopicId: "",
  difficulty: "",
  source: "",
  createdFrom: "",
  createdTo: "",
};

/** AI questions awaiting review are only approved or rejected, not edited. */
const isAiForReview = (job: IngestionJobDto) =>
  job.source === "ai_generated" && job.status === "pending_review";

type Notice = { kind: "success" | "error" | "info"; text: string; details?: string[] };

function emptyDraft(examSlug: string): StagedQuestionDraft {
  const blank = { en: "", bn: "" };
  return {
    examSlug,
    subjectSlug: "",
    chapterSlug: "",
    subtopicSlug: "",
    stem: blank,
    options: { A: blank, B: blank, C: blank, D: blank },
    correctOption: "A",
    explanation: blank,
    difficulty: "moderate",
    source: "educator",
    pyqExamSlug: null,
    pyqYear: null,
    answerKeyVerified: true,
  };
}

export default function BulkImportPanel({
  exam,
  exams,
  trees,
  onQuestionsChanged,
}: {
  exam: ExamDto;
  exams: ExamDto[];
  trees: SyllabusTrees;
  onQuestionsChanged: () => Promise<void>;
}) {
  const ingestionApi = useCallback(
    <T,>(path: string, init?: { method?: string; body?: unknown }) =>
      adminApi<T>(`/ingestion${path}`, init),
    []
  );

  const [file, setFile] = useState<SelectedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<IngestionUploadResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [extractingPaper, setExtractingPaper] = useState(false);

  const [batches, setBatches] = useState<IngestionBatchSummary[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending_review");
  const [offset, setOffset] = useState(0);
  const [jobs, setJobs] = useState<IngestionJobDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [filters, setFilters] = useState<ReviewFilters>(NO_FILTERS);
  const [assignToSeries, setAssignToSeries] = useState(true);
  const [confirm, setConfirm] = useState<{ kind: "reject"; ids: string[] } | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);

  const examLabel = (slug: string | null) =>
    slug ? (EXAM_SLUG_LABELS[slug] ?? exams.find((e) => e.slug === slug)?.titleEn ?? slug) : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        examSlug: exam.slug,
        status: statusFilter,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (batchId) params.set("batchId", batchId);
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      const [batchRes, jobRes] = await Promise.all([
        ingestionApi<{ batches: IngestionBatchSummary[] }>(
          `/batches?examSlug=${encodeURIComponent(exam.slug)}`
        ),
        ingestionApi<{ jobs: IngestionJobDto[]; total: number }>(`/jobs?${params}`),
      ]);
      setBatches(batchRes.batches);
      setJobs(jobRes.jobs);
      setTotal(jobRes.total);
      setSelected(new Set());
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [ingestionApi, exam.slug, batchId, statusFilter, offset, filters]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    setUploadResult(null);
    if (!picked) return;

    const name = picked.name;
    const lower = name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".json")) {
      setNotice({
        kind: "error",
        text: "Use a .csv or .json file. In Excel: File → Save As → “CSV UTF-8 (Comma delimited)”.",
      });
      return;
    }
    const content = await picked.text();
    const format = lower.endsWith(".csv") ? "csv" : "json";
    let rowCount = 0;
    let warning: string | null = null;
    if (format === "csv") {
      const { records, missingColumns } = csvTableToRecords(parseCsv(content));
      rowCount = records.length;
      if (missingColumns.length > 0) {
        warning = `Missing required columns: ${missingColumns.join(", ")}`;
      }
    } else {
      try {
        const json = JSON.parse(content);
        if (Array.isArray(json)) rowCount = json.length;
        else warning = "JSON must be an array of question objects";
      } catch {
        warning = "File is not valid JSON";
      }
    }
    if (rowCount > BULK_IMPORT_MAX_ROWS) {
      warning = `${rowCount} rows — split into files of at most ${BULK_IMPORT_MAX_ROWS}`;
    }
    setFile({ name, format, content, rowCount, warning });
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setNotice(null);
    try {
      const result = await ingestionApi<IngestionUploadResult>("/upload", {
        method: "POST",
        body: { fileName: file.name, format: file.format, content: file.content },
      });
      setUploadResult(result);
      setFile(null);
      setOffset(0);
      setBatchId(result.batchId);
      setStatusFilter(
        result.pendingReview > 0
          ? "pending_review"
          : result.pendingAi > 0
            ? "pending_ai"
            : "failed"
      );
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const describe = (id: string, message: string) => {
    const job = jobs.find((j) => j.id === id);
    const label = job?.rowNumber ? `Row ${job.rowNumber}` : id.slice(0, 8);
    return `${label}${job?.draft ? ` (“${job.draft.stem.en.slice(0, 50)}…”)` : ""} — ${message}`;
  };

  const runApprove = async (ids: string[]) => {
    if (ids.length === 0 || actionBusy) return;
    setActionBusy(true);
    try {
      const r = await ingestionApi<ApproveJobsResult>("/jobs/approve", {
        method: "POST",
        body: { ids, assignToTargetSeries: assignToSeries },
      });
      const problems = r.results
        .filter((x) => x.status !== "inserted")
        .map((x) => describe(x.id, x.message ?? x.status));
      const parts = [`${r.inserted} approved into the Question Bank`];
      if (r.assigned) parts.push(`${r.assigned} also added to their test series`);
      if (r.invalid.length) parts.push(`${r.invalid.length} need fixes`);
      if (r.duplicates.length) parts.push(`${r.duplicates.length} duplicates`);
      if (r.notPendingReview) parts.push(`${r.notPendingReview} skipped (not “Ready for review”)`);
      setNotice({
        kind: r.inserted === 0 ? "error" : problems.length ? "info" : "success",
        text: parts.join(" · "),
        details: problems,
      });
      setExpandedId(null);
      await Promise.all([refresh(), onQuestionsChanged()]);
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setActionBusy(false);
      setConfirm(null);
    }
  };

  const approveOne = (job: IngestionJobDto) => runApprove([job.id]);

  const runReject = async (ids: string[]) => {
    if (ids.length === 0 || actionBusy) return;
    setActionBusy(true);
    try {
      const r = await ingestionApi<RejectJobsResult>("/jobs/reject", {
        method: "POST",
        body: { ids, reviewNotes: rejectNotes.trim() || undefined },
      });
      const skipped = r.results
        .filter((x) => x.status !== "rejected")
        .map((x) => describe(x.id, x.message ?? "not rejected"));
      setNotice({
        kind: skipped.length ? "info" : "success",
        text: `${r.rejected} question(s) rejected${skipped.length ? ` · ${skipped.length} skipped` : ""}. Rejected rows are kept for auditing and duplicate checks.`,
        details: skipped,
      });
      setRejectNotes("");
      setExpandedId(null);
      await refresh();
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setActionBusy(false);
      setConfirm(null);
    }
  };

  /** Selects every row matching the current filters (not just this page). */
  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const params = new URLSearchParams({ examSlug: exam.slug, status: statusFilter });
      if (batchId) params.set("batchId", batchId);
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      const r = await ingestionApi<{ ids: string[]; total: number; capped: boolean }>(`/jobs/ids?${params}`);
      setSelected(new Set(r.ids));
      if (r.capped) {
        setNotice({
          kind: "info",
          text: `Selected the newest ${r.ids.length} of ${r.total} matching rows (bulk actions handle up to ${r.ids.length} at a time).`,
        });
      }
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setSelectingAll(false);
    }
  };

  const saveExisting =
    (job: IngestionJobDto) =>
    async (draft: StagedQuestionDraft, reviewNotes: string): Promise<boolean> => {
      try {
        const { job: updated } = await ingestionApi<{ job: IngestionJobDto }>(`/jobs/${job.id}`, {
          method: "PATCH",
          body: { draft, reviewNotes: reviewNotes.trim() || null, autoTranslate: true },
        });
        setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
        setNotice({
          kind: "success",
          text:
            updated.status === "pending_review"
              ? `Saved (with automatic Bengali translation if any field was blank) — ready for approval`
              : `Saved — still missing required text`,
        });
        return true;
      } catch (err) {
        setNotice({ kind: "error", text: (err as Error).message });
        return false;
      }
    };

  const saveNew = async (
    draft: StagedQuestionDraft,
    reviewNotes: string,
    insertLive = false
  ): Promise<boolean> => {
    try {
      const { job } = await ingestionApi<{ job: IngestionJobDto }>("/jobs", {
        method: "POST",
        body: {
          draft,
          reviewNotes: reviewNotes.trim() || null,
          autoTranslate: true,
          insertLive,
        },
      });
      setCreating(false);
      setBatchId(job.batchId);
      setStatusFilter(
        job.status === "inserted"
          ? "inserted"
          : job.status === "pending_review"
            ? "pending_review"
            : "pending_ai"
      );
      setOffset(0);
      setNotice({
        kind: "success",
        text:
          job.status === "inserted"
            ? "Question translated to Bengali & published directly to the Live Question Bank!"
            : job.status === "pending_review"
              ? "Question added (Bengali auto-translated) — approve it below to make it live"
              : "Question added — fill any remaining fields before approving",
      });
      await Promise.all([refresh(), onQuestionsChanged()]);
      return true;
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
      return false;
    }
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOnPageSelected = jobs.length > 0 && jobs.every((j) => selected.has(j.id));

  return (
    <div className="space-y-5">
      {/* ── Step 1: Add, Upload Paper (PDF/Image), Generate AI, or CSV ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setCreating(true);
                setGenerating(false);
                setExtractingPaper(false);
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add one question
            </button>

            <button
              onClick={() => {
                setExtractingPaper(true);
                setCreating(false);
                setGenerating(false);
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5" /> Upload Question Paper (PDF / Image)
            </button>

            <button
              onClick={() => {
                setGenerating(true);
                setCreating(false);
                setExtractingPaper(false);
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-violet-500 hover:bg-violet-400 text-white rounded-lg cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" /> Generate with AI
            </button>

            <button
              onClick={() =>
                downloadCsv(
                  "wbpsc-question-import-template.csv",
                  toCsv(BULK_IMPORT_TEMPLATE_EXAMPLES, BULK_IMPORT_CSV_COLUMNS)
                )
              }
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Generic CSV template
            </button>
          </div>

          <div>
            <h3 className="text-sm font-bold text-white">Bulk upload (CSV or JSON)</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Upload a spreadsheet (`.csv` or `.json`) or click{" "}
              <strong>Upload Question Paper (PDF / Image)</strong> above to extract questions
              directly from a scanned question paper or photo and insert them into the database by
              category.
            </p>
          </div>

          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-700 hover:border-amber-500/60 rounded-xl cursor-pointer text-center">
            <Upload className="w-6 h-6 text-slate-400" />
            <span className="text-xs text-slate-300">
              {file ? file.name : "Choose a .csv (Excel → CSV UTF-8) or .json file"}
            </span>
            {file && (
              <span className="text-[11px] text-slate-400">{file.rowCount} row(s) detected</span>
            )}
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={handleFilePick}
              className="hidden"
            />
          </label>

          {file?.warning && (
            <p className="flex items-center gap-1.5 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5" /> {file.warning}
            </p>
          )}

          <button
            onClick={handleUpload}
            disabled={!file || !!file.warning || uploading}
            className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
          >
            {uploading ? "Uploading & validating…" : "Upload to staging"}
          </button>

          {uploadResult && (
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-2">
              <p className="text-white font-semibold">
                {uploadResult.total} rows staged ·{" "}
                <span className="text-sky-300">{uploadResult.pendingReview} ready for review</span>{" "}
                ·{" "}
                <span className="text-amber-300">
                  {uploadResult.pendingAi} need Bengali/explanation
                </span>{" "}
                · <span className="text-rose-300">{uploadResult.failed} need fixing</span>
                {uploadResult.skippedEmpty > 0 && (
                  <span className="text-slate-400">
                    {" "}
                    · {uploadResult.skippedEmpty} empty template rows ignored
                  </span>
                )}
              </p>
              {uploadResult.errors.length > 0 && (
                <ul className="max-h-40 overflow-y-auto space-y-1 text-rose-300/90">
                  {uploadResult.errors.map((e) => (
                    <li key={`${e.rowNumber}-${e.message}`}>
                      Row {e.rowNumber}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ── Batches ──────────────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-white">Upload &amp; AI batches</h3>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            <button
              onClick={() => {
                setBatchId(null);
                setOffset(0);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer ${
                batchId === null ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/50"
              }`}
            >
              All batches
            </button>
            {batches.map((b) => (
              <button
                key={b.batchId}
                onClick={() => {
                  setBatchId(b.batchId);
                  setOffset(0);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer ${
                  batchId === b.batchId
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:bg-slate-800/50"
                }`}
              >
                <span className="block truncate font-medium">{b.fileName ?? b.batchId}</span>
                <span className="block text-[11px] text-slate-500">
                  {new Date(b.createdAt).toLocaleString()} · {b.total} rows ·{" "}
                  <span className="text-sky-300">{b.pendingReview} review</span> ·{" "}
                  <span className="text-amber-300">{b.pendingAi} bn</span> ·{" "}
                  <span className="text-emerald-300">{b.inserted} live</span>
                  {b.failed > 0 && <span className="text-rose-300"> · {b.failed} to fix</span>}
                </span>
              </button>
            ))}
            {batches.length === 0 && (
              <p className="text-xs text-slate-500 px-3">No uploads yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Panel A: Add one question (with Auto-Translate to Bengali) ─── */}
      {creating && (
        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Add one question</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Type the question and options in English. Click{" "}
                <strong>Auto-Translate to Bengali (AI)</strong> to preview the Bengali translation
                in the form, or simply leave the Bengali fields blank — when you save, it will
                automatically translate into Bengali in the background!
              </p>
            </div>
            <button
              onClick={() => setCreating(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
              aria-label="Close"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
          <JobEditor
            draft={emptyDraft(exam.slug)}
            exams={[exam]}
            trees={trees}
            editable
            onSave={saveNew}
            allowDirectLive
            saveLabel="Save to Review Queue"
          />
        </div>
      )}

      {/* ── Panel B: Upload Question Paper (PDF or Image) ──────────────── */}
      {extractingPaper && (
        <PaperUploadPanel
          exam={exam}
          onClose={() => setExtractingPaper(false)}
          onExtracted={async (res) => {
            setExtractingPaper(false);
            setBatchId(res.batchId);
            setStatusFilter(res.insertedLive > 0 ? "inserted" : "pending_review");
            setOffset(0);
            // Reload syllabus tree in case new categories were created automatically
            await trees.loadTree(exam.slug, true);
            await Promise.all([refresh(), onQuestionsChanged()]);
            setNotice({
              kind: "success",
              text: `Extracted ${res.total} question(s) from question paper using ${res.modelUsed} · ${
                res.insertedLive > 0
                  ? `${res.insertedLive} inserted directly into the Live Question Bank`
                  : `${res.pendingReview} ready in Review Queue`
              }${
                res.categoriesCreated > 0
                  ? ` · ${res.categoriesCreated} new syllabus categories auto-created`
                  : ""
              }${res.failed > 0 ? ` · ${res.failed} duplicates skipped` : ""}.`,
            });
          }}
          onError={(msg) => setNotice({ kind: "error", text: msg })}
        />
      )}

      {/* ── Panel C: Generate with AI (bank or a test series) ─────────── */}
      {generating && (
        <AiGeneratePanel
          exam={exam}
          trees={trees}
          onClose={() => setGenerating(false)}
          onGenerated={async (r) => {
            setBatchId(r.batchId);
            setStatusFilter("pending_review");
            setOffset(0);
            setNotice({
              kind: r.uniqueGenerated < r.requested ? "info" : "success",
              text: `AI drafted ${r.uniqueGenerated} unique question(s) of ${r.requested} requested · ${
                r.duplicatesDropped.exact + r.duplicatesDropped.near + r.duplicatesDropped.inBatch
              } duplicate(s) removed. Check each answer, then Save / Approve below.`,
            });
            await refresh();
          }}
          onFullSetGenerated={async (res) => {
            setBatchId(res.batchId);
            setStatusFilter(res.totalInsertedLive > 0 ? "inserted" : "pending_review");
            setOffset(0);
            await trees.loadTree(exam.slug, true);
            await Promise.all([refresh(), onQuestionsChanged()]);
            setNotice({
              kind: "success",
              text: `AI generated full set of ${res.totalGenerated} question(s) across ${res.subjectSummaries.length} subjects (${
                res.totalInsertedLive > 0
                  ? `${res.totalInsertedLive} live in Question Bank`
                  : "staged in Review Queue"
              })!`,
            });
          }}
        />
      )}

      {notice && (
        <div
          className={`p-3 rounded-lg border text-xs ${
            notice.kind === "error"
              ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
              : notice.kind === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                : "bg-sky-500/10 border-sky-500/30 text-sky-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">{notice.text}</p>
            <button
              onClick={() => setNotice(null)}
              className="cursor-pointer opacity-70 hover:opacity-100"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
          {notice.details && notice.details.length > 0 && (
            <ul className="mt-2 space-y-0.5 opacity-90">
              {notice.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Step 2: Review queue ───────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-800">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            {STATUS_TABS.map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setStatusFilter(value);
                  setOffset(0);
                  setExpandedId(null);
                }}
                className={`px-3 py-1.5 text-xs rounded-md cursor-pointer ${
                  statusFilter === value
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {statusFilter === "pending_ai" && (
          <p className="px-4 pt-3 text-xs text-amber-300/90">
            These rows are missing Bengali text or an explanation. Open any row and click{" "}
            <strong>Auto-Translate to Bengali (AI)</strong> or simply click{" "}
            <strong>Save changes</strong> — it will translate automatically!
          </p>
        )}
        {statusFilter === "failed" && (
          <p className="px-4 pt-3 text-xs text-rose-300/90">
            Rows with a wrong exam / subject / chapter / subtopic can be fixed here — open the row
            and pick from the dropdowns.
          </p>
        )}

        <ReviewFilterBar
          tree={trees.trees[exam.slug]}
          value={filters}
          onChange={(f) => {
            setFilters(f);
            setOffset(0);
          }}
        />

        <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-slate-950/60 border-b border-slate-800">
          <span className="text-xs text-white font-medium">
            {selected.size > 0 ? `${selected.size} selected` : "Bulk actions"}
          </span>
          <button
            onClick={selectAllMatching}
            disabled={selectingAll || total === 0}
            className="px-2.5 py-1 text-xs text-sky-300 hover:text-sky-200 disabled:opacity-50 cursor-pointer"
          >
            {selectingAll ? "Selecting…" : `Select all ${total} matching`}
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="px-2.5 py-1 text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Clear selection
            </button>
          )}
          <span className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs text-slate-300" title="Rows generated for a test series">
            <input type="checkbox" checked={assignToSeries} onChange={(e) => setAssignToSeries(e.target.checked)} />
            Also add series drafts to their test series
          </label>
          <button
            onClick={() => runApprove([...selected])}
            disabled={actionBusy || selected.size === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {actionBusy ? "Working…" : `Approve selected${selected.size ? ` (${selected.size})` : ""}`}
          </button>
          <button
            onClick={() => setConfirm({ kind: "reject", ids: [...selected] })}
            disabled={actionBusy || selected.size === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-rose-500/80 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5" /> Reject selected{selected.size ? ` (${selected.size})` : ""}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="p-3 w-8">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={() =>
                      setSelected(allOnPageSelected ? new Set() : new Set(jobs.map((j) => j.id)))
                    }
                  />
                </th>
                <th className="p-3 w-12">Row</th>
                <th className="p-3">Question</th>
                <th className="p-3 w-12">Ans</th>
                <th className="p-3">Tags</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
                <th className="p-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const d = job.draft;
                const lowConfidence =
                  job.aiConfidenceScore !== null && job.aiConfidenceScore < 0.7;
                const expanded = expandedId === job.id;
                return (
                  <React.Fragment key={job.id}>
                    <tr
                      className={`border-b border-slate-800/70 align-top hover:bg-slate-800/30 ${
                        lowConfidence ? "bg-amber-500/5" : ""
                      }`}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selected.has(job.id)}
                          onChange={() => toggleSelected(job.id)}
                        />
                      </td>
                      <td className="p-3 text-slate-500">{job.rowNumber ?? "—"}</td>
                      <td
                        className="p-3 cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : job.id)}
                      >
                        {d ? (
                          <>
                            <p className="text-white line-clamp-2">{d.stem.en}</p>
                            {d.stem.bn ? (
                              <p className="font-bengali text-slate-400 line-clamp-1 mt-0.5">
                                {d.stem.bn}
                              </p>
                            ) : (
                              <p className="text-amber-400/80 mt-0.5">Bengali missing</p>
                            )}
                          </>
                        ) : (
                          <p className="text-slate-500 italic">Row could not be read</p>
                        )}
                      </td>
                      <td className="p-3 font-bold text-emerald-300">{d?.correctOption ?? "—"}</td>
                      <td className="p-3 space-y-1">
                        {d && (
                          <>
                            <span className="inline-block px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 mr-1">
                              {d.source === "pyq"
                                ? pyqLabel(examLabel(d.pyqExamSlug), d.pyqYear) ?? "PYQ"
                                : d.source}
                            </span>
                            <span className="inline-block px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                              {d.difficulty}
                            </span>
                            {d.source === "pyq" && !d.answerKeyVerified && (
                              <span className="block text-amber-300">Answer key not verified</span>
                            )}
                            <span className="block text-slate-500 truncate max-w-48">
                              {d.subtopicSlug}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded border text-[11px] ${STATUS_BADGE[job.status]}`}
                        >
                          {job.status === "failed" ? "needs fixing" : job.status.replace("_", " ")}
                        </span>
                        {lowConfidence && (
                          <span className="block mt-1 text-amber-300">
                            AI confidence {Math.round((job.aiConfidenceScore ?? 0) * 100)}%
                          </span>
                        )}
                        {job.errorMessage && (
                          <span className="block mt-1 text-rose-300 max-w-72">
                            {job.errorMessage}
                          </span>
                        )}
                        {job.nearDuplicateScore !== null && job.status !== "inserted" && (
                          <span className="block mt-1 text-amber-300 max-w-72">
                            Looks like bank question {job.nearDuplicateQuestionId?.slice(0, 8)} (
                            {Math.round(job.nearDuplicateScore * 100)}% similar)
                          </span>
                        )}
                        {job.targetSeriesId && (
                          <span className="block mt-1 text-violet-300">For a test series</span>
                        )}
                      </td>
                      <td className="p-3">
                        {isEditable(job) && (
                          <div className="flex flex-wrap gap-1">
                            {job.status === "pending_review" && (
                              <button
                                onClick={() => approveOne(job)}
                                disabled={actionBusy}
                                className="px-2 py-1 text-[11px] font-semibold bg-emerald-500/90 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded cursor-pointer"
                              >
                                Approve
                              </button>
                            )}
                            <button
                              onClick={() => runReject([job.id])}
                              disabled={actionBusy}
                              className="px-2 py-1 text-[11px] font-semibold bg-rose-500/70 hover:bg-rose-500 disabled:opacity-50 text-white rounded cursor-pointer"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => setExpandedId(expanded ? null : job.id)}
                          className="text-slate-400 hover:text-white cursor-pointer"
                        >
                          {expanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-slate-800 bg-slate-950/50">
                        <td colSpan={8} className="p-4">
                          {d ? (
                            <JobEditor
                              key={`${job.id}-${job.status}`}
                              draft={d}
                              initialNotes={job.reviewNotes ?? ""}
                              exams={exams}
                              trees={trees}
                              editable={isEditable(job)}
                              reviewOnly={isAiForReview(job)}
                              readOnlyReason={`Read-only — status is “${job.status.replace("_", " ")}”.`}
                              onSave={saveExisting(job)}
                              saveLabel="Save changes"
                              actions={
                                isEditable(job)
                                  ? {
                                      busy: actionBusy,
                                      canApprove: job.status === "pending_review",
                                      onApprove: () => approveOne(job),
                                      onReject: () => runReject([job.id]),
                                    }
                                  : undefined
                              }
                            />
                          ) : (
                            <div className="space-y-2">
                              <p className="text-xs text-slate-400">
                                Fix this row in your file and upload it again. Raw data received:
                              </p>
                              <pre className="text-[11px] text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-x-auto">
                                {JSON.stringify(job.rawData, null, 2)}
                              </pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-500">
                    {loading ? "Loading…" : "Nothing here."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between p-3 text-xs text-slate-400">
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                className="px-3 py-1 bg-slate-800 rounded disabled:opacity-40 cursor-pointer"
              >
                Prev
              </button>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                className="px-3 py-1 bg-slate-800 rounded disabled:opacity-40 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {confirm?.kind === "reject" && (
        <ConfirmDialog
          title={`Reject ${confirm.ids.length} question(s)?`}
          body="Rejected questions leave the review queue and are never offered for test series. They are kept (with your reason) so the AI won't generate them again."
          confirmLabel={`Reject ${confirm.ids.length}`}
          busy={actionBusy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => runReject(confirm.ids)}
        >
          <input
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="Reason (optional, saved with each row)"
            aria-label="Rejection reason"
            className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
        </ConfirmDialog>
      )}
    </div>
  );
}

// ============================================================================
// Review-queue filters (syllabus node, difficulty, source, date range)
// ============================================================================

function ReviewFilterBar({
  tree,
  value,
  onChange,
}: {
  tree: SyllabusTreeDto | undefined;
  value: ReviewFilters;
  onChange: (f: ReviewFilters) => void;
}) {
  const subject = tree?.subjects.find((s) => s.id === value.subjectId);
  const chapter = subject?.chapters.find((c) => c.id === value.chapterId);
  const set = (patch: Partial<ReviewFilters>) => onChange({ ...value, ...patch });
  const cls = "px-2 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white min-w-0";
  const active = Object.values(value).some(Boolean);
  return (
    <div className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-slate-800" role="search" aria-label="Filter review queue">
      <select
        aria-label="Subject"
        value={value.subjectId}
        onChange={(e) => set({ subjectId: e.target.value, chapterId: "", subtopicId: "" })}
        className={cls}
      >
        <option value="">All subjects</option>
        {tree?.subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name.en}
          </option>
        ))}
      </select>
      <select
        aria-label="Chapter"
        value={value.chapterId}
        disabled={!subject}
        onChange={(e) => set({ chapterId: e.target.value, subtopicId: "" })}
        className={cls}
      >
        <option value="">All chapters / topics</option>
        {subject?.chapters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name.en}
          </option>
        ))}
      </select>
      <select
        aria-label="Subtopic"
        value={value.subtopicId}
        disabled={!chapter}
        onChange={(e) => set({ subtopicId: e.target.value })}
        className={cls}
      >
        <option value="">All subtopics</option>
        {chapter?.subtopics.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name.en}
          </option>
        ))}
      </select>
      <select aria-label="Difficulty" value={value.difficulty} onChange={(e) => set({ difficulty: e.target.value })} className={cls}>
        <option value="">Any difficulty</option>
        <option value="easy">Easy</option>
        <option value="moderate">Moderate</option>
        <option value="hard">Hard</option>
      </select>
      <select aria-label="Source" value={value.source} onChange={(e) => set({ source: e.target.value })} className={cls}>
        <option value="">Any source</option>
        <option value="ai_generated">AI generated</option>
        <option value="manual">Added in console</option>
        <option value="csv_upload">CSV upload</option>
        <option value="json_upload">JSON upload</option>
        <option value="pdf_extract">PDF / image paper</option>
      </select>
      <label className="text-[11px] text-slate-400 space-y-0.5">
        <span className="block">From</span>
        <input type="date" value={value.createdFrom} onChange={(e) => set({ createdFrom: e.target.value })} className={cls} />
      </label>
      <label className="text-[11px] text-slate-400 space-y-0.5">
        <span className="block">To</span>
        <input type="date" value={value.createdTo} onChange={(e) => set({ createdTo: e.target.value })} className={cls} />
      </label>
      {active && (
        <button onClick={() => onChange(NO_FILTERS)} className="px-2 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer">
          Clear filters
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Question Paper (PDF / Image) Upload & Auto-Categorization Panel
// ============================================================================

function PaperUploadPanel({
  exam,
  onClose,
  onExtracted,
  onError,
}: {
  exam: ExamDto;
  onClose: () => void;
  onExtracted: (res: ExtractMediaQuestionsResult & { insertedLive: number }) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [selectedMedia, setSelectedMedia] = useState<{
    name: string;
    mimeType: string;
    base64Data: string;
    sizeKb: number;
  } | null>(null);
  const [source, setSource] = useState<"pyq" | "educator">("pyq");
  const [pyqYear, setPyqYear] = useState<number>(new Date().getFullYear() - 1);
  const [insertDirectlyToBank, setInsertDirectlyToBank] = useState(true);
  const [busy, setBusy] = useState(false);

  const handleMediaPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const validMime =
      file.type === "application/pdf" ||
      file.type.startsWith("image/") ||
      /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
    if (!validMime) {
      onError("Please choose a PDF (.pdf) or Image (.png, .jpg, .jpeg, .webp) of a question paper.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      onError("File is larger than 15 MB. Please upload a smaller PDF or image.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      const mimeType =
        file.type ||
        (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      setSelectedMedia({
        name: file.name,
        mimeType,
        base64Data: base64,
        sizeKb: Math.round(file.size / 1024),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleExtract = async () => {
    if (!selectedMedia) return;
    setBusy(true);
    try {
      const res = await adminApi<ExtractMediaQuestionsResult & { insertedLive: number }>(
        "/ingestion/extract-media",
        {
          method: "POST",
          body: {
            examSlug: exam.slug,
            fileName: selectedMedia.name,
            mimeType: selectedMedia.mimeType,
            base64Data: selectedMedia.base64Data,
            source,
            pyqYear: source === "pyq" ? pyqYear : null,
            insertDirectlyToBank,
          },
        }
      );
      await onExtracted(res);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white";

  return (
    <div className="bg-slate-900 border border-sky-500/40 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <FileUp className="w-4 h-4 text-sky-400" />
            Upload Question Paper (PDF or Image) → Auto-Categorize &amp; Insert into DB
          </h3>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Upload a PDF or photo/scan of a question paper for <strong>{exam.titleEn}</strong>. AI
            Vision extracts every MCQ, translates missing English/Bengali text, writes detailed
            explanations, automatically matches or creates the right{" "}
            <strong>Subject → Chapter → Topic</strong> category, and inserts them into the database.
          </p>
        </div>
        <button
          onClick={onClose}
          disabled={busy}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>

      <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-sky-500/40 hover:border-sky-400 rounded-xl cursor-pointer text-center bg-slate-950/50">
        <FileUp className="w-6 h-6 text-sky-400" />
        <span className="text-xs font-medium text-white">
          {selectedMedia
            ? `${selectedMedia.name} (${selectedMedia.sizeKb} KB)`
            : "Click to choose a Question Paper PDF (.pdf) or Image (.jpg, .png, .webp)"}
        </span>
        <span className="text-[11px] text-slate-400">
          Supports English, Bengali, or bilingual question papers up to 15 MB
        </span>
        <input
          type="file"
          accept=".pdf,image/*,application/pdf"
          onChange={handleMediaPick}
          disabled={busy}
          className="hidden"
        />
      </label>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-slate-300 space-y-1">
          <span>Question Source</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as "pyq" | "educator")}
            disabled={busy}
            className={`${inputCls} w-52`}
          >
            <option value="pyq">Previous Year Paper (PYQ)</option>
            <option value="educator">Practice / Model Paper</option>
          </select>
        </label>

        {source === "pyq" && (
          <label className="text-xs text-slate-300 space-y-1">
            <span>Exam Year</span>
            <input
              type="number"
              min={1990}
              max={2100}
              value={pyqYear}
              onChange={(e) => setPyqYear(Number(e.target.value) || new Date().getFullYear() - 1)}
              disabled={busy}
              className={`${inputCls} w-28`}
            />
          </label>
        )}

        <label className="flex items-center gap-2 text-xs text-slate-200 pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={insertDirectlyToBank}
            onChange={(e) => setInsertDirectlyToBank(e.target.checked)}
            disabled={busy}
          />
          Insert directly into Live Question Bank (auto-approved by category)
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleExtract}
          disabled={!selectedMedia || busy}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
        >
          <Sparkles className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
          {busy
            ? "Extracting & Categorizing Questions from Paper… (20–60s)"
            : "Extract Questions & Save to Database"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Bilingual question editor (used for staged rows and "Add one question")
// Supports 1-click "Auto-Translate to Bengali (AI)" AND automatic background
// translation when saving if Bengali fields are left blank!
// ============================================================================

type TextField = "stem" | "explanation" | OptionKey;

const TEXT_FIELDS: Array<[TextField, string]> = [
  ["stem", "Question"],
  ["A", "Option A"],
  ["B", "Option B"],
  ["C", "Option C"],
  ["D", "Option D"],
  ["explanation", "Explanation"],
];

function JobEditor({
  draft: initialDraft,
  initialNotes = "",
  exams,
  trees,
  editable,
  readOnlyReason,
  onSave,
  saveLabel,
  allowDirectLive = false,
  reviewOnly = false,
  actions,
}: {
  draft: StagedQuestionDraft;
  initialNotes?: string;
  exams: ExamDto[];
  trees: SyllabusTrees;
  editable: boolean;
  readOnlyReason?: string;
  onSave: (draft: StagedQuestionDraft, notes: string, insertLive?: boolean) => Promise<boolean>;
  saveLabel: string;
  allowDirectLive?: boolean;
  /** AI question awaiting review: show it read-only with just Approve / Reject */
  reviewOnly?: boolean;
  actions?: { busy: boolean; canApprove: boolean; onApprove: () => void; onReject: () => void };
}) {
  const [d, setD] = useState<StagedQuestionDraft>(() => structuredClone(initialDraft));
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateNotice, setTranslateNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const update = (patch: Partial<StagedQuestionDraft>) => {
    setD((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const getText = (field: TextField) =>
    field === "stem" || field === "explanation" ? d[field] : d.options[field];

  const setText = (field: TextField, lang: "en" | "bn", value: string) => {
    setDirty(true);
    setD((prev) => {
      if (field === "stem" || field === "explanation") {
        return { ...prev, [field]: { ...prev[field], [lang]: value } };
      }
      return {
        ...prev,
        options: { ...prev.options, [field]: { ...prev.options[field], [lang]: value } },
      };
    });
  };

  const handleAutoTranslate = async () => {
    if (!d.stem.en.trim()) {
      setTranslateNotice("Type the English question stem first, then click Auto-Translate.");
      return;
    }
    setTranslating(true);
    setTranslateNotice(null);
    try {
      const res = await adminApi<{ draft: StagedQuestionDraft }>("/ingestion/translate-draft", {
        method: "POST",
        body: { draft: d },
      });
      setD(res.draft);
      setDirty(true);
      setTranslateNotice("Bengali translation & explanation filled in!");
    } catch (err) {
      setTranslateNotice(`Translation failed: ${(err as Error).message}`);
    } finally {
      setTranslating(false);
    }
  };

  const save = async (insertLive = false) => {
    setSaving(true);
    if (await onSave(d, notes, insertLive)) setDirty(false);
    setSaving(false);
  };

  const hasEnglishStemAndOptions =
    Boolean(d.stem.en.trim()) &&
    Boolean(d.options.A.en.trim()) &&
    Boolean(d.options.B.en.trim()) &&
    Boolean(d.options.C.en.trim()) &&
    Boolean(d.options.D.en.trim());

  const inputCls =
    "w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white disabled:opacity-70";

  const canEdit = editable && !reviewOnly;

  return (
    <div className="space-y-4">
    <fieldset disabled={!canEdit || saving || translating} className="space-y-4">
      {!editable && !reviewOnly && readOnlyReason && (
        <p className="text-xs text-slate-400">{readOnlyReason}</p>
      )}

      <SyllabusPicker
        exams={exams}
        trees={trees}
        inputCls={inputCls}
        value={{
          examSlug: d.examSlug,
          subjectSlug: d.subjectSlug,
          chapterSlug: d.chapterSlug,
          subtopicSlug: d.subtopicSlug,
        }}
        onChange={(v) => update(v)}
      />

      {/* AI Auto-Translate Toolbar */}
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-xs text-slate-300">
            <span className="font-semibold text-emerald-300">Bilingual Assistant:</span> Fill the
            English column and click the button to fill বাংলা, or leave বাংলা blank to
            auto-translate on Save.
          </div>
          <div className="flex items-center gap-2">
            {translateNotice && (
              <span className="text-[11px] text-amber-300">{translateNotice}</span>
            )}
            <button
              type="button"
              onClick={handleAutoTranslate}
              disabled={!d.stem.en.trim() || translating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white rounded-lg cursor-pointer"
            >
              <Languages className={`w-3.5 h-3.5 ${translating ? "animate-spin" : ""}`} />
              {translating ? "Translating to বাংলা…" : "Auto-Translate to Bengali (AI)"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_1fr] gap-x-3 gap-y-2 items-start">
        <span />
        <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
          English (Required)
        </span>
        <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
          বাংলা (Auto-translated on save if left blank)
        </span>
        {TEXT_FIELDS.map(([field, label]) => {
          const t = getText(field);
          const isCorrect = field === d.correctOption;
          const isOptionalEn = field === "explanation";
          return (
            <React.Fragment key={field}>
              <span
                className={`text-xs pt-1.5 ${
                  isCorrect ? "text-emerald-300 font-semibold" : "text-slate-400"
                }`}
              >
                {label}
                {isCorrect && " ✓"}
              </span>
              <textarea
                rows={field === "stem" || field === "explanation" ? 3 : 1}
                value={t.en}
                placeholder={
                  isOptionalEn
                    ? "Optional — AI will generate an explanation if left blank"
                    : `Type ${label} in English…`
                }
                onChange={(e) => setText(field, "en", e.target.value)}
                className={`${inputCls} ${
                  t.en.trim() || isOptionalEn ? "" : "border-amber-500/60"
                }`}
              />
              <textarea
                rows={field === "stem" || field === "explanation" ? 3 : 1}
                value={t.bn}
                placeholder="খালি রাখলে সেভ করার সময় স্বয়ংক্রিয়ভাবে বাংলায় অনুবাদ হবে"
                onChange={(e) => setText(field, "bn", e.target.value)}
                className={`${inputCls} font-bengali`}
              />
            </React.Fragment>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="text-xs text-slate-400 space-y-1">
          <span>Correct option</span>
          <select
            value={d.correctOption}
            onChange={(e) => update({ correctOption: e.target.value as OptionKey })}
            className={inputCls}
          >
            {OptionKeySchema.options.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400 space-y-1">
          <span>Difficulty</span>
          <select
            value={d.difficulty}
            onChange={(e) =>
              update({ difficulty: e.target.value as StagedQuestionDraft["difficulty"] })
            }
            className={inputCls}
          >
            <option value="easy">easy</option>
            <option value="moderate">moderate</option>
            <option value="hard">hard</option>
          </select>
        </label>
        <label className="text-xs text-slate-400 space-y-1">
          <span>Source</span>
          <select
            value={d.source}
            onChange={(e) => update({ source: e.target.value as StagedQuestionDraft["source"] })}
            className={inputCls}
          >
            <option value="pyq">Previous year (PYQ)</option>
            <option value="educator">Educator-framed</option>
            <option value="ai_generated">AI generated</option>
          </select>
        </label>
        {d.source === "pyq" && (
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <label className="text-xs text-slate-400 space-y-1">
              <span>PYQ exam</span>
              <input
                list="pyq-exam-options"
                value={d.pyqExamSlug ?? ""}
                placeholder="e.g. wbcs-prelims"
                onChange={(e) => update({ pyqExamSlug: e.target.value || null })}
                className={inputCls}
              />
              <datalist id="pyq-exam-options">
                {exams.map((e) => (
                  <option key={e.slug} value={e.slug}>
                    {e.titleEn}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span>Year</span>
              <input
                type="number"
                value={d.pyqYear ?? ""}
                onChange={(e) =>
                  update({ pyqYear: e.target.value ? Number(e.target.value) : null })
                }
                className={inputCls}
              />
            </label>
          </div>
        )}
      </div>

      {/* PYQ answers must match the official key; AI answers are checked by approving */}
      {!reviewOnly && d.source !== "ai_generated" && (
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={d.answerKeyVerified}
            onChange={(e) => update({ answerKeyVerified: e.target.checked })}
          />
          Answer checked against the official WBPSC answer key
          {d.source === "pyq" && !d.answerKeyVerified && (
            <span className="text-amber-300">(required before a PYQ can be approved)</span>
          )}
        </label>
      )}

      {!reviewOnly && (
        <label className="block text-xs text-slate-400 space-y-1">
          <span>Review notes</span>
          <input
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
            }}
            className={inputCls}
          />
        </label>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => save(false)}
            disabled={(!dirty && !allowDirectLive) || saving || !hasEnglishStemAndOptions}
            className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saving
              ? isDraftTextComplete(d)
                ? "Saving…"
                : "Translating to বাংলা & Saving…"
              : saveLabel}
          </button>

          {allowDirectLive && (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving || !hasEnglishStemAndOptions || !d.subtopicSlug}
              className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {saving
                ? "Translating & Publishing…"
                : "Save & Publish Directly to Live Bank"}
            </button>
          )}

          {actions && (
            <>
              <button
                type="button"
                onClick={actions.onApprove}
                disabled={actions.busy || dirty || !actions.canApprove}
                title={
                  dirty
                    ? "Save your changes first"
                    : !isDraftTextComplete(d)
                      ? "Click Save changes to auto-translate missing Bengali fields first"
                      : undefined
                }
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve
              </button>
              <button
                type="button"
                onClick={actions.onReject}
                disabled={actions.busy}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-rose-500/80 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" /> Reject
              </button>
            </>
          )}
          {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
        </div>
      )}
    </fieldset>

    {/* Outside the disabled fieldset so the buttons stay clickable */}
    {reviewOnly && actions && (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={actions.onApprove}
          disabled={actions.busy || !actions.canApprove}
          className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
        </button>
        <button
          type="button"
          onClick={actions.onReject}
          disabled={actions.busy}
          className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold bg-rose-500/80 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg cursor-pointer"
        >
          <XCircle className="w-3.5 h-3.5" /> Reject
        </button>
      </div>
    )}
    </div>
  );
}
