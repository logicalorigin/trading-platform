import assert from "node:assert/strict";
import test from "node:test";

import {
  formatChartBarCount,
  resolveChartLoadingStatus,
} from "./chartLoadingStatusModel";

test("formatChartBarCount compacts larger loaded bar counts", () => {
  assert.equal(formatChartBarCount(null), "--");
  assert.equal(formatChartBarCount(80), "80");
  assert.equal(formatChartBarCount(1_240), "1.2K");
  assert.equal(formatChartBarCount(12_400), "12K");
});

test("resolveChartLoadingStatus explains initial history fetches", () => {
  assert.deepEqual(
    resolveChartLoadingStatus({
      symbol: "NVDA",
      timeframe: "5m",
      providerLabel: "IBKR",
      renderedBarCount: 0,
      targetLimit: 500,
      isInitialLoading: true,
    }),
    {
      active: true,
      detail: "NVDA 5m · IBKR",
      label: "Fetching history",
      progressLabel: "0/500 bars",
      state: "loading",
      tone: "info",
    },
  );
});

test("resolveChartLoadingStatus distinguishes window hydration and older backfill", () => {
  assert.equal(
    resolveChartLoadingStatus({
      symbol: "SPY",
      timeframe: "15m",
      statusLabel: "IBKR history",
      renderedBarCount: 80,
      requestedLimit: 80,
      targetLimit: 500,
      isHydratingFullWindow: true,
    }).label,
    "Hydrating chart window",
  );

  const backfill = resolveChartLoadingStatus({
    symbol: "SPY",
    timeframe: "15m",
    statusLabel: "IBKR history",
    renderedBarCount: 640,
    maxLimit: 2_500,
    isPrependingOlder: true,
  });

  assert.equal(backfill.label, "Fetching older history");
  assert.equal(backfill.progressLabel, "640/2.5K bars");
  assert.equal(backfill.tone, "warn");
});

test("resolveChartLoadingStatus reports streaming and degraded chart states", () => {
  const streaming = resolveChartLoadingStatus({
    symbol: "AAPL",
    timeframe: "1m",
    statusLabel: "live",
    renderedBarCount: 120,
    hydratedBaseCount: 110,
    livePatchedBarCount: 10,
  });
  assert.equal(streaming.label, "Streaming");
  assert.equal(streaming.progressLabel, "110 + 10 live");
  assert.equal(streaming.tone, "good");

  const degraded = resolveChartLoadingStatus({
    symbol: "AAPL",
    timeframe: "1m",
    renderedBarCount: 0,
    emptyReason: "provider-timeout",
  });
  assert.equal(degraded.label, "Degraded");
  assert.equal(degraded.detail, "AAPL 1m · provider timeout");
  assert.equal(degraded.tone, "bad");
});
