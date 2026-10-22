import "server-only";
import { ImapFlow, type FetchMessageObject, type FetchQueryObject, type MessageAddressObject } from "imapflow";
import { simpleParser } from "mailparser";
import { getSetting, setSetting } from "../db";
import { clip, emailAddress, type MailMeta, type MailProvider } from "./types";

/**
 * Any mailbox over IMAP with an app password: Gmail, iCloud, Yahoo, Fastmail
 * and most others. Read-only: the Inbox is opened read-only, so nothing is
 * marked as read, moved or deleted.
 */

export interface ImapAccount {
  email: string;
  password: string;
  host: string;
  port: number;
  secure: boolean;
}

interface Cursor {
  uidValidity: string;
  lastUid: number;
}

const ACCOUNT_KEY = "imap.account";
const CURSOR_KEY = "imap.cursor";
/** Most messages read in one sync; the rest wait for the next. */
const MAX_PER_SYNC = 500;

/** Known providers by address domain: where to connect and where to make an app password. */
const PRESETS: { domains: RegExp; name: string; host: string; appPasswordUrl: string }[] = [
  { domains: /^(gmail|googlemail)\.com$/, name: "Gmail", host: "imap.gmail.com", appPasswordUrl: "https://myaccount.google.com/apppasswords" },
  { domains: /^(icloud|me|mac)\.com$/, name: "iCloud Mail", host: "imap.mail.me.com", appPasswordUrl: "https://account.apple.com/account/manage" },
  { domains: /^(yahoo|ymail)\.[a-z.]+$/, name: "Yahoo Mail", host: "imap.mail.yahoo.com", appPasswordUrl: "https://login.yahoo.com/account/security" },
  { domains: /^fastmail\.(com|fm)$/, name: "Fastmail", host: "imap.fastmail.com", appPasswordUrl: "https://app.fastmail.com/settings/security/apps" },
];

export function presetFor(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return PRESETS.find((p) => p.domains.test(domain)) ?? null;
}

export const imapAccount = () => getSetting<ImapAccount>(ACCOUNT_KEY);

/** Checks the details by logging in and opening the Inbox. Returns an error message, or null when saved. */
export async function connectImap(input: { email: string; password: string; host?: string | null; port?: number | null }): Promise<string | null> {
  const email = input.email.trim().toLowerCase();
  const host = input.host?.trim() || presetFor(email)?.host;
  if (!email.includes("@")) return "Enter your email address.";
  // Microsoft turned off app passwords for these; they connect through Outlook sign-in instead.
  if (!input.host?.trim() && /@(outlook|hotmail|live|msn)\.[a-z.]+$/.test(email)) return "Outlook and Hotmail addresses connect with the Connect Outlook button instead.";
  if (!input.password.trim()) return "Paste your app password.";
  if (!host) return "Pursuit doesn't know this provider's mail server. Add it under Advanced (your provider's help pages list it as the IMAP server).";
  const port = input.port || 993;
  const account: ImapAccount = { email, password: input.password.replace(/\s+/g, ""), host, port, secure: port === 993 };
  try {
    await withInbox(account, async () => undefined);
  } catch (err) {
    return friendlyError(err);
  }
  setSetting(ACCOUNT_KEY, account);
  setSetting(CURSOR_KEY, null);
  return null;
}

export function disconnectImap() {
  setSetting(ACCOUNT_KEY, null);
  setSetting(CURSOR_KEY, null);
}

function friendlyError(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; code?: string; message?: string };
  if (e.authenticationFailed) return "The email or app password wasn't accepted. Use an app password, not your normal password.";
  if (e.code === "ENOTFOUND") return "Couldn't find that mail server. Check the server name under Advanced.";
  if (e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT" || e.code === "ConnectionTimeout") return "Couldn't reach the mail server. Check your internet connection and the server details.";
  return `Couldn't connect: ${e.message ?? String(err)}`;
}

/** Logs in, opens the Inbox read-only, runs `fn`, and always logs out. */
async function withInbox<T>(account: ImapAccount, fn: (client: ImapFlow, box: { uidValidity: string; uidNext: number }) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.email, pass: account.password },
    logger: false,
    connectionTimeout: 20_000,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const box = client.mailbox;
      if (!box) throw new Error("Couldn't open the Inbox");
      return await fn(client, { uidValidity: String(box.uidValidity), uidNext: box.uidNext });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function requireAccount(): ImapAccount {
  const account = imapAccount();
  if (!account) throw new Error("Email not connected");
  return account;
}

// ── Messages ────────────────────────────────────────────────────────────────

// The first few KB are enough for a snippet; the full message is only fetched for job emails.
const META_QUERY: FetchQueryObject = { uid: true, envelope: true, internalDate: true, threadId: true, headers: ["references"], source: { maxLength: 8_000 } };

