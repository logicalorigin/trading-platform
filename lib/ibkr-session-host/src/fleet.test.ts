import assert from "node:assert/strict";
import test from "node:test";

import { CapsuleError, type CapsuleTargetKind } from "./capsule";
import { CapsuleFleetManager, type CapsuleSlotController } from "./fleet";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const LEASE_GRANT = {
  bootId: "33333333-3333-4333-8333-333333333333",
  controlAttemptId: "44444444-4444-4444-8444-444444444444",
  grantNotAfterNs: "20000000000",
  version: 1,
} as const;

function fakeSlot(
  slotNumber: number,
  sessions = new Map<string, number>(),
): CapsuleSlotController {
  return {
    ensure: async (sessionId, generation) => {
      const current = sessions.get(sessionId);
      if (sessions.size > 0 && current !== generation) {
        throw new CapsuleError("capacity_exhausted", "occupied");
      }
      sessions.set(sessionId, generation);
      return { name: `pyrus-ibkr-slot-${slotNumber}`, status: "ready" };
    },
    getRelayTarget: (kind) =>
      sessions.size > 0
        ? {
            host: `172.20.${slotNumber}.2`,
            port: kind === "cpg" ? 15000 : 16080,
          }
        : null,
    getTarget: (sessionId, kind: CapsuleTargetKind, generation) => {
      if (sessions.get(sessionId) !== generation) {
        throw new CapsuleError("session_not_found", "not found");
      }
      return {
        host: "127.0.0.1",
        port: kind === "cpg" ? 15000 + slotNumber - 1 : 16080 + slotNumber - 1,
      };
    },
    identityForSession: async (sessionId) => {
      const generation = sessions.get(sessionId);
      return generation === undefined ? null : { generation };
    },
    keepalive: async (sessionId, generation) => {
      if (sessions.get(sessionId) !== generation) {
        throw new CapsuleError("session_not_found", "not found");
      }
    },
    reconcile: async () =>
      sessions.size > 0
        ? { name: `pyrus-ibkr-slot-${slotNumber}`, status: "ready" }
        : null,
    release: async (sessionId, generation) => {
      if (sessions.get(sessionId) !== generation) {
        throw new CapsuleError("session_not_found", "not found");
      }
      sessions.delete(sessionId);
    },
    replace: async (sessionId, generation) => {
      if (!sessions.has(sessionId)) {
        throw new CapsuleError("session_not_found", "not found");
      }
      sessions.set(sessionId, generation);
      return { name: `pyrus-ibkr-slot-${slotNumber}`, status: "ready" };
    },
    snapshot: () => ({
      capacity: { active: sessions.size > 0 ? 1 : 0 },
    }),
    status: async (sessionId, generation) =>
      sessions.get(sessionId) === generation
        ? { name: `pyrus-ibkr-slot-${slotNumber}`, status: "ready" }
        : null,
  };
}

test("fleet routes durable placements to distinct bounded host slots", async () => {
  const fleet = new CapsuleFleetManager(2, fakeSlot);

  assert.equal((await fleet.ensure(SESSION_A, 3, 1)).name, "pyrus-ibkr-slot-1");
  assert.equal((await fleet.ensure(SESSION_B, 4, 2)).name, "pyrus-ibkr-slot-2");
  assert.deepEqual(fleet.snapshot(), {
    mode: "paper",
    capacity: { max: 2, active: 2 },
  });
  assert.deepEqual(fleet.getTarget(SESSION_B, 4, 2, "console"), {
    host: "127.0.0.1",
    port: 16081,
  });
  assert.deepEqual(fleet.getRelayTarget(2, "cpg"), {
    host: "172.20.2.2",
    port: 15000,
  });

  await assert.rejects(
    () => fleet.ensure(SESSION_A, 3, 2),
    (error: unknown) =>
      error instanceof CapsuleError &&
      error.code === "session_placement_conflict",
  );
  await assert.rejects(
    () => fleet.ensure(SESSION_B, 4, 1),
    (error: unknown) =>
      error instanceof CapsuleError &&
      error.code === "session_placement_conflict",
  );

  await fleet.release(SESSION_A, 3, 1);
  assert.equal(await fleet.status(SESSION_A, 3, 1), null);
  assert.deepEqual(fleet.snapshot().capacity, { max: 2, active: 1 });
});

