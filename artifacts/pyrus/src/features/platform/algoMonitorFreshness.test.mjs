import assert from "node:assert/strict";
import test from "node:test";

import { resolveAlgoMonitorRestPolling } from "./algoMonitorFreshness.js";

test("shell-wide algo stream freshness does not suppress deployment REST polling", () => {
  const result = resolveAlgoMonitorRestPolling({
    restQueriesActive: true,
    deploymentId: "deployment-1",
    streamFreshness: {
      deploymentId: null,
      algoPrimaryFresh: true,
      algoFullFresh: true,
    },
  });

  assert.equal(result.streamHydratesSelectedDeployment, false);
  assert.equal(result.deploymentDataFreshness.algoPrimaryFresh, false);
  assert.equal(result.deploymentDataFreshness.algoFullFresh, false);
  assert.equal(result.primaryPollInterval, 30_000);
  assert.equal(result.derivedPollInterval, 30_000);
});

test("deployment-scoped algo stream freshness can suppress REST polling", () => {
  const result = resolveAlgoMonitorRestPolling({
    restQueriesActive: true,
    deploymentId: "deployment-1",
    streamFreshness: {
      deploymentId: "deployment-1",
      algoPrimaryFresh: true,
      algoFullFresh: true,
    },
  });

  assert.equal(result.streamHydratesSelectedDeployment, true);
  assert.equal(result.deploymentDataFreshness.algoPrimaryFresh, true);
  assert.equal(result.deploymentDataFreshness.algoFullFresh, true);
  assert.equal(result.primaryPollInterval, false);
  assert.equal(result.derivedPollInterval, false);
});
