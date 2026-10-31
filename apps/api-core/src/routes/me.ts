import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, queryClient } from "../db/index";
import {
  attemptAnswers,
  examSeries,
  exams,
  questions,
  studentSubscriptions,
  subjects,
  subscriptionPlans,
  subtopics,
  testAttempts,
  users,
  userSubtopicMastery,
} from "../db/schema";
import {
  SUBSCRIPTION_TIER_PLANS,
  SubscriptionTierSchema,
  type AttemptReviewDto,
  type BilingualText,
  type AttemptSummaryDto,
  type MasteryDto,
  type PausedAttemptDto,
  type SeriesAccessType,
  type StudentSubscriptionDto,
  type SubscriptionPlanDto,
  type SubscriptionTier,
} from "../../../../packages/shared-types/src/index";
import { requireUser } from "../lib/auth";
import { formatIssues } from "../lib/validation";
import { toUserDto } from "./auth";

type AttemptRow = typeof testAttempts.$inferSelect;
type ExamRow = typeof exams.$inferSelect;
type SubscriptionPlanRow = typeof subscriptionPlans.$inferSelect;

let subscriptionSchemaVerified = false;

/**
 * Self-healing schema guard that ensures `student_subscriptions` (including `created_by`),
 * `subscription_plans`, and user billing columns exist in PostgreSQL even if migrations
 * were skipped or partially applied on an earlier DB snapshot.
 */
