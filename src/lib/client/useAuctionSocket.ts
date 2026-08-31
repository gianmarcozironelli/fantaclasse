"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { CmdAck, CommandInput, PrivateState, Snapshot, Toast } from "../protocol";

export type ConnState = "connecting" | "online" | "reconnecting" | "offline";

let cmdCounter = 0;
function newCommandId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${++cmdCounter}`;
}

export function useAuctionSocket(
  auctionId: string | null,
  role: "admin" | "participant" | "spectator",
  token: string | null,
) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [privateState, setPrivateState] = useState<PrivateState | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const offsetRef = useRef(0);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!auctionId) return;
    if ((role === "admin" || role === "participant") && !token) return;

    const socket = io({
      auth: { auctionId, role, token: token ?? undefined },
    });
    socketRef.current = socket;
    seqRef.current = 0;

    socket.on("connect", () => {
      setConnState("online");
      setAuthError(null);
      // A reconnect may reach a restarted server whose engine seq starts over,
      // so the staleness guard resets with every fresh connection (each of
      // which delivers a full authoritative snapshot).
      seqRef.current = 0;
    });
    socket.on("disconnect", () => setConnState("reconnecting"));
    socket.io.on("reconnect_attempt", () => setConnState("reconnecting"));
    socket.io.on("reconnect_failed", () => setConnState("offline"));
    socket.on("connect_error", (err) => {
      if (err.message === "unauthorized" || err.message === "auction not found") {
        setAuthError(err.message);
        setConnState("offline");
        socket.disconnect();
      } else {
        setConnState("reconnecting");
      }
    });
    socket.on("time", ({ now }: { now: string }) => {
      offsetRef.current = new Date(now).getTime() - Date.now();
    });
    socket.on("snapshot", (snap: Snapshot) => {
      // engine seq is monotonic; drop stale out-of-order frames
      if (snap.seq >= seqRef.current) {
        seqRef.current = snap.seq;
        setSnapshot(snap);
      }
    });
    socket.on("private", (p: PrivateState) => setPrivateState(p));
    socket.on("toast", (t: Toast) => {
      setToasts((prev) => [...prev.slice(-30), t]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [auctionId, role, token]);

  const sendCmd = useCallback(
    (cmd: CommandInput): Promise<CmdAck> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          resolve({ ok: false, reason: "OFFLINE", message: "Non connesso: riprova" });
          return;
        }
        const timeout = setTimeout(
          () => resolve({ ok: false, reason: "TIMEOUT", message: "Nessuna risposta dal server" }),
          8000,
        );
        socket.emit("cmd", { commandId: newCommandId(), ...cmd }, (ack: CmdAck) => {
          clearTimeout(timeout);
          resolve(ack);
        });
      });
    },
    [],
  );

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { snapshot, privateState, connState, toasts, authError, sendCmd, serverNow };
}
