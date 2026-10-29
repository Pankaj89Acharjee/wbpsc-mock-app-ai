# RAG Pipeline Implementation

This document explains how **Retrieval-Augmented Generation (RAG)**, **3-Tier Caching**, **Guardrails**, **Evaluations (Evals)**, and **Security** are implemented in the **WBPSC AI Mock Test & Tutor** platform. Every section includes a **"Behind the Scenes (Interview Explanation)"** breakdown in simple, everyday language so you can confidently explain the architecture in technical interviews.

---

## 1. Where RAG is Built (Exact Codebase Files)

Our RAG system is split across two backend microservices—the **Node.js Core API (`apps/api-core`)** and the **Python AI Service (`apps/api-ai`)**—and consumed by the **React Frontend (`src/`)**:

| File Path | Role in the RAG Pipeline |
| :--- | :--- |
| **`/apps/api-ai/app/routers/tutor.py`** | **Primary RAG Engine:** Generates query vector embeddings (`text-embedding-004`), performs `pgvector` cosine similarity search on `syllabus_chunks`, and calls Gemini (`gemini-3.1-flash-lite` / `gemini-2.5-flash`) to produce bilingual (`en`/`bn`) study notes, mnemonics, and 5 PYQ-style MCQs. Also handles Clerkship Part-II / WBCS Mains multimodal descriptive answer evaluation. |
| **`/apps/api-ai/app/services/cache.py`** | **3-Tier Cache & Quota Manager:** Implements `ThreeTierCacheService` (`L1 Redis` $\rightarrow$ `L2 PostgreSQL ai_notes_cache` $\rightarrow$ `L3 Gemini`), manages the `syllabus_chunks` (`vector(768)`) schema, and enforces the 15 queries/day Pro user rate limit. |
| **`/apps/api-ai/app/routers/question_gen.py`** | **PYQ-Clone Question RAG Pipeline:** Retrieves real WBPSC Previous Year Questions (PYQs) as few-shot context and existing question stems as negative constraints (`avoid_stems`) to generate non-duplicate bilingual MCQs. |
| **`/apps/api-core/src/routes/ai.ts`** | **Gateway & Syllabus Context Resolver:** Authenticates the student, fetches the exact Exam $\rightarrow$ Subject $\rightarrow$ Chapter $\rightarrow$ Subtopic hierarchy from PostgreSQL, checks cached notes, and forwards requests to `api-ai`. |
| **`/apps/api-core/src/lib/apiAi.ts`** | **Internal Service Bridge:** Sends authenticated server-to-server HTTP requests from `api-core` to `api-ai` using the `X-Internal-Token` header and handles timeouts/quota errors. |
| **`/apps/api-core/src/routes/adminQuestions.ts`** | **Retrieval & Deduplication for Question Bank:** Pulls existing subtopic PYQs and up to 150 existing stems from PostgreSQL to ground AI bulk question generation and stages output for admin review. |
| **`/src/components/WeaknessTutorTab.tsx`** | **Frontend RAG Consumer:** Displays the student's weak subtopics (`accuracy < 60%`) detected from SQL exam grading and triggers on-demand bilingual RAG study notes. |

---

## 2. Step-by-Step: How the RAG Pipeline Works Behind the Scenes

We run **two specialized RAG pipelines** in this project:

### Pipeline A: Student Weakness Tutor & Bilingual Study Note RAG (`tutor.py` + `cache.py`)

```text
[Student Clicks "Generate AI Notes" on a Weak Subtopic]
        │
        ▼
[Step 1: SHA-256 Cache Key Computed]  ──► Key: sha256("wbcs-prelims:73rd-amendment:bn")
        │
        ├─► [Tier 1: Redis Check] ────────► HIT? Return in <2ms (0 AI Cost)
        │         │ Miss
        ├─► [Tier 2: PostgreSQL Check] ───► HIT? Warm Redis & Return in ~10ms (0 AI Cost)
        │         │ Miss
        ▼
[Step 2: Redis Daily Quota Check] ────────► Free User? Block (403). >15/day? Block (429).
        │
        ▼
[Step 3: Query Embedding Generation] ─────► Gemini `text-embedding-004` converts topic into 768 floats
        │
        ▼
[Step 4: pgvector Cosine Search] ─────────► SQL searches `syllabus_chunks` via `1 - (embedding <=> $1::vector)`
        │                                   (Falls back to exact `topic_slug` match if no vectors exist yet)
        ▼
[Step 5: Augmented Prompt + Structured LLM Call]
        │   Injects retrieved WBPSC syllabus chunks + PYQ years into `gemini-3.1-flash-lite`
        ▼
[Step 6: Write-Back Cache] ───────────────► Saves permanently to PostgreSQL (`ai_notes_cache`) + Redis (30d TTL)
```

