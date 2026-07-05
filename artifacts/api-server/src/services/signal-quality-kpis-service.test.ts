import assert from "node:assert/strict";
import test from "node:test";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  signalMonitorProfilesTable,
  signalQualityKpiSnapshotsTable,
  watchlistsTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import type { SignalQualityKpiResult } from "./signal-quality-kpis";
import {
  getDeploymentSignalQualityKpis,
  refreshDeploymentSignalQualityKpiSnapshot,
  type SignalQualityKpiResponse,
  __signalQualityKpisServiceInternalsForTests,
} from "./signal-quality-kpis-service";

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

function buildKpiResponse(deploymentId: string): SignalQualityKpiResponse {
  return {
    deploymentId,
    asOfDay: "2026-07-02",
    settings: {
      signalTimeframe: "5m",
      timeHorizon: 8,
      outcomeHorizonBars: 8,
      outcomeTimeframe: "5m",
      bosConfirmation: "wicks",
      chochAtrBuffer: 0,
      chochBodyExpansionAtr: 0,
      chochVolumeGate: 0,
    },
    mtf: {
      enabled: true,
      requiredCount: 2,
      timeframes: ["5m", "15m", "1h"],
    },
    kpis: buildCalibratedKpis(),
    coverage: {
      requestedTimeframe: "5m",
      resolvedTimeframe: "5m",
      requestedWindowDays: 90,
      windowStart: "2026-05-12T14:00:00.000Z",
      windowEnd: "2026-07-02T20:00:00.000Z",
      requestedSymbolCount: 2,
      evaluatedSymbolCount: 2,
      symbolsWithBars: 2,
      symbolsTimedOut: 0,
      barsPerSymbolCap: 720,
      totalBars: 1440,
      truncatedSymbolUniverse: false,
      usedTimeframeFallback: false,
    },
    generatedAt: "2026-07-02T20:30:00.000Z",
  };
}

async function seedSignalQualityDeployment(
  db: typeof import("@workspace/db").db,
) {
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: "Snapshot Strategy",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["SPY", "QQQ"],
      config: {},
    })
    .returning({ id: algoStrategiesTable.id });
  assert.ok(strategy);

  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      strategyId: strategy.id,
      name: "Snapshot Deployment",
      mode: "shadow",
      enabled: true,
      providerAccountId: "paper",
      symbolUniverse: ["SPY", "QQQ"],
      config: {
        parameters: {
          signalTimeframe: "5m",
        },
      },
    })
    .returning({ id: algoDeploymentsTable.id });
  assert.ok(deployment);
  const [watchlist] = await db
    .insert(watchlistsTable)
    .values({
      name: "Signal Quality Snapshot Test",
      isDefault: true,
    })
    .returning({ id: watchlistsTable.id });
  assert.ok(watchlist);
  await db.insert(signalMonitorProfilesTable).values({
    environment: "shadow",
    enabled: true,
    watchlistId: watchlist.id,
    timeframe: "5m",
    pyrusSignalsSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: 60,
    maxSymbols: 2000,
    evaluationConcurrency: 6,
  });
  return deployment.id;
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

test("signal-quality KPI GET returns a cheap pending response when no snapshot exists", async () => {
  await withTestDb(async ({ db }) => {
    const deploymentId = await seedSignalQualityDeployment(db);
    const restore =
      __signalQualityKpisServiceInternalsForTests.__setComputeResponseForTests(
        async () => {
          throw new Error("GET must not run cold signal-quality computation");
        },
      );
    try {
      const response = await getDeploymentSignalQualityKpis({ deploymentId });

      assert.equal(response.deploymentId, deploymentId);
      assert.equal(response.coverage.evaluatedSymbolCount, 2);
      assert.equal(response.coverage.symbolsWithBars, 0);
      assert.equal(response.coverage.symbolsTimedOut, 0);
      assert.equal(
        response.kpis.scoreModelComparisons.calibration.state,
        "needs_more_data",
      );
      assert.deepEqual(
        response.kpis.scoreModelComparisons.calibration.reasons,
        ["min_observation_count"],
      );
    } finally {
      restore();
    }
  });
});

test("signal-quality KPI refresh stores a snapshot that GET returns without recomputing", async () => {
  await withTestDb(async ({ db }) => {
    const deploymentId = await seedSignalQualityDeployment(db);
    const computed = buildKpiResponse(deploymentId);
    const restoreRefresh =
      __signalQualityKpisServiceInternalsForTests.__setComputeResponseForTests(
        async () => computed,
      );
    try {
      assert.deepEqual(
        await refreshDeploymentSignalQualityKpiSnapshot({ deploymentId }),
        computed,
      );
    } finally {
      restoreRefresh();
    }

    const rows = await db.select().from(signalQualityKpiSnapshotsTable);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.deploymentId, deploymentId);
    assert.equal(rows[0]?.resolvedTimeframe, "5m");
    assert.equal(rows[0]?.calibrationState, "calibrated");
    assert.equal(rows[0]?.recommendedModelKey, "sot-outcome-v1");

    const restoreGet =
      __signalQualityKpisServiceInternalsForTests.__setComputeResponseForTests(
        async () => {
          throw new Error("snapshot-backed GET must not recompute");
        },
      );
    try {
      assert.deepEqual(
        await getDeploymentSignalQualityKpis({ deploymentId }),
        computed,
      );

      await db
        .update(algoDeploymentsTable)
        .set({ symbolUniverse: ["QQQ", "SPY"] })
        .where(eq(algoDeploymentsTable.id, deploymentId));
      assert.deepEqual(
        await getDeploymentSignalQualityKpis({ deploymentId }),
        computed,
      );
    } finally {
      restoreGet();
    }
  });
});

