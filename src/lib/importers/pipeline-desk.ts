import "server-only";
import { z } from "zod";
import { get, tx } from "../db";
import { notify } from "../bus";
import { addContact, addNote, addTask, createJob, saveNotes, setStage, updateJob, type Meta } from "../engine";
import type { Facts, Stage } from "../types";

/**
 * Imports a Pipeline Desk backup (the JSON its Backup button downloads, or its
 * data/jobs.json). Every role, note, person and next step keeps its original
 * date and is logged with "Pipeline Desk" as the source. Roles already in
 * Pursuit (same company and title) are skipped, so running it twice is safe.
 */

const Job = z.object({
  company: z.string().default(""),
  role: z.string().default(""),
  stage: z.string().default("tba"),
  headline: z.string().optional().default(""),
  website: z.string().optional().default(""),
  location: z.string().optional().default(""),
  workModel: z.string().optional().default(""),
  rating: z.number().optional().default(0),
  scores: z.object({ company: z.number(), vision: z.number(), leadership: z.number() }).partial().optional(),
  applied: z.string().optional().default(""),
  nextAction: z.string().optional().default(""),
  nextActionLabel: z.string().optional().default(""),
  ote: z.string().optional().default(""),
  teamSize: z.string().optional().default(""),
  category: z.string().optional().default(""),
  funding: z.string().optional().default(""),
  repvue: z.string().optional().default(""),
  jobUrl: z.string().optional().default(""),
  sourceUrl: z.string().optional().default(""),
  flag: z.boolean().optional().default(false),
  flagNote: z.string().optional().default(""),
  about: z.string().optional().default(""),
  people: z.array(z.object({ name: z.string(), role: z.string().optional().default("") })).optional().default([]),
  preps: z.array(z.object({ round: z.number().optional(), title: z.string().optional().default(""), body: z.string().optional().default("") })).optional().default([]),
  notes: z.array(z.object({ kind: z.string().optional().default(""), date: z.string().optional().default(""), body: z.string().default("") })).optional().default([]),
});

const Backup = z.object({ updatedAt: z.string().optional(), jobs: z.array(Job) });
type DeskJob = z.infer<typeof Job>;

const STAGE: Record<string, { stage: Stage; detail?: string }> = {
  tba: { stage: "found" },
  applied: { stage: "applied" },
  s1: { stage: "screening" }, // shown as "1st stage"
  s2: { stage: "interviewing", detail: "2nd stage" },
  s3: { stage: "interviewing", detail: "3rd stage" },
  offer: { stage: "offer" },
  closed: { stage: "closed" },
};

const NOTE_KIND: Record<string, string> = { call: "Call note", prep: "Prep", admin: "Admin", gut: "Gut check" };

/** A date-only value ("2026-08-18") as 9am local that day. */
function day(value: string, hour = 9): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, 0, 0).toISOString();
}

