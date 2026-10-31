-- ============================================================================
-- Migration 0007: Ensure student_subscriptions.created_by & indexes exist
-- Fixes "column created_by of relation student_subscriptions does not exist"
-- on databases where 0005/0006 ran before created_by was added.
-- ============================================================================

ALTER TABLE student_subscriptions
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transaction_ref varchar(120),
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS student_subscriptions_user_idx
  ON student_subscriptions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS student_subscriptions_status_idx
  ON student_subscriptions (payment_status);
