import { z } from "zod";

// ============================================================================
// 1. Language & Bilingual Primitives (English + Bengali Mandate)
// ============================================================================

export const SupportedLanguageSchema = z.enum(["en", "bn"]);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export const BilingualTextSchema = z.object({
  en: z.string().min(1, "English text is required").trim(),
  bn: z.string().min(1, "Bengali (বাংলা) text is required").trim(),
});
export type BilingualText = z.infer<typeof BilingualTextSchema>;

/**
 * Exam slug, e.g. "wbcs-prelims". Free text so admins can add new exams
 * (lowercase letters, digits and single hyphens).
 */
export const ExamSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Exam slug must be lowercase letters, digits and hyphens");
export type ExamSlug = z.infer<typeof ExamSlugSchema>;

export const OptionKeySchema = z.enum(["A", "B", "C", "D"]);
export type OptionKey = z.infer<typeof OptionKeySchema>;

export const DifficultyLevelSchema = z.enum(["easy", "moderate", "hard"]);
export type DifficultyLevel = z.infer<typeof DifficultyLevelSchema>;

// ============================================================================
// 2. Question Schema & Interfaces
// ============================================================================

export const QuestionOptionsSchema = z.object({
  A: BilingualTextSchema,
  B: BilingualTextSchema,
  C: BilingualTextSchema,
  D: BilingualTextSchema,
});
export type QuestionOptions = z.infer<typeof QuestionOptionsSchema>;

export const QuestionSchema = z.object({
  id: z.string().uuid(),
  examSlug: ExamSlugSchema,
  subjectId: z.string().uuid(),
  chapterId: z.string().uuid(),
  subtopicId: z.string().uuid(),
  stem: BilingualTextSchema,
  options: QuestionOptionsSchema,
  correctOption: OptionKeySchema,
  explanation: BilingualTextSchema,
  difficulty: DifficultyLevelSchema.default("moderate"),
  marksPositive: z.number().positive().default(1.0),
  marksNegative: z.number().nonnegative().default(0.25),
  previousYearTag: z.string().nullable().optional(), // e.g. "WBCS Prelims 2023"
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime().optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

/**
 * Public Question payload sent to clients during an active test
 * (strips `correctOption` and `explanation` to prevent client-side inspection).
 */
export const ClientSafeQuestionSchema = QuestionSchema.omit({
  correctOption: true,
  explanation: true,
});
export type ClientSafeQuestion = z.infer<typeof ClientSafeQuestionSchema>;

// ============================================================================
// 3. Test Submission Payload (Deterministic SQL Grading in apps/api-core)
// ============================================================================

export const QuestionAttemptStatusSchema = z.enum([
  "answered",
  "marked_for_review",
  "answered_and_marked",
  "unanswered",
  "not_visited",
]);
export type QuestionAttemptStatus = z.infer<typeof QuestionAttemptStatusSchema>;

export const SubmittedAnswerItemSchema = z.object({
  questionId: z.string().uuid(),
  selectedOption: OptionKeySchema.nullable(),
  status: QuestionAttemptStatusSchema,
  timeSpentSeconds: z.number().int().nonnegative().max(7200),
});
export type SubmittedAnswerItem = z.infer<typeof SubmittedAnswerItemSchema>;

export const TestSubmissionPayloadSchema = z.object({
  attemptId: z.string().uuid(),
  testSeriesId: z.string().uuid(),
  userId: z.string().uuid(),
  examSlug: ExamSlugSchema,
  preferredLanguage: SupportedLanguageSchema.default("bn"),
  startedAt: z.string().datetime(),
  submittedAt: z.string().datetime(),
  totalTimeSpentSeconds: z.number().int().nonnegative(),
  devicePlatform: z.enum(["android-expo", "nextjs-web"]).default("nextjs-web"),
  answers: z.array(SubmittedAnswerItemSchema).min(1),
});
export type TestSubmissionPayload = z.infer<typeof TestSubmissionPayloadSchema>;

// ============================================================================
// 4. Deterministic Weakness Report & SQL Analytics Output
// ============================================================================

export const MasteryBandSchema = z.enum([
  "critical_weakness", // Accuracy < 45%
  "needs_revision",    // Accuracy 45% - 69%
  "proficient",        // Accuracy 70% - 84%
  "exam_ready",        // Accuracy >= 85%
]);
export type MasteryBand = z.infer<typeof MasteryBandSchema>;

export const SubtopicWeaknessMetricSchema = z.object({
  subjectId: z.string().uuid(),
  subjectName: BilingualTextSchema,
  chapterId: z.string().uuid(),
  chapterName: BilingualTextSchema,
  subtopicId: z.string().uuid(),
  subtopicSlug: z.string().min(1),
  subtopicName: BilingualTextSchema,
  totalQuestions: z.number().int().nonnegative(),
  attemptedCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  incorrectCount: z.number().int().nonnegative(),
  unansweredCount: z.number().int().nonnegative(),
  netScore: z.number(),
  maxPossibleScore: z.number().positive(),
  accuracyPercentage: z.number().min(0).max(100),
  avgTimePerQuestionSeconds: z.number().nonnegative(),
  masteryBand: MasteryBandSchema,
  /**
   * Deterministic 3-tier AI cache key (`exam_slug:topic_slug:lang`)
   * used to fetch cached RAG revision notes on demand.
   */
  aiNoteCacheKey: z.string().min(3),
});
export type SubtopicWeaknessMetric = z.infer<typeof SubtopicWeaknessMetricSchema>;

export const WeaknessReportSchema = z.object({
  reportId: z.string().uuid(),
  attemptId: z.string().uuid(),
  userId: z.string().uuid(),
  examSlug: ExamSlugSchema,
  generatedAt: z.string().datetime(),
  overallSummary: z.object({
    totalQuestions: z.number().int().positive(),
    attempted: z.number().int().nonnegative(),
    correct: z.number().int().nonnegative(),
    incorrect: z.number().int().nonnegative(),
    unanswered: z.number().int().nonnegative(),
    rawScore: z.number(),
    negativePenalty: z.number().nonnegative(),
    finalNetScore: z.number(),
    maxScore: z.number().positive(),
    accuracyPercentage: z.number().min(0).max(100),
    percentileEstimate: z.number().min(0).max(100),
    cutoffCleared: z.boolean(),
    estimatedCutoffScore: z.number(),
  }),
  weakSubtopics: z.array(SubtopicWeaknessMetricSchema),
  strongSubtopics: z.array(SubtopicWeaknessMetricSchema),
});
export type WeaknessReport = z.infer<typeof WeaknessReportSchema>;

// ============================================================================
// 4b. Accounts (self-hosted auth in api-core)
// ============================================================================

export type UserRole = "aspirant" | "educator" | "admin";
export type SubscriptionTier = "free" | "pro_prelims" | "wbcs_executive_pass";

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  subscriptionTier: SubscriptionTier;
  preferredLanguage: SupportedLanguage;
  targetExamSlug: string;
  isActive: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  createdAt: string;
}

// ============================================================================
// 5. Bulk Question Ingestion (CSV / JSON Upload → Staging → Educator Review)
// ============================================================================

/** Where a live question came from. Mirrors `question_source` enum in api-core. */
export const QuestionSourceSchema = z.enum(["pyq", "educator", "ai_generated"]);
export type QuestionSource = z.infer<typeof QuestionSourceSchema>;

export const IngestionStatusSchema = z.enum([
  "pending_ai",
  "pending_review",
  "approved",
  "rejected",
  "inserted",
  "failed",
]);
export type IngestionStatus = z.infer<typeof IngestionStatusSchema>;

/** Display names for well-known exams (PYQ tags for exams not in the DB). */
export const EXAM_SLUG_LABELS: Record<string, string> = {
  "wbcs-prelims": "WBCS Prelims",
  "wbcs-mains": "WBCS Mains",
  "wbpsc-clerkship-part1": "WBPSC Clerkship Part-I",
  "wbpsc-clerkship-part2": "WBPSC Clerkship Part-II",
  "wbpsc-miscellaneous": "WBPSC Miscellaneous",
  "wbpsc-food-si": "WBPSC Food SI",
  "wbp-constable-si": "WBP Constable / SI",
};

// ─── Name matching: users type names, the system finds the slug ─────────────

const MATCH_STOPWORDS = new Set(["and", "of", "the", "in", "for"]);

/**
 * Loose comparison key so "Fundamental Rights & Duties", "fundamental rights
 * and duties" and "fundamental-rights-duties" all compare equal.
 * Works for Bengali too (letters/digits of any script are kept).
 */
export function matchKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((w) => w && !MATCH_STOPWORDS.has(w))
    .join("-");
}

/** URL-safe slug generated from an English name. */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Edit distance, used to suggest the closest syllabus name for a typo. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// ─── Exam config & syllabus (admin-managed in PostgreSQL) ────────────────────

