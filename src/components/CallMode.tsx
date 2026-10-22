"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { addTranscriptAction, endCallAction, savePrepAction, saveCallNotesAction } from "@/lib/actions";
import type { PrepContent, PrepItem } from "@/lib/prep";
import { MicIcon } from "./icons";
import { TickList, TranscriptForm } from "./prep";
import { InterviewThem } from "./InterviewThem";
import type { RatingKey } from "@/lib/rating";
import type { CallSummary } from "@/lib/prep";
import { CallSummaryView, TranscriptStatus } from "./CallSummary";
import { CallReviewView, ReviewStatus } from "./CallReview";
import type { CallReview } from "@/lib/review";

/**
 * Call mode: the prep sheet on the left for quick glances, a notes pad on the
 * right. Quick tags stamp the time since the call started. Recording (this
 * computer only) captures your mic plus the meeting's audio into data/recordings.
 */

const TAGS = ["Pain L1 · problem", "Pain L2 · impact", "Pain L3 · quantified", "Metric", "Concern", "Next step", "Comp", "Name", "Follow up"];

/** Always on screen during a call: the standard you're holding yourself to. */
function GoDeep() {
  return (
    <details open className="rounded-lg border border-amber/35 bg-amber/8 px-3 py-2.5 text-[13px] leading-relaxed [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer font-semibold text-amber-soft">Go deep. Leave no stone unturned.</summary>
      <div className="mt-2 grid grid-cols-1 gap-x-5 gap-y-2 text-fg-2 xl:grid-cols-3">
        <div>
          <p className="font-semibold text-fg">Every behavioural question: STAR</p>
          <p>
            <b>S</b> brief context · <b>T</b> what you owned · <b>A</b> 3–4 things <i>you</i> did · <b>R</b> lead with the number · then the lesson. Expect &ldquo;how?&rdquo; and
            &ldquo;why?&rdquo; two levels down on every number.
          </p>
        </div>
        <div>
          <p className="font-semibold text-fg">Role-play: three levels on pain</p>
          <p>
            <b>1 Problem</b> &ldquo;What&apos;s not working today?&rdquo; · <b>2 Impact</b> &ldquo;What does that cause? Who else feels it?&rdquo; · <b>3 Implication, quantified</b> &ldquo;What does it
            cost in $, hours or risk? What happens if nothing changes?&rdquo; Then how they measure success, and who decides.
          </p>
        </div>
        <div>
          <p className="font-semibold text-fg">The close</p>
          <p>&ldquo;Is there anything that gives you hesitation about moving me forward?&rdquo; Handle it on the spot, then agree the next step and the date.</p>
        </div>
      </div>
    </details>
  );
}

export interface CallModeProps {
  callId: number;
  jobId: number;
  company: string;
  role: string;
  title: string;
  startedAt: string;
  ended: boolean;
  notes: string;
  prep: PrepContent;
  hasTranscript: boolean;
  recording: string | null;
  ratings: Partial<Record<RatingKey, number | null>>;
  transcriptStatus: string | null;
  transcribeProgress: number | null;
  transcribeError: string | null;
  summary: CallSummary | null;
  review: CallReview | null;
  reviewStatus: string | null;
}

