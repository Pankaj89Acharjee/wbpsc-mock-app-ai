# Current Affairs Multi-Agent Architecture & Documentation

This document explains **what the Current Affairs module is doing right now in production**, broken down **Agent by Agent**, along with the exact codebase files, database schema, UI features, and **"Behind the Scenes" interview explanations**.

---

## 1. Where the Current Affairs System Lives (Exact Codebase Files)

| File Path | Role in the Current Affairs System |
| :--- | :--- |
| **`/apps/api-core/src/routes/currentAffairs.ts`** | **Backend Multi-Agent Engine & Archive Store:** Contains the Web-Scout Scraper (`GKToday` + `PYQArena`), Gemini Search-Grounded Curated Digest Agent, Monthly Category Classifier Agent, 1-Year (`Dec 2025 – Nov 2026`) Clerkship Archive Seeder, and REST endpoints. |
| **`/src/components/DailyCurrentAffairsTab.tsx`** | **Frontend Console, Calendar, Floating Card Deck & PDF Compiler:** Renders the Interactive Monthly Calendar (`Dec 2025 – Nov 2026`), Fixed-Height Scrollable Reader, Animated Floating Flashcard Modal (`← Previous` / `Next →`), Interactive Practice Quiz, and Categorized Monthly / 1-Year PDF Capsule Generator. |

---

## 2. Agent-Wise Breakdown: What Each Agent Does Right Now

The Current Affairs pipeline is orchestrated as a **5-Agent Workflow** that transforms raw daily news portals into **10–12 exam-ready bilingual (`EN` + `বাংলা`) cards**, **categorized monthly capsules**, and a **1-Year WBPSC Clerkship Archive (`Dec 2025 – Nov 2026`)**.

```text
[1. Multi-Source Web-Scout Agent]
   ├─► Scrapes GKToday (https://www.gktoday.in/current-affairs/)
   ├─► Scrapes PYQArena / The Hindu (https://www.pyqarena.com/...)
   └─► Runs Gemini Google Search Grounding (`tools: [{ googleSearch: {} }]`) for PIB & WB Gazette
         │
         ▼
[2. Bilingual Exam-Curator & Static-GK Mapper Agent]
   ├─► Filters out political noise; selects 10 to 12 high-yield WBPSC topics per edition
   ├─► Generates 4–5 crisp Prelims/Mains bullet pointers per topic (EN + বাংলা)
   └─► Attaches a "Static GK Syllabus Hook" + "Exam Hall Confuser / Trap" to every topic
         │
         ▼
[3. Monthly Category Classifier Agent]
   ├─► Classifies every topic into 1 of 10 official WBPSC Exam Categories:
   │   (Sports, Awards, Science & Tech, Polity, Economy, WB Special, Environment/GI, Defence, Indices, National/Intl)
   └─► Audits & re-tags entire months via `POST /api/v1/current-affairs/classify-month`
         │
         ▼
[4. PYQ-Pattern Current Affairs MCQ Generator Agent]
   ├─► Synthesizes 5–6 bilingual (`en`/`bn`) 4-option MCQs (`A, B, C, D`) from the day's topics
   └─► Generates detailed bilingual explanations for interactive testing & PDF Answer Keys
         │
         ▼
[5. 1-Year Clerkship Archive & Categorized PDF Capsule Compiler Agent]
   ├─► Maintains 12 full months of categorized capsules (`Dec 2025 – Nov 2026`) for Dec 2026 Clerkship Exam
   └─► Compiles downloadable Monthly Categorized PDFs & 1-Year Mega-Capsule PDFs for Aspirants & Admins
```

---

### Agent 1: Multi-Source Web-Scout & Portal Grounding Agent
* **Where it runs:** `scrapePortalText()` + `runAutonomousCurrentAffairsAgent()` in `/apps/api-core/src/routes/currentAffairs.ts`
* **What it does now:**
  1. **Direct Portal Scraping (`GKToday` & `PYQArena`):**
     * Fetches live HTML from **GKToday (`https://www.gktoday.in/current-affairs/`)** and **PYQArena (`https://www.pyqarena.com/current-affairs-from-the-hindu-2nd-september-2026/` or custom Admin URL)**.
     * Strips `<script>`, `<style>`, and `<noscript>` tags, normalizes whitespace, and extracts up to `10,000` characters of clean factual text from both portals.
  2. **Live Google Search Grounding (`googleSearch: {}`):**
     * Simultaneously enables Gemini's native `tools: [{ googleSearch: {} }]` tool to cross-verify facts against **Press Information Bureau (PIB)**, **The Hindu**, and **West Bengal Government Gazette / Egiye Bangla** portals.
  3. **Source Citation Tracking:**
     * Records the exact verified reference URLs (`source_links`) and grounding status (`Grounded on GKToday + PYQArena + Google Search` or `Deterministic 12-Topic WBPSC Backup`) in PostgreSQL.

