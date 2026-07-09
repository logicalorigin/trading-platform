# Implementation Plan: Errant Resource-Pressure Remediation

**Date:** 2026-06-23 · **Branch:** main · **Owner:** riley
**Status:** WORKSTREAM A COMPLETE + verified live (2026-06-23). B/C pending.

**Progress:**
- ✅ **A1** dbPool/heap off `immediateHigh` → 2-sample hysteresis (RSS stays instant). `resource-pressure.ts`.
- ✅ **A2** heap pressure gated on container-relative % (not V8 ceiling). `diagnostics.ts` + `getContainerMemoryLimitMb` export.
- ✅ **A3** event-loop thresholds 60/250 → **150/400 ms**. `resource-pressure.ts`.
- ✅ **A4** api-latency dropped from options-flow scanner gate; hydration suppression `watch`→`high`. `platform.ts` (+ new latency-exclusion test).
- ✅ **A5** client-metrics POST no longer re-runs pressure on stale inputs. `diagnostics.ts`.
- **Verified:** pressure suites 29/29, api-server typecheck clean, bundle rebuilt + app restarted.
  Live proof: a `dbPool 12/12 w2` snapshot now reads `resourceLevel: watch` (was an instant `high`
  hard-block) with `skipDeploymentScans: false`; eventLoop 55ms → normal; heap 2.6% container-relative.
- Ops: `.replit` ports fix applied then reverted by Replit control-plane (port reconciliation —
  left as Replit set it); run-rule docs (CLAUDE.md/AGENTS.md/replit.md) updated to authorize
  agent-driven restart and document the `REPLIT_MODE=workflow` procedure (incl. the pid2
  no-auto-restart-on-clean-SIGTERM gotcha). **(Historical: that `REPLIT_MODE=workflow` shell-restart
  procedure was RETIRED 2026-07-09 — sanctioned reload is now SIGUSR2 to the pid2-owned supervisor;
  see AGENTS.md / CLAUDE.md.)**

**B in progress:**
- ✅ **DB test harness** (PGlite) — `lib/db` forwarding-Proxy seam + `@workspace/db/testing` (`createTestDb`/
  `withTestDb`), full schema into PGlite, prod-safe (inert unless `__setDbForTests`). Enables real
  behavior-equality tests. Verified: harness sample + gex real-SQL-through-Proxy + regression all green.
- ✅ **B1/B5 foundation** — `loadStoredMarketBarsForSymbols` (faithful batched mirror of
  `loadStoredMarketBars`; window computed once, set-based) + DB-backed behavior-equality test
  (`market-data-store-batch-equality.test.ts`, 3/3) proving batched == N× per-symbol (noise, empty,
  limit-truncation). Typecheck clean.
- ✅ **B1 wiring — DONE at both boundaries.** `runWithSignalMonitorStoredBarsPrefetch` (AsyncLocalStorage
  prefetch consulted by `readStoredBars`, per-symbol fallback on any miss/mismatch). Wired at the
  **matrix-eval** batch loop (signal-monitor.ts ~10146, limit 240) AND the **monitor-refresh** batch loop
  (`evaluateSymbolsInBatches` ~8901, limit `PYRUS_SIGNALS_SIGNAL_WARMUP_BARS` — the dominant 108-offender).
  Converts up-to-N-per-symbol pooled reads into (timeframes × sources) set-based queries per batch.
  DB-backed behavior-equality verified (`signal-monitor-local-bar-cache-prefetch.test.ts`: identical
  with/without prefetch, mismatched-limit fallback); 83/83 signal-monitor regression green, typecheck clean.
- ⏭️ **B5 getBars seam (smaller, remaining)** — the deeper historical-fallback read in
  `loadSignalMonitorCompletedBars` (~5639) is a separate seam, reached only on stream+cache+local-cache
  miss (matrix eval was only ~17 slow queries). Lower priority than B1's readStoredBars batching.
