"use client";

import { useFormStatus } from "react-dom";

/** A submit button that shows what's happening while its form's action runs (Claude calls can take a minute). */
export function SubmitButton({ children, pending, className = "btn btn-primary" }: { children: React.ReactNode; pending: string; className?: string }) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} disabled={status.pending} aria-busy={status.pending}>
      {status.pending ? pending : children}
    </button>
  );
}
