import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  chapters,
  examSeries,
  seriesQuestions,
  seriesRosterSlots,
  questionIngestionJobs,
  questions,
  subjects,
  subtopics,
  testAttempts,
} from "../db/schema";
import type {
  AssignedQuestionDto,
  BilingualText,
  BankSupplyDto,
  BlueprintDto,
  RosterDto,
  RosterSlotDto,
  SeriesDto,
  VacancyDto,
} from "../../../../packages/shared-types/src/index";
import {
  buildRosterState,
  freeTarget,
  fullReason,
  matchingChain,
  slotLevel,
  slotVacancies,
  vacancyFor,
  type Labeler,
  type NodePath,
  type RosterState,
  type SlotNode,
} from "./roster";

// ============================================================================
// Test series persistence: blueprints, selected questions and the numbers shown
// in the admin console. Every write that depends on counts runs in a
// transaction holding `SELECT … FOR UPDATE` on the series row, so two admins
// selecting at once — or one editing the blueprint while another selects — are
// serialised and can never over-fill.
// ============================================================================

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Dbx = typeof db | Tx;
/** Staging statuses whose rows still hold a blueprint vacancy for their series. */
export const RESERVING_STATUSES = ["pending_ai", "pending_review", "approved"] as const;

export class SeriesError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

// ─── Syllabus of one exam ───────────────────────────────────────────────────

interface TaxNode {
  id: string;
  slug: string;
  name: BilingualText;
}

export interface ExamTaxonomy {
  subjects: Map<string, TaxNode>;
  chapters: Map<string, TaxNode & { subjectId: string }>;
  subtopics: Map<string, TaxNode & { subjectId: string; chapterId: string }>;
  /** "subject-slug/chapter-slug/subtopic-slug" → path in this exam */
  bySlugPath: Map<string, NodePath>;
  label: Labeler;
  pathOfSubtopic: (subtopicId: string) => NodePath | null;
}

export const slugPathKey = (subject: string, chapter: string, subtopic: string) =>
  `${subject}/${chapter}/${subtopic}`;

export async function loadExamTaxonomy(dbx: Dbx, examId: string): Promise<ExamTaxonomy> {
  const subjectRows = await dbx
    .select({ id: subjects.id, slug: subjects.slug, name: subjects.name })
    .from(subjects)
    .where(eq(subjects.examId, examId));
  const subjectIds = subjectRows.map((s) => s.id);
  const [chapterRows, subtopicRows] = subjectIds.length
    ? await Promise.all([
        dbx
          .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, subjectId: chapters.subjectId })
          .from(chapters)
          .where(inArray(chapters.subjectId, subjectIds)),
        dbx
          .select({
            id: subtopics.id,
            slug: subtopics.slug,
            name: subtopics.name,
            subjectId: subtopics.subjectId,
            chapterId: subtopics.chapterId,
          })
          .from(subtopics)
          .where(inArray(subtopics.subjectId, subjectIds)),
      ])
    : [[], []];

  const tax: ExamTaxonomy = {
    subjects: new Map(subjectRows.map((s) => [s.id, s])),
    chapters: new Map(chapterRows.map((c) => [c.id, c])),
    subtopics: new Map(subtopicRows.map((t) => [t.id, t])),
    bySlugPath: new Map(),
    label: (s) =>
      [
        tax.subjects.get(s.subjectId)?.name.en ?? "Unknown subject",
        s.chapterId ? (tax.chapters.get(s.chapterId)?.name.en ?? "Unknown chapter") : null,
        s.subtopicId ? (tax.subtopics.get(s.subtopicId)?.name.en ?? "Unknown subtopic") : null,
      ]
        .filter(Boolean)
        .join(" → "),
    pathOfSubtopic: (id) => {
      const t = tax.subtopics.get(id);
      return t ? { subjectId: t.subjectId, chapterId: t.chapterId, subtopicId: t.id } : null;
    },
  };
  for (const t of subtopicRows) {
    const subj = tax.subjects.get(t.subjectId);
    const chap = tax.chapters.get(t.chapterId);
    if (subj && chap) {
      tax.bySlugPath.set(slugPathKey(subj.slug, chap.slug, t.slug), {
        subjectId: subj.id,
        chapterId: chap.id,
        subtopicId: t.id,
      });
    }
  }
  return tax;
}

