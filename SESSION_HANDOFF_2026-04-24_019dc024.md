# Session Handoff — 2026-04-24

## Session Metadata

- Session ID: `019dc024-8786-7290-aa97-dff4eec34c44`
- Saved At (UTC): `2026-04-24T18:35:46.995Z`
- Repo Root: `/home/runner/workspace`
- Thread CWD: `/home/runner/workspace`
- Rollout Path: `/home/runner/.codex/sessions/2026/04/24/rollout-2026-04-24T15-38-32-019dc024-8786-7290-aa97-dff4eec34c44.jsonl`
- Branch: `main`
- HEAD: `5a859dee7bf43e61b6f91a7fa0649a72db798765`
- Latest Commit: `Add a file to document the bubblewrap warning in Codex`
- Latest Commit Session ID: `d56ae97d-ce5b-4897-beba-c1c01ae8f27e`
- Title: • Proposed Plan


  # Full Phased Plan: Realtime Backend Monitoring, UI
  Stream Pausing, IBKR Dedupe

  ## Summary

  Unify the original B/C tasks with the realtime trading
  requirement. The backend API server becomes the always-
  on RayReplica signal monitor. The browser no longer
  drives automatic evaluation; it only displays state and
  provides manual controls. Page Visibility is applied
  only to display-heavy browser streams. Backend heavy
  endpoint coalescing is verified, and frontend heavy GET
  single-flight is added to reduce duplicate IBKR load.

  ## Phase 0: Guardrails And Scope

  - Work in logicalorigin/trading-platform, local path /
    home/runner/workspace.
  - V1 is signal-only. Do not submit orders automatically.
  - Do not execute algo_deployments as strategies in this
    work; deployments currently store promoted backtest
    config but no runtime evaluator exists.
  - Do not pause backend monitoring based on browser
    visibility.
  - Do not pause account, order, or execution frontend
    streams in the first visibility pass.
  - Do not add a second backend dedupe layer over existing
    barsInFlight, optionChainInFlight, and
    flowEventsInFlight.

  ## Phase 1: Refactor Signal Monitor For Worker Reuse

  - In artifacts/api-server/src/services/signal-
    monitor.ts, extract route-independent helpers from the
    current evaluateSignalMonitor() flow.
  - Add a worker-safe profile evaluator that accepts a
    resolved persisted profile and does not mutate profile
    settings.
  - Keep the route-level evaluateSignalMonitor() as the
    manual “Scan now” wrapper.
  - Preserve existing behavior for manual scan:
      - optional watchlistId may still update the profile
        through the route path
      - hydrate/incremental modes still work
      - response shape remains unchanged
  - Worker helper behavior:
      - resolves the persisted profile watchlist only
      - evaluates the profile universe
      - writes symbol state
      - inserts deduped signal events through existing
        eventKey
      - updates profile lastEvaluatedAt and lastError
  - No OpenAPI change is needed for this phase.

  ## Phase 2: Add API-Server Signal Monitor Worker

  - Add artifacts/api-server/src/services/trade-monitor-
    worker.ts.
  - Export:
      - startTradeMonitorWorker(): void
      - stopTradeMonitorWorker(): void
  - Start it from artifacts/api-server/src/index.ts after
    app.listen, beside startAccountFlexRefreshScheduler().
  - Use pool from @workspace/db for advisory locking.
  - Use session-scoped advisory locking around each worker
    tick:
      - acquire with pg_try_advisory_lock
      - skip tick if lock is unavailable
      - release in finally
      - do not hold a DB transaction open across IBKR/
        network calls
  - Add in-process guards so the same profile cannot
    evaluate concurrently.
  - Poll enabled signal_monitor_profiles every 5s for
    config changes.
  - Do not evaluate every symbol every 5s; use the tick
    only as a scheduler/wakeup.
  - For each enabled profile:
      - resolve watchlist symbols via existing monitor
        universe logic
      - respect maxSymbols
      - respect evaluationConcurrency, capped at 10
      - evaluate only symbols whose latest completed bar
        has advanced
  - On worker errors:
      - update profile lastError
      - avoid crashing the API server
      - continue future ticks

  ## Phase 3: Completed-Bar Evaluation Rules

  - Use getBars() as the authoritative source before
    running evaluateRayReplicaSignals.
  - Exclude bars where partial === true.
  - Treat timestamp as bar start.
  - A bar is eligible only when:
      - timestamp + timeframeDuration + safetyDelay <= now
      - safety delay defaults to a small fixed value, e.g.
        2s for intraday
  - For 1d, use a conservative rule:
      - do not evaluate today’s daily bar as completed
        during the same trading day
      - only evaluate the latest prior daily bar unless
        the latest bar date is before today
  - Track last evaluated keys in memory:
      - profileId:symbol:timeframe:latestBarAt
  - Skip unchanged keys.
  - Keep existing includeProvisionalSignals: false.
  - Preserve existing freshness/staleness semantics where
    possible.

  ## Phase 4: Frontend Signal Monitor Ownership Change

  - In artifacts/rayalgo/src/RayAlgoPlatform.jsx, remove
    the automatic setInterval that calls
    evaluateSignalMonitor.
  - Keep the manual “Scan now” path.
  - Keep profile/state/events queries:
      - /api/signal-monitor/profile
      - /api/signal-monitor/state
      - /api/signal-monitor/events
  - Use these queries only to display backend worker
    output.
  - Continue publishing snapshots to
    signalMonitorStore.js.
  - Adjust workload stats so “Signal monitor” no longer
    represents a browser poll/evaluator. It should either
    be removed or relabeled as display refresh.
  - Market/Watchlist badges should continue to read from
    signalMonitorStore.js.

  ## Phase 5: Page Visibility For Display SSE

  - Add a shared frontend visibility helper, e.g.
    usePageVisible(), based on document.visibilityState.
  - Default SSR/non-browser behavior to visible.
  - Apply it to display-heavy streams only:
      - chart/historical bar UI streams
      - quote dashboard/watchlist streams
      - option-chain display streams
      - market-depth panel streams
      - frontend stock aggregate UI singleton
  - For normal hook-local EventSources:
      - include pageVisible in the effect guard/
        dependencies
      - cleanup closes stream when hidden
      - visible return recreates stream
  - For the frontend stock aggregate singleton:
      - add module-level pause/resume awareness
      - hidden state must close the singleton EventSource
        even if consumers remain mounted
      - visible state refreshes the union subscription
        immediately
  - Do not pause:
      - account streams
      - order streams
      - execution streams
      - backend worker streams
  - On visible return:
      - reconnect paused streams
      - invalidate/refetch key dashboard queries so UI
        catches up

  ## Phase 6: Frontend Heavy GET Single-Flight

  - Implement in lib/api-client-react/src/custom-fetch.ts.
  - Apply only to GET requests whose normalized pathname
    is:
      - /api/bars
      - /api/options/chains
      - /api/flow/events
  - Build dedupe key from:
      - method
      - normalized URL/path
      - sorted query params
      - response type
      - effective headers after auth injection
  - Maintain a module-level map of in-flight heavy
    requests.
  - Identical requests share the same upstream fetch.
  - Distinct heavy requests run through a small queue
    capped at 3.
  - Do not apply to:
      - SSE endpoints
      - order endpoints
      - account/order/execution queries
      - mutations
  - Decouple caller abort from shared upstream fetch:
      - one caller abort rejects that caller
      - shared upstream request continues for other
        waiters
  - Remove entries from in-flight map in finally.

  ## Phase 7: Backend Dedupe Verification

  - Confirm existing backend protection:
      - /api/bars: barsInFlight plus short result cache
        and reusable larger-limit slicing
      - /api/options/chains: optionChainInFlight plus
        short cache
      - /api/flow/events: flowEventsInFlight plus short
        cache
  - Add focused tests or assertions around current
    behavior where practical.
  - Do not replace these maps unless a concrete bug is
    found.
  - Ensure worker calls use these same service functions
    so monitoring benefits from backend coalescing.

  ## Phase 8: Tests

  - Add non-live API-server tests using node --test and
    mocks/stubs where needed.
  - Worker tests:
      - starts once
      - stops cleanly
      - prevents same-profile overlap
        events
      - unchanged latest completed bar is skipped
      - partial/in-progress bars are ignored
  - Frontend/custom-fetch tests:
      - identical heavy GETs share one fetch
      - distinct heavy GETs cap at 3
      - aborted waiter does not abort shared upstream work
      - non-heavy paths are unaffected
  - Run:
      - API server typecheck
      - frontend typecheck
      - API client typecheck
      - existing frontend unit tests where relevant

  ## Phase 9: Manual Acceptance

  - With browser visible:
      - UI streams remain live
      - display-heavy EventSources close
      - account/order/execution streams are not paused
      - backend signal monitor continues updating DB
        state/events
  - With browser closed:
      - backend signal monitor continues updating DB
        state/events
  - On browser return:
      - display streams reconnect
      - dashboard queries catch up
  - Under duplicate UI load:
      - duplicate /api/bars, /api/options/chains, /api/
        flow/events calls share frontend work
      - backend does not duplicate upstream IBKR work

  ## Assumptions

  - V1 supports existing RayReplica/bar-based signal
    monitoring only.
  - Flow/option-chain strategies are future work.
  - Automatic order submission is future work.
  - Browser UI is a dashboard/control surface; API server
    is the realtime monitor.

