// ============================================================================
// Browser client for api-core. Sends the HttpOnly session cookie with every
// request (`credentials: "include"`). No tokens are stored in localStorage.
// ============================================================================

export const API_CORE_URL =
  (import.meta.env.VITE_API_CORE_URL as string | undefined) || "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_CORE_URL}${path}`, {
      method: init?.method ?? "GET",
      credentials: "include",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body:
        init?.body !== undefined
          ? typeof init.body === "string"
            ? init.body
            : JSON.stringify(init.body)
          : undefined,
    });
  } catch {
    throw new ApiError(
      `Cannot reach the server (${API_CORE_URL}). Is api-core running?`,
      0
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = typeof body.details === "string" ? `: ${body.details}` : "";
    throw new ApiError((body.error ?? `HTTP ${res.status}`) + details, res.status);
  }
  return body as T;
}
