# Session Handoff — 2026-04-26

## Session Metadata

- Session ID: `019dc73a-b101-7d61-bef3-74cf6f3ad74a`
- Saved At (UTC): `2026-04-26T01:09:46.810Z`
- Repo Root: `/home/runner/workspace`
- Thread CWD: `/home/runner/workspace`
- Rollout Path: `/home/runner/.codex/sessions/2026/04/26/rollout-2026-04-26T00-40-05-019dc73a-b101-7d61-bef3-74cf6f3ad74a.jsonl`
- Branch: `main`
- HEAD: `83525279b0591509e736a104cba0885451d758a6`
- Latest Commit: `Update platform header and connection status display`
- Latest Commit Session ID: `d56ae97d-ce5b-4897-beba-c1c01ae8f27e`
- Title: Pyrus map-driven rebrand planning handoff

## Current User Request

Save the finalized map-driven hard-cut plan for renaming active RayAlgo/RayReplica traces to Pyrus across the repo.

## Prior Handoffs

- `SESSION_HANDOFF_2026-04-24_019dc024.md`
- `SESSION_HANDOFF_2026-04-24_019dc022.md`
- `SESSION_HANDOFF_2026-04-23_019dba9b.md`
- `SESSION_HANDOFF_2026-04-22_019db54f.md`

## Recent User Messages

- `2026-04-26T00:41:05.000Z` please review this session for any reamining work:  019dc022-48fb-71c2-812c-95057da2343f
  Options-chain and IBKR-heavy session. It added direct IBKR
  expiration loading, fixed stale/same-day expiration display, built
  the Trade option-chain panel, improved chain loading/caching speed,
  added loading states, fixed chart pan/autofollow behavior, and
  updated the handoff system/master index. Validation passed across
  RayAlgo typecheck/unit tests, API server build/typecheck, API
  client tests, and browser smoke. Remaining gap: truly cold IBKR
  option-chain fetches can still be slow. Source:
  SESSION_HANDOFF_2026-04-24_019dc022.md:143
- `2026-04-26T00:46:16.000Z` pleae plan this
- `2026-04-26T00:50:33.000Z` new task, ready?
- `2026-04-26T00:52:00.000Z` are you able to find the plan where we discussed changing our name/branding to pyrus from rayalgo/rayreplica?
- `2026-04-26T00:53:38.000Z` okay. i need you to plan out how we are going to remove all traces of Rayalgo/rayreplica and replace with Pyruc. branding, nameing, code, pinescripts, every last thing. any questions?
- `2026-04-26T01:01:35.000Z` please check for anything you might have missed
- `2026-04-26T01:05:22.000Z` one more review, looking at each line of code and all possible reference locations
- `2026-04-26T01:07:11.000Z` would it be better to map to or clean up the repo? whats best practice here?
- `2026-04-26T01:07:34.000Z` okay. please adjust your plan
- `2026-04-26T01:09:33.000Z` please save this as a handoff for later

## High-Signal Changed Files

