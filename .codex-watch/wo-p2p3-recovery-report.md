# WO-P2P3-RECOVERY Report

Scope: read-only re-review of `artifacts/api-server/src`, `artifacts/pyrus/src`, `artifacts/backtest-worker/src`, and `lib/`.

Exclusions applied: P1 items; findings already tracked in `docs/plans/2026-07-08-review-session-findings-plan.md` Phase 1/1b/1c/2/4/5; and files/items observed as fixed in `git log 7a517820..HEAD`.

## Money Math / Minor Correctness

`artifacts/backtest-worker/src/index.ts:2145` — P2 — money math / walk-forward metrics — `mergeWindowMetrics` averages percent/ratio metrics equally across windows — The function sums `netPnl` and `tradeCount`, but it computes `totalReturnPercent`, `winRatePercent`, `profitFactor`, `sharpeRatio`, and `returnOverMaxDrawdown` by adding each window's metric divided by `results.length`; a one-trade test fold therefore has the same weight as a much larger fold, and win rate/profit factor are not recomputed from aggregate wins/losses or weighted by trade count. — confidence 0.84

## Perf / Duplicated Work / Concurrency

`artifacts/backtest-worker/src/index.ts:2334` — P3 — concurrency / sweep load — Walk-forward sweep windows run with no per-candidate window concurrency cap — The sweep batches candidates by `MAX_PARALLEL_SWEEP_RUNS`, but inside each candidate it runs `Promise.all(windows.map(... executeStudyRun ...))`; a batch of 4 candidates with many walk-forward windows multiplies CPU/data-slice work beyond the configured candidate cap. — confidence 0.76

`artifacts/pyrus/src/screens/DiagnosticsScreen.jsx:959` — P3 — overlapping polls / stale UI — Diagnostics history/event refreshes can overlap and race — `loadHistoryAndEvents` starts two requests, catches failures silently, and is invoked immediately plus every 60s with no in-flight guard or generation token; a slower older response can overwrite newer `historyData`/`events`, while failures leave stale state with no visible error. — confidence 0.80

`artifacts/pyrus/src/screens/DiagnosticsScreen.jsx:1009` — P3 — overlapping polls / telemetry waste — Browser metrics collection can overlap and post duplicate samples — The effect calls `collectBrowserResourceMetrics(...).then(postClientMetrics)` immediately and every 30s with only a cancellation flag; if collection or posting stalls past the interval, the next sample starts anyway and the post promise is not awaited by the scheduler. — confidence 0.70

`artifacts/pyrus/src/features/platform/performanceMetrics.ts:257` — P3 — frontend lifecycle / listener retention — Global API timing listener is removed only on `beforeunload` — `installPyrusPerformanceMetrics` installs `handleApiTiming` once and the hook cleanup removes only reporter intervals/listeners; in HMR, remount, or test lifecycles the API timing listener and long-task observer remain until page unload because `metrics.installed` stays true. — confidence 0.62

## Silent Failures / Dropped Signals

`artifacts/api-server/src/routes/platform.ts:1197` — P3 — silent failure / repeated DB work — Sparkline seed history warm failures are swallowed — The background warm path caches negative misses only after `loadStoredMarketBarsBySymbol` succeeds; if the backfill rejects, `.catch(() => {})` emits no warning/diagnostic and no negative cache entry, so the same cold symbols can re-trigger DB work on later seed requests. — confidence 0.78

`artifacts/api-server/src/providers/fmp/client.ts:830` — P3 — silent partial data loss — FMP high-beta screener drops whole exchange failures without telemetry — `Promise.all(exchanges.map(... .catch(() => [])))` converts a failed NASDAQ/NYSE/AMEX fetch into an empty list, so the caller receives a plausible but incomplete candidate universe with no diagnostic that an exchange slice is missing. — confidence 0.74

## Unbounded Growth / Cache Semantics

`artifacts/api-server/src/services/platform.ts:5070` — P3 — unbounded cache growth — Quote snapshot cache has no max entries and prunes only on successful refreshes — Keys include arbitrary symbol sets, owner, intent, and session; expired entries are removed only by `pruneQuoteSnapshotCache` in the `.then` path after a successful refresh, so high-cardinality requests can retain one stale entry per symbol-set for the stale TTL, and refresh-failure periods skip pruning entirely. — confidence 0.70

`artifacts/api-server/src/services/account.ts:393` — P3 — unbounded cache growth — SnapTrade/Robinhood balance caches and error-suppression maps never evict expired keys — The generic account route cache prunes expired entries on read, but `snapTradeAccountBalanceCache`, `robinhoodAccountBalanceCache`, and their `ErrorLogSuppressedUntil` maps are keyed by account id and only check TTL on reads/sets; old accounts remain in the process maps indefinitely. — confidence 0.82

