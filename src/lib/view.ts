import { ageDays, clock, dayDate, dayFromNow, money, ordinal, ote, relTime, when } from "./format";
import { ratingsOf, tierFor, type Ratings, type TierResult } from "./rating";
import { JOB_FIELDS, SOURCE_LABEL, STAGES, STAGE_LABEL, type Change, type EventRow, type JobField, type RoleRow, type Stage } from "./types";

/** Days without activity before a role is flagged as going stale. */
export const STALE_DAYS = 7;

export type Tone = "today" | "overdue" | "stale" | "normal" | "none";
export type Freshness = "just" | "recent" | "normal" | "stale";

export interface NextStep {
  kind: "interview" | "task" | null;
  id: number | null;
  text: string;
  tone: Tone;
  /** When it's due (ISO), for sorting by next step. */
  at: string | null;
}

export interface CardData {
  id: number;
  company: string;
  color: string;
  logo: string | null;
  title: string;
  stage: Stage;
  stageLabel: string;
  stageIndex: number;
  stageSub: string;
  rank: number | null;
  fit: number | null;
  ote: string | null;
  oteK: number | null;
  quota: string | null;
  segment: string | null;
  team: string | null;
  next: NextStep;
  updated: string;
  updatedSource: string | null;
  freshness: Freshness;
  /** Latest activity (ISO), for sorting by latest step. */
  updatedAt: string;
  ratings: Ratings;
  tier: TierResult;
  /** The next scheduled interview, if it's still ahead. */
  interview: UpcomingInterview | null;
}

export interface UpcomingInterview {
  /** ISO start time. */
  at: string;
  date: string;
  time: string | null;
  day: string;
  stage: string;
  name: string;
  soon: boolean;
}

const WORD_ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

/**
 * Which interview this is ("2nd interview", "Final interview"). The name the
 * company used wins (it knows about rounds before Pursuit did); otherwise the
 * round count, or the role's stage for a first call.
 */
export function interviewStage(name: string, round: number | null, stage: Stage): string {
  const n = name.match(/\b(\d)(?:st|nd|rd|th)\b/i)?.[1] ?? name.match(/\bround\s*(\d)\b/i)?.[1];
  if (n) return `${ordinal(Number(n))} interview`;
  const word = name.match(/\b(first|second|third|fourth|fifth)\b/i)?.[1];
  if (word) return `${ordinal(WORD_ORDINALS[word.toLowerCase()])} interview`;
  if (/\bfinal\b/i.test(name) || stage === "final") return "Final interview";
  if (/\bpanel\b/i.test(name)) return "Panel interview";
  if (/\b(recruiter|screen|screening|phone|intro)\b/i.test(name) || stage === "screening") return "1st stage · screen";
  return `${ordinal(round ?? 1)} interview`;
}

/** The card's highlighted meeting: the next interview, or else a booked call. */
function upcomingMeeting(r: RoleRow, now: Date): UpcomingInterview | null {
  const iv = r.next_interview && r.next_interview_at ? upcomingInterview(r.next_interview, r.next_interview_at, r.next_interview_round, r.stage, now) : null;
  if (iv) return iv;
  if (r.next_task_kind === "call" && r.next_task && r.next_task_due) {
    const call = upcomingInterview(r.next_task, r.next_task_due, null, r.stage, now);
    return call && { ...call, stage: "Call" };
  }
  return null;
}

export function upcomingInterview(name: string, startsAt: string, round: number | null, stage: Stage, now = new Date()): UpcomingInterview | null {
  // An hour's grace so an interview in progress still shows.
  if (new Date(startsAt).getTime() < now.getTime() - 3600_000) return null;
  const day = dayFromNow(startsAt, now);
  return { at: startsAt, date: dayDate(startsAt), time: clock(startsAt), day, stage: interviewStage(name, round, stage), name, soon: day === "Today" || day === "Tomorrow" };
}

export function stageSub(r: RoleRow): string {
  if (r.stage_detail) return r.stage_detail;
  if (r.stage === "closed" || r.stage === "later" || r.stage === "no_reply") return r.closed_reason ?? "";
  if (r.rounds_total > 0) {
    const current = Math.min(r.rounds_done + 1, r.rounds_total);
    if (r.rounds_done >= r.rounds_total) return r.rounds_total === 1 ? "1 round done" : `${r.rounds_total} rounds done`;
    return `Round ${current} of ${r.rounds_total}`;
  }
  return "";
}

