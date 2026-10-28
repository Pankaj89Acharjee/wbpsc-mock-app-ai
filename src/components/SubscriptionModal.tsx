import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  Crown,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  SUBSCRIPTION_TIER_PLANS,
  getSubscriptionTierLabel,
  type StudentSubscriptionDto,
  type SubscriptionPlanDto,
  type SubscriptionPlanInput,
  type SubscriptionTier,
  type SubscriptionTierPlanInfo,
  type UserDto,
} from "../../packages/shared-types/src/index";
import { api } from "../api";
import type { SupportedLang } from "./types";

// ============================================================================
// 1. Admin Subscription Plans Manager (View, Add, Modify, Delete Plans)
//    Used both inside the Admin Modal and inline in Admin Console / Dashboard
// ============================================================================

interface AdminSubscriptionPlansManagerProps {
  plans: SubscriptionPlanDto[];
  onPlansChanged: () => void;
  onNotify: (type: "success" | "error" | "info", text: string) => void;
}

const emptyPlanDraft = (nextOrder: number): SubscriptionPlanInput & { featuresText: string } => ({
  tier: "",
  shortLabel: "",
  labelEn: "",
  labelBn: "",
  priceInr: 299,
  billingCycle: "yearly",
  durationDays: 365,
  descriptionEn: "",
  descriptionBn: "",
  features: [],
  featuresText:
    "Unlocks Paid Test Series\nBilingual AI Study Notes\nUnlimited Re-Attempts & Pause",
  isActive: true,
  displayOrder: nextOrder,
});

