# Backend Resilience Catalogue — backoffs / timeouts / fallbacks / loadsheds (+ what those four words miss)

**Goal:** label every backend backoff/timeout/fallback/loadshed in the UI with a red "!" so they're easy to find.
**This doc is step 1: the catalogue.** No code changed.

**Scope (per request):** *everything backend, all keyword matches.*
- `artifacts/api-server/src` (191 files)
- `artifacts/ibkr-bridge/src` (14 files)
- `artifacts/backtest-worker/src` (6 files)

**Method:** 5 parallel sweep agents (one per resilience family + one dedicated to patterns the four keywords would miss), then anchor-signal verification by grep. Line numbers are as-of-sweep and may drift; treat file + symbol as the durable anchor.

**Status legend for each row:**
- `observed` = confirmed in source by grep during verification.
- `swept` = surfaced by the catalogue sweep, file/symbol reliable, exact line approximate.

---

## 0. TL;DR for the UI phase (read this first)

The single most useful finding for the red-"!" work: **the backend already emits most degradation as structured runtime signals.** You mostly need to *surface* existing fields, not add new instrumentation. The four signal "buses" a UI marker can hook into:

| Signal bus | Shape | Where it's produced | UI hook |
|---|---|---|---|
| **`degraded` / `stale` + `reason` on payloads** | `{ degraded: true, stale: true, reason: "orders_backoff", backoffRemainingMs }` | `platform.ts` (orders, option chart, bars), `tws-provider.ts` (open orders, quotes) | red "!" on the affected card/row + reason tooltip |
| **Bridge pressure state** | `"normal" \| "degraded" \| "backoff" \| "stalled"` per lane | `ibkr-bridge/work-scheduler.ts`, `bridge-governor.ts` | global broker-health "!" badge |
| **HTTP error codes** | `429 ibkr_bridge_lane_queue_full`, `503 ibkr_bridge_lane_backoff`, `504 *_timeout` | bridge governor + lane scheduler + route timeouts | "!" wherever the failing request's data renders |
| **API resource-pressure level** | `"normal" \| "watch" \| "high"` (+ feature caps) | `resource-pressure.ts`, `readiness.ts` | app-level "!" when `high` |

Pre-existing supporting infra (already in repo, reuse it):
- `services/sse-stream-diagnostics.ts` — `write_backpressure_timeout` reason `[observed]`
- `services/platform-option-degraded-reasons.test.ts` — option degraded-reason coverage already tested `[observed]`
- `services/flow-events-model.ts` — `fallbackUsed: boolean` + `FlowSourceStatus = "live"|"fallback"|"empty"|"error"` `[observed]`
- `services/resource-pressure.ts` — `ApiResourcePressureLevel` `[observed]`

**Decision the UI phase needs:** the catalogue below contains ~140 instances spanning *user-visible degradation* (orders go stale, quotes fall back, options backoff) down to *internal plumbing* (keepalive tickle swallows errors, SSE coalesce windows). Not all of these should get a red "!" — a coalesce timer firing is normal operation, not a problem. See §7 for the proposed cut line.

---

## 1. Backoffs & retries

### Reconnect with exponential backoff (1s→30s) — stream layer
| file:line | symbol | trigger | UI-observable signal | status |
|---|---|---|---|---|
| api-server/src/services/bridge-quote-stream.ts:128,757 | `scheduleReconnect` / `RECONNECT_DELAY_*` | quote stream disconnect or 45s stall watchdog | `reconnectCount`, `reconnectScheduled`, pressure="reconnecting" | swept |
| api-server/src/services/bridge-option-quote-stream.ts:140,946 | `scheduleReconnectForChunk` | per-chunk option quote stream error | per-chunk `reconnectAttempt` | swept |
| api-server/src/services/massive-stock-websocket.ts:35,232 | `scheduleReconnect` | Massive WS close / auth_failed / provider error | `reconnectCount`, `lastError`, `lastErrorAt` | swept |
| api-server/src/services/bridge-streams.ts:61,148,1019 | `nextReconnectDelay` | bridge work backoff or stream error | `reconnectAttempt` | swept |
| ibkr-bridge/src/app.ts:157,718,1329 | `nextStreamRetryDelayMs` | TWS quote/bars SSE stream error | client-visible SSE `retry: <ms>` header | swept |

