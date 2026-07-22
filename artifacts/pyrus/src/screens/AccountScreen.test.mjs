import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("Account subscribes to stable broker freshness flags, not the timestamp version", () => {
  const source = readLocalSource("./AccountScreen.jsx");

  assert.match(source, /useBrokerStreamFreshnessStatus/);
  assert.doesNotMatch(source, /useBrokerStreamFreshnessSnapshot/);
});

test("Account reuses one empty orders value across unrelated parent renders", () => {
  const source = readLocalSource("./AccountScreen.jsx");

  assert.match(
    source,
    /const EMPTY_ACCOUNT_ORDERS = Object\.freeze\(\[\]\);/,
  );
  assert.doesNotMatch(
    source,
    /ordersQueryForDisplay\.data\?\.orders \|\| \[\]/,
  );
});

test("Account reuses one empty trades value across unrelated parent renders", () => {
  const source = readLocalSource("./AccountScreen.jsx");

  assert.match(
    source,
    /const EMPTY_ACCOUNT_TRADES = Object\.freeze\(\[\]\);/,
  );
  assert.doesNotMatch(
    source,
    /tradesQueryForDisplay\.data\?\.trades \|\| \[\]/,
  );
});

test("Trade Analysis uses a stable terminal-order snapshot independent of the Orders tab", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const analysisNeed = source.match(
    /const analysisOrderHistoryNeeded = Boolean\([\s\S]*?\n  \);/,
  )?.[0];
  const analysisQuery = source.match(
    /const analysisOrdersQuery = useGetAccountOrders[\s\S]*?\n  \);/,
  )?.[0];
  const workbench = source.match(
    /<LazyTradingAnalysisWorkbench[\s\S]*?\/>/,
  )?.[0];

  assert.ok(analysisNeed, "Missing demand gate for analysis order history");
  assert.match(analysisNeed, /activatedAccountPanels\.tradingAnalysis/);
  assert.match(analysisNeed, /tradingAnalysisView === "trades"/);
  assert.match(analysisNeed, /selectedAccountTradeId/);
  assert.ok(analysisQuery, "Missing dedicated analysis orders query");
  assert.match(analysisQuery, /tab: "history"/);
  assert.match(analysisQuery, /refetchInterval: false/);
  assert.match(analysisQuery, /analysisOrderHistoryNeeded/);
  assert.ok(workbench, "Missing Trading Analysis workbench");
  assert.match(workbench, /analysisOrdersQueryForDisplay\.data\?\.orders/);
  assert.doesNotMatch(workbench, /ordersQueryForDisplay\.data\?\.orders/);
});

test("deferred Account work is demand-gated and terminal orders do not poll", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const stream = source.match(
    /useAccountPageSnapshotStream\(\{[\s\S]*?\n  \}\);/,
  )?.[0];
  const ordersQuery = source.match(
    /const ordersQuery = useGetAccountOrders[\s\S]*?\n  \);/,
  )?.[0];
  const snapOrdersQuery = source.match(
    /const snapTradeRecentOrdersQuery = useGetSnapTradeRecentOrders[\s\S]*?\n  \);/,
  )?.[0];

  assert.ok(stream, "Missing Account page stream");
  assert.match(stream, /includeIntraday:/);
  assert.match(stream, /activatedAccountPanels\.today/);
  assert.match(stream, /includeWorkingOrders:/);
  assert.match(stream, /activatedAccountPanels\.orders/);
  assert.match(stream, /includeSetupHealth:/);
  assert.match(stream, /activatedAccountPanels\.support/);
  assert.ok(ordersQuery, "Missing Orders query");
  assert.match(
    ordersQuery,
    /refetchInterval:\s*effectiveOrderTab === "working"\s*\? liveRefreshInterval\s*:\s*false/,
  );
  assert.ok(snapOrdersQuery, "Missing SnapTrade recent-orders query");
  assert.match(
    snapOrdersQuery,
    /refetchInterval:\s*activatedAccountPanels\.orders && effectiveOrderTab === "working"\s*\? snapTradeRefreshInterval\s*:\s*false/,
  );
  assert.match(
    source,
    /enabled:\s*Boolean\([\s\S]*?activatedAccountPanels\.support[\s\S]*?\)/,
  );
});

