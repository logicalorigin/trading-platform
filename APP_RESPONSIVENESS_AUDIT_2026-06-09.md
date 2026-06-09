# App Responsiveness Audit — 2026-06-09

## Context

This documents **all the reasons the app isn't more responsive and snappy**. It consolidates (a) a fresh investigation of the live frontend (`artifacts/pyrus`) and backend (`artifacts/api-server`) code, and (b) findings already recorded in prior audit/handoff docs. Every headline claim is backed by a `file:line` reference; conflicts between old docs and current code have been resolved against the current source.

The picture that emerges: the app is slow for **structural** reasons, not one bug. Three forces stack on top of each other:
1. **Too many concurrent polls** hammering the client main thread and the server.
2. **Monolithic screens that re-render the whole world** on every poll/tick, with no virtualization.
3. **A constrained server data path** (small DB pool, low bridge concurrency, per-tick serialization, pressure-driven throttling) that makes each request slower under load — which then triggers more retries and pressure.

## Remediation Progress

- 2026-06-09: Tier 1 polling-cadence pass started. Line-usage fallback polling now defaults to 10s, session polling is visible-tab-only at 20s, Account live REST fallback stale/refetch defaults moved to 15s, and flow aggregate/chart-flow refresh is 10s. Source checks and Pyrus typecheck passed; browser Network request/minute verification is still pending.
- 2026-06-09: FlowScreen 1s parent re-render source removed. Trade-age labels now use a scoped shared second-clock subscription instead of `flowNowMs` state on `FlowOverviewPanel`, so the full Flow screen no longer rerenders only to update age text. Pyrus typecheck passed; React Profiler verification is still pending.
- 2026-06-09: A4 remediated — decoupled Massive aggregate-stream ingestion from render rate. `useMassiveStockAggregateStream.ts` `scheduleRealtimeFlush` now coalesces store flushes per `requestAnimationFrame` instead of `queueMicrotask` (one render/frame vs one render/SSE message), and `MarketDataSubscriptionProvider.jsx` memoizes per-symbol sparkline bars by per-symbol version so one ticking symbol doesn't recompute the uncapped universe. This addresses the Chrome tab freeze that resurfaced after the watchlist quote batch was uncapped (`DEFAULT_BATCH_SIZE = null`) without re-adding a symbol cap. Pyrus typecheck + targeted tests passed; React Profiler verification under live load is pending.

---

## A. Frontend: why the UI feels laggy

### A1. Aggressive, overlapping polling (highest impact, low fix cost)
Many independent polls run concurrently on a typical screen, each triggering network + JSON parse + React Query churn on the main thread:
- Original observation: IBKR line-usage fallback poll was **every 2s** — `artifacts/pyrus/src/features/platform/useRuntimeControlSnapshot.js:21`. **Status: remediated in source to 10s fallback.**
- Original observation: session poll was **every 5s** — `artifacts/pyrus/src/features/platform/PlatformApp.jsx:1164`. **Status: remediated in source to visible-tab-only 20s.**
- Original observation: AccountScreen live REST fallback queries used a **5s** shared stale/refetch default — `artifacts/pyrus/src/screens/AccountScreen.jsx:538` (`ACCOUNT_LIVE_STALE_MS = 5_000`). **Status: remediated in source to 15s.**
- Original observation: Flow aggregate refetch could be as low as **2.5s** — `artifacts/pyrus/src/features/platform/useLiveMarketFlow.js:342`. **Status: remediated in source to 10s.**

This matches the prior `PAGE_LOAD_PERFORMANCE_AUDIT.md` finding ("AccountScreen polls every 5s, overriding the 30s global staleTime, ~50 req/min").

