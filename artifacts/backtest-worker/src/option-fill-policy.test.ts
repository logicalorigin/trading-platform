import assert from "node:assert/strict";
import test from "node:test";
import type { BacktestBar, StrategyParameters } from "@workspace/backtest-core";
import {
  formatOptionFillNoFillWarning,
  isQuoteReplayEligible,
  resolveWorkerOptionFill,
  resolveWorkerOptionFillPolicy,
  resolveWorkerSameBarConservativeExit,
} from "./option-fill-policy";

const startsAt = new Date(Date.UTC(2024, 0, 2, 14, 30));

function optionBar(overrides: Partial<BacktestBar> = {}): BacktestBar {
  return {
    startsAt,
    open: 1.1,
    high: 1.25,
    low: 1,
    close: 1.15,
    volume: 100,
    bid: 1.05,
    ask: 1.15,
    mid: 1.1,
    quoteAsOf: startsAt,
    providerContractId: "contract-1",
    ...overrides,
  };
}

test("resolveWorkerOptionFillPolicy remains disabled unless explicitly selected", () => {
  assert.equal(resolveWorkerOptionFillPolicy({}), null);
  assert.equal(
    resolveWorkerOptionFillPolicy({
      optionFillModel: "legacy_open_slippage",
    } as StrategyParameters),
    null,
  );
  assert.equal(
    resolveWorkerOptionFillPolicy({
      optionFillModel: "conservative_quote",
    } as StrategyParameters)?.model,
    "conservative_quote",
  );
  assert.equal(
    resolveWorkerOptionFillPolicy({
      optionFillModel: "post_and_wait",
    } as StrategyParameters),
    null,
  );
});

test("quote replay eligibility blocks aggregated or OHLCV-only bars", () => {
  assert.equal(isQuoteReplayEligible("5m", [optionBar()]), false);
  assert.equal(isQuoteReplayEligible("1m", [optionBar({ bid: null, ask: null })]), false);
  assert.equal(isQuoteReplayEligible("1m", [optionBar()]), true);
});

test("worker conservative fills buy at ask and sell at bid", () => {
  const policy = resolveWorkerOptionFillPolicy({
    optionFillModel: "conservative_quote",
  } as StrategyParameters);
  assert.ok(policy);

  const buy = resolveWorkerOptionFill({
    bar: optionBar(),
    side: "buy",
    policy,
    occurredAt: startsAt,
  });
  const sell = resolveWorkerOptionFill({
    bar: optionBar(),
    side: "sell",
    policy,
    occurredAt: startsAt,
  });

  assert.equal(buy.status, "filled");
  assert.equal(buy.fillPrice, 1.15);
  assert.equal(sell.status, "filled");
  assert.equal(sell.fillPrice, 1.05);
});

test("worker conservative fills reject missing and stale quotes without fallback", () => {
  const policy = resolveWorkerOptionFillPolicy({
    optionFillModel: "conservative_quote",
    optionFillMaxQuoteAgeMs: 2_000,
  } as StrategyParameters);
  assert.ok(policy);

  const missing = resolveWorkerOptionFill({
    bar: optionBar({ bid: null }),
    side: "buy",
    policy,
    occurredAt: startsAt,
  });
  const stale = resolveWorkerOptionFill({
    bar: optionBar({
      quoteAsOf: new Date(Date.UTC(2024, 0, 2, 14, 29, 55)),
    }),
    side: "sell",
    policy,
    occurredAt: startsAt,
  });

  assert.equal(missing.status, "no_fill");
  assert.equal(missing.reason, "missing_quote");
  assert.equal(stale.status, "no_fill");
  assert.equal(stale.reason, "quote_stale");
});

test("worker conservative fills reject crossed and wide quotes without fallback", () => {
  const policy = resolveWorkerOptionFillPolicy({
    optionFillModel: "conservative_quote",
    optionFillMaxSpreadPct: 10,
  } as StrategyParameters);
  assert.ok(policy);

  const crossed = resolveWorkerOptionFill({
    bar: optionBar({ bid: 1.2, ask: 1.1, mid: 1.15 }),
    side: "buy",
    policy,
    occurredAt: startsAt,
  });
  const wide = resolveWorkerOptionFill({
    bar: optionBar({ bid: 1, ask: 1.3, mid: 1.15 }),
    side: "sell",
    policy,
    occurredAt: startsAt,
  });

  assert.equal(crossed.status, "no_fill");
  assert.equal(crossed.reason, "crossed_quote");
  assert.equal(wide.status, "no_fill");
  assert.equal(wide.reason, "spread_too_wide");
});

test("no-fill warnings include model, side, symbol, timestamp, and reason", () => {
  const warning = formatOptionFillNoFillWarning({
    symbol: "SPY",
    optionTicker: "O:SPY240119C00480000",
    side: "buy",
    model: "conservative_quote",
    occurredAt: startsAt,
    reason: "missing_quote",
  });

  assert.match(warning, /SPY/);
  assert.match(warning, /O:SPY240119C00480000/);
  assert.match(warning, /buy/);
  assert.match(warning, /conservative_quote/);
  assert.match(warning, /2024-01-02T14:30:00.000Z/);
  assert.match(warning, /missing_quote/);
});

test("same-bar conservative exit chooses the worse long-option stop path", () => {
  const exit = resolveWorkerSameBarConservativeExit({
    entryBar: optionBar({ low: 0.7, bid: 0.72, ask: 0.76 }),
    entryPrice: 1.15,
    hardStopPct: -25,
  });

  assert.deepEqual(exit, {
    price: 0.72,
    reason: "signal_options_hard_stop_same_bar",
  });
});
