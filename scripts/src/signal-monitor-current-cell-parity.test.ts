import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import * as parityModule from "./signal-monitor-current-cell-parity";

type Config = {
  environment: "shadow" | "live";
  symbols: string[] | null;
  timeframes: string[];
  maxSymbols: number | null;
  batchSize: number;
  includeInactive: boolean;
  mismatchLimit: number;
  json: boolean;
  help: boolean;
};

type ParityInternals = {
  errorMessage: (error: unknown) => string;
  readConfig: (argv: string[]) => Config;
  renderTextReport: (output: Record<string, unknown>) => string;
  runDiagnostic: (
    config: Config,
    dependencies: Record<string, unknown>,
  ) => Promise<Record<string, any>>;
  serializeJson: (value: unknown) => string;
};

const parity = (
  parityModule as typeof parityModule & {
    __signalMonitorCurrentCellParityInternalsForTests?: ParityInternals;
  }
).__signalMonitorCurrentCellParityInternalsForTests;

const ISOLATED_DATABASE_ENV = {
  DATABASE_URL:
    "postgresql://current-cell-parity-test:unused@127.0.0.1:1/current-cell-parity-test?connect_timeout=1",
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
  "signal-monitor-current-cell-parity.ts",
);

const runCli = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, ...ISOLATED_DATABASE_ENV },
    timeout: 30_000,
  });

const profile = {
  id: "00000000-0000-4000-8000-000000000001",
  environment: "shadow",
  enabled: true,
  maxSymbols: 2_000,
  freshWindowBars: 3,
};

function mismatch(symbol: string, index: number) {
  return {
    profileId: profile.id,
    symbol,
    timeframe: "5m",
    field: "status",
    stored: `stale-${index}`,
    derived: "ok",
    reason: "value_mismatch",
  };
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    environment: "shadow",
    symbols: null,
    timeframes: ["5m"],
    maxSymbols: null,
    batchSize: 5,
    includeInactive: false,
    mismatchLimit: 50,
    json: false,
    help: false,
    ...overrides,
  };
}

function universe(symbols: string[]) {
  return {
    profile,
    symbols,
    watchlistSymbols: [...symbols, "OUTSIDE-ACTIVE-UNIVERSE"],
    skippedSymbols: ["SKIPPED-ACTIVE-SYMBOL"],
    truncated: true,
    fallbackUsed: false,
    universe: {
      mode: "all_watchlists_plus_universe",
      configuredMaxSymbols: 2_000,
      resolvedSymbols: symbols.length,
      pinnedSymbols: 1,
      expansionSymbols: Math.max(0, symbols.length - 1),
      shortfall: Math.max(0, 2_000 - symbols.length),
      source: "watchlists_plus_ranked_universe",
      fallbackUsed: false,
      degradedReason: null as string | null,
      rankedAt: new Date("2026-07-14T12:00:00.000Z"),
    },
  };
}

test("importing the current-cell parity command performs no database work", () => {
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
  assert.ok(parity, "current-cell parity test internals are unavailable");
  assert.deepEqual(parity.readConfig([]), {
    environment: "shadow",
    symbols: null,
    timeframes: ["1m", "2m", "5m", "15m", "1h", "1d"],
    maxSymbols: null,
    batchSize: 5,
    includeInactive: false,
    mismatchLimit: 50,
    json: false,
    help: false,
  });
  assert.deepEqual(
    parity.readConfig([
      "--environment=live",
      "--symbols=spy, brk-b",
      "--timeframes=5m,1h",
      "--max-symbols=2",
      "--batch-size=1",
      "--include-inactive",
      "--mismatch-limit=0",
      "--json",
    ]),
    {
      environment: "live",
      symbols: ["SPY", "BRK.B"],
      timeframes: ["5m", "1h"],
      maxSymbols: 2,
      batchSize: 1,
      includeInactive: true,
      mismatchLimit: 0,
      json: true,
      help: false,
    },
  );
  assert.equal(parity.readConfig(["--help"]).help, true);
  assert.equal(parity.readConfig(["-h"]).help, true);

  for (const args of [
    ["--unknown=true"],
    ["--environment="],
    ["--environment=shadow", "--environment=live"],
    ["--symbols="],
    ["--symbols=SPY,,QQQ"],
    [`--symbols=${"X".repeat(33)}`],
    ["--symbols=SPY\u0007"],
    ["--timeframes="],
    ["--timeframes=5m,5m"],
    ["--max-symbols=0"],
    ["--max-symbols=01"],
    ["--max-symbols=2001"],
    ["--batch-size=0"],
    ["--batch-size=1.5"],
    ["--batch-size=1001"],
    ["--mismatch-limit=01"],
    ["--mismatch-limit=10001"],
    ["--json=false"],
    ["positional"],
  ]) {
    assert.throws(() => parity.readConfig(args), /Usage:/u);
  }
});

