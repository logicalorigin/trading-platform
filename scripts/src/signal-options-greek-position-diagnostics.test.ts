import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import * as diagnosticsModule from "./signal-options-greek-position-diagnostics";

type Config = {
  deploymentId: string | null;
  eventLimit: number;
  reportDir: string;
  requireReady: boolean;
  help: boolean;
};

type DeploymentRow = {
  id: string;
  name: string;
  mode: "shadow" | "live";
  enabled: boolean;
  providerAccountId: string;
  updatedAt: Date | string | null;
  config: unknown;
};

type EventRow = {
  event_type: string;
  payload: unknown;
  occurred_at: Date | string;
};

type DiagnosticsInternals = {
  assertReportDestinationAvailable: (reportDir: string) => Promise<void>;
  buildDiagnosticsFromDb: (
    config: Config,
    dependencies: {
      readDeployment: (deploymentId: string | null) => Promise<DeploymentRow>;
      listActivePositions: (input: { deploymentId: string }) => Promise<{
        positions: unknown[];
        events: unknown[];
      }>;
      readRecentEvents: (
        deploymentId: string,
        limit: number,
      ) => Promise<EventRow[]>;
      now: () => Date;
    },
  ) => Promise<diagnosticsModule.GreekPositionDiagnostics>;
  recentEventSummary: (
    events: EventRow[],
  ) => diagnosticsModule.GreekPositionDiagnosticsInput["recentEvents"];
  readConfig: (
    args?: string[],
    env?: NodeJS.ProcessEnv,
    cwd?: string,
  ) => Config;
  safeDiagnostic: (error: unknown) => string;
  validateDeployment: (value: unknown) => DeploymentRow;
  writeDiagnostics: (
    diagnostics: diagnosticsModule.GreekPositionDiagnostics,
    reportDir: string,
  ) => Promise<void>;
};

const diagnostics = (
  diagnosticsModule as typeof diagnosticsModule & {
    __signalOptionsGreekPositionDiagnosticsInternalsForTests?: DiagnosticsInternals;
  }
).__signalOptionsGreekPositionDiagnosticsInternalsForTests;

const scriptPath = resolve(
  import.meta.dirname,
  "signal-options-greek-position-diagnostics.ts",
);
const scriptsRoot = resolve(import.meta.dirname, "..");
const DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const SCRIPT_ENV_NAMES = [
  "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_DEPLOYMENT_ID",
  "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_EVENT_LIMIT",
  "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REPORT_DIR",
  "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REQUIRE_READY",
] as const;

function isolatedEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL:
      "postgresql://greek-position-test:unused@127.0.0.1:1/greek-position-test?connect_timeout=1",
    LOCAL_DATABASE_URL: "",
    PGDATABASE: "",
    PGHOST: "",
    PGPASSWORD: "",
    PGPORT: "",
    PGUSER: "",
    PYRUS_DATABASE_SOURCE: "database_url",
  };
  for (const name of SCRIPT_ENV_NAMES) {
    delete env[name];
  }
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

function sampleInput(
  overrides: Partial<diagnosticsModule.GreekPositionDiagnosticsInput> = {},
): diagnosticsModule.GreekPositionDiagnosticsInput {
  return {
    generatedAt: "2026-06-02T14:35:00.000Z",
    deployment: {
      id: DEPLOYMENT_ID,
      name: "Pyrus Signals Options Shadow",
      enabled: true,
      updatedAt: "2026-06-01T20:41:09.923Z",
    },
    profile: {
      greekPositionManagementEnabled: true,
      wireGreekTrailEnabled: false,
    },
    activePositions: [
      {
        symbol: "HOOD",
        lastMarkedAt: "2026-06-02T14:34:00.000Z",
        lastMarkPrice: 3.4,
        stopPrice: 3,
        greekManagement: {
          available: true,
          enforcing: false,
          recommendation: "tighten",
          reasons: ["delta_decay", "theta_burden"],
          fresh: true,
          ageMs: 3_000,
          currentDelta: 0.42,
          entryDelta: 0.61,
          deltaImprovement: -0.19,
          currentGamma: 0.03,
          currentTheta: -0.34,
          thetaBurdenPct: 9.1,
        },
      },
      {
        symbol: "DIA",
        lastMarkedAt: "2026-06-02T14:34:10.000Z",
        lastMarkPrice: 5.1,
        stopPrice: 3.16,
        greekManagement: null,
      },
    ],
    recentEvents: {
      total: 12,
      marks: 2,
      marksWithGreekManagement: 1,
      latestMarkAt: "2026-06-02T14:34:10.000Z",
      latestEventAt: "2026-06-02T14:34:10.000Z",
    },
    ...overrides,
  };
}