// ─── Loading ────────────────────────────────────────────────────────────────

export type SeriesRow = typeof examSeries.$inferSelect;

/** Locks a series row: every blueprint edit and question change takes it. */
export async function lockSeries(tx: Tx, seriesId: string): Promise<SeriesRow> {
  const [series] = await tx.select().from(examSeries).where(eq(examSeries.id, seriesId)).for("update");
  if (!series) throw new SeriesError("Series not found", 404);
  return series;
}

export async function getSeries(dbx: Dbx, seriesId: string): Promise<SeriesRow> {
  const [series] = await dbx.select().from(examSeries).where(eq(examSeries.id, seriesId)).limit(1);
  if (!series) throw new SeriesError("Series not found", 404);
  return series;
}

/** Blueprint slots of the given series. */
export async function loadSlots(dbx: Dbx, seriesIds: string[]): Promise<Array<SlotNode & { seriesId: string }>> {
  if (seriesIds.length === 0) return [];
  return dbx
    .select({
      id: seriesRosterSlots.id,
      seriesId: seriesRosterSlots.seriesId,
      subjectId: seriesRosterSlots.subjectId,
      chapterId: seriesRosterSlots.chapterId,
      subtopicId: seriesRosterSlots.subtopicId,
      targetCount: seriesRosterSlots.targetCount,
    })
    .from(seriesRosterSlots)
    .where(inArray(seriesRosterSlots.seriesId, seriesIds))
    .orderBy(asc(seriesRosterSlots.createdAt));
}

export async function loadAssignedPaths(dbx: Dbx, seriesId: string): Promise<NodePath[]> {
  return dbx
    .select({
      subjectId: seriesQuestions.subjectId,
      chapterId: seriesQuestions.chapterId,
      subtopicId: seriesQuestions.subtopicId,
    })
    .from(seriesQuestions)
    .where(eq(seriesQuestions.seriesId, seriesId));
}

async function loadReservedPaths(dbx: Dbx, seriesId: string): Promise<NodePath[]> {
  const rows = await dbx
    .select({
      subjectId: questionIngestionJobs.subjectId,
      chapterId: questionIngestionJobs.chapterId,
      subtopicId: questionIngestionJobs.subtopicId,
    })
    .from(questionIngestionJobs)
    .where(
      and(
        eq(questionIngestionJobs.targetSeriesId, seriesId),
        inArray(questionIngestionJobs.status, [...RESERVING_STATUSES]),
        isNotNull(questionIngestionJobs.subtopicId)
      )
    );
  return rows.filter((r): r is NodePath => !!(r.subjectId && r.chapterId && r.subtopicId));
}

