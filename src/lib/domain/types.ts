export type Role = "P" | "D" | "C" | "A";

export const ROLES: Role[] = ["P", "D", "C", "A"];

export const ROLE_LABELS: Record<Role, string> = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};

export type RosterRules = Record<Role, number>;

export const CLASSIC_DEFAULT_ROSTER: RosterRules = { P: 3, D: 8, C: 8, A: 6 };

export type RosterCounts = Record<Role, number>;

/** Financial + roster snapshot of one fantasy team, derived from purchases. */
export interface TeamState {
  budget: number;
  spent: number;
  rosterCounts: RosterCounts;
}

export interface AuctionSettings {
  minBid: number;
  minIncrement: number;
}

export type BidRejectReason =
  | "AUCTION_NOT_ACTIVE"
  | "ALREADY_PASSED"
  | "ALREADY_LEADING"
  | "BID_TOO_LOW"
  | "BAD_AMOUNT"
  | "INSUFFICIENT_CREDITS"
  | "MAX_BID_EXCEEDED"
  | "ROLE_FULL"
  | "ROSTER_FULL"
  | "PLAYER_NOT_AVAILABLE"
  | "DUPLICATE_COMMAND"
  | "PASS_DISABLED"
  | "LEADER_CANNOT_PASS"
  | "PAUSED"
  | "UNAUTHORIZED"
  | "INVALID_TRANSITION"
  | "AUCTION_FINISHED";

export const REJECT_MESSAGES: Record<BidRejectReason, string> = {
  AUCTION_NOT_ACTIVE: "Asta non attiva per questo giocatore",
  ALREADY_PASSED: "Hai già passato su questo giocatore",
  ALREADY_LEADING: "Sei già in testa",
  BID_TOO_LOW: "Offerta troppo bassa",
  BAD_AMOUNT: "Importo non valido",
  INSUFFICIENT_CREDITS: "Credito insufficiente",
  MAX_BID_EXCEEDED: "Devi conservare crediti per completare la rosa",
  ROLE_FULL: "Reparto già completo",
  ROSTER_FULL: "Rosa già completa",
  PLAYER_NOT_AVAILABLE: "Giocatore non disponibile",
  DUPLICATE_COMMAND: "Comando duplicato",
  PASS_DISABLED: "Il passo non è abilitato",
  LEADER_CANNOT_PASS: "Sei in testa: non puoi passare",
  PAUSED: "Asta in pausa",
  UNAUTHORIZED: "Non autorizzato",
  INVALID_TRANSITION: "Operazione non valida in questo stato",
  AUCTION_FINISHED: "Asta terminata",
};

export type Verdict =
  | { ok: true }
  | { ok: false; reason: BidRejectReason; message: string };

export function reject(reason: BidRejectReason, message?: string): Verdict {
  return { ok: false, reason, message: message ?? REJECT_MESSAGES[reason] };
}

export const OK: Verdict = { ok: true };
