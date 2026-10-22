import "server-only";
import { tx } from "./db";
import {
  addContact,
  addInterview,
  addNote,
  addTask,
  completeInterview,
  createJob,
  recordEvent,
  setStage,
} from "./engine";
import type { Meta } from "./engine";
import type { Facts, Source, Stage } from "./types";

/** Fictional sample data so the app can be explored before real data flows in. */

const daysAgo = (d: number, hour = 10) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(hour, 0, 0, 0);
  // "Earlier today" can't be in the future, whatever time it is now.
  const latest = Date.now() - 30 * 60_000;
  return new Date(Math.min(x.getTime(), latest)).toISOString();
};

const todayAt = (h: number, m = 0, dayOffset = 0) => {
  const x = new Date();
  x.setDate(x.getDate() + dayOffset);
  x.setHours(h, m, 0, 0);
  return x.toISOString();
};

interface DemoRole {
  company: string;
  domain: string;
  summary?: string;
  funding?: string;
  headcount?: string;
  hq?: string;
  glassdoor?: string;
  title: string;
  source: Source;
  foundDaysAgo: number;
  stage: Stage;
  facts: Facts;
}

const ROLES: DemoRole[] = [
  {
    company: "Northwind Labs", domain: "northwind.example", title: "Senior AE, Mid-Market", source: "linkedin", foundDaysAgo: 30, stage: "interviewing",
    summary: "LLM evaluation and monitoring platform for product teams.", funding: "Series B", headcount: "~180", hq: "Melbourne",
    facts: { location: "Melbourne, hybrid", rank: 1, fit: 91, base_k: 130, variable_k: 130, quota_k: 900, segment: "Mid-Market", team_size: "9 AEs", territory: "AU East", acv: "A$40–60k", attainment: "78% hit last FY" },
  },
  {
    company: "Cortexa", domain: "cortexa.example", title: "Enterprise Account Executive, ANZ", source: "linkedin", foundDaysAgo: 17, stage: "interviewing",
    summary: "AI agents that resolve customer-support tickets end to end. Buyers are Heads of CX and COOs. ANZ team launched early 2025; this is the second enterprise AE hire, covering greenfield NSW and VIC.",
    funding: "Series C", headcount: "~420 (+38% YoY)", hq: "San Francisco · Sydney", glassdoor: "4.3 / 5 (61 reviews)",
    facts: { location: "Sydney, hybrid", rank: 2, fit: 86, base_k: 150, variable_k: 150, quota_k: 1200, segment: "Enterprise", team_size: "6 AEs · 2 SEs", territory: "NSW + VIC, greenfield", acv: "A$80–120k", ramp: "3 months", sales_cycle: "4–6 months" },
  },
  {
    company: "Halcyon Data", domain: "halcyon.example", title: "Enterprise AE", source: "careers", foundDaysAgo: 12, stage: "screening",
    summary: "AI data infrastructure for regulated industries.", funding: "Series B",
    facts: { location: "Sydney", rank: 3, fit: 78, base_k: 140, variable_k: 140, segment: "Enterprise", acv: "A$100k+" },
  },
  {
    company: "Kestrel Security", domain: "kestrel.example", title: "Strategic AE", source: "seek", foundDaysAgo: 20, stage: "interviewing",
    facts: { location: "Sydney", rank: 4, fit: 69, base_k: 160, variable_k: 160, segment: "Strategic", acv: "A$150k+" },
  },
  {
    company: "Tessellate AI", domain: "tessellate.example", title: "Enterprise AE, ANZ", source: "linkedin", foundDaysAgo: 0, stage: "found",
    facts: { location: "Sydney, hybrid", rank: 5, fit: 82, base_k: 145, variable_k: 145, segment: "Enterprise" },
  },
  {
    company: "Vantage Agents", domain: "vantage.example", title: "Founding AE, ANZ", source: "linkedin", foundDaysAgo: 14, stage: "applied",
    facts: { location: "Remote, AU", rank: 6, fit: 74, base_k: 130, variable_k: 110, equity: "Early-stage options", segment: "SMB / MM", team_size: "First AE" },
  },
  {
    company: "Quarry ML", domain: "quarry.example", title: "Senior AE", source: "careers", foundDaysAgo: 0, stage: "found",
    facts: { location: "Remote, AU", rank: 7, fit: 77, base_k: 135, variable_k: 135, segment: "Mid-Market" },
  },
  {
    company: "Brightwave AI", domain: "brightwave.example", title: "Commercial AE", source: "seek", foundDaysAgo: 5, stage: "applied",
    facts: { location: "Sydney", rank: 8, fit: 64, base_k: 120, variable_k: 100, segment: "Commercial" },
  },
];

