import React, { useEffect } from "react";
import { matchKey, type ExamDto } from "../../packages/shared-types/src/index";
import { findNode, type SyllabusTrees } from "./adminApi";

// ============================================================================
// Exam → Subject → Chapter → Subtopic cascading dropdowns.
// Accepts raw typed values (names/slugs from a CSV) and shows them as
// "not found — pick one" when they don't match the syllabus.
// ============================================================================

export interface SyllabusValue {
  examSlug: string;
  subjectSlug: string;
  chapterSlug: string;
  subtopicSlug: string;
}

export default function SyllabusPicker({
  exams,
  trees,
  value,
  onChange,
  inputCls,
}: {
  exams: ExamDto[];
  trees: SyllabusTrees;
  value: SyllabusValue;
  onChange: (v: SyllabusValue) => void;
  inputCls: string;
}) {
  const examKey = matchKey(value.examSlug);
  const exam = exams.find((e) =>
    [e.slug, e.titleEn, e.titleBn].some((x) => matchKey(x) === examKey)
  );
  const tree = exam ? trees.trees[exam.slug] : undefined;
  const { loadTree } = trees;

  useEffect(() => {
    if (exam) loadTree(exam.slug);
  }, [exam, loadTree]);

  // Resolve typed values against the tree (same rules as api-core)
  const subjects = tree?.subjects ?? [];
  let subject = value.subjectSlug ? findNode(subjects, value.subjectSlug) : undefined;
  const chapterPool = subject
    ? subject.chapters
    : value.subjectSlug
      ? []
      : subjects.flatMap((s) => s.chapters);
  let chapter = value.chapterSlug ? findNode(chapterPool, value.chapterSlug) : undefined;
  const subtopicScope = chapter ? [chapter] : value.chapterSlug ? [] : chapterPool;
  const subtopicHits = subtopicScope.flatMap((c) => {
    const t = value.subtopicSlug ? findNode(c.subtopics, value.subtopicSlug) : undefined;
    return t ? [{ chapter: c, subtopic: t }] : [];
  });
  const subtopic = subtopicHits.length === 1 ? subtopicHits[0].subtopic : undefined;
  if (subtopic && !chapter) chapter = subtopicHits[0].chapter;
  if (chapter && !subject) subject = subjects.find((s) => s.chapters.includes(chapter!));

  const examSlug = exam?.slug ?? value.examSlug;
  const notFound = (typed: string, what: string) =>
    typed ? `⚠ "${typed}" not found — pick ${what}` : `— pick ${what} —`;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <label className="text-xs text-slate-400 space-y-1">
        <span>Exam</span>
        <select
          value={exam?.slug ?? ""}
          onChange={(e) =>
            onChange({ examSlug: e.target.value, subjectSlug: "", chapterSlug: "", subtopicSlug: "" })
          }
          className={`${inputCls} ${exam ? "" : "border-amber-500/60"}`}
        >
          {!exam && <option value="">{notFound(value.examSlug, "an exam")}</option>}
          {exams.map((e) => (
            <option key={e.slug} value={e.slug}>
              {e.titleEn}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-slate-400 space-y-1">
        <span>Subject</span>
        <select
          value={subject?.slug ?? ""}
          disabled={!tree}
          onChange={(e) =>
            onChange({ examSlug, subjectSlug: e.target.value, chapterSlug: "", subtopicSlug: "" })
          }
          className={`${inputCls} ${subject ? "" : "border-amber-500/60"}`}
        >
          {!subject && (
            <option value="">{notFound(value.subjectSlug, "a subject")}</option>
          )}
          {subjects.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name.en}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-slate-400 space-y-1">
        <span>Chapter</span>
        <select
          value={chapter?.slug ?? ""}
          disabled={!subject}
          onChange={(e) =>
            onChange({
              examSlug,
              subjectSlug: subject!.slug,
              chapterSlug: e.target.value,
              subtopicSlug: "",
            })
          }
          className={`${inputCls} ${chapter ? "" : "border-amber-500/60"}`}
        >
          {!chapter && (
            <option value="">{notFound(value.chapterSlug, "a chapter")}</option>
          )}
          {(subject?.chapters ?? []).map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name.en}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-slate-400 space-y-1">
        <span>Subtopic</span>
        <select
          value={subtopic?.slug ?? ""}
          disabled={!chapter}
          onChange={(e) =>
            onChange({
              examSlug,
              subjectSlug: subject!.slug,
              chapterSlug: chapter!.slug,
              subtopicSlug: e.target.value,
            })
          }
          className={`${inputCls} ${subtopic ? "" : "border-amber-500/60"}`}
        >
          {!subtopic && (
            <option value="">
              {subtopicHits.length > 1
                ? `⚠ "${value.subtopicSlug}" is in ${subtopicHits.length} chapters — pick the chapter`
                : notFound(value.subtopicSlug, "a subtopic")}
            </option>
          )}
          {(chapter?.subtopics ?? []).map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name.en}
            </option>
          ))}
        </select>
      </label>

      {exam && tree && subjects.length === 0 && (
        <p className="col-span-full text-xs text-amber-300">
          {exam.titleEn} has no syllabus yet — add one in “Exams &amp; Syllabus”.
        </p>
      )}
    </div>
  );
}
