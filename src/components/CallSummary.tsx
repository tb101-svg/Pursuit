"use client";

import { useTransition } from "react";
import { transcribeCallAction } from "@/lib/actions";
import type { CallSummary } from "@/lib/prep";
import { PILLAR_VIEW } from "./InterviewThem";
import { CopyButton } from "./CopyButton";

/** Where a call's transcript is up to, with a Transcribe button for recordings that haven't been. */
export function TranscriptStatus({
  callId,
  status,
  progress,
  error,
  hasRecording,
}: {
  callId: number;
  status: string | null;
  progress: number | null;
  error: string | null;
  hasRecording: boolean;
}) {
  const [busy, start] = useTransition();
  const transcribe = (label: string) => (
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => start(() => transcribeCallAction(callId))}>
      {busy ? "Starting…" : label}
    </button>
  );
  if (status === "queued") return <span className="chip border-accent/40 text-accent-soft">Waiting to transcribe…</span>;
  if (status === "transcribing")
    return (
      <span className="chip border-accent/40 text-accent-soft">
        <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        Transcribing on this computer · {Math.round((progress ?? 0) * 100)}%
      </span>
    );
  if (status === "pending") return <span className="chip border-accent/40 text-accent-soft">Claude is reading the transcript…</span>;
  if (status === "done") return <span className="chip border-green/40 text-green">Summary ready</span>;
  if (status === "failed")
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="chip border-red/40 text-[#FFB3BA]" title={error ?? undefined}>
          Transcription failed
        </span>
        {hasRecording && transcribe("Try again")}
      </span>
    );
  return hasRecording ? transcribe("Transcribe & summarise") : null;
}

/** Claude's key summary of a call, and what it changed on the role. */
export function CallSummaryView({ summary: s, open = false }: { summary: CallSummary; open?: boolean }) {
  const changed = [
    ...s.applied.fields.map((f) => `Filled ${f}`),
    ...(s.applied.stage ? [`Moved stage to ${s.applied.stage === "screening" ? "1st stage" : s.applied.stage}`] : []),
    ...s.applied.tasks.map((t) => `Next step: ${t}`),
    ...s.applied.people.map((p) => `Added ${p} to People`),
  ];
  return (
    <details open={open} className="rounded-lg border border-white/8 bg-white/3 px-3.5 py-2.5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer text-[13px] font-semibold text-accent-soft">Key summary</summary>
      <div className="mt-2.5 flex flex-col gap-3 text-[13px] leading-relaxed">
        <p className="text-fg">{s.summary}</p>

        {s.notes.length > 0 && (
          <Block title="Key notes">
            <ul className="flex flex-col gap-1">
              {s.notes.map((n, i) => (
                <li key={i} className="text-fg-2">
                  • {n}
                </li>
              ))}
            </ul>
          </Block>
        )}

        {s.them.length > 0 && (
          <Block title="What they said (Team · Product · Growth)">
            <ul className="flex flex-col gap-1.5">
              {s.them.map((t, i) => (
                <li key={i}>
                  <span className="chip mr-1.5 py-0">{PILLAR_VIEW.find((p) => p.id === t.group)?.label ?? t.group}</span>
                  <span className="text-muted">{t.question}</span>
                  <span className="block text-fg-2">{t.answer}</span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {(changed.length > 0 || s.suggested.length > 0) && (
          <Block title="Updates to the role">
            <ul className="flex flex-col gap-1">
              {changed.map((c, i) => (
                <li key={i} className="text-green">
                  ✓ {c}
                </li>
              ))}
              {s.suggested.map((c, i) => (
                <li key={`s${i}`} className="text-amber-soft">
                  ? {c} <span className="text-faint">(waiting for you in Needs you)</span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {s.ratings.length > 0 && (
          <Block title="Suggested ratings">
            <ul className="flex flex-col gap-1">
              {s.ratings.map((r, i) => (
                <li key={i} className="text-fg-2">
                  <span className="font-medium text-fg capitalize">{r.rating}</span> <span className="font-mono">{r.score}/5</span>: {r.why}
                </li>
              ))}
            </ul>
            <p className="text-xs text-faint">Set your own on the role&apos;s Overview or in Interview them.</p>
          </Block>
        )}

        {s.recap_email && (
          <Block title="Same-day recap note (draft: send it yourself)">
            <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-black/15 p-3">
              <p className="whitespace-pre-line text-fg-2">{s.recap_email}</p>
              <span className="self-end">
                <CopyButton text={s.recap_email} label="Copy" />
              </span>
            </div>
          </Block>
        )}

        {s.next_round_prep.length > 0 && (
          <Block title="Prepare for the next round">
            <ul className="flex flex-col gap-1">
              {s.next_round_prep.map((n, i) => (
                <li key={i} className="text-fg-2">
                  • {n}
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>
    </details>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{title}</span>
      {children}
    </div>
  );
}
