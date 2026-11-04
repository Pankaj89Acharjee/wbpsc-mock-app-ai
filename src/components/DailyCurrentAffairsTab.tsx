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
  const [showModalCalendar, setShowModalCalendar] = useState<boolean>(true);
  const [floatingCardIdx, setFloatingCardIdx] = useState<number>(0);
  const [cardAnimDirection, setCardAnimDirection] = useState<"next" | "prev">("next");

  // =========================================================================
  // AGENT MANAGEMENT CONSOLE STATE
  // =========================================================================
  const [agentBusy, setAgentBusy] = useState<boolean>(false);
  const [backfillBusy, setBackfillBusy] = useState<boolean>(false);
  const [backfillMonthKey, setBackfillMonthKey] = useState<string>("2026-10");
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
    "give me today's current affairs for wbpsc clerkship exam (Top 10-12 GKToday, AffairsCloud, PIB, The Hindu & West Bengal Special)"
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

  /**
   * Helper to open the Floating Animated Card Modal for a given month (and optional date).
   * By default (`dateFilter = "all"`), it loads the WHOLE month's Current Affairs into the modal!
   */
  const openFloatingDeckForMonth = (monthKey: string, dateFilter: string = "all") => {
    setModalMonthKey(monthKey);
    setModalDateFilter(dateFilter);
    setModalCategoryFilter("all");
    setFloatingCardIdx(0);
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
    try {
      const res = await api<{
        editionId: string;
        editionDate: string;
        topicsCount: number;
        mcqsCount: number;
        addedTopicsCount?: number;
        alreadyComplete?: boolean;
      }>("/current-affairs/agent-run", {
        method: "POST",
        body: {
          editionDate: targetDate,
          sourceUrl: agentSourceUrl,
          focusTopics: agentFocusTopics,
          targetTopicCount: 12,
          forceRegenerate,
        },
      });
      await loadArchive();
      await loadVectorStore();
      openFloatingDeckForMonth(res.editionDate.slice(0, 7), res.editionDate);
      if (res.alreadyComplete) {
        onNotify?.(
          "info",
          `${formatReadableDate(res.editionDate, "en")} already has ${res.topicsCount}/12 Current Affairs topics stored.`
        );
      } else {
        const addedCount = res.addedTopicsCount ?? res.topicsCount;
        onNotify?.(
          "success",
          !forceRegenerate && existingCount > 0
            ? `Google Search Grounded + Vector DB Verified: Added ${addedCount} unique topics (now ${res.topicsCount} topics) for ${formatReadableDate(res.editionDate, "en")}.`
            : `Google Search Grounded + Vector DB Indexed: Collected ${res.topicsCount} unique topics & ${res.mcqsCount} MCQs for ${formatReadableDate(res.editionDate, "en")}.`
        );
      }
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
        uploadedDocsCount = 1;
        totalChunksCreated = res.chunksCount;
      }

      setSelectedUploadFiles([]);
      setUploadTitle("");
      setUploadTextHint("");
      await loadVectorStore();
      onNotify?.(
        "success",
        `Indexed ${uploadedDocsCount} resource(s) (${totalChunksCreated} bilingual vector chunks) into Vector DB via gemini-embedding-2-preview!`
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
        results: CaVectorChunkDto[];
      }>("/current-affairs/vector-store/search", {
        method: "POST",
        body: {
          query: vectorSearchQuery,
          scopeType: vectorSearchScopeFilter,
          category: vectorSearchCategoryFilter,
          topK: 10,
        },
      });
      setVectorSearchResults(res.results || []);
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
            <div class="topic-meta">${cat} · Date: ${formatReadableDate(editionDate, "en")} (${editionDate}) · Source: ${t.sourceTag}</div>
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
        <p><strong>Q${idx + 1} [${m.category} · ${formatReadableDate(editionDate, "en")}]:</strong> ${m.stem.en}<br/><span class="bn-text">${m.stem.bn}</span></p>
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
                Present Date (Today):{" "}
                <strong className="text-white">{formatReadableDate(todayIso, lang)}</strong>
                {todayEdition ? (
                  <span className="ml-2 text-emerald-400 font-semibold">
                    ({todayEdition.topics.length}/12 Topics Stored)
                  </span>
                ) : null}
              </span>
            </div>

            <h1 className="text-xl font-bold text-white">
              {lang === "bn"
                ? "কারেন্ট অ্যাফেয়ার্স আর্কাইভ (নভেম্বর ২০২৫ – নভেম্বর ২০২৬)"
                : "Daily & Previous 1-Year Current Affairs Archive (Nov 2025 – Nov 2026)"}
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === "bn"
                ? "যেকোনো মাসের কার্ডে ক্লিক করলে সেই মাসের সম্পূর্ণ কারেন্ট অ্যাফেয়ার্স ফ্লোটিং অ্যানিমেটেড কার্ড মোডালে খুলে যাবে। মোডালের ভেতরে থাকা ক্যালেন্ডার থেকে আপনি নির্দিষ্ট যেকোনো তারিখের কারেন্ট অ্যাফেয়ার্সও দেখতে পারবেন।"
                : "Click any Month Card below to open that entire month's Current Affairs inside the Floating Animated Card Deck Modal. Inside the modal, use the built-in Calendar to view all dates of that month or pick any specific date."}
            </p>
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
              Open Today&apos;s Floating Card Deck ({todayIso})
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
              Download Categorized PDF ({monthsArchive.length} Months)
            </button>
          </div>
        </div>

        {/* 4 Summary Metrics Cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Current &amp; Past 1-Year Archive (No Future Dates)</span>
                <CalendarIcon className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {monthsArchive.length} Months Ready
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
                <span>Classified Exam Topics</span>
                <Layers className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-xl font-bold font-mono text-sky-300">
                {stats.totalTopicsCount} Exam Topics
              </div>
              <div className="text-[11px] text-slate-400">
                <span>{stats.totalExamPointersCount} Bullet Pointers</span>
                <span aria-hidden="true"> · </span>
                <span className="text-sky-400">10 WBPSC Categories</span>
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{isAdmin ? "Daily Auto-Collector Status" : "PYQ-Pattern Practice MCQs"}</span>
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-xl font-bold font-mono text-amber-300">
                {isAdmin ? "12 Topics / Day" : `${stats.totalMcqsCount} Practice MCQs`}
              </div>
              <div className="text-[11px] text-slate-400">
                <span>Latest Edition: </span>
                <span className="text-emerald-300 font-semibold">
                  {formatReadableDate(stats.latestDate || todayIso, "en")}
                </span>
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Grounded Sources &amp; Downloads</span>
                <Download className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {stats.totalDownloadsCount} PDF Downloads
              </div>
              <div className="text-[11px] text-purple-300">
                GKToday · PYQArena (The Hindu) · PIB
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
                ? `মাসিক কারেন্ট অ্যাফেয়ার্স ক্যাপসুল (${monthsArchive.length} মাস: নভেম্বর ২০২৫ – নভেম্বর ২০২৬)`
                : `Current & Previous 1-Year Current Affairs by Month (${monthsArchive.length} Months: Nov 2025 – Nov 2026)`}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              <strong>Click on any Month Card below</strong> to open that whole month&apos;s Current Affairs in the{" "}
              <span className="text-amber-300 font-semibold">Floating Animated Card Modal</span>. Inside the modal, you can view the entire month or pick any individual date on the calendar.
            </p>
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
          SECTION 3: CLEAN, PLAIN-ENGLISH AGENT MANAGEMENT CONSOLE (ADMIN ONLY)
          Aspirants ONLY consume generated Current Affairs and never see Agent controls.
      ==================================================================== */}
      {isAdmin && (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              Current Affairs Management Console
            </div>
            <h2 className="text-base font-bold text-white">
              Manage Your Assistant Agents (4 Manual + 1 Automatic)
            </h2>
            <p className="text-xs text-slate-400">
              <strong className="text-white">5 Agents</strong> for Current Affairs: <strong className="text-emerald-300">4 Manual Orchestrator Agents</strong> (managed below) and <strong className="text-amber-300">1 Autonomous Sub-Agent</strong>
            </p>
          </div>
        </div>

        {/* 5-Agent Inventory Summary Strip */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 grid grid-cols-1 md:grid-cols-5 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-emerald-500/30">
            <div className="font-bold text-emerald-300">Agent 1: Daily Collector</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Auto-runs daily for Today, i.e., ({todayIso}) · Has Pause &amp; Manual Refresh button below.
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-sky-500/30">
            <div className="font-bold text-sky-300">Agent 2: Batch Backfiller</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Fills continuous 10-day batches or all 30/31 days of any month with zero gaps.
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-amber-500/30">
            <div className="font-bold text-amber-300">Agent 3: Month Classifier</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Groups topics into 10 WBPSC categories &amp; compiles Monthly PDF Capsules.
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-purple-500/30">
            <div className="font-bold text-purple-300">Agent 4: Date Recovery</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Manual fallback if an automatic run ever fails on a specific past date.
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-700">
            <div className="font-bold text-slate-200">Agent 5: Bilingual &amp; MCQ Generator</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              <span className="text-emerald-400 font-semibold">100% Automatic Internal Pipeline</span> — adds Static GK, Traps &amp; বাংলা অনুবাদ.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* CARD 1: Daily Automatic Collection Scheduler */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  1. Daily Collector Agent
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    scheduler?.enabled
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  }`}
                >
                  {scheduler?.enabled ? "AUTO-RUN: ON (Everyday)" : "AUTO-RUN: PAUSED"}
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/90 border border-slate-800/80 rounded-lg p-3">
                <strong className="text-white">What this does:</strong> Runs{" "}
                <strong>automatically every day</strong>. Grounded on{" "}
                <span className="text-emerald-300">GK Today</span>,{" "}
                <span className="text-emerald-300">PYQArena (The Hindu)</span>,{" "}
                <span className="text-emerald-300">PIB</span>, and{" "}
                <span className="text-emerald-300">WB State Gazette</span>, it collects{" "}
                <strong>12 PSCWB exam-oriented topics</strong> for today&apos;s date (
                <strong className="text-white">{formatReadableDate(todayIso, "en")}</strong>) including West Bengal schemes, GI tags, Constitutional articles, and Static GK.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={toggleSchedulerBusy}
                onClick={() => void handleToggleAutoScheduler()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
              >
                <Power className="w-3.5 h-3.5 text-emerald-400" />
                {scheduler?.enabled ? "Pause Daily Auto-Run" : "Turn ON Daily Auto-Run"}
              </button>

              {(() => {
                const todayCount = editionsByDate.get(todayIso)?.topics.length || 0;
                const isTodayComplete = todayCount >= 12;
                const todayRemaining = Math.max(0, 12 - todayCount);
                return (
                  <button
                    type="button"
                    disabled={agentBusy || isTodayComplete}
                    onClick={() => void handleRunAgentForDate(todayIso)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg ${
                      isTodayComplete
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-not-allowed"
                        : "bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 cursor-pointer"
                    }`}
                  >
                    {agentBusy ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Collecting Today&apos;s Topics...
                      </>
                    ) : isTodayComplete ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Today&apos;s 12/12 Topics Complete
                      </>
                    ) : todayCount > 0 ? (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        Generate Remaining {todayRemaining} Topics ({todayCount}/12 Stored)
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        Collect Today&apos;s 12 Topics ({formatReadableDate(todayIso, "en").replace(/\s*\(.*\)$/, "")})
                      </>
                    )}
                  </button>
                );
              })()}
            </div>
          </div>

          {/* CARD 2: Month-Wise Batch Historical Backfill Agent */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                  <CalendarIcon className="w-4 h-4" />
                  2. Month-Wise Backfiller Agent
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                  Continously Updates Previous Days
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/90 border border-slate-800/80 rounded-lg p-3">
                <strong className="text-white">How it works:</strong> Instead of shallow top-page scraping or repeating topics across dates, our crawler follows nested <code className="text-sky-300">&lt;a href&gt;</code> sub-pages on GKToday &amp; PYQArena alongside Google Search Grounding for that exact date, and passes all previously stored headlines into a strict <strong>3-Layer Anti-Duplication Filter</strong> so no two dates ever share the same Current Affairs topic!
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={backfillMonthKey}
                  onChange={(e) => setBackfillMonthKey(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white cursor-pointer"
                >
                  {availableMonthKeys.map((mk) => (
                    <option key={mk} value={mk}>
                      {formatReadableMonth(mk, lang)} ({mk})
                    </option>
                  ))}
                </select>

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
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-sky-300 cursor-pointer"
                >
                  <option value="full-month">Full Month (All 30/31 Days)</option>
                  <option value="days-1-10">Batch 1: Days 01 – 10</option>
                  <option value="days-11-20">Batch 2: Days 11 – 20</option>
                  <option value="days-21-end">Batch 3: Days 21 – End of Month</option>
                </select>
              </div>

              <button
                type="button"
                disabled={backfillBusy}
                onClick={() => void handleAutoBackfillPastDays(backfillMonthKey, backfillBatchRange)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-sky-400 hover:bg-sky-300 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
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
          </div>

          {/* CARD 3: End-of-Month Category Classifier & Monthly PDF Agent */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  3. Monthly Category Classifier &amp; Capsule Agent
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  10 WBPSC Categories
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/90 border border-slate-800/80 rounded-lg p-3">
                <strong className="text-white">What this does in simple words:</strong> Selects any past/current month, synthesizes high-probability PSCWB exam events (with extra weight on <em>West Bengal Special, Polity, Economy, Science, GI Tags, Sports &amp; Awards</em>), and organizes them into 10 subject buckets for the Monthly PDF Capsule.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <select
                value={classifierSelectedMonth}
                onChange={(e) => setClassifierSelectedMonth(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-bold text-white cursor-pointer"
              >
                {availableMonthKeys.map((mk) => (
                  <option key={mk} value={mk}>
                    {formatReadableMonth(mk, lang)} ({mk})
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={classifierBusyMonth !== null}
                onClick={() => void handleRunMonthlyClassifierAgent(classifierSelectedMonth)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
              >
                {classifierBusyMonth === classifierSelectedMonth ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Classifying {formatReadableMonth(classifierSelectedMonth, "en")}...
                  </>
                ) : (
                  <>
                    <Bot className="w-3.5 h-3.5" />
                    Build 12-Topic Monthly Capsule
                  </>
                )}
              </button>
            </div>
          </div>

          {/* CARD 4: Specific Past Date Manual Recovery Agent (With Future-Date Lock) */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4" />
                  4. Single-Date Manual Recovery Agent (Fallback)
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  Manual Retry · Future Locked
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/90 border border-slate-800/80 rounded-lg p-3">
                <strong className="text-white">When to use this manual option:</strong> If an automatic collection ever fails for a specific date or you want to re-generate a particular date with fresh PSCWB topics (for example, <em>27 October 2026</em> or <em>15 September 2026</em>), pick that date here or inside the Calendar Modal and click Collect.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <input
                type="date"
                max={todayIso}
                value={agentEditionDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setAgentEditionDate(val > todayIso ? todayIso : val);
                }}
                className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
              />

              {(() => {
                const pickedCount = editionsByDate.get(agentEditionDate)?.topics.length || 0;
                const isPickedComplete = pickedCount >= 12;
                const pickedRemaining = Math.max(0, 12 - pickedCount);
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={agentBusy || isPickedComplete}
                      onClick={() => void handleRunAgentForDate(agentEditionDate, false)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg ${
                        isPickedComplete
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-not-allowed"
                          : "bg-purple-400 hover:bg-purple-300 disabled:opacity-50 text-slate-950 cursor-pointer"
                      }`}
                    >
                      {agentBusy ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Grounding from Google Search...
                        </>
                      ) : isPickedComplete ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          12/12 Topics Stored ({formatReadableDate(agentEditionDate, "en").replace(/\s*\(.*\)$/, "")})
                        </>
                      ) : pickedCount > 0 ? (
                        <>
                          <Bot className="w-3.5 h-3.5" />
                          Ground Remaining {pickedRemaining} Topics ({pickedCount}/12 Stored)
                        </>
                      ) : (
                        <>
                          <Bot className="w-3.5 h-3.5" />
                          Ground 12 Topics via Google Search ({formatReadableDate(agentEditionDate, "en").replace(/\s*\(.*\)$/, "")})
                        </>
                      )}
                    </button>

                    {pickedCount > 0 && (
                      <button
                        type="button"
                        disabled={agentBusy}
                        onClick={() => void handleRunAgentForDate(agentEditionDate, true)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/50 text-sky-200 disabled:opacity-50 cursor-pointer"
                        title="Discard non-custom cards on this date and re-ground all 12 topics live from Google Search"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${agentBusy ? "animate-spin" : ""}`} />
                        Force Re-Ground (Google Search)
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ====================================================================
          SECTION 3B: MULTI-FORMAT CURRENT AFFAIRS UPLOAD & VECTOR DB KNOWLEDGE STORE (ADMIN ONLY)
          - Supports PDF (.pdf), Word (.docx/.doc/.txt), and Image (.png/.jpg/.webp)
          - Scope: Single Day | Multiple Days (Date Range) | Multiple Months | Yearly Digest
          - Unlimited uploads for the same day/month/year from different resources!
          - Phase-2 Ready for WBPSC Clerkship (100 Marks) & WBCS Prelims (200 Marks) Test Series
      ==================================================================== */}
      {isAdmin && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
            <div className="space-y-1 max-w-3xl">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-400 uppercase tracking-wider">
                <Database className="w-4 h-4" />
                Multi-Source Current Affairs Vector DB Knowledge Store (Admin Only)
              </div>
              <h2 className="text-base font-bold text-white">
                Upload PDF / Word / Image Current Affairs (Single Day, Multi-Day, Multi-Month, or Yearly)
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Upload <strong className="text-white">as many Current Affairs files as you want</strong> for the{" "}
                <strong className="text-emerald-300">same day, same month, multiple months, or full year</strong> from different resources (e.g.,{" "}
                <em>GKToday PDF, Achievers Bengali Magazine, VisionIAS / PIB Word Doc, Newspaper Clipping Image</em>). Every file is chunked and indexed with{" "}
                <code className="text-sky-300">gemini-embedding-2-preview</code> vectors.
              </p>
            </div>

            {/* Phase-2 Exam Blueprint Integration Badge */}
            <div className="bg-slate-950 border border-amber-500/30 rounded-xl px-3.5 py-2.5 max-w-sm">
              <div className="text-[11px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Phase-2 Test Series Pipeline Ready
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                Vector chunks stored here are tagged for generating{" "}
                <strong className="text-white">WBPSC Clerkship (100 Marks)</strong> &amp;{" "}
                <strong className="text-white">WBCS Prelims (200 Marks)</strong> CA questions and full-length mock test series.
              </p>
            </div>
          </div>

          {/* Vector DB Live Metrics Strip */}
          {vectorStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <div className="text-[11px] text-slate-400">Uploaded CA Resources</div>
                <div className="text-lg font-bold font-mono text-white mt-0.5">
                  {vectorStats.totalDocumentsCount} Files
                </div>
                <div className="text-[10px] text-emerald-400">
                  {vectorStats.uniquePublishersCount} Distinct Publishers / Sources
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <div className="text-[11px] text-slate-400">Vector-Indexed Chunks</div>
                <div className="text-lg font-bold font-mono text-sky-300 mt-0.5">
                  {vectorStats.totalChunksIndexed} Chunks
                </div>
                <div className="text-[10px] text-slate-400">
                  gemini-embedding-2-preview (128d)
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <div className="text-[11px] text-slate-400">Formats Stored</div>
                <div className="text-xs font-mono font-bold text-amber-300 mt-1 space-x-2">
                  <span>PDF: {vectorStats.byFormat?.PDF || 0}</span>
                  <span>·</span>
                  <span>WORD: {vectorStats.byFormat?.WORD || 0}</span>
                  <span>·</span>
                  <span>IMAGE: {vectorStats.byFormat?.IMAGE || 0}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Multimodal OCR + DOCX XML Parser
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <div className="text-[11px] text-slate-400">Coverage Scopes</div>
                <div className="text-[11px] font-mono text-purple-300 mt-1">
                  Day: {vectorStats.byScope?.single_day || 0} · Multi-Day:{" "}
                  {vectorStats.byScope?.date_range || 0} · Month:{" "}
                  {vectorStats.byScope?.multi_month || 0} · Yearly:{" "}
                  {vectorStats.byScope?.yearly || 0}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Unlimited uploads per day/month/year
                </div>
              </div>
            </div>
          )}

          {/* Upload Form + Vector Store Explorer Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* LEFT 6 COLS: Multi-Format Upload & Scope Configuration */}
            <div className="lg:col-span-6 bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <Upload className="w-4 h-4" />
                  1. Ingest New PDF / Word / Image into Vector DB
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  Multi-File &amp; Multi-Source Enabled
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Document Title (Optional)
                  </label>
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="e.g., Achievers Oct 2026 Capsule"
                    className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Resource / Publisher Name
                  </label>
                  <input
                    type="text"
                    value={uploadPublisher}
                    onChange={(e) => setUploadPublisher(e.target.value)}
                    placeholder="e.g., GKToday, Achievers, VisionIAS, PIB"
                    className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                  />
                </div>
              </div>

              {/* Scope Type Selector */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                  Select Time Coverage Scope of Uploaded File(s)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { id: "single_day", label: "Single Day" },
                      { id: "date_range", label: "Multiple Days" },
                      { id: "multi_month", label: "Month(s)" },
                      { id: "yearly", label: "Yearly / Annual" },
                    ] as const
                  ).map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setUploadScopeType(sc.id)}
                      className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        uploadScopeType === sc.id
                          ? "bg-sky-500 text-slate-950 border-sky-400"
                          : "bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Scope Inputs based on `uploadScopeType` */}
              {uploadScopeType === "single_day" && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-300 font-medium">
                    Select Date for Single-Day CA File:
                  </span>
                  <input
                    type="date"
                    max={todayIso}
                    value={uploadSingleDate}
                    onChange={(e) => setUploadSingleDate(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                  />
                </div>
              )}

              {uploadScopeType === "date_range" && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      From Date
                    </label>
                    <input
                      type="date"
                      max={todayIso}
                      value={uploadStartDate}
                      onChange={(e) => setUploadStartDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      To Date
                    </label>
                    <input
                      type="date"
                      max={todayIso}
                      value={uploadEndDate}
                      onChange={(e) => setUploadEndDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {uploadScopeType === "multi_month" && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-300">
                    <span>Click to select one or multiple months covered by this PDF/Doc/Image:</span>
                    <span className="font-mono text-sky-300">
                      {uploadSelectedMonths.length} selected
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-[90px] overflow-y-auto">
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
                              : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
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
                <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-300 font-medium">
                    Select Annual / Yearly Window:
                  </span>
                  <select
                    value={uploadTargetYear}
                    onChange={(e) => setUploadTargetYear(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                  >
                    <option value="2025-2026">Nov 2025 – Nov 2026 (Clerkship 1-Year)</option>
                    <option value="2026">Full Year 2026 Annual Compendium</option>
                    <option value="2025">Full Year 2025 Annual Compendium</option>
                  </select>
                </div>
              )}

              {/* File Picker Input (PDF, Word .docx/.doc/.txt, Image .png/.jpg/.webp) */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-300">
                  Choose File(s) — PDF (<code>.pdf</code>), Word (<code>.docx</code>, <code>.doc</code>, <code>.txt</code>), or Image (<code>.png</code>, <code>.jpg</code>, <code>.webp</code>)
                </label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    setSelectedUploadFiles(files);
                  }}
                  className="block w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-sky-500 file:text-slate-950 hover:file:bg-sky-400 cursor-pointer bg-slate-900 border border-slate-700 rounded-lg p-1.5"
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

              {/* Optional Text / Key Highlights Paste Box */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Optional Raw Text / Key Highlights to Include in Vector Chunks
                </label>
                <textarea
                  rows={2}
                  value={uploadTextHint}
                  onChange={(e) => setUploadTextHint(e.target.value)}
                  placeholder="Optional: Paste additional Current Affairs notes, bullet points, or leave blank to extract directly from the uploaded PDF/Word/Image file..."
                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                />
              </div>

              {/* Target Exam Blueprint Tags (Phase 2 Readiness) */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-slate-400 font-semibold">Exam Store Tags:</span>
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
                        className={`px-2 py-0.5 rounded border cursor-pointer ${
                          active
                            ? "bg-amber-500/20 border-amber-500/50 text-amber-200 font-semibold"
                            : "bg-slate-900 border-slate-800 text-slate-400"
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
                      Chunking &amp; Embedding into Vector DB...
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      Upload &amp; Index into Vector DB
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* RIGHT 6 COLS: Uploaded Vector Documents List + Semantic Vector Search */}
            <div className="lg:col-span-6 bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3.5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                    <Search className="w-4 h-4" />
                    2. Vector DB Repository &amp; Semantic Cosine Search
                  </h3>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {vectorDocs.length} Multi-Source Docs Stored
                  </span>
                </div>

                {/* Semantic Search Bar */}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={vectorSearchQuery}
                    onChange={(e) => setVectorSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSearchVectorStore();
                    }}
                    placeholder="Semantic vector search (e.g., Kanyashree, ISRO Gaganyaan, 16th Finance Commission)..."
                    className="flex-1 min-w-[180px] px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                  />
                  <select
                    value={vectorSearchScopeFilter}
                    onChange={(e) => setVectorSearchScopeFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 cursor-pointer"
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
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-sky-400 hover:bg-sky-300 text-slate-950 rounded-lg cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5" />
                    {vectorSearchBusy ? "Searching..." : "Search Vectors"}
                  </button>
                  {vectorSearchResults !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        setVectorSearchResults(null);
                        setVectorSearchQuery("");
                      }}
                      className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Semantic Search Results (when active) */}
                {vectorSearchResults !== null ? (
                  <div className="space-y-2 max-h-[270px] overflow-y-auto pr-1">
                    <div className="text-[11px] font-semibold text-sky-300">
                      Top Vector Matches ({vectorSearchResults.length} Chunks):
                    </div>
                    {vectorSearchResults.map((ch) => (
                      <div
                        key={ch.id}
                        className="bg-slate-900 border border-sky-500/30 rounded-lg p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-bold text-emerald-300">
                            {ch.category} · {ch.sourcePublisher}
                          </span>
                          <span className="font-mono text-sky-300">
                            Similarity: {Math.round((ch.similarityScore || 0.88) * 100)}%
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
                  /* Stored Multi-Source Documents List */
                  <div className="space-y-2 max-h-[270px] overflow-y-auto pr-1">
                    {vectorDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-start justify-between gap-3"
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
                              {doc.chunksCount} Vector Chunks
                            </span>
                          </div>

                          <div className="text-xs font-bold text-white truncate">
                            {doc.title}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Source: <strong className="text-slate-200">{doc.sourcePublisher}</strong> · File:{" "}
                            <span className="font-mono">{doc.fileName}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {doc.examTags.map((t) => (
                              <span
                                key={t}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleDeleteVectorDocument(doc.id, doc.title)}
                          title="Delete this document and its vector chunks from Vector DB"
                          className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-800 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-400 border-t border-slate-800 pt-2 flex items-center justify-between">
                <span>
                  Embedding Model: <code className="text-sky-300">gemini-embedding-2-preview</code>
                </span>
                <span>
                  Total Indexed Chunks: <strong className="text-white">{vectorChunksPreview.length}</strong>
                </span>
              </div>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-5"
          onClick={() => setFloatingModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-6xl bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] transition-all duration-300"
          >
            {/* Modal Top Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800 bg-slate-950 shrink-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-xs font-mono font-bold text-emerald-300">
                  {modalDeckCards.length > 0
                    ? `Card ${floatingCardIdx + 1} of ${modalDeckCards.length}`
                    : "0 Cards"}
                </span>

                {/* Prominent Human-Readable Month & Date Indicator */}
                <span className="px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <CalendarIcon className="w-3.5 h-3.5" />
                  {modalDateFilter === "all"
                    ? `Showing Whole Month: ${formatReadableMonth(modalMonthKey, lang)} (${storedEditionsInModalMonth.length} Stored ${storedEditionsInModalMonth.length === 1 ? "Date" : "Dates"})`
                    : `Showing Selected Date: ${formatReadableDate(modalDateFilter, lang)}`}
                </span>

                {/* Admin Top-Up Button if Selected Single Date has < 12 Topics */}
                {isAdmin &&
                  modalDateFilter !== "all" &&
                  modalDateFilter <= todayIso &&
                  (() => {
                    const selectedDateCount =
                      editionsByDate.get(modalDateFilter)?.topics.length || 0;
                    const remainingTo12 = Math.max(0, 12 - selectedDateCount);
                    if (selectedDateCount >= 12) {
                      return (
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-xs font-bold text-emerald-300 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          12/12 Topics Complete
                        </span>
                      );
                    }
                     return (
                      <button
                        type="button"
                        disabled={agentBusy}
                        onClick={() => void handleRunAgentForDate(modalDateFilter)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-xs font-bold text-slate-950 cursor-pointer shadow-sm"
                        title={`Generate remaining ${remainingTo12} unique Current Affairs topics for ${modalDateFilter}`}
                      >
                        <Bot className="w-3.5 h-3.5" />
                        {agentBusy
                          ? "Generating..."
                          : selectedDateCount > 0
                            ? `+ Generate Remaining ${remainingTo12} Topics (${selectedDateCount}/12)`
                            : `+ Collect 12 Topics`}
                      </button>
                    );
                  })()}

                {/* Admin Single-Date Delete Button directly inside Modal Header */}
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
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-xs font-bold text-rose-300 cursor-pointer"
                      title={`Delete all pages of ${modalDateFilter}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Whole Date ({modalDateFilter})
                    </button>
                  )}

                {/* Admin Page-Wise Delete Button for Current Page (e.g. Page 3 or Page 8) */}
                {isAdmin && activeModalCard && (
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
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-xs font-bold text-slate-950 cursor-pointer shadow-sm"
                    title={`Delete only Page ${activeModalCard.pageNumberInDate} of ${activeModalCard.editionDate}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {pageDeleteBusy
                      ? "Deleting Page..."
                      : `Delete Page ${activeModalCard.pageNumberInDate} (${activeModalCard.editionDate})`}
                  </button>
                )}

                {/* Admin Upload / Add CA Button for Particular Date directly inside Card Modal */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setShowModalDateUpload((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      showModalDateUpload
                        ? "bg-sky-400 text-slate-950 border-sky-300 shadow-sm"
                        : "bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border-sky-500/40"
                    }`}
                    title="Upload a file (PDF/Word/Image) or add a custom Current Affairs card & MCQ question for this date"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {showModalDateUpload
                      ? "Close Upload Panel"
                      : `+ Upload CA to ${
                          modalDateFilter !== "all"
                            ? modalDateFilter
                            : activeModalCard?.editionDate || todayIso
                        }`}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowModalCalendar((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer border border-slate-700"
                >
                  <CalendarIcon className="w-3.5 h-3.5 text-emerald-400" />
                  {showModalCalendar ? "Hide Calendar Sidebar" : "Show Month & Date Calendar"}
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-slate-950 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download {formatReadableMonth(modalMonthKey, "en")} PDF
                </button>

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

            {/* Modal Main Body: Left Calendar/Month Picker + Right Animated Card Deck */}
            <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
              {/* LEFT SIDEBAR INSIDE MODAL: Month Selector + Interactive Date Calendar */}
              {showModalCalendar && (
                <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-950/80 p-4 overflow-y-auto space-y-4">
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
                </div>
              )}

              {/* RIGHT AREA INSIDE MODAL: Animated Flashcard Content + Page-Wise Delete + Date Upload */}
              <div
                className={`${
                  showModalCalendar ? "lg:col-span-8" : "lg:col-span-12"
                } flex flex-col overflow-hidden`}
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
                    className="p-6 overflow-y-auto space-y-4 flex-1 transition-all duration-300 ease-out"
                  >
                    {/* Top Metadata Bar on the Card: PROMINENT HUMAN-READABLE DATE + PAGE NUMBER + ADMIN PAGE DELETE / UPLOAD */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-xs font-bold text-emerald-300">
                          📅 Date: {formatReadableDate(activeModalCard.editionDate, lang)}
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-xs font-mono font-bold text-amber-300">
                          Page {activeModalCard.pageNumberInDate} of {activeModalCard.totalPagesInDate}
                        </span>
                        <span className="px-3 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-xs font-bold text-sky-300 uppercase tracking-wider">
                          {activeModalCard.topic.category}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
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
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 border border-rose-500/50 text-xs font-bold text-rose-300 cursor-pointer"
                              title={`Delete Page ${activeModalCard.pageNumberInDate} from ${activeModalCard.editionDate}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete Page {activeModalCard.pageNumberInDate}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setShowPageDeletePicker((prev) => !prev)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-rose-200 cursor-pointer"
                              title="Pick specific page numbers (e.g. Page 3, Page 8) to delete from this date"
                            >
                              Delete Specific Pages...
                            </button>

                            <button
                              type="button"
                              onClick={() => setShowModalDateUpload((prev) => !prev)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/35 border border-sky-500/50 text-xs font-bold text-sky-300 cursor-pointer"
                              title={`Upload CA file or add question to ${activeModalCard.editionDate}`}
                            >
                              <Upload className="w-3.5 h-3.5" />
                              + Upload CA
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Topic Headline */}
                    <div className="space-y-1">
                      <h2 className="text-lg lg:text-xl font-bold text-white leading-snug">
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
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs lg:text-sm text-slate-200 leading-relaxed">
                      <strong className="text-emerald-400">
                        {lang === "bn" ? "সংবাদে কেন (Why in News): " : "Why in News: "}
                      </strong>
                      {lang === "bn"
                        ? activeModalCard.topic.whyInNewsBn
                        : activeModalCard.topic.whyInNewsEn}
                    </div>

                    {/* To-The-Point Exam Facts */}
                    <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-5 space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        {lang === "bn"
                          ? "পরীক্ষা-কেন্দ্রিক মূল তথ্য (To-The-Point Exam Facts — WBPSC Prelims & Mains)"
                          : "To-The-Point Exam Facts (WBPSC Prelims & Mains)"}
                      </h3>
                      <ul className="space-y-2.5 text-xs lg:text-sm text-slate-100 leading-relaxed pl-5 list-disc marker:text-emerald-400">
                        {(lang === "bn" && activeModalCard.topic.examPointsBn?.length
                          ? activeModalCard.topic.examPointsBn
                          : activeModalCard.topic.examPointsEn
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
                          ? activeModalCard.topic.staticGkLinkBn
                          : activeModalCard.topic.staticGkLinkEn}
                      </div>

                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-xs lg:text-sm text-amber-100 leading-relaxed">
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

                {/* Modal Footer: Previous / Page Number Buttons (with Page-Wise Delete & Upload) / Next Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-t border-slate-800 bg-slate-950/90 shrink-0">
                  <button
                    type="button"
                    disabled={modalDeckCards.length === 0}
                    onClick={goPrevCard}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous Topic
                  </button>

                  {/* Interactive Page Number Buttons / Selector */}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {modalDeckCards.length <= 16 ? (
                      <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-md">
                        {modalDeckCards.map((c, idx) => (
                          <button
                            key={`${c.topic.id}-${idx}`}
                            type="button"
                            onClick={() => setFloatingCardIdx(idx)}
                            className={`w-6 h-6 rounded-md text-[11px] font-mono font-bold transition-all cursor-pointer ${
                              idx === floatingCardIdx
                                ? "bg-emerald-500 text-slate-950 scale-110"
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

                    {/* Quick Page-Wise Delete & Upload Buttons right next to Page Numbers */}
                    {isAdmin && activeModalCard && (
                      <div className="flex items-center gap-1.5 pl-1 border-l border-slate-800">
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
                          title={`Delete Page ${activeModalCard.pageNumberInDate} of ${activeModalCard.editionDate}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 border border-rose-500/40 text-[11px] font-bold text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          Del Page #{activeModalCard.pageNumberInDate}
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowModalDateUpload((prev) => !prev)}
                          title={`Upload CA & Question for ${activeModalCard.editionDate}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/35 border border-sky-500/40 text-[11px] font-bold text-sky-300 cursor-pointer"
                        >
                          <Upload className="w-3 h-3" />
                          Upload CA
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={modalDeckCards.length === 0}
                    onClick={goNextCard}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 rounded-xl transition-colors cursor-pointer shadow-sm"
                  >
                    Next Topic
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
