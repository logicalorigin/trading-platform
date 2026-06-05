import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  accountDateFilterBoundaryIso,
  buildPerformanceCalendarParams,
  performanceCalendarQueriesEnabled,
  resolveReturnsCalendarData,
} from "./accountCalendarData.js";

test("accountDateFilterBoundaryIso builds local-day date filter boundaries", () => {
  const from = accountDateFilterBoundaryIso("2026-05-13");
  const to = accountDateFilterBoundaryIso("2026-05-13", { endOfDay: true });

  assert.equal(from, new Date(2026, 4, 13, 0, 0, 0, 0).toISOString());
  assert.equal(to, new Date(2026, 4, 13, 23, 59, 59, 999).toISOString());
  assert.equal(accountDateFilterBoundaryIso("bad-date"), undefined);
  assert.equal(accountDateFilterBoundaryIso("2026-02-31"), undefined);
});

test("buildPerformanceCalendarParams uses an unfiltered 400-day calendar lookback", () => {
  const now = Date.UTC(2026, 4, 6, 12, 0, 0);
  const params = buildPerformanceCalendarParams({ mode: "paper" }, now);

  assert.equal(params.mode, "paper");
  assert.equal(params.from, "2025-04-01T12:00:00.000Z");
  assert.equal(Object.hasOwn(params, "symbol"), false);
  assert.equal(Object.hasOwn(params, "pnlSign"), false);
});

test("performance calendar queries follow account query readiness for real and shadow accounts", () => {
  assert.equal(performanceCalendarQueriesEnabled(true), true);
  assert.equal(performanceCalendarQueriesEnabled(false), false);
});

test("resolveReturnsCalendarData uses the dedicated calendar query payload", () => {
  const performanceTrades = { trades: [{ id: "calendar-trade", realizedPnl: 12 }] };
  const visibleTrades = { trades: [{ id: "filtered-visible-trade", realizedPnl: 99 }] };
  const performanceEquity = { points: [{ timestamp: "2026-05-06", netLiquidation: 1000 }] };

  const resolved = resolveReturnsCalendarData({
    performanceCalendarTradesData: performanceTrades,
    performanceCalendarEquityData: performanceEquity,
    visibleTradesData: visibleTrades,
  });

  assert.equal(resolved.tradesData, performanceTrades);
  assert.deepEqual(resolved.equityPoints, performanceEquity.points);
});

test("account screen scopes position option quote stream owner to the active account", () => {
  const source = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");

  assert.match(source, /const accountOptionQuoteOwner = useMemo/);
  assert.match(
    source,
    /`account-position-option-quotes:\$\{accountRequestId \|\| SHADOW_ACCOUNT_ID\}`/,
  );
  assert.match(
    source,
    /<PositionOptionQuoteStreams[\s\S]*?groups=\{accountOptionQuoteGroups\}[\s\S]*?owner=\{accountOptionQuoteOwner\}/,
  );
});

