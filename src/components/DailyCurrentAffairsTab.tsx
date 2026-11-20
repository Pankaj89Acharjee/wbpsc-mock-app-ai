import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileDown,
  FileText,
  Filter,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Play,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
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

export interface CaAutoSchedulerStatus {
  enabled: boolean;
  scheduleCronLabel: string;
  targetTopicsPerDay: number;
  lastAutoRunAt: string;
  lastAutoCollectedDate: string;
  pastDaysAutoBackfilled: boolean;
  totalAutoRunsCount: number;
  lastRunStatus?: "idle" | "running" | "success" | "failed";
  lastErrorReason?: string | null;
  lastErrorAt?: string | null;
  lastFailedDate?: string | null;
  missingRecentDates?: string[];
}

export interface CaVectorDocumentDto {
  id: string;
  title: string;
  sourcePublisher: string;
  scopeType: "single_day" | "date_range" | "multi_month" | "yearly" | string;
  scopeLabel: string;
  targetDates: string[];
  targetMonths: string[];
  targetYear: string;
  fileName: string;
  fileFormat: "PDF" | "WORD" | "IMAGE" | "TEXT" | string;
  mimeType: string;
  fileSizeBytes: number;
  extractedSummaryEn: string;
  extractedSummaryBn: string;
  categories: string[];
  chunksCount: number;
  embeddingModel: string;
  embeddingDims: number;
  examTags: string[];
  uploadedByName: string;
  createdAt: string;
}

export interface CaVectorChunkDto {
  id: string;
  documentId: string;
  chunkIndex: number;
  category: string;
  headlineEn: string;
  headlineBn: string;
  contentEn: string;
  contentBn: string;
  keyFacts: string[];
  scopeType: string;
  scopeLabel: string;
  targetMonths: string[];
  targetYear: string;
  sourcePublisher: string;
  similarityScore?: number;
  createdAt?: string;
}

export interface CaVectorStoreStats {
  totalDocumentsCount: number;
  totalChunksIndexed: number;
  uniquePublishersCount: number;
  byFormat: Record<string, number>;
  byScope: Record<string, number>;
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

const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_NAMES_BN = [
  "জানুয়ারি",
  "ফেব্রুয়ারি",
  "মার্চ",
  "এপ্রিল",
  "মে",
  "জুন",
  "জুলাই",
  "আগস্ট",
  "সেপ্টেম্বর",
  "অক্টোবর",
  "নভেম্বর",
  "ডিসেম্বর",
];

const WEEKDAYS_FULL_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

function toBnDigits(val: string | number): string {
  return String(val).replace(/\d/g, (d) => BENGALI_DIGITS[Number(d)] ?? d);
}

/**
 * Formats an ISO date ("2026-09-02") into an unmistakable human-readable string:
 * e.g. "02 September 2026 (Wednesday)" or "০২ সেপ্টেম্বর ২০২৬"
 * so users never confuse YYYY-MM-DD with YYYY-DD-MM.
 */
export function formatReadableDate(isoDate: string | undefined, lang: SupportedLang): string {
  if (!isoDate) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  const year = Number(match[1]);
  const monthIdx = Math.max(0, Math.min(11, Number(match[2]) - 1));
  const day = Number(match[3]);
  const dayPadded = String(day).padStart(2, "0");

  const dObj = new Date(Date.UTC(year, monthIdx, day));
  const weekdayEn = WEEKDAYS_FULL_EN[dObj.getUTCDay()] || "";

  if (lang === "bn") {
    return `${toBnDigits(dayPadded)} ${MONTH_NAMES_BN[monthIdx]} ${toBnDigits(year)}`;
  }
  return `${dayPadded} ${MONTH_NAMES_EN[monthIdx]} ${year} (${weekdayEn.slice(0, 3)})`;
}

export function formatReadableMonth(monthKey: string, lang: SupportedLang): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!match) return monthKey;
  const year = match[1];
  const monthIdx = Math.max(0, Math.min(11, Number(match[2]) - 1));
  if (lang === "bn") {
    return `${MONTH_NAMES_BN[monthIdx]} ${toBnDigits(year)}`;
  }
  return `${MONTH_NAMES_EN[monthIdx]} ${year}`;
}

function getDaysInMonthCount(monthKey: string, todayIso: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return 30;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const totalInMonth = new Date(year, month, 0).getDate();
  if (monthKey === todayIso.slice(0, 7)) {
    const todayDay = Number(todayIso.slice(8, 10)) || totalInMonth;
    return Math.min(totalInMonth, todayDay);
  }
  return totalInMonth;
}

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

export interface DeckCardEntry {
  topic: CaTopicItem;
  pageNumberInDate: number;
  totalPagesInDate: number;
  editionId: string;
  editionDate: string;
  editionTitleEn: string;
  editionTitleBn: string;
  monthKey: string;
  monthLabelEn: string;
  monthLabelBn: string;
}

