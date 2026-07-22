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

test("buildSnapTradeAccountPanelData maps server-normalized E*TRADE option positions", () => {
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
          averagePurchasePrice: 0.8351,
          marketValue: 340,
          costBasis: 1670.2,
          unrealizedPnl: -1330.2,
          currency: "USD",
          cashEquivalent: false,
          optionContract: {
            ticker: "OPTT260821C00000500",
            underlying: "OPTT",
            expirationDate: "2026-08-21",
            strike: 0.5,
            right: "call",
            multiplier: 100,
            sharesPerContract: 100,
          },
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
  assert.equal(data.positionsAtDate.totals.marketValue, 340);
  assert.equal(data.positionsAtDate.totals.unrealizedPnl, -1330.2);
  assert.equal(data.positionsAtDate.totals.balance.netLiquidation, 347.98);
});

test("buildSnapTradeAccountPanelData preserves server-normalized short option money", () => {
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
          averagePurchasePrice: 5,
          marketValue: -1200,
          costBasis: -1500,
          unrealizedPnl: 300,
          currency: "USD",
          cashEquivalent: false,
          optionContract: {
            ticker: "OPTT260821C00000500",
            underlying: "OPTT",
            expirationDate: "2026-08-21",
            strike: 0.5,
            right: "call",
            multiplier: 100,
            sharesPerContract: 100,
          },
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
  assert.equal(position.averageCost, 5);
  assert.equal(position.quantity, -3);
  assert.equal(position.marketValue, -1200);
  assert.equal(position.unrealizedPnl, 300);
  assert.equal(position.unrealizedPnlPercent, 20);
  assert.equal(position.brokerUnrealizedPnl, 300);
});

test("SnapTrade option economics reject nonpositive multipliers before adjusted shares", () => {
  const data = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:adjusted", currency: "USD", provider: "snaptrade" },
    portfolio: {
      syncedAt: "2026-07-21T20:00:00.000Z",
      account: { id: "snaptrade:adjusted", baseCurrency: "USD" },
      balances: [{ currency: "USD", cash: 100, buyingPower: 100 }],
      positions: [
        {
          snapTradePositionId: "adjusted-option",
          symbol: "ADJ",
          assetClass: "option",
          quantity: 2,
          side: "long",
          price: 3,
          averagePurchasePrice: 2,
          currency: "USD",
          optionContract: {
            underlying: "ADJ",
            expirationDate: "2026-08-21",
            strike: 10,
            right: "call",
            multiplier: 0,
            sharesPerContract: 50,
          },
        },
      ],
      dataFreshness: { asOf: "2026-07-21T20:00:00.000Z" },
    },
  });
  const position = data.positions.positions[0];

  assert.equal(position.optionContract.multiplier, 50);
  assert.equal(position.marketValue, 300);
  assert.equal(position.unrealizedPnl, 100);
});

test("SnapTrade option economics stay unknown for invalid or unverified multipliers", () => {
  const data = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:unknown", currency: "USD", provider: "snaptrade" },
    portfolio: {
      syncedAt: "2026-07-21T20:00:00.000Z",
      account: { id: "snaptrade:unknown", baseCurrency: "USD" },
      balances: [{ currency: "USD", cash: 100, buyingPower: 100 }],
      positions: [
        {
          snapTradePositionId: "invalid-option",
          symbol: "ADJUSTED",
          assetClass: "option",
          quantity: 2,
          side: "long",
          price: 3,
          averagePurchasePrice: 2,
          currency: "USD",
          optionContract: {
            underlying: "ADJ",
            expirationDate: "2026-08-21",
            strike: 10,
            right: "call",
            multiplier: 0,
            sharesPerContract: 0,
          },
        },
        {
          snapTradePositionId: "unverified-option",
          symbol: "PRIVATE-CONTRACT",
          assetClass: "option",
          quantity: 1,
          side: "long",
          price: 4,
          averagePurchasePrice: 2,
          currency: "USD",
          optionContract: {
            underlying: "PRIVATE",
            expirationDate: "2026-08-21",
            strike: 20,
            right: "put",
          },
        },
        {
          snapTradePositionId: "occ-shaped-unverified-option",
          symbol: "AAPL  260821C00200000",
          rawSymbol: "AAPL  260821C00200000",
          assetClass: "option",
          quantity: 1,
          side: "long",
          price: 4,
          averagePurchasePrice: 2,
          costBasis: 200,
          currency: "USD",
        },
      ],
      dataFreshness: { asOf: "2026-07-21T20:00:00.000Z" },
    },
  });

  for (const position of data.positions.positions) {
    assert.equal(position.optionContract.multiplier, null);
    assert.equal(position.averageCost, null);
    assert.equal(position.marketValue, null);
    assert.equal(position.unrealizedPnl, null);
  }
  assert.equal(data.positions.totals.marketValue, null);
  assert.equal(data.positions.totals.unrealizedPnl, null);
});

