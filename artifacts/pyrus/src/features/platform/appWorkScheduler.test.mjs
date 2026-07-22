import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPlatformPressureCaps,
  buildPlatformWorkSchedule,
  shouldRunSignalMatrixStream,
  shouldRunSignalMonitorDisplay,
} from "./appWorkScheduler.js";

const platformAppSource = readFileSync(
  new URL("./PlatformApp.jsx", import.meta.url),
  "utf8",
);

test("watch pressure stays observational for passive sparkline work", () => {
  const caps = buildPlatformPressureCaps("watch");

  assert.equal(caps.sparklineEnabled, true);
  assert.equal(caps.sparklineConcurrency, 4);
  assert.equal(caps.prioritySparklineSymbolLimit, null);
  assert.equal(caps.signalDisplayPollMinMs, 0);
  assert.equal(caps.signalMatrixPollMinMs, 0);
});

test("high pressure stays observational for polls and passive sparkline work", () => {
  const caps = buildPlatformPressureCaps("high");

  assert.equal(caps.sparklineEnabled, true);
  assert.equal(caps.sparklineConcurrency, 4);
  assert.equal(caps.prioritySparklineSymbolLimit, null);
  assert.equal(caps.signalDisplayPollMinMs, 0);
  assert.equal(caps.signalMatrixPollMinMs, 0);
});

test("Signal Matrix coverage is not truncated by the realtime aggregate fanout budget", () => {
  const caps = buildPlatformPressureCaps();

  assert.equal(caps.signalMatrixWideSymbolLimit, null);
  assert.equal(caps.signalMatrixNarrowSymbolLimit, null);
  assert.equal(caps.signalRealtimeAggregateSymbolLimit, 500);
});

test("high pressure keeps passive visual work in the runtime schedule", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    memoryPressure: { level: "high", observedAt: "2026-06-08T15:34:00.000Z" },
  });

  assert.equal(schedule.leases.passiveVisuals, true);
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

test("runtime streams pause while the active screen is still loading code", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    massiveStockRealtimeConfigured: true,
    activeScreen: "signals",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: false,
    automationEnabled: true,
    tradingEnabled: true,
    memoryPressure: { level: "normal", observedAt: "2026-06-22T20:15:00.000Z" },
  });

  assert.equal(schedule.streams.watchlistQuoteStream, false);
  assert.equal(schedule.streams.marketStockAggregates, false);
  assert.equal(schedule.streams.accountRealtime, false);
  assert.equal(schedule.streams.shadowAccountRealtime, false);
  assert.equal(schedule.streams.broadFlowRuntime, false);
});

test("foreground account streams can run without enabling phone background work", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    massiveStockRealtimeConfigured: true,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: false,
    accountRealtimeAllowed: true,
    tradingEnabled: true,
    mobileViewport: true,
    memoryPressure: { level: "normal", observedAt: "2026-07-19T20:00:00.000Z" },
  });

  assert.equal(schedule.streams.accountRealtime, true);
  assert.equal(schedule.streams.watchlistQuoteStream, false);
  assert.equal(schedule.streams.marketStockAggregates, false);
  assert.equal(schedule.streams.broadFlowRuntime, false);
});

test("foreground Flow scanner can run without enabling phone background work", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: false,
    foregroundFlowAllowed: true,
    mobileViewport: true,
    memoryPressure: { level: "normal", observedAt: "2026-07-20T00:00:00.000Z" },
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.streams.watchlistQuoteStream, false);
  assert.equal(schedule.streams.lowPriorityHistory, false);
});

test("foreground Flow scanner remains blocked during startup protection", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: false,
    foregroundFlowAllowed: true,
    mobileViewport: true,
    startupProtectionActive: true,
    memoryPressure: { level: "normal", observedAt: "2026-07-20T00:00:00.000Z" },
  });

  assert.equal(schedule.streams.broadFlowRuntime, false);
});

test("PlatformApp applies foreground account readiness to the live stream schedule", () => {
  const hiddenScheduleStart = platformAppSource.indexOf(
    "const hiddenScreenPreloadPolicy = useMemo",
  );
  const liveScheduleStart = platformAppSource.indexOf(
    "const workSchedule = useMemo",
  );
  assert.notEqual(hiddenScheduleStart, -1);
  assert.notEqual(liveScheduleStart, -1);

  const hiddenSchedule = platformAppSource.slice(
    hiddenScheduleStart,
    platformAppSource.indexOf(
      "const hiddenScreenWarmMountAllowed",
      hiddenScheduleStart,
    ),
  );
  const liveSchedule = platformAppSource.slice(
    liveScheduleStart,
    platformAppSource.indexOf(
      "useIbkrAccountSnapshotStream",
      liveScheduleStart,
    ),
  );

  assert.doesNotMatch(hiddenSchedule, /accountRealtimeAllowed/);
  assert.match(
    liveSchedule,
    /accountRealtimeAllowed: firstScreenReady && !safeQaMode/,
  );
});

test("trade chart priority does not start the broad flow scanner", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    massiveStockRealtimeConfigured: true,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: true,
    memoryPressure: { level: "normal", observedAt: "2026-06-27T15:10:00.000Z" },
  });

  assert.equal(schedule.streams.broadFlowRuntime, false);
  assert.equal(schedule.leases.flowDiscovery, false);
});

test("watch memory pressure does not redefine hydration availability", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
    memoryPressure: { level: "watch", observedAt: "2026-06-08T15:34:00.000Z" },
  });

  assert.equal(schedule.hydrationPressure, "normal");
});

test("high memory pressure does not back off unrelated hydration work", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
    memoryPressure: { level: "high", observedAt: "2026-06-08T15:34:00.000Z" },
  });

  assert.equal(schedule.hydrationPressure, "normal");
});

test("IBKR backoff cannot become a global hydration gate", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
    ibkrWorkPressure: "backoff",
    memoryPressure: { level: "normal", observedAt: null },
  });

  assert.equal(schedule.hydrationPressure, "normal");
  assert.equal(schedule.classes.backgroundIbkr, false);
});

test("an unmeasured memory snapshot does not block background data work", () => {
  const schedule = buildPlatformWorkSchedule({
    runtimeActive: true,
    sessionMetadataSettled: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    memoryPressure: { level: "high", observedAt: null, measurement: null },
  });

  assert.equal(schedule.memoryPressure.observed, false);
  assert.equal(schedule.classes.memoryAllowsBackground, true);
  assert.equal(schedule.classes.backgroundIbkr, true);
  assert.equal(schedule.streams.lowPriorityHistory, true);
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

test("foreground algo signal matrix stream does not require background warmup", () => {
  assert.equal(
    shouldRunSignalMatrixStream({
      profileUniverse: true,
      screen: "algo",
      foregroundReady: true,
      backgroundAllowed: false,
      screenWarmupPhase: "ready",
    }),
    true,
  );
});

test("non-signal surfaces still need the background stream gate", () => {
  assert.equal(
    shouldRunSignalMatrixStream({
      profileUniverse: true,
      screen: "market",
      foregroundReady: false,
      backgroundAllowed: false,
      screenWarmupPhase: "ready",
    }),
    false,
  );
});

test("signal matrix stream remains blocked during startup protection", () => {
  assert.equal(
    shouldRunSignalMatrixStream({
      profileUniverse: true,
      screen: "algo",
      foregroundReady: true,
      backgroundAllowed: false,
      screenWarmupPhase: "ready",
      startupProtectionActive: true,
    }),
    false,
  );
});