test("importing the Greek-position command performs no database work", () => {
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
      cwd: scriptsRoot,
      encoding: "utf8",
      env: isolatedEnvironment(),
      timeout: 30_000,
    },
  );

  assert.equal(
    imported.status,
    0,
    `import unexpectedly ran the diagnostic:\n${imported.stdout}${imported.stderr}`,
  );
});

test("invalid CLI scope and help resolve before database work", () => {
  const invalid = runCli(["--unknown=true"]);
  assert.equal(invalid.status, 1, `${invalid.stdout}${invalid.stderr}`);
  assert.match(invalid.stderr, /Usage:/u);
  assert.doesNotMatch(
    invalid.stderr,
    /ECONNREFUSED|127\.0\.0\.1|unused|\n\s+at /u,
  );

  const help = runCli(["--help"]);
  assert.equal(help.status, 0, `${help.stdout}${help.stderr}`);
  assert.match(help.stdout, /Read-only diagnostic/u);
  assert.doesNotMatch(
    help.stderr,
    /ECONNREFUSED|127\.0\.0\.1|unused|\n\s+at /u,
  );
});

test("CLI and environment configuration is strict, canonical, and bounded", () => {
  assert.ok(diagnostics, "Greek-position test internals are unavailable");
  const defaults = diagnostics.readConfig([], {}, "/tmp/greek-position-cwd");
  assert.equal(defaults.deploymentId, null);
  assert.equal(defaults.eventLimit, 750);
  assert.equal(defaults.requireReady, false);
  assert.equal(defaults.help, false);
  assert.match(
    defaults.reportDir,
    /^\/tmp\/greek-position-cwd\/reports\/signal-options-greek-position-diagnostics\//u,
  );

  assert.deepEqual(
    diagnostics.readConfig(
      [
        `--deployment-id=${DEPLOYMENT_ID.toUpperCase()}`,
        "--event-limit=10000",
        "--report-dir=reports/greek-position",
        "--require-ready",
      ],
      {},
      "/tmp/greek-position-cwd",
    ),
    {
      deploymentId: DEPLOYMENT_ID,
      eventLimit: 10_000,
      reportDir: "/tmp/greek-position-cwd/reports/greek-position",
      requireReady: true,
      help: false,
    },
  );

  assert.deepEqual(
    diagnostics.readConfig(
      [],
      {
        SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_DEPLOYMENT_ID: DEPLOYMENT_ID,
        SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_EVENT_LIMIT: "1",
        SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REPORT_DIR: "reports/env",
        SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REQUIRE_READY: "false",
      },
      "/tmp/greek-position-cwd",
    ),
    {
      deploymentId: DEPLOYMENT_ID,
      eventLimit: 1,
      reportDir: "/tmp/greek-position-cwd/reports/env",
      requireReady: false,
      help: false,
    },
  );
  assert.equal(diagnostics.readConfig(["-h"], {}, "/tmp").help, true);

  const invalidCases: Array<[string[], NodeJS.ProcessEnv]> = [
    [["--unknown=true"], {}],
    [["--deployment-id="], {}],
    [["--deployment-id=not-a-uuid"], {}],
    [
      [`--deployment-id=${DEPLOYMENT_ID}`, `--deployment-id=${DEPLOYMENT_ID}`],
      {},
    ],
    [["--event-limit=0"], {}],
    [["--event-limit="], {}],
    [["--event-limit=01"], {}],
    [["--event-limit=1.5"], {}],
    [["--event-limit=10001"], {}],
    [["--event-limit=1", "--event-limit=2"], {}],
    [["--report-dir="], {}],
    [["--require-ready=false"], {}],
    [["positional"], {}],
    [[], { SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_EVENT_LIMIT: "" }],
    [[], { SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_EVENT_LIMIT: "01" }],
    [[], { SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REQUIRE_READY: "maybe" }],
    [
      [`--deployment-id=${DEPLOYMENT_ID}`],
      {
        SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_DEPLOYMENT_ID:
          "00000000-0000-4000-8000-000000000002",
      },
    ],
    [
      ["--event-limit=1"],
      { SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_EVENT_LIMIT: "2" },
    ],
    [
      ["--report-dir=one"],
      { SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REPORT_DIR: "two" },
    ],
    [
      ["--require-ready"],
      { SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REQUIRE_READY: "false" },
    ],
  ];
  for (const [args, env] of invalidCases) {
    assert.throws(
      () => diagnostics.readConfig(args, env, "/tmp/greek-position-cwd"),
      /Usage:|must|conflicts|requires/u,
      `${args.join(" ")} ${JSON.stringify(env)}`,
    );
  }
});

