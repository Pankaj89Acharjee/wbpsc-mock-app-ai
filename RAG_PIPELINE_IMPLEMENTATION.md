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

---

## 5. Scaling to 1,000,000+ Questions in the Question Bank (Architecture Guide)

When the Question Bank grows to **1,000,000+ MCQs**, a human Admin cannot manually browse or tick checkboxes to assemble a 100-question WBPSC Clerkship or 200-question WBCS Prelims Test Series. Even a naive `ORDER BY RANDOM() LIMIT 100` in PostgreSQL will perform a full sequential scan and disk sort over 1M rows (taking several seconds per query and producing unbalanced papers).

Here is the production-grade **4-Layer Hybrid Selection & Deduplication Architecture** to assemble test series and search across 1M+ questions in `< 25 ms`:

### A. Deterministic Stratified Blueprint Sampling (Primary Test Assembly Engine)
Instead of manual picking, the Admin defines an **Exam Blueprint Rule** (e.g., *Total = 100 Qs | History: 15, Polity: 10, Geography: 15, Arithmetic: 30, English: 30 | Difficulty Mix: 30% Easy, 50% Medium, 20% Hard | Min 25% PYQs*).
* **How it works in PostgreSQL:**
  1. Partition the blueprint into `(subject_id, difficulty, is_pyq)` buckets.
  2. Exclude questions already used in recent sibling Test Series (`NOT EXISTS (SELECT 1 FROM mock_series_questions msq WHERE ...)`).
  3. Use a **Composite B-Tree Index** on `(exam_id, subject, difficulty, is_active, id)` paired with `TABLESAMPLE SYSTEM_ROWS` or indexed random key-range jumping rather than `ORDER BY RANDOM()`.
* **Why deterministic matching wins here:** Exam rules (exact subject quota, exact difficulty ratio, zero overlap with Series #1–#10) are hard constraints that must be 100% deterministic.

### B. Hybrid Search for Admin Curated Selection (Deterministic Filter + Fuzzy Trigram + Vector Semantic Search)
When an Admin wants to search 1M questions for a specific theme (e.g., *"Viceroys who passed Press Acts"* or a Bengali phrase with slight spelling variations):
1. **Stage 1 — Deterministic Metadata Pre-Filter (B-Tree / GIN Index):**
   Filters 1,000,000 rows down to ~15,000 rows instantly using `WHERE exam_id = $1 AND subject = $2 AND difficulty = $3`.
2. **Stage 2 — Fuzzy Lexical Matching (`pg_trgm` Trigram GIN Index):**
   Handles typos, transliteration differences (*"Chittaranjan"* vs *"Chitta Ranjan"*), and near-duplicate stem detection using PostgreSQL's `pg_trgm` extension (`question_text->>'en' % $query` and `similarity(stem, $query) > 0.35`).
   * Also used at **ingestion time** to block duplicate questions before they enter the 1M bank (`similarity > 0.85` = auto-flag as duplicate).
3. **Stage 3 — Semantic Vector Matching (`pgvector` HNSW Index):**
   Matches conceptual queries even when exact words differ (e.g., searching *"Montagu-Chelmsford Reforms"* automatically finds questions phrased as *"Government of India Act 1919 Dyarchy"*).
   * At 1M rows, use an **HNSW (`Hierarchical Navigable Small World`) index** (`CREATE INDEX ON questions USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`), which searches 1,000,000 vectors in `< 15 ms` with >98% recall.
4. **Stage 4 — Reciprocal Rank Fusion (RRF):**
   Combines the Trigram Fuzzy score + Vector Semantic score + Historical Discrimination Index (how well the question separates top scorers from low scorers) to pick the top $K$ questions.

---

## 6. AI Agents & Agentic Workflows (Current State vs. Next-Gen Agents)

### Current State in the Codebase
Right now, the application uses **Single-Turn Structured LLM Pipelines & RAG Workflows** (not autonomous multi-step agents):
* **Weakness Tutor (`rag.py`):** Deterministic SQL finds weak subtopics $\rightarrow$ 3-tier cache check $\rightarrow$ `pgvector` retrieval $\rightarrow$ single structured Gemini call.
* **Media OCR & Bilingual Ingestion (`aiEnrichment.ts`):** Multimodal Gemini extracts MCQs from PDF/Images and translates `BN` $\leftrightarrow$ `EN` with a verification pass.
* **Exam-Oriented Revision Notes (`revisionNotes.ts`):** Admin triggers structured note + visual diagram card + 30-MCQ synthesis.

### Why & How to Introduce True AI Agents (Tool-Using, Multi-Step Loop)
In an interview, explain that an **AI Agent** differs from a standard LLM call because it has **1) A Goal, 2) Tools (SQL queries, Web Search, Python code execution), 3) Memory/State, and 4) A Self-Reflection / Verification Loop**.

