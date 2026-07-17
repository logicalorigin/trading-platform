import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { asc } from "drizzle-orm";
import { withTestDb } from "@workspace/db/testing";
import {
  universeCatalogSyncStatesTable,
  universeSourceMembershipsTable,
} from "@workspace/db/schema";
import type {
  UniverseMarket,
  UniverseTicker,
} from "../../artifacts/api-server/src/providers/massive/market-data";
import { __syncListedUniverseInternalsForTests as listed } from "./sync-listed-universe";

type DirectorySource = "nasdaq" | "other";
type SourceId = "nasdaq_listed" | "other_listed";
type SourceRow = Parameters<
  typeof listed.syncSourceMemberships
>[0]["rows"][number];
type BuiltRows = Awaited<ReturnType<typeof listed.buildRows>>;
type MembershipSyncInput = Parameters<typeof listed.syncSourceMemberships>[0];

const scriptPath = resolve(import.meta.dirname, "sync-listed-universe.ts");
const scriptsRoot = resolve(import.meta.dirname, "..");
const ISOLATED_DATABASE_ENV = {
  DATABASE_URL:
    "postgresql://listed-universe-test:unused@127.0.0.1:1/listed-universe-test?connect_timeout=1",
  LOCAL_DATABASE_URL: "",
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

function runCli(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", FETCH_TRAP_URL, scriptPath, ...args],
    {
      cwd: scriptsRoot,
      encoding: "utf8",
      env: { ...process.env, ...ISOLATED_DATABASE_ENV },
      timeout: 10_000,
    },
  );
}

function sampleTicker(
  ticker: string,
  market: UniverseMarket = "stocks",
): UniverseTicker {
  return {
    ticker,
    name: `${ticker} Incorporated - Common Stock`,
    market,
    rootSymbol: ticker,
    normalizedExchangeMic: "XNAS",
    exchangeDisplay: "NASDAQ",
    logoUrl: null,
    countryCode: "US",
    exchangeCountryCode: "US",
    sector: null,
    industry: null,
    contractDescription: `${ticker} Incorporated - Common Stock`,
    contractMeta: {},
    locale: "us",
    type: market === "etf" ? "ETF" : "CS",
    active: true,
    primaryExchange: "NASDAQ",
    currencyName: "USD",
    cik: null,
    compositeFigi: null,
    shareClassFigi: null,
    lastUpdatedAt: null,
    provider: null,
    providers: [],
    tradeProvider: null,
    dataProviderPreference: null,
    providerContractId: null,
  };
}

function sourceRow(
  sourceId: SourceId,
  sourceSymbol: string,
  ticker = sourceSymbol,
): SourceRow {
  return {
    sourceId,
    sourceSymbol,
    ticker: sampleTicker(ticker),
    metadata: { fixture: true },
  };
}

function authoritativeBuild(source: DirectorySource = "nasdaq"): BuiltRows {
  const sourceId = source === "nasdaq" ? "nasdaq_listed" : "other_listed";
  return {
    rows: [sourceRow(sourceId, "AAPL")],
    sourceSummaries: {
      [source]: {
        fileCreationTime: "0714202617:00",
        parsedRecords: 1,
        sourceRecords: 1,
        skippedRecords: 0,
        invalidRecords: 0,
        selectedRows: 1,
      },
    },
    activeSourceSymbols: new Map([[sourceId, new Set(["AAPL"])]]),
  };
}

function advisoryLease(
  controller = new AbortController(),
  release: () => Promise<void> = async () => {},
  fenceToken = "1",
) {
  return Object.assign(release, { signal: controller.signal, fenceToken });
}

