import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyAccountPageLivePayloadToCache,
  applyAccountPagePayloadToCache,
  applyIbkrAccountPayloadToCache,
  applyShadowAccountPayloadToCache,
  flushAccountPagePayloadQueue,
  getAccountPositionRowSnapshot,
  getAccountPageStreamUrl,
  getShadowAccountStreamUrl,
  getOptionChainContractExpirationKey,
  groupOptionChainContractsByExpiration,
  invalidateVisibleAccountDerivedQueries,
  isQuoteSnapshotAtLeastAsFresh,
  mergeOptionChainContracts,
  mergeQuotesIntoCache,
  patchOptionQuotesIntoContracts,
  queueAccountPagePayloadToCache,
} from "./live-streams";

const optionQuote = (
  providerContractId: string,
  expirationDate: string,
  strike = 700,
) => ({
  contract: {
    ticker: providerContractId,
    underlying: "SPY",
    expirationDate,
    strike,
    right: "call" as const,
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId,
  },
  bid: 1,
  ask: 1.1,
  last: 1.05,
  mark: 1.075,
  impliedVolatility: 0.2,
  delta: 0.5,
  gamma: 0.01,
  theta: -0.03,
  vega: 0.08,
  openInterest: 100,
  volume: 25,
  updatedAt: "2026-04-25T00:00:00.000Z",
});

test("getOptionChainContractExpirationKey normalizes API datetime strings", () => {
  assert.equal(
    getOptionChainContractExpirationKey(
      optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z"),
    ),
    "2026-04-27",
  );
});

test("shadow account stream URL does not require query params", () => {
  assert.equal(getShadowAccountStreamUrl(), "/api/streams/accounts/shadow");
});

test("account page stream URL carries visible account page inputs", () => {
  assert.equal(
    getAccountPageStreamUrl({
      accountId: "combined",
      mode: "paper",
      range: "1D",
      orderTab: "working",
      assetClass: "Options",
      tradeFilters: {
        symbol: "SPY",
        assetClass: "Options",
        from: "2026-05-01T00:00:00.000Z",
      },
      performanceCalendarFrom: "2025-04-01T00:00:00.000Z",
    }),
    "/api/streams/accounts/page?accountId=combined&mode=paper&range=1D&orderTab=working&assetClass=Options&from=2026-05-01T00%3A00%3A00.000Z&symbol=SPY&tradeAssetClass=Options&performanceCalendarFrom=2025-04-01T00%3A00%3A00.000Z",
  );
});

test("account page stream is owned by the visible account screen", () => {
  const platformAppSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const accountScreenSource = readFileSync(
    new URL("../../screens/AccountScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(accountScreenSource, /useAccountPageSnapshotStream/);
  assert.doesNotMatch(platformAppSource, /useShadowAccountSnapshotStream/);
  assert.doesNotMatch(accountScreenSource, /useShadowAccountSnapshotStream/);
  assert.match(
    accountScreenSource,
    /enabled:\s*accountPageStreamEnabled/,
  );
  assert.match(accountScreenSource, /isVisible && accountQueriesEnabled/);
  assert.match(accountScreenSource, /accountPageStreamFresh:\s*accountPageStreamFreshness\.accountFresh/);
});

test("broker account and order streams refresh freshness on readiness and poll success", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(source, /source\.addEventListener\("ready", handleReady as EventListener\)/);
  assert.match(
    source,
    /source\.addEventListener\("freshness", handleFreshness as EventListener\)/,
  );
  assert.match(source, /markBrokerStreamEvent\("account"\)/);
  assert.match(source, /markBrokerStreamEvent\("order"\)/);
});

test("shadow account stream refreshes freshness on readiness and poll success", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(source, /markShadowAccountStreamEvent\(\)/);
  assert.match(source, /payload\.stream !== "shadow-accounts"/);
  assert.match(source, /source\.addEventListener\("ready", handleReady as EventListener\)/);
  assert.match(
    source,
    /source\.addEventListener\("freshness", handleFreshness as EventListener\)/,
  );
});

