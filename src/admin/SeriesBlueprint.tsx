import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Save, Sparkles } from "lucide-react";
import type {
  BankSupplyDto,
  BlueprintDto,
  ExamDto,
  SeriesDto,
  SyllabusSubjectDto,
  SyllabusTreeDto,
} from "../../packages/shared-types/src/index";
import { adminApi, type SyllabusTrees } from "./adminApi";
import AiGeneratePanel from "./AiGeneratePanel";
import type { SyllabusValue } from "./SyllabusPicker";
import { btn, type Notice } from "./ui";

// ============================================================================
// Series blueprint = the exam pattern of the test series.
//   Step 1  Subjects and how many questions each (e.g. GS 40 · English 30 ·
//           Maths 30) — their sum is the length of the test.
//   Step 2  Optional: split a subject's count across ITS chapters/subtopics.
//           Topics can never add up to more than their subject.
// Each subject/topic shows how many questions the exam's bank already has;
// where it is short of the target, "Generate" opens the AI generator for it.
// The server re-checks everything on save.
// ============================================================================

const keyOf = (subjectId: string, chapterId: string | null = null, subtopicId: string | null = null) =>
  `${subjectId}|${chapterId ?? ""}|${subtopicId ?? ""}`;

/** "12 in bank · 3 awaiting review" */
function SupplyText({ supply }: { supply: BankSupplyDto | undefined }) {
  const live = supply?.live ?? 0;
  const pending = supply?.pending ?? 0;
  return (
    <span className="text-[11px] text-slate-500 whitespace-nowrap">
      {live} in bank{pending ? ` · ${pending} awaiting review` : ""}
    </span>
  );
}

/** Questions still to generate so the bank can fill `target` (pending drafts count). */
const shortfall = (target: number, supply: BankSupplyDto | undefined) =>
  Math.max(0, target - (supply?.live ?? 0) - (supply?.pending ?? 0));