/** A series' selected questions counted against its blueprint. */
export async function rosterStateFor(
  dbx: Dbx,
  seriesId: string
): Promise<{ slots: SlotNode[]; state: RosterState }> {
  const [slots, assigned, reserved] = await Promise.all([
    loadSlots(dbx, [seriesId]),
    loadAssignedPaths(dbx, seriesId),
    loadReservedPaths(dbx, seriesId),
  ]);
  return { slots, state: buildRosterState(slots, assigned, reserved) };
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

/** Duration and marking of a test series. */
export interface Marking {
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarksPerWrong: number;
  estimatedCutoffMarks: number;
}

export const seriesMarking = (s: SeriesRow): Marking => ({
  durationMinutes: s.durationMinutes,
  marksPerCorrect: Number(s.marksPerCorrect),
  negativeMarksPerWrong: Number(s.negativeMarksPerWrong),
  estimatedCutoffMarks: Number(s.estimatedCutoffMarks),
});

/** Admin view of several series: blueprint subjects, bank supply, selection. */
export async function toSeriesDtos(dbx: Dbx, rows: SeriesRow[]): Promise<SeriesDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [slots, selectedRows, reserved, attempts] = await Promise.all([
    loadSlots(dbx, ids),
    dbx
      .select({
        seriesId: seriesQuestions.seriesId,
        subjectId: seriesQuestions.subjectId,
        n: sql<number>`count(*)::int`,
      })
      .from(seriesQuestions)
      .where(inArray(seriesQuestions.seriesId, ids))
      .groupBy(seriesQuestions.seriesId, seriesQuestions.subjectId),
    dbx
      .select({ seriesId: questionIngestionJobs.targetSeriesId, n: sql<number>`count(*)::int` })
      .from(questionIngestionJobs)
      .where(
        and(
          inArray(questionIngestionJobs.targetSeriesId, ids),
          inArray(questionIngestionJobs.status, [...RESERVING_STATUSES])
        )
      )
      .groupBy(questionIngestionJobs.targetSeriesId),
    dbx
      .select({
        seriesId: testAttempts.seriesId,
        n: sql<number>`count(*)::int`,
        students: sql<number>`count(distinct ${testAttempts.userId})::int`,
        avgScore: sql<number | null>`round(avg(${testAttempts.finalNetScore})::numeric, 2)::float`,
      })
      .from(testAttempts)
      .where(inArray(testAttempts.seriesId, ids))
      .groupBy(testAttempts.seriesId),
  ]);
  const subjectSlots = slots.filter((x) => x.chapterId === null);
  const subjectIds = [...new Set(subjectSlots.map((x) => x.subjectId))];
  const [names, inBank] = subjectIds.length
    ? await Promise.all([
        dbx.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, subjectIds)),
        dbx
          .select({ subjectId: questions.subjectId, n: sql<number>`count(*)::int` })
          .from(questions)
          .where(and(inArray(questions.subjectId, subjectIds), eq(questions.isActive, true)))
          .groupBy(questions.subjectId),
      ])
    : [[], []];

  return rows.map((r) => {
    const blueprint = subjectSlots.filter((x) => x.seriesId === r.id);
    const total = buildRosterState(
      slots.filter((x) => x.seriesId === r.id),
      []
    ).rosterTotal;
    const mine = selectedRows.filter((x) => x.seriesId === r.id);
    const selectedCount = mine.reduce((sum, x) => sum + x.n, 0);
    const att = attempts.find((x) => x.seriesId === r.id);
    return {
      id: r.id,
      examId: r.examId,
      slug: r.slug,
      name: r.name,
      description: r.description,
      kind: r.kind,
      status: r.status,
      displayOrder: r.displayOrder,
      ...seriesMarking(r),
      totalQuestions: total,
      subjects: blueprint.map((x) => ({
        subjectId: x.subjectId,
        label: names.find((n) => n.id === x.subjectId)?.name.en ?? "Subject",
        targetCount: x.targetCount,
        inBank: inBank.find((b) => b.subjectId === x.subjectId)?.n ?? 0,
        selected: mine.filter((c) => c.subjectId === x.subjectId).reduce((sum, c) => sum + c.n, 0),
      })),
      selectedCount,
      reservedCount: reserved.find((x) => x.seriesId === r.id)?.n ?? 0,
      completionPct: total > 0 ? Math.min(100, Math.round((selectedCount / total) * 100)) : 0,
      attemptCount: att?.n ?? 0,
      studentCount: att?.students ?? 0,
      averageScore: att && att.n > 0 ? (att.avgScore ?? 0) : null,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export async function buildRosterDto(dbx: Dbx, seriesId: string): Promise<RosterDto> {
  const series = await getSeries(dbx, seriesId);
  const [tax, { slots, state }, [seriesDto], assignedRows] = await Promise.all([
    loadExamTaxonomy(dbx, series.examId),
    rosterStateFor(dbx, seriesId),
    toSeriesDtos(dbx, [series]),
    dbx
      .select({ pq: seriesQuestions, q: questions })
      .from(seriesQuestions)
      .innerJoin(questions, eq(seriesQuestions.questionId, questions.id))
      .where(eq(seriesQuestions.seriesId, seriesId))
      .orderBy(asc(seriesQuestions.position), asc(seriesQuestions.createdAt)),
  ]);

  const slotDtos: RosterSlotDto[] = slots.map((s) => {
    const assignedIn = state.assignedIn.get(s.id) ?? 0;
    return {
      id: s.id,
      level: slotLevel(s),
      subjectId: s.subjectId,
      chapterId: s.chapterId,
      subtopicId: s.subtopicId,
      label: tax.label(s),
      parentSlotId: state.parentId.get(s.id) ?? null,
      targetCount: s.targetCount,
      assignedCount: assignedIn,
      reservedCount: state.reservedIn.get(s.id) ?? 0,
      freeTarget: freeTarget(state, s),
      vacancies: slotVacancies(state, s),
      isFull: assignedIn >= s.targetCount,
    };
  });

  const assigned: AssignedQuestionDto[] = assignedRows.map(({ pq, q }) => {
    const chain = matchingChain(slots, pq);
    return {
      assignmentId: pq.id,
      questionId: q.id,
      position: pq.position,
      subjectId: pq.subjectId,
      chapterId: pq.chapterId,
      subtopicId: pq.subtopicId,
      slotId: chain.length ? chain[chain.length - 1].id : null,
      pathLabel: tax.label(pq),
      stem: q.stem,
      options: q.options,
      correctOption: q.correctOption,
      explanation: q.explanation,
      difficulty: q.difficulty,
      source: q.source,
      previousYearTag: q.previousYearTag,
      crossExam: q.examId !== series.examId,
    };
  });

  const warnings: string[] = [];
  if (slots.length === 0) {
    warnings.push("This series has no subjects yet — give its subjects question counts first.");
  }
  if (state.unslottedAssigned > 0) {
    warnings.push(`${state.unslottedAssigned} assigned question(s) are outside the series blueprint.`);
  }

  return {
    series: seriesDto,
    slots: slotDtos,
    assigned,
    rosterTotal: state.rosterTotal,
    assignedTotal: assigned.length,
    completionPct: seriesDto.completionPct,
    warnings,
  };
}

export function toVacancyDto(
  seriesId: string,
  state: RosterState,
  path: NodePath,
  label: Labeler
): VacancyDto {
  const assign = vacancyFor(state, path, "assign", label);
  const generate = vacancyFor(state, path, "generate", label);
  const where = label(path);
  const binding = generate.binding;
  return {
    seriesId,
    eligible: assign.eligible,
    assignable: assign.allowed,
    generatable: generate.allowed,
    limits: generate.limits,
    bindingSlotId: generate.bindingSlotId,
    message: !assign.eligible
      ? `${where} is not part of this series' blueprint.`
      : generate.allowed === 0
        ? binding?.note
          ? `${binding.note}.`
          : `${binding?.label ?? where} is full (${binding?.used ?? 0}/${binding?.target ?? 0}, counting pending AI drafts).`
        : `${generate.allowed} vacanc${generate.allowed === 1 ? "y" : "ies"} left for ${where}` +
          (binding && binding.label !== where ? ` (limited by ${binding.label})` : "") +
          ".",
  };
}

// ─── Assignment ─────────────────────────────────────────────────────────────

export interface AssignOutcome {
  assigned: Array<{ questionId: string; assignmentId: string }>;
  failed: Array<{ questionId: string; reason: string }>;
  slotsFilled: string[];
}

/**
 * Adds bank questions to a LOCKED series (call `lockSeries` in the same
 * transaction first). Each question is validated on its own; failures are
 * reported, never partially written.
 */
export async function assignQuestions(
  tx: Tx,
  series: SeriesRow,
  questionIds: string[],
  opts: { subtopicId?: string | null; userId?: string | null } = {}
): Promise<AssignOutcome> {
  if (series.status === "archived") {
    throw new SeriesError("This series is archived — restore it to draft before changing questions", 409);
  }
  const tax = await loadExamTaxonomy(tx, series.examId);
  let override: NodePath | null = null;
  if (opts.subtopicId) {
    override = tax.pathOfSubtopic(opts.subtopicId);
    if (!override) throw new SeriesError("That subtopic is not part of this series' exam syllabus", 400);
  }

  const uniqueIds = [...new Set(questionIds)];
  const [slots, assignedPaths, existing, qRows, [{ maxPos }]] = await Promise.all([
    loadSlots(tx, [series.id]),
    loadAssignedPaths(tx, series.id),
    tx
      .select({ questionId: seriesQuestions.questionId })
      .from(seriesQuestions)
      .where(and(eq(seriesQuestions.seriesId, series.id), inArray(seriesQuestions.questionId, uniqueIds))),
    tx
      .select({
        id: questions.id,
        examId: questions.examId,
        isActive: questions.isActive,
        subjectId: questions.subjectId,
        chapterId: questions.chapterId,
        subtopicId: questions.subtopicId,
        subjectSlug: subjects.slug,
        chapterSlug: chapters.slug,
        subtopicSlug: subtopics.slug,
      })
      .from(questions)
      .innerJoin(subjects, eq(questions.subjectId, subjects.id))
      .innerJoin(chapters, eq(questions.chapterId, chapters.id))
      .innerJoin(subtopics, eq(questions.subtopicId, subtopics.id))
      .where(inArray(questions.id, uniqueIds)),
    tx
      .select({ maxPos: sql<number>`coalesce(max(${seriesQuestions.position}), -1)::int` })
      .from(seriesQuestions)
      .where(eq(seriesQuestions.seriesId, series.id)),
  ]);

  const already = new Set(existing.map((r) => r.questionId));
  const byId = new Map(qRows.map((q) => [q.id, q]));
  const paths = [...assignedPaths];
  let state = buildRosterState(slots, paths);
  const fullBefore = new Set(
    slots.filter((s) => (state.assignedIn.get(s.id) ?? 0) >= s.targetCount).map((s) => s.id)
  );
  let position = maxPos;

  const outcome: AssignOutcome = { assigned: [], failed: [], slotsFilled: [] };
  for (const questionId of uniqueIds) {
    const q = byId.get(questionId);
    const fail = (reason: string) => outcome.failed.push({ questionId, reason });
    if (!q) {
      fail("Question not found in the bank");
      continue;
    }
    if (!q.isActive) {
      fail("Question is retired (inactive)");
      continue;
    }
    if (already.has(questionId)) {
      fail("Already in this series");
      continue;
    }

    const path: NodePath | null =
      override ??
      (q.examId === series.examId
        ? { subjectId: q.subjectId, chapterId: q.chapterId, subtopicId: q.subtopicId }
        : (tax.bySlugPath.get(slugPathKey(q.subjectSlug, q.chapterSlug, q.subtopicSlug)) ?? null));
    if (!path) {
      fail(
        `From another exam and "${q.subjectSlug} / ${q.chapterSlug} / ${q.subtopicSlug}" doesn't exist in this exam's syllabus — choose a subtopic to classify it under`
      );
      continue;
    }

    const vacancy = vacancyFor(state, path, "assign", tax.label);
    if (!vacancy.eligible) {
      fail(`${tax.label(path)} is not part of this series' blueprint`);
      continue;
    }
    if (vacancy.allowed <= 0) {
      fail(fullReason(vacancy, tax.label(path)));
      continue;
    }

    position += 1;
    const [row] = await tx
      .insert(seriesQuestions)
      .values({
        seriesId: series.id,
        examId: series.examId,
        questionId,
        ...path,
        position,
        assignedBy: opts.userId ?? null,
      })
      .onConflictDoNothing({ target: [seriesQuestions.seriesId, seriesQuestions.questionId] })
      .returning({ id: seriesQuestions.id });
    if (!row) {
      fail("Already in this series");
      continue;
    }
    already.add(questionId);
    paths.push(path);
    state = buildRosterState(slots, paths);
    outcome.assigned.push({ questionId, assignmentId: row.id });
  }

  outcome.slotsFilled = slots
    .filter((s) => !fullBefore.has(s.id) && (state.assignedIn.get(s.id) ?? 0) >= s.targetCount)
    .map((s) => tax.label(s));
  return outcome;
}

/** Removes one question from a LOCKED series. */
export async function removeAssignment(tx: Tx, series: SeriesRow, questionId: string): Promise<boolean> {
  if (series.status === "archived") {
    throw new SeriesError("This series is archived — restore it to draft before changing questions", 409);
  }
  const removed = await tx
    .delete(seriesQuestions)
    .where(and(eq(seriesQuestions.seriesId, series.id), eq(seriesQuestions.questionId, questionId)))
    .returning({ id: seriesQuestions.id });
  return removed.length > 0;
}

export async function touchSeries(tx: Tx, seriesId: string) {
  await tx.update(examSeries).set({ updatedAt: new Date() }).where(eq(examSeries.id, seriesId));
}

// ─── Series blueprint ───────────────────────────────────────────────────────

/**
 * Approved questions and pending drafts per syllabus node of one exam, keyed
 * "subject|chapter|subtopic" at all three levels (broader levels leave parts
 * empty), so the blueprint can show where the bank is short.
 */
export async function bankSupply(dbx: Dbx, examId: string): Promise<Record<string, BankSupplyDto>> {
  const [live, pending] = await Promise.all([
    dbx
      .select({
        subjectId: questions.subjectId,
        chapterId: questions.chapterId,
        subtopicId: questions.subtopicId,
        n: sql<number>`count(*)::int`,
      })
      .from(questions)
      .where(and(eq(questions.examId, examId), eq(questions.isActive, true)))
      .groupBy(questions.subjectId, questions.chapterId, questions.subtopicId),
    dbx
      .select({
        subjectId: questionIngestionJobs.subjectId,
        chapterId: questionIngestionJobs.chapterId,
        subtopicId: questionIngestionJobs.subtopicId,
        n: sql<number>`count(*)::int`,
      })
      .from(questionIngestionJobs)
      .where(
        and(
          eq(questionIngestionJobs.examId, examId),
          inArray(questionIngestionJobs.status, ["pending_ai", "pending_review"]),
          isNotNull(questionIngestionJobs.subtopicId)
        )
      )
      .groupBy(questionIngestionJobs.subjectId, questionIngestionJobs.chapterId, questionIngestionJobs.subtopicId),
  ]);
  const supply: Record<string, BankSupplyDto> = {};
  const add = (row: { subjectId: string | null; chapterId: string | null; subtopicId: string | null; n: number }, field: keyof BankSupplyDto) => {
    if (!row.subjectId || !row.chapterId || !row.subtopicId) return;
    for (const key of [
      `${row.subjectId}||`,
      `${row.subjectId}|${row.chapterId}|`,
      `${row.subjectId}|${row.chapterId}|${row.subtopicId}`,
    ]) {
      supply[key] ??= { live: 0, pending: 0 };
      supply[key][field] += row.n;
    }
  };
  live.forEach((row) => add(row, "live"));
  pending.forEach((row) => add(row, "pending"));
  return supply;
}

export async function buildBlueprintDto(dbx: Dbx, series: SeriesRow): Promise<BlueprintDto> {
  const [tax, slots, bank] = await Promise.all([
    loadExamTaxonomy(dbx, series.examId),
    loadSlots(dbx, [series.id]),
    bankSupply(dbx, series.examId),
  ]);
  const state = buildRosterState(slots, []);
  return {
    seriesId: series.id,
    totalQuestions: state.rosterTotal,
    bank,
    slots: slots.map((s) => ({
      id: s.id,
      level: slotLevel(s),
      subjectId: s.subjectId,
      chapterId: s.chapterId,
      subtopicId: s.subtopicId,
      label: tax.label(s),
      parentSlotId: state.parentId.get(s.id) ?? null,
      targetCount: s.targetCount,
      freeTarget: freeTarget(state, s),
    })),
  };
}
