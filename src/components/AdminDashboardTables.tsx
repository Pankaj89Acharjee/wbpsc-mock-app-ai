import React, { useState } from "react";
import { Award, CreditCard, RefreshCw, X } from "lucide-react";
import {
  SUBSCRIPTION_TIER_PLANS,
  getSubscriptionTierLabel,
  type AttemptSummaryDto,
  type StudentSubscriptionDto,
  type SubscriptionPlanDto,
  type SubscriptionTier,
  type UserDto,
  type UserRole,
} from "../../packages/shared-types/src/index";
import { api } from "../api";
import { AdminSubscriptionPlansManager } from "./SubscriptionModal";
import { formatClock } from "./types";

interface AdminDashboardTablesProps {
  allUsers: UserDto[];
  allAttempts: AttemptSummaryDto[];
  allSubscriptions: StudentSubscriptionDto[];
  plans: SubscriptionPlanDto[];
  onRefreshAdminData: () => void;
  onUpdateUser: (
    target: UserDto,
    updates: Partial<
      Pick<
        UserDto,
        | "subscriptionTier"
        | "isActive"
        | "paymentDueInr"
        | "totalPaidInr"
        | "billingNotes"
      >
    > & {
      role?: Exclude<UserRole, "admin">;
    }
  ) => void;
  onNotify: (type: "success" | "error" | "info", text: string) => void;
}

