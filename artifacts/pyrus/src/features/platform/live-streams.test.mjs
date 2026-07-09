import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  __liveStreamsInternalsForTests,
  applyAccountPageLivePayloadToCache,
  getSignalMonitorMatrixStreamUrl,
  getStoredOptionQuoteSnapshot,
  isQuoteSnapshotAtLeastAsFresh,
} from "./live-streams.ts";

const queryKeyText = (key) => JSON.stringify(key);

test("broker stream freshness tolerates normal SSE jitter under load", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(source, /const ACCOUNT_STREAM_FRESH_MS = 20_000;/);
  assert.doesNotMatch(source, /const ACCOUNT_STREAM_FRESH_MS = 7_000;/);
});

test("option quote patch preserves a shadow prior-day position's backend day change", () => {
  const { patchAccountPositionRowFromOptionQuote } = __liveStreamsInternalsForTests;
  const priorDay = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const baseRow = {
    id: "shadow:RH",
    accountId: "shadow",
    source: "SHADOW_LEDGER",
    symbol: "RH",
    assetClass: "option",
    optionContract: {
      underlying: "RH",
      multiplier: 100,
      sharesPerContract: 100,
      strike: 152.5,
      right: "call",
      expirationDate: "2026-07-10",
      providerContractId: "O:RH260710C00152500",
    },
    quantity: 2,
    averageCost: 7.03,
    mark: 14.6,
    marketValue: 2920,
    unrealizedPnl: 1514,
    dayChange: 1010, // backend position P&L day change
    dayChangePercent: 52.6,
    openedAt: priorDay,
  };
  // The option quote's own day change is 0 — it must NOT clobber the position day change.
  const quote = {
    providerContractId: "O:RH260710C00152500",
    bid: 14.5,
    ask: 14.7,
    mark: 14.6,
    dayChange: 0,
    dayChangePercent: 0,
  };
  const patched = patchAccountPositionRowFromOptionQuote(baseRow, quote);
  assert.equal(patched.dayChange, 1010);
  assert.equal(patched.dayChangePercent, 52.6);

  // Control: a non-shadow prior-day option is NOT preserved (takes the quote's day change).
  const realRow = { ...baseRow, accountId: "U123", source: "IBKR" };
  const patchedReal = patchAccountPositionRowFromOptionQuote(realRow, quote);
  assert.equal(patchedReal.dayChange, 0);
});

test("option quote cache rejects future-dated ticks and self-heals a poisoned timestamp", () => {
  const { cacheOptionQuoteSnapshot } = __liveStreamsInternalsForTests;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const FAR_FUTURE = 10 * 60 * 1000; // beyond the 2-minute future tolerance

  // Clamp: a corrupt far-future tick must NOT overwrite/freeze a real quote, and a
  // later real tick must still flow through.
  const clampId = "O:CLAMPTEST260821C00000500";
  cacheOptionQuoteSnapshot({
    providerContractId: clampId,
    symbol: clampId,
    bid: 1.0,
    ask: 1.02,
    price: 1.01,
    updatedAt: iso(now),
  });
  cacheOptionQuoteSnapshot({
    providerContractId: clampId,
    symbol: clampId,
    bid: 9.98,
    ask: 9.99,
    price: 9.985,
    updatedAt: iso(now + FAR_FUTURE),
  });
  assert.equal(getStoredOptionQuoteSnapshot(clampId)?.bid, 1.0);
  cacheOptionQuoteSnapshot({
    providerContractId: clampId,
    symbol: clampId,
    bid: 1.05,
    ask: 1.07,
    price: 1.06,
    updatedAt: iso(now + 5000),
  });
  assert.equal(getStoredOptionQuoteSnapshot(clampId)?.bid, 1.05);

  // Self-heal: a store already poisoned into the future must un-stick on the next
  // real (earlier-dated) tick instead of freezing until reload.
  const healId = "O:HEALTEST260821C00000500";
  cacheOptionQuoteSnapshot({
    providerContractId: healId,
    symbol: healId,
    bid: 2.0,
    ask: 2.02,
    price: 2.01,
    updatedAt: iso(now + FAR_FUTURE),
  });
  assert.equal(getStoredOptionQuoteSnapshot(healId)?.bid, 2.0);
  cacheOptionQuoteSnapshot({
    providerContractId: healId,
    symbol: healId,
    bid: 2.25,
    ask: 2.27,
    price: 2.26,
    updatedAt: iso(now),
  });
  assert.equal(getStoredOptionQuoteSnapshot(healId)?.bid, 2.25);
});

