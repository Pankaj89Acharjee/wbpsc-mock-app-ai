import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  attemptAnswers,
  chapters,
  exams,
  examSeries,
  questionIngestionJobs,
  questions,
  seriesQuestions,
  seriesRosterSlots,
  subjects,
  subtopics,
  testAttempts,
} from "../db/schema";
import {
  ExamConfigInputSchema,
  ExamSlugSchema,
  SYLLABUS_REQUIRED_COLUMNS,
  SyllabusRowSchema,
  WBPSC_SUBJECT_PRESETS,
  csvTableToRecords,
  parseCsv,
  slugify,
  type BilingualText,
  type ExamConfigInput,
  type ExamDto,
  type ExamSubjectWeightage,
  type SyllabusRow,
  type SyllabusUploadResult,
} from "../../../../packages/shared-types/src/index";
import { formatIssues } from "../lib/validation";
import { requireAdmin } from "../lib/auth";
import { loadSyllabus, nodeMatches, sameConcept, toTreeDto } from "../lib/syllabus";
import {
  ensureBilingualSyllabusNames,
  generateExamSyllabusWithAi,
} from "../lib/aiEnrichment";

type LoadedSyllabusMap = Awaited<ReturnType<typeof loadSyllabus>>;

/**
 * Performs a safe, transactional cascade delete of a syllabus node (subtopic, chapter,
 * subject, entire exam syllabus tree, or entire exam) along with any dependent questions,
 * series question assignments, series blueprint slots, and attempt answer references.
 */
