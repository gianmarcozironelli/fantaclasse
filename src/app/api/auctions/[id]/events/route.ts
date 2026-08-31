import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requireAdmin } from "@/server/auth";

type Params = { params: Promise<{ id: string }> };

/** Audit log (admin only). */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!(await requireAdmin(req, id)))
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const limit = Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? "") || 100);
  const events = await prisma.auctionEvent.findMany({
    where: { auctionId: id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ events });
}
