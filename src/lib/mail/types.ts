import type { Source } from "../types";

/** One email's headers, the same shape whichever mailbox it came from. */
export interface MailMeta {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  cc: string;
  subject: string;
  date: string; // ISO
  snippet: string;
  link: string | null;
  /** Mail folder it was found in, when it isn't the Inbox (e.g. "Promos"). */
  folder?: string;
}

export interface MailBody {
  body: string;
  truncated: boolean;
}

export interface MailProvider {
  name: "gmail" | "outlook" | "imap";
  source: Source;
  label: string;
  /** The connected account's address, or null when not connected. */
  selfEmail(): string | null;
  /** New messages since the last sync; call `commit` once they're all handled to move the cursor on. */
  fetchNew(): Promise<{ metas: MailMeta[]; commit: () => void }>;
  fetchMeta(id: string): Promise<MailMeta>;
  fetchBody(id: string): Promise<MailBody>;
  /** Forget the sync cursor, so the next sync starts from recent mail again. */
  reset(): void;
}

/** Longest body kept for analysis; quoted history is removed first, so real emails rarely reach it. */
export const MAX_BODY = 30_000;

export function clip(text: string): MailBody {
  const truncated = text.length > MAX_BODY;
  return { body: truncated ? text.slice(0, MAX_BODY) : text, truncated };
}

export function emailAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}
