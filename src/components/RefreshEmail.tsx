"use client";

import { useEffect, useState, useTransition } from "react";
import { refreshFromEmailAction } from "@/lib/actions";

/** Pull new mail and calendar changes now instead of waiting for the 10-minute sync. */
export function RefreshEmail() {
  const [busy, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 12_000);
    return () => clearTimeout(t);
  }, [result]);
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        className="btn btn-ghost h-[42px]"
        disabled={busy}
        onClick={() => start(async () => setResult(await refreshFromEmailAction()))}
        title="Check Outlook and your calendar for anything new now"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={busy ? "animate-spin" : ""}>
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        <span className="hidden sm:inline">{busy ? "Checking email…" : "Refresh from email"}</span>
      </button>
      {result && (
        <p role="status" className="glass absolute top-[50px] right-0 z-20 w-[280px] rounded-lg px-3 py-2 text-[13px] text-fg-2">
          {result}
        </p>
      )}
    </div>
  );
}