### Circuit-breaker backoff (failure-threshold → timed cooldown)
| file:line | symbol | trigger | UI-observable signal | status |
|---|---|---|---|---|
| api-server/src/services/bridge-governor.ts:63,247,287 | `recordFailure` / `isBridgeWorkBackedOff` | failureCount ≥ threshold; per-category 2–45s | **429 `ibkr_bridge_work_backoff`**, `backoffRemainingMs` | observed |
| ibkr-bridge/src/work-scheduler.ts:77,340,523 | `recordLaneFailure` / `isBackedOff` | lane failureCount ≥ threshold; per-lane 5–45s | **503 `ibkr_bridge_lane_backoff`**, pressure="backoff" | observed |

### Transient PostgreSQL backoff (~60s window, shared helper)
`createTransientPostgresBackoff()` in `lib/transient-db-error.ts`, instantiated per subsystem:
| file:line | symbol | gated operation | status |
|---|---|---|---|
| api-server/src/services/shadow-account.ts:194 | `shadowAccountDbBackoff` | shadow account reads → degraded | swept |
| api-server/src/services/account.ts:266 | `accountSnapshotPersistenceBackoff` / `…ReadBackoff` | account snapshot read/write | swept |
| api-server/src/services/option-metadata-store.ts:368 | `durableOptionMetadataBackoffEntry` | option metadata store | swept |
| api-server/src/services/automation.ts:55 | `deploymentListDbBackoff` (15s) | deployment list | swept |
| api-server/src/services/pine-scripts.ts:57 | `pineScriptsDbBackoff` | pine script ops | swept |
| api-server/src/services/platform.ts:709 | `watchlistDbBackoff` | watchlist → reason `list-stale-db-backoff` | swept |

### Option-upstream backoff (long, user-visible)
| file:line | symbol | trigger | UI-observable signal | status |
|---|---|---|---|---|
| api-server/src/services/platform.ts:10879,14551 | `recordOptionUpstreamBackoff` / `getOptionUpstreamBackoffRemainingMs` | option chain/expiration empty or error; 60s | **reason `options_backoff`**, `backoffRemainingMs` | observed |
| api-server/src/services/signal-options-automation.ts:242,11997 | `readSignalOptionsContractPreviewBackoff` | contract preview timeout; 60s | reason `contract_preview_backoff`, `retryAfterMs` | swept |
| api-server/src/services/flow-universe-optionability-verifier.ts:136 | `DEFAULT_BACKOFF_MS` (300s) | all option-chain lookups in batch fail | `error-backoff` state in result | swept |

### Bounded job/request retries (count-based, no/short delay)
| file:line | symbol | limit | status |
|---|---|---|---|
| api-server/src/services/market-data-ingest.ts:65 | `INGEST_JOB_DEFAULT_MAX_ATTEMPTS` | 3 | swept |
| api-server/src/services/account.ts:197,3033 | `FLEX_REFERENCE_MAX_ATTEMPTS` (retryable codes 1001/1002/1018) | configurable | swept |
| api-server/src/index.ts:217,220 | `ensureDefaultSignalOptionsPaperDeploymentWithRetry` | 15s→120s startup seed retry | swept |
| api-server/src/services/signal-options-automation.ts:191,11468 | `getSignalOptionsCandidateExpirationsWithRetry` | 30s budget @ 750ms | swept |
| api-server/src/services/overnight-spot-worker.ts:28 | `FAILED_DEPLOYMENT_RETRY_MS` / `…RESOURCE_PRESSURE_RETRY_MS` | 60s / 30s | swept |
| ibkr-bridge/src/tws-provider.ts:3081 | `ensureHistoricalDataWithRetry` | `IBKR_HISTORICAL_RECONNECT_MAX_RETRIES`, 250·attempt cap 1s | swept |
| backtest-worker/src/runtime.ts:18 + index.ts:2154 | `MAX_JOB_ATTEMPTS` / `recoverStaleJobs` | 2 attempts then mark failed | swept |
| api-server/src/services/platform.ts:8543,10268 | `BARS_BROKER_BACKFILL_EMPTY_RETRY_DELAY_MS` | empty-bars retry chain | swept |
| api-server/src/services/platform.ts:10895,15106 | `OPTION_CHAIN_EMPTY_RETRY_DELAYS_MS` `[250,750]` | empty option chain | swept |

