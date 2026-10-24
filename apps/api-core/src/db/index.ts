import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "./schema";
import { computeContentHash } from "../lib/contentHash";
import { INITIAL_EXAMS } from "../../../../src/data/seedData";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MONOREPO_ROOT = path.resolve(__dirname, "../../../..");

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://wbpsc_admin:wbpsc_local_dev_2026@localhost:5432/wbpsc_prep";

/**
 * Lightweight connection pool capped for 8GB RAM local PC and stateless Cloud Run instances.
 */
export const queryClient = postgres(connectionString, {
  max: Number(process.env.DB_MAX_CONNECTIONS || 10),
  idle_timeout: Number(process.env.DB_IDLE_TIMEOUT_SECONDS || 20),
  connect_timeout: 2,
  prepare: false, // Required for Supabase PgBouncer Transaction mode (port 6543)
});

let activeDb: PostgresJsDatabase<typeof schema> = drizzlePostgres(queryClient, { schema });
let pgliteInstance: PGlite | null = null;
let dbInitPromise: Promise<void> | null = null;

/**
 * Proxy `db` delegates all Drizzle ORM calls (`select`, `insert`, `update`,
 * `delete`, `transaction`, `execute`) to either the external PostgreSQL pool
 * or the embedded PostgreSQL 16 (PGlite) instance in Google AI Studio.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const val = Reflect.get(activeDb as object, prop, receiver);
    return typeof val === "function" ? val.bind(activeDb) : val;
  },
});

const BOOTSTRAP_DDL = `
CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid AS $$
  SELECT gen_random_uuid();
$$ LANGUAGE SQL;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('aspirant', 'educator', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_tier AS ENUM ('free', 'pro_prelims', 'wbcs_executive_pass');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE difficulty_level AS ENUM ('easy', 'moderate', 'hard');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE option_key AS ENUM ('A', 'B', 'C', 'D');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE attempt_status AS ENUM ('in_progress', 'submitted', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE question_attempt_state AS ENUM ('answered', 'marked_for_review', 'answered_and_marked', 'unanswered', 'not_visited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mastery_band AS ENUM ('critical_weakness', 'needs_revision', 'proficient', 'exam_ready');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ingestion_source AS ENUM ('csv_upload', 'json_upload', 'pdf_extract', 'ai_generated', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ingestion_status AS ENUM ('pending_ai', 'pending_review', 'approved', 'rejected', 'inserted', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE question_source AS ENUM ('pyq', 'educator', 'ai_generated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL UNIQUE,
  phone varchar(20) UNIQUE,
  password_hash text,
  google_sub varchar(64) UNIQUE,
  last_login_at timestamptz,
  full_name varchar(160) NOT NULL,
  preferred_language varchar(2) NOT NULL DEFAULT 'bn',
  target_exam_slug varchar(80) NOT NULL DEFAULT 'wbcs-prelims',
  role user_role NOT NULL DEFAULT 'aspirant',
  subscription_tier subscription_tier NOT NULL DEFAULT 'free',
  razorpay_customer_id varchar(128),
  subscription_expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(80) NOT NULL UNIQUE,
  title jsonb NOT NULL,
  description jsonb NOT NULL,
  total_questions integer NOT NULL DEFAULT 100,
  duration_minutes integer NOT NULL DEFAULT 90,
  marks_per_correct numeric(5,2) NOT NULL DEFAULT 1.00,
  negative_marks_per_wrong numeric(5,2) NOT NULL DEFAULT 0.25,
  estimated_cutoff_marks numeric(6,2) NOT NULL DEFAULT 65.00,
  target_time_per_question_sec integer NOT NULL DEFAULT 45,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  slug varchar(120) NOT NULL,
  name jsonb NOT NULL,
  weightage_questions integer NOT NULL DEFAULT 25,
  display_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(exam_id, slug)
);

CREATE TABLE IF NOT EXISTS chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  slug varchar(140) NOT NULL,
  name jsonb NOT NULL,
  display_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id, slug)
);

CREATE TABLE IF NOT EXISTS subtopics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  slug varchar(160) NOT NULL,
  name jsonb NOT NULL,
  expected_time_seconds integer NOT NULL DEFAULT 45,
  is_high_yield_wbpsc boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chapter_id, slug)
);

CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  exam_slug varchar(80) NOT NULL,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  subtopic_id uuid NOT NULL REFERENCES subtopics(id) ON DELETE RESTRICT,
  stem jsonb NOT NULL,
  options jsonb NOT NULL,
  correct_option option_key NOT NULL,
  explanation jsonb NOT NULL,
  difficulty difficulty_level NOT NULL DEFAULT 'moderate',
  marks_positive numeric(5,2) NOT NULL DEFAULT 1.00,
  marks_negative numeric(5,2) NOT NULL DEFAULT 0.25,
  previous_year_tag varchar(100),
  source question_source NOT NULL DEFAULT 'educator',
  pyq_exam_slug varchar(80),
  pyq_year integer,
  answer_key_verified boolean NOT NULL DEFAULT false,
  content_hash varchar(64) UNIQUE,
  ingestion_job_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  is_remedial boolean NOT NULL DEFAULT false,
  status attempt_status NOT NULL DEFAULT 'in_progress',
  preferred_language varchar(2) NOT NULL DEFAULT 'bn',
  total_questions integer NOT NULL,
  attempted_count integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  incorrect_count integer NOT NULL DEFAULT 0,
  unanswered_count integer NOT NULL DEFAULT 0,
  raw_positive_score numeric(7,2) NOT NULL DEFAULT 0.00,
  negative_penalty numeric(7,2) NOT NULL DEFAULT 0.00,
  final_net_score numeric(7,2) NOT NULL DEFAULT 0.00,
  max_possible_score numeric(7,2) NOT NULL DEFAULT 100.00,
  accuracy_percentage numeric(5,2) NOT NULL DEFAULT 0.00,
  total_time_spent_seconds integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

CREATE TABLE IF NOT EXISTS attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  subtopic_id uuid NOT NULL REFERENCES subtopics(id) ON DELETE RESTRICT,
  selected_option option_key,
  state question_attempt_state NOT NULL DEFAULT 'unanswered',
  is_correct boolean NOT NULL DEFAULT false,
  marks_awarded numeric(5,2) NOT NULL DEFAULT 0.00,
  time_spent_seconds integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS user_subtopic_mastery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  subtopic_id uuid NOT NULL REFERENCES subtopics(id) ON DELETE CASCADE,
  total_encountered integer NOT NULL DEFAULT 0,
  total_attempted integer NOT NULL DEFAULT 0,
  total_correct integer NOT NULL DEFAULT 0,
  total_incorrect integer NOT NULL DEFAULT 0,
  total_unanswered integer NOT NULL DEFAULT 0,
  cumulative_net_score numeric(8,2) NOT NULL DEFAULT 0.00,
  cumulative_time_seconds integer NOT NULL DEFAULT 0,
  accuracy_percentage numeric(5,2) NOT NULL DEFAULT 0.00,
  avg_time_per_question_seconds numeric(6,2) NOT NULL DEFAULT 0.00,
  mastery_band mastery_band NOT NULL DEFAULT 'critical_weakness',
  weakness_priority_score numeric(6,2) NOT NULL DEFAULT 100.00,
  last_tested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, subtopic_id)
);

CREATE TABLE IF NOT EXISTS question_ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  source ingestion_source NOT NULL,
  status ingestion_status NOT NULL DEFAULT 'pending_ai',
  batch_id varchar(80) NOT NULL,
  raw_data jsonb NOT NULL,
  enriched_data jsonb,
  exam_id uuid REFERENCES exams(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  chapter_id uuid REFERENCES chapters(id) ON DELETE SET NULL,
  subtopic_id uuid REFERENCES subtopics(id) ON DELETE SET NULL,
  pyq_year integer,
  pyq_exam_name varchar(160),
  ai_confidence_score numeric(4,2),
  content_hash varchar(64),
  review_notes text,
  inserted_question_id uuid,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_notes_cache (
  topic_hash varchar(64) PRIMARY KEY,
  exam_slug varchar(80) NOT NULL,
  topic_slug varchar(160) NOT NULL,
  language varchar(2) NOT NULL,
  content_markdown text NOT NULL,
  mnemonics jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_used varchar(80) NOT NULL DEFAULT 'gemini-3.8-flash',
  hit_count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

async function seedIfEmpty(): Promise<void> {
  const existingExams = await db.select({ id: schema.exams.id }).from(schema.exams).limit(1);
  if (existingExams.length > 0) return;

  console.log("🌱 Seeding initial WBPSC exams, syllabus tree, and bilingual PYQ bank into PostgreSQL...");

  // 1. Seed Exams
  for (const ex of INITIAL_EXAMS) {
    await db
      .insert(schema.exams)
      .values({
        slug: ex.slug,
        title: { en: ex.titleEn, bn: ex.titleBn },
        description: { en: ex.descriptionEn, bn: ex.descriptionBn },
        totalQuestions: ex.totalQuestions,
        durationMinutes: ex.durationMinutes,
        marksPerCorrect: String(ex.marksPerCorrect),
        negativeMarksPerWrong: String(ex.negativeMarksPerWrong),
        estimatedCutoffMarks: String(ex.estimatedCutoffMarks),
        isActive: ex.isActive,
      })
      .onConflictDoNothing();
  }

  // 2. Seed Syllabus Tree from scripts/syllabus.json
  const syllabusPath = path.join(MONOREPO_ROOT, "scripts", "syllabus.json");
  if (fs.existsSync(syllabusPath)) {
    const syllabusData = JSON.parse(fs.readFileSync(syllabusPath, "utf-8")) as Array<{
      examSlug: string;
      subjects: Array<{
        slug: string;
        name: { en: string; bn: string };
        chapters: Array<{
          slug: string;
          name: { en: string; bn: string };
          subtopics: Array<{ slug: string; name: { en: string; bn: string } }>;
        }>;
      }>;
    }>;

    for (const ex of syllabusData) {
      const [examRow] = await db
        .select({ id: schema.exams.id })
        .from(schema.exams)
        .where(eq(schema.exams.slug, ex.examSlug))
        .limit(1);
      if (!examRow) continue;

      for (const [sIdx, subj] of ex.subjects.entries()) {
        const [subjRow] = await db
          .insert(schema.subjects)
          .values({
            examId: examRow.id,
            slug: subj.slug,
            name: subj.name,
            displayOrder: sIdx + 1,
          })
          .onConflictDoUpdate({
            target: [schema.subjects.examId, schema.subjects.slug],
            set: { name: subj.name },
          })
          .returning({ id: schema.subjects.id });

        for (const [cIdx, chap] of subj.chapters.entries()) {
          const [chapRow] = await db
            .insert(schema.chapters)
            .values({
              subjectId: subjRow.id,
              slug: chap.slug,
              name: chap.name,
              displayOrder: cIdx + 1,
            })
            .onConflictDoUpdate({
              target: [schema.chapters.subjectId, schema.chapters.slug],
              set: { name: chap.name },
            })
            .returning({ id: schema.chapters.id });

          for (const st of chap.subtopics) {
            await db
              .insert(schema.subtopics)
              .values({
                chapterId: chapRow.id,
                subjectId: subjRow.id,
                slug: st.slug,
                name: st.name,
              })
              .onConflictDoNothing();
          }
        }
      }
    }
  }

  // 3. Seed Questions from scripts/data/*.json
  const dataDir = path.join(MONOREPO_ROOT, "scripts", "data");
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const rawQuestions = JSON.parse(
        fs.readFileSync(path.join(dataDir, file), "utf-8")
      ) as Array<{
        examSlug: string;
        subjectSlug: string;
        chapterSlug: string;
        subtopicSlug: string;
        stem: { en: string; bn: string };
        options: (typeof schema.questions.$inferSelect)["options"];
        correctOption: "A" | "B" | "C" | "D";
        explanation: { en: string; bn: string };
        difficulty?: "easy" | "moderate" | "hard";
        marksPositive?: number;
        marksNegative?: number;
        previousYearTag?: string;
        isActive?: boolean;
      }>;

      for (const q of rawQuestions) {
        const [examRow] = await db
          .select({ id: schema.exams.id })
          .from(schema.exams)
          .where(eq(schema.exams.slug, q.examSlug))
          .limit(1);
        if (!examRow) continue;

        const [subjRow] = await db
          .select({ id: schema.subjects.id })
          .from(schema.subjects)
          .where(
            and(
              eq(schema.subjects.examId, examRow.id),
              eq(schema.subjects.slug, q.subjectSlug)
            )
          )
          .limit(1);
        if (!subjRow) continue;

        const [chapRow] = await db
          .select({ id: schema.chapters.id })
          .from(schema.chapters)
          .where(
            and(
              eq(schema.chapters.subjectId, subjRow.id),
              eq(schema.chapters.slug, q.chapterSlug)
            )
          )
          .limit(1);
        if (!chapRow) continue;

        const [subtopicRow] = await db
          .select({ id: schema.subtopics.id })
          .from(schema.subtopics)
          .where(
            and(
              eq(schema.subtopics.chapterId, chapRow.id),
              eq(schema.subtopics.slug, q.subtopicSlug)
            )
          )
          .limit(1);
        if (!subtopicRow) continue;

        const contentHash = computeContentHash({
          stem: q.stem,
          options: q.options,
        });

        await db
          .insert(schema.questions)
          .values({
            examId: examRow.id,
            examSlug: q.examSlug,
            subjectId: subjRow.id,
            chapterId: chapRow.id,
            subtopicId: subtopicRow.id,
            stem: q.stem,
            options: q.options,
            correctOption: q.correctOption,
            explanation: q.explanation,
            difficulty: q.difficulty || "moderate",
            marksPositive: String(q.marksPositive ?? 1),
            marksNegative: String(q.marksNegative ?? 0.25),
            previousYearTag: q.previousYearTag || null,
            source: q.previousYearTag ? "pyq" : "educator",
            answerKeyVerified: true,
            contentHash,
            isActive: q.isActive ?? true,
          })
          .onConflictDoNothing();
      }
    }
  }

  console.log("✅ PostgreSQL initial seed complete.");
}

export async function ensureDatabaseReady(): Promise<void> {
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    try {
      await queryClient`SELECT 1`;
      await queryClient.unsafe(BOOTSTRAP_DDL);
      console.log("✅ Connected to external PostgreSQL database.");
    } catch {
      console.log(
        "ℹ️ External PostgreSQL (localhost:5432) not running — booting embedded PostgreSQL 16 (PGlite)..."
      );
      const dataDir = path.join(MONOREPO_ROOT, ".pglite-data");
      pgliteInstance = new PGlite(dataDir);
      await pgliteInstance.waitReady;
      await pgliteInstance.exec(BOOTSTRAP_DDL);

      const pgLiteDrizzle = drizzlePglite(pgliteInstance, { schema });
      const origExecute = pgLiteDrizzle.execute.bind(pgLiteDrizzle);
      // Normalize db.execute() return shape so it matches postgres-js (array of rows)
      (pgLiteDrizzle as unknown as { execute: (q: any) => Promise<any> }).execute = async (
        query: any
      ) => {
        const res = await origExecute(query);
        if (res && typeof res === "object" && "rows" in res && Array.isArray(res.rows)) {
          return Object.assign(res.rows, res);
        }
        return res;
      };

      activeDb = pgLiteDrizzle as unknown as PostgresJsDatabase<typeof schema>;
      console.log("✅ Embedded PostgreSQL 16 (PGlite) ready.");
    }

    await seedIfEmpty();
  })();

  return dbInitPromise;
}

export async function closeDbConnection(): Promise<void> {
  if (pgliteInstance) {
    await pgliteInstance.close();
  } else {
    await queryClient.end({ timeout: 5 }).catch(() => undefined);
  }
}
