import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregatePyrusSignalsBarsForTimeframe,
  buildPyrusSignalsDirectionalFeatures,
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
  resolvePyrusSignalsTrendDirection,
  type PyrusSignalsBar,
} from "./index";

const mkBar = (
  i: number,
  o: number,
  h: number,
  l: number,
  c: number,
): PyrusSignalsBar => ({ time: 1_700_000_000 + i * 300, o, h, l, c, v: 1000 });

// A long mild downtrend that plants one clear swing high early, then breaks
// decisively above it on the FINAL (forming) bar -> a single bullish CHOCH
// whose barIndex === last. This isolates the forming-bar signal so we can
// assert whether it is admitted.
const buildForminBarBreakoutSeries = (): PyrusSignalsBar[] => {
  const bars: PyrusSignalsBar[] = [];
  const n = 120;
  for (let i = 0; i < n; i += 1) {
    let base = 100 - i * 0.15;
    if (i === 40) base = 112; // swing high
    bars.push(mkBar(i, base, base + 0.5, base - 0.5, base));
  }
  const last = n - 1;
  bars[last] = mkBar(last, 90, 130, 89, 129); // breakout above the swing high
  return bars;
};

test("waitForBarClose=true suppresses the forming-bar (mid-candle) signal", () => {
  const bars = buildForminBarBreakoutSeries();
  const last = bars.length - 1;
  const settings = resolvePyrusSignalsSignalSettings({ waitForBarClose: true });
  // Mirrors the production call site: includeProvisionalSignals: !waitForBarClose
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings,
    includeProvisionalSignals: !settings.waitForBarClose,
  });
  assert.equal(
    evaluation.signalEvents.some((s) => s.barIndex === last),
    false,
    "no signal should fire on the still-forming last bar",
  );
});

test("waitForBarClose=false admits the forming-bar (live-edge) signal", () => {
  const bars = buildForminBarBreakoutSeries();
  const last = bars.length - 1;
  const settings = resolvePyrusSignalsSignalSettings({ waitForBarClose: false });
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings,
    includeProvisionalSignals: !settings.waitForBarClose,
  });
  assert.ok(
    evaluation.signalEvents.some(
      (s) => s.barIndex === last && s.direction === "long",
    ),
    "mid-candle signal should fire when the user opts out of bar-close",
  );
});

test("the forming bar is the only difference between close-only and live modes", () => {
  const bars = buildForminBarBreakoutSeries();
  const closeOnly = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings: resolvePyrusSignalsSignalSettings({ waitForBarClose: true }),
    includeProvisionalSignals: false,
  });
  const live = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings: resolvePyrusSignalsSignalSettings({ waitForBarClose: false }),
    includeProvisionalSignals: true,
  });
  assert.equal(closeOnly.signalEvents.length, live.signalEvents.length - 1);
});

test("default includeProvisionalSignals ignores waitForBarClose — call sites must be explicit", () => {
  // Regression guard documenting WHY the fix passes !waitForBarClose explicitly:
  // the core defaults provisional signals ON, so an unset flag would let a
  // mid-candle signal through even with waitForBarClose=true.
  const bars = buildForminBarBreakoutSeries();
  const last = bars.length - 1;
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings: resolvePyrusSignalsSignalSettings({ waitForBarClose: true }),
  });
  assert.ok(evaluation.signalEvents.some((s) => s.barIndex === last));
});

test("lastBarClosed=true emits the final-bar signal at its own close under waitForBarClose", () => {
  // Completed-series callers (the signal monitor) prove the final bar closed;
  // waitForBarClose's forming-bar guard must not cost them a full extra bar.
  const bars = buildForminBarBreakoutSeries();
  const last = bars.length - 1;
  const settings = resolvePyrusSignalsSignalSettings({ waitForBarClose: true });
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings,
    includeProvisionalSignals: !settings.waitForBarClose,
    lastBarClosed: true,
  });
  assert.ok(
    evaluation.signalEvents.some(
      (s) => s.barIndex === last && s.direction === "long" && s.actionable,
    ),
    "a provably-closed final bar's signal should fire at its own close",
  );
});

test("lastBarClosed=false preserves the forming-bar suppression", () => {
  const bars = buildForminBarBreakoutSeries();
  const last = bars.length - 1;
  const settings = resolvePyrusSignalsSignalSettings({ waitForBarClose: true });
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings,
    includeProvisionalSignals: !settings.waitForBarClose,
    lastBarClosed: false,
  });
  assert.equal(
    evaluation.signalEvents.some((s) => s.barIndex === last),
    false,
    "an unproven final bar keeps the conservative one-bar wait",
  );
});

