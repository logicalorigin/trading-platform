import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSnapTradeAccountPanelData,
  resolveAccountProviderScope,
} from "./snapTradeAccountPanelModel.js";

test("resolveAccountProviderScope identifies shadow, specific, and mixed account scopes", () => {
  const accounts = [
    { id: "ibkr:U1", provider: "ibkr" },
    { id: "snaptrade:acct-1", provider: "snaptrade" },
    { id: "robinhood:acct-1", provider: "robinhood" },
    { id: "schwab:acct-1", provider: "schwab" },
  ];

  assert.equal(resolveAccountProviderScope({ accountTab: "shadow", accounts }), "shadow");
  assert.equal(
    resolveAccountProviderScope({ accountTab: "snaptrade:acct-1", accounts }),
    "snaptrade",
  );
  assert.equal(resolveAccountProviderScope({ accountTab: "ibkr:U1", accounts }), "ibkr");
  assert.equal(
    resolveAccountProviderScope({ accountTab: "robinhood:acct-1", accounts }),
    "robinhood",
  );
  assert.equal(
    resolveAccountProviderScope({ accountTab: "schwab:acct-1", accounts }),
    "schwab",
  );
  assert.equal(resolveAccountProviderScope({ accountTab: "all", accounts }), "mixed");
});

test("buildSnapTradeAccountPanelData maps portfolio balances and positions into account panel shapes", () => {
  const data = buildSnapTradeAccountPanelData({
    account: {
      id: "snaptrade:acct-1",
      displayName: "E*TRADE Growth",
      currency: "USD",
      provider: "snaptrade",
    },
    portfolio: {
      syncedAt: "2026-07-02T20:00:00.000Z",
      account: {
        id: "snaptrade:acct-1",
        displayName: "E*TRADE Growth",
        baseCurrency: "USD",
      },
      balances: [{ currency: "USD", cash: 100, buyingPower: 200 }],
      positions: [
        {
          snapTradePositionId: "stock:AAPL",
          symbol: "AAPL",
          rawSymbol: "AAPL",
          description: "Apple Inc.",
          instrumentKind: "equity",
          assetClass: "equity",
          quantity: 2,
          side: "long",
          price: 150,
          averagePurchasePrice: 125,
          marketValue: 300,
          costBasis: 250,
          unrealizedPnl: 50,
          currency: "USD",
          cashEquivalent: false,
        },
      ],
      totals: {
        cash: 100,
        buyingPower: 200,
        positionMarketValue: 300,
        netLiquidation: 400,
        positionCount: 1,
      },
      dataFreshness: { asOf: "2026-07-02T20:00:00.000Z" },
    },
    now: new Date("2026-07-02T20:00:00.000Z"),
  });

  assert.equal(data.summary.metrics.netLiquidation.value, 400);
  assert.equal(data.summary.metrics.netLiquidation.source, "SNAPTRADE_PORTFOLIO");
  assert.equal(data.summary.metrics.totalCash.value, 100);
  assert.equal(data.summary.metrics.unrealizedPnl.value, 50);
  assert.equal(data.positions.positions[0].symbol, "AAPL");
  assert.equal(data.positions.positions[0].positionType, "stock");
  assert.equal(data.positions.positions[0].source, "SNAPTRADE_POSITIONS");
  assert.equal(data.positions.positions[0].unrealizedPnl, 50);
  assert.equal(data.positions.positions[0].unrealizedPnlPercent, 20);
  assert.equal(data.positions.positions[0].brokerUnrealizedPnl, 50);
  assert.equal(data.positions.totals.unrealizedPnl, 50);
  assert.deepEqual(data.allocation.exposure, {
    grossLong: 300,
    grossShort: 0,
    netExposure: 300,
  });
  assert.deepEqual(data.equityHistory.points, [
    {
      timestamp: "2026-07-02T20:00:00.000Z",
      netLiquidation: 400,
      currency: "USD",
      source: "SNAPTRADE_PORTFOLIO",
      deposits: 0,
      withdrawals: 0,
      dividends: 0,
      fees: 0,
      returnPercent: 0,
      benchmarkPercent: null,
    },
  ]);
  assert.equal(data.equityHistory.latestSnapshotAt, "2026-07-02T20:00:00.000Z");
  assert.equal(data.positionsAtDate.positions.length, 1);
  assert.equal(data.positionsAtDate.totals.unrealizedPnl, 50);
  assert.deepEqual(data.positionsAtDate.totals.balance, {
    netLiquidation: 400,
    dayPnl: null,
    cash: 100,
    buyingPower: 200,
  });
  assert.equal(data.cash.totalCash, 100);
  assert.equal(data.risk, null);
});

