import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerConnectionsTable,
  db,
  ibkrGatewaySessionsTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";
import {
  approveIbkrGatewayHost,
  assertCurrentIbkrGatewayFence,
  countActiveIbkrGatewayHostLeases,
  disableIbkrGatewayHost,
  ensureIbkrGatewayBrokerConnection,
  ensureIbkrGatewaySessionIdentity,
  heartbeatIbkrGatewayHost,
  readIbkrGatewayHost,
  readCurrentIbkrGatewayFence,
  registerIbkrGatewayHost,
  releaseIbkrGatewayLease,
  renewIbkrGatewayLease,
  resolveCurrentIbkrGatewayPlacement,
  transitionIbkrGatewayLifecycle,
  tryAcquireIbkrGatewayLease,
} from "./ibkr-gateway-session-store";

const HOST_A = "00000000-0000-4000-8000-000000000001";
const HOST_B = "00000000-0000-4000-8000-000000000002";
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const WORKLOAD_A = "c".repeat(64);
const WORKLOAD_B = "d".repeat(64);

test("creates one stable broker connection before gateway admission", async () => {
  await withTestDb(async () => {
    const [user] = await db
      .insert(usersTable)
      .values({
        email: "synthetic-ibkr-identity@example.invalid",
        passwordHash: "synthetic-unused-hash",
      })
      .returning({ id: usersTable.id });
    assert.ok(user);

    const first = await ensureIbkrGatewayBrokerConnection({
      appUserId: user.id,
      mode: "live",
    });
    const repeated = await ensureIbkrGatewayBrokerConnection({
      appUserId: user.id,
      mode: "live",
    });
    assert.ok(first);
    assert.equal(repeated?.id, first.id);
    assert.equal(first.name, "Interactive Brokers Bridge");
    assert.equal(first.status, "configured");
    assert.equal(first.brokerProvider, "ibkr");
    assert.equal(first.connectionType, "broker");

    const stored = await db
      .select()
      .from(brokerConnectionsTable)
      .where(eq(brokerConnectionsTable.appUserId, user.id));
    assert.equal(stored.length, 1);
    assert.equal(
      await ensureIbkrGatewayBrokerConnection({
        appUserId: "not-a-user",
        mode: "live",
      }),
      null,
    );
  });
});

type SyntheticIdentity = {
  appUserId: string;
  brokerConnectionId: string;
};

async function seedIdentities(count: number): Promise<SyntheticIdentity[]> {
  const users = await db
    .insert(usersTable)
    .values(
      Array.from({ length: count }, (_, index) => ({
        email: `synthetic-ibkr-fleet-${index}@example.invalid`,
        passwordHash: "synthetic-unused-hash",
      })),
    )
    .returning({ id: usersTable.id });
  const connections = await db
    .insert(brokerConnectionsTable)
    .values(
      users.map((user, index) => ({
        appUserId: user.id,
        name: `synthetic-ibkr-fleet-${index}`,
        connectionType: "broker" as const,
        brokerProvider: "ibkr" as const,
        mode: "live" as const,
      })),
    )
    .returning({ id: brokerConnectionsTable.id });

  return users.map((user, index) => ({
    appUserId: user.id,
    brokerConnectionId: connections[index]!.id,
  }));
}

