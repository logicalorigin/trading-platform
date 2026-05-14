import assert from "node:assert/strict";
import test from "node:test";
import {
  ConnectionState,
  IBApiTickType as TickType,
  MarketDataType,
  SecType,
} from "@stoqey/ib";
import {
  collectTwsOptionParameters,
  isHistoricalDataReconnectableError,
  isSnapshotGenericTickError,
  mapTwsContractDescriptionToUniverseTicker,
  resolveOptionActivitySnapshotTimeoutMs,
  resolveOptionQuoteMarketDataType,
  selectRelevantOptionStrikes,
  toQuoteSnapshot,
  TwsIbkrBridgeProvider,
  __twsProviderTestInternals,
} from "./tws-provider";
import {
  __resetBridgeSchedulerForTests,
  getBridgeSchedulerDiagnostics,
  runBridgeLane,
} from "./work-scheduler";
import {
  BRIDGE_RUNTIME_LIMITS,
  resetBridgeRuntimeLimitOverrides,
  setBridgeRuntimeLimitOverrides,
} from "./runtime-limits";

test.afterEach(() => {
  resetBridgeRuntimeLimitOverrides();
});

test("bridge runtime defaults reflect the line booster live quote allowance", () => {
  assert.equal(BRIDGE_RUNTIME_LIMITS.maxMarketDataLines.defaultValue, 190);
  assert.equal(BRIDGE_RUNTIME_LIMITS.maxLiveEquityLines.defaultValue, 90);
  assert.equal(BRIDGE_RUNTIME_LIMITS.maxLiveOptionLines.defaultValue, 100);
  assert.equal(
    BRIDGE_RUNTIME_LIMITS.optionQuoteVisibleContractLimit.defaultValue,
    100,
  );
});

test("option quote market data type switches live config to frozen outside regular session", () => {
  assert.equal(
    resolveOptionQuoteMarketDataType(
      MarketDataType.REALTIME as 1,
      new Date("2026-05-05T14:00:00.000Z"),
    ),
    MarketDataType.REALTIME,
  );
  assert.equal(
    resolveOptionQuoteMarketDataType(
      MarketDataType.REALTIME as 1,
      new Date("2026-05-05T20:10:00.000Z"),
    ),
    MarketDataType.FROZEN,
  );
  assert.equal(
    resolveOptionQuoteMarketDataType(
      MarketDataType.DELAYED as 3,
      new Date("2026-05-05T20:10:00.000Z"),
    ),
    MarketDataType.DELAYED,
  );
});

test("TWS historical duration pads intraday extended-hour windows", () => {
  assert.equal(
    __twsProviderTestInternals.buildHistoryDuration("1m", 900, true),
    "2 D",
  );
  assert.equal(
    __twsProviderTestInternals.buildHistoryDuration("15m", 1_000, false),
    "53 D",
  );
});

test("TWS historical data exchange accepts IBKR overnight venues", () => {
  assert.equal(
    __twsProviderTestInternals.normalizeHistoricalDataExchange("OVERNIGHT"),
    "OVERNIGHT",
  );
  assert.equal(
    __twsProviderTestInternals.normalizeHistoricalDataExchange("ibeos"),
    "IBEOS",
  );
  assert.equal(
    __twsProviderTestInternals.normalizeHistoricalDataExchange("SMART"),
    null,
  );
});

test("TWS health marks IBKR server connectivity loss separately from the local socket", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    connectionState: ConnectionState;
    managedAccounts: string[];
    recordError(error: unknown): void;
  };

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.recordError({
    code: 1100,
    message: "Connectivity between IB and Trader Workstation has been lost.",
  });

  const disconnected = await provider.getHealth();
  assert.equal(disconnected.socketConnected, true);
  assert.equal(disconnected.brokerServerConnected, false);
  assert.equal(disconnected.connected, true);
  assert.equal(disconnected.authenticated, false);
  assert.equal(disconnected.accountsLoaded, false);
  assert.equal(disconnected.strictReady, false);
  assert.equal(disconnected.strictReason, "gateway_server_disconnected");

  internals.recordError({
    code: 1102,
    message:
      "Connectivity between IB and Trader Workstation has been restored - data maintained.",
  });

  const restored = await provider.getHealth();
  assert.equal(restored.socketConnected, true);
  assert.equal(restored.brokerServerConnected, true);
  assert.equal(restored.connected, true);
  assert.equal(restored.authenticated, true);
  assert.equal(restored.accountsLoaded, true);
});

test("TWS health ignores ticker-scoped EId errors when parsing connectivity codes", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    connectionState: ConnectionState;
    managedAccounts: string[];
    recordError(error: unknown): void;
  };

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.recordError({
    code: 1102,
    message:
      "Connectivity between IB and Trader Workstation has been restored - data maintained.",
  });
  internals.recordError(new Error("Can't find EId with tickerId:1300"));

  const health = await provider.getHealth();
  assert.equal(health.socketConnected, true);
  assert.equal(health.brokerServerConnected, true);
  assert.equal(health.serverConnectivity, "connected");
  assert.equal(health.lastServerConnectivityError, null);
  assert.equal(health.lastError, null);
});

test("maps TWS stock contract descriptions into IBKR universe tickers", () => {
  const ticker = mapTwsContractDescriptionToUniverseTicker({
    contract: {
      conId: 265598,
      symbol: "AAPL",
      secType: SecType.STK,
      primaryExch: "NASDAQ",
      exchange: "SMART",
      currency: "USD",
      description: "APPLE INC",
    },
    derivativeSecTypes: [SecType.OPT],
  });

  assert.ok(ticker);
  assert.equal(ticker.ticker, "AAPL");
  assert.equal(ticker.name, "APPLE INC");
  assert.equal(ticker.market, "stocks");
  assert.equal(ticker.providerContractId, "265598");
  assert.equal(ticker.primaryExchange, "NASDAQ");
  assert.equal(ticker.provider, "ibkr");
  assert.deepEqual(ticker.providers, ["ibkr"]);
  assert.equal(ticker.contractMeta?.["derivativeSecTypes"], "OPT");
});

