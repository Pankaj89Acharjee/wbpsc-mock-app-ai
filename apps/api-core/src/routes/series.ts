import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, ilike, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  chapters,
  examSeries,
  exams,
  questionIngestionJobs,
  seriesQuestions,
  seriesRosterSlots,
  questions,
  subjects,
  subtopics,
  testAttempts,
} from "../db/schema";
import {
  ApprovableQuestionSchema,
  AssignQuestionsBodySchema,
  BankQueryClientSchema,
  BULK_IMPORT_MAX_ROWS,
  BulkQuestionRowSchema,
  PublishStatusSchema,
  ReplaceAssignmentBodySchema,
  RosterInputSchema,
  SeriesImportSetBodySchema,
  SeriesInputSchema,
  csvTableToRecords,
  isDraftTextComplete,
  normalizeRecordKeys,
  parseCsv,
  pyqLabel,
  rowToDraft,
  slugify,
  type AssignQuestionsResult,
  type BankQuestionDto,
  type BlueprintDto,
  type ExamOverviewDto,
  type SeriesExportDto,
  type SeriesExportQuestionDto,
  type SeriesImportSetResult,
  type SeriesInput,
  type StagedQuestionDraft,
} from "../../../../packages/shared-types/src/index";
import { computeContentHash } from "../lib/contentHash";
import {
  extractQuestionsFromMediaWithAi,
  translateAndEnrichQuestionDraft,
} from "../lib/aiEnrichment";
import { ensureCategoryInExam } from "./ingestion";
import { formatIssues } from "../lib/validation";
import { requireAdmin } from "../lib/auth";
import {
  SeriesError,
  assignQuestions,
  buildBlueprintDto,
  buildRosterDto,
  enforceSeriesQuestionCap,
  getSeries,
  loadAssignedPaths,
  loadExamTaxonomy,
  lockSeries,
  removeAssignment,
  rosterStateFor,
  slugPathKey,
  toSeriesDtos,
  toVacancyDto,
  touchSeries,
  type Dbx,
  type SeriesRow,
} from "../lib/series";
import {
  buildRosterState,
  fullReason,
  usageConflicts,
  validateRosterConfig,
  vacancyFor,
  type NodePath,
  type SlotNode,
} from "../lib/roster";

// ============================================================================
// Admin: Exam Type → Test Series (registered under /admin/series)
//
// A series IS the test: its subjects and question counts (the blueprint), its
// marking scheme, and the bank questions selected for it.
// ============================================================================

const IdParams = z.object({ id: z.string().uuid() });
const SeriesQuestionParams = z.object({ id: z.string().uuid(), questionId: z.string().uuid() });

const SeriesListQuery = z.object({
  status: z.union([PublishStatusSchema, z.literal("all"), z.literal("active")]).default("active"),
});

const VacancyQuery = z.object({ subtopicId: z.string().uuid() });

/** Sends SeriesError as its HTTP status; returns descriptive error on unexpected exceptions. */
function sendSeriesError(reply: FastifyReply, err: unknown) {
  if (err instanceof SeriesError) return reply.status(err.statusCode).send({ error: err.message });
  reply.log.error(err, "Series route error");
  const message = err instanceof Error && err.message ? err.message : "Unexpected server error";
  return reply.status(500).send({ error: message });
}

const bilingual = (en: string, bn: string) => ({ en, bn: bn || en });

function seriesColumns(input: SeriesInput) {
  const accessType: "free" | "paid" = input.accessType === "paid" ? "paid" : "free";
  const requiredTier: string =
    accessType === "paid"
      ? input.requiredTier && input.requiredTier !== "free"
        ? input.requiredTier
        : "pro_prelims"
      : "free";
  const priceInr = accessType === "paid" ? String(input.priceInr ?? 0) : "0.00";
  return {
    name: bilingual(input.nameEn, input.nameBn),
    description: { en: input.descriptionEn, bn: input.descriptionBn || input.descriptionEn },
    kind: input.kind,
    status: input.status,
    displayOrder: input.displayOrder,
    durationMinutes: input.durationMinutes,
    marksPerCorrect: String(input.marksPerCorrect),
    negativeMarksPerWrong: String(input.negativeMarksPerWrong),
    estimatedCutoffMarks: String(input.estimatedCutoffMarks),
    accessType,
    requiredTier,
    priceInr,
  };
}

/** Appends -2, -3… until unused. */
function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base || "item";
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

const statusWhere = (status: "all" | "active" | "draft" | "published" | "archived") =>
  status === "all" ? undefined : status === "active" ? ne(examSeries.status, "archived") : eq(examSeries.status, status);

/** A series can only go live with every seat of its blueprint filled. */
async function assertPublishable(dbx: Dbx, series: SeriesRow) {
  const [dto] = await toSeriesDtos(dbx, [series]);
  if (dto.totalQuestions === 0) {
    throw new SeriesError("Cannot publish: give the series' subjects question counts first", 409);
  }
  if (dto.selectedCount !== dto.totalQuestions) {
    throw new SeriesError(
      `Cannot publish: ${dto.selectedCount} of ${dto.totalQuestions} questions are selected. Fill every subject first.`,
      409
    );
  }
}

