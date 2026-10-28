import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  SUBSCRIPTION_TIER_LABELS,
  SUBSCRIPTION_TIER_PLANS,
  type AiNoteDto,
  type AttemptSummaryDto,
  type BilingualText,
  type CachedNoteRefDto,
  type MasteryDto,
  type PausedAttemptDto,
  type QuestionOptions,
  type StudentExamDto,
  type StudentSeriesDto,
  type StudentSubscriptionDto,
  type SubscriptionTier,
  type UserDto,
  type UserRole,
} from "../packages/shared-types/src/index";
import { api } from "./api";
import QuestionBankAdmin from "./admin/QuestionBankAdmin";
import AttemptHistory from "./components/AttemptHistory";
import { ExamCards, ExamSeriesView, LibraryStats } from "./components/ExamLibrary";
import GoogleSignInButton from "./components/GoogleSignInButton";
import {
  BookOpen,
  Shield,
  Users,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Clock,
  LogOut,
  Plus,
  Trash2,
  RefreshCw,
  Terminal,
  Copy,
  Check,
  Award,
  PenTool,
  Newspaper,
  Database,
  Upload,
  Lock,
  Play,
  PauseCircle,
  Bookmark,
  Edit3,
  Crown,
  CreditCard,
  X,
} from "lucide-react";

// ============================================================================
// Types (all data comes from api-core / PostgreSQL)
// ============================================================================

type SupportedLang = "en" | "bn";

/** 303 -> "5min 3sec" */
const formatClock = (sec: number) => `${Math.floor(sec / 60)}min ${sec % 60}sec`;

/** A question as shown during a test — correct answers stay on the server until submission. */
interface MockQuestion {
  id: string;
  subjectNameEn: string;
  subjectNameBn: string;
  subtopicNameEn: string;
  subtopicNameBn: string;
  stemEn: string;
  stemBn: string;
  optionAEn: string;
  optionABn: string;
  optionBEn: string;
  optionBBn: string;
  optionCEn: string;
  optionCBn: string;
  optionDEn: string;
  optionDBn: string;
  previousYearTag: string;
}

/** Client-safe question shape returned by GET /exams/:id/mock-test and remedial-mock. */
interface ApiMockQuestion {
  id: string;
  subjectName: BilingualText;
  subtopicName: BilingualText;
  stem: BilingualText;
  options: QuestionOptions;
  previousYearTag: string | null;
}

const toMockQuestion = (q: ApiMockQuestion): MockQuestion => ({
  id: q.id,
  subjectNameEn: q.subjectName.en,
  subjectNameBn: q.subjectName.bn,
  subtopicNameEn: q.subtopicName.en,
  subtopicNameBn: q.subtopicName.bn,
  stemEn: q.stem.en,
  stemBn: q.stem.bn,
  optionAEn: q.options.A.en,
  optionABn: q.options.A.bn,
  optionBEn: q.options.B.en,
  optionBBn: q.options.B.bn,
  optionCEn: q.options.C.en,
  optionCBn: q.options.C.bn,
  optionDEn: q.options.D.en,
  optionDBn: q.options.D.bn,
  previousYearTag: q.previousYearTag ?? "",
});

interface SubmitResponse {
  attemptId: string;
  overallSummary: {
    correct: number;
    incorrect: number;
    finalNetScore: number;
    maxPossibleScore: number;
    accuracyPercentage: number;
    cutoffCleared: boolean;
  };
  weakSubtopics: unknown[];
}

interface DescriptiveEvaluation {
  transcribedAnswer: string;
  estimatedWordCount: number;
  targetWordLimit: number;
  grammarScore: number;
  contentScore: number;
  wordLimitScore: number;
  totalScore: number;
  strengths: string[];
  improvementsNeeded: string[];
  correctedModelAnswer: string;
}

type ActiveNav =
  | "mock-center"
  | "weakness-tutor"
  | "descriptive-eval"
  | "daily-ca"
  | "admin-console"
  | "testing-guide";

type AdminSubTab = "users" | "exams" | "cache-attempts" | "bulk-import" | "series";

