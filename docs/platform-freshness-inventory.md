# Platform Freshness Inventory

Generated: 2026-06-08
Status: working inventory, pass 1 complete for P0/P1 planning; P2/P3 paths classified for initial execution order

## Scope

This inventory covers data movement paths that can affect user-visible PYRUS platform freshness: frontend polling, SSE/EventSource streams, backend timers, provider/bridge ingest, workers, cache reducers, stream fallback logic, and freshness indicators.

Excluded unless they feed platform state: static content, marketing/admin-only views, Replit startup, provider credentials, and live order execution semantics.

## Inventory Schema

Each row should capture:

- Surface: user-visible UI or platform subsystem.
- User-visible state: what can appear stale.
- Frontend owner: screen/hook/store that reads or renders the state.
- Backend/API owner: route, service, stream producer, provider, or worker.
- Current transport: REST polling, SSE/EventSource, WebSocket, backend timer, domain event, provider push, or fallback.
- Source trigger: provider webhook, provider WebSocket, bridge event, DB/domain event, worker output, or unavoidable adapter polling.
- Fallback rule: when REST/timer fallback is allowed.
- Freshness risk: how this can silently freeze or show stale data.
- Target: desired transport/freshness behavior.
- Evidence status: observed, inferred, or unknown.

## Source Scans Run

- `rg -l "refetchInterval|setInterval\\(|setTimeout\\(|EventSource\\(|new WebSocket|useQuery\\(|useQueries\\(" artifacts/pyrus/src`
- `rg -l "startSse|setInterval\\(|setTimeout\\(|res\\.write|subscribe[A-Z]|notify[A-Z]|EventSource|WebSocket|poll" artifacts/api-server/src`
- `rg -l "watchlist|quote|ticker|price|marketData|market-data|lastPrice|bid|ask" artifacts/pyrus/src artifacts/api-server/src`
- `rg -n "refetchInterval\\s*:|refetchInterval\\(|setInterval\\(|new EventSource\\(|use[A-Za-z0-9]+Stream\\(|useQuery\\(" artifacts/pyrus/src/screens artifacts/pyrus/src/features/platform artifacts/pyrus/src/features/charting artifacts/pyrus/src/features/trade artifacts/pyrus/src/features/market`
- `rg -n "setInterval\\(|setTimeout\\(|subscribe[A-Z][A-Za-z0-9]+\\(|notify[A-Z][A-Za-z0-9]+\\(|startSse|res\\.write|stream[A-Z]|poll" artifacts/api-server/src/services artifacts/api-server/src/routes`

## Priority Scale

- P0: user-visible live platform data can silently freeze or lag for minutes.
- P1: user-visible data has duplicate polling or stale fallback risk, but the failure is less immediate than live prices.
- P2: background, derived, historical, or lower-frequency data where polling may be acceptable if owned and measured.
- P3: intentionally retained watchdog, worker loop, or backfill path.

## Initial Ranked Rows

