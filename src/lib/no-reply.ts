import "server-only";
import { all } from "./db";
import { setStage } from "./engine";

/**
 * Applications that go quiet move to "No reply" after three weeks. Quiet means
 * nothing has happened on the role since: no email, call, interview, stage
 * change or note. Your own edits, ratings, research and prep don't count.
 * The move is logged and can be undone from Changes; a reply brings it back.
 */

export const NO_REPLY_DAYS = 21;
const QUIET_KINDS = ["research", "edit", "prep", "task_done", "task_edited", "review", "interview_edited"];

export function quietApplications(now = new Date()) {
  const cutoff = new Date(now.getTime() - NO_REPLY_DAYS * 86_400_000).toISOString();
  return all<{ id: number; last: string }>(
    `SELECT j.id, (SELECT MAX(e.occurred_at) FROM events e WHERE e.job_id = j.id AND e.kind NOT IN (${QUIET_KINDS.map(() => "?").join(", ")})) AS last
     FROM jobs j WHERE j.stage = 'applied'`,
    ...QUIET_KINDS,
  ).filter((r) => (r.last ?? "") < cutoff);
}

export function moveQuietApplications(now = new Date()): number {
  const quiet = quietApplications(now);
  for (const r of quiet) setStage(r.id, "no_reply", { source: "auto" }, `No reply in ${NO_REPLY_DAYS / 7} weeks`);
  return quiet.length;
}