test("account page stream refreshes freshness on page snapshots", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(source, /source\.addEventListener\("bootstrap", handleBootstrap as EventListener\)/);
  assert.match(source, /source\.addEventListener\("live", handleLive as EventListener\)/);
  assert.match(source, /source\.addEventListener\("derived", handleDerived as EventListener\)/);
  assert.match(source, /queueAccountPagePayloadToCache\(queryClient, "bootstrap", payload\)/);
  assert.match(source, /queueAccountPagePayloadToCache\(queryClient, "live", payload\)/);
  assert.match(source, /queueAccountPagePayloadToCache\(queryClient, "derived", payload\)/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /payload\.stream !== "account-page-bootstrap"/);
  assert.match(source, /payload\.stream !== "account-page-live"/);
  assert.match(source, /payload\.stream !== "account-page-derived"/);
  assert.match(source, /export const useAccountPositionRow/);
  assert.match(source, /export const useAccountSummaryField/);
  assert.match(source, /export const useBrokerFreshnessFor/);
});

test("platform root subscribes only to coarse broker stream freshness", () => {
  const platformAppSource = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const liveStreamsSource = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(platformAppSource, /useBrokerStreamFreshnessStatus/);
  assert.doesNotMatch(platformAppSource, /useBrokerStreamFreshnessSnapshot/);
  assert.match(liveStreamsSource, /getBrokerStreamFreshnessStatusToken/);
});

test("groupOptionChainContractsByExpiration keeps stream contracts scoped to their expirations", () => {
  const grouped = groupOptionChainContractsByExpiration([
    optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z"),
    optionQuote("SPY-20260427-P700", "2026-04-27T00:00:00.000Z"),
    optionQuote("SPY-20260501-C700", "2026-05-01T00:00:00.000Z"),
  ]);

  assert.deepEqual([...grouped.keys()], ["2026-04-27", "2026-05-01"]);
  assert.deepEqual(
    grouped.get("2026-04-27")?.map((quote) => quote.contract.providerContractId),
    ["SPY-20260427-C700", "SPY-20260427-P700"],
  );
  assert.deepEqual(
    grouped.get("2026-05-01")?.map((quote) => quote.contract.providerContractId),
    ["SPY-20260501-C700"],
  );
});

test("mergeOptionChainContracts preserves full metadata rows when a narrow update arrives", () => {
  const current = [
    optionQuote("SPY-20260427-C695", "2026-04-27T00:00:00.000Z", 695),
    optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z", 700),
    optionQuote("SPY-20260427-C705", "2026-04-27T00:00:00.000Z", 705),
  ];
  const narrow = [
    {
      ...optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z", 700),
      bid: 1.5,
      updatedAt: "2026-04-25T00:00:01.000Z",
    },
  ];

  const merged = mergeOptionChainContracts(current, narrow);

  assert.deepEqual(
    merged.map((quote) => quote.contract.providerContractId),
    ["SPY-20260427-C695", "SPY-20260427-C700", "SPY-20260427-C705"],
  );
  assert.equal(
    merged.find(
      (quote) => quote.contract.providerContractId === "SPY-20260427-C700",
    )?.bid,
    1.5,
  );
});

test("mergeOptionChainContracts keeps expiration sorting deterministic with malformed dates", () => {
  const merged = mergeOptionChainContracts(undefined, [
    optionQuote("SPY-invalid-C700", "not-a-date", 700),
    optionQuote("SPY-20260501-C700", "2026-05-01", 700),
    optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z", 700),
  ]);

  assert.deepEqual(
    merged.map((quote) => quote.contract.providerContractId),
    ["SPY-20260427-C700", "SPY-20260501-C700", "SPY-invalid-C700"],
  );
});

test("patchOptionQuotesIntoContracts marks metadata contracts as hydrated when live quotes arrive", () => {
  const metadataContract = {
    ...optionQuote("SPY-20260427-C700", "2026-04-27T00:00:00.000Z", 700),
    bid: null,
    ask: null,
    last: null,
    mark: null,
    volume: null,
    openInterest: null,
    quoteFreshness: "metadata" as const,
    marketDataMode: null,
    quoteUpdatedAt: null,
    dataUpdatedAt: null,
  };
  const patched = patchOptionQuotesIntoContracts([metadataContract], [
    {
      symbol: "SPY",
      price: 1.18,
      bid: 1.15,
      ask: 1.2,
      bidSize: 10,
      askSize: 12,
      change: 0.05,
      changePercent: 4.4,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: 80,
      openInterest: 250,
      impliedVolatility: 0.24,
      delta: 0.52,
      gamma: 0.02,
      theta: -0.04,
      vega: 0.09,
      providerContractId: "SPY-20260427-C700",
      source: "ibkr",
      transport: "tws",
      delayed: false,
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: "2026-04-28T14:30:00.000Z",
      ageMs: 12,
      cacheAgeMs: 12,
      latency: null,
      updatedAt: "2026-04-28T14:30:00.000Z",
    },
  ]);

  assert.equal(patched[0]?.bid, 1.15);
  assert.equal(patched[0]?.ask, 1.2);
  assert.equal(patched[0]?.last, 1.18);
  assert.equal(patched[0]?.mark, 1.1749999999999998);
  assert.equal(patched[0]?.volume, 80);
  assert.equal(patched[0]?.openInterest, 250);
  assert.equal(patched[0]?.quoteFreshness, "live");
  assert.equal(patched[0]?.marketDataMode, "live");
  assert.equal(patched[0]?.quoteUpdatedAt, "2026-04-28T14:30:00.000Z");
  assert.equal(patched[0]?.dataUpdatedAt, "2026-04-28T14:30:00.000Z");
  assert.equal(patched[0]?.ageMs, 12);
});

