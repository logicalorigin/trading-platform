import assert from "node:assert/strict";
import test from "node:test";

import {
  readAlgoCockpitStreamFreshness,
  recordAlgoCockpitStreamFreshness,
  resetAlgoCockpitStreamFreshnessRegistryForTests,
} from "./algoCockpitStreamFreshnessRegistry.js";
import { resolveAlgoMonitorRestPolling } from "./algoMonitorFreshness.js";

const FRESH_MS = 7_000;

test("unknown deployment reads as null (consumer falls back to its own stream)", () => {
  resetAlgoCockpitStreamFreshnessRegistryForTests();
  assert.equal(readAlgoCockpitStreamFreshness("deployment-1", 1_000, FRESH_MS), null);
  assert.equal(readAlgoCockpitStreamFreshness("", 1_000, FRESH_MS), null);
  assert.equal(readAlgoCockpitStreamFreshness(null, 1_000, FRESH_MS), null);
});

test("recorded primary/full events read back fresh, then decay past the threshold", () => {
  resetAlgoCockpitStreamFreshnessRegistryForTests();
  recordAlgoCockpitStreamFreshness("deployment-1", "primary", 10_000);

  const fresh = readAlgoCockpitStreamFreshness("deployment-1", 12_000, FRESH_MS);
  assert.equal(fresh.deploymentScoped, true);
  assert.equal(fresh.algoPrimaryFresh, true);
  assert.equal(fresh.algoFullFresh, false);

  recordAlgoCockpitStreamFreshness("deployment-1", "full", 13_000);
  const full = readAlgoCockpitStreamFreshness("deployment-1", 14_000, FRESH_MS);
  assert.equal(full.algoPrimaryFresh, true);
  assert.equal(full.algoFullFresh, true);

  const stale = readAlgoCockpitStreamFreshness("deployment-1", 13_000 + FRESH_MS + 1, FRESH_MS);
  assert.equal(stale.algoPrimaryFresh, false);
  assert.equal(stale.algoFullFresh, false);
});

test("heartbeat marks the stream alive without claiming primary/full hydration", () => {
  resetAlgoCockpitStreamFreshnessRegistryForTests();
  recordAlgoCockpitStreamFreshness("deployment-1", "heartbeat", 10_000);
  const read = readAlgoCockpitStreamFreshness("deployment-1", 11_000, FRESH_MS);
  assert.equal(read.algoFresh, true);
  assert.equal(read.algoPrimaryFresh, false);
  assert.equal(read.algoFullFresh, false);
});

test("registry freshness suppresses the sidebar REST catch-up polling (the algo-page bug)", () => {
  resetAlgoCockpitStreamFreshnessRegistryForTests();
  // AlgoScreen owns the EventSource and records; the sidebar (own stream gated
  // off, shell freshness unscoped) reads the registry instead of EMPTY.
  recordAlgoCockpitStreamFreshness("deployment-1", "full", 10_000);
  const streamFreshness = readAlgoCockpitStreamFreshness("deployment-1", 11_000, FRESH_MS);

  const result = resolveAlgoMonitorRestPolling({
    restQueriesActive: true,
    deploymentId: "deployment-1",
    streamFreshness,
  });
  assert.equal(result.streamHydratesSelectedDeployment, true);
  assert.equal(result.primaryPollInterval, false);
  assert.equal(result.derivedPollInterval, false);
});

test("tracked-deployment cap evicts the oldest entry, not the newest", () => {
  resetAlgoCockpitStreamFreshnessRegistryForTests();
  for (let i = 0; i < 70; i += 1) {
    recordAlgoCockpitStreamFreshness(`deployment-${i}`, "primary", 10_000 + i);
  }
  assert.equal(readAlgoCockpitStreamFreshness("deployment-0", 10_100, FRESH_MS), null);
  assert.notEqual(readAlgoCockpitStreamFreshness("deployment-69", 10_100, FRESH_MS), null);
});
