import assert from "node:assert/strict";
import { once } from "node:events";
import test, { beforeEach } from "node:test";
import type { AddressInfo } from "node:net";

import { db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import app from "../app";
import { createAuthSession } from "../services/auth";
import { AUTH_CSRF_HEADER, __resetAuthRateLimitsForTests } from "./auth";

beforeEach(() => {
  __resetAuthRateLimitsForTests();
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
    cookie: `pyrus_session=${session.sessionToken}`,
    csrfToken: session.csrfToken,
  };
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
    path: `/algo/deployments/${UNKNOWN_DEPLOYMENT_ID}/signal-options/backfill`,
  },
] as const;

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

test("algo deployment reads stay open so the cockpit keeps polling", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/algo/deployments`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { deployments?: unknown };
      assert.ok(Array.isArray(body.deployments));
    }),
  );
});
