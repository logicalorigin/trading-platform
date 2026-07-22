# Pressure and Errant-Function Remediation Plan

**Date:** 2026-07-15
**Status:** Approved for dependency-gated implementation on 2026-07-15; read-only investigation complete
**Scope:** API CPU/ELU, PostgreSQL demand, stream fanout, diagnostics overhead, cache churn, and retained memory
**Approval gate:** Owner approval received; later phases remain gated by the checkpoints and stop conditions below

## Outcome

The broad audit found one confirmed root-pressure loop and several secondary repeat-work paths.

The highest-leverage fix is the signal-options shadow maintenance path. A five-second worker wake runs a 30-day closed-position reconciliation before checking whether deployment work is due. With the current already-healed data set, each pass performs about 382 queries and decodes more than 6 MB of rows while producing zero changes.

That loop explains a large part of the remaining PostgreSQL protocol writes, row parsing, allocation, GC, and event-loop activity:

```text
5-second maintenance wake
  -> 123-row closed-position sweep
  -> per-row order + event + exit lookups
  -> PostgreSQL protocol writes and row decoding
  -> short-lived objects and JSON payloads
  -> GC and event-loop pressure
  -> slower foreground requests and stream delivery
```

The second strongest issue is a normal UI-startup sequence that opens a five-timeframe Signal Matrix stream, finishes a full-universe bootstrap, then reconnects for six timeframes. The database snapshot is shared, but full-state shaping, signatures, frame serialization, and socket work repeat.

No code or runtime state was changed during this investigation. The API remained healthy. The current high native RSS is not a valid steady-state baseline because an earlier high-cardinality `v8.queryObjects(Date)` diagnostic materialized roughly four million references and raised RSS by about 1.7 GB. Do not use heap-wide object census calls again on the live process.

## Current evidence baseline

| Area | Observed evidence | Interpretation |
|---|---:|---|
| API CPU, 60-second profile | 48.1% busy; GC 30.6% of busy CPU | Material repeat work remains, but the loop is not continuously saturated |
| PostgreSQL row decode | `_parseRowAsArray` 6.5% of busy CPU | Repeated query/result materialization is still a leading cost |
| Socket writes | `Socket._writev` 9.0% of wall time inclusive; 96% of that path came from `pg` query submission | Most profiled write activity was database protocol work, not SSE |
| Shadow maintenance data | 2 open option positions; 123 closed option positions in the 30-day repair window; zero missing exits | The frequent historical repair sweep is currently pure repeat work |
| Shadow maintenance cadence | 598 observed runs; last due and closed counts both zero | The worker runs maintenance independently of useful deployment work |
| Passive DB deltas, 6.03 seconds | `shadow_orders idx_scan +741`; `execution_events idx_scan +382`; `shadow_positions seq_scan +5` | Matches the five-second historical N+1 query shape |
| Background DB admission | About 67.6 admissions/second since startup | Inferred to be dominated by maintenance, pending post-fix attribution |
| Signal Matrix startup | Stored-state shaping 6.53%, bootstrap JSON 5.10%, snapshot signatures 1.71% of profiled busy time | One measured bootstrap consumed about 13.3% of busy time; normal startup intentionally causes two |
| Signal backfill | Stable at 12,866 base cells and 2,808,844 retained bars for three one-minute snapshots | Backfill has plateaued; the current problem is repeat classification and retained width, not active growth |
| Stored-bars cache | 26,280 cells and 2,118,445 compact bars | Large but stable working set |
| Option metadata | About 840,000 `option_contracts`; 786 MB total | A real large data set, not proof of table bloat; no-op update traffic is the concern |
| Container | About 12.7 GB of 16 GB in use; no cgroup OOM | Memory headroom is reduced, but there is no observed OOM condition |

## Facts, inferences, and unknowns

### Observed