Here are the **5 High-Impact Agents** to introduce into the WBPSC platform:

1. **Autonomous Question Bank Auditor & Fact-Critic Agent**:
Runs a multi-step loop over newly uploaded PDFs: checks `pg_trgm` + `pgvector` for duplicates, verifies historical dates/articles/amendments via a Critic step, fixes broken options, and promotes verified questions to `Live`.

2. **Autonomous Paper Setter (Blueprint Architect) Agent**:
Takes a natural-language Admin goal (*"Build a hard WBCS Prelims mock test weighted toward 2023–25 PYQ trends"*), queries PostgreSQL subject pools, samples questions, checks subtopic diversity so no single subtopic dominates, and fills any syllabus gap automatically.

3. **Adaptive 7-Day Study Planner & Socratic Coach Agent**:
Triggered after a mock test submission; inspects the student's weak subtopics via SQL, schedules daily revision targets from `Exam-Oriented Notes`, and quizzes the student conversationally until mastery crosses.

4. **Daily Current Affairs Web-Scout & Syllabus-Mapper Agent**:
Uses Google Search Grounding to fetch daily West Bengal & National news, filters out non-exam noise, maps each event to static WBPSC syllabus topics, and generates bilingual MCQs.

5. **Clerkship Part-II Multi-Agent Rubric Grader:**
Splits descriptive grading into 3 specialized sub-agents (**Grammar & Orthography Agent, Content & Structure Agent, and Deterministic Word-Count / Chief Examiner Aggregator**) for higher grading reliability on Bengali/English essays, precis, and translations.

| Agent Name | Role & Goal | Tools Used by the Agent | Self-Correction / Critic Loop |
| :--- | :--- | :--- | :--- |
| **1. Autonomous Question Bank Auditor & Deduplicator Agent** | Continuously audits newly uploaded PDFs/questions for factual accuracy, syllabus drift, and duplicates. | `search_similar_questions_pgvector`, `check_trigram_duplicate`, `verify_historical_date_fact`, `update_question_status` | **Fact-Critic Step:** If an extracted MCQ claims *"Lord Curzon partitioned Bengal in 1906"*, the Critic Agent flags the year error (`1905`), rewrites the explanation, and marks it for Admin review. |
| **2. Adaptive Study Planner & Socratic Coach Agent** | Creates a personalized 7-day revision schedule after every mock test and quizzes the student interactively on weak subtopics. | `get_student_weak_subtopics_sql`, `fetch_revision_note`, `schedule_remedial_quiz`, `record_subtopic_mastery` | Monitors if accuracy on a weak topic (e.g., *Viceroys*) improves from `<40%` to `>75%` across 2 remedial sets before marking the goal complete. |
| **3. Autonomous Paper Setter (Blueprint Architect) Agent** | Builds a balanced 100/200-question Mock Test Series from a 1M question bank from a natural-language Admin prompt (*"Create a high-difficulty Clerkship Mock focusing on 2024–25 pattern"*). | `query_question_distribution_sql`, `sample_stratified_questions`, `generate_missing_subtopic_mcqs`, `validate_paper_balance` | Checks if any subtopic is over-represented (e.g., 8 questions on the same Viceroy) and swaps redundant items automatically until the paper passes diversity constraints. |
| **4. Daily Current Affairs Web-Scout & Exam-Mapper Agent** | Runs on a daily cron schedule, gathers West Bengal & National current events, maps each news item to static WBPSC syllabus topics, and drafts bilingual MCQs + PDF digests. | `google_search_grounding`, `map_to_wbpsc_syllabus_vector`, `generate_bilingual_ca_mcqs`, `compile_pdf_digest` | Filters out non-exam gossip/politics and retains only exam-relevant appointments, GI tags, awards, schemes, and constitutional updates. |
| **5. Clerkship Part-II Multi-Agent Rubric Grader** | Uses a 3-agent panel (**Grammar Agent**, **Content & Structure Agent**, **Chief Examiner Aggregator**) to grade descriptive Bengali/English essays, precis, and translations. | `ocr_handwriting_vision`, `count_precis_words_deterministic`, `lookup_idiom_dictionary` | Uses deterministic word-count math (instead of LLM token guessing) for the 1/3rd Precis rule and reconciles score variance between sub-graders. |

