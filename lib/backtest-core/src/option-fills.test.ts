import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultConservativeOptionFillPolicy,
  resolveOptionFill,
} from "./option-fills";
import type { BacktestBar } from "./types";

const startsAt = new Date("2026-07-17T14:30:00.000Z");
const bar: BacktestBar = {
  startsAt,
  open: 1.1,
  high: 1.2,
  low: 1,
  close: 1.15,
  volume: 100,
  bid: 1.05,
  ask: 1.15,
  quoteAsOf: startsAt,
};
const policy = {
  ...defaultConservativeOptionFillPolicy,
  missingQuoteAction: "legacy_fallback" as const,
};

test("malformed numeric quotes cannot use the missing-quote legacy fallback", () => {
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    for (const field of ["bid", "ask"] as const) {
      const decision = resolveOptionFill({
        bar: { ...bar, [field]: invalid },
        side: "buy",
        policy,
        occurredAt: startsAt,
      });

      assert.equal(decision.status, "no_fill", `${field}=${invalid}`);
      assert.equal(decision.reason, "invalid_quote", `${field}=${invalid}`);
    }
  }

  const missing = resolveOptionFill({
    bar: { ...bar, bid: null },
    side: "buy",
    policy,
    occurredAt: startsAt,
  });
  assert.equal(missing.status, "filled");
  assert.equal(missing.reason, "legacy_open_slippage");
});
