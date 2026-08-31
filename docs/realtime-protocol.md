# Fantaclasse — Realtime Protocol

Transport: Socket.IO, single namespace. All payloads JSON. The server is authoritative;
clients render snapshots and send commands. Clients never compute outcomes.

## Handshake

```
io(url, { auth: {
  auctionId:  string,
  role:       "admin" | "participant" | "spectator",
  token?:     string   // adminToken or participant token, per role
}})
```

The server verifies the token against the DB. Invalid → `connect_error("unauthorized")`.
On success the socket joins room `auction:{id}` and immediately receives a full `snapshot`.
Participant sockets additionally receive their `private` payload (own team id, watchlist).

## Server → client

### `snapshot` — full public state (sent on connect and after every mutation)

```jsonc
{
  "seq": 1423,                     // monotonic; clients drop stale snapshots
  "auction": { "id", "name", "season", "status", "mode", "settings": {…},
               "rosterRules": {"P":3,"D":8,"C":8,"A":6}, "nominationMode", "botsEnabled" },
  "current": {                     // null unless a player is up
    "auctionPlayerId", "player": { "displayName","teamName","teamAbbr","role",
                                   "quotation","fvm","imageUrl" },
    "status", "currentBid", "leaderTeamId", "closesAt",   // ISO deadline or null
    "bids": [ { "teamId","amount","at" }, … ]             // history, newest last
  },
  "teams": [ {
    "id","name","managerName","color","sortOrder","joinCode",
    "credits","spent","maxBid",
    "roster": {"P":{"filled":1,"max":3}, …},
    "slotsRemaining", "avgPerRemainingSlot",
    "connected", "hasPassed", "isLeading", "isBot"
  } ],
  "counts": { "available": 512, "sold": 37, "unsold": 2 },
  "nominationTurnTeamId": null | "…",
  "finished": false
}
```

Snapshots are small (≤ a few KB) — broadcasting the whole thing after each change is the
simplest guaranteed-consistent sync and trivially correct on reconnect. Timer countdowns are
computed client-side from `closesAt` vs a server-time offset (see `time` below).

### `private` — participant-only (own socket)

```jsonc
{ "teamId": "…", "watchlist": [ { "playerId","priority","targetPrice","maxPrice","notes" } ] }
```

### `toast` — human-readable event line for UIs (also drives bid-history tickers)

```jsonc
{ "type": "SOLD", "message": "Leão → Real Madrink per 87", "at": "…" }
```

### `time` — server clock sync, sent on connect

```jsonc
{ "now": "2026-08-31T21:04:12.000Z" }   // client stores offset = serverNow − Date.now()
```

## Client → server

### `cmd` — every mutation, with ack callback

```jsonc
// request
{ "commandId": "cuid",        // client-generated, unique; server dedupes retries
  "type": "…", …payload }
// ack
{ "ok": true }  |  { "ok": false, "reason": "MAX_BID_EXCEEDED",
                     "message": "Devi conservare 5 crediti per completare la rosa" }
```

Participant commands:

| type | payload | notes |
|---|---|---|
| `bid` | `{ amount }` | absolute amount, not increment |
| `pass` | `{}` | only if passEnabled |

Admin commands (require admin socket):

| type | payload |
|---|---|
| `start_player` | `{ playerId }` — AVAILABLE → ACTIVE, arms timer |
| `random_player` | `{ role? }` — draws + starts a random available player |
| `close_bidding` | `{}` — force timer to zero now |
| `assign_current` | `{}` — assign to current leader at current bid |
| `manual_assign` | `{ playerId, teamId, price }` — MODE B one-shot |
| `mark_unsold` | `{}` — current player goes UNSOLD (re-nominatable) |
| `pause` / `resume` | `{}` |
| `cancel_current` | `{}` — abort current player back to AVAILABLE, void bids |
| `undo_last` | `{}` — void most recent purchase, player back to AVAILABLE |
| `edit_purchase` | `{ purchaseId, teamId?, price? }` |
| `release_player` | `{ purchaseId, refundPct? , refundCredits? }` |
| `transfer_player` | `{ purchaseId, toTeamId, creditAdjustment? }` |
| `override_pass` | `{ teamId }` |
| `set_bots` | `{ enabled }` |
| `finish_auction` | `{}` |

### Rejection reasons (participant-facing, message in Italian)

`AUCTION_NOT_ACTIVE, NOT_YOUR_TURN, ALREADY_PASSED, BID_TOO_LOW, BAD_INCREMENT,
INSUFFICIENT_CREDITS, MAX_BID_EXCEEDED (roster reserve), ROLE_FULL, ROSTER_FULL,
PLAYER_NOT_AVAILABLE, DUPLICATE_COMMAND, PASS_DISABLED, LEADER_CANNOT_PASS, PAUSED`

## Ordering & races

All `cmd`s for one auction run through a single sequential queue. The first bid the queue
processes at a given amount wins it; a later equal/lower bid gets `BID_TOO_LOW`. Browser
timestamps are ignored. `commandId` dedupe makes client retries (flaky mobile networks) safe.

## Presence

Socket connect/disconnect updates `Participant.lastSeenAt` and the `connected` flag in the
next snapshot. Clients show ONLINE / RECONNECTING (socket.io reconnecting) / OFFLINE from
their own socket state; on every reconnect they receive a fresh snapshot — stale local
state is always discarded.
