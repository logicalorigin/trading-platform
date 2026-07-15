import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, mock, test } from "node:test";

import { db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import express from "express";
import { HttpError, isHttpError } from "../lib/errors";
import { createAuthSession } from "../services/auth";
import { AUTH_CSRF_HEADER } from "./auth";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
const nativeFetch = globalThis.fetch;
const accountServiceSource = readFileSync(
  new URL("../services/account.ts", import.meta.url),
  "utf8",
);
const serviceCalls = new Map<string, number>();

function countedService(name: string) {
  return async () => {
    serviceCalls.set(name, (serviceCalls.get(name) ?? 0) + 1);
    throw new Error(`${name} should not run when account admission is denied`);
  };
}

function countedInertService(name: string, value: unknown = {}) {
  return async () => {
    serviceCalls.set(name, (serviceCalls.get(name) ?? 0) + 1);
    return value;
  };
}

function inertService(value: unknown = {}) {
  return async () => value;
}

function inertSubscription() {
  return async () => () => undefined;
}

let getAccountSummaryImpl: (...args: unknown[]) => Promise<unknown> =
  countedService("getAccountSummary");
let getAccountPositionsImpl: (...args: unknown[]) => Promise<unknown> =
  countedService("getAccountPositions");
let getAccountRiskImpl: (...args: unknown[]) => Promise<unknown> =
  countedService("getAccountRisk");
let resolveOptionContractWithDebugImpl: (...args: unknown[]) => Promise<unknown> =
  inertService({});
let snapTradeBackedAccountsPresent = false;
let robinhoodBackedAccountsPresent = false;

mock.module(new URL("../lib/runtime.ts", import.meta.url).href, {
  namedExports: {
    getProviderConfiguration: () => ({
      massive: false,
      research: false,
      ibkr: false,
    }),
  },
});

mock.module(new URL("../services/account.ts", import.meta.url).href, {
  namedExports: {
    cancelAccountOrder: countedInertService("cancelAccountOrder"),
    getAccountAllocation: countedService("getAccountAllocation"),
    getAccountCashActivity: countedService("getAccountCashActivity"),
    getAccountClosedTrades: countedService("getAccountClosedTrades"),
    getAccountEquityHistory: countedService("getAccountEquityHistory"),
    getAccountOrders: countedService("getAccountOrders"),
    getAccountPositions: (...args: unknown[]) => getAccountPositionsImpl(...args),
    getAccountPositionsAtDate: countedService("getAccountPositionsAtDate"),
    getAccountRisk: (...args: unknown[]) => getAccountRiskImpl(...args),
    getAccountSummary: (...args: unknown[]) => getAccountSummaryImpl(...args),
    getFlexHealth: inertService({ ok: true }),
    hasRobinhoodBackedAccounts: async () => robinhoodBackedAccountsPresent,
    hasSnapTradeBackedAccounts: async () => snapTradeBackedAccountsPresent,
    listAccounts: countedService("listAccounts"),
    testFlexToken: countedInertService("testFlexToken", { ok: true }),
  },
});

mock.module(new URL("../services/account-page-streams.ts", import.meta.url).href, {
  namedExports: {
    ACCOUNT_PAGE_DERIVED_BOOT_DELAY_MS: 0,
    ACCOUNT_PAGE_LIVE_BOOT_DELAY_MS: 0,
    fetchAccountPagePrimaryPayload: countedService("fetchAccountPagePrimaryPayload"),
    recordAccountPageStreamWrite: () => undefined,
    subscribeAccountPageSnapshots: countedService("subscribeAccountPageSnapshots"),
  },
});

mock.module(new URL("../services/bridge-streams.ts", import.meta.url).href, {
  namedExports: {
    fetchAccountSnapshotPayload: countedService("fetchAccountSnapshotPayload"),
    fetchExecutionSnapshotPayload: countedInertService("fetchExecutionSnapshotPayload"),
    fetchOptionQuoteSnapshotPayload: inertService({}),
    fetchOrderSnapshotPayload: countedInertService("fetchOrderSnapshotPayload"),
    fetchQuoteSnapshotPayload: inertService({}),
    readOptionQuoteDemandSnapshotPayload: inertService({}),
    resolveQuoteStreamSource: () => "ibkr-bridge",
    subscribeAccountSnapshots: countedService("subscribeAccountSnapshots"),
    subscribeExecutionSnapshots: inertSubscription(),
    subscribeOptionChains: inertSubscription(),
    subscribeOptionQuoteSnapshots: inertSubscription(),
    subscribeOrderSnapshots: inertSubscription(),
    subscribeQuoteSnapshots: inertSubscription(),
  },
});

mock.module(new URL("../services/gex.ts", import.meta.url).href, {
  namedExports: {
    buildGexDashboardHttpCacheMetadata: () => ({}),
    getCachedGexDashboardHttpCacheEntry: () => null,
    getGexDashboardData: inertService({}),
    getGexProjectionData: inertService({}),
    getGexSnapshots: inertService({}),
    getGexZeroGammaData: inertService({}),
  },
});

mock.module(new URL("../services/market-data-store.ts", import.meta.url).href, {
  namedExports: {
    loadStoredMarketBarsBySymbol: inertService([]),
  },
});

mock.module(new URL("../services/platform.ts", import.meta.url).href, {
  namedExports: {
    OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS: 0,
    OPTION_EXPIRATION_PUBLIC_FOREGROUND_WAIT_MS: 0,
    addWatchlistSymbol: inertService({}),
    batchOptionChains: inertService({}),
    benchmarkOptionsFlowScannerTickerPass: inertService({}),
    cancelOrder: countedInertService("cancelOrder"),
    continueIbkrOrderReply: countedInertService("continueIbkrOrderReply"),
    createWatchlist: inertService({}),
    deleteWatchlist: inertService({}),
    getBarsWithDebug: inertService({}),
    getFlowPremiumDistribution: inertService({}),
    getNews: inertService({}),
    getOptionChainWithDebug: inertService({}),
    getOptionChartBarsWithDebug: inertService({}),
    getOptionExpirationsWithDebug: inertService({}),
    getOptionsFlowUniverse: inertService({}),
    getQuoteSnapshots: inertService({}),
    getRuntimeDiagnostics: inertService({}),
    getRuntimeDiagnosticsCompact: inertService({}),
    getSession: inertService({}),
    getUniverseLogos: inertService({}),
    listAggregateFlowEvents: inertService({}),
    listBrokerConnections: inertService({}),
    listExecutions: countedInertService("listExecutions"),
    listFlowEvents: inertService({}),
    listOrders: countedInertService("listOrders"),
    listWatchlistsForCurrentUser: inertService({}),
    placeOrder: countedInertService("placeOrder"),
    previewOrder: countedInertService("previewOrder"),
    previewOrderReplacement: countedInertService("previewOrderReplacement"),
    removeWatchlistSymbol: inertService({}),
    reorderWatchlistSymbols: inertService({}),
    replaceOrder: countedInertService("replaceOrder"),
    resolveOptionContractWithDebug: (...args: unknown[]) =>
      resolveOptionContractWithDebugImpl(...args),
    searchUniverseTickers: inertService({}),
    submitRawOrders: countedInertService("submitRawOrders"),
    updateWatchlist: inertService({}),
  },
});

mock.module(new URL("../services/shadow-account.ts", import.meta.url).href, {
  namedExports: {
    SHADOW_ACCOUNT_ID: "shadow-account",
    placeShadowOrder: inertService({}),
    previewShadowOrder: inertService({}),
    resolveCurrentUserShadowAccountId: inertService("shadow-account"),
    runShadowWatchlistBacktest: inertService({}),
    withCallerShadowScope: async (_accountId: unknown, fn: () => unknown) => fn(),
  },
});

mock.module(new URL("../services/shadow-account-context.ts", import.meta.url).href, {
  namedExports: {
    runWithShadowAccountId: async (_accountId: unknown, fn: () => unknown) => fn(),
  },
});

mock.module(new URL("../services/shadow-account-streams.ts", import.meta.url).href, {
  namedExports: {
    fetchShadowAccountSnapshotPayload: inertService({}),
    subscribeShadowAccountSnapshots: inertSubscription(),
  },
});

mock.module(
  new URL("../services/signal-monitor-local-bar-cache.ts", import.meta.url).href,
  {
    namedExports: {
      readSignalMonitorLocalMemoryBars: () => [],
    },
  },
);

mock.module(new URL("../services/sse-stream-diagnostics.ts", import.meta.url).href, {
  namedExports: {
    recordSseStreamClose: () => undefined,
    recordSseStreamOpen: () => undefined,
    serializeSseEventData: (data: unknown) => JSON.stringify(data),
  },
});

mock.module(new URL("../services/stock-aggregate-stream.ts", import.meta.url).href, {
  namedExports: {
    getCurrentStockMinuteAggregates: inertService([]),
    getRecentStockMinuteAggregateHistory: inertService([]),
    getStockAggregateStreamDiagnostics: inertService({}),
    isStockAggregateStreamingAvailable: () => false,
    subscribeMutableStockMinuteAggregates: inertSubscription(),
  },
});

mock.module(new URL("../services/volume-footprints.ts", import.meta.url).href, {
  namedExports: {
    getVolumeFootprints: inertService({}),
  },
});

const { default: platformRouter } = await import("./platform");

after(() => {
  mock.reset();
});

function routeSource(path: string, method = "get"): string {
  const start = source.indexOf(`router.${method}("${path}",`);
  assert.notEqual(start, -1, `Missing ${path}`);
  const next = source.indexOf("\nrouter.", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

function accountServiceBlock(startMarker: string, endMarker: string): string {
  const start = accountServiceSource.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing ${startMarker}`);
  const end = accountServiceSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing ${endMarker}`);
  return accountServiceSource.slice(start, end);
}

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(platformRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isHttpError(error)) {
      res.status(error.statusCode).type("application/problem+json").json({
        title: error.message,
        status: error.statusCode,
        code: error.code,
      });
      return;
    }

    res.status(500).type("application/problem+json").json({
      title: "Internal server error",
      status: 500,
    });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function seedMemberAuth(input: {
  email: string;
  entitlements?: string[];
}) {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: input.email,
      passwordHash: "unused-hash",
      role: "member",
      ...(input.entitlements ? { entitlements: input.entitlements } : {}),
    })
    .returning();
  assert.ok(user);
  const session = await createAuthSession({ userId: user.id });
  return {
    userId: user.id,
    cookie: `pyrus_session=${session.sessionToken}`,
    csrfToken: session.csrfToken,
  };
}

