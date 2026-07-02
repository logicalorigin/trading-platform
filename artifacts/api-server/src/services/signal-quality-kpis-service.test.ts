import assert from "node:assert/strict";
import test from "node:test";

import type { SignalQualityKpiResult } from "./signal-quality-kpis";
import { __signalQualityKpisServiceInternalsForTests } from "./signal-quality-kpis-service";

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

const emptyMetrics = {
  signalCount: 0,
  avgDirectionalMovePercent: 0,
  correctnessPercent: 0,
  expectancyPercent: 0,
  payoffRatio: 0,
  avgMfePercent: 0,
  avgMaePercent: 0,
  consistencyStdDevPercent: 0,
};

function buildCalibratedKpis(): SignalQualityKpiResult {
  return {
    ...emptyMetrics,
    horizonBars: 8,
    mtfFilteredOutCount: 0,
    perSymbol: [],
    byDirection: {
      buy: emptyMetrics,
      sell: emptyMetrics,
    },
    byScoreRange: {},
    scoreBuckets: [],
    scoreRangeBuckets: [],
    featureSummaries: [],
    scoreModelComparisons: {
      observationCount: 120,
      modelKeys: ["sot-outcome-v1"],
      recommendedModelKey: "sot-outcome-v1",
      calibration: {
        state: "calibrated",
        recommendedModelKey: "sot-outcome-v1",
        candidateModelKey: "sot-outcome-v1",
        supportedModelCount: 1,
        reasons: [],
      },
      models: [],
    },
  };
}

test("signal-quality KPI symbol selection evaluates the full 500-symbol deployment universe", () => {
  const { selectSignalQualitySymbols } =
    __signalQualityKpisServiceInternalsForTests;
  const universe = Array.from({ length: 500 }, (_, index) => `SYM${index}`);

  const selected = selectSignalQualitySymbols(universe);

  assert.equal(selected.length, 500);
  assert.equal(selected[0], "SYM0");
  assert.equal(selected[499], "SYM499");
});

test("signal-quality KPI freshness rejects month-old intraday bars", () => {
  const { signalQualityBarWindowFresh } =
    __signalQualityKpisServiceInternalsForTests;

  assert.equal(
    signalQualityBarWindowFresh({
      timeframe: "2m",
      latestBarAt: new Date("2026-05-29T23:58:00.000Z"),
      now: new Date("2026-06-28T01:45:03.268Z"),
    }),
    false,
  );
});

test("signal-quality KPI freshness accepts the latest quiet-session intraday edge", () => {
  const { signalQualityBarWindowFresh } =
    __signalQualityKpisServiceInternalsForTests;

  assert.equal(
    signalQualityBarWindowFresh({
      timeframe: "5m",
      latestBarAt: new Date("2026-06-26T23:55:00.000Z"),
      now: new Date("2026-06-28T01:45:03.268Z"),
    }),
    true,
  );
});

test("signal-quality KPI freshness compares daily bars by trading date", () => {
  const { signalQualityBarWindowFresh } =
    __signalQualityKpisServiceInternalsForTests;

  assert.equal(
    signalQualityBarWindowFresh({
      timeframe: "1d",
      latestBarAt: new Date("2026-06-26T00:00:00.000Z"),
      now: new Date("2026-06-28T01:45:03.268Z"),
    }),
    true,
  );
});

test("signal-quality KPI freshness requires the active-session live edge", () => {
  const { signalQualityBarWindowFresh } =
    __signalQualityKpisServiceInternalsForTests;

  assert.equal(
    signalQualityBarWindowFresh({
      timeframe: "1m",
      latestBarAt: new Date("2026-06-08T14:45:00.000Z"),
      now: new Date("2026-06-08T15:00:00.000Z"),
    }),
    false,
  );
});

test("signal-quality KPI coverage gate keeps healthy full-universe calibration", () => {
  const {
    applySignalQualityCalibrationCoverageGate,
    signalQualityCalibrationCoverageGate,
  } = __signalQualityKpisServiceInternalsForTests;
  const kpis = buildCalibratedKpis();

  const gate = signalQualityCalibrationCoverageGate({
    evaluatedSymbolCount: 500,
    symbolsWithBars: 496,
    symbolsTimedOut: 0,
  });

  assert.equal(gate.supported, true);
  assert.equal(applySignalQualityCalibrationCoverageGate(kpis, gate), kpis);
});

test("signal-quality KPI coverage gate blocks degraded partial-sample calibration", () => {
  const {
    applySignalQualityCalibrationCoverageGate,
    signalQualityCalibrationCoverageGate,
  } = __signalQualityKpisServiceInternalsForTests;
  const kpis = buildCalibratedKpis();

  const gate = signalQualityCalibrationCoverageGate({
    evaluatedSymbolCount: 500,
    symbolsWithBars: 258,
    symbolsTimedOut: 240,
  });
  const gated = applySignalQualityCalibrationCoverageGate(kpis, gate);

  assert.equal(gate.supported, false);
  assert.deepEqual(gate.reasons, ["coverage_degraded"]);
  assert.equal(gated.scoreModelComparisons.recommendedModelKey, null);
  assert.equal(gated.scoreModelComparisons.calibration.state, "uncalibrated");
  assert.equal(
    gated.scoreModelComparisons.calibration.recommendedModelKey,
    null,
  );
  assert.equal(gated.scoreModelComparisons.calibration.supportedModelCount, 0);
  assert.deepEqual(gated.scoreModelComparisons.calibration.reasons, [
    "coverage_degraded",
  ]);
});

test("signal-quality KPI cold recomputes are serialized", async () => {
  const { getKpiComputeQueueSnapshot, runQueuedKpiCompute } =
    __signalQualityKpisServiceInternalsForTests;
  const starts: string[] = [];
  let releaseFirst: () => void = () => {
    throw new Error("first task did not start");
  };

  const first = runQueuedKpiCompute(async () => {
    starts.push("first");
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    return "first";
  });
  const second = runQueuedKpiCompute(async () => {
    starts.push("second");
    return "second";
  });

  await nextTick();

  assert.deepEqual(starts, ["first"]);
  assert.deepEqual(getKpiComputeQueueSnapshot(), {
    active: 1,
    queued: 1,
    concurrency: 1,
    barFetchConcurrency: 3,
    barFetchHardBudgetMs: 480_000,
  });

  releaseFirst();

  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.deepEqual(starts, ["first", "second"]);
  await nextTick();
  assert.deepEqual(getKpiComputeQueueSnapshot(), {
    active: 0,
    queued: 0,
    concurrency: 1,
    barFetchConcurrency: 3,
    barFetchHardBudgetMs: 480_000,
  });
});

test("signal-quality KPI queue releases the slot after synchronous failure", async () => {
  const { getKpiComputeQueueSnapshot, runQueuedKpiCompute } =
    __signalQualityKpisServiceInternalsForTests;
  const starts: string[] = [];

  const failed = runQueuedKpiCompute(() => {
    starts.push("failed");
    throw new Error("synthetic failure");
  });
  const next = runQueuedKpiCompute(async () => {
    starts.push("next");
    return "next";
  });

  await assert.rejects(failed, /synthetic failure/);
  assert.equal(await next, "next");
  assert.deepEqual(starts, ["failed", "next"]);
  await nextTick();
  assert.deepEqual(getKpiComputeQueueSnapshot(), {
    active: 0,
    queued: 0,
    concurrency: 1,
    barFetchConcurrency: 3,
    barFetchHardBudgetMs: 480_000,
  });
});