- `createSignalOptionsWorker.runOnce()` invokes maintenance before per-deployment due checks in `artifacts/api-server/src/services/signal-options-worker.ts`.
- `runShadowOptionMaintenance()` scans all recent closed option positions and performs per-row lookups in `artifacts/api-server/src/services/shadow-account.ts`.
- All 123 recent closed positions already have valid entry orders, source events, and exit events. Reconciliation candidates are zero.
- The Signal Matrix client deliberately widens from its initial timeframe scope to all six timeframes after bootstrap in `artifacts/pyrus/src/features/platform/PlatformApp.jsx`.
- Signal Matrix signatures and JSON serialization remain per subscriber even when the stored-state read is shared.
- The 60-second server-owned producer enters full backfill readiness classification before determining that no cells are cadence-due.
- Diagnostics collection performs expensive DB reads, a stale-ingest archive update, and durable snapshot writes on recurring collection paths.
- Shadow account, cockpit, and marketing streams are still poll-driven and can recompute unchanged payloads.
- Some marketing payload builders stamp `updatedAt` with recomputation time, making unchanged content appear changed.
- Cache occupancy alone marks fixed-cap LRUs as `watch`; this affects the display headline but is capped out of `resourceLevel` and `hardResourceLevel` gating.
- The backfilled-base map is bounded at 16,384 cells. It is large, but it is not unbounded.

### Inferred

- The closed-option maintenance loop accounts for most of the stable background query admission rate because the source cadence and table/index deltas align. A post-fix matched sample must confirm the share.
- Removing the startup stream re-key should remove one full shaping/signature/serialization cycle per app mount without changing signal data.
- Synthetic timestamps are causing idle marketing payload emissions because they change the signature even when ledger rows are unchanged.
- A compact numeric retained-bar representation can save roughly 230 MB for the current base set, based on an isolated microbenchmark. That estimate is not a live heap measurement.

### Unknown or not yet proven

- Exact runtime Signal Matrix subscriber and browser-tab count during the profile.
- The query plan causing the observed GEX projection and zero-gamma latency. It needs a controlled `EXPLAIN (ANALYZE, BUFFERS)` before an index or cache change.
- Whether historical 401 retry cycles are caused by a stale client auth state after session expiry. Source supports the mechanism, but the loop is not active now.
- Current retained sizes for several TTL maps that lack caps. They are growth risks, not established heap dominators.
- The safe long-term retention interval for durable diagnostics snapshots. Historical consumers must be checked before reducing persistence frequency.

## Priority order

| Priority | Issue | Confidence | Primary pressure removed |
|---|---|---:|---|
| P0 | Five-second closed-option historical reconciliation | High | DB queries, row decode, allocation, GC, ELU |
| P0 | Signal Matrix startup reconnect and second bootstrap | High | Full-state shaping, signatures, JSON, socket work |
| P1 | Diagnostics collector and mutating diagnostic getter | High | DB time, writes, payload allocation, observer effect |
| P1 | One-minute full-universe backfill classification before due check | High | DB readiness reads, 12k candidate allocations, LRU churn |
| P1 | Per-subscriber account/cockpit/marketing polling and serialization | High | DB fanout, JSON/signature churn, idle emissions |
| P1 | Repeated minute-ring reconstruction for currentness | High | CPU and array churn during full-state shaping |
| P1 | Option metadata conflict updates when values are unchanged | High | WAL, index churn, table updates |
| P1 | Five-minute sparkline historical cache rewarm | Medium-high | Synchronized history DB reads |
| P1 | Signal Matrix per-subscriber signature and data serialization | High | CPU and allocation proportional to subscribers |
| P2 | Automatic request map with debounce disabled | High source confidence, unknown live size | Retained keys |
| P2 | Diagnostics SSE unbounded stalled-client promise queue | High source confidence, not observed live | Retained payloads and promises |
| P2 | Synthetic timestamps, broad risk hashing, repeated date parsing/sorting | High | Smaller steady CPU and idle emissions |
| P2 | Retained bar width and stale-key cache retention | Medium-high | Old-space size and major-GC cost |
| Investigate | GEX query latency, historical 401 loop, exact subscriber multiplier | Open | Unknown until measured |

