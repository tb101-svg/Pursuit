"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SourceStatus } from "@/lib/types";
import { GridIcon, HistoryIcon, PrepIcon, SettingsIcon, StepsIcon } from "./icons";
import { LiveDot } from "./ui";
import { DemoToggle } from "./DemoMode";

const NAV = [
  { href: "/", label: "Roles", icon: GridIcon, match: (p: string) => p === "/" || p.startsWith("/jobs") },
  { href: "/steps", label: "Next steps", icon: StepsIcon, match: (p: string) => p.startsWith("/steps") },
  { href: "/prep", label: "Prep library", icon: PrepIcon, match: (p: string) => p.startsWith("/prep") },
  { href: "/changes", label: "Changes", icon: HistoryIcon, match: (p: string) => p.startsWith("/changes") },
  { href: "/settings", label: "Settings", icon: SettingsIcon, match: (p: string) => p.startsWith("/settings") },
];

const STATUS_COLOR = { connected: "#4ADE9A", error: "#FF7A85", not_connected: "#5B6272" } as const;

export function Sidebar({
  sources,
  dueSteps = 0,
  user,
}: {
  sources: (SourceStatus & { lastSync: string | null })[];
  dueSteps?: number;
  user: { name: string; initials: string };
}) {
  const pathname = usePathname();
  if (pathname === "/unlock" || pathname === "/setup" || pathname.startsWith("/calls/")) return null;
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-10 hidden h-screen w-[232px] shrink-0 flex-col md:flex gap-7 border-r border-white/8 bg-[rgb(8_10_14/0.55)] px-3.5 py-5 backdrop-blur-xl"
    >
      <Link href="/" className="flex items-center px-2 py-1" aria-label="Pursuit home">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
        <img src="/brand/pursuit-lockup-dark.svg" alt="Pursuit" width={123} height={34} className="h-[34px] w-auto" />
      </Link>

      <DemoToggle />

      <div className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${
                active ? "bg-white/10 font-medium text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]" : "text-[#B4BBC8] hover:bg-white/5"
              }`}
            >
              <Icon />
              {label}
              {href === "/steps" && dueSteps > 0 && (
                <span className="ml-auto rounded-full bg-[#FF7A85]/20 px-2 py-px font-mono text-xs font-semibold text-[#FFB3BA]" title="Due today or overdue">
                  {dueSteps}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="glass flex flex-col gap-2.5 rounded-[10px] px-3 py-3.5">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <LiveDot />
          Sources
        </div>
        {sources.map((s) => (
          <div key={s.name} className="flex items-center justify-between gap-2 text-xs text-[#C9CED8]">
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[s.status] }} />
              {s.label}
            </span>
            <span className="font-mono text-faint">
              {s.status === "connected" ? (s.lastSync ?? "—") : s.status === "error" ? "error" : ["outlook", "outlook_calendar", "imap", "gmail", "calendar"].includes(s.name) ? "off" : "soon"}
            </span>
          </div>
        ))}
      </div>

      <div className="flex-1" />
      <div className="flex items-center gap-2.5 border-t border-white/8 p-2.5">
        <div className="flex size-8 items-center justify-center rounded-full border border-white/14 bg-white/10 text-xs font-semibold">{user.initials}</div>
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">{user.name || "Your profile"}</span>
          <span className="text-xs text-faint">Local · this computer</span>
        </div>
      </div>
    </nav>
  );
}
