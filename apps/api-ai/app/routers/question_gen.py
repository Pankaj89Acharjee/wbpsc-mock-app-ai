"""
WBPSC AI Mock Test & Tutor — AI PYQ-Clone Question Generator (Pipeline 3)
File: apps/api-ai/app/routers/question_gen.py

Endpoint:
POST /internal/questions/generate   (service-to-service; called only by apps/api-core)
  - Auth: `X-Internal-Token` header must equal INTERNAL_SERVICE_TOKEN.
  - Mandatory 3-tier cache BEFORE any Gemini call:
      key = "qgen:{exam_slug}:{subtopic_slug}:{difficulty}:{count}:r{round}"
      L1 Redis → L2 PostgreSQL `ai_question_generation_cache` → L3 Gemini (miss only), saved permanently.
    `round` = number of earlier AI batches for this subtopic (sent by api-core), so retrying the
    same round costs nothing while asking again yields a fresh, different batch.
  - Grounded on real WBPSC PYQs from the same subtopic/chapter (few-shot examples from api-core)
    and told which stems already exist so it does not repeat them.
  - Output is staged by api-core for educator review — nothing goes live without approval.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Literal

import asyncpg
from fastapi import APIRouter, Header, HTTPException, Request, status
from google import genai
from google.genai import types
from pydantic import BaseModel, Field, ValidationError

from app.services.internal_auth import verify_internal_token

logger = logging.getLogger("wbpsc.api_ai.question_gen")

router = APIRouter(prefix="/internal/questions", tags=["AI Question Generator"])

QUESTION_MODEL = os.getenv(
    "GEMINI_QUESTION_MODEL", os.getenv("GEMINI_EVAL_MODEL", "gemini-2.5-flash")
)
CACHE_TTL_SEC = int(os.getenv("AI_CACHE_TTL_SECONDS", "2592000"))

# ============================================================================
# Models
# ============================================================================

OptionKey = Literal["A", "B", "C", "D"]
Difficulty = Literal["easy", "moderate", "hard"]


class Bilingual(BaseModel):
    en: str
    bn: str


class Options(BaseModel):
    A: Bilingual
    B: Bilingual
    C: Bilingual
    D: Bilingual


class GeneratedQuestion(BaseModel):
    stem: Bilingual
    options: Options
    correct_option: OptionKey
    explanation: Bilingual
    difficulty: Difficulty
    confidence: float = Field(
        description="0.0–1.0: how certain you are the marked answer is factually correct"
    )


class GeneratedBatch(BaseModel):
    questions: list[GeneratedQuestion]


class FewShotExample(BaseModel):
    stem_en: str
    options_en: dict[str, str]
    correct_option: str
    source_tag: str | None = None


class GenerateRequest(BaseModel):
    exam_slug: str = Field(min_length=2, max_length=80)
    exam_title: str = Field(min_length=2, max_length=200)
    subject_name: str = Field(min_length=1, max_length=200)
    chapter_name: str = Field(min_length=1, max_length=200)
    subtopic_slug: str = Field(min_length=1, max_length=160)
    subtopic_name: str = Field(min_length=1, max_length=200)
    count: int = Field(ge=1, le=50)
    difficulty: Literal["easy", "moderate", "hard", "mixed"] = "mixed"
    round: int = Field(ge=0, default=0)
    examples: list[FewShotExample] = Field(default_factory=list, max_length=8)
    avoid_stems: list[str] = Field(default_factory=list, max_length=80)


class GenerateResponse(BaseModel):
    questions: list[GeneratedQuestion]
    model_used: str
    cache_tier: Literal["redis", "postgres", "gemini"]
    cache_key: str


# ============================================================================
# Schema (called from app lifespan)
# ============================================================================


async def ensure_question_cache_schema(db_pool: asyncpg.Pool) -> None:
    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_question_generation_cache (
                cache_hash VARCHAR(64) PRIMARY KEY,
                canonical_key VARCHAR(400) NOT NULL,
                exam_slug VARCHAR(80) NOT NULL,
                subtopic_slug VARCHAR(160) NOT NULL,
                questions_json JSONB NOT NULL,
                model_used VARCHAR(80) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )


# ============================================================================
# Helpers
# ============================================================================


def cache_key_for(req: GenerateRequest) -> tuple[str, str]:
    canonical = (
        f"qgen:{req.exam_slug.strip().lower()}:{req.subtopic_slug.strip().lower()}:"
        f"{req.difficulty}:{req.count}:r{req.round}"
    )
    return canonical, hashlib.sha256(canonical.encode("utf-8")).hexdigest()


SYSTEM_INSTRUCTION = """You are a senior paper-setter for the West Bengal Public Service Commission (WBPSC).
You write objective MCQs exactly like real WBCS (Exe.), WBPSC Clerkship, Food SI and Miscellaneous
Services question papers, which are printed in both English and Bengali.

Non-negotiable rules:
1. Factual accuracy first. Only ask about stable, verifiable facts from NCERT / standard reference
   books / official sources. Never invent data, and never ask about events you are unsure of or that
   may have changed recently. If you are not fully certain of an answer, lower `confidence`.
2. Exactly ONE option is correct. The three distractors must be plausible, of the same type and
   similar length (same category of names, years, articles, places, numbers).
3. Avoid "All of the above", "None of the above" and "Both A and B" unless a real WBPSC paper would
   naturally use it. No trick wording, no negatives like "Which is NOT" more than once per batch.
4. Vary formats as real papers do: direct one-liners, "Which of the following is correct?",
   statement-based, match-the-pair written inline, chronology and "who/when/where" questions.
5. Bengali (`bn`) must be standard formal Bengali as used in WBPSC Bengali-version papers, with
   correct conjuncts (যুক্তাক্ষর). Keep proper nouns recognisable; write numbers with Bengali digits.
   The Bengali must say exactly the same thing as the English.
