"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GridIcon, HistoryIcon, PlusIcon, PrepIcon, SettingsIcon, StepsIcon } from "./icons";

const TABS = [
  { href: "/", label: "Roles", icon: GridIcon, match: (p: string) => p === "/" || (p.startsWith("/jobs") && p !== "/jobs/new") },
  { href: "/steps", label: "Steps", icon: StepsIcon, match: (p: string) => p.startsWith("/steps") },
  { href: "/jobs/new", label: "Add", icon: PlusIcon, match: (p: string) => p === "/jobs/new" },
  { href: "/prep", label: "Prep", icon: PrepIcon, match: (p: string) => p.startsWith("/prep") },
  { href: "/changes", label: "Changes", icon: HistoryIcon, match: (p: string) => p.startsWith("/changes") },
  { href: "/settings", label: "Settings", icon: SettingsIcon, match: (p: string) => p.startsWith("/settings") },
];

/** Phone navigation: replaces the sidebar below tablet width. */
export function BottomNav() {
  const pathname = usePathname();
  if (pathname === "/unlock" || pathname === "/setup" || pathname.startsWith("/calls/")) return null;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-white/10 bg-[rgb(8_10_14/0.85)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] ${active ? "text-fg" : "text-muted"}`}
          >
            <Icon size={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
