"use client";

import { useActionState } from "react";
import { importPipelineDeskAction } from "@/lib/actions";

export function ImportForm() {
  const [message, action, pending] = useActionState(importPipelineDeskAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor="desk-file" className="sr-only">
          Pipeline Desk backup file
        </label>
        <input id="desk-file" name="file" type="file" accept="application/json,.json" className="input h-auto py-1.5 text-[13px]" />
        <button type="submit" className="btn btn-ghost shrink-0" disabled={pending}>
          {pending ? "Importing…" : "Import"}
        </button>
      </div>
      {message && <p className="text-[13px] text-fg-2">{message}</p>}
    </form>
  );
}