test("SnapTrade position totals stay unavailable when any row lacks valuation inputs", () => {
  const data = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:partial", currency: "USD", provider: "snaptrade" },
    portfolio: {
      syncedAt: "2026-07-21T20:00:00.000Z",
      account: { id: "snaptrade:partial", baseCurrency: "USD" },
      balances: [{ currency: "USD", cash: 100, buyingPower: 200 }],
      positions: [
        {
          snapTradePositionId: "known",
          symbol: "AAPL",
          assetClass: "equity",
          quantity: 2,
          price: 150,
          unrealizedPnl: 25,
          currency: "USD",
        },
        {
          snapTradePositionId: "unknown",
          symbol: "MSFT",
          assetClass: "equity",
          quantity: null,
          price: null,
          marketValue: null,
          unrealizedPnl: null,
          currency: "USD",
        },
      ],
      totals: {
        cash: 100,
        positionMarketValue: 300,
        unrealizedPnl: 25,
        netLiquidation: 400,
      },
      dataFreshness: { asOf: "2026-07-21T20:00:00.000Z" },
    },
  });

  const unknown = data.positions.positions[1];
  assert.equal(unknown.quantity, null);
  assert.equal(unknown.mark, null);
  assert.equal(unknown.marketValue, null);
  assert.equal(unknown.unrealizedPnl, null);
  assert.equal(data.positions.totals.marketValue, null);
  assert.equal(data.positions.totals.unrealizedPnl, null);
  assert.equal(data.positions.totals.netLiquidation, null);
  assert.deepEqual(data.allocation.exposure, {
    grossLong: null,
    grossShort: null,
    netExposure: null,
  });
  assert.equal(data.allocation.assetClass, null);
});

test("SnapTrade client mapping prefers normalized provider money over quote reconstruction", () => {
  const data = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:authority", currency: "USD", provider: "snaptrade" },
    portfolio: {
      account: { id: "snaptrade:authority", baseCurrency: "USD" },
      balances: [{ currency: "USD", cash: 10, buyingPower: 10 }],
      positions: [
        {
          snapTradePositionId: "stock:AUTH",
          symbol: "AUTH",
          assetClass: "equity",
          quantity: 2,
          price: 150,
          averagePurchasePrice: 125,
          marketValue: 290,
          costBasis: 250,
          unrealizedPnl: 40,
          currency: "USD",
        },
      ],
    },
  });

  const position = data.positions.positions[0];
  assert.equal(position.marketValue, 290);
  assert.equal(position.unrealizedPnl, 40);
  assert.equal(position.unrealizedPnlPercent, 16);
  assert.equal(data.positions.totals.netLiquidation, 300);
});

test("SnapTrade asset allocation requires an authoritative cash population", () => {
  const data = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:no-cash", currency: "USD", provider: "snaptrade" },
    portfolio: {
      account: { id: "snaptrade:no-cash", baseCurrency: "USD" },
      positions: [
        {
          snapTradePositionId: "stock:AAPL",
          symbol: "AAPL",
          assetClass: "equity",
          quantity: 1,
          price: 150,
          marketValue: 150,
          unrealizedPnl: 10,
          currency: "USD",
        },
      ],
    },
  });

  assert.equal(data.allocation.assetClass, null);
  assert.equal(data.allocation.sector[0]?.value, 150);
  assert.deepEqual(data.allocation.exposure, {
    grossLong: 150,
    grossShort: 0,
    netExposure: 150,
  });
});

