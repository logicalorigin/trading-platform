import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import type {
  ExitPolicyVariant,
  SweepResult,
} from "./signal-options-exit-policy-sweep";

type SweepModule = typeof import("./signal-options-exit-policy-sweep");

type SweepConfig = {
  start: string;
  end?: string;
  signalTimeframe: string;
  session: string;
  reportDir: string;
  lockWaitMs: number;
  heartbeatMs: number;
  variantTimeoutMs: number;
  timeHorizon: number;
  symbols: string[];
  replayWinner: boolean;
  replayVariant: string | null;
  variantIds: string[];
  families: string[];
  maxPremiumPerEntry: number;
  wireGreekTrailMaxAgeMs: number;
};

type SweepInternals = {
  assertReportDestinationAvailable(reportDir: string): Promise<void>;
  assertSweepCompletion(input: {
    results: SweepResult[];
    replayRequired?: boolean;
    replayResult?: SweepResult | null;
  }): void;
  buildVariantUniverse(): ExitPolicyVariant[];
  computeMetrics(result: unknown): SweepResult["metrics"];
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
  readSweepConfig(env: NodeJS.ProcessEnv, cwd: string): SweepConfig;
  replayReportLine(result?: SweepResult | null): string;
  resolveVariantForConfig(
    variant: ExitPolicyVariant,
    config: Pick<SweepConfig, "maxPremiumPerEntry" | "wireGreekTrailMaxAgeMs">,
  ): ExitPolicyVariant;
  safeDiagnostic(error: unknown): string;
  selectVariants(
    variants: ExitPolicyVariant[],
    config: Pick<SweepConfig, "families" | "variantIds" | "replayVariant">,
  ): ExitPolicyVariant[];
  validateSweepDeployment(input: {
    id: string;
    name: string;
    mode: "shadow" | "live";
    symbolUniverse: unknown[];
  }): {
    id: string;
    name: string;
    mode: "shadow";
    symbolUniverse: string[];
  };
};

const barEvaluationName = "PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED";
const originalBarEvaluation = process.env[barEvaluationName];
delete process.env[barEvaluationName];
const sweep = await import("./signal-options-exit-policy-sweep");
if (originalBarEvaluation === undefined) {
  delete process.env[barEvaluationName];
} else {
  process.env[barEvaluationName] = originalBarEvaluation;
}

const internals = (
  sweep as SweepModule & {
    __signalOptionsExitPolicySweepInternalsForTests?: SweepInternals;
  }
).__signalOptionsExitPolicySweepInternalsForTests;

function requireInternals(): SweepInternals {
  assert.ok(internals, "expected focused exit-policy sweep internals");
  return internals;
}

const scriptPath = resolve(
  import.meta.dirname,
  "signal-options-exit-policy-sweep.ts",
);
const scriptSource = readFileSync(scriptPath, "utf8");
const ISOLATED_DATABASE_ENV = {
  DATABASE_URL:
    "postgresql://exit-policy-test:unused@127.0.0.1:1/exit-policy-test?connect_timeout=1",
  LOCAL_DATABASE_URL: "",
  PGDATABASE: "",
  PGHOST: "",
  PGPASSWORD: "",
  PGPORT: "",
  PGUSER: "",
  PYRUS_DATABASE_SOURCE: "database_url",
};

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, ...ISOLATED_DATABASE_ENV, ...env },
    timeout: 30_000,
  });
}

function variant(id = "baseline-current-exits"): ExitPolicyVariant {
  return {
    id,
    description: "Focused test variant",
    profilePatch: { riskCaps: { maxPremiumPerEntry: 1_500 } },
  };
}

function result(
  id: string,
  metrics: Partial<SweepResult["metrics"]> = {},
  status: SweepResult["status"] = "succeeded",
): SweepResult {
  return {
    variant: variant(id),
    status,
    eligible: status === "succeeded",
    ineligibleReason: status === "succeeded" ? null : "run failed",
    startedAt: "2026-05-01T00:00:00.000Z",
    finishedAt: "2026-05-01T00:00:01.000Z",
    durationMs: 1_000,
    metrics: {
      realizedPnl: 100,
      winRate: 0.5,
      profitFactor: 2,
      closedTrades: 25,
      maxDrawdownAbs: 500,
      openPositions: 0,
      riskAdjustedScore: 0.2,
      ...metrics,
    },
    window: {
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-31T23:59:59.999Z",
    },
    summary: null,
    error: status === "failed" ? "failed" : null,
  };
}