## Current User Request

• Proposed Plan


  # Full Phased Plan: Realtime Backend Monitoring, UI
  Stream Pausing, IBKR Dedupe

  ## Summary

  Unify the original B/C tasks with the realtime trading
  requirement. The backend API server becomes the always-
  on RayReplica signal monitor. The browser no longer
  drives automatic evaluation; it only displays state and
  provides manual controls. Page Visibility is applied
  only to display-heavy browser streams. Backend heavy
  endpoint coalescing is verified, and frontend heavy GET
  single-flight is added to reduce duplicate IBKR load.

  ## Phase 0: Guardrails And Scope

  - Work in logicalorigin/trading-platform, local path /
    home/runner/workspace.
  - V1 is signal-only. Do not submit orders automatically.
  - Do not execute algo_deployments as strategies in this
    work; deployments currently store promoted backtest
    config but no runtime evaluator exists.
  - Do not pause backend monitoring based on browser
    visibility.
  - Do not pause account, order, or execution frontend
    streams in the first visibility pass.
  - Do not add a second backend dedupe layer over existing
    barsInFlight, optionChainInFlight, and
    flowEventsInFlight.

  ## Phase 1: Refactor Signal Monitor For Worker Reuse

  - In artifacts/api-server/src/services/signal-
    monitor.ts, extract route-independent helpers from the
    current evaluateSignalMonitor() flow.
  - Add a worker-safe profile evaluator that accepts a
    resolved persisted profile and does not mutate profile
    settings.
  - Keep the route-level evaluateSignalMonitor() as the
    manual “Scan now” wrapper.
  - Preserve existing behavior for manual scan:
      - optional watchlistId may still update the profile
        through the route path
      - hydrate/incremental modes still work
      - response shape remains unchanged
  - Worker helper behavior:
      - resolves the persisted profile watchlist only
      - evaluates the profile universe
      - writes symbol state
      - inserts deduped signal events through existing
        eventKey
      - updates profile lastEvaluatedAt and lastError
  - No OpenAPI change is needed for this phase.

  ## Phase 2: Add API-Server Signal Monitor Worker

  - Add artifacts/api-server/src/services/trade-monitor-
    worker.ts.
  - Export:
      - startTradeMonitorWorker(): void
      - stopTradeMonitorWorker(): void
  - Start it from artifacts/api-server/src/index.ts after
    app.listen, beside startAccountFlexRefreshScheduler().
  - Use pool from @workspace/db for advisory locking.
  - Use session-scoped advisory locking around each worker
    tick:
      - acquire with pg_try_advisory_lock
      - skip tick if lock is unavailable
      - release in finally
      - do not hold a DB transaction open across IBKR/
        network calls
  - Add in-process guards so the same profile cannot
    evaluate concurrently.
  - Poll enabled signal_monitor_profiles every 5s for
    config changes.
  - Do not evaluate every symbol every 5s; use the tick
    only as a scheduler/wakeup.
  - For each enabled profile:
      - resolve watchlist symbols via existing monitor
        universe logic
      - respect maxSymbols
      - respect evaluationConcurrency, capped at 10
      - evaluate only symbols whose latest completed bar
        has advanced
  - On worker errors:
      - update profile lastError
      - avoid crashing the API server
      - continue future ticks

  ## Phase 3: Completed-Bar Evaluation Rules

  - Use getBars() as the authoritative source before
    running evaluateRayReplicaSignals.
  - Exclude bars where partial === true.
  - Treat timestamp as bar start.
  - A bar is eligible only when:
      - timestamp + timeframeDuration + safetyDelay <= now
      - safety delay defaults to a small fixed value, e.g.
        2s for intraday
  - For 1d, use a conservative rule:
      - do not evaluate today’s daily bar as completed
        during the same trading day
      - only evaluate the latest prior daily bar unless
        the latest bar date is before today
  - Track last evaluated keys in memory:
      - profileId:symbol:timeframe:latestBarAt
  - Skip unchanged keys.
  - Keep existing includeProvisionalSignals: false.
  - Preserve existing freshness/staleness semantics where
    possible.

  ## Phase 4: Frontend Signal Monitor Ownership Change

  - In artifacts/rayalgo/src/RayAlgoPlatform.jsx, remove
    the automatic setInterval that calls
    evaluateSignalMonitor.
  - Keep the manual “Scan now” path.
  - Keep profile/state/events queries:
      - /api/signal-monitor/profile
      - /api/signal-monitor/state
      - /api/signal-monitor/events
  - Use these queries only to display backend worker
    output.
  - Continue publishing snapshots to
    signalMonitorStore.js.
  - Adjust workload stats so “Signal monitor” no longer
    represents a browser poll/evaluator. It should either
    be removed or relabeled as display refresh.
  - Market/Watchlist badges should continue to read from
    signalMonitorStore.js.

  ## Phase 5: Page Visibility For Display SSE

  - Add a shared frontend visibility helper, e.g.
    usePageVisible(), based on document.visibilityState.
  - Default SSR/non-browser behavior to visible.
  - Apply it to display-heavy streams only:
      - chart/historical bar UI streams
      - quote dashboard/watchlist streams
      - option-chain display streams
      - market-depth panel streams
      - frontend stock aggregate UI singleton
  - For normal hook-local EventSources:
      - include pageVisible in the effect guard/
        dependencies
      - cleanup closes stream when hidden
      - visible return recreates stream
  - For the frontend stock aggregate singleton:
      - add module-level pause/resume awareness
      - hidden state must close the singleton EventSource
        even if consumers remain mounted
      - visible state refreshes the union subscription
        immediately
  - Do not pause:
      - account streams
      - order streams
      - execution streams
      - backend worker streams
  - On visible return:
      - reconnect paused streams
      - invalidate/refetch key dashboard queries so UI
        catches up

  ## Phase 6: Frontend Heavy GET Single-Flight

  - Implement in lib/api-client-react/src/custom-fetch.ts.
  - Apply only to GET requests whose normalized pathname
    is:
      - /api/bars
      - /api/options/chains
      - /api/flow/events
  - Build dedupe key from:
      - method
      - normalized URL/path
      - sorted query params
      - response type
      - effective headers after auth injection
  - Maintain a module-level map of in-flight heavy
    requests.
  - Identical requests share the same upstream fetch.
  - Distinct heavy requests run through a small queue
    capped at 3.
  - Do not apply to:
      - SSE endpoints
      - order endpoints
      - account/order/execution queries
      - mutations
  - Decouple caller abort from shared upstream fetch:
      - one caller abort rejects that caller
      - shared upstream request continues for other
        waiters
  - Remove entries from in-flight map in finally.

  ## Phase 7: Backend Dedupe Verification

  - Confirm existing backend protection:
      - /api/bars: barsInFlight plus short result cache
        and reusable larger-limit slicing
      - /api/options/chains: optionChainInFlight plus
        short cache
      - /api/flow/events: flowEventsInFlight plus short
        cache
  - Add focused tests or assertions around current
    behavior where practical.
  - Do not replace these maps unless a concrete bug is
    found.
  - Ensure worker calls use these same service functions
    so monitoring benefits from backend coalescing.

  ## Phase 8: Tests

  - Add non-live API-server tests using node --test and
    mocks/stubs where needed.
  - Worker tests:
      - starts once
      - stops cleanly
      - prevents same-profile overlap
        events
      - unchanged latest completed bar is skipped
      - partial/in-progress bars are ignored
  - Frontend/custom-fetch tests:
      - identical heavy GETs share one fetch
      - distinct heavy GETs cap at 3
      - aborted waiter does not abort shared upstream work
      - non-heavy paths are unaffected
  - Run:
      - API server typecheck
      - frontend typecheck
      - API client typecheck
      - existing frontend unit tests where relevant

  ## Phase 9: Manual Acceptance

  - With browser visible:
      - UI streams remain live
      - display-heavy EventSources close
      - account/order/execution streams are not paused
      - backend signal monitor continues updating DB
        state/events
  - With browser closed:
      - backend signal monitor continues updating DB
        state/events
  - On browser return:
      - display streams reconnect
      - dashboard queries catch up
  - Under duplicate UI load:
      - duplicate /api/bars, /api/options/chains, /api/
        flow/events calls share frontend work
      - backend does not duplicate upstream IBKR work

  ## Assumptions

  - V1 supports existing RayReplica/bar-based signal
    monitoring only.
  - Flow/option-chain strategies are future work.
  - Automatic order submission is future work.
  - Browser UI is a dashboard/control surface; API server
    is the realtime monitor.

