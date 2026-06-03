import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlatformWorkSchedule } from "./appWorkScheduler.js";
import { WORK_PRESSURE_STATE } from "./workPressureModel.js";

const baseInput = {
  pageVisible: true,
  sessionMetadataSettled: true,
  brokerConfigured: true,
  brokerAuthenticated: true,
};

test("keeps account realtime critical for automation away from account screen", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "research",
    automationEnabled: true,
  });

  assert.equal(schedule.streams.watchlistQuoteStream, true);
  assert.equal(schedule.streams.accountRealtime, true);
  assert.equal(schedule.streams.accountRealtimeCritical, true);
});

test("keeps background automation account realtime under high memory pressure", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "research",
    automationEnabled: true,
    memoryPressure: {
      level: "high",
      observedAt: "2026-05-28T16:00:00.000Z",
    },
  });

  assert.equal(schedule.streams.accountRealtime, true);
  assert.equal(schedule.streams.accountRealtimeCritical, true);
  assert.equal(schedule.streams.watchlistQuoteStream, true);
});

test("startup protection keeps first-screen quotes while holding background fanout", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "algo",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: true,
    automationEnabled: true,
    startupProtectionActive: true,
  });

  assert.equal(schedule.startupProtection.active, true);
  assert.equal(schedule.streams.watchlistQuoteStream, true);
  assert.equal(schedule.streams.broadFlowRuntime, false);
  assert.equal(schedule.streams.accountRealtime, false);
  assert.equal(schedule.streams.lowPriorityHistory, false);
  assert.equal(schedule.resume.backgroundRefresh, false);
  assert.equal(schedule.hiddenScreenPreload.codeOnly, false);
});

test("startup protection still allows active account and trading realtime", () => {
  const accountSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
    screenWarmupPhase: "ready",
    startupProtectionActive: true,
  });
  const tradeSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
    tradingEnabled: true,
    startupProtectionActive: true,
  });

  assert.equal(accountSchedule.streams.accountRealtime, true);
  assert.equal(tradeSchedule.streams.accountRealtime, true);
  assert.equal(accountSchedule.streams.broadFlowRuntime, false);
  assert.equal(tradeSchedule.streams.broadFlowRuntime, false);
});

test("keeps active account realtime under high memory pressure", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
    memoryPressure: {
      level: "high",
      observedAt: "2026-05-28T16:00:00.000Z",
    },
  });

  assert.equal(schedule.streams.accountRealtime, true);
  assert.equal(schedule.streams.accountRealtimeCritical, true);
});

test("keeps lightweight quote stream active across visible authenticated screens", () => {
  const accountSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
    screenWarmupPhase: "ready",
  });
  const algoSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "algo",
    screenWarmupPhase: "ready",
  });

  assert.equal(accountSchedule.streams.watchlistQuoteStream, true);
  assert.equal(algoSchedule.streams.watchlistQuoteStream, true);
  assert.equal(accountSchedule.streams.marketStockAggregates, false);
  assert.equal(algoSchedule.streams.marketStockAggregates, false);
});

test("keeps account realtime during backoff for active trading state", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "trade",
    tradingEnabled: true,
    ibkrWorkPressure: WORK_PRESSURE_STATE.backoff,
  });

  assert.equal(schedule.streams.accountRealtime, true);
  assert.equal(schedule.classes.foregroundIbkr, false);
  assert.equal(schedule.classes.realtimeIbkr, true);
  assert.equal(schedule.streams.watchlistQuoteStream, true);
});

test("keeps header broad flow runtime on account after first-screen warmup", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
    screenWarmupPhase: "ready",
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
});

test("keeps header broad flow independent of background resume gates", () => {
  const beforeResume = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
    screenWarmupPhase: "ready",
    backgroundResumeReady: false,
  });
  const afterResume = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
    screenWarmupPhase: "ready",
    backgroundResumeReady: true,
  });

  assert.equal(beforeResume.streams.broadFlowRuntime, true);
  assert.equal(afterResume.streams.broadFlowRuntime, true);
});

test("keeps broad flow runtime owned without broker readiness", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
    brokerConfigured: false,
    brokerAuthenticated: false,
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.streams.accountRealtime, false);
  assert.equal(schedule.streams.watchlistQuoteStream, false);
  assert.equal(schedule.streams.marketStockAggregates, false);
});

