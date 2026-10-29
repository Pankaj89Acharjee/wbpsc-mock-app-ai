import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Download,
  ExternalLink,
  FileDown,
  Filter,
  Globe,
  Layers,
  Maximize2,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { OptionKey, UserDto } from "../../packages/shared-types/src/index";
import { api } from "../api";
import type { SupportedLang } from "./types";

export interface CaTopicItem {
  id: string;
  category: string;
  headlineEn: string;
  headlineBn: string;
  sourceTag: string;
  whyInNewsEn: string;
  whyInNewsBn: string;
  examPointsEn: string[];
  examPointsBn: string[];
  staticGkLinkEn: string;
  staticGkLinkBn: string;
  examTrapEn: string;
  examTrapBn: string;
}

export interface CaMcqItem {
  id: string;
  category: string;
  stem: { en: string; bn: string };
  options: Record<OptionKey, { en: string; bn: string }>;
  correctOption: OptionKey;
  explanation: { en: string; bn: string };
}

export interface CaAgentStepLog {
  stepNumber: number;
  agentRole: string;
  actionSummary: string;
  status: "completed" | "fallback";
  durationMs: number;
  details: string;
}

export interface CaEditionDto {
  id: string;
  editionDate: string;
  monthKey: string;
  monthLabelEn: string;
  monthLabelBn: string;
  titleEn: string;
  titleBn: string;
  executiveSummaryEn: string;
  executiveSummaryBn: string;
  sourceUrls: string[];
  agentTrace: CaAgentStepLog[];
  topics: CaTopicItem[];
  mcqs: CaMcqItem[];
  mnemonicsEn: string;
  mnemonicsBn: string;
  downloadCount: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaMonthArchiveSummary {
  monthKey: string;
  monthLabelEn: string;
  monthLabelBn: string;
  editionsCount: number;
  topicsCount: number;
  mcqsCount: number;
  downloadsCount: number;
  categoryBreakdown?: Record<string, number>;
}

export interface CaDashboardStats {
  monthsStoredCount: number;
  totalEditionsCount: number;
  totalTopicsCount: number;
  totalExamPointersCount: number;
  totalMcqsCount: number;
  totalDownloadsCount: number;
  uniqueSourcesCount: number;
  earliestDate: string | null;
  latestDate: string | null;
  categoryCounts: Record<string, number>;
}

interface DailyCurrentAffairsTabProps {
  user?: UserDto;
  lang: SupportedLang;
  onError: (err: unknown, fallback: string) => void;
  onNotify?: (type: "success" | "error" | "info", text: string) => void;
}

const OPTION_KEYS: OptionKey[] = ["A", "B", "C", "D"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ORDERED_CATEGORIES = [
  "West Bengal Special",
  "Polity & Governance",
  "Economy & Banking",
  "Science & Technology",
  "Awards & Honours",
  "Sports & Tournaments",
  "Environment & GI Tags",
  "Defence & Military Exercises",
  "Ranks, Reports & Indices",
  "National & International",
];

function buildCalendarDays(monthKey: string): Array<{
  dayNumber: number | null;
  dateStr: string | null;
}> {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return [];
  const year = Number(match[1]);
  const monthIdx = Number(match[2]) - 1;
  const firstDayOfWeek = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  const cells: Array<{ dayNumber: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push({ dayNumber: null, dateStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, "0");
    cells.push({
      dayNumber: d,
      dateStr: `${monthKey}-${dd}`,
    });
  }
  return cells;
}

export default function DailyCurrentAffairsTab({
  user,
  lang,
  onError,
  onNotify,
}: DailyCurrentAffairsTabProps) {
  const isAdmin = user?.role === "admin";

  const [loading, setLoading] = useState<boolean>(true);
  const [stats, setStats] = useState<CaDashboardStats | null>(null);
  const [monthsArchive, setMonthsArchive] = useState<CaMonthArchiveSummary[]>([]);
  const [editions, setEditions] = useState<CaEditionDto[]>([]);

  // Selection, Calendar & Filters
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>("all");
  const [calendarMonthKey, setCalendarMonthKey] = useState<string>("2026-09");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeEditionId, setActiveEditionId] = useState<string | null>(null);
  const [activeViewMode, setActiveViewMode] = useState<
    "notes" | "categorized-month" | "mcqs" | "agent-trace"
  >("notes");

  // Floating Animated Card Modal State
  const [floatingModalOpen, setFloatingModalOpen] = useState<boolean>(false);
  const [floatingCardIdx, setFloatingCardIdx] = useState<number>(0);
  const [cardAnimDirection, setCardAnimDirection] = useState<"next" | "prev">("next");

  // Autonomous Agent Runner Form State
  const [showAgentPanel, setShowAgentPanel] = useState<boolean>(false);
  const [agentBusy, setAgentBusy] = useState<boolean>(false);
  const [classifierBusyMonth, setClassifierBusyMonth] = useState<string | null>(null);
  const [agentEditionDate, setAgentEditionDate] = useState<string>("2026-09-02");
  const [agentSourceUrl, setAgentSourceUrl] = useState<string>(
    "https://www.pyqarena.com/current-affairs-from-the-hindu-2nd-september-2026/"
  );
  const [agentFocusTopics, setAgentFocusTopics] = useState<string>(
    "GKToday + PYQArena (The Hindu) + PIB: Collect 12 high-yield PSCWB topics across Sports, Awards, Science & Tech, Polity, Economy, West Bengal Special, Defence, Environment & Indices"
  );

  // Interactive MCQ Practice State
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, OptionKey>>({});
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);

  const loadArchive = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{
        stats: CaDashboardStats;
        monthsArchive: CaMonthArchiveSummary[];
        editions: CaEditionDto[];
      }>("/current-affairs");
      setStats(res.stats);
      setMonthsArchive(res.monthsArchive || []);
      setEditions(res.editions || []);
      if (res.editions?.length > 0) {
        const sept2 = res.editions.find((e) => e.editionDate === "2026-09-02");
        const defaultEd = sept2 || res.editions[0];
        setActiveEditionId((prev) =>
          prev && res.editions.some((e) => e.id === prev) ? prev : defaultEd.id
        );
      }
    } catch (err) {
      onError(err, "Failed to load Current Affairs archive.");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadArchive();
  }, [loadArchive]);

  // Map editionDate -> edition for fast calendar lookup
  const editionsByDate = useMemo(() => {
    const map = new Map<string, CaEditionDto>();
    for (const ed of editions) {
      map.set(ed.editionDate, ed);
    }
    return map;
  }, [editions]);

  const filteredEditions = useMemo(() => {
    return editions.filter((ed) => {
      if (selectedMonthKey !== "all" && ed.monthKey !== selectedMonthKey) {
        return false;
      }
      if (selectedCategory !== "all") {
        const hasCat = ed.topics.some((t) => t.category === selectedCategory);
        if (!hasCat) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle =
          ed.titleEn.toLowerCase().includes(q) || ed.titleBn.toLowerCase().includes(q);
        const inTopics = ed.topics.some(
          (t) =>
            t.headlineEn.toLowerCase().includes(q) ||
            t.headlineBn.toLowerCase().includes(q) ||
            t.staticGkLinkEn.toLowerCase().includes(q) ||
            t.examPointsEn.some((p) => p.toLowerCase().includes(q))
        );
        if (!inTitle && !inTopics) return false;
      }
      return true;
    });
  }, [editions, selectedMonthKey, selectedCategory, searchQuery]);

  const activeEdition = useMemo(() => {
    return (
      filteredEditions.find((e) => e.id === activeEditionId) ||
      filteredEditions[0] ||
      editions.find((e) => e.id === activeEditionId) ||
      editions[0] ||
      null
    );
  }, [filteredEditions, editions, activeEditionId]);

  const filteredTopicsInActiveEdition = useMemo(() => {
    if (!activeEdition) return [];
    return activeEdition.topics.filter((t) => {
      if (selectedCategory !== "all" && t.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.headlineEn.toLowerCase().includes(q) ||
          t.headlineBn.toLowerCase().includes(q) ||
          t.staticGkLinkEn.toLowerCase().includes(q) ||
          t.examPointsEn.some((p) => p.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [activeEdition, selectedCategory, searchQuery]);

  // All topics for the active month (or all months) grouped by Category for the Classifier Agent view
  const categorizedTopicsForSelectedScope = useMemo(() => {
    const scopeEditions =
      selectedMonthKey === "all"
        ? activeEdition
          ? editions.filter((e) => e.monthKey === activeEdition.monthKey)
          : editions
        : editions.filter((e) => e.monthKey === selectedMonthKey);

    const grouped: Record<string, Array<{ topic: CaTopicItem; editionDate: string }>> = {};
    for (const ed of scopeEditions) {
      for (const t of ed.topics) {
        if (selectedCategory !== "all" && t.category !== selectedCategory) continue;
        const cat = t.category || "National & International";
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ topic: t, editionDate: ed.editionDate });
      }
    }
    return grouped;
  }, [editions, selectedMonthKey, activeEdition, selectedCategory]);

  // Keyboard navigation for the Floating Animated Flashcard Modal
  const modalDeckTopics = useMemo(() => {
    return filteredTopicsInActiveEdition.length > 0
      ? filteredTopicsInActiveEdition
      : activeEdition?.topics || [];
  }, [filteredTopicsInActiveEdition, activeEdition]);

  const goPrevCard = useCallback(() => {
    if (modalDeckTopics.length === 0) return;
    setCardAnimDirection("prev");
    setFloatingCardIdx((prev) =>
      prev <= 0 ? modalDeckTopics.length - 1 : prev - 1
    );
  }, [modalDeckTopics.length]);

  const goNextCard = useCallback(() => {
    if (modalDeckTopics.length === 0) return;
    setCardAnimDirection("next");
    setFloatingCardIdx((prev) =>
      prev >= modalDeckTopics.length - 1 ? 0 : prev + 1
    );
  }, [modalDeckTopics.length]);

  useEffect(() => {
    if (!floatingModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevCard();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNextCard();
      } else if (e.key === "Escape") {
        setFloatingModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [floatingModalOpen, goPrevCard, goNextCard]);

  const handleRunAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentBusy(true);
    try {
      const res = await api<{
        editionId: string;
        editionDate: string;
        topicsCount: number;
        mcqsCount: number;
      }>("/current-affairs/agent-run", {
        method: "POST",
        body: JSON.stringify({
          editionDate: agentEditionDate,
          sourceUrl: agentSourceUrl,
          focusTopics: agentFocusTopics,
          targetTopicCount: 12,
        }),
      });
      await loadArchive();
      setActiveEditionId(res.editionId);
      setCalendarMonthKey(res.editionDate.slice(0, 7));
      setSelectedCalendarDate(res.editionDate);
      setShowAgentPanel(false);
      onNotify?.(
        "success",
        `CA Agent harvested & classified ${res.topicsCount} exam-oriented topics & ${res.mcqsCount} MCQs for ${res.editionDate}.`
      );
    } catch (err) {
      onError(err, "Autonomous Current Affairs Agent execution failed.");
    } finally {
      setAgentBusy(false);
    }
  };

  const handleRunMonthlyClassifierAgent = async (monthKey: string) => {
    setClassifierBusyMonth(monthKey);
    try {
      const res = await api<{
        editionId: string;
        editionDate: string;
        monthKey: string;
        monthLabelEn: string;
        topicsCount: number;
        mcqsCount: number;
      }>("/current-affairs/classify-month", {
        method: "POST",
        body: JSON.stringify({ monthKey }),
      });
      await loadArchive();
      setActiveEditionId(res.editionId);
      setSelectedMonthKey(monthKey);
      setActiveViewMode("categorized-month");
      onNotify?.(
        "success",
        `Classifier Agent compiled ${res.topicsCount} categorized topics for ${res.monthLabelEn}!`
      );
    } catch (err) {
      onError(err, "Monthly Category Classifier Agent failed.");
    } finally {
      setClassifierBusyMonth(null);
    }
  };

  const handleDeleteEdition = async (editionId: string, editionDate: string) => {
    if (!isAdmin) return;
    try {
      await api(`/current-affairs/${editionId}`, { method: "DELETE" });
      await loadArchive();
      onNotify?.("info", `Deleted Current Affairs edition (${editionDate}).`);
    } catch (err) {
      onError(err, "Failed to delete edition.");
    }
  };

  const recordDownload = async (editionId: string) => {
    try {
      await api(`/current-affairs/${editionId}/download`, { method: "POST" });
      setEditions((prev) =>
        prev.map((e) =>
          e.id === editionId ? { ...e, downloadCount: e.downloadCount + 1 } : e
        )
      );
      setStats((prev) =>
        prev ? { ...prev, totalDownloadsCount: prev.totalDownloadsCount + 1 } : prev
      );
    } catch {
      // Non-blocking metrics update
    }
  };

  /**
   * Generates a CATEGORIZED Printable PDF / HTML Capsule where topics are grouped by
   * Category (Sports, Awards, Science & Technology, West Bengal Special, Polity, Economy, etc.)
   */
  const handleDownloadCategorizedCapsulePdf = async (
    targetEditions: CaEditionDto[],
    bookletTitle: string,
    filenameSlug: string
  ) => {
    if (targetEditions.length === 0) return;
    await recordDownload(targetEditions[0].id);

    // Group all topics across targetEditions by category
    const byCategory: Record<
      string,
      Array<{ topic: CaTopicItem; editionDate: string }>
    > = {};
    const allMcqs: Array<{ mcq: CaMcqItem; editionDate: string }> = [];

    for (const ed of targetEditions) {
      for (const t of ed.topics) {
        const cat = t.category || "National & International";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push({ topic: t, editionDate: ed.editionDate });
      }
      for (const m of ed.mcqs) {
        allMcqs.push({ mcq: m, editionDate: ed.editionDate });
      }
    }

    const sortedCategories = [
      ...ORDERED_CATEGORIES.filter((c) => byCategory[c]?.length),
      ...Object.keys(byCategory).filter((c) => !ORDERED_CATEGORIES.includes(c)),
    ];

    const categorySectionsHtml = sortedCategories
      .map((cat, catIdx) => {
        const items = byCategory[cat] || [];
        const cardsHtml = items
          .map(
            ({ topic: t, editionDate }, idx) => `
          <div class="topic-card">
            <div class="topic-meta">${cat} · Date: ${editionDate} · Source: ${t.sourceTag}</div>
            <h3>${idx + 1}. ${t.headlineEn}</h3>
            <div class="bn-title">${t.headlineBn}</div>
            <p class="why-news"><strong>Why in News:</strong> ${t.whyInNewsEn}<br/><span class="bn-text">${t.whyInNewsBn}</span></p>
            <div class="columns">
              <div class="col">
                <h4>Key Exam Pointers (English)</h4>
                <ul>${t.examPointsEn.map((p) => `<li>${p}</li>`).join("")}</ul>
              </div>
              <div class="col">
                <h4>পরীক্ষার মূল তথ্য (বাংলা)</h4>
                <ul>${t.examPointsBn.map((p) => `<li>${p}</li>`).join("")}</ul>
              </div>
            </div>
            <div class="gk-box">
              <strong>Static GK Syllabus Link:</strong> ${t.staticGkLinkEn}<br/>
              <span class="bn-text"><strong>স্ট্যাটিক জিকে সংযোগ:</strong> ${t.staticGkLinkBn}</span>
            </div>
            <div class="trap-box">
              <strong>Exam Hall Trap Warning:</strong> ${t.examTrapEn} | <span class="bn-text">${t.examTrapBn}</span>
            </div>
          </div>`
          )
          .join("\n");

        return `
        <section class="category-section">
          <div class="category-banner">
            <h2>Section ${catIdx + 1}: ${cat} (${items.length} Exam Topics)</h2>
          </div>
          ${cardsHtml}
        </section>`;
      })
      .join("<hr class='page-break'/>");

    const mcqsHtml = allMcqs
      .map(
        ({ mcq: m, editionDate }, idx) => `
      <div class="mcq-card">
        <p><strong>Q${idx + 1} [${m.category} · ${editionDate}]:</strong> ${m.stem.en}<br/><span class="bn-text">${m.stem.bn}</span></p>
        <p class="options">
          (A) ${m.options.A.en} / ${m.options.A.bn} &nbsp;&nbsp;
          (B) ${m.options.B.en} / ${m.options.B.bn}<br/>
          (C) ${m.options.C.en} / ${m.options.C.bn} &nbsp;&nbsp;
          (D) ${m.options.D.en} / ${m.options.D.bn}
        </p>
        <p class="ans"><strong>Correct Answer: (${m.correctOption})</strong> — ${m.explanation.en}<br/><span class="bn-text">${m.explanation.bn}</span></p>
      </div>`
      )
      .join("\n");

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${bookletTitle} — WBPSC Categorized Current Affairs Capsule</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', 'Noto Sans Bengali', sans-serif; color: #0f172a; max-width: 980px; margin: 24px auto; padding: 0 20px; line-height: 1.55; }
    .doc-header { border-bottom: 3px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .doc-header h1 { margin: 0; font-size: 22px; }
    .toc-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 12.5px; }
    .category-banner { background: #0f172a; color: #f8fafc; border-left: 5px solid #10b981; padding: 10px 16px; border-radius: 6px; margin: 18px 0 14px; }
    .category-banner h2 { margin: 0; font-size: 16px; text-transform: uppercase; letter-spacing: 0.04em; }
    .bn-title { font-family: 'Noto Sans Bengali', sans-serif; color: #334155; font-size: 14px; font-weight: 600; }
    .bn-text { font-family: 'Noto Sans Bengali', sans-serif; color: #334155; }
    .topic-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; page-break-inside: avoid; }
    .topic-meta { font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase; }
    .topic-card h3 { margin: 4px 0 2px; font-size: 15.5px; color: #0f172a; }
    .why-news { font-size: 13px; margin: 8px 0; color: #1e293b; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
    .col h4 { margin: 0 0 6px; font-size: 11.5px; text-transform: uppercase; color: #475569; }
    .col ul { margin: 0; padding-left: 18px; font-size: 12.5px; }
    .col li { margin-bottom: 4px; }
    .gk-box { margin-top: 10px; background: #f0f9ff; border-left: 3px solid #0284c7; padding: 8px 12px; font-size: 12.5px; }
    .trap-box { margin-top: 8px; background: #fffbeb; border-left: 3px solid #d97706; padding: 7px 12px; font-size: 12px; color: #92400e; }
    .mcq-header { margin-top: 28px; border-bottom: 2px solid #0f172a; padding-bottom: 6px; font-size: 17px; }
    .mcq-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; font-size: 12.5px; page-break-inside: avoid; }
    .options { color: #334155; margin: 6px 0; }
    .ans { color: #065f46; background: #ecfdf5; padding: 6px 10px; border-radius: 4px; margin: 4px 0 0; }
    .page-break { margin: 28px 0; border: none; border-top: 2px dashed #94a3b8; page-break-after: always; }
  </style>
</head>
<body>
  <div class="doc-header">
    <div>
      <h1>WBPSC Clerkship Dec 2026 — Categorized Current Affairs Capsule</h1>
      <div style="font-size:12px;color:#475569;">${bookletTitle} · Classified by Category (Sports, Awards, Science & Tech, Polity, Economy, WB Special) · Grounded on GKToday, PYQArena (The Hindu) & PIB</div>
    </div>
    <div style="font-size:12px;font-weight:700;color:#059669;">Bilingual (EN + বাংলা)</div>
  </div>
  <div class="toc-box">
    <strong>Categorized Index (Prepared by Classifier Agent):</strong>
    ${sortedCategories
      .map((c, idx) => `${idx + 1}. ${c} (${byCategory[c].length})`)
      .join(" &nbsp;·&nbsp; ")}
  </div>
  ${categorySectionsHtml}
  <h2 class="mcq-header">PYQ-Pattern Practice MCQs (${allMcqs.length} Questions)</h2>
  ${mcqsHtml}
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameSlug}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify?.(
      "success",
      `Downloaded Categorized Capsule "${filenameSlug}.html" (Open & press Ctrl+P to save as PDF).`
    );
  };

  // Calendar navigation helpers
  const availableMonthKeys = useMemo(() => {
    const keys = new Set<string>([
      "2026-11",
      "2026-10",
      "2026-09",
      "2026-08",
      "2026-07",
      "2026-06",
      "2026-05",
      "2026-04",
      "2026-03",
      "2026-02",
      "2026-01",
      "2025-12",
    ]);
    for (const m of monthsArchive) keys.add(m.monthKey);
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [monthsArchive]);

  const calendarCells = useMemo(
    () => buildCalendarDays(calendarMonthKey),
    [calendarMonthKey]
  );

  const stepCalendarMonth = (delta: number) => {
    const idx = availableMonthKeys.indexOf(calendarMonthKey);
    if (idx === -1) return;
    const nextIdx = Math.max(0, Math.min(availableMonthKeys.length - 1, idx + delta));
    setCalendarMonthKey(availableMonthKeys[nextIdx]);
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-sm text-slate-400">
        Loading 1-Year Categorized Current Affairs Archive (Dec 2025 – Nov 2026) &amp;
        Classifier Agent...
      </div>
    );
  }

  const categoryEntries = Object.entries(stats?.categoryCounts || {}).sort(
    (a, b) => b[1] - a[1]
  );

  const activeFloatingTopic = modalDeckTopics[floatingCardIdx] || modalDeckTopics[0] || null;

  return (
    <div className="space-y-5">
      {/* ====================================================================
          1. TOP HEADER & 1-YEAR CLERKSHIP CATEGORIZED CAPSULE BAR
      ==================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
              <Bot className="w-4 h-4" />
              <span>
                Multi-Agent Current Affairs Suite · Grounded on GKToday, PYQArena (The
                Hindu), PIB &amp; WB Gazette
              </span>
            </div>
            <h1 className="text-xl font-bold text-white">
              {lang === "bn"
                ? "ডিসেম্বর ২০২৬ ক্লার্কশিপ ১-বছরের ক্যাটাগরিভিত্তিক কারেন্ট অ্যাফেয়ার্স ও এজেন্ট ড্যাশবোর্ড"
                : "1-Year Categorized Current Affairs Archive (Dec 2025 – Nov 2026) & Classifier Agent"}
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === "bn"
                ? "প্রতিটি সংস্করণে ১০–১২টি গুরুত্বপূর্ণ পরীক্ষা-কেন্দ্রিক টপিক, ফ্লোটিং অ্যানিমেটেড কার্ড ভিউ, ইন্টারেক্টিভ মাসিক ক্যালেন্ডার এবং ক্রীড়া, পুরস্কার, বিজ্ঞান ও প্রযুক্তি সহ ক্যাটাগরিভিত্তিক মাসিক PDF ক্যাপসুল।"
                : "Collects 10–12 high-yield WBPSC topics per edition, classifies them automatically into Sports, Awards, Science & Tech, Polity, Economy & West Bengal Special, and compiles downloadable Monthly & 1-Year Categorized PDF Capsules for the December 2026 Clerkship Exam."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setFloatingCardIdx(0);
                setFloatingModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg transition-colors cursor-pointer shadow-sm"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Floating Animated Card Deck ({modalDeckTopics.length} Cards)
            </button>

            <button
              type="button"
              onClick={() => setShowAgentPanel((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors cursor-pointer shadow-sm"
            >
              <Bot className="w-4 h-4" />
              {showAgentPanel ? "Close Agent Studio" : "Run 12-Topic CA Agent"}
            </button>

            <button
              type="button"
              onClick={() =>
                void handleDownloadCategorizedCapsulePdf(
                  editions,
                  `1-Year WBPSC Clerkship Dec 2026 Categorized Mega-Capsule (${stats?.monthsStoredCount ?? 12} Months)`,
                  `WBPSC-Clerkship-1Year-Categorized-CA-2025-2026`
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5 text-sky-400" />
              1-Year Clerkship PDF ({stats?.monthsStoredCount ?? 0} Months)
            </button>
          </div>
        </div>

        {/* ====================================================================
            2. FOUR STATUS & STATISTICS CARDS
        ==================================================================== */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>1-Year Clerkship Coverage</span>
                <CalendarIcon className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {stats.monthsStoredCount} Months Stored
              </div>
              <div className="text-[11px] text-slate-400">
                <span className="text-emerald-400 font-mono">
                  {stats.earliestDate?.slice(0, 7)} → {stats.latestDate?.slice(0, 7)}
                </span>
                <span aria-hidden="true"> · </span>
                <span>{stats.totalEditionsCount} Editions</span>
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Classified Exam Topics &amp; Bullets</span>
                <Layers className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-xl font-bold font-mono text-sky-300">
                {stats.totalTopicsCount} Exam Topics
              </div>
              <div className="text-[11px] text-slate-400">
                <span>{stats.totalExamPointersCount} Concise Pointers</span>
                <span aria-hidden="true"> · </span>
                <span className="text-sky-400">
                  {Object.keys(stats.categoryCounts).length} Categories
                </span>
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Static GK Hooks &amp; PYQ MCQs</span>
                <BookOpen className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-xl font-bold font-mono text-amber-300">
                {stats.totalMcqsCount} Bilingual MCQs
              </div>
              <div className="text-[11px] text-slate-400">
                <span>{stats.totalTopicsCount} Static GK Links</span>
                <span aria-hidden="true"> · </span>
                <span className="text-amber-300">EN + বাংলা</span>
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Grounded Portals &amp; PDF Downloads</span>
                <Download className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {stats.totalDownloadsCount} Downloads
              </div>
              <div className="text-[11px] text-slate-400">
                <span className="text-purple-300">GKToday · PYQArena · The Hindu · PIB</span>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            3. AUTONOMOUS 12-TOPIC HARVESTER + CLASSIFIER AGENT STUDIO
        ==================================================================== */}
        {showAgentPanel && (
          <form
            onSubmit={handleRunAgent}
            className="bg-slate-950 border border-emerald-500/40 rounded-xl p-4 space-y-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div>
                <h2 className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Autonomous 10–12 Topic Harvester &amp; Category Classifier Agent
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Grounds on GKToday (`gktoday.in`), PYQArena (`pyqarena.com`), The Hindu &amp;
                  PIB to collect 10–12 high-yield WBPSC topics and classify them by category.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setAgentEditionDate("2026-09-02");
                    setAgentSourceUrl(
                      "https://www.pyqarena.com/current-affairs-from-the-hindu-2nd-september-2026/"
                    );
                    setAgentFocusTopics(
                      "PYQArena (The Hindu 2nd Sept 2026) + GKToday: Collect 12 top WBPSC topics across Polity, WB Special, Economy, Science, Sports, Awards, Defence & Indices"
                    );
                  }}
                  className="px-2.5 py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-700 rounded-md cursor-pointer"
                >
                  Preset: PYQArena + GKToday (2 Sept)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAgentEditionDate(new Date().toISOString().slice(0, 10));
                    setAgentSourceUrl("https://www.gktoday.in/current-affairs/");
                    setAgentFocusTopics(
                      "GKToday + The Hindu + PIB: Collect 12 important PSCWB exam-oriented topics across Sports, Awards, Science & Tech, Polity, Economy & West Bengal"
                    );
                  }}
                  className="px-2.5 py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-sky-300 border border-slate-700 rounded-md cursor-pointer"
                >
                  Preset: GKToday Daily 12-Topic Set
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Target Date *
                </label>
                <input
                  type="date"
                  required
                  value={agentEditionDate}
                  onChange={(e) => setAgentEditionDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white font-mono"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Grounding Source URL (GKToday / PYQArena / The Hindu / PIB)
                </label>
                <input
                  type="url"
                  value={agentSourceUrl}
                  onChange={(e) => setAgentSourceUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Category &amp; Syllabus Focus Instructions for Agent
              </label>
              <input
                type="text"
                value={agentFocusTopics}
                onChange={(e) => setAgentFocusTopics(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] text-slate-400">
                Collects 10–12 exam-oriented topics, classifies them into categories, and enables
                the Floating Animated Card Deck &amp; Monthly PDF.
              </span>
              <button
                type="submit"
                disabled={agentBusy}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer shrink-0"
              >
                {agentBusy ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Scouting GKToday &amp; PYQArena (12 Topics)...
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4" />
                    Synthesize 12 Topics &amp; Save
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ====================================================================
          4. 1-YEAR (12-MONTH) CATEGORIZED CAPSULES STRIP (SCROLLABLE)
      ==================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white">
              {lang === "bn"
                ? `ডিসেম্বর ২০২৬ ক্লার্কশিপ: বিগত ১ বছরের মাসিক ক্যাটাগরিভিত্তিক ক্যাপসুল (${monthsArchive.length} মাস)`
                : `1-Year Categorized Monthly Capsules for Dec 2026 Clerkship (${monthsArchive.length} Months Ready)`}
            </h2>
            <p className="text-xs text-slate-400">
              Click any month to filter by month, run the End-of-Month Classifier Agent, or
              download that month&apos;s Categorized PDF Capsule.
            </p>
          </div>
          {selectedMonthKey !== "all" && (
            <button
              type="button"
              onClick={() => {
                setSelectedMonthKey("all");
                setSelectedCalendarDate(null);
              }}
              className="text-xs font-semibold text-emerald-400 hover:underline cursor-pointer"
            >
              Reset Month Filter (Show All {editions.length} Editions)
            </button>
          )}
        </div>

        {/* Fixed-height horizontal/grid scrollable 12-month archive cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-[210px] overflow-y-auto pr-1">
          {monthsArchive.map((m) => {
            const isSelected = selectedMonthKey === m.monthKey;
            const monthEditions = editions.filter((e) => e.monthKey === m.monthKey);
            const isClassifying = classifierBusyMonth === m.monthKey;
            return (
              <div
                key={m.monthKey}
                onClick={() => {
                  setSelectedMonthKey(isSelected ? "all" : m.monthKey);
                  setCalendarMonthKey(m.monthKey);
                  if (!isSelected && monthEditions[0]) {
                    setActiveEditionId(monthEditions[0].id);
                  }
                }}
                className={`rounded-xl p-3 border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-emerald-500/15 border-emerald-500/50"
                    : "bg-slate-950/80 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-xs text-white">
                    {lang === "bn" ? m.monthLabelBn : m.monthLabelEn}
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400">
                    {m.topicsCount} Topics
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  <span>{m.editionsCount} Ed.</span>
                  <span aria-hidden="true"> · </span>
                  <span>{m.mcqsCount} MCQs</span>
                  <span aria-hidden="true"> · </span>
                  <span>{m.downloadsCount} DLs</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={isClassifying}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRunMonthlyClassifierAgent(m.monthKey);
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 hover:text-emerald-200 cursor-pointer"
                    title="Run Classifier Agent to compile 12 categorized topics for this month"
                  >
                    <Bot className="w-3 h-3" />
                    {isClassifying ? "Classifying..." : "Classifier Agent"}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDownloadCategorizedCapsulePdf(
                        monthEditions,
                        `${m.monthLabelEn} (${m.monthLabelBn}) — Categorized Monthly Capsule`,
                        `WBPSC-CA-Categorized-${m.monthKey}`
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-300 hover:text-sky-200 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    Monthly PDF
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Category Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400 inline-flex items-center gap-1 mr-1">
              <Filter className="w-3.5 h-3.5" />
              Category:
            </span>
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                selectedCategory === "all"
                  ? "bg-slate-200 text-slate-950 font-semibold"
                  : "bg-slate-950 text-slate-400 hover:text-white border border-slate-800"
              }`}
            >
              All ({stats?.totalTopicsCount ?? 0})
            </button>
            {categoryEntries.map(([cat, count]) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(selectedCategory === cat ? "all" : cat)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                  selectedCategory === cat
                    ? "bg-emerald-500 text-slate-950 font-semibold"
                    : "bg-slate-950 text-slate-400 hover:text-white border border-slate-800"
                }`}
              >
                {cat} ({count})
              </button>
            ))}
          </div>

          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search topic, Sports, Awards, ISRO..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
            />
          </div>
        </div>
      </div>

      {/* ====================================================================
          5. MAIN FIXED-HEIGHT RESPONSIVE WORKSPACE:
             - LEFT (4 Cols): INTERACTIVE MONTHLY CALENDAR + STORED EDITIONS LIST
             - RIGHT (8 Cols): FIXED-HEIGHT SCROLLABLE CONTAINER + FLOATING CARD LAUNCHER
      ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* LEFT COLUMN: Interactive Monthly Calendar + Editions List (Fixed Height + Scroll) */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col h-[660px]">
          {/* Interactive Monthly Calendar */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 mb-3 shrink-0">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <button
                type="button"
                onClick={() => stepCalendarMonth(1)}
                className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
                title="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5 text-emerald-400" />
                <select
                  value={calendarMonthKey}
                  onChange={(e) => setCalendarMonthKey(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs font-bold text-white cursor-pointer"
                >
                  {availableMonthKeys.map((mk) => (
                    <option key={mk} value={mk}>
                      {mk}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => stepCalendarMonth(-1)}
                className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
                title="Next Month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-500 mb-1">
              {WEEKDAYS.map((wd) => (
                <div key={wd}>{wd}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map((cell, idx) => {
                if (!cell.dayNumber || !cell.dateStr) {
                  return <div key={`empty-${idx}`} className="h-7" />;
                }
                const matchingEdition = editionsByDate.get(cell.dateStr);
                const isSelectedDate =
                  activeEdition?.editionDate === cell.dateStr ||
                  selectedCalendarDate === cell.dateStr;

                return (
                  <button
                    key={cell.dateStr}
                    type="button"
                    onClick={() => {
                      setSelectedCalendarDate(cell.dateStr);
                      if (matchingEdition) {
                        setActiveEditionId(matchingEdition.id);
                        setSelectedMonthKey("all");
                      } else {
                        setAgentEditionDate(cell.dateStr!);
                      }
                    }}
                    title={
                      matchingEdition
                        ? `${cell.dateStr}: ${matchingEdition.topics.length} Topics stored`
                        : `${cell.dateStr}: Click to synthesize with CA Agent`
                    }
                    className={`h-7 rounded-md text-[11px] font-mono transition-all flex flex-col items-center justify-center relative cursor-pointer ${
                      isSelectedDate
                        ? "bg-emerald-500 text-slate-950 font-bold shadow-sm"
                        : matchingEdition
                          ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 font-bold hover:bg-emerald-500/30"
                          : "bg-slate-900/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    <span>{cell.dayNumber}</span>
                    {matchingEdition && !isSelectedDate && (
                      <span className="w-1 h-1 rounded-full bg-emerald-400 absolute bottom-0.5" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* If user clicked a date on the calendar that doesn't have an edition yet, offer 1-click Agent synthesis */}
            {selectedCalendarDate && !editionsByDate.has(selectedCalendarDate) && (
              <div className="mt-2.5 pt-2.5 border-t border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-300">
                  No digest stored for{" "}
                  <strong className="font-mono text-amber-300">
                    {selectedCalendarDate}
                  </strong>
                </span>
                <button
                  type="button"
                  disabled={agentBusy}
                  onClick={() => {
                    setAgentEditionDate(selectedCalendarDate);
                    setShowAgentPanel(true);
                  }}
                  className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold cursor-pointer shrink-0"
                >
                  Collect 12 Topics →
                </button>
              </div>
            )}
          </div>

          {/* Stored Editions List (Scrollable flex-1 inside fixed-height left card) */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2 shrink-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Stored Editions ({filteredEditions.length})
            </h3>
            <span className="text-[11px] text-slate-400">Scrollable</span>
          </div>

          <div className="space-y-2 flex-1 overflow-y-auto pr-1">
            {filteredEditions.map((ed) => {
              const isSelected = activeEdition?.id === ed.id;
              return (
                <div
                  key={ed.id}
                  onClick={() => {
                    setActiveEditionId(ed.id);
                    setCalendarMonthKey(ed.monthKey);
                    setSelectedCalendarDate(ed.editionDate);
                    setSelectedAnswers({});
                    setQuizSubmitted(false);
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-emerald-500/15 border-emerald-500/50"
                      : "bg-slate-950/70 border-slate-800/90 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="font-mono font-semibold text-emerald-400">
                      {ed.editionDate}
                    </span>
                    <span>
                      {ed.topics.length} Topics · {ed.mcqs.length} MCQs
                    </span>
                  </div>
                  <div className="text-xs font-bold text-white mt-1 leading-snug line-clamp-2">
                    {lang === "bn" ? ed.titleBn : ed.titleEn}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>{lang === "bn" ? ed.monthLabelBn : ed.monthLabelEn}</span>
                    <span>{ed.downloadCount} DLs</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: Fixed-Height Responsive Reader with Vertical Scrollbar & Floating Card Deck Trigger */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-[660px]">
          {!activeEdition ? (
            <div className="m-auto text-center text-sm text-slate-400">
              No Current Affairs edition matches the current filter.
            </div>
          ) : (
            <>
              {/* Fixed Top Header inside Right Container */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3.5 shrink-0">
                <div className="space-y-1 max-w-xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono font-bold text-emerald-400">
                      {activeEdition.editionDate}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {lang === "bn"
                        ? activeEdition.monthLabelBn
                        : activeEdition.monthLabelEn}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{activeEdition.topics.length} Classified Topics</span>
                  </div>
                  <h2 className="text-base lg:text-lg font-bold text-white leading-snug">
                    {lang === "bn" ? activeEdition.titleBn : activeEdition.titleEn}
                  </h2>
                </div>

                {/* Action Buttons: Launch Floating Card Modal + Download Categorized PDF */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setFloatingCardIdx(0);
                      setFloatingModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg cursor-pointer shadow-sm"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Floating Card View ({modalDeckTopics.length})
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void handleDownloadCategorizedCapsulePdf(
                        [activeEdition],
                        activeEdition.titleEn,
                        `WBPSC-CA-Categorized-${activeEdition.editionDate}`
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Categorized PDF
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void recordDownload(activeEdition.id);
                      window.print();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                    title="Print / Save as PDF"
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() =>
                        void handleDeleteEdition(
                          activeEdition.id,
                          activeEdition.editionDate
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-lg cursor-pointer"
                      title="Delete Edition (Admin)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* View Mode Tabs Bar (Fixed below header) */}
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-b border-slate-800/80 shrink-0">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setActiveViewMode("notes")}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      activeViewMode === "notes"
                        ? "bg-emerald-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Edition Topics ({filteredTopicsInActiveEdition.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveViewMode("categorized-month")}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      activeViewMode === "categorized-month"
                        ? "bg-emerald-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    By Category (Monthly Capsule)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveViewMode("mcqs")}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      activeViewMode === "mcqs"
                        ? "bg-emerald-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Practice MCQs ({activeEdition.mcqs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveViewMode("agent-trace")}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      activeViewMode === "agent-trace"
                        ? "bg-emerald-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Agent Trace ({activeEdition.agentTrace.length})
                  </button>
                </div>

                {/* Grounded Sources inline */}
                <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Globe className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Grounded: GKToday · PYQArena · The Hindu · PIB</span>
                </div>
              </div>

              {/* SCROLLABLE CONTENT BODY INSIDE FIXED-HEIGHT RIGHT CONTAINER */}
              <div className="flex-1 overflow-y-auto pr-1.5 pt-3 space-y-4">
                {/* Quick Revision Mnemonics Callout */}
                {(activeEdition.mnemonicsEn || activeEdition.mnemonicsBn) && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-xs text-emerald-200 leading-relaxed">
                    <strong className="text-emerald-300 uppercase tracking-wider block mb-0.5">
                      {lang === "bn"
                        ? "এক-নজরে পরীক্ষার মেমরি হুক (Quick Revision Hooks):"
                        : "One-Glance Exam Memory Hooks:"}
                    </strong>
                    {lang === "bn"
                      ? activeEdition.mnemonicsBn || activeEdition.mnemonicsEn
                      : activeEdition.mnemonicsEn}
                  </div>
                )}

                {/* VIEW 1: EDITION TOPICS LIST (Click any card to open in Floating Animated Modal) */}
                {activeViewMode === "notes" && (
                  <div className="space-y-3.5">
                    {filteredTopicsInActiveEdition.map((topic, idx) => {
                      const points =
                        lang === "bn" && topic.examPointsBn?.length
                          ? topic.examPointsBn
                          : topic.examPointsEn;
                      return (
                        <article
                          key={topic.id}
                          className="bg-slate-950/90 border border-slate-800 hover:border-slate-700 rounded-xl p-4 space-y-3 transition-colors"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="space-y-0.5 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                <span className="font-bold text-sky-400">
                                  Topic {String(idx + 1).padStart(2, "0")}/
                                  { String(filteredTopicsInActiveEdition.length).padStart(2, "0")}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-semibold text-emerald-400">
                                  {topic.category}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{topic.sourceTag}</span>
                              </div>
                              <h3 className="text-sm lg:text-base font-bold text-white leading-snug">
                                {lang === "bn" ? topic.headlineBn : topic.headlineEn}
                              </h3>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setFloatingCardIdx(idx);
                                setFloatingModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 rounded-lg cursor-pointer shrink-0"
                            >
                              <Maximize2 className="w-3 h-3" />
                              Card View
                            </button>
                          </div>

                          <div className="text-xs text-slate-300 bg-slate-900/90 border border-slate-800/80 rounded-lg p-2.5 leading-relaxed">
                            <strong className="text-slate-100">
                              {lang === "bn" ? "সংবাদে কেন: " : "Why in News: "}
                            </strong>
                            {lang === "bn" ? topic.whyInNewsBn : topic.whyInNewsEn}
                          </div>

                          <div className="space-y-1">
                            <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                              {lang === "bn"
                                ? "পরীক্ষা-কেন্দ্রিক মূল তথ্য (To-The-Point Exam Facts)"
                                : "To-The-Point Exam Facts (WBPSC Prelims & Mains)"}
                            </h4>
                            <ul className="space-y-1.5 text-xs text-slate-200 leading-relaxed pl-4 list-disc marker:text-emerald-400">
                              {points.map((pt, pIdx) => (
                                <li key={pIdx}>{pt}</li>
                              ))}
                            </ul>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                            <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-2.5 text-xs text-sky-100 leading-relaxed">
                              <div className="font-bold text-sky-300 mb-0.5 flex items-center gap-1.5">
                                <BookOpen className="w-3.5 h-3.5" />
                                {lang === "bn"
                                  ? "স্ট্যাটিক জিকে সিলেবাস সংযোগ"
                                  : "Static GK Syllabus Hook"}
                              </div>
                              {lang === "bn"
                                ? topic.staticGkLinkBn
                                : topic.staticGkLinkEn}
                            </div>

                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-xs text-amber-100 leading-relaxed">
                              <div className="font-bold text-amber-300 mb-0.5 flex items-center gap-1.5">
                                <ShieldAlert className="w-3.5 h-3.5" />
                                {lang === "bn"
                                  ? "পরীক্ষার হলে সম্ভাব্য ভুল (Exam Trap)"
                                  : "Exam Hall Confuser / Trap"}
                              </div>
                              {lang === "bn" ? topic.examTrapBn : topic.examTrapEn}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

                {/* VIEW 2: CATEGORIZED MONTHLY CAPSULE VIEW (Grouped by Sports, Awards, Science & Tech, etc.) */}
                {activeViewMode === "categorized-month" && (
                  <div className="space-y-4">
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                          Classifier Agent Categorized View (Sports, Awards, Science &amp; Tech,
                          Polity, WB Special)
                        </h3>
                        <p className="text-xs text-slate-400">
                          Topics grouped into dedicated exam categories for end-of-month
                          revision.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const targetMonth =
                            selectedMonthKey === "all"
                              ? activeEdition.monthKey
                              : selectedMonthKey;
                          const monthEds = editions.filter(
                            (e) => e.monthKey === targetMonth
                          );
                          void handleDownloadCategorizedCapsulePdf(
                            monthEds,
                            `${activeEdition.monthLabelEn} Categorized Capsule`,
                            `WBPSC-CA-Categorized-${targetMonth}`
                          );
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download This Month&apos;s Categorized PDF
                      </button>
                    </div>

                    {Object.entries(categorizedTopicsForSelectedScope).map(
                      ([cat, items]) => (
                        <div
                          key={cat}
                          className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                            <h4 className="text-sm font-bold text-emerald-400">
                              {cat}
                            </h4>
                            <span className="text-xs font-mono text-slate-400">
                              {items.length} {items.length === 1 ? "Topic" : "Topics"}
                            </span>
                          </div>
                          <div className="space-y-2.5">
                            {items.map(({ topic, editionDate }, i) => (
                              <div
                                key={`${topic.id}-${i}`}
                                className="p-3 rounded-lg bg-slate-900/90 border border-slate-800/80 space-y-1.5"
                              >
                                <div className="flex items-center justify-between text-[11px] text-slate-400">
                                  <span className="font-mono text-sky-400">
                                    {editionDate}
                                  </span>
                                  <span>{topic.sourceTag}</span>
                                </div>
                                <div className="text-xs font-bold text-white">
                                  {lang === "bn" ? topic.headlineBn : topic.headlineEn}
                                </div>
                                <ul className="space-y-1 text-xs text-slate-300 pl-4 list-disc marker:text-emerald-400">
                                  {(lang === "bn" && topic.examPointsBn?.length
                                    ? topic.examPointsBn
                                    : topic.examPointsEn
                                  ).map((p, pIdx) => (
                                    <li key={pIdx}>{p}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}

                {/* VIEW 3: INTERACTIVE PYQ-GRADE PRACTICE MCQS */}
                {activeViewMode === "mcqs" && (
                  <div className="space-y-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3.5">
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          {lang === "bn"
                            ? "কারেন্ট অ্যাফেয়ার্স প্র্যাকটিস কুইজ"
                            : "Edition Current Affairs Practice Quiz"}
                        </h3>
                        <p className="text-xs text-slate-400">
                          Select options below and click Verify Answers to test your recall.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {quizSubmitted && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAnswers({});
                              setQuizSubmitted(false);
                            }}
                            className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                          >
                            Reset Quiz
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setQuizSubmitted(true)}
                          className="px-4 py-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                        >
                          Verify Answers
                        </button>
                      </div>
                    </div>

                    {activeEdition.mcqs.map((mcq, idx) => {
                      const picked = selectedAnswers[mcq.id];
                      const isCorrect = picked === mcq.correctOption;
                      return (
                        <div
                          key={mcq.id}
                          className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3"
                        >
                          <div className="text-xs text-emerald-400 font-semibold">
                            Question {idx + 1} · {mcq.category}
                          </div>
                          <p className="text-sm font-semibold text-white leading-relaxed">
                            {lang === "bn" ? mcq.stem.bn : mcq.stem.en}
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {OPTION_KEYS.map((optKey) => {
                              const isPicked = picked === optKey;
                              const isRightOpt = mcq.correctOption === optKey;
                              let btnStyle =
                                "bg-slate-900 border-slate-800 text-slate-200 hover:border-slate-700";
                              if (quizSubmitted) {
                                if (isRightOpt) {
                                  btnStyle =
                                    "bg-emerald-500/20 border-emerald-500/50 text-emerald-200 font-semibold";
                                } else if (isPicked && !isRightOpt) {
                                  btnStyle =
                                    "bg-rose-500/20 border-rose-500/50 text-rose-200";
                                }
                              } else if (isPicked) {
                                btnStyle =
                                  "bg-sky-500/20 border-sky-500/50 text-sky-200 font-semibold";
                              }

                              return (
                                <button
                                  key={optKey}
                                  type="button"
                                  disabled={quizSubmitted}
                                  onClick={() =>
                                    setSelectedAnswers((prev) => ({
                                      ...prev,
                                      [mcq.id]: optKey,
                                    }))
                                  }
                                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-start gap-2 cursor-pointer ${btnStyle}`}
                                >
                                  <span className="font-mono font-bold">{optKey}.</span>
                                  <span className="flex-1">
                                    {lang === "bn"
                                      ? mcq.options[optKey].bn
                                      : mcq.options[optKey].en}
                                  </span>
                                  {quizSubmitted && isRightOpt && (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                  )}
                                  {quizSubmitted && isPicked && !isRightOpt && (
                                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {quizSubmitted && (
                            <div
                              className={`p-3 rounded-lg border text-xs leading-relaxed ${
                                isCorrect
                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                                  : "bg-slate-900 border-slate-800 text-slate-300"
                              }`}
                            >
                              <strong className="text-emerald-300">
                                Correct Option ({mcq.correctOption}):{" "}
                              </strong>
                              {lang === "bn" ? mcq.explanation.bn : mcq.explanation.en}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* VIEW 4: AGENT EXECUTION TRACE */}
                {activeViewMode === "agent-trace" && (
                  <div className="space-y-3">
                    {activeEdition.agentTrace.map((step) => (
                      <div
                        key={step.stepNumber}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-emerald-400">
                            Step {step.stepNumber}: {step.agentRole}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {step.durationMs} ms · {step.status.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-white">
                          {step.actionSummary}
                        </div>
                        <p className="text-xs text-slate-400">{step.details}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ====================================================================
          6. FLOATING ANIMATED FLASHCARD MODAL (WITH NEXT & PREVIOUS BUTTONS)
      ==================================================================== */}
      {floatingModalOpen && activeFloatingTopic && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4"
          onClick={() => setFloatingModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-4xl bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] transition-all duration-300"
          >
            {/* Modal Top Header Bar */}
            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-800 bg-slate-950/90 shrink-0">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-xs font-mono font-bold text-emerald-300">
                  Card {floatingCardIdx + 1} of {modalDeckTopics.length}
                </span>
                <div>
                  <div className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                    {activeFloatingTopic.category}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {activeEdition?.editionDate} · {activeFloatingTopic.sourceTag}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFloatingModalOpen(false)}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                  title="Close Floating Deck (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Animated Floating Card Body (Fixed Height with Vertical Scrollbar) */}
            <div
              key={`${activeFloatingTopic.id}-${cardAnimDirection}`}
              className="p-6 overflow-y-auto space-y-4 flex-1 transition-all duration-300 ease-out"
            >
              <div className="space-y-1">
                <h2 className="text-lg lg:text-xl font-bold text-white leading-snug">
                  {lang === "bn"
                    ? activeFloatingTopic.headlineBn
                    : activeFloatingTopic.headlineEn}
                </h2>
                {lang === "bn" && (
                  <div className="text-xs text-slate-400">
                    {activeFloatingTopic.headlineEn}
                  </div>
                )}
              </div>

              {/* Why in News Box */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs lg:text-sm text-slate-200 leading-relaxed">
                <strong className="text-emerald-400">
                  {lang === "bn" ? "সংবাদে কেন (Why in News): " : "Why in News: "}
                </strong>
                {lang === "bn"
                  ? activeFloatingTopic.whyInNewsBn
                  : activeFloatingTopic.whyInNewsEn}
              </div>

              {/* To-The-Point Exam Facts */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-5 space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  {lang === "bn"
                    ? "পরীক্ষা-কেন্দ্রিক মূল তথ্য (To-The-Point Exam Facts — WBPSC Prelims & Mains)"
                    : "To-The-Point Exam Facts (WBPSC Prelims & Mains)"}
                </h3>
                <ul className="space-y-2.5 text-xs lg:text-sm text-slate-100 leading-relaxed pl-5 list-disc marker:text-emerald-400">
                  {(lang === "bn" && activeFloatingTopic.examPointsBn?.length
                    ? activeFloatingTopic.examPointsBn
                    : activeFloatingTopic.examPointsEn
                  ).map((pt, i) => (
                    <li key={i}>{pt}</li>
                  ))}
                </ul>
              </div>

              {/* Static GK Hook & Exam Hall Trap */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-4 text-xs lg:text-sm text-sky-100 leading-relaxed">
                  <div className="font-bold text-sky-300 mb-1 flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4" />
                    {lang === "bn"
                      ? "স্ট্যাটিক জিকে সিলেবাস সংযোগ"
                      : "Static GK Syllabus Hook"}
                  </div>
                  {lang === "bn"
                    ? activeFloatingTopic.staticGkLinkBn
                    : activeFloatingTopic.staticGkLinkEn}
                </div>

                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-xs lg:text-sm text-amber-100 leading-relaxed">
                  <div className="font-bold text-amber-300 mb-1 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4" />
                    {lang === "bn"
                      ? "পরীক্ষার হলে সম্ভাব্য ভুল (Exam Hall Trap)"
                      : "Exam Hall Confuser / Trap"}
                  </div>
                  {lang === "bn"
                    ? activeFloatingTopic.examTrapBn
                    : activeFloatingTopic.examTrapEn}
                </div>
              </div>
            </div>

            {/* Modal Footer: Previous / Progress Dots / Next Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-t border-slate-800 bg-slate-950/90 shrink-0">
              <button
                type="button"
                onClick={goPrevCard}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous Topic
              </button>

              {/* Interactive Card Number Dots */}
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {modalDeckTopics.map((t, idx) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFloatingCardIdx(idx)}
                    className={`w-6 h-6 rounded-md text-[11px] font-mono font-bold transition-all cursor-pointer ${
                      idx === floatingCardIdx
                        ? "bg-emerald-500 text-slate-950 scale-110"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                    }`}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={goNextCard}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl transition-colors cursor-pointer"
              >
                Next Topic
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
