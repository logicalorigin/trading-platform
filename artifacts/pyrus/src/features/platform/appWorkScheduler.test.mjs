import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlatformPressureCaps,
  buildPlatformWorkSchedule,
} from "./appWorkScheduler.js";

test("watch pressure reduces passive sparkline concurrency", () => {
  const caps = buildPlatformPressureCaps("watch");

  assert.equal(caps.sparklineEnabled, true);
  assert.equal(caps.sparklineConcurrency, 2);
  assert.equal(caps.prioritySparklineSymbolLimit, null);
});

test("high pressure disables passive sparkline history work", () => {
  const caps = buildPlatformPressureCaps("high");

  assert.equal(caps.sparklineEnabled, false);
  assert.equal(caps.sparklineConcurrency, 0);
  assert.equal(caps.prioritySparklineSymbolLimit, 0);
});

test("high pressure removes passive visual work from the runtime schedule", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    memoryPressure: { level: "high", observedAt: "2026-06-08T15:34:00.000Z" },
  });

  assert.equal(schedule.leases.passiveVisuals, false);
});

test("watch pressure degrades hydration without blocking near-priority work", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
    memoryPressure: { level: "watch", observedAt: "2026-06-08T15:34:00.000Z" },
  });

  assert.equal(schedule.hydrationPressure, "degraded");
});

test("high pressure backs off non-visible hydration work", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
    memoryPressure: { level: "high", observedAt: "2026-06-08T15:34:00.000Z" },
  });

  assert.equal(schedule.hydrationPressure, "backoff");
});
