import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSetting, setSetting } from "./db";
import { notify } from "./bus";
import { mcpToken } from "./mcp/server";
import { dataPath } from "./paths";

/**
 * "Process now": runs Claude Code headless with one prompt, on the user's
 * Claude subscription. Claude only gets Pursuit's MCP tools plus web fetch and
 * web search; every other tool is refused because nothing can approve it.
 */

const PROMPT = "Process my Pursuit queue";
const ALLOWED_TOOLS = ["mcp__pursuit", "WebFetch", "WebSearch"];
const TIME_LIMIT_MS = 20 * 60_000;
const LAST_RUN_KEY = "claude.last_run";

export interface ClaudeRun {
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "error";
  steps: number;
  emails: number;
  research: number;
  activity: string | null;
  summary: string | null;
  error: string | null;
}

const g = globalThis as unknown as { __pursuitClaude?: { child: ChildProcess | null } };
const state = (g.__pursuitClaude ??= { child: null });

/** Your own install (CLAUDE_BIN, or `claude` on PATH via npm), else the copy bundled with the Claude app. */
export function findClaude(): string | null {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  for (const dir of pathDirs) for (const n of names) if (dir && fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  if (process.platform === "win32" && process.env.APPDATA) {
    const npmShim = path.join(process.env.APPDATA, "npm", "claude.cmd");
    if (fs.existsSync(npmShim)) return npmShim;
    const bundled = path.join(process.env.APPDATA, "Claude", "claude-code");
    if (fs.existsSync(bundled)) {
      const versions = fs
        .readdirSync(bundled)
        .filter((v) => fs.existsSync(path.join(bundled, v, "claude.exe")))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (versions.length) return path.join(bundled, versions[versions.length - 1], "claude.exe");
    }
  }
  return null;
}

export function lastRun(): ClaudeRun | null {
  const run = getSetting<ClaudeRun>(LAST_RUN_KEY);
  // A run can't still be going if this server didn't start it (e.g. Pursuit restarted mid-run).
  if (run?.status === "running" && !state.child) return { ...run, status: "error", activity: null, error: "Interrupted (Pursuit restarted during the run)." };
  return run;
}

export const isRunning = () => state.child !== null;

function save(run: ClaudeRun) {
  setSetting(LAST_RUN_KEY, run);
  notify(null);
}

const ACTIVITY: Record<string, string> = {
  list_emails_to_read: "Reading emails…",
  submit_email_reading: "Recording what the emails say…",
  dismiss_email: "Setting aside non-job emails…",
  list_roles_to_research: "Looking at roles to research…",
  submit_role_research: "Saving research…",
  list_transcripts_to_read: "Reading call transcripts…",
  submit_transcript_reading: "Saving what was said on the call…",
  list_preps_to_draft: "Preparing interview prep…",
  submit_prep: "Saving your prep sheet…",
  list_stories_to_polish: "Polishing your STAR stories…",
  list_calls_to_review: "Reviewing your interview…",
  submit_call_review: "Saving your interview review…",
  submit_story_polish: "Saving a polished story…",
  WebFetch: "Reading web pages…",
  WebSearch: "Searching the web…",
};

/** Starts a run in the background. Returns an error message if it can't start. */
export function startQueueRun(origin: string): string | null {
  if (state.child) return "Already running.";
  const bin = findClaude();
  if (!bin) return "Claude Code isn't installed. See Settings for the one-time setup.";

  // Private working folder and MCP config for the run (holds the Pursuit key; stays on this computer).
  const dir = dataPath("claude-run");
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "mcp.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({ mcpServers: { pursuit: { type: "http", url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${mcpToken()}` } } } }),
  );

  const args = [
    "-p",
    PROMPT,
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    configPath,
    "--strict-mcp-config",
    "--allowedTools",
    ...ALLOWED_TOOLS,
  ];
  // Use the subscription, never API billing: hide any API key from the child.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const run: ClaudeRun = {
    started_at: new Date().toISOString(),
    finished_at: null,
    status: "running",
    steps: 0,
    emails: 0,
    research: 0,
    activity: "Starting Claude…",
    summary: null,
    error: null,
  };
  save(run);

  // An npm-installed claude.cmd must run through the shell, which needs quoting (paths contain spaces).
  const viaShell = bin.endsWith(".cmd");
  const quote = (v: string) => (/[\s"&|<>^]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v);
  const child = viaShell
    ? spawn(quote(bin), args.map(quote), { cwd: dir, env, windowsHide: true, shell: true })
    : spawn(bin, args, { cwd: dir, env, windowsHide: true });
  state.child = child;
  const timer = setTimeout(() => {
    run.error = "Stopped after 20 minutes.";
    child.kill();
  }, TIME_LIMIT_MS);

  let buffer = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line, run);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-2000);
  });
  child.on("error", (err) => {
    run.error = `Couldn't start Claude Code: ${err.message}`;
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (buffer) handleLine(buffer, run);
    state.child = null;
    run.finished_at = new Date().toISOString();
    run.activity = null;
    if (!run.error && code !== 0 && !run.summary) run.error = stderr.trim().split("\n").pop() || `Claude Code exited with code ${code}`;
    run.status = run.error ? "error" : "done";
    save(run);
  });
  return null;
}

export function stopQueueRun() {
  state.child?.kill();
}

interface StreamEvent {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  message?: { content?: { type: string; name?: string }[] };
}

function handleLine(line: string, run: ClaudeRun) {
  let ev: StreamEvent;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  if (ev.type === "assistant") {
    for (const block of ev.message?.content ?? []) {
      if (block.type !== "tool_use" || !block.name) continue;
      const tool = block.name.replace(/^mcp__pursuit__/, "");
      run.steps++;
      if (tool === "submit_email_reading" || tool === "dismiss_email") run.emails++;
      if (tool === "submit_role_research" || tool === "submit_prep" || tool === "submit_transcript_reading") run.research++;
      run.activity = ACTIVITY[tool] ?? run.activity;
      save(run);
    }
  } else if (ev.type === "result") {
    const text = ev.result ?? "";
    if (ev.is_error || /not logged in|please run \/login/i.test(text)) {
      run.error = /not logged in|\/login/i.test(text)
        ? "Claude Code isn't signed in yet. See Settings for the one-time sign-in."
        : text || "Claude Code reported an error.";
    } else {
      run.summary = text.trim() || "Done.";
    }
  }
}

export const claudeInfo = () => ({ bin: findClaude(), home: os.homedir() });
