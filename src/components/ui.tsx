import { STAGES, isParked, type Stage } from "@/lib/types";

export { Logo } from "./Logo";

export const STAGE_COLOR: Record<Stage, string> = {
  found: "#C9CED8",
  applied: "#A9B8FF",
  screening: "#8FA6FF",
  interviewing: "#6E8BFF",
  final: "#F5B454",
  offer: "#4ADE9A",
  no_reply: "#D6A283",
  later: "#B9A6FF",
  closed: "#8A91A1",
};

/** Six-segment progress bar; the current stage glows. */
export function StageBar({ stage, height = 4 }: { stage: Stage; height?: number }) {
  const idx = isParked(stage) ? -1 : STAGES.indexOf(stage as (typeof STAGES)[number]);
  return (
    <div className="flex gap-[3px]" role="img" aria-label={`Stage: ${stage}`}>
      {STAGES.map((s, i) => {
        let bg = "rgb(255 255 255 / 0.1)";
        let glow = "none";
        if (isParked(stage)) bg = stage === "later" ? "rgb(185 166 255 / 0.16)" : stage === "no_reply" ? "rgb(214 162 131 / 0.16)" : "rgb(255 255 255 / 0.07)";
        else if (i < idx) bg = "rgb(243 245 249 / 0.75)";
        else if (i === idx) {
          bg = STAGE_COLOR[s];
          glow = `0 0 10px ${STAGE_COLOR[s]}`;
        }
        return <div key={s} className="flex-1 rounded-full" style={{ height, background: bg, boxShadow: glow }} />;
      })}
    </div>
  );
}

export function LiveDot({ color = "#4ADE9A" }: { color?: string }) {
  return (
    <span
      className="inline-block size-[7px] shrink-0 rounded-full"
      style={{ background: color, boxShadow: `0 0 10px ${color}` }}
      aria-hidden="true"
    />
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-xl p-10 text-center text-sm text-muted">{children}</div>;
}
