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
  assert.match(
    body,
    /shadowPositionMarkRefreshInFlight\.set\(accountId, request\)/,
  );
  assert.match(body, /shadowPositionMarkRefreshInFlight\.delete\(accountId\)/);
});

test("marketing shadow ledger reads use compact projected orders and one fill bundle", () => {
  const compactStart = shadowAccountSource.indexOf(
    "type ShadowMarketingOrderRow",
  );
  const compactEnd = shadowAccountSource.indexOf(
    "async function readShadowOrdersForAccountUncached",
    compactStart,
  );
  assert.notEqual(compactStart, -1, "Missing marketing order projection");
  assert.notEqual(compactEnd, -1, "Missing canonical order reader marker");
  const compactBlock = shadowAccountSource.slice(compactStart, compactEnd);

  assert.match(compactBlock, /readShadowMarketingFillsWithOrders/);
  assert.match(compactBlock, /withShadowReadCache\(/);
  assert.match(
    compactBlock,
    /ttlMs:\s*SHADOW_LEDGER_IDENTITY_CACHE_TTL_MS/,
  );
  assert.doesNotMatch(compactBlock, /\.select\(\)/);
  assert.doesNotMatch(
    compactBlock,
    /payload\.(profile|signal|orderPlan|quote|diagnostics)/,
  );

  const canonicalStart = shadowAccountSource.indexOf(
    "async function readShadowOrdersForAccountUncached",
  );
  const canonicalEnd = shadowAccountSource.indexOf(
    "async function readShadowOrdersForAccount()",
    canonicalStart,
  );
  assert.match(
    shadowAccountSource.slice(canonicalStart, canonicalEnd),
    /\.select\(\)/,
  );
});

test("marketing shadow APIs share the compact bundle and bound only returned histories", () => {
  assert.match(
    shadowAccountSource,
    /export async function getShadowMarketingOrders/,
  );
  assert.match(
    shadowAccountSource,
    /export async function getShadowMarketingClosedTrades/,
  );
  assert.match(
    shadowAccountSource,
    /readShadowMarketingLedgerBundle\(\)/,
  );
  assert.match(
    shadowAccountSource,
    /history:\s*history\.slice\(0, SHADOW_MARKETING_HISTORY_LIMIT\)/,
  );
  assert.match(
    shadowAccountSource,
    /trades:\s*trades\.slice\(0, SHADOW_MARKETING_HISTORY_LIMIT\)/,
  );
  assert.match(
    shadowAccountSource,
    /summary:\s*buildShadowClosedTradeSummary\(trades\)/,
  );
});

test("marketing positions retain canonical quote valuation and day-change semantics", () => {
  const wrapperStart = shadowAccountSource.indexOf(
    "export function getShadowMarketingPositions",
  );
  const wrapperEnd = shadowAccountSource.indexOf(
    "function dateFromShadowPositionResponse",
    wrapperStart,
  );
  const positionsStart = shadowAccountSource.indexOf(
    "export async function getShadowAccountPositions",
  );
  const positionsEnd = wrapperEnd;
  assert.notEqual(wrapperStart, -1);
  assert.notEqual(positionsStart, -1);

  const wrapper = shadowAccountSource.slice(wrapperStart, wrapperEnd);
  const positions = shadowAccountSource.slice(positionsStart, positionsEnd);
  assert.match(
    wrapper,
    /getShadowAccountPositions\(\{ detail: "marketing" \}\)/,
  );
  assert.match(positions, /await readShadowMarketingLedgerBundle\(\)/);
  assert.match(positions, /fetchShadowEquityPositionQuotes\(filtered\)/);
  assert.match(positions, /fetchShadowOptionUnderlyingMarkets\(filtered\)/);
  assert.match(positions, /fetchVisibleShadowOptionQuotes/);
  assert.match(positions, /readShadowPositionDayChanges/);
  assert.match(positions, /buildShadowOptionPricingPolicy/);
});

test("mark refresh invalidates marketing valuation caches but not compact ledger identity", () => {
  const isExpired =
    internals.isShadowReadCacheKeyExpiredByMarkRefreshForTests;
  assert.equal(isExpired("shadow ledger-bundle:marketing"), true);
  assert.equal(
    isExpired("shadow positions:all:ledger:live-quotes:marketing"),
    true,
  );
  assert.equal(
    isExpired("shadow marketing:compact-fills-with-orders"),
    false,
  );
});

test("summary day P&L reads only its explicitly selected equity-history cache", () => {
  const helperStart = shadowAccountSource.indexOf(
    "function readFreshCachedShadowEquityHistoryReturnMetrics",
  );
  const helperEnd = shadowAccountSource.indexOf(
    "export function getShadowAccountSummaryFromPositions",
    helperStart,
  );
  const helper = shadowAccountSource.slice(helperStart, helperEnd);

  assert.match(helper, /input\.detail === "marketing"/);
  assert.match(helper, /`\$\{cachePrefix\}:\$\{cacheSuffix\}`/);
  assert.doesNotMatch(helper, /\) \?\?/);
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

    restoreQueryLogger = captureShadowMarkWriteQueries(
      testDb,
      markWriteStatements,
    );
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
    assert.equal(tslaPosition.unrealizedPnl, testMoney((12.3456789 - 10) * 3));
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

    const markInserts = markWriteStatements.filter(
      (statement) =>
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

test("expired generic shadow reads wait for the fresh result", async () => {
  const key = `test-shadow-read-fresh-${Date.now()}-${Math.random()}`;
  let resolveRefresh: (value: TestShadowPositionsResponse) => void = () => {
    throw new Error("refresh promise was not initialized");
  };
  let refreshStarted = false;
  let refreshSettled = false;

  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 5,
  });

  try {
    await internals.withShadowReadCache(key, async () => ({
      positions: [{ id: "cached", symbol: "CACHED", assetClass: "stock" }],
      totals: {},
    }));

    await new Promise((resolve) => setTimeout(resolve, 15));

    const refresh = new Promise<TestShadowPositionsResponse>((resolve) => {
      resolveRefresh = resolve;
    });

    const pending = internals
      .withShadowReadCache(key, () => {
        refreshStarted = true;
        return refresh;
      })
      .then((value) => {
        refreshSettled = true;
        return value;
      });

    assert.equal(refreshStarted, true);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(refreshSettled, false);

    resolveRefresh({
      positions: [{ id: "fresh", symbol: "FRESH", assetClass: "stock" }],
      totals: {},
    });
    const fresh = await pending;
    assert.equal(fresh.stale, undefined);
    assert.equal(fresh.reason, undefined);
    assert.equal(fresh.positions[0]?.id, "fresh");
  } finally {
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
    });
  }
});