test("TWS position snapshots drop closed rows and preserve portfolio marks", () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    positionsByAccount: Map<string, any[]>;
    replacePositionsForAccount(
      accountId: string,
      positions: any[],
      options?: { preserveExistingMarketData?: boolean },
    ): void;
    applyPositionsUpdate(
      update: {
        all?: Map<string, any[]>;
        added?: Map<string, any[]>;
        changed?: Map<string, any[]>;
        removed?: Map<string, any[]>;
      },
      options?: { preserveExistingMarketData?: boolean },
    ): void;
    toBrokerPositionSnapshot(position: {
      account: string;
      contract: Record<string, unknown>;
      pos: number;
      avgCost?: number;
      marketPrice?: number;
      marketValue?: number;
      unrealizedPNL?: number;
    }): any | null;
  };

  const contract = { conId: 740517233, symbol: "FCEL", secType: SecType.STK };
  const portfolioSnapshot = internals.toBrokerPositionSnapshot({
    account: "U1",
    contract,
    pos: 30,
    avgCost: 12.65,
    marketPrice: 43.1,
    marketValue: 1293,
    unrealizedPNL: 913.5,
  });
  const quantityOnlySnapshot = internals.toBrokerPositionSnapshot({
    account: "U1",
    contract,
    pos: 30,
    avgCost: 12.65,
  });
  const closedSnapshot = internals.toBrokerPositionSnapshot({
    account: "U1",
    contract: { conId: 139673266, symbol: "AAL", secType: SecType.STK },
    pos: 0,
    avgCost: 0,
  });

  assert.equal(closedSnapshot, null);
  assert.ok(portfolioSnapshot);
  assert.ok(quantityOnlySnapshot);
  assert.equal(quantityOnlySnapshot.marketPrice, 12.65);
  assert.equal(quantityOnlySnapshot.marketValue, 379.5);

  internals.replacePositionsForAccount("U1", [portfolioSnapshot]);
  internals.replacePositionsForAccount("U1", [quantityOnlySnapshot], {
    preserveExistingMarketData: true,
  });

  const stored = internals.positionsByAccount.get("U1")?.[0];
  assert.equal(stored?.quantity, 30);
  assert.equal(stored?.marketPrice, 43.1);
  assert.equal(stored?.marketValue, 1293);
  assert.equal(stored?.unrealizedPnl, 913.5);

  internals.replacePositionsForAccount("U1", [
    { ...portfolioSnapshot, id: "U1:closed", quantity: 0 },
  ]);
  assert.deepEqual(internals.positionsByAccount.get("U1"), []);

  const keepSnapshot = internals.toBrokerPositionSnapshot({
    account: "U1",
    contract: { conId: 496414757, symbol: "INDI", secType: SecType.STK },
    pos: 200,
    avgCost: 4.42,
    marketPrice: 4.55,
    marketValue: 910,
    unrealizedPNL: 25,
  });
  assert.ok(keepSnapshot);
  internals.replacePositionsForAccount("U1", [portfolioSnapshot, keepSnapshot]);
  internals.applyPositionsUpdate({
    removed: new Map([
      [
        "U1",
        [
          {
            account: "U1",
            contract,
            pos: 0,
            avgCost: 0,
          },
        ],
      ],
    ]),
  });

  assert.deepEqual(
    internals.positionsByAccount.get("U1")?.map((position) => position.symbol),
    ["INDI"],
  );
});

test("bridge scheduler pressure recovers after a later successful lane run", async () => {
  __resetBridgeSchedulerForTests();

  await assert.rejects(
    runBridgeLane("control", () => new Promise(() => {}), { timeoutMs: 1 }),
    /Lane timed out/,
  );
  assert.equal(getBridgeSchedulerDiagnostics().control.pressure, "stalled");

  await runBridgeLane("control", async () => "ok", { timeoutMs: 50 });

  const diagnostics = getBridgeSchedulerDiagnostics().control;
  assert.equal(diagnostics.timedOut, 1);
  assert.equal(diagnostics.pressure, "normal");
});

test("bridge scheduler pressure ignores historical queue rejections after recovery", async () => {
  __resetBridgeSchedulerForTests();

  const blocked = runBridgeLane(
    "control",
    () => new Promise(() => {}),
    { timeoutMs: 5 },
  );
  const queued = runBridgeLane("control", async () => "queued", {
    timeoutMs: 50,
  });

  await assert.rejects(
    runBridgeLane("control", async () => "rejected", { timeoutMs: 50 }),
    /Lane queue is full/,
  );
  await assert.rejects(blocked, /Lane timed out/);
  assert.equal(await queued, "queued");

  const diagnostics = getBridgeSchedulerDiagnostics().control;
  assert.equal(diagnostics.rejected, 1);
  assert.equal(diagnostics.pressure, "normal");
});

test("raw TWS order batches assign contiguous ids and parent links", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const placed: Array<{
    id: number;
    contract: Record<string, unknown>;
    order: Record<string, unknown>;
  }> = [];
  const internals = provider as unknown as {
    api: {
      getNextValidOrderId(): Promise<number>;
      placeOrder(
        id: number,
        contract: Record<string, unknown>,
        order: Record<string, unknown>,
      ): void;
    };
    refreshSession(): Promise<null>;
    requireAccountId(accountId?: string | null): Promise<string>;
  };

  internals.refreshSession = async () => null;
  internals.requireAccountId = async () => "U1";
  internals.api = {
    getNextValidOrderId: async () => 700,
    placeOrder: (id, contract, order) => {
      placed.push({ id, contract, order });
    },
  };

  const result = await provider.submitRawOrders({
    accountId: "U1",
    mode: "paper",
    orders: [
      {
        contract: { symbol: "SPY", secType: SecType.OPT },
        order: {
          action: "BUY",
          totalQuantity: 1,
          orderType: "LMT",
          lmtPrice: 1.2,
          transmit: false,
        },
      },
      {
        contract: { symbol: "SPY", secType: SecType.OPT },
        order: {
          action: "SELL",
          totalQuantity: 1,
          orderType: "STP",
          auxPrice: 0.8,
          parentOrderIndex: 0,
          transmit: true,
        },
      },
    ],
  });

  assert.deepEqual(result.submittedOrderIds, ["700", "701"]);
  assert.equal(placed[0]?.id, 700);
  assert.equal(placed[0]?.order.orderId, 700);
  assert.equal(placed[1]?.id, 701);
  assert.equal(placed[1]?.order.orderId, 701);
  assert.equal(placed[1]?.order.parentId, 700);
  assert.equal("parentOrderIndex" in (placed[1]?.order ?? {}), false);
});

