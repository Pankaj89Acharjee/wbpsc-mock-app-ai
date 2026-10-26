import "dotenv/config";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { fakeQuestion, recreateDatabase, startFakeAi, type FakeAi } from "./helpers";

// ============================================================================
// End-to-end API tests on a throwaway database (wbpsc_test_core) built from
// migrations/. api-ai is faked, so nothing here calls Gemini.
// Run: npm run test:api-core   (needs the local Postgres from docker compose)
// ============================================================================

let app: FastifyInstance;
let ai: FakeAi;
let adminToken = "";
let studentToken = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let m: any; // schema module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let closeDb: () => Promise<void>;

const ids: Record<string, string> = {};

async function call<T = any>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
  token = adminToken
): Promise<{ status: number; body: T }> {
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    payload: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.statusCode, body: res.json() as T };
}

const b = (en: string) => ({ en, bn: `বাংলা ${en}` });

/** Matches a database error raised by `constraint` (drizzle wraps it in `cause`). */
const violates = (constraint: string) => (err: unknown) => {
  const cause = (err as { cause?: { constraint_name?: string } }).cause;
  assert.equal(cause?.constraint_name, constraint);
  return true;
};

/** Inserts an approved bank question directly. */
async function bankQuestion(examKey: string, subtopicKey: string, stem: string, options?: string[]) {
  const st = ids[`st:${subtopicKey}`];
  const [row] = await db
    .select({ chapterId: m.subtopics.chapterId, subjectId: m.subtopics.subjectId })
    .from(m.subtopics)
    .where((await import("drizzle-orm")).eq(m.subtopics.id, st));
  const { computeContentHash } = await import("../src/lib/contentHash");
  const o = options ?? [`${stem} a`, `${stem} b`, `${stem} c`, `${stem} d`];
  const q = {
    stem: b(stem),
    options: { A: b(o[0]), B: b(o[1]), C: b(o[2]), D: b(o[3]) },
  };
  const [created] = await db
    .insert(m.questions)
    .values({
      examId: ids[`exam:${examKey}`],
      examSlug: examKey,
      subjectId: row.subjectId,
      chapterId: row.chapterId,
      subtopicId: st,
      ...q,
      correctOption: "A",
      explanation: b("Because"),
      difficulty: "moderate",
      source: "educator",
      answerKeyVerified: true,
      contentHash: computeContentHash(q),
    })
    .returning({ id: m.questions.id });
  return created.id as string;
}

/** Marking scheme used by the mock series (2 marks, −0.5, 30 min). */
const MOCK_SCHEME = { durationMinutes: 30, marksPerCorrect: 2, negativeMarksPerWrong: 0.5 };

/** Exam → subject → chapter → subtopic rows; keys are slugs. */
async function seedSyllabus(examSlug: string, tree: Record<string, Record<string, string[]>>) {
  const [exam] = await db
    .insert(m.exams)
    .values({ slug: examSlug, title: b(examSlug), description: b("") })
    .returning();
  ids[`exam:${examSlug}`] = exam.id;
  for (const [subject, chaptersTree] of Object.entries(tree)) {
    const [s] = await db
      .insert(m.subjects)
      .values({ examId: exam.id, slug: subject, name: b(subject) })
      .returning();
    ids[`subj:${examSlug}:${subject}`] = s.id;
    for (const [chapter, subtopicList] of Object.entries(chaptersTree)) {
      const [c] = await db
        .insert(m.chapters)
        .values({ subjectId: s.id, slug: chapter, name: b(chapter) })
        .returning();
      ids[`chap:${examSlug}:${chapter}`] = c.id;
      for (const subtopic of subtopicList) {
        const [t] = await db
          .insert(m.subtopics)
          .values({ subjectId: s.id, chapterId: c.id, slug: subtopic, name: b(subtopic) })
          .returning();
        ids[`st:${examSlug}:${subtopic}`] = t.id;
      }
    }
  }
}

before(async () => {
  const url = await recreateDatabase();
  ai = await startFakeAi();
  Object.assign(process.env, {
    DATABASE_URL: url,
    DB_MIGRATE_ON_START: "true",
    API_AI_URL: ai.url,
    INTERNAL_SERVICE_TOKEN: ai.token,
    ADMIN_EMAIL: "admin@test.local",
    ADMIN_PASSWORD: "test-admin-password",
    JWT_ACCESS_SECRET: "test-jwt-secret-test-jwt-secret-1234",
    LOG_LEVEL: "silent",
  });

  const { buildApiCoreApp } = await import("../src/server");
  const dbModule = await import("../src/db/index");
  m = await import("../src/db/schema");
  db = dbModule.db;
  closeDb = dbModule.closeDbConnection;
  app = await buildApiCoreApp();

  const { signSession } = await import("../src/lib/auth");
  const { eq } = await import("drizzle-orm");
  const [admin] = await db.select().from(m.users).where(eq(m.users.email, "admin@test.local"));
  adminToken = signSession(admin);
  const [student] = await db
    .insert(m.users)
    .values({ email: "student@test.local", fullName: "Student" })
    .returning();
  studentToken = signSession(student);

  await seedSyllabus("clerkship", {
    english: { grammar: ["tenses", "articles"], vocabulary: ["synonyms"] },
    maths: { arithmetic: ["percentage", "ratio"] },
  });
  // Same English path as Clerkship (for cross-exam reuse) plus a subject Clerkship lacks
  await seedSyllabus("wbcs", {
    english: { grammar: ["tenses"] },
    history: { modern: ["revolt-1857"] },
  });
});

after(async () => {
  await app?.close();
  await closeDb?.();
  await ai?.close();
});

/** Replaces a series' blueprint (subject counts + topic split). */
async function setBlueprint(seriesId: string, slots: unknown[]) {
  return call("PUT", `/admin/series/${seriesId}/blueprint`, { slots });
}

