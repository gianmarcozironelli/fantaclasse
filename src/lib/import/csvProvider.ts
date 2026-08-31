import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  ParseResult,
  PlayerInput,
  PlayerProvider,
  normalizeRole,
  teamAbbreviation,
} from "./provider";

export interface CsvProviderInput {
  buffer: Buffer;
  filename: string;
}

type Row = Record<string, string | number | null | undefined>;

function str(v: string | number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function num(v: string | number | null | undefined): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Find the actual header row: Fantacalcio.it exports have a title row first. */
function normalizeRows(rows: (string | number | null)[][]): Row[] {
  const headerIdx = rows.findIndex((r) => {
    const cells = r.map((c) => str(c).toLowerCase());
    return (
      cells.includes("nome") ||
      (cells.includes("name") && (cells.includes("role") || cells.includes("ruolo")))
    );
  });
  if (headerIdx === -1) return [];
  const header = rows[headerIdx].map((c) => str(c));
  return rows.slice(headerIdx + 1).map((r) => {
    const row: Row = {};
    header.forEach((h, i) => {
      if (h) row[h] = r[i] ?? "";
    });
    return row;
  });
}

function pick(row: Row, ...names: string[]): string | number | null | undefined {
  for (const n of names) {
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === n.toLowerCase()) return row[key];
    }
  }
  return undefined;
}

/**
 * CSV/XLSX provider. Understands:
 *  - the official Fantacalcio.it "Quotazioni" export
 *    (Id, R, RM, Nome, Squadra, Qt.A, Qt.I, FVM, …)
 *  - any generic sheet with Nome/Name, Ruolo/Role/R, Squadra/Team columns.
 */
export class CsvPlayerProvider implements PlayerProvider {
  readonly name = "csv";

  async parse(input: CsvProviderInput): Promise<ParseResult> {
    const { buffer, filename } = input;
    let rawRows: (string | number | null)[][];

    if (/\.(xlsx|xls)$/i.test(filename)) {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
        header: 1,
        defval: "",
      });
    } else {
      const text = buffer.toString("utf-8");
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      rawRows = parsed.data;
    }

    const rows = normalizeRows(rawRows);
    const warnings: string[] = [];
    const players: PlayerInput[] = [];

    for (const [i, row] of rows.entries()) {
      const nameRaw = str(pick(row, "Nome", "Name", "Giocatore", "Player"));
      if (!nameRaw) continue;
      const roleRaw = str(pick(row, "R", "Ruolo", "Role"));
      const role = normalizeRole(roleRaw);
      if (!role) {
        warnings.push(`Riga ${i + 1}: ruolo non valido "${roleRaw}" per ${nameRaw}`);
        continue;
      }
      const teamName = str(pick(row, "Squadra", "Team", "Club")) || "N/D";
      const qtA = num(pick(row, "Qt.A", "QtA", "Quotazione", "Qt", "Quota"));
      const qtI = num(pick(row, "Qt.I", "QtI", "Quotazione iniziale"));
      const fvmRaw = pick(row, "FVM", "FVM / 1000", "FVM/1000");
      const externalId = str(pick(row, "Id", "ID", "Cod.", "Codice"));
      const mantra = str(pick(row, "RM", "Ruoli Mantra", "Mantra"));

      players.push({
        externalId: externalId ? `fc-${externalId}` : undefined,
        displayName: nameRaw,
        teamName,
        teamAbbr: str(pick(row, "Sigla", "Abbr")) || teamAbbreviation(teamName),
        role,
        mantraRoles: mantra ? mantra.split(/[;,]/).map((m) => m.trim()).filter(Boolean) : [],
        initialQuotation: qtI || qtA || 1,
        currentQuotation: qtA || qtI || 1,
        fvm: fvmRaw !== undefined && str(fvmRaw) !== "" ? num(fvmRaw) : null,
      });
    }

    if (players.length === 0) {
      warnings.push(
        "Nessun giocatore riconosciuto: servono almeno le colonne Nome, R/Ruolo, Squadra",
      );
    }
    return { players, warnings, source: this.name };
  }
}
