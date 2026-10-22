"use client";

import { useActionState, useState } from "react";
import { addTaskAction } from "@/lib/actions";
import { PlusIcon } from "./icons";
import { TaskRow, type TaskView } from "./job";

/** All open next steps across your roles, grouped by when they're due. */

export interface StepView extends TaskView {
  bucket: "overdue" | "today" | "week" | "later" | "undated";
  role: { id: number; company: string; title: string; color: string; logo: string | null };
  parked: boolean;
}

const GROUPS: { id: StepView["bucket"]; label: string; tone: string }[] = [
  { id: "overdue", label: "Overdue", tone: "text-[#FFB3BA]" },
  { id: "today", label: "Today", tone: "text-accent-soft" },
  { id: "week", label: "Next 7 days", tone: "text-fg" },
  { id: "later", label: "Later", tone: "text-fg" },
  { id: "undated", label: "No date", tone: "text-muted" },
];

type Filter = "all" | "due" | "calls" | "undated";
const FILTERS: { id: Filter; label: string; test: (s: StepView) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "due", label: "Due now", test: (s) => s.bucket === "overdue" || s.bucket === "today" },
  { id: "calls", label: "Calls", test: (s) => s.kind === "call" },
  { id: "undated", label: "No date", test: (s) => s.bucket === "undated" },
];

export function StepsView({ steps, roles }: { steps: StepView[]; roles: { id: number; label: string }[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showParked, setShowParked] = useState(false);
  const pool = steps.filter((s) => showParked || !s.parked);
  const visible = pool.filter(FILTERS.find((f) => f.id === filter)!.test);
  const parkedCount = steps.filter((s) => s.parked).length;

  return (
    <div className="flex flex-col gap-4">
      <AddStep roles={roles} />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const n = pool.filter(f.test).length;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={f.id === filter}
              onClick={() => setFilter(f.id)}
              className={`h-[34px] rounded-lg border px-3.5 text-[13px] font-medium ${
                f.id === filter ? "border-fg bg-fg text-ink" : "border-white/12 bg-white/5 text-fg-2 hover:bg-white/10"
              }`}
            >
              {f.label} <span className="font-mono opacity-70">{n}</span>
            </button>
          );
        })}
        {parkedCount > 0 && (
          <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={showParked} onChange={(e) => setShowParked(e.target.checked)} className="accent-[#6E8BFF]" />
            Include No reply &amp; Try later roles ({parkedCount})
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="glass rounded-xl p-10 text-center text-sm text-muted">
          {filter === "all" ? "Nothing open. Nice work." : "No steps here."}
        </div>
      ) : (
        GROUPS.map((g) => {
          const items = visible.filter((s) => s.bucket === g.id);
          if (items.length === 0) return null;
          return (
            <section key={g.id} className="glass flex flex-col rounded-xl px-4 py-3 md:px-5" aria-label={g.label}>
              <h2 className={`flex items-center gap-2 pb-1.5 text-sm font-semibold ${g.tone}`}>
                {g.label} <span className="font-mono text-xs font-normal text-faint">{items.length}</span>
              </h2>
              <div className="flex flex-col divide-y divide-white/6">
                {items.map((s) => (
                  <div key={s.id} className="py-1">
                    <TaskRow task={s} role={s.role} />
                    {/* On phones the role shows under the step instead of beside it. */}
                    <a href={`/jobs/${s.role.id}`} className="ml-7 block truncate pb-1 text-xs text-muted sm:hidden">
                      {s.role.company} · {s.role.title}
                    </a>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function AddStep({ roles }: { roles: { id: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("task");
  const [error, action, pending] = useActionState(async (prev: string | null, fd: FormData) => {
    const err = await addTaskAction(prev, fd);
    if (!err) setOpen(false);
    return err;
  }, null);
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost self-start" onClick={() => setOpen(true)}>
        <PlusIcon size={16} /> Add a step
      </button>
    );
  }
  return (
    <form action={action} className="glass flex flex-col gap-2.5 rounded-xl p-4">
      <div className="flex flex-wrap gap-2">
        <select name="jobId" className="input w-full sm:w-[300px]" required aria-label="Role" defaultValue="">
          <option value="" disabled>
            Which role?
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select name="type" className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="task">Step</option>
          <option value="call">Call</option>
          <option value="interview">Interview</option>
        </select>
      </div>
      <input name="title" className="input" placeholder="What needs doing?" required aria-label="Step" autoComplete="off" />
      <div className="flex flex-wrap items-center gap-2">
        <input name="due" type="datetime-local" className="input w-auto" aria-label="Due" required={type === "interview"} />
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="text-[13px] text-amber-soft">{error}</p>}
    </form>
  );
}
