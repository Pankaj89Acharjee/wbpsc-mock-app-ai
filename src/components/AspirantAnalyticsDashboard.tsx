import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import type {
  AttemptSummaryDto,
  CachedNoteRefDto,
  MasteryDto,
} from "../../packages/shared-types/src/index";
import type { SupportedLang } from "./types";

interface AspirantAnalyticsDashboardProps {
  myAttempts: AttemptSummaryDto[];
  myMastery: MasteryDto[];
  cachedNotes?: CachedNoteRefDto[];
  generatingTopicSlug?: string | null;
  lang: SupportedLang;
  onOpenOrGenerateAiNote?: (mastery: MasteryDto) => void;
  onNavigateToWeaknessTutor?: () => void;
}

interface SubjectPerformanceAggregate {
  subjectKey: string;
  subjectNameEn: string;
  subjectNameBn: string;
  totalEncountered: number;
  totalCorrect: number;
  totalIncorrect: number;
  accuracyPct: number;
  avgTimeSec: number;
  topicCount: number;
  weakTopicCount: number;
  strongTopicCount: number;
  status: "strong" | "moderate" | "weak";
}

export default function AspirantAnalyticsDashboard({
  myAttempts,
  myMastery,
  cachedNotes = [],
  generatingTopicSlug = null,
  lang,
  onOpenOrGenerateAiNote,
  onNavigateToWeaknessTutor,
}: AspirantAnalyticsDashboardProps) {
  const [hoveredAttemptIdx, setHoveredAttemptIdx] = useState<number | null>(null);

  // 1. Chronological Submitted Attempts for Performance Progression Chart
  const chronologicalAttempts = useMemo(() => {
    return [...myAttempts]
      .filter((a) => a.attemptStatus !== "in_progress")
      .slice(0, 12)
      .reverse()
      .map((att, idx) => {
        const scorePct =
          att.maxPossibleScore > 0
            ? Math.max(
                0,
                Math.min(100, Math.round((att.finalNetScore / att.maxPossibleScore) * 100))
              )
            : 0;
        const avgSecPerQ =
          att.attemptedCount > 0
            ? Math.round(att.totalTimeSpentSeconds / att.attemptedCount)
            : 0;
        return {
          idx: idx + 1,
          label: `T${idx + 1}`,
          title: att.series?.name[lang] || att.examTitleEn,
          scorePct,
          accuracyPct: Math.round(att.accuracyPercentage),
          finalNetScore: att.finalNetScore,
          maxScore: att.maxPossibleScore,
          negativePenalty: att.negativePenalty ?? 0,
          avgSecPerQ,
          cutoffCleared: att.cutoffCleared,
          dateLabel: att.submittedAt
            ? new Date(att.submittedAt).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
              })
            : `Attempt ${idx + 1}`,
        };
      });
  }, [myAttempts, lang]);

  // 2. Overall Performance Metrics Summary
  const overallMetrics = useMemo(() => {
    const count = chronologicalAttempts.length;
    if (count === 0) {
      const masteryTotal = myMastery.reduce((s, m) => s + m.totalEncountered, 0);
      const masteryCorrect = myMastery.reduce((s, m) => s + m.totalCorrect, 0);
      const masteryAcc =
        masteryTotal > 0 ? Math.round((masteryTotal > 0 ? (masteryCorrect / masteryTotal) * 100 : 0)) : 0;
      return {
        attemptCount: 0,
        avgAccuracyPct: masteryAcc,
        avgScorePct: 0,
        bestScorePct: 0,
        totalNegativeLost: 0,
        cutoffClearedCount: 0,
        avgSpeedSec:
          myMastery.length > 0
            ? Math.round(
                myMastery.reduce((s, m) => s + m.avgTimeSeconds, 0) / myMastery.length
              )
            : 0,
      };
    }

    const avgAccuracyPct = Math.round(
      chronologicalAttempts.reduce((s, a) => s + a.accuracyPct, 0) / count
    );
    const avgScorePct = Math.round(
      chronologicalAttempts.reduce((s, a) => s + a.scorePct, 0) / count
    );
    const bestScorePct = Math.max(...chronologicalAttempts.map((a) => a.scorePct));
    const totalNegativeLost =
      Math.round(
        chronologicalAttempts.reduce((s, a) => s + a.negativePenalty, 0) * 100
      ) / 100;
    const cutoffClearedCount = chronologicalAttempts.filter((a) => a.cutoffCleared).length;
    const avgSpeedSec = Math.round(
      chronologicalAttempts.reduce((s, a) => s + a.avgSecPerQ, 0) / count
    );

    return {
      attemptCount: count,
      avgAccuracyPct,
      avgScorePct,
      bestScorePct,
      totalNegativeLost,
      cutoffClearedCount,
      avgSpeedSec,
    };
  }, [chronologicalAttempts, myMastery]);

  // 3. Performance Metrics by Subject (Aggregated from Subtopic Mastery)
  const subjectPerformance = useMemo<SubjectPerformanceAggregate[]>(() => {
    const map = new Map<string, SubjectPerformanceAggregate>();

    for (const m of myMastery) {
      const key = m.subjectName.en.toLowerCase();
      const existing = map.get(key) ?? {
        subjectKey: key,
        subjectNameEn: m.subjectName.en,
        subjectNameBn: m.subjectName.bn || m.subjectName.en,
        totalEncountered: 0,
        totalCorrect: 0,
        totalIncorrect: 0,
        accuracyPct: 0,
        avgTimeSec: 0,
        topicCount: 0,
        weakTopicCount: 0,
        strongTopicCount: 0,
        status: "moderate" as const,
      };

      existing.totalEncountered += m.totalEncountered;
      existing.totalCorrect += m.totalCorrect;
      existing.totalIncorrect += m.totalIncorrect;
      existing.avgTimeSec += m.avgTimeSeconds * Math.max(1, m.totalEncountered);
      existing.topicCount += 1;

      if (m.accuracyPercentage < 65 || m.masteryBand === "critical_weakness" || m.masteryBand === "needs_revision") {
        existing.weakTopicCount += 1;
      } else {
        existing.strongTopicCount += 1;
      }

      map.set(key, existing);
    }

    return Array.from(map.values())
      .map((s) => {
        const accuracyPct =
          s.totalEncountered > 0
            ? Math.round((s.totalCorrect / s.totalEncountered) * 100)
            : 0;
        const avgTimeSec =
          s.totalEncountered > 0
            ? Math.round(s.avgTimeSec / s.totalEncountered)
            : 0;
        const status: SubjectPerformanceAggregate["status"] =
          accuracyPct >= 70 ? "strong" : accuracyPct >= 50 ? "moderate" : "weak";
        return {
          ...s,
          accuracyPct,
          avgTimeSec,
          status,
        };
      })
      .sort((a, b) => a.accuracyPct - b.accuracyPct);
  }, [myMastery]);

  // 4. Split Subtopics into "Where Lacking Knowledge (Weak)" vs "Where Strong (Mastered/Proficient)"
  const { weakSections, strongSections } = useMemo(() => {
    const sorted = [...myMastery].sort(
      (a, b) => a.accuracyPercentage - b.accuracyPercentage
    );
    const weak = sorted.filter(
      (m) =>
        m.accuracyPercentage < 68 ||
        m.masteryBand === "critical_weakness" ||
        m.masteryBand === "needs_revision"
    );
    const strong = sorted
      .filter(
        (m) =>
          m.accuracyPercentage >= 68 &&
          m.masteryBand !== "critical_weakness" &&
          m.masteryBand !== "needs_revision"
      )
      .reverse();

    return { weakSections: weak, strongSections: strong };
  }, [myMastery]);

  // Diagnose root cause of knowledge gap for a weak subtopic
  const diagnoseKnowledgeGap = (m: MasteryDto) => {
    if (m.accuracyPercentage < 40 && m.totalIncorrect >= m.totalCorrect) {
      return {
        badge: lang === "bn" ? "কনসেপ্ট গ্যাপ ও নেগেটিভ মার্কিং" : "Core Concept Gap & High Negative Marks",
        reason:
          lang === "bn"
            ? `${m.totalEncountered}টি প্রশ্নের মধ্যে ${m.totalIncorrect}টি ভুল উত্তর। মৌলিক ধারণা রিভিশন জরুরি।`
            : `${m.totalIncorrect} wrong out of ${m.totalEncountered} seen (${m.accuracyPercentage}% accuracy). High negative penalty risk — revise core concepts before guessing.`,
        colorClass: "bg-rose-500/15 text-rose-300 border-rose-500/35",
      };
    }
    if (m.avgTimeSeconds > 55) {
      return {
        badge: lang === "bn" ? "ধীর গতি ও পদ্ধতিগত ঘাটতি" : "Slow Solving Speed & Formula Gap",
        reason:
          lang === "bn"
            ? `প্রতি প্রশ্নে গড় সময় ${m.avgTimeSeconds}s (লক্ষ্য ৪৫s)। শর্টকাট কৌশল ও সূত্র অনুশীলন করুন।`
            : `Averaging ${m.avgTimeSeconds}s per question (target ≤45s). Needs shortcut techniques and timed recall drills.`,
        colorClass: "bg-amber-500/15 text-amber-300 border-amber-500/35",
      };
    }
    return {
      badge: lang === "bn" ? "রিভিশন ও নির্ভুলতা প্রয়োজন" : "Moderate Knowledge Gap — Needs Revision",
      reason:
        lang === "bn"
          ? `নির্ভুলতা ${m.accuracyPercentage}%। ৭৫%+ কাটঅফ জোনে পৌঁছাতে এআই স্টাডি নোটটি পড়ুন।`
          : `Current accuracy is ${m.accuracyPercentage}%. Review key facts and mnemonics to push above the 75% exam-ready threshold.`,
      colorClass: "bg-amber-500/15 text-amber-300 border-amber-500/35",
    };
  };

  const chartWidth = 660;
  const chartHeight = 205;

  return (
    <section className="space-y-6">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
            <Activity className="w-3.5 h-3.5" />
            {lang === "bn"
              ? "অ্যাসপিরান্ট পারফরম্যান্স ও নলেজ ডায়াগনস্টিক কনসোল"
              : "Aspirant Performance & Knowledge Diagnostic Console"}
          </span>
          <h2 className="text-lg sm:text-xl font-bold text-white mt-0.5">
            {lang === "bn"
              ? "পারফরম্যান্স মেট্রিক্স, বিষয়ভিত্তিক বিশ্লেষণ এবং সবল ও দুর্বল দিক"
              : "Performance Metrics, Subject-Wise Breakdown & Knowledge Gap Analysis"}
          </h2>
        </div>

        {onNavigateToWeaknessTutor && (
          <button
            type="button"
            onClick={onNavigateToWeaknessTutor}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 rounded-lg cursor-pointer transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {lang === "bn"
              ? "সম্পূর্ণ এআই টিউটর ও নোটস খুলুন"
              : "Open Full AI Tutor & Revision Notes"}
          </button>
        )}
      </div>

      {/* ===================================================================
          TOP ASPIRANT KPI METRICS BAR
      =================================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 block">
            {lang === "bn" ? "মোট মক টেস্ট" : "Tests Completed"}
          </span>
          <span className="text-xl font-extrabold font-mono text-white">
            {overallMetrics.attemptCount}
          </span>
          <span className="text-[10px] text-emerald-400 block">
            {overallMetrics.cutoffClearedCount} cutoff cleared
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 block">
            {lang === "bn" ? "গড় নির্ভুলতা (Accuracy)" : "Average Accuracy"}
          </span>
          <span
            className={`text-xl font-extrabold font-mono ${
              overallMetrics.avgAccuracyPct >= 70
                ? "text-emerald-400"
                : overallMetrics.avgAccuracyPct >= 50
                  ? "text-amber-300"
                  : "text-rose-400"
            }`}
          >
            {overallMetrics.avgAccuracyPct}%
          </span>
          <span className="text-[10px] text-slate-400 block">Target ≥ 75%</span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 block">
            {lang === "bn" ? "সর্বোচ্চ নেট স্কোর %" : "Best Net Score %"}
          </span>
          <span className="text-xl font-extrabold font-mono text-sky-300">
            {overallMetrics.bestScorePct}%
          </span>
          <span className="text-[10px] text-slate-400 block">
            Avg: {overallMetrics.avgScorePct}%
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 block">
            {lang === "bn" ? "গড় সময় / প্রশ্ন" : "Avg Speed / Question"}
          </span>
          <span className="text-xl font-extrabold font-mono text-amber-300">
            {overallMetrics.avgSpeedSec}s
          </span>
          <span className="text-[10px] text-slate-400 block">Benchmark: 45s/Q</span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-rose-500/30 space-y-1">
          <span className="text-[11px] text-rose-300 font-semibold block">
            {lang === "bn" ? "জ্ঞানের ঘাটতি (Weak)" : "Lacking Knowledge"}
          </span>
          <span className="text-xl font-extrabold font-mono text-rose-400">
            {weakSections.length} Topics
          </span>
          <span className="text-[10px] text-slate-400 block">
            −{overallMetrics.totalNegativeLost} neg marks lost
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-emerald-500/30 space-y-1">
          <span className="text-[11px] text-emerald-300 font-semibold block">
            {lang === "bn" ? "সবল অধ্যায় (Strong)" : "Strong Sections"}
          </span>
          <span className="text-xl font-extrabold font-mono text-emerald-400">
            {strongSections.length} Topics
          </span>
          <span className="text-[10px] text-slate-400 block">
            Accuracy ≥ 68%
          </span>
        </div>
      </div>

      {/* ===================================================================
          ROW 1: PERFORMANCE METRICS PROGRESSION + PERFORMANCE BY SUBJECT
      =================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* CHART 1: OVERALL PERFORMANCE METRICS PROGRESSION */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                {lang === "bn"
                  ? "সামগ্রিক পারফরম্যান্স ট্রেন্ড (স্কোর % ও নির্ভুলতা %)"
                  : "Overall Performance Metrics Trend (Score % & Accuracy %)"}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {lang === "bn"
                  ? "প্রতিটি মক টেস্টে আপনার নেট স্কোর শতাংশ, নির্ভুলতা এবং গতি কীভাবে পরিবর্তিত হচ্ছে তা দেখুন।"
                  : "Tracks your Net Score %, Accuracy %, and 65% Cutoff benchmark across your mock test attempts."}
              </p>
            </div>
          </div>

          {chronologicalAttempts.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-950/80 border border-slate-800 text-center space-y-2">
              <BarChart3 className="w-7 h-7 text-slate-500 mx-auto" />
              <p className="text-xs font-semibold text-slate-300">
                {lang === "bn"
                  ? "আপনার পারফরম্যান্স গ্রাফ দেখতে একটি মক টেস্ট সম্পন্ন করুন"
                  : "Complete a Mock Test to unlock your live score & accuracy progression chart"}
              </p>
              <p className="text-[11px] text-slate-500">
                Your net score %, accuracy %, negative mark impact, and speed per question will plot here automatically.
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    Accuracy %
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                    Net Score %
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-amber-300">
                    <span className="w-3 h-0.5 bg-amber-400" />
                    Target Cutoff (65%)
                  </span>
                </div>

                {hoveredAttemptIdx !== null &&
                  chronologicalAttempts[hoveredAttemptIdx] && (
                    <span className="font-mono text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
                      {chronologicalAttempts[hoveredAttemptIdx].title}: Score{" "}
                      {chronologicalAttempts[hoveredAttemptIdx].finalNetScore}/
                      {chronologicalAttempts[hoveredAttemptIdx].maxScore} (
                      {chronologicalAttempts[hoveredAttemptIdx].scorePct}%) · Acc{" "}
                      {chronologicalAttempts[hoveredAttemptIdx].accuracyPct}% ·{" "}
                      {chronologicalAttempts[hoveredAttemptIdx].avgSecPerQ}s/Q
                    </span>
                  )}
              </div>

              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full h-52 select-none"
                  role="img"
                  aria-label="Aspirant performance progression chart"
                >
                  {/* Grid Lines 0% to 100% */}
                  {[0, 25, 50, 75, 100].map((pct) => {
                    const y = 170 - (pct / 100) * 145;
                    return (
                      <g key={pct}>
                        <line
                          x1={40}
                          y1={y}
                          x2={chartWidth - 16}
                          y2={y}
                          stroke="#1e293b"
                          strokeDasharray="3 3"
                          strokeWidth={1}
                        />
                        <text
                          x={34}
                          y={y + 4}
                          textAnchor="end"
                          className="fill-slate-500 text-[10px] font-mono"
                        >
                          {pct}%
                        </text>
                      </g>
                    );
                  })}

                  {/* 65% Target Cutoff Benchmark Line */}
                  {(() => {
                    const cutoffY = 170 - 0.65 * 145;
                    return (
                      <line
                        x1={40}
                        y1={cutoffY}
                        x2={chartWidth - 16}
                        y2={cutoffY}
                        stroke="#fbbf24"
                        strokeDasharray="5 4"
                        strokeWidth={1.5}
                      />
                    );
                  })()}

                  {/* Accuracy & Score Curves */}
                  {(() => {
                    const n = chronologicalAttempts.length;
                    const usableW = chartWidth - 76;
                    const stepX = n > 1 ? usableW / (n - 1) : 0;

                    const pts = chronologicalAttempts.map((a, i) => ({
                      x: n === 1 ? 48 + usableW / 2 : 48 + i * stepX,
                      accY: 170 - (a.accuracyPct / 100) * 145,
                      scoreY: 170 - (a.scorePct / 100) * 145,
                      a,
                      i,
                    }));

                    const accPath = pts
                      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.accY.toFixed(1)}`)
                      .join(" ");
                    const scorePath = pts
                      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.scoreY.toFixed(1)}`)
                      .join(" ");

                    return (
                      <>
                        {n > 1 && (
                          <>
                            <path
                              d={scorePath}
                              fill="none"
                              stroke="#38bdf8"
                              strokeWidth={2.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d={accPath}
                              fill="none"
                              stroke="#10b981"
                              strokeWidth={2.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </>
                        )}

                        {pts.map((p) => (
                          <g
                            key={p.a.idx}
                            onMouseEnter={() => setHoveredAttemptIdx(p.i)}
                            onMouseLeave={() => setHoveredAttemptIdx(null)}
                            className="cursor-pointer"
                          >
                            <circle
                              cx={p.x}
                              cy={p.scoreY}
                              r={hoveredAttemptIdx === p.i ? 6 : 4}
                              fill="#38bdf8"
                              stroke="#020617"
                              strokeWidth={1.5}
                            />
                            <circle
                              cx={p.x}
                              cy={p.accY}
                              r={hoveredAttemptIdx === p.i ? 6 : 4}
                              fill="#10b981"
                              stroke="#020617"
                              strokeWidth={1.5}
                            />
                            <text
                              x={p.x}
                              y={p.accY - 8}
                              textAnchor="middle"
                              className="fill-emerald-300 text-[10px] font-mono font-bold"
                            >
                              {p.a.accuracyPct}%
                            </text>
                            <text
                              x={p.x}
                              y={190}
                              textAnchor="middle"
                              className="fill-slate-400 text-[10px] font-mono"
                            >
                              {p.a.dateLabel}
                            </text>
                          </g>
                        ))}
                      </>
                    );
                  })()}
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* CHART 2: PERFORMANCE METRICS BY SUBJECT */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-sky-400" />
                {lang === "bn"
                  ? "বিষয়ভিত্তিক পারফরম্যান্স মেট্রিক্স (Subject-Wise Breakdown)"
                  : "Performance Metrics by Subject (Accuracy, Speed & Mastery)"}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {lang === "bn"
                  ? "কোন বিষয়ে আপনার দক্ষতা বেশি এবং কোন বিষয়ে আরও অনুশীলন প্রয়োজন তার তুলনামূলক চিত্র।"
                  : "Side-by-side comparison of accuracy %, correct vs. wrong answers, and solving speed across every subject."}
              </p>
            </div>
          </div>

          {subjectPerformance.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-950/80 border border-slate-800 text-center space-y-2">
              <BookOpen className="w-7 h-7 text-slate-500 mx-auto" />
              <p className="text-xs font-semibold text-slate-300">
                {lang === "bn"
                  ? "বিষয়ভিত্তিক বিশ্লেষণের জন্য অন্তত একটি মক টেস্ট জমা দিন"
                  : "No subject-level mastery metrics recorded yet"}
              </p>
              <p className="text-[11px] text-slate-500">
                Once you submit a test, PostgreSQL deterministically computes your subject-by-subject accuracy and speed.
              </p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto pr-1 space-y-2.5">
              {subjectPerformance.map((subj) => {
                const barColor =
                  subj.status === "strong"
                    ? "from-emerald-500 to-emerald-400"
                    : subj.status === "moderate"
                      ? "from-amber-500 to-amber-400"
                      : "from-rose-500 to-rose-400";

                return (
                  <div
                    key={subj.subjectKey}
                    className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-bold text-white">
                          {lang === "bn" ? subj.subjectNameBn : subj.subjectNameEn}
                        </span>
                        <span className="text-[11px] text-slate-400 ml-2 font-mono">
                          ({subj.topicCount} subtopics: {subj.strongTopicCount} strong ·{" "}
                          {subj.weakTopicCount} weak)
                        </span>
                      </div>

                      <div className="flex items-center gap-3 font-mono tabular-nums text-xs">
                        <span className="text-emerald-400">{subj.totalCorrect}✓</span>
                        <span className="text-rose-400">{subj.totalIncorrect}✗</span>
                        <span className="text-slate-400">{subj.avgTimeSec}s/Q</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                            subj.status === "strong"
                              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                              : subj.status === "moderate"
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                                : "bg-rose-500/15 text-rose-300 border-rose-500/30"
                          }`}
                        >
                          {subj.accuracyPct}%{" "}
                          {subj.status === "strong"
                            ? "Strong"
                            : subj.status === "moderate"
                              ? "Moderate"
                              : "Weak"}
                        </span>
                      </div>
                    </div>

                    {/* Subject Accuracy Progress Bar */}
                    <div className="w-full h-2.5 rounded-full bg-slate-900 overflow-hidden">
                      <div
                        style={{ width: `${Math.max(4, subj.accuracyPct)}%` }}
                        className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-300`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ===================================================================
          ROW 2: KNOWLEDGE GAP DIAGNOSTICS — WHERE LACKING KNOWLEDGE vs WHERE STRONG
      =================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT PANEL: WHERE YOU ARE LACKING KNOWLEDGE (WEAK SECTIONS & DETAILS) */}
        <div className="rounded-xl border border-rose-500/30 bg-slate-900 p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                {lang === "bn"
                  ? "যেখানে জ্ঞানের ঘাটতি রয়েছে (Weak Sections)"
                  : "Where You Are Lacking Knowledge (Weak Sections & Details)"}
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">
                {lang === "bn"
                  ? `দুর্বল সাবটপিক ও কারণ বিশ্লেষণ (${weakSections.length})`
                  : `Priority Knowledge Gaps Requiring Revision (${weakSections.length})`}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Subtopics with low accuracy (&lt;68%), high negative marking, or slow solving speed.
              </p>
            </div>
          </div>

          {weakSections.length === 0 ? (
            <div className="p-6 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 text-center">
              {myMastery.length === 0
                ? "Take a mock test to identify weak subtopics and specific knowledge gaps."
                : "Great job! None of your attempted subtopics are currently below the 68% weakness threshold."}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1 space-y-3">
              {weakSections.map((m) => {
                const diag = diagnoseKnowledgeGap(m);
                const isCached = cachedNotes.some(
                  (n) =>
                    n.examSlug === m.examSlug &&
                    n.topicSlug === m.subtopicSlug &&
                    n.language === lang
                );
                const isGenerating = generatingTopicSlug === m.subtopicSlug;

                return (
                  <div
                    key={m.id}
                    className="p-4 rounded-xl bg-slate-950/90 border border-rose-500/25 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="text-[11px] text-slate-400 font-medium">
                          {m.subjectName[lang]}
                        </span>
                        <h4 className="text-sm font-bold text-white">
                          {m.subtopicName[lang]}
                        </h4>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${diag.colorClass}`}
                      >
                        {diag.badge}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      {diag.reason}
                    </p>

                    {/* Metrics & Progress Bar */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>
                          Accuracy: <strong className="text-rose-400">{m.accuracyPercentage}%</strong>
                        </span>
                        <span>
                          Correct: <strong className="text-emerald-400">{m.totalCorrect}</strong> · Wrong:{" "}
                          <strong className="text-rose-400">{m.totalIncorrect}</strong> / {m.totalEncountered}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-400" />
                          {m.avgTimeSeconds}s/Q
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                        <div
                          style={{ width: `${Math.max(5, m.accuracyPercentage)}%` }}
                          className="h-full bg-gradient-to-r from-rose-500 to-amber-500 rounded-full"
                        />
                      </div>
                    </div>

                    {onOpenOrGenerateAiNote && (
                      <div className="pt-1 flex justify-end">
                        <button
                          type="button"
                          disabled={isGenerating}
                          onClick={() => onOpenOrGenerateAiNote(m)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {isGenerating
                            ? "Generating AI Note…"
                            : isCached
                              ? "Open Cached AI Revision Note"
                              : "Generate AI Revision Note"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT PANEL: WHERE YOU ARE STRONG (STRONG SECTIONS & MASTERY) */}
        <div className="rounded-xl border border-emerald-500/30 bg-slate-900 p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                <Award className="w-3.5 h-3.5" />
                {lang === "bn"
                  ? "যেখানে আপনার প্রস্তুতি শক্তিশালী (Strong Sections)"
                  : "Where You Are Strong (Mastered & Proficient Sections)"}
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">
                {lang === "bn"
                  ? `উচ্চ নির্ভুলতার সাবটপিক (${strongSections.length})`
                  : `High-Accuracy Exam-Ready Topics (${strongSections.length})`}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Subtopics where your accuracy is ≥68% with strong conceptual retention and low negative marking.
              </p>
            </div>
          </div>

          {strongSections.length === 0 ? (
            <div className="p-6 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 text-center">
              {myMastery.length === 0
                ? "Complete a mock test to see your strongest subjects and mastered topics here."
                : "Keep practicing and reviewing AI notes to move your topics into the ≥68% Strong Mastery zone!"}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1 space-y-3">
              {strongSections.map((m) => {
                const isFast = m.avgTimeSeconds <= 45;
                return (
                  <div
                    key={m.id}
                    className="p-4 rounded-xl bg-slate-950/90 border border-emerald-500/25 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="text-[11px] text-slate-400 font-medium">
                          {m.subjectName[lang]}
                        </span>
                        <h4 className="text-sm font-bold text-white">
                          {m.subtopicName[lang]}
                        </h4>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isFast && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                            <Zap className="w-3 h-3" /> Fast Recall ({m.avgTimeSeconds}s)
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/35">
                          <CheckCircle2 className="w-3 h-3" />
                          {m.accuracyPercentage >= 85 ? "Exam Ready" : "Proficient"}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300">
                      {lang === "bn"
                        ? `${m.totalEncountered}টি প্রশ্নের মধ্যে ${m.totalCorrect}টি সঠিক উত্তর (${m.accuracyPercentage}% নির্ভুলতা)। এই অধ্যায়ে আপনার দখল চমৎকার।`
                        : `Answered ${m.totalCorrect} of ${m.totalEncountered} questions correctly (${m.accuracyPercentage}% accuracy). Strong command over this section.`}
                    </p>

                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>
                          Accuracy:{" "}
                          <strong className="text-emerald-400">{m.accuracyPercentage}%</strong>
                        </span>
                        <span>
                          {m.totalCorrect}✓ · {m.totalIncorrect}✗ · Avg {m.avgTimeSeconds}s/Q
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                        <div
                          style={{ width: `${Math.min(100, m.accuracyPercentage)}%` }}
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
