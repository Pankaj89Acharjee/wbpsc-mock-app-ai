import { test } from "node:test";
import assert from "node:assert/strict";
import { sameConcept } from "../src/lib/syllabus";

test("headings that name the same concept are matched", () => {
  assert.ok(sameConcept("National Movement", "Indian National Movement"));
  assert.ok(sameConcept("History of India & National Movement", "History of India & Indian National Movement"));
  assert.ok(sameConcept("Constitution of India", "Indian Constitution"));
  assert.ok(sameConcept("Fundamental Rights", "Fundamental rights"));
  assert.ok(sameConcept("Rivers of West Bengal", "West Bengal Rivers"));
});

test("different concepts are kept apart", () => {
  assert.ok(!sameConcept("Indian Economy", "Indian Polity"));
  assert.ok(!sameConcept("Geography", "Indian Geography"), "one word inside a longer heading is not enough");
  assert.ok(!sameConcept("Mughal Empire", "Maurya Empire"));
  assert.ok(!sameConcept("Percentage", "Profit and Loss"));
});
