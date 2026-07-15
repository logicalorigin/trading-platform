import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import * as sweep from "./pyrus-signals-options-sweep";

type SweepInternals = {
  assertReportDestinationAvailable(reportDir: string): Promise<void>;
  assertSweepCompletion(input: {
    results: sweep.SweepResult[];
    replayRequired?: boolean;
    replayResult?: sweep.SweepResult | null;
    verification?: Record<string, unknown> | null;
  }): void;
  buildVariantBackfillInput(input: {
    deployment: {
      id: string;
      name: string;
      mode: "shadow" | "live";
      symbolUniverse: string[];
    };
    variant: sweep.SweepVariant;
    config: {
      start: string;
      end?: string;
      session: string;
      signalTimeframe: string;
      smoke: boolean;
      replayWinner: boolean;
      lockWaitMs: number;
      reportDir: string;
      mtfSweep: boolean;
    };
    commit: boolean;
    replay: boolean;
  }): Record<string, unknown>;
  csvValue(value: unknown): string;
  enableHistoricalBarEvaluation(env: NodeJS.ProcessEnv): void;
  jsonText(value: unknown, space?: number): string;
  markdownJson(value: unknown): string;
  markdownText(value: unknown): string;
  parseSweepArgs(args: string[]): void;
  publishReportFiles(
    reportDir: string,
    files: Record<"results.json" | "results.csv" | "report.md", string>,
  ): Promise<void>;
  readSweepConfig(
    env: NodeJS.ProcessEnv,
    cwd: string,
  ): {
    start: string;
    session: string;
    signalTimeframe: string;
    replayWinner: boolean;
    reportDir: string;
  };
  replayLedgerMode(env: NodeJS.ProcessEnv): "own" | "shadow_orders";
  resolveSweepEligibility(
    variant: sweep.SweepVariant,
    closedTrades: number,
  ): { eligible: boolean; ineligibleReason: string | null };
  selectSweepSymbolUniverse(
    fullUniverse: readonly unknown[],
    env: NodeJS.ProcessEnv,
  ): string[];
  validateSweepDeployment(input: {
    id: string;
    name: string;
    mode: "shadow" | "live";
    symbolUniverse: unknown[];
  }): void;
  replayReportLine(result?: sweep.SweepResult | null): string;
  safeDiagnostic(error: unknown): string;
  verifyReplayLedger(input: {
    deploymentId: string;
    window: Record<string, unknown> | null;
    ledgerMode: "own" | "shadow_orders";
    serviceCompleted: boolean;
    runtime: {
      pool: {
        query(
          sql: string,
          values: unknown[],
        ): Promise<{ rows: Record<string, unknown>[] }>;
      };
    };
  }): Promise<Record<string, unknown>>;
};

const internals = (
  sweep as typeof sweep & {
    __pyrusSignalsOptionsSweepInternalsForTests?: SweepInternals;
  }
).__pyrusSignalsOptionsSweepInternalsForTests;
const scriptSource = readFileSync(
  path.join(import.meta.dirname, "pyrus-signals-options-sweep.ts"),
  "utf8",
);

function requireInternals(): SweepInternals {
  assert.ok(internals, "expected focused test internals");
  return internals;
}

function variant(id: string): sweep.SweepVariant {
  return {
    id,
    stage: "A",
    pyrusSignalsSettingsPatch: { timeHorizon: 10 },
  };
}

function result(
  id: string,
  metrics: Partial<sweep.SweepResult["metrics"]>,
  status: sweep.SweepResult["status"] = "succeeded",
): sweep.SweepResult {
  return {
    variant: variant(id),
    status,
    eligible: true,
    ineligibleReason: null,
    startedAt: "2026-05-01T00:00:00.000Z",
    finishedAt: "2026-05-01T00:00:01.000Z",
    durationMs: 1_000,
    window: null,
    timeframe: "5m",
    metrics: {
      realizedPnl: 0,
      winRate: 0,
      profitFactor: 0,
      closedTrades: 25,
      maxDrawdownAbs: 500,
      openPositions: 0,
      riskAdjustedScore: 0,
      ...metrics,
    },
    summary: null,
    error: null,
  };
}

