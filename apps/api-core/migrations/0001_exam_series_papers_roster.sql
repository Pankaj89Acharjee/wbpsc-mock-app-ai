-- ============================================================================
-- 0001 Exam Type → Series → Paper hierarchy, paper rosters, paper↔question
-- assignments, roster-aware AI staging and near-duplicate detection.
--
-- Purely additive: no existing column is dropped, renamed or rewritten, so the
-- old random "mock test per exam" keeps working. Every statement is idempotent
-- (IF NOT EXISTS / duplicate_object guards) so a partial run can be retried.
--
--   exams                → the EXAM TYPE (WBCS, WBPSC Clerkship, …) + its syllabus
--   exam_series          → a named group of papers under one exam type
--   exam_papers          → one sittable paper / test with its own marking rules
--   paper_roster_slots   → "N questions from Subject[/Chapter[/Subtopic]]" targets
--   paper_questions      → which bank question sits in which paper (many-to-many)
--   questions            → the central Question Bank (unchanged; approved only)
-- ============================================================================

-- ─── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE series_kind AS ENUM ('previous_year', 'mock_test', 'practice', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE publish_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Composite keys used by the FKs below ───────────────────────────────────
-- They let the database itself reject a roster slot / assignment whose subject
-- belongs to a different exam type than the paper.
CREATE UNIQUE INDEX IF NOT EXISTS subjects_id_exam_unique_idx ON subjects (id, exam_id);

-- ─── exam_series ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_series (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id uuid NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  slug varchar(120) NOT NULL,
  name jsonb NOT NULL,
  description jsonb NOT NULL DEFAULT '{"en": "", "bn": ""}'::jsonb,
  kind series_kind NOT NULL DEFAULT 'mock_test',
  status publish_status NOT NULL DEFAULT 'draft',
  display_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_series_exam_slug_unique_idx ON exam_series (exam_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS exam_series_id_exam_unique_idx ON exam_series (id, exam_id);

-- ─── exam_papers ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_papers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  series_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  slug varchar(120) NOT NULL,
  title jsonb NOT NULL,
  total_questions integer NOT NULL DEFAULT 100 CHECK (total_questions BETWEEN 1 AND 300),
  duration_minutes integer NOT NULL DEFAULT 90 CHECK (duration_minutes BETWEEN 1 AND 600),
  marks_per_correct numeric(5, 2) NOT NULL DEFAULT 1.00,
  negative_marks_per_wrong numeric(5, 2) NOT NULL DEFAULT 0.25,
  estimated_cutoff_marks numeric(6, 2) NOT NULL DEFAULT 0.00,
  pyq_year integer,
  status publish_status NOT NULL DEFAULT 'draft',
  display_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A paper's exam type is always its series' exam type
  CONSTRAINT exam_papers_series_exam_fk FOREIGN KEY (series_id, exam_id)
    REFERENCES exam_series (id, exam_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_papers_series_slug_unique_idx ON exam_papers (series_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS exam_papers_id_exam_unique_idx ON exam_papers (id, exam_id);
CREATE INDEX IF NOT EXISTS exam_papers_exam_status_idx ON exam_papers (exam_id, status);

-- ─── paper_roster_slots ─────────────────────────────────────────────────────
-- Level is implied by which ids are set: subject only / + chapter / + subtopic.
-- A child slot is a sub-limit inside its parent (never counted twice); the
-- paper's roster total is the sum of slots that have no ancestor slot.
CREATE TABLE IF NOT EXISTS paper_roster_slots (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  paper_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  chapter_id uuid REFERENCES chapters (id) ON DELETE RESTRICT,
  subtopic_id uuid REFERENCES subtopics (id) ON DELETE RESTRICT,
  target_count integer NOT NULL CHECK (target_count BETWEEN 0 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paper_roster_slots_paper_fk FOREIGN KEY (paper_id, exam_id)
    REFERENCES exam_papers (id, exam_id) ON DELETE CASCADE,
  CONSTRAINT paper_roster_slots_subject_fk FOREIGN KEY (subject_id, exam_id)
    REFERENCES subjects (id, exam_id) ON DELETE RESTRICT,
  CONSTRAINT paper_roster_slots_level_check CHECK (subtopic_id IS NULL OR chapter_id IS NOT NULL),
  CONSTRAINT paper_roster_slots_node_unique UNIQUE NULLS NOT DISTINCT (paper_id, subject_id, chapter_id, subtopic_id)
);
CREATE INDEX IF NOT EXISTS paper_roster_slots_paper_idx ON paper_roster_slots (paper_id);

-- ─── paper_questions (question ↔ paper, many-to-many) ───────────────────────
-- subject/chapter/subtopic = how the question is classified IN THIS PAPER's
-- exam type. Same exam → the question's own nodes; another exam → the admin
-- maps it onto this exam's syllabus. The question record itself is shared.
CREATE TABLE IF NOT EXISTS paper_questions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  paper_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL,
  chapter_id uuid NOT NULL REFERENCES chapters (id) ON DELETE RESTRICT,
  subtopic_id uuid NOT NULL REFERENCES subtopics (id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  assigned_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paper_questions_paper_fk FOREIGN KEY (paper_id, exam_id)
    REFERENCES exam_papers (id, exam_id) ON DELETE CASCADE,
  CONSTRAINT paper_questions_subject_fk FOREIGN KEY (subject_id, exam_id)
    REFERENCES subjects (id, exam_id) ON DELETE RESTRICT
);
-- The same question can never appear twice in one paper
CREATE UNIQUE INDEX IF NOT EXISTS paper_questions_paper_question_unique_idx ON paper_questions (paper_id, question_id);
CREATE INDEX IF NOT EXISTS paper_questions_question_idx ON paper_questions (question_id);
CREATE INDEX IF NOT EXISTS paper_questions_paper_subtopic_idx ON paper_questions (paper_id, subtopic_id);

-- ─── Attempts remember which paper was sat (null = legacy random mock) ──────
ALTER TABLE test_attempts
  ADD COLUMN IF NOT EXISTS paper_id uuid REFERENCES exam_papers (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS test_attempts_paper_idx ON test_attempts (paper_id);

-- ─── Staging: roster target + near-duplicate flag ───────────────────────────
ALTER TABLE question_ingestion_jobs
  ADD COLUMN IF NOT EXISTS target_paper_id uuid REFERENCES exam_papers (id) ON DELETE SET NULL;
ALTER TABLE question_ingestion_jobs
  ADD COLUMN IF NOT EXISTS near_duplicate_question_id uuid;
ALTER TABLE question_ingestion_jobs
  ADD COLUMN IF NOT EXISTS near_duplicate_score numeric(4, 3);
CREATE INDEX IF NOT EXISTS ingestion_jobs_target_paper_idx ON question_ingestion_jobs (target_paper_id, status);
CREATE INDEX IF NOT EXISTS ingestion_jobs_subtopic_status_idx ON question_ingestion_jobs (subtopic_id, status);

-- ─── Trigram indexes for near-duplicate stems (optional extension) ──────────
-- If pg_trgm cannot be installed on a host, api-core falls back to an
-- in-process trigram comparison (slower, same results).
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm unavailable (%); near-duplicate search will run in api-core', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS questions_stem_en_trgm_idx
               ON questions USING gin ((stem ->> ''en'') gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ingestion_jobs_stem_en_trgm_idx
               ON question_ingestion_jobs USING gin (((enriched_data -> ''stem'') ->> ''en'') gin_trgm_ops)';
  END IF;
END $$;
