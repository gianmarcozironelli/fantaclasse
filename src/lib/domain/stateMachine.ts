export type AuctionStatus =
  | "AUCTION_NOT_STARTED"
  | "PLAYER_SELECTION"
  | "PLAYER_ACTIVE"
  | "PLAYER_CLOSING"
  | "PLAYER_SOLD"
  | "PLAYER_UNSOLD"
  | "PAUSED"
  | "FINISHED";

/** Allowed transitions of Auction.status. PAUSED resumes to pausedFromStatus. */
const TRANSITIONS: Record<AuctionStatus, AuctionStatus[]> = {
  AUCTION_NOT_STARTED: ["PLAYER_SELECTION", "FINISHED"],
  PLAYER_SELECTION: ["PLAYER_ACTIVE", "PLAYER_SOLD", "PAUSED", "FINISHED"],
  // PLAYER_SELECTION -> PLAYER_SOLD is the one-shot manual-mode assignment
  PLAYER_ACTIVE: ["PLAYER_CLOSING", "PLAYER_SOLD", "PLAYER_UNSOLD", "PLAYER_SELECTION", "PAUSED"],
  // ACTIVE -> SELECTION is admin cancel_current
  PLAYER_CLOSING: ["PLAYER_ACTIVE", "PLAYER_SOLD", "PLAYER_UNSOLD", "PLAYER_SELECTION", "PAUSED"],
  // CLOSING -> ACTIVE is a late in-grace bid reopening the auction
  PLAYER_SOLD: ["PLAYER_SELECTION", "FINISHED"],
  PLAYER_UNSOLD: ["PLAYER_SELECTION", "FINISHED"],
  PAUSED: ["PLAYER_SELECTION", "PLAYER_ACTIVE", "PLAYER_CLOSING", "FINISHED"],
  FINISHED: ["PLAYER_SELECTION"], // reopen after undo from the summary screen
};

export function canTransition(from: AuctionStatus, to: AuctionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** States in which a player is on the block. */
export function isPlayerLive(status: AuctionStatus): boolean {
  return status === "PLAYER_ACTIVE" || status === "PLAYER_CLOSING";
}

/** States in which participant bids are accepted. */
export function acceptsBids(status: AuctionStatus): boolean {
  return status === "PLAYER_ACTIVE" || status === "PLAYER_CLOSING";
}
