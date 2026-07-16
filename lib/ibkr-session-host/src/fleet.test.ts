import assert from "node:assert/strict";
import test from "node:test";

import { CapsuleError, type CapsuleTargetKind } from "./capsule";
import {
  CapsuleFleetManager,
  type CapsuleSlotController,
} from "./fleet";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

function fakeSlot(slotNumber: number): CapsuleSlotController {
  const sessions = new Set<string>();
  return {
    ensure: async (sessionId) => {
      sessions.add(sessionId);
      return { name: `pyrus-ibkr-slot-${slotNumber}`, status: "ready" };
    },
    getRelayTarget: (kind) =>
      sessions.size > 0
        ? {
            host: `172.20.${slotNumber}.2`,
            port: kind === "cpg" ? 15000 : 16080,
          }
        : null,
    getTarget: (sessionId, kind: CapsuleTargetKind) => {
      if (!sessions.has(sessionId)) {
        throw new CapsuleError("session_not_found", "not found");
      }
      return {
        host: "127.0.0.1",
        port:
          kind === "cpg"
            ? 15000 + slotNumber - 1
            : 16080 + slotNumber - 1,
      };
    },
    release: async (sessionId) => {
      if (!sessions.delete(sessionId)) {
        throw new CapsuleError("session_not_found", "not found");
      }
    },
    snapshot: () => ({
      capacity: { active: sessions.size > 0 ? 1 : 0 },
    }),
    status: async (sessionId) =>
      sessions.has(sessionId)
        ? { name: `pyrus-ibkr-slot-${slotNumber}`, status: "ready" }
        : null,
  };
}

test("fleet routes durable placements to distinct bounded host slots", async () => {
  const fleet = new CapsuleFleetManager(2, fakeSlot);

  assert.equal((await fleet.ensure(SESSION_A, 1)).name, "pyrus-ibkr-slot-1");
  assert.equal((await fleet.ensure(SESSION_B, 2)).name, "pyrus-ibkr-slot-2");
  assert.deepEqual(fleet.snapshot(), {
    mode: "paper",
    capacity: { max: 2, active: 2 },
  });
  assert.deepEqual(fleet.getTarget(SESSION_B, 2, "console"), {
    host: "127.0.0.1",
    port: 16081,
  });
  assert.deepEqual(fleet.getRelayTarget(2, "cpg"), {
    host: "172.20.2.2",
    port: 15000,
  });

  await assert.rejects(
    () => fleet.ensure(SESSION_A, 2),
    (error: unknown) =>
      error instanceof CapsuleError &&
      error.code === "session_placement_conflict",
  );
  await assert.rejects(
    () => fleet.ensure(SESSION_B, 1),
    (error: unknown) =>
      error instanceof CapsuleError &&
      error.code === "session_placement_conflict",
  );

  await fleet.release(SESSION_A, 1);
  assert.equal(await fleet.status(SESSION_A, 1), null);
  assert.deepEqual(fleet.snapshot().capacity, { max: 2, active: 1 });
});

test("fleet rejects any slot outside the host's measured capacity", async () => {
  const fleet = new CapsuleFleetManager(2, fakeSlot);

  await assert.rejects(() => fleet.ensure(SESSION_A, 0), CapsuleError);
  await assert.rejects(() => fleet.ensure(SESSION_A, 3), CapsuleError);
  assert.throws(() => fleet.getRelayTarget(3, "console"), CapsuleError);
});