- `artifacts/api-server/package.json`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/lib/runtime.ts`
- `artifacts/api-server/src/providers/ibkr/bridge-client.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/platform.ts`
- `artifacts/ibkr-bridge/src/app.ts`
- `artifacts/ibkr-bridge/src/index.ts`
- `artifacts/ibkr-bridge/src/market-data-stream.ts`
- `artifacts/ibkr-bridge/src/service.ts`
- `artifacts/ibkr-bridge/src/tws-provider.ts`
- `artifacts/rayalgo/e2e/chart-parity.spec.ts`
- `artifacts/rayalgo/e2e/ticker-search.spec.ts`
- `artifacts/rayalgo/package.json`
- `artifacts/rayalgo/src/RayAlgoPlatform.jsx`
- `artifacts/rayalgo/src/components/trading/LightweightCharts.jsx`
- `artifacts/rayalgo/src/features/backtesting/BacktestingPanels.tsx`
- `artifacts/rayalgo/src/features/charting/LightweightChartReference.tsx`
- `artifacts/rayalgo/src/features/charting/activeChartBarStore.ts`
- `artifacts/rayalgo/src/features/charting/chartLifecycle.ts`
- `artifacts/rayalgo/src/features/platform/IbkrConnectionStatus.jsx`
- `artifacts/rayalgo/src/features/platform/IbkrConnectionStatus.test.js`
- `artifacts/rayalgo/src/features/platform/live-streams.ts`
- `artifacts/rayalgo/src/features/platform/marketFlowStore.js`
- `artifacts/rayalgo/src/features/research/data/index.js`
- `artifacts/rayalgo/src/hooks/use-mobile.tsx`
- `artifacts/rayalgo/src/screens/TradeScreen.jsx`
- `artifacts/rayalgo/vite.config.ts`
- `knip.json`
- `lib/api-client-react/src/generated/api.schemas.ts`

## Repo State Snapshot

```text
## main...origin/main [ahead 17]
 M artifacts/api-server/package.json
 M artifacts/api-server/src/index.ts
 M artifacts/api-server/src/lib/runtime.ts
 M artifacts/api-server/src/providers/ibkr/bridge-client.ts
 M artifacts/api-server/src/routes/platform.ts
 M artifacts/api-server/src/services/platform.ts
 M artifacts/ibkr-bridge/src/app.ts
 M artifacts/ibkr-bridge/src/index.ts
 M artifacts/ibkr-bridge/src/market-data-stream.ts
 M artifacts/ibkr-bridge/src/service.ts
 M artifacts/ibkr-bridge/src/tws-provider.ts
 M artifacts/rayalgo/e2e/chart-parity.spec.ts
 M artifacts/rayalgo/e2e/ticker-search.spec.ts
 M artifacts/rayalgo/package.json
 M artifacts/rayalgo/src/RayAlgoPlatform.jsx
 D artifacts/rayalgo/src/components/trading/LightweightCharts.jsx
 M artifacts/rayalgo/src/features/backtesting/BacktestingPanels.tsx
 D artifacts/rayalgo/src/features/charting/LightweightChartReference.tsx
 M artifacts/rayalgo/src/features/charting/activeChartBarStore.ts
 M artifacts/rayalgo/src/features/charting/chartLifecycle.ts
 M artifacts/rayalgo/src/features/platform/IbkrConnectionStatus.jsx
 M artifacts/rayalgo/src/features/platform/IbkrConnectionStatus.test.js
 M artifacts/rayalgo/src/features/platform/live-streams.ts
 M artifacts/rayalgo/src/features/platform/marketFlowStore.js
 D artifacts/rayalgo/src/features/research/data/index.js
 D artifacts/rayalgo/src/hooks/use-mobile.tsx
 M artifacts/rayalgo/src/screens/TradeScreen.jsx
 D artifacts/rayalgo/test-results/.playwright-artifacts-0/page@30316e05fee2d1dc2d013df241083138.webm
 D artifacts/rayalgo/test-results/.playwright-artifacts-1/page@0722624560f12866cc091856c68e3461.webm
 D artifacts/rayalgo/test-results/.playwright-artifacts-3/page@aa3447bd712354ec5961f32c703d984c.webm
 M artifacts/rayalgo/vite.config.ts
 M knip.json
 M lib/api-client-react/src/generated/api.schemas.ts
 M lib/api-client-react/src/generated/api.ts
 M lib/api-spec/openapi.yaml
 M lib/api-zod/src/generated/api.ts
 M lib/api-zod/src/generated/types/accountAllocationResponse.ts
 M lib/api-zod/src/generated/types/accountCashActivityResponse.ts
 M lib/api-zod/src/generated/types/accountClosedTradesResponse.ts
 M lib/api-zod/src/generated/types/accountEquityHistoryResponse.ts
 M lib/api-zod/src/generated/types/accountEquityPoint.ts
 M lib/api-zod/src/generated/types/accountEquityPointSource.ts
 M lib/api-zod/src/generated/types/accountFx.ts
 M lib/api-zod/src/generated/types/accountFxRates.ts
 M lib/api-zod/src/generated/types/accountHistoryRange.ts
 M lib/api-zod/src/generated/types/accountMetric.ts
 M lib/api-zod/src/generated/types/accountMetricSource.ts
 M lib/api-zod/src/generated/types/accountOrder.ts
 M lib/api-zod/src/generated/types/accountOrdersResponse.ts
 M lib/api-zod/src/generated/types/accountOrdersResponseTab.ts
 M lib/api-zod/src/generated/types/accountPositionRow.ts
 M lib/api-zod/src/generated/types/accountPositionsResponse.ts
 M lib/api-zod/src/generated/types/accountRiskResponse.ts
 M lib/api-zod/src/generated/types/accountSummaryMetrics.ts
 M lib/api-zod/src/generated/types/accountSummaryResponse.ts
 M lib/api-zod/src/generated/types/accountTrade.ts
 M lib/api-zod/src/generated/types/accountTradeSource.ts
 M lib/api-zod/src/generated/types/accountsResponse.ts
 M lib/api-zod/src/generated/types/algoDeployment.ts
 M lib/api-zod/src/generated/types/algoDeploymentsResponse.ts
 M lib/api-zod/src/generated/types/assetClass.ts
 M lib/api-zod/src/generated/types/backtestChartMarker.ts
 M lib/api-zod/src/generated/types/backtestChartMarkerPosition.ts
 M lib/api-zod/src/generated/types/backtestChartMarkerShape.ts
 M lib/api-zod/src/generated/types/backtestComparisonBadge.ts
 M lib/api-zod/src/generated/types/backtestComparisonBadgeFormat.ts
 M lib/api-zod/src/generated/types/backtestComparisonBadgeWinner.ts
 M lib/api-zod/src/generated/types/backtestDatasetRef.ts
 M lib/api-zod/src/generated/types/backtestDirectionMode.ts
 M lib/api-zod/src/generated/types/backtestDraftStrategiesResponse.ts
 M lib/api-zod/src/generated/types/backtestDraftStrategy.ts
 M lib/api-zod/src/generated/types/backtestIndicatorEvent.ts
 M lib/api-zod/src/generated/types/backtestIndicatorMarkerPayload.ts
 M lib/api-zod/src/generated/types/backtestIndicatorMarkerPayloadMarkersByTradeId.ts
 M lib/api-zod/src/generated/types/backtestIndicatorWindow.ts
 M lib/api-zod/src/generated/types/backtestIndicatorWindowDirection.ts
 M lib/api-zod/src/generated/types/backtestIndicatorZone.ts
 M lib/api-zod/src/generated/types/backtestJobStatus.ts
 M lib/api-zod/src/generated/types/backtestJobSummary.ts
 M lib/api-zod/src/generated/types/backtestJobsResponse.ts
 M lib/api-zod/src/generated/types/backtestOptimizerMode.ts
 M lib/api-zod/src/generated/types/backtestParameterDefinition.ts
 M lib/api-zod/src/generated/types/backtestParameterDefinitionType.ts
 M lib/api-zod/src/generated/types/backtestRunChart.ts
 M lib/api-zod/src/generated/types/backtestRunChartChartPriceContext.ts
 M lib/api-zod/src/generated/types/backtestRunDetail.ts
 M lib/api-zod/src/generated/types/backtestRunSummary.ts
 M lib/api-zod/src/generated/types/backtestRunsResponse.ts
 M lib/api-zod/src/generated/types/backtestStrategiesResponse.ts
 M lib/api-zod/src/generated/types/backtestStrategyCatalogItem.ts
 M lib/api-zod/src/generated/types/backtestStrategyCatalogItemDefaultParameters.ts
 M lib/api-zod/src/generated/types/backtestStrategyStatus.ts
 M lib/api-zod/src/generated/types/backtestStudiesResponse.ts
 M lib/api-zod/src/generated/types/backtestStudyInput.ts
 M lib/api-zod/src/generated/types/backtestStudyPreviewChart.ts
 M lib/api-zod/src/generated/types/backtestStudyRecord.ts
 M lib/api-zod/src/generated/types/backtestSweepDetail.ts
 M lib/api-zod/src/generated/types/backtestTrade.ts
 M lib/api-zod/src/generated/types/backtestTradeDiagnostics.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroup.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroupDir.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroupKind.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroups.ts
 M lib/api-zod/src/generated/types/backtestTradeOverlay.ts
 M lib/api-zod/src/generated/types/backtestTradeOverlayChartPriceContext.ts
 M lib/api-zod/src/generated/types/backtestTradeOverlayDir.ts
 M lib/api-zod/src/generated/types/backtestTradeReasonTraceStep.ts
 M lib/api-zod/src/generated/types/backtestTradeReasonTraceStepEmphasis.ts
 M lib/api-zod/src/generated/types/backtestTradeReasonTraceStepKind.ts
 M lib/api-zod/src/generated/types/backtestTradeSelectionFocus.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdPath.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdSegment.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdSegmentKind.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdSegmentStyle.ts
 M lib/api-zod/src/generated/types/bar.ts
 M lib/api-zod/src/generated/types/barDataSource.ts
 M lib/api-zod/src/generated/types/barTimeframe.ts
 M lib/api-zod/src/generated/types/barsResponse.ts
 M lib/api-zod/src/generated/types/brokerAccount.ts
 M lib/api-zod/src/generated/types/brokerConnection.ts
 M lib/api-zod/src/generated/types/brokerConnectionProvider.ts
 M lib/api-zod/src/generated/types/brokerConnectionsResponse.ts
 M lib/api-zod/src/generated/types/brokerProvider.ts
 M lib/api-zod/src/generated/types/connectionStatus.ts
 M lib/api-zod/src/generated/types/createAlgoDeploymentRequest.ts
 M lib/api-zod/src/generated/types/createBacktestRunRequest.ts
 M lib/api-zod/src/generated/types/createBacktestRunRequestParameters.ts
 M lib/api-zod/src/generated/types/createBacktestSweepRequest.ts
 M lib/api-zod/src/generated/types/createBacktestSweepRequestBaseParameters.ts
 M lib/api-zod/src/generated/types/createPineScriptRequest.ts
 M lib/api-zod/src/generated/types/environmentMode.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorRequest.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorRequestMode.ts
 M lib/api-zod/src/generated/types/executionEvent.ts
 M lib/api-zod/src/generated/types/executionEventsResponse.ts
 M lib/api-zod/src/generated/types/flexTestResponse.ts
 M lib/api-zod/src/generated/types/flowDataProvider.ts
 M lib/api-zod/src/generated/types/flowEvent.ts
 M lib/api-zod/src/generated/types/flowEventBasis.ts
 M lib/api-zod/src/generated/types/flowEventsResponse.ts
 M lib/api-zod/src/generated/types/flowEventsSource.ts
 M lib/api-zod/src/generated/types/flowEventsSourceProvider.ts
 M lib/api-zod/src/generated/types/flowEventsSourceStatus.ts
 M lib/api-zod/src/generated/types/flowSentiment.ts
 M lib/api-zod/src/generated/types/getAccountAllocationParams.ts
 M lib/api-zod/src/generated/types/getAccountCashActivityParams.ts
 M lib/api-zod/src/generated/types/getAccountClosedTradesParams.ts
 M lib/api-zod/src/generated/types/getAccountClosedTradesPnlSign.ts
 M lib/api-zod/src/generated/types/getAccountEquityHistoryParams.ts
 M lib/api-zod/src/generated/types/getAccountOrdersParams.ts
 M lib/api-zod/src/generated/types/getAccountOrdersTab.ts
 M lib/api-zod/src/generated/types/getAccountPositionsParams.ts
 M lib/api-zod/src/generated/types/getAccountRiskParams.ts
 M lib/api-zod/src/generated/types/getAccountSummaryParams.ts
 M lib/api-zod/src/generated/types/getBacktestRunChartParams.ts
 M lib/api-zod/src/generated/types/getBarsParams.ts
 M lib/api-zod/src/generated/types/getNewsParams.ts
 M lib/api-zod/src/generated/types/getOptionChainParams.ts
 M lib/api-zod/src/generated/types/getOptionExpirationsParams.ts
 M lib/api-zod/src/generated/types/getQuoteSnapshotsParams.ts
 M lib/api-zod/src/generated/types/getResearchEarningsCalendarParams.ts
 M lib/api-zod/src/generated/types/getResearchFinancialsParams.ts
 M lib/api-zod/src/generated/types/getResearchFundamentalsParams.ts
 M lib/api-zod/src/generated/types/getResearchSecFilingsParams.ts
 M lib/api-zod/src/generated/types/getResearchSnapshotsParams.ts
 M lib/api-zod/src/generated/types/getResearchTranscriptParams.ts
 M lib/api-zod/src/generated/types/getResearchTranscriptsParams.ts
 M lib/api-zod/src/generated/types/getSignalMonitorProfileParams.ts
 M lib/api-zod/src/generated/types/getSignalMonitorStateParams.ts
 M lib/api-zod/src/generated/types/healthStatus.ts
 M lib/api-zod/src/generated/types/healthStatusStatus.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealth.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthMarketDataMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthRole.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthTransport.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionsHealth.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealth.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealthMarketDataMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealthTransport.ts
 M lib/api-zod/src/generated/types/index.ts
 M lib/api-zod/src/generated/types/jsonObject.ts
 M lib/api-zod/src/generated/types/listAccountsParams.ts
 M lib/api-zod/src/generated/types/listAlgoDeploymentsParams.ts
 M lib/api-zod/src/generated/types/listBacktestRunsParams.ts
 M lib/api-zod/src/generated/types/listExecutionEventsParams.ts
 M lib/api-zod/src/generated/types/listFlowEventsParams.ts
 M lib/api-zod/src/generated/types/listOrdersParams.ts
 M lib/api-zod/src/generated/types/listPositionsParams.ts
 M lib/api-zod/src/generated/types/listSignalMonitorEventsParams.ts
 M lib/api-zod/src/generated/types/marketDataProvider.ts
 M lib/api-zod/src/generated/types/newsArticle.ts
 M lib/api-zod/src/generated/types/newsResponse.ts
 M lib/api-zod/src/generated/types/optionChainQuote.ts
 M lib/api-zod/src/generated/types/optionChainResponse.ts
 M lib/api-zod/src/generated/types/optionContract.ts
 M lib/api-zod/src/generated/types/optionExpirationsResponse.ts
 M lib/api-zod/src/generated/types/optionRight.ts
 M lib/api-zod/src/generated/types/order.ts
 M lib/api-zod/src/generated/types/orderPreview.ts
 M lib/api-zod/src/generated/types/orderSide.ts
 M lib/api-zod/src/generated/types/orderStatus.ts
 M lib/api-zod/src/generated/types/orderType.ts
 M lib/api-zod/src/generated/types/ordersResponse.ts
 M lib/api-zod/src/generated/types/pineScriptPaneType.ts
 M lib/api-zod/src/generated/types/pineScriptRecord.ts
 M lib/api-zod/src/generated/types/pineScriptStatus.ts
 M lib/api-zod/src/generated/types/pineScriptsResponse.ts
 M lib/api-zod/src/generated/types/placeOrderRequest.ts
 M lib/api-zod/src/generated/types/position.ts
 M lib/api-zod/src/generated/types/positionsResponse.ts
 M lib/api-zod/src/generated/types/quoteSnapshot.ts
 M lib/api-zod/src/generated/types/quoteSnapshotFreshness.ts
 M lib/api-zod/src/generated/types/quoteSnapshotsResponse.ts
 M lib/api-zod/src/generated/types/quoteSource.ts
 M lib/api-zod/src/generated/types/replaceOrderRequest.ts
 M lib/api-zod/src/generated/types/researchCalendarResponse.ts
 M lib/api-zod/src/generated/types/researchFilingsResponse.ts
 M lib/api-zod/src/generated/types/researchFinancials.ts
 M lib/api-zod/src/generated/types/researchFinancialsResponse.ts
 M lib/api-zod/src/generated/types/researchFundamentalsResponse.ts
 M lib/api-zod/src/generated/types/researchProvider.ts
 M lib/api-zod/src/generated/types/researchSnapshotsResponse.ts
 M lib/api-zod/src/generated/types/researchStatus.ts
 M lib/api-zod/src/generated/types/researchTranscriptResponse.ts
 M lib/api-zod/src/generated/types/researchTranscriptsResponse.ts
 M lib/api-zod/src/generated/types/searchUniverseTickersParams.ts
 M lib/api-zod/src/generated/types/sessionInfo.ts
 M lib/api-zod/src/generated/types/sessionMarketDataProviders.ts
 M lib/api-zod/src/generated/types/sessionMarketDataProvidersResearch.ts
 M lib/api-zod/src/generated/types/signalMonitorDirection.ts
 M lib/api-zod/src/generated/types/signalMonitorEvent.ts
 M lib/api-zod/src/generated/types/signalMonitorEventsResponse.ts
 M lib/api-zod/src/generated/types/signalMonitorProfile.ts
 M lib/api-zod/src/generated/types/signalMonitorStateResponse.ts
 M lib/api-zod/src/generated/types/signalMonitorSymbolState.ts
 M lib/api-zod/src/generated/types/signalMonitorSymbolStatus.ts
 M lib/api-zod/src/generated/types/signalMonitorTimeframe.ts
 M lib/api-zod/src/generated/types/streamAccountsParams.ts
 M lib/api-zod/src/generated/types/streamOptionChainsParams.ts
 M lib/api-zod/src/generated/types/streamOrdersParams.ts
 M lib/api-zod/src/generated/types/streamQuoteSnapshotsParams.ts
 M lib/api-zod/src/generated/types/streamStockAggregatesParams.ts
 M lib/api-zod/src/generated/types/submitIbkrOrdersRequest.ts
 M lib/api-zod/src/generated/types/submitIbkrOrdersResponse.ts
 M lib/api-zod/src/generated/types/timeInForce.ts
 M lib/api-zod/src/generated/types/universeMarket.ts
 M lib/api-zod/src/generated/types/universeTicker.ts
 M lib/api-zod/src/generated/types/universeTickerContractMeta.ts
 M lib/api-zod/src/generated/types/universeTickersResponse.ts
 M lib/api-zod/src/generated/types/updatePineScriptRequest.ts
 M lib/api-zod/src/generated/types/updateSignalMonitorProfileRequest.ts
 M lib/api-zod/src/generated/types/watchlist.ts
 M lib/api-zod/src/generated/types/watchlistsResponse.ts
 M lib/api-zod/src/index.ts
 M package.json
 M pnpm-lock.yaml
 M pnpm-workspace.yaml
 M replit.md
 M scripts/package.json
 D scripts/src/hello.ts
 M scripts/src/ibkr-latency-bench.ts
