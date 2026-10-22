import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { all, get, getSetting, run, setSetting, tx } from "./db";
import { notify } from "./bus";
import { dataPath } from "./paths";
import { addContact, addTask, recordEvent } from "./engine";
import { createProposal } from "./sync/apply";
import { ExtractionSchema } from "./ai/extract";
import { JOB_FIELDS, isJobField, type Facts, type FieldValue, type Job, type JobField } from "./types";
import { displayValue } from "./view";
import { starsForDrafting } from "./star";
import { describeUser, firstName, getProfile, isSales, market, type Profile } from "./profile";

/**
 * Interview prep. Your library (standard answers, story bank, checklist,
 * resume) is written once and reused; each role gets a prep sheet built from
 * it, which Claude can tailor from the job ad and research. Calls keep your
 * notes, an optional local recording, and the transcript Claude reads after.
 */

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface PrepItem {
  title: string;
  body?: string;
  note?: string;
  done?: boolean;
  /** "Interview them" items: which of your three priorities, and whether it's a fact or a question. */
  group?: Pillar;
  kind?: "know" | "ask";
  /** What they said, noted during or after the call. */
  answer?: string;
  /** Practice questions: why they'd ask it, which STAR story to use, points to hit, follow-ups to expect. */
  why?: string;
  story?: string;
  star?: { situation: string; task: string; action: string; result: string };
  points?: string[];
  probes?: string[];
  /** Your practice self-rating: 1 needs work, 2 okay, 3 nailed it. */
  confidence?: number;
  practiced_at?: string;
  /** Practice questions: Behavioural, Role, Numbers drill, Motivation, Mock pitch. */
  category?: string;
  /** Project tasks: which phase they belong to. */
  phase?: Phase;
}

/** Prep as a project, following your interview-prep method. */
export const PHASES = [
  { id: "research", label: "Research", sub: "The round, the company, its gaps, every interviewer" },
  { id: "prepared", label: "Preparedness", sub: "Make an impression before you walk in, and know your numbers cold" },
  { id: "qa", label: "Q&A", sub: "Questions to expect, with STAR answers from your stories" },
  { id: "them", label: "Questions for them", sub: "Tailored, personal questions, and the close" },
] as const;
export type Phase = (typeof PHASES)[number]["id"];

/** The checklist every round starts with (from the method). Claude can add role-specific ones. */
const DEFAULT_TASKS: { phase: Phase; title: string }[] = [
  { phase: "research", title: "Pin down the round: interviewers, titles, format, time" },
  { phase: "research", title: "Company researched: stage, funding, product, buyers, competitors, recent news" },
  { phase: "research", title: "2–3 gaps where the business looks exposed" },
  { phase: "research", title: "Each interviewer researched: background, tenure, likely success criteria, shared connections" },
  { phase: "prepared", title: "Pre-interview note sent to the hiring manager (~24h before)" },
  { phase: "prepared", title: "Multi-threaded: 2–4 people at the company contacted" },
  { phase: "prepared", title: "Numbers sheet known cold, 2–3 levels deep" },
  { phase: "prepared", title: "Story arc and resume risk points rehearsed" },
  { phase: "prepared", title: "Four pillars covered: no thin pillar" },
  { phase: "prepared", title: "Resume sent (don't rely on LinkedIn); logistics confirmed" },
  { phase: "qa", title: "Openers said out loud 2–3×" },
  { phase: "qa", title: "Every expected question practised out loud" },
  { phase: "qa", title: "Numbers drill run until the answers are crisp" },
  { phase: "qa", title: "A STAR story ready for each behavioural theme" },
  { phase: "qa", title: "Mock pitch / discovery prepared (if it's a role-play round)" },
  { phase: "them", title: "3–4 questions picked from the researched gaps" },
  { phase: "them", title: "Questions that size up the leaders you'd work for" },
  { phase: "them", title: "Team / Product / Growth questions ready" },
  { phase: "them", title: "Close ready: ask for concerns, agree the next step" },
];

const DEFAULT_CLOSE: PrepItem[] = [
  { title: "Is there anything in my background that gives you hesitation about moving me forward?", done: false },
  { title: "What are the next steps, and when should I expect to hear?", done: false },
  { title: "Is there anyone else on the team you'd suggest I speak with?", done: false },
];

const defaultTasks = (): PrepItem[] => DEFAULT_TASKS.map((t) => ({ ...t, done: false }));

/** What you're assessing them on. Team feeds your Culture rating; Product and Growth their own. */
export const PILLARS = [
  { id: "team", label: "Team", sub: "Culture, mindset, strategy", rating: "rating_culture" },
  { id: "product", label: "Product", sub: "What you'd sell, and why it wins", rating: "rating_product" },
  { id: "growth", label: "Growth", sub: "Their trajectory, and yours", rating: "rating_growth" },
] as const;
export type Pillar = (typeof PILLARS)[number]["id"];

export const PREP_SECTIONS = [
  "round", "facts", "gaps", "interviewers", "talking_points",
  "outreach", "numbers", "arc", "pillars", "checklist",
  "openers", "questions", "pitch", "stories",
  "them", "ask", "close",
  "tasks",
] as const;
export type PrepSection = (typeof PREP_SECTIONS)[number];
export type PrepContent = Record<PrepSection, PrepItem[]> & { focus?: string | null };

export type LibraryKind = "answer" | "story" | "check" | "them";
export interface LibraryItem {
  id: number;
  kind: LibraryKind;
  title: string;
  body: string;
  note: string | null;
  position: number;
}

export interface Resume {
  text: string;
  url: string | null;
  updated_at: string | null;
}

const now = () => new Date().toISOString();
const RESUME_KEY = "prep.resume";
const SEEDED_KEY = "prep.seeded";
const SEED_FILE = dataPath("prep-seed.json");