---

## 2. Timeouts & deadlines

### Route / request timeouts → 504 (user-visible)
| file:line | symbol | budget | signal | status |
|---|---|---|---|---|
| api-server/src/routes/automation.ts:31,76 | `withAbortableSignalOptionsRouteTimeout` | 45s shadow-scan / 30s overnight-spot | 504 `signal_options_route_timeout` | swept |
| api-server/src/services/gex.ts:189,516,551 | `GEX_*_TIMEOUT_MS` | env-driven | 504 "GEX … timed out" | swept |
| api-server/src/providers/ibkr/client.ts:1050 / bridge-client.ts:662 | `requestJson` | `requestTimeoutMs` | 504 "IBKR … timed out after Nms" | swept |
| api-server/src/services/ibkr-async-sidecar-client.ts:17 | `DEFAULT_REQUEST_TIMEOUT_MS` (30s) | per-request | 504 sidecar timeout | swept |
| api-server/src/services/python-compute.ts:468,513,540 | deadline loop + fetch abort | 10s/job, 15s startup | "Python compute … timed out" | swept |
| api-server/src/services/options-flow-scanner.ts:464,471 | `getScanTimeoutMs` | env-driven | "timed out" error | swept |
| api-server/src/services/ibkr-line-usage.ts:73,76,77 | lane/gen apply timeouts | 1.5s / 30s / 2.5s | 504 in diagnostics | swept |
| ibkr-bridge/src/work-scheduler.ts:488,558 | lane queue + run timeout | per-lane 5–45s | 504 `ibkr_bridge_lane_timeout`, `timedOut` counter | observed |
| ibkr-bridge/src/app.ts:247,406 | `proxyAsyncSidecarJson` | 30s | 502 sidecar proxy fail | swept |

### Timeout → fallback (don't fail, serve degraded/stale)
| file:line | symbol | budget | signal | status |
|---|---|---|---|---|
| api-server/src/services/historical-flow-events.ts:68,163 | `storeReadWithTimeout` | 3s/4s/8s | `timedOut` flag → default/stale | swept |
| api-server/src/services/ibkr-account-bridge.ts:91,162,257 | `waitForFallback` + `Promise.race` | initial-wait | returns cached/stale account | swept |
| api-server/src/services/platform.ts:1959,1967,1985 | flow premium distribution timeouts | first-paint / deep candidate | partial → shallow fallback | swept |
| api-server/src/services/bridge-quote-stream.ts:144 | `SNAPSHOT_BOOTSTRAP_TIMEOUT_MS` (2.5s) | initial snapshot abort | `lastError` set | swept |

### Stall / liveness watchdogs (setInterval)
| file:line | symbol | window | signal | status |
|---|---|---|---|---|
| api-server/src/services/bridge-quote-stream.ts:139,713 | `STREAM_STALL_RECONNECT_MS` (45s, checked ~22.5s) | quote silence | `staleReconnectCount`, `lastStallReason` → reconnect | swept |
| api-server/src/services/platform.ts:1948 | `HISTORICAL_FLOW_TIMEOUT_COOLDOWN_MS` (30s) | post-timeout cooldown | next-retry scheduled | swept |

### SSE drain timeout (backpressure → close)
| file:line | symbol | budget | signal | status |
|---|---|---|---|---|
| api-server/src/routes/platform.ts:381,1233,1250 | `SSE_DRAIN_TIMEOUT_MS` | 5s | closeReason `write_backpressure_timeout` | observed |
| ibkr-bridge/src/sse-writer.ts:6 | `DEFAULT_DRAIN_TIMEOUT_MS` (5s) | drain wait | close "did not drain in time" | swept |

---

## 3. Fallbacks & degraded modes

