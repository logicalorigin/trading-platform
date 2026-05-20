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
});

test("defers broad flow runtime on account until background resume", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
    screenWarmupPhase: "ready",
  });

  assert.equal(schedule.streams.broadFlowRuntime, false);
});

test("starts broad flow runtime after background resume is allowed", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
    screenWarmupPhase: "ready",
    backgroundResumeReady: true,
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
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

test("keeps non-Flow broad aggregate reader when background IBKR work is blocked", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    ibkrWorkPressure: WORK_PRESSURE_STATE.degraded,
    backgroundResumeReady: true,
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.streams.marketStockAggregates, true);
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

test("holds low-priority history until operational preload finishes", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "warming",
  });

  assert.equal(schedule.hiddenScreenPreload.codeOnly, true);
  assert.equal(schedule.streams.lowPriorityHistory, false);
});

test("memory watch pressure blocks low-priority background hydration first", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    backgroundResumeReady: true,
    memoryPressure: {
      level: "watch",
      observedAt: "2026-05-06T00:00:00.000Z",
    },
  });

  assert.equal(schedule.hydrationPressure, "degraded");
  assert.equal(schedule.streams.marketStockAggregates, true);
  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.streams.lowPriorityHistory, false);
  assert.equal(schedule.hiddenScreenPreload.mountScreens, false);
});

test("critical memory pressure pauses hidden preload without dropping broad flow owner", () => {
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
  assert.equal(schedule.streams.lowPriorityHistory, false);
  assert.equal(schedule.resume.backgroundRefresh, false);
  assert.equal(schedule.hiddenScreenPreload.codeOnly, false);
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

test("defers broad flow runtime before first screen ready while deferring low priority work", () => {
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

test("waits for a first memory sample before starting background work", () => {
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
  assert.equal(schedule.streams.broadFlowRuntime, false);
});

test("keeps broad flow runtime deferred on non-market work screens until resume", () => {
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

  assert.equal(tradeSchedule.streams.broadFlowRuntime, false);
  assert.equal(algoSchedule.streams.broadFlowRuntime, false);
});
