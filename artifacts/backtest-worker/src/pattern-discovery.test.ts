import assert from "node:assert/strict";
import test from "node:test";

import type { BacktestBar } from "@workspace/backtest-core";

import {
  directionStateReader,
  patternKeyOf,
  sampleTransitions,
  scorePatterns,
  type DirectionEvent,
  type PatternOccurrence,
} from "./pattern-discovery";

const t = (minutes: number): number => Date.parse("2026-06-01T13:30:00.000Z") + minutes * 60_000;

const bar = (minutes: number, close: number): BacktestBar => ({
  startsAt: new Date(t(minutes)),
  open: close,
  high: close,
  low: close,
  close,
  volume: 1000,
});

test("directionStateReader forward-fills latest event at-or-before t, else none", () => {
  const events: DirectionEvent[] = [
    { timeMs: t(5), direction: "buy" },
    { timeMs: t(10), direction: "sell" },
  ];
  const read = directionStateReader(events);
  assert.equal(read(t(0)), "none"); // before first event
  assert.equal(read(t(5)), "buy"); // at the event (<=)
  assert.equal(read(t(7)), "buy"); // carried forward
  assert.equal(read(t(10)), "sell"); // next event
  assert.equal(read(t(99)), "sell"); // carried forward
});

test("patternKeyOf is canonical and order-stable", () => {
  assert.equal(
    patternKeyOf(["1m", "5m", "15m"], ["sell", "sell", "buy"]),
    "1m:sell|5m:sell|15m:buy",
  );
});

test("sampleTransitions emits one occurrence per pattern CHANGE (formation), not per bar", () => {
  // 1m flips sell@2, 5m is buy the whole time -> pattern changes at bar 0 (none/buy)
  // and at bar 2 (sell/buy), then holds. Expect exactly 2 occurrences.
  const baseBars = [0, 1, 2, 3, 4].map((m) => bar(m, 100));
  const eventsByTimeframe: Record<string, DirectionEvent[]> = {
    "1m": [{ timeMs: t(2), direction: "sell" }],
    "5m": [{ timeMs: t(-100), direction: "buy" }],
  };
  const occ = sampleTransitions({
    symbol: "TEST",
    timeframeSet: ["1m", "5m"],
    baseBars,
    eventsByTimeframe,
  });
  assert.equal(occ.length, 2);
  assert.equal(occ[0].patternKey, "1m:none|5m:buy"); // bar 0
  assert.equal(occ[1].patternKey, "1m:sell|5m:buy"); // bar 2 (the divergence)
  assert.equal(occ[1].occurredAt.getTime(), t(2));
});

test("scorePatterns aggregates forward returns per pattern/horizon, enforces min-sample, ranks by |t-stat|", () => {
  // Two patterns. "UP" pattern: price always rises +1% over 1 bar (strong long).
  // "FLAT" pattern: only 1 occurrence -> dropped by minSampleThreshold.
  const symbol = "TEST";
  // Build 12 bars rising 1% each step so a 1-bar-forward return is ~+1%.
  const bars: BacktestBar[] = Array.from({ length: 12 }, (_, i) => bar(i, 100 * 1.01 ** i));
  const barsBySymbol: Record<string, BacktestBar[]> = { [symbol]: bars };
  // 5 "UP" occurrences at bars 0..4 (each has a forward bar), 1 "FLAT" at bar 6.
  const occurrences: PatternOccurrence[] = [
    ...[0, 1, 2, 3, 4].map((m) => ({
      symbol,
      occurredAt: new Date(t(m)),
      patternKey: "1m:buy|5m:buy",
    })),
    { symbol, occurredAt: new Date(t(6)), patternKey: "1m:sell|5m:buy" },
  ];
  const { results } = scorePatterns({
    occurrences,
    barsBySymbol,
    baseTimeframe: "1m",
    horizonsBars: [1],
    minSampleThreshold: 3,
  });
  // FLAT (1 sample < 3) is dropped; only the UP pattern survives.
  assert.equal(results.length, 1);
  const up = results[0];
  assert.equal(up.patternKey, "1m:buy|5m:buy");
  assert.equal(up.horizonBars, 1);
  assert.equal(up.sampleCount, 5);
  assert.equal(up.bias, "long");
  assert.equal(up.winRatePct, 100); // every forward bar was up
  assert.ok((up.meanReturnPct ?? 0) > 0.9 && (up.meanReturnPct ?? 0) < 1.1); // ~+1%
  assert.equal(up.rank, 1);
});
