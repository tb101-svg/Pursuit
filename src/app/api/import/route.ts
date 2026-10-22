import crypto from "node:crypto";
import { importPipelineDesk } from "@/lib/importers/pipeline-desk";
import { mcpToken } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

/** Pipeline Desk import for tools and scripts; same bearer token as /api/mcp. */
export async function POST(req: Request) {
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = mcpToken();
  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok || req.headers.get("origin")) return new Response("Unauthorized", { status: 401 });
  try {
    return Response.json(importPipelineDesk(await req.json()));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
