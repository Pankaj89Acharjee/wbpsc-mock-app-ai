import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type postgres from "postgres";

// ============================================================================
// Hand-written SQL migrations (apps/api-core/migrations/NNNN_name.sql).
// Replaces `drizzle-kit push --force`, which once truncated tables: every file
// is reviewed SQL, applied once, in order, inside its own transaction.
//
//   npm run db:migrate                 → apply pending files and exit
//   DB_MIGRATE_ON_START=true           → api-core applies them before listening
// ============================================================================

const BASELINE = "0000_baseline.sql";
// Any constant works; it only serialises concurrent runners (e.g. two replicas)
const ADVISORY_LOCK_KEY = 4_172_026;

/** migrations/ sits next to src/ in the repo and next to dist/ in the image. */
function migrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    fileURLToPath(new URL("../../migrations/", import.meta.url)),
    fileURLToPath(new URL("../migrations/", import.meta.url)),
  ].filter((d): d is string => !!d);
  const dir = candidates.find((d) => existsSync(d));
  if (!dir) throw new Error(`Migrations folder not found (tried ${candidates.join(", ")})`);
  return dir;
}

/** Migration files not yet recorded in schema_migrations (read-only check). */
export async function pendingMigrations(client: postgres.Sql): Promise<string[]> {
  const files = readdirSync(migrationsDir())
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  const [{ ledger, hasExams }] = await client<{ ledger: boolean; hasExams: boolean }[]>`
    SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ledger,
           to_regclass('public.exams') IS NOT NULL AS "hasExams"`;
  const done = new Set(
    ledger ? (await client<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name) : []
  );
  // A db:push-era database already has the baseline tables
  if (hasExams) done.add(BASELINE);
  return files.filter((f) => !done.has(f));
}

/** Applies pending migrations; returns the file names it ran. */
export async function runMigrations(
  client: postgres.Sql,
  log: (msg: string) => void = console.info
): Promise<string[]> {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  const conn = await client.reserve();
  try {
    await conn`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;
    await conn`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name varchar(200) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;
    const done = new Set(
      (await conn<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name)
    );

    // Databases created by `db:push` before migrations existed already have the
    // baseline schema — record it instead of re-creating existing tables.
    if (!done.has(BASELINE)) {
      const [{ exists }] = await conn<{ exists: boolean }[]>`
        SELECT to_regclass('public.exams') IS NOT NULL AS exists`;
      if (exists) {
        await conn`INSERT INTO schema_migrations (name) VALUES (${BASELINE})`;
        done.add(BASELINE);
        log(`Existing database detected — marked ${BASELINE} as applied`);
      }
    }

    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const body = readFileSync(`${dir}/${file}`, "utf8");
      await conn.unsafe("BEGIN");
      try {
        await conn.unsafe(body);
        await conn`INSERT INTO schema_migrations (name) VALUES (${file})`;
        await conn.unsafe("COMMIT");
      } catch (err) {
        await conn.unsafe("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`Applied migration ${file}`);
    }
    return applied;
  } finally {
    await conn`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`.catch(() => {});
    conn.release();
  }
}

// Matched by file name, not import.meta.url: once esbuild bundles this module
// into dist/server.js the two URLs would be equal for the server itself.
const isDirectEntry =
  /[\\/]migrate\.[cm]?[jt]s$/.test(process.argv[1] ?? "") &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectEntry) {
  const { queryClient, closeDbConnection } = await import("./index");
  try {
    const applied = await runMigrations(queryClient);
    console.info(applied.length ? `${applied.length} migration(s) applied` : "Database is up to date");
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await closeDbConnection();
  }
}
