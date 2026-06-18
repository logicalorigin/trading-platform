import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlatformPressureCaps,
  buildPlatformWorkSchedule,
  shouldRunSignalMonitorDisplay,
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

test("massive stock realtime can drive market quotes and charting without broker auth", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: false,
    brokerAuthenticated: false,
    massiveStockRealtimeConfigured: true,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    memoryPressure: { level: "normal", observedAt: "2026-06-09T17:14:00.000Z" },
  });

  assert.equal(schedule.streams.marketStockAggregates, true);
  assert.equal(schedule.leases.activeCharting, true);
  assert.equal(schedule.streams.watchlistQuoteStream, true);
  assert.equal(schedule.streams.positionQuoteStream, false);
  assert.equal(schedule.streams.accountRealtime, false);
});

test("massive stock realtime can drive signal-surface aggregate streams", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: false,
    brokerAuthenticated: false,
    massiveStockRealtimeConfigured: true,
    activeScreen: "signals",
    screenWarmupPhase: "ready",
    memoryPressure: { level: "normal", observedAt: "2026-06-17T21:20:00.000Z" },
  });

  assert.equal(schedule.streams.marketStockAggregates, true);
  assert.equal(schedule.streams.watchlistQuoteStream, true);
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

test("foreground signal matrix display ignores legacy disabled scan profile", () => {
  assert.equal(
    shouldRunSignalMonitorDisplay({
      workVisible: true,
      firstScreenReady: true,
      foregroundReady: true,
      profileEnabled: false,
      profileFetched: true,
      profileError: false,
    }),
    true,
  );
});

test("background signal display still respects a disabled scan profile", () => {
  assert.equal(
    shouldRunSignalMonitorDisplay({
      workVisible: true,
      firstScreenReady: true,
      foregroundReady: false,
      profileEnabled: false,
      profileFetched: true,
      profileError: false,
    }),
    false,
  );
});
