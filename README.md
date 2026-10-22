# Pursuit

A local-only job search command centre: every role, its stage, comp, people, interviews and history in one place, kept current automatically.

## Run it

Pursuit runs in the background, like a normal app:

- **At login** it starts hidden (a "Pursuit (background)" entry in your Startup folder runs `scripts/pursuit-server.ps1`). Your installed Pursuit app then just opens.
- **The desktop Pursuit icon** (or `Start Pursuit.cmd`) runs `scripts/open-pursuit.ps1`: it starts Pursuit if it isn't running, waits until it's ready, and opens the installed app.
- It runs a production build kept in `.next-app/`, rebuilt automatically when the code has changed. To pick up code changes, stop the running `next start` process; the server script rebuilds and restarts it.
- Logs: `data/logs/pursuit.log` (plus `server.*.log`, `build.*.log`).
- To stop it starting at login, delete "Pursuit (background)" from `shell:startup`.

For development with live reload instead (stop the background copy first, since both use port 3100):

```bash
npm install
npm run dev -- --port 3100
```

Open http://localhost:3100. The first screen offers demo data; clear it from **Settings → Delete all data** before adding real roles.

### Desktop app (Windows installer)

```bash
npm install
cd desktop && npm install && cd ..
npm run desktop:dist
```

This builds `dist-desktop/installer/Pursuit-Setup-<version>.exe`, a per-user installer (no admin needed) to share. It wraps a standalone build of the server (`scripts/build-desktop.mjs`) in Electron (`desktop/main.cjs`):

- Data lives in `%APPDATA%\Pursuit\data` (database, recordings, logs), never in the install folder, and is kept on uninstall.
- The app runs on `http://127.0.0.1:47100` (or a free port if that's taken). Closing the window keeps it in the tray so email keeps syncing; the tray menu has "Start when I sign in" and Quit.
- Optional settings such as `MICROSOFT_CLIENT_ID` go in `%APPDATA%\Pursuit\data\pursuit.env` (KEY=value lines).
- `npm run desktop:build` then `npm run desktop:start` runs the desktop shell without packaging.
- The installer isn't code-signed yet, so Windows SmartScreen shows "Windows protected your PC": choose **More info → Run anyway**.
- Releases: bump `version` in `desktop/package.json`, commit, and push a matching tag (`git tag v0.1.1 && git push origin v0.1.1`). GitHub Actions (`.github/workflows/release.yml`) builds the installer and publishes it to the repo's Releases page; installed copies update themselves on their next start.

### Connecting Outlook (Hotmail / Outlook.com)

1. At entra.microsoft.com → **App registrations → New registration**: supported accounts **Personal Microsoft accounts only**; redirect URI (platform **Web**) `http://localhost:3100/api/microsoft/callback`.
2. **Certificates & secrets → New client secret**; copy the secret's *Value*. Copy the **Application (client) ID**.
3. Put both in `.env.local` as `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`, restart, then **Settings → Connect Outlook**. Access is read-only (Mail.Read, Calendars.Read).

Gmail + Google Calendar are also supported (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, redirect `/api/google/callback`) but optional.

### Using it on your phone (home Wi-Fi)

Pursuit only listens on this computer until you set a passcode. To use it from your phone:

1. Add `PURSUIT_PASSCODE=` (8+ characters) to `.env.local`.
2. Start Pursuit with **Start Pursuit.cmd**; with a passcode set it listens on your Wi-Fi. If Windows asks whether Node.js may use the network, allow **Private networks** only.
3. Open the address shown in **Settings → Phone access** on your phone, enter the passcode (remembered 90 days), and use **Add to Home Screen** for an app icon.

Every device, this computer included, unlocks once with the passcode (`src/proxy.ts`). The MCP and import endpoints keep their own bearer token, and OAuth callbacks check their own state. Changing the passcode signs every device out.

### Reading emails: two modes

- **No API key (default, no extra cost):** job-looking emails wait in **To read**. Claude reads them on your Claude subscription through Pursuit's MCP server. Add it once with the command shown in Settings (`claude mcp add --transport http … /api/mcp`), then ask Claude *"Process my job emails in Pursuit."*
- **`ANTHROPIC_API_KEY` set:** emails are read automatically as they arrive (billed to your Anthropic account).

Both modes apply results through the same rules.

## How data stays current

Every input is an **event** on a role: a note, an edit, a finished interview, and later an email, calendar change or call transcript. `src/lib/engine.ts` is the only code that writes. `recordEvent`:

1. appends the event to the log (`events`),
2. applies any facts it carries to the role, writing one `changes` row per field that actually changed (old value, new value, which event),
3. bumps the role's "updated" time and source,
4. notifies open browser tabs through `/api/stream`, which re-render straight away.

Because every value has a `changes` row, the app can show where each value came from (the Comp & role tab) and undo any change (the Changes page). An undo is itself a logged event.

Derived views (next step, round "4 of 5", freshness) are calculated when the page loads, not stored, so they can't drift.

## Sync (mail + calendar)

Every 10 minutes while the app runs (`src/instrumentation.ts` starts it), plus **Sync now** in Settings:

1. **Calendar** (`src/lib/sync/calendar-sync.ts`, providers in `src/lib/calendar/`): events in the next 60 days whose attendees or title match a role become interviews. Moved or cancelled events update the linked interview.
2. **Mail** (`src/lib/mail/pipeline.ts`, providers in `src/lib/mail/providers.ts`): new mail since the last sync (Outlook delta queries / Gmail history; the first sync looks back 30 days). Cheap header checks pick out likely job emails: threads already linked to a role, known contacts and company domains, applicant-tracking senders, keywords. Those are read by Claude (API, or queued for MCP), which returns structured facts. LinkedIn/Seek job alerts are set aside for discovery.
3. **Applying** (`src/lib/sync/apply.ts`): facts fill empty fields, stages only move forward (except a rejection), and interviews, next steps and contacts are added without duplicates. All of it is logged, sourced and undoable. Anything that would overwrite a *different* value, or an email that can't be matched to a role confidently, goes to **Needs you** on the home screen.

## Layout

| Path | What |
|---|---|
| `src/lib/db.ts` | SQLite connection (Node's built-in `node:sqlite`) and schema migrations |
| `src/lib/engine.ts` | All writes: events, facts, tasks, interviews, contacts, undo |
| `src/lib/repo.ts` | All reads |
| `src/lib/view.ts` | Turns rows into what the UI shows (cards, next step, feed) |
| `src/lib/actions.ts` | Server actions called by the UI |
| `src/lib/demo.ts` | Fictional demo data |
| `src/app/` | Pages: Roles (`/`), role (`/jobs/[id]`), add role, Changes, Settings |

Data lives in `data/jobsearch.db` (not committed). Set `JOBSEARCH_DB` to use a different file. To back up, copy that file while the app is stopped.

## Roadmap

1. **Foundation** (done): local app, event log, provenance, undo, live refresh
2. **Mail + calendar sync** (built; needs your Microsoft app keys): Outlook or Gmail, every 10 minutes
3. **MCP server** (built): Claude reads the To read queue and can list, inspect and update roles (`src/lib/mcp/server.ts`, endpoint `/api/mcp`, bearer token)
4. Discovery: job-alert emails, careers pages, logos, company research
5. Insights from emails and calls, prep sheets
6. Call recording (meeting bot or local capture) and presenter mode
