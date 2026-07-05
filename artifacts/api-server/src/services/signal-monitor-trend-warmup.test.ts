// Pins the unwarmed-trend guard in computeSignalMonitorIndicatorSnapshotBase:
// an evaluation whose WMA basis never warmed up (fewer than basisLength + 5
// bars) must NOT report the direction series' bullish seed as the cell's
// trendDirection. Short evaluation windows previously marked the whole book
// "bullish", so sell signals could never find bearish MTF confluence and the
// KPI direction split showed zero sells.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
} from "@workspace/pyrus-signals-core";
import { __signalMonitorInternalsForTests } from "./signal-monitor";

const { computeSignalMonitorIndicatorSnapshotBase } =
  __signalMonitorInternalsForTests;

const mkBar = (i: number, close: number): PyrusSignalsBar => ({
  time: 1_700_000_000 + i * 300,
  o: close,
  h: close + 0.5,
  l: close - 0.5,
  c: close,
  v: 1000,
});

const downtrendBars = (n: number): PyrusSignalsBar[] =>
  Array.from({ length: n }, (_, i) => mkBar(i, 200 - i * 0.4));

const buildSnapshot = (chartBars: PyrusSignalsBar[]) => {
  const settings = resolvePyrusSignalsSignalSettings({});
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars,
    settings,
    includeProvisionalSignals: false,
    lastBarClosed: true,
  });
  return computeSignalMonitorIndicatorSnapshotBase({
    chartBars,
    evaluation,
    settings,
  });
};

test("short evaluation window yields trendDirection null, not the bullish seed", () => {
  const snapshot = buildSnapshot(downtrendBars(50)); // < basisLength(80) + 5
  assert.ok(snapshot);
  assert.equal(snapshot.trendDirection, null);
});

test("warmed evaluation window reports the measured (bearish) trend", () => {
  const snapshot = buildSnapshot(downtrendBars(240));
  assert.ok(snapshot);
  assert.equal(snapshot.trendDirection, "bearish");
});

test("unwarmed basis still honors a latched market-structure direction", () => {
  // Mild downtrend that plants a swing high early, then breaks decisively
  // above it -> bullish CHoCH latch inside a window too short for the basis.
  const bars = downtrendBars(60);
  bars[20] = mkBar(20, 220); // swing high
  bars[59] = { ...mkBar(59, 250), o: 180, h: 255, l: 179 }; // breakout bar
  const settings = resolvePyrusSignalsSignalSettings({});
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars,
    settings,
    includeProvisionalSignals: true,
    lastBarClosed: true,
  });
  assert.equal(evaluation.trendBasisComputable, false);
  const snapshot = computeSignalMonitorIndicatorSnapshotBase({
    chartBars: bars,
    evaluation,
    settings,
  });
  assert.ok(snapshot);
  if (evaluation.marketStructureDirection === 1) {
    assert.equal(snapshot.trendDirection, "bullish");
  } else {
    // If the CHoCH filters reject this synthetic break, the direction must
    // still be unknown — never the bullish seed by default.
    assert.equal(evaluation.marketStructureDirection, 0);
    assert.equal(snapshot.trendDirection, null);
  }
});
