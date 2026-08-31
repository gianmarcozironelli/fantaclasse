import type { Server } from "socket.io";
import { AuctionEngine } from "./engine";

/**
 * Engine registry shared across module systems (the custom server and the
 * Next-compiled API routes live in the same process but load separate module
 * copies — globalThis is the one shared namespace).
 */
interface RegistryState {
  io: Server | null;
  engines: Map<string, AuctionEngine>;
  loading: Map<string, Promise<AuctionEngine | null>>;
}

const g = globalThis as unknown as { __fantaclasse?: RegistryState };

function state(): RegistryState {
  if (!g.__fantaclasse) {
    g.__fantaclasse = { io: null, engines: new Map(), loading: new Map() };
  }
  return g.__fantaclasse;
}

export function setIo(io: Server) {
  state().io = io;
}

export function getIo(): Server | null {
  return state().io;
}

export async function getEngine(auctionId: string): Promise<AuctionEngine | null> {
  const s = state();
  const existing = s.engines.get(auctionId);
  if (existing) return existing;
  if (!s.io) return null;

  const pending = s.loading.get(auctionId);
  if (pending) return pending;

  const promise = AuctionEngine.load(auctionId, s.io)
    .then((engine) => {
      if (engine) s.engines.set(auctionId, engine);
      return engine;
    })
    .finally(() => s.loading.delete(auctionId));
  s.loading.set(auctionId, promise);
  return promise;
}

/** After REST-side mutations: reload the live engine (if any) and rebroadcast. */
export async function notifyAuctionChanged(auctionId: string) {
  const engine = state().engines.get(auctionId);
  if (engine) await engine.refreshFromDb();
}
