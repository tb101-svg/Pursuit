import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { all, get, run } from "./db";
import { notify } from "./bus";
import { firstName } from "./profile";
import { RECORDINGS_DIR, addTranscript } from "./prep";

/**
 * Call recordings → transcripts, on this computer (Whisper via
 * scripts/transcribe.mjs, no cloud service). One call at a time; progress is
 * kept on the call so the UI can show it. When a transcript is ready Claude
 * is started to read it (summary, notes, role updates), on your subscription.
 *
 * transcript_status: queued → transcribing → pending (waiting for Claude) → done; or failed.
 */

const g = globalThis as unknown as { __pursuitTranscribe?: { busy: boolean } };
const state = (g.__pursuitTranscribe ??= { busy: false });

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Queue a call's recording for transcription (safe to call twice). */
export function queueTranscription(callId: number) {
  const call = get<{ job_id: number; recording_path: string | null; transcript_status: string | null }>(
    "SELECT job_id, recording_path, transcript_status FROM call_sessions WHERE id = ?",
    callId,
  );
  if (!call?.recording_path) return;
  if (call.transcript_status && call.transcript_status !== "failed") return;
  run("UPDATE call_sessions SET transcript_status = 'queued', transcribe_progress = 0, transcribe_error = NULL, updated_at = ? WHERE id = ?", now(), callId);
  notify(call.job_id);
  void work();
}

/** Picks up anything left over (e.g. Pursuit restarted mid-transcription). */
export function resumeTranscriptions() {
  run("UPDATE call_sessions SET transcript_status = 'queued' WHERE transcript_status = 'transcribing'");
  void work();
}

async function work() {
  if (state.busy) return;
  state.busy = true;
  try {
    for (;;) {
      const next = get<{ id: number; job_id: number; recording_path: string }>(
        "SELECT id, job_id, recording_path FROM call_sessions WHERE transcript_status = 'queued' ORDER BY updated_at LIMIT 1",
      );
      if (!next) break;
      await transcribeOne(next);
    }
  } finally {
    state.busy = false;
  }
  if (all("SELECT id FROM call_sessions WHERE transcript_status = 'pending' LIMIT 1").length) await startClaude();
}

async function transcribeOne(call: { id: number; job_id: number; recording_path: string }) {
  const file = path.join(RECORDINGS_DIR, path.basename(call.recording_path));
  const set = (sql: string, ...params: (string | number | null)[]) => {
    run(sql, ...params);
    notify(call.job_id);
  };
  try {
    // The last few seconds of audio upload just after "End call": wait until the file stops growing.
    for (let i = 0; i < 24; i++) {
      if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs > 12_000) break;
      await sleep(5_000);
    }
    if (!fs.existsSync(file)) throw new Error("The recording file is missing.");
    set("UPDATE call_sessions SET transcript_status = 'transcribing', transcribe_progress = 0, updated_at = ? WHERE id = ?", now(), call.id);

    const out = path.join(os.tmpdir(), `pursuit-transcript-${call.id}.json`);
    const script = path.join(process.cwd(), "scripts", "transcribe.mjs");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [script, file, out], { cwd: process.cwd(), windowsHide: true });
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          const m = line.match(/^progress ([\d.]+)/);
          if (m) set("UPDATE call_sessions SET transcribe_progress = ? WHERE id = ?", Number(m[1]), call.id);
        }
      });
      child.stderr.on("data", (c: Buffer) => (err += c.toString()));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split("\n").slice(-3).join(" ").slice(0, 400) || `exit ${code}`))));
    });

    const result = JSON.parse(fs.readFileSync(out, "utf8")) as { text: string; seconds: number };
    fs.rmSync(out, { force: true });
    const minutes = Math.round(result.seconds / 60);
    const header = `(Transcribed automatically on this computer from the call recording, ${minutes} min. No speaker labels; ${firstName()} is the candidate. Expect some mis-heard names.)`;
    addTranscript(call.id, result.text.trim() ? `${header}\n\n${result.text}` : `${header}\n\n(No speech found.)`);
    set("UPDATE call_sessions SET transcribe_progress = 1 WHERE id = ?", call.id);
  } catch (err) {
    set(
      "UPDATE call_sessions SET transcript_status = 'failed', transcribe_error = ?, updated_at = ? WHERE id = ?",
      err instanceof Error ? err.message : String(err),
      now(),
      call.id,
    );
  }
}

/** Have Claude read waiting transcripts now (skipped if a run is already going; the next sync tick retries). */
export async function startClaude() {
  if (process.env.PURSUIT_NO_CLAUDE === "1") return; // test copies
  const { findClaude, isRunning, startQueueRun } = await import("./claude-runner");
  if (!findClaude() || isRunning()) return;
  startQueueRun(`http://localhost:${process.env.PORT || 3100}`);
}
