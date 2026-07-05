import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalForwardReturnDataset,
  DEFAULT_SIGNAL_FORWARD_RETURN_COST_HURDLE_PERCENT,
  type SignalForwardReturnDirection,
  type SignalForwardReturnSignal,
} from "./signal-forward-returns";
import type { BacktestBar } from "./types";

const MINUTE = 60_000;
const BASE = new Date("2026-01-02T14:30:00.000Z").getTime();

function bar(index: number, close: number): BacktestBar {
  return {
    startsAt: new Date(BASE + index * MINUTE),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  };
}

// Run one signal with a horizon of 1 bar: closes[0] is the entry bar, closes[1]
// is the exit bar, so realizedReturnPercent is the entry->exit underlying move.
function runSingle(params: {
  direction: SignalForwardReturnDirection;
  closes: [number, number];
  spreadPctOfMid?: number | null;
  costHurdlePercent?: number;
}) {
  const bars = params.closes.map((close, index) => bar(index, close));
  const signal: SignalForwardReturnSignal = {
    signalId: "s1",
    signalAt: new Date(BASE),
    symbol: "TEST",
    direction: params.direction,
    score: 50,
    sourceStrategy: "strat",
    sourceProfile: "prof",
    sourceTimeframe: "1m",
    spreadPctOfMid: params.spreadPctOfMid,
  };
  const dataset = buildSignalForwardReturnDataset({
    signals: [signal],
    barsBySymbol: { TEST: bars },
    horizonsBars: [1],
    costHurdlePercent: params.costHurdlePercent,
  });
  const window = dataset.rows[0]?.windows.find((w) => w.horizonBars === 1);
  assert.ok(window, "expected a horizon-1 window");
  assert.equal(window.status, "complete");
  return window;
}

test("default cost hurdle sits between a barely-positive and a clear move", () => {
  // Precondition the flip cases below rely on.
  assert.ok(DEFAULT_SIGNAL_FORWARD_RETURN_COST_HURDLE_PERCENT > 0.03);
  assert.ok(DEFAULT_SIGNAL_FORWARD_RETURN_COST_HURDLE_PERCENT < 0.1);
});

test("a barely-positive underlying move flips from win to non-win under the hurdle", () => {
  const window = runSingle({ direction: "long", closes: [100, 100.03] });
  // Basis unchanged: still the raw +0.03% underlying move.
  assert.equal(window.realizedReturnPercent, 0.03);
  // > 0 (old definition counted this a hit) but <= the cost hurdle.
  assert.equal(window.hit, false);
});

test("a move clearly above the hurdle is still a hit", () => {
  const window = runSingle({ direction: "long", closes: [100, 100.1] });
  assert.equal(window.realizedReturnPercent, 0.1);
  assert.equal(window.hit, true);
});

test("a return exactly equal to the hurdle is not a hit (strictly greater)", () => {
  const window = runSingle({
    direction: "long",
    closes: [100, 100.1],
    costHurdlePercent: 0.1,
  });
  assert.equal(window.realizedReturnPercent, 0.1);
  assert.equal(window.hit, false);
});

test("per-signal spreadPctOfMid overrides the default hurdle", () => {
  const window = runSingle({
    direction: "long",
    closes: [100, 100.3],
    spreadPctOfMid: 0.5,
  });
  // +0.30% clears the 0.05% default but not the signal's own 0.5% spread.
  assert.equal(window.realizedReturnPercent, 0.3);
  assert.equal(window.hit, false);
});

test("dataset-wide costHurdlePercent applies when no per-signal spread", () => {
  const blocked = runSingle({
    direction: "long",
    closes: [100, 100.3],
    costHurdlePercent: 0.4,
  });
  assert.equal(blocked.hit, false);

  const allowed = runSingle({
    direction: "long",
    closes: [100, 100.3],
    costHurdlePercent: 0.2,
  });
  assert.equal(allowed.hit, true);
});

test("non-finite or negative spreadPctOfMid falls back to the default hurdle", () => {
  const nan = runSingle({
    direction: "long",
    closes: [100, 100.03],
    spreadPctOfMid: Number.NaN,
  });
  assert.equal(nan.hit, false); // default 0.05% still applies

  const negative = runSingle({
    direction: "long",
    closes: [100, 100.3],
    spreadPctOfMid: -1,
  });
  assert.equal(negative.hit, true); // ignored, default 0.05% cleared by 0.30%
});

test("short direction respects the hurdle on the underlying move", () => {
  const miss = runSingle({ direction: "short", closes: [100, 99.97] });
  assert.equal(miss.realizedReturnPercent, 0.03);
  assert.equal(miss.hit, false);

  const hit = runSingle({ direction: "short", closes: [100, 99.9] });
  assert.equal(hit.realizedReturnPercent, 0.1);
  assert.equal(hit.hit, true);
});
