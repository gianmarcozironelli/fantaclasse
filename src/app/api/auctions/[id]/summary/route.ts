import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import type { Role } from "@/lib/domain/types";

type Params = { params: Promise<{ id: string }> };

/** End-of-auction summary + fun stats. Public. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const auction = await prisma.auction.findUnique({
    where: { id },
    include: { teams: { orderBy: { sortOrder: "asc" } } },
  });
  if (!auction) return NextResponse.json({ error: "Asta non trovata" }, { status: 404 });

  const purchases = await prisma.purchase.findMany({
    where: { voided: false, auctionPlayer: { auctionId: id } },
    include: {
      auctionPlayer: {
        include: { player: true, _count: { select: { bids: true } } },
      },
      fantasyTeam: { select: { id: true, name: true, color: true } },
    },
  });
  const adjustments = await prisma.creditAdjustment.groupBy({
    by: ["fantasyTeamId"],
    where: { fantasyTeam: { auctionId: id } },
    _sum: { amount: true },
  });
  const adjByTeam = new Map(adjustments.map((a) => [a.fantasyTeamId, a._sum.amount ?? 0]));

  const totalSpent = purchases.reduce((s, p) => s + p.price, 0);
  const byRole: Record<Role, { count: number; total: number; top: { name: string; price: number; team: string } | null }> = {
    P: { count: 0, total: 0, top: null },
    D: { count: 0, total: 0, top: null },
    C: { count: 0, total: 0, top: null },
    A: { count: 0, total: 0, top: null },
  };
  let mostExpensive: { name: string; price: number; team: string; quotation: number } | null = null;
  let biggestWar: { name: string; bids: number; price: number; team: string } | null = null;
  let biggestOverpay: { name: string; price: number; quotation: number; team: string } | null = null;

  for (const p of purchases) {
    const role = p.auctionPlayer.player.role as Role;
    const entry = byRole[role];
    entry.count++;
    entry.total += p.price;
    if (!entry.top || p.price > entry.top.price) {
      entry.top = { name: p.auctionPlayer.player.displayName, price: p.price, team: p.fantasyTeam.name };
    }
    if (!mostExpensive || p.price > mostExpensive.price) {
      mostExpensive = {
        name: p.auctionPlayer.player.displayName,
        price: p.price,
        team: p.fantasyTeam.name,
        quotation: p.auctionPlayer.player.currentQuotation,
      };
    }
    const bidCount = p.auctionPlayer._count.bids;
    if (!biggestWar || bidCount > biggestWar.bids) {
      biggestWar = { name: p.auctionPlayer.player.displayName, bids: bidCount, price: p.price, team: p.fantasyTeam.name };
    }
    const over = p.price - p.auctionPlayer.player.currentQuotation;
    if (!biggestOverpay || over > biggestOverpay.price - biggestOverpay.quotation) {
      biggestOverpay = {
        name: p.auctionPlayer.player.displayName,
        price: p.price,
        quotation: p.auctionPlayer.player.currentQuotation,
        team: p.fantasyTeam.name,
      };
    }
  }

  const teams = auction.teams.map((t) => {
    const own = purchases.filter((p) => p.fantasyTeam.id === t.id);
    const spent = own.reduce((s, p) => s + p.price, 0) + (adjByTeam.get(t.id) ?? 0);
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      players: own.length,
      spent,
      credits: auction.startingBudget - spent,
    };
  });
  const biggestSpender = [...teams].sort((a, b) => b.spent - a.spent)[0] ?? null;
  const mostCreditsLeft = [...teams].sort((a, b) => b.credits - a.credits)[0] ?? null;

  return NextResponse.json({
    auction: { id: auction.id, name: auction.name, status: auction.status, startingBudget: auction.startingBudget },
    totals: {
      players: purchases.length,
      spent: totalSpent,
      avgPrice: purchases.length ? Math.round((totalSpent / purchases.length) * 10) / 10 : 0,
    },
    byRole: Object.fromEntries(
      Object.entries(byRole).map(([role, v]) => [
        role,
        { ...v, avg: v.count ? Math.round((v.total / v.count) * 10) / 10 : 0 },
      ]),
    ),
    teams,
    fun: { mostExpensive, biggestSpender, mostCreditsLeft, biggestWar, biggestOverpay },
  });
}
