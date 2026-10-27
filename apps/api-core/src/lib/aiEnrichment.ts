import { GoogleGenAI, Type } from "@google/genai";
import type {
  BilingualText,
  OptionKey,
  StagedQuestionDraft,
} from "../../../../packages/shared-types/src/index";

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured.");
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

const BILINGUAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    en: { type: Type.STRING },
    bn: { type: Type.STRING },
  },
  required: ["en", "bn"],
};

// ============================================================================
// 1. Auto-translate English Syllabus Node Name → Bengali
// ============================================================================

export async function ensureBilingualSyllabusNames(items: {
  subjectEn?: string;
  subjectBn?: string;
  chapterEn?: string;
  chapterBn?: string;
  subtopicEn?: string;
  subtopicBn?: string;
}): Promise<{
  subjectBn: string;
  chapterBn: string;
  subtopicBn: string;
}> {
  const needsSubject = items.subjectEn && !items.subjectBn?.trim();
  const needsChapter = items.chapterEn && !items.chapterBn?.trim();
  const needsSubtopic = items.subtopicEn && !items.subtopicBn?.trim();

  if (!needsSubject && !needsChapter && !needsSubtopic) {
    return {
      subjectBn: items.subjectBn?.trim() || "",
      chapterBn: items.chapterBn?.trim() || "",
      subtopicBn: items.subtopicBn?.trim() || "",
    };
  }

  try {
    const ai = getGenAIClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Translate the following WBPSC exam syllabus headings from English into standard formal academic Bengali (বাংলা) with accurate conjuncts (যুক্তাক্ষর):
Subject: ${items.subjectEn || ""}
Chapter: ${items.chapterEn || ""}
Subtopic: ${items.subtopicEn || ""}`,
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subjectBn: { type: Type.STRING },
            chapterBn: { type: Type.STRING },
            subtopicBn: { type: Type.STRING },
          },
          required: ["subjectBn", "chapterBn", "subtopicBn"],
        },
      },
    });
    const parsed = JSON.parse(response.text || "{}") as {
      subjectBn?: string;
      chapterBn?: string;
      subtopicBn?: string;
    };
    return {
      subjectBn: items.subjectBn?.trim() || parsed.subjectBn?.trim() || items.subjectEn || "",
      chapterBn: items.chapterBn?.trim() || parsed.chapterBn?.trim() || items.chapterEn || "",
      subtopicBn: items.subtopicBn?.trim() || parsed.subtopicBn?.trim() || items.subtopicEn || "",
    };
  } catch {
    return {
      subjectBn: items.subjectBn?.trim() || items.subjectEn || "",
      chapterBn: items.chapterBn?.trim() || items.chapterEn || "",
      subtopicBn: items.subtopicBn?.trim() || items.subtopicEn || "",
    };
  }
}

// ============================================================================
// 2. AI Bulk Syllabus Generator for an Exam
// ============================================================================

export interface GeneratedSyllabusSubject {
  subject_en: string;
  subject_bn: string;
  chapters: Array<{
    chapter_en: string;
    chapter_bn: string;
    subtopics: Array<{
      subtopic_en: string;
      subtopic_bn: string;
    }>;
  }>;
}

export async function generateExamSyllabusWithAi(params: {
  examSlug: string;
  examTitleEn: string;
  examDescriptionEn: string;
  focusSubjects: string[];
  customInstructions?: string;
  /** The exam's current syllabus, so only missing nodes come back */
  existing?: Array<{ subject: string; chapters: Array<{ chapter: string; subtopics: string[] }> }>;
}): Promise<GeneratedSyllabusSubject[]> {
  const ai = getGenAIClient();
  const subjectsList =
    params.focusSubjects.length > 0
      ? params.focusSubjects.join(", ")
      : "every subject in this exam's official syllabus (decide them from the exam itself)";

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Generate a comprehensive, production-grade bilingual (English + Bengali / বাংলা) syllabus hierarchy for the West Bengal Public Service Commission (WBPSC) exam:
Exam: ${params.examTitleEn} (${params.examSlug})
Description: ${params.examDescriptionEn}
Subjects to include: ${subjectsList}
${params.customInstructions ? `Additional Admin Instructions: ${params.customInstructions}` : ""}

Requirements:
1. Create a structured Subject → Chapter → Subtopic tree that covers this exam's COMPLETE official syllabus: every chapter of each subject, each with all of its exam-relevant subtopics. Only include subjects that are actually part of this exam.
2. Each concept appears ONCE. Never add a heading that means the same as another one under a different wording (e.g. "National Movement" and "Indian National Movement").
3. Provide both English (_en) and formal West Bengal academic Bengali (_bn) titles for every Subject, Chapter, and Subtopic.
${
  params.existing?.length
    ? `
The exam ALREADY has this syllabus (JSON):
${JSON.stringify(params.existing)}

4. Return ONLY what is missing. For an existing subject or chapter, reuse its English name EXACTLY and list only the new subtopics under it. Do not repeat, rename or re-word anything that already exists. If nothing is missing, return an empty "subjects" array.`
    : ""
}`,
    config: {
      systemInstruction:
        "You are the Chief Curriculum Architect for WBPSC (WBCS, Clerkship, Food SI, Miscellaneous, WBP) competitive examinations.",
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          subjects: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                subject_en: { type: Type.STRING },
                subject_bn: { type: Type.STRING },
                chapters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      chapter_en: { type: Type.STRING },
                      chapter_bn: { type: Type.STRING },
                      subtopics: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            subtopic_en: { type: Type.STRING },
                            subtopic_bn: { type: Type.STRING },
                          },
                          required: ["subtopic_en", "subtopic_bn"],
                        },
                      },
                    },
                    required: ["chapter_en", "chapter_bn", "subtopics"],
                  },
                },
              },
              required: ["subject_en", "subject_bn", "chapters"],
            },
          },
        },
        required: ["subjects"],
      },
    },
  });

  const parsed = JSON.parse(response.text || "{}") as {
    subjects?: GeneratedSyllabusSubject[];
  };
  return parsed.subjects || [];
}

