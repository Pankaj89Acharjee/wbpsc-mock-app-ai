import React from "react";
import {
  SUBSCRIPTION_TIER_PLANS,
  type AttemptSummaryDto,
  type CachedNoteRefDto,
  type StudentExamDto,
  type SubscriptionPlanDto,
  type SubscriptionTier,
  type UserDto,
  type UserRole,
} from "../../packages/shared-types/src/index";
import QuestionBankAdmin from "../admin/QuestionBankAdmin";
import { AdminSubscriptionPlansManager } from "./SubscriptionModal";
import type { AdminSubTab } from "./types";

interface AdminConsoleTabProps {
  adminTab: AdminSubTab;
  allUsers: UserDto[];
  examsList: StudentExamDto[];
  cachedNotes: CachedNoteRefDto[];
  allAttempts: AttemptSummaryDto[];
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
  plans,
  onChangeAdminTab,
  onUpdateUser,
  onExamsChanged,
  onPlansChanged,
  onNotify,
}: AdminConsoleTabProps) {
  const planCatalog = plans.length > 0 ? plans : SUBSCRIPTION_TIER_PLANS;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">ADMIN Control Panel</h1>
          <p className="text-xs text-slate-400 mt-1">
            Users &amp; RBAC, subscription plans, exams &amp; syllabus, the question bank, AI cache and
            all attempts — stored in PostgreSQL.
          </p>
        </div>
      </div>

      {/* Admin Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg w-fit">
        <button
          onClick={() => onChangeAdminTab("users")}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            adminTab === "users"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          1. Users &amp; RBAC ({allUsers.length})
        </button>
        <button
          onClick={() => onChangeAdminTab("plans")}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            adminTab === "plans"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          2. Subscription Plans ({planCatalog.length})
        </button>
        <button
          onClick={() => onChangeAdminTab("exams")}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            adminTab === "exams"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          3. Exams &amp; Syllabus ({examsList.length})
        </button>
        <button
          onClick={() => onChangeAdminTab("cache-attempts")}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            adminTab === "cache-attempts"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          4. AI Cache ({cachedNotes.length}) &amp; Attempts ({allAttempts.length})
        </button>
        <button
          onClick={() => onChangeAdminTab("bulk-import")}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            adminTab === "bulk-import"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          5. Question Bank (Add · Bulk · AI)
        </button>
        <button
          onClick={() => onChangeAdminTab("series")}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            adminTab === "series"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          6. Exam Series
        </button>
      </div>

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
