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
  assert.match(source, /const MARKET_CHART_FLOW_LIMIT = 160;/);
  assert.match(source, /const MARKET_CHART_FLOW_HISTORY_LIMIT = 1_000;/);
  assert.match(source, /const MARKET_CHART_FLOW_LINE_BUDGET = 80;/);
  assert.match(source, /const MARKET_CHART_FLOW_MAX_CONCURRENCY = 4;/);
  assert.match(
    source,
    /const MARKET_CHART_FLOW_REQUEST_PRIORITY = BARS_REQUEST_PRIORITY\.active;/,
  );
  assert.match(source, /const MARKET_CHART_FLOW_REFRESH_MS = 5_000;/);
  assert.match(source, /const MARKET_CHART_FLOW_HISTORY_REFRESH_MS = 15_000;/);
  assert.match(
    source,
    /const MARKET_CHART_FLOW_HISTORY_TRANSIENT_REFRESH_MS = 5_000;/,
  );
  assert.doesNotMatch(source, /MARKET_CHART_FLOW_STARTUP_DELAY_MS/);
  assert.doesNotMatch(source, /chartFlowStartupReady/);
  assert.doesNotMatch(
    source,
    /const MARKET_CHART_FLOW_REQUEST_PRIORITY = BARS_REQUEST_PRIORITY\.active \+ 2;/,
    "historical flow must not outrank active candle hydration",
  );
  assert.match(source, /listFlowEventsRequest/);
  assert.match(source, /buildBarsRequestOptions\([\s\S]*MARKET_CHART_FLOW_REQUEST_PRIORITY[\s\S]*"chart-flow"/);
  assert.match(source, /historicalChartFlowRequests/);
  const historicalQueriesBlock = source.match(
    /const historicalChartFlowQueries = useQueries\(\{[\s\S]*?\n  \}\);/,
  )?.[0];
  assert.ok(
    historicalQueriesBlock,
    "Market chart grid must wire historical chart flow queries",
  );
  assert.match(source, /const historicalChartFlowEnabled = Boolean/);
  assert.match(source, /const chartFlowHydrationReady =/);
  assert.match(source, /firstChartReady && chartFlowHydrationGate\.enabled/);
  assert.match(
    historicalQueriesBlock,
    /enabled:\s*Boolean\(historicalChartFlowEnabled && request\.symbol\)/,
  );
  assert.doesNotMatch(
    historicalQueriesBlock,
    /enabled:\s*Boolean\(chartFlowEnabled && request\.symbol\)/,
    "historical Massive flow must not wait on the IBKR live scanner gate",
  );
  assert.match(source, /historicalBucketSeconds/);
  assert.match(source, /getChartEventLookbackWindow/);
  assert.match(source, /alignMarketChartFlowHistoryWindow/);
  assert.match(source, /Math\.floor\(from\.getTime\(\) \/ bucketMs\) \* bucketMs/);
  assert.match(source, /Math\.ceil\(to\.getTime\(\) \/ bucketMs\) \* bucketMs/);
  assert.match(source, /mapFlowEventToUi/);
  assert.match(
    source,
    /isHistoricalChartFlowTransientSource\(query\.state\.data\?\.source\)[\s\S]*\? MARKET_CHART_FLOW_HISTORY_TRANSIENT_REFRESH_MS[\s\S]*: MARKET_CHART_FLOW_HISTORY_REFRESH_MS/,
  );
  assert.match(scannerCall, /limit:\s*MARKET_CHART_FLOW_LIMIT/);
  assert.match(scannerCall, /enabled:\s*chartFlowEnabled/);
  assert.match(scannerCall, /scope:\s*FLOW_SCANNER_SCOPE\.all/);
  assert.match(scannerCall, /blocking:\s*false/);
  assert.match(scannerCall, /batchSize:\s*marketChartFlowBatchSize/);
  assert.match(scannerCall, /concurrency:\s*marketChartFlowConcurrency/);
  assert.match(scannerCall, /lineBudget:\s*MARKET_CHART_FLOW_LINE_BUDGET/);
  assert.match(scannerCall, /intervalMs:\s*MARKET_CHART_FLOW_REFRESH_MS/);
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
  assert.match(source, /const flowSnapshot = useMarketFlowSnapshotForStoreKey/);
  assert.match(source, /const \{\s*putCall,\s*sectorFlow,\s*flowStatus,\s*flowEvents,\s*\} = flowSnapshot;/);
  assert.match(source, /for \(const event of flowEvents \|\| \[\]\)/);
  assert.doesNotMatch(source, /chartFlowSnapshotState/);
  assert.doesNotMatch(source, /activityFlowSnapshot\s*=\s*chartFlowSnapshot/);
  assert.doesNotMatch(source, /onChartFlowSnapshotChange=\{handleChartFlowSnapshotChange\}/);
});

