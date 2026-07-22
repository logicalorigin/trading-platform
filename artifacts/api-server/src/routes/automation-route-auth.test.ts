import assert from "node:assert/strict";
import { once } from "node:events";
import test, { beforeEach } from "node:test";
import type { AddressInfo } from "node:net";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  auditEventsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  executionEventsTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import app from "../app";
import {
  __algoAutomationInternalsForTests,
} from "../services/automation";
import { createAuthSession } from "../services/auth";
import { AUTH_CSRF_HEADER, __resetAuthRateLimitsForTests } from "./auth";
import { __resetDiagnosticTelemetryRateLimitsForTests } from "./diagnostics";

beforeEach(() => {
  __resetAuthRateLimitsForTests();
  __resetDiagnosticTelemetryRateLimitsForTests();
});

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}/api`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function seedUser(role: "admin" | "member") {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: "unused-hash",
      role,
    })
    .returning();
  const session = await createAuthSession({ userId: user!.id });
  return {
    id: user!.id,
    cookie: `pyrus_session=${session.sessionToken}`,
    csrfToken: session.csrfToken,
  };
}

async function seedOwnedDeployment(input: {
  appUserId: string;
  providerAccountId: string;
}) {
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: input.appUserId,
      name: `snaptrade-${input.providerAccountId}`,
      connectionType: "broker",
      brokerProvider: "snaptrade",
      mode: "shadow",
      status: "connected",
      capabilities: ["accounts"],
    })
    .returning();
  await db.insert(brokerAccountsTable).values({
    appUserId: input.appUserId,
    connectionId: connection!.id,
    providerAccountId: input.providerAccountId,
    displayName: `Account ${input.providerAccountId}`,
    mode: "shadow",
  });
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: `strategy-${input.providerAccountId}`,
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["AAPL"],
      config: {},
    })
    .returning();
  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      appUserId: input.appUserId,
      strategyId: strategy!.id,
      name: `deployment-${input.providerAccountId}`,
      mode: "shadow",
      enabled: true,
      providerAccountId: input.providerAccountId,
      symbolUniverse: ["AAPL"],
      config: {},
    })
    .returning();
  const [event] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: deployment!.id,
      providerAccountId: input.providerAccountId,
      symbol: "AAPL",
      eventType: "signal_options_shadow_entry",
      summary: `entry-${input.providerAccountId}`,
      payload: { side: "long" },
    })
    .returning();
  __algoAutomationInternalsForTests.clearExecutionEventsListCacheForTests();
  return { deployment: deployment!, event: event! };
}

// A well-formed but nonexistent deployment id: once auth is admitted the
// service reports "not found" rather than tripping on a malformed UUID.
const UNKNOWN_DEPLOYMENT_ID = "00000000-0000-0000-0000-000000000000";

// A representative sample of the state-changing /algo mutations: a
// frontend-consumed one (pause), the flip-to-live one (mode), and one with no
// current frontend caller (backfill). All must be locked behind admin + CSRF.
const MUTATION_ROUTES = [
  { method: "POST", path: `/algo/deployments/${UNKNOWN_DEPLOYMENT_ID}/pause` },
  { method: "POST", path: `/algo/deployments/${UNKNOWN_DEPLOYMENT_ID}/mode` },
  {
    method: "POST",
    path: `/algo/deployments/${UNKNOWN_DEPLOYMENT_ID}/activate-live`,
  },
  {
    method: "POST",
    path: `/algo/deployments/${UNKNOWN_DEPLOYMENT_ID}/signal-options/backfill`,
  },
] as const;

const DIAGNOSTICS_USER_ROUTES = [
  { method: "POST", path: "/diagnostics/client-events" },
  { method: "POST", path: "/diagnostics/client-metrics" },
  { method: "POST", path: "/diagnostics/browser-reports" },
] as const;

const DIAGNOSTICS_ADMIN_ROUTES = [
  { method: "GET", path: "/diagnostics/latest" },
  { method: "GET", path: "/diagnostics/runtime" },
  { method: "GET", path: "/diagnostics/history" },
  { method: "GET", path: "/diagnostics/events" },
  { method: "GET", path: "/diagnostics/events/example-event" },
  { method: "GET", path: "/diagnostics/export" },
  { method: "GET", path: "/diagnostics/thresholds" },
  { method: "GET", path: "/diagnostics/stream" },
  { method: "GET", path: "/diagnostics/market-data/price-trace" },
  { method: "PUT", path: "/diagnostics/thresholds" },
  { method: "POST", path: "/diagnostics/storage/prune" },
  { method: "POST", path: "/diagnostics/market-data/gex-universe-refresh" },
] as const;

const DIAGNOSTICS_GATED_ROUTES = [
  ...DIAGNOSTICS_USER_ROUTES,
  ...DIAGNOSTICS_ADMIN_ROUTES,
] as const;

const OWNERLESS_ADMIN_READ_ROUTES = [
  { method: "GET", path: "/backtests/studies" },
  { method: "GET", path: "/charting/pine-scripts" },
] as const;

const TENANT_CONTAINMENT_PREFIXES = [
  "/algo",
  "/streams/algo",
  "/accounts/flex",
] as const;

const GLOBAL_ADMIN_MUTATION_ROUTES = [
  { method: "POST", path: "/backtests/studies" },
  { method: "POST", path: "/charting/pine-scripts" },
  { method: "PUT", path: "/signal-monitor/profile" },
  { method: "POST", path: "/signal-monitor/evaluate" },
] as const;

type AuthRouteRequestInit = RequestInit & {
  headers?: Record<string, string>;
};

function requestInitFor(route: {
  method: string;
}): AuthRouteRequestInit {
  if (route.method === "GET") {
    return { method: route.method };
  }
  return {
    method: route.method,
    headers: { "content-type": "application/json" },
    body: "{}",
  };
}

test("algo mutation routes reject unauthenticated requests", async () => {
  await withServer(async (baseUrl) => {
    for (const route of MUTATION_ROUTES) {
      const response = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 401, `${route.path} should require auth`);
      const body = (await response.json()) as { code?: string };
      assert.equal(body.code, "auth_required");
    }
  });
});

test("gated diagnostics routes reject unauthenticated requests", async () => {
  await withServer(async (baseUrl) => {
    for (const route of DIAGNOSTICS_GATED_ROUTES) {
      const response = await fetch(
        `${baseUrl}${route.path}`,
        requestInitFor(route),
      );
      assert.equal(response.status, 401, `${route.path} should require auth`);
      const body = (await response.json()) as { code?: string };
      assert.equal(body.code, "auth_required");
    }
  });
});

test("admin diagnostics routes reject authenticated non-admin sessions", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const member = await seedUser("member");
      for (const route of DIAGNOSTICS_ADMIN_ROUTES) {
        const init = requestInitFor(route);
        const response = await fetch(`${baseUrl}${route.path}`, {
          ...init,
          headers: {
            ...init.headers,
            cookie: member.cookie,
            [AUTH_CSRF_HEADER]: member.csrfToken,
          },
        });
        assert.equal(response.status, 403, `${route.path} should reject non-admin`);
        const body = (await response.json()) as { code?: string };
        assert.equal(body.code, "admin_required");
      }
    }),
  );
});

test("ownerless backtest and Pine reads reject non-admin members", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const member = await seedUser("member");
      for (const route of OWNERLESS_ADMIN_READ_ROUTES) {
        const response = await fetch(`${baseUrl}${route.path}`, {
          headers: { cookie: member.cookie },
        });
        assert.equal(response.status, 403, route.path);
        assert.equal(
          ((await response.json()) as { code?: string }).code,
          "admin_required",
        );
      }
    }),
  );
});

test("ownerless automation and Flex prefixes deny members and admit admins", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const member = await seedUser("member");
      const admin = await seedUser("admin");

      for (const prefix of TENANT_CONTAINMENT_PREFIXES) {
        const path = `${prefix}/containment-probe`;
        const memberResponse = await fetch(`${baseUrl}${path}`, {
          headers: { cookie: member.cookie },
        });
        assert.equal(memberResponse.status, 403, path);
        assert.equal(
          ((await memberResponse.json()) as { code?: string }).code,
          "admin_required",
        );

        const adminResponse = await fetch(`${baseUrl}${path}`, {
          headers: { cookie: admin.cookie },
        });
        assert.equal(adminResponse.status, 404, path);
      }
    }),
  );
});

test("ownerless automation and Flex prefixes require admin CSRF for unsafe methods", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const member = await seedUser("member");
      const admin = await seedUser("admin");

      for (const prefix of TENANT_CONTAINMENT_PREFIXES) {
        const path = `${prefix}/containment-probe`;
        const memberResponse = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            cookie: member.cookie,
            "content-type": "application/json",
            [AUTH_CSRF_HEADER]: member.csrfToken,
          },
          body: "{}",
        });
        assert.equal(memberResponse.status, 403, path);
        assert.equal(
          ((await memberResponse.json()) as { code?: string }).code,
          "admin_required",
        );

        const missingCsrfResponse = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            cookie: admin.cookie,
            "content-type": "application/json",
          },
          body: "{}",
        });
        assert.equal(missingCsrfResponse.status, 403, path);
        assert.equal(
          ((await missingCsrfResponse.json()) as { code?: string }).code,
          "invalid_csrf_token",
        );

        const adminResponse = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            cookie: admin.cookie,
            "content-type": "application/json",
            [AUTH_CSRF_HEADER]: admin.csrfToken,
          },
          body: "{}",
        });
        assert.equal(adminResponse.status, 404, path);
      }
    }),
  );
});

test("member-scoped mutations require the session CSRF token", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const member = await seedUser("member");
      const missingCsrf = await fetch(`${baseUrl}/watchlists`, {
        method: "POST",
        headers: {
          cookie: member.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "CSRF proof" }),
      });
      assert.equal(missingCsrf.status, 403);
      assert.equal(
        ((await missingCsrf.json()) as { code?: string }).code,
        "invalid_csrf_token",
      );

      const admitted = await fetch(`${baseUrl}/watchlists`, {
        method: "POST",
        headers: {
          cookie: member.cookie,
          "content-type": "application/json",
          [AUTH_CSRF_HEADER]: member.csrfToken,
        },
        body: JSON.stringify({ name: "CSRF proof" }),
      });
      assert.equal(admitted.status, 201);
    }),
  );
});

test("global feature mutations require admin role and CSRF", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const member = await seedUser("member");
      const admin = await seedUser("admin");
      for (const route of GLOBAL_ADMIN_MUTATION_ROUTES) {
        const memberResponse = await fetch(`${baseUrl}${route.path}`, {
          method: route.method,
          headers: {
            cookie: member.cookie,
            "content-type": "application/json",
            [AUTH_CSRF_HEADER]: member.csrfToken,
          },
          body: "{}",
        });
        assert.equal(memberResponse.status, 403, route.path);
        assert.equal(
          ((await memberResponse.json()) as { code?: string }).code,
          "admin_required",
        );

        const adminResponse = await fetch(`${baseUrl}${route.path}`, {
          method: route.method,
          headers: {
            cookie: admin.cookie,
            "content-type": "application/json",
          },
          body: "{}",
        });
        assert.equal(adminResponse.status, 403, route.path);
        assert.equal(
          ((await adminResponse.json()) as { code?: string }).code,
          "invalid_csrf_token",
        );
      }
    }),
  );
});

test("admin can read the latest diagnostics snapshot", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const admin = await seedUser("admin");
      const response = await fetch(`${baseUrl}/diagnostics/latest`, {
        headers: { cookie: admin.cookie },
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { status?: string };
      assert.equal(typeof body.status, "string");
    }),
  );
});

test("browser diagnostic report batches have a hard item ceiling", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const member = await seedUser("member");
      const response = await fetch(`${baseUrl}/diagnostics/browser-reports`, {
        method: "POST",
        headers: {
          cookie: member.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify(Array.from({ length: 21 }, () => ({}))),
      });
      assert.equal(response.status, 413);
      const body = (await response.json()) as { code?: string };
      assert.equal(body.code, "browser_report_batch_too_large");
    }),
  );
});

test("diagnostic telemetry is bounded per user without blocking another user", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const noisy = await seedUser("member");
      const other = await seedUser("member");
      for (let request = 0; request < 30; request += 1) {
        const response = await fetch(`${baseUrl}/diagnostics/client-metrics`, {
          method: "POST",
          headers: {
            cookie: noisy.cookie,
            "content-type": "application/json",
          },
          body: "{}",
        });
        assert.equal(response.status, 202);
      }

      const limited = await fetch(`${baseUrl}/diagnostics/client-metrics`, {
        method: "POST",
        headers: {
          cookie: noisy.cookie,
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(limited.status, 429);
      assert.equal(
        ((await limited.json()) as { code?: string }).code,
        "diagnostic_telemetry_rate_limited",
      );

      const admitted = await fetch(`${baseUrl}/diagnostics/client-metrics`, {
        method: "POST",
        headers: {
          cookie: other.cookie,
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(admitted.status, 202);
    }),
  );
});

test("browser diagnostic event identifiers and messages are bounded", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const member = await seedUser("member");
      const response = await fetch(`${baseUrl}/diagnostics/client-events`, {
        method: "POST",
        headers: {
          cookie: member.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          category: "c".repeat(100),
          code: "x".repeat(200),
          message: "m".repeat(3_000),
        }),
      });
      assert.equal(response.status, 202);
      const body = (await response.json()) as {
        event: { category: string; code: string; message: string };
      };
      assert.equal(body.event.category.length, 64);
      assert.equal(body.event.code.length, 96);
      assert.equal(body.event.message.length, 2_000);
    }),
  );
});

test("algo mutation routes reject authenticated non-admin sessions", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const member = await seedUser("member");
      for (const route of MUTATION_ROUTES) {
        const response = await fetch(`${baseUrl}${route.path}`, {
          method: route.method,
          headers: {
            cookie: member.cookie,
            "content-type": "application/json",
            [AUTH_CSRF_HEADER]: member.csrfToken,
          },
          body: "{}",
        });
        assert.equal(response.status, 403, `${route.path} should reject non-admin`);
        const body = (await response.json()) as { code?: string };
        assert.equal(body.code, "admin_required");
      }
    }),
  );
});

test("algo mutation routes reject admin sessions missing the CSRF header", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const admin = await seedUser("admin");
      const response = await fetch(
        `${baseUrl}/algo/deployments/${UNKNOWN_DEPLOYMENT_ID}/pause`,
        {
          method: "POST",
          headers: {
            cookie: admin.cookie,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      assert.equal(response.status, 403);
      const body = (await response.json()) as { code?: string };
      assert.equal(body.code, "invalid_csrf_token");
    }),
  );
});

test("algo mutation routes admit admin sessions with a valid CSRF header", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const admin = await seedUser("admin");
      // The guard passes, so the request reaches the service, which reports the
      // unknown deployment. A 404 (not 401/403) proves auth was admitted.
      const response = await fetch(
        `${baseUrl}/algo/deployments/${UNKNOWN_DEPLOYMENT_ID}/pause`,
        {
          method: "POST",
          headers: {
            cookie: admin.cookie,
            "content-type": "application/json",
            [AUTH_CSRF_HEADER]: admin.csrfToken,
          },
          body: "{}",
        },
      );
      assert.equal(response.status, 404);
      const body = (await response.json()) as { code?: string };
      assert.equal(body.code, "algo_deployment_not_found");
    }),
  );
});

test("algo deployment reads require authentication", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/algo/deployments`);
      assert.equal(response.status, 401);
      const body = (await response.json()) as { code?: string };
      assert.equal(body.code, "auth_required");
    }),
  );
});

