import assert from "node:assert/strict";
import test from "node:test";
import {
  PolygonMarketDataClient,
  aggregateOptionPremiumDistributionSnapshots,
} from "./market-data";

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

test("classifies historical flow events with tick-test side confidence", async () => {
  const originalFetch = globalThis.fetch;
  const baseTime = Date.parse("2026-05-06T14:30:00Z");

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.pathname === "/v3/reference/options/contracts") {
      const expired = url.searchParams.get("expired") === "true";
      return Response.json({
        results: expired
          ? []
          : [
              {
                ticker: "O:SPY260506C00640000",
                underlying_ticker: "SPY",
                expiration_date: "2026-05-06",
                strike_price: 640,
                contract_type: "call",
                shares_per_contract: 100,
              },
            ],
      });
    }

    if (url.pathname === "/v3/reference/conditions") {
      return Response.json({ results: [] });
    }

    if (url.pathname.includes("/v3/trades/")) {
      return Response.json({
        results: [
          {
            price: 2,
            size: 10,
            sip_timestamp: baseTime + 60_000,
            sequence_number: 2,
            exchange: 304,
          },
          {
            price: 1,
            size: 10,
            sip_timestamp: baseTime,
            sequence_number: 1,
            exchange: 304,
          },
          {
            price: 2,
            size: 5,
            sip_timestamp: baseTime + 120_000,
            sequence_number: 3,
            exchange: 304,
          },
        ],
      });
    }

    return Response.json({ results: [] });
  }) as typeof fetch;

  try {
    const client = new PolygonMarketDataClient({
      apiKey: "test",
      baseUrl: "https://polygon.test",
    });
    const result = await client.getHistoricalOptionFlowEvents({
      underlying: "SPY",
      from: new Date(baseTime - 1_000),
      to: new Date(baseTime + 180_000),
      contractLimit: 1,
      contractPageLimit: 1,
      tradePageLimit: 1,
      tradeLimit: 10,
    });

    assert.deepEqual(
      result.events.map((event) => event.side),
      ["mid", "buy", "buy"],
    );
    assert.deepEqual(
      result.events.map((event) => event.sideBasis),
      ["none", "tick_test", "tick_test"],
    );
    assert.deepEqual(
      result.events.map((event) => event.sideConfidence),
      ["none", "medium", "low"],
    );
    assert.deepEqual(
      result.events.map((event) => event.sentiment),
      ["neutral", "bullish", "bullish"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses quote-match classification before tick-test fallback for derived historical flow", async () => {
  const originalFetch = globalThis.fetch;
  const baseTime = Date.parse("2026-05-06T14:30:00Z");
  const optionTicker = "O:SPY260506C00640000";

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.pathname === "/v3/snapshot/options/SPY") {
      return Response.json({
        results: [
          {
            details: {
              ticker: optionTicker,
              underlying_ticker: "SPY",
              expiration_date: "2026-05-06",
              strike_price: 640,
              contract_type: "call",
              shares_per_contract: 100,
            },
            greeks: { delta: 0.5, gamma: 0.01 },
            last_quote: { bid_price: 1, ask_price: 1.1 },
            last_trade: {
              price: 1.05,
              size: 10,
              sip_timestamp: baseTime,
            },
            open_interest: 100,
          },
        ],
      });
    }

    if (url.pathname === "/v3/reference/options/contracts") {
      return Response.json({ results: [] });
    }

    if (url.pathname === "/v3/reference/conditions") {
      return Response.json({ results: [] });
    }

    if (url.pathname.includes("/v3/trades/")) {
      return Response.json({
        results: [
          {
            price: 1.1,
            size: 10,
            sip_timestamp: baseTime + 60_000,
            sequence_number: 1,
            exchange: 304,
          },
        ],
      });
    }

    return Response.json({ results: [] });
  }) as typeof fetch;

  try {
    const client = new PolygonMarketDataClient({
      apiKey: "test",
      baseUrl: "https://polygon.test",
    });
    const events = await client.getDerivedFlowEvents({
      underlying: "SPY",
      from: new Date(baseTime - 1_000),
      to: new Date(baseTime + 120_000),
      limit: 10,
      snapshotPageLimit: 1,
      contractLimit: 1,
      contractPageLimit: 1,
      tradePageLimit: 1,
      tradeLimit: 10,
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].side, "buy");
    assert.equal(events[0].sideBasis, "quote_match");
    assert.equal(events[0].sideConfidence, "high");
    assert.equal(events[0].sentiment, "bullish");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("reports side split unavailable when option quote and trade access are forbidden", () => {
  const distribution = aggregateOptionPremiumDistributionSnapshots({
    underlying: "SPY",
    quoteAccess: "forbidden",
    tradeAccess: "forbidden",
    snapshots: [
      {
        details: { contract_type: "call", shares_per_contract: 100 },
        day: { c: 2, v: 100 },
      },
    ],
  });

  assert.equal(distribution.premiumTotal, 20_000);
  assert.equal(distribution.quoteAccess, "forbidden");
  assert.equal(distribution.tradeAccess, "forbidden");
  assert.equal(distribution.classificationConfidence, "none");
  assert.match(distribution.hydrationWarning ?? "", /quote-match and option trades/);
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

test("anchors premium trade hydration to the option snapshot trading date", async () => {
  const originalFetch = globalThis.fetch;
  const tradeDates: string[] = [];
  const quoteDates: string[] = [];
  const snapshotTimestamp = Date.parse("2026-05-06T20:00:00Z");

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.pathname === "/v3/snapshot/options/SPY") {
      return Response.json({
        results: [
          {
            details: {
              ticker: "O:SPY260506C00730000",
              contract_type: "call",
              shares_per_contract: 100,
            },
            day: {
              vwap: 1.5,
              volume: 1_000,
              last_updated: snapshotTimestamp,
            },
            last_trade: {
              price: 1.5,
              size: 1,
              sip_timestamp: snapshotTimestamp,
            },
          },
        ],
      });
    }

    if (url.pathname.includes("/v3/quotes/")) {
      quoteDates.push(url.searchParams.get("timestamp.gte") ?? "");
      return Response.json(
        { message: "not entitled to option quotes" },
        { status: 403 },
      );
    }

    if (url.pathname === "/v3/reference/conditions") {
      return Response.json({
        results: [
          {
            id: 209,
            name: "Regular",
            update_rules: { consolidated: { updates_volume: true } },
          },
        ],
      });
    }

    if (url.pathname.includes("/v3/trades/")) {
      tradeDates.push(url.searchParams.get("timestamp.gte") ?? "");
      return Response.json({
        results: [
          {
            price: 1,
            size: 10,
            sip_timestamp: snapshotTimestamp - 1_000,
            sequence_number: 1,
            conditions: [209],
            exchange: 304,
          },
          {
            price: 2,
            size: 10,
            sip_timestamp: snapshotTimestamp,
            sequence_number: 2,
            conditions: [209],
            exchange: 304,
          },
        ],
      });
    }

    return Response.json({ results: [] });
  }) as typeof fetch;

  try {
    const client = new PolygonMarketDataClient({
      apiKey: "test",
      baseUrl: "https://polygon.test",
    });
    const distribution = await client.getOptionPremiumDistribution({
      underlying: "SPY",
      marketCap: null,
      maxPages: 1,
      tradeContractLimit: 1,
      tradeLimit: 10,
    });

    assert.deepEqual(tradeDates, ["2026-05-06"]);
    assert.deepEqual(quoteDates, ["2026-05-06"]);
    assert.equal(distribution.tradeAccess, "available");
    assert.equal(distribution.quoteAccess, "forbidden");
    assert.equal(distribution.sideBasis, "tick_test");
    assert.equal(distribution.tickTestMatchedCount, 1);
    assert.equal(distribution.hydrationDiagnostics.snapshotTradingDate, "2026-05-06");
    assert.equal(distribution.hydrationDiagnostics.tradeLookbackStartDate, "2026-05-06");
    assert.equal(distribution.hydrationDiagnostics.quoteProbeDate, "2026-05-06");
    assert.equal(distribution.hydrationDiagnostics.tradeCallSuccessCount, 1);
    assert.equal(distribution.hydrationDiagnostics.tradeCallForbiddenCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selects premium trade hydration contracts by cumulative premium target", async () => {
  const originalFetch = globalThis.fetch;
  const tradeTickers: string[] = [];
  const snapshotTimestamp = Date.parse("2026-05-06T20:00:00Z");

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.pathname === "/v3/snapshot/options/SPY") {
      return Response.json({
        results: [
          {
            details: {
              ticker: "O:SPY260506C00600000",
              contract_type: "call",
              shares_per_contract: 100,
            },
            day: { vwap: 6, volume: 100, last_updated: snapshotTimestamp },
          },
          {
            details: {
              ticker: "O:SPY260506C00610000",
              contract_type: "call",
              shares_per_contract: 100,
            },
            day: { vwap: 2.5, volume: 100, last_updated: snapshotTimestamp },
          },
          {
            details: {
              ticker: "O:SPY260506C00620000",
              contract_type: "call",
              shares_per_contract: 100,
            },
            day: { vwap: 1, volume: 100, last_updated: snapshotTimestamp },
          },
          {
            details: {
              ticker: "O:SPY260506C00630000",
              contract_type: "call",
              shares_per_contract: 100,
            },
            day: { vwap: 0.5, volume: 100, last_updated: snapshotTimestamp },
          },
        ],
      });
    }

    if (url.pathname.includes("/v3/quotes/")) {
      return Response.json({ message: "not entitled" }, { status: 403 });
    }
    if (url.pathname === "/v3/reference/conditions") {
      return Response.json({ results: [] });
    }
    if (url.pathname.includes("/v3/trades/")) {
      tradeTickers.push(decodeURIComponent(url.pathname.split("/").pop() ?? ""));
      return Response.json({ results: [] });
    }
    return Response.json({ results: [] });
  }) as typeof fetch;

  try {
    const client = new PolygonMarketDataClient({
      apiKey: "test",
      baseUrl: "https://polygon.test",
    });
    const distribution = await client.getOptionPremiumDistribution({
      underlying: "SPY",
      marketCap: null,
      maxPages: 1,
      tradeContractLimit: 4,
      tradePremiumCoverageTarget: 0.85,
    });

    assert.deepEqual(tradeTickers, [
      "O:SPY260506C00600000",
      "O:SPY260506C00610000",
    ]);
    assert.equal(distribution.premiumTotal, 100_000);
    assert.equal(distribution.hydrationDiagnostics.usablePremiumTotal, 100_000);
    assert.equal(distribution.hydrationDiagnostics.selectedPremiumTotal, 85_000);
    assert.equal(
      distribution.hydrationDiagnostics.classificationTargetPremiumCoverage,
      0.85,
    );
    assert.equal(distribution.hydrationDiagnostics.selectedPremiumCoverage, 0.85);
    assert.equal(distribution.hydrationDiagnostics.tradeContractCandidateCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses a week lookback from the option snapshot trading date", async () => {
  const originalFetch = globalThis.fetch;
  const tradeDates: string[] = [];
  const snapshotTimestamp = Date.parse("2026-05-06T20:00:00Z");

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.pathname === "/v3/snapshot/options/SPY") {
      return Response.json({
        results: [
          {
            details: {
              ticker: "O:SPY260506C00730000",
              contract_type: "call",
              shares_per_contract: 100,
            },
            day: {
              vwap: 1.5,
              volume: 1_000,
              last_updated: snapshotTimestamp,
            },
            last_trade: { price: 1.5, size: 1 },
          },
        ],
      });
    }
    if (url.pathname.includes("/v3/quotes/")) {
      return Response.json({ message: "not entitled" }, { status: 403 });
    }
    if (url.pathname === "/v3/reference/conditions") {
      return Response.json({ results: [] });
    }
    if (url.pathname.includes("/v3/trades/")) {
      tradeDates.push(url.searchParams.get("timestamp.gte") ?? "");
      return Response.json({ results: [] });
    }
    return Response.json({ results: [] });
  }) as typeof fetch;

  try {
    const client = new PolygonMarketDataClient({
      apiKey: "test",
      baseUrl: "https://polygon.test",
    });
    const distribution = await client.getOptionPremiumDistribution({
      underlying: "SPY",
      timeframe: "week",
      marketCap: null,
      maxPages: 1,
      tradeContractLimit: 1,
    });

    assert.deepEqual(tradeDates, ["2026-04-29"]);
    assert.equal(distribution.hydrationDiagnostics.snapshotTradingDate, "2026-05-06");
    assert.equal(distribution.hydrationDiagnostics.tradeLookbackStartDate, "2026-04-29");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
