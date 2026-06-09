# Internal API Push Transport Implementation Plan

Generated: 2026-06-08
Status: locked execution plan, documentation-only, implementation not started
Scope: organize a repo-backed platform freshness inventory, then use internal webhook/native-push/SSE work to move live data from API/backend sources to Pyrus platform endpoints and UI caches more efficiently.

## Overview

This plan starts with a repo-backed inventory of every data movement path that can affect user-visible platform freshness. After that evidence is in place, it reduces duplicate timer polling by using provider-native push, internal domain events, and browser-facing SSE/EventSource streams to update platform React Query caches. REST stays the contract for commands, initial reads, historical/backfill reads, generated clients, and fallback when a stream is stale or unavailable.

This is not a mandate to delete every timer. Some backend pollers are legitimate watchdogs, worker loops, historical/backfill jobs, or bridge adapters for sources that do not emit native events. The first goal is to identify every user-visible freshness path, then collapse duplicate UI/API polling and make the remaining polling owned, measured, and justified.

The word "webhook" should be reserved for external systems calling our API or for internal domain-event notifications. Browser-facing push should be SSE or WebSocket, not webhooks. For this work, the target architecture is:

```text
Provider/bridge/DB/domain change
  -> internal backend event notification
  -> stream producer fetches/coalesces one normalized snapshot
  -> API SSE endpoint emits typed events with source/freshness fields
  -> frontend stream hook patches React Query caches
  -> REST fallback runs only when stream is absent, stale, or explicitly backfilling
```

## Confirmed Intent

- Outcome: produce a repo-backed, site-wide freshness inventory that shows where platform data is stale, polled, duplicated, or not truly streaming.
- User: PYRUS users who expect live platform state, especially quotes/prices/watchlists/account/algo/signal/broker surfaces.
- Why now: prices and other live data can stick for minutes; architecture cleanup only matters if it fixes user-visible freshness.
- Success: migration targets are ranked by user impact and latency risk, with real-time quote paths targeting roughly 1-2 second delivery when source data moves and stale indicators around 10-15 seconds when data stops.
- Constraint: do not jump into implementation or preselect migration targets before the inventory proves which paths matter and which trigger/stream/fallback each one should use.
- Out of scope: Replit startup, live order execution semantics, provider credentials, and static/marketing/admin routes unless they affect platform freshness.

## Low-Latency Data Movement Model

Use the lowest-latency push mechanism that fits the receiver:

- External system to our API: provider webhook when the provider supports server-to-server callbacks.
- Provider or bridge runtime to our backend: provider-native WebSocket, bridge event, DB change, or domain-event notification when available.
- Backend service to backend service: typed internal domain events plus coalesced snapshot production.
- API to browser: SSE/EventSource by default for one-way updates; WebSocket only when the browser needs frequent bidirectional messaging or dynamic subscription control over the same connection.
- REST: commands, initial reads, historical/backfill reads, generated client contracts, and stale-stream fallback.
- Polling: one owned, measured backend adapter/watchdog only when the upstream source does not emit a usable event.

The latency target is event-to-snapshot-to-browser delivery. Polling should not be the primary browser data path for stream-backed surfaces, and multiple UI components should not independently poll for the same state.

## Observed Facts

- `docs/backend-data-map.md` defines REST JSON, API SSE, Bridge REST/SSE, worker DB polling, and generated clients as separate transport families.
- API SSE routes already exist for diagnostics, quotes, position quotes, option chains, option quotes, bars, orders, executions, market depth, footprints, account page, accounts, shadow accounts, stock aggregates, algo cockpit, marketing, and settings line usage.
- `artifacts/api-server/src/routes/platform.ts` has a `startSse` helper with heartbeat, backpressure timeout, open/close diagnostics, and `Last-Event-ID` capture.
- Other routes still have local SSE writers: `routes/diagnostics.ts`, `routes/automation.ts`, `routes/marketing.ts`, and `routes/settings.ts`.
- `artifacts/api-server/src/services/account-page-streams.ts` emits account page SSE from timer snapshots: live every 1s and derived every 30s.
- `artifacts/api-server/src/services/shadow-account-streams.ts` has a 2s stream interval, but also has `subscribeShadowAccountChanges`.
- `artifacts/api-server/src/services/algo-cockpit-streams.ts` has a 5s stream interval, but also has `subscribeAlgoCockpitChanges`.
- Frontend REST polling remains in high-value screens: `AccountScreen.jsx`, `AlgoScreen.jsx`, `SignalsScreen.jsx`, and `useRuntimeControlSnapshot.js`.
- Existing tests cover some stream behavior in `account-page-streams.test.ts`, `shadow-account-streams.test.ts`, `bridge-streams.test.ts`, `live-streams.test.mjs`, `algoMonitorFreshness.test.mjs`, and `AccountScreen.positions.test.mjs`.
- `CONNECTION_ACTION_UX_PLAN.md` already proposed pushing bridge state through `/api/diagnostics/stream` with a `bridge-state` event instead of polling broker connection state.
- Route admission can suppress live streams in `?pyrusQa=safe`; safe browser QA proves fallback/layout behavior, not live stream delivery.

