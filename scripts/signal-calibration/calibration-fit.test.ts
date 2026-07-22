import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __calibrationFitInternalsForTests } from "./calibration-fit";

const {
  buildReport,
  buildRollingOriginFolds,
  fitIsotonic,
  loadDump,
  loadRequestedDumps,
  parseOptions,
  predictIsotonic,
  renderMarkdown,
  validateDumpSet,
  weightedMean,
  writeFileAtomically,
} = __calibrationFitInternalsForTests;

const row = {
  symbol: "SYM",
  direction: "long" as const,
  score: 50,
  directionalFeatures: { rangePosition20: 0.5 },
  realizedReturnPercent: 1,
  mfePercent: 2,
  maePercent: -1,
  audit: {
    signalAt: "2026-07-01T14:30:00.000Z",
    outcomeExitBarAt: "2026-07-01T16:40:00.000Z",
    mtfTimeframes: ["2m", "5m", "15m"],
    mtfDirections: [1, 1, 1],
  },
};

function header(overrides: Record<string, unknown> = {}) {
  return {
    header: true,
    schemaVersion: 2,
    runId: "run-1",
    deploymentId: "deployment-1",
    asOfDay: "2026-07-13",
    requestedTimeframe: "5m",
    resolvedTimeframe: "5m",
    generatedAt: "2026-07-13T12:00:00.000Z",
    outcomeHorizonBars: 26,
    settings: {
      signalTimeframe: "5m",
      timeHorizon: 20,
      outcomeHorizonBars: 26,
      outcomeTimeframe: "5m",
      bosConfirmation: "close",
      chochAtrBuffer: 0.1,
      chochBodyExpansionAtr: 0.2,
      chochVolumeGate: 1,
    },
    mtf: { enabled: true, requiredCount: 3, timeframes: ["2m", "5m", "15m"] },
    count: 1,
    coverage: {
      requestedTimeframe: "5m",
      resolvedTimeframe: "5m",
      requestedWindowDays: 30,
      windowStart: "2026-06-13T12:00:00.000Z",
      windowEnd: "2026-07-13T12:00:00.000Z",
      requestedSymbolCount: 100,
      evaluatedSymbolCount: 100,
      symbolsWithBars: 100,
      symbolsTimedOut: 0,
      barsPerSymbolCap: 10_000,
      totalBars: 50_000,
      truncatedSymbolUniverse: false,
      usedTimeframeFallback: false,
    },
    calibrationCoverage: {
      supported: true,
      reasons: [],
      symbolCoverageRatio: 1,
      timeoutRatio: 0,
    },
    ...overrides,
  };
}

function withDump(
  dumpHeader: Record<string, unknown>,
  rows: unknown[],
  run: (inputDir: string) => void,
) {
  const inputDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-calibration-fit-"),
  );
  writeFileSync(
    path.join(inputDir, "observations-5m.jsonl"),
    [dumpHeader, ...rows].map((value) => JSON.stringify(value)).join("\n") +
      "\n",
  );
  try {
    run(inputDir);
  } finally {
    rmSync(inputDir, { recursive: true, force: true });
  }
}

test("calibration CLI rejects unknown scorer names and out-of-range thresholds", () => {
  assert.deepEqual(
    parseOptions(["--scorers", "expected-move-v3"]).scorers,
    ["expected-move-v3"],
  );
  assert.throws(
    () => parseOptions(["--scorers", "expected-move-v2,typo"]),
    /Invalid scorer "typo"/,
  );
  assert.throws(
    () => parseOptions(["--score-threshold", "101"]),
    /score-threshold.*between 0 and 100/,
  );
  assert.throws(
    () => parseOptions(["--mfe-thresholds", "10,-1"]),
    /mfe-thresholds.*non-negative/,
  );
});

test("calibration CLI rejects unknown and duplicate flags", () => {
  assert.deepEqual(parseOptions(["--", "--timeframes", "5m"]).timeframes, [
    "5m",
  ]);
  assert.throws(
    () => parseOptions(["--wat", "value"]),
    /Unknown argument.*--wat/,
  );
  assert.throws(
    () => parseOptions(["--input-dir", "one", "--input-dir", "two"]),
    /Duplicate argument.*--input-dir/,
  );
  assert.throws(
    () => parseOptions(["--timeframes", "1m"]),
    /Invalid timeframe "1m"/,
  );
});

test("loadDump requires versioned provenance and exact timeframe identity", () => {
  withDump(
    {
      header: true,
      resolvedTimeframe: "5m",
      outcomeHorizonBars: 26,
      count: 1,
    },
    [row],
    (inputDir) => {
      assert.throws(() => loadDump(inputDir, "5m"), /schemaVersion 2/);
    },
  );
  withDump(header({ resolvedTimeframe: "15m" }), [row], (inputDir) => {
    assert.throws(
      () => loadDump(inputDir, "5m"),
      /resolved timeframe.*15m.*requested 5m/i,
    );
  });
});