| Priority | Surface | User-visible state | Frontend owner | Backend/API owner | Current transport | Source trigger | Freshness risk | Target | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| P0 | Sidebar watchlist and header KPI quotes | Equity prices, bid/ask, change, percent, sparklines | `PlatformApp.jsx`, `PlatformRuntimeLayer.jsx`, `MarketDataSubscriptionProvider.jsx`, `PlatformWatchlist.jsx`, `HeaderKpiStrip.jsx`, `runtimeTickerStore.js` | `/api/streams/quotes`, `bridge-streams.ts`, `bridge-quote-stream.ts`, `massive-stock-quote-stream.ts`, `platform.ts` quote snapshots | SSE for streamed symbols; REST quote snapshots for symbols not stream-covered; rotation diagnostics | Massive WebSocket when configured, else IBKR bridge quote stream; REST bootstrap/fallback | Inferred: stream-covered symbols are removed from REST fallback, so a stream that is active but silent can leave runtime ticker values stuck. Backend IBKR stall reconnect defaults around 45s, while desired UI stale mark is 10-15s. Rotation tracks touched symbols, not necessarily received fresh quote events. | Stream-first with per-symbol received-event freshness, stale UI around 10-15s, REST catch-up only when stream is stale/unavailable, source-event-to-visible-update target around 1-2s. | Observed code path and inferred risk |
| P0 | Trade screen active ticker quote | Active symbol price and order-ticket reference quote | `TradeScreen.jsx`, `useIbkrQuoteSnapshotStream`, `useRuntimeTickerSnapshots` | `/api/streams/quotes`, `getQuoteSnapshots`, bridge/Massive quote services | SSE plus REST query/cache merge | Same as equity quote stream | Inferred: separate quote consumer can duplicate watchlist quote ownership or depend on runtime store freshness without a shared per-symbol stale contract. | Shared quote freshness contract and one EventSource owner per symbol/identity where practical. | Observed code path |
| P0 | Account positions market data | Position prices, PnL, equity and option marks | `AccountScreen.jsx`, `PositionsPanel.jsx`, `PositionOptionQuoteStreams.jsx`, `positionMarketDataStore.js`, option quote store in `live-streams.ts` | `/api/streams/position-quotes`, `/api/streams/option-quotes`, `account.ts`, `bridge-option-quote-stream.ts`, `bridge-quote-stream.ts` | SSE for position/option quotes plus account REST/stream data | IBKR bridge stream, option quote stream, account stream timers/domain hooks | Stale marks can affect displayed PnL and risk. Position quote streams already separate from watchlist stream, so freshness identity must include symbol and provider contract id. | Per-position freshness status and stream fallback gating before reducing account REST polling. | Observed code path |
| P1 | Algo operations and signal rows | Row quotes, option quote marks, signal state display | `AlgoScreen.jsx`, `OperationsSignalTable.jsx`, `OperationsSignalRow.jsx`, `PlatformAlgoMonitorSidebar.jsx` | `algo-cockpit-streams.ts`, `signal-options-worker.ts`, `signal-options-automation.ts`, option quote stream services | Mix of SSE, row REST quote snapshots, worker timers, cockpit stream freshness | Domain events for cockpit; stock aggregate stream for signal workers; option quote stream | Row-level quotes may independently REST fetch when runtime ticker snapshots are missing; cockpit stream has existing event hooks but still has timer fallback. | Inventory-selected migration after quote/account freshness; ensure cache identity includes deployment, mode, symbol, provider contract id. | Observed code path |
| P1 | Signal Monitor and Signals screen | Signal matrix, states, events, watchlist-derived universe | `SignalsScreen.jsx`, `PlatformApp.jsx`, `signalMatrixScheduler.js`, signal monitor stores | `signal-monitor.ts`, `trade-monitor-worker.ts`, `signal-options-worker.ts` | REST polling at several visible intervals plus worker/stream paths | Worker output, stock aggregate stream, domain events | High-cardinality identity: profile, timeframe, symbol, evaluation mode, source strategy, request origin. Cache bleed or stale display risk is high. | Migrate after P0 market data and account foundations, with explicit identity/freshness contract. | Observed code path |
| P1 | Account page live state | Summary, positions, orders, allocation, risk, intraday equity | `AccountScreen.jsx`, `useAccountPageSnapshotStream` | `/api/streams/accounts/page`, `account-page-streams.ts`, account services | SSE plus REST queries; backend live timer around 1s and derived timer around 30s | Timer snapshots plus shadow account change subscription | Polling is partly backend-owned, but frontend has many fallback intervals. Risk is duplicate work and stale/derived mismatch. | Event-trigger primary account/order changes, slower watchdog fallback, preserve read-only semantics. | Observed code path |
| P1 | Broker/runtime/diagnostics state | Connection, auth, stream health, line usage, pressure | `HeaderStatusCluster.jsx`, `useRuntimeControlSnapshot.js`, `useIbkrLineUsageSnapshot.js`, `DiagnosticsScreen.jsx` | `/api/diagnostics/stream`, `diagnostics.ts`, `platform-bridge-health.ts`, `ibkr-line-usage.ts` | Diagnostics SSE plus REST polling/fallback timers | Bridge/runtime domain events and diagnostics subscription | Stale broker status makes the whole app feel unreliable; however it is less direct than live price freezes. | Push bridge-state through diagnostics SSE and gate REST fallback by stream freshness. | Observed code path |
| P1 | Stock aggregate/charts | Minute bars, chart candles, aggregate ticks, market screen charts | `useMassiveStockAggregateStream.ts`, `useMassiveStreamedStockBars.ts`, `MarketScreen.jsx`, charting hooks | `/api/streams/stock-aggregates`, `/api/streams/bars`, `stock-aggregate-stream.ts`, Massive WebSocket services | EventSource/WebSocket plus REST bars fallback and stale timers | Massive WebSocket and bridge quote stream | Existing stream/stall logic, but chart freshness and quote freshness can diverge. | Per-symbol aggregate freshness and clear fallback separation from historical bars. | Observed code path |
| P2 | Flow and market-flow runtime | Flow tape, premium flow, scanner status | `FlowScreen.jsx`, `useLiveMarketFlow.js`, flow stores | platform flow endpoints, options flow scanner, historical flow events | REST polling, runtime intervals, some stream/event paths | Worker output and historical flow events | Much of this is batch/backfill by nature; not all polling is wrong. | Classify worker loops vs duplicate UI polling before migration. | Observed code path |
| P2 | GEX dashboard | GEX calculations, quote-dependent spots | `GexScreen.jsx`, `gexModel.js`, GEX hooks | `gex.ts`, platform quote snapshots | REST polling and backend quote reads | REST/provider fetches, potential quote stream reuse | Derived calculations may lag live quote changes; acceptable latency may differ from watchlist. | Decide freshness SLA separately from live ticker SLA. | Observed code path |
| P2 | Shadow account | Shadow summary, positions, orders, allocation, risk | `AlgoScreen.jsx`, `live-streams.ts` shadow stream hook | `/api/streams/accounts/shadow`, `shadow-account-streams.ts`, `shadow-account-events.ts` | SSE with current 2s stream interval and change subscription available | Domain event exists via shadow account changes | Event-ready cleanup path, but lower priority than P0 market data and P1 account/signal correctness. | Replace routine 2s fetch with coalesced domain events plus watchdog fallback. | Observed code path |
| P2 | Algo cockpit | Deployments, cockpit state, execution events, signal options state | `AlgoScreen.jsx`, `PlatformAlgoMonitorSidebar.jsx`, `live-streams.ts` | `/api/streams/algo/cockpit`, `algo-cockpit-streams.ts`, `algo-cockpit-events.ts` | SSE with existing 5s interval and notify hook available | Domain event exists via cockpit change notifications | Good cleanup target; user impact depends on active algo use and stale cockpit behavior. | Replace 5s primary poll with coalesced cockpit events plus watchdog fallback. | Observed code path |