const liveOrderMutationCases = [
  {
    path: "/orders/order-1/replace",
    service: "replaceOrder",
    body: {
      accountId: "DU123456",
      mode: "live",
      confirm: true,
      limitPrice: 99,
      orderFingerprint: "0".repeat(64),
      taxPreflightToken: "tax-pf",
    },
  },
  {
    path: "/orders/order-1/cancel",
    service: "cancelOrder",
    body: {
      accountId: "DU123456",
      mode: "live",
      confirm: true,
    },
  },
  {
    path: "/accounts/shadow-account/orders/order-1/cancel",
    service: "cancelAccountOrder",
    body: {
      mode: "shadow",
      confirm: true,
    },
  },
] as const;

const directIbkrOrderRouteCases = [
  { method: "GET", path: "/orders", service: "listOrders" },
  {
    method: "GET",
    path: "/streams/orders",
    service: "fetchOrderSnapshotPayload",
  },
  { method: "GET", path: "/executions", service: "listExecutions" },
  {
    method: "GET",
    path: "/streams/executions",
    service: "fetchExecutionSnapshotPayload",
  },
  {
    method: "GET",
    path: "/streams/accounts?accountId=real-account",
    service: "fetchAccountSnapshotPayload",
  },
  { method: "POST", path: "/orders", service: "placeOrder", body: {} },
  {
    method: "POST",
    path: "/orders/preview",
    service: "previewOrder",
    body: {},
  },
  {
    method: "POST",
    path: "/orders/reply",
    service: "continueIbkrOrderReply",
    body: {},
  },
  {
    method: "POST",
    path: "/orders/submit",
    service: "submitRawOrders",
    body: { ibkrOrders: [] },
  },
  {
    method: "POST",
    path: "/orders/order-1/replace",
    service: "replaceOrder",
    body: {},
  },
  {
    method: "POST",
    path: "/orders/order-1/replace/preview",
    service: "previewOrderReplacement",
    body: {},
  },
  {
    method: "POST",
    path: "/orders/order-1/cancel",
    service: "cancelOrder",
    body: {},
  },
  {
    method: "POST",
    path: "/accounts/DU123456/orders/order-1/cancel",
    service: "cancelAccountOrder",
    body: { mode: "live", confirm: true },
  },
] as const;