test("loadDump rejects degraded, truncated, or internally inconsistent dumps", () => {
  withDump(
    header({
      calibrationCoverage: {
        supported: false,
        reasons: ["coverage_degraded"],
        symbolCoverageRatio: 0.9,
        timeoutRatio: 0.1,
      },
    }),
    [row],
    (inputDir) => {
      assert.throws(() => loadDump(inputDir, "5m"), /coverage is degraded/i);
    },
  );
  withDump(header({ count: 2 }), [row], (inputDir) => {
    assert.throws(
      () => loadDump(inputDir, "5m"),
      /declares 2 rows but contains 1/,
    );
  });
  withDump(header({ count: 0 }), [], (inputDir) => {
    assert.throws(
      () => loadDump(inputDir, "5m"),
      /count must include at least one observation/,
    );
  });
});

test("loadDump validates every scorer input row before fitting", () => {
  withDump(
    header(),
    [{ ...row, realizedReturnPercent: "not-a-number" }],
    (inputDir) => {
      assert.throws(
        () => loadDump(inputDir, "5m"),
        /row 1.*realizedReturnPercent.*finite number/,
      );
    },
  );
  withDump(header(), [{ ...row, score: 101 }], (inputDir) => {
    assert.throws(
      () => loadDump(inputDir, "5m"),
      /row 1.*score.*between 0 and 100/,
    );
  });
});

test("loadDump accepts a complete versioned artifact", () => {
  withDump(header(), [row], (inputDir) => {
    const dump = loadDump(inputDir, "5m");
    assert.equal(dump?.rows.length, 1);
    assert.equal(dump?.header.count, 1);
  });
});

test("validateDumpSet refuses files from different generation runs", () => {
  const loaded = (timeframe: "5m" | "15m", runId: string) => ({
    timeframe,
    path: `/tmp/observations-${timeframe}.jsonl`,
    mtime: "2026-07-13T12:00:00.000Z",
    header: header({
      runId,
      requestedTimeframe: timeframe,
      resolvedTimeframe: timeframe,
      settings: {
        ...header().settings,
        signalTimeframe: timeframe,
        outcomeTimeframe: timeframe,
      },
      coverage: {
        ...header().coverage,
        requestedTimeframe: timeframe,
        resolvedTimeframe: timeframe,
      },
    }),
    rows: [row],
  });
  assert.throws(
    () =>
      validateDumpSet([loaded("5m", "run-1"), loaded("15m", "run-2")] as never),
    /mix generation runs run-1 and run-2/,
  );
});

test("loadRequestedDumps requires every requested timeframe", () => {
  withDump(header(), [row], (inputDir) => {
    assert.throws(
      () => loadRequestedDumps(inputDir, ["5m", "15m"]),
      /Missing observation dumps for 15m/,
    );
  });
});

test("reports identify rolling-origin output as an audit, not activation evidence", () => {
  withDump(header(), [row], (inputDir) => {
    const dump = loadDump(inputDir, "5m");
    assert.ok(dump);
    const report = buildReport(
      {
        inputDir,
        outputDir: inputDir,
        timeframes: ["5m"],
        scorers: ["observed-score"],
        scoreThreshold: 90,
        mfeThresholds: [10, 20, 30],
      },
      [dump],
    );
    assert.equal(report.analysisMode, "rolling_origin_embargoed");
    assert.equal(report.activationEligible, false);
    assert.equal(report.cells[0]?.holdout.status, "insufficient_history");
    assert.match(renderMarkdown(report), /not.*activation evidence/i);
  });
});

test("calibration report grades only signals admitted by the Algo MTF controls", () => {
  const misaligned = {
    ...row,
    symbol: "MISALIGNED",
    audit: {
      ...row.audit,
      signalAt: "2026-07-01T14:35:00.000Z",
      outcomeExitBarAt: "2026-07-01T16:45:00.000Z",
      mtfDirections: [1, -1, 1],
    },
  };
  withDump(header({ count: 2 }), [row, misaligned], (inputDir) => {
    const dump = loadDump(inputDir, "5m");
    assert.ok(dump);
    const report = buildReport(
      {
        inputDir,
        outputDir: inputDir,
        timeframes: ["5m"],
        scorers: ["observed-score"],
        scoreThreshold: 90,
        mfeThresholds: [10],
      },
      [dump],
    );
    assert.equal(report.cells[0]?.totalObservations, 1);
    assert.deepEqual(report.cohort, {
      key: "algo-control-mtf-aligned",
      contract: "unanimous-configured-timeframes",
      detectedObservationCount: 2,
      admittedObservationCount: 1,
      filteredOutObservationCount: 1,
    });
    assert.equal(report.dumps[0]?.detectedRows, 2);
    assert.equal(report.dumps[0]?.admittedRows, 1);
  });
});

