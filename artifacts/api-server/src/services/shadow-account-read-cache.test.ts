import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { asc, eq } from "drizzle-orm";

import {
  db,
  shadowAccountsTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
} from "@workspace/db";
import { createTestDb } from "@workspace/db/testing";

import {
  __shadowWatchlistBacktestInternalsForTests as internals,
  refreshShadowPositionMarks,
  SHADOW_ACCOUNT_ID,
} from "./shadow-account";
import { runWithShadowAccountId } from "./shadow-account-context";

const shadowAccountSource = readFileSync(
  new URL("./shadow-account.ts", import.meta.url),
  "utf8",
);

const waitTurn = () => new Promise((resolve) => setImmediate(resolve));
const testMoney = (value: number) => Number(value.toFixed(6)).toString();

type QueryLogger = {
  logQuery: (query: string, params: unknown[]) => void;
};

type DrizzleDbWithLoggerSession = {
  session: {
    logger: QueryLogger;
    options: {
      logger?: QueryLogger;
    };
  };
};

function captureShadowMarkWriteQueries(
  testDb: Awaited<ReturnType<typeof createTestDb>>,
  statements: string[],
) {
  const dbWithSession = testDb.db as unknown as DrizzleDbWithLoggerSession;
  const previousLogger = dbWithSession.session.logger;
  const previousOptionsLogger = dbWithSession.session.options.logger;
  const captureLogger: QueryLogger = {
    logQuery(query, params) {
      const compact = query.replace(/\s+/g, " ").trim().toLowerCase();
      if (
        compact.startsWith('insert into "shadow_position_marks"') ||
        compact.startsWith("insert into shadow_position_marks") ||
        compact.startsWith("update shadow_positions as p")
      ) {
        statements.push(compact);
      }
      previousLogger.logQuery(query, params);
    },
  };
  dbWithSession.session.logger = captureLogger;
  dbWithSession.session.options.logger = captureLogger;
  return () => {
    dbWithSession.session.logger = previousLogger;
    dbWithSession.session.options.logger = previousOptionsLogger;
  };
}

type TestShadowPositionsResponse = {
  positions: Array<{ id: string; symbol: string; assetClass: string }>;
  totals: Record<string, unknown>;
  stale?: boolean;
  reason?: string;
};

type TestShadowRiskResponse = {
  accountId: string;
  updatedAt: string;
  degraded?: boolean;
  degradedReason?: string;
  stale?: boolean;
  reason?: string;
  asOf?: string;
};

test("fast shadow positions use one source-scoped ledger bundle for rows and totals", () => {
  const start = shadowAccountSource.indexOf(
    "async function buildFastShadowPositionsResponse",
  );
  const end = shadowAccountSource.indexOf(
    "export async function getShadowAccountPositions",
    start,
  );
  assert.notEqual(start, -1, "Missing buildFastShadowPositionsResponse");
  assert.notEqual(end, -1, "Missing fast response end marker");
  const body = shadowAccountSource.slice(start, end);

  assert.match(
    body,
    /input\.source\s*\?\s*await readShadowLedgerBundleForSource\(input\.source\)\s*:\s*null/,
  );
  assert.match(body, /totals: sourceBundle\?\.totals \?\? null/);
});

test("shadow mark refresh single-flight is partitioned by account", () => {
  const start = shadowAccountSource.indexOf(
    "function kickShadowPositionMarkRefresh",
  );
  const end = shadowAccountSource.indexOf("function toNumber", start);
  assert.notEqual(start, -1, "Missing kickShadowPositionMarkRefresh");
  assert.notEqual(end, -1, "Missing mark refresh end marker");
  const body = shadowAccountSource.slice(start, end);

  assert.match(body, /const accountId = currentShadowAccountId\(\);/);
  assert.match(body, /shadowPositionMarkRefreshInFlight\.get\(accountId\)/);
  assert.match(body, /shadowPositionMarkRefreshInFlight\.set\(accountId, request\)/);
  assert.match(body, /shadowPositionMarkRefreshInFlight\.delete\(accountId\)/);
});

test("mark refresh writes mark history to the current shadow account", async () => {
  const testDb = await createTestDb();
  const accountId = "shadow-user-mark-test";
  const positionId = "00000000-0000-4000-8000-000000000099";
  internals.setResolveEquityMarkForTests(() => ({
    price: 125,
    bid: null,
    ask: null,
    source: "quote",
    asOf: new Date("2026-07-09T14:30:00.000Z"),
  }));

  try {
    await db.insert(shadowAccountsTable).values({
      id: accountId,
      displayName: "User shadow",
      currency: "USD",
      startingBalance: "25000",
      cash: "24900",
      status: "active",
    });
    await db.insert(shadowPositionsTable).values({
      id: positionId,
      accountId,
      positionKey: "equity:AAPL",
      symbol: "AAPL",
      assetClass: "equity",
      positionType: "stock",
      quantity: "1",
      averageCost: "100",
      mark: "100",
      marketValue: "100",
      unrealizedPnl: "0",
      status: "open",
    });

    const result = await runWithShadowAccountId(accountId, () =>
      refreshShadowPositionMarks(),
    );
    const marks = await testDb.db
      .select()
      .from(shadowPositionMarksTable)
      .where(eq(shadowPositionMarksTable.positionId, positionId));

    assert.equal(result.updatedCount, 1);
    assert.equal(marks.length, 1);
    assert.equal(marks[0]?.accountId, accountId);
  } finally {
    internals.setResolveEquityMarkForTests(null);
  }
});

