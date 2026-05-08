import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeMarketGridTrackPixels,
  resizeMarketGridRowPixels,
} from "./marketGridTrackState.js";

const readLocalSource = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("Market chart flow markers use all-flow live and historical contracts", () => {
  const source = readLocalSource("./MultiChartGrid.jsx");
  const scannerCall = source.match(
    /useLiveMarketFlow\(streamedSymbols,\s*\{[\s\S]*?\n  \}\);/,
  )?.[0];

  assert.ok(scannerCall, "Market chart grid must wire a live flow scanner");
  assert.match(source, /import \{ FLOW_SCANNER_SCOPE \}/);
  assert.match(source, /const MARKET_CHART_FLOW_LIMIT = 80;/);
  assert.match(source, /const MARKET_CHART_FLOW_HISTORY_LIMIT = 1_000;/);
  assert.match(source, /const MARKET_CHART_FLOW_LINE_BUDGET = 40;/);
  assert.match(source, /const MARKET_CHART_FLOW_CONCURRENCY = 1;/);
  assert.match(
    source,
    /const MARKET_CHART_FLOW_REQUEST_PRIORITY = BARS_REQUEST_PRIORITY\.active - 1;/,
  );
  assert.match(source, /const MARKET_CHART_FLOW_STARTUP_DELAY_MS = 1_000;/);
  assert.match(source, /chartFlowStartupReady/);
  assert.doesNotMatch(
    source,
    /const MARKET_CHART_FLOW_REQUEST_PRIORITY = BARS_REQUEST_PRIORITY\.active \+ 2;/,
    "historical flow must not outrank active candle hydration",
  );
  assert.match(source, /listFlowEventsRequest/);
  assert.match(source, /buildBarsRequestOptions\(MARKET_CHART_FLOW_REQUEST_PRIORITY\)/);
  assert.match(source, /historicalChartFlowRequests/);
  assert.match(source, /historicalBucketSeconds/);
  assert.match(source, /getChartEventLookbackWindow/);
  assert.match(source, /alignMarketChartFlowHistoryWindow/);
  assert.match(source, /Math\.floor\(from\.getTime\(\) \/ bucketMs\) \* bucketMs/);
  assert.match(source, /Math\.ceil\(to\.getTime\(\) \/ bucketMs\) \* bucketMs/);
  assert.match(source, /mapFlowEventToUi/);
  assert.match(
    source,
    /isTransientEmptyFlowSource\(query\.state\.data\?\.source\) \? 5_000 : 15_000/,
  );
  assert.match(scannerCall, /limit:\s*MARKET_CHART_FLOW_LIMIT/);
  assert.match(scannerCall, /enabled:\s*Boolean\(isVisible && chartFlowStartupReady && streamedSymbols\.length\)/);
  assert.match(scannerCall, /scope:\s*FLOW_SCANNER_SCOPE\.all/);
  assert.match(scannerCall, /concurrency:\s*MARKET_CHART_FLOW_CONCURRENCY/);
  assert.match(scannerCall, /lineBudget:\s*MARKET_CHART_FLOW_LINE_BUDGET/);
  assert.match(scannerCall, /unusualThreshold/);
  assert.match(scannerCall, /workloadLabel:\s*"Chart flow"/);
  assert.doesNotMatch(scannerCall, /limit:\s*16/);
  assert.doesNotMatch(scannerCall, /lineBudget:\s*20/);
  assert.doesNotMatch(scannerCall, /scope:\s*FLOW_SCANNER_SCOPE\.unusual/);
});

