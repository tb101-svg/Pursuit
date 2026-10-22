"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Listens for data changes from the server and re-renders the current page,
 * so every open tab stays current (including changes made by background sync).
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/stream");
    source.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    };
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [router]);
  return null;
}
