import assert from "node:assert/strict";
import test from "node:test";
import { aggregateOptionPremiumDistributionSnapshots } from "./market-data";

test("aggregates option premium distribution buckets and sides", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "spy",
    stockDayVolume: 120_000_000,
    marketCap: 500_000_000_000,
    asOf: new Date("2026-05-06T15:30:00Z"),
    pageCount: 1,
    snapshots: [
      {
        details: { contract_type: "call", shares_per_contract: 100 },
        session: { vwap: 2, volume: 100 },
        last_trade: { price: 2.05, size: 20 },
        last_quote: { bid_price: 1.9, ask_price: 2 },
      },
      {
        details: { contract_type: "put", shares_per_contract: 100 },
        day: { vw: 3, v: 1_000 },
        last_trade: { price: 2.95, size: 10 },
        last_quote: { bid_price: 3, ask_price: 3.1 },
      },
      {
        details: { contract_type: "call", shares_per_contract: 100 },
        day: { c: 1, v: 50 },
      },
    ],
  });

  assert.equal(distribution.symbol, "SPY");
  assert.equal(distribution.stockDayVolume, 120_000_000);
  assert.equal(distribution.timeframe, "today");
  assert.equal(distribution.marketCapTier, "mega");
  assert.equal(distribution.bucketThresholds.mediumMin, 50_000);
  assert.equal(distribution.bucketThresholds.largeMin, 250_000);
  assert.equal(distribution.contractCount, 3);
  assert.equal(distribution.tradeCount, 2);
  assert.equal(distribution.quoteMatchedCount, 2);
  assert.equal(distribution.tickTestMatchedCount, 0);
  assert.equal(distribution.sideBasis, "quote_match");
  assert.equal(distribution.classifiedPremium, 7_050);
  assert.equal(distribution.classificationCoverage, 7_050 / 325_000);
  assert.equal(distribution.classificationConfidence, "low");
  assert.equal(distribution.quoteAccess, "available");
  assert.equal(distribution.tradeAccess, "available");
  assert.equal(distribution.inflowPremium, 4_100);
  assert.equal(distribution.outflowPremium, 2_950);
  assert.equal(distribution.buyPremium, 4_100);
  assert.equal(distribution.sellPremium, 2_950);
  assert.equal(distribution.neutralPremium, 317_950);
  assert.equal(distribution.callPremium, 25_000);
  assert.equal(distribution.putPremium, 300_000);
  assert.equal(distribution.premiumTotal, 325_000);
  assert.equal(distribution.netPremium, 1_150);
  assert.equal(distribution.buckets.small.totalPremium, 27_950);
  assert.equal(distribution.buckets.small.inflowPremium, 4_100);
  assert.equal(distribution.buckets.small.buyPremium, 4_100);
  assert.equal(distribution.buckets.small.outflowPremium, 2_950);
  assert.equal(distribution.buckets.small.sellPremium, 2_950);
  assert.equal(distribution.buckets.small.neutralPremium, 20_900);
  assert.equal(distribution.buckets.large.totalPremium, 297_050);
  assert.equal(distribution.buckets.large.outflowPremium, 0);
  assert.equal(distribution.buckets.large.sellPremium, 0);
  assert.equal(distribution.buckets.large.neutralPremium, 297_050);
  assert.equal(distribution.confidence, "partial");
});

test("keeps session premium neutral except the quote-matched last trade", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "SPY",
    marketCap: 500_000_000_000,
    snapshots: [
      {
        details: { contract_type: "call", shares_per_contract: 100 },
        session: { vwap: 4, volume: 1_000 },
        last_trade: { price: 4.2, size: 25 },
        last_quote: { bid_price: 4, ask_price: 4.2 },
      },
    ],
  });

  assert.equal(distribution.premiumTotal, 400_000);
  assert.equal(distribution.inflowPremium, 10_500);
  assert.equal(distribution.classificationConfidence, "low");
  assert.equal(distribution.neutralPremium, 389_500);
  assert.equal(distribution.buckets.small.inflowPremium, 10_500);
  assert.equal(distribution.buckets.small.totalPremium, 10_500);
  assert.equal(distribution.buckets.large.totalPremium, 389_500);
  assert.equal(distribution.buckets.large.inflowPremium, 0);
  assert.equal(distribution.buckets.large.neutralPremium, 389_500);
});

test("leaves option premium neutral when quote or trade data is incomplete", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "SPY",
    marketCap: 500_000_000_000,
    snapshots: [
      {
        details: { contract_type: "call", shares_per_contract: 100 },
        session: { vwap: 2, volume: 100 },
        last_trade: { price: 2.1, size: 50 },
      },
      {
        details: { contract_type: "put", shares_per_contract: 100 },
        session: { vwap: 3, volume: 200 },
        last_quote: { bid_price: 2.9, ask_price: 3.1 },
      },
    ],
  });

  assert.equal(distribution.contractCount, 2);
  assert.equal(distribution.tradeCount, 1);
  assert.equal(distribution.quoteMatchedCount, 0);
  assert.equal(distribution.tickTestMatchedCount, 0);
  assert.equal(distribution.sideBasis, "none");
  assert.equal(distribution.classificationConfidence, "none");
  assert.equal(distribution.inflowPremium, 0);
  assert.equal(distribution.outflowPremium, 0);
  assert.equal(distribution.neutralPremium, 80_000);
});