test("quote stream accepts equal-timestamp live price changes", () => {
  const timestamp = "2026-06-09T18:45:00.000Z";

  assert.equal(
    isQuoteSnapshotAtLeastAsFresh(
      {
        symbol: "AAPL",
        price: 205.12,
        bid: 205.11,
        ask: 205.13,
        updatedAt: timestamp,
        dataUpdatedAt: timestamp,
        source: "massive",
        transport: "massive_websocket",
        latency: null,
      },
      {
        symbol: "AAPL",
        price: 205.08,
        bid: 205.07,
        ask: 205.09,
        updatedAt: timestamp,
        dataUpdatedAt: timestamp,
        source: "massive",
        transport: "massive_websocket",
        latency: null,
      },
    ),
    true,
  );
});

test("quote stream accepts numeric latency tie-breakers", () => {
  const timestamp = "2026-06-09T18:45:00.000Z";

  assert.equal(
    isQuoteSnapshotAtLeastAsFresh(
      {
        symbol: "AAPL",
        price: 205.12,
        bid: 205.11,
        ask: 205.13,
        updatedAt: timestamp,
        dataUpdatedAt: timestamp,
        source: "massive",
        transport: "massive_websocket",
        latency: {
          apiServerReceivedAt: 1_780_000_001_000,
        },
      },
      {
        symbol: "AAPL",
        price: 205.08,
        bid: 205.07,
        ask: 205.09,
        updatedAt: timestamp,
        dataUpdatedAt: timestamp,
        source: "massive",
        transport: "massive_websocket",
        latency: {
          apiServerReceivedAt: 1_780_000_000_000,
        },
      },
    ),
    true,
  );
});

test("quote stream live websocket quote can unstick cached REST snapshot", () => {
  assert.equal(
    isQuoteSnapshotAtLeastAsFresh(
      {
        symbol: "SPY",
        price: 733.2,
        bid: 733.19,
        ask: 733.21,
        updatedAt: "2026-06-25T18:00:00.000Z",
        dataUpdatedAt: "2026-06-25T18:00:00.000Z",
        source: "massive",
        transport: "massive_websocket",
        freshness: "live",
        marketDataMode: "live",
      },
      {
        symbol: "SPY",
        price: 733.8,
        bid: 733.79,
        ask: 733.81,
        updatedAt: "2026-06-25T18:00:10.000Z",
        dataUpdatedAt: "2026-06-25T18:00:10.000Z",
        source: "massive",
        transport: "massive_rest",
        freshness: "stale",
        marketDataMode: "stale",
      },
    ),
    true,
  );
});

test("quote stream rejects future-dated incoming snapshots", () => {
  const realDateNow = Date.now;
  Date.now = () => Date.parse("2026-06-25T18:00:00.000Z");
  try {
    assert.equal(
      isQuoteSnapshotAtLeastAsFresh(
        {
          symbol: "SPY",
          price: 699.05,
          updatedAt: "2026-06-25T19:00:00.000Z",
          dataUpdatedAt: "2026-06-25T19:00:00.000Z",
          source: "massive",
          transport: "massive_websocket",
          freshness: "live",
          marketDataMode: "live",
          latency: {
            apiServerReceivedAt: "2026-06-25T18:00:00.000Z",
          },
        },
        undefined,
      ),
      false,
    );
  } finally {
    Date.now = realDateNow;
  }
});

test("quote stream recovers from a future-dated cached snapshot", () => {
  const realDateNow = Date.now;
  Date.now = () => Date.parse("2026-06-25T18:01:00.000Z");
  try {
    assert.equal(
      isQuoteSnapshotAtLeastAsFresh(
        {
          symbol: "SPY",
          price: 733.2,
          updatedAt: "2026-06-25T18:00:30.000Z",
          dataUpdatedAt: "2026-06-25T18:00:30.000Z",
          source: "massive",
          transport: "massive_websocket",
          freshness: "live",
          marketDataMode: "live",
          latency: {
            apiServerReceivedAt: "2026-06-25T18:00:30.000Z",
          },
        },
        {
          symbol: "SPY",
          price: 733.8,
          updatedAt: "2026-06-25T19:00:00.000Z",
          dataUpdatedAt: "2026-06-25T19:00:00.000Z",
          source: "massive",
          transport: "massive_websocket",
          freshness: "live",
          marketDataMode: "live",
          latency: {
            apiServerReceivedAt: "2026-06-25T18:00:00.000Z",
          },
        },
      ),
      true,
    );
  } finally {
    Date.now = realDateNow;
  }
});

