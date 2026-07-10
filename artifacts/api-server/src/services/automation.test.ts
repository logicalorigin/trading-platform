import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __algoAutomationInternalsForTests } from "./automation";

const source = readFileSync(new URL("./automation.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

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

test("mixed signal-options and overnight deployment shape splits into dedicated configs", () => {
  const mixedConfig = {
    source: "default_signal_options_seed",
    marketDataAccountId: "U123",
    executionAccountId: "shadow",
    parameters: {
      executionMode: "signal_options",
      signalTimeframe: "5m",
      overnightSpotTrading: { enabled: true, executionMode: "shadow" },
      overnightSpot: { enabled: true, signalTimeframe: "15m" },
    },
    signalOptions: { version: 1 },
    overnightSpot: {
      enabled: true,
      executionMode: "shadow",
      signalTimeframe: "5m",
      defaultOrderNotional: 500,
    },
  };

  assert.equal(
    __algoAutomationInternalsForTests.deploymentHasMixedSignalOptionsAndOvernightProfile(
      {
        name: "Pyrus Signals Options Shadow",
        config: mixedConfig,
      },
    ),
    true,
  );

  const signalOptionsConfig =
    __algoAutomationInternalsForTests.stripOvernightSpotFromSignalOptionsConfig(
      mixedConfig,
    );
  assert.deepEqual(Object.keys(signalOptionsConfig).sort(), [
    "executionAccountId",
    "marketDataAccountId",
    "parameters",
    "signalOptions",
    "source",
  ]);
  assert.deepEqual(signalOptionsConfig.parameters, {
    executionMode: "signal_options",
    signalTimeframe: "5m",
  });
  assert.deepEqual(signalOptionsConfig.signalOptions, { version: 1 });

  const overnightConfig =
    __algoAutomationInternalsForTests.buildOvernightSpotDeploymentConfig(
      mixedConfig,
    );
  assert.deepEqual(overnightConfig, {
    source: "overnight_spot_repaired",
    marketDataAccountId: "U123",
    executionAccountId: "shadow",
    parameters: { overnightSpotTrading: true },
    overnightSpot: {
      enabled: true,
      executionMode: "shadow",
      signalTimeframe: "5m",
      defaultOrderNotional: 500,
    },
  });
  assert.equal(
    __algoAutomationInternalsForTests.deploymentHasSignalOptionsProfile({
      name: "Overnight Equities",
      config: overnightConfig,
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

test("algo deployment list never substitutes stale cached rows", () => {
  const start = source.indexOf("async function loadAlgoDeploymentList");
  const end = source.indexOf("export async function listAlgoDeployments", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.doesNotMatch(block, /deploymentListFallback/);
  assert.doesNotMatch(block, /readDeploymentListCache/);
  assert.doesNotMatch(block, /cacheStatus:\s*"stale"/);
  assert.doesNotMatch(block, /cacheStatus:\s*"unavailable"/);
  assert.doesNotMatch(source, /applyDeploymentToListCache/);
  assert.doesNotMatch(indexSource, /listAlgoDeployments/);
  assert.doesNotMatch(indexSource, /deployment-list cache prime/);
});