## Prior Handoffs

- `SESSION_HANDOFF_2026-04-24_019dc022.md`
- `SESSION_HANDOFF_2026-04-23_019dba9b.md`
- `SESSION_HANDOFF_2026-04-22_019db54f.md`
- `SESSION_HANDOFF_2026-04-20.md`

## Recent User Messages

- `2026-04-24T17:08:19.000Z` please review the features and tools of the chart frame and the function/display. im not dropdowns when clicked (i think they are behind the chart space)
- `2026-04-24T17:09:33.000Z` actually itjust looks like they might take a really long time to appear? seems to work on the trade page, but not the market page
- `2026-04-24T17:17:14.000Z` Implement the plan.
- `2026-04-24T17:28:05.000Z` can we get these dropdowns formatting in tradingview widget style?
- `2026-04-24T17:34:14.000Z` instead of a master premium flow indicator on the market page, i want each chart to have a premium flow indicator that lives underneath each chart. please plan this out, including the data source the options premium flow for each indicator should source from
- `2026-04-24T17:37:48.000Z` any gaps? check for detail and stretched assumptions before updating plan
- `2026-04-24T17:47:53.000Z` Implement the plan.
- `2026-04-24T18:00:57.000Z` can you please check your work? how can it be improved?
- `2026-04-24T18:05:48.000Z` add to your plan how we can include UI features to represent scanning (spinner)
- `2026-04-24T18:08:22.000Z` please review for gaps and lack of certainty
- `2026-04-24T18:10:12.000Z` Implement the plan.
- `2026-04-24T18:35:32.000Z` please prepare this session for handoff

