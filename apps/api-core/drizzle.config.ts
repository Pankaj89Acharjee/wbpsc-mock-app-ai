import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Tables owned by apps/api-ai (created at its startup) — never let push drop them
  tablesFilter: ["!ai_*", "!syllabus_chunks"],
  dbCredentials: {
    // Use the direct (non-PgBouncer) URL for DDL when on Supabase
    url:
      process.env.DIRECT_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://wbpsc_admin:wbpsc_local_dev_2026@localhost:5432/wbpsc_prep",
  },
});
