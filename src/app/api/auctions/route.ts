import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { ensurePlayersSeeded } from "@/server/players";
import { generateJoinCode, generateToken } from "@/server/tokens";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  season: z.string().min(1).max(20).default("2026/27"),
  ruleset: z.enum(["CLASSIC", "MANTRA"]).default("CLASSIC"),
  mode: z.enum(["LIVE", "MANUAL"]).default("LIVE"),
  startingBudget: z.number().int().min(1).max(100000).default(500),
  minBid: z.number().int().min(1).max(1000).default(1),
  minIncrement: z.number().int().min(1).max(1000).default(1),
  timerEnabled: z.boolean().default(true),
  timerSeconds: z.number().int().min(3).max(600).default(10),
  resetTimerOnBid: z.boolean().default(true),
  nominationMode: z
    .enum(["ADMIN_ONLY", "ROUND_ROBIN", "RANDOM_PLAYER", "RANDOM_BY_ROLE"])
    .default("ADMIN_ONLY"),
  autoAssign: z.boolean().default(true),
  passEnabled: z.boolean().default(true),
  rosterRules: z.object({
    P: z.number().int().min(1).max(10),
    D: z.number().int().min(1).max(15),
    C: z.number().int().min(1).max(15),
    A: z.number().int().min(1).max(12),
  }),
  teams: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        managerName: z.string().max(60).optional(),
        color: z.string().max(20).optional(),
        pin: z.string().regex(/^\d{4}$/).optional(),
      }),
    )
    .min(2)
    .max(20),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dati non validi", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  await ensurePlayersSeeded();

  const adminToken = generateToken();
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;

  const auction = await prisma.auction.create({
    data: {
      name: data.name,
      season: data.season,
      ruleset: data.ruleset,
      mode: data.mode,
      startingBudget: data.startingBudget,
      minBid: data.minBid,
      minIncrement: data.minIncrement,
      timerEnabled: data.timerEnabled,
      timerSeconds: data.timerSeconds,
      resetTimerOnBid: data.resetTimerOnBid,
      nominationMode: data.nominationMode,
      autoAssign: data.autoAssign,
      passEnabled: data.passEnabled,
      adminToken,
      rosterRules: {
        create: (["P", "D", "C", "A"] as const).map((role) => ({
          role,
          slots: data.rosterRules[role],
        })),
      },
    },
  });

  const teams = [];
  for (const [i, t] of data.teams.entries()) {
    const joinCode = generateJoinCode();
    const team = await prisma.fantasyTeam.create({
      data: {
        auctionId: auction.id,
        name: t.name,
        managerName: t.managerName,
        color: t.color,
        pin: t.pin,
        sortOrder: i,
        joinCode,
        invitation: { create: { token: joinCode, url: `${origin}/join/${joinCode}` } },
      },
    });
    teams.push({ id: team.id, name: team.name, joinCode: team.joinCode });
  }

  await prisma.auctionEvent.create({
    data: { auctionId: auction.id, type: "AUCTION_CREATED", payload: { name: data.name } },
  });

  return NextResponse.json({ auctionId: auction.id, adminToken, teams });
}
