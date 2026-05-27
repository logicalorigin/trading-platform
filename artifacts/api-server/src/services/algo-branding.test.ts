import assert from "node:assert/strict";
import test from "node:test";
import {
  hasLegacyAlgoBranding,
  normalizeLegacyAlgoBranding,
  normalizeLegacyAlgoBrandText,
} from "./algo-branding";

test("normalizes retired Ray algo branding in API payloads", () => {
  assert.equal(
    normalizeLegacyAlgoBrandText("RayReplica Signal Options Shadow Paper"),
    "Pyrus Signals Options Shadow Paper",
  );
  assert.equal(
    normalizeLegacyAlgoBrandText("RayAlgo cockpit"),
    "Pyrus cockpit",
  );
  assert.equal(
    normalizeLegacyAlgoBrandText("rayreplica"),
    "pyrus-signals",
  );
  assert.equal(
    normalizeLegacyAlgoBrandText("rayalgo-replica-smc-pro-v3"),
    "pyrus-signals-smc-pro-v3",
  );
  assert.equal(
    normalizeLegacyAlgoBrandText("RayAlgo Replica (SMC Pro v3)"),
    "Pyrus Signals (SMC Pro v3)",
  );
  assert.equal(
    normalizeLegacyAlgoBrandText("Ray_Algo"),
    "Pyrus",
  );
  assert.equal(
    normalizeLegacyAlgoBrandText("rayReplicaSettings"),
    "pyrusSignalsSettings",
  );
  assert.equal(
    normalizeLegacyAlgoBrandText("RAYALGO DASHBOARD"),
    "PYRUS DASHBOARD",
  );

  const payload = normalizeLegacyAlgoBranding({
    deploymentName: "RayReplica Signal Options Shadow Paper",
    config: {
      strategyId: "ray_replica_signals",
      indicator: "rayreplica",
      runtimeAdapterKey: "rayalgo-replica-smc-pro-v3",
      rayReplicaSettings: { dashboardTitle: "RAYALGO DASHBOARD" },
    },
  });

  assert.deepEqual(payload, {
    deploymentName: "Pyrus Signals Options Shadow Paper",
    config: {
      strategyId: "pyrus_signals",
      indicator: "pyrus-signals",
      runtimeAdapterKey: "pyrus-signals-smc-pro-v3",
      pyrusSignalsSettings: { dashboardTitle: "PYRUS DASHBOARD" },
    },
  });
  assert.equal(hasLegacyAlgoBranding(payload), false);
  assert.equal(hasLegacyAlgoBranding({ source: "rayreplica" }), true);
});