test("CLI is strict, preview-first, and requires bare --execute", () => {
  assert.deepEqual(listed.parseOptions([]), {
    nasdaqUrl: undefined,
    otherUrl: undefined,
    includeEtfs: true,
    includeTestIssues: false,
    includeNonCommonStock: false,
    normalFinancialStatusOnly: true,
    sources: new Set(["nasdaq", "other"]),
    limit: null,
    execute: false,
    help: false,
  });

  assert.deepEqual(
    listed.parseOptions([
      "--",
      "--execute",
      "--nasdaq-url=https://directory.example/nasdaq.txt",
      "--other-url=http://directory.example/other.txt",
      "--include-etfs=false",
      "--include-test-issues=true",
      "--include-non-common-stock=true",
      "--normal-financial-status-only=false",
      "--sources=other,nasdaq,other",
      "--limit=25",
    ]),
    {
      nasdaqUrl: "https://directory.example/nasdaq.txt",
      otherUrl: "http://directory.example/other.txt",
      includeEtfs: false,
      includeTestIssues: true,
      includeNonCommonStock: true,
      normalFinancialStatusOnly: false,
      sources: new Set(["other", "nasdaq"]),
      limit: 25,
      execute: true,
      help: false,
    },
  );
  assert.equal(listed.parseOptions(["--help"]).help, true);
  assert.equal(listed.parseOptions(["-h"]).help, true);

  for (const args of [
    ["--dry-run"],
    ["--dry-run=false"],
    ["--execute=false"],
    ["--execute", "--execute"],
    ["--include-etfs=yes"],
    ["--sources="],
    ["--sources=nasdaq,unknown"],
    ["--limit=0"],
    ["--limit=01"],
    ["--limit=1.5"],
    ["--nasdaq-url=ftp://directory.example/file.txt"],
    ["--nasdaq-url=https://operator:secret@directory.example/file.txt"],
    ["--other-url=/tmp/other.txt"],
    ["--unknown=true"],
    ["--help", "--execute"],
    ["sync"],
  ]) {
    assert.throws(() => listed.parseOptions(args), /Usage:/u);
  }
});

test("raw evidence validates the file while filters define active membership", async () => {
  const nasdaqDirectory = [
    "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
    "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
    "ETF1|Example Exchange Traded Fund|G|N|N|100|Y|N",
    "WXYZ|Example Warrants|S|N|N|100|N|N",
    "TEST|Test Corp - Common Stock|Q|Y|N|100|N|N",
    "HALT|Halt Corp - Common Stock|Q|N|D|100|N|N",
    "File Creation Time: 0714202617:00",
  ].join("\n");
  const otherDirectory = [
    "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
    "IBM|International Business Machines - Common Stock|N|IBM|N|100|N|IBM",
    "PREF|Example Preferred Shares|N|PREF|N|100|N|PREF",
    "File Creation Time: 0714202617:01",
  ].join("\n");
  const options = listed.parseOptions([]);
  const built = await listed.buildRows(options, {
    fetchNasdaq: async () => nasdaqDirectory,
    fetchOther: async () => otherDirectory,
  });

  assert.deepEqual(
    built.rows.map((row) => row.sourceSymbol),
    ["AAPL", "ETF1", "IBM"],
  );
  assert.deepEqual(
    [...built.activeSourceSymbols.get("nasdaq_listed")!],
    ["AAPL", "ETF1"],
  );
  assert.deepEqual(built.sourceSummaries.nasdaq, {
    fileCreationTime: "0714202617:00",
    parsedRecords: 2,
    sourceRecords: 5,
    skippedRecords: 3,
    invalidRecords: 0,
    selectedRows: 2,
  });
  assert.deepEqual(
    [...built.activeSourceSymbols.get("other_listed")!],
    ["IBM"],
  );
  assert.deepEqual(built.sourceSummaries.other, {
    fileCreationTime: "0714202617:01",
    parsedRecords: 1,
    sourceRecords: 2,
    skippedRecords: 1,
    invalidRecords: 0,
    selectedRows: 1,
  });
  assert.doesNotThrow(() =>
    listed.assertAuthoritativeSourceEvidence(
      built,
      new Set(["nasdaq", "other"]),
    ),
  );
});

test("lease loss between directory sources stops the next fetch", async () => {
  const controller = new AbortController();
  const leaseLost = new Error("listed-universe lease lost");
  const calls: string[] = [];

  await assert.rejects(
    listed.buildRows(
      listed.parseOptions([]),
      {
        fetchNasdaq: async () => {
          calls.push("nasdaq");
          controller.abort(leaseLost);
          return [
            "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
            "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
            "File Creation Time: 0714202617:00",
          ].join("\n");
        },
        fetchOther: async () => {
          calls.push("other");
          return [
            "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
            "IBM|International Business Machines - Common Stock|N|IBM|N|100|N|IBM",
            "File Creation Time: 0714202617:01",
          ].join("\n");
        },
      },
      controller.signal,
    ),
    (error) => error === leaseLost,
  );
  assert.deepEqual(calls, ["nasdaq"]);
});

