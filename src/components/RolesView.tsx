"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CardData, Tone } from "@/lib/view";
import { RATINGS, tierScore } from "@/lib/rating";
import { ArrowIcon, CalendarIcon } from "./icons";
import { RatingBars, RatingDots, TierBadge } from "./rating";
import { Logo, STAGE_COLOR, StageBar } from "./ui";

type Filter = "active" | "applied" | "first" | "interviewing" | "early" | "closed";
/** Within Closed: every finished role, or one kind of ending. */
type ClosedKind = "all" | "no_reply" | "later" | "closed";
type Sort = "next" | "latest" | "rank" | "tier" | "fit" | "ote";
type View = "cards" | "ratings";

export const ACTIVE_STAGES: string[] = ["screening", "interviewing", "final", "offer"];

const FILTERS: { id: Filter; label: string; test: (c: CardData) => boolean }[] = [
  // Active = something has happened since applying (a reply, a call, an interview).
  { id: "active", label: "Active", test: (c) => ACTIVE_STAGES.includes(c.stage) },
  { id: "applied", label: "Applied", test: (c) => c.stage === "applied" },
  { id: "first", label: "1st stage", test: (c) => c.stage === "screening" },
  { id: "interviewing", label: "Interviewing", test: (c) => ["interviewing", "final", "offer"].includes(c.stage) },
  { id: "early", label: "Early", test: (c) => c.stage === "found" },
  // Closed groups every role that's off the track: no reply, try later, closed.
  { id: "closed", label: "Closed", test: (c) => CLOSED_KINDS.some((k) => k.id !== "all" && k.id === c.stage) },
];

const CLOSED_KINDS: { id: ClosedKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "no_reply", label: "No reply" },
  { id: "later", label: "Try later" },
  { id: "closed", label: "Closed" },
];

/** Dated next steps first (soonest, so overdue rise to the top), then undated ones, then roles with nothing next. */
const nextBucket = (c: CardData) => (c.next.at ? 0 : c.next.kind ? 1 : 2);

