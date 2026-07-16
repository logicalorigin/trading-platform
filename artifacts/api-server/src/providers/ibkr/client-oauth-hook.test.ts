import assert from "node:assert/strict";
import test from "node:test";

import type { IbkrRuntimeConfig } from "@workspace/ibkr-contracts";

import { type QueryValue } from "../../lib/http";
import { IbkrClient } from "./client";
import { signHmacRequest } from "./oauth-signer";

type CapturedFetch = {
  input: string | URL | Request;
  init?: RequestInit;
};

type RequestInvoker = {
  request<T>(
    path: string,
    init?: RequestInit,
    params?: Record<string, QueryValue>,
  ): Promise<T>;
};

function baseConfig(overrides: Partial<IbkrRuntimeConfig> = {}): IbkrRuntimeConfig {
  return {
    baseUrl: "https://api.ibkr.com/v1/api",
    bearerToken: null,
    cookie: null,
    defaultAccountId: null,
    extOperator: null,
    extraHeaders: {},
    username: null,
    password: null,
    allowInsecureTls: false,
    ...overrides,
  };
}

async function withFakeFetch(
  run: (captures: CapturedFetch[]) => Promise<void>,
): Promise<void> {
  const previousFetch = globalThis.fetch;
  const captures: CapturedFetch[] = [];
  globalThis.fetch = (async (input, init) => {
    captures.push({ input, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await run(captures);
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("OAuth config signs IBKR requests with deterministic HMAC authorization", async () => {
  const liveSessionToken = Buffer.from("live-session-token-bytes").toString("base64");
  const client = new IbkrClient(baseConfig(), {
    oauth: {
      consumerKey: "PYRUSCON1",
      accessToken: "access-token-1",
      liveSessionToken,
      realm: "limited_poa",
      nonce: () => "fixednonce123456",
      timestamp: () => "1700000000",
    },
  }) as unknown as RequestInvoker;

  await withFakeFetch(async (captures) => {
    await client.request(
      "/iserver/marketdata/snapshot",
      { method: "GET" },
      { conids: "265598", fields: "31" },
    );

    assert.equal(captures.length, 1);
    const headers = new Headers(captures[0]!.init?.headers);
    const authorization = headers.get("authorization");
    const expected = signHmacRequest({
      method: "GET",
      url: "https://api.ibkr.com/v1/api/iserver/marketdata/snapshot",
      consumerKey: "PYRUSCON1",
      accessToken: "access-token-1",
      liveSessionToken,
      realm: "limited_poa",
      queryParams: { conids: "265598", fields: "31" },
      nonce: "fixednonce123456",
      timestamp: "1700000000",
    });

    assert.ok(authorization?.startsWith('OAuth realm="limited_poa"'));
    assert.ok(authorization?.includes('oauth_signature_method="HMAC-SHA256"'));
    assert.equal(authorization, expected.authorizationHeader);

    const fetchedUrl = new URL(String(captures[0]!.input));
    assert.equal(
      fetchedUrl.toString(),
      "https://api.ibkr.com/v1/api/iserver/marketdata/snapshot?conids=265598&fields=31",
    );
  });
});

test("request preparation reroutes HTTP and WebSocket operations at dispatch time", async () => {
  const prepared: Array<{
    body: string | Uint8Array | undefined;
    method: string;
    transport: "http" | "websocket";
    url: string;
  }> = [];
  const client = new IbkrClient(baseConfig(), {
    prepareRequest: async (request) => {
      prepared.push({
        body: request.body,
        method: request.method,
        transport: request.transport,
        url: request.url,
      });
      const logical = new URL(request.url);
      return {
        headers: { ...request.headers, "x-synthetic-fence": "current" },
        url:
          request.transport === "websocket"
            ? `wss://fleet.example.invalid/data${logical.pathname}`
            : `https://fleet.example.invalid/data${logical.pathname}`,
      };
    },
  });

  await withFakeFetch(async (captures) => {
    await client.tickleSession();
    const websocket = await client.getWebSocketConnectionConfig();

    assert.equal(captures.length, 2);
    assert.equal(
      String(captures[0]!.input),
      "https://fleet.example.invalid/data/v1/api/tickle",
    );
    assert.equal(
      new Headers(captures[0]!.init?.headers).get("x-synthetic-fence"),
      "current",
    );
    assert.equal(captures[0]!.init?.redirect, "manual");
    assert.equal(websocket.url, "wss://fleet.example.invalid/data/v1/api/ws");
    assert.equal(websocket.headers["x-synthetic-fence"], "current");
    assert.deepEqual(
      prepared.map(({ body, ...request }) => ({
        ...request,
        body: typeof body === "string" ? body : body?.byteLength,
      })),
      [
        {
          body: "{}",
          method: "POST",
          transport: "http",
          url: "https://api.ibkr.com/v1/api/tickle",
        },
        {
          body: "{}",
          method: "POST",
          transport: "http",
          url: "https://api.ibkr.com/v1/api/tickle",
        },
        {
          body: undefined,
          method: "GET",
          transport: "websocket",
          url: "wss://api.ibkr.com/v1/api/ws",
        },
      ],
    );
  });
});

test("unconfigured OAuth preserves bearer and cookie authorization behavior", async () => {
  const client = new IbkrClient(
    baseConfig({
      bearerToken: "bearer-token-1",
      cookie: "api=session-token-1",
      extraHeaders: { "X-Extra": "extra-value" },
    }),
  ) as unknown as RequestInvoker;

  await withFakeFetch(async (captures) => {
    await client.request("/tickle", { headers: { "X-Init": "init-value" } });

    assert.equal(captures.length, 1);
    const headerEntries = Object.fromEntries(
      new Headers(captures[0]!.init?.headers).entries(),
    );
    assert.deepEqual(headerEntries, {
      accept: "application/json",
      authorization: "Bearer bearer-token-1",
      cookie: "api=session-token-1",
      "user-agent": "pyrus-ibkr/1.0",
      "x-extra": "extra-value",
      "x-init": "init-value",
    });
    assert.ok(!headerEntries.authorization.startsWith("OAuth "));
  });
});
