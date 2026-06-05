import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearIbkrBridgeRuntimeOverride,
  setIbkrBridgeRuntimeOverride,
} from "../lib/runtime";
import {
  __stockAggregateStreamTestInternals,
  getCurrentStockMinuteAggregates,
  getPreferredStockAggregateStreamSource,
  getRecentStockMinuteAggregateHistory,
  getStockAggregateStreamDiagnostics,
  hasRecentStockAggregateSourceActivity,
  isForegroundSignalMatrixStockAggregateStreamingEnabled,
  resolvePreferredStockAggregateStreamSource,
  subscribeStockMinuteAggregates,
} from "./stock-aggregate-stream";

const ENV_KEYS = [
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
  "MASSIVE_API_BASE_URL",
  "MASSIVE_STOCKS_RECENCY",
  "IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
  "PYRUS_SIGNAL_MATRIX_STOCK_AGGREGATE_STREAMS_ENABLED",
] as const;

function withAggregateRuntimeEnv<T>(
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  task: () => T,
): T {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
  }

  const isolatedOverrideDir = mkdtempSync(
    join(tmpdir(), "pyrus-stock-aggregate-test-"),
  );
  const isolatedOverrideFile = join(isolatedOverrideDir, "runtime.json");

  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] =
    values["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] ?? isolatedOverrideFile;
  clearIbkrBridgeRuntimeOverride();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  try {
    return task();
  } finally {
    clearIbkrBridgeRuntimeOverride();
    rmSync(isolatedOverrideDir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("stock aggregate stream source resolver prefers IBKR over delayed Massive", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: true,
      massiveDelayedConfigured: true,
      massiveRealtimeConfigured: false,
    }),
    "ibkr-websocket-derived",
  );
});

test("stock aggregate stream source resolver keeps Massive real-time primary over IBKR", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: true,
      massiveDelayedConfigured: true,
      massiveRealtimeConfigured: true,
    }),
    "massive-websocket",
  );
});

test("stock aggregate stream source resolver uses Massive only as a delayed fallback", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: false,
      massiveDelayedConfigured: true,
    }),
    "massive-delayed-websocket",
  );
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: false,
      massiveDelayedConfigured: false,
    }),
    "none",
  );
});

test("foreground signal matrix stock aggregate streaming is enabled by default and env gated", () => {
  withAggregateRuntimeEnv({}, () => {
    assert.equal(isForegroundSignalMatrixStockAggregateStreamingEnabled(), true);
  });

  withAggregateRuntimeEnv(
    { PYRUS_SIGNAL_MATRIX_STOCK_AGGREGATE_STREAMS_ENABLED: "false" },
    () => {
      assert.equal(isForegroundSignalMatrixStockAggregateStreamingEnabled(), false);
    },
  );
});

test("configured IBKR bridge wins when Massive is delayed", () => {
  withAggregateRuntimeEnv(
    {
      MASSIVE_API_KEY: "massive-test-key",
      MASSIVE_API_BASE_URL: "https://api.massive.com",
      MASSIVE_STOCKS_RECENCY: "delayed",
    },
    () => {
      assert.equal(
        getPreferredStockAggregateStreamSource(),
        "massive-delayed-websocket",
      );

      setIbkrBridgeRuntimeOverride({
        baseUrl: "https://runtime-bridge.example.com",
        apiToken: "runtime-token",
      });

      assert.equal(
        getPreferredStockAggregateStreamSource(),
        "ibkr-websocket-derived",
      );
    },
  );
});

test("Massive real-time stock aggregates remain primary with IBKR runtime bridge", () => {
  withAggregateRuntimeEnv(
    {
      MASSIVE_API_KEY: "massive-test-key",
    },
    () => {
      assert.equal(getPreferredStockAggregateStreamSource(), "massive-websocket");

      setIbkrBridgeRuntimeOverride({
        baseUrl: "https://runtime-bridge.example.com",
        apiToken: "runtime-token",
      });

      assert.equal(
        getPreferredStockAggregateStreamSource(),
        "massive-websocket",
      );
    },
  );
});

test("stock aggregate diagnostics expose Massive aggregate WebSocket channel", () => {
  withAggregateRuntimeEnv(
    {
      MASSIVE_API_KEY: "massive-test-key",
    },
    () => {
      const diagnostics = getStockAggregateStreamDiagnostics();

      assert.equal(diagnostics.provider, "massive-websocket");
      assert.equal(
        diagnostics.massiveDelayedWebSocket.providerIdentity,
        "massive",
      );
      assert.equal(diagnostics.massiveDelayedWebSocket.mode, "real-time");
      assert.deepEqual(
        diagnostics.massiveDelayedWebSocket.availableChannels,
        ["AM"],
      );
      assert.equal(
        diagnostics.massiveDelayedWebSocket.socketHost,
        "socket.massive.com",
      );
    },
  );
});