test("algo cockpit stream keeps known deployments when fallback is unavailable", () => {
  const current = {
    deployments: [
      {
        id: "dep-1",
        name: "Pyrus Signals Options Shadow",
        mode: "shadow",
      },
    ],
  };
  const incoming = {
    deployments: [],
    cacheStatus: "unavailable",
  };

  assert.equal(
    __liveStreamsInternalsForTests.resolveAlgoDeploymentsStreamCacheUpdate(
      current,
      incoming,
    ),
    current,
  );
  assert.equal(
    __liveStreamsInternalsForTests.resolveAlgoDeploymentsStreamCacheUpdate(
      undefined,
      incoming,
    ),
    incoming,
  );
});

test("primary algo cockpit stream payload does not hydrate canonical STA caches", () => {
  const calls = [];
  const queryClient = {
    setQueryData: (key, value) => {
      calls.push({ key, value });
    },
  };
  const primaryPayload = {
    stream: "algo-cockpit-live",
    phase: "primary",
    mode: "shadow",
    deploymentId: "dep-1",
    updatedAt: "2026-06-08T16:20:00.000Z",
    deployments: { deployments: [] },
    focusedDeployment: null,
    events: { events: [] },
    signalOptionsState: { signals: [{ symbol: "AYI" }], candidates: [] },
    cockpit: { signals: [{ symbol: "AYI" }], candidates: [] },
    performance: { summary: {} },
    signalMonitorProfile: { enabled: true },
  };

  __liveStreamsInternalsForTests.applyAlgoCockpitPayloadToCache(
    queryClient,
    primaryPayload,
  );

  assert.ok(calls.some((call) => queryKeyText(call.key).includes("/algo/deployments")));
  assert.ok(calls.some((call) => queryKeyText(call.key).includes("/algo/events")));
  assert.equal(
    calls.some((call) => queryKeyText(call.key).includes("/signal-options/state")),
    false,
  );
  assert.equal(
    calls.some((call) => queryKeyText(call.key).includes("/cockpit")),
    false,
  );
  assert.equal(
    calls.some((call) => queryKeyText(call.key).includes("/signal-options/performance")),
    false,
  );
  assert.equal(
    calls.some((call) => queryKeyText(call.key).includes("/signal-monitor/profile")),
    false,
  );
});

test("full algo cockpit stream payload hydrates canonical STA caches", () => {
  const calls = [];
  const queryClient = {
    setQueryData: (key, value) => {
      calls.push({ key, value });
    },
  };
  const fullPayload = {
    stream: "algo-cockpit-bootstrap",
    phase: "full",
    mode: "shadow",
    deploymentId: "dep-1",
    updatedAt: "2026-06-08T16:20:00.000Z",
    deployments: { deployments: [] },
    focusedDeployment: null,
    events: { events: [] },
    signalOptionsState: { signals: [{ symbol: "HEI" }], candidates: [] },
    cockpit: { signals: [{ symbol: "HEI" }], candidates: [] },
    performance: { summary: {} },
    signalMonitorProfile: { enabled: true },
  };

  __liveStreamsInternalsForTests.applyAlgoCockpitPayloadToCache(
    queryClient,
    fullPayload,
  );

  assert.ok(
    calls.some((call) => queryKeyText(call.key).includes("/signal-options/state")),
  );
  assert.ok(calls.some((call) => queryKeyText(call.key).includes("/cockpit")));
  assert.ok(
    calls.some((call) =>
      queryKeyText(call.key).includes("/signal-options/performance"),
    ),
  );
  assert.ok(
    calls.some((call) => queryKeyText(call.key).includes("/signal-monitor/profile")),
  );
});

