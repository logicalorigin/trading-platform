import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getListAlgoDeploymentsQueryKey } from "@workspace/api-client-react";

import {
  __liveStreamsInternalsForTests,
  applyAccountPageDerivedPayloadToCache,
  applyAccountPageLivePayloadToCache,
  getAccountPerformanceCalendarEquityQueryKey,
  getAccountPageStreamUrl,
  getSignalMonitorMatrixStreamUrl,
  getStoredOptionQuoteSnapshot,
  isQuoteSnapshotAtLeastAsFresh,
  patchAccountPositionsFromOptionQuotes,
} from "./live-streams.ts";

test("account page stream URLs carry only explicit deferred-work demand", () => {
  const url = getAccountPageStreamUrl({
    accountId: "combined",
    mode: "live",
    includeIntraday: true,
    includeWorkingOrders: false,
    includeSetupHealth: true,
    includeSpyBenchmark: true,
    includeQqqBenchmark: false,
  });

  assert.match(url, /includeIntraday=1/);
  assert.doesNotMatch(url, /includeWorkingOrders/);
  assert.match(url, /includeSetupHealth=1/);
  assert.match(url, /includeSpyBenchmark=1/);
  assert.doesNotMatch(url, /includeQqqBenchmark/);
  assert.doesNotMatch(url, /orderTab/);
});

test("account page client listens only to emitted stream lanes", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );
  const accountStreamStart = source.indexOf("type AccountPageLivePayload");
  const accountStreamEnd = source.indexOf("type SignalMatrixStreamState");
  const accountStreamSource = source.slice(accountStreamStart, accountStreamEnd);

  assert.doesNotMatch(accountStreamSource, /AccountPageBootstrapPayload/);
  assert.doesNotMatch(accountStreamSource, /account-page-bootstrap/);
  assert.doesNotMatch(accountStreamSource, /applyAccountPagePayloadToCache/);
  assert.doesNotMatch(accountStreamSource, /kind: "bootstrap"/);
  assert.doesNotMatch(accountStreamSource, /orderTab:/);
});

const queryKeyText = (key) => JSON.stringify(key);

test("quote stream payload validation rejects malformed arrays", () => {
  const { isQuoteStreamPayload } = __liveStreamsInternalsForTests;

  assert.equal(isQuoteStreamPayload({ quotes: [] }), true);
  assert.equal(isQuoteStreamPayload({ quotes: [{ symbol: "AAPL" }] }), true);
  assert.equal(isQuoteStreamPayload({ quotes: "AAPL" }), false);
  assert.equal(isQuoteStreamPayload({ quotes: [null] }), false);
  assert.equal(isQuoteStreamPayload(null), false);
});

test("quote stream reports unavailable coverage before reconnecting", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const useQuoteSnapshotStream");
  const end = source.indexOf("export const useIbkrQuoteSnapshotStream", start);
  assert.notEqual(start, -1, "Missing quote stream hook");
  assert.notEqual(end, -1, "Missing quote stream hook end");
  const hook = source.slice(start, end);
  const quotesHandler = hook.match(
    /const handleQuotes = \(event:[\s\S]*?\n    };/,
  )?.[0];

  assert.match(hook, /onUnavailable\?: \(\) => void/);
  assert.match(hook, /const onUnavailableRef = useRef\(onUnavailable\)/);
  assert.ok(quotesHandler, "Missing quote frame handler");
  assert.match(quotesHandler, /if \(!isQuoteStreamPayload\(payload\)\)/);
  assert.ok(
    quotesHandler.indexOf("isQuoteStreamPayload") <
      quotesHandler.indexOf("markStreamActivity()"),
    "malformed quote frames must not refresh stream activity",
  );
  assert.ok(
    (hook.match(/onUnavailableRef\.current\?\.\(\)/g) || []).length >= 3,
    "malformed frames, transport errors, and visible stalls must clear coverage",
  );
});

const createAccountPageQueryClient = () => {
  const queries = [];
  return {
    queries,
    getQueryCache: () => ({
      findAll: ({ predicate, queryKey } = {}) =>
        queries.filter((query) => {
          if (predicate) return predicate(query);
          if (!queryKey) return true;
          return (
            queryKeyText(query.queryKey.slice(0, queryKey.length)) ===
            queryKeyText(queryKey)
          );
        }),
    }),
    invalidateQueries: () => undefined,
    removeQueries: () => undefined,
    getQueryData: (queryKey) =>
      queries.find(
        (query) => queryKeyText(query.queryKey) === queryKeyText(queryKey),
      )?.data,
    setQueryData: (queryKey, updater) => {
      const current = queries.find(
        (query) => queryKeyText(query.queryKey) === queryKeyText(queryKey),
      );
      const data =
        typeof updater === "function" ? updater(current?.data) : updater;
      if (current) {
        current.data = data;
      } else {
        queries.push({ queryKey, data });
      }
    },
  };
};

const createAuthorityTestQueryClient = () => {
  const client = createAccountPageQueryClient();
  client.removeQueries = ({ queryKey }) => {
    const index = client.queries.findIndex(
      (query) => queryKeyText(query.queryKey) === queryKeyText(queryKey),
    );
    if (index >= 0) client.queries.splice(index, 1);
  };
  return client;
};

const readAuthorityTestQuery = (queryClient, queryKey) =>
  queryClient.queries.find(
    (query) => queryKeyText(query.queryKey) === queryKeyText(queryKey),
  )?.data;

const accountPageLiveNavPayload = (timestamp, netLiquidation) => ({
  stream: "account-page-live",
  accountId: "U123",
  mode: "live",
  orderTab: "working",
  assetClass: "all",
  updatedAt: timestamp,
  summary: {
    currency: "USD",
    updatedAt: timestamp,
    metrics: {
      netLiquidation: {
        value: netLiquidation,
        currency: "USD",
        source: "IBKR_ACCOUNT_SUMMARY",
        updatedAt: timestamp,
      },
    },
  },
  intradayEquity: {},
  allocation: {},
  positions: { positions: [], totals: {} },
  orders: { orders: [] },
  risk: {},
});

const accountPageDerivedCalendarPayload = (updatedAt, points) => ({
  stream: "account-page-derived",
  accountId: "U123",
  mode: "live",
  range: "1Y",
  tradeFilters: {},
  performanceCalendarFrom: null,
  updatedAt,
  equityHistory: { accountId: "U123", range: "1Y", points: [] },
  benchmarkEquityHistory: {},
  performanceCalendarEquity: {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    asOf: points.at(-1)?.timestamp ?? null,
    terminalPointSource: "live_account_summary",
    liveTerminalIncluded: points.length > 0,
    points,
  },
  performanceCalendarTrades: { trades: [] },
  closedTrades: { trades: [] },
  cashActivity: { activities: [] },
  flexHealth: null,
});

test("broker stream freshness tolerates normal SSE jitter under load", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const ACCOUNT_STREAM_FRESH_MS = 20_000;/);
  assert.doesNotMatch(source, /const ACCOUNT_STREAM_FRESH_MS = 7_000;/);
});

test("account and algo event timestamps stay out of React freshness state", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );
  const accountFreshnessState = source.match(
    /export const useAccountPageSnapshotStream[\s\S]*?const \[freshness, setFreshness\][\s\S]*?const streamUrl = useMemo/u,
  )?.[0];
  const algoFreshnessState = source.match(
    /export const useAlgoCockpitStream[\s\S]*?const \[freshness, setFreshness\][\s\S]*?const onLiveEventsRef = useRef/u,
  )?.[0];

  assert.ok(accountFreshnessState, "Missing account-page freshness state");
  assert.ok(algoFreshnessState, "Missing algo-cockpit freshness state");
  assert.doesNotMatch(accountFreshnessState, /accountLastEventAt:/);
  assert.doesNotMatch(algoFreshnessState, /algoLastEventAt:/);
});

test("account page streams fail over on transport errors after a bounded boot grace", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );
  const hook = source.match(
    /export const useAccountPageSnapshotStream[\s\S]*?\n};\n\ntype SignalMatrixStreamState/,
  )?.[0];

  assert.ok(hook, "Missing account-page snapshot stream hook");
  assert.match(source, /ACCOUNT_PAGE_STREAM_BOOT_GRACE_MS = 2_500/);
  assert.match(hook, /const handleError = \(\) =>/);
  assert.match(hook, /source\.addEventListener\("error", handleError/);
  assert.match(hook, /setAccountBootstrapping\(false\)/);
  assert.match(hook, /return \{ \.\.\.freshness, accountBootstrapping \}/);
});

test("shadow account consumers subscribe to a stable freshness flag token", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );
  const shadowHook = source.match(
    /export const useShadowAccountSnapshotStream[\s\S]*?\n};/,
  )?.[0];

  assert.ok(shadowHook, "Missing shadow account snapshot stream");
  assert.match(
    source,
    /const getShadowAccountStreamFreshnessStatusToken = \(\) =>/,
  );
  assert.match(
    source,
    /export const useShadowAccountStreamFreshnessStatus = /,
  );
  assert.match(
    shadowHook,
    /useShadowAccountStreamFreshnessStatus\(enabled\)/,
  );
  assert.doesNotMatch(
    shadowHook,
    /useShadowAccountStreamFreshnessSnapshot\(enabled\)/,
  );
});