export function CallMode(p: CallModeProps) {
  const [notes, setNotes] = useState(p.notes);
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [ended, setEnded] = useState(p.ended);
  const [busy, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const elapsed = useElapsed(p.startedAt, ended);
  // Where the cursor goes after the next notes update (tags and timestamps).
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = area.current;
    if (caret.current === null || !el) return;
    el.focus();
    el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [notes]);

  // Autosave a moment after you stop typing.
  useEffect(() => {
    if (status !== "unsaved") return;
    const t = setTimeout(async () => {
      setStatus("saving");
      await saveCallNotesAction(p.callId, notes);
      setStatus("saved");
    }, 1200);
    return () => clearTimeout(t);
  }, [notes, status, p.callId]);

  const insert = (tag: string) => {
    const el = area.current;
    const stamp = `[${elapsed}] ${tag}: `;
    const pos = el?.selectionStart ?? notes.length;
    const before = notes.slice(0, pos);
    const line = (before && !before.endsWith("\n") ? "\n" : "") + stamp;
    const next = before + line + notes.slice(pos);
    caret.current = pos + line.length;
    setNotes(next);
    setStatus("unsaved");
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter on a new line starts it with the time, so notes line up with the recording.
    if (e.key === "Enter" && !e.shiftKey && !ended) {
      e.preventDefault();
      const el = e.currentTarget;
      const pos = el.selectionStart;
      const add = `\n[${elapsed}] `;
      caret.current = pos + add.length;
      setNotes(notes.slice(0, pos) + add + notes.slice(el.selectionEnd));
      setStatus("unsaved");
    }
  };

  const [prep, setPrep] = useState(p.prep);
  const tick = (section: "ask" | "checklist" | "close", i: number) => {
    const next = { ...prep, [section]: prep[section].map((it: PrepItem, j: number) => (j === i ? { ...it, done: !it.done } : it)) };
    setPrep(next);
    start(() => savePrepAction(p.jobId, next));
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-white/8 bg-[rgb(8_10_14/0.8)] px-4 py-3 backdrop-blur-xl md:px-6">
        <Link href={`/jobs/${p.jobId}?tab=prep`} className="btn-link text-[13px]">
          ← Prep
        </Link>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">
            {p.company} · {p.title}
          </span>
          <span className="truncate text-xs text-muted">{p.role}</span>
        </div>
        <span className={`ml-auto font-mono text-lg tabular-nums ${ended ? "text-muted" : "text-fg"}`} aria-label="Time since the call started">
          {elapsed}
        </span>
        {!ended && <Recorder callId={p.callId} existing={p.recording} />}
        {!ended ? (
          <button
            type="button"
            className="btn btn-sm border border-red/40 bg-red/10 text-[#FFB3BA] hover:bg-red/20"
            disabled={busy}
            onClick={() =>
              start(async () => {
                await saveCallNotesAction(p.callId, notes);
                await endCallAction(p.callId);
                setEnded(true);
                setStatus("saved");
              })
            }
          >
            End call
          </button>
        ) : (
          <span className="chip">Ended</span>
        )}
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <aside className="flex flex-col gap-3 lg:max-h-[calc(100vh-110px)] lg:overflow-y-auto lg:pr-1" aria-label="Prep">
          {prep.openers.map((o, i) => (
            <details key={i} className="glass rounded-xl p-4 [&_summary::-webkit-details-marker]:hidden" open={i === 0 && !ended}>
              <summary className="cursor-pointer text-sm font-semibold text-accent-soft">“{o.title}”</summary>
              <p className="mt-2.5 text-[15px] leading-relaxed whitespace-pre-line">{o.body}</p>
            </details>
          ))}
          <Glance title="Interview them">
            <InterviewThem
              jobId={p.jobId}
              items={prep.them}
              ratings={p.ratings}
              compact
              onChange={(them) => {
                const next = { ...prep, them };
                setPrep(next);
                start(() => savePrepAction(p.jobId, next));
              }}
            />
          </Glance>
          {prep.talking_points.length > 0 && (
            <Glance title="Talking points">
              <div className="flex flex-wrap gap-1.5">
                {prep.talking_points.map((t, i) => (
                  <span key={i} className="chip px-2.5 py-1 text-xs" title={t.body}>
                    {t.title}
                  </span>
                ))}
              </div>
            </Glance>
          )}
          {prep.stories.length > 0 && (
            <Glance title="Story bank">
              <dl className="flex flex-col gap-2 text-[13px]">
                {prep.stories.map((s, i) => (
                  <div key={i}>
                    <dt className="font-medium">{s.title}</dt>
                    <dd className="text-fg-2">{s.body}</dd>
                  </div>
                ))}
              </dl>
            </Glance>
          )}
          {prep.pitch.length > 0 && (
            <Glance title="Role-play prep">
              {prep.pitch.map((q, i) => (
                <details key={i} className="border-t border-white/7 first:border-t-0 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="cursor-pointer py-2 text-[13px] font-medium">{q.title}</summary>
                  <p className="pb-2 text-[13px] whitespace-pre-line text-fg-2">{q.body}</p>
                </details>
              ))}
            </Glance>
          )}
          {prep.close.length > 0 && (
            <Glance title="The close">
              <TickList items={prep.close} onTick={(i) => tick("close", i)} />
            </Glance>
          )}
          {prep.ask.length > 0 && (
            <Glance title="Ask them">
              <TickList items={prep.ask} numbered onTick={(i) => tick("ask", i)} />
            </Glance>
          )}
          {prep.questions.length > 0 && (
            <Glance title="Expected questions">
              {prep.questions.map((q, i) => (
                <details key={i} className="border-t border-white/7 first:border-t-0 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="cursor-pointer py-2 text-[13px] font-medium">{q.title}</summary>
                  <p className="pb-2 text-[13px] whitespace-pre-line text-fg-2">{q.body || q.note}</p>
                </details>
              ))}
            </Glance>
          )}
        </aside>

        <section className="glass flex flex-col gap-2.5 rounded-xl p-4" aria-label="Call notes">
          {!ended && <GoDeep />}
          <div className="flex flex-wrap items-center gap-1.5">
            {TAGS.map((t) => (
              <button key={t} type="button" className="chip px-2.5 py-1 text-xs hover:border-white/30 hover:text-fg" onClick={() => insert(t)} disabled={ended}>
                + {t}
              </button>
            ))}
            <span className="ml-auto text-xs text-faint">{status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved" : "Saved"}</span>
          </div>
          <textarea
            ref={area}
            className="input min-h-[55vh] flex-1 resize-none font-mono text-[13px] leading-relaxed"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setStatus("unsaved");
            }}
            onKeyDown={onKey}
            placeholder={"Type as you go. Each new line is stamped with the time.\nTags add a labelled line: Comp, Next step, Red flag…"}
            aria-label="Notes"
            autoFocus
          />
          {ended && p.recording && (
            <div className="flex flex-col gap-1.5 border-t border-white/8 pt-3">
              <h2 className="text-sm font-semibold">Recording</h2>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- your own call recording */}
              <audio controls preload="none" src={`/api/calls/${p.callId}/recording`} className="h-9 w-full" />
            </div>
          )}
          {ended && (p.recording || p.transcriptStatus) && (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/8 pt-3 text-[13px]">
              <TranscriptStatus callId={p.callId} status={p.transcriptStatus} progress={p.transcribeProgress} error={p.transcribeError} hasRecording={!!p.recording} />
              {(p.transcriptStatus === "queued" || p.transcriptStatus === "transcribing" || p.transcriptStatus === "pending") && (
                <span className="text-muted">You can leave this page; the summary appears under Prep → Calls.</span>
              )}
            </div>
          )}
          {ended && p.review && <CallReviewView review={p.review} open />}
          {ended && !p.review && p.transcriptStatus === "done" && (
            <ReviewStatus callId={p.callId} status={p.reviewStatus} hasTranscript={p.hasTranscript} />
          )}
          {ended && p.summary && <CallSummaryView summary={p.summary} open />}
          {ended && !p.hasTranscript && !p.recording && <AfterCall callId={p.callId} />}
          {ended && p.hasTranscript && <p className="text-[13px] text-muted">Transcript saved. Claude reads it on the next queue run and adds the summary, next steps and people to this role.</p>}
        </section>
      </div>
    </div>
  );
}

