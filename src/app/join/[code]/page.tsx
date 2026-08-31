"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { setParticipantToken } from "@/lib/client/storage";

interface JoinInfo {
  auctionId: string;
  auctionName: string;
  season: string;
  teamName: string;
  color: string | null;
  pinRequired: boolean;
  alreadyClaimed: boolean;
}

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [pin, setPin] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/join/${code}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setInfo(data);
      })
      .catch((e) => setError(e.message));
  }, [code]);

  async function claim() {
    if (!info) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/join/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin || undefined, displayName: displayName || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setParticipantToken(data.auctionId, data.token);
      router.push(`/a/${data.auctionId}/play`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
      setLoading(false);
    }
  }

  if (error && !info) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <div className="font-display text-3xl font-bold text-role-a">CODICE NON VALIDO</div>
          <p className="mt-2 text-ink-300">{error}</p>
        </div>
      </main>
    );
  }
  if (!info) {
    return <main className="grid min-h-dvh place-items-center text-ink-300">Caricamento…</main>;
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-sm place-items-center px-6">
      <div className="w-full text-center">
        <div className="text-sm tracking-wider text-ink-400">{info.auctionName} · {info.season}</div>
        <div className="mt-2 flex items-center justify-center gap-2">
          <span className="h-4 w-4 rounded-full" style={{ background: info.color ?? "#64748b" }} />
          <h1 className="font-display text-4xl font-bold uppercase">{info.teamName}</h1>
        </div>
        {info.alreadyClaimed && (
          <p className="mt-3 rounded border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm text-gold-300">
            Questa squadra è già collegata a un dispositivo.
            {info.pinRequired ? " Inserisci il PIN per riprenderne il controllo." : ""}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Il tuo nome (opzionale)"
            className="h-12 rounded border border-ink-700 bg-ink-900 px-4 text-center focus:border-pitch-500 focus:outline-none"
          />
          {info.pinRequired && (
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="PIN squadra"
              inputMode="numeric"
              maxLength={4}
              className="h-12 rounded border border-ink-700 bg-ink-900 px-4 text-center font-display text-2xl tracking-[0.5em] focus:border-pitch-500 focus:outline-none"
            />
          )}
          <button
            onClick={claim}
            disabled={loading}
            className="h-14 rounded bg-pitch-600 font-display text-2xl font-bold hover:bg-pitch-500 disabled:opacity-60"
          >
            {loading ? "ENTRATA…" : "ENTRA NELL'ASTA"}
          </button>
          {error && <p className="text-sm text-role-a">{error}</p>}
        </div>
      </div>
    </main>
  );
}
