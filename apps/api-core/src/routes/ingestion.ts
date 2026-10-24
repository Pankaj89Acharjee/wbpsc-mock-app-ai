import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  chapters,
  exams,
  questions,
  questionIngestionJobs,
  subjects,
  subtopics,
  type IngestionStatusType,
} from "../db/schema";
import {
  ApprovableQuestionSchema,
  BULK_IMPORT_MAX_ROWS,
  BulkQuestionRowSchema,
  GenerateQuestionsInputSchema,
  IngestionStatusSchema,
  StagedQuestionDraftSchema,
  csvTableToRecords,
  isDraftTextComplete,
  normalizeRecordKeys,
  parseCsv,
  pyqLabel,
  rowToDraft,
  slugify,
  type ExtractMediaQuestionsResult,
  type GenerateQuestionsResult,
  type IngestionBatchSummary,
  type IngestionJobDto,
  type IngestionUploadResult,
  type StagedQuestionDraft,
} from "../../../../packages/shared-types/src/index";
import { computeContentHash } from "../lib/contentHash";
import { formatIssues } from "../lib/validation";
import { requireAdmin } from "../lib/auth";
import { generateWithApiAi, loadGenerationContext } from "../lib/aiGeneration";
import {
  extractQuestionsFromMediaWithAi,
  translateAndEnrichQuestionDraft,
} from "../lib/aiEnrichment";
import { canonicalizeDraft, loadSyllabus, resolveSyllabusPath } from "../lib/syllabus";

// ============================================================================
// Request Validation Schemas (Zod)
// ============================================================================

const UploadBodySchema = z.object({
  fileName: z.string().max(200).optional(),
  format: z.enum(["csv", "json"]),
  content: z.string().min(1, "File is empty").max(5_000_000),
});

