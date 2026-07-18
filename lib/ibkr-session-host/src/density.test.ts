import assert from "node:assert/strict";
import test from "node:test";

import {
  runCapsuleDensity,
  type CapsuleDensityRuntime,
  type DensityFleet,
} from "./density";

const RELEASE = {
  deploymentId: "deployment-123",
  imageReference: `registry.example.test/pyrus/ibkr-capsule@sha256:${"a".repeat(64)}`,
  manifestSha256: `sha256:${"b".repeat(64)}`,
  releaseCommit: "c".repeat(40),
  runtimeAttestationDigest: `sha256:${"d".repeat(64)}`,
  runtimeSpecDigest: `sha256:${"e".repeat(64)}`,
  vmSize: "reserved-vm-fixture",
  workloadIdentityDigest: "f".repeat(64),
};

function fixtureRuntime(
  options: {
    delayedKeepalive?: boolean;
    delayedSlot?: number;
    existing?: string[];
    failSlot?: number;
    unhealthyBoot?: boolean;
  } = {},
) {
  const events: string[] = [];
  const active = new Map<number, string>();
  let activeKeepalives = 0;
  let maxActiveKeepalives = 0;
  let timestamp = 0;
  const fleet: DensityFleet = {
    ensure: async (sessionId, _generation, slotNumber) => {
      events.push(`ensure:${slotNumber}`);
      if (slotNumber === options.failSlot) throw new Error("boot failed");
      if (slotNumber === options.delayedSlot) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      active.set(slotNumber, sessionId);
      return {
        name: `pyrus-ibkr-slot-${slotNumber}`,
        status: "ready",
      };
    },
    keepalive: async (sessionId, _generation, slotNumber) => {
      assert.equal(active.get(slotNumber), sessionId);
      events.push(`keepalive:${slotNumber}`);
      activeKeepalives += 1;
      maxActiveKeepalives = Math.max(maxActiveKeepalives, activeKeepalives);
      if (options.delayedKeepalive) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      activeKeepalives -= 1;
    },
    release: async (sessionId, _generation, slotNumber) => {
      assert.equal(active.get(slotNumber), sessionId);
      active.delete(slotNumber);
      events.push(`release:${slotNumber}`);
    },
    status: async (sessionId, _generation, slotNumber) => {
      events.push(`status:${slotNumber}`);
      return active.get(slotNumber) === sessionId
        ? {
            name: `pyrus-ibkr-slot-${slotNumber}`,
            status: "ready",
          }
        : null;
    },
  };
  const runtime: CapsuleDensityRuntime = {
    acquireControlPort: async () => {
      events.push("lock");
      return async () => {
        events.push("unlock");
      };
    },
    createLeaseGrant: () => ({
      bootId: "11111111-1111-4111-8111-111111111111",
      controlAttemptId: "22222222-2222-4222-8222-222222222222",
      grantNotAfterNs: "999999999999999",
      version: 1,
    }),
    createSessionId: (slotNumber) =>
      `00000000-0000-4000-8000-${String(slotNumber).padStart(12, "0")}`,
    delay: async () => {
      events.push("delay");
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    fleet,
    listExistingCapsules: async () =>
      options.existing ?? [...active.keys()].map((slot) => `slot-${slot}`),
    now: () =>
      new Date(Date.parse("2026-07-17T18:00:00.000Z") + timestamp++ * 1_000),
    readRuntimeReadiness: async () => ({ ready: true }),
    sample: async (target, placements) => ({
      api: { latencyMs: 3, ok: true, status: 200 },
      capsules: placements.map(({ slotNumber }) => ({
        cpuPercent: "0.10%",
        memoryPercent: "1.00%",
        memoryUsage: "100MiB / 2GiB",
        name: `pyrus-ibkr-slot-${slotNumber}`,
        oomKilled: false,
        pids: "12",
        restartCount: 0,
        running: true,
      })),
      host: {
        loadAverage: [0.1, 0.2, 0.3],
        memoryAvailableBytes: 8_000_000_000,
        memoryTotalBytes: 16_000_000_000,
        swapFreeBytes: 0,
        swapTotalBytes: 0,
      },
      target,
    }),
    sampleApi: async () =>
      options.unhealthyBoot
        ? { latencyMs: 2, ok: false, status: 503 }
        : { latencyMs: 2, ok: true, status: 200 },
  };
  return {
    active,
    events,
    get maxActiveKeepalives() {
      return maxActiveKeepalives;
    },
    runtime,
  };
}

test("runs the staged density ramp, samples every hold window, and cleans up", async () => {
  const fixture = fixtureRuntime();
  const report = await runCapsuleDensity(RELEASE, fixture.runtime, {
    finalHoldMs: 2,
    intermediateHoldMs: 1,
    levels: [1, 2, 5],
    sampleIntervalMs: 1,
  });

  assert.equal(report.verdict.mechanicalPass, true);
  assert.equal(report.verdict.failureCode, null);
  assert.deepEqual(
    report.stages.map(({ target, samples }) => [target, samples.length]),
    [
      [1, 2],
      [2, 2],
      [5, 3],
    ],
  );
  assert.equal(
    report.stages.every(({ bootApiSamples }) => bootApiSamples.length >= 1),
    true,
  );
  assert.deepEqual(
    fixture.events.filter((event) => event.startsWith("ensure:")),
    ["ensure:1", "ensure:2", "ensure:3", "ensure:4", "ensure:5"],
  );
  assert.deepEqual(
    fixture.events.filter((event) => event.startsWith("release:")).sort(),
    ["release:1", "release:2", "release:3", "release:4", "release:5"],
  );
  assert.deepEqual(report.cleanup, {
    complete: true,
    releaseFailures: [],
    remainingCapsules: [],
  });
  assert.equal(fixture.active.size, 0);
  assert.equal(fixture.events.at(0), "lock");
  assert.equal(fixture.events.at(-1), "unlock");
});

test("paces density keepalives without immediately repeating status probes", async () => {
  const fixture = fixtureRuntime({ delayedKeepalive: true });
  const report = await runCapsuleDensity(RELEASE, fixture.runtime, {
    finalHoldMs: 0,
    intermediateHoldMs: 0,
    levels: [5],
    sampleIntervalMs: 1,
  });

  assert.equal(report.verdict.mechanicalPass, true);
  assert.equal(fixture.maxActiveKeepalives, 1);
  assert.equal(
    fixture.events.some((event) => event.startsWith("status:")),
    false,
  );
});

test("records a boot failure, releases every successful slot, and never promotes", async () => {
  const fixture = fixtureRuntime({ failSlot: 2 });
  const report = await runCapsuleDensity(RELEASE, fixture.runtime, {
    finalHoldMs: 0,
    intermediateHoldMs: 0,
    levels: [1, 2],
    sampleIntervalMs: 1,
  });

  assert.equal(report.verdict.mechanicalPass, false);
  assert.equal(report.verdict.failureCode, "density_failed");
  assert.deepEqual(
    fixture.events.filter((event) => event.startsWith("ensure:")),
    ["ensure:1", "ensure:2"],
  );
  assert.deepEqual(
    fixture.events.filter((event) => event.startsWith("release:")),
    ["release:1"],
  );
  assert.equal(report.cleanup.complete, true);
  assert.equal(fixture.active.size, 0);
  assert.equal(fixture.events.at(-1), "unlock");
});

test("waits for concurrent boots to settle before cleaning a failed stage", async () => {
  const fixture = fixtureRuntime({ delayedSlot: 3, failSlot: 2 });
  const report = await runCapsuleDensity(RELEASE, fixture.runtime, {
    finalHoldMs: 0,
    intermediateHoldMs: 0,
    levels: [1, 3],
    sampleIntervalMs: 1,
  });

  assert.equal(report.verdict.mechanicalPass, false);
  assert.deepEqual(
    fixture.events.filter((event) => event.startsWith("release:")).sort(),
    ["release:1", "release:3"],
  );
  assert.equal(report.cleanup.complete, true);
  assert.equal(fixture.active.size, 0);
});

test("fails and cleans up when the API is unhealthy during capsule boot", async () => {
  const fixture = fixtureRuntime({ unhealthyBoot: true });
  const report = await runCapsuleDensity(RELEASE, fixture.runtime, {
    finalHoldMs: 0,
    intermediateHoldMs: 0,
    levels: [1],
    sampleIntervalMs: 1,
  });

  assert.equal(report.verdict.mechanicalPass, false);
  assert.equal(report.verdict.failureCode, "api_unhealthy_during_boot");
  assert.equal(report.cleanup.complete, true);
  assert.equal(fixture.active.size, 0);
});

test("refuses pre-existing capsule state before creating or deleting anything", async () => {
  const fixture = fixtureRuntime({
    existing: ["pyrus-ibkr-slot-1"],
  });
  const report = await runCapsuleDensity(RELEASE, fixture.runtime, {
    finalHoldMs: 0,
    intermediateHoldMs: 0,
    levels: [1],
    sampleIntervalMs: 1,
  });

  assert.equal(report.verdict.mechanicalPass, false);
  assert.equal(report.verdict.failureCode, "existing_capsules");
  assert.equal(
    fixture.events.some(
      (event) => event.startsWith("ensure:") || event.startsWith("release:"),
    ),
    false,
  );
  assert.deepEqual(report.cleanup.remainingCapsules, ["pyrus-ibkr-slot-1"]);
  assert.equal(fixture.events.at(-1), "unlock");
});
