import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("account day PnL prefers live position row day changes over summary fallback", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const start = source.indexOf("const livePositionsDayPnlMetric =");
  const end = source.indexOf("const livePositionsNetLiquidation", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(
    block,
    /const totalDayPnl = hasDayChange \? openPositionsDayPnl : fallbackValue;/,
  );
  assert.doesNotMatch(
    block,
    /const totalDayPnl = fallbackValue \?\? openPositionsDayPnl;/,
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
    /const accountAnalysisQueryForDisplay = tradesQueryForDisplay;/,
  );
  assert.match(
    source,
    /const accountAnalysisTradesForDisplay =\s*tradesQueryForDisplay\.data\?\.trades \|\| \[\];/,
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
    "snapTradeHistoryQuery",
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
    "ordersQuery",
    "riskQuery",
    "cashQuery",
  ]) {
    assert.match(
      source,
      new RegExp(`withoutFailedQueryData\\(\\s*${queryName},?\\s*\\)`),
      `${queryName} must not expose retained data after an error`,
    );
  }
});