* **Behind the Scenes (Interview Explanation):**
  > *"Instead of letting the LLM hallucinate current events from stale training weights, our Web-Scout Agent performs hybrid grounding: it directly scrapes GKToday and PYQArena for exam-curated headlines and pairs that with Gemini's Google Search Grounding tool to verify official dates, ministries, and West Bengal state schemes before passing context to the synthesizer."*

---

### Agent 2: Bilingual Exam-Curator & Static-GK Mapper Agent
* **Where it runs:** `runAutonomousCurrentAffairsAgent()` in `/apps/api-core/src/routes/currentAffairs.ts`
* **What it does now:**
  1. **10 to 12 High-Yield Topics per Edition:**
     * Curates **10 to 12 top exam-oriented topics** per edition (never shallow 1-liners and never bloated newspaper op-eds).
  2. **Structured 4-Part Exam Card per Topic:**
     * **`whyInNews` (`en` + `bn`):** A crisp 1–2 sentence context summary explaining why the event is in the news.
     * **`keyPoints` (`en` + `bn`):** **4 to 5 bullet points** packed with exact dates, Article numbers, Constitutional Amendments, project costs, awardees, host cities, and rankings tested in WBPSC Prelims & Mains.
     * **`staticGkLink` (`en` + `bn`):** Maps the breaking news event back to the **Static WBPSC Syllabus** (e.g., if the news is about *Aparajita Bill 2024*, the agent attaches *Article 200 & 201 — Governor's Assent & President's Consideration*; if the news is about *Charaideo Moidams*, it attaches *UNESCO World Heritage Sites in India = 43*).
     * **`examTrapOrTip` (`en` + `bn`):** Highlights common exam-hall traps where students lose `-0.25` negative marks (e.g., confusing *Shiv Shakti Point* [Chandrayaan-3] with *Tiranga Point* [Chandrayaan-2] and *Jawahar Point* [Chandrayaan-1]).
  3. **True Bilingual Synthesis (`English` + `বাংলা`):**
     * Every title, summary, bullet point, static GK hook, and exam trap is generated in both **English (`en`)** and **standard formal Bengali (`bn`)** stored as `JSONB` in PostgreSQL.

* **Behind the Scenes (Interview Explanation):**
  > *"State PSC exams like WBCS and Clerkship rarely ask raw news alone—they use current affairs as a hook to ask Static GK questions. Our Curator Agent automatically pairs every current event with a `staticGkLink` (relevant Constitutional Article, Historical Act, or Headquarters) and an `examTrapOrTip` so aspirants revise both current and static syllabus in one card."*

---

### Agent 3: Monthly Category Classifier Agent
* **Where it runs:** `normalizeCategory()` + `POST /api/v1/current-affairs/classify-month` in `/apps/api-core/src/routes/currentAffairs.ts`
* **What it does now:**
  1. **10 Standardized WBPSC Exam Buckets (`CA_CATEGORIES`):**
     Every topic and MCQ is classified into one of **10 canonical WBPSC categories**:
     * `West Bengal Special` *(State schemes, GI tags, state bills, appointments, ports)*
     * `Polity & Governance` *(Constitutional amendments, Supreme Court verdicts, bills, commissions)*
     * `Economy & Banking` *(RBI policies, GDP, Union/State Budget, GST, UPI)*
     * `Science & Technology` *(ISRO missions, defence tech, AI, space, disease vaccines)*
     * `Awards & Honours` *(Nobel, Bharat Ratna, Ramon Magsaysay, Jnanpith, Banga Bibhushan, Booker)*
     * `Sports & Tournaments` *(Olympics, Paralympics, Cricket World Cups, Chess Olympiad, Durand Cup)*
     * `Environment & GI Tags` *(Ramsar sites, UNESCO heritage sites, Tiger reserves, COP summits, GI tags)*
     * `Defence & Military Exercises` *(Joint military/naval/air exercises, DRDO missiles, inductions)*
     * `Ranks, Reports & Indices` *(HDI, Press Freedom, Hunger Index, Swachh Survekshan, SDG Index)*
     * `National & International` *(Summits, G20, BRICS, ASEAN, bilateral treaties, foreign appointments)*
  2. **Deterministic + Semantic Normalization (`normalizeCategory`):**
     * Even if an LLM outputs a variation like `"Space & ISRO"` or `"Sports"`, the classifier normalizes it deterministically into the exact canonical bucket (`Science & Technology` or `Sports & Tournaments`).
  3. **End-of-Month Batch Classifier Endpoint (`POST /api/v1/current-affairs/classify-month`):**
     * At the end of any month (or when triggered via the **"Run Classifier Agent"** button in the UI), this agent scans every edition in that `YYYY-MM` month, re-classifies all topics and MCQs into the 10 standardized buckets, updates PostgreSQL (`current_affairs_editions`), and returns a category distribution breakdown (`categoryBreakdown`) ready for the Monthly Categorized Capsule PDF.