- ⏭️ **Runtime soak** — deploy + watch flight-recorder `market-data-store` slow-query count + pool
  acquire-wait p95 drop to confirm the live pool-relief.

Remaining: **B1/B5 wiring**, **B2-B4**, **B6** (event-loop), then **C** (lease-shed). Scoped below.

**Decisions captured (2026-06-23):**
- Start: refine the plan further before any implementation.
- A3: **both** — raise thresholds to genuine-stress levels AND fix the baseline (B-efficiency).
- Lease-shed feedback trap: **investigate first** (Workstream C, scoping agent running).

## Overview

The API "resource pressure" system fires errantly under normal, healthy load and
hard-blocks trading work (signal-options + overnight-spot workers, 30s each) when nothing
is actually wrong. Three independent investigations (parallel diagnosis workflow + 5-Whys
agent + origin archaeology) converged on a single root and a clear remediation split.

**The cure is NOT to reduce background demand.** The box is 16 GB and more than capable.
The cure is:
1. **Stop the pressure system from labeling healthy load as "too much"** — recalibrate the
   `high` level (across *all* drivers, not just dbPool) and make the corrected level bite
   **app-wide**.
2. **Handle the background data correctly/efficiently** so it stops *freezing* the DB pool —
   fix the access patterns (batching, connection-hold), not the amount of work.

## Confirmed Root Cause (evidence-backed)

One Node process fans **per-symbol work across ~500 symbols** onto **one event loop + one
hard-capped 12-connection DB pool**, with **no efficient/batched access pattern** at the
source. dbPool saturation, event-loop delay (169ms), and request latency (2.6s) are **three
faces of the same contention** — not three problems.

Key facts:
- Live snapshot: `resourceLevel="high"` with **RSS only ~2 GB** (high threshold 8192 MB), no
  OOM, every other driver at watch — the trip came purely from the pool.
- **335/450** daily pool-pressure events hit the high trigger; pool acquire-wait p95 **14.6 s**.
- dbPool `high` (`waiting>=2 && active>=max`) routes through `immediateHigh` →
  `resourceLevel="high"` **instantly, bypassing the 2-sample hysteresis** that event-loop
  correctly uses. The in-code comment (resource-pressure.ts:243-249) *claims* hysteresis
  applies — the code defeats it. Self-documented bug.
- **dbPool driver is the newest** (`03d909c`, 06-17). Before it, pressure tripped on
  rss→heap→event-loop. **Fixing only the pool moves the false alarm to the event-loop driver.**
- Foreground eval is **unbounded**: on-demand HTTP eval issues up to **8 symbols × 6 TF = 48
  concurrent DB queries** (signal-monitor.ts ~9349/~10148); only *background* reads are gated
  (`SIGNAL_MONITOR_BACKGROUND_DB_CONCURRENCY=6`). This is an inefficient access pattern, not
  necessary demand.
- heap% is measured against the **V8 heap ceiling (~2.7 GB)**, not the 16 GB container, so it
  reads "70-80%" at ~2 GB while 14 GB is free — a phantom "too much" signal. It also feeds
  `immediateHigh`.

## Architecture Decisions

- **A is calibration (de-flap the alarm); B is efficiency (stop the real freeze).** Both are
  required — A alone leaves the loop tripping; B alone leaves the single-sample dbPool/heap
  bypass mis-firing during transient blips.
- **No throttling / no demand-shaping caps.** We will not restore the deleted `19262f2` caps
  as throttles. B reduces *connections held and round-trips*, not work done.
- **RSS stays the one instant hard-block.** It is the only container-accurate memory signal
  (6144/8192 for 16 GB) and is far from tripping. Everything else gets hysteresis.
- **Keep the intentionally-permissive no-op caps as-is.** `getApiResourcePressureCaps` and the
  matrix/scanner caps are permissive by design; do not "activate" them.
