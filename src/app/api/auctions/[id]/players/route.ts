import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { normalizeSearch } from "@/lib/import/provider";

type Params = { params: Promise<{ id: string }> };

/**
 * Player board / search. Public (spectators see the tabellone).
 * Query params: q, role, teamAbbr, status (available|sold|unsold|all),
 * qmin, qmax, sort (name|quotation|fvm), dir, limit.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const auction = await prisma.auction.findUnique({ where: { id }, select: { id: true } });
  if (!auction) return NextResponse.json({ error: "Asta non trovata" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const role = sp.get("role");
  const teamAbbr = sp.get("teamAbbr");
  const status = sp.get("status") ?? "all";
  const qmin = Number(sp.get("qmin") ?? "") || undefined;
  const qmax = Number(sp.get("qmax") ?? "") || undefined;
  const sort = sp.get("sort") ?? "quotation";
  const dir = sp.get("dir") === "asc" ? "asc" : "desc";
  const limit = Math.min(1000, Number(sp.get("limit") ?? "") || 1000);

  const players = await prisma.player.findMany({
    where: {
      AND: [
        // Retired players (dropped by a full list import) stay visible in an
        // auction that already used them, so sold history never disappears.
        { OR: [{ active: true }, { auctionPlayers: { some: { auctionId: id } } }] },
        ...(role && ["P", "D", "C", "A"].includes(role)
          ? [{ role: role as "P" | "D" | "C" | "A" }]
          : []),
        ...(teamAbbr ? [{ teamAbbr }] : []),
        ...(qmin !== undefined || qmax !== undefined
          ? [{ currentQuotation: { ...(qmin !== undefined ? { gte: qmin } : {}), ...(qmax !== undefined ? { lte: qmax } : {}) } }]
          : []),
        ...(q
          ? [
              {
                OR: [
                  // searchName is accent-stripped and lowercased, so "leao"
                  // matches "Leão" and "soule" matches "Soulé"
                  { searchName: { contains: normalizeSearch(q) } },
                  { displayName: { contains: q, mode: "insensitive" as const } },
                  { teamName: { contains: q, mode: "insensitive" as const } },
                  { teamAbbr: { contains: q, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy:
      sort === "name"
        ? { displayName: dir }
        : sort === "fvm"
          ? { fvm: dir }
          : { currentQuotation: dir },
    take: limit,
    include: {
      auctionPlayers: {
        where: { auctionId: id },
        include: {
          purchases: { where: { voided: false }, include: { fantasyTeam: { select: { id: true, name: true, color: true } } } },
        },
      },
    },
  });

  const rows = players
    .map((p) => {
      const ap = p.auctionPlayers[0];
      const purchase = ap?.purchases[0];
      const st = ap
        ? ap.status === "SOLD"
          ? "SOLD"
          : ap.status === "ACTIVE" || ap.status === "CLOSING"
            ? "AUCTION"
            : ap.status === "UNSOLD"
              ? "UNSOLD"
              : "AVAILABLE"
        : "AVAILABLE";
      return {
        id: p.id,
        displayName: p.displayName,
        teamName: p.teamName,
        teamAbbr: p.teamAbbr,
        role: p.role,
        mantraRoles: p.mantraRoles,
        quotation: p.currentQuotation,
        initialQuotation: p.initialQuotation,
        fvm: p.fvm,
        status: st,
        soldTo: purchase ? { teamId: purchase.fantasyTeam.id, teamName: purchase.fantasyTeam.name, color: purchase.fantasyTeam.color, price: purchase.price } : null,
      };
    })
    .filter((r) => {
      if (status === "available") return r.status === "AVAILABLE" || r.status === "UNSOLD";
      if (status === "sold") return r.status === "SOLD";
      if (status === "unsold") return r.status === "UNSOLD";
      return true;
    });

  return NextResponse.json({ players: rows });
}