test("SnapTrade does not add different currencies without authoritative FX rates", () => {
  const model = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:mixed", currency: "USD", provider: "snaptrade" },
    portfolio: {
      account: { id: "snaptrade:mixed", baseCurrency: "USD" },
      balances: [
        { currency: "USD", cash: 100, buyingPower: 200 },
        { currency: "CAD", cash: 50, buyingPower: 75 },
      ],
      positions: [
        {
          snapTradePositionId: "cad-position",
          symbol: "SHOP",
          assetClass: "equity",
          quantity: 1,
          price: 120,
          marketValue: 120,
          unrealizedPnl: 10,
          currency: "CAD",
        },
      ],
    },
  });

  assert.equal(model.summary.metrics.totalCash.value, null);
  assert.equal(model.summary.metrics.buyingPower.value, null);
  assert.equal(model.summary.metrics.grossPositionValue.value, null);
  assert.equal(model.summary.metrics.netLiquidation.value, null);
  assert.equal(model.positions.positions[0].currency, "CAD");
  assert.equal(model.positions.positions[0].marketValue, null);
  assert.match(model.summary.fx.warning, /Mixed-currency totals are unavailable/);
});

test("SnapTrade treats a successful empty position population as zero", () => {
  const model = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:cash", currency: "USD", provider: "snaptrade" },
    portfolio: {
      account: { id: "snaptrade:cash", baseCurrency: "USD" },
      balances: [{ currency: "USD", cash: 125, buyingPower: 125 }],
      positions: [],
      totals: { positionMarketValue: null, unrealizedPnl: null, positionCount: 0 },
    },
  });

  assert.equal(model.summary.metrics.grossPositionValue.value, 0);
  assert.equal(model.summary.metrics.unrealizedPnl.value, 0);
  assert.equal(model.summary.metrics.netLiquidation.value, 125);
  assert.equal(model.positions.totals.marketValue, 0);
  assert.deepEqual(model.allocation.exposure, {
    grossLong: 0,
    grossShort: 0,
    netExposure: 0,
  });
  assert.equal(model.positions.totals.count, 0);
  assert.equal(model.positionsAtDate.status, "available");
  assert.equal(model.positionsAtDate.totals.count, 0);
});

test("SnapTrade keeps an absent position population unavailable", () => {
  const model = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:cash", currency: "USD", provider: "snaptrade" },
    portfolio: {
      account: { id: "snaptrade:cash", baseCurrency: "USD" },
      balances: [{ currency: "USD", cash: 125, buyingPower: 125 }],
      totals: { positionMarketValue: 0, unrealizedPnl: 0, positionCount: 0 },
    },
  });

  assert.equal(model.summary.metrics.grossPositionValue.value, null);
  assert.equal(model.summary.metrics.unrealizedPnl.value, null);
  assert.equal(model.positions.totals.count, null);
  assert.equal(model.positions.positions, null);
  assert.equal(model.positions.totals.marketValue, null);
  assert.deepEqual(model.allocation.exposure, {
    grossLong: null,
    grossShort: null,
    netExposure: null,
  });
  assert.equal(model.allocation.assetClass, null);
  assert.equal(model.positionsAtDate.status, "unavailable");
  assert.equal(model.positionsAtDate.totals.count, null);
  assert.equal(model.positionsAtDate.positions, null);
  assert.equal(model.positionsAtDate.activity, null);
});