## Goals and non-goals

### Goals

- Remove repeat work at its creator instead of raising pool, heap, or pressure thresholds.
- Preserve expiration, force-stop, daily-loss, deduplication, historical/backfill, and ledger semantics.
- Preserve full Signal Matrix coverage while avoiding a second connection/bootstrap.
- Make diagnostics safe enough to measure the fixes without becoming a pressure source.
- Reduce retained memory only after byte-level signal and metadata parity is protected.

### Non-goals

- Do not pause or degrade trading work under pressure.
- Do not increase the PostgreSQL pool size as a primary fix.
- Do not delete option metadata or indexes based only on table size.
- Do not shorten the deliberate 120-hour minute-bar retention without a separate product and signal-readiness decision.
- Do not run heap snapshots, `v8.queryObjects`, or other heap-wide census operations on the live API.
- Do not change Replit startup configuration or launch a replacement dev supervisor.

## Phase 1: Remove the confirmed P0 database loop

### Task 1.1: Separate fast option safety checks from slow historical reconciliation

**Files:**

- `artifacts/api-server/src/services/signal-options-worker.ts`
- `artifacts/api-server/src/services/background-worker-pressure.test.ts`
- `artifacts/api-server/src/services/shadow-account.ts`

**Change:**

- Keep open-position expiration and force-stop safety checks on the existing five-second worker cadence.
- Move closed-without-exit reconciliation behind its own due state.
- Run closed reconciliation once at process startup, on an explicit close-repair notification, and on a 10 to 15 minute safety cadence.
- Ensure cockpit `requestRunSoon` can accelerate open safety work but cannot bypass the closed-reconciliation cooldown.
- Preserve the existing advisory lock and in-flight exclusion.
- Split diagnostics into `openSafety` and `closedReconciliation` counters, including run count, duration, checked rows, candidates, repaired rows, and errors.

**Tests first:**

- Twelve five-second wakes run open safety twelve times and closed reconciliation at most once.
- A cockpit wake during cooldown does not run historical reconciliation.
- Startup runs one catch-up pass.
- A slow first pass cannot overlap a second pass.
- Existing worker deployment due scheduling stays unchanged.

**Acceptance:**

- Expiration and force-stop detection latency stays at the current cadence.
- The closed repair pass no longer runs on ordinary five-second wakes.
- No pressure-based trading gate is introduced.

### Task 1.2: Replace per-row reconciliation lookups with bounded bulk reads

**Files:**

- `artifacts/api-server/src/services/shadow-account.ts`
- `artifacts/api-server/src/services/shadow-account-force-stop-failsafe.test.ts`
- New focused reconciliation DB-behavior test under `artifacts/api-server/src/services/`

**Change:**

- Keep the 30-day repair window and all historical, backfill, orphan, lifecycle, and dedup guards.
- Load recent closed position projections once.
- Load matching buy-option order projections in one bounded query and map them by the existing `shadowPositionKeyForOrder()` semantics.
- Load referenced entry events in one `IN` query.
- Load relevant exit-event projections in one query and resolve lifecycle matches in memory.
- Return only genuine drift candidates to the insert path.
- Insert repairs in a bounded batch where safe, then preserve per-deployment cockpit notifications.
- Prefer the existing JSON projections and position-key helpers over adding a new schema column in this phase.

**Tests first:**

- 123 already-reconciled rows use a fixed query budget, target at most four read queries, and emit no writes.
- One missing exit is healed exactly once on startup and on the slow fallback.
- A prior lifecycle's exit does not suppress a later lifecycle repair.
- Historical and backfill rows remain excluded.
- Repaired same-day P&L remains counted once; prior-day behavior remains unchanged.
- Orphan and missing-source behavior stays unchanged.

**Acceptance:**

- Passive five-minute table-stat deltas for maintenance-related `shadow_orders` and `execution_events` probes fall at least 90% from baseline.
- Background DB admissions materially fall below 67.6/second. Record the remaining named sources instead of choosing an arbitrary zero target.
- In a matched CPU profile, PostgreSQL row decode and `pg` query-submit/write paths both fall materially.