test("stream freshness uses one exact global expiry timer, not one interval per subscriber", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );
  const { nextFreshnessExpiryDelayMs } = __liveStreamsInternalsForTests;

  assert.equal(
    nextFreshnessExpiryDelayMs([null, null], 5_000, 20_000),
    null,
  );
  assert.equal(
    nextFreshnessExpiryDelayMs([4_000], 5_000, 20_000),
    19_001,
  );
  assert.equal(
    nextFreshnessExpiryDelayMs([1_000, 4_000], 5_000, 20_000),
    16_001,
  );
  assert.doesNotMatch(
    source,
    /setInterval\(emitBrokerStreamFreshness,\s*1_000\)/,
  );
  assert.doesNotMatch(
    source,
    /setInterval\(emitShadowAccountStreamFreshness,\s*1_000\)/,
  );
});

test("account position cache merge rejects retired activity degradation metadata", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /activityDegraded/);
  assert.match(source, /isDegradedAccountResponse/);
});

test("option quote patch preserves a shadow prior-day position's backend day change", () => {
  const { patchAccountPositionRowFromOptionQuote } =
    __liveStreamsInternalsForTests;
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

test("a no-target shadow algo payload cannot mutate canonical deployments", () => {
  const queryClient = createAccountPageQueryClient();
  const canonical = {
    deployments: [
      {
        id: "dep-shadow",
        name: "Pyrus Signals Options Shadow",
        mode: "shadow",
      },
    ],
  };
  const inventoryKey = getListAlgoDeploymentsQueryKey();
  queryClient.setQueryData(inventoryKey, canonical);

  __liveStreamsInternalsForTests.applyAlgoCockpitPayloadToCache(queryClient, {
    phase: "primary",
    mode: "shadow",
    deploymentId: null,
    deployments: { deployments: [] },
    events: { events: [] },
  });

  assert.deepEqual(
    queryClient.queries.find(
      (query) => queryKeyText(query.queryKey) === queryKeyText(inventoryKey),
    )?.data,
    canonical,
  );
});

test("a no-target live algo payload cannot mutate canonical deployments", () => {
  const queryClient = createAccountPageQueryClient();
  const canonical = {
    deployments: [
      { id: "dep-shadow", name: "Shadow", mode: "shadow" },
      { id: "dep-live", name: "Live", mode: "live" },
    ],
  };
  const inventoryKey = getListAlgoDeploymentsQueryKey();
  queryClient.setQueryData(inventoryKey, canonical);

  __liveStreamsInternalsForTests.applyAlgoCockpitPayloadToCache(queryClient, {
    phase: "primary",
    mode: "live",
    deploymentId: null,
    deployments: { deployments: [] },
    events: { events: [] },
  });

  assert.deepEqual(
    queryClient.queries.find(
      (query) => queryKeyText(query.queryKey) === queryKeyText(inventoryKey),
    )?.data,
    canonical,
  );
});

test("targeted algo cockpit payloads cannot mutate REST-owned deployment inventory", () => {
  const inventoryKey = getListAlgoDeploymentsQueryKey();

  for (const phase of ["primary", "full"]) {
    const queryClient = createAccountPageQueryClient();
    const canonical = {
      deployments: [
        { id: "dep-shadow", name: "Canonical shadow", mode: "shadow" },
        { id: "dep-live", name: "Canonical live", mode: "live" },
      ],
      pnlByDeployment: {
        "dep-shadow": { todayPnl: 1 },
        "dep-live": { todayPnl: 2 },
      },
    };
    queryClient.setQueryData(inventoryKey, canonical);

    __liveStreamsInternalsForTests.applyAlgoCockpitPayloadToCache(queryClient, {
      phase,
      mode: "shadow",
      deploymentId: "dep-shadow",
      deployments: {
        deployments: [
          { id: "dep-shadow", name: "Stream shadow", mode: "shadow" },
          { id: "dep-live", name: "Stream live", mode: "live" },
        ],
        pnlByDeployment: {
          "dep-shadow": { todayPnl: 3 },
          "dep-live": { todayPnl: -1 },
        },
      },
      events: { events: [] },
    });

    assert.strictEqual(queryClient.getQueryData(inventoryKey), canonical, phase);
  }
});

test("a targeted algo cockpit payload cannot create deployment inventory before REST", () => {
  const queryClient = createAccountPageQueryClient();
  const inventoryKey = getListAlgoDeploymentsQueryKey();

  __liveStreamsInternalsForTests.applyAlgoCockpitPayloadToCache(queryClient, {
    phase: "primary",
    mode: "shadow",
    deploymentId: "dep-shadow",
    deployments: {
      deployments: [
        { id: "dep-shadow", name: "Stream shadow", mode: "shadow" },
      ],
    },
    events: { events: [] },
  });

  assert.equal(queryClient.getQueryData(inventoryKey), undefined);
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

  assert.equal(
    calls.some((call) => queryKeyText(call.key).includes("/algo/deployments")),
    false,
  );
  assert.ok(
    calls.some((call) => queryKeyText(call.key).includes("/algo/events")),
  );
  assert.equal(
    calls.some((call) =>
      queryKeyText(call.key).includes("/signal-options/state"),
    ),
    false,
  );
  assert.equal(
    calls.some((call) => queryKeyText(call.key).includes("/cockpit")),
    false,
  );
  assert.equal(
    calls.some((call) =>
      queryKeyText(call.key).includes("/signal-options/performance"),
    ),
    false,
  );
  assert.equal(
    calls.some((call) =>
      queryKeyText(call.key).includes("/signal-monitor/profile"),
    ),
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
    calls.some((call) =>
      queryKeyText(call.key).includes("/signal-options/state"),
    ),
  );
  assert.ok(calls.some((call) => queryKeyText(call.key).includes("/cockpit")));
  assert.ok(
    calls.some((call) =>
      queryKeyText(call.key).includes("/signal-options/performance"),
    ),
  );
  assert.ok(
    calls.some((call) =>
      queryKeyText(call.key).includes("/signal-monitor/profile"),
    ),
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

test("account option quote cache follows intrinsic value when AAP's NBBO midpoint is impossible", () => {
  const row = {
    id: "shadow:AAP-call",
    accountId: "shadow",
    accounts: ["shadow"],
    symbol: "AAP",
    assetClass: "Options",
    quantity: 7,
    averageCost: 1.94,
    mark: 3.9,
    dayChange: 1_365,
    dayChangePercent: 100,
    unrealizedPnl: 1_372,
    unrealizedPnlPercent: 101.03,
    marketValue: 2_730,
    optionContract: {
      ticker: "O:AAP260724C00051000",
      underlying: "AAP",
      expirationDate: "2026-07-24T00:00:00.000Z",
      strike: 51,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "O:AAP260724C00051000",
    },
    optionQuote: null,
    quote: null,
  };

  const patched =
    __liveStreamsInternalsForTests.patchAccountPositionRowFromOptionQuote(row, {
      symbol: "AAP",
      providerContractId: "O:AAP260724C00051000",
      price: 3.9,
      mark: 3.9,
      bid: 3,
      ask: 4.8,
      bidSize: 273,
      askSize: 13,
      underlyingPrice: 55.48,
      freshness: "live",
      marketDataMode: "live",
      updatedAt: "2026-07-21T19:35:30.206Z",
    });

  assert.equal(patched.optionQuote.bid, 3);
  assert.equal(patched.optionQuote.ask, 4.8);
  assert.equal(patched.optionQuote.bidSize, 273);
  assert.equal(patched.optionQuote.askSize, 13);
  assert.ok(Math.abs(patched.mark - 4.48) < 1e-9);
  assert.ok(Math.abs(patched.marketValue - 3_136) < 1e-9);
});

test("account option quote cache patch signs prior-day short Day percent and uses prior close", () => {
  const row = {
    id: "U123:12345",
    accountId: "U123",
    accounts: ["U123"],
    symbol: "NVDA",
    assetClass: "Options",
    quantity: -2,
    averageCost: 5,
    mark: 4,
    dayChange: 0,
    dayChangePercent: 0,
    unrealizedPnl: 200,
    unrealizedPnlPercent: 20,
    marketValue: -800,
    openedAt: "2026-06-05T14:30:00.000Z",
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
      price: 4.2,
      mark: 4.2,
      bid: 4.15,
      ask: 4.25,
      prevClose: 4,
      dayChange: 0.1,
      dayChangePercent: 2.5,
      updatedAt: new Date().toISOString(),
    });

  assert.ok(Math.abs(patched.dayChange - -40) < 1e-9);
  assert.ok(Math.abs(patched.dayChangePercent - -5) < 1e-9);
  assert.ok(Math.abs(patched.optionQuote.dayChangePercent - 5) < 1e-9);
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

test("Robinhood UUID option rows do not synthesize standard OPRA aliases", () => {
  const providerContractId = "8f0e870f-9e58-4cf8-89c5-baba00000001";
  const row = {
    providerSecurityType: "robinhood_option",
    optionContract: {
      ticker: "BABA260717C00115000",
      underlying: "BABA",
      expirationDate: "2026-07-17T00:00:00.000Z",
      strike: 115,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId,
    },
  };

  assert.deepEqual(
    __liveStreamsInternalsForTests.optionPositionProviderContractIds(row),
    [providerContractId],
  );
});

test("account option quote cache preserves Robinhood UUID rows from mismatched standard quotes", () => {
  const providerContractId = "8f0e870f-9e58-4cf8-89c5-baba00000001";
  const row = {
    id: `robinhood:account-1:option:${providerContractId}`,
    accountId: "account-1",
    accounts: ["account-1"],
    symbol: "BABA",
    assetClass: "Options",
    providerSecurityType: "robinhood_option",
    quantity: 5,
    averageCost: 6.6,
    mark: 7.8,
    dayChange: 100,
    dayChangePercent: 2.5,
    unrealizedPnl: 600,
    unrealizedPnlPercent: (600 / 3_300) * 100,
    marketValue: 3_900,
    openedAt: "2026-07-10T14:30:00.000Z",
    optionContract: {
      ticker: "BABA260717C00115000",
      underlying: "BABA",
      expirationDate: "2026-07-17T00:00:00.000Z",
      strike: 115,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId,
    },
    optionQuote: {
      providerContractId,
      bid: 7.7,
      ask: 7.9,
      mark: 7.8,
      updatedAt: "2026-07-15T17:00:00.000Z",
    },
    quote: {
      providerContractId,
      bid: 7.7,
      ask: 7.9,
      mark: 7.8,
      updatedAt: "2026-07-15T17:00:00.000Z",
    },
  };
  const current = {
    accountId: "account-1",
    currency: "USD",
    updatedAt: "2026-07-15T17:00:00.000Z",
    positions: [row],
    totals: {
      weightPercent: 0,
      unrealizedPnl: 600,
      grossLong: 3_900,
      grossShort: 0,
      netExposure: 3_900,
      cash: 100,
      totalCash: 100,
      buyingPower: 100,
      netLiquidation: 4_000,
    },
  };

  const patched = patchAccountPositionsFromOptionQuotes(current, [
    {
      symbol: "BABA",
      providerContractId: "O:BABA260717C00115000",
      price: 8.4,
      bid: 8.3,
      ask: 8.5,
      updatedAt: "2026-07-15T17:01:00.000Z",
      source: "massive",
    },
  ]);

  assert.strictEqual(patched, current);
  assert.strictEqual(patched.positions[0], row);
  assert.equal(patched.positions[0].mark, 7.8);
  assert.equal(patched.positions[0].marketValue, 3_900);
  assert.equal(patched.positions[0].unrealizedPnl, 600);
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
  assert.equal(
    patched.positions[0].dayChange,
    patched.positions[0].unrealizedPnl,
  );
  assert.equal(
    patched.positions[0].dayChangePercent,
    patched.positions[0].unrealizedPnlPercent,
  );
  assert.equal(
    patched.totals.unrealizedPnl,
    patched.positions[0].unrealizedPnl,
  );
});

test("account snapshot stream signs prior-day short option Day percent", () => {
  const priorDay = "2026-06-05T14:30:00.000Z";
  const optionContract = {
    ticker: "NVDA260612C00145000",
    underlying: "NVDA",
    expirationDate: "2026-06-12T00:00:00.000Z",
    strike: 145,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: "12345",
  };
  const currentRow = {
    id: "U123:12345",
    accountId: "U123",
    accounts: ["U123"],
    symbol: "NVDA",
    assetClass: "Options",
    quantity: -2,
    averageCost: 5,
    mark: 4,
    dayChange: 0,
    dayChangePercent: 0,
    unrealizedPnl: 200,
    unrealizedPnlPercent: 20,
    marketValue: -800,
    weightPercent: -8,
    openedAt: priorDay,
    optionContract,
  };
  const patched =
    __liveStreamsInternalsForTests.patchAccountPositionsFromStream(
      {
        accountId: "U123",
        currency: "USD",
        updatedAt: priorDay,
        totals: {
          weightPercent: -8,
          unrealizedPnl: 200,
          grossLong: 0,
          grossShort: 800,
          netExposure: -800,
          cash: 2_000,
          totalCash: 2_000,
          buyingPower: 2_000,
          netLiquidation: 1_200,
        },
        positions: [currentRow],
      },
      {
        accounts: [
          {
            id: "U123",
            providerAccountId: "U123",
            currency: "USD",
            cash: 2_000,
            buyingPower: 2_000,
            netLiquidation: 1_160,
            updatedAt: new Date().toISOString(),
          },
        ],
        positions: [
          {
            id: "U123:12345",
            accountId: "U123",
            symbol: "NVDA",
            assetClass: "option",
            quantity: -2,
            averagePrice: 5,
            marketPrice: 4.2,
            marketValue: -840,
            unrealizedPnl: 160,
            unrealizedPnlPercent: 16,
            openedAt: priorDay,
            optionContract,
            quote: {
              dayChange: 0.1,
              dayChangePercent: 2.5,
              prevClose: 4,
            },
          },
        ],
      },
      "U123",
      ["/api/accounts/U123/positions", { mode: "shadow", assetClass: "all" }],
    );

  assert.ok(Math.abs(patched.positions[0].dayChange - -40) < 1e-9);
  assert.ok(Math.abs(patched.positions[0].dayChangePercent - -5) < 1e-9);
});

test("quote-less broker snapshots retain cached prior-day Day PnL once per row", () => {
  const priorDay = "2026-06-05T14:30:00.000Z";
  const account = (id) => ({
    id,
    providerAccountId: id,
    currency: "USD",
    cash: 1_000,
    buyingPower: 1_000,
    netLiquidation: 2_000,
    updatedAt: "2026-07-21T14:00:00.000Z",
  });
  const streamPosition = (accountId) => ({
    id: `${accountId}:AAPL`,
    accountId,
    symbol: "AAPL",
    assetClass: "stock",
    quantity: 1,
    averagePrice: 100,
    marketPrice: 110,
    marketValue: 110,
    unrealizedPnl: 10,
    unrealizedPnlPercent: 10,
    openedAt: priorDay,
    optionContract: null,
  });
  const cachedRow = {
    id: "U1:AAPL",
    accountId: "U1",
    accounts: ["U1"],
    symbol: "AAPL",
    assetClass: "Stocks",
    positionType: "stock",
    quantity: 1,
    averageCost: 100,
    mark: 109,
    dayChange: 4,
    dayChangePercent: 3.81,
    unrealizedPnl: 9,
    unrealizedPnlPercent: 9,
    marketValue: 109,
    openedAt: priorDay,
  };
  const current = {
    accountId: "U1",
    currency: "USD",
    updatedAt: "2026-07-21T13:59:00.000Z",
    totals: {},
    positions: [cachedRow],
  };

  const scoped = __liveStreamsInternalsForTests.patchAccountPositionsFromStream(
    current,
    { accounts: [account("U1")], positions: [streamPosition("U1")] },
    "U1",
    ["/api/accounts/U1/positions", { mode: "live", assetClass: "all" }],
  );

  assert.equal(scoped.positions[0].dayChange, 4);
  assert.equal(scoped.positions[0].dayChangePercent, 3.81);

  const combined =
    __liveStreamsInternalsForTests.patchAccountPositionsFromStream(
      {
        ...current,
        accountId: "combined",
        positions: [
          {
            ...cachedRow,
            id: "equity:AAPL",
            accountId: "combined",
            accounts: ["U1", "U2"],
            quantity: 2,
            marketValue: 218,
            unrealizedPnl: 18,
          },
        ],
      },
      {
        accounts: [account("U1"), account("U2")],
        positions: [streamPosition("U1"), streamPosition("U2")],
      },
      "combined",
      [
        "/api/accounts/combined/positions",
        { mode: "live", assetClass: "all" },
      ],
    );

  assert.equal(combined.positions[0].dayChange, 4);
  assert.equal(combined.positions[0].dayChangePercent, 3.81);
});

test("combined stream rows divide summed PnL by summed cost basis", () => {
  const openedAt = new Date().toISOString();
  const optionContract = {
    ticker: "NVDA260612C00145000",
    underlying: "NVDA",
    expirationDate: "2026-06-12T00:00:00.000Z",
    strike: 145,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: "12345",
  };
  const patched =
    __liveStreamsInternalsForTests.patchAccountPositionsFromStream(
      undefined,
      {
        accounts: [
          {
            id: "U1",
            providerAccountId: "U1",
            currency: "USD",
            cash: 1_000,
            buyingPower: 1_000,
            netLiquidation: 5_000,
            updatedAt: openedAt,
          },
          {
            id: "U2",
            providerAccountId: "U2",
            currency: "USD",
            cash: 1_000,
            buyingPower: 1_000,
            netLiquidation: 5_000,
            updatedAt: openedAt,
          },
        ],
        positions: [
          {
            id: "U1:12345",
            accountId: "U1",
            symbol: "NVDA",
            assetClass: "option",
            quantity: 1,
            averagePrice: 10,
            marketPrice: 12,
            marketValue: 1_200,
            unrealizedPnl: 200,
            unrealizedPnlPercent: 20,
            openedAt,
            optionContract,
            quote: null,
          },
          {
            id: "U2:12345",
            accountId: "U2",
            symbol: "NVDA",
            assetClass: "option",
            quantity: 1,
            averagePrice: 11,
            marketPrice: 12,
            marketValue: 1_200,
            unrealizedPnl: 100,
            unrealizedPnlPercent: 100 / 11,
            openedAt,
            optionContract,
            quote: null,
          },
        ],
      },
      "combined",
      [
        "/api/accounts/combined/positions",
        { mode: "shadow", assetClass: "all" },
      ],
    );

  assert.equal(patched.positions.length, 1);
  assert.ok(
    Math.abs(patched.positions[0].unrealizedPnlPercent - (300 / 2_100) * 100) <
      1e-9,
  );
  assert.ok(
    Math.abs(patched.positions[0].dayChangePercent - (300 / 2_100) * 100) <
      1e-9,
  );
});

test("account page payload merge preserves cached execution metadata and live option quote", () => {
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
  assert.equal(merged.optionQuote.bid, 2.4);
  assert.equal(merged.optionQuote.ask, 2.5);
  assert.equal(merged.mark, 2.45);
  assert.ok(Math.abs(merged.marketValue - 245) < 1e-9);
  assert.ok(Math.abs(merged.unrealizedPnl - 45) < 1e-9);
  assert.ok(Math.abs(merged.dayChange - 45) < 1e-9);
  assert.ok(Math.abs(merged.dayChangePercent - 22.5) < 1e-9);

  const [unavailableBackendMerged] =
    __liveStreamsInternalsForTests.mergeAccountPositionRowsById(
      [current],
      [
        {
          ...incoming,
          optionQuote: {
            providerContractId: structuredProviderContractId,
            bid: null,
            ask: null,
            mark: null,
            updatedAt: null,
            quoteStatus: "unavailable",
            quoteReason: "quote_pending",
          },
        },
      ],
    );

  assert.equal(unavailableBackendMerged.optionQuote.bid, 2.4);
  assert.equal(unavailableBackendMerged.optionQuote.ask, 2.5);
  assert.equal(unavailableBackendMerged.mark, 2.45);
  assert.ok(Math.abs(unavailableBackendMerged.marketValue - 245) < 1e-9);

  const newerBrokerUpdatedAt = new Date(
    Date.parse(openedAt) + 1_000,
  ).toISOString();
  const [newerBrokerMerged] =
    __liveStreamsInternalsForTests.mergeAccountPositionRowsById(
      [current],
      [
        {
          ...incoming,
          mark: 3,
          dayChange: 100,
          dayChangePercent: 50,
          unrealizedPnl: 100,
          unrealizedPnlPercent: 50,
          marketValue: 300,
          quote: {
            mark: 3,
            source: "position_mark",
            updatedAt: newerBrokerUpdatedAt,
          },
        },
      ],
    );

  assert.equal(newerBrokerMerged.optionQuote, null);
  assert.equal(newerBrokerMerged.quote.source, "position_mark");
  assert.equal(newerBrokerMerged.quote.updatedAt, newerBrokerUpdatedAt);
  assert.equal(newerBrokerMerged.mark, 3);
  assert.equal(newerBrokerMerged.marketValue, 300);
  assert.equal(newerBrokerMerged.unrealizedPnl, 100);

  const [futurePoisonMerged] =
    __liveStreamsInternalsForTests.mergeAccountPositionRowsById(
      [
        {
          ...current,
          optionQuote: {
            ...current.optionQuote,
            updatedAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
          },
        },
      ],
      [
        {
          ...incoming,
          quote: {
            mark: 2,
            source: "position_mark",
            updatedAt: openedAt,
          },
        },
      ],
    );

  assert.equal(futurePoisonMerged.optionQuote, null);
  assert.equal(futurePoisonMerged.mark, 2);
  assert.equal(futurePoisonMerged.marketValue, 200);
});

test("broker position stream refuses to replay cached valuation for an unmarked snapshot", () => {
  const current = {
    accountId: "U123",
    currency: "USD",
    updatedAt: "2026-07-10T12:00:00.000Z",
    totals: { netLiquidation: 10_000 },
    positions: [
      {
        id: "U123:AAPL",
        accountId: "U123",
        accounts: ["U123"],
        symbol: "AAPL",
        assetClass: "stock",
        quantity: 10,
        averageCost: 100,
        mark: 150,
        marketValue: 1_500,
        unrealizedPnl: 500,
        unrealizedPnlPercent: 50,
      },
    ],
  };
  const payload = {
    accounts: [
      {
        id: "U123",
        currency: "USD",
        cash: null,
        buyingPower: null,
        netLiquidation: null,
        updatedAt: "2026-07-10T12:01:00.000Z",
      },
    ],
    positions: [
      {
        id: "U123:AAPL",
        accountId: "U123",
        symbol: "AAPL",
        assetClass: "stock",
        quantity: 10,
        averagePrice: 100,
        marketPrice: 100,
        marketValue: 1_000,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
      },
    ],
  };

  assert.equal(
    __liveStreamsInternalsForTests.patchAccountPositionsFromStream(
      current,
      payload,
      "U123",
      ["/api/accounts/U123/positions", { mode: "live" }],
    ),
    undefined,
  );
});

test("fresh broker stream removal evicts scoped Account data instead of retaining it", () => {
  const queries = [
    {
      queryKey: ["/api/accounts/U123/summary", { mode: "live" }],
      data: {
        accountId: "U123",
        metrics: { netLiquidation: { value: 10_000 } },
      },
    },
    {
      queryKey: ["/api/accounts/U123/positions", { mode: "live" }],
      data: { accountId: "U123", positions: [{ id: "old" }] },
    },
  ];
  const queryClient = {
    getQueryCache: () => ({
      findAll: ({ queryKey, predicate }) =>
        queries.filter((query) =>
          predicate
            ? predicate(query)
            : queryKeyText(query.queryKey.slice(0, queryKey.length)) ===
              queryKeyText(queryKey),
        ),
    }),
    setQueryData: () => {},
    removeQueries: ({ queryKey }) => {
      const index = queries.findIndex(
        (query) => queryKeyText(query.queryKey) === queryKeyText(queryKey),
      );
      if (index >= 0) queries.splice(index, 1);
    },
    invalidateQueries: () => Promise.resolve(),
  };

  __liveStreamsInternalsForTests.applyIbkrAccountPayloadToCache(
    queryClient,
    { accounts: [], positions: [] },
    { mode: "live" },
  );

  assert.deepEqual(queries, []);
});

test("IBKR account frames preserve provider-backed inventory and scoped caches", () => {
  const queryClient = createAuthorityTestQueryClient();
  const inventoryKey = ["/api/accounts", { mode: "live" }];
  const snapTradeSummaryKey = [
    "/api/accounts/snap-1/summary",
    { mode: "live" },
  ];
  const combinedPositionsKey = [
    "/api/accounts/combined/positions",
    { mode: "live", detail: "fast", liveQuotes: true },
  ];
  const legacySnapPositionsKey = [
    "/api/positions",
    { accountId: "snap-1", mode: "live" },
  ];
  const legacyCombinedPositionsKey = ["/api/positions", { mode: "live" }];
  const ibkrAccount = {
    id: "U123",
    providerAccountId: "U123",
    provider: "ibkr",
    mode: "live",
    displayName: "IBKR",
    currency: "USD",
    cash: 100,
    buyingPower: 200,
    netLiquidation: 300,
    updatedAt: "2026-07-16T12:00:00.000Z",
  };
  const snapTradeAccount = {
    id: "snap-1",
    providerAccountId: "provider-1",
    provider: "snaptrade",
    mode: "live",
    displayName: "SnapTrade",
    currency: "USD",
    cash: 400,
    buyingPower: 500,
    netLiquidation: 600,
    updatedAt: "2026-07-16T12:00:00.000Z",
  };
  const snapTradeSummary = { accountId: "snap-1", marker: "canonical" };
  const combinedPositions = {
    accountId: "combined",
    positions: [{ id: "snap-position", accountId: "snap-1" }],
    totals: {},
  };
  const legacySnapPositions = {
    positions: [{ id: "snap-position", accountId: "snap-1" }],
  };
  const legacyCombinedPositions = {
    positions: [
      { id: "U123:AAPL", accountId: "U123" },
      { id: "snap-position", accountId: "snap-1" },
    ],
  };
  queryClient.setQueryData(inventoryKey, {
    accounts: [ibkrAccount, snapTradeAccount],
  });
  queryClient.setQueryData(snapTradeSummaryKey, snapTradeSummary);
  queryClient.setQueryData(combinedPositionsKey, combinedPositions);
  queryClient.setQueryData(legacySnapPositionsKey, legacySnapPositions);
  queryClient.setQueryData(
    legacyCombinedPositionsKey,
    legacyCombinedPositions,
  );

  __liveStreamsInternalsForTests.applyIbkrAccountPayloadToCache(
    queryClient,
    { accounts: [{ ...ibkrAccount, cash: 150 }], positions: [] },
    { mode: "live" },
  );

  assert.deepEqual(
    readAuthorityTestQuery(queryClient, inventoryKey).accounts.map(
      (account) => [account.id, account.cash],
    ),
    [
      ["U123", 150],
      ["snap-1", 400],
    ],
  );
  assert.equal(
    readAuthorityTestQuery(queryClient, snapTradeSummaryKey),
    snapTradeSummary,
  );
  assert.equal(
    readAuthorityTestQuery(queryClient, combinedPositionsKey),
    combinedPositions,
  );
  assert.equal(
    readAuthorityTestQuery(queryClient, legacySnapPositionsKey),
    legacySnapPositions,
  );
  assert.equal(
    readAuthorityTestQuery(queryClient, legacyCombinedPositionsKey),
    legacyCombinedPositions,
  );
});

test("a scoped IBKR account frame cannot replace sibling or all-account positions", () => {
  const queryClient = createAuthorityTestQueryClient();
  const allPositionsKey = ["/api/positions", { mode: "live" }];
  const siblingPositionsKey = [
    "/api/accounts/U456/positions",
    { mode: "live", detail: "fast", liveQuotes: true },
  ];
  const allPositions = {
    positions: [
      { id: "U123:AAPL", accountId: "U123", quantity: 1 },
      { id: "U456:MSFT", accountId: "U456", quantity: 2 },
    ],
  };
  const siblingPositions = {
    accountId: "U456",
    positions: [{ id: "U456:MSFT", accountId: "U456", quantity: 2 }],
    totals: {},
  };
  queryClient.setQueryData(allPositionsKey, allPositions);
  queryClient.setQueryData(siblingPositionsKey, siblingPositions);

  __liveStreamsInternalsForTests.applyIbkrAccountPayloadToCache(
    queryClient,
    {
      accounts: [
        { id: "U123", providerAccountId: "U123", provider: "ibkr" },
        { id: "U456", providerAccountId: "U456", provider: "ibkr" },
      ],
      positions: [
        {
          id: "U123:AAPL",
          accountId: "U123",
          symbol: "AAPL",
          assetClass: "stock",
          quantity: 1,
          averagePrice: 100,
          marketPrice: 101,
          marketValue: 101,
          unrealizedPnl: 1,
          unrealizedPnlPercent: 1,
        },
      ],
    },
    { accountId: "U123", mode: "live" },
  );

  assert.equal(readAuthorityTestQuery(queryClient, allPositionsKey), allPositions);
  assert.equal(
    readAuthorityTestQuery(queryClient, siblingPositionsKey),
    siblingPositions,
  );
});

test("a scoped IBKR order frame cannot replace sibling, shadow, or all-account orders", () => {
  const queryClient = createAuthorityTestQueryClient();
  const allOrdersKey = ["/api/orders", { mode: "shadow" }];
  const siblingOrdersKey = [
    "/api/accounts/U456/orders",
    { mode: "shadow", tab: "working" },
  ];
  const shadowOrdersKey = [
    "/api/accounts/shadow/orders",
    { mode: "shadow", tab: "working" },
  ];
  const allOrders = { orders: [{ id: "all-before", accountId: "U456" }] };
  const siblingOrders = {
    accountId: "U456",
    orders: [{ id: "sibling-before", accountId: "U456" }],
  };
  const shadowOrders = {
    accountId: "shadow",
    orders: [{ id: "shadow-before", accountId: "shadow" }],
  };
  queryClient.setQueryData(allOrdersKey, allOrders);
  queryClient.setQueryData(siblingOrdersKey, siblingOrders);
  queryClient.setQueryData(shadowOrdersKey, shadowOrders);

  __liveStreamsInternalsForTests.applyIbkrOrderPayloadToCache(
    queryClient,
    { orders: [{ id: "U123-order", accountId: "U123", status: "submitted" }] },
    { accountId: "U123", mode: "shadow" },
  );

  assert.equal(readAuthorityTestQuery(queryClient, allOrdersKey), allOrders);
  assert.equal(
    readAuthorityTestQuery(queryClient, siblingOrdersKey),
    siblingOrders,
  );
  assert.equal(readAuthorityTestQuery(queryClient, shadowOrdersKey), shadowOrders);
});

test("unfiltered account-page cash frames preserve date-filtered cache entries", () => {
  const queryClient = createAuthorityTestQueryClient();
  const unfilteredKey = [
    "/api/accounts/U123/cash-activity",
    { mode: "live" },
  ];
  const filteredKey = [
    "/api/accounts/U123/cash-activity",
    {
      mode: "live",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-10T00:00:00.000Z",
    },
  ];
  const filtered = { activities: [{ id: "filtered" }] };
  queryClient.setQueryData(unfilteredKey, { activities: [{ id: "before" }] });
  queryClient.setQueryData(filteredKey, filtered);

  applyAccountPageDerivedPayloadToCache(queryClient, {
    ...accountPageDerivedCalendarPayload("2026-07-16T12:00:00.000Z", []),
    cashActivity: { activities: [{ id: "unfiltered-stream" }] },
  });

  assert.deepEqual(readAuthorityTestQuery(queryClient, unfilteredKey), {
    activities: [{ id: "unfiltered-stream" }],
  });
  assert.equal(readAuthorityTestQuery(queryClient, filteredKey), filtered);
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
    false,
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
      liveQuotes: false,
    },
  ];
  const implicitLivePositionsKey = [
    "/api/accounts/U123/positions",
    {
      mode: "live",
      assetClass: "all",
      detail: "fast",
    },
  ];
  const implicitLivePositions = {
    accountId: "U123",
    marker: "server-default-live-quotes",
    totals: {},
    positions: [],
  };
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
    {
      queryKey: implicitLivePositionsKey,
      data: implicitLivePositions,
    },
  ];
  const queryClient = {
    getQueryCache: () => ({
      findAll: ({ predicate }) => queries.filter(predicate),
    }),
    setQueryData: (queryKey, updater) => {
      const query = queries.find(
        (candidate) =>
          queryKeyText(candidate.queryKey) === queryKeyText(queryKey),
      );
      if (!query) {
        queries.push({
          queryKey,
          data: typeof updater === "function" ? updater(undefined) : updater,
        });
        return;
      }
      query.data =
        typeof updater === "function" ? updater(query.data) : updater;
    },
  };
  const quoteFreePosition = {
    ...queries[0].data.positions[0],
    quantity: 2,
    mark: 2,
    marketValue: 400,
    unrealizedPnl: 0,
    optionQuote: null,
    quote: null,
  };
  queries[0].data = patchAccountPositionsFromOptionQuotes(
    queries[0].data,
    [{
      providerContractId: "12345",
      bid: 2.4,
      ask: 2.5,
      mark: 2.45,
      quoteStatus: "live",
      updatedAt: "2026-06-23T14:00:30.000Z",
    }],
  );

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
      positions: [quoteFreePosition],
    },
    orders: { orders: [] },
    risk: {},
  });

  assert.equal(queries[0].data.positions[0].quote.bid, 2.4);
  assert.equal(queries[0].data.positions[0].quote.ask, 2.5);
  assert.equal(queries[0].data.positions[0].optionQuote.bid, 2.4);
  assert.equal(queries[0].data.positions[0].quantity, 2);
  assert.equal(queries[0].data.positions[0].mark, 2.45);
  assert.ok(
    Math.abs(queries[0].data.positions[0].marketValue - 490) < 1e-9,
  );
  assert.ok(
    Math.abs(queries[0].data.positions[0].unrealizedPnl - 90) < 1e-9,
  );
  assert.ok(Math.abs(queries[0].data.totals.unrealizedPnl - 90) < 1e-9);
  assert.equal(
    queries.find(
      ({ queryKey }) =>
        queryKeyText(queryKey) === queryKeyText(implicitLivePositionsKey),
    ).data,
    implicitLivePositions,
    "a quote-free frame must not overwrite a server-default liveQuotes query",
  );
  assert.equal(
    queries.some(
      ({ queryKey }) =>
        queryKey?.[0] === "/api/accounts/U123/positions" &&
        queryKey?.[1]?.liveQuotes === true,
    ),
    false,
    "a real live frame must not create the unconsumed liveQuotes:true key",
  );
});

