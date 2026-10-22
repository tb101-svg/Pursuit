import "server-only";
import { all, get, run, tx } from "../db";
import { notify } from "../bus";
import {
  addContact,
  addInterview,
  addTask,
  cancelInterview,
  createJob,
  recordEvent,
  rescheduleInterview,
  setStage,
  updateJob,
} from "../engine";
import type { Extraction } from "../ai/extract";
import { JOB_FIELDS, STAGES, isJobField, type Facts, type FieldValue, type Job, type JobField, type Source } from "../types";
import { displayValue } from "../view";

/**
 * Turns an analysed email into updates on a role. Objective, non-conflicting
 * information is applied straight away (and can be undone from Changes);
 * anything that would overwrite a different existing value goes to "Needs you".
 */

export interface EmailRef {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  href: string;
}

const KIND_LABEL: Record<Extraction["kind"], string> = {
  interview_invite: "Interview invite",
  interview_reschedule: "Interview moved",
  interview_cancel: "Interview cancelled",
  rejection: "Rejection",
  offer: "Offer",
  recruiter_outreach: "Recruiter outreach",
  application_confirmation: "Application confirmed",
  update: "Email",
  other: "Email",
};

const now = () => new Date().toISOString();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function stageRank(stage: string) {
  return (STAGES as readonly string[]).indexOf(stage);
}

export function linkThread(threadId: string, jobId: number | null, status: "linked" | "ignored", subject: string | null) {
  run(
    `INSERT INTO email_threads (thread_id, job_id, status, subject, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET job_id = excluded.job_id, status = excluded.status, updated_at = excluded.updated_at`,
    threadId,
    jobId,
    status,
    subject,
    now(),
  );
}

export function applyExtraction(jobId: number, x: Extraction, ref: EmailRef, source: Source = "gmail") {
  tx(() => {
    const job = get<Job>("SELECT * FROM jobs WHERE id = ?", jobId);
    if (!job) throw new Error(`Role ${jobId} not found`);
    const meta = { source, at: ref.date };

    // 1. Facts: fill gaps; a different existing value becomes a conflict to review.
    const fill: Facts = {};
    const conflicts: { field: string; current: FieldValue; value: FieldValue }[] = [];
    for (const [field, value] of Object.entries(x.facts)) {
      if (value === null || !isJobField(field)) continue;
      const current = job[field as keyof Job] as FieldValue;
      if (current === null || current === "") fill[field] = value;
      else if (String(current).trim().toLowerCase() !== String(value).trim().toLowerCase()) {
        conflicts.push({ field, current, value });
      }
    }

    // 2. Stage: only forward, except closing (rejection) which can happen any time.
    // They got back to you after going quiet: back into play (1st stage unless the email says more).
    if (job.stage === "no_reply" && x.relevant && x.stage !== "closed" && stageRank(x.stage ?? "found") < stageRank("screening")) {
      fill.stage = "screening";
      fill.stage_detail = null;
    }
    if (x.stage && x.stage !== job.stage && job.stage !== "closed") {
      if (x.stage === "closed" || stageRank(x.stage) > stageRank(job.stage)) {
        fill.stage = x.stage;
        fill.stage_detail = null;
        if (x.stage === "closed") fill.closed_reason = x.closed_reason ?? "Rejected";
      }
    }

    // 3. The email itself, with its summary and any insights, in the timeline.
    const body = [x.summary, ...x.insights.map((i) => `• ${i}`)].join("\n");
    recordEvent({
      jobId,
      kind: "email",
      source,
      occurredAt: ref.date,
      title: `${KIND_LABEL[x.kind]}: ${ref.subject || "(no subject)"}`,
      body,
      facts: fill,
      payload: { href: ref.href, messageId: ref.messageId, from: ref.from },
    });

    // 4. Interviews.
    if (x.interview) applyInterview(jobId, x.interview, ref, source);

    // 5. What you need to do next.
    if (x.next_step) {
      const open = all<{ title: string }>("SELECT title FROM tasks WHERE job_id = ? AND done_at IS NULL", jobId);
      if (!open.some((t) => norm(t.title) === norm(x.next_step!.title))) {
        addTask(jobId, x.next_step.title, validIso(x.next_step.due_at), meta);
      }
    }

    // 6. The sender, as a contact.
    if (x.contact) {
      const email = x.contact.email?.toLowerCase() ?? null;
      const existing = get<{ id: number }>(
        "SELECT id FROM contacts WHERE company_id = ? AND (lower(email) = ? OR lower(name) = lower(?))",
        job.company_id,
        email,
        x.contact.name,
      );
      if (existing) run("UPDATE contacts SET last_contact_at = ? WHERE id = ?", ref.date, existing.id);
      else {
        const id = addContact(jobId, { name: x.contact.name, title: x.contact.title, email, role: x.contact.role }, meta);
        if (id) run("UPDATE contacts SET last_contact_at = ? WHERE id = ?", ref.date, id);
      }
    }

    // 7. Conflicts wait for you.
    for (const c of conflicts) {
      const field = c.field as JobField;
      const show = (v: FieldValue) => displayValue(field, v === null ? null : String(v));
      createProposal("conflict", jobId, source, `${JOB_FIELDS[field].label}: email says ${show(c.value)}, you have ${show(c.current)}`, ref.subject, {
        field: c.field,
        value: c.value,
        current: c.current,
        ref,
      });
    }

    linkThread(ref.threadId, jobId, "linked", ref.subject);
  });
}