test("account hero uses the authoritative whole-account summary", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const panel = source.match(/<AccountHeroBlock[\s\S]*?\/>/)?.[0];

  assert.ok(panel, "Missing AccountHeroBlock render");
  assert.match(panel, /summary=\{displaySummaryData\}/);
  assert.doesNotMatch(source, /const heroSummaryData =|livePositionsDayPnl/);
});

test("account hero exposes only inputs used by its production caller", () => {
  const screenSource = readLocalSource("./AccountScreen.jsx");
  const heroSource = readLocalSource("./account/AccountHeroBlock.jsx");
  const panel = screenSource.match(/<AccountHeroBlock[\s\S]*?\/>/)?.[0];

  assert.ok(panel, "Missing AccountHeroBlock render");
  assert.doesNotMatch(panel, /shadowMode=/);
  assert.doesNotMatch(panel, /benchmarkHistories=/);
  assert.doesNotMatch(heroSource, /returnsModel:\s*providedReturnsModel/);
  assert.doesNotMatch(heroSource, /shadowMode:\s*_shadowMode/);
  assert.doesNotMatch(heroSource, /providedReturnsModel/);
});

test("shadow equity graph renders the backend ledger history without a positions terminal", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const start = source.indexOf("const equityQueryForDisplay =");
  const end = source.indexOf("const accountAnalysisQueryForDisplay", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(block, /shadowMode\s*\?\s*equityQueryForPanel/);
  assert.match(block, /:\s*equityQueryWithLivePositionsTerminal\(/);

  const panel = source.match(/<LazyEquityCurvePanel[\s\S]*?\/>/)?.[0];
  assert.ok(panel, "Missing LazyEquityCurvePanel render");
  assert.match(
    panel,
    /currentNetLiquidation=\{\s*shadowMode \? null : livePositionNetLiquidation\s*\}/,
  );
});

test("active shadow stream is the only writer for the shared shadow summary key", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const start = source.indexOf("const shadowTabSummaryQuery =");
  const end = source.indexOf("const equityQuery =", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  assert.match(
    source.slice(start, end),
    /enabled:\s*Boolean\(isVisible && !shadowMode && !safeQaMode\)/,
  );
});

test("shadow account equity curve uses the shadow account tone", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const panel = source.match(/<LazyEquityCurvePanel[\s\S]*?\/>/)?.[0];

  assert.ok(panel, "Missing LazyEquityCurvePanel render");
  assert.match(
    panel,
    /accentColor=\{shadowMode \? CSS_COLOR\.pink : CSS_COLOR\.green\}/,
  );
});

test("account risk retries only degraded 503s and honors Retry-After", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const start = source.indexOf("const riskQuery = useGetAccountRisk");
  const end = source.indexOf(
    "const cashQuery = useGetAccountCashActivity",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(block, /retry:\s*retryDegradedAccountRisk/);
  assert.match(block, /retryDelay:\s*degradedAccountRiskRetryDelay/);
  assert.match(source, /errorStatus === 503/);
  assert.match(source, /errorCode === "degraded_upstream"/);
  assert.match(
    source,
    /failureCount < 1 && isDegradedAccountRiskError\(error\)/,
  );
  assert.match(
    source,
    /parseRetryAfterMs\(error\?\.headers\?\.get\?\.\("retry-after"\)\)/,
  );
  assert.match(source, /ACCOUNT_RISK_DEGRADED_RETRY_MS = 15_000/);
});

