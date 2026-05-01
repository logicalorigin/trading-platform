import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  clearIbkrBridgeRuntimeOverride,
  setIbkrBridgeRuntimeOverride,
} from "../../lib/runtime";
import { IbkrBridgeClient } from "./bridge-client";

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve(address.port);
    });
  });

const useTempBridgeRuntimeOverride = (t: TestContext): void => {
  const previous = process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
  const directory = mkdtempSync(join(tmpdir(), "rayalgo-bridge-client-test-"));
  process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = join(
    directory,
    "runtime.json",
  );

  t.after(() => {
    clearIbkrBridgeRuntimeOverride();
    rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) {
      delete process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
    } else {
      process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = previous;
    }
  });
};

test("streamHistoricalBars surfaces stream-error SSE messages", async (t) => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url?.startsWith("/streams/bars?"), true);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.write(
      "event: stream-error\n" +
        'data: {"title":"Historical bar stream interrupted","detail":"upstream broke"}\n\n',
    );
    res.end();
  });
  const port = await listen(server);
  useTempBridgeRuntimeOverride(t);
  setIbkrBridgeRuntimeOverride({
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken: null,
  });
  t.after(() => {
    server.close();
  });

  const client = new IbkrBridgeClient();
  let cleanup = () => {};
  const error = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("stream error timed out")),
      1_000,
    );
    cleanup = client.streamHistoricalBars(
      { symbol: "SPY", timeframe: "5s" },
      () => reject(new Error("unexpected bar payload")),
      (streamError) => {
        clearTimeout(timeout);
        cleanup();
        resolve(streamError);
      },
    );
  });

  assert.ok(error instanceof Error);
  assert.match(error.message, /upstream broke/);
});

test("streamHistoricalBars treats bridge heartbeats as stream activity", async (t) => {
  const previousStallMs = process.env["IBKR_BAR_STREAM_STALL_MS"];
  process.env["IBKR_BAR_STREAM_STALL_MS"] = "1000";
  t.after(() => {
    if (previousStallMs === undefined) {
      delete process.env["IBKR_BAR_STREAM_STALL_MS"];
    } else {
      process.env["IBKR_BAR_STREAM_STALL_MS"] = previousStallMs;
    }
  });

  const server = http.createServer((req, res) => {
    assert.equal(req.url?.startsWith("/streams/bars?"), true);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.write('event: ready\ndata: {"source":"test"}\n\n');
    const heartbeat = setInterval(() => {
      res.write(
        `event: heartbeat\ndata: {"at":"${new Date().toISOString()}"}\n\n`,
      );
      res.write('event: stream-status\ndata: {"state":"open"}\n\n');
    }, 100);
    res.on("close", () => clearInterval(heartbeat));
  });
  const port = await listen(server);
  useTempBridgeRuntimeOverride(t);
  setIbkrBridgeRuntimeOverride({
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken: null,
  });
  t.after(() => {
    server.close();
  });

  const client = new IbkrBridgeClient();
  let cleanup = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 5_600);
      cleanup = client.streamHistoricalBars(
        { symbol: "SPY", timeframe: "5m" },
        () => reject(new Error("unexpected bar payload")),
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  } finally {
    cleanup();
  }
});

test("getOptionChain forwards quoteHydration to the bridge", async (t) => {
  const server = http.createServer((req, res) => {
    assert.ok(req.url);
    const url = new URL(req.url, "http://127.0.0.1");
    assert.equal(url.pathname, "/options/chains");
    assert.equal(url.searchParams.get("underlying"), "SPY");
    assert.equal(url.searchParams.get("quoteHydration"), "metadata");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ contracts: [] }));
  });
  const port = await listen(server);
  useTempBridgeRuntimeOverride(t);
  setIbkrBridgeRuntimeOverride({
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken: null,
  });
  t.after(() => {
    server.close();
  });

  const client = new IbkrBridgeClient();
  const contracts = await client.getOptionChain({
    underlying: "SPY",
    quoteHydration: "metadata",
  });

  assert.deepEqual(contracts, []);
});

test("listOrdersWithMeta preserves bridge degradation metadata", async (t) => {
  const server = http.createServer((req, res) => {
    assert.ok(req.url);
    const url = new URL(req.url, "http://127.0.0.1");
    assert.equal(url.pathname, "/orders");
    assert.equal(url.searchParams.get("mode"), "live");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        orders: [],
        degraded: true,
        reason: "open_orders_timeout",
        stale: true,
        timeoutMs: 2500,
      }),
    );
  });
  const port = await listen(server);
  useTempBridgeRuntimeOverride(t);
  setIbkrBridgeRuntimeOverride({
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken: null,
  });
  t.after(() => {
    server.close();
  });

  const client = new IbkrBridgeClient();
  const result = await client.listOrdersWithMeta({ mode: "live" });

  assert.deepEqual(result.orders, []);
  assert.equal(result.degraded, true);
  assert.equal(result.reason, "open_orders_timeout");
  assert.equal(result.stale, true);
  assert.equal(result.timeoutMs, 2500);
});

