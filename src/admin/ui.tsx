import React, { useEffect, useRef } from "react";
import { XCircle } from "lucide-react";
import type { PublishStatus } from "../../packages/shared-types/src/index";

// ============================================================================
// Small presentational pieces shared by the exam series screens.
// ============================================================================

export type Notice = { kind: "success" | "error" | "info"; text: string; details?: string[] };

export function NoticeBox({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  if (!notice) return null;
  const tone =
    notice.kind === "error"
      ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
      : notice.kind === "success"
        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
        : "bg-sky-500/10 border-sky-500/30 text-sky-200";
  return (
    <div role={notice.kind === "error" ? "alert" : "status"} className={`p-3 rounded-lg border text-xs ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{notice.text}</p>
        <button onClick={onClose} aria-label="Dismiss" className="cursor-pointer opacity-70 hover:opacity-100">
          <XCircle className="w-4 h-4" />
        </button>
      </div>
      {notice.details && notice.details.length > 0 && (
        <ul className="mt-2 space-y-0.5 opacity-90 max-h-40 overflow-y-auto">
          {notice.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct >= 100 ? "bg-emerald-400" : pct >= 50 ? "bg-amber-400" : "bg-sky-400";
  return (
    <div
      className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const STATUS_TONE: Record<PublishStatus, string> = {
  draft: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  published: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  archived: "bg-slate-700/40 text-slate-400 border-slate-600",
};

export function StatusBadge({ status }: { status: PublishStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-[11px] ${STATUS_TONE[status]}`}>
      {status}
    </span>
  );
}

/** Modal confirm for destructive or bulk actions. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = "danger",
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4 shadow-xl">
        <h2 id="confirm-title" className="text-sm font-bold text-white">
          {title}
        </h2>
        <p className="text-xs text-slate-300">{body}</p>
        {children}
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50 ${
              tone === "danger"
                ? "bg-rose-500 hover:bg-rose-400 text-white"
                : "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const inputCls =
  "w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white disabled:opacity-60";

export const btn = {
  primary:
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer",
  secondary:
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg cursor-pointer",
  danger:
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-rose-500/80 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg cursor-pointer",
  ai: "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white rounded-lg cursor-pointer",
  ghost:
    "inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-50 cursor-pointer",
};
