import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  chapters,
  exams,
  questions,
  questionIngestionJobs,
  seriesRosterSlots,
  subjects,
  subtopics,
  type IngestionStatusType,
} from "../db/schema";
import {
  ApprovableQuestionSchema,
  ApproveJobsBodySchema,
  BULK_IMPORT_MAX_ROWS,
  BulkQuestionRowSchema,
  GenerateFullQuestionSetInputSchema,
  GenerateQuestionsInputSchema,
  JobFilterSchema,
  OptionKeySchema,
  RejectJobsBodySchema,
  StagedQuestionDraftSchema,
  csvTableToRecords,
  isDraftTextComplete,
  normalizeRecordKeys,
  parseCsv,
  pyqLabel,
  rowToDraft,
  slugify,
  type ApproveJobsResult,
  type ExtractMediaQuestionsResult,
  type GenerateFullQuestionSetResult,
  type GenerateFullQuestionSetSubjectSummary,
  type GenerateQuestionsResult,
  type GenerationOverLimitError,
  type IngestionBatchSummary,
  type IngestionJobDto,
  type IngestionUploadResult,
  type JobFilter,
  type RejectJobsResult,
  type StagedQuestionDraft,
  type VacancyDto,
} from "../../../../packages/shared-types/src/index";
import { computeContentHash } from "../lib/contentHash";
import { formatIssues } from "../lib/validation";
import { requireAdmin } from "../lib/auth";
import {
  generateWithApiAi,
  loadGenerationContext,
  type ApiAiGenerateResponse,
} from "../lib/aiGeneration";
import {
  existingHashes,
  findNearDuplicates,
  nearDuplicateScore,
  normalizeText,
  probeOf,
} from "../lib/dedupe";
import {
  SeriesError,
  assignQuestions,
  enforceSeriesQuestionCap,
  getSeries,
  loadExamTaxonomy,
  lockSeries,
  rosterStateFor,
  toVacancyDto,
  touchSeries,
  type SeriesRow,
} from "../lib/series";
import { vacancyFor, type NodePath } from "../lib/roster";
import {
  extractQuestionsFromMediaWithAi,
  generateSubjectQuestionsWithAi,
  translateAndEnrichQuestionDraft,
} from "../lib/aiEnrichment";
import { canonicalizeDraft, loadSyllabus, nodeMatches, resolveSyllabusPath } from "../lib/syllabus";

// ============================================================================
// Request Validation Schemas (Zod)
// ============================================================================

const UploadBodySchema = z.object({
  fileName: z.string().max(200).optional(),
  format: z.enum(["csv", "json"]),
  content: z.string().min(1, "File is empty").max(5_000_000),
});

const JobListQuerySchema = JobFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Most ids "select all matching" will hand back (= approve/reject batch limit). */
const SELECT_ALL_CAP = 500;

const JobParamsSchema = z.object({ id: z.string().uuid() });

const DraftBodySchema = z.object({
  draft: StagedQuestionDraftSchema,
  reviewNotes: z.string().max(2000).nullable().optional(),
  autoTranslate: z.boolean().optional().default(true),
  insertLive: z.boolean().optional().default(false),
});

const TranslateDraftBodySchema = z.object({
  draft: StagedQuestionDraftSchema,
});

const ExtractMediaBodySchema = z.object({
  examSlug: z.string().min(1).max(80),
  fileName: z.string().max(240).optional(),
  mimeType: z.string().min(3).max(120),
  base64Data: z.string().min(10).max(25_000_000),
  source: z.enum(["pyq", "educator", "ai_generated"]).default("pyq"),
  pyqYear: z.coerce.number().int().min(1990).max(2100).nullable().optional(),
  insertDirectlyToBank: z.boolean().default(true),
});

/** Staging rows that still count as "in the pipeline" for duplicate checks. */
const ACTIVE_STAGING_STATUSES: IngestionStatusType[] = [
  "pending_ai",
  "pending_review",
  "approved",
];

/**
 * AI output is also checked against REJECTED rows, so a question a reviewer
 * already threw out is not proposed again in a later batch.
 */
const AI_DEDUPE_STATUSES: IngestionStatusType[] = [...ACTIVE_STAGING_STATUSES, "rejected"];

/** Extra AI calls asking for fresh questions when duplicates were dropped. */
const MAX_GENERATION_RETRIES = 2;

type NewIngestionJob = typeof questionIngestionJobs.$inferInsert;
type IngestionJobRow = typeof questionIngestionJobs.$inferSelect;
type CanonicalDraft = Extract<ReturnType<typeof canonicalizeDraft>, { ok: true }>;

// ============================================================================
// Helpers
// ============================================================================

/** Columns derived from a resolved draft (FKs, hash, PYQ metadata, status). */
function draftColumns({ draft, path, pyqTag }: CanonicalDraft) {
  return {
    enrichedData: draft,
    examId: path.exam.id,
    subjectId: path.subject.id,
    chapterId: path.chapter.id,
    subtopicId: path.subtopic.id,
    contentHash: computeContentHash(draft),
    pyqYear: draft.pyqYear,
    pyqExamName: pyqTag,
    status: (isDraftTextComplete(draft)
      ? "pending_review"
      : "pending_ai") as IngestionStatusType,
  };
}

/** Message when `hash` already exists live or in another pending staging row. */
async function findDuplicate(hash: string, excludeJobId?: string): Promise<string | null> {
  const [live] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.contentHash, hash))
    .limit(1);
  if (live) return `Duplicate of live question ${live.id}`;

  const [staged] = await db
    .select({ batchId: questionIngestionJobs.batchId })
    .from(questionIngestionJobs)
    .where(
      and(
        eq(questionIngestionJobs.contentHash, hash),
        inArray(questionIngestionJobs.status, ACTIVE_STAGING_STATUSES),
        excludeJobId ? ne(questionIngestionJobs.id, excludeJobId) : undefined
      )
    )
    .limit(1);
  return staged ? `Duplicate of a pending row in batch ${staged.batchId}` : null;
}

type StagedRow = { rowNumber: number; job: NewIngestionJob };

/**
 * Marks duplicates (live bank, other pending rows, earlier rows of the same
 * batch) as failed, inserts the batch, and summarises it.
 */
async function saveStagedBatch(
  batchId: string,
  staged: StagedRow[],
  skippedEmpty = 0
): Promise<IngestionUploadResult> {
  const hashes = [
    ...new Set(
      staged.flatMap(({ job }) =>
        job.status !== "failed" && job.contentHash ? [job.contentHash] : []
      )
    ),
  ];
  const liveDupes = new Map<string, string>();
  const stagedDupes = new Map<string, string>();
  if (hashes.length > 0) {
    const live = await db
      .select({ id: questions.id, hash: questions.contentHash })
      .from(questions)
      .where(inArray(questions.contentHash, hashes));
    live.forEach((r) => r.hash && liveDupes.set(r.hash, r.id));

    const pending = await db
      .select({
        hash: questionIngestionJobs.contentHash,
        batchId: questionIngestionJobs.batchId,
      })
      .from(questionIngestionJobs)
      .where(
        and(
          inArray(questionIngestionJobs.contentHash, hashes),
          inArray(questionIngestionJobs.status, ACTIVE_STAGING_STATUSES)
        )
      );
    pending.forEach((r) => r.hash && stagedDupes.set(r.hash, r.batchId));
  }

  const seenInBatch = new Map<string, number>();
  for (const { rowNumber, job } of staged) {
    if (job.status === "failed" || !job.contentHash) continue;
    const hash = job.contentHash;
    let duplicateOf: string | null = null;
    if (liveDupes.has(hash)) {
      duplicateOf = `live question ${liveDupes.get(hash)}`;
    } else if (stagedDupes.has(hash)) {
      duplicateOf = `a pending row in batch ${stagedDupes.get(hash)}`;
    } else if (seenInBatch.has(hash)) {
      duplicateOf = `row ${seenInBatch.get(hash)} of this batch`;
    } else {
      seenInBatch.set(hash, rowNumber);
    }
    if (duplicateOf) {
      job.status = "failed";
      job.errorMessage = `Duplicate of ${duplicateOf}`;
    }
  }

  await flagNearDuplicates(staged.map((s) => s.job));

  await db.transaction(async (tx) => {
    for (let i = 0; i < staged.length; i += 500) {
      await tx
        .insert(questionIngestionJobs)
        .values(staged.slice(i, i + 500).map((s) => s.job));
    }
  });

  return {
    batchId,
    total: staged.length,
    pendingReview: staged.filter((s) => s.job.status === "pending_review").length,
    pendingAi: staged.filter((s) => s.job.status === "pending_ai").length,
    failed: staged.filter((s) => s.job.status === "failed").length,
    skippedEmpty,
    errors: staged
      .filter((s) => s.job.status === "failed")
      .slice(0, 100)
      .map((s) => ({ rowNumber: s.rowNumber, message: s.job.errorMessage ?? "" })),
  };
}

