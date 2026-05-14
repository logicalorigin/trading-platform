#!/usr/bin/env node

import { spawn } from "node:child_process";

const unitTestFiles = [
  "src/features/charting/rayReplicaPineAdapter.test.ts",
  "src/features/charting/model.test.ts",
  "src/features/charting/ResearchChartSurface.test.ts",
  "src/features/charting/activeChartBarStore.test.ts",
  "src/features/charting/chartCrosshairSyncStore.test.ts",
  "src/features/charting/useMassiveStreamedStockBars.test.ts",
  "src/features/charting/useOptionChartBars.test.js",
  "src/features/charting/chartHydrationStats.test.ts",
  "src/features/charting/chartHydrationRuntime.test.js",
  "src/features/charting/chartHydrationWiring.test.js",
  "src/features/charting/marketSession.test.ts",
  "src/features/charting/chartApiBars.test.js",
  "src/features/charting/chartEvents.test.ts",
  "src/features/charting/flowChartEvents.test.ts",
  "src/app/runtime-config.test.ts",
  "src/app/runtimeDiagnostics.test.ts",
  "src/lib/responsive.test.ts",
  "src/lib/touch.test.ts",
  "src/lib/uiTokens.test.js",
  "src/features/flow/flowRowsConfig.test.js",
  "src/features/flow/flowTapeColumns.test.js",
  "src/features/flow/flowScannerStatusModel.test.js",
  "src/features/gex/gexModel.test.js",
  "src/features/gex/useGexZeroGamma.test.ts",
  "src/features/gex/gexDataWiring.test.js",
  "src/features/gex/gexNarrative.test.js",
  "src/features/gex/intradaySnapshots.test.js",
  "src/features/gex/gexGlossary.test.js",
  "src/features/platform/gexScreenWiring.test.js",
  "src/features/preferences/userPreferenceModel.test.ts",
  "src/features/platform/platformRootSource.test.js",
  "src/features/platform/streamSemantics.test.ts",
  "src/features/platform/flowFilterStore.test.js",
  "src/features/market/marketChartWiring.test.js",
  "src/features/platform/tradeOptionChainStore.test.js",
  "src/features/platform/tradeFlowStore.test.js",
  "src/features/platform/flowOptionChartIdentity.test.js",
  "src/features/platform/flowTapeModel.test.js",
  "src/features/platform/marketFlowScannerConfig.test.js",
  "src/features/platform/marketActivityLaneModel.test.js",
  "src/features/platform/memoryPressureModel.test.js",
  "src/features/platform/appWorkScheduler.test.js",
  "src/features/platform/workPressureModel.test.js",
  "src/features/platform/runtimeControlModel.test.js",
  "src/features/platform/runtimeCache.test.js",
  "src/features/platform/flowSourceState.test.js",
  "src/features/platform/signalMonitorStatusModel.test.js",
  "src/features/trade/optionChainLoadingPlan.test.js",
  "src/features/trade/optionChainRows.test.js",
  "src/features/trade/optionChainVirtualRows.test.js",
  "src/features/trade/optionQuoteHydrationPlan.test.js",
  "src/features/trade/optionSellCallIntent.test.js",
  "src/features/trade/automationDeviationModel.test.js",
  "src/features/trade/ibkrOrderTicketModel.test.js",
  "src/features/trade/TradePositionsPanel.test.js",
  "src/features/trade/tradeBrokerRequests.test.js",
  "src/features/backtesting/backtestingDateRanges.test.ts",
  "src/features/charting/flowChartSpider.test.ts",
  "src/features/platform/live-streams.test.ts",
  "src/features/platform/marketFlowStore.test.js",
  "src/features/platform/headerBroadcastModel.test.js",
  "src/features/platform/premiumFlowIndicator.test.js",
  "src/features/platform/optionsPremiumModel.test.js",
  "src/features/platform/ibkrBridgeSession.test.js",
  "src/features/platform/IbkrConnectionStatus.test.js",
  "src/features/platform/watchlistModel.test.js",
  "src/features/platform/tickerSearch/model.test.js",
  "src/features/platform/marketIdentity.test.js",
  "src/features/workers/analyticsWorkerApi.test.js",
  "src/screens/account/equityCurveData.test.js",
  "src/screens/account/accountPositionRows.test.js",
  "src/screens/account/accountRefreshPolicy.test.js",
  "src/screens/account/accountCalendarData.test.js",
  "src/screens/account/accountPnlCalendarModel.test.js",
  "src/screens/account/tradeOutcomeHistogramModel.test.js",
  "src/screens/account/accountReturnsModel.test.js",
  "src/screens/account/accountPatternLens.test.js",
  "src/screens/account/accountTradingAnalysis.test.js",
  "src/screens/account/positionsAtDateInspectorModel.test.js",
  "src/screens/account/AccountHeaderStrip.test.js",
  "src/screens/account/AccountReturnsPanel.test.js",
  "src/screens/account/ExpiryCalendarHeatmap.test.js",
  "src/screens/account/IntradayPnlPanel.test.js",
  "src/screens/account/PositionTreemapPanel.test.js",
  "src/screens/account/PositionsPanel.test.js",
  "src/screens/account/TradesOrdersPanel.test.js",
  "src/screens/account/TradingPatternsPanel.test.js",
  "src/screens/diagnostics/localAlerts.test.js",
  "src/screens/algoCockpitDiagnosticsModel.test.js",
  "src/screens/settings/ibkrLaneUiModel.test.js",
  "src/screens/TradeScreen.search-handlers.test.mjs",
];

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...unitTestFiles],
  {
    env: process.env,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
