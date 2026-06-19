import assert from "node:assert/strict";
import test from "node:test";

import {
  __algoAutomationInternalsForTests,
  applyDeploymentToListCache,
} from "./automation";

test("strategy settings accept 2m signal timeframe", () => {
  assert.equal(
    __algoAutomationInternalsForTests.readSignalTimeframe("2m"),
    "2m",
  );
});

test("strategy settings reject unsupported signal timeframe", () => {
  assert.throws(
    () => __algoAutomationInternalsForTests.readSignalTimeframe("30m"),
    /Unsupported signal timeframe/,
  );
});

test("algo deployment list identifies default signal-options deployments", () => {
  assert.equal(
    __algoAutomationInternalsForTests.deploymentHasSignalOptionsProfile({
      name: "Custom Paper",
      config: {
        parameters: {
          executionMode: "signal_options",
        },
      },
    }),
    true,
  );
  assert.equal(
    __algoAutomationInternalsForTests.deploymentHasSignalOptionsProfile({
      name: "Pyrus Signals Options Shadow",
      config: {},
    }),
    true,
  );
  assert.equal(
    __algoAutomationInternalsForTests.deploymentHasSignalOptionsProfile({
      name: "Equity Shadow",
      config: {
        parameters: {
          executionMode: "signal_equity_shadow",
        },
      },
    }),
    false,
  );
});