- **Latency stays out of `resourceLevel`.** Correct existing decision; do not regress it.
- **B is ranked by runtime evidence, not by the architectural story.** query-slow by service:
  signal-options-automation **161**, market-data-store **108**, signal-monitor matrix eval only
  **17**. So B leads with the two dominant pool-freezers (connection-hold + N+1), and the
  signal-monitor matrix 48-query fan-out (the 5-Whys "unbounded foreground" finding) is real but
  secondary for the pool — it spikes mainly on cold/full-universe re-eval, so it's sequenced after.
- **A3 is "both."** Raise event-loop (and re-confirm other) thresholds to genuine-healthy
  baselines AND drop the baseline via B-efficiency, so the recalibrated `high` is honest.

---

## Workstream A — Recalibrate `high`, app-wide

Goal: `resourceLevel="high"` (and `watch`) reflect *genuine sustained* stress, and every
consumer honors the corrected level. Tests-first.

### Task A1: Route dbPool + heap through the 2-sample hysteresis (kill `immediateHigh` bypass)
**Description:** In `resource-pressure.ts:390-395`, `immediateResourceLevel` currently =
`maxLevel(rssLevel, heapLevel, poolLevel)`, so any of the three forces instant `high`. Change
it to `immediateResourceLevel = rssLevel` and fold `heapLevel` + `poolLevel` into
`rawResourceLevel` alongside `eventLoopLevel`, so they require `RESOURCE_HIGH_ENTER_SAMPLE_COUNT`
consecutive samples. Correct the now-accurate comments at 243-249 and 387-389.
**Acceptance criteria:**
- [ ] A single update with `dbPoolWaiting:2, dbPoolActive:12, dbPoolMax:12` yields
  `resourceLevel="watch"` and `isApiResourcePressureHardBlock===false`.
- [ ] Two consecutive such updates yield `resourceLevel="high"` (genuine sustained saturation
  still gates).
- [ ] RSS immediate-high path unchanged (single update `rssMb:9000` still → `high`).
**Verification:**
- [ ] `cd artifacts/api-server && node --import tsx --test src/services/resource-pressure.test.ts`
**Dependencies:** None · **Files:** `resource-pressure.ts`, `resource-pressure.test.ts` · **Scope:** S

### Task A2: Fix heap% denominator (measure container, not V8 ceiling)
**Description:** `diagnostics.ts:~1059-1064` computes `heapUsedPercent = heapUsed /
v8.getHeapStatistics().heap_size_limit`. Either (a) drop heap as a pressure input (RSS already
covers container memory), or (b) compute against the container memory limit. Prefer (a) for
minimality unless A-review wants heap headroom retained.
**Acceptance criteria:**
- [ ] heapUsed ~1.5 GB on a 16 GB box no longer produces watch/high.
- [ ] Flight recorder still surfaces raw `heapUsed`/`heapLimit` for observability.
**Verification:**
- [ ] `node --import tsx --test src/services/resource-pressure.test.ts` (+ diagnostics suite)
**Dependencies:** A1 · **Files:** `diagnostics.ts`, `resource-pressure.ts`, tests · **Scope:** S

### Task A3: Recalibrate the `high`/`watch` thresholds to genuine-stress levels
**Description:** Change the threshold values themselves so normal post-fix operation sits in
`normal`. Primary target: **event-loop** (watch 60 / high 250) — steady-state baseline is
~130-186ms today, so 60ms watch is below normal. Set values from observed-healthy baselines
(propose: watch 150ms / high 400ms — CONFIRM with owner). Re-confirm rss (6144/8192) and the
dbPool rule remain genuine-stress.
**Acceptance criteria:**
- [ ] Steady-state event-loop p95 (post-B3) sits in `normal`; a genuine sustained spike still
  reaches `high`.
- [ ] No regression to the rss immediate-high path.
**Verification:**
- [ ] resource-pressure.test.ts updated for new thresholds; all pass.
- [ ] Replay flight-recorder time-series against new thresholds (sanity).
**Dependencies:** A1; pairs with B4 (event-loop efficiency) · **Files:** `resource-pressure.ts`,
tests · **Scope:** S
**Approach LOCKED = "both":** raise thresholds AND drop the baseline via B4. Provisional values
derived from observed healthy baselines (event-loop watch 150 / high 400ms); final values
validated against the post-B4 baseline before they land. Not a blocking question.

