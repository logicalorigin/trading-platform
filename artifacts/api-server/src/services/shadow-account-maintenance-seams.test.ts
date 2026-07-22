import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  __shadowOptionMaintenanceInternalsForTests as internals,
  runShadowOptionClosedReconciliation,
  runShadowOptionMaintenance,
  runShadowOptionOpenSafety,
  type ShadowOptionMaintenanceSummary,
} from "./shadow-account";

type MaintenanceCall = "closed" | "deployments" | "open";

function useMaintenanceFakes(
  calls: MaintenanceCall[],
  closedError?: Error,
  reconciledCount = 0,
) {
  internals.setDependenciesForTests({
    listOpenPositions: async () => {
      calls.push("open");
      return [];
    },
    listDeployments: async () => {
      calls.push("deployments");
      return [{ id: "deployment-1" }];
    },
    reconcileClosedWithoutExit: async ({ summary }) => {
      calls.push("closed");
      if (closedError) {
        throw closedError;
      }
      summary.reconciledCount += reconciledCount;
    },
  });
}

const emptySummary = (): ShadowOptionMaintenanceSummary => ({
  checkedCount: 0,
  dueCount: 0,
  closedCount: 0,
  skippedCount: 0,
  orphanCount: 0,
  forceClosedCount: 0,
  reconciledCount: 0,
  errors: [],
});

const now = new Date("2026-07-15T12:00:00.000Z");

test("real expiration and force-close exits commit fenced mirror payloads before selling", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "async function runShadowOptionOpenSafetyWithContext",
  );
  const end = source.indexOf(
    "async function runShadowOptionClosedReconciliationWithContext",
    start,
  );
  const openSafety = source.slice(start, end);
  const exitPayloads = openSafety.match(
    /const exitPayload = \{[\s\S]*?\n\s*\};/g,
  );

  assert.equal(exitPayloads?.length, 2);
  for (const payload of exitPayloads ?? []) {
    assert.match(payload, /\bexitQuantity:\s*quantity\b/);
    assert.match(payload, /\bmirrorRequired:\s*true\b/);
    assert.match(payload, /\bselectedContract:\s*optionPayload\(contract\)/);
    assert.match(payload, /\bquantity\b/);
  }
  assert.equal(
    openSafety.match(/await recordShadowAutomationEvent\(inserted/g)?.length,
    2,
  );
});

test("maintenance does not elect regular stops from persisted midpoint marks", async () => {
  const regularLoss = await internals.detectShadowMaintenanceBreach({
    position: { averageCost: "1", mark: "0.6" } as never,
    contract: {} as never,
    context: {} as never,
  });
  const catastrophe = await internals.detectShadowMaintenanceBreach({
    position: { averageCost: "1", mark: "0.09" } as never,
    contract: {} as never,
    context: {} as never,
  });

  assert.equal(regularLoss, null);
  assert.deepEqual(catastrophe, {
    exitReason: "mark_drawdown",
    markReturnPct: -91,
  });
});

test("shadow option maintenance exposes isolated open and closed seams", async (t) => {
  await t.test("open safety never invokes closed reconciliation", async () => {
    const calls: MaintenanceCall[] = [];
    useMaintenanceFakes(calls);
    try {
      assert.deepEqual(
        await runShadowOptionOpenSafety({ now }),
        emptySummary(),
      );
      assert.deepEqual(calls, ["open", "deployments"]);
    } finally {
      internals.setDependenciesForTests(null);
    }
  });

  await t.test(
    "closed reconciliation never invokes open expiration or force-stop safety",
    async () => {
      const calls: MaintenanceCall[] = [];
      useMaintenanceFakes(calls);
      try {
        assert.deepEqual(
          await runShadowOptionClosedReconciliation({ now }),
          emptySummary(),
        );
        assert.deepEqual(calls, ["deployments", "closed"]);
      } finally {
        internals.setDependenciesForTests(null);
      }
    },
  );

  await t.test(
    "compatibility maintenance runs open then closed with one deployment read",
    async () => {
      const calls: MaintenanceCall[] = [];
      useMaintenanceFakes(calls, undefined, 2);
      try {
        assert.deepEqual(await runShadowOptionMaintenance({ now }), {
          ...emptySummary(),
          reconciledCount: 2,
        });
        assert.deepEqual(calls, ["open", "deployments", "closed"]);
      } finally {
        internals.setDependenciesForTests(null);
      }
    },
  );

  await t.test(
    "closed reconciliation isolates an error in the existing summary shape",
    async () => {
      const calls: MaintenanceCall[] = [];
      useMaintenanceFakes(calls, new Error("closed scan failed"));
      try {
        assert.deepEqual(await runShadowOptionClosedReconciliation({ now }), {
          ...emptySummary(),
          errors: [
            {
              positionId: "reconcile",
              symbol: "*",
              reason: "closed scan failed",
            },
          ],
        });
        assert.deepEqual(calls, ["deployments", "closed"]);
      } finally {
        internals.setDependenciesForTests(null);
      }
    },
  );
});

test("shadow option maintenance stops when its lease signal is aborted", async (t) => {
  await t.test("between the open-position and deployment reads", async () => {
    const controller = new AbortController();
    const calls: MaintenanceCall[] = [];
    internals.setDependenciesForTests({
      listOpenPositions: async () => {
        calls.push("open");
        controller.abort(new Error("maintenance lease lost"));
        return [];
      },
      listDeployments: async () => {
        calls.push("deployments");
        return [];
      },
    });
    try {
      await assert.rejects(
        runShadowOptionOpenSafety({ signal: controller.signal }),
        /maintenance lease lost/,
      );
      assert.deepEqual(calls, ["open"]);
    } finally {
      internals.setDependenciesForTests(null);
    }
  });

  await t.test(
    "after mirror repair and before closed reconciliation",
    async () => {
      const controller = new AbortController();
      const calls: string[] = [];
      internals.setDependenciesForTests({
        listDeployments: async () => [{ id: "deployment-1" }],
        repairAutomationMirrors: async () => {
          calls.push("repair");
          controller.abort(new Error("maintenance lease lost"));
          return {
            checkedCount: 0,
            missingCount: 0,
            repairedCount: 0,
            errorCount: 0,
          };
        },
        reconcileClosedWithoutExit: async () => {
          calls.push("closed");
        },
      });
      try {
        await assert.rejects(
          runShadowOptionClosedReconciliation({ signal: controller.signal }),
          /maintenance lease lost/,
        );
        assert.deepEqual(calls, ["repair"]);
      } finally {
        internals.setDependenciesForTests(null);
      }
    },
  );
});

test("closed reconciliation forwards its lease signal into both repair phases", async () => {
  const controller = new AbortController();
  let mirrorSignal: unknown;
  let reconciliationSignal: unknown;
  internals.setDependenciesForTests({
    listDeployments: async () => [{ id: "deployment-1" }],
    repairAutomationMirrors: async (...args: unknown[]) => {
      [mirrorSignal] = args;
      return {
        checkedCount: 0,
        missingCount: 0,
        repairedCount: 0,
        errorCount: 0,
      };
    },
    reconcileClosedWithoutExit: async (input) => {
      reconciliationSignal = (input as unknown as { signal?: AbortSignal })
        .signal;
    },
  });

  try {
    await runShadowOptionClosedReconciliation({ signal: controller.signal });
  } finally {
    internals.setDependenciesForTests(null);
  }

  assert.equal(mirrorSignal, controller.signal);
  assert.equal(reconciliationSignal, controller.signal);
});
