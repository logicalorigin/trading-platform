import assert from "node:assert/strict";
import test from "node:test";

import { __accountTradeAnnotationInternalsForTests as internals } from "./account";

const activity = (side: string | null) =>
  ({
    id: `activity-${side ?? "missing"}`,
    accountId: "robinhood:U123",
    symbol: "AAPL",
    side,
    quantity: 1,
    price: 110,
    realizedGain: 8,
    currency: "USD",
    closedAt: new Date("2026-07-16T15:00:00.000Z"),
  }) as never;

test("Robinhood activity preserves valid direction and marks ambiguity unknown", () => {
  assert.equal(
    internals.robinhoodActivityToAccountTrade(activity("BUY"))?.side,
    "buy",
  );
  assert.equal(
    internals.robinhoodActivityToAccountTrade(activity(null))?.side,
    "unknown",
  );
  assert.equal(
    internals.robinhoodActivityToAccountTrade(activity("sideways"))?.side,
    "unknown",
  );
});
