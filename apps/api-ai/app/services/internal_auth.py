"""
Service-to-service auth for apps/api-ai.
api-ai is never called by browsers: apps/api-core authenticates the user and forwards
requests with `X-Internal-Token: <INTERNAL_SERVICE_TOKEN>`.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException, status


def verify_internal_token(token: str | None) -> None:
    expected = os.getenv("INTERNAL_SERVICE_TOKEN")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="INTERNAL_SERVICE_TOKEN is not configured on api-ai.",
        )
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Internal-Token header.",
        )


async def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    """FastAPI dependency form of `verify_internal_token`."""
    verify_internal_token(x_internal_token)