test("single TWS equity orders use placeOrder with an allocated order id", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const placed: Array<{
    id: number;
    contract: Record<string, unknown>;
    order: Record<string, unknown>;
  }> = [];
  const internals = provider as unknown as {
    api: {
      getNextValidOrderId(): Promise<number>;
      placeOrder(
        id: number,
        contract: Record<string, unknown>,
        order: Record<string, unknown>,
      ): void;
    };
    refreshSession(): Promise<null>;
    buildStructuredOrder(input: Record<string, unknown>): Promise<{
      accountId: string;
      contract: Record<string, unknown>;
      optionContract: null;
      order: Record<string, unknown>;
      resolvedContractId: number;
    }>;
    findOpenOrder(orderId: number): Promise<null>;
  };

  internals.refreshSession = async () => null;
  internals.buildStructuredOrder = async () => ({
    accountId: "U1",
    contract: {
      conId: 1111,
      symbol: "FCEL",
      secType: SecType.STK,
      exchange: "SMART",
    },
    optionContract: null,
    order: {
      account: "U1",
      action: "BUY",
      totalQuantity: 1,
      orderType: "LMT",
      lmtPrice: 1.25,
      tif: "DAY",
      transmit: true,
    },
    resolvedContractId: 1111,
  });
  internals.findOpenOrder = async () => null;
  internals.api = {
    getNextValidOrderId: async () => 801,
    placeOrder: (id, contract, order) => {
      placed.push({ id, contract, order });
    },
  };

  const order = await provider.placeOrder({
    accountId: "U1",
    mode: "paper",
    symbol: "FCEL",
    assetClass: "equity",
    side: "buy",
    type: "limit",
    quantity: 1,
    limitPrice: 1.25,
    stopPrice: null,
    timeInForce: "day",
    optionContract: null,
  });

  assert.equal(order.id, "801");
  assert.equal(order.symbol, "FCEL");
  assert.equal(placed[0]?.id, 801);
  assert.equal(placed[0]?.contract.symbol, "FCEL");
  assert.equal(placed[0]?.order.orderId, 801);
  assert.equal(placed[0]?.order.totalQuantity, 1);
});

test("single TWS equity orders resolve with a fallback when no open-order callback arrives", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const placed: Array<{
    id: number;
    contract: Record<string, unknown>;
    order: Record<string, unknown>;
  }> = [];
  const internals = provider as unknown as {
    api: {
      getNextValidOrderId(): Promise<number>;
      getAllOpenOrders(): Promise<never>;
      placeOrder(
        id: number,
        contract: Record<string, unknown>,
        order: Record<string, unknown>,
      ): void;
    };
    refreshSession(): Promise<null>;
    buildStructuredOrder(input: Record<string, unknown>): Promise<{
      accountId: string;
      contract: Record<string, unknown>;
      optionContract: null;
      order: Record<string, unknown>;
      resolvedContractId: number;
    }>;
  };

  setBridgeRuntimeLimitOverrides({ openOrdersRequestTimeoutMs: 500 });
  internals.refreshSession = async () => null;
  internals.buildStructuredOrder = async () => ({
    accountId: "U1",
    contract: {
      conId: 1111,
      symbol: "FCEL",
      secType: SecType.STK,
      exchange: "SMART",
    },
    optionContract: null,
    order: {
      account: "U1",
      action: "BUY",
      totalQuantity: 1,
      orderType: "MKT",
      tif: "DAY",
      transmit: true,
    },
    resolvedContractId: 1111,
  });
  internals.api = {
    getNextValidOrderId: async () => 802,
    getAllOpenOrders: async () => {
      throw new Error("post-submit fallback must not request open orders");
    },
    placeOrder: (id, contract, order) => {
      placed.push({ id, contract, order });
    },
  };

  const startedAt = Date.now();
  const order = await provider.placeOrder({
    accountId: "U1",
    mode: "paper",
    symbol: "FCEL",
    assetClass: "equity",
    side: "buy",
    type: "market",
    quantity: 1,
    limitPrice: null,
    stopPrice: null,
    timeInForce: "day",
    optionContract: null,
  });

  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(order.id, "802");
  assert.equal(order.status, "submitted");
  assert.equal(order.type, "market");
  assert.equal(placed.length, 1);
  assert.equal(placed[0]?.id, 802);
});

test("infers ETF market for TWS STK rows with ETF descriptions", () => {
  const ticker = mapTwsContractDescriptionToUniverseTicker({
    contract: {
      conId: 756733,
      symbol: "SPY",
      secType: SecType.STK,
      primaryExch: "ARCA",
      exchange: "SMART",
      currency: "USD",
      description: "SPDR S&P 500 ETF TRUST",
    },
  });

  assert.ok(ticker);
  assert.equal(ticker.market, "etf");
  assert.equal(ticker.type, "ETF");
});

test("ignores unsupported TWS contract descriptions", () => {
  assert.equal(
    mapTwsContractDescriptionToUniverseTicker({
      contract: {
        conId: 123,
        symbol: "TEST",
        secType: SecType.BOND,
        description: "TEST BOND",
      },
    }),
    null,
  );
});

