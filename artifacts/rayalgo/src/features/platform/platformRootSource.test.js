import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../../../..", import.meta.url);
const rayalgoSrcRoot = new URL("../../", import.meta.url);

const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

const collectSourceFiles = (directoryUrl) => {
  const directoryPath = directoryUrl instanceof URL ? directoryUrl.pathname : directoryUrl;
  const entries = readdirSync(directoryPath);
  const files = [];

  for (const entry of entries) {
    const path = join(directoryPath, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }
    if (sourceExtensions.has(extname(path))) {
      files.push(path);
    }
  }

  return files;
};

test("platform root no longer depends on the retired RayAlgoPlatform module", () => {
  const retiredRootPath = new URL("../../RayAlgoPlatform.jsx", import.meta.url);
  assert.equal(existsSync(retiredRootPath), false);

  const appSource = readFileSync(new URL("../../app/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /features\/platform\/PlatformApp\.jsx/);
  assert.doesNotMatch(appSource, /RayAlgoPlatform/);

  const sourceHits = collectSourceFiles(rayalgoSrcRoot)
    .filter((filePath) => !filePath.endsWith("platformRootSource.test.js"))
    .map((filePath) => ({
      filePath,
      source: readFileSync(filePath, "utf8"),
    }))
    .filter(({ source }) => /RayAlgoPlatform/.test(source))
    .map(({ filePath }) => relative(repoRoot.pathname, filePath));

  assert.deepEqual(sourceHits, []);
});

test("flow scanner threshold changes are part of the live scanner effect contract", () => {
  const source = readFileSync(
    new URL("./useLiveMarketFlow.js", import.meta.url),
    "utf8",
  );
  const effectDependencyLists = [...source.matchAll(/useEffect\([\s\S]*?\n  \]\);/g)].map(
    (match) => match[0],
  );

  assert.ok(
    effectDependencyLists.some(
      (effectSource) =>
        effectSource.includes("listFlowEventsRequest") &&
        effectSource.includes("normalizedThreshold"),
    ),
    "scanner effect must rerun when unusualThreshold changes",
  );
});

test("live flow scanner waits for on-demand IBKR hydration", () => {
  const source = readFileSync(
    new URL("./useLiveMarketFlow.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /blocking\s*=\s*true/);
  assert.match(source, /queueRefresh:\s*blocking/);
});

test("flow scanner uses backend aggregate flow for broad scans", () => {
  const source = readFileSync(
    new URL("./useLiveMarketFlow.js", import.meta.url),
    "utf8",
  );
  const requestBlock = source.match(
    /listFlowEventsRequest\(\{[\s\S]*?\n\s*\}\);/,
  )?.[0];

  assert.ok(requestBlock, "flow scanner request block must be present");
  assert.match(source, /listAggregateFlowEventsRequest/);
  assert.match(source, /const usesBackendBroadScanner = flowScannerModeUsesMarketUniverse/);
  assert.match(source, /const shouldUseClientSymbolScanner = !usesBackendBroadScanner/);
  assert.match(source, /!shouldUseClientSymbolScanner/);
  assert.match(requestBlock, /scope:\s*FLOW_SCANNER_SCOPE\.all/);
  assert.doesNotMatch(requestBlock, /scope:\s*effectiveScannerConfig\.scope/);
  assert.doesNotMatch(requestBlock, /unusualThreshold/);
  assert.match(source, /filterFlowScannerEvents\([\s\S]*effectiveScannerConfig/);
  assert.match(source, /backendCurrentBatchSymbols/);
  assert.match(source, /FLOW_SCANNER_MARKET_UNIVERSE_SYMBOLS/);
  assert.match(source, /blocking\s*===\s*false[\s\S]*usesBackendBroadScanner/);
  assert.match(source, /marketSymbols:\s*marketSymbolsForScanner/);
});

test("header flow scanner lane applies the shared Flow tape filters", () => {
  const source = readFileSync(
    new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /mergeFlowEventFeeds/);
  assert.doesNotMatch(source, /useMarketFlowSnapshot\(symbols/);
  assert.doesNotMatch(source, /header-flow-scan-mode/);
  assert.match(source, /useMarketFlowSnapshotForStoreKey\(\s*BROAD_MARKET_FLOW_STORE_KEY/);
  assert.match(source, /useFlowTapeFilterState\(\{[\s\S]*subscribe:\s*enabled/);
  assert.match(source, /const buildHeaderFlowTapeFilters = \(filters\) => \(\{/);
  assert.match(source, /symbol:\s*null/);
  assert.match(source, /rawUnusualEvents/);
  assert.match(source, /filterFlowTapeEvents\(rawUnusualEvents,\s*headerFlowTapeFilters\)/);
  assert.match(source, /flowTapeFiltersAreActive\(headerFlowTapeFilters\)/);
  assert.match(source, /FLOW FILTERED/);
  assert.match(source, /mode:\s*FLOW_SCANNER_MODE\.allWatchlistsPlusUniverse/);
  assert.match(source, /buildHeaderUnusualTapeItems\(unusualEvents\)/);
});

test("mobile shell uses bottom navigation and separates watchlist activity surfaces", () => {
  const retiredMobileNavDrawerPath = new URL("./MobileNavDrawer.jsx", import.meta.url);
  const shellSource = readFileSync(
    new URL("./PlatformShell.jsx", import.meta.url),
    "utf8",
  );
  const moreSheetSource = readFileSync(
    new URL("./MobileMoreSheet.jsx", import.meta.url),
    "utf8",
  );
  const activitySheetSource = readFileSync(
    new URL("./MobileActivitySheet.jsx", import.meta.url),
    "utf8",
  );
  const watchlistDrawerSource = readFileSync(
    new URL("./MobileWatchlistDrawer.jsx", import.meta.url),
    "utf8",
  );
  const headerSource = readFileSync(
    new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
    "utf8",
  );

  assert.match(shellSource, /data-testid="mobile-bottom-nav"/);
  assert.match(shellSource, /data-testid="mobile-bottom-nav-more"/);
  assert.match(shellSource, /testId="mobile-activity-trigger"/);
  assert.match(shellSource, /testId="mobile-watchlist-trigger"/);
  assert.match(shellSource, /<MobileMoreSheet/);
  assert.match(shellSource, /<MobileActivitySheet/);
  assert.match(shellSource, /<MobileWatchlistDrawer/);
  assert.doesNotMatch(shellSource, /MobileNavDrawer/);
  assert.equal(existsSync(retiredMobileNavDrawerPath), false);
  assert.match(shellSource, /data-viewport=/);
  assert.match(moreSheetSource, /testId="mobile-more-sheet"/);
  assert.match(moreSheetSource, /mobile-more-screen-/);
  assert.match(activitySheetSource, /testId="mobile-activity-sheet"/);
  assert.match(activitySheetSource, /useMarketAlertsSnapshot/);
  assert.match(watchlistDrawerSource, /testId="mobile-watchlist-drawer"/);
  assert.match(watchlistDrawerSource, /side="right"/);
  assert.match(watchlistDrawerSource, /fullBleed/);
  assert.match(watchlistDrawerSource, /density="mobile-dense"/);
  assert.match(watchlistDrawerSource, /<WatchlistComponent/);
  assert.match(headerSource, /<BottomSheet/);
  assert.match(headerSource, /compactSettings=\{isPhone\}/);
});

test("floating platform controls use pointer outside-click listeners", () => {
  const marketActivitySource = readFileSync(
    new URL("../market/MarketActivityPanel.jsx", import.meta.url),
    "utf8",
  );
  const headerSource = readFileSync(
    new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
    "utf8",
  );
  const tickerSearchSource = readFileSync(
    new URL("./tickerSearch/TickerSearch.jsx", import.meta.url),
    "utf8",
  );

  [marketActivitySource, headerSource, tickerSearchSource].forEach((source) => {
    assert.match(source, /addEventListener\("pointerdown", handlePointerDown\)/);
    assert.match(source, /removeEventListener\("pointerdown", handlePointerDown\)/);
    assert.doesNotMatch(source, /addEventListener\("mousedown", handlePointerDown\)/);
    assert.doesNotMatch(source, /removeEventListener\("mousedown", handlePointerDown\)/);
  });
});

test("Market phone layout uses the app-frame activity sheet instead of the old panel", () => {
  const marketSource = readFileSync(
    new URL("../../screens/MarketScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(marketSource, /responsiveFlags\(marketWorkspaceWidth \|\| viewportSize\.width\)/);
  assert.match(marketSource, /const showMarketActivityPanel = !marketLayoutFlags\.isPhone/);
  assert.match(marketSource, /data-activity-layout=\{marketActivityLayout\}/);
  assert.match(marketSource, /showMarketActivityPanel && !stackActivityPanel \? \(/);
  assert.match(
    marketSource,
    /\{showMarketActivityPanel \? \(\s*<div\s+data-testid="market-activity-panel"/,
  );
});

test("mobile primitives keep pinch zoom and touch fallbacks available", () => {
  const indexHtml = readFileSync(
    new URL("../../../index.html", import.meta.url),
    "utf8",
  );
  const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
  const tooltipSource = readFileSync(
    new URL("../../components/ui/tooltip.tsx", import.meta.url),
    "utf8",
  );

  assert.match(indexHtml, /viewport-fit=cover/);
  assert.doesNotMatch(indexHtml, /maximum-scale/);
  assert.match(cssSource, /font-size:\s*max\(16px,\s*1em\)/);
  assert.match(cssSource, /\.ra-shell\[data-viewport="phone"\] \.ra-touch-target/);
  assert.match(tooltipSource, /event\.pointerType !== "touch"/);
  assert.match(tooltipSource, /setOpen\(true\)/);
});

test("Account phone layout uses card lists for dense trading tables", () => {
  const accountSource = readFileSync(
    new URL("../../screens/AccountScreen.jsx", import.meta.url),
    "utf8",
  );
  const positionsSource = readFileSync(
    new URL("../../screens/account/PositionsPanel.jsx", import.meta.url),
    "utf8",
  );
  const tradesOrdersSource = readFileSync(
    new URL("../../screens/account/TradesOrdersPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(accountSource, /data-layout=\{accountIsPhone \? "phone"/);
  assert.match(accountSource, /<PositionsPanel[\s\S]*isPhone=\{accountIsPhone\}/);
  assert.match(accountSource, /<ClosedTradesPanel[\s\S]*isPhone=\{accountIsPhone\}/);
  assert.match(accountSource, /<OrdersPanel[\s\S]*isPhone=\{accountIsPhone\}/);
  assert.match(positionsSource, /data-testid="account-positions-row-list"/);
  assert.match(tradesOrdersSource, /data-testid="account-orders-row-list"/);
  assert.match(tradesOrdersSource, /data-testid="account-trades-row-list"/);
});

test("Account performance pilot defers below-fold panels and memoizes mobile rows", () => {
  const accountSource = readFileSync(
    new URL("../../screens/AccountScreen.jsx", import.meta.url),
    "utf8",
  );
  const deferredRenderSource = readFileSync(
    new URL("../../components/platform/DeferredRender.jsx", import.meta.url),
    "utf8",
  );
  const positionsSource = readFileSync(
    new URL("../../screens/account/PositionsPanel.jsx", import.meta.url),
    "utf8",
  );
  const tradesOrdersSource = readFileSync(
    new URL("../../screens/account/TradesOrdersPanel.jsx", import.meta.url),
    "utf8",
  );
  const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

  assert.match(deferredRenderSource, /new window\.IntersectionObserver/);
  assert.match(deferredRenderSource, /observer\.disconnect\(\)/);
  assert.match(accountSource, /<DeferredRender[\s\S]*account-deferred-positions/);
  assert.match(accountSource, /<DeferredRender[\s\S]*account-deferred-trades-orders/);
  assert.match(cssSource, /--ra-color-pnl-positive/);
  assert.match(cssSource, /\.ra-deferred-render__placeholder/);
  assert.match(positionsSource, /const MobilePositionRow = memo/);
  assert.match(positionsSource, /data-action="chart"/);
  assert.match(positionsSource, /onRowAction=\{handleMobileRowAction\}/);
  assert.match(tradesOrdersSource, /const MobileOrderRow = memo/);
  assert.match(tradesOrdersSource, /const MobileTradeRow = memo/);
  assert.match(tradesOrdersSource, /data-action="cancel"/);
  assert.match(tradesOrdersSource, /onRowAction=\{handleOrderRowAction\}/);
});

test("Flow page scanner uses one broad scanner panel and no active-symbol merge", () => {
  const source = readFileSync(
    new URL("../../screens/FlowScreen.jsx", import.meta.url),
    "utf8",
  );
  const panelSource = readFileSync(
    new URL(
      "../../features/flow/FlowDistributionScannerPanel.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  const settingsSource = readFileSync(
    new URL("../../screens/SettingsScreen.jsx", import.meta.url),
    "utf8",
  );
  const combinedPanelRenders =
    source.match(/<FlowDistributionScannerPanel\b/g) || [];
  const railScannerRenders =
    panelSource.match(/<FlowScannerStatusPanel\b/g) || [];
  const legacyScannerRenders = source.match(/<UnusualScannerSection\b/g) || [];

  assert.equal(combinedPanelRenders.length, 1);
  assert.equal(railScannerRenders.length, 1);
  assert.equal(legacyScannerRenders.length, 0);
  assert.doesNotMatch(source, /const UnusualScannerSection/);
  assert.doesNotMatch(source, />\s*Flow Scanner\s*</);
  assert.doesNotMatch(source, /flowScannerPanelVisible/);
  assert.doesNotMatch(source, /flowShowUnusualScanner/);
  assert.doesNotMatch(settingsSource, /flowShowUnusualScanner/);
  assert.doesNotMatch(settingsSource, /Show Flow scanner by default/);
  assert.doesNotMatch(source, /mergeFlowEventFeeds/);
  assert.doesNotMatch(source, /useMarketFlowSnapshot\(symbols/);
  assert.match(source, /useMarketFlowSnapshotForStoreKey\(\s*BROAD_MARKET_FLOW_STORE_KEY/);
  assert.match(source, /filterFlowTapeEvents\(flowEvents,\s*flowTapeFilters/);
  assert.match(source, /flowEventsFilteredOut/);
  assert.match(source, /flowTapeFiltersAreActive\(flowTapeFilters\)/);
  assert.match(source, /No prints match Flow filters/);
  assert.match(source, /flowQuality\?\.label === "Degraded"[\s\S]*\? "Degraded"/);
  assert.doesNotMatch(source, /flowStatus === "loading"[\s\S]*: "Degraded";/);
  assert.match(source, /buildFlowTideFromEvents\(filtered\)/);
  assert.match(source, /buildTickerFlowFromEvents\(filtered/);
  assert.match(source, /buildMarketOrderFlowFromEvents\(filtered\)/);
  assert.doesNotMatch(source, /flowUnusualSideFilter/);
  assert.doesNotMatch(source, /unusualSideFilter/);
  assert.doesNotMatch(source, /flow-unusual-scanner-status-panel/);
});

test("Flow page premium distribution widgets use Polygon summary endpoint", () => {
  const source = readFileSync(
    new URL("../../screens/FlowScreen.jsx", import.meta.url),
    "utf8",
  );
  const panelSource = readFileSync(
    new URL(
      "../../features/flow/FlowDistributionScannerPanel.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /useGetFlowPremiumDistribution/);
  assert.match(source, /FLOW_PREMIUM_WIDGET_COUNT\s*=\s*16/);
  assert.match(source, /FLOW_PREMIUM_WIDGET_REFRESH_MS\s*=\s*30_000/);
  assert.match(source, /FLOW_PREMIUM_TIMEFRAME_OPTIONS/);
  assert.match(source, /<FlowDistributionScannerPanel/);
  assert.match(source, /data-testid="flow-premium-distribution-widget"/);
  assert.match(panelSource, /flow-premium-distribution-timeframe/);
  assert.match(source, /PremiumDistributionDonut/);
  assert.match(source, /PremiumDistributionWidget/);
  assert.match(source, /formatPremiumCompactUsd/);
  assert.match(source, /Neutral/);
  assert.match(source, /Inflow/);
  assert.match(source, /Outflow/);
  assert.match(source, /Large/);
  assert.match(source, /Medium/);
  assert.match(source, /Small/);
  assert.doesNotMatch(source, /\["XL", "xl"\]/);
  assert.doesNotMatch(source, /useGetFlowPremiumDistribution[\s\S]*listFlowEventsRequest/);
});

test("client flow scanner keeps rotating after failed symbol batches", () => {
  const source = readFileSync(
    new URL("./useLiveMarketFlow.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /consecutiveErrorBatches/);
  assert.doesNotMatch(source, /2 \*\*/);
  assert.match(source, /schedule\(baseDelay\)/);
});

test("shared flow hydrates visible flow while broad scanner stays broad and nonblocking", () => {
  const source = readFileSync(
    new URL("./MarketFlowRuntimeLayer.jsx", import.meta.url),
    "utf8",
  );
  const runtimeLayerSource = readFileSync(
    new URL("./PlatformRuntimeLayer.jsx", import.meta.url),
    "utf8",
  );
  const platformAppSource = readFileSync(
    new URL("./PlatformApp.jsx", import.meta.url),
    "utf8",
  );
  const sharedRuntime = source.match(
    /export const SharedMarketFlowRuntime[\s\S]*?return null;\n\}\);/,
  )?.[0];
  const broadRuntime = source.match(
    /export const BroadFlowScannerRuntime[\s\S]*?return null;\n\}\);/,
  )?.[0];

  assert.ok(sharedRuntime, "SharedMarketFlowRuntime must stay in the runtime layer");
  assert.ok(broadRuntime, "BroadFlowScannerRuntime must stay in the runtime layer");
  assert.match(source, /const BROAD_FLOW_STARTUP_DELAY_MS = 2_500;/);
  assert.doesNotMatch(source, /const BROAD_FLOW_STARTUP_DELAY_MS = 45_000;/);
  assert.doesNotMatch(broadRuntime, /activeSymbols/);
  assert.match(broadRuntime, /FLOW_SCANNER_MODE\.allWatchlistsPlusUniverse/);
  assert.doesNotMatch(broadRuntime, /setFlowScannerControlState/);
  assert.match(broadRuntime, /if \(!runtimeActive\)[\s\S]*clearMarketFlowSnapshot\(BROAD_MARKET_FLOW_STORE_KEY\)/);
  assert.match(sharedRuntime, /useLiveMarketFlow\(symbols,\s*\{[\s\S]*blocking:\s*true/);
  assert.match(broadRuntime, /useLiveMarketFlow\(symbols,\s*\{[\s\S]*blocking:\s*false/);
  assert.doesNotMatch(runtimeLayerSource, /activeSymbols=\{/);
  assert.doesNotMatch(platformAppSource, /broadFlowActiveSymbols/);
});

test("Broad scanner owns Flow and Market flow without the shared all-flow runtime", () => {
  const source = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const schedulerSource = readFileSync(
    new URL("./appWorkScheduler.js", import.meta.url),
    "utf8",
  );
  const shellSource = readFileSync(
    new URL("./PlatformShell.jsx", import.meta.url),
    "utf8",
  );
  const headerSource = readFileSync(
    new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
    "utf8",
  );
  const apiIndexSource = readFileSync(
    new URL("../../../../api-server/src/index.ts", import.meta.url),
    "utf8",
  );
  const apiPlatformSource = readFileSync(
    new URL("../../../../api-server/src/services/platform.ts", import.meta.url),
    "utf8",
  );
  const flowRuntimeProp = source.match(
    /flowRuntimeEnabled=\{[\s\S]*?\}\s*flowRuntimeIntervalMs=/,
  )?.[0];

  assert.ok(flowRuntimeProp, "PlatformApp must pass flowRuntimeEnabled");
  assert.match(flowRuntimeProp, /workSchedule\.streams\.sharedFlowRuntime/);
  assert.match(schedulerSource, /const firstScreenReady = screenWarmupPhase !== "initial"/);
  assert.match(
    schedulerSource,
    /const broadFlowAllowed = Boolean\(sessionReady\)/,
  );
  assert.match(schedulerSource, /sharedFlowRuntime:\s*false/);
  assert.match(schedulerSource, /broadFlowRuntime:\s*broadFlowAllowed/);
  assert.match(apiIndexSource, /startOptionsFlowScanner\(\)/);
  assert.match(apiPlatformSource, /const OPTIONS_FLOW_SCANNER_ALWAYS_ON = readBooleanEnv\([\s\S]*"OPTIONS_FLOW_SCANNER_ALWAYS_ON"[\s\S]*true/);
  assert.doesNotMatch(source, /flowScanRuntimeEnabled/);
  assert.doesNotMatch(shellSource, /flowScanRuntimeEnabled/);
  assert.doesNotMatch(headerSource, /flowScanRuntimeEnabled/);
  assert.doesNotMatch(headerSource, /broadScanRuntimeActive/);
  assert.match(headerSource, /const broadScanSnapshotActive = broadScanEnabled && broadScanOwnerActive/);
  assert.match(
    headerSource,
    /const flowScanTone = flowScanHasError[\s\S]*flowScanDegraded[\s\S]*\? T\.amber[\s\S]*flowScanBusy[\s\S]*\? T\.accent/,
  );
  assert.match(
    headerSource,
    /const signalScanTone = signalHasError[\s\S]*signalBusy[\s\S]*\? T\.accent/,
  );
  assert.match(
    headerSource,
    /label="Flow"[\s\S]*tone=\{flowHasError \? T\.red : flowStatus === "loading" \? T\.accent : T\.textSec\}/,
  );
  assert.doesNotMatch(headerSource, /flowScanBusy\s*\n\s*\? T\.amber/);
  assert.doesNotMatch(headerSource, /waiting for app runtime/);
  assert.doesNotMatch(headerSource, /waiting for app visibility/);
  assert.doesNotMatch(
    schedulerSource,
    /marketScreenActive/,
    "Chart and broad scanner runtimes should own flow to avoid a second all-flow path",
  );
  assert.doesNotMatch(schedulerSource, /flowScreenActive/);
});

test("signal monitor display refreshes separately from evaluator cadence", () => {
  const source = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const stateQuery = source.match(
    /const signalMonitorStateQuery = useGetSignalMonitorState\([\s\S]*?\n  \);/,
  )?.[0];
  const eventsQuery = source.match(
    /const signalMonitorEventsQuery = useListSignalMonitorEvents\([\s\S]*?\n  \);/,
  )?.[0];

  assert.match(source, /SIGNAL_MONITOR_DISPLAY_POLL_MS\s*=\s*15_000/);
  assert.match(source, /const signalMonitorDisplayPollMs = Math\.min\(/);
  assert.match(
    stateQuery ?? "",
    /refetchInterval:\s*pageVisible\s*\?\s*signalMonitorDisplayPollMs\s*:\s*false/,
  );
  assert.match(
    eventsQuery ?? "",
    /refetchInterval:\s*pageVisible\s*\?\s*signalMonitorDisplayPollMs\s*:\s*false/,
  );
  assert.match(
    source,
    /detail:\s*`\$\{Math\.round\(signalMonitorDisplayPollMs \/ 1000\)\}s`/,
  );
});

test("settings signal monitor uses generated API ownership path", () => {
  const source = readFileSync(
    new URL("../../screens/SettingsScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /useGetSignalMonitorProfile/);
  assert.match(source, /useGetSignalMonitorState/);
  assert.match(source, /useListSignalMonitorEvents/);
  assert.match(source, /useUpdateSignalMonitorProfile/);
  assert.match(source, /useEvaluateSignalMonitor/);
  assert.match(source, /maxSymbols:\s*\{\s*min:\s*1,\s*max:\s*250\s*\}/);
  assert.match(source, /freshWindowBars:\s*\{\s*min:\s*1,\s*max:\s*20\s*\}/);
  assert.match(source, /evaluationConcurrency:\s*\{\s*min:\s*1,\s*max:\s*10\s*\}/);
  assert.doesNotMatch(source, /fetch\("\/api\/signal-monitor/);
});

test("algo signal-options automation uses generated API ownership path", () => {
  const source = readFileSync(
    new URL("../../screens/AlgoScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /useGetSignalOptionsAutomationState/);
  assert.match(source, /useGetSignalOptionsPerformance/);
  assert.match(source, /useRunSignalOptionsShadowScan/);
  assert.match(source, /useUpdateSignalOptionsExecutionProfile/);
  assert.match(source, /getGetSignalOptionsAutomationStateQueryKey/);
  assert.match(source, /getGetSignalOptionsPerformanceQueryKey/);
  assert.match(source, /Signal -&gt; Action/);
  assert.match(source, /signal-options-expanded-capacity/);
  assert.match(source, /SHADOW ONLY/);
  assert.match(source, /CREATE SHADOW DEPLOYMENT/);
  assert.doesNotMatch(source, /live_submitted/);
  assert.doesNotMatch(source, /live_previewed/);
  assert.doesNotMatch(source, /queryKey:\s*\[\s*"signal-options-state"/);
  assert.doesNotMatch(source, /\/api\/algo\/deployments\/.*signal-options/);
});

test("platform root polling stops while the page is hidden", () => {
  const source = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const sessionQuery = source.match(
    /const sessionQuery = useGetSession\(\{[\s\S]*?\n  \}\);/,
  )?.[0];
  const watchlistsQuery = source.match(
    /const watchlistsQuery = useListWatchlists\(\{[\s\S]*?\n  \}\);/,
  )?.[0];
  const signalMonitorProfileQuery = source.match(
    /const signalMonitorProfileQuery = useGetSignalMonitorProfile\([\s\S]*?\n  \);/,
  )?.[0];

  assert.match(sessionQuery ?? "", /refetchInterval:\s*pageVisible\s*\?\s*5_000\s*:\s*false/);
  assert.match(watchlistsQuery ?? "", /refetchInterval:\s*pageVisible\s*\?\s*60_000\s*:\s*false/);
  assert.match(
    signalMonitorProfileQuery ?? "",
    /refetchInterval:\s*pageVisible\s*\?\s*60_000\s*:\s*false/,
  );
});

test("market data subscription provider does not fetch quote snapshots while hidden", () => {
  const source = readFileSync(
    new URL("./MarketDataSubscriptionProvider.jsx", import.meta.url),
    "utf8",
  );
  const quotesQuery = source.match(
    /const quotesQuery = useGetQuoteSnapshots\([\s\S]*?\n  \);/,
  )?.[0];

  assert.match(quotesQuery ?? "", /enabled:\s*Boolean\(pageVisible && quoteSymbols\.length > 0\)/);
});

test("hidden-mounted Trade keeps execution warm and gates analysis by visibility", () => {
  const tradeScreenSource = readFileSync(
    new URL("../../screens/TradeScreen.jsx", import.meta.url),
    "utf8",
  );
  const platformRouterSource = readFileSync(
    new URL("./PlatformScreenRouter.jsx", import.meta.url),
    "utf8",
  );
  const positionsSource = readFileSync(
    new URL("../trade/TradePositionsPanel.jsx", import.meta.url),
    "utf8",
  );
  const l2Source = readFileSync(
    new URL("../trade/TradeL2Panel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(platformRouterSource, /isRetained=\{screen !== "trade"\}/);
  assert.match(tradeScreenSource, /const buildTradeRuntimeActivity =/);
  assert.match(tradeScreenSource, /executionWarm:\s*screenWarm/);
  assert.match(tradeScreenSource, /primaryVisible:\s*Boolean\(isVisible\)/);
  assert.match(tradeScreenSource, /analysisVisible:\s*Boolean\(visibleInteractive && secondaryReady\)/);
  assert.match(tradeScreenSource, /const tradeExecutionWorkEnabled = tradeRuntimeActivity\.executionWarm/);
  assert.match(tradeScreenSource, /const tradeAnalysisWorkEnabled = tradeRuntimeActivity\.analysisVisible/);
  assert.match(tradeScreenSource, /enabled=\{tradeExecutionWorkEnabled\}/);
  assert.match(tradeScreenSource, /analysisEnabled=\{tradeAnalysisWorkEnabled\}/);
  assert.match(tradeScreenSource, /executionEnabled=\{tradeExecutionBrokerStreamingEnabled\}/);
  assert.match(tradeScreenSource, /visibleEnabled=\{tradeAnalysisBrokerStreamingEnabled\}/);
  assert.match(tradeScreenSource, /renderTradePanels \?/);
  assert.match(tradeScreenSource, /<MemoTradeL2Panel[\s\S]*isVisible=\{isVisible\}/);
  assert.match(tradeScreenSource, /<MemoTradePositionsPanel[\s\S]*isVisible=\{isVisible\}/);
  assert.match(positionsSource, /isVisible = false/);
  assert.match(
    positionsSource,
    /const brokerPanelEnabled = Boolean\(isVisible && brokerAuthenticated && accountId\)/,
  );
  assert.equal((positionsSource.match(/enabled:\s*brokerPanelEnabled/g) || []).length, 3);
  assert.match(positionsSource, /!isVisible[\s\S]*streamingPaused/);
  assert.match(l2Source, /isVisible = false/);
  assert.match(l2Source, /const brokerRuntimeEnabled = Boolean\([\s\S]*isVisible/);
  assert.equal((l2Source.match(/enabled:\s*brokerRuntimeEnabled/g) || []).length, 2);
  assert.match(l2Source, /!brokerRuntimeEnabled[\s\S]*!pageVisible/);
});

test("hidden-mounted Algo and Backtest queries require visible screen ownership", () => {
  const algoSource = readFileSync(
    new URL("../../screens/AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const backtestSource = readFileSync(
    new URL("../backtesting/BacktestingPanels.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    algoSource,
    /const draftsQuery = useListBacktestDraftStrategies\(\{[\s\S]*enabled:\s*Boolean\(isVisible\)/,
  );
  assert.match(
    algoSource,
    /const deploymentsQuery = useListAlgoDeployments\([\s\S]*enabled:\s*Boolean\(isVisible\)/,
  );
  assert.match(
    algoSource,
    /const eventsQuery = useListExecutionEvents\([\s\S]*enabled:\s*Boolean\(isVisible\)/,
  );
  assert.equal(
    (backtestSource.match(/useListBacktestDraftStrategies\(\{[\s\S]*?enabled:\s*Boolean\(isVisible\)/g) || []).length,
    2,
  );
  assert.match(backtestSource, /useListBacktestStrategies\(\{[\s\S]*enabled:\s*Boolean\(isVisible\)/);
  assert.match(backtestSource, /useListBacktestStudies\(\{[\s\S]*enabled:\s*Boolean\(isVisible\)/);
  assert.match(backtestSource, /useListBacktestJobs\(\{[\s\S]*enabled:\s*Boolean\(isVisible\)/);
  assert.match(backtestSource, /useListBacktestRuns\([\s\S]*enabled:\s*Boolean\(isVisible && selectedStudyId\)/);
  assert.match(backtestSource, /useGetBacktestRun\([\s\S]*enabled:\s*Boolean\(isVisible && selectedRunId\)/);
  assert.match(backtestSource, /useGetBacktestRunChart\([\s\S]*enabled:\s*Boolean\(isVisible && selectedRunId\)/);
  assert.match(backtestSource, /useGetBacktestStudyPreviewChart\([\s\S]*enabled:\s*Boolean\(isVisible && selectedStudyId\)/);
});

test("Research live refresh waits for screen visibility", () => {
  const source = readFileSync(
    new URL("../research/PhotonicsObservatory.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /if \(isVisible && apiKey && researchDataReady\)/);
  assert.match(source, /\[apiKey, isVisible, refreshData, researchDataReady\]/);
});

test("color semantics route status surfaces through purpose tokens", () => {
  const indexCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
  const footerSource = readFileSync(
    new URL("./FooterMemoryPressureIndicator.jsx", import.meta.url),
    "utf8",
  );
  const diagnosticsSource = readFileSync(
    new URL("../../screens/DiagnosticsScreen.jsx", import.meta.url),
    "utf8",
  );
  const accountUtilsSource = readFileSync(
    new URL("../../screens/account/accountUtils.jsx", import.meta.url),
    "utf8",
  );
  const ibkrSource = readFileSync(
    new URL("./IbkrConnectionStatus.jsx", import.meta.url),
    "utf8",
  );

  for (const token of [
    "--ra-pnl-positive",
    "--ra-side-buy",
    "--ra-stream-healthy",
    "--ra-pressure-high",
    "--ra-toast-info",
    "--ra-category-automation",
    "--ra-gex-zero-gamma",
  ]) {
    assert.match(indexCss, new RegExp(token));
  }

  assert.doesNotMatch(footerSource, /#fb923c/i);
  assert.match(footerSource, /--ra-pressure-high/);
  assert.match(diagnosticsSource, /--ra-toast-info/);
  assert.match(diagnosticsSource, /--ra-toast-success/);
  assert.match(accountUtilsSource, /pnl-positive/);
  assert.match(accountUtilsSource, /side-buy/);
  assert.match(accountUtilsSource, /category-automation/);
  assert.match(ibkrSource, /canonicalizeStreamState/);
  assert.match(ibkrSource, /streamStateTokenVar/);
});
