import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOptionChartBarsRequest,
  normalizeApiBarForChart,
  shouldPatchOptionChartWithLiveQuote,
} from "./useOptionChartBars.js";

test("option chart request builder forwards history cursor continuation", () => {
  assert.deepEqual(
    buildOptionChartBarsRequest({
      underlying: "SPY",
      expirationDate: "2026-05-15",
      right: "C",
      strike: 525,
      optionTicker: "SPY260515C00525000",
      providerContractId: "12345",
      timeframe: "1m",
      limit: 240,
      from: "2026-05-01T13:30:00.000Z",
      to: "2026-05-01T20:00:00.000Z",
      outsideRth: true,
      historyCursor: "opaque-history-cursor",
      preferCursor: true,
    }),
    {
      underlying: "SPY",
      expirationDate: "2026-05-15",
      strike: 525,
      right: "C",
      optionTicker: "SPY260515C00525000",
      providerContractId: "12345",
      timeframe: "1m",
      limit: 240,
      from: "2026-05-01T13:30:00.000Z",
      to: "2026-05-01T20:00:00.000Z",
      outsideRth: true,
      historyCursor: "opaque-history-cursor",
      preferCursor: true,
    },
  );
});

test("option chart request builder omits invalid optional provider and cursor fields", () => {
  const request = buildOptionChartBarsRequest({
    underlying: "SPY",
    expirationDate: "2026-05-15",
    right: "P",
    strike: 500,
    providerContractId: "SPY260515P00500000",
    timeframe: "5m",
    limit: 120,
    historyCursor: "",
    preferCursor: true,
  });

  assert.equal(request.providerContractId, undefined);
  assert.equal(request.optionTicker, undefined);
  assert.equal(request.historyCursor, undefined);
  assert.equal(request.preferCursor, undefined);
});

test("option chart API normalization preserves volume fields", () => {
  const normalized = normalizeApiBarForChart({
    timestamp: "2026-05-04T14:30:00.000Z",
    open: 1,
    high: 1.25,
    low: 0.95,
    close: 1.1,
    volume: 125,
  });

  assert.equal(normalized.v, 125);
  assert.equal(normalized.volume, 125);
});

test("option chart API normalization accepts v volume aliases", () => {
  const normalized = normalizeApiBarForChart({
    timestamp: "2026-05-04T14:31:00.000Z",
    open: 1.1,
    high: 1.3,
    low: 1,
    close: 1.2,
    v: 80,
  });

  assert.equal(normalized.v, 80);
  assert.equal(normalized.volume, 80);
});

test("option charts patch from live IBKR quotes whenever live mode has a broker contract", () => {
  assert.equal(
    shouldPatchOptionChartWithLiveQuote({
      liveEnabled: true,
      providerContractId:
        "twsopt:eyJ2IjoxLCJ1IjoiU1BZIiwiZSI6IjIwMjYwNTE1IiwicyI6NzMwLCJyIjoiQyJ9",
    }),
    true,
  );
  assert.equal(
    shouldPatchOptionChartWithLiveQuote({
      liveEnabled: true,
      providerContractId: "SPY260515C00730000",
    }),
    false,
  );
  assert.equal(
    shouldPatchOptionChartWithLiveQuote({
      liveEnabled: false,
      providerContractId:
        "twsopt:eyJ2IjoxLCJ1IjoiU1BZIiwiZSI6IjIwMjYwNTE1IiwicyI6NzMwLCJyIjoiQyJ9",
    }),
    false,
  );
});
