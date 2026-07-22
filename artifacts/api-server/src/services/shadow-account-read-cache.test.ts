import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { asc, eq, sql } from "drizzle-orm";

import {
  db,
  shadowAccountsTable,
  shadowBalanceSnapshotsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
} from "@workspace/db";
import { createTestDb } from "@workspace/db/testing";

import {
  __shadowWatchlistBacktestInternalsForTests as internals,
  computeSignalOptionsLedgerRealizedForDeployment,
  getShadowAccountPositions,
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

test("shadow analysis DTE uses the shared account calendar-day contract", () => {
  const start = shadowAccountSource.indexOf("function roundTripDte");
  const end = shadowAccountSource.indexOf(
    "function roundTripStrikeSlot",
    start,
  );
  assert.notEqual(start, -1, "Missing roundTripDte");
  assert.notEqual(end, -1, "Missing roundTripDte end marker");
  const body = shadowAccountSource.slice(start, end);

  assert.match(body, /accountOptionCalendarDte\(/);
  assert.doesNotMatch(body, /selectedExpiration\.dte|getUTCFullYear/);
});

function analysisOrder(id: string, payload: Record<string, unknown> = {}) {
  return {
    id,
    source: "automation",
    clientOrderId: null,
    sourceEventId: null,
    payload,
  } as never;
}

function analysisFill(id: string, orderId: string) {
  return {
    id,
    orderId,
    accountId: SHADOW_ACCOUNT_ID,
    symbol: "AAPL",
    assetClass: "equity",
    positionType: "long",
    side: "buy",
    quantity: "1",
    price: "100",
    grossAmount: "100",
    fees: "1",
    realizedPnl: "0",
    cashDelta: "-101",
    optionContract: null,
    occurredAt: new Date("2026-07-14T14:00:00.000Z"),
  } as never;
}

test("shadow option valuation uses premium multiplier before deliverable shares", () => {
  assert.equal(
    internals.marketMultiplierForTests({
      assetClass: "option",
      optionContract: {
        ticker: "O:BMNG1260717P00011000",
        underlying: "BMNG",
        expirationDate: new Date("2026-07-17T00:00:00.000Z"),
        strike: 11,
        right: "put",
        multiplier: 100,
        sharesPerContract: 5,
        providerContractId: "O:BMNG1260717P00011000",
      },
    }),
    100,
  );
});

test("shadow option Spot falls back only to a trusted Massive option snapshot", () => {
  const explicit = internals.buildShadowUnderlyingMarketPayloadForTests({
    symbol: "AAP",
    quote: {
      symbol: "AAP",
      price: 55.5,
      updatedAt: new Date("2026-07-21T19:35:00.000Z"),
    },
    optionQuote: {
      underlyingPrice: 55.48,
      transport: "massive_rest",
      updatedAt: new Date("2026-07-21T19:35:01.000Z"),
    },
  });
  assert.equal(explicit?.price, 55.5);
  assert.equal(explicit?.source, "underlying_quote");

  const fallback = internals.buildShadowUnderlyingMarketPayloadForTests({
    symbol: "AAP",
    quote: null,
    optionQuote: {
      underlyingPrice: 55.48,
      transport: "massive_rest",
      updatedAt: new Date("2026-07-21T19:35:01.000Z"),
    },
  });
  assert.equal(fallback?.price, 55.48);
  assert.equal(fallback?.source, "massive_option_snapshot");

  assert.equal(
    internals.buildShadowUnderlyingMarketPayloadForTests({
      symbol: "AAP",
      quote: null,
      optionQuote: {
        underlyingPrice: 55.48,
        transport: "client_portal",
      },
    }),
    null,
  );

  const positionsStart = shadowAccountSource.indexOf(
    "export async function getShadowAccountPositions",
  );
  const positionsEnd = shadowAccountSource.indexOf(
    "function dateFromShadowPositionResponse",
    positionsStart,
  );
  assert.notEqual(positionsStart, -1, "Missing shadow positions reader");
  assert.notEqual(positionsEnd, -1, "Missing shadow positions end marker");
  const positions = shadowAccountSource.slice(positionsStart, positionsEnd);

  assert.match(
    positions,
    /quote:\s*rawUnderlyingMarket/,
  );
  assert.match(
    positions,
    /optionQuote:\s*rawOptionQuote/,
  );
});

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
  assert.match(
    body,
    /runInDbLane\(\s*"background",\s*refreshShadowPositionMarks\s*\)/,
  );
});

