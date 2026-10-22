"use client";

import { useState, useTransition } from "react";
import { deleteStarAction, polishStarAction, saveStarAction, undoStarPolishAction } from "@/lib/actions";
import type { StarStory } from "@/lib/star";
import { PencilIcon, PlusIcon, SparkIcon } from "./icons";

/** Your STAR stories: real examples every practice answer is built from. */

const PARTS = [
  { key: "situation", letter: "S", label: "Situation", prompt: "Where were you, when, and what made it hard? One or two sentences of context." },
  { key: "task", letter: "T", label: "Task", prompt: "What were YOU responsible for? The goal, quota or problem you owned." },
  { key: "action", letter: "A", label: "Action", prompt: "What did YOU do? 3–4 concrete steps, in order, with the why behind each. This is where most answers are weak: be specific." },
  { key: "result", letter: "R", label: "Result", prompt: "Lead with a number (ARR, %, rank, days saved), then the impact, then what it led to." },
] as const;

type Draft = Pick<StarStory, "title" | "competencies" | "situation" | "task" | "action" | "result" | "lesson"> & { id?: number };

export function StarLibrary({ stories, competencies }: { stories: StarStory[]; competencies: readonly string[] }) {
  const [adding, setAdding] = useState(false);
  const [busy, start] = useTransition();
  const covered = new Set(stories.flatMap((s) => s.competencies));
  const missing = competencies.filter((c) => !covered.has(c));
  const pending = stories.some((s) => s.polish_status === "pending");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
          <PlusIcon size={14} /> Add a story
        </button>
        {stories.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy || pending} onClick={() => start(() => polishStarAction("all"))}>
            <SparkIcon size={14} /> {pending ? "Claude is polishing…" : "Polish all with Claude"}
          </button>
        )}
      </div>
      {missing.length > 0 && (
        <p className="rounded-lg border border-amber/25 bg-amber/8 px-3 py-2 text-[13px] text-amber-soft">
          No story yet for: {missing.join(" · ")}. Interviewers often ask about these; add one for each you can.
        </p>
      )}
      {adding && <StarForm competencies={competencies} onDone={() => setAdding(false)} />}
      {stories.map((s) => (
        <StarCard key={s.id} story={s} competencies={competencies} />
      ))}
    </div>
  );
}