test("keeps passive market flow owned while limiting low-priority history under degraded pressure", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    ibkrWorkPressure: WORK_PRESSURE_STATE.degraded,
    backgroundResumeReady: true,
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.leases.flowDiscovery, true);
  assert.equal(schedule.streams.marketStockAggregates, true);
  assert.equal(schedule.streams.lowPriorityHistory, false);
});

test("keeps passive market flow owned during lane backoff so scanner state stays visible", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    ibkrWorkPressure: WORK_PRESSURE_STATE.backoff,
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.leases.flowDiscovery, true);
  assert.equal(schedule.classes.foregroundIbkr, false);
  assert.equal(schedule.streams.marketStockAggregates, false);
  assert.equal(schedule.streams.lowPriorityHistory, false);
});

test("keeps active Flow scanner foreground while background work is constrained", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
    ibkrWorkPressure: WORK_PRESSURE_STATE.degraded,
    memoryPressure: {
      level: "watch",
      observedAt: "2026-05-06T00:00:00.000Z",
    },
  });

  assert.equal(schedule.classes.foregroundIbkr, true);
  assert.equal(schedule.classes.backgroundIbkr, false);
  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.streams.lowPriorityHistory, false);
});

test("keeps header flow owner when active Flow IBKR work is stalled", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
    ibkrWorkPressure: WORK_PRESSURE_STATE.stalled,
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.classes.realtimeIbkr, false);
  assert.equal(schedule.streams.watchlistQuoteStream, true);
  assert.equal(schedule.streams.marketStockAggregates, false);
  assert.equal(schedule.streams.accountRealtime, false);
});

test("keeps shared flow runtime disabled while broad scanner owns flow", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
  });

  assert.equal(schedule.streams.sharedFlowRuntime, false);
  assert.equal(schedule.streams.broadFlowRuntime, true);
});

test("limits low-priority history to history-heavy active screens", () => {
  const marketSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
  });
  const researchSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "research",
    screenWarmupPhase: "ready",
  });

  assert.equal(marketSchedule.streams.lowPriorityHistory, true);
  assert.equal(researchSchedule.streams.lowPriorityHistory, false);
  assert.equal(marketSchedule.hiddenScreenPreload.codeOnly, true);
  assert.equal(marketSchedule.hiddenScreenPreload.mountScreens, false);
});

test("keeps header flow independent of active screen background work", () => {
  const beforeReady = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: false,
  });
  const afterReady = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: true,
  });

  assert.equal(beforeReady.streams.broadFlowRuntime, true);
  assert.equal(afterReady.streams.broadFlowRuntime, true);
  assert.equal(afterReady.leases.flowDiscovery, true);
});

test("idle code preloads require a background lease and never warm-mount hidden screens", () => {
  const blocked = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: false,
  });
  const allowed = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: true,
  });

  assert.equal(blocked.hiddenScreenPreload.codeOnly, false);
  assert.equal(blocked.leases.idlePreload, false);
  assert.equal(allowed.hiddenScreenPreload.codeOnly, true);
  assert.equal(allowed.leases.idlePreload, true);
  assert.equal(allowed.hiddenScreenPreload.mountScreens, false);
  assert.equal(allowed.leases.hiddenMount, false);
});

test("holds low-priority history until operational preload finishes", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "warming",
  });

  assert.equal(schedule.hiddenScreenPreload.codeOnly, true);
  assert.equal(schedule.streams.lowPriorityHistory, false);
});

test("holds low-priority history until active screen allows background work", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    activeScreenBackgroundAllowed: false,
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.streams.lowPriorityHistory, false);
});

test("memory watch pressure is telemetry-only for work scheduling", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    memoryPressure: {
      level: "watch",
      observedAt: "2026-05-06T00:00:00.000Z",
    },
  });

  assert.equal(schedule.hydrationPressure, "normal");
  assert.equal(schedule.streams.marketStockAggregates, true);
  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.pressureCaps.broadMarketSymbolLimit, null);
  assert.equal(schedule.pressureCaps.broadFlowSymbolLimit, null);
  assert.deepEqual(schedule.pressureCaps.broadFlowScannerConfig, {});
  assert.equal(schedule.pressureCaps.signalMatrixWideSymbolLimit, 250);
  assert.equal(schedule.pressureCaps.signalMatrixNarrowSymbolLimit, 250);
  assert.equal(schedule.streams.lowPriorityHistory, true);
  assert.equal(schedule.hiddenScreenPreload.codeOnly, true);
  assert.equal(schedule.hiddenScreenPreload.mountScreens, false);
});

