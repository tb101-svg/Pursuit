import "server-only";
import { all, get } from "./db";
import type {
  Change,
  Company,
  Contact,
  EventRow,
  Interview,
  Job,
  JobField,
  RoleRow,
  Source,
  SourceStatus,
  Stage,
  Task,
} from "./types";

const ROLE_SELECT = `
  SELECT j.*, c.name AS company_name, c.color AS company_color, c.logo_url AS company_logo,
    nt.id AS next_task_id, nt.title AS next_task, nt.due_at AS next_task_due, nt.kind AS next_task_kind,
    ni.id AS next_interview_id, ni.name AS next_interview, ni.starts_at AS next_interview_at, ni.round AS next_interview_round,
    (SELECT COUNT(*) FROM interviews i WHERE i.job_id = j.id AND i.status != 'cancelled') AS rounds_total,
    (SELECT COUNT(*) FROM interviews i WHERE i.job_id = j.id AND i.status = 'done') AS rounds_done
  FROM jobs j
  JOIN companies c ON c.id = j.company_id
  LEFT JOIN tasks nt ON nt.id = (
    SELECT t.id FROM tasks t WHERE t.job_id = j.id AND t.done_at IS NULL
    ORDER BY t.due_at IS NULL, t.due_at, t.id LIMIT 1)
  LEFT JOIN interviews ni ON ni.id = (
    SELECT i.id FROM interviews i WHERE i.job_id = j.id AND i.status = 'scheduled'
    ORDER BY i.starts_at IS NULL, i.starts_at, i.round LIMIT 1)
`;

export function listRoles(): RoleRow[] {
  return all<RoleRow>(`${ROLE_SELECT} ORDER BY j.rank IS NULL, j.rank, j.updated_at DESC`);
}

export function getRole(id: number): RoleRow | undefined {
  return get<RoleRow>(`${ROLE_SELECT} WHERE j.id = ?`, id);
}

export function getCompany(id: number): Company | undefined {
  return get<Company>("SELECT * FROM companies WHERE id = ?", id);
}

export function listTasks(jobId: number): Task[] {
  return all<Task>(
    "SELECT * FROM tasks WHERE job_id = ? ORDER BY done_at IS NOT NULL, due_at IS NULL, due_at, id",
    jobId,
  );
}

export function listInterviews(jobId: number): Interview[] {
  return all<Interview>("SELECT * FROM interviews WHERE job_id = ? ORDER BY round", jobId);
}

export function listContacts(jobId: number): Contact[] {
  return all<Contact>(
    "SELECT * FROM contacts WHERE job_id = ? OR (job_id IS NULL AND company_id = (SELECT company_id FROM jobs WHERE id = ?)) ORDER BY id",
    jobId,
    jobId,
  );
}