test("sweep grids and ranking preserve the established research contract", () => {
  assert.equal(sweep.buildStageAVariants().length, 7);
  assert.equal(sweep.buildStageBVariants([4, 10]).length, 48);
  assert.equal(sweep.buildMtfEntryGateVariants().length, 13);

  const ranked = sweep.rankSweepResults([
    result("failed", { riskAdjustedScore: 100 }, "failed"),
    result("too-few", { riskAdjustedScore: 100, closedTrades: 19 }),
    result("winner", { riskAdjustedScore: 2, realizedPnl: 900 }),
    result("runner-up", { riskAdjustedScore: 1, realizedPnl: 1_200 }),
  ]);
  assert.deepEqual(
    ranked.map((item) => item.variant.id),
    ["winner", "runner-up"],
  );
});

test("metrics retain realized drawdown, profit factor, and open-position semantics", () => {
  const closedTrades = [
    { closedAt: "2026-05-01T15:00:00.000Z", pnl: 1_000 },
    { closedAt: "2026-05-02T15:00:00.000Z", pnl: -600 },
    { closedAt: "2026-05-03T15:00:00.000Z", pnl: 100 },
  ];
  const metrics = sweep.computeSweepMetrics({
    summary: {
      realizedPnl: 500,
      winningTrades: 2,
      losingTrades: 1,
      closedTrades,
    },
    openPositions: [{ id: "open-1" }],
  });

  assert.equal(sweep.computeMaxRealizedDrawdown(closedTrades), 600);
  assert.equal(metrics.realizedPnl, 500);
  assert.equal(metrics.closedTrades, 3);
  assert.equal(metrics.openPositions, 1);
  assert.equal(Number(metrics.profitFactor.toFixed(3)), 1.833);
  assert.equal(metrics.riskAdjustedScore, 0.833333);
});

test("malformed trade fields never become rankable financial evidence", () => {
  const metrics = sweep.computeSweepMetrics({
    summary: {
      realizedPnl: 9_999,
      winningTrades: 99,
      losingTrades: 0,
      closedTrades: [
        { closedAt: "2026-05-01T15:00:00.000Z", pnl: null },
        { closedAt: "2026-05-01T15:00:00.000Z", pnl: "100" },
        { closedAt: "2026-05-01T15:00:00.000Z", pnl: true },
        { closedAt: "not-a-date", pnl: 500 },
        { closedAt: "May 1, 2026", pnl: 1_000 },
        { closedAt: "2026-02-30T15:00:00.000Z", pnl: 500 },
        { closedAt: "2026-05-02T15:00:00.000Z", pnl: 25 },
      ],
    },
  });

  assert.equal(metrics.realizedPnl, 25);
  assert.equal(metrics.closedTrades, 1);
  assert.equal(metrics.winRate, 1);
  assert.throws(
    () =>
      sweep.computeSweepMetrics({
        summary: {
          closedTrades: [
            { closedAt: "2026-05-01T15:00:00.000Z", pnl: Number.MAX_VALUE },
            { closedAt: "2026-05-02T15:00:00.000Z", pnl: Number.MAX_VALUE },
          ],
        },
      }),
    /finite aggregate/,
  );
});

test("operator-selected symbols are normalized, intersected, and never widened", () => {
  const api = requireInternals();

  assert.deepEqual(
    api.selectSweepSymbolUniverse(["SPY", "NVDA"], {
      PYRUS_SIGNALS_SWEEP_SYMBOLS: " spy, TSLA ",
    }),
    ["SPY"],
  );
  assert.deepEqual(
    api.selectSweepSymbolUniverse(["SPY", "NVDA"], {
      PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT: "1",
    }),
    ["SPY"],
  );
  assert.throws(
    () =>
      api.selectSweepSymbolUniverse(["SPY", "NVDA"], {
        PYRUS_SIGNALS_SWEEP_SYMBOLS: "TSLA",
      }),
    /does not match the deployment universe/,
  );
  assert.throws(
    () =>
      api.selectSweepSymbolUniverse(["SPY", "NVDA"], {
        PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT: "many",
      }),
    /PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT.*non-negative integer/,
  );
  assert.throws(
    () =>
      api.selectSweepSymbolUniverse(["SPY", "NVDA"], {
        PYRUS_SIGNALS_SWEEP_SYMBOLS: "SPY",
        PYRUS_SIGNALS_SWEEP_SYMBOL_LIMIT: "1",
      }),
    /SYMBOLS.*SYMBOL_LIMIT/,
  );
});

