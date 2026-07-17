import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerConnectionsTable,
  db,
  ibkrGatewaySessionsTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq, isNotNull } from "drizzle-orm";
import {
  type IbkrGatewayFence,
  acknowledgeIbkrGatewayControlAttempt,
  approveIbkrGatewayHost,
  assertCurrentIbkrGatewayFence,
  beginIbkrGatewayControlAttempt,
  countActiveIbkrGatewayHostLeases,
  disableIbkrGatewayHost,
  ensureIbkrGatewayBrokerConnection,
  ensureIbkrGatewaySessionIdentity,
  heartbeatIbkrGatewayHost,
  readIbkrGatewayHost,
  readCurrentIbkrGatewayFence,
  registerIbkrGatewayHost,
  releaseIbkrGatewayLease,
  renewIbkrGatewayCleanupLease,
  renewIbkrGatewayLease,
  resolveIbkrGatewayCleanupPlacement,
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
const POSTGRES_INTEGER_MAX = 2_147_483_647;

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

async function beginAndAcknowledgeCleanup(
  fence: IbkrGatewayFence,
): Promise<string> {
  const attempt = await beginIbkrGatewayControlAttempt(fence, "cleanup");
  assert.ok(attempt);
  assert.equal(
    await acknowledgeIbkrGatewayControlAttempt(
      fence,
      attempt.controlAttemptId,
      "cleanup",
    ),
    true,
  );
  return attempt.controlAttemptId;
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
    const acquired = results.filter((result) => result.status === "acquired");
    assert.equal(acquired.length, 3);
    assert.equal(
      results.filter((result) => result.status === "busy").length,
      1,
    );

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
    assert.equal(
      results.filter((result) => result.status === "busy").length,
      1,
    );

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

    await db
      .update(ibkrGatewaySessionsTable)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(isNotNull(ibkrGatewaySessionsTable.hostId));
    assert.deepEqual(await tryAcquireIbkrGatewayLease(identities[3]!), {
      status: "busy",
    });
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

    assert.equal(
      await transitionIbkrGatewayLifecycle(second.fence, "draining"),
      true,
    );
    const secondCleanupAttemptId = await beginAndAcknowledgeCleanup(
      second.fence,
    );
    assert.equal(
      await releaseIbkrGatewayLease(second.fence, secondCleanupAttemptId),
      true,
    );
    assert.deepEqual(await tryAcquireIbkrGatewayLease(identityA), {
      status: "busy",
    });
    const reusableAtMs = Date.now();
    await db
      .update(ibkrGatewaySessionsTable)
      .set({
        leaseExpiresAt: new Date(reusableAtMs - 126_000),
        replacementDeadlineAt: new Date(reusableAtMs - 1_000),
      })
      .where(eq(ibkrGatewaySessionsTable.id, first.fence.sessionId));
    assert.deepEqual(await tryAcquireIbkrGatewayLease(identityA), {
      status: "busy",
    });
    assert.equal(
      await transitionIbkrGatewayLifecycle(first.fence, "draining"),
      true,
    );
    const firstCleanupAttemptId = await beginAndAcknowledgeCleanup(first.fence);
    assert.equal(
      await releaseIbkrGatewayLease(first.fence, firstCleanupAttemptId),
      true,
    );
    const replacement = await tryAcquireIbkrGatewayLease(identityA);
    assert.equal(replacement.status, "acquired");
    if (replacement.status !== "acquired") return;
    assert.equal(replacement.fence.hostId, HOST_B);
    assert.equal(replacement.fence.generation, first.fence.generation + 2);
    assert.equal(await assertCurrentIbkrGatewayFence(first.fence), false);
  });
});

