import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import postgres from "postgres";

// ============================================================================
// Integration-test plumbing: a throwaway PostgreSQL database built from the
// migrations, and a fake api-ai so no test ever calls Gemini.
//
// The database name must contain "test" — the helpers refuse anything else so
// a misconfigured env can never drop the development database.
// ============================================================================

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Same server as DATABASE_URL, separate database (override with TEST_DATABASE_URL). */
const BASE_URL =
  process.env.TEST_DATABASE_URL ||
  withDatabase(
    process.env.DATABASE_URL || "postgresql://wbpsc_admin:wbpsc_local_dev_2026@localhost:5432/wbpsc_prep",
    "wbpsc_test_core"
  );

/** Drops and recreates `name` (must contain "test"); returns its URL. */
export async function recreateDatabase(name = new URL(BASE_URL).pathname.slice(1)): Promise<string> {
  if (!/test/i.test(name)) throw new Error(`Refusing to recreate non-test database "${name}"`);
  const admin = postgres(withDatabase(BASE_URL, "postgres"), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return withDatabase(BASE_URL, name);
}

export async function dropDatabase(name: string): Promise<void> {
  if (!/test/i.test(name)) throw new Error(`Refusing to drop non-test database "${name}"`);
  const admin = postgres(withDatabase(BASE_URL, "postgres"), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

// ─── Fake api-ai ────────────────────────────────────────────────────────────

export interface FakeQuestion {
  stem: { en: string; bn: string };
  options: Record<"A" | "B" | "C" | "D", { en: string; bn: string }>;
  correct_option: "A" | "B" | "C" | "D";
  explanation: { en: string; bn: string };
  difficulty: "easy" | "moderate" | "hard";
  confidence: number;
}

/** Bilingual MCQ whose stem/options are derived from `text`. */
export function fakeQuestion(text: string, options = ["alpha", "beta", "gamma", "delta"]): FakeQuestion {
  const b = (en: string) => ({ en, bn: `বাংলা ${en}` });
  return {
    stem: b(text),
    options: { A: b(options[0]), B: b(options[1]), C: b(options[2]), D: b(options[3]) },
    correct_option: "B",
    explanation: b(`Because ${text}`),
    difficulty: "moderate",
    confidence: 0.9,
  };
}

export interface FakeAi {
  url: string;
  token: string;
  /** Request bodies received, in order */
  calls: Array<Record<string, unknown>>;
  /** Responses served in order (each a list of questions) */
  queue: FakeQuestion[][];
  close: () => Promise<void>;
}

export async function startFakeAi(): Promise<FakeAi> {
  const fake: FakeAi = { url: "", token: "test-internal-token", calls: [], queue: [], close: async () => {} };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers["x-internal-token"] !== fake.token) {
        res.writeHead(401).end(JSON.stringify({ detail: "bad token" }));
        return;
      }
      fake.calls.push(JSON.parse(body || "{}"));
      const questions = fake.queue.shift() ?? [];
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ questions, model_used: "fake-model", cache_tier: "gemini", cache_key: "fake" })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}
