"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { dismissEmailAction, processQueueAction, stopQueueAction } from "@/lib/actions";
import { CopyButton } from "./CopyButton";

export interface ToReadItem {
  id: string;
  from: string;
  subject: string;
  when: string;
}

export interface ToResearchItem {
  jobId: number;
  label: string;
  when: string;
}

const PROMPT = "Process my Pursuit queue";

/** Work waiting for Claude (on your subscription): emails to read and roles to research. */
export function ForClaude({
  emails,
  emailTotal,
  research,
  researchTotal,
  prep = [],
  run,
  canRun,
}: {
  prep?: ToResearchItem[];
  emails: ToReadItem[];
  emailTotal: number;
  research: ToResearchItem[];
  researchTotal: number;
  run: RunView | null;
  canRun: boolean;
}) {
  const total = emailTotal + researchTotal + prep.length;
  if (total === 0 && run?.status !== "running") return null;
  return (
    <section data-demo-hide className="glass flex flex-col gap-2 rounded-xl border-accent/30 px-4 py-3.5" aria-labelledby="forclaude-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="forclaude-h" className="text-sm font-semibold">
          For Claude
        </h2>
        <span className="rounded-full bg-accent/18 px-2 py-px font-mono text-xs font-semibold text-accent-soft">{total}</span>
        <span className="ml-auto hidden items-center gap-2 text-xs text-muted md:flex">
          Ask Claude: <span className="text-fg-2">“{PROMPT}”</span>
          <CopyButton text={PROMPT} label="Copy" />
          <Link href="/settings" className="btn-link text-xs">
            setup
          </Link>
        </span>
      </div>

      <ProcessNow run={run} canRun={canRun} />

      {researchTotal > 0 && (
        <div className="flex flex-col">
          <span className="label pt-1">Roles to research · {researchTotal}</span>
          <ul className="flex flex-col">
            {research.map((r) => (
              <li key={r.jobId} className="flex items-center gap-3 border-b border-white/7 py-2 text-sm last:border-0">
                <Link href={`/jobs/${r.jobId}`} className="min-w-0 flex-1 truncate text-fg hover:underline">
                  {r.label}
                </Link>
                <span className="w-[70px] shrink-0 text-right font-mono text-xs text-faint">{r.when}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {prep.length > 0 && (
        <div className="flex flex-col">
          <span className="label pt-1">Prep & calls · {prep.length}</span>
          <ul className="flex flex-col">
            {prep.map((r, i) => (
              <li key={i} className="flex items-center gap-3 border-b border-white/7 py-2 text-sm last:border-0">
                <Link href={r.jobId ? `/jobs/${r.jobId}?tab=prep` : "/prep#star"} className="min-w-0 flex-1 truncate text-fg hover:underline">
                  {r.label}
                </Link>
                <span className="w-[70px] shrink-0 text-right font-mono text-xs text-faint">{r.when}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {emailTotal > 0 && (
        <div className="flex flex-col">
          <span className="label pt-1">Emails to read · {emailTotal}</span>
          <ul className="flex flex-col">
            {emails.map((i) => (
              <EmailRow key={i.id} item={i} />
            ))}
          </ul>
          {emailTotal > emails.length && <p className="text-xs text-faint">and {emailTotal - emails.length} more</p>}
        </div>
      )}
    </section>
  );
}

function EmailRow({ item }: { item: ToReadItem }) {
  const [pending, start] = useTransition();
  return (
    <li className={`flex items-center gap-3 border-b border-white/7 py-2 text-sm last:border-0 ${pending ? "opacity-50" : ""}`}>
      <span className="hidden w-[180px] shrink-0 truncate text-muted sm:inline">{item.from}</span>
      <span className="min-w-0 flex-1 truncate">{item.subject || "(no subject)"}</span>
      <span className="w-[70px] shrink-0 text-right font-mono text-xs text-faint">{item.when}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => start(() => dismissEmailAction(item.id))}>
        Not job-related
      </button>
    </li>
  );
}

export interface RunView {
  status: "running" | "done" | "error";
  activity: string | null;
  summary: string | null;
  error: string | null;
  when: string;
  emails: number;
  research: number;
}

/** Runs Claude Code headless on the queue, with live progress. */
export function ProcessNow({ run, canRun }: { run: RunView | null; canRun: boolean }) {
  const [pending, start] = useTransition();
  const [startError, setStartError] = useState<string | null>(null);
  const running = run?.status === "running";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-white/8 bg-white/4 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {running ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-accent shadow-[0_0_10px_#6E8BFF]" />
            <span className="text-[13px] text-fg">{run.activity ?? "Working…"}</span>
            <span className="font-mono text-xs text-faint">
              {run.emails} emails · {run.research} roles
            </span>
            <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => start(() => stopQueueAction())}>
              Stop
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={pending || !canRun}
              onClick={() =>
                start(async () => {
                  setStartError(await processQueueAction());
                })
              }
            >
              {pending ? "Starting…" : "Process now"}
            </button>
            <span className="hidden text-xs text-muted sm:inline">Runs Claude on your subscription. Takes a few minutes; you can keep using Pursuit.</span>
          </>
        )}
      </div>
      {startError && <p className="text-xs text-amber-soft">{startError}</p>}
      {!running && run?.status === "error" && <p className="text-xs text-[#FFB3BA]">Last run ({run.when}): {run.error}</p>}
      {!running && run?.status === "done" && (
        <p className="text-xs whitespace-pre-line text-muted">
          Last run ({run.when}, {run.emails} emails, {run.research} roles): {run.summary}
        </p>
      )}
    </div>
  );
}
