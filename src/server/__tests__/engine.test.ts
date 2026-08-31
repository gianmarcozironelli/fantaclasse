import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "socket.io";
import { createServer } from "node:http";
import { prisma } from "../prisma";
import { AuctionEngine } from "../engine";
import { generateJoinCode, generateToken } from "../tokens";
import { ensurePlayersSeeded } from "../players";

/**
 * Integration tests against the real database: the transactional purchase
 * path, undo, duplicate commands, sold players and roster/budget limits.
 */

let engine: AuctionEngine;
let auctionId: string;
const teams: { id: string; name: string }[] = [];
let players: { id: string; displayName: string; role: string }[] = [];
const httpServer = createServer();
const io = new Server(httpServer);

let cmdSeq = 0;
const cid = () => `test-${Date.now()}-${++cmdSeq}`;

async function bid(teamId: string, amount: number, commandId = cid()) {
  return engine.handleCommand({ kind: "participant", teamId }, { type: "bid", amount, commandId });
}
async function admin(cmd: Record<string, unknown>) {
  return engine.handleCommand({ kind: "admin" }, { commandId: cid(), ...cmd } as never);
}
function snap() {
  return engine.buildSnapshot();
}
function team(id: string) {
  return snap().teams.find((t) => t.id === id)!;
}

beforeAll(async () => {
  await ensurePlayersSeeded();

  const auction = await prisma.auction.create({
    data: {
      name: `TEST ${Date.now()}`,
      adminToken: generateToken(),
      status: "PLAYER_SELECTION",
      startingBudget: 500,
      timerEnabled: false, // deterministic: no timer races in tests
      autoAssign: false,
      rosterRules: {
        create: [
          { role: "P", slots: 1 },
          { role: "D", slots: 1 },
          { role: "C", slots: 1 },
          { role: "A", slots: 2 },
        ],
      },
    },
  });
  auctionId = auction.id;

  for (const name of ["Alpha", "Beta", "Gamma"]) {
    const t = await prisma.fantasyTeam.create({
      data: { auctionId, name, joinCode: generateJoinCode(), sortOrder: teams.length },
    });
    teams.push({ id: t.id, name: t.name });
  }

  const attackers = await prisma.player.findMany({ where: { role: "A" }, take: 4 });
  const others = await prisma.player.findMany({ where: { role: "D" }, take: 2 });
  players = [...attackers, ...others].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    role: p.role,
  }));

  engine = (await AuctionEngine.load(auctionId, io))!;
});

afterAll(async () => {
  engine?.dispose();
  await prisma.auction.delete({ where: { id: auctionId } }).catch(() => {});
  await prisma.$disconnect();
  io.close();
  httpServer.close();
});

describe("live bidding and assignment", () => {
  it("runs a full player cycle and updates credits, roster and maxBid", async () => {
    expect((await admin({ type: "start_player", playerId: players[0].id })).ok).toBe(true);

    expect((await bid(teams[0].id, 10)).ok).toBe(true);
    expect((await bid(teams[1].id, 20)).ok).toBe(true);

    // the leader cannot outbid themselves
    expect(await bid(teams[1].id, 30)).toMatchObject({ reason: "ALREADY_LEADING" });
    // below the current bid is rejected
    expect(await bid(teams[0].id, 15)).toMatchObject({ reason: "BID_TOO_LOW" });

    expect((await admin({ type: "assign_current" })).ok).toBe(true);

    const winner = team(teams[1].id);
    expect(winner.credits).toBe(480);
    expect(winner.spent).toBe(20);
    expect(winner.roster.A.filled).toBe(1);
    // 5 slots total, 4 remaining after this purchase → 480 - 3 = 477
    expect(winner.maxBid).toBe(477);
    expect(team(teams[0].id).credits).toBe(500);
  });

  it("rejects a bid on an already-sold player", async () => {
    const ack = await admin({ type: "start_player", playerId: players[0].id });
    expect(ack).toMatchObject({ ok: false, reason: "PLAYER_NOT_AVAILABLE" });
  });

  it("dedupes a retried command id", async () => {
    await admin({ type: "start_player", playerId: players[1].id });
    const dupId = cid();
    expect((await bid(teams[0].id, 12, dupId)).ok).toBe(true);
    expect(await bid(teams[2].id, 30, dupId)).toMatchObject({ reason: "DUPLICATE_COMMAND" });
    // the duplicate must not have changed the leader
    expect(snap().current?.leaderTeamId).toBe(teams[0].id);
    expect(snap().current?.currentBid).toBe(12);
  });

  it("processes simultaneous bids sequentially — only the first wins the value", async () => {
    const [a, b] = await Promise.all([bid(teams[1].id, 40), bid(teams[2].id, 40)]);
    expect([a.ok, b.ok]).toEqual([true, false]);
    expect(snap().current?.leaderTeamId).toBe(teams[1].id);
    expect(snap().current?.currentBid).toBe(40);
  });

  it("enforces pass: a passed team cannot bid again on the same player", async () => {
    expect((await engine.handleCommand({ kind: "participant", teamId: teams[0].id }, { type: "pass", commandId: cid() })).ok).toBe(true);
    expect(await bid(teams[0].id, 60)).toMatchObject({ reason: "ALREADY_PASSED" });
    expect(team(teams[0].id).hasPassed).toBe(true);

    // admin can override the pass
    expect((await admin({ type: "override_pass", teamId: teams[0].id })).ok).toBe(true);
    expect((await bid(teams[0].id, 60)).ok).toBe(true);

    await admin({ type: "assign_current" });
    expect(team(teams[0].id).spent).toBe(60);
  });

  it("blocks a purchase that would fill a role beyond its limit", async () => {
    // teams[0] has 1 A (limit 2). Fill the second, then the third must fail.
    await admin({ type: "manual_assign", playerId: players[2].id, teamId: teams[0].id, price: 5 });
    expect(team(teams[0].id).roster.A.filled).toBe(2);

    const ack = await admin({ type: "manual_assign", playerId: players[3].id, teamId: teams[0].id, price: 5 });
    expect(ack).toMatchObject({ ok: false, reason: "ROLE_FULL" });
  });

  it("blocks a price that breaks the roster reserve", async () => {
    // teams[2] untouched: 500 credits, 5 slots → max 496
    const ack = await admin({ type: "manual_assign", playerId: players[3].id, teamId: teams[2].id, price: 497 });
    expect(ack).toMatchObject({ ok: false, reason: "MAX_BID_EXCEEDED" });

    const ok = await admin({ type: "manual_assign", playerId: players[3].id, teamId: teams[2].id, price: 496 });
    expect(ok.ok).toBe(true);
    expect(team(teams[2].id).credits).toBe(4);
    // 4 credits, 4 slots left → cannot spend more than 1 on the next player
    expect(team(teams[2].id).maxBid).toBe(1);
  });
});

