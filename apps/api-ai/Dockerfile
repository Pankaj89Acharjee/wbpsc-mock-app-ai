# ============================================================================
# WBPSC AI Mock Test & Tutor — apps/api-ai Dockerfile
# Runtime: Python 3.12 Slim (Debian Bookworm) + WeasyPrint + Noto Sans Bengali
# Target: Google Cloud Run Stateless Container (PORT=8080)
# ============================================================================
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

WORKDIR /app

# Install Debian system dependencies for WeasyPrint (Pango, Cairo, HarfBuzz, GDK-PixBuf)
# and Noto Sans Bengali / Devanagari / Latin fonts (`fonts-noto-core`, `fonts-noto-extra`)
# so Bengali conjuncts (যুক্তাক্ষর) and Inter render cleanly in generated PDFs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libpangocairo-1.0-0 \
    libharfbuzz0b \
    libharfbuzz-subset0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    fontconfig \
    fonts-noto-core \
    fonts-noto-extra \
    && fc-cache -fv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for Google Cloud Run security
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup --create-home appuser

# Install Python packages (FastAPI, google-genai, WeasyPrint, Jinja2, boto3, httpx)
COPY apps/api-ai/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and HTML templates
COPY --chown=appuser:appgroup apps/api-ai/app ./app

USER appuser

EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers"]