test("collects TWS option parameters across parameter sets", () => {
  const { expirations, strikes } = collectTwsOptionParameters([
    {
      expirations: ["20990515", "20990508"],
      strikes: [500, "505", 510],
    },
    {
      expirations: ["20990515", "20990522"],
      strikes: [510, "515", null],
    },
  ]);

  assert.deepEqual(
    expirations.map((expiration) => expiration.toISOString().slice(0, 10)),
    ["2099-05-08", "2099-05-15", "2099-05-22"],
  );
  assert.deepEqual(strikes, [500, 505, 510, 515]);
});

test("option expirations fall back to optionable matching-symbol conid", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    api: {
      getManagedAccounts(): Promise<string[]>;
      getContractDetails(): Promise<
        Array<{ contract: Record<string, unknown> }>
      >;
      getMatchingSymbols(): Promise<
        Array<{
          contract: Record<string, unknown>;
          derivativeSecTypes?: string[];
        }>
      >;
      getSecDefOptParams(
        symbol: string,
        exchange: string,
        secType: SecType,
        conid: number,
      ): Promise<Array<{ expirations: string[]; strikes: number[] }>>;
    };
    connectionState: ConnectionState;
    managedAccounts: string[];
    baseSubscriptionsStarted: boolean;
  };
  const secdefConids: number[] = [];

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.baseSubscriptionsStarted = true;
  internals.api = {
    getManagedAccounts: async () => ["U1"],
    getContractDetails: async () => [
      {
        contract: {
          conId: 111,
          symbol: "SPY",
          secType: SecType.STK,
          exchange: "SMART",
          currency: "USD",
        },
      },
    ],
    getMatchingSymbols: async () => [
      {
        contract: {
          conId: 222,
          symbol: "SPY",
          secType: SecType.STK,
          primaryExch: "ARCA",
          exchange: "SMART",
          currency: "USD",
        },
        derivativeSecTypes: [SecType.OPT],
      },
    ],
    getSecDefOptParams: async (_symbol, _exchange, _secType, conid) => {
      secdefConids.push(conid);
      return conid === 222
        ? [{ expirations: ["20990501"], strikes: [500] }]
        : [];
    },
  };

  const expirations = await provider.getOptionExpirations({
    underlying: "SPY",
  });

  assert.deepEqual(secdefConids, [111, 222]);
  assert.deepEqual(
    expirations.map((expiration) => expiration.toISOString().slice(0, 10)),
    ["2099-05-01"],
  );
});

test("option expirations prefer US optionable contract details over foreign listings", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    api: {
      getManagedAccounts(): Promise<string[]>;
      getContractDetails(): Promise<
        Array<{ contract: Record<string, unknown> }>
      >;
      getMatchingSymbols(): Promise<
        Array<{
          contract: Record<string, unknown>;
          derivativeSecTypes?: string[];
        }>
      >;
      getSecDefOptParams(
        symbol: string,
        exchange: string,
        secType: SecType,
        conid: number,
      ): Promise<Array<{ expirations: string[]; strikes: number[] }>>;
    };
    connectionState: ConnectionState;
    managedAccounts: string[];
    baseSubscriptionsStarted: boolean;
  };
  const secdefConids: number[] = [];
  let matchingSymbolCalls = 0;

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.baseSubscriptionsStarted = true;
  internals.api = {
    getManagedAccounts: async () => ["U1"],
    getContractDetails: async () => [
      {
        contract: {
          conId: 237937002,
          symbol: "SPY",
          secType: SecType.STK,
          exchange: "ASX",
          currency: "AUD",
        },
      },
      {
        contract: {
          conId: 756733,
          symbol: "SPY",
          secType: SecType.STK,
          primaryExch: "ARCA",
          exchange: "SMART",
          currency: "USD",
        },
      },
    ],
    getMatchingSymbols: async () => {
      matchingSymbolCalls += 1;
      return [];
    },
    getSecDefOptParams: async (_symbol, _exchange, _secType, conid) => {
      secdefConids.push(conid);
      return conid === 756733
        ? [{ expirations: ["20990501"], strikes: [500] }]
        : [];
    },
  };

  const expirations = await provider.getOptionExpirations({
    underlying: "SPY",
  });

  assert.deepEqual(secdefConids, [756733]);
  assert.equal(matchingSymbolCalls, 0);
  assert.deepEqual(
    expirations.map((expiration) => expiration.toISOString().slice(0, 10)),
    ["2099-05-01"],
  );
});

test("option expirations do not query matching symbols when primary conid has options", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    api: {
      getManagedAccounts(): Promise<string[]>;
      getContractDetails(): Promise<
        Array<{ contract: Record<string, unknown> }>
      >;
      getMatchingSymbols(): Promise<
        Array<{
          contract: Record<string, unknown>;
          derivativeSecTypes?: string[];
        }>
      >;
      getSecDefOptParams(
        symbol: string,
        exchange: string,
        secType: SecType,
        conid: number,
      ): Promise<Array<{ expirations: string[]; strikes: number[] }>>;
    };
    connectionState: ConnectionState;
    managedAccounts: string[];
    baseSubscriptionsStarted: boolean;
  };
  let matchingSymbolCalls = 0;

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.baseSubscriptionsStarted = true;
  internals.api = {
    getManagedAccounts: async () => ["U1"],
    getContractDetails: async () => [
      {
        contract: {
          conId: 111,
          symbol: "SPY",
          secType: SecType.STK,
          exchange: "SMART",
          currency: "USD",
        },
      },
    ],
    getMatchingSymbols: async () => {
      matchingSymbolCalls += 1;
      return [];
    },
    getSecDefOptParams: async () => [
      { expirations: ["20990501"], strikes: [500] },
    ],
  };

  const expirations = await provider.getOptionExpirations({
    underlying: "SPY",
  });

  assert.equal(matchingSymbolCalls, 0);
  assert.deepEqual(
    expirations.map((expiration) => expiration.toISOString().slice(0, 10)),
    ["2099-05-01"],
  );
});

