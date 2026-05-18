import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("algo strategy settings API patches deployment and signal monitor settings", () => {
  const routeSource = readFileSync(
    new URL("../routes/automation.ts", import.meta.url),
    "utf8",
  );
  const serviceSource = readFileSync(
    new URL("./automation.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    routeSource,
    /\/algo\/deployments\/:deploymentId\/strategy-settings/,
  );
  assert.match(serviceSource, /updateAlgoDeploymentStrategySettings/);
  assert.match(serviceSource, /parameters:\s*\{[\s\S]*timeHorizon,[\s\S]*signalTimeframe,/);
  assert.match(serviceSource, /updateSignalMonitorProfile\(\{[\s\S]*timeframe:\s*signalTimeframe,[\s\S]*rayReplicaSettings:\s*nextRayReplicaSettings,/);
  assert.doesNotMatch(
    serviceSource,
    /signalOptions:\s*resolveSignalOptionsExecutionProfile/,
  );
});
