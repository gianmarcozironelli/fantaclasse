# Fantaclasse — Architecture

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** — UI and REST API routes
- **Custom Node server** (`src/server/index.ts`, run with `tsx`) — hosts the Next handler
  **and** the Socket.IO server in one process
- **Socket.IO** — realtime layer (WebSocket with fallback)
- **PostgreSQL** (Neon) + **Prisma** — persistence
- **Tailwind CSS 4** — styling (dark, broadcast-style UI)
- **Vitest** — unit tests for the domain logic

One process serves everything. This is intentional: a Fantacalcio auction is a small
deployment (≤ ~12 clients), and a single authoritative process is the simplest architecture
that guarantees sequential bid processing. Scaling out would require sticky sessions +
a Socket.IO adapter (Redis) — out of scope for V1 but not precluded.

## Layering

```
src/
  lib/domain/        pure business logic — no I/O, fully unit-tested
    types.ts         roles, auction states, settings types
    rules.ts         maxBid, remainingCredits, roster slots, canBid, canAssign
    stateMachine.ts  allowed state transitions
  lib/import/        PlayerProvider architecture (CSV/XLSX parsing, normalization)
  server/
    index.ts         boot: Next + Socket.IO + engine registry
    engine.ts        AuctionEngine — authoritative per-auction command processor
    snapshot.ts      builds the public snapshot broadcast to clients
    prisma.ts        Prisma client singleton
  app/               Next.js routes (pages + REST API)
  components/        shared React components
```

**Dependency direction:** `app` and `server` depend on `lib/domain`; `lib/domain` depends
on nothing. All money/roster math lives in `lib/domain/rules.ts` and is used by both the
REST layer and the realtime engine, so there is exactly one implementation of every rule.

## The AuctionEngine

One engine instance per active auction, created lazily and hydrated **from the database**
(never from client state). It owns:

- an in-memory mirror of the auction's authoritative state (teams, credits, current player,
  bids, passes) — a cache of the DB, rebuilt on boot;
- a **sequential command queue**: every mutating command (bid, pass, admin ops) is appended
  to a promise chain, so commands are processed strictly one at a time. Two near-simultaneous
  bids are ordered by arrival at the server; browser timestamps are never consulted;
- the **timer**: a `closesAt` deadline persisted on the current `AuctionPlayer`. The engine
  arms a `setTimeout` for the deadline; on expiry it enters `PLAYER_CLOSING`, waits a short
  configurable grace interval (absorbing in-flight bids, which reopen `PLAYER_ACTIVE`),
  then assigns the player. On process restart the deadline is re-read and re-armed —
  clients compute the countdown from the deadline, the server never stores "seconds left".

### Command flow (LIVE bid)

```
phone ──socket "cmd" {type:"bid", amount, commandId}──▶ engine queue
  validate (auction state, ownership, not passed, amount > current,
            increment, maxBid incl. roster reserve, role slots, dedupe commandId)
  ├─ invalid → ack {ok:false, reason}  (Italian message shown on the phone)
  └─ valid   → persist Bid + update AuctionPlayer + event row
               reset closesAt, re-arm timer
               broadcast snapshot to room
```

Client bids show optimistic UI instantly; the ack + next snapshot reconcile it.

### Assignment (transactional, §34 of the brief)

```
prisma.$transaction:
  re-read AuctionPlayer  → must still be ACTIVE/CLOSING (or AVAILABLE in manual mode)
  re-validate team budget & roster via domain rules
  create Purchase
  update AuctionPlayer  → SOLD
  create AuctionEvent   (immutable audit log)
commit → engine reloads team aggregates → broadcast
```

Credits are derived (budget − Σ active purchases) rather than stored as a mutable counter,
so they cannot drift. A partial unique index (`auction_player(auction_id, player_id)` unique,
`purchase` unique on active auctionPlayer) makes double-selling impossible at the DB level.

## Auth model

- **Admin**: `Auction.adminToken` — 32-char random token generated at creation, returned
  once and kept in the creator's localStorage. Sent as `x-admin-token` header (REST) or in
  the socket handshake. All privileged commands verify it server-side.
- **Participant**: each team has a short `joinCode` (human-typable, QR-encoded) and an
  optional PIN. `POST /api/join` exchanges code+PIN for a long random `Participant.token`,
  stored in the phone's localStorage. The token authorizes bidding *for that team only*
  and watchlist CRUD. Public IDs are cuids; no sequential IDs anywhere.
- Spectators (tabellone on the TV, squads pages) need no auth — they only receive the
  public snapshot, which never contains watchlists, PINs or tokens.

## REST vs realtime

- REST (`/app/api/*`): auction CRUD, wizard, team CRUD, player import/search, join,
  watchlist, export, demo seeding — request/response things.
- Socket.IO: everything during the live auction — commands in, snapshots + events out.
  Rooms: `auction:{id}` (public snapshot), per-socket private messages for acks.

## Recovery

Every fact lives in Postgres: current state, current player, bids, `closesAt`, passes,
purchases, events. On boot the engine registry lazily rehydrates engines on first contact;
an interrupted `PLAYER_ACTIVE` resumes with its deadline (expired deadlines close normally).
Reload of any client = socket reconnect = fresh snapshot. No client state is trusted, ever.

## Player import

`PlayerProvider` interface (`lib/import/provider.ts`) returns normalized `PlayerInput[]`.
Implemented: `CsvPlayerProvider` (Fantacalcio.it Quotazioni CSV/XLSX auto-detected +
generic header mapping), `ManualPlayerProvider` (single-player form). A future
`RemotePlayerProvider` only needs to implement the same interface. Imports upsert by
`externalId` (fallback: name+team), never breaking existing purchases.

## Demo bots

Demo auctions mark teams `isBot`. A bot driver inside the engine (enabled per auction,
toggleable by admin) places valid bids through the exact same command queue as phones —
so realtime, validation and race handling are exercised for real.