test("the selected deployment universe is forwarded to the backfill service", () => {
  const api = requireInternals();
  const backfill = api.buildVariantBackfillInput({
    deployment: {
      id: "deployment-id",
      name: "Pyrus Signals Options Shadow",
      mode: "shadow",
      symbolUniverse: ["SPY", "NVDA"],
    },
    variant: variant("stage-a-h10"),
    config: {
      start: "2026-06-01",
      session: "regular",
      signalTimeframe: "5m",
      smoke: true,
      replayWinner: false,
      lockWaitMs: 0,
      reportDir: "/tmp/options-sweep-test",
      mtfSweep: false,
    },
    commit: false,
    replay: false,
  });

  assert.deepEqual(backfill.symbolUniverseOverride, ["SPY", "NVDA"]);
  assert.equal(backfill.forceDeploymentUniverse, true);
  assert.equal(backfill.useBarDerivedMtf, true);
});

test("invalid operator booleans fail instead of enabling fallback behavior", () => {
  const api = requireInternals();
  assert.throws(
    () =>
      api.readSweepConfig(
        { PYRUS_SIGNALS_SWEEP_REPLAY_WINNER: "flase" },
        "/tmp/options-sweep-test",
      ),
    /PYRUS_SIGNALS_SWEEP_REPLAY_WINNER.*true.*false/,
  );
  assert.throws(
    () =>
      api.readSweepConfig(
        {
          PYRUS_SIGNALS_SWEEP_REPLAY_WINNER: "false",
          SIGNAL_OPTIONS_SWEEP_REPLAY_WINNER: "true",
        },
        "/tmp/options-sweep-test",
      ),
    /conflicting.*REPLAY_WINNER/i,
  );
  assert.throws(
    () =>
      api.readSweepConfig(
        {
          PYRUS_SIGNALS_SWEEP_START: "2026-06-01",
          SIGNAL_OPTIONS_SWEEP_START: "2026-06-02",
        },
        "/tmp/options-sweep-test",
      ),
    /conflicting.*SWEEP_START/i,
  );
});

test("unknown positional and option arguments fail before runtime work", () => {
  const api = requireInternals();
  assert.doesNotThrow(() => api.parseSweepArgs([]));
  assert.doesNotThrow(() => api.parseSweepArgs(["--"]));
  assert.throws(() => api.parseSweepArgs(["--unknown"]), /Usage:/);
  assert.throws(() => api.parseSweepArgs(["unexpected"]), /Usage:/);
});

test("the executable rejects unknown arguments without database configuration", () => {
  const env = { ...process.env };
  for (const name of [
    "DATABASE_URL",
    "LOCAL_DATABASE_URL",
    "PGHOST",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGPORT",
    "PGSSLMODE",
    "PYRUS_DATABASE_SOURCE",
  ]) {
    delete env[name];
  }
  const command = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      path.join(import.meta.dirname, "pyrus-signals-options-sweep.ts"),
      "--unknown",
    ],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env,
      timeout: 10_000,
    },
  );
  assert.equal(command.status, 1, command.stderr || command.stdout);
  assert.match(command.stderr, /Usage:/u);
  assert.doesNotMatch(command.stderr, /Database connection env/u);
});

test("the historical sweep opts into bar evaluation without overriding an explicit veto", () => {
  const api = requireInternals();
  const defaultEnv: NodeJS.ProcessEnv = {};
  api.enableHistoricalBarEvaluation(defaultEnv);
  assert.equal(defaultEnv.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED, "1");

  const vetoed: NodeJS.ProcessEnv = {
    SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "false",
  };
  api.enableHistoricalBarEvaluation(vetoed);
  assert.equal(vetoed.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED, "0");
  assert.equal(vetoed.SIGNAL_MONITOR_BAR_EVALUATION_ENABLED, "false");

  const normalized: NodeJS.ProcessEnv = {
    PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "yes",
  };
  api.enableHistoricalBarEvaluation(normalized);
  assert.equal(normalized.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED, "1");

  assert.throws(
    () =>
      api.enableHistoricalBarEvaluation({
        PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "false",
        SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "true",
      }),
    /conflicting.*BAR_EVALUATION_ENABLED/i,
  );
});

