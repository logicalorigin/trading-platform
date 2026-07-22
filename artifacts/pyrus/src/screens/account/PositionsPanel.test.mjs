import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __positionsPanelInternalsForTests } from "./PositionsPanel.jsx";
import { getPositionTableColumns } from "../../features/account/positionTableColumns.js";

const {
  applyLiveEquityQuoteToRow,
  applyLiveOptionQuoteToRow,
  buildPositionTradeIntent,
  buildDisplayTotals,
  displayTotalsDayChangePercent,
  displayTotalsUnrealizedPnlPercent,
  scaledPositionGreek,
  tradeManagementTitle,
} = __positionsPanelInternalsForTests;

test("trail detail distinguishes locked return from the configured ratchet", () => {
  const title = tradeManagementTitle(
    {
      trail: { price: 2.34, source: "automation" },
      trailProjectedReturnPct: 0,
      trailActivationPct: 20,
      trailActiveRungPct: 20,
      trailMinLockedGainPct: 0,
      trailGivebackPct: 30,
      trailPeakReturnPct: 21.794871794871806,
      trailPeakLabel: "Bid peak",
      statusLabel: "Protected",
    },
    "USD",
    false,
  );

  assert.match(title, /Locked return 0\.0%/);
  assert.match(title, /Active rung \+20\.0%/);
  assert.match(title, /Minimum lock 0\.0%/);
  assert.match(title, /Allowed giveback 30\.0%/);
  assert.match(title, /Bid peak \+21\.8%/);
});

test("trail detail keeps initial activation separate from a higher active rung", () => {
  const title = tradeManagementTitle(
    {
      trail: { price: 1.83, source: "automation" },
      trailProjectedReturnPct: 15,
      trailActivationPct: 20,
      trailActiveRungPct: 30,
      trailMinLockedGainPct: 15,
      trailGivebackPct: 25,
      statusLabel: "Protected",
    },
    "USD",
    false,
  );

  assert.match(title, /Initial trigger \+20\.0%/);
  assert.match(title, /Active rung \+30\.0%/);
});

test("positions label open-position day P&L explicitly", () => {
  const dayColumn = getPositionTableColumns().find(
    (column) => column.id === "day",
  );

  assert.equal(dayColumn?.label, "Open Day");
  assert.equal(dayColumn?.title, "Open-position day P&L");
});

test("position trade intent fails closed when an option identity is incomplete", () => {
  assert.deepEqual(buildPositionTradeIntent({ assetClass: "equity" }), {
    assetMode: "equity",
  });
  assert.deepEqual(
    buildPositionTradeIntent({
      assetClass: "option",
      optionContract: {
        strike: 150,
        right: "call",
        expirationDate: "2026-08-21",
      },
    }),
    {
      assetMode: "option",
      contract: {
        strike: 150,
        cp: "C",
        exp: "2026-08-21",
        providerContractId: null,
      },
    },
  );
  assert.equal(
    buildPositionTradeIntent({
      assetClass: "option",
      optionContract: {
        strike: 150,
        right: "unknown",
        expirationDate: "2026-08-21",
      },
    }),
    null,
  );
});

test("position trade intent normalizes generated Date expirations for the ticket handoff", () => {
  assert.deepEqual(
    buildPositionTradeIntent({
      assetClass: "option",
      optionContract: {
        strike: 150,
        right: "call",
        expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      },
    }),
    {
      assetMode: "option",
      contract: {
        strike: 150,
        cp: "C",
        exp: "2026-08-21",
        providerContractId: null,
      },
    },
  );
});

const optionRow = (overrides = {}) => ({
  id: "U1:AAPL-C",
  accountId: "U1",
  symbol: "AAPL",
  assetClass: "option",
  optionContract: {
    underlying: "AAPL",
    multiplier: 100,
    sharesPerContract: 100,
    strike: 150,
    right: "call",
    expirationDate: "2026-08-21",
    providerContractId: null,
  },
  quantity: 1,
  averageCost: 60,
  mark: 60,
  marketValue: 6000,
  unrealizedPnl: 0,
  unrealizedPnlPercent: 0,
  brokerUnrealizedPnl: 0,
  brokerUnrealizedPnlPercent: 0,
  brokerMarketValue: 6000,
  openedAt: new Date().toISOString(),
  optionQuote: { mark: 60, bid: 59.9, ask: 60.1, dayChange: 0, dayChangePercent: 0, source: "ibkr" },
  underlyingMarket: null,
  ...overrides,
});