test("admission creates a 155-second fence and uncertain placements keep capacity", async () => {
  await withTestDb(async () => {
    await registerAndApproveHost({
      hostId: HOST_A,
      workloadIdentityDigest: WORKLOAD_A,
      sha: SHA_A,
      admissionSlotCapacity: 1,
    });
    const [identityA, identityB] = await seedIdentities(2);
    assert.ok(identityA);
    assert.ok(identityB);
    const session = await ensureIbkrGatewaySessionIdentity(identityA);
    assert.ok(session);
    assert.ok(await ensureIbkrGatewaySessionIdentity(identityB));

    const admissionStartedAtMs = Date.now();
    const first = await tryAcquireIbkrGatewayLease(identityA);
    assert.equal(first.status, "acquired");
    if (first.status !== "acquired") return;
    const [placed] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.ok(placed?.replacementDeadlineAt);
    assert.equal(placed.controlAttemptId, null);
    assert.equal(placed.controlAcknowledgedAt, null);
    assert.ok(
      placed.replacementDeadlineAt.getTime() >= admissionStartedAtMs + 155_000,
    );
    assert.ok(placed.leaseExpiresAt);
    assert.ok(
      placed.replacementDeadlineAt.getTime() -
        placed.leaseExpiresAt.getTime() >=
        125_000,
    );

    await db
      .update(ibkrGatewaySessionsTable)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(ibkrGatewaySessionsTable.id, session.id));

    assert.equal(await countActiveIbkrGatewayHostLeases(HOST_A), 1);
    assert.deepEqual(await tryAcquireIbkrGatewayLease(identityA), {
      status: "busy",
    });
    assert.deepEqual(await tryAcquireIbkrGatewayLease(identityB), {
      status: "busy",
    });
    const [stillPlaced] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.equal(stillPlaced?.hostId, first.fence.hostId);
    assert.equal(stillPlaced?.slotNumber, first.fence.slotNumber);
    assert.equal(
      stillPlaced?.replacementDeadlineAt?.getTime(),
      placed.replacementDeadlineAt.getTime(),
    );
  });
});

test("admission deadlines start after the admission lock is acquired", async () => {
  await withTestDb(async ({ client }) => {
    await client.exec(`
      CREATE FUNCTION public.pg_advisory_xact_lock(bigint)
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        PERFORM now();
        PERFORM pg_sleep(2);
      END
      $$;
      SET search_path = public, pg_catalog;
      SET DateStyle = 'SQL, DMY'
    `);
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

    const databaseClock = await client.query<{ at_ms: number }>(`
      SELECT (extract(epoch FROM clock_timestamp()) * 1000)::double precision AS at_ms
    `);
    const admissionStartedAtMs = Number(databaseClock.rows[0]!.at_ms);
    const acquired = await tryAcquireIbkrGatewayLease(identity);
    assert.equal(acquired.status, "acquired");
    const storedDeadline = await client.query<{ deadline_ms: number }>(
      `
        SELECT
          (extract(epoch FROM replacement_deadline_at) * 1000)::double precision AS deadline_ms
        FROM ibkr_gateway_sessions
        WHERE id = $1
      `,
      [session.id],
    );
    const replacementDeadlineAtMs = Number(storedDeadline.rows[0]?.deadline_ms);
    assert.ok(Number.isFinite(replacementDeadlineAtMs));
    assert.ok(
      replacementDeadlineAtMs >= admissionStartedAtMs + 156_000,
      JSON.stringify({ admissionStartedAtMs, replacementDeadlineAtMs }),
    );
  });
});