### Stale/last-known-good served to client (highest UI value)
| file:line | symbol | trigger | signal | status |
|---|---|---|---|---|
| api-server/src/services/platform.ts:2865,2956,3224 | `buildDegradedOrders` / `readOpenOrders` | order read timeout / backoff / error | **`degraded:true, stale:true, reason`** (`orders_backoff`/`orders_cached_stale`) | observed |
| api-server/src/routes/platform.ts:548,570 | `readCachedOptionChartBarsRouteResult` | option chart fetch fail/timeout | `stale:true, degraded:true, reason:"option_chart_stale_fallback"` | swept |
| api-server/src/services/platform.ts:9074 | `readOrCacheBarResult` (`allowStale`) | fresh bars timeout/error | `ageMs`, stale flag | swept |
| ibkr-bridge/src/tws-provider.ts:2361,2394 | `getAllOpenOrderSnapshots` | open-orders poll timeout/error | `degraded:true, stale:true, reason:"open_orders_timeout"/"open_orders_error"` | swept |
| ibkr-bridge/src/service.ts:207,226 | `probeConnection` catch | health probe fail | `connection:{stale:true, bridgeReachable:false}` | swept |

### Provider failover (IBKR → Massive → cache)
| file:line | symbol | signal | status |
|---|---|---|---|
| api-server/src/services/flow-events-model.ts:5,10,208 | `FlowSourceStatus` / `fallbackUsed` / `flowEventsSourceUsesMassiveFallback` | `fallbackUsed:boolean`, status `live\|fallback\|empty\|error` | observed |
| api-server/src/services/market-data-admission.ts:1288,2053 | `fallbackProvider` (`none\|cache\|massive`) | per-lease fallback provider in diagnostics | swept |

### catch → default/empty (error swallowed into a value)
| file:line | symbol | returns | status |
|---|---|---|---|
| api-server/src/services/user-preferences.ts:131,187 | `readSnapshot`/`updateSnapshot` | file/defaults, `source:"fallback"` | swept |
| api-server/src/services/account.ts:833,1188 | `withOptionalAccountSchemaFallback` / `listAccounts` | live-only fallback / empty `[]` | swept |
| api-server/src/services/research.ts:102,120,126 | `getResearchSnapshot(s)` | null financials / empty quotes | swept |

### Best-effort / partial stream (skip failed items)
| file:line | symbol | behavior | status |
|---|---|---|---|
| ibkr-bridge/src/tws-provider.ts:5053,5082 | `getQuoteSnapshots` / `getOptionActivitySnapshots` | fall back to snapshot quote; `compact()` drops null symbols silently | swept |

---

## 4. Load shedding / throttle / rate-limit / backpressure

### Load shedding (drop work under pressure)
| file:line | symbol | trigger | signal | status |
|---|---|---|---|---|
| api-server/src/services/market-data-admission.ts:289,493 | `shedFlowScannerLeasesForIbkrPressure` ("one-shot-scanner-shed") | IBKR pressure="backpressure"/"capacity_limited" | demoted lease count + "demoted" events | swept |
| api-server/src/services/market-data-admission.ts:150,1663 | `INTENT_PRIORITY` / `preemptLeasesForIntent` | high-priority admit into full pool | evicted reason `preempted_by_execution` | swept |
| api-server/src/ws/options-quotes.ts:164 | `flushQuotes` highBufferedAmountCount | bufferedAmount ≥5MB ×3 | socket close "not draining fast enough" | swept |

### Rate limiting
| file:line | symbol | limits | signal | status |
|---|---|---|---|---|
| api-server/src/services/ibkr-historical-admission.ts:52,191,398 | `admitHistoricalRequest` | concur 50, queue 50, 50 req/s, weighted 10-min window, per-contract 2s | 429 + reason + `waitMs`, family stats | swept |
| api-server/src/routes/platform.ts:749 | `BARS_BATCH_MAX_REQUESTS` | 72/batch, 240 sparkline pts | 400 + reason | swept |

### Concurrency / line / symbol caps
| file:line | symbol | caps | status |
|---|---|---|---|
| api-server/src/services/ibkr-lane-policy.ts:136,560 | `resolveIbkrLaneSymbols` maxSymbols | equity 200 / option 80 / flow-scanner 600 / historical 60 / option-meta 100 → dropped reason `capacity` | swept |
| api-server/src/services/market-data-admission.ts:398 | per-pool line caps | automation 40 / execution 60 / account-monitor 10 / visible 80 / flow-scanner 20 | swept |
| ibkr-bridge/src/work-scheduler.ts:17,418 | `acquireLane` concurrency+queueCap | control concur 1 / option-quotes concur 8 queue 32 | 429 `ibkr_bridge_lane_queue_full` / `…_preempted` | observed |
| ibkr-bridge/src/runtime-limits.ts:9 + tws-provider.ts:2477,2697 | line budgets / `limitSymbolsForBudget` | equity/option/total budgets; drops over-budget subs | swept |
| ibkr-bridge/src/subscription-budget.ts:14 | `limitValuesByBudget` | kept/dropped split | swept |
| backtest-worker/src/runtime.ts:19 | `MAX_PARALLEL_SWEEP_RUNS` | 4 | swept |

