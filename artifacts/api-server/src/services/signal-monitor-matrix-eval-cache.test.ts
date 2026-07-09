import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { pool } from "@workspace/db";
import {
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
} from "@workspace/pyrus-signals-core";

import {
  __signalMonitorInternalsForTests,
  evaluateSignalMonitorMatrixStateFromCompletedBars,
} from "./signal-monitor";

const {
  getSignalMonitorMatrixHeavyEvaluationCacheStats: cacheStats,
  getSignalMonitorIndicatorSnapshotBaseCacheStats: baseStats,
  getSignalMonitorCompletedBarsFingerprintMemoStatsForTests: fingerprintStats,
  fingerprintSignalMonitorMatrixCompletedBars,
  buildSignalMonitorIndicatorSnapshot,
  barsToPyrusSignalsBarEntries,
  stableSignalMonitorPyrusBarEntries,
  signalMonitorChartBarsFromPyrusBarEntries,
  signalMonitorMatrixStreamStateSignature,
  signalMonitorMatrixStreamStateSignatureFieldsEqual,
  isSignalMonitorCachedCompletedBarsBarBehind,
  lruCacheSet,
  lruCacheTouch,
  resetSignalMonitorMatrixHeavyEvaluationCache: resetCache,
} = __signalMonitorInternalsForTests;

// A single completed bar whose close time is `closeIso` (dataUpdatedAt drives closedAt).
const barClosingAt = (closeIso: string) =>
  ({
    timestamp: new Date(closeIso),
    dataUpdatedAt: new Date(closeIso),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    source: "massive-history",
    outsideRth: false,
    partial: false,
  }) as never;

const barBehind = (
  timeframe: string,
  evaluatedIso: string,
  latestCloseIso: string,
) =>
  isSignalMonitorCachedCompletedBarsBarBehind({
    completedBars: [barClosingAt(latestCloseIso)] as never,
    timeframe: timeframe as never,
    evaluatedAt: new Date(evaluatedIso),
  });

const chartOf = (entries: ReturnType<typeof barsToPyrusSignalsBarEntries>) =>
  entries.map((entry) => entry.chartBar);

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

test("lastBarClosed joins the cache identity — closure flip cannot serve a stale eval", () => {
  const profile = makeProfile({});
  const bars = buildBars() as Array<Record<string, unknown>>;
  const unproven = [...bars];
  unproven[unproven.length - 1] = {
    ...(unproven[unproven.length - 1] as Record<string, unknown>),
    dataUpdatedAt: undefined,
  };

  evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.deepEqual(cacheStats(), { size: 1, hits: 0, misses: 1 });

  // Identical OHLCV series, but the final bar no longer proves closure
  // (no dataUpdatedAt): the heavy eval must recompute under the flipped
  // lastBarClosed flag, never serve the closed-bar result.
  evalAt("2026-06-09T15:00:00.000Z", profile, unproven);
  assert.deepEqual(cacheStats(), { size: 1, hits: 0, misses: 2 });
});

// Mild downtrend planting one clear swing high, then a decisive breakout ON THE
// FINAL bar -> a single bullish CHoCH whose barIndex === last (mirrors the
// core's forming-bar fixture, but as completed snapshots with real close
// stamps). Exercises the emission-latency fix end to end: the signal must be
// adopted the moment its own bar closes, not one bar later.
function buildFinalBarBreakoutBars() {
  const endMs = new Date("2026-06-09T15:00:00.000Z").getTime();
  const n = 120;
  const bars: unknown[] = [];
  for (let i = 0; i < n; i += 1) {
    let base = 100 - i * 0.15;
    if (i === 40) base = 112; // swing high
    const openMs = endMs - (n - i) * 60_000;
    bars.push({
      timestamp: new Date(openMs),
      dataUpdatedAt: new Date(openMs + 60_000),
      open: base,
      high: base + 0.5,
      low: base - 0.5,
      close: base,
      volume: 1_000,
      source: "massive-history",
      outsideRth: false,
      partial: false,
    });
  }
  Object.assign(bars[n - 1] as Record<string, unknown>, {
    open: 90,
    high: 130,
    low: 89,
    close: 129, // breakout above the swing high
  });
  return bars;
}