test("Shadow account reads do not trigger mirror repair work", () => {
  assert.doesNotMatch(
    shadowAccountSource,
    /kickSignalOptionsAutomationMirrorRepairForRead/,
  );

  const readSlices = [
    [
      "export async function getShadowAccountSummary",
      "export async function getShadowAccountEquityHistory",
    ],
    [
      "export async function getShadowAccountAllocation",
      "type ShadowAccountPositionsResponseRow",
    ],
    [
      "export async function getShadowAccountPositions",
      "function dateFromShadowPositionResponse",
    ],
  ] as const;
  for (const [startMarker, endMarker] of readSlices) {
    const start = shadowAccountSource.indexOf(startMarker);
    const end = shadowAccountSource.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing ${startMarker}`);
    assert.notEqual(end, -1, `Missing ${endMarker}`);
    assert.doesNotMatch(
      shadowAccountSource.slice(start, end),
      /repairSignalOptionsAutomationMirrors/,
      startMarker,
    );
  }
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
  assert.match(compactBlock, /ttlMs:\s*SHADOW_LEDGER_IDENTITY_CACHE_TTL_MS/);
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

test("marketing identity read does not orphan an orders query when fills fail", () => {
  const start = shadowAccountSource.indexOf(
    "function readShadowMarketingFillsWithOrders()",
  );
  const end = shadowAccountSource.indexOf(
    "\nasync function readShadowOrdersForAccountUncached",
    start,
  );
  assert.notEqual(start, -1, "Missing marketing identity reader");
  assert.notEqual(end, -1, "Missing marketing identity reader boundary");
  const body = shadowAccountSource.slice(start, end);

  assert.doesNotMatch(body, /Promise\.all\(/);
  assert.match(body, /const fills = await db[\s\S]*const orders = await db/);
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
  assert.match(shadowAccountSource, /readShadowMarketingLedgerBundle\(\)/);
  assert.match(
    shadowAccountSource,
    /history:\s*history\s*\.slice\(0, SHADOW_MARKETING_HISTORY_LIMIT\)/,
  );
  assert.match(
    shadowAccountSource,
    /trades:\s*trades\.slice\(0, SHADOW_MARKETING_HISTORY_LIMIT\)/,
  );
  assert.match(
    shadowAccountSource,
    /summary:\s*summarizeAccountClosedTrades\(trades\)/,
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

test("fast shadow positions skip optional history enrichments on the structural path", () => {
  const positionsStart = shadowAccountSource.indexOf(
    "export async function getShadowAccountPositions",
  );
  const positionsEnd = shadowAccountSource.indexOf(
    "export function getShadowMarketingPositions",
    positionsStart,
  );
  assert.notEqual(positionsStart, -1);
  assert.notEqual(positionsEnd, -1);
  const positions = shadowAccountSource.slice(positionsStart, positionsEnd);

  assert.match(positions, /detail\?:\s*"fast"\s*\|\s*"marketing"/);
  assert.match(positions, /const fast = input\.detail === "fast"/);
  assert.match(
    positions,
    /const detailCacheSuffix = marketing \? ":marketing" : fast \? ":fast" : ""/,
    "fast structural rows must not replace the fully enriched positions cache",
  );
  assert.match(
    positions,
    /const automationManagementEvents =\s*marketing \|\| fast\s*\?\s*new Map[\s\S]*?: await latestShadowAutomationManagementEvents/s,
  );
  assert.match(
    positions,
    /const dayChanges = fast\s*\?\s*new Map[\s\S]*?: await readShadowPositionDayChanges/s,
  );
  assert.match(
    positions,
    /const peakMarkByPositionId =\s*marketing \|\| fast\s*\?\s*new Map[\s\S]*?: await readShadowPositionPeakMarkPrices/s,
  );
});

test("mark refresh invalidates marketing valuation caches but not compact ledger identity", () => {
  const isExpired = internals.isShadowReadCacheKeyExpiredByMarkRefreshForTests;
  assert.equal(isExpired("shadow ledger-bundle:marketing"), true);
  assert.equal(
    isExpired("shadow positions:all:ledger:live-quotes:marketing"),
    true,
  );
  assert.equal(isExpired("shadow marketing:compact-fills-with-orders"), false);
});

test("ledger bundle cache keeps canonical and current-terminal timestamp modes separate in both concurrent orders", async () => {
  const testDb = await createTestDb();
  const accountId = "shadow-ledger-bundle-mode-cache";
  const ledgerAt = new Date("2026-07-14T16:00:00.000Z");
  const currentAt = new Date("2026-07-17T12:00:00.000Z");

  try {
    await db.insert(shadowAccountsTable).values({
      id: accountId,
      displayName: "Ledger bundle cache test",
      currency: "USD",
      startingBalance: "25000",
      cash: "24900",
      status: "active",
      createdAt: new Date("2026-07-14T14:00:00.000Z"),
      updatedAt: ledgerAt,
    });
    const [order] = await db
      .insert(shadowOrdersTable)
      .values({
        accountId,
        source: "manual",
        symbol: "AAPL",
        assetClass: "equity",
        side: "buy",
        quantity: "1",
        filledQuantity: "1",
        placedAt: new Date("2026-07-14T15:59:00.000Z"),
        updatedAt: ledgerAt,
      })
      .returning({ id: shadowOrdersTable.id });
    await db.insert(shadowFillsTable).values({
      accountId,
      orderId: order!.id,
      symbol: "AAPL",
      assetClass: "equity",
      side: "buy",
      quantity: "1",
      price: "100",
      grossAmount: "100",
      cashDelta: "-100",
      occurredAt: ledgerAt,
      createdAt: ledgerAt,
      updatedAt: ledgerAt,
    });
    await db.insert(shadowPositionsTable).values({
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
      asOf: ledgerAt,
      createdAt: ledgerAt,
      updatedAt: ledgerAt,
    });

    const runPair = async (currentFirst: boolean) => {
      internals.invalidateShadowFreshStateCache();
      return runWithShadowAccountId(accountId, async () => {
        const current = () =>
          internals.readShadowLedgerBundleForSourceForTests(null, {
            useCurrentTimestampForOpenPositions: true,
            now: currentAt,
          });
        const canonical = () =>
          internals.readShadowLedgerBundleForSourceForTests(null);
        const first = currentFirst ? current() : canonical();
        await waitTurn();
        const second = currentFirst ? canonical() : current();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        return currentFirst
          ? { current: firstResult, canonical: secondResult }
          : { canonical: firstResult, current: secondResult };
      });
    };

    for (const currentFirst of [true, false]) {
      const result = await runPair(currentFirst);
      assert.equal(
        result.canonical.totals.updatedAt.getTime(),
        ledgerAt.getTime(),
      );
      assert.equal(
        result.current.totals.updatedAt.getTime(),
        currentAt.getTime(),
      );
    }

    for (const closedAt of [
      new Date("2026-07-18T16:00:00.000Z"),
      new Date("2026-11-26T17:00:00.000Z"),
    ]) {
      internals.invalidateShadowFreshStateCache();
      const result = await runWithShadowAccountId(accountId, () =>
        internals.readShadowLedgerBundleForSourceForTests(null, {
          useCurrentTimestampForOpenPositions: true,
          now: closedAt,
        }),
      );
      assert.equal(
        result.totals.updatedAt.getTime(),
        ledgerAt.getTime(),
        `closed NYSE date ${closedAt.toISOString()} must keep the ledger timestamp`,
      );
    }
  } finally {
    internals.invalidateShadowFreshStateCache();
    await testDb.cleanup();
  }
});

test("summary Day P&L waits for canonical history instead of publishing a timeout fallback", () => {
  const resolverStart = shadowAccountSource.indexOf(
    "async function resolveShadowAccountSummaryReturnMetrics",
  );
  const resolverEnd = shadowAccountSource.indexOf(
    "function buildShadowAccountSummaryResponse",
    resolverStart,
  );
  const resolver = shadowAccountSource.slice(resolverStart, resolverEnd);
  const injectedStart = shadowAccountSource.indexOf(
    "export async function getShadowAccountSummaryFromPositions",
  );
  const injectedEnd = shadowAccountSource.indexOf(
    "function shadowResponseAssetClassLabel",
    injectedStart,
  );
  const injected = shadowAccountSource.slice(injectedStart, injectedEnd);

  assert.match(resolver, /getShadowAccountEquityHistory\(\{\s*range:\s*"1Y"/);
  assert.doesNotMatch(resolver, /Promise\.race|setTimeout|MAX_WAIT/);
  assert.match(injected, /await resolveShadowAccountSummaryReturnMetrics\(/);
});

test("positions-at-date values open books with historical marks, not the last fill price", () => {
  const start = shadowAccountSource.indexOf(
    "async function getFreshShadowAccountPositionsAtDate",
  );
  const end = shadowAccountSource.indexOf(
    "function shadowClosedTradesDateCachePart",
    start,
  );
  const block = shadowAccountSource.slice(start, end);

  assert.match(
    block,
    /const valuationAt = shadowPositionInspectionValuationAt\(/,
  );
  assert.match(block, /lte\(shadowFillsTable\.occurredAt,\s*valuationAt\)/);
  assert.match(block, /latestShadowPositionMarksAt\(/);
  assert.match(block, /latestShadowPositionMarksAt\([\s\S]*?valuationAt/);
  assert.match(
    block,
    /book\.mark\s*=\s*toNumber\(mark\?\.mark\)\s*\?\?\s*book\.mark/,
  );
  assert.match(
    block,
    /snapshotDate:\s*positions\.length \? valuationAt : null/,
  );
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
      openedAt: new Date("2026-07-09T14:00:00.000Z"),
      asOf: new Date("2026-07-09T14:00:00.000Z"),
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
  const positionAsOf = new Date("2026-07-08T14:30:00.000Z");

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
        openedAt: positionAsOf,
        asOf: positionAsOf,
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
        openedAt: positionAsOf,
        asOf: positionAsOf,
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
        openedAt: positionAsOf,
        asOf: positionAsOf,
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
  assert.match(
    shadowAccountSource,
    /startingBalance:\s*totals\.startingBalance/,
  );

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
    "export function getShadowMarketingEquityHistory",
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
  assert.match(
    block,
    /orderBy\(\s*desc\(shadowFillsTable\.occurredAt\),\s*desc\(shadowFillsTable\.ledgerSequence\),\s*desc\(shadowFillsTable\.id\),?\s*\)/,
  );
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
  assert.match(equityEvents, /readCachedShadowOrdersByFillOrderId\(fills\)/);
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
  assert.match(block, /readShadowAnalysisLedgerFold\(\{\s*scope: null,\s*\}\)/);
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
  assert.notEqual(
    ordersBlock.indexOf("const orders = await db"),
    -1,
    "Missing source-filtered automation order read",
  );
  assert.doesNotMatch(automationBranch, /shadowLedgerDashboardReadLimit/);
});

test("authoritative totals and deployment P&L survive the 20,000-row display boundary", async () => {
  const testDb = await createTestDb();
  const accountId = "shadow-ledger-boundary";
  const deploymentId = "deployment-ledger-boundary";

  try {
    internals.invalidateShadowFreshStateCache();
    await db.insert(shadowAccountsTable).values({
      id: accountId,
      displayName: "Ledger boundary",
      startingBalance: "25000",
      cash: "4999",
    });
    await db.execute(sql`
      insert into shadow_orders (
        id, account_id, source, client_order_id, symbol, asset_class,
        side, status, quantity, filled_quantity, average_fill_price,
        fees, payload, placed_at, filled_at
      )
      select
        gen_random_uuid(),
        ${accountId},
        case when item = 0 then 'automation' else 'manual' end,
        'ledger-boundary-' || item,
        'CRM',
        'equity',
        'buy',
        'filled',
        1,
        1,
        1,
        case when item = 0 then 1 else 0 end,
        case
          when item = 0
              then jsonb_build_object(
                'metadata',
                jsonb_build_object('deploymentId', ${deploymentId}::text)
              )
          else '{}'::jsonb
        end,
        '2026-01-01T00:00:00.000Z'::timestamptz
          + item * interval '1 second',
        '2026-01-01T00:00:00.000Z'::timestamptz
          + item * interval '1 second'
      from generate_series(0, 20000) as item
    `);
    await db.execute(sql`
      insert into shadow_fills (
        id, account_id, order_id, symbol, asset_class, side, quantity,
        price, gross_amount, fees, realized_pnl, cash_delta, occurred_at
      )
      select
        gen_random_uuid(),
        ${accountId},
        id,
        symbol,
        asset_class,
        side,
        quantity,
        1,
        1,
        case when source = 'automation' then 1 else 0 end,
        case when source = 'automation' then 10 else 0 end,
        -1,
        placed_at
      from shadow_orders
      where account_id = ${accountId}
    `);

    const result = await runWithShadowAccountId(accountId, async () => ({
      bundle: await internals.readShadowLedgerBundleForSourceForTests(null),
      deployment:
        await computeSignalOptionsLedgerRealizedForDeployment(deploymentId),
    }));

    assert.equal(result.bundle.totals.cash, 4_999);
    assert.equal(result.bundle.totals.realizedPnl, 10);
    assert.deepEqual(result.deployment, { realizedNet: 10, fees: 1 });
  } finally {
    internals.invalidateShadowFreshStateCache();
    await testDb.cleanup();
  }
});

test("bucket sampling applies ledger source eligibility before its row limit", async () => {
  const testDb = await createTestDb();
  const accountId = "shadow-history-source-boundary";
  const start = new Date("2026-07-18T12:00:00.000Z");
  const liveAt = new Date("2026-07-18T12:00:02.000Z");

  try {
    await db.insert(shadowAccountsTable).values({
      id: accountId,
      displayName: "History source boundary",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(shadowBalanceSnapshotsTable).values(
      [1, 2, 3, 4, 5].map((second) => ({
        accountId,
        currency: "USD",
        cash: "25000",
        buyingPower: "25000",
        netLiquidation: "25000",
        realizedPnl: "0",
        unrealizedPnl: "0",
        fees: "0",
        source: second === 2 ? "mark" : "signal_options_replay",
        asOf: new Date(start.getTime() + second * 1_000),
      })),
    );
    const input = {
      accountId,
      start,
      end: new Date(start.getTime() + 60_000),
      source: null,
    };
    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed(input),
    );

    assert.ok(
      sampled.some((row) => row.asOf.getTime() === liveAt.getTime()),
      "the only ledger-eligible row must not be hidden by simulation rows",
    );
  } finally {
    await testDb.cleanup();
  }
});

test("bucket sampling expands a bucket when bounded candidates are all ledger-invalid", async () => {
  const testDb = await createTestDb();
  const accountId = "shadow-history-validity-boundary";
  const start = new Date("2026-07-18T12:00:00.000Z");
  const validAt = new Date("2026-07-18T12:00:02.000Z");

  try {
    await db.insert(shadowAccountsTable).values({
      id: accountId,
      displayName: "History validity boundary",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(shadowBalanceSnapshotsTable).values(
      [1, 2, 3, 4, 5].map((second) => ({
        accountId,
        currency: "USD",
        cash: second === 2 ? "25000" : "1",
        buyingPower: second === 2 ? "25000" : "1",
        netLiquidation: second === 2 ? "25000" : "1",
        realizedPnl: "0",
        unrealizedPnl: "0",
        fees: "0",
        source: "mark",
        asOf: new Date(start.getTime() + second * 1_000),
      })),
    );
    const input: Parameters<
      typeof internals.readShadowEquityHistorySnapshotRowsBucketed
    >[0] = {
      accountId,
      start,
      end: new Date(start.getTime() + 60_000),
      source: null,
      eligibleRows: (rows) => rows.filter((row) => Number(row.cash) === 25_000),
    };
    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed(input),
    );

    assert.ok(
      sampled.some((row) => row.asOf.getTime() === validAt.getTime()),
      "the only ledger-valid row must not be hidden by invalid snapshots",
    );
  } finally {
    await testDb.cleanup();
  }
});

test("bucket sampling keeps the newest correction when one timestamp exceeds its candidate budget", async () => {
  const testDb = await createTestDb();
  const accountId = "shadow-history-total-order";
  const start = new Date("2026-07-18T12:00:00.000Z");
  const asOf = new Date("2026-07-18T12:00:01.000Z");
  const newestId = "00000000-0000-4000-8000-000000000605";

  try {
    await db.insert(shadowAccountsTable).values({
      id: accountId,
      displayName: "History total order",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(shadowBalanceSnapshotsTable).values(
      [1, 5, 4, 3, 2].map((rank) => ({
        id: `00000000-0000-4000-8000-${String(600 + rank).padStart(12, "0")}`,
        accountId,
        currency: "USD",
        cash: String(25_000 + rank),
        buyingPower: String(25_000 + rank),
        netLiquidation: String(25_000 + rank),
        realizedPnl: "0",
        unrealizedPnl: "0",
        fees: "0",
        source: "mark",
        asOf,
        createdAt: new Date(start.getTime() + rank * 1_000),
        updatedAt: new Date(start.getTime() + rank * 1_000),
      })),
    );

    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed({
        accountId,
        start,
        end: new Date(start.getTime() + 60_000),
        source: null,
      }),
    );

    assert.ok(
      sampled.some((row) => row.id === newestId),
      "the newest-created equal-time snapshot must survive the bounded probe",
    );
  } finally {
    await testDb.cleanup();
  }
});

test("equity-history timestamp ties use snapshot ids as the final total order", () => {
  const asOf = new Date("2026-07-18T12:00:01.000Z");
  const createdAt = new Date("2026-07-18T12:00:02.000Z");
  const lower = {
    id: "00000000-0000-4000-8000-000000000611",
    source: "mark",
    asOf,
    createdAt,
  };
  const higher = {
    id: "00000000-0000-4000-8000-000000000612",
    source: "mark",
    asOf,
    createdAt,
  };

  const compacted = internals.compactShadowEquityHistoryRows([higher, lower]);
  assert.equal(compacted[0]?.id, higher.id);

  const selected = internals.selectShadowEquityHistoryRows(
    [
      { ...lower, source: "watchlist_backtest:lower" },
      { ...higher, source: "watchlist_backtest:higher" },
    ],
    { source: "watchlist_backtest" },
  );
  assert.equal(selected.selectedSource, "watchlist_backtest:higher");
});

test("marketing positions never reuse a normal positions cache entry", async () => {
  const testDb = await createTestDb();
  const accountId = "shadow-marketing-cache-isolation";
  const normalResponse = {
    positions: [
      {
        id: "normal-cache-sentinel",
        symbol: "SENTINEL",
        assetClass: "equity",
      },
    ],
    totals: {},
  };

  try {
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({ ttlMs: 60_000 });
    await db.insert(shadowAccountsTable).values({
      id: accountId,
      displayName: "Marketing cache isolation",
      startingBalance: "25000",
      cash: "25000",
    });
    const result = await runWithShadowAccountId(accountId, async () => {
      await internals.withShadowReadCache(
        "positions:all:ledger:live-quotes",
        async () => normalResponse,
      );
      return getShadowAccountPositions({
        detail: "marketing",
        liveQuotes: false,
      });
    });

    assert.deepEqual(result.positions, []);
  } finally {
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({ ttlMs: null });
    await testDb.cleanup();
  }
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

test("mark refresh cannot restart the stable ledger-identity read used by Positions", async () => {
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
    const first = internals.readShadowLedgerIdentityFillsWithOrdersForTests(
      null,
      async () => {
        reads += 1;
        await gate;
        return value;
      },
    );
    await waitTurn();

    internals.invalidateShadowReadCachesAfterBackgroundMarkRefresh();
    const second = internals.readShadowLedgerIdentityFillsWithOrdersForTests(
      null,
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

test("ledger invalidation serializes a fresh read behind the stale in-flight read", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 60_000,
  });

  let reads = 0;
  let concurrentReads = 0;
  let maxConcurrentReads = 0;
  let releaseFirstRead: () => void = () => {};
  const firstReadGate = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });

  try {
    const first = internals.withShadowReadCache(
      "orders:serialization-test",
      async () => {
        reads += 1;
        concurrentReads += 1;
        maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
        await firstReadGate;
        concurrentReads -= 1;
        return "before-invalidation";
      },
    );
    await waitTurn();

    internals.invalidateShadowFreshStateCache();
    const second = internals.withShadowReadCache(
      "orders:serialization-test",
      async () => {
        reads += 1;
        concurrentReads += 1;
        maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
        concurrentReads -= 1;
        return "after-invalidation";
      },
    );
    await waitTurn();

    assert.equal(
      reads,
      1,
      "the fresh read waits instead of duplicating the DB query",
    );
    assert.equal(maxConcurrentReads, 1);
    releaseFirstRead();
    assert.equal(await first, "before-invalidation");
    assert.equal(await second, "after-invalidation");
    assert.equal(reads, 2);
    assert.equal(maxConcurrentReads, 1);
  } finally {
    releaseFirstRead();
    await waitTurn();
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
    });
  }
});

test("ledger invalidation coalesces a mutation storm into one trailing refresh", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({ ttlMs: 60_000 });

  let reads = 0;
  let concurrentReads = 0;
  let maxConcurrentReads = 0;
  let releaseFirstRead: () => void = () => {};
  let markFirstStarted: () => void = () => {};
  const firstReadGate = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });

  const first = internals.withShadowReadCache(
    "orders:mutation-storm-test",
    async () => {
      reads += 1;
      concurrentReads += 1;
      maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
      markFirstStarted();
      try {
        await firstReadGate;
        return "before-invalidation";
      } finally {
        concurrentReads -= 1;
      }
    },
  );
  const followers: Array<Promise<string>> = [];

  try {
    await firstStarted;
    for (let index = 0; index < 25; index += 1) {
      internals.invalidateShadowFreshStateCache();
      followers.push(
        internals.withShadowReadCache(
          "orders:mutation-storm-test",
          async () => {
            reads += 1;
            concurrentReads += 1;
            maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
            concurrentReads -= 1;
            return "after-invalidation";
          },
        ),
      );
    }

    await waitTurn();
    assert.equal(reads, 1);
    assert.equal(maxConcurrentReads, 1);

    releaseFirstRead();
    assert.equal(await first, "before-invalidation");
    assert.deepEqual(
      await Promise.all(followers),
      Array.from({ length: 25 }, () => "after-invalidation"),
    );
    assert.equal(reads, 2);
    assert.equal(maxConcurrentReads, 1);
    assert.equal(
      await internals.withShadowReadCache(
        "orders:mutation-storm-test",
        async () => assert.fail("coalesced result should be cached"),
      ),
      "after-invalidation",
    );
  } finally {
    releaseFirstRead();
    await Promise.allSettled([first, ...followers]);
    internals.invalidateShadowFreshStateCache();
    internals.setShadowReadCacheWindowsForTests({ ttlMs: null });
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

test("shared analysis folds exclude forward-test fills from default and tax-all scopes", async () => {
  internals.invalidateShadowFreshStateCache();
  const liveOrder = analysisOrder("order-live");
  const forwardOrder = analysisOrder("order-forward", { forwardTest: true });
  const rows = {
    fills: [
      analysisFill("fill-live", "order-live"),
      analysisFill("fill-forward", "order-forward"),
    ],
    ordersById: new Map([
      ["order-live", liveOrder],
      ["order-forward", forwardOrder],
    ]),
  };
  const reader = async () => rows as never;

  try {
    const defaultFold = await internals.readShadowAnalysisLedgerFoldForTests(
      { scope: null },
      reader,
    );
    const taxFold = await internals.readShadowAnalysisLedgerFoldForTests(
      { scope: "all" },
      reader,
    );
    assert.deepEqual(
      defaultFold.fills.map((fill) => fill.id),
      ["fill-live"],
    );
    assert.deepEqual(
      taxFold.fills.map((fill) => fill.id),
      ["fill-live"],
    );
  } finally {
    internals.invalidateShadowFreshStateCache();
  }
});

test("shared analysis folds preserve committed equal-time fill causality", async () => {
  internals.invalidateShadowFreshStateCache();
  const occurredAt = new Date("2026-07-14T14:00:00.000Z");
  const buyOrder = analysisOrder("order-buy");
  const sellOrder = analysisOrder("order-sell");
  const buyFill = Object.assign({}, analysisFill("fill-z-buy", "order-buy"), {
    side: "buy",
    occurredAt,
    ledgerSequence: 1,
  });
  const sellFill = Object.assign(
    {},
    analysisFill("fill-a-sell", "order-sell"),
    {
      side: "sell",
      price: "110",
      grossAmount: "110",
      cashDelta: "109",
      realizedPnl: "9",
      occurredAt,
      ledgerSequence: 2,
    },
  );

  try {
    const fold = await internals.readShadowAnalysisLedgerFoldForTests(
      { scope: null },
      async () =>
        ({
          fills: [sellFill, buyFill],
          ordersById: new Map([
            ["order-buy", buyOrder],
            ["order-sell", sellOrder],
          ]),
        }) as never,
    );

    assert.equal(fold.roundTrips.length, 1);
    assert.equal(fold.openLots.length, 0);
    assert.deepEqual(fold.anomalies, []);
    assert.deepEqual(
      fold.fills.map((fill) => fill.id),
      ["fill-z-buy", "fill-a-sell"],
    );
  } finally {
    internals.invalidateShadowFreshStateCache();
  }
});

test("trade diagnostics exclude forward-test fills", () => {
  const liveOrder = analysisOrder("order-live");
  const forwardOrder = analysisOrder("order-forward", { forwardTest: true });
  const packet = internals.buildShadowTradeDiagnosticsFromRows({
    range: "all",
    windowStart: null,
    windowEnd: new Date("2026-07-14T15:00:00.000Z"),
    fills: [
      analysisFill("fill-live", "order-live"),
      analysisFill("fill-forward", "order-forward"),
    ],
    ordersById: new Map([
      ["order-live", liveOrder],
      ["order-forward", forwardOrder],
    ]),
  } as never);

  assert.deepEqual(
    packet.tradeEvents.map((event) => event.id),
    ["fill-live"],
  );
  assert.equal(packet.openLots.length, 1);
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

test("shared-ledger watchlist backtest replacement is atomic and invalidates identity reads", () => {
  const runnerStart = shadowAccountSource.indexOf(
    "export async function runShadowWatchlistBacktest",
  );
  const runnerEnd = shadowAccountSource.indexOf(
    "\nexport function isShadowAccountId",
    runnerStart,
  );
  assert.notEqual(runnerStart, -1, "Missing watchlist backtest runner");
  assert.notEqual(runnerEnd, -1, "Missing watchlist backtest runner boundary");
  assert.doesNotMatch(
    shadowAccountSource.slice(runnerStart, runnerEnd),
    /resetWatchlistBacktestRowsForRange/,
  );

  const startingBookStart = shadowAccountSource.indexOf(
    "async function computeWatchlistBacktestStartingBook",
  );
  const startingBookEnd = shadowAccountSource.indexOf(
    "\nasync function writeShadowBalanceSnapshot",
    startingBookStart,
  );
  assert.notEqual(startingBookStart, -1, "Missing backtest starting-book reader");
  assert.notEqual(startingBookEnd, -1, "Missing starting-book boundary");
  const startingBook = shadowAccountSource.slice(
    startingBookStart,
    startingBookEnd,
  );
  assert.match(startingBook, /isLiveShadowOrder/);
  assert.match(startingBook, /isLiveShadowPosition/);

  const insertStart = shadowAccountSource.indexOf(
    "async function insertWatchlistBacktestFills",
  );
  const insertEnd = shadowAccountSource.indexOf(
    "\nexport const __shadowWatchlistBacktestInternalsForTests",
    insertStart,
  );
  assert.notEqual(insertStart, -1, "Missing watchlist backtest insert writer");
  assert.notEqual(insertEnd, -1, "Missing watchlist backtest insert boundary");
  const insert = shadowAccountSource.slice(insertStart, insertEnd);
  assert.match(
    insert,
    /await db\.transaction\(async \(tx\) => \{[\s\S]*deleteWatchlistBacktestRowsForRange\(tx, input\);[\s\S]*tx\.insert\(shadowOrdersTable\)[\s\S]*tx\.insert\(shadowFillsTable\)[\s\S]*recomputeShadowAccountFromLedger\(tx, new Date\(\)\);[\s\S]*\}\);/,
  );
  assert.match(insert, /invalidateShadowFreshStateCache\(\);/);
  assert.match(insert, /notifyShadowAccountChanged\(/);
});

test("canonical fill-order reads chunk large ID sets without parallel pool fan-out", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function readShadowOrdersByFillOrderId");
  const end = source.indexOf(
    "\nasync function readCachedShadowOrdersByFillOrderId",
    start,
  );
  assert.notEqual(start, -1, "Missing canonical fill-order reader");
  assert.notEqual(end, -1, "Missing canonical fill-order reader boundary");
  const block = source.slice(start, end);

  assert.match(block, /for \(let index = 0; index < orderIds\.length; index \+= 500\)/);
  assert.match(block, /for \(const chunk of chunks\)/);
  assert.match(block, /inArray\(shadowOrdersTable\.id, chunk\)/);
  assert.doesNotMatch(block, /Promise\.all/);
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

test("read diagnostics aggregate account-partitioned keys by bounded route", async () => {
  internals.invalidateShadowFreshStateCache();
  internals.resetShadowAccountReadDiagnosticsForTests();

  try {
    await runWithShadowAccountId("account-a", () =>
      internals.withShadowReadCache("summary:overview", async () => "a"),
    );
    await runWithShadowAccountId("account-b", () =>
      internals.withShadowReadCache("summary:overview", async () => "b"),
    );

    const diagnostics = internals.getShadowAccountReadDiagnostics();
    assert.deepEqual(
      diagnostics.routes.map((entry) => entry.route),
      ["summary"],
    );
    assert.ok(
      diagnostics.recent.some((entry) => entry.key.startsWith("account-a ")),
    );
    assert.ok(
      diagnostics.recent.some((entry) => entry.key.startsWith("account-b ")),
    );
  } finally {
    internals.invalidateShadowFreshStateCache();
    internals.resetShadowAccountReadDiagnosticsForTests();
  }
});

test("fresh-state followers queue one current-generation read behind a stale flight", async () => {
  internals.resetShadowFreshStateRefreshForTests();
  const totals = (cash: number) =>
    ({
      cash,
      startingBalance: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      fees: 0,
      marketValue: 0,
      netLiquidation: cash,
      updatedAt: new Date("2026-07-17T12:00:00.000Z"),
    }) as never;
  let resolveStale!: (value: ReturnType<typeof totals>) => void;
  let freshReads = 0;

  try {
    const stale = internals.queueShadowFreshStateRefreshForTests(
      SHADOW_ACCOUNT_ID,
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
    );
    await Promise.resolve();
    internals.invalidateShadowFreshStateCache();

    const firstFollower = internals.queueShadowFreshStateRefreshForTests(
      SHADOW_ACCOUNT_ID,
      async () => {
        freshReads += 1;
        return totals(2);
      },
    );
    const secondFollower = internals.queueShadowFreshStateRefreshForTests(
      SHADOW_ACCOUNT_ID,
      async () => {
        freshReads += 1;
        return totals(3);
      },
    );

    assert.equal(freshReads, 0);
    resolveStale(totals(1));
    assert.equal((await stale).cash, 1);
    const [first, second] = await Promise.all([firstFollower, secondFollower]);

    assert.equal(freshReads, 1);
    assert.equal(first.cash, 2);
    assert.equal(second.cash, 2);
    assert.equal(internals.getShadowFreshStateCache()?.totals.cash, 2);
  } finally {
    internals.resetShadowFreshStateRefreshForTests();
  }
});
