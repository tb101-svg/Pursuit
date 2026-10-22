import { NextResponse } from "next/server";
import { authUrl, isGoogleConfigured } from "@/lib/google/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(`${origin}/settings?google=not_configured`);
  }
  return NextResponse.redirect(authUrl(origin));
}
