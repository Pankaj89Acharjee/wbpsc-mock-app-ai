import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findInBatch,
  nearDuplicateScore,
  normalizeText,
  optionOverlap,
  probeOf,
  trigramSimilarity,
  type StemProbe,
} from "../src/lib/dedupe";
import { computeContentHash } from "../src/lib/contentHash";

const opts = (a: string, b: string, c: string, d: string) => ({
  A: { en: a },
  B: { en: b },
  C: { en: c },
  D: { en: d },
});
const probe = (stemEn: string, optionsEn: string[]): StemProbe => ({ stemEn, optionsEn });

test("exact duplicates survive whitespace, case, punctuation and option order", () => {
  const a = computeContentHash({
    stem: { en: "Who wrote 'Anandamath'?" },
    options: opts("Rabindranath Tagore", "Bankim Chandra Chattopadhyay", "Sarat Chandra", "Michael Madhusudan"),
  });
  const b = computeContentHash({
    stem: { en: "  WHO wrote   Anandamath " },
    options: opts("Michael Madhusudan", "sarat chandra", "Bankim Chandra Chattopadhyay!", "Rabindranath  Tagore"),
  });
  assert.equal(a, b);
  assert.equal(normalizeText("  Hello,   World! "), "hello world");
});

test("trigram similarity behaves like pg_trgm on the basics", () => {
  assert.equal(trigramSimilarity("The Battle of Plassey", "the battle of plassey!"), 1);
  assert.ok(trigramSimilarity("Battle of Plassey was fought in", "Capital of West Bengal") < 0.2);
});

test("a reworded stem is a near-duplicate", () => {
  const original = probe("In which year was the Battle of Plassey fought?", ["1757", "1764", "1857", "1765"]);
  const reworded = probe("In which year was the Battle of Plassey fought between", ["1757", "1764", "1857", "1765"]);
  assert.ok(nearDuplicateScore(reworded, original) !== null);
});

test("a lightly reworded stem with the same options is a near-duplicate", () => {
  const original = probe("Which river is known as the Sorrow of Bengal?", ["Damodar", "Teesta", "Hooghly", "Ajay"]);
  const reworded = probe("Which river is called the 'Sorrow of Bengal'?", ["Ajay", "Hooghly", "Damodar", "Teesta"]);
  assert.equal(optionOverlap(original.optionsEn, reworded.optionsEn), 1);
  assert.ok(nearDuplicateScore(reworded, original) !== null);
});

test("different questions on the same topic are not duplicates", () => {
  const a = probe("Which river is known as the Sorrow of Bengal?", ["Damodar", "Teesta", "Hooghly", "Ajay"]);
  const b = probe("On which river is the Farakka Barrage built?", ["Ganga", "Teesta", "Hooghly", "Damodar"]);
  const c = probe("Which river is known as the Sorrow of Bihar?", ["Kosi", "Gandak", "Son", "Bagmati"]);
  assert.equal(nearDuplicateScore(b, a), null);
  assert.equal(nearDuplicateScore(c, a), null, "similar wording but different options/answer → distinct");
});

test("template items with different answers are not duplicates", () => {
  const a = probeOf({
    stem: { en: "Fill in the blank with the right article: ___ honest man" },
    options: opts("a", "an", "the", "no article"),
    correctOption: "B",
  });
  const b = probeOf({
    stem: { en: "Fill in the blank with the right article: ___ university" },
    options: opts("an", "a", "the", "no article"),
    correctOption: "B",
  });
  assert.equal(a.answerEn, "an");
  assert.equal(b.answerEn, "a");
  assert.equal(nearDuplicateScore(a, b), null);
  // Same answer → the reworded copy is still caught
  const reworded = probeOf({
    stem: { en: "Fill in the blank with the correct article: ___ honest man" },
    options: opts("the", "an", "a", "no article"),
    correctOption: "B",
  });
  assert.ok(nearDuplicateScore(reworded, a) !== null);
});

test("in-batch near-duplicates point at the earlier copy", () => {
  const batch = [
    probe("Who founded the Asiatic Society in Calcutta?", ["William Jones", "Warren Hastings", "Carey", "Hare"]),
    probe("What is the capital of West Bengal?", ["Kolkata", "Howrah", "Siliguri", "Durgapur"]),
    probe("Who founded the Asiatic Society at Calcutta?", ["Warren Hastings", "William Jones", "Hare", "Carey"]),
  ];
  assert.equal(findInBatch(batch, 1), null);
  assert.equal(findInBatch(batch, 2)?.index, 0);
});
