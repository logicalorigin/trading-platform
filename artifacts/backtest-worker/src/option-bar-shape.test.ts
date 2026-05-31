import assert from "node:assert/strict";
import test from "node:test";
import {
  OPTIONS_AGGREGATE_BARS_WARNING,
  SIGNAL_OPTIONS_AGGREGATE_BARS_WARNING,
  hasHistoricalQuoteFields,
  normalizeApiBar,
  normalizeStoredHistoricalBar,
  toHistoricalBarInsert,
  type ApiBacktestBar,
} from "./backtest-bars";

const startsAt = new Date(Date.UTC(2024, 0, 2, 14, 30));

test("normalizeApiBar keeps current provider bars quote-empty", () => {
  const normalized = normalizeApiBar({
    timestamp: startsAt.toISOString(),
    open: 1.1,
    high: 1.25,
    low: 1,
    close: 1.15,
    volume: 100,
    source: "massive",
    delayed: true,
  } as ApiBacktestBar);

  assert.deepEqual(normalized, {
    startsAt,
    open: 1.1,
    high: 1.25,
    low: 1,
    close: 1.15,
    volume: 100,
    bid: null,
    ask: null,
    mid: null,
    quoteAsOf: null,
    providerContractId: null,
    source: "massive",
    delayed: true,
  });
  assert.equal(hasHistoricalQuoteFields(normalized), false);
});

test("toHistoricalBarInsert keeps quote columns nullable for OHLCV bars", () => {
  const insert = toHistoricalBarInsert("dataset-1", {
    startsAt,
    open: 1.1,
    high: 1.25,
    low: 1,
    close: 1.15,
    volume: 100,
  });

  assert.deepEqual(insert, {
    datasetId: "dataset-1",
    startsAt,
    open: "1.1",
    high: "1.25",
    low: "1",
    close: "1.15",
    volume: "100",
    bid: null,
    ask: null,
    mid: null,
    quoteAsOf: null,
    providerContractId: null,
  });
});

test("normalizeStoredHistoricalBar keeps old OHLCV rows quote-empty", () => {
  const normalized = normalizeStoredHistoricalBar({
    startsAt,
    open: "1.1",
    high: "1.25",
    low: "1",
    close: "1.15",
    volume: "100",
  });

  assert.deepEqual(normalized, {
    startsAt,
    open: 1.1,
    high: 1.25,
    low: 1,
    close: 1.15,
    volume: 100,
    bid: null,
    ask: null,
    mid: null,
    quoteAsOf: null,
    providerContractId: null,
  });
  assert.equal(hasHistoricalQuoteFields(normalized), false);
});

test("aggregate option-bar warnings remain explicit about missing NBBO replay", () => {
  assert.match(OPTIONS_AGGREGATE_BARS_WARNING, /historical quote\/NBBO replay is not available/);
  assert.match(
    SIGNAL_OPTIONS_AGGREGATE_BARS_WARNING,
    /historical bid\/ask freshness gates are reported as configuration only/,
  );
});