test("missing trailers and malformed source rows are not authoritative", async () => {
  const missingTrailer = authoritativeBuild();
  missingTrailer.sourceSummaries.nasdaq!.fileCreationTime = null;
  assert.throws(
    () =>
      listed.assertAuthoritativeSourceEvidence(
        missingTrailer,
        new Set(["nasdaq"]),
      ),
    /complete|trailer|authoritative/iu,
  );

  const invalidTrailer = authoritativeBuild();
  invalidTrailer.sourceSummaries.nasdaq!.fileCreationTime = "not-a-time";
  assert.throws(
    () =>
      listed.assertAuthoritativeSourceEvidence(
        invalidTrailer,
        new Set(["nasdaq"]),
      ),
    /invalid|trailer|authoritative/iu,
  );

  const malformed = authoritativeBuild();
  malformed.sourceSummaries.nasdaq!.invalidRecords = 1;
  assert.throws(
    () =>
      listed.assertAuthoritativeSourceEvidence(malformed, new Set(["nasdaq"])),
    /invalid|malformed|authoritative/iu,
  );

  const built = await listed.buildRows(
    listed.parseOptions(["--sources=nasdaq"]),
    {
      fetchNasdaq: async () =>
        [
          "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
          "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
          "BROKEN|||||||",
          "File Creation Time: 0714202617:00",
        ].join("\n"),
      fetchOther: async () => {
        throw new Error("other source should not be fetched");
      },
    },
  );
  assert.equal(built.sourceSummaries.nasdaq?.invalidRecords, 1);
  assert.throws(
    () => listed.assertAuthoritativeSourceEvidence(built, new Set(["nasdaq"])),
    /invalid|malformed|authoritative/iu,
  );
});

test("preview does not acquire a lock or cross a write boundary", async () => {
  const calls: string[] = [];
  const result = await listed.runSync(
    listed.parseOptions(["--sources=nasdaq"]),
    {
      acquireLock: async () => {
        calls.push("lock");
        return advisoryLease();
      },
      claimWriterFence: async (fenceToken) => {
        calls.push(`claim:${fenceToken}`);
      },
      buildRows: async () => {
        calls.push("build");
        return authoritativeBuild();
      },
      upsertCatalog: async () => {
        calls.push("catalog");
      },
      syncMemberships: async () => {
        calls.push("memberships");
        return {
          upsertedRows: 1,
          deactivatedRows: 0,
          deactivatedBySource: {},
        };
      },
    },
  );

  assert.deepEqual(calls, ["build"]);
  assert.deepEqual(result, {
    built: authoritativeBuild(),
    catalogRowsUpserted: 0,
    membershipRowsUpserted: 0,
    deactivatedRows: 0,
    deactivatedBySource: {},
    reconciledSourceIds: [],
  });
});

test("complete execution reconciles; limited execution remains additive", async () => {
  for (const input of [
    { args: ["--execute", "--sources=nasdaq"], expectedReconcile: true },
    {
      args: ["--execute", "--sources=nasdaq", "--limit=1"],
      expectedReconcile: false,
    },
  ]) {
    const calls: string[] = [];
    let membershipInput: MembershipSyncInput | undefined;
    const result = await listed.runSync(listed.parseOptions(input.args), {
      acquireLock: async () => {
        calls.push("lock");
        return advisoryLease(new AbortController(), async () => {
          calls.push("release");
        });
      },
      claimWriterFence: async (fenceToken) => {
        calls.push(`claim:${fenceToken}`);
      },
      buildRows: async () => {
        calls.push("build");
        return authoritativeBuild();
      },
      upsertCatalog: async () => {
        calls.push("catalog");
      },
      syncMemberships: async (value) => {
        calls.push("memberships");
        membershipInput = value;
        return {
          upsertedRows: 1,
          deactivatedRows: input.expectedReconcile ? 2 : 0,
          deactivatedBySource: input.expectedReconcile
            ? { nasdaq_listed: 2 }
            : {},
        };
      },
    });

    assert.deepEqual(calls, [
      "lock",
      "claim:1",
      "build",
      "catalog",
      "memberships",
      "release",
    ]);
    assert.deepEqual(
      membershipInput?.reconcileSourceIds,
      input.expectedReconcile ? ["nasdaq_listed"] : [],
    );
    assert.deepEqual(
      result.reconciledSourceIds,
      input.expectedReconcile ? ["nasdaq_listed"] : [],
    );
    assert.equal(result.catalogRowsUpserted, 1);
    assert.equal(result.membershipRowsUpserted, 1);
  }
});

