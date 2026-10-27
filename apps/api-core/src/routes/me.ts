import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/index";
import {
  attemptAnswers,
  examSeries,
  exams,
  questions,
  subjects,
  subtopics,
  testAttempts,
  userSubtopicMastery,
} from "../db/schema";
import type {
  AttemptReviewDto,
  BilingualText,
  AttemptSummaryDto,
  MasteryDto,
  PausedAttemptDto,
} from "../../../../packages/shared-types/src/index";
import { requireUser } from "../lib/auth";

type AttemptRow = typeof testAttempts.$inferSelect;
type ExamRow = typeof exams.$inferSelect;
/** The test series an attempt was for; it sets the cutoff */
type SeriesRef = { id: string; name: BilingualText; cutoff: string | number } | null;

export function toAttemptSummary(a: AttemptRow, exam: ExamRow, series: SeriesRef = null): AttemptSummaryDto {
  const finalNetScore = Number(a.finalNetScore);
  const cutoff = Number(series ? series.cutoff : exam.estimatedCutoffMarks);
  return {
    id: a.id,
    examId: exam.id,
    examSlug: exam.slug,
    examTitleEn: exam.title.en,
    examTitleBn: exam.title.bn,
    isRemedial: a.isRemedial,
    totalQuestions: a.totalQuestions,
    attemptedCount: a.attemptedCount,
    correctCount: a.correctCount,
    incorrectCount: a.incorrectCount,
    unansweredCount: a.unansweredCount,
    finalNetScore,
    maxPossibleScore: Number(a.maxPossibleScore),
    accuracyPercentage: Number(a.accuracyPercentage),
    totalTimeSpentSeconds: a.totalTimeSpentSeconds,
    cutoffCleared: finalNetScore >= cutoff,
    submittedAt: a.submittedAt?.toISOString() ?? null,
    series: series && { id: series.id, name: series.name },
  };
}

// ============================================================================
// Route Plugin Implementation (registered under /me) — the signed-in student's data
// ============================================================================

