import type { Server } from "socket.io";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { CommandQueue } from "./queue";
import {
  canAssign,
  canBid,
  availableRosterSlots,
  avgPerRemainingSlot,
  maxBid,
  remainingCredits,
  rosterComplete,
} from "../lib/domain/rules";
import {
  REJECT_MESSAGES,
  ROLES,
  Role,
  RosterCounts,
  RosterRules,
  TeamState,
  Verdict,
  reject,
} from "../lib/domain/types";
import { AuctionStatus, acceptsBids, canTransition } from "../lib/domain/stateMachine";
import type {
  AdminCommand,
  CmdAck,
  Command,
  ParticipantCommand,
  Snapshot,
  SnapshotBid,
  SnapshotCurrent,
  SnapshotPlayer,
} from "../lib/protocol";

type Tx = Prisma.TransactionClient;

interface TeamMem {
  id: string;
  name: string;
  managerName: string | null;
  color: string | null;
  sortOrder: number;
  isBot: boolean;
  budget: number;
  spent: number;
  adjustments: number;
  rosterCounts: RosterCounts;
  connectedSockets: Set<string>;
  participantConnected: boolean;
}

interface CurrentMem {
  auctionPlayerId: string;
  playerId: string;
  player: SnapshotPlayer;
  status: "ACTIVE" | "CLOSING" | "SOLD" | "UNSOLD";
  currentBid: number | null;
  leaderTeamId: string | null;
  closesAt: Date | null;
  bids: SnapshotBid[];
  passed: Set<string>;
  soldToTeamId?: string | null;
  soldPrice?: number | null;
}

interface AuctionMem {
  id: string;
  name: string;
  season: string;
  status: AuctionStatus;
  pausedFromStatus: AuctionStatus | null;
  pausedRemainingMs: number | null;
  mode: "LIVE" | "MANUAL" | "WILD" | "POKER" | "SEALED";
  startingBudget: number;
  minBid: number;
  minIncrement: number;
  timerEnabled: boolean;
  timerSeconds: number;
  resetTimerOnBid: boolean;
  closingGraceMs: number;
  nominationMode: string;
  autoAssign: boolean;
  passEnabled: boolean;
  hideSoldPlayers: boolean;
  botsEnabled: boolean;
  isDemo: boolean;
  nominationTurnIndex: number;
}

export type CommandSource =
  | { kind: "admin" }
  | { kind: "participant"; teamId: string };

const SOLD_FLASH_MS = 2600;

function playerToSnapshot(p: {
  id: string;
  displayName: string;
  teamName: string;
  teamAbbr: string;
  role: string;
  mantraRoles: string[];
  currentQuotation: number;
  initialQuotation: number;
  fvm: number | null;
  imageUrl: string | null;
}): SnapshotPlayer {
  return {
    id: p.id,
    displayName: p.displayName,
    teamName: p.teamName,
    teamAbbr: p.teamAbbr,
    role: p.role as Role,
    mantraRoles: p.mantraRoles,
    quotation: p.currentQuotation,
    initialQuotation: p.initialQuotation,
    fvm: p.fvm,
    imageUrl: p.imageUrl,
  };
}

export class AuctionEngine {
  readonly auctionId: string;
  private io: Server;
  private queue = new CommandQueue();
  private seq = 0;

  private auction!: AuctionMem;
  private rules!: RosterRules;
  private teams = new Map<string, TeamMem>();
  private teamOrder: string[] = [];
  private current: CurrentMem | null = null;
  private counts = { available: 0, sold: 0, unsold: 0, total: 0 };

  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private graceHandle: ReturnType<typeof setTimeout> | null = null;
  private flashHandle: ReturnType<typeof setTimeout> | null = null;
  private botHandles = new Map<string, ReturnType<typeof setTimeout>>();
  private botTargets = new Map<string, number>(); // `${apId}:${teamId}` -> target
  private botBidSeq = 0;
  private seenCommands = new Set<string>();
  private seenCommandOrder: string[] = [];

  private constructor(auctionId: string, io: Server) {
    this.auctionId = auctionId;
    this.io = io;
  }

  static async load(auctionId: string, io: Server): Promise<AuctionEngine | null> {
    const engine = new AuctionEngine(auctionId, io);
    const ok = await engine.hydrate();
    return ok ? engine : null;
  }

  // ---------------------------------------------------------------- hydration

  private async hydrate(): Promise<boolean> {
    const a = await prisma.auction.findUnique({
      where: { id: this.auctionId },
      include: { rosterRules: true },
    });
    if (!a) return false;

    this.auction = {
      id: a.id,
      name: a.name,
      season: a.season,
      status: a.status as AuctionStatus,
      pausedFromStatus: (a.pausedFromStatus as AuctionStatus) ?? null,
      pausedRemainingMs: a.pausedRemainingMs,
      mode: a.mode,
      startingBudget: a.startingBudget,
      minBid: a.minBid,
      minIncrement: a.minIncrement,
      timerEnabled: a.timerEnabled,
      timerSeconds: a.timerSeconds,
      resetTimerOnBid: a.resetTimerOnBid,
      closingGraceMs: a.closingGraceMs,
      nominationMode: a.nominationMode,
      autoAssign: a.autoAssign,
      passEnabled: a.passEnabled,
      hideSoldPlayers: a.hideSoldPlayers,
      botsEnabled: a.botsEnabled,
      isDemo: a.isDemo,
      nominationTurnIndex: a.nominationTurnIndex,
    };
    this.rules = { P: 3, D: 8, C: 8, A: 6 };
    for (const r of a.rosterRules) this.rules[r.role as Role] = r.slots;

    await this.reloadTeams();
    await this.reloadCounts();

    // restore current player, if any
    if (a.currentAuctionPlayerId) {
      const ap = await prisma.auctionPlayer.findUnique({
        where: { id: a.currentAuctionPlayerId },
        include: {
          player: true,
          bids: { orderBy: { createdAt: "asc" } },
          passes: true,
        },
      });
      if (ap && (ap.status === "ACTIVE" || ap.status === "CLOSING")) {
        this.current = {
          auctionPlayerId: ap.id,
          playerId: ap.playerId,
          player: playerToSnapshot(ap.player),
          status: ap.status,
          currentBid: ap.currentBid,
          leaderTeamId: ap.leaderTeamId,
          closesAt: ap.closesAt,
          bids: ap.bids.map((b) => ({
            teamId: b.fantasyTeamId,
            amount: b.amount,
            at: b.createdAt.toISOString(),
          })),
          passed: new Set(ap.passes.map((p) => p.fantasyTeamId)),
        };
        // interrupted mid-flash or stale states resolve to a live player again
        if (this.auction.status === "PLAYER_SOLD" || this.auction.status === "PLAYER_UNSOLD") {
          await this.persistStatus("PLAYER_SELECTION", null);
          this.current = null;
        } else if (this.auction.status === "PLAYER_ACTIVE" || this.auction.status === "PLAYER_CLOSING") {
          this.armTimer();
        }
      } else {
        // dangling pointer (e.g. crash mid-flash): clean up
        const target: AuctionStatus =
          this.auction.status === "FINISHED" ? "FINISHED" : "PLAYER_SELECTION";
        await this.persistStatus(target, null);
      }
    } else if (
      this.auction.status === "PLAYER_ACTIVE" ||
      this.auction.status === "PLAYER_CLOSING" ||
      this.auction.status === "PLAYER_SOLD" ||
      this.auction.status === "PLAYER_UNSOLD"
    ) {
      await this.persistStatus("PLAYER_SELECTION", null);
    }
    return true;
  }

