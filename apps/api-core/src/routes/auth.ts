import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "../db/index";
import { users } from "../db/schema";
import {
  ExamSlugSchema,
  SupportedLanguageSchema,
  type UserDto,
} from "../../../../packages/shared-types/src/index";
import {
  adminEmail,
  clearSessionCookie,
  hashPassword,
  loadSessionUser,
  requireUser,
  setSessionCookie,
  verifyGoogleIdToken,
  verifyPassword,
  type UserRow,
} from "../lib/auth";
import { formatIssues } from "../lib/validation";

// ============================================================================
// Request Validation Schemas (Zod)
// ============================================================================

const EmailSchema = z.string().trim().toLowerCase().email("Enter a valid email").max(255);

const RegisterBodySchema = z.object({
  email: EmailSchema,
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  fullName: z.string().trim().min(2, "Enter your name").max(160),
});

const LoginBodySchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

const GoogleBodySchema = z.object({ credential: z.string().min(20).max(4096) });

const UpdateMeBodySchema = z.object({
  fullName: z.string().trim().min(2).max(160).optional(),
  preferredLanguage: SupportedLanguageSchema.optional(),
  targetExamSlug: ExamSlugSchema.optional(),
});

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    subscriptionTier: u.subscriptionTier,
    preferredLanguage: u.preferredLanguage,
    targetExamSlug: u.targetExamSlug,
    isActive: u.isActive,
    hasPassword: u.passwordHash !== null,
    hasGoogle: u.googleSub !== null,
    createdAt: u.createdAt.toISOString(),
  };
}

async function startSession(reply: FastifyReply, user: UserRow) {
  const [fresh] = await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  setSessionCookie(reply, fresh);
  return { user: toUserDto(fresh) };
}

/**
 * Single-admin policy at startup: ADMIN_EMAIL is the only admin.
 * If ADMIN_PASSWORD is set, the admin account is created/updated with it so you
 * can sign in before Google OAuth is configured.
 */
export async function ensureAdminAccount(log: { info: (msg: string) => void }) {
  const email = adminEmail();
  await db
    .update(users)
    .set({ role: "aspirant" })
    .where(and(eq(users.role, "admin"), email ? ne(users.email, email) : undefined));
  if (!email) return;

  const password = process.env.ADMIN_PASSWORD;
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    const passwordStale = password && !(await verifyPassword(password, existing.passwordHash));
    await db
      .update(users)
      .set({
        role: "admin",
        subscriptionTier: "wbcs_executive_pass",
        isActive: true,
        ...(passwordStale ? { passwordHash: await hashPassword(password) } : {}),
      })
      .where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({
      email,
      fullName: "WBPSC Master Admin",
      passwordHash: password ? await hashPassword(password) : null,
      role: "admin",
      subscriptionTier: "wbcs_executive_pass",
    });
    log.info(`Created admin account ${email}`);
  }
}

// ============================================================================
// Route Plugin Implementation (registered under /auth)
// ============================================================================

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /** 1. GET /auth/config — public settings the login screen needs */
  fastify.get("/config", async () => ({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  }));

  /** 2. POST /auth/register — email + password sign-up (aspirant) */
  fastify.post("/register", async (request, reply) => {
    const parsed = RegisterBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
    }
    const { email, password, fullName } = parsed.data;
    if (email === adminEmail()) {
      return reply.status(403).send({
        error: "This is the admin email — sign in instead (use ADMIN_PASSWORD or Google)",
      });
    }

    const [created] = await db
      .insert(users)
      .values({ email, fullName, passwordHash: await hashPassword(password) })
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (!created) {
      return reply
        .status(409)
        .send({ error: "An account with this email already exists — sign in instead" });
    }
    return reply.status(201).send(await startSession(reply, created));
  });

  /** 3. POST /auth/login — email + password */
  fastify.post("/login", async (request, reply) => {
    const parsed = LoginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Enter your email and password" });
    }
    const { email, password } = parsed.data;
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user && !user.passwordHash && user.googleSub) {
      return reply.status(400).send({ error: "This account uses “Sign in with Google”" });
    }
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.status(401).send({ error: "Wrong email or password" });
    }
    if (!user.isActive) {
      return reply.status(403).send({ error: "This account has been deactivated" });
    }
    return startSession(reply, user);
  });

  /** 4. POST /auth/google — Google Identity Services credential (ID token) */
  fastify.post("/google", async (request, reply) => {
    const parsed = GoogleBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Missing Google credential" });
    }
    let identity;
    try {
      identity = await verifyGoogleIdToken(parsed.data.credential);
    } catch (err) {
      return reply.status(401).send({ error: (err as Error).message });
    }
    if (!identity.email || !identity.emailVerified) {
      return reply.status(401).send({ error: "Your Google email is not verified" });
    }

    const isAdmin = identity.email === adminEmail();
    const [existing] = await db
      .select()
      .from(users)
      .where(or(eq(users.googleSub, identity.sub), eq(users.email, identity.email)))
      .limit(1);

    let user: UserRow;
    if (existing) {
      if (!existing.isActive) {
        return reply.status(403).send({ error: "This account has been deactivated" });
      }
      [user] = await db
        .update(users)
        .set({ googleSub: identity.sub, ...(isAdmin ? { role: "admin" as const } : {}) })
        .where(eq(users.id, existing.id))
        .returning();
    } else {
      [user] = await db
        .insert(users)
        .values({
          email: identity.email,
          fullName: (identity.name || identity.email.split("@")[0]).slice(0, 160),
          googleSub: identity.sub,
          role: isAdmin ? "admin" : "aspirant",
          subscriptionTier: isAdmin ? "wbcs_executive_pass" : "free",
        })
        .returning();
    }
    return startSession(reply, user);
  });

  /** 5. POST /auth/logout */
  fastify.post("/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  /** 6. GET /auth/me — current user, or 401 */
  fastify.get("/me", async (request, reply) => {
    const user = await loadSessionUser(request);
    if (!user) return reply.status(401).send({ error: "Not signed in" });
    return { user: toUserDto(user) };
  });

  /** 7. PATCH /auth/me — own name / language / target exam */
  fastify.patch("/me", { preHandler: requireUser }, async (request, reply) => {
    const parsed = UpdateMeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
    }
    const [updated] = await db
      .update(users)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(users.id, request.user!.id))
      .returning();
    return { user: toUserDto(updated) };
  });
};
