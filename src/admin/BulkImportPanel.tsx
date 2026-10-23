import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  KeyRound,
  RefreshCw,
  Save,
  Upload,
  XCircle,
} from "lucide-react";
import {
  BULK_IMPORT_CSV_COLUMNS,
  BULK_IMPORT_MAX_ROWS,
  BULK_IMPORT_TEMPLATE_EXAMPLES,
  EXAM_SLUG_LABELS,
  ExamSlugSchema,
  OptionKeySchema,
  csvTableToRecords,
  isDraftTextComplete,
  parseCsv,
  pyqLabel,
  toCsv,
  type ExamSlug,
  type IngestionBatchSummary,
  type IngestionJobDto,
  type IngestionStatus,
  type IngestionUploadResult,
  type OptionKey,
  type StagedQuestionDraft,
} from "../../packages/shared-types/src/index";

// ============================================================================
// Admin Console → Bulk Import & Review
// CSV/JSON upload → api-core staging table → educator edits/approves → live bank
// ============================================================================

const API_CORE_URL =
  (import.meta.env.VITE_API_CORE_URL as string | undefined) ??
  "http://localhost:8080";
const ADMIN_KEY_STORAGE = "wbpsc.adminApiKey";
const PAGE_SIZE = 50;

type StatusFilter = IngestionStatus | "all";

