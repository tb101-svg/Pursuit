import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { describeUser, getProfile, isSales } from "../profile";
import { anthropic, MODEL } from "./client";

/**
 * Reads one email and returns what it means for the job search, as structured
 * data the sync can apply. Only facts stated in the email are returned.
 */

export { isAiConfigured } from "./client";

const StageEnum = z.enum(["found", "applied", "screening", "interviewing", "final", "offer", "closed"]);

export const ExtractionSchema = z.object({
  relevant: z
    .boolean()
    .describe("True only if this email is about the user's own job search: an application, interview process, recruiter outreach, offer or rejection."),
  kind: z.enum([
    "interview_invite",
    "interview_reschedule",
    "interview_cancel",
    "rejection",
    "offer",
    "recruiter_outreach",
    "application_confirmation",
    "update",
    "other",
  ]),
  job_match: z.object({
    job_id: z.number().int().nullable().describe("id from KNOWN ROLES if this email is clearly about that role, else null"),
    confidence: z.enum(["high", "medium", "low"]),
    company_name: z.string().nullable().describe("Hiring company (not the recruiting agency or ATS vendor)"),
    role_title: z.string().nullable(),
  }),
  summary: z.string().describe("One or two plain sentences for the role's timeline: what happened and what it means."),
  stage: StageEnum.nullable().describe("The stage this email moves the role to, only if it clearly does (e.g. rejection -> closed, offer -> offer)"),
  closed_reason: z.string().nullable(),
  facts: z.object({
    base_k: z.number().nullable().describe("Base salary in thousands, local currency"),
    variable_k: z.number().nullable().describe("Variable/commission at target in thousands"),
    quota_k: z.number().nullable().describe("Annual quota in thousands"),
    equity: z.string().nullable(),
    acv: z.string().nullable().describe("Typical deal size"),
    sales_cycle: z.string().nullable(),
    segment: z.string().nullable(),
    territory: z.string().nullable(),
    team_size: z.string().nullable(),
    ramp: z.string().nullable(),
    attainment: z.string().nullable().describe("How much of the team hit quota"),
    location: z.string().nullable(),
  }),
  interview: z
    .object({
      action: z.enum(["schedule", "reschedule", "cancel"]),
      name: z.string().describe("Short round name, e.g. 'Hiring manager interview', 'Panel'"),
      starts_at: z.string().nullable().describe("ISO 8601 with timezone offset, only if a specific time is confirmed"),
      duration_min: z.number().int().nullable(),
      format: z.string().nullable(),
      attendees: z.string().nullable().describe("Interviewer names, comma separated"),
    })
    .nullable(),
  next_step: z
    .object({
      title: z.string().describe("What the user needs to do, as a short imperative, e.g. 'Reply to Priya with availability'"),
      due_at: z.string().nullable().describe("ISO 8601 if a deadline is stated"),
    })
    .nullable(),
  contact: z
    .object({
      name: z.string(),
      email: z.string().nullable(),
      title: z.string().nullable(),
      role: z.string().nullable().describe("Their part in the process: Recruiter, Hiring manager, Interviewer…"),
    })
    .nullable()
    .describe("The person who wrote the email, if a real person at or recruiting for the company"),
  insights: z.array(z.string()).describe("Short observations useful for interview prep: what they care about, concerns, urgency. Empty if none."),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export interface KnownRole {
  id: number;
  company: string;
  title: string;
  stage: string;
  domain: string | null;
  contacts: string[];
}

export interface EmailInput {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
  truncated: boolean;
  threadRoleId: number | null;
}

// Only changes when the profile does, so the prompt prefix can be cached across emails.
export function analysisGuide(p = getProfile()) {
  const comp = isSales(p) ? ` "OTE 300k 50/50" means base 150 and variable 150.` : ` A bonus or commission is variable; report base and variable separately.`;
  return `You read emails for ${describeUser(p)}. For each email, decide whether it is about their own job search and, if so, extract what it means for their records.

Rules:
- Only report facts the email actually states. Never guess comp, dates or names. Use null when unsure.
- Money: amounts in thousands of the stated currency (${p.currency}150,000 -> 150).${comp}
- Match to a KNOWN ROLE only when the company clearly matches; set confidence "high" only when you are sure. If the email's thread is already linked to a role, that role is the match unless the email is clearly about something else.
- Newsletters, marketing, job-board digests and automated job alerts are not relevant (relevant=false).
- An application confirmation moves the stage to "applied". A first recruiter call invite moves it to "screening". Later interview rounds move it to "interviewing"; a clearly final round to "final". A rejection moves it to "closed" with a short reason. An offer moves it to "offer". Otherwise stage is null.
- Interview times: return starts_at only for a confirmed time, with the timezone offset. If they ask for availability, that is a next_step, not an interview.
- next_step is what the user must do (reply, send availability, complete a task), not what the company will do.`;
}

export async function extractEmail(email: EmailInput, roles: KnownRole[], now = new Date()): Promise<Extraction> {
  const rolesText =
    roles.length === 0
      ? "(none yet)"
      : roles
          .map(
            (r) =>
              `- id ${r.id}: ${r.company} — ${r.title} (stage: ${r.stage}${r.domain ? `, domain: ${r.domain}` : ""}${
                r.contacts.length ? `, contacts: ${r.contacts.join(", ")}` : ""
              })`,
          )
          .join("\n");

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const user = `Today: ${now.toISOString()} (user's timezone: ${tz})

KNOWN ROLES
${rolesText}

EMAIL${email.threadRoleId ? ` (thread already linked to role id ${email.threadRoleId})` : ""}
From: ${email.from}
To: ${email.to}${email.cc ? `\nCc: ${email.cc}` : ""}
Date: ${email.date}
Subject: ${email.subject}

${email.body}${email.truncated ? "\n\n[Email body was very long and has been cut here.]" : ""}`;

  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionSchema) },
    system: [{ type: "text", text: analysisGuide(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Email analysis was declined (${response.stop_details?.category ?? "no category"})`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Email analysis was cut off (max_tokens)");
  if (!response.parsed_output) throw new Error("Email analysis returned no structured result");
  return response.parsed_output;
}