test("diagnostics preserve coverage semantics while rejecting malformed evidence", () => {
  const baseline =
    diagnosticsModule.buildGreekPositionDiagnostics(sampleInput());
  assert.equal(baseline.status, "partial");
  assert.equal(baseline.summary.positionsWithGreekManagement, 1);
  assert.equal(baseline.summary.freshGreekPositions, 1);
  assert.deepEqual(baseline.summary.recommendations, { tighten: 1 });

  const malformed = diagnosticsModule.buildGreekPositionDiagnostics(
    sampleInput({
      activePositions: [
        {
          symbol: "SPY",
          lastMarkedAt: null,
          lastMarkPrice: null,
          stopPrice: "3.50" as unknown as number,
          greekManagement: {
            recommendation: "__proto__",
            fresh: true,
            reasons: ["not_authoritative"],
          },
        },
        {
          symbol: "QQQ",
          lastMarkedAt: null,
          lastMarkPrice: "4.25" as unknown as number,
          stopPrice: 0,
          greekManagement: {
            recommendation: "hold",
            available: true,
            fresh: false,
            enforcing: false,
            reasons: [" theta_burden ", "", null, { unsafe: true }],
            ageMs: "0" as unknown as number,
          },
        },
      ],
    }),
  );

  assert.equal(malformed.status, "partial");
  assert.equal(malformed.summary.positionsWithGreekManagement, 1);
  assert.deepEqual(malformed.summary.recommendations, { hold: 1 });
  assert.equal(
    Object.getPrototypeOf(malformed.summary.recommendations),
    Object.prototype,
  );
  assert.deepEqual(malformed.positions[0], {
    symbol: "SPY",
    lastMarkedAt: null,
    lastMarkPrice: null,
    stopPrice: null,
    recommendation: "missing",
    available: null,
    fresh: null,
    enforcing: null,
    reasons: [],
    ageMs: null,
    deltaImprovement: null,
    thetaBurdenPct: null,
    currentDelta: null,
    entryDelta: null,
    currentGamma: null,
    currentTheta: null,
  });
  assert.equal(malformed.positions[1]?.lastMarkPrice, null);
  assert.equal(malformed.positions[1]?.stopPrice, 0);
  assert.equal(malformed.positions[1]?.ageMs, null);
  assert.deepEqual(malformed.positions[1]?.reasons, ["theta_burden"]);
});

test("ready gate remains coverage-based rather than freshness-based", () => {
  const ready = diagnosticsModule.buildGreekPositionDiagnostics(
    sampleInput({
      activePositions: sampleInput().activePositions.map((position) => ({
        ...position,
        greekManagement:
          position.greekManagement ??
          ({
            available: false,
            enforcing: false,
            recommendation: "unavailable",
            fresh: false,
            reasons: ["greeks_unavailable"],
          } as const),
      })),
    }),
  );

  assert.equal(ready.status, "ready");
  assert.equal(ready.summary.freshGreekPositions, 1);
  assert.equal(ready.summary.staleOrFallbackGreekPositions, 1);
  assert.deepEqual(diagnosticsModule.greekPositionDiagnosticsReadyGate(ready), {
    passed: true,
    reason: "ready",
  });
});