test("buildSnapTradeAccountPanelData uses reported net liquidation when cash and positions are absent", () => {
  const fallback = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:acct-1", currency: "USD", provider: "snaptrade" },
    portfolio: {
      syncedAt: "2026-07-02T20:00:00.000Z",
      account: { id: "snaptrade:acct-1", baseCurrency: "USD" },
      balances: [],
      positions: [],
      totals: { netLiquidation: 5000 },
      dataFreshness: { asOf: "2026-07-02T20:00:00.000Z" },
    },
    now: new Date("2026-07-02T20:00:00.000Z"),
  });

  assert.equal(fallback.summary.metrics.netLiquidation.value, 5000);
  assert.equal(fallback.positions.totals.netLiquidation, 5000);

  const mathWins = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:acct-1", currency: "USD", provider: "snaptrade" },
    portfolio: {
      syncedAt: "2026-07-02T20:00:00.000Z",
      account: { id: "snaptrade:acct-1", baseCurrency: "USD" },
      balances: [{ currency: "USD", cash: 100, buyingPower: 100 }],
      positions: [
        {
          symbol: "AAPL",
          assetClass: "equity",
          quantity: 2,
          price: 150,
          marketValue: 300,
          currency: "USD",
        },
      ],
      totals: { netLiquidation: 5000 },
      dataFreshness: { asOf: "2026-07-02T20:00:00.000Z" },
    },
    now: new Date("2026-07-02T20:00:00.000Z"),
  });

  assert.equal(mathWins.summary.metrics.netLiquidation.value, 400);
});

test("buildSnapTradeAccountPanelData merges SnapTrade history into calendar and equity shapes", () => {
  const data = buildSnapTradeAccountPanelData({
    account: {
      id: "snaptrade:acct-1",
      displayName: "E*TRADE History",
      currency: "USD",
      provider: "snaptrade",
    },
    portfolio: {
      syncedAt: "2026-07-02T20:00:00.000Z",
      account: {
        id: "snaptrade:acct-1",
        displayName: "E*TRADE History",
        baseCurrency: "USD",
      },
      balances: [{ currency: "USD", cash: 100, buyingPower: 100 }],
      positions: [{ symbol: "AAPL", assetClass: "equity", quantity: 1, price: 110 }],
      totals: {
        cash: 100,
        buyingPower: 100,
        positionMarketValue: 110,
        netLiquidation: 210,
        positionCount: 1,
      },
      dataFreshness: { asOf: "2026-07-02T20:00:00.000Z" },
    },
    history: {
      closedTrades: {
        accountId: "snaptrade:acct-1",
        currency: "USD",
        trades: [
          {
            id: "snaptrade-activity:open:close:1",
            source: "SNAPTRADE_ACTIVITY",
            accountId: "snaptrade:acct-1",
            symbol: "BLDP",
            positionType: "option",
            realizedPnl: 88,
          },
        ],
        summary: { count: 1, realizedPnl: 88, commissions: 2 },
        updatedAt: "2026-07-02T19:00:00.000Z",
      },
      equityHistory: {
        accountId: "snaptrade:acct-1",
        range: "ALL",
        currency: "USD",
        terminalPointSource: "snaptrade_balance_history",
        liveTerminalIncluded: false,
        selectedSnapshotSource: "SNAPTRADE_BALANCE_HISTORY",
        points: [
          {
            timestamp: "2026-06-01T21:00:00.000Z",
            netLiquidation: 100,
            currency: "USD",
            source: "SNAPTRADE_BALANCE_HISTORY",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 0,
            benchmarkPercent: null,
          },
          {
            timestamp: "2026-06-15T21:00:00.000Z",
            netLiquidation: 150,
            currency: "USD",
            source: "SNAPTRADE_BALANCE_HISTORY",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: 0,
            returnPercent: 50,
            benchmarkPercent: null,
          },
        ],
        events: [{ timestamp: "2026-06-10T00:00:00.000Z", type: "dividend", amount: 5, currency: "USD", source: "SNAPTRADE_ACTIVITY" }],
        updatedAt: "2026-07-02T19:00:00.000Z",
      },
    },
    range: "ALL",
    now: new Date("2026-07-02T20:00:00.000Z"),
  });

  assert.equal(data.closedTrades.trades.length, 1);
  assert.equal(data.closedTrades.trades[0].source, "SNAPTRADE_ACTIVITY");
  assert.equal(data.closedTrades.summary.realizedPnl, 88);
  assert.equal(data.equityHistory.points.length, 3);
  assert.equal(data.equityHistory.points[0].source, "SNAPTRADE_BALANCE_HISTORY");
  assert.equal(data.equityHistory.points[1].returnPercent, 50);
  assert.equal(data.equityHistory.points[2].source, "SNAPTRADE_PORTFOLIO");
  assert.equal(data.equityHistory.points[2].netLiquidation, 210);
  assert.equal(data.equityHistory.points[2].returnPercent, 110);
  assert.equal(data.equityHistory.terminalPointSource, "snaptrade_portfolio");
  assert.equal(data.equityHistory.liveTerminalIncluded, true);
  assert.equal(data.equityHistory.events.length, 1);
});