// ============================================================================
// 3. Auto-Translate & Enrich Question Draft (English → Bengali + Explanation)
// ============================================================================

export async function translateAndEnrichQuestionDraft(
  draft: StagedQuestionDraft
): Promise<StagedQuestionDraft> {
  const ai = getGenAIClient();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are a bilingual WBPSC exam editor (English & Bengali / বাংলা).
Given the following MCQ draft, translate any missing or incomplete Bengali ("bn") fields from the English ("en") text using formal WBPSC question paper Bengali with accurate conjuncts (যুক্তাক্ষর).
Also, if the English or Bengali explanation is blank, write a clear, accurate 2–3 sentence explanation for why option ${draft.correctOption} is the correct answer.
Preserve any existing non-empty English or Bengali text unless it is blank.

Input Draft:
Stem (EN): ${draft.stem.en}
Stem (BN): ${draft.stem.bn}
Option A (EN): ${draft.options.A.en} | (BN): ${draft.options.A.bn}
Option B (EN): ${draft.options.B.en} | (BN): ${draft.options.B.bn}
Option C (EN): ${draft.options.C.en} | (BN): ${draft.options.C.bn}
Option D (EN): ${draft.options.D.en} | (BN): ${draft.options.D.bn}
Correct Option: ${draft.correctOption}
Explanation (EN): ${draft.explanation.en}
Explanation (BN): ${draft.explanation.bn}`,
    config: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          stem: BILINGUAL_SCHEMA,
          options: {
            type: Type.OBJECT,
            properties: {
              A: BILINGUAL_SCHEMA,
              B: BILINGUAL_SCHEMA,
              C: BILINGUAL_SCHEMA,
              D: BILINGUAL_SCHEMA,
            },
            required: ["A", "B", "C", "D"],
          },
          explanation: BILINGUAL_SCHEMA,
        },
        required: ["stem", "options", "explanation"],
      },
    },
  });

  const enriched = JSON.parse(response.text || "{}") as {
    stem?: BilingualText;
    options?: Record<OptionKey, BilingualText>;
    explanation?: BilingualText;
  };

  const pickText = (orig: BilingualText, gen?: BilingualText): BilingualText => ({
    en: orig.en.trim() || gen?.en?.trim() || "",
    bn: orig.bn.trim() || gen?.bn?.trim() || orig.en.trim(),
  });

  return {
    ...draft,
    stem: pickText(draft.stem, enriched.stem),
    options: {
      A: pickText(draft.options.A, enriched.options?.A),
      B: pickText(draft.options.B, enriched.options?.B),
      C: pickText(draft.options.C, enriched.options?.C),
      D: pickText(draft.options.D, enriched.options?.D),
    },
    explanation: pickText(draft.explanation, enriched.explanation),
  };
}

// ============================================================================
// 4. Extract & Categorize Questions from Uploaded Question Paper (PDF / Image)
// ============================================================================

export interface ExtractedPaperQuestion {
  subject_en: string;
  subject_bn: string;
  chapter_en: string;
  chapter_bn: string;
  subtopic_en: string;
  subtopic_bn: string;
  stem: BilingualText;
  options: Record<OptionKey, BilingualText>;
  correct_option: OptionKey;
  explanation: BilingualText;
  difficulty: "easy" | "moderate" | "hard";
  confidence: number;
}

function clampConfidence(val: unknown): number {
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n) || n <= 0) return 0.9;
  const normalized = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0.01, Math.round(normalized * 100) / 100));
}

function normalizeMediaMimeType(mimeType: string, cleanBase64: string): string {
  const lower = (mimeType || "").trim().toLowerCase();
  if (
    lower === "application/pdf" ||
    lower === "image/png" ||
    lower === "image/jpeg" ||
    lower === "image/webp"
  ) {
    return lower;
  }
  if (lower === "image/jpg") return "image/jpeg";
  if (cleanBase64.startsWith("JVBERi0")) return "application/pdf";
  if (cleanBase64.startsWith("iVBORw")) return "image/png";
  if (cleanBase64.startsWith("/9j/")) return "image/jpeg";
  if (cleanBase64.startsWith("UklGR")) return "image/webp";
  return "application/pdf";
}

function parseOrSalvageExtractedQuestions(rawText: string): Partial<ExtractedPaperQuestion>[] {
  const trimmed = (rawText || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as { questions?: Partial<ExtractedPaperQuestion>[] } | Partial<ExtractedPaperQuestion>[];
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  } catch {
    // If Gemini hit output token limits on a very large 100-question PDF, salvage all complete question objects
    const salvaged: Partial<ExtractedPaperQuestion>[] = [];
    const arrStart = trimmed.indexOf("[");
    if (arrStart === -1) return [];
    let depth = 0;
    let objStart = -1;
    let inString = false;
    let escaped = false;
    for (let i = arrStart + 1; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") {
        if (depth === 0) objStart = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && objStart !== -1) {
          const slice = trimmed.slice(objStart, i + 1);
          try {
            const obj = JSON.parse(slice) as Partial<ExtractedPaperQuestion>;
            if (obj && obj.stem) salvaged.push(obj);
          } catch {
            // ignore incomplete object
          }
          objStart = -1;
        }
      }
    }
    return salvaged;
  }
  return [];
}

function sanitizeExtractedQuestion(
  q: Partial<ExtractedPaperQuestion>,
  idx: number
): ExtractedPaperQuestion | null {
  const stemEn = String(q.stem?.en || q.stem?.bn || "").trim();
  const stemBn = String(q.stem?.bn || q.stem?.en || "").trim();
  if (!stemEn) return null;

  const ensureOpt = (opt: Partial<BilingualText> | undefined, fallbackLabel: string): BilingualText => {
    const en = String(opt?.en || opt?.bn || fallbackLabel).trim();
    const bn = String(opt?.bn || opt?.en || en).trim();
    return { en, bn };
  };

  const options: Record<OptionKey, BilingualText> = {
    A: ensureOpt(q.options?.A, `Option A (#${idx + 1})`),
    B: ensureOpt(q.options?.B, `Option B (#${idx + 1})`),
    C: ensureOpt(q.options?.C, `Option C (#${idx + 1})`),
    D: ensureOpt(q.options?.D, `Option D (#${idx + 1})`),
  };

  const rawCorrect = String(q.correct_option || "A").trim().toUpperCase();
  const correct_option: OptionKey =
    rawCorrect === "A" || rawCorrect === "B" || rawCorrect === "C" || rawCorrect === "D"
      ? rawCorrect
      : "A";

  const rawDiff = String(q.difficulty || "moderate").trim().toLowerCase();
  const difficulty: "easy" | "moderate" | "hard" =
    rawDiff === "easy" || rawDiff === "moderate" || rawDiff === "hard" ? rawDiff : "moderate";

  const expEn = String(
    q.explanation?.en || q.explanation?.bn || `Correct answer is Option ${correct_option}.`
  ).trim();
  const expBn = String(q.explanation?.bn || q.explanation?.en || expEn).trim();

  const subjectEn = String(q.subject_en || "General Studies").trim();
  const subjectBn = String(q.subject_bn || subjectEn).trim();
  const chapterEn = String(q.chapter_en || "Core Topics").trim();
  const chapterBn = String(q.chapter_bn || chapterEn).trim();
  const subtopicEn = String(q.subtopic_en || "General Questions").trim();
  const subtopicBn = String(q.subtopic_bn || subtopicEn).trim();

  return {
    subject_en: subjectEn,
    subject_bn: subjectBn,
    chapter_en: chapterEn,
    chapter_bn: chapterBn,
    subtopic_en: subtopicEn,
    subtopic_bn: subtopicBn,
    stem: { en: stemEn, bn: stemBn },
    options,
    correct_option,
    explanation: { en: expEn, bn: expBn },
    difficulty,
    confidence: clampConfidence(q.confidence),
  };
}

