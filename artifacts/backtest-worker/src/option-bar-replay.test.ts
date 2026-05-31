import assert from "node:assert/strict";
import test from "node:test";
import {
  hasHistoricalQuoteFields,
  normalizeApiBar,
  normalizeStoredHistoricalBar,
  toHistoricalBarInsert,
  type ApiBacktestBar,
} from "./backtest-bars";

const startsAt = new Date(Date.UTC(2024, 0, 2, 14, 30));
const quoteAsOf = new Date(Date.UTC(2024, 0, 2, 14, 29, 58));

test("normalizeApiBar preserves optional option quote fields when present", () => {
  const normalized = normalizeApiBar({
    timestamp: startsAt.toISOString(),
    open: 1.1,
    high: 1.25,
    low: 1,
    close: 1.15,
    volume: 100,
    source: "massive",
    delayed: false,
    bid: 1.05,
    ask: 1.15,
    mid: 1.1,
    quoteAsOf: quoteAsOf.toISOString(),
    providerContractId: "contract-1",
  } as ApiBacktestBar);

  assert.equal(normalized.bid, 1.05);
  assert.equal(normalized.ask, 1.15);
  assert.equal(normalized.mid, 1.1);
  assert.deepEqual(normalized.quoteAsOf, quoteAsOf);
  assert.equal(normalized.providerContractId, "contract-1");
  assert.equal(hasHistoricalQuoteFields(normalized), true);
});

test("historical bar inserts include nullable quote fields", () => {
  const insert = toHistoricalBarInsert("dataset-1", {
    startsAt,
    open: 1.1,
    high: 1.25,
    low: 1,
    close: 1.15,
    volume: 100,
    bid: 1.05,
    ask: 1.15,
    mid: 1.1,
    quoteAsOf,
    providerContractId: "contract-1",
  });

  assert.deepEqual(insert, {
    datasetId: "dataset-1",
    startsAt,
    open: "1.1",
    high: "1.25",
    low: "1",
    close: "1.15",
    volume: "100",
    bid: "1.05",
    ask: "1.15",
    mid: "1.1",
    quoteAsOf,
    providerContractId: "contract-1",
  });
});

test("stored quote-enriched historical bars replay quote fields", () => {
  const normalized = normalizeStoredHistoricalBar({
    startsAt,
    open: "1.1",
    high: "1.25",
    low: "1",
    close: "1.15",
    volume: "100",
    bid: "1.05",
    ask: "1.15",
    mid: "1.1",
    quoteAsOf,
    providerContractId: "contract-1",
  });

  assert.equal(normalized.bid, 1.05);
  assert.equal(normalized.ask, 1.15);
  assert.equal(normalized.mid, 1.1);
  assert.deepEqual(normalized.quoteAsOf, quoteAsOf);
  assert.equal(normalized.providerContractId, "contract-1");
});
