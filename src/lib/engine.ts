import "server-only";
import { all, get, run, tx } from "./db";
import { notify } from "./bus";
import {
  JOB_FIELDS,
  STAGE_LABEL,
  isJobField,
  type Change,
  type Facts,
  type FieldValue,
  type Job,
  type JobField,
  type Source,
  type Stage,
  type TaskKind,
} from "./types";

/**
 * Every change to a job goes through recordEvent. It logs what happened,
 * applies any facts to the job, and records one `changes` row per field that
 * actually moved, so each value keeps its source and can be undone.
 */
export interface NewEvent {
  jobId: number | null;
  kind: string;
  source: Source;
  title: string;
  body?: string | null;
  occurredAt?: string;
  facts?: Facts;
  payload?: unknown;
}

/** Who/what caused an action, and when (defaults: you, now). */
export interface Meta {
  source?: Source;
  at?: string;
}

const now = () => new Date().toISOString();

function normalize(field: JobField, value: FieldValue): FieldValue {
  if (value === null || value === "") return null;
  if (JOB_FIELDS[field].type === "number") {
    const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return String(value).trim();
}

const asText = (v: FieldValue | undefined) => (v === null || v === undefined ? null : String(v));

function applyFacts(jobId: number, eventId: number, facts: Facts, at: string) {
  const job = get<Job>("SELECT * FROM jobs WHERE id = ?", jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  for (const [name, raw] of Object.entries(facts)) {
    if (!isJobField(name) || raw === undefined) continue;
    const value = normalize(name, raw);
    const before = asText(job[name] as FieldValue);
    const after = asText(value);
    if (before === after) continue;
    // `name` is checked against JOB_FIELDS above, so it is a known column.
    run(`UPDATE jobs SET "${name}" = ? WHERE id = ?`, value, jobId);
    run(
      "INSERT INTO changes (event_id, job_id, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      eventId,
      jobId,
      name,
      before,
      after,
      at,
    );
  }
}

export function recordEvent(e: NewEvent): number {
  const eventId = tx(() => {
    const at = e.occurredAt ?? now();
    const id = run(
      "INSERT INTO events (job_id, kind, source, occurred_at, title, body, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
      e.jobId,
      e.kind,
      e.source,
      at,
      e.title,
      e.body ?? null,
      e.payload === undefined ? null : JSON.stringify(e.payload),
    );
    if (e.jobId !== null) {
      if (e.facts) applyFacts(e.jobId, id, e.facts, at);
      // Backdated events (imports, demo data) mustn't make a job look fresher.
      run(
        "UPDATE jobs SET updated_source = CASE WHEN ? >= updated_at THEN ? ELSE updated_source END, updated_at = MAX(updated_at, ?) WHERE id = ?",
        at,
        e.source,
        at,
        e.jobId,
      );
    }
    return id;
  });
  notify(e.jobId);
  return eventId;
}

// ── Companies & jobs ────────────────────────────────────────────────────────

const PALETTE = ["#3B5BDB", "#1F8A5B", "#8B45C9", "#0E8A94", "#B8641A", "#C0404F", "#2F7396", "#6A58A8", "#9C6A22", "#4B5263"];

function colorFor(name: string) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export interface CompanyInput {
  name: string;
  domain?: string | null;
  summary?: string | null;
  funding_stage?: string | null;
  headcount?: string | null;
  hq?: string | null;
  glassdoor?: string | null;
}

export function upsertCompany(input: CompanyInput): number {
  const name = input.name.trim();
  if (!name) throw new Error("Company name is required");
  const existing = get<{ id: number }>("SELECT id FROM companies WHERE name = ? COLLATE NOCASE", name);
  if (existing) {
    for (const f of ["domain", "summary", "funding_stage", "headcount", "hq", "glassdoor"] as const) {
      const v = input[f];
      if (v) run(`UPDATE companies SET "${f}" = ? WHERE id = ?`, v, existing.id);
    }
    return existing.id;
  }
  return run(
    "INSERT INTO companies (name, domain, color, summary, funding_stage, headcount, hq, glassdoor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    name,
    input.domain ?? null,
    colorFor(name),
    input.summary ?? null,
    input.funding_stage ?? null,
    input.headcount ?? null,
    input.hq ?? null,
    input.glassdoor ?? null,
    now(),
  );
}

export function createJob(opts: { company: CompanyInput; title: string; facts?: Facts; note?: string } & Meta): number {
  const source = opts.source ?? "you";
  return tx(() => {
    const at = opts.at ?? now();
    const companyId = upsertCompany(opts.company);
    const jobId = run(
      "INSERT INTO jobs (company_id, title, stage, created_at, updated_at, updated_source) VALUES (?, ?, 'found', ?, ?, ?)",
      companyId,
      opts.title.trim(),
      at,
      at,
      source,
    );
    recordEvent({
      jobId,
      kind: "job_created",
      source,
      occurredAt: at,
      title: `Role added: ${opts.title.trim()}`,
      body: opts.note ?? null,
      facts: opts.facts,
    });
    return jobId;
  });
}

export function updateJob(jobId: number, facts: Facts, meta: Meta = {}, title = "Edited role details") {
  return recordEvent({ jobId, kind: "edit", source: meta.source ?? "you", occurredAt: meta.at, title, facts });
}

export function setStage(jobId: number, stage: Stage, meta: Meta = {}, reason?: string) {
  // A new stage makes the old "where within the stage" detail stale.
  const facts: Facts = { stage, stage_detail: null };
  if (stage === "closed" || stage === "later" || stage === "no_reply") facts.closed_reason = reason ?? null;
  return recordEvent({
    jobId,
    kind: "stage",
    source: meta.source ?? "you",
    occurredAt: meta.at,
    title: `Stage → ${STAGE_LABEL[stage]}`,
    body: reason ?? null,
    facts,
  });
}

export function addNote(jobId: number, text: string, meta: Meta = {}, title = "Note") {
  const body = text.trim();
  if (!body) return null;
  return recordEvent({ jobId, kind: "note", source: meta.source ?? "you", occurredAt: meta.at, title, body });
}

export function saveNotes(jobId: number, notes: string) {
  run("UPDATE jobs SET notes = ? WHERE id = ?", notes, jobId);
  notify(jobId);
}

// ── Next steps ──────────────────────────────────────────────────────────────

export function addTask(jobId: number, title: string, dueAt: string | null, meta: Meta = {}, kind: TaskKind = "task") {
  const clean = title.trim();
  if (!clean) return null;
  const source = meta.source ?? "you";
  return tx(() => {
    const id = run(
      "INSERT INTO tasks (job_id, title, due_at, source, created_at, kind) VALUES (?, ?, ?, ?, ?, ?)",
      jobId,
      clean,
      dueAt,
      source,
      meta.at ?? now(),
      kind,
    );
    recordEvent({ jobId, kind: "task_added", source, occurredAt: meta.at, title: kind === "call" ? `Call booked: ${clean}` : `Next step: ${clean}` });
    return id;
  });
}

export function completeTask(taskId: number, meta: Meta = {}) {
  const task = get<{ job_id: number; title: string; done_at: string | null }>(
    "SELECT job_id, title, done_at FROM tasks WHERE id = ?",
    taskId,
  );
  if (!task || task.done_at) return;
  tx(() => {
    run("UPDATE tasks SET done_at = ? WHERE id = ?", meta.at ?? now(), taskId);
    recordEvent({ jobId: task.job_id, kind: "task_done", source: meta.source ?? "you", occurredAt: meta.at, title: `Done: ${task.title}` });
  });
}

// ── Interviews ──────────────────────────────────────────────────────────────

export interface InterviewInput {
  name: string;
  startsAt: string | null;
  durationMin?: number | null;
  format?: string | null;
  attendees?: string | null;
}

export function addInterview(jobId: number, input: InterviewInput, meta: Meta = {}): number {
  return tx(() => {
    const { next } = get<{ next: number }>(
      "SELECT COALESCE(MAX(round), 0) + 1 AS next FROM interviews WHERE job_id = ?",
      jobId,
    )!;
    const id = run(
      "INSERT INTO interviews (job_id, round, name, starts_at, duration_min, format, attendees) VALUES (?, ?, ?, ?, ?, ?, ?)",
      jobId,
      next,
      input.name.trim(),
      input.startsAt,
      input.durationMin ?? null,
      input.format ?? null,
      input.attendees ?? null,
    );
    recordEvent({
      jobId,
      kind: "interview_scheduled",
      source: meta.source ?? "you",
      occurredAt: meta.at,
      title: `Interview added: ${input.name.trim()}`,
      body: input.attendees ?? null,
    });
    return id;
  });
}

/**
 * Marks an interview done. Unless told otherwise, it also queues the
 * follow-ups that always come next: thank-you notes and, if none was given, a debrief.
 */
export function completeInterview(
  interviewId: number,
  debrief: string | null,
  meta: Meta & { followUps?: boolean } = {},
) {
  const iv = get<{ job_id: number; name: string; attendees: string | null; status: string }>(
    "SELECT job_id, name, attendees, status FROM interviews WHERE id = ?",
    interviewId,
  );
  if (!iv || iv.status === "done") return;
  tx(() => {
    run("UPDATE interviews SET status = 'done', debrief = COALESCE(?, debrief) WHERE id = ?", debrief, interviewId);
    recordEvent({
      jobId: iv.job_id,
      kind: "interview_done",
      source: meta.source ?? "you",
      occurredAt: meta.at,
      title: `${iv.name} done`,
      body: debrief,
    });
    if (meta.followUps === false) return;
    const endOfDay = new Date();
    endOfDay.setHours(17, 0, 0, 0);
    const who = iv.attendees ? ` to ${iv.attendees}` : "";
    addTask(iv.job_id, `Send thank-you notes${who}`, endOfDay.toISOString(), { source: "agent" });
    if (!debrief) addTask(iv.job_id, `Write debrief: ${iv.name}`, endOfDay.toISOString(), { source: "agent" });
  });
}

export function rescheduleInterview(interviewId: number, startsAt: string, meta: Meta & { href?: string } = {}) {
  const iv = get<{ job_id: number; name: string; starts_at: string | null }>(
    "SELECT job_id, name, starts_at FROM interviews WHERE id = ?",
    interviewId,
  );
  if (!iv || iv.starts_at === startsAt) return;
  tx(() => {
    run("UPDATE interviews SET starts_at = ?, status = 'scheduled' WHERE id = ?", startsAt, interviewId);
    recordEvent({
      jobId: iv.job_id,
      kind: "interview_rescheduled",
      source: meta.source ?? "you",
      occurredAt: meta.at,
      title: `${iv.name} ${iv.starts_at ? "moved" : "booked"}`,
      body: `Now ${new Date(startsAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}`,
      payload: meta.href ? { href: meta.href } : undefined,
    });
  });
}

export function cancelInterview(interviewId: number, meta: Meta & { href?: string } = {}) {
  const iv = get<{ job_id: number; name: string; status: string }>("SELECT job_id, name, status FROM interviews WHERE id = ?", interviewId);
  if (!iv || iv.status !== "scheduled") return;
  tx(() => {
    run("UPDATE interviews SET status = 'cancelled' WHERE id = ?", interviewId);
    recordEvent({
      jobId: iv.job_id,
      kind: "interview_cancelled",
      source: meta.source ?? "you",
      occurredAt: meta.at,
      title: `${iv.name} cancelled`,
      payload: meta.href ? { href: meta.href } : undefined,
    });
  });
}

// ── Sources ─────────────────────────────────────────────────────────────────

export function setSourceStatus(name: string, status: "connected" | "not_connected" | "error", error: string | null = null, synced = false) {
  run(
    `INSERT INTO sources (name, status, error, last_sync_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET status = excluded.status, error = excluded.error,
       last_sync_at = COALESCE(excluded.last_sync_at, sources.last_sync_at)`,
    name,
    status,
    error,
    synced ? now() : null,
  );
  notify(null);
}

// ── Contacts ────────────────────────────────────────────────────────────────

export function addContact(
  jobId: number,
  input: { name: string; title?: string | null; email?: string | null; role?: string | null; notes?: string | null },
  meta: Meta = {},
) {
  const job = get<{ company_id: number }>("SELECT company_id FROM jobs WHERE id = ?", jobId);
  if (!job || !input.name.trim()) return null;
  return tx(() => {
    const id = run(
      "INSERT INTO contacts (company_id, job_id, name, title, email, role, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      job.company_id,
      jobId,
      input.name.trim(),
      input.title ?? null,
      input.email ?? null,
      input.role ?? null,
      input.notes ?? null,
    );
    recordEvent({
      jobId,
      kind: "contact_added",
      source: meta.source ?? "you",
      occurredAt: meta.at,
      title: `Contact added: ${input.name.trim()}${input.role ? ` (${input.role})` : ""}`,
    });
    return id;
  });
}

// ── Undo ────────────────────────────────────────────────────────────────────

export type UndoResult = { ok: true } | { ok: false; reason: string };

/**
 * Reverts one field change, as a new event so the history stays intact.
 * Refuses if something else has changed that field since.
 */
export function undoChange(changeId: number): UndoResult {
  const ch = get<Change>("SELECT * FROM changes WHERE id = ?", changeId);
  if (!ch) return { ok: false, reason: "Change not found" };
  if (ch.undone_at) return { ok: false, reason: "Already undone" };
  const later = all<{ id: number }>(
    "SELECT id FROM changes WHERE job_id = ? AND field = ? AND id > ? AND undone_at IS NULL",
    ch.job_id,
    ch.field,
    ch.id,
  );
  if (later.length > 0) return { ok: false, reason: "This field has changed again since" };
  tx(() => {
    const at = now();
    run("UPDATE changes SET undone_at = ? WHERE id = ?", at, changeId);
    const eventId = recordEvent({
      jobId: ch.job_id,
      kind: "undo",
      source: "you",
      title: `Undid change to ${JOB_FIELDS[ch.field].label.toLowerCase()}`,
      facts: { [ch.field]: ch.old_value } as Facts,
    });
    // The revert isn't a new value to track or undo: the value it restores
    // keeps the provenance of whichever earlier change set it.
    run("UPDATE changes SET undone_at = ? WHERE event_id = ?", at, eventId);
  });
  return { ok: true };
}

/** Clears every role and its history. Sync memory is reset too, so the next sync rebuilds from recent email. */
export function deleteAllData() {
  tx(() => {
    for (const t of [
      "changes", "events", "tasks", "proposals", "calendar_links", "email_threads", "processed_messages", "inbox_items", "research_requests", "prep_requests", "call_sessions", "role_prep",
      "interviews", "contacts", "jobs", "companies",
    ]) {
      run(`DELETE FROM ${t}`);
    }
    run("DELETE FROM settings WHERE key IN ('gmail.historyId', 'outlook.deltaLink', 'outlook.folderDeltaLinks', 'mail.recheck.v2')");
  });
  notify(null);
}

/**
 * Removes one role and everything recorded against it (its history goes with
 * it, so this can't be undone). The company goes too if nothing else uses it.
 */
export function deleteJob(jobId: number) {
  const job = get<{ company_id: number }>("SELECT company_id FROM jobs WHERE id = ?", jobId);
  if (!job) return;
  tx(() => {
    run("DELETE FROM jobs WHERE id = ?", jobId); // events, changes, tasks, interviews, research, proposals cascade
    run("UPDATE email_threads SET status = 'ignored' WHERE job_id IS NULL AND status = 'linked'");
    const others = get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE company_id = ?", job.company_id)!.n;
    if (others === 0) {
      run("DELETE FROM contacts WHERE company_id = ?", job.company_id);
      run("DELETE FROM companies WHERE id = ?", job.company_id);
    }
  });
  notify(null);
}

/** "https://www.beam.ai/careers" → "beam.ai" */
export function cleanDomain(website: string | null | undefined): string | null {
  if (!website?.trim()) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

const sameName = (a: string, b: string) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

/**
 * Set which company a role is at. A spelling fix renames the company in place;
 * a different name moves the role (and the people you met through it) to that
 * company, creating it if needed, so other roles at the old company are untouched.
 * Returns the role's company id afterwards.
 */
export function setRoleCompany(jobId: number, input: { name: string; website: string | null }): number {
  const name = input.name.trim();
  if (!name) throw new Error("Company name is required");
  const domain = cleanDomain(input.website);
  return tx(() => {
    const job = get<{ company_id: number; old_name: string; old_domain: string | null }>(
      "SELECT j.company_id, c.name AS old_name, c.domain AS old_domain FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?",
      jobId,
    );
    if (!job) throw new Error(`No role ${jobId}`);
    const resetLogo = (companyId: number) => run("UPDATE companies SET logo_url = NULL, logo_checked_at = NULL WHERE id = ?", companyId);

    if (sameName(name, job.old_name)) {
      run("UPDATE companies SET name = ? WHERE id = ?", name, job.company_id);
      if (domain && domain !== job.old_domain) {
        run("UPDATE companies SET domain = ? WHERE id = ?", domain, job.company_id);
        resetLogo(job.company_id);
      }
      if (name !== job.old_name || (domain && domain !== job.old_domain)) {
        recordEvent({ jobId, kind: "edit", source: "you", title: `Company details updated: ${name}${domain ? ` (${domain})` : ""}` });
      }
      return job.company_id;
    }

    const companyId = upsertCompany({ name, domain });
    if (domain) {
      const cur = get<{ domain: string | null }>("SELECT domain FROM companies WHERE id = ?", companyId)!;
      if (cur.domain !== domain) {
        run("UPDATE companies SET domain = ? WHERE id = ?", domain, companyId);
        resetLogo(companyId);
      }
    }
    run("UPDATE jobs SET company_id = ? WHERE id = ?", companyId, jobId);
    run("UPDATE contacts SET company_id = ? WHERE job_id = ?", companyId, jobId);
    const left = get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE company_id = ?", job.company_id)!.n;
    if (left === 0) {
      run("DELETE FROM contacts WHERE company_id = ?", job.company_id);
      run("DELETE FROM companies WHERE id = ?", job.company_id);
    }
    recordEvent({ jobId, kind: "edit", source: "you", title: `Company changed: ${job.old_name} → ${name}` });
    return companyId;
  });
}

/** Change a next step's type. An interview becomes an interview record (with the step's time), like a calendar invite. */
export function setTaskType(taskId: number, type: "task" | "call" | "interview"): string | null {
  const t = get<{ job_id: number; title: string; due_at: string | null; done_at: string | null }>(
    "SELECT job_id, title, due_at, done_at FROM tasks WHERE id = ?",
    taskId,
  );
  if (!t || t.done_at) return null;
  if (type !== "interview") {
    run("UPDATE tasks SET kind = ? WHERE id = ?", type, taskId);
    notify(t.job_id);
    return null;
  }
  if (!t.due_at) return "Give the step a date and time first, then make it an interview.";
  tx(() => {
    run("DELETE FROM tasks WHERE id = ?", taskId);
    addInterview(t.job_id, { name: t.title, startsAt: t.due_at });
    const stage = get<{ stage: string }>("SELECT stage FROM jobs WHERE id = ?", t.job_id)?.stage;
    if (stage === "found" || stage === "applied" || stage === "no_reply") setStage(t.job_id, "screening", {}, "Interview booked");
  });
  return null;
}

/** Reword or reschedule a next step (null due = no date). */
export function updateTask(taskId: number, input: { title: string; dueAt: string | null }, meta: Meta = {}) {
  const t = get<{ job_id: number; title: string; due_at: string | null; done_at: string | null }>(
    "SELECT job_id, title, due_at, done_at FROM tasks WHERE id = ?",
    taskId,
  );
  const title = input.title.trim();
  if (!t || !title) return;
  if (title === t.title && input.dueAt === t.due_at) return;
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "no date";
  tx(() => {
    run("UPDATE tasks SET title = ?, due_at = ? WHERE id = ?", title, input.dueAt, taskId);
    const changes = [
      title !== t.title ? `Was: “${t.title}”` : null,
      input.dueAt !== t.due_at ? `Due: ${fmt(t.due_at)} → ${fmt(input.dueAt)}` : null,
    ].filter(Boolean);
    recordEvent({ jobId: t.job_id, kind: "task_edited", source: meta.source ?? "you", title: `Next step updated: ${title}`, body: changes.join("\n") });
  });
}

/** Edit an interview's details (name, time, length, format, who). */
export function updateInterview(
  interviewId: number,
  input: { name: string; startsAt: string | null; durationMin: number | null; format: string | null; attendees: string | null },
  meta: Meta = {},
) {
  const iv = get<{ job_id: number; name: string; starts_at: string | null }>("SELECT job_id, name, starts_at FROM interviews WHERE id = ?", interviewId);
  if (!iv || !input.name.trim()) return;
  tx(() => {
    run(
      "UPDATE interviews SET name = ?, starts_at = ?, duration_min = ?, format = ?, attendees = ? WHERE id = ?",
      input.name.trim(),
      input.startsAt,
      input.durationMin,
      input.format,
      input.attendees,
      interviewId,
    );
    recordEvent({
      jobId: iv.job_id,
      kind: "interview_edited",
      source: meta.source ?? "you",
      title: `Interview updated: ${input.name.trim()}`,
      body: input.startsAt !== iv.starts_at ? `Time: ${iv.starts_at ?? "not set"} → ${input.startsAt ?? "not set"}` : null,
    });
  });
}

/** Save your own notes on how a round went (without changing its status). */
export function saveDebrief(interviewId: number, debrief: string) {
  const iv = get<{ job_id: number }>("SELECT job_id FROM interviews WHERE id = ?", interviewId);
  if (!iv) return;
  run("UPDATE interviews SET debrief = ? WHERE id = ?", debrief.trim() || null, interviewId);
  notify(iv.job_id);
}

/** Attach a call (notes, recording, transcript) to one of the role's interviews, or detach it. */
export function linkCallToInterview(callId: number, interviewId: number | null) {
  const call = get<{ job_id: number }>("SELECT job_id FROM call_sessions WHERE id = ?", callId);
  if (!call) return;
  if (interviewId !== null && !get("SELECT id FROM interviews WHERE id = ? AND job_id = ?", interviewId, call.job_id)) return;
  run("UPDATE call_sessions SET interview_id = ? WHERE id = ?", interviewId, callId);
  notify(call.job_id);
}
