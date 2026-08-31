import {
  ParseResult,
  PlayerInput,
  PlayerProvider,
  normalizeRole,
  teamAbbreviation,
} from "./provider";

export interface ManualProviderInput {
  displayName: string;
  teamName: string;
  role: string;
  quotation?: number;
  fvm?: number | null;
}

/** Single hand-entered player (admin "add player" form). */
export class ManualPlayerProvider implements PlayerProvider {
  readonly name = "manual";

  async parse(input: ManualProviderInput): Promise<ParseResult> {
    const role = normalizeRole(input.role);
    if (!role || !input.displayName.trim()) {
      return { players: [], warnings: ["Dati giocatore non validi"], source: this.name };
    }
    const q = Math.max(1, Math.round(input.quotation ?? 1));
    const player: PlayerInput = {
      displayName: input.displayName.trim(),
      teamName: input.teamName.trim() || "N/D",
      teamAbbr: teamAbbreviation(input.teamName),
      role,
      initialQuotation: q,
      currentQuotation: q,
      fvm: input.fvm ?? null,
    };
    return { players: [player], warnings: [], source: this.name };
  }
}
