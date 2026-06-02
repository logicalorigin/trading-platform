import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ACCOUNT_PAGE_STREAM_INTERVAL_MS } from "./account-page-streams";
import { SHADOW_ACCOUNT_STREAM_INTERVAL_MS } from "./shadow-account-streams";
import {
  notifyShadowAccountChanged,
  subscribeShadowAccountChanges,
} from "./shadow-account-events";
import {
  __shadowWatchlistBacktestInternalsForTests,
  buildWatchlistBacktestFills,
  computeShadowOrderFees,
  SHADOW_STARTING_BALANCE,
} from "./shadow-account";
import { tunedSignalOptionsExecutionProfile } from "@workspace/backtest-core";

test("shadow account snapshot stream uses the visible-page cadence", () => {
  assert.equal(SHADOW_ACCOUNT_STREAM_INTERVAL_MS, 2_000);
});

test("shadow account default starting balance matches the active paper run", () => {
  assert.equal(SHADOW_STARTING_BALANCE, 25_000);
});

test("shadow position risk overlay keeps hard stop separate from trailing stop", () => {
  const riskOverlay =
    __shadowWatchlistBacktestInternalsForTests.buildShadowPositionRiskOverlay({
      openedAt: new Date("2026-05-27T14:30:00.000Z"),
      automationContext: {
        entryPrice: 10,
        peakPrice: 14,
        stopPrice: 11.2,
        stopLossPrice: 7,
        takeProfitPrice: 16,
        purchasedAt: "2026-05-27T14:31:00.000Z",
        tradeManagement: {
          hardStopPrice: 7,
          trailActive: true,
          trailStopPrice: 11.2,
          trailActivationPrice: 12,
          trailActivationPct: 20,
          givebackPct: 20,
          minLockedGainPct: 0,
        },
      },
    } as any);

  assert.deepEqual(riskOverlay, {
    source: "shadow_automation",
    openedAt: "2026-05-27T14:31:00.000Z",
    entryPrice: 10,
    hardStopPrice: 7,
    stopPrice: 11.2,
    takeProfitPrice: 16,
    activeStopPrice: 11.2,
    activeStopKind: "trailing_stop",
    trailActive: true,
    trailStopPrice: 11.2,
    trailHasTakenOver: true,
    trailActivationPrice: 12,
    trailActivationPct: 20,
    givebackPct: 20,
    minLockedGainPct: 0,
    peakPrice: 14,
  });
});

test("shadow position risk overlay can carry take-profit without stop lines", () => {
  const riskOverlay =
    __shadowWatchlistBacktestInternalsForTests.buildShadowPositionRiskOverlay({
      openedAt: new Date("2026-05-27T14:30:00.000Z"),
      automationContext: {
        entryPrice: 10,
        takeProfitPrice: 16,
        purchasedAt: "2026-05-27T14:31:00.000Z",
        tradeManagement: {
          targetKind: "take_profit",
        },
      },
    } as any);

  assert.equal(riskOverlay?.takeProfitPrice, 16);
  assert.equal(riskOverlay?.activeStopPrice, null);
  assert.equal(riskOverlay?.activeStopKind, null);
});

test("shadow automation option exits respect live option trading sessions", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const apldContract = {
    ticker: "APLD20260529C46",
    underlying: "APLD",
    expirationDate: new Date("2026-05-29T00:00:00.000Z"),
    strike: 46,
    right: "call" as const,
    multiplier: 100,
    sharesPerContract: 100,
  };
  const spyContract = {
    ...apldContract,
    ticker: "SPY20260529C600",
    underlying: "SPY",
    strike: 600,
  };

  assert.equal(
    internals.isShadowOptionTradingSession(
      new Date("2026-05-27T19:59:00.000Z"),
      apldContract,
    ),
    true,
  );
  assert.equal(
    internals.isShadowOptionTradingSession(
      new Date("2026-05-27T20:00:00.000Z"),
      apldContract,
    ),
    false,
  );
  assert.equal(
    internals.isShadowOptionTradingSession(
      new Date("2026-05-27T20:14:00.000Z"),
      spyContract,
    ),
    true,
  );
  assert.equal(
    internals.isShadowOptionTradingSession(
      new Date("2026-05-27T20:15:00.000Z"),
      spyContract,
    ),
    false,
  );
  assert.equal(
    internals.isLiveShadowAutomationPayload({
      metadata: { runMode: "live_scan", runSource: "worker" },
    }),
    true,
  );
  assert.equal(
    internals.isLiveShadowAutomationPayload({
      metadata: { runMode: "historical_backfill" },
      backfill: { source: "signal_options_backfill" },
    }),
    false,
  );
});

test("shadow automation option entries respect live option trading sessions", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const entryBody = source.match(
    /async function recordShadowAutomationEntry\([\s\S]*?\nasync function recordShadowAutomationExit/,
  )?.[0];

  assert.ok(entryBody);
  assert.match(entryBody, /isLiveShadowAutomationPayload\(payload\)/);
  assert.match(
    entryBody,
    /!isShadowOptionTradingSession\(event\.occurredAt,\s*contract\)/,
  );
  assert.match(entryBody, /return null/);
});

test("shadow automation option marks respect live option trading sessions", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const markStart = source.indexOf("async function recordShadowAutomationMark");
  const markBody = markStart >= 0 ? source.slice(markStart) : "";

  assert.ok(markBody);
  assert.match(markBody, /isLiveShadowAutomationPayload\(payload\)/);
  assert.match(
    markBody,
    /!isShadowOptionTradingSession\(event\.occurredAt,\s*contract\)/,
  );
});

test("account page snapshot stream uses the one-second visible-page cadence", () => {
  assert.equal(ACCOUNT_PAGE_STREAM_INTERVAL_MS, 1_000);
});

test("shadow account change notifier publishes successful ledger writes", () => {
  let calls = 0;
  const unsubscribe = subscribeShadowAccountChanges(() => {
    calls += 1;
  });

  notifyShadowAccountChanged();
  unsubscribe();
  notifyShadowAccountChanged();

  assert.equal(calls, 1);
});

test("shadow read cache coalesces repeated expensive reads until invalidated", async () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  let calls = 0;
  internals.invalidateShadowFreshStateCache();

  const [first, second] = await Promise.all([
    internals.withShadowReadCache("unit-cache", async () => {
      calls += 1;
      return { value: calls };
    }),
    internals.withShadowReadCache("unit-cache", async () => {
      calls += 1;
      return { value: calls };
    }),
  ]);
  const third = await internals.withShadowReadCache("unit-cache", async () => {
    calls += 1;
    return { value: calls };
  });
  internals.invalidateShadowFreshStateCache();
  const fourth = await internals.withShadowReadCache("unit-cache", async () => {
    calls += 1;
    return { value: calls };
  });

  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.deepEqual(third, { value: 1 });
  assert.deepEqual(fourth, { value: 2 });
  assert.equal(calls, 2);
});

test("shadow read cache serves marked stale data when refresh exceeds budget", async () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  internals.invalidateShadowFreshStateCache();
  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 0,
    staleTtlMs: 60_000,
    staleWaitMs: 5,
  });

  const fresh = await internals.withShadowReadCache("unit-stale-cache", async () => ({
    accountId: "shadow",
    degraded: false,
    reason: null,
    stale: false,
    debug: null,
    value: 1,
  }));
  const stale = await internals.withShadowReadCache(
    "unit-stale-cache",
    async () =>
      new Promise<Record<string, unknown>>(() => {
        // Intentionally unresolved; the cache should protect the caller.
      }),
  );

  assert.deepEqual(fresh, {
    accountId: "shadow",
    degraded: false,
    reason: null,
    stale: false,
    debug: null,
    value: 1,
  });
  assert.equal(stale.accountId, "shadow");
  assert.equal(stale.value, 1);
  assert.equal(stale.degraded, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.reason, "shadow_read_stale_cache");
  const staleDebug = stale.debug as Record<string, unknown>;
  assert.deepEqual(staleDebug, {
    message: "Shadow account read exceeded its response budget; serving cached data.",
    code: "shadow_read_stale_cache",
    timeoutMs: 5,
    cacheAgeMs: staleDebug["cacheAgeMs"],
  });
  assert.equal(typeof staleDebug["cacheAgeMs"], "number");

  internals.setShadowReadCacheWindowsForTests({
    ttlMs: null,
    staleTtlMs: null,
    staleWaitMs: null,
  });
  internals.invalidateShadowFreshStateCache();
});

test("shadow fresh-state refresh remains in-flight until settled", async () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const totals = {
    cash: 30_000,
    startingBalance: 30_000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    fees: 0,
    marketValue: 0,
    netLiquidation: 30_000,
    updatedAt: new Date("2026-05-01T14:00:00.000Z"),
  };
  internals.invalidateShadowFreshStateCache();

  let resolvePending!: (value: typeof totals) => void;
  const pending = new Promise<typeof totals>((resolve) => {
    resolvePending = resolve;
  });
  const tracked = internals.trackShadowFreshStateRefresh(pending);

  assert.equal(internals.getShadowFreshStateInFlight(), tracked);
  await Promise.resolve();
  assert.equal(internals.getShadowFreshStateInFlight(), tracked);

  resolvePending(totals);
  assert.deepEqual(await tracked, totals);
  assert.equal(internals.getShadowFreshStateInFlight(), null);
  assert.deepEqual(internals.getShadowFreshStateCache()?.totals, totals);

  let resolveStale!: (value: typeof totals) => void;
  const stalePending = new Promise<typeof totals>((resolve) => {
    resolveStale = resolve;
  });
  const staleTracked = internals.trackShadowFreshStateRefresh(stalePending);
  internals.invalidateShadowFreshStateCache();
  resolveStale(totals);
  assert.deepEqual(await staleTracked, totals);
  assert.equal(internals.getShadowFreshStateCache(), null);
});

test("shadow account reads do not synchronously block on mark refresh", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const ensureBody = source.match(
    /async function ensureFreshShadowState\(refreshMarks = false\) \{[\s\S]*?\nfunction buildShadowPositionDayChange/,
  )?.[0];

  assert.ok(ensureBody);
  assert.match(ensureBody, /kickShadowPositionMarkRefresh\(\);/);
  assert.doesNotMatch(ensureBody, /await refreshShadowPositionMarks/);
});