test("selectRelevantOptionStrikes keeps fast chains bounded without spot", () => {
  assert.deepEqual(
    selectRelevantOptionStrikes({
      strikes: [100, 105, 110, 115, 120, 125, 130, 135, 140],
      spotPrice: 0,
      strikesAroundMoney: 2,
    }),
    [110, 115, 120, 125, 130],
  );
});

test("selectRelevantOptionStrikes anchors to spot when available", () => {
  assert.deepEqual(
    selectRelevantOptionStrikes({
      strikes: [100, 105, 110, 115, 120, 125, 130, 135, 140],
      spotPrice: 133,
      strikesAroundMoney: 2,
    }),
    [120, 125, 130, 135, 140],
  );
});

test("selectRelevantOptionStrikes preserves full coverage requests", () => {
  const strikes = [100, 105, 110, 115, 120, 125, 130];

  assert.deepEqual(
    selectRelevantOptionStrikes({
      strikes,
      spotPrice: 115,
      strikesAroundMoney: 1,
      strikeCoverage: "full",
    }),
    strikes,
  );
});

test("metadata option chains skip per-contract quote snapshots and retain underlying price", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const expirationDate = new Date("2099-05-01T00:00:00.000Z");
  const internals = provider as unknown as {
    refreshSession(): Promise<null>;
    resolveStockContract(symbol: string): Promise<Record<string, unknown>>;
    getQuoteSnapshots(symbols: string[]): Promise<Array<Record<string, unknown>>>;
    getOptionParametersForStock(
      symbol: string,
      resolvedUnderlying: Record<string, unknown>,
    ): Promise<Record<string, unknown>>;
    resolveOptionContract(input: {
      underlying: string;
      expirationDate: Date;
      strike: number;
      right: "call" | "put";
    }): Promise<Record<string, unknown>>;
    getContractQuoteSnapshot(): Promise<Record<string, unknown> | null>;
  };
  let quoteSnapshotCalls = 0;
  let optionContractDetailCalls = 0;

  internals.refreshSession = async () => null;
  internals.resolveStockContract = async () => ({
    resolved: {
      conid: 756733,
      symbol: "SPY",
      secType: "STK",
      listingExchange: "ARCA",
      providerContractId: "756733",
    },
    contract: { conId: 756733, symbol: "SPY", secType: SecType.STK },
    cachedAt: Date.now(),
  });
  internals.getQuoteSnapshots = async () => [
    {
      symbol: "SPY",
      price: 502,
      bid: 501.95,
      ask: 502.05,
    },
  ];
  internals.getOptionParametersForStock = async (_symbol, resolvedUnderlying) => ({
    resolvedUnderlying,
    optionParams: [{ expirations: ["20990501"], strikes: [500] }],
  });
  internals.resolveOptionContract = async () => {
    optionContractDetailCalls += 1;
    throw new Error("metadata chains should not perform per-contract details");
  };
  internals.getContractQuoteSnapshot = async () => {
    quoteSnapshotCalls += 1;
    return null;
  };

  const contracts = await provider.getOptionChain({
    underlying: "SPY",
    expirationDate,
    strikeCoverage: "full",
    quoteHydration: "metadata",
  });

  assert.equal(quoteSnapshotCalls, 0);
  assert.equal(optionContractDetailCalls, 0);
  assert.equal(contracts.length, 2);
  assert.ok(contracts[0]?.contract.providerContractId?.startsWith("twsopt:"));
  assert.equal(contracts[0]?.quoteFreshness, "metadata");
  assert.equal(contracts[0]?.bid, null);
  assert.equal(contracts[0]?.ask, null);
  assert.equal(contracts[0]?.last, null);
  assert.equal(contracts[0]?.mark, null);
  assert.equal(contracts[0]?.volume, null);
  assert.equal(contracts[0]?.openInterest, null);
  assert.equal(contracts[0]?.underlyingPrice, 502);
});

test("metadata option chains fall back to aggregate TWS secdef strikes", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const expirationDate = new Date("2099-05-01T00:00:00.000Z");
  const internals = provider as unknown as {
    refreshSession(): Promise<null>;
    resolveStockContract(symbol: string): Promise<Record<string, unknown>>;
    getQuoteSnapshots(symbols: string[]): Promise<Array<Record<string, unknown>>>;
    getOptionParametersForStock(
      symbol: string,
      resolvedUnderlying: Record<string, unknown>,
    ): Promise<Record<string, unknown>>;
    resolveOptionContract(input: {
      underlying: string;
      expirationDate: Date;
      strike: number;
      right: "call" | "put";
    }): Promise<Record<string, unknown>>;
  };
  let quoteSnapshotCalls = 0;
  let optionContractDetailCalls = 0;

  internals.refreshSession = async () => null;
  internals.resolveStockContract = async () => ({
    resolved: {
      conid: 265598,
      symbol: "AAPL",
      secType: "STK",
      listingExchange: "NASDAQ",
      providerContractId: "265598",
    },
    contract: { conId: 265598, symbol: "AAPL", secType: SecType.STK },
    cachedAt: Date.now(),
  });
  internals.getQuoteSnapshots = async () => {
    quoteSnapshotCalls += 1;
    return [];
  };
  internals.getOptionParametersForStock = async (_symbol, resolvedUnderlying) => ({
    resolvedUnderlying,
    optionParams: [
      { expirations: ["20990501"], strikes: [] },
      {
        exchange: "SMART",
        tradingClass: "AAPL",
        multiplier: "100",
        expirations: [],
        strikes: [190, 195, 200],
      },
    ],
  });
  internals.resolveOptionContract = async () => {
    optionContractDetailCalls += 1;
    throw new Error("metadata chains should not perform per-contract details");
  };

  const contracts = await provider.getOptionChain({
    underlying: "AAPL",
    expirationDate,
    contractType: "call",
    strikeCoverage: "full",
    quoteHydration: "metadata",
  });

  assert.equal(quoteSnapshotCalls, 1);
  assert.equal(optionContractDetailCalls, 0);
  assert.equal(contracts.length, 3);
  assert.deepEqual(
    contracts.map((contract) => contract.contract.strike),
    [190, 195, 200],
  );
  assert.ok(
    contracts.every((contract) =>
      contract.contract.providerContractId?.startsWith("twsopt:"),
    ),
  );
  assert.ok(
    contracts.every((contract) => contract.contract.underlying === "AAPL"),
  );
  assert.ok(
    contracts.every((contract) => contract.quoteFreshness === "metadata"),
  );
});