async function newSeries(nameEn: string, subjectTargets: Array<{ subjectId: string; targetCount: number }>, extra = {}) {
  const r = await call("POST", `/admin/series/exams/${ids["exam:clerkship"]}`, {
    nameEn,
    kind: "mock_test",
    ...MOCK_SCHEME,
    subjectTargets,
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.series.id as string;
}

/** English 4 = Grammar 3 + Vocabulary 1 · Maths 2 (of which Percentage 1) */
const SPLIT = () => [
  { subjectId: ids["subj:clerkship:english"], targetCount: 4 },
  { subjectId: ids["subj:clerkship:english"], chapterId: ids["chap:clerkship:grammar"], targetCount: 3 },
  { subjectId: ids["subj:clerkship:english"], chapterId: ids["chap:clerkship:vocabulary"], targetCount: 1 },
  { subjectId: ids["subj:clerkship:maths"], targetCount: 2 },
  {
    subjectId: ids["subj:clerkship:maths"],
    chapterId: ids["chap:clerkship:arithmetic"],
    subtopicId: ids["st:clerkship:percentage"],
    targetCount: 1,
  },
];

/** A 6-question mock series with the SPLIT blueprint. */
async function newMock(nameEn: string) {
  const id = await newSeries(nameEn, [
    { subjectId: ids["subj:clerkship:english"], targetCount: 4 },
    { subjectId: ids["subj:clerkship:maths"], targetCount: 2 },
  ]);
  const r = await setBlueprint(id, SPLIT());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return id;
}

/** PUT /admin/series/:id with the mock scheme and the given status. */
const setStatus = (seriesId: string, nameEn: string, status: string, extra = {}) =>
  call("PUT", `/admin/series/${seriesId}`, { nameEn, kind: "mock_test", ...MOCK_SCHEME, ...extra, status });

const ALL_MIGRATIONS = [
  "0000_baseline.sql",
  "0001_exam_series_papers_roster.sql",
  "0002_series_marking_scheme.sql",
  "0003_series_blueprint.sql",
  "0004_series_questions.sql",
];

describe("migrations", () => {
  test("fresh database got every migration and re-running is a no-op", async () => {
    const { pendingMigrations, runMigrations } = await import("../src/db/migrate");
    const { queryClient } = await import("../src/db/index");
    assert.deepEqual(await pendingMigrations(queryClient), []);
    const rows = await queryClient`select name from schema_migrations order by name`;
    assert.deepEqual(
      rows.map((r) => r.name),
      ALL_MIGRATIONS
    );
    assert.deepEqual(await runMigrations(queryClient, () => {}), []);
  });

  test("an existing pre-migration database is upgraded in place, data intact", async () => {
    const { readFileSync } = await import("node:fs");
    const postgres = (await import("postgres")).default;
    const { recreateDatabase: recreate, dropDatabase } = await import("./helpers");
    const { pendingMigrations, runMigrations } = await import("../src/db/migrate");

    // Simulate a database created by `db:push` before migrations existed
    const legacyUrl = await recreate("wbpsc_test_core_legacy");
    const legacy = postgres(legacyUrl, { max: 1, onnotice: () => {} });
    try {
      await legacy.unsafe(
        readFileSync(new URL("../migrations/0000_baseline.sql", import.meta.url), "utf8")
      );
      await legacy`insert into exams (slug, title, description) values ('old', '{"en":"Old","bn":"Old"}', '{"en":"","bn":""}')`;

      // Startup check sees the gap (api-core refuses to start until migrated)
      const all = ALL_MIGRATIONS.slice(1);
      assert.deepEqual(await pendingMigrations(legacy), all);
      const applied = await runMigrations(legacy, () => {});
      assert.deepEqual(await pendingMigrations(legacy), []);
      assert.deepEqual(applied, all);
      const [{ n }] = await legacy`select count(*)::int as n from exams where slug = 'old'`;
      assert.equal(n, 1);
      const [tables] = await legacy`
        select to_regclass('public.series_questions') is not null as series_questions,
               to_regclass('public.exam_papers') is not null as exam_papers`;
      assert.deepEqual({ ...tables }, { series_questions: true, exam_papers: false });
      const [{ col }] = await legacy`
        select count(*)::int as col from information_schema.columns
        where table_name = 'test_attempts' and column_name = 'series_id'`;
      assert.equal(col, 1);
    } finally {
      await legacy.end();
      await dropDatabase("wbpsc_test_core_legacy");
    }
  });
});

describe("migration 0002", () => {
  test("series take their marking scheme from existing papers", async () => {
    const { readFileSync } = await import("node:fs");
    const postgres = (await import("postgres")).default;
    const { recreateDatabase: recreate, dropDatabase } = await import("./helpers");
    const { runMigrations } = await import("../src/db/migrate");

    // A database at 0001 with a paper that carried its own marking
    const url = await recreate("wbpsc_test_core_0002");
    const conn = postgres(url, { max: 1, onnotice: () => {} });
    const sqlFile = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");
    try {
      await conn.unsafe(sqlFile("0000_baseline.sql"));
      await conn.unsafe(sqlFile("0001_exam_series_papers_roster.sql"));
      await conn`create table schema_migrations (name varchar(200) primary key, applied_at timestamptz not null default now())`;
      await conn`insert into schema_migrations (name) values ('0000_baseline.sql'), ('0001_exam_series_papers_roster.sql')`;
      const [exam] = await conn`insert into exams (slug, title, description) values ('e', '{"en":"E","bn":"E"}', '{"en":"","bn":""}') returning id`;
      const [series] = await conn`insert into exam_series (exam_id, slug, name) values (${exam.id}, 's', '{"en":"S","bn":"S"}') returning id`;
      await conn`insert into exam_papers (series_id, exam_id, slug, title, duration_minutes, marks_per_correct, negative_marks_per_wrong, estimated_cutoff_marks)
                 values (${series.id}, ${exam.id}, 'p', '{"en":"P","bn":"P"}', 45, 2, 0.5, 30)`;

      assert.deepEqual(await runMigrations(conn, () => {}), ALL_MIGRATIONS.slice(2));
      const [row] = await conn`select duration_minutes, marks_per_correct::float as m, negative_marks_per_wrong::float as n, estimated_cutoff_marks::float as c from exam_series`;
      assert.deepEqual({ ...row }, { duration_minutes: 45, m: 2, n: 0.5, c: 30 });
    } finally {
      await conn.end();
      await dropDatabase("wbpsc_test_core_0002");
    }
  });
});

describe("migration 0004", () => {
  /** A database at 0003 (papers still exist), fed by `seed`. */
  async function at0003(name: string, seed: (conn: any) => Promise<void>) {
    const { readFileSync } = await import("node:fs");
    const postgres = (await import("postgres")).default;
    const { recreateDatabase: recreate } = await import("./helpers");
    const url = await recreate(name);
    const conn = postgres(url, { max: 1, onnotice: () => {} });
    const sqlFile = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");
    for (const f of ALL_MIGRATIONS.slice(0, 4)) await conn.unsafe(sqlFile(f));
    await conn`create table schema_migrations (name varchar(200) primary key, applied_at timestamptz not null default now())`;
    for (const f of ALL_MIGRATIONS.slice(0, 4)) await conn`insert into schema_migrations (name) values (${f})`;
    await seed(conn);
    return conn;
  }

  /** exam e → subject s → chapter c → subtopic t, and n bank questions there. */
  async function syllabus(conn: any, n: number) {
    const [exam] = await conn`insert into exams (slug, title, description) values ('e', '{"en":"E","bn":"E"}', '{"en":"","bn":""}') returning id`;
    const [s] = await conn`insert into subjects (exam_id, slug, name) values (${exam.id}, 's', '{"en":"S","bn":"S"}') returning id`;
    const [c] = await conn`insert into chapters (subject_id, slug, name) values (${s.id}, 'c', '{"en":"C","bn":"C"}') returning id`;
    const [t] = await conn`insert into subtopics (subject_id, chapter_id, slug, name) values (${s.id}, ${c.id}, 't', '{"en":"T","bn":"T"}') returning id`;
    const qs: string[] = [];
    for (let i = 0; i < n; i++) {
      const [q] = await conn`
        insert into questions (exam_id, exam_slug, subject_id, chapter_id, subtopic_id, stem, options, correct_option, explanation, content_hash)
        values (${exam.id}, 'e', ${s.id}, ${c.id}, ${t.id}, ${conn.json({ en: `Q${i}`, bn: `Q${i}` })},
                ${conn.json({ A: { en: "a", bn: "a" }, B: { en: "b", bn: "b" }, C: { en: "c", bn: "c" }, D: { en: "d", bn: "d" } })},
                'A', ${conn.json({ en: "", bn: "" })}, ${`hash-${i}`})
        returning id`;
      qs.push(q.id);
    }
    return { examId: exam.id, subjectId: s.id, chapterId: c.id, subtopicId: t.id, qs };
  }

  test("a series takes its paper's questions, attempts and drafts; incomplete published series go to draft", async () => {
    const { runMigrations } = await import("../src/db/migrate");
    const { dropDatabase } = await import("./helpers");
    let seriesIds: Record<string, string> = {};
    const conn = await at0003("wbpsc_test_core_0004", async (conn) => {
      const s = await syllabus(conn, 3);
      // "full": 2 questions needed, its paper has 2 · "empty": published but its paper has none
      const [full] = await conn`insert into exam_series (exam_id, slug, name, status) values (${s.examId}, 'full', '{"en":"Full","bn":"Full"}', 'published') returning id`;
      const [empty] = await conn`insert into exam_series (exam_id, slug, name, status) values (${s.examId}, 'empty', '{"en":"Empty","bn":"Empty"}', 'published') returning id`;
      seriesIds = { full: full.id, empty: empty.id };
      for (const id of [full.id, empty.id]) {
        await conn`insert into series_roster_slots (series_id, exam_id, subject_id, target_count) values (${id}, ${s.examId}, ${s.subjectId}, 2)`;
      }
      const [paper] = await conn`insert into exam_papers (series_id, exam_id, slug, title, status) values (${full.id}, ${s.examId}, 'p1', '{"en":"P1","bn":"P1"}', 'published') returning id`;
      await conn`insert into exam_papers (series_id, exam_id, slug, title) values (${empty.id}, ${s.examId}, 'p2', '{"en":"P2","bn":"P2"}')`;
      for (const [i, q] of s.qs.slice(0, 2).entries()) {
        await conn`insert into paper_questions (paper_id, exam_id, question_id, subject_id, chapter_id, subtopic_id, position)
                   values (${paper.id}, ${s.examId}, ${q}, ${s.subjectId}, ${s.chapterId}, ${s.subtopicId}, ${i})`;
      }
      const [user] = await conn`insert into users (email, full_name) values ('u@test.local', 'U') returning id`;
      await conn`insert into test_attempts (user_id, exam_id, paper_id, total_questions, status) values (${user.id}, ${s.examId}, ${paper.id}, 2, 'submitted')`;
      await conn`insert into question_ingestion_jobs (source, status, batch_id, raw_data, target_paper_id) values ('ai_generated', 'pending_review', 'b', '{}', ${paper.id})`;
    });
    try {
      assert.deepEqual(await runMigrations(conn, () => {}), ["0004_series_questions.sql"]);
      const [{ n }] = await conn`select count(*)::int as n from series_questions where series_id = ${seriesIds.full}`;
      assert.equal(n, 2, "questions moved to the series");
      const [{ a }] = await conn`select count(*)::int as a from test_attempts where series_id = ${seriesIds.full}`;
      assert.equal(a, 1, "attempt history keeps its test");
      const [{ j }] = await conn`select count(*)::int as j from question_ingestion_jobs where target_series_id = ${seriesIds.full}`;
      assert.equal(j, 1, "pending drafts keep their target");
      const statuses = await conn`select slug, status from exam_series order by slug`;
      assert.deepEqual(
        statuses.map((r: any) => [r.slug, r.status]),
        [
          ["empty", "draft"],
          ["full", "published"],
        ]
      );
      const [{ gone }] = await conn`select to_regclass('public.exam_papers') is null and to_regclass('public.paper_questions') is null as gone`;
      assert.equal(gone, true);
    } finally {
      await conn.end();
      await dropDatabase("wbpsc_test_core_0004");
    }
  });

  test("questions in two papers of one series stop the migration instead of guessing", async () => {
    const { runMigrations } = await import("../src/db/migrate");
    const { dropDatabase } = await import("./helpers");
    const conn = await at0003("wbpsc_test_core_0004b", async (conn) => {
      const s = await syllabus(conn, 2);
      const [series] = await conn`insert into exam_series (exam_id, slug, name) values (${s.examId}, 'two', '{"en":"Two papers","bn":"Two"}') returning id`;
      for (const [i, q] of s.qs.entries()) {
        const [p] = await conn`insert into exam_papers (series_id, exam_id, slug, title) values (${series.id}, ${s.examId}, ${`p${i}`}, '{"en":"P","bn":"P"}') returning id`;
        await conn`insert into paper_questions (paper_id, exam_id, question_id, subject_id, chapter_id, subtopic_id)
                   values (${p.id}, ${s.examId}, ${q}, ${s.subjectId}, ${s.chapterId}, ${s.subtopicId})`;
      }
    });
    try {
      await assert.rejects(runMigrations(conn, () => {}), /Two papers/);
      const [{ kept }] = await conn`select to_regclass('public.exam_papers') is not null as kept`;
      assert.equal(kept, true, "nothing was dropped");
    } finally {
      await conn.end();
      await dropDatabase("wbpsc_test_core_0004b");
    }
  });
});

describe("exam type → test series", () => {
  test("multiple series under one exam type, with hierarchy enforced", async () => {
    const examId = ids["exam:clerkship"];
    const missingScheme = await call("POST", `/admin/series/exams/${examId}`, {
      nameEn: "No marking",
      kind: "mock_test",
    });
    assert.equal(missingScheme.status, 400, "duration and marking are required on a series");

    const publishedAtBirth = await call("POST", `/admin/series/exams/${examId}`, {
      nameEn: "Too early",
      kind: "mock_test",
      ...MOCK_SCHEME,
      status: "published",
    });
    assert.equal(publishedAtBirth.status, 400, "a new series has no questions yet");

    const pyq = await call("POST", `/admin/series/exams/${examId}`, {
      nameEn: "Clerkship 2024",
      kind: "previous_year",
      durationMinutes: 90,
      marksPerCorrect: 1,
      negativeMarksPerWrong: 0.25,
    });
    const mock = await call("POST", `/admin/series/exams/${examId}`, {
      nameEn: "Mock Test Series",
      kind: "mock_test",
      ...MOCK_SCHEME,
      // Step 1 of the pattern: English 4 + Maths 2 = 6 questions
      subjectTargets: [
        { subjectId: ids["subj:clerkship:english"], targetCount: 4 },
        { subjectId: ids["subj:clerkship:maths"], targetCount: 2 },
      ],
    });
    assert.equal(pyq.status, 201);
    assert.equal(mock.status, 201);
    assert.equal(pyq.body.series.slug, "clerkship-2024");
    ids.pyqSeries = pyq.body.series.id;
    ids.mockSeries = mock.body.series.id;

    assert.equal(mock.body.series.totalQuestions, 6);
    assert.equal(mock.body.series.selectedCount, 0);
    assert.deepEqual(
      mock.body.series.subjects.map((x: any) => [x.label, x.targetCount]),
      [
        ["english", 4],
        ["maths", 2],
      ]
    );

    const list = await call("GET", `/admin/series/exams/${examId}`);
    assert.deepEqual(
      list.body.series.map((s: any) => s.id).sort(),
      [ids.pyqSeries, ids.mockSeries].sort()
    );
    assert.equal(list.body.series.find((s: any) => s.id === ids.mockSeries).durationMinutes, 30);

    // The database itself refuses a selected question whose exam differs from its series' exam
    await assert.rejects(
      db.insert(m.seriesQuestions).values({
        seriesId: ids.mockSeries,
        examId: ids["exam:wbcs"],
        questionId: await bankQuestion("wbcs", "wbcs:tenses", "Exam mismatch probe"),
        subjectId: ids["subj:wbcs:english"],
        chapterId: ids["chap:wbcs:grammar"],
        subtopicId: ids["st:wbcs:tenses"],
      }),
      violates("series_questions_series_fk")
    );
  });

  test("slug clashes inside an exam are reported", async () => {
    const r = await call("POST", `/admin/series/exams/${ids["exam:clerkship"]}`, {
      slug: "mock-test-series",
      nameEn: "Again",
      kind: "mock_test",
      ...MOCK_SCHEME,
    });
    assert.equal(r.status, 409);
  });
});

describe("series blueprint", () => {
  test("topics can't exceed their subject; subjects must belong to the exam", async () => {
    const english = ids["subj:clerkship:english"];
    const grammar = ids["chap:clerkship:grammar"];
    const vocab = ids["chap:clerkship:vocabulary"];

    const childOver = await setBlueprint(ids.mockSeries, [
      { subjectId: english, targetCount: 3 },
      { subjectId: english, chapterId: grammar, targetCount: 2 },
      { subjectId: english, chapterId: vocab, targetCount: 2 },
    ]);
    assert.equal(childOver.status, 400);
    assert.match(childOver.body.error, /add up to 4/);

    const topicWithoutSubject = await setBlueprint(ids.mockSeries, [
      { subjectId: english, chapterId: grammar, targetCount: 2 },
    ]);
    assert.equal(topicWithoutSubject.status, 400);
    assert.match(topicWithoutSubject.body.error, /give its subject a question count first/);

    const otherExam = await setBlueprint(ids.mockSeries, [
      { subjectId: ids["subj:wbcs:history"], targetCount: 1 },
    ]);
    assert.equal(otherExam.status, 400);

    const wrongChapter = await setBlueprint(ids.mockSeries, [
      { subjectId: ids["subj:clerkship:maths"], targetCount: 2 },
      { subjectId: ids["subj:clerkship:maths"], chapterId: grammar, targetCount: 1 },
    ]);
    assert.equal(wrongChapter.status, 400);
  });

  test("step 2: topic split inside each subject", async () => {
    const r = await setBlueprint(ids.mockSeries, SPLIT());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.blueprint.totalQuestions, 6);
    const pct = r.body.blueprint.slots.find((s: any) => s.level === "subtopic");
    const maths = r.body.blueprint.slots.find((s: any) => s.level === "subject" && s.subjectId === ids["subj:clerkship:maths"]);
    assert.equal(pct.parentSlotId, maths.id);

    ids.mock2 = await newMock("Mock Test 02");
    for (const seriesId of [ids.mockSeries, ids.mock2]) {
      const roster = await call("GET", `/admin/series/${seriesId}/roster`);
      assert.equal(roster.body.roster.series.totalQuestions, 6, "test length = blueprint total");
      assert.equal(roster.body.roster.slots.length, 5);
      assert.deepEqual(roster.body.roster.warnings, []);
    }
  });
});

describe("selecting questions", () => {
  test("capacity is enforced per topic and the admin is told when it fills", async () => {
    const tenses = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => bankQuestion("clerkship", "clerkship:tenses", `Tense question ${i}`))
    );
    ids.tenses = JSON.stringify(tenses);
    const r = await call("POST", `/admin/series/${ids.mockSeries}/assignments`, { questionIds: tenses });
    assert.equal(r.status, 201);
    assert.equal(r.body.assigned.length, 3);
    assert.equal(r.body.failed.length, 2);
    assert.match(r.body.failed[0].reason, /is full \(3\/3\)/);
    assert.deepEqual(r.body.slotsFilled, ["english → grammar"]);
    const grammar = r.body.roster.slots.find((s: any) => s.chapterId === ids["chap:clerkship:grammar"]);
    assert.equal(grammar.isFull, true);

    // Other topics keep accepting questions
    const syn = await bankQuestion("clerkship", "clerkship:synonyms", "Synonym of happy");
    const r2 = await call("POST", `/admin/series/${ids.mockSeries}/assignments`, { questionIds: [syn] });
    assert.equal(r2.body.assigned.length, 1);
  });

  test("the same question can't be selected twice in one series", async () => {
    const [first] = JSON.parse(ids.tenses);
    const r = await call("POST", `/admin/series/${ids.mockSeries}/assignments`, { questionIds: [first] });
    assert.equal(r.body.assigned.length, 0);
    assert.match(r.body.failed[0].reason, /Already in this series/);
    await assert.rejects(
      db.insert(m.seriesQuestions).values({
        seriesId: ids.mockSeries,
        examId: ids["exam:clerkship"],
        questionId: first,
        subjectId: ids["subj:clerkship:english"],
        chapterId: ids["chap:clerkship:grammar"],
        subtopicId: ids["st:clerkship:tenses"],
      }),
      violates("series_questions_series_question_unique_idx")
    );
  });

  test("subject distribution: sub-limit inside a subject slot", async () => {
    const pct1 = await bankQuestion("clerkship", "clerkship:percentage", "Percent one");
    const pct2 = await bankQuestion("clerkship", "clerkship:percentage", "Percent two");
    const ratio1 = await bankQuestion("clerkship", "clerkship:ratio", "Ratio one");
    const ratio2 = await bankQuestion("clerkship", "clerkship:ratio", "Ratio two");
    // Maths 2 = Percentage 1 + one free seat for other maths
    const r = await call("POST", `/admin/series/${ids.mockSeries}/assignments`, {
      questionIds: [pct1, pct2, ratio1, ratio2],
    });
    assert.deepEqual(
      r.body.assigned.map((a: any) => a.questionId),
      [pct1, ratio1]
    );
    assert.equal(r.body.roster.assignedTotal, 6);
    assert.equal(r.body.roster.completionPct, 100);
  });

  test("questions are reused across series and exams without copying the record", async () => {
    const before = (await db.select().from(m.questions)).length;
    const [tense] = JSON.parse(ids.tenses);

    const sameExam = await call("POST", `/admin/series/${ids.mock2}/assignments`, { questionIds: [tense] });
    assert.equal(sameExam.body.assigned.length, 1);

    // A WBCS question whose English/grammar/tenses path also exists in Clerkship
    const wbcsTense = await bankQuestion("wbcs", "wbcs:tenses", "WBCS tense question");
    const crossMapped = await call("POST", `/admin/series/${ids.mock2}/assignments`, {
      questionIds: [wbcsTense],
    });
    assert.equal(crossMapped.body.assigned.length, 1);
    const row = crossMapped.body.roster.assigned.find((a: any) => a.questionId === wbcsTense);
    assert.equal(row.crossExam, true);
    assert.equal(row.subtopicId, ids["st:clerkship:tenses"], "classified in the series' own syllabus");

    // A WBCS question with no matching path needs an explicit subtopic
    const wbcsHistory = await bankQuestion("wbcs", "wbcs:revolt-1857", "Revolt of 1857 began in");
    const unmapped = await call("POST", `/admin/series/${ids.mock2}/assignments`, {
      questionIds: [wbcsHistory],
    });
    assert.match(unmapped.body.failed[0].reason, /choose a subtopic/);
    const mapped = await call("POST", `/admin/series/${ids.mock2}/assignments`, {
      questionIds: [wbcsHistory],
      subtopicId: ids["st:clerkship:articles"],
    });
    assert.equal(mapped.body.assigned.length, 1);

    const usage = await call("GET", `/admin/series/bank?subtopicId=${ids["st:clerkship:tenses"]}`);
    assert.equal(usage.body.questions.find((q: any) => q.id === tense).usedInSeries, 2);
    assert.equal((await db.select().from(m.questions)).length, before + 2, "only the 2 new WBCS rows");
  });

  test("concurrent selections never over-fill the last seat", async () => {
    // Vocabulary has 1 seat in the blueprint
    const race = await newMock("Race series");
    const qs = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) => bankQuestion("clerkship", "clerkship:synonyms", `Race synonym ${i}`))
    );
    const results = await Promise.all(
      qs.map((q) => call("POST", `/admin/series/${race}/assignments`, { questionIds: [q] }))
    );
    const assigned = results.reduce((n, r) => n + r.body.assigned.length, 0);
    assert.equal(assigned, 1);
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(m.seriesQuestions).where(eq(m.seriesQuestions.seriesId, race));
    assert.equal(rows.length, 1);
  });

  test("blueprint edits can't strand questions already selected", async () => {
    const r = await setBlueprint(ids.mockSeries, [
      { subjectId: ids["subj:clerkship:english"], targetCount: 4 },
      { subjectId: ids["subj:clerkship:english"], chapterId: ids["chap:clerkship:grammar"], targetCount: 2 },
      { subjectId: ids["subj:clerkship:maths"], targetCount: 2 },
    ]);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Remove or reassign selected questions first/);
  });

  test("the bank can be browsed one subject at a time, across exams", async () => {
    const english = await call(
      "GET",
      `/admin/series/bank?seriesId=${ids.mock2}&targetSubjectId=${ids["subj:clerkship:english"]}&availability=all&limit=200`
    );
    assert.ok(english.body.questions.length > 0);
    assert.ok(
      english.body.questions.every((q: any) => q.pathLabel.startsWith("english")),
      "only English questions (WBCS English included, mapped by path)"
    );
    assert.ok(english.body.questions.some((q: any) => q.examSlug === "wbcs"));
  });

  test("blueprint shows bank supply per topic; series cards show subject-wise status", async () => {
    const { and, eq, sql: dsql } = await import("drizzle-orm");
    const count = async (col: any, id: string) =>
      (
        await db
          .select({ n: dsql<number>`count(*)::int` })
          .from(m.questions)
          .where(and(eq(col, id), eq(m.questions.isActive, true), eq(m.questions.examId, ids["exam:clerkship"])))
      )[0].n;
    const english = ids["subj:clerkship:english"];
    const grammar = ids["chap:clerkship:grammar"];

    const bp = await call("GET", `/admin/series/${ids.mockSeries}/blueprint`);
    assert.equal(bp.body.blueprint.bank[`${english}||`].live, await count(m.questions.subjectId, english));
    assert.equal(bp.body.blueprint.bank[`${english}|${grammar}|`].live, await count(m.questions.chapterId, grammar));
    assert.equal(
      bp.body.blueprint.bank[`${english}|${grammar}|${ids["st:clerkship:tenses"]}`].live,
      await count(m.questions.subtopicId, ids["st:clerkship:tenses"])
    );

    const list = await call("GET", `/admin/series/exams/${ids["exam:clerkship"]}`);
    const mock = list.body.series.find((x: any) => x.id === ids.mockSeries);
    const eng = mock.subjects.find((x: any) => x.subjectId === english);
    assert.equal(eng.targetCount, 4);
    assert.equal(eng.inBank, await count(m.questions.subjectId, english));
    assert.equal(eng.selected, 4, "3 tenses + 1 synonym");
    assert.equal(mock.selectedCount, 6);
    assert.equal(mock.completionPct, 100);
  });
});

