import React from "react";
import { ArrowLeft, Award, ChevronRight, Clock, FileText, PauseCircle, Play, RotateCcw, Shuffle } from "lucide-react";
import type {
  AttemptSummaryDto,
  SeriesKind,
  StudentExamDto,
  StudentSeriesDto,
} from "../../packages/shared-types/src/index";
import { SERIES_KIND_LABELS } from "../../packages/shared-types/src/index";

// ============================================================================
// Student "Mock Tests" library: one stacked card per exam type with its test
// series counts; opening a card slides in that exam's series, each a test.
// ============================================================================

type Lang = "en" | "bn";


/** Card order and short labels, e.g. "Test Series 5 · Previous Year 15" */
const KIND_ORDER: SeriesKind[] = ["mock_test", "previous_year", "practice", "custom"];
const KIND_SHORT: Record<SeriesKind, { en: string; bn: string }> = {
  mock_test: { en: "Test Series", bn: "টেস্ট সিরিজ" },
  previous_year: { en: "Previous Year", bn: "বিগত বছর" },
  practice: { en: "Practice Sets", bn: "অনুশীলন" },
  custom: { en: "Other", bn: "অন্যান্য" },
};

const KIND_ACCENT: Record<SeriesKind, string> = {
  mock_test: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  previous_year: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  practice: "text-sky-300 border-sky-500/30 bg-sky-500/10",
  custom: "text-slate-300 border-slate-600 bg-slate-800/60",
};

const totalSeries = (e: StudentExamDto) => KIND_ORDER.reduce((n, k) => n + (e.seriesCounts[k] ?? 0), 0);

