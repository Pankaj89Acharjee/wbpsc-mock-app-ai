import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://wbpsc_admin:wbpsc_local_dev_2026@localhost:5432/wbpsc_prep";

/**
 * Lightweight connection pool capped for 8GB RAM local PC and stateless Cloud Run instances.
 */
export const queryClient = postgres(connectionString, {
  max: Number(process.env.DB_MAX_CONNECTIONS || 10),
  idle_timeout: Number(process.env.DB_IDLE_TIMEOUT_SECONDS || 20),
  connect_timeout: 10,
  prepare: false, // Required for Supabase PgBouncer Transaction mode (port 6543)
});

export const db = drizzle(queryClient, { schema });

export async function closeDbConnection(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
