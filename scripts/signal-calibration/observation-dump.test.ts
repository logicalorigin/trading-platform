import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __observationDumpInternalsForTests } from "./observation-dump";

const { dumpTimeframe, parseOptions } = __observationDumpInternalsForTests;

const row = {
  symbol: "SYM",
  direction: "long",
  score: 50,
  directionalFeatures: { rangePosition20: 0.5 },
  realizedReturnPercent: 1,
  mfePercent: 2,
  maePercent: -1,
  audit: {
    signalAt: "2026-07-13T14:30:00.000Z",
    outcomeExitBarAt: "2026-07-13T16:40:00.000Z",
    mtfTimeframes: ["2m", "5m", "15m"],
    mtfDirections: [1, 1, 1],
  },
};

function response(input?: {
  resolvedTimeframe?: "5m" | "15m";
  coverageDegraded?: boolean;
  outcomeHorizonBars?: number;
}) {
  const resolvedTimeframe = input?.resolvedTimeframe ?? "5m";
  return {
    asOfDay: "2026-07-13",
    generatedAt: "2026-07-13T12:00:00.000Z",
    settings: {
      signalTimeframe: "5m",
      timeHorizon: 20,
      outcomeHorizonBars: input?.outcomeHorizonBars ?? 26,
      outcomeTimeframe: "5m",
      bosConfirmation: "close",
      chochAtrBuffer: 0.1,
      chochBodyExpansionAtr: 0.2,
      chochVolumeGate: 1,
    },
    mtf: { enabled: true, requiredCount: 3, timeframes: ["2m", "5m", "15m"] },
    coverage: {
      requestedTimeframe: "5m",
      resolvedTimeframe,
      requestedWindowDays: 30,
      windowStart: "2026-06-13T12:00:00.000Z",
      windowEnd: "2026-07-13T12:00:00.000Z",
      requestedSymbolCount: 100,
      evaluatedSymbolCount: 100,
      symbolsWithBars: input?.coverageDegraded ? 90 : 100,
      symbolsTimedOut: input?.coverageDegraded ? 10 : 0,
      barsPerSymbolCap: 10_000,
      totalBars: 50_000,
      truncatedSymbolUniverse: false,
      usedTimeframeFallback: resolvedTimeframe !== "5m",
    },
    kpis: {
      scoreModelComparisons: {
        calibration: {
          reasons: input?.coverageDegraded ? ["coverage_degraded"] : [],
        },
      },
    },
  } as never;
}

function writeServiceDump(
  filePath: string,
  resolvedTimeframe: "5m" | "15m" = "5m",
) {
  writeFileSync(
    filePath,
    `${JSON.stringify({
      header: true,
      resolvedTimeframe,
      outcomeHorizonBars: 26,
      count: 1,
    })}\n${JSON.stringify(row)}\n`,
  );
}

function options(outputDir: string) {
  return {
    deploymentId: "deployment-1",
    timeframes: ["5m" as const],
    outputDir,
  };
}