test("account option quote cache patch updates same-day day PnL from mark", () => {
  const row = {
    id: "U123:12345",
    accountId: "U123",
    accounts: ["U123"],
    symbol: "NVDA",
    assetClass: "Options",
    quantity: 1,
    averageCost: 2,
    mark: 2,
    dayChange: 0,
    dayChangePercent: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    marketValue: 200,
    openedAt: new Date().toISOString(),
    optionContract: {
      ticker: "NVDA260612C00145000",
      underlying: "NVDA",
      expirationDate: "2026-06-12T00:00:00.000Z",
      strike: 145,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "12345",
    },
    optionQuote: null,
    quote: null,
  };

  const patched =
    __liveStreamsInternalsForTests.patchAccountPositionRowFromOptionQuote(row, {
      symbol: "NVDA",
      providerContractId: "12345",
      price: 2.45,
      bid: 2.4,
      ask: 2.5,
      updatedAt: new Date().toISOString(),
    });

  assert.ok(Math.abs(patched.unrealizedPnl - 45) < 1e-9);
  assert.equal(patched.dayChange, patched.unrealizedPnl);
  assert.equal(patched.dayChangePercent, patched.unrealizedPnlPercent);
});

test("account option quote cache patch matches structured quote aliases for numeric rows", () => {
  const row = {
    id: "U123:12345",
    accountId: "U123",
    accounts: ["U123"],
    symbol: "NVDA",
    assetClass: "Options",
    quantity: 1,
    averageCost: 2,
    mark: 2,
    dayChange: 0,
    dayChangePercent: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    marketValue: 200,
    openedAt: new Date().toISOString(),
    optionContract: {
      ticker: "NVDA260612C00145000",
      underlying: "NVDA",
      expirationDate: "2026-06-12T00:00:00.000Z",
      strike: 145,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "12345",
    },
    optionQuote: null,
    quote: null,
  };

  const providerContractIds =
    __liveStreamsInternalsForTests.optionPositionProviderContractIds(row);
  assert.equal(providerContractIds.length, 2);
  assert.equal(providerContractIds[0], "O:NVDA260612C00145000");
  assert.equal(providerContractIds[1], "12345");

  const patched =
    __liveStreamsInternalsForTests.patchAccountPositionRowFromOptionQuote(row, {
      symbol: "NVDA",
      providerContractId: providerContractIds[0],
      price: 2.45,
      bid: 2.4,
      ask: 2.5,
      updatedAt: new Date().toISOString(),
    });

  assert.equal(patched.optionQuote.providerContractId, providerContractIds[0]);
  assert.equal(patched.optionQuote.bid, 2.4);
  assert.equal(patched.optionQuote.ask, 2.5);
  assert.ok(Math.abs(patched.unrealizedPnl - 45) < 1e-9);
});

test("account snapshot stream patch updates cached same-day position day PnL", () => {
  const current = {
    accountId: "U123",
    currency: "USD",
    updatedAt: new Date().toISOString(),
    totals: {
      weightPercent: 0,
      unrealizedPnl: 0,
      grossLong: 200,
      grossShort: 0,
      netExposure: 200,
      cash: 1000,
      totalCash: 1000,
      buyingPower: 1000,
      netLiquidation: 1000,
    },
    positions: [
      {
        id: "U123:12345",
        accountId: "U123",
        accounts: ["U123"],
        symbol: "NVDA",
        description: "NVDA 2026-06-12 145 call",
        assetClass: "Options",
        quantity: 1,
        averageCost: 2,
        mark: 2,
        dayChange: 0,
        dayChangePercent: 0,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        marketValue: 200,
        weightPercent: 20,
        betaWeightedDelta: null,
        lots: [],
        openOrders: [],
        source: "IBKR_POSITIONS",
        sourceType: "manual",
        strategyLabel: "Manual",
        attributionStatus: "unknown",
        sourceAttribution: [],
        openedAt: new Date().toISOString(),
        openedAtSource: "execution",
        optionContract: {
          ticker: "NVDA260612C00145000",
          underlying: "NVDA",
          expirationDate: "2026-06-12T00:00:00.000Z",
          strike: 145,
          right: "call",
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: "12345",
        },
        optionQuote: null,
        quote: null,
      },
    ],
  };

  const patched =
    __liveStreamsInternalsForTests.patchAccountPositionsFromStream(
      current,
      {
        accounts: [
          {
            id: "U123",
            providerAccountId: "U123",
            currency: "USD",
            cash: 1000,
            buyingPower: 1000,
            netLiquidation: 1000,
            updatedAt: new Date().toISOString(),
          },
        ],
        positions: [
          {
            id: "U123:12345",
            accountId: "U123",
            symbol: "NVDA",
            assetClass: "option",
            quantity: 1,
            averagePrice: 2,
            marketPrice: 2.45,
            marketValue: 245,
            unrealizedPnl: 45,
            unrealizedPnlPercent: 22.5,
            optionContract: {
              ticker: "NVDA260612C00145000",
              underlying: "NVDA",
              expirationDate: "2026-06-12T00:00:00.000Z",
              strike: 145,
              right: "call",
              multiplier: 100,
              sharesPerContract: 100,
              providerContractId: "12345",
            },
            quote: null,
          },
        ],
      },
      "U123",
      ["/api/accounts/U123/positions", { mode: "shadow", assetClass: "all" }],
    );

  assert.equal(patched.positions.length, 1);
  assert.ok(Math.abs(patched.positions[0].unrealizedPnl - 45) < 1e-9);
  assert.equal(patched.positions[0].dayChange, patched.positions[0].unrealizedPnl);
  assert.equal(
    patched.positions[0].dayChangePercent,
    patched.positions[0].unrealizedPnlPercent,
  );
  assert.equal(patched.totals.unrealizedPnl, patched.positions[0].unrealizedPnl);
});

