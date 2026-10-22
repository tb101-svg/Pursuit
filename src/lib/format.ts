const LOCALE = "en-AU";
const CURRENCY = "A$";

/** 150 → "A$150k", 1200 → "A$1.2M". Amounts are stored in thousands. */
export function money(k: number | null | undefined): string | null {
  if (k === null || k === undefined) return null;
  if (k >= 1000) {
    const m = k / 1000;
    return `${CURRENCY}${Number(m.toFixed(2))}M`;
  }
  return `${CURRENCY}${Math.round(k)}k`;
}

export function ote(base: number | null, variable: number | null): number | null {
  if (base === null && variable === null) return null;
  return (base ?? 0) + (variable ?? 0);
}

export function split(base: number | null, variable: number | null): string | null {
  const total = ote(base, variable);
  if (!total || base === null || variable === null) return null;
  const b = Math.round((base / total) * 100);
  return `${b}/${100 - b}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const time = (d: Date) => d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false });

/** "today 11:30", "tomorrow 09:00", "Wed 14:00", "30 Sep". */
export function when(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days === 0) return `today ${time(d)}`;
  if (days === 1) return `tomorrow ${time(d)}`;
  if (days === -1) return `yesterday ${time(d)}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString(LOCALE, { weekday: "short" })} ${time(d)}`;
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

export function clock(iso: string | null): string | null {
  return iso ? time(new Date(iso)) : null;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { day: "2-digit", month: "short" });
}

export function relTime(iso: string, now = new Date()): string {
  const secs = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  const days = Math.floor(secs / 86_400);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return shortDate(iso);
}

export function ageDays(iso: string, now = new Date()): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** "in 7 min", "in 2h" for a future time. */
export function inTime(iso: string, now = new Date()): string {
  const secs = (new Date(iso).getTime() - now.getTime()) / 1000;
  if (secs < 60) return "in under a minute";
  if (secs < 3600) return `in ${Math.round(secs / 60)} min`;
  return `in ${Math.round(secs / 3600)}h`;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** "Wed 30 Sep" */
export function dayDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" });
}

/** "Today", "Tomorrow", "In 3 days", "Next Wed"… for an upcoming date. */
export function dayFromNow(iso: string, now = new Date()): string {
  const days = Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}
