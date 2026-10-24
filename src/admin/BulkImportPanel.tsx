import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
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
  type GenerateQuestionsInput,
  type GenerateQuestionsResult,
  type IngestionBatchSummary,
  type IngestionJobDto,
  type IngestionStatus,
  type IngestionUploadResult,
  type OptionKey,
  type StagedQuestionDraft,
} from "../../packages/shared-types/src/index";
import { adminApi, downloadCsv, type SyllabusTrees } from "./adminApi";
import SyllabusPicker from "./SyllabusPicker";

// ============================================================================
// Admin Console → Question Bank → Import & Review
// CSV/JSON upload or one-by-one entry → api-core staging table →
// educator edits/approves → live PostgreSQL question bank
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

/** Failed rows are editable only when they parsed into a draft (e.g. unknown syllabus path). */
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

interface ApproveResult {
  inserted: number;
  notPendingReview: number;
  invalid: Array<{ id: string; message: string }>;
  duplicates: Array<{ id: string; message: string }>;
}

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
  /** Exam being worked on — scopes the queue and new questions */
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
  }, [ingestionApi, exam.slug, batchId, statusFilter, offset]);

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

  const runApprove = async (ids: string[]) => {
    if (ids.length === 0) return;
    setActionBusy(true);
    try {
      const r = await ingestionApi<ApproveResult>("/jobs/approve", {
        method: "POST",
        body: { ids },
      });
      const problems = [...r.invalid, ...r.duplicates].map((p) => {
        const job = jobs.find((j) => j.id === p.id);
        return `${job?.rowNumber ? `Row ${job.rowNumber}` : p.id.slice(0, 8)} — ${p.message}`;
      });
      const parts = [`${r.inserted} added to the live question bank`];
      if (r.invalid.length) parts.push(`${r.invalid.length} need fixes`);
      if (r.duplicates.length) parts.push(`${r.duplicates.length} duplicates`);
      if (r.notPendingReview) parts.push(`${r.notPendingReview} skipped (not “Ready for review”)`);
      setNotice({
        kind: problems.length ? "info" : "success",
        text: parts.join(" · "),
        details: problems,
      });
      setExpandedId(null);
      await Promise.all([refresh(), onQuestionsChanged()]);
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setActionBusy(false);
    }
  };

  const runReject = async (ids: string[]) => {
    if (ids.length === 0) return;
    setActionBusy(true);
    try {
      const r = await ingestionApi<{ rejected: number }>("/jobs/reject", {
        method: "POST",
        body: { ids, reviewNotes: rejectNotes.trim() || undefined },
      });
      setNotice({ kind: "success", text: `${r.rejected} question(s) rejected` });
      setRejectNotes("");
      setExpandedId(null);
      await refresh();
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setActionBusy(false);
    }
  };

  const saveExisting =
    (job: IngestionJobDto) =>
    async (draft: StagedQuestionDraft, reviewNotes: string): Promise<boolean> => {
      try {
        const { job: updated } = await ingestionApi<{ job: IngestionJobDto }>(`/jobs/${job.id}`, {
          method: "PATCH",
          body: { draft, reviewNotes: reviewNotes.trim() || null },
        });
        setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
        setNotice({
          kind: "success",
          text:
            updated.status === "pending_review"
              ? `Saved — ready for approval`
              : `Saved — still missing Bengali or explanation text`,
        });
        return true;
      } catch (err) {
        setNotice({ kind: "error", text: (err as Error).message });
        return false;
      }
    };

  const saveNew = async (draft: StagedQuestionDraft, reviewNotes: string): Promise<boolean> => {
    try {
      const { job } = await ingestionApi<{ job: IngestionJobDto }>("/jobs", {
        method: "POST",
        body: { draft, reviewNotes: reviewNotes.trim() || null },
      });
      setCreating(false);
      setBatchId(job.batchId);
      setStatusFilter(job.status === "pending_review" ? "pending_review" : "pending_ai");
      setOffset(0);
      setNotice({
        kind: "success",
        text:
          job.status === "pending_review"
            ? "Question added — approve it below to make it live"
            : "Question added — fill the Bengali / explanation before approving",
      });
      await refresh();
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
      {/* ── Step 1: Upload or add ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setCreating(true);
                setGenerating(false);
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add one question
            </button>
            <button
              onClick={() => {
                setGenerating(true);
                setCreating(false);
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
              <Download className="w-3.5 h-3.5" /> Generic template (examples)
            </button>
          </div>

          <div>
            <h3 className="text-sm font-bold text-white">Bulk upload (CSV or JSON)</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Easiest: click <strong>Question template for this exam</strong> above — every
              subtopic is pre-filled, just type questions next to them (empty rows are ignored).
              Names or codes both work; typos get a “Did you mean…” hint and can be fixed below
              with dropdowns.
            </p>
          </div>

          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-700 hover:border-amber-500/60 rounded-xl cursor-pointer text-center">
            <Upload className="w-6 h-6 text-slate-400" />
            <span className="text-xs text-slate-300">
              {file ? file.name : "Choose a .csv (Excel → CSV UTF-8) or .json file"}
            </span>
            {file && (
              <span className="text-[11px] text-slate-400">
                {file.rowCount} row(s) detected
              </span>
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
                <span className="text-sky-300">{uploadResult.pendingReview} ready for review</span> ·{" "}
                <span className="text-amber-300">{uploadResult.pendingAi} need Bengali/explanation</span> ·{" "}
                <span className="text-rose-300">{uploadResult.failed} need fixing</span>
                {uploadResult.skippedEmpty > 0 && (
                  <span className="text-slate-400"> · {uploadResult.skippedEmpty} empty template rows ignored</span>
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
          <h3 className="text-sm font-bold text-white">Upload batches</h3>
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

      {creating && (
        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Add one question</h3>
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
            saveLabel="Add to review queue"
          />
        </div>
      )}

      {generating && (
        <AiGeneratePanel
          exam={exam}
          trees={trees}
          onClose={() => setGenerating(false)}
          onGenerate={async (input) => {
            try {
              const r = await ingestionApi<GenerateQuestionsResult>("/generate", {
                method: "POST",
                body: input,
              });
              setGenerating(false);
              setBatchId(r.batchId);
              setStatusFilter("pending_review");
              setOffset(0);
              setNotice({
                kind: r.failed ? "info" : "success",
                text: `AI drafted ${r.total} question(s) with ${r.modelUsed}${
                  r.cacheTier === "gemini" ? "" : " (served from cache — no AI cost)"
                } · ${r.pendingReview} ready for review${
                  r.failed ? ` · ${r.failed} skipped as duplicates` : ""
                }. Check each answer, tick “Answer checked”, save, then approve.`,
              });
              await refresh();
            } catch (err) {
              setNotice({ kind: "error", text: (err as Error).message });
            }
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
            <button onClick={() => setNotice(null)} className="cursor-pointer opacity-70 hover:opacity-100">
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
            These rows are missing Bengali text or an explanation. Open a row to fill the gaps
            yourself, or re-upload the file with the _bn / explanation columns filled. AI enrichment
            (api-ai) will process this queue once it is connected.
          </p>
        )}
        {statusFilter === "failed" && (
          <p className="px-4 pt-3 text-xs text-rose-300/90">
            Rows with a wrong exam / subject / chapter / subtopic can be fixed here — open the row
            and pick from the dropdowns. Rows that could not be read at all must be fixed in the
            file and uploaded again.
          </p>
        )}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-slate-950/60 border-b border-slate-800">
            <span className="text-xs text-white font-medium">{selected.size} selected</span>
            <button
              onClick={() => runApprove([...selected])}
              disabled={actionBusy}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Approve → live bank
            </button>
            <input
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Reject reason (optional)"
              className="px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white w-56"
            />
            <button
              onClick={() => runReject([...selected])}
              disabled={actionBusy}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-rose-500/80 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" /> Reject
            </button>
          </div>
        )}

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
                          className={`inline-block px-2 py-0.5 rounded-full border text-[11px] ${STATUS_BADGE[job.status]}`}
                        >
                          {job.status === "failed" ? "needs fixing" : job.status.replace("_", " ")}
                        </span>
                        {lowConfidence && (
                          <span className="block mt-1 text-amber-300">
                            AI confidence {Math.round((job.aiConfidenceScore ?? 0) * 100)}%
                          </span>
                        )}
                        {job.errorMessage && (
                          <span className="block mt-1 text-rose-300 max-w-72">{job.errorMessage}</span>
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
                        <td colSpan={7} className="p-4">
                          {d ? (
                            <JobEditor
                              key={`${job.id}-${job.status}`}
                              draft={d}
                              initialNotes={job.reviewNotes ?? ""}
                              exams={exams}
                              trees={trees}
                              editable={isEditable(job)}
                              readOnlyReason={`Read-only — status is “${job.status.replace("_", " ")}”.`}
                              onSave={saveExisting(job)}
                              saveLabel="Save changes"
                              actions={
                                isEditable(job)
                                  ? {
                                      busy: actionBusy,
                                      canApprove: job.status === "pending_review",
                                      onApprove: () => runApprove([job.id]),
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
                  <td colSpan={7} className="p-6 text-center text-slate-500">
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
    </div>
  );
}

// ============================================================================
// AI PYQ-clone generator form (Pipeline 3)
// ============================================================================

function AiGeneratePanel({
  exam,
  trees,
  onGenerate,
  onClose,
}: {
  exam: ExamDto;
  trees: SyllabusTrees;
  onGenerate: (input: GenerateQuestionsInput) => Promise<void>;
  onClose: () => void;
}) {
  const [path, setPath] = useState({
    examSlug: exam.slug,
    subjectSlug: "",
    chapterSlug: "",
    subtopicSlug: "",
  });
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<GenerateQuestionsInput["difficulty"]>("mixed");
  const [busy, setBusy] = useState(false);

  const inputCls =
    "w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white disabled:opacity-70";

  return (
    <div className="bg-slate-900 border border-violet-500/40 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-300" /> Generate questions with AI
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Writes new bilingual MCQs in real WBPSC style for one subtopic, using the existing
            PYQs of that subtopic as examples and avoiding questions already in the bank. They
            land in the review queue — <strong>check every answer</strong> and tick “Answer
            checked” before approving. One batch takes about 20–60 seconds.
          </p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer" aria-label="Close">
          <XCircle className="w-4 h-4" />
        </button>
      </div>

      <fieldset disabled={busy} className="space-y-4">
        <SyllabusPicker
          exams={[exam]}
          trees={trees}
          inputCls={inputCls}
          value={path}
          onChange={setPath}
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400 space-y-1">
            <span>How many (1–25)</span>
            <input
              type="number"
              min={1}
              max={25}
              value={count}
              onChange={(e) => setCount(Math.min(25, Math.max(1, Number(e.target.value) || 1)))}
              className={`${inputCls} w-24`}
            />
          </label>
          <label className="text-xs text-slate-400 space-y-1">
            <span>Difficulty</span>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as GenerateQuestionsInput["difficulty"])}
              className={`${inputCls} w-40`}
            >
              <option value="mixed">Mixed (like real paper)</option>
              <option value="easy">Easy</option>
              <option value="moderate">Moderate</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <button
            onClick={async () => {
              setBusy(true);
              await onGenerate({ ...path, count, difficulty });
              setBusy(false);
            }}
            disabled={!path.subtopicSlug}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white rounded-lg cursor-pointer"
          >
            <Sparkles className={`w-3.5 h-3.5 ${busy ? "animate-pulse" : ""}`} />
            {busy ? "Generating… (up to a minute)" : `Generate ${count} questions`}
          </button>
        </div>
      </fieldset>
    </div>
  );
}

// ============================================================================
// Bilingual question editor (used for staged rows and "Add one question")
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
  actions,
}: {
  draft: StagedQuestionDraft;
  initialNotes?: string;
  exams: ExamDto[];
  trees: SyllabusTrees;
  editable: boolean;
  readOnlyReason?: string;
  onSave: (draft: StagedQuestionDraft, notes: string) => Promise<boolean>;
  saveLabel: string;
  actions?: { busy: boolean; canApprove: boolean; onApprove: () => void; onReject: () => void };
}) {
  const [d, setD] = useState<StagedQuestionDraft>(() => structuredClone(initialDraft));
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
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

  const save = async () => {
    setSaving(true);
    if (await onSave(d, notes)) setDirty(false);
    setSaving(false);
  };

  const inputCls =
    "w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white disabled:opacity-70";

  return (
    <fieldset disabled={!editable || saving} className="space-y-4">
      {!editable && readOnlyReason && <p className="text-xs text-slate-400">{readOnlyReason}</p>}

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

      <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_1fr] gap-x-3 gap-y-2 items-start">
        <span />
        <span className="text-[11px] uppercase tracking-wide text-slate-500">English</span>
        <span className="text-[11px] uppercase tracking-wide text-slate-500">বাংলা</span>
        {TEXT_FIELDS.map(([field, label]) => {
          const t = getText(field);
          const isCorrect = field === d.correctOption;
          return (
            <React.Fragment key={field}>
              <span
                className={`text-xs pt-1.5 ${isCorrect ? "text-emerald-300 font-semibold" : "text-slate-400"}`}
              >
                {label}
                {isCorrect && " ✓"}
              </span>
              <textarea
                rows={field === "stem" || field === "explanation" ? 3 : 1}
                value={t.en}
                onChange={(e) => setText(field, "en", e.target.value)}
                className={`${inputCls} ${t.en.trim() ? "" : "border-amber-500/60"}`}
              />
              <textarea
                rows={field === "stem" || field === "explanation" ? 3 : 1}
                value={t.bn}
                onChange={(e) => setText(field, "bn", e.target.value)}
                className={`${inputCls} font-bengali ${t.bn.trim() ? "" : "border-amber-500/60"}`}
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
            onChange={(e) => update({ difficulty: e.target.value as StagedQuestionDraft["difficulty"] })}
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
                onChange={(e) => update({ pyqYear: e.target.value ? Number(e.target.value) : null })}
                className={inputCls}
              />
            </label>
          </div>
        )}
      </div>

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

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : saveLabel}
          </button>
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
                      ? "Fill every Bengali field and the explanation first"
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
  );
}
