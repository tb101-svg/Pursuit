import { NextResponse } from "next/server";
import { authUrl, isMicrosoftConfigured } from "@/lib/microsoft/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  if (!isMicrosoftConfigured()) {
    return NextResponse.redirect(`${origin}/settings?microsoft=not_configured`);
  }
  return NextResponse.redirect(authUrl(origin));
}
