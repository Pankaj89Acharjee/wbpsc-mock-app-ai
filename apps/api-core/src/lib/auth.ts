import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  scrypt,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
} from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { users } from "../db/schema";

// ============================================================================
// Self-hosted auth: scrypt passwords, HS256 session JWT in an HttpOnly cookie,
// and server-side verification of Google ID tokens. No Firebase.
// Single-admin policy: only ADMIN_EMAIL is ever "admin".
// ============================================================================

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

export const SESSION_COOKIE = "wbpsc_session";
const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_DAYS || 7) * 24 * 3600;

export type UserRow = typeof users.$inferSelect;

export interface SessionClaims {
  sub: string; // user id
  role: UserRow["role"];
  exp: number;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRow;
  }
}

export const adminEmail = () => (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

// ─── Passwords ────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored?.startsWith("scrypt$")) return false;
  const [, saltB64, keyB64] = stored.split("$");
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

// ─── Session JWT (HS256) ──────────────────────────────────────────────────────

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function secret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be set in .env (at least 32 characters)");
  }
  return s;
}

export function signSession(user: Pick<UserRow, "id" | "role">): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: SessionClaims = {
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", secret()).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(sig)}`;
}

export function verifySession(token: string): SessionClaims | null {
  const [header, payload, sig] = token.split(".");
  if (!header || !payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(`${header}.${payload}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionClaims;
    return claims.exp > Date.now() / 1000 ? claims : null;
  } catch {
    return null;
  }
}

// ─── Cookies ──────────────────────────────────────────────────────────────────

function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function cookieAttributes(maxAge: number): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function setSessionCookie(reply: FastifyReply, user: Pick<UserRow, "id" | "role">) {
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${signSession(user)}; ${cookieAttributes(SESSION_TTL_SEC)}`
  );
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header("Set-Cookie", `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
}

// ─── Request guards ───────────────────────────────────────────────────────────

/** Loads the signed-in user (fresh from DB so role/active changes apply at once). */
export async function loadSessionUser(request: FastifyRequest): Promise<UserRow | null> {
  if (request.user) return request.user;
  const token = readCookie(request, SESSION_COOKIE);
  const claims = token ? verifySession(token) : null;
  if (!claims) return null;
  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user || !user.isActive) return null;
  request.user = user;
  return user;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!(await loadSessionUser(request))) {
    return reply.status(401).send({ error: "Please sign in" });
  }
}

/** Server scripts may use ADMIN_API_KEY via `x-admin-key`; browsers use the admin session. */
function hasValidAdminKey(request: FastifyRequest): boolean {
  const expected = process.env.ADMIN_API_KEY;
  const provided = request.headers["x-admin-key"];
  if (!expected || typeof provided !== "string") return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (hasValidAdminKey(request)) return;
  const user = await loadSessionUser(request);
  if (!user) return reply.status(401).send({ error: "Please sign in" });
  if (user.role !== "admin") return reply.status(403).send({ error: "Admins only" });
}

export async function requireEducatorOrAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (hasValidAdminKey(request)) return;
  const user = await loadSessionUser(request);
  if (!user) return reply.status(401).send({ error: "Please sign in" });
  if (user.role !== "admin" && user.role !== "educator") {
    return reply.status(403).send({ error: "Educators and admins only" });
  }
}

// ─── Google ID token verification ─────────────────────────────────────────────

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let googleKeys: { keys: Array<JsonWebKey & { kid: string }>; fetchedAt: number } | null = null;

async function googleKey(kid: string): Promise<(JsonWebKey & { kid: string }) | undefined> {
  const stale = !googleKeys || Date.now() - googleKeys.fetchedAt > 3600_000;
  if (stale || !googleKeys!.keys.some((k) => k.kid === kid)) {
    const res = await fetch(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error("Could not reach Google to verify sign-in");
    googleKeys = { keys: (await res.json()).keys, fetchedAt: Date.now() };
  }
  return googleKeys!.keys.find((k) => k.kid === kid);
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** Verifies a Google Identity Services credential (RS256 ID token). */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Google sign-in is not configured (GOOGLE_CLIENT_ID)");

  const [headerB64, payloadB64, sigB64] = idToken.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error("Malformed Google credential");
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
  if (header.alg !== "RS256") throw new Error("Unexpected Google token algorithm");

  const jwk = await googleKey(header.kid);
  if (!jwk) throw new Error("Unknown Google signing key");
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(sigB64, "base64url")
  );
  if (!valid) throw new Error("Invalid Google signature");

  const p = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  if (p.aud !== clientId) throw new Error("Google token was issued for another app");
  if (p.iss !== "accounts.google.com" && p.iss !== "https://accounts.google.com") {
    throw new Error("Invalid Google token issuer");
  }
  if (typeof p.exp !== "number" || p.exp < Date.now() / 1000) {
    throw new Error("Google sign-in expired — try again");
  }
  return {
    sub: String(p.sub),
    email: String(p.email || "").toLowerCase(),
    emailVerified: p.email_verified === true || p.email_verified === "true",
    name: typeof p.name === "string" ? p.name : null,
  };
}
