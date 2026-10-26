import React, { useState } from "react";
import type { AttemptSummaryDto } from "../../packages/shared-types/src/index";
import AttemptReview from "./AttemptReview";

// ============================================================================
// The student's submitted attempts, newest first, each with an inline
// answer-by-answer review. Used on the Mock Tests page and inside an exam.
// ============================================================================

type Lang = "en" | "bn";

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** What was taken: a test series, or a random/remedial mock. */
function testName(a: AttemptSummaryDto, lang: Lang, showExam: boolean) {
  const exam = lang === "bn" ? a.examTitleBn : a.examTitleEn;
  if (a.series) {
    return { main: lang === "bn" ? a.series.name.bn : a.series.name.en, sub: showExam ? exam : null };
  }
  const kind = a.isRemedial ? "Remedial mock" : "Random mock";
  return showExam ? { main: exam, sub: kind } : { main: kind, sub: null };
}

export default function AttemptHistory({
  attempts,
  lang,
  showExam = true,
  highlightId,
  emptyText,
}: {
  attempts: AttemptSummaryDto[];
  lang: Lang;
  /** Whether to name the exam (off inside an exam's own page) */
  showExam?: boolean;
  /** Just-submitted attempt, tinted so it is easy to spot */
  highlightId?: string | null;
  emptyText: string;
}) {
  const [reviewId, setReviewId] = useState<string | null>(null);

  if (attempts.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-400">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-3 px-4">Test</th>
              <th className="py-3 px-4 whitespace-nowrap">Taken on</th>
              <th className="py-3 px-4 text-right">Attempted</th>
              <th className="py-3 px-4 text-right">Correct</th>
              <th className="py-3 px-4 text-right">Wrong</th>
              <th className="py-3 px-4 text-right whitespace-nowrap">Net Score</th>
              <th className="py-3 px-4 text-right">Accuracy</th>
              <th className="py-3 px-4">Cutoff</th>
              <th className="py-3 px-4 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {attempts.map((att) => {
              const name = testName(att, lang, showExam);
              const open = reviewId === att.id;
              return (
                <tr
                  key={att.id}
                  className={`hover:bg-slate-800/40 transition-colors ${
                    open ? "bg-slate-800/40" : att.id === highlightId ? "bg-emerald-500/10" : ""
                  }`}
                >
                  <td className="py-3 px-4 min-w-[12rem]">
                    <span className="font-medium text-white">{name.main}</span>
                    {name.sub && <span className="block text-[11px] text-slate-500">{name.sub}</span>}
                    {att.id === highlightId && (
                      <span className="mt-0.5 inline-block rounded bg-emerald-500/20 px-1.5 text-[10px] font-semibold text-emerald-300">
                        Just submitted
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap text-slate-400">
                    {att.submittedAt ? dateFmt.format(new Date(att.submittedAt)) : "—"}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {att.attemptedCount}/{att.totalQuestions}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-400">
                    {att.correctCount}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-rose-400">
                    {att.incorrectCount}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-white whitespace-nowrap">
                    {att.finalNetScore} / {att.maxPossibleScore}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{att.accuracyPercentage}%</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className={att.cutoffCleared ? "text-emerald-300" : "text-amber-300"}>
                      {att.cutoffCleared ? "Cleared" : "Below"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setReviewId(open ? null : att.id)}
                      aria-expanded={open}
                      className="px-3 py-1 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-amber-300 whitespace-nowrap cursor-pointer"
                    >
                      {open ? "Hide" : "Review answers"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {reviewId && <AttemptReview attemptId={reviewId} lang={lang} onClose={() => setReviewId(null)} />}
    </div>
  );
}