const stockQuote = (symbol: string, price: number, updatedAt: string) => ({
  symbol,
  price,
  bid: price - 0.01,
  ask: price + 0.01,
  bidSize: 100,
  askSize: 100,
  change: 1,
  changePercent: 1,
  open: price - 1,
  high: price + 1,
  low: price - 2,
  prevClose: price - 1,
  volume: 1_000,
  providerContractId: `${symbol}-conid`,
  source: "ibkr" as const,
  transport: "tws" as const,
  delayed: false,
  updatedAt,
});

test("isQuoteSnapshotAtLeastAsFresh rejects older quote snapshots", () => {
  const current = stockQuote("SPY", 502, "2026-04-28T14:30:02.000Z");
  const older = stockQuote("SPY", 499, "2026-04-28T14:29:58.000Z");
  const newer = stockQuote("SPY", 503, "2026-04-28T14:30:03.000Z");

  assert.equal(isQuoteSnapshotAtLeastAsFresh(older, current), false);
  assert.equal(isQuoteSnapshotAtLeastAsFresh(newer, current), true);
});

test("mergeQuotesIntoCache keeps canonical quote when incoming snapshot is older", () => {
  const current = {
    quotes: [stockQuote("SPY", 502, "2026-04-28T14:30:02.000Z")],
    transport: "tws" as const,
    delayed: false,
    fallbackUsed: false,
  };
  const merged = mergeQuotesIntoCache(
    current,
    [stockQuote("SPY", 499, "2026-04-28T14:29:58.000Z")],
    ["SPY"],
  );

  assert.equal(merged?.quotes[0]?.price, 502);
});

const createMockQueryClient = (
  queryKeys: unknown[][],
  initialData: Map<string, unknown> = new Map(),
) => {
  const queries = queryKeys.map((queryKey) => ({ queryKey }));
  const writes = new Map(initialData);
  const invalidated: unknown[][] = [];
  return {
    writes,
    invalidated,
    queryClient: {
      getQueryCache: () => ({
        findAll: ({ queryKey, predicate }: any = {}) =>
          queries.filter((query) => {
            if (queryKey) {
              const requested = JSON.stringify(queryKey);
              if (!JSON.stringify(query.queryKey).startsWith(requested.slice(0, -1))) {
                return false;
              }
            }
            return predicate ? predicate(query) : true;
          }),
      }),
      setQueryData: (queryKey: unknown[], value: unknown) => {
        const key = JSON.stringify(queryKey);
        const previous = writes.get(key);
        writes.set(
          key,
          typeof value === "function" ? (value as (current: unknown) => unknown)(previous) : value,
        );
      },
      invalidateQueries: ({ predicate }: any = {}) => {
        queries.forEach((query) => {
          if (!predicate || predicate(query)) {
            invalidated.push(query.queryKey);
          }
        });
      },
    },
  };
};