describe("publishing and replacing", () => {
  test("only complete series can be published", async () => {
    const incomplete = await setStatus(ids.mock2, "Mock Test 02", "published");
    assert.equal(incomplete.status, 409);
    assert.match(incomplete.body.error, /of 6 questions are selected/);
    const ok = await setStatus(ids.mockSeries, "Mock Test Series", "published");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.series.status, "published");
  });

  test("published series stay complete: remove is refused, replace is atomic", async () => {
    const [first] = JSON.parse(ids.tenses);
    const removal = await call("DELETE", `/admin/series/${ids.mockSeries}/assignments/${first}`);
    assert.equal(removal.status, 409);

    // Replacing with an ineligible question rolls back — the original stays
    const history = await bankQuestion("wbcs", "wbcs:revolt-1857", "Who led the revolt at Meerut");
    const bad = await call("POST", `/admin/series/${ids.mockSeries}/assignments/replace`, {
      removeQuestionId: first,
      addQuestionId: history,
    });
    assert.equal(bad.status, 409);
    const roster = await call("GET", `/admin/series/${ids.mockSeries}/roster`);
    assert.ok(roster.body.roster.assigned.some((a: any) => a.questionId === first));

    const replacement = await bankQuestion("clerkship", "clerkship:articles", "Use of the article an");
    const good = await call("POST", `/admin/series/${ids.mockSeries}/assignments/replace`, {
      removeQuestionId: first,
      addQuestionId: replacement,
    });
    assert.equal(good.status, 200);
    const ids2 = good.body.roster.assigned.map((a: any) => a.questionId);
    assert.ok(ids2.includes(replacement) && !ids2.includes(first));
    assert.equal(good.body.roster.assignedTotal, 6);
  });

  test("the pattern can't change the length of a published series, and it can't be deleted", async () => {
    const longer = SPLIT();
    longer[0] = { subjectId: ids["subj:clerkship:english"], targetCount: 5 };
    const r = await setBlueprint(ids.mockSeries, longer);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /published with 6 questions/);

    const del = await call("DELETE", `/admin/series/${ids.mockSeries}`);
    assert.equal(del.status, 409);
  });

  test("students see published series and are graded with its marks", async () => {
    const list = await call("GET", `/exams/${ids["exam:clerkship"]}/series`, undefined, studentToken);
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.series.map((s: any) => [s.id, s.totalQuestions]),
      [[ids.mockSeries, 6]],
      "drafts are hidden"
    );

    // The exam card counts published series per kind
    const examsList = await call("GET", "/exams", undefined, studentToken);
    const card = examsList.body.exams.find((e: any) => e.id === ids["exam:clerkship"]);
    assert.deepEqual(card.seriesCounts, { mock_test: 1 });
    assert.ok(card.subjectCount >= 2);

    const draft = await call("GET", `/exams/series/${ids.mock2}/test`, undefined, studentToken);
    assert.equal(draft.status, 404);

    const t = await call("GET", `/exams/series/${ids.mockSeries}/test`, undefined, studentToken);
    assert.equal(t.body.questions.length, 6);
    assert.equal("correctOption" in t.body.questions[0], false, "answers are not sent");

    const submit = await call(
      "POST",
      "/exams/submit",
      {
        examId: ids["exam:clerkship"],
        seriesId: ids.mockSeries,
        totalTimeSpentSeconds: 60,
        answers: t.body.questions.map((q: any, i: number) => ({
          questionId: q.id,
          selectedOption: i < 2 ? "A" : i < 3 ? "B" : null,
          status: i < 3 ? "answered" : "unanswered",
          timeSpentSeconds: 10,
        })),
      },
      studentToken
    );
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    // 2 correct × 2 − 1 wrong × 0.5 = 3.5 out of 12
    assert.equal(submit.body.overallSummary.finalNetScore, 3.5);
    assert.equal(submit.body.overallSummary.maxPossibleScore, 12);
    const { eq } = await import("drizzle-orm");
    const [attempt] = await db.select().from(m.testAttempts).where(eq(m.testAttempts.id, submit.body.attemptId));
    assert.equal(attempt.seriesId, ids.mockSeries);

    // History names the series
    const history = await call("GET", "/me/attempts", undefined, studentToken);
    const mine = history.body.attempts.find((a: any) => a.id === submit.body.attemptId);
    assert.deepEqual(mine.series, { id: ids.mockSeries, name: { en: "Mock Test Series", bn: "Mock Test Series" } });
  });
});

