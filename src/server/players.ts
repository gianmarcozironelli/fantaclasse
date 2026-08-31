import { prisma } from "./prisma";
import { normalizeSearch, type PlayerInput } from "../lib/import/provider";
import { buildSamplePlayers } from "../data/serie-a-players";

export interface UpsertStats {
  created: number;
  updated: number;
  /** players removed from the board because a full list replaced them */
  deactivated: number;
}

/**
 * Normalized upsert used by every provider. Match priority:
 * externalId, then displayName+teamAbbr. Never deletes players (sold players
 * must survive re-imports); players missing from an import can be deactivated
 * by the admin separately if needed.
 */
export async function upsertPlayers(
  inputs: PlayerInput[],
  opts: {
    season: string;
    source: string;
    recordSeasonData?: boolean;
    /** treat `inputs` as the complete list and retire everything else */
    deactivateMissing?: boolean;
  },
): Promise<UpsertStats> {
  const existing = await prisma.player.findMany({
    select: { id: true, externalId: true, displayName: true, teamAbbr: true },
  });
  const byExternal = new Map(existing.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
  const byName = new Map(existing.map((p) => [`${p.displayName.toLowerCase()}|${p.teamAbbr}`, p]));

  const creates: PlayerInput[] = [];
  const updates: { id: string; input: PlayerInput }[] = [];

  for (const input of inputs) {
    const match =
      (input.externalId && byExternal.get(input.externalId)) ||
      byName.get(`${input.displayName.toLowerCase()}|${input.teamAbbr}`);
    if (match) updates.push({ id: match.id, input });
    else creates.push(input);
  }

  if (creates.length > 0) {
    await prisma.player.createMany({
      data: creates.map((p) => ({
        externalId: p.externalId,
        firstName: p.firstName,
        lastName: p.lastName,
        displayName: p.displayName,
        searchName: normalizeSearch(p.displayName),
        teamName: p.teamName,
        teamAbbr: p.teamAbbr,
        role: p.role,
        mantraRoles: p.mantraRoles ?? [],
        initialQuotation: p.initialQuotation,
        currentQuotation: p.currentQuotation,
        fvm: p.fvm ?? null,
        imageUrl: p.imageUrl ?? null,
        active: true,
      })),
      skipDuplicates: true,
    });
  }

  const CHUNK = 50;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await prisma.$transaction(
      updates.slice(i, i + CHUNK).map(({ id, input }) =>
        prisma.player.update({
          where: { id },
          data: {
            searchName: normalizeSearch(input.displayName),
            teamName: input.teamName,
            teamAbbr: input.teamAbbr,
            role: input.role,
            mantraRoles: input.mantraRoles ?? [],
            currentQuotation: input.currentQuotation,
            fvm: input.fvm ?? null,
            active: true,
          },
        }),
      ),
    );
  }

  // resolve the ids the import actually covers (creates have no ids until now)
  const all = await prisma.player.findMany({
    select: { id: true, externalId: true, displayName: true, teamAbbr: true },
  });
  const byExt = new Map(all.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
  const byNm = new Map(all.map((p) => [`${p.displayName.toLowerCase()}|${p.teamAbbr}`, p]));
  const matchOf = (input: PlayerInput) =>
    (input.externalId && byExt.get(input.externalId)) ||
    byNm.get(`${input.displayName.toLowerCase()}|${input.teamAbbr}`);

  if (opts.recordSeasonData) {
    const rows = inputs
      .map((input) => {
        const match = matchOf(input);
        return match
          ? {
              playerId: match.id,
              season: opts.season,
              source: opts.source,
              initialQuotation: input.initialQuotation,
              currentQuotation: input.currentQuotation,
              fvm: input.fvm ?? null,
            }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) await prisma.playerSeasonData.createMany({ data: rows });
  }

  let deactivated = 0;
  if (opts.deactivateMissing) {
    // An official quotazioni file IS the whole list, so anything absent from it
    // (notably the bundled sample players) is retired. Retiring is not deleting:
    // an auction that already used a player still shows it, because the board
    // query also matches players with an AuctionPlayer row in that auction.
    const keep = new Set<string>();
    for (const input of inputs) {
      const match = matchOf(input);
      if (match) keep.add(match.id);
    }

    const result = await prisma.player.updateMany({
      where: { active: true, id: { notIn: [...keep] } },
      data: { active: false },
    });
    deactivated = result.count;
  }

  return { created: creates.length, updated: updates.length, deactivated };
}

/** Seed the bundled sample list on first run so the app works out of the box. */
export async function ensurePlayersSeeded(): Promise<void> {
  const count = await prisma.player.count();
  if (count > 0) return;
  await upsertPlayers(buildSamplePlayers(), {
    season: "2026/27",
    source: "sample",
    recordSeasonData: false,
  });
}
