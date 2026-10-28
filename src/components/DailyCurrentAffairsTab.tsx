import React, { useState } from "react";
import type { SupportedLang } from "./types";

interface DailyCurrentAffairsTabProps {
  lang: SupportedLang;
  onError: (err: unknown, fallback: string) => void;
}

export default function DailyCurrentAffairsTab({
  lang,
  onError,
}: DailyCurrentAffairsTabProps) {
  const [caBusy, setCaBusy] = useState<boolean>(false);
  const [caHeadlinesInput, setCaHeadlinesInput] = useState<string>(
    "Kolkata Metro East-West Under-River Corridor Milestone; West Bengal Student Credit Card Scheme Update; RBI Monetary Policy Repo Rate Decision"
  );
  const [caDigestResult, setCaDigestResult] = useState<{
    titleEn: string;
    titleBn: string;
    contentMarkdown: string;
    mnemonicsText: string;
    editionDate: string;
  } | null>(null);

  const handleGenerateDailyCA = async () => {
    setCaBusy(true);
    try {
      const headlines = caHeadlinesInput
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/cron/generate-daily-ca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editionDate: new Date().toISOString().slice(0, 10),
          headlines,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to synthesize CA");
      setCaDigestResult({
        ...data.digest,
        editionDate: data.editionDate,
      });
    } catch (err) {
      onError(err, "Daily Current Affairs generation failed.");
    } finally {
      setCaBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">
              01. Bilingual Daily Current Affairs Digest Generator
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Synthesizes National &amp; West Bengal state headlines into
              bilingual bullet points, Static GK links, and PYQ MCQs.
            </p>
          </div>
          <button
            onClick={handleGenerateDailyCA}
            disabled={caBusy}
            className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg cursor-pointer"
          >
            {caBusy
              ? "Synthesizing Bilingual Digest..."
              : "Synthesize Today's Digest"}
          </button>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Headlines to Synthesize (semicolon separated)
          </label>
          <input
            type="text"
            value={caHeadlinesInput}
            onChange={(e) => setCaHeadlinesInput(e.target.value)}
            className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
        </div>
      </div>

      {caDigestResult && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <div className="text-xs text-emerald-400 font-mono">
                Edition: {caDigestResult.editionDate}
              </div>
              <h2 className="text-lg font-bold text-white">
                {lang === "bn"
                  ? caDigestResult.titleBn
                  : caDigestResult.titleEn}
              </h2>
            </div>
            <button
              onClick={() => window.print()}
              className="px-3.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
            >
              Print / Save PDF
            </button>
          </div>
          <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
            {caDigestResult.contentMarkdown}
          </div>
        </div>
      )}
    </div>
  );
}
