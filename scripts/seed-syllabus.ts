#!/usr/bin/env tsx
/**
 * WBPSC AI Mock Test — Syllabus (Exam → Subject → Chapter → Subtopic) Seed
 * ========================================================================
 * Usage:
 *   npx tsx scripts/seed-syllabus.ts            # upsert exams + syllabus tree
 *   npx tsx scripts/seed-syllabus.ts --dry-run  # validate only
 *
 * Sources:
 *   - Exam configs: INITIAL_EXAMS in src/data/seedData.ts (same values Firestore uses)
 *   - Syllabus tree: scripts/syllabus.json (bilingual names)
 *
 * Upserts on slug, so it is safe to re-run after editing names.
 * Run this BEFORE `npm run seed` — question rows resolve FKs by these slugs.
 */

import "dotenv/config";
import { resolve, dirname } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import * as schema from "../apps/api-core/src/db/schema.js";
import { INITIAL_EXAMS } from "../src/data/seedData.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const SYLLABUS_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "syllabus.json"
);
const isDryRun = process.argv.slice(2).includes("--dry-run");

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

interface Bilingual {
  en: string;
  bn: string;
}

interface SyllabusExam {
  examSlug: schema.ExamSlugType;
  subjects: Array<{
    slug: string;
    name: Bilingual;
    chapters: Array<{
      slug: string;
      name: Bilingual;
      subtopics: Array<{ slug: string; name: Bilingual }>;
    }>;
  }>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🚀 WBPSC Syllabus Seed Script");
  console.log("==============================");

  const syllabus: SyllabusExam[] = JSON.parse(readFileSync(SYLLABUS_FILE, "utf-8"));

  const counts = { exams: 0, subjects: 0, chapters: 0, subtopics: 0 };
  for (const ex of syllabus) {
    if (!INITIAL_EXAMS.some((e) => e.slug === ex.examSlug)) {
      throw new Error(`Exam "${ex.examSlug}" in syllabus.json has no config in INITIAL_EXAMS`);
    }
    counts.exams++;
    for (const s of ex.subjects) {
      counts.subjects++;
      for (const c of s.chapters) {
        counts.chapters++;
        counts.subtopics += c.subtopics.length;
      }
    }
  }
  console.log(
    `  📋 ${counts.exams} exams · ${counts.subjects} subjects · ${counts.chapters} chapters · ${counts.subtopics} subtopics`
  );

  if (isDryRun) {
    console.log("  🔍 DRY RUN — no data written to database.");
    await sql.end({ timeout: 5 });
    return;
  }

  // Single transaction: a half-seeded tree would make question FKs ambiguous
  await db.transaction(async (tx) => {
    for (const ex of syllabus) {
      const cfg = INITIAL_EXAMS.find((e) => e.slug === ex.examSlug)!;
      const examValues = {
        slug: cfg.slug,
        title: { en: cfg.titleEn, bn: cfg.titleBn },
        description: { en: cfg.descriptionEn, bn: cfg.descriptionBn },
        totalQuestions: cfg.totalQuestions,
        durationMinutes: cfg.durationMinutes,
        marksPerCorrect: String(cfg.marksPerCorrect),
        negativeMarksPerWrong: String(cfg.negativeMarksPerWrong),
        estimatedCutoffMarks: String(cfg.estimatedCutoffMarks),
        isActive: cfg.isActive,
      };
      const [exam] = await tx
        .insert(schema.exams)
        .values(examValues)
        .onConflictDoUpdate({ target: schema.exams.slug, set: examValues })
        .returning({ id: schema.exams.id });
      console.log(`\n📘 ${cfg.slug}`);

      for (const [si, s] of ex.subjects.entries()) {
        const [subject] = await tx
          .insert(schema.subjects)
          .values({ examId: exam.id, slug: s.slug, name: s.name, displayOrder: si + 1 })
          .onConflictDoUpdate({
            target: [schema.subjects.examId, schema.subjects.slug],
            set: { name: s.name, displayOrder: si + 1 },
          })
          .returning({ id: schema.subjects.id });
        console.log(`  📗 ${s.slug} (${s.chapters.length} chapters)`);

        for (const [ci, c] of s.chapters.entries()) {
          const [chapter] = await tx
            .insert(schema.chapters)
            .values({ subjectId: subject.id, slug: c.slug, name: c.name, displayOrder: ci + 1 })
            .onConflictDoUpdate({
              target: [schema.chapters.subjectId, schema.chapters.slug],
              set: { name: c.name, displayOrder: ci + 1 },
            })
            .returning({ id: schema.chapters.id });

          if (c.subtopics.length === 0) continue;
          await tx
            .insert(schema.subtopics)
            .values(
              c.subtopics.map((t) => ({
                chapterId: chapter.id,
                subjectId: subject.id,
                slug: t.slug,
                name: t.name,
              }))
            )
            .onConflictDoUpdate({
              target: [schema.subtopics.chapterId, schema.subtopics.slug],
              set: { name: dsql`excluded.name` },
            });
        }
      }
    }
  });

  console.log("\n✅ Syllabus seed complete");
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error("\n💥 Syllabus seed failed:", err);
  sql.end({ timeout: 3 }).finally(() => process.exit(1));
});
