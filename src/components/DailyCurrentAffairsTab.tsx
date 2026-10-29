import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  Calendar,
  CheckCircle2,
  Download,
  ExternalLink,
  FileDown,
  Filter,
  Globe,
  Layers,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
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

  // Selection & Filters
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeEditionId, setActiveEditionId] = useState<string | null>(null);
  const [activeViewMode, setActiveViewMode] = useState<"notes" | "mcqs" | "agent-trace">("notes");

  // Autonomous Agent Runner Form State
  const [showAgentPanel, setShowAgentPanel] = useState<boolean>(false);
  const [agentBusy, setAgentBusy] = useState<boolean>(false);
  const [agentEditionDate, setAgentEditionDate] = useState<string>("2026-09-02");
  const [agentSourceUrl, setAgentSourceUrl] = useState<string>(
    "https://www.pyqarena.com/current-affairs-from-the-hindu-2nd-september-2026/"
  );
  const [agentFocusTopics, setAgentFocusTopics] = useState<string>(
    "The Hindu & PIB Exam-Oriented Highlights; West Bengal State Schemes & Heritage; RBI Monetary & Banking Updates; Constitutional & Supreme Court Rulings"
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
        setActiveEditionId((prev) =>
          prev && res.editions.some((e) => e.id === prev) ? prev : res.editions[0].id
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
        }),
      });
      await loadArchive();
      setActiveEditionId(res.editionId);
      setSelectedMonthKey("all");
      setShowAgentPanel(false);
      onNotify?.(
        "success",
        `CA Agent synthesized ${res.topicsCount} concise exam topics & ${res.mcqsCount} MCQs for ${res.editionDate}.`
      );
    } catch (err) {
      onError(err, "Autonomous Current Affairs Agent execution failed.");
    } finally {
      setAgentBusy(false);
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

  const handleDownloadPrintableHtmlBooklet = async (
    targetEditions: CaEditionDto[],
    bookletTitle: string,
    filenameSlug: string
  ) => {
    if (targetEditions.length === 0) return;
    await recordDownload(targetEditions[0].id);

    const htmlSections = targetEditions
      .map((ed) => {
        const topicsHtml = ed.topics
          .map(
            (t, idx) => `
          <div class="topic-card">
            <div class="topic-meta">${t.category} · Source: ${t.sourceTag}</div>
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

        const mcqsHtml = ed.mcqs
          .map(
            (m, idx) => `
          <div class="mcq-card">
            <p><strong>Q${idx + 1} [${m.category}]:</strong> ${m.stem.en}<br/><span class="bn-text">${m.stem.bn}</span></p>
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

        return `
        <section class="edition-section">
          <div class="edition-banner">
            <div>
              <div class="edition-date">Edition Date: ${ed.editionDate} · Month: ${ed.monthLabelEn} (${ed.monthLabelBn})</div>
              <h2>${ed.titleEn}</h2>
              <div class="bn-title">${ed.titleBn}</div>
            </div>
          </div>
          <p class="summary">${ed.executiveSummaryEn}<br/><span class="bn-text">${ed.executiveSummaryBn}</span></p>
          ${ed.mnemonicsEn ? `<div class="mnemonic-bar"><strong>Quick Revision Hooks:</strong> ${ed.mnemonicsEn}<br/><span class="bn-text">${ed.mnemonicsBn}</span></div>` : ""}
          ${topicsHtml}
          <h3 class="mcq-header">PYQ-Pattern Practice MCQs (${ed.mcqs.length} Questions)</h3>
          ${mcqsHtml}
        </section>`;
      })
      .join("<hr class='page-break'/>");

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${bookletTitle} — WBPSC Current Affairs Digest</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', 'Noto Sans Bengali', sans-serif; color: #0f172a; max-width: 960px; margin: 24px auto; padding: 0 20px; line-height: 1.55; }
    .doc-header { border-bottom: 3px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .doc-header h1 { margin: 0; font-size: 22px; }
    .edition-banner { background: #f8fafc; border-left: 4px solid #059669; padding: 12px 16px; margin-bottom: 14px; }
    .edition-banner h2 { margin: 4px 0; font-size: 18px; }
    .edition-date { font-size: 12px; color: #047857; font-weight: 700; text-transform: uppercase; }
    .bn-title { font-family: 'Noto Sans Bengali', sans-serif; color: #334155; font-size: 14px; font-weight: 600; }
    .bn-text { font-family: 'Noto Sans Bengali', sans-serif; color: #334155; }
    .mnemonic-bar { background: #ecfdf5; border: 1px solid #a7f3d0; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; }
    .topic-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; page-break-inside: avoid; }
    .topic-meta { font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase; }
    .topic-card h3 { margin: 4px 0 2px; font-size: 16px; color: #0f172a; }
    .why-news { font-size: 13px; margin: 8px 0; color: #1e293b; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
    .col h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; color: #475569; }
    .col ul { margin: 0; padding-left: 18px; font-size: 12.5px; }
    .col li { margin-bottom: 4px; }
    .gk-box { margin-top: 10px; background: #f0f9ff; border-left: 3px solid #0284c7; padding: 8px 12px; font-size: 12.5px; }
    .trap-box { margin-top: 8px; background: #fffbeb; border-left: 3px solid #d97706; padding: 7px 12px; font-size: 12px; color: #92400e; }
    .mcq-header { margin-top: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; font-size: 16px; }
    .mcq-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; font-size: 12.5px; page-break-inside: avoid; }
    .options { color: #334155; margin: 6px 0; }
    .ans { color: #065f46; background: #ecfdf5; padding: 6px 10px; border-radius: 4px; margin: 4px 0 0; }
    .page-break { margin: 32px 0; border: none; border-top: 2px dashed #94a3b8; page-break-after: always; }
  </style>
</head>
<body>
  <div class="doc-header">
    <div>
      <h1>WBPSC Mock Tutor — Exam-Oriented Current Affairs Booklet</h1>
      <div style="font-size:12px;color:#475569;">${bookletTitle} · Grounded on PYQArena (The Hindu), PIB & West Bengal State Gazette</div>
    </div>
    <div style="font-size:12px;font-weight:600;color:#059669;">Bilingual (English + বাংলা)</div>
  </div>
  ${htmlSections}
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
      `Downloaded "${filenameSlug}.html" (Open in any browser & press Ctrl+P to save as PDF).`
    );
  };

  const handleDownloadMarkdown = async (ed: CaEditionDto) => {
    await recordDownload(ed.id);
    const lines: string[] = [
      `# ${ed.titleEn}`,
      `## ${ed.titleBn}`,
      `**Edition Date:** ${ed.editionDate} | **Month:** ${ed.monthLabelEn} (${ed.monthLabelBn})`,
      `**Grounded Sources:** ${ed.sourceUrls.join(", ")}`,
      "",
      `> ${ed.executiveSummaryEn}`,
      `> ${ed.executiveSummaryBn}`,
      "",
      `### Quick Revision Mnemonics`,
      `- **EN:** ${ed.mnemonicsEn}`,
      `- **BN:** ${ed.mnemonicsBn}`,
      "",
      `---`,
      "",
    ];

    ed.topics.forEach((t, idx) => {
      lines.push(`## ${idx + 1}. [${t.category}] ${t.headlineEn}`);
      lines.push(`### ${t.headlineBn}`);
      lines.push(`*Source: ${t.sourceTag}*`);
      lines.push("");
      lines.push(`**Why in News:** ${t.whyInNewsEn}`);
      lines.push(`**সংবাদে কেন:** ${t.whyInNewsBn}`);
      lines.push("");
      lines.push(`#### Exam-Oriented Key Points (English):`);
      t.examPointsEn.forEach((p) => lines.push(`- ${p}`));
      lines.push("");
      lines.push(`#### পরীক্ষার মূল তথ্য (বাংলা):`);
      t.examPointsBn.forEach((p) => lines.push(`- ${p}`));
      lines.push("");
      lines.push(`- **Static GK Hook (EN):** ${t.staticGkLinkEn}`);
      lines.push(`- **স্ট্যাটিক জিকে সংযোগ (BN):** ${t.staticGkLinkBn}`);
      lines.push(`- **Exam Trap Warning:** ${t.examTrapEn} / ${t.examTrapBn}`);
      lines.push("");
      lines.push(`---`);
      lines.push("");
    });

    lines.push(`## PYQ-Grade Practice MCQs (${ed.mcqs.length} Questions)`);
    lines.push("");
    ed.mcqs.forEach((m, idx) => {
      lines.push(`**Q${idx + 1} (${m.category}). ${m.stem.en}**`);
      lines.push(`*${m.stem.bn}*`);
      lines.push(`- (A) ${m.options.A.en} / ${m.options.A.bn}`);
      lines.push(`- (B) ${m.options.B.en} / ${m.options.B.bn}`);
      lines.push(`- (C) ${m.options.C.en} / ${m.options.C.bn}`);
      lines.push(`- (D) ${m.options.D.en} / ${m.options.D.bn}`);
      lines.push(`- **Answer:** (${m.correctOption}) — ${m.explanation.en} (${m.explanation.bn})`);
      lines.push("");
    });

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `WBPSC-CA-${ed.editionDate}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify?.("success", `Downloaded Markdown notes: WBPSC-CA-${ed.editionDate}.md`);
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-sm text-slate-400">
        Loading Autonomous Current Affairs Archive &amp; Monthly Statistics...
      </div>
    );
  }

  const categoryEntries = Object.entries(stats?.categoryCounts || {}).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <div className="space-y-6">
      {/* ====================================================================
          1. TOP HEADER & AUTONOMOUS AGENT LAUNCHER BAR
      ==================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
              <Bot className="w-4 h-4" />
              <span>
                Autonomous Web-Scout &amp; Syllabus-Mapper Agent · Grounded on PYQArena (The
                Hindu), PIB &amp; WB Gazette
              </span>
            </div>
            <h1 className="text-xl font-bold text-white">
              {lang === "bn"
                ? "কারেন্ট অ্যাফেয়ার্স আর্কাইভ এবং অটোনোমাস এজেন্ট ড্যাশবোর্ড"
                : "Current Affairs Intelligence Archive & Autonomous Agent Console"}
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === "bn"
                ? "শুধুমাত্র পরীক্ষার জন্য প্রয়োজনীয় টু-দ্য-পয়েন্ট তথ্য (এক লাইনের অতি-সংক্ষিপ্ত নয়, আবার বিশাল রচনাও নয়)—স্ট্যাটিক জিকে সংযোগ, পরীক্ষার ফাঁদ (Exam Traps) এবং দ্বিভাষিক প্র্যাকটিস MCQ সহ। সকলের জন্য ডাউনলোডযোগ্য।"
                : "Strictly exam-oriented, concise point-wise notes (neither bare one-liners nor bloated essays) paired with Static GK Syllabus Hooks, Exam Trap Warnings, and downloadable bilingual booklets for both Aspirants and Admins."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowAgentPanel((prev) => !prev)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors cursor-pointer shadow-sm"
            >
              <Bot className="w-4 h-4" />
              {showAgentPanel
                ? "Close CA Agent Studio"
                : isAdmin
                  ? "Run Current Affairs Agent (Admin)"
                  : "Synthesize New Edition with CA Agent"}
            </button>
            <button
              type="button"
              onClick={() =>
                handleDownloadPrintableHtmlBooklet(
                  editions,
                  `Complete ${stats?.monthsStoredCount ?? 0}-Month WBPSC Current Affairs Archive`,
                  `WBPSC-Complete-CA-Archive-${new Date().toISOString().slice(0, 10)}`
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5 text-sky-400" />
              Download All ({stats?.monthsStoredCount ?? 0} Months)
            </button>
          </div>
        </div>

        {/* ====================================================================
            2. FOUR PRIMARY STATUS & ARCHIVE STATISTICS CARDS
        ==================================================================== */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            {/* Card 1: Months Stored */}
            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Months Stored in Archive</span>
                <Calendar className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white">
                {stats.monthsStoredCount} Months
              </div>
              <div className="text-[11px] text-slate-400">
                <span>{stats.totalEditionsCount} Curated Editions</span>
                <span aria-hidden="true"> · </span>
                <span className="text-emerald-400 font-mono">
                  {stats.earliestDate?.slice(0, 7)} to {stats.latestDate?.slice(0, 7)}
                </span>
              </div>
            </div>

            {/* Card 2: Concise Topics & Exam Pointers */}
            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Concise Exam Topics &amp; Pointers</span>
                <Layers className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-sky-300">
                {stats.totalTopicsCount} Topics
              </div>
              <div className="text-[11px] text-slate-400">
                <span>{stats.totalExamPointersCount} High-Yield Bullet Pointers</span>
                <span aria-hidden="true"> · </span>
                <span className="text-sky-400">4–5 pts/topic</span>
              </div>
            </div>

            {/* Card 3: Static GK Links & PYQ MCQs */}
            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Static GK Hooks &amp; Practice MCQs</span>
                <BookOpen className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-amber-300">
                {stats.totalMcqsCount} PYQ MCQs
              </div>
              <div className="text-[11px] text-slate-400">
                <span>{stats.totalTopicsCount} Static Syllabus Links</span>
                <span aria-hidden="true"> · </span>
                <span className="text-amber-300">EN + বাংলা</span>
              </div>
            </div>

            {/* Card 4: Grounded Sources & Downloads */}
            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Grounded Sources &amp; Downloads</span>
                <Download className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white">
                {stats.totalDownloadsCount} Downloads
              </div>
              <div className="text-[11px] text-slate-400">
                <span>{stats.uniqueSourcesCount} Verified Portals</span>
                <span aria-hidden="true"> · </span>
                <span className="text-purple-300">PYQArena · The Hindu · PIB</span>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            3. AUTONOMOUS 4-STAGE CURRENT AFFAIRS AGENT STUDIO (COLLAPSIBLE)
        ==================================================================== */}
        {showAgentPanel && (
          <form
            onSubmit={handleRunAgent}
            className="bg-slate-950 border border-emerald-500/40 rounded-xl p-5 space-y-4 mt-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Autonomous 4-Stage Current Affairs Agent Pipeline
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  1. Web-Scout &amp; URL Grounding (PYQArena / The Hindu / PIB) → 2. WBPSC
                  Syllabus Filter → 3. Concise 4-Bullet Synthesizer → 4. Fact-Critic &amp;
                  Bilingual MCQ Generator
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAgentEditionDate("2026-09-02");
                    setAgentSourceUrl(
                      "https://www.pyqarena.com/current-affairs-from-the-hindu-2nd-september-2026/"
                    );
                    setAgentFocusTopics(
                      "The Hindu 2nd September 2026 exam highlights from PYQArena; Delimitation & Census; West Bengal Heritage & GI Tags; RBI Unified Lending Interface"
                    );
                  }}
                  className="px-2.5 py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-700 rounded-md cursor-pointer"
                >
                  Preset: PYQArena (2nd Sept 2026)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAgentEditionDate(new Date().toISOString().slice(0, 10));
                    setAgentSourceUrl("https://www.pyqarena.com/");
                    setAgentFocusTopics(
                      "Today's The Hindu & PIB Exam-Oriented National & West Bengal Current Affairs, Constitutional Updates, RBI & ISRO Milestones"
                    );
                  }}
                  className="px-2.5 py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-sky-300 border border-slate-700 rounded-md cursor-pointer"
                >
                  Preset: Today&apos;s Edition
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Target Edition Date *
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
                  Primary Grounding Source URL (PYQArena / The Hindu / PIB)
                </label>
                <input
                  type="url"
                  value={agentSourceUrl}
                  onChange={(e) => setAgentSourceUrl(e.target.value)}
                  placeholder="https://www.pyqarena.com/current-affairs-from-the-hindu-2nd-september-2026/"
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Exam Focus Areas / Additional Headlines for the Agent
              </label>
              <textarea
                rows={2}
                value={agentFocusTopics}
                onChange={(e) => setAgentFocusTopics(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white"
              />
            </div>

            <div className="flex items-center justify-between gap-4 pt-1">
              <div className="text-[11px] text-slate-400">
                Output is automatically stored in PostgreSQL under its month bucket and made
                downloadable for all Aspirants and Admins.
              </div>
              <button
                type="submit"
                disabled={agentBusy}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer shrink-0"
              >
                {agentBusy ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Agent Scouting &amp; Synthesizing...
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4" />
                    Execute 4-Stage CA Agent &amp; Save to Archive
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ====================================================================
          4. MONTH-WISE ARCHIVE CARDS & CATEGORY FILTER BAR
      ==================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white">
              {lang === "bn"
                ? `সংরক্ষিত মাসের আর্কাইভ (${monthsArchive.length} মাস)`
                : `Stored Monthly Current Affairs Archive (${monthsArchive.length} Months Stored)`}
            </h2>
            <p className="text-xs text-slate-400">
              Select a month to filter editions or download the complete monthly compiled booklet.
            </p>
          </div>
          {selectedMonthKey !== "all" && (
            <button
              type="button"
              onClick={() => setSelectedMonthKey("all")}
              className="text-xs text-emerald-400 hover:underline cursor-pointer"
            >
              Show All Months ({editions.length} Editions)
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {monthsArchive.map((m) => {
            const isSelected = selectedMonthKey === m.monthKey;
            const monthEditions = editions.filter((e) => e.monthKey === m.monthKey);
            return (
              <div
                key={m.monthKey}
                onClick={() => {
                  setSelectedMonthKey(isSelected ? "all" : m.monthKey);
                  if (!isSelected && monthEditions[0]) {
                    setActiveEditionId(monthEditions[0].id);
                  }
                }}
                className={`rounded-xl p-4 border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-emerald-500/10 border-emerald-500/50 shadow-sm"
                    : "bg-slate-950/80 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-sm text-white">
                    {lang === "bn" ? m.monthLabelBn : m.monthLabelEn}
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400">
                    {m.editionsCount} {m.editionsCount === 1 ? "Edition" : "Editions"}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1.5">
                  <span>{m.topicsCount} Topics</span>
                  <span aria-hidden="true"> · </span>
                  <span>{m.mcqsCount} MCQs</span>
                  <span aria-hidden="true"> · </span>
                  <span>{m.downloadsCount} DLs</span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    {isSelected ? "Active Filter" : "Click to view month"}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDownloadPrintableHtmlBooklet(
                        monthEditions,
                        `${m.monthLabelEn} (${m.monthLabelBn}) — Monthly Current Affairs Booklet`,
                        `WBPSC-CA-Monthly-${m.monthKey}`
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 hover:text-sky-200 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    Monthly Booklet
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Category & Search Filter Bar */}
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

          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search topic, Article, GI tag, Viceroy..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
            />
          </div>
        </div>
      </div>

      {/* ====================================================================
          5. MAIN WORKSPACE: LEFT EDITION SELECTOR + RIGHT CONCISE READER / MCQS
      ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sidebar: Editions List */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Published Editions ({filteredEditions.length})
            </h3>
            <span className="text-[11px] text-slate-400">Click to open</span>
          </div>

          <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
            {filteredEditions.map((ed) => {
              const isSelected = activeEdition?.id === ed.id;
              return (
                <div
                  key={ed.id}
                  onClick={() => {
                    setActiveEditionId(ed.id);
                    setSelectedAnswers({});
                    setQuizSubmitted(false);
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-emerald-500/10 border-emerald-500/50"
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
                  <div className="text-sm font-bold text-white mt-1 leading-snug">
                    {lang === "bn" ? ed.titleBn : ed.titleEn}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1.5 flex items-center justify-between">
                    <span>{lang === "bn" ? ed.monthLabelBn : ed.monthLabelEn}</span>
                    <span>{ed.downloadCount} downloads</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Reader: Active Edition Details */}
        <div className="lg:col-span-8 space-y-5">
          {!activeEdition ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-sm text-slate-400">
              No Current Affairs edition matches the current filter.
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              {/* Edition Header & Download Controls */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono font-bold text-emerald-400">
                      Edition: {activeEdition.editionDate}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {lang === "bn"
                        ? activeEdition.monthLabelBn
                        : activeEdition.monthLabelEn}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Synthesized by {activeEdition.createdByName}</span>
                  </div>
                  <h2 className="text-lg font-bold text-white">
                    {lang === "bn" ? activeEdition.titleBn : activeEdition.titleEn}
                  </h2>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {lang === "bn"
                      ? activeEdition.executiveSummaryBn
                      : activeEdition.executiveSummaryEn}
                  </p>
                </div>

                {/* Universal Download & Print Controls */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadPrintableHtmlBooklet(
                        [activeEdition],
                        activeEdition.titleEn,
                        `WBPSC-CA-${activeEdition.editionDate}`
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Booklet (HTML/PDF)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadMarkdown(activeEdition)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                  >
                    <FileDown className="w-3.5 h-3.5 text-sky-400" />
                    .MD Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void recordDownload(activeEdition.id);
                      window.print();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print
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

              {/* Grounded Source Citations Bar */}
              {activeEdition.sourceUrls.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 bg-slate-950/70 border border-slate-800/80 rounded-lg px-3.5 py-2">
                  <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="font-semibold text-slate-300">Grounded Sources:</span>
                  {activeEdition.sourceUrls.map((url, idx) => (
                    <React.Fragment key={url}>
                      {idx > 0 && <span aria-hidden="true">·</span>}
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sky-400 hover:underline truncate max-w-[280px]"
                      >
                        {url.replace(/^https?:\/\/(www\.)?/, "")}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* Quick Revision Mnemonics Callout */}
              {(activeEdition.mnemonicsEn || activeEdition.mnemonicsBn) && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 text-xs text-emerald-200 leading-relaxed">
                  <strong className="text-emerald-300 uppercase tracking-wider block mb-1">
                    {lang === "bn"
                      ? "এক-নজরে পরীক্ষার মেমরি হুক (Quick Revision Hooks):"
                      : "One-Glance Exam Memory Hooks:"}
                  </strong>
                  {lang === "bn"
                    ? activeEdition.mnemonicsBn || activeEdition.mnemonicsEn
                    : activeEdition.mnemonicsEn}
                </div>
              )}

              {/* Mode Switcher: Concise Exam Notes | Practice MCQs | Agent Execution Trace */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-xl w-fit">
                <button
                  type="button"
                  onClick={() => setActiveViewMode("notes")}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    activeViewMode === "notes"
                      ? "bg-emerald-500 text-slate-950"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Concise Exam Pointers ({filteredTopicsInActiveEdition.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveViewMode("mcqs")}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    activeViewMode === "mcqs"
                      ? "bg-emerald-500 text-slate-950"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Practice PYQ MCQs ({activeEdition.mcqs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveViewMode("agent-trace")}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    activeViewMode === "agent-trace"
                      ? "bg-emerald-500 text-slate-950"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Agent Execution Trace ({activeEdition.agentTrace.length} Steps)
                </button>
              </div>

              {/* VIEW 1: CONCISE EXAM-ORIENTED TOPIC CARDS */}
              {activeViewMode === "notes" && (
                <div className="space-y-4">
                  {filteredTopicsInActiveEdition.map((topic, idx) => {
                    const points =
                      lang === "bn" && topic.examPointsBn?.length
                        ? topic.examPointsBn
                        : topic.examPointsEn;
                    return (
                      <article
                        key={topic.id}
                        className="bg-slate-950/90 border border-slate-800 rounded-xl p-5 space-y-3.5"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                            <span className="font-semibold text-sky-400">
                              {String(idx + 1).padStart(2, "0")}. {topic.category}
                            </span>
                            <span>{topic.sourceTag}</span>
                          </div>
                          <h3 className="text-base font-bold text-white leading-snug">
                            {lang === "bn" ? topic.headlineBn : topic.headlineEn}
                          </h3>
                          {lang === "bn" && (
                            <div className="text-xs text-slate-400">{topic.headlineEn}</div>
                          )}
                        </div>

                        {/* Why in News (1–2 crisp sentences) */}
                        <div className="text-xs text-slate-300 bg-slate-900/90 border border-slate-800/80 rounded-lg p-3 leading-relaxed">
                          <strong className="text-slate-100">
                            {lang === "bn" ? "সংবাদে কেন: " : "Why in News: "}
                          </strong>
                          {lang === "bn" ? topic.whyInNewsBn : topic.whyInNewsEn}
                        </div>

                        {/* Concise Exam-Oriented Bullet Points (Strictly 3–5 high-yield bullets) */}
                        <div className="space-y-1.5">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                            {lang === "bn"
                              ? "পরীক্ষা-কেন্দ্রিক মূল তথ্য (To-The-Point Exam Bullets)"
                              : "To-The-Point Exam Facts (WBPSC Prelims & Mains)"}
                          </h4>
                          <ul className="space-y-2 text-xs text-slate-200 leading-relaxed pl-4 list-disc marker:text-emerald-400">
                            {points.map((pt, pIdx) => (
                              <li key={pIdx}>{pt}</li>
                            ))}
                          </ul>
                        </div>

                        {/* Static GK Hook & Exam Trap Row */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-3 text-xs text-sky-100 leading-relaxed">
                            <div className="font-bold text-sky-300 mb-0.5 flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5" />
                              {lang === "bn"
                                ? "স্ট্যাটিক জিকে সিলেবাস সংযোগ"
                                : "Static GK Syllabus Hook"}
                            </div>
                            {lang === "bn" ? topic.staticGkLinkBn : topic.staticGkLinkEn}
                          </div>

                          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-100 leading-relaxed">
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

              {/* VIEW 2: INTERACTIVE PYQ-GRADE PRACTICE MCQS */}
              {activeViewMode === "mcqs" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl p-4">
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
                        className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3"
                      >
                        <div className="text-xs text-emerald-400 font-semibold">
                          Question {idx + 1} · {mcq.category}
                        </div>
                        <p className="text-sm font-semibold text-white leading-relaxed">
                          {lang === "bn" ? mcq.stem.bn : mcq.stem.en}
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
                                className={`text-left px-3.5 py-2.5 rounded-lg border text-xs transition-colors flex items-start gap-2 cursor-pointer ${btnStyle}`}
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

              {/* VIEW 3: 4-STEP AGENT EXECUTION TRACE */}
              {activeViewMode === "agent-trace" && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-400">
                    Below is the autonomous multi-step execution log recorded when the Current
                    Affairs Agent synthesized this edition:
                  </div>
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
          )}
        </div>
      </div>
    </div>
  );
}
