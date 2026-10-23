"""
WBPSC AI Mock Test & Tutor — AI Tutor & Descriptive Answer Evaluator Router
File: apps/api-ai/app/routers/tutor.py

Endpoints:
1. POST /ai/generate-notes:
   - Checks 3-Tier Cache (`Redis -> PostgreSQL ai_notes_cache -> Gemini`) BEFORE any LLM call.
   - Enforces Redis daily rate limit (15 AI queries/day per Pro user) only when an AI call is made or requested.
   - Uses `pgvector` cosine similarity (`<=>`) on `syllabus_chunks` to retrieve grounded WBPSC syllabus context.
   - Calls Google AI Studio (`gemini-3.1-flash-lite` or `gemini-2.5-flash`) with structured JSON output containing:
     * Exam-focused Markdown study notes (`content_markdown`) in Bengali (`bn`) or English (`en`)
     * High-retention memory mnemonics (`mnemonics`)
     * 5 PYQ-style bilingual/targeted MCQs (`likely_mcqs`)
2. POST /ai/evaluate-descriptive:
   - Accepts typed text OR an image upload (handwritten sheet photo) for WBPSC Clerkship Part-II / WBCS Mains
     (Report Writing, Précis Writing, or Bengali/English Translation).
   - Calls `gemini-2.5-flash` multimodal API to return a strict JSON evaluation:
     Grammar score, Content score, Word Limit adherence, detailed feedback, and a Corrected Model Answer.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Annotated, Literal, Optional

import asyncpg
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from app.services.cache import ThreeTierCacheService

logger = logging.getLogger("wbpsc.api_ai.tutor")

router = APIRouter(prefix="/ai", tags=["WBPSC AI Tutor & Evaluator"])

# ============================================================================
# Models & Configuration
# ============================================================================

GEMINI_NOTES_MODEL = os.getenv("GEMINI_PRIMARY_MODEL", "gemini-3.1-flash-lite")
GEMINI_EVAL_MODEL = os.getenv("GEMINI_EVAL_MODEL", "gemini-2.5-flash")
GEMINI_EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "text-embedding-004")


def get_genai_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY environment variable is not configured.",
        )
    return genai.Client(api_key=api_key)


def get_cache_service(request: Request) -> ThreeTierCacheService:
    return request.app.state.cache_service


# ============================================================================
# Pydantic Schemas for Request & Structured Gemini Output
# ============================================================================


class GenerateNotesRequest(BaseModel):
    user_id: str = Field(..., description="UUID of the authenticated user")
    subscription_tier: Literal["free", "pro_prelims", "wbcs_executive_pass"] = Field(
        default="pro_prelims"
    )
    exam_slug: Literal[
        "wbcs-prelims",
        "wbcs-mains",
        "wbpsc-clerkship-part1",
        "wbpsc-clerkship-part2",
        "wbpsc-miscellaneous",
        "wbpsc-food-si",
        "wbp-constable-si",
    ] = Field(default="wbcs-prelims")
    subject_name: str = Field(
        ..., examples=["Indian Polity & Panchayati Raj"]
    )
    topic_slug: str = Field(
        ..., examples=["73rd-74th-constitutional-amendment"]
    )
    topic_title: str = Field(
        ..., examples=["73rd & 74th Constitutional Amendment Acts (পঞ্চায়েতি রাজ ও পৌরসভা)"]
    )
    language: Literal["en", "bn"] = Field(default="bn")
    model_preference: Literal["gemini-3.1-flash-lite", "gemini-2.5-flash"] = Field(
        default="gemini-3.1-flash-lite"
    )


class GeneratedMCQItem(BaseModel):
    question_stem: str = Field(
        ..., description="PYQ-style MCQ stem in the requested language"
    )
    options: dict[str, str] = Field(
        ..., description="Options dictionary with keys A, B, C, D"
    )
    correct_option: Literal["A", "B", "C", "D"]
    explanation: str = Field(
        ..., description="Concise exam-focused explanation citing facts/articles/years"
    )
    pyq_reference_tag: str = Field(
        ..., description="e.g., 'WBCS Prelims Trend' or 'WBPSC Clerkship High-Yield'"
    )


class GeminiStudyNoteStructuredOutput(BaseModel):
    content_markdown: str = Field(
        ...,
        description=(
            "Comprehensive, exam-focused Markdown revision note with tables, bullet points, "
            "important years/articles, and WBPSC trap alerts."
        ),
    )
    mnemonics: list[str] = Field(
        ...,
        min_length=2,
        max_length=5,
        description="Memorable Bengali or English mnemonics/acrostics for quick recall",
    )
    likely_mcqs: list[GeneratedMCQItem] = Field(
        ...,
        min_length=5,
        max_length=5,
        description="Exactly 5 likely WBPSC PYQ-style MCQs with answers and explanations",
    )


class DescriptiveEvaluationStructuredOutput(BaseModel):
    task_type: Literal["report_writing", "precis_writing", "translation", "essay"]
    language: Literal["en", "bn"]
    transcribed_student_answer: str = Field(
        ...,
        description="Full text of the student's answer (transcribed if uploaded as an image)",
    )
    estimated_word_count: int = Field(..., ge=0)
    target_word_limit: int = Field(..., ge=10)
    scores: dict[str, float] = Field(
        ...,
        description="Breakdown: grammar_score (out of 10), content_score (out of 10), word_limit_score (out of 5), total_score (out of 25)",
    )
    grammar_score: float = Field(..., ge=0, le=10, description="Marks out of 10 for Grammar, Spelling & Matra/Conjunct accuracy")
    content_score: float = Field(..., ge=0, le=10, description="Marks out of 10 for Relevance, Format (Heading/Date/Place) & Expression")
    word_limit_score: float = Field(..., ge=0, le=5, description="Marks out of 5 for adhering to WBPSC prescribed word count")
    total_score: float = Field(..., ge=0, le=25, description="Sum of grammar_score + content_score + word_limit_score (out of 25)")
    strengths: list[str] = Field(..., description="Key positive aspects of the student's writing")
    improvements_needed: list[str] = Field(
        ..., description="Specific grammatical, structural, or vocabulary corrections"
    )
    corrected_model_answer: str = Field(
        ...,
        description="Complete high-scoring WBPSC Clerkship Part-II / WBCS Mains model answer in the target language",
    )


# ============================================================================
# Helper: pgvector Syllabus Context Retrieval
# ============================================================================


async def fetch_pgvector_syllabus_context(
    db_pool: asyncpg.Pool,
    genai_client: genai.Client,
    exam_slug: str,
    topic_slug: str,
    topic_title: str,
    language: str,
    top_k: int = 4,
) -> str:
    """
    Retrieves top-K relevant WBPSC syllabus chunks from PostgreSQL using `pgvector` cosine distance (`<=>`).
    Falls back cleanly to keyword/slug match if no vector embeddings are populated yet.
    """
    try:
        embed_resp = genai_client.models.embed_content(
            model=GEMINI_EMBEDDING_MODEL,
            contents=f"WBPSC {exam_slug} {topic_title} ({topic_slug})",
        )
        embedding_values = embed_resp.embeddings[0].values
        vector_literal = "[" + ",".join(f"{v:.6f}" for v in embedding_values) + "]"

        vector_sql = """
            SELECT
                title,
                chunk_text,
                pyq_years,
                1 - (embedding <=> $1::vector) AS similarity
            FROM syllabus_chunks
            WHERE exam_slug = $2
              AND embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT $3
        """
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(vector_sql, vector_literal, exam_slug, top_k)

        if rows:
            formatted_chunks = []
            for idx, r in enumerate(rows, start=1):
                pyq_str = ", ".join(r["pyq_years"]) if r["pyq_years"] else "Standard Syllabus"
                formatted_chunks.append(
                    f"[Chunk {idx} | {r['title']} | PYQs: {pyq_str}]\n{r['chunk_text']}"
                )
            return "\n\n".join(formatted_chunks)
    except Exception as exc:
        logger.info("pgvector semantic lookup fallback to slug lookup: %s", exc)

    # Fallback: exact topic_slug lookup
    fallback_sql = """
        SELECT title, chunk_text, pyq_years
        FROM syllabus_chunks
        WHERE exam_slug = $1 AND topic_slug = $2
        LIMIT $3
    """
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(fallback_sql, exam_slug, topic_slug, top_k)

    if not rows:
        return (
            f"Official WBPSC Syllabus Topic: {topic_title} (Exam: {exam_slug}, "
            f"Language: {'Bengali (বাংলা)' if language == 'bn' else 'English'})."
        )

    return "\n\n".join(f"[{r['title']}]\n{r['chunk_text']}" for r in rows)


# ============================================================================
# 1. POST /ai/generate-notes
# ============================================================================


@router.post("/generate-notes")
async def generate_study_notes(
    payload: GenerateNotesRequest,
    request: Request,
    cache_service: Annotated[ThreeTierCacheService, Depends(get_cache_service)],
):
    """
    3-Tier Cached RAG Study Note Generator for WBPSC Prelims & Mains:
    1. Checks L1 Redis -> L2 PostgreSQL (`ai_notes_cache`). Returns immediately if cached (0 Gemini tokens used).
    2. On cache miss, checks & increments the Pro user's daily Redis quota (max 15 AI queries/day).
    3. Queries `pgvector` (`syllabus_chunks`) for grounded WBPSC syllabus context.
    4. Calls `gemini-3.1-flash-lite` or `gemini-2.5-flash` to generate bilingual/targeted Markdown notes,
       mnemonics, and 5 likely PYQ-style MCQs, then stores permanently in PostgreSQL + Redis.
    """
    # Step 1: Check 3-Tier Cache (L1 Redis + L2 PostgreSQL) BEFORE touching rate limit or Gemini API
    cached_note = await cache_service.get_cached_note(
        exam_slug=payload.exam_slug,
        topic_slug=payload.topic_slug,
        language=payload.language,
    )
    if cached_note is not None:
        return {
            "status": "success",
            "cached": True,
            "data": cached_note,
        }

    # Step 2: Cache Miss -> Enforce Pro User Daily Rate Limit (Max 15 AI queries/day)
    quota_info = await cache_service.enforce_daily_pro_rate_limit(
        user_id=payload.user_id,
        subscription_tier=payload.subscription_tier,
    )

    genai_client = get_genai_client()
    db_pool: asyncpg.Pool = request.app.state.db_pool

    # Step 3: Fetch relevant WBPSC syllabus chunks via pgvector
    rag_context = await fetch_pgvector_syllabus_context(
        db_pool=db_pool,
        genai_client=genai_client,
        exam_slug=payload.exam_slug,
        topic_slug=payload.topic_slug,
        topic_title=payload.topic_title,
        language=payload.language,
    )

    lang_instruction = (
        "Write all explanations, headings, mnemonics, and MCQs in clear, standard academic Bengali (বাংলা) "
        "with accurate conjuncts (যুক্তাক্ষর), keeping essential constitutional/scientific terms in English parentheses where helpful."
        if payload.language == "bn"
        else "Write all explanations, headings, mnemonics, and MCQs in crisp, exam-oriented English tailored for WBPSC."
    )

    system_instruction = (
        "You are a Principal WBPSC (West Bengal Public Service Commission) Faculty & Exam Strategist "
        "specializing in WBCS, WBPSC Clerkship, Food SI, and Miscellaneous exams. "
        "Always prioritize factual accuracy, Constitutional Articles, Amendment years, West Bengal specific geography/history facts, "
        "and frequent WBPSC Prelims/Mains question traps."
    )

    user_prompt = f"""
