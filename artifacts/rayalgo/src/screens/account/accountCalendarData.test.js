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

test("account screen wires shadow account queries through the paper ledger path", () => {
  const source = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");

  assert.match(source, /mode:\s*shadowMode\s*\?\s*"paper"\s*:\s*environment\s*\|\|\s*"paper"/);
  assert.match(source, /const accountDataParams = useMemo/);
  assert.match(source, /sourceType: "all"/);
  assert.match(source, /const shadowSourceLabel = shadowMode \? "Shadow Ledger" : "Flex"/);
  assert.doesNotMatch(source, /accountShadowSourceFilter/);
  assert.doesNotMatch(source, /SHADOW_SOURCE_FILTERS/);
  assert.doesNotMatch(source, /source:\s*shadowDataSource/);
  assert.match(source, /const accountPageStreamEnabled = Boolean\(/);
  assert.match(source, /isVisible && accountQueriesEnabled/);
  assert.match(source, /useGetAccountSummary\(accountRequestId,\s*accountDataParams/);
  assert.match(source, /summary: displaySummaryData/);
  assert.match(source, /accountDateFilterBoundaryIso\(tradeFilters\.from\)/);
  assert.match(source, /accountDateFilterBoundaryIso\(tradeFilters\.to, \{ endOfDay: true \}\)/);
  assert.match(source, /buildPerformanceCalendarParams\(accountDataParams\)/);
  assert.match(source, /const equityHistoryQueriesEnabled\s*=\s*Boolean\(accountQueriesEnabled\)/);
  assert.match(source, /enabled:\s*equityHistoryQueriesEnabled/);
  assert.match(source, /visibleEquityBenchmarks/);
  assert.match(source, /enabled:\s*Boolean\(benchmarkQueriesEnabled && visibleEquityBenchmarks\.SPY\)/);
  assert.match(source, /enabled:\s*Boolean\(benchmarkQueriesEnabled && visibleEquityBenchmarks\.QQQ\)/);
  assert.match(source, /enabled:\s*Boolean\(benchmarkQueriesEnabled && visibleEquityBenchmarks\.DJIA\)/);
  assert.match(source, /visibleEquityBenchmarks\.SPY[\s\S]*spyBenchmarkQuery\.refetch/);
  assert.match(source, /if \(!visibleEquityBenchmarks\[key\]\)/);
  assert.match(source, /setHoveredEquityDate\(null\);[\s\S]*setPinnedEquityDate\(null\);/);
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