test("buildSnapTradeAccountPanelData normalizes E*TRADE SnapTrade option positions", () => {
  const data = buildSnapTradeAccountPanelData({
    account: {
      id: "snaptrade:acct-1",
      displayName: "E*TRADE Roth IRA",
      currency: "USD",
      provider: "snaptrade",
    },
    portfolio: {
      syncedAt: "2026-07-02T20:00:00.000Z",
      account: {
        id: "snaptrade:acct-1",
        displayName: "E*TRADE Roth IRA",
        baseCurrency: "USD",
      },
      balances: [{ currency: "USD", cash: 7.98, buyingPower: 7.98 }],
      positions: [
        {
          snapTradePositionId: "option:OPTT  260821C00000500",
          symbol: "OPTT  260821C00000500",
          rawSymbol: "OPTT  260821C00000500",
          description: "OPTT Aug 21 2026 0.5 Call",
          instrumentKind: "option",
          assetClass: "option",
          quantity: 20,
          side: "long",
          price: 0.17,
          averagePurchasePrice: 83.51,
          marketValue: 3.4,
          costBasis: 1670.2,
          unrealizedPnl: -1666.8,
          currency: "USD",
          cashEquivalent: false,
        },
      ],
      totals: {
        cash: 7.98,
        buyingPower: 7.98,
        positionMarketValue: 3.4,
        netLiquidation: 11.38,
        positionCount: 1,
      },
      dataFreshness: { asOf: "2026-07-02T20:00:00.000Z" },
    },
    now: new Date("2026-07-02T20:00:00.000Z"),
  });

  assert.equal(data.positions.positions.length, 1);
  assert.deepEqual(data.positions.positions[0].optionContract, {
    ticker: "OPTT260821C00000500",
    underlying: "OPTT",
    expirationDate: "2026-08-21",
    strike: 0.5,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: null,
    brokerContractId: null,
  });
  assert.equal(data.positions.positions[0].symbol, "OPTT");
  assert.equal(data.positions.positions[0].marketDataSymbol, "OPTT");
  assert.equal(data.positions.positions[0].positionType, "option");
  assert.equal(data.positions.positions[0].assetClass, "Option");
  assert.equal(data.positions.positions[0].averageCost, 0.8351);
  assert.equal(data.positions.positions[0].mark, 0.17);
  assert.equal(data.positions.positions[0].marketValue, 340);
  assert.equal(data.positions.positions[0].unrealizedPnl, -1330.2);
  assert.equal(data.positions.positions[0].brokerUnrealizedPnl, -1330.2);
  assert.equal(data.positions.totals.marketValue, 340);
  assert.equal(data.positions.totals.unrealizedPnl, -1330.2);
  assert.equal(data.positions.totals.netLiquidation, 347.98);
  assert.equal(data.summary.metrics.grossPositionValue.value, 340);
  assert.equal(data.summary.metrics.unrealizedPnl.value, -1330.2);
  assert.equal(data.summary.metrics.netLiquidation.value, 347.98);
  assert.equal(data.equityHistory.points.length, 1);
  assert.equal(data.equityHistory.points[0].netLiquidation, 347.98);
  assert.equal(data.positionsAtDate.totals.marketValue, 340);
  assert.equal(data.positionsAtDate.totals.unrealizedPnl, -1330.2);
  assert.equal(data.positionsAtDate.totals.balance.netLiquidation, 347.98);
});