### Backpressure / coalescing / sampling (mostly normal-operation, see §7)
| file:line | symbol | window | status |
|---|---|---|---|
| api-server/src/routes/platform.ts:376,1216 | `SSE_MAX_BUFFERED_CHUNKS` (256) → close slow client | swept |
| api-server/src/ws/options-quotes.ts:20,176,188 | `DEGRADED_*` → batch to 100 when buffered ≥1MB, `reason:"buffered_amount_degraded"` | swept |
| ibkr-bridge/src/sse-writer.ts:25,73 | `DEFAULT_MAX_BUFFERED_CHUNKS` (256) + drain | swept |
| ibkr-bridge/src/runtime-limits.ts:84 + tws-provider.ts:2060,2599 | `genericTickSampleMs` (500ms), `quoteEmitCoalesceMs` (20ms) `drainQuoteEmits` | swept |

---

## 5. Beyond the four keywords — what "backoff/timeout/fallback/loadshed" would have MISSED

These are the patterns you asked me to also hunt for. They are degradations that won't show up grepping the four words.

### Circuit breakers / pressure aggregation
- `ibkr-bridge/work-scheduler.ts:614` `getBridgePressureState` — aggregates `stalled > backoff > degraded > normal` across lanes `[swept]`
- `api-server/services/massive-stock-websocket.ts:279` auth_success **resets** `reconnectAttempt` to 0 (breaker reset) `[swept]`

### Health gates (block work when a dependency is unhealthy)
- `api-server/services/readiness.ts:61,145,168` `buildBrokerReadiness`/`buildAppReadiness` — `ready=false` with reasons `broker_health_stale`, `broker_stream_stale`; app `degraded` when pressure `high` `[swept]`
- `api-server/services/resource-pressure.ts:3,215` `ApiResourcePressureLevel` + `getApiResourcePressureCaps` — caps signals/scans at `high` `[observed]`
- `api-server/services/storage-health.ts:8,102,185` — DB `ok|degraded|unavailable`, write-verify round-trip `[swept]`
- `ibkr-bridge/tws-provider.ts:2075,2187,4571` `serverConnectivity`, data-fetch health probe, strict readiness `strictReason` `[swept]`
- `api-server/services/gex-projection.ts:673` marks expirations `unavailable` on missing spot/rate/dividend `[swept]`

### Reconnect / heartbeat / keepalive
- `api-server/routes/marketing.ts:14,194` SSE heartbeat 20s `: ping`, `retry: 5000` `[swept]`
- `ibkr-bridge/tws-provider.ts:2161,2885,3012` connectionState subscription + reconnection loop + logging `[swept]`
- `api-server/services/massive-stock-quote-stream.ts:263` transport re-subscribe when consumers return `[swept]`

### Error swallowing (failures hidden as no-ops — these are INVISIBLE today)
- `ibkr-bridge/tws-provider.ts:2168,2243` `void tickle().catch(()=>{})`, keepalive refresh swallow `[swept]`
- `api-server/services/shadow-account-streams.ts:134` polling catch → `logger.warn`, continue `[swept]`
- `api-server/services/ibkr-connection-audit.ts:280,332,428` empty `catch {}` on probe failures `[swept]`

### Stale-while-revalidate / TTL serving stale
- `api-server/services/shadow-account-streams.ts:15,174` `SHADOW_ACCOUNT_SNAPSHOT_TTL_MS` (15s), serves cached during in-flight refresh `[swept]`
- `api-server/services/massive-stock-websocket.ts:300` per-channel `lastDataMessageAgeMs` staleness `[swept]`
- `backtest-worker/runtime.ts:17` `JOB_STALE_AFTER_MS` (60s) zombie-job detection `[swept]`