test("shadow account-page live payload patches the visible quote-free positions query", () => {
  const queryClient = createAccountPageQueryClient();
  const visiblePositionsKey = [
    "/api/accounts/shadow/positions",
    {
      mode: "shadow",
      assetClass: "all",
      detail: "fast",
      liveQuotes: false,
    },
  ];
  queryClient.setQueryData(visiblePositionsKey, {
    accountId: "shadow",
    totals: {},
    positions: [],
  });

  applyAccountPageLivePayloadToCache(queryClient, {
    stream: "account-page-live",
    accountId: "shadow",
    mode: "shadow",
    orderTab: "working",
    assetClass: "all",
    updatedAt: "2026-06-23T14:01:00.000Z",
    summary: {},
    intradayEquity: {},
    allocation: {},
    positions: {
      accountId: "shadow",
      totals: {},
      positions: [{ id: "shadow:AAPL", symbol: "AAPL", quantity: 1 }],
    },
    orders: { orders: [] },
    risk: {},
  });

  assert.equal(
    readAuthorityTestQuery(queryClient, visiblePositionsKey).positions[0].symbol,
    "AAPL",
  );
  assert.equal(
    queryClient.queries.some(
      ({ queryKey }) =>
        queryKey?.[0] === "/api/accounts/shadow/positions" &&
        queryKey?.[1]?.liveQuotes === true,
    ),
    false,
  );
});

