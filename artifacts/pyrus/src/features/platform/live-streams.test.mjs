import assert from "node:assert/strict";
import test from "node:test";

import { __liveStreamsInternalsForTests } from "./live-streams.ts";

const queryKeyText = (key) => JSON.stringify(key);

test("algo cockpit stream keeps known deployments when fallback is unavailable", () => {
  const current = {
    deployments: [
      {
        id: "dep-1",
        name: "Pyrus Signals Options Shadow Paper",
        mode: "paper",
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
    mode: "paper",
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
    mode: "paper",
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
  assert.match(providerContractIds[0], /^twsopt:/);
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
      ["/api/accounts/U123/positions", { mode: "paper", assetClass: "all" }],
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

test("account page positions query keys request live quote hydration", () => {
  assert.equal(
    __liveStreamsInternalsForTests.primaryAccountPositionsUseLiveQuotes({
      accountId: "U123",
    }),
    true,
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
      liveQuotes: true,
    },
  );
});

test("shared option quote stream demand unions active hook subscriptions", () => {
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
        underlying: "TSLA",
        providerContractIds: ["102", "201"],
        owner: "execution-tsla",
        intent: "execution-live",
        requiresGreeks: true,
      },
    ]);

  assert.deepEqual(demand.providerContractIds, ["101", "102", "201"]);
  assert.equal(demand.underlying, null);
  assert.equal(demand.owner, "shared-option-quotes:3-contracts");
  assert.equal(demand.intent, "execution-live");
  assert.equal(demand.requiresGreeks, true);
});
