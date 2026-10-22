import Link from "next/link";
import { notFound } from "next/navigation";
import { ChangeFeed } from "@/components/ChangeFeed";
import { LinkIcon } from "@/components/icons";
import {
  AddContactForm,
  DeleteRoleButton,
  AddNoteForm,
  EditableField,
  InterviewList,
  JobTabs,
  NextStepBanner,
  NotesEditor,
  ResearchStatus,
  StageSelect,
  TaskList,
} from "@/components/job";
import { Logo, StageBar, STAGE_COLOR } from "@/components/ui";
import { initials, money, ote, relTime, split, when } from "@/lib/format";
import {
  fieldProvenance,
  getCompany,
  getRole,
  listContacts,
  listEvents,
  listInterviews,
  listTasks,
} from "@/lib/repo";
import { JOB_FIELDS, SOURCE_LABEL, STAGE_LABEL, type Contact, type Job, type JobField } from "@/lib/types";
import { displayValue, interviewStage, nextStep, stageSub, toFeedItem } from "@/lib/view";
import { isResearchPending } from "@/lib/research";
import { RatingPanel } from "@/components/rating";
import { ratingsOf } from "@/lib/rating";
import { PrepSheet } from "@/components/prep";
import { listStars } from "@/lib/star";
import type { CallReview } from "@/lib/review";
import { EditRole } from "@/components/EditRole";
import { get } from "@/lib/db";
import { getPrep, getResume, isPrepPending, listCalls, type CallSummary } from "@/lib/prep";

export const dynamic = "force-dynamic";

