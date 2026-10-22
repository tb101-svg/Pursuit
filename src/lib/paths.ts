import path from "node:path";

/**
 * Where Pursuit keeps its data: PURSUIT_DATA_DIR when set (the desktop app
 * points it at the user's app-data folder), otherwise ./data.
 */
export const DATA_DIR = process.env.PURSUIT_DATA_DIR || path.join(process.cwd(), "data");

export const dataPath = (...parts: string[]) => path.join(DATA_DIR, ...parts);