Generate a high-yield, exam-focused revision sheet for:
- Exam: {payload.exam_slug}
- Subject: {payload.subject_name}
- Subtopic: {payload.topic_title} ({payload.topic_slug})
- Output Language: {payload.language.upper()}

Grounded WBPSC Syllabus Context (from pgvector):
{rag_context}

Requirements:
1. {lang_instruction}
2. In `content_markdown`, structure with:
   - **Core Concept & WBPSC Weightage**
   - **Key Facts / Articles / Chronology Table**
   - **Common WBPSC Exam Traps (বিভ্রান্তিকর তথ্য ও সতর্কতা)**
3. In `mnemonics`, provide 3 to 5 short, high-retention memory hooks or acrostics.
4. In `likely_mcqs`, generate EXACTLY 5 high-probability PYQ-style MCQs (with options A, B, C, D, `correct_option`, and detailed `explanation`).
"""

    model_to_use = payload.model_preference or GEMINI_NOTES_MODEL

    try:
        response = genai_client.models.generate_content(
            model=model_to_use,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.3,
                response_mime_type="application/json",
                response_schema=GeminiStudyNoteStructuredOutput,
            ),
        )

        if not response.text:
            raise ValueError("Empty response from Gemini model")

        parsed_output = GeminiStudyNoteStructuredOutput.model_validate_json(
            response.text
        )
    except Exception as exc:
        logger.exception("Gemini generate-notes call failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to generate study notes from AI service: {str(exc)}",
        ) from exc

    # Step 4: Persist in L2 PostgreSQL (`ai_notes_cache`) + L1 Redis
    saved_record = await cache_service.save_generated_note(
        exam_slug=payload.exam_slug,
        topic_slug=payload.topic_slug,
        language=payload.language,
        content_markdown=parsed_output.content_markdown,
        mnemonics=parsed_output.mnemonics,
        likely_mcqs=[mcq.model_dump() for mcq in parsed_output.likely_mcqs],
        model_used=model_to_use,
    )

    return {
        "status": "success",
        "cached": False,
        "quota": quota_info,
        "data": saved_record,
    }


# ============================================================================
# 2. POST /ai/evaluate-descriptive
# ============================================================================


@router.post("/evaluate-descriptive")
async def evaluate_descriptive_answer(
    cache_service: Annotated[ThreeTierCacheService, Depends(get_cache_service)],
    user_id: Annotated[str, Form(description="UUID of the authenticated student")],
    subscription_tier: Annotated[
        Literal["free", "pro_prelims", "wbcs_executive_pass"],
        Form(),
    ] = "pro_prelims",
    exam_slug: Annotated[
        Literal["wbpsc-clerkship-part2", "wbcs-mains"],
        Form(),
    ] = "wbpsc-clerkship-part2",
    task_type: Annotated[
        Literal["report_writing", "precis_writing", "translation", "essay"],
        Form(),
    ] = "report_writing",
    language: Annotated[Literal["en", "bn"], Form()] = "bn",
    question_prompt: Annotated[
        str,
        Form(description="The descriptive question or source passage for Précis/Translation"),
    ] = "",
    target_word_limit: Annotated[int, Form(ge=20, le=1000)] = 150,
    student_answer_text: Annotated[
        Optional[str],
        Form(description="Typed answer text (optional if answer_image is uploaded)"),
    ] = None,
    answer_image: Annotated[
        Optional[UploadFile],
        File(description="Photo/scan of handwritten WBPSC descriptive answer sheet (JPEG/PNG/WEBP)"),
    ] = None,
):
    """
    Evaluates WBPSC Clerkship Part-II or WBCS Mains descriptive answers
    (Bengali/English Report Writing, Précis Writing, or Translation) from either typed text
    or a photographed handwritten answer sheet using `gemini-2.5-flash`.
    """
    if not student_answer_text and not answer_image:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either `student_answer_text` or upload an `answer_image`.",
        )

    # Enforce daily Pro rate limit (max 15 AI queries/day)
    quota_info = await cache_service.enforce_daily_pro_rate_limit(
        user_id=user_id,
        subscription_tier=subscription_tier,
    )

    genai_client = get_genai_client()
    contents_parts: list[types.Part] = []

    if answer_image is not None:
        allowed_mimes = {"image/jpeg", "image/png", "image/webp"}
        content_type = answer_image.content_type or "image/jpeg"
        if content_type not in allowed_mimes:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Unsupported image type '{content_type}'. Use JPEG, PNG, or WEBP.",
            )
        image_bytes = await answer_image.read()
        if len(image_bytes) > 8 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Uploaded answer sheet image must be under 8 MB.",
            )
        contents_parts.append(
            types.Part.from_bytes(data=image_bytes, mime_type=content_type)
        )

    lang_label = "Bengali (বাংলা)" if language == "bn" else "English"

    eval_prompt = f"""
