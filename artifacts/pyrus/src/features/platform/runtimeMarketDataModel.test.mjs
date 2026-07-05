import assert from "node:assert/strict";
import test from "node:test";

import { extractSparklinePoints } from "../../components/platform/primitives.jsx";
import { TRADE_TICKER_INFO } from "./runtimeTickerStore.js";
import {
  applyRuntimeQuoteSnapshots,
  applyRuntimeSignalStatePrices,
  applyRuntimeStockAggregateSnapshots,
  syncRuntimeMarketData,
} from "./runtimeMarketDataModel.js";

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

test("runtime quote snapshots advance same-timestamp live prices", () => {
  delete TRADE_TICKER_INFO.EQUAL_TS_TEST;

  const timestamp = "2026-06-09T18:45:00.000Z";
  assert.equal(
    applyRuntimeQuoteSnapshots([
      {
        symbol: "EQUAL_TS_TEST",
        price: 100.25,
        updatedAt: timestamp,
        dataUpdatedAt: timestamp,
        source: "massive",
        transport: "massive_websocket",
      },
    ]),
    1,
  );
  assert.equal(TRADE_TICKER_INFO.EQUAL_TS_TEST.price, 100.25);

  assert.equal(
    applyRuntimeQuoteSnapshots([
      {
        symbol: "EQUAL_TS_TEST",
        price: 100.31,
        updatedAt: timestamp,
        dataUpdatedAt: timestamp,
        source: "massive",
        transport: "massive_websocket",
      },
    ]),
    1,
  );
  assert.equal(TRADE_TICKER_INFO.EQUAL_TS_TEST.price, 100.31);

  delete TRADE_TICKER_INFO.EQUAL_TS_TEST;
});

test("runtime quote snapshots derive display price from last-only live frames", () => {
  delete TRADE_TICKER_INFO.LAST_ONLY_TEST;

  const timestamp = "2026-06-09T18:45:00.000Z";
  assert.equal(
    applyRuntimeQuoteSnapshots([
      {
        symbol: "LAST_ONLY_TEST",
        last: 42.75,
        updatedAt: timestamp,
        dataUpdatedAt: timestamp,
        source: "massive",
        transport: "massive_websocket",
        freshness: "live",
        marketDataMode: "live",
      },
    ]),
    1,
  );
  assert.equal(TRADE_TICKER_INFO.LAST_ONLY_TEST.price, 42.75);
  assert.equal(TRADE_TICKER_INFO.LAST_ONLY_TEST.last, 42.75);

  delete TRADE_TICKER_INFO.LAST_ONLY_TEST;
});

test("runtime stock aggregates can hydrate ticker display prices without quote snapshots", () => {
  delete TRADE_TICKER_INFO.AGG_PRICE_TEST;

  assert.equal(
    applyRuntimeStockAggregateSnapshots([
      {
        symbol: "AGG_PRICE_TEST",
        open: 610,
        high: 613,
        low: 609,
        close: 612.34,
        volume: 10_000,
        accumulatedVolume: 123_456,
        startMs: Date.parse("2026-06-26T19:59:00.000Z"),
        endMs: Date.parse("2026-06-26T20:00:00.000Z"),
        delayed: false,
        source: "massive-websocket",
      },
    ]),
    1,
  );

  assert.equal(TRADE_TICKER_INFO.AGG_PRICE_TEST.price, 612.34);
  assert.equal(TRADE_TICKER_INFO.AGG_PRICE_TEST.last, 612.34);
  assert.equal(TRADE_TICKER_INFO.AGG_PRICE_TEST.high, 613);
  assert.equal(TRADE_TICKER_INFO.AGG_PRICE_TEST.volume, 123_456);
  assert.equal(TRADE_TICKER_INFO.AGG_PRICE_TEST.freshness, "live");
  assert.equal(TRADE_TICKER_INFO.AGG_PRICE_TEST.transport, "massive-websocket");

  delete TRADE_TICKER_INFO.AGG_PRICE_TEST;
});

