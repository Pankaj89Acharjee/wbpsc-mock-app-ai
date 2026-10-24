import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  exams,
  subjects,
  chapters,
  subtopics,
  questions,
  testAttempts,
  attemptAnswers,
  userSubtopicMastery,
} from "../db/schema";
import {
  OptionKeySchema,
  QuestionAttemptStatusSchema,
  SupportedLanguageSchema,
} from "../../../../packages/shared-types/src/index";
import { requireUser } from "../lib/auth";

// ============================================================================
// Request Validation Schemas (Zod)
// ============================================================================

const MockTestParamsSchema = z.object({
  examId: z.string().uuid("examId must be a valid UUID"),
});

const MockTestQuerySchema = z.object({
  limit: z.coerce.number().int().min(5).max(200).optional(),
  lang: SupportedLanguageSchema.default("bn"),
});

const SubmitExamBodySchema = z.object({
  examId: z.string().uuid(),
  attemptId: z.string().uuid().optional(),
  preferredLanguage: SupportedLanguageSchema.default("bn"),
  startedAt: z.string().datetime().optional(),
  submittedAt: z.string().datetime().optional(),
  totalTimeSpentSeconds: z.number().int().nonnegative(),
  /**
   * Optional override for negative marking (e.g. 0.25 or 0.33).
   * If omitted, uses the exam's configured `negativeMarksPerWrong` from `exams` table.
   */
  negativeMarkOverride: z.number().nonnegative().max(1).optional(),
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        selectedOption: OptionKeySchema.nullable(),
        status: QuestionAttemptStatusSchema.default("answered"),
        timeSpentSeconds: z.number().int().nonnegative().max(7200),
      })
    )
    .min(1, "At least one question entry is required"),
});

const RemedialMockBodySchema = z.object({
  examId: z.string().uuid(),
  preferredLanguage: SupportedLanguageSchema.default("bn"),
});

// ============================================================================
// Route Plugin Implementation
// ============================================================================