test("account screen wires shadow account queries through the paper ledger path", () => {
  const source = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
  const immediateSwitchPrefetchBlock = source.match(
    /useEffect\(\(\) => \{\s*if \(!isVisible \|\| !accountQueriesEnabled\)[\s\S]*?prefetchAccountSectionLiveQueries\(inactiveAccountSection\);[\s\S]*?\}, \[/,
  )?.[0] ?? "";
  const positionsAtDateQueryBlock = source.slice(
    source.indexOf("const positionsAtDateQuery = useGetAccountPositionsAtDate"),
    source.indexOf("const performanceCalendarEquityQuery = useQuery"),
  );

  assert.match(source, /const resolveAccountMode = \(\{ shadowMode = false, environment \} = \{\}\) =>/);
  assert.match(source, /if \(shadowMode\) \{\s*return "paper";\s*\}/);
  assert.match(source, /return environment === "paper" \? "paper" : "live";/);
  assert.match(source, /mode:\s*resolveAccountMode\(\{ shadowMode, environment \}\)/);
  assert.match(
    source,
    /mode:\s*resolveAccountMode\(\{\s*shadowMode: nextShadowMode,\s*environment,\s*\}\)/,
  );
  assert.doesNotMatch(source, /mode:\s*shadowMode\s*\?\s*"paper"\s*:\s*environment\s*\|\|\s*"paper"/);
  assert.doesNotMatch(source, /mode:\s*nextShadowMode\s*\?\s*"paper"\s*:\s*environment\s*\|\|\s*"paper"/);
  assert.match(source, /const accountDataParams = useMemo/);
  assert.match(source, /defaultTradingAnalysisFilters/);
  assert.match(source, /const shadowSourceLabel = shadowMode \? "Shadow Ledger" : "Flex"/);
  assert.doesNotMatch(source, /accountShadowSourceFilter/);
  assert.doesNotMatch(source, /SHADOW_SOURCE_FILTERS/);
  assert.doesNotMatch(source, /source:\s*shadowDataSource/);
  assert.match(source, /const effectiveOrderTab =\s*shadowMode && orderTab === "working" \? "history" : orderTab/);
  assert.match(source, /const accountPageStreamEnabled = Boolean\(/);
  assert.match(source, /isVisible && accountQueriesEnabled/);
  assert.match(source, /orderTab:\s*effectiveOrderTab/);
  assert.match(source, /useGetAccountSummary\(accountRequestId,\s*accountDataParams/);
  assert.match(source, /tab:\s*effectiveOrderTab/);
  assert.match(source, /summary=\{displaySummaryData\}/);
  assert.match(source, /buildAccountAnalysisQueryParams\(\{/);
  assert.match(source, /filters: tradeFilters/);
  assert.match(source, /buildPerformanceCalendarParams\(accountDataParams\)/);
  assert.match(source, /const ACCOUNT_DERIVED_STALE_MS = 120_000/);
  assert.match(source, /const ACCOUNT_HISTORY_STALE_MS = 120_000/);
  assert.match(source, /const retainPreviousAccountData = \(accountId\) => \(previousData\) =>/);
  assert.match(source, /const retainPreviousAccountRangeData =\s*\(accountId, range, benchmark = null\) =>/);
  assert.match(source, /const retainPreviousAccountDateData = \(accountId, date\) => \(previousData\) =>/);
  assert.match(source, /const retainPreviousData = useMemo\(\s*\(\) => retainPreviousAccountData\(accountRequestId\),/);
  assert.match(source, /const retainPreviousRangeData = useCallback\(\s*\(targetRange, benchmark = null\) =>\s*retainPreviousAccountRangeData\(accountRequestId, targetRange, benchmark\),/);
  assert.match(source, /const retainPreviousDateData = useCallback\(\s*\(date\) => retainPreviousAccountDateData\(accountRequestId, date\),/);
  assert.match(source, /const equityHistoryQueriesEnabled\s*=\s*Boolean\(derivedAccountQueriesEnabled\)/);
  assert.match(source, /const secondaryAccountQueriesEnabled\s*=\s*Boolean\(derivedAccountQueriesEnabled\)/);
  assert.match(source, /const benchmarkQueriesEnabled\s*=\s*Boolean\(equityHistoryQueriesEnabled\)/);
  assert.doesNotMatch(source, /const benchmarkQueriesEnabled\s*=\s*Boolean\(derivedAccountQueriesEnabled\)/);
  assert.match(
    positionsAtDateQueryBlock,
    /enabled:\s*Boolean\(accountQueriesEnabled && activeEquityInspectionDate\)/,
  );
  assert.doesNotMatch(positionsAtDateQueryBlock, /secondaryAccountQueriesEnabled/);
  assert.match(source, /enabled:\s*equityHistoryQueriesEnabled/);
  assert.match(source, /placeholderData:\s*retainPreviousRangeData\(range\)/);
  assert.match(source, /placeholderData:\s*retainPreviousRangeData\("1Y"\)/);
  assert.match(source, /getAccountPerformanceCalendarEquityQueryKey/);
  assert.match(source, /const performanceCalendarEquityRuntimeQueryKey = useMemo/);
  assert.match(source, /queryKey:\s*performanceCalendarEquityRuntimeQueryKey/);
  assert.match(source, /useRuntimeAccountHistoryCache\(\{/);
  assert.match(source, /readCachedAccountHistory\(cacheKey\)/);
  assert.match(source, /writeCachedAccountHistory\(cacheKey, data, writeOptions\)/);
  assert.match(source, /source:\s*"equity-history"/);
  assert.match(source, /source:\s*"performance-calendar-equity"/);
  assert.match(source, /source:\s*"closed-trades"/);
  assert.doesNotMatch(source, /writeCachedAccountHistory[\s\S]{0,160}positionsQuery\.data/);
  assert.doesNotMatch(source, /writeCachedAccountHistory[\s\S]{0,160}ordersQuery\.data/);
  assert.match(source, /placeholderData:\s*retainPreviousData/);
  assert.match(source, /shadowMode &&\s*\(range === "1D" \|\| range === "1W"\)/);
  assert.match(source, /performanceCalendarEquityQuery\.data\?\.range === "1Y"/);
  assert.match(source, /setRange\("1Y"\)/);
  assert.match(source, /visibleEquityBenchmarks/);
  assert.match(source, /enabled:\s*Boolean\(benchmarkQueriesEnabled && visibleEquityBenchmarks\.SPY\)/);
  assert.match(source, /enabled:\s*Boolean\(benchmarkQueriesEnabled && visibleEquityBenchmarks\.QQQ\)/);
  assert.match(source, /enabled:\s*Boolean\(benchmarkQueriesEnabled && visibleEquityBenchmarks\.DJIA\)/);
  assert.match(source, /visibleEquityBenchmarks\.SPY[\s\S]*spyBenchmarkQuery\.refetch/);
  assert.match(source, /if \(!visibleEquityBenchmarks\[key\]\)/);
  assert.match(source, /requestAnimationFrame\(clearInspection\)/);
  assert.match(source, /setHoveredEquityDate\(null\);[\s\S]*setPinnedEquityDate\(null\);/);
  assert.match(source, /ACCOUNT_SWITCH_PREFETCH_OPTIONS/);
  assert.match(source, /staleTime:\s*90_000/);
  assert.match(source, /const ACCOUNT_SWITCH_KEEP_WARM_MS = 60_000/);
  assert.match(source, /const ACCOUNT_CRITICAL_FALLBACK_DELAY_MS = 0/);
  assert.match(source, /const SHADOW_ACCOUNT_CRITICAL_FALLBACK_DELAY_MS = 0/);
  assert.match(source, /const ACCOUNT_LIVE_FALLBACK_DELAY_MS = 0/);
  assert.match(source, /const ACCOUNT_DERIVED_FALLBACK_DELAY_MS = 0/);
  assert.match(source, /const ACCOUNT_INACTIVE_PREWARM_FALLBACK_DELAY_MS = 0/);
  assert.match(
    source,
    /const accountCriticalFallbackDelayMs = shadowMode[\s\S]*SHADOW_ACCOUNT_CRITICAL_FALLBACK_DELAY_MS[\s\S]*ACCOUNT_CRITICAL_FALLBACK_DELAY_MS/,
  );
  assert.match(source, /const prefetchAccountSectionLiveQueries = useCallback/);
  assert.match(source, /getGetAccountSummaryQueryOptions/);
  assert.match(source, /getGetAccountPositionsQueryOptions/);
  assert.match(
    source,
    /getGetAccountPositionsQueryOptions\(\s*target\.accountId,[\s\S]*liveQuotes: target\.accountId === "shadow" \? true : undefined/,
  );
  assert.match(source, /getGetAccountOrdersQueryOptions/);
  assert.match(source, /getGetAccountEquityHistoryQueryOptions/);
  assert.match(source, /const inactiveAccountSection = shadowMode \? "real" : "shadow"/);
  assert.match(source, /const inactiveAccountPageRequest = useMemo/);
  assert.match(source, /const inactiveAccountPageStreamEnabled = Boolean/);
  assert.match(source, /const inactiveAccountPageStreamFreshness = useAccountPageSnapshotStream/);
  assert.match(source, /inactiveAccountPrewarmFallbackReady/);
  assert.match(source, /const inactiveAccountPrewarmEnabled = Boolean/);
  assert.match(source, /!inactiveAccountPageStreamFreshness\.accountCriticalFresh/);
  assert.match(source, /const accountActivePrefetchEnabled = Boolean/);
  assert.match(source, /\(accountCriticalFallbackReady &&[\s\S]*!accountPageStreamFreshness\.accountCriticalFresh\)/);
  assert.match(source, /prefetchAccountSectionLiveQueries\(inactiveAccountSection\)/);
  assert.match(source, /window\.setInterval\(\(\) => \{[\s\S]*prefetchAccountSectionLiveQueries\(inactiveAccountSection\);[\s\S]*ACCOUNT_SWITCH_KEEP_WARM_MS/);
  assert.doesNotMatch(immediateSwitchPrefetchBlock, /requestIdleCallback/);
  assert.match(source, /if \(!accountActivePrefetchEnabled\) \{/);
  assert.match(source, /prefetchAccountSectionLiveQueries\(accountSection\)/);
  assert.match(source, /useGetAccountSummary\(accountRequestId,[\s\S]*placeholderData:\s*retainPreviousData/);
  assert.match(source, /useGetAccountAllocation\(accountRequestId,[\s\S]*placeholderData:\s*retainPreviousData/);
  assert.match(source, /useGetAccountPositions\([\s\S]*placeholderData:\s*retainPreviousData/);
  assert.match(
    source,
    /useGetAccountPositions\([\s\S]*liveQuotes: shadowMode \? true : undefined[\s\S]*placeholderData:\s*retainPreviousData/,
  );
  assert.match(source, /useGetAccountClosedTrades\(accountRequestId,[\s\S]*placeholderData:\s*retainPreviousData/);
  assert.match(source, /useGetAccountOrders\([\s\S]*placeholderData:\s*retainPreviousData/);
  assert.match(source, /const riskParams = useMemo\([\s\S]*detail:\s*"fast"/);
  assert.match(source, /getGetAccountRiskQueryOptions\([\s\S]*detail:\s*"fast"/);
  assert.match(source, /useGetAccountRisk\(accountRequestId,\s*riskParams,[\s\S]*placeholderData:\s*retainPreviousData/);
  assert.match(source, /const sectionSwitching = Boolean\(/);
  assert.match(source, /accountSectionPending && summaryQuery\.isPlaceholderData/);
  assert.match(source, /accountSectionPending[\s\S]*setAccountCriticalFallbackReady\(false\)/);
  assert.match(source, /accountSectionPending[\s\S]*setAccountLiveFallbackReady\(false\)/);
  assert.match(source, /accountSectionPending[\s\S]*setAccountDerivedFallbackReady\(false\)/);
  assert.match(source, /setAccountSectionTransitionSnapshot\(\{/);
  assert.match(source, /data-account-transitioning=\{String\(sectionSwitching\)\}/);
  assert.match(cssSource, /\[data-account-transitioning\]/);
  assert.match(cssSource, /\[data-account-transitioning="true"\][\s\S]*opacity:\s*0\.85/);
  assert.match(
    source,
    /dataScopeKey=\{`\$\{accountRequestId\}:\$\{accountDataParams\.mode \|\| ""\}:\$\{accountSection\}`\}/,
  );
  assert.doesNotMatch(source, /dataScopeKey="account-equity"/);
  assert.match(source, /const accountCriticalReady = Boolean/);
  assert.match(source, /const derivedAccountQueriesEnabled = Boolean/);
  assert.match(
    source,
    /accountDerivedFallbackReady && !accountPageStreamFreshness\.accountDerivedFresh/,
  );
  assert.match(
    source,
    /accountQueriesEnabled && accountDerivedReady/,
  );
  assert.match(
    source,
    /secondaryAccountQueriesEnabled && activatedAccountPanels\.support/,
  );
  assert.match(
    source,
    /!accountPageStreamFreshness\.accountDerivedFresh[\s\S]*return undefined/,
  );
  assert.match(source, /onReadinessChange\?\.\(\{/);
});

test("account screen always renders equity-date positions below the equity curve", () => {
  const source = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");
  const equityPanelIndex = source.indexOf("<LazyEquityCurvePanel");
  const inspectorIndex = source.indexOf("<LazyPositionsAtDateInspector");
  const positionsPanelIndex = source.indexOf("<LazyPositionsPanel");
  const todayPanelIndex = source.indexOf("<TodaySnapshotPanel");
  const positionsPanelBlock = source.match(
    /testId="account-deferred-positions"[\s\S]*?<LazyPositionsPanel[\s\S]*?\/>/,
  )?.[0] ?? "";

  assert.match(source, /className="ra-account-overview-cell ra-account-overview-equity"/);
  assert.doesNotMatch(source, /activeEquityInspectionDate \? \(\s*<LazyPositionsAtDateInspector/);
  assert.ok(equityPanelIndex >= 0, "EquityCurvePanel must render on AccountScreen");
  assert.ok(inspectorIndex > equityPanelIndex, "PositionsAtDateInspector must render after the equity curve");
  assert.ok(positionsPanelIndex > inspectorIndex, "Current Positions must render after the equity-date inspector");
  assert.ok(todayPanelIndex > positionsPanelIndex, "Today heatmap must render after Current Positions");
  assert.doesNotMatch(positionsPanelBlock, /positionsAtDateQuery/);
  assert.doesNotMatch(positionsPanelBlock, /activeEquityDate/);
  assert.doesNotMatch(positionsPanelBlock, /pinnedEquityDate/);
  assert.doesNotMatch(positionsPanelBlock, /onClearEquityPin/);
});

test("equity curve footer prints plotted detail for backfill review", () => {
  const source = readFileSync(new URL("./EquityCurvePanel.jsx", import.meta.url), "utf8");

  assert.match(source, /const latestSnapshotTimestamp =/);
  assert.match(source, /const chartPointCountLabel = `\$\{data\.length\.toLocaleString\(\)\} pts`/);
  assert.match(source, /const visibleAvailableBenchmarks = useMemo/);
  assert.match(source, /\{sourceLabel\} ·[\s\S]*formatAppDateTime\(latestSnapshotTimestamp\)/);
  assert.match(source, /visibleAvailableBenchmarks\.map/);
});

test("equity curve pin overlay fades when account inspection clears", () => {
  const source = readFileSync(new URL("./EquityCurvePanel.jsx", import.meta.url), "utf8");
  const ribbonSource = readFileSync(
    new URL("./EquityCurveEventRibbon.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const PIN_OVERLAY_FADE_MS = 200/);
  assert.match(source, /const PinOverlay = \(\{ chart, timestampMs, compact, visible = true \}\)/);
  assert.match(source, /transition:\s*"opacity 200ms ease-out"/);
  assert.match(source, /setPosition\(Number\(coordinate\)\)/);
  assert.match(ribbonSource, /left: Number\(coordinate\)/);
  assert.doesNotMatch(source, /priceScaleWidth/);
  assert.doesNotMatch(ribbonSource, /priceScaleWidth/);
  assert.match(source, /fadingPinnedInspectionTimestampMs/);
  assert.match(source, /previousPinnedInspectionTimestampMsRef/);
  assert.match(source, /visiblePinnedInspectionTimestampMs/);
  assert.match(source, /visible=\{pinnedInspectionTimestampMs != null\}/);
});

test("equity curve main response and viewport are independent from benchmark readiness", () => {
  const panelSource = readFileSync(new URL("./EquityCurvePanel.jsx", import.meta.url), "utf8");
  const chartSource = readFileSync(new URL("./EquityCurveChart.jsx", import.meta.url), "utf8");

  assert.match(
    panelSource,
    /const selectedRangeReady = equityRangeResponseMatches\(query\.data, range\)/,
  );
  assert.doesNotMatch(panelSource, /rangeReadyForVisibleBenchmarks/);
  assert.doesNotMatch(panelSource, /benchmarkRangeReady/);
  assert.match(chartSource, /mainSeriesRef\.current\.setData\(seriesData\)/);
  assert.match(chartSource, /if \(seriesData\.length\) \{[\s\S]*chart\.timeScale\(\)\.fitContent\(\);/);
});

test("equity curve chart resolves token alpha colors before chart canvas usage", () => {
  const chartSource = readFileSync(new URL("./EquityCurveChart.jsx", import.meta.url), "utf8");

  assert.match(chartSource, /resolveCanvasAlphaColor/);
  assert.match(chartSource, /resolveCanvasColor/);
  assert.match(chartSource, /const chartColor = resolveCanvasColor/);
  assert.match(chartSource, /const chartColorAlpha = resolveCanvasAlphaColor/);
  assert.doesNotMatch(chartSource, /cssColorAlpha\(chartColor/);
});

test("shadow account treemap empty state does not mention bridge streaming", () => {
  const accountSource = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");
  const treemapSource = readFileSync(
    new URL("./PositionTreemapPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(accountSource, /Shadow ledger positions are opened or marked/);
  assert.match(treemapSource, /emptyBody\s*=/);
  assert.match(treemapSource, /body=\{emptyBody\}/);
});