### Task 1.3: Close the creator-path gap that made repair necessary

**Files:**

- `artifacts/api-server/src/services/shadow-account.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`
- No more than three focused close/ledger tests

**Change:**

- Inventory every live option-position transition from open to closed and identify which path, if any, can commit the position close without its matching ledger exit.
- If a current gap exists, move position close and exit-ledger creation behind one shared transactional boundary or a durable outbox-style follow-up with an explicit failed-sync notification.
- Preserve the existing rule that realized P&L is banked exactly once.
- If no current creator gap remains and the reconciliation data is only historical residue, document that fact and keep the startup/slow sweep strictly as legacy drift protection.

**Tests first:**

- Each live expiration, force-stop, ordinary exit, and failure/retry path ends with one closed position and one matching exit.
- A simulated ledger-write failure cannot silently leave an unobservable closed-without-exit row.
- Backfill and replay paths retain their current separate semantics.

**Acceptance:**

- The repair job is exceptional recovery, not a required part of normal close processing.
- New close activity does not increase the missing-reconciliation candidate count.

### Phase 1 checkpoint

- Targeted maintenance and worker tests pass.
- API typecheck passes.
- One sanctioned in-place reload uses `SIGUSR2` on the live pid2-owned supervisor.
- `/api/healthz` returns 200 and the same supervisor PID remains alive.
- Five-minute passive DB deltas and a matched CPU profile confirm the reduction before Phase 2.

## Phase 2: Remove the second Signal Matrix bootstrap and duplicate fanout work

### Task 2.1: Use one final-scope stream while preserving priority bootstrap delivery

**Files:**

- `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
- Existing or new focused PlatformApp stream-scope test
- `artifacts/api-server/src/routes/signal-monitor.ts`
- `artifacts/api-server/src/routes/signal-monitor-sse.test.ts`

**Change:**

- Open one six-timeframe stream on normal mount.
- Preserve the intent of the current staged startup by ordering bootstrap states/frames so active STA timeframes are delivered before lower-priority daily coverage.
- Remove the 1.5-second full-timeframe re-key and its second EventSource.
- Keep existing REST state polling as fallback, not as the primary daily-data source.

**Product decision encoded in this plan:** retain all six SSE timeframes. Do not silently drop `1d` from SSE. If the owner wants REST-only daily data instead, decide before implementation.

**Tests first:**

- Normal mount creates one EventSource and one bootstrap sequence.
- Priority timeframes appear in the first bootstrap frames.
- Daily coverage still arrives on the same connection.
- Profile/universe changes reconnect once for the new final scope.
- Trade-screen connection-budget gating remains unchanged.

**Acceptance:**

- No second bootstrap appears in stream diagnostics during normal startup.
- Startup CPU no longer contains a second full stored-state shaping and serialization cycle.

### Task 2.2: Remove redundant per-subscriber signatures and serialize shared frames once

**Files:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/routes/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
- `artifacts/api-server/src/routes/signal-monitor-sse.test.ts`

**Change:**

- Remove `lastStateSignatures`; use `lastDisplayStates` plus `signalMonitorMatrixStreamStateSignatureFieldsEqual()` as the single change detector.
- Compute normalized state equality once per evaluated state where scopes permit sharing.
- Add a serialized-event writer that keeps per-connection event IDs and backpressure queues but accepts shared serialized data bytes.
- Use a short-lived, in-flight, byte-bounded bootstrap-frame cache keyed by stored snapshot identity and normalized scope.
- Do not retain a long-lived multi-megabyte string cache in old space.

**Tests first:**

- Equality parity for `Date`, invalid numbers, null/undefined, and filter-state key order.
- Two identical subscribers cause one data serialization per shared frame.
- Event IDs remain connection-local and monotonic.
- The 256-chunk cap, drain timeout, cleanup, ordering, and retry behavior remain intact.

**Acceptance:**

- `signalMonitorMatrixStreamStateSignature` disappears from the CPU profile.
- `writeEvent`/JSON work scales with unique payloads rather than subscriber count.

### Task 2.3: Compute currentness from one per-symbol minute-ring snapshot

**Files:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-stream.test.ts`
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts`

**Change:**

- Load one widest required minute-ring window per symbol and revision for a synchronous shaping pass.
- Derive all intraday timeframe latest-completed timestamps from that snapshot.
- Apply narrower time bounds in memory.
- Remove the redundant sort in recent aggregate history when chronological ordering is already guaranteed by the writer.

**Tests first:**

- Exact parity for sparse histories, corrections, provisional bars, session boundaries, and all six timeframes.
- Current/stale labels and last-bar-closed semantics remain identical.

**Acceptance:**

- `loadSignalMonitorStreamSourceMinuteBars` and callers fall below 0.5% of busy CPU in a matched full-state profile.

## Phase 3: Stop no-op scheduled work and observer pressure

### Task 3.1: Select due backfill cells before readiness DB classification

**Files:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-backfill-base.test.ts`
- `artifacts/api-server/src/services/signal-monitor-db-demand.test.ts`