async function cascadeDeleteSyllabusScope(scope: {
  subtopicId?: string;
  chapterId?: string;
  subjectId?: string;
  examIdForTreeOnly?: string;
  examIdFullDelete?: string;
}): Promise<{ deletedQuestions: number }> {
  return db.transaction(async (tx) => {
    let targetSubjectIds: string[] = [];
    let targetSubtopicIds: string[] = [];
    let targetQuestionIds: string[] = [];

    const examId = scope.examIdForTreeOnly ?? scope.examIdFullDelete;

    if (examId) {
      const subjRows = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(eq(subjects.examId, examId));
      targetSubjectIds = subjRows.map((r) => r.id);

      if (targetSubjectIds.length > 0) {
        const subRows = await tx
          .select({ id: subtopics.id })
          .from(subtopics)
          .where(inArray(subtopics.subjectId, targetSubjectIds));
        targetSubtopicIds = subRows.map((r) => r.id);
      }

      const qRows = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.examId, examId));
      targetQuestionIds = qRows.map((r) => r.id);
    } else if (scope.subjectId) {
      targetSubjectIds = [scope.subjectId];
      const subRows = await tx
        .select({ id: subtopics.id })
        .from(subtopics)
        .where(eq(subtopics.subjectId, scope.subjectId));
      targetSubtopicIds = subRows.map((r) => r.id);

      const qRows = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.subjectId, scope.subjectId));
      targetQuestionIds = qRows.map((r) => r.id);
    } else if (scope.chapterId) {
      const subRows = await tx
        .select({ id: subtopics.id })
        .from(subtopics)
        .where(eq(subtopics.chapterId, scope.chapterId));
      targetSubtopicIds = subRows.map((r) => r.id);

      const qRows = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.chapterId, scope.chapterId));
      targetQuestionIds = qRows.map((r) => r.id);
    } else if (scope.subtopicId) {
      targetSubtopicIds = [scope.subtopicId];
      const qRows = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.subtopicId, scope.subtopicId));
      targetQuestionIds = qRows.map((r) => r.id);
    }

    // 1. Delete attemptAnswers referencing questions or subtopics in scope
    if (targetQuestionIds.length > 0) {
      await tx.delete(attemptAnswers).where(inArray(attemptAnswers.questionId, targetQuestionIds));
    }
    if (targetSubtopicIds.length > 0) {
      await tx.delete(attemptAnswers).where(inArray(attemptAnswers.subtopicId, targetSubtopicIds));
    }

    // 2. Delete seriesQuestions referencing questions or nodes in scope
    if (targetQuestionIds.length > 0) {
      await tx.delete(seriesQuestions).where(inArray(seriesQuestions.questionId, targetQuestionIds));
    }
    if (scope.subtopicId) {
      await tx.delete(seriesQuestions).where(eq(seriesQuestions.subtopicId, scope.subtopicId));
    }
    if (scope.chapterId) {
      await tx.delete(seriesQuestions).where(eq(seriesQuestions.chapterId, scope.chapterId));
    }
    if (targetSubjectIds.length > 0) {
      await tx.delete(seriesQuestions).where(inArray(seriesQuestions.subjectId, targetSubjectIds));
    }

    // 3. Delete seriesRosterSlots referencing nodes in scope
    if (scope.subtopicId) {
      await tx.delete(seriesRosterSlots).where(eq(seriesRosterSlots.subtopicId, scope.subtopicId));
    }
    if (scope.chapterId) {
      await tx.delete(seriesRosterSlots).where(eq(seriesRosterSlots.chapterId, scope.chapterId));
    }
    if (targetSubjectIds.length > 0) {
      await tx.delete(seriesRosterSlots).where(inArray(seriesRosterSlots.subjectId, targetSubjectIds));
    }

    // 4. Clean up questionIngestionJobs references
    if (scope.subtopicId) {
      await tx
        .update(questionIngestionJobs)
        .set({ subtopicId: null })
        .where(eq(questionIngestionJobs.subtopicId, scope.subtopicId));
    }
    if (scope.chapterId) {
      await tx
        .update(questionIngestionJobs)
        .set({ chapterId: null, subtopicId: null })
        .where(eq(questionIngestionJobs.chapterId, scope.chapterId));
    }
    if (targetSubjectIds.length > 0) {
      await tx
        .update(questionIngestionJobs)
        .set({ subjectId: null, chapterId: null, subtopicId: null })
        .where(inArray(questionIngestionJobs.subjectId, targetSubjectIds));
    }

    // 5. Delete questions in scope
    if (targetQuestionIds.length > 0) {
      await tx.delete(questions).where(inArray(questions.id, targetQuestionIds));
    }

    // 6. Delete the target node(s)
    if (scope.subtopicId) {
      await tx.delete(subtopics).where(eq(subtopics.id, scope.subtopicId));
    } else if (scope.chapterId) {
      await tx.delete(chapters).where(eq(chapters.id, scope.chapterId));
    } else if (scope.subjectId) {
      await tx.delete(subjects).where(eq(subjects.id, scope.subjectId));
    } else if (scope.examIdForTreeOnly) {
      await tx.delete(subjects).where(eq(subjects.examId, scope.examIdForTreeOnly));
    } else if (scope.examIdFullDelete) {
      await tx.delete(testAttempts).where(eq(testAttempts.examId, scope.examIdFullDelete));
      await tx.delete(examSeries).where(eq(examSeries.examId, scope.examIdFullDelete));
      await tx.delete(questionIngestionJobs).where(eq(questionIngestionJobs.examId, scope.examIdFullDelete));
      await tx.delete(subjects).where(eq(subjects.examId, scope.examIdFullDelete));
      await tx.delete(exams).where(eq(exams.id, scope.examIdFullDelete));
    }

    return { deletedQuestions: targetQuestionIds.length };
  });
}

type LoadedExam = NonNullable<ReturnType<LoadedSyllabusMap["get"]>>;

// ============================================================================
// Request Validation Schemas (Zod)
// ============================================================================

const ExamParamsSchema = z.object({ slug: ExamSlugSchema });
const NodeIdParamsSchema = z.object({ id: z.string().uuid() });

const SyllabusUploadBodySchema = z.object({
  fileName: z.string().max(200).optional(),
  content: z.string().min(1, "File is empty").max(2_000_000),
});

const GenerateAiSyllabusBodySchema = z.object({
  focusSubjects: z.array(z.string().trim().min(1)).optional(),
  subjectsFocus: z.array(z.string().trim().min(1)).optional(),
  customInstructions: z.string().trim().max(1000).optional(),
});