test("imports are environment-safe and historical opt-in preserves explicit vetoes", () => {
  const moduleUrl = pathToFileURL(scriptPath).href;
  const imported = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `delete process.env.${barEvaluationName}; await import(${JSON.stringify(moduleUrl)}); if (process.env.${barEvaluationName} !== undefined) throw new Error("import mutated bar evaluation");`,
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, ...ISOLATED_DATABASE_ENV },
      timeout: 30_000,
    },
  );
  assert.equal(imported.status, 0, `${imported.stdout}${imported.stderr}`);

  const api = requireInternals();
  const defaults: NodeJS.ProcessEnv = {};
  api.enableHistoricalBarEvaluation(defaults);
  assert.equal(defaults.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED, "1");

  const vetoed: NodeJS.ProcessEnv = {
    SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "false",
  };
  api.enableHistoricalBarEvaluation(vetoed);
  assert.equal(vetoed.PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED, "0");

  assert.throws(
    () =>
      api.enableHistoricalBarEvaluation({
        PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "false",
        SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "true",
      }),
    /conflicting.*BAR_EVALUATION_ENABLED/iu,
  );
});

test("unknown command input fails before any database boundary", () => {
  const api = requireInternals();
  assert.doesNotThrow(() => api.parseSweepArgs([]));
  assert.doesNotThrow(() => api.parseSweepArgs(["--"]));
  assert.throws(() => api.parseSweepArgs(["--unknown"]), /Usage:/u);

  const invalid = runCli(["--unknown"]);
  assert.equal(invalid.status, 1, `${invalid.stdout}${invalid.stderr}`);
  assert.match(invalid.stderr, /Usage:/u);
  assert.doesNotMatch(
    invalid.stderr,
    /ECONNREFUSED|127\.0\.0\.1|postgresql:\/\/|\n\s+at /u,
  );
});

test("blank configuration uses documented defaults instead of zero-like coercion", () => {
  const config = requireInternals().readSweepConfig(
    {
      SIGNAL_OPTIONS_EXIT_SWEEP_START: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_END: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_TIMEFRAME: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_SESSION: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_REPORT_DIR: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_HEARTBEAT_MS: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_VARIANT_TIMEOUT_MS: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_HORIZON: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_FAMILIES: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_MAX_PREMIUM_PER_ENTRY: " ",
      SIGNAL_OPTIONS_EXIT_SWEEP_GREEK_MAX_AGE_MS: " ",
    },
    "/tmp/exit-policy-config",
  );

  assert.equal(config.start, "2026-04-01");
  assert.equal(config.end, undefined);
  assert.equal(config.session, "regular");
  assert.equal(config.heartbeatMs, 60_000);
  assert.equal(config.variantTimeoutMs, 20 * 60_000);
  assert.ok(config.timeHorizon >= 2 && config.timeHorizon <= 50);
  assert.deepEqual(config.families, ["core"]);
  assert.equal(config.maxPremiumPerEntry, 1_500);
  assert.equal(config.wireGreekTrailMaxAgeMs, 45_000);
  assert.equal(config.replayWinner, false);
  assert.match(
    config.reportDir,
    /^\/tmp\/exit-policy-config\/reports\/signal-options-exit-policy-sweeps\//u,
  );
});

test("invalid dates, enums, integers, and replay configuration fail closed", () => {
  const api = requireInternals();
  const cwd = "/tmp/exit-policy-config";

  for (const start of ["2026-02-30", "06/01/2026", "2026-6-1"]) {
    assert.throws(
      () =>
        api.readSweepConfig({ SIGNAL_OPTIONS_EXIT_SWEEP_START: start }, cwd),
      /START.*YYYY-MM-DD/iu,
    );
  }
  assert.throws(
    () =>
      api.readSweepConfig(
        {
          SIGNAL_OPTIONS_EXIT_SWEEP_START: "2026-06-02",
          SIGNAL_OPTIONS_EXIT_SWEEP_END: "2026-06-01",
        },
        cwd,
      ),
    /start must be on or before end/iu,
  );
  assert.throws(
    () =>
      api.readSweepConfig(
        { SIGNAL_OPTIONS_EXIT_SWEEP_SESSION: "premarket" },
        cwd,
      ),
    /SESSION/iu,
  );
  assert.throws(
    () =>
      api.readSweepConfig({ SIGNAL_OPTIONS_EXIT_SWEEP_TIMEFRAME: "10m" }, cwd),
    /TIMEFRAME/iu,
  );
  assert.throws(
    () =>
      api.readSweepConfig(
        { SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_WINNER: "flase" },
        cwd,
      ),
    /REPLAY_WINNER.*true.*false/iu,
  );
  for (const value of ["1e3", "0x10", "+1", "01", "1.0", "-1"]) {
    assert.throws(
      () =>
        api.readSweepConfig(
          { SIGNAL_OPTIONS_EXIT_SWEEP_HEARTBEAT_MS: value },
          cwd,
        ),
      /HEARTBEAT_MS.*non-negative integer/iu,
    );
  }
  assert.throws(
    () =>
      api.readSweepConfig(
        {
          SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_VARIANT: "hard-stop-30",
          SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_WINNER: "false",
        },
        cwd,
      ),
    /REPLAY_VARIANT.*REPLAY_WINNER/iu,
  );
  assert.throws(
    () =>
      api.readSweepConfig(
        {
          SIGNAL_OPTIONS_EXIT_SWEEP_VARIANTS: "hard-stop-30",
          SIGNAL_OPTIONS_EXIT_SWEEP_FAMILIES: "core",
        },
        cwd,
      ),
    /VARIANTS.*FAMILIES/iu,
  );
});