**Change:**

- Use a non-touching base-map read to identify cold or cadence-due cells first.
- Return before readiness DB work when no cell can be due.
- Query readiness only for exact due cells, grouped by timeframe and canonical profile ID.
- Remove unnecessary multi-profile aggregation for the unique canonical environment.
- Track a scope fingerprint, invalidation revision, and earliest-due timestamp only if the simple due-first scan is still material.
- Coalesce the local warmup and server-owned producer triggers through the existing global in-flight path; add a true next-due timer only if tests show both schedulers still duplicate work.

**Tests first:**

- Cold startup loads readiness immediately.
- At plus 60 seconds after a successful warm refresh, readiness is not queried.
- At plus five minutes, short timeframes become due.
- A newly invalidated/cold cell bypasses the fast path immediately.
- Readiness priority, fairness, quiet-producer, memory, and pressure semantics remain unchanged.

**Acceptance:**

- A warm no-due producer wake performs zero readiness queries and zero 12,000-candidate allocation pass.
- No readiness query exceeds two seconds after warmup in the matched workload.

### Task 3.2: Split diagnostics into cheap frequent metrics and expensive slow probes

**Files:**

- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/services/market-data-ingest.ts`
- `artifacts/api-server/src/services/market-data-ingest-lifecycle.test.ts`
- One focused diagnostics cadence test

**Change:**

- Keep cheap process, memory, ELU, pool, and queue counters at 15 seconds.
- Cache expensive ingest, account, storage, and historical-event probes for 60 to 300 seconds with single-flight and stale-on-timeout behavior.
- Replace the recurring 1,000-row automation-event payload read with SQL aggregate counts plus a small projected recent-event list.
- Move stale-ingest archival out of the diagnostic getter and into the existing retention/maintenance scheduler.
- Persist durable diagnostic snapshots once per minute or on material severity/state change after confirming historical consumer needs.

**Tests first:**

- Four 15-second ticks produce four fresh process snapshots but at most one expensive-probe cycle and one durable persistence batch.
- Calling the ingest diagnostic getter performs no update.
- A slow DB probe cannot stall process-memory/ELU freshness.
- Warning transitions persist immediately even inside the one-minute interval.

**Acceptance:**

- No 1,000-payload diagnostic allocation/read.
- Collector slow-query time and durable rows/minute fall materially without losing incident transitions.

### Task 3.3: Bound diagnostics SSE backpressure

**Files:**

- `artifacts/api-server/src/routes/diagnostics.ts`
- Existing diagnostics SSE tests or one new focused test

**Change:**

- Reuse the hardened signal-monitor SSE pattern: a small pending-chunk cap, a 15-second drain timeout, cleanup on close/error, and latest-wins coalescing for snapshots.
- Serialize each broadcast snapshot once in the diagnostics broadcaster and reuse the bytes for subscribers.

**Acceptance:**

- A simulated client that never drains cannot retain an unbounded promise or payload queue.
- Subscriber and heartbeat cleanup completes on timeout.

## Phase 4: Remove recurring DB/WAL churn and idle stream rebuilds

### Task 4.1: Skip identical option metadata conflict updates

**Files:**

- `artifacts/api-server/src/services/option-metadata-store.ts`
- `artifacts/api-server/src/services/option-metadata-store-cache.test.ts`
- `artifacts/api-server/src/services/option-metadata-store-exact-expiration.test.ts`

**Change:**

- Add null-safe `IS DISTINCT FROM` predicates to batch contract conflict updates.
- Apply the same changed-value behavior to the per-contract conflict fallback.
- Do not advance `updated_at` for identical contract metadata.
- For latest quote snapshots, update on a newer `as_of`, or on equal `as_of` only when payload fields differ.
- When `RETURNING` omits unchanged conflicts, resolve IDs with one batch select or an existing validated identity cache.

**Tests first:**

- Persisting identical contract input twice produces zero contract updates on the second call.
- Equal timestamp with changed quote values updates; equal timestamp with identical values does not.
- Newer quote timestamps preserve freshness semantics.
- Alias conflict reconciliation and exact-expiration behavior remain unchanged.

**Acceptance:**

- `n_tup_upd` and WAL waits fall under identical-chain refreshes.
- No claim of table bloat or index removal is made without a representative usage window and explicit consumer audit.

### Task 4.2: Replace sparkline TTL-wide rewarm with exact invalidation

**Files:**

- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/services/market-data-store.ts`
- Focused sparkline/cache test

