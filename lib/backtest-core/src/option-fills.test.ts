import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultConservativeOptionFillPolicy,
  defaultLegacyOptionFillPolicy,
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

for (const testCase of [
  { side: "buy", label: "buy entry" },
  { side: "sell", label: "sell exit" },
] as const) {
  test(`${testCase.label} rejects a quote observed after the fill`, () => {
    const decision = resolveOptionFill({
      bar: {
        ...bar,
        quoteAsOf: new Date(startsAt.getTime() + 30_000),
      },
      side: testCase.side,
      policy,
      occurredAt: startsAt,
    });

    assert.equal(decision.status, "no_fill");
    assert.equal(decision.reason, "invalid_quote");
  });
}

for (const testCase of [
  { occurredAt: undefined, label: "missing" },
  { occurredAt: new Date(Number.NaN), label: "invalid" },
] as const) {
  test(`${testCase.label} decision time rejects quote-based buy and sell fills`, () => {
    for (const side of ["buy", "sell"] as const) {
      const decision = resolveOptionFill({
        bar,
        side,
        policy,
        ...(testCase.occurredAt
          ? { occurredAt: testCase.occurredAt }
          : {}),
      });

      assert.equal(decision.status, "no_fill", side);
      assert.equal(decision.reason, "invalid_quote", side);
    }
  });
}

test("quote timestamp validation preserves current, stale, and legacy fills", () => {
  const current = resolveOptionFill({
    bar,
    side: "buy",
    policy,
    occurredAt: startsAt,
  });
  assert.equal(current.status, "filled");
  assert.equal(current.reason, "quote_side");

  const stale = resolveOptionFill({
    bar,
    side: "sell",
    policy,
    occurredAt: new Date(startsAt.getTime() + 30_000),
  });
  assert.equal(stale.status, "no_fill");
  assert.equal(stale.reason, "quote_stale");

  const legacy = resolveOptionFill({
    bar: {
      ...bar,
      quoteAsOf: new Date(startsAt.getTime() + 30_000),
    },
    side: "buy",
    policy: defaultLegacyOptionFillPolicy,
    occurredAt: startsAt,
  });
  assert.equal(legacy.status, "filled");
  assert.equal(legacy.reason, "legacy_open_slippage");
});
