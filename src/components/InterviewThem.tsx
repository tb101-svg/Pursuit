"use client";

import { useState } from "react";
import type { Pillar, PrepItem } from "@/lib/prep";
import type { RatingKey } from "@/lib/rating";
import { CheckIcon, PlusIcon } from "./icons";
import { RatingDots } from "./rating";

/**
 * Interview them: you're assessing the company as much as they're assessing
 * you, on Team (culture, mindset, strategy), Product and Growth. Each column
 * has what's known, the questions to ask (with what to listen for and what
 * they said), and your rating, which feeds the role's tier.
 */

// Mirrors PILLARS in lib/prep (that module is server-only).
export const PILLAR_VIEW: { id: Pillar; label: string; sub: string; rating: RatingKey }[] = [
  { id: "team", label: "Team", sub: "Culture, mindset, strategy", rating: "rating_culture" },
  { id: "product", label: "Product", sub: "What you'd sell, and why it wins", rating: "rating_product" },
  { id: "growth", label: "Growth", sub: "Their trajectory, and yours", rating: "rating_growth" },
];

export function InterviewThem({
  jobId,
  items,
  ratings,
  onChange,
  compact = false,
}: {
  jobId: number;
  items: PrepItem[];
  ratings: Partial<Record<RatingKey, number | null>>;
  onChange: (items: PrepItem[]) => void;
  /** Call mode: one column, questions only. */
  compact?: boolean;
}) {
  const patch = (item: PrepItem, change: Partial<PrepItem>) => onChange(items.map((i) => (i === item ? { ...i, ...change } : i)));
  const remove = (item: PrepItem) => onChange(items.filter((i) => i !== item));
  const add = (group: Pillar, title: string) => onChange([...items, { group, kind: "ask", title, done: false }]);

  return (
    <div className={compact ? "flex flex-col gap-4" : "grid grid-cols-1 gap-4 lg:grid-cols-3"}>
      {PILLAR_VIEW.map((p) => {
        const mine = items.filter((i) => (i.group ?? "team") === p.id);
        const known = mine.filter((i) => i.kind === "know");
        const asks = mine.filter((i) => i.kind !== "know");
        const asked = asks.filter((i) => i.done).length;
        return (
          <div key={p.id} className={compact ? "flex flex-col gap-2" : "flex flex-col gap-3 rounded-lg border border-white/8 bg-white/3 p-3.5"}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <h4 className="text-sm font-semibold">{p.label}</h4>
                {!compact && <span className="text-xs text-muted">{p.sub}</span>}
              </div>
              <RatingDots jobId={jobId} ratingKey={p.rating} value={ratings[p.rating] ?? null} label={p.label} />
            </div>

            {!compact && known.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="label">What we know</span>
                <ul className="flex flex-col gap-1.5">
                  {known.map((k, i) => (
                    <li key={i} className="text-[13px] leading-snug">
                      <span className="text-fg">{k.title}</span>
                      {k.body && <span className="block text-xs text-faint">{k.body}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {!compact && (
                <span className="label">
                  Ask them {asks.length > 0 && <span className="font-mono normal-case">· {asked}/{asks.length}</span>}
                </span>
              )}
              {asks.length === 0 && <p className="text-[13px] text-muted">No questions yet.</p>}
              {asks.map((q, i) => (
                <Question key={`${q.title}-${i}`} q={q} compact={compact} onPatch={(c) => patch(q, c)} onRemove={() => remove(q)} />
              ))}
              {!compact && <AddQuestion onAdd={(t) => add(p.id, t)} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Question({ q, compact, onPatch, onRemove }: { q: PrepItem; compact: boolean; onPatch: (c: Partial<PrepItem>) => void; onRemove: () => void }) {
  const [answer, setAnswer] = useState(q.answer ?? "");
  const [open, setOpen] = useState(!!q.answer);
  return (
    <div className="group flex flex-col gap-1 border-t border-white/7 py-2 first:border-t-0">
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={!!q.done}
          aria-label={q.done ? "Asked" : "Mark as asked"}
          onClick={() => onPatch({ done: !q.done })}
          className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border ${q.done ? "border-green bg-green/20 text-green" : "border-white/25 hover:border-white/50"}`}
        >
          {q.done && <CheckIcon size={12} />}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`text-[13px] leading-snug ${q.done ? "text-muted" : "text-fg"}`}>{q.title}</span>
          {q.body && !compact && <span className="text-xs leading-snug text-faint">Listen for: {q.body}</span>}
        </div>
        {!compact && (
          <button type="button" onClick={onRemove} aria-label="Remove question" className="text-xs text-faint opacity-0 group-hover:opacity-100 hover:text-[#FFB3BA] focus:opacity-100">
            ✕
          </button>
        )}
      </div>
      {open ? (
        <textarea
          className="input ml-7 min-h-[56px] w-[calc(100%-1.75rem)] text-[13px]"
          placeholder="What they said"
          aria-label={`What they said: ${q.title}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onBlur={() => {
            if (answer !== (q.answer ?? "")) onPatch({ answer: answer.trim() || undefined, done: answer.trim() ? true : q.done });
          }}
        />
      ) : (
        <button type="button" className="btn-link ml-7 self-start text-xs" onClick={() => setOpen(true)}>
          + What they said
        </button>
      )}
    </div>
  );
}

function AddQuestion({ onAdd }: { onAdd: (title: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="mt-1 flex gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onAdd(text.trim());
        setText("");
      }}
    >
      <input className="input h-8 text-[13px]" placeholder="Add a question" aria-label="Add a question" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="btn btn-ghost btn-sm shrink-0" aria-label="Add question">
        <PlusIcon size={14} />
      </button>
    </form>
  );
}
