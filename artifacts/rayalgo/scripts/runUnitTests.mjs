#!/usr/bin/env node

import { spawn } from "node:child_process";

const unitTestFiles = [
  "src/features/charting/rayReplicaPineAdapter.test.ts",
  "src/features/charting/model.test.ts",
  "src/features/charting/ResearchChartSurface.test.ts",
  "src/features/charting/activeChartBarStore.test.ts",
  "src/features/charting/useMassiveStreamedStockBars.test.ts",
  "src/features/charting/useOptionChartBars.test.js",
  "src/features/charting/chartHydrationStats.test.ts",
  "src/features/charting/marketSession.test.ts",
  "src/features/charting/chartApiBars.test.js",
  "src/features/charting/chartEvents.test.ts",
  "src/features/charting/flowChartEvents.test.ts",
  "src/app/runtimeDiagnostics.test.ts",
  "src/features/flow/flowScannerStatusModel.test.js",
  "src/features/preferences/userPreferenceModel.test.ts",
  "src/features/platform/platformRootSource.test.js",
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
  "src/features/platform/flowSourceState.test.js",
  "src/features/trade/optionChainLoadingPlan.test.js",
  "src/features/trade/optionChainRows.test.js",
  "src/features/trade/optionQuoteHydrationPlan.test.js",
  "src/features/trade/optionSellCallIntent.test.js",
  "src/features/trade/automationDeviationModel.test.js",
  "src/features/trade/ibkrOrderTicketModel.test.js",
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
  "src/screens/diagnostics/localAlerts.test.js",
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
