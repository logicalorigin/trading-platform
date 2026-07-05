import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeBrokerChartSource,
  describeBrokerChartStatus,
  resolveBrokerChartSourceState,
  resolveOptionChartSourceState,
} from "./chartApiBars.js";

// Provider-accurate chart badge labels: only genuinely-IBKR sources may be
// branded "IBKR". Non-IBKR (Massive) live data must read as neutral "LIVE".

test("describeBrokerChartSource maps massive quote-derived sources to neutral LIVE", () => {
  assert.equal(describeBrokerChartSource("massive-stock-quote-derived"), "LIVE");
  assert.equal(describeBrokerChartSource("massive-option-quote-derived"), "LIVE");
  assert.equal(describeBrokerChartSource("ibkr-stock-quote-derived"), "LIVE");
});

test("describeBrokerChartStatus is provider-neutral (no IBKR prefix)", () => {
  assert.equal(describeBrokerChartStatus("live", "5m"), "LIVE 5m");
  assert.equal(describeBrokerChartStatus("stale", "5m"), "stale");
});

test("genuine IBKR stock quote-derived bar stays IBKR LIVE", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: {
      source: "ibkr-stock-quote-derived",
      marketDataMode: "live",
      freshness: "live",
    },
    status: "live",
    timeframe: "5m",
    market: "stocks",
  });
  assert.equal(state.state, "live");
  assert.equal(state.label, "IBKR LIVE");
  assert.equal(state.tone, "good");
});

test("genuine IBKR websocket bar stays IBKR WS", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: { source: "ibkr-websocket-derived", marketDataMode: "live" },
    status: "live",
    timeframe: "1m",
    market: "stocks",
  });
  assert.equal(state.label, "IBKR WS");
});

test("massive realtime stock quote-derived bar reads LIVE, never IBKR", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: {
      source: "massive-stock-quote-derived",
      marketDataMode: "live",
      freshness: "live",
    },
    status: "live",
    timeframe: "5m",
    market: "stocks",
  });
  assert.equal(state.state, "live");
  assert.equal(state.isRealtime, true);
  assert.equal(state.label, "LIVE");
  assert.equal(state.tone, "good");
  assert.doesNotMatch(state.label, /IBKR/);
});

test("massive delayed stock quote-derived bar reads DELAYED, never IBKR", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: {
      source: "massive-stock-quote-derived",
      marketDataMode: "delayed",
      freshness: "delayed",
    },
    status: "live",
    timeframe: "5m",
    market: "stocks",
  });
  assert.equal(state.label, "DELAYED");
  assert.doesNotMatch(state.label, /IBKR/);
});

test("marketDataMode live alone no longer classifies a non-IBKR source as IBKR", () => {
  const state = resolveBrokerChartSourceState({
    latestBar: { source: "massive-websocket", marketDataMode: "live" },
    status: "live",
    timeframe: "5m",
    market: "stocks",
  });
  assert.doesNotMatch(state.label, /IBKR/);
});

test("massive realtime option quote-derived bar reads live, never IBKR", () => {
  const state = resolveOptionChartSourceState({
    latestBar: {
      source: "massive-option-quote-derived",
      marketDataMode: "live",
      freshness: "live",
    },
    status: "live",
    timeframe: "5m",
    liveDataEnabled: true,
  });
  assert.equal(state.label, "live");
  assert.doesNotMatch(String(state.label), /IBKR/i);
});

// Runtime-quote → bar-source mapping: the live ticker store carries a mixed
// source vocabulary; IBKR bar branding must be earned by an ibkr* source, not
// be the fallback (2026-07-02 runtime regression: store held
// "massive-websocket" and every quote patch fell back to IBKR branding).
import { __chartStreamingTestInternals } from "./useMassiveStreamedStockBars";

const { resolveEquityQuotePatchSource } = __chartStreamingTestInternals;

test("massive runtime-quote vocabulary patches as massive-derived", () => {
  for (const source of [
    "massive",
    "massive-websocket",
    "massive-delayed-websocket",
    "stock-aggregate",
    "signal-monitor",
    null,
    undefined,
  ]) {
    assert.equal(
      resolveEquityQuotePatchSource(source),
      "massive-stock-quote-derived",
      `source=${String(source)} must not brand IBKR`,
    );
  }
});

test("ibkr runtime-quote vocabulary patches as ibkr-derived", () => {
  for (const source of ["ibkr", "ibkr-websocket-derived"]) {
    assert.equal(
      resolveEquityQuotePatchSource(source),
      "ibkr-stock-quote-derived",
      `source=${String(source)} must brand IBKR`,
    );
  }
});