// ── Library ─────────────────────────────────────────────────────────────────

/** First run: load your starting library from data/prep-seed.json if it's there. */
function ensureSeeded() {
  if (getSetting<boolean>(SEEDED_KEY)) return;
  setSetting(SEEDED_KEY, true);
  if (!fs.existsSync(SEED_FILE)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as {
      answers?: { title: string; body: string; note?: string }[];
      stories?: { title: string; body: string }[];
      checklist?: string[];
      resume?: { text: string; url?: string };
    };
    tx(() => {
      const add = (kind: LibraryKind, items: { title: string; body?: string; note?: string }[]) =>
        items.forEach((it, i) => run("INSERT INTO prep_library (kind, title, body, note, position, updated_at) VALUES (?, ?, ?, ?, ?, ?)", kind, it.title, it.body ?? "", it.note ?? null, i, now()));
      add("answer", seed.answers ?? []);
      add("story", seed.stories ?? []);
      add("check", (seed.checklist ?? []).map((title) => ({ title })));
      if (seed.resume?.text) setSetting(RESUME_KEY, { text: seed.resume.text, url: seed.resume.url ?? null, updated_at: now() } satisfies Resume);
    });
  } catch {
    // A broken seed file just means an empty library.
  }
}

/** Your questions for them: title = question, body = what to listen for, note = pillar. */
const DEFAULT_THEM: { group: Pillar; title: string; body: string }[] = [
  { group: "team", title: "How would you describe the culture on the sales team, and what would your reps say?", body: "Specific examples and the same story from each interviewer. Flag: vague “work hard, play hard”, or answers that don't match Glassdoor." },
  { group: "team", title: "What does a top performer here do differently from an average one?", body: "Behaviours you share (curiosity, process, using AI, owning pipeline) rather than just hours and hustle." },
  { group: "team", title: "What % of the team hit quota last year, and how has the team changed in the last 12 months?", body: "Over ~60% attainment is healthy. Flag: dodging the number, lots of recent exits, constant re-orgs." },
  { group: "team", title: "How do you run the team week to week: forecasting, deal reviews, coaching?", body: "Coaching and deal strategy, not just inspection. How much autonomy a senior AE gets." },
  { group: "team", title: "What's the go-to-market strategy for this region over the next 12–18 months, and where does this seat fit?", body: "A clear, specific plan with the reasoning behind it. Flag: “we're still figuring it out” from leadership." },
  { group: "team", title: "How do sales, SEs, marketing and customer success work together, and who owns pipeline?", body: "Real support (SEs, SDRs, marketing pipeline) vs “you're on your own”." },
  { group: "product", title: "Why do customers choose you over the main competitor, and why do you lose?", body: "An honest loss reason is a good sign. Flag: “we never lose”, or losing mostly on price." },
  { group: "product", title: "How much of the AI / product roadmap is live and selling today vs coming soon?", body: "Real customer usage and attach rates, not slideware." },
  { group: "product", title: "What does net revenue retention and time-to-value look like?", body: "NRR over ~110% means customers get value and expand; fast time-to-value shortens your cycles." },
  { group: "product", title: "Which customers get the most value, and does this territory have enough of them?", body: "Ideal customer profile matches the patch; there's enough whitespace to hit quota." },
  { group: "growth", title: "What's driving growth right now: new logos, expansion, new products?", body: "Momentum you can ride. Flag: growth only from price rises or one big customer." },
  { group: "growth", title: "How much is the company investing in this region this year: headcount, marketing, partners, local SEs?", body: "Committed local investment, not a satellite office run from the US." },
  { group: "growth", title: "What's the funding position or path to profitability, and how does it shape targets?", body: "Runway and realistic targets. Flag: quota jumps to fix a funding gap." },
  { group: "growth", title: "Where have AEs gone from this role, and what could it look like for me in 2 years?", body: "Real examples of promotion into bigger segments or leadership." },
];

function ensureThemSeeded() {
  if (getSetting<boolean>("prep.seeded.them")) return;
  setSetting("prep.seeded.them", true);
  if (get("SELECT id FROM prep_library WHERE kind = 'them'")) return;
  tx(() =>
    DEFAULT_THEM.forEach((q, i) =>
      run("INSERT INTO prep_library (kind, title, body, note, position, updated_at) VALUES ('them', ?, ?, ?, ?, ?)", q.title, q.body, q.group, i, now()),
    ),
  );
}

const pillarOf = (note: string | null): Pillar => (PILLARS.some((p) => p.id === note) ? (note as Pillar) : "team");

/** Your "Interview them" questions as prep items. */
function themFromLibrary(): PrepItem[] {
  return listLibrary("them").map((q) => ({ group: pillarOf(q.note), kind: "ask", title: q.title, body: q.body || undefined, done: false }));
}

export function listLibrary(kind?: LibraryKind): LibraryItem[] {
  ensureSeeded();
  ensureThemSeeded();
  const rows = kind
    ? all<LibraryItem>("SELECT id, kind, title, body, note, position FROM prep_library WHERE kind = ? ORDER BY position, id", kind)
    : all<LibraryItem>("SELECT id, kind, title, body, note, position FROM prep_library ORDER BY kind, position, id");
  return rows.map((r) => ({ ...r })); // plain objects, so they can go to client components
}

export function saveLibraryItem(item: { id?: number; kind: LibraryKind; title: string; body: string; note: string | null }) {
  if (item.id) {
    run("UPDATE prep_library SET title = ?, body = ?, note = ?, updated_at = ? WHERE id = ?", item.title, item.body, item.note, now(), item.id);
    return item.id;
  }
  const pos = get<{ p: number | null }>("SELECT MAX(position) AS p FROM prep_library WHERE kind = ?", item.kind)!.p ?? -1;
  return run("INSERT INTO prep_library (kind, title, body, note, position, updated_at) VALUES (?, ?, ?, ?, ?, ?)", item.kind, item.title, item.body, item.note, pos + 1, now());
}

