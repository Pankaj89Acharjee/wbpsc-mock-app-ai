import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { exams, subjects, subtopics } from "../db/schema";
import {
  SupportedLanguageSchema,
  type AiNoteDto,
  type CachedNoteRefDto,
} from "../../../../packages/shared-types/src/index";
import { requireUser } from "../lib/auth";
import { ApiAiError, callApiAi } from "../lib/apiAi";
import { formatIssues } from "../lib/validation";

// ============================================================================
// Request Validation Schemas (Zod)
// ============================================================================

const NoteBodySchema = z.object({
  subtopicId: z.string().uuid(),
  language: SupportedLanguageSchema,
});

const EvaluateBodySchema = z
  .object({
    examSlug: z.enum(["wbpsc-clerkship-part2", "wbcs-mains"]),
    taskType: z.enum(["report_writing", "precis_writing", "translation", "essay"]),
    language: SupportedLanguageSchema,
    questionPrompt: z.string().trim().max(5000).default(""),
    targetWordLimit: z.coerce.number().int().min(20).max(1000),
    studentAnswerText: z.string().max(20000).nullable().optional(),
    imageBase64: z.string().max(11_500_000).nullable().optional(), // ≈ 8 MB image
    imageMimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
  })
  .refine((b) => b.studentAnswerText?.trim() || b.imageBase64, {
    message: "Type your answer or upload a photo of it",
  });

interface ApiAiNoteRecord {
  exam_slug: string;
  topic_slug: string;
  language: "en" | "bn";
  content_markdown: string;
  mnemonics: string[];
  model_used: string;
}

interface ApiAiEvaluation {
  transcribed_student_answer: string;
  estimated_word_count: number;
  target_word_limit: number;
  grammar_score: number;
  content_score: number;
  word_limit_score: number;
  total_score: number;
  strengths: string[];
  improvements_needed: string[];
  corrected_model_answer: string;
}

function sendAiError(reply: FastifyReply, err: unknown) {
  if (err instanceof ApiAiError) {
    // 403 = Pro plan required, 429 = daily quota — pass through; anything else is a gateway error
    const status = err.status === 403 || err.status === 429 ? err.status : 502;
    return reply.status(status).send({ error: err.message });
  }
  throw err;
}

// ============================================================================
// Route Plugin Implementation (registered under /ai)
// ============================================================================

export const aiRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook("preHandler", requireUser);

  /**
   * 1. GET /ai/notes/cached
   * Which study notes already exist in api-ai's shared cache (free to open).
   * Empty until api-ai has created its cache table.
   */
  fastify.get("/notes/cached", async () => {
    try {
      const rows = await db.execute<{
        exam_slug: string;
        topic_slug: string;
        language: "en" | "bn";
        model_used: string;
        hit_count: number;
        updated_at: Date;
      }>(
        sql`select exam_slug, topic_slug, language, model_used, hit_count, updated_at
            from ai_notes_cache order by updated_at desc limit 500`
      );
      const notes: CachedNoteRefDto[] = rows.map((r) => ({
        examSlug: r.exam_slug,
        topicSlug: r.topic_slug,
        language: r.language,
        modelUsed: r.model_used,
        hitCount: r.hit_count,
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
      return { notes };
    } catch {
      return { notes: [] };
    }
  });

  /**
   * 2. POST /ai/notes  { subtopicId, language }
   * Revision note for a weak subtopic via api-ai's 3-tier cache
   * (Redis → PostgreSQL → Gemini on miss; Pro plans, 15 new notes/day).
   */
  fastify.post("/notes", async (request, reply) => {
    const parsed = NoteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
    }
    const { subtopicId, language } = parsed.data;

    const [topic] = await db
      .select({
        examSlug: exams.slug,
        subjectName: subjects.name,
        subtopicSlug: subtopics.slug,
        subtopicName: subtopics.name,
      })
      .from(subtopics)
      .innerJoin(subjects, eq(subtopics.subjectId, subjects.id))
      .innerJoin(exams, eq(subjects.examId, exams.id))
      .where(eq(subtopics.id, subtopicId))
      .limit(1);
    if (!topic) return reply.status(404).send({ error: "Subtopic not found" });

    const user = request.user!;
    try {
      const res = await callApiAi<{ cached: boolean; data: ApiAiNoteRecord }>(
        "/ai/generate-notes",
        JSON.stringify({
          user_id: user.id,
          subscription_tier: user.subscriptionTier,
          exam_slug: topic.examSlug,
          subject_name: topic.subjectName[language],
          topic_slug: topic.subtopicSlug,
          topic_title: topic.subtopicName[language],
          language,
        })
      );
      const note: AiNoteDto = {
        examSlug: res.data.exam_slug,
        topicSlug: res.data.topic_slug,
        language: res.data.language,
        topicTitle: topic.subtopicName,
        contentMarkdown: res.data.content_markdown,
        mnemonics: res.data.mnemonics ?? [],
        modelUsed: res.data.model_used,
        cached: res.cached,
      };
      return { note };
    } catch (err) {
      return sendAiError(reply, err);
    }
  });

  /**
   * 3. POST /ai/evaluate-descriptive
   * Clerkship Part-II / WBCS Mains descriptive answer (typed or photo) graded by
   * api-ai (gemini-2.5-flash). JSON in, forwarded to api-ai as multipart.
   */
  fastify.post(
    "/evaluate-descriptive",
    { bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      const parsed = EvaluateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
      }
      const b = parsed.data;
      const user = request.user!;

      const form = new FormData();
      form.set("user_id", user.id);
      form.set("subscription_tier", user.subscriptionTier);
      form.set("exam_slug", b.examSlug);
      form.set("task_type", b.taskType);
      form.set("language", b.language);
      form.set("question_prompt", b.questionPrompt);
      form.set("target_word_limit", String(b.targetWordLimit));
      if (b.studentAnswerText?.trim()) form.set("student_answer_text", b.studentAnswerText);
      if (b.imageBase64) {
        const bytes = Buffer.from(b.imageBase64, "base64");
        form.set("answer_image", new Blob([bytes], { type: b.imageMimeType }), "answer-sheet");
      }

      try {
        const res = await callApiAi<{ model_used: string; evaluation: ApiAiEvaluation }>(
          "/ai/evaluate-descriptive",
          form,
          { json: false }
        );
        const e = res.evaluation;
        return {
          modelUsed: res.model_used,
          evaluation: {
            transcribedAnswer: e.transcribed_student_answer,
            estimatedWordCount: e.estimated_word_count,
            targetWordLimit: e.target_word_limit,
            grammarScore: e.grammar_score,
            contentScore: e.content_score,
            wordLimitScore: e.word_limit_score,
            totalScore: e.total_score,
            strengths: e.strengths,
            improvementsNeeded: e.improvements_needed,
            correctedModelAnswer: e.corrected_model_answer,
          },
        };
      } catch (err) {
        return sendAiError(reply, err);
      }
    }
  );
};
