"use client";

/** localStorage keys — tokens never leave the device except in auth headers. */

export function getAdminToken(auctionId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`fc:admin:${auctionId}`);
}

export function setAdminToken(auctionId: string, token: string) {
  localStorage.setItem(`fc:admin:${auctionId}`, token);
  rememberAuction(auctionId, "admin");
}

export function getParticipantToken(auctionId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`fc:player:${auctionId}`);
}

export function setParticipantToken(auctionId: string, token: string) {
  localStorage.setItem(`fc:player:${auctionId}`, token);
  rememberAuction(auctionId, "player");
}

export interface RecentAuction {
  id: string;
  role: "admin" | "player";
  at: number;
}

export function rememberAuction(id: string, role: "admin" | "player") {
  try {
    const list: RecentAuction[] = JSON.parse(localStorage.getItem("fc:recent") ?? "[]");
    const filtered = list.filter((a) => a.id !== id);
    filtered.unshift({ id, role, at: Date.now() });
    localStorage.setItem("fc:recent", JSON.stringify(filtered.slice(0, 8)));
  } catch {
    // storage unavailable — non-essential
  }
}

export function recentAuctions(): RecentAuction[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("fc:recent") ?? "[]");
  } catch {
    return [];
  }
}