## Execution Ranking

This ranking feeds `docs/plans/internal-api-push-transport-plan.md` and replaces the earlier candidate-order ambiguity.

1. Foundation: shared stream contract, backend diagnostics, and quote/watchlist proof. This is not optional because it defines how every later migration proves freshness.
2. P0 market data: watchlist/header/trade/algo-row quotes, then account position and option quote freshness. These are the highest user-visible stale-data risk.
3. Broker/runtime and account page: bridge-state diagnostics SSE, account/order fanout, account REST fallback gating, and account derived trigger separation.
4. Signal Monitor: high impact, but held until identity is explicit because profile/timeframe/symbol/source cache bleed would be worse than polling.
5. Algo cockpit and shadow account cleanup: event-ready timer producers with existing notify/subscribe hooks; useful cleanup after P0/P1 correctness.
6. Guardrails and rollout: polling allowlist, diagnostics-backed pressure labels, safe QA, live read-only stream probes, and soak report.
7. Provider-native push/webhooks: later edge phase after the internal SSE/domain-event baseline works.

## Pass 1 Findings

- Observed: the watchlist/sidebar quote path already has an SSE route and backend subscriber streams; the issue is likely not absence of a stream.
- Observed: `MarketDataSubscriptionProvider.jsx` excludes stream-covered symbols from REST quote snapshot fetches.
- Observed: `PlatformApp.jsx` rotates streamed quote symbols and records coverage based on when symbols were included in a batch.
- Observed: `bridge-quote-stream.ts` has stream gap/stall diagnostics and a stall reconnect window that defaults much longer than the desired UI stale indicator.
- Inferred: a stream that remains open but does not deliver quote data for a symbol can leave the runtime ticker store stale while the UI still considers the symbol stream-covered.
- Unknown: whether current UI surfaces visibly mark stale per-symbol quote data after 10-15 seconds. This needs focused code inspection and browser/runtime validation.

## Frontend Freshness Owners

