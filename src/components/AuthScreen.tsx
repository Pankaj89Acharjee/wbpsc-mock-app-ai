import React, { useState } from "react";
import type { UserDto } from "../../packages/shared-types/src/index";
import { api } from "../api";
import GoogleSignInButton from "./GoogleSignInButton";

interface AuthScreenProps {
  googleClientId: string | null;
  onSignedIn: (user: UserDto) => void;
}

export default function AuthScreen({ googleClientId, onSignedIn }: AuthScreenProps) {
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [emailInput, setEmailInput] = useState<string>("");
  const [passwordInput, setPasswordInput] = useState<string>("");
  const [fullNameInput, setFullNameInput] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const { user } =
        authMode === "signup"
          ? await api<{ user: UserDto }>("/auth/register", {
              method: "POST",
              body: {
                email: emailInput.trim(),
                password: passwordInput,
                fullName: fullNameInput.trim(),
              },
            })
          : await api<{ user: UserDto }>("/auth/login", {
              method: "POST",
              body: { email: emailInput.trim(), password: passwordInput },
            });
      setPasswordInput("");
      onSignedIn(user);
    } catch (err) {
      setAuthError((err as Error).message || "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      const { user } = await api<{ user: UserDto }>("/auth/google", {
        method: "POST",
        body: { credential },
      });
      onSignedIn(user);
    } catch (err) {
      setAuthError((err as Error).message || "Google sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-['Plus_Jakarta_Sans','Noto_Sans_Bengali',sans-serif]">
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800">
        <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
          WBPSC Mock Tutor
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <span className="whitespace-nowrap shrink-0">WBCS Prelims</span>
          <span className="whitespace-nowrap shrink-0">WBCS Mains</span>
          <span className="whitespace-nowrap shrink-0">Clerkship Part I &amp; II</span>
          <span className="whitespace-nowrap shrink-0">Food SI</span>
          <span className="whitespace-nowrap shrink-0">Miscellaneous Prelims</span>
          <span className="whitespace-nowrap shrink-0">Miscellaneous Mains</span>
          <span className="whitespace-nowrap shrink-0">ICDS Supervisor Prelims</span>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto w-full px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Left Column: Platform Overview */}
        <div className="lg:col-span-7 space-y-6">
          <p className="text-xs font-medium text-emerald-400">
            Bengali &amp; English Mock Tests with PYQs · AI Assessment · Weakness Analysis
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
            WBPSC Mock Tutor &amp; Weakness &amp; Strength Analyser Engine.
          </h1>
          <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
            Built for West Bengal Civil Service (WBCS) Prelims + Mains, Clerkship Part-I &amp; Part-II,
            Food SI, ICDS Supervisor Prelims + Mains and Miscellaneous Prelims + Mains aspirants. Features negative-marking
            evaluation, weakness analysis radar, Visual Storytelling of Concepts, AI-generated study notes, and AI-powered descriptive answer evaluation.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
            <div>
              <div className="text-2xl font-bold text-white font-mono tabular-nums">
                -0.25 / -0.33
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Negative Marking Evaluation
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white font-mono tabular-nums">
                L1 · L2 · L3
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Multi-Tier Subscription Passes
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white font-mono tabular-nums">
                Full Coverage
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Prelims · Mains · Descriptive · Current Affairs
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Email/Password + Google sign-in */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white">
                {authMode === "signin"
                  ? "Sign in to your account"
                  : "Create an Aspirant account"}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Need an account? Register to track your progress and access AI-powered features.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setAuthMode("signin")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  authMode === "signin"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("signup")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  authMode === "signup"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Register
              </button>
            </div>
          </div>

          {authError && (
            <div className="p-3.5 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-200 leading-relaxed">
              {authError}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {authMode === "signup" && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Full Name (নাম)
                </label>
                <input
                  type="text"
                  required
                  value={fullNameInput}
                  onChange={(e) => setFullNameInput(e.target.value)}
                  placeholder="e.g., Subhamoy Chatterjee"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="aspirant@example.com"
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={authBusy}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-lg transition-colors cursor-pointer"
            >
              {authBusy
                ? "Please wait..."
                : authMode === "signin"
                  ? "Sign In"
                  : "Create Aspirant Account"}
            </button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-800" />
            <span className="flex-shrink mx-3 text-xs text-slate-500">or</span>
            <div className="flex-grow border-t border-slate-800" />
          </div>

          {googleClientId ? (
            <div className="space-y-2">
              <GoogleSignInButton
                clientId={googleClientId}
                onCredential={handleGoogleCredential}
              />
              <p className="text-[11px] text-slate-500 text-center">
                Admin: continue with Google using your admin email.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 text-center">
              Google sign-in is not configured yet (set GOOGLE_CLIENT_ID on api-core).
            </p>
          )}
        </div>
      </main>

      <footer className="px-6 py-4 border-t border-slate-900 text-xs text-slate-500 flex justify-between">
        <span>WBPSC AI Mock Tutor — Copyright</span>
        <span>Acharya Labs (বাংলা + English) · Developed by - Pankaj Acharjee</span>
      </footer>
    </div>
  );
}