describe("admin corrections", () => {
  it("undo returns the player to the pool and restores credits", async () => {
    const before = team(teams[2].id).credits;
    expect((await admin({ type: "undo_last" })).ok).toBe(true);
    expect(team(teams[2].id).credits).toBe(before + 496);
    expect(team(teams[2].id).roster.A.filled).toBe(0);

    // the player is available again
    const ap = await prisma.auctionPlayer.findFirst({
      where: { auctionId, playerId: players[3].id },
    });
    expect(ap?.status).toBe("AVAILABLE");
    // history is preserved, not deleted
    const voided = await prisma.purchase.findFirst({
      where: { auctionPlayerId: ap!.id, voided: true },
    });
    expect(voided).not.toBeNull();
  });

  it("edit_purchase moves a player and re-validates the budget", async () => {
    const purchase = await prisma.purchase.findFirst({
      where: { voided: false, fantasyTeamId: teams[0].id, auctionPlayer: { auctionId } },
      orderBy: { createdAt: "desc" },
    });
    const ack = await admin({ type: "edit_purchase", purchaseId: purchase!.id, price: 9 });
    expect(ack.ok).toBe(true);
    const updated = await prisma.purchase.findUnique({ where: { id: purchase!.id } });
    expect(updated?.price).toBe(9);
  });

  it("release_player refunds a percentage and frees the player", async () => {
    const purchase = await prisma.purchase.findFirst({
      where: { voided: false, fantasyTeamId: teams[1].id, auctionPlayer: { auctionId } },
    });
    const creditsBefore = team(teams[1].id).credits;
    const ack = await admin({ type: "release_player", purchaseId: purchase!.id, refundPct: 50 });
    expect(ack.ok).toBe(true);
    // half of the price is retained as a credit adjustment
    expect(team(teams[1].id).credits).toBe(creditsBefore + Math.round(purchase!.price / 2));
  });

  it("never allows two active purchases of the same player", async () => {
    await admin({ type: "manual_assign", playerId: players[4].id, teamId: teams[1].id, price: 3 });
    const ack = await admin({ type: "manual_assign", playerId: players[4].id, teamId: teams[2].id, price: 3 });
    expect(ack).toMatchObject({ ok: false, reason: "PLAYER_NOT_AVAILABLE" });

    const active = await prisma.purchase.count({
      where: { voided: false, auctionPlayer: { auctionId, playerId: players[4].id } },
    });
    expect(active).toBe(1);
  });
});

describe("recovery", () => {
  it("rehydrates the authoritative state from the database", async () => {
    await admin({ type: "start_player", playerId: players[3].id });
    await bid(teams[2].id, 2);
    const before = snap();

    const reloaded = (await AuctionEngine.load(auctionId, io))!;
    const after = reloaded.buildSnapshot();

    expect(after.auction.status).toBe("PLAYER_ACTIVE");
    expect(after.current?.player.displayName).toBe(before.current?.player.displayName);
    expect(after.current?.currentBid).toBe(2);
    expect(after.current?.leaderTeamId).toBe(teams[2].id);
    // credits survive a restart because they are derived from purchases
    for (const t of before.teams) {
      expect(after.teams.find((x) => x.id === t.id)?.credits).toBe(t.credits);
    }
    reloaded.dispose();
  });
});