test("account page payload merge preserves cached execution open date", () => {
  const openedAt = new Date().toISOString();
  const structuredProviderContractId =
    __liveStreamsInternalsForTests.optionPositionProviderContractIds({
      optionContract: {
        ticker: "NVDA260612C00145000",
        underlying: "NVDA",
        expirationDate: "2026-06-12T00:00:00.000Z",
        strike: 145,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "12345",
      },
    })[0];
  const current = {
    id: "U123:12345",
    accountId: "U123",
    accounts: ["U123"],
    symbol: "NVDA",
    description: "NVDA 2026-06-12 145 call",
    assetClass: "Options",
    quantity: 1,
    averageCost: 2,
    mark: 2.45,
    dayChange: 45,
    dayChangePercent: 22.5,
    unrealizedPnl: 45,
    unrealizedPnlPercent: 22.5,
    marketValue: 245,
    openedAt,
    openedAtSource: "execution",
    optionContract: {
      ticker: "NVDA260612C00145000",
      underlying: "NVDA",
      expirationDate: "2026-06-12T00:00:00.000Z",
      strike: 145,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "12345",
    },
    optionQuote: {
      providerContractId: structuredProviderContractId,
      bid: 2.4,
      ask: 2.5,
      mark: 2.45,
      updatedAt: openedAt,
    },
    quote: {
      providerContractId: structuredProviderContractId,
      bid: 2.4,
      ask: 2.5,
      mark: 2.45,
      updatedAt: openedAt,
    },
  };
  const incoming = {
    ...current,
    mark: 2,
    dayChange: null,
    dayChangePercent: null,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    marketValue: 200,
    openedAt: null,
    openedAtSource: null,
    optionQuote: null,
    quote: {
      mark: 2,
      source: "position_mark",
    },
  };

  const [merged] = __liveStreamsInternalsForTests.mergeAccountPositionRowsById(
    [current],
    [incoming],
  );

  assert.equal(merged.openedAt, openedAt);
  assert.equal(merged.openedAtSource, "execution");
  assert.equal(merged.optionQuote.providerContractId, structuredProviderContractId);
  assert.ok(Math.abs(merged.unrealizedPnl - 45) < 1e-9);
  assert.equal(merged.dayChange, merged.unrealizedPnl);
  assert.equal(merged.dayChangePercent, merged.unrealizedPnlPercent);
});