test("option contract resolution reuses in-flight metadata lookups", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    api: {
      getContractDetails(): Promise<Array<{ contract: Record<string, unknown> }>>;
    };
    connectionState: ConnectionState;
    managedAccounts: string[];
    baseSubscriptionsStarted: boolean;
    resolveOptionContract(input: {
      underlying: string;
      expirationDate: Date;
      strike: number;
      right: "call" | "put";
    }): Promise<Record<string, unknown>>;
  };
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.baseSubscriptionsStarted = true;
  internals.api = {
    getContractDetails: async () => {
      calls += 1;
      started();
      await releasePromise;
      return [
        {
          contract: {
            conId: 9001,
            symbol: "SPY",
            secType: SecType.OPT,
            lastTradeDateOrContractMonth: "20990501",
            strike: 500,
            right: "C",
            multiplier: "100",
            localSymbol: "SPY C 500",
          },
        },
      ];
    },
  };

  const input = {
    underlying: "SPY",
    expirationDate: new Date("2099-05-01T00:00:00.000Z"),
    strike: 500,
    right: "call" as const,
  };
  const first = internals.resolveOptionContract(input);
  await startedPromise;
  const second = internals.resolveOptionContract(input);
  release();
  const [firstResolved, secondResolved] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(firstResolved, secondResolved);
});

test("toQuoteSnapshot maps IBKR option volume and open-interest ticks", () => {
  const ticks = new Map<number, { value: number }>([
    [TickType.LAST, { value: 2.4 }],
    [TickType.BID, { value: 2.35 }],
    [TickType.ASK, { value: 2.45 }],
    [TickType.OPTION_CALL_VOLUME, { value: 812 }],
    [TickType.OPTION_CALL_OPEN_INTEREST, { value: 640 }],
  ]);

  const quote = toQuoteSnapshot(
    "SPY 20260515 C 500",
    "12345",
    ticks as never,
    MarketDataType.REALTIME,
  );

  assert.equal(quote.volume, 812);
  assert.equal(quote.openInterest, 640);
});

test("option activity snapshot timeout scales with batch size", () => {
  assert.equal(
    resolveOptionActivitySnapshotTimeoutMs({
      genericTickSampleMs: 500,
      symbolCount: 1,
    }),
    1_000,
  );
  assert.equal(
    resolveOptionActivitySnapshotTimeoutMs({
      genericTickSampleMs: 500,
      symbolCount: 30,
    }),
    15_500,
  );
  assert.equal(
    resolveOptionActivitySnapshotTimeoutMs({
      genericTickSampleMs: 10_000,
      symbolCount: 60,
    }),
    20_000,
  );
});

test("option activity snapshots tolerate per-symbol contract failures", async () => {
  __resetBridgeSchedulerForTests();
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    refreshSession(): Promise<void>;
    resolveStockContract(symbol: string): Promise<{
      contract: Record<string, unknown>;
      resolved: { conid: number; providerContractId: string };
    }>;
    getContractQuoteStreamSample(input: {
      symbol: string;
      providerContractId: string | null;
    }): Promise<Record<string, unknown> | null>;
    recordError(error: unknown): void;
  };
  const recordedErrors: string[] = [];

  internals.refreshSession = async () => {};
  internals.resolveStockContract = async (symbol) => {
    if (symbol === "BAD") {
      throw new Error("No security definition has been found for the request");
    }
    return {
      contract: { symbol, secType: SecType.STK },
      resolved: {
        conid: symbol === "SPY" ? 756733 : 320227571,
        providerContractId: symbol,
      },
    };
  };
  internals.getContractQuoteStreamSample = async ({ symbol, providerContractId }) => ({
    symbol,
    providerContractId,
    price: 100,
    optionCallVolume: symbol === "SPY" ? 1000 : 500,
  });
  internals.recordError = (error) => {
    recordedErrors.push(error instanceof Error ? error.message : String(error));
  };

  const quotes = await provider.getOptionActivitySnapshots(["SPY", "BAD", "QQQ"]);
  const marketLane = getBridgeSchedulerDiagnostics()["market-subscriptions"];

  assert.deepEqual(
    quotes.map((quote) => quote.symbol),
    ["SPY", "QQQ"],
  );
  assert.deepEqual(recordedErrors, [
    "No security definition has been found for the request",
  ]);
  assert.equal(marketLane.completed, 1);
  assert.equal(marketLane.timedOut, 0);
  assert.equal(marketLane.failureCount, 0);
});

test("quote subscriptions tolerate per-symbol contract failures", async () => {
  __resetBridgeSchedulerForTests();
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    refreshSession(): Promise<void>;
    resolveStockContract(symbol: string): Promise<{
      contract: Record<string, unknown>;
      resolved: { conid: number; providerContractId: string };
    }>;
    ensureQuoteSubscription(input: {
      resolved: { providerContractId: string };
    }): Promise<string>;
    ensureQuoteSubscriptionsForSymbols(symbols: string[]): Promise<Map<string, string>>;
    recordError(error: unknown): void;
  };
  const recordedErrors: string[] = [];

  internals.refreshSession = async () => {};
  internals.resolveStockContract = async (symbol) => {
    if (symbol === "BAD") {
      throw new Error("No security definition has been found for the request");
    }
    return {
      contract: { symbol, secType: SecType.STK },
      resolved: {
        conid: symbol === "SPY" ? 756733 : 320227571,
        providerContractId: symbol,
      },
    };
  };
  internals.ensureQuoteSubscription = async ({ resolved }) =>
    resolved.providerContractId;
  internals.recordError = (error) => {
    recordedErrors.push(error instanceof Error ? error.message : String(error));
  };

  const ensured = await internals.ensureQuoteSubscriptionsForSymbols([
    "SPY",
    "BAD",
    "QQQ",
  ]);
  const marketLane = getBridgeSchedulerDiagnostics()["market-subscriptions"];

  assert.deepEqual([...ensured.keys()], ["SPY", "QQQ"]);
  assert.deepEqual(recordedErrors, [
    "No security definition has been found for the request",
  ]);
  assert.equal(marketLane.completed, 1);
  assert.equal(marketLane.timedOut, 0);
  assert.equal(marketLane.failureCount, 0);
});

