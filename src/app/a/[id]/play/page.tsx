"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getParticipantToken, rememberAuction } from "@/lib/client/storage";
import { useAuctionSocket } from "@/lib/client/useAuctionSocket";
import type { Role } from "@/lib/domain/types";
import { RoleBadge } from "@/components/RoleBadge";
import { Countdown } from "@/components/Countdown";
import { ConnBadge } from "@/components/ConnBadge";

type Tab = "asta" | "obiettivi" | "rosa";

interface WatchRow {
  playerId: string;
  priority: number;
  targetPrice: number | null;
  maxPrice: number | null;
  notes: string | null;
  player: { id: string; displayName: string; teamAbbr: string; role: Role; quotation: number };
}

interface PurchaseRow {
  id: string;
  price: number;
  team: { id: string };
  player: { id: string; displayName: string; teamAbbr: string; role: Role };
}

export default function PlayPage() {
  const { id } = useParams<{ id: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const t = getParticipantToken(id);
    setToken(t);
    setChecked(true);
    if (t) rememberAuction(id, "player");
  }, [id]);

  const { snapshot, privateState, connState, authError, sendCmd, serverNow } =
    useAuctionSocket(id, "participant", token);

  const [tab, setTab] = useState<Tab>("asta");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [pendingBid, setPendingBid] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [watchlist, setWatchlist] = useState<WatchRow[]>([]);
  const [myPurchases, setMyPurchases] = useState<PurchaseRow[]>([]);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myTeamId = privateState?.teamId ?? null;
  const me = useMemo(
    () => snapshot?.teams.find((t) => t.id === myTeamId) ?? null,
    [snapshot, myTeamId],
  );
  const current = snapshot?.current ?? null;
  const status = snapshot?.auction.status;
  const bidding = status === "PLAYER_ACTIVE" || status === "PLAYER_CLOSING";

  const flash = useCallback((kind: "ok" | "err", msg: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback({ kind, msg });
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2600);
  }, []);

  const loadWatchlist = useCallback(() => {
    if (!token) return;
    fetch(`/api/auctions/${id}/watchlist`, { headers: { "x-participant-token": token } })
      .then((r) => (r.ok ? r.json() : { watchlist: [] }))
      .then((d) => setWatchlist(d.watchlist ?? []));
  }, [id, token]);

  useEffect(loadWatchlist, [loadWatchlist]);

  const soldCount = snapshot?.counts.sold ?? 0;
  useEffect(() => {
    if (!myTeamId) return;
    fetch(`/api/auctions/${id}/purchases`)
      .then((r) => r.json())
      .then((d) =>
        setMyPurchases(
          (d.purchases ?? []).filter((p: PurchaseRow) => p.team.id === myTeamId),
        ),
      );
  }, [id, myTeamId, soldCount]);

  // clear the optimistic bid whenever the authoritative state moves
  useEffect(() => {
    setPendingBid(null);
  }, [current?.currentBid, current?.auctionPlayerId]);

  async function bid(amount: number) {
    if (!bidding || !current) return;
    setPendingBid(amount);
    const ack = await sendCmd({ type: "bid", amount });
    if (!ack.ok) {
      setPendingBid(null);
      flash("err", ack.message);
      if (navigator.vibrate) navigator.vibrate(80);
    }
  }

  async function pass() {
    const ack = await sendCmd({ type: "pass" });
    if (!ack.ok) flash("err", ack.message);
  }

  // ------------------------------------------------------------------ guards
  if (!checked) return null;
  if (!token || authError === "unauthorized") {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="font-display text-3xl font-bold">SEI FUORI DALL&apos;ASTA</h1>
          <p className="mt-2 text-ink-300">
            Scansiona di nuovo il QR della tua squadra o inserisci il codice dalla{" "}
            <Link href="/" className="text-pitch-400 underline">home</Link>.
          </p>
        </div>
      </main>
    );
  }
  if (!snapshot || !me) {
    return <main className="grid min-h-dvh place-items-center text-ink-300">Connessione…</main>;
  }

  const displayBid = pendingBid ?? current?.currentBid ?? null;
  const leader = current?.leaderTeamId
    ? snapshot.teams.find((t) => t.id === current.leaderTeamId)
    : null;
  const iAmLeading = current?.leaderTeamId === myTeamId && pendingBid === null;
  const iPassed = myTeamId !== null && (current?.passedTeamIds.includes(myTeamId) ?? false);
  const watchTarget = current ? watchlist.find((w) => w.playerId === current.player.id) : null;
  const base = displayBid ?? snapshot.auction.minBid - snapshot.auction.minIncrement;
  const myTurnToNominate =
    snapshot.nominationTurnTeamId === myTeamId && status === "PLAYER_SELECTION";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      {/* header */}
      <header className="flex items-center gap-2 border-b border-ink-700 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full" style={{ background: me.color ?? "#64748b" }} />
        <span className="min-w-0 flex-1 truncate font-display text-lg font-bold uppercase">{me.name}</span>
        <ConnBadge state={connState} />
      </header>

      {/* my numbers strip */}
      <div className="grid grid-cols-3 gap-px border-b border-ink-700 bg-ink-700 text-center">
        <div className="bg-ink-900 py-2">
          <div className="text-[10px] tracking-wider text-ink-400">CREDITI</div>
          <div className="font-display text-2xl font-bold tabular-nums">{me.credits}</div>
        </div>
        <div className="bg-ink-900 py-2">
          <div className="text-[10px] tracking-wider text-ink-400">OFFERTA MAX</div>
          <div className="font-display text-2xl font-bold tabular-nums text-gold-300">{me.maxBid}</div>
        </div>
        <div className="bg-ink-900 py-2">
          <div className="text-[10px] tracking-wider text-ink-400">SLOT LIBERI</div>
          <div className="font-display text-2xl font-bold tabular-nums">{me.slotsRemaining}</div>
        </div>
      </div>
      <div className="flex justify-center gap-3 border-b border-ink-700 py-1.5 text-xs tabular-nums text-ink-300">
        {(["P", "D", "C", "A"] as Role[]).map((r) => (
          <span key={r} className={me.roster[r].filled >= me.roster[r].max ? "text-pitch-400" : ""}>
            {r} {me.roster[r].filled}/{me.roster[r].max}
          </span>
        ))}
      </div>

      {/* main area */}
      <main className="flex flex-1 flex-col overflow-y-auto p-4">
        {tab === "asta" && (
          <>
            {current ? (
              <>
                {/* current player */}
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2">
                    <RoleBadge role={current.player.role} />
                    <span className="font-display text-3xl font-bold uppercase leading-tight">
                      {current.player.displayName}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm text-ink-300">
                    {current.player.teamName} · Qt {current.player.quotation}
                  </div>
                </div>

                {watchTarget && (
                  <div className="mt-2 rounded border border-gold-400/50 bg-gold-400/10 px-3 py-1.5 text-center text-sm text-gold-300">
                    ⭐ IL TUO OBIETTIVO — target {watchTarget.targetPrice ?? "—"} · max {watchTarget.maxPrice ?? "—"}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-center gap-6">
                  <div className="text-center">
                    <div className="text-[10px] tracking-wider text-ink-400">OFFERTA</div>
                    <div
                      key={displayBid ?? 0}
                      className={`animate-bid-pop font-display text-7xl font-bold leading-none ${pendingBid !== null ? "text-ink-300" : "text-gold-300"}`}
                    >
                      {displayBid ?? "—"}
                    </div>
                  </div>
                  {snapshot.auction.timerEnabled && bidding && (
                    <Countdown closesAt={current.closesAt} serverNow={serverNow} size="lg" />
                  )}
                </div>
                <div className="mt-1 text-center font-display text-lg" style={{ color: leader?.color ?? undefined }}>
                  {current.status === "SOLD"
                    ? `VENDUTO a ${snapshot.teams.find((t) => t.id === current.soldToTeamId)?.name ?? ""} per ${current.soldPrice}`
                    : current.status === "UNSOLD"
                      ? "INVENDUTO"
                      : iAmLeading
                        ? "SEI IN TESTA! 🥇"
                        : leader
                          ? `In testa: ${leader.name}`
                          : "Nessuna offerta"}
                </div>

                {/* bid controls */}
                {bidding && !iPassed && (
                  <div className="mt-auto pt-5">
                    <div className="grid grid-cols-3 gap-2">
                      {[1, 5, 10].map((inc) => {
                        const amount =
                          current.currentBid === null
                            ? Math.max(snapshot.auction.minBid, inc)
                            : base + inc;
                        const disabled = iAmLeading || amount > me.maxBid;
                        return (
                          <button
                            key={inc}
                            onClick={() => bid(amount)}
                            disabled={disabled}
                            className="h-20 rounded-lg bg-pitch-600 font-display text-3xl font-bold active:scale-95 active:bg-pitch-500 disabled:bg-ink-800 disabled:text-ink-400"
                          >
                            +{inc}
                            <div className="text-xs font-normal opacity-80">→ {amount}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => { setCustomOpen(true); setCustomValue(String(base + snapshot.auction.minIncrement)); }}
                        disabled={iAmLeading}
                        className="h-14 rounded-lg border border-ink-600 font-display text-xl font-semibold text-ink-100 active:scale-95 disabled:opacity-40"
                      >
                        OFFERTA LIBERA
                      </button>
                      <button
                        onClick={pass}
                        disabled={!snapshot.auction.passEnabled || iAmLeading}
                        className="h-14 rounded-lg border border-role-a/50 font-display text-xl font-semibold text-role-a active:scale-95 disabled:opacity-40"
                      >
                        PASSO
                      </button>
                    </div>
                  </div>
                )}
                {iPassed && bidding && (
                  <div className="mt-auto rounded-lg border border-ink-700 bg-ink-850 py-6 text-center font-display text-2xl font-bold text-ink-400">
                    HAI PASSATO
                  </div>
                )}
              </>
            ) : (
              <div className="my-auto text-center text-ink-300">
                {status === "PAUSED" ? (
                  <div className="font-display text-3xl font-bold text-gold-300">PAUSA ⏸</div>
                ) : status === "FINISHED" ? (
                  <>
                    <div className="font-display text-3xl font-bold text-pitch-400">ASTA TERMINATA</div>
                    <Link href={`/a/${id}/summary`} className="mt-2 inline-block text-pitch-400 underline">
                      Vedi il riepilogo
                    </Link>
                  </>
                ) : myTurnToNominate ? (
                  <NominatePanel auctionId={id} onNominate={async (playerId) => {
                    const ack = await sendCmd({ type: "nominate", playerId });
                    if (!ack.ok) flash("err", ack.message);
                  }} />
                ) : (
                  <>
                    <div className="font-display text-2xl font-bold">IN ATTESA…</div>
                    <p className="mt-1 text-sm">Il prossimo giocatore sta per essere chiamato.</p>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {tab === "obiettivi" && (
          <WatchlistPanel
            auctionId={id}
            token={token}
            watchlist={watchlist}
            reload={loadWatchlist}
            flash={flash}
          />
        )}

        {tab === "rosa" && <MySquad me={me} purchases={myPurchases} budget={snapshot.auction ? me.credits + me.spent : 0} />}
      </main>

      {/* feedback */}
      {feedback && (
        <div
          className={`pointer-events-none fixed inset-x-4 bottom-24 z-50 rounded-lg border px-4 py-3 text-center font-semibold shadow-xl backdrop-blur ${
            feedback.kind === "err"
              ? "border-role-a/60 bg-role-a/15 text-role-a"
              : "border-pitch-500/60 bg-pitch-600/15 text-pitch-400"
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* custom bid sheet */}
      {customOpen && current && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={() => setCustomOpen(false)}>
          <div className="w-full rounded-t-2xl border-t border-ink-600 bg-ink-850 p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-center text-sm text-ink-300">
              Offerta libera per <span className="font-semibold text-ink-100">{current.player.displayName}</span> (max {me.maxBid})
            </div>
            <input
              type="number"
              inputMode="numeric"
              autoFocus
              value={customValue}
              min={base + snapshot.auction.minIncrement}
              max={me.maxBid}
              onChange={(e) => setCustomValue(e.target.value)}
              className="h-16 w-full rounded border border-ink-600 bg-ink-900 text-center font-display text-5xl font-bold text-gold-300 focus:border-pitch-500 focus:outline-none"
            />
            <button
              onClick={() => {
                const v = Number(customValue);
                setCustomOpen(false);
                if (v > 0) bid(Math.round(v));
              }}
              className="mt-3 h-14 w-full rounded-lg bg-pitch-600 font-display text-2xl font-bold active:bg-pitch-500"
            >
              OFFRI {customValue || "…"}
            </button>
          </div>
        </div>
      )}

      {/* tab bar */}
      <nav className="grid grid-cols-3 border-t border-ink-700 bg-ink-900">
        {(
          [
            ["asta", "🔨 Asta"],
            ["obiettivi", "⭐ Obiettivi"],
            ["rosa", "👥 La mia rosa"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 font-display text-sm font-semibold ${tab === t ? "text-pitch-400" : "text-ink-400"}`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ------------------------------------------------------------- sub-panels

function NominatePanel({ auctionId, onNominate }: { auctionId: string; onNominate: (playerId: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; displayName: string; teamAbbr: string; role: Role; quotation: number }[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/auctions/${auctionId}/players?status=available&limit=15&sort=${q ? "name" : "quotation"}${q ? `&q=${encodeURIComponent(q)}&dir=asc` : ""}`)
        .then((r) => r.json())
        .then((d) => setRows(d.players ?? []));
    }, 200);
    return () => clearTimeout(t);
  }, [q, auctionId]);

  return (
    <div className="w-full text-left">
      <div className="text-center font-display text-2xl font-bold text-pitch-400">TOCCA A TE NOMINARE 📣</div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cerca il giocatore da chiamare…"
        className="mt-3 h-12 w-full rounded border border-ink-700 bg-ink-900 px-4 focus:border-pitch-500 focus:outline-none"
      />
      <div className="mt-2 flex flex-col gap-1">
        {rows.map((p) => (
          <button
            key={p.id}
            onClick={() => onNominate(p.id)}
            className="flex items-center gap-2 rounded border border-ink-700 bg-ink-850 px-3 py-2.5 text-left active:border-pitch-500"
          >
            <RoleBadge role={p.role} size="sm" />
            <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
            <span className="text-sm text-ink-400">{p.teamAbbr} · Qt {p.quotation}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WatchlistPanel({ auctionId, token, watchlist, reload, flash }: {
  auctionId: string;
  token: string;
  watchlist: WatchRow[];
  reload: () => void;
  flash: (kind: "ok" | "err", msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; displayName: string; teamAbbr: string; role: Role; quotation: number }[]>([]);

  useEffect(() => {
    if (!q) { setRows([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/auctions/${auctionId}/players?q=${encodeURIComponent(q)}&limit=8&sort=name&dir=asc`)
        .then((r) => r.json())
        .then((d) => setRows(d.players ?? []));
    }, 200);
    return () => clearTimeout(t);
  }, [q, auctionId]);

  async function save(playerId: string, patch: Partial<WatchRow>) {
    const existing = watchlist.find((w) => w.playerId === playerId);
    const res = await fetch(`/api/auctions/${auctionId}/watchlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-participant-token": token },
      body: JSON.stringify({
        playerId,
        priority: patch.priority ?? existing?.priority ?? 3,
        targetPrice: patch.targetPrice !== undefined ? patch.targetPrice : existing?.targetPrice ?? null,
        maxPrice: patch.maxPrice !== undefined ? patch.maxPrice : existing?.maxPrice ?? null,
        notes: patch.notes !== undefined ? patch.notes : existing?.notes ?? null,
      }),
    });
    if (!res.ok) flash("err", "Errore nel salvataggio");
    reload();
  }

  async function remove(playerId: string) {
    await fetch(`/api/auctions/${auctionId}/watchlist?playerId=${playerId}`, {
      method: "DELETE",
      headers: { "x-participant-token": token },
    });
    reload();
  }

  return (
    <div>
      <p className="mb-2 text-xs text-ink-400">
        I tuoi obiettivi sono privati: nessun altro può vederli. 🤫
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Aggiungi un giocatore…"
        className="h-11 w-full rounded border border-ink-700 bg-ink-900 px-3 focus:border-pitch-500 focus:outline-none"
      />
      {rows.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          {rows.map((p) => (
            <button
              key={p.id}
              onClick={() => { save(p.id, {}); setQ(""); }}
              className="flex items-center gap-2 rounded border border-ink-700 bg-ink-850 px-3 py-2 text-left text-sm"
            >
              <RoleBadge role={p.role} size="sm" />
              <span className="flex-1">{p.displayName}</span>
              <span className="text-ink-400">{p.teamAbbr}</span>
              <span className="text-pitch-400">+ aggiungi</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {[...watchlist]
          .sort((a, b) => b.priority - a.priority)
          .map((w) => (
            <div key={w.playerId} className="rounded border border-ink-700 bg-ink-850 p-3">
              <div className="flex items-center gap-2">
                <RoleBadge role={w.player.role} size="sm" />
                <span className="min-w-0 flex-1 truncate font-semibold">{w.player.displayName}</span>
                <span className="text-xs text-ink-400">{w.player.teamAbbr} · Qt {w.player.quotation}</span>
                <button onClick={() => remove(w.playerId)} className="text-ink-400 hover:text-role-a">✕</button>
              </div>
              <div className="mt-2 flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button key={s} onClick={() => save(w.playerId, { priority: s })} className={s <= w.priority ? "" : "opacity-25"}>
                    ⭐
                  </button>
                ))}
                <label className="ml-auto flex items-center gap-1 text-xs text-ink-400">
                  target
                  <input
                    type="number"
                    inputMode="numeric"
                    defaultValue={w.targetPrice ?? ""}
                    onBlur={(e) => save(w.playerId, { targetPrice: e.target.value === "" ? null : Number(e.target.value) })}
                    className="h-8 w-14 rounded border border-ink-700 bg-ink-900 px-1 text-center text-sm text-ink-100"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-ink-400">
                  max
                  <input
                    type="number"
                    inputMode="numeric"
                    defaultValue={w.maxPrice ?? ""}
                    onBlur={(e) => save(w.playerId, { maxPrice: e.target.value === "" ? null : Number(e.target.value) })}
                    className="h-8 w-14 rounded border border-ink-700 bg-ink-900 px-1 text-center text-sm text-gold-300"
                  />
                </label>
              </div>
            </div>
          ))}
        {watchlist.length === 0 && (
          <p className="mt-4 text-center text-sm text-ink-400">
            Nessun obiettivo ancora. Cerca un giocatore qui sopra.
          </p>
        )}
      </div>
    </div>
  );
}

function MySquad({ me, purchases, budget }: {
  me: { name: string; credits: number; spent: number; slotsRemaining: number; avgPerRemainingSlot: number | null; roster: Record<Role, { filled: number; max: number }> };
  purchases: PurchaseRow[];
  budget: number;
}) {
  const byRole: Record<Role, PurchaseRow[]> = { P: [], D: [], C: [], A: [] };
  for (const p of purchases) byRole[p.player.role].push(p);

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-center text-sm">
        <div className="rounded border border-ink-700 bg-ink-850 py-2">
          <div className="text-[10px] tracking-wider text-ink-400">SPESI</div>
          <div className="font-display text-xl font-bold">{me.spent} / {budget}</div>
        </div>
        <div className="rounded border border-ink-700 bg-ink-850 py-2">
          <div className="text-[10px] tracking-wider text-ink-400">MEDIA / SLOT RIMASTO</div>
          <div className="font-display text-xl font-bold">{me.avgPerRemainingSlot ?? "—"}</div>
        </div>
      </div>
      {(["P", "D", "C", "A"] as Role[]).map((r) => (
        <div key={r} className="mb-3">
          <div className="mb-1 flex items-center gap-2 text-sm text-ink-300">
            <RoleBadge role={r} size="sm" /> {me.roster[r].filled}/{me.roster[r].max}
          </div>
          {byRole[r].map((p) => (
            <div key={p.id} className="flex justify-between border-b border-ink-800 py-1 text-sm">
              <span>{p.player.displayName} <span className="text-ink-400">({p.player.teamAbbr})</span></span>
              <span className="font-display font-semibold text-gold-300">{p.price}</span>
            </div>
          ))}
          {byRole[r].length === 0 && <div className="text-xs text-ink-500">—</div>}
        </div>
      ))}
    </div>
  );
}
