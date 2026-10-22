"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import {
  addContactAction,
  addInterviewAction,
  addNoteAction,
  addTaskAction,
  completeInterviewAction,
  completeTaskAction,
  deleteJobAction,
  queueResearchAction,
  saveNotesAction,
  setStageAction,
  setTaskTypeAction,
  updateFieldAction,
  updateTaskAction,
} from "@/lib/actions";
import Link from "next/link";
import { Logo } from "./Logo";
import { PARKED, STAGES, STAGE_LABEL, type Stage } from "@/lib/types";
import type { NextStep } from "@/lib/view";
import { CalendarIcon, CheckIcon, PencilIcon, PlusIcon } from "./icons";
import { AttachEvent } from "./EditRole";

// ── Tabs ────────────────────────────────────────────────────────────────────

export function JobTabs({ tabs, initial }: { tabs: { id: string; label: string; content: ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(tabs.some((t) => t.id === initial) ? initial! : tabs[0].id);
  return (
    <>
      <div role="tablist" aria-label="Role sections" className="flex gap-1 overflow-x-auto border-b border-white/8 px-4 md:px-8">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={t.id === active}
            aria-controls={`panel-${t.id}`}
            onClick={() => setActive(t.id)}
            className={`-mb-px h-11 shrink-0 border-b-2 px-3.5 text-sm whitespace-nowrap transition-colors ${
              t.id === active ? "border-accent font-semibold text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={`tab-${t.id}`} hidden={t.id !== active} className="px-4 py-5 md:px-8 md:py-6">
          {t.content}
        </div>
      ))}
    </>
  );
}

// ── Stage ───────────────────────────────────────────────────────────────────

export function StageSelect({ jobId, stage }: { jobId: number; stage: Stage }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-[13px] text-muted">
      Stage
      <select
        className="input h-9 w-auto py-0 pr-8 pl-3 text-[13px]"
        value={stage}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const reason =
            next === "closed"
              ? (prompt("Why did it close? (optional)") ?? undefined)
              : next === "later"
                ? (prompt("Why try later? e.g. no suitable role open, role filled (optional)") ?? undefined)
                : undefined;
          start(() => setStageAction(jobId, next, reason));
        }}
      >
        <optgroup label="In progress">
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </optgroup>
        <optgroup label="Closed">
          {PARKED.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

// ── Next step banner ────────────────────────────────────────────────────────

export function NextStepBanner({ next }: { next: NextStep }) {
  const [pending, start] = useTransition();
  const done = () =>
    start(async () => {
      if (next.kind === "task" && next.id) await completeTaskAction(next.id);
      if (next.kind === "interview" && next.id) await completeInterviewAction(next.id, null);
    });
  const tone =
    next.tone === "today"
      ? "border-accent/40 bg-accent/12"
      : next.tone === "overdue"
        ? "border-red/35 bg-red/10"
        : next.tone === "stale"
          ? "border-amber/30 bg-amber/10"
          : "border-white/10 bg-white/5";
  return (
    <div className={`flex items-center gap-3 rounded-[10px] border py-2.5 pr-3 pl-4 backdrop-blur-xl ${tone}`}>
      <CalendarIcon className="text-[#8FA6FF]" />
      <span className="text-sm">
        <strong className="font-semibold">Next: </strong>
        <span className="text-fg-2">{next.text}</span>
      </span>
      <div className="flex-1" />
      {next.kind && (
        <button type="button" className="btn btn-primary btn-sm" onClick={done} disabled={pending}>
          <CheckIcon size={14} />
          Mark done
        </button>
      )}
    </div>
  );
}

// ── Next steps (tasks) ──────────────────────────────────────────────────────

export interface TaskView {
  id: number;
  title: string;
  due: string | null;
  done: boolean;
  overdue: boolean;
  source: string;
  kind: "task" | "call";
  dueIso: string | null;
}

const STEP_TYPES = [
  { id: "task", label: "Step", placeholder: "Add a next step, e.g. “Send references to Priya”" },
  { id: "call", label: "Call", placeholder: "Who's the call with? e.g. “Intro call with Alex (recruiter)”" },
  { id: "interview", label: "Interview", placeholder: "Which round? e.g. “2nd interview with the VP Sales”" },
] as const;

/** Type picker shared by next steps and notes. */
function TypePicker<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label="Type" className="flex shrink-0 rounded-lg border border-white/12 bg-black/25 p-[3px]">
      <input type="hidden" name={name} value={value} />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={`h-[30px] rounded-md px-2.5 text-[13px] font-medium ${o.id === value ? "bg-white/14 text-fg" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TaskList({ jobId, tasks }: { jobId: number; tasks: TaskView[] }) {
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done).slice(0, 3);
  const [type, setType] = useState<(typeof STEP_TYPES)[number]["id"]>("task");
  const [error, formAction, pending] = useActionState(async (prev: string | null, fd: FormData) => {
    const err = await addTaskAction(prev, fd);
    if (!err) setType("task");
    return err;
  }, null);
  const current = STEP_TYPES.find((t) => t.id === type)!;
  return (
    <div className="flex flex-col gap-2">
      {open.length === 0 && <p className="text-sm text-muted">No open next steps.</p>}
      {[...open, ...done].map((t) => (
        <TaskRow key={t.id} task={t} />
      ))}
      <form action={formAction} className="mt-1 flex flex-col gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          <TypePicker name="type" value={type} options={STEP_TYPES} onChange={setType} />
          <label className="sr-only" htmlFor={`task-${jobId}`}>
            New next step
          </label>
          <input
            id={`task-${jobId}`}
            name="title"
            className="input min-w-0 flex-1 basis-full sm:basis-auto"
            placeholder={current.placeholder}
            autoComplete="off"
            required
          />
        </div>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor={`due-${jobId}`}>
            {type === "task" ? "Due" : "When"}
          </label>
          <input id={`due-${jobId}`} name="due" type="datetime-local" className="input min-w-0 flex-1 sm:w-[230px] sm:flex-none" required={type === "interview"} />
          {type !== "task" && <span className="hidden self-center text-xs text-faint sm:inline">Shows in Upcoming and on the role card</span>}
          <button type="submit" className="btn btn-ghost ml-auto shrink-0" disabled={pending}>
            <PlusIcon size={16} /> Add {current.label.toLowerCase()}
          </button>
        </div>
        {error && <p className="text-[13px] text-amber-soft">{error}</p>}
      </form>
    </div>
  );
}

/** ISO → the value a datetime-local input wants, in this device's time zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function EditTask({ task, onDone }: { task: TaskView; onDone: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(toLocalInput(task.dueIso));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="flex flex-1 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const err = await updateTaskAction(task.id, title, due);
          if (err) setError(err);
          else onDone();
        });
      }}
    >
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Step" autoFocus required />
      <div className="flex flex-wrap items-center gap-2">
        <input type="datetime-local" className="input w-auto" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
        {due && (
          <button type="button" className="btn-link text-xs" onClick={() => setDue("")}>
            No date
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <span className="text-xs text-amber-soft">{error}</span>}
    </form>
  );
}

export function TaskRow({ task, role }: { task: TaskView; role?: { id: number; company: string; title: string; color: string; logo: string | null } }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="flex items-start gap-3 py-1.5">
        <span className="mt-2.5 size-4 shrink-0" aria-hidden="true" />
        <EditTask task={task} onDone={() => setEditing(false)} />
      </div>
    );
  }
  return (
    <div className={`group flex items-start gap-3 py-1 ${task.done || pending ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        id={`t-${task.id}`}
        className="mt-0.5 size-4 shrink-0 accent-[#4ADE9A]"
        checked={task.done || pending}
        disabled={task.done || pending}
        onChange={() => start(() => completeTaskAction(task.id))}
      />
      <label htmlFor={`t-${task.id}`} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5">
        <span className={`text-sm ${task.done ? "line-through" : ""}`}>
          {task.kind === "call" && <span className="chip mr-1.5 border-green/40 bg-green/10 py-0 font-semibold text-green">Call</span>}
          {task.title}
        </span>
        <span className="text-xs text-faint">
          {task.due && <span className={task.overdue && !task.done ? "text-[#FFB3BA]" : ""}>{task.due} · </span>}
          {task.source}
        </span>
        {error && <span className="text-xs text-amber-soft">{error}</span>}
      </label>
      {role && (
        <Link href={`/jobs/${role.id}`} className="hidden max-w-[260px] shrink-0 items-center gap-2 self-center text-[13px] text-fg-2 hover:underline sm:flex">
          <Logo name={role.company} color={role.color} logo={role.logo} size={20} />
          <span className="truncate">
            <span className="font-medium text-fg">{role.company}</span> · {role.title}
          </span>
        </Link>
      )}
      {!task.done && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit “${task.title}”`}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-white/8 hover:text-fg"
        >
          <PencilIcon size={14} />
        </button>
      )}
      {!task.done && (
        <select
          aria-label={`Type of “${task.title}”`}
          className="h-7 shrink-0 cursor-pointer rounded-md border border-white/12 bg-black/25 px-1.5 text-xs text-muted hover:text-fg"
          value={task.kind}
          disabled={pending}
          onChange={(e) => {
            const type = e.target.value as "task" | "call" | "interview";
            start(async () => setError(await setTaskTypeAction(task.id, type)));
          }}
        >
          <option value="task">Step</option>
          <option value="call">Call</option>
          <option value="interview">Make interview</option>
        </select>
      )}
    </div>
  );
}

// ── Notes ───────────────────────────────────────────────────────────────────

const NOTE_TYPES = [
  { id: "note", label: "Note" },
  { id: "call", label: "Call" },
  { id: "interview", label: "Interview" },
] as const;

export function AddNoteForm({ jobId }: { jobId: number }) {
  const [type, setType] = useState<(typeof NOTE_TYPES)[number]["id"]>("note");
  return (
    <form
      action={async (fd) => {
        await addNoteAction(fd);
        setType("note");
      }}
      className="flex flex-wrap gap-2 sm:flex-nowrap"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <TypePicker name="type" value={type} options={NOTE_TYPES} onChange={setType} />
      <label className="sr-only" htmlFor={`note-${jobId}`}>
        Add a note or update
      </label>
      <input
        id={`note-${jobId}`}
        name="text"
        className="input"
        placeholder="Add a note or update, e.g. “Megan said the team hit 92% last FY”"
        autoComplete="off"
        required
      />
      <button type="submit" className="btn btn-primary shrink-0">
        Add
      </button>
    </form>
  );
}

export function NotesEditor({ jobId, initial }: { jobId: number; initial: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(true);
  const [pending, start] = useTransition();
  const save = () => {
    if (saved) return;
    start(async () => {
      await saveNotesAction(jobId, value);
      setSaved(true);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <label htmlFor={`notes-${jobId}`} className="text-[15px] font-semibold">
          Your notes
        </label>
        <span className="ml-auto text-xs text-faint">{pending ? "Saving…" : saved ? "Saved" : "Unsaved"}</span>
      </div>
      <textarea
        id={`notes-${jobId}`}
        className="input min-h-[360px] resize-y"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        onBlur={save}
        placeholder="Anything worth remembering about this role. Saves when you click away."
      />
    </div>
  );
}

// ── Editable field (Comp & role) ────────────────────────────────────────────

export function EditableField({
  jobId,
  field,
  raw,
  display,
  numeric,
}: {
  jobId: number;
  field: string;
  raw: string;
  display: string | null;
  numeric: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(raw);
  const [pending, start] = useTransition();
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(raw);
          setEditing(true);
        }}
        className="group flex items-center gap-2 text-left font-mono"
      >
        <span className={display ? "text-fg" : "text-amber"}>{display ?? "Unknown"}</span>
        <PencilIcon size={13} className="text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        <span className="sr-only">Edit</span>
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await updateFieldAction(jobId, field, value);
          setEditing(false);
        });
      }}
    >
      <input
        autoFocus
        className="input h-8 max-w-[220px] font-mono text-[13px]"
        inputMode={numeric ? "decimal" : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        aria-label={`New value for ${field}`}
      />
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
        Save
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
  );
}

// ── Interviews ──────────────────────────────────────────────────────────────

export interface InterviewView {
  id: number;
  round: number;
  stage: string;
  callCount: number;
  reviewScore: number | null;
  hasSummary: boolean;
  name: string;
  when: string | null;
  duration: number | null;
  format: string | null;
  attendees: string | null;
  status: "scheduled" | "done" | "cancelled";
  debrief: string | null;
  isToday: boolean;
}

export function InterviewList({ jobId, interviews }: { jobId: number; interviews: InterviewView[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {interviews.length === 0 && <p className="text-sm text-muted">No interviews yet.</p>}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        {interviews.map((iv) => (
          <InterviewCard key={iv.id} iv={iv} jobId={jobId} />
        ))}
      </div>
      <AttachEvent jobId={jobId} />
      {adding ? (
        <form action={async (fd) => { await addInterviewAction(fd); setAdding(false); }} className="glass grid grid-cols-2 gap-3 rounded-xl p-4 lg:grid-cols-4">
          <input type="hidden" name="jobId" value={jobId} />
          <Labeled label="Round name" id="iv-name">
            <input id="iv-name" name="name" className="input" required placeholder="Panel interview" />
          </Labeled>
          <Labeled label="When" id="iv-when">
            <input id="iv-when" name="startsAt" type="datetime-local" className="input" />
          </Labeled>
          <Labeled label="Minutes" id="iv-dur">
            <input id="iv-dur" name="duration" inputMode="numeric" className="input" placeholder="45" />
          </Labeled>
          <Labeled label="Format" id="iv-fmt">
            <input id="iv-fmt" name="format" className="input" placeholder="Zoom" />
          </Labeled>
          <div className="col-span-2 lg:col-span-3">
            <Labeled label="With" id="iv-who">
              <input id="iv-who" name="attendees" className="input" placeholder="Daniel, Megan, Josh" />
            </Labeled>
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-primary">
              Add
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-ghost self-start" onClick={() => setAdding(true)}>
          <PlusIcon size={16} />
          Add interview
        </button>
      )}
    </div>
  );
}

function InterviewCard({ iv, jobId }: { iv: InterviewView; jobId: number }) {
  const [finishing, setFinishing] = useState(false);
  const [debrief, setDebrief] = useState("");
  const [pending, start] = useTransition();
  const status =
    iv.status === "done"
      ? { label: "Done", cls: "bg-green/14 text-green" }
      : iv.isToday
        ? { label: "Today", cls: "bg-accent text-ink" }
        : iv.when
          ? { label: "Scheduled", cls: "bg-white/8 text-fg-2" }
          : { label: "Not booked", cls: "bg-white/8 text-fg-2" };
  return (
    <div className={`glass flex min-h-[220px] flex-col gap-2 rounded-xl p-4 ${iv.isToday && iv.status !== "done" ? "border-accent/45 bg-accent/12" : ""}`}>
      <span className="text-xs font-semibold text-accent-soft">{iv.stage}</span>
      <Link href={`/jobs/${jobId}/interviews/${iv.id}`} className="text-base font-semibold text-fg hover:underline">
        {iv.name}
      </Link>
      <span className="text-[13px] text-muted">
        {[iv.when, iv.duration ? `${iv.duration} min` : null, iv.format].filter(Boolean).join(" · ") || "Time not set"}
      </span>
      {iv.attendees && <span className="text-[13px] text-fg-2">{iv.attendees}</span>}
      <div className="flex-1" />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>{status.label}</span>
        {iv.callCount > 0 && <span className="chip py-0">{iv.callCount} {iv.callCount === 1 ? "call" : "calls"}</span>}
        {iv.hasSummary && <span className="chip py-0">Summary</span>}
        {iv.reviewScore !== null && <span className="chip border-accent/40 py-0 font-semibold text-accent-soft">Review {iv.reviewScore}/100</span>}
      </div>
      <Link href={`/jobs/${jobId}/interviews/${iv.id}`} className="btn-link text-[13px]">
        Open interview →
      </Link>
      {iv.debrief && <p className="text-xs leading-relaxed text-muted">{iv.debrief}</p>}
      {iv.status === "scheduled" &&
        (finishing ? (
          <div className="flex flex-col gap-2">
            <label className="sr-only" htmlFor={`debrief-${iv.id}`}>
              Debrief
            </label>
            <textarea
              id={`debrief-${iv.id}`}
              className="input text-[13px]"
              rows={3}
              placeholder="Quick debrief (optional): how it went, what they asked"
              value={debrief}
              onChange={(e) => setDebrief(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending}
                onClick={() => start(() => completeInterviewAction(iv.id, debrief))}
              >
                Save as done
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFinishing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setFinishing(true)}>
            <CheckIcon size={14} />
            Mark done
          </button>
        ))}
    </div>
  );
}

// ── People ──────────────────────────────────────────────────────────────────

export function AddContactForm({ jobId }: { jobId: number }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost self-start" onClick={() => setOpen(true)}>
        <PlusIcon size={16} />
        Add person
      </button>
    );
  }
  return (
    <form action={async (fd) => { await addContactAction(fd); setOpen(false); }} className="glass grid grid-cols-2 gap-3 rounded-xl p-4 lg:grid-cols-4">
      <input type="hidden" name="jobId" value={jobId} />
      <Labeled label="Name" id="c-name">
        <input id="c-name" name="name" className="input" required />
      </Labeled>
      <Labeled label="Title" id="c-title">
        <input id="c-title" name="title" className="input" placeholder="Head of Sales" />
      </Labeled>
      <Labeled label="Role in process" id="c-role">
        <input id="c-role" name="role" className="input" placeholder="Hiring manager" />
      </Labeled>
      <Labeled label="Email" id="c-email">
        <input id="c-email" name="email" type="email" className="input" />
      </Labeled>
      <div className="col-span-2 lg:col-span-3">
        <Labeled label="Notes" id="c-notes">
          <input id="c-notes" name="notes" className="input" placeholder="What they care about" />
        </Labeled>
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className="btn btn-primary">
          Add
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Labeled({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Research ────────────────────────────────────────────────────────────────

export function ResearchStatus({ jobId, pending }: { jobId: number; pending: boolean }) {
  const [busy, start] = useTransition();
  if (pending) {
    return (
      <span className="chip border-accent/40 text-accent-soft" title="Ask Claude: “process my Pursuit queue”">
        Research queued for Claude
      </span>
    );
  }
  return (
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => start(() => queueResearchAction(jobId))}>
      Research with Claude
    </button>
  );
}

export function DeleteRoleButton({ jobId, label }: { jobId: number; label: string }) {
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-sm border border-red/40 bg-red/10 text-[#FFB3BA] hover:bg-red/20"
      disabled={busy}
      onClick={() => {
        if (confirm(`Delete ${label}? Its notes, history, interviews and next steps are removed for good.`)) start(() => deleteJobAction(jobId));
      }}
    >
      Delete role
    </button>
  );
}
