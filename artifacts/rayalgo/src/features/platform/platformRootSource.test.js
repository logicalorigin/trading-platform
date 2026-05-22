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

test("api boot does not start the retired shadow equity forward worker", () => {
  const apiIndexSource = readFileSync(
    join(repoRoot.pathname, "artifacts/api-server/src/index.ts"),
    "utf8",
  );

  assert.doesNotMatch(apiIndexSource, /shadow-equity-forward-worker/);
  assert.doesNotMatch(apiIndexSource, /startShadowEquityForwardWorker/);
});

test("vite keeps React and Query provider dependencies single-instanced", () => {
  const source = readFileSync(
    new URL("../../../vite.config.ts", import.meta.url),
    "utf8",
  );

  [
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-dom/client",
    "@tanstack/react-query",
    "@tanstack/query-core",
  ].forEach((moduleName) => {
    assert.match(source, new RegExp(moduleName.replaceAll("/", "\\/")));
  });

  const dedupeBlock = source.match(/dedupe:\s*\[[\s\S]*?\]/)?.[0] ?? "";
  [
    "react",
    "react-dom",
    "@tanstack/react-query",
    "@tanstack/query-core",
  ].forEach((moduleName) => {
    assert.match(dedupeBlock, new RegExp(moduleName.replaceAll("/", "\\/")));
  });
});

test("vite keeps shared UI and stream runtime out of the chart surface chunk", () => {
  const source = readFileSync(
    new URL("../../../vite.config.ts", import.meta.url),
    "utf8",
  );

  [
    'return "ui-core";',
    'return "platform-runtime";',
    'return "charting-runtime";',
    'return "feature-rayreplica-settings";',
  ].forEach((chunkReturn) => {
    assert.match(source, new RegExp(chunkReturn.replaceAll('"', '\\"')));
  });

  assert.match(source, /\/src\/lib\/uiTokens/);
  assert.match(source, /\/src\/lib\/responsive/);
  assert.match(source, /\/src\/lib\/timeZone/);
  assert.match(source, /\/src\/components\/platform\/BottomSheet/);
  assert.match(source, /\/src\/components\/platform\/PlatformErrorBoundary/);
  assert.match(source, /\/src\/features\/platform\/live-streams/);
  assert.match(source, /\/src\/features\/platform\/platformContexts/);
  assert.match(source, /\/src\/features\/preferences\/useUserPreferences/);
  assert.match(source, /\/src\/features\/preferences\/userPreferenceModel/);
  assert.match(source, /\/src\/features\/charting\/activeChartBarStore/);
  assert.match(source, /\/src\/features\/charting\/chartHydrationStats/);
  assert.match(source, /\/src\/features\/charting\/model/);
  assert.match(source, /\/src\/features\/charting\/useDrawingHistory/);
  assert.match(source, /\/src\/features\/charting\/useMassiveStockAggregateStream/);
  assert.match(source, /\/src\/features\/charting\/RayReplicaSettingsMenu/);
  assert.match(source, /\/src\/features\/charting\/rayReplicaPineAdapter/);

  const chartSurfaceStart = source.indexOf(
    'normalizedId.includes("/src/features/charting/ResearchChartSurface")',
  );
  const chartSurfaceEnd = source.indexOf(
    'return "feature-charting-surface";',
    chartSurfaceStart,
  );
  const chartSurfaceBlock =
    chartSurfaceStart >= 0 && chartSurfaceEnd >= 0
      ? source.slice(chartSurfaceStart, chartSurfaceEnd)
      : "";

  assert.notEqual(chartSurfaceBlock, "", "chart surface manual chunk block must be present");
  assert.doesNotMatch(chartSurfaceBlock, /RayReplicaSettingsMenu/);
  assert.doesNotMatch(chartSurfaceBlock, /rayReplicaPineAdapter/);
  assert.doesNotMatch(chartSurfaceBlock, /uiTokens/);
  assert.doesNotMatch(chartSurfaceBlock, /responsive/);
  assert.doesNotMatch(chartSurfaceBlock, /BottomSheet/);
  assert.doesNotMatch(chartSurfaceBlock, /activeChartBarStore/);
  assert.doesNotMatch(chartSurfaceBlock, /live-streams/);
  assert.doesNotMatch(chartSurfaceBlock, /platformContexts/);
  assert.doesNotMatch(chartSurfaceBlock, /useUserPreferences/);
  assert.doesNotMatch(chartSurfaceBlock, /userPreferenceModel/);
  assert.doesNotMatch(chartSurfaceBlock, /chartHydrationStats/);
  assert.doesNotMatch(chartSurfaceBlock, /useMassiveStockAggregateStream/);
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
  assert.match(source, /label="Events"/);
  assert.match(source, /label="Coverage"/);
  assert.match(source, /unusualCoverageLabel/);
  assert.doesNotMatch(source, /unusualItems\.length\} · \$\{unusualCoverage\.scannedSymbols/);
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
  const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

  assert.match(shellSource, /data-testid="mobile-bottom-nav"/);
  assert.match(shellSource, /data-testid="mobile-bottom-nav-more"/);
  assert.match(shellSource, /data-testid="mobile-kpi-rail"/);
  assert.match(shellSource, /ra-mobile-app-header/);
  assert.match(shellSource, /ra-mobile-bottom-nav/);
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
  assert.match(headerSource, /ra-mobile-broadcast-stack/);
  assert.match(headerSource, /ra-mobile-broadcast-lane/);
  assert.match(cssSource, /\.ra-mobile-nav-item\[aria-current="page"\]::before/);
});

test("floating platform controls use pointer outside-click listeners", () => {
  const marketActivitySource = readFileSync(
    new URL("../market/MarketActivityPanel.jsx", import.meta.url),
    "utf8",
  );
  const tickerSearchSource = readFileSync(
    new URL("./tickerSearch/TickerSearch.jsx", import.meta.url),
    "utf8",
  );

  [marketActivitySource, tickerSearchSource].forEach((source) => {
    assert.match(source, /addEventListener\("pointerdown", handlePointerDown\)/);
    assert.match(source, /removeEventListener\("pointerdown", handlePointerDown\)/);
    assert.doesNotMatch(source, /addEventListener\("mousedown", handlePointerDown\)/);
    assert.doesNotMatch(source, /removeEventListener\("mousedown", handlePointerDown\)/);
  });
});