**Change:**

- Retain deep `massive-history` seed data until `onBarCacheRowsChanged` invalidates the affected symbol/timeframe cell.
- Apply the same invalidation to negative-cache entries.
- Keep a staggered stale-while-revalidate fallback only for missed invalidation or version changes.
- Coalesce by individual cell instead of exact full-request symbol list.

**Acceptance:**

- Warm page mounts perform zero deep-history seed reads.
- One history write invalidates only its cell and reloads it once.
- Live-memory merge and sparkline bytes remain unchanged.

### Task 4.3a: Share shadow-account stream work by account and revision

**Files:**

- `artifacts/api-server/src/services/shadow-account-streams.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/shadow-account-streams.test.ts`

**Change:**

- Keep full payload fidelity.
- Use one account-scoped shared poller/snapshot revision rather than one polling loop and signature per subscriber.
- Seed subscriptions with the initial payload/revision so startup does not emit it twice.
- Recompute on existing account change notifications; use poll timers only as safety heartbeats.
- Emit freshness at change time or heartbeat cadence, not every two seconds.

**Tests first:**

- Two idle subscribers cause one bootstrap computation, no duplicate startup payload, and no repeated DB reads.
- A change notification refreshes only affected components.
- Full payload parity remains exact.

**Acceptance:**

- Shadow-account stream slow-query counts fall at least 80% in an idle matched window.
- `stableStringify` and unchanged freshness serialization disappear from the matched CPU profile.

### Task 4.3b: Make cockpit and marketing payloads component-invalidated

**Files:**

- `artifacts/api-server/src/services/algo-cockpit-streams.ts`
- `artifacts/api-server/src/services/marketing-shadow-dashboard.ts`
- `artifacts/api-server/src/services/algo-cockpit-streams.test.ts`
- `artifacts/api-server/src/services/marketing-shadow-dashboard.test.ts`

**Change:**

- Keep full payload fidelity.
- Cache payload components at their natural freshness and recompute only invalidated components.
- Use existing cockpit/account change notifications as the primary refresh path; keep timers as safety heartbeats.
- Derive marketing `updatedAt` from real ledger timestamps, never recomputation time.
- Share deployment event/performance reads between cockpit and marketing where their inputs match.

**Tests first:**

- Idle subscribers do not repeat component DB reads after bootstrap.
- A change notification refreshes only the affected component set.
- Repeated unchanged marketing builds keep the same signature and emit nothing.
- Full payload parity remains exact.

