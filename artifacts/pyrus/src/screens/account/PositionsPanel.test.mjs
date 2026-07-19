import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __positionsPanelInternalsForTests } from "./PositionsPanel.jsx";

const {
  applyLiveEquityQuoteToRow,
  applyLiveOptionQuoteToRow,
  buildPositionTradeIntent,
  buildDisplayTotals,
  displayTotalsDayChangePercent,
  displayTotalsUnrealizedPnlPercent,
  scaledPositionGreek,
} = __positionsPanelInternalsForTests;

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
  const cellEnd = source.indexOf("const StopEditAffordance", cellStart);
  const cell = source.slice(cellStart, cellEnd);
  assert.match(cell, /resolvePositionUnderlyingDayChangePercent\(/);
  assert.match(cell, /signedPercent\(underlyingDayChangePercent/);
  assert.match(cell, /secondaryTone=\{toneForValue\(underlyingDayChangePercent\)\}/);
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
  assert.doesNotMatch(fallbackSparkline, /row\?\.averageCost/);
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

test("position Greek aggregation applies quantity sign and option multiplier", () => {
  assert.equal(
    scaledPositionGreek(optionRow({ quantity: 2, optionQuote: { theta: -0.05 } }), "theta"),
    -10,
  );
  assert.equal(
    scaledPositionGreek(optionRow({ quantity: -2, optionQuote: { theta: -0.05 } }), "theta"),
    10,
  );
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
