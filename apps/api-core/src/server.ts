import Fastify from "fastify";
import { authRoutes, ensureAdminAccount } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { aiRoutes } from "./routes/ai";
import { adminRoutes } from "./routes/admin";
import { examRoutes } from "./routes/exam";
import { ingestionRoutes } from "./routes/ingestion";
import { syllabusRoutes } from "./routes/syllabus";
import { closeDbConnection } from "./db/index";

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
app.register(authRoutes, { prefix: "/auth" });

// Deterministic exam, grading & remedial routes (signed-in users)
app.register(examRoutes);

// Signed-in student's attempts, answer review and weakness radar
app.register(meRoutes, { prefix: "/me" });

// AI tutor notes & descriptive evaluation (proxied to the internal api-ai service)
app.register(aiRoutes, { prefix: "/ai" });

// User management & all attempts (admin only)
app.register(adminRoutes, { prefix: "/admin" });

// Bulk question import → staging → educator review (admin only)
app.register(ingestionRoutes, { prefix: "/admin/ingestion" });

// Exam configs + Subject → Chapter → Subtopic syllabus management (admin only)
app.register(syllabusRoutes, { prefix: "/admin/syllabus" });

// Graceful shutdown on SIGTERM (docker stop / systemd)
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}. Closing Fastify server and PostgreSQL pool...`);
  try {
    await app.close();
    await closeDbConnection();
    process.exit(0);
  } catch (err) {
    app.log.error(err, "Error during graceful shutdown");
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

const start = async () => {
  const port = Number(process.env.PORT || 8080);
  const host = "0.0.0.0";
  try {
    await ensureAdminAccount(app.log);
    await app.listen({ port, host });
    app.log.info(`wbpsc-api-core listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