test("execution fails closed before writes and always releases its lock", async () => {
  const incomplete = authoritativeBuild();
  incomplete.sourceSummaries.nasdaq!.fileCreationTime = null;
  const calls: string[] = [];

  await assert.rejects(
    listed.runSync(listed.parseOptions(["--execute", "--sources=nasdaq"]), {
      acquireLock: async () => {
        calls.push("lock");
        return advisoryLease(new AbortController(), async () => {
          calls.push("release");
        });
      },
      claimWriterFence: async (fenceToken) => {
        calls.push(`claim:${fenceToken}`);
      },
      buildRows: async () => {
        calls.push("build");
        return incomplete;
      },
      upsertCatalog: async () => {
        calls.push("catalog");
      },
      syncMemberships: async () => {
        calls.push("memberships");
        return {
          upsertedRows: 0,
          deactivatedRows: 0,
          deactivatedBySource: {},
        };
      },
    }),
    /complete|trailer|authoritative/iu,
  );
  assert.deepEqual(calls, ["lock", "claim:1", "build", "release"]);

  await assert.rejects(
    listed.runSync(listed.parseOptions(["--execute"]), {
      acquireLock: async () => null,
      claimWriterFence: async () => {},
      buildRows: async () => {
        throw new Error("build should not run");
      },
      upsertCatalog: async () => {},
      syncMemberships: async () => ({
        upsertedRows: 0,
        deactivatedRows: 0,
        deactivatedBySource: {},
      }),
    }),
    /already running|lock/iu,
  );

  const primary = new Error("primary source failure");
  await assert.rejects(
    listed.runSync(listed.parseOptions(["--execute"]), {
      acquireLock: async () =>
        advisoryLease(new AbortController(), async () => {
          throw new Error("secondary lock cleanup failure");
        }),
      claimWriterFence: async () => {},
      buildRows: async () => {
        throw primary;
      },
      upsertCatalog: async () => {},
      syncMemberships: async () => ({
        upsertedRows: 0,
        deactivatedRows: 0,
        deactivatedBySource: {},
      }),
    }),
    (error) => error === primary,
  );
});

test("lease loss stops the next catalog and membership write phases", async () => {
  for (const abortAfter of ["build", "catalog"] as const) {
    const controller = new AbortController();
    const leaseLost = new Error(`lease lost after ${abortAfter}`);
    const calls: string[] = [];

    await assert.rejects(
      listed.runSync(listed.parseOptions(["--execute", "--sources=nasdaq"]), {
        acquireLock: async () => {
          calls.push("lock");
          return advisoryLease(controller, async () => {
            calls.push("release");
          });
        },
        claimWriterFence: async (fenceToken) => {
          calls.push(`claim:${fenceToken}`);
        },
        buildRows: async () => {
          calls.push("build");
          if (abortAfter === "build") controller.abort(leaseLost);
          return authoritativeBuild();
        },
        upsertCatalog: async (
          _rows: unknown,
          _writerFenceToken: string,
          signal?: AbortSignal,
        ) => {
          calls.push("catalog");
          assert.equal(signal, controller.signal);
          if (abortAfter === "catalog") controller.abort(leaseLost);
        },
        syncMemberships: async () => {
          calls.push("memberships");
          return {
            upsertedRows: 1,
            deactivatedRows: 0,
            deactivatedBySource: {},
          };
        },
      }),
      (error) => error === leaseLost,
    );

    assert.deepEqual(
      calls,
      abortAfter === "build"
        ? ["lock", "claim:1", "build", "release"]
        : ["lock", "claim:1", "build", "catalog", "release"],
    );
  }
});