### Skip / bail guards (work silently not done)
- `api-server/services/flow-universe-optionability-verifier.ts:490,532` `recordSkip` + early-return guards, `skipped`/`skippedReason` `[swept]`
- `api-server/services/account-risk-model.ts:280` `skippedPositions` + `skipped.missingSpot/MarkPrice/ContractData/GreekSnapshot` `[swept]`
- `api-server/routes/automation.ts:282` `skipActionWork` when degraded `[swept]`
- `api-server/services/overnight-spot-automation.ts:623,670` skip if disabled / signal-stale / quote-stale `[swept]`

### Kill switches / feature gating
- `api-server/services/resource-pressure.ts:215` feature caps under `high` pressure `[observed]`
- `api-server/services/overnight-spot-automation.ts:21,468` `OvernightSpotBlockReason` (`*_disabled`, `*_signal_stale`), `executionMode="disabled"` `[swept]`
- `api-server/services/bridge-order-read-state.ts:88` order-read suppression `[swept]`

### Graceful shutdown / drain
- `api-server/src/index.ts:194` `shutdownApi` — close-with-timeout, forced shutdown if exceeded `[swept]`
- `ibkr-bridge/src/app.ts:382` `setTimeout(process.exit, 300)` shutdown window `[swept]`

---

## 6. Counts (rough)

| Family | Distinct instances |
|---|---|
| Backoffs & retries | ~24 |
| Timeouts & deadlines | ~28 |
| Fallbacks & degraded | ~18 |
| Loadshed / throttle / backpressure | ~20 |
| Beyond-keyword (breaker/health/reconnect/swallow/stale/skip/kill/shutdown) | ~30 |
| **Total** | **~140** |

---

## SCOPE DECISION (locked)

- **In scope:** ALL tiers — Tier 1 (user-facing), Tier 2 (operational pressure), Tier 3 (normal plumbing), AND error-swallow cases.
- **Marker style:** per-widget (mark the specific affected card/row).
- **Implication:** Tier 1/2 are mostly *surfacing* existing `degraded`/`stale`/`reason`/error-code signals. Tier 3 + error-swallow require *new* instrumentation (silent sites emit nothing today; some have no natural widget). Next artifact needed: a backend-signal → frontend-widget mapping (§8, in progress).

---

## 7. Tiering reference (all now in scope — kept for prioritization)

Not all ~140 deserve a red "!". Three tiers emerged:

1. **User-facing degradation (clear red "!"):** orders/quotes/options/bars served stale or degraded, provider failover, route 504s, bridge backoff, resource pressure `high`. These already carry `degraded`/`stale`/`reason`/error codes — surfacing is straightforward.
2. **Operational pressure (maybe a subtler badge):** lane queue full, leases shed, reconnect-in-progress, DB backoff windows. Real, but transient and self-healing; a red "!" on every blip may cry wolf.
3. **Normal-operation plumbing (probably NOT a "!"):** quote coalesce (20ms), tick sampling (500ms), SSE heartbeats, graceful shutdown, bounded sweep concurrency. These are *designed* behaviors, not incidents.

**The two things I left out / want your call on:**
- **Error-swallow cases (§5)** are real degradations that emit *nothing* today (`catch(()=>{})`). If you want these flagged, that's genuine new instrumentation, not just surfacing — bigger lift than tiers 1–2.
- Whether the red "!" is **per-widget** (mark the orders card when orders are stale) or a **single global broker-health indicator** that aggregates pressure state. The data supports either.

→ Tell me which tier(s) are in scope and per-widget vs global, and I'll turn the in-scope rows into a concrete instrumentation/UI plan.

---

## 8. Backend signal → frontend widget mapping (grounded in real `pyrus` surfaces)

**Key finding:** the red-"!" primitive ALREADY EXISTS and is partly wired. `[observed]`
- `components/platform/FailurePointTooltip.jsx:203` `FailurePointInlineIcon` — renders `AlertTriangle` (red, severity=warning) / `CircleAlert` (amber, attention) + hover tooltip.
- `components/platform/DataIssueInlineIcon.jsx` — wraps it, summarizes N issues to "primary + X more".
- Model builders: `features/platform/failurePointModel.js`, `features/platform/dataIssueModel.js`.
- Already used in: TradeScreen, DiagnosticsScreen, MarketScreen, GexScreen, FlowScreen, SignalsScreen, account/PositionsPanel, algo/DiagPanel. `[observed]`

