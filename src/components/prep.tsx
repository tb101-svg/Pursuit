"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { addTranscriptAction, linkCallAction, queuePrepAction, savePrepAction, startCallAction } from "@/lib/actions";
import type { Phase, PrepContent, PrepItem, PrepSection } from "@/lib/prep";
import { StarParts } from "./StarLibrary";
import { CopyButton } from "./CopyButton";

// Mirrors PHASES in lib/prep (that module is server-only).
const PHASES: { id: Phase; label: string; sub: string }[] = [
  { id: "research", label: "Research", sub: "The round, the company, its gaps, every interviewer" },
  { id: "prepared", label: "Preparedness", sub: "Make an impression before you walk in, and know your numbers cold" },
  { id: "qa", label: "Q&A", sub: "Questions to expect, with STAR answers from your stories" },
  { id: "them", label: "Questions for them", sub: "Tailored, personal questions, and the close" },
];
import type { RatingKey } from "@/lib/rating";
import { CheckIcon, MicIcon, PencilIcon, PlusIcon, SparkIcon } from "./icons";
import { InterviewThem } from "./InterviewThem";
import { PracticeQuestions } from "./PracticeQuestions";
import { CallSummaryView, TranscriptStatus } from "./CallSummary";
import { CallReviewView, ReviewStatus } from "./CallReview";
import type { CallReview } from "@/lib/review";
import type { CallSummary } from "@/lib/prep";

/**
 * A role's prep sheet: skim top to bottom before the call, or jump to a
 * section. Every section can be edited in place; ticks save straight away.
 */

export interface CallView {
  id: number;
  title: string;
  when: string;
  ended: boolean;
  hasNotes: boolean;
  /** null (none), queued, transcribing, pending (Claude reading), done, failed */
  status: string | null;
  progress: number | null;
  error: string | null;
  recording: boolean;
  summary: CallSummary | null;
  hasTranscript: boolean;
  review: CallReview | null;
  reviewStatus: string | null;
  interviewId: number | null;
}

interface SectionDef {
  id: PrepSection;
  nav: string;
  title: string;
  hint: string;
  fields: { key: "title" | "body" | "note"; label: string; long?: boolean }[];
  tickable?: boolean;
}

export const SECTIONS: SectionDef[] = [ // "them" (Interview them) and "tasks" have their own layouts
  { id: "round", nav: "Round", title: "Round snapshot", hint: "Who, format, time, and what they're testing", fields: [{ key: "title", label: "Label" }, { key: "body", label: "Value" }] },
  { id: "facts", nav: "Company", title: "The company", hint: "Stage, funding, product, buyers, competitors, recent news", fields: [{ key: "title", label: "Label" }, { key: "body", label: "Value" }] },
  { id: "gaps", nav: "Gaps", title: "Where they look exposed", hint: "2–3 specific gaps: these replace canned questions", fields: [{ key: "title", label: "Question to ask" }, { key: "body", label: "Why (evidence)", long: true }] },
  {
    id: "interviewers",
    nav: "Interviewers",
    title: "Interviewers",
    hint: "Background, tenure, likely success criteria, shared connections",
    fields: [{ key: "title", label: "Name & title" }, { key: "body", label: "Profile", long: true }, { key: "note", label: "Likely success criteria" }],
  },
  {
    id: "outreach",
    nav: "Outreach",
    title: "Make an impression first",
    hint: "Drafts only: copy, send yourself, then tick it off",
    fields: [{ key: "title", label: "To whom" }, { key: "body", label: "Draft", long: true }, { key: "note", label: "When / where" }],
    tickable: true,
  },
  { id: "numbers", nav: "Numbers", title: "Numbers sheet", hint: "Expect level-2 and level-3 questions on every number", fields: [{ key: "title", label: "Metric" }, { key: "body", label: "Figure" }, { key: "note", label: "How it was made / why" }] },
  { id: "arc", nav: "Story arc", title: "Story arc & resume risks", hint: "Read your resume as a sceptical hiring manager would", fields: [{ key: "title", label: "Question or risk" }, { key: "body", label: "Your answer", long: true }] },
  { id: "pillars", nav: "Pillars", title: "Four pillars", hint: "Intelligence · Character · Drive · Coachability", fields: [{ key: "title", label: "Pillar" }, { key: "body", label: "Your evidence", long: true }, { key: "note", label: "Thin? Story to fill it" }] },
  { id: "pitch", nav: "Mock pitch", title: "Mock pitch / discovery", hint: "Command of the Message, and three levels deep on pain", fields: [{ key: "title", label: "Element" }, { key: "body", label: "Content", long: true }] },
  { id: "close", nav: "Close", title: "The close", hint: "Ask for concerns, handle them on the spot, agree the next step", fields: [{ key: "title", label: "Question" }], tickable: true },
  {
    id: "openers",
    nav: "Openers",
    title: "Nail these",
    hint: "Word-for-word ready: say them out loud a few times",
    fields: [{ key: "title", label: "Question" }, { key: "body", label: "Your answer", long: true }, { key: "note", label: "Arc / length" }],
  },
  { id: "talking_points", nav: "Talking points", title: "Talking points", hint: "Weave in 2–3, don't dump them all", fields: [{ key: "title", label: "Point" }, { key: "body", label: "Why it matters" }] },
  { id: "stories", nav: "Story bank", title: "Story bank", hint: "Have each at 60–90 seconds", fields: [{ key: "title", label: "They're testing for" }, { key: "body", label: "Your proof point" }] },
  { id: "questions", nav: "Practice Qs", title: "Practice questions", hint: "Likely questions with STAR answers tailored to this role. Practise them out loud", fields: [{ key: "title", label: "Question" }, { key: "body", label: "Best-in-class answer", long: true }, { key: "note", label: "Note" }] },
  { id: "ask", nav: "Role & comp Qs", title: "Role & comp questions", hint: "The seat itself: comp, territory, ramp, why it's open", fields: [{ key: "title", label: "Question" }], tickable: true },
  { id: "checklist", nav: "Day-of", title: "Day-of checklist", hint: "Treat every touchpoint as observed", fields: [{ key: "title", label: "Item" }], tickable: true },
];