test("mark refresh batches mark writes and preserves per-row values", async () => {
  const testDb = await createTestDb();
  const markWriteStatements: string[] = [];
  let restoreQueryLogger = () => {};

  const aaplAsOf = new Date("2026-07-08T14:31:00.000Z");
  const tslaAsOf = new Date("2026-07-08T14:32:00.000Z");
  const msftAsOf = new Date("2026-07-08T14:33:00.000Z");

  internals.setResolveEquityMarkForTests((symbol) => {
    if (symbol === "AAPL") {
      return {
        price: 123.4567894,
        bid: null,
        ask: null,
        source: "quote",
        asOf: aaplAsOf,
      };
    }
    if (symbol === "TSLA") {
      return {
        price: 12.3456789,
        bid: null,
        ask: null,
        source: "bar_fallback",
        asOf: tslaAsOf,
      };
    }
    return {
      price: 0,
      bid: null,
      ask: null,
      source: "quote",
      asOf: msftAsOf,
    };
  });

  try {
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      currency: "USD",
      startingBalance: "25000",
      cash: "25000",
      status: "active",
    });
    await db.insert(shadowPositionsTable).values([
      {
        id: "00000000-0000-4000-8000-000000000001",
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:AAPL",
        symbol: "AAPL",
        assetClass: "equity",
        positionType: "stock",
        quantity: "2",
        averageCost: "100",
        mark: "100",
        marketValue: "200",
        unrealizedPnl: "0",
        status: "open",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:MSFT",
        symbol: "MSFT",
        assetClass: "equity",
        positionType: "stock",
        quantity: "5",
        averageCost: "50",
        mark: "50",
        marketValue: "250",
        unrealizedPnl: "0",
        status: "open",
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:TSLA",
        symbol: "TSLA",
        assetClass: "equity",
        positionType: "stock",
        quantity: "3",
        averageCost: "10",
        mark: "10",
        marketValue: "30",
        unrealizedPnl: "0",
        status: "open",
      },
    ]);

    restoreQueryLogger = captureShadowMarkWriteQueries(testDb, markWriteStatements);
    const result = await refreshShadowPositionMarks();

    assert.equal(result.updatedCount, 2);

    const positions = await db
      .select()
      .from(shadowPositionsTable)
      .orderBy(asc(shadowPositionsTable.symbol));
    const positionsBySymbol = new Map(
      positions.map((position) => [position.symbol, position]),
    );
    const aaplPosition = positionsBySymbol.get("AAPL");
    const msftPosition = positionsBySymbol.get("MSFT");
    const tslaPosition = positionsBySymbol.get("TSLA");
    assert.ok(aaplPosition);
    assert.ok(msftPosition);
    assert.ok(tslaPosition);

    assert.equal(aaplPosition.mark, testMoney(123.4567894));
    assert.equal(aaplPosition.marketValue, testMoney(2 * 123.4567894));
    assert.equal(
      aaplPosition.unrealizedPnl,
      testMoney((123.4567894 - 100) * 2),
    );
    assert.equal(aaplPosition.asOf.toISOString(), aaplAsOf.toISOString());

    assert.equal(msftPosition.mark, "50.000000");
    assert.equal(msftPosition.marketValue, "250.000000");
    assert.equal(msftPosition.unrealizedPnl, "0.000000");

    assert.equal(tslaPosition.mark, testMoney(12.3456789));
    assert.equal(tslaPosition.marketValue, testMoney(3 * 12.3456789));
    assert.equal(
      tslaPosition.unrealizedPnl,
      testMoney((12.3456789 - 10) * 3),
    );
    assert.equal(tslaPosition.asOf.toISOString(), tslaAsOf.toISOString());

    const marks = await db
      .select()
      .from(shadowPositionMarksTable)
      .orderBy(asc(shadowPositionMarksTable.positionId));
    assert.equal(marks.length, 2);
    assert.deepEqual(
      marks.map((mark) => ({
        positionId: mark.positionId,
        mark: mark.mark,
        marketValue: mark.marketValue,
        unrealizedPnl: mark.unrealizedPnl,
        source: mark.source,
        asOf: mark.asOf.toISOString(),
      })),
      [
        {
          positionId: "00000000-0000-4000-8000-000000000001",
          mark: testMoney(123.4567894),
          marketValue: testMoney(2 * 123.4567894),
          unrealizedPnl: testMoney((123.4567894 - 100) * 2),
          source: "quote",
          asOf: aaplAsOf.toISOString(),
        },
        {
          positionId: "00000000-0000-4000-8000-000000000003",
          mark: testMoney(12.3456789),
          marketValue: testMoney(3 * 12.3456789),
          unrealizedPnl: testMoney((12.3456789 - 10) * 3),
          source: "bar_fallback",
          asOf: tslaAsOf.toISOString(),
        },
      ],
    );

    const markInserts = markWriteStatements.filter((statement) =>
      statement.startsWith('insert into "shadow_position_marks"') ||
      statement.startsWith("insert into shadow_position_marks"),
    );
    const positionUpdates = markWriteStatements.filter((statement) =>
      statement.startsWith("update shadow_positions as p"),
    );
    assert.equal(markInserts.length, 1);
    assert.equal(positionUpdates.length, 1);
    assert.match(markInserts[0] ?? "", /values \(.+\), \(/);
    assert.match(positionUpdates[0] ?? "", /from unnest\(/);
  } finally {
    internals.setResolveEquityMarkForTests(null);
    restoreQueryLogger();
    await testDb.cleanup();
  }
});

