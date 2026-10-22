import crypto from "node:crypto";

/**
 * Passcode lock for using Pursuit from other devices on your Wi-Fi.
 * The cookie holds an HMAC of the passcode, so changing the passcode signs
 * every device out. Used by src/proxy.ts and the /unlock page.
 */

export const COOKIE = "pursuit_unlock";
export const COOKIE_MAX_AGE = 90 * 86_400; // seconds

export const passcode = () => process.env.PURSUIT_PASSCODE?.trim() || null;

export function cookieValue(code: string): string {
  return crypto.createHmac("sha256", code).update("pursuit-unlock-v1").digest("hex");
}

export function cookieIsValid(value: string | undefined): boolean {
  const code = passcode();
  if (!code || !value) return false;
  const expected = Buffer.from(cookieValue(code));
  const given = Buffer.from(value);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function passcodeMatches(attempt: string): boolean {
  const code = passcode();
  if (!code) return false;
  const a = crypto.createHash("sha256").update(attempt).digest();
  const b = crypto.createHash("sha256").update(code).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Requests addressed to this computer itself. */
export function isLocalHost(host: string | null): boolean {
  const name = (host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
