import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Returns the auction iff the request carries a valid x-admin-token. */
export async function requireAdmin(req: NextRequest, auctionId: string) {
  const token = req.headers.get("x-admin-token");
  if (!token) return null;
  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
  if (!auction || !safeEqual(auction.adminToken, token)) return null;
  return auction;
}

/** Returns the participant (with team) iff x-participant-token is valid for this auction. */
export async function requireParticipant(req: NextRequest, auctionId: string) {
  const token = req.headers.get("x-participant-token");
  if (!token) return null;
  const participant = await prisma.participant.findUnique({
    where: { token },
    include: { fantasyTeam: true },
  });
  if (!participant || participant.fantasyTeam.auctionId !== auctionId) return null;
  return participant;
}
