-- ============================================================================
-- 0004 Papers go away: a SERIES is the test.
--
-- A series already defines the pattern (subjects + question counts, optional
-- topic breakdown) and the marking scheme, so it now also holds its selected
-- questions directly and is what students sit.
--
--   paper_questions                   → series_questions
--   question_ingestion_jobs.target_paper_id → target_series_id
--   test_attempts.paper_id            → series_id
--   exam_papers                       → dropped
--
-- Backfill: each series takes the questions of its one paper that has any.
-- If a series has questions in more than one paper, the migration stops (no
-- guessing which to keep) — leave questions in one paper per series, re-run.
-- A published series that isn't complete afterwards goes back to draft, so
-- students never see a test with missing questions. Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS series_questions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  series_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL,
  chapter_id uuid NOT NULL REFERENCES chapters (id) ON DELETE RESTRICT,
  subtopic_id uuid NOT NULL REFERENCES subtopics (id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  assigned_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT series_questions_series_fk FOREIGN KEY (series_id, exam_id)
    REFERENCES exam_series (id, exam_id) ON DELETE CASCADE,
  CONSTRAINT series_questions_subject_fk FOREIGN KEY (subject_id, exam_id)
    REFERENCES subjects (id, exam_id) ON DELETE RESTRICT
);
-- The same question can never appear twice in one series
CREATE UNIQUE INDEX IF NOT EXISTS series_questions_series_question_unique_idx ON series_questions (series_id, question_id);
CREATE INDEX IF NOT EXISTS series_questions_question_idx ON series_questions (question_id);
CREATE INDEX IF NOT EXISTS series_questions_series_subtopic_idx ON series_questions (series_id, subtopic_id);

ALTER TABLE test_attempts
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES exam_series (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS test_attempts_series_idx ON test_attempts (series_id);

ALTER TABLE question_ingestion_jobs
  ADD COLUMN IF NOT EXISTS target_series_id uuid REFERENCES exam_series (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ingestion_jobs_target_series_idx ON question_ingestion_jobs (target_series_id, status);

DO $$
DECLARE
  clash text;
  demoted text;
BEGIN
  IF to_regclass('public.exam_papers') IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(s.name ->> 'en', ', ') INTO clash
  FROM exam_series s
  WHERE (
    SELECT count(DISTINCT pq.paper_id)
    FROM paper_questions pq JOIN exam_papers p ON p.id = pq.paper_id
    WHERE p.series_id = s.id
  ) > 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Series with questions in more than one paper: %. Keep questions in one paper per series, then re-run the migration.', clash;
  END IF;

  INSERT INTO series_questions (series_id, exam_id, question_id, subject_id, chapter_id, subtopic_id, position, assigned_by, created_at)
  SELECT p.series_id, pq.exam_id, pq.question_id, pq.subject_id, pq.chapter_id, pq.subtopic_id, pq.position, pq.assigned_by, pq.created_at
  FROM paper_questions pq
  JOIN exam_papers p ON p.id = pq.paper_id
  ON CONFLICT DO NOTHING;

  UPDATE test_attempts a SET series_id = p.series_id
  FROM exam_papers p
  WHERE a.paper_id = p.id AND a.series_id IS NULL;

  UPDATE question_ingestion_jobs j SET target_series_id = p.series_id
  FROM exam_papers p
  WHERE j.target_paper_id = p.id AND j.target_series_id IS NULL;

  -- A published series must be a complete test
  WITH totals AS (
    SELECT s.id,
           coalesce((SELECT sum(r.target_count) FROM series_roster_slots r
                     WHERE r.series_id = s.id AND r.chapter_id IS NULL), 0) AS target,
           (SELECT count(*) FROM series_questions q WHERE q.series_id = s.id) AS selected
    FROM exam_series s
    WHERE s.status = 'published'
  ), changed AS (
    UPDATE exam_series s SET status = 'draft', updated_at = now()
    FROM totals t
    WHERE s.id = t.id AND (t.target = 0 OR t.selected <> t.target)
    RETURNING s.name ->> 'en' AS name
  )
  SELECT string_agg(name, ', ') INTO demoted FROM changed;
  IF demoted IS NOT NULL THEN
    RAISE NOTICE 'Moved back to draft (questions not complete yet): %', demoted;
  END IF;

  ALTER TABLE test_attempts DROP COLUMN IF EXISTS paper_id;
  ALTER TABLE question_ingestion_jobs DROP COLUMN IF EXISTS target_paper_id;
  DROP TABLE IF EXISTS paper_questions;
  DROP TABLE IF EXISTS exam_papers;
END $$;
