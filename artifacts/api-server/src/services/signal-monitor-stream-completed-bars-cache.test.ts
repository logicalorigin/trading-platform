import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { pool } from "@workspace/db";

import { __signalMonitorInternalsForTests } from "./signal-monitor";
import {
  __stockAggregateStreamTestInternals,
  type StockMinuteAggregateMessage,
} from "./stock-aggregate-stream";

const {
  evaluateSignalMonitorMatrixStateFromStreamBars: evalStreamBars,
  getSignalMonitorStreamCompletedBarsCacheStats: barsCacheStats,
  recordSignalMonitorAggregateRevision: recordRevision,
  getSignalMonitorAggregateRevision: getRevision,
  resetSignalMonitorMatrixHeavyEvaluationCache: resetCaches,
} = __signalMonitorInternalsForTests;

after(async () => {
  await pool.end();
});

beforeEach(() => {
  resetCaches();
  __stockAggregateStreamTestInternals.reset();
});

const SYMBOL = "SPY";

const makeProfile = (settings: Record<string, unknown> = {}) =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    pyrusSignalsSettings: settings,
    freshWindowBars: 5,
  }) as never;

const aggregate = (startMs: number, close: number): StockMinuteAggregateMessage => ({
  eventType: "AM",
  symbol: SYMBOL,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1_000 + Math.round(close),
  accumulatedVolume: null,
  vwap: null,
  sessionVwap: null,
  officialOpen: null,
  averageTradeSize: null,
  startMs,
  endMs: startMs + 59_999,
  delayed: false,
  source: "massive-websocket",
});

// Push `count` one-minute aggregates into the in-memory ring, the freshest closing
// at `endIso`. Price waves so the pyrus indicator has real variation.
function primeRing(endIso: string, count = 150) {
  const endStartMs = new Date(endIso).getTime() - 60_000; // last COMPLETED minute
  for (let i = count - 1; i >= 0; i -= 1) {
    const startMs = endStartMs - i * 60_000;
    const close = 100 + Math.sin((count - i) / 4) * 3;
    __stockAggregateStreamTestInternals.ingestAggregateForTests(
      aggregate(startMs, Number(close.toFixed(2))),
    );
  }
}

const evalAt = (iso: string, timeframe = "1m") =>
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: timeframe as never,
    evaluatedAt: new Date(iso),
  });

// --- Out-of-order revision logic (the dirty-track's correctness backbone) ---

test("revision bumps ONLY on out-of-order minutes, not forward/forming updates", () => {
  const sym = "REVTEST";
  assert.equal(getRevision(sym), 0, "unseen symbol starts at 0");

  recordRevision(sym, 60_000); // first minute seen
  assert.equal(getRevision(sym), 0, "first message does not bump");

  recordRevision(sym, 60_000); // forming-minute update (same startMs)
  assert.equal(getRevision(sym), 0, "forming-minute update does not bump");

  recordRevision(sym, 120_000); // forward minute advance
  assert.equal(getRevision(sym), 0, "forward minute advance does not bump");

  recordRevision(sym, 60_000); // out-of-order correction to an older minute
  assert.equal(getRevision(sym), 1, "out-of-order correction bumps");

  recordRevision(sym, 180_000); // forward again
  assert.equal(getRevision(sym), 1, "forward after a correction does not bump again");

  recordRevision(sym, Number.NaN); // malformed startMs is ignored
  assert.equal(getRevision(sym), 1, "non-finite startMs is a no-op");
});

// --- completedBars cache hit/miss/skip semantics ---

test("identical (boundary, base, revision) reuses cached bars and is value-identical", () => {
  primeRing("2026-06-09T15:00:00.000Z");

  const r1 = evalAt("2026-06-09T15:00:00.000Z");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 0, misses: 1 });
  assert.ok(r1 && r1.status, "first eval produced a state");

  const r2 = evalAt("2026-06-09T15:00:00.000Z");
  // Second call within the same minute boundary skips load/merge: a cache hit.
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });
  // Reused bars must yield byte-identical output to the fresh compute.
  assert.deepEqual(r2, r1);
});

test("a hit holds across sub-minute evaluatedAt drift (same completed boundary)", () => {
  primeRing("2026-06-09T15:00:00.000Z");

  evalAt("2026-06-09T15:00:00.000Z");
  evalAt("2026-06-09T15:00:30.000Z"); // same 1m boundary 15:00:00
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });
});

test("crossing the completed-bar boundary busts the cell (re-aggregates)", () => {
  primeRing("2026-06-09T15:00:00.000Z");

  evalAt("2026-06-09T15:00:00.000Z");
  assert.equal(barsCacheStats().misses, 1);

  // One minute later: boundary advances 15:00:00 -> 15:01:00, so a forming minute
  // may have been promoted to completed -> must recompute, not skip.
  evalAt("2026-06-09T15:01:00.000Z");
  assert.equal(barsCacheStats().misses, 2);
  assert.equal(barsCacheStats().hits, 0);
});

test("an out-of-order correction busts the cell even within the same boundary", () => {
  primeRing("2026-06-09T15:00:00.000Z");

  // Seed the revision tracker's high-water mark (forward minute -> no bump), since
  // priming the ring does not run the enqueue path that maintains it.
  recordRevision(SYMBOL, new Date("2026-06-09T14:59:00.000Z").getTime());
  assert.equal(getRevision(SYMBOL), 0);

  evalAt("2026-06-09T15:00:00.000Z");
  evalAt("2026-06-09T15:00:00.000Z");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });

  // A late aggregate for an already-completed minute bumps the symbol revision,
  // which is part of the dirty key -> the next eval (same boundary) must recompute.
  recordRevision(SYMBOL, new Date("2026-06-09T14:50:00.000Z").getTime());
  assert.equal(getRevision(SYMBOL), 1, "out-of-order minute bumped the revision");
  evalAt("2026-06-09T15:00:00.000Z");
  assert.equal(barsCacheStats().misses, 2, "revision bump must bust the cell");
});
