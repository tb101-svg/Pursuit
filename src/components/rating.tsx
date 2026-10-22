"use client";

import { useOptimistic, useTransition } from "react";
import { setRatingAction } from "@/lib/actions";
import { RATINGS, TIER_COLOR, tierFor, type RatingKey, type Ratings, type TierResult } from "@/lib/rating";

/** Big S–D badge. Provisional (not all four rated) shows lighter with a count. */
export function TierBadge({ tier, size = "md" }: { tier: TierResult; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "size-14 text-3xl" : size === "sm" ? "size-7 text-sm" : "size-10 text-xl";
  if (!tier.tier) {
    return (
      <div
        className={`${dims} flex shrink-0 items-center justify-center rounded-lg border border-dashed border-white/20 font-semibold text-faint`}
        title="Not rated yet"
      >
        –
      </div>
    );
  }
  const color = TIER_COLOR[tier.tier];
  const provisional = tier.rated < 4;
  return (
    <div
      className={`${dims} relative flex shrink-0 items-center justify-center rounded-lg font-bold tracking-tight`}
      style={{
        color,
        background: `color-mix(in srgb, ${color} ${provisional ? 8 : 16}%, transparent)`,
        border: `1px ${provisional ? "dashed" : "solid"} color-mix(in srgb, ${color} ${provisional ? 35 : 55}%, transparent)`,
        boxShadow: provisional ? "none" : `0 0 18px color-mix(in srgb, ${color} 30%, transparent)`,
      }}
      title={`Tier ${tier.tier} · average ${tier.average!.toFixed(2)}${provisional ? ` · ${tier.rated}/4 rated` : ""}`}
      aria-label={`Tier ${tier.tier}${provisional ? `, provisional, ${tier.rated} of 4 rated` : ""}`}
    >
      {tier.tier}
    </div>
  );
}

/** Read-only four-bar summary for cards. */
export function RatingBars({ ratings }: { ratings: Ratings }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {RATINGS.map(({ key, label }) => {
        const v = ratings[key];
        return (
          <div key={key} className="flex flex-col gap-1" title={`${label}: ${v ?? "not rated"}${v ? "/5" : ""}`}>
            <div className="flex gap-[2px]">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className="h-1 flex-1 rounded-full"
                  style={{ background: v && n <= v ? "rgb(243 245 249 / 0.8)" : "rgb(255 255 255 / 0.1)" }}
                />
              ))}
            </div>
            <span className="text-[10px] tracking-wider text-faint uppercase">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Clickable 1–5 dots. Clicking the current value clears it. */
export function RatingDots({ jobId, ratingKey, value, label }: { jobId: number; ratingKey: RatingKey; value: number | null; label: string }) {
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(value);
  const set = (n: number) =>
    start(async () => {
      const next = n === shown ? null : n;
      setShown(next);
      await setRatingAction(jobId, ratingKey, next);
    });
  return (
    <div className={`flex items-center gap-1 ${pending ? "opacity-70" : ""}`} role="group" aria-label={`${label} rating`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = shown !== null && n <= shown;
        return (
          <button
            key={n}
            type="button"
            onClick={() => set(n)}
            aria-label={`${label} ${n} of 5`}
            aria-pressed={shown === n}
            className="group flex size-8 items-center justify-center rounded-md hover:bg-white/8 md:size-6"
          >
            <span
              className="size-2.5 rounded-full transition-colors"
              style={{ background: on ? "#F3F5F9" : "rgb(255 255 255 / 0.14)", boxShadow: on ? "0 0 8px rgb(243 245 249 / 0.35)" : "none" }}
            />
          </button>
        );
      })}
      <span className="w-4 text-right font-mono text-xs text-muted">{shown ?? ""}</span>
    </div>
  );
}

/** Rating panel for the role page: four dot rows plus the tier. */
export function RatingPanel({ jobId, ratings }: { jobId: number; ratings: Ratings }) {
  const tier = tierFor(ratings);
  return (
    <div className="flex items-center gap-5">
      <div className="flex flex-1 flex-col gap-1">
        {RATINGS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-muted">{label}</span>
            <RatingDots jobId={jobId} ratingKey={key} value={ratings[key]} label={label} />
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <TierBadge tier={tier} size="lg" />
        <span className="font-mono text-xs text-faint">
          {tier.average !== null ? `avg ${tier.average.toFixed(2)}` : "unrated"}
          {tier.rated > 0 && tier.rated < 4 ? ` · ${tier.rated}/4` : ""}
        </span>
      </div>
    </div>
  );
}
