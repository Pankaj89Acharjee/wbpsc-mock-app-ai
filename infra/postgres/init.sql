-- ============================================================================
-- WBPSC AI Mock Test & Tutor — PostgreSQL 16 Initialization
-- Target: pgvector/pgvector:0.8.0-pg16
-- ============================================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. Ensure UTF-8 encoding for Bengali conjuncts (যুক্তাক্ষর)
SET client_encoding = 'UTF8';

-- 3. Verify installed extensions
DO $$
BEGIN
  RAISE NOTICE 'Initialized extensions: uuid-ossp, vector (pgvector 0.8.0), pg_trgm';
END $$;
