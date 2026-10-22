"use client";

import { useState, useTransition } from "react";
import { setMailFoldersAction } from "@/lib/actions";

/** Which Outlook folders Pursuit reads. The Inbox is always on. */
export function MailFolders({ folders, chosen }: { folders: { id: string; name: string }[]; chosen: string[] }) {
  const [on, setOn] = useState(new Set(chosen));
  const [saved, setSaved] = useState(true);
  const [busy, start] = useTransition();
  const toggle = (id: string) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOn(next);
    setSaved(false);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5">
        {folders.map((f) => {
          const inbox = f.id === "inbox";
          const checked = inbox || on.has(f.id);
          return (
            <label
              key={f.id}
              className={`chip cursor-pointer px-3 py-1 text-xs ${checked ? "border-accent/50 bg-accent/12 text-fg" : "hover:border-white/30"} ${inbox ? "cursor-default" : ""}`}
            >
              <input type="checkbox" className="sr-only" checked={checked} disabled={inbox} onChange={() => toggle(f.id)} />
              {checked ? "✓ " : ""}
              {f.name}
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-faint">
          A folder you turn on is read back 30 days on the next sync. Outside the Inbox, only clearly job-related emails (roles, interviews, applications,
          recruiters) are passed to Claude.
        </p>
        {!saved && (
          <button
            type="button"
            className="btn btn-primary btn-sm shrink-0"
            disabled={busy}
            onClick={() =>
              start(async () => {
                await setMailFoldersAction([...on]);
                setSaved(true);
              })
            }
          >
            {busy ? "Saving…" : "Save folders"}
          </button>
        )}
      </div>
    </div>
  );
}