test("elapsed database deadlines do not reuse a capsule without host-enforced expiry", async () => {
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

    const reusableAtMs = Date.now();
    await db
      .update(ibkrGatewaySessionsTable)
      .set({
        leaseExpiresAt: new Date(reusableAtMs - 126_000),
        replacementDeadlineAt: new Date(reusableAtMs - 1_000),
      })
      .where(eq(ibkrGatewaySessionsTable.id, session.id));

    assert.deepEqual(await tryAcquireIbkrGatewayLease(identity), {
      status: "busy",
    });
    assert.equal(await countActiveIbkrGatewayHostLeases(HOST_A), 1);
    const [retained] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.equal(retained?.generation, first.fence.generation);
    assert.equal(retained?.hostId, first.fence.hostId);
    assert.equal(retained?.slotNumber, first.fence.slotNumber);
    assert.equal(retained?.leaseHolderId, first.fence.leaseHolderId);
    assert.equal(
      retained?.replacementDeadlineAt?.getTime(),
      reusableAtMs - 1_000,
    );
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
    assert.equal(await renewIbkrGatewayCleanupLease(first.fence), null);
    assert.equal(await releaseIbkrGatewayLease(first.fence, HOST_A), false);
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
    const [drainingBeforeCleanup] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.ok(drainingBeforeCleanup);
    assert.ok(await renewIbkrGatewayCleanupLease(first.fence));
    assert.ok(await resolveIbkrGatewayCleanupPlacement(first.fence));
    const [drainingAfterCleanup] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.ok(drainingAfterCleanup);
    assert.equal(
      drainingAfterCleanup.lastActivityAt.getTime(),
      drainingBeforeCleanup.lastActivityAt.getTime(),
    );
    assert.equal(
      drainingAfterCleanup.updatedAt.getTime(),
      drainingBeforeCleanup.updatedAt.getTime(),
    );

    const firstCleanupAttemptId = await beginAndAcknowledgeCleanup(first.fence);
    assert.equal(
      await releaseIbkrGatewayLease(first.fence, firstCleanupAttemptId),
      true,
    );
    const [released] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.equal(released?.controlAttemptId, null);
    assert.equal(released?.controlAcknowledgedAt, null);
    assert.equal(released?.replacementDeadlineAt, null);
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
      await transitionIbkrGatewayLifecycle(replacement.fence, "login_required"),
      false,
    );
    assert.equal(
      await transitionIbkrGatewayLifecycle(replacement.fence, "draining"),
      true,
    );
    assert.equal(
      (await renewIbkrGatewayCleanupLease(replacement.fence)) !== null,
      true,
    );
    const replacementCleanupAttemptId = await beginAndAcknowledgeCleanup(
      replacement.fence,
    );
    assert.equal(
      await releaseIbkrGatewayLease(
        replacement.fence,
        replacementCleanupAttemptId,
      ),
      true,
    );
    const [releasedAfterExpiry] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.ok(releasedAfterExpiry);
    assert.equal(releasedAfterExpiry.lifecycleState, "released");
    assert.equal(releasedAfterExpiry.hostId, null);
    assert.equal(releasedAfterExpiry.slotNumber, null);
  });
});

test("exact cleanup retires a maximum-generation placement without overflow", async () => {
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
    const acquired = await tryAcquireIbkrGatewayLease(identity);
    assert.equal(acquired.status, "acquired");
    if (acquired.status !== "acquired") return;
    assert.equal(
      await transitionIbkrGatewayLifecycle(acquired.fence, "draining"),
      true,
    );
    await db
      .update(ibkrGatewaySessionsTable)
      .set({ generation: POSTGRES_INTEGER_MAX })
      .where(eq(ibkrGatewaySessionsTable.id, session.id));
    const maxFence = {
      ...acquired.fence,
      generation: POSTGRES_INTEGER_MAX,
    };

    const cleanupAttemptId = await beginAndAcknowledgeCleanup(maxFence);
    assert.equal(
      await releaseIbkrGatewayLease(maxFence, cleanupAttemptId),
      true,
    );
    const [released] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.ok(released);
    assert.equal(released.generation, POSTGRES_INTEGER_MAX);
    assert.equal(released.hostId, null);
    assert.equal(released.leaseHolderId, null);
    assert.equal(released.replacementDeadlineAt, null);
    assert.deepEqual(await tryAcquireIbkrGatewayLease(identity), {
      status: "busy",
    });
  });
});

