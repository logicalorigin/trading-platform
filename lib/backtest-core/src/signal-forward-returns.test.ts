import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSignalForwardReturnDataset,
  DEFAULT_SIGNAL_FORWARD_RETURN_HORIZONS_BARS,
  SIGNAL_FORWARD_RETURN_DATASET_VERSION,
  type SignalForwardReturnSignal,
} from "./signal-forward-returns";
import type { BacktestBar } from "./types";

function bar(day: number, minute: number, close: number): BacktestBar {
  return {
    startsAt: new Date(Date.UTC(2026, 0, day, 14, 30 + minute)),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000,
  };
}

function signal(
  overrides: Partial<SignalForwardReturnSignal> = {},
): SignalForwardReturnSignal {
  return {
    signalId: overrides.signalId ?? "sig-1",
    signalAt: overrides.signalAt ?? new Date(Date.UTC(2026, 0, 2, 14, 30)),
    symbol: overrides.symbol ?? "SPY",
    direction: overrides.direction ?? "long",
    score: Object.hasOwn(overrides, "score") ? overrides.score : 0.72,
    sourceStrategy: overrides.sourceStrategy ?? "pyrus-signals",
    sourceProfile: overrides.sourceProfile ?? "default",
    sourceTimeframe: overrides.sourceTimeframe ?? "5m",
  };
}

test("buildSignalForwardReturnDataset emits complete deterministic long windows", () => {
  const dataset = buildSignalForwardReturnDataset({
    signals: [signal()],
    barsBySymbol: {
      SPY: [
        bar(2, 0, 100),
        { ...bar(2, 5, 102), high: 104, low: 99 },
        { ...bar(2, 10, 101), high: 103, low: 98 },
        { ...bar(2, 15, 105), high: 106, low: 99 },
      ],
    },
    horizonsBars: [1, 3],
  });

  assert.equal(dataset.version, SIGNAL_FORWARD_RETURN_DATASET_VERSION);
  assert.deepEqual(DEFAULT_SIGNAL_FORWARD_RETURN_HORIZONS_BARS, [1, 3, 6]);
  assert.deepEqual(dataset.metadata.symbols, ["SPY"]);
  assert.equal(dataset.rows[0].status, "complete");
  assert.deepEqual(dataset.rows[0].reasons, []);
  assert.equal(dataset.rows[0].entryPrice, 100);
  assert.deepEqual(dataset.rows[0].windows[0], {
    horizonBars: 1,
    status: "complete",
    reason: null,
    expectedBars: 1,
    availableBars: 1,
    exitBarAt: new Date(Date.UTC(2026, 0, 2, 14, 35)),
    exitPrice: 102,
    realizedReturnPercent: 2,
    maxAdverseExcursionPercent: -1,
    maxFavorableExcursionPercent: 4,
    hit: true,
  });
  assert.equal(dataset.rows[0].windows[1].realizedReturnPercent, 5);
  assert.equal(dataset.rows[0].windows[1].maxAdverseExcursionPercent, -2);
  assert.equal(dataset.rows[0].windows[1].maxFavorableExcursionPercent, 6);
});

test("buildSignalForwardReturnDataset direction-adjusts short windows", () => {
  const dataset = buildSignalForwardReturnDataset({
    signals: [signal({ direction: "short" })],
    barsBySymbol: {
      SPY: [
        bar(2, 0, 100),
        { ...bar(2, 5, 96), high: 102, low: 94 },
        { ...bar(2, 10, 95), high: 101, low: 94 },
      ],
    },
    horizonsBars: [2],
  });

  const window = dataset.rows[0].windows[0];
  assert.equal(dataset.rows[0].status, "complete");
  assert.equal(window.realizedReturnPercent, 5);
  assert.equal(window.maxAdverseExcursionPercent, -2);
  assert.equal(window.maxFavorableExcursionPercent, 6);
  assert.equal(window.hit, true);
});