test("membership transaction deactivates absences from the filtered source set", async () => {
  await withTestDb(async ({ db }) => {
    const old = new Date("2026-07-01T00:00:00.000Z");
    await db.insert(universeCatalogSyncStatesTable).values({
      scopeKey: "catalog:writer",
      phase: "writer",
      market: "stocks",
      activeOnly: true,
      metadata: { leaseFenceToken: "1" },
    });
    await db.insert(universeSourceMembershipsTable).values([
      {
        sourceId: "nasdaq_listed",
        sourceSymbol: "AAPL",
        normalizedTicker: "AAPL",
        listingKey: "AAPL|stocks|XNAS",
        market: "stocks",
        active: true,
        lastSeenAt: old,
      },
      {
        sourceId: "nasdaq_listed",
        sourceSymbol: "FILTERED",
        normalizedTicker: "FILTERED",
        listingKey: "FILTERED|stocks|XNAS",
        market: "stocks",
        active: true,
        lastSeenAt: old,
      },
      {
        sourceId: "nasdaq_listed",
        sourceSymbol: "OLD",
        normalizedTicker: "OLD",
        listingKey: "OLD|stocks|XNAS",
        market: "stocks",
        active: true,
        lastSeenAt: old,
      },
      {
        sourceId: "nasdaq_listed",
        sourceSymbol: "RETURNED",
        normalizedTicker: "RETURNED",
        listingKey: "RETURNED|stocks|XNAS",
        market: "stocks",
        active: false,
        lastSeenAt: old,
        lastMissingAt: old,
      },
      {
        sourceId: "other_listed",
        sourceSymbol: "OTHER-OLD",
        normalizedTicker: "OTHER-OLD",
        listingKey: "OTHER-OLD|stocks|XNYS",
        market: "stocks",
        active: true,
        lastSeenAt: old,
      },
    ]);
    const now = new Date("2026-07-14T17:00:00.000Z");

    const result = await listed.syncSourceMemberships({
      rows: [
        sourceRow("nasdaq_listed", "AAPL"),
        sourceRow("nasdaq_listed", "MSFT"),
        sourceRow("nasdaq_listed", "RETURNED"),
      ],
      activeSourceSymbols: new Map([
        ["nasdaq_listed", new Set(["AAPL", "MSFT", "RETURNED"])],
      ]),
      reconcileSourceIds: ["nasdaq_listed"],
      writerFenceToken: "1",
      database: db,
      now,
    });

    assert.deepEqual(result, {
      upsertedRows: 3,
      deactivatedRows: 2,
      deactivatedBySource: { nasdaq_listed: 2 },
    });
    const rows = await db
      .select({
        sourceId: universeSourceMembershipsTable.sourceId,
        sourceSymbol: universeSourceMembershipsTable.sourceSymbol,
        active: universeSourceMembershipsTable.active,
        lastSeenAt: universeSourceMembershipsTable.lastSeenAt,
        lastMissingAt: universeSourceMembershipsTable.lastMissingAt,
      })
      .from(universeSourceMembershipsTable)
      .orderBy(
        asc(universeSourceMembershipsTable.sourceId),
        asc(universeSourceMembershipsTable.sourceSymbol),
      );

    assert.deepEqual(
      rows.map((row) => ({
        sourceId: row.sourceId,
        sourceSymbol: row.sourceSymbol,
        active: row.active,
      })),
      [
        {
          sourceId: "nasdaq_listed",
          sourceSymbol: "AAPL",
          active: true,
        },
        {
          sourceId: "nasdaq_listed",
          sourceSymbol: "FILTERED",
          active: false,
        },
        {
          sourceId: "nasdaq_listed",
          sourceSymbol: "MSFT",
          active: true,
        },
        {
          sourceId: "nasdaq_listed",
          sourceSymbol: "OLD",
          active: false,
        },
        {
          sourceId: "nasdaq_listed",
          sourceSymbol: "RETURNED",
          active: true,
        },
        {
          sourceId: "other_listed",
          sourceSymbol: "OTHER-OLD",
          active: true,
        },
      ],
    );
    assert.equal(
      rows.find((row) => row.sourceSymbol === "AAPL")?.lastSeenAt.toISOString(),
      now.toISOString(),
    );
    assert.equal(
      rows
        .find((row) => row.sourceSymbol === "OLD")
        ?.lastMissingAt?.toISOString(),
      now.toISOString(),
    );
    assert.equal(
      rows
        .find((row) => row.sourceSymbol === "FILTERED")
        ?.lastMissingAt?.toISOString(),
      now.toISOString(),
    );
    assert.equal(
      rows.find((row) => row.sourceSymbol === "RETURNED")?.lastMissingAt,
      null,
    );
  });
});

