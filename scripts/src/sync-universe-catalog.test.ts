import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { __syncUniverseCatalogInternalsForTests as catalog } from "./sync-universe-catalog";

const scriptPath = resolve(import.meta.dirname, "sync-universe-catalog.ts");
const scriptsRoot = resolve(import.meta.dirname, "..");
const ISOLATED_ENV = {
  DATABASE_URL:
    "postgresql://catalog-sync-test:unused@127.0.0.1:1/catalog-sync-test?connect_timeout=1",
  LOCAL_DATABASE_URL: "",
  MASSIVE_API_BASE_URL: "https://provider.invalid",
  MASSIVE_API_KEY: "test-api-key",
  PGDATABASE: "",
  PGHOST: "",
  PGPASSWORD: "",
  PGPORT: "",
  PGUSER: "",
  PYRUS_DATABASE_SOURCE: "database_url",
};
const FETCH_TRAP_URL = `data:text/javascript,${encodeURIComponent(
  'globalThis.fetch = async () => { throw new Error("provider boundary reached"); };',
)}`;

test("importing the catalog sync performs no database or provider work", () => {
  const moduleUrl = pathToFileURL(scriptPath).href;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      FETCH_TRAP_URL,
      "--eval",
      `import(${JSON.stringify(moduleUrl)}).then(() => console.log("imported"))`,
    ],
    {
      cwd: scriptsRoot,
      encoding: "utf8",
      env: { ...process.env, ...ISOLATED_ENV },
      timeout: 10_000,
    },
  );

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.stdout.trim(), "imported");
  assert.doesNotMatch(
    result.stderr,
    /database|provider boundary|ECONNREFUSED/iu,
  );
});

test("CLI is strict, preview-first, and requires bare execute authority", () => {
  assert.deepEqual(catalog.parseOptions([]), {
    execute: false,
    activeOnly: true,
    resume: true,
    reset: false,
    markets: ["stocks", "etf", "otc"],
    pageLimit: 100,
    maxPages: 1,
    help: false,
  });
  assert.deepEqual(
    catalog.parseOptions([
      "--",
      "--execute",
      "--active=false",
      "--resume=false",
      "--reset=true",
      "--markets=indices,stocks,indices",
      "--limit=250",
      "--max-pages=3",
    ]),
    {
      execute: true,
      activeOnly: false,
      resume: false,
      reset: true,
      markets: ["indices", "stocks"],
      pageLimit: 250,
      maxPages: 3,
      help: false,
    },
  );
  assert.equal(catalog.parseOptions(["--help"]).help, true);
  assert.equal(catalog.parseOptions(["-h"]).help, true);

  for (const args of [
    ["--dry-run"],
    ["--execute=false"],
    ["--execute", "--execute"],
    ["--active=yes"],
    ["--resume=false"],
    ["--reset=true"],
    ["--markets="],
    ["--markets=stocks,unknown"],
    ["--limit=0"],
    ["--limit=01"],
    ["--limit=1e2"],
    ["--limit=1001"],
    ["--max-pages=0"],
    ["--max-pages=1.5"],
    ["--unknown=true"],
    ["--help", "--execute"],
    ["sync"],
  ]) {
    assert.throws(() => catalog.parseOptions(args), /Usage:/u);
  }
});

function ticker(symbol: string) {
  return {
    ticker: symbol,
    name: `${symbol} Incorporated`,
    market: "stocks" as const,
    rootSymbol: null,
    normalizedExchangeMic: "XNAS",
    exchangeDisplay: "Nasdaq",
    logoUrl: null,
    countryCode: "US",
    exchangeCountryCode: "US",
    sector: null,
    industry: null,
    contractDescription: null,
    contractMeta: null,
    locale: "us",
    type: "CS",
    active: true,
    primaryExchange: "XNAS",
    currencyName: "usd",
    cik: null,
    compositeFigi: null,
    shareClassFigi: null,
    lastUpdatedAt: null,
    provider: "massive" as const,
    providers: ["massive" as const],
    tradeProvider: null,
    dataProviderPreference: "massive" as const,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    acquireLock: async () => async () => {},
    listPage: async () => ({
      count: 1,
      results: [ticker("AAPL")],
      nextUrl: null,
    }),
    now: () => new Date("2026-07-14T20:00:00.000Z"),
    readState: async () => null,
    sanitizeCursor: (cursor: string | null) => cursor,
    upsertRows: async () => {},
    writeState: async () => {},
    ...overrides,
  };
}

