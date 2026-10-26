import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, ilike, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  chapters,
  examSeries,
  exams,
  seriesQuestions,
  seriesRosterSlots,
  questions,
  subjects,
  subtopics,
  testAttempts,
} from "../db/schema";
import {
  AssignQuestionsBodySchema,
  BankQueryClientSchema,
  PublishStatusSchema,
  ReplaceAssignmentBodySchema,
  RosterInputSchema,
  SeriesInputSchema,
  slugify,
  type AssignQuestionsResult,
  type BankQuestionDto,
  type BlueprintDto,
  type ExamOverviewDto,
  type SeriesInput,
} from "../../../../packages/shared-types/src/index";
import { formatIssues } from "../lib/validation";
import { requireAdmin } from "../lib/auth";
import {
  SeriesError,
  assignQuestions,
  buildBlueprintDto,
  buildRosterDto,
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

/** Sends SeriesError as its HTTP status; rethrows anything else. */
function sendSeriesError(reply: FastifyReply, err: unknown) {
  if (err instanceof SeriesError) return reply.status(err.statusCode).send({ error: err.message });
  throw err;
}

const bilingual = (en: string, bn: string) => ({ en, bn: bn || en });

function seriesColumns(input: SeriesInput) {
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

  /** 1. GET /admin/series/overview — every exam type with its series totals */
  fastify.get("/overview", async () => {
    const [examRows, seriesRows, bankCounts] = await Promise.all([
      db.select().from(exams).orderBy(asc(exams.createdAt)),
      db.select().from(examSeries).where(ne(examSeries.status, "archived")),
      db
        .select({ examId: questions.examId, n: sql<number>`count(*)::int` })
        .from(questions)
        .where(eq(questions.isActive, true))
        .groupBy(questions.examId),
    ]);
    const dtos = await toSeriesDtos(db, seriesRows);
    const overview: ExamOverviewDto[] = examRows.map((e) => {
      const mine = dtos.filter((s) => s.examId === e.id);
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
    const [exam] = await db.select({ id: exams.id }).from(exams).where(eq(exams.id, params.data.id));
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
};
