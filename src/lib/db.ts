import "server-only";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths";

/**
 * Schema changes, applied in order. The database remembers how many have run
 * (PRAGMA user_version), so add new entries at the end and never edit old ones.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    color TEXT NOT NULL,
    summary TEXT,
    funding_stage TEXT,
    headcount TEXT,
    hq TEXT,
    glassdoor TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX companies_name ON companies (name COLLATE NOCASE);

  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    title TEXT NOT NULL,
    url TEXT,
    location TEXT,
    stage TEXT NOT NULL DEFAULT 'found',
    stage_detail TEXT,
    closed_reason TEXT,
    rank INTEGER,
    fit INTEGER,
    base_k REAL,
    variable_k REAL,
    quota_k REAL,
    equity TEXT,
    acv TEXT,
    sales_cycle TEXT,
    segment TEXT,
    territory TEXT,
    team_size TEXT,
    ramp TEXT,
    attainment TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_source TEXT
  );

  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    title TEXT,
    email TEXT,
    role TEXT,
    notes TEXT,
    last_contact_at TEXT
  );

  CREATE TABLE interviews (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    name TEXT NOT NULL,
    starts_at TEXT,
    duration_min INTEGER,
    format TEXT,
    attendees TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    debrief TEXT
  );

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_at TEXT,
    done_at TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Append-only log: every input (note, email, call, edit) is one event.
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    payload TEXT
  );
  CREATE INDEX events_job ON events (job_id, occurred_at);

  -- One row per field an event changed; this is what makes undo and
  -- "where did this value come from" possible.
  CREATE TABLE changes (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT NOT NULL,
    undone_at TEXT
  );
  CREATE INDEX changes_job_field ON changes (job_id, field);

  CREATE TABLE sources (
    name TEXT PRIMARY KEY,
    last_sync_at TEXT,
    status TEXT NOT NULL DEFAULT 'not_connected',
    error TEXT
  );
  `,
  // v2: Gmail + Calendar sync
  `
  -- Small key/value store: OAuth tokens, sync cursors, connected account.
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Which role an email thread belongs to, once known.
  CREATE TABLE email_threads (
    thread_id TEXT PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    status TEXT NOT NULL,            -- linked | ignored
    subject TEXT,
    updated_at TEXT NOT NULL
  );

  -- Every Gmail message looked at, so nothing is processed twice.
  CREATE TABLE processed_messages (
    message_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    received_at TEXT,
    outcome TEXT NOT NULL,           -- applied | irrelevant | filtered | job_alert | proposed | error
    detail TEXT,
    processed_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1
  );

  -- Calendar events linked to interviews.
  CREATE TABLE calendar_links (
    event_id TEXT PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    interview_id INTEGER REFERENCES interviews(id) ON DELETE SET NULL,
    starts_at TEXT,
    status TEXT NOT NULL,            -- linked | ignored | proposed
    updated_at TEXT NOT NULL
  );

  -- "Needs you": updates the sync couldn't apply on its own.
  CREATE TABLE proposals (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,              -- match_email | conflict | match_event
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolution TEXT
  );
  CREATE INDEX proposals_open ON proposals (resolved_at);

  ALTER TABLE interviews ADD COLUMN calendar_event_id TEXT;
  `,
  // v3: Outlook, and the "To read" queue for emails awaiting analysis by Claude
  `
  CREATE TABLE inbox_items (
    message_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,          -- gmail | outlook
    thread_id TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    to_addr TEXT,
    cc_addr TEXT,
    subject TEXT,
    received_at TEXT NOT NULL,
    body TEXT NOT NULL,
    truncated INTEGER NOT NULL DEFAULT 0,
    link TEXT,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | done
    outcome TEXT,
    created_at TEXT NOT NULL,
    done_at TEXT
  );
  CREATE INDEX inbox_items_status ON inbox_items (status, received_at);

  ALTER TABLE calendar_links ADD COLUMN provider TEXT;
  `,
  // v4: quick add + research by Claude
  `
  ALTER TABLE jobs ADD COLUMN jd TEXT;
  ALTER TABLE companies ADD COLUMN careers_url TEXT;

  -- Roles waiting for Claude to research them (via MCP, on your subscription).
  CREATE TABLE research_requests (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    inputs TEXT NOT NULL,            -- JSON: links and details you gave
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | done
    created_at TEXT NOT NULL,
    done_at TEXT
  );
  CREATE INDEX research_status ON research_requests (status, created_at);
  `,
  // v5: your 1–5 ratings per role
  `
  ALTER TABLE jobs ADD COLUMN rating_culture INTEGER;
  ALTER TABLE jobs ADD COLUMN rating_product INTEGER;
  ALTER TABLE jobs ADD COLUMN rating_cash INTEGER;
  ALTER TABLE jobs ADD COLUMN rating_growth INTEGER;
  `,
  // v6: logos hot-linked from each company's website (address only)
  `
  ALTER TABLE companies ADD COLUMN logo_url TEXT;
  ALTER TABLE companies ADD COLUMN logo_checked_at TEXT;
  `,
  // v7: interview prep — your reusable library, per-role prep, call notes and transcripts
  `
  -- Reusable across roles: standard answers ("answer") and proof points ("story").
  CREATE TABLE prep_library (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,              -- answer | story
    title TEXT NOT NULL,             -- the question, or what they're testing for
    body TEXT NOT NULL,              -- your script, or your proof point
    note TEXT,                       -- coaching note / arc, target length
    position INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  -- One prep sheet per role (JSON sections, so Claude can draft it whole).
  CREATE TABLE role_prep (
    job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,           -- JSON: facts, openers, talking_points, questions, ask, checklist
    source TEXT NOT NULL,            -- agent | you | import
    updated_at TEXT NOT NULL
  );

  CREATE TABLE prep_requests (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    focus TEXT,                      -- e.g. "Panel with the VP Sales"
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    done_at TEXT
  );

  -- Notes taken during a call, and the transcript added afterwards.
  CREATE TABLE call_sessions (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    interview_id INTEGER REFERENCES interviews(id) ON DELETE SET NULL,
    title TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    transcript TEXT,
    transcript_status TEXT,          -- pending | done (read by Claude)
    updated_at TEXT NOT NULL
  );
  CREATE INDEX call_sessions_job ON call_sessions (job_id, started_at);
  `,
  // v8: local call recordings (file under data/recordings)
  `ALTER TABLE call_sessions ADD COLUMN recording_path TEXT;`,
  // v9: next steps have a type (task | call); interviews are stored as interviews
  `ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';`,
  // v10: automatic transcription progress, and Claude's reading of each call
  `ALTER TABLE call_sessions ADD COLUMN transcribe_progress REAL;
   ALTER TABLE call_sessions ADD COLUMN transcribe_error TEXT;
   ALTER TABLE call_sessions ADD COLUMN summary TEXT;`,
  // v11: STAR stories for behavioural answers
  `CREATE TABLE star_stories (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    competencies TEXT NOT NULL DEFAULT '[]',
    situation TEXT NOT NULL DEFAULT '',
    task TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    lesson TEXT NOT NULL DEFAULT '',
    spoken TEXT,
    gaps TEXT NOT NULL DEFAULT '[]',
    polish_status TEXT,
    previous TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );`,
  // v12: interview reviews
  `ALTER TABLE call_sessions ADD COLUMN review TEXT;
   ALTER TABLE call_sessions ADD COLUMN review_status TEXT;`,
];

export const DB_PATH =
  process.env.JOBSEARCH_DB ?? dataPath("jobsearch.db");

function open(): DatabaseSync {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new DatabaseSync(DB_PATH);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return conn;
}

function migrate(conn: DatabaseSync) {
  const { user_version } = conn.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    conn.exec("BEGIN");
    try {
      conn.exec(MIGRATIONS[v]);
      conn.exec(`PRAGMA user_version = ${v + 1}`);
      conn.exec("COMMIT");
    } catch (err) {
      conn.exec("ROLLBACK");
      throw err;
    }
  }
}

// Kept on globalThis so dev-mode hot reloads reuse one connection.
const g = globalThis as unknown as { __jobsDb?: DatabaseSync; __jobsTxDepth?: number; __jobsSchema?: number };

export function db(): DatabaseSync {
  const conn = (g.__jobsDb ??= open());
  // Also runs after a hot reload that added migrations, so no restart is needed.
  if (g.__jobsSchema !== MIGRATIONS.length) {
    migrate(conn);
    g.__jobsSchema = MIGRATIONS.length;
  }
  return conn;
}

/** Runs fn in a transaction; nested calls join the outer one. */
export function tx<T>(fn: () => T): T {
  const conn = db();
  const depth = g.__jobsTxDepth ?? 0;
  if (depth > 0) return fn();
  conn.exec("BEGIN IMMEDIATE");
  g.__jobsTxDepth = 1;
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  } finally {
    g.__jobsTxDepth = 0;
  }
}

type Param = SQLInputValue | undefined;
const bind = (params: Param[]) => params.map((p) => (p === undefined ? null : p));

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...bind(params)) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...bind(params)) as T | undefined;
}

export function run(sql: string, ...params: Param[]): number {
  return Number(db().prepare(sql).run(...bind(params)).lastInsertRowid);
}

// ── Settings (key/value) ────────────────────────────────────────────────────

export function getSetting<T>(key: string): T | null {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return row ? (JSON.parse(row.value) as T) : null;
}

export function setSetting(key: string, value: unknown) {
  if (value === null || value === undefined) {
    run("DELETE FROM settings WHERE key = ?", key);
    return;
  }
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
}
