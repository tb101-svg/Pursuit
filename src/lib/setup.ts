import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { anthropic, MODEL } from "./ai/client";
import { getSetting, setSetting } from "./db";
import { getResume, saveResume } from "./prep";
import { describeUser, getProfile, saveProfile, type Profile } from "./profile";
import { competencies, listStars, saveStar } from "./star";

/**
 * First-run setup: the user gives Pursuit their resume, Claude turns it into
 * a starting profile, asks a few questions about their story, then drafts
 * their first STAR stories. Everything Claude drafts is editable, and missing
 * facts come back as [add: …] rather than being made up.
 */

export const SETUP_STEPS = ["welcome", "claude", "resume", "profile", "story", "stories", "email"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

const DONE_KEY = "setup.done";
const DRAFT_KEY = "setup.draft";

export interface SetupDraft {
  questions: string[];
  answers: string[];
}

export const isSetupDone = () => !!getSetting<boolean>(DONE_KEY);
export const finishSetup = () => setSetting(DONE_KEY, true);
export const getDraft = (): SetupDraft => getSetting<SetupDraft>(DRAFT_KEY) ?? { questions: [], answers: [] };
const saveDraft = (d: SetupDraft) => setSetting(DRAFT_KEY, d);

// ── Resume → profile ────────────────────────────────────────────────────────

const ResumeReadSchema = z.object({
  resume_text: z.string().describe("The whole resume as clean plain text: every role, date and bullet, in order. Fix spacing only; change no wording."),
  name: z.string().describe("Full name, or empty"),
  headline: z.string().describe("How to describe them in a phrase, e.g. 'an experienced Account Executive' or 'a senior product manager'"),
  location: z.string().describe("City and country if stated, e.g. 'Sydney, Australia', or empty"),
  region: z.string().describe("The market they work in if clear, e.g. 'ANZ', 'EMEA', 'UK', or empty"),
  currency: z.string().describe("Currency symbol for their location, e.g. 'A$', '£', '$', '€'"),
  target_roles: z.string().describe("The roles they'd most likely target next, from their trajectory, e.g. 'Enterprise Account Executive, SaaS'"),
  pack: z.enum(["sales", "general"]).describe("'sales' if they work in a quota-carrying sales role (AE, SDR, account manager, sales leader); otherwise 'general'"),
  career_notes: z
    .string()
    .describe("Neutral notes on what a sceptical hiring manager may probe: gaps, short stints, step-downs, a recent exit. One line each. Empty if none."),
  questions: z
    .array(z.string())
    .describe("3–5 short questions whose answers would make their interview stories stronger: why each move, their proudest wins and the numbers behind them, how they explain anything in career_notes"),
});

export type ResumeRead = z.infer<typeof ResumeReadSchema>;

const RESUME_GUIDE = `You are setting up a job-search assistant for a new user from their resume. Read the resume and fill every field. Only use what the resume says; leave a field empty rather than guess (except headline, currency, target_roles and pack, where a sensible reading of the resume is fine). Ask questions in plain, friendly language, one thing per question.`;

/** Reads a resume (PDF or pasted text), keeps its text, and fills any empty profile fields. */
export async function readResume(input: { pdf: Buffer } | { text: string }): Promise<ResumeRead> {
  const content: BetaContentBlockParam[] =
    "pdf" in input
      ? [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdf.toString("base64") } },
          { type: "text", text: "Here is my resume." },
        ]
      : [{ type: "text", text: `Here is my resume:\n\n${input.text}` }];

  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ResumeReadSchema) },
    system: RESUME_GUIDE,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude couldn't read that resume. Try pasting the text instead.");
  if (response.stop_reason === "max_tokens") throw new Error("The resume was too long to read in one go. Try pasting a shorter version.");
  const read = response.parsed_output;
  if (!read) throw new Error("Claude didn't return a result. Try again.");

  saveResume("text" in input ? input.text : read.resume_text, null);

  // Fill gaps only: anything the user already typed stays.
  const current = getProfile();
  const guess: Partial<Profile> = {
    name: read.name,
    headline: read.headline,
    location: read.location,
    region: read.region,
    targetRoles: read.target_roles,
    careerNotes: read.career_notes,
  };
  const fill: Partial<Profile> = {};
  for (const [k, v] of Object.entries(guess) as [keyof Profile, string][]) {
    if (v?.trim() && !String(current[k] ?? "").trim()) (fill as Record<string, string>)[k] = v.trim();
  }
  if (current.currency === "$" && read.currency.trim()) fill.currency = read.currency.trim();
  if (!getSetting(DONE_KEY)) fill.pack = read.pack;
  saveProfile(fill);
  saveDraft({ questions: read.questions, answers: [] });
  return read;
}

// ── Story questions → STAR drafts ───────────────────────────────────────────

const DraftStoriesSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().describe("Short name, e.g. 'Largest new-logo deal, FY24'"),
      competencies: z.array(z.string()),
      situation: z.string(),
      task: z.string(),
      action: z.string().describe("3–4 concrete first-person steps ('I…') with the why behind each"),
      result: z.string().describe("Lead with the number, then the business impact"),
      lesson: z.string(),
    }),
  ),
});

/** Drafts 5–8 STAR stories from the resume and the user's answers, and adds them to the library. */
export async function draftStories(answers: string[]): Promise<number> {
  const draft = getDraft();
  saveDraft({ ...draft, answers });
  const resume = getResume().text;
  if (!resume.trim()) throw new Error("Add your resume first.");
  const p = getProfile();
  const qa = draft.questions.map((q, i) => `Q: ${q}\nA: ${answers[i]?.trim() || "(no answer)"}`).join("\n\n");

  const system = `Draft the first STAR interview stories for ${describeUser(p)}, from their resume and their answers below.
- 5–8 stories, each a distinct, real example from the resume or answers. Cover different strengths.
- Keep every fact, number and name exactly as given. NEVER invent customers, numbers, actions or outcomes. Where a detail is missing, write [add: …] saying what's needed.
- First person. Action is the heart: what they personally did.
- competencies: tag each story with what it proves, from this list: ${competencies(p).join(", ")}.`;

  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(DraftStoriesSchema) },
    system,
    messages: [{ role: "user", content: `RESUME\n${resume}\n\nMY ANSWERS\n${qa || "(none)"}${p.careerNotes.trim() ? `\n\nCAREER NOTES\n${p.careerNotes}` : ""}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude couldn't draft stories from this. Add them yourself in the Prep library.");
  if (response.stop_reason === "max_tokens") throw new Error("The stories were cut off. Try again.");
  const stories = response.parsed_output?.stories ?? [];

  // Running setup twice shouldn't double the library.
  const existing = new Set(listStars().map((s) => s.title.toLowerCase()));
  let added = 0;
  for (const s of stories) {
    if (existing.has(s.title.toLowerCase())) continue;
    saveStar(s);
    added++;
  }
  return added;
}