| Surface | Frontend files | Current cadence/stream | Cache/store owner | Inventory classification | Notes |
|---|---|---|---|---|---|
| Watchlist/header quotes | `PlatformApp.jsx`, `PlatformRuntimeLayer.jsx`, `MarketDataSubscriptionProvider.jsx`, `runtimeTickerStore.js`, `runtimeMarketDataModel.js`, `PlatformWatchlist.jsx`, `HeaderKpiStrip.jsx` | EventSource `/api/streams/quotes` for rotated stream-covered symbols; REST quote snapshots for non-stream-covered symbols; quote rotation every 4s; coverage window 60s | Runtime ticker store plus React Query quote snapshot cache | P0 stream-first path with stale/fallback risk | Needs per-symbol received-event freshness, not just rotation coverage. |
| Watchlist definitions | `PlatformApp.jsx`, `PlatformWatchlist.jsx` | REST refetch every 60s | React Query plus selected watchlist state | P2 retained poll unless mutations/events justify push | Does not need 1-2s quote SLA; it affects symbol set freshness. |
| Platform session/runtime metadata | `PlatformApp.jsx`, `useRuntimeControlSnapshot.js` | Session REST refetch every 5s; runtime diagnostics REST fallback when diagnostics stream absent | React Query plus runtime snapshot model | P1 duplicate polling path | Move broker lifecycle details to diagnostics SSE; keep session metadata periodic if Task 14 allowlists it. |
| IBKR line usage | `useIbkrLineUsageSnapshot.js` | EventSource `/api/settings/ibkr-line-usage/stream`; REST polling fallback at caller interval | Local hook state | P1 stream with fallback | Backend stream currently writes snapshots every 2s. |
| Account page | `AccountScreen.jsx`, `accountRefreshPolicy.js`, `live-streams.ts` | Account page SSE plus REST fallback; policy disables REST when page stream is fresh; non-shadow fallback intervals are primary 15s, secondary 30s, trades 60s, chart 300s, health 15s; shadow fallback intervals are 30s/60s/120s/300s | React Query account caches | P1 stream-freshness-gated REST catch-up | Many query families; identity includes account, mode, filters, range, order tab, asset class. |
| Account positions quotes | `PositionsPanel.jsx`, `PositionOptionQuoteStreams.jsx`, `positionMarketDataStore.js`, `live-streams.ts` | Position quote EventSource and option quote stream; runtime ticker snapshots reused for equity positions | Position market data store, option quote store, React Query account positions | P0/P1 live market-data path | Needs provider contract id freshness for options and symbol freshness for equities. |
| Algo screen | `AlgoScreen.jsx`, `live-streams.ts`, `queryDefaults.js` | Algo cockpit SSE; REST catch-up uses shared 15s query default when primary/full stream freshness is false; ledger positions poll at 60s when shadow stream stale | React Query algo/cockpit caches | P1 stream-freshness-gated REST catch-up | Existing plan can convert backend 5s cockpit stream interval to events. |
| Algo monitor sidebar | `PlatformAlgoMonitorSidebar.jsx`, `algoMonitorFreshness.js` | Own or external algo cockpit stream; deployments poll 30s; primary/derived REST catch-up defaults to 30s when deployment-scoped stream freshness is false | React Query plus algo freshness helpers | P1 duplicate ownership risk | Shell-level freshness cannot suppress deployment-scoped REST catch-up. |
| Signal Monitor / Signals screen | `SignalsScreen.jsx`, `PlatformApp.jsx`, `signalMatrixScheduler.js` | Signal state/events REST refetch 15s when not platform-managed; breadth history 30s | React Query plus signal monitor stores | P1 high-cardinality freshness path | Must inventory profile/timeframe/symbol/source identity before migration. |
| Trade screen equity quote | `TradeScreen.jsx` | EventSource `/api/streams/quotes` plus REST quote query/cache merge | Runtime ticker store and React Query quote snapshot cache | P0 duplicate stream consumer risk | Fold into the shared quote freshness contract with watchlist/header quotes. |
| Trade positions/executions | `TradePositionsPanel.jsx`, `TradeL2Panel.jsx` | Orders/executions REST refetch disabled; executions and market depth use EventSource streams when visible/authenticated | React Query broker caches | P1 stream path | Existing push path looks stronger than many other surfaces. |
| Market screen news/earnings | `MarketScreen.jsx` | News poll 60s; earnings poll 300s | React Query | P3 acceptable derived polling | Not a live platform freshness P0. |
| Flow screen and live market flow | `FlowScreen.jsx`, `useLiveMarketFlow.js` | Market universe poll 60s; aggregate flow poll clamped 2.5s-10s; Flow screen news 60s; premium distribution interval from flow config | React Query plus flow stores | P2 worker/batch path | Needs classification of scanner worker cadence vs duplicate frontend polling. |
| GEX screen | `GexScreen.jsx`, `useGexZeroGamma.js` | GEX dashboard refetches every 15s while visible | React Query | P2 derived quote-dependent path | Needs separate SLA from tick-by-tick watchlist prices. |
| Chart aggregate streams | `useMassiveStockAggregateStream.ts`, `useMassiveStreamedStockBars.ts`, charting hooks | EventSource/WebSocket aggregate streams with stall timers and REST bar fallback | Aggregate/bar stores and React Query | P1/P2 stream plus historical fallback | Needs per-symbol aggregate freshness separate from historical bars. |