test("logo proxy serves only bounded raster images with defensive headers", { concurrency: false }, async () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]);
  const upstreamCalls: Array<{ url: string; redirect: string | undefined }> = [];
  const upstreamFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    upstreamCalls.push({ url, redirect: init?.redirect });
    const path = new URL(url).pathname;
    if (path === "/valid.png" || path === "/http.png") {
      return new Response(png, {
        status: 200,
        headers: {
          "content-length": String(png.length),
          "content-type": "Image/PNG; charset=binary",
        },
      });
    }
    if (path === "/html") {
      return new Response("<script>globalThis.pwned = true</script>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (path === "/image.svg") {
      return new Response("<svg><script>globalThis.pwned = true</script></svg>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      });
    }
    if (path === "/spoofed.png") {
      return new Response("<script>globalThis.pwned = true</script>", {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (path === "/oversize.webp") {
      return new Response(Buffer.alloc(250_001), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    }
    if (path === "/redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/payload" },
      });
    }
    return new Response(png, { status: 200 });
  };

  globalThis.fetch = upstreamFetch;
  try {
    await withServer(async (baseUrl) => {
      const proxy = (url: string) =>
        nativeFetch(
          `${baseUrl}/universe/logo-proxy?url=${encodeURIComponent(url)}`,
        );
      const valid = await proxy("https://storage.googleapis.com/valid.png");
      assert.equal(valid.status, 200);
      assert.equal(valid.headers.get("content-type"), "image/png");
      assert.equal(valid.headers.get("x-content-type-options"), "nosniff");
      assert.equal(valid.headers.get("content-disposition"), "inline");
      assert.equal(
        valid.headers.get("content-security-policy"),
        "default-src 'none'; sandbox",
      );
      assert.equal(valid.headers.get("cross-origin-resource-policy"), "same-origin");
      assert.deepEqual(Buffer.from(await valid.arrayBuffer()), png);

      for (const path of [
        "html",
        "image.svg",
        "missing-content-type",
        "spoofed.png",
        "oversize.webp",
        "redirect",
      ]) {
        const rejected = await proxy(`https://storage.googleapis.com/${path}`);
        assert.equal(rejected.status, 204, path);
      }

      const callsBeforeHttp = upstreamCalls.length;
      const http = await proxy("http://storage.googleapis.com/http.png");
      assert.equal(http.status, 403);
      assert.equal(upstreamCalls.length, callsBeforeHttp);
      assert.ok(upstreamCalls.length > 0);
      assert.ok(upstreamCalls.every((call) => call.redirect === "manual"));
      assert.equal(
        upstreamCalls.filter((call) => new URL(call.url).pathname === "/redirect").length,
        1,
      );
    });
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("account positions route supports explicit quote and fast-detail controls", () => {
  const handler = routeSource("/accounts/:accountId/positions");
  assert.match(handler, /req\.query\.liveQuotes === "false"/);
  assert.match(handler, /req\.query\.detail === "fast"/);
  assert.match(handler, /detail,/);
  assert.doesNotMatch(
    handler,
    /SHADOW_ACCOUNT_ID/,
    "shadow accounts must not be opted out of live quotes by default",
  );
});

test("account detail routes thread the requesting user and preserve scoped 404s", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const accountId = "seeded-provider-account";
      const owner = await seedMemberAuth({
        email: "account-detail-owner@example.com",
      });
      const otherUser = await seedMemberAuth({
        email: "account-detail-other@example.com",
      });
      const observedCalls: Array<{
        route: "summary" | "positions";
        accountId: string;
        appUserId: string | null;
        allowDirectIbkr: boolean;
      }> = [];
      const detailResponse =
        (route: "summary" | "positions") => async (rawInput: unknown) => {
          const input = rawInput as {
            accountId?: unknown;
            appUserId?: unknown;
            allowDirectIbkr?: unknown;
          };
          const observed = {
            route,
            accountId: String(input.accountId ?? ""),
            appUserId:
              typeof input.appUserId === "string" ? input.appUserId : null,
            allowDirectIbkr: input.allowDirectIbkr === true,
          };
          observedCalls.push(observed);
          if (
            observed.accountId !== accountId ||
            observed.appUserId !== owner.userId
          ) {
            throw new HttpError(404, `Account "${accountId}" was not found.`, {
              code: "account_not_found",
              expose: true,
            });
          }
          return route === "summary"
            ? { accounts: [{ id: accountId, owner: owner.userId }] }
            : { positions: [{ id: `${accountId}:AAPL`, accountId }] };
        };

      snapTradeBackedAccountsPresent = true;
      getAccountSummaryImpl = detailResponse("summary");
      getAccountPositionsImpl = detailResponse("positions");
      try {
        for (const route of ["summary", "positions"] as const) {
          const ownerResponse = await fetch(
            `${baseUrl}/accounts/${accountId}/${route}`,
            { headers: { cookie: owner.cookie } },
          );
          assert.equal(ownerResponse.status, 200);
          const ownerBody = (await ownerResponse.json()) as {
            accounts?: unknown[];
            positions?: unknown[];
          };
          assert.equal(
            route === "summary"
              ? ownerBody.accounts?.length
              : ownerBody.positions?.length,
            1,
          );

          const otherResponse = await fetch(
            `${baseUrl}/accounts/${accountId}/${route}`,
            { headers: { cookie: otherUser.cookie } },
          );
          assert.equal(otherResponse.status, 404);
          assert.equal(
            ((await otherResponse.json()) as { code?: string }).code,
            "account_not_found",
          );
        }

        assert.deepEqual(
          observedCalls.map(({ route, appUserId, allowDirectIbkr }) => ({
            route,
            appUserId,
            allowDirectIbkr,
          })),
          [
            {
              route: "summary",
              appUserId: owner.userId,
              allowDirectIbkr: false,
            },
            {
              route: "summary",
              appUserId: otherUser.userId,
              allowDirectIbkr: false,
            },
            {
              route: "positions",
              appUserId: owner.userId,
              allowDirectIbkr: false,
            },
            {
              route: "positions",
              appUserId: otherUser.userId,
              allowDirectIbkr: false,
            },
          ],
        );

        // Provider-aware admission: a Robinhood-only owner (no IBKR, no
        // SnapTrade presence) is admitted rather than rejected with a 503
        // before scoped resolution (WO-P2-ACCTSCOPE reviewer High finding).
        snapTradeBackedAccountsPresent = false;
        robinhoodBackedAccountsPresent = true;
        const robinhoodOwnerResponse = await fetch(
          `${baseUrl}/accounts/${accountId}/summary`,
          { headers: { cookie: owner.cookie } },
        );
        assert.equal(robinhoodOwnerResponse.status, 200);
      } finally {
        snapTradeBackedAccountsPresent = false;
        robinhoodBackedAccountsPresent = false;
        getAccountSummaryImpl = countedService("getAccountSummary");
        getAccountPositionsImpl = countedService("getAccountPositions");
      }
    }),
  );
});

