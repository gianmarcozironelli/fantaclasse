import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import type { Command } from "../lib/protocol";

process.loadEnvFile?.(".env");

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  // import after env is loaded
  const { prisma } = await import("./prisma");
  const { getEngine, setIo } = await import("./registry");

  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, {
    cors: { origin: true },
    // during a physical auction wifi can be flaky — be generous
    pingTimeout: 30000,
    pingInterval: 10000,
  });
  setIo(io);

  io.use(async (socket, nextFn) => {
    try {
      const { auctionId, role, token } = socket.handshake.auth as {
        auctionId?: string;
        role?: string;
        token?: string;
      };
      if (!auctionId || !role) return nextFn(new Error("bad handshake"));

      const auction = await prisma.auction.findUnique({
        where: { id: auctionId },
        select: { id: true, adminToken: true },
      });
      if (!auction) return nextFn(new Error("auction not found"));

      if (role === "admin") {
        if (!token || token !== auction.adminToken) return nextFn(new Error("unauthorized"));
        socket.data = { auctionId, role: "admin" as const, teamId: null };
      } else if (role === "participant") {
        const participant = token
          ? await prisma.participant.findUnique({
              where: { token },
              include: { fantasyTeam: { select: { id: true, auctionId: true } } },
            })
          : null;
        if (!participant || participant.fantasyTeam.auctionId !== auctionId)
          return nextFn(new Error("unauthorized"));
        socket.data = {
          auctionId,
          role: "participant" as const,
          teamId: participant.fantasyTeam.id,
          participantId: participant.id,
        };
      } else {
        socket.data = { auctionId, role: "spectator" as const, teamId: null };
      }
      nextFn();
    } catch (err) {
      console.error("handshake error", err);
      nextFn(new Error("internal"));
    }
  });

  io.on("connection", async (socket) => {
    const { auctionId, role, teamId, participantId } = socket.data as {
      auctionId: string;
      role: "admin" | "participant" | "spectator";
      teamId: string | null;
      participantId?: string;
    };

    socket.join(`auction:${auctionId}`);
    socket.emit("time", { now: new Date().toISOString() });

    const engine = await getEngine(auctionId);
    if (!engine) {
      socket.emit("fatal", { message: "Asta non trovata" });
      socket.disconnect(true);
      return;
    }

    if (role === "participant" && teamId) {
      engine.attachSocket(socket.id, teamId);
      if (participantId) {
        const watchlist = await prisma.watchlistEntry.findMany({
          where: { participantId },
        });
        socket.emit("private", {
          teamId,
          participantId,
          watchlist: watchlist.map((w) => ({
            playerId: w.playerId,
            priority: w.priority,
            targetPrice: w.targetPrice,
            maxPrice: w.maxPrice,
            notes: w.notes,
          })),
        });
      }
    }

    socket.emit("snapshot", engine.buildSnapshot());

    socket.on("cmd", async (cmd: Command, ack?: (a: unknown) => void) => {
      try {
        if (!cmd || typeof cmd !== "object" || typeof cmd.type !== "string") {
          ack?.({ ok: false, reason: "BAD_COMMAND", message: "Comando non valido" });
          return;
        }
        const source =
          role === "admin"
            ? ({ kind: "admin" } as const)
            : role === "participant" && teamId
              ? ({ kind: "participant", teamId } as const)
              : null;
        if (!source) {
          ack?.({ ok: false, reason: "UNAUTHORIZED", message: "Non autorizzato" });
          return;
        }
        const result = await engine.handleCommand(source, cmd);
        ack?.(result);
      } catch (err) {
        console.error("cmd error", err);
        ack?.({ ok: false, reason: "INTERNAL", message: "Errore interno" });
      }
    });

    socket.on("disconnect", () => {
      if (role === "participant") engine.detachSocket(socket.id, teamId);
    });
  });

  httpServer.listen(port, () => {
    console.log(`▲ Fantaclasse ready on http://localhost:${port} (${dev ? "dev" : "prod"})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