test("recent event evidence uses the runtime replay contract and valid diagnostics", () => {
  assert.ok(diagnostics, "Greek-position test internals are unavailable");
  const mark = (payload: unknown, occurredAt: string): EventRow => ({
    event_type: "signal_options_shadow_mark",
    payload,
    occurred_at: occurredAt,
  });
  const summary = diagnostics.recentEventSummary([
    mark(
      {
        position: {
          lastStop: {
            greekManagement: {
              recommendation: "hold",
              fresh: false,
            },
          },
        },
      },
      "2026-07-14T12:04:00.000Z",
    ),
    mark(
      {
        metadata: { runMode: "replay" },
        position: {
          lastStop: { greekManagement: { recommendation: "tighten" } },
        },
      },
      "2026-07-14T12:03:00.000Z",
    ),
    mark(
      {
        metadata: { sourceType: "signal_options_replay" },
        position: {
          lastStop: { greekManagement: { recommendation: "tighten" } },
        },
      },
      "2026-07-14T12:02:00.000Z",
    ),
    mark(
      {
        position: {
          lastStop: { greekManagement: { recommendation: "invented" } },
        },
      },
      "2026-07-14T12:01:00.000Z",
    ),
  ]);

  assert.deepEqual(summary, {
    total: 2,
    marks: 2,
    marksWithGreekManagement: 1,
    latestMarkAt: "2026-07-14T12:04:00.000Z",
    latestEventAt: "2026-07-14T12:04:00.000Z",
  });
});

test("deployment validation admits only shadow signal-options deployments", () => {
  assert.ok(diagnostics, "Greek-position test internals are unavailable");
  const valid: DeploymentRow = {
    id: DEPLOYMENT_ID,
    name: "Pyrus Signals Options Shadow",
    mode: "shadow",
    enabled: false,
    providerAccountId: "shadow",
    updatedAt: "2026-07-14T12:00:00.000Z",
    config: {
      parameters: { executionMode: "signal_options" },
    },
  };
  assert.deepEqual(diagnostics.validateDeployment(valid), valid);

  for (const candidate of [
    { ...valid, mode: "live" },
    { ...valid, providerAccountId: "broker-account" },
    { ...valid, config: {} },
    { ...valid, id: "not-a-uuid" },
    { ...valid, name: "" },
  ]) {
    assert.throws(
      () => diagnostics.validateDeployment(candidate),
      /shadow signal-options deployment|valid deployment/u,
    );
  }
});

test("database assembly uses the read-only active-position path sequentially", async () => {
  assert.ok(diagnostics, "Greek-position test internals are unavailable");
  const sequence: string[] = [];
  const output = await diagnostics.buildDiagnosticsFromDb(
    {
      deploymentId: DEPLOYMENT_ID,
      eventLimit: 25,
      reportDir: "/tmp/not-written",
      requireReady: false,
      help: false,
    },
    {
      readDeployment: async (deploymentId) => {
        sequence.push(`deployment:${deploymentId}`);
        return {
          id: DEPLOYMENT_ID,
          name: "Pyrus Signals Options Shadow",
          mode: "shadow",
          enabled: true,
          providerAccountId: "shadow",
          updatedAt: "2026-07-14T12:00:00.000Z",
          config: {
            signalOptions: {
              exitPolicy: {
                greekPositionManagement: { enabled: true },
              },
            },
          },
        };
      },
      listActivePositions: async ({ deploymentId }) => {
        sequence.push(`positions:${deploymentId}`);
        return {
          positions: [
            {
              symbol: "spy",
              lastMarkedAt: "2026-07-14T12:00:00.000Z",
              lastMarkPrice: 2.5,
              stopPrice: 2,
              lastStop: {
                greekManagement: {
                  recommendation: "hold",
                  available: true,
                  fresh: false,
                  enforcing: false,
                  reasons: [],
                },
              },
            },
          ],
          events: [],
        };
      },
      readRecentEvents: async (deploymentId, limit) => {
        sequence.push(`events:${deploymentId}:${limit}`);
        return [];
      },
      now: () => new Date("2026-07-14T12:05:00.000Z"),
    },
  );

  assert.deepEqual(sequence, [
    `deployment:${DEPLOYMENT_ID}`,
    `positions:${DEPLOYMENT_ID}`,
    `events:${DEPLOYMENT_ID}:25`,
  ]);
  assert.equal(output.generatedAt, "2026-07-14T12:05:00.000Z");
  assert.equal(output.status, "ready");
  assert.equal(output.positions[0]?.symbol, "SPY");

  const source = await readFile(scriptPath, "utf8");
  assert.doesNotMatch(source, /listSignalOptionsAutomationState/u);
  assert.match(source, /listSignalOptionsActivePositionsForDeployment/u);
});