test("variant selection is nonempty, explicit, and resolves runtime policy knobs", () => {
  const api = requireInternals();
  const universe = api.buildVariantUniverse();
  const selected = api.selectVariants(universe, {
    variantIds: ["baseline-current-exits"],
    families: [],
    replayVariant: null,
  });
  assert.deepEqual(
    selected.map((item) => item.id),
    ["baseline-current-exits"],
  );
  assert.throws(
    () =>
      api.selectVariants(universe, {
        variantIds: ["does-not-exist"],
        families: [],
        replayVariant: null,
      }),
    /Unknown exit-policy variants/iu,
  );
  assert.throws(
    () =>
      api.selectVariants(universe, {
        variantIds: [],
        families: ["unknown-family"],
        replayVariant: null,
      }),
    /Unknown exit-policy families/iu,
  );

  const wire = universe.find((item) => item.id.startsWith("wire-trail-"));
  assert.ok(wire);
  const resolved = api.resolveVariantForConfig(wire, {
    maxPremiumPerEntry: 777,
    wireGreekTrailMaxAgeMs: 1_234,
  });
  const riskCaps = resolved.profilePatch["riskCaps"] as Record<string, unknown>;
  const exitPolicy = resolved.profilePatch["exitPolicy"] as Record<
    string,
    unknown
  >;
  const wireGreekTrail = exitPolicy["wireGreekTrail"] as Record<
    string,
    unknown
  >;
  assert.equal(riskCaps["maxPremiumPerEntry"], 777);
  assert.equal(wireGreekTrail["greekMaxAgeMs"], 1_234);

  const invalidCli = runCli([], {
    SIGNAL_OPTIONS_EXIT_SWEEP_FAMILIES: "unknown-family",
  });
  assert.equal(
    invalidCli.status,
    1,
    `${invalidCli.stdout}${invalidCli.stderr}`,
  );
  assert.match(invalidCli.stderr, /Unknown exit-policy families/iu);
  assert.doesNotMatch(invalidCli.stderr, /ECONNREFUSED|127\.0\.0\.1/iu);
});

