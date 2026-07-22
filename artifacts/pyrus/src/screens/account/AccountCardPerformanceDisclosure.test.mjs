import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_CARD_PERIODS,
  accountCardQueryData,
  accountCardPeriodParams,
  buildAccountCardActivityMetrics,
  resolveAccountCardCurrency,
} from "./AccountCardPerformanceDisclosure.jsx";

test("account card query data fails closed on retained-data errors", () => {
  const retained = { trades: [{ id: "stale" }] };

  assert.equal(accountCardQueryData({ isError: true, data: retained }), null);
  assert.equal(accountCardQueryData({ isError: false, data: retained }), retained);
  assert.equal(accountCardQueryData(undefined), null);
});

test("account card currency requires one valid non-conflicting authority", () => {
  assert.equal(resolveAccountCardCurrency("usd", null, "USD"), "USD");
  assert.equal(resolveAccountCardCurrency(null, undefined, " "), null);
  assert.equal(resolveAccountCardCurrency("USD", "CAD"), null);
  assert.equal(resolveAccountCardCurrency("not-money", "USD"), null);
});

test("account card periods map 7D, 30D, and 90D onto existing account ranges", () => {
  assert.deepEqual(
    ACCOUNT_CARD_PERIODS.map(({ id, accountRange }) => ({
      id,
      accountRange,
    })),
    [
      { id: "7D", accountRange: "1W" },
      { id: "30D", accountRange: "1M" },
      { id: "90D", accountRange: "3M" },
    ],
  );

  const params = accountCardPeriodParams(
    "30D",
    Date.parse("2026-07-19T12:00:00.000Z"),
  );
  assert.equal(params.mode, "live");
  assert.match(params.from, /^2026-06-19T/u);
  assert.equal(params.to, undefined);
});

test("account card activity reports open positions, working orders, and gross exposure", () => {
  assert.deepEqual(
    buildAccountCardActivityMetrics({
      positions: [
        { quantity: 3, marketValue: 1_200 },
        { quantity: -2, marketValue: -800 },
        { quantity: 0, marketValue: 9_999 },
      ],
      orders: [{ id: "one" }, { id: "two" }],
    }),
    {
      openPositions: 2,
      workingOrders: 2,
      grossExposure: 2_000,
    },
  );

  assert.deepEqual(
    buildAccountCardActivityMetrics({ positions: [], orders: [] }),
    {
      openPositions: 0,
      workingOrders: 0,
      grossExposure: 0,
    },
  );
});

test("account card activity does not fabricate exposure from incomplete marks", () => {
  assert.deepEqual(
    buildAccountCardActivityMetrics({
      positions: [
        { quantity: 1, marketValue: 500 },
        { quantity: 1, marketValue: null },
      ],
      orders: [],
    }),
    {
      openPositions: 2,
      workingOrders: 0,
      grossExposure: null,
    },
  );
});