async function registerAndApproveHost(input: {
  admissionSlotCapacity: number;
  hostId: string;
  measuredSlotCapacity?: number;
  workloadIdentityDigest: string;
  sha: string;
}): Promise<void> {
  const registered = await registerIbkrGatewayHost({
    hostId: input.hostId,
    workloadIdentityDigest: input.workloadIdentityDigest,
    controlOrigin: `https://${input.hostId === HOST_A ? "host-a" : "host-b"}.internal.invalid`,
    imageDigest: input.sha,
    runtimeSpecDigest: input.sha,
    runtimeAttestationDigest: input.sha,
    failureDomain: input.hostId === HOST_A ? "synthetic-a" : "synthetic-b",
    measuredSlotCapacity:
      input.measuredSlotCapacity ?? input.admissionSlotCapacity,
  });
  assert.ok(registered);
  assert.equal(registered.status, "quarantined");

  const approved = await approveIbkrGatewayHost({
    hostId: input.hostId,
    workloadIdentityDigest: input.workloadIdentityDigest,
    imageDigest: input.sha,
    runtimeSpecDigest: input.sha,
    runtimeAttestationDigest: input.sha,
    admissionSlotCapacity: input.admissionSlotCapacity,
  });
  assert.ok(approved);
  assert.equal(approved.status, "active");
}

test("host registration is idempotent, quarantined by default, and attestation-bound", async () => {
  await withTestDb(async () => {
    const registered = await registerIbkrGatewayHost({
      hostId: HOST_A,
      workloadIdentityDigest: WORKLOAD_A,
      controlOrigin: "https://host-a.internal.invalid/",
      imageDigest: SHA_A,
      runtimeSpecDigest: SHA_A,
      runtimeAttestationDigest: SHA_A,
      failureDomain: "synthetic-a",
      measuredSlotCapacity: 2,
    });
    assert.ok(registered);
    assert.equal(registered.controlOrigin, "https://host-a.internal.invalid");
    assert.equal(registered.status, "quarantined");
    assert.equal(registered.admissionSlotCapacity, 1);
    assert.equal((await readIbkrGatewayHost(HOST_A))?.id, HOST_A);
    assert.equal(await readIbkrGatewayHost("not-a-host"), null);
    assert.equal(await countActiveIbkrGatewayHostLeases(HOST_A), 0);
    assert.equal(await countActiveIbkrGatewayHostLeases("not-a-host"), null);

    const repeated = await registerIbkrGatewayHost({
      hostId: HOST_A,
      workloadIdentityDigest: WORKLOAD_A,
      controlOrigin: "https://host-a.internal.invalid",
      imageDigest: SHA_A,
      runtimeSpecDigest: SHA_A,
      runtimeAttestationDigest: SHA_A,
      failureDomain: "synthetic-a",
      measuredSlotCapacity: 2,
    });
    assert.equal(repeated?.id, HOST_A);

    assert.equal(
      await registerIbkrGatewayHost({
        hostId: HOST_A,
        workloadIdentityDigest: WORKLOAD_A,
        controlOrigin: "https://host-a.internal.invalid",
        imageDigest: SHA_B,
        runtimeSpecDigest: SHA_A,
        runtimeAttestationDigest: SHA_A,
        failureDomain: "synthetic-a",
        measuredSlotCapacity: 2,
      }),
      null,
    );
    assert.equal(
      await approveIbkrGatewayHost({
        hostId: HOST_A,
        workloadIdentityDigest: WORKLOAD_A,
        imageDigest: SHA_B,
        runtimeSpecDigest: SHA_A,
        runtimeAttestationDigest: SHA_A,
        admissionSlotCapacity: 2,
      }),
      null,
    );

    const approved = await approveIbkrGatewayHost({
      hostId: HOST_A,
      workloadIdentityDigest: WORKLOAD_A,
      imageDigest: SHA_A,
      runtimeSpecDigest: SHA_A,
      runtimeAttestationDigest: SHA_A,
      admissionSlotCapacity: 2,
    });
    assert.equal(approved?.status, "active");
    assert.equal(approved?.admissionSlotCapacity, 2);

    assert.equal(
      await heartbeatIbkrGatewayHost({
        hostId: HOST_A,
        verifiedWorkloadIdentityDigest: WORKLOAD_B,
        runtimeAttestationDigest: SHA_A,
      }),
      null,
    );
    assert.ok(
      await heartbeatIbkrGatewayHost({
        hostId: HOST_A,
        verifiedWorkloadIdentityDigest: WORKLOAD_A,
        runtimeAttestationDigest: SHA_A,
      }),
    );
  });
});

