import { asc, sql } from "drizzle-orm";
import { db } from "../db/index";
import { exams, subjects, chapters, subtopics, questions } from "../db/schema";
import {
  EXAM_SLUG_LABELS,
  levenshtein,
  matchKey,
  slugify,
  type BilingualText,
  type StagedQuestionDraft,
  type SyllabusTreeDto,
} from "../../../../packages/shared-types/src/index";

// ============================================================================
// In-memory syllabus tree + name resolver.
// Users type slugs OR English/Bengali names; this finds the canonical node
// and, on a miss, suggests the closest name ("Did you mean …?").
// ============================================================================

interface NamedNode {
  id: string;
  slug: string;
  name: BilingualText;
}
export interface SubtopicNode extends NamedNode {
  questionCount: number;
}
export interface ChapterNode extends NamedNode {
  subtopics: SubtopicNode[];
}
export interface SubjectNode extends NamedNode {
  chapters: ChapterNode[];
}
export interface ExamNode extends NamedNode {
  marksPerCorrect: string;
  negativeMarksPerWrong: string;
  subjects: SubjectNode[];
}
export type Syllabus = Map<string, ExamNode>;

/** Whole syllabus (a few hundred rows) in 5 queries, keyed by exam slug. */
export async function loadSyllabus(): Promise<Syllabus> {
  const [examRows, subjectRows, chapterRows, subtopicRows, counts] = await Promise.all([
    db.select().from(exams).orderBy(asc(exams.createdAt)),
    db.select().from(subjects).orderBy(asc(subjects.displayOrder), asc(subjects.createdAt)),
    db.select().from(chapters).orderBy(asc(chapters.displayOrder), asc(chapters.createdAt)),
    db.select().from(subtopics).orderBy(asc(subtopics.createdAt)),
    db
      .select({ subtopicId: questions.subtopicId, n: sql<number>`count(*)::int` })
      .from(questions)
      .groupBy(questions.subtopicId),
  ]);

  const countBySubtopic = new Map(counts.map((c) => [c.subtopicId, c.n]));
  const chapterById = new Map<string, ChapterNode>();
  const subjectById = new Map<string, SubjectNode>();
  const syllabus: Syllabus = new Map();

  for (const e of examRows) {
    syllabus.set(e.slug, {
      id: e.id,
      slug: e.slug,
      name: e.title,
      marksPerCorrect: e.marksPerCorrect,
      negativeMarksPerWrong: e.negativeMarksPerWrong,
      subjects: [],
    });
  }
  const examById = new Map([...syllabus.values()].map((e) => [e.id, e]));
  for (const s of subjectRows) {
    const node: SubjectNode = { id: s.id, slug: s.slug, name: s.name, chapters: [] };
    subjectById.set(s.id, node);
    examById.get(s.examId)?.subjects.push(node);
  }
  for (const c of chapterRows) {
    const node: ChapterNode = { id: c.id, slug: c.slug, name: c.name, subtopics: [] };
    chapterById.set(c.id, node);
    subjectById.get(c.subjectId)?.chapters.push(node);
  }
  for (const t of subtopicRows) {
    chapterById.get(t.chapterId)?.subtopics.push({
      id: t.id,
      slug: t.slug,
      name: t.name,
      questionCount: countBySubtopic.get(t.id) ?? 0,
    });
  }
  return syllabus;
}

export function toTreeDto(exam: ExamNode): SyllabusTreeDto {
  return {
    examSlug: exam.slug,
    subjects: exam.subjects.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      chapters: s.chapters.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        subtopics: c.subtopics.map((t) => ({ ...t })),
      })),
    })),
  };
}

// ─── Matching ────────────────────────────────────────────────────────────────

const nodeKeys = (n: NamedNode) => [matchKey(n.slug), matchKey(n.name.en), matchKey(n.name.bn)];

/** True when `input` is this node's slug, English name or Bengali name (loosely). */
export function nodeMatches(n: NamedNode, input: string): boolean {
  const k = matchKey(input);
  return k !== "" && nodeKeys(n).includes(k);
}

const CONCEPT_STOPWORDS = new Set(["and", "of", "the", "in", "a", "an", "to", "for", "with", "its", "on"]);

/** Content words of an English heading: lower-case, singular, "indian" → "india". */
function conceptWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !CONCEPT_STOPWORDS.has(w))
      .map((w) => (w === "indian" ? "india" : w.replace(/ies$/, "y").replace(/(?<=[a-z]{3})s$/, "")))
  );
}

/**
 * Whether two English headings name the same syllabus concept, e.g.
 * "National Movement" ≈ "Indian National Movement", "Constitution of India" ≈
 * "Indian Constitution". One heading's words all inside the other's (2+ words),
 * or ≥ 60% word overlap.
 */
export function sameConcept(a: string, b: string): boolean {
  const A = conceptWords(a);
  const B = conceptWords(b);
  if (A.size === 0 || B.size === 0) return false;
  const shared = [...A].filter((w) => B.has(w)).length;
  const smaller = Math.min(A.size, B.size);
  if (shared === smaller && (smaller >= 2 || A.size === B.size)) return true;
  return shared / (A.size + B.size - shared) >= 0.6;
}

