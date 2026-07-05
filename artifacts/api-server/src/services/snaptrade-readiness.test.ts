import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSnapTradeSignature,
  readSnapTradeReadiness,
} from "./snaptrade-readiness";

type FetchHeaders = NonNullable<Parameters<typeof fetch>[1]>["headers"];

function readHeader(headers: FetchHeaders | undefined, name: string): string {
  if (!headers) {
    return "";
  }
  return new Headers(headers).get(name) ?? "";
}

test("SnapTrade readiness stays unconfigured without secrets and does not call fetch", async () => {
  let called = false;
  const readiness = await readSnapTradeReadiness({
    env: {},
    fetchImpl: async () => {
      called = true;
      throw new Error("fetch should not run");
    },
    now: new Date("2026-06-26T23:00:00.000Z"),
  });

  assert.equal(called, false);
  assert.equal(readiness.provider, "snaptrade");
  assert.equal(readiness.configured, false);
  assert.equal(readiness.status, "unconfigured");
  assert.equal(readiness.executionDecision.decisionCode, "PROVIDER_RESEARCH_REQUIRED");
  assert.deepEqual(readiness.credentials, {
    clientIdPresent: false,
    apiKeyPresent: false,
  });
  assert.equal(readiness.clientInfo, null);
  assert.equal(readiness.brokerages, null);
});

test("SnapTrade signature is deterministic and does not include the consumer key", () => {
  const signed = buildSnapTradeSignature({
    path: "/snapTrade/partners",
    query: "clientId=client-123&timestamp=1782514800",
    content: null,
    consumerKey: "consumer-secret",
  });

  assert.equal(typeof signed.signature, "string");
  assert.notEqual(signed.signature, "consumer-secret");
  assert.doesNotMatch(signed.canonicalPayload, /consumer-secret/);
  assert.equal(
    signed.canonicalPayload.includes('"path":"/api/v1/snapTrade/partners"'),
    true,
  );
});

test("SnapTrade signature canonical payload includes the API version prefix", () => {
  const signed = buildSnapTradeSignature({
    path: "/snapTrade/registerUser",
    query: "clientId=PASSIVTEST&timestamp=1635790389",
    content: { userId: "new_user_123" },
    consumerKey: "consumer-secret",
  });

  assert.equal(
    signed.canonicalPayload,
    '{"content":{"userId":"new_user_123"},"path":"/api/v1/snapTrade/registerUser","query":"clientId=PASSIVTEST&timestamp=1635790389"}',
  );
  assert.doesNotMatch(signed.canonicalPayload, /consumer-secret/);
});

test("SnapTrade readiness normalizes partner info without leaking raw provider payloads", async () => {
  const requestedUrls: string[] = [];
  const requestedSignatures: string[] = [];
  const readiness = await readSnapTradeReadiness({
    env: {
      SNAPTRADE_CLIENTID: "client-123",
      SNAPTRADE_API_KEY: "consumer-secret",
    },
    now: new Date("2026-06-26T23:00:00.000Z"),
    fetchImpl: async (url, init) => {
      requestedUrls.push(String(url));
      requestedSignatures.push(readHeader(init?.headers, "Signature"));
      return new Response(
        JSON.stringify({
          slug: "internal-client-slug",
          name: "Internal Client Name",
          redirect_uri: "",
          can_access_trades: true,
          can_access_holdings: true,
          can_access_account_history: true,
          can_access_reference_data: true,
          can_access_portfolio_management: false,
          can_access_orders: true,
          allowed_brokerages: [
            {
              slug: "PUBLIC",
              display_name: "Public",
              enabled: true,
              allows_trading: true,
              maintenance_mode: false,
              is_degraded: false,
            },
            {
              slug: "CHASE",
              display_name: "Chase",
              enabled: true,
              allows_trading: false,
              maintenance_mode: true,
              is_degraded: false,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(requestedUrls.length, 1);
  assert.match(
    requestedUrls[0] ?? "",
    /^https:\/\/api\.snaptrade\.com\/api\/v1\/snapTrade\/partners\?/,
  );
  assert.doesNotMatch(requestedUrls[0] ?? "", /consumer-secret/);
  assert.equal(requestedSignatures.length, 1);
  assert.ok((requestedSignatures[0] ?? "").length > 20);

  assert.equal(readiness.configured, true);
  assert.equal(readiness.status, "research_required");
  assert.equal(readiness.executionDecision.decisionCode, "PROVIDER_RESEARCH_REQUIRED");
  assert.deepEqual(readiness.clientInfo, {
    reachable: true,
    redirectUriConfigured: false,
    canAccessTrades: true,
    canAccessHoldings: true,
    canAccessAccountHistory: true,
    canAccessReferenceData: true,
    canAccessPortfolioManagement: false,
    canAccessOrders: true,
  });
  assert.deepEqual(readiness.brokerages, {
    total: 2,
    enabled: 2,
    allowsTrading: 1,
    degradedOrMaintenance: 1,
  });
  assert.deepEqual(readiness.limitations, [
    "snaptrade.redirect_uri_not_configured",
    "snaptrade.provider_research_required",
  ]);

  const serialized = JSON.stringify(readiness);
  assert.doesNotMatch(serialized, /consumer-secret/);
  assert.doesNotMatch(serialized, /client-123/);
  assert.doesNotMatch(serialized, /Internal Client Name/);
  assert.doesNotMatch(serialized, /PUBLIC|CHASE/);
});

test("SnapTrade readiness reports sanitized upstream failures", async () => {
  const readiness = await readSnapTradeReadiness({
    env: {
      SNAPTRADE_CLIENTID: "client-123",
      SNAPTRADE_API_KEY: "consumer-secret",
    },
    now: new Date("2026-06-26T23:00:00.000Z"),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          message: "bad consumer-secret for client-123",
          stack: "provider stack trace",
        }),
        { status: 401, statusText: "Unauthorized" },
      ),
  });

  assert.equal(readiness.status, "upstream_error");
  assert.equal(readiness.clientInfo?.reachable, false);
  assert.equal(readiness.upstream?.status, 401);
  assert.equal(readiness.upstream?.code, "snaptrade_http_401");
  assert.equal(readiness.upstream?.message, "SnapTrade client info probe failed.");
  assert.doesNotMatch(JSON.stringify(readiness), /consumer-secret|client-123|stack trace/);
});