test("dumpTimeframe preserves the prior artifact and environment when refresh fails", async () => {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-observation-dump-"),
  );
  const finalPath = path.join(outputDir, "observations-5m.jsonl");
  const priorEnvironment = process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH;
  process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH = "sentinel-path";
  writeFileSync(finalPath, "known-good\n");
  try {
    await assert.rejects(
      dumpTimeframe(options(outputDir), "5m", async () => {
        const temporaryPath = process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH;
        assert.ok(temporaryPath);
        assert.notEqual(temporaryPath, finalPath);
        writeFileSync(temporaryPath, "partial\n");
        throw new Error("refresh failed");
      }),
      /refresh failed/,
    );
    assert.equal(readFileSync(finalPath, "utf8"), "known-good\n");
    assert.equal(
      process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH,
      "sentinel-path",
    );
    assert.deepEqual(readdirSync(outputDir), ["observations-5m.jsonl"]);
  } finally {
    if (priorEnvironment === undefined) {
      delete process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH;
    } else {
      process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH = priorEnvironment;
    }
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("dumpTimeframe refuses degraded coverage without replacing the prior artifact", async () => {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-observation-dump-"),
  );
  const finalPath = path.join(outputDir, "observations-5m.jsonl");
  writeFileSync(finalPath, "known-good\n");
  try {
    await assert.rejects(
      dumpTimeframe(options(outputDir), "5m", async () => {
        writeServiceDump(process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH!);
        return response({ coverageDegraded: true });
      }),
      /coverage degraded/i,
    );
    assert.equal(readFileSync(finalPath, "utf8"), "known-good\n");
    assert.deepEqual(readdirSync(outputDir), ["observations-5m.jsonl"]);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("dumpTimeframe refuses a fallback timeframe without publishing a mislabeled artifact", async () => {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-observation-dump-"),
  );
  try {
    await assert.rejects(
      dumpTimeframe(options(outputDir), "5m", async () => {
        writeServiceDump(
          process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH!,
          "15m",
        );
        return response({ resolvedTimeframe: "15m" });
      }),
      /resolved timeframe.*15m.*requested 5m/i,
    );
    assert.deepEqual(readdirSync(outputDir), []);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("dumpTimeframe atomically publishes versioned provenance after validation", async () => {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-observation-dump-"),
  );
  const finalPath = path.join(outputDir, "observations-5m.jsonl");
  writeFileSync(finalPath, "known-good\n");
  try {
    const result = await dumpTimeframe(options(outputDir), "5m", async () => {
      writeServiceDump(process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH!);
      return response();
    });
    const lines = readFileSync(finalPath, "utf8").trim().split("\n");
    const header = JSON.parse(lines[0]);
    assert.equal(result.lineCount, 2);
    assert.equal(header.schemaVersion, 2);
    assert.equal(typeof header.runId, "string");
    assert.equal(header.deploymentId, "deployment-1");
    assert.equal(header.asOfDay, "2026-07-13");
    assert.equal(header.requestedTimeframe, "5m");
    assert.equal(header.resolvedTimeframe, "5m");
    assert.equal(header.coverage.evaluatedSymbolCount, 100);
    assert.equal(header.calibrationCoverage.supported, true);
    assert.equal(header.settings.outcomeHorizonBars, 26);
    assert.equal(header.mtf.requiredCount, 3);
    assert.deepEqual(JSON.parse(lines[1]), row);
    assert.equal(statSync(finalPath).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(outputDir), ["observations-5m.jsonl"]);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("dumpTimeframe refuses service/header horizon drift", async () => {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-observation-dump-"),
  );
  const finalPath = path.join(outputDir, "observations-5m.jsonl");
  writeFileSync(finalPath, "known-good\n");
  try {
    await assert.rejects(
      dumpTimeframe(options(outputDir), "5m", async () => {
        writeServiceDump(process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH!);
        return response({ outcomeHorizonBars: 52 });
      }),
      /dump horizon 26.*settings horizon 52/i,
    );
    assert.equal(readFileSync(finalPath, "utf8"), "known-good\n");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("dumpTimeframe refuses observations without exact outcome-end provenance", async () => {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-observation-dump-"),
  );
  const finalPath = path.join(outputDir, "observations-5m.jsonl");
  writeFileSync(finalPath, "known-good\n");
  try {
    await assert.rejects(
      dumpTimeframe(options(outputDir), "5m", async () => {
        const incompleteRow = {
          ...row,
          audit: { signalAt: row.audit.signalAt },
        };
        writeFileSync(
          process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH!,
          `${JSON.stringify({
            header: true,
            resolvedTimeframe: "5m",
            outcomeHorizonBars: 26,
            count: 1,
          })}\n${JSON.stringify(incompleteRow)}\n`,
        );
        return response();
      }),
      /audit\.outcomeExitBarAt/i,
    );
    assert.equal(readFileSync(finalPath, "utf8"), "known-good\n");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("dumpTimeframe refuses observations without exact MTF gate provenance", async () => {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), "pyrus-observation-dump-"),
  );
  const finalPath = path.join(outputDir, "observations-5m.jsonl");
  writeFileSync(finalPath, "known-good\n");
  try {
    await assert.rejects(
      dumpTimeframe(options(outputDir), "5m", async () => {
        const incompleteRow = {
          ...row,
          audit: {
            signalAt: row.audit.signalAt,
            outcomeExitBarAt: row.audit.outcomeExitBarAt,
          },
        };
        writeFileSync(
          process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH!,
          `${JSON.stringify({
            header: true,
            resolvedTimeframe: "5m",
            outcomeHorizonBars: 26,
            count: 1,
          })}\n${JSON.stringify(incompleteRow)}\n`,
        );
        return response();
      }),
      /MTF.*provenance/i,
    );
    assert.equal(readFileSync(finalPath, "utf8"), "known-good\n");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("observation dump CLI rejects unknown and duplicate flags", () => {
  assert.deepEqual(parseOptions(["--", "--timeframes", "5m"]).timeframes, [
    "5m",
  ]);
  assert.throws(
    () => parseOptions(["--wat", "value"]),
    /Unknown argument.*--wat/,
  );
  assert.throws(
    () => parseOptions(["--timeframes", "5m", "--timeframes", "15m"]),
    /Duplicate argument.*--timeframes/,
  );
  assert.throws(
    () => parseOptions(["--timeframes", "1m"]),
    /Invalid timeframe "1m"/,
  );
});
