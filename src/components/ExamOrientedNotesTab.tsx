import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Crown,
  Eye,
  Image as ImageIcon,
  Layers,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserCheck,
  XCircle,
} from "lucide-react";
import type { BilingualText, OptionKey, UserDto } from "../../packages/shared-types/src/index";
import { api } from "../api";
import type { SupportedLang } from "./types";

interface RevisionVisualCard {
  id: string;
  titleEn: string;
  titleBn: string;
  subtitleEn: string;
  subtitleBn: string;
  badgeText: string;
  keyFactsEn: string[];
  keyFactsBn: string[];
  svgMarkup: string;
  imageUrl?: string | null;
}

interface RevisionTopicSummary {
  id: string;
  examSlug: string;
  subjectEn: string;
  subjectBn: string;
  topicSlug: string;
  titleEn: string;
  titleBn: string;
  summaryEn: string;
  summaryBn: string;
  visualCount: number;
  previewVisual: RevisionVisualCard | null;
  totalSets: number;
  totalQuestions: number;
  userGeneratedSetsCount: number;
  remainingGenerations: number;
  totalAttempts: number;
  createdAt: string;
}

interface TopicQuestionItem {
  id: string;
  position: number;
  stem: BilingualText;
  options: Record<OptionKey, BilingualText>;
  correctOption: OptionKey;
  explanation: BilingualText;
  difficulty: string;
  examTag: string;
}

interface TopicQuestionSet {
  id: string;
  setNumber: number;
  setLabel: string;
  generatedByUserId: string | null;
  generatedByName: string;
  generatedByRole: "admin" | "aspirant" | string;
  questionCount: number;
  createdAt: string;
  questions: TopicQuestionItem[];
}

interface TopicAttemptItem {
  id: string;
  setId: string;
  userId: string;
  userName: string;
  totalQuestions: number;
  attemptedCount: number;
  correctCount: number;
  incorrectCount: number;
  netScore: number;
  maxScore: number;
  accuracyPercentage: number;
  timeSpentSeconds: number;
  createdAt: string;
}

interface RevisionTopicDetailResponse {
  topic: {
    id: string;
    examSlug: string;
    subjectEn: string;
    subjectBn: string;
    topicSlug: string;
    titleEn: string;
    titleBn: string;
    summaryEn: string;
    summaryBn: string;
    contentMarkdownEn: string;
    contentMarkdownBn: string;
    examTrapsEn: string[];
    examTrapsBn: string[];
    visuals: RevisionVisualCard[];
    createdAt: string;
  };
  userGeneratedSetsCount: number;
  remainingGenerations: number;
  questionSets: TopicQuestionSet[];
  attempts: TopicAttemptItem[];
}

interface ExamOrientedNotesTabProps {
  user: UserDto;
  lang: SupportedLang;
  onOpenSubscriptionModal: () => void;
  onNotify: (type: "success" | "error" | "info", text: string) => void;
}

