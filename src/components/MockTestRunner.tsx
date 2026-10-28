import React from "react";
import { Bookmark, PauseCircle } from "lucide-react";
import type { StudentExamDto } from "../../packages/shared-types/src/index";
import { formatClock, type MockQuestion, type SupportedLang } from "./types";

interface MockTestRunnerProps {
  activeExam: StudentExamDto;
  questions: MockQuestion[];
  isRemedialMode: boolean;
  lang: SupportedLang;
  currentQuestionIdx: number;
  selectedAnswers: Record<string, "A" | "B" | "C" | "D">;
  markedForReview: Record<string, boolean>;
  elapsedTotalSec: number;
  remainingSec: number;
  testLimitSec: number;
  submitting: boolean;
  pausing: boolean;
  onSelectQuestionIdx: (idx: number) => void;
  onSelectAnswer: (questionId: string, option: "A" | "B" | "C" | "D") => void;
  onClearAnswer: (questionId: string) => void;
  onToggleMarkForReview: (questionId: string) => void;
  onPauseTest: () => void;
  onSubmitTest: () => void;
}

export default function MockTestRunner({
  activeExam,
  questions,
  isRemedialMode,
  lang,
  currentQuestionIdx,
  selectedAnswers,
  markedForReview,
  elapsedTotalSec,
  remainingSec,
  testLimitSec,
  submitting,
  pausing,
  onSelectQuestionIdx,
  onSelectAnswer,
  onClearAnswer,
  onToggleMarkForReview,
  onPauseTest,
  onSubmitTest,
}: MockTestRunnerProps) {
  const q = questions[currentQuestionIdx];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="text-xs text-slate-400">
            {isRemedialMode
              ? "Remedial Weakness Mock"
              : "Official WBPSC Timed Mock"}{" "}
            · +{activeExam.marksPerCorrect} / -{activeExam.negativeMarksPerWrong}
          </div>
          <h2 className="text-lg font-bold text-white mt-0.5">
            {lang === "bn" ? activeExam.titleBn : activeExam.titleEn}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono tabular-nums text-emerald-400">
            Time Elapsed: {formatClock(elapsedTotalSec)}
          </div>
          {testLimitSec > 0 && (
            <div
              role="timer"
              aria-live={remainingSec <= 600 ? "polite" : "off"}
              className={`px-3 py-1.5 rounded-lg text-sm font-mono tabular-nums font-semibold transition-colors ${
                remainingSec <= 600
                  ? "bg-rose-600 text-white animate-pulse"
                  : "bg-slate-950 border border-slate-800 text-sky-300"
              }`}
            >
              Time Remaining: {formatClock(remainingSec)}
            </div>
          )}
          <button
            onClick={onPauseTest}
            disabled={pausing || submitting}
            title="Pause / Postpone this test and continue later from where you left off"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 disabled:opacity-50 text-amber-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PauseCircle className="w-3.5 h-3.5 text-amber-300" />
            {pausing
              ? "Saving Progress…"
              : lang === "bn"
                ? "পরীক্ষা স্থগিত করুন (Pause)"
                : "Pause / Postpone Test"}
          </button>
          <button
            onClick={onSubmitTest}
            disabled={submitting || pausing}
            className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {submitting ? "Grading…" : "Submit & Grade Test"}
          </button>
        </div>
      </div>

      {/* Question Palette */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-500" />
            Answered ({Object.keys(selectedAnswers).length})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-400" />
            Marked for Review ({Object.values(markedForReview).filter(Boolean).length})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-950 border border-slate-700" />
            Unanswered ({questions.length - Object.keys(selectedAnswers).length})
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {questions.map((item, idx) => {
            const isAnswered = Boolean(selectedAnswers[item.id]);
            const isMarked = Boolean(markedForReview[item.id]);
            const isCurrent = idx === currentQuestionIdx;
            return (
              <button
                key={item.id}
                onClick={() => onSelectQuestionIdx(idx)}
                className={`w-9 h-9 rounded-lg text-xs font-mono tabular-nums font-semibold transition-colors cursor-pointer ${
                  isCurrent
                    ? "bg-white text-slate-950"
                    : isMarked && isAnswered
                      ? "bg-violet-500/25 border border-violet-400 text-violet-200"
                      : isMarked
                        ? "bg-amber-500/20 border border-amber-400/70 text-amber-200"
                        : isAnswered
                          ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-300"
                          : "bg-slate-950 border border-slate-800 text-slate-400"
                }`}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Current Question Card */}
      {q && (
        <div className="space-y-5 pt-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              Question {currentQuestionIdx + 1} of {questions.length} ·{" "}
              {lang === "bn" ? q.subjectNameBn : q.subjectNameEn} ·{" "}
              {lang === "bn" ? q.subtopicNameBn : q.subtopicNameEn}
            </span>
            {q.previousYearTag && (
              <span className="font-mono tabular-nums">{q.previousYearTag}</span>
            )}
          </div>

          <div className="text-base sm:text-lg font-medium text-white leading-relaxed whitespace-pre-line">
            {lang === "bn" ? q.stemBn : q.stemEn}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(["A", "B", "C", "D"] as const).map((optKey) => {
              const optText =
                optKey === "A"
                  ? lang === "bn"
                    ? q.optionABn
                    : q.optionAEn
                  : optKey === "B"
                    ? lang === "bn"
                      ? q.optionBBn
                      : q.optionBEn
                    : optKey === "C"
                      ? lang === "bn"
                        ? q.optionCBn
                        : q.optionCEn
                      : lang === "bn"
                        ? q.optionDBn
                        : q.optionDEn;

              const isSel = selectedAnswers[q.id] === optKey;
              return (
                <button
                  key={optKey}
                  onClick={() => onSelectAnswer(q.id, optKey)}
                  className={`p-4 rounded-lg border text-left transition-colors flex items-center gap-3 cursor-pointer ${
                    isSel
                      ? "bg-emerald-500/15 border-emerald-500 text-white"
                      : "bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300"
                  }`}
                >
                  <span className="w-7 h-7 rounded bg-slate-800 flex items-center justify-center text-xs font-mono font-bold text-slate-200 shrink-0">
                    {optKey}
                  </span>
                  <span className="text-sm">{optText}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onClearAnswer(q.id)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Clear Response
              </button>
              <button
                type="button"
                onClick={() => onToggleMarkForReview(q.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer transition-colors ${
                  markedForReview[q.id]
                    ? "bg-amber-500/20 border-amber-400 text-amber-200"
                    : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                {markedForReview[q.id]
                  ? lang === "bn"
                    ? "পর্যালোচনার জন্য চিহ্নিত"
                    : "Marked for Review"
                  : lang === "bn"
                    ? "পর্যালোচনার জন্য রাখুন"
                    : "Mark for Review"}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                disabled={currentQuestionIdx === 0}
                onClick={() => onSelectQuestionIdx(Math.max(0, currentQuestionIdx - 1))}
                className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-lg cursor-pointer"
              >
                Previous
              </button>
              {currentQuestionIdx < questions.length - 1 ? (
                <button
                  onClick={() =>
                    onSelectQuestionIdx(
                      Math.min(questions.length - 1, currentQuestionIdx + 1)
                    )
                  }
                  className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                >
                  Next Question
                </button>
              ) : (
                <button
                  onClick={onSubmitTest}
                  disabled={submitting || pausing}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
                >
                  {submitting ? "Grading…" : "Finish & Submit"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