## Deferred Or Retained Lower-Priority Paths

| Surface | Observed path | Classification | Plan treatment |
|---|---|---|---|
| Research/backtesting workbench | `BacktestingPanels.tsx` has visible-only 5s/10s/15s refetch intervals for research/backtest progress and supporting reads. | P2/P3 background or user-initiated research workflow | Do not block Tasks 1-5. Add to Task 14 polling allowlist unless a later product requirement makes research freshness user-critical. |
| Research/provider status | `SignalsScreen.jsx` and `SettingsScreen.jsx` read research status/provider configuration. | P2 configuration/status freshness | Keep REST/manual refresh unless Signal Monitor identity work proves this status gates live signal freshness. |
| Diagnostics/memory pressure UI | diagnostics hooks and screens already use diagnostics stream paths plus fallback reads. | P1/P3 operational diagnostics | Task 3/6/14 own this through stream diagnostics, bridge-state events, and pressure-label cleanup. |
| Market news and earnings | `MarketScreen.jsx` uses 60s/300s class reads. | P3 derived content polling | Retain; not part of live platform freshness SLA. |
| Flow scanner and flow tape | `useLiveMarketFlow.js`, `FlowScreen.jsx`, and flow scanner status use worker/batch cadences and runtime intervals. | P2 worker/batch path | Classify retained scanner/backfill loops in Task 14 before considering any stream migration. |
| GEX dashboard | `GexScreen.jsx` refetches around 15s while visible. | P2 derived quote-dependent path | Do not apply watchlist 1-2s SLA; define a separate derived-data SLA if this becomes a target. |
| Chart historical bars | chart aggregate streams coexist with REST historical bar fallback. | P2/P3 stream plus historical fallback | Keep historical REST/backfill distinct from live aggregate freshness. |

## Backend Freshness Producers