test("signal-quality KPI snapshot read reuses the latest saved snapshot after day and settings drift", async () => {
  await withTestDb(async ({ db }) => {
    const deploymentId = await seedSignalQualityDeployment(db);
    const computed = buildKpiResponse(deploymentId);
    const {
      readSignalQualityKpiSnapshot,
      writeSignalQualityKpiSnapshot,
    } = __signalQualityKpisServiceInternalsForTests;

    await writeSignalQualityKpiSnapshot(
      {
        deploymentId,
        settingsHash: "previous-hash",
        day: "2026-07-02",
      } as never,
      computed,
    );

    assert.deepEqual(
      await readSignalQualityKpiSnapshot({
        deploymentId,
        settingsHash: "current-hash",
        day: "2026-07-03",
      } as never),
      computed,
    );
    assert.equal(
      await readSignalQualityKpiSnapshot({
        deploymentId,
        settingsHash: "current-hash",
        day: "2026-07-03",
        draft: { signalTimeframe: "15m" },
      } as never),
      null,
    );

    await db
      .delete(signalQualityKpiSnapshotsTable)
      .where(eq(signalQualityKpiSnapshotsTable.deploymentId, deploymentId));
  });
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

test("signal-quality KPI freshness tolerates after-hours lag inside the stale window", () => {
  const { signalQualityBarWindowFresh } =
    __signalQualityKpisServiceInternalsForTests;

  assert.equal(
    signalQualityBarWindowFresh({
      timeframe: "15m",
      latestBarAt: new Date("2026-07-02T22:45:00.000Z"),
      now: new Date("2026-07-02T23:16:53.209Z"),
    }),
    true,
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

test("signal-quality KPI bar loader retries statement-timeout chunks in smaller slices", async () => {
  const { loadSymbolBarsChunk } =
    __signalQualityKpisServiceInternalsForTests;
  const symbols = Array.from({ length: 20 }, (_, index) => `SYM${index}`);
  const calls: string[][] = [];

  const result = await loadSymbolBarsChunk(
    symbols,
    "15m",
    new Date("2026-05-12T14:00:00.000Z"),
    720,
    Number.POSITIVE_INFINITY,
    async (chunk) => {
      calls.push([...chunk]);
      if (chunk.length > 5) {
        const cause = new Error("canceling statement due to statement timeout");
        (cause as Error & { code?: string }).code = "57014";
        const error = new Error("Query failed");
        (error as Error & { cause?: unknown }).cause = cause;
        throw error;
      }
      return chunk.map((symbol) => ({ symbol, bars: [], timedOut: false }));
    },
  );

  assert.deepEqual(calls.map((chunk) => chunk.length), [20, 5, 5, 5, 5]);
  assert.equal(result.length, 20);
  assert.equal(result.filter((entry) => entry.timedOut).length, 0);
});

test("signal-quality KPI bar loader does not retry non-timeout chunk failures", async () => {
  const { loadSymbolBarsChunk } =
    __signalQualityKpisServiceInternalsForTests;
  const symbols = Array.from({ length: 20 }, (_, index) => `SYM${index}`);
  const calls: string[][] = [];

  const result = await loadSymbolBarsChunk(
    symbols,
    "15m",
    new Date("2026-05-12T14:00:00.000Z"),
    720,
    Number.POSITIVE_INFINITY,
    async (chunk) => {
      calls.push([...chunk]);
      const error = new Error("synthetic connection failure");
      (error as Error & { code?: string }).code = "08006";
      throw error;
    },
  );

  assert.deepEqual(calls.map((chunk) => chunk.length), [20]);
  assert.equal(result.length, 20);
  assert.equal(result.filter((entry) => entry.timedOut).length, 20);
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
    barFetchConcurrency: 1,
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
    barFetchConcurrency: 1,
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
    barFetchConcurrency: 1,
    barFetchHardBudgetMs: 480_000,
  });
});

test("outcomeTimeframe defaults to signalTimeframe and is overridable per KPI scope", () => {
  const { resolveDeploymentSignalSettings } =
    __signalQualityKpisServiceInternalsForTests;
  const base = {
    profilePyrusSignalsSettings: {},
    profileTimeframe: "1m",
  };
  // Unset -> byte-identical to signalTimeframe (no behavior change).
  const unset = resolveDeploymentSignalSettings({
    ...base,
    deploymentConfig: { parameters: { signalTimeframe: "1m" } },
  });
  assert.equal(unset.outcomeTimeframe, unset.signalTimeframe);
  // config.parameters.outcomeTimeframe re-anchors ONLY the KPI measurement
  // timeframe; the trading signalTimeframe is untouched.
  const overridden = resolveDeploymentSignalSettings({
    ...base,
    deploymentConfig: {
      parameters: { signalTimeframe: "1m", outcomeTimeframe: "15m" },
    },
  });
  assert.equal(overridden.signalTimeframe, "1m");
  assert.equal(overridden.outcomeTimeframe, "15m");
  // Draft override wins over saved config.
  const drafted = resolveDeploymentSignalSettings({
    ...base,
    deploymentConfig: {
      parameters: { signalTimeframe: "1m", outcomeTimeframe: "15m" },
    },
    draft: { outcomeTimeframe: "1h" },
  });
  assert.equal(drafted.outcomeTimeframe, "1h");
});
