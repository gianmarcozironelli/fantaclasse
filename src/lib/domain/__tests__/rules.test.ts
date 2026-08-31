import { describe, expect, it } from "vitest";
import {
  availableRosterSlots,
  avgPerRemainingSlot,
  canAssign,
  canBid,
  maxBid,
  maxBidForRole,
  remainingCredits,
  rosterComplete,
} from "../rules";
import { CLASSIC_DEFAULT_ROSTER, TeamState } from "../types";
import { canTransition } from "../stateMachine";
import { CommandQueue } from "../../../server/queue";

const RULES = CLASSIC_DEFAULT_ROSTER; // 3P 8D 8C 6A = 25 slots
const SETTINGS = { minBid: 1, minIncrement: 1 };

function team(partial: Partial<TeamState> = {}): TeamState {
  return {
    budget: 500,
    spent: 0,
    rosterCounts: { P: 0, D: 0, C: 0, A: 0 },
    ...partial,
  };
}

describe("remainingCredits", () => {
  it("derives credits from budget minus spend", () => {
    expect(remainingCredits(team({ spent: 263 }))).toBe(237);
  });
});

describe("availableRosterSlots", () => {
  it("counts all open slots", () => {
    expect(availableRosterSlots(RULES, { P: 0, D: 0, C: 0, A: 0 })).toBe(25);
    expect(availableRosterSlots(RULES, { P: 3, D: 5, C: 2, A: 1 })).toBe(14);
    expect(availableRosterSlots(RULES, { P: 3, D: 8, C: 8, A: 6 })).toBe(0);
  });

  it("never counts over-filled roles as negative", () => {
    expect(availableRosterSlots(RULES, { P: 4, D: 8, C: 8, A: 6 })).toBe(0);
  });
});

describe("maxBid — the reserve rule", () => {
  it("keeps 1 credit per other remaining slot (brief §6 example)", () => {
    // 100 credits, 4 players still needed, min cost 1 → max bid 97
    const t = team({
      budget: 100,
      spent: 0,
      rosterCounts: { P: 3, D: 8, C: 8, A: 2 }, // 4 attackers missing… wait A max 6
    });
    // 21 filled of 25 → 4 remaining
    expect(availableRosterSlots(RULES, t.rosterCounts)).toBe(4);
    expect(maxBid(t, RULES, 1)).toBe(97);
  });

  it("allows full remaining credits on the last slot", () => {
    const t = team({
      budget: 500,
      spent: 400,
      rosterCounts: { P: 3, D: 8, C: 8, A: 5 },
    });
    expect(maxBid(t, RULES, 1)).toBe(100);
  });

  it("is 0 when the roster is complete", () => {
    const t = team({ rosterCounts: { P: 3, D: 8, C: 8, A: 6 } });
    expect(maxBid(t, RULES, 1)).toBe(0);
  });

  it("never goes negative", () => {
    const t = team({ budget: 10, spent: 0 }); // 25 slots, reserve 24 > 10
    expect(maxBid(t, RULES, 1)).toBe(0);
  });

  it("scales with minimum bid", () => {
    const t = team({ budget: 100 });
    // 25 slots, minBid 2 → 100 - 24*2 = 52
    expect(maxBid(t, RULES, 2)).toBe(52);
  });
});

describe("maxBidForRole", () => {
  it("is 0 for a full role even with credits left", () => {
    const t = team({ rosterCounts: { P: 3, D: 0, C: 0, A: 0 } });
    expect(maxBidForRole(t, RULES, 1, "P")).toBe(0);
    expect(maxBidForRole(t, RULES, 1, "D")).toBeGreaterThan(0);
  });
});

describe("canBid", () => {
  it("rejects a bid over remaining budget", () => {
    const t = team({ spent: 450 }); // 50 left
    const v = canBid({
      team: t, rules: RULES, settings: SETTINGS, role: "A",
      currentBid: 40, amount: 60, hasPassed: false, isLeader: false,
    });
    expect(v).toMatchObject({ ok: false, reason: "INSUFFICIENT_CREDITS" });
  });

  it("rejects a bid that breaks the roster reserve", () => {
    const t = team({ budget: 100 }); // 25 slots → cap 76
    const v = canBid({
      team: t, rules: RULES, settings: SETTINGS, role: "A",
      currentBid: 76, amount: 77, hasPassed: false, isLeader: false,
    });
    expect(v).toMatchObject({ ok: false, reason: "MAX_BID_EXCEEDED" });
  });

  it("accepts spending everything on the very last roster slot", () => {
    const t = team({ spent: 300, rosterCounts: { P: 3, D: 8, C: 8, A: 5 } });
    const v = canBid({
      team: t, rules: RULES, settings: SETTINGS, role: "A",
      currentBid: 150, amount: 200, hasPassed: false, isLeader: false,
    });
    expect(v).toEqual({ ok: true });
  });

  it("rejects bids for a full role", () => {
    const t = team({ rosterCounts: { P: 3, D: 0, C: 0, A: 0 } });
    const v = canBid({
      team: t, rules: RULES, settings: SETTINGS, role: "P",
      currentBid: null, amount: 5, hasPassed: false, isLeader: false,
    });
    expect(v).toMatchObject({ ok: false, reason: "ROLE_FULL" });
  });

  it("rejects when the whole roster is complete", () => {
    const t = team({ rosterCounts: { P: 3, D: 8, C: 8, A: 6 } });
    const v = canBid({
      team: t, rules: RULES, settings: SETTINGS, role: "A",
      currentBid: null, amount: 5, hasPassed: false, isLeader: false,
    });
    expect(v).toMatchObject({ ok: false, reason: "ROSTER_FULL" });
  });

  it("enforces the increment", () => {
    const v = canBid({
      team: team(), rules: RULES, settings: { minBid: 1, minIncrement: 5 },
      role: "A", currentBid: 40, amount: 42, hasPassed: false, isLeader: false,
    });
    expect(v).toMatchObject({ ok: false, reason: "BID_TOO_LOW" });
  });

  it("first bid must reach the starting bid", () => {
    const v = canBid({
      team: team(), rules: RULES, settings: { minBid: 5, minIncrement: 1 },
      role: "A", currentBid: null, amount: 4, hasPassed: false, isLeader: false,
    });
    expect(v).toMatchObject({ ok: false, reason: "BID_TOO_LOW" });
  });

  it("rejects after passing and when already leading", () => {
    expect(canBid({
      team: team(), rules: RULES, settings: SETTINGS, role: "A",
      currentBid: 10, amount: 11, hasPassed: true, isLeader: false,
    })).toMatchObject({ ok: false, reason: "ALREADY_PASSED" });
    expect(canBid({
      team: team(), rules: RULES, settings: SETTINGS, role: "A",
      currentBid: 10, amount: 11, hasPassed: false, isLeader: true,
    })).toMatchObject({ ok: false, reason: "ALREADY_LEADING" });
  });

  it("rejects non-integer and non-positive amounts", () => {
    for (const amount of [0, -3, 1.5, NaN]) {
      expect(canBid({
        team: team(), rules: RULES, settings: SETTINGS, role: "A",
        currentBid: null, amount, hasPassed: false, isLeader: false,
      })).toMatchObject({ ok: false, reason: "BAD_AMOUNT" });
    }
  });
});

