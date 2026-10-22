import type { Job } from "./types";

/** Your four 1–5 ratings per role, and the S–D tier they roll up to. */

export const RATINGS = [
  { key: "rating_culture", label: "Culture", short: "Cul" },
  { key: "rating_product", label: "Product", short: "Prod" },
  { key: "rating_cash", label: "Cash", short: "Cash" },
  { key: "rating_growth", label: "Growth", short: "Grow" },
] as const;

export type RatingKey = (typeof RATINGS)[number]["key"];
export type Ratings = Record<RatingKey, number | null>;
export type Tier = "S" | "A" | "B" | "C" | "D";

/** Average needed for each tier. All 5s (or three 5s and a 4) is S. */
export const TIER_THRESHOLDS: [Tier, number][] = [
  ["S", 4.75],
  ["A", 4],
  ["B", 3],
  ["C", 2],
  ["D", 0],
];

export const TIER_COLOR: Record<Tier, string> = {
  S: "#FFD66B",
  A: "#4ADE9A",
  B: "#6E8BFF",
  C: "#F5B454",
  D: "#FF7A85",
};

export interface TierResult {
  tier: Tier | null;
  average: number | null;
  rated: number; // how many of the four are set
}

export function ratingsOf(job: Pick<Job, RatingKey>): Ratings {
  return {
    rating_culture: job.rating_culture,
    rating_product: job.rating_product,
    rating_cash: job.rating_cash,
    rating_growth: job.rating_growth,
  };
}

export function tierFor(r: Ratings): TierResult {
  const values = RATINGS.map(({ key }) => r[key]).filter((v): v is number => typeof v === "number");
  if (values.length === 0) return { tier: null, average: null, rated: 0 };
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const tier = TIER_THRESHOLDS.find(([, min]) => average >= min)![0];
  return { tier, average, rated: values.length };
}

/** For sorting: higher is better; unrated sorts last. */
export const tierScore = (t: TierResult) => (t.average === null ? -1 : t.average);
