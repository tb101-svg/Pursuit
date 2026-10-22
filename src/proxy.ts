import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, cookieIsValid, isLocalHost, passcode } from "./lib/lock";

/**
 * Keeps Pursuit private.
 * - No passcode set: only this computer (requests to localhost) gets in.
 * - Passcode set: every device, this one included, unlocks once per 90 days.
 * Endpoints with their own protection (MCP and import use a bearer token;
 * OAuth callbacks check their own state) pass straight through.
 */

const OPEN_PATHS = [/^\/unlock$/, /^\/api\/mcp$/, /^\/api\/import$/, /^\/api\/(microsoft|google)\/callback$/, /^\/manifest\.webmanifest$/, /^\/(apple-)?icon/, /^\/icons\//, /^\/brand\//];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (OPEN_PATHS.some((re) => re.test(pathname))) return NextResponse.next();

  if (!passcode()) {
    if (isLocalHost(req.headers.get("host"))) return NextResponse.next();
    return new NextResponse(
      "Pursuit is only available on the computer it runs on. To use it from your phone, set PURSUIT_PASSCODE in .env.local and restart Pursuit.",
      { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  if (cookieIsValid(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return new NextResponse("Locked", { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
