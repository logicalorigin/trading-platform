import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { attachOptionQuoteWebSocket } from "./options-quotes";
import {
  __resetBridgeOptionQuoteStreamForTests,
  __setBridgeOptionQuoteClientForTests,
} from "../services/bridge-option-quote-stream";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function withOptionQuoteServer<T>(
  callback: (url: string) => Promise<T>,
): Promise<T> {
  const server = createServer();
  attachOptionQuoteWebSocket(server);
  const port = await listen(server);

  try {
    return await callback(`ws://127.0.0.1:${port}/api/ws/options/quotes`);
  } finally {
    await close(server);
  }
}

function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextJsonMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => {
      try {
        resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

test.afterEach(() => {
  __resetBridgeOptionQuoteStreamForTests();
  __setBridgeOptionQuoteClientForTests(null);
});

function useFakeOptionQuoteBridge(): void {
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      return [];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });
}

test("option quote websocket rejects empty contract subscriptions", async () => {
  useFakeOptionQuoteBridge();
  await withOptionQuoteServer(async (url) => {
    const socket = await openSocket(url);
    try {
      socket.send(
        JSON.stringify({
          type: "subscribe",
          underlying: "SPY",
          providerContractIds: [],
        }),
      );

      const message = await nextJsonMessage(socket);
      assert.equal(message["type"], "error");
      assert.match(String(message["error"]), /At least one providerContractId/);
    } finally {
      socket.close();
    }
  });
});

test("option quote websocket accepts large contract subscriptions for chunked streaming", async () => {
  useFakeOptionQuoteBridge();
  await withOptionQuoteServer(async (url) => {
    const socket = await openSocket(url);
    try {
      const providerContractIds = Array.from({ length: 101 }, (_, index) =>
        String(index + 1),
      );
      socket.send(
        JSON.stringify({
          type: "subscribe",
          underlying: "SPY",
          providerContractIds,
        }),
      );

      const message = await nextJsonMessage(socket);
      assert.equal(message["type"], "ready");
      assert.deepEqual(message["providerContractIds"], providerContractIds);
    } finally {
      socket.close();
    }
  });
});
