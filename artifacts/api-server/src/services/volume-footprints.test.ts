import assert from "node:assert/strict";
import test from "node:test";
import {
  __volumeFootprintInternalsForTests,
  getVolumeFootprints,
} from "./volume-footprints";

const trade = (
  occurredAt: string,
  price: number,
  size: number,
  overrides: Record<string, unknown> = {},
) => ({
  price,
  size,
  exchange: "T",
  conditions: [],
  conditionCodes: [],
  sequenceNumber: Number(Date.parse(occurredAt)),
  occurredAt: new Date(occurredAt),
  ...overrides,
});

const classifiedTrade = (
  occurredAt: string,
  price: number,
  size: number,
  side: "buy" | "sell" | "unknown",
) => ({
  ...trade(occurredAt, price, size),
  side,
  method: "quote_match" as const,
});

test("classifies footprint prints from quote match before tick rule", () => {
  const classified = __volumeFootprintInternalsForTests.classifyTrades({
    trades: [
      trade("2026-05-28T14:30:01.000Z", 100.02, 10),
      trade("2026-05-28T14:30:02.000Z", 100.0, 12),
      trade("2026-05-28T14:30:03.000Z", 100.01, 8),
    ],
    quotes: [
      {
        bid: 100,
        ask: 100.02,
        bidSize: 10,
        askSize: 12,
        occurredAt: new Date("2026-05-28T14:30:00.000Z"),
        sequenceNumber: 1,
        exchange: "Q",
      },
    ],
  });

  assert.equal(classified[0].side, "buy");
  assert.equal(classified[0].method, "quote_match");
  assert.equal(classified[1].side, "sell");
  assert.equal(classified[1].method, "quote_match");
  assert.equal(classified[2].side, "buy");
  assert.equal(classified[2].method, "tick_rule");
});

test("builds footprint candle levels with POC and diagonal imbalances", () => {
  const candles = __volumeFootprintInternalsForTests.buildCandles({
    trades: [
      classifiedTrade("2026-05-28T14:30:01.000Z", 100.01, 10, "buy"),
      classifiedTrade("2026-05-28T14:30:02.000Z", 100.0, 40, "buy"),
      classifiedTrade("2026-05-28T14:30:03.000Z", 100.0, 40, "sell"),
      classifiedTrade("2026-05-28T14:30:04.000Z", 99.99, 10, "sell"),
    ],
    timeframe: "1m",
    from: new Date("2026-05-28T14:30:00.000Z"),
    to: new Date("2026-05-28T14:31:00.000Z"),
    rowSize: 0.01,
    imbalancePercent: 300,
    capped: false,
  });

  assert.equal(candles.length, 1);
  assert.equal(candles[0].volume, 100);
  assert.equal(candles[0].delta, 0);
  assert.equal(candles[0].pocPrice, 100);
  const middleLevel = candles[0].levels.find((level) => level.price === 100);
  assert.equal(middleLevel?.buyImbalance, true);
  assert.equal(middleLevel?.sellImbalance, true);
});

test("unsupported footprint timeframe returns diagnostic empty response", async () => {
  const response = await getVolumeFootprints({
    symbol: "SPY",
    assetClass: "equity",
    timeframe: "1d",
    from: new Date("2026-05-28T14:30:00.000Z"),
    to: new Date("2026-05-28T15:30:00.000Z"),
  });

  assert.equal(response.symbol, "SPY");
  assert.equal(response.complete, false);
  assert.equal(response.partialReason, "unsupported_timeframe");
  assert.equal(response.diagnostics.sourceProvider, "none");
  assert.deepEqual(response.candles, []);
});
