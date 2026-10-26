import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRosterState,
  fullReason,
  parentSlot,
  slotVacancies,
  usageConflicts,
  vacancyFor,
  validateRosterConfig,
  type NodePath,
  type SlotNode,
} from "../src/lib/roster";

// Syllabus ids: two subjects, chapters and subtopics named for readability
const ENG = "eng", GRAMMAR = "grammar", VOCAB = "vocab", TENSES = "tenses", ARTICLES = "articles", SYN = "syn";
const MATH = "math", ARITH = "arith", PCT = "pct", RATIO = "ratio", GEOM = "geom", AREA = "area";

const path = (subjectId: string, chapterId: string, subtopicId: string): NodePath => ({
  subjectId,
  chapterId,
  subtopicId,
});
const slot = (
  id: string,
  subjectId: string,
  chapterId: string | null,
  subtopicId: string | null,
  targetCount: number
): SlotNode => ({ id, subjectId, chapterId, subtopicId, targetCount });
const label = (s: Pick<SlotNode, "subjectId" | "chapterId" | "subtopicId">) =>
  [s.subjectId, s.chapterId, s.subtopicId].filter(Boolean).join("/");
const times = <T>(n: number, v: T) => Array.from({ length: n }, () => v);

test("a topic slot stops accepting questions at its target", () => {
  const slots = [slot("g", ENG, GRAMMAR, null, 15)];
  const state = buildRosterState(slots, times(14, path(ENG, GRAMMAR, TENSES)));
  assert.equal(vacancyFor(state, path(ENG, GRAMMAR, ARTICLES), "assign").allowed, 1);

  const full = buildRosterState(slots, times(15, path(ENG, GRAMMAR, TENSES)));
  const v = vacancyFor(full, path(ENG, GRAMMAR, ARTICLES), "assign");
  assert.equal(v.eligible, true);
  assert.equal(v.allowed, 0);
});

test("questions outside every slot are not eligible", () => {
  const state = buildRosterState([slot("g", ENG, GRAMMAR, null, 15)], []);
  const v = vacancyFor(state, path(ENG, VOCAB, SYN), "assign");
  assert.equal(v.eligible, false);
  assert.equal(v.allowed, 0);
});

test("child slots are carved out of the parent, not counted twice", () => {
  // Maths 30 = Arithmetic 20 + Percentage-in-arithmetic 10 (nested) — total stays 30
  const slots = [
    slot("m", MATH, null, null, 30),
    slot("a", MATH, ARITH, null, 20),
    slot("p", MATH, ARITH, PCT, 10),
  ];
  const state = buildRosterState(slots, []);
  assert.equal(state.rosterTotal, 30, "only the top-level slot counts toward the test total");
  assert.equal(parentSlot(slots[2], slots)?.id, "a");
  assert.equal(parentSlot(slots[1], slots)?.id, "m");

  // Arithmetic has 20 seats, 10 of them earmarked for Percentage → 10 for other arithmetic
  assert.equal(vacancyFor(state, path(MATH, ARITH, RATIO), "assign").allowed, 10);
  assert.equal(vacancyFor(state, path(MATH, ARITH, PCT), "assign").allowed, 10);
  // Maths 30 − Arithmetic 20 → 10 seats for any other maths chapter
  assert.equal(vacancyFor(state, path(MATH, GEOM, AREA), "assign").allowed, 10);
});

test("a fully allocated parent has no room outside its child slots", () => {
  // The spec's example: Arithmetic 20 + Percentage 10 = Mathematics 30
  const slots = [
    slot("m", MATH, null, null, 30),
    slot("a", MATH, ARITH, null, 20),
    slot("g", MATH, GEOM, null, 10),
  ];
  const state = buildRosterState(slots, []);
  const v = vacancyFor(state, path(MATH, "algebra", "linear"), "assign", label);
  assert.equal(v.eligible, true);
  assert.equal(v.allowed, 0);
  assert.match(v.limits.at(-1)!.label, /outside its sub-slots/);
});

test("the most restrictive applicable limit wins", () => {
  // Maths 30 with 20 already assigned; Arithmetic 20 with 5 assigned.
  // Arithmetic alone would allow 15, but Maths only has 10 left.
  const slots = [slot("m", MATH, null, null, 30), slot("a", MATH, ARITH, null, 20)];
  const assigned = [...times(5, path(MATH, ARITH, PCT)), ...times(5, path(MATH, GEOM, AREA))];
  // Legacy over-fill outside Arithmetic (normally prevented) makes Maths the binding limit
  const state = buildRosterState(slots, [...assigned, ...times(10, path(MATH, GEOM, AREA))]);
  const v = vacancyFor(state, path(MATH, ARITH, PCT), "assign", label);
  assert.equal(v.allowed, 10);
  assert.equal(v.bindingSlotId, "m");
});

