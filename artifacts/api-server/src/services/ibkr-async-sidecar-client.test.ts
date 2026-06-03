import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import type {
  IbkrMarketDataDesiredGeneration,
  IbkrMarketDataGenerationStatus,
} from "@workspace/ibkr-contracts";
import { IbkrAsyncSidecarClient } from "./ibkr-async-sidecar-client";

function buildDesiredGeneration(): IbkrMarketDataDesiredGeneration {
  return {
    schemaVersion: 1,
    generationId: "generation-test",
    source: "api-market-data-work-planner",
    generatedAt: "2026-06-02T03:00:00.000Z",
    desiredLines: [
      {
        lineKey: "equity:AAPL",
        assetClass: "equity",
        contract: { symbol: "AAPL", providerContractId: null },
        intent: "visible-live",
        owners: [
          {
            owner: "watchlist",
            ownerClass: "watchlist",
            intent: "visible-live",
            pool: "visible",
            priority: 10,
          },
        ],
        priority: 10,
        reason: "test",
      },
    ],
    summary: {
      desiredLineCount: 1,
      desiredEquityLineCount: 1,
      desiredOptionLineCount: 0,
      ownerCount: 1,
    },
  };
}

function buildSidecarStatus(
  generation: IbkrMarketDataDesiredGeneration,
): IbkrMarketDataGenerationStatus {
  return {
    schemaVersion: 1,
    mode: "executor",
    source: "ib-async-sidecar",
    generationId: generation.generationId,
    appliedGenerationId: generation.generationId,
    updatedAt: "2026-06-02T03:00:01.000Z",
    lines: generation.desiredLines.map((line) => ({
      lineKey: line.lineKey,
      assetClass: line.assetClass,
      state: "live",
      contract: line.contract,
      owners: line.owners,
      subscribedAt: null,
      lastTickAt: null,
      releaseRequestedAt: null,
      error: null,
    })),
    summary: {
      liveLineCount: 1,
      liveEquityLineCount: 1,
      liveOptionLineCount: 0,
      subscribingLineCount: 0,
      releasingLineCount: 0,
      failedLineCount: 0,
      unexpectedLineCount: 0,
    },
    throttle: {
      throttled: false,
      queueDepth: null,
      maxRequests: null,
      requestsIntervalSec: null,
      lastThrottleStartAt: null,
      lastThrottleEndAt: null,
    },
  };
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function withServer<T>(
  handler: http.RequestListener,
  run: (baseUrl: URL) => Promise<T>,
): Promise<T> {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    return await run(new URL(`http://127.0.0.1:${address.port}`));
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("IbkrAsyncSidecarClient posts desired generation and parses sidecar status", async () => {
  const desiredGeneration = buildDesiredGeneration();
  let receivedPath: string | null = null;
  let receivedMethod: string | null = null;
  let receivedPayload: unknown = null;

  await withServer(
    async (request, response) => {
      receivedPath = request.url ?? null;
      receivedMethod = request.method ?? null;
      receivedPayload = JSON.parse(await readRequestBody(request)) as unknown;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(buildSidecarStatus(desiredGeneration)));
    },
    async (baseUrl) => {
      const client = new IbkrAsyncSidecarClient({
        baseUrl,
        requestTimeoutMs: 1_000,
      });

      const status = await client.applyMarketDataGeneration(desiredGeneration);

      assert.equal(receivedPath, "/market-data/generation");
      assert.equal(receivedMethod, "POST");
      assert.deepEqual(receivedPayload, desiredGeneration);
      assert.equal(status.source, "ib-async-sidecar");
      assert.equal(status.summary.liveLineCount, 1);
    },
  );
});

test("IbkrAsyncSidecarClient supports authenticated bridge proxy base URLs", async () => {
  const desiredGeneration = buildDesiredGeneration();
  let receivedPath: string | null = null;
  let receivedAuthorization: string | null = null;

  await withServer(
    async (request, response) => {
      receivedPath = request.url ?? null;
      receivedAuthorization = request.headers.authorization ?? null;
      void JSON.parse(await readRequestBody(request));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(buildSidecarStatus(desiredGeneration)));
    },
    async (baseUrl) => {
      const client = new IbkrAsyncSidecarClient({
        baseUrl: new URL("/async-sidecar/", baseUrl),
        headers: { Authorization: "Bearer bridge-token" },
        requestTimeoutMs: 1_000,
      });

      const status = await client.applyMarketDataGeneration(desiredGeneration);

      assert.equal(receivedPath, "/async-sidecar/market-data/generation");
      assert.equal(receivedAuthorization, "Bearer bridge-token");
      assert.equal(status.source, "ib-async-sidecar");
    },
  );
});

test("IbkrAsyncSidecarClient rejects invalid generation status responses", async () => {
  await withServer(
    (_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    },
    async (baseUrl) => {
      const client = new IbkrAsyncSidecarClient({
        baseUrl,
        requestTimeoutMs: 1_000,
      });

      await assert.rejects(
        () => client.getMarketDataGeneration(),
        /generation status was invalid/i,
      );
    },
  );
});