test("applyShadowAccountPayloadToCache patches shadow account caches without invalidating derived views", () => {
  const summary = { accountId: "shadow", metrics: { netLiquidation: { value: 100_500 } } };
  const positions = {
    accountId: "shadow",
    positions: [
      { id: "stock", accountId: "shadow", assetClass: "Stocks", symbol: "SPY" },
      { id: "option", accountId: "shadow", assetClass: "Options", symbol: "SPY" },
    ],
  };
  const workingOrders = {
    accountId: "shadow",
    tab: "working",
    orders: [{ id: "working", accountId: "shadow", status: "submitted" }],
  };
  const historyOrders = {
    accountId: "shadow",
    tab: "history",
    orders: [{ id: "filled", accountId: "shadow", status: "filled" }],
  };
  const allocation = { accountId: "shadow", assetClass: [{ label: "Cash" }] };
  const risk = { accountId: "shadow", margin: { marginAvailable: 100_000 } };
  const { queryClient, writes, invalidated } = createMockQueryClient([
    ["/api/accounts/shadow/summary", { mode: "paper" }],
    ["/api/accounts/shadow/summary", { mode: "paper", source: "signal_options_replay" }],
    ["/api/accounts/shadow/positions", { mode: "paper", assetClass: "Options" }],
    [
      "/api/accounts/shadow/positions",
      { mode: "paper", assetClass: "Options", source: "signal_options_replay" },
    ],
    ["/api/accounts/shadow/orders", { mode: "paper", tab: "history" }],
    [
      "/api/accounts/shadow/orders",
      { mode: "paper", tab: "history", source: "signal_options_replay" },
    ],
    ["/api/accounts/shadow/allocation", { mode: "paper" }],
    ["/api/accounts/shadow/risk", { mode: "paper" }],
    ["/api/accounts/shadow/equity-history", { mode: "paper", range: "ALL" }],
    ["/api/accounts/shadow/closed-trades", { mode: "paper" }],
    ["/api/accounts/shadow/cash-activity", { mode: "paper" }],
    ["/api/accounts/U1/summary", { mode: "paper" }],
  ]);

  applyShadowAccountPayloadToCache(queryClient as any, {
    summary,
    positions,
    workingOrders,
    historyOrders,
    allocation,
    risk,
    updatedAt: "2026-04-30T00:00:00.000Z",
  } as any);

  assert.equal(
    (writes.get(JSON.stringify(["/api/accounts/shadow/summary", { mode: "paper" }])) as any)
      ?.metrics.netLiquidation.value,
    100_500,
  );
  assert.deepEqual(
    (
      writes.get(
        JSON.stringify([
          "/api/accounts/shadow/positions",
          { mode: "paper", assetClass: "Options" },
        ]),
      ) as any
    )?.positions.map((position: any) => position.id),
    ["option"],
  );
  assert.deepEqual(
    (
      writes.get(
        JSON.stringify([
          "/api/accounts/shadow/orders",
          { mode: "paper", tab: "history" },
        ]),
      ) as any
    )?.orders.map((order: any) => order.id),
    ["filled"],
  );
  assert.equal(
    (writes.get(JSON.stringify(["/api/accounts/shadow/allocation", { mode: "paper" }])) as any)
      ?.assetClass[0].label,
    "Cash",
  );
  assert.equal(
    writes.get(
      JSON.stringify([
        "/api/accounts/shadow/summary",
        { mode: "paper", source: "signal_options_replay" },
      ]),
    ),
    undefined,
  );
  assert.equal(
    writes.get(
      JSON.stringify([
        "/api/accounts/shadow/positions",
        { mode: "paper", assetClass: "Options", source: "signal_options_replay" },
      ]),
    ),
    undefined,
  );
  assert.equal(
    writes.get(
      JSON.stringify([
        "/api/accounts/shadow/orders",
        { mode: "paper", tab: "history", source: "signal_options_replay" },
      ]),
    ),
    undefined,
  );
  assert.equal(invalidated.length, 0);
});