`artifacts/api-server/src/ws/options-quotes.ts:214` — P3 — backpressure / stale stream state — Option quote WS accepts pending quotes for IDs outside the active subscription set — `enqueueQuotes` inserts any payload `providerContractId` into `pendingQuotesByProviderContractId`, while priority is only assigned for `currentProviderContractIds`; after resubscribe, `unsubscribe()` is called but pending quotes are not cleared there, and stale/extra upstream IDs sort to `Number.MAX_SAFE_INTEGER`, wasting degraded batch slots and potentially keeping unrelated pending keys alive until flushed. — confidence 0.72

## Retry / Timeout / Feedback

`artifacts/api-server/src/providers/robinhood/mcp-client.ts:89` — P2 — timeout / live broker feedback — Robinhood MCP requests have no local abort or timeout — `post` awaits `fetchImpl(this.mcpUrl, ...)` without an `AbortSignal`, and live call sites such as account sync/history/portfolio balance await `session.callTool`; a hung MCP endpoint can hang those user-facing broker operations until the underlying runtime/network stack gives up. — confidence 0.88

## Test Integrity

`artifacts/pyrus/src/screens/AlgoScreen.test.mjs:7` — P3 — test integrity — Algo screen regressions are guarded by source-text regexes instead of behavior — The file reads `AlgoScreen.jsx` and asserts constants, hook call shapes, and string absence/presence; a dead branch or incorrectly wired mutation can still pass if the text remains, while a behavior-preserving refactor can fail. — confidence 0.86

`artifacts/pyrus/src/screens/settings/SnapTradeConnectPanel.source.test.mjs:18` — P3 — test integrity — SnapTrade connect behavior is largely source-sliced — The tests assert text such as `canManageSnapTradeConnections`, `openBrokerPopup`, QR/copy-link strings, and memo source fragments instead of rendering the panel and exercising the connect/sync states, so reachable UI behavior is not proven. — confidence 0.84

`artifacts/api-server/src/routes/automation-route-timeout.test.ts:8` — P3 — test integrity — Signal Options route timeout test asserts route source shape, not abort behavior — The test slices `automation.ts` and matches timeout constants plus `withAbortableSignalOptionsRouteTimeout`; it does not issue a request with a hung scan/action, so the route could fail to abort at runtime while preserving the strings. — confidence 0.78

`artifacts/api-server/src/services/algo-gateway.test.ts:68` — P3 — test integrity — Algo gateway latency guard checks call text instead of the hot-path behavior — The regression guard reads `algo-gateway.ts`/`platform.ts` and asserts absence of `getRuntimeDiagnostics(` and presence of `getRuntimeBridgeHealthState()`; an indirect heavy dependency or alias would bypass the guard, and the test does not measure or stub the actual readiness path. — confidence 0.76

`artifacts/api-server/src/services/platform-universe-logos.test.ts:19` — P3 — test integrity — Universe logo bounds are protected by regexes over implementation text — The test matches constants and `mapWithConcurrency`/`createAbortBudgetSignal` strings in `platform.ts`, not concurrent behavior under slow providers, so a wiring error can survive if the matched code remains nearby. — confidence 0.68

`artifacts/pyrus/src/features/platform/tickerSearch/TickerSearch.source.test.mjs:10` — P3 — test integrity — Ticker search provider labeling is source-text only — The tests read `TickerSearch.jsx` and match label/provider snippets; they do not render results with different provider arrays, so incorrect label behavior can pass if the strings remain. — confidence 0.70

`artifacts/pyrus/src/screens/AccountScreen.positions.test.mjs:7` — P3 — test integrity — Account positions wiring tests assert JSX source fragments rather than interactive state — The tests match `<PositionsPanel .../>` props and count `liveQuotes: true` occurrences in source; a render path can still pass while hidden by conditions, stale props, or a component API mismatch. — confidence 0.77

`artifacts/api-server/src/services/market-data-store.test.ts:117` — P3 — test integrity — Market-data store batching guards assert source text for writer shape — Several tests slice `market-data-store.ts` and match `ensureStoreInstruments`, batch constants, and conflict-target text instead of driving the writer with a fake DB and asserting query count/chunking behavior, so call-shape drift can evade or falsely trip the guard. — confidence 0.72

`artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts:381` — P3 — test integrity — Signal monitor memo scoping is partly verified by source order — The test reads `signal-monitor.ts`, locates function names by `indexOf`, and checks for `withSignalMonitorStreamSourceMinuteBarsMemo` in slices; it does not prove both stored-state readers share one memo during execution, only that the token appears in the expected text region. — confidence 0.71
