import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requireAdmin } from "@/server/auth";
import { notifyAuctionChanged } from "@/server/registry";
import { CsvPlayerProvider } from "@/lib/import/csvProvider";
import { ManualPlayerProvider } from "@/lib/import/manualProvider";
import { upsertPlayers } from "@/server/players";

type Params = { params: Promise<{ id: string }> };

/**
 * Player import. multipart/form-data with `file` (CSV/XLSX, Fantacalcio.it
 * layout auto-detected) — or JSON body for a single manual player.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const auction = await requireAdmin(req, id);
  if (!auction) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  let result;
  // A quotazioni file is the authoritative list: by default anything absent
  // from it (the bundled sample players included) is retired from the board.
  let replaceList = false;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    replaceList = form.get("replaceList") !== "false";
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File troppo grande (max 10MB)" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    result = await new CsvPlayerProvider().parse({ buffer, filename: file.name });
  } else {
    const body = await req.json().catch(() => null);
    if (!body?.displayName) {
      return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
    }
    result = await new ManualPlayerProvider().parse(body);
  }

  if (result.players.length === 0) {
    return NextResponse.json(
      { error: "Nessun giocatore importato", warnings: result.warnings },
      { status: 400 },
    );
  }

  const stats = await upsertPlayers(result.players, {
    season: auction.season,
    source: result.source,
    recordSeasonData: true,
    deactivateMissing: replaceList,
  });

  await prisma.auctionEvent.create({
    data: {
      auctionId: id,
      type: "PLAYERS_IMPORTED",
      payload: { source: result.source, ...stats, warnings: result.warnings.slice(0, 20) },
    },
  });
  await notifyAuctionChanged(id);

  return NextResponse.json({ ...stats, warnings: result.warnings });
}