test("shadow read cache serves stale values immediately while refresh continues", async () => {
  const key = `test-shadow-read-immediate-${Date.now()}-${Math.random()}`;
  let resolveRefresh: (value: TestShadowPositionsResponse) => void = () => {
    throw new Error("refresh promise was not initialized");
  };
  let refreshStarted = false;

  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 5,
    staleTtlMs: 1_000,
    staleWaitMs: 250,
  });

  try {
    await internals.withShadowReadCache(
      key,
      async () => ({
        positions: [{ id: "cached", symbol: "CACHED", assetClass: "stock" }],
        totals: {},
      }),
      { allowStale: () => true },
    );

    await new Promise((resolve) => setTimeout(resolve, 15));

    const refresh = new Promise<TestShadowPositionsResponse>((resolve) => {
      resolveRefresh = resolve;
    });

    const startedAt = Date.now();
    const stale = await internals.withShadowReadCache(
      key,
      () => {
        refreshStarted = true;
        return refresh;
      },
      {
        allowStale: () => true,
        staleStrategy: "immediate",
      },
    );

    assert.equal(refreshStarted, true);
    assert.equal(stale.stale, true);
    assert.equal(stale.reason, "shadow_read_stale_cache");
    assert.equal(stale.positions[0]?.id, "cached");
    assert.ok(
      Date.now() - startedAt < 100,
      "stale value should return without waiting for the refresh",
    );

    resolveRefresh({
      positions: [{ id: "fresh", symbol: "FRESH", assetClass: "stock" }],
      totals: {},
    });
    await refresh;
  } finally {
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
      staleWaitMs: null,
    });
  }
});

test("shadow risk read serves warm stale data only for degraded upstream errors", async () => {
  const key = `test-shadow-risk-degraded-${Date.now()}-${Math.random()}`;
  const updatedAt = "2026-07-09T20:00:00.000Z";

  assert.match(
    shadowAccountSource,
    /const SHADOW_RISK_READ_CACHE_STALE_TTL_MS = 15 \* 60_000;/,
  );

  try {
    await internals.withShadowRiskReadCache(
      key,
      async (): Promise<TestShadowRiskResponse> => ({
        accountId: SHADOW_ACCOUNT_ID,
        updatedAt,
      }),
      { ttlMs: 5, staleTtlMs: 1_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 15));

    const timeout = Object.assign(
      new Error("canceling statement due to statement timeout"),
      { code: "57014" },
    );
    const stale = await internals.withShadowRiskReadCache<TestShadowRiskResponse>(
      key,
      async () => {
        throw timeout;
      },
      { ttlMs: 5, staleTtlMs: 1_000 },
    );

    assert.equal(stale.accountId, SHADOW_ACCOUNT_ID);
    assert.equal(stale.degraded, true);
    assert.equal(stale.stale, true);
    assert.equal(stale.reason, "shadow_read_stale_cache");
    assert.equal(stale.degradedReason, "statement_timeout");
    assert.equal(stale.asOf, updatedAt);
  } finally {
    internals.invalidateShadowFreshStateCache();
  }
});

test("shadow risk read maps a degraded error without stale data to structured 503", async () => {
  const lockError = Object.assign(new Error("could not obtain lock on relation"), {
    code: "55P03",
  });

  await assert.rejects(
    () =>
      internals.withShadowRiskReadCache(
        `test-shadow-risk-empty-${Date.now()}-${Math.random()}`,
        async () => {
          throw lockError;
        },
        { ttlMs: 5, staleTtlMs: 1_000 },
      ),
    (error: unknown) => {
      assert.equal(
        error && typeof error === "object" && "statusCode" in error
          ? error.statusCode
          : null,
        503,
      );
      assert.equal(
        error && typeof error === "object" && "code" in error
          ? error.code
          : null,
        "degraded_upstream",
      );
      return true;
    },
  );
});

