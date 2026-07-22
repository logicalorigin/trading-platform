import assert from "node:assert/strict";
import test from "node:test";

import { __resetProviderRuntimeConfigCacheForTests } from "../lib/runtime";
import {
  __resetMassiveDelayedWebSocketForTests,
  getMassiveDelayedWebSocketDiagnostics,
  subscribeMassiveStockMinuteAggregates,
} from "./massive-stock-aggregate-stream";

test("extended-hours trade demand is limited to explicit subscribers", () => {
  const priorApiKey = process.env.MASSIVE_API_KEY;
  const priorRecency = process.env.MASSIVE_STOCKS_RECENCY;
  process.env.MASSIVE_API_KEY = "test-key";
  process.env.MASSIVE_STOCKS_RECENCY = "realtime";
  __resetProviderRuntimeConfigCacheForTests();
  __resetMassiveDelayedWebSocketForTests();

  try {
    const unsubscribeBulk = subscribeMassiveStockMinuteAggregates(
      ["AAPL", "MSFT"],
      () => {},
      { extendedHoursTrades: false },
    );
    const unsubscribeForeground = subscribeMassiveStockMinuteAggregates(
      ["NVDA"],
      () => {},
      { extendedHoursTrades: true },
    );

    const diagnostics = getMassiveDelayedWebSocketDiagnostics();
    assert.equal(diagnostics.aggregateSymbolCount, 3);
    assert.equal(diagnostics.extendedHoursTradeSymbolCount, 1);

    unsubscribeBulk();
    unsubscribeForeground();
  } finally {
    __resetMassiveDelayedWebSocketForTests();
    if (priorApiKey === undefined) {
      delete process.env.MASSIVE_API_KEY;
    } else {
      process.env.MASSIVE_API_KEY = priorApiKey;
    }
    if (priorRecency === undefined) {
      delete process.env.MASSIVE_STOCKS_RECENCY;
    } else {
      process.env.MASSIVE_STOCKS_RECENCY = priorRecency;
    }
    __resetProviderRuntimeConfigCacheForTests();
  }
});