test("buildSnapTradeAccountPanelData de-scales a SHORT contract-scaled option premium (negative/credit cost basis)", () => {
  const data = buildSnapTradeAccountPanelData({
    account: {
      id: "snaptrade:acct-1",
      displayName: "E*TRADE Roth IRA",
      currency: "USD",
      provider: "snaptrade",
    },
    portfolio: {
      syncedAt: "2026-07-02T20:00:00.000Z",
      account: {
        id: "snaptrade:acct-1",
        displayName: "E*TRADE Roth IRA",
        baseCurrency: "USD",
      },
      balances: [{ currency: "USD", cash: 2000, buyingPower: 2000 }],
      positions: [
        {
          snapTradePositionId: "option:OPTT  260821C00000500",
          symbol: "OPTT  260821C00000500",
          rawSymbol: "OPTT  260821C00000500",
          description: "OPTT Aug 21 2026 0.5 Call",
          instrumentKind: "option",
          assetClass: "option",
          quantity: 3,
          side: "short",
          price: 4,
          averagePurchasePrice: 500,
          marketValue: -12,
          costBasis: -1500,
          unrealizedPnl: 1488,
          currency: "USD",
          cashEquivalent: false,
        },
      ],
      totals: {
        cash: 2000,
        buyingPower: 2000,
        positionMarketValue: -12,
        netLiquidation: 1988,
        positionCount: 1,
      },
      dataFreshness: { asOf: "2026-07-02T20:00:00.000Z" },
    },
    now: new Date("2026-07-02T20:00:00.000Z"),
  });

  const position = data.positions.positions[0];
  // Contract-scaled premium (500 = $5/share * 100) de-scales to per-share $5 even
  // though the short reports a negative/credit cost basis.
  assert.equal(position.averageCost, 5);
  assert.equal(position.quantity, -3);
  assert.equal(position.marketValue, -1200);
  assert.equal(position.unrealizedPnl, 300);
  assert.equal(position.unrealizedPnlPercent, 20);
  assert.equal(position.brokerUnrealizedPnl, 300);
});

test("buildSnapTradeAccountPanelData maps recent orders by working/history tab", () => {
  const common = {
    account: { id: "snaptrade:acct-1", currency: "USD", provider: "snaptrade" },
    portfolio: {
      syncedAt: "2026-07-02T20:00:00.000Z",
      account: { id: "snaptrade:acct-1", baseCurrency: "USD" },
      balances: [],
      positions: [],
      totals: {},
      dataFreshness: { asOf: "2026-07-02T20:00:00.000Z" },
    },
    recentOrders: {
      checkedAt: "2026-07-02T20:01:00.000Z",
      orders: [
        {
          brokerageOrderId: "open-1",
          status: "OPEN",
          symbol: "MSFT",
          action: "BUY",
          totalQuantity: 1,
          filledQuantity: 0,
          orderType: "Limit",
          timeInForce: "Day",
          timePlaced: "2026-07-02T20:00:30.000Z",
        },
        {
          brokerageOrderId: "filled-1",
          status: "FILLED",
          symbol: "AAPL",
          action: "SELL",
          totalQuantity: 1,
          filledQuantity: 1,
          orderType: "Market",
          timeInForce: "Day",
          timePlaced: "2026-07-02T19:00:00.000Z",
          timeExecuted: "2026-07-02T19:00:02.000Z",
        },
      ],
    },
  };

  const working = buildSnapTradeAccountPanelData({
    ...common,
    orderTab: "working",
  });
  const history = buildSnapTradeAccountPanelData({
    ...common,
    orderTab: "history",
  });

  assert.deepEqual(
    working.orders.orders.map((order) => [order.id, order.status, order.type]),
    [["open-1", "accepted", "limit"]],
  );
  assert.equal(working.orders.orders[0].brokerOrderId, "open-1");
  const groupOnly = buildSnapTradeAccountPanelData({
    ...common,
    orderTab: "working",
    recentOrders: {
      ...common.recentOrders,
      orders: [
        {
          ...common.recentOrders.orders[0],
          brokerageOrderId: null,
          brokerageGroupOrderId: "group-only-1",
        },
      ],
    },
  });
  assert.equal(groupOnly.orders.orders[0].id, "group-only-1");
  assert.equal(groupOnly.orders.orders[0].brokerOrderId, null);
  assert.deepEqual(
    history.orders.orders.map((order) => [order.id, order.status, order.side]),
    [["filled-1", "filled", "sell"]],
  );
});
