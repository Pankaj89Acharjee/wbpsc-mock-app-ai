import React, { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  BULK_IMPORT_CSV_COLUMNS,
  toCsv,
  type ExamDto,
} from "../../packages/shared-types/src/index";
import { adminApi, downloadCsv, useSyllabusTrees } from "./adminApi";
import ExamSyllabusPanel from "./ExamSyllabusPanel";
import BulkImportPanel from "./BulkImportPanel";
import ExamSeriesManager from "./ExamSeriesManager";

// ============================================================================
// Admin Console sections backed by the PostgreSQL question bank (api-core):
//   section="exams"     → tab 2: exams + syllabus
//   section="questions" → tab 4: pick an exam → add one / bulk / AI → review
//   section="series"    → tab 5: exam type → test series → subjects + questions
// ============================================================================

export default function QuestionBankAdmin({
  section,
  onExamsChanged,
}: {
  section: "exams" | "questions" | "series";
  /** Lets the student-facing exam list refresh after admin edits */
  onExamsChanged?: () => void;
}) {
  const [exams, setExams] = useState<ExamDto[]>([]);
  const [examSlug, setExamSlug] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const trees = useSyllabusTrees();

  const reloadExams = useCallback(async () => {
    try {
      const res = await adminApi<{ exams: ExamDto[] }>("/syllabus/exams");
      setExams(res.exams);
      setError(null);
      onExamsChanged?.();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [onExamsChanged]);

  // Load once per section mount; later reloads are triggered by edits
  useEffect(() => {
    reloadExams();
  }, []);

  useEffect(() => {
    if (!examSlug && exams.length > 0) setExamSlug(exams[0].slug);
  }, [exams, examSlug]);

  const { loadTree } = trees;
  useEffect(() => {
    if (section === "questions" && examSlug) loadTree(examSlug);
  }, [section, examSlug, loadTree]);

  const errorBox = error && (
    <div className="p-3 rounded-lg border bg-rose-500/10 border-rose-500/30 text-rose-200 text-xs">
      {error}
    </div>
  );

  if (section === "series") {
    return (
      <div className="space-y-4">
        {errorBox}
        <ExamSeriesManager exams={exams} trees={trees} />
      </div>
    );
  }

  if (section === "exams") {
    return (
      <div className="space-y-4">
        {errorBox}
        <ExamSyllabusPanel exams={exams} reloadExams={reloadExams} trees={trees} />
      </div>
    );
  }

  // ── section === "questions" ───────────────────────────────────────────────
  const exam = exams.find((e) => e.slug === examSlug) ?? null;
  const tree = exam ? trees.trees[exam.slug] : undefined;

  const globalAvailableQuestions = exams.reduce((sum, e) => sum + (e.questionCount ?? 0), 0);
  const globalSubtopics = exams.reduce((sum, e) => sum + (e.subtopicCount ?? 0), 0);

  /** Question CSV pre-filled with this exam's syllabus — one row per subtopic. */
  const downloadExamTemplate = () => {
    if (!exam || !tree) return;
    const rows = tree.subjects.flatMap((s) =>
      s.chapters.flatMap((c) =>
        c.subtopics.map((st) => ({
          exam: exam.slug,
          subject: s.name.en,
          chapter: c.name.en,
          subtopic: st.name.en,
        }))
      )
    );
    downloadCsv(`${exam.slug}-questions-template.csv`, toCsv(rows, BULK_IMPORT_CSV_COLUMNS));
  };

  return (
    <div className="space-y-4">
      {/* ── Question Bank Statistics Card (Global & Per-Exam Available Questions) ── */}
      {exams.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Question Bank Statistics — Available Questions (Global &amp; By Exam)
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Live verified bilingual questions currently available in the database across all
                exams. Click any exam card below to manage its questions.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-right">
                <span className="block text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
                  Global Question Bank
                </span>
                <span className="text-lg font-mono font-extrabold text-white">
                  {globalAvailableQuestions}{" "}
                  <span className="text-xs font-normal text-emerald-200">Questions</span>
                </span>
                <span className="block text-[10px] text-slate-400">
                  Across {exams.length} exam(s) · {globalSubtopics} topics
                </span>
              </div>
            </div>
          </div>

          {/* Per-Exam Available Questions Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {exams.map((e) => {
              const isSelected = e.slug === examSlug;
              const targetQs =
                e.slug === "wbpsc-clerkship" && (e.totalQuestions === 20 || e.totalQuestions === 300)
                  ? 100
                  : e.totalQuestions;
              return (
                <button
                  key={e.slug}
                  type="button"
                  onClick={() => setExamSlug(e.slug)}
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer space-y-2 ${
                    isSelected
                      ? "bg-emerald-500/10 border-emerald-400 text-white shadow-md shadow-emerald-950/30"
                      : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-white line-clamp-1">{e.titleEn}</span>
                    {isSelected && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold shrink-0">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 font-bengali line-clamp-1">{e.titleBn}</p>
                  <div className="flex items-baseline justify-between pt-1 border-t border-slate-800/80">
                    <div>
                      <span className="text-base font-mono font-extrabold text-emerald-300">
                        {e.questionCount}
                      </span>
                      <span className="text-[11px] text-slate-400 ml-1">available in bank</span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Exam size: {targetQs} Qs
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Subject-wise available question pills for the active exam */}
          {exam && tree && tree.subjects.length > 0 && (
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-300">
                  {exam.titleEn} — Available Questions by Subject ({exam.questionCount} Total in Bank):
                </span>
                <button
                  onClick={downloadExamTemplate}
                  disabled={!tree || exam.subtopicCount === 0}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 text-emerald-200 border border-emerald-500/30 rounded-lg cursor-pointer"
                >
                  <Download className="w-3 h-3" /> Question CSV Template for {exam.titleEn}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tree.subjects.map((s) => {
                  const subjQs = s.chapters.reduce(
                    (sum, c) =>
                      sum + c.subtopics.reduce((acc, st) => acc + (st.questionCount ?? 0), 0),
                    0
                  );
                  return (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300"
                    >
                      <span className="truncate max-w-48">{s.name.en}</span>
                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 font-mono font-semibold text-[11px]">
                        {subjQs} Qs
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {errorBox}

      {exams.length === 0 ? (
        <p className="text-xs text-slate-400">
          No exams yet — create one in tab <strong>2. Exams &amp; Syllabus</strong> first.
        </p>
      ) : exam && exam.subtopicCount === 0 ? (
        <p className="text-xs text-amber-300">
          {exam.titleEn} has no syllabus yet. Add subjects, chapters and subtopics in tab{" "}
          <strong>2. Exams &amp; Syllabus</strong> before adding questions.
        </p>
      ) : exam ? (
        <BulkImportPanel
          key={exam.slug}
          exam={exam}
          exams={exams}
          trees={trees}
          onQuestionsChanged={async () => {
            await reloadExams();
            if (examSlug) await trees.loadTree(examSlug, true);
          }}
        />
      ) : null}
    </div>
  );
}
