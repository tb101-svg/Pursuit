"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { addTranscriptAction, completeInterviewAction, queuePrepAction, saveDebriefAction, startCallAction, updateInterviewAction } from "@/lib/actions";
import type { CallSummary } from "@/lib/prep";
import type { CallReview } from "@/lib/review";
import { CallReviewView, ReviewStatus } from "./CallReview";
import { CallSummaryView, TranscriptStatus } from "./CallSummary";
import { CheckIcon, MicIcon, PencilIcon, SparkIcon } from "./icons";
import { TranscriptForm } from "./prep";

/** The interview page's interactive parts: actions, editing, debrief, and each call's record. */

export interface InterviewEdit {
  id: number;
  jobId: number;
  name: string;
  startsLocal: string; // datetime-local value
  duration: number | null;
  format: string | null;
  attendees: string | null;
  status: "scheduled" | "done" | "cancelled";
}

export function InterviewActions({ iv, prepFocus, prepPending }: { iv: InterviewEdit; prepFocus: string; prepPending: boolean }) {
  const [editing, setEditing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [debrief, setDebrief] = useState("");
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => start(() => startCallAction(iv.jobId, iv.id))}>
          <MicIcon size={14} /> Call mode
        </button>
        {!prepPending ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => start(() => queuePrepAction(iv.jobId, prepFocus))} title={`Focus: ${prepFocus}`}>
            <SparkIcon size={14} /> Prepare Claude for this round
          </button>
        ) : (
          <span className="chip border-accent/40 text-accent-soft">Prep queued for Claude</span>
        )}
        {iv.status === "scheduled" && !finishing && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFinishing(true)}>
            <CheckIcon size={14} /> Mark done
          </button>
        )}
        <button type="button" className="btn-link ml-auto inline-flex items-center gap-1 text-[13px]" onClick={() => setEditing((v) => !v)}>
          <PencilIcon size={13} /> {editing ? "Cancel" : "Edit details"}
        </button>
      </div>
      {finishing && (
        <div className="flex flex-col gap-2">
          <textarea className="input text-[13px]" rows={3} placeholder="Quick debrief (optional): how it went, what they asked" value={debrief} onChange={(e) => setDebrief(e.target.value)} aria-label="Debrief" />
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => start(async () => { await completeInterviewAction(iv.id, debrief); setFinishing(false); })}>
              Save as done
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFinishing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {editing && <EditInterview iv={iv} onDone={() => setEditing(false)} />}
    </div>
  );
}

function EditInterview({ iv, onDone }: { iv: InterviewEdit; onDone: () => void }) {
  const [v, setV] = useState({ name: iv.name, startsAt: iv.startsLocal, duration: iv.duration ? String(iv.duration) : "", format: iv.format ?? "", attendees: iv.attendees ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const field = (k: keyof typeof v, label: string, type = "text", placeholder = "") => (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <input className="input" type={type} value={v[k]} placeholder={placeholder} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </label>
  );
  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-lg border border-white/8 bg-white/3 p-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const err = await updateInterviewAction(iv.id, v);
          if (err) setError(err);
          else onDone();
        });
      }}
    >
      <div className="md:col-span-2">{field("name", "Round name")}</div>
      {field("startsAt", "When", "datetime-local")}
      {field("duration", "Minutes", "text", "45")}
      {field("format", "Format", "text", "Zoom / in person")}
      {field("attendees", "With", "text", "Names and titles")}
      <div className="flex items-center gap-2 md:col-span-2">
        {error && <span className="text-[13px] text-amber-soft">{error}</span>}
        <button type="submit" className="btn btn-primary btn-sm ml-auto" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

export function DebriefEditor({ interviewId, initial }: { interviewId: number; initial: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(true);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        className="input min-h-[110px] text-[13px]"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        onBlur={() => !saved && start(async () => { await saveDebriefAction(interviewId, value); setSaved(true); })}
        placeholder="How did it go? What did they ask, what landed, what would you do differently? Saves when you click away."
        aria-label="Your debrief"
      />
      <span className="self-end text-xs text-faint">{busy ? "Saving…" : saved ? "Saved" : "Unsaved"}</span>
    </div>
  );
}

export interface CallRecord {
  id: number;
  title: string;
  when: string;
  ended: boolean;
  notes: string;
  recording: boolean;
  transcript: string | null;
  status: string | null;
  progress: number | null;
  error: string | null;
  summary: CallSummary | null;
  review: CallReview | null;
  reviewStatus: string | null;
}

/** Everything captured on one call: review, summary, notes, recording, transcript. */
export function CallRecordCard({ call, first }: { call: CallRecord; first: boolean }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  return (
    <article className="glass flex flex-col gap-3 rounded-xl p-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">{call.title}</h3>
        <span className="text-[13px] text-muted">· {call.when}</span>
        {!call.ended && <span className="chip border-red/40 text-[#FFB3BA]">In progress</span>}
        <Link href={`/calls/${call.id}`} className="btn-link ml-auto text-[13px]">
          Open in Call mode
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TranscriptStatus callId={call.id} status={call.status} progress={call.progress} error={call.error} hasRecording={call.recording} />
        {call.status === "done" && !call.review && <ReviewStatus callId={call.id} status={call.reviewStatus} hasTranscript={!!call.transcript} />}
        {(call.status === null || call.status === "failed") && (
          <button type="button" className="btn-link text-[13px]" onClick={() => setAdding((v) => !v)}>
            Paste a transcript
          </button>
        )}
      </div>
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
      {call.review && <CallReviewView review={call.review} open={first} />}
      {call.summary && <CallSummaryView summary={call.summary} open={first && !call.review} />}
      {call.notes.trim() && (
        <details className="rounded-lg border border-white/8 bg-white/3 px-3.5 py-2.5 [&_summary::-webkit-details-marker]:hidden" open={!call.summary}>
          <summary className="cursor-pointer text-[13px] font-semibold">Your notes</summary>
          <pre className="mt-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-2">{call.notes}</pre>
        </details>
      )}
      {call.recording && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- your own call recording
        <audio controls preload="none" src={`/api/calls/${call.id}/recording`} className="h-9 w-full" />
      )}
      {call.transcript && (
        <details className="rounded-lg border border-white/8 bg-white/3 px-3.5 py-2.5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer text-[13px] font-semibold">
            Transcript <span className="font-normal text-muted">({Math.round(call.transcript.length / 1000)}k characters)</span>
          </summary>
          <pre className="mt-2 max-h-[480px] overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-2">{call.transcript}</pre>
        </details>
      )}
    </article>
  );
}
