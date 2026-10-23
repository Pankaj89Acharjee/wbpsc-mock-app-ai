import Fastify from "fastify";
import { examRoutes } from "./routes/exam";
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

// Register deterministic exam & grading routes
app.register(examRoutes);

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
