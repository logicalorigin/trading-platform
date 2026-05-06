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

  assert.equal(schedule.streams.accountRealtime, true);
  assert.equal(schedule.streams.accountRealtimeCritical, true);
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

test("keeps broad flow runtime active outside market and flow screens", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "account",
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
});

test("keeps broad flow runtime active without broker readiness", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "flow",
    brokerConfigured: false,
    brokerAuthenticated: false,
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.streams.accountRealtime, false);
  assert.equal(schedule.streams.marketStockAggregates, false);
});

test("keeps broad flow runtime active when background IBKR work is blocked", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    ibkrWorkPressure: WORK_PRESSURE_STATE.degraded,
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.streams.marketStockAggregates, true);
  assert.equal(schedule.streams.lowPriorityHistory, false);
});

test("keeps shared flow runtime disabled while broad scanner owns flow", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "flow",
  });

  assert.equal(schedule.streams.sharedFlowRuntime, false);
  assert.equal(schedule.streams.broadFlowRuntime, true);
});

test("memory watch pressure blocks low-priority background hydration first", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    activeScreen: "market",
    screenWarmupPhase: "ready",
    memoryPressure: {
      level: "watch",
      observedAt: "2026-05-06T00:00:00.000Z",
    },
  });

  assert.equal(schedule.hydrationPressure, "degraded");
  assert.equal(schedule.streams.marketStockAggregates, true);
  assert.equal(schedule.streams.lowPriorityHistory, false);
  assert.equal(schedule.hiddenScreenPreload.mountScreens, false);
});

test("critical memory pressure pauses hidden preload but keeps broad flow runtime", () => {
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

test("keeps broad flow runtime on while page is hidden", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    pageVisible: false,
    activeScreen: "account",
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
  assert.equal(schedule.streams.accountRealtime, false);
  assert.equal(schedule.streams.marketStockAggregates, false);
});

test("keeps broad flow runtime on before session metadata settles", () => {
  const schedule = buildPlatformWorkSchedule({
    ...baseInput,
    sessionMetadataSettled: false,
    activeScreen: "trade",
  });

  assert.equal(schedule.streams.broadFlowRuntime, true);
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
  assert.equal(schedule.streams.broadFlowRuntime, true);
});