## High-Signal Changed Files

- `artifacts/api-server/package.json`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/providers/ibkr/bridge-client.ts`
- `artifacts/api-server/src/providers/ibkr/client.ts`
- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/services/signal-monitor.ts`
- `artifacts/ibkr-bridge/src/app.ts`
- `artifacts/ibkr-bridge/src/client-portal-provider.ts`
- `artifacts/ibkr-bridge/src/provider.ts`
- `artifacts/ibkr-bridge/src/service.ts`
- `artifacts/ibkr-bridge/src/tws-provider.ts`
- `artifacts/rayalgo/package.json`
- `artifacts/rayalgo/src/RayAlgoPlatform.jsx`
- `artifacts/rayalgo/src/app/App.tsx`
- `artifacts/rayalgo/src/components/trading/LightweightCharts.jsx`
- `artifacts/rayalgo/src/components/ui/dropdown-menu.tsx`
- `artifacts/rayalgo/src/components/ui/popover.tsx`
- `artifacts/rayalgo/src/features/charting/ResearchChartSurface.test.ts`
- `artifacts/rayalgo/src/features/charting/ResearchChartSurface.tsx`
- `artifacts/rayalgo/src/features/charting/ResearchChartWidgetChrome.tsx`
- `artifacts/rayalgo/src/features/charting/index.ts`
- `artifacts/rayalgo/src/features/charting/useMassiveStockAggregateStream.ts`
- `artifacts/rayalgo/src/features/charting/useMassiveStreamedStockBars.ts`
- `artifacts/rayalgo/src/features/platform/live-streams.ts`
- `artifacts/rayalgo/src/features/platform/tradeOptionChainStore.js`
- `artifacts/rayalgo/src/index.css`
- `artifacts/rayalgo/src/screens/MarketScreen.jsx`
- `artifacts/rayalgo/src/screens/ResearchScreen.jsx`
- `artifacts/rayalgo/src/screens/TradeScreen.jsx`
- `lib/api-client-react/package.json`

