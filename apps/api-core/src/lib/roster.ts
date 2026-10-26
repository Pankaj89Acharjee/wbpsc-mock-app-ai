import type { RosterLevel, VacancyLimitDto } from "../../../../packages/shared-types/src/index";

// ============================================================================
// Series blueprint rules (pure — no database; see lib/series.ts for persistence).
// A test series is filled against its own blueprint.
//
// A slot targets a syllabus node: Subject, Subject→Chapter or
// Subject→Chapter→Subtopic. Each subject has a question count; topics inside
// it are a SUB-LIMIT carved out of the subject's seats, never counted twice.
//
//   Mathematics 30  ├─ Arithmetic 20
//                   └─ Percentage 10    → 0 seats left for other maths chapters
//
//   Rules
//   1. Topic slots need their subject slot; Σ child targets ≤ parent target.
//      Test length = Σ subject counts.
//   2. A question counts toward every slot that contains it.
//   3. Its seats come from the DEEPEST matching slot: target − Σ child targets
//      − questions already sitting directly in it. Ancestors are re-checked as
//      a safety net, and the smallest remainder wins ("most restrictive").
//   4. A question that matches no slot is not eligible for the series.
// ============================================================================

export interface SlotNode {
  id: string;
  subjectId: string;
  chapterId: string | null;
  subtopicId: string | null;
  targetCount: number;
}

/** Where a question sits in the series' exam syllabus. */
export interface NodePath {
  subjectId: string;
  chapterId: string;
  subtopicId: string;
}

const DEPTH: Record<RosterLevel, number> = { subject: 0, chapter: 1, subtopic: 2 };

export function slotLevel(s: Pick<SlotNode, "chapterId" | "subtopicId">): RosterLevel {
  return s.subtopicId ? "subtopic" : s.chapterId ? "chapter" : "subject";
}

const nodeKey = (s: Pick<SlotNode, "subjectId" | "chapterId" | "subtopicId">) =>
  `${s.subjectId}/${s.chapterId ?? "*"}/${s.subtopicId ?? "*"}`;

/** True when `outer` is a strictly broader node that contains `inner`. */
export function slotContains(outer: SlotNode, inner: SlotNode): boolean {
  if (outer.subjectId !== inner.subjectId) return false;
  if (outer.chapterId === null) return inner.chapterId !== null;
  if (outer.subtopicId === null) return inner.chapterId === outer.chapterId && inner.subtopicId !== null;
  return false;
}

export function slotMatches(slot: SlotNode, path: NodePath): boolean {
  return (
    slot.subjectId === path.subjectId &&
    (slot.chapterId === null || slot.chapterId === path.chapterId) &&
    (slot.subtopicId === null || slot.subtopicId === path.subtopicId)
  );
}

/** Slots containing `path`, outermost first (at most one per level). */
export function matchingChain(slots: SlotNode[], path: NodePath): SlotNode[] {
  return slots
    .filter((s) => slotMatches(s, path))
    .sort((a, b) => DEPTH[slotLevel(a)] - DEPTH[slotLevel(b)]);
}

/** Nearest enclosing slot, or null for a top-level slot. */
export function parentSlot(slot: SlotNode, slots: SlotNode[]): SlotNode | null {
  let best: SlotNode | null = null;
  for (const s of slots) {
    if (s !== slot && slotContains(s, slot)) {
      if (!best || DEPTH[slotLevel(s)] > DEPTH[slotLevel(best)]) best = s;
    }
  }
  return best;
}

export type Labeler = (s: Pick<SlotNode, "subjectId" | "chapterId" | "subtopicId">) => string;

/**
 * Structural checks for a series blueprint before it is saved: every topic
 * target sits inside a subject that has a question count, and topics never
 * add up to more than their subject. Taxonomy membership (chapter ∈ subject,
 * subtopic ∈ chapter, subject ∈ exam) is checked against the database.
 */
export function validateRosterConfig(slots: SlotNode[], label: Labeler): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const s of slots) {
    const key = nodeKey(s);
    if (seen.has(key)) errors.push(`${label(s)} appears more than once`);
    seen.add(key);
  }

  const subjects = new Set(slots.filter((s) => slotLevel(s) === "subject").map((s) => s.subjectId));
  for (const s of slots) {
    if (slotLevel(s) !== "subject" && !subjects.has(s.subjectId)) {
      errors.push(`${label(s)}: give its subject a question count first`);
    }
  }

  const childSum = new Map<string, number>();
  for (const s of slots) {
    const parent = parentSlot(s, slots);
    if (parent) childSum.set(parent.id, (childSum.get(parent.id) ?? 0) + s.targetCount);
  }
  for (const s of slots) {
    const sum = childSum.get(s.id) ?? 0;
    if (sum > s.targetCount) {
      errors.push(`Topics inside ${label(s)} add up to ${sum}, but ${label(s)} has only ${s.targetCount}`);
    }
  }
  return errors;
}

export interface RosterState {
  slots: SlotNode[];
  parentId: Map<string, string | null>;
  childTargets: Map<string, number>;
  /** Inside the slot's subtree */
  assignedIn: Map<string, number>;
  reservedIn: Map<string, number>;
  /** Deepest matching slot is this one */
  assignedDirect: Map<string, number>;
  reservedDirect: Map<string, number>;
  /** Assigned questions no slot covers (only after a roster edit gone wrong) */
  unslottedAssigned: number;
  rosterTotal: number;
}

const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/**
 * Counts per slot. `reserved` = pending AI drafts generated for this series;
 * they only limit further generation, not manual assignment.
 */