So the feature is mostly: **(a) make sure each backend signal reaches the frontend keyed to a widget, (b) attach `DataIssueInlineIcon` to widgets that lack one, (c) add instrumentation for the silent sites.**

| Widget (screen → component) | Backend signal(s) feeding it | Marker today | Work |
|---|---|---|---|
| Account → TradesOrdersPanel | `orders_backoff` / `orders_cached_stale` degraded/stale (platform.ts:2865+) | none confirmed | wire `DataIssueInlineIcon` from order payload `degraded/stale/reason` |
| Account → PositionsPanel | account snapshot read backoff (account.ts:882), schema fallback (account.ts:833), quote fallback | **has DataIssueInlineIcon** | verify it consumes account backoff reasons |
| Account → RiskDashboardPanel | `skippedPositions` + `skipped.missing*` (account-risk-model.ts:280) | none | surface coverage gaps as a data issue |
| Account → Equity/PnL/Allocation/Cash | transient DB backoff windows (account/shadow-account) | none | low priority (Tier 2) |
| Trade → Quote header | quote snapshot fallback (tws-provider.ts:5053) | partial (:354/:362) | extend to quote-fallback reason |
| Trade → Option chain | `options_backoff`, `option_chart_stale_fallback`, empty-retry (platform.ts) | **has DataIssueInlineIcon** | confirm all reasons mapped |
| Flow → Scanner / Distribution | `fallbackUsed`/`FlowSourceStatus` massive failover, premium-distribution timeouts | partial | map `fallbackUsed`→issue |
| GEX → Dashboard | GEX 504 timeouts, `unavailable` expirations (gex-projection.ts:673) | **has FailurePoint** | confirm timeout path mapped |
| Signals → Matrix / Dots | signal staleness (SignalDots amber), signal-options automation backoff/timeout | **has SignalDots + DataIssue** | map automation timeouts |
| Market → Sector flow / News | provider fallbacks | **has DataIssueInlineIcon (:828/:1142)** | verify |
| Algo → OperationsStatusOrb | readiness (`broker_health_stale`), resource pressure, deployment health | **has orb** | already aggregates |
| Footer (global) | `lineUsage.pressure.state` (resource-pressure.ts) | **FooterMemoryPressureIndicator** | already wired |

**No natural widget — surface in DiagnosticsScreen instead of a trading panel:**
- Graceful shutdown (index.ts:194, ibkr-bridge app.ts:382), backtest sweep concurrency (runtime.ts:19), SSE coalesce/heartbeat internals, background ingest job retries (market-data-ingest.ts).

**Emit NOTHING today → require new backend instrumentation before any marker is possible:**
- `ibkr-bridge/tws-provider.ts:2168,2243` `void tickle().catch(()=>{})`
- `api-server/services/shadow-account-streams.ts:134` polling catch → warn-and-continue
- `api-server/services/ibkr-connection-audit.ts:280,332,428` empty `catch {}`
These need a reported signal (counter/last-error field on the relevant diagnostics) wired through before a "!" can show.


---

## 9. Task 0.1 — Gap audit results (per-widget transport verdict)

Traced backend serializer → frontend payload → widget for every Phase 1–2 widget. Verdict legend: **already-wired** (signal reaches a marker today) · **frontend-only** (field on payload, widget ignores it) · **backend-add** (field not serialized; needs a surgical response change).