/** Subject counts only — used by the "New series" form (step 1). */
export function SubjectCountsEditor({
  tree,
  value,
  onChange,
  bank,
}: {
  tree: SyllabusTreeDto | undefined;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  /** Bank supply per node; shows "N in bank" next to each subject */
  bank?: Record<string, BankSupplyDto>;
}) {
  if (!tree) return <p className="text-xs text-slate-400">Loading subjects…</p>;
  if (tree.subjects.length === 0) {
    return (
      <p className="text-xs text-amber-300">
        This exam has no subjects yet — add its syllabus in Exams &amp; Syllabus first.
      </p>
    );
  }
  const total = Object.values(value).reduce((n, v) => n + (Number(v) || 0), 0);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {tree.subjects.map((s) => {
          const on = value[s.id] !== undefined;
          return (
            <div
              key={s.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                on ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-800"
              }`}
            >
              <label className="flex items-center gap-2 flex-1 min-w-0 text-xs text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const next = { ...value };
                    if (e.target.checked) {
                      next[s.id] = (s.weightageQuestions ?? 0) > 0 ? String(s.weightageQuestions) : "";
                    } else {
                      delete next[s.id];
                    }
                    onChange(next);
                  }}
                />
                <span className="truncate">{s.name.en}</span>
                {(s.weightageQuestions ?? 0) > 0 && !on && (
                  <span className="text-[10px] text-slate-400 shrink-0">
                    ({s.weightageQuestions} Qs)
                  </span>
                )}
              </label>
              {bank && <SupplyText supply={bank[keyOf(s.id)]} />}
              {on && (
                <input
                  inputMode="numeric"
                  aria-label={`Questions for ${s.name.en}`}
                  placeholder="Qs"
                  value={value[s.id]}
                  onChange={(e) => onChange({ ...value, [s.id]: e.target.value.replace(/[^\d]/g, "") })}
                  className="w-16 px-2 py-1 text-xs text-right bg-slate-950 border border-slate-700 rounded-md text-white"
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs font-mono text-emerald-300" aria-live="polite">
        Total questions: {total}
      </p>
    </div>
  );
}

export default function SeriesBlueprint({
  series,
  exam,
  trees,
  onSaved,
  setNotice,
}: {
  series: SeriesDto;
  exam: ExamDto;
  trees: SyllabusTrees;
  onSaved: () => void;
  setNotice: (n: Notice | null) => void;
}) {
  const tree = trees.trees[exam.slug];
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [subjectTab, setSubjectTab] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [bank, setBank] = useState<Record<string, BankSupplyDto>>({});
  const [gen, setGen] = useState<{ label: string; path: Partial<SyllabusValue>; count: number } | null>(null);
  const genRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (resetTargets: boolean) => {
      try {
        const { blueprint } = await adminApi<{ blueprint: BlueprintDto }>(`/series/${series.id}/blueprint`);
        setBank(blueprint.bank);
        if (resetTargets) {
          const map = Object.fromEntries(
            blueprint.slots.map((s) => [keyOf(s.subjectId, s.chapterId, s.subtopicId), String(s.targetCount)])
          );
          setSaved(map);
          setTargets(map);
        }
        setLoaded(true);
      } catch (err) {
        setNotice({ kind: "error", text: (err as Error).message });
      }
    },
    [series.id, setNotice]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    if (gen) genRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [gen]);

  /** Opens the AI generator for a node that the bank can't fill yet. */
  const openGenerator = (label: string, path: Partial<SyllabusValue>, count: number) =>
    setGen({ label, path, count });

  /** Supply + shortfall + "Generate" for one node with a target. */
  const supplyCell = (key: string, target: number, label: string, path: Partial<SyllabusValue>) => {
    const short = shortfall(target, bank[key]);
    return (
      <span className="flex items-center gap-2">
        <SupplyText supply={bank[key]} />
        {target > 0 && short > 0 && (
          <>
            <span className="text-[11px] text-amber-300 whitespace-nowrap">short by {short}</span>
            <button
              type="button"
              onClick={() => openGenerator(label, path, short)}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-violet-500 hover:bg-violet-400 text-white rounded cursor-pointer"
            >
              <Sparkles className="w-3 h-3" /> Generate
            </button>
          </>
        )}
      </span>
    );
  };

  const subjectCounts = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(targets)
          .filter(([k]) => k.endsWith("||"))
          .map(([k, v]) => [k.split("|")[0], v])
      ),
    [targets]
  );
  const chosen: SyllabusSubjectDto[] = (tree?.subjects ?? []).filter((s) => subjectCounts[s.id] !== undefined);
  const activeSubject = chosen.find((s) => s.id === subjectTab) ?? chosen[0];

  const num = (k: string) => (targets[k] ? Number(targets[k]) : 0);
  const setVal = (k: string, v: string) =>
    setTargets((prev) => {
      const next = { ...prev };
      if (v === "") delete next[k];
      else next[k] = v.replace(/[^\d]/g, "");
      return next;
    });

  /** Live preview of the server's limits for one subject. */
  const subjectCheck = (s: SyllabusSubjectDto) => {
    const cap = num(keyOf(s.id));
    let topics = 0;
    const problems: string[] = [];
    for (const c of s.chapters) {
      const ck = keyOf(s.id, c.id);
      const subSum = c.subtopics.reduce((n, t) => n + num(keyOf(s.id, c.id, t.id)), 0);
      if (targets[ck] !== undefined && subSum > num(ck)) {
        problems.push(`${c.name.en}: subtopics add up to ${subSum}, more than ${num(ck)}`);
      }
      topics += targets[ck] !== undefined ? num(ck) : subSum;
    }
    if (topics > cap) problems.push(`Topics add up to ${topics}, more than ${s.name.en}'s ${cap}`);
    return { cap, topics, problems };
  };

  const total = chosen.reduce((n, s) => n + num(keyOf(s.id)), 0);
  const allProblems = chosen.flatMap((s) => subjectCheck(s).problems);
  const missingCount = chosen.some((s) => !num(keyOf(s.id)));
  const dirty = JSON.stringify(targets) !== JSON.stringify(saved);

  const save = async () => {
    setSaving(true);
    try {
      // Drop topic targets of subjects that were un-ticked
      const keep = new Set(chosen.map((s) => s.id));
      const slots = Object.entries(targets)
        .filter(([k, v]) => v !== "" && keep.has(k.split("|")[0]))
        .map(([k, v]) => {
          const [subjectId, chapterId, subtopicId] = k.split("|");
          return {
            subjectId,
            chapterId: chapterId || null,
            subtopicId: subtopicId || null,
            targetCount: Number(v),
          };
        });
      const { blueprint } = await adminApi<{ blueprint: BlueprintDto }>(
        `/series/${series.id}/blueprint`,
        { method: "PUT", body: { slots } }
      );
      const map = Object.fromEntries(
        blueprint.slots.map((s) => [keyOf(s.subjectId, s.chapterId, s.subtopicId), String(s.targetCount)])
      );
      setSaved(map);
      setTargets(map);
      setNotice({ kind: "success", text: `Subjects saved — the test has ${blueprint.totalQuestions} questions` });
      onSaved();
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!tree || !loaded) return <p className="text-xs text-slate-400 p-4">Loading blueprint…</p>;

  const subjectCountMap: Record<string, string> = Object.fromEntries(
    chosen.map((s) => [s.id, targets[keyOf(s.id)] ?? ""])
  );
  const check = activeSubject ? subjectCheck(activeSubject) : null;

  return (
    <div className="space-y-5">
      <section aria-labelledby="bp-step1" className="space-y-2">
        <h4 id="bp-step1" className="text-xs font-bold text-white">
          Step 1 · Subjects and questions per subject
        </h4>
        <SubjectCountsEditor
          tree={tree}
          bank={bank}
          value={subjectCountMap}
          onChange={(v) =>
            setTargets((prev) => {
              const next: Record<string, string> = {};
              // keep topic targets; rewrite subject rows from the editor
              for (const [k, val] of Object.entries(prev)) if (!k.endsWith("||")) next[k] = val;
              for (const [id, val] of Object.entries(v)) next[keyOf(id)] = val;
              return next;
            })
          }
        />
      </section>

      {chosen.length > 0 && activeSubject && check && (
        <section aria-labelledby="bp-step2" className="space-y-3">
          <div>
            <h4 id="bp-step2" className="text-xs font-bold text-white">
              Step 2 · Topic breakdown inside each subject (optional)
            </h4>
            <p className="text-xs text-slate-400">
              Leave empty to accept questions from any topic of the subject. Numbers here are part of
              the subject's count, never extra.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg w-fit" role="tablist">
            {chosen.map((s) => {
              const c = subjectCheck(s);
              return (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={activeSubject.id === s.id}
                  onClick={() => setSubjectTab(s.id)}
                  className={`px-3 py-1.5 text-xs rounded-md cursor-pointer ${
                    activeSubject.id === s.id ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
                  } ${c.problems.length ? "ring-1 ring-rose-500/60" : ""}`}
                >
                  {s.name.en} · {c.topics}/{c.cap}
                </button>
              );
            })}
          </div>

          <div className="border border-slate-800 rounded-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-800">
              <p className="text-xs text-slate-300" aria-live="polite">
                {activeSubject.name.en}: {check.cap} questions · {check.topics} split across topics ·{" "}
                <span className="text-emerald-300">{Math.max(0, check.cap - check.topics)} from any topic</span>
              </p>
              {supplyCell(keyOf(activeSubject.id), check.cap, activeSubject.name.en, {
                subjectSlug: activeSubject.slug,
                chapterSlug: "",
                subtopicSlug: "",
              })}
            </div>
            {activeSubject.chapters.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-500">This subject has no chapters yet.</p>
            )}
            <div className="max-h-[50vh] overflow-y-auto">
              {activeSubject.chapters.map((c) => {
                const ck = keyOf(activeSubject.id, c.id);
                return (
                  <React.Fragment key={c.id}>
                    <div className="flex items-center gap-2 py-1.5 pl-2 pr-4 border-b border-slate-800/60">
                      {c.subtopics.length > 0 ? (
                        <button
                          onClick={() => toggle(c.id)}
                          aria-expanded={open.has(c.id)}
                          aria-label={`Subtopics of ${c.name.en}`}
                          className="text-slate-400 hover:text-white cursor-pointer"
                        >
                          {open.has(c.id) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      ) : (
                        <span className="w-3.5" />
                      )}
                      <span className="flex-1 min-w-0 text-xs text-slate-200 truncate">{c.name.en}</span>
                      {supplyCell(ck, num(ck), `${activeSubject.name.en} → ${c.name.en}`, {
                        subjectSlug: activeSubject.slug,
                        chapterSlug: c.slug,
                        subtopicSlug: "",
                      })}
                      <input
                        inputMode="numeric"
                        aria-label={`Questions for ${c.name.en}`}
                        value={targets[ck] ?? ""}
                        placeholder="—"
                        onChange={(e) => setVal(ck, e.target.value)}
                        className="w-16 px-2 py-1 text-xs text-right bg-slate-950 border border-slate-700 rounded-md text-white"
                      />
                    </div>
                    {open.has(c.id) &&
                      c.subtopics.map((t) => {
                        const tk = keyOf(activeSubject.id, c.id, t.id);
                        return (
                          <div key={t.id} className="flex items-center gap-2 py-1.5 pl-10 pr-4 border-b border-slate-800/40">
                            <span className="flex-1 min-w-0 text-xs text-slate-400 truncate">{t.name.en}</span>
                            {supplyCell(tk, num(tk), `${c.name.en} → ${t.name.en}`, {
                              subjectSlug: activeSubject.slug,
                              chapterSlug: c.slug,
                              subtopicSlug: t.slug,
                            })}
                            <input
                              inputMode="numeric"
                              aria-label={`Questions for ${t.name.en}`}
                              value={targets[tk] ?? ""}
                              placeholder="—"
                              onChange={(e) => setVal(tk, e.target.value)}
                              className="w-16 px-2 py-1 text-xs text-right bg-slate-950 border border-slate-700 rounded-md text-white"
                            />
                          </div>
                        );
                      })}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {gen && (
        <div ref={genRef} className="space-y-2">
          <p className="text-xs text-violet-200">
            Filling the gap for <strong>{gen.label}</strong>: generate {gen.count} question(s) into the
            Question Bank. Pick the subtopic if it isn't set, then approve the drafts in the review
            queue (Admin Console → Question Bank).
          </p>
          <AiGeneratePanel
            key={`${gen.label}-${gen.count}`}
            exam={exam}
            trees={trees}
            initialPath={gen.path}
            initialCount={gen.count}
            onClose={() => setGen(null)}
            onGenerated={async (r) => {
              await load(false);
              setNotice({
                kind: r.uniqueGenerated > 0 ? "success" : "info",
                text: `${r.uniqueGenerated} new question(s) for ${gen.label} are awaiting review — approve them to add them to the bank.`,
              });
            }}
          />
        </div>
      )}

      {allProblems.length > 0 && (
        <ul className="text-xs text-rose-300 space-y-0.5" role="alert">
          {allProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-mono text-emerald-300">Total: {total} questions</span>
        <button
          onClick={save}
          disabled={!dirty || saving || allProblems.length > 0 || missingCount}
          title={missingCount ? "Every ticked subject needs a question count" : undefined}
          className={btn.primary}
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save blueprint"}
        </button>
        {dirty && (
          <button onClick={() => setTargets(saved)} className={btn.secondary}>
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}