test("critical memory pressure stalls heavy hydration but keeps core quote reader alive", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
    memoryPressure: {
      level: "critical",
      observedAt: "2026-05-06T00:00:00.000Z",
    },
  });

  assert.equal(schedule.hydrationPressure, "stalled");
  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.pressureCaps.broadFlowRuntimeEnabled, true);
  assert.equal(schedule.pressureCaps.broadFlowSymbolLimit, null);
  assert.deepEqual(schedule.pressureCaps.broadFlowScannerConfig, {});
  assert.equal(schedule.pressureCaps.signalMatrixWideSymbolLimit, 8);
  assert.equal(schedule.pressureCaps.signalMatrixNarrowSymbolLimit, 8);
  assert.equal(schedule.pressureCaps.sparklineEnabled, false);
  assert.equal(schedule.classes.foregroundIbkr, false);
  assert.equal(schedule.classes.realtimeIbkr, true);
  assert.equal(schedule.streams.watchlistQuoteStream, true);
  assert.equal(schedule.streams.lowPriorityHistory, false);
  assert.equal(schedule.resume.backgroundRefresh, false);
  assert.equal(schedule.hiddenScreenPreload.codeOnly, false);
});

test("high memory pressure keeps broad flow owned without scanner throughput caps", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
    memoryPressure: {
      level: "high",
      observedAt: "2026-05-06T00:00:00.000Z",
    },
  });

  assert.equal(schedule.hydrationPressure, "normal");
  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.pressureCaps.broadFlowSymbolLimit, null);
  assert.deepEqual(schedule.pressureCaps.broadFlowScannerConfig, {});
  assert.equal(schedule.pressureCaps.signalMatrixWideSymbolLimit, 250);
  assert.equal(schedule.pressureCaps.signalMatrixNarrowSymbolLimit, 250);
  assert.equal(schedule.pressureCaps.sparklineConcurrency, 4);
});

test("pauses broad flow runtime while page is hidden", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    pageVisible: false,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
  });

  assert.equal(schedule.streams.broadFlowRuntime, false);
  assert.equal(schedule.streams.accountRealtime, false);
  assert.equal(schedule.streams.marketStockAggregates, false);
  assert.equal(schedule.streams.watchlistQuoteStream, false);
});

test("defers broad flow runtime before session metadata settles", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    sessionMetadataSettled: false,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
  });

  assert.equal(schedule.streams.broadFlowRuntime, false);
});

test("holds passive market discovery until first-screen warmup is ready", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "initial",
  });

  assert.equal(schedule.streams.broadFlowRuntime, false);
  assert.equal(schedule.streams.lowPriorityHistory, false);
  assert.equal(schedule.hiddenScreenPreload.codeOnly, false);
  assert.equal(schedule.hiddenScreenPreload.mountScreens, false);
});

test("waits for a first memory sample before starting background work but keeps header flow", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
    screenWarmupPhase: "ready",
    memoryPressure: {
      level: "normal",
      observedAt: null,
    },
  });

  assert.equal(schedule.memoryPressure.observed, false);
  assert.equal(schedule.streams.lowPriorityHistory, false);
  assert.equal(schedule.hiddenScreenPreload.mountScreens, false);
  assert.equal(schedule.streams.broadFlowRuntime, true);
});

test("keeps broad flow runtime on non-flow work screens after first-screen warmup", () => {
  const tradeSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "trade",
    screenWarmupPhase: "ready",
  });
  const algoSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "algo",
    screenWarmupPhase: "ready",
  });

  assert.equal(tradeSchedule.streams.broadFlowRuntime, true);
  assert.equal(algoSchedule.streams.broadFlowRuntime, true);
});

test("mobile header keeps broad flow runtime beyond the Flow screen", () => {
  const marketSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    mobileViewport: true,
  });
  const flowSchedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "flow",
    screenWarmupPhase: "ready",
    mobileViewport: true,
  });

  assert.equal(marketSchedule.streams.broadFlowRuntime, true);
  assert.equal(flowSchedule.streams.broadFlowRuntime, true);
});