export default function AdminDashboardTables({
  allUsers,
  allAttempts,
  allSubscriptions,
  plans,
  onRefreshAdminData,
  onUpdateUser,
  onNotify,
}: AdminDashboardTablesProps) {
  const [perfSearchQuery, setPerfSearchQuery] = useState<string>("");
  const [subSearchQuery, setSubSearchQuery] = useState<string>("");
  const [managingStudentSub, setManagingStudentSub] = useState<{
    user: UserDto;
    planTier: SubscriptionTier;
    amountPaidNowInr: string;
    paymentDueInr: string;
    billingCycle: "monthly" | "quarterly" | "yearly" | "lifetime" | "expire_now";
    notes: string;
  } | null>(null);
  const [manageSubBusy, setManageSubBusy] = useState<boolean>(false);

  const planCatalog = plans.length > 0 ? plans : SUBSCRIPTION_TIER_PLANS;
  const studentUsers = allUsers.filter((u) => u.role !== "admin");

  const handleAdminManageSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingStudentSub || manageSubBusy) return;
    setManageSubBusy(true);
    try {
      const r = await api<{ user: UserDto; subscription: StudentSubscriptionDto }>(
        "/admin/subscriptions/manage",
        {
          method: "POST",
          body: {
            userId: managingStudentSub.user.id,
            planTier: managingStudentSub.planTier,
            amountPaidNowInr: Number(managingStudentSub.amountPaidNowInr) || 0,
            paymentDueInr: Number(managingStudentSub.paymentDueInr) || 0,
            billingCycle: managingStudentSub.billingCycle,
            notes: managingStudentSub.notes.trim() || undefined,
          },
        }
      );
      setManagingStudentSub(null);
      onRefreshAdminData();
      onNotify(
        "success",
        `Updated subscription for ${r.user.fullName}: ${getSubscriptionTierLabel(
          r.user.subscriptionTier,
          planCatalog
        )} · Payment Due ₹${r.user.paymentDueInr ?? 0}.`
      );
    } catch (err) {
      onNotify(
        "error",
        (err as Error).message || "Could not update student subscription"
      );
    } finally {
      setManageSubBusy(false);
    }
  };

  return (
    <div className="space-y-8 pt-2">
      {/* ===================================================================
          1. EVERY STUDENT'S EXAM PERFORMANCE TABLE (Below 01. Mock Test Series)
      =================================================================== */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Award className="w-5 h-5 text-emerald-400" />
              Student Mock Result &amp; Exam Performance (All Aspirants)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Live performance across all students — Aspirant Name, Plan Type, Enrolled Exam, Test Given, Score, Negative Marks, Accuracy &amp; Status.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={perfSearchQuery}
              onChange={(e) => setPerfSearchQuery(e.target.value)}
              placeholder="Search aspirant, exam, series, plan…"
              className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none w-64"
            />
            <button
              type="button"
              onClick={onRefreshAdminData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>

        {/* Fixed height table container with vertical scrolling on overflow */}
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3 px-3.5 whitespace-nowrap">Aspirant Name</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Type of Plan</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Enrolled Exam</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Test Given</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Score</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Negative Marks</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Accuracy</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Attempt Details &amp; Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {(() => {
                const q = perfSearchQuery.trim().toLowerCase();
                const filtered = allAttempts.filter((att) => {
                  if (!q) return true;
                  const hay = [
                    att.userName,
                    att.userEmail,
                    att.userSubscriptionTier,
                    att.userTargetExamSlug,
                    att.examTitleEn,
                    att.series?.name.en,
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                  return hay.includes(q);
                });

                if (filtered.length === 0) {
                  return (
                    <tr>
                      <td colSpan={8} className="py-8 px-4 text-center text-slate-400">
                        No student exam attempts match the filter yet.
                      </td>
                    </tr>
                  );
                }

                return filtered.map((att) => {
                  const tier = att.userSubscriptionTier || "free";
                  const isPaused = att.attemptStatus === "in_progress";
                  const testGivenLabel = att.series
                    ? att.series.name.en
                    : att.isRemedial
                      ? `Remedial Mock (${att.examTitleEn})`
                      : `Random Mock (${att.examTitleEn})`;
                  return (
                    <tr key={att.id} className="hover:bg-slate-900/70 transition-colors">
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-white">
                          {att.userName || "Aspirant"}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {att.userEmail}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            tier === "free"
                              ? "bg-slate-800/80 border-slate-700 text-slate-300"
                              : "bg-amber-500/15 border-amber-500/35 text-amber-300"
                          }`}
                        >
                          {getSubscriptionTierLabel(tier, planCatalog)}
                        </span>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="text-slate-200 font-medium">
                          {att.examTitleEn}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          Target: {att.userTargetExamSlug || att.examSlug}
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-white flex flex-wrap items-center gap-1.5">
                          <span>{testGivenLabel}</span>
                          {att.series?.accessType === "paid" ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              PAID
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              FREE
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {att.submittedAt
                            ? new Date(att.submittedAt).toLocaleString()
                            : att.startedAt
                              ? `Started ${new Date(att.startedAt).toLocaleString()}`
                              : "—"}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-bold text-emerald-400">
                          {att.finalNetScore} / {att.maxPossibleScore}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          +{att.rawPositiveScore ?? att.correctCount} raw ({att.correctCount}✓)
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-bold text-rose-400">
                          −{att.negativePenalty ?? 0}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {att.incorrectCount} wrong
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded font-bold ${
                            att.accuracyPercentage >= 70
                              ? "bg-emerald-500/15 text-emerald-300"
                              : att.accuracyPercentage >= 45
                                ? "bg-amber-500/15 text-amber-300"
                                : "bg-rose-500/15 text-rose-300"
                          }`}
                        >
                          {att.accuracyPercentage}%
                        </span>
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isPaused ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              PAUSED / ONGOING
                            </span>
                          ) : att.cutoffCleared ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              CUTOFF CLEARED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              BELOW CUTOFF
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {att.attemptedCount}/{att.totalQuestions} attempted ·{" "}
                          {formatClock(att.totalTimeSpentSeconds)}
                        </div>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===================================================================
          2. STUDENT SUBSCRIPTION & PAYMENT DUES MANAGEMENT (Below Student Mock Result)
      =================================================================== */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-amber-400" />
              Student Subscription &amp; Payment Dues Management
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage every student&apos;s subscription tier, total paid amount, validity date, and pending payment dues. Expired plans automatically revert to Free Tier.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={subSearchQuery}
              onChange={(e) => setSubSearchQuery(e.target.value)}
              placeholder="Search student or plan…"
              className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none w-60"
            />
          </div>
        </div>

        {/* Subscription KPI Summary Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[11px] text-slate-400">Total Aspirants</div>
            <div className="text-xl font-bold font-mono text-white mt-0.5">
              {studentUsers.length}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[11px] text-slate-400">Paid Plan Subscribers</div>
            <div className="text-xl font-bold font-mono text-amber-300 mt-0.5">
              {studentUsers.filter((u) => u.subscriptionTier !== "free").length}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[11px] text-slate-400">Total Payments Collected</div>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
              ₹
              {studentUsers
                .reduce((sum, u) => sum + (u.totalPaidInr ?? 0), 0)
                .toLocaleString("en-IN")}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[11px] text-slate-400">Outstanding Payment Dues</div>
            <div className="text-xl font-bold font-mono text-rose-400 mt-0.5">
              ₹
              {studentUsers
                .reduce((sum, u) => sum + (u.paymentDueInr ?? 0), 0)
                .toLocaleString("en-IN")}
            </div>
          </div>
        </div>

        {/* Inline Manage Student Subscription Modal / Card */}
        {managingStudentSub && (
          <form
            onSubmit={handleAdminManageSubscription}
            className="rounded-xl border border-amber-500/40 bg-slate-950 p-4 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Manage Subscription &amp; Dues — {managingStudentSub.user.fullName} (
                  {managingStudentSub.user.email})
                </h3>
                <p className="text-[11px] text-slate-400">
                  Assign plan tier, record a payment, set/waive outstanding payment dues, or end subscription (switches student to Free Tier).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManagingStudentSub(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <label className="space-y-1 text-slate-300">
                <span>Subscription Plan Tier *</span>
                <select
                  value={managingStudentSub.planTier}
                  onChange={(e) => {
                    const nextTier = e.target.value as SubscriptionTier;
                    setManagingStudentSub((prev) =>
                      prev ? { ...prev, planTier: nextTier } : null
                    );
                  }}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                >
                  {planCatalog.map((p) => (
                    <option key={p.tier} value={p.tier}>
                      {p.shortLabel} (₹{p.priceInr})
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Validity / Cycle</span>
                <select
                  value={managingStudentSub.billingCycle}
                  onChange={(e) =>
                    setManagingStudentSub((prev) =>
                      prev
                        ? {
                            ...prev,
                            billingCycle: e.target.value as
                              | "monthly"
                              | "quarterly"
                              | "yearly"
                              | "lifetime"
                              | "expire_now",
                          }
                        : null
                    )
                  }
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                >
                  <option value="yearly">Yearly (12 Months)</option>
                  <option value="quarterly">Quarterly (3 Months)</option>
                  <option value="monthly">Monthly (1 Month)</option>
                  <option value="lifetime">Lifetime</option>
                  <option value="expire_now">
                    Expire Now → Auto-Switch to Free Plan
                  </option>
                </select>
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Additional Amount Paid Now (₹)</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={managingStudentSub.amountPaidNowInr}
                  onChange={(e) =>
                    setManagingStudentSub((prev) =>
                      prev ? { ...prev, amountPaidNowInr: e.target.value } : null
                    )
                  }
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                />
              </label>

              <label className="space-y-1 text-slate-300">
                <span className="flex items-center justify-between">
                  <span>Remaining Payment Due (₹)</span>
                  <button
                    type="button"
                    onClick={() =>
                      setManagingStudentSub((prev) =>
                        prev ? { ...prev, paymentDueInr: "0" } : null
                      )
                    }
                    className="text-[10px] text-emerald-400 hover:underline cursor-pointer"
                  >
                    Clear Due (₹0)
                  </button>
                </span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={managingStudentSub.paymentDueInr}
                  onChange={(e) =>
                    setManagingStudentSub((prev) =>
                      prev ? { ...prev, paymentDueInr: e.target.value } : null
                    )
                  }
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                />
              </label>

              <label className="space-y-1 text-slate-300 sm:col-span-2 lg:col-span-4">
                <span>Billing / Subscription Notes</span>
                <input
                  type="text"
                  value={managingStudentSub.notes}
                  onChange={(e) =>
                    setManagingStudentSub((prev) =>
                      prev ? { ...prev, notes: e.target.value } : null
                    )
                  }
                  placeholder="e.g., Paid ₹200 via test payment, ₹99 due next month"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={manageSubBusy}
                className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
              >
                {manageSubBusy ? "Saving…" : "Save Subscription & Payment Dues"}
              </button>
              <button
                type="button"
                onClick={() => setManagingStudentSub(null)}
                className="px-3.5 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Fixed-height Vertically Scrollable Student Subscriptions Table */}
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3 px-3.5 whitespace-nowrap">Aspirant</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Current Plan Tier</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Plan Price</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Total Paid</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Payment Due</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Status &amp; Validity</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Last Transaction / Notes</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {(() => {
                const q = subSearchQuery.trim().toLowerCase();
                const filteredUsers = studentUsers.filter((u) => {
                  if (!q) return true;
                  return (
                    u.fullName.toLowerCase().includes(q) ||
                    u.email.toLowerCase().includes(q) ||
                    u.subscriptionTier.toLowerCase().includes(q)
                  );
                });

                if (filteredUsers.length === 0) {
                  return (
                    <tr>
                      <td colSpan={8} className="py-8 px-4 text-center text-slate-400">
                        No students match your search.
                      </td>
                    </tr>
                  );
                }

                return filteredUsers.map((u) => {
                  const planMeta =
                    planCatalog.find((p) => p.tier === u.subscriptionTier) ??
                    SUBSCRIPTION_TIER_PLANS[0];
                  const latestTx = allSubscriptions.find((s) => s.userId === u.id);
                  const due = u.paymentDueInr ?? 0;
                  const paid = u.totalPaidInr ?? 0;

                  return (
                    <tr key={u.id} className="hover:bg-slate-900/70 transition-colors">
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-white">{u.fullName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {u.email}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <select
                          value={u.subscriptionTier}
                          onChange={(e) =>
                            onUpdateUser(u, {
                              subscriptionTier: e.target.value as SubscriptionTier,
                            })
                          }
                          className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-white text-xs"
                        >
                          {planCatalog.map((p) => (
                            <option key={p.tier} value={p.tier}>
                              {p.shortLabel} ({p.tier})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-300">
                        ₹{planMeta.priceInr}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-emerald-400">
                        ₹{paid}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                        <span
                          className={`font-bold ${
                            due > 0 ? "text-rose-400" : "text-slate-400"
                          }`}
                        >
                          ₹{due}
                        </span>
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div>
                          {due > 0 ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                              PAYMENT DUE (₹{due})
                            </span>
                          ) : u.subscriptionTier !== "free" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              PAID &amp; ACTIVE
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                              FREE TIER
                            </span>
                          )}
                        </div>
                        {u.subscriptionTier !== "free" && u.subscriptionExpiresAt && (
                          <div className="text-[10px] text-sky-300 font-mono mt-0.5">
                            Valid till {new Date(u.subscriptionExpiresAt).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3.5">
                        {latestTx ? (
                          <div>
                            <div className="font-mono text-[11px] text-amber-300">
                              {latestTx.transactionRef} · ₹{latestTx.amountPaidInr} (
                              {latestTx.paymentMode})
                            </div>
                            <div className="text-[11px] text-slate-400 truncate max-w-xs">
                              {latestTx.notes ||
                                u.billingNotes ||
                                new Date(latestTx.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">
                            {u.billingNotes || "No payment record yet"}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setManagingStudentSub({
                              user: u,
                              planTier: u.subscriptionTier,
                              amountPaidNowInr: "0",
                              paymentDueInr: String(u.paymentDueInr ?? 0),
                              billingCycle: "yearly",
                              notes: u.billingNotes ?? "",
                            })
                          }
                          className="px-2.5 py-1 text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 rounded-md cursor-pointer"
                        >
                          Manage Plan / Dues
                        </button>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>

        {/* Admin Subscription Plans Catalog & Manager (Add, Modify, Delete Plans) */}
        <div className="pt-4 border-t border-slate-800">
          <AdminSubscriptionPlansManager
            plans={plans}
            onPlansChanged={onRefreshAdminData}
            onNotify={onNotify}
          />
        </div>
      </section>
    </div>
  );
}
