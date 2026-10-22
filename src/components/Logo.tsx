"use client";

import { useState } from "react";

/**
 * Company logo, loaded straight from the company's website (Pursuit stores
 * only the address). Falls back to a letter tile if there's no logo or it
 * fails to load.
 */
export function Logo({ name, color, logo, size = 44 }: { name: string; color: string; logo?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const radius = Math.round(size * 0.23);
  const frame = {
    width: size,
    height: size,
    borderRadius: radius,
    boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.22), 0 6px 18px rgb(0 0 0 / 0.35)",
  };

  if (logo && !failed) {
    return (
      <div data-logo className="flex shrink-0 items-center justify-center overflow-hidden bg-white" style={{ ...frame, padding: Math.round(size * 0.1) }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- hot-linked on purpose; nothing is stored */}
        <img
          src={logo}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-contain"
          style={{ borderRadius: Math.round(radius * 0.6) }}
        />
      </div>
    );
  }
  return (
    <div
      data-logo
      className="flex shrink-0 items-center justify-center font-bold text-white"
      style={{ ...frame, background: color, fontSize: Math.round(size * 0.45), letterSpacing: "-0.04em" }}
      aria-hidden="true"
    >
      {name.trim()[0]?.toUpperCase()}
    </div>
  );
}
