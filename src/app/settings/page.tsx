import os from "node:os";
import { headers } from "next/headers";
import { passcode } from "@/lib/lock";
import { CopyButton } from "@/components/CopyButton";
import { ImportForm } from "@/components/ImportForm";
import { LogoRefresh } from "@/components/LogoRefresh";
import { SyncButton } from "@/components/SyncButton";
import { MailFolders } from "@/components/MailFolders";
import { LiveDot } from "@/components/ui";
import { deleteAllAction, disconnectGoogleAction, disconnectMicrosoftAction, loadDemoAction, removeApiKeyAction, saveApiKeyAction, saveProfileAction } from "@/lib/actions";
import { isStoredKey } from "@/lib/ai/client";
import { SubmitButton } from "@/components/SubmitButton";
import { ImapConnect } from "@/components/ImapConnect";
import { imapAccount } from "@/lib/mail/imap";
import { getProfile } from "@/lib/profile";
import { isAiConfigured } from "@/lib/ai/extract";
import { all, DB_PATH } from "@/lib/db";
import { inTime, relTime } from "@/lib/format";
import { connectedAccount as googleAccount, isGoogleConfigured } from "@/lib/google/auth";
import { pendingCount } from "@/lib/mail/pipeline";
import { mcpToken } from "@/lib/mcp/server";
import { findClaude } from "@/lib/claude-runner";
import { connectedAccount as microsoftAccount, isMicrosoftConfigured } from "@/lib/microsoft/auth";
import { countJobs } from "@/lib/repo";
import { syncStatus, type SyncRun } from "@/lib/sync/scheduler";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const host = (await headers()).get("host") ?? "localhost:3100";
  const jobs = countJobs();
  const profile = getProfile();
  const msReady = isMicrosoftConfigured();
  const msAccount = microsoftAccount();
  const googleReady = isGoogleConfigured();
  const gAccount = googleAccount();
  const apiKey = isAiConfigured();
  const toRead = pendingCount();
  const sync = syncStatus();
  const imap = imapAccount();
  const anyConnected = !!(msAccount || gAccount || imap);
  const outcomes = all<{ outcome: string; n: number }>("SELECT outcome, COUNT(*) AS n FROM processed_messages GROUP BY outcome");
  const failures = all<{ detail: string | null }>("SELECT DISTINCT detail FROM processed_messages WHERE outcome = 'error' LIMIT 3");
  const count = (o: string) => outcomes.find((x) => x.outcome === o)?.n ?? 0;
  const mcpUrl = `http://${host}/api/mcp`;
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))
    .map((a) => `http://${a!.address}:3100`);
  const phoneOn = !!passcode();
  // Outlook folders (read live; skipped quietly if Outlook is unreachable).
  let folders: { id: string; name: string }[] = [];
  let chosen: string[] = [];
  if (msAccount) {
    try {
      const { mailFolders, chosenFolders } = await import("@/lib/mail/providers");
      folders = await mailFolders();
      chosen = chosenFolders(folders).map((x) => x.id);
    } catch {
      folders = [];
    }
  }
  const mcpCommand = `claude mcp add --transport http --scope user pursuit ${mcpUrl} --header "Authorization: Bearer ${mcpToken()}"`;

  return (
    <div className="flex max-w-3xl flex-col gap-5 px-4 py-5 md:px-8 md:py-7">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl leading-none font-semibold tracking-[-0.035em]">Settings</h1>
        <p className="text-sm text-muted">Everything is stored on this computer.</p>
      </header>

      {params.key === "saved" && <Banner tone="ok">API key saved. Claude is connected.</Banner>}
      {params.key_error && <Banner tone="error">{params.key_error}</Banner>}
      {params.profile === "saved" && <Banner tone="ok">Profile saved. Claude uses it from the next run.</Banner>}

      <section className="glass flex flex-col gap-4 rounded-xl p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold">Your profile</h2>
          <p className="text-[13px] text-muted">Claude uses this to read your emails, research roles, prepare you and review your interviews.</p>
        </div>
        <form action={saveProfileAction} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ProfileField label="Name" name="name" value={profile.name} placeholder="Sam Taylor" />
            <ProfileField label="How you'd describe yourself" name="headline" value={profile.headline} placeholder="an experienced Account Executive" />
            <ProfileField label="Location" name="location" value={profile.location} placeholder="Sydney, Australia" />
            <ProfileField label="Region or market" name="region" value={profile.region} placeholder="ANZ" />
            <ProfileField label="Roles you want" name="targetRoles" value={profile.targetRoles} placeholder="Enterprise Account Executive, SaaS" />
            <ProfileField label="Currency" name="currency" value={profile.currency} placeholder="A$" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pf-pack" className="label">
              Kind of role
            </label>
            <select id="pf-pack" name="pack" defaultValue={profile.pack} className="input max-w-xs">
              <option value="sales">Sales (quota, deal size, territory)</option>
              <option value="general">General</option>
            </select>
          </div>
          <ProfileArea label="What you want in a role" name="wants" value={profile.wants} placeholder="e.g. Senior IC, $180k+ base, Series B or later, hybrid" rows={2} />
          <ProfileArea label="Deal-breakers" name="avoid" value={profile.avoid} placeholder="e.g. Fully in-office, crypto, no clear territory" rows={2} />
          <ProfileField label="Your voice, for drafts" name="voice" value={profile.voice} placeholder="warm, direct, specific, no fluff" />
          <ProfileArea
            label="Your story: anything to handle with care"
            name="careerNotes"
            value={profile.careerNotes}
            placeholder="e.g. Made redundant in a global restructure in March, not for performance. Say it in one line and move on."
            rows={3}
          />
          <ProfileArea
            label="Your interview-prep method (optional)"
            name="method"
            value={profile.method}
            placeholder="Paste your own method here. Leave empty to use Pursuit's."
            rows={6}
          />
          <div>
            <button type="submit" className="btn btn-primary btn-sm">
              Save profile
            </button>
          </div>
        </form>
      </section>

      {params.microsoft === "connected" &&<Banner tone="ok">Outlook connected. The first sync has started.</Banner>}
      {params.microsoft === "error" && <Banner tone="error">Couldn’t connect Outlook: {params.message ?? "unknown error"}</Banner>}
      {params.microsoft === "not_configured" && (
        <Banner tone="error">Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to .env.local, then restart the app.</Banner>
      )}
      {params.imap === "connected" && <Banner tone="ok">Email connected. The first sync has started.</Banner>}
      {params.imap_error && <Banner tone="error">{params.imap_error}</Banner>}
      {params.google === "connected" && <Banner tone="ok">Google connected. The first sync has started.</Banner>}
      {params.google === "error" && <Banner tone="error">Couldn’t connect Google: {params.message ?? "unknown error"}</Banner>}

      <section className="glass flex flex-col gap-4 rounded-xl p-5">
        <h2 className="text-[15px] font-semibold">Mail and calendar</h2>
        {/* Shown once the app has Microsoft sign-in set up. */}
        {(msReady || msAccount) && (
          <Row
            label="Outlook (mail + calendar)"
            status={msAccount ? "ok" : "idle"}
            detail={
              msAccount
                ? `Connected as ${msAccount.email} · read-only`
                : "Ready to connect. You’ll be asked to allow read-only access to mail and calendar."
            }
          >
            {msAccount ? (
              <form action={disconnectMicrosoftAction}>
                <button type="submit" className="btn btn-ghost btn-sm">
                  Disconnect
                </button>
              </form>
            ) : msReady ? (
              <a href="/api/microsoft/connect" className="btn btn-primary btn-sm">
                Connect Outlook
              </a>
            ) : null}
          </Row>
        )}
        <div className="flex flex-col gap-3 border-t border-white/7 pt-4">
          <span className="text-sm font-medium">Gmail, iCloud, Yahoo and others (app password)</span>
          <ImapConnect next="settings" />
        </div>
        {(googleReady || gAccount) && (
          <Row
            label="Google (Gmail + Calendar)"
            status={gAccount ? "ok" : "idle"}
            detail={gAccount ? `Connected as ${gAccount.email} · read-only` : "Optional. Ready to connect."}
          >
            {gAccount ? (
              <form action={disconnectGoogleAction}>
                <button type="submit" className="btn btn-ghost btn-sm">
                  Disconnect
                </button>
              </form>
            ) : (
              <a href="/api/google/connect" className="btn btn-ghost btn-sm">
                Connect Google
              </a>
            )}
          </Row>
        )}
      </section>

      <section className="glass flex flex-col gap-4 rounded-xl p-5">
        <h2 className="text-[15px] font-semibold">Phone access (home Wi-Fi)</h2>
        <Row
          label={phoneOn ? "On: passcode set" : "Off: this computer only"}
          status={phoneOn ? "ok" : "idle"}
          detail={
            phoneOn
              ? "Devices on your Wi-Fi can open Pursuit after entering the passcode (remembered for 90 days). Start Pursuit with Start Pursuit.cmd so it listens on your network."
              : "Add PURSUIT_PASSCODE (8+ characters) to .env.local, then restart Pursuit with Start Pursuit.cmd."
          }
        />
        {phoneOn && (
          <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/4 p-4 text-[13px] text-fg-2">
            <span>On your phone (same Wi-Fi), open:</span>
            {lan.length ? (
              lan.map((url) => (
                <div key={url} className="flex items-center gap-2">
                  <code className="flex-1 rounded-md bg-black/40 px-3 py-2 font-mono text-sm text-fg">{url}</code>
                  <CopyButton text={url} />
                </div>
              ))
            ) : (
              <span className="text-amber-soft">This computer doesn’t seem to be on a home network right now.</span>
            )}
            <span className="text-muted">
              Then use your browser’s <span className="text-fg-2">Share → Add to Home Screen</span> (iPhone) or <span className="text-fg-2">⋮ → Add to Home screen</span> (Android)
              for an app icon. The first time, Windows may ask whether Node.js can use the network: allow <span className="text-fg-2">Private networks</span> only.
              The address can change if your router gives this computer a new one; this page always shows the current one.
            </span>
          </div>
        )}
      </section>

      <section className="glass flex flex-col gap-4 rounded-xl p-5">
        <h2 className="text-[15px] font-semibold">Reading emails</h2>
        <Row
          label={apiKey ? "Automatic (Anthropic API key)" : "Claude, on your subscription (no API costs)"}
          status={apiKey ? "ok" : "idle"}
          detail={
            apiKey
              ? "Job-related emails are read as soon as they arrive. API usage is billed to your Anthropic account."
              : `Job-related emails wait in “To read” until you ask Claude to process them. ${toRead} waiting now.`
          }
        >
          {apiKey && isStoredKey() && (
            <form action={removeApiKeyAction}>
              <button type="submit" className="btn btn-ghost btn-sm">
                Remove key
              </button>
            </form>
          )}
        </Row>
        {!apiKey && (
          <form action={saveApiKeyAction} className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/4 p-4">
            <label htmlFor="settings-key" className="text-sm font-semibold">
              Add an Anthropic API key
            </label>
            <p className="text-[13px] text-fg-2">
              Create one at console.anthropic.com → API keys. It is kept on this computer and billed to your Anthropic account.
            </p>
            <div className="flex gap-2">
              <input id="settings-key" name="key" type="password" className="input" placeholder="sk-ant-…" autoComplete="off" required />
              <SubmitButton className="btn btn-primary btn-sm" pending="Checking…">
                Save key
              </SubmitButton>
            </div>
          </form>
        )}
        {!apiKey && (
          <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/4 p-4">
            <h3 className="text-sm font-semibold">Connect Claude to Pursuit</h3>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] text-fg-2">
              <li>Run this once in a terminal. It adds Pursuit as a tool for Claude Code, including the Code tab of the Claude app.</li>
            </ol>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 rounded-md bg-black/40 px-3 py-2 font-mono text-xs leading-relaxed break-all text-fg-2">
                {mcpCommand}
              </code>
              <CopyButton text={mcpCommand} />
            </div>
            <ol start={2} className="flex list-decimal flex-col gap-2 pl-5 text-[13px] text-fg-2">
              <li>
                Keep Pursuit running, then ask Claude: <span className="text-fg">“Process my Pursuit queue.”</span> It reads each waiting email
                and researches roles you added with Quick add, then updates Pursuit.
              </li>
              <li>You can also ask things like “What’s my next step at Cortexa?” or “Add a note to Northwind: offer expected Friday.”</li>
            </ol>
            <p className="text-xs text-faint">The command contains a private key for this app. Don’t share it.</p>
            <h3 className="pt-2 text-sm font-semibold">“Process now” button</h3>
            <p className="text-[13px] text-fg-2">
              Runs Claude Code in the background on your subscription.{" "}
              {findClaude() ? (
                <>Found Claude Code at <code className="font-mono text-xs break-all">{findClaude()}</code>.</>
              ) : (
                <>Claude Code wasn’t found.</>
              )}{" "}
              It needs a one-time sign-in with your Claude account. In a terminal, run these, choose to sign in with your Claude account, then close it:
            </p>
            <div className="flex flex-col gap-1.5">
              {["npm install -g @anthropic-ai/claude-code", "claude"].map((cmd) => (
                <div key={cmd} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 rounded-md bg-black/40 px-3 py-2 font-mono text-xs text-fg-2">{cmd}</code>
                  <CopyButton text={cmd} />
                </div>
              ))}
            </div>
            <p className="text-xs text-faint">Claude may only use Pursuit’s tools plus web fetch and web search during these runs.</p>
          </div>
        )}
      </section>

      <section className="glass flex flex-col gap-4 rounded-xl p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold">Sync</h2>
          <span className="text-[13px] text-muted">Every {sync.intervalMin} minutes while the app is running</span>
          <div className="ml-auto">
            <SyncButton disabled={!anyConnected} running={sync.running} />
          </div>
        </div>
        {folders.length > 0 && (
          <div className="flex flex-col gap-2 border-y border-white/7 py-3">
            <span className="text-sm font-medium">Outlook folders to read</span>
            <MailFolders folders={folders} chosen={chosen} />
          </div>
        )}
        <LastRun run={sync.last} />
        {sync.nextAt && anyConnected && <p className="text-[13px] text-faint">Next automatic sync {inTime(sync.nextAt)}.</p>}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Stat label="To read" value={toRead} />
          <Stat label="Applied" value={count("applied")} />
          <Stat label="Needs you" value={count("proposed")} />
          <Stat label="Not job-related" value={count("irrelevant") + count("filtered")} />
          <Stat label="Job alerts kept" value={count("job_alert")} />
        </dl>
        {failures.length > 0 && (
          <div className="rounded-lg border border-red/30 bg-red/10 p-3 text-[13px] text-[#FFB3BA]">
            {count("error")} emails couldn’t be processed and will be retried: {failures.map((f) => f.detail).join(" · ")}
          </div>
        )}
      </section>

      <section className="glass flex flex-col gap-3 rounded-xl p-5">
        <h2 className="text-[15px] font-semibold">Data</h2>
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
          <dt className="text-faint">Database file</dt>
          <dd className="font-mono text-[13px] break-all">{DB_PATH}</dd>
          <dt className="text-faint">Roles</dt>
          <dd className="font-mono">{jobs}</dd>
        </dl>
        <p className="text-[13px] text-muted">To back up, copy the database file while the app is stopped.</p>
      </section>

      <section className="glass flex flex-col gap-3 rounded-xl p-5">
        <h2 className="text-[15px] font-semibold">Company logos</h2>
        <p className="text-sm text-muted">
          Logos are loaded straight from each company’s website; Pursuit only keeps the address. New companies get theirs automatically.
          Use this to re-check every company.
        </p>
        <LogoRefresh />
      </section>

      <section className="glass flex flex-col gap-3 rounded-xl p-5">
        <h2 className="text-[15px] font-semibold">Import from Pipeline Desk</h2>
        <p className="text-sm text-muted">
          Use the file from Pipeline Desk’s <span className="text-fg-2">Backup</span> button. Roles, notes, people, next steps and prep sheets keep
          their dates and show “Pipeline Desk” as their source. Roles already here are skipped.
        </p>
        <ImportForm />
      </section>

      <section className="glass flex flex-col gap-3 rounded-xl p-5">
        <h2 className="text-[15px] font-semibold">Demo data</h2>
        <p className="text-sm text-muted">Adds eight fictional roles with interviews, contacts and history, so you can try things out.</p>
        <form action={loadDemoAction}>
          <button type="submit" className="btn btn-ghost">
            Load demo data
          </button>
        </form>
      </section>

      <section className="glass flex flex-col gap-3 rounded-xl border-red/30 p-5">
        <h2 className="text-[15px] font-semibold">Delete all data</h2>
        <p className="text-sm text-muted">
          Permanently removes every role, contact, interview and change from this computer, and resets email sync so the next sync starts fresh
          from recent mail. Use it to clear demo data before adding your real roles. Your connections are kept.
        </p>
        <form action={deleteAllAction} className="flex items-center gap-2">
          <label htmlFor="confirm" className="sr-only">
            Type DELETE to confirm
          </label>
          <input id="confirm" name="confirm" className="input max-w-[220px]" placeholder="Type DELETE to confirm" autoComplete="off" />
          <button type="submit" className="btn border border-red/40 bg-red/15 text-[#FFB3BA] hover:bg-red/25">
            Delete everything
          </button>
        </form>
      </section>
    </div>
  );
}

