import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getCall, RECORDINGS_DIR, setRecording } from "@/lib/prep";

export const dynamic = "force-dynamic";

const MAX_CHUNK = 5 * 1024 * 1024; // 10 s of audio is ~60 KB; anything near this is not a recording chunk.

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  return !!origin && !!host && new URL(origin).host === host;
}

/** Appends one piece of a call recording (seq 0 starts the file). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const call = getCall(Number((await params).id));
  if (!call) return new Response("No such call", { status: 404 });
  const seq = Number(new URL(req.url).searchParams.get("seq"));
  const body = Buffer.from(await req.arrayBuffer());
  if (!Number.isInteger(seq) || seq < 0 || body.length === 0 || body.length > MAX_CHUNK) return new Response("Bad chunk", { status: 400 });

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  const file = path.join(RECORDINGS_DIR, `call-${call.id}.webm`);
  if (seq === 0) fs.writeFileSync(file, body);
  else fs.appendFileSync(file, body);
  if (!call.recording_path) setRecording(call.id, path.basename(file));
  return new Response(null, { status: 204 });
}

/**
 * A recorded-in-the-browser WebM has no duration or seek index (it was written
 * live, in chunks), so players can't show its length or jump around in it.
 * ffmpeg rewrites it without re-encoding (a fraction of a second) into a
 * playable copy, kept in data/recordings/play and redone if the recording
 * changes. While a call is still recording, the raw file is served.
 */
async function playableCopy(source: string): Promise<string> {
  const stat = fs.statSync(source);
  if (Date.now() - stat.mtimeMs < 15_000) return source; // still being recorded
  const dir = path.join(RECORDINGS_DIR, "play");
  const out = path.join(dir, path.basename(source));
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= stat.mtimeMs) return out;
  fs.mkdirSync(dir, { recursive: true });
  // Same binary transcription uses (the ffmpeg-static package), found directly so the server build can't relocate it.
  const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (!fs.existsSync(ffmpeg)) return source;
  const tmp = `${out}.tmp.webm`;
  const ok = await new Promise<boolean>((resolve) => {
    const p = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-c", "copy", tmp], { windowsHide: true });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
  if (!ok || !fs.existsSync(tmp)) return source;
  fs.renameSync(tmp, out);
  return out;
}

/** Plays back a recording, with byte ranges so the player can seek. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const call = getCall(Number((await params).id));
  if (!call?.recording_path) return new Response("No recording", { status: 404 });
  const source = path.join(RECORDINGS_DIR, path.basename(call.recording_path));
  if (!fs.existsSync(source)) return new Response("Recording file missing", { status: 404 });
  const file = await playableCopy(source);
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": "audio/webm",
    "Content-Disposition": `inline; filename="call-${call.id}.webm"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    return new Response(fs.readFileSync(file), { headers: { ...headers, "Content-Length": String(size) } });
  }
  // "bytes=start-end", "bytes=start-" or "bytes=-suffixLength"
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  const length = end - start + 1;
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buf, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  return new Response(buf, {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(length) },
  });
}
