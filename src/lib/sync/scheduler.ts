import "server-only";
import { getSetting, setSetting } from "../db";
import { setSourceStatus } from "../engine";
import { GoogleNotConnectedError } from "../google/auth";
import { MicrosoftNotConnectedError } from "../microsoft/auth";
import { connectedCalendars } from "../calendar/providers";
import { connectedMailProviders } from "../mail/providers";
import { syncMailbox, type MailSyncResult } from "../mail/pipeline";
import { syncCalendar, type CalendarSyncResult } from "./calendar-sync";

/**
 * Runs mail + calendar sync every SYNC_INTERVAL_MINUTES (default 10) while the
 * app is running, plus shortly after start-up, after connecting, and on "Sync now".
 */

export interface SyncStep {
  source: string; // sources.name: outlook | outlook_calendar | gmail | calendar
  label: string;
  result: MailSyncResult | CalendarSyncResult | { error: string };
}

export interface SyncRun {
  started_at: string;
  finished_at: string | null;
  reason: string;
  steps: SyncStep[];
}

const LAST_RUN_KEY = "sync.last_run";

const g = globalThis as unknown as {
  __pursuitSync?: { timer: ReturnType<typeof setInterval> | null; running: boolean; nextAt: number | null };
};
const state = (g.__pursuitSync ??= { timer: null, running: false, nextAt: null });

const intervalMs = () => Math.max(1, Number(process.env.SYNC_INTERVAL_MINUTES) || 10) * 60_000;

export function startScheduler() {
  if (state.timer) return;
  // Quiet applications → No reply: shortly after start-up, then hourly.
  const checkQuiet = () => void import("../no-reply").then((m) => m.moveQuietApplications()).catch(() => {});
  setTimeout(checkQuiet, 15_000);
  // Transcriptions interrupted by a restart carry on.
  setTimeout(() => void import("../transcribe").then((m) => m.resumeTranscriptions()).catch(() => {}), 10_000);
  setInterval(checkQuiet, 3600_000);
  state.nextAt = Date.now() + 20_000;
  setTimeout(() => void runSync("startup"), 20_000);
  state.timer = setInterval(() => void runSync("schedule"), intervalMs());
}

export function syncSoon(reason = "connect") {
  setTimeout(() => void runSync(reason), 1_000);
}

/** sources.name for each provider, as shown in the sidebar. */
const SOURCE_NAME: Record<string, string> = {
  outlook: "outlook",
  gmail: "gmail",
  imap: "imap",
  outlook_calendar: "outlook_calendar",
  google_calendar: "calendar",
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const disconnected = (err: unknown) => err instanceof GoogleNotConnectedError || err instanceof MicrosoftNotConnectedError;

export async function runSync(reason: string): Promise<SyncRun | null> {
  if (state.running) return null;
  const calendars = connectedCalendars();
  const mailboxes = connectedMailProviders();
  if (calendars.length === 0 && mailboxes.length === 0) return null;
  state.running = true;
  const run: SyncRun = { started_at: new Date().toISOString(), finished_at: null, reason, steps: [] };
  setSetting(LAST_RUN_KEY, run);
  try {
    // Calendars first: cheap, and they give email matching more to go on.
    for (const cal of calendars) {
      const source = SOURCE_NAME[cal.name];
      try {
        run.steps.push({ source, label: cal.label, result: await syncCalendar(cal) });
        setSourceStatus(source, "connected", null, true);
      } catch (err) {
        run.steps.push({ source, label: cal.label, result: { error: message(err) } });
        setSourceStatus(source, disconnected(err) ? "not_connected" : "error", message(err));
      }
    }
    for (const box of mailboxes) {
      const source = SOURCE_NAME[box.name];
      try {
        run.steps.push({ source, label: box.label, result: await syncMailbox(box) });
        setSourceStatus(source, "connected", null, true);
      } catch (err) {
        run.steps.push({ source, label: box.label, result: { error: message(err) } });
        setSourceStatus(source, disconnected(err) ? "not_connected" : "error", message(err));
      }
    }
    // Transcripts still waiting for Claude (e.g. a run was busy when they finished): try again.
    await import("../prep").then(async (m) => {
      if (m.pendingTranscriptCount() > 0) await import("../transcribe").then((t) => t.startClaude());
    }).catch(() => {});
    // Logos for any company that has a website but no logo yet (cheap; skips recent checks).
    await import("../logos").then((m) => m.refreshLogos({ limit: 20 })).catch(() => {});
  } finally {
    run.finished_at = new Date().toISOString();
    setSetting(LAST_RUN_KEY, run);
    state.running = false;
    state.nextAt = Date.now() + intervalMs();
  }
  return run;
}

export function syncStatus() {
  const last = getSetting<SyncRun>(LAST_RUN_KEY);
  return {
    running: state.running,
    nextAt: state.nextAt ? new Date(state.nextAt).toISOString() : null,
    // Runs saved by the earlier Gmail-only version have no steps.
    last: last && Array.isArray(last.steps) ? last : null,
    intervalMin: intervalMs() / 60_000,
  };
}
