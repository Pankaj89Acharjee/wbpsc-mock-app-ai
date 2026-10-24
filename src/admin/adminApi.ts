import { useCallback, useRef, useState } from "react";
import {
  matchKey,
  type SyllabusTreeDto,
} from "../../packages/shared-types/src/index";
import { api } from "../api";

// ============================================================================
// Shared helpers for the admin console (api-core /admin/* routes).
// Access comes from the signed-in admin's session cookie.
// ============================================================================

/** Calls `/admin${path}` on api-core; throws with the server's error text. */
export function adminApi<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return api<T>(`/admin${path}`, init);
}

/** Saves a CSV with a BOM so Excel opens Bengali text as UTF-8. */
export function downloadCsv(fileName: string, csv: string) {
  const url = URL.createObjectURL(
    new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lazily fetched, cached syllabus trees keyed by exam slug. */
export function useSyllabusTrees() {
  const [trees, setTrees] = useState<Record<string, SyllabusTreeDto>>({});
  const inFlight = useRef(new Set<string>());

  const loadTree = useCallback(
    async (examSlug: string, force = false) => {
      if (!examSlug || inFlight.current.has(examSlug)) return;
      if (!force && trees[examSlug]) return;
      inFlight.current.add(examSlug);
      try {
        const { tree } = await adminApi<{ tree: SyllabusTreeDto }>(
          `/syllabus/exams/${encodeURIComponent(examSlug)}/tree`
        );
        setTrees((prev) => ({ ...prev, [examSlug]: tree }));
      } catch {
        // Unknown/unresolved exam slug — picker shows the raw value instead
      } finally {
        inFlight.current.delete(examSlug);
      }
    },
    [trees]
  );

  const setTree = useCallback(
    (tree: SyllabusTreeDto) => setTrees((prev) => ({ ...prev, [tree.examSlug]: tree })),
    []
  );

  return { trees, loadTree, setTree };
}
export type SyllabusTrees = ReturnType<typeof useSyllabusTrees>;

/** Client-side twin of api-core's nodeMatches (slug / English / Bengali name). */
export function findNode<T extends { slug: string; name: { en: string; bn: string } }>(
  nodes: T[],
  raw: string
): T | undefined {
  const k = matchKey(raw);
  if (!k) return undefined;
  return nodes.find((n) => [n.slug, n.name.en, n.name.bn].some((x) => matchKey(x) === k));
}