test("generic shadow read cache has no stale-serving strategy", () => {
  const optionsStart = shadowAccountSource.indexOf(
    "type ShadowReadCacheOptions",
  );
  const optionsEnd = shadowAccountSource.indexOf(
    "type ShadowReadDiagnosticStatus",
    optionsStart,
  );
  assert.notEqual(optionsStart, -1);
  assert.notEqual(optionsEnd, -1);
  assert.doesNotMatch(
    shadowAccountSource.slice(optionsStart, optionsEnd),
    /allowStale|staleStrategy|staleTtlMs/,
  );

  const cacheStart = shadowAccountSource.indexOf(
    "async function withShadowReadCache",
  );
  const cacheEnd = shadowAccountSource.indexOf(
    "async function withShadowRiskReadCache",
    cacheStart,
  );
  assert.notEqual(cacheStart, -1);
  assert.notEqual(cacheEnd, -1);
  const cacheBlock = shadowAccountSource.slice(cacheStart, cacheEnd);
  assert.doesNotMatch(
    cacheBlock,
    /staleStrategy|shadowReadStaleWaitMs|Promise\.race|setTimeout/,
  );
  assert.match(cacheBlock, /options\.serveStaleOnError/);
  assert.doesNotMatch(shadowAccountSource, /staleStrategy:/);
  assert.doesNotMatch(
    shadowAccountSource,
    /SHADOW_READ_CACHE_STALE|SHADOW_TRADE_DIAGNOSTICS_CACHE_STALE/,
  );
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
      { ttlMs: 5 },
    );
    await new Promise((resolve) => setTimeout(resolve, 15));

    const timeout = Object.assign(
      new Error("canceling statement due to statement timeout"),
      { code: "57014" },
    );
    const stale =
      await internals.withShadowRiskReadCache<TestShadowRiskResponse>(
        key,
        async () => {
          throw timeout;
        },
        { ttlMs: 5 },
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
  const lockError = Object.assign(
    new Error("could not obtain lock on relation"),
    {
      code: "55P03",
    },
  );

  await assert.rejects(
    () =>
      internals.withShadowRiskReadCache(
        `test-shadow-risk-empty-${Date.now()}-${Math.random()}`,
        async () => {
          throw lockError;
        },
        { ttlMs: 5 },
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
      { ttlMs: 5 },
    );
    await new Promise((resolve) => setTimeout(resolve, 15));

    await assert.rejects(
      () =>
        internals.withShadowRiskReadCache(
          key,
          async () => {
            throw new TypeError("risk model invariant failed");
          },
          { ttlMs: 5 },
        ),
      (error: unknown) =>
        error instanceof TypeError &&
        error.message === "risk model invariant failed",
    );
  } finally {
    internals.invalidateShadowFreshStateCache();
  }
});

