# Lever 2 — Move universe-wide bar deserialization off the API event loop

Date: 2026-06-25 · Author: claude-elu (session 1bca609a) · Status: SUPERSEDED PLAN + CURRENT DECISION LOG

## Current Decision (2026-06-26)

This document is historical context plus correction log. Do **not** implement
the original Option A or the later Option B recommendation as written.

- **Option A is superseded.** The Rust market-data worker does not own live
  `bar_cache` bars, so it cannot simply publish authoritative bar snapshots.
- **Option B is superseded for the immediate bar-cache path.** A worker-thread
  query/parse pool would move CPU, but it still risks competing for the same
  12-connection DB ceiling and does not remove repeated demand.
- **Option E is the current implemented/interim path.** The Node
  signal-monitor local bar cache uses a bounded cross-cycle stored-bar cache,
  `onBarCacheRowsChanged` invalidation, and delta reads after each cell's
  high-water timestamp. It reduces repeated universe-wide `bar_cache`
  deserialization without adding DB connections.

Option E is not the final architecture. It is the current pressure-relief path
while the durable architecture is built:

1. Add request/query context to DB diagnostics so every slow query carries route,
   route class, request family, client role, request id, workload family, and
   query name.
2. Add a central DB workload budget so protected/live reads reserve capacity and
   ingestion, diagnostics, analytics, and backfills cannot consume all 12
   connections.
3. Move durable `bar_cache` writes out of API request paths. API routes may serve
   live memory and enqueue durable jobs; workers own dedupe, batching, retention,
   and pressure policy.
4. Serve `/diagnostics/runtime` from a cached precomputed snapshot; split heavy
   sections into separate endpoints.
5. Move option metadata hydration/update out of API request paths. A worker owns
   `option_contracts` ingestion and maintains compact active/future option-chain
   read models for API reads.
6. Serve derived shadow account/trading reads from event/cadence snapshots while
   protected order/execution mutations remain direct.
7. Consolidate frontend polling so runtime control, diagnostics, line usage, and
   market-data subscriptions are coordinated once per app, not once per surface.
8. Run DB maintenance, including hot-path option-chain indexes, in a quiet
   maintenance window.

## Why (measured, not inferred)

The API runs all JavaScript on a single event-loop thread = 1 of the box's 2 cores
(`nproc=2`; the API process has 11 OS threads but only `MainThread` executes JS).
Live Massive price delivery (SSE) shares that one loop with universe-wide market-data
compute, so when the compute runs hot, quote flushes starve and the UI freezes.

Two live CPU profiles of the running build (BEFORE = pid 31378, AFTER = pid 76200 with
all Lever-1 cuts live), ~30k samples each, steady state:

| Frame (self-time)                        | BEFORE | AFTER | note |
|------------------------------------------|--------|-------|------|
| `_parseRowAsArray` (pg row parse)        | 15.5%  | 17.2% | the wall |
| `mapFromDriverValue` (drizzle decode)    |  2.7%  |  3.1% | the wall |
| `slice`+`utf8Slice` (buffer/string decode)| 5.3%  |  6.4% | the wall |
| `(garbage collector)`                    |  6.4%  |  5.4% | churn from above |
| `mapResultRow` (drizzle map)             |  4.6%  |  0.4% | Lever-1 / read-fix |
| `aggregatePyrusSignals` forEach          |  9.0%  |  5.5% | Lever-1 (ISO dedup) |
| `compact`/`bucketShadowEquityHistory`    |  1.7%  | ~0.1% | Lever-1 (numeric keys) |
| `(idle)`                                 |  4.6%  |  7.3% | headroom gained |

Steady-state ELU (10s windowed): **1.000 → ~0.93**. Lever-1 demand cuts removed ~6 points
of *application* compute and bought a little idle headroom, but the loop is still ~93%
active, the DB pool still exhausts (12/12 + waiters), and prices still freeze.

**The binding constraint is the ~32% pg/drizzle row deserialization + its GC, for
universe-wide `bar_cache` reads. It is structural — no demand cut on one core touches it.
Only moving that work to the second core (Lever 2) breaks the wall.**

## The seam that already exists