export const ExamSubjectWeightageSchema = z.object({
  subjectEn: z.string().trim().min(1, "Subject English name is required").max(200),
  subjectBn: z.string().trim().max(200).optional().default(""),
  weightageQuestions: z.coerce.number().int().min(1).max(300),
});
export type ExamSubjectWeightage = z.infer<typeof ExamSubjectWeightageSchema>;

export const ExamConfigInputSchema = z.object({
  slug: ExamSlugSchema.optional(),
  titleEn: z.string().trim().min(2, "English title is required").max(200),
  titleBn: z.string().trim().min(2, "Bengali title is required").max(200),
  descriptionEn: z.string().trim().max(1000).default(""),
  descriptionBn: z.string().trim().max(1000).default(""),
  totalQuestions: z.coerce.number().int().min(1).max(300),
  durationMinutes: z.coerce.number().int().min(1).max(600),
  marksPerCorrect: z.coerce.number().positive().max(10),
  negativeMarksPerWrong: z.coerce.number().min(0).max(5),
  estimatedCutoffMarks: z.coerce.number().min(0).max(1000),
  isActive: z.boolean().default(true),
  /** Optional per-subject question counts set by Admin during Exam creation/edit */
  subjectWeightages: z.array(ExamSubjectWeightageSchema).max(30).optional(),
});
export type ExamConfigInput = z.infer<typeof ExamConfigInputSchema>;

/** One subtopic per row; slugs are generated from English names when blank. */
export const SYLLABUS_CSV_COLUMNS = [
  "subject_en",
  "subject_bn",
  "chapter_en",
  "chapter_bn",
  "subtopic_en",
  "subtopic_bn",
  "subject_slug",
  "chapter_slug",
  "subtopic_slug",
] as const;

export const SYLLABUS_REQUIRED_COLUMNS = [
  "subject_en",
  "subject_bn",
  "chapter_en",
  "chapter_bn",
  "subtopic_en",
  "subtopic_bn",
] as const;

const slugCell = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use lowercase letters, digits and hyphens")
    .optional()
);

export const SyllabusRowSchema = z.object({
  subject_en: z.string().trim().min(1, "subject_en is required"),
  subject_bn: z.string().trim().min(1, "subject_bn is required"),
  chapter_en: z.string().trim().min(1, "chapter_en is required"),
  chapter_bn: z.string().trim().min(1, "chapter_bn is required"),
  subtopic_en: z.string().trim().min(1, "subtopic_en is required"),
  subtopic_bn: z.string().trim().min(1, "subtopic_bn is required"),
  subject_slug: slugCell,
  chapter_slug: slugCell,
  subtopic_slug: slugCell,
});
export type SyllabusRow = z.infer<typeof SyllabusRowSchema>;

export const SYLLABUS_TEMPLATE_EXAMPLES: Array<Partial<Record<(typeof SYLLABUS_CSV_COLUMNS)[number], string>>> = [
  {
    subject_en: "Indian Polity & Constitution",
    subject_bn: "ভারতের সংবিধান ও রাজনীতি",
    chapter_en: "Fundamental Rights & Duties",
    chapter_bn: "মৌলিক অধিকার ও কর্তব্য",
    subtopic_en: "Fundamental Rights Articles",
    subtopic_bn: "মৌলিক অধিকার সংক্রান্ত অনুচ্ছেদ",
  },
  {
    subject_en: "Indian Polity & Constitution",
    subject_bn: "ভারতের সংবিধান ও রাজনীতি",
    chapter_en: "Fundamental Rights & Duties",
    chapter_bn: "মৌলিক অধিকার ও কর্তব্য",
    subtopic_en: "Fundamental Duties (Article 51A)",
    subtopic_bn: "মৌলিক কর্তব্য (অনুচ্ছেদ ৫১ক)",
  },
];

export interface ExamDto {
  id: string;
  slug: string;
  titleEn: string;
  titleBn: string;
  descriptionEn: string;
  descriptionBn: string;
  totalQuestions: number;
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarksPerWrong: number;
  estimatedCutoffMarks: number;
  isActive: boolean;
  subjectCount: number;
  subtopicCount: number;
  questionCount: number;
}

export interface SyllabusNodeDto {
  id: string;
  slug: string;
  name: BilingualText;
}
export interface SyllabusSubtopicDto extends SyllabusNodeDto {
  questionCount: number;
}
export interface SyllabusChapterDto extends SyllabusNodeDto {
  subtopics: SyllabusSubtopicDto[];
}
export interface SyllabusSubjectDto extends SyllabusNodeDto {
  /** Number of questions configured for this subject by the Admin (default 25) */
  weightageQuestions?: number;
  chapters: SyllabusChapterDto[];
}
export interface SyllabusTreeDto {
  examSlug: string;
  subjects: SyllabusSubjectDto[];
}

export interface SyllabusUploadResult {
  created: { subjects: number; chapters: number; subtopics: number };
  updated: number;
  errors: Array<{ rowNumber: number; message: string }>;
}

// ─── Question upload columns ─────────────────────────────────────────────────

/** Column order of the downloadable question CSV template (one MCQ per row). */
export const BULK_IMPORT_CSV_COLUMNS = [
  "exam",
  "subject",
  "chapter",
  "subtopic",
  "stem_en",
  "stem_bn",
  "option_a_en",
  "option_a_bn",
  "option_b_en",
  "option_b_bn",
  "option_c_en",
  "option_c_bn",
  "option_d_en",
  "option_d_bn",
  "correct_option",
  "explanation_en",
  "explanation_bn",
  "difficulty",
  "source",
  "pyq_exam",
  "pyq_year",
  "answer_key_verified",
] as const;
export type BulkImportCsvColumn = (typeof BULK_IMPORT_CSV_COLUMNS)[number];

/** Older header names still accepted in uploaded files. */
const BULK_IMPORT_HEADER_ALIASES: Record<string, BulkImportCsvColumn> = {
  exam_slug: "exam",
  subject_slug: "subject",
  chapter_slug: "chapter",
  subtopic_slug: "subtopic",
  pyq_exam_slug: "pyq_exam",
};

/**
 * Only exam + subtopic are needed to place a question; subject/chapter help
 * when the same subtopic name exists in two places. Bengali & explanation may
 * be left blank for AI enrichment.
 */
export const BULK_IMPORT_REQUIRED_COLUMNS: readonly BulkImportCsvColumn[] = [
  "exam",
  "subtopic",
  "stem_en",
  "option_a_en",
  "option_b_en",
  "option_c_en",
  "option_d_en",
  "correct_option",
];

export const BULK_IMPORT_MAX_ROWS = 2000;

/** Lower-cases keys and maps legacy aliases (exam_slug → exam, …). */
export function normalizeRecordKeys(record: unknown): unknown {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => {
      const key = k.trim().toLowerCase();
      return [BULK_IMPORT_HEADER_ALIASES[key] ?? key, v];
    })
  );
}

const blankToUndefined = (v: unknown) =>
  v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;

const requiredCell = (label: string) =>
  z.string().trim().min(1, `${label} is required`);
const optionalCell = z.preprocess(blankToUndefined, z.string().trim().optional());

const yesNoCell = z.preprocess((v) => {
  const b = blankToUndefined(v);
  if (b === undefined || typeof b === "boolean") return b;
  const s = String(b).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return b;
}, z.boolean().optional());

const lowerCell = (v: unknown) => {
  const b = blankToUndefined(v);
  return typeof b === "string" ? b.trim().toLowerCase() : b;
};

/**
 * One uploaded row (CSV row or JSON object with the same flat keys).
 * `exam`/`subject`/`chapter`/`subtopic` accept a slug OR the English/Bengali
 * name — api-core resolves them against the syllabus.
 */
export const BulkQuestionRowSchema = z
  .object({
    exam: requiredCell("exam"),
    subject: optionalCell,
    chapter: optionalCell,
    subtopic: requiredCell("subtopic"),
    stem_en: requiredCell("stem_en"),
    stem_bn: optionalCell,
    option_a_en: requiredCell("option_a_en"),
    option_a_bn: optionalCell,
    option_b_en: requiredCell("option_b_en"),
    option_b_bn: optionalCell,
    option_c_en: requiredCell("option_c_en"),
    option_c_bn: optionalCell,
    option_d_en: requiredCell("option_d_en"),
    option_d_bn: optionalCell,
    correct_option: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
      OptionKeySchema
    ),
    explanation_en: optionalCell,
    explanation_bn: optionalCell,
    difficulty: z.preprocess(lowerCell, DifficultyLevelSchema.optional()),
    // Uploads are either real PYQs or educator-framed; AI questions come from Pipeline 3 only.
    source: z.preprocess(lowerCell, z.enum(["pyq", "educator"]).optional()),
    pyq_exam: optionalCell,
    pyq_year: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1990).max(2100).optional()
    ),
    answer_key_verified: yesNoCell,
  })
  .superRefine((row, ctx) => {
    if (row.source === "pyq" && (!row.pyq_exam || !row.pyq_year)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pyq_year"],
        message: "PYQ rows need both pyq_exam and pyq_year",
      });
    }
  });