?? artifacts/api-server/src/ws/
?? artifacts/ibkr-bridge/src/subscription-budget.ts
?? artifacts/rayalgo/e2e/market-premium-flow.spec.ts
?? artifacts/rayalgo/e2e/watchlist-scan.spec.ts
?? artifacts/rayalgo/src/features/charting/activeChartBarStore.test.ts
?? artifacts/rayalgo/src/features/platform/live-streams.test.ts
?? artifacts/rayalgo/src/features/platform/marketFlowStore.test.js
?? artifacts/rayalgo/src/features/platform/watchlistModel.js
?? artifacts/rayalgo/src/features/platform/watchlistModel.test.js
?? artifacts/rayalgo/test-results/.last-run.json
?? lib/api-zod/src/generated/types/optionChainBatchRequest.ts
?? lib/api-zod/src/generated/types/optionChainBatchResponse.ts
?? lib/api-zod/src/generated/types/optionChainBatchResult.ts
?? lib/api-zod/src/generated/types/optionChainBatchResultStatus.ts
?? scripts/windows/start-ibkr-tws-sidecar.cmd
?? scripts/windows/start-ibkr-tws-sidecar.ps1
```

## Diff Summary

```text
 artifacts/api-server/package.json                  |     4 +-
 artifacts/api-server/src/index.ts                  |    15 +-
 artifacts/api-server/src/lib/runtime.ts            |    54 +-
 .../api-server/src/providers/ibkr/bridge-client.ts |    32 +-
 artifacts/api-server/src/routes/platform.ts        |    11 +
 artifacts/api-server/src/services/platform.ts      |   153 +-
 artifacts/ibkr-bridge/src/app.ts                   |    87 +-
 artifacts/ibkr-bridge/src/index.ts                 |     2 +-
 artifacts/ibkr-bridge/src/market-data-stream.ts    |    78 +-
 artifacts/ibkr-bridge/src/service.ts               |     9 +-
 artifacts/ibkr-bridge/src/tws-provider.ts          |   220 +-
 artifacts/rayalgo/e2e/chart-parity.spec.ts         |    14 +-
 artifacts/rayalgo/e2e/ticker-search.spec.ts        |    91 +
 artifacts/rayalgo/package.json                     |     3 +-
 artifacts/rayalgo/src/RayAlgoPlatform.jsx          |  3024 ++----
 .../src/components/trading/LightweightCharts.jsx   |   656 --
 .../src/features/backtesting/BacktestingPanels.tsx |  2877 -----
 .../charting/LightweightChartReference.tsx         |   279 -
 .../src/features/charting/activeChartBarStore.ts   |    11 +-
 .../src/features/charting/chartLifecycle.ts        |     7 +-
 .../src/features/platform/IbkrConnectionStatus.jsx |     9 +-
 .../features/platform/IbkrConnectionStatus.test.js |    31 +
 .../rayalgo/src/features/platform/live-streams.ts  |   192 +-
 .../src/features/platform/marketFlowStore.js       |    50 +-
 .../rayalgo/src/features/research/data/index.js    |     4 -
 artifacts/rayalgo/src/hooks/use-mobile.tsx         |    19 -
 artifacts/rayalgo/src/screens/TradeScreen.jsx      |   338 +-
 .../page@30316e05fee2d1dc2d013df241083138.webm     |     0
 .../page@0722624560f12866cc091856c68e3461.webm     |     0
 .../page@aa3447bd712354ec5961f32c703d984c.webm     |     0
 artifacts/rayalgo/vite.config.ts                   |     1 +
 knip.json                                          |     3 +
 lib/api-client-react/src/generated/api.schemas.ts  |  1025 +-
 lib/api-client-react/src/generated/api.ts          | 10371 +++++++++----------
 lib/api-spec/openapi.yaml                          |    84 +-
 lib/api-zod/src/generated/api.ts                   |  4866 ++++-----
 .../generated/types/accountAllocationResponse.ts   |     4 +-
 .../generated/types/accountCashActivityResponse.ts |     4 +-
 .../generated/types/accountClosedTradesResponse.ts |     4 +-
 .../types/accountEquityHistoryResponse.ts          |     6 +-
 .../src/generated/types/accountEquityPoint.ts      |     2 +-
 .../generated/types/accountEquityPointSource.ts    |     8 +-
 lib/api-zod/src/generated/types/accountFx.ts       |     2 +-
 lib/api-zod/src/generated/types/accountFxRates.ts  |     2 +-
 .../src/generated/types/accountHistoryRange.ts     |    16 +-
 lib/api-zod/src/generated/types/accountMetric.ts   |     2 +-
 .../src/generated/types/accountMetricSource.ts     |    12 +-
 lib/api-zod/src/generated/types/accountOrder.ts    |    10 +-
 .../src/generated/types/accountOrdersResponse.ts   |     4 +-
 .../generated/types/accountOrdersResponseTab.ts    |     8 +-
 .../src/generated/types/accountPositionRow.ts      |     4 +-
 .../generated/types/accountPositionsResponse.ts    |     4 +-
 .../src/generated/types/accountRiskResponse.ts     |     2 +-
 .../src/generated/types/accountSummaryMetrics.ts   |     2 +-
 .../src/generated/types/accountSummaryResponse.ts  |    10 +-
 lib/api-zod/src/generated/types/accountTrade.ts    |     2 +-
 .../src/generated/types/accountTradeSource.ts      |     8 +-
 .../src/generated/types/accountsResponse.ts        |     2 +-
 lib/api-zod/src/generated/types/algoDeployment.ts  |     4 +-
 .../src/generated/types/algoDeploymentsResponse.ts |     2 +-
 lib/api-zod/src/generated/types/assetClass.ts      |     7 +-
 .../src/generated/types/backtestChartMarker.ts     |     4 +-
 .../generated/types/backtestChartMarkerPosition.ts |    10 +-
 .../generated/types/backtestChartMarkerShape.ts    |    12 +-
 .../src/generated/types/backtestComparisonBadge.ts |     4 +-
 .../types/backtestComparisonBadgeFormat.ts         |    12 +-
 .../types/backtestComparisonBadgeWinner.ts         |    12 +-
 .../src/generated/types/backtestDatasetRef.ts      |     2 +-
 .../src/generated/types/backtestDirectionMode.ts   |     8 +-
 .../types/backtestDraftStrategiesResponse.ts       |     2 +-
 .../src/generated/types/backtestDraftStrategy.ts   |     4 +-
 .../src/generated/types/backtestIndicatorEvent.ts  |     4 +-
 .../types/backtestIndicatorMarkerPayload.ts        |     6 +-
 ...cktestIndicatorMarkerPayloadMarkersByTradeId.ts |     6 +-
 .../src/generated/types/backtestIndicatorWindow.ts |     6 +-
 .../types/backtestIndicatorWindowDirection.ts      |     8 +-
 .../src/generated/types/backtestIndicatorZone.ts   |     4 +-
 .../src/generated/types/backtestJobStatus.ts       |    20 +-
 .../src/generated/types/backtestJobSummary.ts      |     2 +-
 .../src/generated/types/backtestJobsResponse.ts    |     2 +-
 .../src/generated/types/backtestOptimizerMode.ts   |    10 +-
 .../generated/types/backtestParameterDefinition.ts |     2 +-
 .../types/backtestParameterDefinitionType.ts       |    12 +-
 .../src/generated/types/backtestRunChart.ts        |    24 +-
 .../types/backtestRunChartChartPriceContext.ts     |     8 +-
 .../src/generated/types/backtestRunDetail.ts       |    10 +-
 .../src/generated/types/backtestRunSummary.ts      |     6 +-
 .../src/generated/types/backtestRunsResponse.ts    |     2 +-
 .../generated/types/backtestStrategiesResponse.ts  |     2 +-
 .../generated/types/backtestStrategyCatalogItem.ts |    10 +-
 ...backtestStrategyCatalogItemDefaultParameters.ts |     4 +-
 .../src/generated/types/backtestStrategyStatus.ts  |     8 +-
 .../src/generated/types/backtestStudiesResponse.ts |     2 +-
 .../src/generated/types/backtestStudyInput.ts      |    14 +-
 .../generated/types/backtestStudyPreviewChart.ts   |     6 +-
 .../src/generated/types/backtestStudyRecord.ts     |    14 +-
 .../src/generated/types/backtestSweepDetail.ts     |     6 +-
 lib/api-zod/src/generated/types/backtestTrade.ts   |     2 +-
 .../generated/types/backtestTradeDiagnostics.ts    |     4 +-
 .../generated/types/backtestTradeMarkerGroup.ts    |     4 +-
 .../generated/types/backtestTradeMarkerGroupDir.ts |     8 +-
 .../types/backtestTradeMarkerGroupKind.ts          |     8 +-
 .../generated/types/backtestTradeMarkerGroups.ts   |     4 +-
 .../src/generated/types/backtestTradeOverlay.ts    |     6 +-
 .../types/backtestTradeOverlayChartPriceContext.ts |     8 +-
 .../src/generated/types/backtestTradeOverlayDir.ts |     8 +-
 .../types/backtestTradeReasonTraceStep.ts          |     4 +-
 .../types/backtestTradeReasonTraceStepEmphasis.ts  |    10 +-
 .../types/backtestTradeReasonTraceStepKind.ts      |    12 +-
 .../generated/types/backtestTradeSelectionFocus.ts |     2 +-
 .../generated/types/backtestTradeThresholdPath.ts  |     2 +-
 .../types/backtestTradeThresholdSegment.ts         |     4 +-
 .../types/backtestTradeThresholdSegmentKind.ts     |    14 +-
 .../types/backtestTradeThresholdSegmentStyle.ts    |    10 +-
 lib/api-zod/src/generated/types/bar.ts             |     2 +-
 lib/api-zod/src/generated/types/barDataSource.ts   |     9 +-
 lib/api-zod/src/generated/types/barTimeframe.ts    |    19 +-
 lib/api-zod/src/generated/types/barsResponse.ts    |     6 +-
 lib/api-zod/src/generated/types/brokerAccount.ts   |     4 +-
 .../src/generated/types/brokerConnection.ts        |     8 +-
 .../generated/types/brokerConnectionProvider.ts    |     9 +-
 .../generated/types/brokerConnectionsResponse.ts   |     2 +-
 lib/api-zod/src/generated/types/brokerProvider.ts  |     6 +-
 .../src/generated/types/connectionStatus.ts        |    12 +-
 .../generated/types/createAlgoDeploymentRequest.ts |     4 +-
 .../generated/types/createBacktestRunRequest.ts    |     2 +-
 .../types/createBacktestRunRequestParameters.ts    |     4 +-
 .../generated/types/createBacktestSweepRequest.ts  |     6 +-
 .../createBacktestSweepRequestBaseParameters.ts    |     4 +-
 .../src/generated/types/createPineScriptRequest.ts |     6 +-
 lib/api-zod/src/generated/types/environmentMode.ts |     8 +-
 .../types/evaluateSignalMonitorRequest.ts          |     4 +-
 .../types/evaluateSignalMonitorRequestMode.ts      |     8 +-
 lib/api-zod/src/generated/types/executionEvent.ts  |     2 +-
 .../src/generated/types/executionEventsResponse.ts |     2 +-
 .../src/generated/types/flexTestResponse.ts        |     2 +-
 .../src/generated/types/flowDataProvider.ts        |     8 +-
 lib/api-zod/src/generated/types/flowEvent.ts       |     8 +-
 lib/api-zod/src/generated/types/flowEventBasis.ts  |     8 +-
 .../src/generated/types/flowEventsResponse.ts      |     4 +-
 .../src/generated/types/flowEventsSource.ts        |     6 +-
 .../generated/types/flowEventsSourceProvider.ts    |    10 +-
 .../src/generated/types/flowEventsSourceStatus.ts  |    12 +-
 lib/api-zod/src/generated/types/flowSentiment.ts   |     9 +-
 .../generated/types/getAccountAllocationParams.ts  |     4 +-
 .../types/getAccountCashActivityParams.ts          |     8 +-
 .../types/getAccountClosedTradesParams.ts          |    18 +-
 .../types/getAccountClosedTradesPnlSign.ts         |    10 +-
 .../types/getAccountEquityHistoryParams.ts         |    10 +-
 .../src/generated/types/getAccountOrdersParams.ts  |     8 +-
 .../src/generated/types/getAccountOrdersTab.ts     |     8 +-
 .../generated/types/getAccountPositionsParams.ts   |     6 +-
 .../src/generated/types/getAccountRiskParams.ts    |     4 +-
 .../src/generated/types/getAccountSummaryParams.ts |     4 +-
 .../generated/types/getBacktestRunChartParams.ts   |     4 +-
 lib/api-zod/src/generated/types/getBarsParams.ts   |    50 +-
 lib/api-zod/src/generated/types/getNewsParams.ts   |    20 +-
 .../src/generated/types/getOptionChainParams.ts    |    14 +-
 .../generated/types/getOptionExpirationsParams.ts  |     2 +-
 .../src/generated/types/getQuoteSnapshotsParams.ts |     8 +-
 .../types/getResearchEarningsCalendarParams.ts     |     4 +-
 .../generated/types/getResearchFinancialsParams.ts |     2 +-
 .../types/getResearchFundamentalsParams.ts         |     2 +-
 .../generated/types/getResearchSecFilingsParams.ts |    12 +-
 .../generated/types/getResearchSnapshotsParams.ts  |     2 +-
 .../generated/types/getResearchTranscriptParams.ts |    14 +-
 .../types/getResearchTranscriptsParams.ts          |     2 +-
 .../types/getSignalMonitorProfileParams.ts         |     4 +-
 .../generated/types/getSignalMonitorStateParams.ts |     4 +-
 lib/api-zod/src/generated/types/healthStatus.ts    |     2 +-
 .../src/generated/types/healthStatusStatus.ts      |     6 +-
 .../generated/types/ibkrBridgeConnectionHealth.ts  |     8 +-
 .../ibkrBridgeConnectionHealthMarketDataMode.ts    |    15 +-
 .../types/ibkrBridgeConnectionHealthRole.ts        |     8 +-
 .../types/ibkrBridgeConnectionHealthTransport.ts   |     8 +-
 .../generated/types/ibkrBridgeConnectionsHealth.ts |     2 +-
 .../src/generated/types/ibkrBridgeHealth.ts        |     8 +-
 .../types/ibkrBridgeHealthMarketDataMode.ts        |    15 +-
 .../generated/types/ibkrBridgeHealthTransport.ts   |     9 +-
 lib/api-zod/src/generated/types/index.ts           |   542 +-
 lib/api-zod/src/generated/types/jsonObject.ts      |     4 +-
 .../src/generated/types/listAccountsParams.ts      |    10 +-
 .../generated/types/listAlgoDeploymentsParams.ts   |     4 +-
 .../src/generated/types/listBacktestRunsParams.ts  |     8 +-
 .../generated/types/listExecutionEventsParams.ts   |    12 +-
 .../src/generated/types/listFlowEventsParams.ts    |    24 +-
 .../src/generated/types/listOrdersParams.ts        |    10 +-
 .../src/generated/types/listPositionsParams.ts     |     6 +-
 .../types/listSignalMonitorEventsParams.ts         |    16 +-
 .../src/generated/types/marketDataProvider.ts      |     8 +-
 lib/api-zod/src/generated/types/newsArticle.ts     |     2 +-
 lib/api-zod/src/generated/types/newsResponse.ts    |     2 +-
 .../src/generated/types/optionChainQuote.ts        |     2 +-
 .../src/generated/types/optionChainResponse.ts     |     2 +-
 lib/api-zod/src/generated/types/optionContract.ts  |     2 +-
 .../generated/types/optionExpirationsResponse.ts   |     2 +-
 lib/api-zod/src/generated/types/optionRight.ts     |     7 +-
 lib/api-zod/src/generated/types/order.ts           |    14 +-
 lib/api-zod/src/generated/types/orderPreview.ts    |     8 +-
 lib/api-zod/src/generated/types/orderSide.ts       |     7 +-
 lib/api-zod/src/generated/types/orderStatus.ts     |    19 +-
 lib/api-zod/src/generated/types/orderType.ts       |    11 +-
 lib/api-zod/src/generated/types/ordersResponse.ts  |     2 +-
 .../src/generated/types/pineScriptPaneType.ts      |     8 +-
 .../src/generated/types/pineScriptRecord.ts        |     6 +-
 .../src/generated/types/pineScriptStatus.ts        |    12 +-
 .../src/generated/types/pineScriptsResponse.ts     |     2 +-
 .../src/generated/types/placeOrderRequest.ts       |    12 +-
 lib/api-zod/src/generated/types/position.ts        |     4 +-
 .../src/generated/types/positionsResponse.ts       |     2 +-
 lib/api-zod/src/generated/types/quoteSnapshot.ts   |     8 +-
 .../src/generated/types/quoteSnapshotFreshness.ts  |    10 +-
 .../src/generated/types/quoteSnapshotsResponse.ts  |     4 +-
 lib/api-zod/src/generated/types/quoteSource.ts     |     7 +-
 .../src/generated/types/replaceOrderRequest.ts     |     4 +-
 .../generated/types/researchCalendarResponse.ts    |     2 +-
 .../src/generated/types/researchFilingsResponse.ts |     2 +-
 .../src/generated/types/researchFinancials.ts      |    12 +-
 .../generated/types/researchFinancialsResponse.ts  |     2 +-
 .../types/researchFundamentalsResponse.ts          |     2 +-
 .../src/generated/types/researchProvider.ts        |     6 +-
 .../generated/types/researchSnapshotsResponse.ts   |     2 +-
 lib/api-zod/src/generated/types/researchStatus.ts  |     2 +-
 .../generated/types/researchTranscriptResponse.ts  |     2 +-
 .../generated/types/researchTranscriptsResponse.ts |     2 +-
 .../generated/types/searchUniverseTickersParams.ts |    54 +-
 lib/api-zod/src/generated/types/sessionInfo.ts     |    12 +-
 .../generated/types/sessionMarketDataProviders.ts  |     6 +-
 .../types/sessionMarketDataProvidersResearch.ts    |     9 +-
 .../src/generated/types/signalMonitorDirection.ts  |     8 +-
 .../src/generated/types/signalMonitorEvent.ts      |     8 +-
 .../generated/types/signalMonitorEventsResponse.ts |     2 +-
 .../src/generated/types/signalMonitorProfile.ts    |     6 +-
 .../generated/types/signalMonitorStateResponse.ts  |     4 +-
 .../generated/types/signalMonitorSymbolState.ts    |     6 +-
 .../generated/types/signalMonitorSymbolStatus.ts   |    14 +-
 .../src/generated/types/signalMonitorTimeframe.ts  |    14 +-
 .../src/generated/types/streamAccountsParams.ts    |     6 +-
 .../generated/types/streamOptionChainsParams.ts    |     8 +-
 .../src/generated/types/streamOrdersParams.ts      |    10 +-
 .../generated/types/streamQuoteSnapshotsParams.ts  |     8 +-
 .../generated/types/streamStockAggregatesParams.ts |     8 +-
 .../src/generated/types/submitIbkrOrdersRequest.ts |     4 +-
 .../generated/types/submitIbkrOrdersResponse.ts    |     4 +-
 lib/api-zod/src/generated/types/timeInForce.ts     |    11 +-
 lib/api-zod/src/generated/types/universeMarket.ts  |    18 +-
 lib/api-zod/src/generated/types/universeTicker.ts  |     6 +-
 .../generated/types/universeTickerContractMeta.ts  |     4 +-
 .../src/generated/types/universeTickersResponse.ts |     2 +-
 .../src/generated/types/updatePineScriptRequest.ts |     6 +-
 .../types/updateSignalMonitorProfileRequest.ts     |     6 +-
 lib/api-zod/src/generated/types/watchlist.ts       |     2 +-
 .../src/generated/types/watchlistsResponse.ts      |     2 +-
 lib/api-zod/src/index.ts                           |     1 +
 package.json                                       |     2 +
 pnpm-lock.yaml                                     |   299 +-
 pnpm-workspace.yaml                                |     5 +-
 replit.md                                          |    30 +
 scripts/package.json                               |     1 -
 scripts/src/hello.ts                               |     1 -
 scripts/src/ibkr-latency-bench.ts                  |     2 +-
 261 files changed, 10981 insertions(+), 16073 deletions(-)