test("fresh degraded or empty account-page payloads replace older cache content", () => {
  const queryClient = createAccountPageQueryClient();
  const livePayload = (version, degraded, positions) => ({
    stream: "account-page-live",
    accountId: "U123",
    mode: "live",
    orderTab: "working",
    assetClass: "all",
    updatedAt: `2026-07-10T00:00:0${version}.000Z`,
    summary: { accountId: "U123", version, degraded },
    intradayEquity: { accountId: "U123", points: [] },
    allocation: { accountId: "U123", version, degraded },
    positions: {
      accountId: "U123",
      version,
      degraded,
      positions,
      totals: {},
    },
    orders: { accountId: "U123", orders: [] },
    risk: { accountId: "U123", version, degraded },
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    livePayload(1, false, [{ id: "old-position", symbol: "OLD" }]),
  );
  applyAccountPageLivePayloadToCache(queryClient, livePayload(2, true, []));

  const dataFor = (path) =>
    queryClient.queries.find((query) => query.queryKey[0] === path)?.data;
  assert.equal(dataFor("/api/accounts/U123/summary")?.version, 2);
  assert.equal(dataFor("/api/accounts/U123/summary")?.degraded, true);
  assert.deepEqual(dataFor("/api/accounts/U123/positions")?.positions, []);

  const derivedPayload = (version, degraded, trades) => ({
    stream: "account-page-derived",
    accountId: "U123",
    mode: "live",
    range: "ALL",
    tradeFilters: {
      from: null,
      to: null,
      symbol: null,
      assetClass: null,
      pnlSign: null,
      holdDuration: null,
    },
    performanceCalendarFrom: null,
    updatedAt: `2026-07-10T00:00:0${version}.000Z`,
    equityHistory: { accountId: "U123", points: [] },
    benchmarkEquityHistory: {},
    performanceCalendarEquity: { accountId: "U123", points: [] },
    performanceCalendarTrades: { accountId: "U123", trades: [] },
    closedTrades: { accountId: "U123", version, degraded, trades },
    cashActivity: { accountId: "U123", activities: [] },
    flexHealth: null,
  });
  applyAccountPageDerivedPayloadToCache(
    queryClient,
    derivedPayload(1, false, [{ id: "old-trade" }]),
  );
  applyAccountPageDerivedPayloadToCache(
    queryClient,
    derivedPayload(2, true, []),
  );
  assert.equal(dataFor("/api/accounts/U123/closed-trades")?.version, 2);
  assert.deepEqual(dataFor("/api/accounts/U123/closed-trades")?.trades, []);
});

test("performance-calendar live updates retain today's opening and latest NAV points", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKey = getAccountPerformanceCalendarEquityQueryKey("U123", {
    mode: "live",
  });
  queryClient.setQueryData(queryKey, {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    points: [
      {
        timestamp: "2026-07-13T20:00:00.000Z",
        netLiquidation: 1000,
        currency: "USD",
      },
    ],
  });
  const livePayload = (timestamp, netLiquidation) => ({
    stream: "account-page-live",
    accountId: "U123",
    mode: "live",
    orderTab: "working",
    assetClass: "all",
    updatedAt: timestamp,
    summary: {
      currency: "USD",
      updatedAt: timestamp,
      metrics: {
        netLiquidation: {
          value: netLiquidation,
          currency: "USD",
          source: "IBKR_ACCOUNT_SUMMARY",
          updatedAt: timestamp,
        },
      },
    },
    intradayEquity: {},
    allocation: {},
    positions: { positions: [], totals: {} },
    orders: { orders: [] },
    risk: {},
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    livePayload("2026-07-15T13:30:00.000Z", 900),
  );
  applyAccountPageLivePayloadToCache(
    queryClient,
    livePayload("2026-07-15T20:00:00.000Z", 950),
  );
  applyAccountPageDerivedPayloadToCache(queryClient, {
    stream: "account-page-derived",
    accountId: "U123",
    mode: "live",
    range: "1Y",
    tradeFilters: {},
    performanceCalendarFrom: null,
    updatedAt: "2026-07-15T20:00:01.000Z",
    equityHistory: { accountId: "U123", range: "1Y", points: [] },
    benchmarkEquityHistory: {},
    performanceCalendarEquity: {
      accountId: "U123",
      currency: "USD",
      range: "1Y",
      points: [
        {
          timestamp: "2026-07-13T20:00:00.000Z",
          netLiquidation: 1000,
          currency: "USD",
        },
      ],
    },
    performanceCalendarTrades: { trades: [] },
    closedTrades: { trades: [] },
    cashActivity: { activities: [] },
    flexHealth: null,
  });

  assert.deepEqual(
    queryClient.queries[0].data.points.map((point) => point.timestamp),
    [
      "2026-07-13T20:00:00.000Z",
      "2026-07-15T13:30:00.000Z",
      "2026-07-15T20:00:00.000Z",
    ],
  );
});

test("an equal-terminal derived refresh cannot erase today's live opening anchor", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKey = getAccountPerformanceCalendarEquityQueryKey("U123", {
    mode: "live",
  });
  const priorClose = {
    timestamp: "2026-07-13T20:00:00.000Z",
    netLiquidation: 1000,
    currency: "USD",
  };
  const terminal = {
    timestamp: "2026-07-15T20:00:00.000Z",
    netLiquidation: 950,
    currency: "USD",
  };
  queryClient.setQueryData(queryKey, {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    points: [priorClose],
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-15T13:30:00.000Z", 900),
  );
  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload(terminal.timestamp, terminal.netLiquidation),
  );
  applyAccountPageDerivedPayloadToCache(
    queryClient,
    accountPageDerivedCalendarPayload("2026-07-15T20:00:01.000Z", [
      priorClose,
      terminal,
    ]),
  );

  assert.deepEqual(
    queryClient.queries[0].data.points.map((point) => point.timestamp),
    [
      "2026-07-13T20:00:00.000Z",
      "2026-07-15T13:30:00.000Z",
      "2026-07-15T20:00:00.000Z",
    ],
  );
});

