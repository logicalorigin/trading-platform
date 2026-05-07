import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMiniChartBarsFromApi,
  mergeChartBarsByTime,
  resolveBrokerChartSourceState,
  resolveOptionChartSourceState,
} from "./chartApiBars.js";

const readLocalSource = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

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

test("mergeChartBarsByTime preserves historical context under live patches", () => {
  const historicalBars = buildMiniChartBarsFromApi([
    {
      timestamp: "2026-05-07T14:00:00.000Z",
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1_000,
      source: "ibkr-history",
    },
    {
      timestamp: "2026-05-07T14:15:00.000Z",
      open: 100.5,
      high: 102,
      low: 100,
      close: 101.5,
      volume: 1_200,
      source: "ibkr-history",
    },
  ]);
  const livePatch = buildMiniChartBarsFromApi([
    {
      timestamp: "2026-05-07T14:15:00.000Z",
      open: 100.5,
      high: 102.5,
      low: 100,
      close: 102,
      volume: 1_350,
      source: "ibkr-stock-quote-derived",
    },
  ]);

  const merged = mergeChartBarsByTime(historicalBars, livePatch);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].source, "ibkr-history");
  assert.equal(merged[1].source, "ibkr-stock-quote-derived");
  assert.equal(merged[1].c, 102);
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

test("resolveBrokerChartSourceState marks stock quote-derived bars as live", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: {
      source: "ibkr-stock-quote-derived",
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: "2026-05-04T14:30:03.000Z",
    },
    status: "live",
    timeframe: "5s",
    streamingEnabled: true,
    market: "stocks",
    nowMs: Date.parse("2026-05-04T14:30:04.000Z"),
  });

  assert.equal(state.state, "live");
  assert.equal(state.label, "IBKR LIVE");
  assert.equal(state.sourceLabel, "LIVE");
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

test("resolveBrokerChartSourceState marks stream fallback as degraded", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: {
      source: "ibkr-history",
      freshness: "live",
      marketDataMode: "live",
    },
    status: "fallback",
    timeframe: "1m",
    streamingEnabled: true,
    market: "stocks",
  });

  assert.equal(state.state, "fallback");
  assert.equal(state.label, "FALLBACK");
  assert.equal(state.tone, "warn");
  assert.equal(state.isFallback, true);
  assert.equal(state.isDegraded, true);
});

test("resolveOptionChartSourceState exposes stale cached option history", () => {
  const state = resolveOptionChartSourceState({
    identityReady: true,
    latestBar: {
      source: "ibkr-history",
      freshness: "live",
      marketDataMode: "live",
    },
    status: "live",
    timeframe: "1m",
    liveDataEnabled: true,
    dataSource: "ibkr-history",
    responseFreshness: "live",
    cacheStale: true,
  });

  assert.equal(state.state, "stale");
  assert.equal(state.label, "STALE");
  assert.equal(state.tone, "warn");
  assert.equal(state.freshness, "stale");
});

test("display chart price fallback stays on IBKR-only bars", () => {
  const source = readLocalSource("./chartApiBars.js");
  const fallbackBody = source.match(
    /export const useDisplayChartPriceFallbackBars = \([\s\S]*?\n\};/,
  )?.[0];

  assert.ok(fallbackBody, "display chart price fallback hook should exist");
  assert.match(fallbackBody, /allowHistoricalSynthesis:\s*false/);
  assert.doesNotMatch(fallbackBody, /allowHistoricalSynthesis:\s*true/);
});