test("fleet reuses a slot after its capsule expires autonomously", async () => {
  const sessions = new Map<string, number>();
  const fleet = new CapsuleFleetManager(1, (slotNumber) =>
    fakeSlot(slotNumber, sessions),
  );

  await fleet.ensure(SESSION_A, 3, 1);
  sessions.clear();

  assert.deepEqual(fleet.snapshot().capacity, { max: 1, active: 0 });
  assert.equal((await fleet.ensure(SESSION_B, 4, 1)).status, "ready");
});

test("fleet preserves an in-flight placement reservation", async () => {
  let markEnsureStarted!: () => void;
  let finishEnsure!: () => void;
  const ensureStarted = new Promise<void>((resolve) => {
    markEnsureStarted = resolve;
  });
  const ensureGate = new Promise<void>((resolve) => {
    finishEnsure = resolve;
  });
  const slotOne = fakeSlot(1);
  const originalEnsure = slotOne.ensure;
  let sessionEnsureCalls = 0;
  const slots: CapsuleSlotController[] = [
    {
      ...slotOne,
      ensure: async (sessionId, generation, leaseGrant) => {
        const record = await originalEnsure(sessionId, generation, leaseGrant);
        if (sessionId === SESSION_A) {
          sessionEnsureCalls += 1;
          if (sessionEnsureCalls === 1) {
            markEnsureStarted();
            await ensureGate;
          }
        }
        return record;
      },
    },
    fakeSlot(2),
  ];
  const fleet = new CapsuleFleetManager(
    2,
    (slotNumber) => slots[slotNumber - 1]!,
  );
  const firstEnsure = fleet.ensure(SESSION_A, 3, 1);

  await ensureStarted;
  let firstRecord: Awaited<typeof firstEnsure> | null = null;
  try {
    assert.equal((await fleet.status(SESSION_A, 3, 1))?.status, "ready");
    await assert.rejects(
      () => fleet.ensure(SESSION_A, 3, 1),
      (error: unknown) =>
        error instanceof CapsuleError &&
        error.code === "session_placement_conflict",
    );
    await assert.rejects(
      () => fleet.ensure(SESSION_B, 4, 1),
      (error: unknown) =>
        error instanceof CapsuleError &&
        error.code === "session_placement_conflict",
    );
  } finally {
    finishEnsure();
    firstRecord = await firstEnsure.catch(() => null);
  }

  assert.equal(firstRecord?.status, "ready");
  assert.equal(sessionEnsureCalls, 1);
});

test("fleet rechecks in-flight placement after probing a stale occupant", async () => {
  let markStaleProbeStarted!: () => void;
  let finishStaleProbe!: () => void;
  let markEnsureStarted!: () => void;
  let finishEnsure!: () => void;
  const staleProbeStarted = new Promise<void>((resolve) => {
    markStaleProbeStarted = resolve;
  });
  const staleProbeGate = new Promise<void>((resolve) => {
    finishStaleProbe = resolve;
  });
  const ensureStarted = new Promise<void>((resolve) => {
    markEnsureStarted = resolve;
  });
  const ensureGate = new Promise<void>((resolve) => {
    finishEnsure = resolve;
  });
  const sessions = new Map<string, number>();
  const slot = fakeSlot(1, sessions);
  const originalEnsure = slot.ensure;
  const originalIdentityForSession = slot.identityForSession;
  let probeStaleOccupant = false;
  let staleProbeCalls = 0;
  let sessionEnsureCalls = 0;
  const fleet = new CapsuleFleetManager(1, () => ({
    ...slot,
    ensure: async (sessionId, generation, leaseGrant) => {
      const record = await originalEnsure(sessionId, generation, leaseGrant);
      if (sessionId === SESSION_A) {
        sessionEnsureCalls += 1;
        if (sessionEnsureCalls === 1) {
          markEnsureStarted();
          await ensureGate;
        }
      }
      return record;
    },
    identityForSession: async (sessionId) => {
      if (probeStaleOccupant && sessionId === SESSION_B) {
        staleProbeCalls += 1;
        if (staleProbeCalls === 1) {
          markStaleProbeStarted();
          await staleProbeGate;
        }
        return null;
      }
      return originalIdentityForSession(sessionId);
    },
  }));

  await fleet.ensure(SESSION_B, 1, 1);
  sessions.clear();
  probeStaleOccupant = true;
  const delayedOutcome = fleet.ensure(SESSION_A, 2, 1).then(
    (record) => record,
    (error: unknown) => error,
  );
  await staleProbeStarted;
  const activeEnsure = fleet.ensure(SESSION_A, 2, 1);
  await ensureStarted;

  finishStaleProbe();
  await new Promise<void>((resolve) => setImmediate(resolve));
  let activeRecord: Awaited<typeof activeEnsure> | null = null;
  try {
    assert.equal(sessionEnsureCalls, 1);
  } finally {
    finishEnsure();
    activeRecord = await activeEnsure.catch(() => null);
  }
  const delayedResult = await delayedOutcome;

  assert.equal(activeRecord?.status, "ready");
  assert.ok(delayedResult instanceof CapsuleError);
  assert.equal(delayedResult.code, "session_placement_conflict");
});

