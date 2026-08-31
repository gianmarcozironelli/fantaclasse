"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getAdminToken } from "@/lib/client/storage";
import { ROLE_LABELS, ROLES, Role } from "@/lib/domain/types";

interface TeamRow {
  id: string;
  name: string;
  managerName: string | null;
  color: string | null;
  joinCode?: string;
  connected: boolean;
}

interface AuctionData {
  name: string;
  season: string;
  mode: "LIVE" | "MANUAL";
  minBid: number;
  minIncrement: number;
  timerEnabled: boolean;
  timerSeconds: number;
  resetTimerOnBid: boolean;
  nominationMode: string;
  autoAssign: boolean;
  passEnabled: boolean;
  hideSoldPlayers: boolean;
  rosterRules: Record<Role, number>;
  teams: TeamRow[];
}

export default function SettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<AuctionData | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [replaceList, setReplaceList] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setToken(getAdminToken(id)), [id]);

  const load = useCallback(() => {
    if (!token) return;
    fetch(`/api/auctions/${id}`, { headers: { "x-admin-token": token } })
      .then((r) => r.json())
      .then(setData);
  }, [id, token]);

  useEffect(load, [load]);

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function patchAuction(patch: Record<string, unknown>) {
    if (!token) return;
    const res = await fetch(`/api/auctions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (!res.ok) flash("err", body.error ?? "Errore");
    else flash("ok", "Impostazioni salvate");
    load();
  }

  async function patchTeam(teamId: string, patch: Record<string, unknown>) {
    if (!token) return;
    const res = await fetch(`/api/auctions/${id}/teams/${teamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(patch),
    });
    if (!res.ok) flash("err", (await res.json()).error ?? "Errore");
    else flash("ok", "Squadra aggiornata");
    load();
  }

  async function addTeam() {
    if (!token) return;
    const name = window.prompt("Nome della nuova squadra");
    if (!name) return;
    const res = await fetch(`/api/auctions/${id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) flash("err", (await res.json()).error ?? "Errore");
    load();
  }

  async function deleteTeam(teamId: string, name: string) {
    if (!token || !window.confirm(`Eliminare "${name}"?`)) return;
    const res = await fetch(`/api/auctions/${id}/teams/${teamId}`, {
      method: "DELETE",
      headers: { "x-admin-token": token },
    });
    if (!res.ok) flash("err", (await res.json()).error ?? "Errore");
    load();
  }

  async function upload(file: File) {
    if (!token) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("replaceList", String(replaceList));
      const res = await fetch(`/api/auctions/${id}/import`, {
        method: "POST",
        headers: { "x-admin-token": token },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) flash("err", body.error ?? "Import fallito");
      else
        flash(
          "ok",
          `Import completato: ${body.created} nuovi, ${body.updated} aggiornati${body.deactivated ? `, ${body.deactivated} rimossi dal tabellone` : ""}${body.warnings?.length ? ` (${body.warnings.length} avvisi)` : ""}`,
        );
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!token) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center text-ink-300">
        Serve il token amministratore. Apri prima la{" "}
        <Link href={`/a/${id}/admin`} className="ml-1 text-pitch-400 underline">regia</Link>.
      </main>
    );
  }
  if (!data) return <main className="grid min-h-dvh place-items-center text-ink-300">Caricamento…</main>;

  const input = "h-10 rounded border border-ink-700 bg-ink-900 px-3 focus:border-pitch-500 focus:outline-none";
  const label = "mb-1 block text-xs font-medium tracking-wider text-ink-400";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center gap-3">
        <h1 className="font-display text-3xl font-bold">IMPOSTAZIONI</h1>
        <Link href={`/a/${id}/admin`} className="ml-auto rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:border-ink-600">
          ← Regia
        </Link>
      </header>

      {msg && (
        <div className={`mb-4 rounded border px-3 py-2 text-sm ${msg.kind === "ok" ? "border-pitch-500/50 text-pitch-400" : "border-role-a/50 text-role-a"}`}>
          {msg.text}
        </div>
      )}

      {/* ---------------------------------------------------- player import */}
      <section className="mb-6 rounded-lg border border-ink-700 bg-ink-850 p-4">
        <h2 className="font-display text-xl font-semibold">LISTA GIOCATORI</h2>
        <p className="mt-1 text-sm text-ink-300">
          Carica il file quotazioni aggiornato (CSV o XLSX). È riconosciuto il formato
          ufficiale Fantacalcio.it (colonne <code className="text-ink-100">Id, R, RM, Nome, Squadra, Qt.A, Qt.I, FVM</code>),
          oppure qualsiasi foglio con <code className="text-ink-100">Nome</code>, <code className="text-ink-100">R</code>/<code className="text-ink-100">Ruolo</code> e{" "}
          <code className="text-ink-100">Squadra</code>. I giocatori già acquistati non vengono toccati.
        </p>
        <div className="mt-3 rounded border border-gold-400/40 bg-gold-400/5 p-3 text-sm">
          <strong className="text-gold-300">Nota sulla lista precaricata:</strong>{" "}
          <span className="text-ink-300">
            i giocatori inclusi nell&apos;app sono dati di esempio scritti a mano (quotazioni
            e FVM indicativi, più alcuni nomi inventati per riempire le rose). Servono solo
            per provare l&apos;app: prima di un&apos;asta vera carica il file ufficiale.
          </span>
        </div>
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={replaceList}
            onChange={(e) => setReplaceList(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-500"
          />
          <span>
            Sostituisci l&apos;intera lista
            <span className="block text-xs text-ink-400">
              I giocatori assenti dal file spariscono dal tabellone (così i dati di esempio
              non restano in mezzo). Chi è già stato acquistato resta sempre visibile.
            </span>
          </span>
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          disabled={importing}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          className="mt-3 block w-full text-sm text-ink-300 file:mr-3 file:rounded file:border-0 file:bg-pitch-600 file:px-4 file:py-2 file:font-display file:font-semibold file:text-white hover:file:bg-pitch-500"
        />
        {importing && <p className="mt-2 text-sm text-gold-300">Import in corso…</p>}
      </section>

      {/* ---------------------------------------------------------- teams */}
      <section className="mb-6 rounded-lg border border-ink-700 bg-ink-850 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">SQUADRE</h2>
          <button onClick={addTeam} className="rounded border border-ink-600 px-3 py-1 text-sm hover:border-pitch-500 hover:text-pitch-400">
            + aggiungi
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {data.teams.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                defaultValue={t.color ?? "#64748b"}
                onBlur={(e) => e.target.value !== t.color && patchTeam(t.id, { color: e.target.value })}
                className="h-9 w-9 shrink-0 cursor-pointer rounded border-none bg-transparent"
              />
              <input
                defaultValue={t.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && patchTeam(t.id, { name: e.target.value.trim() })}
                className={`${input} h-9 min-w-40 flex-1`}
              />
              <input
                defaultValue={t.managerName ?? ""}
                placeholder="Allenatore"
                onBlur={(e) => e.target.value !== (t.managerName ?? "") && patchTeam(t.id, { managerName: e.target.value.trim() || null })}
                className={`${input} h-9 w-36`}
              />
              <input
                placeholder="nuovo PIN"
                maxLength={4}
                inputMode="numeric"
                onBlur={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  if (v.length === 4) { patchTeam(t.id, { pin: v }); e.target.value = ""; }
                }}
                className={`${input} h-9 w-24 text-center tracking-widest`}
              />
              <span className="w-16 text-center font-display text-sm tracking-widest text-ink-400">{t.joinCode}</span>
              <span className={`h-2 w-2 rounded-full ${t.connected ? "bg-pitch-500" : "bg-ink-600"}`} />
              <button onClick={() => deleteTeam(t.id, t.name)} className="h-9 w-9 rounded border border-ink-700 text-role-a hover:border-role-a/50">
                ✕
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Le modifiche si salvano uscendo dal campo. Una squadra con acquisti attivi non può essere eliminata.
        </p>
      </section>

      {/* ------------------------------------------------------- roster */}
      <section className="mb-6 rounded-lg border border-ink-700 bg-ink-850 p-4">
        <h2 className="mb-3 font-display text-xl font-semibold">ROSA</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r}>
              <label className={label}>{ROLE_LABELS[r].toUpperCase()}</label>
              <input
                type="number"
                min={1}
                max={15}
                defaultValue={data.rosterRules[r]}
                onBlur={(e) => {
                  const v = Math.max(1, Math.min(15, Number(e.target.value) || 1));
                  if (v !== data.rosterRules[r]) {
                    patchAuction({ rosterRules: { ...data.rosterRules, [r]: v } });
                  }
                }}
                className={`${input} w-full`}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- auction rules */}
      <section className="rounded-lg border border-ink-700 bg-ink-850 p-4">
        <h2 className="mb-3 font-display text-xl font-semibold">REGOLE D&apos;ASTA</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className={label}>MODALITÀ</label>
            <select className={`${input} w-full`} defaultValue={data.mode} onChange={(e) => patchAuction({ mode: e.target.value })}>
              <option value="LIVE">Live (telefoni)</option>
              <option value="MANUAL">Manuale (a voce)</option>
            </select>
          </div>
          <div>
            <label className={label}>NOMINA</label>
            <select className={`${input} w-full`} defaultValue={data.nominationMode} onChange={(e) => patchAuction({ nominationMode: e.target.value })}>
              <option value="ADMIN_ONLY">Solo admin</option>
              <option value="ROUND_ROBIN">A giro</option>
              <option value="RANDOM_PLAYER">Casuale</option>
              <option value="RANDOM_BY_ROLE">Casuale per ruolo</option>
            </select>
          </div>
          <div>
            <label className={label}>TIMER (SEC)</label>
            <input type="number" min={3} max={600} defaultValue={data.timerSeconds} onBlur={(e) => patchAuction({ timerSeconds: Math.max(3, Number(e.target.value) || 10) })} className={`${input} w-full`} />
          </div>
          <div>
            <label className={label}>OFFERTA MINIMA</label>
            <input type="number" min={1} defaultValue={data.minBid} onBlur={(e) => patchAuction({ minBid: Math.max(1, Number(e.target.value) || 1) })} className={`${input} w-full`} />
          </div>
          <div>
            <label className={label}>RILANCIO MINIMO</label>
            <input type="number" min={1} defaultValue={data.minIncrement} onBlur={(e) => patchAuction({ minIncrement: Math.max(1, Number(e.target.value) || 1) })} className={`${input} w-full`} />
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {(
            [
              ["timerEnabled", "Timer attivo"],
              ["resetTimerOnBid", "Il timer riparte a ogni rilancio"],
              ["autoAssign", "Assegna automaticamente allo scadere"],
              ["passEnabled", "I partecipanti possono passare"],
              ["hideSoldPlayers", "Nascondi i venduti dal tabellone"],
            ] as [keyof AuctionData, string][]
          ).map(([key, text]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                defaultChecked={data[key] as boolean}
                onChange={(e) => patchAuction({ [key]: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
              {text}
            </label>
          ))}
        </div>
      </section>
    </main>
  );
}