test("algo deployment list is owner-scoped while legacy events remain admin-only", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const owner = await seedUser("member");
      const admin = await seedUser("admin");
      const { deployment, event } = await seedOwnedDeployment({
        appUserId: owner.id,
        providerAccountId: `acct-${Date.now()}`,
      });

      const ownerListResponse = await fetch(`${baseUrl}/algo/deployments`, {
        headers: { cookie: owner.cookie },
      });
      assert.equal(ownerListResponse.status, 200);
      const ownerList = (await ownerListResponse.json()) as {
        deployments: Array<{ id: string }>;
      };
      assert.equal(
        ownerList.deployments.some((item) => item.id === deployment.id),
        true,
      );

      const adminListResponse = await fetch(`${baseUrl}/algo/deployments`, {
        headers: { cookie: admin.cookie },
      });
      assert.equal(adminListResponse.status, 200);
      const adminList = (await adminListResponse.json()) as {
        deployments: Array<{ id: string }>;
      };
      assert.equal(
        adminList.deployments.some((item) => item.id === deployment.id),
        false,
      );

      const ownerEventsResponse = await fetch(
        `${baseUrl}/algo/events?deploymentId=${deployment.id}`,
        { headers: { cookie: owner.cookie } },
      );
      assert.equal(ownerEventsResponse.status, 403);
      assert.equal(
        ((await ownerEventsResponse.json()) as { code?: string }).code,
        "admin_required",
      );

      const adminEventsResponse = await fetch(
        `${baseUrl}/algo/events?deploymentId=${deployment.id}`,
        { headers: { cookie: admin.cookie } },
      );
      assert.equal(adminEventsResponse.status, 200);
      const adminEvents = (await adminEventsResponse.json()) as {
        events: Array<{ id: string }>;
      };
      assert.equal(
        adminEvents.events.some((item) => item.id === event.id),
        true,
      );
    }),
  );
});

test("algo per-deployment reads stop members at the admin containment gate", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const owner = await seedUser("member");
      const other = await seedUser("member");
      const { deployment } = await seedOwnedDeployment({
        appUserId: owner.id,
        providerAccountId: `acct-${Date.now()}-cross`,
      });

      for (const path of [
        `/algo/events?deploymentId=${deployment.id}`,
        `/algo/deployments/${deployment.id}/signal-options/state`,
        `/algo/deployments/${deployment.id}/cockpit`,
      ]) {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { cookie: other.cookie },
        });
        assert.equal(response.status, 403, path);
        const body = (await response.json()) as { code?: string };
        assert.equal(body.code, "admin_required");
      }

      const auditRows = await db
        .select()
        .from(auditEventsTable);
      assert.equal(
        auditRows.filter(
          (row) =>
            row.appUserId === other.id &&
            row.eventType === "entitlement.denied" &&
            row.resourceType === "algo_deployment" &&
            row.resourceId === deployment.id,
        ).length,
        0,
      );
    }),
  );
});