export type BulkQuestionRow = z.infer<typeof BulkQuestionRowSchema>;

const DraftTextSchema = z.object({
  en: z.string().trim(),
  bn: z.string().trim(),
});
const DraftTextEnRequiredSchema = DraftTextSchema.extend({
  en: z.string().trim().min(1, "English text is required"),
});

/**
 * Editable staged question kept in `question_ingestion_jobs.enriched_data`.
 * Lenient: syllabus fields hold whatever the user typed until resolved, and
 * Bengali / explanation may still be empty while `pending_ai`.
 */
export const StagedQuestionDraftSchema = z.object({
  examSlug: z.string().trim().min(1, "Exam is required"),
  subjectSlug: z.string().trim(),
  chapterSlug: z.string().trim(),
  subtopicSlug: z.string().trim().min(1, "Subtopic is required"),
  stem: DraftTextEnRequiredSchema,
  options: z.object({
    A: DraftTextEnRequiredSchema,
    B: DraftTextEnRequiredSchema,
    C: DraftTextEnRequiredSchema,
    D: DraftTextEnRequiredSchema,
  }),
  correctOption: OptionKeySchema,
  explanation: DraftTextSchema,
  difficulty: DifficultyLevelSchema,
  source: QuestionSourceSchema,
  pyqExamSlug: z.string().trim().min(1).nullable(),
  pyqYear: z.number().int().min(1990).max(2100).nullable(),
  answerKeyVerified: z.boolean(),
});
export type StagedQuestionDraft = z.infer<typeof StagedQuestionDraftSchema>;

/** Strict gate applied when the educator approves a staged question for the live bank. */
export const ApprovableQuestionSchema = StagedQuestionDraftSchema.extend({
  examSlug: ExamSlugSchema,
  subjectSlug: z.string().trim().min(1),
  chapterSlug: z.string().trim().min(1),
  stem: BilingualTextSchema,
  options: QuestionOptionsSchema,
  explanation: BilingualTextSchema,
}).superRefine((q, ctx) => {
  if (q.source === "ai_generated" && !q.answerKeyVerified) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["answerKeyVerified"],
      message: "AI-generated answers must be checked by an educator before approving",
    });
  }
  if (q.source !== "pyq") return;
  if (!q.pyqExamSlug || !q.pyqYear) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pyqYear"],
      message: "PYQ needs exam and year",
    });
  }
  if (!q.answerKeyVerified) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["answerKeyVerified"],
      message: "Check the PYQ answer against the official WBPSC answer key before approving",
    });
  }
});

export function rowToDraft(row: BulkQuestionRow): StagedQuestionDraft {
  const source = row.source ?? "educator";
  return {
    examSlug: row.exam,
    subjectSlug: row.subject ?? "",
    chapterSlug: row.chapter ?? "",
    subtopicSlug: row.subtopic,
    stem: { en: row.stem_en, bn: row.stem_bn ?? "" },
    options: {
      A: { en: row.option_a_en, bn: row.option_a_bn ?? "" },
      B: { en: row.option_b_en, bn: row.option_b_bn ?? "" },
      C: { en: row.option_c_en, bn: row.option_c_bn ?? "" },
      D: { en: row.option_d_en, bn: row.option_d_bn ?? "" },
    },
    correctOption: row.correct_option,
    explanation: { en: row.explanation_en ?? "", bn: row.explanation_bn ?? "" },
    difficulty: row.difficulty ?? "moderate",
    source,
    pyqExamSlug: row.pyq_exam ?? null,
    pyqYear: row.pyq_year ?? null,
    // Educators vouch for their own answers; PYQ answers must be checked against the official key.
    answerKeyVerified: row.answer_key_verified ?? source === "educator",
  };
}

/** True when every bilingual field is filled, i.e. no AI enrichment is needed. */
export function isDraftTextComplete(d: StagedQuestionDraft): boolean {
  const texts = [d.stem, d.options.A, d.options.B, d.options.C, d.options.D, d.explanation];
  return texts.every((t) => t.en.trim() !== "" && t.bn.trim() !== "");
}

/** "WBCS Prelims 2022" — `examLabel` is the exam's display name. */
export function pyqLabel(examLabel: string | null, year: number | null): string | null {
  return examLabel && year ? `${examLabel} ${year}`.slice(0, 100) : null;
}

/**
 * Canonical text used for duplicate detection (SHA-256 is applied server-side).
 * Option order is ignored so a re-shuffled copy of the same PYQ is still caught.
 */
export function normalizeForContentHash(
  stemEn: string,
  options: Record<OptionKey, { en: string }>
): string {
  const norm = (s: string) =>
    s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const opts = OptionKeySchema.options.map((k) => norm(options[k].en)).sort();
  return [norm(stemEn), ...opts].join("|");
}

/** Minimal RFC 4180 parser (quoted fields, embedded commas/newlines, UTF-8 BOM from Excel). */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface CsvRecord {
  /** 1-based row number as shown in Excel (header = row 1). */
  rowNumber: number;
  record: Record<string, string>;
}

export function csvTableToRecords(
  table: string[][],
  requiredColumns: readonly string[] = BULK_IMPORT_REQUIRED_COLUMNS
): {
  records: CsvRecord[];
  missingColumns: string[];
} {
  const header: string[] = (table[0] ?? []).map((h) => {
    const key = h.trim().toLowerCase();
    return BULK_IMPORT_HEADER_ALIASES[key] ?? key;
  });
  const missingColumns = requiredColumns.filter((c) => !header.includes(c));
  const records: CsvRecord[] = [];
  table.slice(1).forEach((cells, idx) => {
    if (cells.every((c) => c.trim() === "")) return;
    records.push({
      rowNumber: idx + 2,
      record: Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])),
    });
  });
  return { records, missingColumns };
}