## Architecture Decisions

- Use internal event notifications plus SSE as the default push path. Do not introduce browser-facing webhooks.
- Prefer provider-native push or provider webhooks at the source edge when they exist; if the upstream has no event source, keep exactly one owned backend poller/adapter and fan out its normalized state by SSE.
- Keep REST as the source of truth for generated public contracts, commands, initial snapshots, historical reads, and fallback.
- Treat SSE `ready` as transport readiness only. Freshness must come from data events or explicit `freshness`/source-health events.
- Reconnects must be snapshot-based, not replay-based, unless a later task explicitly adds durable replay. `Last-Event-ID` is diagnostic/correlation data for this plan; every stream must send a current initial snapshot after reconnect.
- Migrate vertically by domain so each task leaves the app working and testable.
- Keep timers as fallback watchdogs until diagnostics prove the event-driven path is stable.
- Collapse duplicate frontend/API polling before attempting provider-native push. Bridge adapter or worker polling can remain when it is the only reliable source trigger.
- Build the reusable freshness/stream/fallback foundation first, then prove it on quote/watchlist data before broader migrations. Quote work is the first proof path, not a quote-only patch.
- Deduplicate EventSource ownership by URL/identity where practical. Do not let nested components open duplicate streams for the same account, deployment, symbol set, or profile.
- Do not touch Replit startup, bridge helper launch, live order execution semantics, or provider credentials as part of this transport plan.

## Engineering Review Refinements

The plan has three distinct migration levels. Keep them separate so implementation does not overreach:

```text
Level 1: Measure and document
  - inventory pollers, streams, cache keys, source-health fields
  - record stream opens/closes, event writes, fallback writes

Level 2: Collapse duplicate polling
  - one backend producer owns a snapshot cadence or event trigger
  - frontend caches are patched by SSE
  - REST refetch intervals run only when stream freshness expires

Level 3: Replace backend timer producers with domain events
  - use existing notify/subscribe hooks where they exist
  - coalesce event bursts
  - keep a slower watchdog fallback for missed events

Level 4: Provider-native push
  - provider webhooks, provider WebSockets, or other native source events
  - only when the upstream source actually emits events
  - not required for the first batch
```

The first gate is Tasks 1-3A: platform freshness inventory, shared stream contract, generic diagnostics, and a quote/watchlist proof of the reusable freshness contract. No broader migration target starts until Task 3A proves the contract on the highest-risk visible path. The first inventory pass found that quote/watchlist streams already exist, so quote work must prove the foundation end to end rather than paper over a single stale-price symptom.

The locked order after the foundation is P0 market data, broker/account state, Signal Monitor, algo/shadow cleanup, then guardrails and rollout. Provider-native push and external webhooks are a later edge phase after the internal freshness contract works.

## Stream Contract Checklist

Every migrated stream must document and test:

- `ready` event means transport setup only.
- Initial snapshot after every connect or reconnect.
- Identity fields in every data event: account, mode, deployment, profile, symbol, timeframe, provider contract id, or equivalent domain key.
- `source`, `updatedAt`, stale/degraded fields, and failure/actionability fields where the UI makes decisions.
- Structured `error` event with stable `code`, `detail`, and optional `cooldownMs`.
- Heartbeat or freshness event independent of data changes.
- Abort cleanup, stream open/close diagnostics, and write backpressure behavior.
- Event burst coalescing and max queued writes.
- Last-good merge behavior in the frontend reducer.
- Stale-stream REST fallback and EventSource-unavailable fallback.

## Success Metrics

- The platform freshness inventory covers all user-visible live-data surfaces before implementation targets are selected.
- Primary scorecard: visible freshness correctness. P0 quote/price/ticker/watchlist paths deliver source changes to visible UI in roughly 1-2 seconds when source data moves and mark stale/degraded state around 10-15 seconds when source data stops unexpectedly.
- Secondary scorecard: duplicate routine poll reduction, route p95, active stream count, active poll count, stream stale events, and fallback write counts.
- For each migrated browser surface, routine REST refetches for stream-backed reads should be zero while the stream is fresh.
- For each event-backed stream, measure source-event-to-SSE-write latency and browser-receive-to-cache-apply latency where practical.
- Event-triggered streams should report event writes separately from watchdog fallback writes.
- Watchdog fallback must be visibly slower than the old primary poll loop and must not run only to prove no change.
- QA must compare before/after active poll count, active stream count, stream stale events, route p95, and visible stale indicators.
- Safe browser QA should verify UI stability and fallback behavior; direct API stream probes should verify live SSE delivery.

## Dependency Graph

```text
Stream contract, metrics, and source inventory
  -> shared SSE utility and backend stream diagnostics
      -> quote/watchlist freshness contract proof
          -> selected domain-event hooks
              -> backend stream producers
                  -> API SSE routes
                      -> frontend EventSource hooks/cache reducers
                          -> REST fallback gating
                              -> polling deprecation diagnostics
```

