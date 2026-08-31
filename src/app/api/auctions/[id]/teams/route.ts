import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireAdmin } from "@/server/auth";
import { notifyAuctionChanged } from "@/server/registry";
import { generateJoinCode } from "@/server/tokens";

type Params = { params: Promise<{ id: string }> };

const addSchema = z.object({
  name: z.string().min(1).max(60),
  managerName: z.string().max(60).optional(),
  color: z.string().max(20).optional(),
  pin: z.string().regex(/^\d{4}$/).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const auction = await requireAdmin(req, id);
  if (!auction) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  const maxOrder = await prisma.fantasyTeam.aggregate({
    where: { auctionId: id },
    _max: { sortOrder: true },
  });
  const joinCode = generateJoinCode();
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const team = await prisma.fantasyTeam.create({
    data: {
      auctionId: id,
      ...parsed.data,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      joinCode,
      invitation: { create: { token: joinCode, url: `${origin}/join/${joinCode}` } },
    },
  });
  await prisma.auctionEvent.create({
    data: { auctionId: id, type: "TEAM_ADDED", payload: { teamId: team.id, name: team.name } },
  });
  await notifyAuctionChanged(id);
  return NextResponse.json({ id: team.id, name: team.name, joinCode: team.joinCode });
}
