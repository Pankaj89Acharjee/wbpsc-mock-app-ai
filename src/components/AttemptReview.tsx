import React, { useEffect, useState } from "react";
import { CheckCircle2, Clock, MinusCircle, XCircle, X } from "lucide-react";
import type {
  AttemptReviewDto,
  AttemptReviewItemDto,
  OptionKey,
} from "../../packages/shared-types/src/index";
import { api } from "../api";

// ============================================================================
// Question-by-question review of a submitted mock attempt (loaded from
// api-core): your answer vs correct answer, marks awarded/deducted, explanation.
// ============================================================================

type Filter = "all" | "correct" | "wrong" | "unanswered";

const OPTION_KEYS: OptionKey[] = ["A", "B", "C", "D"];

function formatMarks(m: number): string {
  if (m > 0) return `+${m}`;
  if (m < 0) return `−${Math.abs(m)}`;
  return "0";
}

const statusOf = (r: AttemptReviewItemDto): Exclude<Filter, "all"> =>
  r.selectedOption === null
    ? "unanswered"
    : r.selectedOption === r.correctOption
      ? "correct"
      : "wrong";

export default function AttemptReview({
  attemptId,
  lang,
  onClose,
}: {
  attemptId: string;
  lang: "en" | "bn";
  onClose: () => void;
}) {
  const [review, setReview] = useState<AttemptReviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    setReview(null);
    setError(null);
    api<AttemptReviewDto>(`/me/attempts/${attemptId}/review`)
      .then(setReview)
      .catch((err: Error) => setError(err.message));
  }, [attemptId]);

  const bnCls = lang === "bn" ? "font-bengali" : "";
  const pick = (t: { en: string; bn: string }) => (lang === "bn" ? t.bn || t.en : t.en || t.bn);

  if (error) {
    return <p className="p-4 text-xs text-rose-300">{error}</p>;
  }
  if (!review) {
    return <p className="p-4 text-xs text-slate-400">Loading answers…</p>;
  }

  const { attempt, items } = review;
  const visible = items
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => filter === "all" || statusOf(r) === filter);

  const FILTERS: Array<[Filter, string, number]> = [
    ["all", "All", items.length],
    ["correct", "Correct", attempt.correctCount],
    ["wrong", "Wrong", attempt.incorrectCount],
    ["unanswered", "Unanswered", attempt.unansweredCount],
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 border-b border-slate-800">
        <div>
          <h3 className={`text-sm font-bold text-white ${bnCls}`}>
            Answer review — {lang === "bn" ? attempt.examTitleBn : attempt.examTitleEn}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() + " · " : ""}
            Net score{" "}
            <span className="font-mono text-white font-semibold">
              {attempt.finalNetScore} / {attempt.maxPossibleScore}
            </span>
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white cursor-pointer"
          aria-label="Close review"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1 p-3 border-b border-slate-800">
        {FILTERS.map(([value, label, count]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`px-3 py-1.5 text-xs rounded-md cursor-pointer ${
              filter === value ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      <div className="divide-y divide-slate-800">
        {visible.map(({ r, idx }) => {
          const status = statusOf(r);
          return (
            <div key={`${r.questionId}-${idx}`} className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-white">Q{idx + 1}</span>
                  {status === "correct" && (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Correct
                    </span>
                  )}
                  {status === "wrong" && (
                    <span className="flex items-center gap-1 text-rose-400">
                      <XCircle className="w-3.5 h-3.5" /> Wrong
                    </span>
                  )}
                  {status === "unanswered" && (
                    <span className="flex items-center gap-1 text-slate-400">
                      <MinusCircle className="w-3.5 h-3.5" /> Not answered
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-slate-500">
                    <Clock className="w-3 h-3" /> {r.timeSpentSeconds}s
                  </span>
                  <span className={`text-slate-500 ${bnCls}`}>· {pick(r.subtopicName)}</span>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full border text-xs font-mono font-semibold ${
                    r.marksAwarded > 0
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                      : r.marksAwarded < 0
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                        : "bg-slate-800 border-slate-700 text-slate-400"
                  }`}
                >
                  {formatMarks(r.marksAwarded)} marks
                </span>
              </div>

              <p className={`text-sm text-white leading-relaxed whitespace-pre-line ${bnCls}`}>
                {pick(r.stem)}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {OPTION_KEYS.map((key) => {
                  const isCorrect = key === r.correctOption;
                  const isChosen = key === r.selectedOption;
                  return (
                    <div
                      key={key}
                      className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${
                        isCorrect
                          ? "border-emerald-500/50 bg-emerald-500/10"
                          : isChosen
                            ? "border-rose-500/50 bg-rose-500/10"
                            : "border-slate-800 bg-slate-950"
                      }`}
                    >
                      <span className="font-bold text-slate-300">{key}.</span>
                      <span className={`flex-1 text-slate-200 ${bnCls}`}>{pick(r.options[key])}</span>
                      {isChosen && (
                        <span
                          className={`shrink-0 text-[11px] font-semibold ${
                            isCorrect ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          Your answer
                        </span>
                      )}
                      {isCorrect && !isChosen && (
                        <span className="shrink-0 text-[11px] font-semibold text-emerald-300">
                          Correct answer
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <p className="text-[11px] uppercase tracking-wide text-amber-400 font-semibold mb-1">
                  {lang === "bn" ? "ব্যাখ্যা" : "Explanation"}
                </p>
                <p className={`text-xs text-slate-300 leading-relaxed ${bnCls}`}>
                  {pick(r.explanation)}
                </p>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="p-5 text-xs text-slate-500 text-center">No questions in this filter.</p>
        )}
      </div>
    </div>
  );
}