test("shadow risk read never masks non-degraded programming errors with stale data", async () => {
  const key = `test-shadow-risk-programming-error-${Date.now()}-${Math.random()}`;

  try {
    await internals.withShadowRiskReadCache(
      key,
      async (): Promise<TestShadowRiskResponse> => ({
        accountId: SHADOW_ACCOUNT_ID,
        updatedAt: "2026-07-09T20:00:00.000Z",
      }),
      { ttlMs: 5, staleTtlMs: 1_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 15));

    await assert.rejects(
      () =>
        internals.withShadowRiskReadCache(
          key,
          async () => {
            throw new TypeError("risk model invariant failed");
          },
          { ttlMs: 5, staleTtlMs: 1_000 },
        ),
      (error: unknown) =>
        error instanceof TypeError && error.message === "risk model invariant failed",
    );
  } finally {
    internals.invalidateShadowFreshStateCache();
  }
});

test("shadow risk degraded classifier stays limited to timeout and lock pressure", () => {
  const cases: Array<[unknown, string]> = [
    [Object.assign(new Error("query canceled"), { code: "57014" }), "statement_timeout"],
    [
      Object.assign(new Error("could not obtain lock on relation"), { code: "55P03" }),
      "lock_not_available",
    ],
    [new Error("canceling statement due to lock timeout"), "lock_wait_timeout"],
    [new Error("Lock wait timeout exceeded; try restarting transaction"), "lock_wait_timeout"],
    [
      new Error("pool timed out while waiting for an open connection"),
      "pool_acquire_timeout",
    ],
    [new Error("timeout exceeded when trying to connect"), "pool_acquire_timeout"],
  ];

  for (const [error, expected] of cases) {
    assert.equal(internals.shadowRiskDegradedErrorReason(error), expected);
  }
  assert.equal(
    internals.shadowRiskDegradedErrorReason(new TypeError("risk model invariant failed")),
    null,
  );
});

test("background mark refresh keeps order and history caches hot", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 60_000,
    staleTtlMs: 60_000,
    staleWaitMs: 250,
  });

  let ordersReads = 0;
  let fillsReads = 0;
  let historyReads = 0;
  let summaryReads = 0;
  const readOrders = async () => ({ reads: ++ordersReads });
  const readFills = async () => ({ reads: ++fillsReads });
  const readHistory = async () => ({ reads: ++historyReads });
  const readSummary = async () => ({ reads: ++summaryReads });

  try {
    await internals.withShadowReadCache("orders:history:all", readOrders);
    await internals.withShadowReadCache("dashboard:fills-with-orders", readFills);
    await internals.withShadowReadCache("equity-history:ALL::all", readHistory);
    await internals.withShadowReadCache("summary:all", readSummary);

    internals.invalidateShadowReadCachesAfterBackgroundMarkRefresh();

    const orders = await internals.withShadowReadCache(
      "orders:history:all",
      readOrders,
    );
    const fills = await internals.withShadowReadCache(
      "dashboard:fills-with-orders",
      readFills,
    );
    const history = await internals.withShadowReadCache(
      "equity-history:ALL::all",
      readHistory,
    );
    const summary = await internals.withShadowReadCache("summary:all", readSummary);

    assert.deepEqual(orders, { reads: 1 });
    assert.deepEqual(fills, { reads: 1 });
    assert.deepEqual(history, { reads: 1 });
    assert.deepEqual(summary, { reads: 2 });
  } finally {
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
      staleWaitMs: null,
    });
  }
});

test("mark refresh during an in-flight non-mark-affected compute keeps the cached store", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 60_000,
    staleTtlMs: 60_000,
    staleWaitMs: 250,
  });

  let historyReads = 0;
  let releaseHistory: () => void = () => {};
  const historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });

  try {
    // equity-history is deliberately NOT in SHADOW_MARK_REFRESH_CACHE_KEY_PREFIXES,
    // so a mark tick landing mid-compute must not discard its result. Before the
    // per-key version split this recomputed on every read (the ELU churn cure).
    const inflight = internals.withShadowReadCache(
      "equity-history:1D::all",
      async () => {
        historyReads += 1;
        await historyGate;
        return { reads: historyReads };
      },
    );

    // A background mark refresh fires while the compute is still in flight.
    internals.invalidateShadowReadCachesAfterBackgroundMarkRefresh();

    releaseHistory();
    const first = await inflight;
    assert.deepEqual(first, { reads: 1 });

    // Subsequent read must be a cache HIT (no recompute) despite the mid-flight tick.
    const second = await internals.withShadowReadCache(
      "equity-history:1D::all",
      async () => {
        historyReads += 1;
        return { reads: historyReads };
      },
    );
    assert.deepEqual(second, { reads: 1 });
    assert.equal(historyReads, 1);
  } finally {
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
      staleWaitMs: null,
    });
  }
});

