import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";

import { pool } from "@workspace/db";
import {
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
} from "@workspace/pyrus-signals-core";

import {
  __signalMonitorInternalsForTests,
  evaluateSignalMonitorMatrixStateFromCompletedBars,
  getSignalMonitorResidentBarStats,
} from "./signal-monitor";

const signalMonitorSource = readFileSync(
  new URL("./signal-monitor.ts", import.meta.url),
  "utf8",
);

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
  evaluateSignalMonitorMatrixHeavyEvaluation: heavyEval,
  compactSignalMonitorMatrixHeavyEvaluation: compactHeavyEval,
  getSignalMonitorIncrementalEvalStats: incrementalStats,
  trimSignalMonitorIncrementalEvaluatorCellsForTests: trimIncrementalCells,
  setSignalMonitorIncrementalEvalCorruptForTests: setIncrementalCorrupt,
  setSignalMonitorPersistWorkerForTests: setPersistWorker,
  schedulePersistSignalMonitorMatrixStatesForTests: schedulePersist,
  waitForSignalMonitorPersistIdleForTests: waitForPersistIdle,
  resetSignalMonitorMatrixStreamForTests: resetStream,
} = __signalMonitorInternalsForTests;
const inheritedIncrementalMode = process.env.PYRUS_SIGNALS_INCREMENTAL_EVAL;
const resolveSymbolStateUpsert = (
  __signalMonitorInternalsForTests as unknown as {
    resolveSignalMonitorSymbolStateUpsert: (
      input: Record<string, unknown>,
      prefetched: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  }
).resolveSignalMonitorSymbolStateUpsert;

const emptyMatrixServeMismatchStats = {
  matrixServeMismatchCount: 0,
  matrixServeMismatchByField: {
    direction: 0,
    at: 0,
    status: 0,
    fresh: 0,
    trend: 0,
  },
  latchPreservedCount: 0,
  lastMatrixServeMismatchAt: null,
  lastMatrixServeMismatchCellKey: null,
};

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
) => {
  const timeframeMs =
    timeframe === "1h" ? 60 * 60_000 : timeframe === "5m" ? 5 * 60_000 : 60_000;
  const closeAt = new Date(latestCloseIso);
  const explicitCloseBar = barClosingAt(
    new Date(closeAt.getTime() - timeframeMs).toISOString(),
  ) as any;
  explicitCloseBar.dataUpdatedAt = closeAt;
  return isSignalMonitorCachedCompletedBarsBarBehind({
    completedBars: [explicitCloseBar] as never,
    timeframe: timeframe as never,
    evaluatedAt: new Date(evaluatedIso),
  });
};

const nativeBarBehind = (
  timeframe: string,
  evaluatedIso: string,
  bucketStartIso: string,
) =>
  isSignalMonitorCachedCompletedBarsBarBehind({
    completedBars: [barClosingAt(bucketStartIso)] as never,
    timeframe: timeframe as never,
    evaluatedAt: new Date(evaluatedIso),
  });

const chartOf = (entries: ReturnType<typeof barsToPyrusSignalsBarEntries>) =>
  entries.map((entry) => entry.chartBar);

after(async () => {
  if (inheritedIncrementalMode === undefined) {
    delete process.env.PYRUS_SIGNALS_INCREMENTAL_EVAL;
  } else {
    process.env.PYRUS_SIGNALS_INCREMENTAL_EVAL = inheritedIncrementalMode;
  }
  await pool.end();
});

