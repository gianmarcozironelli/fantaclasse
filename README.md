# Fantaclasse

Real-time web app for running a live Italian **Fantacalcio auction**. It replaces the
Excel sheet, the paper notes and the manual credit math during auction night.

One laptop/TV drives the room, every manager bids from their phone, and all devices stay
in sync over WebSockets. The server is authoritative: every bid, every credit and every
roster slot is validated server-side.

```
Laptop / TV  →  control room, tabellone, lobby with QR codes
Smartphone   →  one bidding controller per fantasy manager
```

## Quick start

```bash
npm install
cp .env.example .env        # then set DATABASE_URL to your Postgres
npm run db:push
npm run dev                 # http://localhost:3000
```

Open the homepage and click **PROVA LA DEMO** — it seeds an 8-team auction with 500
credits, a sample Serie A list, a few players already sold, and bots that place real bids
so you can test realtime without eight physical phones.

## ⚠️ About the bundled player list

**The player list shipped in this repo is sample data, not official data.** It was written
by hand so the app runs out of the box and the demo has something to auction. Specifically:

- ~200 **real Serie A players** (names, clubs, roles) — accurate to the best of the
  author's knowledge, but reflecting roughly the 2025/26 squads, so some transfers are stale.
- **Quotations and FVM values are estimates**, not the official Fantacalcio.it numbers.
  They look plausible; they are not authoritative and will not match your league.
- **~300 invented filler players** (Rossi, Bianchi, Ferrari…) padding each club to a full
  squad, so eight teams can actually complete 25-man rosters in the demo.
  **These people do not exist.**

Nothing here was scraped from Fantacalcio.it and no external API is called — that is
deliberate (their quotations are their data, and redistributing them in a public repo
would not be ours to do).

**Before a real auction**, download the official *Quotazioni* export from Fantacalcio.it
and upload it at `/a/{id}/settings`. Leave **"Sostituisci l'intera lista"** ticked and the
sample players are retired from the board in one step. Players already bought stay visible
in the auctions that used them, so history is never lost.

## Scripts

| command | what it does |
|---|---|
| `npm run dev` | Next.js + Socket.IO in one process, with watch reload |
| `npm run build` | `prisma generate` + production Next build |
| `npm start` | production server |
| `npm test` | domain unit tests + engine integration tests (needs `DATABASE_URL`) |
| `npm run db:push` | sync the Prisma schema to the database |

After the first `db:push`, add the partial unique index that guarantees one active
purchase per player (Prisma cannot express it):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS purchase_one_active_per_player
  ON "Purchase" ("auctionPlayerId") WHERE voided = false;
```

## How an auction runs

1. **Create** — `/new` wizard: name, teams, budget, roster (3P/8D/8C/6A by default),
   auction rules (timer, increments, pass, nomination mode, live vs manual).
2. **Import players** — `/a/{id}/settings` accepts the Fantacalcio.it *Quotazioni*
   CSV/XLSX export, or any sheet with `Nome`, `R`/`Ruolo`, `Squadra` columns. A bundled
   sample list works out of the box.
3. **Lobby** — `/a/{id}/lobby` shows one QR code and join code per team. Managers scan,
   optionally enter the team PIN, and their phone becomes their controller. No accounts.
4. **Auction** — `/a/{id}/admin` is the control room: giant current price, leader, timer,
   all teams with credits/max-bid/roster, player search (⌘K), bid history, undo.
   Phones use `/a/{id}/play`: +1 / +5 / +10 / custom / PASS.
5. **Watch** — `/a/{id}/board` (tabellone), `/a/{id}/squads` (rose + live comparison),
   `/a/{id}/summary` (final stats + CSV export).

### Manual mode

Not every league wants phones. Set the auction to **MANUAL** and people bid out loud:
the admin picks the player, the winning team and the price, and presses ASSIGN. Credits,
squads, availability, roster counts and max bids all update automatically.

### Admin hotkeys

`⌘K` search · `1`–`4` role filters · `R` random player · `U` undo last purchase ·
`SPACE` pause/resume · `ESC` close modal · `↑↓` + `ENTER` start/assign the highlighted player.

## The rule that matters

A manager may never spend so much that their roster cannot be completed:

```
maxBid = remainingCredits − (remainingRosterSlots − 1) × minimumBid
```

Role limits apply too (a full attack cannot bid on attackers). Credits are **derived**
from active purchases rather than stored as a mutable counter, so they cannot drift, and
they can never go negative. Every purchase runs in a transaction that re-reads and
re-validates before committing.

## Reliability

- **Server-authoritative.** Client math is display only; every bid is re-validated.
- **Sequential command queue** per auction — two simultaneous bids are ordered by arrival
  at the server, never by browser timestamps. Retried commands are deduped by `commandId`.
- **Deadline-based timers.** The server stores `closesAt`, never "seconds remaining";
  clients render the countdown from that deadline against a synced server clock.
- **Full recovery.** Everything lives in Postgres. Reload a browser or restart the server
  mid-player and the auction resumes — including the running timer.
- **Immutable audit log.** Undo, edit, release and transfer all *void* rather than delete;
  `AuctionEvent` rows are never removed.

## Corrections

Real auctions have mistakes. The admin can undo the last assignment, edit a purchase
(team and/or price), release a player with a configurable refund (100 / 50 / custom / 0 %),
transfer a player between teams with a credit adjustment, and override a pass. Every
correction recalculates credits, rosters, availability and max bids everywhere.

## Tech

Next.js 15 (App Router) · React 19 · TypeScript · PostgreSQL + Prisma · Socket.IO ·
Tailwind CSS 4 · Vitest.

A custom Node server (`src/server/index.ts`) hosts the Next handler and the Socket.IO
server in a single process — the simplest architecture that guarantees strictly sequential
bid processing for a ≤12-client deployment.

## Docs

| file | contents |
|---|---|
| [docs/product-spec.md](docs/product-spec.md) | scope, flows, screens, modes, definition of done |
| [docs/architecture.md](docs/architecture.md) | layering, the auction engine, auth, recovery |
| [docs/database-schema.md](docs/database-schema.md) | entities, relationships, integrity rules |
| [docs/realtime-protocol.md](docs/realtime-protocol.md) | socket events, commands, rejection reasons |
| [docs/auction-state-machine.md](docs/auction-state-machine.md) | both state machines and the timer |

## Tests

```bash
npm test
```

Covers `maximumBid`, `remainingCredits`, `availableRosterSlots`, `canBid`, `canAssign`,
the state machine and the command queue as pure units, plus database-backed engine tests
for assignment, undo, edit, release, duplicate commands, simultaneous bids, already-sold
players, full roles, budget reserves and restart recovery.