- **market-data worker** is a *separate process* (`package.json` `market-data-worker:run`
  → `scripts/run-market-data-worker.mjs -p market-data-worker`). It owns INGEST: Massive
  subscribe → persist `bar_cache` (writes). It runs on its own core.
- The **API process owns the READS** that deserialize on its loop:
  - sparkline seed: `routes/platform.ts:1093/1103` (`loadStoredMarketBarsBySymbol`)
  - signal-monitor bar cache: `services/signal-monitor-local-bar-cache.ts:527/582`
    (`loadStoredMarketBars` / `loadStoredMarketBarsForSymbols`)
  - shadow account: `services/shadow-account.ts:12239` (`loadStoredMarketBars`)
  - chart/bars: `services/platform.ts:10707`
- So the producer is already off-loop. Only read + deserialize + aggregate is on the API loop.

## Goal

API loop serves HTTP/SSE + WS ingest only. Universe-wide read + deserialize + aggregate
moves to a second core. The API consumes compact, already-typed results (no pg, no drizzle,
no buffer decode on its loop).

## Options (ranked)

### Option A — Worker owns the bar cache and publishes compact snapshots (SUPERSEDED)
The market-data worker already has the bars (it ingests + persists them). Have it also hold
the authoritative in-memory bar cache + derived aggregations, and publish compact,
pre-deserialized snapshots (plain JS / typed arrays, numbers already parsed) to the API.
The API reads from an in-memory snapshot store fed by the worker — zero pg/drizzle on its loop.
- Transport (pick simplest that measures well): Postgres `LISTEN/NOTIFY` + a compact
  "latest snapshot" table; or a unix-socket IPC push; or a shared-memory ring
  (`SharedArrayBuffer`) for the hottest path.
- Pros: uses the 2nd core; removes the full ~32% from the API loop; the worker already owns
  this domain. Biggest ceiling lift.
- Cons: cross-process sync + a transport to build; staleness/consistency to define.

### Option B — `worker_threads` pool inside the API process
Move query+parse into threads: each thread owns a pg connection, runs the query, parses rows,
returns compact typed arrays (transferable / `SharedArrayBuffer`). Main thread does zero pg parse.
- Pros: single process; transferables avoid copy; uses the 2nd core for parsing.
- Cons: pg connection per thread vs the hard 12-connection pool ceiling; more to build than A,
  which already has a worker process.

### Option C — cut deserialization cost without offloading (this is still Lever 1)
Bypass drizzle on the hot reads (raw pg + manual typed parse, binary row mode, narrower
columns). Reduces but does not eliminate the on-loop cost. Diminishing; not a ceiling lift.

## Historical Recommended Path — Option A (SUPERSEDED)

1. **Inventory + contract.** Catalog the API's universe-wide bar reads and their shapes.
   Define the compact snapshot contract per consumer (e.g. `symbol → {t, close}` for
   sparklines; OHLCV typed arrays for signal eval).
2. **Move the heaviest reader first** (signal-monitor universe scan / sparkline seed) to be
   served from a worker-maintained snapshot. Keep the current path behind a kill-switch flag.
3. **Transport**: start with the simplest that works; measure ELU after.
4. **Give the worker its own DB pool.** The 12-connection helium cap is shared today; the
   worker's reads must not compete with API serving (and the load must shrink, not just relocate).
5. **Re-measure ELU + profile after each reader moves.** Target: API-loop
   `_parseRowAsArray`/`mapResultRow`/`mapFromDriverValue` for bar reads → ~0.

## Constraints / risks

- pg parses on the *calling* thread, so the offload must move the **query+parse**, not just
  post-processing.
- DB has a hard 12-connection ceiling (helium); relocating reads needs the worker's own pool
  or a real reduction in concurrent reads.
- Cross-process staleness: the worker is the producer, so it is authoritative; define freshness
  + a fallback so a worker stall can't blank the UI.
- Blast radius: the bar-read path feeds signals, sparklines, and shadow. Behavior-equivalence
  tests are required per reader moved.

## Success criteria

- API-process profile: bar-read deserialization frames → near 0 on the loop.
- Steady-state ELU on the API process well below 0.9 under full universe load.
- SSE quote flush no longer starves during signal scans (no 30-90s freezes).

