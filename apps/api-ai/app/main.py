"""
WBPSC AI Mock Test & Tutor — FastAPI Application Entrypoint
File: apps/api-ai/app/main.py
Stateless Google Cloud Run service listening on PORT=8080 (or local 8081).
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

import asyncpg
import redis.asyncio as redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.current_affairs import router as current_affairs_router
from app.routers.question_gen import ensure_question_cache_schema
from app.routers.question_gen import router as question_gen_router
from app.routers.tutor import router as tutor_router
from app.services.cache import ThreeTierCacheService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("wbpsc.api_ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql://wbpsc_admin:wbpsc_local_dev_2026@localhost:5432/wbpsc_prep",
    )
    redis_url = os.getenv(
        "REDIS_URL",
        "redis://:wbpsc_redis_local_2026@localhost:6379/0",
    )

    logger.info("Initializing asyncpg pool and Redis client for wbpsc-api-ai...")
    db_pool = await asyncpg.create_pool(
        dsn=database_url,
        min_size=1,
        max_size=int(os.getenv("DB_MAX_CONNECTIONS", "10")),
        command_timeout=30,
        statement_cache_size=0,  # Required for Supabase PgBouncer Transaction mode
    )
    redis_client = redis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=5,
    )

    cache_service = ThreeTierCacheService(
        redis_client=redis_client,
        db_pool=db_pool,
    )
    await cache_service.ensure_schema()
    await ensure_question_cache_schema(db_pool)

    app.state.db_pool = db_pool
    app.state.redis = redis_client
    app.state.cache_service = cache_service

    try:
        yield
    finally:
        logger.info("Shutting down wbpsc-api-ai: closing Redis and PostgreSQL connections...")
        await redis_client.aclose()
        await db_pool.close()


app = FastAPI(
    title="WBPSC AI Tutor, Descriptive Evaluator & Daily CA Service",
    version="1.0.0",
    lifespan=lifespan,
)

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://192.168.1.100:8081",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tutor_router)
app.include_router(current_affairs_router)
app.include_router(question_gen_router)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "wbpsc-api-ai",
        "port": int(os.getenv("PORT", "8080")),
    }
