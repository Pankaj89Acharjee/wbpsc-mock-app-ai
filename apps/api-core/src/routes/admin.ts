import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db/index";
import {
  examSeries,
  exams,
  studentSubscriptions,
  subscriptionPlans,
  testAttempts,
  users,
} from "../db/schema";
import {
  SUBSCRIPTION_TIER_PLANS,
  SubscriptionPlanInputSchema,
  SubscriptionTierSchema,
  type SeriesAccessType,
  type StudentSubscriptionDto,
} from "../../../../packages/shared-types/src/index";
import { adminEmail, requireAdmin, syncExpiredSubscriptions } from "../lib/auth";
import { formatIssues } from "../lib/validation";
import { toUserDto } from "./auth";
import {
  ensureSubscriptionPlansSeeded,
  ensureSubscriptionSchemaReady,
  toAttemptSummary,
  toSubscriptionPlanDto,
} from "./me";

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
  subscriptionExpiresAt: z.string().trim().nullable().optional(),
});

const PaymentStatusEnumSchema = z.enum([
  "paid",
  "partial_due",
  "pending_due",
  "waived",
  "refunded",
  "failed",
  "duplicate",
  "disputed",
]);

const AdminManageSubscriptionBodySchema = z.object({
  userId: z.string().uuid(),
  planTier: SubscriptionTierSchema,
  amountPaidNowInr: z.coerce.number().min(0).max(100_000).default(0),
  paymentDueInr: z.coerce.number().min(0).max(100_000).default(0),
  billingCycle: z.enum(["monthly", "quarterly", "yearly", "lifetime", "expire_now"]).default("yearly"),
  paymentStatus: PaymentStatusEnumSchema.optional(),
  paymentMode: z.string().trim().max(32).optional(),
  transactionRef: z.string().trim().max(120).optional(),
  customExpiresAt: z.string().trim().optional(),
  notes: z.string().trim().max(500).optional(),
});

const AdminUpdatePaymentTransactionSchema = z.object({
  paymentStatus: PaymentStatusEnumSchema,
  amountPaidInr: z.coerce.number().min(0).max(100_000).optional(),
  amountDueInr: z.coerce.number().min(0).max(100_000).optional(),
  notes: z.string().trim().max(500).optional(),
  syncUserBalance: z.boolean().default(true),
});

// ============================================================================
// Route Plugin Implementation (registered under /admin)
// ============================================================================

