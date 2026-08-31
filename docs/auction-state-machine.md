# Fantaclasse — Auction State Machine

Two coordinated machines, both persisted (no boolean-flag soup):

- **Auction.status** — the auction as a whole
- **AuctionPlayer.status** — the player currently (or previously) in play

Transitions are validated by `src/lib/domain/stateMachine.ts`; every transition writes an
`AuctionEvent`.

## Auction.status

```
AUCTION_NOT_STARTED ──start──▶ PLAYER_SELECTION ◀─────────────┐
                                    │ start_player            │ sold/unsold/cancel
                                    ▼                         │
                               PLAYER_ACTIVE ──timer 0──▶ PLAYER_CLOSING
                                    ▲                         │
                                    └────── late valid bid ───┘   (reopens, grace window)
                               PLAYER_CLOSING ──grace elapsed──▶ PLAYER_SOLD / PLAYER_UNSOLD
                               PLAYER_SOLD/UNSOLD ──auto──▶ PLAYER_SELECTION
                                    │
      any of {SELECTION, ACTIVE} ──pause──▶ PAUSED ──resume──▶ (previous state)
                               PLAYER_SELECTION ──all rosters full / finish──▶ FINISHED
```

Notes:

- `PLAYER_SOLD` / `PLAYER_UNSOLD` are transient result states: the assignment transaction
  commits in that state and the engine immediately returns to `PLAYER_SELECTION` (they are
  visible in the event log and in the snapshot for the result flash on clients).
- `PAUSED` freezes the timer: on pause the remaining ms are computed from `closesAt` and
  stored; on resume a new `closesAt` is set from the remainder. Bids are rejected with
  `PAUSED` while paused.
- `FINISHED` is reached automatically when every team's roster is complete, or manually
  via `finish_auction`. Undo from the summary screen reopens (`FINISHED → PLAYER_SELECTION`).
- Manual mode (`MODE B`) uses the same machine: `manual_assign` runs
  `PLAYER_SELECTION → PLAYER_SOLD → PLAYER_SELECTION` in one transaction. If a player was
  first started live, admin can still assign or cancel from `PLAYER_ACTIVE`.

## AuctionPlayer.status

```
AVAILABLE ──start_player──▶ ACTIVE ──deadline──▶ CLOSING ──grace──▶ SOLD
    ▲                         │  ▲                  │ late bid ▲        │ undo/release
    │                         │  └──────────────────┘                   ▼
    ├───── cancel_current ────┘                                     AVAILABLE
    └───── mark UNSOLD ─── UNSOLD ──renominate──▶ ACTIVE
```

- `SOLD` requires exactly one non-voided Purchase (DB-enforced).
- `undo_last` / `release_player` void the Purchase and return the player to `AVAILABLE`
  (with refund logic for release).
- `UNSOLD` players remain nominatable later (shown distinctly on the tabellone).

## Timer detail

- On `start_player` and on every valid bid (when `resetTimerOnBid`):
  `closesAt = now + timerSeconds` (persisted on AuctionPlayer).
- Engine arms `setTimeout(closesAt − now)`. Firing while state is `ACTIVE` →
  `CLOSING` + schedules the grace timeout (`closingGraceMs`, default 800 ms).
- A valid bid arriving during `CLOSING` (network race) reopens `ACTIVE` with a fresh
  deadline — this is the "short configurable server-side closing interval" from the brief.
- Grace elapsing with a leader → assignment transaction; without any bid → `UNSOLD`
  (auto) or waits for admin, per `autoAssign`.
- `timerEnabled=false`: no deadline; admin closes with `close_bidding` / `assign_current`.
- Restart recovery: engine rehydrates, finds `ACTIVE` with `closesAt` in the past →
  proceeds through `CLOSING` normally. Clients only ever render `closesAt − serverNow`.

## Invariants checked on every transition

1. Transition must exist in the table above (else `INVALID_TRANSITION`).
2. At most one AuctionPlayer in `ACTIVE`/`CLOSING` per auction.
3. `Auction.currentAuctionPlayerId` is non-null iff status ∈ {PLAYER_ACTIVE, PLAYER_CLOSING,
   PLAYER_SOLD, PLAYER_UNSOLD (flash)} — and always cleared on return to PLAYER_SELECTION.
4. Every transition appends an AuctionEvent; none deletes history.
