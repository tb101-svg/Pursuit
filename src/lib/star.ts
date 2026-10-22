import "server-only";
import fs from "node:fs";
import { z } from "zod";
import { all, get, getSetting, run, setSetting, tx } from "./db";
import { notify } from "./bus";
import { dataPath } from "./paths";
import { describeUser, firstName, getProfile, isSales } from "./profile";

/**
 * Your STAR stories: real examples broken into Situation, Task, Action and
 * Result, tagged with what they prove. Practice answers for every role are
 * built from these. Claude can polish a story into a tight spoken answer, but
 * only from what you've written: missing details come back as questions.
 */

export interface StarStory {
  id: number;
  title: string;
  competencies: string[];
  situation: string;
  task: string;
  action: string;
  result: string;
  lesson: string;
  /** Claude's polished ~90-second spoken version. */
  spoken: string | null;
  /** Details that would make the story stronger (questions for you). */
  gaps: string[];
  polish_status: "pending" | "done" | null;
  /** Claude polished it and the earlier version is kept. */
  can_undo: boolean;
  updated_at: string;
}

/** What interviewers test for in behavioural questions; used as tags. */
export const COMPETENCIES = [
  "Self-generated pipeline",
  "Large / complex deal",
  "Multi-stakeholder selling",
  "Competitive win",
  "Lost deal / failure",
  "Resilience / setback",
  "Fast ramp / adaptability",
  "AI / innovation",
  "Forecasting / pipeline discipline",
  "Influence without authority",
  "Customer focus / expansion",
  "Team player / helping others",
] as const;

/** The same idea for non-sales roles. */
export const GENERAL_COMPETENCIES = [
  "Delivered a big result",
  "Led without authority",
  "Handled conflict",
  "Failure / what I learned",
  "Resilience / setback",
  "Fast ramp / adaptability",
  "AI / innovation",
  "Prioritisation under pressure",
  "Data-driven decision",
  "Stakeholder management",
  "Customer focus",
  "Team player / helping others",
] as const;

/** The tags for the user's kind of role. */
export const competencies = (p = getProfile()): readonly string[] => (isSales(p) ? COMPETENCIES : GENERAL_COMPETENCIES);

const now = () => new Date().toISOString();
const SEED_FILE = dataPath("prep-seed.json");

type Row = Omit<StarStory, "competencies" | "gaps" | "can_undo"> & { competencies: string; gaps: string; previous: string | null };
const toStory = ({ previous, ...r }: Row): StarStory => ({
  ...r,
  competencies: JSON.parse(r.competencies || "[]"),
  gaps: JSON.parse(r.gaps || "[]"),
  can_undo: !!previous,
});

/** First use: load starting stories from data/prep-seed.json ("star"), if present. */
function ensureSeeded() {
  if (getSetting<boolean>("prep.seeded.star")) return;
  setSetting("prep.seeded.star", true);
  if (!fs.existsSync(SEED_FILE)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as { star?: Partial<StarStory>[] };
    tx(() => (seed.star ?? []).forEach((s, i) => insert(s, i)));
  } catch {
    // a broken seed just means an empty library
  }
}