test("real option row keeps its already-per-share average cost (no double contract de-scale)", () => {
  const patched = applyLiveOptionQuoteToRow(optionRow(), {
    mark: 60,
    bid: 59.9,
    ask: 60.1,
    dayChange: 0,
    dayChangePercent: 0,
    freshness: "live",
    marketDataMode: "live",
    source: "ibkr",
  });
  // Backend already normalized averageCost to a per-share premium; it must NOT be
  // divided by the multiplier again (would render $0.60 and blow up same-day Day $/%).
  assert.equal(patched.averageCost, 60);
  assert.ok(Math.abs(patched.unrealizedPnl) < 1e-6);
});

test("live option rows preserve the API receipt timestamp used for freshness", () => {
  const latency = {
    apiServerReceivedAt: "2026-07-21T17:08:43.035Z",
  };
  const patched = applyLiveOptionQuoteToRow(optionRow(), {
    mark: 60,
    bid: 59.9,
    ask: 60.1,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: "2026-07-21T16:44:17.000Z",
    latency,
  });

  assert.deepEqual(patched.optionQuote.latency, latency);
});

test("positions table keeps raw AAP bid/ask but floors its mark at intrinsic value", () => {
  const patched = applyLiveOptionQuoteToRow(
    optionRow({
      id: "shadow:AAP-call",
      accountId: "shadow",
      symbol: "AAP",
      quantity: 7,
      averageCost: 1.94,
      mark: 3.9,
      marketValue: 2_730,
      unrealizedPnl: 1_372,
      brokerMarketValue: null,
      brokerUnrealizedPnl: null,
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
      valuationEligible: true,
      underlyingMarket: { price: 55.48 },
    }),
    {
      providerContractId: "O:AAP260724C00051000",
      bid: 3,
      ask: 4.8,
      bidSize: 273,
      askSize: 13,
      underlyingPrice: 55.48,
      freshness: "live",
      marketDataMode: "live",
    },
  );

  assert.equal(patched.optionQuote.bid, 3);
  assert.equal(patched.optionQuote.ask, 4.8);
  assert.equal(patched.optionQuote.bidSize, 273);
  assert.equal(patched.optionQuote.askSize, 13);
  assert.ok(Math.abs(patched.mark - 4.48) < 1e-9);
  assert.ok(Math.abs(patched.marketValue - 3_136) < 1e-9);
});

test("live option quotes cannot overwrite or invent authoritative underlying spot", () => {
  const authoritativeSpot = {
    symbol: "AAPL",
    price: 214.37,
    mark: 214.37,
    source: "underlying_quote",
    dataUpdatedAt: "2026-07-15T17:00:00.000Z",
  };
  const liveOptionQuote = {
    mark: 8.4,
    bid: 8.35,
    ask: 8.45,
    underlyingPrice: 8.4,
    source: "massive",
    dataUpdatedAt: "2026-07-15T17:00:01.000Z",
  };

  const withSpot = applyLiveOptionQuoteToRow(
    optionRow({
      underlyingMarket: authoritativeSpot,
      optionContract: {
        ...optionRow().optionContract,
        strike: 210,
      },
    }),
    liveOptionQuote,
  );
  assert.ok(Math.abs(withSpot.mark - 8.4) < 1e-9);
  assert.deepEqual(withSpot.underlyingMarket, authoritativeSpot);

  const withoutSpot = applyLiveOptionQuoteToRow(
    optionRow({ underlyingMarket: null }),
    liveOptionQuote,
  );
  assert.equal(withoutSpot.underlyingMarket, null);
});