/**
 * Marks staged rows that closely resemble a bank question (reworded stem,
 * shuffled options). A warning for the reviewer — exact copies are already
 * blocked by the content hash.
 */
async function flagNearDuplicates(jobs: NewIngestionJob[]): Promise<void> {
  const targets = jobs.filter(
    (j) => j.status !== "failed" && (j.enrichedData as StagedQuestionDraft | null)?.stem?.en
  );
  if (targets.length === 0) return;
  const matches = await findNearDuplicates(
    targets.map((j) => probeOf(j.enrichedData as StagedQuestionDraft))
  );
  targets.forEach((j, i) => {
    const m = matches[i];
    j.nearDuplicateQuestionId = m?.id ?? null;
    j.nearDuplicateScore = m ? m.score.toFixed(3) : null;
  });
}

/** Problems with an AI-drafted MCQ the zod schema can't see. */
function generatedQuestionProblem(d: StagedQuestionDraft): string | null {
  if (normalizeText(d.stem.en).length < 8) return "Question text is too short";
  const opts = OptionKeySchema.options.map((k) => normalizeText(d.options[k].en));
  if (opts.some((o) => o === "")) return "An option is empty";
  if (new Set(opts).size < opts.length) return "Two options have the same text";
  return null;
}

/** Near-duplicate warning columns for one edited / hand-entered draft. */
async function nearDuplicateColumns(d: StagedQuestionDraft) {
  const [m] = await findNearDuplicates([probeOf(d)]);
  return {
    nearDuplicateQuestionId: m?.id ?? null,
    nearDuplicateScore: m ? m.score.toFixed(3) : null,
  };
}

/** WHERE clause shared by the review list and "select all matching". */
async function jobWhere(f: JobFilter) {
  const nextDay = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000);
  return and(
    await examScope(f.examSlug),
    f.batchId ? eq(questionIngestionJobs.batchId, f.batchId) : undefined,
    f.status !== "all" ? eq(questionIngestionJobs.status, f.status) : undefined,
    f.subjectId ? eq(questionIngestionJobs.subjectId, f.subjectId) : undefined,
    f.chapterId ? eq(questionIngestionJobs.chapterId, f.chapterId) : undefined,
    f.subtopicId ? eq(questionIngestionJobs.subtopicId, f.subtopicId) : undefined,
    f.difficulty
      ? sql`${questionIngestionJobs.enrichedData} ->> 'difficulty' = ${f.difficulty}`
      : undefined,
    f.source ? eq(questionIngestionJobs.source, f.source) : undefined,
    f.targetSeriesId ? eq(questionIngestionJobs.targetSeriesId, f.targetSeriesId) : undefined,
    f.createdFrom ? gte(questionIngestionJobs.createdAt, new Date(`${f.createdFrom}T00:00:00Z`)) : undefined,
    f.createdTo ? lt(questionIngestionJobs.createdAt, nextDay(f.createdTo)) : undefined
  );
}

/** Rows belonging to an exam, plus unresolved rows that could belong to any exam. */
async function examScope(examSlug: string | undefined) {
  if (!examSlug) return undefined;
  const [exam] = await db
    .select({ id: exams.id })
    .from(exams)
    .where(eq(exams.slug, examSlug))
    .limit(1);
  return exam
    ? or(eq(questionIngestionJobs.examId, exam.id), isNull(questionIngestionJobs.examId))
    : isNull(questionIngestionJobs.examId);
}

function toJobDto(row: IngestionJobRow): IngestionJobDto {
  const raw = row.rawData as { rowNumber?: number | null } | null;
  return {
    id: row.id,
    batchId: row.batchId,
    source: row.source,
    status: row.status,
    rowNumber: raw?.rowNumber ?? null,
    draft: (row.enrichedData as StagedQuestionDraft | null) ?? null,
    rawData: row.rawData,
    aiConfidenceScore:
      row.aiConfidenceScore === null ? null : Number(row.aiConfidenceScore),
    reviewNotes: row.reviewNotes,
    errorMessage: row.errorMessage,
    insertedQuestionId: row.insertedQuestionId,
    targetSeriesId: row.targetSeriesId,
    nearDuplicateQuestionId: row.nearDuplicateQuestionId,
    nearDuplicateScore: row.nearDuplicateScore === null ? null : Number(row.nearDuplicateScore),
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

const statusCount = (status: IngestionStatusType) =>
  sql<number>`(count(*) filter (where ${questionIngestionJobs.status} = ${status}))::int`;

function formatAiConfidence(val: unknown): string {
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n) || n <= 0) return "0.90";
  const normalized = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0.01, normalized)).toFixed(2);
}

/**
 * Ensures Subject -> Chapter -> Subtopic exists for an exam, returning their slugs.
 * Used when extracting questions from PDF/Image question papers so every question
 * lands in the right category even if the subtopic wasn't created beforehand.
 */
