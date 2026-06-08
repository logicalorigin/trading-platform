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