const SORTS: { id: Sort; label: string; cmp: (a: CardData, b: CardData) => number }[] = [
  { id: "next", label: "Next step", cmp: (a, b) => nextBucket(a) - nextBucket(b) || (a.next.at ?? "").localeCompare(b.next.at ?? "") || b.stageIndex - a.stageIndex },
  { id: "latest", label: "Latest step", cmp: (a, b) => b.updatedAt.localeCompare(a.updatedAt) },
  // Unranked roles fall back to furthest-along stage, then fit.
  { id: "rank", label: "My rank", cmp: (a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.stageIndex - a.stageIndex || (b.fit ?? -1) - (a.fit ?? -1) },
  { id: "tier", label: "Tier", cmp: (a, b) => tierScore(b.tier) - tierScore(a.tier) || b.tier.rated - a.tier.rated || b.stageIndex - a.stageIndex },
  { id: "fit", label: "Fit", cmp: (a, b) => (b.fit ?? -1) - (a.fit ?? -1) },
  { id: "ote", label: "OTE", cmp: (a, b) => (b.oteK ?? -1) - (a.oteK ?? -1) },
];

/** Tab, sort and view are remembered per device (a convenience; the app works without it). */
const PREFS_KEY = "pursuit.roles.prefs";

const NEXT_STYLE: Record<Tone, string> = {
  today: "bg-accent/16 text-accent-soft",
  overdue: "bg-red/12 text-[#FFB3BA]",
  stale: "bg-amber/12 text-amber-soft",
  normal: "bg-white/5 text-fg-2",
  none: "bg-white/[0.03] text-faint",
};

const FRESH_DOT = { just: "#6E8BFF", recent: "#4ADE9A", normal: "#5B6272", stale: "#F5B454" } as const;

export function RolesView({ cards }: { cards: CardData[] }) {
  const [filter, setFilter] = useState<Filter>("active");
  const [closedKind, setClosedKind] = useState<ClosedKind>("all");
  const [sort, setSort] = useState<Sort>("next");
  const [view, setView] = useState<View>("cards");
  const [loaded, setLoaded] = useState(false);

  // Restore after mount, so the server-rendered page and the first client render match.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { filter?: string; sort?: Sort; view?: View; closedKind?: ClosedKind };
      if (saved.filter === "no_reply" || saved.filter === "later") setFilter("closed"); // older saved tabs
      else if (FILTERS.some((f) => f.id === saved.filter)) setFilter(saved.filter as Filter);
      if (CLOSED_KINDS.some((k) => k.id === saved.closedKind)) setClosedKind(saved.closedKind!);
      if (saved.sort && SORTS.some((s) => s.id === saved.sort)) setSort(saved.sort);
      if (saved.view === "cards" || saved.view === "ratings") setView(saved.view);
    } catch {
      // storage unavailable (private mode etc.): defaults are fine
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ filter, sort, view, closedKind }));
    } catch {
      // ignore
    }
  }, [filter, sort, view, closedKind, loaded]);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    const s = SORTS.find((x) => x.id === sort)!;
    return cards
      .filter(f.test)
      .filter((c) => filter !== "closed" || closedKind === "all" || c.stage === closedKind)
      .sort(s.cmp);
  }, [cards, filter, sort, closedKind]);

  return (
    <section className="flex flex-col gap-4" aria-label="Roles">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter roles" className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:w-auto md:overflow-visible md:px-0 md:pb-0">
          {FILTERS.map((f) => {
            const active = f.id === filter;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f.id)}
                className={`h-[34px] shrink-0 rounded-lg border px-3.5 text-[13px] font-medium whitespace-nowrap backdrop-blur-md transition-colors ${
                  active ? "border-fg bg-fg text-ink" : "border-white/12 bg-white/5 text-fg-2 hover:bg-white/10"
                }`}
              >
                {f.label} <span className="font-mono opacity-70">{cards.filter(f.test).length}</span>
              </button>
            );
          })}
        </div>
        <div className="hidden flex-1 md:block" />
        <div role="group" aria-label="View" className="glass flex rounded-[9px] p-[3px]">
          {(["cards", "ratings"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === view}
              onClick={() => setView(v)}
              className={`h-8 rounded-md px-3.5 text-[13px] font-medium ${v === view ? "bg-white/14 text-fg" : "text-muted hover:text-fg"}`}
            >
              {v === "cards" ? "Cards" : "Ratings"}
            </button>
          ))}
        </div>
        <span className="hidden text-[13px] text-muted md:inline">Sort</span>
        <div role="group" aria-label="Sort roles" className="glass flex max-w-full overflow-x-auto rounded-[9px] p-[3px]">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === sort}
              onClick={() => setSort(s.id)}
              className={`h-8 shrink-0 rounded-md px-3 text-[13px] font-medium md:px-3.5 ${s.id === sort ? "bg-white/14 text-fg" : "text-muted hover:text-fg"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {filter === "closed" && (
        <div role="group" aria-label="Kind of closed role" className="flex flex-wrap gap-1.5">
          {CLOSED_KINDS.map((k) => {
            const n = k.id === "all" ? cards.filter(FILTERS.find((f) => f.id === "closed")!.test).length : cards.filter((c) => c.stage === k.id).length;
            return (
              <button
                key={k.id}
                type="button"
                aria-pressed={k.id === closedKind}
                onClick={() => setClosedKind(k.id)}
                className={`chip px-3 py-1 text-xs ${k.id === closedKind ? "border-white/40 bg-white/12 text-fg" : "hover:border-white/30 hover:text-fg"}`}
              >
                {k.label} <span className="font-mono opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="glass rounded-xl p-10 text-center text-sm text-muted">No roles here.</div>
      ) : view === "ratings" ? (
        <RatingsTable cards={visible} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => (
            <RoleCard key={c.id} card={c} />
          ))}
        </div>
      )}
    </section>
  );
}

function RoleCard({ card: c }: { card: CardData }) {
  const stageColor = STAGE_COLOR[c.stage];
  return (
    <div
      className={`glass glass-hover flex flex-col rounded-xl ${c.freshness === "just" ? "glow-ring" : ""} ${
        c.stage === "closed" ? "opacity-55" : c.stage === "later" || c.stage === "no_reply" ? "opacity-80" : ""
      }`}
    >
    <Link href={`/jobs/${c.id}`} className="flex flex-col gap-3.5 p-[18px] pb-3 text-fg">
      <div className="flex items-start gap-3">
        <Logo name={c.company} color={c.color} logo={c.logo} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold tracking-tight">{c.company}</span>
          <span className="text-[13px] leading-snug text-muted">{c.title}</span>
        </div>
        <TierBadge tier={c.tier} />
      </div>

      <div className="flex flex-col gap-2">
        <StageBar stage={c.stage} />
        <div className="flex justify-between gap-2 text-xs">
          <span className="font-semibold" style={{ color: stageColor }}>
            {c.stageLabel}
          </span>
          <span className="truncate text-muted">{c.stageSub}</span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3.5 gap-y-2.5 border-y border-white/7 py-3">
        <Fact label="OTE" value={c.ote} mono />
        <Fact label="Quota" value={c.quota} mono />
        <Fact label="Segment" value={c.segment} />
        <Fact label="Team" value={c.team} />
      </dl>

      <RatingBars ratings={c.ratings} />

      {c.interview && (
        <div
          className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
            c.interview.soon ? "border-accent/50 bg-accent/14 shadow-[0_0_20px_rgb(110_139_255/0.2)]" : "border-accent/25 bg-accent/7"
          }`}
          title={c.interview.name}
        >
          <CalendarIcon size={18} className="shrink-0 text-accent-soft" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{c.interview.date}</span>
              <span className="font-mono text-sm font-semibold">{c.interview.time ?? "time TBC"}</span>
            </span>
            <span className="truncate text-xs font-semibold text-accent-soft">{c.interview.stage}</span>
          </div>
          <span className={`shrink-0 text-xs font-semibold ${c.interview.soon ? "text-fg" : "text-muted"}`}>{c.interview.day}</span>
        </div>
      )}

      {!(c.interview && c.next.at === c.interview.at) && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-medium ${NEXT_STYLE[c.next.tone]}`}>
          <ArrowIcon size={15} />
          <span className="truncate">{c.next.text}</span>
        </div>
      )}

    </Link>
      <div className="flex items-center gap-2 px-[18px] pb-3.5 text-xs text-muted">
        <span
          className="size-1.5 rounded-full"
          style={{ background: FRESH_DOT[c.freshness], boxShadow: `0 0 8px ${FRESH_DOT[c.freshness]}` }}
        />
        <span className={c.freshness === "just" ? "font-semibold text-accent-soft" : c.freshness === "stale" ? "text-amber-soft" : ""}>
          Updated {c.updated}
          {c.updatedSource ? ` · ${c.updatedSource}` : ""}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {c.rank !== null && <span className="font-mono text-fg-2">#{c.rank}</span>}
          {c.fit !== null && (
            <span>
              Fit <strong className="font-mono font-medium text-fg">{c.fit}</strong>
            </span>
          )}
          {c.stage !== "closed" && (
            <Link href={`/jobs/${c.id}?tab=prep`} className="chip px-2.5 py-1 font-medium text-accent-soft hover:border-accent/50" aria-label={`Interview prep for ${c.company}`}>
              Prep
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] tracking-wider text-faint uppercase">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono text-[15px] font-medium" : "text-sm"} ${value ? "" : "text-amber-soft"}`}>
        {value ?? "Ask"}
      </dd>
    </div>
  );
}

