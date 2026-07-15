import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

type Config = {
  start: string;
  end: string;
  maxEventsPerScope: number;
  coreSymbols: string[];
};

type AnalysisInternals = {
  readConfig(argv?: string[], env?: NodeJS.ProcessEnv): Config;
  buildGexOptionIndex(
    rows: Array<Record<string, unknown>>,
  ): Map<
    string,
    Array<{ computedAtMs: number; strike: number; localStep: number }>
  >;
  censusCapWarning(
    rows: Array<Record<string, unknown>>,
    limit: number,
  ): string | null;
  eventQueryParameters(config: Config): [Date, Date, number];
  finiteNumber(value: unknown): number | null;
  nearestGexMatchMs(input: Record<string, unknown>): number | null;
};

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

const scriptPath = resolve(
  import.meta.dirname,
  "signal-options-gex-match-rate-analysis.ts",
);

const previousDatabaseEnv = Object.fromEntries(
  DATABASE_ENV_NAMES.map((name) => [name, process.env[name]]),
);
for (const name of DATABASE_ENV_NAMES) delete process.env[name];
const analysisModule = (await import(
  "./signal-options-gex-match-rate-analysis"
)) as {
  __signalOptionsGexMatchRateAnalysisInternalsForTests?: AnalysisInternals;
};
for (const [name, value] of Object.entries(previousDatabaseEnv)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function requireInternals(): AnalysisInternals {
  const internals =
    analysisModule.__signalOptionsGexMatchRateAnalysisInternalsForTests;
  assert.ok(internals, "expected focused GEX analysis internals");
  return internals;
}

function runCli(args: string[]) {
  const env = { ...process.env };
  for (const name of DATABASE_ENV_NAMES) delete env[name];
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
}

test("CLI scope is canonical and rejects ambiguous input", () => {
  const analysis = requireInternals();
  assert.deepEqual(
    analysis.readConfig(
      [
        "--start=2026-06-01",
        "--end=2026-07-01",
        "--max-events-per-scope=2500",
        "--core-symbols=spy, qqq",
      ],
      {},
    ),
    {
      start: "2026-06-01",
      end: "2026-07-01",
      maxEventsPerScope: 2_500,
      coreSymbols: ["SPY", "QQQ"],
    },
  );

  for (const args of [
    ["--unknown=true"],
    ["--start=2026-06-01", "--start=2026-06-02"],
    ["--start=2026-02-30"],
    ["--start=2026-07-01", "--end=2026-07-01"],
    ["--max-events-per-scope=1e3"],
    ["--max-events-per-scope=0x10"],
    ["--max-events-per-scope=2.5"],
    ["--max-events-per-scope=200001"],
    ["--core-symbols="],
    ["positional"],
  ]) {
    assert.throws(() => analysis.readConfig(args, {}), /Usage:/u);
  }
});

test("invalid CLI input fails before database work without exposing a stack", () => {
  const result = runCli(["--unknown=true"]);

  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /Usage:/u);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|127\.0\.0\.1|\n\s+at /u);
});

test("the timed-out full-window SQL implementations stay retired", () => {
  const source = readFileSync(scriptPath, "utf8");

  assert.doesNotMatch(source, /async function loadMatchRates\(/u);
  assert.doesNotMatch(source, /async function loadSmokeSuggestions\(/u);
  assert.doesNotMatch(source, /strike'\)::double precision as strike/u);
});

test("database event bounds are explicit UTC instants", () => {
  const [start, end, limit] = requireInternals().eventQueryParameters({
    start: "2026-06-01",
    end: "2026-07-01",
    maxEventsPerScope: 2_500,
    coreSymbols: ["SPY"],
  });

  assert.equal(start.toISOString(), "2026-06-01T00:00:00.000Z");
  assert.equal(end.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(limit, 2_500);
});

test("match index keeps only rows usable by the historical Greek adapter", () => {
  const analysis = requireInternals();
  const computedAt = "2026-06-09T18:50:23.056Z";
  const base = {
    symbol: "AAPL",
    computed_at: computedAt,
    expiration_date: "2026-06-12",
    cp: "C",
    delta: "0.45",
    gamma: "0.02",
    theta: "-0.1",
    vega: "0.2",
    implied_vol: "0.3",
  };
  const index = analysis.buildGexOptionIndex([
    { ...base, strike: "100" },
    { ...base, strike: "105" },
    { ...base, strike: "110", theta: null },
    { ...base, strike: "115", implied_vol: "0" },
    { ...base, strike: "9".repeat(400) },
  ]);
  const rows = index.get("AAPL|2026-06-12|C") ?? [];

  assert.deepEqual(
    rows.map((row) => row.strike),
    [100, 105],
  );
  assert.equal(analysis.finiteNumber("9".repeat(400)), null);
  assert.equal(
    analysis.nearestGexMatchMs({
      event: {
        event_scope: "entry",
        id: "event-1",
        symbol: "AAPL",
        occurred_at: "2026-06-09T18:42:23.056Z",
        expiration_date: "2026-06-12",
        strike: "104",
        cp: "C",
      },
      eventTimeMs: new Date("2026-06-09T18:42:23.056Z").getTime(),
      optionsByKey: index,
      toleranceMs: 15 * 60_000,
      exactStrikeOnly: false,
    }),
    8 * 60_000,
  );
});

test("unusable Greek rows still define the listed strike step", () => {
  const analysis = requireInternals();
  const computedAt = "2026-06-09T18:50:23.056Z";
  const base = {
    symbol: "AAPL",
    computed_at: computedAt,
    expiration_date: "2026-06-12",
    cp: "C",
    delta: "0.45",
    gamma: "0.02",
    theta: "-0.1",
    vega: "0.2",
    implied_vol: "0.3",
  };
  const index = analysis.buildGexOptionIndex([
    { ...base, strike: "100" },
    ...Array.from({ length: 9 }, (_, offset) => ({
      ...base,
      strike: String(101 + offset),
      theta: null,
    })),
    { ...base, strike: "110" },
  ]);

  assert.equal(
    analysis.nearestGexMatchMs({
      event: {
        event_scope: "entry",
        id: "event-1",
        symbol: "AAPL",
        occurred_at: computedAt,
        expiration_date: "2026-06-12",
        strike: "105",
        cp: "C",
      },
      eventTimeMs: new Date(computedAt).getTime(),
      optionsByKey: index,
      toleranceMs: 15 * 60_000,
      exactStrikeOnly: false,
    }),
    null,
  );
});

test("census warns when a per-scope analysis cap may truncate totals", () => {
  const analysis = requireInternals();
  assert.equal(
    analysis.censusCapWarning(
      [{ event_scope: "entry", total_events: 999 }],
      1_000,
    ),
    null,
  );
  assert.match(
    analysis.censusCapWarning(
      [{ event_scope: "entry", total_events: 1_000 }],
      1_000,
    ) ?? "",
    /cap|truncat/iu,
  );
});