## Task List

### Phase 1: Foundation

## Task 1: Build The Platform Freshness Inventory

**Description:** Create a source-backed inventory of every data movement path that can affect user-visible platform freshness. Include frontend polling, SSE/EventSource streams, backend timers, provider/bridge ingest, workers, cache reducers, fallback logic, freshness indicators, and target migration status. This turns the work into explicit transport contracts before code changes.

**Acceptance criteria:**
- [ ] Inventory lists each target path with source of truth, stream endpoint, frontend owner, current polling cadence, target push trigger, and fallback rule.
- [ ] Inventory records the best available upstream trigger type: provider webhook, provider WebSocket, bridge event, DB/domain event, worker output, or unavoidable adapter polling.
- [ ] Inventory marks paths with no existing source event separately from paths that already have `notify`/`subscribe` hooks.
- [ ] Inventory explicitly includes quote/price/ticker/watchlist paths and records whether source data, backend stream production, API delivery, or frontend cache application can cause multi-minute freezes.
- [ ] Inventory records exact cache keys/stores and fallback gates for P0/P1 paths before any migration target is selected.
- [ ] Inventory ranks migration candidates by user impact, latency/freshness risk, duplicate polling cost, event-source availability, and cache identity complexity.
- [ ] Inventory classifies every poller as duplicate UI/API polling, stream watchdog, worker loop, bridge adapter loop, historical/backfill, or intentionally retained.

**Verification:**
- [ ] Run `rg -n "refetchInterval|setInterval|EventSource|/streams/" artifacts/pyrus/src artifacts/api-server/src`.
- [ ] Run targeted source scans for quote/watchlist/market-data paths and record findings in the inventory.
- [ ] Run `git diff --check -- docs/backend-data-map.md docs/plans/internal-api-push-transport-plan.md`.

**Dependencies:** None

**Files likely touched:**
- `docs/backend-data-map.md`
- `docs/platform-freshness-inventory.md`
- `docs/plans/internal-api-push-transport-plan.md`

**Estimated scope:** S

## Task 2: Standardize API SSE Contract Utilities

**Description:** Move the proven `startSse` behavior into a shared API utility and migrate one low-risk stream route to prove the utility without broad route churn.

**Acceptance criteria:**
- [ ] Shared helper preserves `retry`, heartbeat, request abort cleanup, close diagnostics, backpressure timeout, and `Last-Event-ID` capture.
- [ ] Event envelope guidance documents required `ready`, initial snapshot, data, `freshness`, heartbeat/comment, and structured `error` events.
- [ ] One existing route uses the helper only after utility tests pass; do not migrate all local SSE writers in this task.
- [ ] Helper docs state that `Last-Event-ID` is diagnostic only unless a stream explicitly implements durable replay.

**Verification:**
- [ ] Targeted stream utility tests pass with fake response/backpressure cases.
- [ ] `pnpm --filter @workspace/api-server run typecheck`.

**Dependencies:** Task 1

**Files likely touched:**
- `artifacts/api-server/src/services/sse-stream.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/routes/diagnostics.ts` or another single low-risk route
- `artifacts/api-server/src/services/sse-stream.test.ts`

**Estimated scope:** M

## Task 3: Add Backend Stream And Poll Diagnostics

**Description:** Add backend diagnostics counters that distinguish event-triggered stream writes, timer-triggered fallback writes, active SSE clients, stream stale state, stream write backpressure, and route-level fallback polling.

**Acceptance criteria:**
- [ ] Diagnostics can show per-stream active client count, last event age, last fallback poll age, and event-vs-poll write counts.
- [ ] Diagnostics capture write backpressure timeout count and close reason by stream name.
- [ ] Existing backend pressure labels name the actual driver instead of treating all polling as memory pressure.
- [ ] Frontend pressure-label cleanup is deferred to Task 14 after backend diagnostics exist.

**Verification:**
- [ ] Focused diagnostics tests cover event write, fallback write, open, close, and stale cases.
- [ ] `pnpm --filter @workspace/api-server run typecheck`.

**Dependencies:** Task 2

**Files likely touched:**
- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/services/route-admission.ts`
- focused tests

**Estimated scope:** M

## Task 3A: Prove The Freshness Contract On Quotes And Watchlists

**Description:** Add the first end-to-end proof of the reusable freshness contract on the highest-risk user-visible path: quote/watchlist data. This is not a quote-specific workaround. It must prove source movement, backend/SSE delivery, frontend cache application, runtime-store patching, visible row freshness, stale/degraded UI state, and REST fallback eligibility for each symbol.

**Acceptance criteria:**
- [ ] Per-symbol quote freshness distinguishes stream coverage from actual received fresh data.
- [ ] The quote path records or exposes source event age, SSE event age, cache-apply age, runtime ticker patch age, and row-render freshness where practical.
- [ ] REST quote fallback is considered suppressed only while the relevant symbol stream is fresh, not merely while the symbol is in a rotation batch.
- [ ] Watchlist/header/trade quote rows can visibly mark stale/degraded state around the 10-15s target when source data stops unexpectedly.
- [ ] The proof produces a reusable freshness/fallback pattern for account, algo, signal, broker, and option quote paths.

**Verification:**
- [ ] Pyrus tests cover stream event delivery, quote cache patching, runtime ticker store patching, stale indicator behavior, and REST fallback only when the symbol stream is stale/unavailable.
- [ ] Direct read-only stream check outside `?pyrusQa=safe` observes `ready`, quote data events, and per-symbol freshness fields.
- [ ] Safe browser QA checks watchlist/header/trade quote fallback and stale UI behavior without relying on live stream delivery.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`.

