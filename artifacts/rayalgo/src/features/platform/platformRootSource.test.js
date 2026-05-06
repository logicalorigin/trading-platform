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

test("flow scanner requests broad backend flow and filters scanner scope locally", () => {
  const source = readFileSync(
    new URL("./useLiveMarketFlow.js", import.meta.url),
    "utf8",
  );
  const requestBlock = source.match(
    /listFlowEventsRequest\(\{[\s\S]*?\n\s*\}\);/,
  )?.[0];

  assert.ok(requestBlock, "flow scanner request block must be present");
  assert.match(requestBlock, /scope:\s*FLOW_SCANNER_SCOPE\.all/);
  assert.doesNotMatch(requestBlock, /scope:\s*effectiveScannerConfig\.scope/);
  assert.doesNotMatch(requestBlock, /unusualThreshold/);
  assert.match(source, /filterFlowScannerEvents\([\s\S]*effectiveScannerConfig/);
  assert.match(source, /promotedBackendSymbols/);
  assert.match(source, /backendRadarBatchSymbols/);
  assert.match(source, /FLOW_SCANNER_MARKET_UNIVERSE_SYMBOLS/);
  assert.match(source, /blocking\s*===\s*false[\s\S]*flowScannerModeUsesMarketUniverse/);
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
  assert.match(source, /filterFlowTapeEvents\(broadFlowSnapshot\.flowEvents/);
  assert.match(source, /mode:\s*FLOW_SCANNER_MODE\.allWatchlistsPlusUniverse/);
  assert.match(source, /buildHeaderUnusualTapeItems\(unusualEvents\)/);
});

test("Flow page scanner uses one broad scanner panel and no active-symbol merge", () => {
  const source = readFileSync(
    new URL("../../screens/FlowScreen.jsx", import.meta.url),
    "utf8",
  );
  const settingsSource = readFileSync(
    new URL("../../screens/SettingsScreen.jsx", import.meta.url),
    "utf8",
  );
  const scannerPanelRenders = source.match(/<FlowScannerStatusPanel\b/g) || [];
  const legacyScannerRenders = source.match(/<UnusualScannerSection\b/g) || [];

  assert.equal(scannerPanelRenders.length, 1);
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
  assert.match(source, /buildFlowTideFromEvents\(filtered\)/);
  assert.match(source, /buildTickerFlowFromEvents\(filtered/);
  assert.match(source, /buildMarketOrderFlowFromEvents\(filtered\)/);
  assert.doesNotMatch(source, /flowUnusualSideFilter/);
  assert.doesNotMatch(source, /unusualSideFilter/);
  assert.doesNotMatch(source, /flow-unusual-scanner-status-panel/);
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
  assert.doesNotMatch(broadRuntime, /activeSymbols/);
  assert.match(broadRuntime, /FLOW_SCANNER_MODE\.allWatchlistsPlusUniverse/);
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
  const flowRuntimeProp = source.match(
    /flowRuntimeEnabled=\{[\s\S]*?\}\s*flowRuntimeIntervalMs=/,
  )?.[0];

  assert.ok(flowRuntimeProp, "PlatformApp must pass flowRuntimeEnabled");
  assert.match(flowRuntimeProp, /workSchedule\.streams\.sharedFlowRuntime/);
  assert.match(schedulerSource, /sharedFlowRuntime:\s*false/);
  assert.doesNotMatch(
    schedulerSource,
    /marketScreenActive/,
    "Chart and broad scanner runtimes should own flow to avoid a second all-flow path",
  );
});