You are a Senior Head Examiner for the West Bengal Public Service Commission ({exam_slug.upper()}).
Evaluate the following student's descriptive response strictly according to official WBPSC Part-II / Mains marking standards.

- Task Type: {task_type}
- Target Language: {lang_label} ({language})
- Prescribed Word Limit: {target_word_limit} words (±10% tolerance)
- Question / Source Passage:
{question_prompt}

{"Student's Typed Answer:\n" + student_answer_text if student_answer_text else "Student's Answer: See the attached handwritten image. First transcribe the handwritten Bengali/English text accurately into `transcribed_student_answer`, then evaluate it."}

Scoring Rubric (Total = 25 Marks):
1. `grammar_score` (0 to 10): Syntax, tense consistency, spelling (বানান ও যুক্তাক্ষর নির্ভুলতা), punctuation, and formal register (সাধু/চলিত ভাষার মিশ্রণ বর্জন).
2. `content_score` (0 to 10):
   - For Report Writing (প্রতিবেদন রচনা): Catchy title, Correspondent/Place/Date dateline, neutral newspaper tone, factual coverage.
   - For Précis (সারাংশ/সারমর্ম): Own words (no direct copying), suitable title, core theme retention.
   - For Translation (বঙ্গানুবাদ / English Translation): Idiomatic sense translation rather than literal word-for-word translation.
3. `word_limit_score` (0 to 5): Deduct marks if significantly over or under {target_word_limit} words.
4. Provide actionable feedback in `{language}` and write a complete, top-scoring `corrected_model_answer` in `{language}` within {target_word_limit} words.
"""
    contents_parts.append(types.Part.from_text(text=eval_prompt))

    try:
        response = genai_client.models.generate_content(
            model=GEMINI_EVAL_MODEL,
            contents=contents_parts,
            config=types.GenerateContentConfig(
                temperature=0.2,
                response_mime_type="application/json",
                response_schema=DescriptiveEvaluationStructuredOutput,
            ),
        )

        if not response.text:
            raise ValueError("Empty evaluation response from Gemini")

        evaluation = DescriptiveEvaluationStructuredOutput.model_validate_json(
            response.text
        )
    except Exception as exc:
        logger.exception("Descriptive answer evaluation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI evaluation service error: {str(exc)}",
        ) from exc

    return {
        "status": "success",
        "model_used": GEMINI_EVAL_MODEL,
        "quota": quota_info,
        "evaluation": evaluation.model_dump(),
    }
