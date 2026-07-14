import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import type {
  SignalOptionsGreekSelectorSmokeCandidate,
  SignalOptionsGreekSelectorSmokeResult,
} from "../../artifacts/api-server/src/services/signal-options-automation";
import type { HistoricalGreeksLookupResult } from "./gex-historical-greeks";
import * as smokeModule from "./signal-options-greek-selector-smoke";

type Config = {
  date: string;
  session: "regular" | "all";
  signalTimeframe: "1m" | "2m" | "5m" | "15m" | "1h" | "1d";
  reportDir: string;
  maxSignals: number | null;
  maxCandidatesPerSignal: number;
  riskFreeRate: number;
  dividendYield: number;
  symbols: string[];
  gexToleranceMs: number;
  lockWaitMs: number;
  progress: boolean;
  help: boolean;
};

type DeploymentRow = {
  id: string;
  name: string;
  mode: "shadow";
  enabled: true;
  providerAccountId: "shadow";
  config: unknown;
  symbolUniverse: string[];
};

type SmokeInternals = {
  applyGexHistoricalGreeks: (
    result: SignalOptionsGreekSelectorSmokeResult,
    config: Pick<Config, "gexToleranceMs" | "progress">,
    lookup?: (input: {
      strike: number;
    }) => Promise<HistoricalGreeksLookupResult>,
  ) => Promise<void>;
  assertReportDestinationAvailable: (reportDir: string) => Promise<void>;
  enableHistoricalBarEvaluation: (env?: NodeJS.ProcessEnv) => void;
  executeSmoke: (
    config: Config,
    dependencies: {
      acquireLock: (waitMs: number) => Promise<(() => Promise<void>) | null>;
      readDeployment: () => Promise<DeploymentRow>;
      runSmoke: (
        input: Record<string, unknown>,
      ) => Promise<SignalOptionsGreekSelectorSmokeResult>;
      applyGex: (
        result: SignalOptionsGreekSelectorSmokeResult,
        config: Pick<Config, "gexToleranceMs" | "progress">,
      ) => Promise<void>;
      writeReport: (
        result: SignalOptionsGreekSelectorSmokeResult,
        reportDir: string,
      ) => Promise<string>;
      log: (message: string) => void;
    },
  ) => Promise<string>;
  readConfig: (
    args?: string[],
    env?: NodeJS.ProcessEnv,
    cwd?: string,
  ) => Config;
  safeDiagnostic: (error: unknown) => string;
  selectSymbolUniverse: (
    deploymentSymbols: readonly string[],
    requestedSymbols: readonly string[],
  ) => string[];
  validateDeployment: (value: unknown) => DeploymentRow;
  writeReport: (
    result: SignalOptionsGreekSelectorSmokeResult,
    reportDir: string,
  ) => Promise<string>;
};

const smoke = (
  smokeModule as typeof smokeModule & {
    __signalOptionsGreekSelectorSmokeInternalsForTests?: SmokeInternals;
  }
).__signalOptionsGreekSelectorSmokeInternalsForTests;

const scriptPath = resolve(
  import.meta.dirname,
  "signal-options-greek-selector-smoke.ts",
);
const scriptsRoot = resolve(import.meta.dirname, "..");
const DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const SCRIPT_ENV_NAMES = [
  "PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED",
  "SIGNAL_MONITOR_BAR_EVALUATION_ENABLED",
  "SIGNAL_OPTIONS_GREEK_SMOKE_DATE",
  "SIGNAL_OPTIONS_GREEK_SMOKE_SESSION",
  "SIGNAL_OPTIONS_GREEK_SMOKE_TIMEFRAME",
  "SIGNAL_OPTIONS_GREEK_SMOKE_REPORT_DIR",
  "SIGNAL_OPTIONS_GREEK_SMOKE_MAX_SIGNALS",
  "SIGNAL_OPTIONS_GREEK_SMOKE_MAX_CANDIDATES_PER_SIGNAL",
  "SIGNAL_OPTIONS_GREEK_SMOKE_RISK_FREE_RATE",
  "SIGNAL_OPTIONS_GREEK_SMOKE_DIVIDEND_YIELD",
  "SIGNAL_OPTIONS_GREEK_SMOKE_SYMBOLS",
  "SIGNAL_OPTIONS_GEX_GREEKS_TOLERANCE_MS",
  "SIGNAL_OPTIONS_GREEK_SMOKE_LOCK_WAIT_MS",
  "SIGNAL_OPTIONS_GREEK_SMOKE_PROGRESS",
] as const;

function isolatedEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL:
      "postgresql://greek-smoke-test:unused@127.0.0.1:1/greek-smoke-test?connect_timeout=1",
    LOCAL_DATABASE_URL: "",
    PGDATABASE: "",
    PGHOST: "",
    PGPASSWORD: "",
    PGPORT: "",
    PGUSER: "",
    PYRUS_DATABASE_SOURCE: "database_url",
  };
  for (const name of SCRIPT_ENV_NAMES) delete env[name];
  return { ...env, ...overrides };
}

function runCli(args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: scriptsRoot,
    encoding: "utf8",
    env: isolatedEnvironment(overrides),
    timeout: 30_000,
  });
}

function sampleScore(total: number, notes: string[] = []) {
  return {
    total,
    components: {
      deltaFit: total,
      breakevenFit: 0,
      gammaTheta: 0,
      ivValue: 0,
      liquidity: 0,
      dataQuality: 0,
    },
    notes,
    breakevenMovePct: null,
    expectedMovePct: null,
    thetaDailyPct: null,
  };
}

function sampleCandidate(
  overrides: Partial<SignalOptionsGreekSelectorSmokeCandidate> = {},
): SignalOptionsGreekSelectorSmokeCandidate {
  return {
    ticker: "O:SPY260605C00755000",
    expirationDate: "2026-06-05",
    dte: 7,
    strike: 755,
    right: "call",
    entryAt: "2026-05-29T13:30:00.000Z",
    entryPrice: 3.25,
    exitAt: "2026-05-29T20:00:00.000Z",
    exitPrice: 3.75,
    quantity: 1,
    pnl: 50,
    volume: 100,
    greeks: {
      price: 3.25,
      delta: 0.52,
      gamma: 0.05,
      theta: -0.45,
      vega: 0.19,
      impliedVolatility: 0.2,
      timeToExpirationYears: 7 / 365,
    },
    score: sampleScore(70),
    ...overrides,
  };
}

function sampleResult(
  overrides: Partial<SignalOptionsGreekSelectorSmokeResult> = {},
): SignalOptionsGreekSelectorSmokeResult {
  const selected = sampleCandidate();
  return {
    generatedAt: "2026-05-31T21:43:00.000Z",
    date: "2026-05-29",
    deployment: {
      id: DEPLOYMENT_ID,
      name: "Pyrus Signals Options Shadow",
      mode: "shadow",
    },
    window: {
      from: "2026-05-29T00:00:00.000Z",
      to: "2026-05-29T23:59:59.999Z",
    },
    timeframe: "5m",
    config: {
      maxSignals: 2,
      maxCandidatesPerSignal: 12,
      riskFreeRate: 0.05,
      dividendYield: 0,
    },
    summary: {
      actionCandidates: 1,
      reportedSignals: 1,
      legacyClosedTrades: 1,
      comparedSignals: 1,
      changedSelections: 1,
      totalLegacyPnl: -50,
      totalSelectedPnl: 50,
      totalPnlDelta: 100,
      totalSelectedMarkedPnl: 50,
      candidatesScored: 1,
      candidatesSkipped: 1,
      skipReasons: { missing_entry_bar: 1 },
      rowsWithSelection: 1,
      rowsWithMarkedPnl: 1,
      rowsWithoutSelection: 0,
    },
    rows: [
      {
        candidateId: "candidate-1",
        symbol: "SPY",
        direction: "buy",
        signalAt: "2026-05-29T13:30:00.000Z",
        underlyingPrice: 754.95,
        outcome: "closed_trade",
        legacy: {
          ticker: "O:SPY260605C00754000",
          expirationDate: "2026-06-05",
          strike: 754,
          right: "call",
          entryPrice: 3,
          exitPrice: 2.5,
          quantity: 1,
          pnl: -50,
          closedAt: "2026-05-29T20:00:00.000Z",
        },
        selected,
        candidatesScored: 1,
        candidatesSkipped: 1,
        skipReasons: { missing_entry_bar: 1 },
        topCandidates: [selected],
        pnlDelta: 100,
        notes: ["candidate_cap_12"],
      },
    ],
    errors: [],
    ...overrides,
  };
}