1. **Deterministic Weakness Detection First (No AI Used Here):**
   When a student submits a mock test, PostgreSQL (`attempts.ts`) grades it and updates `user_topic_mastery`. Any subtopic where `accuracy < 60%` is flagged as a weak area.
2. **3-Tier Cache Check (Zero-Waste AI):**
   When the student requests AI notes for that weak subtopic, `cache.py` normalizes `exam_slug:topic_slug:language` and hashes it with **SHA-256**. It checks **L1 Redis** first, then **L2 PostgreSQL (`ai_notes_cache`)**. If another student already generated notes for that subtopic earlier, it is served immediately with **zero Gemini API calls**.
3. **Vector Embedding & Semantic Retrieval (`pgvector`):**
   On a cache miss, `tutor.py` calls Google's `text-embedding-004` model to convert `"WBPSC {exam_slug} {topic_title} ({topic_slug})"` into a **768-dimensional vector**. It then queries PostgreSQL `syllabus_chunks` using the `pgvector` cosine distance operator (`<=>`) to retrieve the top 4 most relevant syllabus passages and PYQ year tags. If vector rows aren't populated for a newly created exam yet, it cleanly falls back to an exact `topic_slug` SQL lookup.
4. **Augmented Generation:**
   The retrieved syllabus chunks are injected into the Gemini prompt with strict instructions to act as a senior WBPSC faculty member and output a validated JSON object containing:
   * `content_markdown`: Exam-focused revision notes in English or Bengali (বাংলা).
   * `mnemonics`: 2 to 5 memory tricks/acrostics.
   * `likely_mcqs`: 5 PYQ-style practice questions with explanations.

---

### Pipeline B: Few-Shot PYQ-Grounded Question Bank RAG (`adminQuestions.ts` + `question_gen.py`)

When an Admin generates bulk questions for a test series or subtopic:
1. **Context Retrieval from DB:** `adminQuestions.ts` queries PostgreSQL for up to **8 real WBPSC PYQs** from that same subtopic (`examples`) and up to **150 existing question stems** already in the database (`avoid_stems`).
2. **Round-Aware Cache Key:** `question_gen.py` builds a cache key `qgen:{exam_slug}:{subtopic_slug}:{difficulty}:{count}:r{round}[:a{attempt}]`. Retrying a failed network call reuses the cache, while clicking "Generate Again" increments `round` to get brand-new questions.
3. **Grounded Generation & Deduplication:** Gemini uses the real PYQs to match the exact WBPSC difficulty/style while strictly avoiding all stems in `avoid_stems`. Every returned question is hashed (`normHash`) and checked against existing DB questions before staging.

---

## 3. Guardrails, Evals, and Security

### A. Guardrails (Preventing AI Hallucinations, Bad Data & Cost Spikes)
1. **Strict Structured JSON Output (`response_schema`):**
    Gemini is never allowed to return free-form text. We pass Pydantic schemas (`GeminiStudyNoteStructuredOutput`, `DescriptiveEvaluationStructuredOutput`, `GeneratedBatch`) with `response_mime_type="application/json"`. If the LLM misses a required field or option (`A, B, C, D`), Pydantic rejects it immediately.
2. **Human-in-the-Loop Staging Queue (`question_import_batches` & `question_import_items`):**
   AI-generated or bulk-uploaded questions **never go directly into live student exams**. They land in a staging table with automated status flags (`ready`, `needs_review`, `incomplete`, `duplicate`) and require Admin approval to publish.
3. **SHA-256 Stem Deduplication (`normHash`):**
   Before inserting questions, the backend strips punctuation/casing, computes a SHA-256 hash of the English stem, and blocks duplicates both within the uploaded batch and against the existing PostgreSQL question bank.
4. **Tier & Daily Quota Guardrails:**
   * Free-tier users cannot trigger fresh LLM calls (`403 PRO_SUBSCRIPTION_REQUIRED`), though they can read already-cached notes.
   * Pro users have an atomic Redis counter (`ai:ratelimit:{user_id}:{YYYY-MM-DD}`) capped at **15 fresh AI calls/day**, resetting automatically at midnight IST.
5. **Exam Capacity Guardrail:**
   If a Test Series is configured for `100` questions, the backend (`admin.ts`) strictly blocks adding or generating a 101st question (`400 Bad Request`).

---

### B. Evals (How Both Students and AI Output Are Evaluated)
1. **Deterministic SQL MCQ Evaluation (Zero AI Hallucination Risk):**
   * **File:** `/apps/api-core/src/routes/attempts.ts`
   * **What it does:** Mock tests are graded 100% deterministically in PostgreSQL inside a database transaction. It compares `selected_option` against `correct_option`, applies exact positive marks (`+1` or `+2`) and negative marking (`-0.25` or `-0.33`), calculates accuracy percentage, and updates `user_topic_mastery`.
