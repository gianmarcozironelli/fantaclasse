import { prisma } from "./prisma";
import { ensurePlayersSeeded } from "./players";
import { generateJoinCode, generateToken } from "./tokens";
import type { Role } from "../lib/domain/types";

const DEMO_TEAMS = [
  { name: "La Tua Squadra", color: "#22c55e", isBot: false },
  { name: "Atletico Ma Non Troppo", color: "#ef4444", isBot: true },
  { name: "Real Madrink", color: "#a855f7", isBot: true },
  { name: "AC Picchia", color: "#f59e0b", isBot: true },
  { name: "Borussia Porcmund", color: "#eab308", isBot: true },
  { name: "FC Bidoni", color: "#3b82f6", isBot: true },
  { name: "Inter Net Explorer", color: "#06b6d4", isBot: true },
  { name: "Aston Birra", color: "#ec4899", isBot: true },
];

/**
 * Seeded demo: 8 teams, 500 credits, sample Serie A players, some purchases
 * already made, bots enabled so realtime can be tested without 8 phones.
 */
export async function createDemoAuction(baseUrl: string) {
  await ensurePlayersSeeded();

  const adminToken = generateToken();
  const auction = await prisma.auction.create({
    data: {
      name: "Fanta Ignoranza (Demo)",
      season: "2026/27",
      status: "PLAYER_SELECTION",
      adminToken,
      isDemo: true,
      botsEnabled: true,
      timerSeconds: 10,
      rosterRules: {
        create: [
          { role: "P", slots: 3 },
          { role: "D", slots: 8 },
          { role: "C", slots: 8 },
          { role: "A", slots: 6 },
        ],
      },
    },
  });

  const teams = [];
  for (const [i, t] of DEMO_TEAMS.entries()) {
    const joinCode = generateJoinCode();
    const team = await prisma.fantasyTeam.create({
      data: {
        auctionId: auction.id,
        name: t.name,
        color: t.color,
        isBot: t.isBot,
        sortOrder: i,
        joinCode,
        invitation: {
          create: { token: joinCode, url: `${baseUrl}/join/${joinCode}` },
        },
      },
    });
    teams.push(team);
  }

  // Pre-purchase a dozen notable players spread across the bot teams.
  // Whatever list is loaded is used — so a demo run after importing the real
  // quotazioni file uses real players rather than the bundled samples.
  const notable = await prisma.player.findMany({
    where: { active: true, currentQuotation: { gte: 9 } },
    orderBy: { currentQuotation: "desc" },
    take: 60,
  });
  const roleCap: Record<Role, number> = { P: 1, D: 3, C: 3, A: 2 };
  const bought = new Map<string, Record<Role, number>>();
  let assigned = 0;
  for (const [i, player] of notable.entries()) {
    if (assigned >= 12) break;
    if (i % 3 !== 0) continue; // leave stars on the board too
    const team = teams[1 + (assigned % (teams.length - 1))]; // bots only
    const counts = bought.get(team.id) ?? { P: 0, D: 0, C: 0, A: 0 };
    if (counts[player.role as Role] >= roleCap[player.role as Role]) continue;
    counts[player.role as Role] += 1;
    bought.set(team.id, counts);

    const price = Math.max(1, Math.round(player.currentQuotation * (1.1 + Math.random() * 0.9)));
    await prisma.$transaction(async (tx) => {
      const ap = await tx.auctionPlayer.create({
        data: {
          auctionId: auction.id,
          playerId: player.id,
          status: "SOLD",
          currentBid: price,
          leaderTeamId: team.id,
        },
      });
      await tx.purchase.create({
        data: { auctionPlayerId: ap.id, fantasyTeamId: team.id, price },
      });
      await tx.auctionEvent.create({
        data: {
          auctionId: auction.id,
          type: "PLAYER_SOLD",
          payload: { playerId: player.id, playerName: player.displayName, teamId: team.id, price, demoSeed: true },
        },
      });
    });
    assigned++;
  }

  await prisma.auctionEvent.create({
    data: { auctionId: auction.id, type: "DEMO_CREATED", payload: { teams: teams.length } },
  });

  return { auctionId: auction.id, adminToken };
}
