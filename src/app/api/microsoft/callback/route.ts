import { NextResponse } from "next/server";
import { setSourceStatus } from "@/lib/engine";
import { handleCallback } from "@/lib/microsoft/auth";
import { syncSoon } from "@/lib/sync/scheduler";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (error || !code) {
    return NextResponse.redirect(`${origin}/settings?microsoft=error&message=${encodeURIComponent(error ?? "No code returned")}`);
  }
  try {
    await handleCallback(origin, code, state);
    setSourceStatus("outlook", "connected");
    setSourceStatus("outlook_calendar", "connected");
    syncSoon();
    return NextResponse.redirect(`${origin}/settings?microsoft=connected`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${origin}/settings?microsoft=error&message=${encodeURIComponent(message)}`);
  }
}
