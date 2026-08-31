"use client";

import { useEffect, useState } from "react";

/**
 * Deadline-based countdown: renders seconds until `closesAt` computed against
 * the server clock offset — the client never trusts its own idea of "left".
 */
export function Countdown({
  closesAt,
  serverNow,
  size = "lg",
}: {
  closesAt: string | null;
  serverNow: () => number;
  size?: "lg" | "xl";
}) {
  const [, force] = useState(0);

  useEffect(() => {
    if (!closesAt) return;
    const id = setInterval(() => force((n) => n + 1), 120);
    return () => clearInterval(id);
  }, [closesAt]);

  if (!closesAt) return null;
  const ms = new Date(closesAt).getTime() - serverNow();
  const secs = Math.max(0, Math.ceil(ms / 1000));
  const danger = secs <= 3;
  const warn = secs <= 5 && !danger;

  return (
    <div
      className={`font-display font-bold tabular-nums leading-none ${
        size === "xl" ? "text-8xl" : "text-5xl"
      } ${danger ? "text-role-a animate-timer-pulse" : warn ? "text-gold-400" : "text-ink-100"}`}
    >
      {secs}
    </div>
  );
}
