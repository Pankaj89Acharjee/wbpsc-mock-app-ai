import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  CreditCard,
  Filter,
  IndianRupee,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  SUBSCRIPTION_TIER_PLANS,
  getSubscriptionTierLabel,
  type StudentSubscriptionDto,
  type SubscriptionPlanDto,
  type SubscriptionTier,
  type UserDto,
} from "../../packages/shared-types/src/index";
import { api } from "../api";

interface PaymentManagementConsoleProps {
  allUsers: UserDto[];
  allSubscriptions: StudentSubscriptionDto[];
  plans: SubscriptionPlanDto[];
  onRefreshAdminData: () => void;
  onNotify: (type: "success" | "error" | "info", text: string) => void;
}

type PaymentFilterTab =
  | "all"
  | "issues_all"
  | "failed"
  | "duplicate"
  | "pending_due"
  | "paid"
  | "refunded";

interface AnnotatedTransaction {
  tx: StudentSubscriptionDto;
  isAutoDuplicate: boolean;
  duplicateOfRef: string | null;
  effectiveCategory:
    | "paid"
    | "failed"
    | "duplicate"
    | "pending_due"
    | "refunded"
    | "waived"
    | "disputed";
}

export default function PaymentManagementConsole({
  allUsers,
  allSubscriptions,
  plans,
  onRefreshAdminData,
  onNotify,
}: PaymentManagementConsoleProps) {
  const [filterTab, setFilterTab] = useState<PaymentFilterTab>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [busyTxId, setBusyTxId] = useState<string | null>(null);

  // Modal state for logging a new payment / simulating or recording a failed or duplicate payment case
  const [showRecordModal, setShowRecordModal] = useState<boolean>(false);
  const [recordForm, setRecordForm] = useState<{
    userId: string;
    planTier: SubscriptionTier;
    amountPaidInr: string;
    paymentDueInr: string;
    billingCycle: "monthly" | "quarterly" | "yearly" | "lifetime";
    paymentStatus: StudentSubscriptionDto["paymentStatus"];
    paymentMode: string;
    transactionRef: string;
    notes: string;
  }>({
    userId: "",
    planTier: "pro_prelims",
    amountPaidInr: "299",
    paymentDueInr: "0",
    billingCycle: "yearly",
    paymentStatus: "paid",
    paymentMode: "upi_gateway",
    transactionRef: "",
    notes: "",
  });
  const [recordBusy, setRecordBusy] = useState<boolean>(false);

  // Edit / Resolve modal for a specific transaction
  const [editingTx, setEditingTx] = useState<{
    tx: StudentSubscriptionDto;
    paymentStatus: StudentSubscriptionDto["paymentStatus"];
    amountPaidInr: string;
    amountDueInr: string;
    notes: string;
  } | null>(null);

  const planCatalog = plans.length > 0 ? plans : SUBSCRIPTION_TIER_PLANS;
  const studentUsers = useMemo(
    () => allUsers.filter((u) => u.role !== "admin"),
    [allUsers]
  );

  // Auto-detect duplicate payments (same user + same planTier + same amountPaid > 0 within 24 hours)
  const annotatedTransactions = useMemo<AnnotatedTransaction[]>(() => {
    const sortedAsc = [...allSubscriptions].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const duplicateMap = new Map<string, string>();

    for (let i = 0; i < sortedAsc.length; i++) {
      const curr = sortedAsc[i];
      if (
        curr.paymentStatus === "refunded" ||
        curr.paymentStatus === "failed" ||
        curr.amountPaidInr <= 0
      ) {
        continue;
      }
      for (let j = 0; j < i; j++) {
        const prev = sortedAsc[j];
        if (
          prev.userId === curr.userId &&
          prev.planTier === curr.planTier &&
          prev.amountPaidInr === curr.amountPaidInr &&
          prev.paymentStatus !== "refunded" &&
          prev.paymentStatus !== "failed"
        ) {
          const diffHours =
            Math.abs(
              new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime()
            ) /
            (1000 * 60 * 60);
          if (diffHours <= 24) {
            duplicateMap.set(curr.id, prev.transactionRef || prev.id.slice(0, 8));
            break;
          }
        }
      }
    }

    return allSubscriptions.map((tx) => {
      const dupRef = duplicateMap.get(tx.id) ?? null;
      const isAutoDuplicate = Boolean(dupRef) || tx.paymentStatus === "duplicate";
      let effectiveCategory: AnnotatedTransaction["effectiveCategory"] = "paid";

      if (tx.paymentStatus === "failed") effectiveCategory = "failed";
      else if (tx.paymentStatus === "duplicate" || isAutoDuplicate)
        effectiveCategory = "duplicate";
      else if (tx.paymentStatus === "disputed") effectiveCategory = "disputed";
      else if (tx.paymentStatus === "refunded") effectiveCategory = "refunded";
      else if (tx.paymentStatus === "waived") effectiveCategory = "waived";
      else if (
        tx.paymentStatus === "partial_due" ||
        tx.paymentStatus === "pending_due" ||
        tx.amountDueInr > 0
      ) {
        effectiveCategory = "pending_due";
      }

      return {
        tx,
        isAutoDuplicate,
        duplicateOfRef: dupRef,
        effectiveCategory,
      };
    });
  }, [allSubscriptions]);

  // Summary Counts & Financials
  const summaryStats = useMemo(() => {
    const failedList = annotatedTransactions.filter(
      (a) => a.effectiveCategory === "failed"
    );
    const duplicateList = annotatedTransactions.filter(
      (a) => a.effectiveCategory === "duplicate"
    );
    const pendingDueList = annotatedTransactions.filter(
      (a) => a.effectiveCategory === "pending_due" || a.effectiveCategory === "disputed"
    );
    const refundedList = annotatedTransactions.filter(
      (a) => a.effectiveCategory === "refunded"
    );
    const verifiedPaidInr = annotatedTransactions
      .filter((a) => a.tx.paymentStatus !== "failed" && a.tx.paymentStatus !== "refunded")
      .reduce((sum, a) => sum + (a.tx.amountPaidInr ?? 0), 0);

    const duplicateAmountInr = duplicateList.reduce(
      (sum, a) => sum + (a.tx.amountPaidInr ?? 0),
      0
    );

    const failedAmountInr = failedList.reduce(
      (sum, a) => sum + (a.tx.planPriceInr || a.tx.amountDueInr || 0),
      0
    );

    return {
      totalCount: annotatedTransactions.length,
      failedCount: failedList.length,
      duplicateCount: duplicateList.length,
      pendingDueCount: pendingDueList.length,
      refundedCount: refundedList.length,
      issuesTotalCount:
        failedList.length + duplicateList.length + pendingDueList.length,
      verifiedPaidInr,
      duplicateAmountInr,
      failedAmountInr,
    };
  }, [annotatedTransactions]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return annotatedTransactions.filter(({ tx, effectiveCategory }) => {
      if (filterTab === "issues_all") {
        if (
          effectiveCategory !== "failed" &&
          effectiveCategory !== "duplicate" &&
          effectiveCategory !== "pending_due" &&
          effectiveCategory !== "disputed"
        ) {
          return false;
        }
      } else if (filterTab === "failed" && effectiveCategory !== "failed") {
        return false;
      } else if (filterTab === "duplicate" && effectiveCategory !== "duplicate") {
        return false;
      } else if (
        filterTab === "pending_due" &&
        effectiveCategory !== "pending_due" &&
        effectiveCategory !== "disputed"
      ) {
        return false;
      } else if (filterTab === "paid" && effectiveCategory !== "paid") {
        return false;
      } else if (
        filterTab === "refunded" &&
        effectiveCategory !== "refunded" &&
        effectiveCategory !== "waived"
      ) {
        return false;
      }

      if (!q) return true;
      const hay = [
        tx.userName,
        tx.userEmail,
        tx.planName,
        tx.planTier,
        tx.transactionRef,
        tx.paymentMode,
        tx.paymentStatus,
        tx.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [annotatedTransactions, filterTab, searchQuery]);

  // Quick 1-Click Resolution Action
  const handleQuickResolve = async (
    tx: StudentSubscriptionDto,
    nextStatus: StudentSubscriptionDto["paymentStatus"],
    resolutionNote: string,
    overridePaidInr?: number,
    overrideDueInr?: number
  ) => {
    setBusyTxId(tx.id);
    try {
      await api(`/admin/subscriptions/${tx.id}`, {
        method: "PATCH",
        body: {
          paymentStatus: nextStatus,
          ...(overridePaidInr !== undefined ? { amountPaidInr: overridePaidInr } : {}),
          ...(overrideDueInr !== undefined ? { amountDueInr: overrideDueInr } : {}),
          notes: resolutionNote,
          syncUserBalance: true,
        },
      });
      onRefreshAdminData();
      onNotify("success", resolutionNote);
    } catch (err) {
      onNotify("error", (err as Error).message || "Could not update payment status.");
    } finally {
      setBusyTxId(null);
    }
  };

  // Save Transaction Edit Modal
  const handleSaveTransactionEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;
    setBusyTxId(editingTx.tx.id);
    try {
      await api(`/admin/subscriptions/${editingTx.tx.id}`, {
        method: "PATCH",
        body: {
          paymentStatus: editingTx.paymentStatus,
          amountPaidInr: Number(editingTx.amountPaidInr) || 0,
          amountDueInr: Number(editingTx.amountDueInr) || 0,
          notes: editingTx.notes.trim() || undefined,
          syncUserBalance: true,
        },
      });
      setEditingTx(null);
      onRefreshAdminData();
      onNotify("success", `Updated transaction ${editingTx.tx.transactionRef || editingTx.tx.id.slice(0, 8)}.`);
    } catch (err) {
      onNotify("error", (err as Error).message || "Failed to update transaction.");
    } finally {
      setBusyTxId(null);
    }
  };

  // Submit New Payment or Payment Issue Record
  const handleCreatePaymentRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordForm.userId || recordBusy) return;
    setRecordBusy(true);
    try {
      await api("/admin/subscriptions/manage", {
        method: "POST",
        body: {
          userId: recordForm.userId,
          planTier: recordForm.planTier,
          amountPaidNowInr: Number(recordForm.amountPaidInr) || 0,
          paymentDueInr: Number(recordForm.paymentDueInr) || 0,
          billingCycle: recordForm.billingCycle,
          paymentStatus: recordForm.paymentStatus,
          paymentMode: recordForm.paymentMode,
          transactionRef:
            recordForm.transactionRef.trim() ||
            `TXN-${Date.now().toString(36).toUpperCase()}`,
          notes: recordForm.notes.trim() || undefined,
        },
      });
      setShowRecordModal(false);
      onRefreshAdminData();
      onNotify(
        "success",
        `Recorded payment transaction (${recordForm.paymentStatus.toUpperCase()}) for aspirant.`
      );
    } catch (err) {
      onNotify("error", (err as Error).message || "Could not record payment entry.");
    } finally {
      setRecordBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Action Bar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-bold uppercase tracking-wider">
              <CreditCard className="w-3.5 h-3.5" />
              Admin Payment Management Console
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">
              Payments, Failures, Duplicate Charges &amp; Refund Reconciliation
            </h1>
            <p className="text-xs text-slate-400 max-w-3xl">
              Centralized console to monitor every subscription transaction, resolve failed gateway attempts, detect and refund duplicate payments, waive or collect pending dues, and audit student billing ledgers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                const defaultStudent = studentUsers[0];
                setRecordForm((prev) => ({
                  ...prev,
                  userId: defaultStudent?.id || "",
                  transactionRef: `TXN-${Date.now().toString(36).toUpperCase()}`,
                }));
                setShowRecordModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Record Payment / Log Issue
            </button>
            <button
              type="button"
              onClick={onRefreshAdminData}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sync Ledger
            </button>
          </div>
        </div>

        {/* Diagnostic KPI Strip for Payment Health */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-1">
            <div className="text-[11px] text-slate-400 flex items-center justify-between">
              <span>Verified Revenue</span>
              <IndianRupee className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-lg font-extrabold font-mono text-emerald-400">
              ₹{summaryStats.verifiedPaidInr.toLocaleString("en-IN")}
            </div>
            <div className="text-[10px] text-slate-500">
              {summaryStats.totalCount} total transactions
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-rose-500/30 space-y-1">
            <div className="text-[11px] text-rose-300 flex items-center justify-between font-semibold">
              <span>Payment Failures</span>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="text-lg font-extrabold font-mono text-rose-400">
              {summaryStats.failedCount} Failed
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              ₹{summaryStats.failedAmountInr.toLocaleString("en-IN")} affected
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-amber-500/30 space-y-1">
            <div className="text-[11px] text-amber-300 flex items-center justify-between font-semibold">
              <span>Duplicate Payments</span>
              <Copy className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-lg font-extrabold font-mono text-amber-300">
              {summaryStats.duplicateCount} Detected
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              ₹{summaryStats.duplicateAmountInr.toLocaleString("en-IN")} duplicate volume
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-sky-500/30 space-y-1">
            <div className="text-[11px] text-sky-300 flex items-center justify-between font-semibold">
              <span>Pending Dues / Disputes</span>
              <ShieldAlert className="w-3.5 h-3.5 text-sky-400" />
            </div>
            <div className="text-lg font-extrabold font-mono text-sky-300">
              {summaryStats.pendingDueCount} Open
            </div>
            <div className="text-[10px] text-slate-400">
              Partial or pending settlements
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-1">
            <div className="text-[11px] text-slate-400 flex items-center justify-between">
              <span>Refunded / Waived</span>
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-lg font-extrabold font-mono text-slate-200">
              {summaryStats.refundedCount} Resolved
            </div>
            <div className="text-[10px] text-slate-500">
              Auto-synced with student balance
            </div>
          </div>
        </div>

        {/* Filter Pills & Search Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400 mr-1" />
            {(
              [
                { id: "all", label: `All Payments (${summaryStats.totalCount})` },
                {
                  id: "issues_all",
                  label: `Needs Attention (${summaryStats.issuesTotalCount})`,
                },
                {
                  id: "failed",
                  label: `Failed Payments (${summaryStats.failedCount})`,
                },
                {
                  id: "duplicate",
                  label: `Duplicate Payments (${summaryStats.duplicateCount})`,
                },
                {
                  id: "pending_due",
                  label: `Pending Dues & Disputes (${summaryStats.pendingDueCount})`,
                },
                { id: "paid", label: "Paid & Verified" },
                { id: "refunded", label: `Refunded / Waived (${summaryStats.refundedCount})` },
              ] as const
            ).map((tab) => {
              const active = filterTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? "bg-amber-400 text-slate-950"
                      : "bg-slate-950 border border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[240px] flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ref, aspirant, email, status…"
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-amber-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Fixed-Height Scrollable Transactions & Issue Resolution Table */}
        <div className="max-h-[480px] overflow-y-auto overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3 px-3.5 whitespace-nowrap">Transaction Ref &amp; Date</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Aspirant</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Plan &amp; Cycle</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Plan Price</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Amount Paid</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">Amount Due</th>
                <th className="py-3 px-3.5 whitespace-nowrap">Status &amp; Diagnostics</th>
                <th className="py-3 px-3.5 text-right whitespace-nowrap">
                  One-Click Resolution Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 px-4 text-center text-slate-400">
                    No payment transactions match the selected filter. Use{" "}
                    <strong className="text-amber-300">“Record Payment / Log Issue”</strong>{" "}
                    above to log a manual payment, failed transaction, or duplicate charge case.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map(({ tx, isAutoDuplicate, duplicateOfRef, effectiveCategory }) => {
                  const isBusy = busyTxId === tx.id;
                  return (
                    <tr key={tx.id} className="hover:bg-slate-900/70 transition-colors">
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="font-mono font-bold text-amber-300">
                          {tx.transactionRef || `TX-${tx.id.slice(0, 8).toUpperCase()}`}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(tx.createdAt).toLocaleString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          Mode: {tx.paymentMode}
                        </div>
                      </td>

                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-white">
                          {tx.userName || "Aspirant"}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {tx.userEmail}
                        </div>
                      </td>

                      <td className="py-3 px-3.5">
                        <div className="font-medium text-slate-200">
                          {getSubscriptionTierLabel(tx.planTier, planCatalog)}
                        </div>
                        <div className="text-[11px] text-slate-400 capitalize">
                          {tx.billingCycle}
                        </div>
                      </td>

                      <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-300">
                        ₹{tx.planPriceInr}
                      </td>

                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-emerald-400">
                        ₹{tx.amountPaidInr}
                      </td>

                      <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                        <span
                          className={
                            tx.amountDueInr > 0
                              ? "font-bold text-rose-400"
                              : "text-slate-500"
                          }
                        >
                          ₹{tx.amountDueInr}
                        </span>
                      </td>

                      <td className="py-3 px-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {effectiveCategory === "failed" && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                              PAYMENT FAILED
                            </span>
                          )}
                          {effectiveCategory === "duplicate" && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              DUPLICATE PAYMENT
                            </span>
                          )}
                          {effectiveCategory === "disputed" && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                              DISPUTED
                            </span>
                          )}
                          {effectiveCategory === "pending_due" && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                              PENDING DUE (₹{tx.amountDueInr})
                            </span>
                          )}
                          {effectiveCategory === "paid" && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              PAID &amp; VERIFIED
                            </span>
                          )}
                          {effectiveCategory === "refunded" && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              REFUNDED
                            </span>
                          )}
                          {effectiveCategory === "waived" && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-emerald-300 border border-slate-700">
                              DUE WAIVED
                            </span>
                          )}
                        </div>
                        {isAutoDuplicate && duplicateOfRef && (
                          <div className="text-[10px] text-amber-300 font-mono mt-0.5">
                            Matches earlier ref: {duplicateOfRef} (within 24h)
                          </div>
                        )}
                        {tx.notes && (
                          <div className="text-[11px] text-slate-400 mt-0.5 max-w-xs truncate">
                            {tx.notes}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          {/* If Failed -> Mark Settled / Retry Success */}
                          {effectiveCategory === "failed" && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleQuickResolve(
                                  tx,
                                  "paid",
                                  `Resolved failed payment ${tx.transactionRef || ""} → Marked Paid (₹${tx.planPriceInr}).`,
                                  tx.planPriceInr || tx.amountPaidInr,
                                  0
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-[11px] cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Settle Payment
                            </button>
                          )}

                          {/* If Duplicate -> Refund Duplicate */}
                          {effectiveCategory === "duplicate" && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleQuickResolve(
                                  tx,
                                  "refunded",
                                  `Refunded duplicate payment ${tx.transactionRef || ""} (₹${tx.amountPaidInr}) and synced student balance.`,
                                  tx.amountPaidInr,
                                  0
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-[11px] cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Refund Duplicate
                            </button>
                          )}

                          {/* If Pending Due -> Collect Full Due or Waive Due */}
                          {effectiveCategory === "pending_due" && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleQuickResolve(
                                    tx,
                                    "paid",
                                    `Collected pending due of ₹${tx.amountDueInr} for ${tx.userName || "aspirant"}.`,
                                    (tx.amountPaidInr ?? 0) + (tx.amountDueInr ?? 0),
                                    0
                                  )
                                }
                                className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-semibold text-[11px] cursor-pointer"
                              >
                                Mark Due Paid
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleQuickResolve(
                                    tx,
                                    "waived",
                                    `Waived remaining due of ₹${tx.amountDueInr} for ${tx.userName || "aspirant"}.`,
                                    tx.amountPaidInr,
                                    0
                                  )
                                }
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] cursor-pointer"
                              >
                                Waive Due
                              </button>
                            </>
                          )}

                          {/* Flag as Duplicate or Failed if currently Paid */}
                          {effectiveCategory === "paid" && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleQuickResolve(
                                  tx,
                                  "duplicate",
                                  `Flagged transaction ${tx.transactionRef || ""} as Duplicate Payment for review.`
                                )
                              }
                              className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] cursor-pointer"
                              title="Flag this transaction as a duplicate payment"
                            >
                              Flag Duplicate
                            </button>
                          )}

                          {/* Open Full Edit / Resolution Modal */}
                          <button
                            type="button"
                            onClick={() =>
                              setEditingTx({
                                tx,
                                paymentStatus: tx.paymentStatus,
                                amountPaidInr: String(tx.amountPaidInr ?? 0),
                                amountDueInr: String(tx.amountDueInr ?? 0),
                                notes: tx.notes ?? "",
                              })
                            }
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium cursor-pointer"
                          >
                            Edit / Resolve
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===================================================================
          MODAL 1: EDIT / RESOLVE SPECIFIC PAYMENT TRANSACTION
      =================================================================== */}
      {editingTx && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveTransactionEdit}
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Resolve / Edit Payment — {editingTx.tx.transactionRef || editingTx.tx.id.slice(0, 8)}
                </h3>
                <p className="text-xs text-slate-400">
                  Aspirant: {editingTx.tx.userName} ({editingTx.tx.userEmail})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTx(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <label className="space-y-1 text-slate-300">
                <span>Payment Status *</span>
                <select
                  value={editingTx.paymentStatus}
                  onChange={(e) =>
                    setEditingTx((prev) =>
                      prev
                        ? {
                            ...prev,
                            paymentStatus: e.target.value as StudentSubscriptionDto["paymentStatus"],
                          }
                        : null
                    )
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  <option value="paid">Paid &amp; Verified</option>
                  <option value="failed">Payment Failed</option>
                  <option value="duplicate">Duplicate Payment</option>
                  <option value="disputed">Disputed</option>
                  <option value="partial_due">Partial Due</option>
                  <option value="pending_due">Pending Due</option>
                  <option value="refunded">Refunded</option>
                  <option value="waived">Due Waived</option>
                </select>
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Amount Paid (₹)</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={editingTx.amountPaidInr}
                  onChange={(e) =>
                    setEditingTx((prev) =>
                      prev ? { ...prev, amountPaidInr: e.target.value } : null
                    )
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Amount Due (₹)</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={editingTx.amountDueInr}
                  onChange={(e) =>
                    setEditingTx((prev) =>
                      prev ? { ...prev, amountDueInr: e.target.value } : null
                    )
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </label>

              <label className="space-y-1 text-slate-300 sm:col-span-3">
                <span>Resolution / Audit Notes</span>
                <textarea
                  rows={2}
                  value={editingTx.notes}
                  onChange={(e) =>
                    setEditingTx((prev) =>
                      prev ? { ...prev, notes: e.target.value } : null
                    )
                  }
                  placeholder="Describe why this payment was settled, refunded, or flagged…"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingTx(null)}
                className="px-4 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyTxId === editingTx.tx.id}
                className="px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer"
              >
                {busyTxId === editingTx.tx.id ? "Saving…" : "Save Resolution"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================
          MODAL 2: RECORD NEW PAYMENT OR LOG PAYMENT FAILURE / DUPLICATE CASE
      =================================================================== */}
      {showRecordModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreatePaymentRecord}
            className="bg-slate-900 border border-amber-500/40 rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Record Payment / Log Failed or Duplicate Payment Case
                </h3>
                <p className="text-xs text-slate-400">
                  Log a manual settlement, gateway failure, or duplicate transaction for any aspirant.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRecordModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="space-y-1 text-slate-300 sm:col-span-2">
                <span>Select Aspirant *</span>
                <select
                  required
                  value={recordForm.userId}
                  onChange={(e) =>
                    setRecordForm((prev) => ({ ...prev, userId: e.target.value }))
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  <option value="">-- Choose an Aspirant --</option>
                  {studentUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.email}) — Current: {u.subscriptionTier}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Subscription Plan *</span>
                <select
                  value={recordForm.planTier}
                  onChange={(e) => {
                    const tier = e.target.value as SubscriptionTier;
                    const found = planCatalog.find((p) => p.tier === tier);
                    setRecordForm((prev) => ({
                      ...prev,
                      planTier: tier,
                      amountPaidInr: String(found?.priceInr ?? 299),
                    }));
                  }}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  {planCatalog.map((p) => (
                    <option key={p.tier} value={p.tier}>
                      {p.shortLabel} (₹{p.priceInr})
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Transaction Case / Status *</span>
                <select
                  value={recordForm.paymentStatus}
                  onChange={(e) =>
                    setRecordForm((prev) => ({
                      ...prev,
                      paymentStatus: e.target.value as StudentSubscriptionDto["paymentStatus"],
                    }))
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  <option value="paid">Paid &amp; Verified</option>
                  <option value="failed">Payment Failure Case (Gateway Drop)</option>
                  <option value="duplicate">Duplicate Payment Case (Double Charge)</option>
                  <option value="disputed">Disputed Payment</option>
                  <option value="partial_due">Partial Payment (Remaining Due)</option>
                  <option value="pending_due">Pending Due</option>
                </select>
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Amount Paid / Charged (₹)</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={recordForm.amountPaidInr}
                  onChange={(e) =>
                    setRecordForm((prev) => ({ ...prev, amountPaidInr: e.target.value }))
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Remaining Payment Due (₹)</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={recordForm.paymentDueInr}
                  onChange={(e) =>
                    setRecordForm((prev) => ({ ...prev, paymentDueInr: e.target.value }))
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Payment Mode / Gateway</span>
                <input
                  type="text"
                  value={recordForm.paymentMode}
                  onChange={(e) =>
                    setRecordForm((prev) => ({ ...prev, paymentMode: e.target.value }))
                  }
                  placeholder="e.g., upi_gateway, card, netbanking"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </label>

              <label className="space-y-1 text-slate-300">
                <span>Transaction Reference ID</span>
                <input
                  type="text"
                  value={recordForm.transactionRef}
                  onChange={(e) =>
                    setRecordForm((prev) => ({ ...prev, transactionRef: e.target.value }))
                  }
                  placeholder="e.g., TXN-98412A"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </label>

              <label className="space-y-1 text-slate-300 sm:col-span-2">
                <span>Issue Details / Billing Note</span>
                <input
                  type="text"
                  value={recordForm.notes}
                  onChange={(e) =>
                    setRecordForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="e.g., Bank debited twice via UPI; or Gateway timeout error"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRecordModal(false)}
                className="px-4 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={recordBusy || !recordForm.userId}
                className="px-4 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
              >
                {recordBusy ? "Recording…" : "Save Payment Entry"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
