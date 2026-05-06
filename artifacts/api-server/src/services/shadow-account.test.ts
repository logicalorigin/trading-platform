import assert from "node:assert/strict";
import { test } from "node:test";
import {
  __shadowWatchlistBacktestInternalsForTests,
  buildWatchlistBacktestFills,
  computeShadowOrderFees,
} from "./shadow-account";

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

test("Shadow trading pattern packet attributes ticker performance and chart annotations", () => {
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
    __shadowWatchlistBacktestInternalsForTests.buildShadowTradingPatternsFromRows({
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

test("shadow equity history selects one backtest source instead of mixing ledger marks", () => {
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

  assert.equal(selected.scope, "watchlist_backtest");
  assert.equal(selected.selectedSource, "watchlist_bt:20260101:20260501");
  assert.equal(selected.includeInitialPoint, false);
  assert.equal(selected.includeLiveTerminal, false);
  assert.deepEqual(
    selected.rows.map((entry) => entry.source),
    ["watchlist_bt:20260101:20260501"],
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