test("account page positions query keys request fast real-account positions first", () => {
  assert.equal(
    __liveStreamsInternalsForTests.primaryAccountPositionsUseLiveQuotes({
      accountId: "U123",
    }),
    false,
  );
  assert.equal(
    __liveStreamsInternalsForTests.primaryAccountPositionsUseLiveQuotes({
      accountId: "shadow",
    }),
    true,
  );
  assert.deepEqual(
    __liveStreamsInternalsForTests.accountPositionsParams({
      mode: "live",
      assetClass: null,
    }),
    {
      mode: "live",
      assetClass: undefined,
      detail: "fast",
      liveQuotes: true,
    },
  );
  assert.deepEqual(
    __liveStreamsInternalsForTests.accountPositionsParams(
      {
        mode: "live",
        assetClass: null,
      },
      { positionsLiveQuotes: false },
    ),
    {
      mode: "live",
      assetClass: undefined,
      detail: "fast",
      liveQuotes: false,
    },
  );
  assert.deepEqual(
    __liveStreamsInternalsForTests.accountPositionsParams({
      mode: "shadow",
      assetClass: "Options",
    }),
    {
      mode: "shadow",
      assetClass: "option",
      detail: "fast",
      liveQuotes: true,
    },
  );
});

test("real account-page live payload patches the visible fast positions query", () => {
  const fastPositionsKey = [
    "/api/accounts/U123/positions",
    {
      mode: "live",
      assetClass: "all",
      detail: "fast",
      liveQuotes: true,
    },
  ];
  const queries = [
    {
      queryKey: fastPositionsKey,
      data: {
        accountId: "U123",
        currency: "USD",
        updatedAt: "2026-06-23T14:00:00.000Z",
        totals: {},
        positions: [
          {
            id: "U123:12345",
            accountId: "U123",
            accounts: ["U123"],
            symbol: "NVDA",
            assetClass: "Options",
            quantity: 1,
            averageCost: 2,
            mark: null,
            marketValue: 200,
            unrealizedPnl: 0,
            optionContract: {
              ticker: "NVDA260612C00145000",
              underlying: "NVDA",
              expirationDate: "2026-06-12T00:00:00.000Z",
              strike: 145,
              right: "call",
              multiplier: 100,
              sharesPerContract: 100,
              providerContractId: "12345",
            },
            optionQuote: null,
            quote: null,
          },
        ],
      },
    },
  ];
  const queryClient = {
    getQueryCache: () => ({
      findAll: ({ predicate }) => queries.filter(predicate),
    }),
    setQueryData: (queryKey, updater) => {
      const query = queries.find(
        (candidate) => queryKeyText(candidate.queryKey) === queryKeyText(queryKey),
      );
      if (!query) {
        queries.push({
          queryKey,
          data: typeof updater === "function" ? updater(undefined) : updater,
        });
        return;
      }
      query.data = typeof updater === "function" ? updater(query.data) : updater;
    },
  };
  const livePosition = {
    ...queries[0].data.positions[0],
    mark: 2.45,
    marketValue: 245,
    unrealizedPnl: 45,
    optionQuote: {
      providerContractId: "12345",
      bid: 2.4,
      ask: 2.5,
      mark: 2.45,
      quoteStatus: "live",
    },
    quote: {
      bid: 2.4,
      ask: 2.5,
      mark: 2.45,
      quoteStatus: "live",
    },
  };

  applyAccountPageLivePayloadToCache(queryClient, {
    stream: "account-page-live",
    accountId: "U123",
    mode: "live",
    orderTab: "working",
    assetClass: "all",
    updatedAt: "2026-06-23T14:01:00.000Z",
    summary: {},
    intradayEquity: {},
    allocation: {},
    positions: {
      accountId: "U123",
      currency: "USD",
      updatedAt: "2026-06-23T14:01:00.000Z",
      totals: {},
      positions: [livePosition],
    },
    orders: { orders: [] },
    risk: {},
  });

  assert.equal(queries[0].data.positions[0].quote.bid, 2.4);
  assert.equal(queries[0].data.positions[0].quote.ask, 2.5);
  assert.equal(queries[0].data.positions[0].optionQuote.bid, 2.4);
});

test("shared option quote stream demand unions visible hook subscriptions", () => {
  const demand =
    __liveStreamsInternalsForTests.resolveSharedOptionQuoteStreamDemand([
      {
        underlying: "NVDA",
        providerContractIds: ["101", "102"],
        owner: "visible-nvda",
        intent: "visible-live",
        requiresGreeks: false,
      },
      {
        underlying: "NVDA",
        providerContractIds: ["102", "201"],
        owner: "visible-nvda-depth",
        intent: "visible-live",
        requiresGreeks: true,
      },
    ]);

  assert.deepEqual(demand.providerContractIds, ["101", "102", "201"]);
  assert.equal(demand.underlying, "NVDA");
  assert.equal(demand.owner, "shared-option-quotes:3-contracts");
  assert.equal(demand.intent, "visible-live");
  assert.equal(demand.requiresGreeks, true);
});

