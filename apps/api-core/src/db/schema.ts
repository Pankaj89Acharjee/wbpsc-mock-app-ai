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
    previousYearTag: varchar("previous_year_tag", { length: 100 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("questions_exam_active_idx").on(table.examId, table.isActive),
    index("questions_subtopic_active_idx").on(table.subtopicId, table.isActive),
    index("questions_subject_chapter_idx").on(table.subjectId, table.chapterId),
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
