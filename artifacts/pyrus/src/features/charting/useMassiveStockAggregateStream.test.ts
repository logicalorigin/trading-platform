import assert from "node:assert/strict";
import test from "node:test";

const waitForTimers = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 50));

test("symbol updates wait for readiness after initial open and automatic reconnect", async () => {
  const originalWindow = globalThis.window;
  const originalEventSource = globalThis.EventSource;
  const originalFetch = globalThis.fetch;
  const sources: FakeEventSource[] = [];
  let fetchCount = 0;

  class FakeEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readonly url: string;
    readonly withCredentials = false;
    readyState = FakeEventSource.OPEN;
    closed = false;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: ((event: Event) => void) | null = null;
    listeners = new Map<string, EventListener>();

    constructor(url: string | URL) {
      this.url = String(url);
      sources.push(this);
    }

    addEventListener(type: string, listener: EventListener): void {
      this.listeners.set(type, listener);
    }
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return true;
    }
    close(): void {
      this.closed = true;
      this.readyState = FakeEventSource.CLOSED;
    }
    emit(type: string): void {
      this.listeners.get(type)?.(new Event(type));
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      EventSource: FakeEventSource,
      setTimeout: (callback: TimerHandler, delay?: number) =>
        setTimeout(callback, Math.min(delay ?? 0, 5)),
      clearTimeout,
      setInterval,
      clearInterval,
    },
  });
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: FakeEventSource,
  });
  globalThis.fetch = async () => {
    fetchCount += 1;
    return fetchCount === 1
      ? ({ ok: true, status: 200 } as Response)
      : ({ ok: false, status: 404 } as Response);
  };

  const {
    __brokerStockAggregateStreamTestHooks: hooks,
    getBrokerStockAggregateDebugStats,
    setBrokerStockAggregateStreamPaused,
  } = await import("./useMassiveStockAggregateStream");
  const unsubscribeAapl = hooks.registerConsumer(["AAPL"]);

  try {
    await waitForTimers();
    assert.equal(sources.length, 1);

    const reconnectsBefore = getBrokerStockAggregateDebugStats().reconnectCount;
    const unsubscribeMsft = hooks.registerConsumer(["MSFT"]);
    try {
      await waitForTimers();
      assert.equal(fetchCount, 0, "the server has not emitted ready yet");
      assert.equal(sources[0]?.closed, false);

      sources[0]?.emit("ready");
      await waitForTimers();
      assert.equal(fetchCount, 1);

      sources[0]!.readyState = FakeEventSource.CONNECTING;
      sources[0]?.onerror?.(new Event("error"));
      const unsubscribeNvda = hooks.registerConsumer(["NVDA"]);
      try {
        await waitForTimers();
        assert.equal(
          fetchCount,
          1,
          "a reconnecting browser stream has no ready server session",
        );

        sources[0]!.readyState = FakeEventSource.OPEN;
        sources[0]?.onopen?.(new Event("open"));
        await waitForTimers();
        assert.equal(fetchCount, 1, "native open is not application ready");

        sources[0]?.emit("ready");
        await waitForTimers();
      } finally {
        unsubscribeNvda();
      }

      assert.equal(fetchCount, 2);
      assert.equal(sources[0]?.closed, true);
      assert.equal(sources.length, 2);
      assert.equal(
        getBrokerStockAggregateDebugStats().reconnectCount - reconnectsBefore,
        1,
      );
    } finally {
      unsubscribeMsft();
    }
  } finally {
    unsubscribeAapl();
    setBrokerStockAggregateStreamPaused(true);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: originalEventSource,
    });
    globalThis.fetch = originalFetch;
  }
});

const validAggregate = {
  eventType: "AM",
  symbol: "aapl",
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 10,
  accumulatedVolume: 100,
  vwap: 100.25,
  sessionVwap: 100.1,
  officialOpen: 99.5,
  averageTradeSize: 2,
  startMs: 1_700_000_000_000,
  endMs: 1_700_000_059_999,
  delayed: false,
  source: "massive-websocket",
};

test("aggregate stream payloads are validated before entering the cache", async () => {
  const { __brokerStockAggregateStreamTestHooks: hooks } = await import(
    "./useMassiveStockAggregateStream"
  );

  assert.equal(hooks.parseAggregateMessage("{}"), null);
  assert.equal(hooks.parseAggregateMessage("null"), null);
  assert.equal(
    hooks.parseAggregateMessage(
      JSON.stringify({ ...validAggregate, close: "100.5" }),
    ),
    null,
  );
  assert.deepEqual(
    hooks.parseAggregateMessage(JSON.stringify(validAggregate)),
    { ...validAggregate, symbol: "AAPL" },
  );
});

test("cache equality includes rendered source, delay, and official-open metadata", async () => {
  const { __brokerStockAggregateStreamTestHooks: hooks } = await import(
    "./useMassiveStockAggregateStream"
  );
  const current = { ...validAggregate, symbol: "AAPL" };

  assert.equal(
    hooks.hasAggregateChanged(current, { ...current, officialOpen: 100 }),
    true,
  );
  assert.equal(
    hooks.hasAggregateChanged(current, { ...current, delayed: true }),
    true,
  );
  assert.equal(
    hooks.hasAggregateChanged(current, {
      ...current,
      source: "massive-delayed-websocket",
    }),
    true,
  );
});
