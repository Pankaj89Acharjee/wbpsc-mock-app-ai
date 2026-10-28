import React, { useState } from "react";
import { api } from "../api";
import type { DescriptiveEvaluation, SupportedLang } from "./types";

interface DescriptiveEvaluatorTabProps {
  lang: SupportedLang;
  onError: (err: unknown, fallback: string) => void;
}

export default function DescriptiveEvaluatorTab({
  lang,
  onError,
}: DescriptiveEvaluatorTabProps) {
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
      onError(err, "Descriptive evaluation error.");
    } finally {
      setDescEvalBusy(false);
    }
  };

  return (
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
              onChange={(e) =>
                setDescExamSlug(
                  e.target.value as "wbpsc-clerkship-part2" | "wbcs-mains"
                )
              }
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
            >
              <option value="wbpsc-clerkship-part2">Clerkship Part-II</option>
              <option value="wbcs-mains">WBCS Mains Paper I/II</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Task Type
            </label>
            <select
              value={descTaskType}
              onChange={(e) =>
                setDescTaskType(
                  e.target.value as
                    | "report_writing"
                    | "precis_writing"
                    | "translation"
                )
              }
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
            >
              <option value="report_writing">Report Writing (প্রতিবেদন)</option>
              <option value="precis_writing">Précis Writing (সারাংশ)</option>
              <option value="translation">Translation (বঙ্গানুবাদ)</option>
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
  );
}
