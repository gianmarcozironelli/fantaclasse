"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuctionSocket } from "@/lib/client/useAuctionSocket";
import type { Role } from "@/lib/domain/types";
import { RoleBadge } from "@/components/RoleBadge";
import { Toasts } from "@/components/Toasts";

interface Row {
  id: string;
  displayName: string;
  teamName: string;
  teamAbbr: string;
  role: Role;
  quotation: number;
  fvm: number | null;
  status: "AVAILABLE" | "AUCTION" | "SOLD" | "UNSOLD";
  soldTo: { teamId: string; teamName: string; color: string | null; price: number } | null;
}

type SortKey = "name" | "quotation" | "fvm";

const STATUS_LABEL: Record<Row["status"], [string, string]> = {
  AVAILABLE: ["DISPONIBILE", "text-ink-300"],
  AUCTION: ["ALL'ASTA", "text-pitch-400 font-semibold"],
  SOLD: ["VENDUTO", "text-ink-500"],
  UNSOLD: ["INVENDUTO", "text-gold-300"],
};

export default function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const { snapshot, toasts } = useAuctionSocket(id, "spectator", null);

  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "sold">("all");
  const [sort, setSort] = useState<SortKey>("quotation");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [hideSold, setHideSold] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/auctions/${id}/players?limit=1000`)
      .then((r) => r.json())
      .then((d) => setRows(d.players ?? []));
  }, [id]);

  const soldCount = snapshot?.counts.sold ?? -1;
  const currentApId = snapshot?.current?.auctionPlayerId ?? null;
  useEffect(load, [load, soldCount, currentApId]);

  useEffect(() => {
    if (snapshot) setHideSold(snapshot.auction.hideSoldPlayers);
  }, [snapshot?.auction.hideSoldPlayers, snapshot]);

  const filtered = useMemo(() => {
    let out = rows;
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter(
        (r) =>
          r.displayName.toLowerCase().includes(needle) ||
          r.teamName.toLowerCase().includes(needle) ||
          r.teamAbbr.toLowerCase().includes(needle),
      );
    }
    if (role !== "ALL") out = out.filter((r) => r.role === role);
    if (statusFilter === "available") out = out.filter((r) => r.status === "AVAILABLE" || r.status === "UNSOLD");
    if (statusFilter === "sold") out = out.filter((r) => r.status === "SOLD");
    if (hideSold) out = out.filter((r) => r.status !== "SOLD");
    const mul = dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (sort === "name") return a.displayName.localeCompare(b.displayName) * mul;
      if (sort === "fvm") return ((a.fvm ?? -1) - (b.fvm ?? -1)) * mul;
      return (a.quotation - b.quotation) * mul;
    });
  }, [rows, q, role, statusFilter, sort, dir, hideSold]);

  function header(label: string, key: SortKey) {
    return (
      <button
        onClick={() => {
          if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
          else { setSort(key); setDir(key === "name" ? "asc" : "desc"); }
        }}
        className={`flex items-center gap-1 ${sort === key ? "text-pitch-400" : ""}`}
      >
        {label} {sort === key ? (dir === "asc" ? "↑" : "↓") : ""}
      </button>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold">TABELLONE</h1>
        {snapshot && (
          <span className="text-sm text-ink-400">
            {snapshot.counts.sold} venduti · {snapshot.counts.available} disponibili
          </span>
        )}
        <Link href={`/a/${id}/squads`} className="ml-auto rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:border-ink-600">
          Rose →
        </Link>
      </header>

      {snapshot?.current && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-pitch-500/50 bg-pitch-600/10 px-4 py-2.5">
          <RoleBadge role={snapshot.current.player.role} />
          <span className="font-display text-xl font-bold uppercase">{snapshot.current.player.displayName}</span>
          <span className="text-ink-300">{snapshot.current.player.teamAbbr}</span>
          <span className="ml-auto font-display text-3xl font-bold text-gold-300">
            {snapshot.current.currentBid ?? "—"}
          </span>
          <span className="text-sm text-ink-300">
            {snapshot.teams.find((t) => t.id === snapshot.current?.leaderTeamId)?.name ?? ""}
          </span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cerca giocatore o club…"
          className="h-10 min-w-56 flex-1 rounded border border-ink-700 bg-ink-900 px-3 focus:border-pitch-500 focus:outline-none"
        />
        {(["ALL", "P", "D", "C", "A"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`h-10 rounded border px-3 font-display font-semibold ${role === r ? "border-pitch-500 bg-pitch-600/20 text-pitch-400" : "border-ink-700 text-ink-300"}`}
          >
            {r === "ALL" ? "TUTTI" : r}
          </button>
        ))}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-10 rounded border border-ink-700 bg-ink-900 px-2 text-sm"
        >
          <option value="all">Tutti gli stati</option>
          <option value="available">Disponibili</option>
          <option value="sold">Venduti</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-300">
          <input type="checkbox" checked={hideSold} onChange={(e) => setHideSold(e.target.checked)} className="accent-emerald-500" />
          nascondi venduti
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-ink-700">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-ink-850 text-left text-xs tracking-wider text-ink-400">
            <tr>
              <th className="px-3 py-2">{header("GIOCATORE", "name")}</th>
              <th className="px-2 py-2">CLUB</th>
              <th className="px-2 py-2">R</th>
              <th className="px-2 py-2">{header("QT", "quotation")}</th>
              <th className="px-2 py-2">{header("FVM", "fvm")}</th>
              <th className="px-2 py-2">STATO</th>
              <th className="px-3 py-2">ACQUIRENTE</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const muted = r.status === "SOLD";
              return (
                <tr key={r.id} className={`border-t border-ink-800 ${muted ? "opacity-45" : ""} ${r.status === "AUCTION" ? "bg-pitch-600/10" : ""}`}>
                  <td className="px-3 py-1.5 font-medium">{r.displayName}</td>
                  <td className="px-2 py-1.5 text-ink-300">{r.teamAbbr}</td>
                  <td className="px-2 py-1.5"><RoleBadge role={r.role} size="sm" /></td>
                  <td className="px-2 py-1.5 tabular-nums">{r.quotation}</td>
                  <td className="px-2 py-1.5 tabular-nums text-ink-300">{r.fvm ?? "—"}</td>
                  <td className={`px-2 py-1.5 text-xs ${STATUS_LABEL[r.status][1]}`}>{STATUS_LABEL[r.status][0]}</td>
                  <td className="px-3 py-1.5">
                    {r.soldTo && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: r.soldTo.color ?? "#64748b" }} />
                        {r.soldTo.teamName}
                        <span className="font-display font-semibold text-gold-300">{r.soldTo.price}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-4 text-center text-ink-400">Nessun giocatore trovato.</p>}
      </div>
      <Toasts toasts={toasts} />
    </main>
  );
}