/** Simple Markdown table & bullet renderer for exam-focused notes */
function FormattedMarkdown({ markdown, isBengali }: { markdown: string; isBengali: boolean }) {
  const lines = markdown.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    if (line === "---") {
      blocks.push(<hr key={`hr-${i}`} className="border-slate-800 my-4" />);
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push(
        <h4
          key={`h3-${i}`}
          className={`text-base font-bold text-amber-300 mt-4 mb-2 ${isBengali ? "font-bengali" : ""}`}
        >
          {line.replace(/^###\s+/, "")}
        </h4>
      );
      i++;
      continue;
    }

    if (line.startsWith("## ") || line.startsWith("# ")) {
      blocks.push(
        <h3
          key={`h2-${i}`}
          className={`text-lg font-bold text-white mt-4 mb-2 ${isBengali ? "font-bengali" : ""}`}
        >
          {line.replace(/^#+\s+/, "")}
        </h3>
      );
      i++;
      continue;
    }

    // Markdown table block
    if (line.startsWith("|") && i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const parseCells = (row: string) =>
        row
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());

      const headers = parseCells(tableLines[0]);
      const dataRows = tableLines
        .slice(1)
        .filter((r) => !/^[\s|:-]+$/.test(r))
        .map(parseCells);

      blocks.push(
        <div
          key={`tbl-${i}`}
          className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80 my-3"
        >
          <table className={`w-full text-left text-xs ${isBengali ? "font-bengali" : ""}`}>
            <thead className="bg-slate-900/90 text-amber-300 uppercase border-b border-slate-800">
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="px-3.5 py-2.5 font-bold">
                    {h.replace(/\*\*/g, "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-200">
              {dataRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-900/40 align-top">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2.5 leading-relaxed">
                      {cell.split(/<br\s*\/?>/i).map((subLine, sIdx) => (
                        <div key={sIdx} className={sIdx > 0 ? "mt-1" : ""}>
                          {renderInlineFormatting(subLine)}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Bullet list
    if (line.startsWith("* ") || line.startsWith("- ")) {
      const items: string[] = [];
      while (
        i < lines.length &&
        (lines[i].trim().startsWith("* ") || lines[i].trim().startsWith("- "))
      ) {
        items.push(lines[i].trim().replace(/^([*-])\s+/, ""));
        i++;
      }
      blocks.push(
        <ul
          key={`ul-${i}`}
          className={`space-y-1.5 list-disc list-inside text-xs text-slate-200 my-2 ${
            isBengali ? "font-bengali" : ""
          }`}
        >
          {items.map((it, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInlineFormatting(it)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    blocks.push(
      <p
        key={`p-${i}`}
        className={`text-xs text-slate-200 leading-relaxed my-1.5 ${isBengali ? "font-bengali" : ""}`}
      >
        {renderInlineFormatting(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-2">{blocks}</div>;
}

function renderInlineFormatting(text: string): React.ReactNode {
  const cleaned = text
    .replace(/\$\\leftrightarrow\$/g, "⟷")
    .replace(/\$\\longrightarrow\$/g, "⟶")
    .replace(/\$\\rightarrow\$/g, "→")
    .replace(/\$V_3\$/g, "V3");
  const parts = cleaned.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={idx} className="font-bold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={idx} className="italic text-sky-300">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

export default function ExamOrientedNotesTab({
  user,
  lang,
  onOpenSubscriptionModal,
  onNotify,
}: ExamOrientedNotesTabProps) {
  const isAdmin = user.role === "admin";
  const isPremium = isAdmin || user.subscriptionTier !== "free";

  const [topics, setTopics] = useState<RevisionTopicSummary[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RevisionTopicDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  // Admin Create New Topic Form State
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [newExamSlug, setNewExamSlug] = useState<string>("wbcs-prelims");
  const [newSubjectEn, setNewSubjectEn] = useState<string>("");
  const [newTopicTitleEn, setNewTopicTitleEn] = useState<string>("");
  const [newCustomFocus, setNewCustomFocus] = useState<string>("");
  const [newCustomImageUrl, setNewCustomImageUrl] = useState<string>("");
  const [creatingTopic, setCreatingTopic] = useState<boolean>(false);

  // Question Set & Test Runner State
  const [activeSetId, setActiveSetId] = useState<string>("");
  const [generatingNewSet, setGeneratingNewSet] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"notes" | "practice-test" | "admin-inspect">("notes");
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, OptionKey>>({});
  const [testStartedAt, setTestStartedAt] = useState<number>(Date.now());
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [submittingTest, setSubmittingTest] = useState<boolean>(false);
  const [submittedResult, setSubmittedResult] = useState<{
    totalQuestions: number;
    attemptedCount: number;
    correctCount: number;
    incorrectCount: number;
    netScore: number;
    maxScore: number;
    accuracyPercentage: number;
    timeSpentSeconds: number;
  } | null>(null);

  const loadTopics = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api<{
        isPremium: boolean;
        topics: RevisionTopicSummary[];
      }>("/revision-notes");
      setTopics(res.topics);
      if (res.topics.length > 0 && !selectedTopicId && (isAdmin || user.subscriptionTier !== "free")) {
        setSelectedTopicId(res.topics[0].id);
      }
    } catch (err) {
      onNotify("error", (err as Error).message || "Failed to load exam-oriented revision topics.");
    } finally {
      setLoadingList(false);
    }
  }, [selectedTopicId, isAdmin, user.subscriptionTier, onNotify]);

  const loadTopicDetail = useCallback(
    async (topicId: string) => {
      if (!isPremium) return;
      setLoadingDetail(true);
      try {
        const res = await api<RevisionTopicDetailResponse>(`/revision-notes/${topicId}`);
        setDetail(res);
        if (res.questionSets.length > 0) {
          setActiveSetId((prev) =>
            res.questionSets.some((s) => s.id === prev) ? prev : res.questionSets[0].id
          );
        }
      } catch (err) {
        onNotify("error", (err as Error).message || "Failed to load topic details.");
      } finally {
        setLoadingDetail(false);
      }
    },
    [isPremium, onNotify]
  );

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  useEffect(() => {
    if (selectedTopicId && isPremium) {
      void loadTopicDetail(selectedTopicId);
    }
  }, [selectedTopicId, isPremium, loadTopicDetail]);

  // Live timer when taking the 30-MCQ Topic Practice Test
  useEffect(() => {
    if (viewMode !== "practice-test" || submittedResult) return;
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - testStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [viewMode, submittedResult, testStartedAt]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onNotify("error", "Topic image must be under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setNewCustomImageUrl(String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  };

  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectEn.trim() || !newTopicTitleEn.trim()) {
      onNotify("error", "Please enter both Subject and Topic Title.");
      return;
    }
    setCreatingTopic(true);
    try {
      const res = await api<{ topicId: string; questionCount: number }>("/revision-notes", {
        method: "POST",
        body: JSON.stringify({
          examSlug: newExamSlug,
          subjectEn: newSubjectEn.trim(),
          topicTitleEn: newTopicTitleEn.trim(),
          customFocus: newCustomFocus.trim() || undefined,
          customImageUrl: newCustomImageUrl || undefined,
        }),
      });
      onNotify(
        "success",
        `Created Exam-Oriented Topic Note "${newTopicTitleEn}" with visuals and ${res.questionCount} bilingual MCQs!`
      );
      setShowCreateForm(false);
      setNewSubjectEn("");
      setNewTopicTitleEn("");
      setNewCustomFocus("");
      setNewCustomImageUrl("");
      await loadTopics();
      setSelectedTopicId(res.topicId);
    } catch (err) {
      onNotify("error", (err as Error).message || "Failed to generate topic note.");
    } finally {
      setCreatingTopic(false);
    }
  };

  const handleDeleteTopic = async (topicId: string, title: string) => {
    try {
      await api(`/revision-notes/${topicId}`, { method: "DELETE" });
      onNotify("info", `Deleted topic "${title}".`);
      if (selectedTopicId === topicId) {
        setSelectedTopicId(null);
        setDetail(null);
      }
      await loadTopics();
    } catch (err) {
      onNotify("error", (err as Error).message || "Failed to delete topic.");
    }
  };

  const handleGenerateNewQuestionSet = async () => {
    if (!detail) return;
    setGeneratingNewSet(true);
    try {
      const res = await api<{
        setId: string;
        questionCount: number;
        remainingGenerations: number;
      }>(`/revision-notes/${detail.topic.id}/generate-questions`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      onNotify(
        "success",
        `Generated a brand-new set of ${res.questionCount} questions! (${res.remainingGenerations} generation(s) remaining for this topic).`
      );
      await loadTopicDetail(detail.topic.id);
      await loadTopics();
      setActiveSetId(res.setId);
      setSelectedAnswers({});
      setSubmittedResult(null);
      setTestStartedAt(Date.now());
      setElapsedSec(0);
      setViewMode("practice-test");
    } catch (err) {
      onNotify("error", (err as Error).message || "Failed to generate new 30-question set.");
    } finally {
      setGeneratingNewSet(false);
    }
  };

  const startTopicTest = (setId: string) => {
    setActiveSetId(setId);
    setSelectedAnswers({});
    setSubmittedResult(null);
    setTestStartedAt(Date.now());
    setElapsedSec(0);
    setViewMode("practice-test");
  };

  const handleSubmitTopicTest = async () => {
    if (!detail || !activeSetId) return;
    setSubmittingTest(true);
    try {
      const res = await api<{
        attemptId: string;
        totalQuestions: number;
        attemptedCount: number;
        correctCount: number;
        incorrectCount: number;
        netScore: number;
        maxScore: number;
        accuracyPercentage: number;
        timeSpentSeconds: number;
      }>(`/revision-notes/${detail.topic.id}/submit-test`, {
        method: "POST",
        body: JSON.stringify({
          setId: activeSetId,
          answers: selectedAnswers,
          timeSpentSeconds: elapsedSec,
        }),
      });
      setSubmittedResult(res);
      onNotify(
        "success",
        `Topic Practice Test submitted! Score: ${res.netScore} / ${res.maxScore} (${res.accuracyPercentage}% accuracy).`
      );
      await loadTopicDetail(detail.topic.id);
      await loadTopics();
    } catch (err) {
      onNotify("error", (err as Error).message || "Failed to submit topic test.");
    } finally {
      setSubmittingTest(false);
    }
  };

  const activeSet = detail?.questionSets.find((s) => s.id === activeSetId) ?? detail?.questionSets[0] ?? null;

  return (
    <section className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300 text-xs font-semibold">
            <Crown className="w-3.5 h-3.5" />
            {lang === "bn"
              ? "প্রিমিয়াম পরীক্ষামুখী শর্ট নোটস ও ৩০-প্রশ্নের টপিক টেস্ট"
              : "Premium Exam-Oriented Quick Revision Notes & 30-MCQ Topic Tests"}
          </div>
          <h2 className="text-xl font-bold text-white">
            {lang === "bn"
              ? "পরীক্ষামুখী কুইক রিভিশন নোটস, ভিজ্যুয়াল ডায়াগ্রাম ও টপিক প্র্যাকটিস"
              : "Exam-Oriented Quick Revision Notes, Visual Diagrams & 30-MCQ Topic Practice"}
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {lang === "bn"
              ? "অ্যাডমিন দ্বারা তৈরি শুধুমাত্র পরীক্ষায় আসার মতো বাছাই করা টপিক নোটস (যেমন: ভারতের ভাইসরয়গণ, Sentence Transformation), ভিজ্যুয়াল চার্ট এবং ৩০টি MCQ প্র্যাকটিস সেট। প্রিমিয়াম পরীক্ষার্থীরা প্রতিটি টপিকের ওপর সর্বোচ্চ ২ বার নতুন ৩০টি প্রশ্নের সেট তৈরি করে আলাদা পরীক্ষা দিতে পারবেন।"
              : "Curated by Admin with strictly exam-asked facts, visual portrait/concept cards (e.g., Viceroys of India, Sentence Transformations), and 30 practice MCQs per topic. Premium Aspirants can also generate a new set of 30 questions up to 2 times per topic and take a dedicated topic test."}
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            {showCreateForm ? "Close Topic Creator" : "+ Create Exam-Oriented Topic Note (Admin)"}
          </button>
        )}
      </div>

      {/* Admin Create Topic Form */}
      {isAdmin && showCreateForm && (
        <form
          onSubmit={handleCreateTopic}
          className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Create Exam-Oriented Quick Revision Topic Note + Visuals + 30 Practice MCQs
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Enter any Subject and Topic (e.g., <strong>History → Viceroys of India</strong> or{" "}
                <strong>General English → Sentence Transformations</strong>). AI generates bilingual
                exam-only short notes, visual infographic diagrams, and the initial 30 practice
                questions.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="text-xs text-slate-300 space-y-1">
              <span>Target Exam Category</span>
              <select
                value={newExamSlug}
                onChange={(e) => setNewExamSlug(e.target.value)}
                disabled={creatingTopic}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
              >
                <option value="wbcs-prelims">WBCS Preliminary Examination</option>
                <option value="wbpsc-clerkship">WBPSC Clerkship Examination</option>
                <option value="wbpsc-food-si">WBPSC Food &amp; Supplies SI</option>
                <option value="wbpsc-miscellaneous">WBPSC Miscellaneous Services</option>
              </select>
            </label>

            <label className="text-xs text-slate-300 space-y-1">
              <span>Subject Name *</span>
              <input
                type="text"
                required
                value={newSubjectEn}
                onChange={(e) => setNewSubjectEn(e.target.value)}
                disabled={creatingTopic}
                placeholder="e.g. Indian History or General English"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
              />
            </label>

            <label className="text-xs text-slate-300 space-y-1">
              <span>Topic Title *</span>
              <input
                type="text"
                required
                value={newTopicTitleEn}
                onChange={(e) => setNewTopicTitleEn(e.target.value)}
                disabled={creatingTopic}
                placeholder="e.g. Governor-Generals & Viceroys / Active & Passive Voice"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs text-slate-300 space-y-1">
              <span>Exam Focus Instructions (Optional)</span>
              <input
                type="text"
                value={newCustomFocus}
                onChange={(e) => setNewCustomFocus(e.target.value)}
                disabled={creatingTopic}
                placeholder="e.g. Focus only on high-frequency PYQ facts, dates, acts, and rule exceptions"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
              />
            </label>

            <label className="text-xs text-slate-300 space-y-1">
              <span>Optional Custom Topic Image (Portrait / Diagram — AI also generates SVG visuals)</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 px-3 py-2 text-xs bg-slate-950 border border-slate-800 hover:border-amber-400/50 rounded-lg text-slate-300 cursor-pointer">
                  <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                  <span>{newCustomImageUrl ? "Custom Image Attached ✓" : "Upload Image (.png/.jpg)"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    disabled={creatingTopic}
                    className="hidden"
                  />
                </label>
                {newCustomImageUrl && (
                  <button
                    type="button"
                    onClick={() => setNewCustomImageUrl("")}
                    className="text-xs text-rose-400 hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
            </label>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={creatingTopic}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 rounded-xl cursor-pointer"
            >
              <Sparkles className={`w-4 h-4 ${creatingTopic ? "animate-spin" : ""}`} />
              {creatingTopic
                ? "Generating Bilingual Notes, Visual Diagrams & 30 MCQs… (20–40s)"
                : "Generate Topic Note + Visuals + 30 Practice MCQs"}
            </button>
          </div>
        </form>
      )}

      {/* Free Aspirant Gatekeeper Banner */}
      {!isPremium && (
        <div className="bg-gradient-to-r from-amber-500/15 via-slate-900 to-slate-900 border border-amber-500/40 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 max-w-2xl">
            <div className="p-3 rounded-xl bg-amber-400/20 text-amber-300 shrink-0">
              <Lock className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">
                {lang === "bn"
                  ? "প্রিমিয়াম পরীক্ষার্থীদের জন্য সংরক্ষিত ফিচার"
                  : "Exclusive Feature for Premium Aspirants"}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {lang === "bn"
                  ? "এই পরীক্ষামুখী শর্ট নোটস, ভিজ্যুয়াল ডায়াগ্রাম এবং ৩০টি প্রশ্নের অন-ডিমান্ড AI প্র্যাকটিস টেস্টে AI খরচ যুক্ত থাকায় এটি শুধুমাত্র প্রিমিয়াম প্ল্যানের স্টুডেন্টদের জন্য উন্মুক্ত। নিচের যেকোনো প্রিমিয়াম প্ল্যানে আপগ্রেড করে আনলক করুন।"
                  : "Because Exam-Oriented Visual Notes and on-demand 30-MCQ AI Topic Generation incur live AI compute costs, this module is reserved for Premium Aspirants. Upgrade your plan to unlock all topic notes and generate up to 2 custom 30-question sets per topic."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSubscriptionModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl transition-colors cursor-pointer shrink-0"
          >
            <Crown className="w-4 h-4" />
            {lang === "bn" ? "প্রিমিয়াম প্ল্যানে আপগ্রেড করুন" : "Upgrade to Premium Plan"}
          </button>
        </div>
      )}

      {/* Main Layout: Topic Cards Sidebar + Active Topic Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Topic List */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 max-h-[780px] overflow-y-auto">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {lang === "bn"
                ? `পরীক্ষামুখী টপিক তালিকা (${topics.length})`
                : `Exam-Oriented Topics (${topics.length})`}
            </h3>
            <button
              type="button"
              onClick={() => void loadTopics()}
              className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${loadingList ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {topics.map((t) => {
            const isSelected = t.id === selectedTopicId;
            return (
              <div
                key={t.id}
                onClick={() => {
                  if (!isPremium) {
                    onOpenSubscriptionModal();
                    return;
                  }
                  setSelectedTopicId(t.id);
                  setViewMode("notes");
                  setSubmittedResult(null);
                }}
                className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2 ${
                  isSelected
                    ? "bg-amber-400/10 border-amber-400 text-white shadow-md"
                    : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[10px] font-semibold">
                    {lang === "bn" ? t.subjectBn : t.subjectEn}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {!isPremium && <Lock className="w-3.5 h-3.5 text-amber-400" />}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteTopic(t.id, t.titleEn);
                        }}
                        className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                        title="Delete Topic"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <h4 className={`text-sm font-bold text-white ${lang === "bn" ? "font-bengali" : ""}`}>
                  {lang === "bn" ? t.titleBn : t.titleEn}
                </h4>

                <p className={`text-xs text-slate-400 line-clamp-2 ${lang === "bn" ? "font-bengali" : ""}`}>
                  {lang === "bn" ? t.summaryBn : t.summaryEn}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                  <span className="font-mono text-emerald-300 font-semibold">
                    {t.totalQuestions} MCQs ({t.totalSets} Set{t.totalSets > 1 ? "s" : ""})
                  </span>
                  <span>
                    {isAdmin
                      ? `${t.totalAttempts} Student Attempts`
                      : `AI Sets Left: ${t.remainingGenerations}/2`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Active Topic Workspace */}
        <div className="lg:col-span-8 space-y-5">
          {!isPremium ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
              <Lock className="w-10 h-10 text-amber-400 mx-auto" />
              <h3 className="text-lg font-bold text-white">
                Unlock Exam-Oriented Visual Notes &amp; 30-Question Topic Tests
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Select any Premium Plan to access all Admin-curated Quick Revision Topics (including{" "}
                <strong>Viceroys of India</strong> and <strong>Sentence Transformations</strong>),
                visual diagrams, and generate up to 2 custom 30-MCQ practice sets per topic.
              </p>
              <button
                type="button"
                onClick={onOpenSubscriptionModal}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl cursor-pointer"
              >
                <Crown className="w-4 h-4" /> View Subscription Plans
              </button>
            </div>
          ) : loadingDetail || !detail ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
              {loadingDetail ? "Loading topic notes, visuals & 30-MCQ sets…" : "Select a topic from the left to begin."}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
              {/* Topic Header & Sub-Navigation */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-sky-500/15 text-sky-300 text-xs font-semibold">
                      {lang === "bn" ? detail.topic.subjectBn : detail.topic.subjectEn}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 text-xs font-mono font-semibold">
                      {detail.questionSets.length} Question Set(s) ·{" "}
                      {detail.questionSets.reduce((acc, s) => acc + s.questions.length, 0)} Total MCQs
                    </span>
                  </div>
                  <h3 className={`text-xl font-bold text-white ${lang === "bn" ? "font-bengali" : ""}`}>
                    {lang === "bn" ? detail.topic.titleBn : detail.topic.titleEn}
                  </h3>
                </div>

                {/* Mode Switcher: Quick Notes & Visuals | Take 30-MCQ Test | Admin Question Inspector */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode("notes")}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                      viewMode === "notes"
                        ? "bg-amber-400 text-slate-950"
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    Quick Notes &amp; Visuals
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (activeSet) startTopicTest(activeSet.id);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                      viewMode === "practice-test"
                        ? "bg-emerald-400 text-slate-950"
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                  >
                    <Play className="w-3.5 h-3.5" />
                    Take 30-MCQ Topic Test
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setViewMode("admin-inspect")}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                        viewMode === "admin-inspect"
                          ? "bg-violet-500 text-white"
                          : "bg-slate-800 text-slate-300 hover:text-white"
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Admin: View All Sets ({detail.questionSets.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Question Set Bar + "Generate New Set of 30 Questions (Max 2 Times)" */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs font-semibold text-slate-300">Active 30-MCQ Set:</label>
                  <select
                    value={activeSet?.id ?? ""}
                    onChange={(e) => {
                      setActiveSetId(e.target.value);
                      setSelectedAnswers({});
                      setSubmittedResult(null);
                    }}
                    className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                  >
                    {detail.questionSets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.setLabel} ({s.questions.length} Qs ·{" "}
                        {s.generatedByRole === "admin" ? "Official Admin" : `By ${s.generatedByName}`})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {!isAdmin && (
                    <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-amber-300">
                      Custom AI Sets Left: <strong>{detail.remainingGenerations} / 2</strong>
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={generatingNewSet || (!isAdmin && detail.remainingGenerations <= 0)}
                    onClick={handleGenerateNewQuestionSet}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-violet-500 hover:bg-violet-400 disabled:opacity-45 text-white transition-colors cursor-pointer"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${generatingNewSet ? "animate-spin" : ""}`} />
                    {generatingNewSet
                      ? "Generating 30 Fresh Questions… (15–30s)"
                      : !isAdmin && detail.remainingGenerations <= 0
                        ? "Max 2 Custom Sets Generated"
                        : "Generate New 30-Question Set (AI)"}
                  </button>
                </div>
              </div>

              {/* VIEW 1: Quick Revision Notes & Visual Infographics */}
              {viewMode === "notes" && (
                <div className="space-y-6">
                  {/* Visual Cards / Portraits / Diagrams */}
                  {detail.topic.visuals.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" />
                        {lang === "bn"
                          ? "ভিজ্যুয়াল ডায়াগ্রাম ও ফ্ল্যাশকার্ড"
                          : "Visual Concept Diagrams & Portrait Cards"}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {detail.topic.visuals.map((vc) => (
                          <div
                            key={vc.id}
                            className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col justify-between"
                          >
                            <div className="p-4 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="px-2 py-0.5 rounded bg-amber-400/15 text-amber-300 text-[10px] font-bold uppercase">
                                  {vc.badgeText}
                                </span>
                              </div>
                              <h5
                                className={`text-sm font-bold text-white ${
                                  lang === "bn" ? "font-bengali" : ""
                                }`}
                              >
                                {lang === "bn" ? vc.titleBn : vc.titleEn}
                              </h5>
                              <p
                                className={`text-xs text-slate-400 ${
                                  lang === "bn" ? "font-bengali" : ""
                                }`}
                              >
                                {lang === "bn" ? vc.subtitleBn : vc.subtitleEn}
                              </p>

                              {vc.imageUrl && (
                                <img
                                  src={vc.imageUrl}
                                  alt={vc.titleEn}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-44 object-cover rounded-lg border border-slate-800 my-2"
                                />
                              )}

                              {vc.svgMarkup && (
                                <div
                                  className="w-full rounded-lg overflow-hidden border border-slate-800/90 my-2"
                                  dangerouslySetInnerHTML={{ __html: vc.svgMarkup }}
                                />
                              )}

                              <ul
                                className={`space-y-1 text-xs text-slate-300 pt-1 ${
                                  lang === "bn" ? "font-bengali" : ""
                                }`}
                              >
                                {(lang === "bn" ? vc.keyFactsBn : vc.keyFactsEn).map((fact, idx) => (
                                  <li key={idx} className="flex items-start gap-1.5">
                                    <span className="text-emerald-400 font-bold">•</span>
                                    <span>{fact}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Exam Trap Alerts */}
                  {(lang === "bn" ? detail.topic.examTrapsBn : detail.topic.examTrapsEn).length >
                    0 && (
                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        {lang === "bn"
                          ? "ডব্লিউবিপিএসসি পরীক্ষার সাধারণ ভুল ও সতর্কতা (Exam Traps)"
                          : "High-Frequency WBPSC Exam Traps & Confusions"}
                      </h4>
                      <ul
                        className={`space-y-1.5 text-xs text-amber-100 ${
                          lang === "bn" ? "font-bengali" : ""
                        }`}
                      >
                        {(lang === "bn" ? detail.topic.examTrapsBn : detail.topic.examTrapsEn).map(
                          (trap, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="font-bold text-amber-400">#{idx + 1}</span>
                              <span>{trap}</span>
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Exam-Focused Quick Revision Markdown */}
                  <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <FormattedMarkdown
                      markdown={
                        lang === "bn"
                          ? detail.topic.contentMarkdownBn
                          : detail.topic.contentMarkdownEn
                      }
                      isBengali={lang === "bn"}
                    />
                  </div>

                  {/* Call to Action to Start the 30-MCQ Test */}
                  {activeSet && (
                    <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h4 className="text-sm font-bold text-white">
                          Ready to test yourself on {detail.topic.titleEn}?
                        </h4>
                        <p className="text-xs text-slate-300 mt-0.5">
                          Active Set: <strong>{activeSet.setLabel}</strong> ({activeSet.questions.length}{" "}
                          MCQs · +1 mark for correct, -0.25 for wrong).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => startTopicTest(activeSet.id)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold bg-emerald-400 hover:bg-emerald-300 text-slate-950 rounded-xl cursor-pointer"
                      >
                        <Play className="w-4 h-4" /> Start {activeSet.questions.length}-MCQ Topic Test
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* VIEW 2: Interactive 30-MCQ Topic Practice Test */}
              {viewMode === "practice-test" && activeSet && (
                <div className="space-y-5">
                  {/* Sticky Test Status Bar */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold text-emerald-300 uppercase">
                        Topic Practice Test · {activeSet.setLabel}
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Answered:{" "}
                        <strong className="text-white">
                          {Object.keys(selectedAnswers).length} / {activeSet.questions.length}
                        </strong>{" "}
                        · Marking: <span className="text-emerald-400">+1.00</span> /{" "}
                        <span className="text-rose-400">-0.25</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-sky-300">
                        <Clock className="w-3.5 h-3.5" />
                        {Math.floor(elapsedSec / 60)}m {elapsedSec % 60}s
                      </span>
                      {!submittedResult ? (
                        <button
                          type="button"
                          disabled={submittingTest}
                          onClick={handleSubmitTopicTest}
                          className="px-4 py-2 text-xs font-bold bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-slate-950 rounded-xl cursor-pointer"
                        >
                          {submittingTest ? "Grading Test…" : "Submit Topic Test"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startTopicTest(activeSet.id)}
                          className="px-4 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl cursor-pointer"
                        >
                          Re-Attempt This Set
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Submitted Score Banner */}
                  {submittedResult && (
                    <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/40 grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div>
                        <span className="text-[11px] uppercase text-slate-400">Net Score</span>
                        <p className="text-xl font-mono font-extrabold text-emerald-300">
                          {submittedResult.netScore} / {submittedResult.maxScore}
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] uppercase text-slate-400">Correct / Wrong</span>
                        <p className="text-xl font-mono font-extrabold text-white">
                          <span className="text-emerald-400">{submittedResult.correctCount}✓</span>{" "}
                          / <span className="text-rose-400">{submittedResult.incorrectCount}✗</span>
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] uppercase text-slate-400">Accuracy</span>
                        <p className="text-xl font-mono font-extrabold text-amber-300">
                          {submittedResult.accuracyPercentage}%
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] uppercase text-slate-400">Attempted</span>
                        <p className="text-xl font-mono font-extrabold text-sky-300">
                          {submittedResult.attemptedCount} / {submittedResult.totalQuestions}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Questions List */}
                  <div className="space-y-4 max-h-[650px] overflow-y-auto pr-1">
                    {activeSet.questions.map((q) => {
                      const picked = selectedAnswers[q.id];
                      return (
                        <div
                          key={q.id}
                          className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono font-bold text-amber-300">
                              Question #{q.position}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 text-[10px] uppercase">
                                {q.difficulty}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[10px]">
                                {q.examTag}
                              </span>
                            </div>
                          </div>

                          <p
                            className={`text-sm font-medium text-white ${
                              lang === "bn" ? "font-bengali" : ""
                            }`}
                          >
                            {lang === "bn" ? q.stem.bn : q.stem.en}
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {(["A", "B", "C", "D"] as const).map((optKey) => {
                              const isSelected = picked === optKey;
                              const isCorrect = q.correctOption === optKey;
                              let cls =
                                "border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-700";
                              if (submittedResult) {
                                if (isCorrect) {
                                  cls =
                                    "border-emerald-400 bg-emerald-500/15 text-emerald-200 font-semibold";
                                } else if (isSelected && !isCorrect) {
                                  cls = "border-rose-400 bg-rose-500/15 text-rose-200";
                                }
                              } else if (isSelected) {
                                cls = "border-amber-400 bg-amber-400/15 text-white font-semibold";
                              }

                              return (
                                <button
                                  key={optKey}
                                  type="button"
                                  disabled={Boolean(submittedResult)}
                                  onClick={() =>
                                    setSelectedAnswers((prev) => ({
                                      ...prev,
                                      [q.id]: optKey,
                                    }))
                                  }
                                  className={`text-left px-3.5 py-2.5 rounded-xl border text-xs flex items-start gap-2.5 transition-colors cursor-pointer ${cls} ${
                                    lang === "bn" ? "font-bengali" : ""
                                  }`}
                                >
                                  <span className="font-mono font-bold text-amber-300 shrink-0">
                                    {optKey}.
                                  </span>
                                  <span>{lang === "bn" ? q.options[optKey].bn : q.options[optKey].en}</span>
                                </button>
                              );
                            })}
                          </div>

                          {submittedResult && (
                            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-1">
                              <div className="flex items-center gap-2 font-semibold">
                                {picked === q.correctOption ? (
                                  <span className="text-emerald-400 flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Correct (+1.00)
                                  </span>
                                ) : picked ? (
                                  <span className="text-rose-400 flex items-center gap-1">
                                    <XCircle className="w-3.5 h-3.5" /> Incorrect (-0.25) · Correct
                                    Answer: {q.correctOption}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">
                                    Unattempted · Correct Answer: {q.correctOption}
                                  </span>
                                )}
                              </div>
                              <p
                                className={`text-slate-300 ${lang === "bn" ? "font-bengali" : ""}`}
                              >
                                {lang === "bn" ? q.explanation.bn : q.explanation.en}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* VIEW 3: Admin Question Set Inspector (Both Admin-Generated and Aspirant-Generated Sets) */}
              {isAdmin && viewMode === "admin-inspect" && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/30">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4" />
                      Admin Inspector — Official &amp; Aspirant-Generated Question Sets (
                      {detail.questionSets.length})
                    </h4>
                    <p className="text-xs text-slate-300 mt-1">
                      Inspect both the initial Admin-generated 30-question set and every custom
                      30-question set generated by Premium Aspirants on this topic.
                    </p>
                  </div>

                  {detail.questionSets.map((set) => (
                    <div
                      key={set.id}
                      className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                        <div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase mr-2 ${
                              set.generatedByRole === "admin"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-amber-400/20 text-amber-300"
                            }`}
                          >
                            {set.generatedByRole === "admin"
                              ? "Official Admin Set"
                              : `Aspirant Generated (${set.generatedByName})`}
                          </span>
                          <strong className="text-xs text-white">{set.setLabel}</strong>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {new Date(set.createdAt).toLocaleString()} · {set.questions.length} Qs
                        </span>
                      </div>

                      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                        {set.questions.map((q) => (
                          <div
                            key={q.id}
                            className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 text-xs space-y-1"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold text-white">
                                Q{q.position}. {q.stem.en}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono font-bold shrink-0">
                                Ans: {q.correctOption}
                              </span>
                            </div>
                            <p className="text-slate-400 font-bengali">{q.stem.bn}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Topic Test Attempts History Table */}
              {detail.attempts.length > 0 && (
                <div className="pt-4 border-t border-slate-800 space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-amber-400" />
                    {isAdmin
                      ? `All Student Attempts on This Topic (${detail.attempts.length})`
                      : `Your Past Attempts on This Topic (${detail.attempts.length})`}
                  </h4>
                  <div className="overflow-x-auto max-h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 uppercase sticky top-0">
                        <tr>
                          <th className="px-3 py-2">Aspirant</th>
                          <th className="px-3 py-2">Question Set</th>
                          <th className="px-3 py-2">Net Score</th>
                          <th className="px-3 py-2">Correct / Wrong</th>
                          <th className="px-3 py-2">Accuracy</th>
                          <th className="px-3 py-2">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-slate-200">
                        {detail.attempts.map((a) => {
                          const setObj = detail.questionSets.find((s) => s.id === a.setId);
                          return (
                            <tr key={a.id} className="hover:bg-slate-900/50">
                              <td className="px-3 py-2 font-medium text-white">{a.userName}</td>
                              <td className="px-3 py-2 text-slate-300">
                                {setObj ? setObj.setLabel : "30-MCQ Topic Set"}
                              </td>
                              <td className="px-3 py-2 font-mono font-bold text-emerald-300">
                                {a.netScore} / {a.maxScore}
                              </td>
                              <td className="px-3 py-2 font-mono">
                                <span className="text-emerald-400">{a.correctCount}✓</span> /{" "}
                                <span className="text-rose-400">{a.incorrectCount}✗</span>
                              </td>
                              <td className="px-3 py-2 font-mono text-amber-300">
                                {a.accuracyPercentage}%
                              </td>
                              <td className="px-3 py-2 text-slate-400">
                                {new Date(a.createdAt).toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
