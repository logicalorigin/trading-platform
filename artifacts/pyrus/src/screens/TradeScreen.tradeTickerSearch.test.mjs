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
