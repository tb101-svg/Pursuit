"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, COOKIE_MAX_AGE, cookieValue, passcode, passcodeMatches } from "./lock";

export async function unlockAction(_prev: string | null, fd: FormData): Promise<string | null> {
  const attempt = String(fd.get("passcode") ?? "");
  const next = String(fd.get("next") ?? "/");
  const code = passcode();
  if (!code) redirect("/");
  if (!passcodeMatches(attempt)) {
    await new Promise((r) => setTimeout(r, 800)); // slows guessing
    return "That passcode isn't right.";
  }
  (await cookies()).set(COOKIE, cookieValue(code), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  // Only ever return to a page on this site.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