const STATUS_TABS: Array<[StatusFilter, string]> = [
  ["pending_review", "Ready for review"],
  ["pending_ai", "Needs Bengali / explanation"],
  ["failed", "Failed / duplicates"],
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

const EDITABLE_STATUSES: IngestionStatus[] = ["pending_ai", "pending_review"];

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

function readStoredKey(): string {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function storeKey(key: string) {
  try {
    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  } catch {
    // Private mode / blocked storage — key just won't survive a reload
  }
}

async function ingestionApi<T>(
  path: string,
  adminKey: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${API_CORE_URL}/admin/ingestion${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "x-admin-key": adminKey,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details =
      typeof body.details === "string" ? `: ${body.details}` : "";
    throw new Error((body.error ?? `HTTP ${res.status}`) + details);
  }
  return body as T;
}

function downloadTemplate() {
  // BOM so Excel opens the Bengali sample text as UTF-8
  const csv = "﻿" + toCsv(BULK_IMPORT_TEMPLATE_EXAMPLES, BULK_IMPORT_CSV_COLUMNS);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "wbpsc-question-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function BulkImportPanel() {
  const [adminKey, setAdminKey] = useState<string>(readStoredKey);
  const [keyInput, setKeyInput] = useState<string>(adminKey);

  const [file, setFile] = useState<SelectedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<IngestionUploadResult | null>(null);

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

  const refresh = useCallback(async () => {
    if (!adminKey) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (batchId) params.set("batchId", batchId);
      const [batchRes, jobRes] = await Promise.all([
        ingestionApi<{ batches: IngestionBatchSummary[] }>("/batches", adminKey),
        ingestionApi<{ jobs: IngestionJobDto[]; total: number }>(
          `/jobs?${params}`,
          adminKey
        ),
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
  }, [adminKey, batchId, statusFilter, offset]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim();
    storeKey(key);
    setAdminKey(key);
    setNotice(null);
  };

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
      const result = await ingestionApi<IngestionUploadResult>("/upload", adminKey, {
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
      const r = await ingestionApi<ApproveResult>("/jobs/approve", adminKey, {
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
      await refresh();
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
      const r = await ingestionApi<{ rejected: number }>("/jobs/reject", adminKey, {
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

  const handleSaveDraft = async (
    job: IngestionJobDto,
    draft: StagedQuestionDraft,
    reviewNotes: string
  ): Promise<boolean> => {
    try {
      const { job: updated } = await ingestionApi<{ job: IngestionJobDto }>(
        `/jobs/${job.id}`,
        adminKey,
        { method: "PATCH", body: { draft, reviewNotes: reviewNotes.trim() || null } }
      );
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
      setNotice({
        kind: "success",
        text:
          updated.status === "pending_review"
            ? `Row ${updated.rowNumber ?? ""} saved — ready for approval`
            : `Row ${updated.rowNumber ?? ""} saved — still missing Bengali or explanation text`,
      });
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

  // ─── No admin key yet ─────────────────────────────────────────────────────
  if (!adminKey) {
    return (
      <form
        onSubmit={handleSaveKey}
        className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-lg space-y-3"
      >
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-amber-400" /> Connect to api-core
        </h3>
        <p className="text-xs text-slate-400">
          Bulk import talks to the PostgreSQL question bank through api-core ({API_CORE_URL}).
          Enter the <code className="text-emerald-300">ADMIN_API_KEY</code> configured on
          api-core. It is kept only for this browser tab.
        </p>
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="ADMIN_API_KEY"
          className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
        />
        <button
          type="submit"
          disabled={!keyInput.trim()}
          className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
        >
          Connect
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">Upload questions (CSV or JSON)</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-xl">
                One MCQ per row. Only the English stem and options are required. Blank
                Bengali or explanation cells go to “Needs Bengali / explanation”. Nothing goes
                live until you approve it below.
              </p>
            </div>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> CSV template
            </button>
          </div>

          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-700 hover:border-amber-500/60 rounded-xl cursor-pointer text-center">
            <Upload className="w-6 h-6 text-slate-400" />
            <span className="text-xs text-slate-300">
              {file ? file.name : "Choose a .csv (Excel → CSV UTF-8) or .json file"}
            </span>
            {file && (
              <span className="text-[11px] text-slate-400">
                {file.rowCount} question row(s) detected
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
                <span className="text-rose-300">{uploadResult.failed} failed</span>
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
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Upload batches</h3>
            <button
              onClick={() => {
                storeKey("");
                setAdminKey("");
              }}
              className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              Change key
            </button>
          </div>
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
                  {b.failed > 0 && <span className="text-rose-300"> · {b.failed} failed</span>}
                </span>
              </button>
            ))}
            {batches.length === 0 && (
              <p className="text-xs text-slate-500 px-3">No uploads yet.</p>
            )}
          </div>
        </div>
      </div>

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
                          <p className="text-slate-500 italic">Row could not be parsed</p>
                        )}
                      </td>
                      <td className="p-3 font-bold text-emerald-300">{d?.correctOption ?? "—"}</td>
                      <td className="p-3 space-y-1">
                        {d && (
                          <>
                            <span className="inline-block px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 mr-1">
                              {d.source === "pyq"
                                ? pyqLabel(d.pyqExamSlug, d.pyqYear) ?? "PYQ"
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
                          {job.status.replace("_", " ")}
                        </span>
                        {lowConfidence && (
                          <span className="block mt-1 text-amber-300">
                            AI confidence {Math.round((job.aiConfidenceScore ?? 0) * 100)}%
                          </span>
                        )}
                        {job.errorMessage && (
                          <span className="block mt-1 text-rose-300 max-w-64">{job.errorMessage}</span>
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
                              job={job}
                              draft={d}
                              busy={actionBusy}
                              onSave={handleSaveDraft}
                              onApprove={() => runApprove([job.id])}
                              onReject={() => runReject([job.id])}
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
// Inline bilingual editor for one staged question
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
  job,
  draft: initialDraft,
  busy,
  onSave,
  onApprove,
  onReject,
}: {
  job: IngestionJobDto;
  draft: StagedQuestionDraft;
  busy: boolean;
  onSave: (job: IngestionJobDto, draft: StagedQuestionDraft, notes: string) => Promise<boolean>;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [d, setD] = useState<StagedQuestionDraft>(() => structuredClone(initialDraft));
  const [notes, setNotes] = useState(job.reviewNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editable = EDITABLE_STATUSES.includes(job.status);

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
    if (await onSave(job, d, notes)) setDirty(false);
    setSaving(false);
  };

  const inputCls =
    "w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white disabled:opacity-70";

  return (
    <fieldset disabled={!editable || saving} className="space-y-4">
      {!editable && (
        <p className="text-xs text-slate-400">
          Read-only — status is “{job.status.replace("_", " ")}”.
          {job.status === "failed" && " Fix the row in your file and upload it again."}
        </p>
      )}

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
              <select
                value={d.pyqExamSlug ?? ""}
                onChange={(e) => update({ pyqExamSlug: (e.target.value || null) as ExamSlug | null })}
                className={inputCls}
              >
                <option value="">—</option>
                {ExamSlugSchema.options.map((s) => (
                  <option key={s} value={s}>
                    {EXAM_SLUG_LABELS[s]}
                  </option>
                ))}
              </select>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="text-xs text-slate-400 space-y-1">
          <span>Exam</span>
          <select
            value={d.examSlug}
            onChange={(e) => update({ examSlug: e.target.value as ExamSlug })}
            className={inputCls}
          >
            {ExamSlugSchema.options.map((s) => (
              <option key={s} value={s}>
                {EXAM_SLUG_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {(["subjectSlug", "chapterSlug", "subtopicSlug"] as const).map((key) => (
          <label key={key} className="text-xs text-slate-400 space-y-1">
            <span>{key.replace("Slug", "")} slug</span>
            <input
              value={d[key]}
              onChange={(e) => update({ [key]: e.target.value })}
              className={inputCls}
            />
          </label>
        ))}
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
            <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy || dirty || job.status !== "pending_review"}
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
            onClick={onReject}
            disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-rose-500/80 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5" /> Reject
          </button>
          {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
        </div>
      )}
    </fieldset>
  );
}
