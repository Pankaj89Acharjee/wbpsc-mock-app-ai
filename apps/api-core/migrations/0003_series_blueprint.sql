-- ============================================================================
-- 0003 The roster becomes the SERIES blueprint.
--
-- A series defines the exam pattern once — which subjects, how many questions
-- each (e.g. GS 40 · English 30 · Maths 30), optionally broken down by
-- chapter/subtopic inside a subject — and every paper in the series follows
-- it. A paper's length is the blueprint total, so exam_papers.total_questions
-- goes away.
--
-- Backfill: each series takes the roster of its oldest paper that had one;
-- chapter/subtopic slots without a subject slot get a subject slot equal to
-- the sum of their top-level parts. Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS series_roster_slots (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  series_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  chapter_id uuid REFERENCES chapters (id) ON DELETE RESTRICT,
  subtopic_id uuid REFERENCES subtopics (id) ON DELETE RESTRICT,
  target_count integer NOT NULL CHECK (target_count BETWEEN 0 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT series_roster_slots_series_fk FOREIGN KEY (series_id, exam_id)
    REFERENCES exam_series (id, exam_id) ON DELETE CASCADE,
  CONSTRAINT series_roster_slots_subject_fk FOREIGN KEY (subject_id, exam_id)
    REFERENCES subjects (id, exam_id) ON DELETE RESTRICT,
  CONSTRAINT series_roster_slots_level_check CHECK (subtopic_id IS NULL OR chapter_id IS NOT NULL),
  CONSTRAINT series_roster_slots_node_unique UNIQUE NULLS NOT DISTINCT (series_id, subject_id, chapter_id, subtopic_id)
);
CREATE INDEX IF NOT EXISTS series_roster_slots_series_idx ON series_roster_slots (series_id);

DO $$
BEGIN
  IF to_regclass('public.paper_roster_slots') IS NOT NULL THEN
    -- Copy the oldest paper's roster that has slots, per series
    INSERT INTO series_roster_slots (series_id, exam_id, subject_id, chapter_id, subtopic_id, target_count)
    SELECT p.series_id, s.exam_id, s.subject_id, s.chapter_id, s.subtopic_id, s.target_count
    FROM paper_roster_slots s
    JOIN exam_papers p ON p.id = s.paper_id
    WHERE p.id = (
      SELECT p2.id FROM exam_papers p2
      WHERE p2.series_id = p.series_id
        AND EXISTS (SELECT 1 FROM paper_roster_slots x WHERE x.paper_id = p2.id)
      ORDER BY p2.created_at
      LIMIT 1
    )
    ON CONFLICT DO NOTHING;

    -- Every topic slot needs its subject slot (sum of the subject's top-level parts)
    INSERT INTO series_roster_slots (series_id, exam_id, subject_id, target_count)
    SELECT r.series_id, r.exam_id, r.subject_id,
           LEAST(300, SUM(r.target_count) FILTER (
             WHERE r.subtopic_id IS NULL
                OR NOT EXISTS (
                  SELECT 1 FROM series_roster_slots c
                  WHERE c.series_id = r.series_id AND c.chapter_id = r.chapter_id AND c.subtopic_id IS NULL
                )
           ))
    FROM series_roster_slots r
    WHERE r.chapter_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM series_roster_slots s
        WHERE s.series_id = r.series_id AND s.subject_id = r.subject_id AND s.chapter_id IS NULL
      )
    GROUP BY r.series_id, r.exam_id, r.subject_id;

    DROP TABLE paper_roster_slots;
  END IF;
END $$;

ALTER TABLE exam_papers DROP COLUMN IF EXISTS total_questions;
