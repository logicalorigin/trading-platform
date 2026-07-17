import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { db, universeCatalogSyncStatesTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";
import { claimUniverseCatalogWriterFence } from "../../artifacts/api-server/src/services/universe-catalog-writer-fence";
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

test("catalog diagnostics reject opaque credentials", () => {
  const opaqueCredential = `eyJ${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}`;
  assert.doesNotMatch(
    catalog.safeDiagnostic(
      new Error(`provider rejected credential ${opaqueCredential}`),
    ),
    new RegExp(opaqueCredential, "u"),
  );
});

test("catalog diagnostics redact percent-encoded credential query names", () => {
  const credential = "percent-encoded-catalog-secret";
  const diagnostic = catalog.safeDiagnostic(
    new Error(
      `provider rejected https://provider.invalid/tickers?access%5Ftoken=${credential}&cursor=keep`,
    ),
  );

  assert.doesNotMatch(diagnostic, new RegExp(credential, "u"));
});

test("catalog diagnostics reject standalone named credentials", () => {
  const credential = "short-catalog-secret";
  assert.equal(
    catalog.safeDiagnostic(
      new Error(`provider rejected access_token=${credential}`),
    ),
    "Unknown universe-catalog sync error",
  );
  assert.equal(
    catalog.safeDiagnostic(
      new Error('provider rejected {"access_token":"short-json-secret"}'),
    ),
    "Unknown universe-catalog sync error",
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

function advisoryLease(
  controller = new AbortController(),
  release: () => Promise<void> = async () => {},
  fenceToken = "1",
) {
  return Object.assign(release, { signal: controller.signal, fenceToken });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    acquireLock: async () => advisoryLease(),
    claimWriterFence: async () => {},
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
        return advisoryLease();
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
        return advisoryLease(new AbortController(), async () => {
          calls.push("release");
        });
      },
      claimWriterFence: async (fenceToken: string) => {
        calls.push(`claim:${fenceToken}`);
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
      upsertRows: async (_rows: unknown, writerFenceToken: string) => {
        assert.equal(writerFenceToken, "1");
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
    "claim:1",
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
  assert.equal(
    states.every((state) => state.fenceToken === "1"),
    true,
  );
  assert.doesNotMatch(JSON.stringify(states), /secret|apiKey/iu);
});

test("lease loss after a page write preserves the last durable checkpoint", async () => {
  const controller = new AbortController();
  const leaseLost = new Error("catalog lease lost");
  const calls: string[] = [];
  const states: Array<Record<string, unknown>> = [];

  await assert.rejects(
    catalog.runSync(
      catalog.parseOptions(["--execute", "--markets=stocks"]),
      dependencies({
        acquireLock: async () =>
          advisoryLease(controller, async () => {
            calls.push("release");
          }),
        readState: async () => {
          calls.push("read");
          return null;
        },
        listPage: async (input: { signal: AbortSignal }) => {
          calls.push("list");
          assert.equal(input.signal.aborted, false);
          return {
            count: 1,
            results: [ticker("AAPL")],
            nextUrl:
              "https://provider.invalid/v3/reference/tickers?cursor=second",
          };
        },
        upsertRows: async () => {
          calls.push("upsert");
          controller.abort(leaseLost);
        },
        writeState: async (state: Record<string, unknown>) => {
          calls.push("write");
          states.push(state);
        },
      }),
    ),
    (error) => error === leaseLost,
  );

  assert.deepEqual(calls, ["read", "write", "list", "upsert", "release"]);
  assert.equal(states.length, 1);
  assert.equal(states[0]?.pagesSynced, 0);
  assert.equal(states[0]?.lastError, null);
});

test("resume rejects legacy unfinished progress with no cursor", async () => {
  const calls: string[] = [];
  await assert.rejects(
    catalog.runSync(
      catalog.parseOptions(["--execute", "--markets=stocks"]),
      dependencies({
        readState: async () => {
          calls.push("read");
          return {
            cursor: null,
            lastProcessedListingKey: "PRIOR|stocks|XNAS",
            pagesSynced: 5,
            rowsSynced: 500,
            startedAt: new Date("2026-07-14T19:00:00.000Z"),
            finishedAt: null,
            lastSuccessAt: new Date("2026-07-14T19:59:00.000Z"),
            metadata: { failed: true },
          };
        },
        listPage: async () => {
          calls.push("list");
          return { count: 0, results: [], nextUrl: null };
        },
        upsertRows: async () => {
          calls.push("upsert");
        },
        writeState: async () => {
          calls.push("write");
        },
      }),
    ),
    /--reset/u,
  );
  assert.deepEqual(calls, ["read"]);
});

test("a final-page checkpoint resumes as complete after immediate lease loss", async () => {
  const leaseLost = new Error("catalog lease lost after final checkpoint");
  let currentController: AbortController | null = null;
  let durableState: Record<string, unknown> | null = null;
  let interrupted = false;
  let pageCalls = 0;
  let upserts = 0;
  const runDependencies = dependencies({
    acquireLock: async () => {
      currentController = new AbortController();
      return advisoryLease(currentController);
    },
    listPage: async () => {
      pageCalls += 1;
      return {
        count: 1,
        results: [ticker("AAPL")],
        nextUrl: null,
      };
    },
    readState: async () => durableState,
    upsertRows: async () => {
      upserts += 1;
    },
    writeState: async (state: Record<string, unknown>) => {
      durableState = state;
      if (
        !interrupted &&
        state.pagesSynced === 1 &&
        (state.metadata as Record<string, unknown> | undefined)
          ?.lastPageCount === 1
      ) {
        interrupted = true;
        currentController?.abort(leaseLost);
      }
    },
  });
  const options = catalog.parseOptions(["--execute", "--markets=stocks"]);

  await assert.rejects(
    catalog.runSync(options, runDependencies),
    (error) => error === leaseLost,
  );
  const resumed = await catalog.runSync(options, runDependencies);

  assert.equal(pageCalls, 1);
  assert.equal(upserts, 1);
  assert.deepEqual(resumed, [
    {
      market: "stocks",
      complete: true,
      pages: 1,
      rows: 1,
      sampleListingKeys: [],
    },
  ]);
});

test("a committed terminal checkpoint cannot be downgraded by its failure handler", async () => {
  await withTestDb(async () => {
    const checkpointFailure = new Error(
      "catalog terminal checkpoint acknowledged late",
    );
    let throwAfterTerminalCommit = true;
    let pageCalls = 0;
    const readState = async (scopeKey: string) => {
      const [state] = await db
        .select()
        .from(universeCatalogSyncStatesTable)
        .where(eq(universeCatalogSyncStatesTable.scopeKey, scopeKey));
      return state ?? null;
    };
    const runDependencies = dependencies({
      acquireLock: async () =>
        advisoryLease(new AbortController(), async () => {}, "40"),
      claimWriterFence: (fenceToken: string) =>
        claimUniverseCatalogWriterFence({ fenceToken }),
      listPage: async () => {
        pageCalls += 1;
        return {
          count: 1,
          results: [ticker("AAPL")],
          nextUrl: null,
        };
      },
      readState,
      writeState: async (
        state: Parameters<typeof catalog.writeSyncState>[0],
      ) => {
        await catalog.writeSyncState(state);
        if (throwAfterTerminalCommit && state.finishedAt) {
          throwAfterTerminalCommit = false;
          throw checkpointFailure;
        }
      },
    });
    const options = catalog.parseOptions(["--execute", "--markets=stocks"]);

    await assert.rejects(
      catalog.runSync(options, runDependencies),
      (error) => error === checkpointFailure,
    );
    const persisted = await readState("catalog:stocks:active");
    assert.equal(persisted?.cursor, null);
    assert.equal(persisted?.finishedAt instanceof Date, true);
    assert.equal(persisted?.pagesSynced, 1);
    assert.equal(persisted?.rowsSynced, 1);

    const resumed = await catalog.runSync(options, runDependencies);

    assert.equal(pageCalls, 1);
    assert.deepEqual(resumed, [
      {
        market: "stocks",
        complete: true,
        pages: 1,
        rows: 1,
        sampleListingKeys: [],
      },
    ]);
  });
});

test("a failed final-page checkpoint resumes from the last durable cursor", async () => {
  const finalCursor =
    "https://provider.invalid/v3/reference/tickers?cursor=final";
  const checkpointFailure = new Error("final-page checkpoint failed");
  let durableState: Record<string, unknown> | null = {
    cursor: finalCursor,
    lastProcessedListingKey: "PRIOR|stocks|XNAS",
    pagesSynced: 5,
    rowsSynced: 5,
    startedAt: new Date("2026-07-14T19:00:00.000Z"),
    finishedAt: null,
    lastSuccessAt: new Date("2026-07-14T19:59:00.000Z"),
    metadata: {},
  };
  let failedOnce = false;
  let terminalCheckpointAttempts = 0;
  const cursorInputs: Array<string | null> = [];
  let upserts = 0;
  const runDependencies = dependencies({
    listPage: async (input: { cursorUrl: string | null }) => {
      cursorInputs.push(input.cursorUrl);
      return {
        count: 1,
        results: [ticker("AAPL")],
        nextUrl: null,
      };
    },
    readState: async () => durableState,
    upsertRows: async () => {
      upserts += 1;
    },
    writeState: async (state: Record<string, unknown>) => {
      if (state.cursor === null && state.finishedAt) {
        terminalCheckpointAttempts += 1;
        if (!failedOnce) {
          failedOnce = true;
          throw checkpointFailure;
        }
      }
      durableState = state;
    },
  });
  const options = catalog.parseOptions(["--execute", "--markets=stocks"]);

  await assert.rejects(
    catalog.runSync(options, runDependencies),
    (error) => error === checkpointFailure,
  );
  const resumed = await catalog.runSync(options, runDependencies);

  assert.deepEqual(cursorInputs, [finalCursor, finalCursor]);
  assert.equal(upserts, 2);
  assert.equal(terminalCheckpointAttempts, 2);
  assert.deepEqual(resumed, [
    {
      market: "stocks",
      complete: true,
      pages: 6,
      rows: 6,
      sampleListingKeys: ["AAPL|stocks|XNAS"],
    },
  ]);
});

test("a failed empty-page checkpoint preserves its resumable cursor", async () => {
  const finalCursor =
    "https://provider.invalid/v3/reference/tickers?cursor=empty";
  const checkpointFailure = new Error("empty-page checkpoint failed");
  let durableState: Record<string, unknown> | null = {
    cursor: finalCursor,
    lastProcessedListingKey: "PRIOR|stocks|XNAS",
    pagesSynced: 5,
    rowsSynced: 5,
    startedAt: new Date("2026-07-14T19:00:00.000Z"),
    finishedAt: null,
    lastSuccessAt: new Date("2026-07-14T19:59:00.000Z"),
    metadata: {},
  };
  let failedOnce = false;
  const cursorInputs: Array<string | null> = [];
  const runDependencies = dependencies({
    listPage: async (input: { cursorUrl: string | null }) => {
      cursorInputs.push(input.cursorUrl);
      return { count: 0, results: [], nextUrl: null };
    },
    readState: async () => durableState,
    writeState: async (state: Record<string, unknown>) => {
      if (!failedOnce && state.cursor === null && state.finishedAt) {
        failedOnce = true;
        throw checkpointFailure;
      }
      durableState = state;
    },
  });
  const options = catalog.parseOptions(["--execute", "--markets=stocks"]);

  await assert.rejects(
    catalog.runSync(options, runDependencies),
    (error) => error === checkpointFailure,
  );
  const resumed = await catalog.runSync(options, runDependencies);

  assert.deepEqual(cursorInputs, [finalCursor, finalCursor]);
  assert.deepEqual(resumed, [
    {
      market: "stocks",
      complete: true,
      pages: 5,
      rows: 5,
      sampleListingKeys: [],
    },
  ]);
});

test("a stale catalog owner cannot overwrite a successor checkpoint", async () => {
  await withTestDb(async () => {
    const scopeKey = "catalog:stocks:fence-test";
    const startedAt = new Date("2026-07-16T18:00:00.000Z");
    await claimUniverseCatalogWriterFence({ fenceToken: "10" });
    await catalog.writeSyncState({
      scopeKey,
      market: "stocks",
      activeOnly: true,
      cursor: "cursor-a",
      lastProcessedListingKey: "AAPL|stocks|XNAS",
      pagesSynced: 1,
      rowsSynced: 1_000,
      startedAt,
      finishedAt: null,
      lastSuccessAt: startedAt,
      lastError: null,
      metadata: { owner: "a" },
      fenceToken: "10",
    });
    const successorFinishedAt = new Date("2026-07-16T18:05:00.000Z");
    await claimUniverseCatalogWriterFence({ fenceToken: "11" });
    await catalog.writeSyncState({
      scopeKey,
      market: "stocks",
      activeOnly: true,
      cursor: null,
      lastProcessedListingKey: "MSFT|stocks|XNAS",
      pagesSynced: 2,
      rowsSynced: 2_000,
      startedAt,
      finishedAt: successorFinishedAt,
      lastSuccessAt: successorFinishedAt,
      lastError: null,
      metadata: { owner: "b" },
      fenceToken: "11",
    });

    await assert.rejects(
      catalog.writeSyncState({
        scopeKey,
        market: "stocks",
        activeOnly: true,
        cursor: "cursor-a",
        lastProcessedListingKey: "AAPL|stocks|XNAS",
        pagesSynced: 1,
        rowsSynced: 1_000,
        startedAt,
        finishedAt: null,
        lastSuccessAt: startedAt,
        lastError: null,
        metadata: { owner: "a-late" },
        fenceToken: "10",
      }),
      /superseded/iu,
    );

    const [persisted] = await db
      .select()
      .from(universeCatalogSyncStatesTable)
      .where(eq(universeCatalogSyncStatesTable.scopeKey, scopeKey));
    assert.equal(persisted?.cursor, null);
    assert.equal(persisted?.pagesSynced, 2);
    assert.equal(persisted?.rowsSynced, 2_000);
    assert.equal(
      persisted?.finishedAt?.toISOString(),
      successorFinishedAt.toISOString(),
    );
    assert.deepEqual(persisted?.metadata, {
      owner: "b",
      leaseFenceToken: "11",
    });
  });
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
  assert.equal(
    catalog.cursorDigest(
      catalog.sanitizeCursorUrl(
        "https://provider.invalid/v3/reference/tickers?z=%41&a=2",
        "https://provider.invalid",
      ) as string,
    ),
    catalog.cursorDigest(
      catalog.sanitizeCursorUrl(
        "https://provider.invalid/v3/reference/tickers?a=2&z=A",
        "https://provider.invalid",
      ) as string,
    ),
  );
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

test("execute rejects a repeated cursor before persisting a duplicate page", async () => {
  const repeatedCursor =
    "https://provider.invalid/v3/reference/tickers?cursor=repeat";
  let pageCalls = 0;
  let upserts = 0;

  await assert.rejects(
    catalog.runSync(
      catalog.parseOptions(["--execute", "--markets=stocks", "--max-pages=3"]),
      dependencies({
        listPage: async () => {
          pageCalls += 1;
          return {
            count: 1,
            results: [ticker("AAPL")],
            nextUrl: repeatedCursor,
          };
        },
        upsertRows: async () => {
          upserts += 1;
        },
      }),
    ),
    /cursor did not advance/iu,
  );

  assert.equal(pageCalls, 2);
  assert.equal(upserts, 1);
});

test("execute carries cursor-cycle detection across bounded resumes", async () => {
  const cursorA = "https://provider.invalid/v3/reference/tickers?cursor=a";
  const cursorB = "https://provider.invalid/v3/reference/tickers?cursor=b";
  const expectedInputs = [null, cursorA, cursorB, cursorA];
  const nextCursors = [cursorA, cursorB, cursorA, cursorB];
  let durableState: Record<string, unknown> | null = null;
  let pageCalls = 0;
  let upserts = 0;
  const runDependencies = dependencies({
    listPage: async (input: { cursorUrl: string | null }) => {
      assert.equal(input.cursorUrl, expectedInputs[pageCalls]);
      const nextUrl = nextCursors[pageCalls];
      pageCalls += 1;
      return {
        count: 1,
        results: [ticker(`PAGE${pageCalls}`)],
        nextUrl,
      };
    },
    readState: async () => durableState,
    upsertRows: async () => {
      upserts += 1;
    },
    writeState: async (state: Record<string, unknown>) => {
      durableState = state;
    },
  });
  const options = catalog.parseOptions([
    "--execute",
    "--markets=stocks",
    "--max-pages=1",
  ]);

  await catalog.runSync(options, runDependencies);
  await catalog.runSync(options, runDependencies);
  await assert.rejects(
    catalog.runSync(options, runDependencies),
    /cursor did not advance/iu,
  );

  assert.equal(pageCalls, 3);
  assert.equal(upserts, 2);
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
        acquireLock: async () =>
          advisoryLease(new AbortController(), async () => {
            throw new Error("lock release also failed");
          }),
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