export function toCsv(
  rows: Array<Partial<Record<string, string>>>,
  columns: readonly string[]
): string {
  const esc = (v: string | undefined) => {
    const s = v ?? "";
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join(
    "\r\n"
  );
}

/** Example rows shipped inside the downloadable template. */
export const BULK_IMPORT_TEMPLATE_EXAMPLES: Array<Partial<Record<BulkImportCsvColumn, string>>> = [
  {
    exam: "wbcs-prelims",
    subject: "Indian Polity & Constitution",
    chapter: "Fundamental Rights & Duties",
    subtopic: "Fundamental Rights Articles",
    stem_en: "Which Article of the Indian Constitution guarantees the 'Right to Constitutional Remedies'?",
    stem_bn: "ভারতীয় সংবিধানের কোন অনুচ্ছেদ 'সাংবিধানিক প্রতিকারের অধিকার' নিশ্চিত করে?",
    option_a_en: "Article 19",
    option_a_bn: "অনুচ্ছেদ ১৯",
    option_b_en: "Article 21",
    option_b_bn: "অনুচ্ছেদ ২১",
    option_c_en: "Article 32",
    option_c_bn: "অনুচ্ছেদ ৩২",
    option_d_en: "Article 226",
    option_d_bn: "অনুচ্ছেদ ২২৬",
    correct_option: "C",
    explanation_en: "Article 32 lets citizens move the Supreme Court directly to enforce Fundamental Rights.",
    explanation_bn: "অনুচ্ছেদ ৩২ নাগরিকদের মৌলিক অধিকার রক্ষায় সরাসরি সুপ্রিম কোর্টে যাওয়ার অধিকার দেয়।",
    difficulty: "easy",
    source: "pyq",
    pyq_exam: "wbcs-prelims",
    pyq_year: "2022",
    answer_key_verified: "yes",
  },
  {
    exam: "WBCS Preliminary Examination (Group A/B/C/D)",
    subtopic: "Fundamental Rights Articles",
    stem_en:
      "Names work too, and only exam + subtopic are required. Leave _bn / explanation blank to fill them during review.",
    option_a_en: "Option A",
    option_b_en: "Option B",
    option_c_en: "Option C",
    option_d_en: "Option D",
    correct_option: "A",
    source: "educator",
  },
];

// ─── Ingestion API DTOs (api-core ⇄ admin web console) ──────────────────────

export interface IngestionUploadResult {
  batchId: string;
  total: number;
  pendingReview: number;
  pendingAi: number;
  failed: number;
  /** Template rows left without a question (ignored) */
  skippedEmpty: number;
  errors: Array<{ rowNumber: number; message: string }>;
}

export const AI_QUESTION_COUNT_OPTIONS = [10, 15, 20, 25, 30, 40, 50] as const;

/**
 * Where generated questions are meant to go:
 *  - "bank":   reusable questions for the central Question Bank (no blueprint limit)
 *  - "roster": questions for `seriesId`; capped by that series' open vacancies
 */
export const GenerationModeSchema = z.enum(["bank", "roster"]);
export type GenerationMode = z.infer<typeof GenerationModeSchema>;

/** Admin request to draft WBPSC-style MCQs with AI (Pipeline 3). */
export const GenerateQuestionsInputSchema = z
  .object({
    examSlug: z.string().trim().min(1),
    subjectSlug: z.string().trim().default(""),
    chapterSlug: z.string().trim().default(""),
    subtopicSlug: z.string().trim().min(1, "Pick a subtopic"),
    count: z.coerce.number().int().min(1).max(50),
    difficulty: z.enum(["easy", "moderate", "hard", "mixed"]).default("mixed"),
    mode: GenerationModeSchema.default("bank"),
    seriesId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.mode === "bank" || !!v.seriesId, {
    path: ["seriesId"],
    message: "Pick the test series the questions are for",
  });
export type GenerateQuestionsInput = z.infer<typeof GenerateQuestionsInputSchema>;

export interface GenerateQuestionsResult extends IngestionUploadResult {
  modelUsed: string;
  /** Where the batch came from: fresh Gemini call or one of the caches */
  cacheTier: "redis" | "postgres" | "gemini";
  requested: number;
  /** Unique questions actually staged for review */
  uniqueGenerated: number;
  /** AI calls made (1 + retries asked for fresh questions after duplicates) */
  attempts: number;
  duplicatesDropped: { exact: number; near: number; inBatch: number };
  /** Blueprint vacancy the request was checked against (roster mode only) */
  vacancy: VacancyDto | null;
}

/** 409 body when a roster-mode request asks for more than the open vacancies. */
export interface GenerationOverLimitError {
  error: string;
  code: "ROSTER_VACANCY_EXCEEDED" | "NOT_IN_ROSTER";
  requested: number;
  allowed: number;
  vacancy: VacancyDto;
}

export interface ExtractMediaQuestionsResult extends IngestionUploadResult {
  insertedLive: number;
  categoriesCreated: number;
  modelUsed: string;
}

export interface PresetSubtopic {
  en: string;
  bn: string;
}

export interface PresetChapter {
  en: string;
  bn: string;
  subtopics: PresetSubtopic[];
}

export interface PresetSubject {
  key: string;
  en: string;
  bn: string;
  chapters: PresetChapter[];
}

/** Pre-populated WBPSC Subject → Chapter → Subtopic catalog for 1-click or guided manual entry */
export const WBPSC_SUBJECT_PRESETS: PresetSubject[] = [
  {
    key: "history",
    en: "History of India & Indian National Movement",
    bn: "ভারতের ইতিহাস ও ভারতের জাতীয় আন্দোলন",
    chapters: [
      {
        en: "Ancient & Medieval India",
        bn: "প্রাচীন ও মধ্যযুগের ভারত",
        subtopics: [
          { en: "Indus Valley Civilization & Vedic Age", bn: "সিন্ধু সভ্যতা ও বৈদিক যুগ" },
          { en: "Maurya & Gupta Empires", bn: "মৌর্য ও গুপ্ত সাম্রাজ্য" },
          { en: "Delhi Sultanate & Mughal Administration", bn: "দিল্লি সুলতানি ও মুঘল প্রশাসন" },
          { en: "Pala & Sena Dynasties of Bengal", bn: "বাংলার পাল ও সেন বংশ" },
        ],
      },
      {
        en: "Indian National Movement (1857–1947)",
        bn: "ভারতের জাতীয় আন্দোলন (১৮৫৭–১৯৪৭)",
        subtopics: [
          { en: "Revolt of 1857 & Socio-Religious Reform Movements", bn: "১৮৫৭ সালের মহাবিদ্রোহ ও সমাজ সংস্কার আন্দোলন" },
          { en: "Partition of Bengal (1905) & Swadeshi Movement", bn: "বঙ্গভঙ্গ (১৯০৫) ও স্বদেশী আন্দোলন" },
          { en: "Gandhian Era: Non-Cooperation, Civil Disobedience & Quit India", bn: "গান্ধী যুগ: অসহযোগ, আইন অমান্য ও ভারত ছাড়ো আন্দোলন" },
          { en: "Subhas Chandra Bose, INA & Revolutionary Movements in Bengal", bn: "সুভাষচন্দ্র বসু, আজাদ হিন্দ ফৌজ ও বাংলার বিপ্লবী আন্দোলন" },
        ],
      },
    ],
  },
  {
    key: "geography",
    en: "Geography of India & West Bengal",
    bn: "ভারত ও পশ্চিমবঙ্গের ভূগোল",
    chapters: [
      {
        en: "Physical & Economic Geography of India",
        bn: "ভারতের প্রাকৃতিক ও অর্থনৈতিক ভূগোল",
        subtopics: [
          { en: "Physiographic Divisions & Himalayan River Systems", bn: "ভারতের ভূ-প্রাকৃতিক বিভাগ ও নদনদী" },
          { en: "Indian Monsoon, Climate, Soils & Natural Vegetation", bn: "ভারতের জলবায়ু, মৃত্তিকা ও স্বাভাবিক উদ্ভিদ" },
          { en: "Agriculture, Minerals & Major Industries of India", bn: "ভারতের কৃষি, খনিজ সম্পদ ও শিল্প" },
        ],
      },
      {
        en: "Special Geography of West Bengal",
        bn: "পশ্চিমবঙ্গের বিশেষ ভূগোল",
        subtopics: [
          { en: "Physiography of West Bengal: Darjeeling Himalayas to Sundarbans", bn: "পশ্চিমবঙ্গের ভূ-প্রকৃতি: দার্জিলিং হিমালয় থেকে সুন্দরবন" },
          { en: "Rivers, Irrigation Projects & Sanctuaries of West Bengal", bn: "পশ্চিমবঙ্গের নদনদী, সেচ প্রকল্প ও অভয়ারণ্য" },
          { en: "Districts, Census Demographics & Economy of West Bengal", bn: "পশ্চিমবঙ্গের জেলা, জনগণনা ও অর্থনীতি" },
        ],
      },
    ],
  },
  {
    key: "polity",
    en: "Indian Polity & Constitution",
    bn: "ভারতের সংবিধান ও রাষ্ট্রব্যবস্থা",
    chapters: [
      {
        en: "Constitutional Framework & Rights",
        bn: "সাংবিধানিক কাঠামো ও মৌলিক অধিকার",
        subtopics: [
          { en: "Preamble, Schedules & Sources of the Constitution", bn: "প্রস্তাবনা, তফসিল ও সংবিধানের উৎস" },
          { en: "Fundamental Rights (Articles 12–35) & Duties (Article 51A)", bn: "মৌলিক অধিকার (অনুচ্ছেদ ১২–৩৫) ও মৌলিক কর্তব্য" },
          { en: "Directive Principles of State Policy (DPSP)", bn: "রাষ্ট্র পরিচালনার নির্দেশমূলক নীতি (DPSP)" },
        ],
      },
      {
        en: "Union, State & Local Governance",
        bn: "কেন্দ্র, রাজ্য ও স্থানীয় স্বায়ত্তশাসন",
        subtopics: [
          { en: "President, Prime Minister, Parliament & Governor", bn: "রাষ্ট্রপতি, প্রধানমন্ত্রী, সংসদ ও রাজ্যপাল" },
          { en: "Supreme Court, High Courts & Constitutional Bodies (CAG, ECI, UPSC/PSC)", bn: "সুপ্রিম কোর্ট, হাইকোর্ট ও সাংবিধানিক সংস্থা" },
          { en: "73rd & 74th Amendments: Panchayati Raj & Municipalities in West Bengal", bn: "৭৩তম ও ৭৪তম সংশোধনী: পঞ্চায়েতি রাজ ও পৌরসভা" },
        ],
      },
    ],
  },
  {
    key: "economy",
    en: "Indian Economy & Planning",
    bn: "ভারতের অর্থনীতি ও পরিকল্পনা",
    chapters: [
      {
        en: "Macroeconomics, Banking & Fiscal Policy",
        bn: "জাতীয় আয়, ব্যাংকিং ও রাজস্ব নীতি",
        subtopics: [
          { en: "National Income, GDP, Inflation & Five-Year Plans / NITI Aayog", bn: "জাতীয় আয়, মুদ্রাস্ফীতি, পঞ্চবার্ষিকী পরিকল্পনা ও নীতি আয়োগ" },
          { en: "Reserve Bank of India (RBI), Monetary Policy & Banking Reforms", bn: "রিজার্ভ ব্যাংক (RBI), আর্থিক নীতি ও ব্যাংকিং সংস্কার" },
          { en: "Union Budget, GST, Poverty Alleviation & Social Welfare Schemes", bn: "কেন্দ্রীয় বাজেট, জিএসটি ও সামাজিক প্রকল্প" },
        ],
      },
    ],
  },
  {
    key: "science",
    en: "General Science & Environment",
    bn: "সাধারণ বিজ্ঞান ও পরিবেশবিদ্যা",
    chapters: [
      {
        en: "Physics & Chemistry in Everyday Life",
        bn: "দৈনন্দিন জীবনে পদার্থবিদ্যা ও রসায়ন",
        subtopics: [
          { en: "Mechanics, Light, Sound, Electricity & SI Units", bn: "বলবিদ্যা, আলো, শব্দ, তড়িৎ ও এককসমূহ" },
          { en: "Acids, Bases, Salts, Metals, Alloys & Everyday Chemistry", bn: "অ্যাসিড, ক্ষার, লবণ, ধাতু-সংকর ও প্রাত্যহিক রসায়ন" },
        ],
      },
      {
        en: "Biology, Human Health & Ecology",
        bn: "জীববিদ্যা, মানবদেহ, পুষ্টি ও পরিবেশ",
        subtopics: [
          { en: "Cell Biology, Human Organ Systems & Blood Groups", bn: "কোষবিদ্যা, মানবদেহের তন্ত্র ও রক্তের গ্রুপ" },
          { en: "Vitamins, Nutrition, Deficiency Diseases & Vaccines", bn: "ভিটামিন, পুষ্টি, অভাবজনিত রোগ ও টিকাকরণ" },
          { en: "Biodiversity, Climate Change & Environmental Conventions", bn: "জীববৈচিত্র্য, জলবায়ু পরিবর্তন ও পরিবেশ সম্মেলন" },
        ],
      },
    ],
  },
  {
    key: "mathematics",
    en: "Arithmetic & Quantitative Aptitude",
    bn: "পাটিগণিত ও পরিমাণগত দক্ষতা (Madhyamik Standard)",
    chapters: [
      {
        en: "Number System, Ratio & Commercial Arithmetic",
        bn: "সংখ্যাতত্ত্ব, অনুপাত ও পাটিগণিত",
        subtopics: [
          { en: "Number System, HCF & LCM, Simplification & Surds", bn: "সংখ্যাতত্ত্ব, ল.সা.গু ও গ.সা.গু এবং সরলীকরণ" },
          { en: "Ratio & Proportion, Partnership, Mixture & Alligation", bn: "অনুপাত ও সমানুপাত, অংশীদারি কারবার ও মিশ্রণ" },
          { en: "Percentage, Profit & Loss, Discount", bn: "শতকরা, লাভ ও ক্ষতি এবং ছাড়" },
          { en: "Simple Interest & Compound Interest", bn: "সরল সুদ ও চক্রবৃদ্ধি সুদ" },
        ],
      },
      {
        en: "Time, Work, Speed & Mensuration",
        bn: "সময়, কার্য, গতিবেগ ও পরিমিতি",
        subtopics: [
          { en: "Time & Work, Pipes & Cisterns", bn: "সময় ও কার্য এবং নল ও চৌবাচ্চা" },
          { en: "Time, Speed & Distance, Trains, Boats & Streams", bn: "সময় ও দূরত্ব, ট্রেন এবং নৌকা ও স্রোত" },
          { en: "Average, Age Problems & 2D/3D Mensuration", bn: "গড়, পিতা-পুত্রের বয়স ও পরিমিতি (ক্ষেত্রফল ও আয়তন)" },
        ],
      },
    ],
  },
  {
    key: "reasoning",
    en: "General Intelligence & Logical Reasoning",
    bn: "সাধারণ বুদ্ধিমত্তা ও রিজনিং (GI & Reasoning)",
    chapters: [
      {
        en: "Verbal & Analytical Reasoning",
        bn: "ভার্বাল ও অ্যানালিটিক্যাল রিজনিং",
        subtopics: [
          { en: "Number & Letter Series, Analogy & Classification", bn: "সংখ্যা ও বর্ণের সিরিজ, সাদৃশ্য ও শ্রেণীবিন্যাস" },
          { en: "Coding-Decoding, Blood Relations & Direction Sense", bn: "কোডিং-ডিকোডিং, রক্তের সম্পর্ক ও দিক নির্ণয়" },
          { en: "Syllogism, Venn Diagrams, Seating Arrangement & Clock/Calendar", bn: "সিলোজিজম, ভেন চিত্র, আসন বিন্যাস ও ঘড়ি/ক্যালেন্ডার" },
        ],
      },
    ],
  },
  {
    key: "english",
    en: "General English",
    bn: "জেনারেল ইংলিশ (General English)",
    chapters: [
      {
        en: "Grammar, Vocabulary & Usage",
        bn: "ইংরেজি ব্যাকরণ ও শব্দভাণ্ডার",
        subtopics: [
          { en: "Synonyms, Antonyms, One-Word Substitution & Idioms/Phrases", bn: "সমার্থক ও বিপরীত শব্দ, এককথায় প্রকাশ ও ইডিয়ম" },
          { en: "Prepositions, Phrasal Verbs, Articles & Error Spotting", bn: "প্রিপোজিশন, ফ্রেজাল ভার্ব ও বাক্য শুদ্ধিকরণ" },
          { en: "Voice Change, Narration Change & Sentence Improvement", bn: "ভয়েস চেঞ্জ, ন্যারেশন চেঞ্জ ও বাক্য রূপান্তর" },
        ],
      },
    ],
  },
  {
    key: "current-affairs-gk",
    en: "Current Affairs & General Awareness (Static GK)",
    bn: "কারেন্ট অ্যাফেয়ার্স ও সাধারণ জ্ঞান (Static GK)",
    chapters: [
      {
        en: "National, International & West Bengal Current Affairs",
        bn: "জাতীয়, আন্তর্জাতিক ও পশ্চিমবঙ্গ কারেন্ট অ্যাফেয়ার্স",
        subtopics: [
          { en: "Awards, Honours, Sports Tournaments & Books/Authors", bn: "পুরস্কার ও সম্মান, খেলাধুলা এবং গ্রন্থ ও লেখক" },
          { en: "West Bengal Government Schemes, Summits & Appointments", bn: "পশ্চিমবঙ্গ সরকারের প্রকল্প, সম্মেলন ও গুরুত্বপূর্ণ নিয়োগ" },
          { en: "Art, Culture, Folk Dances, UNESCO Sites & Important Days", bn: "শিল্প ও সংস্কৃতি, লোকনৃত্য, ইউনেস্কো ঐতিহ্য ও গুরুত্বপূর্ণ দিবস" },
        ],
      },
    ],
  },
];

export const WBPSC_EXAM_PRESETS: Array<ExamConfigInput & { slug: string }> = [
  {
    slug: "wbcs-prelims",
    titleEn: "WBCS Preliminary Examination (Group A/B/C/D)",
    titleBn: "ডব্লিউবিসিএস প্রিলিমিনারি পরীক্ষা (WBCS Prelims)",
    descriptionEn:
      "200-mark Preliminary mock test covering History, INM, Geography, Polity, Economy, Science, GI & English.",
    descriptionBn:
      "ইতিহাস, জাতীয় আন্দোলন, ভূগোল, সংবিধান, অর্থনীতি, বিজ্ঞান, রিজনিং ও ইংরেজির পূর্ণাঙ্গ প্রিলিমিনারি মক টেস্ট।",
    totalQuestions: 200,
    durationMinutes: 150,
    marksPerCorrect: 1,
    negativeMarksPerWrong: 0.33,
    estimatedCutoffMarks: 120,
    isActive: true,
    subjectWeightages: [
      { subjectEn: "General English", subjectBn: "জেনারেল ইংলিশ (General English)", weightageQuestions: 25 },
      { subjectEn: "General Science & Environment", subjectBn: "সাধারণ বিজ্ঞান ও পরিবেশবিদ্যা", weightageQuestions: 25 },
      { subjectEn: "Current Affairs & General Awareness (Static GK)", subjectBn: "কারেন্ট অ্যাফেয়ার্স ও সাধারণ জ্ঞান (Static GK)", weightageQuestions: 25 },
      { subjectEn: "History of India & Indian National Movement", subjectBn: "ভারতের ইতিহাস ও ভারতের জাতীয় আন্দোলন", weightageQuestions: 50 },
      { subjectEn: "Geography of India & West Bengal", subjectBn: "ভারত ও পশ্চিমবঙ্গের ভূগোল", weightageQuestions: 25 },
      { subjectEn: "Indian Polity & Constitution", subjectBn: "ভারতের সংবিধান ও রাষ্ট্রব্যবস্থা", weightageQuestions: 13 },
      { subjectEn: "Indian Economy & Planning", subjectBn: "ভারতের অর্থনীতি ও পরিকল্পনা", weightageQuestions: 12 },
      { subjectEn: "General Intelligence & Logical Reasoning", subjectBn: "সাধারণ বুদ্ধিমত্তা ও রিজনিং (GI & Reasoning)", weightageQuestions: 25 },
    ],
  },
  {
    slug: "wbpsc-clerkship-part1",
    titleEn: "WBPSC Clerkship Examination (Part-I MCQ)",
    titleBn: "ডব্লিউবিপিএসসি ক্লার্কশিপ পরীক্ষা (Part-I MCQ)",
    descriptionEn:
      "100-mark objective test on General Studies (40), Arithmetic (30), and General English (30).",
    descriptionBn:
      "জেনারেল স্টাডিজ (৪০), মাধ্যমিক স্তরের পাটিগণিত (৩০) এবং জেনারেল ইংলিশ (৩০)-এর অবজেক্টিভ মক টেস্ট।",
    totalQuestions: 100,
    durationMinutes: 90,
    marksPerCorrect: 1,
    negativeMarksPerWrong: 0.25,
    estimatedCutoffMarks: 65,
    isActive: true,
    subjectWeightages: [
      { subjectEn: "Current Affairs & General Awareness (Static GK)", subjectBn: "কারেন্ট অ্যাফেয়ার্স ও সাধারণ জ্ঞান (Static GK)", weightageQuestions: 15 },
      { subjectEn: "History of India & Indian National Movement", subjectBn: "ভারতের ইতিহাস ও ভারতের জাতীয় আন্দোলন", weightageQuestions: 10 },
      { subjectEn: "Geography of India & West Bengal", subjectBn: "ভারত ও পশ্চিমবঙ্গের ভূগোল", weightageQuestions: 8 },
      { subjectEn: "Indian Polity & Constitution", subjectBn: "ভারতের সংবিধান ও রাষ্ট্রব্যবস্থা", weightageQuestions: 7 },
      { subjectEn: "Arithmetic & Quantitative Aptitude", subjectBn: "পাটিগণিত ও পরিমাণগত দক্ষতা (Madhyamik Standard)", weightageQuestions: 30 },
      { subjectEn: "General English", subjectBn: "জেনারেল ইংলিশ (General English)", weightageQuestions: 30 },
    ],
  },
  {
    slug: "wbpsc-food-si",
    titleEn: "WBPSC Food & Supplies Sub-Inspector (Food SI)",
    titleBn: "খাদ্য দপ্তরের সাব-ইন্সপেক্টর পরীক্ষা (Food SI)",
    descriptionEn: "General Studies (50 Marks) + Arithmetic (50 Marks) mock test.",
    descriptionBn: "সাধারণ জ্ঞান (৫০) ও পাটিগণিত (৫০)-এর নির্ধারিত সিলেবাস অনুযায়ী ফুড এসআই মক টেস্ট।",
    totalQuestions: 100,
    durationMinutes: 90,
    marksPerCorrect: 1,
    negativeMarksPerWrong: 0.25,
    estimatedCutoffMarks: 75,
    isActive: true,
    subjectWeightages: [
      { subjectEn: "Current Affairs & General Awareness (Static GK)", subjectBn: "কারেন্ট অ্যাফেয়ার্স ও সাধারণ জ্ঞান (Static GK)", weightageQuestions: 15 },
      { subjectEn: "History of India & Indian National Movement", subjectBn: "ভারতের ইতিহাস ও ভারতের জাতীয় আন্দোলন", weightageQuestions: 10 },
      { subjectEn: "Geography of India & West Bengal", subjectBn: "ভারত ও পশ্চিমবঙ্গের ভূগোল", weightageQuestions: 10 },
      { subjectEn: "General Science & Environment", subjectBn: "সাধারণ বিজ্ঞান ও পরিবেশবিদ্যা", weightageQuestions: 15 },
      { subjectEn: "Arithmetic & Quantitative Aptitude", subjectBn: "পাটিগণিত ও পরিমাণগত দক্ষতা (Madhyamik Standard)", weightageQuestions: 50 },
    ],
  },
  {
    slug: "wbpsc-miscellaneous",
    titleEn: "WBPSC Miscellaneous Services Preliminary Exam",
    titleBn: "ডব্লিউবিপিএসসি মিসলেনিয়াস প্রিলিমিনারি পরীক্ষা",
    descriptionEn: "General Studies (75 Qs) + Arithmetic (25 Qs) preliminary test.",
    descriptionBn: "জেনারেল স্টাডিজ (৭৫টি প্রশ্ন) ও পাটিগণিত (২৫টি প্রশ্ন)-এর প্রিলিমিনারি মক টেস্ট।",
    totalQuestions: 100,
    durationMinutes: 90,
    marksPerCorrect: 2,
    negativeMarksPerWrong: 0.5,
    estimatedCutoffMarks: 110,
    isActive: true,
    subjectWeightages: [
      { subjectEn: "Current Affairs & General Awareness (Static GK)", subjectBn: "কারেন্ট অ্যাফেয়ার্স ও সাধারণ জ্ঞান (Static GK)", weightageQuestions: 25 },
      { subjectEn: "History of India & Indian National Movement", subjectBn: "ভারতের ইতিহাস ও ভারতের জাতীয় আন্দোলন", weightageQuestions: 15 },
      { subjectEn: "Geography of India & West Bengal", subjectBn: "ভারত ও পশ্চিমবঙ্গের ভূগোল", weightageQuestions: 10 },
      { subjectEn: "Indian Polity & Constitution", subjectBn: "ভারতের সংবিধান ও রাষ্ট্রব্যবস্থা", weightageQuestions: 10 },
      { subjectEn: "General Science & Environment", subjectBn: "সাধারণ বিজ্ঞান ও পরিবেশবিদ্যা", weightageQuestions: 15 },
      { subjectEn: "Arithmetic & Quantitative Aptitude", subjectBn: "পাটিগণিত ও পরিমাণগত দক্ষতা (Madhyamik Standard)", weightageQuestions: 25 },
    ],
  },
  {
    slug: "wbp-constable-si",
    titleEn: "WBP / KP Constable & Sub-Inspector Preliminary Exam",
    titleBn: "পশ্চিমবঙ্গ ও কলকাতা পুলিশ কনস্টেবল ও এসআই পরীক্ষা",
    descriptionEn: "General Awareness, Elementary Mathematics, and Logical Reasoning test.",
    descriptionBn: "সাধারণ জ্ঞান, মাধ্যমিক গণিত ও রিজনিং-এর পূর্ণাঙ্গ পুলিশ নিয়োগ মক টেস্ট।",
    totalQuestions: 100,
    durationMinutes: 60,
    marksPerCorrect: 1,
    negativeMarksPerWrong: 0.25,
    estimatedCutoffMarks: 55,
    isActive: true,
    subjectWeightages: [
      { subjectEn: "Current Affairs & General Awareness (Static GK)", subjectBn: "কারেন্ট অ্যাফেয়ার্স ও সাধারণ জ্ঞান (Static GK)", weightageQuestions: 40 },
      { subjectEn: "Arithmetic & Quantitative Aptitude", subjectBn: "পাটিগণিত ও পরিমাণগত দক্ষতা (Madhyamik Standard)", weightageQuestions: 30 },
      { subjectEn: "General Intelligence & Logical Reasoning", subjectBn: "সাধারণ বুদ্ধিমত্তা ও রিজনিং (GI & Reasoning)", weightageQuestions: 30 },
    ],
  },
];

// ─── 1-Click AI Full Question Set Generation (Subject-Wise) ──────────────────

export const SubjectGenerationAllocationSchema = z.object({
  subjectId: z.string().uuid(),
  count: z.coerce.number().int().min(1).max(200),
});
export type SubjectGenerationAllocation = z.infer<typeof SubjectGenerationAllocationSchema>;

export const GenerateFullQuestionSetInputSchema = z.object({
  examSlug: z.string().trim().min(1),
  subjects: z.array(SubjectGenerationAllocationSchema).min(1).max(30),
  difficulty: z.enum(["easy", "moderate", "hard", "mixed"]).default("mixed"),
  /** When true, immediately approves & inserts generated questions into the live `questions` table */
  insertDirectlyToBank: z.boolean().default(true),
  /** Optional Test Series ID to also assign the generated questions into (and sync subject blueprint if needed) */
  seriesId: z.string().uuid().nullable().optional(),
  /** When true and seriesId is given, updates the series' blueprint subject counts to accommodate the generated set */
  syncSeriesBlueprint: z.boolean().default(true),
});
export type GenerateFullQuestionSetInput = z.infer<typeof GenerateFullQuestionSetInputSchema>;

export interface GenerateFullQuestionSetSubjectSummary {
  subjectId: string;
  subjectNameEn: string;
  requested: number;
  generated: number;
  insertedLive: number;
  assignedToSeries: number;
}

export interface GenerateFullQuestionSetResult {
  batchId: string;
  modelUsed: string;
  totalRequested: number;
  totalGenerated: number;
  totalInsertedLive: number;
  totalAssignedToSeries: number;
  totalPendingReview: number;
  subjectSummaries: GenerateFullQuestionSetSubjectSummary[];
}



export interface IngestionBatchSummary {
  batchId: string;
  source: string;
  fileName: string | null;
  createdAt: string;
  total: number;
  pendingAi: number;
  pendingReview: number;
  inserted: number;
  rejected: number;
  failed: number;
}

export interface IngestionJobDto {
  id: string;
  batchId: string;
  source: string;
  status: IngestionStatus;
  rowNumber: number | null;
  draft: StagedQuestionDraft | null;
  rawData: unknown;
  aiConfidenceScore: number | null;
  reviewNotes: string | null;
  errorMessage: string | null;
  insertedQuestionId: string | null;
  /** Test series this row was generated for (reserves a vacancy) */
  targetSeriesId: string | null;
  /** Most similar existing bank question (warning only), 0–1 */
  nearDuplicateQuestionId: string | null;
  nearDuplicateScore: number | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** Filters shared by the review list and "select all matching". */
export const JobFilterSchema = z.object({
  batchId: z.string().max(80).optional(),
  examSlug: z.string().max(80).optional(),
  status: z.union([IngestionStatusSchema, z.literal("all")]).default("all"),
  subjectId: z.string().uuid().optional(),
  chapterId: z.string().uuid().optional(),
  subtopicId: z.string().uuid().optional(),
  difficulty: DifficultyLevelSchema.optional(),
  source: z.enum(["csv_upload", "json_upload", "pdf_extract", "ai_generated", "manual"]).optional(),
  targetSeriesId: z.string().uuid().optional(),
  createdFrom: z.string().date().optional(),
  createdTo: z.string().date().optional(),
});
export type JobFilter = z.infer<typeof JobFilterSchema>;

/**
 * Approving an AI-generated question IS the human answer check: the reviewer
 * saw the full question and pressed Approve, so it is recorded as verified.
 */
export const ApproveJobsBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  /** Also add each approved row to its target series (vacancies re-checked) */
  assignToTargetSeries: z.boolean().default(false),
});
export type ApproveJobsBody = z.infer<typeof ApproveJobsBodySchema>;

export type ApproveItemStatus =
  | "inserted"
  | "invalid"
  | "duplicate"
  | "not_pending"
  | "inserted_not_assigned";

export interface ApproveJobsResult {
  inserted: number;
  assigned: number;
  notPendingReview: number;
  invalid: Array<{ id: string; message: string }>;
  duplicates: Array<{ id: string; message: string }>;
  /** One entry per requested id, so the UI can show exactly what happened */
  results: Array<{ id: string; status: ApproveItemStatus; message?: string; questionId?: string }>;
}

export const RejectJobsBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  reviewNotes: z.string().trim().max(2000).optional(),
});