## Repo State Snapshot

```text
## main...origin/main
 M artifacts/api-server/package.json
 M artifacts/api-server/src/index.ts
 M artifacts/api-server/src/providers/ibkr/bridge-client.ts
 M artifacts/api-server/src/providers/ibkr/client.ts
 M artifacts/api-server/src/services/platform.ts
 M artifacts/api-server/src/services/signal-monitor.ts
 M artifacts/ibkr-bridge/src/app.ts
 M artifacts/ibkr-bridge/src/client-portal-provider.ts
 M artifacts/ibkr-bridge/src/provider.ts
 M artifacts/ibkr-bridge/src/service.ts
 M artifacts/ibkr-bridge/src/tws-provider.ts
 M artifacts/rayalgo/package.json
 M artifacts/rayalgo/src/RayAlgoPlatform.jsx
 M artifacts/rayalgo/src/app/App.tsx
 M artifacts/rayalgo/src/components/trading/LightweightCharts.jsx
 M artifacts/rayalgo/src/components/ui/dropdown-menu.tsx
 M artifacts/rayalgo/src/components/ui/popover.tsx
 M artifacts/rayalgo/src/features/charting/ResearchChartSurface.test.ts
 M artifacts/rayalgo/src/features/charting/ResearchChartSurface.tsx
 M artifacts/rayalgo/src/features/charting/ResearchChartWidgetChrome.tsx
 M artifacts/rayalgo/src/features/charting/index.ts
 M artifacts/rayalgo/src/features/charting/useMassiveStockAggregateStream.ts
 M artifacts/rayalgo/src/features/charting/useMassiveStreamedStockBars.ts
 M artifacts/rayalgo/src/features/platform/live-streams.ts
 M artifacts/rayalgo/src/features/platform/tradeOptionChainStore.js
 M artifacts/rayalgo/src/index.css
 M artifacts/rayalgo/src/screens/MarketScreen.jsx
 M artifacts/rayalgo/src/screens/ResearchScreen.jsx
 M artifacts/rayalgo/src/screens/TradeScreen.jsx
 M lib/api-client-react/package.json
 M lib/api-client-react/src/custom-fetch.ts
 M pnpm-lock.yaml
?? SESSION_HANDOFF_2026-04-24_019dc022.md
?? artifacts/api-server/src/services/trade-monitor-worker.test.ts
?? artifacts/api-server/src/services/trade-monitor-worker.ts
?? artifacts/rayalgo/src/features/platform/premiumFlowIndicator.js
?? artifacts/rayalgo/src/features/platform/premiumFlowIndicator.test.js
?? artifacts/rayalgo/src/features/platform/tradeOptionChainStore.test.js
?? artifacts/rayalgo/src/features/platform/usePageVisible.ts
?? artifacts/rayalgo/src/features/trade/
?? attached_assets/Pasted--need-you-to-solve-the-sandbox-issue-we-re-having-whats_1777044706310.txt
?? attached_assets/Pasted-Review-of-codex-s-ticker-search-work-Architecture-is-ge_1777042406259.txt
?? lib/api-client-react/src/custom-fetch.test.mjs
```