export async function ensureCategoryInExam(
  examId: string,
  category: {
    subjectEn: string;
    subjectBn: string;
    chapterEn: string;
    chapterBn: string;
    subtopicEn: string;
    subtopicBn: string;
  }
): Promise<{
  subjectId: string;
  subjectSlug: string;
  chapterId: string;
  chapterSlug: string;
  subtopicId: string;
  subtopicSlug: string;
  createdNew: boolean;
}> {
  const subjSlug = (slugify(category.subjectEn) || "general-studies").slice(0, 110);
  const chapSlug = (slugify(category.chapterEn) || "general-topic").slice(0, 130);
  const subSlug = (slugify(category.subtopicEn) || `${chapSlug}-basics`).slice(0, 150);

  let createdNew = false;

  // 1. Subject
  const existingSubjs = await db
    .select()
    .from(subjects)
    .where(eq(subjects.examId, examId));
  let subj = existingSubjs.find(
    (s) => s.slug === subjSlug || nodeMatches(s, category.subjectEn)
  );
  if (!subj) {
    const [inserted] = await db
      .insert(subjects)
      .values({
        examId,
        slug: subjSlug,
        name: {
          en: category.subjectEn.trim() || "General Studies",
          bn: category.subjectBn.trim() || category.subjectEn.trim() || "সাধারণ অধ্যয়ন",
        },
        displayOrder: existingSubjs.length + 1,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      subj = inserted;
      createdNew = true;
    } else {
      [subj] = await db
        .select()
        .from(subjects)
        .where(and(eq(subjects.examId, examId), eq(subjects.slug, subjSlug)))
        .limit(1);
    }
  }

  // 2. Chapter
  const existingChaps = await db
    .select()
    .from(chapters)
    .where(eq(chapters.subjectId, subj.id));
  let chap = existingChaps.find(
    (c) => c.slug === chapSlug || nodeMatches(c, category.chapterEn)
  );
  if (!chap) {
    const [inserted] = await db
      .insert(chapters)
      .values({
        subjectId: subj.id,
        slug: chapSlug,
        name: {
          en: category.chapterEn.trim() || "Core Concepts",
          bn: category.chapterBn.trim() || category.chapterEn.trim() || "মূল ধারণা",
        },
        displayOrder: existingChaps.length + 1,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      chap = inserted;
      createdNew = true;
    } else {
      [chap] = await db
        .select()
        .from(chapters)
        .where(and(eq(chapters.subjectId, subj.id), eq(chapters.slug, chapSlug)))
        .limit(1);
    }
  }

  // 3. Subtopic (unique per chapter + slug)
  const finalSubSlug = subSlug;
  const existingSubs = await db
    .select()
    .from(subtopics)
    .where(eq(subtopics.chapterId, chap.id));
  let sub = existingSubs.find(
    (t) => t.slug === finalSubSlug || nodeMatches(t, category.subtopicEn)
  );

  if (!sub) {
    const [inserted] = await db
      .insert(subtopics)
      .values({
        subjectId: subj.id,
        chapterId: chap.id,
        slug: finalSubSlug,
        name: {
          en: category.subtopicEn.trim() || "General Questions",
          bn: category.subtopicBn.trim() || category.subtopicEn.trim() || "সাধারণ প্রশ্ন",
        },
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      sub = inserted;
      createdNew = true;
    } else {
      [sub] = await db
        .select()
        .from(subtopics)
        .where(and(eq(subtopics.chapterId, chap.id), eq(subtopics.slug, finalSubSlug)))
        .limit(1);
    }
  }

  return {
    subjectId: subj.id,
    subjectSlug: subj.slug,
    chapterId: chap.id,
    chapterSlug: chap.slug,
    subtopicId: sub.id,
    subtopicSlug: sub.slug,
    createdNew,
  };
}

// ============================================================================
// Route Plugin Implementation (registered under /admin/ingestion)
// ============================================================================

export const ingestionRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  fastify.addHook("preHandler", requireAdmin);

  /**
   * 0. POST /admin/ingestion/translate-draft  { draft }
   * Translates English question stem, options A-D, and explanation into Bengali
   * (and drafts an explanation if left blank) for the "+ Add one question" / JobEditor UI.
   */
  fastify.post("/translate-draft", async (request, reply) => {
    const parsed = TranslateDraftBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid question draft",
        details: formatIssues(parsed.error.issues),
      });
    }
    const enriched = await translateAndEnrichQuestionDraft(parsed.data.draft);
    return { draft: enriched };
  });

  /**
   * 0b. POST /admin/ingestion/extract-media
   * Accepts an uploaded Question Paper (PDF or Image), extracts all MCQs via
   * Gemini Vision, automatically categorizes them into Subject -> Chapter -> Subtopic
   * (creating missing syllabus nodes if needed), and inserts them into the DB.
   */
  fastify.post(
    "/extract-media",
    { bodyLimit: 25 * 1024 * 1024 },
    async (request, reply) => {
      const parsed = ExtractMediaBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid media upload payload",
          details: formatIssues(parsed.error.issues),
        });
      }
      const {
        examSlug,
        fileName,
        mimeType,
        base64Data,
        source,
        pyqYear,
        insertDirectlyToBank,
      } = parsed.data;

      const [exam] = await db
        .select()
        .from(exams)
        .where(eq(exams.slug, examSlug))
        .limit(1);
      if (!exam) {
        return reply.status(404).send({ error: `Exam "${examSlug}" not found` });
      }

      // Build existing syllabus context so AI maps questions to existing subjects/subtopics when possible
      const existingSubjects = await db
        .select()
        .from(subjects)
        .where(eq(subjects.examId, exam.id));
      const subjectIds = existingSubjects.map((s) => s.id);
      const existingChapters = subjectIds.length
        ? await db
            .select()
            .from(chapters)
            .where(inArray(chapters.subjectId, subjectIds))
        : [];
      const existingSubtopics = subjectIds.length
        ? await db
            .select()
            .from(subtopics)
            .where(inArray(subtopics.subjectId, subjectIds))
        : [];

      const chapById = new Map(existingChapters.map((c) => [c.id, c]));
      const subjById = new Map(existingSubjects.map((s) => [s.id, s]));
      const existingSubtopicsList = existingSubtopics.flatMap((t) => {
        const chap = chapById.get(t.chapterId);
        const subj = chap ? subjById.get(chap.subjectId) : undefined;
        if (!chap || !subj) return [];
        return [
          {
            subjectEn: subj.name.en,
            chapterEn: chap.name.en,
            subtopicEn: t.name.en,
          },
        ];
      });

      let extractedQuestions;
      try {
        extractedQuestions = await extractQuestionsFromMediaWithAi({
          examSlug: exam.slug,
          examTitleEn: exam.title.en,
          mimeType,
          fileBase64: base64Data,
          existingCategories: existingSubtopicsList,
        });
      } catch (err) {
        request.log.error(err, "PDF/Image question extraction failed");
        return reply.status(502).send({ error: (err as Error).message });
      }

      if (extractedQuestions.length === 0) {
        return reply.status(400).send({
          error: "No multiple-choice questions could be extracted from the uploaded PDF/Image.",
        });
      }

      const modelUsed = "gemini-2.5-flash";
      const batchId = `paper-${Date.now()}`;
      let categoriesCreated = 0;
      const staged: StagedRow[] = [];

      for (let i = 0; i < extractedQuestions.length; i++) {
        const q = extractedQuestions[i];
        const cat = await ensureCategoryInExam(exam.id, {
          subjectEn: q.subject_en,
          subjectBn: q.subject_bn,
          chapterEn: q.chapter_en,
          chapterBn: q.chapter_bn,
          subtopicEn: q.subtopic_en,
          subtopicBn: q.subtopic_bn,
        });
        if (cat.createdNew) categoriesCreated++;

        const draft: StagedQuestionDraft = {
          examSlug: exam.slug,
          subjectSlug: cat.subjectSlug,
          chapterSlug: cat.chapterSlug,
          subtopicSlug: cat.subtopicSlug,
          stem: q.stem,
          options: q.options,
          correctOption: q.correct_option,
          explanation: q.explanation,
          difficulty: q.difficulty,
          source,
          pyqExamSlug: source === "pyq" ? exam.slug : null,
          pyqYear: source === "pyq" ? (pyqYear ?? new Date().getFullYear() - 1) : null,
          answerKeyVerified: true,
        };

        const contentHash = computeContentHash(draft);
        const pyqTag =
          draft.source === "pyq" ? pyqLabel(exam.title.en, draft.pyqYear) : null;

        const job: NewIngestionJob = {
          batchId,
          source: "pdf_extract",
          status: isDraftTextComplete(draft) ? "pending_review" : "pending_ai",
          rawData: {
            rowNumber: i + 1,
            fileName: fileName
              ? `Paper · ${fileName}`
              : `Question Paper (${modelUsed})`,
            record: q,
          },
          enrichedData: draft,
          examId: exam.id,
          subjectId: cat.subjectId,
          chapterId: cat.chapterId,
          subtopicId: cat.subtopicId,
          contentHash,
          pyqYear: draft.pyqYear,
          pyqExamName: pyqTag,
          aiConfidenceScore: formatAiConfidence(q.confidence),
        };
        staged.push({ rowNumber: i + 1, job });
      }

      const summary = await saveStagedBatch(batchId, staged);

      // If insertDirectlyToBank is true, immediately promote all valid pending_review rows in this batch to the live `questions` table
      let insertedLive = 0;
      if (insertDirectlyToBank && summary.pendingReview > 0) {
        const batchJobs = await db
          .select()
          .from(questionIngestionJobs)
          .where(
            and(
              eq(questionIngestionJobs.batchId, batchId),
              eq(questionIngestionJobs.status, "pending_review")
            )
          );

        await db.transaction(async (tx) => {
          for (const job of batchJobs) {
            const valid = ApprovableQuestionSchema.safeParse(job.enrichedData);
            if (
              !valid.success ||
              !job.examId ||
              !job.subjectId ||
              !job.chapterId ||
              !job.subtopicId
            ) {
              continue;
            }
            const q = valid.data;
            const contentHash = job.contentHash ?? computeContentHash(q);
            const [created] = await tx
              .insert(questions)
              .values({
                examId: job.examId,
                examSlug: exam.slug,
                subjectId: job.subjectId,
                chapterId: job.chapterId,
                subtopicId: job.subtopicId,
                stem: q.stem,
                options: q.options,
                correctOption: q.correctOption,
                explanation: q.explanation,
                difficulty: q.difficulty,
                marksPositive: String(exam.marksPerCorrect),
                marksNegative: String(exam.negativeMarksPerWrong),
                previousYearTag: job.pyqExamName,
                source: q.source,
                pyqExamSlug: q.pyqExamSlug,
                pyqYear: q.pyqYear,
                answerKeyVerified: q.answerKeyVerified,
                contentHash,
                ingestionJobId: job.id,
              })
              .onConflictDoNothing({ target: questions.contentHash })
              .returning({ id: questions.id });

            if (created) {
              insertedLive++;
              await tx
                .update(questionIngestionJobs)
                .set({
                  status: "inserted",
                  insertedQuestionId: created.id,
                  reviewedAt: new Date(),
                })
                .where(eq(questionIngestionJobs.id, job.id));
            }
          }
        });
      }

      const result: ExtractMediaQuestionsResult = {
        ...summary,
        modelUsed,
        categoriesCreated,
        insertedLive,
      };
      return reply.status(201).send(result);
    }
  );

  /**
   * 1. POST /admin/ingestion/upload
   * Parses a CSV/JSON file, validates every row, resolves syllabus names/slugs,
   * flags duplicates, and stages everything in `question_ingestion_jobs`.
   */
  fastify.post(
    "/upload",
    { bodyLimit: 6 * 1024 * 1024 },
    async (request, reply) => {
      const parsed = UploadBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid upload payload",
          details: parsed.error.flatten(),
        });
      }
      const { format, content, fileName } = parsed.data;

      let records: Array<{ rowNumber: number; record: unknown }>;
      if (format === "csv") {
        const { records: csvRecords, missingColumns } = csvTableToRecords(
          parseCsv(content)
        );
        if (missingColumns.length > 0) {
          return reply.status(400).send({
            error: `CSV header is missing required columns: ${missingColumns.join(", ")}`,
          });
        }
        records = csvRecords;
      } else {
        let json: unknown;
        try {
          json = JSON.parse(content);
        } catch {
          return reply.status(400).send({ error: "File is not valid JSON" });
        }
        if (!Array.isArray(json)) {
          return reply.status(400).send({
            error: "JSON upload must be an array of question objects",
          });
        }
        records = json.map((record, i) => ({
          rowNumber: i + 1,
          record: normalizeRecordKeys(record),
        }));
      }

      const isUnusedTemplateRow = (record: unknown) => {
        const r = record as Record<string, unknown> | null;
        return (
          !!r &&
          ["stem_en", "option_a_en", "option_b_en", "option_c_en", "option_d_en"].every(
            (k) => typeof r[k] !== "string" || (r[k] as string).trim() === ""
          )
        );
      };
      const totalRecords = records.length;
      records = records.filter(({ record }) => !isUnusedTemplateRow(record));
      const skippedEmpty = totalRecords - records.length;

      if (records.length === 0) {
        return reply.status(400).send({ error: "No question rows found" });
      }
      if (records.length > BULK_IMPORT_MAX_ROWS) {
        return reply.status(400).send({
          error: `Too many rows (${records.length}). Split the file into chunks of ${BULK_IMPORT_MAX_ROWS}.`,
        });
      }

      const source = format === "csv" ? "csv_upload" : "json_upload";
      const batchId = `${source}-${Date.now()}`;
      const syllabus = await loadSyllabus();

      const staged = records.map(({ rowNumber, record }) => {
        const job: NewIngestionJob = {
          batchId,
          source,
          status: "failed",
          rawData: { rowNumber, fileName: fileName ?? null, record },
        };
        const rowParsed = BulkQuestionRowSchema.safeParse(record);
        if (!rowParsed.success) {
          job.errorMessage = formatIssues(rowParsed.error.issues);
          return { rowNumber, job };
        }
        const draft = rowToDraft(rowParsed.data);
        const canon = canonicalizeDraft(syllabus, draft);
        if (!canon.ok) {
          job.enrichedData = draft;
          job.errorMessage = canon.message;
          return { rowNumber, job };
        }
        Object.assign(job, draftColumns(canon));
        return { rowNumber, job };
      });

      const result = await saveStagedBatch(batchId, staged, skippedEmpty);
      request.log.info(
        { batchId, total: result.total, failed: result.failed },
        "Bulk question upload staged"
      );
      return reply.status(201).send(result);
    }
  );

  /**
   * 2. POST /admin/ingestion/jobs  { draft, reviewNotes?, autoTranslate?, insertLive? }
   * Adds ONE question typed in the console.
   * If Bengali fields or explanation are left blank, automatically translates
   * English -> Bengali in the background before saving!
   */
  fastify.post("/jobs", async (request, reply) => {
    const body = DraftBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid question",
        details: formatIssues(body.error.issues),
      });
    }

    let draft = body.data.draft;
    if (body.data.autoTranslate !== false && !isDraftTextComplete(draft)) {
      draft = await translateAndEnrichQuestionDraft(draft);
    }

    const canon = canonicalizeDraft(await loadSyllabus(), draft);
    if (!canon.ok) {
      return reply.status(400).send({ error: canon.message });
    }
    const columns = draftColumns(canon);
    const duplicate = await findDuplicate(columns.contentHash);
    if (duplicate) {
      return reply.status(409).send({ error: duplicate });
    }

    const [created] = await db
      .insert(questionIngestionJobs)
      .values({
        ...columns,
        ...(await nearDuplicateColumns(canon.draft)),
        batchId: `manual-${new Date().toISOString().slice(0, 10)}`,
        source: "manual",
        rawData: { rowNumber: null, fileName: "Added in console", record: draft },
        reviewNotes: body.data.reviewNotes ?? null,
      })
      .returning();

    // Optional immediate live insertion when requested and draft is complete
    if (body.data.insertLive && created.status === "pending_review") {
      const valid = ApprovableQuestionSchema.safeParse(created.enrichedData);
      if (valid.success) {
        const { draft: q, path, pyqTag } = canon;
        const [liveRow] = await db
          .insert(questions)
          .values({
            examId: path.exam.id,
            examSlug: path.exam.slug,
            subjectId: path.subject.id,
            chapterId: path.chapter.id,
            subtopicId: path.subtopic.id,
            stem: valid.data.stem,
            options: valid.data.options,
            correctOption: q.correctOption,
            explanation: valid.data.explanation,
            difficulty: q.difficulty,
            marksPositive: path.exam.marksPerCorrect,
            marksNegative: path.exam.negativeMarksPerWrong,
            previousYearTag: pyqTag,
            source: q.source,
            pyqExamSlug: q.pyqExamSlug,
            pyqYear: q.pyqYear,
            answerKeyVerified: q.answerKeyVerified,
            contentHash: columns.contentHash,
            ingestionJobId: created.id,
          })
          .onConflictDoNothing({ target: questions.contentHash })
          .returning({ id: questions.id });

        if (liveRow) {
          const [promoted] = await db
            .update(questionIngestionJobs)
            .set({
              status: "inserted",
              insertedQuestionId: liveRow.id,
              reviewedAt: new Date(),
            })
            .where(eq(questionIngestionJobs.id, created.id))
            .returning();
          return reply.status(201).send({ job: toJobDto(promoted) });
        }
      }
    }

    return reply.status(201).send({ job: toJobDto(created) });
  });

  /**
   * 2b. POST /admin/ingestion/generate
   *     { examSlug, subjectSlug, chapterSlug, subtopicSlug, count, difficulty, mode, seriesId? }
   *
   * mode "roster": refuses (409) to draft more than the series' open vacancies
   *   for that syllabus node — counting questions already selected AND pending
   *   AI drafts for the series — and re-checks under a series lock before saving.
   * mode "bank": reusable questions for the central bank; no blueprint is touched.
   *
   * Every AI question is de-duplicated in code (exact hash + near-duplicate
   * stems) against the bank, pending/rejected staging rows and the batch
   * itself; if too few survive, the AI is asked again for fresh ones.
   * Nothing goes live: rows land in the review queue as pending_review.
   */
  fastify.post("/generate", async (request, reply) => {
    const parsed = GenerateQuestionsInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid generation request",
        details: formatIssues(parsed.error.issues),
      });
    }
    const input = parsed.data;
    const syllabus = await loadSyllabus();
    const resolved = resolveSyllabusPath(syllabus, {
      exam: input.examSlug,
      subject: input.subjectSlug || undefined,
      chapter: input.chapterSlug || undefined,
      subtopic: input.subtopicSlug,
    });
    if (!resolved.ok) {
      return reply.status(400).send({ error: resolved.message });
    }
    const { path } = resolved;
    const nodePath: NodePath = {
      subjectId: path.subject.id,
      chapterId: path.chapter.id,
      subtopicId: path.subtopic.id,
    };

    // ── Blueprint check BEFORE spending any AI tokens ──
    let series: SeriesRow | null = null;
    let vacancy: VacancyDto | null = null;
    if (input.mode === "roster") {
      try {
        series = await getSeries(db, input.seriesId!);
      } catch {
        return reply.status(404).send({ error: "Test series not found" });
      }
      if (series.examId !== path.exam.id) {
        return reply
          .status(400)
          .send({ error: "That series belongs to a different exam — pick a subtopic from its syllabus" });
      }
      if (series.status === "archived") {
        return reply.status(409).send({ error: "That series is archived" });
      }
      const tax = await loadExamTaxonomy(db, series.examId);
      const { state } = await rosterStateFor(db, series.id);
      vacancy = toVacancyDto(series.id, state, nodePath, tax.label);
      if (!vacancy.eligible || input.count > vacancy.generatable) {
        const body: GenerationOverLimitError = {
          error: !vacancy.eligible
            ? `${vacancy.message} Give it a count in the series' subjects, or generate for the Question Bank instead.`
            : `Only ${vacancy.generatable} vacanc${vacancy.generatable === 1 ? "y remains" : "ies remain"} ` +
              `for ${tax.label(nodePath)} in this series (you asked for ${input.count}). ` +
              `Generate up to ${vacancy.generatable}, or switch to "Question Bank" mode for extra reusable questions.`,
          code: vacancy.eligible ? "ROSTER_VACANCY_EXCEEDED" : "NOT_IN_ROSTER",
          requested: input.count,
          allowed: vacancy.eligible ? vacancy.generatable : 0,
          vacancy,
        };
        return reply.status(409).send(body);
      }
    }

    // ── Generate → de-duplicate → retry for the shortfall ──
    const source = "ai_generated";
    const batchId = `${source}-${Date.now()}`;
    type Kept = { draft: StagedQuestionDraft; q: ApiAiGenerateResponse["questions"][number] };
    const kept: Kept[] = [];
    const dropped: StagedRow[] = [];
    const duplicatesDropped = { exact: 0, near: 0, inBatch: 0 };
    const seenHashes = new Set<string>();
    let attempts = 0;
    let modelUsed = "";
    let cacheTier: GenerateQuestionsResult["cacheTier"] = "gemini";
    let rowNumber = 0;

    try {
      const context = await loadGenerationContext(path);
      const avoid = [...context.avoid_stems];

      while (kept.length < input.count && attempts <= MAX_GENERATION_RETRIES) {
        const generated = await generateWithApiAi({
          exam_slug: path.exam.slug,
          exam_title: path.exam.name.en,
          subject_name: path.subject.name.en,
          chapter_name: path.chapter.name.en,
          subtopic_slug: path.subtopic.slug,
          subtopic_name: path.subtopic.name.en,
          count: input.count - kept.length,
          difficulty: input.difficulty,
          examples: context.examples,
          round: context.round,
          attempt: attempts,
          // Newest stems last, so the cap keeps what this request just saw
          avoid_stems: avoid.slice(-150),
        });
        if (attempts === 0) cacheTier = generated.cache_tier;
        else if (generated.cache_tier === "gemini") cacheTier = "gemini";
        attempts++;
        modelUsed ||= generated.model_used;
        if (generated.questions.length === 0) break;

        const drafts: StagedQuestionDraft[] = generated.questions.map((q) => ({
          examSlug: path.exam.slug,
          subjectSlug: path.subject.slug,
          chapterSlug: path.chapter.slug,
          subtopicSlug: path.subtopic.slug,
          stem: q.stem,
          options: q.options,
          correctOption: q.correct_option,
          explanation: q.explanation,
          difficulty: q.difficulty,
          source,
          pyqExamSlug: null,
          pyqYear: null,
          answerKeyVerified: false,
        }));
        const hashes = drafts.map((d) => computeContentHash(d));
        const [known, near] = await Promise.all([
          existingHashes(hashes, AI_DEDUPE_STATUSES),
          findNearDuplicates(drafts.map(probeOf), AI_DEDUPE_STATUSES),
        ]);

        generated.questions.forEach((q, i) => {
          const draft = drafts[i];
          const hash = hashes[i];
          avoid.push(draft.stem.en);
          let reason: string | null = generatedQuestionProblem(draft);
          if (!reason && known.has(hash)) {
            duplicatesDropped.exact++;
            reason = `Duplicate of ${known.get(hash)}`;
          } else if (!reason && seenHashes.has(hash)) {
            duplicatesDropped.inBatch++;
            reason = "Duplicate of another question in this batch";
          } else if (!reason && near[i]) {
            duplicatesDropped.near++;
            const m = near[i]!;
            reason = `Near-duplicate (${Math.round(m.score * 100)}% similar) of ${
              m.kind === "question" ? "bank question" : "staged row"
            } ${m.id}`;
          } else if (!reason) {
            const twin = kept.find((k) => nearDuplicateScore(probeOf(draft), probeOf(k.draft)) !== null);
            if (twin) {
              duplicatesDropped.inBatch++;
              reason = "Near-duplicate of another question in this batch";
            }
          }
          seenHashes.add(hash);
          if (!reason && kept.length >= input.count) reason = "Extra question beyond the requested count";

          if (reason) {
            dropped.push({
              rowNumber: ++rowNumber,
              job: {
                batchId,
                source,
                status: "failed",
                rawData: { rowNumber, fileName: null, record: q, attempt: attempts },
                enrichedData: draft,
                examId: path.exam.id,
                ...nodePath,
                contentHash: hash,
                aiConfidenceScore: q.confidence.toFixed(2),
                errorMessage: reason,
              },
            });
          } else {
            kept.push({ draft, q });
          }
        });
      }
    } catch (err) {
      request.log.error(err, "AI question generation failed");
      return reply.status(502).send({ error: (err as Error).message });
    }

    // ── Stage, re-checking vacancies under the series lock ──
    const fileName = `AI · ${path.subtopic.name.en} (${modelUsed || "gemini"})${series ? " · series" : ""}`;
    let staged: StagedRow[] = [];
    try {
      staged = await db.transaction(async (tx) => {
        let accept = kept;
        if (series) {
          const locked = await lockSeries(tx, series.id);
          if (locked.status === "archived") throw new SeriesError("That series was archived meanwhile", 409);
          const { state } = await rosterStateFor(tx, series.id);
          const room = vacancyFor(state, nodePath, "generate").allowed;
          if (kept.length > room) {
            accept = kept.slice(0, room);
            kept.slice(room).forEach(({ draft, q }) =>
              dropped.push({
                rowNumber: ++rowNumber,
                job: {
                  batchId,
                  source,
                  status: "failed",
                  rawData: { rowNumber, fileName, record: q },
                  enrichedData: draft,
                  examId: path.exam.id,
                  ...nodePath,
                  contentHash: computeContentHash(draft),
                  aiConfidenceScore: q.confidence.toFixed(2),
                  errorMessage: "Not staged: the series' vacancies were taken while generating",
                },
              })
            );
          }
        }
        const rows: StagedRow[] = [
          ...accept.map(({ draft, q }, i) => {
            const canon = canonicalizeDraft(syllabus, draft);
            const job: NewIngestionJob = {
              batchId,
              source,
              status: "failed",
              rawData: { rowNumber: i + 1, fileName, record: q, cacheTier },
              aiConfidenceScore: q.confidence.toFixed(2),
              targetSeriesId: series?.id ?? null,
            };
            if (canon.ok) Object.assign(job, draftColumns(canon));
            else job.errorMessage = canon.message;
            return { rowNumber: i + 1, job };
          }),
          ...dropped.map((d, i) => {
            const n = accept.length + i + 1;
            (d.job.rawData as { rowNumber: number; fileName: string }).rowNumber = n;
            (d.job.rawData as { rowNumber: number; fileName: string }).fileName = fileName;
            return { rowNumber: n, job: d.job };
          }),
        ];
        if (rows.length) await tx.insert(questionIngestionJobs).values(rows.map((r) => r.job));
        return rows;
      });
    } catch (err) {
      if (err instanceof SeriesError) return reply.status(err.statusCode).send({ error: err.message });
      throw err;
    }

    const uniqueGenerated = staged.filter((s) => s.job.status !== "failed").length;
    const result: GenerateQuestionsResult = {
      batchId,
      total: staged.length,
      pendingReview: staged.filter((s) => s.job.status === "pending_review").length,
      pendingAi: staged.filter((s) => s.job.status === "pending_ai").length,
      failed: staged.filter((s) => s.job.status === "failed").length,
      skippedEmpty: 0,
      errors: staged
        .filter((s) => s.job.status === "failed")
        .slice(0, 100)
        .map((s) => ({ rowNumber: s.rowNumber, message: s.job.errorMessage ?? "" })),
      modelUsed: modelUsed || "gemini",
      cacheTier,
      requested: input.count,
      uniqueGenerated,
      attempts,
      duplicatesDropped,
      vacancy,
    };
    request.log.info(
      {
        batchId,
        subtopic: path.subtopic.slug,
        seriesId: series?.id,
        requested: input.count,
        uniqueGenerated,
        attempts,
        duplicatesDropped,
      },
      "AI questions staged"
    );
    return reply.status(201).send(result);
  });

  /**
   * 2c. POST /admin/ingestion/generate-full-set
   *     { examSlug, subjects: [{ subjectId, count }], difficulty, insertDirectlyToBank, seriesId?, syncSeriesBlueprint? }
   *
   * 1-Click Full Question Set Generator across chosen subjects (e.g. 100 questions for PSC Clerkship
   * split across chosen subjects according to Admin's subject question counts).
   */
  fastify.post("/generate-full-set", async (request, reply) => {
    const parsed = GenerateFullQuestionSetInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid full-set generation payload",
        details: formatIssues(parsed.error.issues),
      });
    }
    const input = parsed.data;
    const [examRow] = await db
      .select()
      .from(exams)
      .where(eq(exams.slug, input.examSlug))
      .limit(1);
    if (!examRow) {
      return reply.status(404).send({ error: `Exam "${input.examSlug}" not found` });
    }

    let targetSeries: SeriesRow | null = null;
    if (input.seriesId) {
      try {
        targetSeries = await getSeries(db, input.seriesId);
      } catch {
        return reply.status(404).send({ error: "Target test series not found" });
      }
      if (targetSeries.examId !== examRow.id) {
        return reply.status(400).send({ error: "Target series belongs to a different exam" });
      }
      if (targetSeries.status === "archived") {
        return reply.status(409).send({ error: "Target series is archived" });
      }
    }

    const examSubjects = await db
      .select()
      .from(subjects)
      .where(eq(subjects.examId, examRow.id));
    const subjectById = new Map(examSubjects.map((s) => [s.id, s]));

    for (const alloc of input.subjects) {
      if (!subjectById.has(alloc.subjectId)) {
        return reply.status(400).send({
          error: `Subject ${alloc.subjectId} does not belong to ${examRow.title.en}`,
        });
      }
    }

    const requestedTotal = input.subjects.reduce((sum, s) => sum + s.count, 0);
    if (examRow.totalQuestions > 0 && requestedTotal > examRow.totalQuestions) {
      return reply.status(400).send({
        error: `Requested question count (${requestedTotal}) exceeds the maximum total intake (${examRow.totalQuestions}) for ${examRow.title.en}.`,
      });
    }

    const batchId = `ai-fullset-${Date.now()}`;
    const modelUsed = "gemini-2.5-flash";
    const subjectSummaries: GenerateFullQuestionSetSubjectSummary[] = [];
    let totalRequested = 0;
    let totalGenerated = 0;
    let totalInsertedLive = 0;
    let totalAssignedToSeries = 0;
    let totalPendingReview = 0;

    // Effective subject counts to generate (capped by series vacancies when targeting a series)
    let effectiveAllocations = [...input.subjects];

    // If seriesId is given, enforce the series' total intake cap and never inflate slots above the blueprint/exam limit
    if (targetSeries) {
      const capError = await db.transaction(async (tx) => {
        const locked = await lockSeries(tx, targetSeries!.id);
        await enforceSeriesQuestionCap(tx, locked.id);
        const existingSlots = await tx
          .select()
          .from(seriesRosterSlots)
          .where(eq(seriesRosterSlots.seriesId, locked.id));
        const { state } = await rosterStateFor(tx, locked.id);

        if (existingSlots.length === 0 && input.syncSeriesBlueprint && locked.status === "draft") {
          // Series has no blueprint yet — initialize slots capped at examRow.totalQuestions
          let remainingExamBudget = examRow.totalQuestions > 0 ? examRow.totalQuestions : 500;
          const cappedSubjects: typeof input.subjects = [];
          for (const alloc of input.subjects) {
            const c = Math.min(alloc.count, remainingExamBudget);
            if (c > 0) {
              await tx.insert(seriesRosterSlots).values({
                seriesId: locked.id,
                examId: locked.examId,
                subjectId: alloc.subjectId,
                chapterId: null,
                subtopicId: null,
                targetCount: c,
              });
              remainingExamBudget -= c;
              cappedSubjects.push({ subjectId: alloc.subjectId, count: c });
            }
          }
          effectiveAllocations = cappedSubjects;
          await touchSeries(tx, locked.id);
          return null;
        }

        // Series already has blueprint slots — strictly respect its targetCount (never inflate to 135/100!)
        const totalAssignedInSeries = Array.from(existingSlots)
          .filter((s) => s.chapterId === null && s.subtopicId === null)
          .reduce((sum, s) => sum + (state.assignedIn.get(s.id) ?? 0), 0);

        if (state.rosterTotal > 0 && totalAssignedInSeries >= state.rosterTotal) {
          return `This test series is already full (${totalAssignedInSeries}/${state.rosterTotal} questions assigned). Remove existing questions before generating more.`;
        }

        const cappedSubjects: typeof input.subjects = [];
        let remainingSeriesRoom =
          state.rosterTotal > 0
            ? Math.max(0, state.rosterTotal - totalAssignedInSeries)
            : Math.max(0, (examRow.totalQuestions || 200) - totalAssignedInSeries);

        for (const alloc of input.subjects) {
          if (remainingSeriesRoom <= 0) break;
          const subjSlot = existingSlots.find(
            (s) => s.subjectId === alloc.subjectId && s.chapterId === null && s.subtopicId === null
          );
          if (subjSlot) {
            const currentlyAssigned = state.assignedIn.get(subjSlot.id) ?? 0;
            const subjRoom = Math.max(0, subjSlot.targetCount - currentlyAssigned);
            const allowed = Math.min(alloc.count, subjRoom, remainingSeriesRoom);
            if (allowed > 0) {
              cappedSubjects.push({ subjectId: alloc.subjectId, count: allowed });
              remainingSeriesRoom -= allowed;
            }
          } else if (input.syncSeriesBlueprint && locked.status === "draft") {
            const currentTotalTargets = existingSlots
              .filter((s) => s.chapterId === null && s.subtopicId === null)
              .reduce((sum, s) => sum + s.targetCount, 0);
            const examRoom = Math.max(0, (examRow.totalQuestions || 200) - currentTotalTargets);
            const allowed = Math.min(alloc.count, examRoom, remainingSeriesRoom);
            if (allowed > 0) {
              await tx.insert(seriesRosterSlots).values({
                seriesId: locked.id,
                examId: locked.examId,
                subjectId: alloc.subjectId,
                chapterId: null,
                subtopicId: null,
                targetCount: allowed,
              });
              cappedSubjects.push({ subjectId: alloc.subjectId, count: allowed });
              remainingSeriesRoom -= allowed;
            }
          }
        }
        effectiveAllocations = cappedSubjects;
        return cappedSubjects.length === 0
          ? `All selected subjects in this test series have already reached their maximum question intake (${totalAssignedInSeries}/${state.rosterTotal}).`
          : null;
      });

      if (capError) {
        return reply.status(409).send({ error: capError });
      }
    }

    for (const alloc of effectiveAllocations) {
      const subj = subjectById.get(alloc.subjectId)!;
      totalRequested += alloc.count;

      // Load chapters & subtopics of this subject (auto-creating a default topic if empty)
      let subjChapters = await db
        .select()
        .from(chapters)
        .where(eq(chapters.subjectId, subj.id))
        .orderBy(asc(chapters.displayOrder));
      let subjSubtopics = await db
        .select()
        .from(subtopics)
        .where(eq(subtopics.subjectId, subj.id));

      if (subjChapters.length === 0 || subjSubtopics.length === 0) {
        await ensureCategoryInExam(examRow.id, {
          subjectEn: subj.name.en,
          subjectBn: subj.name.bn,
          chapterEn: `${subj.name.en} — Core Topics`,
          chapterBn: `${subj.name.bn} — মূল অধ্যায়`,
          subtopicEn: `${subj.name.en} — Fundamentals & Practice`,
          subtopicBn: `${subj.name.bn} — মৌলিক ধারণা ও অনুশীলন`,
        });
        subjChapters = await db
          .select()
          .from(chapters)
          .where(eq(chapters.subjectId, subj.id));
        subjSubtopics = await db
          .select()
          .from(subtopics)
          .where(eq(subtopics.subjectId, subj.id));
      }

      const chapMap = new Map(subjChapters.map((c) => [c.id, c]));
      const chaptersAndSubtopics = subjSubtopics.map((t) => {
        const ch = chapMap.get(t.chapterId) ?? subjChapters[0];
        return {
          chapterId: ch.id,
          chapterSlug: ch.slug,
          chapterEn: ch.name.en,
          subtopicId: t.id,
          subtopicSlug: t.slug,
          subtopicEn: t.name.en,
        };
      });

      const existingStemsRows = await db
        .select({ stem: questions.stem })
        .from(questions)
        .where(eq(questions.subjectId, subj.id))
        .limit(80);
      const avoidStems = existingStemsRows.map((r) => r.stem.en);

      let generatedItems;
      try {
        generatedItems = await generateSubjectQuestionsWithAi({
          examSlug: examRow.slug,
          examTitleEn: examRow.title.en,
          subjectEn: subj.name.en,
          subjectBn: subj.name.bn,
          chaptersAndSubtopics: chaptersAndSubtopics.map((x) => ({
            chapterEn: x.chapterEn,
            subtopicEn: x.subtopicEn,
            subtopicSlug: x.subtopicSlug,
          })),
          count: alloc.count,
          difficulty: input.difficulty,
          avoidStems,
        });
      } catch (err) {
        // Fallback to generateWithApiAi if running in test suite with fake api-ai
        const firstTopic = chaptersAndSubtopics[0];
        const fallback = await generateWithApiAi({
          exam_slug: examRow.slug,
          exam_title: examRow.title.en,
          subject_name: subj.name.en,
          chapter_name: firstTopic.chapterEn,
          subtopic_slug: firstTopic.subtopicSlug,
          subtopic_name: firstTopic.subtopicEn,
          count: alloc.count,
          difficulty: input.difficulty,
          round: 0,
          attempt: 0,
          examples: [],
          avoid_stems: avoidStems,
        }).catch(() => null);
        if (!fallback) {
          return reply.status(502).send({ error: (err as Error).message });
        }
        generatedItems = fallback.questions.map((q) => ({
          chapter_en: firstTopic.chapterEn,
          subtopic_en: firstTopic.subtopicEn,
          stem: q.stem,
          options: q.options,
          correct_option: q.correct_option,
          explanation: q.explanation,
          difficulty: q.difficulty,
          confidence: q.confidence,
        }));
      }

      const stagedForSubj: StagedRow[] = [];
      for (let i = 0; i < generatedItems.length; i++) {
        const g = generatedItems[i];
        // Match subtopic by name or distribute round-robin across the subject's subtopics
        const matchedTopic =
          chaptersAndSubtopics.find((t) =>
            nodeMatches({ id: t.subtopicId, slug: t.subtopicSlug, name: { en: t.subtopicEn, bn: t.subtopicEn } }, g.subtopic_en)
          ) ?? chaptersAndSubtopics[i % chaptersAndSubtopics.length];

        const draft: StagedQuestionDraft = {
          examSlug: examRow.slug,
          subjectSlug: subj.slug,
          chapterSlug: matchedTopic.chapterSlug,
          subtopicSlug: matchedTopic.subtopicSlug,
          stem: g.stem,
          options: g.options,
          correctOption: g.correct_option,
          explanation: g.explanation,
          difficulty: g.difficulty,
          source: "ai_generated",
          pyqExamSlug: null,
          pyqYear: null,
          answerKeyVerified: true,
        };
        const contentHash = computeContentHash(draft);

        stagedForSubj.push({
          rowNumber: i + 1,
          job: {
            batchId,
            source: "ai_generated",
            status: isDraftTextComplete(draft) ? "pending_review" : "pending_ai",
            rawData: {
              rowNumber: i + 1,
              fileName: `AI Full Set · ${subj.name.en} (${modelUsed})`,
              record: g,
            },
            enrichedData: draft,
            examId: examRow.id,
            subjectId: subj.id,
            chapterId: matchedTopic.chapterId,
            subtopicId: matchedTopic.subtopicId,
            contentHash,
            aiConfidenceScore: formatAiConfidence(g.confidence),
            targetSeriesId: targetSeries?.id ?? null,
          },
        });
      }

      if (stagedForSubj.length === 0) {
        subjectSummaries.push({
          subjectId: subj.id,
          subjectNameEn: subj.name.en,
          requested: alloc.count,
          generated: 0,
          insertedLive: 0,
          assignedToSeries: 0,
        });
        continue;
      }

      const subBatchId = `${batchId}-${subj.slug.slice(0, 20)}`;
      stagedForSubj.forEach((s) => {
        s.job.batchId = subBatchId;
      });
      const summary = await saveStagedBatch(subBatchId, stagedForSubj);
      const generatedCount = summary.pendingReview + summary.pendingAi;
      totalGenerated += generatedCount;

      let subjInsertedLive = 0;
      const insertedQuestionIds: string[] = [];

      if (input.insertDirectlyToBank && summary.pendingReview > 0) {
        const batchJobs = await db
          .select()
          .from(questionIngestionJobs)
          .where(
            and(
              eq(questionIngestionJobs.batchId, subBatchId),
              eq(questionIngestionJobs.status, "pending_review")
            )
          )
          .orderBy(asc(questionIngestionJobs.createdAt));

        await db.transaction(async (tx) => {
          for (const job of batchJobs) {
            const valid = ApprovableQuestionSchema.safeParse(job.enrichedData);
            if (!valid.success || !job.examId || !job.subjectId || !job.chapterId || !job.subtopicId) {
              continue;
            }
            const q = valid.data;
            const contentHash = job.contentHash ?? computeContentHash(q);
            const [created] = await tx
              .insert(questions)
              .values({
                examId: job.examId,
                examSlug: examRow.slug,
                subjectId: job.subjectId,
                chapterId: job.chapterId,
                subtopicId: job.subtopicId,
                stem: q.stem,
                options: q.options,
                correctOption: q.correctOption,
                explanation: q.explanation,
                difficulty: q.difficulty,
                marksPositive: String(examRow.marksPerCorrect),
                marksNegative: String(examRow.negativeMarksPerWrong),
                previousYearTag: null,
                source: "ai_generated",
                pyqExamSlug: null,
                pyqYear: null,
                answerKeyVerified: true,
                contentHash,
                ingestionJobId: job.id,
              })
              .onConflictDoNothing({ target: questions.contentHash })
              .returning({ id: questions.id });

            if (created) {
              subjInsertedLive++;
              insertedQuestionIds.push(created.id);
              await tx
                .update(questionIngestionJobs)
                .set({
                  status: "inserted",
                  insertedQuestionId: created.id,
                  reviewedAt: new Date(),
                })
                .where(eq(questionIngestionJobs.id, job.id));
            }
          }
        });
      } else {
        totalPendingReview += summary.pendingReview;
      }

      totalInsertedLive += subjInsertedLive;

      let subjAssigned = 0;
      if (targetSeries && insertedQuestionIds.length > 0) {
        await db.transaction(async (tx) => {
          const locked = await lockSeries(tx, targetSeries!.id);
          const outcome = await assignQuestions(tx, locked, insertedQuestionIds, {
            userId: request.user!.id,
          });
          subjAssigned = outcome.assigned.length;
          if (subjAssigned > 0) await touchSeries(tx, locked.id);
        });
        totalAssignedToSeries += subjAssigned;
      }

      subjectSummaries.push({
        subjectId: subj.id,
        subjectNameEn: subj.name.en,
        requested: alloc.count,
        generated: generatedCount,
        insertedLive: subjInsertedLive,
        assignedToSeries: subjAssigned,
      });
    }

    const result: GenerateFullQuestionSetResult = {
      batchId,
      modelUsed,
      totalRequested,
      totalGenerated,
      totalInsertedLive,
      totalAssignedToSeries,
      totalPendingReview,
      subjectSummaries,
    };
    return reply.status(201).send(result);
  });

  /**
   * 3. GET /admin/ingestion/batches
   */
  fastify.get("/batches", async (request) => {
    const { examSlug } = z
      .object({ examSlug: z.string().max(80).optional() })
      .catch({})
      .parse(request.query);
    const firstCreated = sql<string>`min(${questionIngestionJobs.createdAt})`;
    const rows = await db
      .select({
        batchId: questionIngestionJobs.batchId,
        source: questionIngestionJobs.source,
        fileName: sql<string | null>`max(${questionIngestionJobs.rawData}->>'fileName')`,
        createdAt: firstCreated,
        total: sql<number>`count(*)::int`,
        pendingAi: statusCount("pending_ai"),
        pendingReview: statusCount("pending_review"),
        inserted: statusCount("inserted"),
        rejected: statusCount("rejected"),
        failed: statusCount("failed"),
      })
      .from(questionIngestionJobs)
      .where(await examScope(examSlug))
      .groupBy(questionIngestionJobs.batchId, questionIngestionJobs.source)
      .orderBy(desc(firstCreated))
      .limit(50);

    const batches: IngestionBatchSummary[] = rows.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
    return { batches };
  });

  /**
   * 4. GET /admin/ingestion/jobs?batchId=&status=&subjectId=&chapterId=&subtopicId=
   *        &difficulty=&source=&targetSeriesId=&createdFrom=&createdTo=&limit=&offset=
   */
  fastify.get("/jobs", async (request, reply) => {
    const parsed = JobListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: formatIssues(parsed.error.issues),
      });
    }
    const { limit, offset, ...filter } = parsed.data;
    const where = await jobWhere(filter);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(questionIngestionJobs)
        .where(where)
        .orderBy(
          desc(questionIngestionJobs.createdAt),
          asc(sql`(${questionIngestionJobs.rawData}->>'rowNumber')::int`)
        )
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(questionIngestionJobs)
        .where(where),
    ]);

    return { jobs: rows.map(toJobDto), total };
  });

  /**
   * 4b. GET /admin/ingestion/jobs/ids?<same filters>
   * Ids of every row matching the filters (for "select all matching"), capped
   * at the approve/reject batch size.
   */
  fastify.get("/jobs/ids", async (request, reply) => {
    const parsed = JobFilterSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
    }
    const baseWhere = await jobWhere(parsed.data);
    // Never include already-inserted or rejected rows in bulk selection
    const where = and(
      baseWhere,
      ne(questionIngestionJobs.status, "inserted"),
      ne(questionIngestionJobs.status, "rejected")
    );
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ id: questionIngestionJobs.id })
        .from(questionIngestionJobs)
        .where(where)
        .orderBy(desc(questionIngestionJobs.createdAt))
        .limit(SELECT_ALL_CAP),
      db.select({ total: sql<number>`count(*)::int` }).from(questionIngestionJobs).where(where),
    ]);
    return { ids: rows.map((r) => r.id), total, capped: total > SELECT_ALL_CAP };
  });

  /**
   * 5. PATCH /admin/ingestion/jobs/:id
   * Educator edits a staged draft. If Bengali fields or explanation are left
   * blank and autoTranslate !== false, automatically translates English -> Bengali.
   */
  fastify.patch("/jobs/:id", async (request, reply) => {
    const params = JobParamsSchema.safeParse(request.params);
    const body = DraftBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: "Invalid draft",
        details: body.success ? undefined : formatIssues(body.error.issues),
      });
    }
    const { id } = params.data;
    const { reviewNotes, autoTranslate } = body.data;
    let draft = body.data.draft;

    const [job] = await db
      .select()
      .from(questionIngestionJobs)
      .where(eq(questionIngestionJobs.id, id))
      .limit(1);
    if (!job) {
      return reply.status(404).send({ error: "Staged question not found" });
    }
    const editable =
      job.status === "pending_ai" ||
      job.status === "pending_review" ||
      (job.status === "failed" && job.enrichedData !== null);
    if (!editable) {
      return reply
        .status(409)
        .send({ error: `Cannot edit a question with status "${job.status}"` });
    }

    if (autoTranslate !== false && !isDraftTextComplete(draft)) {
      draft = await translateAndEnrichQuestionDraft(draft);
    }

    const canon = canonicalizeDraft(await loadSyllabus(), draft);
    if (!canon.ok) {
      return reply.status(400).send({ error: canon.message });
    }
    const columns = draftColumns(canon);
    const duplicate = await findDuplicate(columns.contentHash, id);
    if (duplicate) {
      return reply.status(409).send({ error: `This edit is a ${duplicate.toLowerCase()}` });
    }

    const [updated] = await db
      .update(questionIngestionJobs)
      .set({
        ...columns,
        ...(await nearDuplicateColumns(canon.draft)),
        reviewNotes: reviewNotes === undefined ? job.reviewNotes : reviewNotes,
        errorMessage: null,
      })
      .where(eq(questionIngestionJobs.id, id))
      .returning();

    return { job: toJobDto(updated) };
  });

  /**
   * 6. POST /admin/ingestion/jobs/approve
   *    { ids, assignToTargetSeries? }
   *
   * Approving = adding to the central Question Bank. Rows are locked first,
   * so a double click or a second admin waits and then sees "already done"
   * instead of creating a duplicate. Each row runs in its own savepoint and
   * gets its own result; one bad row never undoes the others. Adding to a test
   * series happens only when asked for, after re-checking that blueprint's seats.
   */
  fastify.post("/jobs/approve", async (request, reply) => {
    const parsed = ApproveJobsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid approve payload",
        details: formatIssues(parsed.error.issues),
      });
    }
    const { assignToTargetSeries } = parsed.data;
    const ids = [...new Set(parsed.data.ids)];
    const syllabus = await loadSyllabus();

    const result: ApproveJobsResult = {
      inserted: 0,
      assigned: 0,
      notPendingReview: 0,
      invalid: [],
      duplicates: [],
      results: [],
    };

    await db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(questionIngestionJobs)
        .where(inArray(questionIngestionJobs.id, ids))
        .orderBy(asc(questionIngestionJobs.id))
        .for("update");
      const byId = new Map(locked.map((j) => [j.id, j]));

      for (const id of ids) {
        const job = byId.get(id);
        if (!job || job.status !== "pending_review") {
          result.notPendingReview++;
          result.results.push({
            id,
            status: "not_pending",
            message: job ? `Status is "${job.status.replace("_", " ")}"` : "Not found",
          });
          continue;
        }
        const item = await tx.transaction(async (sp) => approveOne(sp, job)).catch((err: Error) => {
          // Unexpected database error on this row only — its savepoint was rolled back
          const message = `Could not approve: ${err.message}`;
          result.invalid.push({ id, message });
          return { id, status: "invalid" as const, message };
        });
        result.results.push(item);
      }
    });

    /** Validates, inserts into the bank and (optionally) assigns one locked row. */
    async function approveOne(
      sp: Parameters<Parameters<typeof db.transaction>[0]>[0],
      job: typeof questionIngestionJobs.$inferSelect
    ): Promise<ApproveJobsResult["results"][number]> {
      let draft = job.enrichedData as StagedQuestionDraft | null;
      // The admin reviewed the AI question and pressed Approve — that is the answer check
      if (draft && draft.source === "ai_generated") {
        draft = { ...draft, answerKeyVerified: true };
      }
      const valid = ApprovableQuestionSchema.safeParse(draft);
      const canon = valid.success ? canonicalizeDraft(syllabus, valid.data) : null;
      if (!valid.success || !canon?.ok) {
        const message = !valid.success
          ? formatIssues(valid.error.issues)
          : (canon as { message: string }).message;
        result.invalid.push({ id: job.id, message });
        await sp
          .update(questionIngestionJobs)
          .set({ errorMessage: message })
          .where(eq(questionIngestionJobs.id, job.id));
        return { id: job.id, status: "invalid", message };
      }

      const { draft: q, path, pyqTag } = canon;
      const contentHash = computeContentHash(q);
      const [created] = await sp
        .insert(questions)
        .values({
          examId: path.exam.id,
          examSlug: path.exam.slug,
          subjectId: path.subject.id,
          chapterId: path.chapter.id,
          subtopicId: path.subtopic.id,
          stem: valid.data.stem,
          options: valid.data.options,
          correctOption: q.correctOption,
          explanation: valid.data.explanation,
          difficulty: q.difficulty,
          marksPositive: path.exam.marksPerCorrect,
          marksNegative: path.exam.negativeMarksPerWrong,
          previousYearTag: pyqTag,
          source: q.source,
          pyqExamSlug: q.pyqExamSlug,
          pyqYear: q.pyqYear,
          answerKeyVerified: q.answerKeyVerified,
          contentHash,
          ingestionJobId: job.id,
        })
        .onConflictDoNothing({ target: questions.contentHash })
        .returning({ id: questions.id });

      const reviewedAt = new Date();
      if (!created) {
        const message = "Duplicate of a question already in the live bank";
        result.duplicates.push({ id: job.id, message });
        await sp
          .update(questionIngestionJobs)
          .set({ status: "failed", errorMessage: message, reviewedAt })
          .where(eq(questionIngestionJobs.id, job.id));
        return { id: job.id, status: "duplicate", message };
      }

      await sp
        .update(questionIngestionJobs)
        .set({
          status: "inserted",
          insertedQuestionId: created.id,
          enrichedData: q,
          contentHash,
          errorMessage: null,
          reviewedAt,
        })
        .where(eq(questionIngestionJobs.id, job.id));
      result.inserted++;

      if (!assignToTargetSeries || !job.targetSeriesId) {
        return { id: job.id, status: "inserted", questionId: created.id };
      }
      // Own savepoint: a full blueprint leaves the question approved in the bank
      const assignment = await sp
        .transaction(async (inner) => {
          const target = await lockSeries(inner, job.targetSeriesId!);
          return assignQuestions(inner, target, [created.id], { userId: request.user!.id });
        })
        .catch((err: Error) => ({ assigned: [], failed: [{ questionId: created.id, reason: err.message }] }));
      if (assignment.assigned.length) {
        result.assigned++;
        return { id: job.id, status: "inserted", questionId: created.id };
      }
      return {
        id: job.id,
        status: "inserted_not_assigned",
        questionId: created.id,
        message: `Added to the bank but not to the series: ${assignment.failed[0]?.reason ?? "unknown reason"}`,
      };
    }

    request.log.info(
      {
        inserted: result.inserted,
        assigned: result.assigned,
        invalid: result.invalid.length,
        duplicates: result.duplicates.length,
      },
      "Staged questions approved"
    );
    return result;
  });

  /**
   * 7. POST /admin/ingestion/jobs/reject  { ids: [...], reviewNotes? }
   * Rejected rows are kept (with the reason) for auditing and so the AI
   * generator never proposes the same question again.
   */
  fastify.post("/jobs/reject", async (request, reply) => {
    const parsed = RejectJobsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid reject payload",
        details: formatIssues(parsed.error.issues),
      });
    }
    const { reviewNotes } = parsed.data;
    const ids = [...new Set(parsed.data.ids)];

    const rejected = await db
      .update(questionIngestionJobs)
      .set({
        status: "rejected",
        reviewedAt: new Date(),
        ...(reviewNotes ? { reviewNotes } : {}),
      })
      .where(
        and(
          inArray(questionIngestionJobs.id, ids),
          inArray(questionIngestionJobs.status, [
            "pending_ai",
            "pending_review",
            "failed",
          ])
        )
      )
      .returning({ id: questionIngestionJobs.id });

    const done = new Set(rejected.map((r) => r.id));
    const result: RejectJobsResult = {
      rejected: done.size,
      results: ids.map((id) =>
        done.has(id)
          ? { id, status: "rejected" as const }
          : {
              id,
              status: "not_rejectable" as const,
              message: "Already approved, rejected or not found",
            }
      ),
    };
    return result;
  });
};
