"use client";

import { useState, useTransition } from "react";
import { reviewCallAction } from "@/lib/actions";
import type { CallReview } from "@/lib/review";

/** Interview review: overall score, section scores with evidence and better answers, and what to work on. */

// Mirrors REVIEW_SECTIONS in lib/review (server-only).
const SECTION_LABEL: Record<string, string> = {
  opener: "Opener & rapport",
  tell_me: "Tell me about yourself",
  motivation: "Why leaving / why them",
  behavioural: "Behavioural answers (STAR)",
  numbers: "Command of your numbers",
  discovery: "Discovery / role-play depth",
  questions: "Your questions",
  close: "The close",
  delivery: "Delivery",
};

const tone = (overall: number) => (overall >= 85 ? "#4ADE9A" : overall >= 70 ? "#6E8BFF" : overall >= 55 ? "#F5B454" : "#FF7A85");
const sectionTone = (s: number) => (s >= 5 ? "bg-green" : s >= 4 ? "bg-accent" : s >= 3 ? "bg-amber" : "bg-red");

export function ReviewStatus({ callId, status, hasTranscript }: { callId: number; status: string | null; hasTranscript: boolean }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (status === "pending") return <span className="chip border-accent/40 text-accent-soft">Claude is reviewing the interview…</span>;
  if (status === "done" || status === "skipped" || !hasTranscript) return null;
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => start(async () => setError(await reviewCallAction(callId)))}>
        {busy ? "Starting…" : "Review this interview"}
      </button>
      {error && <span className="text-xs text-amber-soft">{error}</span>}
    </span>
  );
}

export function CallReviewView({ review: r, open = false }: { review: CallReview; open?: boolean }) {
  const color = tone(r.overall);
  return (
    <details open={open} className="rounded-lg border border-white/8 bg-white/3 px-3.5 py-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer items-center gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full font-mono text-base font-semibold"
          style={{ border: `2px solid ${color}`, color, boxShadow: `0 0 14px ${color}55` }}
          aria-label={`Overall ${r.overall} out of 100`}
        >
          {r.overall}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold">Interview review</span>
          <span className="text-[13px] text-fg-2">{r.headline}</span>
        </span>
      </summary>

      <div className="mt-3 flex flex-col gap-3.5 text-[13px] leading-relaxed">
        <p className="text-muted">{r.verdict}</p>

        <div className="flex flex-col gap-1.5">
          <span className="label">By section</span>
          {r.sections.map((s) => (
            <details key={s.id} className="group rounded-md border border-white/7 bg-black/15 px-3 py-2 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer items-center gap-3">
                <span className="w-[190px] shrink-0 font-medium">{SECTION_LABEL[s.id] ?? s.id}</span>
                <span className="flex flex-1 gap-1" aria-label={`${s.score} out of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= s.score ? sectionTone(s.score) : "bg-white/10"}`} />
                  ))}
                </span>
                <span className="w-8 text-right font-mono text-xs text-muted">{s.score}/5</span>
                <span className="text-faint transition-transform group-open:rotate-90">▸</span>
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <Line label="What you said" text={s.evidence} tone="text-fg-2" />
                <Line label="What good looks like" text={s.good} tone="text-muted" />
                <Line label="Do this instead" text={s.improve} tone="text-fg" box />
              </div>
            </details>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {r.top_improvements.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="label">Top 3 to improve</span>
              <ol className="flex list-decimal flex-col gap-1 pl-4 text-amber-soft">
                {r.top_improvements.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </div>
          )}
          {r.strengths.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="label">Strengths</span>
              <ul className="flex flex-col gap-1 text-green">
                {r.strengths.map((t, i) => (
                  <li key={i}>✓ {t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {r.added_to_practice > 0 && (
          <p className="text-xs text-faint">
            Added {r.added_to_practice} {r.added_to_practice === 1 ? "question" : "questions"} to this role&apos;s practice list as &ldquo;Needs work&rdquo;, so they
            come first in Practice mode.
          </p>
        )}
      </div>
    </details>
  );
}

function Line({ label, text, tone, box }: { label: string; text: string; tone: string; box?: boolean }) {
  if (!text) return null;
  return (
    <div className={box ? "rounded-md border border-accent/25 bg-accent/6 p-2.5" : ""}>
      <span className="label">{label}</span>
      <p className={`whitespace-pre-line ${tone}`}>{text}</p>
    </div>
  );
}