  private async reloadTeams() {
    const teams = await prisma.fantasyTeam.findMany({
      where: { auctionId: this.auctionId },
      orderBy: { sortOrder: "asc" },
      include: {
        participant: true,
        purchases: {
          where: { voided: false },
          include: { auctionPlayer: { include: { player: true } } },
        },
        adjustments: true,
      },
    });
    const prev = this.teams;
    this.teams = new Map();
    this.teamOrder = [];
    for (const t of teams) {
      const counts: RosterCounts = { P: 0, D: 0, C: 0, A: 0 };
      let spent = 0;
      for (const p of t.purchases) {
        spent += p.price;
        counts[p.auctionPlayer.player.role as Role] += 1;
      }
      const adjustments = t.adjustments.reduce((s, adj) => s + adj.amount, 0);
      const old = prev.get(t.id);
      this.teams.set(t.id, {
        id: t.id,
        name: t.name,
        managerName: t.managerName,
        color: t.color,
        sortOrder: t.sortOrder,
        isBot: t.isBot,
        budget: this.auction.startingBudget,
        spent: spent + adjustments,
        adjustments,
        rosterCounts: counts,
        connectedSockets: old?.connectedSockets ?? new Set(),
        participantConnected: old?.participantConnected ?? false,
      });
      this.teamOrder.push(t.id);
    }
  }

  private async reloadCounts() {
    // AuctionPlayer rows are created lazily, so "available" is derived from
    // the full active player pool minus sold and currently-live players.
    const [totalActive, grouped] = await Promise.all([
      prisma.player.count({ where: { active: true } }),
      prisma.auctionPlayer.groupBy({
        by: ["status"],
        where: { auctionId: this.auctionId },
        _count: true,
      }),
    ]);
    let sold = 0;
    let unsold = 0;
    let live = 0;
    for (const g of grouped) {
      if (g.status === "SOLD") sold = g._count;
      else if (g.status === "UNSOLD") unsold = g._count;
      else if (g.status === "ACTIVE" || g.status === "CLOSING") live += g._count;
    }
    this.counts = {
      total: totalActive,
      sold,
      unsold, // still nominatable — informational
      available: Math.max(0, totalActive - sold - live),
    };
  }

  /** Called after REST mutations (team CRUD, settings, import). */
  async refreshFromDb() {
    await this.queue.run(async () => {
      const a = await prisma.auction.findUnique({ where: { id: this.auctionId } });
      if (!a) return;
      Object.assign(this.auction, {
        name: a.name,
        season: a.season,
        mode: a.mode,
        minBid: a.minBid,
        minIncrement: a.minIncrement,
        timerEnabled: a.timerEnabled,
        timerSeconds: a.timerSeconds,
        resetTimerOnBid: a.resetTimerOnBid,
        closingGraceMs: a.closingGraceMs,
        nominationMode: a.nominationMode,
        autoAssign: a.autoAssign,
        passEnabled: a.passEnabled,
        hideSoldPlayers: a.hideSoldPlayers,
        botsEnabled: a.botsEnabled,
        startingBudget: a.startingBudget,
      });
      const rules = await prisma.rosterRule.findMany({ where: { auctionId: this.auctionId } });
      for (const r of rules) this.rules[r.role as Role] = r.slots;
      await this.reloadTeams();
      await this.reloadCounts();
      this.broadcast();
    });
  }

  // ---------------------------------------------------------------- presence

  attachSocket(socketId: string, teamId: string | null) {
    if (!teamId) return;
    const team = this.teams.get(teamId);
    if (!team) return;
    team.connectedSockets.add(socketId);
    const wasConnected = team.participantConnected;
    team.participantConnected = true;
    prisma.participant
      .updateMany({ where: { fantasyTeamId: teamId }, data: { connected: true, lastSeenAt: new Date() } })
      .catch(() => {});
    if (!wasConnected) this.broadcast();
  }

  detachSocket(socketId: string, teamId: string | null) {
    if (!teamId) return;
    const team = this.teams.get(teamId);
    if (!team) return;
    team.connectedSockets.delete(socketId);
    if (team.connectedSockets.size === 0 && team.participantConnected) {
      team.participantConnected = false;
      prisma.participant
        .updateMany({ where: { fantasyTeamId: teamId }, data: { connected: false, lastSeenAt: new Date() } })
        .catch(() => {});
      this.broadcast();
    }
  }

  // ---------------------------------------------------------------- snapshot