2. **Multimodal AI Rubric Evaluation for Descriptive Answers:**
   * **File:** `/apps/api-ai/app/routers/tutor.py` (`POST /ai/evaluate-descriptive`)
   * **What it does:** Grades WBPSC Clerkship Part-II & WBCS Mains descriptive answers (typed text OR handwritten answer sheet photo via Vision OCR) on a **25-mark rubric**:
     * **Grammar, Spelling & Matra/Conjunct Accuracy:** `0 – 10 marks`
     * **Content Relevance & Official Format (Heading/Date/Place):** `0 – 10 marks`
     * **Word-Limit Adherence:** `0 – 5 marks`
     * Also outputs `transcribed_student_answer`, `strengths`, `improvements_needed`, and a `corrected_model_answer`.
3. **Self-Confidence Evaluation on Generated Questions:**
   * **File:** `/apps/api-ai/app/routers/question_gen.py`
   * **What it does:** For every AI-generated MCQ, the model must output a `confidence` score (`0.0` to `1.0`) indicating certainty that the marked option is factually indisputable. Any question with `confidence < 0.75` is automatically flagged as `needs_review` in the Admin staging queue.

---

### C. Security (Authentication, Authorization & Service Isolation)
1. **`scrypt` Password Hashing + Timing-Safe Comparison (`/apps/api-core/src/lib/auth.ts`):**
   Passwords are salted with 16 random bytes and hashed via Node's cryptographic `scrypt`, verified with `timingSafeEqual` to prevent timing attacks.
2. **`HttpOnly` HS256 JWT Session Cookies:**
   Sessions are stored in `HttpOnly; SameSite=Lax` cookies (`wbpsc_session`) signed with `HMAC-SHA256`, protecting tokens from XSS theft in the browser.
3. **Cryptographic Google OAuth Verification:**
   Google Sign-In ID tokens are verified server-side using RSA-SHA256 against Google's live public JWK certificates (`https://www.googleapis.com/oauth2/v3/certs`), checking `aud`, `iss`, and `exp`.
4. **Role-Based Access Control (RBAC) & Auto-Expiry Downgrade:**
   Middleware guards (`requireUser`, `requireEducatorOrAdmin`, `requireAdmin`) protect every route. On every session load (`loadSessionUser`), if `subscriptionExpiresAt <= NOW()`, the user is automatically downgraded to the `free` plan in PostgreSQL.
5. **Internal Microservice Isolation (`X-Internal-Token`):**
   `apps/api-ai` is never exposed to the public internet or browser. Only `apps/api-core` can call it using a shared secret verified via constant-time `hmac.compare_digest` (`internal_auth.py`).
6. **SQL Injection & File Upload Protection:**
   All SQL queries use parameterized bindings (`$1, $2` in `asyncpg` and Drizzle ORM prepared statements), and file uploads enforce strict MIME types (`application/pdf`, `image/png`, `image/jpeg`, `image/webp`) and byte size limits (`8 MB`–`15 MB`).

---

## 4. Glossary of Technical Terms: "What Happens Behind the Scenes" (Interview Guide)

Use these crisp explanations if an interviewer asks *"What does X actually do under the hood in your project?"*

### 1. **RAG (Retrieval-Augmented Generation)**
* **Simple meaning:** Instead of asking the AI to answer from memory (which can hallucinate or miss WBPSC-specific exam patterns), we **first search our own database** for trusted syllabus notes and past exam questions, paste those facts into the prompt, and ask the AI to write the answer using those facts.
* **Behind the scenes in our app:** Python fetches top syllabus rows from PostgreSQL (`syllabus_chunks`) and injects them into the Gemini prompt before generating study notes.

### 2. **Vector Embedding (`text-embedding-004` / `vector(768)`)**
* **Simple meaning:** Computers cannot compare the *meaning* of two sentences using normal text search (e.g., *"Panchayati Raj"* vs *"73rd Constitutional Amendment"* have zero words in common, but mean the same thing). An **embedding model** converts any piece of text into a list of **768 numbers (a vector)** representing its meaning in coordinates.
* **Behind the scenes in our app:** When a topic is queried, `text-embedding-004` turns the topic title into `[0.014, -0.231, ... 768 numbers]`. Topics with similar meanings end up with very similar numbers.