test("shared option quote sockets are limited to visible chain demand", () => {
  assert.equal(
    __liveStreamsInternalsForTests.shouldUseSharedOptionQuoteStream("visible-live"),
    true,
  );
  assert.equal(
    __liveStreamsInternalsForTests.shouldUseSharedOptionQuoteStream("execution-live"),
    false,
  );
  assert.equal(
    __liveStreamsInternalsForTests.shouldUseSharedOptionQuoteStream(
      "account-monitor-live",
    ),
    false,
  );
  assert.equal(
    __liveStreamsInternalsForTests.shouldUseSharedOptionQuoteStream("automation-live"),
    false,
  );
});

test("account option quote REST fallback retries and re-upgrades to WebSocket", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");
  const hook = source.match(
    /export const useIbkrOptionQuoteStream = \([\s\S]*?\n};\n\nexport const __liveStreamsInternalsForTests/,
  )?.[0];

  assert.ok(hook, "expected the account option quote stream hook");
  assert.match(hook, /const scheduleWebSocketReconnect = \(\) => \{/);
  assert.match(
    hook,
    /const fallbackToRest = \(\) => \{[\s\S]*?startRestFallback\(\);[\s\S]*?scheduleWebSocketReconnect\(\);[\s\S]*?\};/,
  );
  assert.match(
    hook,
    /if \(payload\.type === "ready"\) \{[\s\S]*?ready = true;[\s\S]*?stopRestFallback\(\);/,
  );
});

test("signal matrix stream url omits requestOrigin (backend rejects unknown origins with 400)", () => {
  const url = getSignalMonitorMatrixStreamUrl({
    environment: "shadow",
    symbols: ["AAPL", "MSFT"],
    timeframes: ["1d"],
  });

  assert.ok(url, "expected a stream url for non-empty symbols");
  const params = new URLSearchParams(url.split("?")[1]);
  // The backend StreamSignalMonitorMatrixQueryParams enum only accepts
  // startup|poll|manual|test; sending anything else (or the old
  // "signal-matrix-stream") is a hard 400. Omitting it keeps the request valid
  // and avoids foreground-leader exact-cell work.
  assert.equal(params.has("requestOrigin"), false);
  assert.equal(params.get("symbols"), "AAPL,MSFT");
  assert.equal(params.get("timeframes"), "1d");
});

test("signal matrix stream url is null when no symbols are supplied", () => {
  assert.equal(getSignalMonitorMatrixStreamUrl({ symbols: [] }), null);
  assert.equal(getSignalMonitorMatrixStreamUrl({ symbols: ["", "  "] }), null);
});

test("signal matrix stream url can request the server profile universe", () => {
  const url = getSignalMonitorMatrixStreamUrl({
    environment: "shadow",
    symbols: [],
    timeframes: ["1m"],
    profileUniverse: true,
  });

  assert.ok(url, "expected a profile-universe stream url without symbols");
  const params = new URLSearchParams(url.split("?")[1]);
  assert.equal(params.get("environment"), "shadow");
  assert.equal(params.get("universe"), "profile");
  assert.equal(params.get("timeframes"), "1m");
  assert.equal(params.has("symbols"), false);
});

test("signal matrix stream forwards payload metadata with states", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /onStatesRef\.current\(payload\.states, kind, payload\)/,
  );
});

test("signal matrix stream terminal reconnect creates a fresh EventSource bootstrap", () => {
  const source = readFileSync(new URL("./live-streams.ts", import.meta.url), "utf8");

  assert.match(source, /const connect = \(\) => \{/);
  assert.match(source, /const next = new EventSource\(streamUrl\)/);
  assert.match(source, /next\.addEventListener\("bootstrap", handleBootstrap as EventListener\)/);
  assert.match(source, /nextQuoteStreamReconnectDelayMs\(reconnectAttempt\)/);
  assert.match(source, /connect\(\);/);
});