test("account detail service caches include the requesting user scope", () => {
  const summary = accountServiceBlock(
    "export async function getAccountSummary(",
    "async function getAccountSummaryUncached(",
  );
  assert.match(summary, /appUserId/);
  assert.match(
    summary,
    /readAccountRouteResponseCache\([\s\S]*?appUserId/,
    "summary response caching must not reuse one user's detail for another user",
  );

  const positions = accountServiceBlock(
    "export async function getAccountPositions(",
    "function resolveAccountPositionTypeFilter(",
  );
  assert.match(positions, /appUserId/);

  const universeCacheKey = accountServiceBlock(
    "function accountUniverseReadCacheKey(",
    "function accountPositionsCacheKey(",
  );
  assert.match(
    universeCacheKey,
    /appUserId/,
    "position-derived caches must separate same-shaped requests by app user",
  );
});

test("live order mutation routes reject members without broker_connect before broker services", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      serviceCalls.clear();
      const auth = await seedMemberAuth({
        email: "wo-sec-plain@example.com",
      });

      for (const route of liveOrderMutationCases) {
        const response = await fetch(`${baseUrl}${route.path}`, {
          method: "POST",
          headers: {
            cookie: auth.cookie,
            "content-type": "application/json",
            [AUTH_CSRF_HEADER]: auth.csrfToken,
          },
          body: JSON.stringify(route.body),
        });

        assert.equal(response.status, 403, `${route.path} should be blocked`);
        assert.equal(
          ((await response.json()) as { code?: string }).code,
          "entitlement_required",
        );
        assert.equal(
          serviceCalls.get(route.service) ?? 0,
          0,
          `${route.service} should not run before entitlement admission`,
        );
      }
    }),
  );
});

