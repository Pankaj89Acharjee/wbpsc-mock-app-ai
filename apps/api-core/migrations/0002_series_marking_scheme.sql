-- ============================================================================
-- 0002 Marking scheme lives on the SERIES, not on each paper.
--
-- Every paper in a series (Mock Test 01, 02, …) is sat under the same
-- duration, marks per correct answer, negative marking and cutoff, so those
-- are configured once on the series. Papers keep only their own identity
-- (title, number of questions, PYQ year, order).
--
-- Existing series take the values of their oldest paper before the paper
-- columns are dropped. Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE exam_series
  ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 90
    CONSTRAINT exam_series_duration_minutes_check CHECK (duration_minutes BETWEEN 1 AND 600),
  ADD COLUMN IF NOT EXISTS marks_per_correct numeric(5, 2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS negative_marks_per_wrong numeric(5, 2) NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS estimated_cutoff_marks numeric(6, 2) NOT NULL DEFAULT 0.00;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exam_papers' AND column_name = 'duration_minutes'
  ) THEN
    UPDATE exam_series s
    SET duration_minutes = p.duration_minutes,
        marks_per_correct = p.marks_per_correct,
        negative_marks_per_wrong = p.negative_marks_per_wrong,
        estimated_cutoff_marks = p.estimated_cutoff_marks
    FROM (
      SELECT DISTINCT ON (series_id)
        series_id, duration_minutes, marks_per_correct, negative_marks_per_wrong, estimated_cutoff_marks
      FROM exam_papers
      ORDER BY series_id, created_at
    ) p
    WHERE p.series_id = s.id;
  END IF;
END $$;

ALTER TABLE exam_papers
  DROP COLUMN IF EXISTS duration_minutes,
  DROP COLUMN IF EXISTS marks_per_correct,
  DROP COLUMN IF EXISTS negative_marks_per_wrong,
  DROP COLUMN IF EXISTS estimated_cutoff_marks;