test("runtime stock aggregates do not future-stamp current bucket quote freshness", () => {
  delete TRADE_TICKER_INFO.AGG_CURRENT_BUCKET_TEST;

  const realDateNow = Date.now;
  Date.now = () => Date.parse("2026-06-26T20:00:20.000Z");
  try {
    assert.equal(
      applyRuntimeStockAggregateSnapshots([
        {
          symbol: "AGG_CURRENT_BUCKET_TEST",
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 10_000,
          accumulatedVolume: 123_456,
          startMs: Date.parse("2026-06-26T20:00:00.000Z"),
          endMs: Date.parse("2026-06-26T20:01:00.000Z"),
          delayed: false,
          source: "massive-websocket",
          latency: {
            apiServerReceivedAt: "2026-06-26T20:00:20.000Z",
          },
        },
      ]),
      1,
    );

    assert.equal(
      TRADE_TICKER_INFO.AGG_CURRENT_BUCKET_TEST.dataUpdatedAt,
      "2026-06-26T20:00:20.000Z",
    );

    Date.now = () => Date.parse("2026-06-26T20:00:30.000Z");
    assert.equal(
      applyRuntimeQuoteSnapshots([
        {
          symbol: "AGG_CURRENT_BUCKET_TEST",
          price: 100.9,
          updatedAt: "2026-06-26T20:00:30.000Z",
          dataUpdatedAt: "2026-06-26T20:00:30.000Z",
          source: "massive",
          transport: "massive_websocket",
          latency: {
            apiServerReceivedAt: "2026-06-26T20:00:30.000Z",
          },
        },
      ]),
      1,
    );
    assert.equal(TRADE_TICKER_INFO.AGG_CURRENT_BUCKET_TEST.price, 100.9);
  } finally {
    Date.now = realDateNow;
    delete TRADE_TICKER_INFO.AGG_CURRENT_BUCKET_TEST;
  }
});

test("runtime stock aggregates reject non-positive closes as ticker prices", () => {
  delete TRADE_TICKER_INFO.AGG_BAD_CLOSE_TEST;

  for (const badClose of [0, -3.2]) {
    assert.equal(
      applyRuntimeStockAggregateSnapshots([
        {
          symbol: "AGG_BAD_CLOSE_TEST",
          open: 610,
          high: 613,
          low: 609,
          close: badClose,
          volume: 10_000,
          accumulatedVolume: 123_456,
          startMs: Date.parse("2026-06-26T19:59:00.000Z"),
          endMs: Date.parse("2026-06-26T20:00:00.000Z"),
          delayed: false,
          source: "massive-websocket",
        },
      ]),
      0,
    );
    assert.equal(TRADE_TICKER_INFO.AGG_BAD_CLOSE_TEST, undefined);
  }

  delete TRADE_TICKER_INFO.AGG_BAD_CLOSE_TEST;
});

test("older stock aggregates do not overwrite newer quote snapshots", () => {
  delete TRADE_TICKER_INFO.AGG_OLDER_TEST;

  applyRuntimeQuoteSnapshots([
    {
      symbol: "AGG_OLDER_TEST",
      price: 100.25,
      updatedAt: "2026-06-26T20:01:00.000Z",
      dataUpdatedAt: "2026-06-26T20:01:00.000Z",
      source: "massive",
      transport: "massive_websocket",
    },
  ]);

  assert.equal(
    applyRuntimeStockAggregateSnapshots([
      {
        symbol: "AGG_OLDER_TEST",
        open: 90,
        high: 95,
        low: 89,
        close: 91,
        volume: 1_000,
        accumulatedVolume: 2_000,
        startMs: Date.parse("2026-06-26T19:58:00.000Z"),
        endMs: Date.parse("2026-06-26T19:59:00.000Z"),
        delayed: false,
        source: "massive-websocket",
      },
    ]),
    0,
  );
  assert.equal(TRADE_TICKER_INFO.AGG_OLDER_TEST.price, 100.25);

  delete TRADE_TICKER_INFO.AGG_OLDER_TEST;
});