test("an equal derived terminal keeps a lone live opening anchored for the next tick", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKey = getAccountPerformanceCalendarEquityQueryKey("U123", {
    mode: "live",
  });
  const priorClose = {
    timestamp: "2026-07-13T20:00:00.000Z",
    netLiquidation: 1000,
    currency: "USD",
  };
  const opening = {
    timestamp: "2026-07-15T13:30:00.000Z",
    netLiquidation: 900,
    currency: "USD",
    source: "IBKR_ACCOUNT_SUMMARY",
  };
  queryClient.setQueryData(queryKey, {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    points: [priorClose],
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload(opening.timestamp, opening.netLiquidation),
  );
  applyAccountPageDerivedPayloadToCache(
    queryClient,
    accountPageDerivedCalendarPayload("2026-07-15T13:30:01.000Z", [
      priorClose,
      opening,
    ]),
  );
  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-15T20:00:00.000Z", 950),
  );

  assert.deepEqual(
    queryClient.queries[0].data.points.map((point) => point.timestamp),
    [
      "2026-07-13T20:00:00.000Z",
      "2026-07-15T13:30:00.000Z",
      "2026-07-15T20:00:00.000Z",
    ],
  );
});

test("the legacy broker equity writer preserves an account-page live opening anchor", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKeys = [
    [
      "/api/accounts/U123/equity-history",
      { mode: "live", range: "1Y" },
    ],
    getAccountPerformanceCalendarEquityQueryKey("U123", { mode: "live" }),
  ];
  const priorClose = {
    timestamp: "2026-07-13T20:00:00.000Z",
    netLiquidation: 1000,
    currency: "USD",
  };
  queryKeys.forEach((queryKey) => {
    queryClient.setQueryData(queryKey, {
      accountId: "U123",
      currency: "USD",
      range: "1Y",
      points: [priorClose],
    });
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-15T13:30:00.000Z", 900),
  );
  __liveStreamsInternalsForTests.applyIbkrAccountPayloadToCache(
    queryClient,
    {
      accounts: [
        {
          id: "U123",
          currency: "USD",
          netLiquidation: 901,
          updatedAt: "2026-07-15T13:30:00.000Z",
        },
      ],
      positions: [],
    },
    { accountId: "U123", mode: "live" },
  );
  const opening = {
    timestamp: "2026-07-15T13:30:00.000Z",
    netLiquidation: 901,
    currency: "USD",
    source: "IBKR_ACCOUNT_SUMMARY",
  };
  const derived = accountPageDerivedCalendarPayload(
    "2026-07-15T13:30:01.000Z",
    [priorClose, opening],
  );
  derived.equityHistory = {
    ...derived.performanceCalendarEquity,
    points: [priorClose, opening],
  };
  applyAccountPageDerivedPayloadToCache(queryClient, derived);
  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-15T20:00:00.000Z", 950),
  );

  queryKeys.forEach((queryKey) => {
    const data = queryClient.queries.find(
      (query) => queryKeyText(query.queryKey) === queryKeyText(queryKey),
    ).data;
    assert.deepEqual(
      data.points.map((point) => point.timestamp),
      [
        "2026-07-13T20:00:00.000Z",
        "2026-07-15T13:30:00.000Z",
        "2026-07-15T20:00:00.000Z",
      ],
    );
  });
});