const ManualNodeRowSchema = z.object({
  subject_en: z.string().trim().min(1, "Subject (English) is required"),
  subject_bn: z.string().trim().optional().default(""),
  chapter_en: z.string().trim().min(1, "Chapter (English) is required"),
  chapter_bn: z.string().trim().optional().default(""),
  subtopic_en: z.string().trim().min(1, "Subtopic (English) is required"),
  subtopic_bn: z.string().trim().optional().default(""),
});

const SingleManualNodeSchema = z.object({
  subjectEn: z.string().trim().min(1, "Subject (English) is required"),
  subjectBn: z.string().trim().optional().default(""),
  chapterEn: z.string().trim().min(1, "Chapter (English) is required"),
  chapterBn: z.string().trim().optional().default(""),
  subtopicEn: z.string().trim().min(1, "Subtopic (English) is required"),
  subtopicBn: z.string().trim().optional().default(""),
});

const ManualNodesBodySchema = z.union([
  z.object({ rows: z.array(ManualNodeRowSchema).min(1).max(200) }),
  SingleManualNodeSchema,
]);

const UpdateNodeNameBodySchema = z.union([
  z.object({
    en: z.string().trim().min(1, "English name is required").max(200),
    bn: z.string().trim().max(200).optional().default(""),
    weightageQuestions: z.coerce.number().int().min(1).max(300).optional(),
  }),
  z.object({
    nameEn: z.string().trim().min(1, "English name is required").max(200),
    nameBn: z.string().trim().max(200).optional().default(""),
    weightageQuestions: z.coerce.number().int().min(1).max(300).optional(),
  }),
]);

async function applySubjectWeightages(examId: string, weightages: ExamSubjectWeightage[]) {
  if (!weightages || weightages.length === 0) return;
  const existingSubjects = await db
    .select()
    .from(subjects)
    .where(eq(subjects.examId, examId))
    .orderBy(asc(subjects.displayOrder));

  for (let i = 0; i < weightages.length; i++) {
    const w = weightages[i];
    const preset = WBPSC_SUBJECT_PRESETS.find(
      (p) => p.en.toLowerCase() === w.subjectEn.trim().toLowerCase()
    );
    const subjectBn = w.subjectBn?.trim() || preset?.bn || w.subjectEn.trim();
    const existing = existingSubjects.find((s) =>
      nodeMatches(s, w.subjectEn) || sameConcept(s.name.en, w.subjectEn)
    );

    let subjectId: string;
    if (existing) {
      subjectId = existing.id;
      await db
        .update(subjects)
        .set({
          weightageQuestions: w.weightageQuestions,
          name: {
            en: w.subjectEn.trim(),
            bn: w.subjectBn?.trim() || existing.name.bn || subjectBn,
          },
        })
        .where(eq(subjects.id, existing.id));
    } else {
      const baseSlug = slugify(w.subjectEn) || `subject-${i + 1}`;
      const slug = uniqueSlug(
        baseSlug,
        existingSubjects.map((s) => s.slug)
      );
      const [inserted] = await db
        .insert(subjects)
        .values({
          examId,
          slug,
          name: { en: w.subjectEn.trim(), bn: subjectBn },
          weightageQuestions: w.weightageQuestions,
          displayOrder: existingSubjects.length + 1,
        })
        .returning();
      subjectId = inserted.id;
      existingSubjects.push(inserted);
    }

    // Ensure the subject has at least one chapter & subtopic so questions can immediately be generated or imported for it
    const existingChaps = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(eq(chapters.subjectId, subjectId))
      .limit(1);

    if (existingChaps.length === 0) {
      const chaptersToSeed = preset?.chapters.length
        ? preset.chapters
        : [
            {
              en: `${w.subjectEn.trim()} — Core Topics`,
              bn: `${subjectBn} — মূল অধ্যায়`,
              subtopics: [
                {
                  en: `${w.subjectEn.trim()} — Fundamentals & Practice`,
                  bn: `${subjectBn} — মৌলিক ধারণা ও অনুশীলন`,
                },
              ],
            },
          ];

      for (let ci = 0; ci < chaptersToSeed.length; ci++) {
        const ch = chaptersToSeed[ci];
        const chapSlug = slugify(ch.en) || `chapter-${ci + 1}`;
        const [insChap] = await db
          .insert(chapters)
          .values({
            subjectId,
            slug: chapSlug,
            name: { en: ch.en, bn: ch.bn || ch.en },
            displayOrder: ci + 1,
          })
          .onConflictDoNothing()
          .returning();
        if (!insChap) continue;
        for (let ti = 0; ti < ch.subtopics.length; ti++) {
          const st = ch.subtopics[ti];
          const subSlug = slugify(st.en) || `topic-${ti + 1}`;
          await db
            .insert(subtopics)
            .values({
              subjectId,
              chapterId: insChap.id,
              slug: subSlug,
              name: { en: st.en, bn: st.bn || st.en },
            })
            .onConflictDoNothing();
        }
      }
    }
  }
}

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

