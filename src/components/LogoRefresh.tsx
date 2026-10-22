"use client";

import { useActionState } from "react";
import { refreshLogosAction } from "@/lib/actions";

export function LogoRefresh() {
  const [message, action, pending] = useActionState(async () => refreshLogosAction(), null);
  return (
    <form action={action} className="flex items-center gap-3">
      <button type="submit" className="btn btn-ghost" disabled={pending}>
        {pending ? "Fetching logos…" : "Refresh logos"}
      </button>
      {message && <span className="text-[13px] text-fg-2">{message}</span>}
    </form>
  );
}
