import "dotenv/config";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { authRoutes, ensureAdminAccount } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { aiRoutes } from "./routes/ai";
import { adminRoutes } from "./routes/admin";
import { examRoutes } from "./routes/exam";
import { ingestionRoutes } from "./routes/ingestion";
import { syllabusRoutes } from "./routes/syllabus";
import { seriesRoutes } from "./routes/series";
import { closeDbConnection, ensureDatabaseReady, queryClient } from "./db/index";
import { pendingMigrations, runMigrations } from "./db/migrate";

export async function buildApiCoreApp(): Promise<FastifyInstance> {
  await ensureDatabaseReady();
  if (process.env.DB_MIGRATE_ON_START === "true") {
    await runMigrations(queryClient);
  } else {
    // Fail fast instead of serving 500s from queries on columns that don't exist yet
    const pending = await pendingMigrations(queryClient);
    if (pending.length > 0) {
      throw new Error(
        `Database schema is behind the code — pending migration(s): ${pending.join(", ")}. ` +
          `Run "npm run db:migrate" (or start with DB_MIGRATE_ON_START=true).`
      );
    }
  }

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
    trustProxy: true,
  });

  // Healthcheck endpoint for container / reverse-proxy liveness probes
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "wbpsc-api-core",
      timestamp: new Date().toISOString(),
    };
  });

  // CORS for the web app (origins from CORS_ALLOWED_ORIGINS, comma-separated).
  // Credentials are allowed so the HttpOnly session cookie travels with requests.
  const allowedOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || "http://localhost:3000")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  );
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type,x-admin-key");
    }
    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  // Sign-up / sign-in (email + password, Google) and the signed-in user's profile
  await app.register(authRoutes, { prefix: "/auth" });

  // Deterministic exam, grading & remedial routes (signed-in users)
  await app.register(examRoutes);

  // Signed-in student's attempts, answer review and weakness radar
  await app.register(meRoutes, { prefix: "/me" });

  // AI tutor notes & descriptive evaluation (proxied to internal api-ai)
  await app.register(aiRoutes, { prefix: "/ai" });

  // User management & all attempts (admin only)
  await app.register(adminRoutes, { prefix: "/admin" });

  // Bulk question import → staging → educator review (admin only)
  await app.register(ingestionRoutes, { prefix: "/admin/ingestion" });

  // Exam configs + Subject → Chapter → Subtopic syllabus management (admin only)
  await app.register(syllabusRoutes, { prefix: "/admin/syllabus" });

  // Exam type → test series (blueprint, selected questions), bank search (admin only)
  await app.register(seriesRoutes, { prefix: "/admin/series" });

  await ensureAdminAccount(app.log);
  await app.ready();
  return app;
}

const isDirectEntry =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectEntry) {
  let activeApp: FastifyInstance | null = null;

  const shutdown = async (signal: string) => {
    console.info(`Received ${signal}. Closing Fastify server and PostgreSQL pool...`);
    try {
      if (activeApp) await activeApp.close();
      await closeDbConnection();
      process.exit(0);
    } catch (err) {
      console.error("Error during graceful shutdown", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  (async () => {
    const port = Number(process.env.API_CORE_PORT || process.env.PORT || 8080);
    const host = "0.0.0.0";
    try {
      activeApp = await buildApiCoreApp();
      await activeApp.listen({ port, host });
      activeApp.log.info(`wbpsc-api-core listening on http://${host}:${port}`);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}