| Producer | Backend files | Current trigger/cadence | Stream/API surface | Classification | Notes |
|---|---|---|---|---|---|
| API SSE helper | `routes/platform.ts` | Shared `startSse` has heartbeat, backpressure timeout, open/close diagnostics, `Last-Event-ID` capture | Many `/api/streams/*` routes | Foundation | Move to shared utility before route churn. |
| Diagnostics SSE | `routes/diagnostics.ts`, `diagnostics.ts` | Diagnostics subscription plus heartbeat every 15s | `/api/diagnostics/stream` | P1 stream | Target for bridge-state push and runtime fallback gating. |
| Settings line usage SSE | `routes/settings.ts`, `ibkr-line-usage.ts` | Backend writes line usage snapshot every 2s | `/api/settings/ibkr-line-usage/stream` | P1 stream with timer producer | Could remain if it is a measured diagnostics watchdog. |
| Equity quote stream | `bridge-streams.ts`, `bridge-quote-stream.ts`, `massive-stock-quote-stream.ts`, `routes/platform.ts` | Massive provider WebSocket when configured; otherwise IBKR bridge quote stream; initial snapshot REST/bootstrap; IBKR stall reconnect default around 45s | `/api/streams/quotes` and quote snapshots | P0 provider/bridge push path | Need per-symbol stream event age and UI stale threshold closer to 10-15s. |
| Position quote stream | `bridge-streams.ts`, `bridge-quote-stream.ts`, `routes/platform.ts` | IBKR bridge quote stream plus reconcile on market data lease changes | `/api/streams/position-quotes` | P0/P1 provider/bridge push path | Identity/freshness differs from watchlist stream because positions can filter symbols. |
| Option quote stream | `bridge-option-quote-stream.ts`, `ws/options-quotes.ts`, `routes/platform.ts` | IBKR option quote stream and WebSocket/EventSource frontend paths; stall threshold observed in frontend as 45s | `/api/streams/option-quotes`, option quote WebSocket | P0/P1 provider/bridge push path | Requires provider contract id identity, not just symbol. |
| Account page stream | `account-page-streams.ts`, `routes/platform.ts` | Live timer 1s, derived timer 30s, shadow account changes can trigger immediate live/derived ticks | `/api/streams/accounts/page` | P1 backend timer producer with some domain events | Convert live producer to account/order events where available; keep derived watchdog slower. |
| Shadow account stream | `shadow-account-streams.ts`, `shadow-account-events.ts` | 2s polling stream plus immediate change subscription excluding mark refresh | `/api/streams/accounts/shadow` | P2 event-ready timer producer | Event-driven cleanup after P0/P1 freshness work. |
| Algo cockpit stream | `algo-cockpit-streams.ts`, `algo-cockpit-events.ts` | 5s polling stream plus coalesced cockpit change subscription | `/api/streams/algo/cockpit` | P2 event-ready timer producer | Event-driven cleanup after P0/P1 freshness work. |
| Stock aggregates | `stock-aggregate-stream.ts`, `massive-stock-websocket.ts`, `routes/platform.ts` | Massive aggregate/quote provider streams, fanout timers, heartbeat timers, fallback subscriptions | `/api/streams/stock-aggregates`, chart aggregate streams | P1/P2 provider push plus fanout | Needs freshness metrics by symbol and timeframe. |
| Signal/trade monitor workers | `trade-monitor-worker.ts`, `signal-options-worker.ts`, `signal-monitor.ts` | Worker poll intervals from profiles, stock aggregate stream subscriptions, coalesced stream evaluations | Signal Monitor and algo/signal APIs | P1 high-cardinality worker/event hybrid | Do not migrate until identity/fallback schema is explicit. |
| Flow/options scanner | `options-flow-scanner.ts`, `historical-flow-events.ts`, platform flow services | Worker/timeboxed scans and historical event timers | Flow endpoints and stores | P2/P3 worker/backfill | Some polling is expected due to scanner/backfill nature. |

## P0/P1 Cache And Fallback Details

### Equity Quotes: Watchlist, Header, Trade, Algo Rows

Observed cache owners:

- React Query key family: `getGetQuoteSnapshotsQueryKey({ symbols })`, shaped as [`/api/quotes/snapshot`, `{ symbols }`].
- Stream cache patcher: `useQuoteSnapshotStream` scans all query-cache entries with prefix [`/api/quotes/snapshot`] and merges accepted stream quotes into matching symbol queries.
- Runtime store: `TRADE_TICKER_INFO` in `runtimeTickerStore.js`, keyed by normalized symbol and surfaced through `useRuntimeTickerSnapshot` / `useRuntimeTickerSnapshots`.
- Runtime store writers: `applyRuntimeQuoteSnapshots` and `syncRuntimeMarketData` in `runtimeMarketDataModel.js`.

Observed fallback gates:

- `MarketDataSubscriptionProvider.jsx` computes `streamCoveredQuoteSymbols` from active quote streams and removes those symbols from REST quote snapshots.
- REST quote snapshots are enabled only when `restQuoteSymbolsKey` is non-empty, with `staleTime: 60_000`, `retry: false`, and no routine `refetchInterval`.
- Quote stream activation requires runtime quote stream enabled, at least one streamed symbol, EventSource availability, and no upstream disabled reason.
- Watchlist quote rotation includes stream batches every 4s and a 60s cycle coverage diagnostic.

Observed freshness guards:

- Stream quotes are accepted only if `isQuoteSnapshotAtLeastAsFresh` says they are newer than the newest cached quote by `dataUpdatedAt`, `updatedAt`, wrapper `updatedAt`, or API received/emitted latency.
- Runtime ticker patches reject older quote fields and same-timestamp conflicting quote fields.