const BASIS_LENGTH = 80;

// A monotonically rising/falling close series of `count` bars. Direction is
// established only once the WMA basis has enough finite points to compare
// basis[i] vs basis[i-5] (needs > basisLength bars).
const buildTrendSeries = (count: number, slope: number): PyrusSignalsBar[] => {
  const bars: PyrusSignalsBar[] = [];
  for (let i = 0; i < count; i += 1) {
    const c = 100 + i * slope;
    bars.push(mkBar(i, c, c + 0.5, c - 0.5, c));
  }
  return bars;
};

test("resolvePyrusSignalsTrendDirection returns 0 (neutral) for empty bars", () => {
  // Regression: the old default returned +1 (spurious bullish) on empty bars.
  assert.equal(resolvePyrusSignalsTrendDirection([], BASIS_LENGTH), 0);
});

test("resolvePyrusSignalsTrendDirection returns 0 (neutral) when history < basisLength", () => {
  // Regression: 470/580 daily-frame symbols have < 80 bars, so the WMA is
  // all-NaN and the function used to return a hardcoded bullish +1. It must now
  // return neutral so consumers treat the frame as non-confirming, not bullish.
  const bars = buildTrendSeries(BASIS_LENGTH - 2, 1);
  assert.equal(resolvePyrusSignalsTrendDirection(bars, BASIS_LENGTH), 0);
});

test("resolvePyrusSignalsTrendDirection returns +1 for a clear uptrend with sufficient history", () => {
  const bars = buildTrendSeries(BASIS_LENGTH + 20, 1);
  assert.equal(resolvePyrusSignalsTrendDirection(bars, BASIS_LENGTH), 1);
});

test("resolvePyrusSignalsTrendDirection returns -1 for a clear downtrend with sufficient history", () => {
  const bars = buildTrendSeries(BASIS_LENGTH + 20, -1);
  assert.equal(resolvePyrusSignalsTrendDirection(bars, BASIS_LENGTH), -1);
});

test("a neutral (0) MTF frame never satisfies a required ±1 direction gate", () => {
  // Mirrors how consumers gate alignment: matches = directions.filter(d => d === sign).
  // A neutral frame (insufficient history) must count against, never toward, a
  // required bullish OR bearish gate — and must not falsely "align" with itself.
  const neutral: number = resolvePyrusSignalsTrendDirection(
    buildTrendSeries(BASIS_LENGTH - 2, 1),
    BASIS_LENGTH,
  );
  assert.equal(neutral, 0);
  for (const requiredSign of [1, -1]) {
    // matches = directions.filter(d => d === requiredSign): a neutral frame
    // never counts toward a required bullish OR bearish gate.
    assert.equal(neutral === requiredSign, false);
  }
});

test("buildPyrusSignalsDirectionalFeatures signs momentum and range by signal direction", () => {
  const bars = Array.from({ length: 90 }, (_, index) => {
    const c = 100 + index;
    return mkBar(index, c - 0.2, c + 1, c - 1, c);
  });

  const long = buildPyrusSignalsDirectionalFeatures({
    chartBars: bars,
    index: 89,
    direction: 1,
    mtfDirections: [1, -1, 1],
    adx: 30,
    volatilityScore: 6,
    atr: 2,
  });
  const short = buildPyrusSignalsDirectionalFeatures({
    chartBars: bars,
    index: 89,
    direction: -1,
    mtfDirections: [1, -1, 1],
    adx: 30,
    volatilityScore: 6,
    atr: 2,
  });

  assert.equal(long.version, "directional-features-v1");
  assert.ok(long.shortMomentumPct > 0);
  assert.ok(long.mediumMomentumPct > long.shortMomentumPct);
  assert.ok(long.longMomentumPct > long.mediumMomentumPct);
  assert.ok(short.shortMomentumPct < 0);
  assert.ok(short.rangePosition20 < long.rangePosition20);
  assert.equal(long.volumeRatio20, 1);
  assert.equal(long.mtfAlignment, 1.5);
  assert.equal(short.mtfAlignment, 0);
  assert.ok(long.riskAdjustedMomentum > 0);
});

