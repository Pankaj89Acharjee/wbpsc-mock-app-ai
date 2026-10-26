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
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
        <label className="text-xs text-slate-400 space-y-1 min-w-72">
          <span className="block font-semibold text-white">Exam</span>
          <select
            value={examSlug}
            onChange={(e) => setExamSlug(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-lg text-white"
          >
            {exams.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.titleEn} — {e.questionCount} questions
              </option>
            ))}
          </select>
        </label>
        {exam && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-400">
              {exam.subtopicCount} subtopics · {exam.questionCount} live questions
            </span>
            <button
              onClick={downloadExamTemplate}
              disabled={!tree || exam.subtopicCount === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 text-emerald-200 border border-emerald-500/30 rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Question template for this exam
            </button>
          </div>
        )}
      </div>
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
          onQuestionsChanged={reloadExams}
        />
      ) : null}
    </div>
  );
}
