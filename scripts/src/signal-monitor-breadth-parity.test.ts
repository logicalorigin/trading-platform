import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import * as parityModule from "./signal-monitor-breadth-parity";

type ParityInternals = {
  errorMessage: (error: unknown) => string;
  readConfig: (argv: string[]) => {
    environment: "shadow" | "live";
    ranges: string[];
    now: Date | null;
    mismatchLimit: number;
    json: boolean;
    help: boolean;
  };
  renderTextReport: (report: Record<string, unknown>) => string;
  serializeJson: (value: unknown) => string;
};

const parity = (
  parityModule as typeof parityModule & {
    __signalMonitorBreadthParityInternalsForTests?: ParityInternals;
  }
).__signalMonitorBreadthParityInternalsForTests;

const ISOLATED_DATABASE_ENV = {
  DATABASE_URL:
    "postgresql://breadth-parity-test:unused@127.0.0.1:1/breadth-parity-test?connect_timeout=1",
  LOCAL_DATABASE_URL: "",
  PGDATABASE: "",
  PGHOST: "",
  PGPASSWORD: "",
  PGPORT: "",
  PGUSER: "",
  PYRUS_DATABASE_SOURCE: "database_url",
};

const scriptPath = resolve(
  import.meta.dirname,
  "signal-monitor-breadth-parity.ts",
);

const runCli = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, ...ISOLATED_DATABASE_ENV },
    timeout: 30_000,
  });

test("importing the breadth parity command performs no database work", () => {
  const moduleUrl = pathToFileURL(scriptPath).href;
  const imported = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(moduleUrl)})`,
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, ...ISOLATED_DATABASE_ENV },
      timeout: 30_000,
    },
  );

  assert.equal(
    imported.status,
    0,
    `import unexpectedly ran the diagnostic:\n${imported.stdout}${imported.stderr}`,
  );
});

test("invalid CLI scope fails before database work without a raw stack", () => {
  const result = runCli(["--unknown=true"]);

  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /Usage:/u);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|127\.0\.0\.1|\n\s+at /u);

  const help = runCli(["--help"]);
  assert.equal(help.status, 0, `${help.stdout}${help.stderr}`);
  assert.match(help.stdout, /Read-only diagnostic/u);
  assert.doesNotMatch(help.stderr, /ECONNREFUSED|127\.0\.0\.1|\n\s+at /u);
});

test("CLI parsing is strict canonical and bounded", () => {
  assert.ok(parity, "breadth parity test internals are unavailable");
  const defaults = parity.readConfig([]);
  assert.deepEqual(defaults, {
    environment: "shadow",
    ranges: ["hour", "day", "week", "month"],
    now: null,
    mismatchLimit: 50,
    json: false,
    help: false,
  });
  const explicit = parity.readConfig([
    "--environment=live",
    "--ranges=hour,week",
    "--now=2026-06-26T16:00:00.000Z",
    "--mismatch-limit=0",
    "--json",
  ]);
  assert.equal(explicit.environment, "live");
  assert.deepEqual(explicit.ranges, ["hour", "week"]);
  assert.equal(explicit.now?.toISOString(), "2026-06-26T16:00:00.000Z");
  assert.equal(explicit.mismatchLimit, 0);
  assert.equal(explicit.json, true);
  assert.equal(parity.readConfig(["--help"]).help, true);
  assert.equal(parity.readConfig(["-h"]).help, true);

  for (const args of [
    ["--unknown=true"],
    ["--environment="],
    ["--environment=shadow", "--environment=live"],
    ["--ranges=hour,,day"],
    ["--ranges=hour,hour"],
    ["--now=2026-06-26"],
    ["--mismatch-limit=1.5"],
    ["--mismatch-limit=01"],
    ["--mismatch-limit=10001"],
    ["--json=false"],
    ["positional"],
  ]) {
    assert.throws(() => parity.readConfig(args), /Usage:/u);
  }
});

test("operator errors are bounded credential-redacted and terminal-safe", () => {
  assert.ok(parity, "breadth parity test internals are unavailable");
  const diagnostic = parity.errorMessage(
    new Error(
      `postgresql://operator:super-secret@db.example/pyrus?token=query-secret \u001b[31mline\nnext\u202e${"x".repeat(700)}`,
    ),
  );

  assert.match(diagnostic, /postgresql:\/\/\[redacted\]@db\.example\/pyrus/u);
  assert.doesNotMatch(diagnostic, /super-secret|query-secret/u);
  assert.doesNotMatch(
    diagnostic,
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.ok(diagnostic.length <= 500);
});

test("human output includes event-anchor coverage and contains hostile fields", () => {
  assert.ok(parity, "breadth parity test internals are unavailable");
  const hostileTimeframe = "5m\u001b[31m\nInjected\u202e";
  const report = {
    environment: "shadow",
    generatedAt: "2026-06-26T16:00:00.000Z",
    ranges: [
      {
        range: "hour",
        from: "2026-06-26T15:00:00.000Z",
        to: "2026-06-26T16:00:00.000Z",
        bucketMinutes: 2,
        snapshotRows: 2,
        seedRows: 1,
        eventRows: 1,
        snapshotsCoverWindow: true,
        counts: { comparedPoints: 1, mismatches: 1 },
      },
    ],
    counts: {
      ranges: 1,
      comparedPoints: 1,
      missingSnapshotPoints: 0,
      missingEventPoints: 0,
      mismatches: 1,
    },
    eventAnchorCoverage: {
      activeCells: 2,
      cellsWithEvent: 1,
      cellsMissingEvent: 1,
      cellsDirectionMismatch: 1,
    },
    mismatchSummary: {
      byRange: { hour: 1 },
      byTimeframe: { [hostileTimeframe]: 1 },
      byField: { buy: 1 },
      byReason: { value_mismatch: 1 },
    },
    mismatches: [
      {
        range: "hour",
        timeframe: hostileTimeframe,
        at: "2026-06-26T15:00:00.000Z",
        field: "buy",
        reason: "value_mismatch",
        snapshot: null,
        event: 2,
      },
    ],
  };
  const rendered = parity.renderTextReport(report);

  assert.match(
    rendered,
    /Event anchors: active=2, with-event=1, missing=1, direction-mismatch=1/u,
  );
  assert.match(
    rendered,
    /from=2026-06-26T15:00:00.000Z, to=2026-06-26T16:00:00.000Z, bucket-minutes=2/u,
  );
  assert.match(rendered, /Sample mismatches \(showing 1 of 1\):/u);
  assert.doesNotMatch(
    rendered,
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.doesNotMatch(rendered, /\nInjected/u);
  assert.match(rendered, /snapshot=null event=2/u);

  const serialized = parity.serializeJson(report);
  assert.doesNotMatch(
    serialized,
    /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.match(serialized, /\\u202e/iu);
  assert.deepEqual(JSON.parse(serialized), report);
});
