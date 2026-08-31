import {
  AuctionSettings,
  OK,
  Role,
  ROLES,
  RosterCounts,
  RosterRules,
  TeamState,
  Verdict,
  reject,
} from "./types";

export function remainingCredits(team: TeamState): number {
  return team.budget - team.spent;
}

export function totalSlots(rules: RosterRules): number {
  return ROLES.reduce((sum, r) => sum + rules[r], 0);
}

export function filledSlots(counts: RosterCounts): number {
  return ROLES.reduce((sum, r) => sum + counts[r], 0);
}

export function availableRosterSlots(
  rules: RosterRules,
  counts: RosterCounts,
): number {
  return ROLES.reduce(
    (sum, r) => sum + Math.max(0, rules[r] - counts[r]),
    0,
  );
}

export function roleSlotsRemaining(
  rules: RosterRules,
  counts: RosterCounts,
  role: Role,
): number {
  return Math.max(0, rules[role] - counts[role]);
}

export function rosterComplete(rules: RosterRules, counts: RosterCounts): boolean {
  return availableRosterSlots(rules, counts) === 0;
}

/**
 * The maximum a team may spend on ONE player while still being able to fill
 * every remaining roster slot at the minimum price:
 *   maxBid = remainingCredits - (slotsRemaining - 1) * minBid
 * Returns 0 when the roster is already complete or credits are exhausted.
 */
export function maxBid(
  team: TeamState,
  rules: RosterRules,
  minBid: number,
): number {
  const slots = availableRosterSlots(rules, team.rosterCounts);
  if (slots <= 0) return 0;
  return Math.max(0, remainingCredits(team) - (slots - 1) * minBid);
}

/** Role-aware max bid: 0 when the role's slots are already full. */
export function maxBidForRole(
  team: TeamState,
  rules: RosterRules,
  minBid: number,
  role: Role,
): number {
  if (roleSlotsRemaining(rules, team.rosterCounts, role) <= 0) return 0;
  return maxBid(team, rules, minBid);
}

export function avgPerRemainingSlot(
  team: TeamState,
  rules: RosterRules,
): number | null {
  const slots = availableRosterSlots(rules, team.rosterCounts);
  if (slots <= 0) return null;
  return Math.round((remainingCredits(team) / slots) * 10) / 10;
}

export interface BidContext {
  team: TeamState;
  rules: RosterRules;
  settings: AuctionSettings;
  role: Role;
  currentBid: number | null;
  amount: number;
  hasPassed: boolean;
  isLeader: boolean;
}

/** Full server-side validation of a live bid. Order matters: most specific first. */
export function canBid(ctx: BidContext): Verdict {
  const { team, rules, settings, role, currentBid, amount, hasPassed, isLeader } = ctx;

  if (!Number.isInteger(amount) || amount <= 0) return reject("BAD_AMOUNT");
  if (hasPassed) return reject("ALREADY_PASSED");
  if (isLeader) return reject("ALREADY_LEADING");

  if (availableRosterSlots(rules, team.rosterCounts) <= 0) {
    return reject("ROSTER_FULL");
  }
  if (roleSlotsRemaining(rules, team.rosterCounts, role) <= 0) {
    return reject("ROLE_FULL");
  }

  const floor =
    currentBid === null ? settings.minBid : currentBid + settings.minIncrement;
  if (amount < floor) {
    return reject(
      "BID_TOO_LOW",
      currentBid === null
        ? `L'offerta minima è ${settings.minBid}`
        : `Devi offrire almeno ${floor}`,
    );
  }

  if (amount > remainingCredits(team)) return reject("INSUFFICIENT_CREDITS");

  const cap = maxBidForRole(team, rules, settings.minBid, role);
  if (amount > cap) {
    const reserve = amount - cap;
    return reject(
      "MAX_BID_EXCEEDED",
      `Devi conservare ${reserve} credit${reserve === 1 ? "o" : "i"} per completare la rosa (massimo ${cap})`,
    );
  }

  return OK;
}

/**
 * Validation for assigning/purchasing a player at a final price (live win,
 * manual mode, edit-purchase, transfer). Same reserve rule as bidding.
 */
export function canAssign(
  team: TeamState,
  rules: RosterRules,
  role: Role,
  price: number,
  minBid: number,
): Verdict {
  if (!Number.isInteger(price) || price < 0) return reject("BAD_AMOUNT");
  if (availableRosterSlots(rules, team.rosterCounts) <= 0) {
    return reject("ROSTER_FULL");
  }
  if (roleSlotsRemaining(rules, team.rosterCounts, role) <= 0) {
    return reject("ROLE_FULL");
  }
  if (price > remainingCredits(team)) return reject("INSUFFICIENT_CREDITS");
  const cap = maxBidForRole(team, rules, minBid, role);
  if (price > cap) {
    return reject(
      "MAX_BID_EXCEEDED",
      `Prezzo massimo consentito: ${cap} (riserva per completare la rosa)`,
    );
  }
  return OK;
}
