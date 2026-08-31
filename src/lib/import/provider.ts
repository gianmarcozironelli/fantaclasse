import type { Role } from "../domain/types";

/** Normalized player record produced by any provider. */
export interface PlayerInput {
  externalId?: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  teamName: string;
  teamAbbr: string;
  role: Role;
  mantraRoles?: string[];
  initialQuotation: number;
  currentQuotation: number;
  fvm?: number | null;
  imageUrl?: string | null;
}

export interface ParseResult {
  players: PlayerInput[];
  warnings: string[];
  source: string;
}

/**
 * Provider architecture: the app never depends on one website/format.
 * Implementations: CsvPlayerProvider (CSV/XLSX files, Fantacalcio.it layout
 * auto-detected), ManualPlayerProvider (hand-entered rows). A future
 * RemotePlayerProvider (API) only needs to implement this interface.
 */
export interface PlayerProvider {
  readonly name: string;
  parse(input: unknown): Promise<ParseResult>;
}

const TEAM_ABBR: Record<string, string> = {
  atalanta: "ATA",
  bologna: "BOL",
  cagliari: "CAG",
  como: "COM",
  cremonese: "CRE",
  empoli: "EMP",
  fiorentina: "FIO",
  frosinone: "FRO",
  genoa: "GEN",
  inter: "INT",
  juventus: "JUV",
  lazio: "LAZ",
  lecce: "LEC",
  milan: "MIL",
  monza: "MON",
  napoli: "NAP",
  parma: "PAR",
  pisa: "PIS",
  roma: "ROM",
  salernitana: "SAL",
  sampdoria: "SAM",
  sassuolo: "SAS",
  spezia: "SPE",
  torino: "TOR",
  udinese: "UDI",
  venezia: "VEN",
  verona: "VER",
  "hellas verona": "VER",
};

export function teamAbbreviation(teamName: string): string {
  const key = teamName.trim().toLowerCase();
  return TEAM_ABBR[key] ?? teamName.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase();
}

export function normalizeRole(raw: string): Role | null {
  const r = raw.trim().toUpperCase();
  if (r === "P" || r === "POR") return "P";
  if (r === "D" || r === "DIF") return "D";
  if (r === "C" || r === "CEN") return "C";
  if (r === "A" || r === "ATT") return "A";
  return null;
}

/**
 * Accent- and case-insensitive search key. Serie A rosters are full of
 * diacritics (Leão, Angeliño, Soulé) that nobody types mid-auction, so every
 * player carries a normalized name that plain ASCII queries match.
 */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[''`]/g, "")
    .toLowerCase()
    .trim();
}