export function deleteLibraryItem(id: number) {
  run("DELETE FROM prep_library WHERE id = ?", id);
}

export function getResume(): Resume {
  ensureSeeded();
  return getSetting<Resume>(RESUME_KEY) ?? { text: "", url: null, updated_at: null };
}

export function saveResume(text: string, url: string | null) {
  setSetting(RESUME_KEY, { text, url, updated_at: now() } satisfies Resume);
}

// ── Per-role prep ───────────────────────────────────────────────────────────

type RoleForPrep = Job & { company_name: string; summary: string | null; funding_stage: string | null; headcount: string | null; hq: string | null; glassdoor: string | null };

function roleForPrep(jobId: number): RoleForPrep | undefined {
  return get<RoleForPrep>(
    `SELECT j.*, c.name AS company_name, c.summary, c.funding_stage, c.headcount, c.hq, c.glassdoor
     FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
    jobId,
  );
}

const GAP_QUESTIONS: Partial<Record<JobField, string>> = {
  base_k: "What's the base / OTE split for this seat?",
  quota_k: "What's the annual quota, and how much of the team hit it last year?",
  acv: "What's the typical deal size in this region right now?",
  sales_cycle: "How long is a typical sales cycle?",
  territory: "How is the territory carved — named accounts, vertical or geo?",
  team_size: "How big is the team, and who would I work most closely with?",
  ramp: "What does ramp look like — time and quota relief?",
};

/** A starting sheet from your library and what Pursuit knows about the role. */
function defaultPrep(role: RoleForPrep): PrepContent {
  const answers = listLibrary("answer");
  const facts: PrepItem[] = [
    { title: "What they sell", body: role.summary ?? undefined },
    { title: "Stage / ownership", body: role.funding_stage ?? undefined },
    { title: "Scale", body: role.headcount ?? undefined },
    { title: "Glassdoor", body: role.glassdoor ?? undefined },
  ].filter((f) => f.body);
  const gaps = (Object.keys(GAP_QUESTIONS) as JobField[]).filter((f) => role[f as keyof Job] === null).map((f) => ({ title: GAP_QUESTIONS[f]!, done: false }));
  return {
    facts,
    them: themFromLibrary(),
    openers: answers.slice(0, 2).map((a) => ({ title: a.title, body: a.body.replaceAll("[company]", role.company_name), note: a.note ?? undefined })),
    talking_points: [],
    stories: listLibrary("story").map((s) => ({ title: s.title, body: s.body })),
    questions: answers.slice(2).map((a) => ({ title: a.title, body: a.body || undefined, note: a.note ?? undefined })),
    ask: [
      ...gaps,
      { title: "What's driving this hire — growth, backfill, or a new patch?", done: false },
      { title: "What does a strong first 6–12 months look like in this seat?", done: false },
    ],
    checklist: listLibrary("check").map((c) => ({ title: c.title, done: false })),
    round: [],
    gaps: [],
    interviewers: [],
    outreach: [],
    numbers: [],
    arc: [],
    pillars: [],
    pitch: [],
    close: DEFAULT_CLOSE.map((c) => ({ ...c })),
    tasks: defaultTasks(),
    focus: null,
  };
}

export interface RolePrep {
  content: PrepContent;
  source: string | null;
  updated_at: string | null;
  saved: boolean;
}

export function getPrep(jobId: number): RolePrep | null {
  const role = roleForPrep(jobId);
  if (!role) return null;
  const row = get<{ content: string; source: string; updated_at: string }>("SELECT content, source, updated_at FROM role_prep WHERE job_id = ?", jobId);
  if (!row) return { content: defaultPrep(role), source: null, updated_at: null, saved: false };
  const parsed = JSON.parse(row.content) as Partial<PrepContent>;
  const content = Object.fromEntries(PREP_SECTIONS.map((s) => [s, parsed[s] ?? []])) as unknown as PrepContent;
  if (!parsed.them) content.them = themFromLibrary(); // sheets saved before "Interview them" existed
  if (!parsed.tasks) content.tasks = defaultTasks(); // ...or before prep became a project
  if (!parsed.close) content.close = DEFAULT_CLOSE.map((c) => ({ ...c }));
  content.focus = parsed.focus ?? null;
  return { content, source: row.source, updated_at: row.updated_at, saved: true };
}

export function savePrep(jobId: number, content: PrepContent, source: "you" | "agent" = "you") {
  run(
    `INSERT INTO role_prep (job_id, content, source, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET content = excluded.content, source = excluded.source, updated_at = excluded.updated_at`,
    jobId,
    JSON.stringify(content),
    source,
    now(),
  );
  notify(jobId);
}

// ── Claude drafts a prep sheet ──────────────────────────────────────────────

export function queuePrep(jobId: number, focus: string | null) {
  if (get("SELECT id FROM prep_requests WHERE job_id = ? AND status = 'pending'", jobId)) return;
  run("INSERT INTO prep_requests (job_id, focus, created_at) VALUES (?, ?, ?)", jobId, focus, now());
  notify(jobId);
}

export const pendingPrepCount = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM prep_requests WHERE status = 'pending'")!.n;
export const isPrepPending = (jobId: number) => !!get("SELECT id FROM prep_requests WHERE job_id = ? AND status = 'pending'", jobId);

/** A general interview-prep method, used until the user adds their own (Settings → Your profile). */
const DEFAULT_METHOD = `# Interview prep method
- Treat the process as a project: every touchpoint (emails, punctuality, follow-ups) is part of the assessment.
- The interviewer is looking for reasons not to hire. Prepare to remove each doubt with evidence: fast ramp, day-one impact, raising the bar.
- Past performance predicts future performance. Expect every claim on the resume to be probed two or three levels deep; know how each number was made.
- Research the company (stage, funding or earnings, product, customers, competitors, recent news) and each interviewer (background, tenure, why they moved, what they care about).
- Find 2–3 places the business looks exposed and turn them into sharp questions; these replace canned questions.
- Send a short pre-interview note ~24 hours before: genuine interest plus 2–3 things you'd like to understand. It sets the agenda.
- Answer behavioural questions in STAR, with the result first in numbers.
- Interview them too: team and leadership, product, growth and your own path.
- Close every round: ask whether anything gives them hesitation, handle it, and agree the next step and date.
- Same day: a thank-you and recap of their priorities, how you map to them, and the agreed next step.`;

/** The user's interview-prep method: their own (profile), else data/interview-prep-method.md, else the default. */
function methodText(): string {
  const own = getProfile().method.trim();
  if (own) return own;
  const file = dataPath("interview-prep-method.md");
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_METHOD;
}

function prepGuideText(p: Profile) {
  const sales = isSales(p);
  const name = firstName(p);
  const where = market(p);
  const careerNotes = p.careerNotes.trim()
    ? ` Handle these the way the user explains them: ${p.careerNotes.trim()}`
    : " Check your_notes for anything the user wants handled carefully.";
  return `Run the user's interview-prep method (method, below) for this role and round, and return it as a prep project. Ignore the method's "Where the output goes" section: everything goes back through submit_prep in these fields. Never send anything; outreach is drafts only.
- round: the round snapshot (label/value): who (names and titles), format, time, what they're testing.
- facts: the company in ~6 one-line bullets (stage, funding/valuation or earnings, headcount and team in ${where}, product, buyer, competitors, recent news).
- gaps: 2–3 places the business looks exposed (title = the specific question to ask, body = why, with evidence).
- interviewers: one per interviewer (title = name and title; body = background, previous companies and why they moved, tenure, what they post about, shared connections; note = their likely success criteria${sales ? ", and hunter or farmer" : ""}).
- outreach: drafts only. First the pre-interview note to the hiring manager for ~24h before (title = "Pre-interview note to <name>", body = the full note: genuine excitement plus 2–3 bullets the user would like to understand; note = when and where to send). Then 2–4 multi-thread LinkedIn notes (title = name, title and why them; body = the note; note = shared connection if any). Write in ${name}'s voice: ${p.voice.trim() || "warm, direct, specific"}.
- numbers: the numbers sheet (title = metric, body = the figure, note = how it was made and the level-2/3 answer${sales ? ": self-sourced vs inbound, new vs expansion, cycle, conversion" : ": what the user personally did, the baseline, the time frame"}). Only real figures from the resume, STAR stories and notes; [add: …] where unknown.
- arc: the story arc and resume risk points (title = the question a sceptical hiring manager would ask, body = a clean, confident answer). Include why each move, short stints and gaps.${careerNotes}
- pillars: Intelligence, Character, Drive, Coachability (title = pillar, body = the user's strongest evidence, note = "Thin: …" with a story to fill it, or empty).
- pitch: ${sales ? "only if the round includes a mock pitch or role-play discovery. Command of the Message: before scenario, negative consequences, after scenario, positive business outcomes, required capabilities, metrics, differentiators, plus a discovery question ladder that goes three levels deep on pain (problem → impact → implication, quantified). Empty otherwise." : "only if the round includes a presentation, case study or work sample: the structure, key points and likely challenges. Empty otherwise."}
- tasks: only extra, role-specific to-dos beyond the standard checklist (phase = research | prepared | qa | them).
- close: the closing questions (concerns about moving forward, next step and timing), tailored.

Also, in the user's voice (${describeUser(p)}):
- Research first: fetch the job ad/company links and search the web for funding, recent news, acquisitions, AI/product launches, investment in ${where}, leadership moves, Glassdoor${sales ? "/RepVue" : ""}; look up every interviewer named in the focus, upcoming_interviews or people.
- them: the user is interviewing THEM as much as they're being interviewed, on three things: team (group "team": culture, mindset, leadership, ${sales ? "sales strategy" : "how the team works"}), product (group "product") and growth (group "growth": company momentum, investment in ${where}, the user's own path). For each group give 2–4 "know" items (kind "know": what you found, e.g. Glassdoor themes, leadership tenure and churn, funding, launches, local headcount, with the source in body) and 3–5 "ask" items (kind "ask": sharp questions tailored to what you found, body = what to listen for: green and red flags). Start from the user's own questions (your_questions_for_them) and sharpen them with specifics. This matters most to the user; be candid about risks.
- openers: "Tell me about yourself" (~70 sec) and "Why are you looking / why us?" (~35 sec) word-for-word, adapted from the user's standard answers: keep their story and numbers exactly, rewrite the "why this company" part with specific, researched reasons. note = the arc and target length.
- talking_points: 3–5 company-specific hooks (acquisitions, launches, regional moves) with one line each on why it matters.
- stories: what this company will test for (from the job ad) → the user's matching proof point from their story bank / resume. Never invent achievements or numbers.
- questions: 10–15 questions this interviewer is likely to ask, adapted to the job ad, the focus, the people and especially what came up in previous_calls (concerns they raised, what they care about, next_round_prep). Mix, with category set: 4–6 Behavioural ("tell me about a time…"), 2–3 Numbers drill (a headline number question, with probes that go two to three levels deeper: how, why, ${sales ? "what share was self-sourced" : "what was the user's own part"}), 2–3 Role (${sales ? "territory, deal motion, their buyers" : "scope, how the work gets done, who they work with"}), 1–2 Motivation (why them, why now)${sales ? ", and Mock pitch questions if it's a role-play round" : ""}. For each:
  - title: the question as they'd phrase it. why: one line on why they're likely to ask it (cite the JD line or the call).
  - story: the title of the user's STAR story that best answers it (from your_star_stories), or "" if none fits.
  - star: situation / task / action / result for THIS question, built only from the user's real stories and resume (keep numbers exact; actions in first person, 3–4 concrete steps). Where a fact is missing, write [add: …] rather than inventing it.
  - body: the best-in-class spoken answer (60–120 sec), following S→T→A→R and ending with a line that connects it to this company.
  - points: 3–5 must-say points or numbers. probes: 2–3 follow-up questions they may ask next.
  - Role-specific or motivation questions can leave star empty; still give body, points and probes.
- ask: 5–6 sharp, personal questions about the seat (comp, ${sales ? "territory, ramp" : "scope, success measures"}, why it's open, what the first 6–12 months look like), including any open comp${sales ? "/territory" : ""} gaps. done = false.
- checklist: day-of reminders, adapted to this round (e.g. name the talking points to weave in, who to ask for by name, dress for in-person). done = false.
If a focus is given (e.g. the interviewer or round), tailor to it.`;
}

export const prepGuide = () => `${prepGuideText(getProfile())}\n\n--- method (the user's interview-prep method) ---\n${methodText()}`;

const Item = z.object({ title: z.string(), body: z.string().optional(), note: z.string().optional(), done: z.boolean().optional() });
const QuestionItem = z.object({
  title: z.string().describe("The question, as they'd phrase it"),
  why: z.string().optional().describe("Why they're likely to ask it (JD line, call, interviewer)"),
  story: z.string().optional().describe("Title of the user's STAR story to use, or empty"),
  star: z.object({ situation: z.string(), task: z.string(), action: z.string(), result: z.string() }).optional(),
  body: z.string().describe("Best-in-class spoken answer, 60–120 seconds"),
  category: z.enum(["Behavioural", "Role", "Numbers drill", "Motivation", "Mock pitch"]).optional(),
  points: z.array(z.string()).optional().default([]),
  probes: z.array(z.string()).optional().default([]),
});
const ThemItem = z.object({
  group: z.enum(["team", "product", "growth"]),
  kind: z.enum(["know", "ask"]),
  title: z.string().describe("know: the finding; ask: the question"),
  body: z.string().optional().describe("know: source or detail; ask: what to listen for (green / red flags)"),
});

export const PrepSchema = z.object({
  facts: z.array(Item).describe("title = label, body = value"),
  them: z.array(ThemItem).describe("Interview them: what you found and what to ask, per team / product / growth"),
  openers: z.array(Item).describe("title = question, body = script, note = arc / length"),
  talking_points: z.array(Item),
  stories: z.array(Item).describe("title = what they're testing for, body = the user's proof point"),
  questions: z.array(QuestionItem).describe("Practice questions with STAR answers"),
  ask: z.array(Item).describe("Questions for the user to ask them"),
  checklist: z.array(Item),
  round: z.array(Item).optional().default([]).describe("Round snapshot: label/value"),
  gaps: z.array(Item).optional().default([]).describe("Where the business looks exposed: question + why"),
  interviewers: z.array(Item).optional().default([]).describe("title = name & title, body = profile, note = likely success criteria"),
  outreach: z.array(Item).optional().default([]).describe("Draft notes: pre-interview note, then multi-thread notes"),
  numbers: z.array(Item).optional().default([]).describe("Numbers sheet: metric, figure, how/why"),
  arc: z.array(Item).optional().default([]).describe("Story arc and resume risk points: question + answer"),
  pillars: z.array(Item).optional().default([]).describe("Intelligence, Character, Drive, Coachability"),
  pitch: z.array(Item).optional().default([]).describe("Mock pitch / discovery prep, if a role-play round"),
  close: z.array(Item).optional().default([]),
  tasks: z
    .array(z.object({ phase: z.enum(["research", "prepared", "qa", "them"]), title: z.string() }))
    .optional()
    .default([])
    .describe("Extra role-specific to-dos"),
  sources: z.array(z.string()).optional().default([]),
});

export function listPrepsToDraft(limit: number) {
  const rows = all<{ job_id: number; focus: string | null; created_at: string }>(
    "SELECT job_id, focus, created_at FROM prep_requests WHERE status = 'pending' ORDER BY created_at LIMIT ?",
    limit,
  );
  const resume = getResume();
  return {
    remaining: pendingPrepCount(),
    guide: prepGuide(),
    your_standard_answers: listLibrary("answer").map((a) => ({ question: a.title, script: a.body, note: a.note })),
    your_story_bank: listLibrary("story").map((s) => ({ testing_for: s.title, proof_point: s.body })),
    your_star_stories: starsForDrafting(),
    your_checklist: listLibrary("check").map((c) => c.title),
    your_questions_for_them: listLibrary("them").map((q) => ({ group: pillarOf(q.note), question: q.title, listen_for: q.body })),
    resume: resume.text,
    roles: rows.map((r) => {
      const role = roleForPrep(r.job_id)!;
      const known = Object.fromEntries(
        (Object.keys(JOB_FIELDS) as JobField[]).map((f) => [f, role[f as keyof Job] ?? null]).filter(([, v]) => v !== null),
      );
      const research = all<{ body: string | null }>("SELECT body FROM events WHERE job_id = ? AND kind = 'research' ORDER BY occurred_at DESC LIMIT 2", r.job_id);
      return {
        role_id: r.job_id,
        company: role.company_name,
        title: role.title,
        focus: r.focus,
        company_known: { summary: role.summary, funding_stage: role.funding_stage, headcount: role.headcount, hq: role.hq, glassdoor: role.glassdoor },
        role_known: known,
        job_ad_text: role.jd,
        earlier_research: research.map((e) => e.body).filter(Boolean),
        upcoming_interviews: all("SELECT name, starts_at, format, attendees FROM interviews WHERE job_id = ? AND status = 'scheduled'", r.job_id),
        people: all("SELECT name, title, role, notes FROM contacts WHERE company_id = ?", role.company_id),
        your_notes: role.notes || null,
        previous_calls: all<{ title: string | null; started_at: string; notes: string; summary: string | null }>(
          "SELECT title, started_at, notes, summary FROM call_sessions WHERE job_id = ? ORDER BY started_at",
          r.job_id,
        ).map((c) => {
          const s = c.summary ? (JSON.parse(c.summary) as CallSummary) : null;
          return {
            call: c.title,
            date: c.started_at,
            your_notes: c.notes || null,
            summary: s?.summary ?? null,
            key_notes: s?.notes ?? [],
            what_they_said: s?.them ?? [],
            prepare_for_next_round: s?.next_round_prep ?? [],
          };
        }),
      };
    }),
  };
}

export function submitPrep(jobId: number, draft: z.infer<typeof PrepSchema>) {
  const current = getPrep(jobId);
  if (!current) throw new Error(`No role ${jobId}`);
  // Keep your ticks on anything that survives the redraft.
  const ticked = new Set(
    [...current.content.ask, ...current.content.checklist, ...current.content.them, ...current.content.tasks, ...current.content.outreach, ...current.content.close]
      .filter((i) => i.done)
      .map((i) => i.title.toLowerCase()),
  );
  const practised = new Map(current.content.questions.filter((q) => q.confidence).map((q) => [q.title.toLowerCase(), q]));
  const tick = (items: PrepItem[]) => items.map((i) => ({ ...i, done: ticked.has(i.title.toLowerCase()) }));
  // …and anything they've already told you.
  const answers = new Map(current.content.them.filter((i) => i.answer).map((i) => [i.title.toLowerCase(), i.answer!]));
  const them: PrepItem[] = draft.them.map((i) => ({ ...i, done: ticked.has(i.title.toLowerCase()), answer: answers.get(i.title.toLowerCase()) }));
  for (const old of current.content.them) if (old.answer && !draft.them.some((i) => i.title.toLowerCase() === old.title.toLowerCase())) them.push(old);
  const focus = get<{ focus: string | null }>("SELECT focus FROM prep_requests WHERE job_id = ? AND status = 'pending'", jobId)?.focus ?? null;
  tx(() => {
    const questions: PrepItem[] = draft.questions.map((q) => {
      const old = practised.get(q.title.toLowerCase());
      return { ...q, confidence: old?.confidence, practiced_at: old?.practiced_at };
    });
    const extra = draft.tasks.filter((t) => !DEFAULT_TASKS.some((d) => d.title.toLowerCase() === t.title.toLowerCase()));
    const mine = current.content.tasks.filter((t) => !DEFAULT_TASKS.some((d) => d.title.toLowerCase() === t.title.toLowerCase()) && t.phase);
    const tasks = tick([...defaultTasks(), ...mine, ...extra.filter((t) => !mine.some((m) => m.title.toLowerCase() === t.title.toLowerCase()))]);
    savePrep(
      jobId,
      {
        ...draft,
        questions,
        them,
        ask: tick(draft.ask),
        checklist: tick(draft.checklist),
        outreach: tick(draft.outreach),
        close: tick(draft.close.length ? draft.close : DEFAULT_CLOSE),
        tasks,
        focus,
      },
      "agent",
    );
    recordEvent({
      jobId,
      kind: "prep",
      source: "agent",
      title: current.saved ? "Prep sheet redrafted by Claude" : "Prep sheet drafted by Claude",
      body: draft.sources.length ? `Sources:\n${draft.sources.map((s) => `• ${s}`).join("\n")}` : null,
    });
    run("UPDATE prep_requests SET status = 'done', done_at = ? WHERE job_id = ? AND status = 'pending'", now(), jobId);
  });
}

// ── Calls: notes, recording, transcript ─────────────────────────────────────

export interface CallSession {
  id: number;
  job_id: number;
  interview_id: number | null;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string;
  transcript: string | null;
  transcript_status: string | null;
  recording_path: string | null;
  transcribe_progress: number | null;
  transcribe_error: string | null;
  /** JSON: Claude's reading of the call and what it changed (CallSummary). */
  summary: string | null;
  /** JSON: Claude's review of how the interview went (CallReview). */
  review: string | null;
  review_status: string | null;
}

export const RECORDINGS_DIR = dataPath("recordings");

export function startCall(jobId: number, interviewId: number | null): number {
  const iv = interviewId ? get<{ name: string }>("SELECT name FROM interviews WHERE id = ? AND job_id = ?", interviewId, jobId) : undefined;
  const id = run(
    "INSERT INTO call_sessions (job_id, interview_id, title, started_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    jobId,
    iv ? interviewId : null,
    iv?.name ?? "Call",
    now(),
    now(),
  );
  notify(jobId);
  return id;
}

export const getCall = (id: number) => get<CallSession>("SELECT * FROM call_sessions WHERE id = ?", id);
export const listCalls = (jobId: number) => all<CallSession>("SELECT * FROM call_sessions WHERE job_id = ? ORDER BY started_at DESC", jobId);

export function saveCallNotes(id: number, notes: string) {
  run("UPDATE call_sessions SET notes = ?, updated_at = ? WHERE id = ?", notes, now(), id);
}

export function endCall(id: number) {
  const call = getCall(id);
  if (!call || call.ended_at) return;
  run("UPDATE call_sessions SET ended_at = ?, updated_at = ? WHERE id = ?", now(), now(), id);
  if (call.notes.trim()) {
    recordEvent({ jobId: call.job_id, kind: "call", source: "you", title: `Call notes: ${call.title ?? "Call"}`, body: call.notes.trim().slice(0, 4000) });
  }
  notify(call.job_id);
  // Recorded? Transcribe it on this computer, then Claude reads it.
  if (call.recording_path) void import("./transcribe").then((m) => m.queueTranscription(id));
}

export function setRecording(id: number, file: string) {
  run("UPDATE call_sessions SET recording_path = ?, updated_at = ? WHERE id = ?", file, now(), id);
}

/** Paste a Zoom / Meet transcript; Claude reads it on the next queue run. */
export function addTranscript(id: number, transcript: string) {
  const call = getCall(id);
  if (!call) throw new Error(`No call ${id}`);
  run("UPDATE call_sessions SET transcript = ?, transcript_status = 'pending', updated_at = ? WHERE id = ?", transcript.slice(0, 200_000), now(), id);
  notify(call.job_id);
}

export const pendingTranscriptCount = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM call_sessions WHERE transcript_status = 'pending'")!.n;

export function transcriptGuide(p = getProfile()) {
  const name = firstName(p);
  return `Read this interview / call transcript for the user, ${describeUser(p)}. It may be an automatic transcript with no speaker labels and some mis-heard words: work out who is speaking from context (${name} is the candidate) and correct obvious mis-hearings of names using the role, company and people given.
- summary: the key summary in 3–5 sentences: who ${name} spoke with, how it went (be candid), and what happens next.
- notes: the key points worth keeping, as short bullets: what they said about the role, team, comp, process, product, customers, strategy, and anything ${name} said they'd follow up on.
- them: ${name} assesses every company on team (culture, mindset, strategy), product and growth. For each thing the interviewer said that answers one of ${name}'s questions (your_questions_for_them), give the question exactly as listed and what they said. Add other notable team / product / growth answers with your own short question.
- facts: only comp / ${isSales(p) ? "territory" : "scope"} / team details actually stated (money in thousands). null if not stated.
- stage: only if the call clearly moved things on (e.g. "we'll set up the final round" → "final"; an offer → "offer"; a clear no → "closed"). Otherwise null.
- next_steps: things ${name} must do (send a follow-up, prepare a case study, send references), with due_at if stated.
- people: interviewers or others named, with title and their part in the process.
- next_round_prep: 2–5 things to prepare for the next round, based on the call.
- ratings: suggested 1–5 scores for culture, product, growth (and cash if comp was discussed), each with a one-line reason from the call. Suggestions only; ${name} decides.
- recap_email: a same-day thank-you and recap ${name} can send (draft only): thanks, a concise recap of their priorities as ${name} heard them, how ${name} maps to them, any follow-up promised, and the agreed next step. ${p.voice.trim() ? `Tone: ${p.voice.trim()}.` : "Warm, direct."} Under 180 words.
Only report what was said.`;
}

const Rating = z.object({ rating: z.enum(["culture", "product", "growth", "cash"]), score: z.number().int().min(1).max(5), why: z.string() });

export const TranscriptSchema = z.object({
  summary: z.string(),
  notes: z.array(z.string()),
  them: z
    .array(z.object({ group: z.enum(["team", "product", "growth"]), question: z.string(), answer: z.string() }))
    .optional()
    .default([]),
  facts: ExtractionSchema.shape.facts,
  stage: z.enum(["screening", "interviewing", "final", "offer", "closed"]).nullable().optional(),
  next_steps: z.array(z.object({ title: z.string(), due_at: z.string().nullable() })),
  people: z.array(z.object({ name: z.string(), title: z.string().nullable(), role: z.string().nullable() })),
  next_round_prep: z.array(z.string()),
  ratings: z.array(Rating).optional().default([]),
  recap_email: z.string().optional().default(""),
});

/** What Claude made of a call, and what it changed. Stored on the call for the Calls panel. */
export interface CallSummary {
  summary: string;
  notes: string[];
  them: { group: Pillar; question: string; answer: string }[];
  next_round_prep: string[];
  ratings: z.infer<typeof Rating>[];
  recap_email?: string;
  applied: { fields: string[]; stage: string | null; tasks: string[]; people: string[] };
  suggested: string[];
  read_at: string;
}

export function listTranscriptsToRead(limit: number) {
  const calls = all<CallSession & { company: string; job_title: string; stage: string }>(
    `SELECT s.*, c.name AS company, j.title AS job_title, j.stage FROM call_sessions s
     JOIN jobs j ON j.id = s.job_id JOIN companies c ON c.id = j.company_id
     WHERE s.transcript_status = 'pending' ORDER BY s.updated_at LIMIT ?`,
    limit,
  );
  return {
    remaining: pendingTranscriptCount(),
    guide: transcriptGuide(),
    calls: calls.map((c) => {
      const role = roleForPrep(c.job_id);
      const prep = getPrep(c.job_id);
      return {
        call_id: c.id,
        role_id: c.job_id,
        company: c.company,
        role: c.job_title,
        stage: c.stage,
        call: c.title,
        date: c.started_at,
        people_known: all<{ name: string; title: string | null }>("SELECT name, title FROM contacts WHERE company_id = ?", role?.company_id ?? 0),
        role_known: role
          ? Object.fromEntries((Object.keys(JOB_FIELDS) as JobField[]).map((f) => [f, role[f as keyof Job] ?? null]).filter(([, v]) => v !== null))
          : {},
        your_questions_for_them: (prep?.content.them ?? []).filter((q) => q.kind !== "know").map((q) => ({ group: q.group ?? "team", question: q.title })),
        your_notes: c.notes || null,
        transcript: c.transcript,
      };
    }),
  };
}

const STAGE_ORDER = ["found", "applied", "screening", "interviewing", "final", "offer"];

export function submitTranscriptReading(callId: number, r: z.infer<typeof TranscriptSchema>) {
  const call = getCall(callId);
  if (!call) throw new Error(`No call ${callId}`);
  const jobId = call.job_id;
  const result: CallSummary = {
    summary: r.summary,
    notes: r.notes,
    them: r.them,
    next_round_prep: r.next_round_prep,
    ratings: r.ratings,
    recap_email: r.recap_email || undefined,
    applied: { fields: [], stage: null, tasks: [], people: [] },
    suggested: [],
    read_at: now(),
  };
  tx(() => {
    const job = get<Job>("SELECT * FROM jobs WHERE id = ?", jobId)!;
    const meta = { source: "call" as const, at: call.started_at };

    // Facts: fill empty fields; anything different from what you have is a suggestion in Needs you.
    const fill: Facts = {};
    for (const [field, value] of Object.entries(r.facts)) {
      if (value === null || !isJobField(field)) continue;
      const f = field as JobField;
      const current = job[field as keyof Job] as FieldValue;
      const show = (v: FieldValue) => displayValue(f, v === null ? null : String(v));
      if (current === null || current === "") {
        fill[field] = value;
        result.applied.fields.push(`${JOB_FIELDS[f].label}: ${show(value)}`);
      } else if (String(current).trim().toLowerCase() !== String(value).trim().toLowerCase()) {
        createProposal("conflict", jobId, "call", `${JOB_FIELDS[f].label}: call says ${show(value)}, you have ${show(current)}`, call.title, {
          field,
          value,
          current,
          ref: { subject: `Call: ${call.title ?? ""}` },
        });
        result.suggested.push(`${JOB_FIELDS[f].label}: call says ${show(value)}, you have ${show(current)}`);
      }
    }

    // Stage: forward only (or closed), like emails.
    if (r.stage && r.stage !== job.stage && job.stage !== "closed") {
      const forward = r.stage === "closed" || STAGE_ORDER.indexOf(r.stage) > STAGE_ORDER.indexOf(job.stage);
      if (forward) {
        fill.stage = r.stage;
        fill.stage_detail = null;
        result.applied.stage = r.stage;
      }
    }

    const body = [
      r.summary,
      r.notes.length ? `Key notes:\n${r.notes.map((i) => `• ${i}`).join("\n")}` : "",
      r.next_round_prep.length ? `Prepare for next round:\n${r.next_round_prep.map((i) => `• ${i}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    recordEvent({ jobId, kind: "call", source: "call", occurredAt: call.started_at, title: `Call summary: ${call.title ?? "Call"}`, body, facts: fill });

    const open = all<{ title: string }>("SELECT title FROM tasks WHERE job_id = ? AND done_at IS NULL", jobId).map((t) => t.title.toLowerCase());
    for (const t of r.next_steps) {
      if (open.includes(t.title.toLowerCase())) continue;
      const due = t.due_at && !Number.isNaN(new Date(t.due_at).getTime()) ? new Date(t.due_at).toISOString() : null;
      addTask(jobId, t.title, due, meta);
      result.applied.tasks.push(t.title);
    }
    for (const p of r.people) {
      const exists = get("SELECT id FROM contacts WHERE company_id = ? AND lower(name) = lower(?)", job.company_id, p.name);
      if (!exists) {
        addContact(jobId, { name: p.name, title: p.title, email: null, role: p.role }, meta);
        result.applied.people.push(p.title ? `${p.name} (${p.title})` : p.name);
      }
    }

    // What they said goes onto your Interview them questions.
    if (r.them.length) {
      const prep = getPrep(jobId);
      if (prep) {
        const them = [...prep.content.them];
        for (const a of r.them) {
          const i = them.findIndex((q) => q.kind !== "know" && q.title.trim().toLowerCase() === a.question.trim().toLowerCase());
          const said = `${a.answer} (from the call)`;
          if (i >= 0) them[i] = { ...them[i], done: true, answer: them[i].answer ? `${them[i].answer}\n${said}` : said };
          else them.push({ group: a.group, kind: "ask", title: a.question, done: true, answer: said });
        }
        savePrep(jobId, { ...prep.content, them }, prep.source === "agent" ? "agent" : "you");
      }
    }

    run(
      "UPDATE call_sessions SET transcript_status = 'done', summary = ?, review_status = COALESCE(review_status, 'pending'), updated_at = ? WHERE id = ?",
      JSON.stringify(result),
      now(),
      callId,
    );
  });
  notify(jobId);
  return { conflicts: result.suggested };
}

/** Prep sheets and transcripts waiting for Claude, for the home screen. */
export function listPrepQueue() {
  return all<{ job_id: number | null; label: string; at: string }>(
    `SELECT r.job_id, 'Prep sheet · ' || c.name || ' · ' || j.title AS label, r.created_at AS at FROM prep_requests r
       JOIN jobs j ON j.id = r.job_id JOIN companies c ON c.id = j.company_id WHERE r.status = 'pending'
     UNION ALL
     SELECT s.job_id, 'Interview review · ' || c.name || ' · ' || COALESCE(s.title, 'Call'), s.updated_at FROM call_sessions s
       JOIN jobs j ON j.id = s.job_id JOIN companies c ON c.id = j.company_id WHERE s.review_status = 'pending'
     UNION ALL
     SELECT NULL, 'STAR story · ' || st.title, st.updated_at FROM star_stories st WHERE st.polish_status = 'pending'
     UNION ALL
     SELECT s.job_id, 'Transcript · ' || c.name || ' · ' || COALESCE(s.title, 'Call'), s.updated_at FROM call_sessions s
       JOIN jobs j ON j.id = s.job_id JOIN companies c ON c.id = j.company_id WHERE s.transcript_status = 'pending'
     ORDER BY at`,
  );
}