/** Which sections each phase of the project shows, in order. */
const PHASE_SECTIONS: Record<Phase, PrepSection[]> = {
  research: ["round", "facts", "gaps", "interviewers", "talking_points"],
  prepared: ["outreach", "numbers", "arc", "pillars", "checklist"],
  qa: ["openers", "questions", "pitch", "stories"],
  them: ["them", "ask", "close"],
};

export interface StarView {
  id: number;
  title: string;
  competencies: string[];
  situation: string;
  task: string;
  action: string;
  result: string;
  spoken: string | null;
}

const phaseProgress = (tasks: PrepItem[], phase: Phase) => {
  const mine = tasks.filter((t) => t.phase === phase);
  return { done: mine.filter((t) => t.done).length, total: mine.length };
};

export function PrepSheet({
  jobId,
  company,
  prep,
  saved,
  updated,
  pending,
  resume,
  calls,
  interviews,
  ratings,
  stars,
  rounds = [],
}: {
  rounds?: { id: number; name: string }[];
  jobId: number;
  company: string;
  ratings: Partial<Record<RatingKey, number | null>>;
  prep: PrepContent;
  saved: boolean;
  updated: string | null;
  pending: boolean;
  resume: { text: string; url: string | null };
  calls: CallView[];
  interviews: { id: number; name: string }[];
  stars: StarView[];
}) {
  const [content, setContent] = useState(prep);
  const [, start] = useTransition();
  // Server refreshes (e.g. Claude's draft arriving) replace local state.
  const [seen, setSeen] = useState(prep);
  if (seen !== prep) {
    setSeen(prep);
    setContent(prep);
  }
  const [phase, setPhase] = useState<Phase>("research");

  const update = (section: PrepSection, items: PrepItem[]) => {
    const next = { ...content, [section]: items };
    setContent(next);
    start(() => savePrepAction(jobId, next));
  };

  const all = content.tasks.length;
  const allDone = content.tasks.filter((t) => t.done).length;
  // "them" (Interview them) has its own layout; everything else is a generic section.
  const THEM_DEF: SectionDef = { id: "them", nav: "Interview them", title: "Interview them", hint: "", fields: [] };
  const defs = PHASE_SECTIONS[phase]
    .map((id) => (id === "them" ? THEM_DEF : SECTIONS.find((d) => d.id === id)))
    .filter((d): d is SectionDef => !!d);

  return (
    <div className="flex flex-col gap-[18px]">
      <PrepHeader jobId={jobId} saved={saved} updated={updated} pending={pending} focus={content.focus ?? null} interviews={interviews} />

      {/* The project: four phases, each with its own checklist. */}
      <section className="glass flex flex-col gap-3 rounded-xl p-[18px]" aria-label="Prep progress">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-semibold">Prep project</h2>
          <span className="font-mono text-xs text-muted">
            {allDone}/{all} done
          </span>
          <span className="ml-auto hidden text-[13px] text-faint sm:inline">Run the interview like a sales cycle.</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-accent shadow-[0_0_10px_#6E8BFF]" style={{ width: `${all ? (allDone / all) * 100 : 0}%` }} />
        </div>
        <div role="tablist" aria-label="Prep phases" className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {PHASES.map((p, i) => {
            const { done, total } = phaseProgress(content.tasks, p.id);
            const active = p.id === phase;
            const complete = total > 0 && done === total;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPhase(p.id)}
                className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors ${
                  active ? "border-accent/60 bg-accent/12" : "border-white/8 bg-white/3 hover:bg-white/6"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`flex size-5 items-center justify-center rounded-full font-mono text-[11px] ${complete ? "bg-green/25 text-green" : "bg-white/10 text-fg-2"}`}>
                    {complete ? <CheckIcon size={11} /> : i + 1}
                  </span>
                  {p.label}
                  <span className="ml-auto font-mono text-xs font-normal text-muted">
                    {done}/{total}
                  </span>
                </span>
                <span className="h-1 overflow-hidden rounded-full bg-white/8">
                  <span className={`block h-full rounded-full ${complete ? "bg-green" : "bg-accent"}`} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                </span>
                <span className="hidden text-xs leading-snug text-faint md:block">{p.sub}</span>
              </button>
            );
          })}
        </div>
      </section>

      <PhaseTasks phase={phase} tasks={content.tasks} onChange={(tasks) => update("tasks", tasks)} />

      {defs.map((def) =>
        def.id === "them" ? (
          <section key="them" id="prep-them" className="glass flex scroll-mt-4 flex-col gap-3.5 rounded-xl border-accent/25 p-[18px] md:p-[22px]">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-[15px] font-semibold">Interview them</h3>
              <span className="text-[13px] text-faint">You&apos;re assessing them as much as they&apos;re assessing you. Rate each as you learn more; it feeds this role&apos;s tier.</span>
            </div>
            <InterviewThem jobId={jobId} items={content.them} ratings={ratings} onChange={(items) => update("them", items)} />
          </section>
        ) : def.id === "stories" && content.stories.length === 0 ? null : (
          <div key={def.id} className="contents">
            <Section jobId={jobId} def={def} items={content[def.id]} onChange={(items) => update(def.id, items)} company={company} />
            {def.id === "questions" && <StarDrawer stars={stars} />}
          </div>
        ),
      )}

      <ResumePanel resume={resume} />
      <CallsPanel jobId={jobId} calls={calls} rounds={rounds} />
    </div>
  );
}