const COMP_FIELDS: JobField[] = [
  "base_k", "variable_k", "quota_k", "equity", "acv", "sales_cycle",
  "segment", "territory", "team_size", "ramp", "attainment",
];
const ROLE_FIELDS: JobField[] = ["title", "location", "url", "rank", "fit", "stage_detail"];

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const jobId = Number(id);
  const role = Number.isInteger(jobId) ? getRole(jobId) : undefined;
  if (!role) notFound();

  const now = new Date();
  const company = getCompany(role.company_id)!;
  const events = listEvents(jobId).map((e) => toFeedItem(e, now));
  const provenance = fieldProvenance(jobId);
  const contacts = listContacts(jobId);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = (iso: string | null) => !!iso && new Date(iso) >= today && new Date(iso) < tomorrow;

  const tasks = listTasks(jobId).map((t) => ({
    id: t.id,
    title: t.title,
    due: when(t.due_at, now),
    done: !!t.done_at,
    overdue: !!t.due_at && new Date(t.due_at) < today,
    source: SOURCE_LABEL[t.source] ?? t.source,
    kind: t.kind === "call" ? ("call" as const) : ("task" as const),
    dueIso: t.due_at,
  }));
  const roleCalls = listCalls(jobId);
  const interviews = listInterviews(jobId).map((iv) => {
    const mine = roleCalls.filter((c) => c.interview_id === iv.id);
    const reviewed = mine.map((c) => (c.review ? (JSON.parse(c.review) as CallReview).overall : null)).find((x) => x !== null) ?? null;
    return {
    id: iv.id,
    round: iv.round,
    stage: interviewStage(iv.name, iv.round, role.stage),
    callCount: mine.length,
    reviewScore: reviewed,
    hasSummary: mine.some((c) => !!c.summary),
    name: iv.name,
    when: when(iv.starts_at, now),
    duration: iv.duration_min,
    format: iv.format,
    attendees: iv.attendees,
    status: iv.status,
    debrief: iv.debrief,
    isToday: isToday(iv.starts_at),
  };
  });

  const oteK = ote(role.base_k, role.variable_k);
  const ratio = oteK && role.quota_k ? `${(role.quota_k / oteK).toFixed(1)}×` : null;
  const gaps = COMP_FIELDS.filter((f) => role[f] === null).map((f) => JOB_FIELDS[f].label);

  const fieldRow = (f: JobField) => {
    const p = provenance[f];
    const raw = role[f as keyof Job];
    return {
      field: f,
      label: JOB_FIELDS[f].label,
      raw: raw === null || raw === undefined ? "" : String(raw),
      display: displayValue(f, raw === null || raw === undefined ? null : String(raw)),
      numeric: JOB_FIELDS[f].type === "number",
      source: p ? `${SOURCE_LABEL[p.source] ?? p.source} · ${relTime(p.occurred_at, now)}` : null,
      detail: p?.title ?? null,
    };
  };

  const overview = (
    <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-[18px]">
        <Panel title="Next steps">
          <TaskList jobId={jobId} tasks={tasks} />
        </Panel>
        <Panel title="Latest activity">
          <AddNoteForm jobId={jobId} />
          <ChangeFeed items={events.slice(0, 6)} showCompany={false} />
        </Panel>
        {role.jd && (
          <details className="glass rounded-xl p-[22px] [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer text-[15px] font-semibold">
              Job ad <span className="text-[13px] font-normal text-muted">(expand)</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-fg-2">{role.jd}</p>
          </details>
        )}
        <Panel title="Company snapshot">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Stat label="Stage" value={company.funding_stage} />
            <Stat label="Headcount" value={company.headcount} />
            <Stat label="HQ / local" value={company.hq} />
            <Stat label="Glassdoor" value={company.glassdoor} />
          </div>
          <p className="text-sm leading-relaxed text-fg-2">
            {company.summary ?? "No company summary yet. Click “Research with Claude” above to fill this in."}
          </p>
          {(company.domain || company.careers_url) && (
            <div className="flex gap-4 text-[13px]">
              {company.domain && (
                <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" className="btn-link inline-flex items-center gap-1">
                  <LinkIcon size={13} /> {company.domain}
                </a>
              )}
              {company.careers_url && (
                <a href={company.careers_url} target="_blank" rel="noreferrer" className="btn-link inline-flex items-center gap-1">
                  <LinkIcon size={13} /> Careers page
                </a>
              )}
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-[18px]">
        <Panel title="Your rating">
          <RatingPanel jobId={jobId} ratings={ratingsOf(role)} />
        </Panel>
        <Panel title="Comp at a glance">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-4xl leading-none font-medium tracking-[-0.04em]">{money(oteK) ?? "OTE unknown"}</span>
            {split(role.base_k, role.variable_k) && <span className="text-sm text-muted">OTE · {split(role.base_k, role.variable_k)}</span>}
          </div>
          {role.base_k !== null && role.variable_k !== null && oteK ? (
            <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
              <div className="bg-fg" style={{ flex: role.base_k }} />
              <div className="bg-accent shadow-[0_0_10px_#6E8BFF]" style={{ flex: role.variable_k }} />
            </div>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <Mini label="Base" value={money(role.base_k)} />
            <Mini label="Quota" value={money(role.quota_k)} />
            <Mini label="Quota ÷ OTE" value={ratio} />
            <Mini label="Avg. deal" value={role.acv} />
            <Mini label="Team" value={role.team_size} />
            <Mini label="Ramp" value={role.ramp} />
          </dl>
          {gaps.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-amber/28 bg-amber/10 p-3">
              <span className="text-[13px] font-semibold text-amber-soft">
                {gaps.length} {gaps.length === 1 ? "gap" : "gaps"} to ask about
              </span>
              <span className="text-[13px] text-[#E9D2AE]">{gaps.join(" · ")}</span>
            </div>
          )}
        </Panel>
        <Panel title="People">
          {contacts.length === 0 ? (
            <p className="text-sm text-muted">No contacts yet.</p>
          ) : (
            contacts.slice(0, 4).map((c) => <PersonRow key={c.id} c={c} />)
          )}
        </Panel>
      </div>
    </div>
  );

  const compTab = (
    <section className="glass overflow-hidden rounded-xl">
      {[
        { heading: "Comp & territory", fields: COMP_FIELDS },
        { heading: "Role", fields: ROLE_FIELDS },
      ].map((group) => (
        <div key={group.heading}>
          <div className="grid grid-cols-1 bg-white/4 px-4 py-3 md:grid-cols-[220px_1fr_1fr] md:px-5">
            <span className="label">{group.heading}</span>
            <span className="label hidden md:inline">Value</span>
            <span className="label hidden md:inline">Source</span>
          </div>
          {group.fields.map(fieldRow).map((r) => (
            <div key={r.field} className="grid grid-cols-1 gap-1 border-t border-white/7 px-4 py-3 text-sm md:grid-cols-[220px_1fr_1fr] md:items-center md:gap-0 md:px-5 md:py-2.5">
              <span className="text-muted">{r.label}</span>
              <EditableField jobId={jobId} field={r.field} raw={r.raw} display={r.display} numeric={r.numeric} />
              <span className="flex flex-col text-[13px]">
                {r.source ? (
                  <>
                    <span className="text-fg-2">{r.source}</span>
                    <span className="truncate text-xs text-faint">{r.detail}</span>
                  </>
                ) : (
                  <span className="text-amber-soft">Gap: ask in the next conversation</span>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );

  const peopleTab = (
    <div className="flex flex-col gap-4">
      {contacts.length === 0 && <p className="text-sm text-muted">No contacts yet.</p>}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {contacts.map((c) => (
          <div key={c.id} className="glass flex flex-col gap-2.5 rounded-xl p-[18px]">
            <PersonRow c={c} />
            {c.notes && <p className="text-[13px] leading-relaxed text-fg-2">{c.notes}</p>}
            {c.email && (
              <a href={`mailto:${c.email}`} className="btn-link text-xs">
                {c.email}
              </a>
            )}
          </div>
        ))}
      </div>
      <AddContactForm jobId={jobId} />
    </div>
  );

  const prep = getPrep(jobId)!;
  const resume = getResume();
  const calls = listCalls(jobId).map((c) => ({
    id: c.id,
    title: c.title ?? "Call",
    when: when(c.started_at, now) ?? "",
    ended: !!c.ended_at,
    hasNotes: !!c.notes.trim(),
    status: c.transcript_status,
    progress: c.transcribe_progress,
    error: c.transcribe_error,
    recording: !!c.recording_path,
    summary: c.summary ? (JSON.parse(c.summary) as CallSummary) : null,
    hasTranscript: !!c.transcript,
    review: c.review ? (JSON.parse(c.review) as CallReview) : null,
    reviewStatus: c.review_status,
    interviewId: c.interview_id,
  }));
  const prepTab = (
    <PrepSheet
      jobId={jobId}
      company={role.company_name}
      ratings={ratingsOf(role)}
      stars={listStars().map((s) => ({ id: s.id, title: s.title, competencies: s.competencies, situation: s.situation, task: s.task, action: s.action, result: s.result, spoken: s.spoken }))}
      prep={prep.content}
      saved={prep.saved}
      updated={prep.updated_at ? relTime(prep.updated_at, now) : null}
      pending={isPrepPending(jobId)}
      resume={{ text: resume.text, url: resume.url }}
      calls={calls}
      interviews={listInterviews(jobId).filter((iv) => iv.status === "scheduled").map((iv) => ({ id: iv.id, name: iv.name }))}
      rounds={listInterviews(jobId).map((iv) => ({ id: iv.id, name: `${interviewStage(iv.name, iv.round, role.stage)}: ${iv.name}` }))}
    />
  );

  const next = nextStep(role, now);
  const sub = stageSub(role);

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-[18px] px-4 pt-5 md:px-8 md:pt-6">
        <div className="text-[13px] text-muted">
          <Link href="/" className="btn-link">
            Roles
          </Link>{" "}
          / {STAGE_LABEL[role.stage]} / {role.company_name}
        </div>
        <div className="flex flex-wrap items-center gap-[18px]">
          <Logo name={role.company_name} color={role.company_color} logo={role.company_logo} size={60} />
          <div className="flex min-w-0 flex-1 basis-[calc(100%-78px)] flex-col gap-1.5 md:basis-auto">
            <h1 className="text-2xl leading-[1.1] font-semibold tracking-[-0.035em] md:text-[32px] md:leading-[1.05]">{role.title}</h1>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span>{role.company_name}</span>
              {role.location && <span>· {role.location}</span>}
              <span>· Added {relTime(role.created_at, now)}</span>
              {role.url && (
                <a href={role.url} target="_blank" rel="noreferrer" className="btn-link inline-flex items-center gap-1">
                  · <LinkIcon size={13} /> Job ad
                </a>
              )}
            </p>
          </div>
          <div className="glass flex items-center rounded-[10px]">
            <Score label="Rank" value={role.rank !== null ? `#${role.rank}` : "—"} />
            <Score label="Fit" value={role.fit !== null ? String(role.fit) : "—"} last />
          </div>
          <StageSelect jobId={jobId} stage={role.stage} />
          <EditRole
            jobId={jobId}
            initial={{ company: role.company_name, website: company.domain ?? "", title: role.title, url: role.url ?? "", location: role.location ?? "" }}
            sharedWith={get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE company_id = ?", role.company_id)!.n - 1}
          />
        </div>

        <div className="flex flex-col gap-2">
          <StageBar stage={role.stage} height={5} />
          <div className="flex justify-between text-xs">
            <span className="font-semibold" style={{ color: STAGE_COLOR[role.stage] }}>
              {STAGE_LABEL[role.stage]}
            </span>
            <span className="text-muted">{sub}</span>
          </div>
        </div>

        <NextStepBanner next={next} />
        <div className="flex items-center gap-3">
          <p className="text-xs text-faint">
            Updated {relTime(role.updated_at, now)}
            {role.updated_source ? ` · ${SOURCE_LABEL[role.updated_source]}` : ""}
          </p>
          <div className="ml-auto">
            <ResearchStatus jobId={jobId} pending={isResearchPending(jobId)} />
          </div>
        </div>
      </div>

      <JobTabs
        initial={tab}
        tabs={[
          { id: "overview", label: "Overview", content: overview },
          { id: "prep", label: "Prep", content: prepTab },
          { id: "comp", label: "Comp & role", content: compTab },
          { id: "timeline", label: `Timeline (${events.length})`, content: <section className="glass rounded-xl px-5 py-2"><ChangeFeed items={events} showCompany={false} /></section> },
          { id: "interviews", label: `Interviews (${interviews.length})`, content: <InterviewList jobId={jobId} interviews={interviews} /> },
          { id: "people", label: `People (${contacts.length})`, content: peopleTab },
          { id: "notes", label: "Notes", content: (
            <div className="flex flex-col gap-4">
              <section className="glass rounded-xl p-5"><NotesEditor jobId={jobId} initial={role.notes} /></section>
              <div className="flex items-center gap-3 text-[13px] text-muted">
                <DeleteRoleButton jobId={jobId} label={`${role.company_name} · ${role.title}`} />
                Removes this role and its history. To keep it but stop tracking, use Try later or Closed instead.
              </div>
            </div>
          ) },
        ]}
      />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass flex flex-col gap-3.5 rounded-xl p-[22px]">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/7 bg-white/4 p-3">
      <span className="label">{label}</span>
      <span className={`text-[15px] font-semibold ${value ? "" : "text-faint"}`}>{value ?? "—"}</span>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-faint">{label}</dt>
      <dd className={`font-mono text-sm ${value ? "" : "text-amber-soft"}`}>{value ?? "Ask"}</dd>
    </div>
  );
}

function Score({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex flex-col items-center px-[18px] py-2 ${last ? "" : "border-r border-white/10"}`}>
      <span className="font-mono text-[22px] font-medium">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

function PersonRow({ c }: { c: Contact }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-[34px] shrink-0 items-center justify-center rounded-full border border-white/14 bg-white/8 text-xs font-semibold">
        {initials(c.name)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{c.name}</span>
        <span className="truncate text-xs text-muted">{c.title}</span>
      </div>
      {c.role && <span className="chip">{c.role}</span>}
    </div>
  );
}
