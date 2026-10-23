"""
WBPSC AI Mock Test & Tutor — Automated 5:00 AM IST Daily Current Affairs PDF Router
File: apps/api-ai/app/routers/current_affairs.py

Endpoint:
- POST /cron/generate-daily-ca
  * Protected by `X-Cron-Secret` header (`CRON_SECRET` env var) for Google Cloud Scheduler (5:00 AM IST).
  * Summarizes top National & West Bengal news items via Gemini (`google-genai` SDK) into
    structured bilingual (`en` + `bn`) exam bullet points + 5 daily Current Affairs MCQs.
  * Renders `app/templates/daily_ca.html` and compiles a high-resolution PDF via `WeasyPrint`.
  * Uploads the PDF to Cloudflare R2 (`boto3`), pushes the free link to the Telegram Channel,
    and dispatches Meta WhatsApp Cloud API utility templates to active Pro subscribers.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
import hmac
import logging
import os
from pathlib import Path
from typing import Annotated, Literal, Optional
from zoneinfo import ZoneInfo

import asyncpg
from fastapi import APIRouter, Header, HTTPException, Request, status
from google import genai
from google.genai import types
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel, Field
import weasyprint

from app.services.delivery import DeliveryService

logger = logging.getLogger("wbpsc.api_ai.current_affairs")

IST_TZ = ZoneInfo("Asia/Kolkata")
TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)

router = APIRouter(prefix="/cron", tags=["Automated Daily Current Affairs Cron"])


# ============================================================================
# Pydantic Schemas for Input & Structured Gemini Bilingual Digest
# ============================================================================


class BilingualTextModel(BaseModel):
    en: str = Field(..., min_length=1)
    bn: str = Field(..., min_length=1)


class RawNewsInputItem(BaseModel):
    title: str = Field(..., description="Headline of the news item")
    summary: str = Field(..., description="Raw article summary or PIB/State press release")
    source: str = Field(default="PIB / West Bengal I&CA")
    is_west_bengal_news: bool = Field(default=False)


class GenerateDailyCAPayload(BaseModel):
    edition_date: Optional[str] = Field(
        default=None,
        description="Edition date in YYYY-MM-DD (defaults to today in IST)",
    )
    news_items: list[RawNewsInputItem] = Field(
        ...,
        min_length=1,
        max_length=15,
        description="Top National and West Bengal news items to synthesize",
    )
    dispatch_notifications: bool = Field(
        default=True,
        description="Whether to broadcast to Telegram & WhatsApp after R2 upload",
    )


class NewsCapsuleItem(BaseModel):
    category: str = Field(
        ..., description="e.g., 'Polity & Governance', 'Economy', 'Science & Tech', 'West Bengal State Affairs'"
    )
    is_west_bengal_focus: bool
    wbpsc_syllabus_tag: str = Field(
        ..., description="e.g., 'WBCS Prelims: Current Events & WB Geography'"
    )
    headline: BilingualTextModel
    exam_bullets_en: list[str] = Field(
        ..., min_length=2, max_length=4, description="Crisp exam-focused English bullet points"
    )
    exam_bullets_bn: list[str] = Field(
        ..., min_length=2, max_length=4, description="Crisp exam-focused Bengali (বাংলা) bullet points"
    )
    static_gk_link: BilingualTextModel = Field(
        ...,
        description="Connected WBPSC Static GK fact (Article number, HQ, Governor, National Park, Year)",
    )


class DailyCAMCQOptions(BaseModel):
    A: BilingualTextModel
    B: BilingualTextModel
    C: BilingualTextModel
    D: BilingualTextModel


class DailyCAMCQItem(BaseModel):
    stem: BilingualTextModel
    options: DailyCAMCQOptions
    correct_option: Literal["A", "B", "C", "D"]
    explanation: BilingualTextModel


class DailyCurrentAffairsStructuredDigest(BaseModel):
    news_capsules: list[NewsCapsuleItem] = Field(..., min_length=1, max_length=12)
    daily_mcqs: list[DailyCAMCQItem] = Field(
        ...,
        min_length=5,
        max_length=5,
        description="Exactly 5 bilingual PYQ-style daily Current Affairs MCQs",
    )


# ============================================================================
# Security Dependency: Verify CRON_SECRET Header
# ============================================================================


def verify_cron_secret(
    x_cron_secret: Annotated[Optional[str], Header(alias="X-Cron-Secret")] = None,
) -> None:
    expected_secret = os.getenv("CRON_SECRET", "")
    if not expected_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CRON_SECRET is not configured on the server.",
        )
    if not x_cron_secret or not hmac.compare_digest(x_cron_secret, expected_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Cron-Secret header.",
        )


# ============================================================================
# Helper: Render HTML to PDF via WeasyPrint
# ============================================================================


def compile_daily_ca_pdf_sync(
    edition_date: str,
    digest: DailyCurrentAffairsStructuredDigest,
) -> bytes:
    template = jinja_env.get_template("daily_ca.html")
    rendered_html = template.render(
        edition_date=edition_date,
        digest=digest.model_dump(),
    )
    pdf_bytes = weasyprint.HTML(
        string=rendered_html,
        base_url=str(TEMPLATES_DIR),
    ).write_pdf()
    return pdf_bytes


# ============================================================================
# Endpoint: POST /cron/generate-daily-ca (5:00 AM IST Cloud Scheduler)
# ============================================================================


@router.post("/generate-daily-ca")
async def generate_daily_current_affairs_pdf(
    payload: GenerateDailyCAPayload,
    request: Request,
    x_cron_secret: Annotated[Optional[str], Header(alias="X-Cron-Secret")] = None,
):
    """
    Triggered daily at 5:00 AM IST by Google Cloud Scheduler:
    1. Verifies `X-Cron-Secret` header.
    2. Summarizes National + West Bengal news items via Gemini into bilingual (`en` + `bn`)
       exam bullet points + 5 bilingual Current Affairs MCQs.
    3. Compiles `daily_ca.html` into a print-ready PDF using `WeasyPrint` (`Noto Sans Bengali` + `Inter`).
    4. Uploads PDF to Cloudflare R2 (`boto3`) and dispatches links to Telegram Channel + Meta WhatsApp Cloud API.
    """
    verify_cron_secret(x_cron_secret)

    edition_date = payload.edition_date or datetime.now(IST_TZ).strftime("%Y-%m-%d")
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY is not configured.",
        )

    genai_client = genai.Client(api_key=api_key)
    model_name = os.getenv("GEMINI_PRIMARY_MODEL", "gemini-3.1-flash-lite")

    formatted_news = "\n\n".join(
        f"[{idx}] {'[WEST BENGAL]' if item.is_west_bengal_news else '[NATIONAL/INTL]'} "
        f"Title: {item.title}\nSource: {item.source}\nSummary: {item.summary}"
        for idx, item in enumerate(payload.news_items, start=1)
    )

    system_instruction = (
        "You are the Chief Editor for a premier WBPSC (WBCS, Clerkship, Food SI, Miscellaneous) "
        "Current Affairs publication in Kolkata. Convert raw daily news into high-yield bilingual "
        "(English + Bengali / বাংলা) exam bullet points, connect each item to relevant Static GK "
        "(Constitutional Articles, West Bengal districts, headquarters, historical facts), and craft "
        "5 high-probability bilingual Current Affairs MCQs."
    )

    prompt = f"""
