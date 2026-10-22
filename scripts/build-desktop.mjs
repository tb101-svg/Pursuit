// Builds the server the desktop app ships: `npm run desktop:build`, then
// `npm run desktop:dist` wraps it in the Windows installer.
//
// 1. next build as a standalone server (in .next-desktop, so it never touches
//    `next dev` or the always-on copy).
// 2. Keep only what the server needs. Tracing also picks up data/ (your
//    database), the source and other files; none of that may ship.
// 3. Add the static files, plus the local transcription script and its
//    packages, which the server starts as a separate process so tracing
//    can't see them. Speech-model binaries for other platforms are dropped.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const distDir = ".next-desktop";
const standalone = path.join(root, distDir, "standalone");
const out = path.join(root, "dist-desktop", "server");

const KEEP = new Set(["server.js", "package.json", "node_modules", distDir]);

function step(message) {
  console.log(`\n▸ ${message}`);
}

step("Building the standalone server");
fs.rmSync(path.join(root, distDir), { recursive: true, force: true });
const build = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PURSUIT_STANDALONE: "1", PURSUIT_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: "1" },
});
if (build.status !== 0) process.exit(build.status ?? 1);

step("Keeping only what the server needs");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(standalone)) {
  if (KEEP.has(name)) fs.cpSync(path.join(standalone, name), path.join(out, name), { recursive: true });
}
fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
fs.cpSync(path.join(root, distDir, "static"), path.join(out, distDir, "static"), { recursive: true });

step("Adding local transcription");
const script = path.join(root, "scripts", "transcribe.mjs");
fs.mkdirSync(path.join(out, "scripts"), { recursive: true });
fs.copyFileSync(script, path.join(out, "scripts", "transcribe.mjs"));
const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
const { fileList } = await nodeFileTrace([script], { base: root });
let added = 0;
for (const file of fileList) {
  if (!file.startsWith("node_modules")) continue;
  const dest = path.join(out, file);
  if (fs.existsSync(dest) || fs.statSync(path.join(root, file)).isDirectory()) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, file), dest);
  added++;
}
console.log(`  ${added} files`);
// ffmpeg's binary is found by path at runtime, so copy it explicitly.
const ffmpeg = path.join("node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
fs.mkdirSync(path.dirname(path.join(out, ffmpeg)), { recursive: true });
fs.copyFileSync(path.join(root, ffmpeg), path.join(out, ffmpeg));
// The speech-model runtime ships binaries for every platform; keep this one.
const ortBin = path.join(out, "node_modules", "onnxruntime-node", "bin");
if (fs.existsSync(ortBin)) {
  for (const napi of fs.readdirSync(ortBin)) {
    for (const platform of fs.readdirSync(path.join(ortBin, napi))) {
      if (platform !== process.platform) fs.rmSync(path.join(ortBin, napi, platform), { recursive: true, force: true });
      else
        for (const arch of fs.readdirSync(path.join(ortBin, napi, platform)))
          if (arch !== process.arch) fs.rmSync(path.join(ortBin, napi, platform, arch), { recursive: true, force: true });
    }
  }
}

step("Checking nothing private is included");
const leaks = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(db|db-wal|db-shm)$|^\.env/.test(entry.name)) leaks.push(path.relative(out, p));
  }
})(out);
if (leaks.length) {
  console.error(`Refusing to continue: private files in the build:\n  ${leaks.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nServer ready in ${path.relative(root, out)}`);
