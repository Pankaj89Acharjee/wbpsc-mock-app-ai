import React, { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, Crown, Layers, Shield, Sparkles, Wallet } from "lucide-react";
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

type TopGroupKey = "mock-center" | "study-group" | "descriptive-eval" | "daily-ca" | "admin-group";

function resolveTopGroupKey(activeNav: ActiveNav): TopGroupKey {
  if (activeNav === "weakness-tutor" || activeNav === "revision-notes") {
    return "study-group";
  }
  if (activeNav === "admin-console" || activeNav === "payment-console") {
    return "admin-group";
  }
  return activeNav;
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
  const [openDropdown, setOpenDropdown] = useState<"study-group" | "admin-group" | null>(null);
  const [navSliderStyle, setNavSliderStyle] = useState<{
    left: number;
    width: number;
    opacity: number;
  }>({ left: 0, width: 0, opacity: 0 });

  const activeGroupKey = resolveTopGroupKey(activeNav);

  const updateNavSlider = useCallback(() => {
    const navEl = navContainerRef.current;
    const activeBtn = navTabRefs.current[activeGroupKey];
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
  }, [activeGroupKey]);

  useEffect(() => {
    const timer = setTimeout(updateNavSlider, 20);
    window.addEventListener("resize", updateNavSlider);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateNavSlider);
    };
  }, [updateNavSlider, isUserAdmin, user.id, activeNav]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (navContainerRef.current && !navContainerRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentPlanLabel = getSubscriptionTierLabel(user.subscriptionTier, plans);

  const studySubLabel =
    activeNav === "revision-notes"
      ? "Exam-Oriented Notes"
      : activeNav === "weakness-tutor"
        ? "Weakness & Tutor"
        : "Notes & Tutor";

  const adminSubLabel =
    activeNav === "payment-console" ? "Payments Console" : "Admin Console";

  return (
    <>
      {/* Responsive 3-Zone Top Bar — Never overflows on 1280px/1366px small laptops */}
      <header className="w-full max-w-full flex items-center justify-between gap-3 lg:gap-5 px-4 lg:px-6 py-3 border-b border-slate-800 bg-slate-950/95 backdrop-blur-md sticky top-0 z-30">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onChangeNav("mock-center");
            setOpenDropdown(null);
          }}
          className="text-base lg:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          WBPSC Mock Tutor
        </a>

        {/* Zone 2: Compact Semi-Rounded Navbar with Sub-Menus & Sliding Active Indicator */}
        <nav
          ref={navContainerRef}
          aria-label="Main navigation"
          className="hidden md:flex relative items-center gap-1 rounded-2xl bg-slate-900/95 border border-slate-800/90 px-2.5 lg:px-3.5 py-1.5 shadow-inner text-xs lg:text-sm font-medium shrink"
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
              activeGroupKey === "admin-group"
                ? "bg-amber-400/20 border border-amber-400/35 shadow-sm"
                : "bg-slate-100/15 border border-slate-200/20 shadow-sm"
            }`}
          />

          {/* 1. Mock Tests */}
          <button
            type="button"
            ref={(el) => {
              navTabRefs.current["mock-center"] = el;
            }}
            onClick={() => {
              onChangeNav("mock-center");
              setOpenDropdown(null);
            }}
            className={`relative z-10 px-3 lg:px-3.5 py-1.5 rounded-xl transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer ${
              activeGroupKey === "mock-center"
                ? "text-white font-semibold bg-white/10"
                : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Mock Tests
          </button>

          {/* 2. Study & Notes Sub-Menu (Groups Weakness & Tutor + Exam-Oriented Notes) */}
          <div className="relative z-20">
            <button
              type="button"
              ref={(el) => {
                navTabRefs.current["study-group"] = el;
              }}
              onClick={() =>
                setOpenDropdown((prev) => (prev === "study-group" ? null : "study-group"))
              }
              className={`inline-flex items-center gap-1.5 px-3 lg:px-3.5 py-1.5 rounded-xl transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer ${
                activeGroupKey === "study-group"
                  ? "text-white font-semibold bg-white/10"
                  : "text-slate-400 hover:text-slate-100"
              }`}
            >
              <span>{studySubLabel}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  openDropdown === "study-group" ? "rotate-180 text-emerald-400" : ""
                }`}
              />
            </button>

            {openDropdown === "study-group" && (
              <div className="absolute left-0 top-full mt-2 w-72 rounded-xl bg-slate-900 border border-slate-700/90 shadow-2xl p-1.5 space-y-1 z-50">
                <button
                  type="button"
                  onClick={() => {
                    onChangeNav("revision-notes");
                    setOpenDropdown(null);
                  }}
                  className={`w-full text-left p-2.5 rounded-lg transition-colors flex items-start gap-2.5 cursor-pointer ${
                    activeNav === "revision-notes"
                      ? "bg-emerald-500/15 border border-emerald-500/40 text-white"
                      : "hover:bg-slate-800/80 text-slate-200"
                  }`}
                >
                  <BookOpen className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      Exam-Oriented Notes
                      <span className="text-[10px] font-mono text-emerald-300">
                        30-MCQ Sets
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                      Topic revision tables, visual diagrams (Viceroys, Grammar) &amp; 30-MCQ practice tests.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onChangeNav("weakness-tutor");
                    setOpenDropdown(null);
                  }}
                  className={`w-full text-left p-2.5 rounded-lg transition-colors flex items-start gap-2.5 cursor-pointer ${
                    activeNav === "weakness-tutor"
                      ? "bg-emerald-500/15 border border-emerald-500/40 text-white"
                      : "hover:bg-slate-800/80 text-slate-200"
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold">Weakness &amp; AI Tutor</div>
                    <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                      Post-exam weak subtopic diagnosis &amp; 3-tier cached RAG study notes.
                    </p>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* 3. Part-II Evaluator */}
          <button
            type="button"
            ref={(el) => {
              navTabRefs.current["descriptive-eval"] = el;
            }}
            onClick={() => {
              onChangeNav("descriptive-eval");
              setOpenDropdown(null);
            }}
            className={`relative z-10 px-3 lg:px-3.5 py-1.5 rounded-xl transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer ${
              activeGroupKey === "descriptive-eval"
                ? "text-white font-semibold bg-white/10"
                : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Part-II Evaluator
          </button>

          {/* 4. Daily Current Affairs */}
          <button
            type="button"
            ref={(el) => {
              navTabRefs.current["daily-ca"] = el;
            }}
            onClick={() => {
              onChangeNav("daily-ca");
              setOpenDropdown(null);
            }}
            className={`relative z-10 px-3 lg:px-3.5 py-1.5 rounded-xl transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer ${
              activeGroupKey === "daily-ca"
                ? "text-white font-semibold bg-white/10"
                : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Current Affairs
          </button>

          {/* 5. Admin Suite Sub-Menu (Groups Admin Console + Payments Console) */}
          {isUserAdmin && (
            <div className="relative z-20">
              <button
                type="button"
                ref={(el) => {
                  navTabRefs.current["admin-group"] = el;
                }}
                onClick={() =>
                  setOpenDropdown((prev) => (prev === "admin-group" ? null : "admin-group"))
                }
                className={`inline-flex items-center gap-1.5 px-3 lg:px-3.5 py-1.5 rounded-xl transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer ${
                  activeGroupKey === "admin-group"
                    ? "text-amber-200 font-semibold bg-amber-400/10"
                    : "text-slate-400 hover:text-slate-100"
                }`}
              >
                <span>{adminSubLabel}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    openDropdown === "admin-group" ? "rotate-180 text-amber-300" : ""
                  }`}
                />
              </button>

              {openDropdown === "admin-group" && (
                <div className="absolute right-0 top-full mt-2 w-68 rounded-xl bg-slate-900 border border-slate-700/90 shadow-2xl p-1.5 space-y-1 z-50">
                  <button
                    type="button"
                    onClick={() => {
                      onChangeNav("admin-console");
                      setOpenDropdown(null);
                    }}
                    className={`w-full text-left p-2.5 rounded-lg transition-colors flex items-start gap-2.5 cursor-pointer ${
                      activeNav === "admin-console"
                        ? "bg-amber-500/15 border border-amber-500/40 text-amber-200"
                        : "hover:bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold">Admin Control Panel</div>
                      <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                        Users, Plans, Syllabus, Question Bank, Test Series &amp; CA Agent.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onChangeNav("payment-console");
                      setOpenDropdown(null);
                    }}
                    className={`w-full text-left p-2.5 rounded-lg transition-colors flex items-start gap-2.5 cursor-pointer ${
                      activeNav === "payment-console"
                        ? "bg-amber-500/15 border border-amber-500/40 text-amber-200"
                        : "hover:bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <Wallet className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold">Payments Console</div>
                      <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                        Manage student subscriptions, dues, failures &amp; duplicate payments.
                      </p>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Zone 3: Primary Actions (Plans + Sign Out) */}
        <div className="flex items-center gap-2 shrink-0">
          {isUserAdmin ? (
            <button
              type="button"
              onClick={() => onOpenSubscriptionModal(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-amber-300" />
              <span>Plans ({plans.length})</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenSubscriptionModal(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Crown className="w-3.5 h-3.5" />
              {user.subscriptionTier === "free"
                ? lang === "bn"
                  ? "সাবস্ক্রিপশন কিনুন"
                  : "Buy Plan"
                : lang === "bn"
                  ? `প্ল্যান: ${currentPlanLabel}`
                  : `Plan: ${currentPlanLabel}`}
            </button>
          )}
          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Sub-header Workspace Toolbar + Context Sub-Menu Quick Switcher */}
      <div className="border-b border-slate-900 bg-slate-900/40 px-4 lg:px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
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

            {/* Quick Sub-Menu Switcher Pill for Study & Notes or Admin Suite */}
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <div className="hidden sm:inline-flex items-center gap-1 bg-slate-950/90 border border-slate-800 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => onChangeNav("revision-notes")}
                className={`px-2.5 py-0.5 text-[11px] rounded-md transition-colors cursor-pointer ${
                  activeNav === "revision-notes"
                    ? "bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Exam-Oriented Notes
              </button>
              <button
                type="button"
                onClick={() => onChangeNav("weakness-tutor")}
                className={`px-2.5 py-0.5 text-[11px] rounded-md transition-colors cursor-pointer ${
                  activeNav === "weakness-tutor"
                    ? "bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Weakness &amp; Tutor
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Mobile Nav Selector */}
            <select
              value={activeNav}
              onChange={(e) => onChangeNav(e.target.value as ActiveNav)}
              className="md:hidden px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200"
            >
              <option value="mock-center">Mock Tests</option>
              <option value="revision-notes">Study → Exam-Oriented Notes</option>
              <option value="weakness-tutor">Study → Weakness &amp; Tutor</option>
              <option value="descriptive-eval">Part-II Evaluator</option>
              <option value="daily-ca">Current Affairs</option>
              {isUserAdmin && <option value="admin-console">Admin → Control Panel</option>}
              {isUserAdmin && <option value="payment-console">Admin → Payments Console</option>}
            </select>

            {/* Interactive Language Segmented Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
              <button
                onClick={() => onChangeLang("bn")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  lang === "bn"
                    ? "bg-emerald-500 text-slate-950 font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                বাংলা (BN)
              </button>
              <button
                onClick={() => onChangeLang("en")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
