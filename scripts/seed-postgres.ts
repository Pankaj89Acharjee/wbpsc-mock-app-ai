#!/usr/bin/env tsx
/**
 * WBPSC AI Mock Test — Bulk PostgreSQL Seed Script
 * =================================================
 * Usage:
 *   npx tsx scripts/seed-postgres.ts                         # seeds all files in scripts/data/
 *   npx tsx scripts/seed-postgres.ts --file=history.json     # seeds a single file
 *   npx tsx scripts/seed-postgres.ts --dry-run               # validate JSON without inserting
 *
 * The script:
 *   1. Reads structured JSON files from scripts/data/
 *   2. Resolves exam / subject / chapter / subtopic FK IDs via slug lookups
 *   3. Inserts questions in batches of 500 inside a single transaction
 *   4. Uses onConflictDoNothing() — safe to re-run at any time
 *
 * JSON question shape (see scripts/data/history.json for reference):
 *   examSlug, subjectSlug, chapterSlug, subtopicSlug,
 *   stem{en,bn}, options{A,B,C,D}{en,bn}, correctOption,
 *   explanation{en,bn}, difficulty, marksPositive, marksNegative,
 *   previousYearTag, isActive
 */

import "dotenv/config";
import { resolve, dirname } from "path";
import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import * as schema from "../apps/api-core/src/db/schema.js";
import { computeContentHash } from "../apps/api-core/src/lib/contentHash.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;
const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "data");

const args = process.argv.slice(2);
const singleFile = args.find((a) => a.startsWith("--file="))?.split("=")[1];
const isDryRun = args.includes("--dry-run");

// ─── DB Connection ────────────────────────────────────────────────────────────

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://wbpsc_admin:wbpsc_local_dev_2026@localhost:5432/wbpsc_prep";

const sql = postgres(connectionString, {
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});
const db = drizzle(sql, { schema });

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawQuestion {
  examSlug: string;
  subjectSlug: string;
  chapterSlug: string;
  subtopicSlug: string;
  stem: { en: string; bn: string };
  options: {
    A: { en: string; bn: string };
    B: { en: string; bn: string };
    C: { en: string; bn: string };
    D: { en: string; bn: string };
  };
  correctOption: "A" | "B" | "C" | "D";
  explanation: { en: string; bn: string };
  difficulty: "easy" | "moderate" | "hard";
  marksPositive: number;
  marksNegative: number;
  previousYearTag?: string;
  isActive: boolean;
}

// ─── FK Lookup Cache (avoid N+1 queries per question) ─────────────────────────

const examCache = new Map<string, string>();
const subjectCache = new Map<string, string>();
const chapterCache = new Map<string, string>();
const subtopicCache = new Map<string, string>();

async function resolveExamId(examSlug: string): Promise<string | null> {
  if (examCache.has(examSlug)) return examCache.get(examSlug)!;
  const [exam] = await db
    .select({ id: schema.exams.id })
    .from(schema.exams)
    .where(eq(schema.exams.slug, examSlug as schema.ExamSlugType));
  if (!exam) return null;
  examCache.set(examSlug, exam.id);
  return exam.id;
}

async function resolveSubjectId(
  examId: string,
  subjectSlug: string
): Promise<string | null> {
  const key = `${examId}:${subjectSlug}`;
  if (subjectCache.has(key)) return subjectCache.get(key)!;
  const [subject] = await db
    .select({ id: schema.subjects.id })
    .from(schema.subjects)
    .where(
      and(
        eq(schema.subjects.examId, examId),
        eq(schema.subjects.slug, subjectSlug)
      )
    );
  if (!subject) return null;
  subjectCache.set(key, subject.id);
  return subject.id;
}

async function resolveChapterId(
  subjectId: string,
  chapterSlug: string
): Promise<string | null> {
  const key = `${subjectId}:${chapterSlug}`;
  if (chapterCache.has(key)) return chapterCache.get(key)!;
  const [chapter] = await db
    .select({ id: schema.chapters.id })
    .from(schema.chapters)
    .where(
      and(
        eq(schema.chapters.subjectId, subjectId),
        eq(schema.chapters.slug, chapterSlug)
      )
    );
  if (!chapter) return null;
  chapterCache.set(key, chapter.id);
  return chapter.id;
}

async function resolveSubtopicId(
  chapterId: string,
  subtopicSlug: string
): Promise<string | null> {
  const key = `${chapterId}:${subtopicSlug}`;
  if (subtopicCache.has(key)) return subtopicCache.get(key)!;
  const [subtopic] = await db
    .select({ id: schema.subtopics.id })
    .from(schema.subtopics)
    .where(
      and(
        eq(schema.subtopics.chapterId, chapterId),
        eq(schema.subtopics.slug, subtopicSlug)
      )
    );
  if (!subtopic) return null;
  subtopicCache.set(key, subtopic.id);
  return subtopic.id;
}

