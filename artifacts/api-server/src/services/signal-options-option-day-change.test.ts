import assert from "node:assert/strict";
import test from "node:test";

import type { QuoteSnapshot } from "../providers/ibkr/client";
import { __quoteSnapshotToSignalOptionsQuoteForTests as convert } from "./signal-options-automation";

const contract = {
  ticker: "AAPL 2026-06-12 290 C",
  underlying: "AAPL",
  expirationDate: "2026-06-12",
  strike: 290,
  right: "call",
  multiplier: 100,
  sharesPerContract: 100,
  providerContractId: "conid-1",
};

const quoteWith = (overrides: Partial<QuoteSnapshot>): QuoteSnapshot =>
  ({
    symbol: "AAPL",
    price: 5.8,
    bid: 5.6,
    ask: 6.05,
    bidSize: 1,
    askSize: 1,
    change: 0,
    changePercent: 0,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: null,
    openInterest: null,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    updatedAt: new Date("2026-06-11T18:00:00.000Z"),
    providerContractId: "conid-1",
    transport: "rest",
    delayed: false,
    ...overrides,
  }) as unknown as QuoteSnapshot;

test("held option quote with a prior close gets a day change", () => {
  const result = convert({
    contract,
    quote: quoteWith({ price: 5.8, prevClose: 5.0, change: 0.8, changePercent: 16 }),
  });
  assert.equal(result.previousClose, 5.0);
  assert.equal(result.dayChange, 0.8);
  assert.equal(result.dayChangePercent, 16);
  // Day change must be consistent with the displayed mark (mark = price).
  assert.equal(result.mark, 5.8);
});

test("option quote without a prior close leaves day change unknown (not a fabricated $0)", () => {
  const result = convert({
    contract,
    // Bridge sets change = 0 when prevClose is null; we must NOT surface that as a value.
    quote: quoteWith({ price: 5.8, prevClose: null, change: 0, changePercent: 0 }),
  });
  assert.equal(result.previousClose, null);
  assert.equal(result.dayChange, null);
  assert.equal(result.dayChangePercent, null);
});

test("a genuinely flat option (prior close present, no move) reports $0, not unknown", () => {
  const result = convert({
    contract,
    quote: quoteWith({ price: 5.0, prevClose: 5.0, change: 0, changePercent: 0 }),
  });
  assert.equal(result.previousClose, 5.0);
  assert.equal(result.dayChange, 0);
  assert.equal(result.dayChangePercent, 0);
});
