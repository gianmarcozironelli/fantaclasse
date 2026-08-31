# Fantaclasse — Database Schema

PostgreSQL via Prisma. Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma).
All IDs are cuids (non-sequential, unguessable). Timestamps are UTC.

## Entities

### Auction
The league/auction night. Holds settings and the live pointer to the current player.

| field | notes |
|---|---|
| id, name, season | |
| mode | `LIVE` \| `MANUAL` (enum ready for `WILD`, `POKER`, `SEALED`) |
| ruleset | `CLASSIC` \| `MANTRA` |
| status | auction state machine value (see auction-state-machine.md) |
| startingBudget | default 500 |
| minBid, minIncrement | defaults 1 / 1 |
| timerEnabled, timerSeconds | default on / 10 |
| resetTimerOnBid | default true |
| closingGraceMs | server-side closing interval, default 800 |
| nominationMode | `ADMIN_ONLY` \| `ROUND_ROBIN` \| `RANDOM_PLAYER` \| `RANDOM_BY_ROLE` |
| autoAssign | assign automatically at timer zero |
| passEnabled | |
| hideSoldPlayers | tabellone behavior |
| adminToken | secret, never in public payloads |
| currentAuctionPlayerId | nullable pointer to the live AuctionPlayer |
| nominationTurnIndex | for round-robin |
| botsEnabled | demo bot driver |

### RosterRule
Per-auction, per-role slot count. `(auctionId, role)` unique. Classic default 3P/8D/8C/6A.

### FantasyTeam
| field | notes |
|---|---|
| auctionId, name, managerName?, color?, sortOrder | name editable any time |
| joinCode | short unique human code (QR/URL) |
| pin? | optional 4-digit protection |
| isBot | demo |

Credits are **derived**: `startingBudget − Σ price of active purchases`. Never stored.

### Participant
The person on the phone. 1:1 with FantasyTeam within an auction (unique `fantasyTeamId`).
Holds the long random `token` (localStorage on the phone) and `lastSeenAt` for presence.

### Player
Normalized Serie A player (auction-independent): externalId?, firstName?, lastName?,
displayName, teamName, teamAbbr, role (P/D/C/A), mantraRoles[], initialQuotation,
currentQuotation, fvm?, imageUrl?, active, updatedAt.

### PlayerSeasonData
Historical quotation rows per player per season/import batch (player 1:N).

### AuctionPlayer
A player *inside* an auction. `(auctionId, playerId)` **unique** → a player can never be
in play twice. Holds: status (`AVAILABLE`/`ACTIVE`/`CLOSING`/`SOLD`/`UNSOLD`),
currentBid?, leaderTeamId?, closesAt? (timer deadline), nominatedById?.

### Bid
Immutable bid log: auctionPlayerId, fantasyTeamId, amount, `commandId` **unique**
(idempotency/dedupe of retried commands), createdAt (server clock). 1:N from AuctionPlayer.

### Purchase
auctionPlayerId, fantasyTeamId, price, `voided` flag + voidedAt/voidReason.
Undo **voids** (never deletes) and reopens the AuctionPlayer. A partial unique index
allows **at most one non-voided purchase per AuctionPlayer** — enforced by the DB, so a
player cannot belong to two teams even under races.

### Pass
`(auctionPlayerId, fantasyTeamId)` unique — who passed on the current player. Cleared
logically per player (each AuctionPlayer has its own pass rows). Admin override deletes the row (the PASS_OVERRIDDEN event keeps the audit trail).

### AuctionEvent
Append-only audit log: auctionId, type, JSON payload, createdAt. Every action
(bid, pass, sold, undo, edit, release, transfer, state change, import…) writes one.
Never deleted, never updated.

### WatchlistEntry
`(participantId, playerId)` unique: priority 1–5, targetPrice?, maxPrice?, notes?.
Only ever serialized to its owner.

### Invitation
Per-team invite artifact: token (= joinCode), url; kept as its own row for auditing and
future multi-use invites.

## Relationships

```
Auction 1─N RosterRule
Auction 1─N FantasyTeam 1─1 Participant
Auction 1─N AuctionPlayer N─1 Player 1─N PlayerSeasonData
AuctionPlayer 1─N Bid, 1─N Pass, 1─N Purchase (≤1 active)
FantasyTeam 1─N Purchase, 1─N Bid
Auction 1─N AuctionEvent
Participant 1─N WatchlistEntry
FantasyTeam 1─1 Invitation
```

## Integrity rules (enforced server-side + DB constraints)

1. Credits never negative — validated in the assignment transaction against derived credits.
2. One player, one team — partial unique index on active Purchase + unique (auctionId, playerId).
3. Roster limits — validated inside the same transaction that creates the Purchase.
4. Max bid reserve — `maxBid = credits − (slotsRemaining − 1) × minBid`, role-aware.
5. Purchases are transactional: lock/re-read AuctionPlayer → validate → create Purchase →
   update AuctionPlayer → event row → commit (Prisma `$transaction`).
6. Nothing privileged is reachable by sequential/guessable IDs.