test("a signal on the provably-closed final bar is adopted at its own close (no extra-bar wait)", () => {
  const profile = makeProfile({});
  const state = evalAt(
    "2026-06-09T15:00:00.000Z",
    profile,
    buildFinalBarBreakoutBars(),
  );
  assert.equal(state.currentSignalDirection, "buy");
  assert.equal(
    state.currentSignalAt?.toISOString(),
    "2026-06-09T15:00:00.000Z",
  );
  assert.equal(state.barsSinceSignal, 0);
  assert.equal(state.fresh, true);
  assert.ok(
    state.canonicalSignalEvent,
    "the event candidate must exist so persist emits at the signal bar's close",
  );
});

test("an unproven final bar keeps the conservative one-bar wait", () => {
  const profile = makeProfile({});
  const bars = buildFinalBarBreakoutBars() as Array<Record<string, unknown>>;
  bars[bars.length - 1] = {
    ...bars[bars.length - 1],
    dataUpdatedAt: undefined,
  };
  const state = evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.equal(state.currentSignalDirection, null);
  assert.equal(state.canonicalSignalEvent, null);
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

test("indicator-snapshot base cache hits on identical re-evaluation", () => {
  const profile = makeProfile({});
  const bars = buildBars();

  evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.deepEqual(baseStats(), { size: 1, hits: 0, misses: 1 });

  // Same (settings, symbol, timeframe, completed bars) → the ×3 MTF re-aggregation
  // is served from the base memo instead of recomputed.
  const r2 = evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.equal(baseStats().hits, 1);
  assert.equal(baseStats().misses, 1);
  assert.equal(r2.status, "ok");
});

// Direct exercise of the memo boundary: the signal-independent base is cached, but
// `filterState` (the only signal-derived field) is attached fresh on every call.
function buildChartBars(count = 90) {
  const endSec = Math.floor(
    new Date("2026-06-09T15:00:00.000Z").getTime() / 1000,
  );
  const bars: Array<Record<string, number | string>> = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const timeSec = endSec - i * 60;
    const close = Number((100 + Math.sin((count - i) / 4) * 3).toFixed(2));
    bars.push({
      time: timeSec,
      ts: new Date(timeSec * 1000).toISOString(),
      o: close,
      h: close + 0.5,
      l: close - 0.5,
      c: close,
      v: 1_000,
    });
  }
  return bars;
}

test("memoized base is reused across calls while filterState stays live per signal", () => {
  const settings = resolvePyrusSignalsSignalSettings({});
  const chartBars = buildChartBars();
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: chartBars as never,
    settings,
    includeProvisionalSignals: true,
  });
  const shared = {
    chartBars: chartBars as never,
    evaluation,
    settings,
    symbol: "SPY",
    timeframe: "1m" as const,
  };

  const snapA = buildSignalMonitorIndicatorSnapshot({
    ...shared,
    signal: { filterState: { tag: "A" } } as never,
  });
  assert.deepEqual(baseStats(), { size: 1, hits: 0, misses: 1 });

  const snapB = buildSignalMonitorIndicatorSnapshot({
    ...shared,
    signal: { filterState: { tag: "B" } } as never,
  });
  // Base memo hit — the MTF re-aggregation was skipped on the second call.
  assert.equal(baseStats().hits, 1);
  assert.equal(baseStats().misses, 1);

  // filterState reflects the LIVE signal on each call, never a cached value.
  assert.deepEqual(snapA?.filterState, { tag: "A" });
  assert.deepEqual(snapB?.filterState, { tag: "B" });

  // Everything except filterState is byte-identical across the cache hit (parity).
  const stripFilterState = (snapshot: typeof snapA) => {
    assert.ok(snapshot);
    const { filterState: _filterState, ...base } = snapshot;
    return base;
  };
  assert.deepEqual(stripFilterState(snapB), stripFilterState(snapA));
});

test("barsToPyrusSignalsBarEntries: same array identity returns the identical memoized entries", () => {
  const bars = buildBars();
  const first = barsToPyrusSignalsBarEntries(bars as never);
  const second = barsToPyrusSignalsBarEntries(bars as never);
  // Identity memo hit: the SAME array object yields the SAME entries reference (the
  // ~12.9% conversion is skipped), and each entry keeps its sourceBar reference contract.
  assert.strictEqual(second, first);
  assert.strictEqual(first[0]?.sourceBar, (bars as unknown[])[0]);
});