test("detects nested IBKR snapshot generic-tick validation errors", () => {
  assert.equal(
    isSnapshotGenericTickError({
      error: new Error(
        "Error validating request.-'bO' : cause - Snapshot market data subscription is not applicable to generic ticks",
      ),
    }),
    true,
  );
});

test("generic tick quote hydration uses streaming market data instead of snapshots", async () => {
  const previousSampleMs = process.env["IBKR_GENERIC_TICK_SAMPLE_MS"];
  process.env["IBKR_GENERIC_TICK_SAMPLE_MS"] = "5";
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  if (previousSampleMs === undefined) {
    delete process.env["IBKR_GENERIC_TICK_SAMPLE_MS"];
  } else {
    process.env["IBKR_GENERIC_TICK_SAMPLE_MS"] = previousSampleMs;
  }

  const internals = provider as unknown as {
    api: {
      getMarketData(
        contract: Record<string, unknown>,
        genericTickList: string,
        snapshot: boolean,
        regulatorySnapshot: boolean,
      ): {
        subscribe(observer: {
          next(update: { all: Map<number, { value: number }> }): void;
        }): { unsubscribe(): void };
      };
      getMarketDataSnapshot(): Promise<Map<number, { value: number }>>;
      setMarketDataType(type: MarketDataType): void;
    };
    connectionState: ConnectionState;
    getContractQuoteSnapshot(input: {
      contract: Record<string, unknown>;
      symbol: string;
      providerContractId: string | null;
      genericTickList?: string;
    }): Promise<{
      volume: number;
      openInterest: number;
      providerContractId: string | null;
    } | null>;
  };
  let snapshotCalls = 0;
  let streamGenericTicks: string | null = null;
  let unsubscribed = false;

  internals.connectionState = ConnectionState.Connected;
  internals.api = {
    getMarketData: (_contract, genericTickList) => {
      streamGenericTicks = genericTickList;
      return {
        subscribe: (observer) => {
          observer.next({
            all: new Map<number, { value: number }>([
              [TickType.LAST, { value: 2.4 }],
              [TickType.OPTION_CALL_VOLUME, { value: 812 }],
              [TickType.OPTION_CALL_OPEN_INTEREST, { value: 640 }],
            ]),
          });
          return {
            unsubscribe() {
              unsubscribed = true;
            },
          };
        },
      };
    },
    getMarketDataSnapshot: async () => {
      snapshotCalls += 1;
      return new Map();
    },
    setMarketDataType: () => {},
  };

  const quote = await internals.getContractQuoteSnapshot({
    contract: { conId: 12345, secType: SecType.OPT, exchange: "SMART" },
    symbol: "SPY 20990501 C 500",
    providerContractId: "12345",
    genericTickList: "100,101,106",
  });

  assert.equal(snapshotCalls, 0);
  assert.equal(streamGenericTicks, "100,101,106");
  assert.equal(unsubscribed, true);
  assert.equal(quote?.providerContractId, "12345");
  assert.equal(quote?.volume, 812);
  assert.equal(quote?.openInterest, 640);
});

test("detects IBKR historical cancellation 2523 as reconnectable", () => {
  assert.equal(
    isHistoricalDataReconnectableError(
      new Error(
        "Historical Market Data Service error message:API historical data query cancelled: 2523",
      ),
    ),
    true,
  );
});

test("request-scoped market data errors do not poison connected bridge health", () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    connectionState: ConnectionState;
    lastError: string | null;
    recordError(error: unknown): void;
  };

  internals.connectionState = ConnectionState.Connected;
  internals.recordError(
    new Error(
      "Error validating request.-'bO' : cause - Snapshot market data subscription is not applicable to generic ticks",
    ),
  );
  assert.equal(internals.lastError, null);
  internals.recordError(
    new Error("No security definition has been found for the request"),
  );
  assert.equal(internals.lastError, null);
  internals.recordError(new Error("Can't find EId with tickerId:904"));
  assert.equal(internals.lastError, null);
  internals.recordError(
    new Error(
      "Lane timed out after 2000ms. | IBKR bridge lane control lane timed out after 2000ms.",
    ),
  );
  assert.equal(internals.lastError, null);

  internals.recordError(new Error("socket disconnected"));
  assert.equal(internals.lastError, "socket disconnected");
});