test("shadow mark refresh invalidates read caches before stream notification snapshots", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const refreshBody = source.match(
    /export async function refreshShadowPositionMarks\(\) \{[\s\S]*?\nasync function ensureFreshShadowState/,
  )?.[0];

  assert.ok(refreshBody);
  assert.match(
    refreshBody,
    /if \(updatedCount\) \{\s*invalidateShadowReadCachesAfterBackgroundMarkRefresh\(\);/,
  );
  assert.ok(
    refreshBody.indexOf("invalidateShadowReadCachesAfterBackgroundMarkRefresh();") <
      refreshBody.indexOf("await writeShadowBalanceSnapshot("),
  );
});

test("shadow account snapshot invalidation clears stale in-flight base reads", () => {
  const source = readFileSync(
    new URL("./shadow-account-streams.ts", import.meta.url),
    "utf8",
  );
  const invalidatorBody = source.match(
    /export function invalidateShadowAccountSnapshotBaseCache\(\) \{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(invalidatorBody);
  assert.match(invalidatorBody, /shadowAccountSnapshotBaseCache = null;/);
  assert.match(invalidatorBody, /shadowAccountSnapshotBaseInFlight = null;/);
  assert.match(invalidatorBody, /shadowAccountSnapshotBaseVersion \+= 1;/);
  assert.match(source, /const version = shadowAccountSnapshotBaseVersion;/);
  assert.match(
    source,
    /if \(version === shadowAccountSnapshotBaseVersion\) \{\s*shadowAccountSnapshotBaseCache = \{/,
  );
  assert.match(source, /const request = \(async \(\) => \{/);
  assert.match(source, /getShadowAccountPositions\(\{\s*liveQuotes: false,?\s*\}\)/);
  assert.match(
    source,
    /if \(shadowAccountSnapshotBaseInFlight === request\) \{\s*shadowAccountSnapshotBaseInFlight = null;/,
  );
});

test("shadow account wrappers avoid full snapshot coupling for critical reads", () => {
  const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");
  const summaryBody = source.match(
    /export async function getAccountSummary\([\s\S]*?\n  const mode = input\.mode/,
  )?.[0];
  const allocationBody = source.match(
    /export async function getAccountAllocation\([\s\S]*?\n  const mode = input\.mode/,
  )?.[0];
  const ordersBody = source.match(
    /export async function getAccountOrders\([\s\S]*?\n  const mode = input\.mode/,
  )?.[0];
  const riskBody = source.match(
    /export async function getAccountRisk\([\s\S]*?\n  const mode = input\.mode/,
  )?.[0];

  assert.ok(summaryBody);
  assert.ok(allocationBody);
  assert.ok(ordersBody);
  assert.ok(riskBody);
  assert.match(summaryBody, /return getShadowAccountSummary\(\{ source: input\.source \}\);/);
  assert.match(allocationBody, /return getShadowAccountAllocation\(\{ source: input\.source \}\);/);
  assert.match(ordersBody, /return getShadowAccountOrders\(\{/);
  assert.match(riskBody, /return getShadowAccountRisk\(\{ source: input\.source \}\);/);
  assert.doesNotMatch(
    `${summaryBody}\n${allocationBody}\n${ordersBody}\n${riskBody}`,
    /fetchShadowAccountSnapshotBase/,
  );
});

test("account page stream invalidation clears stale in-flight payloads", () => {
  const source = readFileSync(
    new URL("./account-page-streams.ts", import.meta.url),
    "utf8",
  );
  const invalidatorBody = source.match(
    /export function clearAccountPageSnapshotCache\(\) \{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(invalidatorBody);
  assert.match(invalidatorBody, /accountPageSnapshotInflight\.clear\(\);/);
  assert.match(invalidatorBody, /accountPageCriticalInflight\.clear\(\);/);
  assert.match(invalidatorBody, /accountPageLiveInflight\.clear\(\);/);
  assert.match(invalidatorBody, /accountPageDerivedInflight\.clear\(\);/);
  assert.match(invalidatorBody, /accountPageSnapshotCacheVersion \+= 1;/);
  assert.match(source, /const version = accountPageSnapshotCacheVersion;/);
  assert.match(
    source,
    /if \(version === accountPageSnapshotCacheVersion\) \{\s*accountPageLiveCache\.set/,
  );
  assert.match(
    source,
    /if \(accountPageLiveInflight\.get\(cacheKey\) === request\) \{\s*accountPageLiveInflight\.delete\(cacheKey\);/,
  );
});

test("account page SSE emits critical payload before delayed live and derived subscription", () => {
  const source = readFileSync(
    new URL("../routes/platform.ts", import.meta.url),
    "utf8",
  );
  const routeBlock = source.match(
    /await startSse\(req, res, "account-page", async \(\{ writeEvent \}\) => \{[\s\S]*?return subscribeAccountPageSnapshots/,
  )?.[0];

  assert.ok(routeBlock);
  assert.match(routeBlock, /fetchAccountPageCriticalPayload\(input\)/);
  assert.match(routeBlock, /writeEvent\("critical", initialCriticalPayload\)/);
  assert.match(source, /initialLiveDelayMs:\s*ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS/);
  assert.match(source, /initialDerivedDelayMs:\s*ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS/);
  assert.doesNotMatch(routeBlock, /fetchAccountPageSnapshotPayload\(input\)/);
});

test("shadow benchmark overlays are bounded for responsive equity history", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

  assert.match(source, /const SHADOW_BENCHMARK_BARS_MAX_WAIT_MS = 750;/);
  assert.match(source, /async function waitForShadowBenchmarkBars/);
  assert.match(source, /return \(await waitForShadowBenchmarkBars\(request\)\) \?\? cached\?\.bars \?\? null;/);
});

test("computeShadowOrderFees applies IBKR Pro Fixed option fees", () => {
  assert.equal(
    computeShadowOrderFees({
      assetClass: "option",
      quantity: 3,
      price: 1.25,
      multiplier: 100,
    }),
    2.02,
  );
});

test("computeShadowOrderFees applies stock min and cap", () => {
  assert.equal(
    computeShadowOrderFees({
      assetClass: "equity",
      quantity: 10,
      price: 100,
    }),
    1,
  );
  assert.equal(
    computeShadowOrderFees({
      assetClass: "equity",
      quantity: 100_000,
      price: 1,
    }),
    500,
  );
  assert.equal(
    computeShadowOrderFees({
      assetClass: "equity",
      quantity: 100_000,
      price: 0.02,
    }),
    20,
  );
});

test("expired option shadow closes can use an explicit stale mark", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.isExpiredOptionContractForShadowClose;

  assert.equal(
    helper(
      {
        ticker: "TLT20260513P855",
        underlying: "TLT",
        expirationDate: new Date("2026-05-13T00:00:00.000Z"),
        strike: 85.5,
        right: "put",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: null,
      },
      new Date("2026-05-14T20:00:00.000Z"),
    ),
    true,
  );
  assert.equal(
    helper(
      {
        ticker: "TQQQ20260515C75",
        underlying: "TQQQ",
        expirationDate: new Date("2026-05-15T00:00:00.000Z"),
        strike: 75,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: null,
      },
      new Date("2026-05-14T20:00:00.000Z"),
    ),
    false,
  );
});

test("shadow option maintenance waits until expiration close", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.shouldCloseOptionForShadowMaintenance;
  const contract = {
    ticker: "TQQQ20260515C75",
    underlying: "TQQQ",
    expirationDate: new Date("2026-05-15T00:00:00.000Z"),
    strike: 75,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: null,
  } as const;

  assert.equal(helper(contract, new Date("2026-05-15T18:00:00.000Z")), false);
  assert.equal(helper(contract, new Date("2026-05-15T20:00:00.000Z")), true);
  assert.equal(helper(contract, new Date("2026-05-16T14:00:00.000Z")), true);
});

test("shadow option maintenance classifies signal-options backfill and replay rows", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.isHistoricalSignalOptionsShadowOrder;
  const backfillHelper =
    __shadowWatchlistBacktestInternalsForTests.isSignalOptionsBackfillShadowOrder;

  const backfillOrder = {
    payload: { backfill: { source: "signal_options_backfill" } },
  } as never;
  assert.equal(helper(backfillOrder), true);
  assert.equal(backfillHelper(backfillOrder), true);
  assert.equal(
    helper({
      payload: {
        backfill: { source: "signal_options_replay" },
        metadata: { sourceType: "signal_options_replay" },
      },
    } as never),
    true,
  );
  assert.equal(
    backfillHelper({
      payload: {
        backfill: { source: "signal_options_replay" },
        metadata: { sourceType: "signal_options_replay" },
      },
    } as never),
    false,
  );
  assert.equal(helper({ payload: { metadata: { runSource: "worker" } } } as never), false);
});

test("shadow option maintenance prices expired historical backfill closes from persisted marks", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.resolveHistoricalBackfillExpirationExitPrice;

  assert.deepEqual(
    helper({ position: { mark: "5.20", averageCost: "3.60" } } as never),
    { price: 5.2, source: "historical_backfill_last_mark" },
  );
  assert.deepEqual(
    helper({ position: { mark: null, averageCost: "3.60" } } as never),
    { price: 3.6, source: "historical_backfill_average_cost" },
  );
  assert.deepEqual(
    helper({ position: { mark: null, averageCost: null } } as never),
    { price: 0, source: "historical_backfill_unpriced_zero" },
  );
});

test("shadow option maintenance closes expired backfill rows instead of skipping them", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const body = source.match(
    /export async function runShadowOptionMaintenance\([\s\S]*?\nasync function upsertPositionForFill/,
  )?.[0];

  assert.ok(body);
  assert.match(body, /isSignalOptionsBackfillShadowOrder\(sourceOrder\)/);
  assert.match(body, /resolveHistoricalBackfillExpirationExitPrice/);
  assert.doesNotMatch(
    body,
    /if\s*\(\s*isHistoricalSignalOptionsShadowOrder\(sourceOrder\)\s*\)\s*\{\s*summary\.skippedCount/,
  );
});

test("expired historical signal-options positions are not current positions", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests
      .isExpiredHistoricalShadowOptionPosition;
  const position = {
    optionContract: {
      ticker: "O:AAPL260504C00270000",
      underlying: "AAPL",
      expirationDate: new Date("2026-05-04T00:00:00.000Z"),
      strike: 270,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: null,
    },
  } as never;
  const historicalOrder = {
    payload: { backfill: { source: "signal_options_backfill" } },
  } as never;
  const liveOrder = { payload: { metadata: { runSource: "worker" } } } as never;

  assert.equal(
    helper(position, historicalOrder, new Date("2026-05-22T14:00:00.000Z")),
    true,
  );
  assert.equal(
    helper(position, liveOrder, new Date("2026-05-22T14:00:00.000Z")),
    false,
  );
  assert.equal(
    helper(position, historicalOrder, new Date("2026-05-04T14:00:00.000Z")),
    false,
  );
});

test("buildShadowPositionDayChange uses daily baseline instead of total unrealized pnl", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.buildShadowPositionDayChange;
  assert.deepEqual(
    helper({
      currentMarketValue: 4_820,
      baselineMarketValue: null,
    }),
    { dayChange: null, dayChangePercent: null },
  );

  const changed = helper({
    currentMarketValue: 4_920,
    baselineMarketValue: 4_820,
  });
  assert.equal(changed.dayChange, 100);
  assert.equal(Number(changed.dayChangePercent?.toFixed(6)), 2.074689);
});

test("shadow replay position day changes stay anchored to the current day", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.shadowPositionDayChangeDayStart;
  const currentWallDayStart = helper(
    {
      positionKey: "manual:NVDA",
      asOf: new Date("2026-05-18T19:59:00.000Z"),
      updatedAt: new Date("2026-05-18T19:59:00.000Z"),
    } as any,
    new Date("2026-05-19T14:00:00.000Z"),
  );
  const replayDayStart = helper(
    {
      positionKey: "signal_options_replay:2026-05-18:deployment:candidate",
      asOf: new Date("2026-05-18T19:59:00.000Z"),
      updatedAt: new Date("2026-05-18T19:59:00.000Z"),
    } as any,
    new Date("2026-05-19T14:00:00.000Z"),
  );

  assert.equal(currentWallDayStart.toISOString(), "2026-05-19T04:00:00.000Z");
  assert.equal(replayDayStart.toISOString(), "2026-05-19T04:00:00.000Z");
});

test("buildShadowPositionDayChangeFromQuote uses option previous close when no baseline exists", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.buildShadowPositionDayChangeFromQuote;

  const changed = helper({
    quantity: 2,
    multiplier: 100,
    quote: {
      bid: 2.4,
      ask: 2.6,
      prevClose: 2,
      change: 0.5,
      changePercent: 25,
    },
  });

  assert.equal(changed.dayChange, 100);
  assert.equal(changed.dayChangePercent, 25);
});

test("option quote day changes use session previous close", () => {
  const changeHelper =
    __shadowWatchlistBacktestInternalsForTests.buildShadowPositionDayChangeFromQuote;

  const quote = {
    bid: 0,
    ask: 0,
    last: 7.16,
    mark: 7.16,
    prevClose: 8.35,
    change: -1.19,
    changePercent: -14.3,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    openInterest: 0,
    volume: 0,
    updatedAt: new Date("2026-05-19T19:59:58.321Z"),
  };
  const changed = changeHelper({
    quantity: 1,
    multiplier: 100,
    quote,
  });

  assert.equal(Number(changed.dayChange?.toFixed(6)), -119);
  assert.equal(Number(changed.dayChangePercent?.toFixed(6)), -14.251497);
});

test("shadow option quote identifier falls back to stored option ticker", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.shadowOptionQuoteIdentifier;

  assert.equal(
    helper({
      ticker: "O:GOOGL260526P00390000",
      providerContractId: null,
    } as any),
    "O:GOOGL260526P00390000",
  );
  assert.equal(
    helper({
      ticker: "O:GOOGL260526P00390000",
      providerContractId: "  123456789  ",
    } as any),
    "123456789",
  );
  assert.equal(
    helper({
      ticker: "GOOGL 2026-05-26 390P",
      providerContractId: null,
    } as any),
    null,
  );
  assert.equal(helper(null as any), null);
});

test("shadow option quote hydration skips prior expirations only", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.isPriorOptionExpiration;
  const baseContract = {
    ticker: "O:SPY260522C00500000",
    underlying: "SPY",
    strike: 500,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: null,
  };

  assert.equal(
    helper(
      {
        ...baseContract,
        expirationDate: new Date("2026-05-21T00:00:00.000Z"),
      } as any,
      new Date("2026-05-22T14:00:00.000Z"),
    ),
    true,
  );
  assert.equal(
    helper(
      {
        ...baseContract,
        expirationDate: new Date("2026-05-22T00:00:00.000Z"),
      } as any,
      new Date("2026-05-22T14:00:00.000Z"),
    ),
    false,
  );
});

test("shadow option mark refresh resolves stored option tickers to IBKR ids", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const markBody = source.match(
    /async function resolveOptionMark\([\s\S]*?\nasync function resolveFillPrice/,
  )?.[0];
  const refreshBody = source.match(
    /export async function refreshShadowPositionMarks\(\) \{[\s\S]*?\nasync function ensureFreshShadowState/,
  )?.[0];

  assert.ok(markBody);
  assert.match(markBody, /shadowOptionQuoteIdentifier\(contract\)/);
  assert.match(markBody, /resolveShadowIbkrOptionProviderIds/);
  assert.doesNotMatch(markBody, /fetchShadowMassiveOptionQuote\(contract\)/);
  assert.ok(refreshBody);
  assert.match(refreshBody, /fetchShadowOptionDayChangeQuotes\(optionPositions\)/);
  assert.doesNotMatch(refreshBody, /await resolveOptionMark\(contract\)/);
});

test("shadow position day changes fall back to option quotes for stale marks", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const helperBody = source.match(
    /async function readShadowPositionDayChanges\([\s\S]*?\nfunction metric\(/,
  )?.[0];

  assert.ok(helperBody);
  assert.match(helperBody, /const currentMarkStale =/);
  assert.match(
    helperBody,
    /\(baselineDayChange\.dayChange == null \|\| currentMarkStale\)/,
  );
  assert.match(helperBody, /waitForShadowOptionDayChangeQuotes/);
  assert.ok(
    helperBody.indexOf("buildShadowPositionDayChangeFromQuote") <
      helperBody.indexOf("if (currentMarkStale)"),
  );
});

test("selectLatestShadowPositionMarksByPositionId keeps one newest mark per position", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests
      .selectLatestShadowPositionMarksByPositionId;
  const selected = helper([
    {
      positionId: "pos-a",
      asOf: new Date("2026-05-01T13:00:00.000Z"),
      marketValue: "100",
    },
    {
      positionId: "pos-b",
      asOf: new Date("2026-05-01T12:00:00.000Z"),
      marketValue: "200",
    },
    {
      positionId: "pos-a",
      asOf: new Date("2026-05-01T14:00:00.000Z"),
      marketValue: "125",
    },
  ]);

  assert.equal(selected.size, 2);
  assert.equal(selected.get("pos-a")?.marketValue, "125");
  assert.equal(selected.get("pos-b")?.marketValue, "200");
});

test("shadow balance snapshots are timestamped from fills and marks", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /async function writeShadowBalanceSnapshot\(source = "ledger", asOf = new Date\(\)\)/,
  );
  assert.match(
    source,
    /const snapshotSource = shadowBalanceSnapshotSourceForOrder\(\{/,
  );
  assert.match(
    source,
    /await writeShadowBalanceSnapshot\(snapshotSource,\s*now\)/,
  );
  assert.match(
    source,
    /await writeShadowBalanceSnapshot\(\s*options\.markSource \?\? "automation_mark",\s*event\.occurredAt,\s*\)/,
  );
  assert.match(source, /shadowMarkSnapshotSourceForPosition\(position\)/);
});

test("signal-options replay mirrors keep replay snapshot sources", () => {
  const source = readFileSync(new URL("./signal-options-automation.ts", import.meta.url), "utf8");

  assert.match(source, /source: input\.ledgerSource/);
  assert.match(source, /markSource: input\.ledgerMarkSource/);
  assert.match(
    source,
    /ledgerSource:\s*input\.replay \|\| source === SIGNAL_OPTIONS_REPLAY_SOURCE\s*\?\s*SIGNAL_OPTIONS_REPLAY_SOURCE\s*:\s*undefined/,
  );
  assert.match(
    source,
    /ledgerMarkSource:\s*input\.replay \|\| source === SIGNAL_OPTIONS_REPLAY_SOURCE\s*\?\s*SIGNAL_OPTIONS_REPLAY_MARK_SOURCE\s*:\s*undefined/,
  );
  assert.doesNotMatch(source, /input\.ledgerSource === SIGNAL_OPTIONS_REPLAY_SOURCE\s*\?\s*"automation"/);
  assert.doesNotMatch(source, /input\.ledgerMarkSource === SIGNAL_OPTIONS_REPLAY_MARK_SOURCE\s*\?\s*"automation_mark"/);
});

test("source-scoped shadow positions require matching source keys and source prefix", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

  assert.match(source, /async function readOpenShadowPositionsForSource/);
  assert.match(source, /async function readOpenShadowPositionsForSourceCached/);
  assert.match(source, /`open-positions:\$\{shadowSourceCacheKey\(source\)\}`/);
  assert.match(source, /sourcePositionKeys\.has\(position\.positionKey\)/);
  assert.match(source, /positionMatchesShadowSource\(position, source\)/);
});

test("shadow account positions repair live signal-options mirrors inside cached read", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const summaryBody = source.match(
    /export async function getShadowAccountSummary\([\s\S]*?\nexport async function getShadowAccountAllocation/,
  )?.[0];
  const positionsBody = source.match(
    /export async function getShadowAccountPositions\([\s\S]*?\nexport async function getShadowAccountPositionsAtDate/,
  )?.[0];
  const riskBody = source.match(
    /async function buildShadowAccountRisk\([\s\S]*?\nfunction shadowPositionForNotionalRisk/,
  )?.[0];

  assert.match(source, /async function repairSignalOptionsAutomationMirrorsForRead/);
  assert.match(source, /const SHADOW_AUTOMATION_MIRROR_REPAIR_TTL_MS = 60_000;/);
  assert.match(source, /SIGNAL_OPTIONS_SHADOW_ENTRY_EVENT/);
  assert.match(source, /SIGNAL_OPTIONS_SHADOW_EXIT_EVENT/);
  assert.match(source, /recordShadowAutomationEvent\(event,\s*\{\s*source: "automation",\s*\}\)/);
  assert.match(source, /await repairSignalOptionsAutomationMirrorsForRead\(source\);/);
  assert.ok(summaryBody);
  assert.doesNotMatch(summaryBody, /repairSignalOptionsAutomationMirrorsForRead/);
  assert.ok(positionsBody);
  assert.ok(
    positionsBody.indexOf("return withShadowReadCache(") <
      positionsBody.indexOf("await repairSignalOptionsAutomationMirrorsForRead(source);"),
  );
  assert.ok(riskBody);
  assert.match(riskBody, /getShadowAccountPositions\(\{\s*source,\s*liveQuotes: false,?\s*\}\)/);
});

test("shadow signal-options mirror repair skips historical backfill events", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const liveEntry = {
    eventType: "signal_options_shadow_entry",
    payload: { metadata: { runSource: "worker" } },
  };
  const backfillEntry = {
    eventType: "signal_options_shadow_entry",
    payload: { backfill: { source: "signal_options_backfill" } },
  };
  const mark = {
    eventType: "signal_options_shadow_mark",
    payload: { metadata: { runSource: "worker" } },
  };

  assert.equal(internals.isSignalOptionsAutomationMirrorEvent(liveEntry as any), true);
  assert.equal(internals.isSignalOptionsAutomationMirrorEvent(backfillEntry as any), false);
  assert.equal(internals.isSignalOptionsAutomationMirrorEvent(mark as any), false);
});

test("shadow positions expose signal-options management context from mark events", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

  assert.match(source, /const SIGNAL_OPTIONS_SHADOW_MARK_EVENT = "signal_options_shadow_mark";/);
  assert.match(source, /async function latestShadowAutomationManagementEvents/);
  assert.match(source, /function buildShadowAutomationContext/);
  assert.match(source, /trailActivationPrice/);
  assert.match(source, /takeProfit/);
  assert.match(source, /tradeManagement:\s*\{/);
  assert.match(source, /const trailActive = displayStop\?\.trailActive \?\? eventStop\.trailActive === true/);
  assert.match(source, /trailActive,/);
  assert.match(source, /automationContext/);
  assert.ok(
    source.indexOf("const automationManagementEvents = await latestShadowAutomationManagementEvents") <
      source.indexOf("const cachedOptionQuotes = readCachedShadowOptionQuotes(filtered);"),
  );
});

test("shadow automation context keeps trail activation out of take-profit fields", () => {
  const context =
    __shadowWatchlistBacktestInternalsForTests.buildShadowAutomationContext({
      position: {
        averageCost: "4.02",
      } as any,
      sourceOrder: {
        source: "automation",
        sourceEventId: "entry-event",
        payload: {
          profile: {
            exitPolicy: {
              trailActivationPct: 35,
            },
          },
          position: {
            entryPrice: 4.02,
            stopPrice: 2.81,
            openedAt: "2026-05-29T14:39:31.947Z",
          },
        },
      } as any,
      latestEvent: {
        id: "mark-event",
        occurredAt: new Date("2026-05-29T14:50:41.642Z"),
        payload: {
          position: {
            entryPrice: 4.02,
            peakPrice: 4.17,
          },
          stop: {
            stopPrice: 2.81,
            hardStopPrice: 2.81,
            trailActive: false,
          },
        },
      } as any,
    });

  assert.equal(context?.stopLossPrice, 2.81);
  assert.equal(context?.stopPrice, 2.81);
  assert.equal(context?.takeProfitPrice, null);
  assert.equal(context?.targetPrice, null);
  assert.equal(context?.trailActivationPrice, 5.43);
  assert.equal(context?.tradeManagement.trailActivationPrice, 5.43);
  assert.equal(context?.tradeManagement.targetKind, null);
});

test("shadow automation context derives active trail from current position marks", () => {
  const context =
    __shadowWatchlistBacktestInternalsForTests.buildShadowAutomationContext({
      position: {
        averageCost: "4.00",
        mark: "6.00",
      } as any,
      peakMarkPrice: 6,
      sourceOrder: {
        source: "automation",
        sourceEventId: "entry-event",
        payload: {
          profile: {
            exitPolicy: {
              hardStopPct: -30,
              trailActivationPct: 35,
              minLockedGainPct: 15,
              trailGivebackPct: 20,
              progressiveTrailEnabled: false,
            },
          },
          position: {
            entryPrice: 4,
            stopPrice: 2.8,
          },
        },
      } as any,
      latestEvent: null,
    });

  assert.equal(context?.stopLossPrice, 2.8);
  assert.equal(context?.takeProfitPrice, null);
  assert.equal(context?.trailActivationPrice, 5.4);
  assert.equal(context?.tradeManagement.trailActive, true);
  assert.equal(context?.tradeManagement.trailStopPrice, 4.8);
  assert.equal(context?.stopPrice, 4.8);
});

test("shadow automation context recomputes chart risk lines from Algo exit settings", () => {
  const buildContext = (exitPolicy: Record<string, unknown>) =>
    __shadowWatchlistBacktestInternalsForTests.buildShadowAutomationContext({
      position: {
        averageCost: "4.00",
        mark: "6.00",
      } as any,
      peakMarkPrice: 6,
      sourceOrder: {
        source: "automation",
        sourceEventId: "entry-event",
        payload: {
          profile: {
            exitPolicy: {
              ...exitPolicy,
              progressiveTrailEnabled: false,
            },
          },
          position: {
            entryPrice: 4,
          },
        },
      } as any,
      latestEvent: null,
    });

  const baseline = buildContext({
    hardStopPct: -30,
    trailActivationPct: 35,
    minLockedGainPct: 15,
    trailGivebackPct: 20,
  });
  const tighter = buildContext({
    hardStopPct: -40,
    trailActivationPct: 25,
    minLockedGainPct: 20,
    trailGivebackPct: 10,
  });

  assert.equal(baseline?.stopLossPrice, 2.8);
  assert.equal(baseline?.tradeManagement.trailStopPrice, 4.8);
  assert.equal(tighter?.stopLossPrice, 2.4);
  assert.equal(tighter?.tradeManagement.trailStopPrice, 5.4);
  assert.equal(tighter?.activeStopPrice, 5.4);
  assert.equal(tighter?.activeStopKind, "trailing_stop");
});

test("shadow option quote marks ignore zero-only IBKR snapshots", () => {
  const helper = __shadowWatchlistBacktestInternalsForTests.shadowQuoteMarkPrice;

  assert.equal(helper({ bid: 0, ask: 0, mark: 0, price: 0, last: null }), null);
  assert.equal(Number(helper({ bid: 1.2, ask: 1.4, mark: 0 })?.toFixed(2)), 1.3);
  assert.equal(helper({ bid: 0, ask: 2.5, price: 2.45 }), 2.45);
});

test("shadow option pricing policy blocks frozen and partial quotes from valuation", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.buildShadowOptionPricingPolicy;

  const live = helper({
    quote: {
      bid: 1.2,
      ask: 1.4,
      freshness: "live",
      marketDataMode: "live",
      updatedAt: "2026-05-27T15:30:00.000Z",
    },
    fallbackMark: 1.1,
  });
  assert.equal(live.valuationEligible, true);
  assert.equal(Number(live.valuationMark?.toFixed(2)), 1.3);
  assert.equal(live.valuationSource, "option_quote");

  const frozen = helper({
    quote: {
      bid: 1.2,
      ask: 1.4,
      freshness: "live",
      marketDataMode: "frozen",
      updatedAt: "2026-05-27T20:50:00.000Z",
    },
    fallbackMark: 1.1,
  });
  assert.equal(frozen.valuationEligible, false);
  assert.equal(frozen.valuationMark, 1.1);
  assert.equal(frozen.valuationReason, "market_data_frozen");

  const partial = helper({
    quote: {
      bid: 0,
      ask: 1.4,
      mark: 1.3,
      freshness: "live",
      marketDataMode: "live",
    },
    fallbackMark: 1.1,
  });
  assert.equal(partial.valuationEligible, false);
  assert.equal(partial.valuationMark, 1.1);
  assert.equal(partial.valuationReason, "quote_not_two_sided");
});

test("shadow mark trailing decision matches APLD live stop breach", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const pricing = internals.buildShadowOptionPricingPolicy({
    quote: {
      bid: 2.61,
      ask: 2.75,
      freshness: "live",
      marketDataMode: "live",
      updatedAt: "2026-05-28T13:50:52.000Z",
    },
    fallbackMark: 2.68,
  });

  const decision = internals.computeSignalOptionsShadowMarkExitDecision({
    contract: {
      ticker: "APLD20260529C46",
      underlying: "APLD",
      expirationDate: new Date("2026-05-29T00:00:00.000Z"),
      strike: 46,
      right: "call" as const,
      multiplier: 100,
      sharesPerContract: 100,
    },
    entryPrice: 2.4,
    peakPrice: 3.9,
    markPrice: 2.68,
    profile: tunedSignalOptionsExecutionProfile,
    pricing,
    markAt: new Date("2026-05-28T13:50:52.000Z"),
  });

  assert.equal(decision.exitReason, "runner_trail_stop");
  assert.equal(decision.skipReason, null);
  assert.equal(decision.exitPrice, 2.62);
  assert.equal(decision.stop?.trailActive, true);
  assert.equal(decision.stop?.trailStopPrice, 3.12);
  assert.deepEqual(decision.stop?.progressiveTrailStep, {
    activationPct: 45,
    minLockedGainPct: 25,
    givebackPct: 20,
  });
});

test("shadow mark trailing decision catches CRWV runner giveback from fresh marks", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const pricing = internals.buildShadowOptionPricingPolicy({
    quote: {
      bid: 6.9,
      ask: 7.04,
      freshness: "live",
      marketDataMode: "live",
      updatedAt: "2026-05-28T15:47:00.000Z",
    },
    fallbackMark: 6.97,
  });

  const decision = internals.computeSignalOptionsShadowMarkExitDecision({
    contract: {
      ticker: "CRWV20260529C102",
      underlying: "CRWV",
      expirationDate: new Date("2026-05-29T00:00:00.000Z"),
      strike: 102,
      right: "call" as const,
      multiplier: 100,
      sharesPerContract: 100,
    },
    entryPrice: 4.2,
    peakPrice: 8.662342,
    markPrice: 6.97,
    profile: tunedSignalOptionsExecutionProfile,
    pricing,
    markAt: new Date("2026-05-28T15:47:00.000Z"),
  });

  assert.equal(decision.exitReason, "runner_trail_stop");
  assert.equal(decision.skipReason, null);
  assert.equal(decision.exitPrice, 6.91);
  assert.equal(decision.stop?.trailActive, true);
  assert.equal(decision.stop?.trailStopPrice, 7.36);
  assert.deepEqual(decision.stop?.progressiveTrailStep, {
    activationPct: 100,
    minLockedGainPct: 60,
    givebackPct: 15,
  });
});

test("shadow mark trailing decision only uses actionable in-session option quotes", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const contract = {
    ticker: "CRWV20260529C102",
    underlying: "CRWV",
    expirationDate: new Date("2026-05-29T00:00:00.000Z"),
    strike: 102,
    right: "call" as const,
    multiplier: 100,
    sharesPerContract: 100,
  };
  const livePricing = internals.buildShadowOptionPricingPolicy({
    quote: {
      bid: 6.9,
      ask: 7.04,
      freshness: "live",
      marketDataMode: "live",
      updatedAt: "2026-05-28T15:47:00.000Z",
    },
    fallbackMark: 6.97,
  });
  const frozenPricing = internals.buildShadowOptionPricingPolicy({
    quote: {
      bid: 6.9,
      ask: 7.04,
      freshness: "live",
      marketDataMode: "frozen",
      updatedAt: "2026-05-28T15:47:00.000Z",
    },
    fallbackMark: 6.97,
  });
  const baseDecision = {
    contract,
    entryPrice: 4.2,
    peakPrice: 8.662342,
    markPrice: 6.97,
    profile: tunedSignalOptionsExecutionProfile,
    markAt: new Date("2026-05-28T15:47:00.000Z"),
  };

  assert.equal(
    internals.computeSignalOptionsShadowMarkExitDecision({
      ...baseDecision,
      pricing: frozenPricing,
    }).skipReason,
    "mark_not_actionable",
  );
  assert.equal(
    internals.computeSignalOptionsShadowMarkExitDecision({
      ...baseDecision,
      pricing: livePricing,
      markAt: new Date("2026-05-28T20:01:00.000Z"),
    }).skipReason,
    "option_session_closed",
  );
});

test("shadow mark refresh enforces signal-options trailing stops after mark writes", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const refreshBody = source.match(
    /export async function refreshShadowPositionMarks\([\s\S]*?\nasync function ensureFreshShadowState/,
  )?.[0];

  assert.ok(refreshBody);
  assert.ok(
    refreshBody.indexOf("await db.insert(shadowPositionMarksTable).values") <
      refreshBody.indexOf("await enforceSignalOptionsTrailingStopFromShadowMark"),
  );
  assert.match(refreshBody, /position\.assetClass === "option" && contract && optionPricing/);
  assert.match(source, /enforcementSource: "shadow_mark"/);
});

test("shadow option day change ignores frozen quote valuation", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.buildShadowPositionDayChangeFromQuote;

  assert.deepEqual(
    helper({
      quantity: 2,
      multiplier: 100,
      quote: {
        bid: 1.2,
        ask: 1.4,
        prevClose: 1,
        change: 0.3,
        freshness: "live",
        marketDataMode: "frozen",
      },
    }),
    { dayChange: null, dayChangePercent: null },
  );
});

test("shadow positions expose market-data symbols from contract or ledger key", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;

  assert.equal(
    internals.shadowPositionMarketDataSymbol({
      symbol: "twsopt:123456",
      optionContract: {
        ticker: "AAPL 260116C00180000",
        underlying: "aapl",
        expirationDate: new Date("2026-01-16T00:00:00.000Z"),
        strike: 180,
        right: "call",
      },
      positionKey: "option:AAPL:2026-01-16:180:call:twsopt:123456",
    }),
    "AAPL",
  );
  assert.equal(
    internals.shadowPositionMarketDataSymbol({
      symbol: "twsopt:123456",
      optionContract: null,
      positionKey: "option:MSFT:2026-01-16:420:put:twsopt:123456",
    }),
    "MSFT",
  );
  assert.equal(
    internals.shadowPositionMarketDataSymbol({
      symbol: "SPY",
      optionContract: null,
      positionKey: "equity:SPY",
    }),
    "SPY",
  );
});

test("shadow equity history terminal points only use current time for open positions", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const totals = {
    cash: 30_000,
    startingBalance: 30_000,
    realizedPnl: 0,
    unrealizedPnl: -75,
    fees: 0,
    marketValue: 320,
    netLiquidation: 30_320,
    updatedAt: new Date("2026-05-12T20:00:00.000Z"),
  };
  const now = new Date("2026-05-13T15:03:12.357Z");

  assert.equal(
    internals.withCurrentOpenPositionTerminalTimestamp(totals, 0, now).updatedAt.toISOString(),
    "2026-05-12T20:00:00.000Z",
  );
  assert.equal(
    internals.withCurrentOpenPositionTerminalTimestamp(totals, 1, now).updatedAt.toISOString(),
    "2026-05-13T15:03:12.357Z",
  );
});

test("shadow equity history historical terminal prefers market time over refresh time", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const timestamp = internals.latestHistoricalShadowTotalsDate(
    [
      {
        asOf: new Date("2026-04-21T19:40:00.000Z"),
        updatedAt: new Date("2026-05-22T01:20:55.445Z"),
      },
      {
        asOf: new Date("2026-04-21T19:45:00.000Z"),
        updatedAt: new Date("2026-05-22T01:20:57.112Z"),
      },
    ],
    [{ occurredAt: new Date("2026-04-21T19:50:00.000Z") }],
    new Date("2026-05-22T01:21:00.000Z"),
  );

  assert.equal(timestamp.toISOString(), "2026-04-21T19:50:00.000Z");
});

test("shadow equity history keeps historical backfill positions on historical time", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const totalsBody = source.match(
    /async function computeShadowTotalsForSource\([\s\S]*?\nasync function computeShadowTotals\(\)/,
  )?.[0];

  assert.ok(totalsBody);
  assert.match(totalsBody, /historicalSignalOptionsOpenPositions/);
  assert.match(totalsBody, /isHistoricalSignalOptionsShadowOrder\(sourceOrder\)/);
  assert.match(
    totalsBody,
    /options\.useCurrentTimestampForOpenPositions &&\s+!historicalSignalOptionsOpenPositions/,
  );
  assert.match(totalsBody, /updatedAt: latestHistoricalShadowTotalsDate/);
});

test("shadow equity history initial transfer uses the account starting balance", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const historyBody = source.match(
    /export async function getShadowAccountEquityHistory\([\s\S]*?\nfunction buildShadowAccountAllocationResponse/,
  )?.[0];

  assert.ok(historyBody);
  assert.match(historyBody, /const accountStartingBalance =\s+toNumber\(account\.startingBalance\) \?\? SHADOW_STARTING_BALANCE;/);
  assert.match(historyBody, /netLiquidation: accountStartingBalance/);
  assert.match(historyBody, /deposits: accountStartingBalance/);
  assert.match(historyBody, /amount: accountStartingBalance/);
});

test("shadow mark snapshots keep replay-key positions on the replay ledger", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;

  assert.equal(
    internals.shadowMarkSnapshotSourceForPosition({
      positionKey: "signal_options_replay:2026-05-12:deployment:candidate",
    } as any),
    "signal_options_replay_mark",
  );
  assert.equal(
    internals.shadowMarkSnapshotSourceForPosition({
      positionKey: "watchlist_backtest:2026-05-12:SPY",
    } as any),
    "watchlist_backtest_mark",
  );
  assert.equal(
    internals.shadowMarkSnapshotSourceForPosition({
      positionKey: "option:NVDA:2026-05-15:222.5:call:twsopt:contract",
    } as any),
    "mark",
  );
});

test("shadow order snapshot source keeps replay orders out of automation ledger history", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;

  assert.equal(
    internals.shadowBalanceSnapshotSourceForOrder({
      source: "signal_options_replay",
      payload: {},
      positionKey: null,
    }),
    "signal_options_replay",
  );
  assert.equal(
    internals.shadowBalanceSnapshotSourceForOrder({
      source: "automation",
      payload: { metadata: { sourceType: "signal_options_replay" } },
      positionKey: null,
    }),
    "signal_options_replay",
  );
  assert.equal(
    internals.shadowBalanceSnapshotSourceForOrder({
      source: "automation",
      payload: {},
      positionKey: "signal_options_replay:2026-05-12:deployment:candidate",
    }),
    "signal_options_replay",
  );
  assert.equal(
    internals.shadowBalanceSnapshotSourceForOrder({
      source: "automation",
      payload: {},
      positionKey: "option:NVDA:2026-05-15:222.5:call:twsopt:contract",
    }),
    "automation",
  );
  assert.equal(
    internals.shadowBalanceSnapshotSourceForOrder({
      source: "manual",
      payload: {},
      positionKey: "option:NVDA:2026-05-15:222.5:call:twsopt:contract",
    }),
    "ledger",
  );
});

test("shadow equity history does not create synthetic today points from ensure calls", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

  const ensureShadowAccountBody = source.match(
    /async function ensureShadowAccount\(\): Promise<ShadowAccountRow> \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(ensureShadowAccountBody);
  assert.doesNotMatch(ensureShadowAccountBody, /updatedAt: new Date\(\)/);
  assert.match(source, /await computeShadowEquityHistoryTerminalTotals\(source\)/);
  assert.match(source, /SHADOW_EQUITY_HISTORY_MARK_REFRESH_MAX_WAIT_MS/);
  assert.match(source, /const includeLiveTerminal =\s*\n\s*totals &&/);
  assert.match(source, /useCurrentTimestampForOpenPositions: true/);
  assert.match(
    source,
    /totals\.updatedAt\.getTime\(\) > latestCompactedAt\.getTime\(\)/,
  );
  assert.match(source, /liveLedgerRows\.filter\(\(row\) => row\.source !== "initial"\)/);
  assert.match(source, /const initialPointTimestamp =/);
});

const shadowTotals = {
  cash: 30_000,
  startingBalance: 30_000,
  realizedPnl: 0,
  unrealizedPnl: 0,
  fees: 0,
  marketValue: 0,
  netLiquidation: 30_000,
  updatedAt: new Date("2026-05-01T14:00:00.000Z"),
};

const candidate = (patch: Record<string, unknown>) => ({
  symbol: "AAPL",
  side: "buy",
  signal: {},
  signalAt: new Date("2026-05-01T14:00:00.000Z"),
  signalPrice: 100,
  signalClose: 100,
  fillPrice: 100,
  placedAt: new Date("2026-05-01T14:15:00.000Z"),
  fillSource: "next_bar_open",
  timeframe: "5m",
  watchlists: [{ id: "default", name: "Default" }],
  ...patch,
});

test("buildWatchlistBacktestFills uses run-scoped positions and long-only exits", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-1",
    marketDate: "2026-05-01",
    startingTotals: shadowTotals,
    baseMarketValue: 0,
    candidates: [
      candidate({}),
      candidate({ fillPrice: 101, signalAt: new Date("2026-05-01T14:30:00.000Z") }),
      candidate({
        side: "sell",
        fillPrice: 110,
        placedAt: new Date("2026-05-01T15:00:00.000Z"),
        signalAt: new Date("2026-05-01T14:45:00.000Z"),
      }),
      candidate({
        symbol: "MSFT",
        side: "sell",
        fillPrice: 250,
        placedAt: new Date("2026-05-01T15:15:00.000Z"),
        signalAt: new Date("2026-05-01T15:00:00.000Z"),
      }),
    ] as never,
  });

  assert.equal(result.fills.length, 2);
  assert.equal(result.fills[0]?.side, "buy");
  assert.equal(result.fills[0]?.quantity, 30);
  assert.equal(result.fills[0]?.positionKey, "watchlist_backtest:run-1:equity:AAPL");
  assert.equal(result.fills[1]?.side, "sell");
  assert.equal(result.fills[1]?.realizedPnl, 299);
  assert.deepEqual(
    result.skipped.map((skip) => skip.reason),
    ["same_symbol_position_open", "no_synthetic_position"],
  );
});

