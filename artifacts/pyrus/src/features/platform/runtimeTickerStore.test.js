import assert from "node:assert/strict";
import test from "node:test";
import {
  __runtimeTickerStoreTestHooks,
  applyRuntimeTickerInfoPatch,
  ensureTradeTickerInfo,
  getRuntimeTickerStoreCap,
  getRuntimeTickerStoreEntryCount,
  notifyRuntimeTickerSnapshotSymbols,
  TRADE_TICKER_INFO,
} from "./runtimeTickerStore.js";

const uniqueSymbol = (label) =>
  `ZZ${label}${Math.round(performance.now() * 1000)}`.toUpperCase();

test("runtime ticker store rejects older quote patches", () => {
  const symbol = uniqueSymbol("OLD");
  ensureTradeTickerInfo(symbol, symbol);

  applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 502,
    chg: 2,
    pct: 0.4,
    updatedAt: "2026-05-21T14:30:02.000Z",
  });
  const result = applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 499,
    chg: -1,
    pct: -0.2,
    updatedAt: "2026-05-21T14:29:58.000Z",
    spark: [{ i: 0, v: 498 }, { i: 1, v: 499 }],
  });

  assert.equal(result.tradeInfo.price, 502);
  assert.equal(result.tradeInfo.chg, 2);
  assert.equal(result.tradeInfo.pct, 0.4);
  assert.equal(result.tradeInfo.updatedAt, "2026-05-21T14:30:02.000Z");
  assert.deepEqual(result.tradeInfo.spark, [{ i: 0, v: 498 }, { i: 1, v: 499 }]);
});

test("runtime ticker store rejects untimestamped quote patches over timestamped data", () => {
  const symbol = uniqueSymbol("NOTIME");
  ensureTradeTickerInfo(symbol, symbol);

  applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 101,
    volume: 1000,
    updatedAt: "2026-05-21T14:30:02.000Z",
  });
  const result = applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 95,
    volume: 10,
  });

  assert.equal(result.tradeInfo.price, 101);
  assert.equal(result.tradeInfo.volume, 1000);
  assert.equal(result.tradeInfo.updatedAt, "2026-05-21T14:30:02.000Z");
});

test("runtime ticker store accepts newer quote patches", () => {
  const symbol = uniqueSymbol("NEW");
  ensureTradeTickerInfo(symbol, symbol);

  applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 502,
    updatedAt: "2026-05-21T14:30:02.000Z",
  });
  const result = applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 503,
    updatedAt: "2026-05-21T14:30:03.000Z",
  });

  assert.equal(result.tradeInfo.price, 503);
  assert.equal(result.tradeInfo.updatedAt, "2026-05-21T14:30:03.000Z");
});

test("runtime ticker store prefers dataUpdatedAt over wrapper updatedAt", () => {
  const symbol = uniqueSymbol("DATA");
  ensureTradeTickerInfo(symbol, symbol);

  applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 502,
    updatedAt: "2026-05-21T14:30:05.000Z",
    dataUpdatedAt: "2026-05-21T14:30:02.000Z",
  });
  const result = applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 499,
    updatedAt: "2026-05-21T14:31:00.000Z",
    dataUpdatedAt: "2026-05-21T14:29:58.000Z",
  });

  assert.equal(result.tradeInfo.price, 502);
  assert.equal(result.tradeInfo.dataUpdatedAt, "2026-05-21T14:30:02.000Z");
});

test("runtime ticker store keeps populated quote fields stable for the same quote timestamp", () => {
  const symbol = uniqueSymbol("SAME");
  ensureTradeTickerInfo(symbol, symbol);

  applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 502,
    bid: 501.99,
    ask: 502.01,
    source: "ibkr",
    updatedAt: "2026-05-21T14:30:02.000Z",
  });
  const result = applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 499,
    bid: 498.99,
    ask: 499.01,
    source: "fallback",
    volume: 1000,
    updatedAt: "2026-05-21T14:30:02.000Z",
  });

  assert.equal(result.tradeInfo.price, 502);
  assert.equal(result.tradeInfo.bid, 501.99);
  assert.equal(result.tradeInfo.ask, 502.01);
  assert.equal(result.tradeInfo.source, "ibkr");
  assert.equal(result.tradeInfo.volume, 1000);
});

