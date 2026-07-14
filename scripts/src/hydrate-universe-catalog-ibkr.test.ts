import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { and } from "drizzle-orm";
import { db } from "@workspace/db";
import { universeCatalogListingsTable } from "@workspace/db/schema";
import { __hydrateUniverseCatalogIbkrInternalsForTests as hydrateCli } from "./hydrate-universe-catalog-ibkr";

const ISOLATED_DATABASE_ENV = {
  DATABASE_URL:
    "postgresql://hydrate-test:unused@127.0.0.1:1/hydrate-test?connect_timeout=1",
  LOCAL_DATABASE_URL: "",
  PGDATABASE: "",
  PGHOST: "",
  PGPASSWORD: "",
  PGPORT: "",
  PGUSER: "",
  PYRUS_DATABASE_SOURCE: "database_url",
};

test("CLI defaults to a bounded preview and requires explicit execution", () => {
  assert.deepEqual(hydrateCli.parseHydrationArgs([]), {
    execute: false,
    activeOnly: true,
    resume: true,
    reset: false,
    force: false,
    mode: "priority-then-broad",
    priorityLanes: [
      "symbols",
      "watchlists",
      "sp500",
      "nasdaq_listed",
      "other_listed",
    ],
    explicitSymbols: [],
    batchSize: 50,
    maxRowsPerMarket: 100,
    markets: ["stocks", "etf", "otc"],
  });
  assert.deepEqual(
    hydrateCli.parseHydrationArgs([
      "--",
      "--execute",
      "--active=false",
      "--resume=false",
      "--reset=true",
      "--force=true",
      "--mode=priority",
      "--priority=symbols,watchlists,sp500",
      "--symbols=spy,brk-b",
      "--batch=25",
      "--limit=500",
      "--markets=stocks,etf",
    ]),
    {
      execute: true,
      activeOnly: false,
      resume: false,
      reset: true,
      force: true,
      mode: "priority",
      priorityLanes: ["symbols", "watchlists", "sp500"],
      explicitSymbols: ["SPY", "BRK.B"],
      batchSize: 25,
      maxRowsPerMarket: 500,
      markets: ["stocks", "etf"],
    },
  );
  assert.equal(
    hydrateCli.parseHydrationArgs(["--execute"]).maxRowsPerMarket,
    1_000_000,
  );
  assert.deepEqual(
    hydrateCli.parseHydrationArgs(["--mode=broad"]).priorityLanes,
    [],
  );
});

test("CLI rejects ambiguous or malformed execution scope", () => {
  for (const args of [
    ["--dry-run"],
    ["--dry-run=false"],
    ["--execute", "--execute"],
    ["--execute=true"],
    ["--execute=false"],
    ["--active=yes"],
    ["--mode=everything"],
    ["--mode=broad", "--symbols=SPY"],
    ["--mode=broad", "--priority=sp500"],
    ["--priority=watchlists", "--priority-lanes=sp500"],
    ["--mode=priority", "--priority=watchlists", "--symbols=SPY"],
    ["--symbols="],
    ["--symbols=AAPL,,MSFT"],
    ["--symbols=AAPL$"],
    ["--batch=1e2"],
    ["--batch=251"],
    ["--limit=2.5"],
    ["--markets=stocks,unknown"],
    ["--unknown=true"],
    ["hydrate"],
  ]) {
    assert.throws(() => hydrateCli.parseHydrationArgs(args), /Usage:/);
  }
});

