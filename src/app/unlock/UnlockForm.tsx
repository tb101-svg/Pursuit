"use client";

import { useActionState } from "react";
import { unlockAction } from "@/lib/unlock-action";

export function UnlockForm({ next }: { next: string }) {
  const [error, action, pending] = useActionState(unlockAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="passcode" className="label">
        Passcode
      </label>
      <input id="passcode" name="passcode" type="password" className="input h-12 text-base" autoFocus autoComplete="current-password" required />
      {error && <p className="text-sm text-[#FFB3BA]">{error}</p>}
      <button type="submit" className="btn btn-primary h-12 text-sm" disabled={pending}>
        {pending ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}