**Dependencies:** Tasks 1-3

**Files likely touched:**
- `artifacts/pyrus/src/features/platform/live-streams.ts`
- `artifacts/pyrus/src/features/platform/MarketDataSubscriptionProvider.jsx`
- `artifacts/pyrus/src/features/platform/runtimeTickerStore.js`
- `artifacts/pyrus/src/features/platform/runtimeMarketDataModel.js`
- `artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx`
- `artifacts/pyrus/src/features/platform/HeaderKpiStrip.jsx`
- focused tests

**Estimated scope:** M

### Checkpoint: Foundation

- [ ] Inventory reviewed and accepted.
- [ ] Shared SSE utility has focused tests.
- [ ] Diagnostics can prove whether a future task actually removed polling.
- [ ] Quote/watchlist proof shows stream coverage, received data, cache/store patching, row rendering, stale UI, and fallback eligibility as separate facts.
- [ ] First broader migration target is selected from the ranked inventory, not from prior assumptions.
- [ ] No product route behavior changed beyond the one utility migration.

### Phase 2: P0 Market Data Freshness

## Task 4: Close Quote And Watchlist Freshness Gaps

**Description:** Turn the Task 3A proof into the minimal quote/watchlist implementation needed to make the shared freshness contract real. If Task 3A proves the current quote path already satisfies the contract, this task records a no-op result and moves on. If it exposes gaps, close them before broader migrations.

**Acceptance criteria:**
- [ ] Stream-covered symbols stay out of REST fallback only while the specific symbol has fresh received data.
- [ ] Watchlist, header, trade, and algo-row quote consumers use the same symbol freshness truth where practical.
- [ ] Stale/degraded quote UI appears around the 10-15s target when source data stops unexpectedly.
- [ ] Quote remediation does not create duplicate EventSource owners for the same URL/identity.

**Verification:**
- [ ] Focused Pyrus tests cover fresh stream data, stale stream data, REST fallback eligibility, and stale row display.
- [ ] Direct read-only stream check outside `?pyrusQa=safe` verifies quote events and per-symbol freshness metadata.
- [ ] Safe browser QA checks quote surfaces for layout and fallback behavior.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`.

**Dependencies:** Task 3A

**Files likely touched:**
- `artifacts/pyrus/src/features/platform/live-streams.ts`
- `artifacts/pyrus/src/features/platform/MarketDataSubscriptionProvider.jsx`
- `artifacts/pyrus/src/features/platform/runtimeTickerStore.js`
- `artifacts/pyrus/src/features/platform/runtimeMarketDataModel.js`
- quote-rendering components and focused tests

**Estimated scope:** M

## Task 5: Normalize Position And Option Quote Freshness

**Description:** Apply the same freshness/fallback contract to account position market data and option quotes. Equity position freshness must be keyed by symbol; option quote freshness must be keyed by provider contract id. This task also replaces generic option stream stall behavior with structured stale/unavailable semantics.

**Acceptance criteria:**
- [ ] Equity position quote freshness and option quote freshness use explicit identity keys and visible stale/degraded state.
- [ ] Option stream errors carry stable `code`, `detail`, source, and `cooldownMs` when applicable.
- [ ] REST fallback starts only for explicit stale/unavailable stream states or the approved stall threshold for that identity.
- [ ] Capacity and subscription-limit failures remain visible to diagnostics and UI.

**Verification:**
- [ ] API tests cover structured option stream errors: capacity, subscription limit, unauthorized, unreachable, and no-account.
- [ ] Pyrus tests cover fallback start/stop, stale quote preservation, position quote store updates, and option quote cache identity.
- [ ] `pnpm --filter @workspace/api-server run typecheck`.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`.

**Dependencies:** Tasks 2-4

**Files likely touched:**
- `artifacts/api-server/src/services/bridge-option-quote-stream.ts`
- `artifacts/api-server/src/ws/options-quotes.ts`
- `artifacts/pyrus/src/features/platform/live-streams.ts`
- `artifacts/pyrus/src/features/platform/positionMarketDataStore.js`
- `artifacts/pyrus/src/screens/account/PositionOptionQuoteStreams.jsx`
- focused tests

**Estimated scope:** M

### Checkpoint: P0 Market Data

