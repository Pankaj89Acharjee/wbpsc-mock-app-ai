"""
WBPSC AI Mock Test & Tutor — 3-Tier AI Cache & Daily Pro Rate Limiter
File: apps/api-ai/app/services/cache.py

Architecture:
- Tier 1 (L1): Redis 7.4 (`ai:note:{topic_hash}:{lang}`) — sub-millisecond lookup, 30-day TTL.
- Tier 2 (L2): PostgreSQL 16 `ai_notes_cache` (`topic_hash`, `language`, `content_markdown`, `mcqs_json`) — permanent storage.
- Tier 3 (L3): Google AI Studio (`google-genai` SDK) — invoked ONLY on L1 + L2 miss, then written back to L2 & L1.
- Rate Limiter: Atomic Redis daily counter (`ai:quota:{user_id}:{YYYY-MM-DD}`) enforcing max 15 AI generations/evaluations per day per Pro user.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import asyncpg
import redis.asyncio as redis
from fastapi import HTTPException, status

logger = logging.getLogger("wbpsc.api_ai.cache")

IST_TZ = ZoneInfo("Asia/Kolkata")

# Default 30 days TTL for L1 Redis cache (L2 PostgreSQL is permanent)
DEFAULT_REDIS_CACHE_TTL_SEC = int(os.getenv("AI_CACHE_TTL_SECONDS", "2592000"))
PRO_DAILY_AI_QUERY_LIMIT = int(os.getenv("PRO_DAILY_AI_QUERY_LIMIT", "15"))


class ThreeTierCacheService:
    """
    Manages L1 Redis + L2 PostgreSQL (`ai_notes_cache`) and per-user daily AI rate limits.
    """

    def __init__(
        self,
        redis_client: redis.Redis,
        db_pool: asyncpg.Pool,
    ) -> None:
        self.redis = redis_client
        self.db_pool = db_pool

    @staticmethod
    def compute_topic_hash(
        exam_slug: str,
        topic_slug: str,
        language: str,
    ) -> tuple[str, str]:
        """
        Computes a deterministic canonical key and SHA-256 hash:
        raw_key = "{exam_slug}:{topic_slug}:{lang}"
        """
        normalized_exam = exam_slug.strip().lower()
        normalized_topic = topic_slug.strip().lower()
        normalized_lang = language.strip().lower()

        canonical_key = f"{normalized_exam}:{normalized_topic}:{normalized_lang}"
        topic_hash = hashlib.sha256(canonical_key.encode("utf-8")).hexdigest()
        return canonical_key, topic_hash

    async def ensure_schema(self) -> None:
        """
        Ensures the L2 `ai_notes_cache` and `syllabus_chunks` (pgvector) tables exist.
        Safe to run idempotently on service startup.
        """
        ddl = """
        CREATE EXTENSION IF NOT EXISTS "vector";
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

        CREATE TABLE IF NOT EXISTS ai_notes_cache (
            topic_hash VARCHAR(64) NOT NULL,
            language VARCHAR(2) NOT NULL CHECK (language IN ('en', 'bn')),
            canonical_key VARCHAR(320) NOT NULL,
            exam_slug VARCHAR(80) NOT NULL,
            topic_slug VARCHAR(180) NOT NULL,
            content_markdown TEXT NOT NULL,
            mnemonics_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            mcqs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            model_used VARCHAR(80) NOT NULL,
            hit_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (topic_hash, language)
        );

        CREATE INDEX IF NOT EXISTS idx_ai_notes_cache_canonical_key
            ON ai_notes_cache (canonical_key);

        CREATE TABLE IF NOT EXISTS syllabus_chunks (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            exam_slug VARCHAR(80) NOT NULL,
            subject_slug VARCHAR(120) NOT NULL,
            topic_slug VARCHAR(180) NOT NULL,
            language VARCHAR(2) NOT NULL DEFAULT 'bn',
            title TEXT NOT NULL,
            chunk_text TEXT NOT NULL,
            pyq_years TEXT[] DEFAULT '{}',
            embedding vector(768),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_syllabus_chunks_exam_topic
            ON syllabus_chunks (exam_slug, topic_slug);
        """
        async with self.db_pool.acquire() as conn:
            await conn.execute(ddl)

    # =========================================================================
    # 1. Redis Daily Rate Limiter (Max 15 AI queries / day per Pro user)
    # =========================================================================

    async def enforce_daily_pro_rate_limit(
        self,
        user_id: str,
        subscription_tier: str = "pro_prelims",
        daily_limit: int = PRO_DAILY_AI_QUERY_LIMIT,
    ) -> dict[str, int]:
        """
        Atomically increments and validates the user's daily AI query count in Redis.
        Resets automatically at midnight IST (Asia/Kolkata).
        Raises HTTP 429 if the user exceeds 15 AI queries/day.
        """
        if subscription_tier == "free":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "PRO_SUBSCRIPTION_REQUIRED",
                    "message_en": "AI Study Notes & Descriptive Evaluator require an active WBPSC Pro Pass.",
                    "message_bn": "AI স্টাডি নোটস এবং ডেসক্রিপটিভ খাতা মূল্যায়নের জন্য WBPSC Pro সাবস্ক্রিপশন প্রয়োজন।",
                },
            )

        now_ist = datetime.now(IST_TZ)
        date_str = now_ist.strftime("%Y-%m-%d")
        redis_key = f"ai:ratelimit:{user_id}:{date_str}"

        # Calculate seconds remaining until midnight IST
        midnight_ist = (now_ist.replace(hour=23, minute=59, second=59, microsecond=999999))
        ttl_seconds = max(60, int((midnight_ist - now_ist).total_seconds()) + 1)

        try:
            async with self.redis.pipeline(transaction=True) as pipe:
                pipe.incr(redis_key)
                pipe.ttl(redis_key)
                current_count, current_ttl = await pipe.execute()

            if current_ttl < 0:
                await self.redis.expire(redis_key, ttl_seconds)

            if int(current_count) > daily_limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "error": "DAILY_AI_QUOTA_EXCEEDED",
                        "limit": daily_limit,
                        "used": int(current_count) - 1,
                        "reset_in_seconds": ttl_seconds,
                        "message_en": f"You have reached your daily limit of {daily_limit} AI Tutor queries. Quota resets at midnight IST.",
                        "message_bn": f"আপনার দৈনিক {daily_limit}টি AI টিউটর কোয়েরির সীমা শেষ হয়েছে। মধ্যরাত ১২টায় (IST) আবার নতুন কোটা চালু হবে।",
                    },
                )

            return {
                "limit": daily_limit,
                "used": int(current_count),
                "remaining": max(0, daily_limit - int(current_count)),
                "reset_in_seconds": ttl_seconds,
            }
        except HTTPException:
            raise
        except Exception as exc:
            # Fail-open on transient Redis connectivity issues so Cloud Run stays resilient
            logger.warning("Redis rate-limit check degraded: %s", exc)
            return {
                "limit": daily_limit,
                "used": 1,
                "remaining": daily_limit - 1,
                "reset_in_seconds": ttl_seconds,
            }

    # =========================================================================
    # 2. Tier-1 (Redis) + Tier-2 (PostgreSQL) Lookup
    # =========================================================================

    async def get_cached_note(
        self,
        exam_slug: str,
        topic_slug: str,
        language: str,
    ) -> Optional[dict[str, Any]]:
        """
        Checks Tier-1 Redis first.
        On Redis miss, checks Tier-2 PostgreSQL `ai_notes_cache` (`topic_hash`, `language`, `content_markdown`).
        If found in PostgreSQL, warms Tier-1 Redis automatically.
        """
        canonical_key, topic_hash = self.compute_topic_hash(
            exam_slug, topic_slug, language
        )
        redis_cache_key = f"ai:note:{topic_hash}:{language}"

        # --- Tier 1: Redis Check ---
        try:
            cached_raw = await self.redis.get(redis_cache_key)
            if cached_raw:
                payload = json.loads(cached_raw)
                payload["cache_tier"] = "L1_REDIS_HIT"
                payload["topic_hash"] = topic_hash
                payload["canonical_key"] = canonical_key
                return payload
        except Exception as exc:
            logger.warning("L1 Redis read warning for %s: %s", canonical_key, exc)

        # --- Tier 2: PostgreSQL `ai_notes_cache` Check ---
        query = """
            UPDATE ai_notes_cache
            SET hit_count = hit_count + 1,
                updated_at = NOW()
            WHERE topic_hash = $1 AND language = $2
            RETURNING
                topic_hash,
                language,
                canonical_key,
                exam_slug,
                topic_slug,
                content_markdown,
                mnemonics_json,
                mcqs_json,
                model_used,
                hit_count,
                created_at
        """
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(query, topic_hash, language)

        if not row:
            return None

        mnemonics_data = (
            json.loads(row["mnemonics_json"])
            if isinstance(row["mnemonics_json"], str)
            else row["mnemonics_json"]
        )
        mcqs_data = (
            json.loads(row["mcqs_json"])
            if isinstance(row["mcqs_json"], str)
            else row["mcqs_json"]
        )

        payload = {
            "topic_hash": row["topic_hash"],
            "canonical_key": row["canonical_key"],
            "exam_slug": row["exam_slug"],
            "topic_slug": row["topic_slug"],
            "language": row["language"],
            "content_markdown": row["content_markdown"],
            "mnemonics": mnemonics_data,
            "likely_mcqs": mcqs_data,
            "model_used": row["model_used"],
            "hit_count": row["hit_count"],
            "created_at": row["created_at"].isoformat(),
            "cache_tier": "L2_POSTGRES_HIT",
        }

        # Re-warm L1 Redis asynchronously
        try:
            await self.redis.setex(
                redis_cache_key,
                DEFAULT_REDIS_CACHE_TTL_SEC,
                json.dumps(payload, ensure_ascii=False),
            )
        except Exception as exc:
            logger.warning("Failed to warm L1 Redis from L2 Postgres: %s", exc)

        return payload

    # =========================================================================
    # 3. Tier-3 Write-Back (Save Gemini output to PostgreSQL & Redis)
    # =========================================================================

    async def save_generated_note(
        self,
        exam_slug: str,
        topic_slug: str,
        language: str,
        content_markdown: str,
        mnemonics: list[str],
        likely_mcqs: list[dict[str, Any]],
        model_used: str,
    ) -> dict[str, Any]:
        """
        Persists newly generated study notes permanently in PostgreSQL `ai_notes_cache`
        and caches them in Redis with a 30-day TTL.
        """
        canonical_key, topic_hash = self.compute_topic_hash(
            exam_slug, topic_slug, language
        )
        redis_cache_key = f"ai:note:{topic_hash}:{language}"
        now_iso = datetime.now(timezone.utc).isoformat()

        upsert_sql = """
            INSERT INTO ai_notes_cache (
                topic_hash,
                language,
                canonical_key,
                exam_slug,
                topic_slug,
                content_markdown,
                mnemonics_json,
                mcqs_json,
                model_used,
                hit_count,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, 1, NOW(), NOW())
            ON CONFLICT (topic_hash, language)
            DO UPDATE SET
                content_markdown = EXCLUDED.content_markdown,
                mnemonics_json = EXCLUDED.mnemonics_json,
                mcqs_json = EXCLUDED.mcqs_json,
                model_used = EXCLUDED.model_used,
                hit_count = ai_notes_cache.hit_count + 1,
                updated_at = NOW()
            RETURNING hit_count
        """

        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(
                upsert_sql,
                topic_hash,
                language,
                canonical_key,
                exam_slug.strip().lower(),
                topic_slug.strip().lower(),
                content_markdown,
                json.dumps(mnemonics, ensure_ascii=False),
                json.dumps(likely_mcqs, ensure_ascii=False),
                model_used,
            )

        payload = {
            "topic_hash": topic_hash,
            "canonical_key": canonical_key,
            "exam_slug": exam_slug.strip().lower(),
            "topic_slug": topic_slug.strip().lower(),
            "language": language,
            "content_markdown": content_markdown,
            "mnemonics": mnemonics,
            "likely_mcqs": likely_mcqs,
            "model_used": model_used,
            "hit_count": row["hit_count"] if row else 1,
            "created_at": now_iso,
            "cache_tier": "L3_GEMINI_GENERATED",
        }

        try:
            await self.redis.setex(
                redis_cache_key,
                DEFAULT_REDIS_CACHE_TTL_SEC,
                json.dumps(payload, ensure_ascii=False),
            )
        except Exception as exc:
            logger.warning("Failed to write L1 Redis key %s: %s", redis_cache_key, exc)

        return payload