---

## 7. Current Affairs 5-Agent System, Continuous Batch Backfilling & PSCWB Exam Orientation

*(See the dedicated [`/CURRENT_AFFAIRS_AGENTS.md`](./CURRENT_AFFAIRS_AGENTS.md) document for full architectural diagrams and implementation details.)*

The **Current Affairs & 1-Year Clerkship Archive** module (`/apps/api-core/src/routes/currentAffairs.ts` + `/src/components/DailyCurrentAffairsTab.tsx`) operates as a **5-Agent Pipeline** (**4 Actionable Orchestrator Agents** with UI Management Controls + **1 Automatic Internal Sub-Agent**):

### 1. **Daily Automatic 12-Topic Collector Agent (`runAutonomousCurrentAffairsAgent` + Scheduler)**
* **What it does:** Runs automatically every day for `Today` (`todayIso`). Scrapes live current affairs text from **GKToday (`https://www.gktoday.in/current-affairs/`)** and **PYQArena / The Hindu**, and enables Gemini's `tools: [{ googleSearch: {} }]` grounding to verify facts against **PIB** and **West Bengal State Gazette**.
* **UI Management Controls:** Card 1 in the Agent Console allows pausing/resuming the daily auto-run or forcing a 1-click refresh for Today.

### 2. **Month-Wise Batch Historical Backfill Agent (`POST /api/v1/current-affairs/auto-backfill` + `seedFullYearClerkshipArchive`)**
* **What it does:** Solves both missing/scattered past dates and memory limits when populating a full year of daily Current Affairs:
  1. **October 2026 Continuous 31-Day Coverage:** Automatically populates all **31 days of October 2026 (`2026-10-01` through `2026-10-31`, including `27 October 2026`)** with zero gaps.
  2. **All 12 Past Months (`Nov 2025 – Oct 2026`) Upgraded to 12+ PSCWB Topics:** Upgrades every historical month in PostgreSQL via `ON CONFLICT (edition_date) DO UPDATE`.
  3. **Continuous Range Batching (`days-1-10`, `days-11-20`, `days-21-end`, `full-month`):** Allows populating all 30/31 days of any earlier month in continuous 10-day or full-month batches without HTTP timeouts, automatically updating the **30/31-Day Monthly Coverage Progress Bar** on the Month Cards.

### 3. **Monthly Category Classifier & Capsule Agent (`normalizeCategory` + `POST /api/v1/current-affairs/classify-month`)**
* **What it does:** Classifies every topic and MCQ across a month into **10 standardized WBPSC exam categories**:
  * *West Bengal Special*, *Polity & Governance*, *Economy & Banking*, *Science & Technology*, *Awards & Honours*, *Sports & Tournaments*, *Environment & GI Tags*, *Defence & Military Exercises*, *Ranks, Reports & Indices*, and *National & International*.
* **Behind the scenes:** Powers print-ready **Categorized Monthly Capsule PDFs** and the **1-Year Clerkship Mega-Capsule PDF** (`handleDownloadCategorizedCapsulePdf`).

### 4. **Single-Date Manual Recovery Agent (With Strict Future-Date Lock)**
* **What it does:** Provides a manual retry option if an automatic run ever fails on a specific past date, while strictly blocking any future date (`editionDate > todayIso`) across the database startup audit, REST API, and UI date picker.

### 5. **Bilingual Fact-Critic, Trap-Detector & PYQ MCQ Sub-Agent (100% Automatic Internal Pipeline)**
* **What it does:** Runs automatically inside Agents 1–4 (requires no separate manual button). Formats every topic into **4–5 Prelims/Mains bullet facts** in **English (`en`)** and **Bengali (`bn`)**, attaches a **`staticGkLink`** (Constitutional Articles, Historical Acts, Headquarters) and an **`examTrap`** (common negative-marking confusers), and synthesizes **6 bilingual 4-option MCQs (`A, B, C, D`)** with explanations.
* **PSCWB Exam Focus:** Prioritizes high-probability West Bengal PSC topics including *Deocha Pachami Coal Block (Birbhum)*, *West Bengal GI Tags (Tangail, Garad, Korial Sarees, Kalonunia Rice, Sundarban Honey)*, *Ghatal Master Plan & DVC*, *Classical Language Status for Bengali (Charyapada)*, *133rd Durand Cup in Kolkata*, and *16th Finance Commission (Art. 280)*.