export const examRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  // Every exam route acts on the signed-in user (never a userId from the body)
  fastify.addHook("preHandler", requireUser);

  /**
   * 0. GET /exams
   * Exams students can take (admins also see inactive ones), with live question counts.
   */
  fastify.get("/exams", async (request) => {
    const isAdmin = request.user!.role === "admin";
    const rows = await db
      .select({
        exam: exams,
        questionCount: sql<number>`(select count(*)::int from questions q where q.exam_id = "exams"."id" and q.is_active)`,
      })
      .from(exams)
      .where(isAdmin ? undefined : eq(exams.isActive, true))
      .orderBy(asc(exams.createdAt));
    return {
      exams: rows.map(({ exam, questionCount }) => ({
        id: exam.id,
        slug: exam.slug,
        titleEn: exam.title.en,
        titleBn: exam.title.bn,
        descriptionEn: exam.description.en,
        descriptionBn: exam.description.bn,
        totalQuestions: exam.totalQuestions,
        durationMinutes: exam.durationMinutes,
        marksPerCorrect: Number(exam.marksPerCorrect),
        negativeMarksPerWrong: Number(exam.negativeMarksPerWrong),
        estimatedCutoffMarks: Number(exam.estimatedCutoffMarks),
        isActive: exam.isActive,
        questionCount,
      })),
    };
  });

  /**
   * 1. GET /exams/:examId/mock-test
   * Fetches a timed mock test with client-safe bilingual questions
   * (omits `correctOption` and `explanation` so answers cannot be inspected in DevTools).
   */
  fastify.get("/exams/:examId/mock-test", async (request, reply) => {
    const paramsParsed = MockTestParamsSchema.safeParse(request.params);
    const queryParsed = MockTestQuerySchema.safeParse(request.query);

    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: "Invalid examId parameter",
        details: paramsParsed.error.flatten(),
      });
    }
    if (!queryParsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: queryParsed.error.flatten(),
      });
    }

    const { examId } = paramsParsed.data;
    const { limit, lang } = queryParsed.data;

    const [examRecord] = await db
      .select()
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.isActive, true)))
      .limit(1);

    if (!examRecord) {
      return reply.status(404).send({
        error: "Exam not found or inactive",
      });
    }

    const questionLimit = limit ?? examRecord.totalQuestions;

    const mockQuestions = await db
      .select({
        id: questions.id,
        examId: questions.examId,
        examSlug: questions.examSlug,
        subjectId: questions.subjectId,
        subjectName: subjects.name,
        chapterId: questions.chapterId,
        chapterName: chapters.name,
        subtopicId: questions.subtopicId,
        subtopicName: subtopics.name,
        stem: questions.stem,
        options: questions.options,
        difficulty: questions.difficulty,
        marksPositive: questions.marksPositive,
        marksNegative: questions.marksNegative,
        previousYearTag: questions.previousYearTag,
      })
      .from(questions)
      .innerJoin(subjects, eq(questions.subjectId, subjects.id))
      .innerJoin(chapters, eq(questions.chapterId, chapters.id))
      .innerJoin(subtopics, eq(questions.subtopicId, subtopics.id))
      .where(and(eq(questions.examId, examId), eq(questions.isActive, true)))
      .orderBy(sql`RANDOM()`)
      .limit(questionLimit);

    return reply.status(200).send({
      exam: {
        id: examRecord.id,
        slug: examRecord.slug,
        title: examRecord.title,
        durationMinutes: examRecord.durationMinutes,
        totalQuestions: mockQuestions.length,
        marksPerCorrect: Number(examRecord.marksPerCorrect),
        negativeMarksPerWrong: Number(examRecord.negativeMarksPerWrong),
        targetTimePerQuestionSec: examRecord.targetTimePerQuestionSec,
      },
      preferredLanguage: lang,
      generatedAt: new Date().toISOString(),
      questions: mockQuestions,
    });
  });

  /**
   * 2. POST /exams/submit
   * Deterministic SQL Grading & Weakness Engine (Zero AI tokens consumed):
   * - Calculates exact score (+1.00 for correct, configurable -0.25 or -0.33 for wrong).
   * - Executes inside a SINGLE PostgreSQL transaction (`db.transaction`).
   * - Upserts `user_subtopic_mastery` cumulatively.
   * - Identifies weak subtopics where accuracy < 50% OR average time > subtopic benchmark.
   */
  fastify.post("/exams/submit", async (request, reply) => {
    const parsed = SubmitExamBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid test submission payload",
        details: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const questionIds = Array.from(
      new Set(payload.answers.map((a) => a.questionId))
    );

    const result = await db.transaction(async (tx) => {
      // Step 1: Fetch exam metadata for positive/negative marking rules
      const [examRecord] = await tx
        .select()
        .from(exams)
        .where(eq(exams.id, payload.examId))
        .limit(1);

      if (!examRecord) {
        throw new Error(`EXAM_NOT_FOUND:${payload.examId}`);
      }

      const positiveMark = Number(examRecord.marksPerCorrect) || 1.0;
      const negativeMark =
        payload.negativeMarkOverride !== undefined
          ? payload.negativeMarkOverride
          : Number(examRecord.negativeMarksPerWrong) || 0.25;

      // Step 2: Fetch authoritative question records & taxonomy metadata in one query
      const dbQuestions = await tx
        .select({
          id: questions.id,
          correctOption: questions.correctOption,
          explanation: questions.explanation,
          subjectId: questions.subjectId,
          subjectName: subjects.name,
          chapterId: questions.chapterId,
          chapterName: chapters.name,
          subtopicId: questions.subtopicId,
          subtopicSlug: subtopics.slug,
          subtopicName: subtopics.name,
          expectedTimeSeconds: subtopics.expectedTimeSeconds,
        })
        .from(questions)
        .innerJoin(subjects, eq(questions.subjectId, subjects.id))
        .innerJoin(chapters, eq(questions.chapterId, chapters.id))
        .innerJoin(subtopics, eq(questions.subtopicId, subtopics.id))
        .where(inArray(questions.id, questionIds));

      if (dbQuestions.length === 0) {
        throw new Error("NO_VALID_QUESTIONS_IN_SUBMISSION");
      }

      const questionMap = new Map(dbQuestions.map((q) => [q.id, q]));

      // Step 3: Grade each answer deterministically & aggregate per-subtopic stats
      let attemptedCount = 0;
      let correctCount = 0;
      let incorrectCount = 0;
      let unansweredCount = 0;
      let rawPositiveScore = 0;
      let negativePenalty = 0;

      interface SubtopicAccumulator {
        subjectId: string;
        subjectName: { en: string; bn: string };
        chapterId: string;
        chapterName: { en: string; bn: string };
        subtopicId: string;
        subtopicSlug: string;
        subtopicName: { en: string; bn: string };
        expectedTimeSeconds: number;
        totalQuestions: number;
        attemptedCount: number;
        correctCount: number;
        incorrectCount: number;
        unansweredCount: number;
        netScore: number;
        totalTimeSeconds: number;
      }

      const subtopicStatsMap = new Map<string, SubtopicAccumulator>();
      const gradedAnswersToInsert: Array<{
        questionId: string;
        subtopicId: string;
        selectedOption: "A" | "B" | "C" | "D" | null;
        state:
          | "answered"
          | "marked_for_review"
          | "answered_and_marked"
          | "unanswered"
          | "not_visited";
        isCorrect: boolean;
        marksAwarded: string;
        timeSpentSeconds: number;
      }> = [];

      for (const ans of payload.answers) {
        const qMeta = questionMap.get(ans.questionId);
        if (!qMeta) continue;

        const isAnswered =
          ans.selectedOption !== null &&
          ans.status !== "unanswered" &&
          ans.status !== "not_visited";

        let isCorrect = false;
        let marksAwarded = 0;

        if (!isAnswered) {
          unansweredCount += 1;
        } else {
          attemptedCount += 1;
          if (ans.selectedOption === qMeta.correctOption) {
            isCorrect = true;
            correctCount += 1;
            marksAwarded = positiveMark;
            rawPositiveScore += positiveMark;
          } else {
            isCorrect = false;
            incorrectCount += 1;
            marksAwarded = -negativeMark;
            negativePenalty += negativeMark;
          }
        }

        gradedAnswersToInsert.push({
          questionId: qMeta.id,
          subtopicId: qMeta.subtopicId,
          selectedOption: isAnswered ? ans.selectedOption : null,
          state: isAnswered ? ans.status : "unanswered",
          isCorrect,
          marksAwarded: marksAwarded.toFixed(2),
          timeSpentSeconds: ans.timeSpentSeconds,
        });

        const existingSub = subtopicStatsMap.get(qMeta.subtopicId) ?? {
          subjectId: qMeta.subjectId,
          subjectName: qMeta.subjectName,
          chapterId: qMeta.chapterId,
          chapterName: qMeta.chapterName,
          subtopicId: qMeta.subtopicId,
          subtopicSlug: qMeta.subtopicSlug,
          subtopicName: qMeta.subtopicName,
          expectedTimeSeconds: qMeta.expectedTimeSeconds,
          totalQuestions: 0,
          attemptedCount: 0,
          correctCount: 0,
          incorrectCount: 0,
          unansweredCount: 0,
          netScore: 0,
          totalTimeSeconds: 0,
        };

        existingSub.totalQuestions += 1;
        existingSub.attemptedCount += isAnswered ? 1 : 0;
        existingSub.correctCount += isCorrect ? 1 : 0;
        existingSub.incorrectCount += isAnswered && !isCorrect ? 1 : 0;
        existingSub.unansweredCount += !isAnswered ? 1 : 0;
        existingSub.netScore += marksAwarded;
        existingSub.totalTimeSeconds += ans.timeSpentSeconds;

        subtopicStatsMap.set(qMeta.subtopicId, existingSub);
      }

      const totalQuestionsGraded = gradedAnswersToInsert.length;
      const finalNetScore = Number(
        (rawPositiveScore - negativePenalty).toFixed(2)
      );
      const maxPossibleScore = Number(
        (totalQuestionsGraded * positiveMark).toFixed(2)
      );
      const accuracyPercentage =
        attemptedCount > 0
          ? Number(((correctCount / attemptedCount) * 100).toFixed(2))
          : 0;

      // Step 4: Insert `test_attempts` record
      const [insertedAttempt] = await tx
        .insert(testAttempts)
        .values({
          ...(payload.attemptId ? { id: payload.attemptId } : {}),
          userId: request.user!.id,
          examId: payload.examId,
          status: "submitted",
          preferredLanguage: payload.preferredLanguage,
          totalQuestions: totalQuestionsGraded,
          attemptedCount,
          correctCount,
          incorrectCount,
          unansweredCount,
          rawPositiveScore: rawPositiveScore.toFixed(2),
          negativePenalty: negativePenalty.toFixed(2),
          finalNetScore: finalNetScore.toFixed(2),
          maxPossibleScore: maxPossibleScore.toFixed(2),
          accuracyPercentage: accuracyPercentage.toFixed(2),
          totalTimeSpentSeconds: payload.totalTimeSpentSeconds,
          startedAt: payload.startedAt
            ? new Date(payload.startedAt)
            : new Date(Date.now() - payload.totalTimeSpentSeconds * 1000),
          submittedAt: payload.submittedAt
            ? new Date(payload.submittedAt)
            : new Date(),
        })
        .returning({ id: testAttempts.id, submittedAt: testAttempts.submittedAt });

      // Step 5: Bulk insert `attempt_answers`
      await tx.insert(attemptAnswers).values(
        gradedAnswersToInsert.map((item, position) => ({
          attemptId: insertedAttempt.id,
          userId: request.user!.id,
          questionId: item.questionId,
          subtopicId: item.subtopicId,
          selectedOption: item.selectedOption,
          state: item.state,
          isCorrect: item.isCorrect,
          marksAwarded: item.marksAwarded,
          timeSpentSeconds: item.timeSpentSeconds,
          position,
        }))
      );

      // Step 6: Atomic SQL Upsert into `user_subtopic_mastery` for each subtopic
      const weakSubtopics: Array<{
        subtopicId: string;
        subtopicSlug: string;
        subtopicName: { en: string; bn: string };
        subjectId: string;
        subjectName: { en: string; bn: string };
        chapterId: string;
        chapterName: { en: string; bn: string };
        totalQuestions: number;
        attemptedCount: number;
        correctCount: number;
        incorrectCount: number;
        unansweredCount: number;
        netScore: number;
        accuracyPercentage: number;
        avgTimePerQuestionSeconds: number;
        expectedTimeSeconds: number;
        weaknessReasons: Array<"LOW_ACCURACY_BELOW_50" | "HIGH_TIME_TAKEN">;
        masteryBand:
          | "critical_weakness"
          | "needs_revision"
          | "proficient"
          | "exam_ready";
        aiNoteCacheKey: string;
      }> = [];

      for (const sub of subtopicStatsMap.values()) {
        // Evaluate test-level accuracy (over total questions in subtopic so skipped questions also lower mastery)
        const subAccuracy = Number(
          ((sub.correctCount / sub.totalQuestions) * 100).toFixed(2)
        );
        const subAvgTime = Number(
          (sub.totalTimeSeconds / sub.totalQuestions).toFixed(2)
        );

        const isLowAccuracy = subAccuracy < 50;
        const isHighTime = subAvgTime > sub.expectedTimeSeconds;

        const masteryBand:
          | "critical_weakness"
          | "needs_revision"
          | "proficient"
          | "exam_ready" =
          subAccuracy < 50
            ? "critical_weakness"
            : subAccuracy < 70
            ? "needs_revision"
            : subAccuracy < 85
            ? "proficient"
            : "exam_ready";

        // Priority score: combines accuracy deficit (0..100) + time overrun penalty (0..50)
        const timePenalty = Math.max(
          0,
          Math.min(50, ((subAvgTime - sub.expectedTimeSeconds) / sub.expectedTimeSeconds) * 40)
        );
        const initialPriorityScore = Number(
          ((100 - subAccuracy) + timePenalty).toFixed(2)
        );

        await tx
          .insert(userSubtopicMastery)
          .values({
            userId: request.user!.id,
            examId: payload.examId,
            subjectId: sub.subjectId,
            chapterId: sub.chapterId,
            subtopicId: sub.subtopicId,
            totalEncountered: sub.totalQuestions,
            totalAttempted: sub.attemptedCount,
            totalCorrect: sub.correctCount,
            totalIncorrect: sub.incorrectCount,
            totalUnanswered: sub.unansweredCount,
            cumulativeNetScore: sub.netScore.toFixed(2),
            cumulativeTimeSeconds: sub.totalTimeSeconds,
            accuracyPercentage: subAccuracy.toFixed(2),
            avgTimePerQuestionSeconds: subAvgTime.toFixed(2),
            masteryBand,
            weaknessPriorityScore: initialPriorityScore.toFixed(2),
            lastTestedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              userSubtopicMastery.userId,
              userSubtopicMastery.subtopicId,
            ],
            set: {
              totalEncountered: sql`${userSubtopicMastery.totalEncountered} + ${sub.totalQuestions}`,
              totalAttempted: sql`${userSubtopicMastery.totalAttempted} + ${sub.attemptedCount}`,
              totalCorrect: sql`${userSubtopicMastery.totalCorrect} + ${sub.correctCount}`,
              totalIncorrect: sql`${userSubtopicMastery.totalIncorrect} + ${sub.incorrectCount}`,
              totalUnanswered: sql`${userSubtopicMastery.totalUnanswered} + ${sub.unansweredCount}`,
              cumulativeNetScore: sql`${userSubtopicMastery.cumulativeNetScore} + ${sub.netScore.toFixed(2)}::numeric`,
              cumulativeTimeSeconds: sql`${userSubtopicMastery.cumulativeTimeSeconds} + ${sub.totalTimeSeconds}`,
              accuracyPercentage: sql`ROUND(((${userSubtopicMastery.totalCorrect} + ${sub.correctCount})::numeric / GREATEST(${userSubtopicMastery.totalEncountered} + ${sub.totalQuestions}, 1)::numeric) * 100, 2)`,
              avgTimePerQuestionSeconds: sql`ROUND(((${userSubtopicMastery.cumulativeTimeSeconds} + ${sub.totalTimeSeconds})::numeric / GREATEST(${userSubtopicMastery.totalEncountered} + ${sub.totalQuestions}, 1)::numeric), 2)`,
              masteryBand: sql`CASE
                WHEN ((${userSubtopicMastery.totalCorrect} + ${sub.correctCount})::numeric / GREATEST(${userSubtopicMastery.totalEncountered} + ${sub.totalQuestions}, 1)::numeric) * 100 < 50 THEN 'critical_weakness'::mastery_band
                WHEN ((${userSubtopicMastery.totalCorrect} + ${sub.correctCount})::numeric / GREATEST(${userSubtopicMastery.totalEncountered} + ${sub.totalQuestions}, 1)::numeric) * 100 < 70 THEN 'needs_revision'::mastery_band
                WHEN ((${userSubtopicMastery.totalCorrect} + ${sub.correctCount})::numeric / GREATEST(${userSubtopicMastery.totalEncountered} + ${sub.totalQuestions}, 1)::numeric) * 100 < 85 THEN 'proficient'::mastery_band
                ELSE 'exam_ready'::mastery_band
              END`,
              weaknessPriorityScore: sql`ROUND(
                (100 - (((${userSubtopicMastery.totalCorrect} + ${sub.correctCount})::numeric / GREATEST(${userSubtopicMastery.totalEncountered} + ${sub.totalQuestions}, 1)::numeric) * 100))
                + GREATEST(0, LEAST(50, ((((${userSubtopicMastery.cumulativeTimeSeconds} + ${sub.totalTimeSeconds})::numeric / GREATEST(${userSubtopicMastery.totalEncountered} + ${sub.totalQuestions}, 1)::numeric) - ${sub.expectedTimeSeconds}) / ${sub.expectedTimeSeconds}::numeric) * 40)),
                2
              )`,
              lastTestedAt: new Date(),
            },
          });

        if (isLowAccuracy || isHighTime) {
          const weaknessReasons: Array<
            "LOW_ACCURACY_BELOW_50" | "HIGH_TIME_TAKEN"
          > = [];
          if (isLowAccuracy) weaknessReasons.push("LOW_ACCURACY_BELOW_50");
          if (isHighTime) weaknessReasons.push("HIGH_TIME_TAKEN");

          weakSubtopics.push({
            subtopicId: sub.subtopicId,
            subtopicSlug: sub.subtopicSlug,
            subtopicName: sub.subtopicName,
            subjectId: sub.subjectId,
            subjectName: sub.subjectName,
            chapterId: sub.chapterId,
            chapterName: sub.chapterName,
            totalQuestions: sub.totalQuestions,
            attemptedCount: sub.attemptedCount,
            correctCount: sub.correctCount,
            incorrectCount: sub.incorrectCount,
            unansweredCount: sub.unansweredCount,
            netScore: Number(sub.netScore.toFixed(2)),
            accuracyPercentage: subAccuracy,
            avgTimePerQuestionSeconds: subAvgTime,
            expectedTimeSeconds: sub.expectedTimeSeconds,
            weaknessReasons,
            masteryBand,
            aiNoteCacheKey: `${examRecord.slug}:${sub.subtopicSlug}:${payload.preferredLanguage}`,
          });
        }
      }

      // Sort weak subtopics by lowest accuracy first, then highest time spent
      weakSubtopics.sort((a, b) => {
        if (a.accuracyPercentage !== b.accuracyPercentage) {
          return a.accuracyPercentage - b.accuracyPercentage;
        }
        return b.avgTimePerQuestionSeconds - a.avgTimePerQuestionSeconds;
      });

      return {
        attemptId: insertedAttempt.id,
        examId: examRecord.id,
        examSlug: examRecord.slug,
        submittedAt: insertedAttempt.submittedAt?.toISOString(),
        scoringConfig: {
          marksPerCorrect: positiveMark,
          negativeMarksPerWrong: negativeMark,
        },
        overallSummary: {
          totalQuestions: totalQuestionsGraded,
          attempted: attemptedCount,
          correct: correctCount,
          incorrect: incorrectCount,
          unanswered: unansweredCount,
          rawPositiveScore: Number(rawPositiveScore.toFixed(2)),
          negativePenalty: Number(negativePenalty.toFixed(2)),
          finalNetScore,
          maxPossibleScore,
          accuracyPercentage,
          cutoffCleared:
            finalNetScore >= Number(examRecord.estimatedCutoffMarks),
          estimatedCutoffMarks: Number(examRecord.estimatedCutoffMarks),
        },
        weakSubtopics,
      };
    });

    return reply.status(200).send(result);
  });

  /**
   * 3. POST /exams/remedial-mock
   * Queries 20 unattempted MCQs from the user's Top 3 weakest `subtopic_id`s
   * based on `user_subtopic_mastery` (lowest accuracy / highest `weaknessPriorityScore`).
   */
  fastify.post("/exams/remedial-mock", async (request, reply) => {
    const parsed = RemedialMockBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid remedial mock request",
        details: parsed.error.flatten(),
      });
    }

    const { examId, preferredLanguage } = parsed.data;
    const userId = request.user!.id;

    // Step 1: Identify Top 3 weakest subtopics for this user & exam
    const weakestMasteryRows = await db
      .select({
        subtopicId: userSubtopicMastery.subtopicId,
        subtopicSlug: subtopics.slug,
        subtopicName: subtopics.name,
        accuracyPercentage: userSubtopicMastery.accuracyPercentage,
        avgTimePerQuestionSeconds:
          userSubtopicMastery.avgTimePerQuestionSeconds,
        weaknessPriorityScore: userSubtopicMastery.weaknessPriorityScore,
        masteryBand: userSubtopicMastery.masteryBand,
      })
      .from(userSubtopicMastery)
      .innerJoin(
        subtopics,
        eq(userSubtopicMastery.subtopicId, subtopics.id)
      )
      .where(
        and(
          eq(userSubtopicMastery.userId, userId),
          eq(userSubtopicMastery.examId, examId)
        )
      )
      .orderBy(
        desc(userSubtopicMastery.weaknessPriorityScore),
        asc(userSubtopicMastery.accuracyPercentage)
      )
      .limit(3);

    if (weakestMasteryRows.length === 0) {
      return reply.status(404).send({
        error:
          "No subtopic mastery records found for this user. Complete at least one diagnostic mock test first.",
      });
    }

    const top3WeakSubtopicIds = weakestMasteryRows.map((r) => r.subtopicId);

    // Step 2: Subquery all question IDs the user has already answered in these subtopics
    const previouslyAttemptedQuestionRows = await db
      .selectDistinct({ questionId: attemptAnswers.questionId })
      .from(attemptAnswers)
      .where(
        and(
          eq(attemptAnswers.userId, userId),
          inArray(attemptAnswers.subtopicId, top3WeakSubtopicIds),
          inArray(attemptAnswers.state, ["answered", "answered_and_marked"])
        )
      );

    const attemptedQuestionIds = previouslyAttemptedQuestionRows.map(
      (r) => r.questionId
    );

    // Step 3: Fetch 20 unattempted MCQs from the Top 3 weakest subtopics
    const whereConditions = [
      eq(questions.examId, examId),
      eq(questions.isActive, true),
      inArray(questions.subtopicId, top3WeakSubtopicIds),
    ];

    if (attemptedQuestionIds.length > 0) {
      whereConditions.push(notInArray(questions.id, attemptedQuestionIds));
    }

    const remedialQuestions = await db
      .select({
        id: questions.id,
        examId: questions.examId,
        examSlug: questions.examSlug,
        subjectId: questions.subjectId,
        subjectName: subjects.name,
        chapterId: questions.chapterId,
        chapterName: chapters.name,
        subtopicId: questions.subtopicId,
        subtopicName: subtopics.name,
        stem: questions.stem,
        options: questions.options,
        difficulty: questions.difficulty,
        marksPositive: questions.marksPositive,
        marksNegative: questions.marksNegative,
        previousYearTag: questions.previousYearTag,
      })
      .from(questions)
      .innerJoin(subjects, eq(questions.subjectId, subjects.id))
      .innerJoin(chapters, eq(questions.chapterId, chapters.id))
      .innerJoin(subtopics, eq(questions.subtopicId, subtopics.id))
      .where(and(...whereConditions))
      .orderBy(sql`RANDOM()`)
      .limit(20);

    return reply.status(200).send({
      remedialTest: {
        examId,
        userId,
        preferredLanguage,
        durationMinutes: 15,
        totalQuestions: remedialQuestions.length,
        targetedWeakSubtopics: weakestMasteryRows.map((w) => ({
          subtopicId: w.subtopicId,
          subtopicSlug: w.subtopicSlug,
          subtopicName: w.subtopicName,
          accuracyPercentage: Number(w.accuracyPercentage),
          avgTimePerQuestionSeconds: Number(w.avgTimePerQuestionSeconds),
          weaknessPriorityScore: Number(w.weaknessPriorityScore),
          masteryBand: w.masteryBand,
        })),
        questions: remedialQuestions,
      },
    });
  });
};