---

## Phase 1 deliverable — Inventory + compact snapshot contract (done 2026-06-25)

Every consumer of the stored-bar readers (`loadStoredMarketBars{,BySymbol,ForSymbols}`,
`services/market-data-store.ts`), with input scope, the fields it ACTUALLY reads, and
its minimal contract. `BrokerBarSnapshot` (`lib/ibkr-contracts/src/client.ts:270`) has
~21 fields (timestamp, OHLCV, bid/ask/mid/quoteAsOf, source, providerContractId,
outsideRth, partial, transport, delayed, freshness, marketDataMode, dataUpdatedAt, ageMs);
most consumers use far fewer.

| # | Consumer (file:line) | Reader | Scope | Cadence | Fields used | Offload? |
|---|---|---|---|---|---|---|
| 1 | signal-monitor batch prefetch — `signal-monitor-local-bar-cache.ts:582` (via `runWithSignalMonitorStoredBarsPrefetch`, called from `signal-monitor.ts:9803/11062`) | `loadStoredMarketBarsForSymbols` | **UNIVERSE × 6 timeframes × 2 sources** | **per signal-eval cycle (tight loop)** | `timestamp`, `open/high/low/close/volume`, `delayed` (7 of ~21) | **PRIMARY — do first** |
| 2 | sparkline seed live+history — `routes/platform.ts:1093/1103` | `loadStoredMarketBarsBySymbol` | universe subset | per HTTP request | `timestamp`, `close` (2) | secondary (already lean + request-scoped) |
| 3 | signal-monitor per-symbol fallback — `signal-monitor-local-bar-cache.ts:527` | `loadStoredMarketBars` | single symbol | fallback on prefetch miss | `timestamp`, OHLCV, `delayed` | follows #1 |
| 4 | chart/bars — `services/platform.ts:10707` | `loadStoredMarketBars` | single symbol | per HTTP request | full OHLCV + metadata (source/transport/delayed/freshness/...) | no (single-symbol, needs full fidelity) |
| 5 | watchlist backtest — `shadow-account.ts:12239` | `loadStoredMarketBars` | single symbol | per HTTP request | `timestamp`, OHLCV, `partial` | no (single-symbol, per-request) |

### The target: consumer #1 (the 34% wall)

`runWithSignalMonitorStoredBarsPrefetch` issues one `loadStoredMarketBarsForSymbols`
per (timeframe × source) over the WHOLE universe, every signal-evaluation cycle —
`LOCAL_CACHE_TIMEFRAMES` = 6 (1m/2m/5m/15m/1h/1d), `storeSourceNames()` = 2
(massive-websocket|massive-delayed-websocket + massive-history). That is the universe-wide
deserialization the profile attributes to `_parseRowAsArray`/`mapResultRow`/`mapFromDriverValue`.
It needs only 7 of the ~21 fields, and never the `Date` object (it immediately calls `.getTime()`).

### Compact snapshot contract (worker → API)

```
CompactBar      = { t: number /*epoch ms*/, o: number, h: number, l: number, c: number, v: number, delayed: boolean }
SnapshotKey     = (symbol, timeframe, source)
SignalBarsSnap  = Map<symbol, CompactBar[]>            // per (timeframe, source), latest `limit`, oldest-first
SparklineSnap   = Map<symbol, Array<{ t: number, c: number }>>   // per timeframe (consumer #2, optional later)
```

- `t` is epoch ms (no `Date` → no Date deserialization). All numbers pre-parsed (no pg/drizzle).
- The worker already INGESTS + persists these bars, so it can keep the authoritative
  in-memory ring `Map<symbol, Map<timeframe, Map<source, CompactBar[]>>>` for free and publish it.
- The API's `runWithSignalMonitorStoredBarsPrefetch` becomes: read the published `SignalBarsSnap`
  (in-memory / IPC), no `bar_cache` query, no deserialization on the API loop. Behavior-equal:
  same symbols/timeframes/sources/limit, same `mergeBarsByTimestamp(delayed-aware)` downstream.

### Phase 2 (next): wire consumer #1 to a worker-published snapshot, flag-gated, behavior-equal,
re-measure ELU. Leave consumers #2-#5 on the current readers until #1 proves the win.

