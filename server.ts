import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "12mb" }));

  // Healthcheck
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "wbpsc-fullstack-gateway",
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/ai/generate-notes
   * Called on L2 Firestore cache miss to generate bilingual/targeted WBPSC study notes
   */
  app.post("/api/ai/generate-notes", async (req, res) => {
    try {
      const {
        examSlug = "wbcs-prelims",
        subjectName = "Indian Polity",
        topicSlug = "73rd-74th-amendment",
        topicTitle = "73rd & 74th Constitutional Amendment Acts",
        language = "bn",
      } = req.body || {};

      const ai = getGenAIClient();
      const langInstruction =
        language === "bn"
          ? "Write all headings, explanations, and mnemonics in clear academic Bengali (বাংলা) with accurate conjuncts (যুক্তাক্ষর), keeping key Constitutional Articles/Acts in English parentheses."
          : "Write all headings, explanations, and mnemonics in crisp, exam-oriented English tailored for WBPSC exams.";

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: `Generate a high-yield WBPSC exam revision note for:
Exam: ${examSlug}
Subject: ${subjectName}
Topic: ${topicTitle} (${topicSlug})
Language: ${language.toUpperCase()}

Requirements:
1. ${langInstruction}
2. Include Core Concepts, Important Articles/Years/Facts, and Common WBPSC Prelims/Mains Exam Traps.
3. Provide 3 memorable mnemonics for quick recall.`,
        config: {
          systemInstruction:
            "You are a Principal WBPSC Faculty specializing in WBCS, Clerkship, Food SI, and Miscellaneous examinations.",
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              contentMarkdown: {
                type: Type.STRING,
                description:
                  "Structured Markdown revision note with bullet points and exam traps.",
              },
              mnemonicsText: {
                type: Type.STRING,
                description:
                  "3 short high-retention memory hooks separated by newlines.",
              },
            },
            required: ["contentMarkdown", "mnemonicsText"],
          },
        },
      });

      const rawText = response.text || "{}";
      const parsed = JSON.parse(rawText);

      res.json({
        status: "success",
        modelUsed: "gemini-3.8-flash",
        contentMarkdown:
          parsed.contentMarkdown ||
          `### ${topicTitle}\n\nKey revision points for ${examSlug}.`,
        mnemonicsText:
          parsed.mnemonicsText || "Mnemonic 1: Remember key articles and years.",
      });
    } catch (error: any) {
      console.error("Error in /api/ai/generate-notes:", error);
      res.status(500).json({
        error: error?.message || "Failed to generate AI study notes",
      });
    }
  });

  /**
   * POST /api/ai/evaluate-descriptive
   * Evaluates WBPSC Clerkship Part-II / WBCS Mains Descriptive Answers (Typed or Image base64)
   */
  app.post("/api/ai/evaluate-descriptive", async (req, res) => {
    try {
      const {
        examSlug = "wbpsc-clerkship-part2",
        taskType = "report_writing",
        language = "bn",
        questionPrompt = "",
        targetWordLimit = 150,
        studentAnswerText = "",
        imageBase64 = null,
        imageMimeType = "image/jpeg",
      } = req.body || {};

      if (!studentAnswerText && !imageBase64) {
        res.status(400).json({
          error: "Provide either typed answer text or an uploaded answer sheet image.",
        });
        return;
      }

      const ai = getGenAIClient();
      const parts: any[] = [];

      if (imageBase64) {
        parts.push({
          inlineData: {
            data: imageBase64,
            mimeType: imageMimeType,
          },
        });
      }

      const evalPrompt = `You are a Senior Head Examiner for WBPSC (${examSlug}).
Evaluate the student's descriptive answer strictly out of 25 marks (Grammar: /10, Content & Format: /10, Word Limit Adherence: /5).
Task Type: ${taskType}
Language: ${language === "bn" ? "Bengali (বাংলা)" : "English"}
Target Word Limit: ${targetWordLimit} words
Question Prompt: ${questionPrompt}

${
  studentAnswerText
    ? `Student's Typed Answer:\n${studentAnswerText}`
    : "Transcribe the attached handwritten answer sheet into transcribedAnswer, then evaluate it."
}`;

      parts.push({ text: evalPrompt });

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: { parts },
        config: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcribedAnswer: { type: Type.STRING },
              estimatedWordCount: { type: Type.INTEGER },
              grammarScore: { type: Type.NUMBER },
              contentScore: { type: Type.NUMBER },
              wordLimitScore: { type: Type.NUMBER },
              totalScore: { type: Type.NUMBER },
              strengths: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              improvementsNeeded: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              correctedModelAnswer: { type: Type.STRING },
            },
            required: [
              "transcribedAnswer",
              "estimatedWordCount",
              "grammarScore",
              "contentScore",
              "wordLimitScore",
              "totalScore",
              "strengths",
              "improvementsNeeded",
              "correctedModelAnswer",
            ],
          },
        },
      });

      const evaluation = JSON.parse(response.text || "{}");
      res.json({
        status: "success",
        modelUsed: "gemini-3.8-flash",
        evaluation,
      });
    } catch (error: any) {
      console.error("Error in /api/ai/evaluate-descriptive:", error);
      res.status(500).json({
        error: error?.message || "Failed to evaluate descriptive answer",
      });
    }
  });

  /**
   * POST /api/cron/generate-daily-ca
   * Synthesizes bilingual National & West Bengal Current Affairs + 5 MCQs
   */
  app.post("/api/cron/generate-daily-ca", async (req, res) => {
    try {
      const { editionDate = new Date().toISOString().slice(0, 10), headlines = [] } =
        req.body || {};

      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: `Synthesize a bilingual (English + Bengali / বাংলা) WBPSC Daily Current Affairs digest for ${editionDate}.
Input Headlines: ${
          headlines.length > 0
            ? headlines.join("; ")
            : "West Bengal Riverine Transport Modernization in Kolkata; RBI Monetary Policy & Inflation Target; Sundarbans Mangrove Biodiversity Conservation Initiative"
        }
Return a structured Markdown digest containing Bilingual Bullet Points, Static GK Links, and 3 PYQ-style Bilingual MCQs with answers.`,
        config: {
          temperature: 0.25,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              titleEn: { type: Type.STRING },
              titleBn: { type: Type.STRING },
              contentMarkdown: { type: Type.STRING },
              mnemonicsText: { type: Type.STRING },
            },
            required: ["titleEn", "titleBn", "contentMarkdown", "mnemonicsText"],
          },
        },
      });

      const digest = JSON.parse(response.text || "{}");
      res.json({
        status: "success",
        editionDate,
        digest,
      });
    } catch (error: any) {
      console.error("Error in /api/cron/generate-daily-ca:", error);
      res.status(500).json({
        error: error?.message || "Failed to generate Daily Current Affairs digest",
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`WBPSC Full-Stack Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