### Task A4: Make the corrected level bite app-wide (audit + align divergent consumers)
**Description:** Audit every consumer of `resourceLevel`/`level`/`isApiResourcePressureHardBlock`.
Fix the two that diverge: (1) `getOptionsFlowScannerPressureGate` (platform.ts ~1216-1223)
includes **api-latency** in its `level` → a slow broker route blocks scanner work even when the
server is idle; drop latency from that gate. (2) `shouldHydrateFlowScannerHistoricalBars`
(platform.ts ~17308-17321) suppresses at **watch** (one rank too eager) → raise to `high`.
**Acceptance criteria:**
- [ ] An api-latency-only "high" (12s broker route, all server drivers normal) does NOT block
  the scanner gate; a dbPool/event-loop "high" still does.
- [ ] Historical-bar hydration continues at `watch`, suppresses at `high`.
- [ ] No consumer reads a looser/stale pressure signal than the corrected level.
**Verification:**
- [ ] `node --import tsx --test src/services/options-flow-scanner-pressure.test.ts` (+ targeted)
- [ ] `pnpm --filter @workspace/api-server run typecheck`
**Dependencies:** A1-A3 · **Files:** `platform.ts`, tests · **Scope:** M

### Task A5: Stop client-metrics POST from re-asserting stale hard blocks
**Description:** `diagnostics.ts:~3725` calls `updateApiResourcePressure({clientLevel})` on every
client-metrics POST; the merge retains prior 15s-tick dbPool/heap values and re-runs the
snapshot. After A1 this can no longer instant-block, but the cleanest fix is to stash
`clientLevel` for the next tick rather than re-evaluating on stale inputs.
**Acceptance criteria:**
- [ ] A clientLevel-only update does not change `resourceLevel` from stale dbPool/heap inputs.
- [ ] clientLevel still folds into `level` on the next 15s tick.
**Verification:** [ ] resource-pressure/diagnostics tests pass
**Dependencies:** A1 · **Files:** `diagnostics.ts`, tests · **Scope:** S

### Checkpoint A
- [ ] resource-pressure + options-flow-scanner-pressure suites green
- [ ] `pnpm --filter @workspace/api-server run typecheck` EXIT 0
- [ ] Replay confirms healthy load → `normal`/`watch`, sustained stress still → `high`
- [ ] Owner review of threshold numbers (A3)

---

## Workstream B — Handle background data efficiently (stop freezing the pool)

Goal: the same background work holds far fewer connections for far less time, so the 12-conn
pool stops starving — purely via better access patterns. Tests-first / behavior-equality.

> **Scoping correction (agent):** neither `runSignalOptionsShadowScanUnlocked` nor the tick-manager
> `reconcile` holds a pooled connection across compute/broker awaits — drizzle acquires+releases per
> statement (no `pool.connect`/`db.transaction` in signal-options-automation.ts). The freeze is
> **N+1 read fan-out filling all 12 slots concurrently**, **per-group writes**, and **one full-ledger
> scan inside a write transaction**. The tick manager lives in `signal-options-position-tick-manager.ts`,
> not automation.ts. Ranked by pool-relief below.

