-- 0005_subscriptions_and_paid_series.sql
-- Adds new subscription tiers (pro_mains, part2_descriptive), paid/free access fields on exam_series,
-- payment due tracking on users, and the student_subscriptions ledger table.

ALTER TYPE subscription_tier ADD VALUE IF NOT EXISTS 'pro_mains';
ALTER TYPE subscription_tier ADD VALUE IF NOT EXISTS 'part2_descriptive';

ALTER TABLE exam_series
  ADD COLUMN IF NOT EXISTS access_type varchar(16) NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS required_tier subscription_tier NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS price_inr numeric(8, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payment_due_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_paid_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS billing_notes text;

CREATE TABLE IF NOT EXISTS student_subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_tier subscription_tier NOT NULL DEFAULT 'free',
  plan_name varchar(160) NOT NULL,
  billing_cycle varchar(32) NOT NULL DEFAULT 'annual',
  plan_price_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
  amount_paid_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
  amount_due_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
  payment_status varchar(32) NOT NULL DEFAULT 'paid',
  payment_mode varchar(64) NOT NULL DEFAULT 'test_payment',
  transaction_ref varchar(120),
  notes text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_subscriptions_user_idx
  ON student_subscriptions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS student_subscriptions_status_idx
  ON student_subscriptions (payment_status);

