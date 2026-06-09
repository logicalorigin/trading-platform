import assert from "node:assert/strict";
import test from "node:test";

import { __algoAutomationInternalsForTests } from "./automation";

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
      name: "Pyrus Signals Options Shadow Paper",
      config: {},
    }),
    true,
  );
  assert.equal(
    __algoAutomationInternalsForTests.deploymentHasSignalOptionsProfile({
      name: "Equity Shadow Paper",
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
      mode: "paper",
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
      name: "Pyrus Signals Options Shadow Paper",
      mode: "paper",
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
      name: "Pyrus Signals Options Shadow Paper",
      mode: "paper",
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
        mode: "paper",
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