test("reestablishes TWS connection and retries cancelled historical bars once", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    api: {
      connect(clientId?: number): void;
      disconnect(): void;
      setMarketDataType(type: MarketDataType): void;
      getManagedAccounts(): Promise<string[]>;
      getAccountSummary(
        group: string,
        tags: string,
      ): { subscribe(): { unsubscribe(): void } };
      getPositions(): { subscribe(): { unsubscribe(): void } };
      getAccountUpdates(): { subscribe(): { unsubscribe(): void } };
      getOpenOrders(): { subscribe(): { unsubscribe(): void } };
      getHistoricalData(): Promise<
        Array<{
          time: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }>
      >;
    };
    connectionState: ConnectionState;
    managedAccounts: string[];
    baseSubscriptionsStarted: boolean;
  };
  let calls = 0;
  let reconnects = 0;
  const subscribe = () => ({ unsubscribe() {} });

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.baseSubscriptionsStarted = true;
  internals.api = {
    connect: () => {
      reconnects += 1;
      internals.connectionState = ConnectionState.Connected;
    },
    disconnect: () => {
      internals.connectionState = ConnectionState.Disconnected;
    },
    setMarketDataType: () => {},
    getManagedAccounts: async () => ["U1"],
    getAccountSummary: () => ({ subscribe }),
    getPositions: () => ({ subscribe }),
    getAccountUpdates: () => ({ subscribe }),
    getOpenOrders: () => ({ subscribe }),
    getHistoricalData: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error(
          "Historical Market Data Service error message:API historical data query cancelled: 2523",
        );
      }

      return [
        {
          time: "20260427 16:00:00",
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 10,
        },
      ];
    },
  };

  const bars = await provider.getHistoricalBars({
    symbol: "SPY",
    timeframe: "1m",
    assetClass: "option",
    providerContractId: "12345",
    limit: 1,
  });

  assert.equal(calls, 2);
  assert.equal(reconnects, 1);
  assert.equal(bars.length, 1);
  assert.equal(bars[0]?.close, 1.5);
});

test("historical bar stream accepts synchronous TWS emissions", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    api: {
      getManagedAccounts(): Promise<string[]>;
      getHistoricalDataUpdates(): {
        subscribe(observer: {
          next(value: unknown): void;
        }): { unsubscribe(): void };
      };
    };
    connectionState: ConnectionState;
    managedAccounts: string[];
    baseSubscriptionsStarted: boolean;
  };
  let unsubscribed = false;

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.baseSubscriptionsStarted = true;
  internals.api = {
    getManagedAccounts: async () => ["U1"],
    getHistoricalDataUpdates: () => ({
      subscribe: (observer) => {
        observer.next([
          {
            time: "20260427 16:00:00",
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 10,
          },
        ]);

        return {
          unsubscribe: () => {
            unsubscribed = true;
          },
        };
      },
    }),
  };

  const bars: Array<{ close: number }> = [];
  const unsubscribe = await provider.subscribeHistoricalBarStream(
    {
      symbol: "SPY",
      timeframe: "1m",
      assetClass: "option",
      providerContractId: "12345",
    },
    (bar) => {
      bars.push({ close: bar.close });
    },
  );

  assert.equal(bars.length, 1);
  assert.equal(bars[0]?.close, 1.5);
  unsubscribe();
  assert.equal(unsubscribed, true);
});

test("listOrders falls back to cached open orders when TWS order request stalls", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    api: {
      getManagedAccounts(): Promise<string[]>;
      getAllOpenOrders(): Promise<never>;
    };
    connectionState: ConnectionState;
    managedAccounts: string[];
    baseSubscriptionsStarted: boolean;
    liveOrdersById: Map<string, Record<string, unknown>>;
  };
  const updatedAt = new Date("2026-04-28T14:00:00.000Z");

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.baseSubscriptionsStarted = true;
  setBridgeRuntimeLimitOverrides({ openOrdersRequestTimeoutMs: 500 });
  internals.liveOrdersById.set("123", {
    id: "123",
    accountId: "U1",
    mode: "paper",
    symbol: "SPY",
    assetClass: "equity",
    side: "buy",
    type: "limit",
    timeInForce: "day",
    status: "submitted",
    quantity: 1,
    filledQuantity: 0,
    limitPrice: 700,
    stopPrice: null,
    placedAt: updatedAt,
    updatedAt,
    optionContract: null,
  });
  internals.api = {
    getManagedAccounts: async () => ["U1"],
    getAllOpenOrders: () => new Promise(() => {}),
  };

  const startedAt = Date.now();
  const result = await provider.listOrders({ accountId: "U1", mode: "paper" });

  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0]?.id, "123");
  assert.equal(result.degraded, true);
  assert.equal(result.reason, "open_orders_timeout");
  assert.equal(result.stale, true);
  assert.ok(Date.now() - startedAt < 1_000);
});

test("listOrders uses initialized live order cache without direct snapshot read", async () => {
  const provider = new TwsIbkrBridgeProvider({
    host: "127.0.0.1",
    port: 4002,
    clientId: 101,
    defaultAccountId: "U1",
    mode: "paper",
    marketDataType: MarketDataType.REALTIME,
  });
  const internals = provider as unknown as {
    api: {
      getManagedAccounts(): Promise<string[]>;
      getAllOpenOrders(): Promise<never>;
    };
    connectionState: ConnectionState;
    managedAccounts: string[];
    baseSubscriptionsStarted: boolean;
    openOrdersInitialized: boolean;
    liveOrdersById: Map<string, Record<string, unknown>>;
  };
  const updatedAt = new Date("2026-04-28T14:00:00.000Z");
  let directSnapshotCalls = 0;

  internals.connectionState = ConnectionState.Connected;
  internals.managedAccounts = ["U1"];
  internals.baseSubscriptionsStarted = true;
  internals.openOrdersInitialized = true;
  internals.liveOrdersById.set("123", {
    id: "123",
    accountId: "U1",
    mode: "paper",
    symbol: "SPY",
    assetClass: "equity",
    side: "buy",
    type: "limit",
    timeInForce: "day",
    status: "submitted",
    quantity: 1,
    filledQuantity: 0,
    limitPrice: 700,
    stopPrice: null,
    placedAt: updatedAt,
    updatedAt,
    optionContract: null,
  });
  internals.api = {
    getManagedAccounts: async () => ["U1"],
    getAllOpenOrders: () => {
      directSnapshotCalls += 1;
      return new Promise(() => {});
    },
  };

  const result = await provider.listOrders({ accountId: "U1", mode: "paper" });

  assert.equal(directSnapshotCalls, 0);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0]?.id, "123");
  assert.equal(result.degraded, undefined);
  assert.equal(result.reason, undefined);
  assert.equal(result.stale, undefined);
});