test("control acknowledgements CAS only the latest exact attempt", async () => {
  await withTestDb(async ({ client }) => {
    const databaseClockMs = async (): Promise<number> => {
      const clock = await client.query<{ at_ms: number }>(`
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::double precision AS at_ms
      `);
      return Number(clock.rows[0]!.at_ms);
    };
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
    const acquired = await tryAcquireIbkrGatewayLease(identity);
    assert.equal(acquired.status, "acquired");
    if (acquired.status !== "acquired") return;

    assert.equal(
      await beginIbkrGatewayControlAttempt(acquired.fence, "cleanup"),
      null,
    );
    const firstStartedAtMs = await databaseClockMs();
    const first = await beginIbkrGatewayControlAttempt(
      acquired.fence,
      "traffic",
    );
    assert.ok(first);
    assert.deepEqual(first.fence, acquired.fence);
    assert.match(first.controlAttemptId, /^[0-9a-f-]{36}$/);
    const [firstStored] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.equal(firstStored?.controlAttemptId, first.controlAttemptId);
    assert.equal(firstStored?.controlAcknowledgedAt, null);
    assert.ok(
      (firstStored?.replacementDeadlineAt?.getTime() ?? 0) >=
        firstStartedAtMs + 155_000,
    );

    const second = await beginIbkrGatewayControlAttempt(
      acquired.fence,
      "traffic",
    );
    assert.ok(second);
    assert.notEqual(second.controlAttemptId, first.controlAttemptId);
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        acquired.fence,
        first.controlAttemptId,
        "traffic",
      ),
      false,
    );
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        acquired.fence,
        second.controlAttemptId,
        "cleanup",
      ),
      false,
    );
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        acquired.fence,
        second.controlAttemptId,
        "traffic",
      ),
      true,
    );
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        acquired.fence,
        second.controlAttemptId,
        "traffic",
      ),
      false,
    );
    const [acknowledged] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.equal(acknowledged?.controlAttemptId, second.controlAttemptId);
    assert.ok(acknowledged?.controlAcknowledgedAt);

    assert.equal(
      await transitionIbkrGatewayLifecycle(acquired.fence, "draining"),
      true,
    );
    assert.equal(
      await releaseIbkrGatewayLease(
        acquired.fence,
        second.controlAttemptId,
      ),
      false,
    );
    assert.equal(
      await beginIbkrGatewayControlAttempt(acquired.fence, "traffic"),
      null,
    );
    const elapsedAtMs = Date.now();
    await db
      .update(ibkrGatewaySessionsTable)
      .set({
        leaseExpiresAt: new Date(elapsedAtMs - 126_000),
        replacementDeadlineAt: new Date(elapsedAtMs - 1_000),
      })
      .where(eq(ibkrGatewaySessionsTable.id, session.id));
    const cleanupStartedAtMs = await databaseClockMs();
    const cleanup = await beginIbkrGatewayControlAttempt(
      acquired.fence,
      "cleanup",
    );
    assert.ok(cleanup);
    const [cleanupStored] = await db
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(eq(ibkrGatewaySessionsTable.id, session.id))
      .limit(1);
    assert.equal(cleanupStored?.controlAttemptId, cleanup.controlAttemptId);
    assert.equal(cleanupStored?.controlAcknowledgedAt, null);
    assert.ok(
      (cleanupStored?.replacementDeadlineAt?.getTime() ?? 0) >=
        cleanupStartedAtMs + 155_000,
    );
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        acquired.fence,
        second.controlAttemptId,
        "traffic",
      ),
      false,
    );
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        acquired.fence,
        cleanup.controlAttemptId,
        "traffic",
      ),
      false,
    );
    assert.equal(
      await releaseIbkrGatewayLease(
        acquired.fence,
        cleanup.controlAttemptId,
      ),
      false,
    );
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        acquired.fence,
        cleanup.controlAttemptId,
        "cleanup",
      ),
      true,
    );
    assert.equal(
      await releaseIbkrGatewayLease(
        acquired.fence,
        cleanup.controlAttemptId,
      ),
      true,
    );
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        acquired.fence,
        cleanup.controlAttemptId,
        "cleanup",
      ),
      false,
    );

    const replacement = await tryAcquireIbkrGatewayLease(identity);
    assert.equal(replacement.status, "acquired");
    if (replacement.status !== "acquired") return;
    const replacementAttempt = await beginIbkrGatewayControlAttempt(
      replacement.fence,
      "traffic",
    );
    assert.ok(replacementAttempt);
    assert.ok(await disableIbkrGatewayHost(HOST_A, "quarantined"));
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        replacement.fence,
        replacementAttempt.controlAttemptId,
        "traffic",
      ),
      false,
    );
    assert.equal(
      await acknowledgeIbkrGatewayControlAttempt(
        acquired.fence,
        cleanup.controlAttemptId,
        "cleanup",
      ),
      false,
    );
  });
});
