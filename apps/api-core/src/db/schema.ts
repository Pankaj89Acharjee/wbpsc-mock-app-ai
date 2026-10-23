import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type {
  BilingualText,
  QuestionOptions,
  OptionKey,
} from "../../../../packages/shared-types/src/index";

// ============================================================================
// 1. PostgreSQL Enums
// ============================================================================

export const userRoleEnum = pgEnum("user_role", [
  "aspirant",
  "educator",
  "admin",
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "free",
  "pro_prelims",
  "wbcs_executive_pass",
]);

export const examSlugEnum = pgEnum("exam_slug", [
  "wbcs-prelims",
  "wbcs-mains",
  "wbpsc-clerkship-part1",
  "wbpsc-clerkship-part2",
  "wbpsc-miscellaneous",
  "wbpsc-food-si",
  "wbp-constable-si",
]);

export const difficultyEnum = pgEnum("difficulty_level", [
  "easy",
  "moderate",
  "hard",
]);

export const optionKeyEnum = pgEnum("option_key", ["A", "B", "C", "D"]);

export const attemptStatusEnum = pgEnum("attempt_status", [
  "in_progress",
  "submitted",
  "abandoned",
]);

export const questionAttemptStateEnum = pgEnum("question_attempt_state", [
  "answered",
  "marked_for_review",
  "answered_and_marked",
  "unanswered",
  "not_visited",
]);

export const masteryBandEnum = pgEnum("mastery_band", [
  "critical_weakness", // Accuracy < 50%
  "needs_revision",    // Accuracy 50% - 69.99%
  "proficient",        // Accuracy 70% - 84.99%
  "exam_ready",        // Accuracy >= 85%
]);

export const ingestionSourceEnum = pgEnum("ingestion_source", [
  "csv_upload",    // Pipeline 1: Educator uploaded a CSV/Excel file
  "json_upload",   // Pipeline 1: Educator uploaded a JSON file
  "pdf_extract",   // Pipeline 2: PYQ PDF/image extracted via Gemini Vision
  "ai_generated",  // Pipeline 3: AI PYQ-clone generator
  "manual",        // Direct entry via Admin Console form
]);

export const ingestionStatusEnum = pgEnum("ingestion_status", [
  "pending_ai",      // Submitted to api-ai for enrichment/extraction
  "pending_review",  // AI enrichment done — awaiting educator approval
  "approved",        // Educator approved — queued for bulk insert
  "rejected",        // Educator rejected the question
  "inserted",        // Successfully saved to questions table
  "failed",          // Error during AI processing or DB insert
]);

export const questionSourceEnum = pgEnum("question_source", [
  "pyq",           // Real previous-year question (WBCS / Clerkship / Food SI papers)
  "educator",      // Framed by an educator / admin
  "ai_generated",  // Pipeline 3 PYQ-clone generator (always educator-reviewed)
]);

// ============================================================================
// 2. Users Table
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    passwordHash: text("password_hash").notNull(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    preferredLanguage: varchar("preferred_language", { length: 2 })
      .$type<"en" | "bn">()
      .notNull()
      .default("bn"),
    targetExamSlug: examSlugEnum("target_exam_slug")
      .notNull()
      .default("wbcs-prelims"),
    role: userRoleEnum("role").notNull().default("aspirant"),
    subscriptionTier: subscriptionTierEnum("subscription_tier")
      .notNull()
      .default("free"),
    razorpayCustomerId: varchar("razorpay_customer_id", { length: 128 }),
    subscriptionExpiresAt: timestamp("subscription_expires_at", {
      withTimezone: true,
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique_idx").on(table.email),
    uniqueIndex("users_phone_unique_idx").on(table.phone),
    index("users_target_exam_idx").on(table.targetExamSlug),
  ]
);

// ============================================================================
// 3. Exams Table (WBPSC Clerkship, Food SI, WBCS, Miscellaneous)
// ============================================================================

export const exams = pgTable(
  "exams",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    slug: examSlugEnum("slug").notNull(),
    title: jsonb("title").$type<BilingualText>().notNull(),
    description: jsonb("description").$type<BilingualText>().notNull(),
    totalQuestions: integer("total_questions").notNull().default(100),
    durationMinutes: integer("duration_minutes").notNull().default(90),
    marksPerCorrect: numeric("marks_per_correct", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("1.00"),
    /**
     * Configurable negative marking per wrong answer:
     * e.g., "0.25" (1/4th for WBPSC Clerkship/Food SI) or "0.33" (1/3rd for WBCS Prelims)
     */
    negativeMarksPerWrong: numeric("negative_marks_per_wrong", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0.25"),
    estimatedCutoffMarks: numeric("estimated_cutoff_marks", {
      precision: 6,
      scale: 2,
    })
      .notNull()
      .default("65.00"),
    targetTimePerQuestionSec: integer("target_time_per_question_sec")
      .notNull()
      .default(45),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("exams_slug_unique_idx").on(table.slug)]
);

// ============================================================================
// 4. Subjects, Chapters & Subtopics Hierarchy
// ============================================================================

export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: jsonb("name").$type<BilingualText>().notNull(),
    weightageQuestions: integer("weightage_questions").notNull().default(25),
    displayOrder: integer("display_order").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("subjects_exam_slug_unique_idx").on(table.examId, table.slug),
    index("subjects_exam_id_idx").on(table.examId),
  ]
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 140 }).notNull(),
    name: jsonb("name").$type<BilingualText>().notNull(),
    displayOrder: integer("display_order").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chapters_subject_slug_unique_idx").on(
      table.subjectId,
      table.slug
    ),
    index("chapters_subject_id_idx").on(table.subjectId),
  ]
);