**Acceptance:**

- Cockpit and marketing stream-associated slow-query counts fall at least 80% in an idle matched window.

## Phase 5: Smaller hot functions and bounded retained state

### Task 5.1: Remove accidental broad hashing and repeated sorting/parsing

**Files:**

- `artifacts/api-server/src/services/shadow-account.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`
- Relevant focused tests

**Change:**

- Replace full-payload fast-risk hashing with a stable content revision, or hash only fields consumed by risk.
- Decorate candidate activity timestamps once before sorting instead of parsing in the comparator.
- Reverse-scan an already sorted bar list for the latest positive close.
- Reduce latest-market-day P&L in one pass instead of spreading, timezone-formatting, and sorting all points.
- Memoize pure shadow analytics by validated ledger identity.
- Remove the final whole-candidate branding normalization only after proving all inputs are normalized at their creator boundaries.

**Acceptance:**

- Identical output and ordering fixtures.
- Risk keys change for every consumed field and remain stable for irrelevant metadata.
- Branding compatibility fixtures remain green.

### Task 5.2: Remove or bound stale-key maps

**Files:** no more than five per implementation slice; split by subsystem.

**Slices:**

1. Remove the automatic-request timestamp map while debounce is zero, or cap it with a small TTL/LRU if metrics require it.
2. Add a single-flight guard to the breadth worker.
3. Prune removed-deployment state from position-tick and recent-skip maps.
4. Prune aggregate histories to the active subscriber-symbol union after a grace period.
5. Add byte ceilings, not only entry ceilings, to bar-array and flight-recorder retention.

**Acceptance:**

- Churning 10,000 unique request, deployment, and symbol keys settles near the configured cap or current active set after TTL and grace.
- Existing active entries are not evicted prematurely.
- Cache size and eviction counters are cheap and visible in diagnostics.

### Task 5.3: Correct cosmetic cache-pressure reporting

**Files:**

- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/services/resource-pressure.ts`
- Corresponding tests

**Change:**

- Stop treating ordinary 90% occupancy of fixed-cap LRUs as pressure by itself.
- Use eviction rate, miss rate, churn, bytes, and in-flight load where available.
- Keep cache pressure out of consequential `resourceLevel` and `hardResourceLevel` gates.

**Acceptance:**

- A healthy full LRU reports capacity usage without a warning headline.
- A high-eviction or high-miss cache can still report a cache-specific watch driver.

## Phase 6: Retained-bar compaction after correctness gates

### Task 6.1: Define and prove the minimal retained base shape

**Files:**

- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts`
- Existing bar metadata, completed-bars, backfill, and stream parity tests

**Required retained fields:**

- Timestamp as epoch milliseconds
- OHLCV
- Exact source
- Partial flag
- Canonical delayed flag
- `dataUpdatedAt` milliseconds or explicit absence

`freshness` and `marketDataMode` may be dropped from retained storage only after delayed semantics are canonicalized. Do not remove source-integrity information.

**Change:**

- First add fixtures that pin final-bar closed semantics, partial gating, delayed metadata, source integrity, same-timestamp live-versus-delayed precedence, daily closes, gap replay, and stream promotion.
- Then replace Date-heavy retained base objects with the narrow numeric representation.
- Materialize decorated API/evaluator objects only at consumer boundaries.
- Avoid a packed-array rewrite in the first pass; it risks widespread materialization churn for limited additional gain.

**Acceptance:**

- Signal identity and published state bytes remain equal across parity fixtures.
- Retained Date count is inferred from representation/counters, not measured with a live heap-wide census.
- Old-space and matched major-GC time fall after a normal cold-to-warm cycle.
- The isolated estimate is about 230 MB savings for the current 2.8 million-bar base, but live acceptance uses measured old-space and GC deltas.

## Investigations that must precede any fix choice

### GEX projection and zero-gamma reads

- Capture the exact source-confirmed query and inputs.
- Run `EXPLAIN (ANALYZE, BUFFERS)` in a controlled read-only window.
- Decide between query shape, index, materialized projection, or cache only from the plan.