export function ExamCards({
  exams,
  lang,
  onOpen,
}: {
  exams: StudentExamDto[];
  lang: Lang;
  onOpen: (exam: StudentExamDto) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-8 pt-2">
      {exams.map((exam) => {
        const kinds = KIND_ORDER.filter((k) => (exam.seriesCounts[k] ?? 0) > 0);
        const total = totalSeries(exam);
        return (
          <button
            key={exam.id}
            type="button"
            onClick={() => onOpen(exam)}
            className="group relative text-left cursor-pointer focus:outline-none"
          >
            {/* The "pile": two sheets peeking out behind the card */}
            <span
              aria-hidden="true"
              className="absolute inset-x-4 -top-3 h-full rounded-xl border border-slate-800 bg-slate-900/40 transition-transform duration-300 group-hover:-translate-y-1"
            />
            <span
              aria-hidden="true"
              className="absolute inset-x-2 -top-1.5 h-full rounded-xl border border-slate-800 bg-slate-900/70 transition-transform duration-300 group-hover:-translate-y-0.5"
            />
            <span className="relative flex h-full flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5 transition-all duration-300 group-hover:-translate-y-1 group-hover:border-emerald-500/50 group-focus-visible:border-emerald-400 group-focus-visible:ring-2 group-focus-visible:ring-emerald-400/40">
              <span className="space-y-1.5">
                <span className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-mono">{exam.slug}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{exam.questionCount} MCQs in bank</span>
                </span>
                <span className="block text-lg font-bold text-white">
                  {lang === "bn" ? exam.titleBn : exam.titleEn}
                </span>
                <span className="block text-sm text-slate-400 leading-relaxed line-clamp-2">
                  {lang === "bn" ? exam.descriptionBn : exam.descriptionEn}
                </span>
              </span>

              {kinds.length > 0 ? (
                <span className="grid grid-cols-2 gap-2">
                  {kinds.map((k) => (
                    <span key={k} className={`rounded-lg border px-3 py-2 ${KIND_ACCENT[k]}`}>
                      <span className="block text-[11px] font-medium opacity-90">{KIND_SHORT[k][lang]}</span>
                      <span className="block text-xl font-bold font-mono tabular-nums">{exam.seriesCounts[k]}</span>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-400">
                  {lang === "bn"
                    ? "এখনও কোনো সিরিজ নেই — র‍্যান্ডম মক টেস্ট দেওয়া যাবে।"
                    : "No test series yet — a random mock test is available."}
                </span>
              )}

              <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {(exam.myPausedCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold">
                    <PauseCircle className="w-3 h-3" />
                    {lang === "bn"
                      ? `${exam.myPausedCount}টি স্থগিত পরীক্ষা (চালিয়ে যান)`
                      : `${exam.myPausedCount} Paused — Resume`}
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono ${
                    (exam.myAttemptCount ?? 0) > 0
                      ? "bg-violet-500/15 border-violet-500/35 text-violet-300 font-semibold"
                      : "bg-slate-950 border-slate-800 text-slate-400"
                  }`}
                >
                  <Award className="w-3 h-3" />
                  {lang === "bn"
                    ? `আপনি দিয়েছেন: ${exam.myAttemptCount ?? 0} বার`
                    : `Attempted ${exam.myAttemptCount ?? 0} ${(exam.myAttemptCount ?? 0) === 1 ? "time" : "times"}`}
                </span>
              </span>

              <span className="mt-auto flex items-center justify-between border-t border-slate-800 pt-3 text-xs">
                <span className="text-slate-400 font-mono tabular-nums">
                  {total} {lang === "bn" ? "টি টেস্ট" : total === 1 ? "test" : "tests"}
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                  {lang === "bn" ? "খুলুন" : "Open"}
                  <ChevronRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const seriesMeta = (s: StudentSeriesDto) =>
  `${s.totalQuestions} Qs · ${s.durationMinutes} min · +${s.marksPerCorrect} / −${s.negativeMarksPerWrong}`;

export function ExamSeriesView({
  exam,
  series,
  lang,
  onBack,
  onStartSeries,
  onResumeSeries,
  onStartRandom,
  children,
}: {
  exam: StudentExamDto;
  /** undefined while loading */
  series: StudentSeriesDto[] | undefined;
  lang: Lang;
  onBack: () => void;
  onStartSeries: (series: StudentSeriesDto) => void;
  onResumeSeries?: (series: StudentSeriesDto) => void;
  onStartRandom: () => void;
  /** Rendered under the series, e.g. the student's history for this exam */
  children?: React.ReactNode;
}) {
  const kinds = KIND_ORDER.filter((k) => series?.some((s) => s.kind === k));

  return (
    <section
      className="exam-slide-in overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-5 sm:p-6 space-y-6"
      aria-labelledby="exam-series-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> {lang === "bn" ? "সব পরীক্ষা" : "All exams"}
          </button>
          <h2 id="exam-series-title" className="text-xl font-bold text-white">
            {lang === "bn" ? exam.titleBn : exam.titleEn}
          </h2>
          <p className="text-xs text-slate-400 font-mono tabular-nums">
            {exam.slug} · {exam.questionCount} MCQs in bank ·{" "}
            {lang === "bn"
              ? `আপনার মোট প্রচেষ্টা: ${exam.myAttemptCount ?? 0} বার`
              : `Attempted ${exam.myAttemptCount ?? 0} ${(exam.myAttemptCount ?? 0) === 1 ? "time" : "times"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onStartRandom}
          disabled={exam.questionCount === 0}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg whitespace-nowrap cursor-pointer"
          title={`${exam.durationMinutes} min · −${exam.negativeMarksPerWrong} per wrong answer`}
        >
          <Shuffle className="w-4 h-4" />
          {lang === "bn" ? "র‍্যান্ডম মক টেস্ট" : "Random mock test"}
        </button>
      </div>

      {!series ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : series.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
          {lang === "bn"
            ? "এই পরীক্ষার জন্য এখনও কোনো টেস্ট সিরিজ প্রকাশিত হয়নি। র‍্যান্ডম মক টেস্ট দিয়ে শুরু করুন।"
            : "No test series has been published for this exam yet. Try a random mock test meanwhile."}
        </p>
      ) : (
        <div className="exam-stagger space-y-8">
          {kinds.map((kind, i) => (
            <div key={kind} className="space-y-3" style={{ "--i": i } as React.CSSProperties}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className={`rounded-md border px-2 py-0.5 text-[11px] ${KIND_ACCENT[kind]}`}>
                  {KIND_SHORT[kind][lang]}
                </span>
                <span className="text-slate-400 font-normal">{SERIES_KIND_LABELS[kind]}</span>
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {series
                  .filter((s) => s.kind === kind)
                  .map((s) => {
                    const attemptsCount = s.myAttemptCount ?? 0;
                    const isPaused = Boolean(s.myPausedAttemptId);
                    return (
                      <li
                        key={s.id}
                        className={`flex flex-col gap-3 rounded-lg border p-4 transition-colors ${
                          isPaused
                            ? "border-amber-500/50 bg-amber-950/15 hover:border-amber-400"
                            : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <FileText className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white">
                              {lang === "bn" ? s.name.bn : s.name.en}
                            </p>
                            {(lang === "bn" ? s.description.bn : s.description.en) && (
                              <p className="text-xs text-slate-400">
                                {lang === "bn" ? s.description.bn : s.description.en}
                              </p>
                            )}
                            <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 font-mono tabular-nums">
                              <Clock className="w-3 h-3" /> {seriesMeta(s)}
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                              Cutoff {s.estimatedCutoffMarks}
                            </p>
                          </div>
                        </div>

                        {/* Attempt Count & Paused Status Strip */}
                        <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg bg-slate-900/90 border border-slate-800/80 px-2.5 py-2 text-[11px]">
                          <span
                            className={`inline-flex items-center gap-1 font-mono font-semibold ${
                              attemptsCount > 0 ? "text-violet-300" : "text-slate-400"
                            }`}
                          >
                            <Award className="w-3.5 h-3.5" />
                            {lang === "bn"
                              ? `দেওয়া হয়েছে: ${attemptsCount} বার`
                              : `Attempted: ${attemptsCount} ${attemptsCount === 1 ? "time" : "times"}`}
                          </span>
                          {attemptsCount > 0 && s.myBestScore !== null && s.myBestScore !== undefined && (
                            <span className="font-mono text-emerald-300">
                              Best: <strong>{s.myBestScore}</strong>
                              {s.myLastScore !== null &&
                              s.myLastScore !== undefined &&
                              attemptsCount > 1
                                ? ` · Last: ${s.myLastScore}`
                                : ""}
                            </span>
                          )}
                        </div>

                        {isPaused && (
                          <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/15 border border-amber-500/35 px-2.5 py-1.5 text-[11px] text-amber-200">
                            <span className="inline-flex items-center gap-1 font-semibold">
                              <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                              {lang === "bn"
                                ? `স্থগিত পরীক্ষা (${s.myPausedAnsweredCount ?? 0}/${s.totalQuestions} উত্তর দেওয়া)`
                                : `Paused Test (${s.myPausedAnsweredCount ?? 0}/${s.totalQuestions} answered)`}
                            </span>
                            <span className="font-mono text-amber-300">
                              {Math.floor((s.myPausedElapsedSeconds ?? 0) / 60)}m elapsed
                            </span>
                          </div>
                        )}

                        {isPaused && onResumeSeries ? (
                          <div className="mt-auto flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onResumeSeries(s)}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              {lang === "bn" ? "স্থগিত পরীক্ষা চালিয়ে যান" : "Resume / Continue Exam"}
                            </button>
                            <button
                              type="button"
                              onClick={() => onStartSeries(s)}
                              title={lang === "bn" ? "নতুন করে শুরু করুন" : "Restart fresh from Question 1"}
                              className="inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onStartSeries(s)}
                            className="mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5" />
                            {attemptsCount > 0
                              ? lang === "bn"
                                ? `আবার পরীক্ষা দিন (#${attemptsCount + 1})`
                                : `Retake Exam (Attempt #${attemptsCount + 1})`
                              : lang === "bn"
                                ? "পরীক্ষা শুরু করুন"
                                : "Start Exam"}
                          </button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {children}
    </section>
  );
}

/** Headline numbers for the Mock Tests page. */
export function LibraryStats({
  exams,
  attempts,
  lang,
}: {
  exams: StudentExamDto[];
  attempts: AttemptSummaryDto[];
  lang: Lang;
}) {
  const sum = (f: (e: StudentExamDto) => number) => exams.reduce((n, e) => n + f(e), 0);
  const avgAccuracy = attempts.length
    ? Math.round(attempts.reduce((n, a) => n + a.accuracyPercentage, 0) / attempts.length)
    : null;

  const tiles: { label: string; value: string | number; hint?: string; accent: string }[] = [
    { label: lang === "bn" ? "পরীক্ষা" : "Exams", value: exams.length, accent: "text-white" },
    {
      label: lang === "bn" ? "সব টেস্ট" : "Tests available",
      value: sum(totalSeries),
      hint: lang === "bn" ? "দেওয়ার জন্য প্রস্তুত" : "Ready to take",
      accent: "text-emerald-300",
    },
    {
      label: lang === "bn" ? "মক টেস্ট সিরিজ" : "Mock test series",
      value: sum((e) => e.seriesCounts.mock_test ?? 0),
      accent: "text-emerald-300",
    },
    {
      label: lang === "bn" ? "বিগত বছরের প্রশ্ন" : "Previous year papers",
      value: sum((e) => e.seriesCounts.previous_year ?? 0),
      accent: "text-amber-300",
    },
    { label: lang === "bn" ? "বিষয়" : "Subjects", value: sum((e) => e.subjectCount), accent: "text-sky-300" },
    {
      label: lang === "bn" ? "প্রশ্ন" : "Questions",
      value: sum((e) => e.questionCount).toLocaleString("en-IN"),
      hint: lang === "bn" ? "প্রশ্নব্যাংকে" : "in the question bank",
      accent: "text-sky-300",
    },
    {
      label: lang === "bn" ? "আপনার পরীক্ষা" : "Your attempts",
      value: attempts.length,
      hint: avgAccuracy === null ? undefined : `${avgAccuracy}% avg. accuracy`,
      accent: "text-violet-300",
    },
  ];

  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <dt className="text-[11px] font-medium text-slate-400">{t.label}</dt>
          <dd className={`mt-1 text-2xl font-bold font-mono tabular-nums ${t.accent}`}>{t.value}</dd>
          {t.hint && <dd className="text-[11px] text-slate-500">{t.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
