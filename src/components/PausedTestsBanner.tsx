import React from "react";
import { PauseCircle, Play, Trash2 } from "lucide-react";
import type { PausedAttemptDto } from "../../packages/shared-types/src/index";
import { formatClock, type SupportedLang } from "./types";

interface PausedTestsBannerProps {
  pausedAttempts: PausedAttemptDto[];
  lang: SupportedLang;
  onResume: (paused: PausedAttemptDto) => void;
  onDiscard: (attemptId: string) => void;
}

export default function PausedTestsBanner({
  pausedAttempts,
  lang,
  onResume,
  onDiscard,
}: PausedTestsBannerProps) {
  if (pausedAttempts.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-amber-300 flex items-center gap-2">
            <PauseCircle className="w-4 h-4 text-amber-400" />
            {lang === "bn"
              ? `স্থগিত / চলমান পরীক্ষা (${pausedAttempts.length})`
              : `Paused / Postponed Ongoing Tests (${pausedAttempts.length})`}
          </h2>
          <p className="text-xs text-slate-300 mt-0.5">
            {lang === "bn"
              ? "আপনি যেখানে থামিয়েছিলেন ঠিক সেখান থেকেই আপনার স্থগিত পরীক্ষাটি পুনরায় শুরু করুন।"
              : "Continue your postponed exam from the exact question, timer, and saved answers where you left off."}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {pausedAttempts.map((pa) => (
          <div
            key={pa.attemptId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-slate-950/85 p-3.5"
          >
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-bold text-white truncate">
                {lang === "bn" ? pa.examTitleBn : pa.examTitleEn}
              </p>
              <p className="text-xs font-mono text-amber-300">
                {pa.answeredCount}/{pa.totalQuestions} Answered ·{" "}
                {formatClock(pa.totalTimeSpentSeconds)} elapsed ·{" "}
                {pa.durationMinutes} min total
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onResume(pa)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                {lang === "bn" ? "চালিয়ে যান (Resume)" : "Resume Exam"}
              </button>
              <button
                type="button"
                onClick={() => onDiscard(pa.attemptId)}
                title="Discard this paused attempt"
                className="p-2 text-xs text-slate-400 hover:text-rose-300 bg-slate-900 border border-slate-800 rounded-lg cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