export const adminRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook("preHandler", requireAdmin);

  /** 1. GET /admin/users — syncs expired subscriptions to 'free' first */
  fastify.get("/users", async () => {
    await syncExpiredSubscriptions();
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
    if (body.data.subscriptionTier !== undefined) {
      updatePayload.subscriptionTier = body.data.subscriptionTier;
      if (body.data.subscriptionTier === "free") {
        updatePayload.subscriptionExpiresAt = null;
      }
    }
    if (body.data.isActive !== undefined) updatePayload.isActive = body.data.isActive;
    if (body.data.paymentDueInr !== undefined) updatePayload.paymentDueInr = String(body.data.paymentDueInr.toFixed(2));
    if (body.data.totalPaidInr !== undefined) updatePayload.totalPaidInr = String(body.data.totalPaidInr.toFixed(2));
    if (body.data.billingNotes !== undefined) updatePayload.billingNotes = body.data.billingNotes;
    if (body.data.subscriptionExpiresAt !== undefined) {
      if (!body.data.subscriptionExpiresAt) {
        updatePayload.subscriptionExpiresAt = null;
      } else {
        const expDate = new Date(body.data.subscriptionExpiresAt);
        if (!Number.isNaN(expDate.getTime())) {
          if (target.role !== "admin" && expDate.getTime() <= Date.now()) {
            updatePayload.subscriptionTier = "free";
            updatePayload.subscriptionExpiresAt = null;
          } else {
            updatePayload.subscriptionExpiresAt = expDate;
          }
        }
      }
    }

    const [updated] = await db
      .update(users)
      .set(updatePayload)
      .where(eq(users.id, target.id))
      .returning();
    return { user: toUserDto(updated) };
  });

  /** 3. GET /admin/attempts — latest 300 exam attempts (submitted + in_progress) across all students */
  fastify.get("/attempts", async () => {
    await syncExpiredSubscriptions();
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
    await ensureSubscriptionSchemaReady();
    await syncExpiredSubscriptions();
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
   * Allows Admin to update a student's subscription plan, record a payment, adjust/waive payment dues,
   * log a failed/duplicate payment, or expire a subscription (auto-switches aspirant to 'free' plan).
   */
  fastify.post("/subscriptions/manage", async (request, reply) => {
    const parsed = AdminManageSubscriptionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
    }
    const body = parsed.data;
    const allPlans = await ensureSubscriptionPlansSeeded();
    const planMeta =
      allPlans.find((p) => p.tier === body.planTier) ??
      SUBSCRIPTION_TIER_PLANS.find((p) => p.tier === body.planTier) ??
      allPlans[0] ??
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
      const computedStatus: StudentSubscriptionDto["paymentStatus"] =
        body.paymentStatus ??
        (newDue <= 0
          ? "paid"
          : paidNow > 0
            ? "partial_due"
            : "pending_due");

      const isFailedOrRefunded =
        computedStatus === "failed" || computedStatus === "refunded";
      const newTotalPaid = isFailedOrRefunded
        ? Number(target.totalPaidInr ?? 0)
        : Number((Number(target.totalPaidInr ?? 0) + paidNow).toFixed(2));

      let effectiveTier = body.planTier;
      let expiresAt: Date | null = null;

      if (body.billingCycle === "expire_now" || body.planTier === "free") {
        effectiveTier = "free";
        expiresAt = null;
      } else if (computedStatus === "failed") {
        effectiveTier = target.subscriptionTier;
        expiresAt = target.subscriptionExpiresAt;
      } else if (body.customExpiresAt) {
        const parsedDate = new Date(body.customExpiresAt);
        if (!Number.isNaN(parsedDate.getTime())) {
          if (target.role !== "admin" && parsedDate.getTime() <= Date.now()) {
            effectiveTier = "free";
            expiresAt = null;
          } else {
            expiresAt = parsedDate;
          }
        }
      } else if (body.billingCycle === "lifetime") {
        expiresAt = null;
      } else {
        const d = new Date();
        if (body.billingCycle === "monthly") d.setMonth(d.getMonth() + 1);
        else if (body.billingCycle === "quarterly") d.setMonth(d.getMonth() + 3);
        else d.setFullYear(d.getFullYear() + 1);
        expiresAt = d;
      }

      const [sub] = await tx
        .insert(studentSubscriptions)
        .values({
          userId: target.id,
          planTier: effectiveTier,
          planName:
            body.billingCycle === "expire_now"
              ? `Subscription Ended → Auto-Switched to Free (${planMeta.shortLabel})`
              : planMeta.labelEn,
          billingCycle: body.billingCycle,
          planPriceInr: String(planMeta.priceInr),
          amountPaidInr: String(paidNow),
          amountDueInr: String(newDue),
          paymentStatus: computedStatus,
          paymentMode: body.paymentMode || "admin_managed",
          transactionRef:
            body.transactionRef || `ADM-${Date.now().toString(36).toUpperCase()}`,
          notes:
            body.notes ||
            (body.billingCycle === "expire_now"
              ? "Subscription expired — automatically switched to Free plan"
              : `Updated by Admin (${planMeta.shortLabel})`),
          startsAt: new Date(),
          expiresAt,
          createdBy: request.user!.id,
        })
        .returning();

      const [updatedUser] = await tx
        .update(users)
        .set({
          subscriptionTier: effectiveTier,
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

  /**
   * 5b. PATCH /admin/subscriptions/:id
   * Allows Admin to resolve failed payments, mark duplicate payments as refunded,
   * waive pending dues, or update transaction amounts/notes directly from Payment Management Console.
   */
  fastify.patch("/subscriptions/:id", async (request, reply) => {
    await ensureSubscriptionSchemaReady();
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const parsed = AdminUpdatePaymentTransactionSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.status(400).send({
        error: parsed.success ? "Invalid transaction id" : formatIssues(parsed.error.issues),
      });
    }
    const body = parsed.data;

    const [existing] = await db
      .select()
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.id, params.data.id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: "Payment transaction not found" });
    }

    const result = await db.transaction(async (tx) => {
      const [targetUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, existing.userId))
        .limit(1);

      const prevPaid = Number(existing.amountPaidInr ?? 0);
      const nextPaid =
        body.amountPaidInr !== undefined ? Number(body.amountPaidInr.toFixed(2)) : prevPaid;
      const nextDue =
        body.amountDueInr !== undefined
          ? Number(body.amountDueInr.toFixed(2))
          : body.paymentStatus === "paid" || body.paymentStatus === "waived" || body.paymentStatus === "refunded"
            ? 0
            : Number(existing.amountDueInr ?? 0);

      const [updatedSub] = await tx
        .update(studentSubscriptions)
        .set({
          paymentStatus: body.paymentStatus,
          amountPaidInr: String(nextPaid.toFixed(2)),
          amountDueInr: String(nextDue.toFixed(2)),
          notes: body.notes !== undefined ? body.notes : existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(studentSubscriptions.id, existing.id))
        .returning();

      let updatedUser = targetUser;
      if (targetUser && body.syncUserBalance) {
        let userTotalPaid = Number(targetUser.totalPaidInr ?? 0);
        // If resolving a duplicate/disputed payment via refund, deduct the refunded amount
        if (
          body.paymentStatus === "refunded" &&
          existing.paymentStatus !== "refunded" &&
          existing.paymentStatus !== "failed"
        ) {
          userTotalPaid = Math.max(0, Number((userTotalPaid - prevPaid).toFixed(2)));
        } else if (
          body.paymentStatus === "paid" &&
          (existing.paymentStatus === "failed" || existing.paymentStatus === "pending_due")
        ) {
          userTotalPaid = Number((userTotalPaid + nextPaid).toFixed(2));
        } else if (body.amountPaidInr !== undefined) {
          userTotalPaid = Math.max(0, Number((userTotalPaid + (nextPaid - prevPaid)).toFixed(2)));
        }

        const [uRow] = await tx
          .update(users)
          .set({
            totalPaidInr: String(userTotalPaid.toFixed(2)),
            paymentDueInr: String(nextDue.toFixed(2)),
            billingNotes: body.notes !== undefined ? body.notes : targetUser.billingNotes,
            updatedAt: new Date(),
          })
          .where(eq(users.id, targetUser.id))
          .returning();
        updatedUser = uRow;
      }

      return { updatedSub, updatedUser };
    });

    const subscriptionDto: StudentSubscriptionDto = {
      id: result.updatedSub.id,
      userId: result.updatedSub.userId,
      userName: result.updatedUser?.fullName,
      userEmail: result.updatedUser?.email,
      userTargetExamSlug: result.updatedUser?.targetExamSlug,
      planTier: result.updatedSub.planTier,
      planName: result.updatedSub.planName,
      billingCycle: result.updatedSub.billingCycle,
      planPriceInr: Number(result.updatedSub.planPriceInr),
      amountPaidInr: Number(result.updatedSub.amountPaidInr),
      amountDueInr: Number(result.updatedSub.amountDueInr),
      paymentStatus: result.updatedSub.paymentStatus,
      paymentMode: result.updatedSub.paymentMode,
      transactionRef: result.updatedSub.transactionRef ?? null,
      notes: result.updatedSub.notes ?? null,
      startsAt: result.updatedSub.startsAt.toISOString(),
      expiresAt: result.updatedSub.expiresAt ? result.updatedSub.expiresAt.toISOString() : null,
      createdAt: result.updatedSub.createdAt.toISOString(),
    };

    return {
      subscription: subscriptionDto,
      user: result.updatedUser ? toUserDto(result.updatedUser) : null,
    };
  });

  // ==========================================================================
  // 6. Admin Subscription Plans CRUD (Add, Modify, Delete Plans)
  // ==========================================================================

  /** GET /admin/subscription-plans — list all subscription plans (active + inactive) */
  fastify.get("/subscription-plans", async () => {
    const plans = await ensureSubscriptionPlansSeeded();
    return { plans };
  });

  /** POST /admin/subscription-plans — create a new subscription plan */
  fastify.post("/subscription-plans", async (request, reply) => {
    const parsed = SubscriptionPlanInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
    }
    const body = parsed.data;
    await ensureSubscriptionPlansSeeded();

    const [clash] = await db
      .select({ id: subscriptionPlans.id })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.tier, body.tier))
      .limit(1);
    if (clash) {
      return reply.status(409).send({
        error: `A plan with tier code "${body.tier}" already exists. Choose a unique code.`,
      });
    }

    const [created] = await db
      .insert(subscriptionPlans)
      .values({
        tier: body.tier,
        shortLabel: body.shortLabel,
        labelEn: body.labelEn,
        labelBn: body.labelBn || body.labelEn,
        priceInr: String(body.priceInr.toFixed(2)),
        billingCycle: body.billingCycle,
        durationDays: body.durationDays,
        descriptionEn: body.descriptionEn,
        descriptionBn: body.descriptionBn || body.descriptionEn,
        features: body.features,
        isActive: body.isActive,
        displayOrder: body.displayOrder,
      })
      .returning();

    return reply.status(201).send({ plan: toSubscriptionPlanDto(created) });
  });

  /** PUT /admin/subscription-plans/:id — modify an existing subscription plan */
  fastify.put("/subscription-plans/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const parsed = SubscriptionPlanInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.status(400).send({
        error: parsed.success ? "Invalid plan id" : formatIssues(parsed.error.issues),
      });
    }
    const body = parsed.data;

    const [current] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, params.data.id))
      .limit(1);
    if (!current) {
      return reply.status(404).send({ error: "Subscription plan not found" });
    }

    const nextTier = current.tier === "free" ? "free" : body.tier;
    if (nextTier !== current.tier) {
      const [clash] = await db
        .select({ id: subscriptionPlans.id })
        .from(subscriptionPlans)
        .where(and(eq(subscriptionPlans.tier, nextTier), ne(subscriptionPlans.id, current.id)))
        .limit(1);
      if (clash) {
        return reply.status(409).send({
          error: `Another plan already uses tier code "${nextTier}"`,
        });
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(subscriptionPlans)
        .set({
          tier: nextTier,
          shortLabel: body.shortLabel,
          labelEn: body.labelEn,
          labelBn: body.labelBn || body.labelEn,
          priceInr: current.tier === "free" ? "0.00" : String(body.priceInr.toFixed(2)),
          billingCycle: current.tier === "free" ? "lifetime" : body.billingCycle,
          durationDays: current.tier === "free" ? 0 : body.durationDays,
          descriptionEn: body.descriptionEn,
          descriptionBn: body.descriptionBn || body.descriptionEn,
          features: body.features,
          isActive: current.tier === "free" ? true : body.isActive,
          displayOrder: body.displayOrder,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionPlans.id, current.id))
        .returning();

      if (nextTier !== current.tier) {
        await tx
          .update(users)
          .set({ subscriptionTier: nextTier, updatedAt: new Date() })
          .where(eq(users.subscriptionTier, current.tier));
        await tx
          .update(examSeries)
          .set({ requiredTier: nextTier, updatedAt: new Date() })
          .where(eq(examSeries.requiredTier, current.tier));
      }
      return row;
    });

    return { plan: toSubscriptionPlanDto(updated) };
  });

  /** DELETE /admin/subscription-plans/:id — delete a subscription plan (reassigns users/series to 'free') */
  fastify.delete("/subscription-plans/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid plan id" });

    const [current] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, params.data.id))
      .limit(1);
    if (!current) return reply.status(404).send({ error: "Subscription plan not found" });

    if (current.tier === "free") {
      return reply.status(400).send({
        error: "The base 'free' fallback tier cannot be deleted (you can edit its labels and features).",
      });
    }

    await db.transaction(async (tx) => {
      // Switch any users who were on the deleted plan back to 'free'
      await tx
        .update(users)
        .set({
          subscriptionTier: "free",
          subscriptionExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(users.subscriptionTier, current.tier), ne(users.role, "admin")));

      // Switch any paid series requiring the deleted tier to 'pro_prelims'
      await tx
        .update(examSeries)
        .set({ requiredTier: "pro_prelims", updatedAt: new Date() })
        .where(eq(examSeries.requiredTier, current.tier));

      await tx.delete(subscriptionPlans).where(eq(subscriptionPlans.id, current.id));
    });

    return { deleted: true, tier: current.tier };
  });
};