test("metadata-only underlying snapshots never copy the option premium into Spot", () => {
  const pendingUnderlying = {
    symbol: "AAPL",
    status: "pending",
    source: "massive",
  };
  const row = optionRow({
    mark: 1.35,
    marketPrice: 1.35,
    quote: {
      bid: 1.15,
      ask: 1.55,
      mark: 1.35,
      source: "option_quote",
    },
    underlyingMarket: null,
  });

  const patched = applyLiveEquityQuoteToRow(row, pendingUnderlying);

  assert.equal(patched.mark, 1.35, "the option mark remains the contract price");
  assert.equal(patched.underlyingMarket?.price ?? null, null);
  assert.equal(patched.underlyingMarket?.mark ?? null, null);
});

test("generic live quotes cannot overwrite a Robinhood-native option valuation", () => {
  const row = optionRow({
    providerSecurityType: "robinhood_option",
    averageCost: 2.5,
    mark: 3,
    marketValue: 300,
    unrealizedPnl: 50,
    unrealizedPnlPercent: 20,
    optionQuote: {
      providerContractId: "1f671768-694d-46cb-a9cd-bb97c731eba8",
      mark: 3,
      source: "robinhood",
    },
  });

  const patched = applyLiveOptionQuoteToRow(row, {
    providerContractId: "O:AAPL260821C00150000",
    mark: 9,
    source: "massive",
  });

  assert.equal(patched, row);
  assert.equal(patched.mark, 3);
  assert.equal(patched.marketValue, 300);
  assert.equal(patched.unrealizedPnl, 50);
});

test("prior-day SHORT option day $ and day % carry the same sign", () => {
  const patched = applyLiveOptionQuoteToRow(
    optionRow({
      quantity: -2,
      averageCost: 5,
      mark: 4.2,
      marketValue: -840,
      unrealizedPnl: 160,
      unrealizedPnlPercent: 16,
      openedAt: "2026-06-05T14:30:00.000Z",
      optionQuote: { mark: 4.2, bid: 4.15, ask: 4.25, prevClose: 4, dayChange: 0.1, dayChangePercent: 2.5, source: "ibkr" },
    }),
    {
      mark: 4.2,
      bid: 4.15,
      ask: 4.25,
      prevClose: 4,
      dayChange: 0.1,
      dayChangePercent: 2.5,
      freshness: "live",
      marketDataMode: "live",
      source: "ibkr",
    },
  );
  // Mark rose from 4.00 to 4.20. The raw +0.10/+2.5% fields intentionally
  // disagree; mark-versus-prior-close is authoritative.
  assert.ok(Math.abs(patched.dayChange - -40) < 1e-9);
  assert.ok(Math.abs(patched.dayChangePercent - -5) < 1e-9);
  assert.equal(Math.sign(patched.dayChange), Math.sign(patched.dayChangePercent));
});

const source = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");

test("Spot reader never falls back to an option quote's embedded underlying price", () => {
  const resolver = source.match(
    /const resolvePositionUnderlyingPrice = \([\s\S]*?\n};/,
  )?.[0];
  assert.ok(resolver, "Missing resolvePositionUnderlyingPrice");
  assert.doesNotMatch(resolver, /optionQuote\?\.underlyingPrice/);
  assert.doesNotMatch(resolver, /quote\?\.underlyingPrice/);
});

test("same-day equity position day PnL follows live mark unrealized PnL", () => {
  const openedAt = new Date().toISOString();
  const row = {
    id: "U123:FCEL",
    accountId: "U123",
    symbol: "FCEL",
    assetClass: "Stocks",
    quantity: 100,
    averageCost: 15.5,
    mark: 15.5,
    marketPrice: 15.5,
    marketValue: 1550,
    dayChange: 0,
    dayChangePercent: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    openedAt,
    quote: null,
    underlyingMarket: null,
  };

  const patched = applyLiveEquityQuoteToRow(row, {
    symbol: "FCEL",
    price: 15.815,
    last: 15.815,
    mark: 15.815,
    bid: 15.81,
    ask: 15.82,
    change: -1.515,
    changePercent: -8.742,
    prevClose: 17.33,
    updatedAt: openedAt,
    dataUpdatedAt: openedAt,
    freshness: "live",
    marketDataMode: "live",
    source: "massive",
    transport: "massive_websocket",
  });

  assert.equal(patched.quote.bid, 15.81);
  assert.equal(patched.quote.ask, 15.82);
  assert.ok(Math.abs(patched.unrealizedPnl - 31.5) < 1e-9);
  assert.equal(patched.dayChange, patched.unrealizedPnl);
  assert.equal(patched.dayChangePercent, patched.unrealizedPnlPercent);
});

