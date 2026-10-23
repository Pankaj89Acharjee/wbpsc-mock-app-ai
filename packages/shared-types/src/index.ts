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

export const ExamSlugSchema = z.enum([
  "wbcs-prelims",
  "wbcs-mains",
  "wbpsc-clerkship-part1",
  "wbpsc-clerkship-part2",
  "wbpsc-miscellaneous",
  "wbpsc-food-si",
  "wbp-constable-si",
]);
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

export const EXAM_SLUG_LABELS: Record<ExamSlug, string> = {
  "wbcs-prelims": "WBCS Prelims",
  "wbcs-mains": "WBCS Mains",
  "wbpsc-clerkship-part1": "WBPSC Clerkship Part-I",
  "wbpsc-clerkship-part2": "WBPSC Clerkship Part-II",
  "wbpsc-miscellaneous": "WBPSC Miscellaneous",
  "wbpsc-food-si": "WBPSC Food SI",
  "wbp-constable-si": "WBP Constable / SI",
};

/** Column order of the downloadable CSV template (one MCQ per row). */
export const BULK_IMPORT_CSV_COLUMNS = [
  "exam_slug",
  "subject_slug",
  "chapter_slug",
  "subtopic_slug",
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
  "pyq_exam_slug",
  "pyq_year",
  "answer_key_verified",
] as const;
export type BulkImportCsvColumn = (typeof BULK_IMPORT_CSV_COLUMNS)[number];

/** Columns that must exist in the header row (Bengali & explanation may be left blank for AI enrichment). */
export const BULK_IMPORT_REQUIRED_COLUMNS: readonly BulkImportCsvColumn[] = [
  "exam_slug",
  "subject_slug",
  "chapter_slug",
  "subtopic_slug",
  "stem_en",
  "option_a_en",
  "option_b_en",
  "option_c_en",
  "option_d_en",
  "correct_option",
];

export const BULK_IMPORT_MAX_ROWS = 2000;

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
 * Only English text is mandatory — blank Bengali / explanation cells are
 * filled later by api-ai enrichment or by the educator in the Review screen.
 */
export const BulkQuestionRowSchema = z
  .object({
    exam_slug: z.preprocess(lowerCell, ExamSlugSchema),
    subject_slug: requiredCell("subject_slug"),
    chapter_slug: requiredCell("chapter_slug"),
    subtopic_slug: requiredCell("subtopic_slug"),
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
    pyq_exam_slug: z.preprocess(lowerCell, ExamSlugSchema.optional()),
    pyq_year: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1990).max(2100).optional()
    ),
    answer_key_verified: yesNoCell,
  })
  .superRefine((row, ctx) => {
    if (row.source === "pyq" && (!row.pyq_exam_slug || !row.pyq_year)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pyq_year"],
        message: "PYQ rows need both pyq_exam_slug and pyq_year",
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
 * Lenient: Bengali / explanation may still be empty while `pending_ai`.
 */
export const StagedQuestionDraftSchema = z.object({
  examSlug: ExamSlugSchema,
  subjectSlug: z.string().trim().min(1),
  chapterSlug: z.string().trim().min(1),
  subtopicSlug: z.string().trim().min(1),
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
  pyqExamSlug: ExamSlugSchema.nullable(),
  pyqYear: z.number().int().min(1990).max(2100).nullable(),
  answerKeyVerified: z.boolean(),
});
export type StagedQuestionDraft = z.infer<typeof StagedQuestionDraftSchema>;

/** Strict gate applied when the educator approves a staged question for the live bank. */
export const ApprovableQuestionSchema = StagedQuestionDraftSchema.extend({
  stem: BilingualTextSchema,
  options: QuestionOptionsSchema,
  explanation: BilingualTextSchema,
}).superRefine((q, ctx) => {
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
    examSlug: row.exam_slug,
    subjectSlug: row.subject_slug,
    chapterSlug: row.chapter_slug,
    subtopicSlug: row.subtopic_slug,
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
    pyqExamSlug: row.pyq_exam_slug ?? null,
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

export function pyqLabel(examSlug: ExamSlug | null, year: number | null): string | null {
  return examSlug && year ? `${EXAM_SLUG_LABELS[examSlug]} ${year}` : null;
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

export function csvTableToRecords(table: string[][]): {
  records: CsvRecord[];
  missingColumns: string[];
} {
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const missingColumns = BULK_IMPORT_REQUIRED_COLUMNS.filter((c) => !header.includes(c));
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
    exam_slug: "wbcs-prelims",
    subject_slug: "polity-constitution",
    chapter_slug: "fundamental-rights-duties",
    subtopic_slug: "fundamental-rights-articles",
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
    pyq_exam_slug: "wbcs-prelims",
    pyq_year: "2022",
    answer_key_verified: "yes",
  },
  {
    exam_slug: "wbcs-prelims",
    subject_slug: "polity-constitution",
    chapter_slug: "fundamental-rights-duties",
    subtopic_slug: "fundamental-rights-articles",
    stem_en:
      "English-only row: leave the _bn and explanation cells blank and they are filled before review.",
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
  errors: Array<{ rowNumber: number; message: string }>;
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
  createdAt: string;
  reviewedAt: string | null;
}