function Glance({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass flex flex-col gap-2 rounded-xl p-4">
      <h2 className="label">{title}</h2>
      {children}
    </section>
  );
}

function AfterCall({ callId }: { callId: number }) {
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();
  if (done) return <p className="text-[13px] text-green">Saved. Claude reads it on the next queue run.</p>;
  return (
    <div className="flex flex-col gap-2 border-t border-white/8 pt-3">
      <h2 className="text-sm font-semibold">Add the transcript</h2>
      <p className="text-[13px] text-muted">Your notes are on the role&apos;s timeline. Add the Zoom or Meet transcript and Claude pulls out the summary, next steps, people and anything said about comp.</p>
      <TranscriptForm
        text={text}
        setText={setText}
        busy={busy}
        onSubmit={() =>
          start(async () => {
            await addTranscriptAction(callId, text);
            setDone(true);
          })
        }
      />
    </div>
  );
}

function useElapsed(startedAt: string, stopped: boolean) {
  const [nowMs, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (stopped) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stopped]);
  const s = Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 1000));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ── Local recording ─────────────────────────────────────────────────────────

type RecState = "idle" | "consent" | "recording" | "stopping" | "saved" | "error";

/**
 * Records your microphone plus the meeting's audio (you pick the Zoom / Meet
 * window or tab and tick "Share audio"). Audio is sent in 10-second pieces to
 * Pursuit on this computer, so a crash loses at most a few seconds.
 */