test("watchlist backtest closed-trade metrics summarize wins and expectancy", () => {
  const metrics =
    __shadowWatchlistBacktestInternalsForTests.summarizeWatchlistBacktestClosedTrades([
      {
        side: "buy",
        realizedPnl: 0,
      },
      {
        side: "sell",
        realizedPnl: 120,
      },
      {
        side: "sell",
        realizedPnl: -30,
      },
      {
        side: "sell",
        realizedPnl: 0,
      },
    ] as never);

  assert.equal(metrics.closedTrades, 3);
  assert.equal(metrics.winningTrades, 1);
  assert.equal(metrics.losingTrades, 1);
  assert.equal(Number(metrics.winRatePercent?.toFixed(6)), 33.333333);
  assert.equal(metrics.averageWin, 120);
  assert.equal(metrics.averageLoss, -30);
  assert.equal(metrics.expectancy, 30);
  assert.equal(metrics.profitFactor, 4);
});

test("Shadow trade diagnostics attribute ticker performance and chart annotations", () => {
  const order = ({
    id,
    symbol,
    side,
    placedAt,
    candidateId,
  }: {
    id: string;
    symbol: string;
    side: "buy" | "sell";
    placedAt: Date;
    candidateId: string;
  }) =>
    ({
      id,
      accountId: "shadow",
      source: "watchlist_backtest",
      sourceEventId: null,
      clientOrderId: null,
      symbol,
      assetClass: "equity",
      side,
      type: "market",
      timeInForce: "day",
      status: "filled",
      quantity: "10",
      filledQuantity: "10",
      limitPrice: null,
      stopPrice: null,
      averageFillPrice: null,
      fees: "1",
      rejectionReason: null,
      optionContract: null,
      payload: {
        candidate: { id: candidateId, symbol },
        metadata: {
          runId: "run-patterns",
          timeframe: "5m",
          variantId: "SQQQ:1h:exit_longs_buy_proxy",
        },
      },
      placedAt,
      filledAt: placedAt,
      createdAt: placedAt,
      updatedAt: placedAt,
    });
  const fill = ({
    id,
    orderId,
    symbol,
    side,
    quantity,
    price,
    grossAmount,
    fees,
    realizedPnl,
    cashDelta,
    occurredAt,
  }: {
    id: string;
    orderId: string;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    price: number;
    grossAmount: number;
    fees: number;
    realizedPnl: number;
    cashDelta: number;
    occurredAt: Date;
  }) =>
    ({
      id,
      accountId: "shadow",
      orderId,
      sourceEventId: null,
      symbol,
      assetClass: "equity",
      side,
      quantity: String(quantity),
      price: String(price),
      grossAmount: String(grossAmount),
      fees: String(fees),
      realizedPnl: String(realizedPnl),
      cashDelta: String(cashDelta),
      optionContract: null,
      occurredAt,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });

  const orders = [
    order({
      id: "11111111-1111-4111-8111-111111111111",
      symbol: "AAPL",
      side: "buy",
      placedAt: new Date("2026-02-03T14:30:00.000Z"),
      candidateId: "aapl-buy",
    }),
    order({
      id: "22222222-2222-4222-8222-222222222222",
      symbol: "AAPL",
      side: "sell",
      placedAt: new Date("2026-02-03T16:00:00.000Z"),
      candidateId: "aapl-sell",
    }),
    order({
      id: "33333333-3333-4333-8333-333333333333",
      symbol: "MSFT",
      side: "buy",
      placedAt: new Date("2026-02-04T14:30:00.000Z"),
      candidateId: "msft-buy",
    }),
    order({
      id: "44444444-4444-4444-8444-444444444444",
      symbol: "MSFT",
      side: "sell",
      placedAt: new Date("2026-02-04T15:00:00.000Z"),
      candidateId: "msft-sell",
    }),
  ];

  const packet =
    __shadowWatchlistBacktestInternalsForTests.buildShadowTradeDiagnosticsFromRows({
      range: "YTD",
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-03T00:00:00.000Z"),
      fills: [
        fill({
          id: "fill-aapl-buy",
          orderId: "11111111-1111-4111-8111-111111111111",
          symbol: "AAPL",
          side: "buy",
          quantity: 10,
          price: 100,
          grossAmount: 1_000,
          fees: 1,
          realizedPnl: 0,
          cashDelta: -1_001,
          occurredAt: new Date("2026-02-03T14:30:00.000Z"),
        }),
        fill({
          id: "fill-aapl-sell",
          orderId: "22222222-2222-4222-8222-222222222222",
          symbol: "AAPL",
          side: "sell",
          quantity: 10,
          price: 110,
          grossAmount: 1_100,
          fees: 1,
          realizedPnl: 98,
          cashDelta: 1_099,
          occurredAt: new Date("2026-02-03T16:00:00.000Z"),
        }),
        fill({
          id: "fill-msft-buy",
          orderId: "33333333-3333-4333-8333-333333333333",
          symbol: "MSFT",
          side: "buy",
          quantity: 5,
          price: 200,
          grossAmount: 1_000,
          fees: 1,
          realizedPnl: 0,
          cashDelta: -1_001,
          occurredAt: new Date("2026-02-04T14:30:00.000Z"),
        }),
        fill({
          id: "fill-msft-sell",
          orderId: "44444444-4444-4444-8444-444444444444",
          symbol: "MSFT",
          side: "sell",
          quantity: 5,
          price: 190,
          grossAmount: 950,
          fees: 1,
          realizedPnl: -52,
          cashDelta: 949,
          occurredAt: new Date("2026-02-04T15:00:00.000Z"),
        }),
      ] as never,
      ordersById: new Map(orders.map((row) => [row.id, row as never])),
    });

  assert.equal(packet.summary.closedTrades, 2);
  assert.equal(packet.summary.winningTrades, 1);
  assert.equal(packet.summary.tradeEvents, 4);
  assert.equal(packet.summary.bestTicker?.symbol, "AAPL");
  assert.equal(packet.summary.worstTicker?.symbol, "MSFT");
  assert.equal(packet.tickerStats[0]?.symbol, "AAPL");
  assert.equal(packet.tickerStats[1]?.symbol, "MSFT");
  assert.deepEqual(
    packet.equityAnnotations.map((event) => event.type),
    ["trade_buy", "trade_sell", "trade_buy", "trade_sell"],
  );
  assert.equal(packet.roundTrips[0]?.holdDurationMinutes, 90);
  assert.equal(packet.roundTrips[1]?.holdDurationMinutes, 30);
  assert.equal(packet.sourceStats[0]?.sourceType, "watchlist_backtest");
  assert.equal(packet.fullPacketIncluded, true);
});