test("Massive delayed stock aggregate mode falls back to IBKR when configured", () => {
  withAggregateRuntimeEnv(
    {
      MASSIVE_API_KEY: "massive-test-key",
      MASSIVE_STOCKS_RECENCY: "delayed",
    },
    () => {
      setIbkrBridgeRuntimeOverride({
        baseUrl: "https://runtime-bridge.example.com",
        apiToken: "runtime-token",
      });

      assert.equal(
        getPreferredStockAggregateStreamSource(),
        "ibkr-websocket-derived",
      );
    },
  );
});

test("stock aggregate diagnostics track per-symbol freshness", () => {
  withAggregateRuntimeEnv({}, () => {
    setIbkrBridgeRuntimeOverride({
      baseUrl: "https://runtime-bridge.example.com",
      apiToken: "runtime-token",
    });
    __stockAggregateStreamTestInternals.reset();
    const unsubscribe = subscribeStockMinuteAggregates(["SPY"], () => {});

    try {
      __stockAggregateStreamTestInternals.handleQuoteSnapshot(
        {
          quotes: [
            {
              symbol: "SPY",
              price: 100,
              bid: 0,
              ask: 0,
              volume: 1_000,
            } as any,
          ],
        },
        0,
      );
      __stockAggregateStreamTestInternals.flushAggregateFanout();

      const diagnostics = getStockAggregateStreamDiagnostics();
      assert.equal(diagnostics.perSymbol[0]?.symbol, "SPY");
      assert.equal(diagnostics.perSymbol[0]?.hasAccumulator, true);
      assert.equal(diagnostics.perSymbol[0]?.eventCount, 1);
      assert.equal(diagnostics.perSymbol[0]?.gapCount, 0);
    } finally {
      unsubscribe();
      __stockAggregateStreamTestInternals.reset();
    }
  });
});

test("stock aggregate stream retains recent minute aggregate history", () => {
  withAggregateRuntimeEnv({}, () => {
    setIbkrBridgeRuntimeOverride({
      baseUrl: "https://runtime-bridge.example.com",
      apiToken: "runtime-token",
    });
    __stockAggregateStreamTestInternals.reset();
    const unsubscribe = subscribeStockMinuteAggregates(["SPY"], () => {});

    try {
      __stockAggregateStreamTestInternals.handleQuoteSnapshot(
        {
          quotes: [
            {
              symbol: "SPY",
              price: 100,
              bid: 0,
              ask: 0,
              volume: 1_000,
            } as any,
          ],
        },
        0,
      );
      __stockAggregateStreamTestInternals.handleQuoteSnapshot(
        {
          quotes: [
            {
              symbol: "SPY",
              price: 101,
              bid: 0,
              ask: 0,
              volume: 1_200,
            } as any,
          ],
        },
        60_000,
      );
      __stockAggregateStreamTestInternals.flushAggregateFanout();

      const history = getRecentStockMinuteAggregateHistory({ symbol: "spy" });
      assert.deepEqual(
        history.map((message) => ({
          symbol: message.symbol,
          startMs: message.startMs,
          close: message.close,
          volume: message.volume,
        })),
        [
          { symbol: "SPY", startMs: 0, close: 100, volume: 0 },
          { symbol: "SPY", startMs: 60_000, close: 101, volume: 200 },
        ],
      );

      __stockAggregateStreamTestInternals.reset();
      assert.deepEqual(
        getRecentStockMinuteAggregateHistory({ symbol: "SPY" }),
        [],
      );
    } finally {
      unsubscribe();
      __stockAggregateStreamTestInternals.reset();
    }
  });
});

test("stock aggregate stream coalesces repeated same-minute quote updates before fanout", () => {
  withAggregateRuntimeEnv({}, () => {
    setIbkrBridgeRuntimeOverride({
      baseUrl: "https://runtime-bridge.example.com",
      apiToken: "runtime-token",
    });
    __stockAggregateStreamTestInternals.reset();
    const messages: unknown[] = [];
    const unsubscribe = subscribeStockMinuteAggregates(["SPY"], (message) => {
      messages.push(message);
    });

    try {
      [100, 101, 99].forEach((price, index) => {
        __stockAggregateStreamTestInternals.handleQuoteSnapshot(
          {
            quotes: [
              {
                symbol: "SPY",
                price,
                bid: 0,
                ask: 0,
                volume: 1_000 + index * 100,
              } as any,
            ],
          },
          index * 1_000,
        );
      });

      let diagnostics = getStockAggregateStreamDiagnostics();
      assert.equal(messages.length, 0);
      assert.equal(diagnostics.pendingFanoutCount, 1);
      assert.equal(diagnostics.perSymbol[0]?.eventCount, 0);

      __stockAggregateStreamTestInternals.flushAggregateFanout();

      assert.equal(messages.length, 1);
      assert.equal((messages[0] as any).open, 100);
      assert.equal((messages[0] as any).high, 101);
      assert.equal((messages[0] as any).low, 99);
      assert.equal((messages[0] as any).close, 99);
      assert.equal((messages[0] as any).volume, 200);
      assert.deepEqual(
        getRecentStockMinuteAggregateHistory({ symbol: "SPY" }).map((message) => ({
          startMs: message.startMs,
          open: message.open,
          high: message.high,
          low: message.low,
          close: message.close,
          volume: message.volume,
        })),
        [
          {
            startMs: 0,
            open: 100,
            high: 101,
            low: 99,
            close: 99,
            volume: 200,
          },
        ],
      );

      diagnostics = getStockAggregateStreamDiagnostics();
      assert.equal(diagnostics.pendingFanoutCount, 0);
      assert.equal(diagnostics.perSymbol[0]?.eventCount, 1);
    } finally {
      unsubscribe();
      __stockAggregateStreamTestInternals.reset();
    }
  });
});