test("shadow risk degraded classifier includes explicit shadow DB outages", () => {
  const cases: Array<[unknown, string]> = [
    [
      Object.assign(new Error("query canceled"), { code: "57014" }),
      "statement_timeout",
    ],
    [
      Object.assign(new Error("could not obtain lock on relation"), {
        code: "55P03",
      }),
      "lock_not_available",
    ],
    [new Error("canceling statement due to lock timeout"), "lock_wait_timeout"],
    [
      new Error("Lock wait timeout exceeded; try restarting transaction"),
      "lock_wait_timeout",
    ],
    [
      new Error("pool timed out while waiting for an open connection"),
      "pool_acquire_timeout",
    ],
    [
      new Error("timeout exceeded when trying to connect"),
      "pool_acquire_timeout",
    ],
    [
      internals.createShadowAccountDbUnavailableError(
        Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      ),
      "shadow_account_db_unavailable",
    ],
  ];

  for (const [error, expected] of cases) {
    assert.equal(internals.shadowRiskDegradedErrorReason(error), expected);
  }
  assert.equal(
    internals.shadowRiskDegradedErrorReason(
      new TypeError("risk model invariant failed"),
    ),
    null,
  );
});

test("background mark refresh keeps order and history caches hot", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 60_000,
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
    await internals.withShadowReadCache(
      "dashboard:fills-with-orders",
      readFills,
    );
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
    const summary = await internals.withShadowReadCache(
      "summary:all",
      readSummary,
    );

    assert.deepEqual(orders, { reads: 1 });
    assert.deepEqual(fills, { reads: 1 });
    assert.deepEqual(history, { reads: 1 });
    // Mark-affected key within its natural TTL age: stale-while-revalidate serves
    // the cached value immediately (no blocking multi-second ledger rebuild)...
    assert.deepEqual(summary, { reads: 1 });
    // ...while a single background revalidation lands the fresh value, so the
    // next read serves it as a plain hit without another factory call.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(summaryReads, 2);
    const summaryAfterRevalidation = await internals.withShadowReadCache(
      "summary:all",
      readSummary,
    );
    assert.deepEqual(summaryAfterRevalidation, { reads: 2 });
    assert.equal(summaryReads, 2);
  } finally {
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
    });
  }
});

test("mark refresh during an in-flight non-mark-affected compute keeps the cached store", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 60_000,
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
    });
  }
});

test("mark refresh during an in-flight mark-affected compute still discards its store", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 60_000,
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

    const second = await internals.withShadowReadCache(
      "summary:all",
      async () => {
        summaryReads += 1;
        return { reads: summaryReads };
      },
    );
    assert.deepEqual(second, { reads: 2 });
    assert.equal(summaryReads, 2);
  } finally {
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
    });
  }
});