function validIso(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function applyInterview(jobId: number, iv: NonNullable<Extraction["interview"]>, ref: EmailRef, source: Source) {
  const meta = { source, at: ref.date, href: ref.href };
  const startsAt = validIso(iv.starts_at);
  const scheduled = all<{ id: number; name: string; starts_at: string | null }>(
    "SELECT id, name, starts_at FROM interviews WHERE job_id = ? AND status = 'scheduled' ORDER BY starts_at IS NULL, starts_at",
    jobId,
  );
  const byName = scheduled.find((s) => norm(s.name).includes(norm(iv.name)) || norm(iv.name).includes(norm(s.name)));

  if (iv.action === "cancel") {
    const target = byName ?? scheduled[0];
    if (target) cancelInterview(target.id, meta);
    return;
  }
  if (iv.action === "reschedule") {
    const target = byName ?? scheduled[0];
    if (target && startsAt) rescheduleInterview(target.id, startsAt, meta);
    else if (!target) addInterview(jobId, { name: iv.name, startsAt, durationMin: iv.duration_min, format: iv.format, attendees: iv.attendees }, meta);
    return;
  }
  // schedule: avoid duplicates (same round, or anything within 3 hours of the same time).
  const near = startsAt
    ? scheduled.find((s) => s.starts_at && Math.abs(new Date(s.starts_at).getTime() - new Date(startsAt).getTime()) < 3 * 3600_000)
    : undefined;
  if (near) return;
  if (byName) {
    // Same round confirmed for a (new) time: that time wins.
    if (startsAt && byName.starts_at !== startsAt) rescheduleInterview(byName.id, startsAt, meta);
    return;
  }
  addInterview(jobId, { name: iv.name, startsAt, durationMin: iv.duration_min, format: iv.format, attendees: iv.attendees }, meta);
}

// ── Needs you (proposals) ───────────────────────────────────────────────────

export type ProposalKind = "match_email" | "conflict" | "match_event";

export function createProposal(kind: ProposalKind, jobId: number | null, source: Source, title: string, detail: string | null, payload: unknown) {
  const id = run(
    "INSERT INTO proposals (kind, job_id, source, title, detail, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    kind,
    jobId,
    source,
    title,
    detail,
    JSON.stringify(payload),
    now(),
  );
  notify(jobId);
  return id;
}

export interface MatchEmailPayload {
  threadId: string;
  suggestedJobId: number | null;
  company: string | null;
  role: string | null;
  items: { ref: EmailRef; extraction: Extraction }[];
}

/** An email that couldn't be tied to a role with confidence. Later emails in the same thread join the same card. */
export function proposeEmailMatch(ref: EmailRef, x: Extraction, source: Source = "gmail") {
  const open = get<{ id: number; payload: string }>(
    "SELECT id, payload FROM proposals WHERE kind = 'match_email' AND resolved_at IS NULL AND json_extract(payload, '$.threadId') = ?",
    ref.threadId,
  );
  if (open) {
    const p = JSON.parse(open.payload) as MatchEmailPayload;
    p.items.push({ ref, extraction: x });
    run("UPDATE proposals SET payload = ?, detail = ? WHERE id = ?", JSON.stringify(p), x.summary, open.id);
    notify(null);
    return open.id;
  }
  const company = x.job_match.company_name;
  const role = x.job_match.role_title;
  const payload: MatchEmailPayload = {
    threadId: ref.threadId,
    suggestedJobId: x.job_match.job_id,
    company,
    role,
    items: [{ ref, extraction: x }],
  };
  const what = [company, role].filter(Boolean).join(" · ") || "an unknown role";
  return createProposal("match_email", null, source, `Email about ${what}: “${ref.subject}”`, x.summary, payload);
}

export interface MatchEventPayload {
  eventId: string;
  provider: string | null;
  summary: string;
  startsAt: string;
  durationMin: number | null;
  format: string | null;
  attendees: string | null;
  href: string | null;
}

function resolve(id: number, resolution: string) {
  run("UPDATE proposals SET resolved_at = ?, resolution = ? WHERE id = ?", now(), resolution, id);
}

/**
 * Applies your decision on a "Needs you" card.
 * - match_email: link to a role, create a new role, or ignore the thread
 * - conflict: use the email's value, or keep yours
 * - match_event: link the calendar event to a role, or ignore it
 */
export function resolveProposal(id: number, action: "link" | "create" | "apply" | "keep" | "ignore", jobId?: number) {
  const p = get<{ id: number; kind: ProposalKind; job_id: number | null; source: Source; payload: string; resolved_at: string | null }>(
    "SELECT * FROM proposals WHERE id = ?",
    id,
  );
  if (!p || p.resolved_at) return;
  const payload = JSON.parse(p.payload);

  tx(() => {
    if (p.kind === "match_email") {
      const m = payload as MatchEmailPayload;
      const first = m.items[0];
      if (action === "ignore") {
        linkThread(m.threadId, null, "ignored", first.ref.subject);
      } else {
        let target = action === "link" ? jobId : undefined;
        if (action === "create") {
          target = createJob({
            company: { name: m.company ?? domainName(first.ref.from) },
            title: m.role ?? "Role (title unknown)",
            source: p.source,
            at: first.ref.date,
            note: `Created from email: “${first.ref.subject}”`,
          });
        }
        if (!target) throw new Error("Choose a role to link to");
        for (const item of m.items) applyExtraction(target, item.extraction, item.ref, p.source);
      }
    } else if (p.kind === "conflict") {
      if (action === "apply" && p.job_id) {
        const { field, value, ref } = payload as { field: string; value: FieldValue; ref: EmailRef };
        if (isJobField(field)) {
          updateJob(p.job_id, { [field]: value } as Facts, { source: p.source }, `Updated from email: ${ref.subject}`);
        }
      }
    } else if (p.kind === "match_event") {
      const e = payload as MatchEventPayload;
      if (action === "ignore") {
        run("UPDATE calendar_links SET status = 'ignored', updated_at = ? WHERE event_id = ?", now(), e.eventId);
      } else if (jobId) {
        linkEventToJob(jobId, e);
      }
    }
    resolve(id, action);
  });
  notify(p.job_id);
}

export function linkEventToJob(jobId: number, e: MatchEventPayload) {
  const meta = { source: "calendar" as const, href: e.href ?? undefined };
  const existing = all<{ id: number; starts_at: string | null; name: string }>(
    "SELECT id, starts_at, name FROM interviews WHERE job_id = ? AND status = 'scheduled'",
    jobId,
  );
  const near = existing.find(
    (i) => i.starts_at && Math.abs(new Date(i.starts_at).getTime() - new Date(e.startsAt).getTime()) < 3 * 3600_000,
  );
  const untimed = existing.find((i) => !i.starts_at);
  let interviewId: number;
  if (near) interviewId = near.id;
  else if (untimed) {
    rescheduleInterview(untimed.id, e.startsAt, meta);
    interviewId = untimed.id;
  } else {
    interviewId = addInterview(
      jobId,
      { name: e.summary.slice(0, 80), startsAt: e.startsAt, durationMin: e.durationMin, format: e.format, attendees: e.attendees },
      meta,
    );
  }
  run("UPDATE interviews SET calendar_event_id = ? WHERE id = ?", e.eventId, interviewId);
  // An interview invite means they replied.
  const stage = get<{ stage: string }>("SELECT stage FROM jobs WHERE id = ?", jobId)?.stage;
  if (stage === "no_reply" || stage === "applied" || stage === "found") setStage(jobId, "screening", meta, "Interview booked");
  // Anything waiting in Needs you for this event is settled.
  run(
    "UPDATE proposals SET resolved_at = ?, resolution = 'link' WHERE kind = 'match_event' AND resolved_at IS NULL AND json_extract(payload, '$.eventId') = ?",
    now(),
    e.eventId,
  );
  run(
    `INSERT INTO calendar_links (event_id, job_id, interview_id, starts_at, status, updated_at, provider) VALUES (?, ?, ?, ?, 'linked', ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET job_id = excluded.job_id, interview_id = excluded.interview_id,
       starts_at = excluded.starts_at, status = 'linked', updated_at = excluded.updated_at, provider = excluded.provider`,
    e.eventId,
    jobId,
    interviewId,
    e.startsAt,
    now(),
    e.provider,
  );
}

/** Job boards and networks send on behalf of others; they're never the hiring company. */
const NOT_THE_COMPANY = /(^|\.)(linkedin|seek|indeed|glassdoor|jora|hays|michaelpage|roberthalf|workable|greenhouse|lever|ashbyhq|smartrecruiters|myworkday|gmail|outlook|hotmail|yahoo)\./i;

function domainName(from: string): string {
  const email = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  const domain = email.split("@")[1] ?? "Unknown company";
  if (NOT_THE_COMPANY.test(domain)) return "Unknown company";
  const base = domain.split(".").slice(-2, -1)[0] ?? domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export interface ProposalView {
  id: number;
  kind: ProposalKind;
  jobId: number | null;
  title: string;
  detail: string | null;
  createdAt: string;
  suggestedJobId: number | null;
  count: number;
}

export function listOpenProposals(): ProposalView[] {
  const rows = all<{ id: number; kind: ProposalKind; job_id: number | null; title: string; detail: string | null; created_at: string; payload: string }>(
    "SELECT * FROM proposals WHERE resolved_at IS NULL ORDER BY created_at DESC",
  );
  return rows.map((r) => {
    const payload = JSON.parse(r.payload);
    return {
      id: r.id,
      kind: r.kind,
      jobId: r.job_id,
      title: r.title,
      detail: r.detail,
      createdAt: r.created_at,
      suggestedJobId: r.kind === "match_email" ? ((payload as MatchEmailPayload).suggestedJobId ?? null) : null,
      count: r.kind === "match_email" ? (payload as MatchEmailPayload).items.length : 1,
    };
  });
}
