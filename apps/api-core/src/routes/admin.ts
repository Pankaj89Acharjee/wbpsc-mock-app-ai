import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { exams, testAttempts, users } from "../db/schema";
import { adminEmail, requireAdmin } from "../lib/auth";
import { formatIssues } from "../lib/validation";
import { toUserDto } from "./auth";
import { toAttemptSummary } from "./me";

// ============================================================================
// Request Validation Schemas (Zod)
// ============================================================================

const UpdateUserBodySchema = z.object({
  // Single-admin policy: "admin" can never be granted from the console
  role: z.enum(["aspirant", "educator"]).optional(),
  subscriptionTier: z.enum(["free", "pro_prelims", "wbcs_executive_pass"]).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================================
// Route Plugin Implementation (registered under /admin)
// ============================================================================

export const adminRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook("preHandler", requireAdmin);

  /** 1. GET /admin/users */
  fastify.get("/users", async () => {
    const rows = await db.select().from(users).orderBy(asc(users.createdAt));
    return { users: rows.map(toUserDto) };
  });

  /** 2. PATCH /admin/users/:id — role (aspirant/educator), plan, active */
  fastify.patch("/users/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = UpdateUserBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: body.success ? "Invalid user id" : formatIssues(body.error.issues),
      });
    }
    const [target] = await db.select().from(users).where(eq(users.id, params.data.id)).limit(1);
    if (!target) return reply.status(404).send({ error: "User not found" });
    if (target.email === adminEmail() && (body.data.role || body.data.isActive === false)) {
      return reply.status(403).send({ error: "The admin account's role and status are fixed" });
    }

    const [updated] = await db
      .update(users)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(users.id, target.id))
      .returning();
    return { user: toUserDto(updated) };
  });

  /** 3. GET /admin/attempts — latest 200 submitted attempts from all users */
  fastify.get("/attempts", async () => {
    const rows = await db
      .select({ attempt: testAttempts, exam: exams, email: users.email, name: users.fullName })
      .from(testAttempts)
      .innerJoin(exams, eq(testAttempts.examId, exams.id))
      .innerJoin(users, eq(testAttempts.userId, users.id))
      .where(eq(testAttempts.status, "submitted"))
      .orderBy(desc(testAttempts.submittedAt))
      .limit(200);
    return {
      attempts: rows.map((r) => ({
        ...toAttemptSummary(r.attempt, r.exam),
        userEmail: r.email,
        userName: r.name,
      })),
    };
  });
};