test("shadow option quote cache has one fresh expiry horizon", () => {
  const constantsStart = shadowAccountSource.indexOf(
    "const SHADOW_OPTION_QUOTE_CACHE_TTL_MS",
  );
  const constantsEnd = shadowAccountSource.indexOf(
    "const SHADOW_OPTION_PROVIDER_ID_CACHE_TTL_MS",
    constantsStart,
  );
  assert.notEqual(constantsStart, -1);
  assert.notEqual(constantsEnd, -1);
  assert.doesNotMatch(
    shadowAccountSource.slice(constantsStart, constantsEnd),
    /STALE/,
  );

  const cacheStart = shadowAccountSource.indexOf(
    "const shadowOptionQuoteCache =",
  );
  const cacheEnd = shadowAccountSource.indexOf(
    "const shadowOptionGreekQuoteCache =",
    cacheStart,
  );
  assert.notEqual(cacheStart, -1);
  assert.notEqual(cacheEnd, -1);
  assert.doesNotMatch(
    shadowAccountSource.slice(cacheStart, cacheEnd),
    /staleExpiresAt/,
  );

  const readStart = shadowAccountSource.indexOf(
    "function rememberShadowOptionQuote",
  );
  const readEnd = shadowAccountSource.indexOf(
    "function rememberShadowOptionGreekQuote",
    readStart,
  );
  assert.notEqual(readStart, -1);
  assert.notEqual(readEnd, -1);
  const readBlock = shadowAccountSource.slice(readStart, readEnd);
  assert.doesNotMatch(readBlock, /staleExpiresAt/);
  assert.doesNotMatch(readBlock, /allowStale/);
});

test("shadow option quote cache drops display quotes at the fresh TTL", async () => {
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
  });

  try {
    internals.rememberShadowOptionQuoteForTests(providerContractId, {
      providerContractId,
      bid: 1.23,
      ask: 1.35,
      updatedAt: "2026-06-08T15:56:31.004Z",
    });

    await new Promise((resolve) => setTimeout(resolve, 15));

    const freshOnly = internals.readCachedShadowOptionQuotesForTests(positions);
    assert.equal(freshOnly.size, 0);
  } finally {
    internals.clearShadowOptionQuoteCachesForTests();
    internals.setShadowOptionQuoteCacheWindowsForTests({
      ttlMs: null,
    });
  }
});

test("empty option quote updates do not renew an expired display quote", async () => {
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
    ttlMs: 5,
  });

  try {
    internals.rememberShadowOptionQuoteForTests(providerContractId, {
      providerContractId,
      bid: 2.1,
      ask: 2.3,
      updatedAt: "2026-06-08T15:56:31.004Z",
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    internals.rememberShadowOptionQuoteForTests(providerContractId, {
      providerContractId,
      updatedAt: "2026-06-08T15:56:32.004Z",
    });

    const quotes = internals.readCachedShadowOptionQuotesForTests(positions);
    assert.equal(quotes.size, 0);
  } finally {
    internals.clearShadowOptionQuoteCachesForTests();
    internals.setShadowOptionQuoteCacheWindowsForTests({
      ttlMs: null,
    });
  }
});

test("shadow account positions have no pressure fallback or last-known substitution", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function getShadowAccountPositions",
  );
  const end = source.indexOf("function dateFromShadowPositionResponse", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(block, /return withShadowReadCache\(/);
  assert.doesNotMatch(source, /shouldServeFastShadowPositionsForPressure/);
  assert.doesNotMatch(source, /buildFastShadowPositionsResponse/);
  assert.doesNotMatch(source, /lastKnownShadowPosition/);
  assert.doesNotMatch(source, /positionsFastPath/);
  assert.doesNotMatch(source, /positions-fast:/);
  assert.doesNotMatch(source, /shadowReadCacheValueHasRows/);
});

