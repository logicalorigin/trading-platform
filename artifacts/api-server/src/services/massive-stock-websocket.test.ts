import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  __massiveStockWebSocketInternalsForTests,
  getMassiveStockWebSocketDiagnostics,
  subscribeMassiveStockWebSocket,
} from "./massive-stock-websocket";

const ENV_KEYS = [
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
  "MASSIVE_STOCKS_RECENCY",
] as const;

class FakeWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readonly sent: unknown[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(JSON.parse(payload));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", 1000, Buffer.alloc(0));
  }

  terminate(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", 1006, Buffer.alloc(0));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  serverMessage(payload: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(payload)));
  }

  serverClose(code: number, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", code, Buffer.from(reason));
  }
}

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

test("Massive stock WebSocket shares one stocks connection across AM, Q, and T consumers", () => {
  withMassiveRealtimeEnv(() => {
    FakeWebSocket.instances = [];
    __massiveStockWebSocketInternalsForTests.reset();
    __massiveStockWebSocketInternalsForTests.setWebSocketFactory(
      (url) => new FakeWebSocket(url) as never,
    );
    const received: Array<{ lane: string; eventType: unknown }> = [];

    const unsubscribeAggregates = subscribeMassiveStockWebSocket({
      channels: ["AM"],
      symbols: ["SPY"],
      onMessage: (message) =>
        received.push({ lane: "aggregates", eventType: message["ev"] }),
    });
    const unsubscribeQuotes = subscribeMassiveStockWebSocket({
      channels: ["Q", "T"],
      symbols: ["SPY"],
      onMessage: (message) =>
        received.push({ lane: "quotes", eventType: message["ev"] }),
    });
    __massiveStockWebSocketInternalsForTests.refreshNow();

    try {
      assert.equal(FakeWebSocket.instances.length, 1);
      const socket = FakeWebSocket.instances[0]!;
      assert.equal(socket.url, "wss://socket.massive.com/stocks");

      socket.open();
      socket.serverMessage([{ ev: "status", status: "auth_success" }]);

      assert.deepEqual(socket.sent, [
        { action: "auth", params: "massive-test-key" },
        { action: "subscribe", params: "AM.SPY,Q.SPY,T.SPY" },
      ]);

      socket.serverMessage([
        { ev: "AM", sym: "SPY", c: 100 },
        { ev: "Q", sym: "SPY", bp: 99.9, ap: 100.1 },
        { ev: "T", sym: "SPY", p: 100 },
      ]);

      assert.deepEqual(received, [
        { lane: "aggregates", eventType: "AM" },
        { lane: "quotes", eventType: "Q" },
        { lane: "quotes", eventType: "T" },
      ]);

      unsubscribeQuotes();
      __massiveStockWebSocketInternalsForTests.refreshNow();
      assert.deepEqual(socket.sent.at(-1), {
        action: "unsubscribe",
        params: "Q.SPY,T.SPY",
      });
      assert.equal(FakeWebSocket.instances.length, 1);

      unsubscribeAggregates();
      __massiveStockWebSocketInternalsForTests.refreshNow();
      assert.equal(socket.readyState, FakeWebSocket.CLOSED);
    } finally {
      unsubscribeQuotes();
      unsubscribeAggregates();
      __massiveStockWebSocketInternalsForTests.reset();
    }
  });
});

test("Massive stock WebSocket diagnostics capture provider status and close code", () => {
  withMassiveRealtimeEnv(() => {
    FakeWebSocket.instances = [];
    __massiveStockWebSocketInternalsForTests.reset();
    __massiveStockWebSocketInternalsForTests.setWebSocketFactory(
      (url) => new FakeWebSocket(url) as never,
    );
    const unsubscribe = subscribeMassiveStockWebSocket({
      channels: ["AM"],
      symbols: ["SPY"],
      onMessage: () => {},
    });
    __massiveStockWebSocketInternalsForTests.refreshNow();

    try {
      const socket = FakeWebSocket.instances[0]!;
      socket.open();
      socket.serverMessage([{ ev: "status", status: "auth_success" }]);
      socket.serverMessage([
        {
          ev: "status",
          status: "max_connections",
          message: "Maximum number of websocket connections exceeded.",
        },
      ]);
      socket.serverClose(1008, "policy violation");

      const diagnostics = getMassiveStockWebSocketDiagnostics();
      assert.equal(diagnostics.lastProviderStatus, "max_connections");
      assert.equal(
        diagnostics.lastProviderMessage,
        "Maximum number of websocket connections exceeded.",
      );
      assert.equal(diagnostics.lastCloseCode, 1008);
      assert.equal(diagnostics.lastCloseReason, "policy violation");
      assert.equal(
        diagnostics.lastError,
        "Maximum number of websocket connections exceeded.",
      );
    } finally {
      unsubscribe();
      __massiveStockWebSocketInternalsForTests.reset();
    }
  });
});
