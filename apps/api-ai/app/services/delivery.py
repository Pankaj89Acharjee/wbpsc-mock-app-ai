"""
WBPSC AI Mock Test & Tutor — Cloudflare R2, Telegram & WhatsApp Delivery Service
File: apps/api-ai/app/services/delivery.py

Responsibilities:
1. Upload generated Daily Current Affairs PDF bytes to Cloudflare R2 via `boto3` S3-compatible API.
2. Broadcast the daily PDF download link and bilingual highlights to the public Telegram Channel/Bot (free daily push).
3. Send personalized Meta WhatsApp Cloud API utility template notifications (`wbpsc_daily_ca_pdf`) to Pro users.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Sequence

import boto3
from botocore.config import Config as BotoConfig
import httpx

logger = logging.getLogger("wbpsc.api_ai.delivery")


class DeliveryService:
    """
    Handles cloud object storage (Cloudflare R2) and multi-channel notifications
    (Telegram Bot API + Meta WhatsApp Cloud API).
    """

    def __init__(self) -> None:
        # 1. Cloudflare R2 (S3-Compatible) Configuration
        self.r2_account_id = os.getenv("R2_ACCOUNT_ID", "")
        self.r2_access_key_id = os.getenv("R2_ACCESS_KEY_ID", "")
        self.r2_secret_access_key = os.getenv("R2_SECRET_ACCESS_KEY", "")
        self.r2_bucket_name = os.getenv("R2_BUCKET_NAME", "wbpsc-daily-pdfs")
        self.r2_public_base_url = os.getenv(
            "R2_PUBLIC_BASE_URL", "https://cdn.wbpsc-prep.in"
        ).rstrip("/")

        # 2. Telegram Bot / Channel Configuration (Free Daily Push)
        self.telegram_bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
        self.telegram_channel_id = os.getenv(
            "TELEGRAM_CHANNEL_ID", "@wbpsc_ai_prep_official"
        )

        # 3. Meta WhatsApp Cloud API Configuration (Pro Users Utility Template)
        self.whatsapp_access_token = os.getenv("WHATSAPP_CLOUD_ACCESS_TOKEN", "")
        self.whatsapp_phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
        self.whatsapp_template_name = os.getenv(
            "WHATSAPP_CA_TEMPLATE_NAME", "wbpsc_daily_current_affairs_pdf"
        )
        self.whatsapp_api_version = os.getenv("WHATSAPP_API_VERSION", "v21.0")

    def _get_r2_client(self):
        if not (
            self.r2_account_id
            and self.r2_access_key_id
            and self.r2_secret_access_key
        ):
            raise RuntimeError(
                "Cloudflare R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are missing."
            )

        endpoint_url = f"https://{self.r2_account_id}.r2.cloudflarestorage.com"
        return boto3.client(
            service_name="s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=self.r2_access_key_id,
            aws_secret_access_key=self.r2_secret_access_key,
            region_name="auto",
            config=BotoConfig(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    async def upload_pdf_to_r2(
        self,
        pdf_bytes: bytes,
        date_str: str,
    ) -> dict[str, Any]:
        """
        Uploads the compiled WeasyPrint PDF to Cloudflare R2 using `boto3` in a background thread
        and returns the public CDN URL and object key.
        """
        object_key = f"current-affairs/{date_str}/WBPSC_Daily_CA_{date_str}.pdf"

        def _sync_put_object() -> None:
            s3_client = self._get_r2_client()
            s3_client.put_object(
                Bucket=self.r2_bucket_name,
                Key=object_key,
                Body=pdf_bytes,
                ContentType="application/pdf",
                ContentDisposition=f'inline; filename="WBPSC_Daily_CA_{date_str}.pdf"',
                CacheControl="public, max-age=31536000, immutable",
            )

        await asyncio.to_thread(_sync_put_object)
        public_url = f"{self.r2_public_base_url}/{object_key}"

        logger.info(
            "Uploaded Daily Current Affairs PDF (%d bytes) to R2: %s",
            len(pdf_bytes),
            public_url,
        )
        return {
            "bucket": self.r2_bucket_name,
            "object_key": object_key,
            "public_url": public_url,
            "size_bytes": len(pdf_bytes),
        }

    async def broadcast_to_telegram_channel(
        self,
        date_display: str,
        pdf_url: str,
        headline_titles_bn: Sequence[str],
    ) -> dict[str, Any]:
        """
        Pushes the free daily Current Affairs PDF download link and top Bengali headlines
        to the public Telegram Channel via Telegram Bot API.
        """
        if not self.telegram_bot_token or not self.telegram_channel_id:
            logger.warning("Telegram credentials not configured; skipping Telegram push.")
            return {"sent": False, "reason": "TELEGRAM_CREDENTIALS_MISSING"}

        bullets = "\n".join(f"• {title}" for title in headline_titles_bn[:5])
        caption_html = (
            f"<b>📅 WBPSC দৈনিক কারেন্ট অ্যাফেয়ার্স ({date_display})</b>\n"
            f"<i>WBCS • Clerkship • Food SI • Miscellaneous</i>\n\n"
            f"<b>আজকের প্রধান শিরোনাম (Top Headlines):</b>\n"
            f"{bullets}\n\n"
            f"📥 <b>দ্বিভাষিক PDF ডাউনলোড করুন (Bilingual EN + BN + 5 PYQ MCQs):</b>\n"
            f"<a href=\"{pdf_url}\">👉 ডাউনলোড কারেন্ট অ্যাফেয়ার্স PDF ({date_display})</a>"
        )

        api_url = f"https://api.telegram.org/bot{self.telegram_bot_token}/sendMessage"
        payload = {
            "chat_id": self.telegram_channel_id,
            "text": caption_html,
            "parse_mode": "HTML",
            "disable_web_page_preview": False,
            "reply_markup": {
                "inline_keyboard": [
                    [
                        {
                            "text": "📄 Download Bilingual PDF (EN + বাংলা)",
                            "url": pdf_url,
                        }
                    ]
                ]
            },
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(api_url, json=payload)
            response.raise_for_status()
            data = response.json()

        return {
            "sent": True,
            "channel_id": self.telegram_channel_id,
            "message_id": data.get("result", {}).get("message_id"),
        }

    async def push_whatsapp_utility_to_pro_users(
        self,
        pro_recipients: Sequence[dict[str, str]],
        date_display: str,
        pdf_url: str,
        top_topic_summary_bn: str,
    ) -> dict[str, Any]:
        """
        Dispatches Meta WhatsApp Cloud API utility template messages with a native PDF document header
        to active Pro users (`subscription_tier IN ('pro_prelims', 'wbcs_executive_pass')`).

        Each item in `pro_recipients` has: `{"phone": "9198XXXXXXXX", "full_name": "..."}`
        """
        if not self.whatsapp_access_token or not self.whatsapp_phone_number_id:
            logger.warning("WhatsApp Cloud API credentials missing; skipping WhatsApp push.")
            return {
                "total_targeted": len(pro_recipients),
                "delivered": 0,
                "failed": 0,
                "reason": "WHATSAPP_CREDENTIALS_MISSING",
            }

        endpoint = (
            f"https://graph.facebook.com/{self.whatsapp_api_version}/"
            f"{self.whatsapp_phone_number_id}/messages"
        )
        headers = {
            "Authorization": f"Bearer {self.whatsapp_access_token}",
            "Content-Type": "application/json",
        }

        delivered_count = 0
        failed_count = 0

        # Concurrency semaphore to respect Meta Cloud API throughput limits
        semaphore = asyncio.Semaphore(10)

        async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:

            async def _send_single(recipient: dict[str, str]) -> None:
                nonlocal delivered_count, failed_count
                phone = recipient.get("phone", "").strip().lstrip("+")
                if not phone:
                    return
                student_name = recipient.get("full_name", "Aspirant")

                message_body = {
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": phone,
                    "type": "template",
                    "template": {
                        "name": self.whatsapp_template_name,
                        "language": {"code": "bn"},
                        "components": [
                            {
                                "type": "header",
                                "parameters": [
                                    {
                                        "type": "document",
                                        "document": {
                                            "link": pdf_url,
                                            "filename": f"WBPSC_Daily_CA_{date_display}.pdf",
                                        },
                                    }
                                ],
                            },
                            {
                                "type": "body",
                                "parameters": [
                                    {"type": "text", "text": student_name},
                                    {"type": "text", "text": date_display},
                                    {"type": "text", "text": top_topic_summary_bn[:120]},
                                ],
                            },
                        ],
                    },
                }

                async with semaphore:
                    try:
                        resp = await client.post(endpoint, json=message_body)
                        if resp.status_code in (200, 201):
                            delivered_count += 1
                        else:
                            failed_count += 1
                            logger.warning(
                                "WhatsApp send non-200 for %s: %s",
                                phone,
                                resp.text,
                            )
                    except Exception as exc:
                        failed_count += 1
                        logger.warning("WhatsApp send error for %s: %s", phone, exc)

            await asyncio.gather(*(_send_single(r) for r in pro_recipients))

        return {
            "total_targeted": len(pro_recipients),
            "delivered": delivered_count,
            "failed": failed_count,
        }