test("host registration permits only exact loopback HTTP control origins", async () => {
  await withTestDb(async () => {
    const registration = {
      hostId: HOST_A,
      workloadIdentityDigest: WORKLOAD_A,
      imageDigest: SHA_A,
      runtimeSpecDigest: SHA_A,
      runtimeAttestationDigest: SHA_A,
      failureDomain: "synthetic-loopback",
      measuredSlotCapacity: 1,
    };
    for (const controlOrigin of [
      "http://localhost:18748",
      "http://127.0.0.2:18748",
      "http://host-a.internal.invalid:18748",
      "http://127.0.0.1:18748/control",
      "http://user@127.0.0.1:18748",
    ]) {
      assert.equal(
        await registerIbkrGatewayHost({ ...registration, controlOrigin }),
        null,
        controlOrigin,
      );
    }

    const ipv4 = await registerIbkrGatewayHost({
      ...registration,
      controlOrigin: "http://127.0.0.1:18748/",
    });
    assert.equal(ipv4?.controlOrigin, "http://127.0.0.1:18748");

    const ipv6 = await registerIbkrGatewayHost({
      ...registration,
      hostId: HOST_B,
      workloadIdentityDigest: WORKLOAD_B,
      controlOrigin: "http://[::1]:18748/",
    });
    assert.equal(ipv6?.controlOrigin, "http://[::1]:18748");
  });
});

