import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultConservativeOptionFillPolicy,
  defaultLegacyOptionFillPolicy,
  resolveOptionFill,
  type OptionFillPolicy,
} from "./option-fills";
import type { BacktestBar } from "./types";

function optionBar(overrides: Partial<BacktestBar> = {}): BacktestBar {
  const startsAt = new Date(Date.UTC(2024, 0, 2, 14, 30));
  return {
    startsAt,
    open: 1.1,
    high: 1.25,
    low: 1,
    close: 1.15,
    volume: 100,
    bid: 1.05,
    ask: 1.15,
    quoteAsOf: startsAt,
    ...overrides,
  };
}

test("legacy option fill preserves open-price behavior", () => {
  const decision = resolveOptionFill({
    bar: optionBar({ open: 1.23, bid: null, ask: null }),
    side: "buy",
    policy: defaultLegacyOptionFillPolicy,
  });

  assert.equal(decision.status, "filled");
  assert.equal(decision.fillPrice, 1.23);
  assert.equal(decision.reason, "legacy_open_slippage");
});

test("conservative option buy fills at ask for a fresh tight quote", () => {
  const decision = resolveOptionFill({
    bar: optionBar({ bid: 1.05, ask: 1.15 }),
    side: "buy",
    policy: defaultConservativeOptionFillPolicy,
    occurredAt: new Date(Date.UTC(2024, 0, 2, 14, 30, 5)),
  });

  assert.equal(decision.status, "filled");
  assert.equal(decision.fillPrice, 1.15);
  assert.equal(decision.reason, "quote_side");
  assert.ok(
    decision.diagnostics.spreadPercent != null &&
      Math.abs(decision.diagnostics.spreadPercent - 9.090909090909092) < 1e-9,
  );
});

test("conservative option sell fills at bid for a fresh tight quote", () => {
  const decision = resolveOptionFill({
    bar: optionBar({ bid: 1.05, ask: 1.15 }),
    side: "sell",
    policy: defaultConservativeOptionFillPolicy,
  });

  assert.equal(decision.status, "filled");
  assert.equal(decision.fillPrice, 1.05);
  assert.equal(decision.reason, "quote_side");
});

test("conservative option fill rejects missing bid or ask", () => {
  const decision = resolveOptionFill({
    bar: optionBar({ bid: null, ask: 1.15 }),
    side: "buy",
    policy: defaultConservativeOptionFillPolicy,
  });

  assert.equal(decision.status, "no_fill");
  assert.equal(decision.reason, "missing_quote");
});

test("conservative option fill rejects crossed quotes", () => {
  const decision = resolveOptionFill({
    bar: optionBar({ bid: 1.2, ask: 1.1 }),
    side: "buy",
    policy: defaultConservativeOptionFillPolicy,
  });

  assert.equal(decision.status, "no_fill");
  assert.equal(decision.reason, "crossed_quote");
});

test("conservative option fill rejects wide quotes", () => {
  const decision = resolveOptionFill({
    bar: optionBar({ bid: 0.75, ask: 1.25 }),
    side: "buy",
    policy: {
      ...defaultConservativeOptionFillPolicy,
      maxSpreadPctOfMid: 35,
    },
  });

  assert.equal(decision.status, "no_fill");
  assert.equal(decision.reason, "spread_too_wide");
});

test("conservative option fill rejects stale quotes", () => {
  const decision = resolveOptionFill({
    bar: optionBar({
      quoteAsOf: new Date(Date.UTC(2024, 0, 2, 14, 30, 0)),
    }),
    side: "buy",
    policy: {
      ...defaultConservativeOptionFillPolicy,
      maxQuoteAgeMs: 2_000,
    },
    occurredAt: new Date(Date.UTC(2024, 0, 2, 14, 30, 3)),
  });

  assert.equal(decision.status, "no_fill");
  assert.equal(decision.reason, "quote_stale");
});

test("post-and-wait fills when the limit is touched", () => {
  const policy: OptionFillPolicy = {
    ...defaultConservativeOptionFillPolicy,
    model: "post_and_wait",
    postAndWait: {
      entryOffsetPctOfSpread: 50,
      exitOffsetPctOfSpread: 50,
      maxWaitBars: 3,
      crossAfterBars: 3,
    },
  };
  const decision = resolveOptionFill({
    bar: optionBar({ bid: 1, ask: 1.2, low: 1.08 }),
    side: "buy",
    policy,
    orderAgeBars: 1,
  });

  assert.equal(decision.status, "filled");
  assert.equal(decision.fillPrice, 1.1);
  assert.equal(decision.reason, "post_and_wait_limit");
});

test("post-and-wait does not fill when the limit is not touched", () => {
  const policy: OptionFillPolicy = {
    ...defaultConservativeOptionFillPolicy,
    model: "post_and_wait",
    postAndWait: {
      entryOffsetPctOfSpread: 50,
      exitOffsetPctOfSpread: 50,
      maxWaitBars: 3,
      crossAfterBars: 3,
    },
  };
  const decision = resolveOptionFill({
    bar: optionBar({ bid: 1, ask: 1.2, low: 1.12 }),
    side: "buy",
    policy,
    orderAgeBars: 1,
  });

  assert.equal(decision.status, "no_fill");
  assert.equal(decision.reason, "limit_not_touched");
});

test("post-and-wait crosses after the configured bar age", () => {
  const policy: OptionFillPolicy = {
    ...defaultConservativeOptionFillPolicy,
    model: "post_and_wait",
    postAndWait: {
      entryOffsetPctOfSpread: 50,
      exitOffsetPctOfSpread: 50,
      maxWaitBars: 3,
      crossAfterBars: 2,
    },
  };
  const decision = resolveOptionFill({
    bar: optionBar({ bid: 1, ask: 1.2, low: 1.12 }),
    side: "buy",
    policy,
    orderAgeBars: 2,
  });

  assert.equal(decision.status, "filled");
  assert.equal(decision.fillPrice, 1.2);
  assert.equal(decision.reason, "quote_side");
});