export async function extractQuestionsFromMediaWithAi(params: {
  examSlug: string;
  examTitleEn: string;
  fileBase64: string;
  mimeType: string;
  existingCategories: Array<{
    subjectEn: string;
    chapterEn: string;
    subtopicEn: string;
  }>;
}): Promise<ExtractedPaperQuestion[]> {
  const ai = getGenAIClient();

  const cleanBase64 = (params.fileBase64 || "")
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s+/g, "");
  if (!cleanBase64) {
    throw new Error("Uploaded PDF/Image file data is empty.");
  }
  const normalizedMime = normalizeMediaMimeType(params.mimeType, cleanBase64);

  const categoryCatalog =
    params.existingCategories.length > 0
      ? params.existingCategories
          .slice(0, 100)
          .map((c) => `- ${c.subjectEn} > ${c.chapterEn} > ${c.subtopicEn}`)
          .join("\n")
      : "- General Studies > Indian History > Indian National Movement\n- General Studies > Indian Polity > Constitution\n- Arithmetic > Quantitative Aptitude > Ratio & Percentage\n- General English > Grammar & Vocabulary > Usage";

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: {
      parts: [
        {
          inlineData: {
            data: cleanBase64,
            mimeType: normalizedMime,
          },
        },
        {
          text: `Extract all Multiple-Choice Questions (MCQs) from this uploaded question paper (PDF or Image) for the exam "${params.examTitleEn}" (${params.examSlug}).

For every MCQ found in the document:
1. Extract the question stem and options A, B, C, D.
2. Provide BOTH English ("en") and Bengali ("bn" বাংলা) versions for the stem, all 4 options, and a concise 1-sentence explanation. If the paper is only in English, translate it into formal WBPSC Bengali. If the paper is only in Bengali, translate it into clear English.
3. Determine the factually correct option ("A", "B", "C", or "D").
4. Set "confidence" as a decimal between 0.0 and 1.0 (e.g. 0.95).
5. Categorize the question into the best matching Subject, Chapter, and Subtopic. Prefer matching one of the exam's existing categories below, or provide a clean standard WBPSC Subject > Chapter > Subtopic (in both English and Bengali):

Existing Exam Syllabus Categories:
${categoryCatalog}`,
        },
      ],
    },
    config: {
      temperature: 0.2,
      maxOutputTokens: 65536,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                subject_en: { type: Type.STRING },
                subject_bn: { type: Type.STRING },
                chapter_en: { type: Type.STRING },
                chapter_bn: { type: Type.STRING },
                subtopic_en: { type: Type.STRING },
                subtopic_bn: { type: Type.STRING },
                stem: BILINGUAL_SCHEMA,
                options: {
                  type: Type.OBJECT,
                  properties: {
                    A: BILINGUAL_SCHEMA,
                    B: BILINGUAL_SCHEMA,
                    C: BILINGUAL_SCHEMA,
                    D: BILINGUAL_SCHEMA,
                  },
                  required: ["A", "B", "C", "D"],
                },
                correct_option: { type: Type.STRING, enum: ["A", "B", "C", "D"] },
                explanation: BILINGUAL_SCHEMA,
                difficulty: { type: Type.STRING, enum: ["easy", "moderate", "hard"] },
                confidence: { type: Type.NUMBER },
              },
              required: [
                "subject_en",
                "subject_bn",
                "chapter_en",
                "chapter_bn",
                "subtopic_en",
                "subtopic_bn",
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

  const rawItems = parseOrSalvageExtractedQuestions(response.text || "");
  return rawItems
    .map((item, idx) => sanitizeExtractedQuestion(item, idx))
    .filter((item): item is ExtractedPaperQuestion => item !== null);
}

