/** Flattens zod issues into one readable line ("field: message; …"). */
export function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => `${i.path.map(String).join(".") || "row"}: ${i.message}`)
    .join("; ");
}