test("runtime ticker store accepts same-timestamp quote patches with newer receive time", () => {
  const symbol = uniqueSymbol("SAMENEW");
  ensureTradeTickerInfo(symbol, symbol);

  applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 502,
    volume: 1000,
    updatedAt: "2026-05-21T14:30:02.000Z",
    dataUpdatedAt: "2026-05-21T14:30:02.000Z",
    latency: {
      apiServerReceivedAt: "2026-05-21T14:30:02.100Z",
    },
  });
  const result = applyRuntimeTickerInfoPatch(symbol, symbol, {
    price: 503,
    volume: 1001,
    updatedAt: "2026-05-21T14:30:02.000Z",
    dataUpdatedAt: "2026-05-21T14:30:02.000Z",
    latency: {
      apiServerReceivedAt: "2026-05-21T14:30:02.300Z",
    },
  });

  assert.equal(result.tradeInfo.price, 503);
  assert.equal(result.tradeInfo.volume, 1001);
});

test("runtime ticker store coalesces pending notifications", () => {
  const firstSymbol = uniqueSymbol("COALESCEA");
  const secondSymbol = uniqueSymbol("COALESCEB");
  ensureTradeTickerInfo(firstSymbol, firstSymbol);
  ensureTradeTickerInfo(secondSymbol, secondSymbol);

  let calls = 0;
  const unsubscribe =
    __runtimeTickerStoreTestHooks.subscribeToRuntimeTickerSnapshotSymbols(
      [firstSymbol, secondSymbol],
      () => {
        calls += 1;
      },
    );

  try {
    notifyRuntimeTickerSnapshotSymbols([firstSymbol]);
    notifyRuntimeTickerSnapshotSymbols([secondSymbol]);

    assert.equal(calls, 0);

    __runtimeTickerStoreTestHooks.flushRuntimeTickerSnapshotNotifications();

    assert.equal(calls, 1);
  } finally {
    unsubscribe();
    __runtimeTickerStoreTestHooks.clearPendingRuntimeTickerSnapshotNotifications();
  }
});

test("runtime ticker store caps unobserved dynamic tickers", () => {
  const cap = getRuntimeTickerStoreCap();

  for (let index = 0; index < cap + 40; index += 1) {
    ensureTradeTickerInfo(`ZZCAP${index}`, `ZZCAP${index}`);
  }

  assert.ok(getRuntimeTickerStoreEntryCount() <= cap);
  assert.ok(ensureTradeTickerInfo("SPY", "SPY"));
});

test("runtime ticker store keeps new tickers when observed entries block pruning", () => {
  const cap = getRuntimeTickerStoreCap();
  const unsubscribers = Object.keys(TRADE_TICKER_INFO).map((symbol) =>
    __runtimeTickerStoreTestHooks.subscribeToRuntimeTickerSnapshotSymbols(
      [symbol],
      () => {},
    ),
  );

  try {
    for (let index = 0; getRuntimeTickerStoreEntryCount() < cap; index += 1) {
      const symbol = `ZZOBSERVED${index}`;
      ensureTradeTickerInfo(symbol, symbol);
      unsubscribers.push(
        __runtimeTickerStoreTestHooks.subscribeToRuntimeTickerSnapshotSymbols(
          [symbol],
          () => {},
        ),
      );
    }

    const symbol = uniqueSymbol("KEPT");
    const info = ensureTradeTickerInfo(symbol, symbol);

    assert.equal(info.name, symbol);
    assert.equal(TRADE_TICKER_INFO[symbol], info);
  } finally {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  }
});
