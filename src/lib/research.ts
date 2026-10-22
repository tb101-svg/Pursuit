import "server-only";
import { z } from "zod";
import { all, get, run, tx } from "./db";
import { notify } from "./bus";
import { createJob, recordEvent } from "./engine";
import { createProposal } from "./sync/apply";
import { JOB_FIELDS, isJobField, type Facts, type FieldValue, type Job, type JobField } from "./types";
import { displayValue } from "./view";
import { describeUser, getProfile, isSales, market } from "./profile";

/**
 * Quick add + research. You give whatever you have (a JD, links, names);
 * Pursuit makes the role straight away from free local guesses, then queues it
 * for Claude to research through MCP on your subscription. Findings fill gaps
 * only; anything contradicting what's already there goes to "Needs you".
 */

export interface QuickAddInput {
  jd: string | null;
  jobUrl: string | null;
  careersUrl: string | null;
  website: string | null;
  company: string | null;
  title: string | null;
  research: boolean;
}

const MAX_JD = 50_000;
const PLACEHOLDER_TITLE = "Role (title to confirm)";
const PLACEHOLDER_COMPANY = "Unknown company";

// ── Free, instant guesses ───────────────────────────────────────────────────

const pretty = (slug: string) =>
  slug
    .replace(/[-_]+/g, " ")
    .replace(/\b(inc|ltd|pty|hq|careers|jobs)\b/gi, "")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

function hostOf(url: string | null): URL | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
}

/** Company slug from the hiring-system link formats most tech companies use. */
export function companyFromLink(url: string | null): string | null {
  const u = hostOf(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "");
  const first = u.pathname.split("/").filter(Boolean)[0];
  if (/(^|\.)greenhouse\.io$/.test(host) && first) return pretty(first);
  if (/(^|\.)lever\.co$/.test(host) && first) return pretty(first);
  if (/(^|\.)ashbyhq\.com$/.test(host) && first) return pretty(first);
  if (host === "apply.workable.com" && first) return pretty(first);
  const sub = host.match(/^([a-z0-9-]+)\.(workable|teamtailor|bamboohr|recruitee|breezy|pinpointhq|myworkdayjobs|applytojob)\.com$/);
  if (sub) return pretty(sub[1]);
  if (/(linkedin|seek|indeed|glassdoor)\./.test(host)) return null; // job boards don't name the company in the URL
  const parts = host.split(".");
  const base = parts[0] === "careers" || parts[0] === "jobs" ? parts[1] : parts[parts.length - (/\.(com|co|net)\.\w\w$/.test(host) ? 3 : 2)];
  return base ? pretty(base) : null;
}

export function domainOf(url: string | null): string | null {
  const u = hostOf(url);
  return u ? u.hostname.replace(/^(www|careers|jobs)\./, "") : null;
}

const ROLE_WORDS = /\b(account executive|account director|account manager|sales|ae\b|executive|director|manager|representative|lead|head of)/i;

export function titleFromJd(jd: string | null): string | null {
  if (!jd) return null;
  for (const line of jd.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8)) {
    if (line.length <= 90 && ROLE_WORDS.test(line) && !/[.!?]$/.test(line)) return line.replace(/^(job title|role|position)\s*[:\-]\s*/i, "");
  }
  return null;
}

const PLACES = ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Canberra", "Auckland", "Wellington", "Singapore", "London", "New York", "San Francisco", "Toronto", "Dublin"];

export function locationFromJd(jd: string | null): string | null {
  if (!jd) return null;
  // The user's own city first, so their local ads read right.
  const home = getProfile().location.split(",")[0]!.trim();
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const place = [...(home ? [home] : []), ...PLACES].find((p) => new RegExp(`\\b${escape(p)}\\b`, "i").test(jd));
  const mode = /\bremote\b/i.test(jd) ? "remote" : /\bhybrid\b/i.test(jd) ? "hybrid" : null;
  if (!place) return mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : null;
  return mode ? `${place}, ${mode}` : place;
}

// ── Quick add ───────────────────────────────────────────────────────────────

export function quickAdd(input: QuickAddInput): number {
  const jd = input.jd ? input.jd.slice(0, MAX_JD) : null;
  const company =
    input.company ?? companyFromLink(input.jobUrl) ?? companyFromLink(input.careersUrl) ?? companyFromLink(input.website) ?? PLACEHOLDER_COMPANY;
  const title = input.title ?? titleFromJd(jd) ?? PLACEHOLDER_TITLE;
  const website = input.website ?? (input.careersUrl ? `https://${domainOf(input.careersUrl)}` : null);

  return tx(() => {
    const jobId = createJob({
      company: { name: company, domain: domainOf(website) },
      title,
      facts: { url: input.jobUrl, location: locationFromJd(jd) },
      source: "you",
      note: input.research ? "Added with Quick add; research queued for Claude." : "Added with Quick add.",
    });
    if (jd) run("UPDATE jobs SET jd = ? WHERE id = ?", jd, jobId);
    if (input.careersUrl) {
      run("UPDATE companies SET careers_url = COALESCE(careers_url, ?) WHERE id = (SELECT company_id FROM jobs WHERE id = ?)", input.careersUrl, jobId);
    }
    if (input.research) queueResearch(jobId, { jobUrl: input.jobUrl, careersUrl: input.careersUrl, website });
    return jobId;
  });
}

