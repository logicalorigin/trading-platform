import assert from "node:assert/strict";
import test from "node:test";

import { parseSnapshotQuote } from "./client";

test("IBKR midpoint fallback is never labeled as a last trade", () => {
  const quote = parseSnapshotQuote(
    "SPY",
    "756733",
    {
      "84": 0.9,
      "86": 1.1,
      "7059": 7,
      _updated: "2026-07-16T14:30:00.000Z",
    },
    "option",
  );

  assert.equal(quote.price, 1);
  assert.equal(quote.last, null);
  assert.equal(quote.lastTrade, null);
  assert.equal(quote.askSize, 0, "field 7059 is last size, not ask size");
});

test("IBKR last price remains display-only without a trade identity", () => {
  const quote = parseSnapshotQuote(
    "SPY",
    "756733",
    {
      "31": 0.95,
      "84": 0.9,
      "86": 1.1,
      _updated: "2026-07-16T14:30:00.000Z",
    },
    "option",
  );

  assert.equal(quote.last, 0.95);
  assert.equal(quote.lastTrade, null);
});