## Diff Summary

```text
 artifacts/api-server/package.json                  |   4 +-
 artifacts/api-server/src/index.ts                  |   2 +
 .../api-server/src/providers/ibkr/bridge-client.ts |  47 +
 artifacts/api-server/src/providers/ibkr/client.ts  | 106 +++
 artifacts/api-server/src/services/platform.ts      | 191 ++++-
 .../api-server/src/services/signal-monitor.ts      | 333 +++++--
 artifacts/ibkr-bridge/src/app.ts                   |  44 +
 .../ibkr-bridge/src/client-portal-provider.ts      |  10 +
 artifacts/ibkr-bridge/src/provider.ts              |   5 +
 artifacts/ibkr-bridge/src/service.ts               |   8 +
 artifacts/ibkr-bridge/src/tws-provider.ts          |  48 ++
 artifacts/rayalgo/package.json                     |   2 +-
 artifacts/rayalgo/src/RayAlgoPlatform.jsx          | 952 +++++++++++++++------
 artifacts/rayalgo/src/app/App.tsx                  |  36 +-
 .../src/components/trading/LightweightCharts.jsx   |  73 +-
 .../rayalgo/src/components/ui/dropdown-menu.tsx    |  11 +-
 artifacts/rayalgo/src/components/ui/popover.tsx    |   8 +-
 .../features/charting/ResearchChartSurface.test.ts |  49 ++
 .../src/features/charting/ResearchChartSurface.tsx | 140 ++-
 .../charting/ResearchChartWidgetChrome.tsx         | 162 +++-
 artifacts/rayalgo/src/features/charting/index.ts   |   1 +
 .../charting/useMassiveStockAggregateStream.ts     |  26 +
 .../charting/useMassiveStreamedStockBars.ts        |   5 +-
 .../rayalgo/src/features/platform/live-streams.ts  |  12 +-
 .../src/features/platform/tradeOptionChainStore.js | 129 ++-
 artifacts/rayalgo/src/index.css                    |  88 ++
 artifacts/rayalgo/src/screens/MarketScreen.jsx     | 359 +-------
 artifacts/rayalgo/src/screens/ResearchScreen.jsx   |  47 +-
 artifacts/rayalgo/src/screens/TradeScreen.jsx      | 506 +++++++++--
 lib/api-client-react/package.json                  |   7 +
 lib/api-client-react/src/custom-fetch.ts           | 289 ++++++-
 pnpm-lock.yaml                                     |   7 +
 32 files changed, 2914 insertions(+), 793 deletions(-)
```

