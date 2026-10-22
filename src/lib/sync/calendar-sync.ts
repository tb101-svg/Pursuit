import "server-only";
import { all, get, run } from "../db";
import { cancelInterview, rescheduleInterview } from "../engine";
import type { CalEvent, CalendarProvider } from "../calendar/providers";
import { createProposal, linkEventToJob, type MatchEventPayload } from "./apply";

/**
 * Calendar → interviews, for any calendar. Events whose attendees or title
 * point at a role are linked automatically; interview-looking events that
 * don't are sent to "Needs you". Linked events keep the interview's time in
 * step, including cancellations. No AI involved, so this is free.
 */

const INTERVIEWISH = /\b(interview|screen|screening|recruit|hiring|candidate|panel|assessment|case study|presentation round)\b/i;
const WINDOW_PAST_DAYS = 2;
const WINDOW_FUTURE_DAYS = 60;

interface CompanyRow {
  id: number;
  name: string;
  domain: string | null;
}

function activeJobFor(companyId: number): number | null {
  const row = get<{ id: number }>(
    `SELECT id FROM jobs WHERE company_id = ? AND stage != 'closed'
     ORDER BY CASE stage WHEN 'offer' THEN 0 WHEN 'final' THEN 1 WHEN 'interviewing' THEN 2 WHEN 'screening' THEN 3 WHEN 'applied' THEN 4 ELSE 5 END,
       updated_at DESC LIMIT 1`,
    companyId,
  );
  return row?.id ?? null;
}

function matchEvent(e: CalEvent, companies: CompanyRow[], contacts: Map<string, number>): number | null {
  const others = e.attendees.filter((a) => !a.self);
  for (const a of others) {
    const companyId = contacts.get(a.email);
    if (companyId) return activeJobFor(companyId);
  }
  for (const a of others) {
    const domain = a.email.split("@")[1] ?? "";
    const c = companies.find((c) => c.domain && (domain === c.domain || domain.endsWith(`.${c.domain}`)));
    if (c) return activeJobFor(c.id);
  }
  for (const c of companies) {
    const re = new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(e.summary)) return activeJobFor(c.id);
  }
  return null;
}

export function toPayload(e: CalEvent, provider: CalendarProvider): MatchEventPayload {
  const people = e.attendees.filter((a) => !a.self).map((a) => a.name ?? a.email).slice(0, 6);
  return {
    eventId: e.id,
    provider: provider.name,
    summary: e.summary || "Interview",
    startsAt: e.startsAt!,
    durationMin: e.durationMin,
    format: e.format,
    attendees: people.length ? people.join(", ") : null,
    href: e.link,
  };
}

export interface CalendarSyncResult {
  checked: number;
  linked: number;
  updated: number;
  needsYou: number;
}

export async function syncCalendar(provider: CalendarProvider): Promise<CalendarSyncResult> {
  if (!provider.selfEmail()) throw new Error(`${provider.label} not connected`);
  const from = new Date(Date.now() - WINDOW_PAST_DAYS * 86_400_000);
  const to = new Date(Date.now() + WINDOW_FUTURE_DAYS * 86_400_000);
  const events = await provider.list(from, to);

  const companies = all<CompanyRow>("SELECT id, name, lower(domain) AS domain FROM companies");
  const contacts = new Map(
    all<{ email: string; company_id: number }>("SELECT lower(email) AS email, company_id FROM contacts WHERE email IS NOT NULL").map((c) => [
      c.email,
      c.company_id,
    ]),
  );
  const result: CalendarSyncResult = { checked: events.length, linked: 0, updated: 0, needsYou: 0 };
  const now = () => new Date().toISOString();

  for (const e of events) {
    const link = get<{ status: string; interview_id: number | null; starts_at: string | null }>(
      "SELECT status, interview_id, starts_at FROM calendar_links WHERE event_id = ?",
      e.id,
    );
    if (link?.status === "ignored" || link?.status === "proposed") continue;

    // Already linked: keep the interview in step with the calendar.
    if (link?.status === "linked") {
      if (!link.interview_id) continue;
      if (e.cancelled) {
        cancelInterview(link.interview_id, { source: "calendar", href: e.link ?? undefined });
        run("UPDATE calendar_links SET status = 'ignored', updated_at = ? WHERE event_id = ?", now(), e.id);
        result.updated++;
      } else if (e.startsAt && e.startsAt !== link.starts_at) {
        rescheduleInterview(link.interview_id, e.startsAt, { source: "calendar", href: e.link ?? undefined });
        run("UPDATE calendar_links SET starts_at = ?, updated_at = ? WHERE event_id = ?", e.startsAt, now(), e.id);
        result.updated++;
      }
      continue;
    }

    if (e.cancelled || !e.startsAt) continue; // all-day events aren't interviews
    const jobId = matchEvent(e, companies, contacts);
    if (jobId) {
      linkEventToJob(jobId, toPayload(e, provider));
      result.linked++;
    } else if (INTERVIEWISH.test(e.summary) && e.attendees.some((a) => !a.self)) {
      const payload = toPayload(e, provider);
      createProposal("match_event", null, "calendar", `Calendar: “${payload.summary}”`, payload.attendees, payload);
      run(
        `INSERT INTO calendar_links (event_id, job_id, interview_id, starts_at, status, updated_at, provider) VALUES (?, NULL, NULL, ?, 'proposed', ?, ?)
         ON CONFLICT(event_id) DO NOTHING`,
        e.id,
        payload.startsAt,
        now(),
        provider.name,
      );
      result.needsYou++;
    }
  }

  // Outlook drops deleted events instead of marking them cancelled: a linked
  // event inside the window that no longer appears has been cancelled.
  if (!provider.reportsDeletions) {
    const returned = new Set(events.map((e) => e.id));
    const linked = all<{ event_id: string; interview_id: number | null; starts_at: string | null }>(
      "SELECT event_id, interview_id, starts_at FROM calendar_links WHERE status = 'linked' AND provider = ? AND starts_at >= ? AND starts_at < ?",
      provider.name,
      from.toISOString(),
      to.toISOString(),
    );
    for (const l of linked) {
      if (returned.has(l.event_id) || !l.interview_id) continue;
      cancelInterview(l.interview_id, { source: "calendar" });
      run("UPDATE calendar_links SET status = 'ignored', updated_at = ? WHERE event_id = ?", now(), l.event_id);
      result.updated++;
    }
  }
  return result;
}