test("applyAccountPagePayloadToCache seeds visible account page query caches", () => {
  const summaryKey = ["/api/accounts/combined/summary", { mode: "paper" }];
  const positionsKey = [
    "/api/accounts/combined/positions",
    { mode: "paper", assetClass: "Options" },
  ];
  const ordersKey = [
    "/api/accounts/combined/orders",
    { mode: "paper", tab: "working" },
  ];
  const tradesKey = [
    "/api/accounts/combined/closed-trades",
    {
      mode: "paper",
      symbol: "SPY",
      assetClass: "Options",
      pnlSign: "winner",
      from: "2026-05-01T00:00:00.000Z",
    },
  ];
  const calendarTradesKey = [
    "/api/accounts/combined/closed-trades",
    { mode: "paper", from: "2025-04-01T00:00:00.000Z" },
  ];
  const equityKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1D" },
  ];
  const benchmarkKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1D", benchmark: "SPY" },
  ];
  const sourceScopedPositionsKey = [
    "/api/accounts/combined/positions",
    { mode: "paper", assetClass: "Options", source: "signal_options_replay" },
  ];
  const sourceScopedTradesKey = [
    "/api/accounts/combined/closed-trades",
    { mode: "paper", source: "signal_options_replay" },
  ];
  const sourceScopedEquityKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1D", source: "signal_options_replay" },
  ];
  const healthKey = ["/api/accounts/flex/health"];
  const { queryClient, writes } = createMockQueryClient([
    summaryKey,
    positionsKey,
    ordersKey,
    tradesKey,
    calendarTradesKey,
    equityKey,
    benchmarkKey,
    sourceScopedPositionsKey,
    sourceScopedTradesKey,
    sourceScopedEquityKey,
    healthKey,
  ]);

  applyAccountPagePayloadToCache(queryClient as any, {
    stream: "account-page-bootstrap",
    accountId: "combined",
    mode: "paper",
    range: "1D",
    orderTab: "working",
    assetClass: "Options",
    tradeFilters: {
      from: "2026-05-01T00:00:00.000Z",
      to: null,
      symbol: "SPY",
      assetClass: "Options",
      pnlSign: "winner",
      holdDuration: null,
    },
    performanceCalendarFrom: "2025-04-01T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    summary: { accountId: "combined", metrics: { netLiquidation: { value: 1 } } },
    positions: { accountId: "combined", positions: [{ id: "position" }] },
    orders: { accountId: "combined", orders: [{ id: "order" }], tab: "working" },
    allocation: { accountId: "combined", assetClass: [] },
    risk: { accountId: "combined", margin: {} },
    cashActivity: { accountId: "combined", activities: [{ id: "cash" }] },
    closedTrades: { accountId: "combined", trades: [{ id: "trade" }] },
    performanceCalendarTrades: {
      accountId: "combined",
      trades: [{ id: "calendar-trade" }],
    },
    equityHistory: { accountId: "combined", range: "1D", points: [{ timestamp: "a" }] },
    intradayEquity: { accountId: "combined", range: "1D", points: [{ timestamp: "b" }] },
    benchmarkEquityHistory: {
      SPY: { accountId: "combined", range: "1D", points: [{ timestamp: "spy" }] },
    },
    performanceCalendarEquity: {
      accountId: "combined",
      range: "1Y",
      points: [{ timestamp: "calendar" }],
    },
    flexHealth: { flexConfigured: true },
    tradingPatterns: null,
  } as any);

  assert.equal(
    (writes.get(JSON.stringify(summaryKey)) as any)?.metrics.netLiquidation.value,
    1,
  );
  assert.equal((writes.get(JSON.stringify(positionsKey)) as any)?.positions[0].id, "position");
  assert.equal((writes.get(JSON.stringify(ordersKey)) as any)?.orders[0].id, "order");
  assert.equal((writes.get(JSON.stringify(tradesKey)) as any)?.trades[0].id, "trade");
  assert.equal(
    (writes.get(JSON.stringify(calendarTradesKey)) as any)?.trades[0].id,
    "calendar-trade",
  );
  assert.equal((writes.get(JSON.stringify(equityKey)) as any)?.points[0].timestamp, "b");
  assert.equal(
    (writes.get(JSON.stringify(benchmarkKey)) as any)?.points[0].timestamp,
    "spy",
  );
  assert.equal(writes.get(JSON.stringify(sourceScopedPositionsKey)), undefined);
  assert.equal(writes.get(JSON.stringify(sourceScopedTradesKey)), undefined);
  assert.equal(writes.get(JSON.stringify(sourceScopedEquityKey)), undefined);
  assert.equal((writes.get(JSON.stringify(healthKey)) as any)?.flexConfigured, true);
});