test("stock aggregate stream emits flat carry-forward aggregates while quotes are quiet", () => {
  withAggregateRuntimeEnv({}, () => {
    setIbkrBridgeRuntimeOverride({
      baseUrl: "https://runtime-bridge.example.com",
      apiToken: "runtime-token",
    });
    __stockAggregateStreamTestInternals.reset();
    const messages: unknown[] = [];
    const unsubscribe = subscribeStockMinuteAggregates(["SPY"], (message) => {
      messages.push(message);
    });

    try {
      __stockAggregateStreamTestInternals.handleQuoteSnapshot(
        {
          quotes: [
            {
              symbol: "SPY",
              price: 100,
              bid: 0,
              ask: 0,
              volume: 1_000,
            } as any,
          ],
        },
        0,
      );
      __stockAggregateStreamTestInternals.flushAggregateFanout();
      assert.equal(messages.length, 1);

      __stockAggregateStreamTestInternals.emitAggregateHeartbeats(61_000);
      __stockAggregateStreamTestInternals.flushAggregateFanout();

      assert.equal(messages.length, 2);
      assert.equal((messages[1] as any).startMs, 60_000);
      assert.equal((messages[1] as any).open, 100);
      assert.equal((messages[1] as any).high, 100);
      assert.equal((messages[1] as any).low, 100);
      assert.equal((messages[1] as any).close, 100);
      assert.equal((messages[1] as any).volume, 0);
      assert.equal((messages[1] as any).accumulatedVolume, 1_000);
    } finally {
      unsubscribe();
      __stockAggregateStreamTestInternals.reset();
    }
  });
});

test("stock aggregate source activity ignores carry-forward heartbeats for quote-derived streams", () => {
  withAggregateRuntimeEnv({}, () => {
    setIbkrBridgeRuntimeOverride({
      baseUrl: "https://runtime-bridge.example.com",
      apiToken: "runtime-token",
    });
    __stockAggregateStreamTestInternals.reset();
    const unsubscribe = subscribeStockMinuteAggregates(["SPY"], () => {});

    try {
      __stockAggregateStreamTestInternals.handleQuoteSnapshot(
        {
          quotes: [
            {
              symbol: "SPY",
              price: 100,
              bid: 0,
              ask: 0,
              volume: 1_000,
            } as any,
          ],
        },
        0,
      );
      assert.equal(
        hasRecentStockAggregateSourceActivity({
          symbols: ["spy"],
          now: new Date(30_000),
          maxAgeMs: 60_000,
        }),
        true,
      );

      __stockAggregateStreamTestInternals.emitAggregateHeartbeats(120_000);
      __stockAggregateStreamTestInternals.flushAggregateFanout();
      assert.equal(
        hasRecentStockAggregateSourceActivity({
          symbols: ["SPY"],
          now: new Date(120_000),
          maxAgeMs: 60_000,
        }),
        false,
      );
    } finally {
      unsubscribe();
      __stockAggregateStreamTestInternals.reset();
    }
  });
});

test("Massive real-time quote ticks synthesize stock aggregate bars", () => {
  withAggregateRuntimeEnv(
    {
      MASSIVE_API_KEY: "massive-test-key",
    },
    () => {
      __stockAggregateStreamTestInternals.reset();
      const messages: unknown[] = [];
      const unsubscribe = subscribeStockMinuteAggregates(["PWR"], (message) => {
        messages.push(message);
      });

      try {
        __stockAggregateStreamTestInternals.handleMassiveQuoteSnapshot(
          {
            quotes: [
              {
                symbol: "PWR",
                price: 700,
                bid: 699.5,
                ask: 700.5,
                volume: null,
              } as any,
            ],
          },
          0,
        );
        __stockAggregateStreamTestInternals.flushAggregateFanout();

        assert.equal(messages.length, 1);
        assert.equal((messages[0] as any).symbol, "PWR");
        assert.equal((messages[0] as any).source, "massive-websocket");
        assert.equal((messages[0] as any).startMs, 0);
        assert.equal((messages[0] as any).close, 700);
        assert.equal(
          getCurrentStockMinuteAggregates(["pwr"])[0]?.source,
          "massive-websocket",
        );

        __stockAggregateStreamTestInternals.emitAggregateHeartbeats(61_000);
        __stockAggregateStreamTestInternals.flushAggregateFanout();

        assert.equal(messages.length, 2);
        assert.equal((messages[1] as any).source, "massive-websocket");
        assert.equal((messages[1] as any).startMs, 60_000);
        assert.equal((messages[1] as any).close, 700);
        assert.equal((messages[1] as any).volume, 0);
      } finally {
        unsubscribe();
        __stockAggregateStreamTestInternals.reset();
      }
    },
  );
});
