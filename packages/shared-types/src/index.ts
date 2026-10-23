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