beforeEach(() => {
  process.env.PYRUS_SIGNALS_INCREMENTAL_EVAL = "";
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

test("native intraday history uses the timeframe close when dataUpdatedAt aliases the bar start", () => {
  const state = evaluateSignalMonitorMatrixStateFromCompletedBars({
    profile: makeProfile({}),
    symbol: "SPY",
    timeframe: "1h",
    evaluatedAt: new Date("2026-07-13T16:30:00.000Z"),
    completedBars: [barClosingAt("2026-07-13T15:00:00.000Z")],
  });

  assert.equal(state.latestBarAt?.toISOString(), "2026-07-13T16:00:00.000Z");
});

test("an explicit intraday close is not advanced by a second timeframe", () => {
  const historyBar = barClosingAt("2026-07-13T15:00:00.000Z") as any;
  historyBar.dataUpdatedAt = new Date("2026-07-13T16:00:00.000Z");
  const state = evaluateSignalMonitorMatrixStateFromCompletedBars({
    profile: makeProfile({}),
    symbol: "SPY",
    timeframe: "1h",
    evaluatedAt: new Date("2026-07-13T16:30:00.000Z"),
    completedBars: [historyBar],
  });

  assert.equal(state.latestBarAt?.toISOString(), "2026-07-13T16:00:00.000Z");
});

test("daily history retains its date anchor", () => {
  const state = evaluateSignalMonitorMatrixStateFromCompletedBars({
    profile: makeProfile({}),
    symbol: "SPY",
    timeframe: "1d",
    evaluatedAt: new Date("2026-07-14T16:30:00.000Z"),
    completedBars: [barClosingAt("2026-07-13T00:00:00.000Z")],
  });

  assert.equal(state.latestBarAt?.toISOString(), "2026-07-13T00:00:00.000Z");
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
  const bars = buildBars();

  // The 15:00 bucket is still forming at its anchor.
  evalAt("2026-06-09T15:00:00.000Z", profile, bars);
  assert.deepEqual(cacheStats(), { size: 1, hits: 0, misses: 1 });

  // One minute later the identical OHLCV series is canonically closed, so the
  // heavy eval must recompute under the flipped lastBarClosed flag.
  evalAt("2026-06-09T15:01:00.000Z", profile, bars);
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

test("a genuinely forming final bar keeps the conservative one-bar wait", () => {
  const profile = makeProfile({});
  const bars = buildFinalBarBreakoutBars() as Array<Record<string, unknown>>;
  bars[bars.length - 1] = {
    ...bars[bars.length - 1],
    dataUpdatedAt: undefined,
  };
  const state = evalAt("2026-06-09T14:59:30.000Z", profile, bars);
  assert.equal(state.currentSignalDirection, null);
  assert.equal(state.canonicalSignalEvent, null);
});

test("cache hit still recomputes time-dependent fields with the live evaluatedAt", () => {
  const profile = makeProfile({});
  const bars = buildBars();

  // Prime the cache after the final 15:00 bucket closes (age 0 → not stale).
  const fresh = evalAt("2026-06-09T15:01:00.000Z", profile, bars);
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
  assert.equal(
    cacheStats().misses,
    2,
    "sub-0.001 correction must bust the cache",
  );
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

test("heavy-evaluation cache retains only the matrix-serving summary", () => {
  const settings = resolvePyrusSignalsSignalSettings({});
  const chartBars = buildChartBars();
  const evaluation = heavyEval({
    settings,
    symbol: "SPY",
    timeframe: "1m" as never,
    chartBars: chartBars as never,
    lastBarClosed: true,
  });

  assert.ok(Array.isArray(evaluation.signalEvents));
  assert.deepEqual(getSignalMonitorResidentBarStats().heavyEvaluationCache, {
    entries: 1,
    maxEntries: 12_288,
    hits: 0,
    misses: 1,
    retainedSeriesValues: 0,
    signalEvents: evaluation.signalEvents.length,
  });
});

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
  assert.equal(
    barBehind("5m", "2026-06-09T15:03:00Z", "2026-06-09T15:00:00Z"),
    false,
  );
});

test("completed-bars serve guard: REFUSES a snapshot missing the just-closed bar (5m)", () => {
  // 15:05:30Z: the [15:00,15:05) bar closed at 15:05, but the snapshot's newest is 15:00.
  assert.equal(
    barBehind("5m", "2026-06-09T15:05:30Z", "2026-06-09T15:00:00Z"),
    true,
  );
});

test("completed-bars serve guard: 2s margin tolerates the bar-delivery instant (5m)", () => {
  // 15:05:01Z, newest 15:00: elapsed 301s < 300s+2s => still served (delivery grace).
  assert.equal(
    barBehind("5m", "2026-06-09T15:05:01Z", "2026-06-09T15:00:00Z"),
    false,
  );
  // 15:05:03Z: elapsed 303s >= 302s => refused.
  assert.equal(
    barBehind("5m", "2026-06-09T15:05:03Z", "2026-06-09T15:00:00Z"),
    true,
  );
});

test("completed-bars serve guard: alignment-agnostic for session-offset 1h bars", () => {
  // Session-aligned 1h bar closed 14:30; at 15:15 the next (closes 15:30) has NOT closed
  // => served, even though clock-hour queryTo (15:00) is ahead of the bar (the old
  // one-timeframe tolerance conflated this; elapsed-since-latest does not).
  assert.equal(
    barBehind("1h", "2026-06-09T15:15:00Z", "2026-06-09T14:30:00Z"),
    false,
  );
  // At 15:35 the 15:30 bar has closed but the snapshot is still at 14:30 => refused.
  assert.equal(
    barBehind("1h", "2026-06-09T15:35:00Z", "2026-06-09T14:30:00Z"),
    true,
  );
});

test("completed-bars serve guard uses the same reconstructed native close as evaluation", () => {
  assert.equal(
    nativeBarBehind("1h", "2026-07-13T16:02:00Z", "2026-07-13T15:00:00Z"),
    false,
    "a native 15:00 bucket closed at 16:00 and is still current",
  );
  assert.equal(
    nativeBarBehind("1h", "2026-07-13T17:00:03Z", "2026-07-13T15:00:00Z"),
    true,
    "the snapshot is behind only after the next 1h bucket really closed",
  );
});

test("completed-bars serve guard: quiet session never refuses (no new bars close)", () => {
  // Sunday 2026-06-14: market closed. Even a 5h-old snapshot is served (nothing new closes).
  assert.equal(
    barBehind("5m", "2026-06-14T15:00:00Z", "2026-06-14T10:00:00Z"),
    false,
  );
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

// --- WO-S3B-2: incremental evaluation behind PYRUS_SIGNALS_INCREMENTAL_EVAL ---
// The mode env is memoized inside signal-monitor and the memo is cleared by
// resetCache(), so each scenario sets the env THEN resets. Always restore the
// inherited env, clear the corruption seam, and reset in finally.
function withIncrementalMode<T>(env: Record<string, string>, run: () => T): T {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  resetCache();
  try {
    return run();
  } finally {
    setIncrementalCorrupt(null);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetCache();
  }
}

async function withIncrementalModeAsync<T>(
  env: Record<string, string>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  resetCache();
  try {
    return await run();
  } finally {
    setIncrementalCorrupt(null);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetCache();
  }
}

// Growing per-step series: the base bars plus k extra closed bars — each step
// is a heavy-eval MISS (new tail bar => new fingerprint), which is the only
// path the incremental engine hooks.
function buildAppendSteps(stepCount = 6) {
  const startMs = new Date("2026-06-09T15:00:00.000Z").getTime();
  const steps: Array<{ iso: string; bars: unknown[] }> = [];
  let bars = buildBars() as unknown[];
  steps.push({ iso: "2026-06-09T15:00:00.000Z", bars });
  for (let k = 1; k < stepCount; k += 1) {
    const iso = new Date(startMs + k * 60_000).toISOString();
    const close = Number((101 + Math.sin(k / 2) * 2).toFixed(2));
    bars = [...bars, bar(iso, close)];
    steps.push({ iso, bars });
  }
  return steps;
}

test("incremental heavy caching does not clone every full evaluation series", () => {
  assert.doesNotMatch(
    signalMonitorSource,
    /function snapshotSignalMonitorIncrementalEvaluation\(/,
  );
});

test("production pure-signal callers are inventoried behind telemetry lanes", () => {
  assert.equal(
    signalMonitorSource.match(/\bevaluatePyrusSignalsSignals\(/gu)?.length,
    1,
    "only the telemetry wrapper may call the core evaluator directly",
  );
  assert.equal(
    signalMonitorSource.match(
      /\bevaluateSignalMonitorCanonicalFullSeries\(\s*\{/gu,
    )?.length,
    3,
    "profile, incremental reference, and matrix fallback are the full-series callers",
  );
  assert.match(
    signalMonitorSource,
    /evaluateSignalMonitorMatrixStateFromCompletedBars\(\{[\s\S]{0,400}callerLane:\s*"matrix-stream"/u,
  );
  assert.match(
    signalMonitorSource,
    /evaluateSignalMonitorMatrixStateFromCompletedBars\(\{[\s\S]{0,400}callerLane:\s*"matrix-request"/u,
  );
});

test("main-thread signal telemetry attributes preparation, evaluator path, materialization, and lane", () => {
  const profile = makeProfile({});
  const steps = buildAppendSteps(2);

  withIncrementalMode({ PYRUS_SIGNALS_INCREMENTAL_EVAL: "on" }, () => {
    for (const step of steps) {
      evaluateSignalMonitorMatrixStateFromCompletedBars({
        profile,
        symbol: "TELEMETRY",
        timeframe: "1m",
        evaluatedAt: new Date(step.iso),
        completedBars: step.bars as never,
        callerLane: "matrix-request",
      });
    }

    const work = getSignalMonitorResidentBarStats().mainThreadSignalWork;
    for (const phase of [
      "barEntryPreparation",
      "chartBarsPreparation",
      "settingsPreparation",
      "fingerprintPreparation",
      "closurePreparation",
      "compactMaterialization",
      "finalMaterialization",
    ] as const) {
      assert.equal(work.phases[phase].count, steps.length);
      assert.ok(work.phases[phase].totalDurationMs >= 0);
    }
    assert.equal(work.phases.absentReseed.count, 1);
    assert.equal(work.phases.retainedAppend.count, 1);
    assert.equal(work.phases.formingReplay.count, 0);
    assert.equal(work.phases.nonExtensionReseed.count, 0);
    assert.equal(work.phases.canonicalFullSeries.count, 0);
    assert.equal(work.callerLanes["matrix-request"].phaseCount, 16);
    assert.ok(
      work.callerLanes["matrix-request"].totalDurationMs >= 0,
    );
    assert.equal(work.callerLanes.profile.phaseCount, 0);
    assert.equal(work.callerLanes["matrix-stream"].phaseCount, 0);
    assert.equal(work.callerLanes.direct.phaseCount, 0);
  });
});

test("incremental eval: flag unset/off leaves the instrumentation dormant (from-scratch path untouched)", () => {
  withIncrementalMode({ PYRUS_SIGNALS_INCREMENTAL_EVAL: "" }, () => {
    const profile = makeProfile({});
    evalAt("2026-06-09T15:00:00.000Z", profile, buildBars());
    assert.deepEqual(incrementalStats(), {
      mode: "off",
      appends: 0,
      seeds: 0,
      formingReplays: 0,
      shadowChecks: 0,
      shadowMismatches: 0,
      ...emptyMatrixServeMismatchStats,
    });
    assert.equal(
      getSignalMonitorResidentBarStats().mainThreadSignalWork.phases
        .canonicalFullSeries.count,
      1,
    );
  });
});

test("incremental eval ON: multi-append sequence is state-identical to from-scratch and appends instead of re-seeding", () => {
  const profile = makeProfile({});
  const steps = buildAppendSteps();

  // Reference run on the untouched from-scratch path (flag off).
  const reference = steps.map((step) => evalAt(step.iso, profile, step.bars));

  withIncrementalMode({ PYRUS_SIGNALS_INCREMENTAL_EVAL: "on" }, () => {
    const incremental = steps.map((step) =>
      evalAt(step.iso, profile, step.bars),
    );
    for (let k = 0; k < steps.length; k += 1) {
      assert.deepEqual(
        incremental[k],
        reference[k],
        `state diverged from from-scratch at step ${k}`,
      );
    }
    // First evaluation seeds the cell; every later step appends the one new bar.
    assert.deepEqual(incrementalStats(), {
      mode: "on",
      appends: steps.length - 1,
      seeds: 1,
      formingReplays: 0,
      shadowChecks: 0,
      shadowMismatches: 0,
      ...emptyMatrixServeMismatchStats,
    });
  });
});

test("pressure trimming releases private incremental cells but preserves heavy-cache hits", () => {
  process.env.PYRUS_SIGNALS_INCREMENTAL_EVAL = "on";
  resetCache();
  const profile = makeProfile({});
  const bars = buildBars();
  const evaluate = (symbol: string, completedBars = bars) =>
    evaluateSignalMonitorMatrixStateFromCompletedBars({
      profile,
      symbol,
      timeframe: "1m",
      evaluatedAt: new Date("2026-06-09T15:00:00.000Z"),
      completedBars: completedBars as never,
    });

  const firstA = evaluate("AAA");
  evaluate("BBB");
  evaluate("CCC");
  assert.equal(
    getSignalMonitorResidentBarStats().incrementalEvaluators.cells,
    3,
  );
  assert.equal(cacheStats().size, 3);

  assert.equal(trimIncrementalCells(1), 2);
  assert.equal(
    getSignalMonitorResidentBarStats().incrementalEvaluators.cells,
    1,
  );
  assert.equal(cacheStats().size, 3);

  const cachedA = evaluate("AAA");
  assert.deepEqual(cachedA, firstA);
  assert.equal(
    getSignalMonitorResidentBarStats().incrementalEvaluators.cells,
    1,
  );
  assert.equal(cacheStats().hits, 1);

  const changedBars = [...bars, bar("2026-06-09T15:01:00.000Z", 101.23)];
  evaluate("AAA", changedBars);
  assert.equal(
    getSignalMonitorResidentBarStats().incrementalEvaluators.cells,
    2,
  );
  assert.equal(incrementalStats().seeds, 4);
});

test("private incremental evaluator diagnostics expose cap eviction and cyclic absent reseeding", () => {
  const profile = makeProfile({});
  const bars = [bar("2026-06-09T15:00:00.000Z", 100)];
  const extendedBars = [
    ...bars,
    bar("2026-06-09T15:01:00.000Z", 101),
  ];
  const evaluate = (
    symbol: string,
    completedBars = bars,
    evaluatedAt = new Date("2026-06-09T15:00:00.000Z"),
  ) =>
    evaluateSignalMonitorMatrixStateFromCompletedBars({
      profile,
      symbol,
      timeframe: "1m",
      evaluatedAt,
      completedBars: completedBars as never,
    });
  const reference = withIncrementalMode(
    { PYRUS_SIGNALS_INCREMENTAL_EVAL: "" },
    () =>
      evaluate(
        "CAP0",
        extendedBars,
        new Date("2026-06-09T15:02:00.000Z"),
      ),
  );

  withIncrementalMode({ PYRUS_SIGNALS_INCREMENTAL_EVAL: "on" }, () => {
    for (let index = 0; index <= 4_096; index += 1) {
      evaluate(`CAP${index}`);
    }

    assert.deepEqual(
      getSignalMonitorResidentBarStats().incrementalEvaluators,
      {
        cells: 4_096,
        maxCells: 4_096,
        totalEvaluations: 4_097,
        capEvictions: 1,
        pressureTrimEvents: 0,
        pressureTrimmedCells: 0,
        seedReasons: { absent: 4_097, nonExtension: 0 },
        formingCheckpointCells: 4_096,
      },
    );
    assert.equal(cacheStats().size, 4_097);

    assert.deepEqual(
      evaluate(
        "CAP0",
        extendedBars,
        new Date("2026-06-09T15:02:00.000Z"),
      ),
      reference,
    );
    assert.deepEqual(
      getSignalMonitorResidentBarStats().incrementalEvaluators,
      {
        cells: 4_096,
        maxCells: 4_096,
        totalEvaluations: 4_098,
        capEvictions: 2,
        pressureTrimEvents: 0,
        pressureTrimmedCells: 0,
        seedReasons: { absent: 4_098, nonExtension: 0 },
        formingCheckpointCells: 4_095,
      },
    );
  });
});

test("incremental eval ON: non-append transitions (shrink, mid-series correction, settings change) re-seed with correct results", () => {
  const profile = makeProfile({});
  const altProfile = makeProfile({ basisLength: 40 });
  const bars = buildBars() as Array<Record<string, number>>;
  const shorter = bars.slice(0, bars.length - 1);
  const corrected = bars.slice();
  corrected[40] = { ...corrected[40], high: corrected[40].high + 0.25 };
  const iso = "2026-06-09T15:00:00.000Z";

  // From-scratch references (flag off).
  const referenceFull = evalAt(iso, profile, bars);
  const referenceShorter = evalAt(iso, profile, shorter);
  const referenceCorrected = evalAt(iso, profile, corrected);
  const referenceAlt = evalAt(iso, altProfile, bars);

  withIncrementalMode({ PYRUS_SIGNALS_INCREMENTAL_EVAL: "on" }, () => {
    assert.deepEqual(evalAt(iso, profile, bars), referenceFull);
    assert.equal(incrementalStats().seeds, 1);

    // Shorter series can never be an extension -> fresh seed, correct result.
    assert.deepEqual(evalAt(iso, profile, shorter), referenceShorter);
    assert.equal(incrementalStats().seeds, 2);

    // Same tail, corrected middle bar: the appended-prefix fold no longer
    // reproduces the series content stamp -> re-seed, correct result.
    assert.deepEqual(evalAt(iso, profile, corrected), referenceCorrected);
    assert.equal(incrementalStats().seeds, 3);

    // A settings change forks the cell key -> its own seeded instance.
    assert.deepEqual(evalAt(iso, altProfile, bars), referenceAlt);
    assert.equal(incrementalStats().seeds, 4);
    assert.equal(incrementalStats().appends, 0);
    assert.equal(
      getSignalMonitorResidentBarStats().mainThreadSignalWork.phases
        .nonExtensionReseed.count,
      2,
    );
  });
});

test("incremental eval SHADOW: legacy always served, parity sampled clean; a corrupted incremental result only bumps the mismatch counter", () => {
  const profile = makeProfile({});
  const steps = buildAppendSteps(5);
  const reference = steps.map((step) => evalAt(step.iso, profile, step.bars));

  withIncrementalMode(
    {
      PYRUS_SIGNALS_INCREMENTAL_EVAL: "shadow",
      PYRUS_SIGNALS_INCREMENTAL_EVAL_SHADOW_SAMPLE_N: "1",
    },
    () => {
      for (let k = 0; k < steps.length - 1; k += 1) {
        assert.deepEqual(
          evalAt(steps[k].iso, profile, steps[k].bars),
          reference[k],
          `shadow mode must serve the from-scratch result at step ${k}`,
        );
      }
      assert.deepEqual(incrementalStats(), {
        mode: "shadow",
        appends: steps.length - 2,
        seeds: 1,
        formingReplays: 0,
        shadowChecks: steps.length - 1,
        shadowMismatches: 0,
        ...emptyMatrixServeMismatchStats,
      });

      // Corrupt the incremental side of the comparison (test seam): the
      // mismatch is counted, and the emitted result is still the legacy one.
      setIncrementalCorrupt((evaluation) => ({
        ...evaluation,
        marketStructureDirection: 99,
      }));
      const last = steps[steps.length - 1];
      assert.deepEqual(
        evalAt(last.iso, profile, last.bars),
        reference[steps.length - 1],
        "a shadow mismatch must never alter the emitted result",
      );
      assert.equal(incrementalStats().shadowChecks, steps.length);
      assert.equal(incrementalStats().shadowMismatches, 1);
    },
  );
});

test("incremental eval ON: a queued materialized state is immutable across later appends", () => {
  const profile = makeProfile({});
  const bars = buildFinalBarBreakoutBars();
  withIncrementalMode({ PYRUS_SIGNALS_INCREMENTAL_EVAL: "on" }, () => {
    const first = evalAt("2026-06-09T15:00:00.000Z", profile, bars);
    assert.ok(first.canonicalSignalEvent?.signal.filterState);
    const firstJson = JSON.stringify(first);
    const extended = [...bars, bar("2026-06-09T15:01:00.000Z", 128.5)];
    evalAt("2026-06-09T15:02:00.000Z", profile, extended);

    assert.equal(JSON.stringify(first), firstJson);
    assert.equal(incrementalStats().seeds, 1);
    assert.equal(incrementalStats().appends, 1);
    assert.deepEqual(getSignalMonitorResidentBarStats().incrementalEvaluators, {
      cells: 1,
      maxCells: 4_096,
      totalEvaluations: 2,
      capEvictions: 0,
      pressureTrimEvents: 0,
      pressureTrimmedCells: 0,
      seedReasons: { absent: 1, nonExtension: 0 },
      formingCheckpointCells: 0,
    });
  });
});

test("incremental eval ON: persistence retains a detached state while the evaluator appends", async () => {
  await withIncrementalModeAsync(
    { PYRUS_SIGNALS_INCREMENTAL_EVAL: "on" },
    async () => {
      resetStream();
      const profile = makeProfile({});
      const bars = buildFinalBarBreakoutBars();
      const first = evalAt("2026-06-09T15:00:00.000Z", profile, bars);
      assert.ok(first.canonicalSignalEvent?.signal.filterState);
      const queuedJson = JSON.stringify(first);
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let persistedJson: string | null = null;

      setPersistWorker(async ({ states }) => {
        markStarted();
        await blocked;
        persistedJson = JSON.stringify(states[0]);
        return "success";
      });
      try {
        schedulePersist({
          profile,
          states: [first],
          evaluatedAt: new Date("2026-06-09T15:00:00.000Z"),
        });
        await started;
        evalAt("2026-06-09T15:01:00.000Z", profile, [
          ...bars,
          bar("2026-06-09T15:01:00.000Z", 128.5),
        ]);
        assert.equal(JSON.stringify(first), queuedJson);
        release();
        await waitForPersistIdle();
        assert.equal(persistedJson, queuedJson);
      } finally {
        release();
        setPersistWorker(null);
        resetStream();
      }
    },
  );
});

test("incremental eval ON: forming-bar mutations replay from the closed checkpoint (byte-identical, no re-seed)", () => {
  const settings = resolvePyrusSignalsSignalSettings({});
  const closed = buildChartBars();
  const lastClosedTime = Number(closed[closed.length - 1].time);
  const formingTime = lastClosedTime + 60;
  const forming = (time: number, close: number) => ({
    time,
    ts: new Date(time * 1000).toISOString(),
    o: 100.5,
    h: Number((close + 0.6).toFixed(2)),
    l: Number((close - 0.7).toFixed(2)),
    c: close,
    v: 1_000 + Math.round(close),
  });
  const fromScratch = (chartBars: unknown[]) =>
    compactHeavyEval(
      evaluatePyrusSignalsSignals({
        chartBars: chartBars as never,
        settings,
        includeProvisionalSignals: !settings.waitForBarClose,
        lastBarClosed: false,
      }),
    );
  const serveForming = (chartBars: unknown[]) =>
    heavyEval({
      settings,
      symbol: "SPY",
      timeframe: "1m" as never,
      chartBars: chartBars as never,
      lastBarClosed: false,
    });

  withIncrementalMode({ PYRUS_SIGNALS_INCREMENTAL_EVAL: "on" }, () => {
    // First sight of the forming bar seeds the cell (and its checkpoint).
    const seedSeries = [...closed, forming(formingTime, 100.9)];
    assert.deepEqual(serveForming(seedSeries), fromScratch(seedSeries));
    assert.equal(incrementalStats().seeds, 1);
    assert.equal(incrementalStats().formingReplays, 0);
    assert.deepEqual(getSignalMonitorResidentBarStats().incrementalEvaluators, {
      cells: 1,
      maxCells: 4_096,
      totalEvaluations: 1,
      capEvictions: 0,
      pressureTrimEvents: 0,
      pressureTrimmedCells: 0,
      seedReasons: { absent: 1, nonExtension: 0 },
      formingCheckpointCells: 1,
    });

    // Successive in-place mutations of the forming bar (same timestamp,
    // changing OHLCV): every serve must be byte-identical to from-scratch and
    // must replay from the checkpoint, never re-seed. A previously served
    // evaluation must stay immutable across later replays.
    const mutations = [101.4, 100.2, 102.6, 99.8, 101.1];
    let previousServedJson: string | null = null;
    let previousServed: unknown = null;
    for (const [k, close] of mutations.entries()) {
      const series = [...closed, forming(formingTime, close)];
      const served = serveForming(series);
      assert.deepEqual(
        served,
        fromScratch(series),
        `forming mutation ${k} diverged from from-scratch`,
      );
      if (previousServedJson != null) {
        assert.equal(
          JSON.stringify(previousServed),
          previousServedJson,
          "a served forming evaluation mutated after a later replay",
        );
      }
      previousServed = served;
      previousServedJson = JSON.stringify(served);
    }
    assert.equal(incrementalStats().seeds, 1);
    assert.equal(incrementalStats().appends, 0);
    assert.equal(incrementalStats().formingReplays, mutations.length);

    // Bar close where the FINAL bar content differs from the last observed
    // mutation (ticks were missed) plus a brand-new forming bar: the replay
    // path absorbs it too — the checkpoint appends the now-closed bar and the
    // clone serves the new forming bar. No re-seed.
    const closedFinalBar = forming(formingTime, 101.05);
    const secondFormingTime = formingTime + 60;
    const afterClose = [
      ...closed,
      closedFinalBar,
      forming(secondFormingTime, 101.3),
    ];
    assert.deepEqual(serveForming(afterClose), fromScratch(afterClose));
    assert.equal(incrementalStats().seeds, 1);
    assert.equal(incrementalStats().formingReplays, mutations.length + 1);

    // Mutate the new forming bar: replays continue against the advanced
    // checkpoint.
    const secondMutation = [
      ...closed,
      closedFinalBar,
      forming(secondFormingTime, 102),
    ];
    assert.deepEqual(serveForming(secondMutation), fromScratch(secondMutation));
    assert.equal(incrementalStats().formingReplays, mutations.length + 2);

    // Bar close with content IDENTICAL to the last observed mutation plus a
    // new forming bar: this is a pure extension of the serving evaluator and
    // takes the existing append fast path (not a replay, not a seed).
    const thirdFormingTime = secondFormingTime + 60;
    const pureExtension = [...secondMutation, forming(thirdFormingTime, 101.9)];
    assert.deepEqual(serveForming(pureExtension), fromScratch(pureExtension));
    assert.equal(incrementalStats().appends, 1);
    assert.equal(incrementalStats().seeds, 1);
    assert.equal(incrementalStats().formingReplays, mutations.length + 2);

    // lastBarClosed=true cells never serve a forming-bar clone: a mutated
    // tail on the closed-keyed cell re-seeds instead of replaying.
    const closedKeyed = [...closed, forming(formingTime, 100.9)];
    heavyEval({
      settings,
      symbol: "SPY",
      timeframe: "1m" as never,
      chartBars: closedKeyed as never,
      lastBarClosed: true,
    });
    assert.equal(incrementalStats().seeds, 2);
    const closedKeyedMutated = [...closed, forming(formingTime, 101.7)];
    heavyEval({
      settings,
      symbol: "SPY",
      timeframe: "1m" as never,
      chartBars: closedKeyedMutated as never,
      lastBarClosed: true,
    });
    assert.equal(incrementalStats().seeds, 3);
    assert.equal(incrementalStats().formingReplays, mutations.length + 2);
    assert.equal(
      getSignalMonitorResidentBarStats().mainThreadSignalWork.phases
        .formingReplay.count,
      mutations.length + 2,
    );
  });
});

test("symbol-state persist counts display mismatches and excludes latch/preserve paths", async () => {
  const storedAt = new Date("2026-06-09T15:00:00.000Z");
  const evaluatedAt = new Date("2026-06-09T15:05:00.000Z");
  const existing = {
    id: "profile:SPY:5m",
    profileId: "profile",
    symbol: "SPY",
    timeframe: "5m",
    currentSignalDirection: "buy",
    currentSignalAt: storedAt,
    currentSignalPrice: "100",
    currentSignalClose: "100",
    currentSignalMfePercent: null,
    currentSignalMaePercent: null,
    filterState: null,
    latestBarAt: storedAt,
    latestBarClose: "100",
    barsSinceSignal: 1,
    fresh: false,
    status: "stale",
    active: true,
    lastEvaluatedAt: storedAt,
    lastError: null,
    trendDirection: "bullish",
    updatedAt: storedAt,
  };
  const candidate = {
    profileId: "profile",
    symbol: "SPY",
    timeframe: "5m",
    direction: "sell",
    signalAt: evaluatedAt,
    signalPrice: 101,
    signalClose: 101,
    latestBarAt: evaluatedAt,
    latestBarClose: 101,
    barsSinceSignal: 0,
    fresh: true,
    status: "ok",
    evaluatedAt,
    trendDirection: "bearish",
  };
  const prefetched = { existing, eventSignalAtByKey: new Map<string, Date>() };

  await resolveSymbolStateUpsert(candidate, prefetched);
  assert.deepEqual(incrementalStats(), {
    mode: "off",
    appends: 0,
    seeds: 0,
    formingReplays: 0,
    shadowChecks: 0,
    shadowMismatches: 0,
    matrixServeMismatchCount: 1,
    matrixServeMismatchByField: {
      direction: 1,
      at: 1,
      status: 1,
      fresh: 1,
      trend: 1,
    },
    latchPreservedCount: 0,
    lastMatrixServeMismatchAt: evaluatedAt.toISOString(),
    lastMatrixServeMismatchCellKey: "profile|SPY|5m",
  });

  const latched = await resolveSymbolStateUpsert(
    {
      ...candidate,
      direction: null,
      signalAt: null,
      evaluatedAt: new Date("2026-06-09T15:10:00.000Z"),
    },
    prefetched,
  );
  assert.ok("effectiveValues" in latched);
  assert.equal(latched.effectiveValues.currentSignalDirection, "buy");
  assert.equal(latched.effectiveValues.currentSignalAt, storedAt);
  await resolveSymbolStateUpsert(
    {
      ...candidate,
      signalAt: new Date("2026-06-09T14:55:00.000Z"),
      evaluatedAt: new Date("2026-06-09T15:15:00.000Z"),
    },
    prefetched,
  );

  assert.equal(incrementalStats().matrixServeMismatchCount, 1);
  assert.deepEqual(incrementalStats().matrixServeMismatchByField, {
    direction: 1,
    at: 1,
    status: 1,
    fresh: 1,
    trend: 1,
  });
  assert.equal(incrementalStats().latchPreservedCount, 2);

  resetCache();
  assert.deepEqual(
    {
      matrixServeMismatchCount: incrementalStats().matrixServeMismatchCount,
      matrixServeMismatchByField: incrementalStats().matrixServeMismatchByField,
      latchPreservedCount: incrementalStats().latchPreservedCount,
      lastMatrixServeMismatchAt: incrementalStats().lastMatrixServeMismatchAt,
      lastMatrixServeMismatchCellKey:
        incrementalStats().lastMatrixServeMismatchCellKey,
    },
    emptyMatrixServeMismatchStats,
  );
});

test("symbol-state persistence rejects directions without signal timestamps", async () => {
  const evaluatedAt = new Date("2026-06-09T15:05:00.000Z");
  const contaminated = {
    id: "profile:SPY:5m",
    profileId: "profile",
    symbol: "SPY",
    timeframe: "5m",
    currentSignalDirection: "buy",
    currentSignalAt: null,
    currentSignalPrice: null,
    currentSignalClose: null,
    currentSignalMfePercent: null,
    currentSignalMaePercent: null,
    filterState: null,
    latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
    latestBarClose: "100",
    barsSinceSignal: null,
    fresh: false,
    status: "ok",
    active: true,
    lastEvaluatedAt: evaluatedAt,
    lastError: null,
    trendDirection: "bullish",
    updatedAt: evaluatedAt,
  };
  const baseCandidate = {
    profileId: "profile",
    symbol: "SPY",
    timeframe: "5m" as const,
    signalAt: null,
    signalPrice: null,
    signalClose: null,
    latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
    latestBarClose: 101,
    barsSinceSignal: null,
    fresh: false,
    status: "ok" as const,
    evaluatedAt,
    trendDirection: "bullish",
  };

  const cleaned = await resolveSymbolStateUpsert(
    { ...baseCandidate, direction: null },
    { existing: contaminated, eventSignalAtByKey: new Map<string, Date>() },
  );
  assert.ok("effectiveValues" in cleaned);
  const cleanedValues = cleaned["effectiveValues"] as Record<string, unknown>;
  assert.equal(cleanedValues["currentSignalDirection"], null);
  assert.equal(cleanedValues["currentSignalAt"], null);

  const rejected = await resolveSymbolStateUpsert(
    { ...baseCandidate, direction: "sell" },
    { existing: null, eventSignalAtByKey: new Map<string, Date>() },
  );
  assert.ok("effectiveValues" in rejected);
  const rejectedValues = rejected["effectiveValues"] as Record<string, unknown>;
  assert.equal(rejectedValues["currentSignalDirection"], null);
  assert.equal(rejectedValues["currentSignalAt"], null);
  assert.equal(rejectedValues["currentSignalPrice"], null);
  assert.equal(rejectedValues["barsSinceSignal"], null);
});

test("symbol-state persistence drops a latched signal authored by different settings", async () => {
  const evaluatedAt = new Date("2026-07-20T15:30:00.000Z");
  const existing = {
    id: "profile:WULX:1h",
    profileId: "profile",
    symbol: "WULX",
    timeframe: "1h",
    currentSignalDirection: "sell",
    currentSignalAt: new Date("2026-07-01T15:00:00.000Z"),
    currentSignalPrice: "10",
    currentSignalClose: "10",
    currentSignalMfePercent: null,
    currentSignalMaePercent: null,
    filterState: null,
    signalSettingsRevision: 7,
    latestBarAt: new Date("2026-07-20T15:00:00.000Z"),
    latestBarClose: "9",
    barsSinceSignal: 156,
    fresh: false,
    status: "ok",
    active: true,
    lastEvaluatedAt: evaluatedAt,
    lastError: null,
    trendDirection: "bearish",
    updatedAt: evaluatedAt,
  };
  const candidate = {
    profileId: "profile",
    symbol: "WULX",
    timeframe: "1h" as const,
    direction: null,
    signalAt: null,
    signalPrice: null,
    signalClose: null,
    latestBarAt: new Date("2026-07-20T15:00:00.000Z"),
    latestBarClose: 9,
    barsSinceSignal: null,
    fresh: false,
    status: "ok" as const,
    evaluatedAt,
    trendDirection: "bearish",
    signalSettingsRevision: 8,
  };

  const resolved = await resolveSymbolStateUpsert(candidate, {
    existing,
    eventSignalAtByKey: new Map<string, Date>(),
  });

  assert.ok("effectiveValues" in resolved);
  const values = resolved["effectiveValues"] as Record<string, unknown>;
  assert.equal(values["currentSignalDirection"], null);
  assert.equal(values["currentSignalAt"], null);
  assert.equal(values["barsSinceSignal"], null);
  assert.equal(values["fresh"], false);
  assert.equal(values["signalSettingsRevision"], 8);
});
