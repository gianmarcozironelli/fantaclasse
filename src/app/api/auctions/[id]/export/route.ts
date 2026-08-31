import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";

type Params = { params: Promise<{ id: string }> };

function csvEscape(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export: kind=rosters (default) or kind=log (full bid history). */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    include: { teams: { orderBy: { sortOrder: "asc" } } },
  });
  if (!auction) return NextResponse.json({ error: "Asta non trovata" }, { status: 404 });

  const kind = req.nextUrl.searchParams.get("kind") ?? "rosters";
  const lines: string[] = [];

  if (kind === "log") {
    const bids = await prisma.bid.findMany({
      where: { auctionPlayer: { auctionId: id } },
      orderBy: { createdAt: "asc" },
      include: {
        fantasyTeam: { select: { name: true } },
        auctionPlayer: { include: { player: { select: { displayName: true } } } },
      },
    });
    lines.push("Orario,Giocatore,Squadra fantacalcio,Offerta");
    for (const b of bids) {
      lines.push(
        [
          b.createdAt.toISOString(),
          csvEscape(b.auctionPlayer.player.displayName),
          csvEscape(b.fantasyTeam.name),
          b.amount,
        ].join(","),
      );
    }
  } else {
    const purchases = await prisma.purchase.findMany({
      where: { voided: false, auctionPlayer: { auctionId: id } },
      include: {
        auctionPlayer: { include: { player: true } },
        fantasyTeam: { select: { id: true, name: true } },
      },
    });
    const roleOrder = { P: 0, D: 1, C: 2, A: 3 };
    purchases.sort((a, b) => {
      const t = a.fantasyTeam.name.localeCompare(b.fantasyTeam.name);
      if (t !== 0) return t;
      return (
        roleOrder[a.auctionPlayer.player.role] - roleOrder[b.auctionPlayer.player.role] ||
        b.price - a.price
      );
    });
    lines.push("Squadra fantacalcio,Ruolo,Giocatore,Club,Quotazione,FVM,Prezzo pagato");
    for (const p of purchases) {
      const pl = p.auctionPlayer.player;
      lines.push(
        [
          csvEscape(p.fantasyTeam.name),
          pl.role,
          csvEscape(pl.displayName),
          pl.teamAbbr,
          pl.currentQuotation,
          pl.fvm ?? "",
          p.price,
        ].join(","),
      );
    }
    // credit summary appendix
    lines.push("");
    lines.push("Squadra fantacalcio,Crediti spesi,Crediti residui");
    const spentByTeam = new Map<string, number>();
    for (const p of purchases) {
      spentByTeam.set(p.fantasyTeam.id, (spentByTeam.get(p.fantasyTeam.id) ?? 0) + p.price);
    }
    const adjustments = await prisma.creditAdjustment.groupBy({
      by: ["fantasyTeamId"],
      where: { fantasyTeam: { auctionId: id } },
      _sum: { amount: true },
    });
    for (const adj of adjustments) {
      spentByTeam.set(
        adj.fantasyTeamId,
        (spentByTeam.get(adj.fantasyTeamId) ?? 0) + (adj._sum.amount ?? 0),
      );
    }
    for (const t of auction.teams) {
      const spent = spentByTeam.get(t.id) ?? 0;
      lines.push([csvEscape(t.name), spent, auction.startingBudget - spent].join(","));
    }
  }

  const filename = `${auction.name.replace(/[^a-zA-Z0-9]+/g, "-")}-${kind}.csv`;
  return new NextResponse("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
