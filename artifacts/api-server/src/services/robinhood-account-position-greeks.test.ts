import assert from "node:assert/strict";
import test from "node:test";

import type { BrokerPositionSnapshot } from "../providers/ibkr/client";
import { __accountPositionInternalsForTests } from "./account";

test("Robinhood option Greeks use the UUID-backed provider quote without a Massive chain join", async () => {
  const position: BrokerPositionSnapshot = {
    id: "robinhood:account:option:uuid",
    accountId: "account",
    symbol: "AAPL",
    assetClass: "option",
    providerSecurityType: "robinhood_option",
    quantity: 2,
    averagePrice: 2.5,
    marketPrice: 3,
    marketValue: 600,
    unrealizedPnl: 100,
    unrealizedPnlPercent: 20,
    optionContract: {
      ticker: "option-uuid",
      underlying: "AAPL",
      expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      strike: 200,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "option-uuid",
    },
    quote: {
      providerContractId: "option-uuid",
      bid: null,
      ask: null,
      mid: null,
      last: 3,
      mark: 3,
      spread: null,
      spreadPercent: null,
      bidSize: null,
      askSize: null,
      updatedAt: new Date("2026-07-15T20:00:00.000Z"),
      freshness: null,
      marketDataMode: null,
      source: "unknown",
      delta: 0.55,
      gamma: 0.04,
      theta: -0.08,
      vega: 0.12,
      impliedVolatility: 0.42,
    },
  };

  const enrichment =
    await __accountPositionInternalsForTests.enrichPositionGreeks([position]);
  const greek = enrichment.byPositionId.get(position.id);

  assert.ok(greek);
  assert.ok(Math.abs((greek.delta ?? 0) - 110) < 1e-9);
  assert.ok(Math.abs((greek.gamma ?? 0) - 8) < 1e-9);
  assert.ok(Math.abs((greek.theta ?? 0) + 16) < 1e-9);
  assert.ok(Math.abs((greek.vega ?? 0) - 24) < 1e-9);
  assert.equal(greek.impliedVolatility, 0.42);
  assert.equal(greek.source, "ROBINHOOD_OPTION_QUOTE");
  assert.equal(greek.matched, true);
  assert.equal(enrichment.matchedOptionPositions, 1);
});

test("combined Robinhood options keep the freshest native quote and Greeks", () => {
  const nativeOlder: NonNullable<BrokerPositionSnapshot["quote"]> = {
    providerContractId: "option-uuid",
    bid: null,
    ask: null,
    mid: null,
    last: 2.9,
    mark: 2.9,
    spread: null,
    spreadPercent: null,
    bidSize: null,
    askSize: null,
    updatedAt: new Date("2026-07-15T19:00:00.000Z"),
    freshness: null,
    marketDataMode: null,
    source: "unknown",
    delta: 0.5,
    gamma: 0.03,
    theta: -0.07,
    vega: 0.11,
    impliedVolatility: 0.4,
  };
  const nativeFreshest: NonNullable<BrokerPositionSnapshot["quote"]> = {
    ...nativeOlder,
    mark: 3,
    last: 3,
    updatedAt: new Date("2026-07-15T20:00:00.000Z"),
    delta: 0.55,
    gamma: 0.04,
    theta: -0.08,
    vega: 0.12,
    impliedVolatility: 0.42,
  };
  const genericOpra: NonNullable<BrokerPositionSnapshot["quote"]> = {
    ...nativeFreshest,
    providerContractId: "AAPL260821C00200000",
    bid: 8.9,
    ask: 9.1,
    mid: 9,
    mark: 9,
    last: 9,
    updatedAt: new Date("2026-07-15T21:00:00.000Z"),
    source: "option_quote",
    delta: 0.9,
    gamma: 0.9,
    theta: -0.9,
    vega: 0.9,
    impliedVolatility: 0.9,
  };

  const selected =
    __accountPositionInternalsForTests.selectCombinedPositionQuote(
      "robinhood_option",
      [nativeOlder, nativeFreshest],
      genericOpra,
    );

  assert.equal(selected, nativeFreshest);
  assert.equal(selected?.providerContractId, "option-uuid");
  assert.equal(selected?.delta, 0.55);
  assert.equal(selected?.gamma, 0.04);
  assert.equal(selected?.theta, -0.08);
  assert.equal(selected?.vega, 0.12);
  assert.equal(selected?.impliedVolatility, 0.42);
});