```

## What Changed This Session

- Planned a hard-cut rebrand from RayAlgo/RayReplica to Pyrus. No product source files were edited for the rebrand in this session.
- Confirmed key user decisions:
  - Canonical brand: `Pyrus`.
  - Compatibility policy: hard cut, with no old API fields, storage keys, strategy IDs, or compatibility aliases.
  - Historical scope: active product only; handoff logs and attached raw artifacts stay unchanged.
- Built a map-driven cleanup plan rather than a blind search/replace:
  - `RayAlgo`/`rayalgo`/`RAYALGO` -> `Pyrus`/`pyrus`/`PYRUS`.
  - `RayReplica`/`rayReplica`/`rayreplica`/`RAY_REPLICA`/`ray-replica`/`ray_replica` -> Pyrus equivalents.
  - `artifacts/rayalgo` -> `artifacts/pyrus`.
  - `@workspace/rayalgo` -> `@workspace/pyrus`.
  - `lib/rayreplica-core` -> `lib/pyrus-core`.
  - `@workspace/rayreplica-core` -> `@workspace/pyrus-core`.
  - `rayReplicaSettings` -> `pyrusSettings`.
  - `ray_replica_settings` -> `pyrus_settings`.
  - `ray_replica_signals` -> `pyrus_signals`.
  - `rayalgo-replica-smc-pro-v3` -> `pyrus-smc-pro-v3`.
  - `X-RayAlgo-*` -> `X-Pyrus-*`.
  - `https://rayalgo.local/problems/*` -> `https://pyrus.local/problems/*`.
