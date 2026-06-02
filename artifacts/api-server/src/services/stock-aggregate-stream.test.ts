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
  getPreferredStockAggregateStreamSource,
  getRecentStockMinuteAggregateHistory,
  getStockAggregateStreamDiagnostics,
  resolvePreferredStockAggregateStreamSource,
  subscribeStockMinuteAggregates,
} from "./stock-aggregate-stream";

const ENV_KEYS = [
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
  "MASSIVE_API_BASE_URL",
  "MASSIVE_STOCKS_RECENCY",
  "IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
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

test("stock aggregate stream source resolver prefers Massive real-time over IBKR", () => {
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

test("Massive real-time stock aggregates win even when IBKR is configured", () => {
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

      assert.equal(getPreferredStockAggregateStreamSource(), "massive-websocket");
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