describe("series without negative marking", () => {
  test("a 0 negative mark is honoured when grading", async () => {
    const scheme = { kind: "practice", durationMinutes: 10, marksPerCorrect: 1, negativeMarksPerWrong: 0 };
    const seriesId = await newSeries("Practice (no negative)", [{ subjectId: ids["subj:clerkship:maths"], targetCount: 1 }], scheme);
    const q = await bankQuestion("clerkship", "clerkship:ratio", "Zero negative ratio question");
    await call("POST", `/admin/series/${seriesId}/assignments`, { questionIds: [q] });
    const pub = await setStatus(seriesId, "Practice (no negative)", "published", scheme);
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    const submit = await call(
      "POST",
      "/exams/submit",
      {
        examId: ids["exam:clerkship"],
        seriesId,
        totalTimeSpentSeconds: 5,
        answers: [{ questionId: q, selectedOption: "D", status: "answered", timeSpentSeconds: 5 }],
      },
      studentToken
    );
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    assert.equal(submit.body.overallSummary.incorrect, 1);
    assert.equal(submit.body.overallSummary.finalNetScore, 0, "no penalty when the series has none");
  });
});

describe("blueprint-aware AI generation", () => {
  const generate = (body: Record<string, unknown>) =>
    call("POST", "/admin/ingestion/generate", {
      examSlug: "clerkship",
      subjectSlug: "english",
      chapterSlug: "grammar",
      subtopicSlug: "tenses",
      difficulty: "mixed",
      ...body,
    });

  test("asking for more than the open vacancies is refused before any AI call", async () => {
    // English only, all 4 seats in Grammar
    ids.genSeries = await newSeries("Generation series", [
      { subjectId: ids["subj:clerkship:english"], targetCount: 4 },
    ]);
    await setBlueprint(ids.genSeries, [
      { subjectId: ids["subj:clerkship:english"], targetCount: 4 },
      { subjectId: ids["subj:clerkship:english"], chapterId: ids["chap:clerkship:grammar"], targetCount: 4 },
    ]);
    // Fill 1 grammar seat → 3 vacancies remain
    const [, second] = JSON.parse(ids.tenses);
    await call("POST", `/admin/series/${ids.genSeries}/assignments`, { questionIds: [second] });

    const callsBefore = ai.calls.length;
    const r = await generate({ count: 5, mode: "roster", seriesId: ids.genSeries });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ROSTER_VACANCY_EXCEEDED");
    assert.equal(r.body.allowed, 3);
    assert.match(r.body.error, /Only 3 vacancies remain/);
    assert.equal(ai.calls.length, callsBefore, "no AI tokens spent");

    const notInBlueprint = await generate({
      subjectSlug: "maths",
      chapterSlug: "arithmetic",
      subtopicSlug: "ratio",
      count: 1,
      mode: "roster",
      seriesId: ids.genSeries,
    });
    assert.equal(notInBlueprint.status, 409);
    assert.equal(notInBlueprint.body.code, "NOT_IN_ROSTER");
  });

  test("duplicates are removed in code and the shortfall is retried", async () => {
    const existingStem = "Tense question 2"; // already in the bank
    ai.queue.push(
      [
        fakeQuestion(existingStem, ["Tense question 2 a", "Tense question 2 b", "Tense question 2 c", "Tense question 2 d"]),
        fakeQuestion("Choose the correct past tense of the verb go"),
        fakeQuestion("Choose the correct past tense of the verb 'go'."), // near-dup in batch
      ],
      [fakeQuestion("Identify the future perfect tense in the sentence", ["will have", "had", "has", "was"]),
       fakeQuestion("Which sentence uses the present continuous tense", ["is going", "went", "goes", "gone"])]
    );
    const r = await generate({ count: 3, mode: "roster", seriesId: ids.genSeries });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.requested, 3);
    assert.equal(r.body.uniqueGenerated, 3);
    assert.equal(r.body.attempts, 2);
    assert.deepEqual(r.body.duplicatesDropped, { exact: 1, near: 0, inBatch: 1 });
    const retry = ai.calls.at(-1)!;
    assert.equal(retry.attempt, 1, "retry is a different cache key");
    assert.equal(retry.count, 2, "asks only for the shortfall");
    assert.ok(
      (retry.avoid_stems as string[]).includes("Choose the correct past tense of the verb go"),
      "retry is told what this request already produced"
    );
    ids.genBatch = r.body.batchId;

    // The 3 pending drafts now hold the 3 vacancies
    const v = await call("GET", `/admin/series/${ids.genSeries}/vacancy?subtopicId=${ids["st:clerkship:tenses"]}`);
    assert.equal(v.body.vacancy.assignable, 3);
    assert.equal(v.body.vacancy.generatable, 0);
    const more = await generate({ count: 1, mode: "roster", seriesId: ids.genSeries });
    assert.equal(more.status, 409);
  });

  test("bank mode creates reusable questions without touching any series", async () => {
    ai.queue.push([
      fakeQuestion("Choose the correct past tense of the verb go"), // exact dup of a pending row
      fakeQuestion("Spot the error in tense usage: He go to school yesterday"),
    ]);
    ai.queue.push([]); // retry returns nothing new
    const r = await generate({ count: 2, mode: "bank" });
    assert.equal(r.status, 201);
    assert.equal(r.body.uniqueGenerated, 1);
    assert.equal(r.body.duplicatesDropped.exact, 1);
    assert.equal(r.body.vacancy, null);
    const jobs = await call("GET", `/admin/ingestion/jobs?batchId=${r.body.batchId}&status=pending_review`);
    assert.equal(jobs.body.jobs[0].targetSeriesId, null);
  });
});

