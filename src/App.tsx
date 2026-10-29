import React, { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, Crown, Sparkles } from "lucide-react";
import {
  SUBSCRIPTION_TIER_PLANS,
  getSubscriptionTierLabel,
  type AiNoteDto,
  type AttemptSummaryDto,
  type CachedNoteRefDto,
  type MasteryDto,
  type PausedAttemptDto,
  type StudentExamDto,
  type StudentSeriesDto,
  type StudentSubscriptionDto,
  type SubscriptionPlanDto,
  type SubscriptionTier,
  type UserDto,
  type UserRole,
} from "../packages/shared-types/src/index";
import { api, ApiError } from "./api";
import AttemptHistory from "./components/AttemptHistory";
import { ExamCards, ExamSeriesView } from "./components/ExamLibrary";
import AuthScreen from "./components/AuthScreen";
import TopNavHeader from "./components/TopNavHeader";
import PausedTestsBanner from "./components/PausedTestsBanner";
import MockTestRunner from "./components/MockTestRunner";
import AdminDashboardTables from "./components/AdminDashboardTables";
import AspirantAnalyticsDashboard from "./components/AspirantAnalyticsDashboard";
import PaymentManagementConsole from "./components/PaymentManagementConsole";
import WeaknessTutorTab from "./components/WeaknessTutorTab";
import DescriptiveEvaluatorTab from "./components/DescriptiveEvaluatorTab";
import DailyCurrentAffairsTab from "./components/DailyCurrentAffairsTab";
import AdminConsoleTab from "./components/AdminConsoleTab";
import SubscriptionModal from "./components/SubscriptionModal";
import ExamOrientedNotesTab from "./components/ExamOrientedNotesTab";
import {
  formatClock,
  toMockQuestion,
  type ActiveNav,
  type AdminSubTab,
  type ApiMockQuestion,
  type MockQuestion,
  type SubmitResponse,
  type SupportedLang,
} from "./components/types";

