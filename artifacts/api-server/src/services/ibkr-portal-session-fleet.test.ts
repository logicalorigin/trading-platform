import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveIbkrHostControlKey,
  signIbkrHostControlReceipt,
  type IbkrHostControlAction,
} from "@workspace/ibkr-contracts/control-auth";
import { db, ibkrGatewaySessionsTable, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import {
  approveIbkrGatewayHost,
  ensureIbkrGatewayBrokerConnection,
  readCurrentIbkrGatewayFence,
  registerIbkrGatewayHost,
} from "./ibkr-gateway-session-store";
import { ensureGateway, getGateway } from "./ibkr-portal-gateway-manager";
import { disconnectPortal, readPortalReadiness } from "./ibkr-portal-session";

test("fleet portal persists paper lifecycle and disconnects mixed accounts", async () => {
  await withTestDb(async () => {
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
    const hostId = "00000000-0000-4000-8000-000000000019";
    const sha = `sha256:${"9".repeat(64)}`;
    const workloadIdentityDigest = "8".repeat(64);
    let authMode: "authenticated" | "failure" | "unauthenticated" =
      "authenticated";
    let accountMode: "mixed" | "paper" = "paper";
    let accountReads = 0;
    let appUserId: string | null = null;
    let lifecycleDuringAccounts: string | null = null;
    const rootKey = Buffer.alloc(32, 29);
    const hostKey = deriveIbkrHostControlKey(rootKey, hostId);
    const signedControlResponse = (
      action: IbkrHostControlAction,
      controlAttemptId: string,
      value: Record<string, unknown>,
      status = 200,
    ): Response => {
      const body = JSON.stringify({ ...value, action, controlAttemptId });
      return new Response(body, {
        status,
        headers: {
          "content-type": "application/json",
          ...signIbkrHostControlReceipt({
            action,
            body,
            controlAttemptId,
            hostId,
            key: hostKey,
            status,
          }),
        },
      });
    };

    process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"] =
      rootKey.toString("base64url");
    delete process.env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"];
    process.env["IBKR_GATEWAY_FLEET_ENABLED"] = "1";
    delete process.env["IBKR_SESSION_HOST_ENABLED"];
    process.env["TRADING_MODE"] = "shadow";

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      const controlRequest = url.pathname.match(
        /^\/sessions\/([^/]+)\/generations\/(\d+)\/slots\/(\d+)\/(ensure|release|status)$/,
      );
      let controlAttemptId: string | null = null;
      if (controlRequest) {
        const attempts = url.searchParams.getAll("controlAttemptId");
        assert.equal(attempts.length, 1);
        controlAttemptId = attempts[0]!;
        assert.equal(url.search, `?controlAttemptId=${controlAttemptId}`);
      }
      const receipt = controlRequest
        ? {
            sessionId: decodeURIComponent(controlRequest[1]!),
            generation: Number(controlRequest[2]),
            slotNumber: Number(controlRequest[3]),
          }
        : null;
      if (url.pathname.endsWith("/ensure")) {
        assert.ok(receipt);
        assert.ok(controlAttemptId);
        return signedControlResponse("ensure", controlAttemptId, {
          ...receipt,
          capsule: {
            loginCompletions: 0,
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
        assert.ok(receipt);
        assert.ok(controlAttemptId);
        return signedControlResponse("status", controlAttemptId, {
          ...receipt,
          capsule: {
            loginCompletions: 0,
            name: "pyrus-ibkr-slot-1",
            status: "ready",
          },
          targets: {
            cpg: { host: "127.0.0.1", port: 15000 },
            console: { host: "127.0.0.1", port: 16080 },
          },
        });
      }
      if (url.pathname.endsWith("/data/cpg/v1/api/iserver/auth/status")) {
        assert.equal(init?.method, "POST");
        if (authMode === "failure") {
          return Response.json(
            { error: "synthetic unavailable" },
            { status: 503 },
          );
        }
        if (authMode === "unauthenticated") {
          return Response.json({
            authenticated: false,
            connected: false,
            established: false,
          });
        }
        return Response.json({
          authenticated: true,
          connected: true,
          established: true,
          isPaper: true,
          selectedAccount: "DU1234567",
        });
      }
      if (url.pathname.endsWith("/data/cpg/v1/api/iserver/accounts")) {
        accountReads += 1;
        assert.ok(appUserId);
        const [session] = await db
          .select({ lifecycleState: ibkrGatewaySessionsTable.lifecycleState })
          .from(ibkrGatewaySessionsTable)
          .where(eq(ibkrGatewaySessionsTable.appUserId, appUserId))
          .limit(1);
        lifecycleDuringAccounts = session?.lifecycleState ?? null;
        return Response.json({
          accounts:
            accountMode === "mixed" ? ["DU1234567", "U7654321"] : ["DU1234567"],
          isPaper: accountMode === "paper",
          selectedAccount: "DU1234567",
        });
      }
      if (controlRequest?.[4] === "release") {
        assert.ok(receipt);
        assert.ok(controlAttemptId);
        return signedControlResponse("release", controlAttemptId, {
          ...receipt,
          released: true,
        });
      }
      throw new Error(`unexpected fleet request: ${url.pathname}`);
    }) as typeof fetch;

    try {
      const [user] = await db
        .insert(usersTable)
        .values({
          email: "synthetic-portal-fleet-paper@example.invalid",
          passwordHash: "synthetic-unused-hash",
        })
        .returning({ id: usersTable.id });
      assert.ok(user);
      appUserId = user.id;
      assert.ok(
        await registerIbkrGatewayHost({
          hostId,
          workloadIdentityDigest,
          controlOrigin: "https://host-nineteen.example.invalid",
          imageDigest: sha,
          runtimeSpecDigest: sha,
          runtimeAttestationDigest: sha,
          failureDomain: "synthetic-zone-nineteen",
          measuredSlotCapacity: 1,
        }),
      );
      assert.ok(
        await approveIbkrGatewayHost({
          hostId,
          workloadIdentityDigest,
          imageDigest: sha,
          runtimeSpecDigest: sha,
          runtimeAttestationDigest: sha,
          admissionSlotCapacity: 1,
        }),
      );

      await ensureGateway(user.id);
      const connection = await ensureIbkrGatewayBrokerConnection({
        appUserId: user.id,
        mode: "shadow",
      });
      assert.ok(connection);
      const fence = await readCurrentIbkrGatewayFence({
        appUserId: user.id,
        brokerConnectionId: connection.id,
      });
      assert.ok(fence);

      const readiness = await readPortalReadiness(user.id);
      assert.equal(lifecycleDuringAccounts, "verifying");
      assert.equal(readiness.status, "connected");
      const [authenticatedSession] = await db
        .select()
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, fence.sessionId))
        .limit(1);
      assert.ok(authenticatedSession);
      assert.equal(authenticatedSession.lifecycleState, "authenticated");
      assert.equal(getGateway(user.id)?.paperAccountVerified, true);

      authMode = "unauthenticated";
      const accountReadsBeforeLoggedOut = accountReads;
      const loggedOutReadiness = await readPortalReadiness(user.id);
      assert.equal(loggedOutReadiness.status, "needs_login");
      const [reauthSession] = await db
        .select()
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, fence.sessionId))
        .limit(1);
      assert.ok(reauthSession);
      assert.equal(reauthSession.lifecycleState, "reauth_required");
      assert.equal(getGateway(user.id)?.paperAccountVerified, false);
      assert.equal(accountReads, accountReadsBeforeLoggedOut);

      authMode = "failure";
      const failedReadiness = await readPortalReadiness(user.id);
      assert.equal(failedReadiness.status, "needs_login");
      const [degradedSession] = await db
        .select()
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, fence.sessionId))
        .limit(1);
      assert.ok(degradedSession);
      assert.equal(degradedSession.lifecycleState, "degraded");
      assert.equal(getGateway(user.id)?.paperAccountVerified, false);

      authMode = "unauthenticated";
      const accountReadsBeforeRetry = accountReads;
      const retryLoggedOutReadiness = await readPortalReadiness(user.id);
      assert.equal(retryLoggedOutReadiness.status, "needs_login");
      const [retryReauthSession] = await db
        .select()
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, fence.sessionId))
        .limit(1);
      assert.ok(retryReauthSession);
      assert.equal(retryReauthSession.lifecycleState, "reauth_required");
      assert.equal(getGateway(user.id)?.paperAccountVerified, false);
      assert.equal(accountReads, accountReadsBeforeRetry);

      authMode = "authenticated";
      const recoveredReadiness = await readPortalReadiness(user.id);
      assert.equal(recoveredReadiness.status, "connected");
      const [recoveredSession] = await db
        .select()
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, fence.sessionId))
        .limit(1);
      assert.ok(recoveredSession);
      assert.equal(recoveredSession.lifecycleState, "authenticated");
      assert.equal(getGateway(user.id)?.paperAccountVerified, true);

      accountMode = "mixed";
      const rejectedReadiness = await readPortalReadiness(user.id);
      assert.equal(rejectedReadiness.status, "disconnected");
      assert.equal(getGateway(user.id), null);
      const [releasedSession] = await db
        .select()
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, fence.sessionId))
        .limit(1);
      assert.ok(releasedSession);
      assert.equal(releasedSession.lifecycleState, "released");
      assert.equal(releasedSession.generation, fence.generation + 1);
      assert.equal(releasedSession.hostId, null);
      assert.equal(releasedSession.slotNumber, null);
      assert.equal(releasedSession.leaseHolderId, null);
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
});