test("mark refresh during an in-flight mark-affected compute still discards its store", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 60_000,
    staleTtlMs: 60_000,
    staleWaitMs: 250,
  });

  let summaryReads = 0;
  let releaseSummary: () => void = () => {};
  const summaryGate = new Promise<void>((resolve) => {
    releaseSummary = resolve;
  });

  try {
    // summary: IS mark-affected, so an in-flight compute racing a mark tick must be
    // discarded (its valuation is now stale) and recomputed on the next read.
    const inflight = internals.withShadowReadCache("summary:all", async () => {
      summaryReads += 1;
      await summaryGate;
      return { reads: summaryReads };
    });

    internals.invalidateShadowReadCachesAfterBackgroundMarkRefresh();

    releaseSummary();
    await inflight;

    const second = await internals.withShadowReadCache("summary:all", async () => {
      summaryReads += 1;
      return { reads: summaryReads };
    });
    assert.deepEqual(second, { reads: 2 });
    assert.equal(summaryReads, 2);
  } finally {
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
      staleWaitMs: null,
    });
  }
});

test("shadow option quote cache keeps stale display quotes during live refresh gaps", async () => {
  const providerContractId = `twsopt:test-${Date.now()}-${Math.random()}`;
  const positions = [
    {
      optionContract: {
        ticker: providerContractId,
        underlying: "SPY",
        expirationDate: new Date("2026-06-12T00:00:00.000Z"),
        strike: 600,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId,
      },
    },
  ];

  internals.clearShadowOptionQuoteCachesForTests();
  internals.setShadowOptionQuoteCacheWindowsForTests({
    ttlMs: 5,
    staleTtlMs: 1_000,
  });

  try {
    internals.rememberShadowOptionQuoteForTests(providerContractId, {
      providerContractId,
      bid: 1.23,
      ask: 1.35,
      updatedAt: "2026-06-08T15:56:31.004Z",
    });

    await new Promise((resolve) => setTimeout(resolve, 15));

    const freshOnly =
      internals.readCachedShadowOptionQuotesForTests(positions);
    assert.equal(freshOnly.size, 0);

    const staleAllowed =
      internals.readCachedShadowOptionQuotesForTests(positions, {
        allowStale: true,
      });
    assert.equal(staleAllowed.size, 1);
    assert.equal(
      (staleAllowed.get(providerContractId) as Record<string, unknown>)?.bid,
      1.23,
    );
  } finally {
    internals.clearShadowOptionQuoteCachesForTests();
    internals.setShadowOptionQuoteCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
    });
  }
});

test("shadow option quote cache does not replace display quotes with empty updates", () => {
  const providerContractId = `twsopt:test-empty-${Date.now()}-${Math.random()}`;
  const positions = [
    {
      optionContract: {
        ticker: providerContractId,
        underlying: "SPY",
        expirationDate: new Date("2026-06-12T00:00:00.000Z"),
        strike: 600,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId,
      },
    },
  ];

  internals.clearShadowOptionQuoteCachesForTests();
  internals.setShadowOptionQuoteCacheWindowsForTests({
    ttlMs: 1_000,
    staleTtlMs: 1_000,
  });

  try {
    internals.rememberShadowOptionQuoteForTests(providerContractId, {
      providerContractId,
      bid: 2.1,
      ask: 2.3,
      updatedAt: "2026-06-08T15:56:31.004Z",
    });
    internals.rememberShadowOptionQuoteForTests(providerContractId, {
      providerContractId,
      updatedAt: "2026-06-08T15:56:32.004Z",
    });

    const quotes = internals.readCachedShadowOptionQuotesForTests(positions);
    assert.equal(quotes.size, 1);
    assert.equal(
      (quotes.get(providerContractId) as Record<string, unknown>)?.bid,
      2.1,
    );
    assert.equal(
      (quotes.get(providerContractId) as Record<string, unknown>)?.ask,
      2.3,
    );
  } finally {
    internals.clearShadowOptionQuoteCachesForTests();
    internals.setShadowOptionQuoteCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
    });
  }
});

test("shadow positions pressure fallback builds a bounded degraded snapshot from open rows", () => {
  const observedAt = new Date("2026-06-10T02:45:00.000Z");
  const optionContract = {
    ticker: "SPY 20260612 600 C",
    underlying: "SPY",
    expirationDate: new Date("2026-06-12T00:00:00.000Z"),
    strike: 600,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: "twsopt:test-pressure",
  };
  const response = internals.buildFastShadowPositionsResponseFromRows({
    account: {
      cash: "1000",
      startingBalance: "500",
    } as never,
    assetClassFilter: "option",
    source: null,
    observedAt,
    positions: [
      {
        id: "stock-position",
        symbol: "AAPL",
        assetClass: "equity",
        positionKey: "equity:AAPL",
        quantity: "2",
        averageCost: "100",
        mark: "110",
        marketValue: "220",
        unrealizedPnl: "20",
        asOf: observedAt,
        openedAt: observedAt,
      },
      {
        id: "option-position",
        symbol: "SPY",
        assetClass: "option",
        positionKey: "option:SPY:20260612:600:C",
        quantity: "1",
        averageCost: "2",
        mark: "3",
        optionContract,
        asOf: observedAt,
        openedAt: observedAt,
      },
    ] as never,
  });

  assert.equal(response.degraded, true);
  assert.equal(response.stale, true);
  assert.equal(response.reason, "shadow_positions_pressure_fallback");
  assert.equal(response.positions.length, 1);
  assert.equal(response.positions[0]?.id, "option-position");
  assert.equal(response.positions[0]?.marketValue, 300);
  assert.equal(response.totals.cash, 1000);
  assert.equal(response.totals.netLiquidation, 1300);
});

