import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";

type Params = { params: Promise<{ id: string }> };

/** Active purchases (squads pages, admin corrections). Public. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const purchases = await prisma.purchase.findMany({
    where: { voided: false, auctionPlayer: { auctionId: id } },
    orderBy: { createdAt: "asc" },
    include: {
      auctionPlayer: { include: { player: true } },
      fantasyTeam: { select: { id: true, name: true, color: true } },
    },
  });
  return NextResponse.json({
    purchases: purchases.map((p) => ({
      id: p.id,
      price: p.price,
      createdAt: p.createdAt,
      team: p.fantasyTeam,
      player: {
        id: p.auctionPlayer.player.id,
        displayName: p.auctionPlayer.player.displayName,
        teamName: p.auctionPlayer.player.teamName,
        teamAbbr: p.auctionPlayer.player.teamAbbr,
        role: p.auctionPlayer.player.role,
        quotation: p.auctionPlayer.player.currentQuotation,
        fvm: p.auctionPlayer.player.fvm,
      },
    })),
  });
}