function validDeployment(
  overrides: Partial<{
    id: string;
    name: string;
    mode: "shadow" | "live";
    enabled: boolean;
    providerAccountId: string;
    config: unknown;
    symbolUniverse: unknown[];
  }> = {},
) {
  return {
    id: DEPLOYMENT_ID,
    name: "Pyrus Signals Options Shadow",
    mode: "shadow" as const,
    enabled: true,
    providerAccountId: "shadow",
    config: { parameters: { executionMode: "signal_options" } },
    symbolUniverse: [" spy ", "QQQ", "SPY"],
    ...overrides,
  };
}

test("importing the command is database- and environment-safe", () => {
  const moduleUrl = pathToFileURL(scriptPath).href;
  const imported = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `delete process.env.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED; delete process.env.SIGNAL_MONITOR_BAR_EVALUATION_ENABLED; await import(${JSON.stringify(moduleUrl)}); if (process.env.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED !== undefined) throw new Error("import mutated bar evaluation");`,
    ],
    {
      cwd: scriptsRoot,
      encoding: "utf8",
      env: isolatedEnvironment(),
      timeout: 30_000,
    },
  );

  assert.equal(imported.status, 0, `${imported.stdout}${imported.stderr}`);
});

test("help and invalid CLI scope resolve before the database boundary", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0, `${help.stdout}${help.stderr}`);
  assert.match(help.stdout, /historical Greek-selector smoke/iu);
  assert.doesNotMatch(
    help.stderr,
    /ECONNREFUSED|127\.0\.0\.1|unused|\n\s+at /u,
  );

  const invalid = runCli(["--unknown=true"]);
  assert.equal(invalid.status, 1, `${invalid.stdout}${invalid.stderr}`);
  assert.match(invalid.stderr, /Usage:/u);
  assert.doesNotMatch(
    invalid.stderr,
    /ECONNREFUSED|127\.0\.0\.1|unused|postgresql:\/\/|\n\s+at /u,
  );
});

test("configuration is strict, canonical, bounded, and deterministic", () => {
  assert.ok(smoke, "Greek-selector smoke test internals are unavailable");
  const defaults = smoke.readConfig([], {}, "/tmp/greek-smoke-cwd");
  assert.deepEqual(defaults, {
    date: "2026-05-29",
    session: "regular",
    signalTimeframe: "5m",
    reportDir:
      "/tmp/greek-smoke-cwd/reports/signal-options-greek-selector-smoke/2026-05-29",
    maxSignals: null,
    maxCandidatesPerSignal: 24,
    riskFreeRate: 0.05,
    dividendYield: 0,
    symbols: [],
    gexToleranceMs: 30 * 60_000,
    lockWaitMs: 0,
    progress: true,
    help: false,
  });

  assert.deepEqual(
    smoke.readConfig(
      [
        "--date=2026-06-01",
        "--session=all",
        "--signal-timeframe=15m",
        "--report-dir=reports/smoke",
        "--max-signals=5",
        "--max-candidates-per-signal=8",
        "--risk-free-rate=0.0425",
        "--dividend-yield=1e-2",
        "--symbols=spy, QQQ,SPY",
        "--gex-tolerance-ms=0",
        "--lock-wait-ms=1500",
      ],
      { SIGNAL_OPTIONS_GREEK_SMOKE_PROGRESS: "false" },
      "/tmp/greek-smoke-cwd",
    ),
    {
      date: "2026-06-01",
      session: "all",
      signalTimeframe: "15m",
      reportDir: "/tmp/greek-smoke-cwd/reports/smoke",
      maxSignals: 5,
      maxCandidatesPerSignal: 8,
      riskFreeRate: 0.0425,
      dividendYield: 0.01,
      symbols: ["SPY", "QQQ"],
      gexToleranceMs: 0,
      lockWaitMs: 1500,
      progress: false,
      help: false,
    },
  );

  assert.equal(
    smoke.readConfig(
      ["--help"],
      { SIGNAL_OPTIONS_GREEK_SMOKE_PROGRESS: "not-a-boolean" },
      "/tmp/greek-smoke-cwd",
    ).help,
    true,
  );
});

