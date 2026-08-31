"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Role } from "@/lib/domain/types";
import { ROLE_LABELS } from "@/lib/domain/types";

interface Summary {
  auction: { id: string; name: string; status: string; startingBudget: number };
  totals: { players: number; spent: number; avgPrice: number };
  byRole: Record<Role, { count: number; total: number; avg: number; top: { name: string; price: number; team: string } | null }>;
  teams: { id: string; name: string; color: string | null; players: number; spent: number; credits: number }[];
  fun: {
    mostExpensive: { name: string; price: number; team: string; quotation: number } | null;
    biggestSpender: { name: string; spent: number } | null;
    mostCreditsLeft: { name: string; credits: number } | null;
    biggestWar: { name: string; bids: number; price: number; team: string } | null;
    biggestOverpay: { name: string; price: number; quotation: number; team: string } | null;
  };
}

export default function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    fetch(`/api/auctions/${id}/summary`)
      .then((r) => r.json())
      .then(setData);
  }, [id]);

  if (!data) return <main className="grid min-h-dvh place-items-center text-ink-300">Caricamento…</main>;

  const finished = data.auction.status === "FINISHED";

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 text-center">
        <div className="font-display text-lg text-ink-400">{data.auction.name}</div>
        <h1 className="font-display text-5xl font-bold text-pitch-400">
          {finished ? "ASTA COMPLETATA 🏆" : "RIEPILOGO ASTA"}
        </h1>
        <p className="mt-2 text-ink-300">
          {data.totals.players} giocatori acquistati · {data.totals.spent} crediti spesi · prezzo medio {data.totals.avgPrice}
        </p>
      </header>

      <div className="mb-6 flex flex-wrap justify-center gap-2">
        <a href={`/api/auctions/${id}/export?kind=rosters`} className="rounded bg-pitch-600 px-4 py-2 font-display font-semibold hover:bg-pitch-500">
          ⬇ ESPORTA ROSE (CSV)
        </a>
        <a href={`/api/auctions/${id}/export?kind=log`} className="rounded border border-ink-600 px-4 py-2 font-display font-semibold text-ink-100 hover:border-ink-500">
          ⬇ LOG RILANCI (CSV)
        </a>
        <button onClick={() => window.print()} className="rounded border border-ink-600 px-4 py-2 font-display font-semibold text-ink-100 hover:border-ink-500">
          🖨 STAMPA
        </button>
        <Link href={`/a/${id}/squads`} className="rounded border border-ink-600 px-4 py-2 font-display font-semibold text-ink-100 hover:border-ink-500">
          ROSE COMPLETE →
        </Link>
      </div>

      {/* fun stats */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.fun.mostExpensive && (
          <StatCard title="💎 PIÙ PAGATO" main={data.fun.mostExpensive.name} sub={`${data.fun.mostExpensive.price} crediti → ${data.fun.mostExpensive.team}`} />
        )}
        {data.fun.biggestSpender && (
          <StatCard title="💸 SPENDACCIONE" main={data.fun.biggestSpender.name} sub={`${data.fun.biggestSpender.spent} crediti spesi`} />
        )}
        {data.fun.mostCreditsLeft && (
          <StatCard title="🐷 PARSIMONIOSO" main={data.fun.mostCreditsLeft.name} sub={`${data.fun.mostCreditsLeft.credits} crediti avanzati`} />
        )}
        {data.fun.biggestWar && data.fun.biggestWar.bids > 0 && (
          <StatCard title="⚔️ ASTA PIÙ COMBATTUTA" main={data.fun.biggestWar.name} sub={`${data.fun.biggestWar.bids} rilanci, chiusa a ${data.fun.biggestWar.price} (${data.fun.biggestWar.team})`} />
        )}
        {data.fun.biggestOverpay && data.fun.biggestOverpay.price > data.fun.biggestOverpay.quotation && (
          <StatCard title="🔥 SOVRAPPREZZO RECORD" main={data.fun.biggestOverpay.name} sub={`pagato ${data.fun.biggestOverpay.price} vs Qt ${data.fun.biggestOverpay.quotation} (${data.fun.biggestOverpay.team})`} />
        )}
      </section>

      {/* per-role averages */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["P", "D", "C", "A"] as Role[]).map((r) => (
          <div key={r} className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-center">
            <div className="text-xs tracking-wider text-ink-400">{ROLE_LABELS[r].toUpperCase()}</div>
            <div className="font-display text-3xl font-bold">{data.byRole[r].avg}</div>
            <div className="text-xs text-ink-400">prezzo medio · {data.byRole[r].count} acquisti</div>
            {data.byRole[r].top && (
              <div className="mt-1 text-xs text-ink-300">top: {data.byRole[r].top!.name} ({data.byRole[r].top!.price})</div>
            )}
          </div>
        ))}
      </section>

      {/* teams table */}
      <section className="mt-6 overflow-x-auto rounded-lg border border-ink-700">
        <table className="w-full text-sm">
          <thead className="bg-ink-850 text-left text-xs tracking-wider text-ink-400">
            <tr>
              <th className="px-3 py-2">SQUADRA</th>
              <th className="px-2 py-2 text-right">GIOCATORI</th>
              <th className="px-2 py-2 text-right">SPESI</th>
              <th className="px-3 py-2 text-right">RESIDUI</th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map((t) => (
              <tr key={t.id} className="border-t border-ink-800">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color ?? "#64748b" }} />
                    {t.name}
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{t.players}</td>
                <td className="px-2 py-2 text-right tabular-nums">{t.spent}</td>
                <td className="px-3 py-2 text-right font-display font-bold tabular-nums text-pitch-400">{t.credits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function StatCard({ title, main, sub }: { title: string; main: string; sub: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850 p-4">
      <div className="text-xs tracking-wider text-ink-400">{title}</div>
      <div className="mt-1 font-display text-2xl font-bold">{main}</div>
      <div className="text-sm text-ink-300">{sub}</div>
    </div>
  );
}
