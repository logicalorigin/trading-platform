# Signal Monitor Current Cell Model V1

Status: draft for decision
Date: 2026-06-26

## Objective

Make the signal monitor data model easier to reason about and safer to repair:

- `signal_monitor_events` remains the master receipt book for signal history.
- `signal_monitor_symbol_states` becomes the explicit current-cell projection for the live matrix and algo reads.
- `signal_monitor_breadth_snapshots` becomes optional cache, not required source of truth.

This plan does not propose a one-table merge. It proposes one canonical event log plus one rich current-cell table.

## Current Observations

Read-only snapshot on 2026-06-26:

| Table | Rows | Approx total size | Job |
| --- | ---:| ---:| --- |
| `signal_monitor_events` | 40,595 | 49 MB | Durable signal history and idempotency |
| `signal_monitor_symbol_states` | 5,153 | 35 MB | Current matrix cell projection |
| `signal_monitor_breadth_snapshots` | 21,568 | 4.2 MB | Derived breadth chart cache |
| `signal_monitor_profiles` | 2 | small | Environment/profile config |

Active state rows:

| Environment | Active rows | Symbols | Timeframes | Direction rows | Fresh rows |
| --- | ---:| ---:| ---:| ---:| ---:|
| `shadow` | 3,188 | 536 | 6 | 3,182 | 40 |
| `live` | 1,919 | 461 | 6 | 1,156 | 36 |

The "only two" rows the UI/operator sees are likely the two monitor profiles, not the state rows. State rows are one per environment/profile, symbol, and timeframe.

## Current Responsibilities

### `signal_monitor_events`

The receipt book. It records that a signal occurred and protects idempotency with `event_key`.

Keep as canonical for:

- signal identity
- signal history
- event listing
- replay/reconciliation
- point-in-time direction lookups
- idempotency

Do not use it alone as the live dashboard. Events do not continuously update latest bar, freshness, status, trend, or errors.

### `signal_monitor_symbol_states`

The current dashboard cell table. It should be treated as:

```text
one row = one current matrix cell for one profile + symbol + timeframe
```

It already carries most fields the live app needs:

- current signal direction, time, price, close
- trend direction
- latest bar time and close
- bars since signal
- fresh/stale/status
- active flag
- score/filter state
- MFE/MAE
- last evaluation and error

This is the right table to improve. It should become a deliberate projection, not a mystery table.

### `signal_monitor_breadth_snapshots`

A small chart cache. It is derived from current states and can also be rebuilt from events. It is not the master source.

The current table is not a large storage problem. The stronger reason to remove or reduce it would be simplification, not disk pressure.

## Recommended V1 Design

### 1. Keep events as canonical history

No change to the core job of `signal_monitor_events`.

Possible additions later:

- stronger replay indexes
- latest trusted event anchor per `(profile_id, symbol, timeframe)`
- richer event payload for future rebuilds if parity checks expose a missing field

### 2. Promote states to current cells

Keep the physical table for now, but rename the concept in code/docs:

```text
signal_monitor_symbol_states -> signal monitor current cells
```

Potential table rename can wait. The safe V1 is semantic cleanup plus small additive columns.

Recommended additive columns:

| Column | Purpose |
| --- | --- |
| `latest_signal_event_id` | Points current cell back to the canonical receipt row |
| `latest_signal_event_key` | Debug/idempotency trace without a join |
| `signal_bar_at` | Explicit bar anchor for the active signal |
| `signal_event_emitted_at` | When the canonical signal event was written |
| `projection_source` | `live_evaluation`, `event_rebuild`, `bar_cache_repair`, etc. |
| `projection_version` | Lets rebuild logic change safely |
| `projected_at` | When this current-cell row was last projected |
| `projection_error` | Why rebuild/projection could not fully hydrate the row |

These columns let the table include the useful traceability from events without swallowing the full event log.

### 3. Replace breadth DB dependency with a read model

Current breadth:

- can be calculated from `signal_monitor_symbol_states`
- historical breadth can be replayed from `signal_monitor_events`

V1 should not delete `signal_monitor_breadth_snapshots`. Instead:

1. Add a parity check that compares snapshot breadth to event-derived breadth for hour/day/week/month.
2. If parity and latency pass, change the API to use event-derived breadth by default.
3. Keep snapshots as fallback for one release window.
4. Stop the snapshot writer only after rollback is proven.
5. Drop/prune the table later if it stays unused.

## What This Solves

- Makes states understandable: they are current matrix cells.
- Gives every current row a pointer back to the master receipt.
- Lets breadth become code-derived instead of another table the app depends on.
- Avoids hot UI/algo reads replaying 40k+ events on every screen load.
- Keeps history and current state separate enough to debug safely.

## What This Does Not Solve By Itself

- It does not shrink the largest DB tables. Breadth snapshots are only about 4 MB.
- It does not remove the need for events. Events are still the repair trail.
- It does not make event replay free. Replay needs indexes and parity checks.
- It does not allow flat pruning of old events until latest-event anchors and historical breadth behavior are decided.

## Required Proof Before Migration

Before changing reads or removing writes, build a read-only parity suite:

1. Current-cell parity
   - Rebuild a shadow current-cell set from events plus `bar_cache`.
   - Compare to `signal_monitor_symbol_states` by `(profile_id, symbol, timeframe)`.
   - Check signal identity, close, filter state, latest bar, status, freshness, trend, and excursions.

2. Breadth parity
   - Compare `signal_monitor_breadth_snapshots` output to event-derived breadth for hour/day/week/month.
   - Include enabled/disabled profile behavior.
   - Include seed events before the requested window.

3. API parity
   - Compare `/signal-monitor/state`.
   - Compare `/signal-monitor/matrix/stream` bootstrap shape.
   - Compare `/signal-monitor/breadth-history`.
   - Compare `/signal-monitor/events`.

4. Performance
   - Measure event-derived breadth latency before replacing snapshot reads.
   - Measure rebuild cost for shadow current cells.

## Implementation Phases

### Phase 0: Document and measure

- Keep current runtime behavior.
- Add this plan and any follow-up ADR.
- Capture exact row counts, table sizes, and read latencies.

### Phase 1: Add traceability to states

- Add additive nullable columns to `signal_monitor_symbol_states`.
- Populate them on new writes.
- Backfill from latest trusted events.
- Add tests for event-to-current-cell traceability.

### Phase 2: Build rebuild/parity tooling

- Build a read-only current-cell rebuild path into a temp/shadow result.
- Build breadth parity checks.
- Report mismatch categories, not just counts.

### Phase 3: Move breadth to derived read model

- Keep snapshot table.
- Make event-derived breadth the candidate path behind a flag.
- Compare output and latency.
- Switch default only after parity passes.

### Phase 4: Retire snapshot dependency

- Stop snapshot writer.
- Keep table as rollback cache for one release window.
- Drop or prune later.

## Decision

Proceed with this direction:

```text
events = canonical signal history
current cells = rich current monitor projection
breadth = derived read model, with snapshots as temporary cache/fallback
```

Do not proceed with:

```text
one table that mixes events, current cells, and breadth snapshots
```

That would blur history, current state, and chart cache into one schema and make retention/debugging harder.