test("queueAccountPagePayloadToCache coalesces account page live writes until frame flush", () => {
  const summaryKey = ["/api/accounts/combined/summary", { mode: "paper" }];
  const positionsKey = [
    "/api/accounts/combined/positions",
    { mode: "paper", assetClass: "Options" },
  ];
  const ordersKey = [
    "/api/accounts/combined/orders",
    { mode: "paper", tab: "working" },
  ];
  const { queryClient, writes } = createMockQueryClient([
    summaryKey,
    positionsKey,
    ordersKey,
    ["/api/accounts/combined/allocation", { mode: "paper" }],
    ["/api/accounts/combined/risk", { mode: "paper" }],
    ["/api/accounts/combined/equity-history", { mode: "paper", range: "1D" }],
  ]);
  const livePayload = (netLiquidation: number) => ({
    stream: "account-page-live",
    accountId: "combined",
    mode: "paper",
    orderTab: "working",
    assetClass: "Options",
    updatedAt: "2026-05-12T00:00:00.000Z",
    summary: {
      accountId: "combined",
      metrics: { netLiquidation: { value: netLiquidation } },
    },
    positions: {
      accountId: "combined",
      positions: [{ id: "P1", symbol: "SPY", mark: 5 }],
    },
    orders: {
      accountId: "combined",
      tab: "working",
      orders: [{ id: "O1", symbol: "SPY", status: "working" }],
    },
    allocation: { accountId: "combined", assetClass: [] },
    risk: { accountId: "combined", margin: {} },
    intradayEquity: {
      accountId: "combined",
      range: "1D",
      points: [{ timestamp: "live" }],
    },
  });

  queueAccountPagePayloadToCache(queryClient as any, "live", livePayload(1) as any);
  queueAccountPagePayloadToCache(queryClient as any, "live", livePayload(2) as any);

  assert.equal(writes.get(JSON.stringify(summaryKey)), undefined);

  flushAccountPagePayloadQueue();

  assert.equal(
    (writes.get(JSON.stringify(summaryKey)) as any)?.metrics.netLiquidation.value,
    2,
  );
  assert.equal((writes.get(JSON.stringify(positionsKey)) as any)?.positions[0].id, "P1");
  assert.equal((writes.get(JSON.stringify(ordersKey)) as any)?.orders[0].id, "O1");

  const firstSnapshot = getAccountPositionRowSnapshot({
    accountId: "combined",
    mode: "paper",
    rowId: "P1",
  });
  queueAccountPagePayloadToCache(queryClient as any, "live", livePayload(3) as any);
  flushAccountPagePayloadQueue();
  assert.equal(
    getAccountPositionRowSnapshot({
      accountId: "combined",
      mode: "paper",
      rowId: "P1",
    }),
    firstSnapshot,
  );
});

test("applyAccountPageLivePayloadToCache patches performance-calendar equity ranges from live summary", () => {
  const equityKey = [
    "/api/accounts/shadow/equity-history",
    { mode: "paper", range: "1Y" },
  ];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "shadow",
        range: "1Y",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        asOf: "2026-05-12T20:00:00.000Z",
        latestSnapshotAt: "2026-05-12T20:00:00.000Z",
        isStale: false,
        staleReason: null,
        terminalPointSource: "shadow_ledger",
        liveTerminalIncluded: false,
        points: [
          {
            timestamp: "2026-05-12T20:00:00.000Z",
            netLiquidation: 30_000,
            currency: "USD",
            source: "SHADOW_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient([equityKey], initialData);

  applyAccountPageLivePayloadToCache(queryClient as any, {
    stream: "account-page-live",
    accountId: "shadow",
    mode: "paper",
    orderTab: "history",
    assetClass: null,
    updatedAt: "2026-05-13T15:03:12.357Z",
    summary: {
      accountId: "shadow",
      isCombined: false,
      mode: "paper",
      currency: "USD",
      accounts: [],
      updatedAt: "2026-05-13T15:03:12.357Z",
      fx: { baseCurrency: "USD", timestamp: null, rates: {}, warning: null },
      badges: {},
      metrics: {
        netLiquidation: {
          value: 30_112.14,
          currency: "USD",
          source: "SHADOW_LEDGER",
          field: "netLiquidation",
          updatedAt: "2026-05-13T15:03:12.357Z",
        },
      },
    },
    intradayEquity: {
      accountId: "shadow",
      range: "1D",
      currency: "USD",
      points: [],
      events: [],
    },
    allocation: { accountId: "shadow", assetClass: [] },
    positions: { accountId: "shadow", positions: [] },
    orders: { accountId: "shadow", tab: "history", orders: [] },
    risk: { accountId: "shadow", margin: {} },
  } as any);

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points.length, 2);
  assert.equal(patched.points[1].timestamp, "2026-05-13T15:03:12.357Z");
  assert.equal(patched.points[1].netLiquidation, 30_112.14);
  assert.equal(patched.points[1].source, "SHADOW_LEDGER");
  assert.equal(patched.liveTerminalIncluded, true);
  assert.equal(patched.terminalPointSource, "shadow_ledger");
  assert.equal(Number(patched.points[1].returnPercent.toFixed(4)), 0.3738);
});

test("applyIbkrAccountPayloadToCache patches scoped account positions from stream", () => {
  const positionsKey = [
    "/api/accounts/U1/positions",
    { mode: "live", assetClass: "Options" },
  ];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(positionsKey),
      {
        accountId: "U1",
        currency: "USD",
        totals: {},
        updatedAt: "2026-04-30T14:00:00.000Z",
        positions: [
          {
            id: "P1",
            accountId: "U1",
            accounts: ["U1"],
            symbol: "SPY",
            description: "SPY 2026-05-01 500 call",
            assetClass: "Options",
            optionContract: null,
            sector: "ETF",
            quantity: 1,
            averageCost: 2,
            mark: 2.5,
            dayChange: 10,
            dayChangePercent: 1,
            unrealizedPnl: 50,
            unrealizedPnlPercent: 25,
            marketValue: 250,
            weightPercent: 0.25,
            betaWeightedDelta: null,
            lots: [],
            openOrders: [],
            source: "IBKR_POSITIONS",
          },
        ],
      },
    ],
  ]);
  const { queryClient, writes, invalidated } = createMockQueryClient(
    [positionsKey],
    initialData,
  );

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 100_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
      ],
      positions: [
        {
          id: "P1",
          accountId: "U1",
          symbol: "SPY",
          assetClass: "option",
          quantity: 2,
          averagePrice: 2,
          marketPrice: 3,
          marketValue: 600,
          unrealizedPnl: 200,
          unrealizedPnlPercent: 50,
          optionContract: null,
        },
        {
          id: "P2",
          accountId: "U1",
          symbol: "AAPL",
          assetClass: "stock",
          quantity: 5,
          averagePrice: 100,
          marketPrice: 101,
          marketValue: 505,
          unrealizedPnl: 5,
          unrealizedPnlPercent: 1,
          optionContract: null,
        },
      ],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const patched = writes.get(JSON.stringify(positionsKey)) as any;
  assert.deepEqual(
    patched.positions.map((position: any) => position.id),
    ["P1"],
  );
  assert.equal(patched.positions[0].quantity, 2);
  assert.equal(patched.positions[0].mark, 3);
  assert.equal(patched.positions[0].marketValue, 600);
  assert.equal(patched.positions[0].weightPercent, 0.6);
  assert.equal(invalidated.length, 0);
});