| Widget | Signal | Backend serializer | Reaches frontend? | Verdict |
|---|---|---|---|---|
| Quote header / position quotes | freshness/marketDataMode/cacheAgeMs/fallbackUsed | `platform.ts:~5054` getQuoteSnapshots | yes; `collectQuoteDataIssues` rendered (TradeScreen:362, PositionsPanel) | **already-wired** |
| Bars / chart | full debug `{degraded,reason,stale,ageMs,feedIssue}` | `platform.ts:~9318` getBarsWithDebug | yes; `collectChartSourceDataIssues` (TradeScreen:1391/354) | **already-wired** |
| Flow scanner / distribution | source.hydrationStatus/cache/errorMessage/fallbackUsed | `platform.ts:~2043` | yes; `flowSourceState.js` predicates render banner | **already-wired** (timeout only as text, no distinct code) |
| Resource-pressure footer | level/drivers/caps | `resource-pressure.ts` via `/api/readiness` | yes; `FooterMemoryPressureIndicator` | **already-wired** |
| Orders panel | `{degraded,stale,reason}` (ResilientOrdersResponse) | `platform.ts:2806-2892` | on payload + schema (`AccountOrdersResponse`), but `TradesOrdersPanel.jsx` ignores them | **frontend-only** |
| Equity curve panel | `isStale`/`staleReason` | `account.ts:4554-4588` | on payload + schema, component checks only query.error | **frontend-only** |
| Intraday PnL panel | `isStale`/`staleReason` (same payload) | `account.ts:4554-4588` | on payload, component ignores | **frontend-only** |
| Positions panel | account snapshot/schema backoff, quote fallback | `account.ts:~5283` getAccountPositionsUncached | NO resilience fields on positions payload | **backend-add** (`degraded/stale/reason` at account.ts:5283) |
| Risk dashboard | `skippedPositions`/`skipped.missing*` | computed `account-risk-model.ts:280`, **dropped** at `account.ts:7323-7326` | only `coverage.{matched,option}Positions` exposed | **backend-add** (pass skipped detail through at account.ts:7326) |
| Allocation panel | DB backoff/stale | `account.ts:4640-4649` | NO fields | **backend-add** |
| Cash funding panel | DB backoff/stale | `account.ts:7590-7624` | NO fields | **backend-add** |
| Option chain (chain-level) | `degraded`/`reason` (`options_backoff` etc.) | computed; emitted as **HTTP headers** `X-Pyrus-Degraded*` (`routes/platform.ts:2194`), NOT body | contract-level freshness wired; chain-level not in body, not parsed | **backend-add** (serialize degraded/reason into `GetOptionChainResponse` body) OR parse headers — **Decision D1** |
| Quote-stream reconnect | reconnectScheduled/Count/staleReconnectCount | `bridge-quote-stream.ts:191` (diagnostics only) | NOT on quote payload (`QuoteSnapshotPayload` carries only `quotes[]`) | **backend-add** (`streamStatus` on quote payload) |
| Bridge lane pressure | lane normal/degraded/backoff/stalled | `work-scheduler.ts:614` (bridge-internal) | stream-level `pressure` exists; lane pressure not on readiness | **backend-add** (lane pressure → `ApiReadinessPayload`) |
| Graceful shutdown | shutdown/drain | `index.ts:194` (flight-recorder only) | not exposed; `ConnectionStatusPill` has no draining variant | **backend-add** (`appReadiness.shutdownInitiated`) + pill variant |
| GEX dashboard | 504 timeout / unavailable expirations | `gex.ts:1132`, `gex-projection.ts:673` | timeout surfaces as HTTP error (rendered); coverage warnings shown; **no persistent field when serving stale** | **frontend-only** for error path; **backend-add** for stale-after-timeout status (`source.lastFetchStatus`) |

### Corrections to earlier assumptions
- **`backoffRemainingMs` is NOT on the orders payload** — only `debug.timeoutMs` exists. Update Task 1.1 acceptance to use `degraded/stale/reason`, not `backoffRemainingMs`.
- **Option-chain chain-level degradation is HTTP-header-only** (`X-Pyrus-Degraded` / `X-Pyrus-Degraded-Reason`), not in the JSON body — Decision D1 needed (serialize to body vs parse headers).
- Bonus already-on-payload widgets discovered: **Equity curve** and **Intraday PnL** carry `isStale/staleReason` but ignore it — cheap frontend-only wins to fold into Phase 1.

### Roll-up
- already-wired (no work): 4 — quote, bars/chart, flow scanner, resource footer
- frontend-only (wire component): 3 — orders, equity, intraday PnL
- backend-add (serialize a field first): 8 — positions, risk, allocation, cash, option-chain-body, quote-stream reconnect, lane pressure, shutdown (+ GEX stale status)

**New decision surfaced — D1:** Option-chain chain-level degraded reason: serialize into the response body (consistent with bars/quotes, recommended) or parse the existing `X-Pyrus-Degraded*` headers on the client?