/** A phase's checklist, plus room for your own to-dos. */
function PhaseTasks({ phase, tasks, onChange }: { phase: Phase; tasks: PrepItem[]; onChange: (tasks: PrepItem[]) => void }) {
  const [text, setText] = useState("");
  const mine = tasks.map((t, i) => ({ t, i })).filter(({ t }) => t.phase === phase);
  const label = PHASES.find((p) => p.id === phase)!;
  return (
    <section className="glass flex flex-col gap-2 rounded-xl p-[18px]" aria-label={`${label.label} checklist`}>
      <div className="flex items-baseline gap-3">
        <h3 className="text-[15px] font-semibold">{label.label} checklist</h3>
        <span className="text-[13px] text-faint">{label.sub}</span>
      </div>
      <ul className="flex flex-col">
        {mine.map(({ t, i }) => (
          <li key={i} className="group flex items-start gap-3 border-t border-white/7 py-2 text-sm first:border-t-0">
            <label className="flex flex-1 cursor-pointer items-start gap-3">
              <input type="checkbox" className="sr-only" checked={!!t.done} onChange={() => onChange(tasks.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
              <span aria-hidden="true" className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border ${t.done ? "border-green bg-green/20 text-green" : "border-white/25"}`}>
                {t.done && <CheckIcon size={12} />}
              </span>
              <span className={t.done ? "text-muted line-through" : ""}>{t.title}</span>
            </label>
            <button
              type="button"
              aria-label={`Remove “${t.title}”`}
              className="text-xs text-faint opacity-0 group-hover:opacity-100 hover:text-[#FFB3BA] focus:opacity-100"
              onClick={() => onChange(tasks.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onChange([...tasks, { title: text.trim(), phase, done: false }]);
          setText("");
        }}
      >
        <input className="input h-8 text-[13px]" placeholder="Add a to-do for this phase" aria-label="Add a to-do" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-ghost btn-sm shrink-0" aria-label="Add to-do">
          <PlusIcon size={14} />
        </button>
      </form>
    </section>
  );
}

/** Your STAR stories, one click away while you prep answers. */
function StarDrawer({ stars }: { stars: StarView[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  if (stars.length === 0) return null;
  const tags = [...new Set(stars.flatMap((s) => s.competencies))];
  const shown = filter ? stars.filter((s) => s.competencies.includes(filter)) : stars;
  return (
    <section id="prep-star" className="glass flex scroll-mt-4 flex-col gap-3 rounded-xl p-[18px] md:p-[22px]">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[15px] font-semibold">Your STAR stories</h3>
        <span className="text-[13px] text-faint">The library every answer is built from</span>
        <Link href="/prep#star" className="btn-link ml-auto text-[13px]">
          Edit in Prep library
        </Link>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFilter(null)} className={`chip px-2.5 py-1 ${!filter ? "border-white/40 bg-white/12 text-fg" : ""}`}>
          All {stars.length}
        </button>
        {tags.map((t) => (
          <button key={t} type="button" onClick={() => setFilter(t === filter ? null : t)} className={`chip px-2.5 py-1 ${t === filter ? "border-accent/60 bg-accent/15 text-fg" : ""}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="flex flex-col">
        {shown.map((s) => (
          <details key={s.id} className="group border-t border-white/7 first:border-t-0 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-center gap-2 py-2.5 text-sm font-medium">
              <span className="text-faint transition-transform group-open:rotate-90">▸</span>
              {s.title}
            </summary>
            <div className="flex flex-col gap-3 pb-3 pl-5 text-[13px]">
              <StarParts star={s} />
              {s.spoken && <p className="rounded-lg border border-accent/25 bg-accent/6 p-3 text-[14px] leading-relaxed whitespace-pre-line">{s.spoken}</p>}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}


// ── Header: Claude + call mode ──────────────────────────────────────────────

function PrepHeader({
  jobId,
  saved,
  updated,
  pending,
  focus,
  interviews,
}: {
  jobId: number;
  saved: boolean;
  updated: string | null;
  pending: boolean;
  focus: string | null;
  interviews: { id: number; name: string }[];
}) {
  const [busy, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [focusText, setFocusText] = useState("");
  const [interview, setInterview] = useState<string>(interviews[0] ? String(interviews[0].id) : "");

  return (
    <section className="glass flex flex-col gap-3 rounded-xl p-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold">Interview prep</h2>
          <p className="text-[13px] text-muted">
            {pending
              ? "Claude is queued to tailor this sheet. Press Process now on the home screen, or ask Claude to process your Pursuit queue."
              : saved
                ? `Updated ${updated}${focus ? ` · tailored for: ${focus}` : ""}`
                : "Started from your library. Have Claude tailor it to this role, or edit any section."}
          </p>
        </div>
        {!pending && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking((v) => !v)}>
            <SparkIcon size={14} /> {saved ? "Redraft with Claude" : "Prepare with Claude"}
          </button>
        )}
        <div className="flex items-center gap-2">
          {interviews.length > 0 && (
            <select className="input h-8 w-auto max-w-[180px] py-0 pr-7 pl-2.5 text-[13px]" value={interview} onChange={(e) => setInterview(e.target.value)} aria-label="Which interview">
              {interviews.map((iv) => (
                <option key={iv.id} value={iv.id}>
                  {iv.name}
                </option>
              ))}
              <option value="">Other call</option>
            </select>
          )}
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => start(() => startCallAction(jobId, interview ? Number(interview) : null))}>
            <MicIcon size={14} /> {busy ? "Opening…" : "Call mode"}
          </button>
        </div>
      </div>
      {asking && !pending && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              await queuePrepAction(jobId, focusText);
              setAsking(false);
            });
          }}
        >
          <input
            className="input"
            value={focusText}
            onChange={(e) => setFocusText(e.target.value)}
            placeholder="Optional focus, e.g. “Panel with the VP Sales and a peer AE”"
            aria-label="Focus for Claude"
          />
          <button type="submit" className="btn btn-primary shrink-0" disabled={busy}>
            {saved ? "Queue redraft" : "Queue for Claude"}
          </button>
        </form>
      )}
      {asking && saved && <p className="text-xs text-faint">A redraft replaces the sheet (your ticks are kept). Edit sections afterwards as you like.</p>}
    </section>
  );
}

// ── Sections ────────────────────────────────────────────────────────────────

function Section({ jobId, def, items, onChange, company }: { jobId: number; def: SectionDef; items: PrepItem[]; onChange: (items: PrepItem[]) => void; company: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <section id={`prep-${def.id}`} className="glass flex scroll-mt-4 flex-col gap-3.5 rounded-xl p-[18px] md:p-[22px]">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[15px] font-semibold">{def.title}</h3>
        <span className="hidden text-[13px] text-faint sm:inline">{def.hint}</span>
        {def.tickable && items.length > 0 && (
          <span className="font-mono text-xs text-muted">
            {items.filter((i) => i.done).length}/{items.length}
          </span>
        )}
        <button type="button" className="btn-link ml-auto inline-flex items-center gap-1 text-[13px]" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : <><PencilIcon size={13} /> Edit</>}
        </button>
      </div>
      {editing ? (
        <ItemsEditor def={def} items={items} onSave={(next) => { onChange(next); setEditing(false); }} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">{EMPTY[def.id].replace("[company]", company)}</p>
      ) : (
        <SectionView jobId={jobId} def={def} items={items} onTick={(i) => onChange(items.map((it, j) => (j === i ? { ...it, done: !it.done } : it)))} />
      )}
    </section>
  );
}

const EMPTY: Record<PrepSection, string> = {
  them: "",
  facts: "No facts yet. Research the role (Overview) or have Claude prepare this sheet.",
  openers: "Add your standard answers in Prep library, or have Claude tailor them for [company].",
  talking_points: "Company-specific hooks (acquisitions, launches, local investment) go here. Claude finds these when it prepares the sheet.",
  stories: "Add your story bank in Prep library.",
  questions: "No likely questions yet.",
  ask: "No questions yet.",
  checklist: "No checklist yet.",
  round: "Who's interviewing, the format and what they're testing. Prepare with Claude, or add it yourself.",
  gaps: "2–3 places the business looks exposed. Claude finds these when it prepares the sheet.",
  interviewers: "A profile of each interviewer: background, tenure, likely success criteria. Name them in the focus when you ask Claude to prepare.",
  outreach: "Your pre-interview note to the hiring manager and 2–4 multi-thread notes. Claude drafts them; you send them.",
  numbers: "Every number on your resume, and how it was made. Claude builds this from your resume and STAR stories.",
  arc: "Your story arc, and the resume questions a sceptical hiring manager would ask.",
  pillars: "Intelligence, Character, Drive, Coachability: your evidence for each.",
  pitch: "Only for role-play rounds: the pitch and a discovery ladder three levels deep on pain.",
  close: "No closing questions yet.",
  tasks: "",
};

function SectionView({ jobId, def, items, onTick }: { jobId: number; def: SectionDef; items: PrepItem[]; onTick: (i: number) => void }) {
  switch (def.id) {
    case "facts":
    case "round":
    case "numbers":
      return (
        <div className={`grid grid-cols-1 gap-2.5 sm:grid-cols-2 ${def.id === "numbers" ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
          {items.map((f, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-lg border border-white/7 bg-white/4 p-3">
              <span className="label">{f.title}</span>
              <span className={`leading-snug font-medium ${def.id === "numbers" ? "font-mono text-base" : "text-sm"}`}>{f.body}</span>
              {f.note && <span className="text-xs leading-snug text-faint">{f.note}</span>}
            </div>
          ))}
        </div>
      );
    case "gaps":
    case "interviewers":
    case "arc":
    case "pitch":
      return <DetailsList items={items} noteLabel={def.id === "interviewers" ? "Likely success criteria" : undefined} open={def.id === "gaps"} />;
    case "pillars":
      return (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {items.map((p, i) => (
            <div key={i} className={`flex flex-col gap-1.5 rounded-lg border p-3 ${p.note ? "border-amber/30 bg-amber/6" : "border-white/7 bg-white/4"}`}>
              <span className="text-sm font-semibold">{p.title}</span>
              <span className="text-[13px] leading-snug whitespace-pre-line text-fg-2">{p.body}</span>
              {p.note && <span className="text-xs text-amber-soft">{p.note}</span>}
            </div>
          ))}
        </div>
      );
    case "outreach":
      return <OutreachList items={items} onTick={onTick} />;
    case "openers":
      return (
        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
          {items.map((o, i) => (
            <article key={i} className="flex flex-col gap-2.5 rounded-lg border border-accent/25 bg-accent/6 p-4">
              <h4 className="text-sm font-semibold text-accent-soft">“{o.title}”</h4>
              <p className="text-[15px] leading-relaxed whitespace-pre-line text-fg">{o.body}</p>
              {o.note && <p className="border-t border-white/8 pt-2.5 text-[13px] text-muted">{o.note}</p>}
            </article>
          ))}
        </div>
      );
    case "talking_points":
      return (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {items.map((t, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-lg border border-white/7 bg-white/4 p-3">
              <span className="text-sm font-semibold">{t.title}</span>
              {t.body && <span className="text-[13px] leading-snug text-fg-2">{t.body}</span>}
            </div>
          ))}
        </div>
      );
    case "stories":
      return (
        <div className="overflow-hidden rounded-lg border border-white/8">
          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)] bg-white/4 px-4 py-2 sm:grid">
            <span className="label">They're testing for</span>
            <span className="label">Your proof point</span>
          </div>
          {items.map((s, i) => (
            <div key={i} className="grid grid-cols-1 gap-1 border-t border-white/7 px-4 py-2.5 text-sm first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3 sm:first:border-t">
              <span className="font-medium">{s.title}</span>
              <span className="text-fg-2">{s.body}</span>
            </div>
          ))}
        </div>
      );
    case "questions":
      return <PracticeQuestions jobId={jobId} items={items} />;
    default:
      return <TickList items={items} numbered={def.id === "ask"} onTick={onTick} />;
  }
}

/** Expandable question / answer (or name / profile) rows. */
function DetailsList({ items, noteLabel, open }: { items: PrepItem[]; noteLabel?: string; open?: boolean }) {
  return (
    <div className="flex flex-col">
      {items.map((q, i) => (
        <details key={i} open={open} className="group border-t border-white/7 first:border-t-0 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer items-start gap-2 py-2.5 text-sm font-medium">
            <span className="mt-px text-faint transition-transform group-open:rotate-90">▸</span>
            {q.title}
          </summary>
          <div className="flex flex-col gap-1.5 pb-3 pl-5 text-[13px] leading-relaxed">
            {q.body && <p className="whitespace-pre-line text-fg-2">{q.body}</p>}
            {q.note && (
              <p className="text-muted">
                {noteLabel && <span className="font-semibold text-fg-2">{noteLabel}: </span>}
                {q.note}
              </p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/** Drafts to send yourself: copy, send, tick. */
function OutreachList({ items, onTick }: { items: PrepItem[]; onTick: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((o, i) => (
        <div key={i} className={`flex flex-col gap-2 rounded-lg border p-3 ${o.done ? "border-green/30 bg-green/5" : "border-white/8 bg-white/3"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{o.title}</span>
            {o.note && <span className="text-xs text-faint">{o.note}</span>}
            <span className="ml-auto flex items-center gap-2">
              {o.body && <CopyButton text={o.body} label="Copy" />}
              <button type="button" onClick={() => onTick(i)} className={`chip px-2.5 py-1 ${o.done ? "border-green/50 text-green" : "hover:border-white/30"}`}>
                {o.done ? "✓ Sent" : "Mark sent"}
              </button>
            </span>
          </div>
          {o.body && !o.done && <p className="text-[13px] leading-relaxed whitespace-pre-line text-fg-2">{o.body}</p>}
        </div>
      ))}
      <p className="text-xs text-faint">Pursuit never sends anything for you.</p>
    </div>
  );
}

export function TickList({ items, numbered, onTick }: { items: PrepItem[]; numbered?: boolean; onTick: (i: number) => void }) {
  return (
    <ul className="flex flex-col">
      {items.map((it, i) => (
        <li key={i} className="border-t border-white/7 first:border-t-0">
          <label className="flex cursor-pointer items-start gap-3 py-2 text-sm">
            <input type="checkbox" className="sr-only" checked={!!it.done} onChange={() => onTick(i)} />
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border ${it.done ? "border-green bg-green/20 text-green" : "border-white/25"}`}
            >
              {it.done && <CheckIcon size={12} />}
            </span>
            {numbered && <span className="w-4 shrink-0 font-mono text-xs leading-5 text-faint">{i + 1}</span>}
            <span className={it.done ? "text-muted line-through" : ""}>{it.title}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function ItemsEditor({ def, items, onSave }: { def: SectionDef; items: PrepItem[]; onSave: (items: PrepItem[]) => void }) {
  const [draft, setDraft] = useState<PrepItem[]>(items.length ? items : [{ title: "" }]);
  const set = (i: number, key: keyof PrepItem, value: string) => setDraft((d) => d.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <div className="flex flex-col gap-3">
      {draft.map((it, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-white/8 bg-black/15 p-3">
          {def.fields.map((f) =>
            f.long ? (
              <textarea key={f.key} className="input min-h-[140px]" aria-label={f.label} placeholder={f.label} value={it[f.key] ?? ""} onChange={(e) => set(i, f.key, e.target.value)} />
            ) : (
              <input key={f.key} className="input" aria-label={f.label} placeholder={f.label} value={it[f.key] ?? ""} onChange={(e) => set(i, f.key, e.target.value)} />
            ),
          )}
          <div className="flex gap-3 text-xs">
            <button type="button" className="btn-link" onClick={() => move(i, -1)} disabled={i === 0}>
              Move up
            </button>
            <button type="button" className="btn-link" onClick={() => move(i, 1)} disabled={i === draft.length - 1}>
              Move down
            </button>
            <button type="button" className="ml-auto text-[#FFB3BA] hover:underline" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft((d) => [...d, { title: "" }])}>
          <PlusIcon size={14} /> Add
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm ml-auto"
          onClick={() => onSave(draft.filter((it) => it.title.trim() || it.body?.trim()).map((it) => ({ ...it, title: it.title.trim() })))}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ── Resume ──────────────────────────────────────────────────────────────────

export function ResumeText({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1 text-[13px] leading-relaxed">
      {text.split("\n").map((line, i) =>
        !line.trim() ? (
          <div key={i} className="h-2" />
        ) : /^[A-Z0-9][A-Z0-9 &,.()/'’-]{3,}(·|$)/.test(line) ? (
          <p key={i} className="pt-1 text-sm font-semibold text-fg">
            {line}
          </p>
        ) : (
          <p key={i} className={line.startsWith("•") ? "pl-3 text-fg-2" : "text-muted"}>
            {line}
          </p>
        ),
      )}
    </div>
  );
}

function ResumePanel({ resume }: { resume: { text: string; url: string | null } }) {
  return (
    <details id="prep-resume" className="glass scroll-mt-4 rounded-xl p-[18px] md:p-[22px] [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer items-center gap-3">
        <h3 className="text-[15px] font-semibold">Your resume</h3>
        <span className="text-[13px] text-muted">(expand)</span>
        <span className="ml-auto flex gap-3 text-[13px]">
          {resume.url && (
            <a href={resume.url} target="_blank" rel="noreferrer" className="btn-link">
              Open in Google Drive
            </a>
          )}
          <Link href="/prep#resume" className="btn-link">
            Edit
          </Link>
        </span>
      </summary>
      <div className="mt-4 max-w-[860px]">{resume.text ? <ResumeText text={resume.text} /> : <p className="text-sm text-muted">No resume yet. Add it in Prep library.</p>}</div>
    </details>
  );
}

// ── Calls ───────────────────────────────────────────────────────────────────

function CallsPanel({ jobId, calls, rounds }: { jobId: number; calls: CallView[]; rounds: { id: number; name: string }[] }) {
  return (
    <section id="prep-calls" className="glass flex scroll-mt-4 flex-col gap-3 rounded-xl p-[18px] md:p-[22px]">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[15px] font-semibold">Calls</h3>
        <span className="hidden text-[13px] text-faint sm:inline">Notes, recordings and transcripts from your conversations</span>
      </div>
      {calls.length === 0 ? (
        <p className="text-sm text-muted">No calls yet. Open Call mode when the interview starts to take timestamped notes and, on this computer, record it.</p>
      ) : (
        calls.map((c) => <CallRow key={c.id} jobId={jobId} call={c} rounds={rounds} />)
      )}
    </section>
  );
}

function CallRow({ jobId, call, rounds }: { jobId: number; call: CallView; rounds: { id: number; name: string }[] }) {
  const [adding, setAdding] = useState(false);
  const [linking, startLink] = useTransition();
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 border-t border-white/7 pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/calls/${call.id}`} className="font-medium text-fg hover:underline">
          {call.title}
        </Link>
        <span className="text-muted">· {call.when}</span>
        {!call.ended && <span className="chip border-red/40 text-[#FFB3BA]">In progress</span>}
        {call.hasNotes && <span className="chip">Notes</span>}
        {call.interviewId ? (
          <Link href={`/jobs/${jobId}/interviews/${call.interviewId}`} className="chip border-accent/40 text-accent-soft hover:border-accent/70">
            {rounds.find((r) => r.id === call.interviewId)?.name.split(":")[0] ?? "Interview"} →
          </Link>
        ) : (
          rounds.length > 0 && (
            <select
              aria-label="Link this call to an interview"
              className="h-7 cursor-pointer rounded-md border border-amber/40 bg-black/25 px-1.5 text-xs text-amber-soft"
              value=""
              disabled={linking}
              onChange={(e) => startLink(() => linkCallAction(call.id, Number(e.target.value)))}
            >
              <option value="" disabled>
                Link to interview…
              </option>
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name.slice(0, 70)}
                </option>
              ))}
            </select>
          )
        )}
        {call.recording && (
          <a href={`/api/calls/${call.id}/recording`} download={`call-${call.id}.webm`} className="chip hover:border-white/30 hover:text-fg">
            Download recording
          </a>
        )}
        <TranscriptStatus callId={call.id} status={call.status} progress={call.progress} error={call.error} hasRecording={call.recording} />
        {(call.status === null || call.status === "failed") && (
          <button type="button" className="btn-link ml-auto text-[13px]" onClick={() => setAdding((v) => !v)}>
            Paste a transcript
          </button>
        )}
      </div>
      {(call.status === "done" || call.reviewStatus) && !call.review && (
        <div className="flex flex-wrap items-center gap-2">
          <ReviewStatus callId={call.id} status={call.reviewStatus} hasTranscript={call.hasTranscript} />
        </div>
      )}
      {call.review && <CallReviewView review={call.review} />}
      {call.summary && <CallSummaryView summary={call.summary} />}
      {call.recording && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- your own call recording; the transcript is added separately
        <audio controls preload="none" src={`/api/calls/${call.id}/recording`} className="h-9 w-full max-w-[520px]" />
      )}
      {adding && (
        <TranscriptForm
          text={text}
          setText={setText}
          busy={busy}
          onSubmit={() =>
            start(async () => {
              await addTranscriptAction(call.id, text);
              setAdding(false);
            })
          }
        />
      )}
    </div>
  );
}

export function TranscriptForm({ text, setText, busy, onSubmit }: { text: string; setText: (v: string) => void; busy: boolean; onSubmit: () => void }): ReactNode {
  const loadFile = async (file: File | undefined) => {
    if (file) setText(await file.text());
  };
  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="input min-h-[160px] font-mono text-xs"
        placeholder="Paste the transcript (Zoom: Recordings → Audio transcript; Meet: the transcript Google Doc), or choose the .vtt / .txt file below."
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Transcript"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".vtt,.txt,.srt,.md" onChange={(e) => loadFile(e.target.files?.[0])} className="text-xs text-muted file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1.5 file:text-fg" />
        <button type="button" className="btn btn-primary btn-sm ml-auto" disabled={busy || !text.trim()} onClick={onSubmit}>
          {busy ? "Saving…" : "Save for Claude to read"}
        </button>
      </div>
    </div>
  );
}
