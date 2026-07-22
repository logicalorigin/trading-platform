import assert from "node:assert/strict";
import test from "node:test";

import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  __quoteSnapshotToSignalOptionsQuoteForTests as convert,
  __signalOptionsAutomationInternalsForTests,
} from "./signal-options-automation";
import { signalOptionsStopQuoteEvidence } from "./signal-options-stop-election";

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

test("signal option quotes keep display mark separate from provider last trade", () => {
  const occurredAt = new Date("2026-06-11T17:59:59.000Z");
  const lastTrade = {
    provider: "massive" as const,
    identity: "massive:SPY:1781200799000000000:316:5.1:2",
    price: 5.1,
    size: 2,
    occurredAt,
    sequenceNumber: null,
    exchange: "316",
    conditionCodes: ["209"],
    eligible: true,
  };
  const result = convert({
    contract,
    quote: quoteWith({
      price: 5.8,
      mark: 5.8,
      last: 5.1,
      lastTrade,
    }),
  });

  assert.equal(result.mark, 5.8);
  assert.equal(result.last, 5.1);
  assert.deepEqual(result.lastTrade, lastTrade);
});

test("the automation quote mapper preserves fresh server-receipt stop evidence", () => {
  const marketUpdatedAt = new Date("2026-06-11T16:00:00.000Z");
  const receivedAt = new Date("2026-06-11T18:00:00.000Z");
  const quote = convert({
    contract,
    quote: quoteWith({
      bid: 0.8,
      ask: 0.99,
      updatedAt: marketUpdatedAt,
      dataUpdatedAt: marketUpdatedAt,
      latency: { apiServerReceivedAt: receivedAt },
    }),
  });
  const evidence = signalOptionsStopQuoteEvidence({
    quote: quote as unknown as Record<string, unknown>,
    bid: quote.bid ?? null,
    ask: quote.ask ?? null,
    observedAt: receivedAt,
    maxAgeMs: 10_000,
    eligible: true,
  });

  assert.deepEqual(quote.latency, { apiServerReceivedAt: receivedAt });
  assert.ok(evidence);
  assert.equal(evidence.fresh, true);
  assert.match(evidence.identity, /^2026-06-11T18:00:00\.000Z:/);
});

test("signal option display fallback cannot become last-trade evidence", () => {
  const result = convert({
    contract,
    quote: quoteWith({ price: 5.8, mark: 5.8, last: null, lastTrade: null }),
  });

  assert.equal(result.mark, 5.8);
  assert.equal(result.last, null);
  assert.equal(result.lastTrade, null);
});

test("stop trade evidence uses provider identity and trade time for freshness", () => {
  const lastTrade = {
    provider: "massive" as const,
    identity: "massive:SPY:1781200799000000000:316:5.1:2",
    price: 5.1,
    size: 2,
    occurredAt: new Date("2026-06-11T17:59:59.000Z"),
    sequenceNumber: null,
    exchange: "316",
    conditionCodes: ["209"],
    eligible: true,
  };
  const quote = convert({
    contract,
    quote: quoteWith({ last: 5.1, lastTrade }),
  });
  const evidence =
    __signalOptionsAutomationInternalsForTests.signalOptionsStopTradeEvidence({
      quote,
      observedAt: new Date("2026-06-11T18:00:00.000Z"),
      maxAgeMs: 2_000,
    });

  assert.deepEqual(evidence, {
    price: 5.1,
    identity: lastTrade.identity,
    eligible: true,
    occurredAt: lastTrade.occurredAt,
    fresh: true,
  });
});

test("unknown or future last trades are fail-closed for stop election", () => {
  const lastTrade = {
    provider: "massive" as const,
    identity: "massive:SPY:future:316:5.1:2",
    price: 5.1,
    size: 2,
    occurredAt: new Date("2026-06-11T18:00:01.000Z"),
    sequenceNumber: null,
    exchange: "316",
    conditionCodes: ["999"],
    eligible: null,
  };
  const quote = convert({
    contract,
    quote: quoteWith({ last: 5.1, lastTrade }),
  });
  const evidence =
    __signalOptionsAutomationInternalsForTests.signalOptionsStopTradeEvidence({
      quote,
      observedAt: new Date("2026-06-11T18:00:00.000Z"),
      maxAgeMs: 2_000,
    });

  assert.equal(evidence?.eligible, false);
  assert.equal(evidence?.fresh, false);
});

test("an eligible but stale last trade is fail-closed for stop election", () => {
  const lastTrade = {
    provider: "massive" as const,
    identity: "massive:SPY:stale:316:5.1:2",
    price: 5.1,
    size: 2,
    occurredAt: new Date("2026-06-11T17:59:57.999Z"),
    sequenceNumber: null,
    exchange: "316",
    conditionCodes: ["209"],
    eligible: true,
  };
  const quote = convert({
    contract,
    quote: quoteWith({ last: 5.1, lastTrade }),
  });
  const evidence =
    __signalOptionsAutomationInternalsForTests.signalOptionsStopTradeEvidence({
      quote,
      observedAt: new Date("2026-06-11T18:00:00.000Z"),
      maxAgeMs: 2_000,
    });

  assert.equal(evidence?.eligible, true);
  assert.equal(evidence?.fresh, false);
});