test("measured host slots and the global ceiling admit at most twenty distinct owner-bound sessions", async () => {
  await withTestDb(async () => {
    await registerAndApproveHost({
      hostId: HOST_A,
      workloadIdentityDigest: WORKLOAD_A,
      sha: SHA_A,
      admissionSlotCapacity: 2,
      measuredSlotCapacity: 20,
    });
    await registerAndApproveHost({
      hostId: HOST_B,
      workloadIdentityDigest: WORKLOAD_B,
      sha: SHA_B,
      admissionSlotCapacity: 1,
      measuredSlotCapacity: 20,
    });
    const identities = await seedIdentities(21);
    for (const identity of identities) {
      assert.ok(await ensureIbkrGatewaySessionIdentity(identity));
    }

    const results = [];
    for (const identity of identities.slice(0, 4)) {
      results.push(await tryAcquireIbkrGatewayLease(identity));
    }
    const acquired = results.filter(
      (result) => result.status === "acquired",
    );
    assert.equal(acquired.length, 3);
    assert.equal(results.filter((result) => result.status === "busy").length, 1);

    assert.ok(
      await approveIbkrGatewayHost({
        hostId: HOST_A,
        workloadIdentityDigest: WORKLOAD_A,
        imageDigest: SHA_A,
        runtimeSpecDigest: SHA_A,
        runtimeAttestationDigest: SHA_A,
        admissionSlotCapacity: 20,
      }),
    );
    assert.ok(
      await approveIbkrGatewayHost({
        hostId: HOST_B,
        workloadIdentityDigest: WORKLOAD_B,
        imageDigest: SHA_B,
        runtimeSpecDigest: SHA_B,
        runtimeAttestationDigest: SHA_B,
        admissionSlotCapacity: 20,
      }),
    );
    for (const identity of identities.slice(4)) {
      results.push(await tryAcquireIbkrGatewayLease(identity));
    }
    assert.equal(
      results.filter((result) => result.status === "acquired").length,
      20,
    );
    assert.equal(results.filter((result) => result.status === "busy").length, 1);

    const allAcquired = results.filter(
      (result) => result.status === "acquired",
    );
    assert.equal(
      new Set(
        allAcquired.map(
          (result) => `${result.fence.hostId}:${result.fence.slotNumber}`,
        ),
      ).size,
      20,
    );

    for (const result of allAcquired) {
      const placement = await resolveCurrentIbkrGatewayPlacement(result.fence);
      assert.ok(placement);
      assert.equal(placement.hostId, result.fence.hostId);
      assert.equal(placement.slotNumber, result.fence.slotNumber);
      assert.match(placement.controlOrigin, /^https:\/\//);
      assert.equal("cpgPort" in placement, false);
      assert.equal("viewerPort" in placement, false);
    }
  });
});

test("draining blocks new placement while quarantine synchronously fences existing work", async () => {
  await withTestDb(async () => {
    await registerAndApproveHost({
      hostId: HOST_A,
      workloadIdentityDigest: WORKLOAD_A,
      sha: SHA_A,
      admissionSlotCapacity: 1,
    });
    await registerAndApproveHost({
      hostId: HOST_B,
      workloadIdentityDigest: WORKLOAD_B,
      sha: SHA_B,
      admissionSlotCapacity: 1,
    });
    const [identityA, identityB] = await seedIdentities(2);
    assert.ok(identityA);
    assert.ok(identityB);
    assert.ok(await ensureIbkrGatewaySessionIdentity(identityA));
    assert.ok(await ensureIbkrGatewaySessionIdentity(identityB));

    const first = await tryAcquireIbkrGatewayLease(identityA);
    assert.equal(first.status, "acquired");
    if (first.status !== "acquired") return;
    assert.equal(first.fence.hostId, HOST_A);
    assert.deepEqual(await readCurrentIbkrGatewayFence(identityA), first.fence);
    assert.equal(await countActiveIbkrGatewayHostLeases(HOST_A), 1);

    assert.ok(await disableIbkrGatewayHost(HOST_A, "draining"));
    assert.equal(await assertCurrentIbkrGatewayFence(first.fence), true);
    assert.ok(await renewIbkrGatewayLease(first.fence));

    const second = await tryAcquireIbkrGatewayLease(identityB);
    assert.equal(second.status, "acquired");
    if (second.status !== "acquired") return;
    assert.equal(second.fence.hostId, HOST_B);

    assert.ok(await disableIbkrGatewayHost(HOST_A, "quarantined"));
    assert.equal(await assertCurrentIbkrGatewayFence(first.fence), false);
    assert.equal(await readCurrentIbkrGatewayFence(identityA), null);
    assert.equal(await renewIbkrGatewayLease(first.fence), null);

    assert.equal(await releaseIbkrGatewayLease(second.fence), true);
    const replacement = await tryAcquireIbkrGatewayLease(identityA);
    assert.equal(replacement.status, "acquired");
    if (replacement.status !== "acquired") return;
    assert.equal(replacement.fence.hostId, HOST_B);
    assert.equal(replacement.fence.generation, first.fence.generation + 1);
    assert.equal(await assertCurrentIbkrGatewayFence(first.fence), false);
  });
});

test("expired leases free host slots and every takeover advances the generation fence", async () => {
  await withTestDb(async () => {
    await registerAndApproveHost({
      hostId: HOST_A,
      workloadIdentityDigest: WORKLOAD_A,
      sha: SHA_A,
      admissionSlotCapacity: 1,
    });
    const [identity] = await seedIdentities(1);
    assert.ok(identity);
    const session = await ensureIbkrGatewaySessionIdentity(identity);
    assert.ok(session);
    const first = await tryAcquireIbkrGatewayLease(identity);
    assert.equal(first.status, "acquired");
    if (first.status !== "acquired") return;

    await db
      .update(ibkrGatewaySessionsTable)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(ibkrGatewaySessionsTable.id, session.id));

    const replacement = await tryAcquireIbkrGatewayLease(identity);
    assert.equal(replacement.status, "acquired");
    if (replacement.status !== "acquired") return;
    assert.equal(replacement.fence.generation, first.fence.generation + 1);
    assert.notEqual(replacement.fence.leaseHolderId, first.fence.leaseHolderId);
    assert.equal(await assertCurrentIbkrGatewayFence(first.fence), false);
  });
});

