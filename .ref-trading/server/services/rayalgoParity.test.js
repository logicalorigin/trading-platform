import test from "node:test";
import assert from "node:assert/strict";

import { computeRayAlgoParityReport } from "./rayalgoParity.js";

function buildRow({
  signalId,
  source,
  eventType,
  signalClass = null,
  direction = "buy",
  ts = "2026-03-26T10:00:00.000Z",
}) {
  return {
    signalId,
    source,
    strategy: "rayalgo",
    symbol: "AMEX:SPY",
    timeframe: "5",
    eventType,
    signalClass,
    direction,
    ts,
    conviction: 0.65,
    regime: "bull",
    components: {
      emaCross: 1,
      bosRecent: 1,
      chochRecent: 1,
      obDir: 1,
      sweepDir: 0,
      bandTrend: 1,
      bandRetest: 0,
    },
  };
}

test("generic pine signal can match local trend-change parity row", () => {
  const report = computeRayAlgoParityReport({
    symbol: "AMEX:SPY",
    timeframe: "5",
    pineSignals: [
      buildRow({
        signalId: "pine-1",
        source: "pine",
        eventType: "signal",
        direction: "buy",
      }),
    ],
    localSignals: [
      buildRow({
        signalId: "local-1",
        source: "local",
        eventType: "trend_change",
        signalClass: "trend_change",
        direction: "buy",
      }),
    ],
    windowSeconds: 300,
  });

  assert.equal(report.counts.matched, 1);
  assert.equal(report.buy.matched, 1);
  assert.equal(report.overall.signalClassMatchRate, 1);
});

test("opposite-direction rows do not pair in parity report", () => {
  const report = computeRayAlgoParityReport({
    symbol: "AMEX:SPY",
    timeframe: "5",
    pineSignals: [
      buildRow({
        signalId: "pine-other",
        source: "pine",
        eventType: "signal",
        signalClass: null,
        direction: "sell",
      }),
    ],
    localSignals: [
      buildRow({
        signalId: "local-trend",
        source: "local",
        eventType: "trend_change",
        signalClass: "trend_change",
        direction: "buy",
      }),
    ],
    windowSeconds: 300,
  });

  assert.equal(report.counts.matched, 0);
  assert.equal(report.buy.matched, 0);
  assert.equal(report.sell.matched, 0);
  assert.ok(report.unmatchedExamples.length >= 1);
});