export interface RejectJobsResult {
  rejected: number;
  results: Array<{ id: string; status: "rejected" | "not_rejectable"; message?: string }>;
}

// ============================================================================
// 5b. Exam Type → Test Series (blueprint + selected questions) & the Question Bank
// ============================================================================

export const SeriesKindSchema = z.enum(["previous_year", "mock_test", "practice", "custom"]);
export type SeriesKind = z.infer<typeof SeriesKindSchema>;

export const SERIES_KIND_LABELS: Record<SeriesKind, string> = {
  previous_year: "Previous Year Papers",
  mock_test: "Mock Test Series",
  practice: "Subject-wise Practice",
  custom: "Other",
};

export const PublishStatusSchema = z.enum(["draft", "published", "archived"]);
export type PublishStatus = z.infer<typeof PublishStatusSchema>;

const SlugInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, digits and hyphens")
  .max(120);

export const SeriesInputSchema = z.object({
  slug: SlugInputSchema.optional(),
  nameEn: z.string().trim().min(2, "English name is required").max(200),
  nameBn: z.string().trim().max(200).default(""),
  descriptionEn: z.string().trim().max(1000).default(""),
  descriptionBn: z.string().trim().max(1000).default(""),
  kind: SeriesKindSchema,
  status: PublishStatusSchema.default("draft"),
  displayOrder: z.coerce.number().int().min(0).max(10_000).default(1),
  // Marking scheme of the test
  durationMinutes: z.coerce.number().int().min(1).max(600),
  marksPerCorrect: z.coerce.number().positive().max(10),
  negativeMarksPerWrong: z.coerce.number().min(0).max(5),
  estimatedCutoffMarks: z.coerce.number().min(0).max(1000).default(0),
  /**
   * On create: the subjects in this series and their question counts
   * (e.g. GS 40 · English 30 · Maths 30). Topic breakdown is set afterwards
   * via PUT /series/:id/blueprint.
   */
  subjectTargets: z
    .array(z.object({ subjectId: z.string().uuid(), targetCount: z.coerce.number().int().min(1).max(300) }))
    .max(50)
    .optional(),
});
export type SeriesInput = z.infer<typeof SeriesInputSchema>;

