import Fastify from "fastify";
import { examRoutes } from "./routes/exam";
import { ingestionRoutes } from "./routes/ingestion";
import { closeDbConnection } from "./db/index";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
  trustProxy: true,
});

// Healthcheck endpoint for Google Cloud Run startup/liveness probes
app.get("/health", async () => {
  return {
    status: "ok",
    service: "wbpsc-api-core",
    timestamp: new Date().toISOString(),
  };
});

// CORS for the web admin console (origins from CORS_ALLOWED_ORIGINS, comma-separated)
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
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type,x-admin-key");
  }
  if (request.method === "OPTIONS") {
    return reply.status(204).send();
  }
});

// Register deterministic exam & grading routes
app.register(examRoutes);

// Bulk question import → staging → educator review (admin only)
app.register(ingestionRoutes, { prefix: "/admin/ingestion" });

// Graceful shutdown for Google Cloud Run SIGTERM
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
    await app.listen({ port, host });
    app.log.info(`wbpsc-api-core listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