export default function DailyCurrentAffairsTab({
  user,
  lang,
  onError,
  onNotify,
}: DailyCurrentAffairsTabProps) {
  const isAdmin = user?.role === "admin";

  const getClientTodayIso = (): string => {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const y = parts.find((p) => p.type === "year")?.value;
      const m = parts.find((p) => p.type === "month")?.value;
      const d = parts.find((p) => p.type === "day")?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // Fallback
    }
    return new Date().toISOString().slice(0, 10);
  };

  const [loading, setLoading] = useState<boolean>(true);
  const [todayIso, setTodayIso] = useState<string>(() => getClientTodayIso());
  const [scheduler, setScheduler] = useState<CaAutoSchedulerStatus | null>(null);
  const [stats, setStats] = useState<CaDashboardStats | null>(null);
  const [monthsArchive, setMonthsArchive] = useState<CaMonthArchiveSummary[]>([]);
  const [editions, setEditions] = useState<CaEditionDto[]>([]);

  // Global Category & Search filter
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // =========================================================================
  // FLOATING ANIMATED CARD DECK MODAL STATE (With Built-in Month & Calendar)
  // =========================================================================
  const [floatingModalOpen, setFloatingModalOpen] = useState<boolean>(false);
  const [modalMonthKey, setModalMonthKey] = useState<string>(() =>
    getClientTodayIso().slice(0, 7)
  );
  // "all" means render ALL stored dates in `modalMonthKey` by default;
  // or a specific "YYYY-MM-DD" string when the user clicks a date on the calendar.
  const [modalDateFilter, setModalDateFilter] = useState<string>(() =>
    getClientTodayIso()
  );
  const [modalCategoryFilter, setModalCategoryFilter] = useState<string>("all");
  const [showModalCalendar, setShowModalCalendar] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : false
  );
  const [floatingCardIdx, setFloatingCardIdx] = useState<number>(0);
  const [cardAnimDirection, setCardAnimDirection] = useState<"next" | "prev">("next");

  // =========================================================================
  // AGENT MANAGEMENT CONSOLE & VECTOR STORE MODAL STATE
  // =========================================================================
  const [activeAgentModal, setActiveAgentModal] = useState<
    "daily" | "backfill" | "classifier" | "recovery" | "bilingual" | null
  >(null);
  const [activeVectorModal, setActiveVectorModal] = useState<
    "upload" | "documents" | "search" | null
  >(null);
  const [agentBusy, setAgentBusy] = useState<boolean>(false);
  const [lastAgentErrorShort, setLastAgentErrorShort] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState<boolean>(false);
  const [backfillMonthKey, setBackfillMonthKey] = useState<string>(() =>
    getClientTodayIso().slice(0, 7)
  );
  const [backfillBatchRange, setBackfillBatchRange] = useState<
    "days-1-10" | "days-11-20" | "days-21-end" | "full-month"
  >("full-month");
  const [toggleSchedulerBusy, setToggleSchedulerBusy] = useState<boolean>(false);
  const [classifierBusyMonth, setClassifierBusyMonth] = useState<string | null>(null);
  const [classifierSelectedMonth, setClassifierSelectedMonth] = useState<string>(() =>
    getClientTodayIso().slice(0, 7)
  );
  const [agentEditionDate, setAgentEditionDate] = useState<string>(() =>
    getClientTodayIso()
  );
  const [agentSourceUrl, setAgentSourceUrl] = useState<string>(
    "https://www.gktoday.in/current-affairs/"
  );
  const [agentFocusTopics, setAgentFocusTopics] = useState<string>(
    "Exam-oriented National, International & West Bengal Current Affairs from PIB, The Hindu, GKToday & AffairsCloud (schemes, polity, economy, ISRO, defence, awards, sports, indices, GI tags — no job recruitment or holiday notices)"
  );

  // =========================================================================
  // ADMIN PAGE-WISE DELETE & DATE-CARD UPLOAD STATE (INSIDE FLOATING MODAL)
  // =========================================================================
  const [deleteBusy, setDeleteBusy] = useState<boolean>(false);
  const [pageDeleteBusy, setPageDeleteBusy] = useState<boolean>(false);
  const [showPageDeletePicker, setShowPageDeletePicker] = useState<boolean>(false);
  const [selectedPagesToDelete, setSelectedPagesToDelete] = useState<number[]>([]);

  // Inline Date-Specific Upload CA + Question Drawer inside Floating Card Modal
  const [showModalDateUpload, setShowModalDateUpload] = useState<boolean>(false);
  const [cardUploadBusy, setCardUploadBusy] = useState<boolean>(false);
  const [cardUploadFile, setCardUploadFile] = useState<File | null>(null);
  const [cardUploadCategory, setCardUploadCategory] = useState<string>(
    "West Bengal Special"
  );
  const [cardUploadSourceTag, setCardUploadSourceTag] = useState<string>(
    "Admin Custom Upload"
  );
  const [cardUploadHeadlineEn, setCardUploadHeadlineEn] = useState<string>("");
  const [cardUploadHeadlineBn, setCardUploadHeadlineBn] = useState<string>("");
  const [cardUploadWhyEn, setCardUploadWhyEn] = useState<string>("");
  const [cardUploadPointsText, setCardUploadPointsText] = useState<string>("");
  const [cardUploadStaticGkEn, setCardUploadStaticGkEn] = useState<string>("");
  const [cardUploadMcqStemEn, setCardUploadMcqStemEn] = useState<string>("");
  const [cardUploadMcqStemBn, setCardUploadMcqStemBn] = useState<string>("");
  const [cardUploadOptA, setCardUploadOptA] = useState<string>("");
  const [cardUploadOptB, setCardUploadOptB] = useState<string>("");
  const [cardUploadOptC, setCardUploadOptC] = useState<string>("");
  const [cardUploadOptD, setCardUploadOptD] = useState<string>("");
  const [cardUploadCorrectOpt, setCardUploadCorrectOpt] =
    useState<OptionKey>("A");
  const [cardUploadExplanationEn, setCardUploadExplanationEn] =
    useState<string>("");

  // Vector DB Knowledge Store state (PDF / Word / Image uploads)
  const [vectorStats, setVectorStats] = useState<CaVectorStoreStats | null>(null);
  const [vectorDocs, setVectorDocs] = useState<CaVectorDocumentDto[]>([]);
  const [vectorChunksPreview, setVectorChunksPreview] = useState<CaVectorChunkDto[]>([]);
  const [vectorUploadBusy, setVectorUploadBusy] = useState<boolean>(false);
  const [vectorSearchBusy, setVectorSearchBusy] = useState<boolean>(false);
  const [uploadTitle, setUploadTitle] = useState<string>("");
  const [uploadPublisher, setUploadPublisher] = useState<string>(
    "GKToday / Achievers / PIB Compilation"
  );
  const [uploadScopeType, setUploadScopeType] = useState<
    "single_day" | "date_range" | "multi_month" | "yearly"
  >("multi_month");
  const [uploadSingleDate, setUploadSingleDate] = useState<string>(() =>
    getClientTodayIso()
  );
  const [uploadStartDate, setUploadStartDate] = useState<string>("2026-10-01");
  const [uploadEndDate, setUploadEndDate] = useState<string>(() =>
    getClientTodayIso()
  );
  const [uploadSelectedMonths, setUploadSelectedMonths] = useState<string[]>(() => [
    getClientTodayIso().slice(0, 7),
    "2026-10",
  ]);
  const [uploadTargetYear, setUploadTargetYear] = useState<string>("2025-2026");
  const [uploadExamTags, setUploadExamTags] = useState<string[]>([
    "WBPSC Clerkship (100 Marks)",
    "WBCS Prelims (200 Marks)",
  ]);
  const [uploadTextHint, setUploadTextHint] = useState<string>("");
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);

  // Vector DB Semantic Search state
  const [vectorSearchQuery, setVectorSearchQuery] = useState<string>("");
  const [vectorSearchScopeFilter, setVectorSearchScopeFilter] = useState<string>("all");
  const [vectorSearchCategoryFilter, setVectorSearchCategoryFilter] =
    useState<string>("all");
  const [vectorSearchResults, setVectorSearchResults] = useState<
    CaVectorChunkDto[] | null
  >(null);

  // =========================================================================
  // INTERACTIVE MCQ PRACTICE QUIZ STATE
  // =========================================================================
  const [quizMonthKey, setQuizMonthKey] = useState<string>("all");
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, OptionKey>>({});
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);

  const loadVectorStore = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await api<{
        stats: CaVectorStoreStats;
        documents: CaVectorDocumentDto[];
        recentChunks: CaVectorChunkDto[];
      }>("/current-affairs/vector-store");
      setVectorStats(res.stats);
      setVectorDocs(res.documents || []);
      setVectorChunksPreview(res.recentChunks || []);
    } catch {
      // Non-blocking for non-admin or initial load
    }
  }, [isAdmin]);

  const loadArchive = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await api<{
          todayIso?: string;
          autoCollectingToday?: boolean;
          scheduler?: CaAutoSchedulerStatus;
          stats: CaDashboardStats;
          monthsArchive: CaMonthArchiveSummary[];
          editions: CaEditionDto[];
        }>("/current-affairs");
        const serverToday = res.todayIso || getClientTodayIso();
        const serverMonthKey = serverToday.slice(0, 7);
        setTodayIso(serverToday);
        if (res.scheduler) setScheduler(res.scheduler);
        setStats(res.stats);

        // Strictly filter out any future editions on client side as well
        const validEditions = (res.editions || []).filter(
          (e) => e.editionDate <= serverToday
        );
        const validMonths = (res.monthsArchive || []).filter(
          (m) => m.monthKey <= serverMonthKey
        );

        setEditions(validEditions);
        setMonthsArchive(validMonths);

        if (validMonths.length > 0) {
          setModalMonthKey((prev) =>
            validMonths.some((m) => m.monthKey === prev) ? prev : serverMonthKey
          );
          setClassifierSelectedMonth((prev) =>
            validMonths.some((m) => m.monthKey === prev) ? prev : serverMonthKey
          );
        }
        setAgentEditionDate((prev) => (prev > serverToday ? serverToday : prev));

        // If background Google Search Grounding or initial archive seeding is running,
        // silently re-fetch once it finishes without blocking the UI!
        if (res.autoCollectingToday || validEditions.length === 0) {
          setTimeout(() => {
            void loadArchive(true);
            void loadVectorStore();
          }, validEditions.length === 0 ? 1500 : 10000);
        }
      } catch (err) {
        onError(err, "Failed to load Current Affairs archive.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [onError, loadVectorStore]
  );

  useEffect(() => {
    void loadArchive(false);
    void loadVectorStore();
  }, [loadArchive, loadVectorStore]);

  // Map editionDate -> edition for fast calendar lookup
  const editionsByDate = useMemo(() => {
    const map = new Map<string, CaEditionDto>();
    for (const ed of editions) {
      if (ed.editionDate <= todayIso) {
        map.set(ed.editionDate, ed);
      }
    }
    return map;
  }, [editions, todayIso]);

  // Available months (strictly <= current month, sorted newest first)
  const availableMonthKeys = useMemo(() => {
    const currentMonthKey = todayIso.slice(0, 7);
    const keys = new Set<string>([
      currentMonthKey,
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
      "2025-11",
    ]);
    for (const m of monthsArchive) {
      if (m.monthKey <= currentMonthKey) keys.add(m.monthKey);
    }
    return Array.from(keys)
      .filter((k) => k <= currentMonthKey)
      .sort((a, b) => b.localeCompare(a));
  }, [monthsArchive, todayIso]);

  // Stored dates inside `modalMonthKey`
  const storedEditionsInModalMonth = useMemo(() => {
    return editions
      .filter((e) => e.monthKey === modalMonthKey && e.editionDate <= todayIso)
      .sort((a, b) => b.editionDate.localeCompare(a.editionDate));
  }, [editions, modalMonthKey, todayIso]);

  // Build the flat list of cards for the Floating Animated Card Deck Modal
  // By default (`modalDateFilter === "all"`), it loads ALL stored dates of `modalMonthKey`!
  // If user selects a specific date on the modal calendar, it filters to that specific date.
  const modalDeckCards = useMemo<DeckCardEntry[]>(() => {
    const targetEditions =
      modalDateFilter === "all"
        ? storedEditionsInModalMonth
        : storedEditionsInModalMonth.filter((e) => e.editionDate === modalDateFilter);

    const list: DeckCardEntry[] = [];
    for (const ed of targetEditions) {
      const sameDateSeen = new Set<string>();
      const dedupedForDate: Array<{ topic: CaTopicItem; pageNum: number }> = [];
      for (const t of ed.topics) {
        const normKey = String(t.headlineEn || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (normKey && sameDateSeen.has(normKey)) {
          continue;
        }
        if (normKey) {
          sameDateSeen.add(normKey);
        }
        dedupedForDate.push({
          topic: t,
          pageNum: dedupedForDate.length + 1,
        });
      }

      const totalInDate = dedupedForDate.length;
      for (const item of dedupedForDate) {
        if (
          modalCategoryFilter !== "all" &&
          item.topic.category !== modalCategoryFilter
        ) {
          continue;
        }
        list.push({
          topic: item.topic,
          pageNumberInDate: item.pageNum,
          totalPagesInDate: totalInDate,
          editionId: ed.id,
          editionDate: ed.editionDate,
          editionTitleEn: ed.titleEn,
          editionTitleBn: ed.titleBn,
          monthKey: ed.monthKey,
          monthLabelEn: ed.monthLabelEn,
          monthLabelBn: ed.monthLabelBn,
        });
      }
    }
    return list;
  }, [storedEditionsInModalMonth, modalDateFilter, modalCategoryFilter]);

  const activeModalCard = modalDeckCards[floatingCardIdx] || modalDeckCards[0] || null;

  const goPrevCard = useCallback(() => {
    if (modalDeckCards.length === 0) return;
    setCardAnimDirection("prev");
    setFloatingCardIdx((prev) =>
      prev <= 0 ? modalDeckCards.length - 1 : prev - 1
    );
  }, [modalDeckCards.length]);

  const goNextCard = useCallback(() => {
    if (modalDeckCards.length === 0) return;
    setCardAnimDirection("next");
    setFloatingCardIdx((prev) =>
      prev >= modalDeckCards.length - 1 ? 0 : prev + 1
    );
  }, [modalDeckCards.length]);

  useEffect(() => {
    if (!floatingModalOpen && !activeAgentModal && !activeVectorModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeAgentModal) {
          setActiveAgentModal(null);
          return;
        }
        if (activeVectorModal) {
          setActiveVectorModal(null);
          return;
        }
        setFloatingModalOpen(false);
        return;
      }
      if (!floatingModalOpen) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevCard();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNextCard();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [floatingModalOpen, activeAgentModal, activeVectorModal, goPrevCard, goNextCard]);

  /**
   * Helper to open the Floating Animated Card Modal for a given month (and optional date).
   * By default (`dateFilter = "all"`), it loads the WHOLE month's Current Affairs into the modal!
   * On mobile screens (< 1024px), defaults `showModalCalendar` to false so card content is immediately visible.
   */
  const openFloatingDeckForMonth = (monthKey: string, dateFilter: string = "all") => {
    setModalMonthKey(monthKey);
    setModalDateFilter(dateFilter);
    setModalCategoryFilter("all");
    setFloatingCardIdx(0);
    if (typeof window !== "undefined") {
      setShowModalCalendar(window.innerWidth >= 1024);
    }
    setFloatingModalOpen(true);
  };

  // =========================================================================
  // AGENT ACTIONS
  // =========================================================================

  const handleToggleAutoScheduler = async () => {
    setToggleSchedulerBusy(true);
    try {
      const res = await api<{ scheduler: CaAutoSchedulerStatus }>(
        "/current-affairs/scheduler-toggle",
        {
          method: "POST",
          body: { enabled: !scheduler?.enabled },
        }
      );
      setScheduler(res.scheduler);
      onNotify?.(
        "success",
        res.scheduler.enabled
          ? "Daily Auto-Collection Scheduler is now ON (collects 12 topics automatically every day)."
          : "Daily Auto-Collection Scheduler is paused."
      );
    } catch (err) {
      onError(err, "Failed to update scheduler state.");
    } finally {
      setToggleSchedulerBusy(false);
    }
  };

  const handleAutoBackfillPastDays = async (
    customMonthKey?: string,
    customBatchRange?: "days-1-10" | "days-11-20" | "days-21-end" | "full-month"
  ) => {
    const targetMonth = customMonthKey || backfillMonthKey;
    const targetRange = customBatchRange || backfillBatchRange;
    setBackfillBusy(true);
    try {
      const res = await api<{
        backfilledDates: string[];
        monthKey?: string;
        batchRange?: string;
        todayIso: string;
        scheduler: CaAutoSchedulerStatus;
      }>("/current-affairs/auto-backfill", {
        method: "POST",
        body: {
          monthKey: targetMonth,
          batchRange: targetRange,
        },
      });
      setScheduler(res.scheduler);
      await loadArchive();
      await loadVectorStore();
      openFloatingDeckForMonth(targetMonth, "all");
      onNotify?.(
        "success",
        res.backfilledDates.length > 0
          ? `Google Search Grounded Batch Agent populated & vector-indexed ${res.backfilledDates.length} dates (${res.backfilledDates.join(", ")}) for ${formatReadableMonth(targetMonth, "en")}!`
          : `All dates in ${formatReadableMonth(targetMonth, "en")} (${targetRange}) already have 12/12 topics stored — skipped regeneration!`
      );
    } catch (err) {
      onError(err, "Failed to batch-backfill past days.");
    } finally {
      setBackfillBusy(false);
    }
  };

  const handleRunAgentForDate = async (
    targetDate: string,
    forceRegenerate: boolean = false
  ) => {
    if (targetDate > todayIso) {
      onNotify?.(
        "error",
        `Cannot collect Current Affairs for a future date (${targetDate}). Please pick Today (${todayIso}) or a past date.`
      );
      return;
    }

    const existingEdition = editionsByDate.get(targetDate);
    const existingCount = existingEdition?.topics?.length || 0;
    if (!forceRegenerate && existingCount >= 12) {
      openFloatingDeckForMonth(targetDate.slice(0, 7), targetDate);
      onNotify?.(
        "info",
        `${formatReadableDate(targetDate, "en")} already has ${existingCount}/12 Current Affairs topics stored. Click 'Force Re-Ground' to replace with fresh Google Search topics.`
      );
      return;
    }

    setAgentBusy(true);
    setLastAgentErrorShort(null);
    try {
      const res = await api<{
        editionId: string;
        editionDate: string;
        topicsCount: number;
        mcqsCount: number;
        addedTopicsCount?: number;
        alreadyComplete?: boolean;
        scheduler?: CaAutoSchedulerStatus;
      }>("/current-affairs/agent-run", {
        method: "POST",
        body: {
          editionDate: targetDate,
          sourceUrl: agentSourceUrl,
          focusTopics: agentFocusTopics,
          targetTopicCount: 14,
          forceRegenerate,
        },
      });
      if (res.scheduler) setScheduler(res.scheduler);
      await loadArchive();
      await loadVectorStore();
      openFloatingDeckForMonth(res.editionDate.slice(0, 7), res.editionDate);
      if (res.alreadyComplete) {
        onNotify?.(
          "info",
          `${formatReadableDate(res.editionDate, "en")} already has ${res.topicsCount} Current Affairs topics stored.`
        );
      } else {
        const addedCount = res.addedTopicsCount ?? res.topicsCount;
        onNotify?.(
          "success",
          !forceRegenerate && existingCount > 0
            ? `Google Search Grounded + Vector DB Verified: Added ${addedCount} unique topics (now ${res.topicsCount} topics) for ${formatReadableDate(res.editionDate, "en")}.`
            : `Google Search Grounded + Vector DB Indexed: Collected ${res.topicsCount} unique topics (12–14 target) & ${res.mcqsCount} MCQs for ${formatReadableDate(res.editionDate, "en")}.`
        );
      }
    } catch (err) {
      const shortMsg =
        err instanceof Error ? err.message : "Model call failed during Google Search Grounding.";
      setLastAgentErrorShort(shortMsg.slice(0, 180));
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
        addedTopicsCount?: number;
        alreadyComplete?: boolean;
      }>("/current-affairs/classify-month", {
        method: "POST",
        body: { monthKey },
      });
      await loadArchive();
      openFloatingDeckForMonth(monthKey, "all");
      onNotify?.(
        "success",
        res.alreadyComplete
          ? `${res.monthLabelEn} capsule date already has ${res.topicsCount}/12 classified topics — skipped regeneration.`
          : `Monthly Category Classifier Agent organized ${res.topicsCount}/12 topics across Sports, Awards, Science, Polity, Economy & WB Special for ${res.monthLabelEn}!`
      );
    } catch (err) {
      onError(err, "Monthly Category Classifier Agent failed.");
    } finally {
      setClassifierBusyMonth(null);
    }
  };

  const handleDeleteEdition = async (editionId: string, editionDate: string) => {
    if (!isAdmin) return;
    setDeleteBusy(true);
    try {
      await api(`/current-affairs/${editionId}`, { method: "DELETE" });
      await loadArchive();
      if (modalDateFilter === editionDate) {
        setModalDateFilter("all");
        setFloatingCardIdx(0);
      }
      onNotify?.(
        "info",
        `Deleted Current Affairs edition for ${formatReadableDate(editionDate, "en")}.`
      );
    } catch (err) {
      onError(err, "Failed to delete edition.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleBulkDeleteEditions = async (params: {
    editionDates?: string[];
    monthKey?: string;
    deleteAllInMonth?: boolean;
  }) => {
    if (!isAdmin) return;
    setDeleteBusy(true);
    try {
      const res = await api<{
        deleted: boolean;
        deletedCount: number;
        deletedDates: string[];
      }>("/current-affairs/delete-editions", {
        method: "POST",
        body: params,
      });
      await loadArchive();
      if (
        modalDateFilter !== "all" &&
        res.deletedDates.includes(modalDateFilter)
      ) {
        setModalDateFilter("all");
        setFloatingCardIdx(0);
      }
      onNotify?.(
        "info",
        params.deleteAllInMonth && params.monthKey
          ? `Deleted all ${res.deletedCount} stored Current Affairs day(s) in ${formatReadableMonth(params.monthKey, "en")}.`
          : `Deleted ${res.deletedCount} selected Current Affairs day(s): ${res.deletedDates.join(", ")}.`
      );
    } catch (err) {
      onError(err, "Failed to delete selected Current Affairs editions.");
    } finally {
      setDeleteBusy(false);
    }
  };

  /**
   * Page-Wise / Card-Wise Delete for a Particular Date!
   * Allows Admin to delete a single page (e.g. Page 3 or Page 8 of 31 October 2026)
   * or multiple selected page numbers on that date.
   */
  const handleDeletePagesForDate = async (params: {
    editionDate: string;
    topicId?: string;
    pageNumbers?: number[];
  }) => {
    if (!isAdmin) return;
    setPageDeleteBusy(true);
    try {
      const res = await api<{
        deleted: boolean;
        editionDate: string;
        deletedPageNumbers: number[];
        deletedHeadlines: string[];
        remainingTopicsCount: number;
        editionRemoved: boolean;
      }>("/current-affairs/delete-topic", {
        method: "POST",
        body: params,
      });
      setSelectedPagesToDelete([]);
      setShowPageDeletePicker(false);
      await loadArchive();

      if (res.editionRemoved) {
        if (modalDateFilter === params.editionDate) {
          setModalDateFilter("all");
        }
        setFloatingCardIdx(0);
      } else {
        setFloatingCardIdx((prev) =>
          Math.max(0, Math.min(prev, res.remainingTopicsCount - 1))
        );
      }

      onNotify?.(
        "info",
        `Deleted Page(s) ${res.deletedPageNumbers.map((p) => `#${p}`).join(", ")} from ${formatReadableDate(params.editionDate, "en")}. (${res.remainingTopicsCount} cards remaining on this date)`
      );
    } catch (err) {
      onError(err, "Failed to delete selected page(s) for this date.");
    } finally {
      setPageDeleteBusy(false);
    }
  };

  /**
   * Upload / Add CA Card + Question into DB for a Particular Date (directly inside the Card Modal)
   */
  const handleUploadCaForDateInModal = async (targetDate: string) => {
    if (!isAdmin) return;
    if (
      !cardUploadFile &&
      !cardUploadHeadlineEn.trim() &&
      !cardUploadWhyEn.trim() &&
      !cardUploadPointsText.trim() &&
      !cardUploadMcqStemEn.trim()
    ) {
      onNotify?.(
        "error",
        "Please select a file (PDF / Word / Image) or enter a Headline / Question to upload for this date."
      );
      return;
    }

    setCardUploadBusy(true);
    try {
      let fileBase64 = "";
      if (cardUploadFile) {
        fileBase64 = await readFileAsBase64(cardUploadFile);
      }

      const res = await api<{
        editionDate: string;
        addedTopic: CaTopicItem;
        addedMcq: CaMcqItem;
        newPageNumber: number;
        totalTopicsCount: number;
        totalMcqsCount: number;
      }>("/current-affairs/date-card-upload", {
        method: "POST",
        body: {
          editionDate: targetDate,
          category: cardUploadCategory,
          sourceTag: cardUploadSourceTag,
          headlineEn: cardUploadHeadlineEn,
          headlineBn: cardUploadHeadlineBn,
          whyInNewsEn: cardUploadWhyEn,
          examPointsText: cardUploadPointsText,
          staticGkLinkEn: cardUploadStaticGkEn,
          mcqStemEn: cardUploadMcqStemEn,
          mcqStemBn: cardUploadMcqStemBn,
          optionAEn: cardUploadOptA,
          optionBEn: cardUploadOptB,
          optionCEn: cardUploadOptC,
          optionDEn: cardUploadOptD,
          correctOption: cardUploadCorrectOpt,
          explanationEn: cardUploadExplanationEn,
          fileName: cardUploadFile?.name || "",
          mimeType: cardUploadFile?.type || "",
          fileSizeBytes: cardUploadFile?.size || 0,
          fileBase64,
        },
      });

      // Reset upload form
      setCardUploadFile(null);
      setCardUploadHeadlineEn("");
      setCardUploadHeadlineBn("");
      setCardUploadWhyEn("");
      setCardUploadPointsText("");
      setCardUploadStaticGkEn("");
      setCardUploadMcqStemEn("");
      setCardUploadMcqStemBn("");
      setCardUploadOptA("");
      setCardUploadOptB("");
      setCardUploadOptC("");
      setCardUploadOptD("");
      setCardUploadExplanationEn("");
      setShowModalDateUpload(false);

      await loadArchive();
      await loadVectorStore();

      // Switch modal to the uploaded date and jump to the newly added page!
      setModalMonthKey(targetDate.slice(0, 7));
      setModalDateFilter(targetDate);
      setModalCategoryFilter("all");
      setFloatingCardIdx(Math.max(0, res.newPageNumber - 1));

      onNotify?.(
        "success",
        `Uploaded & added Page #${res.newPageNumber} ("${res.addedTopic.headlineEn.slice(0, 48)}...") + 1 MCQ Question into DB for ${formatReadableDate(targetDate, "en")}!`
      );
    } catch (err) {
      onError(err, "Failed to upload Current Affairs for this date.");
    } finally {
      setCardUploadBusy(false);
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        resolve(result);
      };
      reader.onerror = () => reject(new Error(`Failed to read file ${file.name}`));
      reader.readAsDataURL(file);
    });

  const handleUploadDocumentsToVectorStore = async () => {
    if (!isAdmin) return;
    if (selectedUploadFiles.length === 0 && !uploadTextHint.trim()) {
      onNotify?.(
        "error",
        "Please select at least one PDF, Word (.docx/.doc/.txt), or Image (.png/.jpg/.webp) file (or paste text notes) to index into the Vector DB."
      );
      return;
    }

    setVectorUploadBusy(true);
    try {
      let uploadedDocsCount = 0;
      let totalChunksCreated = 0;

      if (selectedUploadFiles.length > 0) {
        for (const file of selectedUploadFiles) {
          const base64Data = await readFileAsBase64(file);
          const customTitle =
            selectedUploadFiles.length === 1 && uploadTitle.trim()
              ? uploadTitle.trim()
              : uploadTitle.trim()
                ? `${uploadTitle.trim()} — ${file.name}`
                : "";

          const res = await api<{
            documentId: string;
            title: string;
            chunksCount: number;
            fileFormat: string;
            scopeLabel: string;
            embeddingModel?: string;
            embeddingDims?: number;
            chunksPreview?: Array<{
              chunkIndex: number;
              category: string;
              headlineEn: string;
              chars: number;
              factsCount: number;
              dims: number;
            }>;
          }>("/current-affairs/vector-store/upload", {
            method: "POST",
            body: {
              title: customTitle,
              sourcePublisher: uploadPublisher,
              scopeType: uploadScopeType,
              singleDate: uploadSingleDate,
              startDate: uploadStartDate,
              endDate: uploadEndDate,
              selectedMonths: uploadSelectedMonths,
              targetYear: uploadTargetYear,
              examTags: uploadExamTags,
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              fileSizeBytes: file.size,
              fileBase64: base64Data,
              extractedTextHint: uploadTextHint,
            },
          });
          console.groupCollapsed(
            `[VectorDB:STORE] ${res.title} (${res.chunksCount} chunks · ${res.embeddingModel || "gemini-embedding-2"} · ${res.embeddingDims || 128}d)`
          );
          if (res.chunksPreview?.length) console.table(res.chunksPreview);
          console.groupEnd();
          uploadedDocsCount += 1;
          totalChunksCreated += res.chunksCount;
        }
      } else {
        const res = await api<{
          documentId: string;
          title: string;
          chunksCount: number;
          fileFormat: string;
          scopeLabel: string;
          embeddingModel?: string;
          embeddingDims?: number;
          chunksPreview?: Array<{
            chunkIndex: number;
            category: string;
            headlineEn: string;
            chars: number;
            factsCount: number;
            dims: number;
          }>;
        }>("/current-affairs/vector-store/upload", {
          method: "POST",
          body: {
            title: uploadTitle.trim() || `${uploadPublisher} Notes`,
            sourcePublisher: uploadPublisher,
            scopeType: uploadScopeType,
            singleDate: uploadSingleDate,
            startDate: uploadStartDate,
            endDate: uploadEndDate,
            selectedMonths: uploadSelectedMonths,
            targetYear: uploadTargetYear,
            examTags: uploadExamTags,
            fileName: "Admin_Current_Affairs_Notes.txt",
            mimeType: "text/plain",
            fileSizeBytes: uploadTextHint.length,
            extractedTextHint: uploadTextHint,
          },
        });
        console.groupCollapsed(
          `[VectorDB:STORE] ${res.title} (${res.chunksCount} chunks · ${res.embeddingModel || "gemini-embedding-2"} · ${res.embeddingDims || 128}d)`
        );
        if (res.chunksPreview?.length) console.table(res.chunksPreview);
        console.groupEnd();
        uploadedDocsCount = 1;
        totalChunksCreated = res.chunksCount;
      }

      setSelectedUploadFiles([]);
      setUploadTitle("");
      setUploadTextHint("");
      await loadVectorStore();
      onNotify?.(
        "success",
        `Indexed ${uploadedDocsCount} resource(s) (${totalChunksCreated} bilingual vector chunks) into Vector DB!`
      );
    } catch (err) {
      onError(err, "Failed to upload & index Current Affairs document into Vector DB.");
    } finally {
      setVectorUploadBusy(false);
    }
  };

  const handleSearchVectorStore = async () => {
    if (!isAdmin) return;
    setVectorSearchBusy(true);
    try {
      const res = await api<{
        query: string;
        embeddingModel?: string;
        scannedChunksCount?: number;
        results: Array<
          CaVectorChunkDto & {
            debugScores?: { rawCosine: number; kwBoost: number; finalScore: number };
          }
        >;
      }>("/current-affairs/vector-store/search", {
        method: "POST",
        body: {
          query: vectorSearchQuery,
          scopeType: vectorSearchScopeFilter,
          category: vectorSearchCategoryFilter,
          topK: 10,
        },
      });
      const rows = res.results || [];
      console.groupCollapsed(
        `[VectorDB:SEARCH] "${res.query}" | model=${res.embeddingModel || "gemini-embedding-2"} | scanned=${res.scannedChunksCount ?? rows.length} | topK=${rows.length}`
      );
      console.table(
        rows.map((r, idx) => ({
          rank: idx + 1,
          category: r.category,
          headline: r.headlineEn.slice(0, 60),
          rawCosine: r.debugScores?.rawCosine ?? r.similarityScore,
          kwBoost: r.debugScores?.kwBoost ?? 0,
          finalScore: r.similarityScore,
          scope: r.scopeLabel,
        }))
      );
      console.groupEnd();
      setVectorSearchResults(rows);
    } catch (err) {
      onError(err, "Vector DB semantic search failed.");
    } finally {
      setVectorSearchBusy(false);
    }
  };

  const handleDeleteVectorDocument = async (docId: string, docTitle: string) => {
    if (!isAdmin) return;
    try {
      await api(`/current-affairs/vector-store/${docId}`, { method: "DELETE" });
      await loadVectorStore();
      if (vectorSearchResults) {
        setVectorSearchResults((prev) =>
          prev ? prev.filter((c) => c.documentId !== docId) : null
        );
      }
      onNotify?.("info", `Removed "${docTitle}" and its vector chunks from Vector DB.`);
    } catch (err) {
      onError(err, "Failed to delete document from Vector DB.");
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
   * Generates a Book-Style Paginated Printable PDF / HTML Capsule:
   * - Dynamically uses the exact selected Month / Archive title (never hardcodes "Dec 2026").
   * - Renders a vertical Book Index (Table of Contents) with dotted leaders and exact Page Numbers.
   * - Paginates topics (2 rich bilingual topics per A4 sheet) and MCQs (5 per sheet) with running page numbers.
   */
  const handleDownloadCategorizedCapsulePdf = async (
    targetEditions: CaEditionDto[],
    bookletTitle: string,
    filenameSlug: string
  ) => {
    if (targetEditions.length === 0) return;
    await recordDownload(targetEditions[0].id);

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

    // Step 1: Build paginated content sheets (2 rich bilingual topics per A4 page)
    // and track exact relative page offsets for every Section and Topic!
    const TOPICS_PER_PAGE = 2;
    const MCQS_PER_PAGE = 5;

    interface ContentSheet {
      sectionTitle: string;
      innerHtml: string;
    }

    interface TocLineItem {
      kind: "section" | "topic" | "mcq";
      code: string;
      label: string;
      subMeta?: string;
      relativePageIdx: number;
    }

    const contentSheets: ContentSheet[] = [];
    const tocLines: TocLineItem[] = [];
    let globalTopicCounter = 0;

    sortedCategories.forEach((cat, catIdx) => {
      const items = byCategory[cat] || [];
      const sectionStartRelIdx = contentSheets.length;

      tocLines.push({
        kind: "section",
        code: `Section ${catIdx + 1}`,
        label: `${cat}`,
        subMeta: `${items.length} ${items.length === 1 ? "Topic" : "Topics"}`,
        relativePageIdx: sectionStartRelIdx,
      });

      for (let i = 0; i < items.length; i += TOPICS_PER_PAGE) {
        const pageSlice = items.slice(i, i + TOPICS_PER_PAGE);
        const relPageIdx = contentSheets.length;

        const cardsHtml = pageSlice
          .map(({ topic: t, editionDate }, localIdx) => {
            const numInCat = i + localIdx + 1;
            globalTopicCounter += 1;

            tocLines.push({
              kind: "topic",
              code: `${catIdx + 1}.${numInCat}`,
              label: t.headlineEn,
              subMeta: formatReadableDate(editionDate, "en").replace(/\s*\(.*\)$/, ""),
              relativePageIdx: relPageIdx,
            });

            return `
            <div class="topic-card">
              <div class="topic-meta">${cat} · Date: ${formatReadableDate(editionDate, "en")} (${editionDate}) · Source: ${t.sourceTag}</div>
              <h3>${catIdx + 1}.${numInCat} ${t.headlineEn}</h3>
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
            </div>`;
          })
          .join("\n");

        const bannerHtml =
          i === 0
            ? `<div class="category-banner">
                 <h2>Section ${catIdx + 1}: ${cat} (${items.length} Exam Topics)</h2>
               </div>`
            : `<div class="category-cont-banner">Section ${catIdx + 1}: ${cat} (Continued)</div>`;

        contentSheets.push({
          sectionTitle: `Section ${catIdx + 1}: ${cat}`,
          innerHtml: `${bannerHtml}\n${cardsHtml}`,
        });
      }
    });

    if (allMcqs.length > 0) {
      const mcqStartRelIdx = contentSheets.length;
      tocLines.push({
        kind: "mcq",
        code: "Appendix",
        label: `PYQ-Pattern Practice MCQs (${allMcqs.length} Questions with Answer Key)`,
        relativePageIdx: mcqStartRelIdx,
      });

      for (let i = 0; i < allMcqs.length; i += MCQS_PER_PAGE) {
        const mcqSlice = allMcqs.slice(i, i + MCQS_PER_PAGE);
        const mcqsHtml = mcqSlice
          .map(
            ({ mcq: m, editionDate }, localIdx) => `
            <div class="mcq-card">
              <p><strong>Q${i + localIdx + 1} [${m.category} · ${formatReadableDate(editionDate, "en")}]:</strong> ${m.stem.en}<br/><span class="bn-text">${m.stem.bn}</span></p>
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

        const mcqHeaderHtml =
          i === 0
            ? `<div class="category-banner"><h2>Practice Appendix: PYQ-Pattern MCQs (${allMcqs.length} Questions)</h2></div>`
            : `<div class="category-cont-banner">Practice Appendix: PYQ-Pattern MCQs (Continued)</div>`;

        contentSheets.push({
          sectionTitle: "Practice MCQs",
          innerHtml: `${mcqHeaderHtml}\n${mcqsHtml}`,
        });
      }
    }

    // Step 2: Paginate the Vertical Book Index pages so every page number matches 1-to-1!
    const FIRST_TOC_CAPACITY = 24;
    const NEXT_TOC_CAPACITY = 34;
    const tocChunks: TocLineItem[][] = [];
    if (tocLines.length <= FIRST_TOC_CAPACITY) {
      tocChunks.push(tocLines);
    } else {
      tocChunks.push(tocLines.slice(0, FIRST_TOC_CAPACITY));
      for (let k = FIRST_TOC_CAPACITY; k < tocLines.length; k += NEXT_TOC_CAPACITY) {
        tocChunks.push(tocLines.slice(k, k + NEXT_TOC_CAPACITY));
      }
    }

    const indexPagesCount = Math.max(1, tocChunks.length);
    const totalBookPages = indexPagesCount + contentSheets.length;

    const renderTocLineHtml = (item: TocLineItem): string => {
      const targetPageNum = indexPagesCount + 1 + item.relativePageIdx;
      if (item.kind === "section" || item.kind === "mcq") {
        return `
          <a href="#book-page-${targetPageNum}" class="toc-row toc-section-row">
            <span class="toc-left">
              <span class="toc-chapter-badge">${item.code}</span>
              <span class="toc-section-title">${item.label}</span>
              ${item.subMeta ? `<span class="toc-count">(${item.subMeta})</span>` : ""}
            </span>
            <span class="toc-dots"></span>
            <span class="toc-page-num">Page ${targetPageNum}</span>
          </a>`;
      }
      return `
        <a href="#book-page-${targetPageNum}" class="toc-row toc-topic-row">
          <span class="toc-left">
            <span class="toc-topic-code">${item.code}</span>
            <span class="toc-topic-title">${item.label}</span>
            ${item.subMeta ? `<span class="toc-date-pill">${item.subMeta}</span>` : ""}
          </span>
          <span class="toc-dots"></span>
          <span class="toc-page-num">${targetPageNum}</span>
        </a>`;
    };

    const indexSheetsHtml = tocChunks
      .map((chunk, chunkIdx) => {
        const pageNum = chunkIdx + 1;
        const headerBlock =
          chunkIdx === 0
            ? `
            <div class="doc-header">
              <div>
                <div class="doc-kicker">WBPSC Prelims, Mains &amp; Clerkship Exam Edition</div>
                <h1>${bookletTitle}</h1>
                <div class="doc-subtitle">${globalTopicCounter} Exam-Oriented Topics · ${sortedCategories.length} Subject Sections · ${allMcqs.length} Practice MCQs · Grounded on PIB, The Hindu &amp; GKToday</div>
              </div>
              <div class="bilingual-pill">Bilingual (EN + বাংলা)</div>
            </div>
            <div class="toc-heading-bar">
              <h2>INDEX / TABLE OF CONTENTS</h2>
              <span>Page No.</span>
            </div>`
            : `
            <div class="page-running-header">
              <span>${bookletTitle}</span>
              <span>INDEX (Continued)</span>
            </div>
            <div class="toc-heading-bar">
              <h2>INDEX / TABLE OF CONTENTS (Continued)</h2>
              <span>Page No.</span>
            </div>`;

        return `
        <section id="book-page-${pageNum}" class="book-page">
          <div class="book-page-body">
            ${headerBlock}
            <div class="toc-vertical-list">
              ${chunk.map(renderTocLineHtml).join("\n")}
            </div>
          </div>
          <footer class="book-page-footer">
            <span>${bookletTitle}</span>
            <strong>Page ${pageNum} of ${totalBookPages}</strong>
          </footer>
        </section>`;
      })
      .join("\n");

    const contentSheetsHtml = contentSheets
      .map((sheet, idx) => {
        const pageNum = indexPagesCount + 1 + idx;
        return `
        <section id="book-page-${pageNum}" class="book-page">
          <div class="book-page-body">
            <div class="page-running-header">
              <span>${bookletTitle}</span>
              <span>${sheet.sectionTitle}</span>
            </div>
            ${sheet.innerHtml}
          </div>
          <footer class="book-page-footer">
            <span>WBPSC Current Affairs Capsule · Bilingual Edition</span>
            <strong>Page ${pageNum} of ${totalBookPages}</strong>
          </footer>
        </section>`;
      })
      .join("\n");

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${bookletTitle}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Inter', 'Noto Sans Bengali', sans-serif; color: #0f172a; background: #f1f5f9; margin: 0; padding: 20px 12px; line-height: 1.5; }
    .book-page { background: #ffffff; max-width: 920px; min-height: 1120px; margin: 0 auto 24px; padding: 32px 36px 24px; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06); display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }
    .book-page:last-child { page-break-after: auto; }
    .book-page-body { flex: 1; }
    .doc-header { border-bottom: 3px solid #0f172a; padding-bottom: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
    .doc-kicker { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #0284c7; margin-bottom: 4px; }
    .doc-header h1 { margin: 0; font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1.25; }
    .doc-subtitle { font-size: 12px; color: #475569; margin-top: 5px; }
    .bilingual-pill { font-size: 11.5px; font-weight: 700; color: #065f46; background: #d1fae5; border: 1px solid #6ee7b7; padding: 5px 10px; border-radius: 6px; white-space: nowrap; }
    .page-running-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
    .toc-heading-bar { display: flex; justify-content: space-between; align-items: center; background: #0f172a; color: #f8fafc; padding: 9px 14px; border-radius: 6px; margin-bottom: 10px; }
    .toc-heading-bar h2 { margin: 0; font-size: 13.5px; letter-spacing: 0.06em; text-transform: uppercase; }
    .toc-heading-bar span { font-size: 11.5px; font-weight: 700; color: #34d399; text-transform: uppercase; }
    .toc-vertical-list { display: flex; flex-direction: column; gap: 2px; }
    .toc-row { display: flex; align-items: baseline; text-decoration: none; color: inherit; padding: 4px 4px; border-radius: 4px; }
    .toc-row:hover { background: #f8fafc; }
    .toc-section-row { margin-top: 8px; padding-top: 6px; font-weight: 700; color: #0f172a; background: #f8fafc; padding-left: 8px; padding-right: 8px; border-left: 3px solid #10b981; }
    .toc-topic-row { padding-left: 22px; padding-right: 8px; font-size: 12px; color: #334155; }
    .toc-left { display: inline-flex; align-items: baseline; gap: 8px; max-width: 82%; }
    .toc-chapter-badge { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #047857; white-space: nowrap; }
    .toc-section-title { font-size: 13px; font-weight: 700; color: #0f172a; }
    .toc-count { font-size: 11px; font-weight: 600; color: #64748b; }
    .toc-topic-code { font-family: monospace; font-size: 11.5px; font-weight: 700; color: #0284c7; min-width: 30px; }
    .toc-topic-title { font-weight: 500; color: #1e293b; }
    .toc-date-pill { font-size: 10.5px; color: #64748b; white-space: nowrap; }
    .toc-dots { flex: 1; border-bottom: 1px dotted #94a3b8; margin: 0 10px; min-width: 24px; }
    .toc-page-num { font-family: monospace; font-size: 12px; font-weight: 700; color: #0f172a; white-space: nowrap; }
    .category-banner { background: #0f172a; color: #f8fafc; border-left: 5px solid #10b981; padding: 9px 14px; border-radius: 6px; margin: 4px 0 12px; }
    .category-banner h2 { margin: 0; font-size: 15px; text-transform: uppercase; letter-spacing: 0.04em; }
    .category-cont-banner { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #0f172a; background: #f1f5f9; border-left: 4px solid #0284c7; padding: 6px 12px; border-radius: 4px; margin-bottom: 10px; }
    .bn-title { font-family: 'Noto Sans Bengali', sans-serif; color: #334155; font-size: 13.5px; font-weight: 600; }
    .bn-text { font-family: 'Noto Sans Bengali', sans-serif; color: #334155; }
    .topic-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; page-break-inside: avoid; }
    .topic-meta { font-size: 10.5px; font-weight: 700; color: #0369a1; text-transform: uppercase; }
    .topic-card h3 { margin: 4px 0 2px; font-size: 15px; color: #0f172a; }
    .why-news { font-size: 12.5px; margin: 6px 0; color: #1e293b; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 8px; }
    .col h4 { margin: 0 0 5px; font-size: 11px; text-transform: uppercase; color: #475569; }
    .col ul { margin: 0; padding-left: 16px; font-size: 12px; }
    .col li { margin-bottom: 4px; }
    .gk-box { margin-top: 8px; background: #f0f9ff; border-left: 3px solid #0284c7; padding: 7px 10px; font-size: 12px; }
    .trap-box { margin-top: 6px; background: #fffbeb; border-left: 3px solid #d97706; padding: 6px 10px; font-size: 11.5px; color: #92400e; }
    .mcq-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 9px 12px; margin-bottom: 9px; font-size: 12px; page-break-inside: avoid; }
    .mcq-card p { margin: 4px 0; }
    .options { color: #334155; }
    .ans { color: #065f46; background: #ecfdf5; padding: 5px 9px; border-radius: 4px; }
    .book-page-footer { border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 14px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #475569; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .book-page { box-shadow: none; border: none; margin: 0; max-width: 100%; min-height: 0; padding: 4mm 2mm; }
    }
  </style>
</head>
<body>
  ${indexSheetsHtml}
  ${contentSheetsHtml}
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
      `Downloaded "${bookletTitle}" with Book Index & Page Numbers (Open & press Ctrl+P to save as PDF).`
    );
  };

  const modalCalendarCells = useMemo(
    () => buildCalendarDays(modalMonthKey),
    [modalMonthKey]
  );

  const stepModalMonth = (delta: number) => {
    const idx = availableMonthKeys.indexOf(modalMonthKey);
    if (idx === -1) return;
    const nextIdx = Math.max(0, Math.min(availableMonthKeys.length - 1, idx + delta));
    setModalMonthKey(availableMonthKeys[nextIdx]);
    setModalDateFilter("all");
    setFloatingCardIdx(0);
  };

  // Filtered MCQs for the clean practice quiz section
  const quizMcqs = useMemo(() => {
    const targetEds =
      quizMonthKey === "all"
        ? editions.slice(0, 3)
        : editions.filter((e) => e.monthKey === quizMonthKey);
    const list: Array<{ mcq: CaMcqItem; editionDate: string }> = [];
    for (const ed of targetEds) {
      for (const m of ed.mcqs) {
        list.push({ mcq: m, editionDate: ed.editionDate });
      }
    }
    return list;
  }, [editions, quizMonthKey]);

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-sm text-slate-400">
        Loading Current &amp; Previous 1-Year Current Affairs Archive (Nov 2025 – Nov 2026) &amp;
        Autonomous Agents...
      </div>
    );
  }

  const categoryEntries = Object.entries(stats?.categoryCounts || {}).sort(
    (a, b) => b[1] - a[1]
  );

  const todayEdition = editionsByDate.get(todayIso) || editions[0] || null;

  return (
    <div className="space-y-6">
      {/* ====================================================================
          SECTION 1: TOP OVERVIEW BANNER + TODAY'S CURRENT AFFAIRS QUICK LAUNCH
      ==================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {isAdmin ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold">
                  <Bot className="w-3.5 h-3.5" />
                  {scheduler?.enabled ? "Daily Auto-Collector: ACTIVE" : "Daily Auto-Collector: PAUSED"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold">
                  <BookOpen className="w-3.5 h-3.5" />
                  WBPSC Exam-Ready Current Affairs Capsule
                </span>
              )}
              <span className="text-slate-400 font-mono">                
                <strong className="text-white">{formatReadableDate(todayIso, lang)}</strong>
                {todayEdition ? (
                  <span className="ml-2 text-emerald-400 font-semibold">
                    ({todayEdition.topics.length} Topics Stored Today)
                  </span>
                ) : null}
              </span>
            </div>

            <h1 className="text-xl font-bold text-white">
              {lang === "bn"
                ? "কারেন্ট অ্যাফেয়ার্স (December ২০২৫ – December ২০২৬)"
                : "Daily & Last 1-Year Current Affairs (Dec 2025 – Dec 2026)"}
            </h1>      
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Button 1: Open Today's / Current Month's Floating Animated Card Deck */}
            <button
              type="button"
              onClick={() =>
                openFloatingDeckForMonth(
                  todayIso.slice(0, 7),
                  editionsByDate.has(todayIso) ? todayIso : "all"
                )
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl transition-colors cursor-pointer shadow-md"
            >
              <Maximize2 className="w-4 h-4" />
              View Today&apos;s ({todayIso}) Current Affairs 
            </button>

            {/* Button 2: Download Full 1-Year Categorized Clerkship Mega-Capsule PDF */}
            <button
              type="button"
              onClick={() =>
                void handleDownloadCategorizedCapsulePdf(
                  editions,
                  `WBPSC Clerkship Categorized Mega-Capsule (${monthsArchive.length} Months: Nov 2025 – Nov 2026)`,
                  `WBPSC-Clerkship-Categorized-CA-Nov2025-Nov2026`
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl transition-colors cursor-pointer shadow-sm"
            >
              <FileDown className="w-4 h-4" />
              Download Last 1-Year PDF ({monthsArchive.length} Months)
            </button>
          </div>
        </div>

        {/* 4 Summary Metrics Cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Total Months Available</span>
                <CalendarIcon className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {monthsArchive.length} Months
              </div>
              <div className="text-[11px] text-slate-400">
                <span className="text-emerald-400 font-semibold">
                  Nov 2025 → Nov 2026
                </span>
                <span aria-hidden="true"> · </span>
                <span>{stats.totalEditionsCount} Stored Dates</span>
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Exam Topics</span>
                <Layers className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-xl font-bold font-mono text-sky-300">
                {stats.totalTopicsCount} 
              </div>
              <div className="text-[11px] text-slate-400">
                <span className="text-sky-400">{stats.totalExamPointersCount} Bullet Pointers</span>                             
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{isAdmin ? "Current Affairs Collection" : "CA Practice MCQs"}</span>
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-xl font-bold font-mono text-amber-300">
                {isAdmin ? "15 Topics / Day" : `${stats.totalMcqsCount} Practice MCQs`}
              </div>
              <div className="text-[11px] text-slate-400">
                <span>Latest Collection on: </span>
                <span className="text-emerald-300 font-semibold">
                  {formatReadableDate(stats.latestDate || todayIso, "en")}
                </span>
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Sources &amp; Downloads</span>
                <Download className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {stats.totalDownloadsCount} PDF Downloads
              </div>
              <div className="text-[11px] text-purple-300">
                International · National · West Bengal
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ====================================================================
          SECTION 2: CURRENT & PREVIOUS 1-YEAR CURRENT AFFAIRS BY MONTH (Nov 2025 – Nov 2026)
          Clicking ANY Month Card opens the Floating Animated Modal with the
          WHOLE MONTH's Current Affairs loaded by default + in-modal Date Picker!
      ==================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-emerald-400" />
              {lang === "bn"
                ? `মাসিক কারেন্ট অ্যাফেয়ার্স (${monthsArchive.length} মাস: নভেম্বর ২০২৫ – নভেম্বর ২০২৬)`
                : `Monthly Current Affairs (${monthsArchive.length} Months: Nov 2025 – Nov 2026)`}
            </h2>            
          </div>
        </div>

        {/* 12-Month Grid (Fixed Max Height with Vertical Scrollbar for responsiveness) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 max-h-[360px] overflow-y-auto pr-1">
          {monthsArchive.map((m) => {
            const monthEditions = editions.filter((e) => e.monthKey === m.monthKey);
            const totalDaysPossible = getDaysInMonthCount(m.monthKey, todayIso);
            const storedDaysCount = monthEditions.length;
            const coveragePct = Math.min(
              100,
              Math.round((storedDaysCount / Math.max(1, totalDaysPossible)) * 100)
            );
            const isFullMonthStored = storedDaysCount >= totalDaysPossible;

            return (
              <div
                key={m.monthKey}
                onClick={() => openFloatingDeckForMonth(m.monthKey, "all")}
                className="rounded-xl p-4 border bg-slate-950/90 border-slate-800 hover:border-amber-400/60 hover:bg-slate-950 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-white group-hover:text-amber-300 transition-colors">
                      {lang === "bn" ? m.monthLabelBn : m.monthLabelEn}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      {m.topicsCount} Topics
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-slate-200">
                      {storedDaysCount} / {totalDaysPossible} Days Available
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{m.mcqsCount} MCQs</span>
                    <span aria-hidden="true">·</span>
                    <span>{m.downloadsCount} DLs</span>
                  </div>

                  {/* Clean Monthly Daily Coverage Progress Bar */}
                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span
                        className={
                          isFullMonthStored
                            ? "text-emerald-300 font-bold"
                            : "text-sky-300 font-semibold"
                        }
                      >
                        {isFullMonthStored
                          ? `✓ All ${totalDaysPossible} Days Stored (100%)`
                          : `📅 ${storedDaysCount} of ${totalDaysPossible} Days (${coveragePct}%)`}
                      </span>

                      {isAdmin && !isFullMonthStored ? (
                        <button
                          type="button"
                          disabled={backfillBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            setBackfillMonthKey(m.monthKey);
                            setBackfillBatchRange("full-month");
                            void handleAutoBackfillPastDays(m.monthKey, "full-month");
                          }}
                          className="px-1.5 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-bold cursor-pointer"
                          title={`Batch-fill unpopulated days of ${m.monthLabelEn}`}
                        >
                          + Batch Fill {totalDaysPossible}d
                        </button>
                      ) : (
                        <span className="text-slate-400 font-mono">
                          {isFullMonthStored ? `1st–${totalDaysPossible}st` : `${storedDaysCount}d ready`}
                        </span>
                      )}
                    </div>

                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isFullMonthStored ? "bg-emerald-400" : "bg-sky-400"
                        }`}
                        style={{ width: `${Math.max(10, coveragePct)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-800/90 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 group-hover:underline">
                    <Maximize2 className="w-3 h-3" />
                    Open Calendar &amp; Cards
                  </span>

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
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-sky-500/15 hover:bg-sky-500/25 text-[10px] font-semibold text-sky-300 border border-sky-500/30 cursor-pointer"
                    title="Download Categorized Monthly Capsule PDF"
                  >
                    <Download className="w-3 h-3" />
                    Download PDF
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ====================================================================
          SECTION 3: CURRENT AFFAIRS MANAGEMENT CONSOLE (ADMIN ONLY)
          Enlarged Responsive Agent Cards — Clicking any card opens its Management Modal.
      ==================================================================== */}
      {isAdmin && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                <Sparkles className="w-4 h-4" />
                Current Affairs Management Console
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Manage Agents
              </h2>
              <p className="text-xs text-slate-400">
                Select any card below to manage agents.
              </p>
            </div>

            {(scheduler?.lastErrorReason || lastAgentErrorShort) && (
              <button
                type="button"
                onClick={() => setActiveAgentModal("daily")}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/50 text-xs font-semibold text-rose-200 cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Agent Alert — Click to View &amp; Retry</span>
              </button>
            )}
          </div>

          {/* Enlarged Responsive 5-Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {/* Agent Card 1: Daily Collector */}
            {(() => {
              const todayCount = editionsByDate.get(todayIso)?.topics.length || 0;
              const hasAlert = Boolean(scheduler?.lastErrorReason || lastAgentErrorShort);
              return (
                <button
                  type="button"
                  onClick={() => setActiveAgentModal("daily")}
                  className="text-left rounded-xl p-5 bg-slate-950/95 border border-emerald-500/35 hover:border-emerald-400 hover:bg-slate-950 transition-all cursor-pointer group flex flex-col justify-between min-h-[185px] shadow-sm"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="p-2 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <Clock className="w-4 h-4" />
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                          hasAlert
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                            : scheduler?.enabled
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        }`}
                      >
                        {hasAlert
                          ? "Needs Retry"
                          : scheduler?.enabled
                            ? "Auto: ON"
                            : "Paused"}
                      </span>
                    </div>
                    <div className="text-sm sm:text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                      Agent 1: Daily Collector
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Auto-collects 12–14 exam-grade topics daily for Today ({todayIso}) and recent missed days.
                    </p>
                  </div>

                  <div className="pt-3 mt-3 border-t border-slate-800/90 flex items-center justify-between text-xs">
                    <span className="font-mono text-[11px] text-slate-300">
                      Today: {todayCount} Topics
                    </span>
                    <span className="font-bold text-emerald-400 group-hover:translate-x-0.5 transition-transform">
                      Manage →
                    </span>
                  </div>
                </button>
              );
            })()}

            {/* Agent Card 2: Batch Backfiller */}
            <button
              type="button"
              onClick={() => setActiveAgentModal("backfill")}
              className="text-left rounded-xl p-5 bg-slate-950/95 border border-sky-500/35 hover:border-sky-400 hover:bg-slate-950 transition-all cursor-pointer group flex flex-col justify-between min-h-[185px] shadow-sm"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="p-2 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    <CalendarIcon className="w-4 h-4" />
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    10-Day / Month
                  </span>
                </div>
                <div className="text-sm sm:text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                  Agent 2: Batch Backfiller
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Populates uncollected dates in 10-day batches or across a full month with zero duplicates.
                </p>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-800/90 flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] text-slate-300">
                  {formatReadableMonth(backfillMonthKey, "en")}
                </span>
                <span className="font-bold text-sky-400 group-hover:translate-x-0.5 transition-transform">
                  Manage →
                </span>
              </div>
            </button>

            {/* Agent Card 3: Month Classifier */}
            <button
              type="button"
              onClick={() => setActiveAgentModal("classifier")}
              className="text-left rounded-xl p-5 bg-slate-950/95 border border-amber-500/35 hover:border-amber-400 hover:bg-slate-950 transition-all cursor-pointer group flex flex-col justify-between min-h-[185px] shadow-sm"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="p-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    <Layers className="w-4 h-4" />
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    10 Categories
                  </span>
                </div>
                <div className="text-sm sm:text-base font-bold text-white group-hover:text-amber-300 transition-colors">
                  Agent 3: Month Classifier
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Organizes monthly events into 10 WBPSC exam categories and builds Monthly PDF Capsules.
                </p>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-800/90 flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] text-slate-300">
                  Book-Indexed PDF
                </span>
                <span className="font-bold text-amber-400 group-hover:translate-x-0.5 transition-transform">
                  Manage →
                </span>
              </div>
            </button>

            {/* Agent Card 4: Date Recovery */}
            <button
              type="button"
              onClick={() => setActiveAgentModal("recovery")}
              className="text-left rounded-xl p-5 bg-slate-950/95 border border-purple-500/35 hover:border-purple-400 hover:bg-slate-950 transition-all cursor-pointer group flex flex-col justify-between min-h-[185px] shadow-sm"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="p-2 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30">
                    <HelpCircle className="w-4 h-4" />
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-purple-500/15 text-purple-300 border border-purple-500/30">
                    Single Date
                  </span>
                </div>
                <div className="text-sm sm:text-base font-bold text-white group-hover:text-purple-300 transition-colors">
                  Agent 4: Date Recovery
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Pick any past date to manually ground or force-refresh 12–14 exam-oriented topics.
                </p>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-800/90 flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] text-slate-300">
                  {agentEditionDate}
                </span>
                <span className="font-bold text-purple-400 group-hover:translate-x-0.5 transition-transform">
                  Manage →
                </span>
              </div>
            </button>

            {/* Agent Card 5: Bilingual & MCQ Generator */}
            <button
              type="button"
              onClick={() => setActiveAgentModal("bilingual")}
              className="text-left rounded-xl p-5 bg-slate-950/95 border border-slate-700 hover:border-emerald-400/60 hover:bg-slate-950 transition-all cursor-pointer group flex flex-col justify-between min-h-[185px] shadow-sm"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="p-2 rounded-lg bg-slate-800 text-emerald-300 border border-slate-700">
                    <Bot className="w-4 h-4" />
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Always Active
                  </span>
                </div>
                <div className="text-sm sm:text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                  Agent 5: Bilingual &amp; MCQ
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Internal sub-agent adding 4–5 rich exam pointers, Static GK links, Traps &amp; বাংলা অনুবাদ.
                </p>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-800/90 flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] text-slate-300">
                  EN + বাংলা Pipeline
                </span>
                <span className="font-bold text-slate-300 group-hover:text-white transition-colors">
                  Details →
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          AGENT MANAGEMENT MODAL (OPENS ONLY WHEN AN AGENT CARD IS SELECTED)
      ==================================================================== */}
      {isAdmin && activeAgentModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-5"
          onClick={() => setActiveAgentModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2.5">
                {activeAgentModal === "daily" && (
                  <>
                    <Clock className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      Agent 1: Daily Collector (12–14 Topics/Day)
                    </h3>
                  </>
                )}
                {activeAgentModal === "backfill" && (
                  <>
                    <CalendarIcon className="w-5 h-5 text-sky-400" />
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      Agent 2: Month-Wise Batch Backfiller
                    </h3>
                  </>
                )}
                {activeAgentModal === "classifier" && (
                  <>
                    <Layers className="w-5 h-5 text-amber-400" />
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      Agent 3: Monthly Category Classifier &amp; Capsule
                    </h3>
                  </>
                )}
                {activeAgentModal === "recovery" && (
                  <>
                    <HelpCircle className="w-5 h-5 text-purple-400" />
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      Agent 4: Single-Date Manual Recovery
                    </h3>
                  </>
                )}
                {activeAgentModal === "bilingual" && (
                  <>
                    <Bot className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      Agent 5: Bilingual &amp; MCQ Pipeline
                    </h3>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setActiveAgentModal(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                title="Close Modal (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {activeAgentModal === "daily" && (
                <>
                  <div className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3.5">
                    <span className="text-xs font-semibold text-slate-300">
                      Daily Scheduler Status:
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                        scheduler?.enabled
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      }`}
                    >
                      {scheduler?.enabled ? "AUTO-RUN: ON (Everyday)" : "AUTO-RUN: PAUSED"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                    Runs automatically every day for{" "}
                    <strong className="text-white">{formatReadableDate(todayIso, "en")}</strong>{" "}
                    and catches up missed recent days of the current month. Grounded on{" "}
                    <span className="text-emerald-300">PIB, The Hindu, GKToday &amp; AffairsCloud</span>, strictly filtering out job recruitments and holiday notices.
                  </p>

                  {(scheduler?.lastErrorReason || lastAgentErrorShort) && (
                    <div className="rounded-xl border border-rose-500/50 bg-rose-950/40 p-3.5 text-xs text-rose-200 space-y-2">
                      <div className="font-bold text-rose-300 flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        Model / Agent Failure Reason
                        {scheduler?.lastFailedDate ? ` (${scheduler.lastFailedDate})` : ""}:
                      </div>
                      <div className="text-[11px] text-rose-100 font-mono break-words">
                        {lastAgentErrorShort || scheduler?.lastErrorReason}
                      </div>
                      <button
                        type="button"
                        disabled={agentBusy}
                        onClick={() =>
                          void handleRunAgentForDate(
                            scheduler?.lastFailedDate || todayIso,
                            false
                          )
                        }
                        className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-xs cursor-pointer"
                      >
                        Retry Failed Date Now
                      </button>
                    </div>
                  )}

                  {scheduler?.missingRecentDates &&
                    scheduler.missingRecentDates.length > 0 && (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-amber-300">
                            Pending Recent Days ({scheduler.missingRecentDates.length}):{" "}
                          </span>
                          <span className="font-mono text-[11px]">
                            {scheduler.missingRecentDates.join(", ")}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={backfillBusy}
                          onClick={() =>
                            void handleAutoBackfillPastDays(
                              todayIso.slice(0, 7),
                              "days-1-10"
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold text-xs cursor-pointer"
                        >
                          {backfillBusy ? "Backfilling..." : "Fill Missing Days"}
                        </button>
                      </div>
                    )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      disabled={toggleSchedulerBusy}
                      onClick={() => void handleToggleAutoScheduler()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                    >
                      <Power className="w-3.5 h-3.5 text-emerald-400" />
                      {scheduler?.enabled ? "Pause Daily Auto-Run" : "Turn ON Daily Auto-Run"}
                    </button>

                    {(() => {
                      const todayCount = editionsByDate.get(todayIso)?.topics.length || 0;
                      const isTodayComplete = todayCount >= 12;
                      const todayRemaining = Math.max(0, 14 - todayCount);
                      return (
                        <button
                          type="button"
                          disabled={agentBusy || isTodayComplete}
                          onClick={() => void handleRunAgentForDate(todayIso)}
                          className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg ${
                            isTodayComplete
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-not-allowed"
                              : "bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 cursor-pointer"
                          }`}
                        >
                          {agentBusy ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Collecting 12–14 Topics...
                            </>
                          ) : isTodayComplete ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Today&apos;s {todayCount} Topics Complete
                            </>
                          ) : todayCount > 0 ? (
                            <>
                              <Play className="w-3.5 h-3.5" />
                              Generate Remaining {todayRemaining} Topics
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5" />
                              Collect Today&apos;s 12–14 Topics
                            </>
                          )}
                        </button>
                      );
                    })()}
                  </div>
                </>
              )}

              {activeAgentModal === "backfill" && (
                <>
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                    Select any month and batch window below to populate uncollected dates (up to 4 dates per run) with Google-Search-grounded, non-duplicate WBPSC Current Affairs.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-400">
                        Select Month
                      </label>
                      <select
                        value={backfillMonthKey}
                        onChange={(e) => setBackfillMonthKey(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-bold text-white cursor-pointer"
                      >
                        {availableMonthKeys.map((mk) => (
                          <option key={mk} value={mk}>
                            {formatReadableMonth(mk, lang)} ({mk})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-400">
                        Select Batch Window
                      </label>
                      <select
                        value={backfillBatchRange}
                        onChange={(e) =>
                          setBackfillBatchRange(
                            e.target.value as
                              | "days-1-10"
                              | "days-11-20"
                              | "days-21-end"
                              | "full-month"
                          )
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-sky-300 cursor-pointer"
                      >
                        <option value="full-month">Full Month (All 30/31 Days)</option>
                        <option value="days-1-10">Batch 1: Days 01 – 10</option>
                        <option value="days-11-20">Batch 2: Days 11 – 20</option>
                        <option value="days-21-end">Batch 3: Days 21 – End of Month</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      disabled={backfillBusy}
                      onClick={() =>
                        void handleAutoBackfillPastDays(backfillMonthKey, backfillBatchRange)
                      }
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-sky-400 hover:bg-sky-300 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
                    >
                      {backfillBusy ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Running Batch Backfill...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          Run Batch Backfill
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}

              {activeAgentModal === "classifier" && (
                <>
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                    Select any past or current month to synthesize high-yield WBPSC exam events across all 10 categories (Polity, Economy, Science, West Bengal Special, GI Tags, Sports, Awards, Defence &amp; Indices).
                  </p>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-400">
                      Target Month
                    </label>
                    <select
                      value={classifierSelectedMonth}
                      onChange={(e) => setClassifierSelectedMonth(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-bold text-white cursor-pointer"
                    >
                      {availableMonthKeys.map((mk) => (
                        <option key={mk} value={mk}>
                          {formatReadableMonth(mk, lang)} ({mk})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-end pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      disabled={classifierBusyMonth !== null}
                      onClick={() => void handleRunMonthlyClassifierAgent(classifierSelectedMonth)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
                    >
                      {classifierBusyMonth === classifierSelectedMonth ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Classifying {formatReadableMonth(classifierSelectedMonth, "en")}...
                        </>
                      ) : (
                        <>
                          <Bot className="w-3.5 h-3.5" />
                          Build Monthly Categorized Capsule
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}

              {activeAgentModal === "recovery" && (
                <>
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                    Pick any past or present date below to collect missing Current Affairs topics or force re-ground that date with fresh, rich WBPSC exam-standard notes.
                  </p>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-400">
                      Select Edition Date (Future Dates Locked)
                    </label>
                    <input
                      type="date"
                      max={todayIso}
                      value={agentEditionDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAgentEditionDate(val > todayIso ? todayIso : val);
                      }}
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>

                  {(() => {
                    const pickedCount = editionsByDate.get(agentEditionDate)?.topics.length || 0;
                    const isPickedComplete = pickedCount >= 12;
                    const pickedRemaining = Math.max(0, 14 - pickedCount);
                    return (
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-800">
                        {pickedCount > 0 && (
                          <button
                            type="button"
                            disabled={agentBusy}
                            onClick={() => void handleRunAgentForDate(agentEditionDate, true)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/50 text-sky-200 disabled:opacity-50 cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${agentBusy ? "animate-spin" : ""}`} />
                            Force Re-Ground (12–14 Topics)
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={agentBusy || isPickedComplete}
                          onClick={() => void handleRunAgentForDate(agentEditionDate, false)}
                          className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg ${
                            isPickedComplete
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-not-allowed"
                              : "bg-purple-400 hover:bg-purple-300 disabled:opacity-50 text-slate-950 cursor-pointer"
                          }`}
                        >
                          {agentBusy ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Grounding 12–14 Topics...
                            </>
                          ) : isPickedComplete ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {pickedCount} Topics Stored
                            </>
                          ) : pickedCount > 0 ? (
                            <>
                              <Bot className="w-3.5 h-3.5" />
                              Ground Remaining {pickedRemaining} Topics
                            </>
                          ) : (
                            <>
                              <Bot className="w-3.5 h-3.5" />
                              Ground 12–14 Topics ({agentEditionDate})
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })()}
                </>
              )}

              {activeAgentModal === "bilingual" && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-4 space-y-2">
                    <div className="font-bold text-emerald-300">
                      100% Automatic Internal Enrichment Pipeline
                    </div>
                    <p>
                      Whenever Agents 1–4 collect Current Affairs, Agent 5 automatically enriches every topic with:
                    </p>
                    <ul className="list-disc pl-5 space-y-1 text-slate-300">
                      <li>4–5 detailed English &amp; Bengali (বাংলা) exam bullet pointers</li>
                      <li>Constitutional, Geographical &amp; Institutional Static GK hooks</li>
                      <li>Exam-hall confuser / trap alerts</li>
                      <li>PYQ-standard Bilingual MCQs + Vector DB semantic deduplication</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SECTION 3B: CURRENT AFFAIRS VECTOR DB KNOWLEDGE STORE (ADMIN ONLY)
          Clean, Easy-to-Understand 3-Card Layout — Opens Dedicated Modals on Click.
      ==================================================================== */}
      {isAdmin && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-400 uppercase tracking-wider">
                <Database className="w-4 h-4" />
                Multi-Source Current Affairs Vector DB Knowledge Store
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Upload, Browse &amp; Search Current Affairs Files
              </h2>
              <p className="text-xs text-slate-400">
                Store PDF, Word, or Image CA files for any day, month, or year and search them instantly for WBPSC test creation.
              </p>
            </div>

            {vectorStats && (
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-white font-bold">
                  {vectorStats.totalDocumentsCount} Files
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-sky-300 font-bold">
                  {vectorStats.totalChunksIndexed} Vector Chunks
                </span>
              </div>
            )}
          </div>

          {/* Enlarged Responsive 3-Card Grid for Vector Store Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Vector Card 1: Upload CA Files */}
            <button
              type="button"
              onClick={() => setActiveVectorModal("upload")}
              className="text-left rounded-xl p-5 bg-slate-950/95 border border-emerald-500/35 hover:border-emerald-400 hover:bg-slate-950 transition-all cursor-pointer group flex flex-col justify-between min-h-[175px] shadow-sm"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="p-2 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <Upload className="w-4 h-4" />
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    PDF · Word · Image
                  </span>
                </div>
                <div className="text-sm sm:text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                  1. Upload CA Files
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Upload single-day, multi-day, monthly, or yearly Current Affairs files from any publisher.
                </p>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-800/90 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-400">Multi-file supported</span>
                <span className="font-bold text-emerald-400 group-hover:translate-x-0.5 transition-transform">
                  Open Upload →
                </span>
              </div>
            </button>

            {/* Vector Card 2: Stored Documents */}
            <button
              type="button"
              onClick={() => setActiveVectorModal("documents")}
              className="text-left rounded-xl p-5 bg-slate-950/95 border border-amber-500/35 hover:border-amber-400 hover:bg-slate-950 transition-all cursor-pointer group flex flex-col justify-between min-h-[175px] shadow-sm"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="p-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    <FileText className="w-4 h-4" />
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    {vectorStats?.totalDocumentsCount ?? vectorDocs.length} Stored
                  </span>
                </div>
                <div className="text-sm sm:text-base font-bold text-white group-hover:text-amber-300 transition-colors">
                  2. Stored CA Library
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  View all indexed PDFs, Word docs, and images by scope and publisher, or delete old files.
                </p>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-800/90 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-400">
                  {vectorStats?.uniquePublishersCount || 0} Publishers
                </span>
                <span className="font-bold text-amber-400 group-hover:translate-x-0.5 transition-transform">
                  View Library →
                </span>
              </div>
            </button>

            {/* Vector Card 3: Semantic Vector Search */}
            <button
              type="button"
              onClick={() => setActiveVectorModal("search")}
              className="text-left rounded-xl p-5 bg-slate-950/95 border border-sky-500/35 hover:border-sky-400 hover:bg-slate-950 transition-all cursor-pointer group flex flex-col justify-between min-h-[175px] shadow-sm"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="p-2 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    <Search className="w-4 h-4" />
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    {vectorStats?.totalChunksIndexed || 0} Chunks
                  </span>
                </div>
                <div className="text-sm sm:text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                  3. Semantic Topic Search
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Search across all stored CA chunks by topic or keyword for Clerkship &amp; WBCS test series.
                </p>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-800/90 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-400">Cosine Similarity</span>
                <span className="font-bold text-sky-400 group-hover:translate-x-0.5 transition-transform">
                  Search Store →
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          VECTOR DB KNOWLEDGE STORE MODAL (UPLOAD / LIBRARY / SEMANTIC SEARCH)
      ==================================================================== */}
      {isAdmin && activeVectorModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-5"
          onClick={() => setActiveVectorModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2.5">
                {activeVectorModal === "upload" && (
                  <>
                    <Upload className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      Upload Current Affairs into Vector DB
                    </h3>
                  </>
                )}
                {activeVectorModal === "documents" && (
                  <>
                    <FileText className="w-5 h-5 text-amber-400" />
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      Stored CA Library ({vectorDocs.length} Files)
                    </h3>
                  </>
                )}
                {activeVectorModal === "search" && (
                  <>
                    <Search className="w-5 h-5 text-sky-400" />
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      Semantic Vector Search ({vectorStats?.totalChunksIndexed || 0} Chunks)
                    </h3>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setActiveVectorModal(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                title="Close Modal (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {activeVectorModal === "upload" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Document Title (Optional)
                      </label>
                      <input
                        type="text"
                        value={uploadTitle}
                        onChange={(e) => setUploadTitle(e.target.value)}
                        placeholder="e.g., Achievers Nov 2026 Capsule"
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Publisher / Source Name
                      </label>
                      <input
                        type="text"
                        value={uploadPublisher}
                        onChange={(e) => setUploadPublisher(e.target.value)}
                        placeholder="e.g., GKToday, Achievers, PIB"
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                      Time Coverage Scope
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          { id: "single_day", label: "Single Day" },
                          { id: "date_range", label: "Multiple Days" },
                          { id: "multi_month", label: "Month(s)" },
                          { id: "yearly", label: "Yearly" },
                        ] as const
                      ).map((sc) => (
                        <button
                          key={sc.id}
                          type="button"
                          onClick={() => setUploadScopeType(sc.id)}
                          className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                            uploadScopeType === sc.id
                              ? "bg-sky-500 text-slate-950 border-sky-400"
                              : "bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700"
                          }`}
                        >
                          {sc.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {uploadScopeType === "single_day" && (
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-300">Select Date:</span>
                      <input
                        type="date"
                        max={todayIso}
                        value={uploadSingleDate}
                        onChange={(e) => setUploadSingleDate(e.target.value)}
                        className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                  )}

                  {uploadScopeType === "date_range" && (
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">From Date</label>
                        <input
                          type="date"
                          max={todayIso}
                          value={uploadStartDate}
                          onChange={(e) => setUploadStartDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">To Date</label>
                        <input
                          type="date"
                          max={todayIso}
                          value={uploadEndDate}
                          onChange={(e) => setUploadEndDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                        />
                      </div>
                    </div>
                  )}

                  {uploadScopeType === "multi_month" && (
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-300">
                        <span>Select Month(s):</span>
                        <span className="font-mono text-sky-300">
                          {uploadSelectedMonths.length} selected
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-[96px] overflow-y-auto">
                        {availableMonthKeys.map((mk) => {
                          const active = uploadSelectedMonths.includes(mk);
                          return (
                            <button
                              key={mk}
                              type="button"
                              onClick={() =>
                                setUploadSelectedMonths((prev) =>
                                  prev.includes(mk)
                                    ? prev.length > 1
                                      ? prev.filter((x) => x !== mk)
                                      : prev
                                    : [...prev, mk]
                                )
                              }
                              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer ${
                                active
                                  ? "bg-emerald-500/25 border-emerald-500/60 text-emerald-200"
                                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              {formatReadableMonth(mk, "en")}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {uploadScopeType === "yearly" && (
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-300">Select Yearly Window:</span>
                      <select
                        value={uploadTargetYear}
                        onChange={(e) => setUploadTargetYear(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                      >
                        <option value="2025-2026">Nov 2025 – Nov 2026 (1-Year)</option>
                        <option value="2026">Full Year 2026</option>
                        <option value="2025">Full Year 2025</option>
                      </select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-300">
                      Select PDF, Word (.docx/.doc/.txt), or Image (.png/.jpg/.webp)
                    </label>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                      onChange={(e) => {
                        const files = e.target.files ? Array.from(e.target.files) : [];
                        setSelectedUploadFiles(files);
                      }}
                      className="block w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-sky-500 file:text-slate-950 hover:file:bg-sky-400 cursor-pointer bg-slate-950 border border-slate-700 rounded-lg p-1.5"
                    />
                    {selectedUploadFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {selectedUploadFiles.map((f, i) => (
                          <span
                            key={`${f.name}-${i}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/40 text-[11px] text-sky-200 font-mono"
                          >
                            <FileText className="w-3 h-3" />
                            {f.name} ({Math.max(1, Math.round(f.size / 1024))} KB)
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Optional Notes / Key Highlights
                    </label>
                    <textarea
                      rows={2}
                      value={uploadTextHint}
                      onChange={(e) => setUploadTextHint(e.target.value)}
                      placeholder="Optional text notes to embed alongside the uploaded file..."
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {[
                        "WBPSC Clerkship (100 Marks)",
                        "WBCS Prelims (200 Marks)",
                        "WBPSC Miscellaneous",
                      ].map((tag) => {
                        const active = uploadExamTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() =>
                              setUploadExamTags((prev) =>
                                prev.includes(tag)
                                  ? prev.length > 1
                                    ? prev.filter((t) => t !== tag)
                                    : prev
                                  : [...prev, tag]
                              )
                            }
                            className={`px-2 py-1 rounded border cursor-pointer ${
                              active
                                ? "bg-amber-500/20 border-amber-500/50 text-amber-200 font-semibold"
                                : "bg-slate-950 border-slate-800 text-slate-400"
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      disabled={vectorUploadBusy}
                      onClick={() => void handleUploadDocumentsToVectorStore()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer shadow-sm"
                    >
                      {vectorUploadBusy ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Indexing into Vector DB...
                        </>
                      ) : (
                        <>
                          <Upload className="w-3.5 h-3.5" />
                          Upload &amp; Index
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}

              {activeVectorModal === "documents" && (
                <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                  {vectorDocs.length === 0 ? (
                    <div className="text-center py-10 text-xs text-slate-400">
                      No documents uploaded yet. Click &ldquo;1. Upload CA Files&rdquo; to add PDF, Word, or Image files.
                    </div>
                  ) : (
                    vectorDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                            <span
                              className={`px-2 py-0.5 rounded font-bold ${
                                doc.fileFormat === "PDF"
                                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                  : doc.fileFormat === "WORD"
                                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                                    : "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                              }`}
                            >
                              {doc.fileFormat === "IMAGE" ? (
                                <span className="inline-flex items-center gap-1">
                                  <ImageIcon className="w-3 h-3" /> IMAGE
                                </span>
                              ) : (
                                doc.fileFormat
                              )}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              {doc.scopeLabel}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-sky-300">
                              {doc.chunksCount} Chunks
                            </span>
                          </div>

                          <div className="text-xs font-bold text-white truncate">
                            {doc.title}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Source: <strong className="text-slate-200">{doc.sourcePublisher}</strong> ·{" "}
                            <span className="font-mono">{doc.fileName}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleDeleteVectorDocument(doc.id, doc.title)}
                          title="Delete this document from Vector DB"
                          className="p-2 rounded-lg bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-800 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeVectorModal === "search" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={vectorSearchQuery}
                      onChange={(e) => setVectorSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSearchVectorStore();
                      }}
                      placeholder="Search by meaning (e.g., ISRO space mission, RBI repo rate, GI tag)..."
                      className="flex-1 min-w-[180px] px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                    <select
                      value={vectorSearchScopeFilter}
                      onChange={(e) => setVectorSearchScopeFilter(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 cursor-pointer"
                    >
                      <option value="all">All Scopes</option>
                      <option value="single_day">Single Day</option>
                      <option value="date_range">Multiple Days</option>
                      <option value="multi_month">Month(s)</option>
                      <option value="yearly">Yearly</option>
                    </select>
                    <button
                      type="button"
                      disabled={vectorSearchBusy}
                      onClick={() => void handleSearchVectorStore()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-sky-400 hover:bg-sky-300 text-slate-950 rounded-lg cursor-pointer"
                    >
                      <Search className="w-3.5 h-3.5" />
                      {vectorSearchBusy ? "Searching..." : "Search"}
                    </button>
                  </div>

                  {vectorSearchResults !== null ? (
                    <div className="space-y-2.5 max-h-[52vh] overflow-y-auto pr-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-sky-300">
                          Top Matches ({vectorSearchResults.length} Chunks)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setVectorSearchResults(null);
                            setVectorSearchQuery("");
                          }}
                          className="text-slate-400 hover:text-white cursor-pointer"
                        >
                          Clear Results
                        </button>
                      </div>
                      {vectorSearchResults.map((ch) => (
                        <div
                          key={ch.id}
                          className="bg-slate-950 border border-sky-500/30 rounded-xl p-3.5 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="font-bold text-emerald-300">
                              {ch.category} · {ch.sourcePublisher}
                            </span>
                            <span className="font-mono text-sky-300">
                              Match: {Math.round((ch.similarityScore || 0.88) * 100)}%
                            </span>
                          </div>
                          <div className="text-xs font-bold text-white">
                            {lang === "bn" && ch.headlineBn ? ch.headlineBn : ch.headlineEn}
                          </div>
                          <p className="text-[11px] text-slate-300 leading-relaxed">
                            {lang === "bn" && ch.contentBn ? ch.contentBn : ch.contentEn}
                          </p>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Scope: {ch.scopeLabel}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-xl">
                      Enter any topic or exam keyword above to run semantic cosine search across{" "}
                      <strong className="text-white">{vectorChunksPreview.length || vectorStats?.totalChunksIndexed || 0}</strong> indexed chunks.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SECTION 4: CLEAN INTERACTIVE CURRENT AFFAIRS MCQ PRACTICE QUIZ
      ==================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-amber-400" />
              {lang === "bn"
                ? "কারেন্ট অ্যাফেয়ার্স প্র্যাকটিস কুইজ (PYQ-ধাঁচের প্রশ্ন)"
                : "Current Affairs Self-Check MCQ Quiz"}
            </h2>
            <p className="text-xs text-slate-400">
              Test your memory on the collected Current Affairs topics. Select an answer for each question and click{" "}
              <strong className="text-emerald-300">Verify Answers</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={quizMonthKey}
              onChange={(e) => {
                setQuizMonthKey(e.target.value);
                setSelectedAnswers({});
                setQuizSubmitted(false);
              }}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
            >
              <option value="all">Recent Months Combined</option>
              {availableMonthKeys.map((mk) => (
                <option key={mk} value={mk}>
                  {formatReadableMonth(mk, lang)}
                </option>
              ))}
            </select>

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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 max-h-[420px] overflow-y-auto pr-1">
          {quizMcqs.map(({ mcq, editionDate }, idx) => {
            const picked = selectedAnswers[mcq.id];
            const isCorrect = picked === mcq.correctOption;
            return (
              <div
                key={`${mcq.id}-${idx}`}
                className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-emerald-400 font-semibold">
                    Q{idx + 1} · {mcq.category}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    📅 {formatReadableDate(editionDate, lang)}
                  </span>
                </div>

                <p className="text-xs lg:text-sm font-semibold text-white leading-relaxed">
                  {lang === "bn" ? mcq.stem.bn : mcq.stem.en}
                </p>

                <div className="grid grid-cols-1 gap-1.5">
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
                    className={`p-2.5 rounded-lg border text-xs leading-relaxed ${
                      isCorrect
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                        : "bg-slate-900 border-slate-800 text-slate-300"
                    }`}
                  >
                    <strong className="text-emerald-300">
                      Answer ({mcq.correctOption}):{" "}
                    </strong>
                    {lang === "bn" ? mcq.explanation.bn : mcq.explanation.en}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ====================================================================
          SECTION 5: FLOATING ANIMATED FLASHCARD MODAL
          - Includes Built-in Month Selector + Interactive Calendar inside Modal!
          - By default loads ALL stored dates of the selected Month ("Whole Month")
          - Clicking any date in the modal calendar filters to that specific date's cards
          - Clearly displays human-readable Date Badge on every card!
      ==================================================================== */}
      {floatingModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-1.5 sm:p-4"
          onClick={() => setFloatingModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-6xl bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[95vh] sm:h-auto sm:max-h-[92vh] transition-all duration-300"
          >
            {/* Modal Top Header Bar (Compact on Mobile so Card Content is Never Squeezed) */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-5 sm:py-3.5 border-b border-slate-800 bg-slate-950 shrink-0">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-[11px] sm:text-xs font-mono font-bold text-emerald-300">
                  {modalDeckCards.length > 0
                    ? `Card ${floatingCardIdx + 1} / ${modalDeckCards.length}`
                    : "0 Cards"}
                </span>

                {/* Prominent Human-Readable Month & Date Indicator */}
                <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-[11px] sm:text-xs font-bold text-amber-300 flex items-center gap-1.5 max-w-[220px] sm:max-w-none truncate">
                  <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {modalDateFilter === "all"
                      ? `${formatReadableMonth(modalMonthKey, lang)} (${storedEditionsInModalMonth.length}d)`
                      : formatReadableDate(modalDateFilter, lang)}
                  </span>
                </span>

                {/* Admin Top-Up Button if Selected Single Date has < 12 Topics */}
                {isAdmin &&
                  modalDateFilter !== "all" &&
                  modalDateFilter <= todayIso &&
                  (() => {
                    const selectedDateCount =
                      editionsByDate.get(modalDateFilter)?.topics.length || 0;
                    const remainingTo14 = Math.max(0, 14 - selectedDateCount);
                    if (selectedDateCount >= 12) {
                      return (
                        <span className="hidden md:inline-flex px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-xs font-bold text-emerald-300 items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {selectedDateCount} Topics Complete
                        </span>
                      );
                    }
                    return (
                      <button
                        type="button"
                        disabled={agentBusy}
                        onClick={() => void handleRunAgentForDate(modalDateFilter)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-[11px] sm:text-xs font-bold text-slate-950 cursor-pointer shadow-sm"
                        title={`Generate remaining ${remainingTo14} unique Current Affairs topics for ${modalDateFilter}`}
                      >
                        <Bot className="w-3.5 h-3.5" />
                        {agentBusy
                          ? "Generating..."
                          : selectedDateCount > 0
                            ? `+ Top-Up (${selectedDateCount} Stored)`
                            : `+ Collect 12–14 Topics`}
                      </button>
                    );
                  })()}

                {/* Admin Single-Date Delete Button (Desktop Header) */}
                {isAdmin &&
                  modalDateFilter !== "all" &&
                  editionsByDate.has(modalDateFilter) && (
                    <button
                      type="button"
                      disabled={deleteBusy}
                      onClick={() => {
                        const ed = editionsByDate.get(modalDateFilter);
                        if (ed) void handleDeleteEdition(ed.id, ed.editionDate);
                      }}
                      className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-xs font-bold text-rose-300 cursor-pointer"
                      title={`Delete all pages of ${modalDateFilter}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Date ({modalDateFilter})
                    </button>
                  )}
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setShowModalCalendar((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold cursor-pointer border transition-colors ${
                    showModalCalendar
                      ? "bg-amber-400 text-slate-950 border-amber-300 lg:bg-slate-800 lg:text-slate-200 lg:border-slate-700"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                  }`}
                >
                  <CalendarIcon className="w-3.5 h-3.5 text-emerald-400 lg:text-emerald-400" />
                  <span>{showModalCalendar ? "Close Calendar" : "Calendar"}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void handleDownloadCategorizedCapsulePdf(
                      storedEditionsInModalMonth,
                      `${formatReadableMonth(modalMonthKey, "en")} — Categorized Monthly Capsule`,
                      `WBPSC-CA-Categorized-${modalMonthKey}`
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[11px] sm:text-xs font-bold text-slate-950 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download {formatReadableMonth(modalMonthKey, "en")}</span>
                  <span>PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFloatingModalOpen(false)}
                  className="p-1.5 sm:p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                  title="Close Floating Deck (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Main Body: On Mobile, toggles cleanly between Calendar Picker and Card Content so Card Content always has full height! */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col lg:grid lg:grid-cols-12">
              {/* LEFT SIDEBAR INSIDE MODAL: Month Selector + Interactive Date Calendar */}
              {showModalCalendar && (
                <div className="flex-1 min-h-0 lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-950/90 p-3.5 sm:p-4 overflow-y-auto space-y-4">
                  {/* Step 1: Select Month */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      1. Select Month (Past 1 Year)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => stepModalMonth(1)}
                        className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
                        title="Previous Month"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>

                      <select
                        value={modalMonthKey}
                        onChange={(e) => {
                          setModalMonthKey(e.target.value);
                          setModalDateFilter("all");
                          setFloatingCardIdx(0);
                        }}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-bold text-white cursor-pointer"
                      >
                        {availableMonthKeys.map((mk) => (
                          <option key={mk} value={mk}>
                            {formatReadableMonth(mk, lang)} ({mk})
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => stepModalMonth(-1)}
                        className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
                        title="Next Month"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Step 2: Whole Month (Default) vs Specific Date Calendar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        2. Pick Date or Whole Month
                      </label>
                    </div>

                    {/* Default Option: Show All Stored Dates in Selected Month */}
                    <button
                      type="button"
                      onClick={() => {
                        setModalDateFilter("all");
                        setFloatingCardIdx(0);
                        if (typeof window !== "undefined" && window.innerWidth < 1024) {
                          setShowModalCalendar(false);
                        }
                      }}
                      className={`w-full py-2 px-3 rounded-lg text-xs font-bold border transition-all flex items-center justify-between cursor-pointer ${
                        modalDateFilter === "all"
                          ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm"
                          : "bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <span>All Stored Dates in {formatReadableMonth(modalMonthKey, "en")}</span>
                      <span className="font-mono text-[11px]">
                        ({storedEditionsInModalMonth.reduce((a, e) => a + e.topics.length, 0)} Cards)
                      </span>
                    </button>

                    {/* Interactive Calendar Grid inside Modal */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-500 mb-1.5">
                        {WEEKDAYS.map((wd) => (
                          <div key={wd}>{wd}</div>
                        ))}
                      </div>

                      <div className="grid grid-cols-7 gap-1">
                        {modalCalendarCells.map((cell, idx) => {
                          if (!cell.dayNumber || !cell.dateStr) {
                            return <div key={`empty-${idx}`} className="h-7" />;
                          }
                          const isFutureDate = cell.dateStr > todayIso;
                          const matchingEdition = !isFutureDate
                            ? editionsByDate.get(cell.dateStr)
                            : undefined;
                          const isSelectedSingleDate = modalDateFilter === cell.dateStr;

                          return (
                            <button
                              key={cell.dateStr}
                              type="button"
                              disabled={isFutureDate}
                              onClick={() => {
                                if (isFutureDate) return;
                                setModalDateFilter(cell.dateStr!);
                                setFloatingCardIdx(0);
                                if (typeof window !== "undefined" && window.innerWidth < 1024) {
                                  setShowModalCalendar(false);
                                }
                              }}
                              title={
                                isFutureDate
                                  ? `${formatReadableDate(cell.dateStr, "en")}: Future date (not yet occurred)`
                                  : matchingEdition
                                    ? `${formatReadableDate(cell.dateStr, "en")}: ${matchingEdition.topics.length} Topics stored — Click to view`
                                    : isAdmin
                                      ? `${formatReadableDate(cell.dateStr, "en")}: Click to collect topics for this date`
                                      : `${formatReadableDate(cell.dateStr, "en")}: No Current Affairs published for this date`
                              }
                              className={`h-7 rounded-md text-[11px] font-mono transition-all flex flex-col items-center justify-center relative ${
                                isFutureDate
                                  ? "opacity-25 cursor-not-allowed bg-slate-950 text-slate-600"
                                  : isSelectedSingleDate
                                    ? "bg-amber-400 text-slate-950 font-bold shadow-sm cursor-pointer"
                                    : matchingEdition
                                      ? "bg-emerald-500/25 border border-emerald-500/60 text-emerald-200 font-bold hover:bg-emerald-500/40 cursor-pointer"
                                      : "bg-slate-950/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
                              }`}
                            >
                              <span>{cell.dayNumber}</span>
                              {matchingEdition && !isSelectedSingleDate && (
                                <span className="w-1 h-1 rounded-full bg-emerald-400 absolute bottom-0.5" />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          Stored Date
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-amber-400" />
                          Selected Date
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Quick List of Stored Dates in This Month */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Stored Dates in {formatReadableMonth(modalMonthKey, "en")}
                      </div>
                      {isAdmin && storedEditionsInModalMonth.length > 0 && (
                        <button
                          type="button"
                          disabled={deleteBusy}
                          onClick={() =>
                            void handleBulkDeleteEditions({
                              monthKey: modalMonthKey,
                              deleteAllInMonth: true,
                            })
                          }
                          className="text-[10px] font-bold text-rose-400 hover:text-rose-300 inline-flex items-center gap-1 cursor-pointer"
                          title={`Delete all stored dates in ${formatReadableMonth(modalMonthKey, "en")}`}
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete Month ({storedEditionsInModalMonth.length}d)
                        </button>
                      )}
                    </div>
                    <div className="space-y-1.5 max-h-[150px] overflow-y-auto pr-1">
                      {storedEditionsInModalMonth.map((ed) => (
                        <div
                          key={ed.id}
                          className={`w-full px-3 py-2 rounded-lg border text-xs transition-all flex items-center justify-between gap-2 ${
                            modalDateFilter === ed.editionDate
                              ? "bg-amber-400/20 border-amber-400/60 text-amber-200 font-bold"
                              : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setModalDateFilter(ed.editionDate);
                              setFloatingCardIdx(0);
                              if (typeof window !== "undefined" && window.innerWidth < 1024) {
                                setShowModalCalendar(false);
                              }
                            }}
                            className="flex-1 text-left flex items-center justify-between cursor-pointer"
                          >
                            <span>📅 {formatReadableDate(ed.editionDate, lang)}</span>
                            <span className="font-mono text-[11px] text-emerald-400">
                              {ed.topics.length} Cards
                            </span>
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              disabled={deleteBusy}
                              onClick={() => void handleDeleteEdition(ed.id, ed.editionDate)}
                              title={`Delete ${ed.editionDate} Current Affairs`}
                              className="p-1 rounded hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Step 3: Filter by Category inside Modal */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      3. Filter by Exam Category
                    </label>
                    <select
                      value={modalCategoryFilter}
                      onChange={(e) => {
                        setModalCategoryFilter(e.target.value);
                        setFloatingCardIdx(0);
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white cursor-pointer"
                    >
                      <option value="all">All 10 Categories</option>
                      {ORDERED_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Mobile Button to Switch Back to Cards View */}
                  <button
                    type="button"
                    onClick={() => setShowModalCalendar(false)}
                    className="w-full lg:hidden py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs text-center cursor-pointer shadow-md"
                  >
                    View Current Affairs Cards ({modalDeckCards.length})
                  </button>
                </div>
              )}

              {/* RIGHT AREA INSIDE MODAL: Animated Flashcard Content + Page-Wise Delete + Date Upload */}
              <div
                className={`${
                  showModalCalendar
                    ? "hidden lg:flex lg:col-span-8"
                    : "flex lg:col-span-12"
                } flex-1 min-h-0 flex-col overflow-hidden`}
              >
                {/* INLINE ADMIN UPLOAD CA + QUESTION PANEL FOR THIS PARTICULAR DATE */}
                {isAdmin && showModalDateUpload && (() => {
                  const targetUploadDate =
                    modalDateFilter !== "all"
                      ? modalDateFilter
                      : activeModalCard?.editionDate || todayIso;

                  return (
                    <div className="bg-slate-950 border-b border-sky-500/40 p-4 space-y-3 overflow-y-auto max-h-[56vh] shrink-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Upload className="w-3.5 h-3.5" />
                            Upload / Add Current Affairs &amp; Question for{" "}
                            <span className="text-amber-300">
                              {formatReadableDate(targetUploadDate, "en")} ({targetUploadDate})
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Upload a PDF / Word (.docx) / Image file OR fill in custom topic &amp; MCQ details below. It will be added as a new Page card and question directly into{" "}
                            <strong className="text-white">{targetUploadDate}</strong> in the DB.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setShowModalDateUpload(false)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                        {/* File Picker (PDF / Word / Image / Text) */}
                        <div className="space-y-1">
                          <label className="block text-[10px] font-bold uppercase text-slate-400">
                            1. Upload File (PDF / Word / Image) — Optional
                          </label>
                          <label className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-dashed border-sky-500/50 bg-sky-500/10 hover:bg-sky-500/15 text-xs text-sky-200 cursor-pointer">
                            <span className="truncate font-semibold">
                              {cardUploadFile
                                ? `📄 ${cardUploadFile.name}`
                                : "Choose PDF / Word / Image..."}
                            </span>
                            <input
                              type="file"
                              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp"
                              onChange={(e) =>
                                setCardUploadFile(e.target.files?.[0] || null)
                              }
                              className="hidden"
                            />
                          </label>
                        </div>

                        {/* Category */}
                        <div className="space-y-1">
                          <label className="block text-[10px] font-bold uppercase text-slate-400">
                            2. Category
                          </label>
                          <select
                            value={cardUploadCategory}
                            onChange={(e) => setCardUploadCategory(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white cursor-pointer"
                          >
                            {ORDERED_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Source Tag */}
                        <div className="space-y-1">
                          <label className="block text-[10px] font-bold uppercase text-slate-400">
                            3. Source / Reference Tag
                          </label>
                          <input
                            type="text"
                            value={cardUploadSourceTag}
                            onChange={(e) => setCardUploadSourceTag(e.target.value)}
                            placeholder="e.g. Admin Upload · PIB / The Hindu"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                        </div>
                      </div>

                      {/* Topic Headline & Bullet Points */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <input
                          type="text"
                          value={cardUploadHeadlineEn}
                          onChange={(e) => setCardUploadHeadlineEn(e.target.value)}
                          placeholder="Topic Headline (English) — or leave blank to auto-extract from uploaded file"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                        <input
                          type="text"
                          value={cardUploadHeadlineBn}
                          onChange={(e) => setCardUploadHeadlineBn(e.target.value)}
                          placeholder="শিরোনাম (বাংলা) — ঐচ্ছিক (Optional Bengali Headline)"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <textarea
                          rows={2}
                          value={cardUploadWhyEn}
                          onChange={(e) => setCardUploadWhyEn(e.target.value)}
                          placeholder="Why in News / Summary for this date..."
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                        <textarea
                          rows={2}
                          value={cardUploadPointsText}
                          onChange={(e) => setCardUploadPointsText(e.target.value)}
                          placeholder="Exam Bullet Facts (one per line) + Static GK linkage..."
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>

                      {/* Question (MCQ) to Add into DB for this Date */}
                      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2">
                        <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                          Add MCQ Question into DB for {targetUploadDate} (Auto-Generated from File if Left Blank)
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={cardUploadMcqStemEn}
                            onChange={(e) => setCardUploadMcqStemEn(e.target.value)}
                            placeholder="MCQ Question Stem (English)"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                          <input
                            type="text"
                            value={cardUploadMcqStemBn}
                            onChange={(e) => setCardUploadMcqStemBn(e.target.value)}
                            placeholder="প্রশ্ন (বাংলা) — Optional"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                          <input
                            type="text"
                            value={cardUploadOptA}
                            onChange={(e) => setCardUploadOptA(e.target.value)}
                            placeholder="Option A"
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                          <input
                            type="text"
                            value={cardUploadOptB}
                            onChange={(e) => setCardUploadOptB(e.target.value)}
                            placeholder="Option B"
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                          <input
                            type="text"
                            value={cardUploadOptC}
                            onChange={(e) => setCardUploadOptC(e.target.value)}
                            placeholder="Option C"
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                          <input
                            type="text"
                            value={cardUploadOptD}
                            onChange={(e) => setCardUploadOptD(e.target.value)}
                            placeholder="Option D"
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                          <select
                            value={cardUploadCorrectOpt}
                            onChange={(e) =>
                              setCardUploadCorrectOpt(e.target.value as OptionKey)
                            }
                            className="bg-slate-950 border border-emerald-500/50 rounded-lg px-2.5 py-1.5 text-xs font-bold text-emerald-300 cursor-pointer"
                          >
                            <option value="A">Correct: Option A</option>
                            <option value="B">Correct: Option B</option>
                            <option value="C">Correct: Option C</option>
                            <option value="D">Correct: Option D</option>
                          </select>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <input
                            type="text"
                            value={cardUploadExplanationEn}
                            onChange={(e) => setCardUploadExplanationEn(e.target.value)}
                            placeholder="Answer Explanation (Optional)"
                            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                          <button
                            type="button"
                            disabled={cardUploadBusy}
                            onClick={() =>
                              void handleUploadCaForDateInModal(targetUploadDate)
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-xs font-bold text-slate-950 cursor-pointer shadow-sm"
                          >
                            {cardUploadBusy ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                Uploading &amp; Saving to {targetUploadDate}...
                              </>
                            ) : (
                              <>
                                <Upload className="w-3.5 h-3.5" />
                                Upload &amp; Add CA + Question to {targetUploadDate} DB
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* INLINE MULTI-PAGE DELETE SELECTOR (e.g. Delete Page 3 or Page 8 of 31 October 2026) */}
                {isAdmin && showPageDeletePicker && activeModalCard && (() => {
                  const targetDate = activeModalCard.editionDate;
                  const targetEdition = editionsByDate.get(targetDate);
                  const dateTopics = targetEdition?.topics || [];

                  return (
                    <div className="bg-rose-950/30 border-b border-rose-500/40 px-5 py-3 space-y-2 shrink-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                          <Trash2 className="w-3.5 h-3.5" />
                          Select Page Number(s) to Delete from{" "}
                          <span className="text-white">
                            {formatReadableDate(targetDate, "en")}
                          </span>{" "}
                          (e.g. Page 3, Page 8):
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={
                              pageDeleteBusy || selectedPagesToDelete.length === 0
                            }
                            onClick={() =>
                              void handleDeletePagesForDate({
                                editionDate: targetDate,
                                pageNumbers: selectedPagesToDelete,
                              })
                            }
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 disabled:opacity-40 text-xs font-bold text-slate-950 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            {pageDeleteBusy
                              ? "Deleting..."
                              : `Delete Selected Page(s) (${
                                  selectedPagesToDelete.length > 0
                                    ? selectedPagesToDelete
                                        .sort((a, b) => a - b)
                                        .map((p) => `#${p}`)
                                        .join(", ")
                                    : "0"
                                })`}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowPageDeletePicker(false);
                              setSelectedPagesToDelete([]);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                          >
                            Close
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {dateTopics.map((t, idx) => {
                          const pNum = idx + 1;
                          const isChecked = selectedPagesToDelete.includes(pNum);
                          return (
                            <button
                              key={t.id || pNum}
                              type="button"
                              onClick={() =>
                                setSelectedPagesToDelete((prev) =>
                                  prev.includes(pNum)
                                    ? prev.filter((x) => x !== pNum)
                                    : [...prev, pNum]
                                )
                              }
                              title={`Page ${pNum}: ${t.headlineEn}`}
                              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                                isChecked
                                  ? "bg-rose-500 text-slate-950 border-rose-300"
                                  : "bg-slate-900 text-slate-200 border-slate-700 hover:border-rose-400"
                              }`}
                            >
                              <span>Page {pNum}</span>
                              <span className="text-[10px] font-sans font-normal opacity-85 max-w-[120px] truncate">
                                ({t.headlineEn.slice(0, 18)}...)
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {!activeModalCard ? (
                  <div className="p-10 m-auto text-center space-y-3 max-w-md">
                    <CalendarIcon className="w-10 h-10 text-amber-400 mx-auto" />
                    <h3 className="text-base font-bold text-white">
                      {modalDateFilter !== "all"
                        ? `No Stored Cards Yet for ${formatReadableDate(modalDateFilter, lang)}`
                        : `No Cards Match This Category Filter`}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {modalDateFilter !== "all"
                        ? isAdmin
                          ? "You can view all stored dates in this month, let the AI Agent collect topics, or Upload your own Current Affairs & Question for this date."
                          : "Current Affairs for this specific date has not been published yet. Click below to view all published Current Affairs cards for this month."
                        : "Switch the category filter back to 'All 10 Categories' to see all cards."}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setModalDateFilter("all");
                          setModalCategoryFilter("all");
                          setFloatingCardIdx(0);
                        }}
                        className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white cursor-pointer"
                      >
                        Show Whole Month ({formatReadableMonth(modalMonthKey, "en")})
                      </button>

                      {isAdmin && modalDateFilter !== "all" && modalDateFilter <= todayIso && (
                        <>
                          <button
                            type="button"
                            disabled={agentBusy}
                            onClick={() => void handleRunAgentForDate(modalDateFilter)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-slate-950 cursor-pointer"
                          >
                            <Bot className="w-4 h-4" />
                            {agentBusy
                              ? "Collecting Topics..."
                              : `Collect Topics for ${formatReadableDate(modalDateFilter, "en").replace(/\s*\(.*\)$/, "")}`}
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowModalDateUpload(true)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-xs font-bold text-slate-950 cursor-pointer"
                          >
                            <Upload className="w-4 h-4" />
                            Upload CA for {modalDateFilter}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    key={`${activeModalCard.topic.id}-${cardAnimDirection}`}
                    className="p-3.5 sm:p-6 overflow-y-auto space-y-3.5 sm:space-y-4 flex-1 min-h-0 transition-all duration-300 ease-out"
                  >
                    {/* Top Metadata Bar on the Card: PROMINENT HUMAN-READABLE DATE + PAGE NUMBER + ADMIN PAGE DELETE / UPLOAD */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-[11px] sm:text-xs font-bold text-emerald-300">
                          📅 {formatReadableDate(activeModalCard.editionDate, lang)}
                        </span>
                        <span className="px-2 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[11px] sm:text-xs font-mono font-bold text-amber-300">
                          Page {activeModalCard.pageNumberInDate} of {activeModalCard.totalPagesInDate}
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-[11px] sm:text-xs font-bold text-sky-300 uppercase tracking-wider">
                          {activeModalCard.topic.category}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span className="text-[11px] text-slate-400">
                          Source: {activeModalCard.topic.sourceTag}
                        </span>

                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              disabled={pageDeleteBusy}
                              onClick={() =>
                                void handleDeletePagesForDate({
                                  editionDate: activeModalCard.editionDate,
                                  topicId: activeModalCard.topic.id,
                                  pageNumbers: [activeModalCard.pageNumberInDate],
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 border border-rose-500/50 text-[11px] font-bold text-rose-300 cursor-pointer"
                              title={`Delete Page ${activeModalCard.pageNumberInDate} from ${activeModalCard.editionDate}`}
                            >
                              <Trash2 className="w-3 h-3" />
                              Del Page {activeModalCard.pageNumberInDate}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setShowPageDeletePicker((prev) => !prev)
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-rose-200 cursor-pointer"
                              title="Pick specific page numbers (e.g. Page 3, Page 8) to delete from this date"
                            >
                              Pages...
                            </button>

                            <button
                              type="button"
                              onClick={() => setShowModalDateUpload((prev) => !prev)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/35 border border-sky-500/50 text-[11px] font-bold text-sky-300 cursor-pointer"
                              title={`Upload CA file or add question to ${activeModalCard.editionDate}`}
                            >
                              <Upload className="w-3 h-3" />
                              + Upload CA
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Topic Headline */}
                    <div className="space-y-1">
                      <h2 className="text-base sm:text-lg lg:text-xl font-bold text-white leading-snug">
                        {lang === "bn"
                          ? activeModalCard.topic.headlineBn
                          : activeModalCard.topic.headlineEn}
                      </h2>
                      {lang === "bn" && (
                        <div className="text-xs text-slate-400">
                          {activeModalCard.topic.headlineEn}
                        </div>
                      )}
                    </div>

                    {/* Why in News Box */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 sm:p-4 text-xs lg:text-sm text-slate-200 leading-relaxed">
                      <strong className="text-emerald-400">
                        {lang === "bn" ? "সংবাদে কেন (Why in News): " : "Why in News: "}
                      </strong>
                      {lang === "bn"
                        ? activeModalCard.topic.whyInNewsBn
                        : activeModalCard.topic.whyInNewsEn}
                    </div>

                    {/* To-The-Point Exam Facts */}
                    <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 sm:p-5 space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        {lang === "bn"
                          ? "পরীক্ষা-কেন্দ্রিক মূল তথ্য (To-The-Point Exam Facts — WBPSC Prelims & Mains)"
                          : "To-The-Point Exam Facts (WBPSC Prelims & Mains)"}
                      </h3>
                      <ul className="space-y-2 text-xs lg:text-sm text-slate-100 leading-relaxed pl-5 list-disc marker:text-emerald-400">
                        {(lang === "bn" && activeModalCard.topic.examPointsBn?.length
                          ? activeModalCard.topic.examPointsBn
                          : activeModalCard.topic.examPointsEn
                        ).map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Static GK Hook & Exam Hall Trap */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                      <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-3.5 sm:p-4 text-xs lg:text-sm text-sky-100 leading-relaxed">
                        <div className="font-bold text-sky-300 mb-1 flex items-center gap-1.5">
                          <BookOpen className="w-4 h-4" />
                          {lang === "bn"
                            ? "স্ট্যাটিক জিকে সিলেবাস সংযোগ"
                            : "Static GK Syllabus Hook"}
                        </div>
                        {lang === "bn"
                          ? activeModalCard.topic.staticGkLinkBn
                          : activeModalCard.topic.staticGkLinkEn}
                      </div>

                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 sm:p-4 text-xs lg:text-sm text-amber-100 leading-relaxed">
                        <div className="font-bold text-amber-300 mb-1 flex items-center gap-1.5">
                          <ShieldAlert className="w-4 h-4" />
                          {lang === "bn"
                            ? "পরীক্ষার হলে সম্ভাব্য ভুল (Exam Hall Trap)"
                            : "Exam Hall Confuser / Trap"}
                        </div>
                        {lang === "bn"
                          ? activeModalCard.topic.examTrapBn
                          : activeModalCard.topic.examTrapEn}
                      </div>
                    </div>
                  </div>
                )}

                {/* Modal Footer: Compact Single-Row on Mobile (Dropdown Page Selector) + Page Buttons on Desktop */}
                <div className="flex items-center justify-between gap-2 sm:gap-4 px-3 py-2.5 sm:px-6 sm:py-3.5 border-t border-slate-800 bg-slate-950/95 shrink-0">
                  <button
                    type="button"
                    disabled={modalDeckCards.length === 0}
                    onClick={goPrevCard}
                    className="inline-flex items-center gap-1 sm:gap-2 px-3 py-2 sm:px-4 sm:py-2.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 rounded-xl transition-colors cursor-pointer shrink-0"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">Previous Topic</span>
                    <span className="sm:hidden">Prev</span>
                  </button>

                  {/* MOBILE Page Selector (< sm): Single Compact Dropdown so Page Buttons NEVER wrap or hide content */}
                  <div className="flex sm:hidden items-center justify-center flex-1 min-w-0">
                    {modalDeckCards.length > 0 && (
                      <select
                        value={floatingCardIdx}
                        onChange={(e) => setFloatingCardIdx(Number(e.target.value))}
                        aria-label="Select Current Affairs Page"
                        className="w-full max-w-[190px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-emerald-300 cursor-pointer truncate"
                      >
                        {modalDeckCards.map((c, idx) => (
                          <option key={`${c.topic.id}-mob-${idx}`} value={idx}>
                            Page {c.pageNumberInDate}/{c.totalPagesInDate} (#{idx + 1}) · {c.topic.headlineEn.slice(0, 22)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* DESKTOP / TABLET Page Number Buttons (>= sm) */}
                  <div className="hidden sm:flex flex-wrap items-center justify-center gap-2 min-w-0">
                    {modalDeckCards.length <= 16 ? (
                      <div className="flex items-center gap-1.5 overflow-x-auto max-w-md py-0.5">
                        {modalDeckCards.map((c, idx) => (
                          <button
                            key={`${c.topic.id}-${idx}`}
                            type="button"
                            onClick={() => setFloatingCardIdx(idx)}
                            className={`w-6 h-6 rounded-md text-[11px] font-mono font-bold transition-all cursor-pointer shrink-0 ${
                              idx === floatingCardIdx
                                ? "bg-emerald-500 text-slate-950 scale-105"
                                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                            }`}
                            title={`Page ${c.pageNumberInDate} (${formatReadableDate(c.editionDate, "en")}): ${c.topic.headlineEn}`}
                          >
                            {idx + 1}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 font-mono">Jump to Card:</span>
                        <select
                          value={floatingCardIdx}
                          onChange={(e) => setFloatingCardIdx(Number(e.target.value))}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-emerald-300 max-w-[260px] cursor-pointer"
                        >
                          {modalDeckCards.map((c, idx) => (
                            <option key={`${c.topic.id}-${idx}`} value={idx}>
                              #{idx + 1} (Page {c.pageNumberInDate}) · {c.editionDate} · {c.topic.headlineEn.slice(0, 28)}...
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={modalDeckCards.length === 0}
                    onClick={goNextCard}
                    className="inline-flex items-center gap-1 sm:gap-2 px-3 py-2 sm:px-4 sm:py-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 rounded-xl transition-colors cursor-pointer shadow-sm shrink-0"
                  >
                    <span className="hidden sm:inline">Next Topic</span>
                    <span className="sm:hidden">Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
