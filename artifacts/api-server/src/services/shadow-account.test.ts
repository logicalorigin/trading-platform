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
} from "./shadow-account";

test("shadow account snapshot stream uses the visible-page cadence", () => {
  assert.equal(SHADOW_ACCOUNT_STREAM_INTERVAL_MS, 2_000);
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
  assert.match(
    source,
    /if \(shadowAccountSnapshotBaseInFlight === request\) \{\s*shadowAccountSnapshotBaseInFlight = null;/,
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

test("shadow option maintenance skips historical signal-options rows", () => {
  const helper =
    __shadowWatchlistBacktestInternalsForTests.isHistoricalSignalOptionsShadowOrder;

  assert.equal(
    helper({ payload: { backfill: { source: "signal_options_backfill" } } } as never),
    true,
  );
  assert.equal(
    helper({
      payload: {
        backfill: { source: "signal_options_replay" },
        metadata: { sourceType: "signal_options_replay" },
      },
    } as never),
    true,
  );
  assert.equal(helper({ payload: { metadata: { runSource: "worker" } } } as never), false);
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

test("polygon option day quotes use session previous close for day change", () => {
  const quoteHelper =
    __shadowWatchlistBacktestInternalsForTests.polygonOptionContractDayChangeQuote;
  const changeHelper =
    __shadowWatchlistBacktestInternalsForTests.buildShadowPositionDayChangeFromQuote;

  const quote = quoteHelper({
    contract: {
      ticker: "O:NVDA260522C00220000",
      underlying: "NVDA",
      expirationDate: new Date("2026-05-22T00:00:00.000Z"),
      strike: 220,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: null,
    },
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
  });
  const changed = changeHelper({
    quantity: 1,
    multiplier: 100,
    quote,
  });

  assert.equal(Number(changed.dayChange?.toFixed(6)), -119);
  assert.equal(Number(changed.dayChangePercent?.toFixed(6)), -14.251497);
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
  assert.match(source, /sourcePositionKeys\.has\(position\.positionKey\)/);
  assert.match(source, /positionMatchesShadowSource\(position, source\)/);
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

test("buildWatchlistBacktestFills can stop out open longs before a RayReplica sell", () => {
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
  assert.match(dayChangeBody, /shadowPositionNeedsDayChangeQuote/);
  assert.match(
    dayChangeBody,
    /fetchShadowOptionDayChangeQuotes\(quoteCandidatePositions\)/,
  );
  assert.ok(fetchQuotesBody);
  assert.match(fetchQuotesBody, /Promise\.allSettled/);
  assert.match(fetchQuotesBody, /SHADOW_DAY_CHANGE_QUOTE_TASK_MAX_WAIT_MS/);
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
