import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { QuoteSnapshot } from "../providers/ibkr/client";
import type { OptionChainContract as MassiveOptionChainContract } from "../providers/massive/market-data";
import { __accountPositionInternalsForTests } from "./account";
import {
  __cacheMassiveOptionQuoteForTests,
  __massiveOptionSnapshotToQuoteSnapshotForTests,
  __resetMassiveOptionQuoteStreamForTests,
  fetchMassiveOptionQuoteSnapshots,
} from "./massive-option-quote-stream";

afterEach(() => {
  __resetMassiveOptionQuoteStreamForTests();
});

const providerContractId = "O:AAPL260612C00290000";

function quoteWith(overrides: Partial<QuoteSnapshot>): QuoteSnapshot {
  return {
    symbol: providerContractId,
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
    volume: 0,
    openInterest: 0,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    updatedAt: new Date("2026-06-11T18:00:00.000Z"),
    providerContractId,
    transport: "massive_rest",
    delayed: false,
    ...overrides,
  };
}

function accountQuoteFromDemandState(quote: QuoteSnapshot) {
  return __accountPositionInternalsForTests.accountOptionQuoteFromDemandState({
    status: "live",
    reason: null,
    quoteStatus: "live",
    quoteReason: null,
    greeksStatus: "live",
    greeksReason: null,
    providerContractId,
    quote,
    cacheAgeMs: null,
  } as never);
}

function massiveSnapshotWith(
  overrides: Partial<MassiveOptionChainContract>,
): MassiveOptionChainContract {
  return {
    contract: {
      ticker: providerContractId,
      underlying: "AAPL",
      expirationDate: new Date("2026-06-12T00:00:00.000Z"),
      strike: 290,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId,
    },
    bid: 5.6,
    ask: 6.05,
    last: 5.8,
    mark: 5.8,
    change: 0,
    changePercent: 0,
    prevClose: null,
    volume: 0,
    openInterest: 0,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    underlyingPrice: 201,
    updatedAt: new Date("2026-06-11T18:00:00.000Z"),
    ...overrides,
  };
}

test("REST option quote treats change=0 without prior close as unknown", () => {
  const result = accountQuoteFromDemandState(
    quoteWith({ prevClose: null, change: 0, changePercent: 0 }),
  );

  assert.equal(result?.dayChange, null);
  assert.equal(result?.dayChangePercent, null);
});

test("REST option quote keeps a real flat day change when prior close is present", () => {
  const result = accountQuoteFromDemandState(
    quoteWith({ price: 5, prevClose: 5, change: 0, changePercent: 0 }),
  );

  assert.equal(result?.dayChange, 0);
  assert.equal(result?.dayChangePercent, 0);
});

test("massive option quote treats change=0 without prior close as unknown", async () => {
  const quote = __massiveOptionSnapshotToQuoteSnapshotForTests(
    massiveSnapshotWith({ prevClose: null, change: 0, changePercent: 0 }),
    providerContractId,
    false,
  );

  assert.equal(quote.prevClose, null);
  assert.equal(quote.change, null);
  assert.equal(quote.changePercent, null);

  __cacheMassiveOptionQuoteForTests(quote);
  const payload = await fetchMassiveOptionQuoteSnapshots({
    underlying: "AAPL",
    providerContractIds: [providerContractId],
    owner: "option-quote-day-change-guard:test",
    intent: "account-monitor-live",
    requiresGreeks: false,
  });

  assert.equal(payload.quotes[0]?.change, null);
  assert.equal(payload.quotes[0]?.changePercent, null);
});

test("massive option quote keeps a real flat day change when prior close is present", () => {
  const quote = __massiveOptionSnapshotToQuoteSnapshotForTests(
    massiveSnapshotWith({ mark: 5, prevClose: 5, change: 0, changePercent: 0 }),
    providerContractId,
    false,
  );

  assert.equal(quote.prevClose, 5);
  assert.equal(quote.change, 0);
  assert.equal(quote.changePercent, 0);
});