test("preview fetches a bounded sample without acquiring a lock or writing", async () => {
  const calls: string[] = [];
  let requestSignal: AbortSignal | undefined;
  const result = await catalog.runSync(
    catalog.parseOptions(["--markets=stocks"]),
    dependencies({
      acquireLock: async () => {
        calls.push("lock");
        return async () => {};
      },
      listPage: async (input: { signal: AbortSignal }) => {
        calls.push("list");
        requestSignal = input.signal;
        return {
          count: 1,
          results: [ticker("AA\u202ePL")],
          nextUrl:
            "https://provider.invalid/v3/reference/tickers?cursor=next&apiKey=secret",
        };
      },
      readState: async () => {
        calls.push("read");
        return null;
      },
      upsertRows: async () => {
        calls.push("upsert");
      },
      writeState: async () => {
        calls.push("write");
      },
    }),
  );

  assert.deepEqual(calls, ["list"]);
  assert.equal(requestSignal instanceof AbortSignal, true);
  assert.equal(requestSignal?.aborted, false);
  assert.doesNotMatch(JSON.stringify(result), /\u202e/u);
  assert.deepEqual(result, [
    {
      market: "stocks",
      complete: false,
      pages: 1,
      rows: 1,
      sampleListingKeys: ["AA PL|stocks|XNAS"],
    },
  ]);
});

test("execute locks before state/provider work and stores a credential-free cursor", async () => {
  const calls: string[] = [];
  const states: Array<Record<string, unknown>> = [];
  const result = await catalog.runSync(
    catalog.parseOptions(["--execute", "--markets=stocks", "--max-pages=1"]),
    dependencies({
      acquireLock: async () => {
        calls.push("lock");
        return async () => {
          calls.push("release");
        };
      },
      listPage: async () => {
        calls.push("list");
        return {
          count: 1,
          results: [ticker("AA\u202ePL")],
          nextUrl:
            "https://provider.invalid/v3/reference/tickers?cursor=next&apiKey=secret",
        };
      },
      readState: async () => {
        calls.push("read");
        return null;
      },
      sanitizeCursor: (cursor: string | null) =>
        catalog.sanitizeCursorUrl(cursor, "https://provider.invalid"),
      upsertRows: async () => {
        calls.push("upsert");
      },
      writeState: async (state: Record<string, unknown>) => {
        calls.push("write");
        states.push(state);
      },
    }),
  );

  assert.equal(calls[0], "lock");
  assert.deepEqual(calls, [
    "lock",
    "read",
    "write",
    "list",
    "upsert",
    "write",
    "write",
    "release",
  ]);
  assert.equal(result[0]?.complete, false);
  assert.deepEqual(result[0]?.sampleListingKeys, ["AA PL|stocks|XNAS"]);
  assert.equal(
    states.at(-1)?.cursor,
    "https://provider.invalid/v3/reference/tickers?cursor=next",
  );
  assert.doesNotMatch(JSON.stringify(states), /secret|apiKey/iu);
});