/** Every role's four ratings in one place, editable with a click. */
function RatingsTable({ cards }: { cards: CardData[] }) {
  return (
    <section className="glass overflow-hidden rounded-xl">
      <div className="hidden grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_90px] items-center gap-3 bg-white/4 px-5 py-3 md:grid">
        <span className="label">Role</span>
        {RATINGS.map((r) => (
          <span key={r.key} className="label">
            {r.label}
          </span>
        ))}
        <span className="label text-right">Tier</span>
      </div>
      {cards.map((c) => (
        <div
          key={c.id}
          className="grid grid-cols-2 items-center gap-x-3 gap-y-2 border-t border-white/7 px-4 py-3 first-of-type:border-t-0 md:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_90px] md:px-5 md:py-2.5 md:first-of-type:border-t"
        >
          <Link href={`/jobs/${c.id}`} className="col-span-2 flex min-w-0 items-center gap-3 text-fg hover:underline md:col-span-1">
            <Logo name={c.company} color={c.color} logo={c.logo} size={28} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">{c.company}</span>
              <span className="truncate text-xs text-muted">
                {c.stageLabel} · {c.title}
              </span>
            </span>
          </Link>
          {RATINGS.map((r) => (
            <div key={r.key} className="flex flex-col gap-0.5 md:block">
              <span className="text-[10px] tracking-wider text-faint uppercase md:hidden">{r.label}</span>
              <RatingDots jobId={c.id} ratingKey={r.key} value={c.ratings[r.key]} label={`${c.company} ${r.label}`} />
            </div>
          ))}
          <div className="col-span-2 flex items-center justify-end gap-2 md:col-span-1">
            {c.tier.rated > 0 && c.tier.rated < 4 && <span className="font-mono text-[11px] text-faint">{c.tier.rated}/4</span>}
            <TierBadge tier={c.tier} size="sm" />
          </div>
        </div>
      ))}
    </section>
  );
}
