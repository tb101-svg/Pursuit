import "server-only";
import { z } from "zod";
import { all, get, run, tx } from "./db";
import { notify } from "./bus";
import { recordEvent } from "./engine";
import { getPrep, savePrep, type CallSession, type PrepItem } from "./prep";
import { listStars } from "./star";
import { describeUser, getProfile, isSales } from "./profile";

/**
 * Interview review: after a call's transcript is read, Claude scores how the
 * interview went against what good looks like for this role (your prep sheet,
 * STAR stories and method), section by section, with evidence and better
 * answers. Weak answers become "Needs work" practice questions for the role.
 */

export const REVIEW_SECTIONS = [
  { id: "opener", label: "Opener & rapport" },
  { id: "tell_me", label: "Tell me about yourself" },
  { id: "motivation", label: "Why leaving / why them" },
  { id: "behavioural", label: "Behavioural answers (STAR)" },
  { id: "numbers", label: "Command of your numbers" },
  { id: "discovery", label: "Discovery / role-play depth" },
  { id: "questions", label: "Your questions" },
  { id: "close", label: "The close" },
  { id: "delivery", label: "Delivery" },
] as const;
export type ReviewSectionId = (typeof REVIEW_SECTIONS)[number]["id"];

export function reviewGuide(p = getProfile()) {
  const sales = isSales(p);
  const salesStandard = sales
    ? `
- Every number held up two or three levels deep (how was it made, why, how much was self-sourced).
- In role-plays / mock discovery: three levels on pain (problem → impact → implication, quantified in $, hours or risk), who else is affected, what happens if nothing changes, how success is measured, who decides.`
    : `
- Every number held up two or three levels deep (how was it measured, what was their part, what changed because of it).`;
  return `Review this job interview for ${describeUser(p)} (the candidate) like a demanding ${sales ? "sales" : "interview"} coach. Judge it against what good looks like for THIS role: their prep sheet (openers, expected questions and model answers, STAR stories, questions to ask, the close${sales ? ", any mock pitch" : ""}), their interview method, and this standard:
- Every behavioural question answered in STAR: brief situation, what they owned, 3–4 things they personally did ("I", not "we"), a result that leads with a number, then the lesson.${salesStandard}
- Their questions are tailored (researched gaps, sizing up the leaders, team / product / growth), not generic.
- The close: they asked whether anything gives them hesitation, handled it, and agreed a next step and date.
- ${sales ? "The interview is a sales cycle: e" : "E"}nergy, agenda-setting, concise answers; the candidate drives the conversation.

The transcript may have no speaker labels and some mis-heard words; work out who is speaking from context. Be candid and specific; flattery doesn't help them.

Return:
- overall: 0–100 (70 = solid, likely to progress; 85+ = outstanding). headline: one candid sentence. verdict: whether they're likely to progress and why.
- sections: only the ones that actually came up (ids: ${REVIEW_SECTIONS.map((s) => s.id).join(", ")}). For each: score 1–5 (3 = adequate, 5 = best in class); evidence = what they actually said (short quote with [mm:ss] timestamp); good = what good looked like here, from their prep or the standard above; improve = the better answer (a tightened rewrite in their voice, built only from their real stories and numbers) or the question they should have asked.
- strengths: 2–4 things they did well, with evidence.
- top_improvements: the 3 changes that would most lift their next interview.
- practice_next: 2–5 questions they fumbled or should prepare for the next round (question, category: Behavioural | Role | Numbers drill | Motivation | Mock pitch, why, better_answer). These go into their practice list.`;
}

const SectionReview = z.object({
  id: z.enum(REVIEW_SECTIONS.map((s) => s.id) as [ReviewSectionId, ...ReviewSectionId[]]),
  score: z.number().int().min(1).max(5),
  evidence: z.string(),
  good: z.string(),
  improve: z.string(),
});

export const ReviewSchema = z.object({
  overall: z.number().int().min(0).max(100),
  headline: z.string(),
  verdict: z.string(),
  sections: z.array(SectionReview),
  strengths: z.array(z.string()),
  top_improvements: z.array(z.string()),
  practice_next: z
    .array(
      z.object({
        question: z.string(),
        category: z.enum(["Behavioural", "Role", "Numbers drill", "Motivation", "Mock pitch"]),
        why: z.string(),
        better_answer: z.string(),
      }),
    )
    .optional()
    .default([]),
});

export type CallReview = z.infer<typeof ReviewSchema> & { reviewed_at: string; added_to_practice: number };

const now = () => new Date().toISOString();

