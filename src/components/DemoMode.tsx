"use client";

import { useEffect, useState } from "react";

/**
 * Demo mode, for screen-sharing Pursuit in an interview: company names,
 * website names and the people you've met are replaced with ▇▇▇ bars
 * everywhere on the page (cards, job ads, research, timelines), logos and
 * free-text notes are blurred, and emails are hidden. Titles, stages, comp
 * and ratings stay visible.
 *
 * It's per device (remembered in this browser). The page stays hidden until
 * the first pass is done, so names never flash on screen.
 */

const KEY = "pursuit.demo";
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Runs before the page paints (see layout): hides the page until names are redacted. */
export const DEMO_BOOT_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="on")document.documentElement.dataset.demo="on"}catch(e){}`;

const isOn = () => document.documentElement.dataset.demo === "on";

function setMode(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage blocked: the mode still applies until the page reloads
  }
  if (on) {
    document.documentElement.dataset.demo = "on";
    window.dispatchEvent(new Event("pursuit:demo"));
  } else {
    // Names were replaced in place, so a reload is the clean way to bring them back.
    delete document.documentElement.dataset.demo;
    location.reload();
  }
}

const bar = (match: string) => "▇".repeat(Math.min(Math.max(match.length, 3), 8));

function buildPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

function redactText(value: string, pattern: RegExp | null): string {
  let out = value.replace(EMAIL, "▇▇▇@▇▇▇");
  if (pattern) out = out.replace(pattern, bar);
  return out;
}

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

function redactTree(root: Node, pattern: RegExp | null) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null = root;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && !SKIP.has(parent.tagName) && !parent.closest("[data-demo-keep]")) {
        const next = redactText(node.nodeValue ?? "", pattern);
        if (next !== node.nodeValue) node.nodeValue = next;
      }
    } else if (node instanceof Element) {
      const title = node.getAttribute("title");
      if (title) {
        const next = redactText(title, pattern);
        if (next !== title) node.setAttribute("title", next);
      }
    }
    node = walker.nextNode();
  }
}

/** Mounted once in the layout: applies demo mode, shows the banner, handles Ctrl+Shift+H. */
export function DemoMode({ terms }: { terms: string[] }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const pattern = buildPattern(terms);
    let observer: MutationObserver | null = null;
    const apply = () => {
      if (!isOn()) return;
      setOn(true);
      redactTree(document.body, pattern);
      document.documentElement.dataset.demoReady = "on";
      observer ??= new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "characterData") redactTree(m.target, pattern);
          else if (m.type === "attributes") redactTree(m.target, pattern);
          else m.addedNodes.forEach((n) => redactTree(n, pattern));
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["title"] });
    };
    apply();
    window.addEventListener("pursuit:demo", apply);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setMode(!isOn());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      observer?.disconnect();
      window.removeEventListener("pursuit:demo", apply);
      window.removeEventListener("keydown", onKey);
    };
  }, [terms]);

  if (!on) return null;
  return (
    <div
      data-demo-keep
      role="status"
      className="sticky top-0 z-30 flex items-center justify-center gap-3 border-b border-amber/30 bg-[rgb(40_30_10/0.85)] px-4 py-1.5 text-[13px] text-amber-soft backdrop-blur-md"
    >
      <span className="size-1.5 rounded-full bg-amber shadow-[0_0_8px_#F5B454]" aria-hidden="true" />
      Demo mode: company names, people and logos are hidden
      <button type="button" className="btn-link text-[13px] text-amber-soft underline" onClick={() => setMode(false)}>
        Turn off
      </button>
    </div>
  );
}

/** The switch (sidebar). */
export function DemoToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(isOn());
    const sync = () => setOn(isOn());
    window.addEventListener("pursuit:demo", sync);
    return () => window.removeEventListener("pursuit:demo", sync);
  }, []);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-demo-keep
      onClick={() => setMode(!on)}
      title="Hide company names, people and logos for screen sharing (Ctrl+Shift+H)"
      className={`flex h-9 items-center gap-2.5 rounded-lg border px-2.5 text-[13px] transition-colors ${
        on ? "border-amber/40 bg-amber/12 text-amber-soft" : "border-white/10 bg-white/4 text-[#B4BBC8] hover:bg-white/8"
      }`}
    >
      <span className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? "bg-amber/70" : "bg-white/15"}`} aria-hidden="true">
        <span className={`absolute top-[2px] size-[14px] rounded-full bg-white transition-all ${on ? "left-4" : "left-[2px]"}`} />
      </span>
      Demo mode
      <span className="ml-auto font-mono text-[10px] text-faint">⌃⇧H</span>
    </button>
  );
}