test("buildSignalForwardReturnDataset represents missing bars and missing score", () => {
  const dataset = buildSignalForwardReturnDataset({
    signals: [signal({ score: null, symbol: "QQQ" })],
    barsBySymbol: {
      SPY: [bar(2, 0, 100), bar(2, 5, 101)],
    },
    horizonsBars: [1],
  });

  const row = dataset.rows[0];
  assert.equal(row.status, "invalid");
  assert.deepEqual(row.reasons, [
    "score_missing",
    "missing_symbol_bars",
    "missing_entry_bar",
  ]);
  assert.equal(row.entryPrice, null);
  assert.deepEqual(row.windows[0], {
    horizonBars: 1,
    status: "missing_entry_bar",
    reason: "missing_entry_bar",
    expectedBars: 1,
    availableBars: 0,
    exitBarAt: null,
    exitPrice: null,
    realizedReturnPercent: null,
    maxAdverseExcursionPercent: null,
    maxFavorableExcursionPercent: null,
    hit: null,
  });
});

test("buildSignalForwardReturnDataset marks incomplete windows", () => {
  const dataset = buildSignalForwardReturnDataset({
    signals: [signal()],
    barsBySymbol: {
      SPY: [bar(2, 0, 100), bar(2, 5, 101)],
    },
    horizonsBars: [3],
  });

  const row = dataset.rows[0];
  assert.equal(row.status, "partial");
  assert.deepEqual(row.reasons, ["incomplete_forward_window"]);
  assert.equal(row.windows[0].status, "incomplete_window");
  assert.equal(row.windows[0].expectedBars, 3);
  assert.equal(row.windows[0].availableBars, 1);
  assert.equal(row.windows[0].hit, null);
});

test("buildSignalForwardReturnDataset marks duplicates and overlapping windows", () => {
  const signals = [
    signal({ signalId: "sig-1" }),
    signal({ signalId: "sig-2" }),
    signal({
      signalId: "sig-3",
      signalAt: new Date(Date.UTC(2026, 0, 2, 14, 35)),
    }),
  ];
  const dataset = buildSignalForwardReturnDataset({
    signals,
    barsBySymbol: {
      SPY: [bar(2, 0, 100), bar(2, 5, 101), bar(2, 10, 102), bar(2, 15, 103)],
    },
    horizonsBars: [2],
  });

  assert.deepEqual(dataset.rows[0].reasons, ["duplicate_signal"]);
  assert.deepEqual(dataset.rows[1].reasons, [
    "duplicate_signal",
    "overlapping_signal_window",
  ]);
  assert.deepEqual(dataset.rows[2].reasons, ["overlapping_signal_window"]);
  assert.equal(dataset.rows[2].status, "complete");
});

test("buildSignalForwardReturnDataset records mixed symbols and session boundary alignment", () => {
  const dataset = buildSignalForwardReturnDataset({
    signals: [
      signal({ symbol: "SPY" }),
      signal({
        signalId: "sig-2",
        symbol: "MSFT",
        signalAt: new Date(Date.UTC(2026, 0, 2, 23, 55)),
      }),
    ],
    barsBySymbol: {
      SPY: [bar(2, 0, 100), bar(2, 5, 101)],
      MSFT: [
        {
          ...bar(3, 0, 200),
          high: 202,
          low: 199,
        },
        {
          ...bar(3, 5, 204),
          high: 205,
          low: 201,
        },
      ],
    },
    horizonsBars: [1],
  });

  assert.deepEqual(dataset.metadata.symbols, ["MSFT", "SPY"]);
  assert.equal(dataset.metadata.hasMixedSymbols, true);
  assert.ok(dataset.rows[0].reasons.includes("mixed_symbol_dataset"));
  assert.ok(dataset.rows[1].reasons.includes("mixed_symbol_dataset"));
  assert.ok(dataset.rows[1].reasons.includes("entry_bar_after_signal"));
  assert.ok(dataset.rows[1].reasons.includes("session_boundary_aligned_to_next_bar"));
  assert.equal(dataset.rows[1].windows[0].realizedReturnPercent, 2);
});