test("explicit symbols bypass universe discovery and mismatch retention is bounded", async () => {
  assert.ok(parity, "current-cell parity test internals are unavailable");
  let universeCalls = 0;
  const reportedBatches: string[][] = [];
  const output = await parity.runDiagnostic(
    config({
      symbols: ["SPY", "QQQ"],
      batchSize: 1,
      mismatchLimit: 2,
    }),
    {
      loadProfile: async () => profile,
      resolveUniverse: async () => {
        universeCalls += 1;
        return universe(["SHOULD-NOT-BE-RESOLVED"]);
      },
      buildReport: async (input: { symbols: string[] }) => {
        reportedBatches.push(input.symbols);
        const mismatches = [0, 1, 2].map((index) =>
          mismatch(input.symbols[0] ?? "UNKNOWN", index),
        );
        return {
          counts: {
            comparedCells: 1,
            missingStoredCells: 0,
            missingDerivedCells: 0,
            mismatches: mismatches.length,
          },
          mismatches,
        };
      },
    },
  );

  assert.equal(universeCalls, 0);
  assert.deepEqual(reportedBatches, [["SPY"], ["QQQ"]]);
  assert.equal(output.symbolSource, "explicit");
  assert.equal(output.profileUniverseSymbols, null);
  assert.equal(output.counts.mismatches, 6);
  assert.deepEqual(output.mismatchSummary, {
    byField: { status: 6 },
    byReason: { value_mismatch: 6 },
  });
  assert.equal(output.sampleMismatches.length, 2);
});

test("automatic scope uses only producer-active symbols and fails closed when empty", async () => {
  assert.ok(parity, "current-cell parity test internals are unavailable");
  const reportedBatches: string[][] = [];
  const dependencies = {
    loadProfile: async () => profile,
    resolveUniverse: async () => universe(["SPY"]),
    buildReport: async (input: { symbols: string[] }) => {
      reportedBatches.push(input.symbols);
      return {
        counts: {
          comparedCells: 1,
          missingStoredCells: 0,
          missingDerivedCells: 0,
          mismatches: 0,
        },
        mismatches: [],
      };
    },
  };
  const output = await parity.runDiagnostic(config(), dependencies);

  assert.deepEqual(reportedBatches, [["SPY"]]);
  assert.equal(output.symbolSource, "profile");
  assert.equal(output.profileUniverseSymbols, 1);
  assert.equal(output.universe.truncated, true);
  assert.equal(output.scopeComplete, true);

  await assert.rejects(
    parity.runDiagnostic(config(), {
      ...dependencies,
      resolveUniverse: async () => universe([]),
      buildReport: async () => {
        throw new Error("an empty scope must not become an unfiltered query");
      },
    }),
    /resolved no symbols/i,
  );
});

