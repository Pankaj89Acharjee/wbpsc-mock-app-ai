import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { exams, subjects, chapters, subtopics } from "../db/schema";
import {
  ExamConfigInputSchema,
  ExamSlugSchema,
  SYLLABUS_REQUIRED_COLUMNS,
  SyllabusRowSchema,
  csvTableToRecords,
  parseCsv,
  slugify,
  type BilingualText,
  type ExamConfigInput,
  type ExamDto,
  type SyllabusUploadResult,
} from "../../../../packages/shared-types/src/index";
import { formatIssues } from "../lib/validation";
import { requireAdmin } from "../lib/auth";
import { loadSyllabus, nodeMatches, toTreeDto } from "../lib/syllabus";

// ============================================================================
// Request Validation Schemas (Zod)
// ============================================================================

const ExamParamsSchema = z.object({ slug: ExamSlugSchema });

const SyllabusUploadBodySchema = z.object({
  fileName: z.string().max(200).optional(),
  content: z.string().min(1, "File is empty").max(2_000_000),
});

type ExamRow = typeof exams.$inferSelect;

function examColumns(input: ExamConfigInput) {
  return {
    title: { en: input.titleEn, bn: input.titleBn },
    description: { en: input.descriptionEn, bn: input.descriptionBn },
    totalQuestions: input.totalQuestions,
    durationMinutes: input.durationMinutes,
    marksPerCorrect: String(input.marksPerCorrect),
    negativeMarksPerWrong: String(input.negativeMarksPerWrong),
    estimatedCutoffMarks: String(input.estimatedCutoffMarks),
    isActive: input.isActive,
  };
}

function toExamDto(
  row: ExamRow,
  counts = { subjectCount: 0, subtopicCount: 0, questionCount: 0 }
): ExamDto {
  return {
    id: row.id,
    slug: row.slug,
    titleEn: row.title.en,
    titleBn: row.title.bn,
    descriptionEn: row.description.en,
    descriptionBn: row.description.bn,
    totalQuestions: row.totalQuestions,
    durationMinutes: row.durationMinutes,
    marksPerCorrect: Number(row.marksPerCorrect),
    negativeMarksPerWrong: Number(row.negativeMarksPerWrong),
    estimatedCutoffMarks: Number(row.estimatedCutoffMarks),
    isActive: row.isActive,
    ...counts,
  };
}