const fmt = (a?: MessageAddressObject) => (a?.address ? (a.name ? `${a.name} <${a.address}>` : a.address) : "");

/** Message ids carry the mailbox's UIDVALIDITY so a rebuilt mailbox never mixes up old and new UIDs. */
const messageId = (uidValidity: string, uid: number) => `imap:${uidValidity}:${uid}`;

function parseId(id: string): { uidValidity: string; uid: number } {
  const [, uidValidity, uid] = id.split(":");
  return { uidValidity, uid: Number(uid) };
}

/** The first Message-ID in References (the thread's root), so replies group without server threading. */
function rootReference(headers?: Buffer): string | null {
  const refs = headers?.toString("utf8").match(/<[^<>\s]+>/);
  return refs ? refs[0] : null;
}

function gmailLink(host: string, rfcId?: string): string | null {
  if (host !== "imap.gmail.com" || !rfcId) return null;
  return `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(rfcId.replace(/^<|>$/g, ""))}`;
}

async function toMeta(msg: FetchMessageObject, uidValidity: string, account: ImapAccount): Promise<MailMeta> {
  const env = msg.envelope ?? {};
  const from = fmt(env.from?.[0]);
  let snippet = "";
  if (msg.source) {
    try {
      const parsed = await simpleParser(msg.source);
      snippet = (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    } catch {
      // A cut-off message can fail to parse; the headers are enough.
    }
  }
  const date = env.date ?? msg.internalDate ?? new Date();
  const thread = msg.threadId ?? rootReference(msg.headers) ?? env.inReplyTo ?? env.messageId ?? String(msg.uid);
  return {
    id: messageId(uidValidity, msg.uid),
    threadId: `imap-thread:${thread}`,
    from,
    fromEmail: emailAddress(from),
    to: (env.to ?? []).map(fmt).join(", "),
    cc: (env.cc ?? []).map(fmt).join(", "),
    subject: env.subject ?? "",
    date: new Date(date).toISOString(),
    snippet,
    link: gmailLink(account.host, env.messageId),
  };
}

/** Cuts the quoted earlier messages from a reply, so only this email's own text is read. */
function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l) => /^On .{4,200}wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()));
  const own = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith(">"));
  return own.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const imapProvider: MailProvider = {
  name: "imap",
  source: "imap",
  label: "Email",
  selfEmail: () => imapAccount()?.email ?? null,
  async fetchNew() {
    const account = requireAccount();
    const cursor = getSetting<Cursor>(CURSOR_KEY);
    return withInbox(account, async (client, box) => {
      let uids: number[];
      const fresh = !cursor || cursor.uidValidity !== box.uidValidity;
      if (fresh) {
        // First sync looks back 30 days; a rebuilt mailbox catches up from 3.
        const since = new Date(Date.now() - (cursor ? 3 : 30) * 86_400_000);
        uids = (await client.search({ since }, { uid: true })) || [];
      } else {
        // "n:*" always matches the newest message, even when it's older than n.
        uids = ((await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > cursor.lastUid);
      }
      uids = uids.sort((a, b) => a - b).slice(-MAX_PER_SYNC);
      const metas: MailMeta[] = [];
      if (uids.length) {
        for await (const msg of client.fetch(uids, META_QUERY, { uid: true })) metas.push(await toMeta(msg, box.uidValidity, account));
      }
      const lastUid = Math.max(fresh ? box.uidNext - 1 : cursor.lastUid, ...uids);
      return { metas, commit: () => setSetting(CURSOR_KEY, { uidValidity: box.uidValidity, lastUid } satisfies Cursor) };
    });
  },
  async fetchMeta(id) {
    const account = requireAccount();
    const { uidValidity, uid } = parseId(id);
    return withInbox(account, async (client, box) => {
      if (box.uidValidity !== uidValidity) throw new Error("Message is no longer in the Inbox");
      const msg = await client.fetchOne(String(uid), META_QUERY, { uid: true });
      if (!msg) throw new Error("Message is no longer in the Inbox");
      return toMeta(msg, uidValidity, account);
    });
  },
  async fetchBody(id) {
    const account = requireAccount();
    const { uidValidity, uid } = parseId(id);
    return withInbox(account, async (client, box) => {
      if (box.uidValidity !== uidValidity) throw new Error("Message is no longer in the Inbox");
      const msg = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!msg || !msg.source) throw new Error("Message is no longer in the Inbox");
      const parsed = await simpleParser(msg.source);
      // HTML-only emails: fall back to the HTML with tags removed.
      const text = parsed.text?.trim() || (typeof parsed.html === "string" ? parsed.html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "") : "");
      return clip(stripQuoted(text));
    });
  },
  reset: () => setSetting(CURSOR_KEY, null),
};