test("SnapTrade leaves unfetched orders and unsupported cash history unknown", () => {
  const model = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:capabilities", currency: "USD", provider: "snaptrade" },
    portfolio: {
      account: { id: "snaptrade:capabilities", baseCurrency: "USD" },
      balances: [{ currency: "USD", cash: 125, buyingPower: 125 }],
      positions: [],
    },
  });

  assert.equal(model.orders.orders, null);
  assert.equal(model.cash.activities, null);
  assert.equal(model.cash.dividends, null);
});

test("SnapTrade does not invent USD or an FX identity without currency authority", () => {
  const model = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:unknown-currency", provider: "snaptrade" },
    portfolio: {
      account: { id: "snaptrade:unknown-currency" },
      balances: [],
      positions: [
        {
          symbol: "AAPL",
          assetClass: "equity",
          quantity: 1,
          price: 150,
          marketValue: 150,
        },
      ],
      totals: { netLiquidation: 150 },
    },
  });

  assert.equal(model.summary.currency, null);
  assert.equal(model.summary.fx.baseCurrency, null);
  assert.deepEqual(model.summary.fx.rates, {});
  assert.equal(model.summary.metrics.netLiquidation.value, null);
  assert.equal(model.summary.metrics.grossPositionValue.value, null);
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

test("SnapTrade orders preserve unknown provider fields instead of inventing defaults", () => {
  const common = {
    account: { id: "snaptrade:acct-1", currency: "USD", provider: "snaptrade" },
    portfolio: {
      account: { id: "snaptrade:acct-1", baseCurrency: "USD" },
      balances: [],
      positions: [],
      totals: {},
    },
    recentOrders: {
      orders: [
        {
          brokerageOrderId: "malformed-1",
          status: "provider_mystery",
          symbol: "AAPL",
          action: "hold",
          orderType: "provider_special",
          timeInForce: "provider_default",
        },
      ],
    },
  };

  for (const orderTab of ["working", "history"]) {
    const [order] = buildSnapTradeAccountPanelData({
      ...common,
      orderTab,
    }).orders.orders;
    assert.equal(order.status, "unknown");
    assert.equal(order.side, "unknown");
    assert.equal(order.type, "unknown");
    assert.equal(order.timeInForce, "unknown");
    assert.equal(order.quantity, null);
    assert.equal(order.filledQuantity, null);
    assert.equal(order.placedAt, null);
    assert.equal(order.updatedAt, null);
  }
});

test("SnapTrade orders preserve canonical in-flight status distinctions", () => {
  const panel = buildSnapTradeAccountPanelData({
    account: { id: "snaptrade:acct-1", currency: "USD", provider: "snaptrade" },
    portfolio: {
      account: { id: "snaptrade:acct-1", baseCurrency: "USD" },
      balances: [],
      positions: [],
      totals: {},
    },
    recentOrders: {
      orders: [
        { brokerageOrderId: "cancel-1", status: "pending_cancel" },
        { brokerageOrderId: "partial-1", status: "partially_filled" },
        { brokerageOrderId: "submitted-1", status: "submitted" },
      ],
    },
    orderTab: "working",
  });

  assert.deepEqual(
    panel.orders.orders.map((order) => order.status),
    ["pending_cancel", "partially_filled", "submitted"],
  );
});

test("SnapTrade reconstructs total order quantity only from complete fill and open parts", () => {
  const buildOrder = (order) =>
    buildSnapTradeAccountPanelData({
      account: { id: "snaptrade:acct-1", currency: "USD", provider: "snaptrade" },
      portfolio: {
        account: { id: "snaptrade:acct-1", baseCurrency: "USD" },
        balances: [],
        positions: [],
        totals: {},
      },
      recentOrders: { orders: [order] },
      orderTab: "working",
    }).orders.orders[0];

  assert.equal(
    buildOrder({
      brokerageOrderId: "parts",
      status: "accepted",
      symbol: "AAPL",
      filledQuantity: 3,
      openQuantity: 2,
    }).quantity,
    5,
  );
  assert.equal(
    buildOrder({
      brokerageOrderId: "partial-parts",
      status: "accepted",
      symbol: "AAPL",
      filledQuantity: 3,
    }).quantity,
    null,
  );
});