/** Appends -2, -3… until the slug is unused among siblings. */
function uniqueSlug(base: string, taken: string[]): string {
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/**
 * New names to store for a matched node, or null to leave it alone.
 * Rows carrying the slug (e.g. an edited copy of the downloaded syllabus) may
 * rename freely; rows matched by name only fix the Bengali name, so a casing
 * or "&"/"and" variant never renames an existing node.
 */
function renameTo(
  existing: BilingualText,
  incoming: BilingualText,
  matchedBySlug: boolean
): BilingualText | null {
  if (matchedBySlug) {
    return existing.en === incoming.en && existing.bn === incoming.bn ? null : incoming;
  }
  return existing.en === incoming.en && existing.bn !== incoming.bn
    ? { en: existing.en, bn: incoming.bn }
    : null;
}

// ============================================================================
// Route Plugin Implementation (registered under /admin/syllabus)
// ============================================================================

export const syllabusRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook("preHandler", requireAdmin);

  /**
   * 1. GET /admin/syllabus/exams
   * All exams with syllabus & question counts.
   */
  fastify.get("/exams", async () => {
    const [rows, syllabus] = await Promise.all([
      db.select().from(exams).orderBy(asc(exams.createdAt)),
      loadSyllabus(),
    ]);
    return {
      exams: rows.map((row) => {
        const subtopicList =
          syllabus
            .get(row.slug)
            ?.subjects.flatMap((s) => s.chapters.flatMap((c) => c.subtopics)) ?? [];
        return toExamDto(row, {
          subjectCount: syllabus.get(row.slug)?.subjects.length ?? 0,
          subtopicCount: subtopicList.length,
          questionCount: subtopicList.reduce((sum, t) => sum + t.questionCount, 0),
        });
      }),
    };
  });

  /**
   * 2. POST /admin/syllabus/exams
   * Creates an exam. Slug defaults to one generated from the English title.
   */
  fastify.post("/exams", async (request, reply) => {
    const parsed = ExamConfigInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid exam config",
        details: formatIssues(parsed.error.issues),
      });
    }
    const input = parsed.data;
    const slug = input.slug ?? slugify(input.titleEn);
    if (!ExamSlugSchema.safeParse(slug).success) {
      return reply
        .status(400)
        .send({ error: "Could not build a slug from the title — enter one manually" });
    }

    const [created] = await db
      .insert(exams)
      .values({ slug, ...examColumns(input) })
      .onConflictDoNothing({ target: exams.slug })
      .returning();
    if (!created) {
      return reply.status(409).send({ error: `An exam with slug "${slug}" already exists` });
    }
    return reply.status(201).send({ exam: toExamDto(created) });
  });

  /**
   * 3. PUT /admin/syllabus/exams/:slug
   * Updates exam config (slug is permanent — questions reference it).
   */
  fastify.put("/exams/:slug", async (request, reply) => {
    const params = ExamParamsSchema.safeParse(request.params);
    const parsed = ExamConfigInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.status(400).send({
        error: "Invalid exam config",
        details: parsed.success ? undefined : formatIssues(parsed.error.issues),
      });
    }
    const [updated] = await db
      .update(exams)
      .set(examColumns(parsed.data))
      .where(eq(exams.slug, params.data.slug))
      .returning();
    if (!updated) {
      return reply.status(404).send({ error: "Exam not found" });
    }
    return { exam: toExamDto(updated) };
  });

  /**
   * 4. GET /admin/syllabus/exams/:slug/tree
   * Subject → Chapter → Subtopic tree with question counts.
   */
  fastify.get("/exams/:slug/tree", async (request, reply) => {
    const params = ExamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid exam slug" });
    }
    const exam = (await loadSyllabus()).get(params.data.slug);
    if (!exam) {
      return reply.status(404).send({ error: "Exam not found" });
    }
    return { tree: toTreeDto(exam) };
  });

  /**
   * 5. POST /admin/syllabus/exams/:slug/upload  { content: "<csv>" }
   * Adds/renames subjects, chapters and subtopics from a CSV (one subtopic
   * per row). Existing nodes are matched by slug or name, so re-uploading
   * an edited file never creates duplicates. Nothing is deleted.
   */
  fastify.post("/exams/:slug/upload", async (request, reply) => {
    const params = ExamParamsSchema.safeParse(request.params);
    const body = SyllabusUploadBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Invalid syllabus upload" });
    }

    const { records, missingColumns } = csvTableToRecords(
      parseCsv(body.data.content),
      SYLLABUS_REQUIRED_COLUMNS
    );
    if (missingColumns.length > 0) {
      return reply.status(400).send({
        error: `CSV header is missing required columns: ${missingColumns.join(", ")}`,
      });
    }
    if (records.length === 0) {
      return reply.status(400).send({ error: "No syllabus rows found" });
    }

    const exam = (await loadSyllabus()).get(params.data.slug);
    if (!exam) {
      return reply.status(404).send({ error: "Exam not found" });
    }

    const result: SyllabusUploadResult = {
      created: { subjects: 0, chapters: 0, subtopics: 0 },
      updated: 0,
      errors: [],
    };

    await db.transaction(async (tx) => {
      for (const { rowNumber, record } of records) {
        const parsed = SyllabusRowSchema.safeParse(record);
        if (!parsed.success) {
          result.errors.push({ rowNumber, message: formatIssues(parsed.error.issues) });
          continue;
        }
        const row = parsed.data;
        const subjectName = { en: row.subject_en, bn: row.subject_bn };
        const chapterName = { en: row.chapter_en, bn: row.chapter_bn };
        const subtopicName = { en: row.subtopic_en, bn: row.subtopic_bn };
        const generated = {
          subject: row.subject_slug ?? slugify(row.subject_en),
          chapter: row.chapter_slug ?? slugify(row.chapter_en),
          subtopic: row.subtopic_slug ?? slugify(row.subtopic_en),
        };
        if (!generated.subject || !generated.chapter || !generated.subtopic) {
          result.errors.push({
            rowNumber,
            message: "English names must contain letters or digits (used to build slugs)",
          });
          continue;
        }

        // Subject
        let subject = exam.subjects.find((s) =>
          row.subject_slug ? s.slug === row.subject_slug : nodeMatches(s, row.subject_en)
        );
        if (!subject) {
          const slug = uniqueSlug(generated.subject, exam.subjects.map((s) => s.slug));
          const [ins] = await tx
            .insert(subjects)
            .values({
              examId: exam.id,
              slug,
              name: subjectName,
              displayOrder: exam.subjects.length + 1,
            })
            .returning({ id: subjects.id });
          subject = { id: ins.id, slug, name: subjectName, chapters: [] };
          exam.subjects.push(subject);
          result.created.subjects++;
        } else {
          const name = renameTo(subject.name, subjectName, !!row.subject_slug);
          if (name) {
            await tx.update(subjects).set({ name }).where(eq(subjects.id, subject.id));
            subject.name = name;
            result.updated++;
          }
        }

        // Chapter
        let chapter = subject.chapters.find((c) =>
          row.chapter_slug ? c.slug === row.chapter_slug : nodeMatches(c, row.chapter_en)
        );
        if (!chapter) {
          const slug = uniqueSlug(generated.chapter, subject.chapters.map((c) => c.slug));
          const [ins] = await tx
            .insert(chapters)
            .values({
              subjectId: subject.id,
              slug,
              name: chapterName,
              displayOrder: subject.chapters.length + 1,
            })
            .returning({ id: chapters.id });
          chapter = { id: ins.id, slug, name: chapterName, subtopics: [] };
          subject.chapters.push(chapter);
          result.created.chapters++;
        } else {
          const name = renameTo(chapter.name, chapterName, !!row.chapter_slug);
          if (name) {
            await tx.update(chapters).set({ name }).where(eq(chapters.id, chapter.id));
            chapter.name = name;
            result.updated++;
          }
        }

        // Subtopic
        const subtopic = chapter.subtopics.find((t) =>
          row.subtopic_slug ? t.slug === row.subtopic_slug : nodeMatches(t, row.subtopic_en)
        );
        if (!subtopic) {
          const slug = uniqueSlug(generated.subtopic, chapter.subtopics.map((t) => t.slug));
          const [ins] = await tx
            .insert(subtopics)
            .values({ chapterId: chapter.id, subjectId: subject.id, slug, name: subtopicName })
            .returning({ id: subtopics.id });
          chapter.subtopics.push({ id: ins.id, slug, name: subtopicName, questionCount: 0 });
          result.created.subtopics++;
        } else {
          const name = renameTo(subtopic.name, subtopicName, !!row.subtopic_slug);
          if (name) {
            await tx.update(subtopics).set({ name }).where(eq(subtopics.id, subtopic.id));
            subtopic.name = name;
            result.updated++;
          }
        }
      }
    });

    request.log.info(
      { exam: exam.slug, ...result.created, errors: result.errors.length },
      "Syllabus CSV applied"
    );
    return { result, tree: toTreeDto(exam) };
  });
};