- [ ] Quote/watchlist and account position market data have one reusable freshness/fallback model.
- [ ] Stale quote state is visible within the target window.
- [ ] REST fallback is identity-specific and stale-aware.
- [ ] Direct stream probes and safe browser QA cover both live delivery and fallback/layout.

### Phase 3: Broker And Account State

## Task 6: Push Bridge State Through Diagnostics SSE

**Description:** Implement the existing bridge-state plan: emit bridge lifecycle changes on `/api/diagnostics/stream` and consume them in runtime/connection UI hooks so broker status stops relying on short-interval REST polling.

**Acceptance criteria:**
- [ ] `bridge-state` event emits when connected, authenticated, socket, server connectivity, market data mode, strict readiness, or connecting state changes.
- [ ] Frontend runtime/connection state updates from the stream and only REST-polls as fallback when the stream is stale or unavailable.
- [ ] Event payload includes source, updatedAt, freshness, and failure/actionability fields needed by the UI.

**Verification:**
- [ ] API unit tests prove `bridge-state` emits only on meaningful changes and preserves last-good state.
- [ ] Pyrus tests prove stream events patch runtime state and stale stream restores REST fallback.
- [ ] Manual read-only stream check: subscribe to `/api/diagnostics/stream` outside `?pyrusQa=safe` and observe `ready`, heartbeat, and `bridge-state`.
- [ ] Safe browser QA checks UI fallback/layout only, because safe mode can suppress live streams.

**Dependencies:** Tasks 1-3A

**Files likely touched:**
- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/routes/diagnostics.ts`
- `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`
- `artifacts/pyrus/src/features/platform/useRuntimeControlSnapshot.js`
- `artifacts/pyrus/src/features/platform/useIbkrLineUsageSnapshot.js`

**Estimated scope:** M

## Task 7: Fan Out Broker Account And Order Changes

**Description:** Introduce API-side account/order stream change notifications from the existing bridge snapshot streams so account page SSE can reuse one producer instead of independently polling live account state every second. This collapses duplicate backend polling; it does not require bridge-native account/order push in this task.

**Acceptance criteria:**
- [ ] Account and order stream producers publish typed internal changes when their snapshots change.
- [ ] Account page live payload listens to those changes for relevant account/mode keys.
- [ ] Account page live timer becomes fallback/watchdog, not the primary producer.
- [ ] The change does not increase bridge API polling frequency or duplicate bridge account/order fetches.

**Verification:**
- [ ] API tests prove one changed bridge account/order snapshot triggers account page live recompute.
- [ ] Tests prove unrelated account/mode changes do not update the wrong account page stream.
- [ ] `pnpm --filter @workspace/api-server run typecheck`.

**Dependencies:** Tasks 2-3A, Task 6

**Files likely touched:**
- `artifacts/api-server/src/services/bridge-streams.ts`
- `artifacts/api-server/src/services/account-page-streams.ts`
- `artifacts/api-server/src/services/account-page-streams.test.ts`
- `artifacts/api-server/src/services/bridge-streams.test.ts`

**Estimated scope:** M

## Task 8: Tighten Account Screen REST Fallback Gating

**Description:** Update AccountScreen refresh policy so stream-backed data disables duplicate REST refetch intervals when fresh, and restores catch-up only when stream freshness expires or filters change.

**Acceptance criteria:**
- [ ] Summary, positions, orders, risk, allocation, and intraday equity do not run duplicate routine REST polling while account page stream is fresh.
- [ ] Filtered derived reads remain explicit and do not get hidden behind live stream freshness.
- [ ] Stale stream restores REST catch-up without waiting for a full page reload.

**Verification:**
- [ ] `pnpm --filter @workspace/pyrus exec node --test src/screens/AccountScreen.positions.test.mjs`.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`.

**Dependencies:** Task 7

**Files likely touched:**
- `artifacts/pyrus/src/screens/AccountScreen.jsx`
- `artifacts/pyrus/src/screens/account/accountRefreshPolicy.js`
- `artifacts/pyrus/src/screens/AccountScreen.positions.test.mjs`
- `artifacts/pyrus/src/screens/account/accountRefreshPolicy.test.mjs`

**Estimated scope:** M

## Task 9: Split Account Derived Data Triggers

**Description:** Keep expensive account derived reads separate from live account ticks. Trigger derived refreshes from relevant account/order/trade/flex changes plus a slow watchdog, not the live 1s loop.

**Acceptance criteria:**
- [ ] Closed trades, cash activity, historical equity, benchmark equity, performance calendar, and Flex health have explicit refresh triggers or documented fallback cadence.
- [ ] Derived stream writes include `kind: "derived"` freshness events and diagnostics.
- [ ] Live account ticks do not invalidate unchanged derived caches.

**Verification:**
- [ ] API tests cover derived trigger filtering and slow watchdog fallback.
- [ ] `pnpm --filter @workspace/api-server run typecheck`.

**Dependencies:** Task 7

