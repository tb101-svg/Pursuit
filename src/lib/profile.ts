import "server-only";
import { getSetting, setSetting } from "./db";

/**
 * Who the user is and what they're looking for. Every prompt Claude gets is
 * built from this, so nothing about one person is written into the code.
 * Filled in by setup (later) or Settings → Your profile.
 */

/** Which role details matter: "sales" adds quota, deal size, territory and the sales-interview playbook. */
export type RolePack = "sales" | "general";

export interface Profile {
  name: string;
  /** How Claude should describe them, e.g. "an experienced Account Executive". */
  headline: string;
  /** Where they live and search, e.g. "Sydney, Australia". */
  location: string;
  /** The market they sell or work in, e.g. "ANZ". Empty = use the location. */
  region: string;
  /** Currency symbol for comp, e.g. "A$". */
  currency: string;
  /** The roles they want, e.g. "Enterprise Account Executive, SaaS". */
  targetRoles: string;
  pack: RolePack;
  /** What makes a role right: seniority, comp floor, company stage, must-haves. */
  wants: string;
  /** Deal-breakers. */
  avoid: string;
  /** How drafts (notes, emails) should sound. */
  voice: string;
  /** Anything in their story to handle with care: gaps, redundancies, short stints, and how they explain them. */
  careerNotes: string;
  /** Their interview-prep method. Empty = data/interview-prep-method.md if it's there. */
  method: string;
}

const KEY = "profile";

export const DEFAULT_PROFILE: Profile = {
  name: "",
  headline: "",
  location: "",
  region: "",
  currency: "$",
  targetRoles: "",
  pack: "sales",
  wants: "",
  avoid: "",
  voice: "warm, direct, specific, no fluff",
  careerNotes: "",
  method: "",
};

export function getProfile(): Profile {
  return { ...DEFAULT_PROFILE, ...(getSetting<Partial<Profile>>(KEY) ?? {}) };
}

export function saveProfile(profile: Partial<Profile>) {
  setSetting(KEY, { ...getProfile(), ...profile });
}

export const isSales = (p = getProfile()) => p.pack === "sales";

/** "Sam" — or "the user" before setup. */
export const firstName = (p = getProfile()) => p.name.trim().split(/\s+/)[0] || "the user";

/** "SB" for the sidebar avatar. */
export const initials = (p = getProfile()) =>
  p.name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** "the local market (ANZ)" style wording: the region, else the location, else a neutral phrase. */
export const market = (p = getProfile()) => p.region.trim() || p.location.trim() || "the local market";

/** "Sam, an experienced Account Executive based in Sydney, Australia, looking for Enterprise AE roles". */
export function describeUser(p = getProfile()): string {
  const parts = [firstName(p)];
  if (p.headline.trim()) parts.push(p.headline.trim());
  let text = parts.join(", ");
  if (p.location.trim()) text += ` based in ${p.location.trim()}`;
  if (p.targetRoles.trim()) text += `, looking for ${p.targetRoles.trim()} roles`;
  return text;
}

/** The roles in a phrase, for prompts: "Enterprise AE roles", or a neutral fallback. */
export const rolesPhrase = (p = getProfile()) => (p.targetRoles.trim() ? `${p.targetRoles.trim()} roles` : isSales(p) ? "sales roles" : "new roles");
