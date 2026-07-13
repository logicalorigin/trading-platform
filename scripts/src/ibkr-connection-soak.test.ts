import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { __ibkrConnectionSoakInternalsForTests as soak } from "./ibkr-connection-soak";

test("CLI accepts only explicit canonical monitoring scope", () => {
  assert.deepEqual(
    soak.parseArgs([
      "--api-base-url=https://example.test/api",
      "--symbols=spy,brk.b",
      "--duration-ms=1000",
      "--poll-interval-ms=200",
      "--gap-threshold-ms=50",
      "--stall-threshold-ms=100",
      "--request-timeout-ms=75",
    ]),
    {
      apiBaseUrl: "https://example.test/api",
      symbols: ["SPY", "BRK.B"],
      durationMs: 1_000,
      pollIntervalMs: 200,
      gapThresholdMs: 50,
      stallThresholdMs: 100,
      requestTimeoutMs: 75,
    },
  );

  for (const args of [
    ["--unknown=value"],
    ["--symbols=SPY", "--symbols=QQQ"],
    ["--symbols="],
    ["--symbols=SPY,$BAD"],
    ["--duration-ms=1e3"],
    ["--duration-ms=2.5"],
    ["--duration-ms=2147483648"],
    ["--poll-interval-ms=0"],
    ["--api-base-url=file:///tmp/api"],
    ["--api-base-url=https://user:secret@example.test/api"],
    ["--api-base-url=https://example.test/api?token=secret"],
    ["--api-base-url=https://example.test/api#fragment"],
    ["positional"],
  ]) {
    assert.throws(() => soak.parseArgs(args), /Usage:/);
  }
});

test("completed waits remove their abort listener", async () => {
  const controller = new AbortController();
  await soak.wait(1, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("diagnostics redact credentials and terminal controls", () => {
  const message = soak.errorMessage(
    new Error(
      `https://operator:super-secret@example.test/api \u001b[31mline\nnext\u202e${"x".repeat(2_000)}`,
    ),
  );
  assert.match(message, /https:\/\/\[redacted\]@example\.test\/api/);
  assert.doesNotMatch(message, /super-secret/);
  assert.doesNotMatch(
    message,
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.ok(message.length <= 1_000);
});

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      });
    },
  };
}

test("JSON polling rejects an oversized response body", async () => {
  const server = await listen((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ value: "x".repeat(1_100_000) }));
  });
  try {
    const result = await soak.requestJson(
      "oversized",
      new URL(`${server.origin}/oversized`),
      2_000,
    );
    assert.equal(result["ok"], false);
    assert.match(String(result["error"]), /response.*limit/i);
  } finally {
    await server.close();
  }
});

test("SSE monitoring rejects a delimiter-free oversized buffer", async () => {
  const server = await listen((_request, response) => {
    response.writeHead(200, {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    });
    response.write("x".repeat(1_100_000));
  });
  const controller = new AbortController();
  const stats = soak.createStreamStats("oversized", "quotes");
  const abortTimer = setTimeout(() => controller.abort(), 500);
  try {
    await soak.monitorSse({
      url: new URL(`${server.origin}/stream`),
      stats,
      signal: controller.signal,
      gapThresholdMs: 50,
      stallThresholdMs: 100,
      emit: () => {},
    });
    assert.ok(stats.errors >= 1);
    assert.match(String(stats.lastError), /SSE buffer.*limit/i);
  } finally {
    clearTimeout(abortTimer);
    controller.abort();
    await server.close();
  }
});

test("an open silent SSE stream reports stalls without counting its first connection as a reconnect", async () => {
  const server = await listen((_request, response) => {
    response.writeHead(200, {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    });
    response.flushHeaders();
  });
  const controller = new AbortController();
  const stats = soak.createStreamStats("silent", "quotes");
  const abortTimer = setTimeout(() => controller.abort(), 220);
  const events: string[] = [];
  try {
    await soak.monitorSse({
      url: new URL(`${server.origin}/silent`),
      stats,
      signal: controller.signal,
      gapThresholdMs: 25,
      stallThresholdMs: 50,
      emit: (type) => events.push(type),
    });
    assert.ok(events.includes("sse-stall"));
    assert.equal(stats.reconnects, 0);
  } finally {
    clearTimeout(abortTimer);
    controller.abort();
    await server.close();
  }
});

test("poll requests stop promptly when the parent soak is aborted", async () => {
  const server = await listen(() => {});
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 50);
  const startedAt = performance.now();
  try {
    const result = await soak.requestJson(
      "aborted",
      new URL(`${server.origin}/never`),
      2_000,
      controller.signal,
    );
    assert.equal(result["ok"], false);
    assert.ok(performance.now() - startedAt < 500);
  } finally {
    clearTimeout(abortTimer);
    controller.abort();
    await server.close();
  }
});

test("an SSE connection that never returns headers obeys the request timeout", async () => {
  const server = await listen(() => {});
  const controller = new AbortController();
  const stats = soak.createStreamStats("no-headers", "quotes");
  const abortTimer = setTimeout(() => controller.abort(), 250);
  try {
    await soak.monitorSse({
      url: new URL(`${server.origin}/never`),
      stats,
      signal: controller.signal,
      gapThresholdMs: 25,
      stallThresholdMs: 50,
      requestTimeoutMs: 50,
      emit: () => {},
    });
    assert.ok(stats.errors >= 1);
  } finally {
    clearTimeout(abortTimer);
    controller.abort();
    await server.close();
  }
});

test("SSE monitoring rejects a successful response with the wrong media type", async () => {
  const server = await listen((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const controller = new AbortController();
  const stats = soak.createStreamStats("wrong-media-type", "quotes");
  const abortTimer = setTimeout(() => controller.abort(), 250);
  try {
    await soak.monitorSse({
      url: new URL(`${server.origin}/not-sse`),
      stats,
      signal: controller.signal,
      gapThresholdMs: 25,
      stallThresholdMs: 50,
      emit: () => {},
    });
    assert.ok(stats.errors >= 1);
    assert.match(String(stats.lastError), /content type/i);
  } finally {
    clearTimeout(abortTimer);
    controller.abort();
    await server.close();
  }
});

test("IBKR soak excludes the authenticated Massive stream and polls full runtime counters", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "ibkr-connection-soak.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /["']streams\/stocks\/aggregates["']/);
  assert.doesNotMatch(
    source,
    /["']diagnostics\/runtime["'],\s*\{\s*detail:\s*["']compact["']/,
  );

  const summary = soak.summarizeRuntime({
    ibkr: {
      streams: {
        stockAggregates: { gapCount: 7, maxGapMs: 123, ignored: "value" },
      },
    },
  });
  assert.deepEqual(summary["stockAggregates"], {
    gapCount: 7,
    maxGapMs: 123,
  });
});

test("importing the connection soak does not start network monitoring", () => {
  const moduleUrl = pathToFileURL(
    resolve(import.meta.dirname, "ibkr-connection-soak.ts"),
  ).href;
  const imported = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(moduleUrl)})`,
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        API_BASE_URL: "http://127.0.0.1:1/api",
      },
      timeout: 4_000,
    },
  );

  assert.equal(
    imported.status,
    0,
    `import unexpectedly started the soak:\n${imported.stdout}${imported.stderr}`,
  );
});