/** Picks whichever comes first: the next scheduled interview or the next open task. */
export function nextStep(r: RoleRow, now = new Date()): NextStep {
  const options: { kind: "interview" | "task"; id: number; label: string; at: string | null }[] = [];
  if (r.next_interview_id) {
    options.push({ kind: "interview", id: r.next_interview_id, label: r.next_interview!, at: r.next_interview_at });
  }
  if (r.next_task_id) options.push({ kind: "task", id: r.next_task_id, label: r.next_task_kind === "call" ? `Call: ${r.next_task}` : r.next_task!, at: r.next_task_due });
  if (options.length === 0) {
    if (r.stage === "closed") return { kind: null, id: null, text: "Closed", tone: "none", at: null };
    if (r.stage === "later") return { kind: null, id: null, text: "Parked: check back for a suitable role", tone: "none", at: null };
    if (r.stage === "no_reply") return { kind: null, id: null, text: "No reply yet: follow up, or leave it", tone: "none", at: null };
    const stale = ageDays(r.updated_at, now) >= STALE_DAYS;
    return {
      kind: null,
      id: null,
      text: stale ? `No activity in ${Math.floor(ageDays(r.updated_at, now))} days: follow up?` : "No next step set",
      tone: stale ? "stale" : "none",
      at: null,
    };
  }
  options.sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));
  const pick = options[0];
  const at = pick.at ? new Date(pick.at) : null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  let tone: Tone = "normal";
  if (at && at < today) tone = "overdue";
  else if (at && at < tomorrow) tone = "today";
  const suffix = at ? ` · ${when(pick.at, now)}` : "";
  return { kind: pick.kind, id: pick.id, text: `${pick.label}${suffix}`, tone, at: pick.at };
}

export function freshness(updatedAt: string, now = new Date()): Freshness {
  const days = ageDays(updatedAt, now);
  if (days < 5 / 1440) return "just"; // includes timestamps slightly in the future
  if (days < 2) return "recent";
  if (days >= STALE_DAYS) return "stale";
  return "normal";
}

export function toCard(r: RoleRow, now = new Date()): CardData {
  const oteK = ote(r.base_k, r.variable_k);
  return {
    id: r.id,
    company: r.company_name,
    color: r.company_color,
    logo: r.company_logo,
    title: r.title,
    stage: r.stage,
    stageLabel: STAGE_LABEL[r.stage],
    stageIndex: r.stage === "closed" ? -3 : r.stage === "later" ? -2 : r.stage === "no_reply" ? -1 : STAGES.indexOf(r.stage),
    stageSub: stageSub(r),
    rank: r.rank,
    fit: r.fit,
    ote: money(oteK),
    oteK,
    quota: money(r.quota_k),
    segment: r.segment,
    team: r.team_size,
    next: nextStep(r, now),
    updated: relTime(r.updated_at, now),
    updatedSource: r.updated_source ? SOURCE_LABEL[r.updated_source] : null,
    freshness: freshness(r.updated_at, now),
    updatedAt: r.updated_at,
    ratings: ratingsOf(r),
    tier: tierFor(ratingsOf(r)),
    interview: upcomingMeeting(r, now),
  };
}

// ── Change feed ─────────────────────────────────────────────────────────────

const MONEY_FIELDS = new Set<JobField>(["base_k", "variable_k", "quota_k"]);

/** Human-readable value for a stored field value (as kept in `changes`). */
export function displayValue(field: JobField, raw: string | null): string | null {
  if (raw === null) return null;
  if (MONEY_FIELDS.has(field)) return money(Number(raw));
  if (field === "stage") return STAGE_LABEL[raw as Stage] ?? raw;
  return raw;
}

export interface FeedItemData {
  id: number;
  jobId: number | null;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  source: string;
  when: string;
  company: string | null;
  color: string | null;
  logo: string | null;
  changes: (Change & { label: string; from: string | null; to: string | null })[];
}

export function toFeedItem(e: EventRow, now = new Date()): FeedItemData {
  return {
    id: e.id,
    jobId: e.job_id,
    kind: e.kind,
    title: e.title,
    body: e.body,
    href: linkFrom(e.payload),
    source: SOURCE_LABEL[e.source] ?? e.source,
    when: relTime(e.occurred_at, now),
    company: e.company_name,
    color: e.company_color,
    logo: e.company_logo,
    changes: e.changes.map((ch) => ({
      ...ch,
      label: JOB_FIELDS[ch.field]?.label ?? ch.field,
      from: displayValue(ch.field, ch.old_value),
      to: displayValue(ch.field, ch.new_value),
    })),
  };
}

function linkFrom(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const href = (JSON.parse(payload) as { href?: unknown }).href;
    return typeof href === "string" && href.startsWith("https://") ? href : null;
  } catch {
    return null;
  }
}
