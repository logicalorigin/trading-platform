import assert from "node:assert/strict";
import test from "node:test";

import { extractSparklinePoints } from "../../components/platform/primitives.jsx";
import { TRADE_TICKER_INFO } from "./runtimeTickerStore.js";
import { syncRuntimeMarketData } from "./runtimeMarketDataModel.js";

test("runtime market-data sync rejects non-drawable sparkline bars", () => {
  delete TRADE_TICKER_INFO.FFAI_TEST;

  syncRuntimeMarketData(
    ["FFAI_TEST"],
    [],
    [{ symbol: "FFAI_TEST", price: 12.4, updatedAt: "2026-06-08T20:00:00.000Z" }],
    {
      sparklineBarsBySymbol: {
        FFAI_TEST: [
          { timestamp: "2026-06-08T20:00:00.000Z" },
          { timestamp: "2026-06-08T20:01:00.000Z" },
        ],
      },
    },
  );

  assert.equal(extractSparklinePoints(TRADE_TICKER_INFO.FFAI_TEST.sparkBars).length, 0);

  syncRuntimeMarketData(["FFAI_TEST"], [], [], {
    sparklineBarsBySymbol: {
      FFAI_TEST: [
        { close: 12.1, timestamp: "2026-06-08T20:00:00.000Z" },
        { close: 12.4, timestamp: "2026-06-08T20:01:00.000Z" },
      ],
    },
  });

  assert.equal(extractSparklinePoints(TRADE_TICKER_INFO.FFAI_TEST.sparkBars).length, 2);

  delete TRADE_TICKER_INFO.FFAI_TEST;
});

test("runtime market-data sync clears seed-gated sparklines until durable bars arrive", () => {
  delete TRADE_TICKER_INFO.SEED_GATE_TEST;

  syncRuntimeMarketData(["SEED_GATE_TEST"], [], [], {
    sparklineBarsBySymbol: {
      SEED_GATE_TEST: [
        { close: 10.1, timestamp: "2026-06-08T20:00:00.000Z" },
        { close: 10.4, timestamp: "2026-06-08T20:01:00.000Z" },
      ],
    },
  });

  assert.equal(
    extractSparklinePoints(TRADE_TICKER_INFO.SEED_GATE_TEST.sparkBars).length,
    2,
  );

  syncRuntimeMarketData(["SEED_GATE_TEST"], [], [], {
    sparklineBarsBySymbol: {},
    clearSparklineSymbols: ["SEED_GATE_TEST"],
  });

  assert.deepEqual(TRADE_TICKER_INFO.SEED_GATE_TEST.sparkBars, []);
  assert.deepEqual(TRADE_TICKER_INFO.SEED_GATE_TEST.spark, []);

  syncRuntimeMarketData(["SEED_GATE_TEST"], [], [], {
    sparklineBarsBySymbol: {
      SEED_GATE_TEST: [
        { close: 11.1, timestamp: "2026-06-08T20:02:00.000Z" },
        { close: 11.4, timestamp: "2026-06-08T20:03:00.000Z" },
      ],
    },
    clearSparklineSymbols: ["SEED_GATE_TEST"],
  });

  assert.equal(
    extractSparklinePoints(TRADE_TICKER_INFO.SEED_GATE_TEST.sparkBars).length,
    2,
  );

  delete TRADE_TICKER_INFO.SEED_GATE_TEST;
});

test("runtime market-data sync carries extended-hours baseline fields", () => {
  delete TRADE_TICKER_INFO.EXT_TEST;

  syncRuntimeMarketData(
    ["EXT_TEST"],
    [],
    [
      {
        symbol: "EXT_TEST",
        price: 101,
        updatedAt: "2026-06-09T21:00:00.000Z",
        dataUpdatedAt: "2026-06-09T21:00:00.000Z",
        extendedBaselinePrice: 100,
        extendedBaselineAt: "2026-06-09T20:00:00.000Z",
        extendedBaselineSource: "regular_close",
      },
    ],
  );

  assert.equal(TRADE_TICKER_INFO.EXT_TEST.extendedBaselinePrice, 100);
  assert.equal(
    TRADE_TICKER_INFO.EXT_TEST.extendedBaselineAt,
    "2026-06-09T20:00:00.000Z",
  );
  assert.equal(
    TRADE_TICKER_INFO.EXT_TEST.extendedBaselineSource,
    "regular_close",
  );

  delete TRADE_TICKER_INFO.EXT_TEST;
});