function StarCard({ story: s, competencies }: { story: StarStory; competencies: readonly string[] }) {
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  if (editing) return <StarForm story={s} competencies={competencies} onDone={() => setEditing(false)} />;
  const placeholders = [s.situation, s.task, s.action, s.result].join(" ").match(/\[add:[^\]]*\]/g)?.length ?? 0;
  return (
    <details className="rounded-lg border border-white/8 bg-white/3 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{s.title}</span>
        {s.competencies.map((c) => (
          <span key={c} className="chip py-0">
            {c}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {placeholders > 0 && <span className="chip border-amber/40 py-0 text-amber-soft">{placeholders} to fill in</span>}
          {s.polish_status === "pending" && <span className="chip border-accent/40 py-0 text-accent-soft">Polishing…</span>}
          {s.polish_status === "done" && <span className="chip border-green/40 py-0 text-green">Polished</span>}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-[13px] leading-relaxed">
        <StarParts star={s} />
        {s.lesson && (
          <p className="text-muted">
            <span className="font-semibold text-fg-2">Lesson: </span>
            {s.lesson}
          </p>
        )}
        {s.spoken && (
          <div className="flex flex-col gap-1 rounded-lg border border-accent/25 bg-accent/6 p-3">
            <span className="label">Say it like this (60–90 sec)</span>
            <p className="text-[14px] leading-relaxed whitespace-pre-line text-fg">{s.spoken}</p>
          </div>
        )}
        {s.gaps.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="label">Make it stronger: answer these, then polish again</span>
            <ul className="flex flex-col gap-0.5 text-amber-soft">
              {s.gaps.map((g, i) => (
                <li key={i}>• {g}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-link inline-flex items-center gap-1" onClick={() => setEditing(true)}>
            <PencilIcon size={13} /> Edit
          </button>
          <button type="button" className="btn-link inline-flex items-center gap-1" disabled={busy || s.polish_status === "pending"} onClick={() => start(() => polishStarAction(s.id))}>
            <SparkIcon size={13} /> {s.polish_status === "done" ? "Polish again" : "Polish with Claude"}
          </button>
          {s.can_undo && (
            <button type="button" className="btn-link" disabled={busy} onClick={() => start(() => undoStarPolishAction(s.id))}>
              Undo polish
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

/** S / T / A / R blocks, with [add: …] gaps highlighted. */
export function StarParts({ star }: { star: { situation: string; task: string; action: string; result: string } }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {PARTS.map((p) => (
        <div key={p.key} className="flex gap-2.5 rounded-md border border-white/7 bg-black/15 p-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/20 font-mono text-xs font-bold text-accent-soft">{p.letter}</span>
          <p className="min-w-0 whitespace-pre-line text-fg-2">
            <Highlight text={star[p.key] || "—"} />
          </p>
        </div>
      ))}
    </div>
  );
}

function Highlight({ text }: { text: string }) {
  const parts = text.split(/(\[add:[^\]]*\])/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("[add:") ? (
          <mark key={i} className="rounded bg-amber/20 px-1 text-amber-soft">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function StarForm({ story, competencies, onDone }: { story?: StarStory; competencies: readonly string[]; onDone: () => void }) {
  const [d, setD] = useState<Draft>(
    story
      ? { id: story.id, title: story.title, competencies: story.competencies, situation: story.situation, task: story.task, action: story.action, result: story.result, lesson: story.lesson }
      : { title: "", competencies: [], situation: "", task: "", action: "", result: "", lesson: "" },
  );
  const [busy, start] = useTransition();
  const toggle = (c: string) => setD({ ...d, competencies: d.competencies.includes(c) ? d.competencies.filter((x) => x !== c) : [...d.competencies, c] });
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-accent/30 bg-white/3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await saveStarAction(d);
          onDone();
        });
      }}
    >
      <input className="input" placeholder="Short title, e.g. “Turned around a stalled launch in six weeks”" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required aria-label="Story title" />
      <div className="flex flex-col gap-1.5">
        <span className="label">What it proves</span>
        <div className="flex flex-wrap gap-1.5">
          {competencies.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              aria-pressed={d.competencies.includes(c)}
              className={`chip px-2.5 py-1 ${d.competencies.includes(c) ? "border-accent/60 bg-accent/15 text-fg" : "hover:border-white/30"}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      {PARTS.map((p) => (
        <label key={p.key} className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">
            <span className="font-mono text-accent-soft">{p.letter}</span> · {p.label}
          </span>
          <span className="text-xs text-faint">{p.prompt}</span>
          <textarea
            className={`input text-[13px] ${p.key === "action" ? "min-h-[130px]" : "min-h-[70px]"}`}
            value={d[p.key]}
            onChange={(e) => setD({ ...d, [p.key]: e.target.value })}
          />
        </label>
      ))}
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">Lesson (optional)</span>
        <input className="input" value={d.lesson} onChange={(e) => setD({ ...d, lesson: e.target.value })} placeholder="What you'd do again, or differently" />
      </label>
      <div className="flex items-center gap-2">
        {story && (
          <button
            type="button"
            className="text-xs text-[#FFB3BA] hover:underline"
            onClick={() => {
              if (confirm(`Delete “${story.title}”?`))
                start(async () => {
                  await deleteStarAction(story.id);
                  onDone();
                });
            }}
          >
            Delete
          </button>
        )}
        <span className="ml-auto text-xs text-faint">Rough notes are fine: Polish with Claude tidies them without adding facts.</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