test("watchlist backtest buy-hold benchmark compares strategy entries to end marks", () => {
  const metrics =
    __shadowWatchlistBacktestInternalsForTests.summarizeWatchlistBacktestBuyHoldBenchmark({
      targetMultiple: 1.5,
      barsBySymbol: new Map([
        [
          "AAPL",
          [
            {
              time: Math.floor(new Date("2026-05-01T14:00:00.000Z").getTime() / 1000),
              ts: "2026-05-01T14:00:00.000Z",
              o: 99,
              h: 101,
              l: 98,
              c: 100,
              v: 1_000,
            },
            {
              time: Math.floor(new Date("2026-05-01T15:00:00.000Z").getTime() / 1000),
              ts: "2026-05-01T15:00:00.000Z",
              o: 120,
              h: 131,
              l: 119,
              c: 130,
              v: 1_000,
            },
          ],
        ],
      ]),
      windowStart: new Date("2026-05-01T14:00:00.000Z"),
      windowEnd: new Date("2026-05-01T16:00:00.000Z"),
      benchmarkCapital: 1_000,
      strategyPnl: 98,
      fills: [
        {
          symbol: "AAPL",
          side: "buy",
          quantity: 10,
          price: 100,
          fees: 1,
          grossAmount: 1_000,
        },
        {
          symbol: "AAPL",
          side: "sell",
          quantity: 10,
          price: 110,
          fees: 1,
          grossAmount: 1_100,
        },
      ] as never,
    });

  assert.equal(metrics.strategyMatchedPnl, 98);
  assert.equal(Number(metrics.matchedBuyHoldPnl.toFixed(6)), 300);
  assert.equal(Number(metrics.alphaVsBuyHold.toFixed(6)), -202);
  assert.equal(Number(metrics.outperformanceMultiple?.toFixed(6)), 0.326667);
  assert.equal(Number(metrics.targetBuyHoldPnl.toFixed(6)), 450);
  assert.equal(Number(metrics.targetPnlDelta.toFixed(6)), -352);
  assert.equal(metrics.tradedSymbols, 1);
  assert.equal(metrics.benchmarkableSymbols, 1);
});