describe("approval workflow", () => {
  const pendingIds = async (batchId: string) =>
    (await call("GET", `/admin/ingestion/jobs/ids?batchId=${batchId}&status=pending_review`)).body.ids as string[];

  test("bulk approve needs no extra confirmation; approve + add re-checks vacancies", async () => {
    const jobIds = await pendingIds(ids.genBatch);
    assert.equal(jobIds.length, 3);
    const series = await call("GET", `/admin/series/exams/${ids["exam:clerkship"]}`);
    assert.equal(series.body.series.find((s: any) => s.id === ids.genSeries).reservedCount, 3);

    // Someone fills 2 of the 3 grammar seats by hand in the meantime
    const manual = await Promise.all(
      [1, 2].map((i) => bankQuestion("clerkship", "clerkship:articles", `Manual article question ${i}`))
    );
    await call("POST", `/admin/series/${ids.genSeries}/assignments`, { questionIds: manual });

    const r = await call("POST", "/admin/ingestion/jobs/approve", {
      ids: jobIds,
      assignToTargetSeries: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.inserted, 3, "all three join the bank");
    assert.equal(r.body.assigned, 1, "only one seat was left");
    assert.equal(r.body.results.filter((x: any) => x.status === "inserted_not_assigned").length, 2);
    const roster = await call("GET", `/admin/series/${ids.genSeries}/roster`);
    const grammar = roster.body.roster.slots.find((s: any) => s.chapterId === ids["chap:clerkship:grammar"]);
    assert.equal(grammar.assignedCount, 4);
    assert.equal(grammar.targetCount, 4);
    // Approval recorded the AI answers as checked by the reviewer
    const { inArray } = await import("drizzle-orm");
    const live = await db.select().from(m.questions).where(inArray(m.questions.ingestionJobId, jobIds));
    assert.ok(live.length === 3 && live.every((q: any) => q.answerKeyVerified));
  });

  test("double submission approves once", async () => {
    ai.queue.push([
      fakeQuestion("Pick the sentence in past perfect tense", ["had eaten", "eats", "will eat", "eating"]),
    ]);
    const gen = await call("POST", "/admin/ingestion/generate", {
      examSlug: "clerkship",
      subtopicSlug: "articles",
      count: 1,
      mode: "bank",
    });
    const [jobId] = await pendingIds(gen.body.batchId);
    const [a, c] = await Promise.all(
      [0, 1].map(() =>
        call("POST", "/admin/ingestion/jobs/approve", { ids: [jobId] })
      )
    );
    assert.equal(a.body.inserted + c.body.inserted, 1);
    assert.equal(a.body.notPendingReview + c.body.notPendingReview, 1);
    const { eq } = await import("drizzle-orm");
    const live = await db.select().from(m.questions).where(eq(m.questions.ingestionJobId, jobId));
    assert.equal(live.length, 1);
  });

  test("bulk reject keeps the rows and blocks the same question from coming back", async () => {
    ai.queue.push([
      fakeQuestion("Fill in the blank with the right article: ___ honest man", ["an", "a", "the", "no article"]),
      fakeQuestion("Fill in the blank with the right article: ___ university", ["a", "an", "the", "no article"]),
    ]);
    const gen = await call("POST", "/admin/ingestion/generate", {
      examSlug: "clerkship",
      subtopicSlug: "articles",
      count: 2,
      mode: "bank",
    });
    const jobIds = await pendingIds(gen.body.batchId);
    const r = await call("POST", "/admin/ingestion/jobs/reject", {
      ids: [...jobIds, "00000000-0000-4000-8000-000000000000"],
      reviewNotes: "Too easy",
    });
    assert.equal(r.body.rejected, 2);
    assert.equal(r.body.results.find((x: any) => x.status === "not_rejectable").id, "00000000-0000-4000-8000-000000000000");
    const rejected = await call("GET", `/admin/ingestion/jobs?batchId=${gen.body.batchId}&status=rejected`);
    assert.equal(rejected.body.jobs[0].reviewNotes, "Too easy");

    // The AI offers one rejected question again (reworded) — it is dropped
    ai.queue.push([
      fakeQuestion("Fill in the blank with the correct article: ___ honest man", ["an", "a", "the", "no article"]),
    ]);
    ai.queue.push([]);
    const again = await call("POST", "/admin/ingestion/generate", {
      examSlug: "clerkship",
      subtopicSlug: "articles",
      count: 1,
      mode: "bank",
    });
    assert.equal(again.body.uniqueGenerated, 0);
    assert.equal(again.body.duplicatesDropped.near + again.body.duplicatesDropped.exact, 1);
    assert.match(again.body.errors[0].message, /staged row/);
  });

  test("review filters narrow by subtopic, source and date", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await call(
      "GET",
      `/admin/ingestion/jobs?status=all&subtopicId=${ids["st:clerkship:articles"]}&source=ai_generated&createdFrom=${today}&createdTo=${today}`
    );
    assert.equal(r.status, 200);
    assert.ok(r.body.total >= 3);
    assert.ok(r.body.jobs.every((j: any) => j.draft.subtopicSlug === "articles"));
    const none = await call("GET", `/admin/ingestion/jobs?status=all&createdTo=2000-01-01`);
    assert.equal(none.body.total, 0);
  });
});
