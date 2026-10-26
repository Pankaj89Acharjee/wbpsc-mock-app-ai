import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/index";
import { questionIngestionJobs, questions, type IngestionStatusType } from "../db/schema";
import { OptionKeySchema, type OptionKey } from "../../../../packages/shared-types/src/index";

// ============================================================================
// Near-duplicate detection for question stems.
//
// Exact duplicates are caught by `content_hash` (normalised stem + sorted
// options, see lib/contentHash.ts). This module catches reworded copies:
//
//   duplicate ⇔ same correct-answer text (when both are known)
//             ∧ ( stem trigram similarity ≥ STEM_HIGH
//               ∨ (stem similarity ≥ STEM_LOW ∧ ≥ 3 of 4 options the same) )
//
// The answer check keeps template-style items apart: "___ honest man" and
// "___ university" share stem and options but have different answers.
//
// Trigram similarity is the same measure pg_trgm uses, so PostgreSQL can
// pre-filter candidates with a GIN index and the final decision is made here,
// identically, whether or not the extension is installed. No embeddings: no
// extra AI cost and no vector infrastructure for a few thousand stems.
// ============================================================================

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
};
export const STEM_HIGH = num(process.env.QUESTION_NEAR_DUP_THRESHOLD, 0.8);
export const STEM_LOW = 0.55;
export const OPTION_OVERLAP = 0.75;

export interface StemProbe {
  stemEn: string;
  optionsEn: string[];
  /** English text of the correct option, when known */
  answerEn?: string;
}

export interface NearMatch {
  kind: "question" | "staged";
  id: string;
  score: number;
  stemEn: string;
}

export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** pg_trgm-style trigrams: each word padded with two leading and one trailing space. */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalizeText(s).split(" ")) {
    if (!word) continue;
    const padded = `  ${word} `;
    const chars = [...padded];
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(""));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Share of options (by normalised text, any order) the two questions have in common. */
export function optionOverlap(a: string[], b: string[]): number {
  const sa = new Set(a.map(normalizeText).filter(Boolean));
  const sb = new Set(b.map(normalizeText).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const o of sa) if (sb.has(o)) shared++;
  return shared / Math.max(sa.size, sb.size);
}

/** Similarity score if `a` is a near-duplicate of `b`, else null. */
export function nearDuplicateScore(a: StemProbe, b: StemProbe): number | null {
  if (a.answerEn && b.answerEn && normalizeText(a.answerEn) !== normalizeText(b.answerEn)) {
    return null;
  }
  const s = trigramSimilarity(a.stemEn, b.stemEn);
  if (s >= STEM_HIGH) return s;
  if (s >= STEM_LOW && optionOverlap(a.optionsEn, b.optionsEn) >= OPTION_OVERLAP) return s;
  return null;
}

export const optionsEn = (options: Record<OptionKey, { en: string }>) =>
  OptionKeySchema.options.map((k) => options[k]?.en ?? "");

/** Probe for a question/draft with bilingual options and a correct option key. */
export function probeOf(q: {
  stem: { en: string };
  options: Record<OptionKey, { en: string }>;
  correctOption?: OptionKey | null;
}): StemProbe {
  return {
    stemEn: q.stem.en,
    optionsEn: optionsEn(q.options),
    answerEn: q.correctOption ? q.options[q.correctOption]?.en : undefined,
  };
}

/** First earlier probe in the same list that `probes[i]` duplicates. */
export function findInBatch(probes: StemProbe[], i: number): { index: number; score: number } | null {
  for (let j = 0; j < i; j++) {
    const score = nearDuplicateScore(probes[i], probes[j]);
    if (score !== null) return { index: j, score };
  }
  return null;
}

let trgmAvailable: boolean | null = null;
async function hasPgTrgm(): Promise<boolean> {
  if (trgmAvailable === null) {
    const rows = await db.execute<{ ok: boolean }>(
      sql`select exists(select 1 from pg_extension where extname = 'pg_trgm') as ok`
    );
    trgmAvailable = Boolean((rows as unknown as Array<{ ok: boolean }>)[0]?.ok);
  }
  return trgmAvailable;
}

interface CandidateRow {
  idx: number;
  id: string;
  kind: "question" | "staged";
  stem: string;
  options: Record<OptionKey, { en: string }> | null;
  correct: OptionKey | null;
}

/**
 * Best near-duplicate in the bank (live + retired questions) and, when
 * `stagedStatuses` is given, among staging rows in those statuses.
 * Returns one entry per probe (null = no near-duplicate).
 */
