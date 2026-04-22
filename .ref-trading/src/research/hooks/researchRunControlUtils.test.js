import test from "node:test";
import assert from "node:assert/strict";
import {
  buildResearchRunDraftSignature,
  buildRestoredResearchRunState,
  resolveResearchRunRequestMode,
} from "./researchRunControlUtils.js";
import { cloneBacktestV2StageDefaults } from "../config/backtestV2StagingConfig.js";
import { compileBacktestV2RuntimeBridge } from "../config/backtestV2RuntimeBridge.js";

test("resolveResearchRunRequestMode only queues one rerun while loading", () => {
  assert.equal(resolveResearchRunRequestMode({ runStatus: "loading", hasQueuedRun: false }), "queue");
  assert.equal(resolveResearchRunRequestMode({ runStatus: "loading", hasQueuedRun: true }), "noop");
  assert.equal(resolveResearchRunRequestMode({ runStatus: "ready", hasQueuedRun: false }), "start");
});

test("buildResearchRunDraftSignature changes when propagated inputs change", () => {
  const baseline = buildResearchRunDraftSignature({
    inputPayload: {
      marketSymbol: "SPY",
      strategy: "rayalgo",
      executionFidelity: "sub_candle",
      dte: 5,
      slPct: 0.2,
      tpPct: 0.3,
      trailStartPct: 0.1,
      trailPct: 0.15,
      zombieBars: 24,
      commPerContract: 0.65,
      slipBps: 150,
      signalTimeframe: "5m",
      optionSelectionSpec: { targetDte: 5, strikeSlot: 0 },
    },
    executionBars: [{ ts: "2025-01-02 09:30:00" }, { ts: "2025-01-02 09:35:00" }],
    signalBars: [{ ts: "2025-01-02 09:30:00" }],
    executionMode: "option_history",
    replayCredentialsReady: true,
  });
  const changed = buildResearchRunDraftSignature({
    inputPayload: {
      marketSymbol: "SPY",
      strategy: "rayalgo",
      executionFidelity: "sub_candle",
      dte: 5,
      slPct: 0.35,
      tpPct: 0.3,
      trailStartPct: 0.1,
      trailPct: 0.15,
      zombieBars: 24,
      commPerContract: 0.65,
      slipBps: 150,
      signalTimeframe: "5m",
      optionSelectionSpec: { targetDte: 5, strikeSlot: 0 },
    },
    executionBars: [{ ts: "2025-01-02 09:30:00" }, { ts: "2025-01-02 09:35:00" }],
    signalBars: [{ ts: "2025-01-02 09:30:00" }],
    executionMode: "option_history",
    replayCredentialsReady: true,
  });

  assert.notEqual(baseline, changed);
});

test("buildResearchRunDraftSignature changes when runtime bridge state changes", () => {
  const baselineStage = cloneBacktestV2StageDefaults();
  const changedStage = cloneBacktestV2StageDefaults();
  changedStage.runSettings.startDate = "2026-03-18";
  changedStage.runSettings.endDate = "2026-03-20";
  changedStage.exitGovernor.trail_activation_atr_0dte = 1.6;

  const baseline = buildResearchRunDraftSignature({
    inputPayload: {
      marketSymbol: "SPY",
      strategy: "rayalgo",
      executionFidelity: "sub_candle",
      dte: 5,
      slPct: 0.2,
      tpPct: 0.3,
      trailStartPct: 0.1,
      trailPct: 0.15,
      zombieBars: 24,
      commPerContract: 0.65,
      slipBps: 150,
      signalTimeframe: "5m",
      optionSelectionSpec: { targetDte: 5, strikeSlot: 0 },
      backtestV2StageConfig: baselineStage,
    },
    executionBars: [{ ts: "2026-03-18 09:30:00" }, { ts: "2026-03-20 15:55:00" }],
    signalBars: [{ ts: "2026-03-18 09:30:00" }],
    executionMode: "option_history",
    replayCredentialsReady: true,
    runtimeBridge: compileBacktestV2RuntimeBridge({
      stageConfig: baselineStage,
      signalTimeframe: "5m",
      fallbackRiskStopPolicy: "disabled",
    }),
  });
  const changed = buildResearchRunDraftSignature({
    inputPayload: {
      marketSymbol: "SPY",
      strategy: "rayalgo",
      executionFidelity: "sub_candle",
      dte: 5,
      slPct: 0.2,
      tpPct: 0.3,
      trailStartPct: 0.1,
      trailPct: 0.15,
      zombieBars: 24,
      commPerContract: 0.65,
      slipBps: 150,
      signalTimeframe: "5m",
      optionSelectionSpec: { targetDte: 5, strikeSlot: 0 },
      backtestV2StageConfig: changedStage,
    },
    executionBars: [{ ts: "2026-03-18 09:30:00" }, { ts: "2026-03-20 15:55:00" }],
    signalBars: [{ ts: "2026-03-18 09:30:00" }],
    executionMode: "option_history",
    replayCredentialsReady: true,
    runtimeBridge: compileBacktestV2RuntimeBridge({
      stageConfig: changedStage,
      signalTimeframe: "5m",
      fallbackRiskStopPolicy: "disabled",
    }),
  });

  assert.notEqual(baseline, changed);
});

test("buildRestoredResearchRunState hydrates a saved run snapshot", () => {
  const restored = buildRestoredResearchRunState({
    trades: [{ ts: "2025-01-02 09:30:00", dir: "long", pnl: 125.45 }],
    equity: [{ i: 1, bal: 25125.45, ts: "2025-01-02 09:35:00" }],
    skippedTrades: [{ ts: "2025-01-02 10:00:00", dir: "short", er: "filter" }],
    skippedByReason: { filter: 1 },
    replayMeta: {
      replayRunStatus: "ready",
      replayDatasetSummary: { resolved: 5, skipped: 1, uniqueContracts: 4 },
    },
    riskStop: { policy: "disabled" },
    rayalgoScoringContext: { activeTimeframe: "5m" },
  });

  assert.equal(restored.status, "ready");
  assert.equal(restored.trades.length, 1);
  assert.equal(restored.equity[0].bal, 25125.45);
  assert.equal(restored.skippedTrades.length, 1);
  assert.deepEqual(restored.replayDataset?.counts, { resolved: 5, skipped: 1, uniqueContracts: 4 });
  assert.equal(restored.rayalgoScoringContext?.activeTimeframe, "5m");
});