test("buildPyrusSignalsDirectionalFeatures does not read future bars", () => {
  const bars = Array.from({ length: 90 }, (_, index) => {
    const c = 100 + index;
    return mkBar(index, c - 0.2, c + 1, c - 1, c);
  });
  const base = buildPyrusSignalsDirectionalFeatures({
    chartBars: bars,
    index: 80,
    direction: 1,
    mtfDirections: [1, 1, 1],
    adx: 24,
    volatilityScore: 5,
    atr: 1.5,
  });
  const withFutureSpike = buildPyrusSignalsDirectionalFeatures({
    chartBars: [
      ...bars.slice(0, 81),
      mkBar(81, 10_000, 10_100, 9_900, 10_050),
      ...bars.slice(82),
    ],
    index: 80,
    direction: 1,
    mtfDirections: [1, 1, 1],
    adx: 24,
    volatilityScore: 5,
    atr: 1.5,
  });

  assert.deepEqual(withFutureSpike, base);
});

test("aggregatePyrusSignalsBarsForTimeframe: date is the first 10 chars of ts, OHLCV merges per bucket", () => {
  const day = 1_700_000_000; // 2023-11-14T22:13:20Z
  const bars: PyrusSignalsBar[] = [
    { time: day, o: 10, h: 12, l: 9, c: 11, v: 100 },
    { time: day + 60, o: 11, h: 15, l: 8, c: 13, v: 50 }, // same UTC day -> merges
    { time: day + 86_400, o: 20, h: 22, l: 19, c: 21, v: 200 }, // next UTC day
  ];

  const agg = aggregatePyrusSignalsBarsForTimeframe(bars, "D");

  assert.equal(agg.length, 2);
  // The perf change derives `date` from the single `ts` string instead of a second
  // Date+toISOString. This invariant must hold for every emitted bucket.
  for (const bar of agg) {
    assert.ok(bar.ts);
    assert.equal(bar.date, bar.ts.slice(0, 10));
  }
  assert.equal(agg[0].ts, "2023-11-14T00:00:00.000Z");
  assert.equal(agg[0].date, "2023-11-14");
  // bucket 1 merged the two same-day bars: open kept, max high, min low, last
  // close, summed volume.
  assert.deepEqual(
    { o: agg[0].o, h: agg[0].h, l: agg[0].l, c: agg[0].c, v: agg[0].v },
    { o: 10, h: 15, l: 8, c: 13, v: 150 },
  );
  // bucket 2 is the untouched next-day bar.
  assert.equal(agg[1].c, 21);
  assert.equal(agg[1].v, 200);
});

// --- unwarmed-trend guard (trendBasisComputable / marketStructureDirection) ---

// Steadily falling closes: with enough bars the WMA basis slope is clearly
// negative, so a warmed evaluation must report a bearish trend.
const buildDowntrendSeries = (n: number): PyrusSignalsBar[] => {
  const bars: PyrusSignalsBar[] = [];
  for (let i = 0; i < n; i += 1) {
    const base = 200 - i * 0.4;
    bars.push(mkBar(i, base, base + 0.5, base - 0.5, base));
  }
  return bars;
};

test("trendBasisComputable is false below basisLength + 5 bars (direction seed must not be trusted)", () => {
  const settings = resolvePyrusSignalsSignalSettings({});
  const bars = buildDowntrendSeries(50); // 50 < basisLength(80) + 5
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings,
    includeProvisionalSignals: false,
    lastBarClosed: true,
  });
  assert.equal(evaluation.trendBasisComputable, false);
  // The series still carries its bullish seed — which is exactly why callers
  // must consult trendBasisComputable before trusting it.
  assert.equal(evaluation.trendDirection[bars.length - 1], 1);
});

test("trendBasisComputable is true once the basis warms up and a downtrend reads bearish", () => {
  const settings = resolvePyrusSignalsSignalSettings({});
  const bars = buildDowntrendSeries(200);
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings,
    includeProvisionalSignals: false,
    lastBarClosed: true,
  });
  assert.equal(evaluation.trendBasisComputable, true);
  assert.equal(evaluation.trendDirection[bars.length - 1], -1);
});

test("marketStructureDirection reports the latched CHoCH direction", () => {
  const settings = resolvePyrusSignalsSignalSettings({});
  const bars = buildForminBarBreakoutSeries(); // plants a bullish CHoCH
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings,
    includeProvisionalSignals: true,
    lastBarClosed: true,
  });
  assert.equal(evaluation.marketStructureDirection, 1);
});

test("marketStructureDirection stays 0 when no structure break ever latched", () => {
  const settings = resolvePyrusSignalsSignalSettings({});
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: buildDowntrendSeries(50),
    settings,
    includeProvisionalSignals: false,
    lastBarClosed: true,
  });
  assert.equal(evaluation.marketStructureDirection, 0);
});