test("algo deployment list filters retired shadow equity-forward deployments", () => {
  const now = new Date("2026-06-08T00:00:00.000Z");
  const rows = [
    {
      id: "deployment-retired",
      strategyId: "strategy-retired",
      name: "Retired",
      mode: "shadow",
      enabled: false,
      providerAccountId: "shadow",
      symbolUniverse: ["SPY"],
      config: {
        parameters: {
          executionMode: "signal_equity_shadow",
        },
      },
      lastEvaluatedAt: null,
      lastSignalAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "deployment-signal-options",
      strategyId: "strategy-signal-options",
      name: "Pyrus Signals Options Shadow",
      mode: "shadow",
      enabled: true,
      providerAccountId: "shadow",
      symbolUniverse: ["SPY", "QQQ"],
      config: {
        signalOptions: {
          version: 1,
        },
      },
      lastEvaluatedAt: null,
      lastSignalAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const response =
    __algoAutomationInternalsForTests.buildDeploymentListResponse(rows as never);

  assert.deepEqual(
    response.deployments.map((deployment) => deployment.id),
    ["deployment-signal-options"],
  );
});

test("algo deployment list cache serves mode fallback from all-deployments cache", () => {
  const now = new Date("2026-06-08T00:00:00.000Z");
  const rows = [
    {
      id: "deployment-paper",
      strategyId: "strategy-signal-options",
      name: "Pyrus Signals Options Shadow",
      mode: "shadow",
      enabled: true,
      providerAccountId: "shadow",
      symbolUniverse: ["SPY"],
      config: {
        signalOptions: {
          version: 1,
        },
      },
      lastEvaluatedAt: null,
      lastSignalAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "deployment-live",
      strategyId: "strategy-signal-options",
      name: "Pyrus Signals Options Live",
      mode: "live",
      enabled: false,
      providerAccountId: "U24762790",
      symbolUniverse: ["SPY"],
      config: {
        signalOptions: {
          version: 1,
        },
      },
      lastEvaluatedAt: null,
      lastSignalAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const response =
    __algoAutomationInternalsForTests.buildDeploymentListResponse(rows as never);

  __algoAutomationInternalsForTests.clearDeploymentListCacheForTests();
  try {
    __algoAutomationInternalsForTests.rememberDeploymentListCache({}, response);

    const cachedPaper =
      __algoAutomationInternalsForTests.readDeploymentListCache({
        mode: "shadow",
      });

    assert.ok(cachedPaper);
    assert.equal(cachedPaper.cacheStatus, "stale");
    assert.deepEqual(
      cachedPaper.deployments.map((deployment) => deployment.id),
      ["deployment-paper"],
    );
  } finally {
    __algoAutomationInternalsForTests.clearDeploymentListCacheForTests();
  }
});

// Regression: a deployment mutation must write through to the in-memory list
// cache, or the pool-contention fallback keeps serving pre-save "old control
// inputs" until a later uncontended read overwrites it.
test("applyDeploymentToListCache keeps the fallback cache fresh after a mutation", () => {
  const {
    clearDeploymentListCacheForTests,
    rememberDeploymentListCache,
    buildDeploymentListResponse,
    readDeploymentListCache,
  } = __algoAutomationInternalsForTests;
  const base = {
    id: "deployment-paper",
    strategyId: "strategy-signal-options",
    name: "Pyrus Signals Options Shadow",
    mode: "shadow",
    enabled: false,
    providerAccountId: "U24762790",
    symbolUniverse: ["SPY"],
    config: { signalOptions: { version: 1 } },
    lastEvaluatedAt: null,
    lastSignalAt: null,
    lastError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  clearDeploymentListCacheForTests();
  try {
    rememberDeploymentListCache({}, buildDeploymentListResponse([base] as never));

    // A save flips `enabled`; write-through must update the cached row.
    applyDeploymentToListCache({ ...base, enabled: true } as never);
    const updated = readDeploymentListCache({});
    assert.ok(updated);
    assert.equal(updated.deployments.length, 1);
    assert.equal(updated.deployments[0].enabled, true);

    // A brand-new deployment is inserted (prepended, newest-first).
    applyDeploymentToListCache({
      ...base,
      id: "deployment-paper-2",
      name: "Custom Paper",
    } as never);
    const after = readDeploymentListCache({});
    assert.deepEqual(
      after?.deployments.map((deployment) => deployment.id),
      ["deployment-paper-2", "deployment-paper"],
    );
  } finally {
    clearDeploymentListCacheForTests();
  }
});

// Regression: a pool-acquire timeout ("all pooled connections are busy right now")
// is NOT a database outage. Tripping the 15s deployment-list backoff on it locks out
// the read during the exact startup window the pool is saturated, surfacing
// "deployment unavailable" on the algo screen for 15s though the deployment exists.
test("deployment list backoff does NOT trip on a pool-acquire timeout", () => {
  const { markDeploymentListError, deploymentListDbBackoff } =
    __algoAutomationInternalsForTests;
  deploymentListDbBackoff.resetForTest();
  const now = 1_000_000;
  const poolError = new Error(
    "pool timed out while waiting for an open connection",
  );
  const handled = markDeploymentListError(poolError, now);
  assert.equal(handled, true, "still handled — serve cached fallback");
  assert.equal(
    deploymentListDbBackoff.isActive(now + 1),
    false,
    "pool contention must not open the lockout (next read retries immediately)",
  );
  deploymentListDbBackoff.resetForTest();
});

test("deployment list backoff DOES trip on a genuine transient connectivity error", () => {
  const { markDeploymentListError, deploymentListDbBackoff } =
    __algoAutomationInternalsForTests;
  deploymentListDbBackoff.resetForTest();
  const now = 2_000_000;
  const connError = Object.assign(
    new Error("connection terminated unexpectedly"),
    { code: "57P01" },
  );
  assert.equal(markDeploymentListError(connError, now), true);
  assert.equal(
    deploymentListDbBackoff.isActive(now + 1),
    true,
    "a real connectivity failure still backs off",
  );
  deploymentListDbBackoff.resetForTest();
});

test("deployment list backoff ignores non-transient errors", () => {
  const { markDeploymentListError, deploymentListDbBackoff } =
    __algoAutomationInternalsForTests;
  deploymentListDbBackoff.resetForTest();
  assert.equal(
    markDeploymentListError(new Error("syntax error at or near FOO"), 3_000_000),
    false,
    "non-transient errors are not handled here",
  );
  assert.equal(deploymentListDbBackoff.isActive(3_000_001), false);
});
