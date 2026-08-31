"use client";

import type { ConnState } from "@/lib/client/useAuctionSocket";

const LABELS: Record<ConnState, [string, string]> = {
  connecting: ["CONNESSIONE…", "bg-gold-400"],
  online: ["ONLINE", "bg-pitch-500"],
  reconnecting: ["RICONNESSIONE…", "bg-gold-400 animate-timer-pulse"],
  offline: ["OFFLINE", "bg-role-a"],
};

export function ConnBadge({ state }: { state: ConnState }) {
  const [label, dot] = LABELS[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-ink-300">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
