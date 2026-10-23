import React, { useEffect, useState, useMemo } from "react";
import {
  onAuthStateChanged,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  handleFirestoreError,
  OperationType,
  BOOTSTRAP_ADMIN_EMAIL,
} from "./firebase";
import {
  INITIAL_EXAMS,
  INITIAL_QUESTIONS,
  type SeedExam,
  type SeedQuestion,
} from "./data/seedData";
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
// TypeScript Interfaces Matching firebase-blueprint.json
// ============================================================================

type UserRole = "aspirant" | "educator" | "admin";
type SubscriptionTier = "free" | "pro_prelims" | "wbcs_executive_pass";
type SupportedLang = "en" | "bn";
type ExamSlug =
  | "wbcs-prelims"
  | "wbcs-mains"
  | "wbpsc-clerkship-part1"
  | "wbpsc-clerkship-part2"
  | "wbpsc-miscellaneous"
  | "wbpsc-food-si"
  | "wbp-constable-si";

interface UserProfileDoc {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  subscriptionTier: SubscriptionTier;
  preferredLanguage: SupportedLang;
  targetExamSlug: ExamSlug;
  dailyAiQueriesUsed: number;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

interface TestAttemptDoc {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  examId: string;
  examSlug: ExamSlug;
  examTitleEn: string;
  examTitleBn: string;
  totalQuestions: number;
  attemptedCount: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  finalNetScore: number;
  maxPossibleScore: number;
  accuracyPercentage: number;
  totalTimeSpentSeconds: number;
  cutoffCleared: boolean;
  weakSubtopicsCount: number;
  status: "submitted";
  createdAt?: Timestamp;
}

interface SubtopicMasteryDoc {
  id: string;
  userId: string;
  examId: string;
  examSlug: ExamSlug;
  subtopicSlug: string;
  subtopicNameEn: string;
  subtopicNameBn: string;
  subjectNameEn: string;
  subjectNameBn: string;
  totalEncountered: number;
  totalCorrect: number;
  totalIncorrect: number;
  accuracyPercentage: number;
  avgTimeSeconds: number;
  masteryBand: "critical_weakness" | "needs_revision" | "proficient" | "exam_ready";
  aiNoteCacheKey: string;
  updatedAt?: Timestamp;
}

interface AiNoteCacheDoc {
  id: string;
  canonicalKey: string;
  examSlug: ExamSlug;
  topicSlug: string;
  topicTitleEn: string;
  topicTitleBn: string;
  language: SupportedLang;
  contentMarkdown: string;
  mnemonicsText: string;
  modelUsed: string;
  hitCount: number;
  createdByUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

type ActiveNav =
  | "mock-center"
  | "weakness-tutor"
  | "descriptive-eval"
  | "daily-ca"
  | "admin-console"
  | "testing-guide";

type AdminSubTab = "users" | "exams" | "questions" | "cache-attempts";

export default function App() {
  // 1. Auth & User Profile State
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<UserProfileDoc | null>(null);
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

  // Firestore Collections State
  const [examsList, setExamsList] = useState<SeedExam[]>([]);
  const [questionsList, setQuestionsList] = useState<SeedQuestion[]>([]);
  const [myAttempts, setMyAttempts] = useState<TestAttemptDoc[]>([]);
  const [myMastery, setMyMastery] = useState<SubtopicMasteryDoc[]>([]);
  const [cachedNotes, setCachedNotes] = useState<AiNoteCacheDoc[]>([]);

  // Admin-Only State
  const [allUsers, setAllUsers] = useState<UserProfileDoc[]>([]);
  const [allAttempts, setAllAttempts] = useState<TestAttemptDoc[]>([]);
  const [seedingBusy, setSeedingBusy] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Active Mock Test State
  const [activeExam, setActiveExam] = useState<SeedExam | null>(null);
  const [activeTestQuestions, setActiveTestQuestions] = useState<SeedQuestion[]>([]);
  const [isRemedialMode, setIsRemedialMode] = useState<boolean>(false);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<string, "A" | "B" | "C" | "D">
  >({});
  const [questionTimers, setQuestionTimers] = useState<Record<string, number>>({});
  const [elapsedTotalSec, setElapsedTotalSec] = useState<number>(0);
  const [lastSubmittedAttempt, setLastSubmittedAttempt] =
    useState<TestAttemptDoc | null>(null);

  // AI Tutor Note State
  const [selectedNote, setSelectedNote] = useState<AiNoteCacheDoc | null>(null);
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
  const [descEvaluationResult, setDescEvaluationResult] = useState<any | null>(
    null
  );

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

  // Admin Forms State
  const [newExamTitleEn, setNewExamTitleEn] = useState<string>("");
  const [newExamTitleBn, setNewExamTitleBn] = useState<string>("");
  const [newExamSlug, setNewExamSlug] = useState<ExamSlug>("wbcs-prelims");
  const [newExamDuration, setNewExamDuration] = useState<number>(90);
  const [newExamNegMark, setNewExamNegMark] = useState<number>(0.25);
  const [newExamCutoff, setNewExamCutoff] = useState<number>(65);

  const [newQExamId, setNewQExamId] = useState<string>("exam-wbcs-prelims");
  const [newQSubjectEn, setNewQSubjectEn] = useState<string>(
    "Indian Polity & Constitution"
  );
  const [newQSubjectBn, setNewQSubjectBn] = useState<string>(
    "ভারতের সংবিধান ও রাজনীতি"
  );
  const [newQSubtopicSlug, setNewQSubtopicSlug] = useState<string>(
    "fundamental-rights-articles"
  );
  const [newQSubtopicEn, setNewQSubtopicEn] = useState<string>(
    "Fundamental Rights (Articles 12-35)"
  );
  const [newQSubtopicBn, setNewQSubtopicBn] = useState<string>(
    "মৌলিক অধিকার (ধারা ১২-৩৫)"
  );
  const [newQStemEn, setNewQStemEn] = useState<string>("");
  const [newQStemBn, setNewQStemBn] = useState<string>("");
  const [newQOptAEn, setNewQOptAEn] = useState<string>("");
  const [newQOptABn, setNewQOptABn] = useState<string>("");
  const [newQOptBEn, setNewQOptBEn] = useState<string>("");
  const [newQOptBBn, setNewQOptBBn] = useState<string>("");
  const [newQOptCEn, setNewQOptCEn] = useState<string>("");
  const [newQOptCBn, setNewQOptCBn] = useState<string>("");
  const [newQOptDEn, setNewQOptDEn] = useState<string>("");
  const [newQOptDBn, setNewQOptDBn] = useState<string>("");
  const [newQCorrect, setNewQCorrect] = useState<"A" | "B" | "C" | "D">("A");
  const [newQExpEn, setNewQExpEn] = useState<string>("");
  const [newQExpBn, setNewQExpBn] = useState<string>("");
  const [newQPyqTag, setNewQPyqTag] = useState<string>("WBCS Prelims 2024");

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isUserAdmin = useMemo(() => {
    if (!firebaseUser) return false;
    const isBootstrap =
      firebaseUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() &&
      firebaseUser.emailVerified;
    return isBootstrap || userProfile?.role === "admin";
  }, [firebaseUser, userProfile]);

  const isEducatorOrAdmin = useMemo(() => {
    return isUserAdmin || userProfile?.role === "educator";
  }, [isUserAdmin, userProfile]);

  // =========================================================================
  // 1. Firebase Auth Listener & Profile Bootstrap
  // =========================================================================
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setFirebaseUser(u);
      if (!u) {
        setUserProfile(null);
        setAuthReady(true);
        return;
      }

      const userPath = `users/${u.uid}`;
      try {
        const userRef = doc(db, "users", u.uid);
        const snap = await getDoc(userRef);

        const isBootstrap =
          u.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() &&
          u.emailVerified;

        if (!snap.exists()) {
          const initialRole: UserRole = isBootstrap ? "admin" : "aspirant";
          const initialTier: SubscriptionTier = isBootstrap
            ? "wbcs_executive_pass"
            : "free";
          const safeDisplayName = (
            u.displayName ||
            u.email?.split("@")[0] ||
            "WBPSC Aspirant"
          ).slice(0, 120);

          await setDoc(userRef, {
            uid: u.uid,
            email: (u.email || "aspirant@wbpsc.in").slice(0, 254),
            displayName: safeDisplayName,
            role: initialRole,
            subscriptionTier: initialTier,
            preferredLanguage: "bn",
            targetExamSlug: "wbcs-prelims",
            dailyAiQueriesUsed: 0,
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          if (isBootstrap) {
            await setDoc(doc(db, "admins", u.uid), {
              uid: u.uid,
              email: (u.email || BOOTSTRAP_ADMIN_EMAIL).slice(0, 254),
              grantedBy: u.uid,
              createdAt: serverTimestamp(),
            });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, userPath);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  // =========================================================================
  // 2. Real-Time Firestore Listeners (Wait until Auth is Ready)
  // =========================================================================
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    // Listen to current user's profile
    const unsubProfile = onSnapshot(
      doc(db, "users", firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfileDoc;
          setUserProfile(data);
          setLang(data.preferredLanguage || "bn");
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`)
    );

    // Listen to Exams
    const examsQuery = isUserAdmin
      ? collection(db, "exams")
      : query(collection(db, "exams"), where("isActive", "==", true));

    const unsubExams = onSnapshot(
      examsQuery,
      (snap) => {
        const items: SeedExam[] = [];
        snap.forEach((d) => items.push(d.data() as SeedExam));
        setExamsList(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "exams")
    );

    // Listen to Questions
    const questionsQuery = isEducatorOrAdmin
      ? collection(db, "questions")
      : query(collection(db, "questions"), where("isActive", "==", true));

    const unsubQuestions = onSnapshot(
      questionsQuery,
      (snap) => {
        const items: SeedQuestion[] = [];
        snap.forEach((d) => items.push(d.data() as SeedQuestion));
        setQuestionsList(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "questions")
    );

    // Listen to current user's Test Attempts
    const myAttemptsQuery = query(
      collection(db, "attempts"),
      where("userId", "==", firebaseUser.uid)
    );
    const unsubMyAttempts = onSnapshot(
      myAttemptsQuery,
      (snap) => {
        const items: TestAttemptDoc[] = [];
        snap.forEach((d) => items.push(d.data() as TestAttemptDoc));
        items.sort(
          (a, b) =>
            (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
        );
        setMyAttempts(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "attempts")
    );

    // Listen to current user's Subtopic Mastery
    const myMasteryQuery = query(
      collection(db, "mastery"),
      where("userId", "==", firebaseUser.uid)
    );
    const unsubMyMastery = onSnapshot(
      myMasteryQuery,
      (snap) => {
        const items: SubtopicMasteryDoc[] = [];
        snap.forEach((d) => items.push(d.data() as SubtopicMasteryDoc));
        items.sort((a, b) => a.accuracyPercentage - b.accuracyPercentage);
        setMyMastery(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "mastery")
    );

    // Listen to Shared L2 AI Notes Cache
    const notesQuery = query(
      collection(db, "aiNotesCache"),
      where("language", "in", ["en", "bn"])
    );
    const unsubNotes = onSnapshot(
      notesQuery,
      (snap) => {
        const items: AiNoteCacheDoc[] = [];
        snap.forEach((d) => items.push(d.data() as AiNoteCacheDoc));
        setCachedNotes(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "aiNotesCache")
    );

    return () => {
      unsubProfile();
      unsubExams();
      unsubQuestions();
      unsubMyAttempts();
      unsubMyMastery();
      unsubNotes();
    };
  }, [authReady, firebaseUser, isUserAdmin, isEducatorOrAdmin]);

  // Admin-Only Listeners for ALL Users and ALL Attempts
  useEffect(() => {
    if (!authReady || !firebaseUser || !isUserAdmin) {
      setAllUsers([]);
      setAllAttempts([]);
      return;
    }

    const unsubAllUsers = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: UserProfileDoc[] = [];
        snap.forEach((d) => list.push(d.data() as UserProfileDoc));
        setAllUsers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "users")
    );

    const unsubAllAttempts = onSnapshot(
      collection(db, "attempts"),
      (snap) => {
        const list: TestAttemptDoc[] = [];
        snap.forEach((d) => list.push(d.data() as TestAttemptDoc));
        list.sort(
          (a, b) =>
            (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
        );
        setAllAttempts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "attempts")
    );

    return () => {
      unsubAllUsers();
      unsubAllAttempts();
    };
  }, [authReady, firebaseUser, isUserAdmin]);

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

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      if (authMode === "signup") {
        const cred = await createUserWithEmailAndPassword(
          auth,
          emailInput.trim(),
          passwordInput
        );
        if (fullNameInput.trim()) {
          await updateProfile(cred.user, {
            displayName: fullNameInput.trim().slice(0, 120),
          });
        }
      } else {
        await signInWithEmailAndPassword(auth, emailInput.trim(), passwordInput);
      }
    } catch (err: any) {
      const code = err?.code || "";
      if (code === "auth/operation-not-allowed") {
        setAuthError(
          "Email/Password provider is not yet enabled in your Firebase Console. Enable it in Firebase Console -> Authentication -> Sign-in method -> Email/Password, or click 'Continue with Google' below."
        );
      } else {
        setAuthError(err?.message || "Authentication failed.");
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setAuthError(err?.message || "Google sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    setActiveExam(null);
    await signOut(auth);
  };

  // =========================================================================
  // 4. Admin Seed & Management Handlers
  // =========================================================================

  const handleSeedDatabase = async () => {
    if (!isUserAdmin || !firebaseUser) return;
    setSeedingBusy(true);
    setStatusBanner(null);
    try {
      for (const ex of INITIAL_EXAMS) {
        await setDoc(doc(db, "exams", ex.id), {
          ...ex,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      for (const q of INITIAL_QUESTIONS) {
        await setDoc(doc(db, "questions", q.id), {
          ...q,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setStatusBanner({
        type: "success",
        text: `Seeded ${INITIAL_EXAMS.length} WBPSC Exams and ${INITIAL_QUESTIONS.length} Bilingual MCQs into Firestore.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "exams/questions");
    } finally {
      setSeedingBusy(false);
    }
  };

  const handleAdminUpdateUser = async (
    targetUser: UserProfileDoc,
    updates: Partial<
      Pick<
        UserProfileDoc,
        "role" | "subscriptionTier" | "isActive" | "dailyAiQueriesUsed"
      >
    >
  ) => {
    if (!isUserAdmin || !firebaseUser) return;
    const path = `users/${targetUser.uid}`;
    try {
      await updateDoc(doc(db, "users", targetUser.uid), {
        ...updates,
        updatedAt: serverTimestamp(),
      });

      // Keep /admins/{uid} collection synchronized when promoting/demoting Admin role
      if (updates.role === "admin") {
        await setDoc(doc(db, "admins", targetUser.uid), {
          uid: targetUser.uid,
          email: targetUser.email,
          grantedBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
        });
      } else if (updates.role && updates.role !== "admin") {
        try {
          await deleteDoc(doc(db, "admins", targetUser.uid));
        } catch {
          // Ignore if not present
        }
      }

      setStatusBanner({
        type: "success",
        text: `Updated RBAC profile for ${targetUser.displayName} (${targetUser.email}).`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleAdminCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isUserAdmin) return;
    const examId = `exam-${newExamSlug}-${Date.now().toString().slice(-5)}`;
    try {
      await setDoc(doc(db, "exams", examId), {
        id: examId,
        slug: newExamSlug,
        titleEn: newExamTitleEn.trim().slice(0, 200),
        titleBn: newExamTitleBn.trim().slice(0, 200),
        descriptionEn: `Official pattern mock test for ${newExamTitleEn.trim()}`.slice(
          0,
          600
        ),
        descriptionBn: `${newExamTitleBn.trim()} পরীক্ষার পূর্ণাঙ্গ মক টেস্ট`.slice(
          0,
          600
        ),
        totalQuestions: 25,
        durationMinutes: Number(newExamDuration),
        marksPerCorrect: 1,
        negativeMarksPerWrong: Number(newExamNegMark),
        estimatedCutoffMarks: Number(newExamCutoff),
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewExamTitleEn("");
      setNewExamTitleBn("");
      setStatusBanner({
        type: "success",
        text: `Created exam configuration: ${examId}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `exams/${examId}`);
    }
  };

  const handleAdminToggleExam = async (exam: SeedExam) => {
    if (!isUserAdmin) return;
    try {
      await updateDoc(doc(db, "exams", exam.id), {
        isActive: !exam.isActive,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `exams/${exam.id}`);
    }
  };

  const handleAdminDeleteExam = async (examId: string) => {
    if (!isUserAdmin) return;
    try {
      await deleteDoc(doc(db, "exams", examId));
      setStatusBanner({
        type: "info",
        text: `Deleted exam ${examId}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `exams/${examId}`);
    }
  };

  const handleAdminCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEducatorOrAdmin) return;
    const targetExam =
      examsList.find((ex) => ex.id === newQExamId) || examsList[0];
    if (!targetExam) {
      setStatusBanner({
        type: "error",
        text: "Please seed or create an Exam first before adding questions.",
      });
      return;
    }

    const qId = `q-${Date.now().toString().slice(-7)}`;
    const sanitizedSubtopicSlug = newQSubtopicSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");

    try {
      await setDoc(doc(db, "questions", qId), {
        id: qId,
        examId: targetExam.id,
        examSlug: targetExam.slug,
        subjectNameEn: newQSubjectEn.trim().slice(0, 160),
        subjectNameBn: newQSubjectBn.trim().slice(0, 160),
        subtopicSlug: sanitizedSubtopicSlug.slice(0, 128),
        subtopicNameEn: newQSubtopicEn.trim().slice(0, 200),
        subtopicNameBn: newQSubtopicBn.trim().slice(0, 200),
        stemEn: newQStemEn.trim().slice(0, 1500),
        stemBn: newQStemBn.trim().slice(0, 1500),
        optionAEn: newQOptAEn.trim().slice(0, 500),
        optionABn: newQOptABn.trim().slice(0, 500),
        optionBEn: newQOptBEn.trim().slice(0, 500),
        optionBBn: newQOptBBn.trim().slice(0, 500),
        optionCEn: newQOptCEn.trim().slice(0, 500),
        optionCBn: newQOptCBn.trim().slice(0, 500),
        optionDEn: newQOptDEn.trim().slice(0, 500),
        optionDBn: newQOptDBn.trim().slice(0, 500),
        correctOption: newQCorrect,
        explanationEn: newQExpEn.trim().slice(0, 2000),
        explanationBn: newQExpBn.trim().slice(0, 2000),
        difficulty: "moderate",
        marksPositive: Number(targetExam.marksPerCorrect),
        marksNegative: Number(targetExam.negativeMarksPerWrong),
        previousYearTag: newQPyqTag.trim().slice(0, 120),
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewQStemEn("");
      setNewQStemBn("");
      setStatusBanner({
        type: "success",
        text: `Added bilingual MCQ (${qId}) to ${targetExam.titleEn}.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `questions/${qId}`);
    }
  };

  const handleAdminDeleteQuestion = async (qId: string) => {
    if (!isUserAdmin) return;
    try {
      await deleteDoc(doc(db, "questions", qId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `questions/${qId}`);
    }
  };

  // =========================================================================
  // 5. Mock Test & Deterministic Grading Handlers (Zero AI Cost for MCQs)
  // =========================================================================

  const startMockTest = (exam: SeedExam, remedialOnly = false) => {
    const examQuestions = questionsList.filter(
      (q) => q.examId === exam.id && q.isActive
    );
    const pool =
      examQuestions.length > 0 ? examQuestions : questionsList.slice(0, 10);

    let chosenQuestions = pool;
    if (remedialOnly && myMastery.length > 0) {
      const top3WeakSlugs = new Set(
        myMastery.slice(0, 3).map((m) => m.subtopicSlug)
      );
      const filtered = pool.filter((q) => top3WeakSlugs.has(q.subtopicSlug));
      if (filtered.length > 0) {
        chosenQuestions = filtered;
      }
    }

    setActiveExam(exam);
    setActiveTestQuestions(chosenQuestions);
    setIsRemedialMode(remedialOnly);
    setCurrentQuestionIdx(0);
    setSelectedAnswers({});
    setQuestionTimers({});
    setElapsedTotalSec(0);
    setLastSubmittedAttempt(null);
  };

  const handleSubmitMockTest = async () => {
    if (!activeExam || !firebaseUser || !userProfile) return;

    let attemptedCount = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;
    let rawPositive = 0;
    let negativePenalty = 0;

    const posMark = Number(activeExam.marksPerCorrect) || 1;
    const negMark = Number(activeExam.negativeMarksPerWrong) || 0.25;

    interface SubAccum {
      subtopicSlug: string;
      subtopicNameEn: string;
      subtopicNameBn: string;
      subjectNameEn: string;
      subjectNameBn: string;
      total: number;
      correct: number;
      incorrect: number;
      timeSec: number;
    }

    const subtopicMap = new Map<string, SubAccum>();

    for (const q of activeTestQuestions) {
      const chosen = selectedAnswers[q.id];
      const spent = questionTimers[q.id] || 8;

      if (!chosen) {
        unansweredCount += 1;
      } else {
        attemptedCount += 1;
        if (chosen === q.correctOption) {
          correctCount += 1;
          rawPositive += posMark;
        } else {
          incorrectCount += 1;
          negativePenalty += negMark;
        }
      }

      const prev = subtopicMap.get(q.subtopicSlug) || {
        subtopicSlug: q.subtopicSlug,
        subtopicNameEn: q.subtopicNameEn,
        subtopicNameBn: q.subtopicNameBn,
        subjectNameEn: q.subjectNameEn,
        subjectNameBn: q.subjectNameBn,
        total: 0,
        correct: 0,
        incorrect: 0,
        timeSec: 0,
      };

      prev.total += 1;
      if (chosen === q.correctOption) prev.correct += 1;
      if (chosen && chosen !== q.correctOption) prev.incorrect += 1;
      prev.timeSec += spent;
      subtopicMap.set(q.subtopicSlug, prev);
    }

    const finalNetScore = Number((rawPositive - negativePenalty).toFixed(2));
    const maxPossibleScore = Number(
      (activeTestQuestions.length * posMark).toFixed(2)
    );
    const accuracyPercentage =
      attemptedCount > 0
        ? Number(((correctCount / attemptedCount) * 100).toFixed(2))
        : 0;

    let weakSubtopicsCount = 0;
    for (const sub of subtopicMap.values()) {
      const acc = (sub.correct / sub.total) * 100;
      if (acc < 50) weakSubtopicsCount += 1;
    }

    const attemptId = `att-${firebaseUser.uid.slice(0, 6)}-${Date.now()}`;
    const attemptDoc: TestAttemptDoc = {
      id: attemptId,
      userId: firebaseUser.uid,
      userEmail: userProfile.email,
      userName: userProfile.displayName,
      examId: activeExam.id,
      examSlug: activeExam.slug,
      examTitleEn: activeExam.titleEn,
      examTitleBn: activeExam.titleBn,
      totalQuestions: activeTestQuestions.length,
      attemptedCount,
      correctCount,
      incorrectCount,
      unansweredCount,
      finalNetScore,
      maxPossibleScore,
      accuracyPercentage,
      totalTimeSpentSeconds: elapsedTotalSec,
      cutoffCleared: finalNetScore >= Number(activeExam.estimatedCutoffMarks),
      weakSubtopicsCount,
      status: "submitted",
    };

    try {
      await setDoc(doc(db, "attempts", attemptId), {
        ...attemptDoc,
        createdAt: serverTimestamp(),
      });

      // Upsert Subtopic Mastery records deterministically
      for (const sub of subtopicMap.values()) {
        const masteryId = `${firebaseUser.uid}_${sub.subtopicSlug}`.replace(
          /[^a-zA-Z0-9_-]/g,
          "-"
        );
        const existingMastery = myMastery.find((m) => m.id === masteryId);

        const totalEncountered =
          (existingMastery?.totalEncountered || 0) + sub.total;
        const totalCorrect =
          (existingMastery?.totalCorrect || 0) + sub.correct;
        const totalIncorrect =
          (existingMastery?.totalIncorrect || 0) + sub.incorrect;
        const newAcc = Number(
          ((totalCorrect / Math.max(1, totalEncountered)) * 100).toFixed(2)
        );
        const avgTimeSeconds = Number(
          (sub.timeSec / Math.max(1, sub.total)).toFixed(2)
        );

        const masteryBand: SubtopicMasteryDoc["masteryBand"] =
          newAcc < 50
            ? "critical_weakness"
            : newAcc < 70
            ? "needs_revision"
            : newAcc < 85
            ? "proficient"
            : "exam_ready";

        if (existingMastery) {
          await updateDoc(doc(db, "mastery", masteryId), {
            totalEncountered,
            totalCorrect,
            totalIncorrect,
            accuracyPercentage: newAcc,
            avgTimeSeconds,
            masteryBand,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(doc(db, "mastery", masteryId), {
            id: masteryId,
            userId: firebaseUser.uid,
            examId: activeExam.id,
            examSlug: activeExam.slug,
            subtopicSlug: sub.subtopicSlug,
            subtopicNameEn: sub.subtopicNameEn,
            subtopicNameBn: sub.subtopicNameBn,
            subjectNameEn: sub.subjectNameEn,
            subjectNameBn: sub.subjectNameBn,
            totalEncountered,
            totalCorrect,
            totalIncorrect,
            accuracyPercentage: newAcc,
            avgTimeSeconds,
            masteryBand,
            aiNoteCacheKey: `${activeExam.slug}:${sub.subtopicSlug}:${lang}`,
            updatedAt: serverTimestamp(),
          });
        }
      }

      setLastSubmittedAttempt(attemptDoc);
      setActiveExam(null);
      setActiveTestQuestions([]);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `attempts/${attemptId}`);
    }
  };

  // =========================================================================
  // 6. 3-Tier Cached AI Study Note Handler (L2 Firestore -> L3 Server Gemini)
  // =========================================================================

  const handleOpenOrGenerateAiNote = async (mastery: SubtopicMasteryDoc) => {
    if (!firebaseUser || !userProfile) return;
    const canonicalKey = `${mastery.examSlug}:${mastery.subtopicSlug}:${lang}`;
    const noteId = `${mastery.examSlug}_${mastery.subtopicSlug}_${lang}`.replace(
      /[^a-zA-Z0-9_-]/g,
      "-"
    );

    // Tier 2 Check: Look up existing note in /aiNotesCache
    const cached = cachedNotes.find((n) => n.id === noteId);
    if (cached) {
      setSelectedNote(cached);
      setActiveNav("weakness-tutor");
      try {
        await updateDoc(doc(db, "aiNotesCache", noteId), {
          hitCount: cached.hitCount + 1,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Ignore hit counter race
      }
      return;
    }

    // Tier 3 Miss: Enforce Pro quota (15/day) unless Admin
    if (
      !isUserAdmin &&
      userProfile.subscriptionTier === "free"
    ) {
      setStatusBanner({
        type: "error",
        text: "Generating new AI Study Notes requires a Pro Prelims or WBCS Executive Pass (or ask an Admin to upgrade your tier in the Admin Console).",
      });
      return;
    }

    if (!isUserAdmin && userProfile.dailyAiQueriesUsed >= 15) {
      setStatusBanner({
        type: "error",
        text: "Daily AI Tutor quota (15 queries/day) reached. Cached notes remain unlimited.",
      });
      return;
    }

    setGeneratingTopicSlug(mastery.subtopicSlug);
    try {
      const response = await fetch("/api/ai/generate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examSlug: mastery.examSlug,
          subjectName:
            lang === "bn" ? mastery.subjectNameBn : mastery.subjectNameEn,
          topicSlug: mastery.subtopicSlug,
          topicTitle:
            lang === "bn" ? mastery.subtopicNameBn : mastery.subtopicNameEn,
          language: lang,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate note");
      }

      const newNoteDoc: AiNoteCacheDoc = {
        id: noteId,
        canonicalKey,
        examSlug: mastery.examSlug,
        topicSlug: mastery.subtopicSlug,
        topicTitleEn: mastery.subtopicNameEn,
        topicTitleBn: mastery.subtopicNameBn,
        language: lang,
        contentMarkdown: String(data.contentMarkdown).slice(0, 19500),
        mnemonicsText: String(data.mnemonicsText).slice(0, 1950),
        modelUsed: data.modelUsed || "gemini-3.8-flash",
        hitCount: 1,
        createdByUid: firebaseUser.uid,
      };

      await setDoc(doc(db, "aiNotesCache", noteId), {
        ...newNoteDoc,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "users", firebaseUser.uid), {
        dailyAiQueriesUsed: userProfile.dailyAiQueriesUsed + 1,
        updatedAt: serverTimestamp(),
      });

      setSelectedNote(newNoteDoc);
      setActiveNav("weakness-tutor");
    } catch (err: any) {
      setStatusBanner({
        type: "error",
        text: err?.message || "AI Note generation failed.",
      });
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
    if (!firebaseUser || !userProfile) return;
    setDescEvalBusy(true);
    setStatusBanner(null);
    try {
      const res = await fetch("/api/ai/evaluate-descriptive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examSlug: descExamSlug,
          taskType: descTaskType,
          language: lang,
          questionPrompt: descPrompt,
          targetWordLimit: descWordLimit,
          studentAnswerText: descStudentText,
          imageBase64: descImageBase64,
          imageMimeType: descImageMime,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Evaluation failed");
      setDescEvaluationResult(data.evaluation);

      await updateDoc(doc(db, "users", firebaseUser.uid), {
        dailyAiQueriesUsed: userProfile.dailyAiQueriesUsed + 1,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      setStatusBanner({
        type: "error",
        text: err?.message || "Descriptive evaluation error.",
      });
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
          Initializing Firebase Auth &amp; WBPSC Session...
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
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
          <button
            onClick={handleGoogleSignIn}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sign In with Google
          </button>
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
                  Deterministic SQL &amp; Firestore Grading
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

          {/* Right Column: Firebase Email/Password + Google Auth Card */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white">
                  {authMode === "signin"
                    ? "Sign in to your account"
                    : "Create an Aspirant account"}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Managed by Google Firebase Authentication
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
                  minLength={6}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Minimum 6 characters"
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

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={authBusy}
              className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm rounded-lg border border-slate-700 transition-colors cursor-pointer"
            >
              Continue with Google (Instant Admin for {BOOTSTRAP_ADMIN_EMAIL})
            </button>

            <div className="text-[11px] text-slate-400 leading-relaxed pt-2 border-t border-slate-800">
              Note: Google Login is pre-configured out of the box. To use Email &amp;
              Password login, enable the <strong>Email/Password</strong> provider in your{" "}
              <a
                href="https://console.firebase.google.com/project/gen-lang-client-0286348026/authentication/providers"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 underline"
              >
                Firebase Console Auth Providers
              </a>
              .
            </div>
          </div>
        </main>

        <footer className="px-6 py-4 border-t border-slate-900 text-xs text-slate-500 flex justify-between">
          <span>WBPSC AI Mock Test &amp; Tutor</span>
          <span>Bilingual (বাংলা + English) · Firebase RBAC</span>
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
              {userProfile?.displayName || firebaseUser.email}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Role:{" "}
              <strong className="text-emerald-400 uppercase">
                {isUserAdmin ? "admin" : userProfile?.role || "aspirant"}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Tier:{" "}
              <strong className="text-slate-200">
                {userProfile?.subscriptionTier || "free"}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              AI Quota Today: {userProfile?.dailyAiQueriesUsed || 0}/15
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
                onClick={() => setLang("bn")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  lang === "bn"
                    ? "bg-emerald-500 text-slate-950 font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                বাংলা (BN)
              </button>
              <button
                onClick={() => setLang("en")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  lang === "en"
                    ? "bg-emerald-500 text-slate-950 font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                English (EN)
              </button>
            </div>

            {isUserAdmin && examsList.length === 0 && (
              <button
                onClick={handleSeedDatabase}
                disabled={seedingBusy}
                className="px-3.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {seedingBusy ? "Seeding..." : "Seed Initial WBPSC DB"}
              </button>
            )}
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
                      className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Submit &amp; Grade Test
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
                        <span className="font-mono tabular-nums">
                          {q.previousYearTag}
                        </span>
                      </div>

                      <div className="text-base sm:text-lg font-medium text-white leading-relaxed">
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
                              className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                            >
                              Finish &amp; Submit
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
                      onClick={() => startMockTest(examsList[0], true)}
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
                  </div>
                )}

                {examsList.length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-4">
                    <p className="text-sm text-slate-300">
                      No WBPSC exams have been seeded into Firestore yet.
                    </p>
                    {isUserAdmin ? (
                      <button
                        onClick={handleSeedDatabase}
                        disabled={seedingBusy}
                        className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
                      >
                        {seedingBusy
                          ? "Seeding WBPSC Exams & Bilingual MCQs..."
                          : "Seed Initial WBPSC Exams & Questions"}
                      </button>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Sign in as the Administrator ({BOOTSTRAP_ADMIN_EMAIL}) to seed
                        the initial WBPSC question bank.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {examsList.map((exam) => {
                      const qCount = questionsList.filter(
                        (q) => q.examId === exam.id && q.isActive
                      ).length;
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
                              onClick={() => startMockTest(exam, false)}
                              className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {myAttempts.map((att) => (
                            <tr
                              key={att.id}
                              className="hover:bg-slate-800/40 transition-colors"
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
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
                    const noteId = `${m.examSlug}_${m.subtopicSlug}_${lang}`.replace(
                      /[^a-zA-Z0-9_-]/g,
                      "-"
                    );
                    const isCached = cachedNotes.some((n) => n.id === noteId);
                    const isGenerating = generatingTopicSlug === m.subtopicSlug;

                    return (
                      <div
                        key={m.id}
                        className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="text-xs text-slate-400">
                            {lang === "bn" ? m.subjectNameBn : m.subjectNameEn} ·{" "}
                            <span className="font-mono tabular-nums">
                              Accuracy: {m.accuracyPercentage}%
                            </span>{" "}
                            ·{" "}
                            <span className="font-mono tabular-nums">
                              Avg Time: {m.avgTimeSeconds}s
                            </span>
                          </div>
                          <div className="text-sm font-bold text-white">
                            {lang === "bn" ? m.subtopicNameBn : m.subtopicNameEn}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            Band: {m.masteryBand} · Cache Key: {m.aiNoteCacheKey}
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
                            ? "Open L2 Cached Note (0 Tokens)"
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
                  Shared across all users via Firestore L2 `aiNotesCache` to eliminate
                  duplicate LLM calls.
                </p>
              </div>

              {selectedNote ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                  <div className="border-b border-slate-800 pb-3">
                    <div className="text-xs text-slate-400 font-mono">
                      Key: {selectedNote.canonicalKey} · Hits:{" "}
                      {selectedNote.hitCount} · Model: {selectedNote.modelUsed}
                    </div>
                    <h3 className="text-lg font-bold text-white mt-1">
                      {lang === "bn"
                        ? selectedNote.topicTitleBn
                        : selectedNote.topicTitleEn}
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
                      {selectedNote.mnemonicsText}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-xs text-slate-400">
                  Select a subtopic on the left or choose from {cachedNotes.length}{" "}
                  cached notes below to view revision material.
                  {cachedNotes.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {cachedNotes.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => setSelectedNote(n)}
                          className="w-full text-left p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 flex items-center justify-between cursor-pointer"
                        >
                          <span className="font-medium text-slate-200">
                            {n.language === "bn" ? n.topicTitleBn : n.topicTitleEn} (
                            {n.language.toUpperCase()})
                          </span>
                          <span className="font-mono text-[11px] text-emerald-400">
                            {n.hitCount} hits
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
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
                  Full RBAC control over Users, Subscription Tiers, Exam
                  Configurations, Bilingual MCQ Bank, and L2 AI Cache.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSeedDatabase}
                  disabled={seedingBusy}
                  className="px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg cursor-pointer"
                >
                  {seedingBusy ? "Seeding..." : "Re-Seed Default Exams & MCQs"}
                </button>
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
                2. Exams Config ({examsList.length})
              </button>
              <button
                onClick={() => setAdminTab("questions")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  adminTab === "questions"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                3. Bilingual MCQ Bank ({questionsList.length})
              </button>
              <button
                onClick={() => setAdminTab("cache-attempts")}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  adminTab === "cache-attempts"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                4. AI Cache ({cachedNotes.length}) &amp; Attempts (
                {allAttempts.length})
              </button>
            </div>

            {/* Sub-Tab 1: Users & RBAC Manager */}
            {adminTab === "users" && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-3 px-4">User / Email</th>
                      <th className="py-3 px-4">Role (RBAC)</th>
                      <th className="py-3 px-4">Subscription Tier</th>
                      <th className="py-3 px-4 text-right">AI Queries Used</th>
                      <th className="py-3 px-4">Account Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {allUsers.map((u) => (
                      <tr key={u.uid} className="hover:bg-slate-800/30">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">
                            {u.displayName}
                          </div>
                          <div className="text-slate-400 font-mono text-[11px]">
                            {u.email}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <select
                            value={u.role}
                            onChange={(e) =>
                              handleAdminUpdateUser(u, {
                                role: e.target.value as UserRole,
                              })
                            }
                            className="px-2.5 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                          >
                            <option value="aspirant">aspirant</option>
                            <option value="educator">educator</option>
                            <option value="admin">admin</option>
                          </select>
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
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {u.dailyAiQueriesUsed} / 15
                        </td>
                        <td className="py-3 px-4">
                          <button
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
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() =>
                              handleAdminUpdateUser(u, {
                                dailyAiQueriesUsed: 0,
                              })
                            }
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                          >
                            Reset AI Quota
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-Tab 2: Exams Manager */}
            {adminTab === "exams" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleAdminCreateExam}
                  className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-white">
                    Create New WBPSC Exam Configuration
                  </h3>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Exam Slug
                    </label>
                    <select
                      value={newExamSlug}
                      onChange={(e) =>
                        setNewExamSlug(e.target.value as ExamSlug)
                      }
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    >
                      <option value="wbcs-prelims">wbcs-prelims</option>
                      <option value="wbcs-mains">wbcs-mains</option>
                      <option value="wbpsc-clerkship-part1">
                        wbpsc-clerkship-part1
                      </option>
                      <option value="wbpsc-clerkship-part2">
                        wbpsc-clerkship-part2
                      </option>
                      <option value="wbpsc-food-si">wbpsc-food-si</option>
                      <option value="wbpsc-miscellaneous">
                        wbpsc-miscellaneous
                      </option>
                      <option value="wbp-constable-si">wbp-constable-si</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Title (English)
                    </label>
                    <input
                      type="text"
                      required
                      value={newExamTitleEn}
                      onChange={(e) => setNewExamTitleEn(e.target.value)}
                      placeholder="e.g., WBCS Preliminary Mock Series #2"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Title (বাংলা)
                    </label>
                    <input
                      type="text"
                      required
                      value={newExamTitleBn}
                      onChange={(e) => setNewExamTitleBn(e.target.value)}
                      placeholder="যেমন: ডব্লিউবিসিএস প্রিলিমিনারি মক টেস্ট #২"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Duration (m)
                      </label>
                      <input
                        type="number"
                        value={newExamDuration}
                        onChange={(e) =>
                          setNewExamDuration(Number(e.target.value))
                        }
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Negative Mark
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={newExamNegMark}
                        onChange={(e) =>
                          setNewExamNegMark(Number(e.target.value))
                        }
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Cutoff
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        value={newExamCutoff}
                        onChange={(e) =>
                          setNewExamCutoff(Number(e.target.value))
                        }
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white font-mono"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg cursor-pointer"
                  >
                    Create Exam Configuration
                  </button>
                </form>

                <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-white">
                    Existing Exams ({examsList.length})
                  </h3>
                  <div className="space-y-2.5">
                    {examsList.map((ex) => (
                      <div
                        key={ex.id}
                        className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-4"
                      >
                        <div>
                          <div className="text-xs font-bold text-white">
                            {ex.titleEn} / {ex.titleBn}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            ID: {ex.id} · Neg: -{ex.negativeMarksPerWrong} ·{" "}
                            {ex.durationMinutes}m · Cutoff:{" "}
                            {ex.estimatedCutoffMarks}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleAdminToggleExam(ex)}
                            className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                              ex.isActive
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {ex.isActive ? "Active" : "Hidden"}
                          </button>
                          <button
                            onClick={() => handleAdminDeleteExam(ex.id)}
                            className="p-1.5 text-rose-400 hover:bg-rose-950 rounded cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Tab 3: Bilingual Question Bank Manager */}
            {adminTab === "questions" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleAdminCreateQuestion}
                  className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-white">
                    Add New Bilingual MCQ (EN + বাংলা)
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Target Exam
                      </label>
                      <select
                        value={newQExamId}
                        onChange={(e) => setNewQExamId(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                      >
                        {examsList.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.titleEn}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Subtopic Slug
                      </label>
                      <input
                        type="text"
                        required
                        value={newQSubtopicSlug}
                        onChange={(e) => setNewQSubtopicSlug(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={newQStemEn}
                      onChange={(e) => setNewQStemEn(e.target.value)}
                      placeholder="Question Stem (English)"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newQStemBn}
                      onChange={(e) => setNewQStemBn(e.target.value)}
                      placeholder="প্রশ্নের মূল অংশ (বাংলা)"
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={newQOptAEn}
                      onChange={(e) => setNewQOptAEn(e.target.value)}
                      placeholder="Option A (EN)"
                      className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newQOptABn}
                      onChange={(e) => setNewQOptABn(e.target.value)}
                      placeholder="Option A (বাংলা)"
                      className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newQOptBEn}
                      onChange={(e) => setNewQOptBEn(e.target.value)}
                      placeholder="Option B (EN)"
                      className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newQOptBBn}
                      onChange={(e) => setNewQOptBBn(e.target.value)}
                      placeholder="Option B (বাংলা)"
                      className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newQOptCEn}
                      onChange={(e) => setNewQOptCEn(e.target.value)}
                      placeholder="Option C (EN)"
                      className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newQOptCBn}
                      onChange={(e) => setNewQOptCBn(e.target.value)}
                      placeholder="Option C (বাংলা)"
                      className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newQOptDEn}
                      onChange={(e) => setNewQOptDEn(e.target.value)}
                      placeholder="Option D (EN)"
                      className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newQOptDBn}
                      onChange={(e) => setNewQOptDBn(e.target.value)}
                      placeholder="Option D (বাংলা)"
                      className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={newQCorrect}
                      onChange={(e) => setNewQCorrect(e.target.value as any)}
                      className="px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    >
                      <option value="A">Correct: A</option>
                      <option value="B">Correct: B</option>
                      <option value="C">Correct: C</option>
                      <option value="D">Correct: D</option>
                    </select>
                    <input
                      type="text"
                      required
                      value={newQExpEn}
                      onChange={(e) => setNewQExpEn(e.target.value)}
                      placeholder="Explanation (EN)"
                      className="px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newQExpBn}
                      onChange={(e) => setNewQExpBn(e.target.value)}
                      placeholder="ব্যাখ্যা (বাংলা)"
                      className="px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg cursor-pointer"
                  >
                    Save Bilingual MCQ to Question Bank
                  </button>
                </form>

                <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 max-h-[540px] overflow-y-auto">
                  <h3 className="text-sm font-bold text-white">
                    Active Bilingual MCQs ({questionsList.length})
                  </h3>
                  <div className="space-y-2.5">
                    {questionsList.map((q) => (
                      <div
                        key={q.id}
                        className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1 text-xs">
                          <div className="text-slate-400 font-mono text-[11px]">
                            {q.examSlug} · {q.subtopicSlug} · Ans:{" "}
                            {q.correctOption}
                          </div>
                          <div className="font-medium text-white">
                            {q.stemBn}
                          </div>
                          <div className="text-slate-400">{q.stemEn}</div>
                        </div>
                        <button
                          onClick={() => handleAdminDeleteQuestion(q.id)}
                          className="p-1.5 text-rose-400 hover:bg-rose-950 rounded shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Tab 4: L2 AI Cache & All User Attempts */}
            {adminTab === "cache-attempts" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-white">
                    L2 Cached AI Study Notes ({cachedNotes.length})
                  </h3>
                  {cachedNotes.map((n) => (
                    <div
                      key={n.id}
                      className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-white">
                          {n.canonicalKey}
                        </div>
                        <div className="text-slate-400">
                          Hits: {n.hitCount} · Model: {n.modelUsed}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          await deleteDoc(doc(db, "aiNotesCache", n.id));
                        }}
                        className="p-1.5 text-rose-400 hover:bg-rose-950 rounded cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
                          {att.accuracyPercentage}%
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          await deleteDoc(doc(db, "attempts", att.id));
                        }}
                        className="p-1.5 text-rose-400 hover:bg-rose-950 rounded cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            TAB 6: HOW TO TEST IN AI STUDIO & ON LOCAL 8GB RAM PC
        =================================================================== */}
        {activeNav === "testing-guide" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">
                01. How to Test Right Now in Google AI Studio
              </h2>
              <ol className="list-decimal pl-5 text-xs sm:text-sm text-slate-300 space-y-2.5 leading-relaxed">
                <li>
                  <strong>Instant Admin Access:</strong> Sign in with Google using{" "}
                  <code className="text-emerald-400">{BOOTSTRAP_ADMIN_EMAIL}</code>.
                  The Firestore security rules verify your email and automatically
                  grant you full <strong>Admin</strong> privileges.
                </li>
                <li>
                  <strong>Seed Initial WBPSC Database:</strong> Click{" "}
                  <strong>Seed Initial WBPSC DB</strong> in the toolbar (or inside{" "}
                  <strong>Admin Console</strong>) to populate WBCS Prelims, Clerkship,
                  Food SI, and Miscellaneous exams + bilingual MCQs.
                </li>
                <li>
                  <strong>Test Deterministic Grading &amp; Weakness Radar:</strong>{" "}
                  Open <strong>Mock Tests</strong>, toggle between{" "}
                  <strong>বাংলা (BN)</strong> and <strong>English (EN)</strong>, take a
                  test, and submit. Then open <strong>Weakness &amp; Tutor</strong> to
                  generate a cached AI Study Note.
                </li>
                <li>
                  <strong>Test RBAC &amp; Multi-Role Management:</strong> Open{" "}
                  <strong>Admin Console -&gt; Users &amp; RBAC</strong> to change any
                  user&apos;s Role (<code className="text-emerald-300">aspirant</code>,{" "}
                  <code className="text-emerald-300">educator</code>,{" "}
                  <code className="text-emerald-300">admin</code>) or Subscription Tier.
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
                      "cp .env.example .env && docker compose up -d && npm install && npm run dev"
                    )
                  }
                  className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded text-slate-200 cursor-pointer"
                >
                  {copiedId === "local-cmd" ? "Copied!" : "Copy Commands"}
                </button>
              </div>
              <pre className="text-xs font-mono bg-slate-950 p-4 rounded-lg border border-slate-800 text-emerald-300 overflow-x-auto leading-relaxed">
{`# 1. Start 512MB-capped Postgres (pgvector) + Redis
cp .env.example .env
docker compose up -d

# 2. Run Full-Stack Web + Express AI Gateway (Port 3000)
npm install
npm run dev

# 3. Run Fastify Core API (Port 8080) & FastAPI AI Service (Port 8081)
npm run dev:api-core
npm run dev:api-ai

# 4. Test Mobile on Vivo X200 FE over Wi-Fi (No Android Emulator!)
npx expo start --lan`}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
