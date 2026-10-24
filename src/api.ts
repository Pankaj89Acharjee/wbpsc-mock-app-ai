// ============================================================================
// Browser client for api-core.
// Automatically uses "/api" (same-origin) in Google AI Studio / production,
// or honours a non-localhost VITE_API_CORE_URL when testing across LAN.
// Sends both HttpOnly cookies (credentials: "include") and Bearer token header
// so sessions persist reliably inside cross-origin preview iframes.
// ============================================================================

const SESSION_TOKEN_STORAGE_KEY = "wbpsc_session_token";

function resolveApiCoreUrl(): string {
  const raw = (import.meta.env.VITE_API_CORE_URL as string | undefined)?.trim();
  const isBrowser = typeof window !== "undefined";
  const isRemoteHost =
    isBrowser &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1";

  if (!raw) return "/api";

  // If running in Google AI Studio (*.run.app) or a remote domain, never let a
  // leftover localhost env var break browser fetch requests.
  if (isRemoteHost && (raw.includes("localhost") || raw.includes("127.0.0.1"))) {
    return "/api";
  }

  // If VITE_API_CORE_URL is set to the same origin root (e.g. http://localhost:3000),
  // use /api so API routes don't collide with SPA HTML routes.
  if (isBrowser && raw === window.location.origin) {
    return "/api";
  }

  return raw.replace(/\/+$/, "");
}

export const API_CORE_URL = resolveApiCoreUrl();

export function getStoredSessionToken(): string | null {
  try {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

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
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const token = getStoredSessionToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_CORE_URL}${path}`, {
      method: init?.method ?? "GET",
      credentials: "include",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(
      `Cannot reach the server (${API_CORE_URL}${path}). Is the server running?`,
      0
    );
  }

  const body = await res.json().catch(() => ({}));

  if (body && typeof body.token === "string") {
    setStoredSessionToken(body.token);
  }
  if (path === "/auth/logout" && res.ok) {
    setStoredSessionToken(null);
  }

  if (!res.ok) {
    const details = typeof body.details === "string" ? `: ${body.details}` : "";
    throw new ApiError((body.error ?? `HTTP ${res.status}`) + details, res.status);
  }
  return body as T;
}