export function loadDemoData() {
  tx(() => {
    const ids: Record<string, number> = {};
    for (const r of ROLES) {
      const id = createJob({
        company: { name: r.company, domain: r.domain, summary: r.summary, funding_stage: r.funding, headcount: r.headcount, hq: r.hq, glassdoor: r.glassdoor },
        title: r.title,
        facts: r.facts,
        source: r.source,
        at: daysAgo(r.foundDaysAgo, 6),
      });
      ids[r.company] = id;
      const steps: [Stage, number][] = [];
      if (r.stage !== "found") steps.push(["applied", r.foundDaysAgo - 1]);
      if (r.stage === "screening" || r.stage === "interviewing") steps.push(["screening", r.foundDaysAgo - 4]);
      if (r.stage === "interviewing") steps.push(["interviewing", r.foundDaysAgo - 8]);
      for (const [stage, ago] of steps) setStage(id, stage, { source: "demo", at: daysAgo(Math.max(ago, 1)) });
    }

    const past = (d: number, h = 10): Meta => ({ source: "demo", at: daysAgo(d, h) });
    const quiet = (d: number, h = 10) => ({ ...past(d, h), followUps: false });

    // Cortexa: the fully worked example, panel today.
    const cx = ids["Cortexa"];
    addContact(cx, { name: "Priya Nair", title: "Senior Recruiter", role: "Recruiter", email: "priya@cortexa.example", notes: "Responsive, usually same day. Owns scheduling and references." }, past(15));
    addContact(cx, { name: "Daniel Okafor", title: "Head of ANZ Sales", role: "Hiring manager", notes: "Values multi-threading and territory planning. Would be your direct manager." }, past(13));
    addContact(cx, { name: "Megan Liu", title: "VP Sales, APAC", role: "Panel · final approver", notes: "Ex-enterprise seller. Likely to test forecasting rigour." }, past(2));
    addContact(cx, { name: "Josh Tran", title: "Solutions Engineer", role: "Panel", notes: "Will ask how you run technical evaluations." }, past(2));
    const r1 = addInterview(cx, { name: "Recruiter screen", startsAt: daysAgo(13, 11), durationMin: 30, format: "Phone", attendees: "Priya Nair" }, past(15));
    completeInterview(r1, "Went well. OTE A$300k 50/50, quota A$1.2M confirmed.", quiet(13, 12));
    const r2 = addInterview(cx, { name: "Hiring manager", startsAt: daysAgo(6, 14), durationMin: 45, format: "Zoom", attendees: "Daniel Okafor" }, past(10));
    completeInterview(r2, "Strong. He asked for a 12-month NSW/VIC business case.", quiet(6, 15));
    const r3 = addInterview(cx, { name: "Business case", startsAt: daysAgo(3, 9), format: "Written", attendees: "Daniel Okafor" }, past(6, 16));
    completeInterview(r3, "Submitted deck v3.", quiet(3, 9));
    addInterview(cx, { name: "Panel interview", startsAt: todayAt(11, 30), durationMin: 45, format: "Zoom", attendees: "Daniel, Megan, Josh" }, { source: "gmail", at: daysAgo(1, 16) });
    addInterview(cx, { name: "Exec interview", startsAt: null, format: "Zoom", attendees: "CRO (US)" }, past(1, 16));
    addNote(cx, "Megan will push on forecasting accuracy. Ask about team attainment and ANZ equity.", past(1, 18));

    // Northwind: final round booked from an email.
    const nw = ids["Northwind Labs"];
    const n1 = addInterview(nw, { name: "Recruiter screen", startsAt: daysAgo(18, 10), durationMin: 30, attendees: "Sam Lee" }, past(20));
    completeInterview(n1, "Good fit on segment.", quiet(18, 11));
    const n2 = addInterview(nw, { name: "Hiring manager", startsAt: daysAgo(9, 13), durationMin: 45, attendees: "Aisha Khan" }, past(12));
    completeInterview(n2, "Very strong.", quiet(9, 14));
    addContact(nw, { name: "Rachel Adeyemi", title: "CRO", role: "Exec interviewer" }, { source: "gmail", at: daysAgo(1, 9) });
    addInterview(nw, { name: "Exec with CRO", startsAt: todayAt(14, 0, 5), durationMin: 45, format: "Zoom", attendees: "Rachel Adeyemi" }, { source: "gmail", at: daysAgo(1, 9) });
    setStage(nw, "final", { source: "gmail", at: daysAgo(1, 9) });

    // Halcyon: recruiter screen today.
    addInterview(ids["Halcyon Data"], { name: "Recruiter screen", startsAt: todayAt(15, 0), durationMin: 30, format: "Phone", attendees: "Ella Marsh" }, { source: "calendar", at: daysAgo(2, 12) });

    // Kestrel: facts captured from a call.
    const ks = ids["Kestrel Security"];
    const k1 = addInterview(ks, { name: "Hiring manager", startsAt: daysAgo(1, 10), durationMin: 45, attendees: "Sam Whitford" }, past(4));
    completeInterview(k1, "Solid. Waiting on feedback.", quiet(1, 11));
    recordEvent({ jobId: ks, kind: "call", source: "call", title: "Facts from call with Sam Whitford", occurredAt: daysAgo(1, 11), facts: { quota_k: 1400, team_size: "8 AEs", attainment: "55% hit last FY" } });

    // Vantage: gone quiet, follow-up overdue.
    addTask(ids["Vantage Agents"], "Follow up on application", daysAgo(1, 9), { source: "agent", at: daysAgo(12) });

    // Brightwave: a step later in the week.
    addTask(ids["Brightwave AI"], "Check in with recruiter", todayAt(10, 0, 4), past(5));
  });
}