  buildSnapshot(): Snapshot {
    const teams = this.teamOrder
      .map((id) => this.teams.get(id)!)
      .map((t) => {
        const state: TeamState = {
          budget: t.budget,
          spent: t.spent,
          rosterCounts: t.rosterCounts,
        };
        const roster = {} as Snapshot["teams"][number]["roster"];
        for (const r of ROLES) {
          roster[r] = { filled: t.rosterCounts[r], max: this.rules[r] };
        }
        return {
          id: t.id,
          name: t.name,
          managerName: t.managerName,
          color: t.color,
          sortOrder: t.sortOrder,
          credits: remainingCredits(state),
          spent: t.spent,
          maxBid: maxBid(state, this.rules, this.auction.minBid),
          roster,
          slotsRemaining: availableRosterSlots(this.rules, t.rosterCounts),
          avgPerRemainingSlot: avgPerRemainingSlot(state, this.rules),
          connected: t.participantConnected || t.isBot,
          hasPassed: this.current?.passed.has(t.id) ?? false,
          isLeading: this.current?.leaderTeamId === t.id,
          isBot: t.isBot,
        };
      });

    let current: SnapshotCurrent | null = null;
    if (this.current) {
      current = {
        auctionPlayerId: this.current.auctionPlayerId,
        player: this.current.player,
        status: this.current.status,
        currentBid: this.current.currentBid,
        leaderTeamId: this.current.leaderTeamId,
        closesAt: this.current.closesAt ? this.current.closesAt.toISOString() : null,
        bids: this.current.bids,
        passedTeamIds: [...this.current.passed],
        soldToTeamId: this.current.soldToTeamId ?? null,
        soldPrice: this.current.soldPrice ?? null,
      };
    }

    let nominationTurnTeamId: string | null = null;
    if (this.auction.nominationMode === "ROUND_ROBIN" && this.teamOrder.length > 0) {
      nominationTurnTeamId =
        this.teamOrder[this.auction.nominationTurnIndex % this.teamOrder.length];
    }

    return {
      seq: ++this.seq,
      auction: {
        id: this.auction.id,
        name: this.auction.name,
        season: this.auction.season,
        status: this.auction.status,
        mode: this.auction.mode,
        rosterRules: { ...this.rules },
        minBid: this.auction.minBid,
        minIncrement: this.auction.minIncrement,
        timerEnabled: this.auction.timerEnabled,
        timerSeconds: this.auction.timerSeconds,
        resetTimerOnBid: this.auction.resetTimerOnBid,
        nominationMode: this.auction.nominationMode,
        autoAssign: this.auction.autoAssign,
        passEnabled: this.auction.passEnabled,
        hideSoldPlayers: this.auction.hideSoldPlayers,
        botsEnabled: this.auction.botsEnabled,
        isDemo: this.auction.isDemo,
      },
      current,
      teams,
      counts: { ...this.counts },
      nominationTurnTeamId,
      finished: this.auction.status === "FINISHED",
    };
  }

  broadcast() {
    this.io.to(`auction:${this.auctionId}`).emit("snapshot", this.buildSnapshot());
    this.maybeScheduleBots();
  }

  private toast(type: string, message: string) {
    this.io
      .to(`auction:${this.auctionId}`)
      .emit("toast", { type, message, at: new Date().toISOString() });
  }

  private async logEvent(type: string, payload: Record<string, unknown>, tx?: Tx) {
    const db = tx ?? prisma;
    await db.auctionEvent.create({
      data: { auctionId: this.auctionId, type, payload: payload as Prisma.InputJsonObject },
    });
  }

  // ---------------------------------------------------------------- commands

  async handleCommand(source: CommandSource, cmd: Command): Promise<CmdAck> {
    return this.queue.run(async () => {
      try {
        // dedupe retried commands (network flakiness)
        if (cmd.commandId) {
          if (this.seenCommands.has(cmd.commandId)) {
            return { ok: false, reason: "DUPLICATE_COMMAND", message: REJECT_MESSAGES.DUPLICATE_COMMAND };
          }
          this.seenCommands.add(cmd.commandId);
          this.seenCommandOrder.push(cmd.commandId);
          if (this.seenCommandOrder.length > 2000) {
            const drop = this.seenCommandOrder.splice(0, 1000);
            for (const id of drop) this.seenCommands.delete(id);
          }
        }

        if (source.kind === "participant") {
          return await this.handleParticipant(source.teamId, cmd as ParticipantCommand & Command);
        }
        return await this.handleAdmin(cmd as AdminCommand & Command);
      } catch (err) {
        console.error(`[engine ${this.auctionId}] command failed`, cmd.type, err);
        return { ok: false, reason: "INTERNAL", message: "Errore interno, riprova" };
      }
    });
  }

  private verdictToAck(v: Verdict): CmdAck {
    return v.ok ? { ok: true } : { ok: false, reason: v.reason, message: v.message };
  }

  private async handleParticipant(
    teamId: string,
    cmd: ParticipantCommand & { commandId: string },
  ): Promise<CmdAck> {
    switch (cmd.type) {
      case "bid":
        return this.verdictToAck(await this.placeBid(teamId, cmd.amount, cmd.commandId));
      case "pass":
        return this.verdictToAck(await this.pass(teamId));
      case "nominate":
        return this.verdictToAck(await this.nominate(teamId, cmd.playerId));
      default:
        return { ok: false, reason: "UNKNOWN", message: "Comando sconosciuto" };
    }
  }

  private async handleAdmin(cmd: AdminCommand & { commandId: string }): Promise<CmdAck> {
    switch (cmd.type) {
      case "start_auction": {
        if (this.auction.status !== "AUCTION_NOT_STARTED")
          return this.verdictToAck(reject("INVALID_TRANSITION"));
        await this.persistStatus("PLAYER_SELECTION", null);
        await this.logEvent("AUCTION_STARTED", {});
        this.toast("AUCTION_STARTED", "Asta iniziata!");
        this.broadcast();
        return { ok: true };
      }
      case "start_player":
        return this.verdictToAck(await this.startPlayer(cmd.playerId, null));
      case "random_player":
        return this.verdictToAck(await this.randomPlayer(cmd.role));
      case "close_bidding": {
        if (!this.current || !acceptsBids(this.auction.status))
          return this.verdictToAck(reject("INVALID_TRANSITION"));
        await this.enterClosing();
        return { ok: true };
      }
      case "assign_current":
        return this.verdictToAck(await this.assignCurrent());
      case "manual_assign":
        return this.verdictToAck(await this.manualAssign(cmd.playerId, cmd.teamId, cmd.price));
      case "mark_unsold":
        return this.verdictToAck(await this.markUnsold());
      case "cancel_current":
        return this.verdictToAck(await this.cancelCurrent());
      case "pause":
        return this.verdictToAck(await this.pause());
      case "resume":
        return this.verdictToAck(await this.resume());
      case "undo_last":
        return this.verdictToAck(await this.undoLast());
      case "edit_purchase":
        return this.verdictToAck(await this.editPurchase(cmd.purchaseId, cmd.teamId, cmd.price));
      case "release_player":
        return this.verdictToAck(
          await this.releasePlayer(cmd.purchaseId, cmd.refundPct, cmd.refundCredits),
        );
      case "transfer_player":
        return this.verdictToAck(
          await this.transferPlayer(cmd.purchaseId, cmd.toTeamId, cmd.creditAdjustment),
        );
      case "override_pass":
        return this.verdictToAck(await this.overridePass(cmd.teamId));
      case "set_bots": {
        this.auction.botsEnabled = cmd.enabled;
        await prisma.auction.update({
          where: { id: this.auctionId },
          data: { botsEnabled: cmd.enabled },
        });
        this.broadcast();
        return { ok: true };
      }
      case "finish_auction": {
        if (!canTransition(this.auction.status, "FINISHED"))
          return this.verdictToAck(reject("INVALID_TRANSITION"));
        this.clearAllTimers();
        this.current = null;
        await this.persistStatus("FINISHED", null);
        await this.logEvent("AUCTION_FINISHED", { manual: true });
        this.toast("AUCTION_FINISHED", "Asta terminata");
        this.broadcast();
        return { ok: true };
      }
      case "reopen_auction": {
        if (this.auction.status !== "FINISHED")
          return this.verdictToAck(reject("INVALID_TRANSITION"));
        await this.persistStatus("PLAYER_SELECTION", null);
        await this.logEvent("AUCTION_REOPENED", {});
        this.broadcast();
        return { ok: true };
      }
      default:
        return { ok: false, reason: "UNKNOWN", message: "Comando sconosciuto" };
    }
  }