test("prior-day equity position day PnL follows live mark versus previous close", () => {
  const row = {
    id: "U123:FCEL",
    accountId: "U123",
    symbol: "FCEL",
    assetClass: "Stocks",
    quantity: 100,
    averageCost: 15.5,
    mark: 15.5,
    marketPrice: 15.5,
    marketValue: 1550,
    dayChange: 0,
    dayChangePercent: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    openedAt: "2026-06-05T14:30:00.000Z",
    quote: null,
    underlyingMarket: null,
  };

  const patched = applyLiveEquityQuoteToRow(row, {
    symbol: "FCEL",
    price: 15.95,
    mark: 15.97,
    bid: 15.96,
    ask: 15.98,
    change: -1.38,
    changePercent: -8.742,
    prevClose: 17.33,
    updatedAt: new Date().toISOString(),
    freshness: "live",
    marketDataMode: "live",
  });

  assert.ok(Math.abs(patched.dayChange - -136) < 1e-9);
  assert.ok(
    Math.abs(patched.dayChangePercent - ((15.97 - 17.33) / 17.33) * 100) <
      1e-9,
  );
});

test("Spot column renders the underlying day change under the price", () => {
  // Resolver prefers a direct snapshot percent, else derives from previous close.
  assert.match(source, /const resolvePositionUnderlyingDayChangePercent = \(/);
  assert.match(
    source,
    /snapshot\?\.dayChangePercent[\s\S]*?snapshot\?\.changePercent[\s\S]*?snapshot\?\.pct/,
  );
  assert.match(source, /\(\(price - previousClose\) \/ previousClose\) \* 100/);
  // The Spot cell surfaces it as the DenseStackedValue secondary with signed tone.
  const cellStart = source.indexOf("const DenseUnderlyingPriceCell");
  const cellEnd = source.indexOf("const DensePositionCell", cellStart);
  const cell = source.slice(cellStart, cellEnd);
  assert.match(cell, /resolvePositionUnderlyingDayChangePercent\(/);
  assert.match(cell, /signedPercent\(underlyingDayChangePercent/);
  assert.match(cell, /secondaryTone=\{toneForValue\(underlyingDayChangePercent\)\}/);
});

test("expanded position orders reuse neutral-aware order tones", () => {
  assert.match(source, /accountOrderSideTone\(order\.side\)/);
  assert.match(source, /accountOrderStatusTone\(order\.status\)/);
  assert.doesNotMatch(
    source,
    /\/buy\/i\.test\(order\.side\) \? "side-buy" : "side-sell"/,
  );
});

test("Stop and Trail cells show projected position return instead of distance to the stop", () => {
  const stopCellStart = source.indexOf('column.id === "stop"');
  const stopCellEnd = source.indexOf('column.id === "trail"', stopCellStart);
  const trailCellEnd = source.indexOf('column.id === "day"', stopCellEnd);
  const stopCell = source.slice(stopCellStart, stopCellEnd);
  const trailCell = source.slice(stopCellEnd, trailCellEnd);

  assert.match(stopCell, /stopProjectedReturnPct/);
  assert.match(trailCell, /trailProjectedReturnPct/);
  assert.doesNotMatch(stopCell, /formatTradeManagementDistanceBadge/);
  assert.doesNotMatch(trailCell, /formatTradeManagementDistanceBadge/);
});

test("prior-day SHORT equity day $ and day % carry the same sign", () => {
  const row = {
    id: "U123:TSLA",
    accountId: "U123",
    symbol: "TSLA",
    assetClass: "Stocks",
    quantity: -100,
    averageCost: 20,
    mark: 100,
    marketPrice: 100,
    marketValue: -10000,
    dayChange: 0,
    dayChangePercent: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    openedAt: "2026-06-05T14:30:00.000Z",
    quote: null,
    underlyingMarket: null,
  };

  const patched = applyLiveEquityQuoteToRow(row, {
    symbol: "TSLA",
    price: 102,
    mark: 102,
    bid: 101.99,
    ask: 102.01,
    prevClose: 100,
    updatedAt: new Date().toISOString(),
    freshness: "live",
    marketDataMode: "live",
  });

  // Underlying rose +2% intraday, so a SHORT loses: both the $ and % must be negative.
  assert.ok(Math.abs(patched.dayChange - -200) < 1e-9);
  assert.ok(Math.abs(patched.dayChangePercent - -2) < 1e-9);
  assert.equal(Math.sign(patched.dayChange), Math.sign(patched.dayChangePercent));
});

test("equity position row prefers IBKR position quote over Massive base quote", () => {
  const row = {
    id: "U123:FCEL",
    accountId: "U123",
    symbol: "FCEL",
    assetClass: "Stocks",
    quantity: 100,
    averageCost: 13.35,
    mark: 15.85,
    marketPrice: 15.85,
    marketValue: 1585,
    dayChange: -148,
    dayChangePercent: -8.54,
    unrealizedPnl: 250,
    unrealizedPnlPercent: 18.7,
    openedAt: "2026-04-30T00:00:00.000Z",
    quote: {
      bid: 15.83,
      ask: 15.86,
      price: 15.85,
      mark: 15.845,
      source: "massive",
      transport: "massive_websocket",
      dataUpdatedAt: "2026-06-08T17:05:30.324Z",
      prevClose: 17.33,
    },
    underlyingMarket: null,
  };

  const patched = applyLiveEquityQuoteToRow(row, {
    symbol: "FCEL",
    price: 15.82,
    bid: 15.81,
    ask: 15.84,
    bidSize: 1200,
    askSize: 900,
    source: "ibkr",
    transport: "tws",
    marketDataMode: "live",
    freshness: "live",
    dataUpdatedAt: "2026-06-08T17:04:04.911Z",
    prevClose: 17.33,
  });

  assert.equal(patched.quote.source, "ibkr");
  assert.equal(patched.quote.transport, "tws");
  assert.equal(patched.quote.bid, 15.81);
  assert.equal(patched.quote.ask, 15.84);
  assert.equal(patched.underlyingMarket.source, "ibkr");
});

test("position fallback sparkline does not use average cost as current price", () => {
  const fallbackSparkline = source.match(
    /const buildPositionFallbackSparklineData = \([\s\S]*?\n};/,
  )?.[0];

  assert.ok(fallbackSparkline, "Missing buildPositionFallbackSparklineData");
  assert.match(fallbackSparkline, /resolvePositionUnderlyingPrice/);
  assert.match(fallbackSparkline, /resolvePositionUnderlyingDayChangePercent/);
  assert.match(fallbackSparkline, /const rowPercentFallback = !isOptionPosition\(row\)/);
  assert.doesNotMatch(fallbackSparkline, /row\?\.averageCost/);
  assert.doesNotMatch(fallbackSparkline, /row\?\.mark/);
  assert.doesNotMatch(fallbackSparkline, /row\?\.marketPrice/);
  assert.doesNotMatch(fallbackSparkline, /current \* 0\.9975/);
  assert.match(fallbackSparkline, /if \(start == null\) return \[\]/);
});

test("underlying spot freshness never comes from an option quote timestamp", () => {
  const titleBuilder = source.match(
    /const positionUnderlyingPriceTitle = \([\s\S]*?\n};/,
  )?.[0];

  assert.ok(titleBuilder, "Missing positionUnderlyingPriceTitle");
  assert.doesNotMatch(titleBuilder, /optionQuote/);
});

test("underlying sparkline direction ignores option return", () => {
  const directionResolver = source.match(
    /const resolvePositionSparklinePositive = \([\s\S]*?\n};/,
  )?.[0];

  assert.ok(directionResolver, "Missing resolvePositionSparklinePositive");
  assert.match(directionResolver, /resolvePositionUnderlyingDayChangePercent/);
  assert.match(directionResolver, /const rowPercentFallback = !isOptionPosition\(row\)/);
});

test("display totals sum broker money, not live Massive money", () => {
  const rows = [
    {
      marketValue: 1200,
      brokerMarketValue: 1000,
      unrealizedPnl: 200,
      brokerUnrealizedPnl: 100,
    },
    {
      marketValue: -600,
      brokerMarketValue: -500,
      unrealizedPnl: -80,
      brokerUnrealizedPnl: -50,
    },
  ];

  const totals = buildDisplayTotals(rows);

  // Broker sum (1000 + -500) = 500, NOT the live Massive sum (1200 + -600) = 600.
  assert.equal(totals.netExposure, 500);
  assert.equal(totals.grossLong, 1000);
  assert.equal(totals.grossShort, -500);
  // Broker unrealized (100 + -50) = 50, NOT the live sum (200 + -80) = 120.
  assert.equal(totals.unrealizedPnl, 50);
});

test("display summary percentages use prior-close and cost bases, not net exposure", () => {
  const totals = buildDisplayTotals([
    {
      marketValue: 1_200,
      unrealizedPnl: 200,
      dayChange: 200,
      dayChangePercent: 20,
    },
    {
      marketValue: -800,
      unrealizedPnl: 200,
      dayChange: -100,
      dayChangePercent: -10,
    },
  ]);

  assert.equal(totals.netExposure, 400);
  assert.equal(totals.dayChangeBasis, 2_000);
  assert.equal(totals.unrealizedCostBasis, 2_000);
  assert.equal(displayTotalsDayChangePercent(totals), 5);
  assert.equal(displayTotalsUnrealizedPnlPercent(totals), 20);
});

test("display totals do not turn incomplete broker populations into partial totals", () => {
  const totals = buildDisplayTotals(
    [
      {
        marketValue: 1_000,
        unrealizedPnl: 100,
        dayChange: 20,
        dayChangePercent: 2,
        weightPercent: 40,
      },
      {
        marketValue: null,
        unrealizedPnl: null,
        dayChange: null,
        dayChangePercent: null,
        weightPercent: null,
      },
    ],
    { cash: 500 },
  );

  assert.equal(totals.netExposure, null);
  assert.equal(totals.grossLong, null);
  assert.equal(totals.grossShort, null);
  assert.equal(totals.unrealizedPnl, null);
  assert.equal(totals.unrealizedCostBasis, null);
  assert.equal(totals.dayChange, null);
  assert.equal(totals.dayChangeBasis, null);
  assert.equal(totals.weightPercent, null);
  assert.equal(totals.netLiquidation, null);
});

test("position Greek aggregation applies quantity sign and option multiplier", () => {
  assert.equal(
    scaledPositionGreek(optionRow({ quantity: 2, optionQuote: { theta: -0.05 } }), "theta"),
    -10,
  );
  assert.equal(
    scaledPositionGreek(optionRow({ quantity: -2, optionQuote: { theta: -0.05 } }), "theta"),
    10,
  );
  assert.equal(
    scaledPositionGreek(
      optionRow({
        quantity: 2,
        optionContract: { multiplier: 0, sharesPerContract: 50 },
        optionQuote: { theta: -0.05 },
      }),
      "theta",
    ),
    -5,
  );
  assert.equal(
    scaledPositionGreek(
      optionRow({
        quantity: 2,
        optionContract: { multiplier: -100, sharesPerContract: 50 },
        optionQuote: { theta: -0.05 },
      }),
      "theta",
    ),
    -5,
  );
  assert.equal(
    scaledPositionGreek(
      optionRow({
        optionContract: {},
        optionQuote: { theta: -0.05 },
      }),
      "theta",
    ),
    null,
  );
  assert.equal(
    scaledPositionGreek(
      optionRow({
        optionContract: {
          multiplier: -100,
          standardDeliverableVerified: true,
        },
        optionQuote: { theta: -0.05 },
      }),
      "theta",
    ),
    null,
  );
  assert.equal(
    scaledPositionGreek(
      optionRow({
        optionContract: { standardDeliverableVerified: true },
        optionQuote: { theta: -0.05 },
      }),
      "theta",
    ),
    -5,
  );
  assert.equal(
    scaledPositionGreek(
      optionRow({
        providerSecurityType: "robinhood_option",
        quantity: 2,
        optionContract: { standardDeliverableVerified: true },
        optionQuote: null,
        quote: { theta: -0.08 },
      }),
      "theta",
    ),
    -16,
  );
});

test("position summary keeps partial money and Greek populations unavailable", () => {
  const summaryBlock = source.match(
    /const completePositionAggregate[\s\S]*?const denseSummaryCellStyle/,
  )?.[0];

  assert.ok(summaryBlock, "Missing strict position summary aggregation");
  assert.match(summaryBlock, /values\.every\(\(value\) => value != null\)/);
  assert.match(summaryBlock, /displayTotals\.dayChange/);
  assert.doesNotMatch(summaryBlock, /totalDayChange/);
  assert.match(summaryBlock, /netTheta != null/);
  assert.doesNotMatch(summaryBlock, /scaledPositionGreek\(row, "theta"\) \?\? 0/);
});

test("live option delta does not overwrite backend beta-weighted delta", () => {
  const patched = applyLiveOptionQuoteToRow(
    optionRow({ betaWeightedDelta: 130 }),
    { mark: 60, delta: 0.5 },
  );
  assert.equal(patched.betaWeightedDelta, 130);
});

test("real rows follow broker marks; shadow rows stay on live Massive valuation", () => {
  const openedAt = "2026-04-30T00:00:00.000Z";
  const baseRow = {
    symbol: "FCEL",
    assetClass: "Stocks",
    quantity: 100,
    averageCost: 15,
    mark: 20,
    marketPrice: 20,
    marketValue: 2000, // broker market value
    unrealizedPnl: 500, // broker unrealized PnL
    unrealizedPnlPercent: 33.33,
    openedAt,
    quote: null,
    underlyingMarket: null,
  };
  const liveQuote = {
    symbol: "FCEL",
    price: 22,
    mark: 22,
    last: 22,
    freshness: "live",
    marketDataMode: "live",
    source: "massive",
  };

  const realPatched = applyLiveEquityQuoteToRow(
    { ...baseRow, id: "U123:FCEL", accountId: "U123" },
    liveQuote,
  );
  // Live mark (22) drives the displayed Price/marketValue overlay...
  assert.equal(realPatched.marketValue, 2200);
  // ...while the broker money is preserved as the source of truth.
  assert.equal(realPatched.brokerMarketValue, 2000);
  assert.equal(realPatched.brokerUnrealizedPnl, 500);
  assert.equal(buildDisplayTotals([realPatched]).netExposure, 2000);

  const shadowPatched = applyLiveEquityQuoteToRow(
    { ...baseRow, id: "shadow:FCEL", accountId: "shadow" },
    liveQuote,
  );
  // Shadow rows have no broker, so broker fields stay null and money follows live.
  assert.equal(shadowPatched.marketValue, 2200);
  assert.equal(shadowPatched.brokerMarketValue, null);
  assert.equal(buildDisplayTotals([shadowPatched]).netExposure, 2200);
});

test("live quotes cannot repopulate explicitly unavailable provider money", () => {
  const row = {
    id: "snaptrade:mixed:SHOP",
    accountId: "snaptrade:mixed",
    symbol: "SHOP",
    assetClass: "Stock",
    quantity: 2,
    averageCost: null,
    marketValue: null,
    brokerMarketValue: null,
    unrealizedPnl: null,
    brokerUnrealizedPnl: null,
    unrealizedPnlPercent: null,
    brokerUnrealizedPnlPercent: null,
    dayChange: null,
    dayChangePercent: null,
  };

  const patched = applyLiveEquityQuoteToRow(row, {
    symbol: "SHOP",
    price: 120,
    mark: 120,
    previousClose: 118,
  });
  const totals = buildDisplayTotals([patched]);

  assert.equal(patched.mark, 120);
  assert.equal(patched.marketValue, null);
  assert.equal(patched.unrealizedPnl, null);
  assert.equal(patched.dayChange, null);
  assert.equal(totals.netExposure, null);
  assert.equal(totals.unrealizedPnl, null);
});

test("dense table rows leave expansion to their native disclosure buttons", () => {
  const rowBlock = source.match(
    /<tr\s+className=\{rowClassName\}[\s\S]*?>/,
  )?.[0];

  assert.ok(rowBlock, "Missing dense position row");
  assert.doesNotMatch(rowBlock, /onClick=/);
  assert.doesNotMatch(rowBlock, /cursor:\s*"pointer"/);
  assert.match(source, /aria-expanded=\{expanded\}/);
});