## What Changed This Session

- Continued the Market page chart-frame workstream after prior backend/frontend realtime-monitor changes.
- Implemented per-chart options premium flow indicators under each Market chart in `artifacts/rayalgo/src/RayAlgoPlatform.jsx`.
  - Each visible chart slot now has a compact fixed-height flow strip below the chart.
  - The strip shows net premium, call/put split, event count, unusual count, latest update, and a tiny cumulative premium sparkline.
  - The strip is marked `data-chart-control-root` so chart focus/double-click handlers do not treat it as chart canvas interaction.
- Removed the old master selected-ticker `Premium Tide` panel from `artifacts/rayalgo/src/screens/MarketScreen.jsx`.
  - Market page still uses the shared market-flow snapshot for activity feed, sector flow, put/call, and popular tickers.
  - Per-chart strips use the visible chart symbols, not the selected ticker.
- Added `artifacts/rayalgo/src/features/platform/premiumFlowIndicator.js` and tests.
  - Builds per-symbol summaries from UI-mapped `ticker` events or raw `underlying` events.
  - Groups events in one pass for chart-grid use.
  - Ignores unknown option sides instead of counting them as calls.
  - Exposes `resolvePremiumFlowDisplayState()` for deterministic `Queued flow`, `Scanning`, `No options flow`, `Flow error`, `Stale flow`, and live source labels.