test("pending AI drafts limit generation but not manual assignment", () => {
  const slots = [slot("m", MATH, null, null, 30)];
  const state = buildRosterState(
    slots,
    times(20, path(MATH, ARITH, PCT)),
    times(4, path(MATH, ARITH, PCT))
  );
  assert.equal(vacancyFor(state, path(MATH, ARITH, PCT), "assign").allowed, 10);
  assert.equal(vacancyFor(state, path(MATH, ARITH, PCT), "generate").allowed, 6);
});

test("blueprint: topics can't exceed their subject, and need a subject count", () => {
  assert.deepEqual(
    validateRosterConfig(
      [slot("e", ENG, null, null, 30), slot("g", ENG, GRAMMAR, null, 15), slot("v", ENG, VOCAB, null, 15)],
      label
    ),
    []
  );

  const tooManyChildren = validateRosterConfig(
    [slot("e", ENG, null, null, 20), slot("g", ENG, GRAMMAR, null, 15), slot("v", ENG, VOCAB, null, 15)],
    label
  );
  assert.equal(tooManyChildren.length, 1);
  assert.match(tooManyChildren[0], /add up to 30.*has only 20/);

  const orphanTopic = validateRosterConfig([slot("g", ENG, GRAMMAR, null, 5)], label);
  assert.match(orphanTopic[0], /give its subject a question count first/);

  const dupe = validateRosterConfig(
    [slot("e", ENG, null, null, 10), slot("a", ENG, GRAMMAR, null, 5), slot("b", ENG, GRAMMAR, null, 5)],
    label
  );
  assert.match(dupe[0], /more than once/);
});

test("a Clerkship-style blueprint: subject counts add up, topics fill inside them", () => {
  const GS = "gs", HIST = "hist";
  const slots = [
    slot("gs", GS, null, null, 40),
    slot("e", ENG, null, null, 30),
    slot("m", MATH, null, null, 30),
    slot("g", ENG, GRAMMAR, null, 15),
    slot("v", ENG, VOCAB, null, 15),
    slot("p", MATH, PCT, null, 10),
  ];
  assert.deepEqual(validateRosterConfig(slots, label), []);
  const state = buildRosterState(slots, times(15, path(ENG, GRAMMAR, TENSES)));
  assert.equal(state.rosterTotal, 100, "GS 40 + English 30 + Maths 30");
  assert.equal(slotVacancies(state, slots[3]), 0, "Grammar is full");
  assert.equal(slotVacancies(state, slots[4]), 15, "Vocabulary still open");
  assert.equal(vacancyFor(state, path(GS, HIST, "any"), "assign").allowed, 40, "GS has no topic split");
  assert.equal(vacancyFor(state, path(MATH, PCT, "pct-basic"), "assign").allowed, 10);
});

test("usage conflicts block roster edits that would strand assigned questions", () => {
  const assigned = times(8, path(ENG, GRAMMAR, TENSES));
  const lowered = buildRosterState([slot("g", ENG, GRAMMAR, null, 5)], assigned);
  assert.match(usageConflicts(lowered, label)[0], /already has 8 assigned questions \(target 5\)/);

  const removed = buildRosterState([slot("v", ENG, VOCAB, null, 10)], assigned);
  assert.match(usageConflicts(removed, label)[0], /no longer belong to any roster slot/);

  // Adding a child slot that leaves too little room for questions already in the parent
  const carved = buildRosterState(
    [slot("e", ENG, null, null, 10), slot("v", ENG, VOCAB, null, 5)],
    assigned
  );
  assert.match(usageConflicts(carved, label)[0], /outside its sub-slots, which now leave room for only 5/);

  const fine = buildRosterState([slot("g", ENG, GRAMMAR, null, 10)], assigned);
  assert.deepEqual(usageConflicts(fine, label), []);
});

test("a subject whose seats all went to one topic says so instead of 'is full'", () => {
  // English 4, all 4 given to Grammar (2 used): a Vocabulary question has nowhere to go
  const slots = [slot("e", ENG, null, null, 4), slot("g", ENG, GRAMMAR, null, 4)];
  const state = buildRosterState(slots, [path(ENG, GRAMMAR, TENSES), path(ENG, GRAMMAR, ARTICLES)]);
  const v = vacancyFor(state, path(ENG, VOCAB, SYN), "assign", label);
  assert.equal(v.allowed, 0);
  assert.match(fullReason(v, "eng"), /no seats for other topics: all 4 are given to its topics/);
  // Grammar itself still has room
  assert.equal(vacancyFor(state, path(ENG, GRAMMAR, TENSES), "assign", label).allowed, 2);
});