export async function findNearDuplicates(
  probes: StemProbe[],
  stagedStatuses: IngestionStatusType[] = []
): Promise<Array<NearMatch | null>> {
  if (probes.length === 0) return [];
  const stems = probes.map((p) => p.stemEn);
  let rows: CandidateRow[];

  if (await hasPgTrgm()) {
    rows = await db.transaction(async (tx) => {
      // `%` uses the GIN trigram index; threshold applies to this transaction only
      await tx.execute(sql`select set_config('pg_trgm.similarity_threshold', ${String(STEM_LOW)}, true)`);
      const stemArray = sql`array[${sql.join(
        stems.map((s) => sql`${s}`),
        sql`, `
      )}]::text[]`;
      const statusList = sql.join(
        stagedStatuses.map((s) => sql`${s}`),
        sql`, `
      );
      const live = await tx.execute(sql`
        select p.idx::int as idx, c.id, 'question' as kind, c.stem, c.options, c.correct
        from unnest(${stemArray}) with ordinality as p(stem, idx)
        join lateral (
          select q.id, q.stem ->> 'en' as stem, q.options, q.correct_option::text as correct
          from ${questions} q
          where (q.stem ->> 'en') % p.stem
          order by similarity(q.stem ->> 'en', p.stem) desc
          limit 5
        ) c on true`);
      let staged: unknown[] = [];
      if (stagedStatuses.length > 0) {
        staged = await tx.execute(sql`
          select p.idx::int as idx, c.id, 'staged' as kind, c.stem, c.options, c.correct
          from unnest(${stemArray}) with ordinality as p(stem, idx)
          join lateral (
            select j.id, (j.enriched_data -> 'stem') ->> 'en' as stem, j.enriched_data -> 'options' as options,
                   j.enriched_data ->> 'correctOption' as correct
            from ${questionIngestionJobs} j
            where j.status in (${statusList})
              and ((j.enriched_data -> 'stem') ->> 'en') % p.stem
            order by similarity((j.enriched_data -> 'stem') ->> 'en', p.stem) desc
            limit 5
          ) c on true`);
      }
      return [...(live as unknown as CandidateRow[]), ...(staged as unknown as CandidateRow[])].map(
        (r) => ({ ...r, idx: Number(r.idx) - 1 })
      );
    });
  } else {
    // No pg_trgm: compare against every stem in process (fine for a few thousand rows)
    const [live, staged] = await Promise.all([
      db
        .select({
          id: questions.id,
          stem: sql<string>`${questions.stem} ->> 'en'`,
          options: questions.options,
          correct: questions.correctOption,
        })
        .from(questions)
        .limit(20_000),
      stagedStatuses.length > 0
        ? db
            .select({
              id: questionIngestionJobs.id,
              stem: sql<string>`(${questionIngestionJobs.enrichedData} -> 'stem') ->> 'en'`,
              options: sql<Record<OptionKey, { en: string }>>`${questionIngestionJobs.enrichedData} -> 'options'`,
              correct: sql<OptionKey | null>`${questionIngestionJobs.enrichedData} ->> 'correctOption'`,
            })
            .from(questionIngestionJobs)
            .where(
              and(
                inArray(questionIngestionJobs.status, stagedStatuses),
                isNotNull(questionIngestionJobs.enrichedData)
              )
            )
            .limit(20_000)
        : Promise.resolve([]),
    ]);
    const all = [
      ...live.map((r) => ({ ...r, kind: "question" as const })),
      ...staged.map((r) => ({ ...r, kind: "staged" as const })),
    ];
    rows = probes.flatMap((_, idx) => all.map((r) => ({ ...r, idx })));
  }

  const best: Array<NearMatch | null> = probes.map(() => null);
  for (const r of rows) {
    if (!r.stem) continue;
    const score = nearDuplicateScore(
      probes[r.idx],
      r.options
        ? probeOf({ stem: { en: r.stem }, options: r.options, correctOption: r.correct })
        : { stemEn: r.stem, optionsEn: [] }
    );
    if (score !== null && (!best[r.idx] || score > best[r.idx]!.score)) {
      best[r.idx] = { kind: r.kind, id: r.id, score, stemEn: r.stem };
    }
  }
  return best;
}

/** Hashes already present live or (optionally) in staging, mapped to a description. */
export async function existingHashes(
  hashes: string[],
  stagedStatuses: IngestionStatusType[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (hashes.length === 0) return found;
  const live = await db
    .select({ id: questions.id, hash: questions.contentHash })
    .from(questions)
    .where(inArray(questions.contentHash, hashes));
  live.forEach((r) => r.hash && found.set(r.hash, `bank question ${r.id}`));
  if (stagedStatuses.length > 0) {
    const staged = await db
      .select({
        hash: questionIngestionJobs.contentHash,
        batchId: questionIngestionJobs.batchId,
        status: questionIngestionJobs.status,
      })
      .from(questionIngestionJobs)
      .where(
        and(
          inArray(questionIngestionJobs.contentHash, hashes),
          inArray(questionIngestionJobs.status, stagedStatuses)
        )
      );
    staged.forEach(
      (r) =>
        r.hash &&
        !found.has(r.hash) &&
        found.set(r.hash, `a ${r.status.replace("_", " ")} row in batch ${r.batchId}`)
    );
  }
  return found;
}

/** Forget the cached extension check (tests switch databases). */
export function resetDedupeCache() {
  trgmAvailable = null;
}