test("Market chart cells delegate rendering to the Trade spot chart path", () => {
  const source = readLocalSource("./MarketChartCell.jsx");

  assert.match(source, /const LazyTradeEquityPanel = lazyWithRetry/);
  assert.match(source, /import\("\.\.\/trade\/TradeEquityPanel\.jsx"\)/);
  assert.match(source, /const LazyMarketChartTickerSearch = lazyWithRetry/);
  assert.match(source, /import\("\.\.\/platform\/tickerSearch\/TickerSearch\.jsx"\)/);
  assert.doesNotMatch(source, /import \{ MarketChartTickerSearch \}/);
  assert.match(source, /getChartTimeframeValues\("primary"\)/);
  assert.match(source, /<LazyTradeEquityPanel/);
  assert.match(source, /surfaceUiStateKey=\{`market-spot-chart:\$\{slotId\}:\$\{timeframe\}`\}/);
  assert.match(source, /viewportLayoutKey=\{chartViewportLayoutKey\}/);
  assert.match(source, /workspaceChart=\{\{ timeframe \}\}/);
  assert.match(source, /prewarmFavoriteTimeframesEnabled=\{false\}/);
  assert.match(source, /flowEventsSourceMode="provided"/);
  assert.doesNotMatch(source, /chartHydrationRole="mini"/);
  assert.match(source, /onWorkspaceChartChange=\{handleWorkspaceChartChange\}/);
  assert.doesNotMatch(source, /resolveSignalFrameState/);
  assert.doesNotMatch(source, /useSignalMonitorStateForSymbol/);
  assert.doesNotMatch(source, /showSignalFrameBorder=\{false\}/);
  assert.doesNotMatch(source, /quote/);
  assert.doesNotMatch(source, /onChangeStudies/);
  assert.doesNotMatch(source, /onChangePyrusSignalsSettings/);
  assert.doesNotMatch(source, /getBarsRequest/);
  assert.doesNotMatch(source, /ResearchChartFrame/);
  assert.doesNotMatch(source, /useHistoricalBarStream/);
  assert.doesNotMatch(source, /useBrokerStreamedBars/);
  assert.doesNotMatch(source, /useProgressiveChartBarLimit/);
  assert.doesNotMatch(source, /useUnderfilledChartBackfill/);
});

