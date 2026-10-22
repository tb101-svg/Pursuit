import "server-only";
import { all, get, getSetting, run, setSetting } from "../db";
import { notify } from "../bus";
import { extractEmail, isAiConfigured, type Extraction, type KnownRole } from "../ai/extract";
import { applyExtraction, linkThread, proposeEmailMatch, type EmailRef } from "../sync/apply";
import type { Source } from "../types";
import type { MailMeta, MailProvider } from "./types";

/**
 * Mailbox → roles, for any provider. Cheap header checks decide which emails
 * look job-related. Those are either analysed straight away (when an Anthropic
 * API key is set) or put in the "To read" queue for Claude to read through the
 * MCP connection, which uses your Claude subscription instead of the API.
 */

/** Applicant-tracking systems that send on a company's behalf. */
const ATS_DOMAINS = [
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "hire.lever.co", "ashbyhq.com", "workable.com", "workablemail.com",
  "smartrecruiters.com", "myworkday.com", "workday.com", "icims.com", "jobvite.com", "teamtailor.com", "teamtailor-mail.com",
  "bamboohr.com", "recruitee.com", "personio.de", "breezy.hr", "pinpointhq.com", "rippling.com", "gem.com", "dover.com",
  "applytojob.com", "jazzhr.com", "successfactors.com", "oraclecloud.com", "livehire.com", "pageuppeople.com", "jobadder.com",
];

/** Job-board alert senders: kept aside for discovery (Phase 4), not analysed. */
const ALERT_SENDERS = [
  /jobalerts-noreply@linkedin\.com$/,
  /jobs-noreply@linkedin\.com$/,
  /@(s\.)?seek\.com\.au$/,
  /@glassdoor\.com$/,
  /@(.+\.)?indeed\.com$/,
];

const KEYWORDS =
  /\b(interview|application|applied|applying|candidate|candidacy|roles?|position|opportunit|recruit|hiring|job offer|offer letter|offer of employment|verbal offer|your offer|next steps?|availability|schedul|screen|shortlist|talent|career|OTE|quota|compensation|hiring manager|job description|JDs?|account executive|account manager|account director|business development|sales (?:role|position|leader|director|manager)|vacanc|headhunt|salary|base \+|commission|territory|great chatting|good to chat|brief summary of)/i;

/** Outside the Inbox (folders that also hold promotions), only clear job signals count. */
const STRONG_KEYWORDS =
  /\b(interview|application|applied|applying|candidate|job description|JDs?|account executive|account manager|account director|business development|hiring|recruit|vacanc|headhunt|roles?|position|job offer|offer letter)/i;

/** "Sam<>Acme"-style intro subjects recruiters use after a call. */
const INTRO_SUBJECT = /\S\s*<>\s*\S/;

/** Recruitment agencies rarely share a domain with the hiring company, but their names give them away. */
const AGENCY_DOMAIN = /(talent|recruit|staffing|headhunt|search|resourcing|hire|executive|careers)/i;

/** A real person messaging you through LinkedIn (recruiter InMails and replies). */
const LINKEDIN_MESSAGE = /^(inmail-)?hit-reply@linkedin\.com$/;
/** LinkedIn notifications that carry no message content (digests, invites, network news). */
const LINKEDIN_NOISE = /@linkedin\.com$/;

/** A message that fails this many times is left alone (shown in Settings). */
const MAX_ATTEMPTS = 3;

type Reason = "thread" | "contact" | "company" | "ats" | "agency" | "linkedin" | "keyword";

interface Context {
  selfEmail: string;
  threads: Map<string, { jobId: number | null; status: string }>;
  contactEmails: Set<string>;
  contactNames: Set<string>;
  companyDomains: Set<string>;
}

function loadContext(selfEmail: string): Context {
  const threads = all<{ thread_id: string; job_id: number | null; status: string }>("SELECT thread_id, job_id, status FROM email_threads");
  const contacts = all<{ email: string }>("SELECT lower(email) AS email FROM contacts WHERE email IS NOT NULL");
  const names = all<{ name: string }>("SELECT lower(trim(name)) AS name FROM contacts");
  const domains = all<{ domain: string }>("SELECT lower(domain) AS domain FROM companies WHERE domain IS NOT NULL");
  return {
    selfEmail: selfEmail.toLowerCase(),
    threads: new Map(threads.map((t) => [t.thread_id, { jobId: t.job_id, status: t.status }])),
    contactEmails: new Set(contacts.map((c) => c.email)),
    contactNames: new Set(names.map((c) => c.name).filter((n) => n.includes(" "))), // full names only
    companyDomains: new Set(domains.map((d) => d.domain.replace(/^www\./, ""))),
  };
}