**Files likely touched:**
- `artifacts/api-server/src/services/account-page-streams.ts`
- `artifacts/api-server/src/services/account.ts`
- `artifacts/api-server/src/services/account-page-streams.test.ts`
- optional account event helper

**Estimated scope:** M

### Checkpoint: Account Page

- [ ] Bridge runtime state is pushed through diagnostics SSE with stale-aware REST fallback.
- [ ] Account page uses streams as the primary live transport.
- [ ] Account REST fallbacks are stale-aware instead of timer-first.
- [ ] Diagnostics prove duplicate account live polling is lower.
- [ ] Browser safe-QA confirms Account page still renders without stale/undefined state.

### Phase 4: Signal Monitor And Platform Tables

## Task 10: Add Signal Monitor SSE For Active Profile State

**Description:** Add a signal monitor SSE endpoint for active profile state, events, matrix freshness, and source-health updates so SignalsScreen can stop routine 15s/30s REST polling when live platform-managed signal data is enabled.

**Scope note:** Do not start this until the P0 market-data checkpoint passes and the shared stream contract covers Signal Monitor's high-cardinality identity model.

**Acceptance criteria:**
- [ ] Stream emits initial snapshot, signal events, matrix state freshness, profile changes, source-health, and structured errors.
- [ ] Cache identity includes profile, timeframe, symbol, evaluation mode, source strategy, and request origin where applicable.
- [ ] Existing REST endpoints remain valid for initial load, manual refresh, and stale-stream fallback.

**Verification:**
- [ ] API tests cover event identity, profile/timeframe filtering, stale source-health, and reconnect initial snapshot.
- [ ] `pnpm --filter @workspace/api-server run typecheck`.

**Dependencies:** Tasks 2-3A

**Files likely touched:**
- `artifacts/api-server/src/routes/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/api-server/src/services/signal-monitor-streams.ts`
- focused tests

**Estimated scope:** M

## Task 11: Wire SignalsScreen To Signal Monitor SSE

**Description:** Add a frontend stream hook that patches signal monitor query caches and disables routine REST polling while the stream is fresh.

**Acceptance criteria:**
- [ ] `SignalsScreen.jsx` REST polling for state/events/matrix is disabled when the stream is fresh.
- [ ] Stream payloads ignore stale profile/timeframe/symbol contexts.
- [ ] Stale stream or safe-QA mode restores the existing REST polling behavior.