test("direct IBKR routes reject members without IBKR authorization before broker services", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const previousFlag = process.env["IBKR_MEMBER_CONNECT_ENABLED"];
      process.env["IBKR_MEMBER_CONNECT_ENABLED"] = "true";
      serviceCalls.clear();
      try {
        const auth = await seedMemberAuth({
          email: "direct-ibkr-order-unentitled@example.com",
          entitlements: ["broker_connect"],
        });

        for (const route of directIbkrOrderRouteCases) {
          const response = await fetch(`${baseUrl}${route.path}`, {
            method: route.method,
            headers: {
              cookie: auth.cookie,
              ...(route.method === "POST"
                ? {
                    "content-type": "application/json",
                    [AUTH_CSRF_HEADER]: auth.csrfToken,
                  }
                : {}),
            },
            ...(route.method === "POST"
              ? { body: JSON.stringify(route.body) }
              : {}),
          });

          assert.equal(response.status, 403, `${route.path} should be blocked`);
          assert.equal(
            ((await response.json()) as { code?: string }).code,
            "ibkr_member_connect_disabled",
          );
          assert.equal(
            serviceCalls.get(route.service) ?? 0,
            0,
            `${route.service} should not run before IBKR admission`,
          );
        }
      } finally {
        if (previousFlag === undefined) {
          delete process.env["IBKR_MEMBER_CONNECT_ENABLED"];
        } else {
          process.env["IBKR_MEMBER_CONNECT_ENABLED"] = previousFlag;
        }
      }
    }),
  );
});

