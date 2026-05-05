import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMiniChartBarsFromApi,
  resolveBrokerChartSourceState,
} from "./chartApiBars.js";

test("buildMiniChartBarsFromApi preserves source freshness metadata", () => {
  const [bar] = buildMiniChartBarsFromApi([
    {
      timestamp: "2026-05-04T14:30:00.000Z",
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1234,
      source: "ibkr-history",
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: "2026-05-04T14:30:05.000Z",
      ageMs: 5000,
      delayed: false,
    },
  ]);

  assert.equal(bar.source, "ibkr-history");
  assert.equal(bar.freshness, "live");
  assert.equal(bar.marketDataMode, "live");
  assert.equal(bar.dataUpdatedAt, "2026-05-04T14:30:05.000Z");
  assert.equal(bar.ageMs, 5000);
  assert.equal(bar.delayed, false);
});

test("resolveBrokerChartSourceState marks IBKR websocket bars as live", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: {
      source: "ibkr-websocket-derived",
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: "2026-05-04T14:30:00.000Z",
    },
    status: "live",
    timeframe: "15m",
    streamingEnabled: true,
    market: "stocks",
    nowMs: Date.parse("2026-05-04T14:30:10.000Z"),
  });

  assert.equal(state.state, "live");
  assert.equal(state.label, "IBKR WS");
  assert.equal(state.tone, "good");
  assert.equal(state.isRealtime, true);
  assert.equal(state.isDegraded, false);
});

test("resolveBrokerChartSourceState keeps rolled IBKR websocket bars live", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: {
      source: "ibkr-websocket-derived:rollup",
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: "2026-05-04T14:30:00.000Z",
    },
    status: "live",
    timeframe: "30m",
    streamingEnabled: true,
    market: "stocks",
    nowMs: Date.parse("2026-05-04T14:30:10.000Z"),
  });

  assert.equal(state.state, "live");
  assert.equal(state.label, "IBKR WS");
  assert.equal(state.sourceLabel, "WS ROLL");
  assert.equal(state.tone, "good");
  assert.equal(state.isRealtime, true);
  assert.equal(state.isDegraded, false);
});

test("resolveBrokerChartSourceState warns when an intraday stock chart is stuck on history", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: {
      source: "ibkr-history:rollup",
      freshness: "live",
      marketDataMode: "live",
    },
    status: "live",
    timeframe: "30m",
    streamingEnabled: true,
    market: "stocks",
  });

  assert.equal(state.state, "degraded");
  assert.equal(state.label, "IBKR HIST ROLL");
  assert.equal(state.sourceLabel, "IBKR ROLL");
  assert.equal(state.tone, "warn");
  assert.equal(state.isDegraded, true);
});

test("resolveBrokerChartSourceState identifies delayed fallback feeds", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: {
      source: "polygon-delayed-websocket",
      freshness: "delayed",
      marketDataMode: "delayed",
      delayed: true,
    },
    status: "live",
    timeframe: "1m",
    streamingEnabled: true,
    market: "stocks",
  });

  assert.equal(state.state, "delayed");
  assert.equal(state.label, "DELAYED");
  assert.equal(state.isDelayed, true);
  assert.equal(state.isDegraded, true);
});
