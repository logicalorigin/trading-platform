import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPerformanceCalendarParams,
  performanceCalendarQueriesEnabled,
  resolveReturnsCalendarData,
} from "./accountCalendarData.js";

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