test("broad progress advances only after hydration and its checkpoint succeed", async () => {
  const progress = Object.freeze({
    processedThisMarket: 4,
    phaseProcessedRows: 2,
    totalProcessedRows: 12,
    lastProcessedListingKey: "AAPL|stocks|XNAS",
  });
  const row = {
    listingKey: "MSFT|stocks|XNAS",
    symbol: "MSFT",
    source: "broad",
  };
  let checkpointCalls = 0;

  await assert.rejects(
    hydrateCli.hydrateAndCheckpointRow({
      row,
      phase: "broad",
      progress,
      hydrate: async () => {
        throw new Error("provider unavailable");
      },
      checkpoint: async () => {
        checkpointCalls += 1;
      },
    }),
    /provider unavailable/,
  );
  assert.equal(checkpointCalls, 0);

  await assert.rejects(
    hydrateCli.hydrateAndCheckpointRow({
      row,
      phase: "broad",
      progress,
      hydrate: async () => ({ status: "hydrated" }),
      checkpoint: async () => {
        checkpointCalls += 1;
        throw new Error("checkpoint unavailable");
      },
    }),
    /checkpoint unavailable/,
  );
  assert.equal(checkpointCalls, 1);

  const completed = await hydrateCli.hydrateAndCheckpointRow({
    row,
    phase: "broad",
    progress,
    hydrate: async () => ({ status: "hydrated" }),
    checkpoint: async (nextProgress) => {
      checkpointCalls += 1;
      assert.deepEqual(nextProgress, {
        processedThisMarket: 5,
        phaseProcessedRows: 3,
        totalProcessedRows: 13,
        lastProcessedListingKey: "MSFT|stocks|XNAS",
      });
      return "durable";
    },
  });

  assert.equal(checkpointCalls, 2);
  assert.deepEqual(completed.progress, {
    processedThisMarket: 5,
    phaseProcessedRows: 3,
    totalProcessedRows: 13,
    lastProcessedListingKey: "MSFT|stocks|XNAS",
  });
  assert.equal(completed.checkpoint, "durable");
});

test("CLI diagnostics redact credentials and cannot control the terminal", () => {
  const diagnostic = hydrateCli.safeDiagnostic(
    new Error(
      `postgresql://operator:super-secret@db.example/pyrus \u001b[31mline\nnext\u202e${"x".repeat(600)}`,
    ),
  );

  assert.match(diagnostic, /postgresql:\/\/\[redacted\]@db\.example\/pyrus/);
  assert.doesNotMatch(diagnostic, /super-secret/);
  assert.doesNotMatch(
    diagnostic,
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.ok(diagnostic.length <= 400);
});

test("invalid CLI input fails before database work without exposing a stack", () => {
  const scriptPath = resolve(
    import.meta.dirname,
    "hydrate-universe-catalog-ibkr.ts",
  );
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, "--unknown=true"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, ...ISOLATED_DATABASE_ENV },
      timeout: 10_000,
    },
  );

  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /Usage:/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|127\.0\.0\.1|\n\s+at /);
});

test("large same-run exclusion sets use one PostgreSQL array parameter", () => {
  const listingKeys = Array.from(
    { length: 10_000 },
    (_, index) => `symbol-${index}|stocks|XNAS`,
  );
  const query = db
    .select({ listingKey: universeCatalogListingsTable.listingKey })
    .from(universeCatalogListingsTable)
    .where(
      and(
        ...hydrateCli.listingHydrationFilters({
          market: "stocks",
          activeOnly: true,
          force: false,
          excludeListingKeys: listingKeys,
        }),
      ),
    )
    .toSQL();

  assert.equal(query.params.length, 4);
  assert.deepEqual(query.params.at(-1), listingKeys);
  assert.match(query.sql, /<> all\(\$4::text\[\]\)/);
});

test("large explicit symbol sets use one PostgreSQL array parameter", () => {
  const symbols = Array.from({ length: 65_536 }, (_, index) => `SYM${index}`);
  const query = db
    .select({ listingKey: universeCatalogListingsTable.listingKey })
    .from(universeCatalogListingsTable)
    .where(hydrateCli.prioritySymbolFilter(symbols))
    .toSQL();

  assert.equal(query.params.length, 1);
  assert.deepEqual(query.params[0], symbols);
  assert.match(query.sql, /= any\(\$1::text\[\]\)/);
});

test("importing the IBKR catalog hydrator does not run database or provider work", () => {
  const moduleUrl = pathToFileURL(
    resolve(import.meta.dirname, "hydrate-universe-catalog-ibkr.ts"),
  ).href;
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
      env: {
        ...process.env,
        ...ISOLATED_DATABASE_ENV,
      },
      timeout: 10_000,
    },
  );

  assert.equal(
    imported.status,
    0,
    `import unexpectedly ran the hydrator:\n${imported.stdout}${imported.stderr}`,
  );
});
