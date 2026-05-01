import assert from "node:assert/strict";
import test from "node:test";
import {
  applyIbkrAccountPayloadToCache,
  applyShadowAccountPayloadToCache,
  getOptionChainContractExpirationKey,
  groupOptionChainContractsByExpiration,
  invalidateVisibleAccountDerivedQueries,
  isQuoteSnapshotAtLeastAsFresh,
  mergeOptionChainContracts,
  mergeQuotesIntoCache,
  patchOptionQuotesIntoContracts,
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

test("applyShadowAccountPayloadToCache patches shadow account caches and invalidates derived views", () => {
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
    ["/api/accounts/shadow/positions", { mode: "paper", assetClass: "Options" }],
    ["/api/accounts/shadow/orders", { mode: "paper", tab: "history" }],
    ["/api/accounts/shadow/allocation", { mode: "paper" }],
    ["/api/accounts/shadow/risk", { mode: "paper" }],
    ["/api/accounts/shadow/equity-history", { mode: "paper", range: "ALL" }],
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
  assert.ok(
    invalidated.some(
      (queryKey) =>
        queryKey[0] === "/api/accounts/shadow/equity-history" &&
        (queryKey[1] as any).range === "ALL",
    ),
  );
  assert.equal(
    invalidated.some((queryKey) => queryKey[0] === "/api/accounts/U1/summary"),
    false,
  );
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
