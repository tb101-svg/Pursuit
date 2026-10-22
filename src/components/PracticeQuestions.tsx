"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ratePracticeAction } from "@/lib/actions";
import type { PrepItem } from "@/lib/prep";
import { StarParts } from "./StarLibrary";

/**
 * Practice questions for a role: each with why they'd ask it, the STAR story
 * to use, a best-in-class answer, points to hit and follow-ups. Practice mode
 * asks one at a time (weakest first), times you, then reveals the answer.
 */

const RATING = [
  { value: 1, label: "Needs work", tone: "border-red/40 bg-red/10 text-[#FFB3BA]" },
  { value: 2, label: "Okay", tone: "border-amber/40 bg-amber/10 text-amber-soft" },
  { value: 3, label: "Nailed it", tone: "border-green/40 bg-green/10 text-green" },
] as const;

const ratingOf = (c?: number) => RATING.find((r) => r.value === c);

export function PracticeQuestions({ jobId, items }: { jobId: number; items: PrepItem[] }) {
  const [practising, setPractising] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const categories = [...new Set(items.map((q) => q.category).filter((c): c is string => !!c))];
  const shown = category ? items.filter((q) => q.category === category) : items;
  const rated = items.filter((q) => q.confidence);
  const nailed = items.filter((q) => q.confidence === 3).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setPractising(true)} disabled={items.length === 0}>
          ▶ Practice {shown.length} {category ? category.toLowerCase() : ""} questions
        </button>
        {rated.length > 0 && (
          <span className="text-[13px] text-muted">
            Practised {rated.length}/{items.length} · {nailed} nailed
          </span>
        )}
      </div>
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setCategory(null)} className={`chip px-2.5 py-1 ${!category ? "border-white/40 bg-white/12 text-fg" : ""}`}>
            All {items.length}
          </button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c === category ? null : c)} className={`chip px-2.5 py-1 ${c === category ? "border-accent/60 bg-accent/15 text-fg" : ""}`}>
              {c} {items.filter((q) => q.category === c).length}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col">
        {shown.map((q, i) => (
          <QuestionCard key={`${q.title}-${i}`} q={q} />
        ))}
      </div>
      {practising && <PracticeMode jobId={jobId} items={shown} onClose={() => setPractising(false)} />}
    </div>
  );
}

function QuestionCard({ q }: { q: PrepItem }) {
  const r = ratingOf(q.confidence);
  return (
    <details className="group border-t border-white/7 first:border-t-0 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer items-start gap-2 py-2.5">
        <span className="mt-0.5 text-faint transition-transform group-open:rotate-90">▸</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{q.title}</span>
          {q.why && <span className="text-xs text-faint">{q.why}</span>}
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {q.category && <span className={`chip py-0 ${q.category === "Numbers drill" ? "border-amber/40 text-amber-soft" : ""}`}>{q.category}</span>}
          {q.story && <span className="chip py-0">STAR: {q.story}</span>}
          {r && <span className={`chip py-0 ${r.tone}`}>{r.label}</span>}
        </span>
      </summary>
      <div className="pb-3 pl-5">
        <Answer q={q} />
      </div>
    </details>
  );
}

function Answer({ q }: { q: PrepItem }) {
  return (
    <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
      {q.body && (
        <div className="flex flex-col gap-1 rounded-lg border border-accent/25 bg-accent/6 p-3">
          <span className="label">Best-in-class answer</span>
          <p className="text-[14px] leading-relaxed whitespace-pre-line text-fg">{q.body}</p>
        </div>
      )}
      {q.star && (q.star.situation || q.star.action) && <StarParts star={q.star} />}
      {!!q.points?.length && (
        <div className="flex flex-col gap-1">
          <span className="label">Must-say points</span>
          <ul className="flex flex-col gap-0.5 text-fg-2">
            {q.points.map((p, i) => (
              <li key={i}>• {p}</li>
            ))}
          </ul>
        </div>
      )}
      {!!q.probes?.length && (
        <div className="flex flex-col gap-1">
          <span className="label">They may follow up with</span>
          <ul className="flex flex-col gap-0.5 text-muted">
            {q.probes.map((p, i) => (
              <li key={i}>• {p}</li>
            ))}
          </ul>
        </div>
      )}
      {!q.body && q.note && <p className="text-muted">{q.note}</p>}
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function PracticeMode({ jobId, items, onClose }: { jobId: number; items: PrepItem[]; onClose: () => void }) {
  // Weakest first: never practised, then needs work, okay, nailed. The order is fixed for a session
  // (ratings saved mid-session mustn't reshuffle it); "Go again" re-sorts.
  const weakestFirst = () => [...items].sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0)).map((q) => q.title);
  const [titles, setTitles] = useState(weakestFirst);
  const order = useMemo(() => titles.map((t) => items.find((q) => q.title === t)).filter((q): q is PrepItem => !!q), [titles, items]);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [results, setResults] = useState<number[]>([]);
  const [, start] = useTransition();
  const q = order[i];

  useEffect(() => {
    if (shown || !q) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [shown, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " " && !shown) {
        e.preventDefault();
        setShown(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, onClose]);

  const rate = (value: number) => {
    start(() => ratePracticeAction(jobId, q.title, value));
    setResults([...results, value]);
    setI(i + 1);
    setShown(false);
    setSeconds(0);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Practice" className="fixed inset-0 z-40 flex flex-col bg-[rgb(8_10_14/0.96)] backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3 md:px-8">
        <span className="text-sm font-semibold">Practice</span>
        <span className="font-mono text-xs text-muted">
          {Math.min(i + 1, order.length)} / {order.length}
        </span>
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>
          Close (Esc)
        </button>
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-6 md:px-8">
        {q ? (
          <>
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl leading-snug font-semibold tracking-[-0.02em] md:text-[28px]">{q.title}</h2>
              {q.why && <p className="text-sm text-muted">{q.why}</p>}
              {q.story && <p className="text-[13px] text-accent-soft">Use your story: {q.story}</p>}
            </div>
            {!shown ? (
              <div className="flex flex-col items-start gap-4">
                <p className="text-sm text-fg-2">Answer out loud, as you would in the interview. Aim for 60–120 seconds.</p>
                <span className={`font-mono text-4xl tabular-nums ${seconds > 120 ? "text-amber-soft" : "text-fg"}`}>{fmt(seconds)}</span>
                <button type="button" className="btn btn-primary" onClick={() => setShown(true)}>
                  Show the best-in-class answer (Space)
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-faint">You took {fmt(seconds)}.</p>
                <Answer q={q} />
                <div className="flex flex-wrap items-center gap-2 border-t border-white/8 pt-4">
                  <span className="text-sm text-muted">How did yours compare?</span>
                  {RATING.map((r) => (
                    <button key={r.value} type="button" className={`btn btn-sm border ${r.tone}`} onClick={() => rate(r.value)}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <h2 className="text-2xl font-semibold">Done</h2>
            <p className="text-sm text-fg-2">
              {results.filter((r) => r === 3).length} nailed · {results.filter((r) => r === 2).length} okay · {results.filter((r) => r === 1).length} need work.
              {results.some((r) => r === 1) ? " The ones that need work come first next time." : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setTitles(weakestFirst());
                  setI(0);
                  setResults([]);
                }}
              >
                Go again
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