export function queueResearch(jobId: number, inputs: Record<string, string | null>) {
  const open = get("SELECT id FROM research_requests WHERE job_id = ? AND status = 'pending'", jobId);
  if (open) return;
  run("INSERT INTO research_requests (job_id, inputs, created_at) VALUES (?, ?, ?)", jobId, JSON.stringify(inputs), new Date().toISOString());
  notify(jobId);
}

export const pendingResearchCount = () =>
  get<{ n: number }>("SELECT COUNT(*) AS n FROM research_requests WHERE status = 'pending'")!.n;

export const isResearchPending = (jobId: number) =>
  !!get("SELECT id FROM research_requests WHERE job_id = ? AND status = 'pending'", jobId);

export interface ResearchItem {
  role_id: number;
  company: string;
  title: string;
  links: Record<string, string | null>;
  job_ad_text: string | null;
  known: Record<string, unknown>;
  queued_at: string;
}

export function listResearch(limit: number): ResearchItem[] {
  const rows = all<{ job_id: number; inputs: string; created_at: string }>(
    "SELECT job_id, inputs, created_at FROM research_requests WHERE status = 'pending' ORDER BY created_at LIMIT ?",
    limit,
  );
  return rows.map((r) => {
    const job = get<Job & { company: string; domain: string | null; careers_url: string | null; summary: string | null }>(
      `SELECT j.*, c.name AS company, c.domain, c.careers_url, c.summary FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
      r.job_id,
    )!;
    const known = Object.fromEntries(
      (Object.keys(JOB_FIELDS) as JobField[]).map((f) => [f, job[f as keyof Job] ?? null]).filter(([, v]) => v !== null),
    );
    return {
      role_id: r.job_id,
      company: job.company,
      title: job.title,
      links: { ...JSON.parse(r.inputs), company_website: job.domain ? `https://${job.domain}` : null, careers_page: job.careers_url },
      job_ad_text: job.jd,
      known: { ...known, company_summary: job.summary },
      queued_at: r.created_at,
    };
  });
}

// ── Claude's findings ───────────────────────────────────────────────────────

export function researchGuide(p = getProfile()) {
  const sales = isSales(p);
  const money = sales
    ? `"OTE ${p.currency}300k, 50/50 split" = base_k 150, variable_k 150. Segment is one of SMB, Mid-Market, Enterprise, Strategic (or as the ad words it).`
    : `"${p.currency}150k base plus 10% bonus" = base_k 150, variable_k 15.`;
  const flags = sales ? "unclear territory, high quota, leadership churn" : "unclear scope, a rapid turnover in the role, leadership churn";
  return `Research this role for a job search by ${describeUser(p)}.
1. Read the job ad text if given, and fetch the job ad, careers page and company website links.
2. Search the web for the company: what it sells and to whom, funding stage and latest round, headcount, HQ and presence in ${market(p)}, recent news.
3. Report only facts you found, with sources. Use null for anything you couldn't confirm. Never guess comp.
Money is in thousands of local currency: ${money}
If the company or title on file is a placeholder or wrong, give the correct ones.
Highlights: why this role could be a good fit for the user. Flags: anything worth probing (e.g. ${flags}).${p.wants.trim() ? `
What the user wants: ${p.wants.trim()}` : ""}${p.avoid.trim() ? `
Deal-breakers (flag any you find): ${p.avoid.trim()}` : ""}`;
}

const Maybe = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();