- Performed read-only audit passes and identified major active-product touchpoints:
  - Frontend package/folder: `artifacts/rayalgo`.
  - Signal core package/folder: `lib/rayreplica-core`.
  - Pine seed and metadata: `artifacts/api-server/data/pine-seeds/rayalgo-replica-smc-pro-v3.pine`, `artifacts/api-server/data/pine-scripts.json`.
  - Chart adapter/settings: `rayReplicaPineAdapter.ts`, `RayReplicaSettingsMenu.tsx`, chart fixture/tests/test IDs.
  - API contracts/generated clients: `lib/api-spec/openapi.yaml`, `lib/api-zod`, `lib/api-client-react`.
  - DB schema: `lib/db/src/schema/signal-monitor.ts`.
  - Backtest strategy/source IDs: `lib/backtest-core/src/strategies.ts`, `artifacts/backtest-worker/src/index.ts`, API backtesting service.
  - API headers/problem URLs/user agents: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/platform.ts`, IBKR/account services.
  - Scripts/current docs/Replit metadata: `scripts/src/ibkr-latency-bench.ts`, `scripts/windows/*`, `replit.md`, `.replit-artifact`, `knip.json`, root TS/workspace/lockfile refs.
  - Visual assets: `artifacts/rayalgo/public/favicon.svg`, `artifacts/rayalgo/public/opengraph.jpg`.
- Refined the plan to explicitly preserve generic algorithmic-trading terms such as `/api/algo/*`, `Algo deployments`, and `AlgoScreen` unless a line is directly RayAlgo-derived.

## Current Status

- Status: plan complete and decision-ready; implementation has not started.
- Validation run this session: read-only audit commands only. No typecheck/build/test was run because the session was planning-focused.
- Important repo state: the worktree was already dirty before this handoff, with many modified/deleted/untracked files from prior work. Do not revert those changes during rebrand implementation unless explicitly instructed.
- Known exclusions for the eventual final audit:
  - Historical handoffs: `SESSION_HANDOFF_*.md`, `SESSION_HANDOFF_MASTER.md`.
  - Attached raw artifacts: `attached_assets/**`.
  - Local/dependency/vendor/cache state: `node_modules`, pnpm store, `.cache`, `.local`, `.vendor`, Replit local state.
  - Generic `algo` occurrences not tied to old branding.
- Broad `ray`/`RR` searches produce false positives from stock tickers and third-party/vendor text. Implementation should require a final exception list rather than force zero generic matches.

## Next Recommended Steps

1. Start implementation with a tracked-file classification pass:
   - `git ls-files | rg -i "ray|replica|algo"`
   - `git grep -n -i -E "rayalgo|ray[ _-]?algo|rayreplica|ray[ _-]?replica|ray_algo|rayalgo\\.local|x-rayalgo|@workspace/ray|ray-replica|ray_replica"`
   - `git grep -n -i -E "logo|brand|title|favicon|opengraph|storage|localstorage|sessionstorage|user-agent|header|problem|scriptKey|strategyId|runtimeAdapterKey|dashboard|alertcondition|data-testid"`
2. Classify every match as `rename`, `keep`, `historical`, or `third-party` before editing. Keep a final exception list.
3. Apply the rename map across active source, workspace/package metadata, API schema/generated clients, DB schema, Pine scripts, chart/backtest/signal monitor code, tests, scripts, Replit metadata, current docs, and visual assets.
4. Regenerate generated API packages and lockfile after contract/package changes.
5. Validate with package/install checks, frontend typecheck/unit/build/browser smoke, API server build/typecheck/tests, API client/Zod tests, and backtest worker/core tests.
6. Final audit should show no active RayAlgo/RayReplica traces; remaining matches must be limited to approved generic, historical, third-party, or local/cache exceptions.