const domainOf = (email: string) => email.split("@")[1] ?? "";
const inDomains = (domain: string, list: Iterable<string>) => {
  for (const d of list) if (domain === d || domain.endsWith(`.${d}`)) return true;
  return false;
};

function classify(m: MailMeta, ctx: Context): Reason | "alert" | "ignored_thread" | null {
  const thread = ctx.threads.get(m.threadId);
  if (thread?.status === "ignored") return "ignored_thread";
  if (thread?.status === "linked") return "thread";
  if (ALERT_SENDERS.some((re) => re.test(m.fromEmail))) return "alert";
  // Your own mail only matters inside threads already linked to a role.
  if (m.fromEmail === ctx.selfEmail) return null;
  const addresses = [m.fromEmail, ...`${m.to},${m.cc}`.split(",").map((a) => (a.match(/<([^>]+)>/)?.[1] ?? a).trim().toLowerCase())];
  if (addresses.some((a) => ctx.contactEmails.has(a))) return "contact";
  if (LINKEDIN_MESSAGE.test(m.fromEmail)) return "linkedin";
  if (LINKEDIN_NOISE.test(m.fromEmail)) return null; // digests ("Tia just messaged you"), invites, network news
  // A contact you met on LinkedIn (no email saved yet) now writing from their own address.
  if (ctx.contactNames.has(displayName(m.from))) return "contact";
  const domain = domainOf(m.fromEmail);
  if (inDomains(domain, ctx.companyDomains)) return "company";
  if (inDomains(domain, ATS_DOMAINS)) return "ats";
  if (AGENCY_DOMAIN.test(domain.split(".")[0] ?? "")) return "agency";
  const words = m.folder ? STRONG_KEYWORDS : KEYWORDS;
  if (INTRO_SUBJECT.test(m.subject) || words.test(`${m.subject} ${m.snippet}`)) return "keyword";
  return null;
}

const displayName = (from: string) => from.replace(/\s*<[^>]*>\s*$/, "").replace(/\s+via LinkedIn$/i, "").replace(/^"|"$/g, "").trim().toLowerCase();

/** Save the address of a contact you met on LinkedIn the first time they email you directly. */
function learnContactEmail(m: MailMeta) {
  if (/@linkedin\.com$/i.test(m.fromEmail)) return;
  run(
    "UPDATE contacts SET email = ? WHERE email IS NULL AND lower(trim(name)) = ?",
    m.fromEmail.toLowerCase(),
    displayName(m.from),
  );
}

/** The same email seen in another folder (Outlook gives moved mail a new id): same conversation, same time. */
function seenElsewhere(m: MailMeta): boolean {
  return !!get("SELECT 1 FROM processed_messages WHERE thread_id = ? AND received_at = ? AND message_id != ?", m.threadId, m.date, m.id);
}

const RECHECK_KEY = "mail.recheck.v2";

/**
 * One-off after the filter improved: look again at the last 30 days of mail it
 * skipped, and pass on anything that now looks job-related.
 */
async function recheckFiltered(provider: MailProvider, ctx: Context): Promise<MailMeta[]> {
  if (getSetting<boolean>(RECHECK_KEY)) return [];
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = all<{ message_id: string }>("SELECT message_id FROM processed_messages WHERE outcome = 'filtered' AND received_at >= ?", since);
  const found: MailMeta[] = [];
  for (const r of rows) {
    try {
      const meta = await provider.fetchMeta(r.message_id);
      if (classify(meta, ctx)) {
        run("DELETE FROM processed_messages WHERE message_id = ?", r.message_id);
        found.push(meta);
      }
    } catch {
      // moved, deleted, or from another mailbox
    }
  }
  setSetting(RECHECK_KEY, true);
  return found;
}