**Verification:**
- [ ] Focused Pyrus tests cover cache patching and fallback gating.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`.

**Dependencies:** Task 10

**Files likely touched:**
- `artifacts/pyrus/src/screens/SignalsScreen.jsx`
- `artifacts/pyrus/src/features/platform/live-streams.ts`
- `artifacts/pyrus/src/features/signals/signalMatrixSnapshotCache.js`
- focused tests

**Estimated scope:** M

## Task 12: Make Algo Cockpit SSE Event-Driven

**Description:** Use existing `notifyAlgoCockpitChanged` events as the primary trigger for cockpit snapshots, with coalescing and a fallback watchdog instead of routine 5s polling.

**Acceptance criteria:**
- [ ] Algo deployment, execution, signal monitor, and signal-options changes trigger one coalesced cockpit snapshot.
- [ ] Fixed 5s polling is reduced to stale/watchdog fallback.
- [ ] Deployment-scoped stream freshness still controls frontend REST catch-up correctly.

**Verification:**
- [ ] `pnpm --filter @workspace/api-server exec tsx --test src/services/algo-cockpit-streams.test.ts`.
- [ ] `pnpm --filter @workspace/pyrus exec node --test src/features/platform/algoMonitorFreshness.test.mjs`.
- [ ] `pnpm --filter @workspace/pyrus exec node --test src/features/platform/live-streams.test.mjs`.

**Dependencies:** Tasks 2-3A

**Files likely touched:**
- `artifacts/api-server/src/services/algo-cockpit-streams.ts`
- `artifacts/api-server/src/services/algo-cockpit-events.ts`
- `artifacts/pyrus/src/features/platform/algoMonitorFreshness.js`
- focused tests

**Estimated scope:** M

## Task 13: Make Shadow Account SSE Event-Driven

**Description:** Convert shadow account stream production from fixed 2s polling to `subscribeShadowAccountChanges` plus a slower watchdog fallback.

**Acceptance criteria:**
- [ ] Ledger changes trigger an immediate coalesced snapshot write.
- [ ] Idle shadow account stream does not fetch every 2s just to prove no change.
- [ ] Watchdog fallback still repairs missed events and marks fallback writes in diagnostics.

**Verification:**
- [ ] `pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-streams.test.ts`.
- [ ] `pnpm --filter @workspace/api-server run typecheck`.

**Dependencies:** Tasks 2-3A

**Files likely touched:**
- `artifacts/api-server/src/services/shadow-account-streams.ts`
- `artifacts/api-server/src/services/shadow-account-events.ts`
- `artifacts/api-server/src/services/shadow-account-streams.test.ts`

**Estimated scope:** S

### Checkpoint: Platform Tables

- [ ] Signals state/events/matrix have a stream-first path.
- [ ] Algo cockpit and shadow account use event-triggered snapshots with measured watchdog fallback.
- [ ] REST polling returns when streams are stale, disabled, or unavailable.
- [ ] Browser safe-QA covers Signals, Account, Algo, Shadow, and Trade quote surfaces.

### Phase 5: Deprecation, Guardrails, And Rollout

## Task 14: Add Polling Deprecation Guardrails

**Description:** Prevent removed polling loops from creeping back by adding a documented allowlist and targeted checks for high-value screens.

**Acceptance criteria:**
- [ ] Allowlist documents every remaining `refetchInterval` or backend `setInterval` in target transport paths with owner, cadence, and fallback reason.
- [ ] Audit check fails if new unowned polling appears in Account, Algo, Signals, runtime diagnostics, or stream services.
- [ ] Diagnostics can show before/after poll count and stream count during QA.
- [ ] Frontend pressure reporting consumes backend stream/poll diagnostics instead of inferring all polling as memory pressure.

**Verification:**
- [ ] New audit check passes.
- [ ] `pnpm run typecheck` still includes existing Replit startup guard.
- [ ] `pnpm run audit:guards` passes before handoff when practical.

**Dependencies:** Tasks 4-13

**Files likely touched:**
- `docs/backend-data-map.md`
- `artifacts/pyrus/src/features/platform/memoryPressureStore.js`
- `artifacts/pyrus/src/features/platform/memoryPressureModel.js`
- `scripts/check-platform-polling-allowlist.mjs`
- `package.json`
- targeted allowlist fixture

**Estimated scope:** M

## Task 15: Safe Rollout And Soak

**Description:** Roll out stream-first behavior behind diagnostics and fallback controls, then verify reduced polling and stable freshness under safe QA and live non-trading navigation.

**Acceptance criteria:**
- [ ] Each migrated path has a kill switch or fallback condition that restores REST polling.
- [ ] Soak report compares active poll count, active stream count, route p95, stream stale events, and UI stale indicators before/after.
- [ ] No trading-control/live order behavior is exercised without explicit approval.

**Verification:**
- [ ] Targeted API and Pyrus tests from all phases pass.
- [ ] `pnpm --filter @workspace/api-server run typecheck`.
- [ ] `pnpm --filter @workspace/pyrus run typecheck`.
- [ ] Browser QA with `?pyrusQa=safe` on Account, Algo, Signals, and Trade quote surfaces for fallback/layout.
- [ ] Direct read-only stream probes outside safe mode for migrated SSE endpoints.

**Dependencies:** Tasks 4-14

**Files likely touched:**
- `docs/backend-data-map.md`
- `SESSION_HANDOFF_*.md`
- QA notes or rollout report

**Estimated scope:** S

### Checkpoint: Complete

- [ ] All migrated paths are stream-first with stale-aware REST fallback.
- [ ] Diagnostics prove lower duplicate polling.
- [ ] Remaining polling is allowlisted and justified.
- [ ] Human review approves moving from plan to implementation.

## Parallelization Opportunities

- Task 1 inventory can split across frontend surfaces, backend routes/streams, provider/bridge ingest, and worker/timer paths as long as the final table uses one shared schema.
- Tasks 2 and 3 should stay sequential because diagnostics should build on the shared SSE utility.
- Tasks 4 and 5 should stay sequential because Task 5 applies the quote freshness contract to position and option identities.
- Task 6 can proceed in parallel with Task 5 after Task 3A if the implementation team is split, because broker runtime state does not own quote cache identity.
- After Task 7 defines account/order change notifications, Tasks 8 and 9 can run in parallel if cache identity and freshness events are agreed first.
- Tasks 10, 12, and 13 can run in parallel after Tasks 2-3A if they keep separate stream identities and diagnostics names.
- Task 14 waits until the migrated-path allowlist shape is proven by at least one P0 market-data path and one account/signal/algo path.

## Test Coverage Review

```text
CODE PATHS                                                    USER FLOWS
[GAP] platform freshness inventory                            [GAP] Watchlist/quote freshness
  - frontend pollers, streams, timers, reducers                  - prices should not silently stick for minutes
  - backend routes, stream producers, bridge/provider ingest     - stale indicators around 10-15s when source stops
  - trigger type and fallback classification                     - source-change-to-visible-update target around 1-2s

[GAP] shared SSE utility                                      [GAP] Runtime/header broker state
  - headers, retry, heartbeat, abort cleanup                    - bridge-state updates without broker REST polling
  - drain timeout and close reason                              - stale stream restores REST fallback
  - Last-Event-ID diagnostic only                               - safe mode still renders fallback state

[GAP] backend stream diagnostics                              [GAP] Account page
  - open/close counters                                         - stream-fresh live rows avoid duplicate REST refetch
  - event write vs fallback write                               - filters still trigger explicit derived reads
  - write backpressure timeout                                  - stale stream restores catch-up