* **Behind the Scenes (Interview Explanation):**
  > *"When preparing for an exam like the December 2026 Clerkship, students don't revise current affairs chronologically day-by-day—they revise category-wise (all Sports together, all Awards together, all West Bengal Schemes together). Our Monthly Category Classifier Agent scans all daily editions of a month, maps every topic into 10 canonical WBPSC buckets, and groups them for the Monthly Categorized Capsule PDF."*

---

### Agent 4: PYQ-Pattern Current Affairs MCQ Generator Agent
* **Where it runs:** `runAutonomousCurrentAffairsAgent()` in `/apps/api-core/src/routes/currentAffairs.ts` + Interactive Quiz in `/src/components/DailyCurrentAffairsTab.tsx`
* **What it does now:**
  1. Generates **5 to 6 high-probability 4-option MCQs (`A, B, C, D`)** per edition directly grounded on the 10–12 curated topics.
  2. Each MCQ includes:
     * Bilingual question stem (`question.en` & `question.bn`)
     * 4 bilingual options (`options.A` through `options.D`)
     * Verified `correctOption` (`A` | `B` | `C` | `D`)
     * Bilingual `explanation` (`en` & `bn`) and `category` tag.
  3. Powers both the **Interactive Self-Check Quiz** inside the web app (with instant green/red grading and explanations) and the **Answer Key Table** at the end of every downloaded PDF booklet.

---

### Agent 5: 1-Year Clerkship Archive & Categorized PDF Capsule Compiler Agent
* **Where it runs:** `seedFullYearClerkshipArchive()` in `/apps/api-core/src/routes/currentAffairs.ts` + `handleDownloadCategorizedCapsulePdf()` in `/src/components/DailyCurrentAffairsTab.tsx`
* **What it does now:**
  1. **Pre-Built 1-Year Archive (`December 2025 – November 2026`) for December 2026 Clerkship Exam:**
     * Ensures all **12 months (`2025-12` through `2026-11`)** are continuously available in PostgreSQL (`current_affairs_editions`) with categorized topics and practice MCQs covering the entire 1-year window tested in the **December 2026 WBPSC Clerkship Exam**.
     * Automatically upgrades the flagship `2026-09-02` edition to **12 comprehensive topics** across all 10 categories via `ON CONFLICT (edition_date) DO UPDATE`.
  2. **Categorized Monthly Capsule PDF & 1-Year Mega-Capsule PDF (`handleDownloadCategorizedCapsulePdf`):**
     * Available to **both Aspirants and Admins**.
     * Groups all topics across the selected month (or across all 12 months for the **1-Year Clerkship Mega-Capsule**) **by Category** (*West Bengal Special*, *Polity*, *Science & Tech*, *Sports*, *Awards*, etc.).
     * Generates a print-ready bilingual HTML/PDF booklet (`Noto Sans Bengali` + `Inter`) featuring:
       * Cover Banner & Exam Metadata
       * Category-wise Table of Contents with Topic Counts
       * Categorized Topic Cards (Why in News, 4–5 Bullet Pointers, Static GK Hook, Exam Hall Trap)
       * Consolidated Practice MCQs & Answer Key Table at the back
     * Increments the PostgreSQL download counter (`POST /api/v1/current-affairs/:date/download`) for Admin analytics.

---

## 3. UI & User Experience Features Connected to These Agents

1. **Interactive Monthly Calendar (`Dec 2025 – Nov 2026`):**
   * Users can switch between any of the 12 months (`Dec 2025` to `Nov 2026`) and click on any calendar day (`Sun–Sat`).
   * Dates with existing editions are highlighted with an emerald badge; clicking any unpopulated date allows 1-click synthesis of a 10–12 topic edition for that exact date.
2. **Floating Animated Flashcard Modal (`← Previous Topic` / `Next Topic →`):**
   * Clicking **"Launch Floating Card Deck"** opens a centered, animated modal displaying the 10–12 topics one card at a time.
   * Supports **`← Previous Topic`** and **`Next Topic →`** buttons, keyboard arrow keys (`ArrowLeft`, `ArrowRight`, `Escape`), numbered card dots (`1–12`), category filter pills, and instant `EN` / `বাংলা` toggling.
3. **Fixed-Height Scrollable Containers (`h-[660px]`):**
   * Both the Left Calendar/Archive Sidebar and the Right Reader Container have fixed responsive heights (`h-[660px]`) with smooth vertical scrollbars (`overflow-y-auto`), preventing the page from stretching endlessly.