export function knownRoles(): KnownRole[] {
  const rows = all<{ id: number; company: string; title: string; stage: string; domain: string | null; company_id: number }>(
    `SELECT j.id, c.name AS company, j.title, j.stage, c.domain, c.id AS company_id
     FROM jobs j JOIN companies c ON c.id = j.company_id ORDER BY j.updated_at DESC`,
  );
  const contacts = all<{ company_id: number; label: string }>(
    "SELECT company_id, name || COALESCE(' <' || email || '>', '') AS label FROM contacts",
  );
  return rows.map((r) => ({
    id: r.id,
    company: r.company,
    title: r.title,
    stage: r.stage,
    domain: r.domain,
    contacts: contacts.filter((c) => c.company_id === r.company_id).map((c) => c.label).slice(0, 8),
  }));
}

function record(m: { id: string; threadId: string }, receivedAt: string | null, outcome: string, detail: string | null = null) {
  run(
    `INSERT INTO processed_messages (message_id, thread_id, received_at, outcome, detail, processed_at, attempts) VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(message_id) DO UPDATE SET outcome = excluded.outcome, detail = excluded.detail, processed_at = excluded.processed_at,
       attempts = processed_messages.attempts + 1`,
    m.id,
    m.threadId,
    receivedAt,
    outcome,
    detail,
    new Date().toISOString(),
  );
}

export const threadRole = (threadId: string) =>
  get<{ job_id: number | null }>("SELECT job_id FROM email_threads WHERE thread_id = ? AND status = 'linked'", threadId)?.job_id ?? null;

/**
 * Applies an analysis to the right role, or sends it to "Needs you" when the
 * role isn't certain. Shared by the API path and Claude-via-MCP.
 */
export function applyAnalysis(ref: EmailRef, x: Extraction, source: Source): "applied" | "proposed" | "irrelevant" {
  if (!x.relevant) return "irrelevant";
  const fromThread = threadRole(ref.threadId);
  const suggested = x.job_match.job_id !== null && !!get("SELECT id FROM jobs WHERE id = ?", x.job_match.job_id);
  const jobId = fromThread ?? (suggested && x.job_match.confidence === "high" ? x.job_match.job_id : null);
  if (jobId) {
    applyExtraction(jobId, x, ref, source);
    return "applied";
  }
  proposeEmailMatch(ref, x, source);
  return "proposed";
}

export interface MailSyncResult {
  checked: number;
  analysed: number;
  queued: number;
  applied: number;
  needsYou: number;
  errors: number;
}

export async function syncMailbox(provider: MailProvider): Promise<MailSyncResult> {
  const self = provider.selfEmail();
  if (!self) throw new Error(`${provider.label} not connected`);
  const useApi = isAiConfigured();

  const { metas: incoming, commit } = await provider.fetchNew();
  const seen = new Set(
    incoming.length
      ? all<{ message_id: string }>(
          `SELECT message_id FROM processed_messages WHERE message_id IN (${incoming.map(() => "?").join(",")})`,
          ...incoming.map((m) => m.id),
        ).map((r) => r.message_id)
      : [],
  );
  const metas = incoming.filter((m) => !seen.has(m.id) && !seenElsewhere(m));
  metas.push(...(await recheckFiltered(provider, loadContext(self))).filter((m) => !metas.some((x) => x.id === m.id)));
  for (const r of all<{ message_id: string }>("SELECT message_id FROM processed_messages WHERE outcome = 'error' AND attempts < ?", MAX_ATTEMPTS)) {
    if (!metas.some((m) => m.id === r.message_id)) {
      try {
        metas.push(await provider.fetchMeta(r.message_id));
      } catch {
        // belongs to another mailbox, or was deleted
      }
    }
  }
  metas.sort((a, b) => a.date.localeCompare(b.date)); // oldest first, so threads build up in order

  const result: MailSyncResult = { checked: metas.length, analysed: 0, queued: 0, applied: 0, needsYou: 0, errors: 0 };
  for (const meta of metas) {
    const ctx = loadContext(self); // reloaded: earlier messages may have linked threads or added contacts
    const reason = classify(meta, ctx);
    if (reason === null) {
      record(meta, meta.date, "filtered");
      continue;
    }
    if (reason === "contact") learnContactEmail(meta);
    if (reason === "alert" || reason === "ignored_thread") {
      record(meta, meta.date, reason === "alert" ? "job_alert" : "irrelevant", reason);
      continue;
    }
    try {
      const { body, truncated } = await provider.fetchBody(meta.id);
      const ref: EmailRef = { messageId: meta.id, threadId: meta.threadId, subject: meta.subject, from: meta.from, date: meta.date, href: meta.link ?? "" };
      if (!useApi) {
        enqueue(provider, meta, body, truncated);
        record(meta, meta.date, "queued", reason);
        result.queued++;
        continue;
      }
      result.analysed++;
      const x = await extractEmail(
        { from: meta.from, to: meta.to, cc: meta.cc, subject: meta.subject, date: meta.date, body, truncated, threadRoleId: ctx.threads.get(meta.threadId)?.jobId ?? null },
        knownRoles(),
      );
      const outcome = applyAnalysis(ref, x, provider.source);
      record(meta, meta.date, outcome, reason);
      if (outcome === "applied") result.applied++;
      if (outcome === "proposed") result.needsYou++;
    } catch (err) {
      result.errors++;
      record(meta, meta.date, "error", err instanceof Error ? err.message : String(err));
      if (/authentication|credit balance|401|invalid x-api-key/i.test(String(err))) throw err; // stop, don't fail every email
    }
  }
  commit();
  if (result.queued) notify(null);
  return result;
}