test("rolling-origin folds embargo training outcomes that overlap each test window", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    ...row,
    score: 30 + index,
    audit: {
      ...row.audit,
      signalAt: new Date(
        Date.parse("2026-07-01T00:00:00.000Z") + index * 60 * 60 * 1_000,
      ).toISOString(),
      outcomeExitBarAt: new Date(
        Date.parse("2026-07-01T00:00:00.000Z") +
          (index === 3 ? 7 : index + 2) * 60 * 60 * 1_000,
      ).toISOString(),
    },
  }));
  const folds = buildRollingOriginFolds(rows, 3);
  assert.equal(folds.length, 3);
  assert.deepEqual(
    folds.map((fold) => fold.testRows.length),
    [2, 2, 2],
  );
  assert.ok(
    folds[0].embargoedRows.some(
      (item) => item.audit?.signalAt === "2026-07-01T03:00:00.000Z",
    ),
    "an outcome that crosses the first test boundary must be embargoed even when nominal wall time would look old enough",
  );
  for (const fold of folds) {
    const testStartMs = Date.parse(fold.testStartAt);
    assert.ok(
      fold.trainRows.every(
        (item) =>
          Date.parse(item.audit!.outcomeExitBarAt as string) < testStartMs,
      ),
    );
    assert.ok(
      fold.embargoedRows.every(
        (item) =>
          Date.parse(item.audit!.signalAt as string) < testStartMs &&
          Date.parse(item.audit!.outcomeExitBarAt as string) >= testStartMs,
      ),
    );
  }
});

test("held-out ordering reports magnitude, correctness, and directional return separately", () => {
  const rows = Array.from({ length: 120 }, (_, index) => {
    const score = 20 + (index % 8) * 10;
    return {
      ...row,
      score,
      mfePercent: score / 10,
      realizedReturnPercent: score >= 60 ? -1 : 1,
      audit: {
        ...row.audit,
        signalAt: new Date(
          Date.parse("2026-07-01T14:30:00.000Z") + index * 60 * 60 * 1_000,
        ).toISOString(),
        outcomeExitBarAt: new Date(
          Date.parse("2026-07-01T14:30:00.000Z") +
            (index + 3) * 60 * 60 * 1_000,
        ).toISOString(),
      },
    };
  });
  withDump(header({ count: rows.length }), rows, (inputDir) => {
    const dump = loadDump(inputDir, "5m");
    assert.ok(dump);
    const report = buildReport(
      {
        inputDir,
        outputDir: inputDir,
        timeframes: ["5m"],
        scorers: ["observed-score"],
        scoreThreshold: 90,
        mfeThresholds: [10],
      },
      [dump],
    );
    const holdout = report.cells[0]?.holdout;
    assert.equal(holdout?.status, "ok");
    assert.ok((holdout?.heldOutCount ?? 0) > 0);
    assert.ok(
      (holdout?.magnitudeAlignment?.scoreMfePearson ?? 0) > 0,
      "higher scores should rank larger held-out MFE in this fixture",
    );
    assert.ok(
      (holdout?.expectancyAlignment?.topBucketLiftPercent ?? 0) < 0,
      "the same scores should be reported as directionally inverted",
    );
    assert.ok(
      (holdout?.correctnessAlignment?.topBucketLiftPercentagePoints ?? 0) < 0,
      "higher scores should be reported as less accurate in this fixture",
    );
  });
});

test("report files are atomically replaced with private permissions", () => {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-calibration-fit-"),
  );
  const filePath = path.join(outputDir, "calibration-fit.json");
  writeFileSync(filePath, "old\n");
  try {
    writeFileAtomically(filePath, "new\n");
    assert.equal(readFileSync(filePath, "utf8"), "new\n");
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("fitIsotonic gives tied scores one weighted fitted value", () => {
  assert.deepEqual(
    fitIsotonic([
      { ...row, score: 50, mfePercent: 1 },
      { ...row, score: 50, mfePercent: 3 },
      { ...row, score: 60, mfePercent: 4 },
    ]),
    [
      {
        minScore: 50,
        maxScore: 50,
        count: 2,
        calibratedTargetPercent: 2,
      },
      {
        minScore: 60,
        maxScore: 60,
        count: 1,
        calibratedTargetPercent: 4,
      },
    ],
  );
});

test("isotonic prediction uses the closest internal block instead of the final block", () => {
  const fit = fitIsotonic([
    { ...row, score: 10, mfePercent: 1 },
    { ...row, score: 20, mfePercent: 3 },
  ]);
  assert.equal(predictIsotonic(fit, 14), 1);
  assert.equal(predictIsotonic(fit, 16), 3);
});

test("fold calibration error aggregation is weighted by held-out rows", () => {
  assert.equal(
    weightedMean([
      { value: 1, weight: 1 },
      { value: 3, weight: 3 },
    ]),
    2.5,
  );
});