test("quote snapshots translate dotted share classes for the bridge", async (t) => {
  const server = http.createServer((req, res) => {
    assert.ok(req.url);
    const url = new URL(req.url, "http://127.0.0.1");
    assert.equal(url.pathname, "/quotes/snapshot");
    assert.equal(url.searchParams.get("symbols"), "BRK B");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        quotes: [
          {
            symbol: "BRK B",
            price: 476.3,
            bid: 476.25,
            ask: 476.35,
            bidSize: 100,
            askSize: 100,
            change: 1,
            changePercent: 0.2,
            open: 475,
            high: 477,
            low: 474,
            prevClose: 475.3,
            volume: 1000,
            providerContractId: "72063691",
            source: "ibkr",
            transport: "tws",
            delayed: false,
            freshness: "live",
            dataUpdatedAt: null,
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
  });
  const port = await listen(server);
  useTempBridgeRuntimeOverride(t);
  setIbkrBridgeRuntimeOverride({
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken: null,
  });
  t.after(() => {
    server.close();
  });

  const client = new IbkrBridgeClient();
  const quotes = await client.getQuoteSnapshots(["BRK.B"]);

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0]?.symbol, "BRK.B");
  assert.equal(quotes[0]?.providerContractId, "72063691");
});

test("quote streams translate dotted share classes for the bridge", async (t) => {
  const server = http.createServer((req, res) => {
    assert.ok(req.url);
    const url = new URL(req.url, "http://127.0.0.1");
    assert.equal(url.pathname, "/streams/quotes");
    assert.equal(url.searchParams.get("symbols"), "BRK B,MSFT");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.write(
      "event: quotes\n" +
        `data: ${JSON.stringify({
          quotes: [
            {
              symbol: "BRK B",
              price: 476.3,
              bid: 476.25,
              ask: 476.35,
              bidSize: 100,
              askSize: 100,
              change: 1,
              changePercent: 0.2,
              open: 475,
              high: 477,
              low: 474,
              prevClose: 475.3,
              volume: 1000,
              providerContractId: "72063691",
              source: "ibkr",
              transport: "tws",
              delayed: false,
              freshness: "live",
              dataUpdatedAt: null,
              updatedAt: new Date().toISOString(),
            },
          ],
        })}\n\n`,
    );
  });
  const port = await listen(server);
  useTempBridgeRuntimeOverride(t);
  setIbkrBridgeRuntimeOverride({
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken: null,
  });
  t.after(() => {
    server.close();
  });

  const client = new IbkrBridgeClient();
  let cleanup = () => {};
  const quotes = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("quote stream timed out")),
      1_000,
    );
    cleanup = client.streamQuoteSnapshots(
      ["MSFT", "BRK.B"],
      (streamQuotes) => {
        clearTimeout(timeout);
        cleanup();
        resolve(streamQuotes);
      },
      reject,
    );
  });

  assert.equal((quotes as Array<{ symbol: string }>)[0]?.symbol, "BRK.B");
});

test("quote streams treat bridge heartbeats as stream activity", async (t) => {
  const previousStallMs = process.env["IBKR_QUOTE_STREAM_STALL_MS"];
  process.env["IBKR_QUOTE_STREAM_STALL_MS"] = "1000";
  t.after(() => {
    if (previousStallMs === undefined) {
      delete process.env["IBKR_QUOTE_STREAM_STALL_MS"];
    } else {
      process.env["IBKR_QUOTE_STREAM_STALL_MS"] = previousStallMs;
    }
  });

  const server = http.createServer((req, res) => {
    assert.ok(req.url);
    const url = new URL(req.url, "http://127.0.0.1");
    assert.equal(url.pathname, "/streams/quotes");
    assert.equal(url.searchParams.get("symbols"), "SMCI");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.write('event: ready\ndata: {"source":"test"}\n\n');
    const heartbeat = setInterval(() => {
      res.write(
        `event: heartbeat\ndata: {"at":"${new Date().toISOString()}"}\n\n`,
      );
    }, 100);
    res.on("close", () => clearInterval(heartbeat));
  });
  const port = await listen(server);
  useTempBridgeRuntimeOverride(t);
  setIbkrBridgeRuntimeOverride({
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken: null,
  });
  t.after(() => {
    server.close();
  });

  const client = new IbkrBridgeClient();
  let cleanup = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 2_400);
      cleanup = client.streamQuoteSnapshots(
        ["SMCI"],
        () => reject(new Error("unexpected quote payload")),
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  } finally {
    cleanup();
  }
});

test("option quote streams treat bridge heartbeats as stream activity", async (t) => {
  const previousStallMs = process.env["IBKR_OPTION_QUOTE_STREAM_STALL_MS"];
  process.env["IBKR_OPTION_QUOTE_STREAM_STALL_MS"] = "1000";
  t.after(() => {
    if (previousStallMs === undefined) {
      delete process.env["IBKR_OPTION_QUOTE_STREAM_STALL_MS"];
    } else {
      process.env["IBKR_OPTION_QUOTE_STREAM_STALL_MS"] = previousStallMs;
    }
  });

  const server = http.createServer((req, res) => {
    assert.ok(req.url);
    const url = new URL(req.url, "http://127.0.0.1");
    assert.equal(url.pathname, "/streams/options/quotes");
    assert.equal(url.searchParams.get("contracts"), "123,456");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.write('event: ready\ndata: {"source":"test"}\n\n');
    const heartbeat = setInterval(() => {
      res.write(
        `event: heartbeat\ndata: {"at":"${new Date().toISOString()}"}\n\n`,
      );
      res.write('event: stream-status\ndata: {"state":"open"}\n\n');
    }, 100);
    res.on("close", () => clearInterval(heartbeat));
  });
  const port = await listen(server);
  useTempBridgeRuntimeOverride(t);
  setIbkrBridgeRuntimeOverride({
    baseUrl: `http://127.0.0.1:${port}`,
    apiToken: null,
  });
  t.after(() => {
    server.close();
  });

  const client = new IbkrBridgeClient();
  let cleanup = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 2_400);
      cleanup = client.streamOptionQuoteSnapshots(
        { providerContractIds: ["123", "456"] },
        () => reject(new Error("unexpected quote payload")),
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  } finally {
    cleanup();
  }
});