test("barsToPyrusSignalsBarEntries: a different array recomputes deep-equal (self-invalidating)", () => {
  const bars1 = buildBars();
  const bars2 = buildBars(); // structurally equal, DIFFERENT array object (a real refresh)
  const a = barsToPyrusSignalsBarEntries(bars1 as never);
  const b = barsToPyrusSignalsBarEntries(bars2 as never);
  // New identity => memo miss => fresh entries, but content-identical.
  assert.notStrictEqual(b, a);
  assert.deepEqual(chartOf(b), chartOf(a));
  // sourceBar of each result references its OWN input array (no cross-array leak).
  assert.strictEqual(a[0]?.sourceBar, (bars1 as unknown[])[0]);
  assert.strictEqual(b[0]?.sourceBar, (bars2 as unknown[])[0]);
});

test("barsToPyrusSignalsBarEntries: frozen input bars + entries never mutated (identity-memo invariant)", () => {
  // Locks the clone-removal precondition: nothing writes the shared cached bars or the
  // shared derived entries. If a future edit mutates either, this test throws.
  const bars = buildBars().map((bar) => Object.freeze(bar));
  Object.freeze(bars);
  const entries = barsToPyrusSignalsBarEntries(bars as never);
  Object.freeze(entries);
  // Consume exactly as the real eval path does — must not throw on the frozen structures.
  const chart = entries.map((entry) => entry.chartBar);
  const stable = entries.filter((entry) => entry.sourceBar.partial !== true);
  assert.ok(chart.length > 0);
  assert.ok(stable.length >= 0);
  // Re-request with the same frozen array => memo hit returns the same frozen reference.
  assert.strictEqual(barsToPyrusSignalsBarEntries(bars as never), entries);
});

test("completed-bars fingerprint memo: same chart-bars identity hits, same content on a new array stays correct", () => {
  const bars = buildBars();
  const entries = stableSignalMonitorPyrusBarEntries(
    barsToPyrusSignalsBarEntries(bars as never),
  );
  const chartBars = signalMonitorChartBarsFromPyrusBarEntries(entries);
  assert.strictEqual(
    signalMonitorChartBarsFromPyrusBarEntries(entries),
    chartBars,
  );

  const first = fingerprintSignalMonitorMatrixCompletedBars(chartBars);
  const second = fingerprintSignalMonitorMatrixCompletedBars(chartBars);
  assert.equal(second, first);
  assert.deepEqual(fingerprintStats(), { hits: 1, misses: 1 });

  const sameContent = chartOf(
    stableSignalMonitorPyrusBarEntries(
      barsToPyrusSignalsBarEntries(buildBars() as never),
    ),
  );
  assert.notStrictEqual(sameContent, chartBars);
  assert.equal(fingerprintSignalMonitorMatrixCompletedBars(sameContent), first);
  assert.deepEqual(fingerprintStats(), { hits: 1, misses: 2 });
});

test("matrix evaluation reuses completed-bars identity through fingerprint memo", () => {
  const profile = makeProfile({});
  const bars = buildBars();

  evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.deepEqual(fingerprintStats(), { hits: 0, misses: 1 });

  evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.deepEqual(fingerprintStats(), { hits: 1, misses: 1 });
});

test("matrix stream signatures change only when signature fields change", () => {
  const state = {
    id: "profile-test:AAPL:5m",
    profileId: "profile-test",
    symbol: "aapl",
    timeframe: "5m",
    currentSignalDirection: "buy",
    currentSignalAt: new Date("2026-06-09T14:55:00.000Z"),
    currentSignalPrice: 100,
    currentSignalClose: 101,
    currentSignalMfePercent: 1.25,
    currentSignalMaePercent: -0.5,
    latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
    latestBarClose: 102,
    barsSinceSignal: 1,
    fresh: true,
    status: "ok",
    active: true,
    lastEvaluatedAt: new Date("2026-06-09T15:00:00.000Z"),
    lastError: null,
    filterState: { pass: true },
    indicatorSnapshot: null,
    actionEligible: true,
    actionBlocker: null,
  } as any;
  const unchanged = { ...state } as any;
  const changed = { ...state, latestBarClose: 103 } as any;

  assert.equal(
    signalMonitorMatrixStreamStateSignature(unchanged),
    signalMonitorMatrixStreamStateSignature(state),
  );
  assert.equal(
    signalMonitorMatrixStreamStateSignatureFieldsEqual(state, unchanged),
    true,
  );
  assert.notEqual(
    signalMonitorMatrixStreamStateSignature(changed),
    signalMonitorMatrixStreamStateSignature(state),
  );
  assert.equal(
    signalMonitorMatrixStreamStateSignatureFieldsEqual(state, changed),
    false,
  );
});

