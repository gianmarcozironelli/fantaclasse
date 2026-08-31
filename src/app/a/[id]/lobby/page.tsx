"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getAdminToken } from "@/lib/client/storage";
import { useAuctionSocket } from "@/lib/client/useAuctionSocket";
import { QR } from "@/components/QR";
import { Toasts } from "@/components/Toasts";

interface TeamInfo {
  id: string;
  name: string;
  color: string | null;
  joinCode?: string;
  connected: boolean;
  claimed: boolean;
}

export default function LobbyPage() {
  const { id } = useParams<{ id: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [auctionName, setAuctionName] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setToken(getAdminToken(id));
    setOrigin(window.location.origin);
  }, [id]);

  const { snapshot, toasts, sendCmd } = useAuctionSocket(id, token ? "admin" : "spectator", token);

  const connectedIds = new Set(
    snapshot?.teams.filter((t) => t.connected && !t.isBot).map((t) => t.id) ?? [],
  );

  useEffect(() => {
    fetch(`/api/auctions/${id}`, { headers: token ? { "x-admin-token": token } : {} })
      .then((r) => r.json())
      .then((d) => {
        setAuctionName(d.name);
        setTeams(d.teams ?? []);
      });
  }, [id, token, snapshot?.seq]);

  const connectedCount = teams.filter((t) => connectedIds.has(t.id) || t.connected).length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 text-center">
        <h1 className="font-display text-5xl font-bold uppercase">{auctionName || "…"}</h1>
        <p className="mt-2 text-xl text-ink-300">
          <span className="font-display font-bold text-pitch-400">{connectedCount}/{teams.length}</span>{" "}
          allenatori connessi · Scansiona il QR della tua squadra per entrare
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {teams.map((t) => {
          const online = connectedIds.has(t.id) || t.connected;
          return (
            <div
              key={t.id}
              className={`flex flex-col items-center rounded-lg border p-4 text-center ${online ? "border-pitch-500/60 bg-pitch-600/5" : "border-ink-700 bg-ink-850"}`}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: t.color ?? "#64748b" }} />
                <span className="font-display text-lg font-bold uppercase leading-tight">{t.name}</span>
                <span className={online ? "text-pitch-400" : "text-ink-500"}>{online ? "✓" : "○"}</span>
              </div>
              {t.joinCode ? (
                <>
                  <QR value={`${origin}/join/${t.joinCode}`} size={140} />
                  <div className="mt-2 font-display text-2xl font-bold tracking-[0.25em]">{t.joinCode}</div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${origin}/join/${t.joinCode}`);
                      setCopied(t.id);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                    className="mt-1 text-xs text-ink-400 hover:text-pitch-400"
                  >
                    {copied === t.id ? "copiato ✓" : "copia link invito"}
                  </button>
                </>
              ) : (
                <p className="text-sm text-ink-400">{online ? "Connesso" : "In attesa…"}</p>
              )}
            </div>
          );
        })}
      </div>

      {token && (
        <div className="mt-8 flex justify-center gap-3">
          {snapshot?.auction.status === "AUCTION_NOT_STARTED" && (
            <button
              onClick={() => sendCmd({ type: "start_auction" })}
              className="rounded bg-pitch-600 px-8 py-3 font-display text-2xl font-bold hover:bg-pitch-500"
            >
              INIZIA L&apos;ASTA
            </button>
          )}
          <Link
            href={`/a/${id}/admin`}
            className="rounded border border-ink-600 px-8 py-3 font-display text-2xl font-bold text-ink-100 hover:border-pitch-500"
          >
            VAI ALLA REGIA →
          </Link>
        </div>
      )}
      <Toasts toasts={toasts} />
    </main>
  );
}
