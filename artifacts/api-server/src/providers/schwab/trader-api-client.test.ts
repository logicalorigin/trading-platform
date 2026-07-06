import assert from "node:assert/strict";
import test from "node:test";

import {
  extractOrderIdFromLocation,
  SchwabTraderApiClient,
  type SchwabOrderRequest,
} from "./trader-api-client";

const BASE = "https://api.schwabapi.com/trader/v1";
const TOKEN = "test-access-token";

type Call = { url: string; init: RequestInit };

// A recording fetch stub: captures each call and returns the queued Response.
function recordingFetch(responder: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const impl = (async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return responder(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

function client(responder: (url: string, init: RequestInit) => Response) {
  const rec = recordingFetch(responder);
  return {
    client: new SchwabTraderApiClient({ accessToken: TOKEN, fetchImpl: rec.impl }),
    calls: rec.calls,
  };
}

const MARKET_BUY: SchwabOrderRequest = {
  orderType: "MARKET",
  session: "NORMAL",
  duration: "DAY",
  orderStrategyType: "SINGLE",
  orderLegCollection: [
    { instruction: "BUY", quantity: 15, instrument: { symbol: "XYZ", assetType: "EQUITY" } },
  ],
};

test("extractOrderIdFromLocation pulls the trailing id, ignoring query/trailing slash", () => {
  assert.equal(
    extractOrderIdFromLocation(`${BASE}/accounts/HASH/orders/1002233`),
    "1002233",
  );
  assert.equal(
    extractOrderIdFromLocation(`${BASE}/accounts/HASH/orders/1002233/`),
    "1002233",
  );
  assert.equal(
    extractOrderIdFromLocation(`${BASE}/accounts/HASH/orders/1002233?x=1`),
    "1002233",
  );
  assert.equal(extractOrderIdFromLocation(null), null);
  assert.equal(extractOrderIdFromLocation(""), null);
});

test("GET reads send the bearer token and no body", async () => {
  const { client: c, calls } = client(() =>
    new Response(JSON.stringify([{ accountNumber: "123", hashValue: "H" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const mappings = await c.getAccountNumbers();
  assert.deepEqual(mappings, [{ accountNumber: "123", hashValue: "H" }]);
  assert.equal(calls[0]!.url, `${BASE}/accounts/accountNumbers`);
  assert.equal(calls[0]!.init.method, "GET");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["Authorization"], `Bearer ${TOKEN}`);
  assert.equal(calls[0]!.init.body, undefined);
});

test("placeOrder POSTs the JSON order and returns the id from the Location header", async () => {
  const { client: c, calls } = client(
    () =>
      new Response("", {
        status: 201,
        headers: { Location: `${BASE}/accounts/HASH/orders/1002233` },
      }),
  );
  const result = await c.placeOrder("HASH", MARKET_BUY);
  assert.deepEqual(result, { orderId: "1002233" });
  assert.equal(calls[0]!.url, `${BASE}/accounts/HASH/orders`);
  assert.equal(calls[0]!.init.method, "POST");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["Authorization"], `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), MARKET_BUY);
});

test("placeOrder returns orderId null when no Location header is present", async () => {
  const { client: c } = client(() => new Response("", { status: 201 }));
  const result = await c.placeOrder("HASH", MARKET_BUY);
  assert.equal(result.orderId, null);
});

test("replaceOrder PUTs to the order id and prefers the new Location id", async () => {
  const { client: c, calls } = client(
    () =>
      new Response("", {
        status: 201,
        headers: { Location: `${BASE}/accounts/HASH/orders/999` },
      }),
  );
  const result = await c.replaceOrder("HASH", "111", MARKET_BUY);
  assert.equal(result.orderId, "999");
  assert.equal(calls[0]!.url, `${BASE}/accounts/HASH/orders/111`);
  assert.equal(calls[0]!.init.method, "PUT");
});

test("replaceOrder falls back to the original id when no Location returned", async () => {
  const { client: c } = client(() => new Response("", { status: 200 }));
  const result = await c.replaceOrder("HASH", "111", MARKET_BUY);
  assert.equal(result.orderId, "111");
});

test("cancelOrder DELETEs the order path", async () => {
  const { client: c, calls } = client(() => new Response("", { status: 200 }));
  await c.cancelOrder("HASH", "111");
  assert.equal(calls[0]!.url, `${BASE}/accounts/HASH/orders/111`);
  assert.equal(calls[0]!.init.method, "DELETE");
  assert.equal(calls[0]!.init.body, undefined);
});

test("previewOrder POSTs to /previewOrder and returns the parsed body", async () => {
  const impact = { orderStrategy: {}, orderValidationResult: {} };
  const { client: c, calls } = client(
    () =>
      new Response(JSON.stringify(impact), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const result = await c.previewOrder("HASH", MARKET_BUY);
  assert.deepEqual(result, impact);
  assert.equal(calls[0]!.url, `${BASE}/accounts/HASH/previewOrder`);
  assert.equal(calls[0]!.init.method, "POST");
});

test("getOrders serializes query params and requires an array", async () => {
  const { client: c, calls } = client(
    () => new Response(JSON.stringify([{ orderId: 1 }]), { status: 200 }),
  );
  const orders = await c.getOrders("HASH", { maxResults: 10, status: "FILLED" });
  assert.equal(orders.length, 1);
  assert.match(calls[0]!.url, /\/accounts\/HASH\/orders\?/);
  assert.match(calls[0]!.url, /maxResults=10/);
  assert.match(calls[0]!.url, /status=FILLED/);
});

test("getAccountWithPositions requests fields=positions", async () => {
  const { client: c, calls } = client(
    () => new Response(JSON.stringify({ securitiesAccount: {} }), { status: 200 }),
  );
  await c.getAccountWithPositions("HASH");
  assert.equal(calls[0]!.url, `${BASE}/accounts/HASH?fields=positions`);
  assert.equal(calls[0]!.init.method, "GET");
});

test("getTransactions serializes date/type query params", async () => {
  const { client: c, calls } = client(() => new Response(JSON.stringify([]), { status: 200 }));
  await c.getTransactions("HASH", {
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-06T00:00:00.000Z",
    types: "TRADE",
  });
  assert.match(calls[0]!.url, /\/accounts\/HASH\/transactions\?/);
  assert.match(calls[0]!.url, /startDate=2026-07-01/);
  assert.match(calls[0]!.url, /types=TRADE/);
});

test("account hash and order id are URL-encoded in paths", async () => {
  const { client: c, calls } = client(() => new Response("", { status: 200 }));
  await c.cancelOrder("HA/SH", "1 1");
  assert.equal(calls[0]!.url, `${BASE}/accounts/HA%2FSH/orders/1%201`);
});

test("non-2xx responses throw an HttpError with the status", async () => {
  const { client: c } = client(() => new Response("bad", { status: 400 }));
  await assert.rejects(
    () => c.placeOrder("HASH", MARKET_BUY),
    (err: unknown) => {
      const e = err as { statusCode?: number; code?: string; data?: { status?: number } };
      assert.equal(e.statusCode, 502);
      assert.equal(e.code, "schwab_trader_api_error");
      assert.equal(e.data?.status, 400);
      return true;
    },
  );
});
