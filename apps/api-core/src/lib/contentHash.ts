import { createHash } from "node:crypto";
import {
  normalizeForContentHash,
  type OptionKey,
} from "../../../../packages/shared-types/src/index";

/**
 * SHA-256 duplicate-detection key shared by `questions` and
 * `question_ingestion_jobs` (see normalizeForContentHash for the rules).
 */
export function computeContentHash(q: {
  stem: { en: string };
  options: Record<OptionKey, { en: string }>;
}): string {
  return createHash("sha256")
    .update(normalizeForContentHash(q.stem.en, q.options))
    .digest("hex");
}