export const seriesRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook("preHandler", requireAdmin);

  // ── Exam types ────────────────────────────────────────────────────────────

  /** 1. GET /admin/series/overview — every exam type with its series totals & per-series attempt/score stats */
  fastify.get("/overview", async () => {
    const [examRows, seriesRows, bankCounts, examAttemptStats] = await Promise.all([
      db.select().from(exams).orderBy(asc(exams.createdAt)),
      db
        .select()
        .from(examSeries)
        .where(ne(examSeries.status, "archived"))
        .orderBy(asc(examSeries.displayOrder), asc(examSeries.createdAt)),
      db
        .select({ examId: questions.examId, n: sql<number>`count(*)::int` })
        .from(questions)
        .where(eq(questions.isActive, true))
        .groupBy(questions.examId),
      db
        .select({
          examId: testAttempts.examId,
          attempts: sql<number>`count(*)::int`,
          students: sql<number>`count(distinct ${testAttempts.userId})::int`,
          avgScore: sql<number | null>`round(avg(${testAttempts.finalNetScore})::numeric, 2)::float`,
        })
        .from(testAttempts)
        .groupBy(testAttempts.examId),
    ]);
    const dtos = await toSeriesDtos(db, seriesRows);
    const overview: ExamOverviewDto[] = examRows.map((e) => {
      const mine = dtos.filter((s) => s.examId === e.id);
      const exStat = examAttemptStats.find((a) => a.examId === e.id);
      const seriesAttemptsSum = mine.reduce((sum, s) => sum + s.attemptCount, 0);
      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        isActive: e.isActive,
        seriesCount: mine.length,
        publishedSeriesCount: mine.filter((s) => s.status === "published").length,
        targetQuestions: mine.reduce((sum, s) => sum + s.totalQuestions, 0),
        assignedQuestions: mine.reduce((sum, s) => sum + s.selectedCount, 0),
        bankQuestionCount: bankCounts.find((b) => b.examId === e.id)?.n ?? 0,
        totalAttempts: exStat?.attempts ?? seriesAttemptsSum,
        totalStudentsAttempted: exStat?.students ?? mine.reduce((sum, s) => sum + (s.studentCount ?? 0), 0),
        averageScore: exStat && exStat.attempts > 0 ? (exStat.avgScore ?? 0) : null,
        seriesStats: mine.map((s) => {
          const qCount = s.selectedCount > 0 ? s.selectedCount : s.totalQuestions;
          return {
            id: s.id,
            slug: s.slug,
            name: s.name,
            kind: s.kind,
            status: s.status,
            totalQuestions: s.totalQuestions,
            selectedCount: s.selectedCount,
            maxMarks: Number((qCount * s.marksPerCorrect).toFixed(2)),
            attemptCount: s.attemptCount,
            studentCount: s.studentCount ?? 0,
            averageScore: s.averageScore ?? null,
          };
        }),
      };
    });
    return { exams: overview };
  });

  // ── Series ────────────────────────────────────────────────────────────────

  /** 2. GET /admin/series/exams/:id?status= — the series of one exam type */
  fastify.get("/exams/:id", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const query = SeriesListQuery.safeParse(request.query);
    if (!params.success || !query.success) return reply.status(400).send({ error: "Invalid request" });
    const rows = await db
      .select()
      .from(examSeries)
      .where(and(eq(examSeries.examId, params.data.id), statusWhere(query.data.status)))
      .orderBy(asc(examSeries.displayOrder), asc(examSeries.createdAt));
    return { series: await toSeriesDtos(db, rows) };
  });

  /** 3. POST /admin/series/exams/:id — new series with its subject counts */
  fastify.post("/exams/:id", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = SeriesInputSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: body.success ? "Invalid exam id" : formatIssues(body.error.issues),
      });
    }
    if (body.data.status === "published") {
      return reply.status(400).send({ error: "Create the series as a draft, select its questions, then publish" });
    }
    const [exam] = await db
      .select({ id: exams.id, totalQuestions: exams.totalQuestions })
      .from(exams)
      .where(eq(exams.id, params.data.id));
    if (!exam) return reply.status(404).send({ error: "Exam not found" });

    const taken = new Set(
      (await db.select({ slug: examSeries.slug }).from(examSeries).where(eq(examSeries.examId, exam.id))).map(
        (r) => r.slug
      )
    );
    const slug = body.data.slug ?? uniqueSlug(slugify(body.data.nameEn), taken);
    if (taken.has(slug)) return reply.status(409).send({ error: `A series with slug "${slug}" already exists` });

    const targets = body.data.subjectTargets ?? [];
    const examSubjects = new Set(
      (await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.examId, exam.id))).map((r) => r.id)
    );
    if (targets.some((t) => !examSubjects.has(t.subjectId))) {
      return reply.status(400).send({ error: "A chosen subject is not part of this exam's syllabus" });
    }
    if (new Set(targets.map((t) => t.subjectId)).size !== targets.length) {
      return reply.status(400).send({ error: "Each subject can be listed only once" });
    }
    const requestedTotal = targets.reduce((sum, t) => sum + t.targetCount, 0);
    if (exam.totalQuestions > 0 && requestedTotal > exam.totalQuestions) {
      return reply.status(400).send({
        error: `Total questions across subjects (${requestedTotal}) cannot exceed this exam's limit of ${exam.totalQuestions} questions (${requestedTotal - exam.totalQuestions} extra).`,
      });
    }

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(examSeries)
        .values({ examId: exam.id, slug, ...seriesColumns(body.data) })
        .returning();
      if (targets.length) {
        await tx.insert(seriesRosterSlots).values(
          targets.map((t) => ({ seriesId: row.id, examId: exam.id, subjectId: t.subjectId, targetCount: t.targetCount }))
        );
      }
      return row;
    });
    return reply.status(201).send({ series: (await toSeriesDtos(db, [created]))[0] });
  });

  /** 4. PUT /admin/series/:id — rename / re-type / marking / publish / archive */
  fastify.put("/:id", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = SeriesInputSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: body.success ? "Invalid series id" : formatIssues(body.error.issues),
      });
    }
    try {
      const updated = await db.transaction(async (tx) => {
        const current = await lockSeries(tx, params.data.id);
        if (body.data.status === "published") await assertPublishable(tx, current);
        if (body.data.slug && body.data.slug !== current.slug) {
          const [clash] = await tx
            .select({ id: examSeries.id })
            .from(examSeries)
            .where(and(eq(examSeries.examId, current.examId), eq(examSeries.slug, body.data.slug)));
          if (clash) throw new SeriesError(`Slug "${body.data.slug}" is already used`, 409);
        }
        const [row] = await tx
          .update(examSeries)
          .set({ ...seriesColumns(body.data), slug: body.data.slug ?? current.slug, updatedAt: new Date() })
          .where(eq(examSeries.id, current.id))
          .returning();
        return row;
      });
      return { series: (await toSeriesDtos(db, [updated]))[0] };
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  /** 5. DELETE /admin/series/:id — drafts nobody has taken; otherwise archive */
  fastify.delete("/:id", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid series id" });
    try {
      await db.transaction(async (tx) => {
        const series = await lockSeries(tx, params.data.id);
        if (series.status === "published") {
          throw new SeriesError("Unpublish or archive the series before deleting it", 409);
        }
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(testAttempts)
          .where(eq(testAttempts.seriesId, series.id));
        if (n > 0) throw new SeriesError(`${n} student attempt(s) reference this series — archive it instead`, 409);
        // Blueprint and selections cascade; bank questions are untouched
        await tx.delete(examSeries).where(eq(examSeries.id, series.id));
      });
      return { deleted: true };
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  // ── Blueprint (subjects → topic breakdown) ────────────────────────────────

  /** 6. GET /admin/series/:id/blueprint */
  fastify.get("/:id/blueprint", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid series id" });
    try {
      return { blueprint: await buildBlueprintDto(db, await getSeries(db, params.data.id)) };
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  /**
   * 7. PUT /admin/series/:id/blueprint  { slots: [...] }
   * Replaces the whole blueprint: subject counts plus optional topic counts
   * inside each subject. Rejected (never silently adjusted) when topics exceed
   * their subject or when already-selected questions would no longer fit.
   */
  fastify.put("/:id/blueprint", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = RosterInputSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: body.success ? "Invalid series id" : formatIssues(body.error.issues),
      });
    }
    try {
      const blueprint: BlueprintDto = await db.transaction(async (tx) => {
        const series = await lockSeries(tx, params.data.id);
        if (series.status === "archived") throw new SeriesError("This series is archived", 409);
        const tax = await loadExamTaxonomy(tx, series.examId);

        for (const s of body.data.slots) {
          if (!tax.subjects.has(s.subjectId)) {
            throw new SeriesError("A subject is not part of this series' exam", 400);
          }
          if (s.chapterId && tax.chapters.get(s.chapterId)?.subjectId !== s.subjectId) {
            throw new SeriesError(
              `A topic doesn't belong to ${tax.label({ ...s, chapterId: null, subtopicId: null })}`,
              400
            );
          }
          if (s.subtopicId && tax.subtopics.get(s.subtopicId)?.chapterId !== s.chapterId) {
            throw new SeriesError("A subtopic doesn't belong to its chapter", 400);
          }
        }
        const proposed: SlotNode[] = body.data.slots.map((s, i) => ({ id: `new-${i}`, ...s }));
        const errors = validateRosterConfig(proposed, tax.label);
        if (errors.length) throw new SeriesError(errors.join("; "), 400);

        // Selected questions must still fit (and a published test stays complete)
        const assigned = await loadAssignedPaths(tx, series.id);
        const conflicts = usageConflicts(buildRosterState(proposed, assigned), tax.label);
        if (conflicts.length) {
          throw new SeriesError(`Remove or reassign selected questions first — ${conflicts.join("; ")}`, 409);
        }
        const newTotal = buildRosterState(proposed, []).rosterTotal;
        const [examRow] = await tx
          .select({ totalQuestions: exams.totalQuestions })
          .from(exams)
          .where(eq(exams.id, series.examId))
          .limit(1);
        if (examRow && examRow.totalQuestions > 0 && newTotal > examRow.totalQuestions) {
          throw new SeriesError(
            `Total questions across subjects (${newTotal}) cannot exceed this exam's limit of ${examRow.totalQuestions} questions (${newTotal - examRow.totalQuestions} extra)`,
            400
          );
        }
        if (series.status === "published" && assigned.length !== newTotal) {
          throw new SeriesError(
            `This series is published with ${assigned.length} questions; move it back to draft before changing the total to ${newTotal}`,
            409
          );
        }

        await tx.delete(seriesRosterSlots).where(eq(seriesRosterSlots.seriesId, series.id));
        if (body.data.slots.length) {
          await tx
            .insert(seriesRosterSlots)
            .values(body.data.slots.map((s) => ({ ...s, seriesId: series.id, examId: series.examId })));
        }
        await touchSeries(tx, series.id);
        return buildBlueprintDto(tx, series);
      });
      return { blueprint };
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  // ── Selected questions against the blueprint ──────────────────────────────

  /** 8. GET /admin/series/:id/roster — blueprint slots, counts, selected questions */
  fastify.get("/:id/roster", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid series id" });
    try {
      return { roster: await buildRosterDto(db, params.data.id) };
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  /** 9. GET /admin/series/:id/vacancy?subtopicId= — seats left for one syllabus node */
  fastify.get("/:id/vacancy", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const query = VacancyQuery.safeParse(request.query);
    if (!params.success || !query.success) return reply.status(400).send({ error: "Invalid request" });
    try {
      const series = await getSeries(db, params.data.id);
      const tax = await loadExamTaxonomy(db, series.examId);
      const path = tax.pathOfSubtopic(query.data.subtopicId);
      if (!path) return reply.status(400).send({ error: "That subtopic is not part of this series' exam" });
      const { state } = await rosterStateFor(db, series.id);
      return { vacancy: toVacancyDto(series.id, state, path, tax.label) };
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  /** 10. POST /admin/series/:id/assignments  { questionIds, subtopicId? } */
  fastify.post("/:id/assignments", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = AssignQuestionsBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: body.success ? "Invalid series id" : formatIssues(body.error.issues),
      });
    }
    try {
      const outcome = await db.transaction(async (tx) => {
        const series = await lockSeries(tx, params.data.id);
        const result = await assignQuestions(tx, series, body.data.questionIds, {
          subtopicId: body.data.subtopicId,
          userId: request.user!.id,
        });
        if (result.assigned.length) await touchSeries(tx, series.id);
        return result;
      });
      const result: AssignQuestionsResult = {
        ...outcome,
        roster: await buildRosterDto(db, params.data.id),
      };
      return reply.status(outcome.assigned.length ? 201 : 200).send(result);
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  /** 11. DELETE /admin/series/:id/assignments/:questionId */
  fastify.delete("/:id/assignments/:questionId", async (request, reply) => {
    const params = SeriesQuestionParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid request" });
    try {
      await db.transaction(async (tx) => {
        const series = await lockSeries(tx, params.data.id);
        if (series.status === "published") {
          throw new SeriesError(
            "A published series must stay complete — use Replace, or move the series back to draft",
            409
          );
        }
        if (!(await removeAssignment(tx, series, params.data.questionId))) {
          throw new SeriesError("That question is not in this series", 404);
        }
        await touchSeries(tx, series.id);
      });
      return { roster: await buildRosterDto(db, params.data.id) };
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  /** 12. POST /admin/series/:id/assignments/replace — atomic swap (works when published) */
  fastify.post("/:id/assignments/replace", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = ReplaceAssignmentBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: body.success ? "Invalid series id" : formatIssues(body.error.issues),
      });
    }
    try {
      await db.transaction(async (tx) => {
        const series = await lockSeries(tx, params.data.id);
        if (!(await removeAssignment(tx, series, body.data.removeQuestionId))) {
          throw new SeriesError("The question to replace is not in this series", 404);
        }
        const result = await assignQuestions(tx, series, [body.data.addQuestionId], {
          subtopicId: body.data.subtopicId,
          userId: request.user!.id,
        });
        if (result.failed.length) {
          // Throwing rolls back the removal too — the series is left exactly as it was
          throw new SeriesError(`Replacement not possible: ${result.failed[0].reason}`, 409);
        }
        await touchSeries(tx, series.id);
      });
      return { roster: await buildRosterDto(db, params.data.id) };
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  // ── Central Question Bank search ──────────────────────────────────────────

  /**
   * 13. GET /admin/series/bank?examId=&subjectId=&…&seriesId=&availability=
   * Approved bank questions from any exam. With `seriesId`, each row says
   * whether it is already selected and whether the blueprint can take it.
   */
  fastify.get("/bank", async (request, reply) => {
    const parsed = BankQueryClientSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
    }
    const f = parsed.data;
    const series = f.seriesId ? await getSeries(db, f.seriesId).catch(() => null) : null;
    if (f.seriesId && !series) return reply.status(404).send({ error: "Series not found" });

    const inSeriesIds = series
      ? (
          await db
            .select({ id: seriesQuestions.questionId })
            .from(seriesQuestions)
            .where(eq(seriesQuestions.seriesId, series.id))
        ).map((r) => r.id)
      : [];

    const where = and(
      f.includeRetired ? undefined : eq(questions.isActive, true),
      f.examId ? eq(questions.examId, f.examId) : undefined,
      f.subjectId ? eq(questions.subjectId, f.subjectId) : undefined,
      f.chapterId ? eq(questions.chapterId, f.chapterId) : undefined,
      f.subtopicId ? eq(questions.subtopicId, f.subtopicId) : undefined,
      f.difficulty ? eq(questions.difficulty, f.difficulty) : undefined,
      f.source ? eq(questions.source, f.source) : undefined,
      f.q
        ? or(
            ilike(sql`${questions.stem} ->> 'en'`, `%${f.q}%`),
            ilike(sql`${questions.stem} ->> 'bn'`, `%${f.q}%`)
          )
        : undefined,
      f.availability === "unassigned" && inSeriesIds.length
        ? notInArray(questions.id, inSeriesIds)
        : undefined
    );

    // "eligible" and the target subject depend on blueprint math / mapping, so
    // they are filtered after loading a wider page
    const wantEligible = (f.availability === "eligible" || !!f.targetSubjectId) && series;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          q: questions,
          subjectSlug: subjects.slug,
          subjectName: subjects.name,
          chapterSlug: chapters.slug,
          chapterName: chapters.name,
          subtopicSlug: subtopics.slug,
          subtopicName: subtopics.name,
          usedInSeries: sql<number>`(select count(*)::int from ${seriesQuestions} sq where sq.question_id = ${questions.id})`,
        })
        .from(questions)
        .innerJoin(subjects, eq(questions.subjectId, subjects.id))
        .innerJoin(chapters, eq(questions.chapterId, chapters.id))
        .innerJoin(subtopics, eq(questions.subtopicId, subtopics.id))
        .where(where)
        .orderBy(desc(questions.createdAt))
        .limit(wantEligible ? 1000 : f.limit)
        .offset(wantEligible ? 0 : f.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(questions).where(where),
    ]);

    let annotate: ((r: (typeof rows)[number]) => BankQuestionDto["eligibility"]) | null = null;
    const mappedSubject = new Map<string, string | null>();
    if (series) {
      const tax = await loadExamTaxonomy(db, series.examId);
      const { state } = await rosterStateFor(db, series.id);
      annotate = (r) => {
        const path: NodePath | null =
          r.q.examId === series.examId
            ? { subjectId: r.q.subjectId, chapterId: r.q.chapterId, subtopicId: r.q.subtopicId }
            : (tax.bySlugPath.get(slugPathKey(r.subjectSlug, r.chapterSlug, r.subtopicSlug)) ?? null);
        mappedSubject.set(r.q.id, path?.subjectId ?? null);
        if (!path) {
          return { ok: false, reason: "From another exam — pick a subtopic to classify it", subtopicId: null };
        }
        const v = vacancyFor(state, path, "assign", tax.label);
        return {
          ok: v.eligible && v.allowed > 0,
          reason: !v.eligible
            ? `${tax.label(path)} is not in the series blueprint`
            : v.allowed > 0
              ? `${v.allowed} seat(s) left`
              : fullReason(v, tax.label(path)),
          subtopicId: path.subtopicId,
        };
      };
    }

    const inSeries = new Set(inSeriesIds);
    let dtos: BankQuestionDto[] = rows.map((r) => ({
      id: r.q.id,
      examId: r.q.examId,
      examSlug: r.q.examSlug,
      subjectId: r.q.subjectId,
      chapterId: r.q.chapterId,
      subtopicId: r.q.subtopicId,
      pathLabel: `${r.subjectName.en} → ${r.chapterName.en} → ${r.subtopicName.en}`,
      stem: r.q.stem,
      options: r.q.options,
      correctOption: r.q.correctOption,
      explanation: r.q.explanation,
      difficulty: r.q.difficulty,
      source: r.q.source,
      previousYearTag: r.q.previousYearTag,
      isActive: r.q.isActive,
      createdAt: r.q.createdAt.toISOString(),
      usedInSeries: r.usedInSeries,
      ...(series ? { inSeries: inSeries.has(r.q.id), eligibility: annotate!(r) } : {}),
    }));
    let count = total;
    if (wantEligible) {
      dtos = dtos.filter(
        (d) =>
          (f.availability !== "eligible" || (!d.inSeries && d.eligibility?.ok)) &&
          (!f.targetSubjectId || mappedSubject.get(d.id) === f.targetSubjectId)
      );
      count = dtos.length;
      dtos = dtos.slice(f.offset, f.offset + f.limit);
    }
    return { questions: dtos, total: count };
  });

  // ── Export & Import Whole Question Set for a Test Series ──────────────────

  /**
   * 14. GET /admin/series/:id/export
   * Returns the complete ordered question paper, options A–D, answer key,
   * explanations, and subject breakdown for exporting in PDF or Excel.
   */
  fastify.get("/:id/export", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid series id" });
    try {
      const series = await getSeries(db, params.data.id);
      const [[seriesDto], [examRow], assignedRows] = await Promise.all([
        toSeriesDtos(db, [series]),
        db.select().from(exams).where(eq(exams.id, series.examId)).limit(1),
        db
          .select({
            pq: seriesQuestions,
            q: questions,
            subjectName: subjects.name,
            chapterName: chapters.name,
            subtopicName: subtopics.name,
          })
          .from(seriesQuestions)
          .innerJoin(questions, eq(seriesQuestions.questionId, questions.id))
          .innerJoin(subjects, eq(seriesQuestions.subjectId, subjects.id))
          .innerJoin(chapters, eq(seriesQuestions.chapterId, chapters.id))
          .innerJoin(subtopics, eq(seriesQuestions.subtopicId, subtopics.id))
          .where(eq(seriesQuestions.seriesId, series.id))
          .orderBy(asc(seriesQuestions.position), asc(seriesQuestions.createdAt)),
      ]);
      if (!examRow) return reply.status(404).send({ error: "Exam not found" });

      const exportQuestions: SeriesExportQuestionDto[] = assignedRows.map((r, idx) => ({
        questionNumber: idx + 1,
        questionId: r.q.id,
        subjectId: r.pq.subjectId,
        subjectName: r.subjectName,
        chapterId: r.pq.chapterId,
        chapterName: r.chapterName,
        subtopicId: r.pq.subtopicId,
        subtopicName: r.subtopicName,
        stem: r.q.stem,
        options: r.q.options,
        correctOption: r.q.correctOption,
        explanation: r.q.explanation,
        difficulty: r.q.difficulty,
        source: r.q.source,
        previousYearTag: r.q.previousYearTag,
        marksPositive: Number(series.marksPerCorrect),
        marksNegative: Number(series.negativeMarksPerWrong),
      }));

      const payload: SeriesExportDto = {
        series: seriesDto,
        exam: {
          id: examRow.id,
          slug: examRow.slug,
          title: examRow.title,
          description: examRow.description,
        },
        exportedAt: new Date().toISOString(),
        questions: exportQuestions,
      };
      return payload;
    } catch (err) {
      return sendSeriesError(reply, err);
    }
  });

  /**
   * 15. POST /admin/series/:id/import-set
   * Imports a whole Question Set (CSV, Excel CSV/TSV, JSON, or PDF/Image Question Paper)
   * directly into the exam's Question Bank (`questions` table) AND assigns the questions
   * into this Test Series (updating the draft series' subject counts if needed).
   */
  fastify.post(
    "/:id/import-set",
    { bodyLimit: 25 * 1024 * 1024 },
    async (request, reply) => {
      const params = IdParams.safeParse(request.params);
      const body = SeriesImportSetBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.status(400).send({
          error: body.success ? "Invalid series id" : formatIssues(body.error.issues),
        });
      }

      try {
        const series = await getSeries(db, params.data.id);
        if (series.status === "archived") {
          throw new SeriesError("Restore the archived series to draft before importing questions", 409);
        }
        const [examRow] = await db.select().from(exams).where(eq(exams.id, series.examId)).limit(1);
        if (!examRow) throw new SeriesError("Exam not found", 404);

        const input = body.data;
        const errors: Array<{ rowNumber: number; message: string }> = [];
        let categoriesCreated = 0;

        // Intermediate normalized items ready for category resolution + DB insertion
        interface ImportItem {
          rowNumber: number;
          subjectEn: string;
          subjectBn: string;
          chapterEn: string;
          chapterBn: string;
          subtopicEn: string;
          subtopicBn: string;
          draft: StagedQuestionDraft;
        }
        const items: ImportItem[] = [];

        if (input.format === "media") {
          if (!input.base64Data || !input.mimeType) {
            return reply.status(400).send({ error: "Missing base64Data or mimeType for PDF/Image upload" });
          }
          const existingSubjects = await db.select().from(subjects).where(eq(subjects.examId, examRow.id));
          const sIds = existingSubjects.map((s) => s.id);
          const existingChapters = sIds.length
            ? await db.select().from(chapters).where(inArray(chapters.subjectId, sIds))
            : [];
          const existingSubtopics = sIds.length
            ? await db.select().from(subtopics).where(inArray(subtopics.subjectId, sIds))
            : [];
          const chapMap = new Map(existingChapters.map((c) => [c.id, c]));
          const subjMap = new Map(existingSubjects.map((s) => [s.id, s]));
          const existingCategories = existingSubtopics.flatMap((t) => {
            const c = chapMap.get(t.chapterId);
            const s = c ? subjMap.get(c.subjectId) : undefined;
            return c && s ? [{ subjectEn: s.name.en, chapterEn: c.name.en, subtopicEn: t.name.en }] : [];
          });

          let extracted;
          try {
            extracted = await extractQuestionsFromMediaWithAi({
              examSlug: examRow.slug,
              examTitleEn: examRow.title.en,
              mimeType: input.mimeType,
              fileBase64: input.base64Data,
              existingCategories,
            });
          } catch (aiErr) {
            request.log.error(aiErr, "Failed to extract questions from uploaded PDF/Image in series import");
            return reply.status(502).send({
              error: `Failed to extract questions from PDF/Image: ${(aiErr as Error).message}`,
            });
          }

          extracted.forEach((q, idx) => {
            items.push({
              rowNumber: idx + 1,
              subjectEn: q.subject_en || "General Studies",
              subjectBn: q.subject_bn || q.subject_en || "সাধারণ অধ্যয়ন",
              chapterEn: q.chapter_en || "Core Topics",
              chapterBn: q.chapter_bn || q.chapter_en || "মূল অধ্যায়",
              subtopicEn: q.subtopic_en || "General Questions",
              subtopicBn: q.subtopic_bn || q.subtopic_en || "সাধারণ প্রশ্ন",
              draft: {
                examSlug: examRow.slug,
                subjectSlug: "",
                chapterSlug: "",
                subtopicSlug: "",
                stem: q.stem,
                options: q.options,
                correctOption: q.correct_option,
                explanation: q.explanation,
                difficulty: q.difficulty,
                source: input.source,
                pyqExamSlug: input.source === "pyq" ? examRow.slug : null,
                pyqYear: input.source === "pyq" ? (input.pyqYear ?? new Date().getFullYear() - 1) : null,
                answerKeyVerified: true,
              },
            });
          });
        } else {
          const rawContent = (input.content ?? "").trim();
          if (!rawContent) {
            return reply.status(400).send({ error: "Uploaded file content is empty" });
          }

          let records: Array<{ rowNumber: number; record: Record<string, unknown> }> = [];
          if (input.format === "csv") {
            const parsedCsv = csvTableToRecords(parseCsv(rawContent));
            records = parsedCsv.records.map((r) => ({
              rowNumber: r.rowNumber,
              record: (normalizeRecordKeys(r.record) ?? {}) as Record<string, unknown>,
            }));
          } else {
            let json: unknown;
            try {
              json = JSON.parse(rawContent);
            } catch {
              return reply.status(400).send({ error: "File is not valid JSON" });
            }
            const arr = Array.isArray(json)
              ? json
              : json && typeof json === "object" && Array.isArray((json as { questions?: unknown[] }).questions)
                ? (json as { questions: unknown[] }).questions
                : null;
            if (!arr) {
              return reply.status(400).send({ error: "JSON must be an array of question objects" });
            }
            records = arr.map((rec, i) => ({
              rowNumber: i + 1,
              record: (normalizeRecordKeys(rec) ?? {}) as Record<string, unknown>,
            }));
          }

          // Filter out empty template rows
          records = records.filter(({ record }) =>
            ["stem_en", "option_a_en", "option_b_en", "option_c_en", "option_d_en"].some(
              (k) => typeof record[k] === "string" && (record[k] as string).trim() !== ""
            )
          );

          if (records.length === 0) {
            return reply.status(400).send({ error: "No valid question rows found in the uploaded file" });
          }
          if (records.length > BULK_IMPORT_MAX_ROWS) {
            return reply.status(400).send({
              error: `Too many rows (${records.length}). Maximum allowed per import is ${BULK_IMPORT_MAX_ROWS}.`,
            });
          }

          for (const { rowNumber, record } of records) {
            // Default exam to this series' exam if left blank in the file
            const withDefaults = {
              ...record,
              exam: (typeof record.exam === "string" && record.exam.trim()) ? record.exam : examRow.slug,
              subject: (typeof record.subject === "string" && record.subject.trim()) ? record.subject : "General Studies",
              chapter: (typeof record.chapter === "string" && record.chapter.trim()) ? record.chapter : "Core Concepts",
              subtopic: (typeof record.subtopic === "string" && record.subtopic.trim()) ? record.subtopic : "General Practice",
            };
            const rowParsed = BulkQuestionRowSchema.safeParse(withDefaults);
            if (!rowParsed.success) {
              errors.push({ rowNumber, message: formatIssues(rowParsed.error.issues) });
              continue;
            }
            const draft = rowToDraft(rowParsed.data);
            // Ensure Bengali fallback if blank so the question is immediately live-ready for the test series
            const ensureBi = (b: { en: string; bn: string }, fallbackEn = ""): { en: string; bn: string } => {
              const en = b.en.trim() || fallbackEn;
              return { en, bn: b.bn.trim() || en };
            };
            const completeDraft: StagedQuestionDraft = {
              ...draft,
              examSlug: examRow.slug,
              stem: ensureBi(draft.stem),
              options: {
                A: ensureBi(draft.options.A),
                B: ensureBi(draft.options.B),
                C: ensureBi(draft.options.C),
                D: ensureBi(draft.options.D),
              },
              explanation: ensureBi(
                draft.explanation,
                `Correct answer is Option ${draft.correctOption}.`
              ),
              answerKeyVerified: true,
            };

            items.push({
              rowNumber,
              subjectEn: rowParsed.data.subject || "General Studies",
              subjectBn: rowParsed.data.subject || "সাধারণ অধ্যয়ন",
              chapterEn: rowParsed.data.chapter || "Core Concepts",
              chapterBn: rowParsed.data.chapter || "মূল ধারণা",
              subtopicEn: rowParsed.data.subtopic || "General Practice",
              subtopicBn: rowParsed.data.subtopic || "সাধারণ অনুশীলন",
              draft: completeDraft,
            });
          }
        }

        if (items.length === 0) {
          return reply.status(400).send({
            error: errors.length ? `All rows had errors: ${errors[0].message}` : "No questions could be extracted",
            errors,
          });
        }

        const batchId = `series-import-${Date.now()}`;
        let insertedToBank = 0;
        let reusedFromBank = 0;
        const questionIdsToAssign: string[] = [];
        const subjectCountNeeded = new Map<string, number>();

        for (const item of items) {
          const cat = await ensureCategoryInExam(examRow.id, {
            subjectEn: item.subjectEn,
            subjectBn: item.subjectBn,
            chapterEn: item.chapterEn,
            chapterBn: item.chapterBn,
            subtopicEn: item.subtopicEn,
            subtopicBn: item.subtopicBn,
          });
          if (cat.createdNew) categoriesCreated++;

          let draft: StagedQuestionDraft = {
            ...item.draft,
            examSlug: examRow.slug,
            subjectSlug: cat.subjectSlug,
            chapterSlug: cat.chapterSlug,
            subtopicSlug: cat.subtopicSlug,
          };

          if (!isDraftTextComplete(draft) && process.env.GEMINI_API_KEY) {
            draft = await translateAndEnrichQuestionDraft(draft).catch(() => draft);
          }

          const valid = ApprovableQuestionSchema.safeParse(draft);
          if (!valid.success) {
            errors.push({ rowNumber: item.rowNumber, message: formatIssues(valid.error.issues) });
            continue;
          }

          const contentHash = computeContentHash(valid.data);
          const pyqTag =
            valid.data.source === "pyq" ? pyqLabel(examRow.title.en, valid.data.pyqYear) : null;

          // Check if question already exists in bank
          const [existingQ] = await db
            .select({ id: questions.id, subjectId: questions.subjectId })
            .from(questions)
            .where(eq(questions.contentHash, contentHash))
            .limit(1);

          if (existingQ) {
            reusedFromBank++;
            questionIdsToAssign.push(existingQ.id);
            subjectCountNeeded.set(
              existingQ.subjectId,
              (subjectCountNeeded.get(existingQ.subjectId) ?? 0) + 1
            );
            continue;
          }

          const [job] = await db
            .insert(questionIngestionJobs)
            .values({
              batchId,
              source: input.format === "media" ? "pdf_extract" : input.format === "csv" ? "csv_upload" : "json_upload",
              status: "inserted",
              rawData: { rowNumber: item.rowNumber, fileName: input.fileName ?? "Series Import" },
              enrichedData: valid.data,
              examId: examRow.id,
              subjectId: cat.subjectId,
              chapterId: cat.chapterId,
              subtopicId: cat.subtopicId,
              contentHash,
              pyqYear: valid.data.pyqYear,
              pyqExamName: pyqTag,
              targetSeriesId: series.id,
              reviewedAt: new Date(),
            })
            .returning({ id: questionIngestionJobs.id });

          const [createdQ] = await db
            .insert(questions)
            .values({
              examId: examRow.id,
              examSlug: examRow.slug,
              subjectId: cat.subjectId,
              chapterId: cat.chapterId,
              subtopicId: cat.subtopicId,
              stem: valid.data.stem,
              options: valid.data.options,
              correctOption: valid.data.correctOption,
              explanation: valid.data.explanation,
              difficulty: valid.data.difficulty,
              marksPositive: String(examRow.marksPerCorrect),
              marksNegative: String(examRow.negativeMarksPerWrong),
              previousYearTag: pyqTag,
              source: valid.data.source,
              pyqExamSlug: valid.data.pyqExamSlug,
              pyqYear: valid.data.pyqYear,
              answerKeyVerified: true,
              contentHash,
              ingestionJobId: job.id,
            })
            .onConflictDoNothing({ target: questions.contentHash })
            .returning({ id: questions.id });

          if (createdQ) {
            insertedToBank++;
            questionIdsToAssign.push(createdQ.id);
            subjectCountNeeded.set(
              cat.subjectId,
              (subjectCountNeeded.get(cat.subjectId) ?? 0) + 1
            );
            await db
              .update(questionIngestionJobs)
              .set({ insertedQuestionId: createdQ.id })
              .where(eq(questionIngestionJobs.id, job.id));
          }
        }

        let blueprintUpdated = false;
        let assignedToSeries = 0;

        await db.transaction(async (tx) => {
          const locked = await lockSeries(tx, series.id);
          const existingSlots = await tx
            .select()
            .from(seriesRosterSlots)
            .where(eq(seriesRosterSlots.seriesId, locked.id));
          const { state } = await rosterStateFor(tx, locked.id);

          // Cap total questions in the series at:
          // - the series' existing blueprint total (if > 0), never exceeding examRow.totalQuestions
          // - otherwise examRow.totalQuestions (e.g. 100)
          const examMaxCap = examRow.totalQuestions > 0 ? examRow.totalQuestions : 100;
          const existingSubjectSlots = existingSlots.filter((s) => s.chapterId === null && s.subtopicId === null);
          let currentBlueprintSum = existingSubjectSlots.reduce((sum, s) => sum + s.targetCount, 0);

          // If autoUpdateBlueprint is true and series is draft, only allocate seats up to examMaxCap
          // (and NEVER add `currentlyAssigned + addCount` on top of an already-full 100-question blueprint!)
          if (input.autoUpdateBlueprint && locked.status === "draft" && subjectCountNeeded.size > 0) {
            const seriesTargetCap = currentBlueprintSum > 0 ? Math.min(currentBlueprintSum, examMaxCap) : examMaxCap;
            for (const [subjId, addCount] of subjectCountNeeded.entries()) {
              const subjSlot = existingSlots.find(
                (s) => s.subjectId === subjId && s.chapterId === null && s.subtopicId === null
              );
              const remainingSeriesRoom = Math.max(0, seriesTargetCap - currentBlueprintSum);
              if (!subjSlot) {
                if (remainingSeriesRoom > 0) {
                  const targetToSet = Math.min(addCount, remainingSeriesRoom);
                  await tx.insert(seriesRosterSlots).values({
                    seriesId: locked.id,
                    examId: locked.examId,
                    subjectId: subjId,
                    chapterId: null,
                    subtopicId: null,
                    targetCount: targetToSet,
                  });
                  currentBlueprintSum += targetToSet;
                  blueprintUpdated = true;
                }
              } else {
                const currentlyAssigned = state.assignedIn.get(subjSlot.id) ?? 0;
                const desiredTarget = Math.min(
                  currentlyAssigned + addCount,
                  subjSlot.targetCount + remainingSeriesRoom
                );
                if (desiredTarget > subjSlot.targetCount) {
                  const delta = desiredTarget - subjSlot.targetCount;
                  await tx
                    .update(seriesRosterSlots)
                    .set({ targetCount: desiredTarget })
                    .where(eq(seriesRosterSlots.id, subjSlot.id));
                  currentBlueprintSum += delta;
                  blueprintUpdated = true;
                }
              }
            }
          }

          if (questionIdsToAssign.length > 0) {
            const outcome = await assignQuestions(tx, locked, questionIdsToAssign, {
              userId: request.user!.id,
            });
            assignedToSeries = outcome.assigned.length;
            outcome.failed.forEach((f, idx) => {
              errors.push({ rowNumber: idx + 1, message: f.reason });
            });
          }

          // Guarantee no overflow beyond blueprint total
          await enforceSeriesQuestionCap(tx, locked.id);
          await touchSeries(tx, locked.id);
        });

        const result: SeriesImportSetResult = {
          totalParsed: items.length,
          insertedToBank,
          reusedFromBank,
          assignedToSeries,
          categoriesCreated,
          blueprintUpdated,
          errors,
          roster: await buildRosterDto(db, series.id),
        };
        return reply.status(201).send(result);
      } catch (err) {
        return sendSeriesError(reply, err);
      }
    }
  );
};

