import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { pool } from "@workspace/db";

import {
  __signalMonitorInternalsForTests,
  evaluateSignalMonitorMatrixStateFromCompletedBars,
} from "./signal-monitor";

const {
  getSignalMonitorMatrixHeavyEvaluationCacheStats: cacheStats,
  resetSignalMonitorMatrixHeavyEvaluationCache: resetCache,
} = __signalMonitorInternalsForTests;

after(async () => {
  await pool.end();
});

beforeEach(() => {
  resetCache();
});

// Bar at `iso`, 1-minute series; close drifts so the indicator has real variation.
const bar = (iso: string, close: number) =>
  ({
    timestamp: new Date(iso),
    dataUpdatedAt: new Date(iso),
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1_000 + Math.round(close),
    source: "massive-history",
    outsideRth: false,
    partial: false,
  }) as never;

// 90 one-minute bars ending 2026-06-09T15:00:00Z (RTH Tuesday), enough to warm the
// pyrus indicator. Deterministic price wave so a signal may or may not fire — the
// cache logic is signal-agnostic, we only need a stable, non-empty series.
function buildBars(count = 90) {
  const endMs = new Date("2026-06-09T15:00:00.000Z").getTime();
  const bars: unknown[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const iso = new Date(endMs - i * 60_000).toISOString();
    const close = 100 + Math.sin((count - i) / 4) * 3;
    bars.push(bar(iso, Number(close.toFixed(2))));
  }
  return bars;
}

const makeProfile = (
  settings: Record<string, unknown>,
  id = "11111111-1111-4111-8111-111111111111",
) =>
  ({
    id,
    pyrusSignalsSettings: settings,
    freshWindowBars: 5,
  }) as never;

const evalAt = (iso: string, profile: unknown, bars: unknown) =>
  evaluateSignalMonitorMatrixStateFromCompletedBars({
    profile: profile as never,
    symbol: "SPY",
    timeframe: "1m",
    evaluatedAt: new Date(iso),
    completedBars: bars as never,
  });

test("identical (settings, bars) hits the cache and skips the heavy indicator pass", () => {
  const profile = makeProfile({});
  const bars = buildBars();

  const r1 = evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.deepEqual(cacheStats(), { size: 1, hits: 0, misses: 1 });

  const r2 = evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  // One heavy pass total: the second call is a hit.
  assert.deepEqual(cacheStats(), { size: 1, hits: 1, misses: 1 });
  // Cache hit must be value-identical to the fresh compute at the same evaluatedAt.
  assert.deepEqual(r2, r1);
});

test("cache hit still recomputes time-dependent fields with the live evaluatedAt", () => {
  const profile = makeProfile({});
  const bars = buildBars();

  // Prime the cache at the bar's close time (age 0 → not stale).
  const fresh = evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.equal(fresh.status, "ok");
  assert.equal(cacheStats().misses, 1);

  // Same bars a week later: this is a cache HIT (heavy pass skipped) ...
  const later = evalAt("2026-06-16T15:00:00.000Z", profile, bars);
  assert.equal(cacheStats().hits, 1);
  assert.equal(cacheStats().misses, 1);
  // ... yet staleness/age are recomputed live, not frozen from the primed entry.
  assert.equal(
    later.lastEvaluatedAt.getTime(),
    new Date("2026-06-16T15:00:00.000Z").getTime(),
  );
  assert.equal(later.status, "stale");
  // The heavy-derived signal identity is unchanged across the two evaluations.
  assert.equal(later.currentSignalDirection, fresh.currentSignalDirection);
  assert.deepEqual(later.indicatorSnapshot, fresh.indicatorSnapshot);
});

test("a newly closed bar busts the cache (re-evaluates)", () => {
  const profile = makeProfile({});
  const bars = buildBars();
  evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.equal(cacheStats().misses, 1);

  const withNewBar = [...bars, bar("2026-06-09T15:01:00.000Z", 101.23)];
  evalAt("2026-06-09T15:01:00.000Z", profile, withNewBar);
  // New tail bar → different fingerprint → fresh heavy pass, not a hit.
  assert.equal(cacheStats().misses, 2);
  assert.equal(cacheStats().hits, 0);
});

test("different settings do not collide; content-equal profiles share an entry", () => {
  const bars = buildBars();

  // Distinct settings → must not false-hit each other.
  evalAt("2026-06-09T15:00:00.000Z", makeProfile({ basisLength: 20 }), bars);
  evalAt("2026-06-09T15:00:00.000Z", makeProfile({ basisLength: 40 }), bars);
  assert.deepEqual(cacheStats(), { size: 2, hits: 0, misses: 2 });

  // A second subscriber with a DIFFERENT profile id but identical settings+bars
  // (the per-subscriber duplication case) reuses the cached heavy pass.
  evalAt(
    "2026-06-09T15:00:00.000Z",
    makeProfile({ basisLength: 20 }, "22222222-2222-4222-8222-222222222222"),
    bars,
  );
  assert.equal(cacheStats().hits, 1);
  assert.equal(cacheStats().misses, 2);
});

test("a sub-0.001 bar correction busts the cache (lossless fingerprint)", () => {
  const profile = makeProfile({});
  const bars = buildBars();
  evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.equal(cacheStats().misses, 1);

  // Same series, last bar nudged by 0.0001 — a correction the old
  // Math.trunc(value * 1000) fingerprint truncated away (stale hit). The lossless
  // fold must treat it as a new series and re-evaluate.
  const corrected = (bars as Record<string, unknown>[]).slice();
  const last = corrected[corrected.length - 1] as Record<string, number>;
  corrected[corrected.length - 1] = {
    ...last,
    high: last.high + 0.0001,
    close: last.close + 0.0001,
  };
  evalAt("2026-06-09T15:00:00.000Z", profile, corrected);
  assert.equal(cacheStats().misses, 2, "sub-0.001 correction must bust the cache");
  assert.equal(cacheStats().hits, 0);
});