test("watchlist backtest sweep includes wider drawdown risk variants", () => {
  const variants =
    __shadowWatchlistBacktestInternalsForTests.buildWatchlistBacktestSweepVariants();
  const ids = new Set(variants.map((variant) => variant.id));

  assert.equal(ids.has("baseline"), true);
  assert.equal(ids.has("TR3"), true);
  assert.equal(ids.has("TR5"), true);
  assert.equal(ids.has("TR8"), true);
  assert.equal(ids.has("SL6"), true);
  assert.equal(ids.has("SL10"), true);
  assert.equal(
    ids.has("VXX:5m:pause_new_longs:until_proxy_sell:TR5"),
    true,
  );
});

test("watchlist exploratory sweep includes wider stops and cash-only sizing variants", () => {
  const variants =
    __shadowWatchlistBacktestInternalsForTests.buildWatchlistBacktestSweepVariants({
      exploratory: true,
    });
  const ids = new Set(variants.map((variant) => variant.id));

  assert.equal(ids.has("TR20:P20x5"), true);
  assert.equal(ids.has("SL8_TR15:P25x4"), true);
  assert.equal(ids.has("TR15_SIG8:P25x4"), true);
  assert.equal(
    ids.has("VXX:15m:pause_new_longs:until_proxy_sell:TR12:P15x6"),
    true,
  );
  assert.equal(variants.length > 330, true);
});

test("watchlist sweep can restrict defensive proxy variants to inverse ETFs", () => {
  const variants =
    __shadowWatchlistBacktestInternalsForTests.buildWatchlistBacktestSweepVariants({
      exploratory: true,
      proxySymbols: ["SQQQ"],
    });
  const ids = new Set(variants.map((variant) => variant.id));

  assert.equal(ids.has("SQQQ:1h:exit_longs_buy_proxy:until_proxy_sell:TR15_SIG8:P25x4:RANKB"), true);
  assert.equal(
    Array.from(ids).some((id) => id.startsWith("VXX:")),
    false,
  );
});

test("watchlist entry gate filters buys by EMA trend and confirmation quorum", () => {
  const bars = Array.from({ length: 80 }, (_, index) => {
    const close = 100 + index;
    const time = Math.floor(
      new Date("2026-05-01T13:30:00.000Z").getTime() / 1000,
    ) + index * 60;
    return {
      time,
      ts: new Date(time * 1000).toISOString(),
      o: close - 0.2,
      h: close + 0.5,
      l: close - 0.5,
      c: close,
      v: 10_000,
    };
  });
  const signal = (filterState: Record<string, unknown>) => ({
    id: "signal",
    eventType: "buy_signal",
    direction: "long",
    barIndex: 70,
    time: bars[70]!.time,
    ts: bars[70]!.ts,
    price: bars[70]!.c,
    close: bars[70]!.c,
    actionable: true,
    filtered: false,
    filterState,
  });
  const overlay =
    __shadowWatchlistBacktestInternalsForTests.normalizeWatchlistBacktestEntryGateOverlay({
      emaFastWindow: 21,
      emaSlowWindow: 55,
      minConfirmations: 3,
      adxMin: 20,
      volScoreMin: 2,
      volScoreMax: 10,
    });

  assert.ok(overlay);

  const result =
    __shadowWatchlistBacktestInternalsForTests.applyWatchlistBacktestEntryGate({
      signalScan: {
        candidates: [
          candidate({
            symbol: "AAPL",
            signal: signal({
              mtfDirections: [1, -1, -1],
              adx: 25,
              volatilityScore: 6,
            }),
            signalScoreDetails: { base: 1 },
          }),
          candidate({
            symbol: "MSFT",
            signal: signal({
              mtfDirections: [1, -1, -1],
              adx: 10,
              volatilityScore: 20,
            }),
            signalScoreDetails: {},
          }),
          candidate({
            symbol: "TSLA",
            side: "sell",
            signal: {
              ...signal({
                mtfDirections: [-1, -1, -1],
                adx: 10,
                volatilityScore: 20,
              }),
              eventType: "sell_signal",
              direction: "short",
            },
            signalScoreDetails: {},
          }),
        ] as never,
        barsBySymbol: new Map([
          ["AAPL", bars],
          ["MSFT", bars],
          ["TSLA", bars],
        ]),
        skipped: [],
      } as never,
      entryGateOverlay: overlay,
    });

  assert.deepEqual(
    result.candidates.map((entry) => `${entry.side}:${entry.symbol}`),
    ["buy:AAPL", "sell:TSLA"],
  );
  assert.equal(result.skipped[0]?.reason, "entry_gate_confirmation_quorum");
  assert.equal(
    result.candidates[0]?.signalScoreDetails.entryGateConfirmationCount,
    3,
  );
});

test("watchlist backtest universe can exclude symbols while preserving inverse proxies", () => {
  const watchlists = [
    {
      id: "macro",
      name: "Macro",
      items: [{ symbol: "VIXY" }, { symbol: "GLD" }],
    },
  ];
  const universe =
    __shadowWatchlistBacktestInternalsForTests.collectWatchlistBacktestUniverse(
      watchlists as never,
      { excludedSymbols: ["VIXY"] },
    );
  const withProxy =
    __shadowWatchlistBacktestInternalsForTests.withWatchlistBacktestProxyUniverse(
      universe,
      { proxySymbols: ["SQQQ"] },
    );

  assert.deepEqual(
    universe.map((item) => item.symbol),
    ["GLD"],
  );
  assert.deepEqual(
    withProxy.map((item) => item.symbol),
    ["GLD", "SQQQ"],
  );
});

test("buildWatchlistBacktestFills sizes around existing baseline positions", () => {
  const sameSymbol = buildWatchlistBacktestFills({
    runId: "run-baseline-symbol",
    marketDate: "2026-05-01",
    startingTotals: {
      ...shadowTotals,
      cash: 25_000,
      marketValue: 5_000,
      netLiquidation: 30_000,
    },
    baseMarketValue: 5_000,
    baselineOpenPositionCount: 1,
    baselineOpenSymbols: ["AAPL"],
    candidates: [candidate({})] as never,
  });

  assert.equal(sameSymbol.fills.length, 0);
  assert.equal(sameSymbol.skipped[0]?.reason, "same_symbol_position_open");

  const fullBook = buildWatchlistBacktestFills({
    runId: "run-baseline-full",
    marketDate: "2026-05-01",
    startingTotals: {
      ...shadowTotals,
      cash: 25_000,
      marketValue: 5_000,
      netLiquidation: 30_000,
    },
    baseMarketValue: 5_000,
    baselineOpenPositionCount: 10,
    baselineOpenSymbols: ["SIVEF"],
    candidates: [candidate({ symbol: "MSFT" })] as never,
  });

  assert.equal(fullBook.fills.length, 0);
  assert.equal(fullBook.skipped[0]?.reason, "max_open_positions");
});

test("buildWatchlistBacktestFills honors cash-only sizing overlays", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-sizing",
    marketDate: "2026-05-01",
    startingTotals: shadowTotals,
    baseMarketValue: 0,
    sizingOverlay: {
      label: "P20x5",
      maxPositionFraction: 0.2,
      maxOpenPositions: 5,
      cashOnly: true,
    },
    candidates: [candidate({})] as never,
  });

  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0]?.quantity, 60);
});

test("buildWatchlistBacktestFills can rebalance into higher-ranked cash-only signals", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-ranked",
    marketDate: "2026-05-01",
    startingTotals: {
      ...shadowTotals,
      cash: 1_000,
      startingBalance: 1_000,
      netLiquidation: 1_000,
    },
    baseMarketValue: 0,
    sizingOverlay: {
      label: "P50x1",
      maxPositionFraction: 0.5,
      maxOpenPositions: 1,
      cashOnly: true,
    },
    selectionOverlay: {
      label: "RANK1",
      mode: "ranked_rebalance",
      minScoreEdge: 1,
    },
    candidates: [
      candidate({ signalScore: 1 }),
      candidate({
        symbol: "MSFT",
        signalScore: 5,
        placedAt: new Date("2026-05-01T15:00:00.000Z"),
        signalAt: new Date("2026-05-01T14:45:00.000Z"),
      }),
    ] as never,
  });

  assert.deepEqual(
    result.fills.map((fill) => `${fill.side}:${fill.symbol}`),
    ["buy:AAPL", "sell:AAPL", "buy:MSFT"],
  );
  assert.match(result.fills[1]?.fillSource ?? "", /^selection_rebalance:RANK1/);
});