test("a new-bucket legacy tick advances the live anchor without duplicating activity", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKeys = [
    [
      "/api/accounts/U123/equity-history",
      { mode: "live", range: "1Y" },
    ],
    getAccountPerformanceCalendarEquityQueryKey("U123", { mode: "live" }),
  ];
  const thursdayDeposit = {
    timestamp: "2026-07-09T20:00:00.000Z",
    netLiquidation: 2000,
    currency: "USD",
    source: "IBKR_ACCOUNT_SUMMARY",
    deposits: 1000,
    withdrawals: 0,
  };
  queryKeys.forEach((queryKey) => {
    queryClient.setQueryData(queryKey, {
      accountId: "U123",
      currency: "USD",
      range: "1Y",
      asOf: thursdayDeposit.timestamp,
      liveTerminalIncluded: true,
      points: [thursdayDeposit],
    });
  });
  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload(
      thursdayDeposit.timestamp,
      thursdayDeposit.netLiquidation,
    ),
  );

  __liveStreamsInternalsForTests.applyIbkrAccountPayloadToCache(
    queryClient,
    {
      accounts: [
        {
          id: "U123",
          currency: "USD",
          netLiquidation: 950,
          updatedAt: "2026-07-13T13:30:00.000Z",
        },
      ],
      positions: [],
    },
    { accountId: "U123", mode: "live" },
  );
  queryKeys.forEach((queryKey) => {
    const data = queryClient.queries.find(
      (query) => queryKeyText(query.queryKey) === queryKeyText(queryKey),
    ).data;
    assert.equal(
      data.points.reduce(
        (sum, point) => sum + Number(point.deposits || 0),
        0,
      ),
      1000,
    );
  });

  const mondayOpening = {
    timestamp: "2026-07-13T13:30:00.000Z",
    netLiquidation: 950,
    currency: "USD",
    source: "IBKR_ACCOUNT_SUMMARY",
  };
  const derived = accountPageDerivedCalendarPayload(
    "2026-07-13T13:30:01.000Z",
    [thursdayDeposit, mondayOpening],
  );
  derived.equityHistory = {
    ...derived.performanceCalendarEquity,
    points: [thursdayDeposit, mondayOpening],
  };
  applyAccountPageDerivedPayloadToCache(queryClient, derived);
  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-13T20:00:00.000Z", 975),
  );

  queryKeys.forEach((queryKey) => {
    const data = queryClient.queries.find(
      (query) => queryKeyText(query.queryKey) === queryKeyText(queryKey),
    ).data;
    assert.deepEqual(
      data.points.map((point) => point.timestamp),
      [
        "2026-07-09T20:00:00.000Z",
        "2026-07-13T13:30:00.000Z",
        "2026-07-13T20:00:00.000Z",
      ],
    );
  });
});