// ============================================================================
// 5. Generate WBPSC Bilingual MCQs for a Subject (Full Question Set / Chunked)
// ============================================================================

export interface GeneratedSubjectQuestion {
  chapter_en: string;
  subtopic_en: string;
  stem: BilingualText;
  options: Record<OptionKey, BilingualText>;
  correct_option: OptionKey;
  explanation: BilingualText;
  difficulty: "easy" | "moderate" | "hard";
  confidence: number;
}

export async function generateSubjectQuestionsWithAi(params: {
  examSlug: string;
  examTitleEn: string;
  subjectEn: string;
  subjectBn: string;
  chaptersAndSubtopics: Array<{
    chapterEn: string;
    subtopicEn: string;
    subtopicSlug: string;
  }>;
  count: number;
  difficulty: "easy" | "moderate" | "hard" | "mixed";
  avoidStems?: string[];
}): Promise<GeneratedSubjectQuestion[]> {
  const ai = getGenAIClient();
  const CHUNK_SIZE = 20;
  const results: GeneratedSubjectQuestion[] = [];
  const avoid = [...(params.avoidStems ?? [])];

  const topicsList =
    params.chaptersAndSubtopics.length > 0
      ? params.chaptersAndSubtopics
          .map((t) => `- Chapter: "${t.chapterEn}" | Subtopic: "${t.subtopicEn}"`)
          .join("\n")
      : `- Chapter: "${params.subjectEn} — Core Concepts" | Subtopic: "${params.subjectEn} — Fundamentals"`;

  let remaining = params.count;
  let batchNum = 0;

  while (remaining > 0 && batchNum < 8) {
    const batchCount = Math.min(remaining, CHUNK_SIZE);
    batchNum++;

    const avoidBlock =
      avoid.length > 0
        ? `\nDo NOT repeat or closely paraphrase any of these already-used question stems:\n${avoid
            .slice(-60)
            .map((s) => `• ${s}`)
            .join("\n")}`
        : "";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Generate exactly ${batchCount} realistic, exam-grade Multiple-Choice Questions (MCQs) for the West Bengal Public Service Commission (WBPSC) exam:
Exam: ${params.examTitleEn} (${params.examSlug})
Subject: ${params.subjectEn} (${params.subjectBn})
Target Difficulty: ${
        params.difficulty === "mixed"
          ? "Mixed (30% easy, 50% moderate, 20% hard — matching actual WBPSC paper standard)"
          : params.difficulty
      }

Distribute the questions evenly and realistically across the following Chapters & Subtopics of ${params.subjectEn}:
${topicsList}

Strict Quality & Bilingual Rules:
1. Every question MUST have BOTH English ("en") and formal West Bengal academic Bengali ("bn" বাংলা with proper যুক্তাক্ষর) for the stem, all 4 options (A, B, C, D), and a clear 2-sentence explanation.
2. For General English grammar/vocabulary questions, keep the tested English words/sentences in English and provide helpful Bengali meaning/explanation where appropriate.
3. Ensure 100% factual and mathematical accuracy, with exactly one unambiguous correct option ("A", "B", "C", or "D").
4. Set "chapter_en" and "subtopic_en" to match one of the listed Chapters & Subtopics above.${avoidBlock}`,
      config: {
        systemInstruction:
          "You are the Senior Paper Setter for West Bengal Public Service Commission (WBPSC Clerkship, WBCS Prelims, Food SI, Miscellaneous) examinations.",
        temperature: 0.45,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  chapter_en: { type: Type.STRING },
                  subtopic_en: { type: Type.STRING },
                  stem: BILINGUAL_SCHEMA,
                  options: {
                    type: Type.OBJECT,
                    properties: {
                      A: BILINGUAL_SCHEMA,
                      B: BILINGUAL_SCHEMA,
                      C: BILINGUAL_SCHEMA,
                      D: BILINGUAL_SCHEMA,
                    },
                    required: ["A", "B", "C", "D"],
                  },
                  correct_option: { type: Type.STRING, enum: ["A", "B", "C", "D"] },
                  explanation: BILINGUAL_SCHEMA,
                  difficulty: { type: Type.STRING, enum: ["easy", "moderate", "hard"] },
                  confidence: { type: Type.NUMBER },
                },
                required: [
                  "chapter_en",
                  "subtopic_en",
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

    const parsed = JSON.parse(response.text || "{}") as {
      questions?: GeneratedSubjectQuestion[];
    };
    const batch = parsed.questions || [];
    if (batch.length === 0) break;

    for (const q of batch) {
      if (!q.stem?.en?.trim()) continue;
      results.push({
        ...q,
        confidence: clampConfidence(q.confidence),
      });
      avoid.push(q.stem.en.trim());
      if (results.length >= params.count) break;
    }
    remaining = params.count - results.length;
  }

  return results;
}

function theCHUNK_SIZE(n: number): number {
  return n;
}