export const RosterSlotInputSchema = z
  .object({
    subjectId: z.string().uuid(),
    chapterId: z.string().uuid().nullable().default(null),
    subtopicId: z.string().uuid().nullable().default(null),
    targetCount: z.coerce.number().int().min(0).max(300),
  })
  .refine((s) => !s.subtopicId || !!s.chapterId, {
    path: ["chapterId"],
    message: "A subtopic slot needs its chapter",
  });
export type RosterSlotInput = z.infer<typeof RosterSlotInputSchema>;

export const RosterInputSchema = z.object({
  slots: z.array(RosterSlotInputSchema).max(400),
});

export type RosterLevel = "subject" | "chapter" | "subtopic";

export interface BlueprintSlotDto {
  id: string;
  level: RosterLevel;
  subjectId: string;
  chapterId: string | null;
  subtopicId: string | null;
  label: string;
  parentSlotId: string | null;
  targetCount: number;
  /** Seats not earmarked for a topic inside this slot */
  freeTarget: number;
}

/** Questions available for a syllabus node in the exam's own bank. */
export interface BankSupplyDto {
  /** Approved, active questions */
  live: number;
  /** Drafts waiting in the review queue (pending_ai / pending_review) */
  pending: number;
}

/** A series' exam pattern: subject counts plus optional topic breakdown. */
export interface BlueprintDto {
  seriesId: string;
  totalQuestions: number;
  slots: BlueprintSlotDto[];
  /**
   * Supply per node of the exam syllabus, keyed "subjectId|chapterId|subtopicId"
   * with empty parts for broader levels (e.g. "s1||" = whole subject)
   */
  bank: Record<string, BankSupplyDto>;
}