test("Markdown contains hostile persisted text without creating Markdown or HTML", () => {
  const output = diagnosticsModule.buildGreekPositionDiagnostics(
    sampleInput({
      deployment: {
        id: `${DEPLOYMENT_ID}</script>`,
        name: "<script>alert(1)</script> | [run](javascript:alert(1))",
        enabled: true,
        updatedAt: "2026-07-14T12:00:00.000Z\n## injected",
      },
      activePositions: [
        {
          symbol: "SPY|QQQ\n## injected",
          lastMarkedAt: "2026-07-14T12:00:00.000Z",
          greekManagement: {
            recommendation: "hold",
            fresh: true,
            enforcing: false,
            reasons: ["ok | <img src=x onerror=alert(1)>\nnew-row"],
          },
        },
      ],
    }),
  );
  const markdown =
    diagnosticsModule.renderGreekPositionDiagnosticsMarkdown(output);

  assert.doesNotMatch(markdown, /<script>|<img|\n## injected/u);
  assert.doesNotMatch(markdown, /\[run\]\(javascript:/u);
  assert.match(markdown, /&lt;script&gt;/u);
  assert.match(markdown, /SPY\\\|QQQ/u);
});

test("report publication is atomic and refuses to overwrite evidence", async (t) => {
  assert.ok(diagnostics, "Greek-position test internals are unavailable");
  const parent = await mkdtemp(
    path.join(tmpdir(), "greek-position-diagnostics-test-"),
  );
  t.after(async () => {
    await rm(parent, { recursive: true, force: true });
  });
  const reportDir = path.join(parent, "report");
  const output = diagnosticsModule.buildGreekPositionDiagnostics(sampleInput());

  await diagnostics.assertReportDestinationAvailable(reportDir);
  await diagnostics.writeDiagnostics(output, reportDir);
  assert.deepEqual((await readdir(reportDir)).sort(), [
    "report.md",
    "results.json",
  ]);
  const originalJson = await readFile(
    path.join(reportDir, "results.json"),
    "utf8",
  );
  await assert.rejects(
    diagnostics.writeDiagnostics(output, reportDir),
    /already exists/u,
  );
  assert.equal(
    await readFile(path.join(reportDir, "results.json"), "utf8"),
    originalJson,
  );
  assert.deepEqual(await readdir(parent), ["report"]);
});

test("database failures are bounded, redacted, and finalized without raw stacks", async (t) => {
  assert.ok(diagnostics, "Greek-position test internals are unavailable");
  const parent = await mkdtemp(path.join(tmpdir(), "greek-position-cli-test-"));
  t.after(async () => {
    await rm(parent, { recursive: true, force: true });
  });
  const reportDir = path.join(parent, "report");
  const result = runCli(
    [`--deployment-id=${DEPLOYMENT_ID}`, `--report-dir=${reportDir}`],
    {
      DATABASE_URL:
        "postgresql://greek-user:super-secret@127.0.0.1:1/greek-position?connect_timeout=1&password=also-secret",
    },
  );

  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
  assert.doesNotMatch(result.stderr, /super-secret|also-secret|\n\s+at /u);
  assert.match(result.stderr, /connect|refused|database|failed/iu);
  assert.deepEqual(await readdir(parent), []);
  assert.doesNotMatch(
    diagnostics.safeDiagnostic(
      new Error(
        "postgresql://name:password@db.example/pyrus?token=secret\u001b[31m",
      ),
    ),
    /name:password|token=secret|\u001b/u,
  );
});
