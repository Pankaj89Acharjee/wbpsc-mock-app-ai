import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  SUBSCRIPTION_TIER_PLANS,
  type AttemptSummaryDto,
  type CachedNoteRefDto,
  type StudentExamDto,
  type StudentSubscriptionDto,
  type SubscriptionPlanDto,
  type SubscriptionTier,
  type UserDto,
  type UserRole,
} from "../../packages/shared-types/src/index";
import QuestionBankAdmin from "../admin/QuestionBankAdmin";
import AdminAnalyticsCharts from "./AdminAnalyticsCharts";
import PaymentManagementConsole from "./PaymentManagementConsole";
import { AdminSubscriptionPlansManager } from "./SubscriptionModal";
import type { AdminSubTab } from "./types";

interface AdminConsoleTabProps {
  adminTab: AdminSubTab;
  allUsers: UserDto[];
  examsList: StudentExamDto[];
  cachedNotes: CachedNoteRefDto[];
  allAttempts: AttemptSummaryDto[];
  allSubscriptions: StudentSubscriptionDto[];
  plans: SubscriptionPlanDto[];
  onChangeAdminTab: (tab: AdminSubTab) => void;
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
  onExamsChanged: () => void;
  onPlansChanged: () => void;
  onNotify: (type: "success" | "error" | "info", text: string) => void;
}

