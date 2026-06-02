import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/tooltip";
import {
  buildAlgoMonitorSignalActionRows,
  PlatformAlgoMonitorSidebar,
} from "./PlatformAlgoMonitorSidebar.jsx";

const repoRoot = new URL("../../../../..", import.meta.url);
const pyrusSrcRoot = new URL("../../", import.meta.url);

const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const isTestSourceFile = (filePath) =>
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath);

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

test("platform root no longer depends on the retired PyrusPlatform module", () => {
  const retiredRootPath = new URL("../../PyrusPlatform.jsx", import.meta.url);
  assert.equal(existsSync(retiredRootPath), false);

  const appSource = readFileSync(new URL("../../app/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /\.\/AppContent/);
  assert.match(appSource, /const loadAppContent = \(\) =>/);
  assert.match(appSource, /void loadAppContent\(\)/);
  assert.doesNotMatch(appSource, /PyrusPlatform/);

  const appContentSource = readFileSync(new URL("../../app/AppContent.tsx", import.meta.url), "utf8");
  assert.match(appContentSource, /features\/platform\/PlatformApp\.jsx/);
  assert.match(appContentSource, /const loadPlatformApp = \(\) =>/);
  assert.match(appContentSource, /export const preloadInitialAppContentRoute = \(\) =>/);
  assert.match(appContentSource, /preloadDynamicImport\(loadPlatformApp/);
  assert.match(appContentSource, /reportCategory="react-workspace-chunk"/);
  assert.match(appContentSource, /preloadInitialAppContentRoute\(\)/);
  assert.doesNotMatch(appContentSource, /PyrusPlatform/);

  const sourceHits = collectSourceFiles(pyrusSrcRoot)
    .filter((filePath) => !filePath.endsWith("platformRootSource.test.js"))
    .map((filePath) => ({
      filePath,
      source: readFileSync(filePath, "utf8"),
    }))
    .filter(({ source }) => /PyrusPlatform/.test(source))
    .map(({ filePath }) => relative(repoRoot.pathname, filePath));

  assert.deepEqual(sourceHits, []);
});

test("safe QA mode disables platform live and diagnostics side effects", () => {
  const appSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("./PlatformShell.jsx", import.meta.url), "utf8");
  const headerSource = readFileSync(new URL("./AppHeader.jsx", import.meta.url), "utf8");
  const performanceSource = readFileSync(
    new URL("./performanceMetrics.ts", import.meta.url),
    "utf8",
  );

  assert.match(appSource, /safeQaMode=\{safeQaMode\}/);
  assert.match(appSource, /quoteSymbols=\{safeQaMode \? \[\] : runtimeQuoteSymbols\}/);
  assert.match(appSource, /sparklineSymbols=\{safeQaMode \? \[\] : runtimeSparklineSymbols\}/);
  assert.match(appSource, /streamedQuoteSymbols=\{safeQaMode \? \[\] : runtimeStreamedQuoteSymbols\}/);
  assert.match(appSource, /quoteStreamRuntimeEnabled=\{\s*!safeQaMode &&/);
  assert.match(appSource, /lowPriorityHistoryEnabled=\{\s*!safeQaMode &&/);
  assert.match(appSource, /sparklineHistoryEnabled=\{\s*!safeQaMode &&/);
  assert.match(appSource, /enabled:\s*Boolean\(sessionQuery\.data && !safeQaMode\)/);
  assert.match(appSource, /skipBootProgressTasks\(\["accounts"\], "Accounts skipped in safe QA mode"\)/);
  const marketDataSubscriptionSource = readFileSync(
    new URL("./MarketDataSubscriptionProvider.jsx", import.meta.url),
    "utf8",
  );
  assert.match(
    marketDataSubscriptionSource,
    /const positionQuoteStreamDisabledReason = resolveQuoteStreamDisabledReason\(\{\s*pageVisible,\s*quoteStreamRuntimeEnabled,/,
  );
  assert.match(shellSource, /safeQaMode = false/);
  assert.match(shellSource, /<AppHeader[\s\S]*safeQaMode=\{safeQaMode\}/);
  assert.match(shellSource, /enabled=\{sessionMetadataSettled && !safeQaMode\}/);
  assert.match(headerSource, /safeQaMode = false/);
  assert.match(headerSource, /<HeaderStatusClusterComponent[\s\S]*safeQaMode=\{safeQaMode\}/);
  assert.match(headerSource, /enabled=\{sessionMetadataSettled && !safeQaMode\}/);
  const statusSource = readFileSync(
    new URL("./HeaderStatusCluster.jsx", import.meta.url),
    "utf8",
  );
  assert.match(statusSource, /safeQaMode = false/);
  assert.match(statusSource, /const gatewayDiagnosticsEnabled = Boolean\(\s*!safeQaMode &&/);
  assert.match(performanceSource, /import \{ isPyrusSafeQaMode \}/);
  assert.match(performanceSource, /isPyrusSafeQaMode\(\) \|\|/);
});

test("retained screen lazy ticker search exports resolve to components", async () => {
  const tickerSearch = await import("./tickerSearch/TickerSearch.jsx");

  assert.equal(typeof tickerSearch.MarketChartTickerSearch, "function");
  assert.equal(typeof tickerSearch.MiniChartTickerSearch, "function");
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

test("vite leaves Replit runtime error modal opt-in so PYRUS owns crash diagnostics", () => {
  const source = readFileSync(
    new URL("../../../vite.config.ts", import.meta.url),
    "utf8",
  );
  const pluginBlock = source.match(/plugins:\s*\[[\s\S]*?\n  \]/)?.[0] ?? "";

  assert.match(source, /PYRUS_ENABLE_REPLIT_RUNTIME_ERROR_MODAL/);
  assert.match(source, /const enableReplitRuntimeErrorModal =/);
  assert.match(pluginBlock, /\.\.\.\(enableReplitRuntimeErrorModal/);
  assert.match(pluginBlock, /runtimeErrorOverlay\(/);
  assert.doesNotMatch(pluginBlock, /tailwindcss\(\),\s*\n\s*runtimeErrorOverlay\(/);
});

test("app root reports Vite compiler overlays into PYRUS diagnostics", () => {
  const appContentSource = readFileSync(
    new URL("../../app/AppContent.tsx", import.meta.url),
    "utf8",
  );

  assert.match(appContentSource, /import\.meta\.hot\?\.on\("vite:error"/);
  assert.match(appContentSource, /const VITE_OVERLAY_SELECTOR = "vite-error-overlay"/);
  assert.match(appContentSource, /category: "vite-dev-overlay"/);
  assert.match(appContentSource, /severity: "critical" as const/);
  assert.match(appContentSource, /rememberBrowserDiagnosticEvent\(diagnosticEvent\)/);
  assert.match(appContentSource, /postClientDiagnosticEvent\(diagnosticEvent\)/);
  assert.match(appContentSource, /new MutationObserver/);
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
    'return "feature-pyrus-signals-settings";',
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
  assert.match(source, /\/src\/features\/charting\/PyrusSignalsSettingsMenu/);
  assert.match(source, /\/src\/features\/charting\/pyrusSignalsPineAdapter/);

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
  assert.doesNotMatch(chartSurfaceBlock, /PyrusSignalsSettingsMenu/);
  assert.doesNotMatch(chartSurfaceBlock, /pyrusSignalsPineAdapter/);
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
  assert.match(source, /providerSummaryHasMarketSessionQuiet/);
  assert.match(source, /!flowSessionQuiet/);
  assert.match(source, /flowSessionQuietWithRetainedEvents/);
  assert.match(source, /flowSessionQuietWithRetainedEvents[\s\S]*\? "LAST FLOW"/);
  assert.match(source, /flowSessionQuiet[\s\S]*\? "NO FLOW"/);
  assert.match(source, /const unusualCurrentBatch = flowSessionQuiet/);
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
  const appHeaderSource = readFileSync(
    new URL("./AppHeader.jsx", import.meta.url),
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
  assert.match(appHeaderSource, /data-testid="mobile-kpi-rail"/);
  assert.match(appHeaderSource, /ra-mobile-app-header/);
  assert.match(shellSource, /ra-mobile-bottom-nav/);
  assert.match(appHeaderSource, /testId="mobile-activity-trigger"/);
  assert.match(appHeaderSource, /testId="mobile-watchlist-trigger"/);
  assert.match(shellSource, /<MobileMoreSheet/);
  assert.match(shellSource, /<MobileActivitySheet/);
  assert.match(shellSource, /const \{ isPhone, isTablet, isNarrow \} = viewport\.flags/);
  assert.match(shellSource, /const auxiliaryDrawerViewport = isPhone \|\| isTablet/);
  assert.match(shellSource, /open=\{auxiliaryDrawerViewport && mobileActivityOpen\}/);
  assert.match(shellSource, /collapsed=\{isTablet \|\| activitySidebarCollapsed\}/);
  assert.match(shellSource, /setMobileActivityOpen\(true\);[\s\S]*return;[\s\S]*setActivitySidebarCollapsed/);
  assert.match(shellSource, /<MobileWatchlistDrawer/);
  assert.match(shellSource, /signalMonitorProfile=\{signalMonitorProfile\}/);
  assert.match(shellSource, /signalMonitorEvents=\{signalMonitorEvents\}/);
  assert.doesNotMatch(shellSource, /MobileNavDrawer/);
  assert.equal(existsSync(retiredMobileNavDrawerPath), false);
  assert.match(shellSource, /data-viewport=/);
  assert.match(moreSheetSource, /testId="mobile-more-sheet"/);
  assert.match(moreSheetSource, /mobile-more-screen-/);
  assert.match(moreSheetSource, /"flow",\s*"gex"/);
  assert.match(activitySheetSource, /testId="mobile-activity-sheet"/);
  assert.match(activitySheetSource, /<Drawer/);
  assert.match(activitySheetSource, /side="right"/);
  assert.match(activitySheetSource, /fullBleed/);
  assert.match(activitySheetSource, /<PlatformAlgoMonitorSidebar/);
  assert.match(activitySheetSource, /dataEnabled=\{Boolean\(open && dataEnabled\)\}/);
  assert.match(activitySheetSource, /signalMatrixStates=\{signalMatrixStates\}/);
  assert.match(activitySheetSource, /compactLayout/);
  assert.doesNotMatch(activitySheetSource, /useMarketAlertsSnapshot/);
  assert.match(watchlistDrawerSource, /testId="mobile-watchlist-drawer"/);
  assert.match(watchlistDrawerSource, /side="right"/);
  assert.match(watchlistDrawerSource, /fullBleed/);
  assert.match(watchlistDrawerSource, /density="mobile-dense"/);
  assert.match(watchlistDrawerSource, /<WatchlistComponent/);
  assert.match(watchlistDrawerSource, /signalProfile=\{signalMonitorProfile\}/);
  assert.match(watchlistDrawerSource, /signalEvents=\{signalMonitorEvents\}/);
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

test("mobile IBKR header dropdown uses a phone sheet outside clipped header chrome", () => {
  const statusSource = readFileSync(
    new URL("./HeaderStatusCluster.jsx", import.meta.url),
    "utf8",
  );
  const appHeaderSource = readFileSync(
    new URL("./AppHeader.jsx", import.meta.url),
    "utf8",
  );
  const setupHealthSource = readFileSync(
    new URL("../../screens/account/SetupHealthPanel.jsx", import.meta.url),
    "utf8",
  );
  const platformAppSource = readFileSync(
    new URL("./PlatformApp.jsx", import.meta.url),
    "utf8",
  );

  assert.match(appHeaderSource, /className=\{isPhone \? "ra-mobile-app-header" : undefined\}/);
  assert.match(appHeaderSource, /overflow:\s*"hidden"/);
  assert.match(appHeaderSource, /<HeaderStatusClusterComponent[\s\S]*?compact[\s\S]*?mobileSheet/);
  assert.match(statusSource, /mobileSheet = false/);
  assert.match(statusSource, /bridgePopoverAsSheet = mobileSheet/);
  assert.match(statusSource, /from "react-dom"/);
  assert.match(statusSource, /createPortal\(\(/);
  assert.match(statusSource, /document\.body/);
  assert.match(statusSource, /data-testid="header-ibkr-mobile-sheet-backdrop"/);
  assert.match(statusSource, /data-testid=\{bridgePopoverAsSheet \? "header-ibkr-mobile-sheet" : undefined\}/);
  assert.match(statusSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(statusSource, /aria-modal=\{bridgePopoverAsSheet \? true : undefined\}/);
  assert.match(statusSource, /bottom:\s*bridgePopoverAsSheet \? 0 : undefined/);
  assert.match(statusSource, /maxHeight:\s*bridgePopoverAsSheet[\s\S]*?"min\(82dvh, 620px\)"/);
  assert.match(statusSource, /zIndex:\s*bridgePopoverAsSheet \? 280 : 240/);
  assert.match(statusSource, /data-testid="header-ibkr-provider-rows"/);
  assert.match(statusSource, /<HeaderIbkrProviderRows rows=\{model\.providerRows\}/);
  assert.match(statusSource, /HeaderMassiveProviderPanel/);
  assert.match(statusSource, /HeaderProviderChannelChip/);
  assert.match(statusSource, /HEADER_PROVIDER_ICONS/);
  assert.match(statusSource, /bridgeTriggerRef\.current\?\.contains\(target\)/);
  assert.match(statusSource, /bridgePopoverRef\.current\?\.contains\(target\)/);
  assert.match(statusSource, /IBKR_RECONNECT_REQUEST_EVENT/);
  assert.match(statusSource, /window\.addEventListener\(\s*IBKR_RECONNECT_REQUEST_EVENT/);
  assert.match(statusSource, /setBridgePopoverOpen\(true\)/);
  assert.match(statusSource, /autoLoginUsernameInputRef\.current\?\.focus\?\.\(\)/);
  assert.match(statusSource, /const bridgeCredentialResumeAvailable = Boolean/);
  assert.match(statusSource, /const desktopReconnectNeeded = Boolean/);
  assert.match(statusSource, /desktopReconnectNeeded/);
  assert.match(statusSource, /desktopReconnectUpgradeRequired/);
  assert.match(statusSource, /Reconnect on desktop/);
  assert.match(statusSource, /const deliverIbkrLoginCredentials = useCallback/);
  assert.match(statusSource, /"Sending credentials to the active Windows helper\."/);
  assert.match(statusSource, /bridgeCredentialResumeAvailable[\s\S]*\? "Send credentials"/);
  assert.match(statusSource, /type=\{autoLoginPrimaryCancelsLaunch \? "button" : "submit"\}/);
  const deactivateStart = statusSource.indexOf(
    "const handleDeactivate = useCallback",
  );
  const deactivateDetach = statusSource.indexOf(
    '"/api/ibkr/bridge/detach"',
    deactivateStart,
  );
  const deactivateWait = statusSource.indexOf(
    "void waitForIbkrDesktopJob",
    deactivateStart,
  );
  assert.notEqual(deactivateStart, -1);
  assert.notEqual(deactivateDetach, -1);
  assert.notEqual(deactivateWait, -1);
  assert.ok(
    deactivateDetach < deactivateWait,
    "IBKR deactivate should clear backend runtime before waiting for desktop shutdown confirmation",
  );
  assert.match(statusSource, /const shutdownRequest = platformJsonRequest/);
  assert.match(statusSource, /Queueing Windows shutdown and detaching backend runtime/);
  assert.match(statusSource, /Waiting for Windows shutdown queue confirmation/);
  assert.match(statusSource, /IBKR detached\. Waiting for the Windows desktop/);
  assert.match(statusSource, /HeaderIbkrOperationStepper/);
  assert.match(statusSource, /buildIbkrLaunchOperationStepper/);
  assert.match(statusSource, /buildIbkrDeactivateOperationStepper/);
  assert.match(statusSource, /IBKR_BRIDGE_ACTIVATION_STATUS_POLL_MS/);
  assert.match(statusSource, /data-testid=\{`ibkr-operation-stepper-\$\{model\.operation\}`\}/);
  assert.match(statusSource, /IBKR_OPERATION_STEP_ICONS/);
  assert.match(statusSource, /data-ibkr-step-complete/);
  assert.match(statusSource, /data-ibkr-step-motion/);
  assert.match(statusSource, /"--ibkr-step-tone": tone/);
  assert.match(statusSource, /letterSpacing:\s*0/);
  assert.match(statusSource, /data-ibkr-step-line/);
  assert.match(statusSource, /AlertTriangle/);
  assert.match(platformAppSource, /var\(--ibkr-step-tone,var\(--ra-color-status-warn\)\)/);
  assert.match(platformAppSource, /@keyframes ibkrStepCheckPop/);
  assert.match(platformAppSource, /@keyframes ibkrStepIconPulse/);
  assert.match(platformAppSource, /@keyframes ibkrStepIconDispatch/);
  assert.match(platformAppSource, /@keyframes ibkrStepIconSecure/);
  assert.match(platformAppSource, /@keyframes ibkrStepIconBoot/);
  assert.match(platformAppSource, /@keyframes ibkrStepIconLink/);
  assert.match(platformAppSource, /@keyframes ibkrStepIconTunnel/);
  assert.match(platformAppSource, /@keyframes ibkrStepIconQueue/);
  assert.match(platformAppSource, /@keyframes ibkrStepIconDetach/);
  assert.match(platformAppSource, /@keyframes ibkrStepIconPower/);
  assert.match(platformAppSource, /@keyframes ibkrStepLineFill/);
  assert.match(platformAppSource, /\[data-ibkr-step-complete\] \*/);
  assert.match(platformAppSource, /\[data-ibkr-step-motion\]/);
  assert.match(platformAppSource, /\[data-ibkr-step-motion\] \*/);
  assert.match(statusSource, /\{canDeactivate \? \(/);
  assert.doesNotMatch(statusSource, /canDeactivate && !showCredentialForm/);
  assert.match(setupHealthSource, /requestIbkrReconnect/);
  assert.match(setupHealthSource, /onReconnect=\{requestIbkrReconnect\}/);
});

test("account section transition status renders in the platform header", () => {
  const appHeaderSource = readFileSync(
    new URL("./AppHeader.jsx", import.meta.url),
    "utf8",
  );
  const transitionStoreSource = readFileSync(
    new URL("./accountSectionTransitionStore.js", import.meta.url),
    "utf8",
  );

  assert.match(appHeaderSource, /useAccountSectionTransitionSnapshot/);
  assert.match(appHeaderSource, /const AccountSectionTransitionStatus = \(\) =>/);
  assert.match(appHeaderSource, /data-testid="header-account-section-transition"/);
  assert.match(appHeaderSource, /`Loading \$\{targetSection\}\.\.\.`/);
  assert.match(appHeaderSource, /<LoadingSpinner size=\{14\}/);
  assert.match(appHeaderSource, /<AccountSectionTabs \/>[\s\S]*<AccountSectionTransitionStatus \/>/);
  assert.match(transitionStoreSource, /useSyncExternalStore/);
  assert.match(transitionStoreSource, /setAccountSectionTransitionSnapshot/);
  assert.match(transitionStoreSource, /targetSection === "real" \|\| next\.targetSection === "shadow"/);
});

test("compact platform header stays flat and exposes line usage", () => {
  const shellSource = readFileSync(
    new URL("./PlatformShell.jsx", import.meta.url),
    "utf8",
  );
  const appHeaderSource = readFileSync(
    new URL("./AppHeader.jsx", import.meta.url),
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
  const runtimeControlHookSource = readFileSync(
    new URL("./useRuntimeControlSnapshot.js", import.meta.url),
    "utf8",
  );
  const broadcastSource = readFileSync(
    new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
    "utf8",
  );

  const navBlock = appHeaderSource.match(
    /data-testid="platform-screen-nav"[\s\S]*?<HeaderKpiStripComponent/,
  )?.[0] ?? "";
  const controlsBlock = appHeaderSource.match(
    /data-testid="platform-header-controls"[\s\S]*?<HeaderAccountStripComponent/,
  )?.[0] ?? "";
  const kpiSurfaceBlock = kpiSource.match(
    /data-testid="platform-header-kpis"[\s\S]*?items\.map/,
  )?.[0] ?? "";

  assert.match(shellSource, /useElementSize/);
  assert.match(shellSource, /const \[headerRef, headerSize\] = useElementSize\(\)/);
  assert.match(shellSource, /const headerEffectiveWidth = headerSize\.width \|\| headerWidth/);
  assert.match(shellSource, /"minmax\(0, max-content\) minmax\(0, max-content\) minmax\(0, 1fr\) minmax\(0, max-content\)"/);
  assert.doesNotMatch(shellSource, /headerShowKpis \? "minmax/);
  assert.match(appHeaderSource, /justifyContent:\s*"stretch"/);
  assert.match(shellSource, /headerUltraTight/);
  assert.match(shellSource, /const headerCompactStatus =/);
  assert.match(shellSource, /const headerShowKpis = !isPhone/);
  assert.doesNotMatch(shellSource, /const headerKpiMaxItems =/);
  assert.match(shellSource, /const headerAccountMinimal =/);
  assert.match(appHeaderSource, /minimal=\{headerAccountMinimal\}/);
  assert.match(appHeaderSource, /headerShowKpis \? \(/);
  assert.match(appHeaderSource, /const headerKpiFeedSymbols =/);
  assert.match(appHeaderSource, /symbols=\{headerKpiFeedSymbols\}/);
  assert.doesNotMatch(appHeaderSource, /maxItems=\{headerKpiMaxItems\}/);
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
  assert.match(kpiSurfaceBlock, /width:\s*"100%"/);
  assert.match(kpiSurfaceBlock, /maxWidth:\s*"100%"/);
  assert.match(kpiSurfaceBlock, /overflowX:\s*"auto"/);
  assert.match(kpiSource, /maxItems = null/);
  assert.match(kpiSource, /const resolvedConfig = normalizeKpiConfig\(symbols\)/);
  assert.match(kpiSource, /resolvedConfig\.slice\(0, Math\.max\(1, maxItems\)\)/);
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
  const lineUsageIndex = statusSource.indexOf(
    'data-testid="header-ibkr-line-usage"',
  );
  const lineUsageSnippet = statusSource.slice(
    Math.max(0, lineUsageIndex - 500),
    lineUsageIndex + 700,
  );
  assert.match(lineUsageSnippet, /aria-label=\{`Market data lines \$\{lineDisplayValue\}`\}/);
  assert.match(lineUsageSnippet, /title=\{`Market data lines \$\{lineDisplayValue\}`\}/);
  assert.doesNotMatch(lineUsageSnippet, /<AppTooltip/);
  assert.match(runtimeControlHookSource, /useRef/);
  assert.match(runtimeControlHookSource, /lineUsageRequestRef/);
  assert.match(runtimeControlHookSource, /if \(lineUsageRequestRef\.current\)/);
  assert.match(runtimeControlHookSource, /return lineUsageRequestRef\.current/);
  assert.match(statusSource, /<IbkrPingWavelength connection=\{connection\}/);
  assert.doesNotMatch(statusSource, /compressed \? null : \(\s*<IbkrPingWavelength/);
  assert.doesNotMatch(statusSource, />\s*\{marketClock\.timeLabel\}\s*<\/span>/);
  assert.doesNotMatch(statusSource, />Market<\/span>/);
  assert.match(broadcastSource, /overflowX:\s*"hidden"/);
  assert.match(broadcastSource, /data-header-lane-status-glyph/);
  assert.match(broadcastSource, /dataTestId="header-signal-scan-wave"/);
  assert.match(broadcastSource, /dataTestId="header-unusual-broad-wave"/);
  assert.match(broadcastSource, /dataTestId="header-algo-wave"/);
  assert.match(broadcastSource, /streamStateTokenVar\(state\)/);
  assert.match(broadcastSource, /const signalWaveStatus =/);
  assert.match(broadcastSource, /const flowWaveStatus =/);
  assert.match(broadcastSource, /const algoWaveStatus = !enabled \? "checking" : onAlgoAction \? "healthy" : "no-subscribers"/);
  assert.match(broadcastSource, /status=\{signalWaveStatus\}/);
  assert.match(broadcastSource, /status=\{flowWaveStatus\}/);
  assert.match(broadcastSource, /status=\{algoWaveStatus\}/);
  assert.doesNotMatch(broadcastSource, /active=\{algoItems\.length > 0\}/);
  assert.doesNotMatch(broadcastSource, /data-testid="header-signal-scan-toggle"/);
  assert.doesNotMatch(broadcastSource, /data-testid="header-unusual-broad-toggle"/);
  assert.doesNotMatch(broadcastSource, /data-testid="header-algo-open"/);
});

test("Algo monitor is frame-owned and replaces the activity sidebar feed", () => {
  const appSource = readFileSync(
    new URL("./PlatformApp.jsx", import.meta.url),
    "utf8",
  );
  const shellSource = readFileSync(
    new URL("./PlatformShell.jsx", import.meta.url),
    "utf8",
  );
  const retiredActivitySidebarPath = new URL("./PlatformActivitySidebar.jsx", import.meta.url);
  const algoMonitorSource = readFileSync(
    new URL("./PlatformAlgoMonitorSidebar.jsx", import.meta.url),
    "utf8",
  );
  const algoLiveSource = readFileSync(
    new URL("../../screens/algo/AlgoLivePage.jsx", import.meta.url),
    "utf8",
  );
  const algoOperationsPrimitivesSource = readFileSync(
    new URL("../../screens/algo/AlgoOperationsPrimitives.jsx", import.meta.url),
    "utf8",
  );
  const marketActivitySource = readFileSync(
    new URL("../market/MarketActivityPanel.jsx", import.meta.url),
    "utf8",
  );
  const marketSource = readFileSync(
    new URL("../../screens/MarketScreen.jsx", import.meta.url),
    "utf8",
  );
  const settingsSource = readFileSync(
    new URL("../../screens/SettingsScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(marketSource, /responsiveFlags\(marketWorkspaceWidth \|\| viewportSize\.width\)/);
  assert.match(appSource, /const ACTIVITY_SIDEBAR_WIDTH_DEFAULT = 220;/);
  assert.match(appSource, /const ACTIVITY_SIDEBAR_WIDTH_MIN = 196;/);
  assert.match(appSource, /const ACTIVITY_SIDEBAR_WIDTH_MAX = 320;/);
  assert.match(shellSource, /const ACTIVITY_SIDEBAR_WIDTH_DEFAULT = 220;/);
  assert.match(shellSource, /const ACTIVITY_SIDEBAR_WIDTH_MIN = 196;/);
  assert.match(shellSource, /const ACTIVITY_SIDEBAR_WIDTH_MAX = 320;/);
  assert.match(shellSource, /testId="platform-activity-sidebar"/);
  assert.match(shellSource, /label="algo monitor sidebar"/);
  assert.match(shellSource, /<PlatformAlgoMonitorSidebar/);
  assert.match(shellSource, /dataEnabled=\{algoFrameRuntimeEnabled\}/);
  assert.match(shellSource, /signalMatrixStates=\{signalMatrixStates\}/);
  assert.match(shellSource, /externalStreamFreshness=\{/);
  assert.match(shellSource, /const algoFrameRuntimeEnabled = Boolean/);
  assert.match(shellSource, /activitySidebarCollapsed/);
  assert.match(shellSource, /activitySidebarWidth/);
  assert.match(appSource, /const frameAuxiliaryDataEnabled = Boolean/);
  assert.match(appSource, /const activeScreenFrameReady = Boolean/);
  const frameAuxiliaryDataEnabledBlock =
    appSource.match(/const frameAuxiliaryDataEnabled = Boolean\([\s\S]*?\n  \);/)?.[0] ??
    "";
  assert.match(frameAuxiliaryDataEnabledBlock, /activeScreenFrameReady/);
  assert.doesNotMatch(frameAuxiliaryDataEnabledBlock, /activeScreenBackgroundDataAllowed/);
  assert.match(appSource, /frameAuxiliaryDataEnabled=\{frameAuxiliaryDataEnabled\}/);
  assert.equal(existsSync(retiredActivitySidebarPath), false);
  assert.match(algoMonitorSource, /useListAlgoDeployments/);
  assert.match(algoMonitorSource, /useGetAlgoDeploymentCockpit/);
  assert.match(algoMonitorSource, /useGetSignalOptionsAutomationState/);
  assert.match(algoMonitorSource, /useGetSignalOptionsPerformance/);
  assert.match(algoMonitorSource, /buildSignalMatrixBySymbol\(signalMatrixStates\)/);
  assert.match(
    algoMonitorSource,
    /enabled:\s*Boolean\(queryEnabled && deploymentId && streamFreshness\.algoFullFresh\)/,
  );
  assert.match(algoMonitorSource, /useGetAccountPositions/);
  assert.match(algoMonitorSource, /useListExecutionEvents/);
  assert.match(algoMonitorSource, /useAlgoCockpitStream/);
  assert.match(algoMonitorSource, /dataEnabled = isVisible/);
  assert.match(algoMonitorSource, /externalStreamFreshness = null/);
  assert.match(algoMonitorSource, /const queryEnabled = Boolean\(isVisible && dataEnabled\)/);
  assert.match(algoMonitorSource, /!externalStreamFreshness/);
  assert.match(algoMonitorSource, /CompactMetric/);
  assert.match(algoMonitorSource, /OpsSummaryBand/);
  assert.match(algoMonitorSource, /IntakeMiniFunnel/);
  assert.match(algoMonitorSource, /algo-monitor-ops-summary/);
  assert.match(algoMonitorSource, /algo-monitor-intake-funnel/);
  assert.match(algoMonitorSource, /algo-monitor-exposure-footer/);
  assert.match(algoMonitorSource, /scan_universe:\s*"Universe"/);
  assert.match(algoMonitorSource, /signal_detected:\s*"Triggers"/);
  assert.match(algoMonitorSource, /OperationsAttentionStrip/);
  assert.match(algoMonitorSource, /OperationsStatusOrb/);
  assert.match(algoMonitorSource, /Signals\s+→\s+Actions/);
  assert.match(algoMonitorSource, /BigDirectionGlyph/);
  assert.match(algoMonitorSource, /StrategyTag/);
  assert.match(algoMonitorSource, /SignalDots/);
  assert.match(algoMonitorSource, /VerdictGlyph/);
  assert.match(algoMonitorSource, /rowActivityTimestampMs/);
  assert.match(algoMonitorSource, /setAlgoFocus\(symbol,\s*"action"\)/);
  assert.match(shellSource, /onOpenAlgo=\{\(focus\) => handleSetScreen\("algo", focus\)\}/);
  assert.match(shellSource, /onOpenAlgo=\{\(focus\) => \{\s*setMobileActivityOpen\(false\);\s*handleSetScreen\("algo", focus\);/);
  assert.match(algoMonitorSource, /boxShadow:\s*`inset 3px 0 0 \$\{direction\.tone\}`/);
  assert.match(algoMonitorSource, /gridTemplateColumns:\s*"minmax\(0, 1fr\) auto"/);
  assert.doesNotMatch(algoMonitorSource, /OperationsTransitionsStrip/);
  assert.match(algoLiveSource, /AlgoOverviewMetric as OverviewMetric/);
  assert.match(algoLiveSource, /AlgoPipelineOverview as PipelineOverview/);
  assert.match(algoOperationsPrimitivesSource, /export const AlgoOverviewMetric/);
  assert.match(algoOperationsPrimitivesSource, /export const AlgoPipelineOverview/);
  assert.match(algoOperationsPrimitivesSource, /labelOverrides\?\.\[stage\?\.id\]/);
  assert.match(algoMonitorSource, /pickDeployment\(deployments,\s*mode\)/);
  assert.match(algoMonitorSource, /useListAlgoDeployments\(\s*undefined,/);
  assert.match(algoMonitorSource, /deployments\.find\(\(deployment\) => deployment\.enabled\)/);
  assert.doesNotMatch(algoMonitorSource, /const MetricTile/);
  assert.doesNotMatch(algoMonitorSource, /const PipelineRow/);
  assert.doesNotMatch(algoMonitorSource, /const AttentionRow/);
  assert.doesNotMatch(algoMonitorSource, /const EventRow/);
  assert.doesNotMatch(algoMonitorSource, /useSignalMonitorSnapshot/);
  assert.doesNotMatch(algoMonitorSource, /useMarketAlertsSnapshot/);
  assert.doesNotMatch(algoMonitorSource, /useMarketFlowSnapshotForStoreKey/);
  assert.doesNotMatch(algoMonitorSource, /useGetNews/);
  assert.doesNotMatch(algoMonitorSource, /useGetResearchEarningsCalendar/);
  assert.doesNotMatch(algoMonitorSource, /MarketActivityPanel/);
  assert.match(marketActivitySource, /compactFrame = false/);
  assert.match(marketActivitySource, /stackLanes = false/);
  assert.match(marketActivitySource, /gridTemplateColumns: compactFrame[\s\S]*"auto minmax\(0, 1fr\)"[\s\S]*"auto auto minmax\(0, 1fr\) auto"/);
  assert.match(marketActivitySource, /gridTemplateColumns: stackLanes[\s\S]*"minmax\(0, 1fr\)"[\s\S]*"minmax\(0, 1fr\) minmax\(0, 1fr\)"/);
  assert.match(settingsSource, /label="Algo Monitor Width"[\s\S]*min=\{196\}[\s\S]*max=\{320\}/);
  assert.match(settingsSource, /label="Algo monitor sidebar"/);
  assert.doesNotMatch(marketSource, /market-activity-panel/);
  assert.doesNotMatch(marketSource, /market-activity-resize-separator/);
  assert.doesNotMatch(marketSource, /MarketActivityPanelContainer/);
  assert.doesNotMatch(marketSource, /marketActivityPanelWidth/);
});

test("Algo monitor sidebar waits for frame data enablement before querying", () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const html = renderToString(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(PlatformAlgoMonitorSidebar, {
          isVisible: true,
          dataEnabled: false,
          environment: "paper",
        }),
      ),
    ),
  );

  assert.match(html, /data-testid="platform-algo-monitor-card"/);
  assert.match(html, /Algo Monitor/);
  assert.match(html, /Algo monitor idle/);
  assert.match(html, /Open Algo Monitor when you need deployment, signal, or position context\./);
  assert.doesNotMatch(html, /Waiting for the active section to finish first paint\./);
  assert.doesNotMatch(html, /No algo deployment/);
});

test("screen hosts expose semantic headings and contextual route shells", () => {
  const shellSource = readFileSync(
    new URL("./PlatformShell.jsx", import.meta.url),
    "utf8",
  );
  const registrySource = readFileSync(
    new URL("./screenRegistry.jsx", import.meta.url),
    "utf8",
  );

  assert.match(shellSource, /<h1 id=\{screenHeadingId\} style=\{screenHeadingStyle\}>/);
  assert.match(shellSource, /aria-labelledby=\{active \? screenHeadingId : undefined\}/);
  assert.match(shellSource, /SCREENS\.map\(\(\{ id, label \}\) =>/);
  assert.match(shellSource, /screenLabel=\{label\}/);
  assert.doesNotMatch(registrySource, /<h1/);
  [
    "market",
    "signals",
    "flow",
    "gex",
    "trade",
    "account",
    "research",
    "algo",
    "backtest",
    "diagnostics",
    "settings",
  ].forEach((screenId) => {
    assert.match(registrySource, new RegExp(`${screenId}:\\s*\\{`));
  });
});

test("Algo monitor sidebar falls back to an enabled deployment across modes", () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  queryClient.setQueryData(["/api/algo/deployments"], {
    deployments: [
      {
        id: "live-disabled",
        name: "Live disabled",
        mode: "live",
        enabled: false,
        providerAccountId: "U123",
      },
      {
        id: "paper-enabled",
        name: "Paper shadow algo",
        mode: "paper",
        enabled: true,
        providerAccountId: "shadow",
      },
    ],
  });
  queryClient.setQueryData(["/api/algo/deployments/paper-enabled/cockpit"], {
    kpis: {},
    risk: {},
    readiness: { ready: true },
    pipelineStages: [],
    attentionItems: [],
  });

  const html = renderToString(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(PlatformAlgoMonitorSidebar, {
          isVisible: true,
          dataEnabled: true,
          environment: "live",
          externalStreamFreshness: {
            algoCriticalFresh: true,
            algoFullFresh: true,
          },
        }),
      ),
    ),
  );

  assert.match(html, /Paper shadow algo/);
  assert.match(html, /data-status="healthy"/);
  assert.match(html, /PAPER/);
  assert.doesNotMatch(html, /No algo deployment/);
});

test("Algo monitor sidebar renders signals to actions candidates", () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  queryClient.setQueryData(["/api/algo/deployments"], {
    deployments: [
      {
        id: "paper-enabled",
        name: "Paper shadow algo",
        mode: "paper",
        enabled: true,
        providerAccountId: "shadow",
      },
    ],
  });
  queryClient.setQueryData(["/api/algo/deployments/paper-enabled/cockpit"], {
    kpis: { candidates: 2 },
    risk: {},
    readiness: { ready: true },
    pipelineStages: [],
    attentionItems: [],
  });
  queryClient.setQueryData(
    ["/api/algo/deployments/paper-enabled/signal-options/state"],
    {
      activePositions: [],
      events: [],
      candidates: [
        {
          id: "amd-old",
          signalKey: "amd-buy",
          symbol: "AMD",
          signal: {
            signalKey: "amd-buy",
            symbol: "AMD",
            direction: "buy",
            signalAt: "2026-05-23T22:00:00.000Z",
          },
          optionAction: "buy_call",
          actionStatus: "shadow_filled",
          selectedContract: {
            underlying: "AMD",
            expirationDate: "2026-06-19",
            strike: 160,
            right: "call",
          },
          orderPlan: {
            premiumAtRisk: 240,
            liquidity: { spreadPctOfMid: 12 },
          },
        },
        {
          id: "nvda-new",
          signalKey: "nvda-sell",
          symbol: "NVDA",
          signal: {
            signalKey: "nvda-sell",
            symbol: "NVDA",
            direction: "sell",
            signalAt: "2026-05-23T22:05:00.000Z",
          },
          optionAction: "buy_put",
          actionStatus: "blocked",
          selectedContract: {
            underlying: "NVDA",
            expirationDate: "2026-06-19",
            strike: 900,
            right: "put",
          },
          orderPlan: {
            premiumAtRisk: 510,
            liquidity: { spreadPctOfMid: 0.18 },
          },
        },
      ],
    },
  );

  const html = renderToString(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(PlatformAlgoMonitorSidebar, {
          isVisible: true,
          dataEnabled: true,
          environment: "paper",
          signalMatrixStates: [
            {
              symbol: "NVDA",
              timeframe: "2m",
              currentSignalDirection: "sell",
              barsSinceSignal: 1,
              fresh: true,
              status: "ok",
            },
          ],
          externalStreamFreshness: {
            algoCriticalFresh: true,
            algoFullFresh: true,
          },
        }),
      ),
    ),
  );

  assert.match(html, /Signals\s+→\s+Actions/);
  assert.ok(html.indexOf("Signals → Actions") < html.indexOf("Paper shadow algo"));
  assert.match(html, /data-testid="algo-monitor-signal-action-row"/);
  assert.match(html, /NVDA/);
  assert.match(html, /BUY PUT/);
  assert.match(
    html,
    /data-testid="watchlist-signal-dot-2m"[^>]*data-timeframe="2m"[^>]*data-direction="sell"/,
  );
  assert.match(html, /Blocked/);
  assert.match(html, /AMD/);
  assert.match(html, /BUY CALL/);
  assert.match(html, /Shadow Filled/);
  assert.match(html, /\$240 risk/);
  assert.match(html, /12% spread/);
  assert.ok(html.indexOf("NVDA") < html.indexOf("AMD"));
});

test("Algo monitor sidebar matches Algo page signal rows before stale candidates", () => {
  const rows = buildAlgoMonitorSignalActionRows({
    signals: [
      {
        signalKey: "spy-buy",
        symbol: "SPY",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-05-23T22:05:00.000Z",
      },
      {
        signalKey: "qqq-sell",
        symbol: "QQQ",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-05-23T22:00:00.000Z",
      },
    ],
    candidates: [
      {
        id: "tsla-unmatched",
        symbol: "TSLA",
        direction: "buy",
        signalAt: "2026-05-23T22:10:00.000Z",
      },
      {
        id: "qqq-candidate",
        signalKey: "qqq-sell",
        symbol: "QQQ",
        timeframe: "5m",
        direction: "sell",
      },
      {
        id: "spy-candidate",
        signal: { signalKey: "spy-buy" },
        selectedContract: { underlying: "SPY" },
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => [row.signal.symbol, row.candidate.id || null]),
    [
      ["SPY", "spy-candidate"],
      ["QQQ", "qqq-candidate"],
    ],
  );
});

test("Algo monitor sidebar prefers cockpit signals to stale automation state rows", () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  queryClient.setQueryData(["/api/algo/deployments"], {
    deployments: [
      {
        id: "paper-enabled",
        name: "Paper shadow algo",
        mode: "paper",
        enabled: true,
        providerAccountId: "shadow",
      },
    ],
  });
  queryClient.setQueryData(["/api/algo/deployments/paper-enabled/cockpit"], {
    kpis: { candidates: 1 },
    risk: {},
    readiness: { ready: true },
    pipelineStages: [],
    attentionItems: [],
    signals: [
      {
        signalKey: "spy-buy",
        symbol: "SPY",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-05-23T22:00:00.000Z",
      },
    ],
    candidates: [
      {
        id: "spy-live",
        signalKey: "spy-buy",
        symbol: "SPY",
        timeframe: "5m",
        direction: "buy",
        optionAction: "buy_call",
        actionStatus: "shadow_filled",
      },
    ],
  });
  queryClient.setQueryData(
    ["/api/algo/deployments/paper-enabled/signal-options/state"],
    {
      activePositions: [],
      events: [],
      signals: [
        {
          signalKey: "tsla-stale",
          symbol: "TSLA",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-05-23T22:10:00.000Z",
        },
      ],
      candidates: [
        {
          id: "tsla-stale",
          signalKey: "tsla-stale",
          symbol: "TSLA",
          timeframe: "5m",
          direction: "sell",
          optionAction: "buy_put",
          actionStatus: "blocked",
        },
      ],
    },
  );

  const html = renderToString(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(PlatformAlgoMonitorSidebar, {
          isVisible: true,
          dataEnabled: true,
          environment: "paper",
          externalStreamFreshness: {
            algoCriticalFresh: true,
            algoFullFresh: true,
          },
        }),
      ),
    ),
  );

  assert.match(html, /SPY/);
  assert.match(html, /BUY CALL/);
  assert.doesNotMatch(html, /TSLA/);
  assert.doesNotMatch(html, /BUY PUT/);
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
  assert.match(tooltipSource, /isInteractiveTooltipTrigger/);
  assert.match(tooltipSource, /hasInteractiveTooltipDescendant/);
  assert.match(tooltipSource, /hasCompositeTooltipDescendant/);
  assert.match(tooltipSource, /canUseRadixTooltipTrigger/);
  assert.match(
    tooltipSource,
    /trigger\.props\.asChild &&[\s\S]*hasInteractiveTooltipDescendant\(trigger\.props\.children\)/,
  );
  assert.match(tooltipSource, /!canUseRadixTooltipTrigger\(trigger\)/);
  assert.match(tooltipSource, /<TooltipTrigger asChild>\{touchTrigger\}<\/TooltipTrigger>/);
  assert.match(tooltipSource, /event\.pointerType !== "touch"/);
  assert.match(tooltipSource, /setOpen\(true\)/);
});

test("Account phone layout keeps dense trading tables horizontally scrollable", () => {
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
  assert.match(accountSource, /<LazyPositionsPanel[\s\S]*isPhone=\{accountIsPhone\}/);
  assert.match(accountSource, /<LazyTradingAnalysisWorkbench[\s\S]*isPhone=\{accountIsPhone\}/);
  assert.match(accountSource, /<LazyOrdersPanel[\s\S]*isPhone=\{accountIsPhone\}/);
  assert.match(positionsSource, /data-testid="account-positions-table-scroll"/);
  assert.match(positionsSource, /ra-dense-table-scroll/);
  assert.doesNotMatch(positionsSource, /data-testid="account-positions-row-list"/);
  assert.match(tradesOrdersSource, /data-testid="account-orders-table-scroll"/);
  assert.match(tradesOrdersSource, /ra-dense-table-scroll/);
  assert.doesNotMatch(tradesOrdersSource, /data-testid="account-orders-row-list"/);
  assert.match(workbenchSource, /dataTestId="account-analysis-trade-row"/);
  assert.match(workbenchSource, /isPhone \?/);
});

test("Account panels defer below-fold content and memoize mobile rows", () => {
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

  assert.match(deferredRenderSource, /IntersectionObserver/);
  assert.doesNotMatch(deferredRenderSource, /contentVisibility/);
  assert.match(deferredRenderSource, /data-deferred-render=\{activated \? "mounted" : "pending"\}/);
  assert.match(deferredRenderSource, /ra-deferred-render__placeholder/);
  assert.match(deferredRenderSource, /ra-deferred-render__skeleton ra-skeleton-shimmer/);
  assert.match(deferredRenderSource, /rootMargin/);
  assert.match(deferredRenderSource, /requestIdleCallback/);
  assert.match(deferredRenderSource, /DEFAULT_IDLE_DELAY_MS = 2_500/);
  assert.match(deferredRenderSource, /const scheduleIdleActivation = useCallback/);
  assert.match(deferredRenderSource, /const cancelIdleActivation = scheduleIdleActivation\(\)/);
  assert.match(deferredRenderSource, /onActivateRef\.current\?\.\(\)/);
  assert.doesNotMatch(deferredRenderSource, /data-deferred-render="mounted"/);
  assert.match(accountSource, /const AccountPanelSuspenseFallback = /);
  assert.match(
    accountSource,
    /fallback=\{[\s\S]*<AccountPanelSuspenseFallback[\s\S]*detail=\{detail\}[\s\S]*minHeight=\{minHeight\}[\s\S]*title=\{title\}[\s\S]*\/>[\s\S]*\}/,
  );
  assert.match(accountSource, /const LazyAccountHeroBlock = lazy/);
  assert.match(accountSource, /const LazyAccountReturnsPanel = lazy/);
  assert.match(
    accountSource,
    /<DeferredPanelSuspense[\s\S]*minHeight=\{accountIsPhone \? 174 : 246\}[\s\S]*title="Loading exposure"[\s\S]*detail="Preparing allocation and risk charts\."/,
  );
  assert.match(
    accountSource,
    /<DeferredPanelSuspense[\s\S]*minHeight=\{accountIsPhone \? 280 : 314\}[\s\S]*title="Loading equity curve"[\s\S]*detail="Preparing account chart and date inspector\."/,
  );
  assert.match(accountSource, /<DeferredRender[\s\S]*account-deferred-positions/);
  assert.match(accountSource, /<DeferredRender[\s\S]*onActivate=\{\(\) => markAccountPanelActivated\("tradingAnalysis"\)\}[\s\S]*account-deferred-trading-analysis/);
  assert.match(accountSource, /<DeferredRender[\s\S]*onActivate=\{\(\) => markAccountPanelActivated\("orders"\)\}[\s\S]*account-deferred-orders/);
  assert.match(accountSource, /const LazyTradingAnalysisWorkbench = lazy/);
  assert.match(accountSource, /const LazyOrdersPanel = lazy/);
  assert.match(accountSource, /const LazyTodaySnapshotPanel = lazy/);
  assert.match(accountSource, /const LazyPortfolioExposurePanel = lazy/);
  assert.match(accountSource, /const LazyEquityCurvePanel = lazy/);
  assert.match(accountSource, /const LazyPositionsPanel = lazy/);
  assert.doesNotMatch(accountSource, /import AccountHeroBlock from "\.\/account\/AccountHeroBlock"/);
  assert.doesNotMatch(accountSource, /import AccountReturnsPanel from "\.\/account\/AccountReturnsPanel"/);
  assert.match(accountSource, /from "\.\/account\/tradingAnalysisFilters"/);
  assert.doesNotMatch(accountSource, /from "\.\/account\/tradingAnalysisModel"/);
  assert.doesNotMatch(accountSource, /buildAccountTradingAnalysisModel/);
  assert.match(workbenchSource, /buildAccountTradingAnalysisModel/);
  assert.match(cssSource, /--ra-color-pnl-positive/);
  assert.match(positionsSource, /data-testid="account-positions-table-scroll"/);
  assert.doesNotMatch(positionsSource, /const MobilePositionRow = memo/);
  assert.doesNotMatch(positionsSource, /onRowAction=\{handleMobileRowAction\}/);
  assert.match(tradesOrdersSource, /data-testid="account-orders-table-scroll"/);
  assert.doesNotMatch(tradesOrdersSource, /const MobileOrderRow = memo/);
  assert.match(workbenchSource, /TableExpandableRow/);
  assert.doesNotMatch(tradesOrdersSource, /onRowAction=\{handleOrderRowAction\}/);
  assert.match(cssSource, /ra-dense-table-scroll \*/);
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
  assert.match(source, /providerSummaryHasMarketSessionQuiet/);
  assert.match(source, /!flowScannerSessionQuiet/);
  assert.match(source, /Regular options flow is quiet outside the active market session/);
  assert.match(
    source,
    /flowQuality\?\.label === "Degraded"[\s\S]*(\? "Degraded"|return "Degraded")/,
  );
  assert.doesNotMatch(source, /flowStatus === "loading"[\s\S]*: "Degraded";/);
  assert.doesNotMatch(source, /virtual"\} rows/);
  assert.match(source, /buildFlowTideFromEvents\(filtered\)/);
  assert.match(source, /buildTickerFlowFromEvents\(filtered/);
  assert.match(source, /buildMarketOrderFlowFromEvents\(filtered\)/);
  assert.doesNotMatch(source, /flowUnusualSideFilter/);
  assert.doesNotMatch(source, /unusualSideFilter/);
  assert.doesNotMatch(source, /flow-unusual-scanner-status-panel/);
});

test("Flow page premium distribution widgets use Massive summary endpoint", () => {
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
  assert.match(headerSource, /providerSummaryHasMarketSessionQuiet/);
  assert.match(headerSource, /!flowSessionQuiet/);
  assert.doesNotMatch(headerSource, /broadScanEnabled\s*\?\s*"loading"/);
  assert.match(
    headerSource,
    /const flowScanTone = flowScanHasError[\s\S]*flowScanDegraded[\s\S]*\? CSS_COLOR\.amber[\s\S]*flowScanBusy[\s\S]*\? CSS_COLOR\.accent/,
  );
  assert.match(
    headerSource,
    /const signalScanTone = signalHasError[\s\S]*signalBusy[\s\S]*\? CSS_COLOR\.accent/,
  );
  assert.match(
    headerSource,
    /label="Flow"[\s\S]*flowHasError[\s\S]*\? CSS_COLOR\.red[\s\S]*flowDegraded[\s\S]*\? CSS_COLOR\.amber[\s\S]*flowStatus === "loading"[\s\S]*\? CSS_COLOR\.accent/,
  );
  assert.doesNotMatch(headerSource, /flowScanBusy\s*\n\s*\? CSS_COLOR\.amber/);
  assert.doesNotMatch(headerSource, /waiting for app runtime/);
  assert.doesNotMatch(headerSource, /waiting for app visibility/);
  assert.doesNotMatch(
    schedulerSource,
    /marketScreenActive/,
    "Chart and broad scanner runtimes should own flow to avoid a second all-flow path",
  );
  assert.doesNotMatch(schedulerSource, /flowScreenActive/);
});

test("signal monitor symbols only join quote stream fanout as bounded recent pins", () => {
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
  assert.match(source, /const RECENT_SIGNAL_QUOTE_PIN_LIMIT = 4;/);
  assert.match(source, /resolveRecentSignalMarketDataSymbols\(signalMonitorStates\)/);
  assert.match(source, /recentSignalMarketDataSymbols/);
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
    "quote streams should use bounded rotation rather than raw full watchlist subscription",
  );
  assert.match(source, /buildWatchlistQuoteRotationBatch/);
  assert.match(source, /WATCHLIST_QUOTE_STREAM_BATCH_SIZE/);
  assert.doesNotMatch(
    source,
    /pressure-stalled/,
    "quote streaming should not be gated by unrelated broad IBKR work pressure",
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
  const quoteStreamPinnedBlock = source.match(
    /const quoteStreamPinnedSymbols = useMemo\([\s\S]*?\n  \);/,
  )?.[0];

  assert.match(source, /const OPEN_POSITION_MARKET_DATA_LIMIT = 16;/);
  assert.match(source, /const resolveOpenPositionMarketDataSymbol/);
  assert.match(source, /position\?\.marketDataSymbol/);
  assert.match(source, /position\?\.optionContract\?\.underlying/);
  assert.match(source, /openPositionMarketDataWeight\(right\)/);
  assert.match(source, /symbols\.length >= OPEN_POSITION_MARKET_DATA_LIMIT/);
  assert.match(runtimeSymbolBlock ?? "", /quoteSymbols, \.\.\.openPositionMarketDataSymbols/);
  assert.match(runtimeSymbolBlock ?? "", /sparklineSymbols, \.\.\.openPositionMarketDataSymbols/);
  assert.match(runtimeSymbolBlock ?? "", /\[\.\.\.new Set\(streamedQuoteSymbols\)\]/);
  assert.doesNotMatch(
    runtimeSymbolBlock ?? "",
    /streamedAggregateSymbols, \.\.\.openPositionMarketDataSymbols/,
  );
  assert.doesNotMatch(
    quoteStreamPinnedBlock ?? "",
    /openPositionMarketDataSymbols/,
    "position underlyings should not consume the default IBKR watchlist quote stream",
  );
  assert.match(quoteStreamPinnedBlock ?? "", /recentSignalMarketDataSymbols/);
  assert.match(prioritySparklineBlock ?? "", /visibleWatchlistMarketDataSymbols/);
  assert.match(prioritySparklineBlock ?? "", /openPositionMarketDataSymbols/);
  assert.match(source, /prioritySparklineSymbols=\{safeQaMode \? \[\] : prioritySparklineSymbols\}/);
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
  const matrixSymbolSetsBlock = source.match(
    /const signalMatrixSymbolSets = useMemo\([\s\S]*?\n  \);/,
  )?.[0];
  const routerSource = readFileSync(
    new URL("./PlatformScreenRouter.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /SIGNAL_MONITOR_DISPLAY_POLL_MS\s*=\s*15_000/);
  assert.match(source, /const signalMonitorDisplayPollMs = Math\.min\(/);
  assert.match(source, /const signalMonitorRuntimePollMs = Math\.max/);
  assert.match(source, /SIGNAL_MATRIX_TIMEFRAMES\s*=\s*\["1m", "2m", "5m", "15m", "1h"\]/);
  assert.doesNotMatch(source, /SIGNAL_MATRIX_AUTOMATIC_TIMEFRAMES/);
  assert.match(source, /const signalMonitorDisplayReady = Boolean/);
  assert.match(displayReadyBlock ?? "", /firstScreenReady/);
  assert.doesNotMatch(displayReadyBlock ?? "", /backgroundResumeReady/);
  assert.match(eventsReadyBlock ?? "", /backgroundResumeReady\.signalDisplay/);
  assert.match(source, /buildSignalMatrixRequestPlan/);
  assert.match(source, /const normalizeSignalMatrixRequestTimeframes =/);
  assert.match(source, /signalMatrixStatesEqual/);
  assert.match(source, /const EMPTY_SIGNAL_MONITOR_STATES = Object\.freeze\(\[\]\)/);
  assert.match(source, /signalMonitorStateQuery\.data\?\.states \|\| EMPTY_SIGNAL_MONITOR_STATES/);
  assert.match(source, /signalMonitorEventsQuery\.data\?\.events \|\| EMPTY_SIGNAL_MONITOR_EVENTS/);
  assert.match(source, /signalMonitorProfile=\{signalMonitorProfile\}/);
  assert.match(source, /signalMonitorEvents=\{signalMonitorEvents\}/);
  assert.match(source, /const signalMonitorStateUniverseSymbols =\s*Array\.isArray\(signalMonitorStateQuery\.data\?\.universeSymbols\)/);
  assert.match(source, /const signalMonitorDisplaySymbols = useMemo/);
  assert.match(source, /buildHeaderSignalContextSymbols/);
  assert.match(source, /const headerSignalContextSymbols = useMemo/);
  assert.match(
    source,
    /\.\.\.signalMonitorStateUniverseSymbols\.map[\s\S]*\.\.\.headerSignalContextSymbols,\s*\.\.\.signalMonitorStates\.map/,
  );
  assert.match(source, /useWorkspaceLeadership/);
  assert.match(source, /const platformWorkVisible = Boolean\(pageVisible && workspaceLeader && !safeQaMode\)/);
  assert.match(source, /const signalsScreenSafeWorkVisible = Boolean/);
  assert.match(source, /safeQaMode && pageVisible && workspaceLeader && screen === "signals"/);
  assert.match(source, /const signalMonitorWorkVisible = Boolean/);
  assert.match(source, /platformWorkVisible \|\| signalsScreenSafeWorkVisible/);
  assert.match(source, /signalMatrixUniverseSymbols/);
  assert.match(source, /const signalMatrixRequestActive = screen === "signals" \|\| screen === "algo"/);
  assert.match(source, /if \(signalMatrixRequestActive\) \{\s*return;\s*\}/);
  assert.match(matrixSymbolSetsBlock ?? "", /buildSignalMatrixSymbolSets/);
  assert.match(matrixSymbolSetsBlock ?? "", /visibleWatchlistSymbols:\s*visibleWatchlistMarketDataSymbols/);
  assert.match(matrixSymbolSetsBlock ?? "", /signalsScreenSymbols:\s*[\s\S]*signalsScreenMatrixSymbols/);
  assert.match(matrixSymbolSetsBlock ?? "", /signalMatrixRequestActive \? signalsScreenMatrixSymbols : \[\]/);
  assert.match(matrixSymbolSetsBlock ?? "", /signalMatrixRequestActive \? signalsScreenMatrixPrioritySymbols : \[\]/);
  assert.match(matrixSymbolSetsBlock ?? "", /openPositionSymbols:\s*openPositionMarketDataSymbols/);
  assert.match(matrixSymbolSetsBlock ?? "", /signalMonitorSymbols/);
  assert.match(matrixSymbolSetsBlock ?? "", /signalMonitorUniverseSymbols:\s*signalMonitorDisplaySymbols/);
  assert.match(matrixSymbolSetsBlock ?? "", /watchlistSymbols/);
  assert.match(matrixSymbolSetsBlock ?? "", /wideLimit:\s*signalMatrixPressureCaps\.signalMatrixWideSymbolLimit/);
  assert.match(matrixSymbolSetsBlock ?? "", /narrowLimit:\s*signalMatrixPressureCaps\.signalMatrixNarrowSymbolLimit/);
  assert.doesNotMatch(matrixSymbolSetsBlock ?? "", /allWatchlistSymbolList/);
  assert.match(source, /const resolveSignalMatrixPressureLevel = \(\{ memoryPressureLevel, server \}\) =>/);
  assert.match(source, /server\?\.effectivePressureLevel/);
  assert.match(source, /getMemoryPressureSnapshot\(\)/);
  assert.match(source, /liveSignalMatrixPressureLevel/);
  assert.match(source, /liveSignalMatrixRequestTaskLimit/);
  assert.match(source, /resolveSignalMatrixActiveScreenRequestTaskLimit\(\s*liveSignalMatrixPressureLevel/);
  assert.match(source, /const signalMatrixPressureCaps = useMemo/);
  assert.match(source, /signalMatrixPressureCaps\.signalMatrixPollMinMs/);
  assert.match(source, /pressureLevel:\s*signalMatrixPressureLevel/);
  assert.match(source, /resolveSignalMatrixActiveScreenRequestSymbolLimit/);
  assert.match(source, /resolveSignalMatrixActiveScreenRequestTaskLimit/);
  assert.match(source, /resolveSignalMatrixBusyQueueDelayMs/);
  assert.match(source, /resolveSignalMatrixCatchupDelayMs/);
  assert.match(source, /activeScreenRequestSymbolLimit:\s*signalMatrixActiveScreenRequestSymbolLimit/);
  assert.match(source, /activeScreenRequestTaskLimit:\s*signalMatrixActiveScreenRequestTaskLimit/);
  assert.match(source, /requestSymbolLimit:\s*signalMatrixRequestSymbolLimit/);
  assert.match(source, /requestTaskLimit:\s*signalMatrixRequestTaskLimit/);
  assert.match(source, /requestTimeframes:\s*signalMatrixRequestTimeframes/);
  assert.match(source, /busyQueueDelayMs:\s*signalMatrixBusyQueueDelayMs/);
  assert.match(source, /catchupDelayMs:\s*signalMatrixCatchupDelayMs/);
  assert.match(source, /const progressiveMatrixCatchupPending = Boolean/);
  assert.match(source, /data\?\.profile\?\.enabled === false/);
  assert.match(source, /signalMatrixQueuedEvaluationDelayMsRef\.current = Math\.max/);
  assert.match(source, /appPressureLevel:\s*memoryPressureLevel/);
  assert.match(source, /const signalMatrixUniverseSymbols = signalMatrixSymbolSets\.universeSymbols/);
  assert.match(source, /const signalMatrixPrioritySymbols = signalMatrixSymbolSets\.prioritySymbols/);
  assert.match(source, /const signalMatrixSuggestedSignalSymbols =\s*signalMatrixSymbolSets\.suggestedSignalSymbols/);
  assert.match(source, /signalMatrixBackgroundReady/);
  assert.match(source, /const signalMatrixForegroundReady =\s*signalMatrixRequestActive \|\| signalMatrixBackgroundReady/);
  assert.match(source, /const signalMatrixPriorityReady = Boolean/);
  assert.match(source, /signalMatrixForegroundReady &&/);
  assert.match(source, /const signalMatrixRuntimeReady = Boolean/);
  assert.match(source, /const SIGNAL_MATRIX_REQUEST_TIMEOUT_MS = 12_000/);
  assert.match(source, /const SIGNAL_MATRIX_REQUEST_WATCHDOG_GRACE_MS = 3_000/);
  assert.match(source, /SIGNAL_MATRIX_GLOBAL_REQUEST_COORDINATOR_KEY/);
  assert.match(source, /claimSignalMatrixRequestLease/);
  assert.match(source, /releaseSignalMatrixRequestLease/);
  assert.match(routerSource, /signalMonitorDisplaySymbols\?\.length[\s\S]*\? signalMonitorDisplaySymbols[\s\S]*: signalMonitorSymbols/);
  assert.match(source, /timeoutMs:\s*SIGNAL_MATRIX_REQUEST_TIMEOUT_MS/);
  assert.match(source, /inFlightAgeMs:/);
  assert.match(source, /globalInFlight:/);
  assert.match(source, /scheduleSignalMatrixEvaluation/);
  assert.match(source, /const signalMonitorProfileBootstrapPending = Boolean/);
  assert.match(source, /profileBootstrapPending:\s*signalMonitorProfileBootstrapPending/);
  assert.match(source, /signalMatrixEvaluationStartedAtRef\.current = Date\.now\(\)/);
  assert.match(source, /signalMatrixRunRef\.current\?\.\(\)/);
  assert.match(source, /bootstrapActive:\s*signalHydrationBootstrapActive/);
  assert.ok(
    source.indexOf("const signalHydrationBootstrapActive = Boolean") <
      source.indexOf("window.__PYRUS_SIGNAL_MATRIX_SNAPSHOT__ = snapshot"),
    "signal hydration bootstrap diagnostics must not read TDZ declarations",
  );
  assert.match(
    source,
    /if \(signalMatrixStatesEqual\(current\.states, nextStates\)\) \{[\s\S]*?return current;/,
  );
  assert.match(matrixReadyBlock ?? "", /signalMonitorDisplayReady/);
  assert.match(matrixReadyBlock ?? "", /signalMonitorWorkVisible/);
  assert.match(matrixReadyBlock ?? "", /!startupProtectionActive/);
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

test("signals screen is registered as a first-class platform route", () => {
  const preloaderSource = readFileSync(
    new URL("./screenModulePreloader.js", import.meta.url),
    "utf8",
  );
  const registrySource = readFileSync(
    new URL("./screenRegistry.jsx", import.meta.url),
    "utf8",
  );
  const routerSource = readFileSync(
    new URL("./PlatformScreenRouter.jsx", import.meta.url),
    "utf8",
  );
  const appSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const appContentSource = readFileSync(
    new URL("../../app/AppContent.tsx", import.meta.url),
    "utf8",
  );
  const appHeaderSource = readFileSync(
    new URL("./AppHeader.jsx", import.meta.url),
    "utf8",
  );
  const shellSource = readFileSync(
    new URL("./PlatformShell.jsx", import.meta.url),
    "utf8",
  );
  const signalsScreenSource = readFileSync(
    new URL("../../screens/SignalsScreen.jsx", import.meta.url),
    "utf8",
  );
  const denseVirtualTableSource = readFileSync(
    new URL("../../components/platform/DenseVirtualTable.jsx", import.meta.url),
    "utf8",
  );

  assert.match(preloaderSource, /signals:\s*\(\) => import\("\.\.\/\.\.\/screens\/SignalsScreen\.jsx"\)/);
  assert.match(registrySource, /const SignalsScreen = createPreloadableScreen\("signals", "SignalsScreen"\)/);
  assert.match(registrySource, /\{ id: "signals", label: "Signals"/);
  assert.match(registrySource, /signals:\s*\["session", "signal-profile"\]/);
  assert.match(registrySource, /export const MemoSignalsScreen = memo\(SignalsScreen/);
  assert.match(routerSource, /MemoSignalsScreen/);
  assert.match(routerSource, /case "signals":/);
  assert.match(routerSource, /onChangeMonitorFreshWindowBars=\{onChangeMonitorFreshWindowBars\}/);
  assert.match(routerSource, /onApplyPyrusSignalsSettings=\{onApplyPyrusSignalsSettings\}/);
  assert.match(routerSource, /onRequestSignalMatrixHydration=\{onRequestSignalMatrixHydration\}/);
  assert.match(appSource, /handleApplySignalMonitorPyrusSettings/);
  assert.match(appSource, /handleRequestSignalMatrixHydration/);
  assert.match(appSource, /updateSignalMonitorProfileMutation\.mutateAsync/);
  assert.match(appSource, /signalMatrixRunRef\.current\?\.\(\{ queueIfBusy: true \}\)/);
  assert.match(appSource, /timeframes:\s*normalizedTimeframes/);
  assert.match(appSource, /timeframes:\s*signalMatrixRequestTimeframes/);
  assert.match(appSource, /timeframes:\s*plan\.timeframes/);
  assert.match(appContentSource, /"signals"/);
  assert.match(appHeaderSource, /onSignalsClick=\{\(\) => handleSetScreen\("signals"\)\}/);
  assert.match(shellSource, /signals:\s*ScanLine/);
  assert.match(signalsScreenSource, /useGetSignalMonitorProfile/);
  assert.match(signalsScreenSource, /useGetSignalMonitorState/);
  assert.match(signalsScreenSource, /useListSignalMonitorEvents/);
  assert.doesNotMatch(signalsScreenSource, /evaluateSignalMonitorMatrix/);
  assert.match(signalsScreenSource, /buildSignalsMatrixHydrationPlan/);
  assert.match(signalsScreenSource, /onRequestSignalMatrixHydration/);
  assert.match(signalsScreenSource, /prioritySymbols:\s*matrixHydrationPlan\.requestSymbols/);
  assert.match(appSource, /signalMatrixRotationCursorRef\.current = 0/);
  assert.match(appSource, /requestTaskLimit:\s*signalMatrixRequestTaskLimit/);
  assert.doesNotMatch(signalsScreenSource, /mergeSignalMatrixStates/);
  assert.match(signalsScreenSource, /buildSignalsRows/);
  assert.match(signalsScreenSource, /DenseVirtualTable/);
  assert.match(signalsScreenSource, /SignalsRowDrilldown/);
  assert.match(signalsScreenSource, /useGetBars/);
  assert.match(signalsScreenSource, /SignalContextChart/);
  assert.match(signalsScreenSource, /signals-row-chart/);
  assert.match(signalsScreenSource, /signals-drilldown-price-chart/);
  assert.match(signalsScreenSource, /signals-drilldown-interval-matrix/);
  assert.match(signalsScreenSource, /signals-drilldown-gate-matrix/);
  assert.match(signalsScreenSource, /signals-drilldown-provenance/);
  assert.match(signalsScreenSource, /renderRowDetail/);
  assert.match(signalsScreenSource, /rowDetailHeight/);
  assert.match(signalsScreenSource, /aria-expanded/);
  assert.match(signalsScreenSource, /aria-controls/);
  assert.doesNotMatch(signalsScreenSource, /SignalStackChart/);
  assert.doesNotMatch(signalsScreenSource, /SignalsDetailPanel/);
  assert.doesNotMatch(signalsScreenSource, /signals-detail-panel/);
  assert.match(denseVirtualTableSource, /renderRowDetail/);
  assert.match(denseVirtualTableSource, /getRowDetailProps/);
  assert.match(denseVirtualTableSource, /rowDetailHeight/);
  assert.match(signalsScreenSource, /SIGNALS_TABLE_TIMEFRAMES\.map/);
  assert.match(signalsScreenSource, /<Star/);
  assert.match(signalsScreenSource, /watchlistLabels\.length > 0/);
  assert.match(signalsScreenSource, /settingsApplying/);
  assert.match(signalsScreenSource, /aria-label="Run signal scan"/);
});

test("algo signal-options automation uses generated API ownership path", () => {
  const algoScreenSource = readFileSync(
    new URL("../../screens/AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const algoDirPath = new URL("../../screens/algo/", import.meta.url).pathname;
  const algoComponentSources = existsSync(algoDirPath)
    ? collectSourceFiles(new URL("../../screens/algo/", import.meta.url))
        .filter((file) => !isTestSourceFile(file))
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
  assert.match(algoScreenSource, /requestIbkrReconnect/);
  assert.match(algoScreenSource, /const opened = requestIbkrReconnect\(\)/);
  assert.doesNotMatch(algoScreenSource, /\/api\/ibkr\/remote-launch/);
  assert.doesNotMatch(algoScreenSource, /autoLogin:\s*false/);
  assert.match(algoCorpus, /Signals?\s+→\s+Action|Signals?\s+-&gt;\s+Action|Signals?\s+to\s+Action/);
  assert.match(algoCorpus, /signal-options-expanded-capacity/);
  assert.match(algoCorpus, /CREATE SIGNAL-OPTIONS DEPLOYMENT/);
  assert.doesNotMatch(algoCorpus, /Setup Shadow Deployment/);
  assert.doesNotMatch(algoCorpus, /Shadow deployments paper-trade/);
  assert.doesNotMatch(algoCorpus, /Loading promoted drafts and shadow deployments/);
  assert.doesNotMatch(algoCorpus, /No promoted draft strategies/);
  assert.doesNotMatch(algoCorpus, /CREATE SHADOW DEPLOYMENT/);
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

test("screen shell warmup preloads top-level code without default hidden page mounting", () => {
  const appSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const appHeaderSource = readFileSync(new URL("./AppHeader.jsx", import.meta.url), "utf8");
  const registrySource = readFileSync(new URL("./screenRegistry.jsx", import.meta.url), "utf8");
  const screenModulePreloaderSource = readFileSync(
    new URL("./screenModulePreloader.js", import.meta.url),
    "utf8",
  );
  const routerSource = readFileSync(new URL("./PlatformScreenRouter.jsx", import.meta.url), "utf8");
  const appContentSource = readFileSync(
    new URL("../../app/AppContent.tsx", import.meta.url),
    "utf8",
  );
  const schedulerSource = readFileSync(new URL("./appWorkScheduler.js", import.meta.url), "utf8");
  const researchScreenSource = readFileSync(
    new URL("../../screens/ResearchScreen.jsx", import.meta.url),
    "utf8",
  );
  const codeWarmupEffect = appSource.match(
    /useEffect\(\(\) => \{\s*if \(\s*!screenCodePreloadReady[\s\S]*?\n  \}, \[\s*screen,\s*screenCodePreloadReady,\s*markWarmupTimeline,\s*\]\);/,
  )?.[0];
  const shellWarmMountStart = appSource.indexOf(
    "const warmMountOrder = SCREEN_SHELL_WARM_MOUNT_ORDER.filter",
  );
  const shellWarmMountEnd = appSource.indexOf(
    "  useEffect(() => {\n    if (\n      !operationalCodePreloadReady",
    shellWarmMountStart,
  );
  const shellWarmMountEffect =
    shellWarmMountStart >= 0 && shellWarmMountEnd > shellWarmMountStart
      ? appSource.slice(shellWarmMountStart, shellWarmMountEnd)
      : "";
  const researchWorkspaceCodePreloadStart = appSource.indexOf(
    "researchWorkspaceCodePreloadCompleteRef.current = true;",
  );
  const researchWorkspaceCodePreloadEnd = appSource.indexOf(
    "  useEffect(() => {\n    if (\n      !operationalCodePreloadReady",
    researchWorkspaceCodePreloadStart,
  );
  const researchWorkspaceCodePreloadEffect =
    researchWorkspaceCodePreloadStart >= 0 &&
    researchWorkspaceCodePreloadEnd > researchWorkspaceCodePreloadStart
      ? appSource.slice(researchWorkspaceCodePreloadStart, researchWorkspaceCodePreloadEnd)
      : "";
  const researchWorkspaceDataPreloadStart = appSource.indexOf(
    "researchWorkspaceDataPreloadCompleteRef.current = true;",
  );
  const researchWorkspaceDataPreloadEnd = appSource.indexOf(
    "  useEffect(() => {\n    if (\n      !sessionMetadataSettled",
    researchWorkspaceDataPreloadStart,
  );
  const researchWorkspaceDataPreloadEffect =
    researchWorkspaceDataPreloadStart >= 0 &&
    researchWorkspaceDataPreloadEnd > researchWorkspaceDataPreloadStart
      ? appSource.slice(researchWorkspaceDataPreloadStart, researchWorkspaceDataPreloadEnd)
      : "";
  const preloadOrderBlock =
    registrySource.match(/SCREEN_MODULE_PRELOAD_ORDER = \[[\s\S]*?\];/)?.[0] ?? "";
  const retiredRouteShellPattern = new RegExp("Route" + "ScreenShell");

  assert.ok(codeWarmupEffect);
  assert.ok(shellWarmMountEffect);
  assert.ok(researchWorkspaceCodePreloadEffect);
  assert.ok(researchWorkspaceDataPreloadEffect);
  assert.notEqual(preloadOrderBlock, "", "screen module preload order must be present");
  assert.match(registrySource, /export \{ getScreenModulePreloadSnapshot, preloadScreenModule \}/);
  assert.match(screenModulePreloaderSource, /export const preloadScreenModule/);
  assert.match(screenModulePreloaderSource, /const SCREEN_MODULE_PRELOADS = new Map\(\)/);
  assert.match(screenModulePreloaderSource, /const SCREEN_MODULE_COMPONENTS = new Map\(\)/);
  assert.match(screenModulePreloaderSource, /export const loadScreenModule = /);
  assert.match(screenModulePreloaderSource, /retryDynamicImport\(loader/);
  assert.match(screenModulePreloaderSource, /SCREEN_MODULE_COMPONENTS\.set\(screenId,\s*mod\.default\)/);
  assert.match(registrySource, /const createPreloadableScreen = /);
  assert.match(
    registrySource,
    /useState\(\s*\(\) => getPreloadedScreenComponent\(screenId\)/,
  );
  assert.doesNotMatch(registrySource, retiredRouteShellPattern);
  assert.match(registrySource, /data-screen-route-shell=\{screenId\}/);
  assert.match(registrySource, /import \{ markScreenReady \} from "\.\/performanceMetrics"/);
  assert.match(screenModulePreloaderSource, /BOOT_SCREEN_MODULE_PRELOAD_TASK_BY_SCREEN_ID/);
  assert.match(screenModulePreloaderSource, /startBootProgressTask\(bootProgressTaskId\)/);
  assert.match(screenModulePreloaderSource, /completeBootProgressTask\(bootProgressTaskId\)/);
  assert.match(registrySource, /props\?\.isVisible === false/);
  assert.match(registrySource, /const cachedScreenComponent = getPreloadedScreenComponent\(screenId\)/);
  assert.match(registrySource, /setScreenComponent\(\(\) => cachedScreenComponent\)/);
  assert.match(registrySource, /loadScreenModule\(screenId,\s*\{ label \}\)/);
  assert.match(registrySource, /setScreenComponent\(\(\) => mod\.default\)/);
  assert.match(registrySource, /markScreenReady\(screenId\)/);
  assert.match(registrySource, /props\?\.onReadinessChange\?\.\(\{ frameReady: true \}\)/);
  assert.match(registrySource, /export const ScreenLoadingFallback = /);
  assert.match(registrySource, /\) : props\?\.isVisible === false \? \(\s*null\s*\) : \(/);
  assert.match(registrySource, /<ScreenLoadingFallback screenId=\{screenId\} error=\{loadError\} \/>/);
  assert.doesNotMatch(registrySource, /lazyWithRetry/);
  assert.doesNotMatch(registrySource, /LazyScreen/);
  assert.match(registrySource, /export const BOOT_SCREEN_MODULE_PRELOAD_ORDER = \[/);
  assert.doesNotMatch(registrySource, /preloadBootScreenModules/);
  assert.doesNotMatch(registrySource, /void preloadScreenModule/);
  assert.match(screenModulePreloaderSource, /export const getScreenModulePreloadSnapshot = /);
  assert.match(appHeaderSource, /preloadScreenModule/);
  assert.match(appContentSource, /const PRIORITY_PLATFORM_SCREEN_IDS = \["account"\] as const/);
  assert.match(appContentSource, /const preloadPlatformScreenModule = \(screenId: string\) =>/);
  assert.match(appContentSource, /const preloadInitialPlatformScreenModule = \(initialScreen = resolveInitialPlatformScreen\(\)\) =>/);
  assert.match(appContentSource, /const preloadPriorityPlatformScreenModules = \(/);
  assert.match(appContentSource, /preloadPlatformScreenModule\(screenId\)/);
  assert.match(appContentSource, /preloadPriorityPlatformScreenModules\(initialScreen\)/);
  assert.ok(
    appContentSource.indexOf("preloadInitialPlatformScreenModule(initialScreen);") <
      appContentSource.indexOf("preloadDynamicImport(loadPlatformApp"),
    "initial screen chunk preload must start alongside the platform app chunk",
  );
  assert.match(appHeaderSource, /const handleScreenIntent = useCallback/);
  assert.match(appHeaderSource, /onFocus=\{\(\) => handleScreenIntent\(screen\.id\)\}/);
  assert.match(appHeaderSource, /onPointerEnter=\{\(\) => handleScreenIntent\(screen\.id\)\}/);
  assert.match(appHeaderSource, /onPointerDown=\{\(\) => handleScreenIntent\(screen\.id\)\}/);
  assert.match(registrySource, /export const SCREEN_SHELL_WARM_MOUNT_ORDER/);
  assert.match(appSource, /const readWarmupTestOverrides = \(\) =>/);
  assert.match(appSource, /__PYRUS_PERF_WARMUP_OVERRIDES__/);
  assert.match(appSource, /__PYRUS_PERF_WARMUP_SNAPSHOT__/);
  assert.match(appSource, /const warmupTimelineRef = useRef\(\{\}\)/);
  assert.match(appSource, /const bootScreenShellWarmMountCompleteRef = useRef\(false\)/);
  assert.match(appSource, /queues:\s*\{[\s\S]*screenCodePreloadStarted/);
  assert.match(appSource, /bootScreenShellWarmMountStarted/);
  assert.match(appSource, /const screenCodePreloadStartedRef = useRef\(false\)/);
  assert.match(appSource, /const priorityScreenCodePreloadStartedRef = useRef\(false\)/);
  assert.match(appSource, /const priorityScreenCodePreloadCompleteRef = useRef\(false\)/);
  assert.match(appSource, /const PRIORITY_SCREEN_MODULE_PRELOAD_ORDER = \["account"\]/);
  assert.match(appSource, /const PRIORITY_SCREEN_MODULE_PRELOAD_DELAY_MS = 500/);
  assert.match(appSource, /priorityScreenCodePreloadQueuedAtMs/);
  assert.match(appSource, /priorityScreenCodePreloadCompleteAtMs/);
  assert.match(appSource, /const priorityScreenCodePreloadPending = Boolean/);
  assert.match(appSource, /!priorityScreenCodePreloadPending &&\s*\(backgroundDataWarmupEnabled \|\| isPhone\)/);
  assert.match(appSource, /quoteStreamRuntimeEnabled=\{\s*!safeQaMode &&\s*workSchedule\.streams\.watchlistQuoteStream &&\s*!priorityScreenCodePreloadPending &&\s*!signalHydrationBootstrapActive\s*\}/);
  assert.match(appSource, /marketStockAggregateStreamingEnabled=\{\s*!safeQaMode &&\s*workSchedule\.streams\.marketStockAggregates &&\s*!priorityScreenCodePreloadPending &&\s*!signalHydrationBootstrapActive\s*\}/);
  assert.match(appSource, /lowPriorityHistoryEnabled=\{\s*!safeQaMode &&\s*workSchedule\.streams\.lowPriorityHistory &&\s*!priorityScreenCodePreloadPending &&\s*!signalHydrationBootstrapActive\s*\}/);
  assert.match(appSource, /sparklineHistoryEnabled=\{\s*!safeQaMode &&\s*platformPressureCaps\.sparklineEnabled &&\s*!signalHydrationBootstrapActive\s*\}/);
  assert.match(appSource, /enabled:\s*workSchedule\.streams\.accountRealtime &&\s*!priorityScreenCodePreloadPending/);
  assert.match(
    appSource,
    /preloadOrder\.map\(\(screenId\) => preloadScreenModule\(screenId\)\)/,
  );
  assert.match(appSource, /screenModulePreloads:\s*getScreenModulePreloadSnapshot\(\)/);
  assert.match(appSource, /backgroundDataWarmupGateOpenedAtMs/);
  assert.match(appSource, /timelineMs:\s*warmupTimelineRef\.current/);
  assert.match(
    appSource,
    /const screenCodePreloadReady = Boolean\(\s*operationalCodePreloadReady &&\s*activeScreenBackgroundAllowed &&\s*memoryAllowsBackgroundWarmup,\s*\);/,
  );
  assert.match(appSource, /const backgroundScreenPreloadReady = Boolean/);
  assert.match(appSource, /memoryAllowsBackgroundWarmup/);
  assert.match(appSource, /\["\/api\/universe\/logos"\]/);
  assert.match(appSource, /\["\/api\/universe\/logo-proxy"\]/);
  assert.match(appSource, /queryClient\.cancelQueries\(\{\s*queryKey,\s*exact:\s*false,\s*\}\)/);
  assert.match(appSource, /useBootProgress\(\)/);
  assert.match(appSource, /workspace-boot-progress-loader/);
  assert.match(registrySource, /export const SCREEN_BOOT_DATA_DEPS = \{/);
  assert.match(registrySource, /market:\s*\["session"\]/);
  assert.doesNotMatch(registrySource, /market:\s*\["session",\s*"watchlists"\]/);
  assert.match(appSource, /reclassifyBootBlocking\(\[/);
  assert.doesNotMatch(appSource, /secondaryBootDataReady/);
  assert.doesNotMatch(appSource, /initialScreenRequiresWatchlists/);
  assert.doesNotMatch(appSource, /initialScreenRequiresAccounts/);
  assert.doesNotMatch(appSource, /initialScreenRequiresSignalProfile/);
  assert.ok(
    appSource.indexOf("reclassifyBootBlocking([") <
      appSource.indexOf('"session",\n      "watchlists",\n      "accounts"'),
    "boot blocking must be reclassified before boot data tasks start",
  );
  assert.match(appSource, /BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS/);
  assert.match(appSource, /skipBootProgressTasks\(/);
  assert.doesNotMatch(routerSource, /const useDeferredActiveScreen = \(screen\) =>/);
  assert.doesNotMatch(routerSource, /window\.requestAnimationFrame\(activate\)/);
  assert.match(routerSource, /const marketDataActive = screen === "market";/);
  assert.match(routerSource, /isVisible=\{backtestDataActive\}/);
  assert.match(registrySource, /SCREEN_MODULE_PRELOAD_ORDER = \[[\s\S]*"flow"/);
  assert.ok(
    preloadOrderBlock.indexOf('"account"') < preloadOrderBlock.indexOf('"flow"'),
    "account must preload before heavier operational screens",
  );
  assert.match(registrySource, /BOOT_SCREEN_MODULE_PRELOAD_ORDER = \[[\s\S]*"flow"[\s\S]*"trade"[\s\S]*"backtest"/);
  assert.match(appSource, /!firstScreenReady[\s\S]*!backgroundScreenPreloadReady[\s\S]*bootScreenShellWarmMountCompleteRef\.current/);
  assert.match(appSource, /bootScreenShellWarmMountQueuedAtMs[\s\S]*scheduleIdleWork/);
  assert.match(appSource, /BOOT_SCREEN_MODULE_PRELOAD_ORDER\.map\(\(screenId\) =>\s*preloadScreenModule\(screenId\),\s*\)/);
  assert.match(appSource, /bootScreenShellWarmMountCompleteAtMs/);
  assert.match(appSource, /BOOT_SCREEN_MODULE_PRELOAD_ORDER\.forEach\(\(screenId\) => \{\s*next\[screenId\] = true;/);
  [
    "market",
    "flow",
    "gex",
    "trade",
    "account",
    "research",
    "backtest",
    "diagnostics",
    "settings",
  ].forEach((screenId) => {
    assert.match(preloadOrderBlock, new RegExp(`"${screenId}"`));
  });
  assert.doesNotMatch(preloadOrderBlock, /"algo"/);
  assert.doesNotMatch(registrySource, /OPERATIONAL_SCREEN_PRELOAD_ORDER/);
  assert.match(registrySource, /flow:\s*\{\s*retainInactive:\s*true\s*\}/);
  assert.match(registrySource, /gex:\s*\{\s*retainInactive:\s*true\s*\}/);
  assert.match(registrySource, /algo:\s*\{\s*retainInactive:\s*true\s*\}/);
  assert.match(registrySource, /backtest:\s*\{\s*retainInactive:\s*true\s*\}/);
  assert.match(registrySource, /research:\s*\{\s*retainInactive:\s*false\s*\}/);
  assert.match(appSource, /OPERATIONAL_SCREEN_PRELOAD_IDLE_DELAY_MS\s*=\s*20_000/);
  assert.match(appSource, /OPERATIONAL_SCREEN_PRELOAD_IDLE_STAGGER_MS\s*=\s*1_500/);
  assert.doesNotMatch(appSource, /OPERATIONAL_SCREEN_PRELOAD_STAGGER_MS/);
  assert.doesNotMatch(codeWarmupEffect, /scheduleIdleWork/);
  assert.match(codeWarmupEffect, /screenCodePreloadReady/);
  assert.doesNotMatch(codeWarmupEffect, /backgroundScreenPreloadReady/);
  assert.doesNotMatch(codeWarmupEffect, /memoryBlocksOperationalPreload/);
  assert.match(codeWarmupEffect, /const preloadOrder = SCREEN_MODULE_PRELOAD_ORDER\.filter/);
  assert.match(codeWarmupEffect, /screenId\) => screenId !== screen/);
  assert.match(codeWarmupEffect, /const runSequentialPreload = async \(\) =>/);
  assert.match(codeWarmupEffect, /for \(let index = 0; index < preloadOrder\.length; index \+= 1\)/);
  assert.match(codeWarmupEffect, /await preloadScreenModule\(preloadOrder\[index\]\)/);
  assert.doesNotMatch(codeWarmupEffect, /Promise\.allSettled/);
  assert.doesNotMatch(codeWarmupEffect, /const completeTimer = window\.setTimeout/);
  assert.doesNotMatch(codeWarmupEffect, /setScreenWarmupPhase/);
  assert.doesNotMatch(codeWarmupEffect, /setMountedScreens/);
  assert.match(
    appSource,
    /screenWarmupPhase !== "ready"[\s\S]*screenShellWarmMountCompleteRef\.current[\s\S]*const warmMountOrder = SCREEN_SHELL_WARM_MOUNT_ORDER\.filter/,
  );
  assert.match(appSource, /const hiddenScreenPreloadPolicy = useMemo/);
  assert.match(appSource, /buildPlatformWorkSchedule\([\s\S]*?\.hiddenScreenPreload/);
  assert.match(appSource, /const hiddenScreenWarmMountAllowed = Boolean/);
  assert.match(appSource, /!hiddenScreenWarmMountAllowed/);
  assert.match(appSource, /hiddenScreenWarmMountEnabled:\s*hiddenScreenWarmMountAllowed/);
  assert.match(shellWarmMountEffect, /SCREEN_SHELL_WARM_MOUNT_ORDER\.filter/);
  assert.match(shellWarmMountEffect, /screenId !== screen/);
  assert.match(shellWarmMountEffect, /scheduleIdleWork/);
  assert.match(shellWarmMountEffect, /setMountedScreens/);
  assert.doesNotMatch(shellWarmMountEffect, /preloadScreenModule\(screenId\)/);
  assert.doesNotMatch(
    researchWorkspaceCodePreloadEffect,
    /preloadScreenModule\("research"\)/,
  );
  assert.match(researchWorkspaceCodePreloadEffect, /queueIdleCodePreload\(2_500/);
  assert.match(researchWorkspaceCodePreloadEffect, /preloadDynamicImport/);
  assert.match(researchWorkspaceCodePreloadEffect, /PhotonicsObservatoryPrefetch/);
  assert.match(researchWorkspaceCodePreloadEffect, /memoryAllowsBackgroundWarmup/);
  assert.doesNotMatch(researchWorkspaceCodePreloadEffect, /loadResearchThemeDataset/);
  assert.match(researchWorkspaceDataPreloadEffect, /memoryAllowsIdlePrefetch/);
  assert.doesNotMatch(researchWorkspaceDataPreloadEffect, /memoryBlocksOperationalPreload/);
  assert.match(researchWorkspaceDataPreloadEffect, /queueIdleDataPreload\(4_000/);
  assert.match(researchWorkspaceDataPreloadEffect, /queueIdleDataPreload\(5_500/);
  assert.doesNotMatch(researchWorkspaceDataPreloadEffect, /PhotonicsObservatoryPrefetch/);
  assert.match(researchScreenSource, /preloadDynamicImport\(loadPhotonicsObservatory/);
  assert.match(researchScreenSource, /const ResearchWorkspaceFallback = \(\) =>/);
  assert.match(researchScreenSource, /<Suspense fallback=\{<ResearchWorkspaceFallback \/>\}>/);
  assert.match(researchScreenSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.match(researchScreenSource, /testId="research-workspace-loading"/);
  assert.doesNotMatch(researchScreenSource, /data-testid=.*loading.*shell/);
  assert.match(schedulerSource, /mountScreens:\s*false/);
  assert.match(schedulerSource, /const backgroundHistoryReady = screenWarmupPhase === "ready"/);
  assert.match(schedulerSource, /startupProtectionActive/);
});

test("retained hidden screens are isolated from shell and root render churn", () => {
  const shellSource = readFileSync(new URL("./PlatformShell.jsx", import.meta.url), "utf8");
  const registrySource = readFileSync(new URL("./screenRegistry.jsx", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const renderScreenByIdBlock =
    appSource.match(/const renderScreenById = useCallback\([\s\S]*?\n  \]\);/)?.[0] ??
    "";

  assert.match(shellSource, /const PlatformScreenStack = memo/);
  assert.match(shellSource, /data-testid="platform-screen-stack"/);
  assert.match(shellSource, /<PlatformScreenStack/);
  assert.doesNotMatch(shellSource, /ScreenReadyProbe/);
  assert.match(registrySource, /skipStableHiddenScreenRender/);
  assert.match(
    registrySource,
    /prevProps\?\.isVisible === false && nextProps\?\.isVisible === false/,
  );
  assert.match(registrySource, /memo\(AccountScreen,\s*skipStableHiddenScreenRender\)/);
  assert.match(registrySource, /memo\(GexScreen,\s*skipStableHiddenScreenRender\)/);
  assert.match(registrySource, /memo\(AlgoScreen,\s*skipStableHiddenScreenRender\)/);
  assert.doesNotMatch(registrySource, /market:\s*\{\s*retainInactive:\s*false/);
  assert.match(shellSource, /const MAX_RETAINED_INACTIVE_SCREENS = 2/);
  assert.match(shellSource, /const DEFERRED_SCREEN_UNMOUNT_MS = 1_200/);
  assert.match(shellSource, /retainedInactiveScreens\.includes\(id\)/);
  assert.match(shellSource, /deferredInactiveScreens\.includes\(id\)/);
  assert.match(appSource, /const renderScreenById = useCallback/);
  assert.ok(renderScreenByIdBlock, "renderScreenById block not found");
  assert.doesNotMatch(renderScreenByIdBlock, /watchlistSidebarWidth/);
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
  const registrySource = readFileSync(new URL("./screenRegistry.jsx", import.meta.url), "utf8");
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
  assert.match(appSource, /const activeScreenFrameReady = Boolean/);
  assert.match(appSource, /const activeScreenBackgroundAllowed = Boolean/);
  assert.match(appSource, /const activeScreenBackgroundDataAllowed = Boolean/);
  const frameAuxiliaryDataEnabledBlock =
    appSource.match(/const frameAuxiliaryDataEnabled = Boolean\([\s\S]*?\n  \);/)?.[0] ??
    "";
  assert.match(frameAuxiliaryDataEnabledBlock, /activeScreenFrameReady/);
  assert.doesNotMatch(frameAuxiliaryDataEnabledBlock, /activeScreenBackgroundDataAllowed/);
  assert.match(appSource, /const isPhone = viewport\.flags\.isPhone/);
  assert.match(
    appSource,
    /workspaceLeader &&\s*!safeQaMode &&\s*!isPhone &&\s*!warmupTestOverrides\.disableBackgroundDataWarmup/,
  );
  assert.match(appSource, /backgroundDataWarmupEnabled/);
  assert.match(appSource, /\(backgroundDataWarmupEnabled \|\| isPhone\)/);
  assert.match(
    appSource,
    /activeScreenBackgroundAllowed:\s*activeScreenBackgroundDataAllowed,\s*\n\s*startupProtectionActive,\s*\n\s*ibkrWorkPressure/,
  );
  assert.match(appSource, /mobileViewport:\s*isPhone/);
  assert.match(positionAlertsQueryBlock, /activeScreenBackgroundAllowed/);
  assert.match(positionAlertsQueryBlock, /backgroundDataWarmupEnabled/);
  assert.match(positionAlertsQueryBlock, /screenWarmupPhase === "ready"/);
  assert.match(positionAlertsQueryBlock, /!startupProtectionActive/);
  assert.match(positionAlertsQueryBlock, /!memoryBlocksOperationalPreload/);
  assert.doesNotMatch(positionAlertsQueryBlock, /screen !== "market" \|\| activeScreenCriticalReady/);
  assert.match(
    appSource,
    /const operationalCodePreloadReady = Boolean\(\s*platformWorkVisible &&\s*firstScreenReady &&\s*!startupProtectionActive &&\s*!isPhone &&\s*!warmupTestOverrides\.disableOperationalCodePreload,\s*\);/,
  );
  assert.doesNotMatch(
    appSource,
    /const operationalCodePreloadReady = Boolean\(\s*pageVisible &&\s*firstScreenReady &&\s*!memoryBlocksOperationalPreload/,
  );
  assert.doesNotMatch(
    appSource,
    /const operationalCodePreloadReady = Boolean\(\s*pageVisible &&\s*firstScreenReady &&\s*activeScreenCriticalReady &&\s*sessionMetadataSettled/,
  );
  assert.match(appSource, /!activeScreenBackgroundDataAllowed/);
  assert.match(appSource, /const handleScreenReady = \(event\) =>/);
  assert.match(appSource, /const readyScreenId = event\?\.detail\?\.screenId/);
  assert.match(appSource, /markWarmupTimeline\("firstScreenFrameReadyAtMs"\)/);
  assert.match(appSource, /firstScreenBootCompleteRef\.current \|\| !activeScreenCriticalReady/);
  assert.match(appSource, /setScreenWarmupPhase\("ready"\)/);
  assert.match(appSource, /completeBootProgressTask\("first-screen"/);
  assert.match(appSource, /if \(next\.derivedReady \|\| next\.backgroundAllowed\)/);
  assert.match(
    appSource,
    /handleScreenReadiness\(readyScreenId, \{\s*frameReady: true,\s*\}\)/,
  );
  assert.match(appSource, /onScreenReadiness=\{handleScreenReadiness\}/);
  assert.match(appSource, /const activateScreen = useCallback\(\(nextScreen\) => \{/);
  assert.match(appSource, /setMountedScreens\(\(current\) =>[\s\S]*current\[normalizedScreen\][\s\S]*\{ \.\.\.current, \[normalizedScreen\]: true \}/);
  assert.match(appSource, /setScreen\(normalizedScreen\)/);
  assert.match(appSource, /setScreen=\{activateScreen\}/);
  assert.match(shellSource, /<Suspense fallback=\{<ScreenLoadingFallback screenId=\{id\} \/>\}>[\s\S]*\{renderScreenById\(id\)\}[\s\S]*<\/Suspense>/);
  assert.doesNotMatch(shellSource, /ScreenReadyProbe/);
  assert.doesNotMatch(screenSuspenseBlock, /ScreenReadyProbe/);
  assert.match(registrySource, /markScreenReady\(screenId\)/);
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
    "diagnostics",
    "settings",
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
  assert.doesNotMatch(watchlistsQuery ?? "", /enabled:/);
  assert.match(
    signalMonitorProfileQuery ?? "",
    /refetchInterval:\s*signalMonitorWorkVisible\s*\?\s*60_000\s*:\s*false/,
  );
  assert.doesNotMatch(signalMonitorProfileQuery ?? "", /enabled:/);
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
  assert.match(source, /usePositionMarketDataSymbols/);
  assert.match(source, /usePositionQuoteSnapshotStream/);
  assert.match(source, /positionQuoteStreamRuntimeActive/);
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

test("operational pages mount visible shells without artificial route delays", () => {
  const marketSource = readFileSync(
    new URL("../../screens/MarketScreen.jsx", import.meta.url),
    "utf8",
  );
  const multiChartSource = readFileSync(
    new URL("../market/MultiChartGrid.jsx", import.meta.url),
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
  const backtestScreenSource = readFileSync(
    new URL("../../screens/BacktestScreen.jsx", import.meta.url),
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

  assert.doesNotMatch(flowSource, /const FLOW_ACTIVATION_DELAY_MS = 90/);
  assert.doesNotMatch(flowSource, /data-testid="flow-screen-activation-shell"/);
  assert.doesNotMatch(flowSource, /data-testid="flow-screen-suspended"/);
  assert.match(flowSource, /const FlowOverviewPanel =/);
  assert.doesNotMatch(flowSource, /const FLOW_DEFERRED_PANELS_DELAY_MS/);
  assert.doesNotMatch(flowSource, /requestAnimationFrame\(\(\) => \{\s*secondFrameId = requestAnimationFrame/);
  assert.doesNotMatch(flowSource, /setShowDeferredPanels/);
  assert.doesNotMatch(flowSource, /setActivateNews/);
  assert.match(flowSource, /const showDeferredPanels = Boolean\(isVisible\)/);
  assert.match(flowSource, /const shouldRenderDeferredPanels = showDeferredPanels/);
  assert.match(flowSource, /enabled:\s*Boolean\(isVisible\)/);
  assert.match(flowSource, /refetchInterval:\s*isVisible && !livePaused \? 60_000 : false/);
  assert.match(flowSource, /isVisible && !livePaused \? FLOW_PREMIUM_WIDGET_REFRESH_MS : false/);
  assert.match(tradeSource, /const TradeScreenInner =/);
  assert.doesNotMatch(tradeSource, /TradeActivationFallback/);
  assert.doesNotMatch(tradeSource, /data-testid="trade-screen-activation-shell"/);
  assert.doesNotMatch(tradeSource, /data-testid="trade-screen-suspended"/);
  assert.doesNotMatch(tradeSource, /secondaryPanelsVisible:\s*Boolean\(isVisible && secondaryReady\)/);
  assert.doesNotMatch(tradeSource, /analysisVisible:\s*Boolean\(visibleInteractive && secondaryReady\)/);
  assert.doesNotMatch(tradeSource, /secondaryTradePanelsReady/);
  assert.match(tradeSource, /secondaryPanelsVisible:\s*Boolean\(isVisible\)/);
  assert.match(tradeSource, /analysisVisible:\s*Boolean\(visibleInteractive\)/);
  assert.doesNotMatch(accountSource, /const ACCOUNT_ACTIVATION_DELAY_MS = 90/);
  assert.match(accountSource, /const ACCOUNT_CRITICAL_FALLBACK_DELAY_MS = 1_000/);
  assert.match(accountSource, /const AccountScreenInner =/);
  assert.doesNotMatch(accountSource, /data-testid="account-screen-activation-shell"/);
  assert.doesNotMatch(accountSource, /data-testid="account-screen-suspended"/);
  assert.match(accountSource, /return <AccountScreenInner \{\.\.\.props\} \/>/);
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
  assert.doesNotMatch(marketSource, /const MARKET_ACTIVATION_DELAY_MS = 70/);
  assert.match(marketSource, /const MarketScreenInner =/);
  assert.doesNotMatch(marketSource, /data-testid="market-screen-activation-shell"/);
  assert.doesNotMatch(marketSource, /data-testid="market-screen-suspended"/);
  assert.match(marketSource, /return <MarketScreenInner \{\.\.\.props\} \/>/);
  assert.match(marketSource, /const LazyMultiChartGrid = lazyWithRetry/);
  assert.match(marketSource, /let marketChartModulesPreloadStarted = false/);
  assert.match(marketSource, /export const preloadMarketChartModules = \(\) =>/);
  assert.match(marketSource, /preloadDynamicImport\(loadMultiChartGridModule/);
  assert.match(marketSource, /preloadMarketChartRuntime\?\.\(\)/);
  assert.doesNotMatch(
    marketSource,
    /if \(typeof window !== "undefined"\) \{\s*preloadMarketChartModules\(\);\s*\}/,
  );
  assert.doesNotMatch(marketSource, /loadMarketActivityPanelModule/);
  assert.doesNotMatch(marketSource, /preloadDynamicImport\(\(\) => import\("\.\.\/features\/charting\/ResearchChartSurface"\)/);
  assert.doesNotMatch(marketSource, /preloadDynamicImport\(\(\) => import\("\.\.\/features\/trade\/TradeEquityPanel\.jsx"\)/);
  assert.match(marketSource, /preloadMarketChartModules\(\)/);
  assert.match(
    marketSource,
    /fallback=\{\s*<MarketChartGridFallback[\s\S]*symbols=\{symbols\}[\s\S]*isPhone=\{marketLayoutFlags\.isPhone\}/,
  );
  assert.match(marketSource, /data-testid="market-chart-grid-shell"/);
  assert.match(marketSource, /data-testid="market-chart-grid-shell-cell"/);
  assert.doesNotMatch(marketSource, /market-chart-grid-loader/);
  assert.match(multiChartSource, /const MARKET_CHART_INITIAL_HYDRATION_SLOTS = 1/);
  assert.match(marketSource, /const \[chartGridReady, setChartGridReady\]/);
  assert.doesNotMatch(marketSource, /MARKET_SECONDARY_PANEL_DELAY_MS/);
  assert.doesNotMatch(marketSource, /secondaryPanelsReady/);
  assert.match(marketSource, /criticalReady: Boolean\(isVisible\)/);
  assert.match(marketSource, /derivedReady: Boolean\(isVisible && \(safeQaMode \|\| chartGridReady\)\)/);
  assert.match(marketSource, /backgroundAllowed: Boolean\(isVisible && !safeQaMode && chartGridReady\)/);
  assert.match(marketSource, /enabled: Boolean\(isVisible && !safeQaMode\)/);
  assert.match(marketSource, /refetchInterval: isVisible && !safeQaMode \? 60_000 : false/);
  assert.match(marketSource, /enabled: Boolean\(\s*isVisible &&\s*!safeQaMode &&\s*researchConfigured &&/);
  assert.match(marketSource, /refetchInterval: isVisible && !safeQaMode \? 300_000 : false/);
  assert.doesNotMatch(marketSource, /criticalReady: Boolean\(isVisible && chartGridReady\)/);
  assert.match(marketSource, /onReady=\{handleMarketChartGridReady\}/);
  assert.doesNotMatch(marketSource, /onReadinessChange\?\.\(\{ criticalReady: true \}\)/);
  assert.doesNotMatch(marketSource, /import \{ MultiChartGrid \}/);
  assert.doesNotMatch(marketSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.doesNotMatch(marketSource, /testId="market-activity-loader"/);
  assert.doesNotMatch(platformAppSource, /BROAD_FLOW_BACKGROUND_STARTUP_DELAY_MS/);
  assert.doesNotMatch(platformAppSource, /backgroundResumeReady\.broadFlow/);
  assert.doesNotMatch(platformAppSource, /broadFlowStartupDelayMs=\{0\}/);
  assert.match(backtestScreenSource, /const BacktestDraftStrategiesFallback =/);
  assert.match(backtestScreenSource, /fallback=\{<BacktestDraftStrategiesFallback \/>\}/);
  assert.doesNotMatch(backtestScreenSource, /<Suspense fallback=\{null\}>/);
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
  assert.match(tradeScreenSource, /secondaryPanelsVisible:\s*Boolean\(isVisible\)/);
  assert.match(tradeScreenSource, /analysisVisible:\s*Boolean\(visibleInteractive\)/);
  assert.doesNotMatch(tradeScreenSource, /secondaryPanelsVisible:\s*Boolean\(isVisible && secondaryReady\)/);
  assert.doesNotMatch(tradeScreenSource, /analysisVisible:\s*Boolean\(visibleInteractive && secondaryReady\)/);
  assert.doesNotMatch(tradeScreenSource, /secondaryTradePanelsReady/);
  assert.match(tradeScreenSource, /const tradeExecutionWorkEnabled = Boolean\(\s*tradeRuntimeActivity\.executionWarm && !safeQaMode,\s*\)/);
  assert.match(tradeScreenSource, /const tradeAnalysisWorkEnabled = Boolean\(\s*tradeRuntimeActivity\.analysisVisible && !safeQaMode,\s*\)/);
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
  const algoLivePageSource = readFileSync(
    new URL("../../screens/algo/AlgoLivePage.jsx", import.meta.url),
    "utf8",
  );
  const backtestSource = readFileSync(
    new URL("../backtesting/BacktestingPanels.tsx", import.meta.url),
    "utf8",
  );

  assert.match(algoSource, /const loadAlgoLivePage = \(\) =>/);
  assert.match(algoSource, /retryDynamicImport\(/);
  assert.match(algoSource, /label:\s*"AlgoLivePage"/);
  assert.match(algoSource, /const LazyAlgoLivePage = lazy\(loadAlgoLivePage\)/);
  assert.doesNotMatch(algoSource, /void loadAlgoLivePage\(\)/);
  assert.match(algoSource, /const AlgoLiveLoading = \(\) =>/);
  assert.match(algoSource, /data-testid="algo-live-loading"/);
  assert.match(algoSource, /const \[algoLivePageReady, setAlgoLivePageReady\] = useState\(false\)/);
  assert.match(algoSource, /const loadAlgoRightRail = \(\) =>/);
  assert.match(algoSource, /void loadAlgoRightRail\(\)\.catch\(\(\) => undefined\)/);
  assert.match(algoSource, /loadAlgoLivePage\(\)[\s\S]*setAlgoLivePageReady\(true\)/);
  assert.match(algoSource, /const algoLiveDataQueriesEnabled = Boolean\(isVisible\);/);
  assert.match(algoSource, /const algoSetupQueriesEnabled = Boolean\(isVisible\);/);
  assert.match(algoSource, /const algoCriticalQueriesEnabled = Boolean\(algoLiveDataQueriesEnabled\);/);
  assert.match(
    algoSource,
    /const algoDerivedQueriesEnabled = Boolean\(\s*algoLiveDataQueriesEnabled &&\s*algoDerivedFallbackReady &&\s*!algoCockpitStreamFreshness\.algoFullFresh,\s*\);/,
  );
  assert.match(
    algoSource,
    /const algoPostCriticalQueriesEnabled = Boolean\(\s*algoLiveDataQueriesEnabled &&\s*algoDerivedFallbackReady &&\s*!shadowAccountStreamFreshness\.accountFresh,\s*\);/,
  );
  assert.match(algoSource, /<Suspense fallback=\{<AlgoLiveLoading \/>\}>/);
  assert.doesNotMatch(algoSource, /import \{ AlgoRightRail \} from "\.\/algo\/AlgoRightRail\.jsx";/);
  assert.match(algoSource, /const LazyAlgoRightRail = lazy\(loadAlgoRightRail\)/);
  assert.match(algoSource, /import\("\.\/algo\/AlgoRightRail\.jsx"\)/);
  assert.match(algoSource, /data-testid="algo-right-rail-loading"/);
  assert.match(
    algoSource,
    /rightRail=\{\s*<Suspense fallback=\{<AlgoRightRailLoading \/>\}>[\s\S]*<LazyAlgoRightRail/,
  );
  assert.match(algoLivePageSource, /data-testid="algo-live-right-column"/);
  [
    "LazyOperationsPositionsTable",
    "LazyOperationsSignalTable",
  ].forEach((name) => {
    assert.match(algoLivePageSource, new RegExp(`const ${name} = lazyWithRetry`));
  });
  [
    "OperationsPositionsTable",
    "OperationsSignalTable",
  ].forEach((label) => {
    assert.match(algoLivePageSource, new RegExp(`label:\\s*"${label}"`));
  });
  assert.doesNotMatch(algoLivePageSource, /LazyOperationsSignalDrill/);
  assert.doesNotMatch(algoLivePageSource, /OperationsSignalDrill/);
  assert.match(algoLivePageSource, /\{rightRail\}/);
  assert.doesNotMatch(
    algoSource,
    /const algoCriticalQueriesEnabled = Boolean\([^;\n]*algoCriticalFallbackReady/,
  );
  assert.doesNotMatch(
    algoSource,
    /const algoCriticalQueriesEnabled = Boolean\([^;\n]*algoCockpitStreamFreshness\.algoCriticalFresh/,
  );
  assert.match(
    algoSource,
    /const algoRoutineRefetchInterval =[\s\S]*!algoCockpitStreamFreshness\.algoCriticalFresh/,
  );
  assert.match(
    algoSource,
    /const algoDerivedRefetchInterval =[\s\S]*!algoCockpitStreamFreshness\.algoFullFresh/,
  );
  assert.match(
    algoSource,
    /const draftsQuery = useListBacktestDraftStrategies\(\{[\s\S]*enabled:\s*algoSetupQueriesEnabled/,
  );
  assert.match(
    algoSource,
    /const deploymentsQuery = useListAlgoDeployments\([\s\S]*enabled:\s*algoSetupQueriesEnabled/,
  );
  assert.match(
    algoSource,
    /const eventsQuery = useListExecutionEvents\([\s\S]*enabled:\s*algoLiveDataQueriesEnabled/,
  );
  assert.match(
    algoSource,
    /useListExecutionEvents\(\s*focusedDeployment[\s\S]*limit:\s*100[\s\S]*:\s*\{ limit:\s*100 \}/,
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
  assert.match(backtestSource, /resolvePyrusSignalsSettingsWithAlgoDefaults/);
  assert.match(backtestSource, /lastStudyPyrusSignalsSettingsRef/);
});

test("Research noncritical enrichment waits for settled screen visibility", () => {
  const source = readFileSync(
    new URL("../research/PhotonicsObservatory.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const RESEARCH_LIVE_ENRICHMENT_DELAY_MS = 8_000/);
  assert.match(source, /const RESEARCH_LIVE_REFRESH_DELAY_MS = 500/);
  assert.match(source, /const RESEARCH_FUNDAMENTALS_PREFETCH_DELAY_MS = 4_000/);
  assert.match(source, /const RESEARCH_THEME_PREFETCH_DELAY_MS = 4_000/);
  assert.match(source, /if \(!isVisible\) return undefined;[\s\S]*fetchResearchStatus\(\)\.then/);
  assert.match(source, /setResearchLiveEnrichmentReady\(false\);[\s\S]*RESEARCH_LIVE_ENRICHMENT_DELAY_MS/);
  assert.match(source, /researchLiveEnrichmentReady &&[\s\S]*streamedThemeTickers\.length/);
  assert.match(source, /if \(!researchLiveEnrichmentReady \|\| !apiKey \|\| !researchDataReady\) return undefined;/);
  assert.match(source, /window\.setTimeout\(\(\) => \{\s*void refreshData\(false\);[\s\S]*RESEARCH_LIVE_REFRESH_DELAY_MS/);
  assert.match(source, /window\.clearTimeout\(timer\)/);
  assert.match(source, /backgroundPrefetchFundamentals\(pendingTickers[\s\S]*RESEARCH_FUNDAMENTALS_PREFETCH_DELAY_MS/);
  assert.match(source, /prefetchResearchThemeDataset\(candidateThemeId\);[\s\S]*RESEARCH_THEME_PREFETCH_DELAY_MS/);
  assert.match(source, /\[apiKey, refreshData, researchDataReady, researchLiveEnrichmentReady\]/);
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
  assert.match(diagnosticsSource, /Massive REST/);
  assert.match(diagnosticsSource, /Massive WebSocket/);
  assert.match(accountUtilsSource, /pnl-positive/);
  assert.match(accountUtilsSource, /side-buy/);
  assert.match(accountUtilsSource, /category-automation/);
  assert.match(ibkrSource, /canonicalizeStreamState/);
  assert.match(ibkrSource, /streamStateTokenVar/);
});

test("api client exposes route-admission pressure headers to the app", () => {
  const customFetchSource = readFileSync(
    new URL(
      "../../../../../lib/api-client-react/src/custom-fetch.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const memoryPressureSource = readFileSync(
    new URL("./useMemoryPressureSignal.js", import.meta.url),
    "utf8",
  );

  assert.match(customFetchSource, /dispatchApiPressureHeaderEvent\(response, input\.requestInfo\)/);
  assert.match(customFetchSource, /response\.headers\.get\("x-pyrus-pressure-level"\)/);
  assert.match(customFetchSource, /new CustomEvent\("pyrus:api-pressure"/);
  assert.match(memoryPressureSource, /window\.addEventListener\(API_PRESSURE_EVENT, handleApiPressure\)/);
  assert.match(memoryPressureSource, /setMemoryPressureSnapshot\(snapshot\)/);
});