function suggestion(input: string, candidates: NamedNode[]): string {
  const k = matchKey(input);
  let best: NamedNode | null = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    for (const key of nodeKeys(c)) {
      const d = levenshtein(k, key);
      if (d < bestDistance) {
        bestDistance = d;
        best = c;
      }
    }
  }
  const limit = Math.max(2, Math.floor(k.length * 0.4));
  return best && bestDistance <= limit
    ? ` Did you mean "${best.name.en}" (${best.slug})?`
    : "";
}

export function findExam(syllabus: Syllabus, input: string): ExamNode | undefined {
  return [...syllabus.values()].find((e) => nodeMatches(e, input));
}

export interface ResolvedPath {
  exam: ExamNode;
  subject: SubjectNode;
  chapter: ChapterNode;
  subtopic: SubtopicNode;
}

export type ResolveResult =
  | { ok: true; path: ResolvedPath }
  | { ok: false; message: string };

/**
 * Finds the subtopic for exam + subtopic (+ optional subject/chapter to
 * disambiguate). Every field accepts a slug or an English/Bengali name.
 */
export function resolveSyllabusPath(
  syllabus: Syllabus,
  input: { exam: string; subject?: string; chapter?: string; subtopic: string }
): ResolveResult {
  const fail = (message: string): ResolveResult => ({ ok: false, message });
  const allExams = [...syllabus.values()];

  const exam = findExam(syllabus, input.exam);
  if (!exam) {
    return fail(`Exam "${input.exam}" not found.${suggestion(input.exam, allExams)}`);
  }
  if (exam.subjects.length === 0) {
    return fail(
      `Exam "${exam.name.en}" has no syllabus yet — upload one in Exams & Syllabus first.`
    );
  }

  let subjectScope = exam.subjects;
  if (input.subject) {
    subjectScope = exam.subjects.filter((s) => nodeMatches(s, input.subject!));
    if (subjectScope.length === 0) {
      return fail(
        `Subject "${input.subject}" not found in ${exam.name.en}.${suggestion(input.subject, exam.subjects)}`
      );
    }
  }

  let chapterScope = subjectScope.flatMap((subject) =>
    subject.chapters.map((chapter) => ({ subject, chapter }))
  );
  if (input.chapter) {
    const candidates = chapterScope;
    chapterScope = candidates.filter(({ chapter }) => nodeMatches(chapter, input.chapter!));
    if (chapterScope.length === 0) {
      return fail(
        `Chapter "${input.chapter}" not found${input.subject ? ` under "${subjectScope[0].name.en}"` : ` in ${exam.name.en}`}.${suggestion(
          input.chapter,
          candidates.map((c) => c.chapter)
        )}`
      );
    }
  }

  const hits = chapterScope.flatMap(({ subject, chapter }) =>
    chapter.subtopics
      .filter((t) => nodeMatches(t, input.subtopic))
      .map((subtopic) => ({ subject, chapter, subtopic }))
  );
  if (hits.length === 0) {
    const scope = input.chapter
      ? ` under "${chapterScope[0].chapter.name.en}"`
      : input.subject
        ? ` under "${subjectScope[0].name.en}"`
        : ` in ${exam.name.en}`;
    return fail(
      `Subtopic "${input.subtopic}" not found${scope}.${suggestion(
        input.subtopic,
        chapterScope.flatMap((c) => c.chapter.subtopics)
      )}`
    );
  }
  if (hits.length > 1) {
    return fail(
      `Subtopic "${input.subtopic}" exists in ${hits.length} places (${hits
        .map((h) => `${h.subject.name.en} → ${h.chapter.name.en}`)
        .join("; ")}). Fill the chapter column to choose one.`
    );
  }
  return { ok: true, path: { exam, ...hits[0] } };
}

/** PYQ source exam: a known exam (by slug/name) or a free-text older exam name. */
export function resolvePyqExam(
  syllabus: Syllabus,
  input: string
): { slug: string; label: string } {
  const exam = findExam(syllabus, input);
  if (exam) {
    return { slug: exam.slug, label: EXAM_SLUG_LABELS[exam.slug] ?? exam.name.en };
  }
  const slug = slugify(input) || "unknown-exam";
  return { slug, label: EXAM_SLUG_LABELS[slug] ?? input.trim() };
}

/**
 * Resolves a draft's free-text syllabus fields to canonical slugs.
 * Returns the rewritten draft plus the resolved FK path.
 */
export function canonicalizeDraft(
  syllabus: Syllabus,
  draft: StagedQuestionDraft
):
  | { ok: true; draft: StagedQuestionDraft; path: ResolvedPath; pyqTag: string | null }
  | { ok: false; message: string } {
  const resolved = resolveSyllabusPath(syllabus, {
    exam: draft.examSlug,
    subject: draft.subjectSlug || undefined,
    chapter: draft.chapterSlug || undefined,
    subtopic: draft.subtopicSlug,
  });
  if (!resolved.ok) return resolved;
  const { path } = resolved;
  const pyq = draft.pyqExamSlug ? resolvePyqExam(syllabus, draft.pyqExamSlug) : null;
  return {
    ok: true,
    path,
    pyqTag: pyq && draft.pyqYear ? `${pyq.label} ${draft.pyqYear}`.slice(0, 100) : null,
    draft: {
      ...draft,
      examSlug: path.exam.slug,
      subjectSlug: path.subject.slug,
      chapterSlug: path.chapter.slug,
      subtopicSlug: path.subtopic.slug,
      pyqExamSlug: pyq?.slug ?? null,
    },
  };
}