test("source-scoped pressure positions use source cash instead of whole-ledger cash", () => {
  const observedAt = new Date("2026-07-09T14:45:00.000Z");
  const response = internals.buildFastShadowPositionsResponseFromRows({
    account: {
      cash: "1000",
      startingBalance: "500",
    } as never,
    totals: {
      cash: 400,
      startingBalance: 500,
      realizedPnl: 0,
      unrealizedPnl: 25,
      fees: 0,
      marketValue: 125,
      netLiquidation: 525,
      updatedAt: observedAt,
    },
    assetClassFilter: "all",
    source: "automation",
    observedAt,
    positions: [
      {
        id: "automation-position",
        symbol: "AAPL",
        assetClass: "equity",
        positionKey: "equity:AAPL",
        quantity: "1",
        averageCost: "100",
        mark: "125",
        marketValue: "125",
        unrealizedPnl: "25",
        asOf: observedAt,
        openedAt: observedAt,
      },
    ] as never,
  });

  assert.equal(response.positions.length, 1);
  assert.equal(response.totals.cash, 400);
  assert.equal(response.totals.netLiquidation, 525);
});

test("shadow positions pressure fallback surfaces day change decoupled from pressure", () => {
  const observedAt = new Date("2026-07-09T14:45:00.000Z");
  const baseInput = {
    account: { cash: "1000", startingBalance: "500" } as never,
    assetClassFilter: "option" as const,
    source: null,
    observedAt,
    positions: [
      {
        id: "rh-daychange-position",
        symbol: "RH",
        assetClass: "option",
        positionKey: "option:RH:20260710:152.5:C",
        quantity: "2",
        averageCost: "7.03",
        mark: "14.4",
        marketValue: "2880",
        optionContract: {
          ticker: "RH 20260710 152.5 C",
          underlying: "RH",
          expirationDate: new Date("2026-07-10T00:00:00.000Z"),
          strike: 152.5,
          right: "call",
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: "twsopt:rh-daychange",
        },
        asOf: observedAt,
        openedAt: new Date("2026-07-08T14:30:00.000Z"),
      },
    ] as never,
  };

  // A freshly-computed baseline day change is surfaced instead of being blanked to $0.
  const withFresh = internals.buildFastShadowPositionsResponseFromRows({
    ...baseInput,
    dayChangesByPositionId: new Map([
      ["rh-daychange-position", { dayChange: 960, dayChangePercent: 50 }],
    ]),
  });
  assert.equal(withFresh.positions[0]?.dayChange, 960);
  assert.equal(withFresh.positions[0]?.dayChangePercent, 50);

  // A later pressure build with no fresh value reuses the last-known cached day change
  // recorded above, so it is never reset to $0.
  const fromCache = internals.buildFastShadowPositionsResponseFromRows(baseInput);
  assert.equal(fromCache.positions[0]?.dayChange, 960);
  assert.equal(fromCache.positions[0]?.dayChangePercent, 50);
});

test("shadow account positions use immediate stale cache strategy", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function getShadowAccountPositions");
  const end = source.indexOf("function dateFromShadowPositionResponse", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(block, /allowStale:\s*shadowReadCacheValueHasRows/);
  assert.match(block, /staleStrategy:\s*"immediate"/);
  assert.doesNotMatch(block, /staleStrategy:\s*"never"/);
});

test("open shadow positions helper serves stale cache immediately", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function readOpenShadowPositionsForSourceCached");
  const end = source.indexOf("async function readShadowOrdersByFillOrderId", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(block, /allowStale:\s*shadowReadCacheValueHasRows/);
  assert.match(block, /staleStrategy:\s*"immediate"/);
  assert.doesNotMatch(block, /staleStrategy:\s*"never"/);
});

