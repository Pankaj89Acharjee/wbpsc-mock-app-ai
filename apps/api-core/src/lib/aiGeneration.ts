import { z } from "zod";
import { and, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index";
import { questions, questionIngestionJobs } from "../db/schema";
import {
  BilingualTextSchema,
  DifficultyLevelSchema,
  OptionKeySchema,
  QuestionOptionsSchema,
} from "../../../../packages/shared-types/src/index";
import type { ResolvedPath } from "./syllabus";
import { callApiAi } from "./apiAi";

// ============================================================================
// api-core → api-ai bridge for Pipeline 3 (AI PYQ-clone generator).
// api-core owns the database (examples, duplicates, staging); api-ai owns
// Gemini + the 3-tier generation cache.
// ============================================================================

const GeneratedQuestionSchema = z.object({
  stem: BilingualTextSchema,
  options: QuestionOptionsSchema,
  correct_option: OptionKeySchema,
  explanation: BilingualTextSchema,
  difficulty: DifficultyLevelSchema,
  confidence: z.number().min(0).max(1),
});

const GenerateResponseSchema = z.object({
  questions: z.array(GeneratedQuestionSchema),
  model_used: z.string(),
  cache_tier: z.enum(["redis", "postgres", "gemini"]),
  cache_key: z.string(),
});
export type ApiAiGenerateResponse = z.infer<typeof GenerateResponseSchema>;

export interface ApiAiGenerateRequest {
  exam_slug: string;
  exam_title: string;
  subject_name: string;
  chapter_name: string;
  subtopic_slug: string;
  subtopic_name: string;
  count: number;
  difficulty: "easy" | "moderate" | "hard" | "mixed";
  round: number;
  /**
   * 0 for the first call of a request; 1, 2… when api-core asks again because
   * duplicates were dropped (part of the cache key, so a retry is a fresh batch).
   */
  attempt: number;
  examples: Array<{
    stem_en: string;
    options_en: Record<string, string>;
    correct_option: string;
    source_tag: string | null;
  }>;
  avoid_stems: string[];
}

/**
 * Few-shot examples (real PYQs first), stems to avoid, and the generation
 * round (earlier AI batches for this subtopic → part of the cache key, so a
 * new request yields fresh questions while a retry is served from cache).
 */
export async function loadGenerationContext(
  path: ResolvedPath
): Promise<Pick<ApiAiGenerateRequest, "examples" | "avoid_stems" | "round">> {
  // Prompt hint only — duplicates are actually removed in routes/ingestion.ts
  const bestFirst = [
    desc(sql`${questions.source} = 'pyq'`),
    desc(questions.answerKeyVerified),
    sql`random()`,
  ];
  const pick = {
    stem: questions.stem,
    options: questions.options,
    correctOption: questions.correctOption,
    tag: questions.previousYearTag,
  };

  let examples = await db
    .select(pick)
    .from(questions)
    .where(and(eq(questions.subtopicId, path.subtopic.id), eq(questions.isActive, true)))
    .orderBy(...bestFirst)
    .limit(5);
  if (examples.length < 3) {
    // Thin subtopic — borrow style from the rest of the chapter
    examples = examples.concat(
      await db
        .select(pick)
        .from(questions)
        .where(and(eq(questions.chapterId, path.chapter.id), eq(questions.isActive, true)))
        .orderBy(...bestFirst)
        .limit(5 - examples.length)
    );
  }

  const [liveStems, stagedStems, [{ rounds }]] = await Promise.all([
    db
      .select({ stem: questions.stem })
      .from(questions)
      .where(eq(questions.subtopicId, path.subtopic.id))
      .limit(60),
    db
      .select({ stem: sql<string>`${questionIngestionJobs.enrichedData}->'stem'->>'en'` })
      .from(questionIngestionJobs)
      .where(
        and(
          eq(questionIngestionJobs.subtopicId, path.subtopic.id),
          // Rejected stems too, so the model doesn't offer them again
          inArray(questionIngestionJobs.status, ["pending_ai", "pending_review", "rejected"])
        )
      )
      .orderBy(desc(questionIngestionJobs.createdAt))
      .limit(40),
    db
      .select({ rounds: countDistinct(questionIngestionJobs.batchId) })
      .from(questionIngestionJobs)
      .where(
        and(
          eq(questionIngestionJobs.subtopicId, path.subtopic.id),
          eq(questionIngestionJobs.source, "ai_generated")
        )
      ),
  ]);

  const seen = new Set<string>();
  return {
    round: rounds,
    examples: examples
      .filter((e) => !seen.has(e.stem.en) && seen.add(e.stem.en))
      .map((e) => ({
        stem_en: e.stem.en,
        options_en: Object.fromEntries(
          OptionKeySchema.options.map((k) => [k, e.options[k].en])
        ),
        correct_option: e.correctOption,
        source_tag: e.tag,
      })),
    avoid_stems: [
      ...new Set([...liveStems.map((r) => r.stem.en), ...stagedStems.map((r) => r.stem)]),
    ]
      .filter(Boolean)
      .slice(0, 100),
  };
}

export async function generateWithApiAi(
  req: ApiAiGenerateRequest
): Promise<ApiAiGenerateResponse> {
  const body = await callApiAi<unknown>("/internal/questions/generate", JSON.stringify(req));
  const parsed = GenerateResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("AI service returned an unexpected response");
  }
  return parsed.data;
}