Current risk:

- A symbol can be treated as stream-covered and removed from REST fallback even if no fresh per-symbol quote event is arriving.
- Watchlist rotation coverage records when a symbol was included in the requested stream batch, not when the UI actually received and rendered a fresh quote for that symbol.
- There is no confirmed per-symbol stale indicator at the desired 10-15s window for the sidebar/watchlist path.

Target:

- Add per-symbol stream event age, runtime-store patch age, and row-render freshness.
- Keep REST suppressed only while the stream is fresh for that symbol.
- Make quote rows visibly stale/degraded around 10-15s when source data stops unexpectedly.

### Position And Option Quotes

Observed cache owners:

- Equity position quote store: `positionQuoteSnapshotsBySymbol` in `positionMarketDataStore.js`, surfaced through `usePositionQuoteSnapshots`.
- Equity position stream: `usePositionQuoteSnapshotStream` receives `/api/streams/position-quotes`, writes the position quote store, and also applies quotes into the runtime ticker store.
- Option quote store: `optionQuoteSnapshotsByProviderContractId` in `live-streams.ts`, surfaced through `getStoredOptionQuoteSnapshot`, `useStoredOptionQuoteSnapshot`, and `useStoredOptionQuoteSnapshotVersion`.
- Account positions query patching: option quote updates patch React Query account position queries whose path starts with `/api/accounts/` and ends with `/positions`.

Observed fallback gates:

- Position equity quotes depend on `positionQuoteStreamRuntimeActive`; the broader account positions REST query uses account-page fallback policy and `liveQuotes: true`.
- Option quotes use WebSocket `/api/ws/options/quotes` by default.
- If option WebSocket is unavailable or stalls, REST fallback rotates every 3s in batches of 100 provider contract ids.
- Option WebSocket stall threshold is 45s.

Observed freshness guards:

- Position quote store currently shallow-merges by symbol and notifies all position quote listeners when any symbol changes.
- Option quote cache rejects older `updatedAt` values, has a 1024 snapshot cap, and protects actively subscribed contract ids from LRU eviction.

Current risk:

- Option quote stale handling is much slower than the desired 10-15s visible stale window.
- Equity positions, option positions, account positions REST, and runtime ticker store can each represent market data freshness differently.

Target:

- Track quote freshness separately for equity symbol and option provider contract id.
- Align visible stale indicators and fallback policy with account/position risk.

### Account Page

Observed cache owners:

- Stream URL: `/api/streams/accounts/page` with account id, mode, range, order tab, asset class, trade filters, and performance calendar date in the query string.
- Primary/live stream cache keys: account summary, allocation, risk, positions, orders, and 1D equity history.
- Derived stream cache keys: selected-range equity history, benchmark equity history, performance calendar equity, closed trades, performance-calendar trades, cash activity, and Flex health.
- Generated key helpers include `getGetAccountSummaryQueryKey`, `getGetAccountAllocationQueryKey`, `getGetAccountRiskQueryKey`, `getGetAccountPositionsQueryKey`, `getGetAccountOrdersQueryKey`, `getGetAccountEquityHistoryQueryKey`, `getGetAccountClosedTradesQueryKey`, `getGetAccountCashActivityQueryKey`, and `getGetFlexHealthQueryKey`.

Observed fallback gates:

- `useAccountPageSnapshotStream` marks primary/live fresh for 3s and derived fresh for 35s.
- Account fallback delay constants are currently 0ms, so REST fallback can become eligible immediately once stream freshness is false.
- `accountRefreshPolicy.js` disables REST while the page stream is fresh.
- Non-shadow fallback intervals: primary 15s, secondary 30s, trades 60s, chart 300s, health 15s.
- Shadow fallback intervals: primary 30s, secondary 60s, trades 120s, chart 300s.

Current risk:

- The backend account-page stream still has a 1s live producer timer and 30s derived producer timer.
- There are many query identities, so a stream can be fresh for one account/filter/range while another query needs fallback.

Target:

- Keep account page behind the inventory gate until identity coverage is explicit.
- Replace primary live timer with account/order events where available; keep derived/watchdog fallback slower and measured.

### Algo Cockpit And Algo Sidebar

Observed cache owners:

