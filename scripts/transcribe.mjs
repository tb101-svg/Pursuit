// Transcribes a call recording on this computer with Whisper (no cloud service).
//
//   node scripts/transcribe.mjs <recording.webm> <out.json> [model]
//
// Prints progress lines ("progress 0.42") to stdout and writes
// { text, segments: [{ start, end, text }], model, seconds } to out.json.
// The speech model downloads once (a few hundred MB) into data/models.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { env, pipeline } from "@huggingface/transformers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [input, output, model = "onnx-community/whisper-small.en"] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/transcribe.mjs <recording> <out.json> [model]");
  process.exit(2);
}

// PURSUIT_DATA_DIR is set by the desktop app (inherited from the server).
env.cacheDir = path.join(process.env.PURSUIT_DATA_DIR || path.join(root, "data"), "models");
env.allowRemoteModels = true;

const SAMPLE_RATE = 16_000;
const SLICE_SECONDS = 300; // transcribe in 5-minute slices so progress can be reported

/** Decode any audio ffmpeg understands into 16 kHz mono float samples. */
function decode(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1"], { windowsHide: true });
    const chunks = [];
    let err = "";
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.stderr.on("data", (c) => (err += c));
    ff.on("error", reject);
    ff.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      // A recording cut off mid-call can end in a damaged frame; keep what decoded.
      if (buf.length === 0) return reject(new Error(`Couldn't read the recording (ffmpeg exit ${code}): ${err.slice(0, 300)}`));
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    });
  });
}

const stamp = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const started = Date.now();
console.log("status decoding");
const audio = await decode(input);
const total = audio.length / SAMPLE_RATE;
console.log(`status loading-model ${model}`);
const asr = await pipeline("automatic-speech-recognition", model, { device: "cpu", dtype: "q8" });

const segments = [];
for (let offset = 0; offset < audio.length; offset += SLICE_SECONDS * SAMPLE_RATE) {
  const slice = audio.subarray(offset, Math.min(offset + SLICE_SECONDS * SAMPLE_RATE, audio.length));
  const base = offset / SAMPLE_RATE;
  const out = await asr(slice, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
  for (const c of out.chunks ?? [{ timestamp: [0, slice.length / SAMPLE_RATE], text: out.text }]) {
    const text = c.text.trim();
    if (!text || /^\[(BLANK_AUDIO|MUSIC|SILENCE)\]$/i.test(text)) continue;
    segments.push({ start: base + (c.timestamp[0] ?? 0), end: base + (c.timestamp[1] ?? c.timestamp[0] ?? 0), text });
  }
  console.log(`progress ${Math.min(1, (offset / SAMPLE_RATE + SLICE_SECONDS) / total).toFixed(2)}`);
}

const text = segments.map((s) => `[${stamp(s.start)}] ${s.text}`).join("\n");
fs.writeFileSync(output, JSON.stringify({ text, segments, model, seconds: total, took: (Date.now() - started) / 1000 }));
console.log("done");