### A2. Monolithic screens re-render on recurring clocks with limited memo isolation
- **FlowScreen.jsx is ~6,400 lines** and previously had `setInterval(... , 1000)` driving `flowNowMs` state on `FlowOverviewPanel`, causing full-screen rerenders only to update trade age labels. **Status: remediated 2026-06-09 in source; profiler verification pending.**
- **PlatformApp.jsx is ~5,600 lines**; session/account poll updates cascade into the whole tree — `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
- **BloombergLiveDock.jsx** runs 3+ concurrent `setInterval`s (3s watchdog etc.), each re-rendering the dock — `artifacts/pyrus/src/features/platform/BloombergLiveDock.jsx:2141`

The remaining recurring re-render cycles still stack, so during active use the app can spend a large fraction of each second in React reconciliation. FlowScreen's trade-age clock is no longer one of those parent-level cycles after the 2026-06-09 source fix.

### A3. Incomplete virtualization / fixed-row caps on big tables
Signals and positions still need review for full-row DOM rendering. The earlier Flow desktop-table claim is stale: Flow now uses `DenseVirtualTable` for desktop rows, while mobile still maps the capped visible row set.
- Positions — `artifacts/pyrus/src/screens/account/PositionsPanel.jsx`
- Historical note: `PAGE_LOAD_PERFORMANCE_AUDIT.md` said "Flow main grid is `.map()` not virtualized"; that no longer matches the current desktop Flow table source.

### A4. Streaming ticks bypass batching at the per-symbol layer
There is 100ms quote batching (`live-streams.ts:70`), but per-symbol store listeners fire independently per tick, so charting N symbols means N unbatched re-renders per tick — `artifacts/pyrus/src/features/charting/useMassiveStockAggregateStream.ts:124`. **Status: remediated 2026-06-09.** The aggregate store's `scheduleRealtimeFlush` previously used `queueMicrotask`, which drains between every SSE `aggregate` event → one React render pass per message; this is what the (correctly) uncapped symbol fanout exposed as the Chrome tab freeze. Flushes now coalesce per animation frame via `requestAnimationFrame`, and `MarketDataSubscriptionProvider.jsx` memoizes per-symbol sparkline bars by per-symbol version (new `getStockMinuteAggregateSymbolVersion`) so one ticking symbol no longer recomputes the whole universe. Cap stays `null`. Typecheck + `watchlistQuoteRotation`/`PlatformWatchlist` tests pass; React Profiler verification under live load is pending.

### A5. Heavy synchronous compute on the main thread
Indicator math (EMA/SMA/stddev/RSI) is unmemoized O(n)–O(n·p) and runs on the render path; `computeStandardDeviation` re-slices the array each iteration — `artifacts/pyrus/src/features/charting/indicators.ts:88`. Flow event processing does repeated `.sort()`/`.reduce()` over large arrays — `artifacts/pyrus/src/features/charting/flowChartEvents.ts`.

### A6. No route-level code splitting → slow first interaction
Screens are imported synchronously in `PlatformApp.jsx` (~21K lines of screen code parsed/executed at startup regardless of landing screen). Reinforced by `PYRUS_LOADING_POLICY_ASSESSMENT.md` ("boot loader blocks until 4 other screens' JS chunks load") and `LOADER_RING_AND_BOOT_FIX.md` ("double boot loader").

### A7. Known stutter: broker-connection sine wave (currently open)
The connection-status wave rebuilds every 1000ms tied to `marketClockNow`, restarting the SMIL animation each second; flapping ping/state makes it worse. Source: `SESSION_HANDOFF_LIVE_2026-06-08_broker-connection-wave-stutter.md` (files: `HeaderStatusCluster.jsx`, `IbkrConnectionStatus.jsx`). **Status: not yet fixed.**

### A8. Layout thrash from tooltips/charts
Tooltips measure `scrollWidth`/`getBoundingClientRect()` on every open with no memoization — `artifacts/pyrus/src/components/ui/tooltip.tsx:277`; chart surface calls `getBoundingClientRect()` repeatedly on resize — `artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx`.

---

## B. Backend: why each request is slow (and slower under load)

### B1. Small DB connection pool + long acquire timeout (highest backend impact)
Pool max is **6 (helium) / 10 (default)**, with a **30s** connection timeout on helium — `lib/db/src/index.ts:35-56`. The recent commit `f3ada41` ("classify postgres pool acquire timeouts") confirms acquire timeouts happen in practice (`lib/db/src/pool-error-handler.ts`). Under concurrent screen loads, requests queue on pool acquisition → multi-second waits.

### B2. Per-tick synchronous `JSON.stringify` on every SSE event
Each SSE event is serialized synchronously per tick with no batching — `artifacts/api-server/src/routes/platform.ts:1238`. At many ticks/sec × many clients this blocks the event loop. (Earlier RSS investigation, `memory/2026-05-28...`, traced a 967k events/min Massive stream that saturated the main thread — same class of problem.)

### B3. Low bridge concurrency on account/orders/health
Bridge governor per-category concurrency — `artifacts/api-server/src/services/bridge-governor.ts:57-62`: quotes 8, bars 4, options 4, **account 2, orders 1, health 1**, with **15–45s backoff** on failure. (Note: the old "all lanes concurrency 1" claim in `PAGE_LOAD_PERFORMANCE_AUDIT.md` is **stale** — quotes/bars/options are higher now — but account/orders/health are still serialized and the long backoff can blackout a category for 30–45s after a transient error.)

### B4. Hot endpoints recompute instead of caching
- Quote snapshot cache keys on the **entire symbol list**, so `[AAPL,MSFT]` and `[AAPL,MSFT,GOOGL]` never share cached symbols — `artifacts/api-server/src/services/platform.ts:5045`.
- Quote cache is **fully iterated to prune on every miss** — `platform.ts:5030`.
- Flow events endpoint does **full dedupe + sort + filter per request** — `platform.ts:12488`.
- Universe search recomputes (multi-provider fetch + merge + `scoreUniverseTicker` twice per sort comparison) with only a 30s cache — `platform.ts:7054`, `:5307`.

### B5. Pressure-driven degradation cascade
Under RSS/latency pressure the system throttles scanners and serves cache-only, which makes data stale and triggers more client retries. Documented repeatedly: `APP_DEFICIENCY_REPORT_2026-05-26.md` (p95 2378ms, p99 6163ms, `/algo/.../cockpit` p95 9877ms, event-loop max ~9.9s), and the historical-farm-freeze memory (`memory/ibkr-historical-farm-freeze.md`) where an inactive HMDS farm jams the historical-bars lane and freezes the app.

---

## C. Already-fixed (don't re-investigate)
Per the handoff docs, these were resolved and shouldn't be re-opened: RSS thresholds now scale to cgroup limit + Massive raw quote websocket removed from startup (`memory/2026-05-28...`), session payload −78% (dropped `desktopAgentRequests`), signal/STA staleness window tightened to ≤1 bar (2026-05-28), flow scanner line-allocation stall (2026-05-29), per-symbol logo batching (2026-06-03).

---

## D. Recommended remediation order (highest snappiness gain per unit effort)

**Tier 1 — quick wins (hours, low risk):**
1. Cut polling: line-usage 2s→10s, session 5s→20–30s, gate AccountScreen's 5 queries on page-visibility / raise to 15s (`useRuntimeControlSnapshot.js:21`, `PlatformApp.jsx:1164`, `AccountScreen.jsx:538`). **Status: source patch applied; browser Network verification pending.**
2. Decouple the broker-connection wave from the 1s clock + memoize it (open item, `broker-connection-wave-stutter` doc).
3. Replace FlowScreen's 1s full-screen re-render clock with a scoped/ref-based clock or 5s cadence (`FlowScreen.jsx:1944`); same for Bloomberg dock timers. **FlowScreen source patch applied; React Profiler verification pending. Bloomberg dock still open.**
4. Raise bridge `account`/`orders` concurrency and shorten the catastrophic 30–45s backoffs (`bridge-governor.ts:57`).

**Tier 2 — structural (days):**
5. Virtualize the flow/positions/signals tables using the existing `DenseVirtualTable`.
6. Raise the DB pool max and/or shorten acquire timeout; add a DB ping to healthz (`lib/db/src/index.ts`).
7. Per-symbol quote cache keying + incremental cache pruning (`platform.ts:5045`, `:5030`).
8. Batch SSE writes / move serialization off the per-tick hot path (`platform.ts:1238`).
9. Memoize indicator math / move to a worker (`indicators.ts:88`).

**Tier 3 — larger (weeks):**
10. Route-level code splitting + decouple boot loader from non-active-screen data (`PYRUS_LOADING_POLICY_ASSESSMENT.md` phased plan).
11. Move AccountScreen from polling to SSE.

---

## E. Verification approach
- **Polling load:** open DevTools Network, count requests/min per screen before/after Tier 1 (target: ≥50% fewer).
- **Re-render cost:** React Profiler on FlowScreen — confirm the 1s commit storm is gone.
- **Backend latency:** the app already exposes diagnostics (p95/p99 per route, event-loop lag, RSS) used in `APP_DEFICIENCY_REPORT`; watch `/algo/.../cockpit` p95 and event-loop max drop.
- **DB pool:** watch the pool-acquire-timeout classification (commit `f3ada41`) stop firing under normal multi-screen use.