/** Ask Claude to review a call (needs a transcript). */
export function queueReview(callId: number) {
  const call = get<{ job_id: number; transcript: string | null }>("SELECT job_id, transcript FROM call_sessions WHERE id = ?", callId);
  if (!call?.transcript) return false;
  run("UPDATE call_sessions SET review_status = 'pending', updated_at = ? WHERE id = ?", now(), callId);
  notify(call.job_id);
  return true;
}

export const pendingReviewCount = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM call_sessions WHERE review_status = 'pending'")!.n;

const clip = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

export function listCallsToReview(limit: number) {
  const calls = all<CallSession & { company: string; job_title: string; stage: string }>(
    `SELECT s.*, c.name AS company, j.title AS job_title, j.stage FROM call_sessions s
     JOIN jobs j ON j.id = s.job_id JOIN companies c ON c.id = j.company_id
     WHERE s.review_status = 'pending' AND s.transcript IS NOT NULL ORDER BY s.updated_at LIMIT ?`,
    limit,
  );
  return {
    remaining: pendingReviewCount(),
    guide: reviewGuide(),
    your_star_stories: listStars().map((s) => ({ story: s.title, proves: s.competencies, result: s.result })),
    calls: calls.map((c) => {
      const prep = getPrep(c.job_id)?.content;
      const earlier = all<{ title: string | null; started_at: string; review: string }>(
        "SELECT title, started_at, review FROM call_sessions WHERE job_id = ? AND id != ? AND review IS NOT NULL ORDER BY started_at",
        c.job_id,
        c.id,
      ).map((r) => {
        const x = JSON.parse(r.review) as CallReview;
        return { call: r.title, date: r.started_at, overall: x.overall, top_improvements: x.top_improvements };
      });
      return {
        call_id: c.id,
        company: c.company,
        role: c.job_title,
        stage: c.stage,
        call: c.title,
        date: c.started_at,
        your_notes: c.notes || null,
        what_good_looks_like: prep && {
          focus: prep.focus ?? null,
          openers: prep.openers.map((o) => ({ question: o.title, model_answer: clip(o.body, 1200) })),
          expected_questions: prep.questions.map((q) => ({ question: q.title, category: q.category, story: q.story, model_answer: clip(q.body, 700), points: q.points })),
          questions_to_ask: [...prep.gaps.map((g) => g.title), ...prep.ask.map((a) => a.title), ...prep.them.filter((t) => t.kind !== "know").map((t) => t.title)],
          close: prep.close.map((c) => c.title),
          mock_pitch: prep.pitch.map((p) => ({ element: p.title, content: clip(p.body, 500) })),
          numbers: prep.numbers.map((n) => `${n.title}: ${n.body}`),
        },
        earlier_reviews_for_this_role: earlier,
        transcript: c.transcript,
      };
    }),
  };
}

export function submitReview(callId: number, r: z.infer<typeof ReviewSchema>) {
  const call = get<{ job_id: number; title: string | null }>("SELECT job_id, title FROM call_sessions WHERE id = ?", callId);
  if (!call) throw new Error(`No call ${callId}`);
  let added = 0;
  tx(() => {
    // Weak answers become practice questions for this role, marked "Needs work".
    const prep = getPrep(call.job_id);
    if (prep && r.practice_next.length) {
      const have = new Set(prep.content.questions.map((q) => q.title.trim().toLowerCase()));
      const fresh: PrepItem[] = r.practice_next
        .filter((p) => !have.has(p.question.trim().toLowerCase()))
        .map((p) => ({
          title: p.question,
          category: p.category,
          why: `From your review of “${call.title ?? "the call"}”: ${p.why}`,
          body: p.better_answer,
          confidence: 1,
        }));
      added = fresh.length;
      if (added) savePrep(call.job_id, { ...prep.content, questions: [...fresh, ...prep.content.questions] }, prep.source === "agent" ? "agent" : "you");
    }
    const review: CallReview = { ...r, reviewed_at: now(), added_to_practice: added };
    run("UPDATE call_sessions SET review = ?, review_status = 'done', updated_at = ? WHERE id = ?", JSON.stringify(review), now(), callId);
    recordEvent({
      jobId: call.job_id,
      kind: "review",
      source: "agent",
      title: `Interview reviewed: ${r.overall}/100 · ${call.title ?? "Call"}`,
      body: [r.headline, r.top_improvements.length ? `Improve:\n${r.top_improvements.map((t) => `• ${t}`).join("\n")}` : ""].filter(Boolean).join("\n\n"),
    });
  });
  notify(call.job_id);
  return { added };
}
