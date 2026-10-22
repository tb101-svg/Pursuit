import "server-only";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analysisGuide, ExtractionSchema } from "../ai/extract";
import { getProfile, rolesPhrase } from "../profile";
import { get, getSetting, run, setSetting } from "../db";
import { addNote, addTask, createJob, setStage, updateJob } from "../engine";
import { money, ote, relTime } from "../format";
import { completeQueued, dismissQueued, knownRoles, listPending, pendingCount, threadRole } from "../mail/pipeline";
import { fieldProvenance, getCompany, getRole, listContacts, listEvents, listInterviews, listRoles, listTasks } from "../repo";
import { listOpenProposals } from "../sync/apply";
import { listResearch, pendingResearchCount, queueResearch, researchGuide, ResearchSchema, submitResearch } from "../research";
import { JOB_FIELDS, SOURCE_LABEL, STAGES, type Facts, type JobField, type Stage } from "../types";
import { nextStep, stageSub } from "../view";
import { listCallsToReview, pendingReviewCount, ReviewSchema, submitReview } from "../review";
import { listStarsToPolish, pendingStarCount, PolishSchema, submitStarPolish } from "../star";
import { listPrepsToDraft, listTranscriptsToRead, pendingPrepCount, pendingTranscriptCount, PrepSchema, queuePrep, submitPrep, submitTranscriptReading, TranscriptSchema } from "../prep";

/**
 * Pursuit's MCP server: lets Claude (on your subscription, e.g. in Claude
 * Code) read your roles, work through the "To read" email queue, and record
 * updates. Every write goes through the same event engine as the app, is
 * labelled "Claude" in the history, and can be undone from Changes.
 */

const TOKEN_KEY = "mcp.token";

/** Secret the MCP client must send; created on first use. */
export function mcpToken(): string {
  let token = getSetting<string>(TOKEN_KEY);
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    setSetting(TOKEN_KEY, token);
  }
  return token;
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

function roleSummary(id: number) {
  const r = getRole(id);
  if (!r) return null;
  const n = nextStep(r);
  return {
    id: r.id,
    company: r.company_name,
    title: r.title,
    stage: r.stage,
    stage_detail: stageSub(r) || null,
    ote: money(ote(r.base_k, r.variable_k)),
    quota: money(r.quota_k),
    rank: r.rank,
    fit: r.fit,
    next_step: n.kind ? n.text : null,
    updated: relTime(r.updated_at),
  };
}