function Banner({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={`rounded-xl border px-4 py-3 text-sm ${tone === "ok" ? "border-green/30 bg-green/10 text-green" : "border-red/35 bg-red/10 text-[#FFB3BA]"}`}
    >
      {children}
    </div>
  );
}

function Row({ label, status, detail, children }: { label: string; status: "ok" | "idle" | "missing"; detail: string; children?: React.ReactNode }) {
  const color = status === "ok" ? "#4ADE9A" : status === "idle" ? "#6E8BFF" : "#F5B454";
  return (
    <div className="flex items-center gap-3">
      <LiveDot color={color} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-[13px] text-muted">{detail}</span>
      </div>
      {children}
    </div>
  );
}

function ProfileField({ label, name, value, placeholder }: { label: string; name: string; value: string; placeholder: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`pf-${name}`} className="label">
        {label}
      </label>
      <input id={`pf-${name}`} name={name} defaultValue={value} placeholder={placeholder} className="input" autoComplete="off" />
    </div>
  );
}

function ProfileArea({ label, name, value, placeholder, rows }: { label: string; name: string; value: string; placeholder: string; rows: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`pf-${name}`} className="label">
        {label}
      </label>
      <textarea id={`pf-${name}`} name={name} defaultValue={value} placeholder={placeholder} rows={rows} className="input" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/7 bg-white/4 p-3">
      <dt className="label">{label}</dt>
      <dd className="font-mono text-lg">{value}</dd>
    </div>
  );
}

function LastRun({ run }: { run: SyncRun | null }) {
  if (!run) return <p className="text-[13px] text-muted">No sync has run yet.</p>;
  return (
    <div className="flex flex-col gap-1 text-[13px] text-fg-2">
      <span className="text-muted">
        Last sync {run.finished_at ? relTime(run.finished_at) : "running now"} ({run.reason})
      </span>
      {run.steps.map((s) => {
        const r = s.result;
        if ("error" in r) {
          return (
            <span key={s.source} className="text-[#FFB3BA]">
              {s.label}: {r.error}
            </span>
          );
        }
        if ("queued" in r) {
          return (
            <span key={s.source}>
              {s.label}: {r.checked} new · {r.queued} to read · {r.applied} applied · {r.needsYou} for you{r.errors ? ` · ${r.errors} failed` : ""}
            </span>
          );
        }
        return (
          <span key={s.source}>
            {s.label}: {r.checked} events · {r.linked} linked · {r.updated} updated · {r.needsYou} for you
          </span>
        );
      })}
    </div>
  );
}