test("a corrected derived refresh removes omitted historical rows but keeps live anchors", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKey = getAccountPerformanceCalendarEquityQueryKey("U123", {
    mode: "live",
  });
  const priorClose = {
    timestamp: "2026-07-13T20:00:00.000Z",
    netLiquidation: 1000,
    currency: "USD",
  };
  queryClient.setQueryData(queryKey, {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    points: [
      priorClose,
      {
        timestamp: "2026-07-14T20:00:00.000Z",
        netLiquidation: 700,
        currency: "USD",
        source: "LOCAL_LEDGER",
      },
    ],
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-15T13:30:00.000Z", 900),
  );
  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-15T20:00:00.000Z", 950),
  );
  applyAccountPageDerivedPayloadToCache(
    queryClient,
    accountPageDerivedCalendarPayload("2026-07-15T20:00:01.000Z", [
      priorClose,
    ]),
  );

  assert.deepEqual(
    queryClient.queries[0].data.points.map((point) => point.timestamp),
    [
      "2026-07-13T20:00:00.000Z",
      "2026-07-15T13:30:00.000Z",
      "2026-07-15T20:00:00.000Z",
    ],
  );
});

test("a derived refresh does not duplicate a single live anchor-terminal point", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKey = getAccountPerformanceCalendarEquityQueryKey("U123", {
    mode: "live",
  });
  const priorClose = {
    timestamp: "2026-07-14T20:00:00.000Z",
    netLiquidation: 1000,
    currency: "USD",
  };
  queryClient.setQueryData(queryKey, {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    points: [priorClose],
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-15T13:30:00.000Z", 1050),
  );
  applyAccountPageDerivedPayloadToCache(
    queryClient,
    accountPageDerivedCalendarPayload("2026-07-15T13:30:01.000Z", [
      priorClose,
    ]),
  );

  assert.deepEqual(
    queryClient.queries[0].data.points.map((point) => point.timestamp),
    ["2026-07-14T20:00:00.000Z", "2026-07-15T13:30:00.000Z"],
  );
});

test("Saturday and Sunday live points retain one shared Monday-bucket anchor", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKey = getAccountPerformanceCalendarEquityQueryKey("U123", {
    mode: "live",
  });
  const thursdayClose = {
    timestamp: "2026-07-09T20:00:00.000Z",
    netLiquidation: 1000,
    currency: "USD",
  };
  queryClient.setQueryData(queryKey, {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    points: [thursdayClose],
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-11T16:00:00.000Z", 900),
  );
  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-12T16:00:00.000Z", 950),
  );
  applyAccountPageDerivedPayloadToCache(
    queryClient,
    accountPageDerivedCalendarPayload("2026-07-12T16:00:01.000Z", [
      thursdayClose,
    ]),
  );

  assert.deepEqual(
    queryClient.queries[0].data.points.map((point) => point.timestamp),
    [
      "2026-07-09T20:00:00.000Z",
      "2026-07-11T16:00:00.000Z",
      "2026-07-12T16:00:00.000Z",
    ],
  );
});

test("an older exact live point cannot rewrite history or move as-of backward", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKey = getAccountPerformanceCalendarEquityQueryKey("U123", {
    mode: "live",
  });
  queryClient.setQueryData(queryKey, {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    asOf: "2026-07-15T20:00:00.000Z",
    liveTerminalIncluded: true,
    points: [
      {
        timestamp: "2026-07-15T13:30:00.000Z",
        netLiquidation: 900,
        currency: "USD",
      },
      {
        timestamp: "2026-07-15T20:00:00.000Z",
        netLiquidation: 950,
        currency: "USD",
      },
    ],
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-15T13:30:00.000Z", 123),
  );

  assert.equal(queryClient.queries[0].data.points[0].netLiquidation, 900);
  assert.equal(
    queryClient.queries[0].data.asOf,
    "2026-07-15T20:00:00.000Z",
  );
});

test("an older derived refresh cannot erase newer transfer metadata", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKey = getAccountPerformanceCalendarEquityQueryKey("U123", {
    mode: "live",
  });
  queryClient.setQueryData(queryKey, {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    points: [],
  });
  const friday = {
    timestamp: "2026-07-10T20:00:00.000Z",
    netLiquidation: 1000,
    currency: "USD",
    deposits: 0,
    withdrawals: 0,
  };
  const deposited = {
    timestamp: "2026-07-13T14:00:00.000Z",
    netLiquidation: 2100,
    currency: "USD",
    deposits: 1000,
    withdrawals: 0,
  };
  applyAccountPageDerivedPayloadToCache(
    queryClient,
    accountPageDerivedCalendarPayload("2026-07-13T14:00:02.000Z", [
      friday,
      deposited,
    ]),
  );
  applyAccountPageLivePayloadToCache(
    queryClient,
    accountPageLiveNavPayload("2026-07-13T14:01:00.000Z", 2110),
  );
  applyAccountPageDerivedPayloadToCache(
    queryClient,
    accountPageDerivedCalendarPayload("2026-07-13T13:59:00.000Z", [
      friday,
      { ...deposited, deposits: 0 },
    ]),
  );

  const points = queryClient.queries[0].data.points;
  assert.equal(
    points.reduce((sum, point) => sum + Number(point.deposits || 0), 0),
    1000,
  );
  assert.equal(
    queryClient.queries[0].data.asOf,
    "2026-07-13T14:01:00.000Z",
  );

  applyAccountPageDerivedPayloadToCache(
    queryClient,
    accountPageDerivedCalendarPayload("2026-07-13T14:02:00.000Z", [
      friday,
      { ...deposited, deposits: 0 },
    ]),
  );
  assert.equal(
    queryClient.queries[0].data.points.reduce(
      (sum, point) => sum + Number(point.deposits || 0),
      0,
    ),
    0,
  );
  assert.equal(
    queryClient.queries[0].data.asOf,
    "2026-07-13T14:01:00.000Z",
  );
});

test("stale performance-calendar refresh does not duplicate a live terminal transfer", () => {
  const queryClient = createAccountPageQueryClient();
  const queryKey = getAccountPerformanceCalendarEquityQueryKey("U123", {
    mode: "live",
  });
  const friday = {
    timestamp: "2026-07-10T20:00:00.000Z",
    netLiquidation: 1000,
    currency: "USD",
    deposits: 0,
    withdrawals: 0,
  };
  const deposited = {
    timestamp: "2026-07-13T14:00:00.000Z",
    netLiquidation: 2100,
    currency: "USD",
    deposits: 1000,
    withdrawals: 0,
  };
  queryClient.setQueryData(queryKey, {
    accountId: "U123",
    currency: "USD",
    range: "1Y",
    points: [friday, deposited],
  });
  const livePayload = (timestamp, netLiquidation) => ({
    stream: "account-page-live",
    accountId: "U123",
    mode: "live",
    orderTab: "working",
    assetClass: "all",
    updatedAt: timestamp,
    summary: {
      currency: "USD",
      updatedAt: timestamp,
      metrics: {
        netLiquidation: {
          value: netLiquidation,
          currency: "USD",
          source: "IBKR_ACCOUNT_SUMMARY",
          updatedAt: timestamp,
        },
      },
    },
    intradayEquity: {},
    allocation: {},
    positions: { positions: [], totals: {} },
    orders: { orders: [] },
    risk: {},
  });

  applyAccountPageLivePayloadToCache(
    queryClient,
    livePayload("2026-07-13T14:00:00.000Z", 2100),
  );
  applyAccountPageLivePayloadToCache(
    queryClient,
    livePayload("2026-07-13T14:01:00.000Z", 2110),
  );
  applyAccountPageDerivedPayloadToCache(queryClient, {
    stream: "account-page-derived",
    accountId: "U123",
    mode: "live",
    range: "1Y",
    tradeFilters: {},
    performanceCalendarFrom: null,
    updatedAt: "2026-07-13T14:01:01.000Z",
    equityHistory: { accountId: "U123", range: "1Y", points: [] },
    benchmarkEquityHistory: {},
    performanceCalendarEquity: {
      accountId: "U123",
      currency: "USD",
      range: "1Y",
      points: [friday, deposited],
    },
    performanceCalendarTrades: { trades: [] },
    closedTrades: { trades: [] },
    cashActivity: { activities: [] },
    flexHealth: null,
  });

  const points = queryClient.queries[0].data.points;
  assert.equal(
    points.reduce((sum, point) => sum + Number(point.deposits || 0), 0),
    1000,
  );
  assert.deepEqual(
    points.map((point) => point.timestamp),
    [
      "2026-07-10T20:00:00.000Z",
      "2026-07-13T14:00:00.000Z",
      "2026-07-13T14:01:00.000Z",
    ],
  );
});

