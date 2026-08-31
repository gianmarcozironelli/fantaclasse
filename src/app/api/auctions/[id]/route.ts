import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireAdmin } from "@/server/auth";
import { notifyAuctionChanged } from "@/server/registry";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    include: {
      rosterRules: true,
      teams: {
        orderBy: { sortOrder: "asc" },
        include: { participant: { select: { id: true, connected: true, displayName: true } } },
      },
    },
  });
  if (!auction) return NextResponse.json({ error: "Asta non trovata" }, { status: 404 });

  const isAdmin = (await requireAdmin(req, id)) !== null;

  return NextResponse.json({
    id: auction.id,
    name: auction.name,
    season: auction.season,
    status: auction.status,
    mode: auction.mode,
    ruleset: auction.ruleset,
    startingBudget: auction.startingBudget,
    minBid: auction.minBid,
    minIncrement: auction.minIncrement,
    timerEnabled: auction.timerEnabled,
    timerSeconds: auction.timerSeconds,
    resetTimerOnBid: auction.resetTimerOnBid,
    nominationMode: auction.nominationMode,
    autoAssign: auction.autoAssign,
    passEnabled: auction.passEnabled,
    hideSoldPlayers: auction.hideSoldPlayers,
    botsEnabled: auction.botsEnabled,
    isDemo: auction.isDemo,
    rosterRules: Object.fromEntries(auction.rosterRules.map((r) => [r.role, r.slots])),
    teams: auction.teams.map((t) => ({
      id: t.id,
      name: t.name,
      managerName: t.managerName,
      color: t.color,
      sortOrder: t.sortOrder,
      isBot: t.isBot,
      connected: t.participant?.connected ?? false,
      claimed: t.participant !== null,
      hasPin: t.pin !== null,
      ...(isAdmin ? { joinCode: t.joinCode } : {}),
    })),
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  season: z.string().min(1).max(20).optional(),
  mode: z.enum(["LIVE", "MANUAL"]).optional(),
  minBid: z.number().int().min(1).max(1000).optional(),
  minIncrement: z.number().int().min(1).max(1000).optional(),
  timerEnabled: z.boolean().optional(),
  timerSeconds: z.number().int().min(3).max(600).optional(),
  resetTimerOnBid: z.boolean().optional(),
  nominationMode: z
    .enum(["ADMIN_ONLY", "ROUND_ROBIN", "RANDOM_PLAYER", "RANDOM_BY_ROLE"])
    .optional(),
  autoAssign: z.boolean().optional(),
  passEnabled: z.boolean().optional(),
  hideSoldPlayers: z.boolean().optional(),
  rosterRules: z
    .object({
      P: z.number().int().min(1).max(10),
      D: z.number().int().min(1).max(15),
      C: z.number().int().min(1).max(15),
      A: z.number().int().min(1).max(12),
    })
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const auction = await requireAdmin(req, id);
  if (!auction) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  }
  const { rosterRules, ...fields } = parsed.data;

  await prisma.auction.update({ where: { id }, data: fields });
  if (rosterRules) {
    // Never shrink a role below what a team already bought
    const purchases = await prisma.purchase.findMany({
      where: { voided: false, auctionPlayer: { auctionId: id } },
      include: { auctionPlayer: { include: { player: { select: { role: true } } } } },
    });
    const maxByRole: Record<string, Map<string, number>> = {};
    for (const p of purchases) {
      const role = p.auctionPlayer.player.role;
      maxByRole[role] ??= new Map();
      maxByRole[role].set(
        p.fantasyTeamId,
        (maxByRole[role].get(p.fantasyTeamId) ?? 0) + 1,
      );
    }
    for (const [role, slots] of Object.entries(rosterRules)) {
      const bought = Math.max(0, ...(maxByRole[role]?.values() ?? []));
      if (slots < bought) {
        return NextResponse.json(
          { error: `Una squadra ha già ${bought} giocatori in ${role}` },
          { status: 400 },
        );
      }
      await prisma.rosterRule.upsert({
        where: { auctionId_role: { auctionId: id, role: role as "P" | "D" | "C" | "A" } },
        create: { auctionId: id, role: role as "P" | "D" | "C" | "A", slots },
        update: { slots },
      });
    }
  }

  await prisma.auctionEvent.create({
    data: { auctionId: id, type: "SETTINGS_CHANGED", payload: parsed.data },
  });
  await notifyAuctionChanged(id);
  return NextResponse.json({ ok: true });
}