test("runtime signal states hydrate ticker display prices from current bars", () => {
  delete TRADE_TICKER_INFO.SIGNAL_PRICE_TEST;

  assert.equal(
    applyRuntimeSignalStatePrices([
      {
        symbol: "SIGNAL_PRICE_TEST",
        currentPrice: null,
        latestBarClose: 321.45,
        latestBarAt: "2026-06-26T19:45:00.000Z",
        currentSignalPrice: 300,
        fresh: true,
      },
    ]),
    1,
  );

  assert.equal(TRADE_TICKER_INFO.SIGNAL_PRICE_TEST.price, 321.45);
  assert.equal(TRADE_TICKER_INFO.SIGNAL_PRICE_TEST.last, 321.45);
  assert.equal(
    TRADE_TICKER_INFO.SIGNAL_PRICE_TEST.dataUpdatedAt,
    "2026-06-26T19:45:00.000Z",
  );
  assert.equal(TRADE_TICKER_INFO.SIGNAL_PRICE_TEST.source, "signal-monitor");
  assert.equal(TRADE_TICKER_INFO.SIGNAL_PRICE_TEST.transport, "signal-monitor");
  assert.equal(TRADE_TICKER_INFO.SIGNAL_PRICE_TEST.freshness, "live");

  delete TRADE_TICKER_INFO.SIGNAL_PRICE_TEST;
});

test("runtime signal states do not use signal fire prices as ticker prices", () => {
  delete TRADE_TICKER_INFO.SIGNAL_FIRE_TEST;

  assert.equal(
    applyRuntimeSignalStatePrices([
      {
        symbol: "SIGNAL_FIRE_TEST",
        currentSignalPrice: 300,
        signalPrice: 300,
        currentSignalAt: "2026-06-26T19:30:00.000Z",
        fresh: true,
      },
    ]),
    0,
  );
  assert.equal(TRADE_TICKER_INFO.SIGNAL_FIRE_TEST, undefined);
});

test("older signal states do not overwrite newer quote snapshots", () => {
  delete TRADE_TICKER_INFO.SIGNAL_OLDER_TEST;

  applyRuntimeQuoteSnapshots([
    {
      symbol: "SIGNAL_OLDER_TEST",
      price: 100.25,
      updatedAt: "2026-06-26T20:01:00.000Z",
      dataUpdatedAt: "2026-06-26T20:01:00.000Z",
      source: "massive",
      transport: "massive_websocket",
    },
  ]);

  assert.equal(
    applyRuntimeSignalStatePrices([
      {
        symbol: "SIGNAL_OLDER_TEST",
        currentPrice: 99.5,
        latestBarAt: "2026-06-26T20:00:00.000Z",
        fresh: true,
      },
    ]),
    0,
  );
  assert.equal(TRADE_TICKER_INFO.SIGNAL_OLDER_TEST.price, 100.25);

  delete TRADE_TICKER_INFO.SIGNAL_OLDER_TEST;
});

test("runtime market-data sync derives display price from quote midpoint", () => {
  delete TRADE_TICKER_INFO.MIDPOINT_TEST;

  syncRuntimeMarketData(
    ["MIDPOINT_TEST"],
    [],
    [
      {
        symbol: "MIDPOINT_TEST",
        bid: 99.5,
        ask: 100.5,
        updatedAt: "2026-06-09T18:45:00.000Z",
        dataUpdatedAt: "2026-06-09T18:45:00.000Z",
        source: "massive",
        transport: "massive_websocket",
        freshness: "live",
        marketDataMode: "live",
      },
    ],
  );

  assert.equal(TRADE_TICKER_INFO.MIDPOINT_TEST.price, 100);
  assert.equal(TRADE_TICKER_INFO.MIDPOINT_TEST.bid, 99.5);
  assert.equal(TRADE_TICKER_INFO.MIDPOINT_TEST.ask, 100.5);

  delete TRADE_TICKER_INFO.MIDPOINT_TEST;
});