// ─── Seed a single file ───────────────────────────────────────────────────────

async function seedFile(filePath: string): Promise<void> {
  const fileName = filePath.split(/[\\/]/).pop()!;
  console.log(`\n📂 Processing: ${fileName}`);

  if (!existsSync(filePath)) {
    console.error(`  ❌ File not found: ${filePath}`);
    return;
  }

  let raw: RawQuestion[];
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.error(`  ❌ Invalid JSON in ${fileName}:`, e);
    return;
  }

  console.log(`  📋 Found ${raw.length} questions`);

  // Resolve all FKs and build insert rows
  const rows: (typeof schema.questions.$inferInsert)[] = [];
  let skipped = 0;

  for (const q of raw) {
    const examId = await resolveExamId(q.examSlug);
    if (!examId) {
      console.warn(
        `  ⚠️  Skipping — exam slug not found: "${q.examSlug}" | "${q.stem.en.substring(0, 50)}..."`
      );
      skipped++;
      continue;
    }

    const subjectId = await resolveSubjectId(examId, q.subjectSlug);
    if (!subjectId) {
      console.warn(
        `  ⚠️  Skipping — subject slug not found: "${q.subjectSlug}" | "${q.stem.en.substring(0, 50)}..."`
      );
      skipped++;
      continue;
    }

    const chapterId = await resolveChapterId(subjectId, q.chapterSlug);
    if (!chapterId) {
      console.warn(
        `  ⚠️  Skipping — chapter slug not found: "${q.chapterSlug}" | "${q.stem.en.substring(0, 50)}..."`
      );
      skipped++;
      continue;
    }

    const subtopicId = await resolveSubtopicId(chapterId, q.subtopicSlug);
    if (!subtopicId) {
      console.warn(
        `  ⚠️  Skipping — subtopic slug not found: "${q.subtopicSlug}" | "${q.stem.en.substring(0, 50)}..."`
      );
      skipped++;
      continue;
    }

    rows.push({
      examId,
      examSlug: q.examSlug as schema.ExamSlugType,
      subjectId,
      chapterId,
      subtopicId,
      stem: q.stem,
      options: q.options,
      correctOption: q.correctOption,
      explanation: q.explanation,
      difficulty: q.difficulty,
      marksPositive: String(q.marksPositive),
      marksNegative: String(q.marksNegative),
      previousYearTag: q.previousYearTag ?? null,
      source: q.previousYearTag ? "pyq" : "educator",
      // Sample data: PYQ tags/answers not yet checked against official WBPSC keys
      answerKeyVerified: false,
      contentHash: computeContentHash(q),
      isActive: q.isActive,
    });
  }

  console.log(
    `  ✅ Resolved: ${rows.length} rows | ⚠️  Skipped: ${skipped} rows`
  );

  if (isDryRun) {
    console.log(`  🔍 DRY RUN — no data written to database.`);
    return;
  }

  if (rows.length === 0) {
    console.log(`  ℹ️  Nothing to insert.`);
    return;
  }

  // Batch insert in transactions of BATCH_SIZE
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db
      .insert(schema.questions)
      .values(batch)
      .onConflictDoNothing();
    inserted += batch.length;
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
    console.log(
      `  📦 Batch ${batchNum}/${totalBatches} — inserted ${batch.length} rows (total: ${inserted})`
    );
  }

  console.log(`  ✅ Done — ${inserted} questions inserted from ${fileName}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🚀 WBPSC Bulk Question Seed Script");
  console.log("===================================");
  if (isDryRun) console.log("🔍 Running in DRY RUN mode\n");

  let filesToProcess: string[] = [];

  if (singleFile) {
    // Single file mode
    const fullPath = resolve(DATA_DIR, singleFile);
    filesToProcess = [fullPath];
  } else {
    // All JSON files in scripts/data/
    if (!existsSync(DATA_DIR)) {
      console.error(`❌ Data directory not found: ${DATA_DIR}`);
      process.exit(1);
    }
    filesToProcess = readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => resolve(DATA_DIR, f));

    if (filesToProcess.length === 0) {
      console.error(`❌ No JSON files found in ${DATA_DIR}`);
      process.exit(1);
    }

    console.log(`📁 Found ${filesToProcess.length} data file(s) to process:`);
    filesToProcess.forEach((f) =>
      console.log(`   • ${f.split(/[\\/]/).pop()}`)
    );
  }

  let totalInserted = 0;
  const startTime = Date.now();

  for (const filePath of filesToProcess) {
    await seedFile(filePath);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Seed complete in ${elapsed}s`);

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error("\n💥 Seed script failed:", err);
  sql.end({ timeout: 3 }).finally(() => process.exit(1));
});