export default function App() {
  // 1. Auth & Session State
  const [user, setUser] = useState<UserDto | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  // 2. Navigation & Language State
  const [activeNav, setActiveNav] = useState<ActiveNav>("mock-center");
  const [adminTab, setAdminTab] = useState<AdminSubTab>("users");
  const [lang, setLang] = useState<SupportedLang>("en");
  const [banner, setBanner] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // 3. Student Exam Library, Attempts, Mastery & Subscriptions State
  const [examsList, setExamsList] = useState<StudentExamDto[]>([]);
  const [openExamId, setOpenExamId] = useState<string | null>(null);
  const [seriesByExam, setSeriesByExam] = useState<Record<string, StudentSeriesDto[]>>({});
  const [myAttempts, setMyAttempts] = useState<AttemptSummaryDto[]>([]);
  const [pausedAttempts, setPausedAttempts] = useState<PausedAttemptDto[]>([]);
  const [myMastery, setMyMastery] = useState<MasteryDto[]>([]);
  const [mySubscriptions, setMySubscriptions] = useState<StudentSubscriptionDto[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlanDto[]>([]);

  // 4. Subscription Modal State (Purchase Plan for Aspirant / Manage Plans for Admin)
  const [showSubscriptionModal, setShowSubscriptionModal] = useState<boolean>(false);
  const [modalInitialTier, setModalInitialTier] = useState<SubscriptionTier>("pro_prelims");
  const [modalInitialDueOnly, setModalInitialDueOnly] = useState<boolean>(false);

  // 5. Active Mock Test Runner State
  const [activeExam, setActiveExam] = useState<StudentExamDto | null>(null);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null);
  const [activePausedAttemptId, setActivePausedAttemptId] = useState<string | null>(null);
  const [isTestRunning, setIsTestRunning] = useState<boolean>(false);
  const [isRemedialMode, setIsRemedialMode] = useState<boolean>(false);
  const [questions, setQuestions] = useState<MockQuestion[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, "A" | "B" | "C" | "D">>({});
  const [markedForReview, setMarkedForReview] = useState<Record<string, boolean>>({});
  const [questionTimers, setQuestionTimers] = useState<Record<string, number>>({});
  const [elapsedTotalSec, setElapsedTotalSec] = useState<number>(0);
  const [testLimitSec, setTestLimitSec] = useState<number>(0);
  const [startedAtIso, setStartedAtIso] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [pausing, setPausing] = useState<boolean>(false);
  const [lastAttemptResult, setLastAttemptResult] = useState<SubmitResponse | null>(null);

  // 6. AI Tutor & Admin Console Data State
  const [cachedNotes, setCachedNotes] = useState<CachedNoteRefDto[]>([]);
  const [selectedNote, setSelectedNote] = useState<AiNoteDto | null>(null);
  const [generatingTopicSlug, setGeneratingTopicSlug] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<UserDto[]>([]);
  const [allAttempts, setAllAttempts] = useState<AttemptSummaryDto[]>([]);
  const [allSubscriptions, setAllSubscriptions] = useState<StudentSubscriptionDto[]>([]);

  const notify = useCallback((type: "success" | "error" | "info", text: string) => {
    setBanner({ type, text });
  }, []);

  const handleApiError = useCallback((err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 401) {
      setUser(null);
    }
    setBanner({
      type: "error",
      text: (err as Error)?.message || fallback,
    });
  }, []);

  // Load Student & Subscription Data
  const loadStudentData = useCallback(async () => {
    try {
      const [examsRes, attemptsRes, pausedRes, masteryRes, subsRes, plansRes, notesRes] =
        await Promise.all([
          api<{ exams: StudentExamDto[] }>("/exams"),
          api<{ attempts: AttemptSummaryDto[] }>("/me/attempts"),
          api<{ pausedAttempts: PausedAttemptDto[] }>("/me/paused-attempts").catch(() => ({
            pausedAttempts: [],
          })),
          api<{ mastery: MasteryDto[] }>("/me/mastery"),
          api<{
            subscriptions: StudentSubscriptionDto[];
            plans?: SubscriptionPlanDto[];
          }>("/me/subscriptions").catch(() => ({
            subscriptions: [] as StudentSubscriptionDto[],
            plans: undefined as SubscriptionPlanDto[] | undefined,
          })),
          api<{ plans: SubscriptionPlanDto[] }>("/me/plans").catch(() => ({
            plans: [] as SubscriptionPlanDto[],
          })),
          api<{ cachedNotes: CachedNoteRefDto[] }>("/notes/cached").catch(() => ({
            cachedNotes: [] as CachedNoteRefDto[],
          })),
        ]);

      setExamsList(examsRes.exams);
      setMyAttempts(attemptsRes.attempts);
      setPausedAttempts(pausedRes.pausedAttempts);
      setMyMastery(masteryRes.mastery);
      setMySubscriptions(subsRes.subscriptions);
      if (plansRes.plans && plansRes.plans.length > 0) {
        setSubscriptionPlans(plansRes.plans);
      } else if (subsRes.plans && subsRes.plans.length > 0) {
        setSubscriptionPlans(subsRes.plans);
      }
      setCachedNotes(notesRes.cachedNotes);
    } catch (err) {
      handleApiError(err, "Failed to load student dashboard data.");
    }
  }, [handleApiError]);

  // Load Admin Data (Users, Attempts, Subscriptions, Plans)
  const loadAdminData = useCallback(async () => {
    try {
      const [usersRes, attemptsRes, subsRes, plansRes] = await Promise.all([
        api<{ users: UserDto[] }>("/admin/users"),
        api<{ attempts: AttemptSummaryDto[] }>("/admin/attempts"),
        api<{ subscriptions: StudentSubscriptionDto[] }>("/admin/subscriptions").catch(() => ({
          subscriptions: [],
        })),
        api<{ plans: SubscriptionPlanDto[] }>("/admin/subscription-plans").catch(() => ({
          plans: [],
        })),
      ]);
      setAllUsers(usersRes.users);
      setAllAttempts(attemptsRes.attempts);
      setAllSubscriptions(subsRes.subscriptions);
      if (plansRes.plans && plansRes.plans.length > 0) {
        setSubscriptionPlans(plansRes.plans);
      }
    } catch (err) {
      handleApiError(err, "Failed to load admin console data.");
    }
  }, [handleApiError]);

  // Initial Session Verification
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, me] = await Promise.all([
          api<{ googleClientId: string | null }>("/auth/config").catch(() => ({
            googleClientId: null,
          })),
          api<{ user: UserDto | null }>("/auth/me").catch(() => ({ user: null })),
        ]);
        if (cancelled) return;
        setGoogleClientId(cfg.googleClientId);
        if (me.user) {
          setUser(me.user);
        }
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh data when user logs in or role changes
  useEffect(() => {
    if (!user) return;
    void loadStudentData();
    if (user.role === "admin") {
      void loadAdminData();
    }
  }, [user, loadStudentData, loadAdminData]);

  // Automatic client-side check for subscription expiry -> syncs with `/auth/me` which downgrades to free plan
  useEffect(() => {
    if (!user || user.role === "admin" || user.subscriptionTier === "free" || !user.subscriptionExpiresAt) {
      return;
    }
    const expiresMs = new Date(user.subscriptionExpiresAt).getTime();
    const now = Date.now();
    const checkExpiry = async () => {
      try {
        const me = await api<{ user: UserDto | null }>("/auth/me");
        if (me.user) {
          setUser(me.user);
          if (me.user.subscriptionTier === "free") {
            notify(
              "info",
              "Your subscription period has ended and your account has automatically switched to the Free Plan."
            );
            void loadStudentData();
          }
        }
      } catch {
        // Ignore transient network errors
      }
    };
    if (expiresMs <= now) {
      void checkExpiry();
      return;
    }
    const delayMs = Math.min(expiresMs - now + 1000, 60_000);
    const timer = setTimeout(() => {
      void checkExpiry();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [user, notify, loadStudentData]);

  // Load published series when an exam card is opened
  const handleOpenExam = async (exam: StudentExamDto) => {
    setOpenExamId(exam.id);
    try {
      const { series } = await api<{ series: StudentSeriesDto[] }>(`/exams/${exam.id}/series`);
      setSeriesByExam((prev) => ({ ...prev, [exam.id]: series }));
    } catch (err) {
      handleApiError(err, "Could not load test series for this exam.");
    }
  };

  // Start a Mock Test (Random, Series, or Remedial)
  const startMockTest = async (
    exam: StudentExamDto,
    remedial = false,
    series?: StudentSeriesDto
  ) => {
    try {
      setBanner(null);
      setLastAttemptResult(null);

      let path = `/exams/${exam.id}/mock-test`;
      if (series) {
        path = `/exams/${exam.id}/series/${series.id}/mock-test`;
      } else if (remedial) {
        path = `/exams/${exam.id}/remedial-mock`;
      }

      const data = await api<{
        exam: StudentExamDto;
        questions: ApiMockQuestion[];
        isRemedial?: boolean;
      }>(path);

      if (!data.questions || data.questions.length === 0) {
        notify("error", "No questions found for this test yet.");
        return;
      }

      const mapped = data.questions.map(toMockQuestion);
      const durationMin = series?.durationMinutes ?? data.exam.durationMinutes ?? 90;

      setActiveExam(data.exam);
      setActiveSeriesId(series?.id ?? null);
      setActivePausedAttemptId(null);
      setIsRemedialMode(Boolean(remedial || data.isRemedial));
      setQuestions(mapped);
      setCurrentQuestionIdx(0);
      setSelectedAnswers({});
      setMarkedForReview({});
      setQuestionTimers({});
      setElapsedTotalSec(0);
      setTestLimitSec(Math.max(60, Math.round(durationMin * 60)));
      setStartedAtIso(new Date().toISOString());
      setIsTestRunning(true);
    } catch (err) {
      handleApiError(err, "Could not start the mock test.");
    }
  };

  // Resume a Paused / Postponed Test
  const handleResumePausedTest = async (paused: PausedAttemptDto) => {
    try {
      setBanner(null);
      setLastAttemptResult(null);
      const data = await api<{
        attemptId: string;
        exam: StudentExamDto;
        seriesId: string | null;
        isRemedial: boolean;
        languageSelected: SupportedLang;
        startedAt: string;
        elapsedSeconds: number;
        currentQuestionIdx: number;
        durationMinutes: number;
        questions: ApiMockQuestion[];
        savedResponses: Array<{
          questionId: string;
          selectedOption: "A" | "B" | "C" | "D" | null;
          timeSpentSeconds: number;
          isMarkedForReview: boolean;
        }>;
      }>(`/me/paused-attempts/${paused.attemptId}`);

      const mapped = data.questions.map(toMockQuestion);
      const ansMap: Record<string, "A" | "B" | "C" | "D"> = {};
      const revMap: Record<string, boolean> = {};
      const timeMap: Record<string, number> = {};

      for (const r of data.savedResponses) {
        if (r.selectedOption) ansMap[r.questionId] = r.selectedOption;
        if (r.isMarkedForReview) revMap[r.questionId] = true;
        if (r.timeSpentSeconds > 0) timeMap[r.questionId] = r.timeSpentSeconds;
      }

      setLang(data.languageSelected);
      setActiveExam(data.exam);
      setActiveSeriesId(data.seriesId);
      setActivePausedAttemptId(data.attemptId);
      setIsRemedialMode(data.isRemedial);
      setQuestions(mapped);
      setCurrentQuestionIdx(
        Math.min(Math.max(0, data.currentQuestionIdx), Math.max(0, mapped.length - 1))
      );
      setSelectedAnswers(ansMap);
      setMarkedForReview(revMap);
      setQuestionTimers(timeMap);
      setElapsedTotalSec(data.elapsedSeconds);
      setTestLimitSec(Math.max(60, Math.round(data.durationMinutes * 60)));
      setStartedAtIso(data.startedAt);
      setIsTestRunning(true);
    } catch (err) {
      handleApiError(err, "Could not resume your postponed test.");
    }
  };

  // Discard a Paused Attempt
  const handleDiscardPausedTest = async (attemptId: string) => {
    try {
      await api(`/me/paused-attempts/${attemptId}`, { method: "DELETE" });
      setPausedAttempts((prev) => prev.filter((p) => p.attemptId !== attemptId));
      notify("info", "Postponed test discarded.");
      void loadStudentData();
    } catch (err) {
      handleApiError(err, "Could not discard postponed test.");
    }
  };

  // Pause / Postpone Ongoing Test
  const handlePauseTest = async () => {
    if (!isTestRunning || !activeExam || pausing || submitting) return;
    setPausing(true);
    try {
      const payload = {
        attemptId: activePausedAttemptId ?? undefined,
        examId: activeExam.id,
        seriesId: activeSeriesId,
        isRemedial: isRemedialMode,
        languageSelected: lang,
        startedAt: startedAtIso || new Date().toISOString(),
        elapsedSeconds: elapsedTotalSec,
        currentQuestionIdx,
        responses: questions.map((q) => ({
          questionId: q.id,
          selectedOption: selectedAnswers[q.id] ?? null,
          timeSpentSeconds: questionTimers[q.id] ?? 0,
          isMarkedForReview: Boolean(markedForReview[q.id]),
        })),
      };

      await api("/attempts/pause", { method: "POST", body: payload });
      setIsTestRunning(false);
      notify(
        "info",
        lang === "bn"
          ? "পরীক্ষা স্থগিত করা হয়েছে। আপনি যেকোনো সময় পুনরায় শুরু করতে পারবেন।"
          : "Exam postponed! Your answers and remaining time have been saved."
      );
      await loadStudentData();
      if (openExamId) {
        const { series } = await api<{ series: StudentSeriesDto[] }>(
          `/exams/${openExamId}/series`
        ).catch(() => ({ series: [] }));
        setSeriesByExam((prev) => ({ ...prev, [openExamId]: series }));
      }
    } catch (err) {
      handleApiError(err, "Failed to postpone the test.");
    } finally {
      setPausing(false);
    }
  };

  // Submit Mock Test for Deterministic SQL Grading
  const submitMockTestRef = useRef<() => void>(() => {});
  const handleSubmitTest = useCallback(async () => {
    if (!isTestRunning || !activeExam || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        attemptId: activePausedAttemptId ?? undefined,
        examId: activeExam.id,
        seriesId: activeSeriesId,
        isRemedial: isRemedialMode,
        languageSelected: lang,
        startedAt: startedAtIso || new Date(Date.now() - elapsedTotalSec * 1000).toISOString(),
        responses: questions.map((q) => ({
          questionId: q.id,
          selectedOption: selectedAnswers[q.id] ?? null,
          timeSpentSeconds: questionTimers[q.id] ?? 0,
          isMarkedForReview: Boolean(markedForReview[q.id]),
        })),
      };

      const result = await api<SubmitResponse>("/attempts/submit", {
        method: "POST",
        body: payload,
      });

      setIsTestRunning(false);
      setLastAttemptResult(result);
      await loadStudentData();
      if (openExamId) {
        const { series } = await api<{ series: StudentSeriesDto[] }>(
          `/exams/${openExamId}/series`
        ).catch(() => ({ series: [] }));
        setSeriesByExam((prev) => ({ ...prev, [openExamId]: series }));
      }
      if (user?.role === "admin") {
        void loadAdminData();
      }
    } catch (err) {
      handleApiError(err, "Failed to submit mock test.");
    } finally {
      setSubmitting(false);
    }
  }, [
    isTestRunning,
    activeExam,
    submitting,
    activePausedAttemptId,
    activeSeriesId,
    isRemedialMode,
    lang,
    startedAtIso,
    elapsedTotalSec,
    questions,
    selectedAnswers,
    questionTimers,
    markedForReview,
    loadStudentData,
    openExamId,
    user?.role,
    loadAdminData,
    handleApiError,
  ]);

  submitMockTestRef.current = () => {
    void handleSubmitTest();
  };

  // Per-second timer tick while a mock test is running
  useEffect(() => {
    if (!isTestRunning || questions.length === 0) return;
    const currentQ = questions[currentQuestionIdx];
    const interval = setInterval(() => {
      setElapsedTotalSec((prev) => {
        const next = prev + 1;
        if (testLimitSec > 0 && next >= testLimitSec) {
          submitMockTestRef.current();
        }
        return next;
      });
      if (currentQ) {
        setQuestionTimers((prev) => ({
          ...prev,
          [currentQ.id]: (prev[currentQ.id] || 0) + 1,
        }));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isTestRunning, questions, currentQuestionIdx, testLimitSec]);

  // Open or Generate 3-Tier Cached AI Note
  const handleOpenOrGenerateAiNote = async (m: MasteryDto) => {
    const slug = m.subtopicSlug;
    setGeneratingTopicSlug(slug);
    try {
      const note = await api<AiNoteDto>("/notes/generate", {
        method: "POST",
        body: {
          examSlug: m.examSlug || "wbcs-prelims",
          topicSlug: slug,
          topicTitle: lang === "bn" ? m.subtopicName.bn : m.subtopicName.en,
          language: lang,
        },
      });
      setSelectedNote(note);
      const notesRes = await api<{ cachedNotes: CachedNoteRefDto[] }>("/notes/cached").catch(
        () => ({ cachedNotes: [] })
      );
      setCachedNotes(notesRes.cachedNotes);
    } catch (err) {
      handleApiError(err, "Failed to generate AI study note.");
    } finally {
      setGeneratingTopicSlug(null);
    }
  };

  // Admin: Update User RBAC / Subscription / Billing
  const handleUpdateUser = async (
    target: UserDto,
    updates: Partial<
      Pick<
        UserDto,
        "subscriptionTier" | "isActive" | "paymentDueInr" | "totalPaidInr" | "billingNotes"
      >
    > & {
      role?: Exclude<UserRole, "admin">;
    }
  ) => {
    try {
      const { user: updated } = await api<{ user: UserDto }>(`/admin/users/${target.id}`, {
        method: "PATCH",
        body: updates,
      });
      setAllUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      if (user && updated.id === user.id) {
        setUser(updated);
      }
      notify("success", `Updated ${updated.fullName}.`);
      void loadAdminData();
    } catch (err) {
      handleApiError(err, "Could not update user.");
    }
  };

  // Logout
  const handleLogout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout network error
    }
    setUser(null);
    setIsTestRunning(false);
    setLastAttemptResult(null);
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-300 flex items-center justify-center font-mono text-xs">
        Verifying session…
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        googleClientId={googleClientId}
        onSignedIn={(signedInUser) => {
          setUser(signedInUser);
          setBanner(null);
        }}
      />
    );
  }

  const isUserAdmin = user.role === "admin";
  const openExam = examsList.find((e) => e.id === openExamId) ?? null;
  const remainingSec = Math.max(0, testLimitSec - elapsedTotalSec);
  const effectivePlans: SubscriptionPlanDto[] =
    subscriptionPlans.length > 0
      ? subscriptionPlans
      : SUBSCRIPTION_TIER_PLANS.map((p, idx) => ({
          ...p,
          id: p.tier,
          durationDays: p.durationDays ?? 365,
          isActive: true,
          displayOrder: idx,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        }));

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col overflow-x-hidden">
      {/* Top Navbar with Semi-Rounded Sliding Pill Indicator & Role-Aware Plan Action */}
      <TopNavHeader
        user={user}
        lang={lang}
        activeNav={activeNav}
        plans={effectivePlans}
        onChangeNav={setActiveNav}
        onChangeLang={setLang}
        onOpenSubscriptionModal={(dueOnly) => {
          setModalInitialDueOnly(Boolean(dueOnly));
          setShowSubscriptionModal(true);
        }}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Global Notification Banner */}
        {banner && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
              banner.type === "error"
                ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
                : banner.type === "success"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                  : "bg-sky-500/10 border-sky-500/30 text-sky-200"
            }`}
          >
            <span>{banner.text}</span>
            <button
              onClick={() => setBanner(null)}
              className="font-mono text-[11px] opacity-80 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ====================================================================
            TAB 1: MOCK TESTS CENTER (Exams, Series, Active Test, Admin Tables)
        ==================================================================== */}
        {activeNav === "mock-center" && (
          <div className="space-y-8">
            {/* Aspirant Subscription Status Banner (Never shown to Admin) */}
            {!isUserAdmin && !isTestRunning && (
              <div className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-slate-900 via-amber-950/20 to-slate-900 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 bg-amber-500/15 border border-amber-500/35 px-2.5 py-0.5 rounded-full">
                      <Crown className="w-3.5 h-3.5 text-amber-400" />
                      Current Plan: {getSubscriptionTierLabel(user.subscriptionTier, effectivePlans)}
                    </span>
                    {user.subscriptionExpiresAt && user.subscriptionTier !== "free" && (
                      <span className="text-[11px] font-mono text-slate-400">
                        Valid till{" "}
                        {new Date(user.subscriptionExpiresAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}{" "}
                        · Auto-switches to Free Plan on expiry
                      </span>
                    )}
                    {(user.paymentDueInr ?? 0) > 0 && (
                      <span className="text-[11px] font-mono font-bold text-rose-300 bg-rose-500/15 border border-rose-500/35 px-2.5 py-0.5 rounded-full">
                        Payment Due: ₹{user.paymentDueInr}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300">
                    {user.subscriptionTier === "free"
                      ? "Upgrade to Pro Prelims, Mains Tier, Part-II Tier, or WBCS Executive Pass to unlock all Paid Test Series."
                      : "Your subscription unlocks Paid Mock Test Series in your tier. You can upgrade or clear dues anytime."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(user.paymentDueInr ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalInitialTier(
                          user.subscriptionTier === "free" ? "pro_prelims" : user.subscriptionTier
                        );
                        setModalInitialDueOnly(true);
                        setShowSubscriptionModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white rounded-lg cursor-pointer"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      Pay Due (₹{user.paymentDueInr})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setModalInitialTier(
                        user.subscriptionTier === "free" ? "pro_prelims" : user.subscriptionTier
                      );
                      setModalInitialDueOnly(false);
                      setShowSubscriptionModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg cursor-pointer shadow-sm"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {user.subscriptionTier === "free"
                      ? "Buy Subscription Plan"
                      : "Upgrade / Manage Plan"}
                  </button>
                </div>
              </div>
            )}

            {/* Postponed / Paused Ongoing Tests Banner */}
            {!isTestRunning && (
              <PausedTestsBanner
                pausedAttempts={pausedAttempts}
                lang={lang}
                onResume={handleResumePausedTest}
                onDiscard={handleDiscardPausedTest}
              />
            )}

            {/* Recently Submitted Attempt Scorecard */}
            {!isTestRunning && lastAttemptResult && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/15 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
                      Deterministic SQL Evaluation Complete
                    </span>
                    <h2 className="text-lg font-bold text-white mt-0.5">
                      Final Net Score: {lastAttemptResult.overallSummary.finalNetScore} /{" "}
                      {lastAttemptResult.overallSummary.maxPossibleScore}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold border ${
                        lastAttemptResult.overallSummary.cutoffCleared
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                          : "bg-amber-500/20 border-amber-500/40 text-amber-300"
                      }`}
                    >
                      {lastAttemptResult.overallSummary.cutoffCleared
                        ? "Cutoff Cleared"
                        : "Below Target Cutoff"}
                    </span>
                    <button
                      onClick={() => setActiveNav("weakness-tutor")}
                      className="px-3.5 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                    >
                      Inspect Weak Subtopics &amp; AI Notes →
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
                    <p className="text-slate-400">Correct</p>
                    <p className="text-lg font-bold font-mono text-emerald-400">
                      {lastAttemptResult.overallSummary.correct}
                    </p>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
                    <p className="text-slate-400">Incorrect</p>
                    <p className="text-lg font-bold font-mono text-rose-400">
                      {lastAttemptResult.overallSummary.incorrect}
                    </p>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
                    <p className="text-slate-400">Accuracy</p>
                    <p className="text-lg font-bold font-mono text-white">
                      {lastAttemptResult.overallSummary.accuracyPercentage}%
                    </p>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
                    <p className="text-slate-400">Time Taken</p>
                    <p className="text-lg font-bold font-mono text-slate-200">
                      {formatClock(elapsedTotalSec)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Active Timed Mock Test Runner */}
            {isTestRunning && activeExam && questions.length > 0 ? (
              <MockTestRunner
                activeExam={activeExam}
                questions={questions}
                isRemedialMode={isRemedialMode}
                lang={lang}
                currentQuestionIdx={currentQuestionIdx}
                selectedAnswers={selectedAnswers}
                markedForReview={markedForReview}
                elapsedTotalSec={elapsedTotalSec}
                remainingSec={remainingSec}
                testLimitSec={testLimitSec}
                submitting={submitting}
                pausing={pausing}
                onSelectQuestionIdx={setCurrentQuestionIdx}
                onSelectAnswer={(qId, opt) =>
                  setSelectedAnswers((prev) => ({ ...prev, [qId]: opt }))
                }
                onClearAnswer={(qId) =>
                  setSelectedAnswers((prev) => {
                    const next = { ...prev };
                    delete next[qId];
                    return next;
                  })
                }
                onToggleMarkForReview={(qId) =>
                  setMarkedForReview((prev) => ({ ...prev, [qId]: !prev[qId] }))
                }
                onPauseTest={handlePauseTest}
                onSubmitTest={handleSubmitTest}
              />
            ) : (
              <>
                {/* 01. Mock Test Series Library */}
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h1 className="text-xl font-bold text-white">
                        {lang === "bn"
                          ? "০১. মক টেস্ট সিরিজ এবং বিগত বছরের প্রশ্নপত্র"
                          : "01. Mock Test Series & Previous Year Sets"}
                      </h1>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {lang === "bn"
                          ? "একটি পরীক্ষা বেছে নিন, সম্পূর্ণ টেস্ট সিরিজ দিন অথবা যেকোনো সময় পরীক্ষা স্থগিত করে পরে আবার শুরু করুন।"
                          : "Choose an exam category to attempt Free or Paid Mock Test Series, pause/postpone mid-exam, and review bilingual solutions."}
                      </p>
                    </div>
                  </div>

                  {!openExam ? (
                    <ExamCards exams={examsList} lang={lang} onOpen={handleOpenExam} />
                  ) : (
                    <ExamSeriesView
                      exam={openExam}
                      series={seriesByExam[openExam.id]}
                      lang={lang}
                      userTier={user.subscriptionTier}
                      userRole={user.role}
                      onBack={() => setOpenExamId(null)}
                      onStartSeries={(s) => void startMockTest(openExam, false, s)}
                      onResumeSeries={(s) => {
                        const paused = pausedAttempts.find(
                          (pa) => pa.attemptId === s.myPausedAttemptId || pa.seriesId === s.id
                        );
                        if (paused) {
                          void handleResumePausedTest(paused);
                        } else {
                          void startMockTest(openExam, false, s);
                        }
                      }}
                      onUnlockPaidSeries={(s) => {
                        if (!isUserAdmin) {
                          setModalInitialTier(s.requiredTier || "pro_prelims");
                          setModalInitialDueOnly(false);
                          setShowSubscriptionModal(true);
                        }
                      }}
                      onStartRandom={() => void startMockTest(openExam, false)}
                    >
                      <div className="pt-4 border-t border-slate-800 space-y-2">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {lang === "bn"
                            ? "এই পরীক্ষায় আপনার পূর্ববর্তী প্রচেষ্টা"
                            : "Your Past Attempts in This Exam"}
                        </h3>
                        <AttemptHistory
                          attempts={myAttempts.filter((a) => a.examId === openExam.id)}
                          lang={lang}
                          showExam={false}
                          highlightId={lastAttemptResult?.attemptId}
                          emptyText={
                            lang === "bn"
                              ? "আপনি এখনও এই পরীক্ষার কোনো মক টেস্ট দেননি।"
                              : "You haven't submitted a mock test for this exam yet."
                          }
                        />
                      </div>
                    </ExamSeriesView>
                  )}
                </section>

                {/* Student's Recent Attempt History across all exams */}
                {!openExam && myAttempts.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="text-base font-bold text-white">
                      {lang === "bn" ? "আপনার সাম্প্রতিক মক টেস্ট ফলাফল" : "Your Recent Mock Test Results"}
                    </h2>
                    <AttemptHistory
                      attempts={myAttempts.slice(0, 8)}
                      lang={lang}
                      showExam={true}
                      highlightId={lastAttemptResult?.attemptId}
                      emptyText="No attempts yet."
                    />
                  </section>
                )}

                {/* ASPIRANT DASHBOARD ANALYTICS CONSOLE:
                    - Performance Metrics Progression
                    - Performance Metrics by Subject
                    - Weak Sections (Where Lacking Knowledge) vs Strong Sections */}
                {!isUserAdmin && !openExam && (
                  <AspirantAnalyticsDashboard
                    myAttempts={myAttempts}
                    myMastery={myMastery}
                    cachedNotes={cachedNotes}
                    generatingTopicSlug={generatingTopicSlug}
                    lang={lang}
                    onOpenOrGenerateAiNote={(m) => {
                      void handleOpenOrGenerateAiNote(m);
                      setActiveNav("weakness-tutor");
                    }}
                    onNavigateToWeaknessTutor={() => setActiveNav("weakness-tutor")}
                  />
                )}

                {/* ADMIN-ONLY SECTIONS BELOW 01. MOCK TEST SERIES:
                    - 00. Admin Analytics Charts (Subscription Growth, Exam Price Trends, Total & Per-Aspirant Revenue)
                    - 02. Every Student's Exam Performance Table (Fixed height + Vertical scroll)
                    - 03. Student Subscription & Payment Dues Management + Available Plans CRUD */}
                {isUserAdmin && (
                  <AdminDashboardTables
                    allUsers={allUsers}
                    allAttempts={allAttempts}
                    allSubscriptions={allSubscriptions}
                    examsList={examsList}
                    plans={effectivePlans}
                    onRefreshAdminData={() => {
                      void loadAdminData();
                      void loadStudentData();
                    }}
                    onOpenPaymentConsole={() => setActiveNav("payment-console")}
                    onUpdateUser={handleUpdateUser}
                    onNotify={notify}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ====================================================================
            TAB 1B: EXAM-ORIENTED NOTES FOR QUICK REVISION + 30-MCQ TOPIC TESTS
        ==================================================================== */}
        {activeNav === "revision-notes" && (
          <ExamOrientedNotesTab
            user={user}
            lang={lang}
            onOpenSubscriptionModal={() => {
              setModalInitialTier(
                user.subscriptionTier === "free" ? "pro_prelims" : user.subscriptionTier
              );
              setModalInitialDueOnly(false);
              setShowSubscriptionModal(true);
            }}
            onNotify={notify}
          />
        )}

        {/* ====================================================================
            TAB 2: WEAKNESS ANALYTICS & 3-TIER CACHED RAG AI TUTOR
        ==================================================================== */}
        {activeNav === "weakness-tutor" && (
          <WeaknessTutorTab
            myAttempts={myAttempts}
            myMastery={myMastery}
            cachedNotes={cachedNotes}
            selectedNote={selectedNote}
            generatingTopicSlug={generatingTopicSlug}
            lang={lang}
            onGoToMockTests={() => setActiveNav("mock-center")}
            onOpenOrGenerateAiNote={(m) => void handleOpenOrGenerateAiNote(m)}
          />
        )}

        {/* ====================================================================
            TAB 3: CLERKSHIP PART-II & WBCS MAINS DESCRIPTIVE EVALUATOR
        ==================================================================== */}
        {activeNav === "descriptive-eval" && (
          <DescriptiveEvaluatorTab lang={lang} onError={handleApiError} />
        )}

        {/* ====================================================================
            TAB 4: AUTOMATED BILINGUAL DAILY CURRENT AFFAIRS DIGEST & AGENT
        ==================================================================== */}
        {activeNav === "daily-ca" && (
          <DailyCurrentAffairsTab
            user={user}
            lang={lang}
            onError={handleApiError}
            onNotify={notify}
          />
        )}

        {/* ====================================================================
            TAB 5: DEDICATED ADMIN PAYMENT MANAGEMENT CONSOLE (Separate Menu Item)
        ==================================================================== */}
        {activeNav === "payment-console" && isUserAdmin && (
          <PaymentManagementConsole
            allUsers={allUsers}
            allSubscriptions={allSubscriptions}
            plans={effectivePlans}
            onRefreshAdminData={() => {
              void loadAdminData();
              void loadStudentData();
            }}
            onNotify={notify}
          />
        )}

        {/* ====================================================================
            TAB 6: ADMIN CONSOLE (Users, Subscription Plans, Syllabus, Bank, Series, Charts)
        ==================================================================== */}
        {activeNav === "admin-console" && isUserAdmin && (
          <AdminConsoleTab
            adminTab={adminTab}
            allUsers={allUsers}
            examsList={examsList}
            cachedNotes={cachedNotes}
            allAttempts={allAttempts}
            allSubscriptions={allSubscriptions}
            plans={effectivePlans}
            onChangeAdminTab={setAdminTab}
            onUpdateUser={handleUpdateUser}
            onExamsChanged={() => void loadStudentData()}
            onPlansChanged={() => {
              void loadAdminData();
              void loadStudentData();
            }}
            onNotify={notify}
          />
        )}
      </main>

      {/* WIDE, RESPONSIVE SUBSCRIPTION MODAL:
          - Admin: Available Subscription Plans Manager (Add / Modify / Delete Plans — no purchase option)
          - Aspirant: Responsive 4-Column Plan Selector + Test Payment Checkout */}
      <SubscriptionModal
        open={showSubscriptionModal}
        user={user}
        lang={lang}
        plans={effectivePlans}
        mySubscriptions={mySubscriptions}
        initialTier={modalInitialTier}
        initialDueOnly={modalInitialDueOnly}
        onClose={() => setShowSubscriptionModal(false)}
        onPurchased={(updatedUser, newSub) => {
          setUser(updatedUser);
          setMySubscriptions((prev) => [newSub, ...prev]);
          void loadStudentData();
          if (isUserAdmin) void loadAdminData();
        }}
        onPlansChanged={() => {
          void loadStudentData();
          if (isUserAdmin) void loadAdminData();
        }}
        onNotify={notify}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-3.5 px-6 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>WBPSC AI Mock Test &amp; Tutor • Deterministic Scoring &amp; Bilingual Study Engine</span>
          <span className="font-mono text-[11px] text-slate-400">
            English &amp; বাংলা (Noto Sans Bengali)
          </span>
        </div>
      </footer>
    </div>
  );
}
