import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../lib/errors";
import {
  listSnapTradeBrokerages,
  resetSnapTradeBrokeragesCacheForTests,
} from "./snaptrade-brokerages";

const TEST_ENV = {
  SNAPTRADE_CLIENTID: "client-123",
  SNAPTRADE_API_KEY: "consumer-secret",
};

const PARTNER_PAYLOAD = {
  redirect_uri: "https://example.test/callback",
  allowed_brokerages: [
    {
      slug: "INTERACTIVE-BROKERS-FLEX",
      name: "Interactive Brokers",
      display_name: "Interactive Brokers",
      description: "Flex reporting connector.",
      url: "https://www.interactivebrokers.com/",
      allows_trading: false,
      enabled: true,
      maintenance_mode: false,
      is_degraded: false,
      allows_fractional_units: false,
      aws_s3_logo_url: "https://logos.test/ibkr.png",
      aws_s3_square_logo_url: "https://logos.test/ibkr-square.png",
      authorization_types: [{ type: "read", auth_type: "TOKEN" }],
    },
    {
      slug: "ETRADE",
      name: "E-Trade",
      display_name: "E*Trade",
      description: "Electronic trading platform.",
      url: "http://insecure.example.test/",
      allows_trading: true,
      enabled: true,
      maintenance_mode: false,
      is_degraded: false,
      allows_fractional_units: false,
      aws_s3_logo_url: "https://logos.test/etrade.png",
      aws_s3_square_logo_url: "https://logos.test/etrade-square.jpg",
      authorization_types: [
        { type: "trade", auth_type: "OAUTH" },
        { type: "read", auth_type: "OAUTH" },
      ],
    },
    {
      slug: "ALPACA-PAPER",
      display_name: "Alpaca Paper",
      allows_trading: true,
      enabled: true,
      maintenance_mode: false,
      is_degraded: false,
      aws_s3_square_logo_url: "https://logos.test/alpaca-square.png",
      authorization_types: "not-an-array",
    },
    { name: "missing slug entry", allows_trading: true, enabled: true },
  ],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("SnapTrade brokerage listing requires credentials and does not call fetch", async () => {
  resetSnapTradeBrokeragesCacheForTests();
  let called = false;
  await assert.rejects(
    listSnapTradeBrokerages({
      env: { SNAPTRADE_CLIENTID: "", SNAPTRADE_API_KEY: "" },
      fetchImpl: async () => {
        called = true;
        return jsonResponse(PARTNER_PAYLOAD);
      },
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      error.code === "snaptrade_credentials_not_configured",
  );
  assert.equal(called, false);
});

test("SnapTrade brokerage listing sanitizes, sorts trade-capable first, and drops malformed entries", async () => {
  resetSnapTradeBrokeragesCacheForTests();
  const now = new Date("2026-07-02T18:00:00.000Z");
  const result = await listSnapTradeBrokerages({
    env: TEST_ENV,
    now,
    fetchImpl: async (url) => {
      const target = String(url);
      assert.ok(target.startsWith("https://api.snaptrade.com/api/v1/snapTrade/partners?"));
      assert.ok(!target.includes("consumer-secret"));
      return jsonResponse(PARTNER_PAYLOAD);
    },
  });

  assert.equal(result.provider, "snaptrade");
  assert.equal(result.checkedAt, now.toISOString());
  assert.deepEqual(
    result.brokerages.map((brokerage) => brokerage.slug),
    ["ALPACA-PAPER", "ETRADE", "INTERACTIVE-BROKERS-FLEX"],
  );

  const etrade = result.brokerages.find((entry) => entry.slug === "ETRADE");
  assert.ok(etrade);
  assert.equal(etrade.displayName, "E*Trade");
  assert.equal(etrade.allowsTrading, true);
  assert.equal(etrade.url, null, "non-https homepage URL is dropped");
  assert.equal(etrade.squareLogoUrl, "https://logos.test/etrade-square.jpg");
  assert.deepEqual(etrade.authorizationTypes, [
    { type: "trade", authType: "OAUTH" },
    { type: "read", authType: "OAUTH" },
  ]);

  const alpaca = result.brokerages.find((entry) => entry.slug === "ALPACA-PAPER");
  assert.ok(alpaca);
  assert.equal(alpaca.logoUrl, null);
  assert.equal(alpaca.allowsFractionalUnits, null);
  assert.deepEqual(alpaca.authorizationTypes, []);

  const ibkr = result.brokerages.find(
    (entry) => entry.slug === "INTERACTIVE-BROKERS-FLEX",
  );
  assert.ok(ibkr);
  assert.equal(ibkr.allowsTrading, false);
});

test("SnapTrade brokerage listing caches within the TTL and refetches after it", async () => {
  resetSnapTradeBrokeragesCacheForTests();
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return jsonResponse(PARTNER_PAYLOAD);
  };

  const first = new Date("2026-07-02T18:00:00.000Z");
  await listSnapTradeBrokerages({ env: TEST_ENV, now: first, fetchImpl });
  await listSnapTradeBrokerages({
    env: TEST_ENV,
    now: new Date(first.getTime() + 60_000),
    fetchImpl,
  });
  assert.equal(fetchCount, 1);

  await listSnapTradeBrokerages({
    env: TEST_ENV,
    now: new Date(first.getTime() + 6 * 60_000),
    fetchImpl,
  });
  assert.equal(fetchCount, 2);
});

test("SnapTrade brokerage listing reports sanitized upstream failures", async () => {
  resetSnapTradeBrokeragesCacheForTests();
  await assert.rejects(
    listSnapTradeBrokerages({
      env: TEST_ENV,
      fetchImpl: async () => jsonResponse({ detail: "boom" }, 500),
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 502 &&
      error.code === "snaptrade_brokerages_unavailable",
  );
});