function Recorder({ callId, existing }: { callId: number; existing: string | null }) {
  const [state, setState] = useState<RecState>(existing ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<{ recorder: MediaRecorder; streams: MediaStream[]; ctx: AudioContext; seq: number; queue: Promise<unknown> } | null>(null);

  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopAll() {
    const r = rec.current;
    if (!r) return;
    if (r.recorder.state !== "inactive") r.recorder.stop();
    r.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void r.ctx.close();
  }

  async function begin() {
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      setState("error");
      setError("Recording works on this computer only (open Pursuit at localhost), in Chrome or Edge.");
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      let meeting: MediaStream | null = null;
      try {
        meeting = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        meeting.getVideoTracks().forEach((t) => t.stop()); // audio only
        if (meeting.getAudioTracks().length === 0) {
          meeting = null;
          setError("No meeting audio shared (tick “Share audio” next time). Recording your mic only.");
        }
      } catch {
        setError("Meeting audio not shared. Recording your mic only.");
      }
      const ctx = new AudioContext();
      const out = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(mic).connect(out);
      if (meeting) ctx.createMediaStreamSource(meeting).connect(out);
      const recorder = new MediaRecorder(out.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 48_000 });
      const r = { recorder, streams: [mic, ...(meeting ? [meeting] : [])], ctx, seq: 0, queue: Promise.resolve() as Promise<unknown> };
      recorder.ondataavailable = (e) => {
        if (!e.data.size) return;
        const seq = r.seq++;
        r.queue = r.queue.then(() =>
          fetch(`/api/calls/${callId}/recording?seq=${seq}`, { method: "POST", body: e.data, headers: { "Content-Type": "audio/webm" } }).then((res) => {
            if (!res.ok) throw new Error(`Upload failed (${res.status})`);
          }),
        ).catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
      };
      recorder.onstop = async () => {
        await r.queue;
        setState("saved");
      };
      // If you stop sharing from the browser bar, keep recording the mic.
      recorder.start(10_000);
      rec.current = r;
      setState("recording");
    } catch (err) {
      setState("error");
      setError(err instanceof Error && err.name === "NotAllowedError" ? "Microphone access was blocked." : String(err));
    }
  }

  if (state === "consent") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/10 px-3 py-1.5 text-xs text-amber-soft">
        <span>Tell everyone on the call it&apos;s being recorded, and only record if they agree.</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={begin}>
          They&apos;ve agreed · start
        </button>
        <button type="button" className="btn-link" onClick={() => setState("idle")}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {state === "recording" ? (
        <button
          type="button"
          className="btn btn-sm border border-red/50 bg-red/15 text-[#FFB3BA]"
          onClick={() => {
            setState("stopping");
            stopAll();
          }}
        >
          <span className="size-2 animate-pulse rounded-full bg-red" aria-hidden="true" /> Recording · stop
        </button>
      ) : state === "stopping" ? (
        <span className="text-xs text-muted">Saving recording…</span>
      ) : state === "saved" ? (
        <a href={`/api/calls/${callId}/recording`} className="chip px-2.5 py-1" target="_blank" rel="noreferrer">
          Recording saved · play
        </a>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setState("consent")}>
          <MicIcon size={14} /> Record
        </button>
      )}
      {error && <span className="max-w-[260px] text-xs text-amber-soft">{error}</span>}
    </div>
  );
}