test("Market active chart cell adds the GEX zero-gamma reference line", () => {
  const source = readLocalSource("./MarketChartCell.jsx");

  assert.doesNotMatch(source, /MARKET_GEX_REFERENCE_DELAY_MS/);
  assert.doesNotMatch(source, /gexReferenceReady/);
  assert.match(source, /useGexZeroGamma\(ticker,\s*\{\s*enabled: Boolean\(ticker && isActive\)/);
  assert.match(source, /useGexZeroGammaReferenceLine\(gexZeroGamma\)/);
  assert.match(source, /const gexReferenceLines = useMemo/);
  assert.match(source, /referenceLines=\{gexReferenceLines\}/);
});

test("Market chart grid uses one-column phone density", () => {
  const source = readLocalSource("./MultiChartGrid.jsx");

  assert.match(source, /const phoneGrid = gridBodyWidth > 0 && gridBodyWidth < 768;/);
  assert.match(source, /const renderedCols = phoneGrid \? 1/);
  assert.match(source, /visibleSlotEntries\.length/);
  assert.match(source, /const showGridResizeControl =\s*\n\s*!phoneGrid/);
  assert.match(source, /phoneGrid\s*\?\s*360/);
  assert.match(source, /const renderedSlotEntries = phoneGrid/);
});

test("Market chart grid staggers candle hydration without hiding chart frames", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");
  const cellSource = readLocalSource("./MarketChartCell.jsx");

  assert.match(gridSource, /const MARKET_CHART_INITIAL_HYDRATION_SLOTS = 1;/);
  assert.match(gridSource, /const MARKET_CHART_HYDRATION_STAGGER_MS = 1_200;/);
  assert.match(gridSource, /const MARKET_CHART_BACKOFF_HYDRATION_STAGGER_MS = 2_500;/);
  assert.match(gridSource, /useHydrationGate/);
  assert.match(gridSource, /const allowProgressiveChartHydration = Boolean/);
  assert.match(gridSource, /const allowProgressiveChartHydration = Boolean\(chartHydrationGate\.enabled\)/);
  assert.match(gridSource, /const \[hydrationSlotLimit, setHydrationSlotLimit\]/);
  assert.match(gridSource, /const readySignaledRef = useRef\(false\)/);
  assert.match(gridSource, /const handleFirstVisibleChartReady = useCallback/);
  assert.match(gridSource, /onReady\?\.\(\)/);
  assert.match(gridSource, /setHydrationSlotLimit\(initialHydrationSlotLimit\)/);
  assert.match(
    gridSource,
    /window\.setTimeout\(\(\) => \{[\s\S]*setHydrationSlotLimit\(\(current\) =>[\s\S]*Math\.max\(current, nextSlotLimit\)/,
  );
  assert.match(gridSource, /const effectiveHydrationStaggerMs =/);
  assert.match(gridSource, /MARKET_CHART_BACKOFF_HYDRATION_STAGGER_MS/);
  assert.match(gridSource, /chartHydrationGate\.pressure === "stalled"/);
  assert.match(gridSource, /data-chart-hydration-pressure=\{chartHydrationGate\.pressure\}/);
  assert.match(gridSource, /data-chart-hydration-slot-limit=\{effectiveHydrationSlotLimit\}/);
  assert.match(gridSource, /const chartHydrationEnabled =\s*\n\s*visibleIndex < effectiveHydrationSlotLimit;/);
  assert.match(gridSource, /historicalDataEnabled=\{chartHydrationEnabled\}/);
  assert.match(gridSource, /fullFrame=\{layout === "1x1"\}/);
  assert.match(
    gridSource,
    /stockAggregateStreamingEnabled=\{\s*stockAggregateStreamingEnabled && chartHydrationEnabled\s*\}/,
  );
  assert.match(gridSource, /onReady=\{\s*visibleIndex === 0 && chartHydrationEnabled/);
  assert.match(cellSource, /historicalDataEnabled = true/);
  assert.match(cellSource, /fullFrame = false/);
  assert.match(cellSource, /compact=\{fullFrame \? dense : true\}/);
  assert.match(cellSource, /prewarmFavoriteTimeframesEnabled=\{false\}/);
  assert.match(cellSource, /export const preloadMarketChartRuntime = \(\) =>/);
  assert.match(cellSource, /preloadDynamicImport\(loadTradeEquityPanelModule/);
  assert.match(cellSource, /const MarketChartReadyProbe = \(\{ onReady, readyKey \}\)/);
  assert.match(cellSource, /requestAnimationFrame\(\(\) => \{\s*onReady\(\);/);
  assert.match(cellSource, /\}, \[onReady,\s*readyKey\]\);/);
  assert.match(gridSource, /const chartReadySignalKey = `\$\{streamedSymbolsKey\}:\$\{initialHydrationSlotLimit\}`;/);
  assert.match(cellSource, /readyKey = ""/);
  assert.match(gridSource, /readyKey=\{chartReadySignalKey\}/);
  assert.match(cellSource, /<MarketChartReadyProbe onReady=\{onReady\} readyKey=\{readyKey\} \/>/);
  assert.match(cellSource, /historicalDataEnabled=\{historicalDataEnabled\}/);
  assert.match(cellSource, /<MarketChartPanelFallback dataTestId=\{dataTestId\} \/>/);
});

test("Market chart grid leaves quote stream ownership to the runtime provider", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");

  assert.doesNotMatch(gridSource, /useIbkrQuoteSnapshotStream/);
});

test("Trade spot chart forwards market viewport layout context to the chart surface", () => {
  const panelSource = readLocalSource("../trade/TradeEquityPanel.jsx");
  const frameSource = readLocalSource("../charting/ResearchChartFrame.tsx");

  assert.match(panelSource, /viewportLayoutKey = null/);
  assert.match(panelSource, /const chartViewportLayoutKey = intervalChangeRevision/);
  assert.match(panelSource, /viewportLayoutKey=\{chartViewportLayoutKey\}/);
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
  const cellSource = readLocalSource("./MarketChartCell.jsx");
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

test("Shared chart frames own responsive chrome density", () => {
  const cellSource = readLocalSource("./MarketChartCell.jsx");
  const tradeSpotSource = readLocalSource("../trade/TradeEquityPanel.jsx");
  const tradeScreenSource = readLocalSource("../../screens/TradeScreen.jsx");
  const contractDetailSource = readLocalSource("../flow/ContractDetailInline.jsx");
  const contractFlowSource = readLocalSource(
    "../charting/useContractFlowChartEvents.js",
  );
  const frameSource = readLocalSource("../charting/ResearchChartFrame.tsx");

  assert.match(frameSource, /data-chart-frame-density=\{frameDensity\}/);
  assert.match(frameSource, /resolveResearchChartFrameDensity/);
  assert.match(frameSource, /ChartFrameDensityContext\.Provider/);
  assert.match(cellSource, /chartFramePlacement=\{/);
  assert.match(tradeSpotSource, /<ResearchChartFrame/);
  assert.match(tradeScreenSource, /dataTestId="trade-contract-option-chart"/);
  assert.match(contractDetailSource, /dataTestId="flow-inspection-option-chart"/);
});

test("Flow inspection option charts receive contract flow history", () => {
  const flowScreenSource = readLocalSource("../../screens/FlowScreen.jsx");
  const contractDetailSource = readLocalSource("../flow/ContractDetailInline.jsx");

  assert.match(flowScreenSource, /flowEvents=\{flowEvents\}/);
  assert.match(contractDetailSource, /useContractFlowChartEvents/);
  assert.match(contractDetailSource, /pinnedEvent:\s*evt/);
  assert.match(contractDetailSource, /chartFlowDiagnostics=\{optionChartEventConversion\}/);
});

test("Market chart flow events publish to the shared Trade spot chart path", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");
  const cellSource = readLocalSource("./MarketChartCell.jsx");
  const tradeSpotSource = readLocalSource("../trade/TradeEquityPanel.jsx");
  const tradeScreenSource = readLocalSource("../../screens/TradeScreen.jsx");
  const marketFlowRuntimeSource = readLocalSource(
    "../platform/MarketFlowRuntimeLayer.jsx",
  );

  assert.match(gridSource, /isTransientEmptyFlowSource/);
  assert.match(gridSource, /historicalChartFlowRetainedRef/);
  assert.match(gridSource, /mergeFlowEventFeeds\(retainedEvents,\s*incomingEvents\)/);
  assert.match(gridSource, /buildBarsRequestOptions\([\s\S]*MARKET_CHART_FLOW_REQUEST_PRIORITY[\s\S]*"chart-flow"/);
  assert.match(gridSource, /BROAD_MARKET_FLOW_STORE_KEY/);
  assert.match(gridSource, /useMarketFlowSnapshotForStoreKey/);
  assert.match(gridSource, /mergeFlowEventFeeds/);
  assert.match(gridSource, /filterFlowEventsForSymbol/);
  assert.match(gridSource, /filterFlowEventsForChartLookbackWindow/);
  assert.match(gridSource, /effectiveChartFlowSnapshot/);
  assert.match(gridSource, /filterFlowEventsForChartDisplay/);
  assert.match(gridSource, /const chartDisplayFlowEvents = useMemo/);
  assert.match(gridSource, /const flowEventsBySlotIndex = useMemo/);
  assert.match(gridSource, /visibleSlotEntries\.forEach\(\(\{ slot, index \}\)/);
  assert.match(gridSource, /publishTradeFlowSnapshotsByTicker/);
  assert.match(gridSource, /preserveExistingOnEmpty: true/);
  assert.match(marketFlowRuntimeSource, /preserveExistingOnEmpty: true/);
  assert.match(gridSource, /flowEvents=\{flowEventsBySlotIndex\[index\]/);
  assert.doesNotMatch(gridSource, /chartFlowTimeframeBySymbol/);
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
  assert.match(tradeSpotSource, /MINI_FULL_WINDOW_HYDRATION_DELAY_MS = 12_000/);
  assert.match(
    tradeSpotSource,
    /if \(!resolvedChartFrameCompact \|\| intervalChangeRevision > 0\) \{/,
  );
  assert.match(tradeSpotSource, /if \(!shouldMergeTradeFlowStore\) \{/);
  assert.match(tradeSpotSource, /\?\s*filterFlowEventsForChartDisplay\(effectiveFlowEvents,\s*flowTapeFilters\)\s*:\s*effectiveFlowEvents/);
  assert.match(tradeSpotSource, /tradeFlowSnapshot\.events \|\| \[\]/);
  assert.match(
    tradeScreenSource,
    /mergeFlowEventFeeds\(retainedEvents,\s*incomingHistoricalEvents\)/,
  );
  assert.match(
    tradeScreenSource,
    /const TRADE_FLOW_HISTORY_TRANSIENT_REFRESH_MS = 5_000;/,
  );
  assert.match(
    tradeScreenSource,
    /reason\.includes\("options_flow_historical_"\)/,
  );
  assert.doesNotMatch(tradeSpotSource, /retainedFlowState/);
  assert.doesNotMatch(gridSource, /quote=\{/);
  assert.doesNotMatch(gridSource, /onChangeStudies=\{/);
  assert.doesNotMatch(gridSource, /onChangePyrusSignalsSettings=\{/);
  assert.doesNotMatch(gridSource, /flowEventsToChartEvents/);
});

test("Flow chart markers apply shared Flow filters for chart display", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");
  const tradeSpotSource = readLocalSource("../trade/TradeEquityPanel.jsx");
  const tradeScreenSource = readLocalSource("../../screens/TradeScreen.jsx");
  const contractDetailSource = readLocalSource("../flow/ContractDetailInline.jsx");
  const contractFlowSource = readLocalSource(
    "../charting/useContractFlowChartEvents.js",
  );

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
    /filterFlowEventsForChartLookbackWindow\(\s*chartDisplayFlowEvents \|\| \[\],\s*tf,\s*\)/,
  );
  assert.match(tradeSpotSource, /useFlowChartEventConversion\(\s*chartWindowFlowEvents,\s*ticker,\s*\)/);
  assert.match(tradeScreenSource, /useFlowTapeFilterState\(\)/);
  assert.match(tradeScreenSource, /useContractFlowChartEvents/);
  assert.match(tradeScreenSource, /const activeTickerChartFlowEvents = useMemo/);
  assert.match(tradeScreenSource, /mergeFlowEventFeeds\(\s*activeTickerTradeFlowSnapshot\.events \|\| \[\],\s*activeTickerBroadFlowEvents,\s*\)/);
  assert.match(tradeScreenSource, /flowEvents=\{activeTickerChartFlowEvents\}/);
  assert.match(tradeScreenSource, /const parentFlowEventsProvided = flowEvents !== undefined/);
  assert.match(
    contractFlowSource,
    /filterFlowEventsForChartDisplay\(\s*mergedEvents,\s*flowTapeFilters,\s*\)/,
  );
  assert.match(
    contractFlowSource,
    /filterFlowEventsForOptionContract\(\s*displayEvents,\s*contract,\s*\)/,
  );
  assert.match(
    contractFlowSource,
    /filterFlowEventsForChartLookbackWindow\(\s*eventsWithPinnedSelection,\s*timeframe,\s*\)/,
  );
  assert.match(contractFlowSource, /useFlowChartEventConversion\(/);
  assert.match(
    tradeScreenSource,
    /const contractChartFlow = useContractFlowChartEvents/,
  );
  assert.match(
    contractDetailSource,
    /useContractFlowChartEvents\(/,
  );
  assert.match(contractDetailSource, /chartEvents=\{optionChartEvents\}/);
  assert.match(
    contractDetailSource,
    /chartFlowDiagnostics=\{optionChartEventConversion\}/,
  );
  assert.match(contractDetailSource, /placement="workspace"/);
  assert.doesNotMatch(contractDetailSource, /placement="inspection"/);
  assert.doesNotMatch(tradeScreenSource, /retainedFlowState/);
});

test("Trade option chart exposes the same workspace chart controls as spot", () => {
  const tradeScreenSource = readLocalSource("../../screens/TradeScreen.jsx");

  assert.match(tradeScreenSource, /dataTestId="trade-contract-option-chart"/);
  assert.match(tradeScreenSource, /placement="workspace"/);
  assert.match(tradeScreenSource, /surfaceLeftOverlay=\{\(controls\) => \(/);
  assert.match(tradeScreenSource, /surfaceBottomOverlay=\{\(controls\) => \(/);
  assert.match(tradeScreenSource, /onUndo=\{undo\}/);
  assert.match(tradeScreenSource, /onRedo=\{redo\}/);
  assert.match(tradeScreenSource, /canUndo=\{canUndo\}/);
  assert.match(tradeScreenSource, /canRedo=\{canRedo\}/);
  assert.match(tradeScreenSource, /showUndoRedo/);
  assert.doesNotMatch(tradeScreenSource, /showSnapshotButton=\{false\}/);
});

test("Market chart frames leave viewport ownership inside the Trade spot chart", () => {
  const gridSource = readLocalSource("./MultiChartGrid.jsx");
  const cellSource = readLocalSource("./MarketChartCell.jsx");

  assert.match(gridSource, /chartViewportResetRevision/);
  assert.match(gridSource, /chartViewportLayoutRevision/);
  assert.match(gridSource, /buildMarketChartViewportLayoutKey/);
  assert.match(cellSource, /chartViewportLayoutKey/);
  assert.match(cellSource, /viewportLayoutKey=\{chartViewportLayoutKey\}/);
  assert.match(gridSource, /clearStoredChartViewportSnapshot/);
  assert.match(gridSource, /from "\.\.\/charting\/chartViewportStorage"/);
  assert.doesNotMatch(gridSource, /from "\.\.\/charting\/ResearchChartSurface"/);
  assert.match(gridSource, /from "\.\.\/platform\/tickerSearch\/model"/);
  assert.doesNotMatch(gridSource, /from "\.\.\/platform\/tickerSearch\/TickerSearch\.jsx"/);
  assert.match(gridSource, /buildChartBarScopeKey\("trade-equity-chart",\s*"primary"/);
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

test("Market chart no longer owns a provider-contract chart data path", () => {
  const source = readLocalSource("./MarketChartCell.jsx");

  assert.match(source, /TradeEquityPanel/);
  assert.doesNotMatch(source, /resolveMarketGridChartProviderContractId/);
  assert.doesNotMatch(source, /chartProviderContractId/);
  assert.doesNotMatch(
    source,
    /slot\?\.providerContractId/,
    "MarketChartCell should not pass raw provider contracts into chart requests",
  );
});