test("ranked financial evidence excludes malformed trades and rejects overflow", () => {
  const api = requireInternals();
  const metrics = api.computeMetrics({
    summary: {
      realizedPnl: 9_999,
      winningTrades: 99,
      losingTrades: 0,
      closedTrades: [
        { closedAt: "2026-05-01T15:00:00.000Z", pnl: null },
        { closedAt: "2026-05-01T15:00:00.000Z", pnl: "100" },
        { closedAt: "2026-05-01T15:00:00.000Z", pnl: true },
        { closedAt: "not-a-date", pnl: 500 },
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
      api.computeMetrics({
        summary: {
          closedTrades: [
            { closedAt: "2026-05-01T15:00:00.000Z", pnl: Number.MAX_VALUE },
            { closedAt: "2026-05-02T15:00:00.000Z", pnl: Number.MAX_VALUE },
          ],
        },
      }),
    /finite aggregate/iu,
  );
});

test("deployment validation rejects live mode and normalizes a bounded symbol universe", () => {
  const api = requireInternals();
  assert.throws(
    () =>
      api.validateSweepDeployment({
        id: "live-deployment",
        name: "Misconfigured deployment",
        mode: "live",
        symbolUniverse: [
          "SPY",
          "QQQ",
          "AAPL",
          "MSFT",
          "NVDA",
          "AMD",
          "META",
          "TSLA",
        ],
      }),
    /must be shadow/iu,
  );

  const validated = api.validateSweepDeployment({
    id: "shadow-deployment",
    name: "Shadow deployment",
    mode: "shadow",
    symbolUniverse: [
      " spy ",
      "QQQ",
      "AAPL",
      "MSFT",
      "NVDA",
      "AMD",
      "META",
      "TSLA",
      "SPY",
    ],
  });
  assert.deepEqual(validated.symbolUniverse, [
    "SPY",
    "QQQ",
    "AAPL",
    "MSFT",
    "NVDA",
    "AMD",
    "META",
    "TSLA",
  ]);
});

test("terminal, JSON, CSV, and Markdown output contain hostile content", () => {
  const api = requireInternals();
  const diagnostic = api.safeDiagnostic(
    new Error(
      `postgres://operator:super-secret@db.internal/sweep https://api.test/run?token=query-secret#fragment \u001b[31m\n\u2028\u202e${"x".repeat(800)}`,
    ),
  );
  assert.match(diagnostic, /postgres:\/\/\[redacted\]@db\.internal\/sweep/u);
  assert.doesNotMatch(
    diagnostic,
    /super-secret|query-secret|fragment|\u001b|\n|\u2028|\u202e/u,
  );
  assert.ok(diagnostic.length <= 400);

  assert.equal(
    api.csvValue('=HYPERLINK("https://example.test")'),
    '"\'=HYPERLINK(""https://example.test"")"',
  );
  assert.equal(api.csvValue("first\rsecond"), '"first\rsecond"');

  const markdown = api.markdownText(
    "name\n# forged\u2028second | <img> [click](https://bad.test)",
  );
  assert.doesNotMatch(markdown, /\n|\u2028|<img>|^# forged/mu);
  assert.match(markdown, /\\\||&lt;img&gt;|\\\[click\\\]/u);
  assert.doesNotMatch(
    api.markdownJson({ runId: "```\n# forged" }),
    /```\n# forged/u,
  );

  const json = api.jsonText(
    { profitFactor: Infinity, runId: "before\u2028middle\u202eafter" },
    2,
  );
  assert.equal(JSON.parse(json).profitFactor, "Infinity");
  assert.doesNotMatch(json, /"profitFactor": null/u);
  assert.doesNotMatch(json, /[\u2028\u202e]/u);
});

test("report files publish atomically and never overwrite a completed run", async () => {
  const api = requireInternals();
  const root = await mkdtemp(path.join(tmpdir(), "exit-policy-sweep-"));
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
      /Report destination already exists/iu,
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

test("completion and replay labels fail closed without choosing partial-run policy", () => {
  const api = requireInternals();
  const failed = result("failed", {}, "failed");
  const succeeded = result("succeeded");

  assert.throws(
    () => api.assertSweepCompletion({ results: [failed] }),
    /Every sweep variant failed/iu,
  );
  assert.throws(
    () =>
      api.assertSweepCompletion({
        results: [succeeded],
        replayRequired: true,
        replayResult: null,
      }),
    /requested but no eligible winner/iu,
  );
  assert.throws(
    () =>
      api.assertSweepCompletion({
        results: [succeeded],
        replayRequired: true,
        replayResult: failed,
      }),
    /Winner replay failed/iu,
  );
  assert.throws(
    () =>
      api.assertSweepCompletion({
        results: [succeeded],
        replayRequired: true,
        replayResult: result("drifted", { closedTrades: 4 }),
      }),
    /no longer eligible/iu,
  );

  // Partial dry-run failure policy is deliberately held for user direction.
  assert.doesNotThrow(() =>
    api.assertSweepCompletion({ results: [succeeded, failed] }),
  );
  assert.equal(api.replayReportLine(null), "Replay committed: no");
  assert.match(api.replayReportLine(failed), /^Replay failed:/u);
  const hostileReplayLine = api.replayReportLine({
    ...failed,
    error: "<img src=x>\n# forged | row",
  });
  assert.doesNotMatch(hostileReplayLine, /<img|\n|^# forged/mu);
  assert.match(hostileReplayLine, /&lt;img src=x&gt;/u);
  assert.match(
    api.replayReportLine(succeeded),
    /^Replay committed: succeeded$/u,
  );
});

test("the long-running lock and database finalizer use shared owned resources", () => {
  assert.match(scriptSource, /sharedAdvisoryLockHolder\.acquire/u);
  assert.match(scriptSource, /closeDatabaseConnections\(\)/u);
  assert.doesNotMatch(scriptSource, /pool\.connect\(/u);
});