export function AdminSubscriptionPlansManager({
  plans,
  onPlansChanged,
  onNotify,
}: AdminSubscriptionPlansManagerProps) {
  const [editingPlanId, setEditingPlanId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<SubscriptionPlanInput & { featuresText: string }>(() =>
    emptyPlanDraft(plans.length + 1)
  );
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startCreate = () => {
    setDraft(emptyPlanDraft(plans.length + 1));
    setEditingPlanId("new");
  };

  const startEdit = (plan: SubscriptionPlanDto) => {
    setDraft({
      tier: plan.tier,
      shortLabel: plan.shortLabel,
      labelEn: plan.labelEn,
      labelBn: plan.labelBn || "",
      priceInr: plan.priceInr,
      billingCycle:
        (plan.billingCycle as "monthly" | "quarterly" | "yearly" | "lifetime") || "yearly",
      durationDays: plan.durationDays ?? 365,
      descriptionEn: plan.descriptionEn || "",
      descriptionBn: plan.descriptionBn || "",
      features: plan.features || [],
      featuresText: (plan.features || []).join("\n"),
      isActive: plan.isActive ?? true,
      displayOrder: plan.displayOrder ?? 1,
    });
    setEditingPlanId(plan.id);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const featuresList = draft.featuresText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const payload: SubscriptionPlanInput = {
        tier: draft.tier
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "_"),
        shortLabel: draft.shortLabel.trim(),
        labelEn: draft.labelEn.trim(),
        labelBn: draft.labelBn.trim() || draft.labelEn.trim(),
        priceInr: Number(draft.priceInr) || 0,
        billingCycle: draft.billingCycle,
        durationDays: Number(draft.durationDays) || 0,
        descriptionEn: draft.descriptionEn.trim(),
        descriptionBn: draft.descriptionBn.trim() || draft.descriptionEn.trim(),
        features: featuresList,
        isActive: draft.isActive,
        displayOrder: Number(draft.displayOrder) || 1,
      };

      if (editingPlanId === "new") {
        await api<{ plan: SubscriptionPlanDto }>("/admin/subscription-plans", {
          method: "POST",
          body: payload,
        });
        onNotify("success", `Added new subscription plan "${payload.shortLabel}" (${payload.tier}).`);
      } else if (editingPlanId) {
        await api<{ plan: SubscriptionPlanDto }>(
          `/admin/subscription-plans/${editingPlanId}`,
          {
            method: "PUT",
            body: payload,
          }
        );
        onNotify("success", `Updated subscription plan "${payload.shortLabel}".`);
      }
      setEditingPlanId(null);
      onPlansChanged();
    } catch (err) {
      onNotify("error", (err as Error).message || "Could not save subscription plan");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlan = async (plan: SubscriptionPlanDto) => {
    if (plan.tier === "free" || deletingId) return;
    setDeletingId(plan.id);
    try {
      await api(`/admin/subscription-plans/${plan.id}`, { method: "DELETE" });
      onNotify(
        "info",
        `Deleted subscription plan "${plan.shortLabel}" (${plan.tier}). Any students on that plan were switched to Free Tier.`
      );
      if (editingPlanId === plan.id) setEditingPlanId(null);
      onPlansChanged();
    } catch (err) {
      onNotify("error", (err as Error).message || "Could not delete subscription plan");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            Available Subscription Plans ({plans.length})
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Admin can add new subscription plans, modify existing plan pricing/features/duration, or delete plans. When a student&apos;s subscription ends, they automatically switch back to Free Tier.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          + Add New Subscription Plan
        </button>
      </div>

      {/* Add / Edit Plan Form */}
      {editingPlanId && (
        <form
          onSubmit={handleSavePlan}
          className="rounded-xl border border-emerald-500/40 bg-slate-950 p-4 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h4 className="text-sm font-bold text-white">
              {editingPlanId === "new"
                ? "Create New Subscription Plan"
                : `Modify Subscription Plan (${draft.shortLabel || draft.tier})`}
            </h4>
            <button
              type="button"
              onClick={() => setEditingPlanId(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <label className="space-y-1 text-slate-300">
              <span>Plan Tier Code (Slug) *</span>
              <input
                type="text"
                required
                disabled={draft.tier === "free" && editingPlanId !== "new"}
                value={draft.tier}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    tier: e.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_"),
                  }))
                }
                placeholder="e.g., icds_mains_pass"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono disabled:opacity-50"
              />
            </label>

            <label className="space-y-1 text-slate-300">
              <span>Short Badge Label *</span>
              <input
                type="text"
                required
                value={draft.shortLabel}
                onChange={(e) => setDraft((prev) => ({ ...prev, shortLabel: e.target.value }))}
                placeholder="e.g., ICDS Mains Tier"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </label>

            <label className="space-y-1 text-slate-300">
              <span>Price (₹ INR) *</span>
              <input
                type="number"
                required
                min={0}
                max={100000}
                step="1"
                disabled={draft.tier === "free" && editingPlanId !== "new"}
                value={draft.priceInr}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, priceInr: Number(e.target.value) || 0 }))
                }
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono disabled:opacity-50"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-slate-300">
                <span>Billing Cycle</span>
                <select
                  value={draft.billingCycle}
                  disabled={draft.tier === "free" && editingPlanId !== "new"}
                  onChange={(e) => {
                    const cycle = e.target.value as
                      | "monthly"
                      | "quarterly"
                      | "yearly"
                      | "lifetime";
                    const defaultDays =
                      cycle === "monthly"
                        ? 30
                        : cycle === "quarterly"
                          ? 90
                          : cycle === "yearly"
                            ? 365
                            : 0;
                    setDraft((prev) => ({
                      ...prev,
                      billingCycle: cycle,
                      durationDays: defaultDays,
                    }));
                  }}
                  className="w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white disabled:opacity-50"
                >
                  <option value="yearly">Yearly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="monthly">Monthly</option>
                  <option value="lifetime">Lifetime</option>
                </select>
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Validity (Days)</span>
                <input
                  type="number"
                  min={0}
                  max={3650}
                  disabled={draft.tier === "free" && editingPlanId !== "new"}
                  value={draft.durationDays}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      durationDays: Number(e.target.value) || 0,
                    }))
                  }
                  className="w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono disabled:opacity-50"
                />
              </label>
            </div>

            <label className="space-y-1 text-slate-300 sm:col-span-2">
              <span>Full Plan Name (English) *</span>
              <input
                type="text"
                required
                value={draft.labelEn}
                onChange={(e) => setDraft((prev) => ({ ...prev, labelEn: e.target.value }))}
                placeholder="e.g., ICDS Supervisor Prelims + Mains Complete Pass"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </label>

            <label className="space-y-1 text-slate-300 sm:col-span-2">
              <span>Full Plan Name (বাংলা)</span>
              <input
                type="text"
                value={draft.labelBn}
                onChange={(e) => setDraft((prev) => ({ ...prev, labelBn: e.target.value }))}
                placeholder="e.g., আইসিডিএস সুপারভাইজার প্রিলিমস ও মেইনস পাস"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </label>

            <label className="space-y-1 text-slate-300 sm:col-span-2">
              <span>Description (English)</span>
              <textarea
                rows={2}
                value={draft.descriptionEn}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, descriptionEn: e.target.value }))
                }
                placeholder="What this plan unlocks for aspirants..."
                className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </label>

            <label className="space-y-1 text-slate-300 sm:col-span-2">
              <span>Key Features (One per line)</span>
              <textarea
                rows={2}
                value={draft.featuresText}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, featuresText: e.target.value }))
                }
                placeholder="All Prelims + Mains Paid Series&#10;Bilingual AI Tutor Notes"
                className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.isActive}
                disabled={draft.tier === "free"}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, isActive: e.target.checked }))
                }
                className="rounded border-slate-700"
              />
              <span>Visible to Aspirants for Purchase</span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingPlanId(null)}
                className="px-3.5 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
              >
                {saving
                  ? "Saving Plan…"
                  : editingPlanId === "new"
                    ? "Create Subscription Plan"
                    : "Save Plan Changes"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Available Plans Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
        {plans.map((plan) => (
          <div
            key={plan.id || plan.tier}
            className={`flex flex-col justify-between rounded-xl border p-4 space-y-3 ${
              plan.tier === "free"
                ? "border-slate-800 bg-slate-950/70"
                : plan.isActive
                  ? "border-amber-500/35 bg-slate-950"
                  : "border-slate-800 bg-slate-950/40 opacity-60"
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  {plan.shortLabel}
                </span>
                <span className="text-base font-bold font-mono text-white">
                  ₹{plan.priceInr}
                  <span className="text-[10px] font-normal text-slate-400">
                    /{plan.billingCycle === "lifetime" ? "free" : plan.billingCycle}
                  </span>
                </span>
              </div>

              <div className="text-[11px] font-mono text-slate-500">
                Code: <span className="text-slate-300">{plan.tier}</span>
                {plan.durationDays > 0 && ` · ${plan.durationDays}d`}
              </div>

              <div className="text-xs font-bold text-white leading-snug">
                {plan.labelEn}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
                {plan.descriptionEn}
              </p>

              <ul className="space-y-1 pt-1">
                {(plan.features || []).slice(0, 4).map((f, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-emerald-300 flex items-start gap-1.5"
                  >
                    <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
                    <span className="line-clamp-1">{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => startEdit(plan)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md cursor-pointer"
              >
                <Pencil className="w-3 h-3" /> Modify
              </button>
              {plan.tier !== "free" ? (
                <button
                  type="button"
                  disabled={deletingId === plan.id}
                  onClick={() => handleDeletePlan(plan)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 rounded-md cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  {deletingId === plan.id ? "Deleting…" : "Delete"}
                </button>
              ) : (
                <span className="text-[10px] font-mono text-slate-500">
                  Default Fallback
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 2. Responsive Subscription Modal
//    - Wide (max-w-6xl), constrained height (max-h-[90vh] flex-col) so it NEVER overflows
//    - Admin sees Available Subscription Plans Manager (Add / Modify / Delete)
//    - Aspirant sees Plan Cards + Test Payment Purchase Form
// ============================================================================

interface SubscriptionModalProps {
  open: boolean;
  user: UserDto;
  lang: SupportedLang;
  plans: SubscriptionPlanDto[];
  mySubscriptions: StudentSubscriptionDto[];
  initialTier?: SubscriptionTier;
  initialDueOnly?: boolean;
  onClose: () => void;
  onPurchased: (user: UserDto, sub: StudentSubscriptionDto) => void;
  onPlansChanged: () => void;
  onNotify: (type: "success" | "error" | "info", text: string) => void;
}

export default function SubscriptionModal({
  open,
  user,
  lang,
  plans,
  mySubscriptions,
  initialTier = "pro_prelims",
  initialDueOnly = false,
  onClose,
  onPurchased,
  onPlansChanged,
  onNotify,
}: SubscriptionModalProps) {
  const isUserAdmin = user.role === "admin";
  const activePlans: SubscriptionTierPlanInfo[] =
    plans.length > 0 ? plans.filter((p) => p.isActive) : SUBSCRIPTION_TIER_PLANS;
  const paidPlans = activePlans.filter((p) => p.tier !== "free");

  const [selectedPurchaseTier, setSelectedPurchaseTier] =
    useState<SubscriptionTier>(initialTier);
  const [purchaseBillingCycle, setPurchaseBillingCycle] = useState<
    "monthly" | "quarterly" | "yearly"
  >("yearly");
  const [testPaidAmountInput, setTestPaidAmountInput] = useState<string>("299");
  const [payExistingDueOnly, setPayExistingDueOnly] = useState<boolean>(initialDueOnly);
  const [purchaseNotesInput, setPurchaseNotesInput] = useState<string>("");
  const [purchaseBusy, setPurchaseBusy] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    const defaultTier =
      initialTier && initialTier !== "free"
        ? initialTier
        : paidPlans[0]?.tier || "pro_prelims";
    const planMeta =
      paidPlans.find((p) => p.tier === defaultTier) ??
      paidPlans[0] ??
      SUBSCRIPTION_TIER_PLANS[1];
    setSelectedPurchaseTier(defaultTier);
    setPayExistingDueOnly(initialDueOnly);
    setTestPaidAmountInput(
      initialDueOnly ? String(user.paymentDueInr ?? 0) : String(planMeta.priceInr)
    );
    setPurchaseNotesInput("");
  }, [open, initialTier, initialDueOnly, user.paymentDueInr, plans.length]);

  if (!open) return null;

  const chosenPlan =
    paidPlans.find((p) => p.tier === selectedPurchaseTier) ??
    paidPlans[0] ??
    SUBSCRIPTION_TIER_PLANS[1];
  const existingDue = user.paymentDueInr ?? 0;
  const targetPrice = payExistingDueOnly ? existingDue : chosenPlan.priceInr;
  const payingNow = Math.max(0, Number(testPaidAmountInput) || 0);
  const projectedDue = payExistingDueOnly
    ? Math.max(0, Number((existingDue - payingNow).toFixed(2)))
    : Math.max(0, Number((existingDue + (targetPrice - payingNow)).toFixed(2)));

  const handlePurchaseSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (purchaseBusy || isUserAdmin) return;
    setPurchaseBusy(true);
    try {
      const r = await api<{ user: UserDto; subscription: StudentSubscriptionDto }>(
        "/me/subscriptions/purchase",
        {
          method: "POST",
          body: {
            planTier: selectedPurchaseTier,
            testPaidAmountInr: Number(testPaidAmountInput) || 0,
            billingCycle: purchaseBillingCycle,
            payExistingDueOnly,
            notes: purchaseNotesInput.trim() || undefined,
          },
        }
      );
      onPurchased(r.user, r.subscription);
    } catch (err) {
      onNotify(
        "error",
        (err as Error).message || "Could not complete test subscription purchase"
      );
    } finally {
      setPurchaseBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-5"
    >
      {/* Wide, viewport-fitted flex-col container that never overflows the screen */}
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border border-amber-500/40 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Sticky Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4 shrink-0 bg-slate-900">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
              {isUserAdmin ? (
                <>
                  <Layers className="w-4 h-4" />
                  Admin Subscription Plan Catalog &amp; Configuration
                </>
              ) : (
                <>
                  <Crown className="w-4 h-4" />
                  WBPSC Mock Tutor Subscription Pass (Test Payment Mode)
                </>
              )}
            </span>
            <h2 className="text-lg sm:text-xl font-bold text-white mt-0.5">
              {isUserAdmin
                ? "Available Subscription Plans — Add, Modify & Delete"
                : payExistingDueOnly
                  ? "Clear Pending Subscription Dues"
                  : "Choose Your Subscription Tier & Complete Test Payment"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isUserAdmin
                ? "Configure subscription plans offered to aspirants. Expired student plans automatically revert to Free Tier."
                : "Select any plan below and confirm the Test Paid Amount. Your active plan, validity date, and any balance due are shared live with Admin."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white bg-slate-800/80 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        {isUserAdmin ? (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <AdminSubscriptionPlansManager
              plans={plans}
              onPlansChanged={onPlansChanged}
              onNotify={onNotify}
            />
          </div>
        ) : (
          <form
            onSubmit={handlePurchaseSubscription}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Responsive Plan Tier Cards Grid (1 col mobile, 2 col tablet, 4 col desktop) */}
              {!payExistingDueOnly && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  {paidPlans.map((plan) => {
                    const isSelected = selectedPurchaseTier === plan.tier;
                    return (
                      <button
                        key={plan.tier}
                        type="button"
                        onClick={() => {
                          setSelectedPurchaseTier(plan.tier);
                          setTestPaidAmountInput(String(plan.priceInr));
                        }}
                        className={`text-left p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                          isSelected
                            ? "bg-amber-500/15 border-amber-400 text-white shadow-lg shadow-amber-950/30"
                            : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                              {plan.shortLabel}
                            </span>
                            <span className="text-lg font-bold font-mono text-white shrink-0">
                              ₹{plan.priceInr}
                              <span className="text-[11px] font-normal text-slate-400">
                                /yr
                              </span>
                            </span>
                          </div>
                          <div className="text-sm font-bold text-white leading-snug">
                            {lang === "bn" ? plan.labelBn : plan.labelEn}
                          </div>
                          <p className="text-xs text-slate-400 leading-relaxed">
                            {lang === "bn" ? plan.descriptionBn : plan.descriptionEn}
                          </p>
                        </div>

                        <ul className="space-y-1 pt-2 border-t border-slate-800/80">
                          {plan.features.map((f, i) => (
                            <li
                              key={i}
                              className="text-[11px] text-emerald-300 flex items-start gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Payment Mode & Test Paid Amount Inputs */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <label className="space-y-1 text-slate-300">
                    <span className="font-semibold text-amber-300">
                      Test Paid Amount (₹ INR) *
                    </span>
                    <input
                      type="number"
                      required
                      min={0}
                      max={50000}
                      step="1"
                      value={testPaidAmountInput}
                      onChange={(e) => setTestPaidAmountInput(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-sm"
                    />
                    <span className="block text-[11px] text-slate-500">
                      Enter full fee (₹{targetPrice}) or a partial test amount to simulate payment due.
                    </span>
                  </label>

                  <label className="space-y-1 text-slate-300">
                    <span>Billing Cycle (Auto-switches to Free on expiry)</span>
                    <select
                      value={purchaseBillingCycle}
                      onChange={(e) =>
                        setPurchaseBillingCycle(
                          e.target.value as "monthly" | "quarterly" | "yearly"
                        )
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                    >
                      <option value="yearly">Yearly (12 Months)</option>
                      <option value="quarterly">Quarterly (3 Months)</option>
                      <option value="monthly">Monthly (1 Month)</option>
                    </select>
                  </label>

                  <label className="space-y-1 text-slate-300">
                    <span>Reference Note (Optional)</span>
                    <input
                      type="text"
                      value={purchaseNotesInput}
                      onChange={(e) => setPurchaseNotesInput(e.target.value)}
                      placeholder="e.g., Test payment for Prelims/Mains"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                    />
                  </label>
                </div>

                {/* Live Summary Strip */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-900 border border-slate-800 px-4 py-2.5 text-xs font-mono">
                  <div>
                    <span className="text-slate-400">Selected Plan Fee: </span>
                    <strong className="text-white">₹{targetPrice}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Test Amount Paying Now: </span>
                    <strong className="text-emerald-400">₹{payingNow}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Balance Payment Due: </span>
                    <strong
                      className={projectedDue > 0 ? "text-rose-400" : "text-emerald-400"}
                    >
                      ₹{projectedDue}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Student's Past Transactions */}
              {mySubscriptions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-400">
                    Your Recent Subscription &amp; Test Payment Records (
                    {mySubscriptions.length})
                  </p>
                  <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 divide-y divide-slate-800/70 text-xs">
                    {mySubscriptions.map((sub) => (
                      <div
                        key={sub.id}
                        className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-semibold text-white">{sub.planName}</span>
                          <span className="ml-2 font-mono text-[11px] text-amber-300">
                            {sub.transactionRef}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-300">
                          Paid:{" "}
                          <strong className="text-emerald-400">
                            ₹{sub.amountPaidInr}
                          </strong>{" "}
                          · Due:{" "}
                          <strong
                            className={
                              sub.amountDueInr > 0 ? "text-rose-400" : "text-slate-400"
                            }
                          >
                            ₹{sub.amountDueInr}
                          </strong>{" "}
                          {sub.expiresAt && (
                            <span className="text-sky-300">
                              · Valid till {new Date(sub.expiresAt).toLocaleDateString()}
                            </span>
                          )}{" "}
                          · {new Date(sub.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Sticky Footer */}
            <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-3.5 border-t border-slate-800 bg-slate-950/90 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={purchaseBusy}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                {purchaseBusy
                  ? "Processing Test Payment…"
                  : payExistingDueOnly
                    ? `Confirm Test Payment (₹${testPaidAmountInput || 0})`
                    : `Complete Test Purchase & Unlock ${getSubscriptionTierLabel(
                        selectedPurchaseTier,
                        activePlans
                      )}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
