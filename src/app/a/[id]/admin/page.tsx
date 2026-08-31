"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getAdminToken, rememberAuction } from "@/lib/client/storage";
import { useAuctionSocket } from "@/lib/client/useAuctionSocket";
import type { Snapshot, SnapshotTeam } from "@/lib/protocol";
import type { Role } from "@/lib/domain/types";
import { RoleBadge } from "@/components/RoleBadge";
import { Countdown } from "@/components/Countdown";
import { ConnBadge } from "@/components/ConnBadge";
import { Toasts } from "@/components/Toasts";

interface SearchRow {
  id: string;
  displayName: string;
  teamName: string;
  teamAbbr: string;
  role: Role;
  quotation: number;
  fvm: number | null;
  status: "AVAILABLE" | "AUCTION" | "SOLD" | "UNSOLD";
  soldTo: { teamName: string; price: number } | null;
}

interface PurchaseRow {
  id: string;
  price: number;
  team: { id: string; name: string; color: string | null };
  player: { id: string; displayName: string; teamAbbr: string; role: Role };
}

export default function AdminPage() {
  const { id } = useParams<{ id: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => {
    setToken(getAdminToken(id));
    setTokenChecked(true);
    rememberAuction(id, "admin");
  }, [id]);

  const { snapshot, connState, toasts, authError, sendCmd, serverNow } = useAuctionSocket(
    id,
    "admin",
    token,
  );

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);
  const [results, setResults] = useState<SearchRow[]>([]);
  const [selIdx, setSelIdx] = useState(0);
  const [assignTarget, setAssignTarget] = useState<SearchRow | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [showPurchases, setShowPurchases] = useState(false);
  const [editTarget, setEditTarget] = useState<PurchaseRow | null>(null);
  const [transferTarget, setTransferTarget] = useState<PurchaseRow | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const status = snapshot?.auction.status;
  const isLiveMode = snapshot?.auction.mode === "LIVE";
  const canSelect = status === "PLAYER_SELECTION" || status === "PLAYER_SOLD" || status === "PLAYER_UNSOLD";

  // ------------------------------------------------------------- data loads
  const searchPlayers = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (roleFilter) params.set("role", roleFilter);
    params.set("status", "available");
    params.set("limit", "40");
    params.set("sort", query ? "name" : "quotation");
    if (query) params.set("dir", "asc");
    const res = await fetch(`/api/auctions/${id}/players?${params}`);
    if (res.ok) {
      const data = await res.json();
      setResults(data.players);
      setSelIdx(0);
    }
  }, [id, query, roleFilter]);

  useEffect(() => {
    const t = setTimeout(searchPlayers, 180);
    return () => clearTimeout(t);
  }, [searchPlayers]);

  const soldCount = snapshot?.counts.sold ?? 0;
  useEffect(() => {
    fetch(`/api/auctions/${id}/purchases`)
      .then((r) => r.json())
      .then((d) => setPurchases(d.purchases ?? []));
    searchPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, soldCount]);

  // ---------------------------------------------------------------- actions
  const run = useCallback(
    async (cmd: Parameters<typeof sendCmd>[0]) => {
      setLastError(null);
      const ack = await sendCmd(cmd);
      if (!ack.ok) setLastError(ack.message);
      return ack;
    },
    [sendCmd],
  );

  // ---------------------------------------------------------------- hotkeys
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inInput = ["INPUT", "SELECT", "TEXTAREA"].includes(
        (e.target as HTMLElement).tagName,
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        setAssignTarget(null);
        setEditTarget(null);
        setTransferTarget(null);
        (e.target as HTMLElement).blur?.();
        return;
      }
      if (inInput) return;
      if (["1", "2", "3", "4"].includes(e.key)) {
        const role = (["P", "D", "C", "A"] as Role[])[Number(e.key) - 1];
        setRoleFilter((r) => (r === role ? null : role));
      } else if (e.key.toLowerCase() === "u") {
        if (window.confirm("Annullare l'ultimo acquisto?")) run({ type: "undo_last" });
      } else if (e.key === " ") {
        e.preventDefault();
        if (status === "PLAYER_ACTIVE" || status === "PLAYER_CLOSING") run({ type: "pause" });
        else if (status === "PAUSED") run({ type: "resume" });
      } else if (e.key.toLowerCase() === "r" && canSelect) {
        run({ type: "random_player", role: roleFilter ?? undefined });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, status, canSelect, roleFilter]);

  // ----------------------------------------------------------------- guards
  if (!tokenChecked) return null;
  if (!token || authError === "unauthorized") {
    return <TokenGate auctionId={id} onToken={(t) => setToken(t)} />;
  }
  if (!snapshot) {
    return (
      <main className="grid min-h-dvh place-items-center text-ink-300">
        Connessione all&apos;asta…
      </main>
    );
  }

  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  const current = snapshot.current;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* ------------------------------------------------------- top bar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-700 bg-ink-900 px-4 py-2.5">
        <div className="font-display text-xl font-bold">
          {snapshot.auction.name}
          <span className="ml-2 text-sm font-normal text-ink-400">{snapshot.auction.season}</span>
        </div>
        <StatusChip status={snapshot.auction.status} />
        <span className="text-sm text-ink-400">
          {snapshot.counts.sold} assegnati · {snapshot.counts.available} disponibili
        </span>
        <div className="ml-auto flex items-center gap-3">
          <nav className="flex gap-2 text-sm">
            <Link className="rounded border border-ink-700 px-2.5 py-1 text-ink-300 hover:border-ink-600" href={`/a/${id}/lobby`}>Lobby</Link>
            <Link className="rounded border border-ink-700 px-2.5 py-1 text-ink-300 hover:border-ink-600" href={`/a/${id}/board`}>Tabellone</Link>
            <Link className="rounded border border-ink-700 px-2.5 py-1 text-ink-300 hover:border-ink-600" href={`/a/${id}/squads`}>Rose</Link>
            <Link className="rounded border border-ink-700 px-2.5 py-1 text-ink-300 hover:border-ink-600" href={`/a/${id}/summary`}>Riepilogo</Link>
            <Link className="rounded border border-ink-700 px-2.5 py-1 text-ink-300 hover:border-ink-600" href={`/a/${id}/settings`}>⚙︎</Link>
          </nav>
          {snapshot.auction.isDemo && (
            <button
              onClick={() => run({ type: "set_bots", enabled: !snapshot.auction.botsEnabled })}
              className={`rounded border px-2.5 py-1 text-sm ${snapshot.auction.botsEnabled ? "border-pitch-500/60 text-pitch-400" : "border-ink-700 text-ink-400"}`}
            >
              🤖 Bot {snapshot.auction.botsEnabled ? "ON" : "OFF"}
            </button>
          )}
          {status === "PAUSED" ? (
            <button onClick={() => run({ type: "resume" })} className="rounded bg-pitch-600 px-3 py-1 font-display font-semibold">RIPRENDI</button>
          ) : (
            <button onClick={() => run({ type: "pause" })} className="rounded border border-ink-700 px-3 py-1 text-sm text-ink-300 hover:border-ink-600">Pausa</button>
          )}
          <ConnBadge state={connState} />
        </div>
      </header>

      {lastError && (
        <div className="border-b border-role-a/40 bg-role-a/10 px-4 py-1.5 text-sm text-role-a">
          {lastError}
        </div>
      )}

      <main className="grid flex-1 gap-3 p-3 lg:grid-cols-[1fr_360px]">
        {/* --------------------------------------------- main column */}
        <div className="flex min-w-0 flex-col gap-3">
          {status === "AUCTION_NOT_STARTED" ? (
            <div className="grid flex-1 place-items-center rounded-lg border border-ink-700 bg-ink-850 p-10">
              <div className="text-center">
                <p className="mb-4 text-ink-300">
                  L&apos;asta non è ancora iniziata. Fai entrare i partecipanti dalla{" "}
                  <Link href={`/a/${id}/lobby`} className="text-pitch-400 underline">lobby</Link>, poi:
                </p>
                <button
                  onClick={() => run({ type: "start_auction" })}
                  className="rounded bg-pitch-600 px-8 py-4 font-display text-2xl font-bold hover:bg-pitch-500"
                >
                  INIZIA L&apos;ASTA
                </button>
              </div>
            </div>
          ) : current ? (
            <CurrentPlayerAdmin
              snapshot={snapshot}
              serverNow={serverNow}
              teamById={teamById}
              isLiveMode={isLiveMode ?? true}
              onClose={() => run({ type: "close_bidding" })}
              onAssign={() => run({ type: "assign_current" })}
              onUnsold={() => run({ type: "mark_unsold" })}
              onCancel={() => run({ type: "cancel_current" })}
            />
          ) : (
            <div className="rounded-lg border border-ink-700 bg-ink-850 px-4 py-3 text-sm text-ink-300">
              {status === "PAUSED"
                ? "Asta in pausa."
                : status === "FINISHED"
                  ? "Asta terminata — vedi il riepilogo. Puoi ancora correggere con UNDO."
                  : "Cerca il prossimo giocatore da mettere all'asta (⌘K)"}
            </div>
          )}

          {/* --------------------------------------------- search */}
          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-ink-700 bg-ink-850">
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 p-2.5">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx((i) => Math.min(i + 1, results.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setSelIdx((i) => Math.max(i - 1, 0)); }
                  else if (e.key === "Enter" && results[selIdx]) {
                    e.preventDefault();
                    if (isLiveMode && canSelect) run({ type: "start_player", playerId: results[selIdx].id });
                    else setAssignTarget(results[selIdx]);
                  }
                }}
                placeholder="Cerca giocatore o club…  (⌘K)"
                className="h-10 min-w-52 flex-1 rounded border border-ink-700 bg-ink-900 px-3 focus:border-pitch-500 focus:outline-none"
              />
              {(["P", "D", "C", "A"] as Role[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(roleFilter === r ? null : r)}
                  className={`h-10 w-10 rounded border font-display font-semibold ${roleFilter === r ? "border-pitch-500 bg-pitch-600/20 text-pitch-400" : "border-ink-700 text-ink-300"}`}
                  title={`Filtra ${r} (tasto ${["P", "D", "C", "A"].indexOf(r) + 1})`}
                >
                  {r}
                </button>
              ))}
              <button
                onClick={() => run({ type: "random_player", role: roleFilter ?? undefined })}
                disabled={!canSelect}
                className="h-10 rounded border border-ink-700 px-3 text-sm text-ink-300 hover:border-ink-600 disabled:opacity-40"
                title="Giocatore casuale (R)"
              >
                🎲 Casuale{roleFilter ? ` ${roleFilter}` : ""}
              </button>
            </div>
            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: 340 }}>
              {results.map((p, i) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 border-b border-ink-800 px-3 py-2 ${i === selIdx ? "bg-ink-800" : ""}`}
                  onMouseEnter={() => setSelIdx(i)}
                >
                  <RoleBadge role={p.role} size="sm" />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{p.displayName}</span>
                    <span className="ml-2 text-sm text-ink-400">{p.teamAbbr}</span>
                    {p.status === "UNSOLD" && <span className="ml-2 rounded bg-ink-700 px-1.5 text-xs text-ink-300">invenduto</span>}
                  </div>
                  <span className="text-sm text-ink-400" title="Quotazione">Qt {p.quotation}</span>
                  {p.fvm !== null && <span className="hidden text-sm text-ink-400 sm:inline" title="FVM/1000">FVM {p.fvm}</span>}
                  {canSelect && (
                    <>
                      {isLiveMode && (
                        <button
                          onClick={() => run({ type: "start_player", playerId: p.id })}
                          className="rounded bg-pitch-600 px-3 py-1 font-display text-sm font-semibold hover:bg-pitch-500"
                        >
                          ASTA
                        </button>
                      )}
                      <button
                        onClick={() => setAssignTarget(p)}
                        className="rounded border border-ink-600 px-3 py-1 font-display text-sm text-ink-100 hover:border-gold-400 hover:text-gold-300"
                      >
                        ASSEGNA
                      </button>
                    </>
                  )}
                </div>
              ))}
              {results.length === 0 && (
                <p className="p-4 text-sm text-ink-400">Nessun giocatore disponibile trovato.</p>
              )}
            </div>
          </section>

          {/* --------------------------------------------- teams grid */}
          <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {snapshot.teams.map((t) => (
              <TeamCard key={t.id} team={t} snapshot={snapshot} onOverridePass={() => run({ type: "override_pass", teamId: t.id })} />
            ))}
          </section>
        </div>

        {/* --------------------------------------------- right column */}
        <aside className="flex flex-col gap-3">
          <section className="rounded-lg border border-ink-700 bg-ink-850 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold tracking-wider text-ink-300">CRONOLOGIA RILANCI</h3>
              <button
                onClick={() => { if (window.confirm("Annullare l'ultimo acquisto?")) run({ type: "undo_last" }); }}
                className="rounded border border-gold-400/50 px-2.5 py-1 text-xs font-semibold text-gold-300 hover:bg-gold-400/10"
                title="Tasto U"
              >
                ↩︎ UNDO ULTIMO
              </button>
            </div>
            <BidHistory snapshot={snapshot} teamById={teamById} />
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-ink-700 bg-ink-850 p-3">
            <button onClick={() => setShowPurchases(!showPurchases)} className="flex items-center justify-between font-display text-sm font-semibold tracking-wider text-ink-300">
              ACQUISTI ({purchases.length}) <span>{showPurchases ? "▾" : "▸"}</span>
            </button>
            {showPurchases && (
              <div className="scroll-slim mt-2 min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: 400 }}>
                {[...purchases].reverse().map((p) => (
                  <div key={p.id} className="flex items-center gap-2 border-b border-ink-800 py-1.5 text-sm">
                    <RoleBadge role={p.player.role} size="sm" />
                    <div className="min-w-0 flex-1 truncate">
                      {p.player.displayName}
                      <span className="ml-1 text-ink-400">→ {p.team.name}</span>
                    </div>
                    <span className="font-display font-semibold text-gold-300">{p.price}</span>
                    <button title="Modifica" onClick={() => setEditTarget(p)} className="rounded border border-ink-700 px-1.5 text-xs text-ink-300 hover:border-ink-500">✎</button>
                    <button title="Trasferisci" onClick={() => setTransferTarget(p)} className="rounded border border-ink-700 px-1.5 text-xs text-ink-300 hover:border-ink-500">⇄</button>
                    <button
                      title="Svincola"
                      onClick={() => {
                        const refund = window.prompt(`Svincola ${p.player.displayName}: rimborso % (0-100)`, "100");
                        if (refund !== null) run({ type: "release_player", purchaseId: p.id, refundPct: Math.max(0, Math.min(100, Number(refund) || 0)) });
                      }}
                      className="rounded border border-ink-700 px-1.5 text-xs text-role-a hover:border-role-a/50"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {purchases.length === 0 && <p className="py-2 text-sm text-ink-400">Ancora nessun acquisto.</p>}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs text-ink-400">
            <span className="font-semibold text-ink-300">Scorciatoie:</span> ⌘K cerca · 1-4 ruoli · R casuale · U undo · SPAZIO pausa · ESC chiudi ·
            ↑↓ + INVIO {isLiveMode ? "manda all'asta" : "assegna"}
          </section>

          {snapshot.auction.status !== "FINISHED" && (
            <button
              onClick={() => { if (window.confirm("Terminare l'asta adesso?")) run({ type: "finish_auction" }); }}
              className="rounded border border-ink-700 py-2 text-sm text-ink-400 hover:border-role-a/50 hover:text-role-a"
            >
              Termina asta
            </button>
          )}
        </aside>
      </main>

      {/* ------------------------------------------------------- modals */}
      {assignTarget && (
        <AssignModal
          player={assignTarget}
          teams={snapshot.teams}
          minBid={snapshot.auction.minBid}
          onClose={() => setAssignTarget(null)}
          onAssign={async (teamId, price) => {
            const ack = await run({ type: "manual_assign", playerId: assignTarget.id, teamId, price });
            if (ack.ok) setAssignTarget(null);
            return ack;
          }}
        />
      )}
      {editTarget && (
        <EditModal
          purchase={editTarget}
          teams={snapshot.teams}
          onClose={() => setEditTarget(null)}
          onSave={async (teamId, price) => {
            const ack = await run({ type: "edit_purchase", purchaseId: editTarget.id, teamId, price });
            if (ack.ok) setEditTarget(null);
            return ack;
          }}
        />
      )}
      {transferTarget && (
        <TransferModal
          purchase={transferTarget}
          teams={snapshot.teams}
          onClose={() => setTransferTarget(null)}
          onTransfer={async (toTeamId, adj) => {
            const ack = await run({ type: "transfer_player", purchaseId: transferTarget.id, toTeamId, creditAdjustment: adj });
            if (ack.ok) setTransferTarget(null);
            return ack;
          }}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}

// ============================================================ sub-components

function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    AUCTION_NOT_STARTED: ["NON INIZIATA", "bg-ink-700 text-ink-300"],
    PLAYER_SELECTION: ["SELEZIONE", "bg-role-c/20 text-role-c"],
    PLAYER_ACTIVE: ["ASTA IN CORSO", "bg-pitch-600/25 text-pitch-400"],
    PLAYER_CLOSING: ["CHIUSURA…", "bg-gold-400/20 text-gold-300"],
    PLAYER_SOLD: ["ASSEGNATO", "bg-pitch-600/25 text-pitch-400"],
    PLAYER_UNSOLD: ["INVENDUTO", "bg-ink-700 text-ink-300"],
    PAUSED: ["PAUSA", "bg-gold-400/20 text-gold-300"],
    FINISHED: ["TERMINATA", "bg-role-a/20 text-role-a"],
  };
  const [label, cls] = map[status] ?? [status, "bg-ink-700"];
  return <span className={`rounded px-2 py-0.5 font-display text-xs font-semibold tracking-wider ${cls}`}>{label}</span>;
}

function CurrentPlayerAdmin({
  snapshot, serverNow, teamById, isLiveMode, onClose, onAssign, onUnsold, onCancel,
}: {
  snapshot: Snapshot;
  serverNow: () => number;
  teamById: Map<string, SnapshotTeam>;
  isLiveMode: boolean;
  onClose: () => void;
  onAssign: () => void;
  onUnsold: () => void;
  onCancel: () => void;
}) {
  const current = snapshot.current!;
  const leader = current.leaderTeamId ? teamById.get(current.leaderTeamId) : null;
  const sold = current.status === "SOLD";
  const unsold = current.status === "UNSOLD";

  return (
    <section className={`rounded-lg border p-5 ${sold ? "border-pitch-500/60 bg-pitch-600/10 animate-flash-sold" : unsold ? "border-ink-600 bg-ink-850" : "border-ink-700 bg-ink-850"}`}>
      <div className="flex flex-wrap items-center gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <RoleBadge role={current.player.role} size="lg" />
            <div>
              <div className="font-display text-4xl font-bold uppercase leading-tight">{current.player.displayName}</div>
              <div className="text-ink-300">
                {current.player.teamName}
                <span className="ml-3 text-sm text-ink-400">Qt {current.player.quotation}</span>
                {current.player.fvm !== null && <span className="ml-2 text-sm text-ink-400">FVM {current.player.fvm}</span>}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-end gap-6">
            <div>
              <div className="text-xs tracking-wider text-ink-400">OFFERTA ATTUALE</div>
              <div key={current.currentBid ?? 0} className="animate-bid-pop font-display text-7xl font-bold leading-none text-gold-300">
                {current.currentBid ?? "—"}
              </div>
            </div>
            <div className="pb-1">
              <div className="text-xs tracking-wider text-ink-400">MIGLIOR OFFERENTE</div>
              <div className="font-display text-2xl font-semibold" style={{ color: leader?.color ?? undefined }}>
                {sold && current.soldToTeamId
                  ? `→ ${teamById.get(current.soldToTeamId)?.name ?? ""}`
                  : leader?.name ?? "nessuno"}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          {snapshot.auction.timerEnabled && !sold && !unsold && (
            <Countdown closesAt={current.closesAt} serverNow={serverNow} size="xl" />
          )}
          {sold && <div className="font-display text-3xl font-bold text-pitch-400">VENDUTO {current.soldPrice}</div>}
          {unsold && <div className="font-display text-3xl font-bold text-ink-400">INVENDUTO</div>}
        </div>
      </div>

      {!sold && !unsold && (
        <div className="mt-4 flex flex-wrap gap-2">
          {isLiveMode && snapshot.auction.timerEnabled && (
            <button onClick={onClose} className="rounded border border-gold-400/60 px-4 py-2 font-display font-semibold text-gold-300 hover:bg-gold-400/10">
              CHIUDI ORA
            </button>
          )}
          <button
            onClick={onAssign}
            disabled={!current.leaderTeamId}
            className="rounded bg-pitch-600 px-4 py-2 font-display font-semibold hover:bg-pitch-500 disabled:opacity-40"
          >
            ASSEGNA A {leader?.name?.toUpperCase() ?? "…"} {current.currentBid !== null ? `(${current.currentBid})` : ""}
          </button>
          <button onClick={onUnsold} className="rounded border border-ink-600 px-4 py-2 font-display text-ink-300 hover:border-ink-500">
            INVENDUTO
          </button>
          <button onClick={onCancel} className="rounded border border-ink-600 px-4 py-2 font-display text-ink-400 hover:border-role-a/50 hover:text-role-a">
            ANNULLA
          </button>
        </div>
      )}
    </section>
  );
}

function TeamCard({ team, snapshot, onOverridePass }: { team: SnapshotTeam; snapshot: Snapshot; onOverridePass: () => void }) {
  const statusLabel = team.isLeading
    ? ["IN TESTA", "text-gold-300"]
    : team.hasPassed
      ? ["PASSATO", "text-ink-400"]
      : null;
  return (
    <div className={`rounded-lg border p-2.5 ${team.isLeading ? "border-gold-400/60 bg-gold-400/5" : team.hasPassed && snapshot.current ? "border-ink-800 bg-ink-900 opacity-60" : "border-ink-700 bg-ink-850"}`}>
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: team.color ?? "#64748b" }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{team.name}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${team.connected ? "bg-pitch-500" : "bg-ink-600"}`} title={team.connected ? "Connesso" : "Non connesso"} />
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="font-display text-2xl font-bold tabular-nums">{team.credits}</span>
        <span className="text-xs text-ink-400" title="Offerta massima consentita">max {team.maxBid}</span>
      </div>
      <div className="mt-1 flex gap-1.5 text-[11px] tabular-nums text-ink-300">
        {(["P", "D", "C", "A"] as Role[]).map((r) => {
          const full = team.roster[r].filled >= team.roster[r].max;
          return (
            <span key={r} className={full ? "text-pitch-400" : ""}>
              {r} {team.roster[r].filled}/{team.roster[r].max}
            </span>
          );
        })}
      </div>
      {statusLabel && (
        <div className={`mt-1 flex items-center justify-between font-display text-xs font-semibold tracking-wider ${statusLabel[1]}`}>
          {statusLabel[0]}
          {team.hasPassed && (
            <button onClick={onOverridePass} className="rounded border border-ink-700 px-1.5 text-[10px] font-normal text-ink-400 hover:border-ink-500" title="Riammetti (annulla il passo)">
              riammetti
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BidHistory({ snapshot, teamById }: { snapshot: Snapshot; teamById: Map<string, SnapshotTeam> }) {
  const bids = snapshot.current?.bids ?? [];
  if (bids.length === 0) return <p className="text-sm text-ink-400">Nessun rilancio per questo giocatore.</p>;
  return (
    <div className="scroll-slim max-h-44 overflow-y-auto font-mono text-sm">
      {[...bids].reverse().map((b, i) => (
        <div key={`${b.at}-${i}`} className="flex justify-between border-b border-ink-800 py-1">
          <span className="text-ink-400">{new Date(b.at).toLocaleTimeString("it-IT")}</span>
          <span className="mx-2 min-w-0 flex-1 truncate text-right" style={{ color: teamById.get(b.teamId)?.color ?? undefined }}>
            {teamById.get(b.teamId)?.name ?? "?"}
          </span>
          <span className="w-10 text-right font-semibold text-gold-300">{b.amount}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- modals

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-ink-600 bg-ink-850 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 font-display text-xl font-bold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function TeamPicker({ teams, value, onChange }: { teams: SnapshotTeam[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {teams.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-left text-sm ${value === t.id ? "border-pitch-500 bg-pitch-600/15" : "border-ink-700 hover:border-ink-600"}`}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: t.color ?? "#64748b" }} />
          <span className="min-w-0 flex-1 truncate">{t.name}</span>
          <span className="text-xs text-ink-400">max {t.maxBid}</span>
        </button>
      ))}
    </div>
  );
}

function AssignModal({ player, teams, minBid, onClose, onAssign }: {
  player: SearchRow;
  teams: SnapshotTeam[];
  minBid: number;
  onClose: () => void;
  onAssign: (teamId: string, price: number) => Promise<{ ok: boolean; message?: string } | { ok: false; message: string }>;
}) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [price, setPrice] = useState(minBid);
  const [error, setError] = useState<string | null>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!teamId) { setError("Seleziona la squadra vincitrice"); return; }
    const ack = await onAssign(teamId, price);
    if (!ack.ok) setError((ack as { message: string }).message);
  }

  return (
    <ModalShell title={`Assegna ${player.displayName} (${player.role} · ${player.teamAbbr})`} onClose={onClose}>
      <TeamPicker teams={teams} value={teamId} onChange={(id) => { setTeamId(id); priceRef.current?.focus(); priceRef.current?.select(); }} />
      <div className="mt-4 flex items-center gap-3">
        <label className="text-sm text-ink-300">Prezzo</label>
        <input
          ref={priceRef}
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="h-11 w-28 rounded border border-ink-700 bg-ink-900 px-3 font-display text-2xl font-bold text-gold-300 focus:border-pitch-500 focus:outline-none"
        />
        <button onClick={submit} className="ml-auto rounded bg-pitch-600 px-5 py-2.5 font-display text-lg font-bold hover:bg-pitch-500">
          ASSEGNA
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-role-a">{error}</p>}
    </ModalShell>
  );
}

function EditModal({ purchase, teams, onClose, onSave }: {
  purchase: PurchaseRow;
  teams: SnapshotTeam[];
  onClose: () => void;
  onSave: (teamId: string, price: number) => Promise<{ ok: boolean } | { ok: false; message: string }>;
}) {
  const [teamId, setTeamId] = useState(purchase.team.id);
  const [price, setPrice] = useState(purchase.price);
  const [error, setError] = useState<string | null>(null);

  return (
    <ModalShell title={`Correggi acquisto: ${purchase.player.displayName}`} onClose={onClose}>
      <TeamPicker teams={teams} value={teamId} onChange={setTeamId} />
      <div className="mt-4 flex items-center gap-3">
        <label className="text-sm text-ink-300">Prezzo</label>
        <input
          type="number" min={0} value={price}
          onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
          className="h-11 w-28 rounded border border-ink-700 bg-ink-900 px-3 font-display text-2xl font-bold text-gold-300 focus:border-pitch-500 focus:outline-none"
        />
        <button
          onClick={async () => { const ack = await onSave(teamId, price); if (!ack.ok) setError((ack as { message: string }).message); }}
          className="ml-auto rounded bg-pitch-600 px-5 py-2.5 font-display font-bold hover:bg-pitch-500"
        >
          SALVA
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-role-a">{error}</p>}
    </ModalShell>
  );
}

function TransferModal({ purchase, teams, onClose, onTransfer }: {
  purchase: PurchaseRow;
  teams: SnapshotTeam[];
  onClose: () => void;
  onTransfer: (toTeamId: string, adj: number) => Promise<{ ok: boolean } | { ok: false; message: string }>;
}) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [adj, setAdj] = useState(0);
  const [error, setError] = useState<string | null>(null);

  return (
    <ModalShell title={`Trasferisci ${purchase.player.displayName} (da ${purchase.team.name})`} onClose={onClose}>
      <TeamPicker teams={teams.filter((t) => t.id !== purchase.team.id)} value={teamId} onChange={setTeamId} />
      <div className="mt-4 flex items-center gap-3">
        <label className="text-sm text-ink-300" title="Crediti rimborsati alla squadra di origine">Conguaglio</label>
        <input
          type="number" value={adj}
          onChange={(e) => setAdj(Number(e.target.value) || 0)}
          className="h-11 w-28 rounded border border-ink-700 bg-ink-900 px-3 font-display text-xl font-bold focus:border-pitch-500 focus:outline-none"
        />
        <button
          onClick={async () => {
            if (!teamId) { setError("Seleziona la squadra di destinazione"); return; }
            const ack = await onTransfer(teamId, adj);
            if (!ack.ok) setError((ack as { message: string }).message);
          }}
          className="ml-auto rounded bg-pitch-600 px-5 py-2.5 font-display font-bold hover:bg-pitch-500"
        >
          TRASFERISCI
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-role-a">{error}</p>}
    </ModalShell>
  );
}

function TokenGate({ auctionId, onToken }: { auctionId: string; onToken: (t: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display text-3xl font-bold">REGIA ASTA</h1>
        <p className="mt-2 text-sm text-ink-300">
          Questo browser non ha il token amministratore per questa asta. Incollalo qui
          (ti è stato mostrato alla creazione).
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
          placeholder="Token admin"
          className="mt-4 h-11 w-full rounded border border-ink-700 bg-ink-900 px-3 text-center focus:border-pitch-500 focus:outline-none"
        />
        <button
          onClick={() => {
            if (value) {
              localStorage.setItem(`fc:admin:${auctionId}`, value);
              onToken(value);
            }
          }}
          className="mt-3 w-full rounded bg-pitch-600 py-2.5 font-display font-semibold hover:bg-pitch-500"
        >
          ENTRA
        </button>
      </div>
    </main>
  );
}