test("shadow live frames reconcile the chart and calendar to the summary NLV", () => {
  const queryClient = createAccountPageQueryClient();
  const historyKey = [
    "/api/accounts/shadow/equity-history",
    { mode: "shadow", range: "1Y" },
  ];
  const intradayKey = [
    "/api/accounts/shadow/equity-history",
    { mode: "shadow", range: "1D" },
  ];
  const calendarKey = getAccountPerformanceCalendarEquityQueryKey("shadow", {
    mode: "shadow",
  });
  const authoritative = {
    accountId: "shadow",
    currency: "USD",
    range: "1Y",
    terminalPointSource: "shadow_ledger",
    liveTerminalIncluded: true,
    points: [
      {
        timestamp: "2026-07-16T20:00:00.000Z",
        netLiquidation: 162_042.8455,
        currency: "USD",
        source: "SHADOW_LEDGER",
      },
      {
        timestamp: "2026-07-17T02:49:24.292Z",
        netLiquidation: 165_940.392,
        currency: "USD",
        source: "SHADOW_LEDGER",
      },
    ],
  };
  queryClient.setQueryData(historyKey, authoritative);
  queryClient.setQueryData(calendarKey, authoritative);
  queryClient.setQueryData(intradayKey, {
    ...authoritative,
    range: "1D",
  });

  applyAccountPageLivePayloadToCache(queryClient, {
    stream: "account-page-live",
    accountId: "shadow",
    mode: "shadow",
    orderTab: "history",
    assetClass: "all",
    updatedAt: "2026-07-17T02:50:00.000Z",
    summary: {
      accountId: "shadow",
      currency: "USD",
      updatedAt: "2026-07-17T02:50:00.000Z",
      metrics: {
        netLiquidation: {
          value: 166_000,
          currency: "USD",
          source: "SHADOW_LEDGER",
          updatedAt: "2026-07-17T02:50:00.000Z",
        },
      },
    },
    intradayEquity: {
      accountId: "shadow",
      currency: "USD",
      range: "1D",
      points: [],
    },
    allocation: {},
    positions: { positions: [], totals: {} },
    orders: { orders: [] },
    risk: {},
  });

  [historyKey, intradayKey, calendarKey].forEach((queryKey) => {
    const history = queryClient.getQueryData(queryKey);
    const terminal = history.points.at(-1);
    assert.equal(history.asOf, "2026-07-17T02:50:00.000Z");
    assert.equal(terminal.timestamp, "2026-07-17T02:50:00.000Z");
    assert.equal(terminal.netLiquidation, 166_000);
    assert.equal(terminal.source, "SHADOW_LEDGER");
  });
});

test("shadow derived frames preserve a newer summary terminal at every history key", () => {
  const queryClient = createAccountPageQueryClient();
  const historyKey = [
    "/api/accounts/shadow/equity-history",
    { mode: "shadow", range: "1Y" },
  ];
  const calendarKey = getAccountPerformanceCalendarEquityQueryKey("shadow", {
    mode: "shadow",
  });
  const stale = {
    accountId: "shadow",
    currency: "USD",
    range: "1Y",
    asOf: "2026-07-17T02:50:00.000Z",
    terminalPointSource: "live_account_summary",
    liveTerminalIncluded: true,
    __accountPageDerivedUpdatedAt: "2026-07-17T02:49:00.000Z",
    __accountPageLiveAnchorAt: "2026-07-17T02:50:00.000Z",
    points: [
      {
        timestamp: "2026-07-17T02:50:00.000Z",
        netLiquidation: 166_000,
        currency: "USD",
        source: "SHADOW_LEDGER",
        __accountPageLiveCachePoint: true,
      },
    ],
  };
  queryClient.setQueryData(historyKey, stale);
  queryClient.setQueryData(calendarKey, stale);

  const authoritative = {
    accountId: "shadow",
    currency: "USD",
    range: "1Y",
    asOf: "2026-07-17T02:50:00.000Z",
    terminalPointSource: "shadow_ledger",
    liveTerminalIncluded: true,
    points: [
      {
        timestamp: "2026-07-16T20:00:00.000Z",
        netLiquidation: 162_042.8455,
        currency: "USD",
        source: "SHADOW_LEDGER",
      },
      {
        timestamp: "2026-07-17T02:50:00.000Z",
        netLiquidation: 165_940.392,
        currency: "USD",
        source: "SHADOW_LEDGER",
      },
    ],
  };
  applyAccountPageDerivedPayloadToCache(queryClient, {
    stream: "account-page-derived",
    accountId: "shadow",
    mode: "shadow",
    range: "1Y",
    tradeFilters: {},
    performanceCalendarFrom: null,
    updatedAt: "2026-07-17T02:51:00.000Z",
    equityHistory: authoritative,
    benchmarkEquityHistory: {},
    performanceCalendarEquity: authoritative,
    performanceCalendarTrades: { trades: [] },
    closedTrades: { trades: [] },
    cashActivity: { activities: [] },
    flexHealth: null,
  });

  [historyKey, calendarKey].forEach((queryKey) => {
    const history = queryClient.getQueryData(queryKey);
    const terminal = history.points.at(-1);
    assert.equal(history.asOf, "2026-07-17T02:50:00.000Z");
    assert.equal(terminal.timestamp, "2026-07-17T02:50:00.000Z");
    assert.equal(terminal.netLiquidation, 166_000);
  });
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
    __liveStreamsInternalsForTests.shouldUseSharedOptionQuoteStream(
      "visible-live",
    ),
    true,
  );
  assert.equal(
    __liveStreamsInternalsForTests.shouldUseSharedOptionQuoteStream(
      "execution-live",
    ),
    false,
  );
  assert.equal(
    __liveStreamsInternalsForTests.shouldUseSharedOptionQuoteStream(
      "account-monitor-live",
    ),
    false,
  );
  assert.equal(
    __liveStreamsInternalsForTests.shouldUseSharedOptionQuoteStream(
      "automation-live",
    ),
    false,
  );
});

test("option quote coverage gaps degrade cached contracts until a fresh quote recovers", () => {
  const {
    applyOptionQuoteCoverageStatus,
    cacheOptionQuoteSnapshot,
  } = __liveStreamsInternalsForTests;
  const providerContractId = "O:COVERAGE260821C00000500";
  const updatedAt = new Date().toISOString();

  cacheOptionQuoteSnapshot({
    providerContractId,
    symbol: providerContractId,
    bid: 1,
    ask: 1.1,
    price: 1.05,
    updatedAt,
    freshness: "live",
  });
  applyOptionQuoteCoverageStatus({
    type: "heartbeat",
    missingProviderContractIds: [providerContractId],
  });

  const degraded = getStoredOptionQuoteSnapshot(providerContractId);
  assert.equal(degraded?.bid, 1, "last value remains visible for attribution");
  assert.equal(degraded?.freshness, "stale");
  assert.equal(degraded?.quoteFreshness, "stale");
  assert.equal(degraded?.quoteStatus, "stale");
  assert.equal(degraded?.quoteReason, "quote_stream_missing");

  cacheOptionQuoteSnapshot({
    providerContractId,
    symbol: providerContractId,
    bid: 1.05,
    ask: 1.15,
    price: 1.1,
    updatedAt,
    freshness: "live",
  });

  const recovered = getStoredOptionQuoteSnapshot(providerContractId);
  assert.equal(recovered?.bid, 1.05);
  assert.equal(recovered?.freshness, "live");
  assert.equal(recovered?.quoteFreshness, "live");
  assert.equal(recovered?.quoteStatus, "live");
  assert.equal(recovered?.quoteReason, null);
});

test("option quote WebSocket payloads reject malformed quote arrays", () => {
  const { isOptionQuoteWebSocketPayload } = __liveStreamsInternalsForTests;

  assert.equal(isOptionQuoteWebSocketPayload(null), false);
  assert.equal(isOptionQuoteWebSocketPayload("quotes"), false);
  assert.equal(
    isOptionQuoteWebSocketPayload({ type: "quotes", quotes: "invalid" }),
    false,
  );
  assert.equal(
    isOptionQuoteWebSocketPayload({ type: "quotes", quotes: [null] }),
    false,
  );
  assert.equal(
    isOptionQuoteWebSocketPayload({ type: "quotes", quotes: [] }),
    true,
  );
  assert.equal(isOptionQuoteWebSocketPayload({ type: "heartbeat" }), true);
  assert.equal(
    isOptionQuoteWebSocketPayload({
      type: "heartbeat",
      missingProviderContractIds: {},
    }),
    false,
  );
  assert.equal(
    isOptionQuoteWebSocketPayload({
      type: "status",
      staleProviderContractIds: "invalid",
    }),
    false,
  );
  assert.equal(
    isOptionQuoteWebSocketPayload({
      type: "ready",
      missingProviderContractIds: [null],
    }),
    false,
  );
  assert.equal(
    isOptionQuoteWebSocketPayload({
      type: "status",
      missingProviderContractIds: ["O:VALID260821C00000500"],
      staleProviderContractIds: [],
    }),
    true,
  );
});

test("account option quote REST fallback retries and re-upgrades to WebSocket", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );
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
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /onStatesRef\.current\(payload\.states, kind, payload\)/,
  );
});

test("signal matrix stream terminal reconnect creates a fresh EventSource bootstrap", () => {
  const source = readFileSync(
    new URL("./live-streams.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const connect = \(\) => \{/);
  assert.match(source, /const next = new EventSource\(streamUrl\)/);
  assert.match(
    source,
    /next\.addEventListener\("bootstrap", handleBootstrap as EventListener\)/,
  );
  assert.match(source, /nextQuoteStreamReconnectDelayMs\(reconnectAttempt\)/);
  assert.match(source, /connect\(\);/);
});
