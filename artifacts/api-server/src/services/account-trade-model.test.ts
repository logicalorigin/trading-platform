import assert from "node:assert/strict";
import test from "node:test";

import type { BrokerPositionSnapshot } from "../providers/ibkr/client";
import {
  accountOptionCalendarDte,
  accountTradeCurrenciesMatch,
  positionGroupKey,
  summarizeAccountClosedTrades,
} from "./account-trade-model";

function optionPosition(
  id: string,
  providerSecurityType: string,
): BrokerPositionSnapshot {
  return {
    id,
    accountId: id,
    symbol: "AAPL",
    assetClass: "option",
    providerSecurityType,
    quantity: 1,
    averagePrice: 2,
    marketPrice: 3,
    marketValue: 300,
    unrealizedPnl: 100,
    unrealizedPnlPercent: 50,
    optionContract: {
      ticker: id,
      underlying: "AAPL",
      expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      strike: 200,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: id,
    },
  };
}

test("Robinhood option UUIDs prevent structural merging with another contract", () => {
  const standard = optionPosition("O:AAPL260821C00200000", "option");
  const robinhood = optionPosition("robinhood-option-uuid", "robinhood_option");
  const otherRobinhood = optionPosition(
    "other-robinhood-option-uuid",
    "robinhood_option",
  );

  assert.notEqual(positionGroupKey(robinhood), positionGroupKey(standard));
  assert.notEqual(
    positionGroupKey(robinhood),
    positionGroupKey(otherRobinhood),
  );
});

test("closed-trade summaries preserve unknown outcomes and incomplete fees", () => {
  assert.deepEqual(
    summarizeAccountClosedTrades([
      { realizedPnl: 12, commissions: 1.5 },
      { realizedPnl: null, commissions: null },
    ]),
    {
      count: 2,
      outcomeCount: 1,
      feeCount: 1,
      winners: 1,
      losers: 0,
      realizedPnl: null,
      commissions: null,
    },
  );
  assert.deepEqual(summarizeAccountClosedTrades([]), {
    count: 0,
    outcomeCount: 0,
    feeCount: 0,
    winners: 0,
    losers: 0,
    realizedPnl: null,
    commissions: null,
  });
});

test("account option DTE uses New York calendar days across producers", () => {
  assert.equal(
    accountOptionCalendarDte(
      "2026-07-20",
      new Date("2026-07-18T02:00:00.000Z"),
    ),
    3,
  );
  assert.equal(
    accountOptionCalendarDte(
      "2026-03-09",
      new Date("2026-03-07T23:30:00-05:00"),
    ),
    2,
  );
  assert.equal(
    accountOptionCalendarDte(
      "2026-11-02",
      new Date("2026-10-31T23:30:00-04:00"),
    ),
    2,
  );
});

test("account option DTE rejects invalid dates and clamps expired contracts", () => {
  assert.equal(
    accountOptionCalendarDte(
      "2026-02-30",
      new Date("2026-02-01T15:00:00.000Z"),
    ),
    null,
  );
  assert.equal(
    accountOptionCalendarDte(
      "2026-01-31",
      new Date("2026-02-01T15:00:00.000Z"),
    ),
    0,
  );
  assert.equal(
    accountOptionCalendarDte("2026-07-21", new Date("not-a-date")),
    null,
  );
});

test("account trade populations require one complete declared currency", () => {
  assert.equal(
    accountTradeCurrenciesMatch(
      [{ currency: "usd" }, { currency: "USD" }],
      "USD",
    ),
    true,
  );
  assert.equal(
    accountTradeCurrenciesMatch(
      [{ currency: "USD" }, { currency: "CAD" }],
      "USD",
    ),
    false,
  );
  assert.equal(
    accountTradeCurrenciesMatch([{ currency: "" }], "USD"),
    false,
  );
});