test("runtime quote snapshots reject older numeric latency tie-breakers", () => {
  delete TRADE_TICKER_INFO.NUMERIC_LATENCY_TEST;

  const timestamp = "2026-06-09T18:45:00.000Z";
  assert.equal(
    applyRuntimeQuoteSnapshots([
      {
        symbol: "NUMERIC_LATENCY_TEST",
        price: 100.25,
        updatedAt: timestamp,
        dataUpdatedAt: timestamp,
        source: "massive",
        transport: "massive_websocket",
        latency: {
          apiServerReceivedAt: 1_780_000_001_000,
        },
      },
    ]),
    1,
  );
  assert.equal(TRADE_TICKER_INFO.NUMERIC_LATENCY_TEST.price, 100.25);

  assert.equal(
    applyRuntimeQuoteSnapshots([
      {
        symbol: "NUMERIC_LATENCY_TEST",
        price: 100.31,
        updatedAt: timestamp,
        dataUpdatedAt: timestamp,
        source: "massive",
        transport: "massive_websocket",
        latency: {
          apiServerReceivedAt: 1_780_000_000_000,
        },
      },
    ]),
    0,
  );
  assert.equal(TRADE_TICKER_INFO.NUMERIC_LATENCY_TEST.price, 100.25);

  delete TRADE_TICKER_INFO.NUMERIC_LATENCY_TEST;
});

test("runtime quote snapshots reject future-dated incoming quote timestamps", () => {
  delete TRADE_TICKER_INFO.FUTURE_INCOMING_TEST;

  const realDateNow = Date.now;
  Date.now = () => Date.parse("2026-06-25T18:00:00.000Z");
  try {
    assert.equal(
      applyRuntimeQuoteSnapshots([
        {
          symbol: "FUTURE_INCOMING_TEST",
          price: 699.05,
          updatedAt: "2026-06-25T19:00:00.000Z",
          dataUpdatedAt: "2026-06-25T19:00:00.000Z",
          source: "massive",
          transport: "massive_websocket",
          latency: {
            apiServerReceivedAt: "2026-06-25T18:00:00.000Z",
          },
        },
      ]),
      0,
    );
    assert.equal(TRADE_TICKER_INFO.FUTURE_INCOMING_TEST.price, null);

    assert.equal(
      applyRuntimeQuoteSnapshots([
        {
          symbol: "FUTURE_INCOMING_TEST",
          price: 733.2,
          updatedAt: "2026-06-25T18:00:30.000Z",
          dataUpdatedAt: "2026-06-25T18:00:30.000Z",
          source: "massive",
          transport: "massive_websocket",
          latency: {
            apiServerReceivedAt: "2026-06-25T18:00:30.000Z",
          },
        },
      ]),
      1,
    );
    assert.equal(TRADE_TICKER_INFO.FUTURE_INCOMING_TEST.price, 733.2);
  } finally {
    Date.now = realDateNow;
    delete TRADE_TICKER_INFO.FUTURE_INCOMING_TEST;
  }
});

test("runtime quote snapshots recover from a future-dated stored timestamp", () => {
  delete TRADE_TICKER_INFO.FUTURE_STORED_TEST;

  const realDateNow = Date.now;
  Date.now = () => Date.parse("2026-06-25T18:01:00.000Z");
  try {
    TRADE_TICKER_INFO.FUTURE_STORED_TEST = {
      name: "FUTURE_STORED_TEST",
      price: 733.8,
      updatedAt: "2026-06-25T19:00:00.000Z",
      dataUpdatedAt: "2026-06-25T19:00:00.000Z",
      source: "massive",
      transport: "massive_websocket",
      latency: {
        apiServerReceivedAt: "2026-06-25T18:00:00.000Z",
      },
      spark: [],
      sparkBars: [],
    };

    assert.equal(
      applyRuntimeQuoteSnapshots([
        {
          symbol: "FUTURE_STORED_TEST",
          price: 733.2,
          updatedAt: "2026-06-25T18:00:30.000Z",
          dataUpdatedAt: "2026-06-25T18:00:30.000Z",
          source: "massive",
          transport: "massive_websocket",
          latency: {
            apiServerReceivedAt: "2026-06-25T18:00:30.000Z",
          },
        },
      ]),
      1,
    );
    assert.equal(TRADE_TICKER_INFO.FUTURE_STORED_TEST.price, 733.2);
    assert.equal(
      TRADE_TICKER_INFO.FUTURE_STORED_TEST.dataUpdatedAt,
      "2026-06-25T18:00:30.000Z",
    );
  } finally {
    Date.now = realDateNow;
    delete TRADE_TICKER_INFO.FUTURE_STORED_TEST;
  }
});
