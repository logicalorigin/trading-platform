import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  __massiveStockQuoteStreamInternalsForTests,
  getCurrentMassiveStockQuoteSnapshots,
  getMassiveStockQuoteStreamDiagnostics,
} from "./massive-stock-quote-stream";

const ENV_KEYS = [
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
  "MASSIVE_STOCKS_RECENCY",
] as const;

function withMassiveRealtimeEnv(task: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
  }
  process.env["MASSIVE_API_KEY"] = "massive-test-key";
  delete process.env["MASSIVE_MARKET_DATA_API_KEY"];
  delete process.env["MASSIVE_STOCKS_RECENCY"];

  try {
    task();
  } finally {
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

test.afterEach(() => {
  __massiveStockQuoteStreamInternalsForTests.reset();
});

test("Massive stock quote stream maps quote and trade messages to live snapshots", () => {
  __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
    ev: "Q",
    sym: "SPY",
    bp: 500,
    ap: 500.2,
    bs: 10,
    as: 12,
    t: Date.parse("2026-05-27T20:30:00.000Z"),
  });
  __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
    ev: "T",
    sym: "SPY",
    p: 500.12,
    s: 100,
    t: Date.parse("2026-05-27T20:30:01.000Z"),
  });

  const [quote] = getCurrentMassiveStockQuoteSnapshots(["SPY"]);

  assert.equal(quote?.symbol, "SPY");
  assert.equal(quote?.source, "massive");
  assert.equal(quote?.price, 500.12);
  assert.equal(quote?.bid, 500);
  assert.equal(quote?.ask, 500.2);
  assert.equal(quote?.freshness, "live");
  assert.equal(quote?.delayed, false);
});

test("Massive stock quote stream diagnostics expose WebSocket channels", () => {
  withMassiveRealtimeEnv(() => {
    const diagnostics = getMassiveStockQuoteStreamDiagnostics();

    assert.deepEqual(diagnostics.availableChannels, ["Q", "T"]);
    assert.deepEqual(diagnostics.subscribedChannels, []);
    assert.equal(diagnostics.providerIdentity, "massive");
    assert.equal(diagnostics.mode, "real-time");
    assert.equal(diagnostics.socketHost, "socket.massive.com");
  });
});

test("shared Massive stock quote transport closes connecting sockets without unhandled errors", () => {
  const source = readFileSync(
    new URL("./massive-stock-websocket.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /currentSocket\.on\("error"/);
  assert.match(
    source,
    /currentSocket\.readyState === WebSocket\.CONNECTING[\s\S]*currentSocket\.terminate\(\)/,
  );
  assert.match(
    source,
    /socket && socket\.readyState === WebSocket\.CONNECTING[\s\S]*return;/,
  );
  assert.doesNotMatch(source, /removeAllListeners\(\);\s*socket\.close\(\)/);
});
