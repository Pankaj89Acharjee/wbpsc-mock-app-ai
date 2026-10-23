import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  exams,
  subjects,
  chapters,
  subtopics,
  questions,
  questionIngestionJobs,
  type IngestionStatusType,
} from "../db/schema";
import {
  ApprovableQuestionSchema,
  BULK_IMPORT_MAX_ROWS,
  BulkQuestionRowSchema,
  IngestionStatusSchema,
  StagedQuestionDraftSchema,
  csvTableToRecords,
  isDraftTextComplete,
  parseCsv,
  pyqLabel,
  rowToDraft,
  type IngestionBatchSummary,
  type IngestionJobDto,
  type IngestionUploadResult,
  type StagedQuestionDraft,
} from "../../../../packages/shared-types/src/index";
import { computeContentHash } from "../lib/contentHash";

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
  status: z.union([IngestionStatusSchema, z.literal("all")]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const JobParamsSchema = z.object({ id: z.string().uuid() });

const UpdateJobBodySchema = z.object({
  draft: StagedQuestionDraftSchema,
  reviewNotes: z.string().max(2000).nullable().optional(),
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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Interim admin guard until Fastify JWT auth lands: requires the
 * `x-admin-key` header to match ADMIN_API_KEY (constant-time compare).
 */
async function requireAdminKey(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return reply
      .status(503)
      .send({ error: "ADMIN_API_KEY is not configured on api-core" });
  }
  const provided = request.headers["x-admin-key"];
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (
    typeof provided !== "string" ||
    !timingSafeEqual(digest(provided), digest(expected))
  ) {
    return reply.status(401).send({ error: "Invalid or missing admin key" });
  }
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => `${i.path.map(String).join(".") || "row"}: ${i.message}`)
    .join("; ");
}

type TaxonomyPath = Pick<
  StagedQuestionDraft,
  "examSlug" | "subjectSlug" | "chapterSlug" | "subtopicSlug"
>;

const taxonomyKey = (p: TaxonomyPath) =>
  `${p.examSlug}/${p.subjectSlug}/${p.chapterSlug}/${p.subtopicSlug}`;

/** Whole syllabus tree in one query (a few hundred rows) keyed by slug path. */
async function loadTaxonomyIndex() {
  const rows = await db
    .select({
      examSlug: exams.slug,
      examId: exams.id,
      marksPerCorrect: exams.marksPerCorrect,
      negativeMarksPerWrong: exams.negativeMarksPerWrong,
      subjectSlug: subjects.slug,
      subjectId: subjects.id,
      chapterSlug: chapters.slug,
      chapterId: chapters.id,
      subtopicSlug: subtopics.slug,
      subtopicId: subtopics.id,
    })
    .from(subtopics)
    .innerJoin(chapters, eq(subtopics.chapterId, chapters.id))
    .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
    .innerJoin(exams, eq(subjects.examId, exams.id));
  return new Map(rows.map((r) => [taxonomyKey(r), r]));
}

const unknownTaxonomyMessage = (p: TaxonomyPath) =>
  `Unknown syllabus path "${taxonomyKey(p)}" — fix the slugs or create the subject/chapter/subtopic first`;

/** Columns derived from a draft (FKs, hash, PYQ metadata, status). */
function draftColumns(
  draft: StagedQuestionDraft,
  tax: { examId: string; subjectId: string; chapterId: string; subtopicId: string }
) {
  return {
    enrichedData: draft,
    examId: tax.examId,
    subjectId: tax.subjectId,
    chapterId: tax.chapterId,
    subtopicId: tax.subtopicId,
    contentHash: computeContentHash(draft),
    pyqYear: draft.pyqYear,
    pyqExamName: pyqLabel(draft.pyqExamSlug, draft.pyqYear),
    status: (isDraftTextComplete(draft)
      ? "pending_review"
      : "pending_ai") as IngestionStatusType,
  };
}

function toJobDto(row: IngestionJobRow): IngestionJobDto {
  const raw = row.rawData as { rowNumber?: number } | null;
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

// ============================================================================
// Route Plugin Implementation (registered under /admin/ingestion)
// ============================================================================

export const ingestionRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  fastify.addHook("preHandler", requireAdminKey);

  /**
   * 1. POST /admin/ingestion/upload
   * Parses a CSV/JSON file, validates every row, resolves syllabus slugs,
   * flags duplicates, and stages everything in `question_ingestion_jobs`.
   * Nothing reaches the live `questions` table from here.
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
        records = json.map((record, i) => ({ rowNumber: i + 1, record }));
      }

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
      const taxonomy = await loadTaxonomyIndex();

      // Pass 1: validate rows & resolve syllabus FKs
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
        const tax = taxonomy.get(taxonomyKey(draft));
        if (!tax) {
          job.enrichedData = draft;
          job.errorMessage = unknownTaxonomyMessage(draft);
          return { rowNumber, job };
        }
        Object.assign(job, draftColumns(draft, tax));
        return { rowNumber, job };
      });

      // Pass 2: duplicate detection (live bank, active staging, same file)
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

      const seenInFile = new Map<string, number>();
      for (const { rowNumber, job } of staged) {
        if (job.status === "failed" || !job.contentHash) continue;
        const hash = job.contentHash;
        let duplicateOf: string | null = null;
        if (liveDupes.has(hash)) {
          duplicateOf = `live question ${liveDupes.get(hash)}`;
        } else if (stagedDupes.has(hash)) {
          duplicateOf = `a pending row in batch ${stagedDupes.get(hash)}`;
        } else if (seenInFile.has(hash)) {
          duplicateOf = `row ${seenInFile.get(hash)} of this file`;
        } else {
          seenInFile.set(hash, rowNumber);
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

      const result: IngestionUploadResult = {
        batchId,
        total: staged.length,
        pendingReview: staged.filter((s) => s.job.status === "pending_review").length,
        pendingAi: staged.filter((s) => s.job.status === "pending_ai").length,
        failed: staged.filter((s) => s.job.status === "failed").length,
        errors: staged
          .filter((s) => s.job.status === "failed")
          .slice(0, 100)
          .map((s) => ({ rowNumber: s.rowNumber, message: s.job.errorMessage ?? "" })),
      };
      request.log.info(
        { batchId, total: result.total, failed: result.failed },
        "Bulk question upload staged"
      );
      return reply.status(201).send(result);
    }
  );

  /**
   * 2. GET /admin/ingestion/batches
   * Most recent 50 upload batches with per-status counts.
   */
  fastify.get("/batches", async () => {
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
   * 3. GET /admin/ingestion/jobs?batchId=&status=&limit=&offset=
   * Review queue rows in upload order.
   */
  fastify.get("/jobs", async (request, reply) => {
    const parsed = JobListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }
    const { batchId, status, limit, offset } = parsed.data;

    const where = and(
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
   * 4. PATCH /admin/ingestion/jobs/:id
   * Educator edits a staged draft (fix text, add Bengali, verify answer key).
   * Status moves to pending_review once every bilingual field is filled.
   */
  fastify.patch("/jobs/:id", async (request, reply) => {
    const params = JobParamsSchema.safeParse(request.params);
    const body = UpdateJobBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: "Invalid draft",
        details: body.success ? undefined : formatIssues(body.error.issues),
      });
    }
    const { id } = params.data;
    const { draft, reviewNotes } = body.data;

    const [job] = await db
      .select()
      .from(questionIngestionJobs)
      .where(eq(questionIngestionJobs.id, id))
      .limit(1);
    if (!job) {
      return reply.status(404).send({ error: "Staged question not found" });
    }
    if (job.status !== "pending_ai" && job.status !== "pending_review") {
      return reply
        .status(409)
        .send({ error: `Cannot edit a question with status "${job.status}"` });
    }

    const taxonomy = await loadTaxonomyIndex();
    const tax = taxonomy.get(taxonomyKey(draft));
    if (!tax) {
      return reply.status(400).send({ error: unknownTaxonomyMessage(draft) });
    }
    const columns = draftColumns(draft, tax);

    const [liveDupe] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.contentHash, columns.contentHash))
      .limit(1);
    if (liveDupe) {
      return reply
        .status(409)
        .send({ error: `This edit duplicates live question ${liveDupe.id}` });
    }
    const [stagedDupe] = await db
      .select({ batchId: questionIngestionJobs.batchId })
      .from(questionIngestionJobs)
      .where(
        and(
          eq(questionIngestionJobs.contentHash, columns.contentHash),
          inArray(questionIngestionJobs.status, ACTIVE_STAGING_STATUSES),
          ne(questionIngestionJobs.id, id)
        )
      )
      .limit(1);
    if (stagedDupe) {
      return reply.status(409).send({
        error: `This edit duplicates a pending row in batch ${stagedDupe.batchId}`,
      });
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
   * 5. POST /admin/ingestion/jobs/approve  { ids: [...] }
   * Strict bilingual validation, then insert into the live `questions` bank.
   * The unique content hash makes a concurrent duplicate approval a no-op.
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
    const taxonomy = await loadTaxonomyIndex();

    const result = {
      inserted: 0,
      notPendingReview: ids.length - jobs.length,
      invalid: [] as Array<{ id: string; message: string }>,
      duplicates: [] as Array<{ id: string; message: string }>,
    };

    await db.transaction(async (tx) => {
      for (const job of jobs) {
        const valid = ApprovableQuestionSchema.safeParse(job.enrichedData);
        const tax = valid.success ? taxonomy.get(taxonomyKey(valid.data)) : undefined;
        if (!valid.success || !tax) {
          const message = valid.success
            ? unknownTaxonomyMessage(valid.data)
            : formatIssues(valid.error.issues);
          result.invalid.push({ id: job.id, message });
          await tx
            .update(questionIngestionJobs)
            .set({ errorMessage: message })
            .where(eq(questionIngestionJobs.id, job.id));
          continue;
        }

        const q = valid.data;
        const contentHash = computeContentHash(q);
        const [created] = await tx
          .insert(questions)
          .values({
            examId: tax.examId,
            examSlug: q.examSlug,
            subjectId: tax.subjectId,
            chapterId: tax.chapterId,
            subtopicId: tax.subtopicId,
            stem: q.stem,
            options: q.options,
            correctOption: q.correctOption,
            explanation: q.explanation,
            difficulty: q.difficulty,
            marksPositive: tax.marksPerCorrect,
            marksNegative: tax.negativeMarksPerWrong,
            previousYearTag: pyqLabel(q.pyqExamSlug, q.pyqYear),
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
   * 6. POST /admin/ingestion/jobs/reject  { ids: [...], reviewNotes? }
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