test("shadow reusable position caches only reuse fresh entries", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const boundaries = [
    [
      "function readReusableShadowPositionsResponseForAssetClass",
      "function readReusableLiveQuotedShadowPositionsResponse",
    ],
    [
      "function readReusableLiveQuotedShadowPositionsResponse",
      "function readReusableShadowAllocationFromPositions",
    ],
    [
      "function readReusableShadowAllocationFromPositions",
      "export async function getShadowAccountPositions",
    ],
  ];

  for (const [startMarker, endMarker] of boundaries) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing ${startMarker}`);
    assert.notEqual(end, -1, `Missing boundary after ${startMarker}`);
    const block = source.slice(start, end);
    assert.match(block, /cached\.expiresAt <= now/);
    assert.doesNotMatch(block, /cached\.staleExpiresAt/);
    assert.doesNotMatch(block, /markShadowReadValueStale/);
    assert.doesNotMatch(block, /getApiResourcePressureSnapshot/);
  }
});

test("shared dashboard fills+orders read waits for a fresh result at the derived TTL", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function readShadowDashboardFillsWithOrders");
  const end = source.indexOf(
    "async function readShadowFillsForOrderIds",
    start,
  );
  assert.notEqual(start, -1, "Missing readShadowDashboardFillsWithOrders");
  assert.notEqual(
    end,
    -1,
    "Missing function boundary after dashboard fills read",
  );
  const block = source.slice(start, end);

  assert.match(block, /"dashboard:fills-with-orders"/);
  assert.match(block, /ttlMs:\s*SHADOW_DERIVED_READ_CACHE_TTL_MS/);
});

test("Account shadow readers report database outages instead of fabricating account data", () => {
  assert.doesNotMatch(
    shadowAccountSource,
    /buildFallbackShadowTotals|buildFallbackShadowAccountEquityHistory|buildEmptyShadowAccountPositionsResponse|SHADOW_RUNTIME_FALLBACK|shadowStartingBalanceForFastSummary/,
  );
  assert.doesNotMatch(shadowAccountSource, /degraded:\s*true/);
  assert.match(shadowAccountSource, /code:\s*"shadow_account_db_unavailable"/);
  assert.match(shadowAccountSource, /startingBalance:\s*totals\.startingBalance/);

  const cause = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  const error = internals.createShadowAccountDbUnavailableError(cause);
  assert.equal(error.statusCode, 503);
  assert.equal(error.code, "shadow_account_db_unavailable");
  assert.equal(error.expose, true);
  assert.equal((error as Error & { cause?: unknown }).cause, cause);
});

test("equity-history reports DB backoff instead of fabricating history", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function getShadowAccountEquityHistory",
  );
  const end = source.indexOf(
    "function readFreshCachedShadowEquityHistoryReturnMetrics",
    start,
  );
  assert.notEqual(start, -1, "Missing getShadowAccountEquityHistory");
  assert.notEqual(
    end,
    -1,
    "Missing function boundary after equity-history reader",
  );
  const block = source.slice(start, end);
  assert.match(block, /isShadowAccountDbBackoffActive\(\)/);
  assert.match(block, /createShadowAccountDbUnavailableError\(\)/);
  assert.match(block, /readShadowEquityHistorySnapshotRowsBucketed\(\{/);
  assert.doesNotMatch(block, /hardResourceLevel/);
  assert.doesNotMatch(block, /equityHistoryPressureFallback/);
});

test("shared dashboard fills+orders read is bounded and uses a 30s derived TTL", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "async function readBoundedShadowFillsWithOrders",
  );
  const end = source.indexOf(
    "function readShadowDashboardFillsWithOrders",
    start,
  );
  assert.notEqual(start, -1, "Missing bounded dashboard fills reader");
  assert.notEqual(
    end,
    -1,
    "Missing function boundary after bounded fills reader",
  );
  const block = source.slice(start, end);

  assert.match(source, /const SHADOW_DERIVED_READ_CACHE_TTL_MS = 30_000;/);
  assert.match(source, /const SHADOW_LEDGER_DASHBOARD_READ_LIMIT =/);
  assert.match(block, /orderBy\(desc\(shadowFillsTable\.occurredAt\)\)/);
  assert.match(block, /\.limit\(shadowLedgerDashboardReadLimit\(\)\)/);
  assert.match(block, /readCachedShadowOrdersByFillOrderId\(fills\)/);
});

test("read-side fill analysis reuses cached account orders and fetches only misses", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const helperStart = source.indexOf(
    "async function readCachedShadowOrdersByFillOrderId",
  );
  const helperEnd = source.indexOf(
    "\nasync function readShadowFillsWithOrders",
    helperStart,
  );
  assert.notEqual(helperStart, -1, "Missing cached fill-order reader");
  assert.notEqual(helperEnd, -1, "Missing cached fill-order reader boundary");
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /await readShadowOrdersForAccount\(\)/);
  assert.match(helper, /missingOrderIds/);
  assert.match(
    helper,
    /readShadowOrdersByFillOrderId\(\s*missingOrderIds\.map/,
  );

  const analysisStart = source.indexOf(
    "async function readShadowAnalysisLedgerRows",
  );
  const analysisEnd = source.indexOf(
    "\nasync function readShadowAnalysisLedgerFold",
    analysisStart,
  );
  const analysis = source.slice(analysisStart, analysisEnd);
  assert.match(analysis, /readCachedShadowOrdersByFillOrderId\(fills\)/);

  const equityEventsStart = source.indexOf(
    "async function getShadowTradeEquityEvents",
  );
  const equityEventsEnd = source.indexOf(
    "\nexport async function getShadowAccountCashActivity",
    equityEventsStart,
  );
  assert.notEqual(equityEventsStart, -1, "Missing trade equity-event reader");
  assert.notEqual(
    equityEventsEnd,
    -1,
    "Missing trade equity-event reader boundary",
  );
  const equityEvents = source.slice(equityEventsStart, equityEventsEnd);
  assert.match(
    equityEvents,
    /readCachedShadowOrdersByFillOrderId\(fills\)/,
  );
});

test("default equity annotations reuse the shared analysis fold", () => {
  const start = shadowAccountSource.indexOf(
    "async function getShadowTradeEquityEvents",
  );
  const end = shadowAccountSource.indexOf(
    "\nexport async function getShadowAccountOrders",
    start,
  );
  assert.notEqual(start, -1, "Missing trade equity-event reader");
  assert.notEqual(end, -1, "Missing trade equity-event reader boundary");
  const block = shadowAccountSource.slice(start, end);

  assert.match(
    block,
    /const sources = input\.sources;\s*if \(!sources\?\.length\)/,
  );
  assert.match(
    block,
    /readShadowAnalysisLedgerFold\(\{\s*scope: null,\s*\}\)/,
  );
});

test("automation ledger realized P&L keeps the all-time source path", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
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
  assert.match(
    realizedBlock,
    /readShadowLedgerBundleForSource\("automation"\)/,
  );

  const ordersStart = source.indexOf(
    "async function readShadowOrdersForSource",
  );
  const ordersEnd = source.indexOf(
    "async function readShadowFillsWithOrdersForSource",
    ordersStart,
  );
  assert.notEqual(ordersStart, -1);
  assert.notEqual(ordersEnd, -1);
  const ordersBlock = source.slice(ordersStart, ordersEnd);
  const automationBranch = ordersBlock.slice(
    ordersBlock.indexOf("const orders = await db"),
  );
  assert.doesNotMatch(automationBranch, /shadowLedgerDashboardReadLimit/);
});

test("shared dashboard fills+orders read joins one in-flight operation", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 60_000,
  });

  let reads = 0;
  let releaseRead: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const value = { fills: [], ordersById: new Map() };

  try {
    const first = internals.readShadowDashboardFillsWithOrdersForTests(
      async () => {
        reads += 1;
        await gate;
        return value;
      },
    );
    const second = internals.readShadowDashboardFillsWithOrdersForTests(
      async () => {
        reads += 1;
        return { fills: [], ordersById: new Map() };
      },
    );

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
    });
  }
});

test("tax overview and events join one shared analysis-fold computation", async () => {
  internals.invalidateShadowFreshStateCache();

  let reads = 0;
  let releaseRead: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const input = {
    scope: "all" as const,
    start: new Date("2026-01-01T00:00:00.000Z"),
    end: new Date("2027-01-01T00:00:00.000Z"),
    endInclusive: false as const,
  };

  try {
    const first = internals.readShadowAnalysisLedgerFoldForTests(
      input,
      async () => {
        reads += 1;
        await gate;
        return { fills: [], ordersById: new Map() };
      },
    );
    const second = internals.readShadowAnalysisLedgerFoldForTests(
      input,
      async () => {
        reads += 1;
        return { fills: [], ordersById: new Map() };
      },
    );

    await waitTurn();
    assert.equal(reads, 1);
    releaseRead();
    const [overviewFold, eventsFold] = await Promise.all([first, second]);
    assert.equal(overviewFold, eventsFold);
    assert.deepEqual(overviewFold.roundTrips, []);
    assert.equal(reads, 1);
  } finally {
    releaseRead();
    await waitTurn();
    internals.invalidateShadowFreshStateCache();
  }
});

test("ledger mutation invalidation recomputes the shared analysis fold", async () => {
  internals.invalidateShadowFreshStateCache();
  let reads = 0;
  const reader = async () => {
    reads += 1;
    return { fills: [], ordersById: new Map() };
  };

  try {
    await internals.readShadowAnalysisLedgerFoldForTests(
      { scope: "all" },
      reader,
    );
    await internals.readShadowAnalysisLedgerFoldForTests(
      { scope: "all" },
      reader,
    );
    assert.equal(reads, 1);

    // Fill/order commit paths call this generation bump before broadcasting.
    internals.invalidateShadowFreshStateCache();
    await internals.readShadowAnalysisLedgerFoldForTests(
      { scope: "all" },
      reader,
    );
    assert.equal(reads, 2);
  } finally {
    internals.invalidateShadowFreshStateCache();
  }
});

test("closed trades and tax use the bounded shared fold without capturing fresh write reads", () => {
  const sourceBlock = (
    source: string,
    startMarker: string,
    endMarker: string,
  ) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return source.slice(start, end);
  };
  const closed = sourceBlock(
    shadowAccountSource,
    "export async function getShadowAccountClosedTrades",
    "function buildDeferredShadowClosedTradesForFastRisk",
  );
  const snapshot = sourceBlock(
    shadowAccountSource,
    "async function computeShadowSnapshotTotalsAt",
    "async function computeShadowTotalsForSource",
  );
  const watchlist = sourceBlock(
    shadowAccountSource,
    "async function computeWatchlistBacktestStartingBook",
    "async function writeShadowBalanceSnapshot",
  );
  const freshCarveOuts = [
    snapshot,
    watchlist,
    sourceBlock(
      shadowAccountSource,
      "async function buildShadowFillPlan",
      "export async function previewShadowOrder",
    ),
    sourceBlock(
      shadowAccountSource,
      "export async function computeSignalOptionsLedgerRealizedForDeployment",
      "function buildShadowCashActivityTotalsFromAccount",
    ),
  ];
  assert.match(closed, /readShadowAnalysisLedgerFold\(/);
  assert.match(closed, /!Number\.isFinite\(input\.to\.getTime\(\)\)/);
  for (const carveOut of freshCarveOuts) {
    assert.doesNotMatch(carveOut, /readShadowAnalysisLedgerFold\(/);
  }
  assert.match(snapshot, /readShadowFillsWithOrders\(\)/);
  assert.match(watchlist, /readShadowFillsWithOrders\(\)/);

  const taxSource = readFileSync(
    new URL("./tax-planning.ts", import.meta.url),
    "utf8",
  );
  const taxLoader = sourceBlock(
    taxSource,
    "async function loadShadowTaxFills",
    "function summarizeShadowTaxFills",
  );
  assert.match(taxLoader, /await import\("\.\/shadow-account"\)/);
  assert.match(taxLoader, /readShadowTaxFillsFromSharedFold/);
  assert.doesNotMatch(taxLoader, /\.from\(shadowFillsTable\)/);

  const cacheInput = {
    source: null,
    from: null,
    to: null,
    symbol: null,
    assetClassFilter: null,
    pnlSign: null,
  };
  assert.notEqual(
    internals.shadowClosedTradesReadCacheKey(cacheInput),
    internals.shadowClosedTradesReadCacheKey({
      ...cacheInput,
      to: new Date("invalid"),
    }),
  );
});

test("shadow order tabs share the cached full account order scan", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const ordersStart = source.indexOf(
    "export async function getShadowAccountOrders",
  );
  const ordersEnd = source.indexOf(
    "\nfunction shadowResponseReason",
    ordersStart,
  );
  assert.notEqual(ordersStart, -1, "Missing getShadowAccountOrders");
  assert.notEqual(ordersEnd, -1, "Missing function boundary after orders");
  const ordersBody = source.slice(ordersStart, ordersEnd);

  assert.match(ordersBody, /readShadowOrdersForDisplay\(source\)/);
  assert.match(ordersBody, /`orders:all:\$\{shadowSourceCacheKey\(source\)\}`/);
  assert.match(ordersBody, /SHADOW_DERIVED_READ_CACHE_TTL_MS/);
});

test("account-level shadow order scan uses the mutation-invalidated identity cache", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function readShadowOrdersForAccount()");
  const end = source.indexOf(
    "\nasync function readShadowOrdersForSource",
    start,
  );
  assert.notEqual(start, -1, "Missing readShadowOrdersForAccount");
  assert.notEqual(end, -1, "Missing function boundary after account orders");
  const body = source.slice(start, end);

  assert.match(body, /withShadowReadCache\(/);
  assert.match(body, /`orders:account-bounded:\$\{limit\}`/);
  assert.match(body, /ttlMs:\s*SHADOW_LEDGER_IDENTITY_CACHE_TTL_MS/);
  assert.match(
    source,
    /const SHADOW_LEDGER_IDENTITY_CACHE_TTL_MS = 5 \* 60_000;/,
  );
});

test("shared-ledger watchlist backtest writes invalidate the order identity cache", () => {
  const resetStart = shadowAccountSource.indexOf(
    "async function resetWatchlistBacktestRowsForRange",
  );
  const resetEnd = shadowAccountSource.indexOf(
    "\nfunction signalOptionsReplayOrderMatchesDate",
    resetStart,
  );
  assert.notEqual(resetStart, -1, "Missing watchlist backtest reset writer");
  assert.notEqual(resetEnd, -1, "Missing watchlist backtest reset boundary");
  assert.match(
    shadowAccountSource.slice(resetStart, resetEnd),
    /await db\.transaction[\s\S]*invalidateShadowFreshStateCache\(\);/,
  );

  const insertStart = shadowAccountSource.indexOf(
    "async function insertWatchlistBacktestFills",
  );
  const insertEnd = shadowAccountSource.indexOf(
    "\nexport const __shadowWatchlistBacktestInternalsForTests",
    insertStart,
  );
  assert.notEqual(insertStart, -1, "Missing watchlist backtest insert writer");
  assert.notEqual(insertEnd, -1, "Missing watchlist backtest insert boundary");
  assert.match(
    shadowAccountSource.slice(insertStart, insertEnd),
    /await db\.transaction[\s\S]*invalidateShadowFreshStateCache\(\);/,
  );
});

test("shadow trade diagnostics waits for a fresh shared read", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function computeShadowTradeDiagnostics",
  );
  const end = source.indexOf(
    "\nasync function getShadowTradeEquityEvents",
    start,
  );
  assert.notEqual(start, -1, "Missing computeShadowTradeDiagnostics");
  assert.notEqual(end, -1, "Missing function boundary after diagnostics");
  const body = source.slice(start, end);

  assert.match(body, /withShadowReadCache\(/);
  assert.match(body, /`trade-diagnostics:\$\{range\}`/);
  assert.match(body, /SHADOW_TRADE_DIAGNOSTICS_CACHE_TTL_MS/);
});

test("read diagnostics no longer expose fallback serve counters", async () => {
  const { getShadowAccountReadDiagnostics } = await import("./shadow-account");
  const diagnostics = getShadowAccountReadDiagnostics();
  assert.equal("pressureDegrades" in diagnostics, false);
});