test("fleet clears a failed in-flight placement after rejecting a duplicate ensure", async () => {
  let markFirstEnsureStarted!: () => void;
  let rejectFirstEnsure!: (error: Error) => void;
  let rejectSecondEnsure: ((error: Error) => void) | undefined;
  const firstEnsureStarted = new Promise<void>((resolve) => {
    markFirstEnsureStarted = resolve;
  });
  const slot = fakeSlot(1);
  const originalEnsure = slot.ensure;
  let sessionEnsureCalls = 0;
  const fleet = new CapsuleFleetManager(1, () => ({
    ...slot,
    ensure: (sessionId, generation, leaseGrant) => {
      if (sessionId !== SESSION_A) {
        return originalEnsure(sessionId, generation, leaseGrant);
      }
      sessionEnsureCalls += 1;
      return new Promise((_, reject) => {
        if (sessionEnsureCalls === 1) {
          rejectFirstEnsure = reject;
          markFirstEnsureStarted();
        } else {
          rejectSecondEnsure = reject;
        }
      });
    },
  }));
  const firstEnsure = fleet.ensure(SESSION_A, 3, 1);

  await firstEnsureStarted;
  const secondOutcome = fleet.ensure(SESSION_A, 3, 1).then(
    () => null,
    (error: unknown) => error,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  rejectFirstEnsure(new CapsuleError("capacity_exhausted", "first failed"));
  await assert.rejects(firstEnsure, CapsuleError);
  rejectSecondEnsure?.(new CapsuleError("capacity_exhausted", "second failed"));
  const secondError = await secondOutcome;

  assert.equal((await fleet.ensure(SESSION_B, 4, 1)).status, "ready");
  assert.equal(sessionEnsureCalls, 1);
  assert.ok(secondError instanceof CapsuleError);
  assert.equal(secondError.code, "session_placement_conflict");
});

test("fleet does not let stale status overwrite a newer generation", async () => {
  let markStatusStarted!: () => void;
  let finishStatus!: () => void;
  const statusStarted = new Promise<void>((resolve) => {
    markStatusStarted = resolve;
  });
  const statusGate = new Promise<void>((resolve) => {
    finishStatus = resolve;
  });
  const sessions = new Map<string, number>();
  const slot = fakeSlot(1, sessions);
  const originalStatus = slot.status;
  const fleet = new CapsuleFleetManager(1, () => ({
    ...slot,
    status: async (sessionId, generation) => {
      const record = await originalStatus(sessionId, generation);
      if (sessionId === SESSION_A && generation === 7) {
        markStatusStarted();
        await statusGate;
      }
      return record;
    },
  }));

  await fleet.ensure(SESSION_A, 7, 1);
  const staleStatus = fleet.status(SESSION_A, 7, 1);
  await statusStarted;
  assert.equal((await fleet.ensure(SESSION_A, 8, 1)).status, "ready");
  finishStatus();

  assert.equal((await staleStatus)?.status, "ready");
  assert.equal((await fleet.status(SESSION_A, 8, 1))?.status, "ready");
});

test("fleet does not evict a physically occupied slot with a newer generation", async () => {
  const sessions = new Map<string, number>();
  const fleet = new CapsuleFleetManager(1, (slotNumber) =>
    fakeSlot(slotNumber, sessions),
  );

  await fleet.ensure(SESSION_A, 3, 1);
  sessions.set(SESSION_A, 4);

  await assert.rejects(
    () => fleet.ensure(SESSION_B, 5, 1),
    (error: unknown) =>
      error instanceof CapsuleError &&
      error.code === "session_placement_conflict",
  );
});

test("fleet clears expired placements after null status or missing release", async () => {
  for (const action of ["status", "release"] as const) {
    const sessions = new Map<string, number>();
    const fleet = new CapsuleFleetManager(1, (slotNumber) =>
      fakeSlot(slotNumber, sessions),
    );
    await fleet.ensure(SESSION_A, 3, 1);
    sessions.clear();

    if (action === "status") {
      assert.equal(await fleet.status(SESSION_A, 3, 1), null);
    } else {
      await assert.rejects(
        () => fleet.release(SESSION_A, 3, 1),
        (error: unknown) =>
          error instanceof CapsuleError && error.code === "session_not_found",
      );
    }
    await assert.rejects(
      () => fleet.keepalive(SESSION_B, 4, 1, LEASE_GRANT),
      (error: unknown) =>
        error instanceof CapsuleError && error.code === "session_not_found",
    );
  }
});

test("fleet rejects any slot outside the host's measured capacity", async () => {
  const fleet = new CapsuleFleetManager(2, fakeSlot);

  await assert.rejects(() => fleet.ensure(SESSION_A, 1, 0), CapsuleError);
  await assert.rejects(() => fleet.ensure(SESSION_A, 1, 3), CapsuleError);
  assert.throws(() => fleet.getRelayTarget(3, "console"), CapsuleError);
});

test("fleet fences stale generations after an in-place lease takeover", async () => {
  const fleet = new CapsuleFleetManager(1, fakeSlot);

  await fleet.ensure(SESSION_A, 7, 1);
  await fleet.ensure(SESSION_A, 8, 1);

  assert.equal(await fleet.status(SESSION_A, 7, 1), null);
  assert.throws(
    () => fleet.getTarget(SESSION_A, 7, 1, "cpg"),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "stale_generation",
  );
  await assert.rejects(
    () => fleet.release(SESSION_A, 7, 1),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "stale_generation",
  );
  assert.equal((await fleet.status(SESSION_A, 8, 1))?.status, "ready");
});

test("fleet recovers generation identity from the capsule after host restart", async () => {
  const slots = [fakeSlot(1)];
  const original = new CapsuleFleetManager(1, () => slots[0]!);
  await original.ensure(SESSION_A, 7, 1);

  const restarted = new CapsuleFleetManager(1, () => slots[0]!);
  assert.equal((await restarted.ensure(SESSION_A, 8, 1)).status, "ready");
  assert.equal(await restarted.status(SESSION_A, 7, 1), null);
  assert.equal((await restarted.status(SESSION_A, 8, 1))?.status, "ready");
});

test("fleet keepalive restores only the exact durable placement", async () => {
  const fleet = new CapsuleFleetManager(2, fakeSlot);
  await fleet.ensure(SESSION_A, 7, 2, LEASE_GRANT);

  await fleet.keepalive(SESSION_A, 7, 2, LEASE_GRANT);
  await assert.rejects(
    () => fleet.keepalive(SESSION_A, 7, 1, LEASE_GRANT),
    (error: unknown) =>
      error instanceof CapsuleError &&
      error.code === "session_placement_conflict",
  );
  await assert.rejects(
    () => fleet.keepalive(SESSION_A, 6, 2, LEASE_GRANT),
    (error: unknown) =>
      error instanceof CapsuleError && error.code === "stale_generation",
  );
});
