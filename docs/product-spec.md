# Fantaclasse — Product Specification

Real-time web app for running a live Italian Fantacalcio auction. It replaces Excel sheets,
paper notes and manual credit math during a physical auction night.

**It is not a league manager.** Scope is strictly: live auction room, player database,
squad builder, credit calculator, auction control panel.

## Devices & roles

| Device | Role | Screen |
|---|---|---|
| Laptop / TV | Auction admin | Control room, tabellone, lobby/QR |
| Smartphone (one per manager) | Fantasy manager | Bidding controller |

All devices stay synchronized in real time over WebSockets. The server is authoritative.

## Core flow

1. Admin creates an auction via a 4-step wizard (general → roster rules → teams → settings).
2. Each team gets a join code, a unique URL and a QR code (e.g. `/join/X7KP3`).
3. Managers scan the QR from their phone, pick their team, optionally enter the team PIN.
   No account creation. The phone becomes their bidding controller.
4. Admin imports/updates the Serie A player list (CSV/XLSX, Fantacalcio.it format supported).
5. Admin searches a player and starts the auction for them; the player appears on every device.
6. Managers bid (+1 / +5 / +10 / custom / pass). The server validates every bid.
7. Timer expires (optional) → player is assigned → credits, rosters and the board update everywhere.
8. Repeat until every roster is complete → final summary, stats and CSV export.

## Auction modes

- **MODE A — LIVE**: every manager bids from their smartphone. *(implemented)*
- **MODE B — ADMIN / MANUAL**: people bid verbally; admin records winner + price and presses
  ASSIGN. Keyboard-driven. *(implemented)*
- **MODE C — WILD**, **MODE D — POKER**, **MODE E — SEALED BID**: not in V1; the domain
  model (mode enum on Auction, per-mode bid validation strategy in the engine) is designed
  so they can be added without schema changes beyond new enum values.

## Key rules

### Maximum bid (server-enforced)

A manager may never spend so much that the roster cannot be completed:

```
maxBid = remainingCredits − (remainingRosterSlots − 1) × minimumPlayerCost
```

Role constraints are respected too: a team with a full attacker slot cannot bid on attackers
at all. Credits can never go negative. Every bid is validated server-side; client math is
display-only.

### Pass

When enabled, a manager can pass on the current player and cannot re-enter until the next
player. Admin can override a pass. Statuses shown per team: ACTIVE / PASSED / LEADING / BIDDING.

### Timer

Optional, configurable duration; resets on every valid bid. Deadline-based (`closesAt`
timestamp persisted server-side) — never "seconds remaining". After expiry a short
server-side closing grace interval absorbs in-flight bids, then the player is assigned.

### Admin corrections

- **UNDO last assignment** and **EDIT purchase** (team and/or price) — recalculates credits,
  squads, availability, roster counts. Audit trail kept; auction events are never deleted.
- **Release player** with configurable refund (100% / 50% / custom / 0%).
- **Transfer player** between teams with optional credit adjustment.

## Screens

1. **Home** — create auction, join with code, TRY DEMO AUCTION.
2. **Wizard** — 4 steps (general, roster, teams, settings).
3. **Lobby** — QR + join status per team ("8/8 managers connected"), copyable invite links.
4. **Admin control room** (laptop/TV) — current player card (giant price, leader, timer),
   all-teams grid (credits, max bid, roster P/D/C/A, connection + bid status), player search
   command palette (⌘K), manual assign, undo, pause, nomination controls, bid history.
5. **Tabellone** — full player board: search, role tabs P|D|C|A, filters (team, status,
   quotation range), sorting; sold players show buyer + price and are muted/hidden per setting.
6. **Mobile controller** — current player, current bid + leader, giant +1/+5/+10/custom/PASS
   buttons, own credits/max bid/roster, private watchlist hint ("YOUR TARGET 95 / MAX 120"),
   rejection reasons in Italian ("Credito insufficiente", "Devi conservare N crediti…").
7. **Squads / comparison** — per-team squad detail (spend per role, averages, credits per
   remaining slot) and live comparison table across all teams.
8. **End of auction** — summary, fun stats (most expensive player, biggest spender, biggest
   bidding war, overpayment vs quotation…), CSV export.

## Player data

Providers are pluggable (`PlayerProvider`: CsvPlayerProvider, ManualPlayerProvider,
RemotePlayerProvider). V1 ships CSV/XLSX import compatible with the Fantacalcio.it
Quotazioni export (columns: Id, R, RM, Nome, Squadra, Qt.A, Qt.I, FVM, …) plus a generic
CSV mapping, normalized into an internal `Player` table. A bundled sample Serie A list
powers the demo.

## Nomination modes

ADMIN_ONLY (default), ROUND_ROBIN, RANDOM_PLAYER, RANDOM_BY_ROLE — configurable in settings.
Admin can always draw a random player / random-by-role from the control room.

## Watchlist

Private per participant: player, priority (1–5 stars), target price, max price, notes.
Never visible to other managers or in any public payload.

## Demo mode

One click seeds a full auction: 8 teams, 500 credits, sample Serie A players, some players
already purchased, and bot bidders that place simulated bids so realtime can be tested
without 8 physical phones.

## Reliability requirements

- Zero important state in memory only; server restart recovers the auction mid-player.
- Reconnecting clients always refetch the authoritative snapshot.
- Sequential server-side bid processing; race conditions resolved by processing order,
  never by browser timestamps.
- All purchases transactional (see database-schema.md).

## Product priorities (in order)

1. Data correctness 2. Auction reliability 3. Realtime consistency 4. Speed of interaction
5. Mobile usability 6. Admin usability 7. Visual polish 8. Advanced statistics

## Definition of done (MVP)

The 20-step scenario in the build brief §40 must pass end-to-end: create 8-team auction,
QR join, search "Lautaro", live bids from phones with server-side rejection of invalid bids,
timer expiry, assignment, credit/roster/max-bid recalculation on every device, next player
without page refresh, and full recovery after browser reload or server restart.