  // ---------------------------------------------------------------- bidding

  private teamState(t: TeamMem): TeamState {
    return { budget: t.budget, spent: t.spent, rosterCounts: t.rosterCounts };
  }

  private async placeBid(teamId: string, amount: number, commandId: string): Promise<Verdict> {
    if (this.auction.status === "PAUSED") return reject("PAUSED");
    if (this.auction.status === "FINISHED") return reject("AUCTION_FINISHED");
    if (!this.current || !acceptsBids(this.auction.status)) return reject("AUCTION_NOT_ACTIVE");

    const team = this.teams.get(teamId);
    if (!team) return reject("UNAUTHORIZED");

    const verdict = canBid({
      team: this.teamState(team),
      rules: this.rules,
      settings: { minBid: this.auction.minBid, minIncrement: this.auction.minIncrement },
      role: this.current.player.role,
      currentBid: this.current.currentBid,
      amount,
      hasPassed: this.current.passed.has(teamId),
      isLeader: this.current.leaderTeamId === teamId,
    });
    if (!verdict.ok) return verdict;

    const now = new Date();
    const newClosesAt =
      this.auction.timerEnabled &&
      (this.auction.resetTimerOnBid || this.current.closesAt === null)
        ? new Date(now.getTime() + this.auction.timerSeconds * 1000)
        : this.current.closesAt;

    const reopening = this.current.status === "CLOSING";
    await prisma.$transaction([
      prisma.bid.create({
        data: {
          auctionPlayerId: this.current.auctionPlayerId,
          fantasyTeamId: teamId,
          amount,
          commandId,
        },
      }),
      prisma.auctionPlayer.update({
        where: { id: this.current.auctionPlayerId },
        data: {
          currentBid: amount,
          leaderTeamId: teamId,
          closesAt: newClosesAt,
          status: "ACTIVE",
        },
      }),
      ...(reopening
        ? [prisma.auction.update({ where: { id: this.auctionId }, data: { status: "PLAYER_ACTIVE" } })]
        : []),
    ]);

    this.current.currentBid = amount;
    this.current.leaderTeamId = teamId;
    this.current.closesAt = newClosesAt;
    this.current.bids.push({ teamId, amount, at: now.toISOString() });
    if (reopening) {
      this.current.status = "ACTIVE";
      this.auction.status = "PLAYER_ACTIVE";
      if (this.graceHandle) clearTimeout(this.graceHandle);
    }
    this.armTimer();
    this.broadcast();
    return { ok: true };
  }

  private async pass(teamId: string): Promise<Verdict> {
    if (this.auction.status === "PAUSED") return reject("PAUSED");
    if (!this.current || !acceptsBids(this.auction.status)) return reject("AUCTION_NOT_ACTIVE");
    if (!this.auction.passEnabled) return reject("PASS_DISABLED");
    if (this.current.passed.has(teamId)) return reject("ALREADY_PASSED");
    if (this.current.leaderTeamId === teamId) return reject("LEADER_CANNOT_PASS");
    const team = this.teams.get(teamId);
    if (!team) return reject("UNAUTHORIZED");

    await prisma.pass.create({
      data: { auctionPlayerId: this.current.auctionPlayerId, fantasyTeamId: teamId },
    });
    this.current.passed.add(teamId);
    await this.logEvent("PASS", { teamId, auctionPlayerId: this.current.auctionPlayerId });
    this.toast("PASS", `${team.name} passa`);
    this.broadcast();
    return { ok: true };
  }

  private async overridePass(teamId: string): Promise<Verdict> {
    if (!this.current) return reject("AUCTION_NOT_ACTIVE");
    if (!this.current.passed.has(teamId)) return reject("INVALID_TRANSITION", "La squadra non ha passato");
    await prisma.pass.deleteMany({
      where: { auctionPlayerId: this.current.auctionPlayerId, fantasyTeamId: teamId },
    });
    this.current.passed.delete(teamId);
    await this.logEvent("PASS_OVERRIDDEN", { teamId, auctionPlayerId: this.current.auctionPlayerId });
    this.broadcast();
    return { ok: true };
  }

  private async nominate(teamId: string, playerId: string): Promise<Verdict> {
    if (this.auction.nominationMode !== "ROUND_ROBIN")
      return reject("UNAUTHORIZED", "La nomina non è abilitata per i partecipanti");
    const turnTeam = this.teamOrder[this.auction.nominationTurnIndex % this.teamOrder.length];
    if (turnTeam !== teamId) return reject("UNAUTHORIZED", "Non è il tuo turno di nomina");
    return this.startPlayer(playerId, teamId);
  }

  // ------------------------------------------------------------ player lifecycle

  private async fastForwardFlash() {
    // allow starting the next player while the SOLD/UNSOLD flash is showing
    if (this.auction.status === "PLAYER_SOLD" || this.auction.status === "PLAYER_UNSOLD") {
      if (this.flashHandle) clearTimeout(this.flashHandle);
      this.flashHandle = null;
      await this.backToSelection(false);
    }
  }

  private async startPlayer(playerId: string, nominatedById: string | null): Promise<Verdict> {
    await this.fastForwardFlash();
    if (this.auction.status !== "PLAYER_SELECTION")
      return reject("INVALID_TRANSITION", "Seleziona il prossimo giocatore solo tra un'asta e l'altra");

    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player || !player.active) return reject("PLAYER_NOT_AVAILABLE");

    // ensure the AuctionPlayer row exists and is available
    const ap = await prisma.auctionPlayer.upsert({
      where: { auctionId_playerId: { auctionId: this.auctionId, playerId } },
      create: { auctionId: this.auctionId, playerId, status: "AVAILABLE" },
      update: {},
    });
    if (ap.status === "SOLD" || ap.status === "ACTIVE" || ap.status === "CLOSING")
      return reject("PLAYER_NOT_AVAILABLE");