[GAP] quote/watchlist freshness proof                         [GAP] Stale-price visibility
  - stream coverage vs received symbol data                      - rows should show stale/degraded state around 10-15s
  - SSE receive -> cache apply -> runtime patch                  - REST fallback should return only for stale symbols
  - row render freshness                                         - source-change-to-visible-update target around 1-2s

[GAP] position/option quote freshness                         [GAP] Position PnL stale visibility
  - symbol/provider-contract identity                           - stale equity and option marks are visible
  - structured option stream errors                             - REST fallback is per identity, not broad
  - fallback start/stop tests                                   - account positions do not hide stale quotes

[PARTIAL] shadow/algo event-driven streams                    [GAP] Signals matrix identity
  - existing frontend cache/freshness tests exist                - profile/timeframe/symbol identity cannot bleed
  - missing backend event-trigger/watchdog tests                 - source-health explains stale/live state
  - deployment-scoped freshness gates REST catch-up              - shell-wide freshness does not hide scoped stale data
```

Required test additions before implementation is considered complete:

- Inventory acceptance checks for frontend pollers, stream consumers, backend stream producers, provider/bridge ingest, worker/timer paths, and quote/watchlist freshness paths.
- SSE utility tests for abort cleanup, backpressure timeout, heartbeat, structured errors, and reconnect initial snapshot.
- Diagnostics tests for event writes, fallback writes, active clients, close reasons, and stale stream counters.
- Watchlist/quote freshness tests for stream delivery, cache patching, runtime store patching, row render freshness, stale indicator behavior, and REST fallback only when the symbol stream is stale/unavailable.
- Position/option quote tests for symbol/provider-contract identity, structured stream errors, stale marks, and per-identity REST fallback.
- Bridge diagnostics tests for `bridge-state` event emission, last-good state, stale stream fallback, and runtime UI patching.
- Account page tests for account/mode/filter identity before any account-page polling reduction lands.
- Signal Monitor tests for profile/timeframe/symbol/source identity, source-health events, and stale-stream fallback.
- Shadow stream tests for ledger-triggered push, coalesced bursts, watchdog fallback, and no idle 2s snapshot fetch.
- Algo stream tests for change-triggered push, coalesced bursts, watchdog fallback, deployment/mode filtering, and REST catch-up gating.

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Event storms after replacing timers | High | Coalesce domain events, cap queued writes, preserve backpressure timeout, and track event-vs-poll counts. |
| Implementation jumps to cleanup before P0 freshness proof | High | Enforce Tasks 1-3A before any broader migration and complete Tasks 4-5 before lower-priority stream cleanup. |
| UI treats stream `ready` as fresh data | High | Require separate freshness/source-health fields and add reducer tests for ready-only streams. |
| Cache bleed across account, profile, mode, symbol, or timeframe | High | Include identity keys in backend payloads and frontend query-key patch tests. |
| Stream outage hides stale data | High | Keep REST fallback until diagnostics prove stream health; display stale/degraded source state. |
| Live broker/order paths change accidentally | High | Keep order submission semantics out of scope and test order/account stream changes as read-only. |
| Reconnect loses events because replay is assumed | High | Require initial snapshot after reconnect; treat `Last-Event-ID` as diagnostic only unless durable replay is explicitly designed. |
| Safe-QA gives false confidence about live streams | Medium | Use safe-QA for fallback/layout and direct read-only stream probes for live SSE delivery. |
| Broad dirty worktree creates merge conflicts | Medium | Ship one vertical slice at a time and update handoff after each meaningful validation. |
| Duplicated SSE utilities diverge | Medium | Migrate one low-risk route first, then migrate other writers only after tests pass. |

## Decision Gates

- Gate 1: Task 1 inventory acceptance. P0/P1 paths must have source, stream endpoint, cache/store owner, fallback gate, freshness risk, and retained-poll classification before code work starts.
- Gate 2: Task 3A contract proof. Quote/watchlist freshness must separate stream coverage, received data, cache patching, runtime store patching, row rendering, stale UI, and REST fallback eligibility.
- Gate 3: P0 market-data closeout. Tasks 4-5 must prove stale-aware fallback for equity quotes, account position quotes, and option quote identities before account/signal/algo cleanup.
- Gate 4: Provider-native push phase. Provider webhooks, provider WebSockets, and bridge-native events are evaluated only after the internal SSE/domain-event baseline works; if a provider has no usable push source, keep one owned backend adapter/watchdog and mark it retained.
- Gate 5: Polling allowlist. Every remaining `refetchInterval`, `setInterval`, worker loop, historical backfill, bridge adapter loop, and watchdog must have owner, cadence, fallback reason, and diagnostic visibility before rollout.

## Approval Gate

Do not start product-code implementation from the middle of the plan. The first implementation session starts at Task 1 completion or Task 2, then proceeds through Tasks 3 and 3A before broader migration work. Account, signal, broker, shadow, and algo migration work waits until the Foundation checkpoint passes.