const factsShape = z
  .object(Object.fromEntries((Object.keys(JOB_FIELDS) as JobField[]).filter((f) => f !== "stage").map((f) => [f, (JOB_FIELDS[f].type === "number" ? z.number() : z.string()).nullable().optional()])))
  .describe("Fields to set. Money in thousands (base_k 150 = 150,000 in the local currency).");

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "pursuit", version: "0.4.0" },
    {
      instructions: `Pursuit is the user's job-search tracker (${rolesPhrase()}${getProfile().location.trim() ? `, ${getProfile().location.trim()}` : ""}). When asked to "process my Pursuit queue" (or similar):
1. Call list_emails_to_read and, for each email, call submit_email_reading (or dismiss_email if it isn't about the job search). Repeat until none remain.
2. Call list_roles_to_research and, for each role, research it (web fetch the links, web search the company) and call submit_role_research. Repeat until none remain.
3. Call list_transcripts_to_read and, for each call, call submit_transcript_reading. Repeat until none remain. Then call list_calls_to_review and, for each interview, call submit_call_review (or skip_call_review if it wasn't an interview). Repeat until none remain.
4. Call list_preps_to_draft and, for each role, research it and call submit_prep with a tailored interview prep sheet. Repeat until none remain.
5. Call list_stories_to_polish and, for each story, call submit_story_polish. Repeat until none remain.
6. Finish with a short summary: what changed, anything waiting in "Needs you", and next steps due soon.
Only report facts you found. Pursuit fills gaps itself and routes conflicts to the user, so never overwrite details the user entered unless asked (then use update_role).`,
    },
  );

  server.registerTool(
    "list_roles",
    { description: "List every role in Pursuit with stage, comp, rank and next step.", inputSchema: { include_closed: z.boolean().optional() } },
    async ({ include_closed }) => {
      const roles = listRoles().filter((r) => include_closed || r.stage !== "closed");
      return text({ roles: roles.map((r) => roleSummary(r.id)), to_read: pendingCount(), to_research: pendingResearchCount(), transcripts_to_read: pendingTranscriptCount(), preps_to_draft: pendingPrepCount(), needs_you: listOpenProposals().length });
    },
  );

  server.registerTool(
    "get_role",
    { description: "Everything about one role: details with sources, interviews, next steps, people and recent history.", inputSchema: { role_id: z.number().int() } },
    async ({ role_id }) => {
      const r = getRole(role_id);
      if (!r) return fail(`No role ${role_id}`);
      const prov = fieldProvenance(role_id);
      const details = Object.fromEntries(
        (Object.keys(JOB_FIELDS) as JobField[]).map((f) => {
          const v = r[f as keyof typeof r];
          const p = prov[f];
          return [f, { value: v ?? null, source: p ? `${SOURCE_LABEL[p.source]}, ${relTime(p.occurred_at)}` : null }];
        }),
      );
      return text({
        summary: roleSummary(role_id),
        company: getCompany(r.company_id),
        details,
        interviews: listInterviews(role_id),
        next_steps: listTasks(role_id).filter((t) => !t.done_at),
        people: listContacts(role_id),
        notes: r.notes,
        history: listEvents(role_id, 25).map((e) => ({ when: e.occurred_at, source: e.source, title: e.title, body: e.body })),
      });
    },
  );

  server.registerTool(
    "list_emails_to_read",
    {
      description:
        "Job-related emails waiting to be read, oldest first, with the reading guide and the known roles to match against. Read each one, then call submit_email_reading (or dismiss_email if it isn't about the job search).",
      inputSchema: { limit: z.number().int().min(1).max(20).optional() },
    },
    async ({ limit }) => {
      const items = listPending(limit ?? 5);
      return text({
        remaining: pendingCount(),
        guide: analysisGuide(),
        today: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        known_roles: knownRoles(),
        emails: items.map((i) => ({
          email_id: i.message_id,
          mailbox: i.provider,
          thread_linked_to_role: threadRole(i.thread_id),
          from: i.from_addr,
          to: i.to_addr,
          cc: i.cc_addr,
          date: i.received_at,
          subject: i.subject,
          body: i.body + (i.truncated ? "\n\n[Email body was very long and has been cut here.]" : ""),
        })),
      });
    },
  );

  server.registerTool(
    "submit_email_reading",
    {
      description:
        "Record your reading of one queued email. Pursuit applies it: fills empty fields, moves the stage forward, adds interviews, next steps and the sender as a contact, and sends conflicts or uncertain role matches to the user's 'Needs you' list.",
      inputSchema: { email_id: z.string(), reading: ExtractionSchema },
    },
    async ({ email_id, reading }) => {
      try {
        const outcome = completeQueued(email_id, reading);
        const msg = {
          applied: "Applied to the role.",
          proposed: "Couldn't be tied to a role with confidence, so it's waiting in Needs you for the user.",
          irrelevant: "Marked as not job-related.",
        }[outcome];
        return text(`${msg} ${pendingCount()} emails left to read.`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "dismiss_email",
    { description: "Mark a queued email as not about the job search. Later emails in its thread are skipped too.", inputSchema: { email_id: z.string() } },
    async ({ email_id }) => {
      dismissQueued(email_id);
      return text(`Dismissed. ${pendingCount()} emails left to read.`);
    },
  );

  server.registerTool(
    "list_roles_to_research",
    {
      description:
        "Roles the user added with Quick add that are waiting for research, with the job ad text, links and what's already known. Research each (fetch the links, search the web), then call submit_role_research.",
      inputSchema: { limit: z.number().int().min(1).max(10).optional() },
    },
    async ({ limit }) => text({ remaining: pendingResearchCount(), guide: researchGuide(), roles: listResearch(limit ?? 3) }),
  );

  server.registerTool(
    "submit_role_research",
    {
      description:
        "Record research for a role. Pursuit fills empty company and role details, fixes placeholder names, logs highlights, flags and sources in the timeline, and sends anything that contradicts existing details to the user's 'Needs you' list. Works for any role, queued or not.",
      inputSchema: { role_id: z.number().int(), research: ResearchSchema },
    },
    async ({ role_id, research }) => {
      try {
        const out = submitResearch(role_id, research);
        const c = get<{ company_id: number }>("SELECT company_id FROM jobs WHERE id = ?", role_id);
        if (c) void import("../logos").then((m) => m.refreshCompanyLogo(c.company_id)).catch(() => {});
        return text(
          `Saved. Filled: ${out.filled.join(", ") || "nothing new"}.${out.conflicts.length ? ` Sent to Needs you (conflicts): ${out.conflicts.join(", ")}.` : ""} ${pendingResearchCount()} roles left to research.`,
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "queue_role_research",
    { description: "Queue an existing role for research (e.g. when the user asks you to look into one).", inputSchema: { role_id: z.number().int() } },
    async ({ role_id }) => {
      if (!get("SELECT id FROM jobs WHERE id = ?", role_id)) return fail(`No role ${role_id}`);
      queueResearch(role_id, {});
      return text("Queued. Call list_roles_to_research to get it.");
    },
  );

  server.registerTool(
    "list_transcripts_to_read",
    {
      description: "Call transcripts (Zoom / Meet) the user added after an interview, with their own call notes. Read each, then call submit_transcript_reading.",
      inputSchema: { limit: z.number().int().min(1).max(5).optional() },
    },
    async ({ limit }) => text(listTranscriptsToRead(limit ?? 2)),
  );

  server.registerTool(
    "submit_transcript_reading",
    {
      description:
        "Record your reading of a call transcript. Pursuit logs the summary and insights in the role's timeline, fills empty details, adds next steps and people, and sends conflicting details to 'Needs you'.",
      inputSchema: { call_id: z.number().int(), reading: TranscriptSchema },
    },
    async ({ call_id, reading }) => {
      try {
        const out = submitTranscriptReading(call_id, reading);
        return text(`Saved.${out.conflicts.length ? ` Sent to Needs you: ${out.conflicts.join(", ")}.` : ""} ${pendingTranscriptCount()} transcripts left.`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "list_stories_to_polish",
    {
      description: "The user's STAR interview stories waiting to be polished into tight spoken answers. Polish each (never invent facts), then call submit_story_polish.",
      inputSchema: { limit: z.number().int().min(1).max(10).optional() },
    },
    async ({ limit }) => text(listStarsToPolish(limit ?? 5)),
  );

  server.registerTool(
    "submit_story_polish",
    {
      description: "Save a polished STAR story: tightened situation/task/action/result, a 60–90 second spoken answer, and questions for the user about missing details. The user can undo it.",
      inputSchema: { story_id: z.number().int(), story: PolishSchema },
    },
    async ({ story_id, story }) => {
      try {
        submitStarPolish(story_id, story);
        return text(`Saved. ${pendingStarCount()} stories left to polish.`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "list_calls_to_review",
    {
      description:
        "Interviews waiting for a review: the transcript plus what good looked like for this role (prep sheet, model answers, STAR stories, questions to ask, the close) and earlier reviews. Score it candidly, then call submit_call_review.",
      inputSchema: { limit: z.number().int().min(1).max(3).optional() },
    },
    async ({ limit }) => text(listCallsToReview(limit ?? 1)),
  );

  server.registerTool(
    "submit_call_review",
    {
      description:
        "Save an interview review: overall 0–100, section scores with evidence, what good looked like and a better answer, strengths, top improvements, and questions to practise (added to the role's practice list as 'Needs work').",
      inputSchema: { call_id: z.number().int(), review: ReviewSchema },
    },
    async ({ call_id, review }) => {
      try {
        const out = submitReview(call_id, review);
        return text(`Saved. Added ${out.added} questions to practice. ${pendingReviewCount()} reviews left.`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "skip_call_review",
    { description: "Skip reviewing a call that wasn't an interview (e.g. a recruiter logistics chat).", inputSchema: { call_id: z.number().int() } },
    async ({ call_id }) => {
      run("UPDATE call_sessions SET review_status = 'skipped' WHERE id = ?", call_id);
      return text(`Skipped. ${pendingReviewCount()} reviews left.`);
    },
  );

  server.registerTool(
    "list_preps_to_draft",
    {
      description:
        "Roles the user wants an interview prep sheet for, with the job ad, what's known, their standard answers, story bank, checklist and resume. Research each role, then call submit_prep.",
      inputSchema: { limit: z.number().int().min(1).max(3).optional() },
    },
    async ({ limit }) => text(listPrepsToDraft(limit ?? 1)),
  );

  server.registerTool(
    "submit_prep",
    {
      description: "Save a tailored interview prep sheet for a role (replaces the current sheet; the user's ticks are kept).",
      inputSchema: { role_id: z.number().int(), prep: PrepSchema },
    },
    async ({ role_id, prep }) => {
      try {
        submitPrep(role_id, prep);
        return text(`Saved. ${pendingPrepCount()} prep sheets left to draft.`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "queue_prep",
    { description: "Queue a role for an interview prep sheet (e.g. when the user asks you to prep them).", inputSchema: { role_id: z.number().int(), focus: z.string().optional() } },
    async ({ role_id, focus }) => {
      if (!get("SELECT id FROM jobs WHERE id = ?", role_id)) return fail(`No role ${role_id}`);
      queuePrep(role_id, focus ?? null);
      return text("Queued. Call list_preps_to_draft to get it.");
    },
  );

  server.registerTool(
    "add_note",
    { description: "Add a note to a role's timeline.", inputSchema: { role_id: z.number().int(), text: z.string() } },
    async ({ role_id, text: note }) => {
      if (!get("SELECT id FROM jobs WHERE id = ?", role_id)) return fail(`No role ${role_id}`);
      addNote(role_id, note, { source: "agent" });
      return text("Note added.");
    },
  );

  server.registerTool(
    "add_next_step",
    {
      description: "Add a next step to a role. kind 'call' for a booked call (shown in the user's Upcoming list); for interviews, the calendar or the user adds them.",
      inputSchema: {
        role_id: z.number().int(),
        title: z.string(),
        due_at: z.string().optional().describe("ISO 8601 with timezone"),
        kind: z.enum(["task", "call"]).optional(),
      },
    },
    async ({ role_id, title, due_at, kind }) => {
      if (!get("SELECT id FROM jobs WHERE id = ?", role_id)) return fail(`No role ${role_id}`);
      const due = due_at && !Number.isNaN(new Date(due_at).getTime()) ? new Date(due_at).toISOString() : null;
      addTask(role_id, title, due, { source: "agent" }, kind ?? "task");
      return text("Next step added.");
    },
  );

  server.registerTool(
    "update_role",
    {
      description: "Set details on a role (overwrites current values; each change is logged and undoable). Use for facts the user tells you.",
      inputSchema: { role_id: z.number().int(), fields: factsShape, reason: z.string().optional() },
    },
    async ({ role_id, fields, reason }) => {
      if (!get("SELECT id FROM jobs WHERE id = ?", role_id)) return fail(`No role ${role_id}`);
      updateJob(role_id, fields as Facts, { source: "agent" }, reason ?? "Updated by Claude");
      return text({ updated: roleSummary(role_id) });
    },
  );

  server.registerTool(
    "set_stage",
    {
      description: "Move a role to a stage.",
      inputSchema: { role_id: z.number().int(), stage: z.enum([...STAGES, "no_reply", "later", "closed"]).describe("'no_reply' = applied but never heard back; 'later' = try later (no suitable role open, or role filled)"), reason: z.string().optional() },
    },
    async ({ role_id, stage, reason }) => {
      if (!get("SELECT id FROM jobs WHERE id = ?", role_id)) return fail(`No role ${role_id}`);
      setStage(role_id, stage as Stage, { source: "agent" }, reason);
      return text({ updated: roleSummary(role_id) });
    },
  );

  server.registerTool(
    "create_role",
    {
      description: "Add a new role.",
      inputSchema: {
        company: z.string(),
        title: z.string(),
        company_website: z.string().optional().describe("Domain, e.g. cortexa.com"),
        stage: z.enum(STAGES).optional(),
        fields: factsShape.optional(),
        note: z.string().optional(),
      },
    },
    async ({ company, title, company_website, stage, fields, note }) => {
      const id = createJob({
        company: { name: company, domain: company_website?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ?? null },
        title,
        facts: { ...(fields as Facts | undefined), ...(stage ? { stage } : {}) },
        source: "agent",
        note,
      });
      return text({ created: roleSummary(id) });
    },
  );

  return server;
}