export default function AdminConsoleTab({
  adminTab,
  allUsers,
  examsList,
  cachedNotes,
  allAttempts,
  allSubscriptions,
  plans,
  onChangeAdminTab,
  onUpdateUser,
  onExamsChanged,
  onPlansChanged,
  onNotify,
}: AdminConsoleTabProps) {
  const planCatalog = plans.length > 0 ? plans : SUBSCRIPTION_TIER_PLANS;

  // Refs & state for the centered, taller, smooth-sliding Admin Sub-Navigation Menu
  const menuTrackRef = useRef<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [sliderBox, setSliderBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    opacity: number;
  }>({ left: 0, top: 0, width: 0, height: 0, opacity: 0 });

  const updateMenuSlider = useCallback(() => {
    const trackEl = menuTrackRef.current;
    const btnEl = tabButtonRefs.current[adminTab];
    if (!trackEl || !btnEl) {
      setSliderBox((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const trackRect = trackEl.getBoundingClientRect();
    const btnRect = btnEl.getBoundingClientRect();
    setSliderBox({
      left: btnRect.left - trackRect.left,
      top: btnRect.top - trackRect.top,
      width: btnRect.width,
      height: btnRect.height,
      opacity: 1,
    });
  }, [adminTab]);

  useEffect(() => {
    updateMenuSlider();
    window.addEventListener("resize", updateMenuSlider);
    return () => window.removeEventListener("resize", updateMenuSlider);
  }, [
    updateMenuSlider,
    allUsers.length,
    planCatalog.length,
    examsList.length,
    cachedNotes.length,
    allAttempts.length,
    allSubscriptions.length,
  ]);

  const adminTabsList: Array<{ id: AdminSubTab; label: string }> = [
    { id: "users", label: `1. Users & RBAC (${allUsers.length})` },
    { id: "plans", label: `2. Subscription Plans (${planCatalog.length})` },
    { id: "exams", label: `3. Exams & Syllabus (${examsList.length})` },
    {
      id: "cache-attempts",
      label: `4. AI Cache (${cachedNotes.length}) & Attempts (${allAttempts.length})`,
    },
    { id: "bulk-import", label: "5. Question Bank (Add · Bulk · AI)" },
    { id: "series", label: "6. Exam Series" },
    { id: "analytics", label: "7. Revenue & Trend Charts" },
    { id: "payments", label: `8. Payments Console (${allSubscriptions.length})` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">ADMIN Control Panel</h1>
          <p className="text-xs text-slate-400 mt-1">
            Users &amp; RBAC, subscription plans, exams &amp; syllabus, the question bank, AI cache, analytics charts, and payment management — stored in PostgreSQL.
          </p>
        </div>
      </div>

      {/* Centered, Taller, Professional Animated Admin Sub-Navigation Menu */}
      <div className="w-full flex justify-center py-1">
        <div
          ref={menuTrackRef}
          role="tablist"
          aria-label="Admin Control Panel Navigation"
          className="relative mx-auto flex flex-wrap items-center justify-center gap-1.5 px-3 py-2 min-h-[56px] bg-slate-900/95 border border-slate-800/90 rounded-2xl shadow-lg shadow-slate-950/60 w-fit max-w-full"
        >
          {/* Smooth Sliding Highlight Indicator Pill */}
          <span
            aria-hidden="true"
            style={{
              transform: `translate(${sliderBox.left}px, ${sliderBox.top}px)`,
              width: `${sliderBox.width}px`,
              height: `${sliderBox.height}px`,
              opacity: sliderBox.opacity,
            }}
            className="pointer-events-none absolute top-0 left-0 rounded-xl bg-gradient-to-r from-amber-500/20 via-slate-800/95 to-emerald-500/20 border border-amber-400/40 shadow-md transition-all duration-300 ease-out"
          />

          {adminTabsList.map((tab) => {
            const isActive = adminTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                ref={(el) => {
                  tabButtonRefs.current[tab.id] = el;
                }}
                onClick={() => onChangeAdminTab(tab.id)}
                className={`relative z-10 px-4 py-2.5 text-xs sm:text-[13px] rounded-xl transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  isActive
                    ? "text-white font-bold bg-white/5 shadow-sm scale-[1.01]"
                    : "text-slate-400 font-medium hover:text-slate-100 hover:bg-slate-800/40"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-Tab 7: Admin Analytics & Trend Charts */}
      {adminTab === "analytics" && (
        <AdminAnalyticsCharts
          allUsers={allUsers}
          allSubscriptions={allSubscriptions}
          examsList={examsList}
          plans={plans}
        />
      )}

      {/* Sub-Tab 8: Admin Payment Management Console */}
      {adminTab === "payments" && (
        <PaymentManagementConsole
          allUsers={allUsers}
          allSubscriptions={allSubscriptions}
          plans={plans}
          onRefreshAdminData={onPlansChanged}
          onNotify={onNotify}
        />
      )}

      {/* Sub-Tab 6: Exam Series */}
      {adminTab === "series" && (
        <QuestionBankAdmin section="series" onExamsChanged={onExamsChanged} />
      )}

      {/* Sub-Tab 5: Question Bank */}
      {adminTab === "bulk-import" && (
        <QuestionBankAdmin section="questions" onExamsChanged={onExamsChanged} />
      )}

      {/* Sub-Tab 2: Subscription Plans Manager (Add, Modify, Delete Plans) */}
      {adminTab === "plans" && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <AdminSubscriptionPlansManager
            plans={plans}
            onPlansChanged={onPlansChanged}
            onNotify={onNotify}
          />
        </div>
      )}

      {/* Sub-Tab 1: Users & RBAC Manager */}
      {adminTab === "users" && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-3 px-4">User / Email</th>
                <th className="py-3 px-4">Role (RBAC)</th>
                <th className="py-3 px-4">Subscription Tier</th>
                <th className="py-3 px-4">Validity / Expiry</th>
                <th className="py-3 px-4">Sign-in</th>
                <th className="py-3 px-4">Account Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {allUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/30">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-white">{u.fullName}</div>
                    <div className="text-slate-400 font-mono text-[11px]">
                      {u.email}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {u.role === "admin" ? (
                      <span className="px-2.5 py-1 text-amber-400 font-semibold">
                        admin
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={(e) =>
                          onUpdateUser(u, {
                            role: e.target.value as Exclude<UserRole, "admin">,
                          })
                        }
                        className="px-2.5 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                      >
                        <option value="aspirant">aspirant</option>
                        <option value="educator">educator</option>
                      </select>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {u.role === "admin" ? (
                      <span className="text-xs font-mono text-amber-300">
                        All-Access (Admin)
                      </span>
                    ) : (
                      <select
                        value={u.subscriptionTier}
                        onChange={(e) =>
                          onUpdateUser(u, {
                            subscriptionTier: e.target.value as SubscriptionTier,
                          })
                        }
                        className="px-2.5 py-1 bg-slate-950 border border-slate-700 rounded text-white"
                      >
                        {planCatalog.map((p) => (
                          <option key={p.tier} value={p.tier}>
                            {p.tier} ({p.shortLabel})
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-400">
                    {u.role === "admin"
                      ? "Permanent"
                      : u.subscriptionTier === "free"
                        ? "Free Tier"
                        : u.subscriptionExpiresAt
                          ? `Until ${new Date(u.subscriptionExpiresAt).toLocaleDateString()}`
                          : "Active"}
                  </td>
                  <td className="py-3 px-4 text-slate-400">
                    {[u.hasPassword && "password", u.hasGoogle && "Google"]
                      .filter(Boolean)
                      .join(" + ") || "—"}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      disabled={u.role === "admin"}
                      onClick={() =>
                        onUpdateUser(u, {
                          isActive: !u.isActive,
                        })
                      }
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                        u.isActive
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-rose-500/20 text-rose-300"
                      }`}
                    >
                      {u.isActive ? "Active" : "Suspended"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sub-Tab 3: Exams & Syllabus */}
      {adminTab === "exams" && (
        <QuestionBankAdmin section="exams" onExamsChanged={onExamsChanged} />
      )}

      {/* Sub-Tab 4: AI Notes Cache & All User Attempts */}
      {adminTab === "cache-attempts" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-white">
              Cached AI Study Notes ({cachedNotes.length})
            </h3>
            {cachedNotes.map((n) => (
              <div
                key={`${n.examSlug}:${n.topicSlug}:${n.language}`}
                className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-white">
                    {n.examSlug}:{n.topicSlug}:{n.language}
                  </div>
                  <div className="text-slate-400">
                    Hits: {n.hitCount} · Model: {n.modelUsed}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-white">
              All Aspirant Mock Submissions ({allAttempts.length})
            </h3>
            {allAttempts.map((att) => (
              <div
                key={att.id}
                className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-white">
                    {att.userName} ({att.userEmail})
                  </div>
                  <div className="text-slate-400">
                    {att.examTitleEn} · Net: {att.finalNetScore} · Acc:{" "}
                    {att.accuracyPercentage}% ·{" "}
                    {att.submittedAt
                      ? new Date(att.submittedAt).toLocaleString()
                      : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