export const ResearchSchema = z.object({
  company: z
    .object({
      name: Maybe(z.string()).describe("Correct company name, if the one on file is wrong or a placeholder"),
      summary: Maybe(z.string()).describe("2-3 sentences: what they sell, to whom, and where they're at"),
      website: Maybe(z.string()),
      careers_url: Maybe(z.string()),
      funding_stage: Maybe(z.string()).describe("e.g. 'Series C (US$200M, Jan 2026)' or 'Public (NASDAQ: X)'"),
      headcount: Maybe(z.string()),
      hq: Maybe(z.string()).describe("HQ and local office, e.g. 'San Francisco · Sydney'"),
      glassdoor: Maybe(z.string()).describe("Rating if found, e.g. '4.2 / 5 (310 reviews)'"),
    })
    .optional()
    .default({}),
  title: Maybe(z.string()).describe("Correct role title, if the one on file is wrong or a placeholder"),
  fields: z
    .object({
      location: Maybe(z.string()),
      url: Maybe(z.string()).describe("Direct link to the job ad"),
      base_k: Maybe(z.number()),
      variable_k: Maybe(z.number()),
      quota_k: Maybe(z.number()),
      equity: Maybe(z.string()),
      acv: Maybe(z.string()),
      sales_cycle: Maybe(z.string()),
      segment: Maybe(z.string()),
      territory: Maybe(z.string()),
      team_size: Maybe(z.string()),
      ramp: Maybe(z.string()),
    })
    .optional()
    .default({}),
  highlights: z.array(z.string()).optional().default([]),
  flags: z.array(z.string()).optional().default([]),
  sources: z.array(z.string()).describe("URLs you used").optional().default([]),
});

export type Research = z.infer<typeof ResearchSchema>;

export interface ResearchOutcome {
  filled: string[];
  conflicts: string[];
}

export function submitResearch(jobId: number, r: Research): ResearchOutcome {
  const outcome: ResearchOutcome = { filled: [], conflicts: [] };
  tx(() => {
    const job = get<Job & { company_name: string }>(
      "SELECT j.*, c.name AS company_name FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?",
      jobId,
    );
    if (!job) throw new Error(`No role ${jobId}`);

    // Company: fill empty details; fix a placeholder name.
    const c = r.company;
    if (c.name && job.company_name === PLACEHOLDER_COMPANY) {
      const clash = get<{ id: number }>("SELECT id FROM companies WHERE name = ? COLLATE NOCASE AND id != ?", c.name, job.company_id);
      if (clash) run("UPDATE jobs SET company_id = ? WHERE id = ?", clash.id, jobId);
      else run("UPDATE companies SET name = ? WHERE id = ?", c.name, job.company_id);
      outcome.filled.push("company name");
    }
    const companyId = get<{ company_id: number }>("SELECT company_id FROM jobs WHERE id = ?", jobId)!.company_id;
    const companyFields: [string, string | null | undefined][] = [
      ["summary", c.summary],
      ["domain", domainOf(c.website ?? null)],
      ["careers_url", c.careers_url],
      ["funding_stage", c.funding_stage],
      ["headcount", c.headcount],
      ["hq", c.hq],
      ["glassdoor", c.glassdoor],
    ];
    for (const [col, value] of companyFields) {
      if (!value) continue;
      const before = get<Record<string, string | null>>(`SELECT "${col}" AS v FROM companies WHERE id = ?`, companyId)!;
      if (before.v === null || before.v === "") {
        run(`UPDATE companies SET "${col}" = ? WHERE id = ?`, value, companyId);
        outcome.filled.push(col === "domain" ? "website" : col.replace("_", " "));
      }
    }

    // Role fields: fill gaps; conflicts wait for you.
    const fill: Facts = {};
    if (r.title && job.title === PLACEHOLDER_TITLE) fill.title = r.title;
    for (const [field, value] of Object.entries(r.fields)) {
      if (value === null || value === undefined || !isJobField(field)) continue;
      const current = job[field as keyof Job] as FieldValue;
      if (current === null || current === "") fill[field] = value;
      else if (String(current).trim().toLowerCase() !== String(value).trim().toLowerCase()) {
        const f = field as JobField;
        const show = (v: FieldValue) => displayValue(f, v === null ? null : String(v));
        createProposal("conflict", jobId, "agent", `${JOB_FIELDS[f].label}: research says ${show(value)}, you have ${show(current)}`, "Claude's research", {
          field,
          value,
          current,
          ref: { subject: "Claude's research" },
        });
        outcome.conflicts.push(JOB_FIELDS[f].label);
      }
    }
    outcome.filled.push(...Object.keys(fill).map((f) => JOB_FIELDS[f as JobField].label.toLowerCase()));

    const body = [
      c.summary,
      r.highlights.length ? `Highlights:\n${r.highlights.map((h) => `• ${h}`).join("\n")}` : "",
      r.flags.length ? `Worth probing:\n${r.flags.map((f) => `• ${f}`).join("\n")}` : "",
      r.sources.length ? `Sources:\n${r.sources.map((s) => `• ${s}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    recordEvent({
      jobId,
      kind: "research",
      source: "agent",
      title: "Researched by Claude",
      body: body || null,
      facts: fill,
      payload: r.sources[0]?.startsWith("https://") ? { href: r.sources[0] } : undefined,
    });
    run("UPDATE research_requests SET status = 'done', done_at = ? WHERE job_id = ? AND status = 'pending'", new Date().toISOString(), jobId);
  });
  notify(jobId);
  return outcome;
}
