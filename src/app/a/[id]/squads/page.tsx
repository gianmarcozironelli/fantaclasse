"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuctionSocket } from "@/lib/client/useAuctionSocket";
import type { Role } from "@/lib/domain/types";
import { RoleBadge } from "@/components/RoleBadge";
import { Toasts } from "@/components/Toasts";

interface PurchaseRow {
  id: string;
  price: number;
  team: { id: string; name: string; color: string | null };
  player: { id: string; displayName: string; teamAbbr: string; role: Role; quotation: number };
}

export default function SquadsPage() {
  const { id } = useParams<{ id: string }>();
  const { snapshot, toasts } = useAuctionSocket(id, "spectator", null);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [openTeam, setOpenTeam] = useState<string | null>(null);

  const soldCount = snapshot?.counts.sold ?? -1;
  useEffect(() => {
    fetch(`/api/auctions/${id}/purchases`)
      .then((r) => r.json())
      .then((d) => setPurchases(d.purchases ?? []));
  }, [id, soldCount]);

  const byTeam = useMemo(() => {
    const map = new Map<string, PurchaseRow[]>();
    for (const p of purchases) {
      map.set(p.team.id, [...(map.get(p.team.id) ?? []), p]);
    }
    return map;
  }, [purchases]);

  if (!snapshot) {
    return <main className="grid min-h-dvh place-items-center text-ink-300">Caricamento…</main>;
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4 flex items-center gap-3">
        <h1 className="font-display text-3xl font-bold">ROSE E CREDITI</h1>
        <Link href={`/a/${id}/board`} className="ml-auto rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:border-ink-600">
          Tabellone →
        </Link>
      </header>

      <div className="overflow-x-auto rounded-lg border border-ink-700">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-ink-850 text-left text-xs tracking-wider text-ink-400">
            <tr>
              <th className="px-3 py-2">SQUADRA</th>
              <th className="px-2 py-2 text-right">CREDITI</th>
              <th className="px-2 py-2 text-right" title="Offerta massima consentita">MAX</th>
              <th className="px-2 py-2 text-right" title="Media crediti per slot rimasto">€/SLOT</th>
              {(["P", "D", "C", "A"] as Role[]).map((r) => (
                <th key={r} className="px-2 py-2 text-center">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snapshot.teams.map((t) => (
              <tr
                key={t.id}
                onClick={() => setOpenTeam(openTeam === t.id ? null : t.id)}
                className={`cursor-pointer border-t border-ink-800 hover:bg-ink-850 ${openTeam === t.id ? "bg-ink-850" : ""}`}
              >
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color ?? "#64748b" }} />
                    {t.name}
                    {t.isLeading && <span className="text-xs text-gold-300">● in testa</span>}
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-display text-lg font-bold tabular-nums">{t.credits}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gold-300">{t.maxBid}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-300">{t.avgPerRemainingSlot ?? "—"}</td>
                {(["P", "D", "C", "A"] as Role[]).map((r) => (
                  <td key={r} className={`px-2 py-2 text-center tabular-nums ${t.roster[r].filled >= t.roster[r].max ? "text-pitch-400" : "text-ink-300"}`}>
                    {t.roster[r].filled}/{t.roster[r].max}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openTeam && (
        <SquadDetail
          team={snapshot.teams.find((t) => t.id === openTeam)!}
          purchases={byTeam.get(openTeam) ?? []}
          budget={snapshot.auction ? (snapshot.teams.find((t) => t.id === openTeam)!.credits + snapshot.teams.find((t) => t.id === openTeam)!.spent) : 0}
        />
      )}
      <Toasts toasts={toasts} />
    </main>
  );
}

function SquadDetail({ team, purchases, budget }: {
  team: { name: string; color: string | null; credits: number; spent: number; slotsRemaining: number; avgPerRemainingSlot: number | null; roster: Record<Role, { filled: number; max: number }> };
  purchases: PurchaseRow[];
  budget: number;
}) {
  const byRole: Record<Role, PurchaseRow[]> = { P: [], D: [], C: [], A: [] };
  for (const p of purchases) byRole[p.player.role].push(p);
  const spentByRole = (r: Role) => byRole[r].reduce((s, p) => s + p.price, 0);
  const avg = purchases.length ? Math.round((team.spent / purchases.length) * 10) / 10 : 0;

  return (
    <section className="mt-4 rounded-lg border border-ink-700 bg-ink-850 p-4">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="font-display text-2xl font-bold uppercase" style={{ color: team.color ?? undefined }}>
          {team.name}
        </h2>
        <span className="text-sm text-ink-300">
          Residui <b className="text-ink-100">{team.credits}</b> · Spesi <b className="text-ink-100">{team.spent}</b> / {budget} ·
          Media acquisto <b className="text-ink-100">{avg}</b> · Slot liberi <b className="text-ink-100">{team.slotsRemaining}</b>
          {team.avgPerRemainingSlot !== null && <> · Budget/slot <b className="text-ink-100">{team.avgPerRemainingSlot}</b></>}
        </span>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(["P", "D", "C", "A"] as Role[]).map((r) => (
          <div key={r}>
            <div className="mb-1.5 flex items-center gap-2 text-sm text-ink-300">
              <RoleBadge role={r} size="sm" />
              {team.roster[r].filled}/{team.roster[r].max}
              <span className="ml-auto text-xs">spesi {spentByRole(r)}</span>
            </div>
            {byRole[r]
              .sort((a, b) => b.price - a.price)
              .map((p) => (
                <div key={p.id} className="flex justify-between border-b border-ink-800 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {p.player.displayName} <span className="text-ink-500">({p.player.teamAbbr})</span>
                  </span>
                  <span className="font-display font-semibold text-gold-300">{p.price}</span>
                </div>
              ))}
            {byRole[r].length === 0 && <div className="text-xs text-ink-500">—</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