function attachChanges(events: Omit<EventRow, "changes">[]): EventRow[] {
  if (events.length === 0) return [];
  const ids = events.map((e) => e.id);
  const changes = all<Change>(
    `SELECT * FROM changes WHERE event_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
    ...ids,
  );
  const byEvent = new Map<number, Change[]>();
  for (const ch of changes) {
    const list = byEvent.get(ch.event_id) ?? [];
    list.push(ch);
    byEvent.set(ch.event_id, list);
  }
  return events.map((e) => ({ ...e, changes: byEvent.get(e.id) ?? [] }));
}

const EVENT_SELECT = `
  SELECT e.id, e.job_id, e.kind, e.source, e.occurred_at, e.title, e.body, e.payload,
    c.name AS company_name, c.color AS company_color, c.logo_url AS company_logo, j.title AS job_title
  FROM events e
  LEFT JOIN jobs j ON j.id = e.job_id
  LEFT JOIN companies c ON c.id = j.company_id
`;

export function listEvents(jobId: number, limit = 200): EventRow[] {
  return attachChanges(
    all<Omit<EventRow, "changes">>(
      `${EVENT_SELECT} WHERE e.job_id = ? ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`,
      jobId,
      limit,
    ),
  );
}

/** Newest events that changed something, across all roles (the Changes feed). */
export function listRecentChanges(limit = 50): EventRow[] {
  return attachChanges(
    all<Omit<EventRow, "changes">>(
      `${EVENT_SELECT} WHERE e.kind != 'job_created' AND EXISTS (SELECT 1 FROM changes ch WHERE ch.event_id = e.id)
       ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`,
      limit,
    ),
  );
}

export function listAllEvents(limit = 100): EventRow[] {
  return attachChanges(
    all<Omit<EventRow, "changes">>(`${EVENT_SELECT} ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`, limit),
  );
}

export interface Provenance {
  source: Source;
  title: string;
  occurred_at: string;
}

/** For each field, the event that set its current value. */
export function fieldProvenance(jobId: number): Partial<Record<JobField, Provenance>> {
  const rows = all<Provenance & { field: JobField }>(
    `SELECT ch.field, e.source, e.title, e.occurred_at
     FROM changes ch JOIN events e ON e.id = ch.event_id
     WHERE ch.id IN (SELECT MAX(id) FROM changes WHERE job_id = ? AND undone_at IS NULL GROUP BY field)`,
    jobId,
  );
  return Object.fromEntries(rows.map((r) => [r.field, { source: r.source, title: r.title, occurred_at: r.occurred_at }]));
}

export interface TodayItem {
  kind: "interview" | "task";
  id: number;
  jobId: number;
  at: string | null;
  title: string;
  company: string;
  color: string;
  logo: string | null;
  overdue: boolean;
}

/** Interviews happening today, plus next steps due today or overdue. */
export function listToday(): TodayItem[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const s = start.toISOString();
  const e = end.toISOString();
  const interviews = all<{ id: number; job_id: number; starts_at: string; name: string; company: string; color: string; logo: string | null }>(
    `SELECT i.id, i.job_id, i.starts_at, i.name, c.name AS company, c.color, c.logo_url AS logo
     FROM interviews i JOIN jobs j ON j.id = i.job_id JOIN companies c ON c.id = j.company_id
     WHERE i.status = 'scheduled' AND i.starts_at >= ? AND i.starts_at < ? ORDER BY i.starts_at`,
    s,
    e,
  );
  const tasks = all<{ id: number; job_id: number; due_at: string; title: string; company: string; color: string; logo: string | null }>(
    `SELECT t.id, t.job_id, t.due_at, t.title, c.name AS company, c.color, c.logo_url AS logo
     FROM tasks t JOIN jobs j ON j.id = t.job_id JOIN companies c ON c.id = j.company_id
     WHERE t.done_at IS NULL AND t.due_at < ? AND j.stage != 'closed' ORDER BY t.due_at`,
    e,
  );
  return [
    ...interviews.map((i) => ({
      kind: "interview" as const,
      id: i.id,
      jobId: i.job_id,
      at: i.starts_at,
      title: i.name,
      company: i.company,
      color: i.color,
      logo: i.logo,
      overdue: false,
    })),
    ...tasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      jobId: t.job_id,
      at: t.due_at,
      title: t.title,
      company: t.company,
      color: t.color,
      logo: t.logo,
      overdue: t.due_at < s,
    })),
  ];
}

/** Sidebar sources. Google only appears if it has been set up. */
function sourceNames(): [string, string][] {
  const google = !!(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  return [
    ["outlook", "Outlook mail"],
    ["outlook_calendar", "Outlook calendar"],
    ["imap", "Email"],
    ...(google ? ([["gmail", "Gmail"], ["calendar", "Google Calendar"]] as [string, string][]) : []),
    ["alerts", "Job alerts"],
    ["careers", "Careers pages"],
    ["recorder", "Call recorder"],
  ];
}

export function listSources(): SourceStatus[] {
  const rows = all<{ name: string; last_sync_at: string | null; status: SourceStatus["status"]; error: string | null }>(
    "SELECT * FROM sources",
  );
  const byName = new Map(rows.map((r) => [r.name, r]));
  return sourceNames().map(([name, label]) => {
    const r = byName.get(name);
    return {
      name,
      label,
      status: r?.status ?? "not_connected",
      last_sync_at: r?.last_sync_at ?? null,
      error: r?.error ?? null,
    };
  });
}

export function countJobs(): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs")!.n;
}

export type { Job };

export interface UpcomingRow {
  kind: "interview" | "call" | "task";
  id: number;
  job_id: number;
  at: string;
  title: string;
  round: number | null;
  duration_min: number | null;
  format: string | null;
  stage: Stage;
  company: string;
  role: string;
  color: string;
  logo: string | null;
}

/** Interviews still ahead (plus one in progress), and next steps due in the coming week. */
export function listUpcoming(now = new Date()): { interviews: UpcomingRow[]; tasks: UpcomingRow[] } {
  const from = new Date(now.getTime() - 3600_000).toISOString();
  const weekEnd = new Date(now);
  weekEnd.setHours(0, 0, 0, 0);
  const tomorrow = new Date(weekEnd);
  tomorrow.setDate(tomorrow.getDate() + 1); // today's (and overdue) steps are in Today
  weekEnd.setDate(weekEnd.getDate() + 8);
  const interviews = all<UpcomingRow>(
    `SELECT 'interview' AS kind, i.id, i.job_id, i.starts_at AS at, i.name AS title, i.round, i.duration_min, i.format,
       j.stage, j.title AS role, c.name AS company, c.color, c.logo_url AS logo
     FROM interviews i JOIN jobs j ON j.id = i.job_id JOIN companies c ON c.id = j.company_id
     WHERE i.status = 'scheduled' AND i.starts_at >= ? AND j.stage != 'closed'
     UNION ALL
     SELECT 'call', t.id, t.job_id, t.due_at, t.title, NULL, NULL, NULL, j.stage, j.title, c.name, c.color, c.logo_url
     FROM tasks t JOIN jobs j ON j.id = t.job_id JOIN companies c ON c.id = j.company_id
     WHERE t.kind = 'call' AND t.done_at IS NULL AND t.due_at >= ? AND j.stage != 'closed'
     ORDER BY at LIMIT 8`,
    from,
    from,
  );
  const tasks = all<UpcomingRow>(
    `SELECT 'task' AS kind, t.id, t.job_id, t.due_at AS at, t.title, NULL AS round, NULL AS duration_min, NULL AS format,
       j.stage, j.title AS role, c.name AS company, c.color, c.logo_url AS logo
     FROM tasks t JOIN jobs j ON j.id = t.job_id JOIN companies c ON c.id = j.company_id
     WHERE t.done_at IS NULL AND t.kind != 'call' AND t.due_at >= ? AND t.due_at < ? AND j.stage != 'closed' ORDER BY t.due_at LIMIT 6`,
    tomorrow.toISOString(),
    weekEnd.toISOString(),
  );
  return { interviews: interviews.map((r) => ({ ...r })), tasks: tasks.map((r) => ({ ...r })) };
}

/**
 * Words demo mode hides: company names (and their short forms and website
 * names) and the people you've met. Longest first, so "Beam AI" wins over "Beam".
 */
export function demoTerms(): string[] {
  const terms = new Set<string>();
  const add = (t: string | null | undefined) => {
    const v = t?.trim();
    if (v && v.length >= 3) terms.add(v);
  };
  for (const c of all<{ name: string; domain: string | null }>("SELECT name, domain FROM companies")) {
    add(c.name);
    add(c.name.replace(/\s*\(.*\)\s*/g, " ")); // "Fin.ai (Intercom)" → "Fin.ai"
    add(c.name.match(/\(([^)]+)\)/)?.[1]); // … and "Intercom"
    const first = c.name.split(/\s+/)[0];
    if (first.length >= 4) add(first); // "Beam AI" → "Beam"
    if (c.domain) {
      add(c.domain);
      add(c.domain.split(".")[0]); // "ideagen.com" → "ideagen"
    }
  }
  for (const p of all<{ name: string }>("SELECT name FROM contacts")) {
    add(p.name);
    for (const part of p.name.split(/\s+/)) if (part.length >= 4) add(part);
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

export interface OpenTaskRow {
  id: number;
  job_id: number;
  title: string;
  due_at: string | null;
  source: Source;
  kind: "task" | "call";
  created_at: string;
  role: string;
  stage: Stage;
  company: string;
  color: string;
  logo: string | null;
}

/** Every open next step on roles that aren't closed: soonest first, undated last. */
export function listOpenTasks(): OpenTaskRow[] {
  return all<OpenTaskRow>(
    `SELECT t.id, t.job_id, t.title, t.due_at, t.source, t.kind, t.created_at,
       j.title AS role, j.stage, c.name AS company, c.color, c.logo_url AS logo
     FROM tasks t JOIN jobs j ON j.id = t.job_id JOIN companies c ON c.id = j.company_id
     WHERE t.done_at IS NULL AND j.stage != 'closed'
     ORDER BY t.due_at IS NULL, t.due_at, t.created_at`,
  ).map((r) => ({ ...r }));
}

/** Open steps due today or earlier, for the menu badge. */
export function countDueTasks(): number {
  const end = new Date();
  end.setHours(24, 0, 0, 0);
  return get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tasks t JOIN jobs j ON j.id = t.job_id
     WHERE t.done_at IS NULL AND j.stage != 'closed' AND t.due_at IS NOT NULL AND t.due_at < ?`,
    end.toISOString(),
  )!.n;
}