test("Account financial queries never render prior-query placeholder data", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  assert.doesNotMatch(source, /placeholderData\s*:/);
  assert.doesNotMatch(source, /useRuntimeControlSnapshot|accountRuntimeControl/);
  assert.doesNotMatch(
    source,
    /retainPreviousAccount(?:Data|RangeData|DateData)/,
  );
});

test("Account activity polling rejects retired degraded-empty responses", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  assert.doesNotMatch(source, /activityDegraded|activityReason/);
  assert.doesNotMatch(
    source,
    /closedTradesResponseIsDegradedEmpty|accountActivityRefetchInterval/,
  );
  assert.match(source, /refetchInterval: chartRefreshInterval/);
  assert.match(source, /refetchInterval: tradesRefreshInterval/);
});

test("Account keeps the requested range and trade filters when fresh data is empty", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  assert.doesNotMatch(source, /fallbackPoints|setRange\("1Y"\)/);
  assert.match(
    source,
    /const accountAnalysisQueryForDisplay = analysisTradesQueryForDisplay;/,
  );
  assert.match(
    source,
    /const accountAnalysisTradesForDisplay =\s*analysisTradesQueryForDisplay\.data\?\.trades \|\| EMPTY_ACCOUNT_TRADES;/,
  );
});

test("visible hero trades stay separate from activation-gated Analysis filters", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const heroQuery = source.match(
    /const tradesQuery = useGetAccountClosedTrades[\s\S]*?\n  \);/,
  )?.[0];
  const analysisQuery = source.match(
    /const analysisTradesQuery = useGetAccountClosedTrades[\s\S]*?\n  \);/,
  )?.[0];

  assert.ok(heroQuery, "Missing visible hero trades query");
  assert.match(heroQuery, /heroTradeParams/);
  assert.ok(analysisQuery, "Missing deferred Analysis trades query");
  assert.match(analysisQuery, /closedTradeParams/);
  assert.match(analysisQuery, /refetchInterval: false/);
  assert.match(analysisQuery, /tradingAnalysisQueriesEnabled/);
  assert.match(
    source,
    /genericAccountQueriesEnabled && activatedAccountPanels\.tradingAnalysis/,
  );
});

test("Account background code warmup includes every lazy panel shown on navigation", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const block = source.match(
    /export const preloadScreenModules = \(\) =>[\s\S]*?;\n\nconst finiteAccountNumber/,
  )?.[0];

  assert.ok(block, "missing Account screen preload contract");
  for (const loader of [
    "loadCashFundingPanel",
    "loadSetupHealthPanel",
    "loadPortfolioExposurePanel",
    "loadEquityCurvePanel",
    "loadTradingAnalysisWorkbench",
  ]) {
    assert.match(block, new RegExp(`${loader}\\(\\)`));
  }
});

test("Account panels hide TanStack-retained payloads after refetch errors", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  assert.match(
    source,
    /const withoutFailedQueryData = \(query\) =>\s*query\?\.isError \? \{ \.\.\.query, data: undefined \} : query;/,
  );

  for (const queryName of [
    "snapTradePortfolioQuery",
    "snapTradeRecentOrdersQuery",
    "healthQuery",
    "summaryQuery",
    "equityQuery",
    "intradayPnlQuery",
    "spyBenchmarkQuery",
    "qqqBenchmarkQuery",
    "djiaBenchmarkQuery",
    "allocationQuery",
    "positionsQuery",
    "positionsAtDateQuery",
    "performanceCalendarEquityQuery",
    "performanceCalendarTradesQuery",
    "tradesQuery",
    "analysisTradesQuery",
    "ordersQuery",
    "analysisOrdersQuery",
    "riskQuery",
    "cashQuery",
  ]) {
    assert.match(
      source,
      new RegExp(`withoutFailedQueryData\\(\\s*${queryName},?\\s*\\)`),
      `${queryName} must not expose retained data after an error`,
    );
  }
  assert.doesNotMatch(source, /snapTradeHistoryQuery/);
});