### Historical 401 retry cycle

- Reproduce session expiry/revocation in a controlled browser test.
- Confirm whether cached `signedIn` state survives a 401 and leaves polls/EventSources mounted.
- If confirmed, invalidate/refetch the session on 401 and unmount member streams on signed-out state.

### Subscriber multiplier

- Add cheap counters for real Signal Matrix subscribers by normalized scope and app source.
- Do not log payloads or retain per-subscriber histories.
- Use the counts to validate serialize-once savings.

## Verification protocol

### Static and focused tests

Run only the suites touched by each phase first, then the API typecheck:

```bash
cd /home/runner/workspace/artifacts/api-server
node --import tsx --test src/services/background-worker-pressure.test.ts
node --import tsx --test src/services/shadow-account-force-stop-failsafe.test.ts
node --import tsx --test src/services/signal-monitor-backfill-base.test.ts
node --import tsx --test src/services/signal-monitor-stream.test.ts
node --import tsx --test src/routes/signal-monitor-sse.test.ts
```

```bash
cd /home/runner/workspace
pnpm --filter @workspace/api-server run typecheck
node --test artifacts/pyrus/src/features/platform/PlatformApp.waitPolicy.test.mjs
```

Add and run the focused tests named in each task. Do not rely on source-text assertions where dependency-injected behavior tests are practical.

### Runtime reload

Use Replit's managed workflow restart action. Then poll
`http://127.0.0.1:8080/api/healthz` for 200. Never signal the launcher or
shell-launch a replacement workflow.

### Matched runtime measurements

- Record supervisor/API PIDs, app uptime, active subscribers, deployment count, and market session.
- Five-minute passive DB table/index deltas, with maintenance counters captured at both ends.
- Sixty-second CPU profile using `scripts/diag/cpu-profile-running-api.mjs`.
- Cheap process report/diagnostic counters for heap spaces, resident bar counts, queue depths, and DB admissions.
- Stream open/close/bootstrap/serialization counts.
- Option metadata insert/update/WAL deltas during the same input pattern.
- No heap-wide object census or heap snapshot on the live API.

## Rollout order and stop conditions

1. Land Phase 1 alone and reload once.
2. Stop if any expiration, force-stop, daily-loss, dedup, or ledger test changes. Fix correctness before measuring pressure.
3. Require the Phase 1 DB delta before starting stream work. If maintenance probes do not fall, update the causal model instead of forcing the original theory.
4. Land Phase 2 separately and validate one EventSource/bootstrap in a normal browser session.
5. Land Phase 3 diagnostics/backfill work in separate commits so observer changes cannot hide application regressions.
6. Land option metadata and stream-component changes independently with WAL/query counters.
7. Start retained-bar compaction only after all parity fixtures exist.

Rollback is a normal code revert plus one managed workflow restart. Do not add permanent pressure gates or pool-size changes as rollback mechanisms.

## Definition of done

- Closed historical reconciliation no longer runs every five seconds.
- The zero-drift 123-row data set is checked with a fixed query budget and no per-row lookups.
- Normal app startup opens one final-scope Signal Matrix stream and performs one bootstrap.
- Warm no-due producer wakes perform no readiness query.
- Idle account/cockpit/marketing subscribers do not repeatedly rebuild or emit unchanged payloads.
- Diagnostics getters are read-only, expensive probes run on slower cadences, and stalled diagnostic clients are bounded.
- Identical option metadata does not rewrite rows.
- Matched profiles show material reductions in PostgreSQL row decode, DB query submission, JSON/signature work, GC, and total busy CPU.
- Health remains 200, the pid2-owned supervisor remains attached, and no trading or signal-parity regression is observed.

## Approval checkpoint

Approve Phase 1 to begin implementation. Phase 2 will preserve all six Signal Matrix timeframes on one connection with priority-ordered bootstrap delivery unless the owner explicitly selects REST-only daily coverage before that phase starts.