### 3. **`pgvector` & Cosine Similarity (`<=>`)**
* **Simple meaning:** `pgvector` is an extension inside PostgreSQL that lets us store those 768 numbers in a regular database column and measure the angle between two vectors (**Cosine Distance**, written as `<=>` in SQL).
* **Behind the scenes in our app:** PostgreSQL runs `SELECT title, chunk_text, 1 - (embedding <=> $1::vector) AS similarity FROM syllabus_chunks ORDER BY embedding <=> $1::vector LIMIT 4`. The smaller the angle between the student's topic vector and the stored syllabus vector, the closer `similarity` is to `1.0` (100% match). This lets us keep vectors and relational data in **one single PostgreSQL database** without paying for a separate vector DB like Pinecone.

### 4. **3-Tier Caching (`L1 Redis` $\rightarrow$ `L2 PostgreSQL` $\rightarrow$ `L3 Gemini`)**
* **Simple meaning:** Calling an LLM costs money and takes 3–6 seconds. Since 10,000 WBPSC aspirants study the exact same syllabus topics (e.g., *Permanent Settlement of 1793*), generating the same note 10,000 times is wasteful.
* **Behind the scenes in our app:**
  1. **Canonical Hashing:** We combine `exam_slug:topic_slug:language` and run `SHA-256` to get a unique 64-character fingerprint (`topic_hash`).
  2. **L1 Redis (RAM Cache):** Checked first. Takes `< 2 milliseconds`. Holds hot notes for 30 days.
  3. **L2 PostgreSQL (`ai_notes_cache` Disk Table):** Checked if Redis evicted the key or restarted. Takes `~10 milliseconds`. Stores the note **permanently** and re-warms Redis automatically.
  4. **L3 Gemini LLM:** Called **only once** on the very first miss, then saved into L2 and L1 so every future student gets it for free.

### 5. **Structured Outputs (`response_schema` + Pydantic)**
* **Simple meaning:** Normally, LLMs reply with conversational paragraphs that break frontend UI code if a heading or bullet is slightly off. **Structured Output** forces the LLM's token sampler at decoding time to only output tokens that match a strict JSON blueprint.
* **Behind the scenes in our app:** We define Python `Pydantic` classes (`GeminiStudyNoteStructuredOutput`) and pass them to `types.GenerateContentConfig(response_mime_type="application/json", response_schema=...)`. Gemini is mathematically constrained to return valid JSON with exact keys (`content_markdown`, `mnemonics`, `likely_mcqs`).

### 6. **Few-Shot Prompting & Negative Constraints (`avoid_stems`)**
* **Simple meaning:** **Few-shot prompting** means giving the AI 3–8 real examples of what a good output looks like before asking it to create new ones. **Negative constraints** mean giving it a list of items it is forbidden to repeat.
* **Behind the scenes in our app:** In `adminQuestions.ts` and `question_gen.py`, we pull up to 8 real WBPSC Previous Year Questions from PostgreSQL (`examples`) so Gemini copies the exact exam tone, and pass up to 150 existing question stems (`avoid_stems`) so it never generates duplicate questions.

### 7. **Atomic Redis Pipeline Rate Limiting (`INCR` + `TTL`)**
* **Simple meaning:** If a user clicks "Generate" 5 times in the same millisecond, normal database checks might let all 5 through (a race condition). Redis executes commands **atomically** (one by one in RAM).
* **Behind the scenes in our app:** In `cache.py`, we open a Redis transaction pipeline (`pipe.incr(redis_key)` + `pipe.ttl(redis_key)`) keyed by `ai:ratelimit:{user_id}:{YYYY-MM-DD}`. If the counter exceeds `15`, we immediately throw `HTTP 429 Too Many Requests`, and set the key to expire automatically at midnight IST (`Asia/Kolkata`).

### 8. **Constant-Time HMAC / Token Verification (`timingSafeEqual` / `hmac.compare_digest`)**
* **Simple meaning:** If you check a secret password or token with normal `==`, the computer checks character by character from left to right and stops as soon as one letter is wrong. Hackers can measure how many nanoseconds the server took to reject the request and guess the secret letter by letter (a **Timing Attack**).
* **Behind the scenes in our app:** Both `auth.ts` (`timingSafeEqual`) and `internal_auth.py` (`hmac.compare_digest`) always compare every single byte in the exact same amount of time, making timing attacks impossible.

### 9. **Multimodal Vision OCR Evaluation**
* **Simple meaning:** Instead of chaining an old OCR tool (like Tesseract, which struggles with handwritten Bengali matras/conjuncts) into a separate text grader, a **multimodal model** reads the raw image pixels and evaluates the writing in a single pass.
* **Behind the scenes in our app:** In `/ai/evaluate-descriptive`, when a student uploads a photo of their handwritten Clerkship Part-II answer sheet, we pass the raw image bytes via `types.Part.from_bytes(data=image_bytes, mime_type=...)` directly to `gemini-2.5-flash`. It transcribes the Bengali/English handwriting and grades Grammar, Content, and Word Limit in one unified step.
