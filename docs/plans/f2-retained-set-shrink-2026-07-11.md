# F2 — retained bar-set shrink (design, 2026-07-11)

Follows `signal-monitor-gc-pool-rootcause-2026-07-09.md` §F2. Evidence base: live
heap snapshot of a ~1-min-old closed-market API child (414MB self-size: 384k Dates,
718k plain Objects, 1.03M arrays, 1.26M strings, 2.4M boxed numbers — bar-shaped),
plus the resident-bar census counters landed in `93915cc0`
(`signalMonitorResidentBars`, `storedBarsCache.barCount`).

## Verified structural issues

1. **Cross-layer object multiplication (~2-3x).** `mergeBarsByTimestamp`
   (signal-monitor-local-bar-cache.ts ~450) unconditionally clones every bar
   (`{...bar, timestamp}`) even when `dateOrNull` returned the bar's own `Date`
   instance (it does whenever the input is a valid Date — loader rows carry
   pg-decoded Dates, memory bars carry Dates). Every write/read path funnels
   through this merge, so the stored-bars cells, the local-cache return arrays,
   the completed-bars cache, and the backfilled base each hold their own copy of
   the same immutable bar. Verified: no code assigns to bar fields anywhere in
   signal-monitor*, market-data-store (bars are immutable by convention), so
   object reuse is safe.
   **Fix (landing first): identity fast-path in the merge** — reuse the input
   object when `timestamp === bar.timestamp`. Collapses retained copies toward
   1x AND removes ~5.8M spread-allocations per cold full-universe pass (the
   allocation site class the 07-09 profile flagged at 50.7%).

2. **Per-bar width: ~19 fields, up to 3 Dates, ~6 strings (~250-400B/bar)** where
   evaluation needs OHLCV + timestamp + partial/delayed (~70B). The retained
   whale is metadata (`quoteAsOf`, `dataUpdatedAt`, `ageMs`, `transport`,
   `freshness`, `marketDataMode`, `providerContractId`). Candidate follow-up:
   slim the CACHED representation (cells + minute map) to consumed fields and
   materialize decoration lazily. Needs a consumer-field audit per reader
   (matrix eval, KPI preview, gap-fill, gateway payloads) BEFORE any change —
   signal-identity-adjacent surfaces read `partial`/`delayed`. Not started.

3. **Minute map (`minuteBarsBySymbol`)**: same wide objects, 120h retention
   (deliberate: holiday-weekend KPI preview span — do not shorten), no count cap.
   Benefits from 1/2 automatically; no independent change planned.

4. **Heavy-eval memo + incremental evaluator cells** (both LRU-bounded at the
   same max): watch via census Monday; incremental instances are new growth
   since the 07-11 flag flip. No change until measured warm.

## Measurement protocol (before/after, cold process is sufficient for #1)

- Heap snapshot via SIGUSR1+CDP (scratchpad heap-snapshot-running-api.mjs),
  summarize by constructor: Objects+Dates per `storedBarsCache.barCount` unit
  should drop ~2x after fix #1 on a process with populated cells.
- Steady-state (Monday): flight-recorder heapUsed trend + census counters.