export interface SeriesDto {
  id: string;
  examId: string;
  slug: string;
  name: BilingualText;
  description: BilingualText;
  kind: SeriesKind;
  status: PublishStatus;
  displayOrder: number;
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarksPerWrong: number;
  estimatedCutoffMarks: number;
  /** Σ subject counts of the blueprint = length of the test */
  totalQuestions: number;
  /** Subject counts of the blueprint, e.g. [{ GS, 40 }, { English, 30 }] */
  subjects: Array<{
    subjectId: string;
    label: string;
    /** Questions of this subject in the test */
    targetCount: number;
    /** Approved questions of this subject in the exam's bank */
    inBank: number;
    /** Questions of this subject selected for the test */
    selected: number;
  }>;
  selectedCount: number;
  /** Pending AI drafts generated for this series (they reserve vacancies) */
  reservedCount: number;
  /** selectedCount / totalQuestions, 0–100 */
  completionPct: number;
  attemptCount: number;
  updatedAt: string;
}

export interface ExamOverviewDto {
  id: string;
  slug: string;
  title: BilingualText;
  isActive: boolean;
  seriesCount: number;
  publishedSeriesCount: number;
  targetQuestions: number;
  assignedQuestions: number;
  bankQuestionCount: number;
}

export interface RosterSlotDto {
  id: string;
  level: RosterLevel;
  subjectId: string;
  chapterId: string | null;
  subtopicId: string | null;
  label: string;
  /** Nearest slot this one is a sub-limit of */
  parentSlotId: string | null;
  targetCount: number;
  /** Assigned questions anywhere inside this slot (children included) */
  assignedCount: number;
  /** Pending AI rows for this series inside this slot */
  reservedCount: number;
  /** target − Σ child targets: seats not earmarked for a child slot */
  freeTarget: number;
  /** Seats an eligible question landing directly in this slot can still take */
  vacancies: number;
  isFull: boolean;
}

