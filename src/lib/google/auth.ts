import "server-only";
import crypto from "node:crypto";
import { getSetting, setSetting } from "../db";

/** Read-only access: the app never sends email or edits your calendar. */
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const TOKEN_KEY = "google.tokens";
const ACCOUNT_KEY = "google.account";
const STATE_KEY = "google.oauth_state";

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
}

export class GoogleNotConnectedError extends Error {
  constructor(message = "Google account not connected") {
    super(message);
  }
}

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const isGoogleConfigured = () => config() !== null;

export function redirectUri(origin: string) {
  return `${origin}/api/google/callback`;
}

export function authUrl(origin: string): string {
  const cfg = config();
  if (!cfg) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env.local");
  const state = crypto.randomBytes(16).toString("hex");
  setSetting(STATE_KEY, { state, at: Date.now() });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Google token error: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json as { access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token?: string };
}

/** Finishes the OAuth flow: checks state, swaps the code for tokens, stores them. */
export async function handleCallback(origin: string, code: string, state: string): Promise<string> {
  const cfg = config();
  if (!cfg) throw new Error("Google client is not configured");
  const saved = getSetting<{ state: string; at: number }>(STATE_KEY);
  setSetting(STATE_KEY, null);
  if (!saved || saved.state !== state || Date.now() - saved.at > 10 * 60_000) {
    throw new Error("Sign-in expired or didn't match. Please try connecting again.");
  }
  const t = await tokenRequest({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token. Remove Pursuit's access in your Google account and connect again.");
  const granted = t.scope.split(" ");
  const missing = SCOPES.filter((s) => s.startsWith("https://") && !granted.includes(s));
  if (missing.length > 0) {
    throw new Error("Pursuit needs both Gmail and Calendar read access. Please tick both boxes when connecting.");
  }
  setSetting(TOKEN_KEY, {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
    scope: t.scope,
  } satisfies StoredTokens);
  const email = emailFromIdToken(t.id_token);
  setSetting(ACCOUNT_KEY, { email, connected_at: new Date().toISOString() });
  return email;
}

function emailFromIdToken(idToken: string | undefined): string {
  if (!idToken) return "unknown";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function connectedAccount(): { email: string; connected_at: string } | null {
  return getSetting(ACCOUNT_KEY);
}

/** A valid access token, refreshed if it's about to expire. */
export async function accessToken(): Promise<string> {
  const cfg = config();
  const tokens = getSetting<StoredTokens>(TOKEN_KEY);
  if (!cfg || !tokens) throw new GoogleNotConnectedError();
  if (tokens.expires_at - Date.now() > 60_000) return tokens.access_token;
  let t;
  try {
    t = await tokenRequest({
      refresh_token: tokens.refresh_token,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    });
  } catch (err) {
    // invalid_grant = access revoked or expired; the user must reconnect.
    if (String(err).includes("invalid_grant") || String(err).toLowerCase().includes("expired or revoked")) {
      throw new GoogleNotConnectedError("Google access expired or was revoked. Reconnect in Settings.");
    }
    throw err;
  }
  const next: StoredTokens = {
    ...tokens,
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
  };
  setSetting(TOKEN_KEY, next);
  return next.access_token;
}

export async function disconnect() {
  const tokens = getSetting<StoredTokens>(TOKEN_KEY);
  if (tokens) {
    // Best effort: tell Google to drop the grant too.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refresh_token)}`, { method: "POST" }).catch(() => {});
  }
  setSetting(TOKEN_KEY, null);
  setSetting(ACCOUNT_KEY, null);
}

/** GET a Google API URL as JSON with the current token. */
export async function googleGet<T>(url: string): Promise<T> {
  const token = await accessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Google API ${res.status}: ${text.slice(0, 300)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}
