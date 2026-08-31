import type { AuctionStatus } from "./domain/stateMachine";
import type { Role, RosterRules } from "./domain/types";

/** Public info about the player currently on the block. */
export interface SnapshotPlayer {
  id: string;
  displayName: string;
  teamName: string;
  teamAbbr: string;
  role: Role;
  mantraRoles: string[];
  quotation: number;
  initialQuotation: number;
  fvm: number | null;
  imageUrl: string | null;
}

export interface SnapshotBid {
  teamId: string;
  amount: number;
  at: string;
}

export interface SnapshotCurrent {
  auctionPlayerId: string;
  player: SnapshotPlayer;
  status: "ACTIVE" | "CLOSING" | "SOLD" | "UNSOLD";
  currentBid: number | null;
  leaderTeamId: string | null;
  closesAt: string | null;
  bids: SnapshotBid[];
  passedTeamIds: string[];
  /** set on SOLD flash */
  soldToTeamId?: string | null;
  soldPrice?: number | null;
}

export interface SnapshotTeam {
  id: string;
  name: string;
  managerName: string | null;
  color: string | null;
  sortOrder: number;
  credits: number;
  spent: number;
  maxBid: number;
  roster: Record<Role, { filled: number; max: number }>;
  slotsRemaining: number;
  avgPerRemainingSlot: number | null;
  connected: boolean;
  hasPassed: boolean;
  isLeading: boolean;
  isBot: boolean;
}

export interface Snapshot {
  seq: number;
  auction: {
    id: string;
    name: string;
    season: string;
    status: AuctionStatus;
    mode: "LIVE" | "MANUAL" | "WILD" | "POKER" | "SEALED";
    rosterRules: RosterRules;
    minBid: number;
    minIncrement: number;
    timerEnabled: boolean;
    timerSeconds: number;
    resetTimerOnBid: boolean;
    nominationMode: string;
    autoAssign: boolean;
    passEnabled: boolean;
    hideSoldPlayers: boolean;
    botsEnabled: boolean;
    isDemo: boolean;
  };
  current: SnapshotCurrent | null;
  teams: SnapshotTeam[];
  counts: { available: number; sold: number; unsold: number; total: number };
  nominationTurnTeamId: string | null;
  finished: boolean;
}

export interface PrivateState {
  teamId: string;
  participantId: string;
  watchlist: {
    playerId: string;
    priority: number;
    targetPrice: number | null;
    maxPrice: number | null;
    notes: string | null;
  }[];
}

export interface Toast {
  type: string;
  message: string;
  at: string;
}

export type ParticipantCommand =
  | { type: "bid"; amount: number }
  | { type: "pass" }
  | { type: "nominate"; playerId: string };

export type AdminCommand =
  | { type: "start_auction" }
  | { type: "start_player"; playerId: string }
  | { type: "random_player"; role?: Role }
  | { type: "close_bidding" }
  | { type: "assign_current" }
  | { type: "manual_assign"; playerId: string; teamId: string; price: number }
  | { type: "mark_unsold" }
  | { type: "cancel_current" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "undo_last" }
  | { type: "edit_purchase"; purchaseId: string; teamId?: string; price?: number }
  | { type: "release_player"; purchaseId: string; refundPct?: number; refundCredits?: number }
  | { type: "transfer_player"; purchaseId: string; toTeamId: string; creditAdjustment?: number }
  | { type: "override_pass"; teamId: string }
  | { type: "set_bots"; enabled: boolean }
  | { type: "finish_auction" }
  | { type: "reopen_auction" };

export type CommandInput = ParticipantCommand | AdminCommand;
export type Command = CommandInput & { commandId: string };

export type CmdAck =
  | { ok: true }
  | { ok: false; reason: string; message: string };