describe("canAssign (manual mode / final purchase)", () => {
  it("applies the same reserve rule", () => {
    const t = team({ budget: 100 });
    expect(canAssign(t, RULES, "A", 77, 1)).toMatchObject({
      ok: false,
      reason: "MAX_BID_EXCEEDED",
    });
    expect(canAssign(t, RULES, "A", 76, 1)).toEqual({ ok: true });
  });

  it("credits can never go negative", () => {
    const t = team({ spent: 499, rosterCounts: { P: 3, D: 8, C: 8, A: 5 } });
    expect(canAssign(t, RULES, "A", 2, 1)).toMatchObject({
      ok: false,
      reason: "INSUFFICIENT_CREDITS",
    });
    expect(canAssign(t, RULES, "A", 1, 1)).toEqual({ ok: true });
  });
});

describe("state machine", () => {
  it("follows the documented transitions", () => {
    expect(canTransition("AUCTION_NOT_STARTED", "PLAYER_SELECTION")).toBe(true);
    expect(canTransition("PLAYER_SELECTION", "PLAYER_ACTIVE")).toBe(true);
    expect(canTransition("PLAYER_ACTIVE", "PLAYER_CLOSING")).toBe(true);
    expect(canTransition("PLAYER_CLOSING", "PLAYER_ACTIVE")).toBe(true); // late bid
    expect(canTransition("PLAYER_CLOSING", "PLAYER_SOLD")).toBe(true);
    expect(canTransition("PLAYER_SOLD", "PLAYER_SELECTION")).toBe(true);
    expect(canTransition("PLAYER_SELECTION", "FINISHED")).toBe(true);
  });

  it("rejects nonsense transitions", () => {
    expect(canTransition("AUCTION_NOT_STARTED", "PLAYER_SOLD")).toBe(false);
    expect(canTransition("PLAYER_SOLD", "PLAYER_ACTIVE")).toBe(false);
    expect(canTransition("FINISHED", "PLAYER_ACTIVE")).toBe(false);
  });
});

describe("sequential command queue (simultaneous bids)", () => {
  it("processes commands strictly in arrival order", async () => {
    const q = new CommandQueue();
    const order: number[] = [];
    const jobs = [1, 2, 3, 4, 5].map((n) =>
      q.run(async () => {
        // later jobs get shorter delays — without the queue they'd finish first
        await new Promise((r) => setTimeout(r, (6 - n) * 5));
        order.push(n);
        return n;
      }),
    );
    await Promise.all(jobs);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it("only the first of two equal simultaneous bids wins", async () => {
    const q = new CommandQueue();
    let currentBid = 40;
    let leader = "";
    const placeBid = (teamId: string, amount: number) =>
      q.run(async () => {
        if (amount <= currentBid) return { ok: false as const };
        currentBid = amount;
        leader = teamId;
        return { ok: true as const };
      });
    const [a, b] = await Promise.all([
      placeBid("team-A", 41),
      placeBid("team-B", 41),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(leader).toBe("team-A");
    expect(currentBid).toBe(41);
  });

  it("survives a command that throws", async () => {
    const q = new CommandQueue();
    await expect(q.run(async () => { throw new Error("boom"); })).rejects.toThrow();
    await expect(q.run(async () => "alive")).resolves.toBe("alive");
  });
});

describe("derived helpers", () => {
  it("rosterComplete and avgPerRemainingSlot", () => {
    expect(rosterComplete(RULES, { P: 3, D: 8, C: 8, A: 6 })).toBe(true);
    const t = team({ spent: 312, rosterCounts: { P: 3, D: 5, C: 2, A: 1 } });
    // 188 credits, 14 slots → 13.4
    expect(avgPerRemainingSlot(t, RULES)).toBe(13.4);
    expect(
      avgPerRemainingSlot(team({ rosterCounts: { P: 3, D: 8, C: 8, A: 6 } }), RULES),
    ).toBeNull();
  });
});
