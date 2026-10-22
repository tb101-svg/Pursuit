"use client";

import { useState, useTransition, type ReactNode } from "react";
import { attachEventAction, editRoleAction, listCalendarEventsAction, type AttachableEvent } from "@/lib/actions";
import { CalendarIcon, PencilIcon } from "./icons";

// ── Edit role & company ─────────────────────────────────────────────────────

export function EditRole({
  jobId,
  initial,
  sharedWith,
}: {
  jobId: number;
  initial: { company: string; website: string; title: string; url: string; location: string };
  /** Other roles at the same company, so a company change can say what it affects. */
  sharedWith: number;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [research, setResearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV({ ...v, [k]: e.target.value });
    if (k === "company" || k === "website") setResearch(true);
  };
  const companyChanged = v.company.trim() !== initial.company;

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <PencilIcon size={14} /> Edit
      </button>
    );
  }
  return (
    <form
      className="glass basis-full rounded-xl p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const err = await editRoleAction(jobId, { ...v, research });
          if (err) setError(err);
          else {
            setError(null);
            setOpen(false);
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Company" id={`er-company-${jobId}`}>
          <input id={`er-company-${jobId}`} className="input" value={v.company} onChange={set("company")} required />
        </Field>
        <Field label="Company website" id={`er-site-${jobId}`}>
          <input id={`er-site-${jobId}`} className="input" value={v.website} onChange={set("website")} placeholder="beam.ai" />
        </Field>
        <Field label="Role title" id={`er-title-${jobId}`}>
          <input id={`er-title-${jobId}`} className="input" value={v.title} onChange={set("title")} required />
        </Field>
        <Field label="Location" id={`er-loc-${jobId}`}>
          <input id={`er-loc-${jobId}`} className="input" value={v.location} onChange={set("location")} placeholder="Sydney, hybrid" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Job ad link" id={`er-url-${jobId}`}>
            <input id={`er-url-${jobId}`} className="input" value={v.url} onChange={set("url")} placeholder="https://…" />
          </Field>
        </div>
      </div>
      {companyChanged && sharedWith > 0 && (
        <p className="mt-3 text-[13px] text-muted">
          Only this role moves to {v.company.trim() || "the new company"}, along with the people you met through it. The {sharedWith} other{" "}
          {sharedWith === 1 ? "role" : "roles"} at {initial.company} {sharedWith === 1 ? "stays where it is" : "stay where they are"}.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-fg-2">
          <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} className="accent-[#6E8BFF]" />
          Have Claude research it again
        </label>
        {error && <span className="text-[13px] text-[#FFB3BA]">{error}</span>}
        <button
          type="button"
          className="btn btn-ghost btn-sm ml-auto"
          onClick={() => {
            setV(initial);
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Attach a calendar event ─────────────────────────────────────────────────

export function AttachEvent({ jobId }: { jobId: number }) {
  const [events, setEvents] = useState<AttachableEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, start] = useTransition();

  const load = () =>
    start(async () => {
      const r = await listCalendarEventsAction();
      setEvents(r.events);
      setError(r.error);
    });

  if (events === null) {
    return (
      <button type="button" className="btn btn-ghost self-start" onClick={load} disabled={busy}>
        <CalendarIcon size={16} />
        {busy ? "Reading your calendar…" : "Attach from calendar"}
      </button>
    );
  }
  const q = query.trim().toLowerCase();
  const shown = events.filter((e) => !q || `${e.summary} ${e.attendees ?? ""}`.toLowerCase().includes(q));
  return (
    <section className="glass flex flex-col gap-2.5 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">Attach a calendar event</h3>
        <button type="button" className="btn-link ml-auto text-[13px]" onClick={() => setEvents(null)}>
          Close
        </button>
      </div>
      {error ? (
        <p className="text-sm text-amber-soft">{error}</p>
      ) : (
        <>
          <input className="input" placeholder="Search by title or person" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search events" />
          <ul className="flex max-h-[360px] flex-col overflow-y-auto">
            {shown.length === 0 && <li className="py-2 text-sm text-muted">No events match.</li>}
            {shown.map((e) => (
              <li key={e.id} className="flex items-center gap-3 border-b border-white/7 py-2 text-sm last:border-0">
                <span className="w-[120px] shrink-0 font-mono text-xs text-fg-2">{e.when}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{e.summary}</span>
                  {e.attendees && <span className="truncate text-xs text-faint">{e.attendees}</span>}
                </span>
                {e.linkedTo ? (
                  <span className="chip max-w-[180px] truncate" title={`Linked to ${e.linkedTo}`}>
                    Linked: {e.linkedTo}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() =>
                      start(async () => {
                        const err = await attachEventAction(jobId, e.provider, e.id);
                        if (err) setError(err);
                        else setEvents(null);
                      })
                    }
                  >
                    Attach
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
