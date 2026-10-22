import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSetting, setSetting } from "../db";

/**
 * The one Anthropic client. The key comes from ANTHROPIC_API_KEY if set,
 * otherwise from the one entered in setup or Settings (kept in the database
 * on this computer).
 */

export const MODEL = "claude-opus-5-5";

const KEY = "anthropic.api_key";

export const apiKey = (): string | null => process.env.ANTHROPIC_API_KEY?.trim() || getSetting<string>(KEY) || null;

export const isAiConfigured = () => !!apiKey();

/** True when the key was typed into Pursuit (so it can be removed there). */
export const isStoredKey = () => !process.env.ANTHROPIC_API_KEY?.trim() && !!getSetting<string>(KEY);

let cached: { key: string; client: Anthropic } | null = null;

export function anthropic(): Anthropic {
  const key = apiKey();
  if (!key) throw new Error("No Anthropic API key yet. Add one in Settings.");
  if (cached?.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return cached.client;
}

/** Checks the key with Anthropic before keeping it. Returns an error message, or null when saved. */
export async function saveApiKey(key: string): Promise<string | null> {
  const trimmed = key.trim();
  if (!trimmed) return "Paste your API key.";
  try {
    await new Anthropic({ apiKey: trimmed }).models.retrieve(MODEL);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return "That key wasn't accepted. Check you copied all of it.";
    if (err instanceof Anthropic.PermissionDeniedError) return "That key works, but can't use Claude yet. Check billing in the Anthropic Console.";
    if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your internet connection.";
    if (err instanceof Anthropic.APIError) return `Anthropic said: ${err.message}`;
    throw err;
  }
  setSetting(KEY, trimmed);
  return null;
}

export const removeApiKey = () => setSetting(KEY, null);