test("automatic scope preserves producer priority and enforces its symbol ceiling", async () => {
  assert.ok(parity, "current-cell parity test internals are unavailable");
  const sourceSymbols = Array.from(
    { length: 2_001 },
    (_, index) => `S${String(index).padStart(4, "0")}`,
  );
  const reportedBatches: string[][] = [];
  const output = await parity.runDiagnostic(config({ batchSize: 1_000 }), {
    loadProfile: async () => ({ ...profile, maxSymbols: 3_000 }),
    resolveUniverse: async () => {
      const resolution = universe(sourceSymbols);
      resolution.profile = { ...profile, maxSymbols: 3_000 };
      resolution.universe.configuredMaxSymbols = 3_000;
      return resolution;
    },
    buildReport: async (input: { symbols: string[] }) => {
      reportedBatches.push(input.symbols);
      return {
        counts: {
          comparedCells: input.symbols.length,
          missingStoredCells: 0,
          missingDerivedCells: 0,
          mismatches: 0,
        },
        mismatches: [],
      };
    },
  });

  assert.equal(reportedBatches.length, 2);
  assert.deepEqual(reportedBatches.flat(), sourceSymbols.slice(0, 2_000));
  assert.equal(output.candidateSymbols, 2_001);
  assert.equal(output.requestedSymbols, 2_000);
  assert.equal(output.truncatedByMaxSymbols, true);
});

test("scope truncation and degraded universe evidence are exact", async () => {
  assert.ok(parity, "current-cell parity test internals are unavailable");
  const degraded = universe(["SPY", "QQQ"]);
  degraded.fallbackUsed = true;
  degraded.universe.fallbackUsed = true;
  degraded.universe.degradedReason =
    "ranked universe unavailable: postgresql://operator:super-secret@db.example/pyrus?token=query-secret";
  const output = await parity.runDiagnostic(config({ maxSymbols: 1 }), {
    loadProfile: async () => profile,
    resolveUniverse: async () => degraded,
    buildReport: async () => ({
      counts: {
        comparedCells: 1,
        missingStoredCells: 0,
        missingDerivedCells: 0,
        mismatches: 0,
      },
      mismatches: [],
    }),
  });

  assert.equal(output.candidateSymbols, 2);
  assert.equal(output.requestedSymbols, 1);
  assert.equal(output.truncatedByMaxSymbols, true);
  assert.equal(output.scopeComplete, false);
  assert.match(output.scopeWarning, /postgresql:\/\/\[redacted\]@db\.example/u);
  assert.doesNotMatch(output.scopeWarning, /super-secret|query-secret/u);
  assert.equal(output.universe.degradedReason, output.scopeWarning);
});

test("operator errors and human output are bounded and terminal-safe", () => {
  assert.ok(parity, "current-cell parity test internals are unavailable");
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

  const hostileSymbol = "SPY\u001b[31m\nInjected\u202e";
  const output = {
    environment: "shadow",
    profileId: profile.id,
    enabled: true,
    includeInactive: false,
    symbolSource: "explicit",
    candidateSymbols: 1,
    requestedSymbols: 1,
    profileUniverseSymbols: null,
    batchSize: 5,
    batches: 1,
    truncatedByMaxSymbols: false,
    scopeComplete: true,
    scopeWarning: null,
    universe: null,
    timeframes: ["5m"],
    counts: {
      comparedCells: 1,
      missingStoredCells: 0,
      missingDerivedCells: 0,
      mismatches: 2,
    },
    mismatchSummary: {
      byField: { status: 2 },
      byReason: { value_mismatch: 2 },
    },
    sampleMismatches: [
      {
        ...mismatch(hostileSymbol, 0),
        stored: "postgresql://operator:super-secret@db.example/pyrus",
      },
    ],
  };
  const rendered = parity.renderTextReport(output);

  assert.match(rendered, /Sample mismatches \(showing 1 of 2\):/u);
  assert.doesNotMatch(rendered, /super-secret|\nInjected/u);
  assert.doesNotMatch(
    rendered,
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );

  const serialized = parity.serializeJson(output);
  assert.doesNotMatch(
    serialized,
    /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.match(serialized, /\\u202e/iu);
  assert.deepEqual(JSON.parse(serialized), output);
});