export async function ensureSubscriptionSchemaReady(): Promise<void> {
  if (subscriptionSchemaVerified) return;
  await queryClient.unsafe(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS payment_due_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
      ADD COLUMN IF NOT EXISTS total_paid_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
      ADD COLUMN IF NOT EXISTS billing_notes text,
      ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

    ALTER TABLE users
      ALTER COLUMN subscription_tier DROP DEFAULT,
      ALTER COLUMN subscription_tier TYPE varchar(80) USING subscription_tier::text,
      ALTER COLUMN subscription_tier SET DEFAULT 'free';

    ALTER TABLE exam_series
      ADD COLUMN IF NOT EXISTS access_type varchar(16) NOT NULL DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS required_tier varchar(80) NOT NULL DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS price_inr numeric(8, 2) NOT NULL DEFAULT 0.00;

    ALTER TABLE exam_series
      ALTER COLUMN required_tier DROP DEFAULT,
      ALTER COLUMN required_tier TYPE varchar(80) USING required_tier::text,
      ALTER COLUMN required_tier SET DEFAULT 'free';

    CREATE TABLE IF NOT EXISTS subscription_plans (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      tier varchar(80) NOT NULL UNIQUE,
      short_label varchar(80) NOT NULL,
      label_en varchar(200) NOT NULL,
      label_bn varchar(200) NOT NULL DEFAULT '',
      price_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
      billing_cycle varchar(32) NOT NULL DEFAULT 'yearly',
      duration_days integer NOT NULL DEFAULT 365,
      description_en text NOT NULL DEFAULT '',
      description_bn text NOT NULL DEFAULT '',
      features jsonb NOT NULL DEFAULT '[]'::jsonb,
      is_active boolean NOT NULL DEFAULT true,
      display_order integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS subscription_plans_order_idx
      ON subscription_plans (display_order, created_at);

    CREATE TABLE IF NOT EXISTS student_subscriptions (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_tier varchar(80) NOT NULL DEFAULT 'pro_prelims',
      plan_name varchar(160) NOT NULL,
      billing_cycle varchar(32) NOT NULL DEFAULT 'yearly',
      plan_price_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
      amount_paid_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
      amount_due_inr numeric(8, 2) NOT NULL DEFAULT 0.00,
      payment_status varchar(32) NOT NULL DEFAULT 'paid',
      payment_mode varchar(64) NOT NULL DEFAULT 'test_payment',
      transaction_ref varchar(120),
      notes text,
      starts_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE student_subscriptions
      ALTER COLUMN plan_tier DROP DEFAULT,
      ALTER COLUMN plan_tier TYPE varchar(80) USING plan_tier::text,
      ALTER COLUMN plan_tier SET DEFAULT 'pro_prelims';

    ALTER TABLE student_subscriptions
      ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS transaction_ref varchar(120),
      ADD COLUMN IF NOT EXISTS notes text,
      ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    CREATE INDEX IF NOT EXISTS student_subscriptions_user_idx
      ON student_subscriptions (user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS student_subscriptions_status_idx
      ON student_subscriptions (payment_status);
  `);
  subscriptionSchemaVerified = true;
}

export function toSubscriptionPlanDto(p: SubscriptionPlanRow): SubscriptionPlanDto {
  return {
    id: p.id,
    tier: p.tier,
    shortLabel: p.shortLabel,
    labelEn: p.labelEn,
    labelBn: p.labelBn || p.labelEn,
    priceInr: Number(p.priceInr ?? 0),
    billingCycle: p.billingCycle,
    durationDays: p.durationDays,
    descriptionEn: p.descriptionEn,
    descriptionBn: p.descriptionBn || p.descriptionEn,
    features: Array.isArray(p.features) ? p.features : [],
    isActive: p.isActive,
    displayOrder: p.displayOrder,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Ensures the default 5 subscription plans exist in PostgreSQL. */
export async function ensureSubscriptionPlansSeeded(): Promise<SubscriptionPlanDto[]> {
  await ensureSubscriptionSchemaReady();
  let rows = await db
    .select()
    .from(subscriptionPlans)
    .orderBy(asc(subscriptionPlans.displayOrder), asc(subscriptionPlans.createdAt));

  if (rows.length === 0) {
    await db
      .insert(subscriptionPlans)
      .values(
        SUBSCRIPTION_TIER_PLANS.map((p, idx) => ({
          tier: p.tier,
          shortLabel: p.shortLabel,
          labelEn: p.labelEn,
          labelBn: p.labelBn,
          priceInr: String(p.priceInr),
          billingCycle: p.billingCycle,
          durationDays: p.durationDays ?? (p.tier === "free" ? 0 : 365),
          descriptionEn: p.descriptionEn,
          descriptionBn: p.descriptionBn,
          features: p.features,
          isActive: true,
          displayOrder: p.displayOrder ?? idx + 1,
        }))
      )
      .onConflictDoNothing({ target: subscriptionPlans.tier });

    rows = await db
      .select()
      .from(subscriptionPlans)
      .orderBy(asc(subscriptionPlans.displayOrder), asc(subscriptionPlans.createdAt));
  }

  return rows.map(toSubscriptionPlanDto);
}

/** The test series an attempt was for; it sets the cutoff */
export type SeriesRef = {
  id: string;
  name: BilingualText;
  cutoff: string | number;
  accessType?: SeriesAccessType;
  requiredTier?: SubscriptionTier;
} | null;

export function toAttemptSummary(a: AttemptRow, exam: ExamRow, series: SeriesRef = null): AttemptSummaryDto {
  const finalNetScore = Number(a.finalNetScore);
  const cutoff = Number(series ? series.cutoff : exam.estimatedCutoffMarks);
  return {
    id: a.id,
    examId: exam.id,
    examSlug: exam.slug,
    examTitleEn: exam.title.en,
    examTitleBn: exam.title.bn,
    isRemedial: a.isRemedial,
    totalQuestions: a.totalQuestions,
    attemptedCount: a.attemptedCount,
    correctCount: a.correctCount,
    incorrectCount: a.incorrectCount,
    unansweredCount: a.unansweredCount,
    rawPositiveScore: Number(a.rawPositiveScore ?? 0),
    negativePenalty: Number(a.negativePenalty ?? 0),
    finalNetScore,
    maxPossibleScore: Number(a.maxPossibleScore),
    accuracyPercentage: Number(a.accuracyPercentage),
    totalTimeSpentSeconds: a.totalTimeSpentSeconds,
    cutoffCleared: finalNetScore >= cutoff,
    submittedAt: a.submittedAt?.toISOString() ?? null,
    startedAt: a.startedAt?.toISOString() ?? null,
    attemptStatus: a.status,
    series: series && {
      id: series.id,
      name: series.name,
      accessType: series.accessType ?? "free",
      requiredTier: series.requiredTier ?? "free",
    },
  };
}

// ============================================================================
// Route Plugin Implementation (registered under /me) — the signed-in student's data
// ============================================================================

export const meRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook("preHandler", requireUser);

  /** 1. GET /me/attempts — submitted mock tests, newest first */
  fastify.get("/attempts", async (request) => {
    const rows = await db
      .select({
        attempt: testAttempts,
        exam: exams,
        seriesId: examSeries.id,
        seriesName: examSeries.name,
        seriesCutoff: examSeries.estimatedCutoffMarks,
        seriesAccessType: examSeries.accessType,
        seriesRequiredTier: examSeries.requiredTier,
      })
      .from(testAttempts)
      .innerJoin(exams, eq(testAttempts.examId, exams.id))
      .leftJoin(examSeries, eq(testAttempts.seriesId, examSeries.id))
      .where(
        and(eq(testAttempts.userId, request.user!.id), eq(testAttempts.status, "submitted"))
      )
      .orderBy(desc(testAttempts.submittedAt))
      .limit(100);
    return {
      attempts: rows.map((r) =>
        toAttemptSummary(
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
        )
      ),
    };
  });

  /**
   * 2. GET /me/attempts/:id/review
   * Question-by-question: your answer vs the correct one, marks, explanation.
   * Admins may open anyone's attempt.
   */
  fastify.get("/attempts/:id/review", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid attempt id" });

    const [row] = await db
      .select({ attempt: testAttempts, exam: exams })
      .from(testAttempts)
      .innerJoin(exams, eq(testAttempts.examId, exams.id))
      .where(eq(testAttempts.id, params.data.id))
      .limit(1);
    if (!row || (row.attempt.userId !== request.user!.id && request.user!.role !== "admin")) {
      return reply.status(404).send({ error: "Attempt not found" });
    }

    const items = await db
      .select({
        questionId: attemptAnswers.questionId,
        stem: questions.stem,
        options: questions.options,
        correctOption: questions.correctOption,
        selectedOption: attemptAnswers.selectedOption,
        marksAwarded: attemptAnswers.marksAwarded,
        timeSpentSeconds: attemptAnswers.timeSpentSeconds,
        explanation: questions.explanation,
        subtopicName: subtopics.name,
      })
      .from(attemptAnswers)
      .innerJoin(questions, eq(attemptAnswers.questionId, questions.id))
      .innerJoin(subtopics, eq(attemptAnswers.subtopicId, subtopics.id))
      .where(eq(attemptAnswers.attemptId, row.attempt.id))
      .orderBy(asc(attemptAnswers.position));

    const review: AttemptReviewDto = {
      attempt: toAttemptSummary(row.attempt, row.exam),
      items: items.map((i) => ({ ...i, marksAwarded: Number(i.marksAwarded) })),
    };
    return review;
  });

  /** 3. GET /me/mastery — weakness radar, weakest first */
  fastify.get("/mastery", async (request) => {
    const rows = await db
      .select({
        m: userSubtopicMastery,
        examSlug: exams.slug,
        subjectName: subjects.name,
        subtopicSlug: subtopics.slug,
        subtopicName: subtopics.name,
      })
      .from(userSubtopicMastery)
      .innerJoin(exams, eq(userSubtopicMastery.examId, exams.id))
      .innerJoin(subjects, eq(userSubtopicMastery.subjectId, subjects.id))
      .innerJoin(subtopics, eq(userSubtopicMastery.subtopicId, subtopics.id))
      .where(eq(userSubtopicMastery.userId, request.user!.id))
      .orderBy(desc(userSubtopicMastery.weaknessPriorityScore));

    const mastery: MasteryDto[] = rows.map(({ m, ...names }) => ({
      id: m.id,
      examId: m.examId,
      examSlug: names.examSlug,
      subjectName: names.subjectName,
      subtopicId: m.subtopicId,
      subtopicSlug: names.subtopicSlug,
      subtopicName: names.subtopicName,
      totalEncountered: m.totalEncountered,
      totalCorrect: m.totalCorrect,
      totalIncorrect: m.totalIncorrect,
      accuracyPercentage: Number(m.accuracyPercentage),
      avgTimeSeconds: Number(m.avgTimePerQuestionSeconds),
      masteryBand: m.masteryBand,
      weaknessPriorityScore: Number(m.weaknessPriorityScore),
    }));
    return { mastery };
  });

  /** 4. GET /me/paused-attempts — ongoing / postponed tests that can be resumed */
  fastify.get("/paused-attempts", async (request) => {
    const rows = await db
      .select({
        attempt: testAttempts,
        exam: exams,
        series: examSeries,
      })
      .from(testAttempts)
      .innerJoin(exams, eq(testAttempts.examId, exams.id))
      .leftJoin(examSeries, eq(testAttempts.seriesId, examSeries.id))
      .where(
        and(eq(testAttempts.userId, request.user!.id), eq(testAttempts.status, "in_progress"))
      )
      .orderBy(desc(testAttempts.startedAt))
      .limit(20);

    const pausedAttempts: PausedAttemptDto[] = [];
    for (const r of rows) {
      const ansRows = await db
        .select({
          ans: attemptAnswers,
          q: questions,
          subjectName: subjects.name,
          subtopicName: subtopics.name,
        })
        .from(attemptAnswers)
        .innerJoin(questions, eq(attemptAnswers.questionId, questions.id))
        .innerJoin(subjects, eq(questions.subjectId, subjects.id))
        .innerJoin(subtopics, eq(attemptAnswers.subtopicId, subtopics.id))
        .where(eq(attemptAnswers.attemptId, r.attempt.id))
        .orderBy(asc(attemptAnswers.position));

      if (ansRows.length === 0) continue;

      const firstUnansweredIdx = ansRows.findIndex((x) => x.ans.selectedOption === null);
      const currentQuestionIdx = firstUnansweredIdx >= 0 ? firstUnansweredIdx : 0;
      const s = r.series;

      pausedAttempts.push({
        attemptId: r.attempt.id,
        examId: r.exam.id,
        examSlug: r.exam.slug,
        examTitleEn: s ? `${r.exam.title.en} — ${s.name.en}` : r.exam.title.en,
        examTitleBn: s ? `${r.exam.title.bn} — ${s.name.bn}` : r.exam.title.bn,
        seriesId: s?.id ?? null,
        seriesName: s?.name ?? null,
        isRemedial: r.attempt.isRemedial,
        preferredLanguage: r.attempt.preferredLanguage,
        durationMinutes: s ? s.durationMinutes : r.exam.durationMinutes,
        marksPerCorrect: Number(s ? s.marksPerCorrect : r.exam.marksPerCorrect),
        negativeMarksPerWrong: Number(s ? s.negativeMarksPerWrong : r.exam.negativeMarksPerWrong),
        estimatedCutoffMarks: Number(s ? s.estimatedCutoffMarks : r.exam.estimatedCutoffMarks),
        totalQuestions: ansRows.length,
        answeredCount: ansRows.filter((x) => x.ans.selectedOption !== null).length,
        totalTimeSpentSeconds: r.attempt.totalTimeSpentSeconds,
        currentQuestionIdx,
        pausedAt: r.attempt.startedAt.toISOString(),
        questions: ansRows.map((x) => ({
          id: x.q.id,
          subjectName: x.subjectName,
          subtopicName: x.subtopicName,
          stem: x.q.stem,
          options: x.q.options,
          previousYearTag: x.q.previousYearTag ?? null,
          selectedOption: x.ans.selectedOption,
          state: x.ans.state,
          timeSpentSeconds: x.ans.timeSpentSeconds,
        })),
      });
    }

    return { pausedAttempts };
  });

  /** 5. DELETE /me/paused-attempts/:id — discard a paused test */
  fastify.delete("/paused-attempts/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid attempt id" });

    await db
      .delete(testAttempts)
      .where(
        and(
          eq(testAttempts.id, params.data.id),
          eq(testAttempts.userId, request.user!.id),
          eq(testAttempts.status, "in_progress")
        )
      );
    return { deleted: true };
  });

  /** 6. GET /me/plans — active subscription plans available for Aspirants */
  fastify.get("/plans", async () => {
    const allPlans = await ensureSubscriptionPlansSeeded();
    return { plans: allPlans.filter((p) => p.isActive) };
  });

  /** 7. GET /me/subscriptions — student's own subscription & test payment history */
  fastify.get("/subscriptions", async (request) => {
    await ensureSubscriptionSchemaReady();
    const rows = await db
      .select()
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.userId, request.user!.id))
      .orderBy(desc(studentSubscriptions.createdAt))
      .limit(50);

    const subscriptions: StudentSubscriptionDto[] = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      planTier: r.planTier,
      planName: r.planName,
      billingCycle: r.billingCycle,
      planPriceInr: Number(r.planPriceInr),
      amountPaidInr: Number(r.amountPaidInr),
      amountDueInr: Number(r.amountDueInr),
      paymentStatus: r.paymentStatus,
      paymentMode: r.paymentMode,
      transactionRef: r.transactionRef ?? null,
      notes: r.notes ?? null,
      startsAt: r.startsAt.toISOString(),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { subscriptions };
  });

  /**
   * 8. POST /me/subscriptions/purchase
   * Allows a logged-in aspirant to buy/upgrade a subscription plan or pay pending dues
   * using a simulated Test Payment (before live Razorpay integration).
   * Admins do not purchase plans.
   */
  const PurchaseSubscriptionBodySchema = z.object({
    planTier: SubscriptionTierSchema,
    testPaidAmountInr: z.coerce.number().min(0).max(500_000).default(0),
    billingCycle: z
      .enum(["monthly", "quarterly", "yearly", "annual", "lifetime"])
      .default("yearly"),
    payExistingDueOnly: z.coerce.boolean().default(false),
    notes: z.string().trim().max(500).nullable().optional(),
  });

  fastify.post("/subscriptions/purchase", async (request, reply) => {
    if (request.user?.role === "admin") {
      return reply.status(403).send({
        error: "Admins manage subscription plans and do not purchase aspirant plans.",
      });
    }

    await ensureSubscriptionSchemaReady();

    let rawBody: unknown = request.body;
    if (typeof rawBody === "string") {
      try {
        rawBody = JSON.parse(rawBody);
      } catch {
        rawBody = {};
      }
    }

    const parsed = PurchaseSubscriptionBodySchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: formatIssues(parsed.error.issues) });
    }
    const body = parsed.data;
    const currentUser = request.user!;
    const allPlans = await ensureSubscriptionPlansSeeded();
    const planMeta =
      allPlans.find((p) => p.tier === body.planTier) ??
      SUBSCRIPTION_TIER_PLANS.find((p) => p.tier === body.planTier) ??
      allPlans[1] ??
      SUBSCRIPTION_TIER_PLANS[1];

    const result = await db.transaction(async (tx) => {
      const [u] = await tx
        .select()
        .from(users)
        .where(eq(users.id, currentUser.id))
        .limit(1);
      if (!u) throw new Error("User not found");

      const existingDue = Number(u.paymentDueInr ?? 0);
      const existingTotalPaid = Number(u.totalPaidInr ?? 0);
      const planPrice = body.payExistingDueOnly ? existingDue : planMeta.priceInr;
      const paidNow = Number(body.testPaidAmountInr.toFixed(2));

      // Compute updated due:
      // If paying existing due only: reduce existingDue by paidNow.
      // If purchasing a plan: any shortfall on the plan (planPrice - paidNow) is added to existingDue (or reduced if overpaid).
      const newDue = body.payExistingDueOnly
        ? Math.max(0, Number((existingDue - paidNow).toFixed(2)))
        : Math.max(0, Number((existingDue + (planPrice - paidNow)).toFixed(2)));

      const newTotalPaid = Number((existingTotalPaid + paidNow).toFixed(2));
      const paymentStatus: StudentSubscriptionDto["paymentStatus"] =
        newDue <= 0 ? "paid" : paidNow > 0 ? "partial_due" : "pending_due";

      let expiresAt: Date | null = new Date();
      if (body.billingCycle === "lifetime" || body.planTier === "free") {
        expiresAt = null;
      } else if (body.billingCycle === "monthly") {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      } else if (body.billingCycle === "quarterly") {
        expiresAt.setMonth(expiresAt.getMonth() + 3);
      } else {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }

      const txRef = `TEST-PAY-${Date.now().toString(36).toUpperCase()}`;

      const [sub] = await tx
        .insert(studentSubscriptions)
        .values({
          userId: u.id,
          planTier: body.planTier,
          planName: body.payExistingDueOnly
            ? `Due Clearance (${planMeta.shortLabel})`
            : planMeta.labelEn,
          billingCycle: body.billingCycle === "annual" ? "yearly" : body.billingCycle,
          planPriceInr: String(planPrice),
          amountPaidInr: String(paidNow),
          amountDueInr: String(newDue),
          paymentStatus,
          paymentMode: "test_payment",
          transactionRef: txRef,
          notes:
            body.notes ||
            (body.payExistingDueOnly
              ? `Aspirant paid ₹${paidNow} towards pending dues`
              : `Test subscription purchase by aspirant (${planMeta.shortLabel})`),
          startsAt: new Date(),
          expiresAt,
          createdBy: u.id,
        })
        .returning();

      const [updatedUser] = await tx
        .update(users)
        .set({
          subscriptionTier: body.planTier,
          paymentDueInr: String(newDue),
          totalPaidInr: String(newTotalPaid),
          subscriptionExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(users.id, u.id))
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