6. `explanation`: 2–4 sentences stating why the answer is correct, plus one useful related fact
   that helps eliminate a distractor. Same content in `en` and `bn`.
7. Every question must test a DIFFERENT fact. Never repeat or lightly reword any stem listed under
   "Already in the bank".
8. Spread the correct answer across A, B, C and D.
"""


def build_prompt(req: GenerateRequest, chunk_count: int | None = None, extra_avoid: list[str] | None = None) -> str:
    target_count = chunk_count if chunk_count is not None else req.count
    difficulty_rule = (
        "a realistic mix: about 30% easy, 50% moderate, 20% hard"
        if req.difficulty == "mixed"
        else f"all `{req.difficulty}`"
    )
    lines = [
        f"Exam: {req.exam_title} ({req.exam_slug})",
        f"Subject: {req.subject_name}",
        f"Chapter: {req.chapter_name}",
        f"Subtopic: {req.subtopic_name}",
        "",
        f"Write {target_count} new MCQs strictly on this subtopic. Difficulty: {difficulty_rule}.",
    ]
    if req.examples:
        lines += ["", "Real questions from this area (match their style, depth and phrasing):"]
        for i, ex in enumerate(req.examples, 1):
            opts = " | ".join(f"{k}) {v}" for k, v in sorted(ex.options_en.items()))
            tag = f" [{ex.source_tag}]" if ex.source_tag else ""
            lines.append(f"{i}. {ex.stem_en}{tag}\n   {opts}\n   Answer: {ex.correct_option}")
    all_avoid = list(req.avoid_stems) + (extra_avoid or [])
    if all_avoid:
        lines += ["", "Already in the bank — do NOT repeat or reword these:"]
        lines += [f"- {s}" for s in all_avoid[:120]]
    return "\n".join(lines)


async def call_gemini(req: GenerateRequest) -> list[GeneratedQuestion]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GEMINI_API_KEY is not configured on api-ai.",
        )
    client = genai.Client(api_key=api_key)
    collected: list[GeneratedQuestion] = []
    remaining = req.count
    extra_avoid: list[str] = []

    while remaining > 0:
        chunk_size = min(20, remaining)
        response = await client.aio.models.generate_content(
            model=QUESTION_MODEL,
            contents=build_prompt(req, chunk_count=chunk_size, extra_avoid=extra_avoid),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.7,
                response_mime_type="application/json",
                response_schema=GeneratedBatch,
            ),
        )
        try:
            batch = GeneratedBatch.model_validate_json(response.text or "{}")
        except ValidationError as exc:
            logger.error("Gemini returned an invalid question batch: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="The AI model returned malformed questions. Please try again.",
            ) from exc

        for q in batch.questions[:chunk_size]:
            q.confidence = min(1.0, max(0.0, q.confidence))
            collected.append(q)
            extra_avoid.append(q.stem.en)

        if not batch.questions:
            break
        remaining = req.count - len(collected)

    return collected[: req.count]


# ============================================================================
# Endpoint
# ============================================================================


@router.post("/generate", response_model=GenerateResponse)
async def generate_questions(
    payload: GenerateRequest,
    request: Request,
    x_internal_token: str | None = Header(default=None),
) -> GenerateResponse:
    verify_internal_token(x_internal_token)

    canonical, cache_hash = cache_key_for(payload)
    redis_client = request.app.state.redis
    db_pool: asyncpg.Pool = request.app.state.db_pool
    redis_key = f"ai:qgen:{cache_hash}"

    # Tier 1: Redis
    try:
        cached = await redis_client.get(redis_key)
    except Exception:  # Redis down must not block generation
        logger.warning("Redis unavailable for %s; falling back to PostgreSQL", canonical)
        cached = None
    if cached:
        data = json.loads(cached)
        return GenerateResponse(
            questions=[GeneratedQuestion.model_validate(q) for q in data["questions"]],
            model_used=data["model_used"],
            cache_tier="redis",
            cache_key=canonical,
        )

    # Tier 2: PostgreSQL (permanent)
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT questions_json, model_used FROM ai_question_generation_cache WHERE cache_hash = $1",
            cache_hash,
        )
    if row:
        questions = json.loads(row["questions_json"])
        await _write_redis(redis_client, redis_key, questions, row["model_used"])
        return GenerateResponse(
            questions=[GeneratedQuestion.model_validate(q) for q in questions],
            model_used=row["model_used"],
            cache_tier="postgres",
            cache_key=canonical,
        )

    # Tier 3: Gemini (cache miss only)
    logger.info("Generating %d questions for %s via %s", payload.count, canonical, QUESTION_MODEL)
    generated = await call_gemini(payload)
    questions_json = [q.model_dump() for q in generated]

    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO ai_question_generation_cache
                (cache_hash, canonical_key, exam_slug, subtopic_slug, questions_json, model_used)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6)
            ON CONFLICT (cache_hash) DO NOTHING
            """,
            cache_hash,
            canonical,
            payload.exam_slug,
            payload.subtopic_slug,
            json.dumps(questions_json, ensure_ascii=False),
            QUESTION_MODEL,
        )
    await _write_redis(redis_client, redis_key, questions_json, QUESTION_MODEL)

    return GenerateResponse(
        questions=generated,
        model_used=QUESTION_MODEL,
        cache_tier="gemini",
        cache_key=canonical,
    )


async def _write_redis(redis_client, key: str, questions: list, model_used: str) -> None:
    try:
        await redis_client.set(
            key,
            json.dumps({"questions": questions, "model_used": model_used}, ensure_ascii=False),
            ex=CACHE_TTL_SEC,
        )
    except Exception:
        logger.warning("Could not write %s to Redis", key)