test("shadow account positions pressure path does not start a full refresh", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function getShadowAccountPositions");
  const end = source.indexOf("function dateFromShadowPositionResponse", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  const pressureStart = block.indexOf("if (shouldServeFastShadowPositionsForPressure())");
  const pressureEnd = block.indexOf("return withShadowReadCache", pressureStart);
  assert.notEqual(pressureStart, -1);
  assert.notEqual(pressureEnd, -1);

  const pressureBlock = block.slice(pressureStart, pressureEnd);
  assert.match(pressureBlock, /return buildFastShadowPositionsResponse/);
  assert.doesNotMatch(pressureBlock, /withShadowReadCache\(/);
  assert.doesNotMatch(pressureBlock, /readFullPositions/);
});

test("shadow positions fast wrapper warms day change without kicking mark refresh", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function buildFastShadowPositionsResponse");
  const end = source.indexOf("export async function getShadowAccountPositions", start);
  assert.notEqual(start, -1, "Missing buildFastShadowPositionsResponse");
  assert.notEqual(end, -1, "Missing function boundary after fast positions wrapper");

  const block = source.slice(start, end);
  // Gate 2: a high-pressure positions GET (served by the fast path) must not
  // start a mark refresh — no mark/snapshot writes from the saturated path.
  assert.doesNotMatch(block, /kickShadowPositionMarkRefresh\(\)/);
  assert.match(block, /void readShadowPositionDayChanges\(/);
  assert.match(block, /recordLastKnownShadowPositionDayChange/);
  assert.doesNotMatch(block, /await\s+readShadowPositionDayChanges/);
});

test("shadow reusable position caches gate stale reuse on resource pressure", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

  assert.match(source, /getApiResourcePressureSnapshot\(\)\.resourceLevel !== "high"/);
  assert.match(source, /const pressureLevel = getApiResourcePressureSnapshot\(\)\.resourceLevel;/);
  assert.doesNotMatch(
    source,
    /getApiResourcePressureSnapshot\(\)\.level !== "high"/,
  );
});

test("shared dashboard fills+orders read serves stale immediately at the derived TTL", () => {
  // Regression: this shared full fills+orders scan backs equity-history,
  // positions, closed-trades, and cash-activity. Under a saturated DB pool the
  // default "wait" strategy blocked each stale miss ~1.5s before serving the same
  // cached value. It must serve stale immediately (background refresh) and use the
  // wider derived-read TTL so the heavy scan recomputes less often. Trading logic
  // reads the uncached readShadowFillsWithOrders, so this cannot serve stale P&L
  // into an order path.
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("function readShadowDashboardFillsWithOrders");
  const end = source.indexOf("async function readShadowFillsForOrderIds", start);
  assert.notEqual(start, -1, "Missing readShadowDashboardFillsWithOrders");
  assert.notEqual(end, -1, "Missing function boundary after dashboard fills read");
  const block = source.slice(start, end);

  assert.match(block, /"dashboard:fills-with-orders"/);
  assert.match(block, /staleStrategy:\s*"immediate"/);
  assert.match(block, /ttlMs:\s*SHADOW_DERIVED_READ_CACHE_TTL_MS/);
  assert.doesNotMatch(block, /staleStrategy:\s*"never"/);
});

test("equity-history base snapshot scan yields under hard DB pool pressure", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function getShadowAccountEquityHistory");
  const end = source.indexOf("function readFreshCachedShadowEquityHistoryReturnMetrics", start);
  assert.notEqual(start, -1, "Missing getShadowAccountEquityHistory");
  assert.notEqual(end, -1, "Missing function boundary after equity-history reader");
  const block = source.slice(start, end);
  const pressureCheck = block.indexOf(
    'getApiResourcePressureSnapshot().hardResourceLevel === "high"',
  );
  const snapshotScan = block.indexOf("readShadowEquityHistorySnapshotRowsBucketed({");

  assert.notEqual(pressureCheck, -1, "Missing hard-pressure fallback");
  assert.notEqual(snapshotScan, -1, "Missing bucket-first snapshot read");
  assert.ok(
    pressureCheck < snapshotScan,
    "equity-history must fall back before opening the bounded snapshot read",
  );
});

test("shared dashboard fills+orders read is bounded and uses a 30s derived TTL", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function readBoundedShadowFillsWithOrders");
  const end = source.indexOf("function readShadowDashboardFillsWithOrders", start);
  assert.notEqual(start, -1, "Missing bounded dashboard fills reader");
  assert.notEqual(end, -1, "Missing function boundary after bounded fills reader");
  const block = source.slice(start, end);

  assert.match(source, /const SHADOW_DERIVED_READ_CACHE_TTL_MS = 30_000;/);
  assert.match(source, /const SHADOW_LEDGER_DASHBOARD_READ_LIMIT =/);
  assert.match(block, /orderBy\(desc\(shadowFillsTable\.occurredAt\)\)/);
  assert.match(block, /\.limit\(shadowLedgerDashboardReadLimit\(\)\)/);
  assert.match(block, /readShadowOrdersByFillOrderId\(fills\)/);
});