function domain(website: string): string | null {
  try {
    return new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "280k 50/50" → base 140, variable 140. Ranges and anything ambiguous are left as text. */
function parseOte(text: string): { base_k: number; variable_k: number } | null {
  const m = text.match(/^\s*A?\$?\s*(\d+(?:\.\d+)?)\s*k\s*\+?\s*[·,;-]?\s*(\d{2})\s*\/\s*(\d{2})\b/i);
  if (!m) return null;
  const total = Number(m[1]);
  const basePct = Number(m[2]);
  if (basePct + Number(m[3]) !== 100) return null;
  const base_k = Math.round((total * basePct) / 100);
  return { base_k, variable_k: total - base_k };
}

function notesText(j: DeskJob): string {
  const lines: string[] = [];
  const add = (label: string, value: string | undefined | null) => value && lines.push(`${label}: ${value}`);
  add("Headline", j.headline);
  if (j.flag || j.flagNote) add("Flag", j.flagNote || "Flagged");
  add("Category", j.category);
  add("Funding", j.funding);
  add("RepVue", j.repvue);
  add("OTE (as written in Pipeline Desk)", j.ote);
  add("Work model", j.workModel);
  const s = j.scores;
  if (s && (s.company || s.vision || s.leadership)) add("My scores", `company ${s.company ?? "–"}/5 · vision ${s.vision ?? "–"}/5 · leadership ${s.leadership ?? "–"}/5`);
  if (j.rating) add("My rating", `${j.rating}/5`);
  const preps = j.preps.filter((p) => p.body.trim());
  for (const p of preps) {
    lines.push("", `── Prep sheet${p.round ? `, round ${p.round}` : ""}${p.title ? `: ${p.title}` : ""} ──`, p.body.trim());
  }
  return lines.join("\n");
}

export interface ImportResult {
  imported: string[];
  skipped: string[];
}

export function importPipelineDesk(raw: unknown): ImportResult {
  const data = Backup.parse(raw);
  const fallbackAt = data.updatedAt ?? new Date().toISOString();
  const result: ImportResult = { imported: [], skipped: [] };

  tx(() => {
    for (const j of data.jobs) {
      const company = j.company.trim();
      const title = j.role.trim() || "Account Executive";
      if (!company || company === "New company") {
        result.skipped.push("(blank placeholder)");
        continue;
      }
      const exists = get(
        "SELECT j.id FROM jobs j JOIN companies c ON c.id = j.company_id WHERE c.name = ? COLLATE NOCASE AND j.title = ? COLLATE NOCASE",
        company,
        title,
      );
      if (exists) {
        result.skipped.push(`${company} (already in Pursuit)`);
        continue;
      }

      const noteDates = j.notes.map((n) => day(n.date)).filter((d): d is string => !!d).sort();
      const appliedAt = day(j.applied);
      const firstAt = [appliedAt, noteDates[0]].filter((d): d is string => !!d).sort()[0];
      const createdAt = firstAt ? new Date(new Date(firstAt).getTime() - 3600_000).toISOString() : fallbackAt;
      const lastAt = [appliedAt, ...noteDates].filter((d): d is string => !!d).sort().pop() ?? fallbackAt;
      const meta = (at: string | null): Meta => ({ source: "import", at: at ?? createdAt });

      const target = STAGE[j.stage] ?? STAGE.tba;
      const facts: Facts = {
        location: j.location || null,
        url: j.jobUrl || j.sourceUrl || null,
        team_size: j.teamSize || null,
        fit: j.rating ? Math.round(j.rating * 20) : null,
        ...(parseOte(j.ote) ?? {}),
      };
      const jobId = createJob({
        company: {
          name: company,
          domain: domain(j.website),
          summary: [j.category ? `${j.category}.` : "", j.about].filter(Boolean).join(" ") || null,
          funding_stage: j.funding || null,
        },
        title,
        facts,
        source: "import",
        at: createdAt,
        note: j.headline || undefined,
      });

      // Stage history: applied on its real date, then the current stage.
      if (target.stage !== "found") {
        if (appliedAt && target.stage !== "applied") setStage(jobId, "applied", meta(appliedAt));
        const stageAt = target.stage === "applied" ? (appliedAt ?? lastAt) : lastAt;
        setStage(jobId, target.stage, meta(stageAt), target.stage === "closed" ? (j.headline || j.flagNote || undefined) : undefined);
        if (target.detail) updateJob(jobId, { stage_detail: target.detail }, meta(stageAt), "Stage detail from Pipeline Desk");
      }

      for (const p of j.people) {
        const [who, ...rest] = p.role.split(" — ");
        addContact(jobId, { name: p.name, title: who || null, notes: rest.join(" — ") || null }, meta(createdAt));
      }
      for (const n of j.notes) {
        if (!n.body.trim()) continue;
        const label = NOTE_KIND[n.kind] ?? "Note";
        addNote(jobId, `${label}: ${n.body.trim()}`, meta(day(n.date) ?? lastAt));
      }
      if (j.nextAction || j.nextActionLabel) {
        addTask(jobId, j.nextActionLabel || "Next action", day(j.nextAction), meta(lastAt));
      }
      const text = notesText(j);
      if (text) saveNotes(jobId, text);
      result.imported.push(company);
    }
  });
  notify(null);
  return result;
}

