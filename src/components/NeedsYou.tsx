"use client";

import { useState, useTransition } from "react";
import { resolveProposalAction } from "@/lib/actions";
import { SparkIcon } from "./icons";

export interface ProposalCard {
  id: number;
  kind: "match_email" | "conflict" | "match_event";
  title: string;
  detail: string | null;
  when: string;
  suggestedJobId: number | null;
  count: number;
  jobLabel: string | null;
}

export function NeedsYou({ items, roles }: { items: ProposalCard[]; roles: { id: number; label: string }[] }) {
  if (items.length === 0) return null;
  return (
    <section data-demo-hide className="glass flex flex-col gap-2 rounded-xl border-amber/30 px-4 py-3.5" aria-labelledby="needs-h">
      <div className="flex items-center gap-2">
        <SparkIcon size={16} className="text-amber" />
        <h2 id="needs-h" className="text-sm font-semibold">
          Needs you
        </h2>
        <span className="rounded-full bg-amber/16 px-2 py-px font-mono text-xs font-semibold text-amber-soft">{items.length}</span>
        <span className="ml-auto hidden text-xs text-faint sm:inline">Updates the sync couldn’t apply on its own</span>
      </div>
      <ul className="flex flex-col">
        {items.map((p) => (
          <ProposalRow key={p.id} p={p} roles={roles} />
        ))}
      </ul>
    </section>
  );
}

function ProposalRow({ p, roles }: { p: ProposalCard; roles: { id: number; label: string }[] }) {
  const [pending, start] = useTransition();
  const [jobId, setJobId] = useState<number | "">(p.suggestedJobId ?? "");
  const act = (action: "link" | "create" | "apply" | "keep" | "ignore") =>
    start(() => resolveProposalAction(p.id, action, jobId === "" ? undefined : jobId));

  return (
    <li className={`flex flex-col gap-2 border-b border-white/7 py-3 last:border-0 ${pending ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm text-fg">
            {p.jobLabel && <span className="font-semibold">{p.jobLabel} · </span>}
            {p.title}
            {p.count > 1 && <span className="text-muted"> ({p.count} emails)</span>}
          </span>
          {p.detail && <span className="text-[13px] leading-relaxed text-muted">{p.detail}</span>}
        </div>
        <span className="shrink-0 font-mono text-xs text-faint">{p.when}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {p.kind === "conflict" ? (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => act("apply")}>
              Use the email’s value
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act("keep")}>
              Keep mine
            </button>
          </>
        ) : (
          <>
            <label className="sr-only" htmlFor={`p-role-${p.id}`}>
              Role
            </label>
            <select
              id={`p-role-${p.id}`}
              className="input h-8 w-auto max-w-[280px] py-0 text-[13px]"
              value={jobId}
              onChange={(e) => setJobId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Choose a role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" disabled={pending || jobId === ""} onClick={() => act("link")}>
              Link
            </button>
            {p.kind === "match_email" && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act("create")}>
                Create new role
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act("ignore")}>
              Not job-related
            </button>
          </>
        )}
      </div>
    </li>
  );
}