export default function App() {
  // 1. Auth & User State
  const [user, setUser] = useState<UserDto | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [lang, setLang] = useState<SupportedLang>("bn");
  const [activeNav, setActiveNav] = useState<ActiveNav>("mock-center");
  const [adminTab, setAdminTab] = useState<AdminSubTab>("users");

  // Auth Form State (Email/Password + Google)
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [emailInput, setEmailInput] = useState<string>("");
  const [passwordInput, setPasswordInput] = useState<string>("");
  const [fullNameInput, setFullNameInput] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);

  // Student Data
  const [examsList, setExamsList] = useState<StudentExamDto[]>([]);
  const [myAttempts, setMyAttempts] = useState<AttemptSummaryDto[]>([]);
  const [myPausedAttempts, setMyPausedAttempts] = useState<PausedAttemptDto[]>([]);
  const [myMastery, setMyMastery] = useState<MasteryDto[]>([]);
  const [cachedNotes, setCachedNotes] = useState<CachedNoteRefDto[]>([]);
  const [mySubscriptions, setMySubscriptions] = useState<StudentSubscriptionDto[]>([]);

  // Aspirant Subscription Purchase Modal State
  const [showSubscriptionModal, setShowSubscriptionModal] = useState<boolean>(false);
  const [selectedPurchaseTier, setSelectedPurchaseTier] = useState<SubscriptionTier>("pro_prelims");
  const [purchaseBillingCycle, setPurchaseBillingCycle] = useState<"monthly" | "quarterly" | "yearly">("yearly");
  const [testPaidAmountInput, setTestPaidAmountInput] = useState<string>("299");
  const [payExistingDueOnly, setPayExistingDueOnly] = useState<boolean>(false);
  const [purchaseNotesInput, setPurchaseNotesInput] = useState<string>("");
  const [purchaseBusy, setPurchaseBusy] = useState<boolean>(false);

  // Admin-Only State
  const [allUsers, setAllUsers] = useState<UserDto[]>([]);
  const [allAttempts, setAllAttempts] = useState<AttemptSummaryDto[]>([]);
  const [allSubscriptions, setAllSubscriptions] = useState<StudentSubscriptionDto[]>([]);
  const [perfSearchQuery, setPerfSearchQuery] = useState<string>("");
  const [subSearchQuery, setSubSearchQuery] = useState<string>("");
  const [managingStudentSub, setManagingStudentSub] = useState<{
    user: UserDto;
    planTier: SubscriptionTier;
    amountPaidNowInr: string;
    paymentDueInr: string;
    billingCycle: "monthly" | "quarterly" | "yearly" | "lifetime";
    notes: string;
  } | null>(null);
  const [manageSubBusy, setManageSubBusy] = useState<boolean>(false);

  // Top Navbar Sliding Tab Indicator Refs & State
  const navContainerRef = useRef<HTMLElement | null>(null);
  const navTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [navSliderStyle, setNavSliderStyle] = useState<{
    left: number;
    width: number;
    opacity: number;
  }>({ left: 0, width: 0, opacity: 0 });

  const [statusBanner, setStatusBanner] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Active Mock Test State
  const [activeExam, setActiveExam] = useState<StudentExamDto | null>(null);
  /** Test series being sat (null = random mock / remedial test) */
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null);
  /** Paused attempt ID if this test was resumed from a postponed state */
  const [activePausedAttemptId, setActivePausedAttemptId] = useState<string | null>(null);
  /** Published test series per exam, loaded when a student opens an exam */
  const [seriesByExam, setSeriesByExam] = useState<Record<string, StudentSeriesDto[]>>({});
  const [openExamId, setOpenExamId] = useState<string | null>(null);
  const [activeTestQuestions, setActiveTestQuestions] = useState<MockQuestion[]>([]);
  const [isRemedialMode, setIsRemedialMode] = useState<boolean>(false);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<string, "A" | "B" | "C" | "D">
  >({});
  const [markedForReview, setMarkedForReview] = useState<Record<string, boolean>>({});
  const [questionTimers, setQuestionTimers] = useState<Record<string, number>>({});
  const [elapsedTotalSec, setElapsedTotalSec] = useState<number>(0);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [pausing, setPausing] = useState<boolean>(false);
  /** Highlighted in the history right after submitting */
  const [lastAttemptId, setLastAttemptId] = useState<string | null>(null);

  // AI Tutor Note State
  const [selectedNote, setSelectedNote] = useState<AiNoteDto | null>(null);
  const [generatingTopicSlug, setGeneratingTopicSlug] = useState<string | null>(
    null
  );

  // Descriptive Evaluator State
  const [descExamSlug, setDescExamSlug] = useState<
    "wbpsc-clerkship-part2" | "wbcs-mains"
  >("wbpsc-clerkship-part2");
  const [descTaskType, setDescTaskType] = useState<
    "report_writing" | "precis_writing" | "translation"
  >("report_writing");
  const [descPrompt, setDescPrompt] = useState<string>(
    "নিত্যপ্রয়োজনীয় দ্রব্যমূল্য বৃদ্ধি ও সাধারণ মানুষের দুর্ভোগ — এই বিষয়ে একটি সংবাদপত্রের প্রতিবেদন রচনা করুন (শব্দসংখ্যা ১৫০)।"
  );
  const [descWordLimit, setDescWordLimit] = useState<number>(150);
  const [descStudentText, setDescStudentText] = useState<string>(
    "নিজস্ব সংবাদদাতা, কলকাতা, ২৩ অক্টোবর: সম্প্রতি পশ্চিমবঙ্গের বিভিন্ন বাজারে শাকসবজি, চাল, ডাল ও ভোজ্যতেলের অস্বাভাবিক মূল্যবৃদ্ধিতে মধ্যবিত্ত ও নিম্নবিত্ত মানুষের নাভিশ্বাস উঠেছে। কালোবাজারি ও ফড়েদের দৌরাত্ম্য রুখতে রাজ্য সরকারের এনফোর্সমেন্ট ব্রাঞ্চ ও সুফল বাংলা স্টলগুলি সক্রিয় ভূমিকা নিচ্ছে।"
  );
  const [descImageBase64, setDescImageBase64] = useState<string | null>(null);
  const [descImageMime, setDescImageMime] = useState<string>("image/jpeg");
  const [descEvalBusy, setDescEvalBusy] = useState<boolean>(false);
  const [descEvaluationResult, setDescEvaluationResult] =
    useState<DescriptiveEvaluation | null>(null);

  // Daily Current Affairs State
  const [caBusy, setCaBusy] = useState<boolean>(false);
  const [caHeadlinesInput, setCaHeadlinesInput] = useState<string>(
    "Kolkata Metro East-West Under-River Corridor Milestone; West Bengal Student Credit Card Scheme Update; RBI Monetary Policy Repo Rate Decision"
  );
  const [caDigestResult, setCaDigestResult] = useState<{
    titleEn: string;
    titleBn: string;
    contentMarkdown: string;
    mnemonicsText: string;
    editionDate: string;
  } | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isUserAdmin = user?.role === "admin";

  const showError = (err: unknown, fallback: string) =>
    setStatusBanner({ type: "error", text: (err as Error)?.message || fallback });

  // Measure active tab position for smooth sliding navbar animation
  const updateNavSlider = useCallback(() => {
    const navEl = navContainerRef.current;
    const activeBtn = navTabRefs.current[activeNav];
    if (!navEl || !activeBtn) {
      setNavSliderStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const navRect = navEl.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setNavSliderStyle({
      left: btnRect.left - navRect.left,
      width: btnRect.width,
      opacity: 1,
    });
  }, [activeNav]);

  useEffect(() => {
    updateNavSlider();
    window.addEventListener("resize", updateNavSlider);
    return () => window.removeEventListener("resize", updateNavSlider);
  }, [updateNavSlider, isUserAdmin, user?.id]);

  // =========================================================================
  // 1. Session bootstrap (HttpOnly cookie → GET /auth/me)
  // =========================================================================
  useEffect(() => {
    api<{ googleClientId: string | null }>("/auth/config")
      .then((c) => setGoogleClientId(c.googleClientId))
      .catch(() => setGoogleClientId(null));
    api<{ user: UserDto }>("/auth/me")
      .then(({ user: u }) => {
        setUser(u);
        setLang(u.preferredLanguage);
      })
      .catch(() => setUser(null))
      .finally(() => setAuthReady(true));
  }, []);

  // =========================================================================
  // 2. Data loading (refreshed after every action that changes it)
  // =========================================================================
  const loadExams = useCallback(() => {
    api<{ exams: StudentExamDto[] }>("/exams")
      .then((r) => setExamsList(r.exams))
      .catch((err) => showError(err, "Could not load exams"));
  }, []);

  const loadMyProgress = useCallback(() => {
    api<{ attempts: AttemptSummaryDto[] }>("/me/attempts")
      .then((r) => setMyAttempts(r.attempts))
      .catch((err) => showError(err, "Could not load your attempts"));
    api<{ pausedAttempts: PausedAttemptDto[] }>("/me/paused-attempts")
      .then((r) => setMyPausedAttempts(r.pausedAttempts))
      .catch(() => setMyPausedAttempts([]));
    api<{ mastery: MasteryDto[] }>("/me/mastery")
      .then((r) => setMyMastery(r.mastery))
      .catch((err) => showError(err, "Could not load your weakness radar"));
    api<{ notes: CachedNoteRefDto[] }>("/ai/notes/cached")
      .then((r) => setCachedNotes(r.notes))
      .catch(() => setCachedNotes([]));
    api<{ subscriptions: StudentSubscriptionDto[] }>("/me/subscriptions")
      .then((r) => setMySubscriptions(r.subscriptions))
      .catch(() => setMySubscriptions([]));
  }, []);

  const loadAdminData = useCallback(() => {
    api<{ users: UserDto[] }>("/admin/users")
      .then((r) => setAllUsers(r.users))
      .catch((err) => showError(err, "Could not load users"));
    api<{ attempts: AttemptSummaryDto[] }>("/admin/attempts")
      .then((r) => setAllAttempts(r.attempts))
      .catch((err) => showError(err, "Could not load attempts"));
    api<{ subscriptions: StudentSubscriptionDto[] }>("/admin/subscriptions")
      .then((r) => setAllSubscriptions(r.subscriptions))
      .catch(() => setAllSubscriptions([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadExams();
    loadMyProgress();
  }, [user?.id, loadExams, loadMyProgress]);

  useEffect(() => {
    if (isUserAdmin) loadAdminData();
  }, [isUserAdmin, activeNav, loadAdminData]);

  // Countdown: the exam's/series' duration; 0 = untimed
  const testLimitSec = activeExam ? Math.max(0, activeExam.durationMinutes) * 60 : 0;
  const remainingSec = Math.max(0, testLimitSec - elapsedTotalSec);
  const autoSubmittedRef = useRef(false);

  // Live Timer during Active Mock Test
  useEffect(() => {
    if (!activeExam || activeTestQuestions.length === 0) return;
    const currentQ = activeTestQuestions[currentQuestionIdx];
    const interval = setInterval(() => {
      setElapsedTotalSec((prev) => prev + 1);
      if (currentQ) {
        setQuestionTimers((prev) => ({
          ...prev,
          [currentQ.id]: (prev[currentQ.id] || 0) + 1,
        }));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeExam, activeTestQuestions, currentQuestionIdx]);

  // =========================================================================
  // 3. Authentication Handlers (Email/Password + Google Sign-In)
  // =========================================================================

  const signedIn = (u: UserDto) => {
    setUser(u);
    setLang(u.preferredLanguage);
    setPasswordInput("");
    setAuthError(null);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const { user: u } =
        authMode === "signup"
          ? await api<{ user: UserDto }>("/auth/register", {
            method: "POST",
            body: {
              email: emailInput.trim(),
              password: passwordInput,
              fullName: fullNameInput.trim(),
            },
          })
          : await api<{ user: UserDto }>("/auth/login", {
            method: "POST",
            body: { email: emailInput.trim(), password: passwordInput },
          });
      signedIn(u);
    } catch (err) {
      setAuthError((err as Error).message || "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      const { user: u } = await api<{ user: UserDto }>("/auth/google", {
        method: "POST",
        body: { credential },
      });
      signedIn(u);
    } catch (err) {
      setAuthError((err as Error).message || "Google sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setActiveExam(null);
    setActiveTestQuestions([]);
    setLastAttemptId(null);
    setSelectedNote(null);
    setActiveNav("mock-center");
    setUser(null);
  };

  /** Switches language and remembers it on the account. */
  const changeLang = (l: SupportedLang) => {
    setLang(l);
    if (user && user.preferredLanguage !== l) {
      api<{ user: UserDto }>("/auth/me", { method: "PATCH", body: { preferredLanguage: l } })
        .then((r) => setUser(r.user))
        .catch(() => undefined);
    }
  };

  // =========================================================================
  // 4. Admin User Management
  // =========================================================================

  const handleAdminUpdateUser = async (
    target: UserDto,
    updates: Partial<Pick<UserDto, "subscriptionTier" | "isActive" | "paymentDueInr" | "totalPaidInr" | "billingNotes">> & {
      role?: Exclude<UserRole, "admin">;
    }
  ) => {
    try {
      await api(`/admin/users/${target.id}`, { method: "PATCH", body: updates });
      setStatusBanner({
        type: "success",
        text: `Updated ${target.fullName} (${target.email}).`,
      });
      loadAdminData();
    } catch (err) {
      showError(err, "Could not update user");
    }
  };

  const openSubscriptionModal = (defaultTier?: SubscriptionTier, dueOnly = false) => {
    const tierToUse: SubscriptionTier =
      defaultTier && defaultTier !== "free"
        ? defaultTier
        : user?.subscriptionTier && user.subscriptionTier !== "free" && dueOnly
          ? user.subscriptionTier
          : "pro_prelims";
    const planMeta = SUBSCRIPTION_TIER_PLANS.find((p) => p.tier === tierToUse) ?? SUBSCRIPTION_TIER_PLANS[1];
    setSelectedPurchaseTier(tierToUse);
    setPayExistingDueOnly(dueOnly);
    setTestPaidAmountInput(
      dueOnly ? String(user?.paymentDueInr ?? 0) : String(planMeta.priceInr)
    );
    setPurchaseNotesInput("");
    setShowSubscriptionModal(true);
  };

  const handlePurchaseSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (purchaseBusy) return;
    setPurchaseBusy(true);
    try {
      const r = await api<{ user: UserDto; subscription: StudentSubscriptionDto }>(
        "/me/subscriptions/purchase",
        {
          method: "POST",
          body: {
            planTier: selectedPurchaseTier,
            testPaidAmountInr: Number(testPaidAmountInput) || 0,
            billingCycle: purchaseBillingCycle,
            payExistingDueOnly,
            notes: purchaseNotesInput.trim() || undefined,
          },
        }
      );
      setUser(r.user);
      setShowSubscriptionModal(false);
      loadMyProgress();
      if (isUserAdmin) loadAdminData();
      setStatusBanner({
        type: "success",
        text: `Subscription activated: ${SUBSCRIPTION_TIER_LABELS[r.user.subscriptionTier]} (Ref: ${r.subscription.transactionRef} · Paid ₹${r.subscription.amountPaidInr} · Due ₹${r.user.paymentDueInr ?? 0}). Shared with Admin.`,
      });
    } catch (err) {
      showError(err, "Could not complete test subscription purchase");
    } finally {
      setPurchaseBusy(false);
    }
  };

  const handleAdminManageSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingStudentSub || manageSubBusy) return;
    setManageSubBusy(true);
    try {
      const r = await api<{ user: UserDto; subscription: StudentSubscriptionDto }>(
        "/admin/subscriptions/manage",
        {
          method: "POST",
          body: {
            userId: managingStudentSub.user.id,
            planTier: managingStudentSub.planTier,
            amountPaidNowInr: Number(managingStudentSub.amountPaidNowInr) || 0,
            paymentDueInr: Number(managingStudentSub.paymentDueInr) || 0,
            billingCycle: managingStudentSub.billingCycle,
            notes: managingStudentSub.notes.trim() || undefined,
          },
        }
      );
      if (user && r.user.id === user.id) {
        setUser(r.user);
      }
      setManagingStudentSub(null);
      loadAdminData();
      setStatusBanner({
        type: "success",
        text: `Updated subscription for ${r.user.fullName}: ${SUBSCRIPTION_TIER_LABELS[r.user.subscriptionTier]} · Payment Due ₹${r.user.paymentDueInr ?? 0}.`,
      });
    } catch (err) {
      showError(err, "Could not update student subscription");
    } finally {
      setManageSubBusy(false);
    }
  };

  // =========================================================================
  // 5. Mock Test (questions without answers → server-side SQL grading)
  // =========================================================================

  const beginTest = (
    exam: StudentExamDto,
    questions: ApiMockQuestion[],
    remedial: boolean,
    seriesId: string | null = null
  ) => {
    if (questions.length === 0) {
      setStatusBanner({
        type: "info",
        text: "This exam has no questions yet — an admin can add them in Admin Console → Question Bank.",
      });
      return;
    }
    setActiveExam(exam);
    setActiveSeriesId(seriesId);
    setActivePausedAttemptId(null);
    setActiveTestQuestions(questions.map(toMockQuestion));
    setIsRemedialMode(remedial);
    setCurrentQuestionIdx(0);
    setSelectedAnswers({});
    setMarkedForReview({});
    setQuestionTimers({});
    setElapsedTotalSec(0);
    autoSubmittedRef.current = false;
    setLastAttemptId(null);
  };

  /** Resumes a paused/postponed test from exact saved state (timer, answers, marked questions, index). */
  const resumePausedTest = (paused: PausedAttemptDto) => {
    const baseExam = examsList.find((e) => e.id === paused.examId);
    const examForRunner: StudentExamDto = {
      id: paused.examId,
      slug: paused.examSlug,
      titleEn: paused.examTitleEn,
      titleBn: paused.examTitleBn,
      descriptionEn: baseExam?.descriptionEn ?? "",
      descriptionBn: baseExam?.descriptionBn ?? "",
      totalQuestions: paused.totalQuestions,
      durationMinutes: paused.durationMinutes,
      marksPerCorrect: paused.marksPerCorrect,
      negativeMarksPerWrong: paused.negativeMarksPerWrong,
      estimatedCutoffMarks: paused.estimatedCutoffMarks,
      isActive: true,
      questionCount: baseExam?.questionCount ?? paused.totalQuestions,
      subjectCount: baseExam?.subjectCount ?? 1,
      seriesCounts: baseExam?.seriesCounts ?? {},
    };

    const restoredAnswers: Record<string, "A" | "B" | "C" | "D"> = {};
    const restoredMarked: Record<string, boolean> = {};
    const restoredTimers: Record<string, number> = {};

    for (const q of paused.questions) {
      if (q.selectedOption) restoredAnswers[q.id] = q.selectedOption;
      if (q.state === "marked_for_review" || q.state === "answered_and_marked") {
        restoredMarked[q.id] = true;
      }
      if (q.timeSpentSeconds > 0) restoredTimers[q.id] = q.timeSpentSeconds;
    }

    setActiveExam(examForRunner);
    setActiveSeriesId(paused.seriesId);
    setActivePausedAttemptId(paused.attemptId);
    setActiveTestQuestions(paused.questions.map(toMockQuestion));
    setIsRemedialMode(paused.isRemedial);
    setCurrentQuestionIdx(
      Math.min(Math.max(0, paused.currentQuestionIdx), Math.max(0, paused.questions.length - 1))
    );
    setSelectedAnswers(restoredAnswers);
    setMarkedForReview(restoredMarked);
    setQuestionTimers(restoredTimers);
    setElapsedTotalSec(paused.totalTimeSpentSeconds);
    autoSubmittedRef.current = false;
    setLastAttemptId(null);
    setStatusBanner({
      type: "info",
      text: `Resumed "${paused.examTitleEn}" (${paused.answeredCount}/${paused.totalQuestions} answered · ${formatClock(paused.totalTimeSpentSeconds)} elapsed).`,
    });
  };

  const discardPausedTest = async (attemptId: string) => {
    try {
      await api(`/me/paused-attempts/${attemptId}`, { method: "DELETE" });
      loadMyProgress();
      loadExams();
      if (openExamId) {
        api<{ series: StudentSeriesDto[] }>(`/exams/${openExamId}/series`)
          .then((r) => setSeriesByExam((prev) => ({ ...prev, [openExamId]: r.series })))
          .catch(() => undefined);
      }
      setStatusBanner({ type: "info", text: "Postponed test discarded." });
    } catch (err) {
      showError(err, "Could not discard paused test");
    }
  };

  const startMockTest = async (exam: StudentExamDto) => {
    try {
      const r = await api<{ questions: ApiMockQuestion[] }>(
        `/exams/${exam.id}/mock-test?lang=${lang}`
      );
      beginTest(exam, r.questions, false);
    } catch (err) {
      showError(err, "Could not start the test");
    }
  };

  const openExamSeries = async (exam: StudentExamDto) => {
    setOpenExamId(exam.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const r = await api<{ series: StudentSeriesDto[] }>(`/exams/${exam.id}/series`);
      setSeriesByExam((prev) => ({ ...prev, [exam.id]: r.series }));
    } catch (err) {
      showError(err, "Could not load the test series");
    }
  };

  /** A fixed, admin-built test series (mock test, previous-year paper, practice set). */
  const startSeriesTest = async (exam: StudentExamDto, series: StudentSeriesDto) => {
    try {
      const r = await api<{ questions: ApiMockQuestion[] }>(
        `/exams/series/${series.id}/test?lang=${lang}`
      );
      beginTest(
        {
          ...exam,
          titleEn: `${exam.titleEn} — ${series.name.en}`,
          titleBn: `${exam.titleBn} — ${series.name.bn}`,
          durationMinutes: series.durationMinutes,
          marksPerCorrect: series.marksPerCorrect,
          negativeMarksPerWrong: series.negativeMarksPerWrong,
          estimatedCutoffMarks: series.estimatedCutoffMarks,
          totalQuestions: series.totalQuestions,
        },
        r.questions,
        false,
        series.id
      );
    } catch (err) {
      showError(err, "Could not start the test");
    }
  };

  /** 20 unseen questions from the 3 weakest subtopics of the weakest exam. */
  const startRemedialTest = async () => {
    const exam = examsList.find((e) => e.id === myMastery[0]?.examId);
    if (!exam) return;
    try {
      const r = await api<{ remedialTest: { questions: ApiMockQuestion[] } }>(
        "/exams/remedial-mock",
        { method: "POST", body: { examId: exam.id, preferredLanguage: lang } }
      );
      beginTest(exam, r.remedialTest.questions, true);
    } catch (err) {
      showError(err, "Could not start the remedial test");
    }
  };

  // Time up: submit once (a failed submit leaves the manual button to retry)
  useEffect(() => {
    if (!activeExam || testLimitSec === 0 || remainingSec > 0 || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    setStatusBanner({ type: "info", text: "Time is up — your test has been submitted." });
    handleSubmitMockTest();
  });

  const handlePauseMockTest = async () => {
    if (!activeExam || pausing || submitting) return;
    setPausing(true);
    try {
      const r = await api<{
        attemptId: string;
        answeredCount: number;
        totalQuestions: number;
        totalTimeSpentSeconds: number;
      }>("/exams/pause", {
        method: "POST",
        body: {
          examId: activeExam.id,
          seriesId: activeSeriesId,
          attemptId: activePausedAttemptId,
          isRemedial: isRemedialMode,
          preferredLanguage: lang,
          totalTimeSpentSeconds: elapsedTotalSec,
          answers: activeTestQuestions.map((q) => {
            const chosen = selectedAnswers[q.id];
            const isMarked = Boolean(markedForReview[q.id]);
            return {
              questionId: q.id,
              selectedOption: chosen ?? null,
              status: chosen
                ? isMarked
                  ? "answered_and_marked"
                  : "answered"
                : isMarked
                  ? "marked_for_review"
                  : "unanswered",
              timeSpentSeconds: Math.min(7200, questionTimers[q.id] || 0),
            };
          }),
        },
      });
      const pausedTitle = activeExam.titleEn;
      const pausedExamId = activeExam.id;
      setActiveExam(null);
      setActiveSeriesId(null);
      setActivePausedAttemptId(null);
      setActiveTestQuestions([]);
      setStatusBanner({
        type: "info",
        text: `Test paused & saved (${r.answeredCount}/${r.totalQuestions} answered · ${formatClock(r.totalTimeSpentSeconds)} elapsed). You can resume "${pausedTitle}" anytime from Mock Tests.`,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      loadMyProgress();
      loadExams();
      if (pausedExamId) {
        api<{ series: StudentSeriesDto[] }>(`/exams/${pausedExamId}/series`)
          .then((res) => setSeriesByExam((prev) => ({ ...prev, [pausedExamId]: res.series })))
          .catch(() => undefined);
      }
    } catch (err) {
      showError(err, "Could not pause the test — please try again.");
    } finally {
      setPausing(false);
    }
  };

  const handleSubmitMockTest = async () => {
    if (!activeExam || submitting) return;
    setSubmitting(true);
    try {
      const submittedExamId = activeExam.id;
      const r = await api<SubmitResponse>("/exams/submit", {
        method: "POST",
        body: {
          examId: activeExam.id,
          seriesId: activeSeriesId ?? undefined,
          attemptId: activePausedAttemptId ?? undefined,
          preferredLanguage: lang,
          totalTimeSpentSeconds: elapsedTotalSec,
          startedAt: new Date(Date.now() - elapsedTotalSec * 1000).toISOString(),
          answers: activeTestQuestions.map((q) => {
            const chosen = selectedAnswers[q.id];
            const isMarked = Boolean(markedForReview[q.id]);
            return {
              questionId: q.id,
              selectedOption: chosen ?? null,
              status: chosen
                ? isMarked
                  ? "answered_and_marked"
                  : "answered"
                : isMarked
                  ? "marked_for_review"
                  : "unanswered",
              timeSpentSeconds: Math.min(7200, questionTimers[q.id] || 0),
            };
          }),
        },
      });
      const s = r.overallSummary;
      setLastAttemptId(r.attemptId);
      setActiveExam(null);
      setActiveSeriesId(null);
      setActivePausedAttemptId(null);
      setActiveTestQuestions([]);
      setStatusBanner({
        type: "success",
        text: `Submitted. Net score ${s.finalNetScore} / ${s.maxPossibleScore} · accuracy ${s.accuracyPercentage}% · ${s.cutoffCleared ? "cutoff cleared" : "below cutoff"
          }. Review it in your history below.`,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      loadMyProgress();
      loadExams();
      if (submittedExamId) {
        api<{ series: StudentSeriesDto[] }>(`/exams/${submittedExamId}/series`)
          .then((res) => setSeriesByExam((prev) => ({ ...prev, [submittedExamId]: res.series })))
          .catch(() => undefined);
      }
    } catch (err) {
      showError(err, "Submission failed — your answers are still here, try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // =========================================================================
  // 6. AI Study Notes (api-core → api-ai: Redis → PostgreSQL → Gemini on miss)
  // =========================================================================

  const handleOpenOrGenerateAiNote = async (mastery: MasteryDto) => {
    setGeneratingTopicSlug(mastery.subtopicSlug);
    try {
      const { note } = await api<{ note: AiNoteDto }>("/ai/notes", {
        method: "POST",
        body: { subtopicId: mastery.subtopicId, language: lang },
      });
      setSelectedNote(note);
      setActiveNav("weakness-tutor");
      if (!note.cached) loadMyProgress();
    } catch (err) {
      showError(err, "AI Note generation failed.");
    } finally {
      setGeneratingTopicSlug(null);
    }
  };

  // =========================================================================
  // 7. Part-II Descriptive Evaluator & Daily Current Affairs Handlers
  // =========================================================================

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDescImageMime(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64Part = result.includes(",") ? result.split(",")[1] : result;
      setDescImageBase64(base64Part);
    };
    reader.readAsDataURL(file);
  };

  const handleEvaluateDescriptive = async (e: React.FormEvent) => {
    e.preventDefault();
    setDescEvalBusy(true);
    setStatusBanner(null);
    try {
      const data = await api<{ evaluation: DescriptiveEvaluation }>(
        "/ai/evaluate-descriptive",
        {
          method: "POST",
          body: {
            examSlug: descExamSlug,
            taskType: descTaskType,
            language: lang,
            questionPrompt: descPrompt,
            targetWordLimit: descWordLimit,
            studentAnswerText: descStudentText,
            imageBase64: descImageBase64,
            imageMimeType: descImageMime,
          },
        }
      );
      setDescEvaluationResult(data.evaluation);
    } catch (err) {
      showError(err, "Descriptive evaluation error.");
    } finally {
      setDescEvalBusy(false);
    }
  };

  const handleGenerateDailyCA = async () => {
    setCaBusy(true);
    setStatusBanner(null);
    try {
      const headlines = caHeadlinesInput
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/cron/generate-daily-ca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editionDate: new Date().toISOString().slice(0, 10),
          headlines,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to synthesize CA");
      setCaDigestResult({
        ...data.digest,
        editionDate: data.editionDate,
      });
    } catch (err: any) {
      setStatusBanner({
        type: "error",
        text: err?.message || "Daily Current Affairs generation failed.",
      });
    } finally {
      setCaBusy(false);
    }
  };

  const copyCommand = (id: string, cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // =========================================================================
  // Render: Loading or Unauthenticated Login Screen
  // =========================================================================

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-400">
          Loading your session...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-['Plus_Jakarta_Sans','Noto_Sans_Bengali',sans-serif]">
        {/* Top Bar Contract: 3 zones */}
        <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800">
          <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            WBPSC Mock Tutor
          </span>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <span className="whitespace-nowrap shrink-0">WBCS Prelims</span>
            <span className="whitespace-nowrap shrink-0">WBCS Mains</span>
            <span className="whitespace-nowrap shrink-0">Clerkship Part I &amp; II</span>
            <span className="whitespace-nowrap shrink-0">Food SI</span>
            <span className="whitespace-nowrap shrink-0">Miscellaneous Prelims</span>
            <span className="whitespace-nowrap shrink-0">Miscellaneous Mains</span>
            <span className="whitespace-nowrap shrink-0">ICDS Supervisor Prelims</span>


          </nav>
        </header>

        <main className="max-w-6xl mx-auto w-full px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Platform Overview */}
          <div className="lg:col-span-7 space-y-6">
            <p className="text-xs font-medium text-emerald-400">
              Bengali &amp; English Mock Tests with PYQs . AI Assessment . Weakness Analysis
            </p>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
              WBPSC Mock Tutor &amp; Weakness &amp; Strength Analyser Engine.
            </h1>
            <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
              Built for West Bengal Civil Service (WBCS) Prelims + Mains, Clerkship Part-I &amp; Part-II,
              Food SI, ICDS Supervisor Prelims + Mains and Miscellaneous Prelims + Mains aspirants. Features negative-marking
              evaluation, weaness analysis radar, Visual Storytelling of Concepts, AI-generated images for references, and AI-powered descriptive answer evaluation.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
              <div>
                <div className="text-2xl font-bold text-white font-mono tabular-nums">
                  -0.25 / -0.33
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Negative Marking Evaluation
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white font-mono tabular-nums">
                  L1 · L2 · L3
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Three tier-plans
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white font-mono tabular-nums">
                  Full Coverage
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Prelims · Mains · Descriptiive · Current Affairs
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Email/Password + Google sign-in (self-hosted, api-core) */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white">
                  {authMode === "signin"
                    ? "Sign in to your account"
                    : "Create an Aspirant account"}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Need an account? Register to track your progress and access AI-powered features.
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setAuthMode("signin")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${authMode === "signin"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white"
                    }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("signup")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${authMode === "signup"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white"
                    }`}
                >
                  Register
                </button>
              </div>
            </div>

            {authError && (
              <div className="p-3.5 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-200 leading-relaxed">
                {authError}
              </div>
            )}

            <form onSubmit={handleEmailAuth} className="space-y-4">
              {authMode === "signup" && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Full Name (নাম)
                  </label>
                  <input
                    type="text"
                    required
                    value={fullNameInput}
                    onChange={(e) => setFullNameInput(e.target.value)}
                    placeholder="e.g., Subhamoy Chatterjee"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="aspirant@example.com"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={authMode === "signup" ? 8 : 1}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder={authMode === "signup" ? "At least 8 characters" : "Your password"}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={authBusy}
                className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-lg transition-colors cursor-pointer"
              >
                {authBusy
                  ? "Authenticating..."
                  : authMode === "signin"
                    ? "Sign In with Email & Password"
                    : "Create Account with Email & Password"}
              </button>
            </form>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-800"></div>
              <span className="flex-shrink mx-3 text-xs text-slate-500">OR</span>
              <div className="flex-grow border-t border-slate-800"></div>
            </div>

            {googleClientId ? (
              <div className="space-y-2">
                <GoogleSignInButton
                  clientId={googleClientId}
                  onCredential={handleGoogleCredential}
                />
                <p className="text-[11px] text-slate-500 text-center">
                  Admin: continue with Google using your admin email.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 text-center">
                Google sign-in is not configured yet (set GOOGLE_CLIENT_ID on api-core).
              </p>
            )}
          </div>
        </main>

        <footer className="px-6 py-4 border-t border-slate-900 text-xs text-slate-500 flex justify-between">
          <span>WBPSC AI Mock Tutor &amp; Tutor - Copyright</span>
          <span>Acharya Labs (বাংলা + English) · Developed by - Pankaj Acharjee</span>
        </footer>
      </div>
    );
  }

  // =========================================================================
  // Render: Authenticated Application Shell (Top Bar + Workspace)
  // =========================================================================

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-['Plus_Jakarta_Sans','Noto_Sans_Bengali','Hind_Siliguri',sans-serif]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-6 px-6 py-3.5 border-b border-slate-800 bg-slate-950/95 backdrop-blur-md sticky top-0 z-20">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveNav("mock-center");
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          WBPSC Mock Tutor
        </a>

        {/* Zone 2: Semi-rounded Navbar with padding at both ends, sliding indicator & light active tab background */}
        <nav
          ref={navContainerRef}
          aria-label="Main navigation"
          className="hidden md:flex relative items-center gap-1.5 rounded-2xl bg-slate-900/95 border border-slate-800/90 px-4 py-1.5 shadow-inner text-sm font-medium"
        >
          {/* Sliding active tab background pill */}
          <span
            aria-hidden="true"
            style={{
              transform: `translateX(${navSliderStyle.left}px)`,
              width: `${navSliderStyle.width}px`,
              opacity: navSliderStyle.opacity,
            }}
            className={`pointer-events-none absolute top-1.5 bottom-1.5 left-0 rounded-xl transition-all duration-300 ease-out ${
              activeNav === "admin-console"
                ? "bg-amber-400/20 border border-amber-400/35 shadow-sm"
                : "bg-slate-100/15 border border-slate-200/20 shadow-sm"
            }`}
          />
          {(
            [
              { id: "mock-center" as const, label: "Mock Tests" },
              { id: "weakness-tutor" as const, label: "Weakness & Tutor" },
              { id: "descriptive-eval" as const, label: "Part-II Evaluator" },
              { id: "daily-ca" as const, label: "Daily Current Affairs" },
              ...(isUserAdmin
                ? [{ id: "admin-console" as const, label: "Admin Console" }]
                : []),
            ] as const
          ).map((tab) => {
            const isActive = activeNav === tab.id;
            const isAdminTab = tab.id === "admin-console";
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  navTabRefs.current[tab.id] = el;
                }}
                onClick={() => setActiveNav(tab.id)}
                className={`relative z-10 px-4 py-1.5 rounded-xl transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? isAdminTab
                      ? "text-amber-200 font-semibold bg-amber-400/10"
                      : "text-white font-semibold bg-white/10"
                    : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Primary actions (Buy/Upgrade Subscription for Aspirants + Sign Out) */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => openSubscriptionModal(user.subscriptionTier === "free" ? "pro_prelims" : user.subscriptionTier, false)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Crown className="w-3.5 h-3.5" />
            {user.subscriptionTier === "free"
              ? lang === "bn"
                ? "সাবস্ক্রিপশন কিনুন"
                : "Buy Subscription"
              : lang === "bn"
                ? `প্ল্যান: ${SUBSCRIPTION_TIER_LABELS[user.subscriptionTier]}`
                : `Plan: ${SUBSCRIPTION_TIER_LABELS[user.subscriptionTier]}`}
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Sub-header Workspace Toolbar (Role, Plan, Payment Dues, Language Switch) */}
      <div className="border-b border-slate-900 bg-slate-900/40 px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">
              {user.fullName || user.email}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Role:{" "}
              <strong className="text-emerald-400 uppercase">
                {user.role}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Plan:{" "}
              <strong className="text-amber-300">
                {SUBSCRIPTION_TIER_LABELS[user.subscriptionTier] || user.subscriptionTier}
              </strong>
            </span>
            {(user.totalPaidInr ?? 0) > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-emerald-300">
                  Paid: ₹{user.totalPaidInr}
                </span>
              </>
            )}
            {(user.paymentDueInr ?? 0) > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => openSubscriptionModal(user.subscriptionTier, true)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono font-semibold hover:bg-rose-500/30 cursor-pointer"
                >
                  Payment Due: ₹{user.paymentDueInr} (Pay Now)
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Mobile Nav Selector */}
            <select
              value={activeNav}
              onChange={(e) => setActiveNav(e.target.value as ActiveNav)}
              className="md:hidden px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200"
            >
              <option value="mock-center">Mock Tests</option>
              <option value="weakness-tutor">Weakness &amp; Tutor</option>
              <option value="descriptive-eval">Part-II Evaluator</option>
              <option value="daily-ca">Daily Current Affairs</option>
              {isUserAdmin && <option value="admin-console">Admin Console</option>}             
            </select>

            {/* Interactive Language Segmented Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
              <button
                onClick={() => changeLang("bn")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${lang === "bn"
                    ? "bg-emerald-500 text-slate-950 font-semibold"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                বাংলা (BN)
              </button>
              <button
                onClick={() => changeLang("en")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${lang === "en"
                    ? "bg-emerald-500 text-slate-950 font-semibold"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                English (EN)
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* Status Notification Bar */}
      {statusBanner && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div
            className={`p-3.5 rounded-lg border text-xs flex items-center justify-between ${statusBanner.type === "success"
                ? "bg-emerald-950/50 border-emerald-800 text-emerald-200"
                : statusBanner.type === "error"
                  ? "bg-rose-950/50 border-rose-800 text-rose-200"
                  : "bg-slate-900 border-slate-800 text-slate-200"
              }`}
          >
            <span>{statusBanner.text}</span>
            <button
              onClick={() => setStatusBanner(null)}
              className="text-slate-400 hover:text-white ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* ===================================================================
            TAB 1: MOCK TEST CENTER & LIVE TEST ENGINE
        =================================================================== */}
        {activeNav === "mock-center" && (
          <div className="space-y-8">
            {activeExam && activeTestQuestions.length > 0 ? (
              /* Active Timed Mock Test Runner */
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
                        className={`px-3 py-1.5 rounded-lg text-sm font-mono tabular-nums font-semibold transition-colors ${remainingSec <= 600
                            ? "bg-rose-600 text-white animate-pulse"
                            : "bg-slate-950 border border-slate-800 text-sky-300"
                          }`}
                      >
                        Time Remaining: {formatClock(remainingSec)}
                      </div>
                    )}
                    <button
                      onClick={handlePauseMockTest}
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
                      onClick={handleSubmitMockTest}
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
                      Unanswered ({activeTestQuestions.length - Object.keys(selectedAnswers).length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeTestQuestions.map((q, idx) => {
                      const isAnswered = Boolean(selectedAnswers[q.id]);
                      const isMarked = Boolean(markedForReview[q.id]);
                      const isCurrent = idx === currentQuestionIdx;
                      return (
                        <button
                          key={q.id}
                          onClick={() => setCurrentQuestionIdx(idx)}
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
                {(() => {
                  const q = activeTestQuestions[currentQuestionIdx];
                  if (!q) return null;
                  const chosen = selectedAnswers[q.id];

                  return (
                    <div className="space-y-5 pt-2">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>
                          Question {currentQuestionIdx + 1} of{" "}
                          {activeTestQuestions.length} ·{" "}
                          {lang === "bn" ? q.subjectNameBn : q.subjectNameEn} ·{" "}
                          {lang === "bn" ? q.subtopicNameBn : q.subtopicNameEn}
                        </span>
                        {q.previousYearTag && (
                          <span className="font-mono tabular-nums">
                            {q.previousYearTag}
                          </span>
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

                          const isSel = chosen === optKey;
                          return (
                            <button
                              key={optKey}
                              onClick={() =>
                                setSelectedAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: optKey,
                                }))
                              }
                              className={`p-4 rounded-lg border text-left transition-colors flex items-center gap-3 cursor-pointer ${isSel
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
                            onClick={() =>
                              setSelectedAnswers((prev) => {
                                const copy = { ...prev };
                                delete copy[q.id];
                                return copy;
                              })
                            }
                            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                          >
                            Clear Response
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMarkedForReview((prev) => ({
                                ...prev,
                                [q.id]: !prev[q.id],
                              }))
                            }
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
                            onClick={() =>
                              setCurrentQuestionIdx((i) => Math.max(0, i - 1))
                            }
                            className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-lg cursor-pointer"
                          >
                            Previous
                          </button>
                          {currentQuestionIdx <
                            activeTestQuestions.length - 1 ? (
                            <button
                              onClick={() =>
                                setCurrentQuestionIdx((i) =>
                                  Math.min(
                                    activeTestQuestions.length - 1,
                                    i + 1
                                  )
                                )
                              }
                              className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                            >
                              Next Question
                            </button>
                          ) : (
                            <button
                              onClick={handleSubmitMockTest}
                              disabled={submitting || pausing}
                              className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
                            >
                              {submitting ? "Grading…" : "Finish & Submit"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              /* Exam Selection & Recent Attempt Results */
              <>
              {/* Exam status bar */}
                {examsList.length > 0 && (
                  <LibraryStats exams={examsList} attempts={myAttempts} lang={lang} />
                )}


                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-white">
                      01. Mock Test Series
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                      Select an examination below to begin a bilingual timed test.
                    </p>
                  </div>

                  {myMastery.length > 0 && examsList.length > 0 && (
                    <button
                      onClick={startRemedialTest}
                      className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Launch Remedial Mock (Top 3 Weak Subtopics)
                    </button>
                  )}
                </div>



                {/* Paused / Postponed Ongoing Tests Banner */}
                {myPausedAttempts.length > 0 && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                          <PauseCircle className="w-4 h-4 text-amber-400" />
                          {lang === "bn"
                            ? `স্থগিত / চলমান পরীক্ষা (${myPausedAttempts.length})`
                            : `Paused / Postponed Ongoing Tests (${myPausedAttempts.length})`}
                        </h2>
                        <p className="text-xs text-slate-300 mt-0.5">
                          {lang === "bn"
                            ? "আপনি যেখানে থামিয়েছিলেন ঠিক সেখান থেকেই আপনার স্থগিত পরীক্ষাটি পুনরায় শুরু করুন।"
                            : "Continue your postponed exam from the exact question, timer, and saved answers where you left off."}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {myPausedAttempts.map((pa) => (
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
                              onClick={() => resumePausedTest(pa)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              {lang === "bn" ? "চালিয়ে যান (Resume)" : "Resume Exam"}
                            </button>
                            <button
                              type="button"
                              onClick={() => discardPausedTest(pa.attemptId)}
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
                )}

                {examsList.length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-4">
                    <p className="text-sm text-slate-300">
                      No exams are available yet.
                    </p>
                    <p className="text-xs text-slate-500">
                      {isUserAdmin
                        ? "Create one in Admin Console → Exams & Syllabus, or load the sample data with npm run seed:syllabus && npm run seed."
                        : "Please check back soon."}
                    </p>
                  </div>
                ) : (
                  (() => {
                    const openExam = examsList.find((e) => e.id === openExamId);
                    return openExam ? (
                      <ExamSeriesView
                        key={openExam.id}
                        exam={openExam}
                        series={seriesByExam[openExam.id]}
                        lang={lang}
                        userTier={user.subscriptionTier}
                        userRole={user.role}
                        onBack={() => setOpenExamId(null)}
                        onStartSeries={(x) => startSeriesTest(openExam, x)}
                        onUnlockPaidSeries={(x) =>
                          openSubscriptionModal(
                            x.requiredTier && x.requiredTier !== "free"
                              ? x.requiredTier
                              : "pro_prelims",
                            false
                          )
                        }
                        onResumeSeries={(x) => {
                          const match = myPausedAttempts.find(
                            (pa) => pa.seriesId === x.id || pa.attemptId === x.myPausedAttemptId
                          );
                          if (match) {
                            resumePausedTest(match);
                          } else {
                            api<{ pausedAttempts: PausedAttemptDto[] }>("/me/paused-attempts")
                              .then((res) => {
                                setMyPausedAttempts(res.pausedAttempts);
                                const found = res.pausedAttempts.find((pa) => pa.seriesId === x.id);
                                if (found) resumePausedTest(found);
                                else startSeriesTest(openExam, x);
                              })
                              .catch(() => startSeriesTest(openExam, x));
                          }
                        }}
                        onStartRandom={() => startMockTest(openExam)}
                      >
                        <div className="space-y-3 border-t border-slate-800 pt-6">
                          <h3 className="text-base font-bold text-white">
                            {lang === "bn" ? "এই পরীক্ষায় আপনার ফলাফল" : "Your history in this exam"}
                          </h3>
                          <AttemptHistory
                            attempts={myAttempts.filter((a) => a.examId === openExam.id)}
                            lang={lang}
                            showExam={false}
                            highlightId={lastAttemptId}
                            emptyText={
                              lang === "bn"
                                ? "আপনি এখনও এই পরীক্ষার কোনো টেস্ট দেননি।"
                                : "You haven't taken a test in this exam yet."
                            }
                          />
                        </div>
                      </ExamSeriesView>
                    ) : (
                      <ExamCards exams={examsList} lang={lang} onOpen={openExamSeries} />
                    );
                  })()
                )}

                {/* Aspirant Subscription & Plan Banner (Visible to Aspirants on Dashboard) */}
                {!isUserAdmin && (
                  <section className="rounded-xl border border-amber-500/35 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/25 p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
                          <Crown className="w-4 h-4" />
                          {lang === "bn"
                            ? "আপনার সাবস্ক্রিপশন ও পেইড টেস্ট পাস"
                            : "Your Subscription Plan & Paid Test Access"}
                        </div>
                        <h2 className="text-lg font-bold text-white">
                          {lang === "bn" ? "বর্তমান প্ল্যান: " : "Current Plan: "}
                          <span className="text-amber-300">
                            {SUBSCRIPTION_TIER_LABELS[user.subscriptionTier] || user.subscriptionTier}
                          </span>
                        </h2>
                        <p className="text-xs text-slate-300">
                          {lang === "bn"
                            ? "প্রিলিমস, মেইনস টিয়ার, পার্ট-II ডেসক্রিপটিভ বা WBCS এক্সিকিউটিভ পাস কিনুন এবং সকল পেইড মক টেস্ট আনলক করুন।"
                            : "Purchase or upgrade to Pro Prelims, Mains Tier, Part-II Tier, or WBCS Executive Pass using Test Payment (shared live with Admin)."}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="rounded-lg bg-slate-950/90 border border-slate-800 px-3.5 py-2 text-xs font-mono">
                          <span className="text-slate-400">Total Paid: </span>
                          <strong className="text-emerald-400">₹{user.totalPaidInr ?? 0}</strong>
                          <span className="mx-2 text-slate-700">|</span>
                          <span className="text-slate-400">Payment Due: </span>
                          <strong
                            className={
                              (user.paymentDueInr ?? 0) > 0 ? "text-rose-400" : "text-slate-200"
                            }
                          >
                            ₹{user.paymentDueInr ?? 0}
                          </strong>
                        </div>

                        {(user.paymentDueInr ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => openSubscriptionModal(user.subscriptionTier, true)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-rose-500 hover:bg-rose-400 text-slate-950 rounded-lg cursor-pointer"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            Pay Due (₹{user.paymentDueInr})
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            openSubscriptionModal(
                              user.subscriptionTier === "free"
                                ? "pro_prelims"
                                : "wbcs_executive_pass",
                              false
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg cursor-pointer"
                        >
                          <Crown className="w-3.5 h-3.5" />
                          {user.subscriptionTier === "free"
                            ? lang === "bn"
                              ? "সাবস্ক্রিপশন কিনুন (Test Pay)"
                              : "Buy Subscription (Test Payment)"
                            : lang === "bn"
                              ? "প্ল্যান পরিবর্তন / আপগ্রেড"
                              : "Upgrade / Change Plan"}
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {/* ===================================================================
                    ADMIN SECTION BELOW 01. MOCK TEST SERIES:
                    1) EVERY STUDENT'S EXAM PERFORMANCE (Fixed-height scrollable table)
                    2) STUDENT SUBSCRIPTION & PAYMENT DUES MANAGEMENT
                =================================================================== */}
                {isUserAdmin && (
                  <div className="space-y-8 pt-2">
                    {/* Admin Section A: Every Student's Exam Performance Table */}
                    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Award className="w-5 h-5 text-emerald-400" />
                            Student Mock Result &amp; Exam Performance (All Aspirants)
                          </h2>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Live performance across all students — Aspirant Name, Plan Type, Enrolled Exam, Test Given, Score, Negative Marks, Accuracy &amp; Status.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="search"
                            value={perfSearchQuery}
                            onChange={(e) => setPerfSearchQuery(e.target.value)}
                            placeholder="Search aspirant, exam, series, plan…"
                            className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none w-64"
                          />
                          <button
                            type="button"
                            onClick={loadAdminData}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Refresh
                          </button>
                        </div>
                      </div>

                      {/* Fixed height table container with vertical scrolling on overflow */}
                      <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                            <tr>
                              <th className="py-3 px-3.5 whitespace-nowrap">Aspirant Name</th>
                              <th className="py-3 px-3.5 whitespace-nowrap">Type of Plan</th>
                              <th className="py-3 px-3.5 whitespace-nowrap">Enrolled Exam</th>
                              <th className="py-3 px-3.5 whitespace-nowrap">Test Given</th>
                              <th className="py-3 px-3.5 text-right whitespace-nowrap">Score</th>
                              <th className="py-3 px-3.5 text-right whitespace-nowrap">Negative Marks</th>
                              <th className="py-3 px-3.5 text-right whitespace-nowrap">Accuracy</th>
                              <th className="py-3 px-3.5 whitespace-nowrap">Attempt Details &amp; Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {(() => {
                              const q = perfSearchQuery.trim().toLowerCase();
                              const filtered = allAttempts.filter((att) => {
                                if (!q) return true;
                                const hay = [
                                  att.userName,
                                  att.userEmail,
                                  att.userSubscriptionTier,
                                  att.userTargetExamSlug,
                                  att.examTitleEn,
                                  att.series?.name.en,
                                ]
                                  .filter(Boolean)
                                  .join(" ")
                                  .toLowerCase();
                                return hay.includes(q);
                              });

                              if (filtered.length === 0) {
                                return (
                                  <tr>
                                    <td colSpan={8} className="py-8 px-4 text-center text-slate-400">
                                      No student exam attempts match the filter yet.
                                    </td>
                                  </tr>
                                );
                              }

                              return filtered.map((att) => {
                                const tier = att.userSubscriptionTier || "free";
                                const isPaused = att.attemptStatus === "in_progress";
                                const testGivenLabel = att.series
                                  ? att.series.name.en
                                  : att.isRemedial
                                    ? `Remedial Mock (${att.examTitleEn})`
                                    : `Random Mock (${att.examTitleEn})`;
                                return (
                                  <tr key={att.id} className="hover:bg-slate-900/70 transition-colors">
                                    <td className="py-3 px-3.5">
                                      <div className="font-semibold text-white">
                                        {att.userName || "Aspirant"}
                                      </div>
                                      <div className="text-[11px] text-slate-400 font-mono">
                                        {att.userEmail}
                                      </div>
                                    </td>
                                    <td className="py-3 px-3.5 whitespace-nowrap">
                                      <span
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                          tier === "free"
                                            ? "bg-slate-800/80 border-slate-700 text-slate-300"
                                            : "bg-amber-500/15 border-amber-500/35 text-amber-300"
                                        }`}
                                      >
                                        {SUBSCRIPTION_TIER_LABELS[tier] || tier}
                                      </span>
                                    </td>
                                    <td className="py-3 px-3.5">
                                      <div className="text-slate-200 font-medium">
                                        {att.examTitleEn}
                                      </div>
                                      <div className="text-[11px] text-slate-500 font-mono">
                                        Target: {att.userTargetExamSlug || att.examSlug}
                                      </div>
                                    </td>
                                    <td className="py-3 px-3.5">
                                      <div className="font-semibold text-white flex flex-wrap items-center gap-1.5">
                                        <span>{testGivenLabel}</span>
                                        {att.series?.accessType === "paid" ? (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                            PAID
                                          </span>
                                        ) : (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                            FREE
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-400">
                                        {att.submittedAt
                                          ? new Date(att.submittedAt).toLocaleString()
                                          : att.startedAt
                                            ? `Started ${new Date(att.startedAt).toLocaleString()}`
                                            : "—"}
                                      </div>
                                    </td>
                                    <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                                      <div className="font-bold text-emerald-400">
                                        {att.finalNetScore} / {att.maxPossibleScore}
                                      </div>
                                      <div className="text-[11px] text-slate-400">
                                        +{att.rawPositiveScore ?? att.correctCount} raw ({att.correctCount}✓)
                                      </div>
                                    </td>
                                    <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                                      <div className="font-bold text-rose-400">
                                        −{att.negativePenalty ?? 0}
                                      </div>
                                      <div className="text-[11px] text-slate-400">
                                        {att.incorrectCount} wrong
                                      </div>
                                    </td>
                                    <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                                      <span
                                        className={`px-2 py-0.5 rounded font-bold ${
                                          att.accuracyPercentage >= 70
                                            ? "bg-emerald-500/15 text-emerald-300"
                                            : att.accuracyPercentage >= 45
                                              ? "bg-amber-500/15 text-amber-300"
                                              : "bg-rose-500/15 text-rose-300"
                                        }`}
                                      >
                                        {att.accuracyPercentage}%
                                      </span>
                                    </td>
                                    <td className="py-3 px-3.5 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5">
                                        {isPaused ? (
                                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                            PAUSED / ONGOING
                                          </span>
                                        ) : att.cutoffCleared ? (
                                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                            CUTOFF CLEARED
                                          </span>
                                        ) : (
                                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                                            BELOW CUTOFF
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                        {att.attemptedCount}/{att.totalQuestions} attempted · {formatClock(att.totalTimeSpentSeconds)}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    {/* Admin Section B: Student Subscription & Payment Dues Management (Below Student Mock Result) */}
                    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <CreditCard className="w-5 h-5 text-amber-400" />
                            Student Subscription &amp; Payment Dues Management
                          </h2>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Manage every student&apos;s subscription tier (Free, Prelims, Mains Tier, Part-II Tier, WBCS Executive Pass), total paid amount, and pending payment dues.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="search"
                            value={subSearchQuery}
                            onChange={(e) => setSubSearchQuery(e.target.value)}
                            placeholder="Search student or plan…"
                            className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none w-60"
                          />
                        </div>
                      </div>

                      {/* Subscription KPI Summary Bar */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                          <div className="text-[11px] text-slate-400">Total Registered Users</div>
                          <div className="text-xl font-bold font-mono text-white mt-0.5">
                            {allUsers.length}
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                          <div className="text-[11px] text-slate-400">Paid Plan Subscribers</div>
                          <div className="text-xl font-bold font-mono text-amber-300 mt-0.5">
                            {allUsers.filter((u) => u.subscriptionTier !== "free").length}
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                          <div className="text-[11px] text-slate-400">Total Test Payments Collected</div>
                          <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                            ₹
                            {allUsers
                              .reduce((sum, u) => sum + (u.totalPaidInr ?? 0), 0)
                              .toLocaleString("en-IN")}
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                          <div className="text-[11px] text-slate-400">Outstanding Payment Dues</div>
                          <div className="text-xl font-bold font-mono text-rose-400 mt-0.5">
                            ₹
                            {allUsers
                              .reduce((sum, u) => sum + (u.paymentDueInr ?? 0), 0)
                              .toLocaleString("en-IN")}
                          </div>
                        </div>
                      </div>

                      {/* Inline Manage Student Subscription Modal / Card */}
                      {managingStudentSub && (
                        <form
                          onSubmit={handleAdminManageSubscription}
                          className="rounded-xl border border-amber-500/40 bg-slate-950 p-4 space-y-4"
                        >
                          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                            <div>
                              <h3 className="text-sm font-bold text-white">
                                Manage Subscription &amp; Dues — {managingStudentSub.user.fullName} ({managingStudentSub.user.email})
                              </h3>
                              <p className="text-[11px] text-slate-400">
                                Assign plan tier, record a payment, or set/waive outstanding payment dues.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setManagingStudentSub(null)}
                              className="text-slate-400 hover:text-white cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                            <label className="space-y-1 text-slate-300">
                              <span>Subscription Plan Tier *</span>
                              <select
                                value={managingStudentSub.planTier}
                                onChange={(e) => {
                                  const nextTier = e.target.value as SubscriptionTier;
                                  setManagingStudentSub((prev) =>
                                    prev ? { ...prev, planTier: nextTier } : null
                                  );
                                }}
                                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                              >
                                {SUBSCRIPTION_TIER_PLANS.map((p) => (
                                  <option key={p.tier} value={p.tier}>
                                    {p.shortLabel} (₹{p.priceInr})
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="space-y-1 text-slate-300">
                              <span>Billing Cycle</span>
                              <select
                                value={managingStudentSub.billingCycle}
                                onChange={(e) =>
                                  setManagingStudentSub((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          billingCycle: e.target.value as
                                            | "monthly"
                                            | "quarterly"
                                            | "yearly"
                                            | "lifetime",
                                        }
                                      : null
                                  )
                                }
                                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                              >
                                <option value="yearly">Yearly</option>
                                <option value="quarterly">Quarterly</option>
                                <option value="monthly">Monthly</option>
                                <option value="lifetime">Lifetime</option>
                              </select>
                            </label>

                            <label className="space-y-1 text-slate-300">
                              <span>Additional Amount Paid Now (₹)</span>
                              <input
                                type="number"
                                min={0}
                                step="1"
                                value={managingStudentSub.amountPaidNowInr}
                                onChange={(e) =>
                                  setManagingStudentSub((prev) =>
                                    prev ? { ...prev, amountPaidNowInr: e.target.value } : null
                                  )
                                }
                                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                              />
                            </label>

                            <label className="space-y-1 text-slate-300">
                              <span className="flex items-center justify-between">
                                <span>Remaining Payment Due (₹)</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setManagingStudentSub((prev) =>
                                      prev ? { ...prev, paymentDueInr: "0" } : null
                                    )
                                  }
                                  className="text-[10px] text-emerald-400 hover:underline cursor-pointer"
                                >
                                  Clear Due (₹0)
                                </button>
                              </span>
                              <input
                                type="number"
                                min={0}
                                step="1"
                                value={managingStudentSub.paymentDueInr}
                                onChange={(e) =>
                                  setManagingStudentSub((prev) =>
                                    prev ? { ...prev, paymentDueInr: e.target.value } : null
                                  )
                                }
                                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                              />
                            </label>

                            <label className="space-y-1 text-slate-300 sm:col-span-2 lg:col-span-4">
                              <span>Billing / Subscription Notes</span>
                              <input
                                type="text"
                                value={managingStudentSub.notes}
                                onChange={(e) =>
                                  setManagingStudentSub((prev) =>
                                    prev ? { ...prev, notes: e.target.value } : null
                                  )
                                }
                                placeholder="e.g., Paid ₹200 via test payment, ₹99 due next month"
                                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                              />
                            </label>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              disabled={manageSubBusy}
                              className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                            >
                              {manageSubBusy ? "Saving…" : "Save Subscription & Payment Dues"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setManagingStudentSub(null)}
                              className="px-3.5 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Fixed-height Vertically Scrollable Student Subscriptions Table */}
                      <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                            <tr>
                              <th className="py-3 px-3.5 whitespace-nowrap">Aspirant</th>
                              <th className="py-3 px-3.5 whitespace-nowrap">Current Plan Tier</th>
                              <th className="py-3 px-3.5 text-right whitespace-nowrap">Plan Price</th>
                              <th className="py-3 px-3.5 text-right whitespace-nowrap">Total Paid</th>
                              <th className="py-3 px-3.5 text-right whitespace-nowrap">Payment Due</th>
                              <th className="py-3 px-3.5 whitespace-nowrap">Payment Status</th>
                              <th className="py-3 px-3.5 whitespace-nowrap">Last Transaction / Notes</th>
                              <th className="py-3 px-3.5 text-right whitespace-nowrap">Manage</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {(() => {
                              const q = subSearchQuery.trim().toLowerCase();
                              const filteredUsers = allUsers.filter((u) => {
                                if (!q) return true;
                                return (
                                  u.fullName.toLowerCase().includes(q) ||
                                  u.email.toLowerCase().includes(q) ||
                                  u.subscriptionTier.toLowerCase().includes(q)
                                );
                              });

                              if (filteredUsers.length === 0) {
                                return (
                                  <tr>
                                    <td colSpan={8} className="py-8 px-4 text-center text-slate-400">
                                      No students match your search.
                                    </td>
                                  </tr>
                                );
                              }

                              return filteredUsers.map((u) => {
                                const planMeta =
                                  SUBSCRIPTION_TIER_PLANS.find(
                                    (p) => p.tier === u.subscriptionTier
                                  ) ?? SUBSCRIPTION_TIER_PLANS[0];
                                const latestTx = allSubscriptions.find((s) => s.userId === u.id);
                                const due = u.paymentDueInr ?? 0;
                                const paid = u.totalPaidInr ?? 0;

                                return (
                                  <tr key={u.id} className="hover:bg-slate-900/70 transition-colors">
                                    <td className="py-3 px-3.5">
                                      <div className="font-semibold text-white">{u.fullName}</div>
                                      <div className="text-[11px] text-slate-400 font-mono">
                                        {u.email}
                                      </div>
                                    </td>
                                    <td className="py-3 px-3.5 whitespace-nowrap">
                                      <select
                                        value={u.subscriptionTier}
                                        onChange={(e) =>
                                          handleAdminUpdateUser(u, {
                                            subscriptionTier: e.target.value as SubscriptionTier,
                                          })
                                        }
                                        className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-white text-xs"
                                      >
                                        {SUBSCRIPTION_TIER_PLANS.map((p) => (
                                          <option key={p.tier} value={p.tier}>
                                            {p.shortLabel} ({p.tier})
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-300">
                                      ₹{planMeta.priceInr}
                                    </td>
                                    <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-emerald-400">
                                      ₹{paid}
                                    </td>
                                    <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                                      <span
                                        className={`font-bold ${
                                          due > 0 ? "text-rose-400" : "text-slate-400"
                                        }`}
                                      >
                                        ₹{due}
                                      </span>
                                    </td>
                                    <td className="py-3 px-3.5 whitespace-nowrap">
                                      {due > 0 ? (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                          PAYMENT DUE (₹{due})
                                        </span>
                                      ) : u.subscriptionTier !== "free" ? (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                          PAID &amp; ACTIVE
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                                          FREE TIER
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-3 px-3.5">
                                      {latestTx ? (
                                        <div>
                                          <div className="font-mono text-[11px] text-amber-300">
                                            {latestTx.transactionRef} · ₹{latestTx.amountPaidInr} ({latestTx.paymentMode})
                                          </div>
                                          <div className="text-[11px] text-slate-400 truncate max-w-xs">
                                            {latestTx.notes || u.billingNotes || new Date(latestTx.createdAt).toLocaleDateString()}
                                          </div>
                                        </div>
                                      ) : (
                                        <span className="text-slate-500">
                                          {u.billingNotes || "No payment record yet"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-3 px-3.5 text-right whitespace-nowrap">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setManagingStudentSub({
                                            user: u,
                                            planTier: u.subscriptionTier,
                                            amountPaidNowInr: "0",
                                            paymentDueInr: String(u.paymentDueInr ?? 0),
                                            billingCycle: "yearly",
                                            notes: u.billingNotes ?? "",
                                          })
                                        }
                                        className="px-2.5 py-1 text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 rounded-md cursor-pointer"
                                      >
                                        Manage Plan / Dues
                                      </button>
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                )}

                {/* All attempts, below the exam cards */}
                {!examsList.some((e) => e.id === openExamId) && (
                  <div className="space-y-3">
                    <h2 className="text-lg font-bold text-white">02. Your Mock Test History</h2>
                    <AttemptHistory
                      attempts={myAttempts}
                      lang={lang}
                      highlightId={lastAttemptId}
                      emptyText={
                        lang === "bn"
                          ? "এখনও কোনো টেস্ট দেওয়া হয়নি — উপরের একটি পরীক্ষা খুলে শুরু করুন।"
                          : "No tests taken yet — open an exam above to start."
                      }
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ===================================================================
            TAB 2: WEAKNESS RADAR & 3-TIER CACHED AI TUTOR
        =================================================================== */}
        {activeNav === "weakness-tutor" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-6 space-y-4">
              <div>
                <h1 className="text-xl font-bold text-white">
                  01. Subtopic Weakness &amp; Mastery Matrix
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Sorted by lowest accuracy first. Click any subtopic to open its L2
                  cached AI study note (or generate on cache miss).
                </p>
              </div>

              {myMastery.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-xs text-slate-400 space-y-3">
                  <p>
                    Complete at least one Mock Test to populate your deterministic
                    subtopic mastery breakdown.
                  </p>
                  <button
                    onClick={() => setActiveNav("mock-center")}
                    className="px-3.5 py-2 bg-emerald-500 text-slate-950 font-semibold rounded-lg cursor-pointer"
                  >
                    Go to Mock Tests
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {myMastery.map((m) => {
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
                        className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="text-xs text-slate-400">
                            {m.subjectName[lang]} ·{" "}
                            <span className="font-mono tabular-nums">
                              Accuracy: {m.accuracyPercentage}%
                            </span>{" "}
                            ·{" "}
                            <span className="font-mono tabular-nums">
                              Avg Time: {m.avgTimeSeconds}s
                            </span>
                          </div>
                          <div className="text-sm font-bold text-white">
                            {m.subtopicName[lang]}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            Band: {m.masteryBand} · Seen {m.totalEncountered} · Correct{" "}
                            {m.totalCorrect}
                          </div>
                        </div>

                        <button
                          onClick={() => handleOpenOrGenerateAiNote(m)}
                          disabled={isGenerating}
                          className="px-3.5 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {isGenerating
                            ? "Generating via Gemini..."
                            : isCached
                              ? "Open Cached Note (free)"
                              : "Generate AI Revision Note"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: Study Note Viewer */}
            <div className="lg:col-span-6 space-y-4">
              <div>
                <h2 className="text-xl font-bold text-white">
                  02. Bilingual AI Revision Note Viewer
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Notes are cached once and shared by all students (Redis + PostgreSQL),
                  so a topic is generated by AI only the first time.
                </p>
              </div>

              {selectedNote ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                  <div className="border-b border-slate-800 pb-3">
                    <div className="text-xs text-slate-400 font-mono">
                      {selectedNote.examSlug}:{selectedNote.topicSlug}:{selectedNote.language} ·{" "}
                      {selectedNote.cached ? "from cache" : "freshly generated"} · Model:{" "}
                      {selectedNote.modelUsed}
                    </div>
                    <h3 className="text-lg font-bold text-white mt-1">
                      {selectedNote.topicTitle[selectedNote.language]}
                    </h3>
                  </div>

                  <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {selectedNote.contentMarkdown}
                  </div>

                  <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                    <div className="text-xs font-semibold text-emerald-400">
                      Memory Mnemonics (মনে রাখার কৌশল):
                    </div>
                    <div className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {selectedNote.mnemonics.join("\n")}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-xs text-slate-400">
                  Select a subtopic on the left to open its revision note.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 3: PART-II DESCRIPTIVE ANSWER EVALUATOR
        =================================================================== */}
        {activeNav === "descriptive-eval" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <form
              onSubmit={handleEvaluateDescriptive}
              className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4"
            >
              <div>
                <h1 className="text-xl font-bold text-white">
                  01. WBPSC Part-II &amp; Mains Descriptive Evaluator
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Evaluates Bengali/English Report Writing, Précis, or Translation out
                  of 25 marks via typed text or photographed handwritten sheets.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Examination
                  </label>
                  <select
                    value={descExamSlug}
                    onChange={(e) => setDescExamSlug(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                  >
                    <option value="wbpsc-clerkship-part2">
                      Clerkship Part-II
                    </option>
                    <option value="wbcs-mains">WBCS Mains Paper I/II</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Task Type
                  </label>
                  <select
                    value={descTaskType}
                    onChange={(e) => setDescTaskType(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                  >
                    <option value="report_writing">
                      Report Writing (প্রতিবেদন)
                    </option>
                    <option value="precis_writing">
                      Précis Writing (সারাংশ)
                    </option>
                    <option value="translation">
                      Translation (বঙ্গানুবাদ)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Word Limit
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={500}
                    value={descWordLimit}
                    onChange={(e) => setDescWordLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Question Prompt / Source Passage
                </label>
                <textarea
                  rows={2}
                  value={descPrompt}
                  onChange={(e) => setDescPrompt(e.target.value)}
                  className="w-full p-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Student Typed Answer (or upload handwritten photo below)
                </label>
                <textarea
                  rows={6}
                  value={descStudentText}
                  onChange={(e) => setDescStudentText(e.target.value)}
                  className="w-full p-3 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <label className="px-3.5 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 cursor-pointer">
                  <span>
                    {descImageBase64
                      ? "Handwritten Photo Attached"
                      : "Upload Handwritten Sheet (JPEG/PNG)"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>

                <button
                  type="submit"
                  disabled={descEvalBusy}
                  className="px-5 py-2.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors cursor-pointer"
                >
                  {descEvalBusy
                    ? "Evaluating Rubric..."
                    : "Evaluate Descriptive Answer"}
                </button>
              </div>
            </form>

            {/* Right: Structured Rubric Scorecard */}
            <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <h2 className="text-xl font-bold text-white">
                02. Examiner Rubric &amp; Model Answer
              </h2>

              {descEvaluationResult ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-4 gap-3 p-4 rounded-lg bg-slate-950 border border-slate-800">
                    <div>
                      <div className="text-[11px] text-slate-400">Total Score</div>
                      <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums">
                        {descEvaluationResult.totalScore}/25
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Grammar</div>
                      <div className="text-lg font-bold text-white font-mono tabular-nums">
                        {descEvaluationResult.grammarScore}/10
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Content</div>
                      <div className="text-lg font-bold text-white font-mono tabular-nums">
                        {descEvaluationResult.contentScore}/10
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">
                        Word Limit ({descEvaluationResult.estimatedWordCount}w)
                      </div>
                      <div className="text-lg font-bold text-white font-mono tabular-nums">
                        {descEvaluationResult.wordLimitScore}/5
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-emerald-400">
                      Strengths:
                    </div>
                    <ul className="list-disc pl-5 text-xs text-slate-300 space-y-1">
                      {(descEvaluationResult.strengths || []).map(
                        (s: string, i: number) => (
                          <li key={i}>{s}</li>
                        )
                      )}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-amber-400">
                      Improvements Needed:
                    </div>
                    <ul className="list-disc pl-5 text-xs text-slate-300 space-y-1">
                      {(descEvaluationResult.improvementsNeeded || []).map(
                        (s: string, i: number) => (
                          <li key={i}>{s}</li>
                        )
                      )}
                    </ul>
                  </div>

                  <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                    <div className="text-xs font-semibold text-emerald-400">
                      Corrected WBPSC Model Answer:
                    </div>
                    <div className="text-xs sm:text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {descEvaluationResult.correctedModelAnswer}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 leading-relaxed">
                  Submit a Bengali or English descriptive response on the left to
                  receive a 25-mark breakdown (Grammar, Content, Word Limit) and a
                  high-scoring WBPSC model answer.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 4: DAILY CURRENT AFFAIRS GENERATOR
        =================================================================== */}
        {activeNav === "daily-ca" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-white">
                    01. Bilingual Daily Current Affairs Digest Generator
                  </h1>
                  <p className="text-xs text-slate-400 mt-1">
                    Synthesizes National &amp; West Bengal state headlines into
                    bilingual bullet points, Static GK links, and PYQ MCQs.
                  </p>
                </div>
                <button
                  onClick={handleGenerateDailyCA}
                  disabled={caBusy}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
                >
                  {caBusy
                    ? "Synthesizing Bilingual Digest..."
                    : "Synthesize Today's Digest"}
                </button>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Headlines to Synthesize (semicolon separated)
                </label>
                <input
                  type="text"
                  value={caHeadlinesInput}
                  onChange={(e) => setCaHeadlinesInput(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>
            </div>

            {caDigestResult && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <div className="text-xs text-emerald-400 font-mono">
                      Edition: {caDigestResult.editionDate}
                    </div>
                    <h2 className="text-lg font-bold text-white">
                      {lang === "bn"
                        ? caDigestResult.titleBn
                        : caDigestResult.titleEn}
                    </h2>
                  </div>
                  <button
                    onClick={() => window.print()}
                    className="px-3.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                  >
                    Print / Save PDF
                  </button>
                </div>
                <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {caDigestResult.contentMarkdown}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            TAB 5: ADMIN CONSOLE ("Admin Should Manage Everything")
        =================================================================== */}
        {activeNav === "admin-console" && isUserAdmin && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h1 className="text-2xl font-bold text-white">
                  ADMIN Control Panel
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Users &amp; plans, exams &amp; syllabus, the question bank, AI cache and
                  all attempts — stored in PostgreSQL.
                </p>
              </div>

            </div>

            {/* Admin Sub-Navigation Tabs */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg w-fit">
              <button
                onClick={() => setAdminTab("users")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${adminTab === "users"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                1. Users &amp; RBAC ({allUsers.length})
              </button>
              <button
                onClick={() => setAdminTab("exams")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${adminTab === "exams"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                2. Exams &amp; Syllabus ({examsList.length})
              </button>
              <button
                onClick={() => setAdminTab("cache-attempts")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${adminTab === "cache-attempts"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                3. AI Cache ({cachedNotes.length}) &amp; Attempts ({allAttempts.length})
              </button>
              <button
                onClick={() => setAdminTab("bulk-import")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${adminTab === "bulk-import"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                4. Question Bank (Add · Bulk · AI)
              </button>
              <button
                onClick={() => setAdminTab("series")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${adminTab === "series"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                5. Exam Series
              </button>
            </div>

            {/* Sub-Tab 5: Exam type → test series → subjects + questions (Kanban) */}
            {adminTab === "series" && (
              <QuestionBankAdmin section="series" onExamsChanged={loadExams} />
            )}

            {/* Sub-Tab 4: Question Bank — one-by-one, bulk CSV/JSON, AI → review → live */}
            {adminTab === "bulk-import" && (
              <QuestionBankAdmin section="questions" onExamsChanged={loadExams} />
            )}

            {/* Sub-Tab 1: Users & RBAC Manager */}
            {adminTab === "users" && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-3 px-4">User / Email</th>
                      <th className="py-3 px-4">Role (RBAC)</th>
                      <th className="py-3 px-4">Subscription Tier</th>
                      <th className="py-3 px-4">Sign-in</th>
                      <th className="py-3 px-4">Account Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {allUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-800/30">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">
                            {u.fullName}
                          </div>
                          <div className="text-slate-400 font-mono text-[11px]">
                            {u.email}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {u.role === "admin" ? (
                            <span className="px-2.5 py-1 text-amber-400 font-semibold">
                              admin
                            </span>
                          ) : (
                            <select
                              value={u.role}
                              onChange={(e) =>
                                handleAdminUpdateUser(u, {
                                  role: e.target.value as Exclude<UserRole, "admin">,
                                })
                              }
                              className="px-2.5 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                            >
                              <option value="aspirant">aspirant</option>
                              <option value="educator">educator</option>
                            </select>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <select
                            value={u.subscriptionTier}
                            onChange={(e) =>
                              handleAdminUpdateUser(u, {
                                subscriptionTier: e.target
                                  .value as SubscriptionTier,
                              })
                            }
                            className="px-2.5 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                          >
                            {SUBSCRIPTION_TIER_PLANS.map((p) => (
                              <option key={p.tier} value={p.tier}>
                                {p.tier} ({p.shortLabel})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {[u.hasPassword && "password", u.hasGoogle && "Google"]
                            .filter(Boolean)
                            .join(" + ") || "—"}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            disabled={u.role === "admin"}
                            onClick={() =>
                              handleAdminUpdateUser(u, {
                                isActive: !u.isActive,
                              })
                            }
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${u.isActive
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-rose-500/20 text-rose-300"
                              }`}
                          >
                            {u.isActive ? "Active" : "Suspended"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-Tab 2: Exams & Syllabus */}
            {adminTab === "exams" && (
              <QuestionBankAdmin section="exams" onExamsChanged={loadExams} />
            )}

            {/* Sub-Tab 3: AI Notes Cache & All User Attempts */}
            {adminTab === "cache-attempts" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-white">
                    Cached AI Study Notes ({cachedNotes.length})
                  </h3>
                  {cachedNotes.map((n) => (
                    <div
                      key={`${n.examSlug}:${n.topicSlug}:${n.language}`}
                      className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-white">
                          {n.examSlug}:{n.topicSlug}:{n.language}
                        </div>
                        <div className="text-slate-400">
                          Hits: {n.hitCount} · Model: {n.modelUsed}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-white">
                    All Aspirant Mock Submissions ({allAttempts.length})
                  </h3>
                  {allAttempts.map((att) => (
                    <div
                      key={att.id}
                      className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-white">
                          {att.userName} ({att.userEmail})
                        </div>
                        <div className="text-slate-400">
                          {att.examTitleEn} · Net: {att.finalNetScore} · Acc:{" "}
                          {att.accuracyPercentage}% ·{" "}
                          {att.submittedAt ? new Date(att.submittedAt).toLocaleString() : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ===================================================================
          ASPIRANT SUBSCRIPTION & TEST PAYMENT MODAL
          (Simulated Test Paid Amount before Razorpay integration — shared with Admin)
      =================================================================== */}
      {showSubscriptionModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl border border-amber-500/40 bg-slate-900 p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
                  <Crown className="w-4 h-4" />
                  WBPSC Mock Tutor Subscription Pass (Test Payment Mode)
                </span>
                <h2 className="text-xl font-bold text-white mt-1">
                  {payExistingDueOnly
                    ? "Clear Pending Subscription Dues"
                    : "Choose Your Subscription Tier & Complete Test Payment"}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select a plan below and confirm the Test Paid Amount. Your plan and payment details are immediately synced with the Admin Console.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubscriptionModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800/70 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePurchaseSubscription} className="space-y-5">
              {/* Plan Tier Cards */}
              {!payExistingDueOnly && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SUBSCRIPTION_TIER_PLANS.filter((p) => p.tier !== "free").map((plan) => {
                    const isSelected = selectedPurchaseTier === plan.tier;
                    return (
                      <button
                        key={plan.tier}
                        type="button"
                        onClick={() => {
                          setSelectedPurchaseTier(plan.tier);
                          setTestPaidAmountInput(String(plan.priceInr));
                        }}
                        className={`text-left p-4 rounded-xl border-2 transition-all cursor-pointer space-y-2 ${
                          isSelected
                            ? "bg-amber-500/15 border-amber-400 text-white shadow-lg shadow-amber-950/30"
                            : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                            {plan.shortLabel}
                          </span>
                          <span className="text-lg font-bold font-mono text-white">
                            ₹{plan.priceInr}
                            <span className="text-[11px] font-normal text-slate-400">/yr</span>
                          </span>
                        </div>
                        <div className="text-sm font-bold text-white">
                          {lang === "bn" ? plan.labelBn : plan.labelEn}
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {lang === "bn" ? plan.descriptionBn : plan.descriptionEn}
                        </p>
                        <ul className="space-y-1 pt-1">
                          {plan.features.map((f, i) => (
                            <li key={i} className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Payment Mode & Test Paid Amount Inputs */}
              {(() => {
                const chosenPlan =
                  SUBSCRIPTION_TIER_PLANS.find((p) => p.tier === selectedPurchaseTier) ??
                  SUBSCRIPTION_TIER_PLANS[1];
                const existingDue = user.paymentDueInr ?? 0;
                const targetPrice = payExistingDueOnly ? existingDue : chosenPlan.priceInr;
                const payingNow = Math.max(0, Number(testPaidAmountInput) || 0);
                const projectedDue = payExistingDueOnly
                  ? Math.max(0, Number((existingDue - payingNow).toFixed(2)))
                  : Math.max(0, Number((existingDue + (targetPrice - payingNow)).toFixed(2)));

                return (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <label className="space-y-1 text-slate-300">
                        <span className="font-semibold text-amber-300">
                          Test Paid Amount (₹ INR) *
                        </span>
                        <input
                          type="number"
                          required
                          min={0}
                          max={50000}
                          step="1"
                          value={testPaidAmountInput}
                          onChange={(e) => setTestPaidAmountInput(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-sm"
                        />
                        <span className="block text-[11px] text-slate-500">
                          Enter full fee (₹{targetPrice}) or a partial test amount to simulate payment due.
                        </span>
                      </label>

                      <label className="space-y-1 text-slate-300">
                        <span>Billing Cycle</span>
                        <select
                          value={purchaseBillingCycle}
                          onChange={(e) =>
                            setPurchaseBillingCycle(
                              e.target.value as "monthly" | "quarterly" | "yearly"
                            )
                          }
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                        >
                          <option value="yearly">Yearly (12 Months)</option>
                          <option value="quarterly">Quarterly (3 Months)</option>
                          <option value="monthly">Monthly (1 Month)</option>
                        </select>
                      </label>

                      <label className="space-y-1 text-slate-300">
                        <span>Reference Note (Optional)</span>
                        <input
                          type="text"
                          value={purchaseNotesInput}
                          onChange={(e) => setPurchaseNotesInput(e.target.value)}
                          placeholder="e.g., Test payment for Prelims/Mains"
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                        />
                      </label>
                    </div>

                    {/* Live Summary Strip */}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-900 border border-slate-800 px-4 py-3 text-xs font-mono">
                      <div>
                        <span className="text-slate-400">Selected Plan Fee: </span>
                        <strong className="text-white">₹{targetPrice}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Test Amount Paying Now: </span>
                        <strong className="text-emerald-400">₹{payingNow}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Balance Payment Due: </span>
                        <strong className={projectedDue > 0 ? "text-rose-400" : "text-emerald-400"}>
                          ₹{projectedDue}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Student's Past Transactions */}
              {mySubscriptions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400">
                    Your Recent Subscription &amp; Test Payment Records ({mySubscriptions.length})
                  </p>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 divide-y divide-slate-800/70 text-xs">
                    {mySubscriptions.map((sub) => (
                      <div key={sub.id} className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-semibold text-white">{sub.planName}</span>
                          <span className="ml-2 font-mono text-[11px] text-amber-300">
                            {sub.transactionRef}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-300">
                          Paid: <strong className="text-emerald-400">₹{sub.amountPaidInr}</strong> · Due:{" "}
                          <strong className={sub.amountDueInr > 0 ? "text-rose-400" : "text-slate-400"}>
                            ₹{sub.amountDueInr}
                          </strong>{" "}
                          · {new Date(sub.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSubscriptionModal(false)}
                  className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={purchaseBusy}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
                >
                  <CreditCard className="w-4 h-4" />
                  {purchaseBusy
                    ? "Processing Test Payment…"
                    : payExistingDueOnly
                      ? `Confirm Test Payment (₹${testPaidAmountInput || 0})`
                      : `Complete Test Purchase & Unlock ${SUBSCRIPTION_TIER_LABELS[selectedPurchaseTier]}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
