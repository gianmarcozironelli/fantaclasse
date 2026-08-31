"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { recentAuctions, setAdminToken, RecentAuction } from "@/lib/client/storage";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [recent, setRecent] = useState<RecentAuction[]>([]);

  useEffect(() => setRecent(recentAuctions()), []);

  async function startDemo() {
    setCreatingDemo(true);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      const data = await res.json();
      setAdminToken(data.auctionId, data.adminToken);
      router.push(`/a/${data.auctionId}/admin`);
    } finally {
      setCreatingDemo(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-10 px-6 py-16">
      <header className="text-center">
        <div className="font-display text-6xl font-bold tracking-tight sm:text-7xl">
          FANTA<span className="text-pitch-400">CLASSE</span>
        </div>
        <p className="mt-3 text-lg text-ink-300">
          L&apos;asta del fantacalcio, live. Tabellone sul TV, rilanci dal telefono,
          crediti sempre giusti.
        </p>
      </header>

      <div className="grid w-full gap-4 sm:grid-cols-2">
        <Link
          href="/new"
          className="group rounded-lg border border-ink-700 bg-ink-850 p-6 transition hover:border-pitch-500/60"
        >
          <div className="font-display text-2xl font-semibold group-hover:text-pitch-400">
            CREA UN&apos;ASTA
          </div>
          <p className="mt-1 text-sm text-ink-300">
            Configura squadre, budget e regole in un minuto. Tu fai l&apos;admin.
          </p>
        </Link>
        <button
          onClick={startDemo}
          disabled={creatingDemo}
          className="group rounded-lg border border-ink-700 bg-ink-850 p-6 text-left transition hover:border-gold-400/60 disabled:opacity-60"
        >
          <div className="font-display text-2xl font-semibold group-hover:text-gold-400">
            {creatingDemo ? "CREAZIONE…" : "PROVA LA DEMO"}
          </div>
          <p className="mt-1 text-sm text-ink-300">
            8 squadre, 500 crediti, bot che rilanciano davvero. Zero setup.
          </p>
        </button>
      </div>

      <form
        className="flex w-full max-w-sm items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/join/${code.trim().toUpperCase()}`);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="CODICE SQUADRA (es. X7KP3)"
          maxLength={5}
          className="h-12 flex-1 rounded border border-ink-700 bg-ink-900 px-4 font-display text-lg tracking-[0.3em] placeholder:tracking-normal placeholder:text-ink-400 focus:border-pitch-500 focus:outline-none"
        />
        <button
          type="submit"
          className="h-12 rounded bg-pitch-600 px-5 font-display text-lg font-semibold text-white transition hover:bg-pitch-500"
        >
          ENTRA
        </button>
      </form>

      {recent.length > 0 && (
        <div className="w-full max-w-sm">
          <div className="mb-2 text-xs font-medium tracking-wider text-ink-400">
            LE TUE ASTE RECENTI
          </div>
          <div className="flex flex-col gap-1">
            {recent.map((r) => (
              <Link
                key={r.id}
                href={r.role === "admin" ? `/a/${r.id}/admin` : `/a/${r.id}/play`}
                className="rounded border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-ink-100 hover:border-ink-600"
              >
                {r.role === "admin" ? "🎛️ Regia" : "📱 Squadra"} · {r.id.slice(-6)} ·{" "}
                {new Date(r.at).toLocaleDateString("it-IT")}
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