    const closesAt = this.auction.timerEnabled
      ? new Date(Date.now() + this.auction.timerSeconds * 1000)
      : null;

    await prisma.$transaction([
      prisma.auctionPlayer.update({
        where: { id: ap.id },
        data: {
          status: "ACTIVE",
          currentBid: null,
          leaderTeamId: null,
          closesAt,
          nominatedById,
        },
      }),
      prisma.pass.deleteMany({ where: { auctionPlayerId: ap.id } }),
      prisma.auction.update({
        where: { id: this.auctionId },
        data: { status: "PLAYER_ACTIVE", currentAuctionPlayerId: ap.id },
      }),
    ]);

    this.auction.status = "PLAYER_ACTIVE";
    this.current = {
      auctionPlayerId: ap.id,
      playerId,
      player: playerToSnapshot(player),
      status: "ACTIVE",
      currentBid: null,
      leaderTeamId: null,
      closesAt,
      bids: [],
      passed: new Set(),
    };
    await this.reloadCounts();

    if (nominatedById && this.auction.nominationMode === "ROUND_ROBIN") {
      this.auction.nominationTurnIndex += 1;
      await prisma.auction.update({
        where: { id: this.auctionId },
        data: { nominationTurnIndex: this.auction.nominationTurnIndex },
      });
    }

