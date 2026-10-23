---
trigger: always_on
description: Master architecture, React Native Expo + Next.js Web rules, bilingual Bengali/English standards, and Google AI Studio / Cloud Run setup.
---

# WBPSC AI Mock Test & Tutor — Master Agent Rules

## 1. Hardware & Local Development Constraints (CRITICAL)
- **Developer PC:** Intel Core i5-9400F, 8GB RAM, 2GB GPU.
- **Strict No-Emulator Rule:** NEVER run Android Studio Virtual Devices (AVD) or heavy local Docker builds all at once.
- **Mobile Testing:** Test `apps/mobile` (React Native Expo) exclusively on the physical **Vivo X200 FE** device using **Expo Go** over local Wi-Fi (`npx expo start --lan`).
- **Database in Dev:** Run only lightweight `postgres` (`pgvector`) and `redis` containers locally, or connect directly to a free cloud **Supabase PostgreSQL** + **Upstash Redis** instance to save local RAM.

## 2. Monorepo Tech Stack (No PWA — Native Android + Next.js Web)
- `apps/mobile`: **React Native (Expo SDK 52+, Expo Router, TypeScript, NativeWind v4)** — compiles to Android `.apk` / `.aab` via EAS Build.
- `apps/web`: **Next.js 15 (App Router, TypeScript, Tailwind CSS)** — standard responsive Web App for desktop and mobile browser users.
- `apps/api-core`: **Node.js 22 (Fastify + TypeScript + Drizzle ORM)** — handles JWT Auth, Mock Test Engine, Deterministic SQL Grading, Weakness Analytics, and Razorpay Webhooks.
- `apps/api-ai`: **Python 3.12 (FastAPI + Google GenAI SDK `google-genai`)** — connects to Google AI Studio (`GEMINI_API_KEY`) for cached RAG Note Generation, Clerkship Part-II Descriptive Answer Evaluation, and Automated Daily Current Affairs PDF creation (`WeasyPrint`).
- `packages/shared-types`: Shared TypeScript interfaces and `zod` validation schemas imported by `mobile`, `web`, and `api-core`.

## 3. Bilingual (Bengali + English) Mandate
- All MCQs, options, explanations, and AI study notes MUST support both English (`en`) and Bengali (`bn`).
- Store bilingual fields in PostgreSQL as `JSONB`: `{"en": "...", "bn": "..."}`.
- Use `Noto Sans Bengali` / `Hind Siliguri` in React Native, Next.js, and WeasyPrint HTML templates so Bengali conjuncts (যুক্তাক্ষর) render cleanly.

## 4. Zero-Waste AI & Cost Rules
- **Never use AI for MCQ evaluation:** Grade tests and identify weak sub-topics strictly via PostgreSQL queries in `apps/api-core`.
- **Mandatory 3-Tier Cache:** In `apps/api-ai`, before calling Google AI Studio, compute an MD5/SHA256 cache key (`exam_slug:topic_slug:lang`) and check Redis/PostgreSQL. Only call `gemini-3.1-flash-lite` or `gemini-2.5-flash` on a cache miss, then save the result permanently.
- **Cloud Run Ready:** Both `apps/api-core` and `apps/api-ai` must be stateless, read port from `process.env.PORT` (default `8080` for Cloud Run), and close DB connections cleanly.