---

## CORRECTION (2026-06-25, post-inventory) — Option A is INVALID; Option B was next recommendation

Verified against source, disproving the Option A premise ("the market-data worker already
owns the bars, so it can publish them"):

- The `market-data-worker` is a **Rust/cargo binary** (`crates/market-data-worker/`,
  launched via `scripts/run-market-data-worker.mjs` → `cargo`). Its domain is **quotes +
  options + GEX**: `ingest.rs` writes `quote_cache`, `instruments`, `option_contracts`,
  `option_chain_latest`, `gex_snapshots`, `provider_request_log`. It touches `bar_cache`
  ONLY as a **retention janitor** (`retention.rs` deletes old rows). It **never writes bars.**
- The **Node API owns the entire bar lifecycle**: live Massive aggregate stream →
  `minuteBarsBySymbol` (in-memory, 72h `DEFAULT_MEMORY_RETENTION_MS`) → persist `bar_cache`
  (`persistMarketDataBarsForSymbols`, `signal-monitor-local-bar-cache.ts:621`) → read back
  for signal-monitor history augmentation. The 34% deserialization is the API reading back
  its OWN bars on local-cache misses.

So there is no Node worker to publish from, and the "I publish / readset reads" split does
not apply. The data is entirely in the Node API's domain. Corrected option ranking:

- **Option B — `worker_threads` pool inside the Node API (RECOMMENDED).** Confirmed available.
  Move the `bar_cache` read+parse for the universe prefetch onto a thread: the thread owns a
  pg connection, runs the set-based query, parses rows, and returns **compact OHLCV as a
  transferable `Float64Array` / `SharedArrayBuffer`** (zero-copy back to the main thread). The
  main loop does zero pg/drizzle parsing. This is the only option that uses the 2nd core AND
  removes the deserialization, and threads (unlike the Rust process) share memory so the
  hand-back is zero-copy. Connection use is unchanged (same reads, relocated).
- **Option D — extend in-memory retention / keep the local cache warm (simpler interim).** The
  API already holds `minuteBarsBySymbol`; the reads happen on misses. Widening coverage so the
  prefetch hits memory eliminates the DB read without new concurrency infra. Cost: RSS (already
  ~2.4GB and climbing → OOM risk). This is demand-reduction (Lever-1.5), and readset's reconcile
  already cut the miss count 37,807→2,684, so the remaining reads are largely genuine deep-history
  misses — diminishing returns.
- **Option A-revised — a dedicated Node bar worker_thread that owns `minuteBarsBySymbol` + the
  bar_cache augmentation** and serves the main thread compact bars. Bigger refactor than B;
  consider only if B's per-call thread hops dominate.

Re-scoped ownership: the offload lives in the Node bar-read path
(`signal-monitor-local-bar-cache.ts` — readset's domain) + a new `worker_threads` harness. The
CompactBar contract above still holds; the producer is a thread, not the Rust worker.

## CORRECTION (2026-06-26, implementation follow-up) — Option B is superseded by Option E for the immediate path

Current source moved to **Option E: cross-cycle cache + delta read +
invalidation** in `signal-monitor-local-bar-cache.ts`, backed by
`onBarCacheRowsChanged` from `market-data-store.ts`.

Why this supersedes Option B for the immediate pressure path:

- It reduces repeated universe-wide `bar_cache` demand instead of relocating the
  same demand to another thread.
- It does not add DB connections, which matters because helium still caps the
  app at 12 pooled connections.
- It invalidates only affected cache cells when persisted rows actually change,
  and uses delta reads above the cached high-water timestamp.

Residual limits:

- Option E does not solve all DB/API pressure. Runtime evidence still shows
  `option_contracts`, shadow account/trading reads, diagnostics writes, and
  execution-event reads can saturate the pool.
- Route-level shedding and in-handler pressure guards are safety brakes. For
  example, `/sparklines/seed` can now be shed by middleware when finite-resource
  pressure is high. Its handler only serves live/cached bars without DB backfill
  when admission still allows the request but API/resource pressure is high.
- The durable architecture remains the sequence in **Current Decision
  (2026-06-26)** above.
