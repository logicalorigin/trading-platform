# Live Data Work Planner Handoff

- Created At (MT): `2026-05-29 11:59:01 MDT`
- Created At (UTC): `2026-05-29T17:59:01Z`
- Repo: `/home/runner/workspace`
- Intended Recipient: active market-data worker session `019e7499-013e-7c80-ad40-9c917f319149`
- Delivery Method: repo-root markdown handoff plus pointer in the active session handoff

## Why This Exists

The line-usage, provider-routing, scanner, Rust ingest, diagnostics, and frontend memory issues are one system problem. Do not fix this by adding timeout bumps, sleep windows, or one-off caps. The likely root cause is that PYRUS does not have one authoritative planner for live data work. Scanner, visible UI, account/automation, bridge subscriptions, diagnostics, Rust ingest, and memory pressure each make local decisions, so IBKR lines churn, API/bridge accounting drifts, scanner demand is hidden by exclusions, and the browser can keep ingesting/rendering work after the runtime is already memory-stressed.

Root cause hypothesis:

> PYRUS needs a single market-data work planner that computes provider ownership, desired live subscriptions, cache/DB reuse, scanner batch horizon, release generation, diagnostics state, and memory-pressure policy before the API asks IBKR, Massive/Polygon, Rust ingest, or the frontend runtime to do work.

## Evidence From The Earlier Audit

- Five-minute live watch showed active lines stayed within budget, peaking around `149 / 200`, but drift was frequent during scanner/account/visible churn.
- `persistentBridgeOnlyLineCount` briefly spiked to `23`, `21`, later `6`, then cleared.
- Line endpoint latency spiked up to roughly `7201ms`.
- Quote/option/aggregate reconnect counts stayed at `0`, so this is probably not a reconnect-loop problem.
- Periods with no quote consumers produced expected stale quote-age flags and IBKR went `quiet/no_active_quote_consumers`.
- Post-watch snapshot was roughly: active `105`, bridge `31`, remaining `95`, visible `21`, flow `72`, automation `14`, option `79`, drift `mixed`, apiOnly `5`, bridgeOnly `3`, persistentBridgeOnly `0`, snapshotOnly `72`, quote freshness `26ms`, option quote `29ms`, aggregate connected `true`, subscribers `550`.

## Important Local Findings

### IBKR Line Accounting

- `artifacts/api-server/src/services/ibkr-line-usage.ts`
  - `isSnapshotOnlyAdmissionLease()` treats every `flow-scanner-live` option lease as snapshot-only.
  - `buildAdmissionLineIdSets()` removes those scanner option lines from comparable API-vs-bridge drift.
  - This looks like an errant intentional exclusion. It can make real bridge-active scanner lines show up as `bridgeOnly` while also hiding scanner demand from true reconciliation.
  - Persistent tracking currently focuses on bridge-only drift; persistent API-only drift should also be tracked.

- `artifacts/api-server/src/services/market-data-admission.ts`
  - Scanner effective cap is computed from API leases only, not from a bridge-confirmed active/releasing desired set.
  - `releaseLease()` deletes leases immediately, while bridge cancellation is asynchronous.
  - There is no generation-aware release acknowledgement or scanner release hysteresis.

### Scanner And Batching

- `artifacts/api-server/src/services/options-flow-scanner.ts`
  - `startRotation()` uses simple round-robin batches from `rotationOffset`.
  - `requestScan()` and `mergeQueuedRequest()` can merge duplicate scan requests, but there is no planned future scan horizon.

- `artifacts/api-server/src/services/platform.ts`
  - Scanner concurrency and batch size are derived from runtime config and admission diagnostics.
  - This is the right place to feed a centralized work planner rather than letting each scanner phase independently create live quote demand.

### Bridge Subscription Registry

- `artifacts/ibkr-bridge/src/tws-provider.ts`
  - Bridge already has a `quoteSubscriptions` map and desired-set trimming.
  - The bridge uses `@stoqey/ib` through `IBApiNext.getMarketData()`.
  - Keep `@stoqey/ib`; add a PYRUS-owned desired generation and release registry above it.

### Frontend Memory And Empty Footer Bar

- `artifacts/pyrus/src/features/platform/useMemoryPressureSignal.js`
  - Browser memory is high confidence only when `performance.measureUserAgentSpecificMemory()` is available and `crossOriginIsolated`.
  - Otherwise it falls back to deprecated/non-standard `performance.memory`, then low-confidence heuristic.
  - `readQueryDiagnostics()` redundantly calls `window.__PYRUS_MEMORY_DIAGNOSTICS__` twice.

