import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve(
  import.meta.dirname,
  "verify-flow-universe-optionability.ts",
);
const scriptsRoot = resolve(import.meta.dirname, "..");
const DATABASE_ENV_NAMES = [
  "DATABASE_URL",
  "LOCAL_DATABASE_URL",
  "PGDATABASE",
  "PGHOST",
  "PGPASSWORD",
  "PGPORT",
  "PGUSER",
  "PYRUS_DATABASE_SOURCE",
] as const;

const previousDatabaseEnv = Object.fromEntries(
  DATABASE_ENV_NAMES.map((name) => [name, process.env[name]]),
);
for (const name of DATABASE_ENV_NAMES) delete process.env[name];
const optionabilityModule = await import(
  "./verify-flow-universe-optionability"
);
for (const [name, value] of Object.entries(previousDatabaseEnv)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
const optionability =
  optionabilityModule.__verifyFlowUniverseOptionabilityInternalsForTests;

function runCli(args: string[]) {
  const env = { ...process.env };
  for (const name of DATABASE_ENV_NAMES) delete env[name];
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: scriptsRoot,
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
}

test("help and invalid input finish before database work", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0, `${help.stdout}${help.stderr}`);
  assert.match(help.stdout, /Usage:/u);
  assert.doesNotMatch(help.stderr, /ECONNREFUSED|127\.0\.0\.1|\n\s+at /u);

  const invalid = runCli(["--unknown=true"]);
  assert.equal(invalid.status, 1, `${invalid.stdout}${invalid.stderr}`);
  assert.match(invalid.stderr, /Usage:/u);
  assert.doesNotMatch(invalid.stderr, /ECONNREFUSED|127\.0\.0\.1|\n\s+at /u);
});

test("CLI is strict, preview-first, and permits a zero delay", () => {
  assert.deepEqual(optionability.parseOptions([]), {
    limit: 100,
    delayMs: 750,
    force: false,
    execute: false,
    explicitSymbols: [],
    includeWatchlists: true,
    help: false,
  });
  assert.deepEqual(
    optionability.parseOptions([
      "--",
      "--execute",
      "--limit=25",
      "--delay-ms=0",
      "--force=true",
      "--symbols=spy, qqq,spy",
      "--watchlists=false",
    ]),
    {
      limit: 25,
      delayMs: 0,
      force: true,
      execute: true,
      explicitSymbols: ["SPY", "QQQ"],
      includeWatchlists: false,
      help: false,
    },
  );
  assert.equal(optionability.parseOptions(["--help"]).help, true);
  assert.equal(optionability.parseOptions(["-h"]).help, true);

  for (const args of [
    ["--dry-run=false"],
    ["--execute=false"],
    ["--execute", "--execute"],
    ["--limit=0"],
    ["--limit=01"],
    ["--limit=1e3"],
    ["--delay-ms=-1"],
    ["--delay-ms=01"],
    ["--force=yes"],
    ["--symbols="],
    ["--watchlists=1"],
    ["--unknown=true"],
    ["--help", "--execute"],
    ["verify"],
  ]) {
    assert.throws(() => optionability.parseOptions(args), /Usage:/u);
  }
});

test("preview probes with a deadline, reports bounded errors, and never writes", async () => {
  const fetchInputs: Array<Record<string, unknown>> = [];
  const writes: Array<Record<string, unknown>> = [];
  const summary = await optionability.runVerification(
    optionability.parseOptions([
      "--symbols=AAPL,QQQ",
      "--watchlists=false",
      "--delay-ms=0",
    ]),
    {
      async loadWatchlistSymbols() {
        throw new Error("watchlists should be disabled");
      },
      async loadCandidates() {
        return [
          { symbol: "AAPL", market: "stocks", listingKey: "stocks:AAPL" },
          { symbol: "QQQ", market: "etf", listingKey: "etf:QQQ" },
        ];
      },
      async fetchExpirations(input: Record<string, unknown>) {
        fetchInputs.push(input);
        if (input["underlying"] === "QQQ") {
          throw new Error(
            `https://operator:secret@example.test \u001b[31mline\nnext${"x".repeat(1_000)}`,
          );
        }
        return { expirations: ["2026-07-17"] };
      },
      async markOptionability(input: Record<string, unknown>) {
        writes.push(input);
      },
      timeoutMs: 321,
      async wait() {
        throw new Error("zero delay should not wait");
      },
      now: () => new Date("2026-07-15T00:00:00.000Z"),
    } as never,
  );

  assert.equal(summary.dryRun, true);
  assert.equal(summary.verified, 1);
  assert.equal(summary.errors, 1);
  assert.equal(writes.length, 0);
  assert.equal(fetchInputs.length, 2);
  assert.ok(
    fetchInputs.every(
      (input) =>
        input["foregroundWaitMs"] === 321 && input["timeoutMs"] === 321,
    ),
  );
  assert.doesNotMatch(
    summary.sample[1]?.reason ?? "",
    /secret|[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.ok((summary.sample[1]?.reason?.length ?? 0) <= 400);
});

test("execution persists a classified result", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const summary = await optionability.runVerification(
    optionability.parseOptions([
      "--execute",
      "--watchlists=false",
      "--delay-ms=0",
    ]),
    {
      async loadWatchlistSymbols() {
        return [];
      },
      async loadCandidates() {
        return [{ symbol: "IWM", market: "etf", listingKey: "etf:IWM" }];
      },
      async fetchExpirations() {
        return { expirations: [] };
      },
      async markOptionability(input: Record<string, unknown>) {
        writes.push(input);
      },
      timeoutMs: 321,
      async wait() {},
      now: () => new Date("2026-07-15T00:00:00.000Z"),
    } as never,
  );

  assert.equal(summary.dryRun, false);
  assert.equal(summary.rejected, 1);
  assert.deepEqual(writes, [
    {
      symbol: "IWM",
      market: "etf",
      listingKey: "etf:IWM",
      status: "rejected",
      reason: "no_option_expirations",
      verifiedAt: new Date("2026-07-15T00:00:00.000Z"),
      source: "option_expirations_probe",
    },
  ]);
});