export interface AssignedQuestionDto {
  assignmentId: string;
  questionId: string;
  position: number;
  subjectId: string;
  chapterId: string;
  subtopicId: string;
  /** Deepest roster slot the assignment counts toward */
  slotId: string | null;
  pathLabel: string;
  stem: BilingualText;
  options: QuestionOptions;
  correctOption: OptionKey;
  explanation: BilingualText;
  difficulty: DifficultyLevel;
  source: QuestionSource;
  previousYearTag: string | null;
  /** Question's origin exam differs from the series' exam */
  crossExam: boolean;
}

export interface RosterDto {
  series: SeriesDto;
  slots: RosterSlotDto[];
  assigned: AssignedQuestionDto[];
  rosterTotal: number;
  assignedTotal: number;
  completionPct: number;
  /** Config problems (e.g. no blueprint yet) */
  warnings: string[];
}

export interface VacancyLimitDto {
  slotId: string;
  label: string;
  target: number;
  used: number;
  remaining: number;
  /** Why this limit binds, when "is full" alone would mislead (seats given to topics) */
  note?: string;
}

/** How many more questions a syllabus node can take in a series. */
export interface VacancyDto {
  seriesId: string;
  eligible: boolean;
  /** Seats open for manual assignment (assigned questions only) */
  assignable: number;
  /** Seats open for new AI drafts (assigned + pending AI reservations) */
  generatable: number;
  /** Every roster slot that applies, outermost first */
  limits: VacancyLimitDto[];
  /** The slot that decides the number */
  bindingSlotId: string | null;
  message: string;
}

export const AssignQuestionsBodySchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1).max(300),
  /**
   * Classify the questions under this subtopic of the series' exam. Needed for
   * questions from another exam whose syllabus path doesn't exist here.
   */
  subtopicId: z.string().uuid().nullable().optional(),
});

export const ReplaceAssignmentBodySchema = z.object({
  removeQuestionId: z.string().uuid(),
  addQuestionId: z.string().uuid(),
  subtopicId: z.string().uuid().nullable().optional(),
});

export interface AssignQuestionsResult {
  assigned: Array<{ questionId: string; assignmentId: string }>;
  failed: Array<{ questionId: string; reason: string }>;
  /** Labels of slots that became full with this request */
  slotsFilled: string[];
  roster: RosterDto;
}

export const BankQueryClientSchema = z.object({
  /** Whose syllabus the subject/chapter/subtopic filters refer to */
  examId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  chapterId: z.string().uuid().optional(),
  subtopicId: z.string().uuid().optional(),
  difficulty: DifficultyLevelSchema.optional(),
  source: QuestionSourceSchema.optional(),
  q: z.string().trim().max(200).optional(),
  /** Annotate eligibility / "already selected" for this series */
  seriesId: z.string().uuid().optional(),
  /**
   * With seriesId: only questions that land in this subject of the series'
   * exam (works across exams — another exam's questions are mapped first)
   */
  targetSubjectId: z.string().uuid().optional(),
  availability: z.enum(["all", "eligible", "unassigned"]).default("all"),
  // Query strings arrive as "true"/"false" (z.coerce.boolean would read "false" as true)
  includeRetired: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type BankQuery = z.infer<typeof BankQueryClientSchema>;

export interface BankQuestionDto {
  id: string;
  examId: string;
  examSlug: string;
  subjectId: string;
  chapterId: string;
  subtopicId: string;
  pathLabel: string;
  stem: BilingualText;
  options: QuestionOptions;
  correctOption: OptionKey;
  explanation: BilingualText;
  difficulty: DifficultyLevel;
  source: QuestionSource;
  previousYearTag: string | null;
  isActive: boolean;
  createdAt: string;
  /** Number of test series (any exam) using this question */
  usedInSeries: number;
  /** Present when the query had a seriesId */
  inSeries?: boolean;
  eligibility?: { ok: boolean; reason: string; subtopicId: string | null };
}

/** Student-facing: a published (complete) test series. */
export interface StudentSeriesDto {
  id: string;
  name: BilingualText;
  description: BilingualText;
  kind: SeriesKind;
  totalQuestions: number;
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarksPerWrong: number;
  estimatedCutoffMarks: number;
}

// ─── Admin: Export & Import Whole Question Set for a Test Series ─────────────

export interface SeriesExportQuestionDto {
  questionNumber: number;
  questionId: string;
  subjectId: string;
  subjectName: BilingualText;
  chapterId: string;
  chapterName: BilingualText;
  subtopicId: string;
  subtopicName: BilingualText;
  stem: BilingualText;
  options: QuestionOptions;
  correctOption: OptionKey;
  explanation: BilingualText;
  difficulty: DifficultyLevel;
  source: QuestionSource;
  previousYearTag: string | null;
  marksPositive: number;
  marksNegative: number;
}

export interface SeriesExportDto {
  series: SeriesDto;
  exam: {
    id: string;
    slug: string;
    title: BilingualText;
    description: BilingualText;
  };
  exportedAt: string;
  questions: SeriesExportQuestionDto[];
}

export const SeriesImportSetBodySchema = z.object({
  format: z.enum(["csv", "json", "media"]),
  fileName: z.string().max(240).optional(),
  /** Raw text content when format is "csv" or "json" */
  content: z.string().max(10_000_000).optional(),
  /** MIME type & base64 data when format is "media" (PDF or Image question paper) */
  mimeType: z.string().max(120).optional(),
  base64Data: z.string().max(25_000_000).optional(),
  source: QuestionSourceSchema.default("educator"),
  pyqYear: z.coerce.number().int().min(1990).max(2100).nullable().optional(),
  /** Automatically update/expand the draft series' subject counts to fit the imported question set */
  autoUpdateBlueprint: z.boolean().default(true),
});
export type SeriesImportSetBody = z.infer<typeof SeriesImportSetBodySchema>;

export interface SeriesImportSetResult {
  totalParsed: number;
  insertedToBank: number;
  reusedFromBank: number;
  assignedToSeries: number;
  categoriesCreated: number;
  blueprintUpdated: boolean;
  errors: Array<{ rowNumber: number; message: string }>;
  roster: RosterDto;
}

// ============================================================================
// 6. Student-facing API DTOs (mock tests, history, review, weakness, AI tutor)
// ============================================================================

export interface StudentExamDto {
  id: string;
  slug: string;
  titleEn: string;
  titleBn: string;
  descriptionEn: string;
  descriptionBn: string;
  totalQuestions: number;
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarksPerWrong: number;
  estimatedCutoffMarks: number;
  isActive: boolean;
  /** Active questions available for this exam */
  questionCount: number;
  /** Subjects in this exam's syllabus */
  subjectCount: number;
  /** Published test series per kind, e.g. { mock_test: 5, previous_year: 15 } */
  seriesCounts: Partial<Record<SeriesKind, number>>;
}

export interface AttemptSummaryDto {
  id: string;
  examId: string;
  examSlug: string;
  examTitleEn: string;
  examTitleBn: string;
  isRemedial: boolean;
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
  submittedAt: string | null;
  /** Set when a test series (not a random/remedial mock) was taken */
  series?: { id: string; name: BilingualText } | null;
  /** Present in admin listings */
  userEmail?: string;
  userName?: string;
}

export interface AttemptReviewItemDto {
  questionId: string;
  stem: BilingualText;
  options: QuestionOptions;
  correctOption: OptionKey;
  selectedOption: OptionKey | null;
  marksAwarded: number;
  timeSpentSeconds: number;
  explanation: BilingualText;
  subtopicName: BilingualText;
}

export interface AttemptReviewDto {
  attempt: AttemptSummaryDto;
  items: AttemptReviewItemDto[];
}

export interface MasteryDto {
  id: string;
  examId: string;
  examSlug: string;
  subjectName: BilingualText;
  subtopicId: string;
  subtopicSlug: string;
  subtopicName: BilingualText;
  totalEncountered: number;
  totalCorrect: number;
  totalIncorrect: number;
  accuracyPercentage: number;
  avgTimeSeconds: number;
  masteryBand: MasteryBand;
  weaknessPriorityScore: number;
}

export interface AiNoteDto {
  examSlug: string;
  topicSlug: string;
  language: SupportedLanguage;
  topicTitle: BilingualText;
  contentMarkdown: string;
  mnemonics: string[];
  modelUsed: string;
  /** true = served from the shared cache (no AI cost, no quota used) */
  cached: boolean;
}

export interface CachedNoteRefDto {
  examSlug: string;
  topicSlug: string;
  language: SupportedLanguage;
  modelUsed: string;
  hitCount: number;
  updatedAt: string;
}