test("automation ledger realized P&L keeps the all-time source path", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const realizedStart = source.indexOf(
    "export async function computeSignalOptionsLedgerRealizedForDeployment",
  );
  const realizedEnd = source.indexOf(
    "function buildShadowCashActivityTotalsFromAccount",
    realizedStart,
  );
  assert.notEqual(realizedStart, -1);
  assert.notEqual(realizedEnd, -1);
  const realizedBlock = source.slice(realizedStart, realizedEnd);
  assert.match(realizedBlock, /readShadowLedgerBundleForSource\("automation"\)/);

  const ordersStart = source.indexOf("async function readShadowOrdersForSource");
  const ordersEnd = source.indexOf("async function readShadowFillsWithOrdersForSource", ordersStart);
  assert.notEqual(ordersStart, -1);
  assert.notEqual(ordersEnd, -1);
  const ordersBlock = source.slice(ordersStart, ordersEnd);
  const automationBranch = ordersBlock.slice(ordersBlock.indexOf("const orders = await db"));
  assert.doesNotMatch(automationBranch, /shadowLedgerDashboardReadLimit/);
});

test("shared dashboard fills+orders read joins one in-flight operation", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 60_000,
    staleTtlMs: 60_000,
    staleWaitMs: 250,
  });

  let reads = 0;
  let releaseRead: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const value = { fills: [], ordersById: new Map() };

  try {
    const first = internals.readShadowDashboardFillsWithOrdersForTests(async () => {
      reads += 1;
      await gate;
      return value;
    });
    const second = internals.readShadowDashboardFillsWithOrdersForTests(async () => {
      reads += 1;
      return { fills: [], ordersById: new Map() };
    });

    await waitTurn();
    assert.equal(reads, 1);
    releaseRead();
    assert.equal(await first, value);
    assert.equal(await second, value);
    assert.equal(reads, 1);
  } finally {
    releaseRead();
    await waitTurn();
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
      staleWaitMs: null,
    });
  }
});

test("shadow order tabs share the cached full account order scan", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const ordersStart = source.indexOf("export async function getShadowAccountOrders");
  const ordersEnd = source.indexOf("\nfunction shadowResponseReason", ordersStart);
  assert.notEqual(ordersStart, -1, "Missing getShadowAccountOrders");
  assert.notEqual(ordersEnd, -1, "Missing function boundary after orders");
  const ordersBody = source.slice(ordersStart, ordersEnd);

  assert.match(ordersBody, /readShadowOrdersForDisplay\(source\)/);
  assert.match(ordersBody, /`orders:all:\$\{shadowSourceCacheKey\(source\)\}`/);
  assert.match(ordersBody, /staleStrategy:\s*"immediate"/);
  assert.match(ordersBody, /SHADOW_DERIVED_READ_CACHE_TTL_MS/);
});

test("account-level shadow order scan is shared with immediate stale reuse", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function readShadowOrdersForAccount()");
  const end = source.indexOf("\nasync function readShadowOrdersForSource", start);
  assert.notEqual(start, -1, "Missing readShadowOrdersForAccount");
  assert.notEqual(end, -1, "Missing function boundary after account orders");
  const body = source.slice(start, end);

  assert.match(body, /withShadowReadCache\(/);
  assert.match(body, /`orders:account-bounded:\$\{limit\}`/);
  assert.match(body, /ttlMs:\s*SHADOW_DERIVED_READ_CACHE_TTL_MS/);
  assert.match(body, /staleStrategy:\s*"immediate"/);
  assert.doesNotMatch(body, /staleStrategy:\s*"never"/);
});

test("shadow trade diagnostics uses shared stale-immediate read cache", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function computeShadowTradeDiagnostics");
  const end = source.indexOf("\nasync function getShadowTradeEquityEvents", start);
  assert.notEqual(start, -1, "Missing computeShadowTradeDiagnostics");
  assert.notEqual(end, -1, "Missing function boundary after diagnostics");
  const body = source.slice(start, end);

  assert.match(body, /withShadowReadCache\(/);
  assert.match(body, /`trade-diagnostics:\$\{range\}`/);
  assert.match(body, /staleStrategy:\s*"immediate"/);
  assert.match(body, /SHADOW_TRADE_DIAGNOSTICS_CACHE_TTL_MS/);
  assert.match(body, /SHADOW_TRADE_DIAGNOSTICS_CACHE_STALE_TTL_MS/);
});

// Retirement doctrine (docs/plans/pressure-gate-retirement-2026-07-10.md): every
// user-visible pressure degrade must count its firings so "this gate never fires"
// is provable. Guard the diagnostic surface those verdicts read from.
test("read diagnostics expose pressure-degrade serve counters", async () => {
  const { getShadowAccountReadDiagnostics } = await import("./shadow-account");
  const diagnostics = getShadowAccountReadDiagnostics();
  assert.deepEqual(Object.keys(diagnostics.pressureDegrades).sort(), [
    "equityHistoryDbBackoffFallback",
    "equityHistoryPressureFallback",
    "positionsFastPath",
  ]);
  for (const value of Object.values(diagnostics.pressureDegrades)) {
    assert.equal(typeof value, "number");
  }
});