test("Flex test route rejects missing CSRF before refreshing", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      serviceCalls.clear();
      const auth = await seedMemberAuth({
        email: "flex-test-missing-csrf@example.com",
        entitlements: ["broker_connect"],
      });

      const response = await fetch(`${baseUrl}/accounts/flex/test`, {
        method: "POST",
        headers: {
          cookie: auth.cookie,
          "content-type": "application/json",
        },
        body: "{}",
      });

      assert.equal(response.status, 403);
      assert.equal(
        ((await response.json()) as { code?: string }).code,
        "invalid_csrf_token",
      );
      assert.equal(serviceCalls.get("testFlexToken") ?? 0, 0);
    }),
  );
});

test("live order mutation routes reject missing CSRF before broker services", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      serviceCalls.clear();
      const auth = await seedMemberAuth({
        email: "wo-sec-missing-csrf@example.com",
        entitlements: ["broker_connect"],
      });

      for (const route of liveOrderMutationCases) {
        const response = await fetch(`${baseUrl}${route.path}`, {
          method: "POST",
          headers: {
            cookie: auth.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify(route.body),
        });

        assert.equal(response.status, 403, `${route.path} should be blocked`);
        assert.equal(
          ((await response.json()) as { code?: string }).code,
          "invalid_csrf_token",
        );
        assert.equal(
          serviceCalls.get(route.service) ?? 0,
          0,
          `${route.service} should not run before CSRF admission`,
        );
      }
    }),
  );
});