- Stream URL: `/api/streams/algo/cockpit` with deployment id, mode, and event limit.
- `applyAlgoCockpitPayloadToCache` writes `getListAlgoDeploymentsQueryKey()`, `getListExecutionEventsQueryKey({ deploymentId, limit: 20 })`, `getGetSignalOptionsAutomationStateQueryKey(deploymentId)`, `getGetAlgoDeploymentCockpitQueryKey(deploymentId)`, `getGetSignalOptionsPerformanceQueryKey(deploymentId)`, and `getGetSignalMonitorProfileQueryKey({ environment: mode })`.

Observed fallback gates:

- `useAlgoCockpitStream` marks stream, primary, and full freshness for 7s.
- `AlgoScreen.jsx` waits 1s before allowing primary fallback if the stream is not fresh.
- `AlgoScreen.jsx` uses the shared 15s query default for primary/full REST catch-up while stream freshness is false.
- `PlatformAlgoMonitorSidebar.jsx` only suppresses REST catch-up when stream freshness matches the selected deployment; deployment-scoped primary/derived fallback defaults to 30s.

Current risk:

- Backend cockpit stream still has a 5s timer even though `subscribeAlgoCockpitChanges` exists.
- Shell-level freshness can hide deployment-scoped staleness if identity is not enforced.

Target:

- Keep deployment id and mode in every event/freshness decision.
- Convert the 5s producer timer to event-triggered snapshots plus watchdog if inventory ranking selects this slice.

### Signal Monitor

Observed cache owners:

- Platform owner query keys: `getGetSignalMonitorProfileQueryKey({ environment })`, `getGetSignalMonitorStateQueryKey({ environment })`, and `getListSignalMonitorEventsQueryKey({ environment, limit })`.
- Platform freshness families: `signal-monitor-profile`, `signal-monitor-state`, and `signal-monitor-events`.
- Screen-local fallback queries use the same state/events/profile endpoints when `signalMonitorDataManagedByPlatform` is false.

Observed fallback gates:

- Platform profile query polls every 60s while signal-monitor work is visible.
- Platform state/events polling interval is `signalMonitorRuntimePollMs`: fast screens use min(profile poll interval, 15s), background screens use at least 60s, and pressure caps can raise the floor.
- Signals screen suppresses its own profile/state/events polling when `signalMonitorDataManagedByPlatform` is true.
- If not platform-managed, Signals screen state/events poll every 15s and breadth history polls every 30s.

Current risk:

- Signal Monitor is high-impact but high-cardinality. Correctness depends on environment, profile, timeframe, symbol, universe/source strategy, evaluation mode, request origin, and freshness windows.
- A stream migration without complete identity would risk cache bleed more than it would improve latency.

Target:

- Keep Signal Monitor after P0 market data and account/broker foundations unless new evidence changes the ranking.
- Require identity/freshness contract before replacing polling with streams.

### Broker Runtime And Diagnostics

Observed cache owners:

- Session query: `getGetSessionQueryKey()`, polled every 5s in `PlatformApp.jsx`.
- Runtime diagnostics fallback query: `["platform-runtime-diagnostics", runtimeDiagnosticsQueryKey]` in `useRuntimeControlSnapshot.js`.
- Diagnostics stream: `/api/diagnostics/stream`.
- Line usage stream: `/api/settings/ibkr-line-usage/stream`.

Observed fallback gates:

- Runtime diagnostics REST fallback runs only when no runtime diagnostics snapshot is provided.
- Diagnostics SSE sends subscribed messages plus 15s heartbeat.
- Line usage uses SSE when enabled and EventSource exists; otherwise it polls at the caller-provided line usage interval.

Current risk:

- Broker status and stream health are important context for quote freshness, but they are not a substitute for per-symbol quote freshness.

Target:

- Push bridge-state through diagnostics SSE and keep runtime/session polling separate from per-symbol quote freshness.

## Immediate Next Inventory Work

1. Complete Task 1 acceptance by confirming the P0/P1 rows above still match source after any dirty-worktree changes land.
2. Add explicit P0 quote/watchlist validation probes in Task 3A: stream active, per-symbol event received, query cache patched, runtime ticker store patched, row re-rendered, stale label shown, and REST fallback eligibility.
3. Keep the execution order from the ranking above unless new source evidence changes a priority classification.
4. Push remaining polling decisions into Task 14's allowlist instead of reopening the migration order.
