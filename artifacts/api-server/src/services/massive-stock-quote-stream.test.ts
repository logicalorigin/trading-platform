import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  __massiveStockQuoteStreamInternalsForTests,
  getCurrentMassiveStockQuoteSnapshots,
  getMassiveStockQuoteStreamDiagnostics,
  subscribeMassiveStockQuoteSnapshots,
} from "./massive-stock-quote-stream";
import {
  __stockQuoteDayChangeContextTestInternals,
  recordStockQuoteDayChangeContext,
} from "./stock-quote-day-change-context";

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
  __stockQuoteDayChangeContextTestInternals.reset();
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
  assert.equal(quote?.volume, null);
});

test("Massive stock quote stream carries day-change context onto live trade prices", () => {
  recordStockQuoteDayChangeContext({
    symbol: "SPY",
    price: 499,
    change: 1,
    changePercent: 0.20080321285140562,
    open: 495,
    high: 501,
    low: 494,
    prevClose: 498,
    volume: 1_000_000,
    updatedAt: new Date("2026-05-27T20:29:00.000Z"),
  });
  __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
    ev: "T",
    sym: "SPY",
    p: 500.12,
    s: 100,
    t: Date.parse("2026-05-27T20:30:01.000Z"),
  });

  const [quote] = getCurrentMassiveStockQuoteSnapshots(["SPY"]);

  assert.equal(quote?.price, 500.12);
  assert.equal(quote?.prevClose, 498);
  assert.equal(quote?.change, 2.1200000000000045);
  assert.equal(quote?.changePercent, 0.4257028112449808);
  assert.equal(quote?.volume, 1_000_000);
});

test("Massive stock quote stream batches changed-symbol snapshots", () => {
  withMassiveRealtimeEnv(() => {
    const payloads: Array<{ quotes: Array<{ symbol: string; price: number }> }> = [];
    const unsubscribe = subscribeMassiveStockQuoteSnapshots(
      ["SPY", "QQQ"],
      (payload) => {
        payloads.push(payload);
      },
    );

    try {
      __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
        ev: "T",
        sym: "SPY",
        p: 500,
        t: Date.parse("2026-05-27T20:30:00.000Z"),
      });
      __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
        ev: "T",
        sym: "QQQ",
        p: 450,
        t: Date.parse("2026-05-27T20:30:00.000Z"),
      });

      assert.equal(payloads.length, 0);
      __massiveStockQuoteStreamInternalsForTests.flushSnapshotNotifications();

      assert.equal(payloads.length, 1);
      assert.deepEqual(
        payloads[0]?.quotes.map((quote) => [quote.symbol, quote.price]).sort(),
        [
          ["QQQ", 450],
          ["SPY", 500],
        ],
      );

      __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
        ev: "T",
        sym: "SPY",
        p: 501,
        t: Date.parse("2026-05-27T20:30:01.000Z"),
      });
      __massiveStockQuoteStreamInternalsForTests.flushSnapshotNotifications();

      assert.equal(payloads.length, 2);
      assert.deepEqual(
        payloads[1]?.quotes.map((quote) => [quote.symbol, quote.price]),
        [["SPY", 501]],
      );
    } finally {
      unsubscribe();
    }
  });
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
