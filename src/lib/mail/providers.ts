import "server-only";
import { getSetting, setSetting } from "../db";
import { connectedAccount as googleAccount } from "../google/auth";
import { getFull, getMeta, gmailLink, historySince, profile, searchIds, type MessageMeta } from "../google/gmail";
import { connectedAccount as microsoftAccount, graphGet, type GraphError } from "../microsoft/auth";
import { clip, emailAddress, type MailMeta, type MailProvider } from "./types";
import { imapProvider } from "./imap";

// ── Gmail ───────────────────────────────────────────────────────────────────

const GMAIL_CURSOR = "gmail.historyId";
const GMAIL_FILTER = "-in:chats -category:promotions -category:social -category:forums";

const fromGmail = (m: MessageMeta): MailMeta => ({
  id: m.id,
  threadId: m.threadId,
  from: m.from,
  fromEmail: m.fromEmail,
  to: m.to,
  cc: m.cc,
  subject: m.subject,
  date: m.date,
  snippet: m.snippet,
  link: gmailLink(m.id),
});

export const gmailProvider: MailProvider = {
  name: "gmail",
  source: "gmail",
  label: "Gmail",
  selfEmail: () => googleAccount()?.email ?? null,
  async fetchNew() {
    let ids: { id: string }[];
    let next: string;
    const cursor = getSetting<string>(GMAIL_CURSOR);
    if (!cursor) {
      next = (await profile()).historyId;
      ids = await searchIds(`newer_than:30d ${GMAIL_FILTER}`, 500);
    } else {
      try {
        const h = await historySince(cursor);
        ids = h.ids;
        next = h.historyId;
      } catch (err) {
        if ((err as { status?: number }).status !== 404) throw err;
        next = (await profile()).historyId; // history too old: catch up by search
        ids = await searchIds(`newer_than:3d ${GMAIL_FILTER}`, 500);
      }
    }
    const metas: MailMeta[] = [];
    for (const { id } of ids) metas.push(fromGmail(await getMeta(id)));
    return { metas, commit: () => setSetting(GMAIL_CURSOR, next) };
  },
  fetchMeta: async (id) => fromGmail(await getMeta(id)),
  async fetchBody(id) {
    const full = await getFull(id);
    return { body: full.body, truncated: full.truncated };
  },
  reset: () => setSetting(GMAIL_CURSOR, null),
};

// ── Outlook (Microsoft Graph) ───────────────────────────────────────────────

const OUTLOOK_CURSOR = "outlook.deltaLink";
const GRAPH = "https://graph.microsoft.com/v1.0/me";
const SELECT = "id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,webLink";

interface GraphRecipient {
  emailAddress: { name?: string; address?: string };
}
interface GraphMessage {
  id: string;
  conversationId: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime: string;
  bodyPreview?: string;
  webLink?: string;
  "@removed"?: unknown;
}

const fmt = (r?: GraphRecipient) =>
  r?.emailAddress?.address ? (r.emailAddress.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress.address) : "";

function fromGraph(m: GraphMessage): MailMeta {
  const from = fmt(m.from);
  return {
    id: m.id,
    threadId: m.conversationId,
    from,
    fromEmail: emailAddress(from),
    to: (m.toRecipients ?? []).map(fmt).join(", "),
    cc: (m.ccRecipients ?? []).map(fmt).join(", "),
    subject: m.subject ?? "",
    date: new Date(m.receivedDateTime).toISOString(),
    snippet: m.bodyPreview ?? "",
    link: m.webLink ?? null,
  };
}

/** Follows a delta query to the end; returns the messages and the link for next time. */
async function runDelta(start: string): Promise<{ messages: GraphMessage[]; deltaLink: string }> {
  const messages: GraphMessage[] = [];
  let url: string | undefined = start;
  while (url) {
    const page: { value: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string } = await graphGet(url, [
      "odata.maxpagesize=50",
    ]);
    messages.push(...page.value.filter((m) => !m["@removed"]));
    if (page["@odata.deltaLink"]) return { messages, deltaLink: page["@odata.deltaLink"] };
    url = page["@odata.nextLink"];
  }
  throw new Error("Outlook delta query ended without a delta link");
}

function freshDelta(days: number, folderId = "inbox") {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  const params = new URLSearchParams({ $select: SELECT, $filter: `receivedDateTime ge ${since}` });
  const folder = folderId === "inbox" ? "'inbox'" : `'${encodeURIComponent(folderId)}'`;
  return `${GRAPH}/mailFolders(${folder})/messages/delta?${params}`;
}

/** Folders that never hold new mail from other people. */
const SKIP_FOLDERS = ["sentitems", "drafts", "deleteditems", "junkemail", "outbox", "archive", "conversationhistory", "syncissues", "scheduled"];
const FOLDER_CURSORS = "outlook.folderDeltaLinks";
const FOLDER_CHOICE = "outlook.folders";