test("invalid dates, enums, numbers, symbols, and duplicates fail closed", () => {
  assert.ok(smoke, "Greek-selector smoke test internals are unavailable");
  const invalidArgs = [
    ["--date=2026-02-30"],
    ["--session=premarket"],
    ["--signal-timeframe=10m"],
    ["--max-signals=0"],
    ["--max-signals=1e3"],
    ["--max-candidates-per-signal=201"],
    ["--risk-free-rate=0x10"],
    ["--dividend-yield=NaN"],
    ["--symbols=SPY,$(unsafe)"],
    ["--gex-tolerance-ms=86400001"],
    ["--lock-wait-ms=-1"],
    ["--date=2026-05-29", "--date=2026-05-30"],
  ];
  for (const args of invalidArgs) {
    assert.throws(
      () => smoke.readConfig(args, {}, "/tmp/greek-smoke-cwd"),
      /Usage:|must|duplicate|invalid/iu,
      args.join(" "),
    );
  }
  assert.throws(
    () =>
      smoke.readConfig(
        [],
        { SIGNAL_OPTIONS_GREEK_SMOKE_PROGRESS: "flase" },
        "/tmp/greek-smoke-cwd",
      ),
    /PROGRESS.*true.*false/iu,
  );
});

test("historical bar opt-in preserves explicit vetoes and rejects conflicts", () => {
  assert.ok(smoke, "Greek-selector smoke test internals are unavailable");
  const defaults: NodeJS.ProcessEnv = {};
  smoke.enableHistoricalBarEvaluation(defaults);
  assert.equal(defaults.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED, "1");

  const vetoed: NodeJS.ProcessEnv = {
    SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "false",
  };
  smoke.enableHistoricalBarEvaluation(vetoed);
  assert.equal(vetoed.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED, "0");

  assert.throws(
    () =>
      smoke.enableHistoricalBarEvaluation({
        PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "false",
        SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "true",
      }),
    /conflicting.*BAR_EVALUATION_ENABLED/iu,
  );
});

test("deployment evidence is normalized and restricted to shadow signal-options", () => {
  assert.ok(smoke, "Greek-selector smoke test internals are unavailable");
  assert.deepEqual(smoke.validateDeployment(validDeployment()), {
    id: DEPLOYMENT_ID,
    name: "Pyrus Signals Options Shadow",
    mode: "shadow",
    enabled: true,
    providerAccountId: "shadow",
    config: { parameters: { executionMode: "signal_options" } },
    symbolUniverse: ["SPY", "QQQ"],
  });
  assert.equal(
    smoke.validateDeployment(validDeployment({ config: {} })).name,
    "Pyrus Signals Options Shadow",
  );

  for (const candidate of [
    validDeployment({ mode: "live" }),
    validDeployment({ providerAccountId: "other" }),
    validDeployment({ enabled: false }),
    validDeployment({ name: "Unrelated Shadow Deployment", config: {} }),
    validDeployment({ symbolUniverse: [null, " "] }),
    validDeployment({ id: "not-a-uuid" }),
  ]) {
    assert.throws(
      () => smoke.validateDeployment(candidate),
      /shadow signal-options deployment|valid deployment|symbols/iu,
    );
  }

  assert.deepEqual(
    smoke.selectSymbolUniverse(["SPY", "QQQ", "NVDA"], ["qqq", "SPY"]),
    ["SPY", "QQQ"],
  );
  assert.throws(
    () => smoke.selectSymbolUniverse(["SPY"], ["QQQ"]),
    /No deployment symbols matched/iu,
  );
});