test("buildWatchlistBacktestFills can stop out open longs before a Pyrus Signals sell", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-stop-1",
    marketDate: "2026-05-01",
    startingTotals: shadowTotals,
    baseMarketValue: 0,
    riskOverlay: {
      label: "SL5",
      stopLossPercent: 5,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
    barsBySymbol: new Map([
      [
        "AAPL",
        [
          {
            time: Math.floor(new Date("2026-05-01T14:45:00.000Z").getTime() / 1000),
            ts: "2026-05-01T14:45:00.000Z",
            o: 100,
            h: 101,
            l: 94,
            c: 95,
            v: 1_000,
          },
        ],
      ],
    ]),
    windowEnd: new Date("2026-05-01T15:00:00.000Z"),
    candidates: [candidate({})] as never,
  });

  assert.equal(result.fills.length, 2);
  assert.equal(result.fills[0]?.side, "buy");
  assert.equal(result.fills[1]?.side, "sell");
  assert.equal(result.fills[1]?.price, 95);
  assert.equal(result.fills[1]?.fillSource, "risk_stop_loss:SL5");
  assert.equal(result.fills[1]?.realizedPnl, -151);
});

test("buildWatchlistBacktestFills can tighten profitable sell signals into trailing exits", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-sell-tighten",
    marketDate: "2026-05-01",
    startingTotals: shadowTotals,
    baseMarketValue: 0,
    riskOverlay: {
      label: "TR15_SIG5",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: 5,
    },
    barsBySymbol: new Map([
      [
        "AAPL",
        [
          {
            time: Math.floor(new Date("2026-05-01T14:20:00.000Z").getTime() / 1000),
            ts: "2026-05-01T14:20:00.000Z",
            o: 103,
            h: 115,
            l: 102,
            c: 114,
            v: 1_000,
          },
          {
            time: Math.floor(new Date("2026-05-01T14:30:00.000Z").getTime() / 1000),
            ts: "2026-05-01T14:30:00.000Z",
            o: 112,
            h: 113,
            l: 106,
            c: 107,
            v: 1_000,
          },
        ],
      ],
    ]),
    windowEnd: new Date("2026-05-01T14:35:00.000Z"),
    candidates: [
      candidate({}),
      candidate({
        side: "sell",
        fillPrice: 112,
        placedAt: new Date("2026-05-01T14:25:00.000Z"),
        signalAt: new Date("2026-05-01T14:20:00.000Z"),
      }),
    ] as never,
  });

  assert.equal(result.fills.length, 2);
  assert.equal(result.fills[0]?.side, "buy");
  assert.equal(result.fills[1]?.side, "sell");
  assert.equal(result.fills[1]?.price, 109.25);
  assert.equal(result.fills[1]?.fillSource, "risk_trailing_stop:TR15_SIG5");
  assert.equal(result.fills[1]?.realizedPnl, 276.5);
});

test("buildWatchlistBacktestFills still exits losing sell signals immediately", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-sell-loss",
    marketDate: "2026-05-01",
    startingTotals: shadowTotals,
    baseMarketValue: 0,
    riskOverlay: {
      label: "TR15_SIG5",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: 5,
    },
    candidates: [
      candidate({}),
      candidate({
        side: "sell",
        fillPrice: 96,
        placedAt: new Date("2026-05-01T14:25:00.000Z"),
        signalAt: new Date("2026-05-01T14:20:00.000Z"),
      }),
    ] as never,
  });

  assert.equal(result.fills.length, 2);
  assert.equal(result.fills[1]?.price, 96);
  assert.equal(result.fills[1]?.fillSource, "next_bar_open");
  assert.equal(result.fills[1]?.realizedPnl, -121);
});

test("watchlist defensive regime can pause ordinary long entries", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-regime-pause",
    marketDate: "2026-05-01",
    startingTotals: shadowTotals,
    baseMarketValue: 0,
    regimeOverlay: {
      label: "VXX:5m:pause",
      proxySymbol: "VXX",
      signalTimeframe: "5m",
      action: "pause_new_longs",
      expiration: "fixed_12_5m_bars",
      fixedBars: 12,
      scaleDownFraction: 0.5,
    },
    regimeCandidates: [
      candidate({
        symbol: "VXX",
        fillPrice: 20,
        signalAt: new Date("2026-05-01T14:00:00.000Z"),
        placedAt: new Date("2026-05-01T14:05:00.000Z"),
      }),
    ] as never,
    candidates: [
      candidate({
        symbol: "AAPL",
        fillPrice: 100,
        signalAt: new Date("2026-05-01T14:10:00.000Z"),
        placedAt: new Date("2026-05-01T14:15:00.000Z"),
      }),
    ] as never,
  });

  assert.equal(result.fills.length, 0);
  assert.equal(result.skipped[0]?.reason, "defensive_regime");
});

test("watchlist defensive regime can exit longs and buy the proxy", () => {
  const result = buildWatchlistBacktestFills({
    runId: "run-regime-exit",
    marketDate: "2026-05-01",
    startingTotals: shadowTotals,
    baseMarketValue: 0,
    barsBySymbol: new Map([
      [
        "AAPL",
        [
          {
            time: Math.floor(new Date("2026-05-01T14:20:00.000Z").getTime() / 1000),
            ts: "2026-05-01T14:20:00.000Z",
            o: 101,
            h: 103,
            l: 100,
            c: 102,
            v: 1_000,
          },
        ],
      ],
    ]),
    regimeOverlay: {
      label: "VXX:5m:defense",
      proxySymbol: "VXX",
      signalTimeframe: "5m",
      action: "exit_longs_buy_proxy",
      expiration: "until_proxy_sell",
      fixedBars: 12,
      scaleDownFraction: 0.5,
    },
    candidates: [
      candidate({
        symbol: "AAPL",
        fillPrice: 100,
        signalAt: new Date("2026-05-01T14:00:00.000Z"),
        placedAt: new Date("2026-05-01T14:05:00.000Z"),
      }),
    ] as never,
    regimeCandidates: [
      candidate({
        symbol: "VXX",
        fillPrice: 20,
        signalAt: new Date("2026-05-01T14:25:00.000Z"),
        placedAt: new Date("2026-05-01T14:30:00.000Z"),
      }),
    ] as never,
  });

  assert.equal(result.fills.length, 3);
  assert.equal(result.fills[0]?.symbol, "AAPL");
  assert.equal(result.fills[0]?.side, "buy");
  assert.equal(result.fills[1]?.symbol, "AAPL");
  assert.equal(result.fills[1]?.side, "sell");
  assert.equal(result.fills[1]?.price, 102);
  assert.equal(result.fills[2]?.symbol, "VXX");
  assert.equal(result.fills[2]?.side, "buy");
  assert.equal(result.fills[2]?.fillSource, "regime_proxy_entry:VXX:5m:defense");
});

test("watchlist backtest window keeps legacy single-day behavior", () => {
  const window =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      marketDate: "2026-05-01",
      now: new Date("2026-05-01T18:00:00.000Z"),
    });

  assert.equal(window.marketDate, "2026-05-01");
  assert.equal(window.marketDateFrom, "2026-05-01");
  assert.equal(window.marketDateTo, "2026-05-01");
  assert.equal(window.rangeKey, "2026-05-01");
  assert.equal(window.start.toISOString(), "2026-05-01T13:30:00.000Z");
  assert.equal(window.end.toISOString(), "2026-05-01T18:00:00.000Z");
});

test("watchlist backtest past_week resolves to five weekdays ending at the resolved date", () => {
  const fridayWindow =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "past_week",
      marketDate: "2026-05-01",
      now: new Date("2026-05-02T12:00:00.000Z"),
    });

  assert.equal(fridayWindow.marketDateFrom, "2026-04-27");
  assert.equal(fridayWindow.marketDateTo, "2026-05-01");
  assert.equal(fridayWindow.rangeKey, "2026-04-27:2026-05-01");
  assert.equal(fridayWindow.start.toISOString(), "2026-04-27T13:30:00.000Z");
  assert.equal(fridayWindow.cleanupEnd.toISOString(), "2026-05-02T04:00:00.000Z");

  const weekendWindow =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "week",
      marketDateTo: "2026-05-02",
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

  assert.equal(weekendWindow.marketDateFrom, "2026-04-27");
  assert.equal(weekendWindow.marketDateTo, "2026-05-01");
  assert.equal(weekendWindow.rangeKey, "2026-04-27:2026-05-01");
});

test("watchlist backtest last_month resolves to the previous New York calendar month", () => {
  const window =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "last_month",
      now: new Date("2026-05-02T00:15:00.000Z"),
    });

  assert.equal(window.marketDateFrom, "2026-04-01");
  assert.equal(window.marketDateTo, "2026-04-30");
  assert.equal(window.rangeKey, "2026-04-01:2026-04-30");
  assert.equal(window.start.toISOString(), "2026-04-01T13:30:00.000Z");
  assert.equal(window.cleanupEnd.toISOString(), "2026-05-01T04:00:00.000Z");

  const januaryWindow =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "month",
      now: new Date("2026-01-15T18:00:00.000Z"),
    });

  assert.equal(januaryWindow.marketDateFrom, "2025-12-01");
  assert.equal(januaryWindow.marketDateTo, "2025-12-31");
});

test("watchlist backtest ytd resolves from the New York calendar year start", () => {
  const window =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "ytd",
      now: new Date("2026-05-02T00:15:00.000Z"),
    });

  assert.equal(window.marketDateFrom, "2026-01-01");
  assert.equal(window.marketDateTo, "2026-05-01");
  assert.equal(window.rangeKey, "2026-01-01:2026-05-01");
  assert.equal(window.start.toISOString(), "2026-01-01T14:30:00.000Z");
  assert.equal(window.cleanupEnd.toISOString(), "2026-05-02T04:00:00.000Z");

  const aliasWindow =
    __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
      range: "since_2026",
      now: new Date("2026-05-02T00:15:00.000Z"),
    });

  assert.equal(aliasWindow.marketDateFrom, "2026-01-01");
  assert.equal(aliasWindow.marketDateTo, "2026-05-01");
});

test("watchlist backtest regular-session filter uses New York market hours", () => {
  const isRegularSession =
    __shadowWatchlistBacktestInternalsForTests.isWatchlistBacktestRegularSessionTime;

  assert.equal(isRegularSession(new Date("2026-01-02T14:30:00.000Z")), true);
  assert.equal(isRegularSession(new Date("2026-01-02T20:59:00.000Z")), true);
  assert.equal(isRegularSession(new Date("2026-01-02T21:00:00.000Z")), false);
  assert.equal(
    isRegularSession(new Date("2026-01-02T21:00:00.000Z"), {
      allowClosePrint: true,
    }),
    true,
  );
  assert.equal(isRegularSession(new Date("2026-01-02T09:00:00.000Z")), false);
  assert.equal(isRegularSession(new Date("2026-01-03T15:00:00.000Z")), false);
});