/** Folders read by default: the Inbox and any whose name suggests job mail. */
const JOB_FOLDER = /job|career|linkedin|recruit|promo|interview/i;

/** The folder ids you've chosen in Settings (or the defaults). "inbox" is always included. */
export function chosenFolders(all: { id: string; name: string }[]): { id: string; name: string }[] {
  const saved = getSetting<string[]>(FOLDER_CHOICE);
  return all.filter((f) => f.id === "inbox" || (saved ? saved.includes(f.id) : JOB_FOLDER.test(f.name)));
}

export function setChosenFolders(ids: string[]) {
  setSetting(FOLDER_CHOICE, ids.filter((id) => id !== "inbox"));
}

/**
 * Where incoming mail can land: the Inbox and its subfolders, plus any folders
 * of your own (e.g. ones Outlook rules file LinkedIn or promo mail into).
 */
export async function mailFolders(): Promise<{ id: string; name: string }[]> {
  type Folder = { id: string; displayName: string; childFolderCount?: number };
  const skip = new Set<string>();
  for (const name of SKIP_FOLDERS) {
    try {
      skip.add((await graphGet<Folder>(`${GRAPH}/mailFolders('${name}')?$select=id`)).id);
    } catch {
      // not every mailbox has every well-known folder
    }
  }
  const top = await graphGet<{ value: Folder[] }>(`${GRAPH}/mailFolders?$top=100&$select=id,displayName,childFolderCount`);
  const inboxId = (await graphGet<Folder>(`${GRAPH}/mailFolders('inbox')?$select=id`)).id;
  const folders = top.value.filter((x) => !skip.has(x.id));
  const inbox = folders.find((x) => x.id === inboxId);
  if (inbox?.childFolderCount) {
    const kids = await graphGet<{ value: Folder[] }>(`${GRAPH}/mailFolders('inbox')/childFolders?$top=100&$select=id,displayName`);
    folders.push(...kids.value);
  }
  return folders.map((x) => ({ id: x.id === inboxId ? "inbox" : x.id, name: x.displayName }));
}

export const outlookProvider: MailProvider = {
  name: "outlook",
  source: "outlook",
  label: "Outlook",
  selfEmail: () => microsoftAccount()?.email ?? null,
  async fetchNew() {
    // One delta cursor per folder. The Inbox keeps the cursor it had before other folders were read.
    const cursors = getSetting<Record<string, string>>(FOLDER_CURSORS) ?? {};
    const legacy = getSetting<string>(OUTLOOK_CURSOR);
    if (legacy && !cursors.inbox) cursors.inbox = legacy;
    const next: Record<string, string> = {};
    const messages: GraphMessage[] = [];
    const folderOf = new Map<string, string | undefined>();
    for (const folder of chosenFolders(await mailFolders())) {
      const cursor = cursors[folder.id];
      let result;
      try {
        // A folder read for the first time looks back 30 days.
        result = await runDelta(cursor ?? freshDelta(30, folder.id));
      } catch (err) {
        // An expired delta link (410/404) means catching up from recent mail.
        if (!cursor || ![404, 410].includes((err as GraphError).status)) throw err;
        result = await runDelta(freshDelta(3, folder.id));
      }
      for (const m of result.messages) folderOf.set(m.id, folder.id === "inbox" ? undefined : folder.name);
      messages.push(...result.messages);
      next[folder.id] = result.deltaLink;
    }
    return {
      metas: messages.map((m) => ({ ...fromGraph(m), folder: folderOf.get(m.id) })),
      commit: () => {
        setSetting(FOLDER_CURSORS, next);
        setSetting(OUTLOOK_CURSOR, null);
      },
    };
  },
  fetchMeta: async (id) => fromGraph(await graphGet<GraphMessage>(`${GRAPH}/messages/${encodeURIComponent(id)}?$select=${SELECT}`)),
  async fetchBody(id) {
    // uniqueBody is just this message's own text, without the quoted thread.
    const m = await graphGet<{ uniqueBody?: { content: string }; body?: { content: string } }>(
      `${GRAPH}/messages/${encodeURIComponent(id)}?$select=uniqueBody,body`,
      ['outlook.body-content-type="text"'],
    );
    const text = (m.uniqueBody?.content?.trim() || m.body?.content || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return clip(text);
  },
  reset: () => {
    setSetting(OUTLOOK_CURSOR, null);
    setSetting(FOLDER_CURSORS, null);
  },
};

export const MAIL_PROVIDERS = [outlookProvider, gmailProvider, imapProvider];
export const connectedMailProviders = () => MAIL_PROVIDERS.filter((p) => p.selfEmail() !== null);
