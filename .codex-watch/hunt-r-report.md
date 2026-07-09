# HUNT-R Retry / Feedback Loop Report

Scope: HUNT-R only. Read-only source audit except this report file.

## Findings

1. `artifacts/api-server/src/providers/schwab/trader-api-client.ts:108` | P1 | Schwab broker/order HTTP has no timeout, abort signal, or circuit breaker

Evidence: `request()` builds `const init: RequestInit = { method, headers }` at lines 108-114 and calls `this.fetchImpl(...)` at lines 120-125 with no `signal` or timeout wrapper. The live preview/submit route path awaits this client directly (`schwab-equity-orders.ts:439-440`, `:466-467`; `routes/broker-execution.ts:410-414`).

Consequence: A hung Schwab Trader API request can pin an API request indefinitely; on submit, the user can be left without a bounded "unknown/reconcile" state, and repeated user retries can stack broker-provider calls.

Laziest fix: Add a per-request AbortController timeout and a small provider backoff/circuit in `SchwabTraderApiClient.request`, then have order submit surface timeout as "unknown/reconcile required" instead of encouraging blind retry.

Confidence: 0.86

2. `artifacts/pyrus/src/features/platform/live-streams.ts:653` | P2 | Option quote REST fallback poller can overlap slow quote requests

Evidence: Shared fallback fires `requestSharedOptionQuoteRestSnapshot(demand)` immediately and every 3s at lines 652-655; the async request awaits `getOptionQuoteSnapshots(...)` at lines 600-617 with no in-flight guard. The hook-local fallback repeats the same pattern at lines 7290-7303 and 7337-7340.

Consequence: When the WebSocket path is down and `/options/quotes` is slow, each tab can issue overlapping quote snapshot requests, amplifying the exact option-data saturation the fallback is meant to survive.

Laziest fix: Track one in-flight REST fallback request per demand/signature, skip ticks while it is pending, and optionally abort stale fallback requests on unmount/signature change.

Confidence: 0.91

3. `artifacts/pyrus/src/features/platform/live-streams.ts:658` | P2 | Shared option quote WebSocket reconnects on a fixed 1s cadence with no cap or jitter

Evidence: `OPTION_QUOTE_WEBSOCKET_RECONNECT_MS` is `1_000` at line 344; `scheduleSharedOptionQuoteWebSocketReconnect` always restarts after that fixed delay at lines 658-672. Close handling schedules reconnect both before and after readiness at lines 812-829, with no exponential backoff and no failover after repeated failures.

Consequence: During an API/WebSocket outage, every open browser can redial once per second, producing a reconnect storm against `/api/ws/options/quotes`.

Laziest fix: Reuse the capped exponential/jittered policy used by quote SSE (`quoteStreamReconnect.ts`) and switch to REST fallback after repeated pre-ready closes.

Confidence: 0.88

4. `artifacts/pyrus/src/features/platform/live-streams.ts:7491` | P2 | Hook-local option quote WebSocket redials every 1s after ready-close

Evidence: The local option quote hook falls back to REST before readiness, but after a ready socket closes it unconditionally schedules `setTimeout(startWebSocket, 1_000)` at lines 7474-7492. The reconnect timer is cleared on cleanup (lines 7498-7503), but there is no cap/jitter while the hook remains mounted.

Consequence: A deployed page with several option quote hooks can sustain 1s reconnect loops during a persistent mid-session socket failure.

Laziest fix: Replace the fixed `1_000` with capped exponential backoff plus reset-on-message/open, and coordinate with the shared stream where possible.

Confidence: 0.83

5. `artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.jsx:1704` | P3 | IBKR portal popup status polling overlaps slow status calls

Evidence: The IBKR portal popup watcher uses `window.setInterval(async () => { ... await getIbkrPortalStatus(); ... }, 3000)` at lines 1704-1733 with no in-flight flag. The generated `getIbkrPortalStatus` is a GET through `customFetch` (`lib/api-client-react/src/generated/api.ts:4280-4288`), and GETs have a 20s default timeout (`custom-fetch.ts:36-43`, `:474-515`).

Consequence: If the portal/gateway status endpoint is slow, one popup can have several overlapping status probes before the first timeout, and multiple users reconnecting can multiply that pressure.

Laziest fix: Replace the interval with a self-scheduling async poll that waits for settle, or add an `ibkrStatusPollInFlight` guard.

Confidence: 0.82

6. `artifacts/api-server/src/services/diagnostics.ts:4949` | P3 | Diagnostics collector interval can start a new collection before the prior one settles

Evidence: `tick()` launches `collect().then(...).catch(...)` without awaiting or checking in-flight state at lines 4949-4965, and `setInterval(tick, intervalMs)` schedules it repeatedly at lines 4968-4970. There is no local `collectorInFlight` guard in this scheduler.

Consequence: During slow diagnostics collection, snapshots/events can overlap and add background DB/logging load while the system is already degraded.

Laziest fix: Add a single in-flight guard or switch to self-scheduling after `collectDiagnosticSnapshot` settles.

Confidence: 0.79

7. `artifacts/backtest-worker/src/index.ts:289` | P3 | Direct Massive backtest fetch retries are capped but have no per-attempt timeout

Evidence: `fetchMassiveDirectJson` loops over capped retry attempts at lines 289-301, but each attempt is `await fetch(url)` at line 291 without an AbortController/timeout. The worker loop awaits job processing serially (`index.ts:3267-3275`).

Consequence: A hung provider TCP/request can stall the backtest worker indefinitely before retry logic ever runs, blocking subsequent queued studies.

Laziest fix: Wrap each direct Massive fetch attempt with `AbortSignal.timeout(...)` or a local AbortController and classify timeout as retryable within the existing capped loop.

Confidence: 0.76

## Coverage Note

Reviewed retry/reconnect/polling/queue patterns in `artifacts/api-server/src`, `artifacts/pyrus/src`, `artifacts/backtest-worker/src`, `lib`, and `crates/market-data-worker`. Excluded guarded/capped paths after line checks: signal monitor local bar warmup and server producer in-flight guards, signal options worker self-scheduling/active scan guards, overnight scan timeout active-hold behavior, market-data worker delayed `next_run_at` retry, backtest job max-attempt recovery, and quote/signal-matrix SSE capped reconnect helpers. No runtime probes or tests were run.