---

## 8. Complete Application Feature Portfolio & Commercial Business Scope

### A. Core Production Feature Matrix

| Module | What We Have Built | Commercial Value Proposition |
| :--- | :--- | :--- |
| **1. Bilingual OMR Mock Test Engine & 1M-Scale Blueprint Assembler** | Timed WBPSC Prelims & Clerkship Part-I mock tests (`EN` + `বাংলা`), deterministic SQL grading (`₹0` AI cost), negative marking analytics, and Stratified Blueprint Sampling + Hybrid Search (`pg_trgm` + `pgvector` HNSW) for 1-Million Question Bank scale. | Core freemium-to-paid conversion engine; zero LLM cost per test attempt. |
| **2. Exam-Oriented Revision Notes & Visual Concept Cards** | Admin-generated high-yield topic notes (e.g., *Viceroys of India*, *Sentence Transformation*) with AI-generated **Visual Concept Diagrams**, **Base Set of 30 Practice MCQs**, and **up to 2 Custom 30-MCQ Regenerations per Premium Aspirant** (`2/2` quota guardrail). | High-margin Premium Aspirant upsell with strictly bounded AI token cost. |
| **3. 3-Tier Cached RAG Weakness Tutor** | SQL-driven weak sub-topic detection (`accuracy < 60%`) paired with `pgvector` syllabus retrieval and a **3-Tier Cache (`Redis` $\rightarrow$ `PostgreSQL` $\rightarrow$ `Gemini`)** in `apps/api-ai`. | Cuts recurring AI tutoring costs by **95%+** across thousands of concurrent students. |
| **4. Clerkship Part-II Descriptive Answer Evaluator** | Automated bilingual rubric evaluation for **Report Writing, Précis Writing (deterministic 1/3rd word-count check), and Translation (`বাংলা` $\leftrightarrow$ `EN`)**. | Replaces expensive ₹2,000+ offline descriptive test-checking batches. |
| **5. Daily & 1-Year Categorized Current Affairs (5-Agent Suite)** | Daily 12-topic auto-collection, Month-Wise Batch Backfilling (`Nov 2025 – Oct 2026`), 30/31-day progress bars, Floating Animated Card Deck Modal with 31-day Calendar, and Categorized Monthly / 1-Year PDF Capsules. | Daily organic traffic magnet (DAU driver) + downloadable PDF capsule upsell. |
| **6. Admin PDF/Image OCR & Auto-Translation Question Bank Ingestor** | Multimodal Gemini OCR extracts Bengali/English questions from PDFs or images, auto-translates `বাংলা` $\leftrightarrow$ `English`, verifies historical facts, and inserts directly into the Question Bank. | Reduces content team typing and translation expenses by **80–99%**. |

### B. Competitive Edge Over Conventional Apps (Testbook / Adda247 / Oliveboard) & Growth Roadmap

1. **Native Bengali Orthography (`যুক্তাক্ষর`) & Deep West Bengal State Focus:** Unlike national apps that rely on awkward Hindi-to-Bengali machine translation and generic national current affairs, every module is built natively around **WBPSC Clerkship, WBCS, Miscellaneous, Food SI, and WBP** syllabi, West Bengal Gazette schemes, and `Noto Sans Bengali` typography.
2. **Next-Phase Commercial Differentiators for High-Ticket Monetization:**
   * **Camera-Based Handwritten Answer Sheet Grader (Gemini Vision):** Snap a photo of handwritten Bengali/English Part-II Précis, Reports, and Translations for instant rubric grading.
   * **23-District West Bengal Explorer & State Budget Micro-Capsules:** District-wise rivers, GI tags, census stats, and schemes for WBPSC Miscellaneous & Interview rounds.
   * **Ebbinghaus Spaced-Repetition "Mistake Vault" (1-3-7-21 Day Auto-Requeue):** Automatically re-tests wrong MCQs and *Exam Hall Traps* on Days 1, 3, 7, and 21 until mastered.
   * **Exam-Hall "Negative-Marking Shield" Simulator:** Trains aspirants on closely confusing option pairs and measures their guessing risk index.
   * **B2B White-Label OMR + QR-Code Paper Generator for Coaching Institutes (`₹3,999/month`):** Lets local West Bengal coaching centers generate branded bilingual PDF papers from the 1M Question Bank and grade students' physical OMR sheets via mobile camera.


