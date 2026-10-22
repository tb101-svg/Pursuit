import "server-only";
import { all, get, run } from "./db";
import { notify } from "./bus";

/**
 * Company logos, hot-linked from the company's own website: Pursuit stores
 * only the image's address, and your browser loads it from their site.
 * Preference: apple-touch-icon (a clean ~180px square) > SVG icon > largest
 * declared icon > /apple-touch-icon.png > /favicon.ico.
 */

const TIMEOUT_MS = 8_000;
const RECHECK_DAYS = 14;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": UA, ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}

interface Candidate {
  url: string;
  score: number;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(1).find(Boolean) ?? null;

function candidatesFrom(html: string, base: string): Candidate[] {
  const out: Candidate[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || href.startsWith("data:") || !/\bicon\b|apple-touch-icon/.test(rel)) continue;
    let url: string;
    try {
      url = new URL(href, base).toString();
    } catch {
      continue;
    }
    const size = Math.max(0, ...(attr(tag, "sizes") ?? "").split(/\s+/).map((s) => Number(s.split("x")[0]) || 0));
    const type = (attr(tag, "type") ?? "").toLowerCase();
    let score = size || 16;
    if (rel.includes("apple-touch-icon")) score = 1000 + (size || 180);
    else if (type.includes("svg") || /\.svg(\?|$)/i.test(url)) score = 900;
    if (rel.includes("mask-icon")) score = 10; // single-colour silhouettes look wrong on a tile
    out.push({ url, score });
  }
  const origin = new URL(base).origin;
  out.push({ url: `${origin}/apple-touch-icon.png`, score: 5 }, { url: `${origin}/favicon.ico`, score: 1 });
  return out.sort((a, b) => b.score - a.score);
}

async function isImage(url: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url);
    const type = res.headers.get("content-type") ?? "";
    const ok = res.ok && (type.startsWith("image/") || /\.ico(\?|$)/i.test(url));
    await res.body?.cancel().catch(() => {});
    return ok;
  } catch {
    return false;
  }
}

/** The best logo address for a website, or null if none could be found. */
export async function findLogo(domain: string): Promise<string | null> {
  for (const start of [`https://${domain}`, `https://www.${domain}`]) {
    let html = "";
    let base = start;
    try {
      const res = await fetchWithTimeout(start, { headers: { Accept: "text/html" } });
      base = res.url || start;
      if (res.ok && (res.headers.get("content-type") ?? "").includes("html")) html = (await res.text()).slice(0, 600_000);
      else await res.body?.cancel().catch(() => {});
    } catch {
      continue;
    }
    for (const c of candidatesFrom(html, base).slice(0, 6)) {
      if (await isImage(c.url)) return c.url;
    }
  }
  // Some sites block automated requests but serve your browser fine: link the
  // standard favicon unchecked. If it doesn't load, the tile shows the letter.
  return `https://${domain}/favicon.ico`;
}

async function refreshOne(company: { id: number; domain: string }) {
  const url = await findLogo(company.domain);
  run("UPDATE companies SET logo_url = ?, logo_checked_at = ? WHERE id = ?", url, new Date().toISOString(), company.id);
  return url;
}

export async function refreshCompanyLogo(companyId: number) {
  const c = get<{ id: number; domain: string | null }>("SELECT id, domain FROM companies WHERE id = ?", companyId);
  if (!c?.domain) return null;
  const url = await refreshOne({ id: c.id, domain: c.domain });
  notify(null);
  return url;
}

/**
 * Finds logos for companies that have a website but no logo yet (skipping
 * ones checked recently). `force` re-checks everything.
 */
export async function refreshLogos(opts: { force?: boolean; limit?: number } = {}) {
  const cutoff = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const rows = opts.force
    ? all<{ id: number; domain: string }>("SELECT id, domain FROM companies WHERE domain IS NOT NULL")
    : all<{ id: number; domain: string }>(
        "SELECT id, domain FROM companies WHERE domain IS NOT NULL AND logo_url IS NULL AND (logo_checked_at IS NULL OR logo_checked_at < ?)",
        cutoff,
      );
  const todo = rows.slice(0, opts.limit ?? rows.length);
  let found = 0;
  // A few at a time: quick, without hammering anyone.
  for (let i = 0; i < todo.length; i += 4) {
    const batch = await Promise.all(todo.slice(i, i + 4).map((c) => refreshOne(c).catch(() => null)));
    found += batch.filter(Boolean).length;
    notify(null);
  }
  return { checked: todo.length, found };
}
