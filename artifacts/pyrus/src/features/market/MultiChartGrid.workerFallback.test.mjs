import assert from "node:assert/strict";
import test from "node:test";

import { mapMarketChartFlowEvents } from "./MultiChartGrid.jsx";

test("a cold flow-mapping worker gets a bounded startup window", async () => {
  const originalWindow = globalThis.window;
  let fallbackDelay = null;
  let clearedTimer = null;
  const mappedEvents = [{ id: "mapped-flow-1", ticker: "SPY" }];

  globalThis.window = {
    ...(originalWindow || {}),
    setTimeout(_callback, delay) {
      fallbackDelay = delay;
      return 1;
    },
    clearTimeout(timer) {
      clearedTimer = timer;
    },
  };

  try {
    const mapped = await mapMarketChartFlowEvents(
      [{ id: "flow-1" }],
      undefined,
      () => ({
        mapFlowEventsToUi: async () => mappedEvents,
      }),
    );

    assert.equal(fallbackDelay, 2_000);
    assert.equal(clearedTimer, 1);
    assert.deepEqual(mapped, mappedEvents);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("a stalled flow-mapping worker falls back once and opens its circuit", async () => {
  const originalWindow = globalThis.window;
  let workerCalls = 0;
  const stalledWorker = {
    mapFlowEventsToUi() {
      workerCalls += 1;
      return new Promise(() => {});
    },
  };
  const event = {
    id: "flow-1",
    basis: "trade",
    occurredAt: "2026-07-11T18:45:00.000Z",
    underlying: "SPY",
    expirationDate: "2026-07-17",
    right: "call",
    strike: 700,
    side: "buy",
    price: 1.25,
    size: 10,
  };

  globalThis.window = {
    ...(originalWindow || {}),
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
  };

  try {
    const first = await mapMarketChartFlowEvents(
      [event],
      undefined,
      () => stalledWorker,
    );
    const second = await mapMarketChartFlowEvents(
      [event],
      undefined,
      () => stalledWorker,
    );

    assert.equal(first[0]?.ticker, "SPY");
    assert.equal(second[0]?.ticker, "SPY");
    assert.equal(workerCalls, 1);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});