test("Market activity panel uses the same broad scanner feed as the flow lane", () => {
  const source = readLocalSource("../../screens/MarketScreen.jsx");

  assert.match(source, /BROAD_MARKET_FLOW_STORE_KEY/);
  assert.match(source, /useMarketFlowSnapshotForStoreKey/);
  assert.match(
    source,
    /useMarketFlowSnapshotForStoreKey\(\s*BROAD_MARKET_FLOW_STORE_KEY/,
  );
  assert.match(source, /flowSnapshotSource="broad-scanner"/);
  assert.doesNotMatch(source, /chartFlowSnapshotState/);
  assert.doesNotMatch(source, /activityFlowSnapshot\s*=\s*chartFlowSnapshot/);
  assert.doesNotMatch(source, /onChartFlowSnapshotChange=\{handleChartFlowSnapshotChange\}/);
});

test("Market chart cells delegate rendering to the Trade spot chart path", () => {
  const source = readLocalSource("./MiniChartCell.jsx");

  assert.match(source, /import \{ TradeEquityPanel \}/);
  assert.match(source, /<TradeEquityPanel/);
  assert.match(source, /surfaceUiStateKey=\{`market-spot-chart:\$\{slotId\}:\$\{timeframe\}`\}/);
  assert.match(source, /viewportLayoutKey=\{chartViewportLayoutKey\}/);
  assert.match(source, /workspaceChart=\{\{ timeframe \}\}/);
  assert.match(source, /prewarmFavoriteTimeframesEnabled=\{false\}/);
  assert.match(source, /flowEventsSourceMode="provided"/);
  assert.match(source, /onWorkspaceChartChange=\{handleWorkspaceChartChange\}/);
  assert.doesNotMatch(source, /resolveSignalFrameState/);
  assert.doesNotMatch(source, /useSignalMonitorStateForSymbol/);
  assert.doesNotMatch(source, /showSignalFrameBorder=\{false\}/);
  assert.doesNotMatch(source, /quote/);
  assert.doesNotMatch(source, /onChangeStudies/);
  assert.doesNotMatch(source, /onChangeRayReplicaSettings/);
  assert.doesNotMatch(source, /getBarsRequest/);
  assert.doesNotMatch(source, /ResearchChartFrame/);
  assert.doesNotMatch(source, /useHistoricalBarStream/);
  assert.doesNotMatch(source, /useBrokerStreamedBars/);
  assert.doesNotMatch(source, /useProgressiveChartBarLimit/);
  assert.doesNotMatch(source, /useUnderfilledChartBackfill/);
});

test("Trade spot chart forwards market viewport layout context to the chart surface", () => {
  const panelSource = readLocalSource("../trade/TradeEquityPanel.jsx");
  const frameSource = readLocalSource("../charting/ResearchChartFrame.tsx");

  assert.match(panelSource, /viewportLayoutKey = null/);
  assert.match(panelSource, /viewportLayoutKey=\{viewportLayoutKey\}/);
  assert.doesNotMatch(panelSource, /key=\{chartHydrationScopeKey\}/);
  assert.match(frameSource, /viewportLayoutKey\?: string \| null/);
  assert.match(frameSource, /viewportLayoutKey=\{viewportLayoutKey\}/);
});

test("Trade spot chart uses the IBKR aggregate stream as its live stock layer", () => {
  const panelSource = readLocalSource("../trade/TradeEquityPanel.jsx");

  assert.match(panelSource, /useBrokerStreamedBars/);
  assert.match(panelSource, /useSignalMonitorStateForSymbol/);
  assert.match(panelSource, /resolveSignalFrameState/);
  assert.match(panelSource, /frameSignalState=\{showSignalFrameBorder \? signalFrameState : null\}/);
  assert.match(panelSource, /ibkr-websocket-derived/);
  assert.match(panelSource, /allowHistoricalSynthesis:\s*true/);
  assert.doesNotMatch(panelSource, /allowHistoricalSynthesis:\s*false/);
  assert.doesNotMatch(panelSource, /useHistoricalBarStreamState/);
  assert.doesNotMatch(panelSource, /liveFallbackRequestMs/);
});

test("Market chart cells leave signal frame ownership inside the shared chart frame", () => {
  const cellSource = readLocalSource("./MiniChartCell.jsx");
  const panelSource = readLocalSource("../trade/TradeEquityPanel.jsx");
  const frameSource = readLocalSource("../charting/ResearchChartFrame.tsx");

  assert.doesNotMatch(cellSource, /data-signal-direction/);
  assert.doesNotMatch(cellSource, /data-signal-frame-active/);
  assert.doesNotMatch(cellSource, /signalFrameState/);
  assert.match(panelSource, /showSignalFrameBorder = true/);
  assert.match(panelSource, /frameSignalState=\{showSignalFrameBorder \? signalFrameState : null\}/);
  assert.match(frameSource, /data-signal-direction=\{signalActive \? frameSignalState\?\.direction : "none"\}/);
});

test("Research chart frames expose signal frame state as first-class attributes", () => {
  const frameSource = readLocalSource("../charting/ResearchChartFrame.tsx");

  assert.match(frameSource, /frameSignalState\?: FrameSignalState/);
  assert.match(frameSource, /data-signal-direction=\{signalActive \? frameSignalState\?\.direction : "none"\}/);
  assert.match(frameSource, /data-signal-frame-active=\{signalActive \? "true" : "false"\}/);
  assert.match(frameSource, /data-signal-frame-color=\{signalActive \? frameSignalState\?\.color : undefined\}/);
  assert.match(frameSource, /aria-label=\{signalActive \? frameSignalState\?\.label : undefined\}/);
  assert.match(frameSource, /border:\s*signalActive/);
});

test("Market chart flow events publish to the shared Trade spot chart path", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");
  const cellSource = readLocalSource("./MiniChartCell.jsx");
  const tradeSpotSource = readLocalSource("../trade/TradeEquityPanel.jsx");

  assert.match(gridSource, /isTransientEmptyFlowSource/);
  assert.match(gridSource, /historicalChartFlowRetainedRef/);
  assert.match(gridSource, /buildBarsRequestOptions\(MARKET_CHART_FLOW_REQUEST_PRIORITY\)/);
  assert.match(gridSource, /BROAD_MARKET_FLOW_STORE_KEY/);
  assert.match(gridSource, /useMarketFlowSnapshotForStoreKey/);
  assert.match(gridSource, /mergeFlowEventFeeds/);
  assert.match(gridSource, /filterFlowEventsForSymbol/);
  assert.match(gridSource, /effectiveChartFlowSnapshot/);
  assert.match(gridSource, /filterFlowEventsForChartDisplay/);
  assert.match(gridSource, /const chartDisplayFlowEvents = useMemo/);
  assert.match(gridSource, /const flowEventsBySymbol = useMemo/);
  assert.match(gridSource, /publishTradeFlowSnapshotsByTicker/);
  assert.match(gridSource, /flowEvents=\{flowEventsBySymbol/);
  assert.match(cellSource, /flowEvents=\{flowEvents\}/);
  assert.match(cellSource, /flowEventsSourceMode="provided"/);
  assert.match(tradeSpotSource, /flowEventsSourceMode = "merge-store"/);
  assert.match(tradeSpotSource, /const shouldMergeTradeFlowStore = flowEventsSourceMode !== "provided";/);
  assert.match(
    tradeSpotSource,
    /const tradeFlowSnapshot = useTradeFlowSnapshot\(ticker,\s*\{\s*subscribe:\s*shouldMergeTradeFlowStore,\s*\}\)/,
  );
  assert.match(tradeSpotSource, /mergeFlowEventFeeds\(/);
  assert.match(tradeSpotSource, /prewarmFavoriteTimeframesEnabled = true/);
  assert.match(tradeSpotSource, /!prewarmFavoriteTimeframesEnabled/);
  assert.match(tradeSpotSource, /COMPACT_FULL_WINDOW_HYDRATION_DELAY_MS = 30_000/);
  assert.match(tradeSpotSource, /if \(!compact\) \{/);
  assert.match(tradeSpotSource, /if \(!shouldMergeTradeFlowStore\) \{/);
  assert.match(tradeSpotSource, /\?\s*filterFlowEventsForChartDisplay\(effectiveFlowEvents,\s*flowTapeFilters\)\s*:\s*effectiveFlowEvents/);
  assert.match(tradeSpotSource, /tradeFlowSnapshot\.events \|\| \[\]/);
  assert.doesNotMatch(tradeSpotSource, /retainedFlowState/);
  assert.doesNotMatch(gridSource, /quote=\{/);
  assert.doesNotMatch(gridSource, /onChangeStudies=\{/);
  assert.doesNotMatch(gridSource, /onChangeRayReplicaSettings=\{/);
  assert.doesNotMatch(gridSource, /flowEventsToChartEvents/);
});

test("Flow chart markers apply shared Flow filters for chart display", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");
  const tradeSpotSource = readLocalSource("../trade/TradeEquityPanel.jsx");
  const tradeScreenSource = readLocalSource("../../screens/TradeScreen.jsx");

  assert.match(gridSource, /useFlowTapeFilterState\(\{ subscribe:\s*isVisible \}\)/);
  assert.match(
    gridSource,
    /filterFlowEventsForChartDisplay\(chartFlowEvents,\s*flowTapeFilters\)/,
  );
  assert.match(gridSource, /buildPremiumFlowBySymbol\(chartDisplayFlowEvents/);
  assert.match(gridSource, /\(chartDisplayFlowEvents \|\| \[\]\)\.forEach/);
  assert.match(
    tradeSpotSource,
    /useFlowTapeFilterState\(\{\s*subscribe:\s*shouldMergeTradeFlowStore,\s*\}\)/,
  );
  assert.match(
    tradeSpotSource,
    /filterFlowEventsForChartDisplay\(effectiveFlowEvents,\s*flowTapeFilters\)/,
  );
  assert.match(
    tradeSpotSource,
    /flowEventsToChartEventConversion\(chartDisplayFlowEvents \|\| \[\],\s*ticker\)/,
  );
  assert.match(tradeScreenSource, /useFlowTapeFilterState\(\)/);
  assert.match(tradeScreenSource, /filterFlowEventsForChartDisplay/);
  assert.match(tradeScreenSource, /const activeTickerChartFlowEvents = useMemo/);
  assert.match(tradeScreenSource, /mergeFlowEventFeeds\(\s*activeTickerTradeFlowSnapshot\.events \|\| \[\],\s*activeTickerBroadFlowEvents,\s*\)/);
  assert.match(tradeScreenSource, /flowEvents=\{activeTickerChartFlowEvents\}/);
  assert.match(tradeScreenSource, /const parentFlowEventsProvided = flowEvents !== undefined/);
  assert.match(
    tradeScreenSource,
    /filterFlowEventsForOptionContract\(\s*filterFlowEventsForChartDisplay\(mergedFlowEvents,\s*flowTapeFilters\)/,
  );
  assert.match(
    tradeScreenSource,
    /flowEventsToChartEventConversion\(selectedContractFlowEvents,\s*ticker\)/,
  );
  assert.doesNotMatch(tradeScreenSource, /retainedFlowState/);
});

test("Market chart frames leave viewport ownership inside the Trade spot chart", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");
  const cellSource = readLocalSource("./MiniChartCell.jsx");

  assert.match(gridSource, /chartViewportResetRevision/);
  assert.match(gridSource, /chartViewportLayoutRevision/);
  assert.match(gridSource, /buildMarketChartViewportLayoutKey/);
  assert.match(cellSource, /chartViewportLayoutKey/);
  assert.match(cellSource, /viewportLayoutKey=\{chartViewportLayoutKey\}/);
  assert.match(gridSource, /clearStoredChartViewportSnapshot/);
  assert.match(gridSource, /buildChartBarScopeKey\("trade-equity-chart"/);
  assert.doesNotMatch(gridSource, /buildMarketGridViewportRevisionIdentity/);
  assert.doesNotMatch(cellSource, /rangeIdentityKey/);
  assert.doesNotMatch(cellSource, /persistScalePrefs/);
  assert.doesNotMatch(gridSource, /chartViewportSnapshots/);
  assert.doesNotMatch(gridSource, /rememberViewportSnapshot/);
  assert.doesNotMatch(gridSource, /clearViewportSnapshot/);
  assert.doesNotMatch(cellSource, /viewportSnapshot/);
  assert.doesNotMatch(cellSource, /onViewportSnapshotChange/);
  assert.doesNotMatch(cellSource, /viewportUserTouched/);
});

test("Market chart row resizing conserves total grid height", () => {
  const initialRows = [300, 300, 300];
  const resized = resizeMarketGridRowPixels(initialRows, 1, 80, 150);

  assert.deepEqual(resized, [380, 220, 300]);
  assert.equal(
    resized.reduce((sum, value) => sum + value, 0),
    initialRows.reduce((sum, value) => sum + value, 0),
  );
});

test("Market chart row resizing clamps adjacent rows at the minimum", () => {
  assert.deepEqual(
    resizeMarketGridRowPixels([240, 240], 1, 500, 180),
    [300, 180],
  );
  assert.deepEqual(
    resizeMarketGridRowPixels([240, 240], 1, -500, 180),
    [180, 300],
  );
});

test("Market chart persisted row heights normalize safely", () => {
  assert.deepEqual(
    normalizeMarketGridTrackPixels([120, Number.NaN], 2, 300, 180),
    [180, 300],
  );
  assert.deepEqual(
    normalizeMarketGridTrackPixels([120], 2, 300, 180),
    [300, 300],
  );
});

test("Market mini chart no longer owns a provider-contract chart data path", () => {
  const source = readLocalSource("./MiniChartCell.jsx");

  assert.match(source, /TradeEquityPanel/);
  assert.doesNotMatch(source, /resolveMarketGridChartProviderContractId/);
  assert.doesNotMatch(source, /chartProviderContractId/);
  assert.doesNotMatch(
    source,
    /slot\?\.providerContractId/,
    "MiniChartCell should not pass raw provider contracts into chart requests",
  );
});
