import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://wbpsc_admin:wbpsc_local_dev_2026@localhost:5432/wbpsc_prep";

/**
 * Lightweight connection pool capped for the 8GB RAM local PC and the Oracle VM.
 * Tables come from `npm run db:push`; sample data from `npm run seed:syllabus && npm run seed`.
 */
export const queryClient = postgres(connectionString, {
  max: Number(process.env.DB_MAX_CONNECTIONS || 10),
  idle_timeout: Number(process.env.DB_IDLE_TIMEOUT_SECONDS || 20),
  connect_timeout: 10,
  prepare: false, // Required for PgBouncer-style transaction pooling
  // One readable line (e.g. a migration's RAISE NOTICE) instead of the whole notice object
  onnotice: (n) => console.info(`[postgres] ${n.message}`),
});

export const db = drizzle(queryClient, { schema });

// Drizzle's postgres-js driver replaces queryClient.options.serializers["114"] and ["3802"]
// with an identity function `(val) => val` because Drizzle pre-stringifies JSON params.
// Restoring a string-aware serializer ensures raw `queryClient` / `queryClient.json(...)`
// calls with Arrays or Objects serialize to JSON strings instead of throwing ERR_INVALID_ARG_TYPE,
// while keeping Drizzle's pre-stringified JSON strings untouched.
const safeJsonSerializer = (val: unknown) =>
  typeof val === "string" ? val : JSON.stringify(val);
queryClient.options.serializers["114"] = safeJsonSerializer;
queryClient.options.serializers["3802"] = safeJsonSerializer;

/**
 * Fails fast with a clear message when PostgreSQL is unreachable, instead of
 * starting with a broken (or different) database.
 */
export async function ensureDatabaseReady(): Promise<void> {
  try {
    await queryClient`SELECT 1`;
  } catch (err) {
    const target = connectionString.replace(/\/\/[^@]*@/, "//***@");
    throw new Error(
      `Cannot connect to PostgreSQL at ${target}. Start it with "docker compose up -d" ` +
        `(or check DATABASE_URL). Cause: ${(err as NodeJS.ErrnoException).code || (err as Error).message}`
    );
  }
}

export async function closeDbConnection(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
