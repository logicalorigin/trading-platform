import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, mock, test } from "node:test";

import { db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import express from "express";
import { isHttpError } from "../lib/errors";
import { createAuthSession } from "../services/auth";
import { AUTH_CSRF_HEADER } from "./auth";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
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
    getAccountPositions: countedService("getAccountPositions"),
    getAccountPositionsAtDate: countedService("getAccountPositionsAtDate"),
    getAccountRisk: countedService("getAccountRisk"),
    getAccountSummary: countedService("getAccountSummary"),
    getFlexHealth: inertService({ ok: true }),
    hasSnapTradeBackedAccounts: async () => false,
    listAccounts: countedService("listAccounts"),
    testFlexToken: inertService({ ok: true }),
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
    fetchExecutionSnapshotPayload: inertService({}),
    fetchOptionQuoteSnapshotPayload: inertService({}),
    fetchOrderSnapshotPayload: inertService({}),
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
    listExecutions: inertService({}),
    listFlowEvents: inertService({}),
    listOrders: inertService({}),
    listWatchlistsForCurrentUser: inertService({}),
    placeOrder: inertService({}),
    previewOrder: inertService({}),
    removeWatchlistSymbol: inertService({}),
    reorderWatchlistSymbols: inertService({}),
    replaceOrder: countedInertService("replaceOrder"),
    resolveOptionContractWithDebug: inertService({}),
    searchUniverseTickers: inertService({}),
    submitRawOrders: inertService({}),
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
      order: { conid: 265598 },
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

test("live order mutation routes with broker_connect and CSRF reach handlers", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      serviceCalls.clear();
      const auth = await seedMemberAuth({
        email: "wo-sec-entitled@example.com",
        entitlements: ["broker_connect"],
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
        {
          path: "/streams/accounts?accountId=real-account",
          service: "fetchAccountSnapshotPayload",
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
