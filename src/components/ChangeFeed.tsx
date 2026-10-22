"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { undoAction } from "@/lib/actions";
import type { FeedItemData as FeedItem } from "@/lib/view";
import { UndoIcon } from "./icons";
import { Logo } from "./ui";

export function ChangeFeed({ items, showCompany = true }: { items: FeedItem[]; showCompany?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-muted">No changes yet.</p>;
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 border-b border-white/7 py-3 last:border-0">
          {showCompany && item.company && item.color ? (
            <Logo name={item.company} color={item.color} logo={item.logo} size={24} />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              {showCompany && item.company && item.jobId ? (
                <Link href={`/jobs/${item.jobId}`} className="font-semibold text-fg hover:underline">
                  {item.company}
                </Link>
              ) : null}
              <span className="min-w-0 truncate text-fg-2">{item.title}</span>
              <span className="chip ml-auto hidden shrink-0 sm:inline-flex">{item.source}</span>
              <span className="w-[74px] shrink-0 text-right font-mono text-xs text-faint">{item.when}</span>
            </div>
            {item.body && <p className="text-[13px] leading-relaxed whitespace-pre-line text-muted">{item.body}</p>}
            {item.href && (
              <a href={item.href} target="_blank" rel="noreferrer" className="btn-link self-start text-xs">
                {["Gmail", "Outlook", "Calendar"].includes(item.source) ? `Open in ${item.source}` : "Open source"} ↗
              </a>
            )}
            {item.kind === "job_created" && item.changes.length > 0 ? (
              <p className="text-[13px] text-muted">
                Captured: {item.changes.map((ch) => ch.label.toLowerCase()).join(", ")}
              </p>
            ) : item.changes.length > 0 && (
              <ul className="flex flex-col gap-1">
                {item.changes.map((ch) => (
                  <ChangeRow key={ch.id} change={ch} undoable={item.kind !== "undo"} />
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChangeRow({ change, undoable }: { change: FeedItem["changes"][number]; undoable: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const undone = !!change.undone_at && undoable;
  const undo = () =>
    start(async () => {
      const res = await undoAction(change.id);
      setError(res.ok ? null : res.reason);
    });
  return (
    <li className="flex items-center gap-2 text-[13px]">
      <span className="w-[92px] shrink-0 text-faint md:w-[130px]">{change.label}</span>
      <span className={`min-w-0 truncate font-mono ${undone ? "text-faint line-through" : ""}`}>
        {change.from !== null && <span className="text-faint">{change.from} → </span>}
        <span className={undone ? "" : "text-fg"}>{change.to ?? "cleared"}</span>
      </span>
      {undoable && !undone && (
        <button type="button" onClick={undo} disabled={pending} className="btn-link ml-auto inline-flex shrink-0 items-center gap-1 text-xs">
          <UndoIcon size={13} />
          Undo
        </button>
      )}
      {undone && <span className="ml-auto text-xs text-faint">Undone</span>}
      {error && <span className="text-xs text-amber-soft">{error}</span>}
    </li>
  );
}