test("cursor boundaries reject foreign origins before writes and strip credentials", async () => {
  const sanitized = new URL(
    catalog.sanitizeCursorUrl(
      "https://operator:password@provider.invalid/v3/reference/tickers?cursor=keep&api_key=secret&access-token=secret&token=secret#fragment",
      "https://provider.invalid",
    ) as string,
  );
  assert.equal(sanitized.username, "");
  assert.equal(sanitized.password, "");
  assert.equal(sanitized.hash, "");
  assert.equal(sanitized.searchParams.get("cursor"), "keep");
  assert.deepEqual([...sanitized.searchParams.keys()], ["cursor"]);
  assert.throws(
    () =>
      catalog.sanitizeCursorUrl(
        "https://foreign.invalid/v3/reference/tickers?cursor=next",
        "https://provider.invalid",
      ),
    /origin/u,
  );

  let upserts = 0;
  await assert.rejects(
    catalog.runSync(
      catalog.parseOptions(["--execute", "--markets=stocks"]),
      dependencies({
        listPage: async () => ({
          count: 1,
          results: [ticker("AAPL")],
          nextUrl: "https://foreign.invalid/v3/reference/tickers?cursor=next",
        }),
        sanitizeCursor: (cursor: string | null) =>
          catalog.sanitizeCursorUrl(cursor, "https://provider.invalid"),
        upsertRows: async () => {
          upserts += 1;
        },
      }),
    ),
    /origin/u,
  );
  assert.equal(upserts, 0);
});

test("execute rejects filtered or contradictory pages before row persistence", async () => {
  for (const page of [
    {
      count: 2,
      results: [ticker("AAPL")],
      nextUrl: null,
    },
    {
      count: 0,
      results: [],
      nextUrl:
        "https://provider.invalid/v3/reference/tickers?cursor=contradiction",
    },
  ]) {
    let upserts = 0;
    await assert.rejects(
      catalog.runSync(
        catalog.parseOptions(["--execute", "--markets=stocks"]),
        dependencies({
          listPage: async () => page,
          upsertRows: async () => {
            upserts += 1;
          },
        }),
      ),
      /incomplete|contradictory/u,
    );
    assert.equal(upserts, 0);
  }
});

test("lock contention performs no state or provider work", async () => {
  const calls: string[] = [];
  await assert.rejects(
    catalog.runSync(
      catalog.parseOptions(["--execute"]),
      dependencies({
        acquireLock: async () => {
          calls.push("lock");
          return null;
        },
        listPage: async () => {
          calls.push("list");
          return { count: 0, results: [], nextUrl: null };
        },
        readState: async () => {
          calls.push("read");
          return null;
        },
        writeState: async () => {
          calls.push("write");
        },
      }),
    ),
    /already running/u,
  );
  assert.deepEqual(calls, ["lock"]);
});

test("failure checkpoint and lock cleanup cannot mask the primary error", async () => {
  const providerFailure = new Error(
    "provider failed https://operator:password@provider.invalid/path?apiKey=query-secret&cursor=keep",
  );
  const failureStates: Array<Record<string, unknown>> = [];
  let pages = 0;
  let writes = 0;
  await assert.rejects(
    catalog.runSync(
      catalog.parseOptions(["--execute", "--markets=stocks", "--max-pages=2"]),
      dependencies({
        acquireLock: async () => async () => {
          throw new Error("lock release also failed");
        },
        listPage: async () => {
          pages += 1;
          if (pages === 1) {
            return {
              count: 1,
              results: [ticker("AAPL")],
              nextUrl:
                "https://provider.invalid/v3/reference/tickers?cursor=second",
            };
          }
          throw providerFailure;
        },
        sanitizeCursor: (cursor: string | null) => cursor,
        writeState: async (state: Record<string, unknown>) => {
          writes += 1;
          if (state.lastError) {
            failureStates.push(state);
            throw new Error("failure checkpoint also failed");
          }
        },
      }),
    ),
    (error) => error === providerFailure,
  );

  assert.equal(writes, 3);
  assert.equal(failureStates[0]?.rowsSynced, 1);
  assert.equal(failureStates[0]?.pagesSynced, 1);
  assert.match(String(failureStates[0]?.lastError), /\[redacted\]/u);
  assert.doesNotMatch(
    String(failureStates[0]?.lastError),
    /operator|password|query-secret/iu,
  );
  assert.deepEqual(
    failureStates[0]?.lastSuccessAt,
    new Date("2026-07-14T20:00:00.000Z"),
  );
});