> **Code-read correction (2026-06-23, during B1):** B1 and B5 are the SAME fan-out, not separate.
> `readStoredBars` (B1) is reached only via `loadSignalMonitorLocalBarCache` (signal-monitor.ts:5719)
> inside `loadSignalMonitorCompletedBars` — the exact per-(symbol×timeframe) resolver B5 targets, sitting
> behind a per-symbol memory-miss check (returns from the in-memory minute cache when it already has
> ≥limit bars; only misses hit `readStoredBars`). So the batching BOUNDARY for both is the matrix-eval
> symbol loop (`evaluateSignalMonitorMatrixSymbol`'s caller), where we prefetch the memory-missers' stored
> bars in one set-based query. **The existing `loadStoredMarketBarsBySymbol` is NOT behavior-equal** to
> per-symbol `loadStoredMarketBars`: different window derivation (`from`/`to` directly vs
> `resolveDurableHistoryWindow`), limit default 120 + 720 cap (vs 500, no cap via `expandStoredRowsLimit`),
> and always `desc` (vs asc-when-`from`). So B1/B5 need a **faithful batched mirror** of
> `loadStoredMarketBars` (window computed ONCE per batch — confirmed symbol-independent for `from=undefined`)
> + a **DB-backed behavior-equality test** (seed `bar_cache`, assert batched == N× per-symbol). Revised:
> implement B1+B5 as one "batched bar-fallback prefetch" on the matrix-eval boundary.

### Task B1: Batch the monitor bar-read N+1 (highest relief — drives market-data-store=108)
**Description:** `readStoredBars` calls `loadStoredMarketBars` once **per source** (2) and is called
**per symbol**; monitor full-refresh runs symbols at concurrency 6 → **up to 12 concurrent
single-symbol `WHERE symbol=$1` reads = the whole pool**. A set-based reader
**already exists** (`loadStoredMarketBarsBySymbol`, `unnest … cross join lateral`) but is only wired
to a route, not the monitor cache. Lift the read to the batch boundary in the monitor evaluator and
issue **2 set-based queries per pass** instead of 2N, distributing rows in memory.
**Acceptance criteria:**
- [ ] One pass over N symbols issues ≤ `2 × ceil(N/batch)` bar reads, not `2N`.
- [ ] Per-symbol bars byte-identical (same normalization + `.slice(-limit)`).
**Verification:**
- [ ] Behavior-equality unit (batched vs per-symbol arrays) + query-count assertion via the
  `lib/db` diagnostics listener (2N→2); snapshot `SignalMonitorState` per symbol identical
- [ ] `pnpm --filter @workspace/api-server run typecheck`
**Correctness risks:** `loadStoredMarketBarsBySymbol` caps rows at `min(720, limit)` (vs uncapped per-
symbol) — **validate the 720 cap doesn't truncate any monitor timeframe**; the batched variant
*throws* where the per-symbol one swallows to `[]` — wrap to preserve self-healing backoff.
**Dependencies:** None · **Files:** `signal-monitor-local-bar-cache.ts:478-499/701`, `market-data-store.ts:400-523` (reuse), tests · **Scope:** M

### Task B2: Batch the persist-flush upserts (market-data-store writes)
**Description:** `flushPendingPersistBars` calls `persistMarketDataBars` once per
`(symbol,timeframe,source)` group → many concurrent single-symbol upserts competing with B1's reads
for the same 12 slots. Collapse same-`(timeframe,source)` groups into one multi-row
`INSERT … ON CONFLICT DO UPDATE` (conflict target is symbol-independent; insert already takes a
`values[]`), chunked at `STORE_BATCH_SIZE`.
**Acceptance criteria:**
- [ ] One flush of M same-tf/source symbols issues `ceil(rows/500)` upserts, not M.
- [ ] `bar_cache` rows byte-identical.
**Verification:** [ ] seed 4 symbols same tf/source; final rows match per-group path; write count 4→1; typecheck
**Correctness risks:** conflict `set` must use `symbol = excluded.symbol` (not a constant) or
cross-symbol rows get the wrong symbol — **load-bearing**; chunk-level requeue must replace per-group requeue.
**Dependencies:** independent of B1 (compounds with it) · **Files:** `market-data-store.ts:525-595`,
`signal-monitor-local-bar-cache.ts:515-588`, tests · **Scope:** M

### Task B3: Set-based shadow-account recompute (longest single connection-hold)
**Description:** Every shadow entry/exit runs `placeShadowOrder`'s `db.transaction`, whose last step
`recomputeShadowAccountFromLedger` does an **unbounded `SELECT * FROM shadow_fills` + JS fold inside
the held transaction** — hold time grows with ledger size. Replace the scan+fold with a single
set-based aggregate `UPDATE … FROM (SELECT SUM(...) …)` **kept in the same transaction** (atomicity
preserved), so totals compute in Postgres in O(1) statements.
**Acceptance criteria:**
- [ ] Recompute issues O(1) statements, no full-table transfer into Node.
- [ ] `cash/realizedPnl/fees` byte-identical to the JS fold; tx wall-time independent of fill count.
**Verification:** [ ] property test: old JS fold vs new SQL equal to the cent; tx-duration vs fill-count flattens
**Correctness risks:** **do NOT split the transaction**; `isDefaultShadowLedgerAnalyticsOrder` filter
+ `money()` rounding order must translate to SQL exactly — if the analytics filter can't be expressed
in SQL, this fix is lower-value, keep the JS fold scoped by an index-backed predicate.
**Dependencies:** independent · **Files:** `shadow-account.ts:13074-13120` (in-tx at ~:4422, tx opened
:4377), reached from `signal-options-automation.ts:2152`, tests · **Scope:** M-L (SQL-equivalence proof)

### Task B4: Share/de-dup the per-deployment shadow-reconcile fan-out (largest count — automation=161)
**Description:** `runSignalOptionsShadowScanUnlocked` runs `reconcileActivePositionsWithShadowLedger`
**twice per scan**, and each reconcile does ~6 uncached shadow reads; the tick-manager reconcile loops
deployments re-reading the same `accountId='shadow'` (deployment-independent) sets per deployment.
Fix = (1) hoist deployment-independent reads to once per pass (or behind `withShadowReadCache`) and
pass the snapshot down; (2) skip the second reconcile when the pass wrote no mark/exit (already
tracked) — same data, half the reads on quiet passes.
**Acceptance criteria:**
- [ ] Shadow reads scale with distinct query shapes, not `deployments × reconcile-calls`.
- [ ] Quiet pass (no marks/exits) issues one reconcile's reads, not two; `activePositions` identical.
**Verification:** [ ] query-count assertion (shadow open-positions fires once, not per-deployment); snapshot equality
**Correctness risks:** **freshness** — a shared/cached read must not show a position the same pass just
closed; bound cache to within-pass + extend the existing `invalidateActivePositionSnapshot` on exit.
Preserve `orderBy(desc(...))` "latest-wins" map semantics.
**Dependencies:** touches shared shadow-read helpers as B3 (coordinate) · **Files:**
`signal-options-automation.ts:5909-6364/16727-16967`, `signal-options-position-tick-manager.ts:261-351`,
tests · **Scope:** L (correctness-sensitive caching)

### Task B5: Batch the signal-monitor matrix DB-fallback fan-out (architectural unbounded-foreground)
**Description:** Matrix eval batches 8 symbols × `Promise.all` over 6 timeframes = up to **48
concurrent** `loadSignalMonitorCompletedBars` calls (signal-monitor.ts:9349 inner, :10148/:10326
outer). The DB hit is the `getBars`/`getBarsWithDebug` seam (signal-monitor.ts ~5635), reached only
on **stream + cache miss** — so the 48 is worst-case (cold/full-universe re-eval), which is why
matrix eval is only 17 slow queries steady-state. Fix = a **batched bar-fallback prefetch**: for the
stream+cache-miss `(symbol,timeframe,to,limit)` tuples in a batch, issue one set-based `getBars`
query and distribute, preserving the stream/cache/merge/source-policy semantics exactly.
**Acceptance criteria:**
- [ ] Cold-path matrix eval for 8 symbols issues a small bounded number of DB queries (not 48).
- [ ] Result set byte-identical to the per-(symbol,timeframe) resolver (behavior-equality test
  across all branches: live-edge, retry-stale, historical fallback, local-cache).
**Verification:**
- [ ] New behavior-equality test (batched prefetch vs per-symbol)
- [ ] `node --import tsx --test src/services/signal-monitor*.test.ts`; typecheck
**Dependencies:** B1/B2 (shared market-data read seam) · **Files:** `signal-monitor.ts`, market-data
store · **Scope:** **L** (layered resolver; behavior-equality critical)

### Task B6: Finer event-loop yielding for the per-symbol synchronous work (pairs with A3)
**Description:** The loop sits at 169ms because per-symbol `.sort()` over ~300 aggregates/bars
(signal-monitor.ts ~3710/~3222) + O(live×base) integrity filter (~3365-3400) run synchronously,
yielding only every 8 symbols (`SIGNAL_MONITOR_EVAL_YIELD_EVERY=8`). Yield finer (per symbol or
per timeframe) and/or hoist redundant sorts. **Same computation, scheduled so it doesn't block.**
This is the driver the 5-Whys predicts becomes the next trip surface after the pool is fixed — so
it's the B-half of A3's "both."
**Acceptance criteria:**
- [ ] Steady-state event-loop p95 drops below the recalibrated `watch` threshold (A3) under load.
- [ ] Signal output unchanged (behavior-equality).
**Verification:**
- [ ] signal-monitor tests pass; runtime event-loop p95 check
**Dependencies:** A3 (measure against the right threshold) · **Files:** `signal-monitor.ts` · **Scope:** M

### Checkpoint B
- [ ] signal-monitor + signal-options suites green; typecheck EXIT 0
- [ ] Runtime: pool acquire-wait p95 down, pool-pressure high events near-zero under normal load
- [ ] Runtime: event-loop p95 in `normal` band under load

---

## Workstream C — Pressure-driven lease shedding (close the feedback trap) — SCOPED, SAFE

Goal: a GENUINE high-pressure event relieves its own footprint. Today the scanner gate stops new
work but `market-data-admission.ts` never sheds the 160+ retained flow-scanner leases, so the
footprint stays high → pressure stays high. SAFETY-NET response that fires only at the recalibrated
(honest) `high` — not a throttle on normal load.

**Scoping verdict (agent):** SAFE to implement. **The pool boundary IS the safety floor and it's
structurally enforced** — scanner leases live in `pool:"flow-scanner"` (priority 55, lowest);
positions/signals/foreground run under `execution-live | account-monitor-live | automation-live |
visible-live` (other pools). A shed scoped to `pool==="flow-scanner"` + the existing chargeable-line
guard (`activeChargeableLineIdsForStrictPoolScope`) **cannot release an essential lease or a shared
line**. One residual unknown to confirm before merge (R1, below).

### Task C1: Wire API-pressure "high" → flow-scanner lease shed (reuse IBKR-damping machinery)
**Description:** Subscribe via `subscribeApiResourcePressureChanges`; on a **normal/watch→high edge**
(deduped with `lastSheddedResourceLevel` — the listener fires every sample, not just transitions),
**lower a damped scanner cap** (`lastApiPressureEvent`, mirroring the IBKR `:555-566` damping) to
`ceil(before * 0.5)` and call the existing `rebalanceFlowScannerLeasesAboveEffectiveCap(...)` — do
NOT write a third shed loop. Fold the API target into `dampedScannerLineCap` (`:1891-1896`) as
`min(ibkrTarget, apiTarget)` so the two damping paths compose, never widen each other. Wire the
subscription in `platform.ts` (imports both modules already; keeps `market-data-admission.ts` free
of a `resource-pressure` import / cycle). resourceLevel is already post-hysteresis, so no extra
smoothing needed.
**Acceptance criteria:**
- [ ] normal/watch→high edge sheds scanner chargeable lines to `ceil(before*0.5)` (floor, not zero).
- [ ] Leases in `execution|account-monitor|automation|visible` pools retained unchanged.
- [ ] Scanner leases sharing a line with a non-scanner lease are protected (chargeable guard).
- [ ] No re-shed while `resourceLevel` stays high (edge dedupe); re-acquire clamped for the damping
  window (~60s), cap restores after expiry.
- [ ] With both IBKR + API damping active, effective cap = `min` of the two.
- [ ] Diagnostics surface the API-pressure shed event (mirror `pressure.ibkrPressure`).
**Verification:**
- [ ] `node --import tsx --test src/services/market-data-admission.test.ts` (new tests, model on :455-499)
- [ ] options-flow-scanner-pressure + resource-pressure suites unregressed; typecheck EXIT 0
**Dependencies:** A1-A3 (fires only at the corrected `high`); **R1 confirmation gating** ·
**Files:** `market-data-admission.ts` (new `shedFlowScannerLeasesForApiResourcePressure`,
`lastApiPressureEvent`, fold `dampedScannerLineCap`, diagnostics, test-reset), `platform.ts`
(subscribe + edge dedupe; optional symbol-retain set), `market-data-admission.test.ts` ·
**Scope:** S-M (~80-150 LOC, most reused from IBKR damping).

**R1 (gating, confirm before merge):** can a freshly-actionable signal's *sole* quote backing be a
scanner lease before it promotes to an `automation-live` lease? Source shows signals normally hold
their own non-scanner lease, but the promotion-gap guarantee wasn't found. **Mitigation:** add a
symbol-retain guard (skip candidates whose symbol ∈ `collectFlowScannerPriorityLeaseSymbols()` ∪
actionable-signal symbols). Cheap insurance; include defensively if R1 stays unconfirmed.

---

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Hysteresis/thresholds mask a genuine stress event | High | Keep RSS immediate-high; require only 2 ticks (~30s) of *sustained* saturation; replay time-series to confirm real events still trip |
| Threshold numbers (A3) wrong → too loose or too tight | Med | Derive from observed healthy baselines; owner confirms; easy to retune |
| B1 batching changes hot signal-monitor read paths | High | Behavior-equality tests (byte-identical result set) before/after; land behind targeted tests |
| B3 loop offload alters signal output | High | Behavior-equality; yield-only change first, sorts-hoist second |
| "It moves to the next symptom" | Med | A3 recalibrates event-loop too; B3 fixes the loop — both faces covered, per 5-Whys prediction |

## Resolved during refinement
- **A3 approach** — locked to "both" (raise thresholds + drop baseline via B4).
- **B1 feasibility (now B3)** — CONFIRMED batchable, but at the `getBars`/`getBarsWithDebug` seam
  inside the layered resolver (reached only on stream+cache miss), via a batched prefetch with
  behavior-equality — L-sized, not a one-query rewrite. Re-ranked below the dominant offenders.
- **B priority** — re-ranked by runtime evidence: signal-options-automation (161) + market-data-store
  (108) lead; matrix fan-out (17) follows.

## Open Questions (for owner)
1. **A3 threshold numbers** — provisional event-loop watch 150 / high 400ms; I'll derive finals from
   the post-B4 baseline and show them before they land. (Approach locked; numbers FYI, not blocking.)
2. **Workstream C** — RESOLVED as safe (pool boundary = structural safety floor); recommend
   **include** after A+B. One gating item: confirm R1 (sole-backing of mid-evaluation actionable
   signals) or add the cheap symbol-retain guard defensively. Owner: include C, or defer until A+B
   prove `high` is rare?
3. **Lib/db comment conflict** — `lib/db/src/index.ts:145-157` says "relief must come from reducing
   concurrent demand, not more connections." Our approach (efficient access, not less work) is
   compatible but the comment frames it as demand-reduction. Update the comment to reflect the
   efficiency framing? (cosmetic; flag.)

## Sequencing
A1 → A2 → A3 → A4 → A5 → **Checkpoint A** → B1 → B2 → B3 → B4 → B5 → B6 → **Checkpoint B** →
(C1 if approved). A1 is the single highest-value fix (kills the instant pool-driven hard block).
A and B are independent enough to interleave; B1 (monitor N+1, an unused set-based reader already
exists) is the highest pool-relief and lowest-risk B item; B6 pairs with A3 to close the event-loop
"next symptom." C only matters once `high` is honest (post A+B).