test("invalidateVisibleAccountDerivedQueries targets scoped real account views", () => {
  const { queryClient, invalidated } = createMockQueryClient([
    ["/api/accounts/U1/summary", { mode: "live" }],
    ["/api/accounts/U1/positions", { mode: "live" }],
    ["/api/accounts/U1/equity-history", { mode: "paper" }],
    ["/api/accounts/U2/summary", { mode: "live" }],
    ["/api/positions", { mode: "live", accountId: "U1" }],
  ]);

  invalidateVisibleAccountDerivedQueries(queryClient as any, ["U1"], "live");

  assert.deepEqual(
    invalidated.map((queryKey) => queryKey[0]),
    ["/api/accounts/U1/summary", "/api/accounts/U1/positions"],
  );
});

test("applyIbkrAccountPayloadToCache appends one live terminal point to matching equity ranges", () => {
  const equityKey = ["/api/accounts/U1/equity-history", { mode: "live", range: "1D" }];
  const mismatchedRangeKey = [
    "/api/accounts/U1/equity-history",
    { mode: "live", range: "1D", benchmark: "DIA" },
  ];
  const benchmarkKey = [
    "/api/accounts/U1/equity-history",
    { mode: "live", range: "1D", benchmark: "SPY" },
  ];
  const summaryKey = ["/api/accounts/U1/summary", { mode: "live" }];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "U1",
        range: "1D",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [
          {
            timestamp: "2026-04-30T14:00:00.000Z",
            netLiquidation: 100_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
    [
      JSON.stringify(mismatchedRangeKey),
      {
        accountId: "U1",
        range: "1W",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [],
        events: [],
      },
    ],
    [
      JSON.stringify(benchmarkKey),
      {
        accountId: "U1",
        range: "1D",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: "SPY",
        points: [
          {
            timestamp: "2026-04-30T14:00:00.000Z",
            netLiquidation: 100_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: 0,
          },
        ],
        events: [],
      },
    ],
    [
      JSON.stringify(summaryKey),
      {
        accountId: "U1",
        isCombined: false,
        mode: "live",
        currency: "USD",
        accounts: [],
        updatedAt: "2026-04-30T14:00:00.000Z",
        fx: { baseCurrency: "USD", timestamp: null, rates: {}, warning: null },
        badges: {},
        metrics: {
          netLiquidation: {
            value: 100_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            field: "netLiquidation",
            updatedAt: "2026-04-30T14:00:00.000Z",
          },
        },
      },
    ],
  ]);
  const { queryClient, writes, invalidated } = createMockQueryClient(
    [equityKey, mismatchedRangeKey, benchmarkKey, summaryKey],
    initialData,
  );

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 101_250,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
      ],
      positions: [],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points.length, 2);
  assert.equal(patched.points[1].source, "IBKR_ACCOUNT_SUMMARY");
  assert.equal(patched.points[1].netLiquidation, 101_250);
  assert.equal(patched.liveTerminalIncluded, true);
  assert.equal(patched.terminalPointSource, "live_account_summary");
  assert.equal(patched.points[1].returnPercent, 1.25);

  const patchedBenchmark = writes.get(JSON.stringify(benchmarkKey)) as any;
  assert.equal(patchedBenchmark.points.length, 2);
  assert.equal(patchedBenchmark.points[1].benchmarkPercent, null);

  const mismatchedRange = writes.get(JSON.stringify(mismatchedRangeKey)) as any;
  assert.deepEqual(mismatchedRange.points, []);

  const summary = writes.get(JSON.stringify(summaryKey)) as any;
  assert.equal(summary.metrics.netLiquidation.value, 101_250);
  assert.equal(summary.metrics.buyingPower.value, 50_000);
  assert.equal(
    invalidated.some((queryKey) => queryKey[0] === "/api/accounts/U1/equity-history"),
    false,
  );
});

