import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireParticipant } from "@/server/auth";

type Params = { params: Promise<{ id: string }> };

/** Watchlists are strictly private: every route requires the owner's token. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const participant = await requireParticipant(req, id);
  if (!participant) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const entries = await prisma.watchlistEntry.findMany({
    where: { participantId: participant.id },
    include: { player: true },
  });
  return NextResponse.json({
    watchlist: entries.map((e) => ({
      playerId: e.playerId,
      priority: e.priority,
      targetPrice: e.targetPrice,
      maxPrice: e.maxPrice,
      notes: e.notes,
      player: {
        id: e.player.id,
        displayName: e.player.displayName,
        teamAbbr: e.player.teamAbbr,
        role: e.player.role,
        quotation: e.player.currentQuotation,
      },
    })),
  });
}

const upsertSchema = z.object({
  playerId: z.string().min(1),
  priority: z.number().int().min(1).max(5).default(3),
  targetPrice: z.number().int().min(0).nullable().optional(),
  maxPrice: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const participant = await requireParticipant(req, id);
  if (!participant) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  const { playerId, ...data } = parsed.data;

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return NextResponse.json({ error: "Giocatore non trovato" }, { status: 404 });

  await prisma.watchlistEntry.upsert({
    where: { participantId_playerId: { participantId: participant.id, playerId } },
    create: { participantId: participant.id, playerId, ...data },
    update: data,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const participant = await requireParticipant(req, id);
  if (!participant) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const playerId = req.nextUrl.searchParams.get("playerId");
  if (!playerId) return NextResponse.json({ error: "playerId mancante" }, { status: 400 });

  await prisma.watchlistEntry.deleteMany({
    where: { participantId: participant.id, playerId },
  });
  return NextResponse.json({ ok: true });
}