test("authorized live order mutation routes with CSRF reach handlers", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const previousFlag = process.env["IBKR_MEMBER_CONNECT_ENABLED"];
      process.env["IBKR_MEMBER_CONNECT_ENABLED"] = "true";
      serviceCalls.clear();
      try {
        const auth = await seedMemberAuth({
          email: "wo-sec-entitled@example.com",
          entitlements: ["broker_connect", "ibkr_access"],
        });

        for (const route of liveOrderMutationCases) {
          const response = await fetch(`${baseUrl}${route.path}`, {
            method: "POST",
            headers: {
              cookie: auth.cookie,
              "content-type": "application/json",
              [AUTH_CSRF_HEADER]: auth.csrfToken,
            },
            body: JSON.stringify(route.body),
          });

          assert.equal(response.status, 200, `${route.path} should pass guard`);
          assert.equal(
            serviceCalls.get(route.service) ?? 0,
            1,
            `${route.service} should run after entitlement and CSRF admission`,
          );
        }
      } finally {
        if (previousFlag === undefined) {
          delete process.env["IBKR_MEMBER_CONNECT_ENABLED"];
        } else {
          process.env["IBKR_MEMBER_CONNECT_ENABLED"] = previousFlag;
        }
      }
    }),
  );
});

test("real account routes and streams short-circuit account services when admission is denied", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      serviceCalls.clear();
      const auth = await seedMemberAuth({
        email: "account-admission-member@example.com",
      });
      const cases = [
        { path: "/accounts", service: "listAccounts" },
        { path: "/accounts/real-account/summary", service: "getAccountSummary" },
        {
          path: "/accounts/real-account/equity-history",
          service: "getAccountEquityHistory",
        },
        {
          path: "/accounts/real-account/allocation",
          service: "getAccountAllocation",
        },
        { path: "/accounts/real-account/positions", service: "getAccountPositions" },
        {
          path: "/accounts/real-account/positions-at-date",
          service: "getAccountPositionsAtDate",
        },
        {
          path: "/accounts/real-account/closed-trades",
          service: "getAccountClosedTrades",
        },
        { path: "/accounts/real-account/orders", service: "getAccountOrders" },
        { path: "/accounts/real-account/risk", service: "getAccountRisk" },
        {
          path: "/accounts/real-account/cash-activity",
          service: "getAccountCashActivity",
        },
        {
          path: "/streams/accounts/page?accountId=real-account",
          service: "fetchAccountPagePrimaryPayload",
        },
      ];

      for (const { path, service } of cases) {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { cookie: auth.cookie },
        });

        assert.equal(response.status, 503, `GET ${path} should be blocked`);
        assert.equal(
          serviceCalls.get(service) ?? 0,
          0,
          `${service} should not run after denied account admission`,
        );
      }
    }),
  );
});

test("account risk route preserves degraded 200s, retryable 503s, and real 500s", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const auth = await seedMemberAuth({
        email: "account-risk-degraded@example.com",
      });
      const requestRisk = () =>
        fetch(`${baseUrl}/accounts/shadow-account/risk`, {
          headers: { cookie: auth.cookie },
        });

      try {
        getAccountRiskImpl = async () => ({
          accountId: "shadow-account",
          degraded: true,
          degradedReason: "statement_timeout",
          asOf: "2026-07-09T20:00:00.000Z",
        });
        const staleResponse = await requestRisk();
        assert.equal(staleResponse.status, 200);
        assert.equal(
          ((await staleResponse.json()) as { degraded?: boolean }).degraded,
          true,
        );

        getAccountRiskImpl = async () => {
          throw new HttpError(503, "Account risk is temporarily degraded", {
            code: "degraded_upstream",
          });
        };
        const degradedResponse = await requestRisk();
        assert.equal(degradedResponse.status, 503);
        assert.equal(degradedResponse.headers.get("retry-after"), "15");
        assert.equal(
          degradedResponse.headers.get("x-pyrus-admission-action"),
          "shed",
        );
        assert.equal(
          degradedResponse.headers.get("x-pyrus-admission-reason"),
          "degraded_upstream",
        );
        assert.equal(
          ((await degradedResponse.json()) as { code?: string }).code,
          "degraded_upstream",
        );

        getAccountRiskImpl = async () => {
          throw new TypeError("risk model invariant failed");
        };
        const hardFailureResponse = await requestRisk();
        assert.equal(hardFailureResponse.status, 500);
      } finally {
        getAccountRiskImpl = countedService("getAccountRisk");
      }
    }),
  );
});