test("uses tick-test trade classifications when option snapshots omit quotes", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "SPY",
    marketCap: 500_000_000_000,
    tradeAccess: "available",
    tradeClassifications: new Map([
      [
        "O:SPY260508C00640000",
        {
          buyPremium: 42_000,
          sellPremium: 18_000,
          tradeCount: 5,
          tickTestMatchedCount: 4,
        },
      ],
    ]),
    snapshots: [
      {
        details: {
          ticker: "O:SPY260508C00640000",
          contract_type: "call",
          shares_per_contract: 100,
        },
        session: { vwap: 3, volume: 300 },
        last_trade: { price: 3.01, size: 10 },
      },
    ],
  });

  assert.equal(distribution.premiumTotal, 90_000);
  assert.equal(distribution.classifiedPremium, 60_000);
  assert.equal(distribution.inflowPremium, 42_000);
  assert.equal(distribution.outflowPremium, 18_000);
  assert.equal(distribution.neutralPremium, 30_000);
  assert.equal(distribution.tradeCount, 5);
  assert.equal(distribution.classifiedTradeCount, 4);
  assert.equal(distribution.quoteMatchedCount, 0);
  assert.equal(distribution.tickTestMatchedCount, 4);
  assert.equal(distribution.sideBasis, "tick_test");
  assert.equal(distribution.classificationConfidence, "high");
  assert.equal(distribution.quoteAccess, "unavailable");
  assert.equal(distribution.tradeAccess, "available");
  assert.equal(distribution.confidence, "partial");
});

test("marks quote-matched premium below one percent as very low confidence", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "SPY",
    marketCap: 500_000_000_000,
    snapshots: [
      {
        details: { contract_type: "call", shares_per_contract: 100 },
        session: { vwap: 10, volume: 10_000 },
        last_trade: { price: 10, size: 1 },
        last_quote: { bid_price: 9.8, ask_price: 10 },
      },
    ],
  });

  assert.equal(distribution.premiumTotal, 10_000_000);
  assert.equal(distribution.classifiedPremium, 1_000);
  assert.equal(distribution.classificationCoverage, 0.0001);
  assert.equal(distribution.classificationConfidence, "very_low");
});

test("allocates tick-test trades into premium-size buckets", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "SPY",
    marketCap: 500_000_000_000,
    tradeAccess: "available",
    tradeClassifications: new Map([
      [
        "O:SPY260508C00640000",
        {
          buyPremium: 260_000,
          sellPremium: 70_000,
          tradeCount: 3,
          tickTestMatchedCount: 3,
          buckets: {
            large: { buyPremium: 260_000, sellPremium: 0, count: 1 },
            medium: { buyPremium: 0, sellPremium: 70_000, count: 1 },
            small: { buyPremium: 0, sellPremium: 0, count: 0 },
          },
        },
      ],
    ]),
    snapshots: [
      {
        details: {
          ticker: "O:SPY260508C00640000",
          contract_type: "call",
          shares_per_contract: 100,
        },
        session: { vwap: 4, volume: 1_000 },
      },
    ],
  });

  assert.equal(distribution.premiumTotal, 400_000);
  assert.equal(distribution.buckets.large.inflowPremium, 260_000);
  assert.equal(distribution.buckets.medium.outflowPremium, 70_000);
  assert.equal(distribution.buckets.large.neutralPremium, 70_000);
  assert.equal(distribution.buckets.large.totalPremium, 330_000);
  assert.equal(distribution.buckets.medium.totalPremium, 70_000);
});

test("classifies widget-side premium from Massive quote field variants", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "NVDA",
    timeframe: "week",
    marketCap: 150_000_000_000,
    snapshots: [
      {
        details: { contract_type: "call", shares_per_contract: 100 },
        session: { vwap: 2.5, volume: 100 },
        last_trade: { p: 2.99, s: 100 },
        last_quote: { bid: 2.7, ask: 3 },
      },
      {
        details: { contract_type: "put", shares_per_contract: 100 },
        session: { vwap: 1.25, volume: 50 },
        last_trade: { price: 1.01, size: 50 },
        last_quote: { bp: 1, ap: 1.2 },
      },
    ],
  });

  assert.equal(distribution.timeframe, "week");
  assert.equal(distribution.marketCapTier, "large");
  assert.equal(distribution.quoteMatchedCount, 2);
  assert.equal(distribution.inflowPremium, 25_000);
  assert.equal(distribution.outflowPremium, 5_050);
  assert.equal(distribution.neutralPremium, 1_200);
  assert.equal(distribution.buckets.medium.inflowPremium, 25_000);
  assert.equal(distribution.buckets.small.outflowPremium, 5_050);
});

test("uses small-cap bucket thresholds when market cap is unavailable", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "IWM",
    snapshots: [
      {
        details: { contract_type: "call", shares_per_contract: 100 },
        day: { c: 3.05, v: 100 },
        last_trade: { price: 3.05, size: 100 },
        last_quote: { bid_price: 2.9, ask_price: 3 },
      },
    ],
  });

  assert.equal(distribution.marketCap, null);
  assert.equal(distribution.marketCapTier, "small_or_unknown");
  assert.equal(distribution.bucketThresholds.mediumMin, 5_000);
  assert.equal(distribution.bucketThresholds.largeMin, 25_000);
  assert.equal(distribution.buckets.large.inflowPremium, 30_500);
});

test("ignores snapshots without usable price or volume", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "QQQ",
    snapshots: [
      { details: { contract_type: "call" }, day: { v: 100 } },
      { details: { contract_type: "put" }, day: { c: 2 } },
    ],
  });

  assert.equal(distribution.contractCount, 0);
  assert.equal(distribution.premiumTotal, 0);
  assert.equal(distribution.classificationConfidence, "none");
  assert.equal(distribution.confidence, "partial");
});