function insert(s: Partial<StarStory>, position: number) {
  return run(
    `INSERT INTO star_stories (title, competencies, situation, task, action, result, lesson, gaps, position, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.title ?? "Untitled story",
    JSON.stringify(s.competencies ?? []),
    s.situation ?? "",
    s.task ?? "",
    s.action ?? "",
    s.result ?? "",
    s.lesson ?? "",
    JSON.stringify(s.gaps ?? []),
    position,
    now(),
  );
}

export function listStars(): StarStory[] {
  ensureSeeded();
  return all<Row>("SELECT * FROM star_stories ORDER BY position, id").map((r) => toStory({ ...r }));
}

export function saveStar(s: Pick<StarStory, "title" | "competencies" | "situation" | "task" | "action" | "result" | "lesson"> & { id?: number }) {
  if (s.id) {
    run(
      `UPDATE star_stories SET title = ?, competencies = ?, situation = ?, task = ?, action = ?, result = ?, lesson = ?, updated_at = ? WHERE id = ?`,
      s.title,
      JSON.stringify(s.competencies),
      s.situation,
      s.task,
      s.action,
      s.result,
      s.lesson,
      now(),
      s.id,
    );
    return s.id;
  }
  const pos = get<{ p: number | null }>("SELECT MAX(position) AS p FROM star_stories")!.p ?? -1;
  return insert(s, pos + 1);
}

export function deleteStar(id: number) {
  run("DELETE FROM star_stories WHERE id = ?", id);
}

// ── Claude polishes stories ─────────────────────────────────────────────────

export function queueStarPolish(id: number | "all") {
  if (id === "all") run("UPDATE star_stories SET polish_status = 'pending'");
  else run("UPDATE star_stories SET polish_status = 'pending' WHERE id = ?", id);
  notify(null);
}

export const pendingStarCount = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM star_stories WHERE polish_status = 'pending'")!.n;

export function starGuide(p = getProfile()) {
  const name = firstName(p);
  return `Polish the user's STAR interview stories (the user is ${describeUser(p)}). For each story:
- situation / task / action / result: tighten into clear, specific, first-person notes. Keep every fact, number and name exactly as given. NEVER invent customers, numbers, actions or outcomes. Where something is missing, keep a [add: ...] placeholder in place.
- action is the heart: 3–4 concrete steps ${name} personally took ("I…"), with the why behind each.
- result: lead with the number (${isSales(p) ? "ARR, %, rank, time saved" : "%, money, time saved, scale"}), then the business impact, then what ${name} learned.
- spoken: a best-in-class spoken answer of 60–90 seconds (about 150–220 words), natural and confident, following S→T→A→R with a one-line "so what" at the end that can be tailored to any company.
- gaps: 2–4 short questions for ${name} whose answers would make the story stronger (e.g. "How many stakeholders signed off, and which roles?"). Empty if the story is complete.
- competencies: keep the user's tags; add any the story clearly proves, from this list: ${competencies(p).join(", ")}.`;
}

export const PolishSchema = z.object({
  title: z.string(),
  competencies: z.array(z.string()),
  situation: z.string(),
  task: z.string(),
  action: z.string(),
  result: z.string(),
  lesson: z.string().optional().default(""),
  spoken: z.string(),
  gaps: z.array(z.string()),
});

export function listStarsToPolish(limit: number) {
  return {
    remaining: pendingStarCount(),
    guide: starGuide(),
    stories: all<Row>("SELECT * FROM star_stories WHERE polish_status = 'pending' ORDER BY position, id LIMIT ?", limit)
      .map((r) => toStory({ ...r }))
      .map((s) => ({
        story_id: s.id,
        title: s.title,
        competencies: s.competencies,
        situation: s.situation,
        task: s.task,
        action: s.action,
        result: s.result,
        lesson: s.lesson,
      })),
  };
}

export function submitStarPolish(id: number, p: z.infer<typeof PolishSchema>) {
  const before = get<Row>("SELECT * FROM star_stories WHERE id = ?", id);
  if (!before) throw new Error(`No story ${id}`);
  run(
    `UPDATE star_stories SET title = ?, competencies = ?, situation = ?, task = ?, action = ?, result = ?, lesson = ?, spoken = ?, gaps = ?,
       polish_status = 'done', previous = ?, updated_at = ? WHERE id = ?`,
    p.title,
    JSON.stringify(p.competencies),
    p.situation,
    p.task,
    p.action,
    p.result,
    p.lesson,
    p.spoken,
    JSON.stringify(p.gaps),
    JSON.stringify({ ...before }),
    now(),
    id,
  );
  notify(null);
}

/** Put a story back the way it was before Claude polished it. */
export function undoStarPolish(id: number) {
  const row = get<{ previous: string | null }>("SELECT previous FROM star_stories WHERE id = ?", id);
  if (!row?.previous) return;
  const p = JSON.parse(row.previous) as Row;
  run(
    `UPDATE star_stories SET title = ?, competencies = ?, situation = ?, task = ?, action = ?, result = ?, lesson = ?, spoken = ?, gaps = ?,
       polish_status = NULL, previous = NULL, updated_at = ? WHERE id = ?`,
    p.title,
    p.competencies,
    p.situation,
    p.task,
    p.action,
    p.result,
    p.lesson,
    p.spoken,
    p.gaps,
    now(),
    id,
  );
  notify(null);
}

/** Compact form for Claude when drafting a role's practice questions. */
export const starsForDrafting = () =>
  listStars().map((s) => ({
    story: s.title,
    proves: s.competencies,
    situation: s.situation,
    task: s.task,
    action: s.action,
    result: s.result,
    lesson: s.lesson || undefined,
    polished_answer: s.spoken || undefined,
  }));