- Added scanning/queued UI state in `RayAlgoPlatform.jsx`.
  - Active scan: rotating inline spinner.
  - Queued before first scan: pulsing inline dot.
  - Live/empty/error/stale: no animation.
  - Status text uses `role="status"` and `aria-live="polite"`.
  - Reduced-motion media rule disables the animations.
- Reduced avoidable duplicate `/api/flow/events` requests for default unusual threshold.
  - `MarketScreen.jsx` now passes `unusualThreshold` to `MultiChartGrid` only when it is a non-default positive value.
  - Default threshold `1` is omitted so chart-grid flow calls can share frontend/backend cache keys with the existing shared flow runtime.
- Updated `artifacts/rayalgo/package.json` unit test script to include `tradeOptionChainStore.test.js` and `premiumFlowIndicator.test.js`.
- Earlier changes in this same dirty worktree, captured by prior handoff `SESSION_HANDOFF_2026-04-24_019dc022.md`, include broader work on:
  - API-server signal monitor worker and tests.
  - Page visibility / stream pausing.
  - frontend heavy GET single-flight.
  - chart dropdown/popover layering and TradingView-style chart widget formatting.

## Current Status

- Branch is `main`; repo remains dirty with many related and pre-existing changes. Do not reset or revert without first inspecting ownership.
- Current handoff file itself is new and untracked: `SESSION_HANDOFF_2026-04-24_019dc024.md`.
- Relevant validation completed in this session:
  - `pnpm --filter @workspace/rayalgo test:unit` passed with 33 tests.
  - `pnpm --filter @workspace/rayalgo typecheck` passed.
  - `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/rayalgo build` passed.
  - `git diff --check -- artifacts/rayalgo/src/RayAlgoPlatform.jsx artifacts/rayalgo/src/screens/MarketScreen.jsx artifacts/rayalgo/src/features/platform/premiumFlowIndicator.js artifacts/rayalgo/src/features/platform/premiumFlowIndicator.test.js artifacts/rayalgo/package.json` passed.
- Production build emits the existing chunk-size warning for large bundles; build still succeeds.
- Browser visual verification was not completed because Playwright browser binaries are missing in this environment.
  - `playwright-cli open ...` failed earlier with Chrome missing at `/opt/google/chrome/chrome`.
  - Firefox fallback also reported missing browser install.
- Vite build requires `PORT` and `BASE_PATH`; use `PORT=5173 BASE_PATH=/` for local production build checks.
- The per-chart premium-flow implementation is validated by tests/build, but still needs a human/browser visual pass for exact spacing, spinner motion, and dropdown overlay behavior.

## Next Recommended Steps

1. Start by reading this handoff plus `SESSION_HANDOFF_2026-04-24_019dc022.md`, then inspect the dirty files before editing. The worktree contains multiple workstreams.
2. Install or enable a Playwright browser, then smoke-test the Market page:
   - chart dropdowns/popovers appear above chart surfaces
   - each visible chart has one premium-flow strip underneath
   - active scan shows spinner only while `coverage.isFetching && currentBatch.includes(symbol)`
   - queued state shows pulsing dot before first scan
   - live/empty/error/stale states do not animate
   - dense layouts do not overlap text, chart canvas, or footer controls
3. If visual issues show up, tune only the chart-strip CSS/JSX in `RayAlgoPlatform.jsx` and rerun the same frontend validations.
4. For broader readiness, run the full planned validation matrix from the prior handoff:
   - API server typecheck/tests
   - API client typecheck/tests
   - frontend unit/build checks
   - manual browser checks for page visibility and duplicate heavy GET behavior
5. When satisfied, prepare a focused commit/PR split by workstream if possible:
   - backend signal monitor worker
   - visibility/single-flight infrastructure
   - chart dropdown/widget styling
   - per-chart premium flow indicators