test("market activity signal lane chips use the flow lane chip width", () => {
  const marketActivitySource = readFileSync(
    new URL("../market/MarketActivityPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(
    marketActivitySource,
    /const ACTIVITY_LANE_CHIP_MIN_WIDTH = 34;/,
  );
  assert.match(
    marketActivitySource,
    /MarketSignalRow[\s\S]*?activityChipStyle\(tone\.color, ACTIVITY_LANE_CHIP_MIN_WIDTH\)/,
  );
  assert.match(
    marketActivitySource,
    /MarketUnusualRow[\s\S]*?activityChipStyle\(tone\.color, ACTIVITY_LANE_CHIP_MIN_WIDTH\)/,
  );
});

test("header broadcast lane settings use the shared Radix Popover primitive", () => {
  const headerSource = readFileSync(
    new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
    "utf8",
  );

  assert.match(
    headerSource,
    /from\s+"\.\.\/\.\.\/components\/ui\/popover"/,
  );
  assert.match(headerSource, /<PopoverTrigger asChild>/);
  assert.match(headerSource, /<PopoverContent\b/);
  assert.match(headerSource, /getHeaderBroadcastScrollDurationSeconds/);
  assert.match(headerSource, /track\.scrollWidth \|\| 0\) \/ 2/);
  assert.match(headerSource, /speedPreset=\{speedPreset\}/);
  assert.doesNotMatch(headerSource, /durationSeconds=\{speedDurations/);
  assert.doesNotMatch(
    headerSource,
    /addEventListener\("pointerdown", handlePointerDown\)/,
  );
});

test("compact platform header stays flat and exposes line usage", () => {
  const shellSource = readFileSync(
    new URL("./PlatformShell.jsx", import.meta.url),
    "utf8",
  );
  const accountSource = readFileSync(
    new URL("./HeaderAccountStrip.jsx", import.meta.url),
    "utf8",
  );
  const kpiSource = readFileSync(
    new URL("./HeaderKpiStrip.jsx", import.meta.url),
    "utf8",
  );
  const statusSource = readFileSync(
    new URL("./HeaderStatusCluster.jsx", import.meta.url),
    "utf8",
  );
  const broadcastSource = readFileSync(
    new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
    "utf8",
  );

  const navBlock = shellSource.match(
    /data-testid="platform-screen-nav"[\s\S]*?<HeaderKpiStripComponent/,
  )?.[0] ?? "";
  const controlsBlock = shellSource.match(
    /data-testid="platform-header-controls"[\s\S]*?<HeaderAccountStripComponent/,
  )?.[0] ?? "";
  const kpiSurfaceBlock = kpiSource.match(
    /data-testid="platform-header-kpis"[\s\S]*?items\.map/,
  )?.[0] ?? "";

  assert.match(shellSource, /useElementSize/);
  assert.match(shellSource, /const \[headerRef, headerSize\] = useElementSize\(\)/);
  assert.match(shellSource, /const headerEffectiveWidth = headerSize\.width \|\| headerWidth/);
  assert.match(shellSource, /"minmax\(0, max-content\) minmax\(0, max-content\) minmax\(0, max-content\) minmax\(0, 1fr\) minmax\(0, max-content\)"/);
  assert.doesNotMatch(shellSource, /headerShowKpis \? "minmax/);
  assert.match(shellSource, /justifyContent:\s*"stretch"/);
  assert.match(shellSource, /headerUltraTight/);
  assert.match(shellSource, /const headerCompactStatus =/);
  assert.match(shellSource, /const headerShowKpis = !isPhone/);
  assert.match(shellSource, /const headerKpiMaxItems =/);
  assert.match(shellSource, /headerEffectiveWidth >= 1500/);
  assert.match(shellSource, /headerEffectiveWidth >= 1320[\s\S]*\? 5/);
  assert.match(shellSource, /headerEffectiveWidth >= 1120[\s\S]*\? 4/);
  assert.match(shellSource, /const headerAccountMinimal =/);
  assert.match(shellSource, /minimal=\{headerAccountMinimal\}/);
  assert.match(shellSource, /headerShowKpis \? \(/);
  assert.match(shellSource, /maxItems=\{headerKpiMaxItems\}/);
  assert.doesNotMatch(shellSource, /headerEffectiveWidth >= 1620/);
  assert.doesNotMatch(shellSource, /headerUltraTight \? null : \(\s*<HeaderAccountStripComponent/);
  assert.match(navBlock, /flexWrap:\s*"nowrap"/);
  assert.match(navBlock, /maxWidth:\s*"100%"/);
  assert.match(navBlock, /minWidth:\s*0/);
  assert.match(navBlock, /overflow:\s*"hidden"/);
  assert.doesNotMatch(navBlock, /overflowX:\s*"auto"/);
  assert.match(controlsBlock, /flexWrap:\s*"nowrap"/);
  assert.match(controlsBlock, /maxWidth:\s*"100%"/);
  assert.match(controlsBlock, /minWidth:\s*0/);
  assert.match(controlsBlock, /overflow:\s*"hidden"/);
  assert.doesNotMatch(controlsBlock, /overflowX:\s*"auto"/);

  assert.match(accountSource, /background:\s*"transparent"/);
  assert.match(accountSource, /border:\s*"none"/);
  assert.match(accountSource, /width:\s*minimal \? "auto" : "max-content"/);
  assert.match(accountSource, /minimal = false/);
  assert.match(accountSource, /!minimal && !\(compact && metric\.shortLabel === "Cash"\)/);
  assert.doesNotMatch(accountSource, /width:\s*dense \? dim\(250\)/);
  assert.match(kpiSurfaceBlock, /background:\s*"transparent"/);
  assert.match(kpiSurfaceBlock, /border:\s*"none"/);
  assert.match(kpiSurfaceBlock, /justifyContent:\s*"flex-start"/);
  assert.match(kpiSurfaceBlock, /width:\s*"max-content"/);
  assert.match(kpiSource, /maxItems = null/);
  assert.match(kpiSource, /HEADER_KPI_CONFIG\.slice\(0, Math\.max\(1, maxItems\)\)/);
  assert.match(kpiSource, /\{ symbol: "SPY", label: "S&P 500" \}/);
  assert.match(kpiSource, /\{ symbol: "QQQ", label: "Nasdaq 100" \}/);
  assert.match(kpiSource, /\{displayPriceLabel\}/);
  assert.match(kpiSource, /flex:\s*"0 0 max-content"/);
  assert.doesNotMatch(kpiSource, /flex:\s*"1 1 0"/);
  assert.match(kpiSource, /\{symbol\}\s*<\/span>/);
  assert.doesNotMatch(kpiSource, /\{label\}\s*<\/span>/);
  assert.doesNotMatch(kpiSource, /MicroSparkline/);

  assert.match(statusSource, /data-testid="header-ibkr-line-usage"/);
  assert.match(statusSource, /Market data lines/);
  assert.match(statusSource, /<IbkrPingWavelength connection=\{connection\}/);
  assert.doesNotMatch(statusSource, /compressed \? null : \(\s*<IbkrPingWavelength/);
  assert.doesNotMatch(statusSource, />\s*\{marketClock\.timeLabel\}\s*<\/span>/);
  assert.doesNotMatch(statusSource, />Market<\/span>/);
  assert.match(broadcastSource, /overflowX:\s*"hidden"/);
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
  const workbenchSource = readFileSync(
    new URL("../../screens/account/TradingAnalysisWorkbench.jsx", import.meta.url),
    "utf8",
  );

  assert.match(accountSource, /data-layout=\{accountIsPhone \? "phone"/);
  assert.match(accountSource, /<PositionsPanel[\s\S]*isPhone=\{accountIsPhone\}/);
  assert.match(accountSource, /<LazyTradingAnalysisWorkbench[\s\S]*isPhone=\{accountIsPhone\}/);
  assert.match(accountSource, /<LazyOrdersPanel[\s\S]*isPhone=\{accountIsPhone\}/);
  assert.match(positionsSource, /data-testid="account-positions-row-list"/);
  assert.match(tradesOrdersSource, /data-testid="account-orders-row-list"/);
  assert.match(workbenchSource, /dataTestId="account-analysis-trade-row"/);
  assert.match(workbenchSource, /isPhone \?/);
});

test("Account panels mount below-fold content and memoize mobile rows", () => {
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
  const workbenchSource = readFileSync(
    new URL("../../screens/account/TradingAnalysisWorkbench.jsx", import.meta.url),
    "utf8",
  );
  const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

  assert.doesNotMatch(deferredRenderSource, /IntersectionObserver/);
  assert.doesNotMatch(deferredRenderSource, /contentVisibility/);
  assert.doesNotMatch(deferredRenderSource, /data-deferred-render=\{[\s\S]*pending/);
  assert.match(deferredRenderSource, /onActivate\?\.\(\)/);
  assert.match(deferredRenderSource, /data-deferred-render="mounted"/);
  assert.match(accountSource, /<DeferredRender[\s\S]*account-deferred-positions/);
  assert.match(accountSource, /<DeferredRender[\s\S]*onActivate=\{\(\) => markAccountPanelActivated\("tradingAnalysis"\)\}[\s\S]*account-deferred-trading-analysis/);
  assert.match(accountSource, /<DeferredRender[\s\S]*onActivate=\{\(\) => markAccountPanelActivated\("orders"\)\}[\s\S]*account-deferred-orders/);
  assert.match(accountSource, /const LazyTradingAnalysisWorkbench = lazy/);
  assert.match(accountSource, /const LazyOrdersPanel = lazy/);
  assert.match(accountSource, /const LazyTodaySnapshotPanel = lazy/);
  assert.match(cssSource, /--ra-color-pnl-positive/);
  assert.match(positionsSource, /const MobilePositionRow = memo/);
  assert.match(positionsSource, /data-action="chart"/);
  assert.match(positionsSource, /onRowAction=\{handleMobileRowAction\}/);
  assert.match(tradesOrdersSource, /const MobileOrderRow = memo/);
  assert.match(workbenchSource, /TableExpandableRow/);
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
  assert.doesNotMatch(source, /useLiveMarketFlow/);
  assert.doesNotMatch(source, /workloadLabel:\s*"Flow screen"/);
  assert.doesNotMatch(source, /useMarketFlowSnapshot\(symbols/);
  assert.match(source, /useMarketFlowSnapshotForStoreKey\(\s*BROAD_MARKET_FLOW_STORE_KEY/);
  assert.match(source, /filterFlowTapeEvents\(flowEvents,\s*flowTapeFilters/);
  assert.match(source, /flowEventsFilteredOut/);
  assert.match(source, /flowTapeFiltersAreActive\(flowTapeFilters\)/);
  assert.match(source, /No prints match Flow filters/);
  assert.match(source, /flowQuality\?\.label === "Degraded"[\s\S]*\? "Degraded"/);
  assert.doesNotMatch(source, /flowStatus === "loading"[\s\S]*: "Degraded";/);
  assert.doesNotMatch(source, /virtual"\} rows/);
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

test("Flow phone tape cards stay compact and omit redundant row text", () => {
  const source = readFileSync(
    new URL("../../screens/FlowScreen.jsx", import.meta.url),
    "utf8",
  );
  const mobileCardSource = source.match(
    /const renderFlowMobileCard = \(event, index = 0\) => \{[\s\S]*?\n\s*\};\s*\n\s*const flowScannerStatusProps/,
  )?.[0];

  assert.ok(mobileCardSource, "mobile Flow card renderer must be present");
  assert.match(mobileCardSource, /data-mobile-density="compact"/);
  assert.match(mobileCardSource, /data-testid="flow-mobile-card-primary"/);
  assert.match(mobileCardSource, /data-testid="flow-mobile-card-compact-meta"/);
  assert.match(mobileCardSource, /renderTapeCell\("actions", event\)/);
  assert.match(mobileCardSource, /overflowX:\s*"auto"/);
  assert.match(
    mobileCardSource,
    /event\.side === "BUY" \? "B" : event\.side === "SELL" \? "S" : "M"/,
  );
  assert.match(
    mobileCardSource,
    /event\.type === "SWEEP" \? "SWP" : event\.type === "BLOCK" \? "BLK" : event\.type/,
  );
  assert.doesNotMatch(mobileCardSource, /event\.sourceLabel/);
  assert.doesNotMatch(mobileCardSource, /formatFlowAppTime/);
  assert.doesNotMatch(mobileCardSource, /appTimeZoneLabel/);
  assert.doesNotMatch(mobileCardSource, /<Badge/);
  assert.doesNotMatch(mobileCardSource, /data-testid="flow-mobile-fill-spread"/);
  assert.doesNotMatch(mobileCardSource, /Bid\/Ask|Sprd|VOL\/OI|Pinned|\bBULL\b|\bBEAR\b|\bNEUTRAL\b/);
  assert.doesNotMatch(mobileCardSource, />\s*Size\s*\{/);
  assert.doesNotMatch(mobileCardSource, />\s*OI\s*\{/);
  assert.doesNotMatch(mobileCardSource, />\s*Score\s*\{/);
});

test("Flow phone toolbar and tape header use icon-first compact controls", () => {
  const source = readFileSync(
    new URL("../../screens/FlowScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /SlidersHorizontal/);
  assert.match(source, /Calendar/);
  assert.match(source, /Clock/);
  assert.match(source, /DollarSign/);
  assert.match(source, /Hash/);
  assert.match(source, /Tag/);
  assert.match(source, /\{!isMobileFlowLayout \? "Filters" : null\}/);
  assert.match(source, /\{!isMobileFlowLayout \? "Columns" : null\}/);
  assert.match(source, /livePaused \? <Play size=\{14\} \/> : <Pause size=\{14\} \/>/);
  assert.match(source, /\{!isMobileFlowLayout \? \(livePaused \? "Resume" : "Pause"\) : null\}/);
  assert.match(source, /data-testid="flow-mobile-tape-summary"/);
  assert.match(source, /\["premium", "Premium", DollarSign\]/);
  assert.doesNotMatch(source, /\["premium", "Prem"\]/);
  assert.match(source, /aria-label=\{`Sort Flow tape by \$\{label\}`\}/);
  assert.match(source, /<Icon size=\{13\} \/>/);
  assert.match(source, /\{isMobileFlowLayout \? "×" : "Clear"\}/);
  assert.match(source, /\{isMobileFlowLayout \? flowFilterSymbol : `Symbol: \$\{flowFilterSymbol\}`\}/);
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
  assert.match(
    broadRuntime,
    /if \(!runtimeActive\) \{\s*clearMarketFlowSnapshot\(BROAD_MARKET_FLOW_STORE_KEY\)/,
  );
  assert.doesNotMatch(broadRuntime, /!\s*symbols\.length/);
  assert.match(broadRuntime, /clearMarketFlowSnapshot\(BROAD_MARKET_FLOW_STORE_KEY\)/);
  assert.match(sharedRuntime, /useLiveMarketFlow\(symbols,\s*\{[\s\S]*blocking:\s*true/);
  assert.match(broadRuntime, /useLiveMarketFlow\(symbols,\s*\{[\s\S]*blocking:\s*false/);
  assert.doesNotMatch(runtimeLayerSource, /activeSymbols=\{/);
  assert.doesNotMatch(platformAppSource, /broadFlowActiveSymbols/);
});

test("Broad scanner owns Flow across the visible app after startup", () => {
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
  assert.doesNotMatch(schedulerSource, /broadFlowAggregateReaderAllowed/);
  assert.doesNotMatch(schedulerSource, /backgroundResumeReady && memoryAllowsForeground/);
  assert.match(
    schedulerSource,
    /pressureCaps\.broadFlowRuntimeEnabled/,
  );
  assert.match(schedulerSource, /sharedFlowRuntime:\s*false/);
  assert.match(schedulerSource, /broadFlowRuntime:\s*broadFlowAllowed/);
  assert.doesNotMatch(source, /backgroundResumeReady\.broadFlow/);
  assert.match(apiIndexSource, /startOptionsFlowScanner\(\)/);
  assert.match(apiPlatformSource, /const OPTIONS_FLOW_SCANNER_ALWAYS_ON = readBooleanEnv\([\s\S]*"OPTIONS_FLOW_SCANNER_ALWAYS_ON"[\s\S]*true/);
  assert.doesNotMatch(source, /flowScanRuntimeEnabled/);
  assert.doesNotMatch(shellSource, /flowScanRuntimeEnabled/);
  assert.doesNotMatch(headerSource, /flowScanRuntimeEnabled/);
  assert.doesNotMatch(headerSource, /broadScanRuntimeActive/);
  assert.match(headerSource, /const broadScanSnapshotActive = broadScanEnabled && broadScanOwnerActive/);
  assert.match(headerSource, /providerSummaryHasFlowState/);
  assert.match(headerSource, /broadScanSnapshotHasProviderState/);
  assert.match(headerSource, /const broadScanSnapshotVisible = Boolean/);
  assert.match(headerSource, /flowScanStale/);
  assert.match(headerSource, /flowScanPaused/);
  assert.doesNotMatch(headerSource, /broadScanEnabled\s*\?\s*"loading"/);
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
    /label="Flow"[\s\S]*flowHasError[\s\S]*\? T\.red[\s\S]*flowDegraded[\s\S]*\? T\.amber[\s\S]*flowStatus === "loading"[\s\S]*\? T\.accent/,
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

test("signal monitor symbols do not join live market-data fanout", () => {
  const source = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const routerSource = readFileSync(
    new URL("./PlatformScreenRouter.jsx", import.meta.url),
    "utf8",
  );
  const runtimeSymbolBlock = source.match(
    /const runtimeWatchlistSymbols = useMemo\([\s\S]*?const runtimeStreamedAggregateSymbols = useMemo\([\s\S]*?\n  \);/,
  )?.[0];

  assert.ok(runtimeSymbolBlock, "PlatformApp must define runtime market-data symbols");
  assert.doesNotMatch(runtimeSymbolBlock, /signalMonitorSymbols/);
  assert.match(
    routerSource,
    /signalSuggestionSymbols=\{signalMonitorSymbols\}/,
    "Signal symbols should stay available for signal UI suggestions",
  );
});

test("initial market-data fanout starts with the visible watchlist slice", () => {
  const source = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const quoteSymbolsBlock = source.match(
    /const quoteSymbols = useMemo\(\(\) => \{[\s\S]*?\n  \}\);/,
  )?.[0];
  const sparklineSymbolsBlock = source.match(
    /const sparklineSymbols = useMemo\(\(\) => \{[\s\S]*?\n  \}\);/,
  )?.[0];
  const aggregateSymbolsBlock = source.match(
    /const streamedAggregateSymbols = useMemo\([\s\S]*?\n  \);/,
  )?.[0];
  const streamedQuoteSymbolsBlock = source.match(
    /const streamedQuoteSymbols = useMemo\([\s\S]*?\n  \);/,
  )?.[0];

  assert.match(source, /const INITIAL_MARKET_DATA_WATCHLIST_LIMIT = 8;/);
  assert.match(
    source,
    /watchlistSymbols\.slice\(0,\s*INITIAL_MARKET_DATA_WATCHLIST_LIMIT\)/,
  );
  assert.match(source, /const broadMarketDataHydrationReady = Boolean/);
  assert.match(source, /activeScreenBackgroundAllowed/);
  assert.match(source, /screenWarmupPhase === "ready"/);
  assert.match(source, /!memoryBlocksOperationalPreload/);
  [quoteSymbolsBlock, sparklineSymbolsBlock, aggregateSymbolsBlock].forEach(
    (block) => {
      assert.ok(block, "PlatformApp must define staged market-data symbols");
      assert.match(block, /visibleWatchlistMarketDataSymbols/);
      assert.match(block, /broadMarketDataHydrationReady \? broadMarketDataSymbols : \[\]/);
    },
  );
  assert.match(
    quoteSymbolsBlock ?? "",
    /marketScreenActive && broadMarketDataHydrationReady[\s\S]*\? MARKET_SNAPSHOT_SYMBOLS[\s\S]*: \[\]/,
  );
  assert.doesNotMatch(
    quoteSymbolsBlock ?? "",
    /\.\.\.watchlistSymbols/,
    "quote snapshots should not bypass the staged visible/broad watchlist gates",
  );
  assert.doesNotMatch(
    streamedQuoteSymbolsBlock ?? "",
    /watchlistSymbols/,
    "quote streams should not subscribe the full active watchlist directly",
  );
  assert.match(
    aggregateSymbolsBlock ?? "",
    /marketScreenActive && broadMarketDataHydrationReady[\s\S]*\? MARKET_SNAPSHOT_SYMBOLS[\s\S]*: \[\]/,
  );
  assert.match(
    sparklineSymbolsBlock ?? "",
    /marketScreenActive && broadMarketDataHydrationReady[\s\S]*\? INDICES\.map/,
  );
});

test("visible watchlist and open position symbols join bounded priority sparkline hydration", () => {
  const source = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const providerSource = readFileSync(
    new URL("./MarketDataSubscriptionProvider.jsx", import.meta.url),
    "utf8",
  );
  const runtimeLayerSource = readFileSync(
    new URL("./PlatformRuntimeLayer.jsx", import.meta.url),
    "utf8",
  );
  const runtimeSymbolBlock = source.match(
    /const runtimeQuoteSymbols = useMemo\([\s\S]*?const runtimeStreamedAggregateSymbols = useMemo\([\s\S]*?\n  \);/,
  )?.[0];
  const requestedSparklineBlock = providerSource.match(
    /const requestedSparklineSymbols = useMemo\([\s\S]*?\n  \);/,
  )?.[0];
  const prioritySparklineBlock = source.match(
    /const prioritySparklineSymbols = useMemo\([\s\S]*?\n  \);/,
  )?.[0];

  assert.match(source, /const OPEN_POSITION_MARKET_DATA_LIMIT = 16;/);
  assert.match(source, /const resolveOpenPositionMarketDataSymbol/);
  assert.match(source, /position\?\.marketDataSymbol/);
  assert.match(source, /position\?\.optionContract\?\.underlying/);
  assert.match(source, /openPositionMarketDataWeight\(right\)/);
  assert.match(source, /symbols\.length >= OPEN_POSITION_MARKET_DATA_LIMIT/);
  assert.match(runtimeSymbolBlock ?? "", /quoteSymbols, \.\.\.openPositionMarketDataSymbols/);
  assert.match(runtimeSymbolBlock ?? "", /sparklineSymbols, \.\.\.openPositionMarketDataSymbols/);
  assert.match(runtimeSymbolBlock ?? "", /streamedQuoteSymbols, \.\.\.openPositionMarketDataSymbols/);
  assert.doesNotMatch(
    runtimeSymbolBlock ?? "",
    /streamedAggregateSymbols, \.\.\.openPositionMarketDataSymbols/,
  );
  assert.match(prioritySparklineBlock ?? "", /visibleWatchlistMarketDataSymbols/);
  assert.match(prioritySparklineBlock ?? "", /openPositionMarketDataSymbols/);
  assert.match(source, /prioritySparklineSymbols=\{prioritySparklineSymbols\}/);
  assert.match(runtimeLayerSource, /prioritySparklineSymbols = \[\]/);
  assert.match(providerSource, /prioritySparklineSymbols = \[\]/);
  assert.match(requestedSparklineBlock ?? "", /lowPriorityHistoryEnabled \? sparklineSymbols : \[\]/);
  assert.match(requestedSparklineBlock ?? "", /\.\.\.prioritySparklineSymbols/);
});

test("signal monitor display refreshes separately from evaluator cadence", () => {
  const source = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const stateQuery = source.match(
    /const signalMonitorStateQuery = useGetSignalMonitorState\([\s\S]*?\n  \);/,
  )?.[0];
  const eventsQuery = source.match(
    /const signalMonitorEventsQuery = useListSignalMonitorEvents\([\s\S]*?\n  \);/,
  )?.[0];
  const displayReadyBlock = source.match(
    /const signalMonitorDisplayReady = Boolean\([\s\S]*?\n  \);/,
  )?.[0];
  const eventsReadyBlock = source.match(
    /const signalMonitorEventsReady = Boolean\([\s\S]*?\n  \);/,
  )?.[0];
  const matrixReadyBlock = source.match(
    /const signalMatrixRuntimeReady = Boolean\([\s\S]*?\n  \);/,
  )?.[0];

  assert.match(source, /SIGNAL_MONITOR_DISPLAY_POLL_MS\s*=\s*15_000/);
  assert.match(source, /const signalMonitorDisplayPollMs = Math\.min\(/);
  assert.match(source, /const signalMonitorRuntimePollMs = Math\.max/);
  assert.match(source, /SIGNAL_MATRIX_TIMEFRAMES\s*=\s*\["2m", "5m", "15m"\]/);
  assert.match(source, /const signalMonitorDisplayReady = Boolean/);
  assert.doesNotMatch(displayReadyBlock ?? "", /backgroundResumeReady/);
  assert.match(eventsReadyBlock ?? "", /backgroundResumeReady\.signalDisplay/);
  assert.match(source, /buildSignalMatrixRequestPlan/);
  assert.match(source, /signalMatrixUniverseSymbols/);
  assert.match(source, /signalMatrixBackgroundReady/);
  assert.match(source, /const signalMatrixPriorityReady = Boolean/);
  assert.match(source, /const signalMatrixRuntimeReady = Boolean/);
  assert.match(matrixReadyBlock ?? "", /signalMonitorDisplayReady/);
  assert.match(matrixReadyBlock ?? "", /signalMatrixPriorityReady \|\| signalMatrixBackgroundReady/);
  assert.match(matrixReadyBlock ?? "", /signalMatrixBackgroundReady/);
  assert.doesNotMatch(matrixReadyBlock ?? "", /screenWarmupPhase === "ready"/);
  assert.match(
    stateQuery ?? "",
    /enabled:\s*signalMonitorDisplayReady/,
  );
  assert.match(
    eventsQuery ?? "",
    /enabled:\s*signalMonitorEventsReady/,
  );
  assert.match(
    source,
    /detail:\s*`\$\{Math\.round\(signalMonitorRuntimePollMs \/ 1000\)\}s`/,
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
  assert.match(source, /const SIGNAL_MONITOR_ENVIRONMENT = "paper"/);
  assert.match(source, /useGetSignalMonitorProfile\(signalMonitorParams/);
  assert.match(source, /useGetSignalMonitorState\(signalMonitorParams/);
  assert.match(
    source,
    /useListSignalMonitorEvents\(signalMonitorEventsParams/,
  );
  assert.match(source, /environment:\s*SIGNAL_MONITOR_ENVIRONMENT/);
  assert.doesNotMatch(source, /fetch\("\/api\/signal-monitor/);
});

test("platform signal monitor uses paper profile for all header-lane signal queries", () => {
  const source = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");

  assert.match(source, /const signalMonitorEnvironment = "paper"/);
  assert.match(
    source,
    /getGetSignalMonitorStateQueryKey\(\{\s*environment:\s*signalMonitorEnvironment,/,
  );
  assert.match(
    source,
    /getListSignalMonitorEventsQueryKey\(\{\s*environment:\s*signalMonitorEnvironment,\s*limit:\s*100,/,
  );
  assert.match(
    source,
    /environment:\s*signalMonitorEnvironment,\s*mode:\s*queuedMode/,
  );
});

test("algo signal-options automation uses generated API ownership path", () => {
  const algoScreenSource = readFileSync(
    new URL("../../screens/AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const algoDirPath = new URL("../../screens/algo/", import.meta.url).pathname;
  const algoComponentSources = existsSync(algoDirPath)
    ? collectSourceFiles(new URL("../../screens/algo/", import.meta.url))
        .map((file) => readFileSync(file, "utf8"))
        .join("\n")
    : "";
  const algoCorpus = `${algoScreenSource}\n${algoComponentSources}`;

  assert.match(algoScreenSource, /useGetSignalOptionsAutomationState/);
  assert.match(algoScreenSource, /useGetSignalOptionsPerformance/);
  assert.match(algoScreenSource, /useRunSignalOptionsShadowScan/);
  assert.match(algoScreenSource, /useUpdateSignalOptionsExecutionProfile/);
  assert.match(algoScreenSource, /getGetSignalOptionsAutomationStateQueryKey/);
  assert.match(algoScreenSource, /getGetSignalOptionsPerformanceQueryKey/);
  assert.match(algoScreenSource, /shouldUseRemoteIbkrLaunchBrowser/);
  assert.match(algoScreenSource, /useRemoteDesktopLaunch[\s\S]*\/api\/ibkr\/remote-launch/);
  assert.match(algoScreenSource, /body:\s*JSON\.stringify\(\{\s*autoLogin:\s*false\s*\}\)/);
  assert.match(algoCorpus, /Signals?\s+→\s+Action|Signals?\s+-&gt;\s+Action|Signals?\s+to\s+Action/);
  assert.match(algoCorpus, /signal-options-expanded-capacity/);
  assert.match(algoCorpus, /CREATE SHADOW DEPLOYMENT/);
  assert.match(algoCorpus, /Missing bid\/ask quote/);
  assert.match(algoCorpus, /mtf_not_aligned:\s*"signal_policy"/);
  assert.match(algoCorpus, /ALGO_OPTION_QUOTE_CANDIDATE_LIMIT/);
  assert.match(algoCorpus, /ALGO_OPTION_QUOTE_CONTRACT_LIMIT/);
  assert.match(algoCorpus, /visibleSignalSymbols/);
  assert.match(algoCorpus, /limitAlgoOptionQuoteGroups/);
  assert.doesNotMatch(algoCorpus, /live_submitted/);
  assert.doesNotMatch(algoCorpus, /live_previewed/);
  assert.doesNotMatch(algoCorpus, /queryKey:\s*\[\s*"signal-options-state"/);
  assert.doesNotMatch(algoCorpus, /\/api\/algo\/deployments\/.*signal-options/);
});

test("operational screen warmup preloads code without mounting hidden pages", () => {
  const appSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const registrySource = readFileSync(new URL("./screenRegistry.jsx", import.meta.url), "utf8");
  const schedulerSource = readFileSync(new URL("./appWorkScheduler.js", import.meta.url), "utf8");
  const codeWarmupEffect = appSource.match(
    /useEffect\(\(\) => \{\s*if \(\s*!operationalCodePreloadReady[\s\S]*?\n  \}, \[operationalCodePreloadReady, screen\]\);/,
  )?.[0];

  assert.ok(codeWarmupEffect);
  assert.match(registrySource, /export const preloadScreenModule/);
  assert.match(registrySource, /OPERATIONAL_SCREEN_PRELOAD_ORDER = \[[\s\S]*"flow"/);
  assert.doesNotMatch(registrySource, /OPERATIONAL_SCREEN_WARM_MOUNT_ORDER/);
  assert.match(registrySource, /flow:\s*\{\s*retainInactive:\s*true\s*\}/);
  assert.match(appSource, /OPERATIONAL_SCREEN_PRELOAD_IDLE_DELAY_MS\s*=\s*8_000/);
  assert.match(appSource, /OPERATIONAL_SCREEN_PRELOAD_IDLE_STAGGER_MS\s*=\s*2_500/);
  assert.doesNotMatch(appSource, /OPERATIONAL_SCREEN_PRELOAD_STAGGER_MS/);
  assert.match(codeWarmupEffect, /screenId !== screen/);
  assert.match(codeWarmupEffect, /scheduleIdleWork/);
  assert.match(codeWarmupEffect, /preloadScreenModule\(screenId\)/);
  assert.doesNotMatch(codeWarmupEffect, /setScreenWarmupPhase/);
  assert.doesNotMatch(codeWarmupEffect, /setMountedScreens/);
  assert.match(schedulerSource, /mountScreens:\s*false/);
  assert.match(schedulerSource, /const backgroundHistoryReady = screenWarmupPhase === "ready"/);
});

test("retained hidden screens are isolated from shell and root render churn", () => {
  const shellSource = readFileSync(new URL("./PlatformShell.jsx", import.meta.url), "utf8");
  const registrySource = readFileSync(new URL("./screenRegistry.jsx", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");

  assert.match(shellSource, /const PlatformScreenStack = memo/);
  assert.match(shellSource, /data-testid="platform-screen-stack"/);
  assert.match(shellSource, /<PlatformScreenStack/);
  assert.match(registrySource, /skipStableHiddenScreenRender/);
  assert.match(
    registrySource,
    /prevProps\?\.isVisible === false && nextProps\?\.isVisible === false/,
  );
  assert.match(registrySource, /memo\(AccountScreen,\s*skipStableHiddenScreenRender\)/);
  assert.match(appSource, /const renderScreenById = useCallback/);
});

test("screen activation animation replay avoids forced layout reads", () => {
  const shellSource = readFileSync(new URL("./PlatformShell.jsx", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

  assert.match(shellSource, /const \[activationToken, setActivationToken\] = useState\(0\)/);
  assert.match(shellSource, /setActivationToken\(\(current\) => \(current \+ 1\) % 2\)/);
  assert.match(shellSource, /activationToken === 1 \? "ra-screen-enter-alt" : null/);
  assert.doesNotMatch(shellSource, /offsetWidth/);
  assert.doesNotMatch(shellSource, /classList\.remove\("ra-screen-enter"\)/);
  assert.match(cssSource, /@keyframes raScreenEnterAlt/);
  assert.match(cssSource, /\.ra-screen-enter-alt\s*\{[\s\S]*animation-name:\s*raScreenEnterAlt/);
});

test("platform background work waits for active screen readiness", () => {
  const appSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("./PlatformShell.jsx", import.meta.url), "utf8");
  const routerSource = readFileSync(
    new URL("./PlatformScreenRouter.jsx", import.meta.url),
    "utf8",
  );
  const screenSuspenseBlock =
    shellSource.match(/<Suspense[\s\S]*?renderScreenById\(id\)[\s\S]*?<\/Suspense>/)?.[0] ??
    "";
  const positionAlertsQueryBlock =
    appSource.match(/const positionAlertsQuery = useListPositions\([\s\S]*?\n  \);/)?.[0] ??
    "";

  assert.match(appSource, /const \[screenReadiness, setScreenReadiness\] = useState\(\{\}\)/);
  assert.match(appSource, /frameReady: false/);
  assert.match(appSource, /Boolean\(patch\.frameReady\) \|\| previous\.frameReady/);
  assert.match(appSource, /const activeScreenCriticalReady = Boolean/);
  assert.match(appSource, /const activeScreenBackgroundAllowed = Boolean/);
  assert.match(appSource, /activeScreenBackgroundAllowed,/);
  assert.match(appSource, /activeScreenBackgroundAllowed,\s*\n\s*ibkrWorkPressure/);
  assert.match(positionAlertsQueryBlock, /screen !== "market" \|\| activeScreenCriticalReady/);
  assert.doesNotMatch(positionAlertsQueryBlock, /activeScreenBackgroundAllowed/);
  assert.match(
    appSource,
    /const operationalCodePreloadReady = Boolean\(\s*pageVisible &&\s*firstScreenReady &&\s*activeScreenCriticalReady &&\s*sessionMetadataSettled/,
  );
  assert.match(appSource, /!activeScreenBackgroundAllowed/);
  assert.match(appSource, /const handleScreenReady = \(event\) =>/);
  assert.match(appSource, /const readyScreenId = event\?\.detail\?\.screenId/);
  assert.match(appSource, /if \(next\.derivedReady \|\| next\.backgroundAllowed\)/);
  assert.match(
    appSource,
    /handleScreenReadiness\(readyScreenId, \{\s*frameReady: true,\s*\}\)/,
  );
  assert.match(appSource, /onScreenReadiness=\{handleScreenReadiness\}/);
  assert.match(
    shellSource,
    /<ScreenReadyProbe screenId=\{id\} active=\{active\} \/>\s*<Suspense/,
  );
  assert.doesNotMatch(screenSuspenseBlock, /ScreenReadyProbe/);
  assert.match(routerSource, /const readinessHandlers = useMemo/);
  assert.match(routerSource, /SCREEN_IDS\.map/);
  assert.match(routerSource, /const buildReadinessHandler = \(screenId\) => readinessHandlers\[screenId\]/);

  [
    "market",
    "flow",
    "gex",
    "trade",
    "account",
    "research",
    "algo",
    "backtest",
  ].forEach((screenId) => {
    assert.match(
      routerSource,
      new RegExp(`onReadinessChange=\\{buildReadinessHandler\\("${screenId}"\\)\\}`),
    );
  });
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
  assert.match(source, /applyRuntimeQuoteSnapshots/);
  assert.match(source, /onQuotes:\s*handleStreamQuotes/);
});

test("market sparklines render the reduced high-detail point budget", () => {
  const source = readFileSync(
    new URL("./MarketDataSubscriptionProvider.jsx", import.meta.url),
    "utf8",
  );
  const configSource = readFileSync(
    new URL("./sparklineConfig.js", import.meta.url),
    "utf8",
  );
  const watchlistSource = readFileSync(
    new URL("./PlatformWatchlist.jsx", import.meta.url),
    "utf8",
  );
  const sparklineQuery = source.match(
    /const sparklineQuery = useQuery\(\{[\s\S]*?\n  \}\);/,
  )?.[0];

  assert.match(source, /const SPARKLINE_HISTORY_TIMEFRAME = "1m";/);
  assert.match(source, /const SPARKLINE_HISTORY_LIMIT = 720;/);
  assert.match(configSource, /export const SPARKLINE_RENDER_POINT_LIMIT = 40;/);
  assert.match(configSource, /export const TABLE_SPARKLINE_WIDTH = 58;/);
  assert.match(configSource, /export const TABLE_SPARKLINE_HEIGHT = 16;/);
  assert.match(configSource, /export const TABLE_SPARKLINE_COMPACT_WIDTH = 44;/);
  assert.match(configSource, /export const TABLE_SPARKLINE_COMPACT_HEIGHT = 12;/);
  assert.match(configSource, /export const buildDetailedFallbackSparklineData = /);
  assert.match(source, /SPARKLINE_RENDER_POINT_LIMIT/);
  assert.match(watchlistSource, /buildDetailedFallbackSparklineData/);
  assert.match(watchlistSource, /width=\{TABLE_SPARKLINE_WIDTH\}/);
  assert.match(watchlistSource, /height=\{TABLE_SPARKLINE_HEIGHT\}/);
  assert.match(watchlistSource, /width=\{TABLE_SPARKLINE_COMPACT_WIDTH\}/);
  assert.match(watchlistSource, /height=\{TABLE_SPARKLINE_COMPACT_HEIGHT\}/);
  assert.doesNotMatch(watchlistSource, /width=\{92\}/);
  assert.doesNotMatch(watchlistSource, /height=\{22\}/);
  assert.doesNotMatch(watchlistSource, /Math\.sin|Math\.cos/);
  assert.match(source, /const thinBarsForSparkline = /);
  assert.match(sparklineQuery ?? "", /SPARKLINE_HISTORY_TIMEFRAME/);
  assert.match(sparklineQuery ?? "", /SPARKLINE_HISTORY_LIMIT/);
  assert.match(sparklineQuery ?? "", /SPARKLINE_RENDER_POINT_LIMIT/);
  assert.match(
    sparklineQuery ?? "",
    /thinBarsForSparkline\(result\.value\.bars \|\| \[\]\)/,
  );
  assert.doesNotMatch(sparklineQuery ?? "", /timeframe:\s*"15m"/);
  assert.doesNotMatch(sparklineQuery ?? "", /limit:\s*48/);
  assert.doesNotMatch(watchlistSource, /const pointCount = 32/);
});

test("operational pages defer noncritical presentation work after first paint", () => {
  const marketSource = readFileSync(
    new URL("../../screens/MarketScreen.jsx", import.meta.url),
    "utf8",
  );
  const flowSource = readFileSync(
    new URL("../../screens/FlowScreen.jsx", import.meta.url),
    "utf8",
  );
  const tradeSource = readFileSync(
    new URL("../../screens/TradeScreen.jsx", import.meta.url),
    "utf8",
  );
  const accountSource = readFileSync(
    new URL("../../screens/AccountScreen.jsx", import.meta.url),
    "utf8",
  );
  const algoSource = readFileSync(
    new URL("../../screens/AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const researchSource = readFileSync(
    new URL("../research/PhotonicsObservatory.jsx", import.meta.url),
    "utf8",
  );
  const platformAppSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");

  assert.match(flowSource, /const FLOW_ACTIVATION_DELAY_MS = 90/);
  assert.match(flowSource, /data-testid="flow-screen-activation-shell"/);
  assert.match(flowSource, /const FLOW_DEFERRED_PANELS_DELAY_MS = 500/);
  assert.match(flowSource, /requestAnimationFrame\(\(\) => \{\s*secondFrameId = requestAnimationFrame/);
  assert.match(flowSource, /FLOW_DEFERRED_PANELS_DELAY_MS/);
  assert.match(tradeSource, /const TradeScreenInner =/);
  assert.doesNotMatch(tradeSource, /TradeActivationFallback/);
  assert.doesNotMatch(tradeSource, /data-testid="trade-screen-activation-shell"/);
  assert.match(tradeSource, /secondaryPanelsVisible:\s*Boolean\(isVisible && secondaryReady\)/);
  assert.match(accountSource, /const ACCOUNT_ACTIVATION_DELAY_MS = 90/);
  assert.match(accountSource, /const ACCOUNT_CRITICAL_FALLBACK_DELAY_MS = 1_000/);
  assert.match(accountSource, /const AccountScreenInner =/);
  assert.match(accountSource, /data-testid="account-screen-activation-shell"/);
  assert.match(accountSource, /criticalReady: Boolean\(isVisible && accountCriticalReady\)/);
  assert.match(accountSource, /derivedReady: Boolean\(isVisible && accountDerivedReady\)/);
  assert.match(accountSource, /markRouteDataTiming\("account", stage, detail\)/);
  assert.match(accountSource, /enabled: todayPanelQueriesEnabled/);
  assert.match(accountSource, /enabled: tradingAnalysisQueriesEnabled/);
  assert.match(accountSource, /enabled: ordersPanelQueriesEnabled/);
  assert.match(accountSource, /enabled: Boolean\(!shadowMode && supportPanelQueriesEnabled\)/);
  assert.match(accountSource, /enabled: secondaryAccountQueriesEnabled/);
  assert.match(algoSource, /const ALGO_CRITICAL_FALLBACK_DELAY_MS = 1_000/);
  assert.match(algoSource, /criticalReady: algoCriticalReady/);
  assert.match(algoSource, /markRouteDataTiming\("algo", stage, detail\)/);
  assert.match(researchSource, /criticalReady: Boolean\(isVisible\)/);
  assert.doesNotMatch(researchSource, /const criticalReady = Boolean\(isVisible && researchMetaReady\)/);
  assert.match(marketSource, /const MARKET_ACTIVATION_DELAY_MS = 70/);
  assert.match(marketSource, /const MarketScreenInner =/);
  assert.match(marketSource, /data-testid="market-screen-activation-shell"/);
  assert.match(marketSource, /const LazyMultiChartGrid = lazyWithRetry/);
  assert.match(marketSource, /const preloadMarketChartModules = \(\) =>/);
  assert.match(marketSource, /preloadDynamicImport\(loadMultiChartGridModule/);
  assert.match(marketSource, /preloadMarketChartRuntime\?\.\(\)/);
  assert.match(marketSource, /preloadDynamicImport\(loadMarketActivityPanelModule/);
  assert.doesNotMatch(marketSource, /preloadDynamicImport\(\(\) => import\("\.\.\/features\/charting\/ResearchChartSurface"\)/);
  assert.doesNotMatch(marketSource, /preloadDynamicImport\(\(\) => import\("\.\.\/features\/trade\/TradeEquityPanel\.jsx"\)/);
  assert.match(marketSource, /preloadMarketChartModules\(\)/);
  assert.match(marketSource, /<Suspense fallback=\{<MarketChartGridFallback \/>\}>/);
  assert.match(marketSource, /const \[chartGridReady, setChartGridReady\]/);
  assert.match(marketSource, /MARKET_SECONDARY_PANEL_DELAY_MS\s*=\s*600/);
  assert.match(marketSource, /setSecondaryPanelsReady\(true\),\s*MARKET_SECONDARY_PANEL_DELAY_MS/);
  assert.doesNotMatch(marketSource, /chartGridReady \? 600 : MARKET_SECONDARY_PANEL_DELAY_MS/);
  assert.match(marketSource, /criticalReady: Boolean\(isVisible\)/);
  assert.match(marketSource, /derivedReady: Boolean\(isVisible && chartGridReady\)/);
  assert.doesNotMatch(marketSource, /criticalReady: Boolean\(isVisible && chartGridReady\)/);
  assert.match(marketSource, /onReady=\{handleMarketChartGridReady\}/);
  assert.doesNotMatch(marketSource, /onReadinessChange\?\.\(\{ criticalReady: true \}\)/);
  assert.doesNotMatch(marketSource, /import \{ MultiChartGrid \}/);
  assert.match(marketSource, /secondaryPanelsReady \? \(\s*<MarketActivityPanelContainer/);
  assert.match(marketSource, /const LazyMarketActivityPanel = lazyWithRetry/);
  assert.match(marketSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.match(marketSource, /testId="market-activity-loader"/);
  assert.doesNotMatch(platformAppSource, /BROAD_FLOW_BACKGROUND_STARTUP_DELAY_MS/);
  assert.doesNotMatch(platformAppSource, /backgroundResumeReady\.broadFlow/);
  assert.doesNotMatch(platformAppSource, /broadFlowStartupDelayMs=\{0\}/);
});

test("Trade first render chunk lazy-loads noncritical panels", () => {
  const tradeSource = readFileSync(
    new URL("../../screens/TradeScreen.jsx", import.meta.url),
    "utf8",
  );

  [
    "LazyMiniChartTickerSearch",
    "LazyTradeOrderTicket",
    "LazyTradeChainPanel",
    "LazyTradeStrategyGreeksPanel",
    "LazyTradeL2Panel",
    "LazyTradePositionsPanel",
    "LazyBottomSheet",
    "LazyDrawer",
  ].forEach((name) => {
    assert.match(tradeSource, new RegExp(`const ${name} = lazyWithRetry`));
  });
  [
    "features/trade/TradeOrderTicket.jsx",
    "features/trade/TradeChainPanel.jsx",
    "features/trade/TradeStrategyGreeksPanel.jsx",
    "features/trade/TradeL2Panel.jsx",
    "features/trade/TradePositionsPanel.jsx",
    "features/platform/tickerSearch/TickerSearch.jsx",
    "components/ui/bottom-sheet",
    "components/ui/drawer",
  ].forEach((modulePath) => {
    assert.doesNotMatch(
      tradeSource,
      new RegExp(`from\\s+["']\\.\\./.*${modulePath.replaceAll("/", "\\/")}`),
    );
  });
  assert.match(tradeSource, /const TradePanelLoadBoundary =/);
  assert.match(tradeSource, /<PlatformErrorBoundary[\s\S]*fallbackRender=\{\(\{ resetErrorBoundary \}\) =>/);
  assert.match(tradeSource, /<Suspense[\s\S]*<TradeDeferredPanel[\s\S]*testId=\{testId\}/);
  assert.match(tradeSource, /const MemoTradeOrderTicket = memo[\s\S]*<TradePanelLoadBoundary[\s\S]*testId="trade-order-ticket"/);
  assert.match(tradeSource, /const MemoTradeChainPanel = memo[\s\S]*<TradePanelLoadBoundary[\s\S]*testId="trade-options-chain-panel"/);
  assert.match(tradeSource, /const MemoTradeL2Panel = memo[\s\S]*<TradePanelLoadBoundary[\s\S]*testId="trade-l2-panel"/);
  assert.match(tradeSource, /const MemoTradePositionsPanel = memo[\s\S]*<TradePanelLoadBoundary[\s\S]*testId="trade-positions-panel"/);
  assert.match(tradeSource, /open \? \(\s*<Suspense fallback=\{null\}>[\s\S]*<LazyMiniChartTickerSearch/);
  assert.match(tradeSource, /phoneTicketSheetOpen \? \(\s*<Suspense fallback=\{null\}>[\s\S]*<LazyBottomSheet/);
  assert.match(tradeSource, /phoneL2DrawerOpen \? \(\s*<Suspense fallback=\{null\}>[\s\S]*<LazyDrawer/);
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
  assert.match(tradeScreenSource, /executionWarm:\s*Boolean\(isVisible\)/);
  assert.match(tradeScreenSource, /primaryVisible:\s*Boolean\(isVisible\)/);
  assert.match(tradeScreenSource, /secondaryPanelsVisible:\s*Boolean\(isVisible && secondaryReady\)/);
  assert.match(tradeScreenSource, /analysisVisible:\s*Boolean\(visibleInteractive && secondaryReady\)/);
  assert.match(tradeScreenSource, /const tradeExecutionWorkEnabled = tradeRuntimeActivity\.executionWarm/);
  assert.match(tradeScreenSource, /const tradeAnalysisWorkEnabled = tradeRuntimeActivity\.analysisVisible/);
  assert.match(tradeScreenSource, /enabled=\{tradeExecutionWorkEnabled\}/);
  assert.match(tradeScreenSource, /analysisEnabled=\{tradeAnalysisWorkEnabled\}/);
  assert.match(tradeScreenSource, /executionEnabled=\{tradeExecutionBrokerStreamingEnabled\}/);
  assert.match(tradeScreenSource, /visibleEnabled=\{tradeAnalysisBrokerStreamingEnabled\}/);
  assert.match(tradeScreenSource, /const renderTradePanels = tradeRuntimeActivity\.secondaryPanelsVisible/);
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
    /const draftsQuery = useListBacktestDraftStrategies\(\{[\s\S]*enabled:\s*algoPostCriticalQueriesEnabled/,
  );
  assert.match(
    algoSource,
    /const deploymentsQuery = useListAlgoDeployments\([\s\S]*enabled:\s*algoCriticalQueriesEnabled/,
  );
  assert.match(
    algoSource,
    /const eventsQuery = useListExecutionEvents\([\s\S]*enabled:\s*algoCriticalQueriesEnabled/,
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
