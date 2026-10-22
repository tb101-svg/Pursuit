"use client";

import { useTransition } from "react";
import { syncNowAction } from "@/lib/actions";

export function SyncButton({ disabled, running }: { disabled?: boolean; running?: boolean }) {
  const [pending, start] = useTransition();
  const busy = pending || running;
  return (
    <button type="button" className="btn btn-primary" disabled={disabled || busy} onClick={() => start(() => syncNowAction())}>
      {busy ? "Syncing…" : "Sync now"}
    </button>
  );
}