test("watchlist backtest rejects inverted date ranges", () => {
  assert.throws(
    () =>
      __shadowWatchlistBacktestInternalsForTests.resolveWatchlistBacktestWindow({
        marketDateFrom: "2026-05-04",
        marketDateTo: "2026-05-01",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "shadow_backtest_date_range_invalid",
  );
});

test("watchlist backtest range cleanup matches range keys and date metadata", () => {
  const range = {
    marketDateFrom: "2026-04-27",
    marketDateTo: "2026-05-01",
    rangeKey: "2026-04-27:2026-05-01",
  };
  const matches =
    __shadowWatchlistBacktestInternalsForTests.watchlistBacktestOrderMatchesRange;

  assert.equal(
    matches({ metadata: { rangeKey: "2026-04-27:2026-05-01" } }, range),
    true,
  );
  assert.equal(
    matches({ metadata: { marketDate: "2026-04-29" } }, range),
    true,
  );
  assert.equal(
    matches({ metadata: { marketDate: "2026-05-04" } }, range),
    false,
  );
  assert.equal(matches({ metadata: { rangeKey: "2026-05-04" } }, range), false);
});

test("signal-options replay cleanup matches deployment and market date metadata", () => {
  const matches =
    __shadowWatchlistBacktestInternalsForTests.signalOptionsReplayOrderMatchesDate;

  assert.equal(
    matches(
      {
        replay: {
          source: "signal_options_replay",
          marketDate: "2026-05-12",
          deploymentId: "deployment-1",
        },
      },
      { marketDate: "2026-05-12", deploymentId: "deployment-1" },
    ),
    true,
  );
  assert.equal(
    matches(
      {
        replay: {
          source: "signal_options_replay",
          marketDate: "2026-05-12",
          deploymentId: "deployment-2",
        },
      },
      { marketDate: "2026-05-12", deploymentId: "deployment-1" },
    ),
    false,
  );
});

test("signal-options replay cleanup can match event and position dates across ranges", () => {
  const matches =
    __shadowWatchlistBacktestInternalsForTests.signalOptionsReplayOrderMatchesRange;
  const range = {
    marketDateFrom: "2026-05-12",
    marketDateTo: "2026-05-13",
    deploymentId: "deployment-1",
  };

  assert.equal(
    matches(
      {
        replay: {
          source: "signal_options_replay",
          marketDate: "2026-05-13",
          deploymentId: "deployment-1",
        },
        metadata: {
          positionMarketDate: "2026-05-12",
        },
      },
      range,
    ),
    true,
  );
  assert.equal(
    matches(
      {
        replay: {
          source: "signal_options_replay",
          marketDate: "2026-05-14",
          deploymentId: "deployment-1",
        },
        metadata: {
          positionMarketDate: "2026-05-14",
        },
      },
      range,
    ),
    false,
  );
});

test("signal-options replay cleanup catches legacy source-tagged rows without replay metadata", () => {
  const matches =
    __shadowWatchlistBacktestInternalsForTests.signalOptionsReplayOrderSourceMatchesRange;
  const range = {
    windowStart: new Date("2026-04-01T00:00:00.000Z"),
    cleanupEnd: new Date("2026-05-14T23:59:59.999Z"),
  };

  assert.equal(
    matches(
      {
        source: "signal_options_replay",
        placedAt: new Date("2026-04-08T14:00:00.000Z"),
      } as any,
      range,
    ),
    true,
  );
  assert.equal(
    matches(
      {
        source: "automation",
        placedAt: new Date("2026-04-08T14:00:00.000Z"),
      } as any,
      range,
    ),
    false,
  );
  assert.equal(
    matches(
      {
        source: "signal_options_replay",
        placedAt: new Date("2026-03-31T20:00:00.000Z"),
      } as any,
      range,
    ),
    false,
  );
});

test("watchlist backtest snapshot sources preserve single-day compatibility and range identity", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;

  assert.equal(
    internals.watchlistBacktestSnapshotSource("2026-05-01"),
    "watchlist_backtest:2026-05-01",
  );
  assert.equal(
    internals.watchlistBacktestSnapshotSource("2026-04-27:2026-05-01"),
    "watchlist_bt:20260427:20260501",
  );
  assert.deepEqual(
    internals.watchlistBacktestSnapshotSourcesForRange({
      marketDateFrom: "2026-04-30",
      marketDateTo: "2026-05-01",
      rangeKey: "2026-04-30:2026-05-01",
    }),
    [
      "watchlist_bt:20260430:20260501",
      "watchlist_backtest:2026-04-30",
      "watchlist_backtest:2026-05-01",
    ],
  );
});

test("shadow equity history ignores backtest snapshots for default ledger history", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const row = (source: string, asOf: string, createdAt = asOf) => ({
    source,
    asOf: new Date(asOf),
    createdAt: new Date(createdAt),
  });

  const selected = internals.selectShadowEquityHistoryRows([
    row("mark", "2026-05-01T14:00:00.000Z"),
    row("watchlist_bt:20260427:20260501", "2026-05-01T15:00:00.000Z"),
    row("watchlist_backtest_mark", "2026-05-01T15:30:00.000Z"),
    row(
      "watchlist_bt:20260101:20260501",
      "2026-05-01T16:00:00.000Z",
      "2026-05-03T01:31:15.000Z",
    ),
    row(
      "watchlist_bt:20260101:20260501",
      "2026-05-03T01:31:17.000Z",
      "2026-05-03T01:31:17.000Z",
    ),
    row("ledger", "2026-05-01T17:00:00.000Z"),
  ]);

  assert.equal(selected.scope, "ledger");
  assert.equal(selected.selectedSource, null);
  assert.equal(selected.includeInitialPoint, true);
  assert.equal(selected.includeLiveTerminal, true);
  assert.deepEqual(
    selected.rows.map((entry) => entry.source),
    ["mark", "ledger"],
  );
});

test("shadow equity history includes signal-options replay snapshots in default ledger history", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const row = (source: string, asOf: string, createdAt = asOf) => ({
    source,
    asOf: new Date(asOf),
    createdAt: new Date(createdAt),
  });

  const selected = internals.selectShadowEquityHistoryRows([
    row("initial", "2026-05-12T13:00:00.000Z"),
    row("signal_options_replay", "2026-05-12T14:30:00.000Z"),
    row("signal_options_replay_mark", "2026-05-12T14:31:00.000Z"),
    row("automation_mark", "2026-05-12T14:32:00.000Z"),
    row("watchlist_bt:20260512:20260512", "2026-05-12T14:33:00.000Z"),
    row("ledger", "2026-05-12T14:34:00.000Z"),
  ]);

  assert.equal(selected.scope, "ledger");
  assert.equal(selected.selectedSource, null);
  assert.equal(selected.includeInitialPoint, true);
  assert.equal(selected.includeLiveTerminal, true);
  assert.deepEqual(
    selected.rows.map((entry) => entry.source),
    [
      "initial",
      "signal_options_replay",
      "signal_options_replay_mark",
      "automation_mark",
      "ledger",
    ],
  );
});

test("shadow equity history can select signal-options replay snapshots", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const row = (source: string, asOf: string, createdAt = asOf) => ({
    source,
    asOf: new Date(asOf),
    createdAt: new Date(createdAt),
  });

  const selected = internals.selectShadowEquityHistoryRows(
    [
      row("initial", "2026-05-12T13:00:00.000Z"),
      row("signal_options_replay", "2026-05-01T13:45:00.000Z"),
      row("signal_options_replay_mark", "2026-05-01T13:46:00.000Z"),
      row("automation_mark", "2026-05-13T14:32:00.000Z"),
      row("ledger", "2026-05-13T14:34:00.000Z"),
    ],
    { source: "signal_options_replay" },
  );

  assert.equal(selected.scope, "signal_options_replay");
  assert.equal(selected.selectedSource, "signal_options_replay");
  assert.equal(selected.includeInitialPoint, true);
  assert.equal(selected.includeLiveTerminal, true);
  assert.deepEqual(
    selected.rows.map((entry) => entry.source),
    ["signal_options_replay", "signal_options_replay_mark"],
  );
});

test("shadow live source filters reject simulation and forward-test rows", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;

  assert.equal(internals.isSimulationShadowOrderSource("watchlist_backtest"), true);
  assert.equal(internals.isSimulationShadowOrderSource("signal_options_replay"), true);
  assert.equal(internals.isSimulationShadowOrderSource("automation"), false);
  assert.equal(internals.isLiveShadowOrder({ source: "automation" } as any), true);
  assert.equal(internals.isLiveShadowOrder({ source: "manual" } as any), true);
  assert.equal(internals.isLiveShadowOrder({ source: "watchlist_backtest" } as any), false);
  assert.equal(internals.isLiveShadowOrder({ source: "signal_options_replay" } as any), false);
  assert.equal(
    internals.isLiveShadowOrder({
      source: "automation",
      payload: { backfill: { source: "signal_options_backfill" } },
    } as any),
    true,
  );
  assert.equal(
    internals.isLiveShadowOrder({
      source: "automation",
      payload: {
        replay: { source: "signal_options_replay" },
        metadata: {
          positionKey: "signal_options_replay:2026-05-12:deployment:candidate",
        },
      },
    } as any),
    false,
  );
  assert.equal(
    internals.shadowOrderEffectiveSource({
      source: "automation",
      payload: {
        replay: { source: "signal_options_replay" },
        metadata: {
          positionKey: "signal_options_replay:2026-05-12:deployment:candidate",
        },
      },
    } as any),
    "signal_options_replay",
  );
  assert.equal(
    internals.isLiveShadowOrder({
      source: "automation",
      payload: { forwardTest: true },
    } as any),
    false,
  );
  assert.equal(
    internals.isLiveShadowOrder({
      source: "automation",
      clientOrderId: "shadow-equity-forward-buy-event-1",
      payload: {},
    } as any),
    false,
  );
  assert.equal(
    internals.isLiveShadowPosition({
      positionKey: "option:NVDA:2026-05-15:222.5:call:twsopt:contract",
    } as any),
    true,
  );
  assert.equal(
    internals.isLiveShadowPosition({
      positionKey: "signal_options_replay:2026-05-12:deployment:candidate",
    } as any),
    false,
  );
  assert.equal(
    internals.isLiveShadowPosition({
      positionKey: "shadow_equity_forward:deployment:equity:AAPL",
    } as any),
    false,
  );
  assert.equal(
    internals.isLiveShadowPosition({
      positionKey: "watchlist_backtest:2026-05-12:SPY",
    } as any),
    false,
  );
});

test("default shadow analytics ledger includes signal-options replay rows", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;

  assert.equal(
    internals.isDefaultShadowLedgerAnalyticsOrder({ source: "automation" } as any),
    true,
  );
  assert.equal(
    internals.isDefaultShadowLedgerAnalyticsOrder({ source: "manual" } as any),
    true,
  );
  assert.equal(
    internals.isDefaultShadowLedgerAnalyticsOrder({ source: "signal_options_replay" } as any),
    true,
  );
  assert.equal(
    internals.isDefaultShadowLedgerAnalyticsOrder({
      source: "automation",
      payload: {
        replay: { source: "signal_options_replay" },
        metadata: {
          positionKey: "signal_options_replay:2026-05-12:deployment:candidate",
        },
      },
    } as any),
    true,
  );
  assert.equal(
    internals.isDefaultShadowLedgerAnalyticsOrder({
      source: "automation",
      payload: { backfill: { source: "signal_options_backfill" } },
    } as any),
    true,
  );
  assert.equal(
    internals.isDefaultShadowLedgerAnalyticsOrder({ source: "watchlist_backtest" } as any),
    false,
  );
  assert.equal(
    internals.isDefaultShadowLedgerAnalyticsOrder({
      source: "automation",
      payload: { forwardTest: true },
    } as any),
    false,
  );
  assert.equal(
    internals.isDefaultShadowLedgerAnalyticsPosition({
      positionKey: "signal_options_replay:2026-05-12:deployment:candidate",
    } as any),
    true,
  );
  assert.equal(
    internals.isDefaultShadowLedgerAnalyticsPosition({
      positionKey: "watchlist_backtest:2026-05-12:SPY",
    } as any),
    false,
  );
});

test("shadow source totals can recover replay position keys from legacy order payloads", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const legacyReplayKey =
    "82b21145-3cbf-4350-af4d-b4f5a8e19885:SIGOPT-82b21145-QCOM-buy-1777988700000";
  const optionContract = {
    underlying: "QCOM",
    expirationDate: "2026-05-08",
    strike: 165,
    right: "call",
    ticker: "O:QCOM260508C00165000",
    providerContractId: "O:QCOM260508C00165000",
  };

  assert.equal(
    internals.shadowPositionKeyForOrder({
      symbol: "QCOM",
      assetClass: "option",
      optionContract,
      payload: {
        metadata: {
          sourceType: "signal_options_replay",
          positionKey: legacyReplayKey,
        },
      },
    } as any),
    legacyReplayKey,
  );
  assert.equal(
    internals.shadowPositionKeyForOrder({
      symbol: "QCOM",
      assetClass: "option",
      optionContract,
      payload: {},
    } as any),
    "option:QCOM:2026-05-08:165:call:O:QCOM260508C00165000",
  );
  assert.deepEqual(
    Array.from(
      internals.shadowPositionKeysForOrders([
        {
          symbol: "QCOM",
          assetClass: "option",
          optionContract,
          payload: { metadata: { positionKey: legacyReplayKey } },
        },
      ] as any),
    ),
    [legacyReplayKey],
  );
});