const JobListQuerySchema = z.object({
  batchId: z.string().max(80).optional(),
  examSlug: z.string().max(80).optional(),
  status: z.union([IngestionStatusSchema, z.literal("all")]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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

const IdsBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  reviewNotes: z.string().max(2000).optional(),
});

/** Staging rows that still count as "in the pipeline" for duplicate checks. */
const ACTIVE_STAGING_STATUSES: IngestionStatusType[] = [
  "pending_ai",
  "pending_review",
  "approved",
];

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
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

const statusCount = (status: IngestionStatusType) =>
  sql<number>`(count(*) filter (where ${questionIngestionJobs.status} = ${status}))::int`;

/**
 * Ensures Subject -> Chapter -> Subtopic exists for an exam, returning their slugs.
 * Used when extracting questions from PDF/Image question papers so every question
 * lands in the right category even if the subtopic wasn't created beforehand.
 */
async function ensureCategoryInExam(
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
  const subjSlug = slugify(category.subjectEn) || "general-studies";
  const chapSlug = slugify(category.chapterEn) || "general-topic";
  const subSlug = slugify(category.subtopicEn) || `${chapSlug}-basics`;

  let createdNew = false;

  // 1. Subject
  let [subj] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.examId, examId), eq(subjects.slug, subjSlug)))
    .limit(1);
  if (!subj) {
    [subj] = await db
      .insert(subjects)
      .values({
        examId,
        slug: subjSlug,
        name: {
          en: category.subjectEn.trim() || "General Studies",
          bn: category.subjectBn.trim() || category.subjectEn.trim() || "সাধারণ অধ্যয়ন",
        },
        displayOrder: 50,
      })
      .returning();
    createdNew = true;
  }

  // 2. Chapter
  let [chap] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.subjectId, subj.id), eq(chapters.slug, chapSlug)))
    .limit(1);
  if (!chap) {
    [chap] = await db
      .insert(chapters)
      .values({
        subjectId: subj.id,
        slug: chapSlug,
        name: {
          en: category.chapterEn.trim() || "Core Concepts",
          bn: category.chapterBn.trim() || category.chapterEn.trim() || "মূল ধারণা",
        },
        displayOrder: 50,
      })
      .returning();
    createdNew = true;
  }

  // 3. Subtopic (unique per chapter + slug)
  const finalSubSlug = subSlug;
  let [sub] = await db
    .select()
    .from(subtopics)
    .where(and(eq(subtopics.chapterId, chap.id), eq(subtopics.slug, finalSubSlug)))
    .limit(1);

  if (!sub) {
    [sub] = await db
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
      .returning();
    createdNew = true;
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
          aiConfidenceScore: q.confidence.toFixed(2),
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
   * 2b. POST /admin/ingestion/generate  { examSlug, subtopicSlug, count, difficulty }
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

    let generated;
    try {
      const context = await loadGenerationContext(path);
      generated = await generateWithApiAi({
        exam_slug: path.exam.slug,
        exam_title: path.exam.name.en,
        subject_name: path.subject.name.en,
        chapter_name: path.chapter.name.en,
        subtopic_slug: path.subtopic.slug,
        subtopic_name: path.subtopic.name.en,
        count: input.count,
        difficulty: input.difficulty,
        ...context,
      });
    } catch (err) {
      request.log.error(err, "AI question generation failed");
      return reply.status(502).send({ error: (err as Error).message });
    }

    const source = "ai_generated";
    const batchId = `${source}-${Date.now()}`;
    const staged: StagedRow[] = generated.questions.map((q, i) => {
      const draft: StagedQuestionDraft = {
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
      };
      const job: NewIngestionJob = {
        batchId,
        source,
        status: "failed",
        rawData: {
          rowNumber: i + 1,
          fileName: `AI · ${path.subtopic.name.en} (${generated.model_used})`,
          record: q,
          cacheTier: generated.cache_tier,
        },
        aiConfidenceScore: q.confidence.toFixed(2),
      };
      const canon = canonicalizeDraft(syllabus, draft);
      if (canon.ok) Object.assign(job, draftColumns(canon));
      else job.errorMessage = canon.message;
      return { rowNumber: i + 1, job };
    });

    const summary = await saveStagedBatch(batchId, staged);
    const result: GenerateQuestionsResult = {
      ...summary,
      modelUsed: generated.model_used,
      cacheTier: generated.cache_tier,
    };
    request.log.info(
      { batchId, subtopic: path.subtopic.slug, total: result.total, cacheTier: result.cacheTier },
      "AI questions staged"
    );
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
   * 4. GET /admin/ingestion/jobs?batchId=&status=&limit=&offset=
   */
  fastify.get("/jobs", async (request, reply) => {
    const parsed = JobListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }
    const { batchId, examSlug, status, limit, offset } = parsed.data;

    const where = and(
      await examScope(examSlug),
      batchId ? eq(questionIngestionJobs.batchId, batchId) : undefined,
      status !== "all" ? eq(questionIngestionJobs.status, status) : undefined
    );

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
        reviewNotes: reviewNotes === undefined ? job.reviewNotes : reviewNotes,
        errorMessage: null,
      })
      .where(eq(questionIngestionJobs.id, id))
      .returning();

    return { job: toJobDto(updated) };
  });

  /**
   * 6. POST /admin/ingestion/jobs/approve  { ids: [...] }
   */
  fastify.post("/jobs/approve", async (request, reply) => {
    const parsed = IdsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid approve payload",
        details: parsed.error.flatten(),
      });
    }
    const { ids } = parsed.data;

    const jobs = await db
      .select()
      .from(questionIngestionJobs)
      .where(
        and(
          inArray(questionIngestionJobs.id, ids),
          eq(questionIngestionJobs.status, "pending_review")
        )
      );
    const syllabus = await loadSyllabus();

    const result = {
      inserted: 0,
      notPendingReview: ids.length - jobs.length,
      invalid: [] as Array<{ id: string; message: string }>,
      duplicates: [] as Array<{ id: string; message: string }>,
    };

    await db.transaction(async (tx) => {
      for (const job of jobs) {
        const valid = ApprovableQuestionSchema.safeParse(job.enrichedData);
        const canon = valid.success ? canonicalizeDraft(syllabus, valid.data) : null;
        if (!valid.success || !canon?.ok) {
          const message = !valid.success
            ? formatIssues(valid.error.issues)
            : (canon as { message: string }).message;
          result.invalid.push({ id: job.id, message });
          await tx
            .update(questionIngestionJobs)
            .set({ errorMessage: message })
            .where(eq(questionIngestionJobs.id, job.id));
          continue;
        }

        const { draft: q, path, pyqTag } = canon;
        const contentHash = computeContentHash(q);
        const [created] = await tx
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
          await tx
            .update(questionIngestionJobs)
            .set({ status: "failed", errorMessage: message, reviewedAt })
            .where(eq(questionIngestionJobs.id, job.id));
          continue;
        }

        await tx
          .update(questionIngestionJobs)
          .set({
            status: "inserted",
            insertedQuestionId: created.id,
            contentHash,
            errorMessage: null,
            reviewedAt,
          })
          .where(eq(questionIngestionJobs.id, job.id));
        result.inserted++;
      }
    });

    request.log.info(
      { inserted: result.inserted, invalid: result.invalid.length },
      "Staged questions approved"
    );
    return result;
  });

  /**
   * 7. POST /admin/ingestion/jobs/reject  { ids: [...], reviewNotes? }
   */
  fastify.post("/jobs/reject", async (request, reply) => {
    const parsed = IdsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid reject payload",
        details: parsed.error.flatten(),
      });
    }
    const { ids, reviewNotes } = parsed.data;

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

    return { rejected: rejected.length };
  });
};