test("blank env values use documented fallbacks and legacy aliases", () => {
  const api = requireInternals();
  const config = api.readSweepConfig(
    {
      PYRUS_SIGNALS_SWEEP_START: " ",
      SIGNAL_OPTIONS_SWEEP_START: "2026-06-01",
      PYRUS_SIGNALS_SWEEP_REPORT_DIR: " ",
      PYRUS_SIGNALS_SWEEP_REPLAY_WINNER: "false",
    },
    "/tmp/options-sweep-test",
  );

  assert.equal(config.start, "2026-06-01");
  assert.equal(config.replayWinner, false);
  assert.match(
    config.reportDir,
    /^\/tmp\/options-sweep-test\/reports\/pyrus-signals-options-sweeps\//,
  );
});

test("unsupported session and signal-timeframe values fail closed", () => {
  const api = requireInternals();
  assert.throws(
    () =>
      api.readSweepConfig(
        { PYRUS_SIGNALS_SWEEP_SESSION: "premarket" },
        "/tmp/options-sweep-test",
      ),
    /PYRUS_SIGNALS_SWEEP_SESSION/,
  );
  assert.throws(
    () =>
      api.readSweepConfig(
        { PYRUS_SIGNALS_SWEEP_SIGNAL_TIMEFRAME: "10m" },
        "/tmp/options-sweep-test",
      ),
    /PYRUS_SIGNALS_SWEEP_SIGNAL_TIMEFRAME/,
  );
});

test("dates are canonical and ordered, and lock waits are bounded before DB work", () => {
  const api = requireInternals();
  for (const start of ["2026-02-30", "06/01/2026", "2026-6-1"]) {
    assert.throws(
      () =>
        api.readSweepConfig(
          { PYRUS_SIGNALS_SWEEP_START: start },
          "/tmp/options-sweep-test",
        ),
      /PYRUS_SIGNALS_SWEEP_START.*YYYY-MM-DD/,
    );
  }
  assert.throws(
    () =>
      api.readSweepConfig(
        {
          PYRUS_SIGNALS_SWEEP_START: "2026-06-02",
          PYRUS_SIGNALS_SWEEP_END: "2026-06-01",
        },
        "/tmp/options-sweep-test",
      ),
    /start must be on or before end/,
  );
  assert.throws(
    () =>
      api.readSweepConfig(
        { PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS: "1800001" },
        "/tmp/options-sweep-test",
      ),
    /PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS.*1800000/,
  );
  for (const lockWait of ["1e3", "0x10", "+1", "01", "1.0"]) {
    assert.throws(
      () =>
        api.readSweepConfig(
          { PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS: lockWait },
          "/tmp/options-sweep-test",
        ),
      /PYRUS_SIGNALS_SWEEP_LOCK_WAIT_MS.*non-negative integer/,
    );
  }
});

test("winner-excluded diagnostics are reported as ineligible", () => {
  const api = requireInternals();
  const diagnostic = sweep
    .buildMtfEntryGateVariants()
    .find((item) => item.id === "diagnostic-no-mtf");
  assert.ok(diagnostic);

  assert.deepEqual(api.resolveSweepEligibility(diagnostic, 25), {
    eligible: false,
    ineligibleReason: "variant excluded from winner selection",
  });
});

test("CSV output neutralizes formulas and quotes every row separator", () => {
  const api = requireInternals();
  assert.equal(
    api.csvValue('=HYPERLINK("https://example.test")'),
    '"\'=HYPERLINK(""https://example.test"")"',
  );
  assert.equal(api.csvValue("first\rsecond"), '"first\rsecond"');
});