- `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
  - `window.__PYRUS_MEMORY_DIAGNOSTICS__` is assigned and cleaned up twice.

- `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx`
  - The footer should render labels and mini bars even without browser memory data.
  - The "empty bar at the bottom" likely means metrics are stuck at unknown/zero, CSS/layout hides the cluster, or the monitor is not sampling. Treat this as instrumentation and state propagation, not just styling.

## External Research Inputs

- IBKR market data lines are active real-time subscriptions shared by TWS and API, so rotation must manage active desired sets instead of raw request count:
  - https://interactivebrokers.github.io/tws-api/market_data.html
  - https://www.interactivebrokers.com/campus/ibkr-api-page/market-data-subscriptions/
- PYRUS already uses the TypeScript IBKR client:
  - https://github.com/stoqey/ib
- Useful design patterns to borrow from `ib_async`, not necessarily add as a dependency:
  - ticker/request registry
  - explicit cancel by contract/ticker
  - throttled request dispatch
  - batch packet/update processing
  - https://github.com/ib-api-reloaded/ib_async
- Browser memory APIs are imperfect and cannot be the only safety mechanism:
  - https://web.dev/articles/monitor-total-page-memory-usage
  - https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory

## Recommended Implementation Plan

### 1. Add An API-Side Market Data Work Planner

Create a service such as `artifacts/api-server/src/services/market-data-work-planner.ts`.

Planner inputs:

- visible runtime demand
- active symbol/watchlist state
- options flow scanner universe and next scan horizon
- automation/account/execution protected demand
- Massive/Polygon stock snapshot/aggregate freshness
- Rust persisted ingest queue state
- admission diagnostics and bridge subscription diagnostics
- resource and memory pressure summaries

Planner output:

- `generation`
- `ibkrEquityLive[]`
- `ibkrOptionLive[]`
- `polygonSnapshot[]`
- `polygonAggregateFallback[]`
- `persistJobs[]`
- `release[]`
- `evict[]`
- `memoryAction`
- per-line `owner`, `intent`, `pool`, `priority`, `freshness`, `reason`

Provider policy:

- IBKR owns broker/account/execution/options/live trading lines.
- Massive/Polygon owns stock snapshots, stock quote/aggregate fallback, historical/provider data, and persisted ingest provider paths.
- Rust worker owns persisted `stock_snapshot`, `option_chain_snapshot`, and `gex_snapshot` jobs only. Historical bars, option flow events, flow summaries, and backfills remain future work unless already wired elsewhere.

### 2. Make Scanner Rotation Plan-Aware

- Replace simple round-robin emission with planned windows.
- Precompute the next scanner batch horizon from selected universe, known current batch, and candidate promotion rules.
- Use Massive/Polygon data and cache freshness before promoting a symbol/contract to IBKR option live lines.
- Batch known upcoming contract IDs into one planned desired set instead of independent `requestScan()` bursts.
- Preserve throughput-first behavior, but make scanner line demand visible and honest.

### 3. Fix Line Drift Truthfulness

- Remove the blanket `flow-scanner-live` option `snapshotOnly` exclusion from drift comparison.
- Reclassify scanner lines as `planned_ephemeral` only when the work planner has a current generation explaining them.
- Add persistent API-only drift tracking alongside bridge-only tracking.
- Diagnostics should classify each drift line as `planned`, `live`, `releasing`, `stale`, or `unexpected`.

### 4. Add Bridge Desired Generation And Release Acknowledgement

Keep `@stoqey/ib`, but wrap current bridge subscription logic with a PYRUS registry:

- desired generation id
- current owner set
- subscribedAt
- lastTickAt
- releaseRequestedAt
- releaseObservedAt
- lastError

The bridge should coalesce subscription diffs before calling `getMarketData()` or unsubscribing. `maxReqPerSec` remains transport pacing only; it should not be the main correctness layer.

### 5. Integrate Memory Pressure With Planning

- Fix the duplicate frontend diagnostics hook assignment/call.
- Make the footer mini bars show an explicit `unknown` or `collecting` baseline rather than visually empty 0-percent bars.
- Capture `document.wasDiscarded`, store counts, query counts, stream counts, and last planner generation on app boot and `visibilitychange`.
- Feed memory pressure into the work planner:
  - normal: full planned scanner horizon
  - watch: skip speculative hydration and shrink non-visible background work
  - high: pause non-visible chart/flow hydration and limit scanner horizon
  - critical: preserve visible/account/execution work only; block background scanner expansion

### 6. Surface Diagnostics In One Place

Add a diagnostics payload section named `marketDataWorkPlan`.

Minimum fields:

- generation
- active provider split
- planned vs live IBKR line counts
- planned releases
- scanner horizon
- memory action
- drift reconciliation
- stale or missing provider data reasons

Do not allow UI diagnostics to report healthy when data is stale, hidden, delayed, unsubscribed, unconfigured, or only low-confidence measured.

## Suggested Validation

Static/unit first:

```bash
pnpm --dir artifacts/api-server exec node --import tsx --test src/services/ibkr-line-usage.test.ts src/services/market-data-admission.test.ts src/services/options-flow-scanner.test.ts
pnpm --dir artifacts/api-server exec node --import tsx --test src/services/bridge-quote-stream.test.ts src/services/bridge-option-quote-stream.test.ts src/services/massive-stock-quote-stream.test.ts
pnpm --dir artifacts/pyrus exec node --test src/features/platform/FooterMemoryPressureIndicator.test.js src/features/platform/memoryPressureModel.test.js src/features/platform/live-streams.test.ts
pnpm run test:market-data-worker
pnpm run build:market-data-worker
pnpm run db:market-data:audit
pnpm --dir artifacts/api-server run typecheck
```

Bounded live validation:

- Repeat a five-minute line-usage watch.
- Then run a 30-minute scanner soak when IBKR/Massive credentials are configured.

Pass criteria:

- no over-budget IBKR lines
- persistent drift either clears or is classified as `releasing` with generation evidence
- quote and option freshness remain bounded
- reconnect counts stay zero or are explained
- frontend store/query/stream counts stop unbounded growth
- memory footer is visible and meaningful even when browser memory APIs are unavailable

## Coordination Notes For The Active Agent

- Do not stage or revert existing dirty work unless intentionally scoped.
- Current known dirty files from the parent session included:
  - `artifacts/pyrus/src/features/platform/platformRootSource.test.js`
  - `artifacts/pyrus/src/features/platform/useRuntimeControlSnapshot.js`
  - `crates/market-data-worker/src/compute/gex.rs`
- Handoff files were already dirty before this note was added, likely from active session updates.
- This document is an implementation plan for the next live-data cleanup pass. It is not a request to interrupt the currently running bounded worker drain.
