import os from "node:os";
import type { NextConfig } from "next";

/** This computer's addresses on your home network, so phones can load the dev server's scripts. */
const lanAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a!.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses,
  // The always-on app (scripts/pursuit-server.ps1) builds into its own folder,
  // so test builds and `next dev` never disturb the copy you're using.
  distDir: process.env.PURSUIT_DIST_DIR || ".next",
  // Setup uploads a resume PDF (up to 8 MB) through a server action.
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
  // The desktop app (npm run desktop:build) ships a self-contained server.
  // scripts/build-desktop.mjs then keeps only what the server needs.
  ...(process.env.PURSUIT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