test("GEX provenance applies once per visible candidate and preserves visible reranking", async () => {
  assert.ok(smoke, "Greek-selector smoke test internals are unavailable");
  const low = sampleCandidate({
    ticker: "LOW",
    strike: 100,
    score: sampleScore(10),
  });
  const high = sampleCandidate({
    ticker: "HIGH",
    strike: 101,
    score: sampleScore(90),
    pnl: 125,
  });
  const result = sampleResult();
  result.rows[0] = {
    ...result.rows[0],
    underlyingPrice: null,
    selected: low,
    topCandidates: [low, high],
    candidatesScored: 2,
    skipReasons: Object.fromEntries([["__proto__", 2]]),
  };
  const calls: number[] = [];
  await smoke.applyGexHistoricalGreeks(
    result,
    { gexToleranceMs: 1_800_000, progress: false },
    async (input) => {
      calls.push(input.strike);
      if (input.strike === 101) {
        return {
          source: "gex_snapshot",
          greeks: high.greeks,
          snapshotId: "snapshot-1",
          symbol: "SPY",
          computedAt: "2026-05-29T13:31:00.000Z",
          ageMs: 60_000,
          toleranceMs: 1_800_000,
          sourceStatus: "partial",
          spot: null,
          option: {
            expirationDate: high.expirationDate,
            strike: high.strike,
            right: high.right,
            ticker: high.ticker,
            updatedAt: null,
          },
        };
      }
      return {
        source: "bs_reconstruction",
        greeks: low.greeks,
        reason: "missing_gex_snapshot",
        toleranceMs: 1_800_000,
      };
    },
  );

  assert.deepEqual(calls, [100, 101]);
  assert.equal(result.rows[0].selected?.ticker, "HIGH");
  assert.equal(result.rows[0].pnlDelta, 175);
  assert.equal(result.summary.totalSelectedPnl, 125);
  assert.equal(Object.hasOwn(result.summary.skipReasons, "__proto__"), true);
  assert.equal(result.summary.skipReasons["__proto__"], 2);
  const report = smokeModule.renderGreekSelectorSmokeMarkdown(result);
  assert.match(report, /Visible candidates with gex_snapshot greeks \| 1/);
  assert.match(report, /Selected rows with gex_snapshot greeks \| 1/);
});

