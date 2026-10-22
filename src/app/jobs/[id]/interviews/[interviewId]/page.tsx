import Link from "next/link";
import { notFound } from "next/navigation";
import { CallRecordCard, DebriefEditor, InterviewActions, type CallRecord } from "@/components/InterviewDetail";
import { PracticeQuestions } from "@/components/PracticeQuestions";
import { Logo } from "@/components/ui";
import { get } from "@/lib/db";
import { clock, dayDate, dayFromNow, when } from "@/lib/format";
import { getPrep, isPrepPending, listCalls, type CallSummary, type PrepItem } from "@/lib/prep";
import { getRole } from "@/lib/repo";
import type { CallReview } from "@/lib/review";
import type { Interview } from "@/lib/types";
import { interviewStage } from "@/lib/view";

export const dynamic = "force-dynamic";

const STATUS = {
  scheduled: { label: "Scheduled", cls: "bg-white/8 text-fg-2" },
  done: { label: "Done", cls: "bg-green/14 text-green" },
  cancelled: { label: "Cancelled", cls: "bg-red/12 text-[#FFB3BA]" },
} as const;

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** One interview: the round, its prep, and everything captured on its calls. */
export default async function InterviewPage({ params }: { params: Promise<{ id: string; interviewId: string }> }) {
  const { id, interviewId } = await params;
  const jobId = Number(id);
  const role = getRole(jobId);
  const iv = get<Interview>("SELECT * FROM interviews WHERE id = ? AND job_id = ?", Number(interviewId), jobId);
  if (!role || !iv) notFound();

  const now = new Date();
  const stage = interviewStage(iv.name, iv.round, role.stage);
  const whenText = iv.starts_at ? `${dayDate(iv.starts_at)} · ${clock(iv.starts_at)}` : "Time not set";
  const upcoming = iv.starts_at && new Date(iv.starts_at) > now ? dayFromNow(iv.starts_at, now) : null;
  const prep = getPrep(jobId)!.content;
  const tasksDone = prep.tasks.filter((t) => t.done).length;

  const calls: CallRecord[] = listCalls(jobId)
    .filter((c) => c.interview_id === iv.id)
    .map((c) => ({
      id: c.id,
      title: c.title ?? "Call",
      when: when(c.started_at, now) ?? "",
      ended: !!c.ended_at,
      notes: c.notes,
      recording: !!c.recording_path,
      transcript: c.transcript,
      status: c.transcript_status,
      progress: c.transcribe_progress,
      error: c.transcribe_error,
      summary: c.summary ? (JSON.parse(c.summary) as CallSummary) : null,
      review: c.review ? (JSON.parse(c.review) as CallReview) : null,
      reviewStatus: c.review_status,
    }));
  const unlinked = listCalls(jobId).filter((c) => c.interview_id === null).length;

  const prepFocus = `${stage}: ${iv.name}${iv.attendees ? ` with ${iv.attendees}` : ""}${iv.starts_at ? ` (${dayDate(iv.starts_at)})` : ""}${iv.format ? `, ${iv.format}` : ""}`;
  const toAsk: PrepItem[] = [...prep.gaps, ...prep.them.filter((t) => t.kind !== "know").slice(0, 6), ...prep.ask];

  return (
    <div className="flex flex-col gap-5 px-4 py-5 md:px-8 md:py-6">
      <div className="text-[13px] text-muted">
        <Link href="/" className="btn-link">
          Roles
        </Link>{" "}
        /{" "}
        <Link href={`/jobs/${jobId}?tab=interviews`} className="btn-link">
          {role.company_name}
        </Link>{" "}
        / Interviews / {stage}
      </div>

      <header className="glass flex flex-col gap-4 rounded-xl p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Logo name={role.company_name} color={role.company_color} logo={role.company_logo} size={48} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip border-accent/40 bg-accent/12 font-semibold text-accent-soft">{stage}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[iv.status].cls}`}>{STATUS[iv.status].label}</span>
              {upcoming && <span className="text-xs font-semibold text-accent-soft">{upcoming}</span>}
            </div>
            <h1 className="text-xl leading-snug font-semibold tracking-[-0.02em] md:text-2xl">{iv.name}</h1>
            <p className="text-sm text-muted">
              {role.company_name} · {role.title}
            </p>
            <p className="flex flex-wrap gap-x-3 text-sm text-fg-2">
              <span className="font-mono">{whenText}</span>
              {iv.duration_min && <span>{iv.duration_min} min</span>}
              {iv.format && <span>{iv.format}</span>}
            </p>
            {iv.attendees && <p className="text-[13px] text-muted">With {iv.attendees}</p>}
          </div>
        </div>
        <InterviewActions
          iv={{ id: iv.id, jobId, name: iv.name, startsLocal: toLocalInput(iv.starts_at), duration: iv.duration_min, format: iv.format, attendees: iv.attendees, status: iv.status }}
          prepFocus={prepFocus}
          prepPending={isPrepPending(jobId)}
        />
      </header>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Calls: what happened */}
        <div className="flex flex-col gap-4">
          <h2 className="text-[15px] font-semibold">Calls {calls.length > 0 && <span className="font-mono text-xs font-normal text-muted">{calls.length}</span>}</h2>
          {calls.length === 0 ? (
            <div className="glass rounded-xl p-5 text-sm text-muted">
              No calls recorded for this round yet. Open <b>Call mode</b> when it starts to take timestamped notes and record it; the transcript, summary and review
              will appear here.
              {unlinked > 0 && (
                <>
                  {" "}
                  This role has {unlinked} {unlinked === 1 ? "call" : "calls"} not linked to an interview: link {unlinked === 1 ? "it" : "them"} from{" "}
                  <Link href={`/jobs/${jobId}?tab=prep`} className="btn-link">
                    Prep → Calls
                  </Link>
                  .
                </>
              )}
            </div>
          ) : (
            calls.map((c, i) => <CallRecordCard key={c.id} call={c} first={i === 0} />)
          )}

          <section className="glass flex flex-col gap-2 rounded-xl p-5">
            <h2 className="text-[15px] font-semibold">Your debrief</h2>
            <DebriefEditor interviewId={iv.id} initial={iv.debrief ?? ""} />
          </section>
        </div>

        {/* Prep: what to bring */}
        <aside className="flex flex-col gap-4">
          <section className="glass flex flex-col gap-3 rounded-xl p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[15px] font-semibold">Prep for this round</h2>
              <span className="font-mono text-xs text-muted">
                {tasksDone}/{prep.tasks.length} done
              </span>
              <Link href={`/jobs/${jobId}?tab=prep`} className="btn-link ml-auto text-[13px]">
                Open full prep
              </Link>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-accent" style={{ width: `${prep.tasks.length ? (tasksDone / prep.tasks.length) * 100 : 0}%` }} />
            </div>
            {prep.focus && <p className="text-xs text-faint">Last prepared for: {prep.focus}</p>}
            {prep.round.length > 0 && (
              <dl className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
                {prep.round.map((r, i) => (
                  <div key={i} className="rounded-md border border-white/7 bg-white/4 p-2.5">
                    <dt className="label">{r.title}</dt>
                    <dd className="text-fg-2">{r.body}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {prep.interviewers.length > 0 && (
            <section className="glass flex flex-col gap-2 rounded-xl p-5">
              <h2 className="text-[15px] font-semibold">Who you&apos;re meeting</h2>
              {prep.interviewers.map((p, i) => (
                <details key={i} className="border-t border-white/7 first:border-t-0 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="cursor-pointer py-2 text-sm font-medium">{p.title}</summary>
                  <div className="flex flex-col gap-1 pb-2 text-[13px]">
                    {p.body && <p className="whitespace-pre-line text-fg-2">{p.body}</p>}
                    {p.note && <p className="text-muted">Likely success criteria: {p.note}</p>}
                  </div>
                </details>
              ))}
            </section>
          )}

          <section className="glass flex flex-col gap-3 rounded-xl p-5">
            <h2 className="text-[15px] font-semibold">Questions to expect</h2>
            {prep.questions.length === 0 ? (
              <p className="text-sm text-muted">None yet: use “Prepare Claude for this round”.</p>
            ) : (
              <PracticeQuestions jobId={jobId} items={prep.questions} />
            )}
          </section>

          <section className="glass flex flex-col gap-2 rounded-xl p-5">
            <h2 className="text-[15px] font-semibold">Questions for them</h2>
            {toAsk.length === 0 ? (
              <p className="text-sm text-muted">None yet.</p>
            ) : (
              <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-[13px] text-fg-2">
                {toAsk.slice(0, 10).map((q, i) => (
                  <li key={i}>{q.title}</li>
                ))}
              </ol>
            )}
            {prep.close.length > 0 && (
              <div className="mt-1 rounded-md border border-amber/30 bg-amber/8 p-2.5 text-[13px]">
                <span className="label">The close</span>
                <ul className="flex flex-col gap-1 text-amber-soft">
                  {prep.close.map((c, i) => (
                    <li key={i}>“{c.title}”</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
