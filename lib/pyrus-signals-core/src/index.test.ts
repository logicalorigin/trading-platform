import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
