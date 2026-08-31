import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireAdmin } from "@/server/auth";
import { notifyAuctionChanged } from "@/server/registry";

type Params = { params: Promise<{ id: string; teamId: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  managerName: z.string().max(60).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  pin: z.string().regex(/^\d{4}$/).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, teamId } = await params;
  if (!(await requireAdmin(req, id)))
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  const team = await prisma.fantasyTeam.findFirst({ where: { id: teamId, auctionId: id } });
  if (!team) return NextResponse.json({ error: "Squadra non trovata" }, { status: 404 });

  await prisma.fantasyTeam.update({ where: { id: teamId }, data: parsed.data });
  await prisma.auctionEvent.create({
    data: { auctionId: id, type: "TEAM_EDITED", payload: { teamId, ...parsed.data } },
  });
  await notifyAuctionChanged(id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, teamId } = await params;
  if (!(await requireAdmin(req, id)))
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const team = await prisma.fantasyTeam.findFirst({
    where: { id: teamId, auctionId: id },
    include: { purchases: { where: { voided: false } } },
  });
  if (!team) return NextResponse.json({ error: "Squadra non trovata" }, { status: 404 });
  if (team.purchases.length > 0) {
    return NextResponse.json(
      { error: "La squadra ha già acquistato giocatori: annulla prima gli acquisti" },
      { status: 400 },
    );
  }

  await prisma.fantasyTeam.delete({ where: { id: teamId } });
  await prisma.auctionEvent.create({
    data: { auctionId: id, type: "TEAM_DELETED", payload: { teamId, name: team.name } },
  });
  await notifyAuctionChanged(id);
  return NextResponse.json({ ok: true });
}
