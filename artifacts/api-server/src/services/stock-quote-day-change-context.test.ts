import assert from "node:assert/strict";
import test from "node:test";

import {
  __stockQuoteDayChangeContextTestInternals,
  enrichStockQuoteWithDayChangeContext,
  recordStockQuoteDayChangeContext,
} from "./stock-quote-day-change-context";

test("stock quote day-change context carries extended-hours baseline fields", () => {
  __stockQuoteDayChangeContextTestInternals.reset();

  recordStockQuoteDayChangeContext({
    symbol: "AAPL",
    price: 100,
    change: 1,
    changePercent: 1,
    open: 99,
    high: 101,
    low: 98,
    prevClose: 99,
    extendedBaselinePrice: 100,
    extendedBaselineAt: new Date("2026-06-09T20:00:00.000Z"),
    extendedBaselineSource: "regular_close",
    volume: 10_000,
    updatedAt: new Date("2026-06-09T20:01:00.000Z"),
  });

  const enriched = enrichStockQuoteWithDayChangeContext({
    symbol: "AAPL",
    price: 102,
    change: 0,
    changePercent: 0,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    extendedBaselinePrice: null,
    extendedBaselineAt: null,
    extendedBaselineSource: null,
    volume: null,
    updatedAt: new Date("2026-06-09T21:00:00.000Z"),
  });

  assert.equal(enriched.change, 3);
  assert.equal(enriched.changePercent, 3.0303030303030303);
  assert.equal(enriched.extendedBaselinePrice, 100);
  assert.deepEqual(
    enriched.extendedBaselineAt,
    new Date("2026-06-09T20:00:00.000Z"),
  );
  assert.equal(enriched.extendedBaselineSource, "regular_close");

  __stockQuoteDayChangeContextTestInternals.reset();
});

test("stock quote day-change context does not promote unverified extended baseline fields", () => {
  __stockQuoteDayChangeContextTestInternals.reset();

  recordStockQuoteDayChangeContext({
    symbol: "MSFT",
    price: 100,
    change: 1,
    changePercent: 1,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    extendedBaselinePrice: 100,
    extendedBaselineAt: new Date("2026-06-09T20:00:00.000Z"),
    extendedBaselineSource: null,
    volume: 10_000,
    updatedAt: new Date("2026-06-09T20:01:00.000Z"),
  });

  const enriched = enrichStockQuoteWithDayChangeContext({
    symbol: "MSFT",
    price: 102,
    change: 0,
    changePercent: 0,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    extendedBaselinePrice: null,
    extendedBaselineAt: null,
    extendedBaselineSource: null,
    volume: null,
    updatedAt: new Date("2026-06-09T21:00:00.000Z"),
  });

  assert.equal(enriched.extendedBaselinePrice, null);
  assert.equal(enriched.extendedBaselineAt, null);
  assert.equal(enriched.extendedBaselineSource, null);

  __stockQuoteDayChangeContextTestInternals.reset();
});
