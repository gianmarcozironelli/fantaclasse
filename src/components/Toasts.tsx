"use client";

import { useEffect, useState } from "react";
import type { Toast } from "@/lib/protocol";

const COLORS: Record<string, string> = {
  SOLD: "border-pitch-500/50 text-pitch-400",
  UNSOLD: "border-ink-600 text-ink-300",
  PASS: "border-ink-600 text-ink-300",
  UNDO: "border-gold-400/50 text-gold-300",
  EDIT: "border-gold-400/50 text-gold-300",
  AUCTION_FINISHED: "border-pitch-500/50 text-pitch-400",
  PAUSED: "border-gold-400/50 text-gold-300",
};

/** Bottom-corner event feed (last few toasts, auto-expiring). */
export function Toasts({ toasts }: { toasts: Toast[] }) {
  const [visible, setVisible] = useState<Toast[]>([]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    setVisible((v) => [...v.slice(-3), latest]);
    const id = setTimeout(() => {
      setVisible((v) => v.filter((t) => t !== latest));
    }, 4200);
    return () => clearTimeout(id);
  }, [toasts]);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {visible.map((t, i) => (
        <div
          key={`${t.at}-${i}`}
          className={`animate-toast-in rounded border bg-ink-900/95 px-3 py-2 text-sm shadow-xl backdrop-blur ${
            COLORS[t.type] ?? "border-ink-600 text-ink-100"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