test("applyIbkrAccountPayloadToCache keeps live equity returns transfer-adjusted", () => {
  const equityKey = ["/api/accounts/U1/equity-history", { mode: "live", range: "YTD" }];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "U1",
        range: "YTD",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [
          {
            timestamp: "2026-01-01T00:00:00.000Z",
            netLiquidation: 110_000,
            currency: "USD",
            source: "FLEX",
            deposits: 10_000,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient([equityKey], initialData);

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 115_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
      ],
      positions: [],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points.length, 2);
  assert.equal(patched.points[0].returnPercent, 0);
  assert.equal(patched.points[1].returnPercent, 100 * (5_000 / 110_000));
});

test("applyIbkrAccountPayloadToCache replaces the prior live equity terminal point", () => {
  const equityKey = ["/api/accounts/U1/equity-history", { mode: "live", range: "1D" }];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "U1",
        range: "1D",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [
          {
            timestamp: "2026-04-30T14:00:00.000Z",
            netLiquidation: 100_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
          {
            timestamp: "2026-04-30T14:00:03.000Z",
            netLiquidation: 101_000,
            currency: "USD",
            source: "IBKR_ACCOUNT_SUMMARY",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 1,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient([equityKey], initialData);

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "live",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 101_500,
          updatedAt: "2026-04-30T14:00:06.000Z",
        },
      ],
      positions: [],
    } as any,
    { accountId: "U1", mode: "live" },
  );

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points.length, 2);
  assert.equal(patched.points[1].timestamp, "2026-04-30T14:00:06.000Z");
  assert.equal(patched.points[1].netLiquidation, 101_500);
});

test("applyIbkrAccountPayloadToCache sums live terminal value for combined account charts", () => {
  const equityKey = [
    "/api/accounts/combined/equity-history",
    { mode: "paper", range: "1D" },
  ];
  const initialData = new Map<string, unknown>([
    [
      JSON.stringify(equityKey),
      {
        accountId: "combined",
        range: "1D",
        currency: "USD",
        flexConfigured: true,
        lastFlexRefreshAt: null,
        benchmark: null,
        points: [
          {
            timestamp: "2026-04-30T14:00:00.000Z",
            netLiquidation: 200_000,
            currency: "USD",
            source: "LOCAL_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
        ],
        events: [],
      },
    ],
  ]);
  const { queryClient, writes } = createMockQueryClient([equityKey], initialData);

  applyIbkrAccountPayloadToCache(
    queryClient as any,
    {
      accounts: [
        {
          id: "U1",
          providerAccountId: "U1",
          provider: "ibkr",
          mode: "paper",
          displayName: "IBKR U1",
          currency: "USD",
          cash: 10_000,
          buyingPower: 50_000,
          netLiquidation: 101_000,
          updatedAt: "2026-04-30T14:00:03.000Z",
        },
        {
          id: "U2",
          providerAccountId: "U2",
          provider: "ibkr",
          mode: "paper",
          displayName: "IBKR U2",
          currency: "USD",
          cash: 20_000,
          buyingPower: 70_000,
          netLiquidation: 102_000,
          updatedAt: "2026-04-30T14:00:04.000Z",
        },
      ],
      positions: [],
    } as any,
    { accountId: "combined", mode: "paper" },
  );

  const patched = writes.get(JSON.stringify(equityKey)) as any;
  assert.equal(patched.points[1].timestamp, "2026-04-30T14:00:04.000Z");
  assert.equal(patched.points[1].netLiquidation, 203_000);
});