test("a superseded universe writer cannot commit source memberships", async () => {
  await withTestDb(async ({ db }) => {
    await db.insert(universeCatalogSyncStatesTable).values({
      scopeKey: "catalog:writer",
      phase: "writer",
      market: "stocks",
      activeOnly: true,
      metadata: { leaseFenceToken: "11" },
    });
    const input = {
      rows: [sourceRow("nasdaq_listed", "AAPL")],
      activeSourceSymbols: new Map([
        ["nasdaq_listed" as const, new Set(["AAPL"])],
      ]),
      reconcileSourceIds: ["nasdaq_listed" as const],
      database: db,
      writerFenceToken: "10",
    } as MembershipSyncInput & { writerFenceToken: string };

    await assert.rejects(listed.syncSourceMemberships(input), /superseded/iu);
    assert.equal(
      (await db.select().from(universeSourceMembershipsTable)).length,
      0,
    );
  });
});

test("CLI help/import boundaries never reach providers or the database", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0, `${help.stdout}${help.stderr}`);
  assert.match(help.stdout, /Usage:.*universe:sync:listings/iu);
  assert.doesNotMatch(help.stderr, /provider boundary|ECONNREFUSED|\n\s+at /u);

  const invalid = runCli(["--unknown=true"]);
  assert.equal(invalid.status, 1, `${invalid.stdout}${invalid.stderr}`);
  assert.match(invalid.stderr, /Usage:/u);
  assert.doesNotMatch(
    invalid.stderr,
    /provider boundary|ECONNREFUSED|127\.0\.0\.1|\n\s+at /u,
  );

  const moduleUrl = pathToFileURL(scriptPath).href;
  const imported = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      FETCH_TRAP_URL,
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(moduleUrl)})`,
    ],
    {
      cwd: scriptsRoot,
      encoding: "utf8",
      env: { ...process.env, ...ISOLATED_DATABASE_ENV },
      timeout: 10_000,
    },
  );
  assert.equal(imported.status, 0, `${imported.stdout}${imported.stderr}`);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
});

test("diagnostics redact credentials and cannot control the terminal", () => {
  const diagnostic = listed.safeDiagnostic(
    new Error(
      `postgresql://operator:super-secret@db.example/pyrus https://directory.example/file?access_token=short-secret&cursor=keep \u001b[31mline\nnext\u202e${"x".repeat(600)}`,
    ),
  );

  assert.match(diagnostic, /postgresql:\/\/\[redacted\]@db\.example\/pyrus/u);
  assert.doesNotMatch(diagnostic, /super-secret/u);
  assert.match(diagnostic, /https:\/\/directory\.example\/file\?\[redacted\]/u);
  assert.doesNotMatch(diagnostic, /short-secret/u);
  assert.doesNotMatch(
    diagnostic,
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.ok(diagnostic.length <= 400);
  const opaqueCredential = `sk-${"a".repeat(32)}`;
  assert.doesNotMatch(
    listed.safeDiagnostic(
      new Error(`provider rejected credential ${opaqueCredential}`),
    ),
    new RegExp(opaqueCredential, "u"),
  );
});

test("diagnostics redact percent-encoded credential query names", () => {
  const credential = "percent-encoded-listed-secret";
  const diagnostic = listed.safeDiagnostic(
    new Error(
      `provider rejected https://directory.example/file?access%5Ftoken=${credential}&cursor=keep`,
    ),
  );

  assert.doesNotMatch(diagnostic, new RegExp(credential, "u"));
});

test("diagnostics reject standalone named credentials", () => {
  const credential = "short-listed-secret";
  assert.equal(
    listed.safeDiagnostic(
      new Error(`provider rejected access_token=${credential}`),
    ),
    "Unknown listed-universe sync error",
  );
  assert.equal(
    listed.safeDiagnostic(
      new Error('provider rejected {"access_token":"short-json-secret"}'),
    ),
    "Unknown listed-universe sync error",
  );
});
