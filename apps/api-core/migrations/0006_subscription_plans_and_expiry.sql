-- ============================================================================
-- Migration 0006: Dynamic Subscription Plans Table (Admin CRUD) & Auto-Expiry
-- ============================================================================

-- 1. Convert subscription tier columns to VARCHAR(80) so Admin can add, modify,
--    and delete custom subscription plans without enum constraint errors.
ALTER TABLE users
  ALTER COLUMN subscription_tier DROP DEFAULT,
  ALTER COLUMN subscription_tier TYPE varchar(80) USING subscription_tier::text,
  ALTER COLUMN subscription_tier SET DEFAULT 'free';

ALTER TABLE exam_series
  ALTER COLUMN required_tier DROP DEFAULT,
  ALTER COLUMN required_tier TYPE varchar(80) USING required_tier::text,
  ALTER COLUMN required_tier SET DEFAULT 'free';

ALTER TABLE student_subscriptions
  ALTER COLUMN plan_tier DROP DEFAULT,
  ALTER COLUMN plan_tier TYPE varchar(80) USING plan_tier::text,
  ALTER COLUMN plan_tier SET DEFAULT 'pro_prelims';

-- 2. Create subscription_plans table for Admin to add, modify, and delete plans
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier varchar(80) NOT NULL UNIQUE,
  short_label varchar(80) NOT NULL,
  label_en varchar(200) NOT NULL,
  label_bn varchar(200) NOT NULL DEFAULT '',
  price_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
  billing_cycle varchar(32) NOT NULL DEFAULT 'yearly',
  duration_days integer NOT NULL DEFAULT 365,
  description_en text NOT NULL DEFAULT '',
  description_bn text NOT NULL DEFAULT '',
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_plans_order_idx
  ON subscription_plans (display_order, created_at);

-- 3. Seed default WBPSC subscription plans (idempotent)
INSERT INTO subscription_plans (
  tier, short_label, label_en, label_bn, price_inr, billing_cycle, duration_days,
  description_en, description_bn, features, is_active, display_order
)
VALUES
  (
    'free',
    'Free Tier',
    'Free Starter Tier',
    'ফ্রি স্টার্টার প্ল্যান',
    0.00,
    'lifetime',
    0,
    'Access all Free Mock Tests, basic weakness tracking, and daily current affairs.',
    'সকল ফ্রি মক টেস্ট, দুর্বলতা বিশ্লেষণ ও ডেইলি কারেন্ট অ্যাফেয়ার্স।',
    '["All Free Test Series", "SQL Weakness Radar", "Daily Current Affairs"]'::jsonb,
    true,
    1
  ),
  (
    'pro_prelims',
    'Pro Prelims',
    'Pro Prelims Pass (Clerkship / Food SI / WBCS Prelims)',
    'প্রো প্রিলিমিনারি পাস (ক্লার্কশিপ / ফুড এসআই / WBCS প্রিলিমস)',
    299.00,
    'yearly',
    365,
    'Unlocks all Paid Prelims Test Series (Clerkship Part-I, Food SI, WBCS Prelims) + AI Study Notes.',
    'সকল পেইড প্রিলিমিনারি টেস্ট সিরিজ এবং এআই স্টাডি নোট আনলক করুন।',
    '["All Free + Prelims Paid Series", "Bilingual AI Tutor Notes", "Unlimited Re-Attempts & Pause"]'::jsonb,
    true,
    2
  ),
  (
    'pro_mains',
    'Mains Tier',
    'Pro Mains Tier (WBCS Mains & Miscellaneous Mains)',
    'প্রো মেইনস টিয়ার (WBCS মেইনস ও মিসলেনিয়াস মেইনস)',
    499.00,
    'yearly',
    365,
    'Unlocks Prelims + Advanced Mains Mock Test Series with high-difficulty analytical MCQs.',
    'প্রিলিমস এবং অ্যাডভান্সড মেইনস মক টেস্ট সিরিজ আনলক করুন।',
    '["All Prelims + Mains Paid Series", "Advanced Mains Paper Sets", "Deep Subtopic Mastery Analytics"]'::jsonb,
    true,
    3
  ),
  (
    'part2_descriptive',
    'Part-II Tier',
    'Part-II Descriptive Tier (Clerkship & Mains Descriptive)',
    'পার্ট-II ডেসক্রিপটিভ টিয়ার (ক্লার্কশিপ ও মেইনস লিখিত)',
    399.00,
    'yearly',
    365,
    'Unlocks Paid Part-II Descriptive Evaluator, Precis/Report/Translation sets & Prelims Mock Series.',
    'ক্লার্কশিপ পার্ট-II লিখিত মূল্যায়ন ও প্রিলিমস মক টেস্ট আনলক করুন।',
    '["Part-II AI Descriptive Evaluator", "Bilingual Translation & Precis Grading", "Prelims Paid Test Series"]'::jsonb,
    true,
    4
  ),
  (
    'wbcs_executive_pass',
    'WBCS Executive Pass',
    'WBCS Executive All-Access Pass (Prelims + Mains + Part-II)',
    'WBCS এক্সিকিউটিভ অল-অ্যাক্সেস পাস (প্রিলিমস + মেইনস + পার্ট-II)',
    799.00,
    'yearly',
    365,
    'Complete unrestricted access to every Paid Mock Test Series, Mains Tier, and Part-II Evaluator.',
    'সকল পেইড মক টেস্ট সিরিজ, মেইনস টিয়ার এবং পার্ট-II ইভ্যালুয়েটরের সম্পূর্ণ অ্যাক্সেস।',
    '["Unlocks 100% of Paid Test Series", "Prelims + Mains + Part-II Descriptive", "Priority AI Tutor & Remedial Tests"]'::jsonb,
    true,
    5
  )
ON CONFLICT (tier) DO NOTHING;

-- 4. Immediately downgrade any already-expired aspirant subscriptions to 'free'
UPDATE users
SET subscription_tier = 'free',
    subscription_expires_at = NULL,
    updated_at = NOW()
WHERE role <> 'admin'
  AND subscription_tier <> 'free'
  AND subscription_expires_at IS NOT NULL
  AND subscription_expires_at <= NOW();
