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

test("algo deployment list performs no writes or profile splitting", () => {
  const start = source.indexOf("async function loadAlgoDeploymentList");
  const end = source.indexOf(
    "function readOrStartDeploymentListRequest",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.doesNotMatch(block, /ensureDefaultSignalOptionsPaperDeployment/);
  assert.doesNotMatch(block, /repairMixedSignalOptionsOvernightDeployments/);
  assert.doesNotMatch(block, /\.(?:insert|update|delete)\(/);
});

test("algo deployment creation always honors the requested strategy", () => {
  const start = source.indexOf("export async function createAlgoDeployment");
  const end = source.indexOf(
    "export async function setAlgoDeploymentEnabled",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.match(
    block,
    /const strategy = await getStrategyOrThrow\(input\.strategyId\)/,
  );
  assert.doesNotMatch(block, /ensureDefaultOvernightSpotStrategy/);
});

test("deployment enablement does not inherit the retired global IBKR gate", () => {
  const start = source.indexOf("export async function setAlgoDeploymentEnabled");
  const end = source.indexOf("export async function setAlgoDeploymentMode", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.doesNotMatch(block, /assertAlgoGatewayReady/);
  assert.doesNotMatch(source, /import \{ assertAlgoGatewayReady \}/);
});

test("strategy settings preserve composable equity execution configuration", () => {
  const start = source.indexOf(
    "export async function updateAlgoDeploymentStrategySettings",
  );
  const end = source.indexOf(
    "// Merge two already-desc-sorted",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.match(block, /const config = asRecord\(existing\.config\)/);
  assert.doesNotMatch(block, /stripOvernightSpotFromSignalOptionsConfig/);
});

test("metadata deployment reads bypass P&L decoration while the public list keeps it", () => {
  const metadataStart = source.indexOf(
    "export function listAlgoDeploymentMetadata",
  );
  const publicStart = source.indexOf(
    "export async function listAlgoDeployments",
  );
  assert.notEqual(metadataStart, -1);
  assert.notEqual(publicStart, -1);

  const metadataBlock = source.slice(metadataStart, publicStart);
  const publicBlock = source.slice(publicStart);
  assert.match(metadataBlock, /readOrStartDeploymentListRequest\(input\)/);
  assert.doesNotMatch(metadataBlock, /attachTodayPnlToDeploymentList/);
  assert.match(publicBlock, /attachTodayPnlToDeploymentList/);
  assert.match(publicBlock, /listAlgoDeploymentMetadata\(input\)/);
});
