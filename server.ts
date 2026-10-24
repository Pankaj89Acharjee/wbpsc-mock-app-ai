import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { buildApiCoreApp } from "./apps/api-core/src/server";

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

const DIRECT_API_PREFIXES = ["/auth/", "/auth", "/exams/", "/exams", "/me/", "/admin/", "/ai/"];

function isDirectApiCorePath(urlPath: string): boolean {
  return DIRECT_API_PREFIXES.some(
    (prefix) => urlPath === prefix || urlPath.startsWith(prefix)
  );
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Boot the PostgreSQL-backed Fastify api-core instance (auto-falls back to PGlite in AI Studio)
  const apiCore = await buildApiCoreApp();

  app.use(express.json({ limit: "12mb" }));

  // 1. Healthcheck
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "wbpsc-fullstack-gateway",
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * 2. POST /api/cron/generate-daily-ca
   * Synthesizes bilingual National & West Bengal Current Affairs + 3 PYQ-style MCQs
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

  /**
   * 3. Forward /api/* (and direct /auth/*, /exams/*, /me/*, /admin/*, /ai/*)
   *    into the Fastify api-core instance.
   */
  app.use(async (req, res, next) => {
    const isApiPrefixed = req.originalUrl.startsWith("/api/");
    const isDirectApi = isDirectApiCorePath(req.path);

    if (!isApiPrefixed && !isDirectApi) {
      return next();
    }

    const targetUrl = isApiPrefixed
      ? req.originalUrl.slice(4) || "/"
      : req.originalUrl;

    try {
      const headers: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined && k.toLowerCase() !== "content-length") {
          headers[k] = v;
        }
      }

      const hasBody =
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        req.body !== undefined &&
        Object.keys(req.body).length > 0;

      const reply = await apiCore.inject({
        method: req.method as any,
        url: targetUrl,
        headers,
        payload: hasBody ? JSON.stringify(req.body) : undefined,
      });

      for (const [k, v] of Object.entries(reply.headers)) {
        if (v !== undefined) {
          res.setHeader(k, v as string | string[]);
        }
      }
      res.status(reply.statusCode).send(reply.rawPayload);
    } catch (err: any) {
      console.error("Gateway error forwarding to api-core:", err);
      res.status(500).json({ error: err?.message || "Internal server error" });
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
