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
  getStockAggregateStreamDiagnostics,
  resolvePreferredStockAggregateStreamSource,
  subscribeStockMinuteAggregates,
} from "./stock-aggregate-stream";

const ENV_KEYS = [
  "POLYGON_API_KEY",
  "POLYGON_KEY",
  "POLYGON_BASE_URL",
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
  "MASSIVE_API_BASE_URL",
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
    join(tmpdir(), "rayalgo-stock-aggregate-test-"),
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

test("stock aggregate stream source resolver prefers IBKR over delayed Polygon", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: true,
      polygonDelayedConfigured: true,
    }),
    "ibkr-websocket-derived",
  );
});

test("stock aggregate stream source resolver uses Polygon only as a delayed fallback", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: false,
      polygonDelayedConfigured: true,
    }),
    "polygon-delayed-websocket",
  );
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      ibkrConfigured: false,
      polygonDelayedConfigured: false,
    }),
    "none",
  );
});

test("configured IBKR bridge wins even when Polygon credentials are present", () => {
  withAggregateRuntimeEnv(
    {
      POLYGON_API_KEY: "polygon-test-key",
      POLYGON_BASE_URL: "https://api.polygon.io",
    },
    () => {
      assert.equal(
        getPreferredStockAggregateStreamSource(),
        "polygon-delayed-websocket",
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
