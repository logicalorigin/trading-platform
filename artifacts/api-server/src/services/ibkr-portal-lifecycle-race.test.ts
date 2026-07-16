import assert from "node:assert/strict";
import test from "node:test";

import {
  __setDbForTests,
  db,
  ibkrGatewaySessionsTable,
  usersTable,
  type WorkspaceDatabase,
} from "@workspace/db";
import { withTestDb, type TestDatabase } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import {
  approveIbkrGatewayHost,
  ensureIbkrGatewayBrokerConnection,
  ensureIbkrGatewaySessionIdentity,
  readCurrentIbkrGatewayFence,
  registerIbkrGatewayHost,
  transitionIbkrGatewayLifecycle,
  tryAcquireIbkrGatewayLease,
} from "./ibkr-gateway-session-store";
import {
  ensureGateway,
  getGateway,
  transitionGatewayLifecycle,
} from "./ibkr-portal-gateway-manager";
import {
  __expirePortalReadinessQuietWindowForTests,
  disconnectPortal,
  readPortalReadiness,
} from "./ibkr-portal-session";

const HOST_ID = "00000000-0000-4000-8000-000000000029";
const SHA = `sha256:${"7".repeat(64)}`;
const WORKLOAD_IDENTITY = "6".repeat(64);

type FleetTestContext = {
  appUserId: string;
  brokerConnectionId: string;
  testDb: TestDatabase;
};