export const subtopics = pgTable(
  "subtopics",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 160 }).notNull(),
    name: jsonb("name").$type<BilingualText>().notNull(),
    /**
     * Benchmark time (seconds) beyond which an answer on this subtopic is flagged as "high time taken"
     */
    expectedTimeSeconds: integer("expected_time_seconds").notNull().default(45),
    isHighYieldWbpsc: boolean("is_high_yield_wbpsc").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("subtopics_chapter_slug_unique_idx").on(
      table.chapterId,
      table.slug
    ),
    index("subtopics_subject_id_idx").on(table.subjectId),
    index("subtopics_slug_idx").on(table.slug),
  ]
);

// ============================================================================
// 5. Questions Table (Bilingual JSONB for stem, options, explanation)
// ============================================================================

export const questions = pgTable(
  "questions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    examSlug: examSlugEnum("exam_slug").notNull(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "restrict" }),
    subtopicId: uuid("subtopic_id")
      .notNull()
      .references(() => subtopics.id, { onDelete: "restrict" }),
    /**
     * Bilingual Question Stem: {"en": "...", "bn": "..."}
     */
    stem: jsonb("stem").$type<BilingualText>().notNull(),
    /**
     * Bilingual Options A/B/C/D: {"A": {"en": "...", "bn": "..."}, ...}
     */
    options: jsonb("options").$type<QuestionOptions>().notNull(),
    correctOption: optionKeyEnum("correct_option").$type<OptionKey>().notNull(),
    /**
     * Bilingual Detailed Solution: {"en": "...", "bn": "..."}
     */
    explanation: jsonb("explanation").$type<BilingualText>().notNull(),
    difficulty: difficultyEnum("difficulty").notNull().default("moderate"),
    marksPositive: numeric("marks_positive", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("1.00"),
    marksNegative: numeric("marks_negative", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0.25"),
    /** Display label, e.g. "WBCS Prelims 2022" (derived from pyqExamSlug + pyqYear for new rows) */
    previousYearTag: varchar("previous_year_tag", { length: 100 }),
    source: questionSourceEnum("source").notNull().default("educator"),
    // Structured PYQ metadata so a full year paper can be rebuilt as a test
    pyqExamSlug: examSlugEnum("pyq_exam_slug"),
    pyqYear: integer("pyq_year"),
    /** PYQ answers must match the official WBPSC answer key before going live */
    answerKeyVerified: boolean("answer_key_verified").notNull().default(false),
    /**
     * SHA-256 of normalised English stem + sorted options — blocks duplicate
     * PYQs across PDFs/CSVs. Nullable for rows created before hashing existed.
     */
    contentHash: varchar("content_hash", { length: 64 }),
    // Staging row this question was approved from (null for seed / manual rows)
    ingestionJobId: uuid("ingestion_job_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("questions_exam_active_idx").on(table.examId, table.isActive),
    index("questions_subtopic_active_idx").on(table.subtopicId, table.isActive),
    index("questions_subject_chapter_idx").on(table.subjectId, table.chapterId),
    uniqueIndex("questions_content_hash_unique_idx").on(table.contentHash),
    index("questions_source_idx").on(table.source),
    index("questions_pyq_idx").on(table.pyqExamSlug, table.pyqYear),
  ]
);

// ============================================================================
// 6. Test Attempts & Attempt Answers Tables
// ============================================================================

export const testAttempts = pgTable(
  "test_attempts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    isRemedial: boolean("is_remedial").notNull().default(false),
    status: attemptStatusEnum("status").notNull().default("in_progress"),
    preferredLanguage: varchar("preferred_language", { length: 2 })
      .$type<"en" | "bn">()
      .notNull()
      .default("bn"),
    totalQuestions: integer("total_questions").notNull(),
    attemptedCount: integer("attempted_count").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    incorrectCount: integer("incorrect_count").notNull().default(0),
    unansweredCount: integer("unanswered_count").notNull().default(0),
    rawPositiveScore: numeric("raw_positive_score", {
      precision: 7,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    negativePenalty: numeric("negative_penalty", {
      precision: 7,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    finalNetScore: numeric("final_net_score", {
      precision: 7,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    maxPossibleScore: numeric("max_possible_score", {
      precision: 7,
      scale: 2,
    })
      .notNull()
      .default("100.00"),
    accuracyPercentage: numeric("accuracy_percentage", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    totalTimeSpentSeconds: integer("total_time_spent_seconds")
      .notNull()
      .default(0),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (table) => [
    index("test_attempts_user_exam_idx").on(table.userId, table.examId),
    index("test_attempts_user_status_idx").on(table.userId, table.status),
  ]
);

export const attemptAnswers = pgTable(
  "attempt_answers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => testAttempts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    subtopicId: uuid("subtopic_id")
      .notNull()
      .references(() => subtopics.id, { onDelete: "restrict" }),
    selectedOption: optionKeyEnum("selected_option").$type<OptionKey>(),
    state: questionAttemptStateEnum("state").notNull().default("unanswered"),
    isCorrect: boolean("is_correct").notNull().default(false),
    marksAwarded: numeric("marks_awarded", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    timeSpentSeconds: integer("time_spent_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("attempt_answers_attempt_question_unique_idx").on(
      table.attemptId,
      table.questionId
    ),
    index("attempt_answers_user_question_idx").on(
      table.userId,
      table.questionId
    ),
    index("attempt_answers_user_subtopic_idx").on(
      table.userId,
      table.subtopicId
    ),
  ]
);

// ============================================================================
// 7. User Subtopic Mastery Table (Deterministic SQL Weakness Tracking)
// ============================================================================

export const userSubtopicMastery = pgTable(
  "user_subtopic_mastery",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    subtopicId: uuid("subtopic_id")
      .notNull()
      .references(() => subtopics.id, { onDelete: "cascade" }),
    totalEncountered: integer("total_encountered").notNull().default(0),
    totalAttempted: integer("total_attempted").notNull().default(0),
    totalCorrect: integer("total_correct").notNull().default(0),
    totalIncorrect: integer("total_incorrect").notNull().default(0),
    totalUnanswered: integer("total_unanswered").notNull().default(0),
    cumulativeNetScore: numeric("cumulative_net_score", {
      precision: 8,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    cumulativeTimeSeconds: integer("cumulative_time_seconds")
      .notNull()
      .default(0),
    accuracyPercentage: numeric("accuracy_percentage", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    avgTimePerQuestionSeconds: numeric("avg_time_per_question_seconds", {
      precision: 6,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    masteryBand: masteryBandEnum("mastery_band")
      .notNull()
      .default("critical_weakness"),
    /**
     * Composite weakness priority score (higher = weaker / slower).
     * Computed deterministically in SQL so Top-3 weakest subtopics are O(1) indexed lookups.
     */
    weaknessPriorityScore: numeric("weakness_priority_score", {
      precision: 6,
      scale: 2,
    })
      .notNull()
      .default("100.00"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_subtopic_mastery_user_subtopic_unique_idx").on(
      table.userId,
      table.subtopicId
    ),
    index("user_subtopic_mastery_weakness_rank_idx").on(
      table.userId,
      table.examId,
      table.weaknessPriorityScore
    ),
  ]
);

// ============================================================================
// 8. Drizzle ORM Relations
// ============================================================================

export const examsRelations = relations(exams, ({ many }) => ({
  subjects: many(subjects),
  questions: many(questions),
  testAttempts: many(testAttempts),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  exam: one(exams, { fields: [subjects.examId], references: [exams.id] }),
  chapters: many(chapters),
  subtopics: many(subtopics),
  questions: many(questions),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  subject: one(subjects, {
    fields: [chapters.subjectId],
    references: [subjects.id],
  }),
  subtopics: many(subtopics),
  questions: many(questions),
}));

export const subtopicsRelations = relations(subtopics, ({ one, many }) => ({
  chapter: one(chapters, {
    fields: [subtopics.chapterId],
    references: [chapters.id],
  }),
  subject: one(subjects, {
    fields: [subtopics.subjectId],
    references: [subjects.id],
  }),
  questions: many(questions),
}));

export const questionsRelations = relations(questions, ({ one }) => ({
  exam: one(exams, { fields: [questions.examId], references: [exams.id] }),
  subject: one(subjects, {
    fields: [questions.subjectId],
    references: [subjects.id],
  }),
  chapter: one(chapters, {
    fields: [questions.chapterId],
    references: [chapters.id],
  }),
  subtopic: one(subtopics, {
    fields: [questions.subtopicId],
    references: [subtopics.id],
  }),
}));

export const testAttemptsRelations = relations(
  testAttempts,
  ({ one, many }) => ({
    user: one(users, {
      fields: [testAttempts.userId],
      references: [users.id],
    }),
    exam: one(exams, {
      fields: [testAttempts.examId],
      references: [exams.id],
    }),
    answers: many(attemptAnswers),
  })
);

// ============================================================================
// 9. Question Ingestion Jobs (3-Pipeline Staging Table)
// All pipelines land here first — human review required before live insert.
// ============================================================================

export const questionIngestionJobs = pgTable(
  "question_ingestion_jobs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),

    // Who uploaded / triggered this job
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),

    // Which pipeline produced this row
    source: ingestionSourceEnum("source").notNull(),

    // Current lifecycle state
    status: ingestionStatusEnum("status").notNull().default("pending_ai"),

    /**
     * Groups rows from one upload session / PDF / generation run.
     * Format: `<source>-<timestamp-ms>` e.g. "csv_upload-1698067200000"
     */
    batchId: varchar("batch_id", { length: 80 }).notNull(),

    /**
     * The raw input as received — CSV row object, PDF page JSON, or
     * manually entered partial question. Stored so we can re-process.
     */
    rawData: jsonb("raw_data").notNull(),

    /**
     * AI-enriched full bilingual MCQ ready to insert into questions table.
     * Null until api-ai completes enrichment.
     */
    enrichedData: jsonb("enriched_data"),

    // Resolved FK IDs after AI auto-tagging (null until api-ai resolves them)
    examId: uuid("exam_id").references(() => exams.id, { onDelete: "set null" }),
    subjectId: uuid("subject_id").references(() => subjects.id, {
      onDelete: "set null",
    }),
    chapterId: uuid("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    subtopicId: uuid("subtopic_id").references(() => subtopics.id, {
      onDelete: "set null",
    }),

    // PYQ metadata (Pipeline 2 & 3)
    pyqYear: integer("pyq_year"),
    pyqExamName: varchar("pyq_exam_name", { length: 160 }),

    /**
     * AI confidence 0.00–1.00. Low confidence (<0.70) rows are highlighted
     * in the Review Table for closer educator attention.
     */
    aiConfidenceScore: numeric("ai_confidence_score", {
      precision: 4,
      scale: 2,
    }),

    // Same hash as questions.content_hash — catches duplicates before approval
    contentHash: varchar("content_hash", { length: 64 }),

    // Educator notes added during the review step
    reviewNotes: text("review_notes"),

    // Set after successful insert into questions table
    insertedQuestionId: uuid("inserted_question_id"),

    // Error details if status = 'failed'
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("ingestion_jobs_batch_idx").on(table.batchId),
    index("ingestion_jobs_status_idx").on(table.status),
    index("ingestion_jobs_uploader_idx").on(table.uploadedBy),
    index("ingestion_jobs_exam_idx").on(table.examId),
    index("ingestion_jobs_content_hash_idx").on(table.contentHash),
  ]
);

export const questionIngestionJobsRelations = relations(
  questionIngestionJobs,
  ({ one }) => ({
    uploadedBy: one(users, {
      fields: [questionIngestionJobs.uploadedBy],
      references: [users.id],
    }),
    exam: one(exams, {
      fields: [questionIngestionJobs.examId],
      references: [exams.id],
    }),
    subject: one(subjects, {
      fields: [questionIngestionJobs.subjectId],
      references: [subjects.id],
    }),
    chapter: one(chapters, {
      fields: [questionIngestionJobs.chapterId],
      references: [chapters.id],
    }),
    subtopic: one(subtopics, {
      fields: [questionIngestionJobs.subtopicId],
      references: [subtopics.id],
    }),
  })
);

// ============================================================================
// 10. Convenience Type Aliases (used by seed scripts & API services)
// ============================================================================

/** Inferred union type from examSlugEnum — use instead of raw string */
export type ExamSlugType = (typeof examSlugEnum.enumValues)[number];

/** Inferred union type from difficultyEnum */
export type DifficultyType = (typeof difficultyEnum.enumValues)[number];

/** Inferred union type from ingestionStatusEnum */
export type IngestionStatusType =
  (typeof ingestionStatusEnum.enumValues)[number];

/** Inferred union type from ingestionSourceEnum */
export type IngestionSourceType =
  (typeof ingestionSourceEnum.enumValues)[number];