test("Markdown rendering contains untrusted deployment, note, and error text", () => {
  const result = sampleResult();
  result.deployment.name =
    "<script>alert(1)</script> | [click](javascript:boom)";
  result.rows[0].notes = ["<img src=x onerror=boom> | note"];
  result.rows[0].topCandidates[0].score.notes = ["[link](javascript:boom)"];
  result.errors = [
    {
      symbol: "SPY|BAD",
      message: "\u001b[31m<script>boom</script> [x](javascript:boom)",
    },
  ];
  (result.config as Record<string, unknown>)["gexToleranceMs"] = 1_800_000;

  const report = smokeModule.renderGreekSelectorSmokeMarkdown(result);
  assert.match(report, /Max signals: 2/);
  assert.match(report, /PnL delta \| \$100\.00/);
  assert.match(report, /GEX tolerance: 30\.0m/);
  assert.doesNotMatch(report, /<script>|<img|\u001b|\[click\]\(javascript:/u);
  assert.match(report, /&lt;script&gt;/u);
  assert.match(report, /SPY\\\|BAD/u);

  const uncapped = sampleResult();
  uncapped.config.maxSignals = null;
  assert.match(
    smokeModule.renderGreekSelectorSmokeMarkdown(uncapped),
    /Max signals: all/u,
  );
});

test("report publication is atomic and refuses to overwrite completed evidence", async (t) => {
  assert.ok(smoke, "Greek-selector smoke test internals are unavailable");
  const parent = await mkdtemp(path.join(tmpdir(), "greek-selector-smoke-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const reportDir = path.join(parent, "run-1");

  await smoke.assertReportDestinationAvailable(reportDir);
  const reportPath = await smoke.writeReport(sampleResult(), reportDir);
  assert.equal(reportPath, path.join(reportDir, "report.md"));
  assert.match(
    await readFile(reportPath, "utf8"),
    /Greek Selector Smoke Test/u,
  );
  await assert.rejects(
    smoke.writeReport(sampleResult(), reportDir),
    /already exists/iu,
  );
  assert.deepEqual(
    (await readdir(parent)).filter((name) => name.includes(".tmp-")),
    [],
  );
});

test("execution preserves service scope and the primary failure during lock cleanup", async () => {
  assert.ok(smoke, "Greek-selector smoke test internals are unavailable");
  const config = smoke.readConfig(
    ["--symbols=QQQ", "--report-dir=reports/test-run"],
    {},
    "/tmp/greek-smoke-cwd",
  );
  const captured: Record<string, unknown>[] = [];
  let released = 0;
  let applied = 0;
  let written = 0;
  const reportPath = await smoke.executeSmoke(config, {
    acquireLock: async () => async () => {
      released += 1;
    },
    readDeployment: async () => smoke.validateDeployment(validDeployment()),
    runSmoke: async (input) => {
      captured.push(input);
      return sampleResult();
    },
    applyGex: async () => {
      applied += 1;
    },
    writeReport: async (_result, reportDir) => {
      written += 1;
      return path.join(reportDir, "report.md");
    },
    log: () => {},
  });
  assert.equal(reportPath, path.join(config.reportDir, "report.md"));
  assert.equal(released, 1);
  assert.equal(applied, 1);
  assert.equal(written, 1);
  assert.deepEqual(captured, [
    {
      deploymentId: DEPLOYMENT_ID,
      date: "2026-05-29",
      session: "regular",
      signalTimeframe: "5m",
      forceDeploymentUniverse: true,
      symbolUniverseOverride: ["QQQ"],
      maxSignals: null,
      maxCandidatesPerSignal: 24,
      riskFreeRate: 0.05,
      dividendYield: 0,
      progress: true,
    },
  ]);

  const logs: string[] = [];
  await assert.rejects(
    smoke.executeSmoke(config, {
      acquireLock: async () => async () => {
        throw new Error("secondary cleanup secret");
      },
      readDeployment: async () => smoke.validateDeployment(validDeployment()),
      runSmoke: async () => {
        throw new Error("primary smoke failure");
      },
      applyGex: async () => {},
      writeReport: async () => "unused",
      log: (message) => logs.push(message),
    }),
    /primary smoke failure/iu,
  );
  assert.deepEqual(logs, ["Signal-options worker lock cleanup failed."]);
});

test("operator diagnostics are bounded, credential-redacted, and terminal-safe", async () => {
  assert.ok(smoke, "Greek-selector smoke test internals are unavailable");
  const diagnostic = smoke.safeDiagnostic(
    new Error(
      `\u001b[31mfailed postgresql://user:secret@db.example/prod?token=secret ${"x".repeat(800)}`,
    ),
  );
  assert.ok(diagnostic.length <= 400);
  assert.doesNotMatch(diagnostic, /secret|\u001b|token=/u);
  assert.match(diagnostic, /\[redacted\]/u);

  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /sharedAdvisoryLockHolder\.acquire/u);
  assert.match(source, /closeDatabaseConnections\(\)/u);
  assert.doesNotMatch(source, /pool\.connect\(|pool\.end\(\)/u);
});
