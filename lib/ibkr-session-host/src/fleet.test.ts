import assert from "node:assert/strict";
import test from "node:test";

import { CapsuleError, type CapsuleTargetKind } from "./capsule";
import { CapsuleFleetManager, type CapsuleSlotController } from "./fleet";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

function fakeSlot(slotNumber: number): CapsuleSlotController {
  const sessions = new Map<string, number>();
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