    await this.logEvent("PLAYER_STARTED", {
      auctionPlayerId: ap.id,
      playerId,
      playerName: player.displayName,
      nominatedById,
    });
    this.toast("PLAYER_STARTED", `All'asta: ${player.displayName} (${player.teamAbbr}, ${player.role})`);
    this.armTimer();
    this.broadcast();
    return { ok: true };
  }

  private async randomPlayer(role?: Role): Promise<Verdict> {
    await this.fastForwardFlash();
    if (this.auction.status !== "PLAYER_SELECTION") return reject("INVALID_TRANSITION");
    const soldOrLive = await prisma.auctionPlayer.findMany({
      where: { auctionId: this.auctionId, status: { in: ["SOLD", "ACTIVE", "CLOSING"] } },
      select: { playerId: true },
    });
    const candidates = await prisma.player.findMany({
      where: {
        active: true,
        ...(role ? { role } : {}),
        id: { notIn: soldOrLive.map((s) => s.playerId) },
      },
      select: { id: true },
    });
    if (candidates.length === 0)
      return reject("PLAYER_NOT_AVAILABLE", "Nessun giocatore disponibile");
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return this.startPlayer(pick.id, null);
  }

  // ------------------------------------------------------------------- timer

  private clearAllTimers() {
    if (this.timerHandle) clearTimeout(this.timerHandle);
    if (this.graceHandle) clearTimeout(this.graceHandle);
    if (this.flashHandle) clearTimeout(this.flashHandle);
    this.timerHandle = this.graceHandle = this.flashHandle = null;
    for (const h of this.botHandles.values()) clearTimeout(h);
    this.botHandles.clear();
  }

  private armTimer() {
    if (this.timerHandle) clearTimeout(this.timerHandle);
    this.timerHandle = null;
    if (!this.current || this.current.status !== "ACTIVE") return;
    if (!this.auction.timerEnabled || !this.current.closesAt) return;
    const ms = Math.max(0, this.current.closesAt.getTime() - Date.now());
    this.timerHandle = setTimeout(() => {
      this.queue.run(async () => {
        // deadline may have moved (late bid) — re-check inside the queue
        if (
          this.current &&
          this.current.status === "ACTIVE" &&
          this.auction.status === "PLAYER_ACTIVE" &&
          this.current.closesAt &&
          this.current.closesAt.getTime() <= Date.now()
        ) {
          await this.enterClosing();
        } else {
          this.armTimer();
        }
      });
    }, ms);
  }

  private async enterClosing() {
    if (!this.current) return;
    await prisma.$transaction([
      prisma.auctionPlayer.update({
        where: { id: this.current.auctionPlayerId },
        data: { status: "CLOSING" },
      }),
      prisma.auction.update({ where: { id: this.auctionId }, data: { status: "PLAYER_CLOSING" } }),
    ]);
    this.current.status = "CLOSING";
    this.auction.status = "PLAYER_CLOSING";
    this.broadcast();

    if (this.graceHandle) clearTimeout(this.graceHandle);
    this.graceHandle = setTimeout(() => {
      this.queue.run(async () => {
        if (!this.current || this.current.status !== "CLOSING") return;
        if (this.current.leaderTeamId && this.auction.autoAssign) {
          await this.assignCurrent();
        } else if (!this.current.leaderTeamId) {
          await this.markUnsold();
        }
        // leader but !autoAssign → stay in CLOSING until the admin assigns
      });
    }, this.auction.closingGraceMs);
  }

  // -------------------------------------------------------------- assignment

  private async teamStateFromDb(
    tx: Tx,
    teamId: string,
    excludePurchaseId?: string,
  ): Promise<TeamState> {
    const purchases = await tx.purchase.findMany({
      where: {
        fantasyTeamId: teamId,
        voided: false,
        ...(excludePurchaseId ? { id: { not: excludePurchaseId } } : {}),
      },
      include: { auctionPlayer: { include: { player: true } } },
    });
    const adjustments = await tx.creditAdjustment.aggregate({
      where: { fantasyTeamId: teamId },
      _sum: { amount: true },
    });
    const counts: RosterCounts = { P: 0, D: 0, C: 0, A: 0 };
    let spent = adjustments._sum.amount ?? 0;
    for (const p of purchases) {
      spent += p.price;
      counts[p.auctionPlayer.player.role as Role] += 1;
    }
    return { budget: this.auction.startingBudget, spent, rosterCounts: counts };
  }

  /**
   * The transactional core (brief §34): lock/re-read → validate → purchase →
   * update auction player → event → commit.
   */
  private async executePurchase(
    auctionPlayerId: string,
    teamId: string,
    price: number,
    expectedStatuses: ("AVAILABLE" | "ACTIVE" | "CLOSING" | "UNSOLD")[],
  ): Promise<Verdict & { playerName?: string }> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const ap = await tx.auctionPlayer.findUnique({
          where: { id: auctionPlayerId },
          include: { player: true },
        });
        if (!ap || !(expectedStatuses as string[]).includes(ap.status)) {
          return reject("PLAYER_NOT_AVAILABLE");
        }
        const teamState = await this.teamStateFromDb(tx, teamId);
        const verdict = canAssign(
          teamState,
          this.rules,
          ap.player.role as Role,
          price,
          this.auction.minBid,
        );
        if (!verdict.ok) return verdict;

        await tx.purchase.create({
          data: { auctionPlayerId, fantasyTeamId: teamId, price },
        });
        await tx.auctionPlayer.update({
          where: { id: auctionPlayerId },
          data: { status: "SOLD", currentBid: price, leaderTeamId: teamId, closesAt: null },
        });
        await tx.auction.update({
          where: { id: this.auctionId },
          data: { status: "PLAYER_SOLD", currentAuctionPlayerId: auctionPlayerId },
        });
        await this.logEvent(
          "PLAYER_SOLD",
          { auctionPlayerId, playerId: ap.playerId, playerName: ap.player.displayName, teamId, price },
          tx,
        );
        return { ok: true as const, playerName: ap.player.displayName, player: ap.player };
      });

      if (!result.ok) return result;

      // memory updates
      const team = this.teams.get(teamId)!;
      team.spent += price;
      team.rosterCounts[(result as { player: { role: Role } }).player.role] += 1;
      await this.reloadCounts();
      return result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reject("PLAYER_NOT_AVAILABLE", "Giocatore già assegnato");
      }
      throw err;
    }
  }

  private async assignCurrent(): Promise<Verdict> {
    if (!this.current) return reject("AUCTION_NOT_ACTIVE");
    if (!this.current.leaderTeamId || this.current.currentBid === null)
      return reject("INVALID_TRANSITION", "Nessuna offerta da assegnare");
    const teamId = this.current.leaderTeamId;
    const price = this.current.currentBid;

    if (this.timerHandle) clearTimeout(this.timerHandle);
    if (this.graceHandle) clearTimeout(this.graceHandle);

    const result = await this.executePurchase(
      this.current.auctionPlayerId,
      teamId,
      price,
      ["ACTIVE", "CLOSING"],
    );
    if (!result.ok) return result;

    const team = this.teams.get(teamId)!;
    this.auction.status = "PLAYER_SOLD";
    this.current.status = "SOLD";
    this.current.soldToTeamId = teamId;
    this.current.soldPrice = price;
    this.current.closesAt = null;
    this.toast("SOLD", `${this.current.player.displayName} → ${team.name} per ${price}`);
    this.broadcast();
    this.scheduleFlashEnd();
    return { ok: true };
  }

  private async manualAssign(playerId: string, teamId: string, price: number): Promise<Verdict> {
    await this.fastForwardFlash();
    if (
      this.auction.status !== "PLAYER_SELECTION" &&
      !(this.current && this.current.playerId === playerId)
    ) {
      return reject("INVALID_TRANSITION");
    }
    if (!this.teams.get(teamId)) return reject("UNAUTHORIZED", "Squadra sconosciuta");

    if (this.timerHandle) clearTimeout(this.timerHandle);
    if (this.graceHandle) clearTimeout(this.graceHandle);

    const ap = await prisma.auctionPlayer.upsert({
      where: { auctionId_playerId: { auctionId: this.auctionId, playerId } },
      create: { auctionId: this.auctionId, playerId, status: "AVAILABLE" },
      update: {},
      include: { player: true },
    });
    const wasLive = ap.status === "ACTIVE" || ap.status === "CLOSING";

    const result = await this.executePurchase(ap.id, teamId, price, [
      "AVAILABLE",
      "ACTIVE",
      "CLOSING",
      "UNSOLD",
    ]);
    if (!result.ok) return result;

    const team = this.teams.get(teamId)!;
    this.auction.status = "PLAYER_SOLD";
    this.current = {
      auctionPlayerId: ap.id,
      playerId,
      player: playerToSnapshot(ap.player),
      status: "SOLD",
      currentBid: price,
      leaderTeamId: teamId,
      closesAt: null,
      bids: wasLive && this.current ? this.current.bids : [],
      passed: new Set(),
      soldToTeamId: teamId,
      soldPrice: price,
    };
    this.toast("SOLD", `${ap.player.displayName} → ${team.name} per ${price}`);
    this.broadcast();
    this.scheduleFlashEnd();
    return { ok: true };
  }

  private async markUnsold(): Promise<Verdict> {
    if (!this.current) return reject("AUCTION_NOT_ACTIVE");
    if (this.timerHandle) clearTimeout(this.timerHandle);
    if (this.graceHandle) clearTimeout(this.graceHandle);

    await prisma.$transaction([
      prisma.auctionPlayer.update({
        where: { id: this.current.auctionPlayerId },
        data: { status: "UNSOLD", closesAt: null, currentBid: null, leaderTeamId: null },
      }),
      prisma.auction.update({ where: { id: this.auctionId }, data: { status: "PLAYER_UNSOLD" } }),
    ]);
    this.auction.status = "PLAYER_UNSOLD";
    this.current.status = "UNSOLD";
    this.current.closesAt = null;
    await this.reloadCounts();
    await this.logEvent("PLAYER_UNSOLD", {
      auctionPlayerId: this.current.auctionPlayerId,
      playerName: this.current.player.displayName,
    });
    this.toast("UNSOLD", `${this.current.player.displayName} invenduto`);
    this.broadcast();
    this.scheduleFlashEnd();
    return { ok: true };
  }

  private async cancelCurrent(): Promise<Verdict> {
    if (!this.current || !acceptsBids(this.auction.status)) return reject("INVALID_TRANSITION");
    if (this.timerHandle) clearTimeout(this.timerHandle);
    if (this.graceHandle) clearTimeout(this.graceHandle);
    await prisma.$transaction([
      prisma.auctionPlayer.update({
        where: { id: this.current.auctionPlayerId },
        data: { status: "AVAILABLE", closesAt: null, currentBid: null, leaderTeamId: null },
      }),
      prisma.auction.update({
        where: { id: this.auctionId },
        data: { status: "PLAYER_SELECTION", currentAuctionPlayerId: null },
      }),
    ]);
    await this.logEvent("PLAYER_CANCELLED", {
      auctionPlayerId: this.current.auctionPlayerId,
      playerName: this.current.player.displayName,
    });
    this.auction.status = "PLAYER_SELECTION";
    this.current = null;
    await this.reloadCounts();
    this.broadcast();
    return { ok: true };
  }

  private scheduleFlashEnd() {
    if (this.flashHandle) clearTimeout(this.flashHandle);
    this.flashHandle = setTimeout(() => {
      this.queue.run(() => this.backToSelection(true));
    }, SOLD_FLASH_MS);
  }

  private async backToSelection(broadcast: boolean) {
    if (this.auction.status !== "PLAYER_SOLD" && this.auction.status !== "PLAYER_UNSOLD") return;

    // auction complete?
    const everyRosterFull = [...this.teams.values()].every((t) =>
      rosterComplete(this.rules, t.rosterCounts),
    );
    const target: AuctionStatus =
      everyRosterFull && this.teams.size > 0 ? "FINISHED" : "PLAYER_SELECTION";
    await this.persistStatus(target, null);
    this.current = null;
    if (target === "FINISHED") {
      await this.logEvent("AUCTION_FINISHED", { automatic: true });
      this.toast("AUCTION_FINISHED", "Tutte le rose sono complete: asta terminata!");
    }
    if (broadcast) this.broadcast();
  }

  private async persistStatus(status: AuctionStatus, currentAuctionPlayerId: string | null) {
    this.auction.status = status;
    await prisma.auction.update({
      where: { id: this.auctionId },
      data: { status, currentAuctionPlayerId },
    });
  }

  // ------------------------------------------------------------ pause/resume

  private async pause(): Promise<Verdict> {
    if (!canTransition(this.auction.status, "PAUSED")) return reject("INVALID_TRANSITION");
    const from = this.auction.status;
    let remainingMs: number | null = null;
    if (this.current?.closesAt) {
      remainingMs = Math.max(0, this.current.closesAt.getTime() - Date.now());
    }
    if (this.timerHandle) clearTimeout(this.timerHandle);
    if (this.graceHandle) clearTimeout(this.graceHandle);
    await prisma.auction.update({
      where: { id: this.auctionId },
      data: { status: "PAUSED", pausedFromStatus: from, pausedRemainingMs: remainingMs },
    });
    this.auction.status = "PAUSED";
    this.auction.pausedFromStatus = from;
    this.auction.pausedRemainingMs = remainingMs;
    if (this.current) this.current.closesAt = null;
    await this.logEvent("PAUSED", { from });
    this.toast("PAUSED", "Asta in pausa");
    this.broadcast();
    return { ok: true };
  }

  private async resume(): Promise<Verdict> {
    if (this.auction.status !== "PAUSED" || !this.auction.pausedFromStatus)
      return reject("INVALID_TRANSITION");
    const to = this.auction.pausedFromStatus;
    let closesAt: Date | null = null;
    if (
      this.current &&
      (to === "PLAYER_ACTIVE" || to === "PLAYER_CLOSING") &&
      this.auction.timerEnabled &&
      this.auction.pausedRemainingMs !== null
    ) {
      closesAt = new Date(Date.now() + Math.max(1500, this.auction.pausedRemainingMs));
    }
    await prisma.auction.update({
      where: { id: this.auctionId },
      data: { status: to, pausedFromStatus: null, pausedRemainingMs: null },
    });
    if (this.current && closesAt) {
      await prisma.auctionPlayer.update({
        where: { id: this.current.auctionPlayerId },
        data: { closesAt },
      });
      this.current.closesAt = closesAt;
      this.current.status = to === "PLAYER_CLOSING" ? "CLOSING" : "ACTIVE";
    }
    this.auction.status = to;
    this.auction.pausedFromStatus = null;
    this.auction.pausedRemainingMs = null;
    await this.logEvent("RESUMED", { to });
    this.toast("RESUMED", "Si riparte!");
    if (to === "PLAYER_CLOSING") {
      await this.enterClosing();
    } else {
      this.armTimer();
      this.broadcast();
    }
    return { ok: true };
  }

  // ------------------------------------------------------ corrections / undo

  private async undoLast(): Promise<Verdict> {
    const last = await prisma.purchase.findFirst({
      where: { voided: false, auctionPlayer: { auctionId: this.auctionId } },
      orderBy: { createdAt: "desc" },
      include: { auctionPlayer: { include: { player: true } }, fantasyTeam: true },
    });
    if (!last) return reject("INVALID_TRANSITION", "Nessun acquisto da annullare");

    await prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id: last.id },
        data: { voided: true, voidedAt: new Date(), voidReason: "undo" },
      });
      await tx.auctionPlayer.update({
        where: { id: last.auctionPlayerId },
        data: { status: "AVAILABLE", currentBid: null, leaderTeamId: null, closesAt: null },
      });
      await this.logEvent(
        "PURCHASE_UNDONE",
        {
          purchaseId: last.id,
          playerName: last.auctionPlayer.player.displayName,
          teamId: last.fantasyTeamId,
          price: last.price,
        },
        tx,
      );
      if (this.auction.status === "FINISHED") {
        await tx.auction.update({
          where: { id: this.auctionId },
          data: { status: "PLAYER_SELECTION" },
        });
      }
    });

    if (this.auction.status === "FINISHED") this.auction.status = "PLAYER_SELECTION";
    const team = this.teams.get(last.fantasyTeamId);
    if (team) {
      team.spent -= last.price;
      team.rosterCounts[last.auctionPlayer.player.role as Role] -= 1;
    }
    await this.reloadCounts();
    if (this.current?.auctionPlayerId === last.auctionPlayerId) {
      if (this.flashHandle) clearTimeout(this.flashHandle);
      this.current = null;
      await this.persistStatus("PLAYER_SELECTION", null);
    }
    this.toast(
      "UNDO",
      `Annullato: ${last.auctionPlayer.player.displayName} → ${last.fantasyTeam.name} (${last.price})`,
    );
    this.broadcast();
    return { ok: true };
  }

  private async editPurchase(
    purchaseId: string,
    newTeamId?: string,
    newPrice?: number,
  ): Promise<Verdict> {
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: { auctionPlayer: { include: { player: true } } },
    });
    if (!purchase || purchase.voided || purchase.auctionPlayer.auctionId !== this.auctionId)
      return reject("INVALID_TRANSITION", "Acquisto non trovato");

    const teamId = newTeamId ?? purchase.fantasyTeamId;
    const price = newPrice ?? purchase.price;
    if (!this.teams.get(teamId)) return reject("UNAUTHORIZED", "Squadra sconosciuta");

    const verdict = await prisma.$transaction(async (tx) => {
      const state = await this.teamStateFromDb(tx, teamId, purchaseId);
      const v = canAssign(
        state,
        this.rules,
        purchase.auctionPlayer.player.role as Role,
        price,
        this.auction.minBid,
      );
      if (!v.ok) return v;
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { fantasyTeamId: teamId, price },
      });
      await tx.auctionPlayer.update({
        where: { id: purchase.auctionPlayerId },
        data: { leaderTeamId: teamId, currentBid: price },
      });
      await this.logEvent(
        "PURCHASE_EDITED",
        {
          purchaseId,
          playerName: purchase.auctionPlayer.player.displayName,
          from: { teamId: purchase.fantasyTeamId, price: purchase.price },
          to: { teamId, price },
        },
        tx,
      );
      return { ok: true as const };
    });
    if (!verdict.ok) return verdict;

    await this.reloadTeams();
    this.toast(
      "EDIT",
      `Corretto: ${purchase.auctionPlayer.player.displayName} → ${this.teams.get(teamId)!.name} per ${price}`,
    );
    this.broadcast();
    return { ok: true };
  }

  private async releasePlayer(
    purchaseId: string,
    refundPct?: number,
    refundCredits?: number,
  ): Promise<Verdict> {
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: { auctionPlayer: { include: { player: true } }, fantasyTeam: true },
    });
    if (!purchase || purchase.voided || purchase.auctionPlayer.auctionId !== this.auctionId)
      return reject("INVALID_TRANSITION", "Acquisto non trovato");

    const refund =
      refundCredits !== undefined
        ? Math.max(0, Math.min(purchase.price, Math.round(refundCredits)))
        : Math.round((purchase.price * (refundPct ?? 100)) / 100);
    const retained = purchase.price - refund;

    await prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { voided: true, voidedAt: new Date(), voidReason: "released" },
      });
      await tx.auctionPlayer.update({
        where: { id: purchase.auctionPlayerId },
        data: { status: "AVAILABLE", currentBid: null, leaderTeamId: null, closesAt: null },
      });
      if (retained > 0) {
        await tx.creditAdjustment.create({
          data: {
            fantasyTeamId: purchase.fantasyTeamId,
            amount: retained,
            reason: `Svincolo ${purchase.auctionPlayer.player.displayName} (rimborso ${refund}/${purchase.price})`,
          },
        });
      }
      await this.logEvent(
        "PLAYER_RELEASED",
        {
          purchaseId,
          playerName: purchase.auctionPlayer.player.displayName,
          teamId: purchase.fantasyTeamId,
          price: purchase.price,
          refund,
        },
        tx,
      );
    });

    await this.reloadTeams();
    await this.reloadCounts();
    this.toast(
      "RELEASE",
      `${purchase.auctionPlayer.player.displayName} svincolato da ${purchase.fantasyTeam.name} (rimborso ${refund})`,
    );
    this.broadcast();
    return { ok: true };
  }

  private async transferPlayer(
    purchaseId: string,
    toTeamId: string,
    creditAdjustment?: number,
  ): Promise<Verdict> {
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: { auctionPlayer: { include: { player: true } }, fantasyTeam: true },
    });
    if (!purchase || purchase.voided || purchase.auctionPlayer.auctionId !== this.auctionId)
      return reject("INVALID_TRANSITION", "Acquisto non trovato");
    const toTeam = this.teams.get(toTeamId);
    if (!toTeam) return reject("UNAUTHORIZED", "Squadra sconosciuta");
    if (toTeamId === purchase.fantasyTeamId)
      return reject("INVALID_TRANSITION", "Stessa squadra");

    const verdict = await prisma.$transaction(async (tx) => {
      const state = await this.teamStateFromDb(tx, toTeamId);
      const v = canAssign(
        state,
        this.rules,
        purchase.auctionPlayer.player.role as Role,
        purchase.price,
        this.auction.minBid,
      );
      if (!v.ok) return v;
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { voided: true, voidedAt: new Date(), voidReason: "transferred" },
      });
      await tx.purchase.create({
        data: {
          auctionPlayerId: purchase.auctionPlayerId,
          fantasyTeamId: toTeamId,
          price: purchase.price,
        },
      });
      await tx.auctionPlayer.update({
        where: { id: purchase.auctionPlayerId },
        data: { leaderTeamId: toTeamId },
      });
      if (creditAdjustment && creditAdjustment !== 0) {
        // positive adjustment = credits refunded to the ORIGINAL team
        await tx.creditAdjustment.create({
          data: {
            fantasyTeamId: purchase.fantasyTeamId,
            amount: -Math.round(creditAdjustment),
            reason: `Conguaglio trasferimento ${purchase.auctionPlayer.player.displayName}`,
          },
        });
      }
      await this.logEvent(
        "PLAYER_TRANSFERRED",
        {
          playerName: purchase.auctionPlayer.player.displayName,
          fromTeamId: purchase.fantasyTeamId,
          toTeamId,
          price: purchase.price,
          creditAdjustment: creditAdjustment ?? 0,
        },
        tx,
      );
      return { ok: true as const };
    });
    if (!verdict.ok) return verdict;

    await this.reloadTeams();
    this.toast(
      "TRANSFER",
      `${purchase.auctionPlayer.player.displayName}: ${purchase.fantasyTeam.name} → ${toTeam.name}`,
    );
    this.broadcast();
    return { ok: true };
  }

  // -------------------------------------------------------------------- bots

  private maybeScheduleBots() {
    if (!this.auction.botsEnabled) return;
    if (!this.current || this.current.status !== "ACTIVE") return;
    if (this.auction.status !== "PLAYER_ACTIVE") return;

    for (const t of this.teams.values()) {
      if (!t.isBot) continue;
      if (this.botHandles.has(t.id)) continue;
      if (this.current.passed.has(t.id)) continue;
      if (this.current.leaderTeamId === t.id) continue;

      const key = `${this.current.auctionPlayerId}:${t.id}`;
      if (!this.botTargets.has(key)) {
        const q = this.current.player.quotation;
        this.botTargets.set(key, Math.max(1, Math.round(q * (0.6 + Math.random() * 1.7))));
      }
      const target = this.botTargets.get(key)!;
      const delay = 700 + Math.random() * 2200;
      const apId = this.current.auctionPlayerId;
      const handle = setTimeout(() => {
        this.botHandles.delete(t.id);
        this.queue.run(async () => {
          if (!this.current || this.current.auctionPlayerId !== apId) return;
          if (this.current.status !== "ACTIVE") return;
          if (this.current.leaderTeamId === t.id || this.current.passed.has(t.id)) return;
          const next =
            (this.current.currentBid ?? this.auction.minBid - this.auction.minIncrement) +
            this.auction.minIncrement;
          if (next <= target) {
            await this.placeBid(t.id, next, `bot-${t.id}-${apId}-${next}-${++this.botBidSeq}`);
          } else if (this.auction.passEnabled && Math.random() < 0.6) {
            await this.pass(t.id);
          }
        });
      }, delay);
      this.botHandles.set(t.id, handle);
    }
  }

  dispose() {
    this.clearAllTimers();
  }
}