export function buildRosterState(
  slots: SlotNode[],
  assigned: NodePath[],
  reserved: NodePath[] = []
): RosterState {
  const state: RosterState = {
    slots,
    parentId: new Map(),
    childTargets: new Map(),
    assignedIn: new Map(),
    reservedIn: new Map(),
    assignedDirect: new Map(),
    reservedDirect: new Map(),
    unslottedAssigned: 0,
    rosterTotal: 0,
  };
  for (const s of slots) {
    const parent = parentSlot(s, slots);
    state.parentId.set(s.id, parent?.id ?? null);
    if (parent) bump(state.childTargets, parent.id, s.targetCount);
    else state.rosterTotal += s.targetCount;
  }
  const tally = (paths: NodePath[], inMap: Map<string, number>, directMap: Map<string, number>) => {
    let unslotted = 0;
    for (const p of paths) {
      const chain = matchingChain(slots, p);
      if (chain.length === 0) {
        unslotted++;
        continue;
      }
      chain.forEach((s) => bump(inMap, s.id));
      bump(directMap, chain[chain.length - 1].id);
    }
    return unslotted;
  };
  state.unslottedAssigned = tally(assigned, state.assignedIn, state.assignedDirect);
  tally(reserved, state.reservedIn, state.reservedDirect);
  return state;
}

/** Seats not earmarked for a child slot. */
export const freeTarget = (state: RosterState, s: SlotNode) =>
  s.targetCount - (state.childTargets.get(s.id) ?? 0);

/** Seats a question landing directly in slot `s` can still take. */
export function slotVacancies(state: RosterState, s: SlotNode, includeReserved = false): number {
  const chain = state.slots.filter((x) => x === s || slotContains(x, s));
  return vacancyFromChain(state, chain, includeReserved).allowed;
}

export interface Vacancy {
  eligible: boolean;
  allowed: number;
  limits: VacancyLimitDto[];
  bindingSlotId: string | null;
  /** The limit that decides `allowed` */
  binding: VacancyLimitDto | null;
}

/** "X is full (3/3)", or why a subject that isn't full still takes no more of this topic. */
export function fullReason(v: Vacancy, where: string): string {
  if (!v.binding) return `${where} is not part of this series' subjects`;
  return v.binding.note ?? `${v.binding.label} is full (${v.binding.used}/${v.binding.target})`;
}

function vacancyFromChain(
  state: RosterState,
  chain: SlotNode[],
  includeReserved: boolean,
  label?: Labeler
): Vacancy {
  if (chain.length === 0) return { eligible: false, allowed: 0, limits: [], bindingSlotId: null, binding: null };
  const sorted = [...chain].sort((a, b) => DEPTH[slotLevel(a)] - DEPTH[slotLevel(b)]);
  const used = (s: SlotNode) =>
    (state.assignedIn.get(s.id) ?? 0) + (includeReserved ? (state.reservedIn.get(s.id) ?? 0) : 0);

  const limits: VacancyLimitDto[] = sorted.map((s) => ({
    slotId: s.id,
    label: label ? label(s) : s.id,
    target: s.targetCount,
    used: used(s),
    remaining: Math.max(0, s.targetCount - used(s)),
  }));

  // Seats of the deepest slot that are not earmarked for its child slots
  const deepest = sorted[sorted.length - 1];
  const directUsed =
    (state.assignedDirect.get(deepest.id) ?? 0) +
    (includeReserved ? (state.reservedDirect.get(deepest.id) ?? 0) : 0);
  const free = freeTarget(state, deepest);
  if (free !== deepest.targetCount) {
    const name = label ? label(deepest) : deepest.id;
    limits.push({
      slotId: deepest.id,
      label: `${name} (outside its sub-slots)`,
      target: free,
      used: directUsed,
      remaining: Math.max(0, free - directUsed),
      note:
        free === 0
          ? `${name} has no seats for other topics: all ${deepest.targetCount} are given to its topics in Subjects. Lower a topic's count there to take this question`
          : `${name}'s ${free} seat(s) outside its topics are taken (${directUsed}/${free}). Lower a topic's count in Subjects to take more`,
    });
  }

  let binding = limits[0];
  for (const l of limits) if (l.remaining < binding.remaining) binding = l;
  return { eligible: true, allowed: binding.remaining, limits, bindingSlotId: binding.slotId, binding };
}

/** Open seats for a question at `path` (manual assignment or AI generation). */
export function vacancyFor(
  state: RosterState,
  path: NodePath,
  kind: "assign" | "generate",
  label?: Labeler
): Vacancy {
  return vacancyFromChain(state, matchingChain(state.slots, path), kind === "generate", label);
}

/**
 * Problems a roster change would cause for questions already assigned
 * (a target lowered below its count, a slot removed under assigned questions).
 */
export function usageConflicts(state: RosterState, label: Labeler): string[] {
  const problems: string[] = [];
  for (const s of state.slots) {
    const inside = state.assignedIn.get(s.id) ?? 0;
    if (inside > s.targetCount) {
      problems.push(`${label(s)} already has ${inside} assigned questions (target ${s.targetCount})`);
      continue;
    }
    const direct = state.assignedDirect.get(s.id) ?? 0;
    const free = freeTarget(state, s);
    if (direct > free) {
      problems.push(
        `${label(s)} has ${direct} assigned questions outside its sub-slots, which now leave room for only ${free}`
      );
    }
  }
  if (state.unslottedAssigned > 0) {
    problems.push(
      `${state.unslottedAssigned} assigned question(s) would no longer belong to any roster slot`
    );
  }
  return problems;
}