async function withFleetUser(
  input: { onAccounts?: (appUserId: string) => Promise<void> },
  run: (context: FleetTestContext) => Promise<void>,
): Promise<void> {
  await withTestDb(async (testDb) => {
    const names = [
      "IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY",
      "IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY",
      "IBKR_GATEWAY_FLEET_ENABLED",
      "IBKR_SESSION_HOST_ENABLED",
      "TRADING_MODE",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    const previousFetch = globalThis.fetch;
    let appUserId: string | null = null;

    process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"] = Buffer.alloc(
      32,
      39,
    ).toString("base64url");
    delete process.env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"];
    process.env["IBKR_GATEWAY_FLEET_ENABLED"] = "1";
    delete process.env["IBKR_SESSION_HOST_ENABLED"];
    process.env["TRADING_MODE"] = "shadow";

    globalThis.fetch = (async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/ensure")) {
        return Response.json({
          capsule: {
            loginCompletions: 1,
            name: "pyrus-ibkr-slot-1",
            status: "ready",
          },
          targets: {
            cpg: { host: "127.0.0.1", port: 15000 },
            console: { host: "127.0.0.1", port: 16080 },
          },
        });
      }
      if (
        url.pathname.endsWith("/status") &&
        !url.pathname.includes("/data/")
      ) {
        return Response.json({
          capsule: {
            loginCompletions: 1,
            name: "pyrus-ibkr-slot-1",
            status: "ready",
          },
        });
      }
      if (url.pathname.endsWith("/data/cpg/v1/api/iserver/auth/status")) {
        assert.equal(init?.method, "POST");
        return Response.json({
          authenticated: true,
          connected: true,
          established: true,
          isPaper: true,
          selectedAccount: "DU1234567",
        });
      }
      if (url.pathname.endsWith("/data/cpg/v1/api/iserver/accounts")) {
        assert.ok(appUserId);
        await input.onAccounts?.(appUserId);
        return Response.json({
          accounts: ["DU1234567"],
          isPaper: true,
          selectedAccount: "DU1234567",
        });
      }
      const release = url.pathname.match(
        /^\/sessions\/([^/]+)\/generations\/(\d+)\/slots\/(\d+)\/release$/,
      );
      if (release) {
        return Response.json({
          sessionId: decodeURIComponent(release[1]!),
          generation: Number(release[2]),
          slotNumber: Number(release[3]),
          released: true,
        });
      }
      throw new Error(`unexpected fleet request: ${url.pathname}`);
    }) as typeof fetch;

    try {
      const [user] = await db
        .insert(usersTable)
        .values({
          email: "synthetic-portal-lifecycle-race@example.invalid",
          passwordHash: "synthetic-unused-hash",
        })
        .returning({ id: usersTable.id });
      assert.ok(user);
      appUserId = user.id;
      assert.ok(
        await registerIbkrGatewayHost({
          hostId: HOST_ID,
          workloadIdentityDigest: WORKLOAD_IDENTITY,
          controlOrigin: "https://host-twenty-nine.example.invalid",
          imageDigest: SHA,
          runtimeSpecDigest: SHA,
          runtimeAttestationDigest: SHA,
          failureDomain: "synthetic-zone-twenty-nine",
          measuredSlotCapacity: 1,
        }),
      );
      assert.ok(
        await approveIbkrGatewayHost({
          hostId: HOST_ID,
          workloadIdentityDigest: WORKLOAD_IDENTITY,
          imageDigest: SHA,
          runtimeSpecDigest: SHA,
          runtimeAttestationDigest: SHA,
          admissionSlotCapacity: 1,
        }),
      );
      const connection = await ensureIbkrGatewayBrokerConnection({
        appUserId: user.id,
        mode: "shadow",
      });
      assert.ok(connection);
      assert.ok(
        await ensureIbkrGatewaySessionIdentity({
          appUserId: user.id,
          brokerConnectionId: connection.id,
        }),
      );
      await run({
        appUserId: user.id,
        brokerConnectionId: connection.id,
        testDb,
      });
    } finally {
      if (appUserId) await disconnectPortal(appUserId);
      globalThis.fetch = previousFetch;
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
}

test(
  "same-generation lifecycle completions preserve the newest intent",
  { timeout: 90_000 },
  async () => {
    await withFleetUser(
      {},
      async ({ appUserId, brokerConnectionId, testDb }) => {
        await ensureGateway(appUserId);
        const fence = await readCurrentIbkrGatewayFence({
          appUserId,
          brokerConnectionId,
        });
        assert.ok(fence);
        for (const state of ["login_required", "verifying"] as const) {
          assert.equal(
            await transitionGatewayLifecycle(appUserId, state),
            true,
          );
        }

        type UpdateQuery = {
          returning: (...args: unknown[]) => unknown;
        };
        type UpdateBuilder = {
          set: (values: Record<string, unknown>) => UpdateQuery;
        };
        const delayAuthenticationBehind = async (
          targets: ReadonlyArray<"authenticated" | "reauth_required">,
        ): Promise<{ delayed: boolean; superseding: boolean[] }> => {
          let signalAuthenticatedCommit!: () => void;
          let releaseAuthenticatedResult!: () => void;
          const authenticatedCommitted = new Promise<void>((resolve) => {
            signalAuthenticatedCommit = resolve;
          });
          const authenticatedResultGate = new Promise<void>((resolve) => {
            releaseAuthenticatedResult = resolve;
          });
          let delayed = false;
          const interceptedDb = new Proxy(testDb.db as object, {
            get(dbTarget, property) {
              const value = Reflect.get(dbTarget, property, dbTarget);
              if (property !== "update") {
                return typeof value === "function"
                  ? value.bind(dbTarget)
                  : value;
              }
              return (table: unknown): UpdateBuilder => {
                const builder = (
                  value as (table: unknown) => UpdateBuilder
                ).call(dbTarget, table);
                const originalSet = builder.set.bind(builder);
                builder.set = (values) => {
                  const query = originalSet(values);
                  if (
                    table !== ibkrGatewaySessionsTable ||
                    values["lifecycleState"] !== "authenticated" ||
                    delayed
                  ) {
                    return query;
                  }
                  delayed = true;
                  const originalReturning = query.returning.bind(query);
                  query.returning = (...args) =>
                    Promise.resolve(originalReturning(...args)).then(
                      async (result) => {
                        signalAuthenticatedCommit();
                        await authenticatedResultGate;
                        return result;
                      },
                    );
                  return query;
                };
                return builder;
              };
            },
          }) as WorkspaceDatabase;
          const restoreDb = __setDbForTests(interceptedDb);

          try {
            const delayedResult = transitionGatewayLifecycle(
              appUserId,
              "authenticated",
            );
            await authenticatedCommitted;
            const [committed] = await testDb.db
              .select()
              .from(ibkrGatewaySessionsTable)
              .where(eq(ibkrGatewaySessionsTable.id, fence.sessionId))
              .limit(1);
            assert.equal(committed?.lifecycleState, "authenticated");
            const superseding = [];
            for (const target of targets) {
              superseding.push(
                await transitionGatewayLifecycle(appUserId, target),
              );
            }
            releaseAuthenticatedResult();
            return { delayed: await delayedResult, superseding };
          } finally {
            releaseAuthenticatedResult();
            restoreDb();
          }
        };

        assert.deepEqual(await delayAuthenticationBehind(["authenticated"]), {
          delayed: true,
          superseding: [true],
        });
        assert.equal(getGateway(appUserId)?.paperAccountVerified, true);
        for (const state of [
          "reauth_required",
          "login_required",
          "verifying",
        ] as const) {
          assert.equal(
            await transitionGatewayLifecycle(appUserId, state),
            true,
          );
        }

        assert.deepEqual(
          await delayAuthenticationBehind(["reauth_required", "authenticated"]),
          {
            delayed: false,
            superseding: [true, false],
          },
        );
        const [current] = await testDb.db
          .select()
          .from(ibkrGatewaySessionsTable)
          .where(eq(ibkrGatewaySessionsTable.id, fence.sessionId))
          .limit(1);
        assert.equal(current?.lifecycleState, "reauth_required");
        assert.equal(getGateway(appUserId)?.paperAccountVerified, false);
      },
    );
  },
);

test("a recovered authenticated fleet session re-verifies its paper account", async () => {
  let lifecycleDuringAccounts: string | null = null;
  await withFleetUser(
    {
      onAccounts: async (appUserId) => {
        const [session] = await db
          .select({ lifecycleState: ibkrGatewaySessionsTable.lifecycleState })
          .from(ibkrGatewaySessionsTable)
          .where(eq(ibkrGatewaySessionsTable.appUserId, appUserId))
          .limit(1);
        lifecycleDuringAccounts = session?.lifecycleState ?? null;
      },
    },
    async ({ appUserId, brokerConnectionId }) => {
      const acquired = await tryAcquireIbkrGatewayLease({
        appUserId,
        brokerConnectionId,
      });
      assert.equal(acquired.status, "acquired");
      if (acquired.status !== "acquired") return;
      for (const state of [
        "login_required",
        "verifying",
        "authenticated",
      ] as const) {
        assert.equal(
          await transitionIbkrGatewayLifecycle(acquired.fence, state),
          true,
        );
      }
      assert.equal(getGateway(appUserId), null);

      const quietReadiness = await readPortalReadiness(appUserId);
      assert.equal(quietReadiness.status, "needs_login");
      __expirePortalReadinessQuietWindowForTests(appUserId);
      const readiness = await readPortalReadiness(appUserId);
      assert.equal(readiness.status, "connected");
      assert.equal(lifecycleDuringAccounts, "verifying");
      const [recovered] = await db
        .select()
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, acquired.fence.sessionId))
        .limit(1);
      assert.equal(recovered?.lifecycleState, "authenticated");
      assert.equal(getGateway(appUserId)?.paperAccountVerified, true);
    },
  );
});
