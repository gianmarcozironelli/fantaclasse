import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { generateToken } from "@/server/tokens";

type Params = { params: Promise<{ code: string }> };

/** Public info for the join screen. */
export async function GET(req: NextRequest, { params }: Params) {
  const { code } = await params;
  const team = await prisma.fantasyTeam.findUnique({
    where: { joinCode: code.toUpperCase() },
    include: {
      auction: { select: { id: true, name: true, season: true, status: true } },
      participant: { select: { id: true } },
    },
  });
  if (!team) return NextResponse.json({ error: "Codice non valido" }, { status: 404 });

  return NextResponse.json({
    auctionId: team.auction.id,
    auctionName: team.auction.name,
    season: team.auction.season,
    auctionStatus: team.auction.status,
    teamId: team.id,
    teamName: team.name,
    color: team.color,
    pinRequired: team.pin !== null,
    alreadyClaimed: team.participant !== null,
  });
}

const claimSchema = z.object({
  pin: z.string().max(10).optional(),
  displayName: z.string().max(60).optional(),
});

/**
 * Claim the team: exchanges join code (+PIN) for a long participant token.
 * Re-claiming with the right PIN returns a fresh token (new phone / lost
 * localStorage) — the old token is invalidated.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { code } = await params;
  const parsed = claimSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  const team = await prisma.fantasyTeam.findUnique({
    where: { joinCode: code.toUpperCase() },
    include: { participant: true, auction: { select: { id: true } } },
  });
  if (!team) return NextResponse.json({ error: "Codice non valido" }, { status: 404 });

  if (team.pin !== null && parsed.data.pin !== team.pin) {
    return NextResponse.json({ error: "PIN errato" }, { status: 403 });
  }
  // Without a PIN the first claim wins; later claims need the (absent) PIN to
  // be impossible — so allow reclaim only when a PIN protects the team.
  if (team.participant && team.pin === null) {
    return NextResponse.json(
      { error: "Squadra già collegata da un altro dispositivo. Chiedi all'amministratore." },
      { status: 409 },
    );
  }

  const token = generateToken();
  const participant = team.participant
    ? await prisma.participant.update({
        where: { id: team.participant.id },
        data: { token, displayName: parsed.data.displayName ?? team.participant.displayName },
      })
    : await prisma.participant.create({
        data: { fantasyTeamId: team.id, token, displayName: parsed.data.displayName },
      });

  await prisma.auctionEvent.create({
    data: {
      auctionId: team.auction.id,
      type: "PARTICIPANT_JOINED",
      payload: { teamId: team.id, participantId: participant.id, reclaim: !!team.participant },
    },
  });

  return NextResponse.json({
    token,
    auctionId: team.auction.id,
    teamId: team.id,
    teamName: team.name,
  });
}