test("shadow default day-change quotes are requested only for rows needing fallback", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const dayChangeBody = source.match(
    /async function readShadowPositionDayChanges\([\s\S]*?\nfunction metric\(/,
  )?.[0];
  const fetchQuotesBody = source.match(
    /async function fetchShadowOptionDayChangeQuotes\([\s\S]*?\nasync function waitForShadowOptionDayChangeQuotes/,
  )?.[0];

  assert.ok(dayChangeBody);
  assert.match(dayChangeBody, /quoteCandidatePositions/);
  assert.match(dayChangeBody, /missingQuotePositions/);
  assert.match(dayChangeBody, /shadowPositionNeedsDayChangeQuote/);
  assert.match(
    dayChangeBody,
    /fetchShadowOptionDayChangeQuotes\(missingQuotePositions\)/,
  );
  assert.ok(fetchQuotesBody);
  assert.match(fetchQuotesBody, /shadowOptionQuoteIdentifier\(contract\)/);
  assert.match(fetchQuotesBody, /isPriorOptionExpiration\(contract\)/);
  assert.match(fetchQuotesBody, /shadowOptionProviderContractIdForContract\(contract\)/);
  assert.match(fetchQuotesBody, /resolveShadowIbkrOptionProviderIds/);
  assert.match(fetchQuotesBody, /declareIbkrLiveDemand/);
  assert.match(fetchQuotesBody, /readIbkrLiveDemandState/);
  assert.doesNotMatch(fetchQuotesBody, /fetchOptionQuoteSnapshotPayload/);
  assert.doesNotMatch(fetchQuotesBody, /MassiveMarketDataClient/);
  assert.doesNotMatch(fetchQuotesBody, /massive_option_quote/);
  assert.match(fetchQuotesBody, /Promise\.allSettled/);
  assert.match(fetchQuotesBody, /SHADOW_DAY_CHANGE_QUOTE_TASK_MAX_WAIT_MS/);
});

test("shadow positions include hydrated option quote payloads", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const positionsBody = source.match(
    /export async function getShadowAccountPositions\([\s\S]*?\nexport async function getShadowAccountPositionsAtDate/,
  )?.[0];

  assert.ok(positionsBody);
  assert.match(positionsBody, /optionQuoteByProviderContractId/);
  assert.match(positionsBody, /fetchShadowOptionDayChangeQuotes\(filtered,\s*\{/);
  assert.match(positionsBody, /intent: "visible-live"/);
  assert.match(positionsBody, /ownerPrefix: "shadow-position-visible"/);
  assert.match(positionsBody, /SHADOW_VISIBLE_OPTION_QUOTE_MAX_WAIT_MS/);
  assert.match(positionsBody, /SHADOW_VISIBLE_OPTION_QUOTE_TASK_MAX_WAIT_MS/);
  assert.match(positionsBody, /waitForShadowOptionDayChangeQuotes/);
  assert.match(source, /const SHADOW_VISIBLE_OPTION_QUOTE_MAX_WAIT_MS = 750;/);
  assert.match(source, /const SHADOW_UNDERLYING_QUOTE_MAX_WAIT_MS = 750;/);
  assert.match(positionsBody, /\{ fetchMissingOptionQuotes: false \}/);
  assert.match(positionsBody, /Promise\.all/);
  assert.match(positionsBody, /fetchShadowOptionUnderlyingMarkets\(filtered\)/);
  assert.match(source, /getBoundedShadowUnderlyingQuoteSnapshots/);
  assert.match(source, /SHADOW_UNDERLYING_QUOTE_MAX_WAIT_MS/);
  assert.match(positionsBody, /ordersByPositionKey/);
  assert.match(positionsBody, /shadowOptionQuoteProviderContractId/);
  assert.match(positionsBody, /fallbackProviderContractId/);
  assert.match(positionsBody, /shadowOptionProviderContractIdForContract\(contract\)/);
  assert.match(positionsBody, /responseProviderContractId/);
  assert.match(positionsBody, /shadowOrderOptionQuoteFallback/);
  assert.match(positionsBody, /automationEventOptionQuote/);
  assert.match(positionsBody, /automation_event_quote/);
  assert.match(positionsBody, /shadowQuoteSnapshotFromOptionRecord/);
  assert.match(positionsBody, /shadowOptionQuotePayload/);
  assert.match(positionsBody, /underlyingMarket/);
  assert.match(positionsBody, /shadowUnderlyingMarketPayload/);
  assert.match(positionsBody, /optionPayload\(\s*asOptionContract\(position\.optionContract\),\s*responseProviderContractId,/);
  assert.doesNotMatch(positionsBody, /massive_option_quote/);
});

test("shadow automation event quotes preserve bid ask without repricing marks", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const fallbackBody = source.match(
    /function shadowOrderOptionQuoteFallback\([\s\S]*?\nfunction isExpiredHistoricalShadowOptionPosition/,
  )?.[0];
  const payloadBody = source.match(
    /function shadowOptionQuotePayload\([\s\S]*?\nasync function resolveFillPrice/,
  )?.[0];

  assert.ok(fallbackBody);
  assert.match(fallbackBody, /payload\.quote/);
  assert.match(fallbackBody, /candidate\.quote/);
  assert.match(fallbackBody, /orderPlan\.liquidity/);
  assert.match(fallbackBody, /shadowQuoteHasBidAsk/);
  assert.match(fallbackBody, /mark: fallbackMark/);
  assert.match(fallbackBody, /price: fallbackMark/);
  assert.ok(payloadBody);
  assert.match(payloadBody, /input\.source === "automation_event_quote"/);
  assert.match(payloadBody, /input\.fallbackMark/);
});

test("shadow risk reuses projected underlying markets before quote fallback", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const riskBody = source.match(
    /async function buildShadowAccountRisk\([\s\S]*?\nfunction shadowPositionForNotionalRisk/,
  )?.[0];

  assert.ok(riskBody);
  assert.match(riskBody, /shadowUnderlyingPricesFromPositionRows\(positionsResponse\.positions\)/);
  assert.match(riskBody, /missingUnderlyingPrice/);
  assert.match(riskBody, /hydrateShadowOptionUnderlyingPrices/);
  assert.match(source, /withShadowReadCache\(`risk:\$\{shadowSourceCacheKey\(source\)\}`/);
});

test("shadow risk exposes python greek scenario coverage", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const riskBody = source.match(
    /async function buildShadowAccountRisk\([\s\S]*?\nfunction shadowPositionForNotionalRisk/,
  )?.[0];
  const greekBody = source.match(
    /function shadowGreekSnapshotsFromPositionRows\([\s\S]*?\nfunction shadowPositionForNotionalRisk/,
  )?.[0];

  assert.ok(riskBody);
  assert.match(riskBody, /shadowGreekSnapshotsFromPositionRows\(/);
  assert.match(riskBody, /readCachedShadowOptionGreekQuotes/);
  assert.match(riskBody, /mergeShadowGreekQuoteMaps/);
  assert.match(riskBody, /requiresGreeks: true/);
  assert.match(riskBody, /ownerPrefix: "shadow-risk-greek"/);
  assert.match(riskBody, /SHADOW_GREEK_QUOTE_TASK_MAX_WAIT_MS/);
  assert.match(riskBody, /resolveAccountGreekScenarios\(\{/);
  assert.match(riskBody, /greekScenarios,/);
  assert.ok(greekBody);
  assert.match(greekBody, /greekQuoteByProviderContractId/);
  assert.match(greekBody, /readOptionalShadowGreekNumber\(quote\?\.delta\)/);
  assert.match(greekBody, /value === null \|\| value === undefined/);
  assert.match(greekBody, /source: "SHADOW_OPTION_QUOTE"/);
  assert.match(source, /const shadowOptionGreekQuoteCache = new Map/);
  assert.match(source, /function rememberShadowOptionGreekQuote/);
  assert.match(source, /function estimateShadowOptionGreeks/);
});

test("shadow option greek estimates fill missing quote greeks", () => {
  const estimate =
    __shadowWatchlistBacktestInternalsForTests.estimateShadowOptionGreeks(
      {
        id: "position-1",
        accountId: "shadow",
        symbol: "MSFT",
        assetClass: "option",
        quantity: 1,
        averagePrice: 5,
        marketPrice: 10.55,
        marketValue: 1055,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        optionContract: {
          ticker: "MSFT20260601C440",
          underlying: "MSFT",
          expirationDate: new Date("2026-06-01T00:00:00.000Z"),
          strike: 440,
          right: "call",
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: "1001",
        },
      } as any,
      new Map([["MSFT", 449.99]]),
      new Date("2026-05-30T18:00:00.000Z"),
    );

  assert.ok(estimate);
  assert.ok(estimate.delta > 0.4 && estimate.delta < 1);
  assert.ok(estimate.gamma > 0);
  assert.ok(estimate.theta < 0);
  assert.ok(estimate.vega > 0);
});

test("shadow equity quote hydration opts out of Massive fallback", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const equityMarkBody = source.match(
    /async function resolveEquityMark\([\s\S]*?\nasync function resolveOptionMark/,
  )?.[0];
  const underlyingBody = source.match(
    /async function hydrateShadowOptionUnderlyingPrices\([\s\S]*?\nfunction buildShadowExpiryConcentration/,
  )?.[0];
  const boundedUnderlyingBody = source.match(
    /async function getBoundedShadowUnderlyingQuoteSnapshots\([\s\S]*?\nasync function fetchShadowOptionUnderlyingMarkets/,
  )?.[0];

  assert.ok(equityMarkBody);
  assert.ok(underlyingBody);
  assert.ok(boundedUnderlyingBody);
  assert.match(equityMarkBody, /allowMassiveFallback: false/);
  assert.match(equityMarkBody, /admissionOwner: `shadow-equity-mark:\$\{normalized\}`/);
  assert.match(equityMarkBody, /admissionFallbackProvider: "cache"/);
  assert.match(boundedUnderlyingBody, /allowMassiveFallback: false/);
  assert.match(boundedUnderlyingBody, /admissionOwner: `shadow-underlying-mark:\$\{symbols\}`/);
  assert.match(boundedUnderlyingBody, /admissionFallbackProvider: "cache"/);
  assert.match(underlyingBody, /getBoundedShadowUnderlyingQuoteSnapshots/);
});

test("shadow equity history drops snapshots that do not reconcile to live fills", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const account = { startingBalance: "30000" };
  const row = (
    source: string,
    asOf: string,
    cash: number,
    realizedPnl: number,
    fees: number,
  ) => ({
    source,
    asOf: new Date(asOf),
    createdAt: new Date(asOf),
    cash: String(cash),
    realizedPnl: String(realizedPnl),
    fees: String(fees),
  });
  const liveFill = {
    cashDelta: "-351.67",
    realizedPnl: "0",
    fees: "0.67",
    occurredAt: new Date("2026-05-13T13:35:48.637Z"),
  };

  const filtered = internals.filterShadowEquityHistoryRowsToLiveLedger(
    [
      row("initial", "2026-05-12T21:41:18.171Z", 30000, 0, 0),
      row("mark", "2026-05-13T15:22:22.895Z", 34821.25, 6422.14, 53.75),
      row("automation_mark", "2026-05-13T15:22:22.927Z", 29648.33, 0, 0.67),
    ] as any,
    {
      account: account as any,
      fills: [liveFill] as any,
    },
  );

  assert.deepEqual(
    filtered.map((entry) => entry.source),
    ["initial", "automation_mark"],
  );
});

test("default shadow equity history excludes legacy replay projection rows", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const account = { startingBalance: "30000" };
  const row = (
    source: string,
    asOf: string,
    cash: number,
    realizedPnl: number,
    fees: number,
    netLiquidation: number,
  ) => ({
    source,
    asOf: new Date(asOf),
    createdAt: new Date(asOf),
    cash: String(cash),
    realizedPnl: String(realizedPnl),
    fees: String(fees),
    netLiquidation: String(netLiquidation),
  });
  const liveFill = {
    cashDelta: "100",
    realizedPnl: "20",
    fees: "1",
    occurredAt: new Date("2026-05-18T14:01:30.000Z"),
  };

  const projected = internals.buildDefaultShadowEquityHistoryRows(
    [
      row("signal_options_replay_mark", "2026-05-18T14:00:00.000Z", 29900, 0, 1, 30100),
      row("signal_options_replay_mark", "2026-05-18T14:01:00.000Z", 29900, 0, 1, 30200),
      row("automation_mark", "2026-05-18T14:02:00.000Z", 30100, 20, 1, 30050),
    ] as any,
    {
      account: account as any,
      fills: [liveFill] as any,
      terminalTotals: { netLiquidation: 29900 },
    },
  );

  assert.deepEqual(
    projected.map((entry) => entry.source),
    ["automation_mark"],
  );
  assert.deepEqual(
    projected.map((entry) => Number(entry.netLiquidation)),
    [30050],
  );
});

test("default shadow equity history includes replay snapshot rows", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const account = { startingBalance: "30000" };
  const row = (
    source: string,
    asOf: string,
    netLiquidation: number,
    cash = 30000,
  ) => ({
    source,
    asOf: new Date(asOf),
    createdAt: new Date(asOf),
    cash: String(cash),
    realizedPnl: "0",
    fees: "0",
    netLiquidation: String(netLiquidation),
  });

  const projected = internals.buildDefaultShadowEquityHistoryRows(
    [
      row("automation_mark", "2026-05-18T13:59:00.000Z", 29950, 29950),
      row("signal_options_replay", "2026-05-18T14:00:00.000Z", 30100, 29600),
      row("signal_options_replay", "2026-05-18T14:01:00.000Z", 30200, 29500),
      row("automation_mark", "2026-05-18T14:02:00.000Z", 30075),
    ] as any,
    {
      account: account as any,
      fills: [],
      terminalTotals: { netLiquidation: 30075 },
    },
  );

  assert.deepEqual(
    projected.map((entry) => Number(entry.netLiquidation)),
    [30100, 30200, 30075],
  );
});

test("shadow equity history keeps the latest snapshot for duplicate timestamps", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const row = (
    source: string,
    asOf: string,
    createdAt: string,
    netLiquidation: number,
  ) => ({
    source,
    asOf: new Date(asOf),
    createdAt: new Date(createdAt),
    netLiquidation,
  });

  const compacted = internals.compactShadowEquityHistoryRows([
    row(
      "signal_options_replay_mark",
      "2026-05-12T19:59:00.000Z",
      "2026-05-12T19:59:01.000Z",
      30568.28,
    ),
    row(
      "signal_options_replay_mark",
      "2026-05-12T19:59:00.000Z",
      "2026-05-12T19:59:02.000Z",
      30493.28,
    ),
  ]);

  assert.equal(compacted.length, 1);
  assert.equal(compacted[0]?.netLiquidation, 30493.28);
});

test("shadow equity history keeps short ALL-range histories detailed", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const rows = [
    { asOf: new Date("2026-05-01T13:30:00.000Z") },
    { asOf: new Date("2026-05-13T20:00:00.000Z") },
  ];

  assert.equal(
    internals.shadowEquityHistoryBucketSizeMs("ALL", rows as any),
    5 * 60_000,
  );
});

test("shadow equity history keeps April-to-current YTD histories at 5 minute detail", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const rows = [
    { asOf: new Date("2026-04-01T13:30:00.000Z") },
    { asOf: new Date("2026-05-20T20:00:00.000Z") },
  ];

  assert.equal(
    internals.shadowEquityHistoryBucketSizeMs("YTD", rows as any),
    5 * 60_000,
  );
});

test("shadow equity history bucket compaction preserves first daily snapshots", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const row = (asOf: string, netLiquidation: number) => ({
    asOf: new Date(asOf),
    netLiquidation,
  });

  const compacted = internals.bucketShadowEquityHistoryRows(
    [
      row("2026-05-11T13:30:00.000Z", 30_000),
      row("2026-05-11T13:59:00.000Z", 30_400),
      row("2026-05-11T20:00:00.000Z", 30_600),
      row("2026-05-12T13:30:00.000Z", 30_700),
      row("2026-05-12T13:59:00.000Z", 31_000),
    ],
    2 * 60 * 60_000,
  );

  assert.deepEqual(
    compacted.map((entry) => entry.netLiquidation),
    [30_000, 30_400, 30_600, 30_700, 31_000],
  );
});

test("shadow equity history puts historical baselines before first replay fill", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /new Date\(firstHistoryAt\.getTime\(\) - 1\)/,
  );
});

test("shadow equity history uses ledger rows when no run snapshots exist", () => {
  const internals = __shadowWatchlistBacktestInternalsForTests;
  const row = (source: string, asOf: string) => ({
    source,
    asOf: new Date(asOf),
    createdAt: new Date(asOf),
  });

  const selected = internals.selectShadowEquityHistoryRows([
    row("initial", "2026-04-29T19:31:14.000Z"),
    row("mark", "2026-05-01T14:00:00.000Z"),
    row("watchlist_backtest_mark", "2026-05-01T15:30:00.000Z"),
    row("ledger", "2026-05-01T17:00:00.000Z"),
  ]);

  assert.equal(selected.scope, "ledger");
  assert.equal(selected.selectedSource, null);
  assert.equal(selected.includeInitialPoint, true);
  assert.equal(selected.includeLiveTerminal, true);
  assert.deepEqual(
    selected.rows.map((entry) => entry.source),
    ["initial", "mark", "ledger"],
  );
});
