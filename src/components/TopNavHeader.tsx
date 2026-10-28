import React, { useCallback, useEffect, useRef, useState } from "react";
import { Crown, Layers } from "lucide-react";
import {
  getSubscriptionTierLabel,
  type SubscriptionTierPlanInfo,
  type UserDto,
} from "../../packages/shared-types/src/index";
import type { ActiveNav, SupportedLang } from "./types";

interface TopNavHeaderProps {
  user: UserDto;
  lang: SupportedLang;
  activeNav: ActiveNav;
  plans: SubscriptionTierPlanInfo[];
  onChangeNav: (nav: ActiveNav) => void;
  onChangeLang: (lang: SupportedLang) => void;
  onOpenSubscriptionModal: (dueOnly?: boolean) => void;
  onLogout: () => void;
}

export default function TopNavHeader({
  user,
  lang,
  activeNav,
  plans,
  onChangeNav,
  onChangeLang,
  onOpenSubscriptionModal,
  onLogout,
}: TopNavHeaderProps) {
  const isUserAdmin = user.role === "admin";
  const navContainerRef = useRef<HTMLElement | null>(null);
  const navTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [navSliderStyle, setNavSliderStyle] = useState<{
    left: number;
    width: number;
    opacity: number;
  }>({ left: 0, width: 0, opacity: 0 });

  const updateNavSlider = useCallback(() => {
    const navEl = navContainerRef.current;
    const activeBtn = navTabRefs.current[activeNav];
    if (!navEl || !activeBtn) {
      setNavSliderStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const navRect = navEl.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setNavSliderStyle({
      left: btnRect.left - navRect.left,
      width: btnRect.width,
      opacity: 1,
    });
  }, [activeNav]);

  useEffect(() => {
    updateNavSlider();
    window.addEventListener("resize", updateNavSlider);
    return () => window.removeEventListener("resize", updateNavSlider);
  }, [updateNavSlider, isUserAdmin, user.id]);

  const currentPlanLabel = getSubscriptionTierLabel(user.subscriptionTier, plans);

  return (
    <>
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-6 px-6 py-3.5 border-b border-slate-800 bg-slate-950/95 backdrop-blur-md sticky top-0 z-20">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onChangeNav("mock-center");
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          WBPSC Mock Tutor
        </a>

        {/* Zone 2: Semi-rounded Navbar with padding at both ends, sliding indicator & light active tab background */}
        <nav
          ref={navContainerRef}
          aria-label="Main navigation"
          className="hidden md:flex relative items-center gap-1.5 rounded-2xl bg-slate-900/95 border border-slate-800/90 px-4 py-1.5 shadow-inner text-sm font-medium"
        >
          {/* Sliding active tab background pill */}
          <span
            aria-hidden="true"
            style={{
              transform: `translateX(${navSliderStyle.left}px)`,
              width: `${navSliderStyle.width}px`,
              opacity: navSliderStyle.opacity,
            }}
            className={`pointer-events-none absolute top-1.5 bottom-1.5 left-0 rounded-xl transition-all duration-300 ease-out ${
              activeNav === "admin-console"
                ? "bg-amber-400/20 border border-amber-400/35 shadow-sm"
                : "bg-slate-100/15 border border-slate-200/20 shadow-sm"
            }`}
          />
          {(
            [
              { id: "mock-center" as const, label: "Mock Tests" },
              { id: "weakness-tutor" as const, label: "Weakness & Tutor" },
              { id: "descriptive-eval" as const, label: "Part-II Evaluator" },
              { id: "daily-ca" as const, label: "Daily Current Affairs" },
              ...(isUserAdmin
                ? [{ id: "admin-console" as const, label: "Admin Console" }]
                : []),
            ] as const
          ).map((tab) => {
            const isActive = activeNav === tab.id;
            const isAdminTab = tab.id === "admin-console";
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  navTabRefs.current[tab.id] = el;
                }}
                onClick={() => onChangeNav(tab.id)}
                className={`relative z-10 px-4 py-1.5 rounded-xl transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? isAdminTab
                      ? "text-amber-200 font-semibold bg-amber-400/10"
                      : "text-white font-semibold bg-white/10"
                    : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Primary actions (Aspirant: Buy/Upgrade Plan | Admin: Manage Subscription Plans + Sign Out) */}
        <div className="flex items-center gap-2.5 shrink-0">
          {isUserAdmin ? (
            <button
              type="button"
              onClick={() => onOpenSubscriptionModal(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-amber-300" />
              Subscription Plans ({plans.length})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenSubscriptionModal(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Crown className="w-3.5 h-3.5" />
              {user.subscriptionTier === "free"
                ? lang === "bn"
                  ? "সাবস্ক্রিপশন কিনুন"
                  : "Buy Subscription"
                : lang === "bn"
                  ? `প্ল্যান: ${currentPlanLabel}`
                  : `Plan: ${currentPlanLabel}`}
            </button>
          )}
          <button
            onClick={onLogout}
            className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Sub-header Workspace Toolbar (Role, Plan, Expiry, Payment Dues, Language Switch) */}
      <div className="border-b border-slate-900 bg-slate-900/40 px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">
              {user.fullName || user.email}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Role:{" "}
              <strong className="text-emerald-400 uppercase">{user.role}</strong>
            </span>
            {!isUserAdmin && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Plan:{" "}
                  <strong className="text-amber-300">{currentPlanLabel}</strong>
                </span>
                {user.subscriptionTier !== "free" && user.subscriptionExpiresAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-sky-300">
                      Valid till:{" "}
                      {new Date(user.subscriptionExpiresAt).toLocaleDateString()}
                    </span>
                  </>
                )}
                {(user.totalPaidInr ?? 0) > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-emerald-300">
                      Paid: ₹{user.totalPaidInr}
                    </span>
                  </>
                )}
                {(user.paymentDueInr ?? 0) > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => onOpenSubscriptionModal(true)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono font-semibold hover:bg-rose-500/30 cursor-pointer"
                    >
                      Payment Due: ₹{user.paymentDueInr} (Pay Now)
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Mobile Nav Selector */}
            <select
              value={activeNav}
              onChange={(e) => onChangeNav(e.target.value as ActiveNav)}
              className="md:hidden px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200"
            >
              <option value="mock-center">Mock Tests</option>
              <option value="weakness-tutor">Weakness &amp; Tutor</option>
              <option value="descriptive-eval">Part-II Evaluator</option>
              <option value="daily-ca">Daily Current Affairs</option>
              {isUserAdmin && <option value="admin-console">Admin Console</option>}
            </select>

            {/* Interactive Language Segmented Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
              <button
                onClick={() => onChangeLang("bn")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  lang === "bn"
                    ? "bg-emerald-500 text-slate-950 font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                বাংলা (BN)
              </button>
              <button
                onClick={() => onChangeLang("en")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  lang === "en"
                    ? "bg-emerald-500 text-slate-950 font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                English (EN)
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
