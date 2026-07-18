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
  transitionIbkrGatewayLifecycle as transitionDurableIbkrGatewayLifecycle,
  type IbkrGatewayFence,
} from "./ibkr-gateway-session-store";
import {
  __ibkrPortalGatewayManagerInternalsForTests,
  __setIbkrGatewayFleetCoordinationDependenciesForTests,
  ensureGateway,
  getGateway,
  noteIbkrGatewayFleetHostReady,
  startIbkrGatewayFleetCoordinator,
  stopIbkrGatewayFleetCoordinator,
  stopGateway,
} from "./ibkr-portal-gateway-manager";

const fakeFence = (index: number): IbkrGatewayFence => {
  const suffix = String(index + 1).padStart(12, "0");
  return {
    appUserId: `10000000-0000-4000-8000-${suffix}`,
    brokerConnectionId: `20000000-0000-4000-8000-${suffix}`,
    generation: 1,
    hostId: `30000000-0000-4000-8000-${suffix}`,
    leaseHolderId: `40000000-0000-4000-8000-${suffix}`,
    sessionId: `50000000-0000-4000-8000-${suffix}`,
    slotNumber: (index % 20) + 1,
  };
};

test("fleet coordinator is inert when fleet control keys are absent", async () => {
  const names = [
    "IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY",
    "IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY",
    "IBKR_GATEWAY_FLEET_ENABLED",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  let listCalls = 0;
  delete process.env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"];
  delete process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"];
  delete process.env["IBKR_GATEWAY_FLEET_ENABLED"];
  __setIbkrGatewayFleetCoordinationDependenciesForTests({
    listRenewableFences: async () => {
      listCalls += 1;
      return [fakeFence(0)];
    },
  });
  try {
    await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
  } finally {
    __setIbkrGatewayFleetCoordinationDependenciesForTests(null);
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.equal(listCalls, 0);
});

test("fleet coordinator bounds concurrent sweeps and treats lock contention as a skip", async () => {
  const fences = Array.from({ length: 21 }, (_, index) => fakeFence(index));
  const lockKeys: number[] = [];
  let activeAcquires = 0;
  let maxActiveAcquires = 0;
  let transitions = 0;
  const previousEnabled = process.env["IBKR_GATEWAY_FLEET_ENABLED"];
  const previousRootKey = process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"];
  process.env["IBKR_GATEWAY_FLEET_ENABLED"] = "1";
  process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"] = Buffer.alloc(
    32,
    41,
  ).toString("base64url");
  __setIbkrGatewayFleetCoordinationDependenciesForTests({
    acquireControlLock: async (key) => {
      lockKeys.push(key);
      activeAcquires += 1;
      maxActiveAcquires = Math.max(maxActiveAcquires, activeAcquires);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeAcquires -= 1;
      return null;
    },
    listRenewableFences: async () => fences,
    transitionLifecycle: async () => {
      transitions += 1;
      return true;
    },
  });
  fences.forEach((fence) => noteIbkrGatewayFleetHostReady(fence.hostId));
  try {
    await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
  } finally {
    __setIbkrGatewayFleetCoordinationDependenciesForTests(null);
    if (previousRootKey === undefined) {
      delete process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"];
    } else {
      process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"] = previousRootKey;
    }
    if (previousEnabled === undefined) {
      delete process.env["IBKR_GATEWAY_FLEET_ENABLED"];
    } else {
      process.env["IBKR_GATEWAY_FLEET_ENABLED"] = previousEnabled;
    }
  }

  assert.equal(lockKeys.length, 20);
  assert.equal(new Set(lockKeys).size, 20);
  assert.equal(
    lockKeys.every((key) => Number.isSafeInteger(key) && key < 0),
    true,
  );
  assert.ok(maxActiveAcquires > 1);
  assert.equal(transitions, 0);
});

test("fleet coordinator holds each session lock through ack and drains only a failed matching fence", async () => {
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
    const hostId = "00000000-0000-4000-8000-000000000030";
    const rootKey = Buffer.alloc(32, 30);
    const hostKey = deriveIbkrHostControlKey(rootKey, hostId);
    const sha = `sha256:${"3".repeat(64)}`;
    const workloadIdentityDigest = "4".repeat(64);
    let phase:
      | "setup"
      | "success"
      | "transient_failure"
      | "terminal_failure"
      | "shutdown_failure" = "setup";
    let failingSessionId: string | null = null;
    let activeKeepalives = 0;
    let keepaliveRequests = 0;
    let maxActiveKeepalives = 0;
    let successKeepalivesEntered = 0;
    let releaseConcurrentKeepalives!: () => void;
    const concurrentKeepalives = new Promise<void>((resolve) => {
      releaseConcurrentKeepalives = resolve;
    });
    let enterShutdownKeepalive!: () => void;
    const shutdownKeepaliveEntered = new Promise<void>((resolve) => {
      enterShutdownKeepalive = resolve;
    });
    let rejectShutdownKeepalive!: () => void;
    const shutdownKeepaliveRejected = new Promise<void>((resolve) => {
      rejectShutdownKeepalive = resolve;
    });
    const sessionByLockKey = new Map<number, string>();
    const releasedAcknowledgedSessions: string[] = [];
    const transitions: Array<{
      fence: IbkrGatewayFence;
      target: string;
    }> = [];
    let hostGrantNotAfterNs = 50_000_000_000n;
    const issueHostLease = () => {
      const lease = {
        version: 1 as const,
        bootId: "30303030-3030-4030-8030-303030303030",
        grantNotAfterNs: String(hostGrantNotAfterNs),
      };
      hostGrantNotAfterNs += 1_000_000_000n;
      return lease;
    };

    process.env["IBKR_GATEWAY_FLEET_ENABLED"] = "1";
    process.env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"] =
      rootKey.toString("base64url");
    delete process.env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"];
    delete process.env["IBKR_SESSION_HOST_ENABLED"];
    process.env["TRADING_MODE"] = "shadow";

    const signedControlResponse = (
      action: IbkrHostControlAction,
      controlAttemptId: string,
      body: Record<string, unknown>,
      status = 200,
    ): Response => {
      const payload = JSON.stringify({ action, controlAttemptId, ...body });
      return new Response(payload, {
        status,
        headers: {
          "content-type": "application/json",
          ...signIbkrHostControlReceipt({
            action,
            body: payload,
            controlAttemptId,
            hostId,
            key: hostKey,
            status,
          }),
        },
      });
    };

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      const route = url.pathname.match(
        /^\/sessions\/([^/]+)\/generations\/(\d+)\/slots\/(\d+)\/(ensure|keepalive|release|status)$/,
      );
      assert.ok(route);
      const action = route[4] as IbkrHostControlAction;
      const controlAttemptId = url.searchParams.get("controlAttemptId");
      assert.ok(controlAttemptId);
      assert.equal(String(init?.body ?? ""), "");
      const receipt = {
        sessionId: route[1]!,
        generation: Number(route[2]),
        slotNumber: Number(route[3]),
      };
      if (action === "keepalive") {
        keepaliveRequests += 1;
        if (
          phase === "transient_failure" &&
          receipt.sessionId === failingSessionId
        ) {
          throw new Error("synthetic keepalive failure");
        }
        if (
          phase === "terminal_failure" &&
          receipt.sessionId === failingSessionId
        ) {
          return signedControlResponse(
            action,
            controlAttemptId,
            {
              error: {
                code: "session_not_found",
                message: "IBKR session control failed.",
              },
            },
            404,
          );
        }
        if (
          phase === "shutdown_failure" &&
          receipt.sessionId === failingSessionId
        ) {
          enterShutdownKeepalive();
          await shutdownKeepaliveRejected;
          throw new Error("synthetic shutdown keepalive failure");
        }
        const lease = issueHostLease();
        if (phase === "success") {
          activeKeepalives += 1;
          maxActiveKeepalives = Math.max(maxActiveKeepalives, activeKeepalives);
          successKeepalivesEntered += 1;
          if (successKeepalivesEntered === 2) {
            releaseConcurrentKeepalives();
          }
          await Promise.race([
            concurrentKeepalives,
            new Promise<void>((resolve) => setTimeout(resolve, 100)),
          ]);
          activeKeepalives -= 1;
        }
        return signedControlResponse(action, controlAttemptId, {
          ...receipt,
          keptAlive: true,
          lease: {
            version: lease.version,
            bootId: lease.bootId,
            grantNotAfterNs: lease.grantNotAfterNs,
          },
        });
      }
      if (action === "release") {
        return signedControlResponse(action, controlAttemptId, {
          ...receipt,
          released: true,
        });
      }
      assert.equal(action, "ensure");
      const lease = issueHostLease();
      return signedControlResponse(action, controlAttemptId, {
        ...receipt,
        capsule: {
          loginCompletions: 0,
          name: `pyrus-ibkr-slot-${receipt.slotNumber}`,
          status: "ready",
        },
        lease,
        targets: {
          cpg: { host: "127.0.0.1", port: 15_000 + receipt.slotNumber },
          console: { host: "127.0.0.1", port: 16_000 + receipt.slotNumber },
        },
      });
    }) as typeof fetch;

    __setIbkrGatewayFleetCoordinationDependenciesForTests({
      acquireControlLock: async () => async () => {},
    });

    let userIds: string[] = [];
    try {
      assert.ok(
        await registerIbkrGatewayHost({
          hostId,
          workloadIdentityDigest,
          controlOrigin: "https://host-thirty.example.invalid",
          imageDigest: sha,
          runtimeSpecDigest: sha,
          runtimeAttestationDigest: sha,
          capsuleLeaseProtocolVersion: 1,
          failureDomain: "synthetic-zone-thirty",
          measuredSlotCapacity: 2,
        }),
      );
      assert.ok(
        await approveIbkrGatewayHost({
          hostId,
          workloadIdentityDigest,
          imageDigest: sha,
          runtimeSpecDigest: sha,
          runtimeAttestationDigest: sha,
          capsuleLeaseProtocolVersion: 1,
          admissionSlotCapacity: 2,
        }),
      );
      const users = await db
        .insert(usersTable)
        .values([
          {
            email: "synthetic-fleet-coordinator-a@example.invalid",
            passwordHash: "synthetic-unused-hash",
          },
          {
            email: "synthetic-fleet-coordinator-b@example.invalid",
            passwordHash: "synthetic-unused-hash",
          },
        ])
        .returning({ id: usersTable.id });
      assert.equal(users.length, 2);
      userIds = users.map((user) => user.id);

      await Promise.all(userIds.map((userId) => ensureGateway(userId)));
      const fences = await Promise.all(
        userIds.map(async (appUserId) => {
          const connection = await ensureIbkrGatewayBrokerConnection({
            appUserId,
            mode: "shadow",
          });
          assert.ok(connection);
          const fence = await readCurrentIbkrGatewayFence({
            appUserId,
            brokerConnectionId: connection.id,
          });
          assert.ok(fence);
          return fence;
        }),
      );
      assert.deepEqual(
        await Promise.all(
          fences.map((fence) =>
            transitionDurableIbkrGatewayLifecycle(fence, "login_required"),
          ),
        ),
        [true, true],
      );
      fences.forEach((fence) => {
        sessionByLockKey.set(
          __ibkrPortalGatewayManagerInternalsForTests.fleetControlLockKey(
            fence.sessionId,
          ),
          fence.sessionId,
        );
      });

      const requestsBeforeReadiness = keepaliveRequests;
      startIbkrGatewayFleetCoordinator();
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      assert.equal(
        keepaliveRequests,
        requestsBeforeReadiness,
        "startup must not trust a heartbeat persisted before this process",
      );
      noteIbkrGatewayFleetHostReady(hostId);
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      assert.equal(keepaliveRequests, requestsBeforeReadiness + 2);
      await stopIbkrGatewayFleetCoordinator();
      noteIbkrGatewayFleetHostReady(hostId);

      __setIbkrGatewayFleetCoordinationDependenciesForTests({
        acquireControlLock: async (key) => async () => {
          const sessionId = sessionByLockKey.get(key);
          assert.ok(sessionId);
          const [session] = await db
            .select({
              controlAcknowledgedAt:
                ibkrGatewaySessionsTable.controlAcknowledgedAt,
            })
            .from(ibkrGatewaySessionsTable)
            .where(eq(ibkrGatewaySessionsTable.id, sessionId))
            .limit(1);
          assert.ok(session?.controlAcknowledgedAt);
          releasedAcknowledgedSessions.push(sessionId);
        },
        listRenewableFences: async () => fences,
        transitionLifecycle: async (fence, target) => {
          transitions.push({ fence, target });
          return transitionDurableIbkrGatewayLifecycle(fence, target);
        },
      });
      phase = "success";
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      assert.equal(maxActiveKeepalives, 2);
      assert.deepEqual(
        new Set(releasedAcknowledgedSessions.slice(-2)),
        new Set(fences.map((fence) => fence.sessionId)),
      );
      assert.equal(
        userIds.every((userId) => getGateway(userId) !== null),
        true,
      );

      __setIbkrGatewayFleetCoordinationDependenciesForTests({
        acquireControlLock: async () => null,
        listRenewableFences: async () => [fences[0]!],
        transitionLifecycle: async (fence, target) => {
          transitions.push({ fence, target });
          return transitionDurableIbkrGatewayLifecycle(fence, target);
        },
      });
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      assert.equal(transitions.length, 0);
      assert.ok(getGateway(userIds[0]!));

      __setIbkrGatewayFleetCoordinationDependenciesForTests({
        acquireControlLock: async () => async () => {},
        listRenewableFences: async () => [fences[0]!],
        transitionLifecycle: async (fence, target) => {
          transitions.push({ fence, target });
          return transitionDurableIbkrGatewayLifecycle(fence, target);
        },
      });
      phase = "transient_failure";
      failingSessionId = fences[0]!.sessionId;
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      assert.equal(
        transitions.length,
        0,
        "an unsigned transport failure must not mutate durable lifecycle",
      );
      assert.ok(getGateway(userIds[0]));

      phase = "success";
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      assert.equal(transitions.length, 0);
      assert.ok(getGateway(userIds[0]));

      phase = "shutdown_failure";
      failingSessionId = fences[1]!.sessionId;
      __setIbkrGatewayFleetCoordinationDependenciesForTests({
        acquireControlLock: async () => async () => {},
        listRenewableFences: async () => [fences[1]!],
        transitionLifecycle: async (fence, target) => {
          transitions.push({ fence, target });
          return transitionDurableIbkrGatewayLifecycle(fence, target);
        },
      });
      startIbkrGatewayFleetCoordinator();
      await shutdownKeepaliveEntered;
      let stopSettled = false;
      const stopping = Promise.resolve(stopIbkrGatewayFleetCoordinator()).then(
        () => {
          stopSettled = true;
        },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      const stoppedBeforeKeepaliveSettled = stopSettled;
      rejectShutdownKeepalive();
      await stopping;
      assert.equal(
        stoppedBeforeKeepaliveSettled,
        false,
        "stop must wait for the active coordinator sweep",
      );
      assert.equal(
        transitions.length,
        0,
        "a sweep invalidated by shutdown must not persist draining",
      );
      assert.ok(getGateway(userIds[1]));

      noteIbkrGatewayFleetHostReady(hostId);
      __setIbkrGatewayFleetCoordinationDependenciesForTests({
        acquireControlLock: async () => async () => {},
        listRenewableFences: async () => [fences[0]!],
        transitionLifecycle: async (fence, target) => {
          transitions.push({ fence, target });
          return transitionDurableIbkrGatewayLifecycle(fence, target);
        },
      });
      phase = "terminal_failure";
      failingSessionId = fences[0]!.sessionId;
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      assert.deepEqual(transitions, [
        { fence: fences[0]!, target: "draining" },
      ]);
      const [draining] = await db
        .select({ lifecycleState: ibkrGatewaySessionsTable.lifecycleState })
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, fences[0]!.sessionId))
        .limit(1);
      assert.equal(draining?.lifecycleState, "draining");
      assert.equal(getGateway(userIds[0]!), null);
      assert.ok(getGateway(userIds[1]!));

      __setIbkrGatewayFleetCoordinationDependenciesForTests({
        acquireControlLock: async () => async () => {},
        listRenewableFences: async () => [fences[1]!],
        transitionLifecycle: async (fence, target) => {
          transitions.push({ fence, target });
          return transitionDurableIbkrGatewayLifecycle(fence, target);
        },
      });
      phase = "transient_failure";
      failingSessionId = fences[1]!.sessionId;
      const retryDeadline = new Date(Date.now() + 60_000);
      await db
        .update(ibkrGatewaySessionsTable)
        .set({ replacementDeadlineAt: retryDeadline })
        .where(eq(ibkrGatewaySessionsTable.id, fences[1]!.sessionId));
      const requestsBeforeRecovery = keepaliveRequests;
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      noteIbkrGatewayFleetHostReady(hostId);
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      assert.equal(
        keepaliveRequests,
        requestsBeforeRecovery + 2,
        "transient failures must remain eligible for a later retry",
      );
      const [failedRetry] = await db
        .select({
          replacementDeadlineAt: ibkrGatewaySessionsTable.replacementDeadlineAt,
        })
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, fences[1]!.sessionId))
        .limit(1);
      assert.equal(
        failedRetry?.replacementDeadlineAt?.getTime(),
        retryDeadline.getTime(),
        "unacknowledged keepalives must not extend the replacement deadline",
      );

      phase = "success";
      noteIbkrGatewayFleetHostReady(hostId);
      await __ibkrPortalGatewayManagerInternalsForTests.runFleetCoordinatorOnce();
      assert.equal(
        keepaliveRequests,
        requestsBeforeRecovery + 3,
        "a recovered host must be retried after two transient failures",
      );
      const [recoveredRetry] = await db
        .select({
          replacementDeadlineAt: ibkrGatewaySessionsTable.replacementDeadlineAt,
        })
        .from(ibkrGatewaySessionsTable)
        .where(eq(ibkrGatewaySessionsTable.id, fences[1]!.sessionId))
        .limit(1);
      assert.ok(
        (recoveredRetry?.replacementDeadlineAt?.getTime() ?? 0) >
          retryDeadline.getTime(),
        "an acknowledged keepalive must extend the replacement deadline",
      );
      assert.deepEqual(transitions, [
        { fence: fences[0]!, target: "draining" },
      ]);
      assert.ok(getGateway(userIds[1]));
    } finally {
      phase = "setup";
      failingSessionId = null;
      await stopIbkrGatewayFleetCoordinator();
      __setIbkrGatewayFleetCoordinationDependenciesForTests({
        acquireControlLock: async () => async () => {},
      });
      for (const userId of userIds) {
        await stopGateway(userId).catch(() => undefined);
      }
      __setIbkrGatewayFleetCoordinationDependenciesForTests(null);
      globalThis.fetch = previousFetch;
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

test("host lease grant validation accepts only the exact signed 64-bit range", () => {
  const bootId = "00000000-0000-4000-8000-000000000031";
  const valid = (grantNotAfterNs: string) =>
    __ibkrPortalGatewayManagerInternalsForTests.hostLeaseGrantIsValid({
      version: 1,
      bootId,
      grantNotAfterNs,
    });

  assert.equal(valid("1"), true);
  assert.equal(valid("9223371916854775807"), true);
  assert.equal(valid("0"), false);
  assert.equal(valid("9223371916854775808"), false);
});
