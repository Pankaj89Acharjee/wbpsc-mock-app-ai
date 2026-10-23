import syllabus from "../../scripts/syllabus.json";
import { INITIAL_EXAMS, type SeedQuestion } from "./seedData";

// ============================================================================
// Firestore seed built from the SAME sources as the PostgreSQL seed:
//   scripts/syllabus.json   → subject / subtopic bilingual names
//   scripts/data/*.json     → bilingual MCQs (examSlug + syllabus slugs)
// so both databases always carry the same question bank.
// ============================================================================

interface RawQuestion {
  examSlug: SeedQuestion["examSlug"];
  subjectSlug: string;
  chapterSlug: string;
  subtopicSlug: string;
  stem: { en: string; bn: string };
  options: Record<"A" | "B" | "C" | "D", { en: string; bn: string }>;
  correctOption: SeedQuestion["correctOption"];
  explanation: { en: string; bn: string };
  difficulty: SeedQuestion["difficulty"];
  marksPositive: number;
  marksNegative: number;
  previousYearTag?: string;
  isActive: boolean;
}

const questionFiles = import.meta.glob<RawQuestion[]>("../../scripts/data/*.json", {
  eager: true,
  import: "default",
});

/** Doc IDs from the old hard-coded seed; superseded by scripts/data/*.json. */
export const LEGACY_FIRESTORE_QUESTION_IDS = [
  "q-wbcs-hist-01",
  "q-wbcs-polity-02",
  "q-wbcs-geo-03",
  "q-wbcs-econ-04",
  "q-wbcs-sci-05",
  "q-clerk-01",
];

export function buildFirestoreSeedQuestions(): SeedQuestion[] {
  const subjectNames = new Map<string, { en: string; bn: string }>();
  const subtopicNames = new Map<string, { en: string; bn: string }>();
  for (const ex of syllabus) {
    for (const s of ex.subjects) {
      subjectNames.set(`${ex.examSlug}/${s.slug}`, s.name);
      for (const c of s.chapters) {
        for (const t of c.subtopics) {
          subtopicNames.set(`${ex.examSlug}/${s.slug}/${c.slug}/${t.slug}`, t.name);
        }
      }
    }
  }

  const result: SeedQuestion[] = [];
  for (const path of Object.keys(questionFiles).sort()) {
    // "../../scripts/data/bengali_pyq.json" → "bengali-pyq"
    const base = path.split("/").pop()!.replace(/\.json$/, "").replace(/_/g, "-");
    questionFiles[path].forEach((q, i) => {
      const exam = INITIAL_EXAMS.find((e) => e.slug === q.examSlug);
      const subject = subjectNames.get(`${q.examSlug}/${q.subjectSlug}`);
      const subtopic = subtopicNames.get(
        `${q.examSlug}/${q.subjectSlug}/${q.chapterSlug}/${q.subtopicSlug}`
      );
      if (!exam || !subject || !subtopic) {
        throw new Error(
          `${base} #${i + 1}: syllabus path ${q.examSlug}/${q.subjectSlug}/${q.chapterSlug}/${q.subtopicSlug} is not in scripts/syllabus.json`
        );
      }
      result.push({
        // Stable per file position — keep data files append-only
        id: `q-${base}-${String(i + 1).padStart(3, "0")}`,
        examId: exam.id,
        examSlug: q.examSlug,
        subjectNameEn: subject.en,
        subjectNameBn: subject.bn,
        subtopicSlug: q.subtopicSlug,
        subtopicNameEn: subtopic.en,
        subtopicNameBn: subtopic.bn,
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
        correctOption: q.correctOption,
        explanationEn: q.explanation.en,
        explanationBn: q.explanation.bn,
        difficulty: q.difficulty,
        marksPositive: q.marksPositive,
        marksNegative: q.marksNegative,
        previousYearTag: q.previousYearTag || "Practice",
        isActive: q.isActive,
      });
    });
  }
  return result;
}