export const meRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook("preHandler", requireUser);

  /** 1. GET /me/attempts — submitted mock tests, newest first */
  fastify.get("/attempts", async (request) => {
    const rows = await db
      .select({
        attempt: testAttempts,
        exam: exams,
        seriesId: examSeries.id,
        seriesName: examSeries.name,
        seriesCutoff: examSeries.estimatedCutoffMarks,
      })
      .from(testAttempts)
      .innerJoin(exams, eq(testAttempts.examId, exams.id))
      .leftJoin(examSeries, eq(testAttempts.seriesId, examSeries.id))
      .where(
        and(eq(testAttempts.userId, request.user!.id), eq(testAttempts.status, "submitted"))
      )
      .orderBy(desc(testAttempts.submittedAt))
      .limit(100);
    return {
      attempts: rows.map((r) =>
        toAttemptSummary(
          r.attempt,
          r.exam,
          r.seriesId && r.seriesName && r.seriesCutoff != null
            ? { id: r.seriesId, name: r.seriesName, cutoff: r.seriesCutoff }
            : null
        )
      ),
    };
  });

  /**
   * 2. GET /me/attempts/:id/review
   * Question-by-question: your answer vs the correct one, marks, explanation.
   * Admins may open anyone's attempt.
   */
  fastify.get("/attempts/:id/review", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid attempt id" });

    const [row] = await db
      .select({ attempt: testAttempts, exam: exams })
      .from(testAttempts)
      .innerJoin(exams, eq(testAttempts.examId, exams.id))
      .where(eq(testAttempts.id, params.data.id))
      .limit(1);
    if (!row || (row.attempt.userId !== request.user!.id && request.user!.role !== "admin")) {
      return reply.status(404).send({ error: "Attempt not found" });
    }

    const items = await db
      .select({
        questionId: attemptAnswers.questionId,
        stem: questions.stem,
        options: questions.options,
        correctOption: questions.correctOption,
        selectedOption: attemptAnswers.selectedOption,
        marksAwarded: attemptAnswers.marksAwarded,
        timeSpentSeconds: attemptAnswers.timeSpentSeconds,
        explanation: questions.explanation,
        subtopicName: subtopics.name,
      })
      .from(attemptAnswers)
      .innerJoin(questions, eq(attemptAnswers.questionId, questions.id))
      .innerJoin(subtopics, eq(attemptAnswers.subtopicId, subtopics.id))
      .where(eq(attemptAnswers.attemptId, row.attempt.id))
      .orderBy(asc(attemptAnswers.position));

    const review: AttemptReviewDto = {
      attempt: toAttemptSummary(row.attempt, row.exam),
      items: items.map((i) => ({ ...i, marksAwarded: Number(i.marksAwarded) })),
    };
    return review;
  });

  /** 3. GET /me/mastery — weakness radar, weakest first */
  fastify.get("/mastery", async (request) => {
    const rows = await db
      .select({
        m: userSubtopicMastery,
        examSlug: exams.slug,
        subjectName: subjects.name,
        subtopicSlug: subtopics.slug,
        subtopicName: subtopics.name,
      })
      .from(userSubtopicMastery)
      .innerJoin(exams, eq(userSubtopicMastery.examId, exams.id))
      .innerJoin(subjects, eq(userSubtopicMastery.subjectId, subjects.id))
      .innerJoin(subtopics, eq(userSubtopicMastery.subtopicId, subtopics.id))
      .where(eq(userSubtopicMastery.userId, request.user!.id))
      .orderBy(desc(userSubtopicMastery.weaknessPriorityScore));

    const mastery: MasteryDto[] = rows.map(({ m, ...names }) => ({
      id: m.id,
      examId: m.examId,
      examSlug: names.examSlug,
      subjectName: names.subjectName,
      subtopicId: m.subtopicId,
      subtopicSlug: names.subtopicSlug,
      subtopicName: names.subtopicName,
      totalEncountered: m.totalEncountered,
      totalCorrect: m.totalCorrect,
      totalIncorrect: m.totalIncorrect,
      accuracyPercentage: Number(m.accuracyPercentage),
      avgTimeSeconds: Number(m.avgTimePerQuestionSeconds),
      masteryBand: m.masteryBand,
      weaknessPriorityScore: Number(m.weaknessPriorityScore),
    }));
    return { mastery };
  });

  /** 4. GET /me/paused-attempts — ongoing / postponed tests that can be resumed */
  fastify.get("/paused-attempts", async (request) => {
    const rows = await db
      .select({
        attempt: testAttempts,
        exam: exams,
        series: examSeries,
      })
      .from(testAttempts)
      .innerJoin(exams, eq(testAttempts.examId, exams.id))
      .leftJoin(examSeries, eq(testAttempts.seriesId, examSeries.id))
      .where(
        and(eq(testAttempts.userId, request.user!.id), eq(testAttempts.status, "in_progress"))
      )
      .orderBy(desc(testAttempts.startedAt))
      .limit(20);

    const pausedAttempts: PausedAttemptDto[] = [];
    for (const r of rows) {
      const ansRows = await db
        .select({
          ans: attemptAnswers,
          q: questions,
          subjectName: subjects.name,
          subtopicName: subtopics.name,
        })
        .from(attemptAnswers)
        .innerJoin(questions, eq(attemptAnswers.questionId, questions.id))
        .innerJoin(subjects, eq(questions.subjectId, subjects.id))
        .innerJoin(subtopics, eq(attemptAnswers.subtopicId, subtopics.id))
        .where(eq(attemptAnswers.attemptId, r.attempt.id))
        .orderBy(asc(attemptAnswers.position));

      if (ansRows.length === 0) continue;

      const firstUnansweredIdx = ansRows.findIndex((x) => x.ans.selectedOption === null);
      const currentQuestionIdx = firstUnansweredIdx >= 0 ? firstUnansweredIdx : 0;
      const s = r.series;

      pausedAttempts.push({
        attemptId: r.attempt.id,
        examId: r.exam.id,
        examSlug: r.exam.slug,
        examTitleEn: s ? `${r.exam.title.en} — ${s.name.en}` : r.exam.title.en,
        examTitleBn: s ? `${r.exam.title.bn} — ${s.name.bn}` : r.exam.title.bn,
        seriesId: s?.id ?? null,
        seriesName: s?.name ?? null,
        isRemedial: r.attempt.isRemedial,
        preferredLanguage: r.attempt.preferredLanguage,
        durationMinutes: s ? s.durationMinutes : r.exam.durationMinutes,
        marksPerCorrect: Number(s ? s.marksPerCorrect : r.exam.marksPerCorrect),
        negativeMarksPerWrong: Number(s ? s.negativeMarksPerWrong : r.exam.negativeMarksPerWrong),
        estimatedCutoffMarks: Number(s ? s.estimatedCutoffMarks : r.exam.estimatedCutoffMarks),
        totalQuestions: ansRows.length,
        answeredCount: ansRows.filter((x) => x.ans.selectedOption !== null).length,
        totalTimeSpentSeconds: r.attempt.totalTimeSpentSeconds,
        currentQuestionIdx,
        pausedAt: r.attempt.startedAt.toISOString(),
        questions: ansRows.map((x) => ({
          id: x.q.id,
          subjectName: x.subjectName,
          subtopicName: x.subtopicName,
          stem: x.q.stem,
          options: x.q.options,
          previousYearTag: x.q.previousYearTag ?? null,
          selectedOption: x.ans.selectedOption,
          state: x.ans.state,
          timeSpentSeconds: x.ans.timeSpentSeconds,
        })),
      });
    }

    return { pausedAttempts };
  });

  /** 5. DELETE /me/paused-attempts/:id — discard a paused test */
  fastify.delete("/paused-attempts/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid attempt id" });

    await db
      .delete(testAttempts)
      .where(
        and(
          eq(testAttempts.id, params.data.id),
          eq(testAttempts.userId, request.user!.id),
          eq(testAttempts.status, "in_progress")
        )
      );
    return { deleted: true };
  });
};