Edition Date: {edition_date}

Raw National & West Bengal News Items:
{formatted_news}

Instructions:
1. Synthesize each news item into a structured `NewsCapsuleItem` with both English (`exam_bullets_en`) and natural academic Bengali (`exam_bullets_bn`) bullet points.
2. Mark `is_west_bengal_focus = true` for any news related to West Bengal state schemes, Kolkata events, GI tags, state appointments, or Bengal geography/culture.
3. Generate EXACTLY 5 bilingual (`en` and `bn`) PYQ-style MCQs in `daily_mcqs` testing factual details from today's news and linked static GK.
"""

    try:
        response = genai_client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.25,
                response_mime_type="application/json",
                response_schema=DailyCurrentAffairsStructuredDigest,
            ),
        )
        if not response.text:
            raise ValueError("Empty response from Gemini")

        digest = DailyCurrentAffairsStructuredDigest.model_validate_json(
            response.text
        )
    except Exception as exc:
        logger.exception("Failed to synthesize Daily Current Affairs via Gemini: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gemini Current Affairs synthesis failed: {str(exc)}",
        ) from exc

    # Step 2: Compile HTML -> PDF via WeasyPrint in a worker thread
    try:
        pdf_bytes = await asyncio.to_thread(
            compile_daily_ca_pdf_sync,
            edition_date,
            digest,
        )
    except Exception as exc:
        logger.exception("WeasyPrint PDF compilation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"WeasyPrint PDF rendering failed: {str(exc)}",
        ) from exc

    # Step 3: Upload PDF to Cloudflare R2 and dispatch notifications
    delivery_service = DeliveryService()
    r2_result = await delivery_service.upload_pdf_to_r2(
        pdf_bytes=pdf_bytes,
        date_str=edition_date,
    )
    pdf_public_url = r2_result["public_url"]

    telegram_result: dict = {"sent": False, "reason": "DISPATCH_DISABLED"}
    whatsapp_result: dict = {"delivered": 0, "reason": "DISPATCH_DISABLED"}

    if payload.dispatch_notifications:
        headlines_bn = [c.headline.bn for c in digest.news_capsules]
        top_summary_bn = headlines_bn[0] if headlines_bn else "আজকের প্রধান কারেন্ট অ্যাফেয়ার্স"

        # Fetch active Pro users with verified phone numbers from PostgreSQL
        pro_recipients: list[dict[str, str]] = []
        db_pool: Optional[asyncpg.Pool] = getattr(request.app.state, "db_pool", None)
        if db_pool is not None:
            try:
                async with db_pool.acquire() as conn:
                    rows = await conn.fetch(
                        """
                        SELECT phone, full_name
                        FROM users
                        WHERE is_active = TRUE
                          AND phone IS NOT NULL
                          AND subscription_tier IN ('pro_prelims', 'wbcs_executive_pass')
                          AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())
                        """
                    )
                    pro_recipients = [
                        {"phone": r["phone"], "full_name": r["full_name"]}
                        for r in rows
                        if r["phone"]
                    ]
            except Exception as exc:
                logger.warning("Could not query Pro users for WhatsApp push: %s", exc)

        telegram_result, whatsapp_result = await asyncio.gather(
            delivery_service.broadcast_to_telegram_channel(
                date_display=edition_date,
                pdf_url=pdf_public_url,
                headline_titles_bn=headlines_bn,
            ),
            delivery_service.push_whatsapp_utility_to_pro_users(
                pro_recipients=pro_recipients,
                date_display=edition_date,
                pdf_url=pdf_public_url,
                top_topic_summary_bn=top_summary_bn,
            ),
        )

    return {
        "status": "success",
        "edition_date": edition_date,
        "model_used": model_name,
        "capsules_count": len(digest.news_capsules),
        "mcqs_count": len(digest.daily_mcqs),
        "r2_storage": r2_result,
        "telegram_broadcast": telegram_result,
        "whatsapp_pro_push": whatsapp_result,
    }
