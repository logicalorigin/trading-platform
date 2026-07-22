import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const tradeScreenSource = readLocalSource("./TradeScreen.jsx");
const tradeEquityPanelSource = readLocalSource(
  "../features/trade/TradeEquityPanel.jsx",
);
const platformScreenRouterSource = readLocalSource(
  "../features/platform/PlatformScreenRouter.jsx",
);

test("trade equity ticker search content is memoized by open state", () => {
  assert.match(
    tradeScreenSource,
    /const equityTickerSearchOpen =\s*tradeTickerSearchAnchor === "equity";/,
  );
  assert.match(
    tradeScreenSource,
    /const equityTickerSearchContent = useMemo\(\s*\(\) =>\s*renderTradeTickerSearch\(equityTickerSearchOpen\),/s,
  );
  assert.match(tradeScreenSource, /searchOpen=\{equityTickerSearchOpen\}/);
  assert.match(
    tradeScreenSource,
    /searchContent=\{equityTickerSearchContent\}/,
  );
});

test("trade ticker search module is not preloaded with the screen", () => {
  const preloadScreenModulesBlock =
    /export const preloadScreenModules = \(\) =>[\s\S]*?\]\)\.then\(\(\) => undefined\);/.exec(
      tradeScreenSource,
    )?.[0] ?? "";

  assert.match(
    tradeScreenSource,
    /from "\.\.\/features\/platform\/tickerSearch\/chartTickerSearchLoader\.js";/,
  );
  assert.match(
    tradeScreenSource,
    /scheduleChartTickerSearchPreload\(preloadMiniChartTickerSearch\)/,
  );
  assert.match(tradeScreenSource, /<LazyMiniChartTickerSearch/);
  assert.match(
    tradeScreenSource,
    /onSearchIntent=\{preloadMiniChartTickerSearch\}/,
  );
  assert.doesNotMatch(
    preloadScreenModulesBlock,
    /preloadMiniChartTickerSearch/,
  );
  assert.doesNotMatch(
    tradeScreenSource,
    /import\("\.\.\/features\/platform\/tickerSearch\/ChartTickerSearch\.jsx"\)/,
  );
  assert.doesNotMatch(
    tradeScreenSource,
    /import\("\.\.\/features\/platform\/tickerSearch\/TickerSearch\.jsx"\)/,
  );
});

