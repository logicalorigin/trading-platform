import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
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