// ── "To read" queue (read by Claude through MCP) ────────────────────────────

function enqueue(provider: MailProvider, m: MailMeta, body: string, truncated: boolean) {
  run(
    `INSERT INTO inbox_items (message_id, provider, thread_id, from_addr, to_addr, cc_addr, subject, received_at, body, truncated, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`,
    m.id,
    provider.name,
    m.threadId,
    m.from,
    m.to,
    m.cc,
    m.subject,
    m.date,
    body,
    truncated ? 1 : 0,
    m.link,
    new Date().toISOString(),
  );
}

export interface QueueItem {
  message_id: string;
  provider: "gmail" | "outlook" | "imap";
  thread_id: string;
  from_addr: string;
  to_addr: string | null;
  cc_addr: string | null;
  subject: string | null;
  received_at: string;
  body: string;
  truncated: number;
  link: string | null;
}

export function pendingCount(): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM inbox_items WHERE status = 'pending'")!.n;
}

export function listPending(limit: number): QueueItem[] {
  return all<QueueItem>("SELECT * FROM inbox_items WHERE status = 'pending' ORDER BY received_at LIMIT ?", limit);
}

/** Records Claude's reading of a queued email and applies it. */
export function completeQueued(messageId: string, x: Extraction): "applied" | "proposed" | "irrelevant" {
  const item = get<QueueItem>("SELECT * FROM inbox_items WHERE message_id = ? AND status = 'pending'", messageId);
  if (!item) throw new Error(`No pending email with id ${messageId}`);
  const ref: EmailRef = {
    messageId: item.message_id,
    threadId: item.thread_id,
    subject: item.subject ?? "",
    from: item.from_addr,
    date: item.received_at,
    href: item.link ?? "",
  };
  const outcome = applyAnalysis(ref, x, item.provider);
  run("UPDATE inbox_items SET status = 'done', outcome = ?, done_at = ? WHERE message_id = ?", outcome, new Date().toISOString(), messageId);
  record({ id: item.message_id, threadId: item.thread_id }, item.received_at, outcome, "read by Claude");
  notify(null);
  return outcome;
}

/** Marks a queued email as not job-related; later emails in the thread are skipped too. */
export function dismissQueued(messageId: string) {
  const item = get<QueueItem>("SELECT * FROM inbox_items WHERE message_id = ? AND status = 'pending'", messageId);
  if (!item) return;
  run("UPDATE inbox_items SET status = 'done', outcome = 'irrelevant', done_at = ? WHERE message_id = ?", new Date().toISOString(), messageId);
  if (!threadRole(item.thread_id)) linkThread(item.thread_id, null, "ignored", item.subject);
  record({ id: item.message_id, threadId: item.thread_id }, item.received_at, "irrelevant", "dismissed");
  notify(null);
}