test("trade quote runtime disables snapshot quote fallback when Massive realtime is configured", () => {
  assert.match(tradeScreenSource, /massiveStockRealtimeConfigured = false/);
  assert.match(
    tradeScreenSource,
    /const quoteSnapshotFallbackEnabled = Boolean\([\s\S]*marketDataProviderConfigurationReady && !massiveStockRealtimeConfigured,[\s\S]*\);/,
  );
  assert.match(
    tradeScreenSource,
    /if \(!enabled \|\| !quoteSnapshotFallbackEnabled\) \{/,
  );
  assert.match(
    tradeScreenSource,
    /massiveStockRealtimeConfigured=\{massiveStockRealtimeConfigured\}/,
  );
});

test("trade quote runtime preserves the canonical two-sided quote envelope", () => {
  const runtimeStart = tradeScreenSource.indexOf("const TradeQuoteRuntime");
  const runtimeEnd = tradeScreenSource.indexOf(
    "const TRADE_FLOW_AGGREGATE_LIMIT",
    runtimeStart,
  );
  assert.notEqual(runtimeStart, -1);
  assert.notEqual(runtimeEnd, -1);

  const runtimeSource = tradeScreenSource.slice(runtimeStart, runtimeEnd);
  assert.match(runtimeSource, /applyRuntimeQuoteSnapshots\(quotes\)/);
  assert.doesNotMatch(runtimeSource, /publishRuntimeTickerSnapshot/);
});

test("trade secondary runtimes wait for primary equity chart hydration", () => {
  assert.match(
    tradeEquityPanelSource,
    /barsQuery\.fetchStatus === "fetching"[\s\S]*progressiveBars\.requestedLimit < progressiveBars\.targetLimit/s,
  );
  assert.match(
    tradeEquityPanelSource,
    /const primaryChartFullWindowReady = Boolean\([\s\S]*baseBarsReady[\s\S]*bars\.length[\s\S]*progressiveBars\.requestedLimit >= progressiveBars\.targetLimit/s,
  );
  assert.match(
    tradeEquityPanelSource,
    /ready: primaryChartFullWindowReady,[\s\S]*targetLimit: progressiveBars\.targetLimit,/,
  );
  assert.match(
    platformScreenRouterSource,
    /<MemoTradeScreen[\s\S]*signalMonitorProfile=\{signalMonitorProfile\}/,
  );
  assert.match(
    tradeScreenSource,
    /signalMonitorProfile: platformSignalMonitorProfile = undefined/,
  );
  assert.match(
    tradeScreenSource,
    /enabled: Boolean\([\s\S]*platformSignalMonitorProfile === undefined,[\s\S]*\)/,
  );
  assert.match(
    tradeScreenSource,
    /const signalMonitorProfile =\s*platformSignalMonitorProfile === undefined[\s\S]*\? signalMonitorProfileQuery\.data \|\| null[\s\S]*: platformSignalMonitorProfile;/,
  );
  assert.match(
    tradeScreenSource,
    /const \[tradePrimaryChartHydrationState,\s*setTradePrimaryChartHydrationState\] =\s*useState\(\{[\s\S]*ready: false,[\s\S]*renderedBarCount: 0,[\s\S]*\}\);/,
  );
  assert.match(
    tradeScreenSource,
    /const handleTradePrimaryChartHydrationStateChange = useCallback\(\s*\(nextState\) => \{[\s\S]*setTradePrimaryChartHydrationState/s,
  );
  assert.match(
    tradeScreenSource,
    /const tradePrimaryChartHydrated = Boolean\([\s\S]*tradePrimaryChartHydrationState\.ready[\s\S]*tradePrimaryChartHydrationState\.ticker === activeTicker[\s\S]*tradePrimaryChartHydrationState\.timeframe === activeEquityTimeframe/s,
  );
  assert.match(
    tradeScreenSource,
    /const tradeSecondaryWorkEnabled = Boolean\(\s*tradeAnalysisWorkEnabled && tradePrimaryChartHydrated,\s*\);/,
  );
  assert.match(
    tradeScreenSource,
    /const tradeOptionChainWorkEnabled = Boolean\(tradeExecutionWorkEnabled\);/,
  );
  assert.match(
    tradeScreenSource,
    /onReadinessChange\?\.\(\{[\s\S]*primaryReady,[\s\S]*derivedReady: primaryReady,[\s\S]*backgroundAllowed: Boolean\([\s\S]*tradePrimaryChartHydrated/s,
  );
  assert.match(
    tradeScreenSource,
    /historicalDataEnabled=\{tradePrimaryChartDataEnabled\}[\s\S]*onHydrationStateChange=\{handleTradePrimaryChartHydrationStateChange\}/,
  );
  assert.match(
    tradeScreenSource,
    /<TradeOptionChainRuntime[\s\S]*enabled=\{tradeOptionChainWorkEnabled\}[\s\S]*analysisEnabled=\{tradeSecondaryWorkEnabled\}/,
  );
  assert.match(
    tradeScreenSource,
    /<TradeFlowRuntime[\s\S]*enabled=\{tradeSecondaryWorkEnabled\}[\s\S]*timeframe=\{activeEquityTimeframe\}/,
  );
  assert.match(
    tradeScreenSource,
    /historicalDataEnabled=\{tradeSecondaryWorkEnabled\}[\s\S]*liveDataEnabled=\{tradeSecondaryWorkEnabled\}/,
  );
});

test("trade flow requests forward React Query cancellation", () => {
  const runtimeStart = tradeScreenSource.indexOf("const TradeFlowRuntime");
  const runtimeEnd = tradeScreenSource.indexOf(
    "const TradeOptionChainRuntime",
    runtimeStart,
  );
  assert.notEqual(runtimeStart, -1);
  assert.notEqual(runtimeEnd, -1);

  const runtimeSource = tradeScreenSource.slice(runtimeStart, runtimeEnd);
  assert.equal(
    runtimeSource.match(/queryFn: \(\{ signal \}\) =>/g)?.length,
    2,
  );
  assert.match(
    runtimeSource,
    /listAggregateFlowEventsRequest\([\s\S]*?withTradeAbortSignal\(\s*buildBarsRequestOptions\(BARS_REQUEST_PRIORITY\.active, "chart-flow"\),\s*signal,\s*\)/,
  );
  assert.match(
    runtimeSource,
    /listFlowEventsRequest\([\s\S]*?withTradeAbortSignal\(\s*buildBarsRequestOptions\(BARS_REQUEST_PRIORITY\.active, "chart-flow"\),\s*signal,\s*\)/,
  );
});

test("trade flow snapshots only label events live when a current source supplied them", () => {
  const runtimeStart = tradeScreenSource.indexOf("const TradeFlowRuntime");
  const runtimeEnd = tradeScreenSource.indexOf(
    "const TradeOptionChainRuntime",
    runtimeStart,
  );
  const runtimeSource = tradeScreenSource.slice(runtimeStart, runtimeEnd);

  assert.match(
    runtimeSource,
    /const hasFreshEvents =\s*\(liveEvents\.length > 0 && !tickerFlowQuery\.isError\) \|\|\s*\(incomingHistoricalEvents\.length > 0 && !historicalRefreshTransient\);/,
  );
  assert.match(
    runtimeSource,
    /const status = events\.length\s*\? hasFreshEvents\s*\? "live"\s*: "stale"/,
  );
});

test("trade flow refreshes use a rolling historical window", () => {
  const runtimeStart = tradeScreenSource.indexOf("const TradeFlowRuntime");
  const runtimeEnd = tradeScreenSource.indexOf(
    "const TradeOptionChainRuntime",
    runtimeStart,
  );
  const runtimeSource = tradeScreenSource.slice(runtimeStart, runtimeEnd);

  assert.doesNotMatch(runtimeSource, /const historicalFlowWindow = useMemo/);
  assert.match(
    runtimeSource,
    /queryKey: \[\s*"trade-flow-history",\s*ticker,\s*timeframe,\s*historicalBucketSeconds,\s*\]/,
  );
  assert.match(
    runtimeSource,
    /queryFn: \(\{ signal \}\) => \{\s*const historicalFlowWindow = getChartEventLookbackWindow\(timeframe\);/,
  );
  assert.match(
    runtimeSource,
    /from: historicalFlowWindow\.from\.toISOString\(\),[\s\S]*to: historicalFlowWindow\.to\.toISOString\(\),/,
  );
  assert.match(
    runtimeSource,
    /const historicalKey = `\$\{ticker\}:\$\{timeframe\}:\$\{historicalBucketSeconds\}`;/,
  );
});
