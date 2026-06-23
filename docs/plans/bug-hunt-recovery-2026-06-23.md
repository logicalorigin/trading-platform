# Bug-hunt recovery — 2026-06-23 (RTH / market open)

Recovered from session `93084a11-33e5-4b19-b7b2-4e8c272608ec` ("watch our app for 5
minutes looking for bugs"), which hit an Anthropic **API 500 outage at 14:12:50 UTC**
*while extracting* its verified findings — so the work was computed but never surfaced.
This doc is the durable record so the outage can't lose it again.

## Final status (2026-06-23) — all findings dispositioned

| # | Finding | Status |
|---|---------|--------|
| 1/5 | signal-matrix per-tick/per-subscriber recompute | ✅ landed on `main` (`8303221`) — memoize the heavy indicator pass |
| 2 | quotes snapshot redundancy | ✅ already fixed in current code (cleared, don't re-flag) |
| 3 | GEX chart projection per-request heavy SQL | ✅ landed — TTL + single-flight cache on `getLatestChartGexSnapshot` |
| 4 | bars all-favorites prewarm fan-out | ✅ landed — cap mount prewarm to favorites adjacent to current TF |
| 6 | `/diagnostics/client-events` 429-shed | ✅ landed on `main` (`549e10b`) |
| 7 | backtests/studies 400 (pattern-discovery rows) | ✅ landed on `main` (`27502bd`) |
| 8 | overnight-spot blocked toasts during RTH | ✅ landed on `main` (`851f5fe`) — dormant during RTH |

Remaining real-world step: confirm #8 (toasts stop) and #3 (GEX latency) in the running app after deploy.

- Tree state when found: HEAD `5788d36`, **no fixes applied** (all findings still live in code).
- Evidence: workflow `wpq79e5n7` (7 investigators + 7 skeptic-verifiers, all `holdsUp=true`,
  `presentInCurrentCode=true`) + overnight-spot agent `a0a1f7d979e1acb38`.
- Source artifacts: `/tmp/claude-1000/-home-runner-workspace/93084a11-.../scratchpad/watch/`
  and `.../tasks/wpq79e5n7.output`.

## Live watch report (5 min, RTH)
- **P1 — API event-loop saturation (umbrella cause).** Single Node API process pinned
  **101–102% CPU even idle, zero clients**. App's own `eventLoopP95Ms` 256ms idle → 415ms
  under 5 tabs; `eventLoopMaxMs` 455 → 1727ms (healthy <50ms). Under load `/api/healthz`
  p50 797ms/max 6825ms, GEX 4–9s, `/diagnostics/runtime` & `/algo/deployments` timed out
  at 10s, `/quotes/snapshot` 58ms → 1.3s. *(observed runtime, not from source)*
- **P1 — Signals screen uncaught `TimeoutError` ×4 (45s).** Symptom of saturation, surfaces unhandled.
- **P2 — Rate limiter sheds user-facing data (429)** on `/api/bars`, `/options/expirations?underlying=SPY`, `/diagnostics/client-events`.
- **P2 — Chart/bar hydration on interval switch** (Research fired 0 `/bars`; Trade is where bars fetch + where the 429 hit).
- **P2 — GEX endpoints slow (4–9s; projection 2/6 timed out).** Slow, not failing.

## Verified root-cause findings

The umbrella: **redundant signal recompute saturates the single event loop**, which then
drives the 429 shedding, the Signals timeouts, and most latency. Findings **#1, #5, #6 are
one cause**; #3, #4, #7, #8 are independent.

### #1 eventloop — per-tick full indicator recompute (HIGH, root) — server hot-path
A server-owned synthetic subscriber (started unconditionally at boot, `index.ts:280`) keeps
the Signal-Matrix stream subscribed to the full capped universe (≤500 symbols) × 6 timeframes.
Every intra-minute Massive price tick re-runs `evaluatePyrusSignalsSignals` (full 240-bar
WMA/ATR/SMA/ADX/vol + O(n) CHoCH scan; caches TTL=0 at `signal-monitor.ts:350-358`) once per
timeframe per symbol. Output is **bar-close based** → >99% recompute an identical result.
Synthetic subscriber means `subscribers.size` is never 0, so it fires continuously with zero clients.
- Evidence: `index.ts:280`; `signal-monitor.ts:8034,7944-7955,8038-8049`, `:7656,7818`, `:332-341,7635-7643`, `:6210,7196-7202`; `lib/pyrus-signals-core/src/index.ts:955-997`.
- Direction: gate so a (symbol,timeframe) is re-evaluated **only when a new completed bar exists**
  (compare latest closed-bar ts vs last-evaluated per cell). Collapses ~10 evals/s/symbol → ≤1/min for 1m.

### #5 signalmonitor — per-subscriber duplicate recompute (HIGH, root) — server hot-path
On each bar-close, `emitSignalMonitorMatrixStreamAggregateDelta` (`signal-monitor.ts:7665`)
loops **every subscriber** and re-runs the full bar-ring load + merge + `evaluatePyrusSignalsSignals`
for each, though inputs are identical for all same-env subscribers. N tabs = (1 synthetic + N)×
the same CPU work. `f5d8b77`'s 15s `/state` cache is route-local and doesn't touch this.
- Evidence: `signal-monitor.ts:7665-7734`, `:7159-7203`, `:6207-6224`, `:7914-7980`, `:7745-7801`; `routes/signal-monitor.ts:210-261`.
- Direction: evaluate each (symbol,timeframe) **once per bar-close**, fan the result out; per-subscriber work shrinks to scope filter + diff/emit.

### #6 ratelimit — 429 shedding is downstream symptom (HIGH, symptom) + real mis-scoping
`apiRouteAdmissionMiddleware` sheds `deferred-analytics` when `resourceLevel==="high"`
(`route-admission.ts:198-211`), gated on `eventLoopDelayP95Ms`; idle p95 256ms > HIGH=250ms
(`resource-pressure.ts:86-87`) latches high via 2-sample hysteresis and never clears.
- **Primary fix = eliminate the CPU (#1, #5)**; do NOT raise the 250ms threshold (masks the pin).
- **Secondary mis-scoping (fix regardless):** whitelist `/diagnostics/client-events` as active-screen
  (`route-admission.ts:330`); `/bars` & `/options/expirations` are only "visible" at `fetchPriority>=6`
  (`:337-364`,`:140-160`) so mistagged/low-priority user reads get shed.

### #3 gex — chart projection re-runs heavy in-DB JSONB query every request, no cache (HIGH, root)
`getLatestChartGexSnapshot` (`market-data-ingest.ts:692-799`) does per-request `jsonb_array_elements`
expand ×2 + `dense_rank()` window + `jsonb_agg` over the full options blob, on the 12-conn pool with a
10s wait budget (`GEX_CHART_PROJECTION_SNAPSHOT_WAIT_MS=10_000`, `gex.ts:223-226`) — matches 9.4s p50/10s
timeouts. `getChartGexProjectionData`/`getGexProjectionData` have no result cache (`gex.ts:2146,2392`).
- Direction: have the ingest worker precompute+persist the compact near-money projection slice (+ zero-gamma)
  so the request is a cheap SELECT; **or** in-process cache keyed by `(ticker, snapshot.computedAt)`.
- Verifier caveat: zero-gamma ACTIVE mode is already cached via `gexDashboardCache` — overstated in the brief.

### #4 bars — unconditional all-favorites prewarm fan-out (HIGH, root) — client-side, lower risk
On every chart mount `TradeEquityPanel` auto-prewarms ALL favorite timeframes (default 11) — one
`getBars` per favorite, distinct base ⇒ no React-Query dedupe ⇒ ~10 unsolicited upstream fetches —
at priority `near`=4, **below** the visible≥6 threshold, so they're exactly what 429-sheds.
- Evidence: `TradeEquityPanel.jsx:558-585,500-557`; `charting/timeframes.ts:271-283`; `queryDefaults.js:37-42`; `hydrationCoordinator.ts:36-41`; `route-admission.ts:150-159` (shed path `:356-364`).
- Direction: demand-driven prewarm (on picker hover/open, or 1–2 adjacent), cap N, don't issue below the
  admission visible threshold; drop `refetchOnMount:'always'` on the visible barsQuery.

### #7 functional — two server-side errors (HIGH, root) — lower risk, no live-trading path
- **Bug1 `GET /api/backtests/studies` 400:** 200/203 study rows are MTF pattern-discovery studies stored
  with `portfolio_rules={}`/`execution_profile={}`, but `ListBacktestStudiesResponse` requires those nested
  numeric fields → `.parse()` ZodError → global handler → 400 for the *whole list*.
  Evidence: `routes/backtesting.ts:59-62`; `app.ts:215-227`; `lib/api-zod/src/generated/api.ts:6272-6299`;
  `services/backtesting.ts:2184-2186,1362-1371`. Fix the **contract**: make those optional/nullable + mapper
  emits null for pattern-discovery rows, OR persist concrete defaults + backfill 200 rows. Not `safeParse`.
- **Bug2 `POST .../sessions/{id}/symbols` 404:** client/server registration race — client POSTs as soon as the
  `EventSource` object exists, before the server registers the session in the aggregate stream.

### #8 overnight — "blocked" toasts during RTH = redundant execution (HIGH, root) — ⚠ has a product question
Overnight-spot worker runs on a continuous timer with **no market-session gate** (`overnight-spot-worker.ts:23-24`,
boot `index.ts:291`) AND is force-woken during RTH by `signal_monitor_event_created` (`:494-498` ←
`signal-monitor.ts:4866-4871`) — explains the "~30 min into RTH" timing. Each scan requests quotes with a
**hardcoded** `tradingSession:"overnight"` (`overnight-spot-execution.ts:822`); RTH overnight feed is empty/wide →
blocks `overnight_spot_quote_required`/`spread_too_wide` → `overnight_spot_signal_blocked` event → SSE
(`algo-cockpit-events.ts`) → toast (`PlatformShell.jsx:818-827`, `algoEventToasts.js:24,71-78`). Correct ET
session helpers exist (`signal-options-automation.ts:13377-13424`) but this path never calls them.
- Direction: add a live-session gate so overnight-spot skips `runActions` during RTH (mirror
  `pauseDeploymentForResourcePressure` short-circuit at `overnight-spot-worker.ts:344-359`) and stop the RTH
  wakeup from forcing rescans. Suppressing the toast / widening dedupe = bandaid.
- **⚠ PRODUCT QUESTION (blocks the fix):** the `overnight_plus_day` profile (`overnight-spot-automation.ts:648`)
  suggests some overnight deployments may intentionally trade the day session — gate must check the **profile**, not blanket-skip.
- **DECISION (2026-06-23, riley):** ALL overnight-spot deployments are dormant during RTH — **blanket-skip `runActions`
  during RTH regardless of profile**; `overnight_plus_day` is NOT meant to trade the live day session. (Not yet implemented; deferred to a later pass — this session started with #1/#5.)

## Cleared / don't re-flag
- #2 quotes — the await-all-symbols snapshot redundancy is **already fixed** and present in current code
  (`platform.ts:4970-4996`); snapshot path is correct, **do not touch it**. Residual minor: per-request zod
  re-parse on cache hits (`routes/platform.ts:2162-2167`) + per-frame WS subscriber fan-out
  (`massive-stock-websocket.ts:316-342`) — bounded, not the multi-second cause.

## Caveats (epistemic honesty)
- "101–102% CPU", "eventLoopP95 256ms", "9.4s p50" are **observed runtime**, not pinned in source — confirm
  with live telemetry / a profiler before claiming a specific number in any fix PR.
- All 7 workflow findings + #8 were independently skeptic-verified `holdsUp=true, presentInCurrentCode=true`.

## How to work here (constraints)
- LIVE trading app, remote shared Postgres (`PGHOST=helium`), **market currently open (RTH)**.
- Trading-logic / server hot-path changes → **branch + regression test + human review, never auto-merge**;
  markets-open caution for anything heavy. Destructive DB ops are classifier-blocked → run as user.
- Tests: `cd artifacts/api-server && node --import tsx --test src/services/<file>.test.ts`;
  typecheck `pnpm --filter @workspace/api-server run typecheck`.
- Do NOT touch `.replit`, `artifacts/*/.replit-artifact/artifact.toml`, dev scripts, `scripts/reap-dev-port.mjs`
  without `pnpm run audit:replit-startup`.
