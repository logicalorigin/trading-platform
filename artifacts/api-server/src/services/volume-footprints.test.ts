import assert from "node:assert/strict";
import test from "node:test";

import { __volumeFootprintInternalsForTests } from "./volume-footprints";

const trade = (price: number, occurredAt: Date) => ({
  price,
  size: 1,
  occurredAt,
  sequenceNumber: null,
  conditionCodes: [],
  exchange: null,
});

test("footprint classification never uses a quote from after the trade", () => {
  const occurredAt = new Date("2026-07-02T14:30:00.000Z");
  const [classified] = __volumeFootprintInternalsForTests.classifyTrades({
    trades: [trade(101, occurredAt)],
    quotes: [
      {
        bid: 99,
        ask: 100,
        bidSize: null,
        askSize: null,
        occurredAt: new Date(occurredAt.getTime() + 500),
        sequenceNumber: null,
        exchange: null,
      },
    ],
  });

  assert.equal(classified?.side, "unknown");
  assert.equal(classified?.method, "unknown");
});

test("footprint candles compute OHLC without spreading every trade price", () => {
  const from = new Date("2026-07-02T14:30:00.000Z");
  type ClassifiedTrade = Parameters<
    typeof __volumeFootprintInternalsForTests.buildCandles
  >[0]["trades"][number];
  const prices = [101, 99, 102, 100] as const;
  const trades: ClassifiedTrade[] = Array.from(
    { length: 200_000 },
    (_, index) => ({
      ...trade(
        prices[index % prices.length]!,
        new Date(from.getTime() + (index % 1_000)),
      ),
      side: "buy",
      method: "tick_rule",
    }),
  );

  const [candle] = __volumeFootprintInternalsForTests.buildCandles({
    trades,
    timeframe: "1m",
    from,
    to: new Date(from.getTime() + 60_000),
    rowSize: 1,
    imbalancePercent: 300,
    capped: false,
  });

  assert.equal(candle?.open, 101);
  assert.equal(candle?.high, 102);
  assert.equal(candle?.low, 99);
  assert.equal(candle?.close, 100);
  assert.equal(candle?.tradeCount, trades.length);
  assert.equal(candle?.volume, trades.length);
});