test("reported errors and Markdown fields are bounded and structure-safe", () => {
  const api = requireInternals();
  const diagnostic = api.safeDiagnostic(
    new Error(
      `postgres://operator:super-secret@db.internal/sweep https://api.test/run?token=query-secret#fragment \u001b[31m\n\u2028\u202e${"x".repeat(800)}`,
    ),
  );
  assert.match(diagnostic, /postgres:\/\/\[redacted\]@db\.internal\/sweep/);
  assert.doesNotMatch(
    diagnostic,
    /super-secret|query-secret|fragment|\u001b|\n|\u2028|\u202e/u,
  );
  assert.ok(diagnostic.length <= 400);

  const markdown = api.markdownText(
    "name\n# forged\u2028second | <img> [click](https://bad.test)",
  );
  assert.doesNotMatch(markdown, /\n|\u2028|<img>|^# forged/mu);
  assert.match(markdown, /\\\||&lt;img&gt;|\\\[click\\\]/);
  assert.doesNotMatch(
    api.markdownJson({ runId: "```\n# forged" }),
    /```\n# forged/,
  );
  const json = api.jsonText(
    { profitFactor: Infinity, runId: "before\u2028middle\u202eafter" },
    2,
  );
  assert.equal(JSON.parse(json).profitFactor, "Infinity");
  assert.doesNotMatch(json, /"profitFactor": null/);
  assert.doesNotMatch(json, /[\u2028\u202e]/u);
  assert.match(json, /\\u2028.*\\u202e/u);
});

test("report files publish as one directory and never overwrite a completed run", async () => {
  const api = requireInternals();
  const root = await mkdtemp(path.join(tmpdir(), "pyrus-options-sweep-"));
  const reportDir = path.join(root, "report");
  const original = {
    "results.json": "original json\n",
    "results.csv": "original csv\n",
    "report.md": "original markdown\n",
  };
  try {
    await assert.doesNotReject(api.assertReportDestinationAvailable(reportDir));
    await api.publishReportFiles(reportDir, original);
    await assert.rejects(
      api.assertReportDestinationAvailable(reportDir),
      /Report destination already exists/,
    );
    assert.deepEqual((await readdir(reportDir)).sort(), [
      "report.md",
      "results.csv",
      "results.json",
    ]);
    assert.equal(
      await readFile(path.join(reportDir, "results.json"), "utf8"),
      original["results.json"],
    );

    await assert.rejects(
      api.publishReportFiles(reportDir, {
        "results.json": "replacement json\n",
        "results.csv": "replacement csv\n",
        "report.md": "replacement markdown\n",
      }),
    );
    assert.equal(
      await readFile(path.join(reportDir, "results.json"), "utf8"),
      original["results.json"],
    );
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".tmp-")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the long-running worker lock uses the repo's dedicated connection holder", () => {
  assert.match(scriptSource, /sharedAdvisoryLockHolder\.acquire/);
  assert.doesNotMatch(scriptSource, /pool\.connect\(/);
  assert.match(scriptSource, /closeDatabaseConnections\(\)/);
});

test("live-mode deployment rows fail before any sweep can run", () => {
  const api = requireInternals();
  assert.throws(
    () =>
      api.validateSweepDeployment({
        id: "live-deployment",
        name: "Misconfigured deployment",
        mode: "live",
        symbolUniverse: ["SPY"],
      }),
    /must be shadow/,
  );
});

test("completion fails closed for total run failure and defective replay proof", () => {
  const api = requireInternals();
  const failed = result("failed", {}, "failed");
  const succeeded = result("succeeded", {});

  assert.throws(
    () => api.assertSweepCompletion({ results: [failed] }),
    /Every sweep variant failed/,
  );
  assert.throws(
    () =>
      api.assertSweepCompletion({
        results: [succeeded],
        replayRequired: true,
        replayResult: null,
      }),
    /requested but no eligible winner/,
  );
  assert.throws(
    () =>
      api.assertSweepCompletion({
        results: [succeeded],
        replayResult: failed,
        verification: { skipped: true },
      }),
    /Winner replay failed/,
  );
  assert.throws(
    () =>
      api.assertSweepCompletion({
        results: [succeeded],
        replayResult: succeeded,
        verification: {
          ledgerMode: "shadow_orders",
          orderCount: 4,
          ordersWithNullSourceEventId: 0,
          ordersWithNullSourceMetadata: 1,
          ordersWithoutFills: 0,
          runIdCount: 1,
        },
      }),
    /Replay ledger verification failed/,
  );
  assert.throws(
    () =>
      api.assertSweepCompletion({
        results: [succeeded],
        replayResult: { ...succeeded, eligible: false },
        verification: { ledgerMode: "own", serviceCompletion: true },
      }),
    /no longer eligible/,
  );
  assert.throws(
    () =>
      api.assertSweepCompletion({
        results: [succeeded],
        replayResult: result("replay-too-small", { closedTrades: 19 }),
        verification: { ledgerMode: "own", serviceCompletion: true },
      }),
    /no longer eligible/,
  );
  assert.throws(
    () =>
      api.assertSweepCompletion({
        results: [succeeded],
        replayResult: succeeded,
        verification: { ledgerMode: "own" },
      }),
    /Replay ledger verification failed/,
  );
  assert.doesNotThrow(() =>
    api.assertSweepCompletion({
      results: [succeeded],
      replayResult: succeeded,
      verification: { ledgerMode: "own", serviceCompletion: true },
    }),
  );
  assert.doesNotThrow(() =>
    api.assertSweepCompletion({
      results: [succeeded],
      replayResult: succeeded,
      verification: {
        ledgerMode: "shadow_orders",
        orderCount: 4,
        ordersWithNullSourceEventId: 0,
        ordersWithNullSourceMetadata: 0,
        ordersWithoutFills: 0,
        runIdCount: 1,
      },
    }),
  );
});

test("replay verification cannot bypass the configured ledger proof", async () => {
  const api = requireInternals();
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const runtime = {
    pool: {
      async query(sql: string, values: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              orderCount: 4,
              ordersWithNullSourceEventId: 0,
              ordersWithNullSourceMetadata: 0,
              ordersWithoutFills: 0,
              runIdCount: 1,
              runIds: ["run-1"],
            },
          ],
        };
      },
    },
  };
  const base = {
    deploymentId: "deployment-id",
    window: {
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-02T00:00:00.000Z",
    },
    runtime,
  };

  assert.equal(api.replayLedgerMode({ PYRUS_BACKTEST_LEDGER: "own" }), "own");
  assert.equal(api.replayLedgerMode({}), "shadow_orders");

  assert.deepEqual(
    await api.verifyReplayLedger({
      ...base,
      ledgerMode: "own",
      serviceCompleted: true,
    }),
    {
      ledgerMode: "own",
      serviceCompletion: true,
      reason: "Committed replay completed through the own-backtest-ledger service path.",
    },
  );
  assert.equal(queries.length, 0);

  assert.deepEqual(
    await api.verifyReplayLedger({
      ...base,
      ledgerMode: "shadow_orders",
      serviceCompleted: true,
    }),
    {
      ledgerMode: "shadow_orders",
      orderCount: 4,
      ordersWithNullSourceEventId: 0,
      ordersWithNullSourceMetadata: 0,
      ordersWithoutFills: 0,
      runIdCount: 1,
      runIds: ["run-1"],
    },
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? "", /from shadow_orders/u);
  assert.deepEqual(queries[0]?.values, [
    "deployment-id",
    "2026-05-01T00:00:00.000Z",
    "2026-05-02T00:00:00.000Z",
  ]);

  assert.deepEqual(
    await api.verifyReplayLedger({
      ...base,
      ledgerMode: "shadow_orders",
      serviceCompleted: false,
    }),
    {
      ledgerMode: "shadow_orders",
      serviceCompletion: false,
      skipped: true,
      reason: "replay service did not complete successfully",
    },
  );
  assert.equal(queries.length, 1);
});

test("Stage A insufficiency publishes its partial report before failing", () => {
  const guard = scriptSource.indexOf("if (topHorizons.length < 2)");
  const report = scriptSource.indexOf("await writeReports(", guard);
  const failure = scriptSource.indexOf(
    "Fewer than two eligible Stage A horizons",
    guard,
  );
  assert.ok(guard >= 0 && report > guard && failure > guard);
  assert.ok(
    report < failure,
    "partial report must be published before failure",
  );
});

test("failed replays are never labeled committed in the report", () => {
  const api = requireInternals();
  assert.equal(api.replayReportLine(null), "Replay committed: no");
  assert.match(
    api.replayReportLine(result("failed", {}, "failed")),
    /^Replay failed:/,
  );
  assert.match(
    api.replayReportLine(result("winner", {})),
    /^Replay committed: winner$/,
  );
  assert.match(
    api.replayReportLine({ ...result("winner", {}), eligible: false }),
    /^Replay completed but is no longer eligible:/,
  );
});
