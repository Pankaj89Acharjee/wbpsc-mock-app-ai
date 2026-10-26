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

  const categoryCatalog =
    params.existingCategories.length > 0
      ? params.existingCategories
          .slice(0, 120)
          .map((c) => `- ${c.subjectEn} > ${c.chapterEn} > ${c.subtopicEn}`)
          .join("\n")
      : "- General Studies > Indian History > Indian National Movement\n- General Studies > Indian Polity > Constitution\n- Arithmetic > Quantitative Aptitude > Ratio & Percentage\n- General English > Grammar & Vocabulary > Usage";

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: {
      parts: [
        {
          inlineData: {
            data: params.fileBase64,
            mimeType: params.mimeType,
          },
        },
        {
          text: `Extract all Multiple-Choice Questions (MCQs) from this uploaded question paper (PDF or Image) for the exam "${params.examTitleEn}" (${params.examSlug}).

For every MCQ found in the document:
1. Extract the question stem and options A, B, C, D.
2. Provide BOTH English ("en") and Bengali ("bn" বাংলা) versions for the stem, all 4 options, and a 2-sentence explanation. If the paper is only in English, translate it into formal WBPSC Bengali. If the paper is only in Bengali, translate it into clear English.
3. Determine the factually correct option ("A", "B", "C", or "D").
4. Categorize the question into the best matching Subject, Chapter, and Subtopic. Prefer matching one of the exam's existing categories below, or provide a clean standard WBPSC Subject > Chapter > Subtopic (in both English and Bengali) if it belongs to a new category:

Existing Exam Syllabus Categories:
${categoryCatalog}`,
        },
      ],
    },
    config: {
      temperature: 0.2,
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

  const parsed = JSON.parse(response.text || "{}") as {
    questions?: ExtractedPaperQuestion[];
  };
  return parsed.questions || [];
}
