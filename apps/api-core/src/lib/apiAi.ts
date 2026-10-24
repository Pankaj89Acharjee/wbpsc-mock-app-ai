import { createHash } from "node:crypto";
import { GoogleGenAI, Type } from "@google/genai";
import { sql } from "drizzle-orm";
import { db } from "../db/index";

// ============================================================================
// api-core → api-ai internal calls.
// If the standalone Python api-ai service (http://localhost:8081) is reachable,
// forwards requests with X-Internal-Token.
// If api-ai is not running (e.g. inside Google AI Studio preview), executes the
// Gemini calls in-process via @google/genai and stores/reads L2 cache in
// PostgreSQL `ai_notes_cache`.
// ============================================================================

const API_AI_URL = process.env.API_AI_URL || "http://localhost:8081";

export class ApiAiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function detailMessage(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message_en" in detail) {
    return String((detail as { message_en: unknown }).message_en);
  }
  if (detail && typeof detail === "object" && "error" in detail) {
    const d = detail as { error: unknown; limit?: number };
    return d.error === "DAILY_AI_QUOTA_EXCEEDED"
      ? `Daily AI limit reached (${d.limit ?? 15}/day). Cached notes stay free — try again tomorrow.`
      : String(d.error);
  }
  return `AI service error (HTTP ${status})`;
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ApiAiError("GEMINI_API_KEY environment variable is not configured.", 500);
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function handleInProcessFallback<T>(path: string, body: BodyInit): Promise<T> {
  const ai = getGenAIClient();

  // 1. POST /ai/generate-notes
  if (path === "/ai/generate-notes") {
    const payload = JSON.parse(String(body)) as {
      exam_slug: string;
      subject_name: string;
      topic_slug: string;
      topic_title: string;
      language: "en" | "bn";
    };
    const cacheKey = `${payload.exam_slug}:${payload.topic_slug}:${payload.language}`;
    const topicHash = createHash("sha256").update(cacheKey).digest("hex");

    // Check L2 PostgreSQL cache first
    const cachedRows = await db.execute<{
      exam_slug: string;
      topic_slug: string;
      language: "en" | "bn";
      content_markdown: string;
      mnemonics: string[];
      model_used: string;
    }>(
      sql`UPDATE ai_notes_cache
          SET hit_count = hit_count + 1, updated_at = now()
          WHERE topic_hash = ${topicHash}
          RETURNING exam_slug, topic_slug, language, content_markdown, mnemonics, model_used`
    );

    if (cachedRows.length > 0) {
      const row = cachedRows[0];
      return {
        cached: true,
        data: {
          exam_slug: row.exam_slug,
          topic_slug: row.topic_slug,
          language: row.language,
          content_markdown: row.content_markdown,
          mnemonics: Array.isArray(row.mnemonics) ? row.mnemonics : [],
          model_used: row.model_used,
        },
      } as unknown as T;
    }

    const langInstruction =
      payload.language === "bn"
        ? "Write all headings, explanations, and mnemonics in clear academic Bengali (বাংলা) with accurate conjuncts (যুক্তাক্ষর), keeping key Constitutional Articles/Acts in English parentheses."
        : "Write all headings, explanations, and mnemonics in crisp, exam-oriented English tailored for WBPSC exams.";

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: `Generate a high-yield WBPSC exam revision note for:
Exam: ${payload.exam_slug}
Subject: ${payload.subject_name}
Topic: ${payload.topic_title} (${payload.topic_slug})
Language: ${payload.language.toUpperCase()}

Requirements:
1. ${langInstruction}
2. Include Core Concepts, Important Articles/Years/Facts, Common WBPSC Exam Traps, and 5 PYQ-style practice MCQs with answers.
3. Provide 3 memorable mnemonics for quick recall.`,
      config: {
        systemInstruction:
          "You are a Principal WBPSC Faculty specializing in WBCS, Clerkship, Food SI, and Miscellaneous examinations.",
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            content_markdown: { type: Type.STRING },
            mnemonics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ["content_markdown", "mnemonics"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}") as {
      content_markdown?: string;
      mnemonics?: string[];
    };
    const contentMarkdown =
      parsed.content_markdown || `### ${payload.topic_title}\n\nKey revision points.`;
    const mnemonics = Array.isArray(parsed.mnemonics) ? parsed.mnemonics : [];

    await db.execute(
      sql`INSERT INTO ai_notes_cache (topic_hash, exam_slug, topic_slug, language, content_markdown, mnemonics, model_used, hit_count)
          VALUES (${topicHash}, ${payload.exam_slug}, ${payload.topic_slug}, ${payload.language}, ${contentMarkdown}, ${JSON.stringify(mnemonics)}::jsonb, 'gemini-3.8-flash', 1)
          ON CONFLICT (topic_hash) DO UPDATE SET
            content_markdown = EXCLUDED.content_markdown,
            mnemonics = EXCLUDED.mnemonics,
            updated_at = now()`
    );

    return {
      cached: false,
      data: {
        exam_slug: payload.exam_slug,
        topic_slug: payload.topic_slug,
        language: payload.language,
        content_markdown: contentMarkdown,
        mnemonics,
        model_used: "gemini-3.8-flash",
      },
    } as unknown as T;
  }

  // 2. POST /ai/evaluate-descriptive
  if (path === "/ai/evaluate-descriptive" && body instanceof FormData) {
    const examSlug = String(body.get("exam_slug") || "wbpsc-clerkship-part2");
    const taskType = String(body.get("task_type") || "report_writing");
    const language = String(body.get("language") || "bn");
    const questionPrompt = String(body.get("question_prompt") || "");
    const targetWordLimit = Number(body.get("target_word_limit") || 150);
    const studentAnswerText = body.get("student_answer_text")
      ? String(body.get("student_answer_text"))
      : "";
    const answerImage = body.get("answer_image") as Blob | null;

    const parts: any[] = [];
    if (answerImage && typeof answerImage.arrayBuffer === "function") {
      const buf = Buffer.from(await answerImage.arrayBuffer());
      parts.push({
        inlineData: {
          data: buf.toString("base64"),
          mimeType: answerImage.type || "image/jpeg",
        },
      });
    }

    parts.push({
      text: `You are a Senior Head Examiner for WBPSC (${examSlug}).
Evaluate the student's descriptive answer strictly out of 25 marks (Grammar: /10, Content & Format: /10, Word Limit Adherence: /5).
Task Type: ${taskType}
Language: ${language === "bn" ? "Bengali (বাংলা)" : "English"}
Target Word Limit: ${targetWordLimit} words
Question Prompt: ${questionPrompt}

${
  studentAnswerText
    ? `Student's Typed Answer:\n${studentAnswerText}`
    : "Transcribe the attached handwritten answer sheet into transcribed_student_answer, then evaluate it."
}`,
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: { parts },
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcribed_student_answer: { type: Type.STRING },
            estimated_word_count: { type: Type.INTEGER },
            target_word_limit: { type: Type.INTEGER },
            grammar_score: { type: Type.NUMBER },
            content_score: { type: Type.NUMBER },
            word_limit_score: { type: Type.NUMBER },
            total_score: { type: Type.NUMBER },
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            improvements_needed: { type: Type.ARRAY, items: { type: Type.STRING } },
            corrected_model_answer: { type: Type.STRING },
          },
          required: [
            "transcribed_student_answer",
            "estimated_word_count",
            "target_word_limit",
            "grammar_score",
            "content_score",
            "word_limit_score",
            "total_score",
            "strengths",
            "improvements_needed",
            "corrected_model_answer",
          ],
        },
      },
    });

    const evaluation = JSON.parse(response.text || "{}");
    return {
      model_used: "gemini-3.8-flash",
      evaluation,
    } as unknown as T;
  }

  // 3. POST /internal/questions/generate (Pipeline 3 AI PYQ-Clone Generator)
  if (path === "/internal/questions/generate") {
    const req = JSON.parse(String(body)) as {
      exam_slug: string;
      exam_title: string;
      subject_name: string;
      chapter_name: string;
      subtopic_slug: string;
      subtopic_name: string;
      count: number;
      difficulty: string;
      round: number;
      examples: Array<{
        stem_en: string;
        options_en: Record<string, string>;
        correct_option: string;
        source_tag: string | null;
      }>;
      avoid_stems: string[];
    };

    const bilingualSchema = {
      type: Type.OBJECT,
      properties: {
        en: { type: Type.STRING },
        bn: { type: Type.STRING },
      },
      required: ["en", "bn"],
    };

    const collected: any[] = [];
    let remaining = Math.min(50, Math.max(1, req.count));
    const extraAvoid: string[] = [];

    while (remaining > 0) {
      const chunkCount = Math.min(20, remaining);
      const allAvoid = [...req.avoid_stems, ...extraAvoid].slice(0, 80);

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: `Generate ${chunkCount} realistic WBPSC PYQ-grade bilingual (English "en" + Bengali "bn" বাংলা) MCQs for:
Exam: ${req.exam_title} (${req.exam_slug})
Subject: ${req.subject_name}
Chapter: ${req.chapter_name}
Subtopic: ${req.subtopic_name} (${req.subtopic_slug})
Difficulty: ${req.difficulty}

Few-shot verified PYQ examples:
${JSON.stringify(req.examples.slice(0, 3), null, 2)}

Do NOT repeat any of these existing question stems:
${allAvoid.join(" | ")}`,
        config: {
          temperature: 0.5,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stem: bilingualSchema,
                    options: {
                      type: Type.OBJECT,
                      properties: {
                        A: bilingualSchema,
                        B: bilingualSchema,
                        C: bilingualSchema,
                        D: bilingualSchema,
                      },
                      required: ["A", "B", "C", "D"],
                    },
                    correct_option: { type: Type.STRING, enum: ["A", "B", "C", "D"] },
                    explanation: bilingualSchema,
                    difficulty: { type: Type.STRING, enum: ["easy", "moderate", "hard"] },
                    confidence: { type: Type.NUMBER },
                  },
                  required: [
                    "stem",
                    "options",
                    "correct_option",
                    "explanation",
                    "difficulty",
                    "confidence",
                  ],
                },
              },
            },
            required: ["questions"],
          },
        },
      });

      const parsed = JSON.parse(response.text || "{}") as { questions?: any[] };
      const batchQuestions = Array.isArray(parsed.questions)
        ? parsed.questions.slice(0, chunkCount)
        : [];
      if (batchQuestions.length === 0) break;

      for (const q of batchQuestions) {
        collected.push(q);
        if (q?.stem?.en) extraAvoid.push(q.stem.en);
      }
      remaining = req.count - collected.length;
    }

    const cacheKey = `${req.exam_slug}:${req.subtopic_slug}:${req.difficulty}:${req.count}:r${req.round}`;
    return {
      questions: collected.slice(0, req.count),
      model_used: "gemini-3.8-flash",
      cache_tier: "gemini",
      cache_key: cacheKey,
    } as unknown as T;
  }

  throw new ApiAiError(`Unsupported AI endpoint: ${path}`, 404);
}

export async function callApiAi<T>(
  path: string,
  body: BodyInit,
  { json = true, timeoutMs = 180_000 }: { json?: boolean; timeoutMs?: number } = {}
): Promise<T> {
  const token =
    process.env.INTERNAL_SERVICE_TOKEN?.trim() ||
    "wbpsc-internal-service-shared-token-2026";

  let res: Response;
  try {
    res = await fetch(`${API_AI_URL}${path}`, {
      method: "POST",
      headers: {
        "X-Internal-Token": token,
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body,
      signal: AbortSignal.timeout(Math.min(timeoutMs, 3000)),
    });
  } catch {
    // Standalone Python api-ai container is not running (e.g. in Google AI Studio)
    // → execute seamlessly in-process with @google/genai and PostgreSQL L2 cache
    return handleInProcessFallback<T>(path, body);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiAiError(
      detailMessage((data as { detail?: unknown }).detail, res.status),
      res.status
    );
  }
  return data as T;
}