test("public Trade option-chain routes avoid artificial metadata waits", () => {
  const chainHandler = routeSource("/options/chains");
  assert.match(chainHandler, /bypassBridgeBackoff:\s*true/);
  assert.match(chainHandler, /allowDelayedSnapshotHydration:\s*false/);
  assert.match(chainHandler, /emptyRetryDelaysMs:\s*\[\]/);
  assert.match(chainHandler, /timeoutMs:\s*OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS/);

  const batchHandler = routeSource("/options/chains/batch", "post");
  assert.match(batchHandler, /bypassBridgeBackoff:\s*true/);
  assert.match(batchHandler, /allowDelayedSnapshotHydration:\s*false/);
  assert.match(batchHandler, /emptyRetryDelaysMs:\s*\[\]/);
  assert.match(batchHandler, /timeoutMs:\s*OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS/);
});

test("resolve-contract coerces its HTTP date before generated validation", async () => {
  const calls: Array<Record<string, unknown>> = [];
  resolveOptionContractWithDebugImpl = async (input: unknown) => {
    const query = input as {
      underlying: string;
      expirationDate: Date;
      strike: number;
      right: "call" | "put";
    };
    calls.push(input as Record<string, unknown>);
    return {
      ...query,
      status: "not_found",
      providerContractId: null,
      contract: null,
      errorMessage: null,
      debug: { cacheStatus: "miss", totalMs: 0, upstreamMs: null },
    };
  };

  try {
    await withServer(async (baseUrl) => {
      const valid = await fetch(
        `${baseUrl}/options/resolve-contract?underlying=SPY&expirationDate=2026-07-17&strike=500&right=call&ignored=x`,
      );
      assert.equal(valid.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.expirationDate instanceof Date, true);
      assert.equal(
        (calls[0]?.expirationDate as Date).toISOString(),
        "2026-07-17T00:00:00.000Z",
      );
      assert.equal(calls[0]?.strike, 500);
      assert.equal(Object.hasOwn(calls[0] ?? {}, "ignored"), false);

      const invalid = await fetch(
        `${baseUrl}/options/resolve-contract?underlying=SPY&expirationDate=not-a-date&strike=500&right=call`,
      );
      assert.notEqual(invalid.status, 200);
      assert.equal(calls.length, 1);

      const repeated = await fetch(
        `${baseUrl}/options/resolve-contract?underlying=SPY&expirationDate=2026-07-17&expirationDate=2026-07-18&strike=500&right=call`,
      );
      assert.notEqual(repeated.status, 200);
      assert.equal(calls.length, 1);
    });
  } finally {
    resolveOptionContractWithDebugImpl = inertService({});
  }
});

test("option-chain stream announces readiness before background snapshots", () => {
  const handler = routeSource("/streams/options/chains");
  assert.match(handler, /writeEvent\(\s*"ready"/s);
  assert.match(handler, /subscribeOptionChains\(underlyings/);
  assert.doesNotMatch(handler, /fetchOptionChainSnapshotPayload/);
});

test("session route re-merges runtime.ibkr passthrough fields stripped by zod", () => {
  // GetSessionResponse only enumerates a subset of SessionIbkrRuntime keys, so
  // the route must re-merge the source runtime.ibkr (openapi additionalProperties:
  // true) to keep bridge-status fields like brokerServerConnected / streamState /
  // strictReason in the response. Guard against silently dropping that merge.
  const handler = routeSource("/session");
  assert.match(handler, /GetSessionResponse\.parse\(session\)/);
  assert.match(handler, /data\.runtime\.ibkr\s*=\s*\{/s);
  assert.match(handler, /\.\.\.session\.runtime\.ibkr/);
});