test("lifecycle transitions are ordered, idempotent, and exact-generation fenced", async () => {
  await withTestDb(async () => {
    await registerAndApproveHost({
      hostId: HOST_A,
      workloadIdentityDigest: WORKLOAD_A,
      sha: SHA_A,
      admissionSlotCapacity: 1,
    });
    const [identity] = await seedIdentities(1);
    assert.ok(identity);
    const session = await ensureIbkrGatewaySessionIdentity(identity);
    assert.ok(session);
    const first = await tryAcquireIbkrGatewayLease(identity);
    assert.equal(first.status, "acquired");
    if (first.status !== "acquired") return;

    assert.equal(
      await transitionIbkrGatewayLifecycle(first.fence, "authenticated"),
      false,
    );
    for (const state of [
      "login_required",
      "verifying",
      "authenticated",
    ] as const) {
      assert.equal(
        await transitionIbkrGatewayLifecycle(first.fence, state),
        true,
      );
    }
    const [authenticatedBeforeRetry] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.ok(authenticatedBeforeRetry);
    assert.equal(authenticatedBeforeRetry.lifecycleState, "authenticated");
    assert.equal(
      await transitionIbkrGatewayLifecycle(first.fence, "authenticated"),
      true,
    );
    const [authenticatedAfterRetry] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.ok(authenticatedAfterRetry);
    assert.equal(
      authenticatedAfterRetry.lastActivityAt.getTime(),
      authenticatedBeforeRetry.lastActivityAt.getTime(),
    );
    assert.equal(
      authenticatedAfterRetry.updatedAt.getTime(),
      authenticatedBeforeRetry.updatedAt.getTime(),
    );
    assert.equal(
      await transitionIbkrGatewayLifecycle(first.fence, "degraded"),
      true,
    );
    assert.equal(
      await transitionIbkrGatewayLifecycle(first.fence, "authenticated"),
      false,
    );
    for (const state of ["reauth_required", "draining"] as const) {
      assert.equal(
        await transitionIbkrGatewayLifecycle(first.fence, state),
        true,
      );
    }
    assert.equal(await assertCurrentIbkrGatewayFence(first.fence), false);
    assert.equal(await renewIbkrGatewayLease(first.fence), null);

    assert.equal(await releaseIbkrGatewayLease(first.fence), true);
    const replacement = await tryAcquireIbkrGatewayLease(identity);
    assert.equal(replacement.status, "acquired");
    if (replacement.status !== "acquired") return;
    const [replacementBefore] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.ok(replacementBefore);
    assert.equal(replacementBefore.lifecycleState, "provisioning");

    assert.equal(
      await transitionIbkrGatewayLifecycle(first.fence, "login_required"),
      false,
    );
    assert.equal(
      await transitionIbkrGatewayLifecycle(first.fence, "login_required"),
      false,
    );
    const [replacementAfter] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.deepEqual(replacementAfter, replacementBefore);
    assert.deepEqual(
      await readCurrentIbkrGatewayFence(identity),
      replacement.fence,
    );

    await db
      .update(ibkrGatewaySessionsTable)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(ibkrGatewaySessionsTable.id, session.id));
    assert.equal(
      await transitionIbkrGatewayLifecycle(
        replacement.fence,
        "login_required",
      ),
      false,
    );
    assert.equal(
      await transitionIbkrGatewayLifecycle(replacement.fence, "draining"),
      true,
    );
    assert.equal(await releaseIbkrGatewayLease(replacement.fence), false);
    const [expiredDraining] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.ok(expiredDraining);
    assert.equal(expiredDraining.lifecycleState, "draining");
    assert.equal(expiredDraining.hostId, replacement.fence.hostId);
    assert.equal(expiredDraining.slotNumber, replacement.fence.slotNumber);
  });
});
