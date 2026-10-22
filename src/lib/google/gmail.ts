import "server-only";
import { googleGet } from "./auth";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface Header {
  name: string;
  value: string;
}
interface Part {
  mimeType: string;
  filename?: string;
  headers?: Header[];
  body?: { data?: string; size?: number };
  parts?: Part[];
}
interface RawMessage {
  id: string;
  threadId: string;
  historyId: string;
  internalDate: string;
  labelIds?: string[];
  snippet?: string;
  payload: Part;
}

export interface MessageMeta {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  cc: string;
  subject: string;
  date: string; // ISO
  snippet: string;
  labels: string[];
}

export interface FullMessage extends MessageMeta {
  body: string;
  truncated: boolean;
}

export async function profile() {
  return googleGet<{ emailAddress: string; historyId: string }>(`${API}/profile`);
}

/** Message ids matching a Gmail search, newest first. */
export async function searchIds(q: string, max = 500): Promise<{ id: string; threadId: string }[]> {
  const out: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleGet<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(
      `${API}/messages?${params}`,
    );
    out.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

/**
 * Messages added since a history id. Throws with status 404 when the history id
 * is too old, in which case the caller falls back to a search.
 */
export async function historySince(startHistoryId: string): Promise<{ ids: { id: string; threadId: string }[]; historyId: string }> {
  const ids = new Map<string, string>();
  let pageToken: string | undefined;
  let latest = startHistoryId;
  do {
    const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleGet<{
      history?: { messagesAdded?: { message: { id: string; threadId: string } }[] }[];
      historyId: string;
      nextPageToken?: string;
    }>(`${API}/history?${params}`);
    for (const h of page.history ?? []) for (const m of h.messagesAdded ?? []) ids.set(m.message.id, m.message.threadId);
    latest = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { ids: [...ids].map(([id, threadId]) => ({ id, threadId })), historyId: latest };
}

const header = (headers: Header[] | undefined, name: string) =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export function emailAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function toMeta(raw: RawMessage): MessageMeta {
  const h = raw.payload.headers;
  const from = header(h, "From");
  return {
    id: raw.id,
    threadId: raw.threadId,
    from,
    fromEmail: emailAddress(from),
    to: header(h, "To"),
    cc: header(h, "Cc"),
    subject: header(h, "Subject"),
    date: new Date(Number(raw.internalDate)).toISOString(),
    snippet: raw.snippet ?? "",
    labels: raw.labelIds ?? [],
  };
}

export async function getMeta(id: string): Promise<MessageMeta> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Cc", "Subject", "Date"]) params.append("metadataHeaders", h);
  return toMeta(await googleGet<RawMessage>(`${API}/messages/${id}?${params}`));
}

/** Longest body we send for analysis; quoted history is stripped first, so real emails rarely hit it. */
const MAX_BODY = 30_000;

export async function getFull(id: string): Promise<FullMessage> {
  const raw = await googleGet<RawMessage>(`${API}/messages/${id}?format=full`);
  const text = stripQuoted(extractText(raw.payload));
  const truncated = text.length > MAX_BODY;
  return { ...toMeta(raw), body: truncated ? text.slice(0, MAX_BODY) : text, truncated };
}

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

function collect(part: Part, mime: string, out: string[]) {
  if (part.mimeType === mime && part.body?.data && !part.filename) out.push(decode(part.body.data));
  for (const p of part.parts ?? []) collect(p, mime, out);
}

function extractText(payload: Part): string {
  const plain: string[] = [];
  collect(payload, "text/plain", plain);
  if (plain.length > 0) return plain.join("\n");
  const html: string[] = [];
  collect(payload, "text/html", html);
  return html.map(htmlToText).join("\n");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drops the quoted earlier conversation that replies carry. */
function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^On .+wrote:\s*$/.test(line.trim()) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From: .+/.test(line) && /^(Sent|Date): /.test(lines[i + 1] ?? "")) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export const gmailLink = (messageId: string) => `https://mail.google.com/mail/u/0/#all/${messageId}`;
