// ============================================================================
// api-core → api-ai internal calls. api-ai is not exposed to browsers; every
// request carries X-Internal-Token and the already-authenticated user's id.
// ============================================================================

const API_AI_URL = process.env.API_AI_URL || "http://localhost:8081";

/** Error carrying api-ai's HTTP status (e.g. 403 Pro required, 429 daily quota). */
export class ApiAiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** FastAPI `detail` may be a string, a {message_en} object, or a validation list. */
function detailMessage(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message_en" in detail) {
    return String((detail as { message_en: unknown }).message_en);
  }
  if (detail && typeof detail === "object" && "error" in detail) {
    const d = detail as { error: unknown; limit?: number };
    return d.error === "DAILY_AI_QUOTA_EXCEEDED"
      ? `Daily AI limit reached (${d.limit ?? 15}/day). Cached notes stay free — try again tomorrow.`
      : String(d.error);
  }
  return `AI service error (HTTP ${status})`;
}

export async function callApiAi<T>(
  path: string,
  body: BodyInit,
  { json = true, timeoutMs = 180_000 }: { json?: boolean; timeoutMs?: number } = {}
): Promise<T> {
  const token = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  if (!token) throw new ApiAiError("INTERNAL_SERVICE_TOKEN is not configured on api-core", 500);

  let res: Response;
  try {
    res = await fetch(`${API_AI_URL}${path}`, {
      method: "POST",
      headers: {
        "X-Internal-Token": token,
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = (err as Error).name === "TimeoutError" ? "timed out" : "is not reachable";
    throw new ApiAiError(
      `AI service (${API_AI_URL}) ${reason} — is api-ai running? (npm run dev:api-ai)`,
      502
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiAiError(
      detailMessage((data as { detail?: unknown }).detail, res.status),
      res.status
    );
  }
  return data as T;
}
