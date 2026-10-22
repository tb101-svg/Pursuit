import "server-only";
import crypto from "node:crypto";
import { getSetting, setSetting } from "../db";

/**
 * Microsoft sign-in (Outlook.com / Hotmail) for read-only Mail and Calendar
 * access through Microsoft Graph. `consumers` is the endpoint for personal
 * Microsoft accounts; set MICROSOFT_TENANT=common if the app registration
 * also allows work or school accounts.
 */

const SCOPES = ["openid", "email", "offline_access", "User.Read", "Mail.Read", "Calendars.Read"];

const TOKEN_KEY = "microsoft.tokens";
const ACCOUNT_KEY = "microsoft.account";
const STATE_KEY = "microsoft.oauth_state";

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export class MicrosoftNotConnectedError extends Error {
  constructor(message = "Microsoft account not connected") {
    super(message);
  }
}

function config() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  const tenant = process.env.MICROSOFT_TENANT?.trim() || "consumers";
  return clientId && clientSecret ? { clientId, clientSecret, tenant } : null;
}

export const isMicrosoftConfigured = () => config() !== null;
const authority = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
export const redirectUri = (origin: string) => `${origin}/api/microsoft/callback`;

export function authUrl(origin: string): string {
  const cfg = config();
  if (!cfg) throw new Error("MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are not set in .env.local");
  const state = crypto.randomBytes(16).toString("hex");
  setSetting(STATE_KEY, { state, at: Date.now() });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: redirectUri(origin),
    response_mode: "query",
    scope: SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return `${authority(cfg.tenant)}/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const cfg = config();
  if (!cfg) throw new Error("Microsoft app is not configured");
  const res = await fetch(`${authority(cfg.tenant)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: SCOPES.join(" "), ...body }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(`Microsoft sign-in error: ${json.error_description ?? json.error ?? res.status}`) as Error & { code?: string };
    err.code = String(json.error ?? "");
    throw err;
  }
  return json as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
}

export async function handleCallback(origin: string, code: string, state: string): Promise<string> {
  const saved = getSetting<{ state: string; at: number }>(STATE_KEY);
  setSetting(STATE_KEY, null);
  if (!saved || saved.state !== state || Date.now() - saved.at > 10 * 60_000) {
    throw new Error("Sign-in expired or didn't match. Please try connecting again.");
  }
  const t = await tokenRequest({ code, redirect_uri: redirectUri(origin), grant_type: "authorization_code" });
  if (!t.refresh_token) throw new Error("Microsoft didn't return a refresh token (offline access). Please connect again.");
  const granted = t.scope.toLowerCase();
  if (!granted.includes("mail.read") || !granted.includes("calendars.read")) {
    throw new Error("Pursuit needs read access to both Mail and Calendar. Please accept both when connecting.");
  }
  setSetting(TOKEN_KEY, { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 } satisfies StoredTokens);
  const me = await graphGet<{ mail: string | null; userPrincipalName: string }>("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName");
  const email = (me.mail ?? me.userPrincipalName).toLowerCase();
  setSetting(ACCOUNT_KEY, { email, connected_at: new Date().toISOString() });
  return email;
}

export function connectedAccount(): { email: string; connected_at: string } | null {
  return getSetting(ACCOUNT_KEY);
}

export async function accessToken(): Promise<string> {
  const tokens = getSetting<StoredTokens>(TOKEN_KEY);
  if (!config() || !tokens) throw new MicrosoftNotConnectedError();
  if (tokens.expires_at - Date.now() > 60_000) return tokens.access_token;
  let t;
  try {
    t = await tokenRequest({ refresh_token: tokens.refresh_token, grant_type: "refresh_token" });
  } catch (err) {
    if ((err as { code?: string }).code === "invalid_grant") {
      throw new MicrosoftNotConnectedError("Microsoft access expired or was revoked. Reconnect in Settings.");
    }
    throw err;
  }
  // Microsoft rotates refresh tokens: always keep the newest one.
  const next: StoredTokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
  };
  setSetting(TOKEN_KEY, next);
  return next.access_token;
}

export function disconnect() {
  // Access can also be removed at account.live.com/consent/Manage.
  setSetting(TOKEN_KEY, null);
  setSetting(ACCOUNT_KEY, null);
}

export interface GraphError extends Error {
  status: number;
}

/** GET a Graph URL as JSON. `prefer` adds Prefer headers (e.g. text bodies, UTC times, page size). */
export async function graphGet<T>(url: string, prefer: string[] = []): Promise<T> {
  const token = await accessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (prefer.length) headers.Prefer = prefer.join(", ");
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Microsoft Graph ${res.status}: ${text.slice(0, 300)}`) as GraphError;
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}
