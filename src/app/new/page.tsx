"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAdminToken } from "@/lib/client/storage";
import { ROLE_LABELS, ROLES, Role } from "@/lib/domain/types";

const TEAM_COLORS = ["#22c55e", "#ef4444", "#a855f7", "#f59e0b", "#3b82f6", "#06b6d4", "#ec4899", "#eab308", "#f97316", "#14b8a6"];

interface TeamDraft {
  name: string;
  managerName: string;
  color: string;
  pin: string;
}

const STEPS = ["Generale", "Rosa", "Squadre", "Regole d'asta"];

export default function NewAuctionPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [season, setSeason] = useState("2026/27");
  const [ruleset, setRuleset] = useState<"CLASSIC" | "MANTRA">("CLASSIC");
  const [budget, setBudget] = useState(500);
  const [teamCount, setTeamCount] = useState(8);
  const [roster, setRoster] = useState<Record<Role, number>>({ P: 3, D: 8, C: 8, A: 6 });
  const [teams, setTeams] = useState<TeamDraft[]>([]);
  const [mode, setMode] = useState<"LIVE" | "MANUAL">("LIVE");
  const [minBid, setMinBid] = useState(1);
  const [minIncrement, setMinIncrement] = useState(1);
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [timerSeconds, setTimerSeconds] = useState(10);
  const [resetTimerOnBid, setResetTimerOnBid] = useState(true);
  const [nominationMode, setNominationMode] = useState("ADMIN_ONLY");
  const [autoAssign, setAutoAssign] = useState(true);
  const [passEnabled, setPassEnabled] = useState(true);

  function goToTeams() {
    if (teams.length !== teamCount) {
      setTeams(
        Array.from({ length: teamCount }, (_, i) =>
          teams[i] ?? {
            name: `Squadra ${i + 1}`,
            managerName: "",
            color: TEAM_COLORS[i % TEAM_COLORS.length],
            pin: "",
          },
        ),
      );
    }
    setStep(2);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Asta Fantacalcio",
          season,
          ruleset,
          mode,
          startingBudget: budget,
          minBid,
          minIncrement,
          timerEnabled,
          timerSeconds,
          resetTimerOnBid,
          nominationMode,
          autoAssign,
          passEnabled,
          rosterRules: roster,
          teams: teams.map((t) => ({
            name: t.name.trim() || "Senza nome",
            managerName: t.managerName.trim() || undefined,
            color: t.color,
            pin: /^\d{4}$/.test(t.pin) ? t.pin : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setAdminToken(data.auctionId, data.adminToken);
      router.push(`/a/${data.auctionId}/lobby`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
      setSubmitting(false);
    }
  }

  const input =
    "h-11 w-full rounded border border-ink-700 bg-ink-900 px-3 text-ink-100 focus:border-pitch-500 focus:outline-none";
  const label = "mb-1 block text-xs font-medium tracking-wider text-ink-400";

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">NUOVA ASTA</h1>
      <ol className="mt-4 mb-8 flex gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${
              i === step
                ? "bg-pitch-600/20 text-pitch-400"
                : i < step
                  ? "text-ink-300"
                  : "text-ink-400"
            }`}
          >
            <span className="font-display font-semibold">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="flex flex-col gap-5">
          <div>
            <label className={label}>NOME LEGA / ASTA</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Fanta Ignoranza 2026/27" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>STAGIONE</label>
              <input className={input} value={season} onChange={(e) => setSeason(e.target.value)} />
            </div>
            <div>
              <label className={label}>MODALITÀ RUOLI</label>
              <select className={input} value={ruleset} onChange={(e) => setRuleset(e.target.value as "CLASSIC" | "MANTRA")}>
                <option value="CLASSIC">Classic</option>
                <option value="MANTRA">Mantra</option>
              </select>
            </div>
            <div>
              <label className={label}>NUMERO SQUADRE</label>
              <input type="number" min={2} max={20} className={input} value={teamCount} onChange={(e) => setTeamCount(Math.max(2, Math.min(20, Number(e.target.value) || 2)))} />
            </div>
            <div>
              <label className={label}>CREDITI INIZIALI</label>
              <input type="number" min={1} className={input} value={budget} onChange={(e) => setBudget(Math.max(1, Number(e.target.value) || 500))} />
            </div>
          </div>
          <NavButtons onNext={() => setStep(1)} />
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-5">
          <p className="text-sm text-ink-300">Quanti giocatori per reparto deve comprare ogni squadra?</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {ROLES.map((r) => (
              <div key={r}>
                <label className={label}>
                  {r} — {ROLE_LABELS[r].toUpperCase()}
                </label>
                <input
                  type="number"
                  min={1}
                  max={15}
                  className={input}
                  value={roster[r]}
                  onChange={(e) => setRoster({ ...roster, [r]: Math.max(1, Math.min(15, Number(e.target.value) || 1)) })}
                />
              </div>
            ))}
          </div>
          <p className="text-sm text-ink-400">
            Totale rosa: <span className="font-semibold text-ink-100">{ROLES.reduce((s, r) => s + roster[r], 0)} giocatori</span>
          </p>
          <NavButtons onBack={() => setStep(0)} onNext={goToTeams} />
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-3">
          {teams.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-ink-700 bg-ink-850 p-3">
              <input
                type="color"
                value={t.color}
                onChange={(e) => updateTeam(i, { color: e.target.value })}
                className="h-9 w-9 shrink-0 cursor-pointer rounded border-none bg-transparent"
                title="Colore"
              />
              <input
                className={`${input} h-9 min-w-40 flex-1`}
                value={t.name}
                onChange={(e) => updateTeam(i, { name: e.target.value })}
                placeholder={`Squadra ${i + 1}`}
              />
              <input
                className={`${input} h-9 w-36`}
                value={t.managerName}
                onChange={(e) => updateTeam(i, { managerName: e.target.value })}
                placeholder="Allenatore"
              />
              <input
                className={`${input} h-9 w-24 text-center tracking-widest`}
                value={t.pin}
                maxLength={4}
                inputMode="numeric"
                onChange={(e) => updateTeam(i, { pin: e.target.value.replace(/\D/g, "") })}
                placeholder="PIN"
                title="PIN opzionale a 4 cifre"
              />
              <div className="flex gap-1">
                <button type="button" onClick={() => moveTeam(i, -1)} disabled={i === 0} className="h-9 w-9 rounded border border-ink-700 text-ink-300 disabled:opacity-30">↑</button>
                <button type="button" onClick={() => moveTeam(i, 1)} disabled={i === teams.length - 1} className="h-9 w-9 rounded border border-ink-700 text-ink-300 disabled:opacity-30">↓</button>
                <button type="button" onClick={() => removeTeam(i)} disabled={teams.length <= 2} className="h-9 w-9 rounded border border-ink-700 text-role-a disabled:opacity-30">✕</button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTeams([...teams, { name: `Squadra ${teams.length + 1}`, managerName: "", color: TEAM_COLORS[teams.length % TEAM_COLORS.length], pin: "" }])}
            className="rounded border border-dashed border-ink-600 py-2.5 text-sm text-ink-300 hover:border-pitch-500 hover:text-pitch-400"
          >
            + AGGIUNGI SQUADRA
          </button>
          <NavButtons onBack={() => setStep(1)} onNext={() => setStep(3)} />
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>MODALITÀ ASTA</label>
              <select className={input} value={mode} onChange={(e) => setMode(e.target.value as "LIVE" | "MANUAL")}>
                <option value="LIVE">Live — tutti rilanciano dal telefono</option>
                <option value="MANUAL">Manuale — si rilancia a voce, l&apos;admin registra</option>
              </select>
            </div>
            <div>
              <label className={label}>NOMINA GIOCATORI</label>
              <select className={input} value={nominationMode} onChange={(e) => setNominationMode(e.target.value)}>
                <option value="ADMIN_ONLY">Solo admin</option>
                <option value="ROUND_ROBIN">A giro (round robin)</option>
                <option value="RANDOM_PLAYER">Giocatore casuale</option>
                <option value="RANDOM_BY_ROLE">Casuale per ruolo</option>
              </select>
            </div>
            <div>
              <label className={label}>OFFERTA MINIMA</label>
              <input type="number" min={1} className={input} value={minBid} onChange={(e) => setMinBid(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div>
              <label className={label}>RILANCIO MINIMO</label>
              <input type="number" min={1} className={input} value={minIncrement} onChange={(e) => setMinIncrement(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div>
              <label className={label}>TIMER (SECONDI)</label>
              <input type="number" min={3} max={600} disabled={!timerEnabled} className={`${input} disabled:opacity-50`} value={timerSeconds} onChange={(e) => setTimerSeconds(Math.max(3, Math.min(600, Number(e.target.value) || 10)))} />
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            <Check label="Timer attivo" checked={timerEnabled} onChange={setTimerEnabled} />
            <Check label="Il timer riparte a ogni rilancio" checked={resetTimerOnBid} onChange={setResetTimerOnBid} />
            <Check label="Assegna automaticamente allo scadere del timer" checked={autoAssign} onChange={setAutoAssign} />
            <Check label="I partecipanti possono passare" checked={passEnabled} onChange={setPassEnabled} />
          </div>
          {error && <p className="text-sm text-role-a">{error}</p>}
          <NavButtons onBack={() => setStep(2)} onNext={submit} nextLabel={submitting ? "CREAZIONE…" : "CREA L'ASTA"} nextDisabled={submitting} />
        </section>
      )}
    </main>
  );

  function updateTeam(i: number, patch: Partial<TeamDraft>) {
    setTeams(teams.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function moveTeam(i: number, delta: number) {
    const next = [...teams];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    setTeams(next);
  }
  function removeTeam(i: number) {
    setTeams(teams.filter((_, j) => j !== i));
  }
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-100">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
      {label}
    </label>
  );
}

function NavButtons({ onBack, onNext, nextLabel = "AVANTI", nextDisabled }: { onBack?: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean }) {
  return (
    <div className="mt-2 flex justify-between">
      {onBack ? (
        <button type="button" onClick={onBack} className="rounded border border-ink-700 px-5 py-2.5 font-display text-ink-300 hover:border-ink-600">
          INDIETRO
        </button>
      ) : (
        <span />
      )}
      <button type="button" onClick={onNext} disabled={nextDisabled} className="rounded bg-pitch-600 px-6 py-2.5 font-display text-lg font-semibold text-white hover:bg-pitch-500 disabled:opacity-60">
        {nextLabel}
      </button>
    </div>
  );
}