/**
 * Shared transactional upsert for syllabus rows (used by CSV upload, AI generator,
 * and manual guided entry).
 */
async function upsertSyllabusRows(
  exam: LoadedExam,
  rows: Array<{ rowNumber: number; row: SyllabusRow }>
): Promise<SyllabusUploadResult> {
  const result: SyllabusUploadResult = {
    created: { subjects: 0, chapters: 0, subtopics: 0 },
    updated: 0,
    errors: [],
  };

  await db.transaction(async (tx) => {
    for (const { rowNumber, row } of rows) {
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
        const slug = uniqueSlug(
          generated.subject,
          exam.subjects.map((s) => s.slug)
        );
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
        const slug = uniqueSlug(
          generated.chapter,
          subject.chapters.map((c) => c.slug)
        );
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
        const slug = uniqueSlug(
          generated.subtopic,
          chapter.subtopics.map((t) => t.slug)
        );
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

  return result;
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
    if (input.subjectWeightages?.length) {
      await applySubjectWeightages(created.id, input.subjectWeightages);
    }
    const syllabus = await loadSyllabus();
    const subtopicList =
      syllabus.get(created.slug)?.subjects.flatMap((s) => s.chapters.flatMap((c) => c.subtopics)) ?? [];
    return reply.status(201).send({
      exam: toExamDto(created, {
        subjectCount: syllabus.get(created.slug)?.subjects.length ?? 0,
        subtopicCount: subtopicList.length,
        questionCount: 0,
      }),
    });
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
    if (parsed.data.subjectWeightages?.length) {
      await applySubjectWeightages(updated.id, parsed.data.subjectWeightages);
    }
    const syllabus = await loadSyllabus();
    const subtopicList =
      syllabus.get(updated.slug)?.subjects.flatMap((s) => s.chapters.flatMap((c) => c.subtopics)) ?? [];
    return {
      exam: toExamDto(updated, {
        subjectCount: syllabus.get(updated.slug)?.subjects.length ?? 0,
        subtopicCount: subtopicList.length,
        questionCount: subtopicList.reduce((sum, t) => sum + t.questionCount, 0),
      }),
    };
  });

  /**
   * 3b. DELETE /admin/syllabus/exams/:slug
   * Cascade-deletes an exam along with its syllabus, questions, and test series.
   */
  fastify.delete("/exams/:slug", async (request, reply) => {
    const params = ExamParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid exam slug" });

    const [examRow] = await db
      .select()
      .from(exams)
      .where(eq(exams.slug, params.data.slug))
      .limit(1);
    if (!examRow) return reply.status(404).send({ error: "Exam not found" });

    const { deletedQuestions } = await cascadeDeleteSyllabusScope({
      examIdFullDelete: examRow.id,
    });
    return { deleted: true, deletedQuestions };
  });

  /**
   * 3c. DELETE /admin/syllabus/exams/:slug/tree
   * Cascade-deletes the entire syllabus (all subjects, chapters, subtopics, and linked questions)
   * of an exam while keeping the exam category itself intact.
   */
  fastify.delete("/exams/:slug/tree", async (request, reply) => {
    const params = ExamParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid exam slug" });

    const [examRow] = await db
      .select()
      .from(exams)
      .where(eq(exams.slug, params.data.slug))
      .limit(1);
    if (!examRow) return reply.status(404).send({ error: "Exam not found" });

    const { deletedQuestions } = await cascadeDeleteSyllabusScope({
      examIdForTreeOnly: examRow.id,
    });
    const tree = await reloadTreeByExamId(examRow.id);
    return { deleted: true, deletedQuestions, tree };
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
   * Adds/renames subjects, chapters and subtopics from a CSV.
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

    const validatedRows: Array<{ rowNumber: number; row: SyllabusRow }> = [];
    const preErrors: Array<{ rowNumber: number; message: string }> = [];

    for (const { rowNumber, record } of records) {
      const parsed = SyllabusRowSchema.safeParse(record);
      if (!parsed.success) {
        preErrors.push({ rowNumber, message: formatIssues(parsed.error.issues) });
        continue;
      }
      validatedRows.push({ rowNumber, row: parsed.data });
    }

    const result = await upsertSyllabusRows(exam, validatedRows);
    result.errors.unshift(...preErrors);

    request.log.info(
      { exam: exam.slug, ...result.created, errors: result.errors.length },
      "Syllabus CSV applied"
    );
    return { result, tree: toTreeDto(exam) };
  });

  /**
   * 6. POST /admin/syllabus/exams/:slug/generate-ai
   * Uses Gemini to generate a complete bilingual syllabus (History, Geography,
   * Polity, Science, Mathematics, Reasoning, English, Current Affairs, GK, etc.)
   * and saves it directly into the database.
   */
  fastify.post("/exams/:slug/generate-ai", async (request, reply) => {
    const params = ExamParamsSchema.safeParse(request.params);
    const body = GenerateAiSyllabusBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Invalid AI syllabus generation request" });
    }

    const [examRow] = await db
      .select()
      .from(exams)
      .where(eq(exams.slug, params.data.slug))
      .limit(1);
    if (!examRow) return reply.status(404).send({ error: "Exam not found" });

    const exam = (await loadSyllabus()).get(params.data.slug)!;

    let generatedSubjects;
    try {
      generatedSubjects = await generateExamSyllabusWithAi({
        examSlug: examRow.slug,
        examTitleEn: examRow.title.en,
        examDescriptionEn: examRow.description.en,
        focusSubjects: body.data.focusSubjects ?? body.data.subjectsFocus ?? [],
        customInstructions: body.data.customInstructions,
        // The AI is told what exists; the code below still enforces "no duplicates"
        existing: exam.subjects.map((s) => ({
          subject: s.name.en,
          chapters: s.chapters.map((c) => ({ chapter: c.name.en, subtopics: c.subtopics.map((t) => t.name.en) })),
        })),
      });
    } catch (err) {
      return reply.status(502).send({ error: (err as Error).message });
    }

    // Map every generated heading onto an existing node that means the same
    // ("National Movement" → "Indian National Movement"), and drop subtopics the
    // subject already covers — only genuinely missing nodes are inserted.
    type Named = { en: string; bn: string };
    const subjectsSeen: Array<{ name: Named; chapters: Named[]; subtopics: string[] }> = exam.subjects.map((s) => ({
      name: s.name,
      chapters: s.chapters.map((c) => c.name),
      subtopics: s.chapters.flatMap((c) => c.subtopics.map((t) => t.name.en)),
    }));
    const flatRows: Array<{ rowNumber: number; row: SyllabusRow }> = [];
    let rowNumber = 1;
    let skippedDuplicates = 0;
    for (const subj of generatedSubjects) {
      const subjectEn = subj.subject_en.trim();
      if (!subjectEn) continue;
      let s = subjectsSeen.find((x) => sameConcept(x.name.en, subjectEn));
      if (!s) {
        s = { name: { en: subjectEn, bn: subj.subject_bn.trim() || subjectEn }, chapters: [], subtopics: [] };
        subjectsSeen.push(s);
      }
      for (const chap of subj.chapters) {
        const chapterEn = chap.chapter_en.trim();
        if (!chapterEn) continue;
        let c = s.chapters.find((x) => sameConcept(x.en, chapterEn));
        if (!c) {
          c = { en: chapterEn, bn: chap.chapter_bn.trim() || chapterEn };
          s.chapters.push(c);
        }
        for (const st of chap.subtopics) {
          const subtopicEn = st.subtopic_en.trim();
          if (!subtopicEn) continue;
          if (s.subtopics.some((x) => sameConcept(x, subtopicEn))) {
            skippedDuplicates++;
            continue;
          }
          s.subtopics.push(subtopicEn);
          flatRows.push({
            rowNumber: rowNumber++,
            row: {
              subject_en: s.name.en,
              subject_bn: s.name.bn,
              chapter_en: c.en,
              chapter_bn: c.bn,
              subtopic_en: subtopicEn,
              subtopic_bn: st.subtopic_bn.trim() || subtopicEn,
            },
          });
        }
      }
    }

    if (flatRows.length === 0) {
      return {
        result: { created: { subjects: 0, chapters: 0, subtopics: 0 }, updated: 0, errors: [] },
        tree: toTreeDto(exam),
        modelUsed: "gemini-2.5-flash",
        skippedDuplicates,
      };
    }

    const result = await upsertSyllabusRows(exam, flatRows);

    return { result, tree: toTreeDto(exam), modelUsed: "gemini-2.5-flash", skippedDuplicates };
  });

  /**
   * 7. POST /admin/syllabus/exams/:slug/nodes
   * Guided manual or preset addition of Subject → Chapter → Subtopic rows.
   * Automatically translates missing Bengali names in the background.
   */
  fastify.post("/exams/:slug/nodes", async (request, reply) => {
    const params = ExamParamsSchema.safeParse(request.params);
    const body = ManualNodesBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: body.success ? "Invalid exam slug" : formatIssues(body.error.issues),
      });
    }

    const exam = (await loadSyllabus()).get(params.data.slug);
    if (!exam) return reply.status(404).send({ error: "Exam not found" });

    const inputRows =
      "rows" in body.data
        ? body.data.rows
        : [
            {
              subject_en: body.data.subjectEn,
              subject_bn: body.data.subjectBn,
              chapter_en: body.data.chapterEn,
              chapter_bn: body.data.chapterBn,
              subtopic_en: body.data.subtopicEn,
              subtopic_bn: body.data.subtopicBn,
            },
          ];

    const enrichedRows: Array<{ rowNumber: number; row: SyllabusRow }> = [];
    for (const [idx, r] of inputRows.entries()) {
      const bn = await ensureBilingualSyllabusNames({
        subjectEn: r.subject_en,
        subjectBn: r.subject_bn,
        chapterEn: r.chapter_en,
        chapterBn: r.chapter_bn,
        subtopicEn: r.subtopic_en,
        subtopicBn: r.subtopic_bn,
      });
      enrichedRows.push({
        rowNumber: idx + 1,
        row: {
          subject_en: r.subject_en,
          subject_bn: bn.subjectBn,
          chapter_en: r.chapter_en,
          chapter_bn: bn.chapterBn,
          subtopic_en: r.subtopic_en,
          subtopic_bn: bn.subtopicBn,
        },
      });
    }

    const result = await upsertSyllabusRows(exam, enrichedRows);
    return { result, tree: toTreeDto(exam) };
  });

  /** Helper to reload the tree of the exam containing a subjectId */
  async function reloadTreeByExamId(examId: string) {
    const syllabus = await loadSyllabus();
    for (const e of syllabus.values()) {
      if (e.id === examId) return toTreeDto(e);
    }
    return null;
  }

  /**
   * 8. PATCH & DELETE for individual Subject / Chapter / Subtopic nodes (CRUD)
   */
  fastify.patch("/subjects/:id", async (request, reply) => {
    const params = NodeIdParamsSchema.safeParse(request.params);
    const body = UpdateNodeNameBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Invalid subject update" });
    }
    const nameEn = "en" in body.data ? body.data.en : body.data.nameEn;
    const nameBn = "bn" in body.data ? body.data.bn : body.data.nameBn;
    const bn = await ensureBilingualSyllabusNames({
      subjectEn: nameEn,
      subjectBn: nameBn,
    });
    const [updated] = await db
      .update(subjects)
      .set({
        name: { en: nameEn, bn: bn.subjectBn },
        ...(body.data.weightageQuestions !== undefined
          ? { weightageQuestions: body.data.weightageQuestions }
          : {}),
      })
      .where(eq(subjects.id, params.data.id))
      .returning();
    if (!updated) return reply.status(404).send({ error: "Subject not found" });
    const tree = await reloadTreeByExamId(updated.examId);
    return { subject: updated, tree };
  });

  fastify.delete("/subjects/:id", async (request, reply) => {
    const params = NodeIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid subject id" });

    const [subj] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.id, params.data.id))
      .limit(1);
    if (!subj) return reply.status(404).send({ error: "Subject not found" });

    const { deletedQuestions } = await cascadeDeleteSyllabusScope({
      subjectId: params.data.id,
    });
    const tree = await reloadTreeByExamId(subj.examId);
    return { deleted: true, deletedQuestions, tree };
  });

  fastify.patch("/chapters/:id", async (request, reply) => {
    const params = NodeIdParamsSchema.safeParse(request.params);
    const body = UpdateNodeNameBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Invalid chapter update" });
    }
    const nameEn = "en" in body.data ? body.data.en : body.data.nameEn;
    const nameBn = "bn" in body.data ? body.data.bn : body.data.nameBn;
    const bn = await ensureBilingualSyllabusNames({
      chapterEn: nameEn,
      chapterBn: nameBn,
    });
    const [updated] = await db
      .update(chapters)
      .set({ name: { en: nameEn, bn: bn.chapterBn } })
      .where(eq(chapters.id, params.data.id))
      .returning();
    if (!updated) return reply.status(404).send({ error: "Chapter not found" });
    const [subj] = await db
      .select({ examId: subjects.examId })
      .from(subjects)
      .where(eq(subjects.id, updated.subjectId))
      .limit(1);
    const tree = subj ? await reloadTreeByExamId(subj.examId) : null;
    return { chapter: updated, tree };
  });

  fastify.delete("/chapters/:id", async (request, reply) => {
    const params = NodeIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid chapter id" });

    const [chap] = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, params.data.id))
      .limit(1);
    if (!chap) return reply.status(404).send({ error: "Chapter not found" });

    const [subj] = await db
      .select({ examId: subjects.examId })
      .from(subjects)
      .where(eq(subjects.id, chap.subjectId))
      .limit(1);

    const { deletedQuestions } = await cascadeDeleteSyllabusScope({
      chapterId: params.data.id,
    });
    const tree = subj ? await reloadTreeByExamId(subj.examId) : null;
    return { deleted: true, deletedQuestions, tree };
  });

  fastify.patch("/subtopics/:id", async (request, reply) => {
    const params = NodeIdParamsSchema.safeParse(request.params);
    const body = UpdateNodeNameBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Invalid subtopic update" });
    }
    const nameEn = "en" in body.data ? body.data.en : body.data.nameEn;
    const nameBn = "bn" in body.data ? body.data.bn : body.data.nameBn;
    const bn = await ensureBilingualSyllabusNames({
      subtopicEn: nameEn,
      subtopicBn: nameBn,
    });
    const [updated] = await db
      .update(subtopics)
      .set({ name: { en: nameEn, bn: bn.subtopicBn } })
      .where(eq(subtopics.id, params.data.id))
      .returning();
    if (!updated) return reply.status(404).send({ error: "Subtopic not found" });
    const [subj] = await db
      .select({ examId: subjects.examId })
      .from(subjects)
      .where(eq(subjects.id, updated.subjectId))
      .limit(1);
    const tree = subj ? await reloadTreeByExamId(subj.examId) : null;
    return { subtopic: updated, tree };
  });

  fastify.delete("/subtopics/:id", async (request, reply) => {
    const params = NodeIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid subtopic id" });

    const [sub] = await db
      .select()
      .from(subtopics)
      .where(eq(subtopics.id, params.data.id))
      .limit(1);
    if (!sub) return reply.status(404).send({ error: "Subtopic not found" });

    const [subj] = await db
      .select({ examId: subjects.examId })
      .from(subjects)
      .where(eq(subjects.id, sub.subjectId))
      .limit(1);

    const { deletedQuestions } = await cascadeDeleteSyllabusScope({
      subtopicId: params.data.id,
    });
    const tree = subj ? await reloadTreeByExamId(subj.examId) : null;
    return { deleted: true, deletedQuestions, tree };
  });
};
