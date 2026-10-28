import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { examSeries, exams, studentSubscriptions, testAttempts, users } from "../db/schema";
import {
  SUBSCRIPTION_TIER_PLANS,
  SubscriptionTierSchema,
  type SeriesAccessType,
  type StudentSubscriptionDto,
} from "../../../../packages/shared-types/src/index";
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
  subscriptionTier: SubscriptionTierSchema.optional(),
  isActive: z.boolean().optional(),
  paymentDueInr: z.coerce.number().min(0).max(100_000).optional(),
  totalPaidInr: z.coerce.number().min(0).max(500_000).optional(),
  billingNotes: z.string().trim().max(1000).nullable().optional(),
});

const AdminManageSubscriptionBodySchema = z.object({
  userId: z.string().uuid(),
  planTier: SubscriptionTierSchema,
  amountPaidNowInr: z.coerce.number().min(0).max(100_000).default(0),
  paymentDueInr: z.coerce.number().min(0).max(100_000).default(0),
  billingCycle: z.enum(["monthly", "quarterly", "yearly", "lifetime"]).default("yearly"),
  notes: z.string().trim().max(500).optional(),
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

  /** 2. PATCH /admin/users/:id — role (aspirant/educator), plan, active, dues */
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

    const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.role !== undefined) updatePayload.role = body.data.role;
    if (body.data.subscriptionTier !== undefined) updatePayload.subscriptionTier = body.data.subscriptionTier;
    if (body.data.isActive !== undefined) updatePayload.isActive = body.data.isActive;
    if (body.data.paymentDueInr !== undefined) updatePayload.paymentDueInr = String(body.data.paymentDueInr.toFixed(2));
    if (body.data.totalPaidInr !== undefined) updatePayload.totalPaidInr = String(body.data.totalPaidInr.toFixed(2));
    if (body.data.billingNotes !== undefined) updatePayload.billingNotes = body.data.billingNotes;

    const [updated] = await db
      .update(users)
      .set(updatePayload)
      .where(eq(users.id, target.id))
      .returning();
    return { user: toUserDto(updated) };
  });

  /** 3. GET /admin/attempts — latest 300 exam attempts (submitted + in_progress) across all students */
  fastify.get("/attempts", async () => {
    const rows = await db
      .select({
        attempt: testAttempts,
        exam: exams,
        userId: users.id,
        email: users.email,
        name: users.fullName,
        subscriptionTier: users.subscriptionTier,
        targetExamSlug: users.targetExamSlug,
        seriesId: examSeries.id,
        seriesName: examSeries.name,
        seriesCutoff: examSeries.estimatedCutoffMarks,
        seriesAccessType: examSeries.accessType,
        seriesRequiredTier: examSeries.requiredTier,
      })
      .from(testAttempts)
      .innerJoin(exams, eq(testAttempts.examId, exams.id))
      .innerJoin(users, eq(testAttempts.userId, users.id))
      .leftJoin(examSeries, eq(testAttempts.seriesId, examSeries.id))
      .where(inArray(testAttempts.status, ["submitted", "in_progress"]))
      .orderBy(desc(testAttempts.submittedAt), desc(testAttempts.startedAt))
      .limit(300);

    return {
      attempts: rows.map((r) => ({
        ...toAttemptSummary(
          r.attempt,
          r.exam,
          r.seriesId && r.seriesName && r.seriesCutoff != null
            ? {
                id: r.seriesId,
                name: r.seriesName,
                cutoff: r.seriesCutoff,
                accessType: (r.seriesAccessType as SeriesAccessType) || "free",
                requiredTier: r.seriesRequiredTier || "free",
              }
            : null
        ),
        userId: r.userId,
        userEmail: r.email,
        userName: r.name,
        userSubscriptionTier: r.subscriptionTier,
        userTargetExamSlug: r.targetExamSlug,
      })),
    };
  });

  /** 4. GET /admin/subscriptions — all subscription / payment transactions across students */
  fastify.get("/subscriptions", async () => {
    const rows = await db
      .select({
        sub: studentSubscriptions,
        userName: users.fullName,
        userEmail: users.email,
        userTargetExamSlug: users.targetExamSlug,
      })
      .from(studentSubscriptions)
      .innerJoin(users, eq(studentSubscriptions.userId, users.id))
      .orderBy(desc(studentSubscriptions.createdAt))
      .limit(300);

    const subscriptions: StudentSubscriptionDto[] = rows.map(({ sub, userName, userEmail, userTargetExamSlug }) => ({
      id: sub.id,
      userId: sub.userId,
      userName,
      userEmail,
      userTargetExamSlug,
      planTier: sub.planTier,
      planName: sub.planName,
      billingCycle: sub.billingCycle,
      planPriceInr: Number(sub.planPriceInr),
      amountPaidInr: Number(sub.amountPaidInr),
      amountDueInr: Number(sub.amountDueInr),
      paymentStatus: sub.paymentStatus,
      paymentMode: sub.paymentMode,
      transactionRef: sub.transactionRef ?? null,
      notes: sub.notes ?? null,
      startsAt: sub.startsAt.toISOString(),
      expiresAt: sub.expiresAt ? sub.expiresAt.toISOString() : null,
      createdAt: sub.createdAt.toISOString(),
    }));

    return { subscriptions };
  });

  /**
   * 5. POST /admin/subscriptions/manage
   * Allows Admin to update a student's subscription plan, record a payment, or adjust/waive payment dues.
   */
  fastify.post("/subscriptions/manage", async (request, reply) => {
    const parsed = AdminManageSubscriptionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
    }
    const body = parsed.data;
    const planMeta =
      SUBSCRIPTION_TIER_PLANS.find((p) => p.tier === body.planTier) ??
      SUBSCRIPTION_TIER_PLANS[0];

    const result = await db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(users)
        .where(eq(users.id, body.userId))
        .limit(1);
      if (!target) throw new Error("USER_NOT_FOUND");

      const paidNow = Number(body.amountPaidNowInr.toFixed(2));
      const newDue = Number(body.paymentDueInr.toFixed(2));
      const newTotalPaid = Number((Number(target.totalPaidInr ?? 0) + paidNow).toFixed(2));

      const paymentStatus: StudentSubscriptionDto["paymentStatus"] =
        newDue <= 0
          ? "paid"
          : paidNow > 0
            ? "partial_due"
            : "pending_due";

      const expiresAt =
        body.planTier === "free"
          ? null
          : (() => {
              const d = new Date();
              if (body.billingCycle === "monthly") d.setMonth(d.getMonth() + 1);
              else if (body.billingCycle === "quarterly") d.setMonth(d.getMonth() + 3);
              else d.setFullYear(d.getFullYear() + 1);
              return d;
            })();

      const [sub] = await tx
        .insert(studentSubscriptions)
        .values({
          userId: target.id,
          planTier: body.planTier,
          planName: planMeta.labelEn,
          billingCycle: body.billingCycle,
          planPriceInr: String(planMeta.priceInr),
          amountPaidInr: String(paidNow),
          amountDueInr: String(newDue),
          paymentStatus,
          paymentMode: "admin_managed",
          transactionRef: `ADM-${Date.now().toString(36).toUpperCase()}`,
          notes: body.notes || `Updated by Admin (${planMeta.shortLabel})`,
          startsAt: new Date(),
          expiresAt,
          createdBy: request.user!.id,
        })
        .returning();

      const [updatedUser] = await tx
        .update(users)
        .set({
          subscriptionTier: body.planTier,
          paymentDueInr: String(newDue),
          totalPaidInr: String(newTotalPaid),
          billingNotes: body.notes !== undefined ? body.notes : target.billingNotes,
          subscriptionExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(users.id, target.id))
        .returning();

      return { updatedUser, sub };
    });

    const subscriptionDto: StudentSubscriptionDto = {
      id: result.sub.id,
      userId: result.sub.userId,
      userName: result.updatedUser.fullName,
      userEmail: result.updatedUser.email,
      userTargetExamSlug: result.updatedUser.targetExamSlug,
      planTier: result.sub.planTier,
      planName: result.sub.planName,
      billingCycle: result.sub.billingCycle,
      planPriceInr: Number(result.sub.planPriceInr),
      amountPaidInr: Number(result.sub.amountPaidInr),
      amountDueInr: Number(result.sub.amountDueInr),
      paymentStatus: result.sub.paymentStatus,
      paymentMode: result.sub.paymentMode,
      transactionRef: result.sub.transactionRef ?? null,
      notes: result.sub.notes ?? null,
      startsAt: result.sub.startsAt.toISOString(),
      expiresAt: result.sub.expiresAt ? result.sub.expiresAt.toISOString() : null,
      createdAt: result.sub.createdAt.toISOString(),
    };

    return {
      user: toUserDto(result.updatedUser),
      subscription: subscriptionDto,
    };
  });
};
