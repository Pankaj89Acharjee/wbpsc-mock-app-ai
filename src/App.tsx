import React, { useCallback, useEffect, useState } from "react";
import type {
  AiNoteDto,
  AttemptSummaryDto,
  BilingualText,
  CachedNoteRefDto,
  MasteryDto,
  QuestionOptions,
  StudentExamDto,
  UserDto,
} from "../packages/shared-types/src/index";
import { api } from "./api";
import QuestionBankAdmin from "./admin/QuestionBankAdmin";
import AttemptReview from "./components/AttemptReview";
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
  Edit3,
} from "lucide-react";

// ============================================================================
// Types (all data comes from api-core / PostgreSQL)
// ============================================================================

type SupportedLang = "en" | "bn";
type UserRole = UserDto["role"];
type SubscriptionTier = UserDto["subscriptionTier"];

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

/** Score card shown right after submitting (graded by api-core in SQL). */
interface LastResult {
  attemptId: string;
  examTitleEn: string;
  examTitleBn: string;
  finalNetScore: number;
  maxPossibleScore: number;
  accuracyPercentage: number;
  correctCount: number;
  incorrectCount: number;
  cutoffCleared: boolean;
  weakSubtopicsCount: number;
}

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

type AdminSubTab = "users" | "exams" | "cache-attempts" | "bulk-import";

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
  const [reviewAttemptId, setReviewAttemptId] = useState<string | null>(null);
  const [myMastery, setMyMastery] = useState<MasteryDto[]>([]);
  const [cachedNotes, setCachedNotes] = useState<CachedNoteRefDto[]>([]);

  // Admin-Only State
  const [allUsers, setAllUsers] = useState<UserDto[]>([]);
  const [allAttempts, setAllAttempts] = useState<AttemptSummaryDto[]>([]);
  const [statusBanner, setStatusBanner] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Active Mock Test State
  const [activeExam, setActiveExam] = useState<StudentExamDto | null>(null);
  const [activeTestQuestions, setActiveTestQuestions] = useState<MockQuestion[]>([]);
  const [isRemedialMode, setIsRemedialMode] = useState<boolean>(false);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<string, "A" | "B" | "C" | "D">
  >({});
  const [questionTimers, setQuestionTimers] = useState<Record<string, number>>({});
  const [elapsedTotalSec, setElapsedTotalSec] = useState<number>(0);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [lastSubmittedAttempt, setLastSubmittedAttempt] = useState<LastResult | null>(null);

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
    api<{ mastery: MasteryDto[] }>("/me/mastery")
      .then((r) => setMyMastery(r.mastery))
      .catch((err) => showError(err, "Could not load your weakness radar"));
    api<{ notes: CachedNoteRefDto[] }>("/ai/notes/cached")
      .then((r) => setCachedNotes(r.notes))
      .catch(() => setCachedNotes([]));
  }, []);

  const loadAdminData = useCallback(() => {
    api<{ users: UserDto[] }>("/admin/users")
      .then((r) => setAllUsers(r.users))
      .catch((err) => showError(err, "Could not load users"));
    api<{ attempts: AttemptSummaryDto[] }>("/admin/attempts")
      .then((r) => setAllAttempts(r.attempts))
      .catch((err) => showError(err, "Could not load attempts"));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadExams();
    loadMyProgress();
  }, [user?.id, loadExams, loadMyProgress]);

  useEffect(() => {
    if (isUserAdmin && activeNav === "admin-console") loadAdminData();
  }, [isUserAdmin, activeNav, loadAdminData]);

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
    setLastSubmittedAttempt(null);
    setSelectedNote(null);
    setReviewAttemptId(null);
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
    updates: Partial<Pick<UserDto, "subscriptionTier" | "isActive">> & {
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

  // =========================================================================
  // 5. Mock Test (questions without answers → server-side SQL grading)
  // =========================================================================

  const beginTest = (exam: StudentExamDto, questions: ApiMockQuestion[], remedial: boolean) => {
    if (questions.length === 0) {
      setStatusBanner({
        type: "info",
        text: "This exam has no questions yet — an admin can add them in Admin Console → Question Bank.",
      });
      return;
    }
    setActiveExam(exam);
    setActiveTestQuestions(questions.map(toMockQuestion));
    setIsRemedialMode(remedial);
    setCurrentQuestionIdx(0);
    setSelectedAnswers({});
    setQuestionTimers({});
    setElapsedTotalSec(0);
    setLastSubmittedAttempt(null);
    setReviewAttemptId(null);
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

  const handleSubmitMockTest = async () => {
    if (!activeExam || submitting) return;
    setSubmitting(true);
    try {
      const r = await api<SubmitResponse>("/exams/submit", {
        method: "POST",
        body: {
          examId: activeExam.id,
          preferredLanguage: lang,
          totalTimeSpentSeconds: elapsedTotalSec,
          startedAt: new Date(Date.now() - elapsedTotalSec * 1000).toISOString(),
          answers: activeTestQuestions.map((q) => {
            const chosen = selectedAnswers[q.id];
            return {
              questionId: q.id,
              selectedOption: chosen ?? null,
              status: chosen ? "answered" : "unanswered",
              timeSpentSeconds: Math.min(7200, questionTimers[q.id] || 0),
            };
          }),
        },
      });
      const s = r.overallSummary;
      setLastSubmittedAttempt({
        attemptId: r.attemptId,
        examTitleEn: activeExam.titleEn,
        examTitleBn: activeExam.titleBn,
        finalNetScore: s.finalNetScore,
        maxPossibleScore: s.maxPossibleScore,
        accuracyPercentage: s.accuracyPercentage,
        correctCount: s.correct,
        incorrectCount: s.incorrect,
        cutoffCleared: s.cutoffCleared,
        weakSubtopicsCount: r.weakSubtopics.length,
      });
      setActiveExam(null);
      setActiveTestQuestions([]);
      setStatusBanner({
        type: "success",
        text: `Submitted. Net score ${s.finalNetScore} / ${s.maxPossibleScore}.`,
      });
      loadMyProgress();
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
            WBPSC AI Prep
          </span>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <span className="whitespace-nowrap shrink-0">WBCS Prelims</span>
            <span className="whitespace-nowrap shrink-0">Clerkship Part I &amp; II</span>
            <span className="whitespace-nowrap shrink-0">Food SI</span>
            <span className="whitespace-nowrap shrink-0">Miscellaneous</span>
          </nav>
        </header>

        <main className="max-w-6xl mx-auto w-full px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Platform Overview */}
          <div className="lg:col-span-7 space-y-6">
            <p className="text-xs font-medium text-emerald-400">
              Bilingual Bengali &amp; English Assessment Architecture · Zero-Trust RBAC
            </p>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
              Deterministic WBPSC Mock Engine &amp; 3-Tier Cached AI Tutor.
            </h1>
            <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
              Built for West Bengal Civil Service (WBCS), Clerkship Part-I &amp; Part-II,
              Food SI, and Miscellaneous aspirants. Features deterministic negative-marking
              evaluation, subtopic weakness radar, and role-based Admin governance.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
              <div>
                <div className="text-2xl font-bold text-white font-mono tabular-nums">
                  -0.25 / -0.33
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Deterministic SQL Grading
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white font-mono tabular-nums">
                  L1 · L2 · L3
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Zero-Waste Cached Bilingual Study Notes
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white font-mono tabular-nums">
                  3 Roles
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Admin · Educator · Aspirant RBAC
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
                  Your account is stored on our own server
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setAuthMode("signin")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    authMode === "signin"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("signup")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    authMode === "signup"
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
          <span>WBPSC AI Mock Test &amp; Tutor</span>
          <span>Bilingual (বাংলা + English) · Self-hosted</span>
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
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800 bg-slate-950 sticky top-0 z-20">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveNav("mock-center");
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          WBPSC AI Prep
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => setActiveNav("mock-center")}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeNav === "mock-center" ? "text-emerald-400 font-semibold" : ""
            }`}
          >
            Mock Tests
          </button>
          <button
            onClick={() => setActiveNav("weakness-tutor")}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeNav === "weakness-tutor" ? "text-emerald-400 font-semibold" : ""
            }`}
          >
            Weakness &amp; Tutor
          </button>
          <button
            onClick={() => setActiveNav("descriptive-eval")}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeNav === "descriptive-eval" ? "text-emerald-400 font-semibold" : ""
            }`}
          >
            Part-II Evaluator
          </button>
          <button
            onClick={() => setActiveNav("daily-ca")}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeNav === "daily-ca" ? "text-emerald-400 font-semibold" : ""
            }`}
          >
            Daily Current Affairs
          </button>
          {isUserAdmin && (
            <button
              onClick={() => setActiveNav("admin-console")}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeNav === "admin-console" ? "text-amber-400 font-semibold" : ""
              }`}
            >
              Admin Console
            </button>
          )}
          <button
            onClick={() => setActiveNav("testing-guide")}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeNav === "testing-guide" ? "text-emerald-400 font-semibold" : ""
            }`}
          >
            Testing Guide
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Sub-header Workspace Toolbar (Role, Language Switch, Seed Action) */}
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
              Tier:{" "}
              <strong className="text-slate-200">
                {user.subscriptionTier}
              </strong>
            </span>
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
              <option value="testing-guide">Testing Guide</option>
            </select>

            {/* Interactive Language Segmented Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
              <button
                onClick={() => changeLang("bn")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  lang === "bn"
                    ? "bg-emerald-500 text-slate-950 font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                বাংলা (BN)
              </button>
              <button
                onClick={() => changeLang("en")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  lang === "en"
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
            className={`p-3.5 rounded-lg border text-xs flex items-center justify-between ${
              statusBanner.type === "success"
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

                  <div className="flex items-center gap-4">
                    <div className="text-sm font-mono tabular-nums text-emerald-400">
                      Time Elapsed: {Math.floor(elapsedTotalSec / 60)}m{" "}
                      {elapsedTotalSec % 60}s
                    </div>
                    <button
                      onClick={handleSubmitMockTest}
                      disabled={submitting}
                      className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {submitting ? "Grading…" : "Submit & Grade Test"}
                    </button>
                  </div>
                </div>

                {/* Question Palette */}
                <div className="flex flex-wrap gap-2">
                  {activeTestQuestions.map((q, idx) => {
                    const isAnswered = Boolean(selectedAnswers[q.id]);
                    const isCurrent = idx === currentQuestionIdx;
                    return (
                      <button
                        key={q.id}
                        onClick={() => setCurrentQuestionIdx(idx)}
                        className={`w-9 h-9 rounded-lg text-xs font-mono tabular-nums font-semibold transition-colors cursor-pointer ${
                          isCurrent
                            ? "bg-white text-slate-950"
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

                      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
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
                              disabled={submitting}
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
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-white">
                      01. WBPSC Deterministic Mock Test Series
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                      Select an examination below to begin a bilingual timed test.
                      Graded deterministically without consuming AI tokens.
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

                {lastSubmittedAttempt && (
                  <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs text-emerald-400 font-semibold">
                          Instant Deterministic Grading Report
                        </span>
                        <h3 className="text-lg font-bold text-white">
                          {lang === "bn"
                            ? lastSubmittedAttempt.examTitleBn
                            : lastSubmittedAttempt.examTitleEn}
                        </h3>
                      </div>
                      <button
                        onClick={() => setActiveNav("weakness-tutor")}
                        className="px-3.5 py-2 text-xs font-semibold bg-emerald-500 text-slate-950 rounded-lg hover:bg-emerald-400 cursor-pointer"
                      >
                        Inspect Weak Subtopics &amp; AI Notes
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-2 border-t border-slate-800">
                      <div>
                        <div className="text-xs text-slate-400">Net Score</div>
                        <div className="text-xl font-bold text-white font-mono tabular-nums">
                          {lastSubmittedAttempt.finalNetScore} /{" "}
                          {lastSubmittedAttempt.maxPossibleScore}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">Accuracy</div>
                        <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums">
                          {lastSubmittedAttempt.accuracyPercentage}%
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">
                          Correct / Wrong
                        </div>
                        <div className="text-xl font-bold text-white font-mono tabular-nums">
                          {lastSubmittedAttempt.correctCount} /{" "}
                          {lastSubmittedAttempt.incorrectCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">Cutoff Status</div>
                        <div className="text-sm font-semibold text-slate-200 mt-1">
                          {lastSubmittedAttempt.cutoffCleared
                            ? "Cleared Cutoff"
                            : "Below Cutoff"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">
                          Weak Subtopics Flagged
                        </div>
                        <div className="text-xl font-bold text-amber-400 font-mono tabular-nums">
                          {lastSubmittedAttempt.weakSubtopicsCount}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setReviewAttemptId(lastSubmittedAttempt.attemptId)}
                      className="mt-4 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg cursor-pointer"
                    >
                      Review answers &amp; explanations ↓
                    </button>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {examsList.map((exam) => {
                      const qCount = exam.questionCount;
                      return (
                        <div
                          key={exam.id}
                          className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-5"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs text-slate-400">
                              <span className="font-mono">{exam.slug}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {exam.durationMinutes} mins
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                Negative: -{exam.negativeMarksPerWrong}
                              </span>
                            </div>
                            <h3 className="text-lg font-bold text-white">
                              {lang === "bn" ? exam.titleBn : exam.titleEn}
                            </h3>
                            <p className="text-sm text-slate-400 leading-relaxed">
                              {lang === "bn"
                                ? exam.descriptionBn
                                : exam.descriptionEn}
                            </p>
                          </div>

                          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                            <span className="text-xs text-slate-400 font-mono tabular-nums">
                              {qCount} Active MCQs · Cutoff:{" "}
                              {exam.estimatedCutoffMarks}
                            </span>
                            <button
                              onClick={() => startMockTest(exam)}
                              disabled={qCount === 0}
                              className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {lang === "bn"
                                ? "মক টেস্ট শুরু করুন"
                                : "Start Mock Test"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* User's Recent Attempts Table */}
                {myAttempts.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-lg font-bold text-white">
                      02. Your Recent Mock Attempts
                    </h2>
                    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400">
                            <th className="py-3 px-4">Exam</th>
                            <th className="py-3 px-4 text-right">Attempted</th>
                            <th className="py-3 px-4 text-right">Correct</th>
                            <th className="py-3 px-4 text-right">Wrong</th>
                            <th className="py-3 px-4 text-right">Net Score</th>
                            <th className="py-3 px-4 text-right">Accuracy</th>
                            <th className="py-3 px-4 text-right"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {myAttempts.map((att) => (
                            <tr
                              key={att.id}
                              className={`hover:bg-slate-800/40 transition-colors ${
                                reviewAttemptId === att.id ? "bg-slate-800/40" : ""
                              }`}
                            >
                              <td className="py-3 px-4 font-medium text-white">
                                {lang === "bn" ? att.examTitleBn : att.examTitleEn}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums">
                                {att.attemptedCount}/{att.totalQuestions}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-400">
                                {att.correctCount}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-rose-400">
                                {att.incorrectCount}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-white">
                                {att.finalNetScore}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums">
                                {att.accuracyPercentage}%
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  onClick={() =>
                                    setReviewAttemptId(
                                      reviewAttemptId === att.id ? null : att.id
                                    )
                                  }
                                  className="px-3 py-1 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-amber-300 cursor-pointer"
                                >
                                  {reviewAttemptId === att.id ? "Hide" : "Review answers"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {reviewAttemptId && (
                      <AttemptReview
                        attemptId={reviewAttemptId}
                        lang={lang}
                        onClose={() => setReviewAttemptId(null)}
                      />
                    )}
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
                  WBPSC Master Admin Governance Console
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
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  adminTab === "users"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                1. Users &amp; RBAC ({allUsers.length})
              </button>
              <button
                onClick={() => setAdminTab("exams")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  adminTab === "exams"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                2. Exams &amp; Syllabus ({examsList.length})
              </button>
              <button
                onClick={() => setAdminTab("cache-attempts")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  adminTab === "cache-attempts"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                3. AI Cache ({cachedNotes.length}) &amp; Attempts ({allAttempts.length})
              </button>
              <button
                onClick={() => setAdminTab("bulk-import")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  adminTab === "bulk-import"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                4. Question Bank (Add · Bulk · AI)
              </button>
            </div>

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
                            <option value="free">free</option>
                            <option value="pro_prelims">pro_prelims</option>
                            <option value="wbcs_executive_pass">
                              wbcs_executive_pass
                            </option>
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
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                              u.isActive
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

        {/* ===================================================================
            TAB 6: HOW TO TEST LOCALLY (8GB RAM PC)
        =================================================================== */}
        {activeNav === "testing-guide" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">01. How to test the app</h2>
              <ol className="list-decimal pl-5 text-xs sm:text-sm text-slate-300 space-y-2.5 leading-relaxed">
                <li>
                  <strong>Admin access:</strong> sign in with the admin email from{" "}
                  <code className="text-emerald-400">ADMIN_EMAIL</code> — via Google, or with{" "}
                  <code className="text-emerald-400">ADMIN_PASSWORD</code> from <code>.env</code>.
                </li>
                <li>
                  <strong>Exams &amp; questions:</strong> Admin Console → Exams &amp; Syllabus to
                  create exams, then Question Bank to add questions (one by one, CSV, or AI) and
                  approve them.
                </li>
                <li>
                  <strong>Mock tests:</strong> open <strong>Mock Tests</strong>, switch between{" "}
                  <strong>বাংলা</strong> and <strong>English</strong>, take a test and submit. It is
                  graded on the server; review each answer, then open{" "}
                  <strong>Weakness &amp; Tutor</strong> for AI revision notes.
                </li>
                <li>
                  <strong>Roles &amp; plans:</strong> Admin Console → Users to make someone an{" "}
                  <code className="text-emerald-300">educator</code> or change their plan.
                </li>
              </ol>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">
                  02. How to Test on Your Local PC (i5-9400F, 8GB RAM)
                </h2>
                <button
                  onClick={() =>
                    copyCommand(
                      "local-cmd",
                      "cp .env.example .env && docker compose up -d && npm install && npm run db:push && npm run seed:syllabus && npm run seed"
                    )
                  }
                  className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded text-slate-200 cursor-pointer"
                >
                  {copiedId === "local-cmd" ? "Copied!" : "Copy Commands"}
                </button>
              </div>
              <pre className="text-xs font-mono bg-slate-950 p-4 rounded-lg border border-slate-800 text-emerald-300 overflow-x-auto leading-relaxed">
{`# 1. Postgres (pgvector) + Redis in Docker, then tables + sample data
cp .env.example .env
docker compose up -d
npm install
npm run db:push
npm run seed:syllabus && npm run seed

# 2. Start each service in its own terminal
npm run dev:api-core     # API, port 8080
npm run dev:api-ai       # AI service, port 8081 (activate apps/api-ai/.venv first)
npm run dev              # web app, port 3000

# 3. Test Mobile on Vivo X200 FE over Wi-Fi (No Android Emulator!)
npx expo start --lan`}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