// Serve-side freshness guard for the re-enabled completed-bars cache: a cached snapshot
// is refused once a newer completed bar must exist (elapsed >= timeframe + margin). All
// times below are RTH Tuesday 2026-06-09 (13:30-20:00Z) except the quiet case.
test("completed-bars serve guard: SERVES a current snapshot within the bucket (5m)", () => {
  // 15:03Z: newest closed 5m bar is 15:00; next closes 15:05 => not bar-behind.
  assert.equal(barBehind("5m", "2026-06-09T15:03:00Z", "2026-06-09T15:00:00Z"), false);
});

test("completed-bars serve guard: REFUSES a snapshot missing the just-closed bar (5m)", () => {
  // 15:05:30Z: the [15:00,15:05) bar closed at 15:05, but the snapshot's newest is 15:00.
  assert.equal(barBehind("5m", "2026-06-09T15:05:30Z", "2026-06-09T15:00:00Z"), true);
});

test("completed-bars serve guard: 2s margin tolerates the bar-delivery instant (5m)", () => {
  // 15:05:01Z, newest 15:00: elapsed 301s < 300s+2s => still served (delivery grace).
  assert.equal(barBehind("5m", "2026-06-09T15:05:01Z", "2026-06-09T15:00:00Z"), false);
  // 15:05:03Z: elapsed 303s >= 302s => refused.
  assert.equal(barBehind("5m", "2026-06-09T15:05:03Z", "2026-06-09T15:00:00Z"), true);
});

test("completed-bars serve guard: alignment-agnostic for session-offset 1h bars", () => {
  // Session-aligned 1h bar closed 14:30; at 15:15 the next (closes 15:30) has NOT closed
  // => served, even though clock-hour queryTo (15:00) is ahead of the bar (the old
  // one-timeframe tolerance conflated this; elapsed-since-latest does not).
  assert.equal(barBehind("1h", "2026-06-09T15:15:00Z", "2026-06-09T14:30:00Z"), false);
  // At 15:35 the 15:30 bar has closed but the snapshot is still at 14:30 => refused.
  assert.equal(barBehind("1h", "2026-06-09T15:35:00Z", "2026-06-09T14:30:00Z"), true);
});

test("completed-bars serve guard: quiet session never refuses (no new bars close)", () => {
  // Sunday 2026-06-14: market closed. Even a 5h-old snapshot is served (nothing new closes).
  assert.equal(barBehind("5m", "2026-06-14T15:00:00Z", "2026-06-14T10:00:00Z"), false);
});

test("lruCacheSet evicts the oldest entry (graceful, not a full clear) past max", () => {
  const cache = new Map<string, number>();
  for (let i = 0; i < 5; i += 1) {
    lruCacheSet(cache, `k${i}`, i, 3);
  }
  // Max 3: the two oldest (k0,k1) evicted one at a time; the cache is NOT wiped.
  assert.equal(cache.size, 3);
  assert.deepEqual([...cache.keys()], ["k2", "k3", "k4"]);
});

test("lruCacheTouch keeps a frequently-hit entry alive under eviction pressure", () => {
  const cache = new Map<string, number>();
  lruCacheSet(cache, "hot", 1, 3);
  lruCacheSet(cache, "a", 2, 3);
  lruCacheSet(cache, "b", 3, 3);
  // "hot" is oldest by insertion, but touching it marks it most-recently-used...
  assert.equal(lruCacheTouch(cache, "hot"), 1);
  // ...so the next insert evicts "a" (now oldest), NOT "hot".
  lruCacheSet(cache, "c", 4, 3);
  assert.equal(cache.has("hot"), true);
  assert.equal(cache.has("a"), false);
  assert.deepEqual([...cache.keys()], ["b", "hot", "c"]);
});
