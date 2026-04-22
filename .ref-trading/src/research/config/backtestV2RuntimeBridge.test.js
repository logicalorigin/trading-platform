import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLegacyTopRailFieldsToStageConfig,
  projectLegacyTopRailFieldsFromStageConfig,
} from "./backtestLegacyInputMapping.js";
import { cloneBacktestV2StageDefaults } from "./backtestV2StagingConfig.js";
import {
  compileBacktestV2RuntimeBridge,
  filterBarsForBacktestV2Window,
  resolveBacktestV2CandidateSelection,
} from "./backtestV2RuntimeBridge.js";

test("legacy top-rail fields round-trip through the staged config bridge", () => {
  const staged = applyLegacyTopRailFieldsToStageConfig(null, {
    capital: 48000,
    kellyFrac: 0.42,
    dte: 3,
    slPct: 0.28,
    tpPct: 0.55,
    trailStartPct: 0.12,
    trailPct: 0.16,
    zombieBars: 18,
    minConviction: 0.51,
    optionStrikeSlot: 4,
    maxPos: 6,
    regimeFilter: "none",
    regimeAdapt: false,
    sessionBlocks: [true, false, true, false, true, false, true, false, true, false, true, false, true],
    tradeDays: [true, false, true, true, false],
    allowShorts: true,
    commPerContract: 0.4,
    slipBps: 85,
  });
  const projection = projectLegacyTopRailFieldsFromStageConfig(staged);

  assert.equal(staged.runSettings.initialCapital, 48000);
  assert.equal(staged.entryGate.kelly_fraction, 0.42);
  assert.equal(staged.dteSelection.base_dte_2m, 3);
  assert.equal(staged.dteSelection.base_dte_5m_midday, 3);
  assert.equal(staged.dteSelection.base_dte_15m, 3);
  assert.equal(staged.dteSelection.dte_adj_trending, 0);
  assert.equal(staged.dteSelection.dte_adj_high_vol, 0);
  assert.equal(staged.dteSelection.dte_floor, 3);
  assert.equal(staged.dteSelection.dte_cap, 3);
  assert.equal(staged.exitGovernor.max_loss_1to3dte_pct, 0.28);
  assert.equal(staged.exitGovernor.take_profit_pct, 0.55);
  assert.equal(staged.exitGovernor.trail_option_pnl_floor_1dte, 0.12);
  assert.equal(staged.exitGovernor.trail_entry_drawdown_pct, 0.16);
  assert.equal(staged.exitGovernor.zombie_bars, 18);
  assert.equal(staged.entryGate.min_conviction, 0.51);
  assert.equal(staged.dteSelection.strike_slot, "4");
  assert.equal(staged.riskWarden.max_total_positions, 6);
  assert.equal(staged.entryGate.regime_filter, "none");
  assert.equal(staged.executionPolicy.regime_adapt, false);
  assert.equal(staged.executionPolicy.comm_per_contract, 0.4);
  assert.equal(staged.executionPolicy.slip_bps, 85);
  assert.equal(staged.sessionPolicy.block_1, false);
  assert.equal(staged.sessionPolicy.trade_day_tue, false);
  assert.equal(staged.entryGate.allow_shorts, true);

  assert.equal(projection.capital, 48000);
  assert.equal(projection.kellyFrac, 0.42);
  assert.equal(projection.dte, 3);
  assert.equal(projection.slPct, 0.28);
  assert.equal(projection.tpPct, 0.55);
  assert.equal(projection.trailStartPct, 0.12);
  assert.equal(projection.trailPct, 0.16);
  assert.equal(projection.zombieBars, 18);
  assert.equal(projection.minConviction, 0.51);
  assert.equal(projection.optionStrikeSlot, 4);
  assert.equal(projection.maxPos, 6);
  assert.equal(projection.regimeFilter, "none");
  assert.equal(projection.regimeAdapt, false);
  assert.deepEqual(projection.sessionBlocks, [true, false, true, false, true, false, true, false, true, false, true, false, true]);
  assert.deepEqual(projection.tradeDays, [true, false, true, true, false]);
  assert.equal(projection.allowShorts, true);
  assert.equal(projection.commPerContract, 0.4);
  assert.equal(projection.slipBps, 85);
});

test("non-fixed staged DTE settings do not project back to a single legacy DTE", () => {
  const staged = cloneBacktestV2StageDefaults();
  staged.dteSelection.base_dte_5m_midday = 2;
  staged.dteSelection.base_dte_15m = 4;
  staged.dteSelection.dte_adj_trending = -1;

  const projection = projectLegacyTopRailFieldsFromStageConfig(staged);

  assert.equal(projection.capital, staged.runSettings.initialCapital);
  assert.equal(projection.kellyFrac, staged.entryGate.kelly_fraction);
  assert.equal(projection.dte, null);
});

test("compileBacktestV2RuntimeBridge does not inherit legacy strike-slot fallbacks once staged config is explicit", () => {
  const staged = cloneBacktestV2StageDefaults();
  staged.dteSelection.strike_slot = "auto";
  staged.dteSelection.base_dte_2m = 2;
  staged.dteSelection.base_dte_5m_morning = 2;
  staged.dteSelection.base_dte_5m_midday = 2;
  staged.dteSelection.base_dte_5m_power_hour = 2;
  staged.dteSelection.base_dte_15m = 2;
  staged.dteSelection.dte_floor = 2;
  staged.dteSelection.dte_cap = 2;

  const bridge = compileBacktestV2RuntimeBridge({
    stageConfig: staged,
    signalTimeframe: "5m",
    fallbackDte: 5,
    fallbackOptionSelectionSpec: {
      targetDte: 5,
      strikeSlot: 4,
    },
  });

  assert.equal(bridge.optionSelectionSpec.targetDte, 2);
  assert.equal(bridge.optionSelectionSpec.strikeSlot, null);
  assert.equal(bridge.legacyOverrides.optionSelectionSpec.targetDte, 2);
  assert.equal(bridge.legacyOverrides.optionSelectionSpec.strikeSlot, null);
});

test("compileBacktestV2RuntimeBridge applies staged capital, sizing, risk, and dynamic DTE defaults", () => {
  const staged = cloneBacktestV2StageDefaults();
  staged.runSettings.profileName = "rayalgo_smoke";
  staged.runSettings.initialCapital = 50000;
  staged.exitGovernor.trail_activation_atr_0dte = 0.35;
  staged.exitGovernor.trail_activation_atr_1dte = 0.55;
  staged.exitGovernor.trail_activation_atr_2to3dte = 0.75;
  staged.exitGovernor.trail_option_pnl_floor_0dte = 0.14;
  staged.exitGovernor.trail_option_pnl_floor_1dte = 0.11;
  staged.exitGovernor.trail_option_pnl_floor_2to3dte = 0.09;
  staged.exitGovernor.trail_lock_ratio_initial = 0.45;
  staged.exitGovernor.trail_lock_ratio_max = 0.85;
  staged.exitGovernor.theta_tighten_0dte_30min = 0.05;
  staged.exitGovernor.theta_tighten_0dte_60min = 0.1;
  staged.exitGovernor.theta_tighten_0dte_90min = 0.15;
  staged.exitGovernor.theta_tighten_1to3_60min = 0.07;
  staged.exitGovernor.theta_tighten_1to3_120min = 0.11;
  staged.exitGovernor.tod_multiplier_open = 1.25;
  staged.exitGovernor.tod_multiplier_midmorning = 1.05;
  staged.exitGovernor.tod_multiplier_midday = 0.95;
  staged.exitGovernor.tod_multiplier_power_hour = 0.8;
  staged.exitGovernor.regime_multiplier_trending = 1.2;
  staged.exitGovernor.regime_multiplier_neutral = 1;
  staged.exitGovernor.regime_multiplier_choppy = 0.75;
  staged.exitGovernor.time_cliff_0dte_minutes = 35;
  staged.exitGovernor.time_cliff_1to3dte_eod = false;
  staged.exitGovernor.time_cliff_5plus_sessions = 3;
  staged.exitGovernor.time_cliff_profitable_override = false;
  staged.exitGovernor.max_loss_0dte_pct = 0.42;
  staged.exitGovernor.max_loss_1to3dte_pct = 0.31;
  staged.exitGovernor.max_loss_5plus_pct = 0.22;
  staged.exitGovernor.take_profit_pct = 0.62;
  staged.exitGovernor.trail_entry_drawdown_pct = 0.16;
  staged.exitGovernor.zombie_bars = 22;
  staged.entryGate.edge_ratio_skip = 1.15;
  staged.entryGate.edge_ratio_half = 1.35;
  staged.entryGate.edge_ratio_0dte_shift = 0.12;
  staged.entryGate.edge_ratio_weekend_shift = 0.18;
  staged.entryGate.vix_confluence_floor_low = 0.5;
  staged.entryGate.vix_confluence_floor_mid = 0.68;
  staged.entryGate.vix_confluence_floor_high = 0.82;
  staged.entryGate.vix_confluence_floor_very_high = 0.9;
  staged.entryGate.vix_25_30_trending_edge_shift = 0.11;
  staged.entryGate.vix_30_plus_trending_edge_shift = 0.21;
  staged.entryGate.vix_25_30_choppy_skip = false;
  staged.entryGate.vix_30_plus_choppy_skip = true;
  staged.entryGate.regime_expected_move_trending = 1.4;
  staged.entryGate.regime_expected_move_neutral = 1.05;
  staged.entryGate.regime_expected_move_choppy = 0.75;
  staged.entryGate.kelly_fraction = 0.4;
  staged.entryGate.kelly_floor_pct = 1.25;
  staged.entryGate.kelly_ceiling_pct = 4.5;
  staged.entryGate.max_position_pct = 6;
  staged.entryGate.max_exposure_pct = 18;
  staged.entryGate.mtf_confirm_upgrades_sizing = false;
  staged.entryGate.opposite_direction_skip = false;
  staged.entryGate.min_conviction = 0.52;
  staged.entryGate.rayalgo_min_quality_score = 0.47;
  staged.entryGate.rayalgo_trend_change_min_quality_score = 0.5;
  staged.entryGate.rayalgo_long_min_quality_score = 0.46;
  staged.entryGate.rayalgo_short_min_quality_score = 0.49;
  staged.entryGate.rayalgo_trend_change_long_min_quality_score = 0.58;
  staged.entryGate.rayalgo_trend_change_short_min_quality_score = 0.57;
  staged.entryGate.allow_shorts = true;
  staged.entryGate.regime_filter = "none";
  staged.riskWarden.daily_loss_limit_pct = 2.5;
  staged.riskWarden.consecutive_loss_cooldown_count = 4;
  staged.riskWarden.consecutive_loss_cooldown_minutes = 45;
  staged.riskWarden.drawdown_throttle_pct = 4;
  staged.riskWarden.drawdown_halt_pct = 9;
  staged.riskWarden.max_concurrent_same_direction = 1;
  staged.riskWarden.max_total_positions = 5;
  staged.riskWarden.post_max_loss_cooldown_minutes = 15;
  staged.riskWarden.persist_until_new_equity_high = false;
  staged.layers.l1_fraction = 1;
  staged.layers.l2_fraction = 0.6;
  staged.layers.l3_fraction = 0.3;
  staged.layers.edge_bump_multiplier = 1.35;
  staged.layers.edge_skip_threshold = 1.2;
  staged.layers.max_layers_per_position = 3;
  staged.dteSelection.base_dte_5m_midday = 2;
  staged.dteSelection.dte_adj_neutral = 0;
  staged.dteSelection.dte_adj_high_vol = 0;
  staged.dteSelection.dte_floor = 0;
  staged.dteSelection.dte_cap = 5;
  staged.dteSelection.midday_trending_0dte_confluence = 0.83;
  staged.dteSelection.strike_slot = "4";
  staged.executionPolicy.regime_adapt = false;
  staged.executionPolicy.comm_per_contract = 0.45;
  staged.executionPolicy.slip_bps = 90;
  staged.sessionPolicy.trade_day_mon = true;
  staged.sessionPolicy.trade_day_tue = false;
  staged.sessionPolicy.trade_day_wed = true;
  staged.sessionPolicy.trade_day_thu = true;
  staged.sessionPolicy.trade_day_fri = false;
  staged.sessionPolicy.block_0 = true;
  staged.sessionPolicy.block_1 = true;
  staged.sessionPolicy.block_2 = false;
  staged.sessionPolicy.block_3 = false;
  staged.sessionPolicy.block_4 = true;
  staged.sessionPolicy.block_5 = false;
  staged.sessionPolicy.block_6 = false;
  staged.sessionPolicy.block_7 = false;
  staged.sessionPolicy.block_8 = true;
  staged.sessionPolicy.block_9 = true;
  staged.sessionPolicy.block_10 = true;
  staged.sessionPolicy.block_11 = false;
  staged.sessionPolicy.block_12 = true;

  const bridge = compileBacktestV2RuntimeBridge({
    stageConfig: staged,
    signalTimeframe: "5m",
    fallbackCapital: 25000,
    fallbackDte: 5,
    fallbackKellyFrac: 0.25,
    fallbackMaxPositions: 4,
    fallbackRiskStopPolicy: "disabled",
    fallbackOptionSelectionSpec: {
      targetDte: 5,
      strikeSlot: 2,
    },
  });

  assert.equal(bridge.stageConfig.runSettings.profileName, "rayalgo_smoke");
  assert.equal(bridge.legacyOverrides.capital, 50000);
  assert.equal(bridge.legacyOverrides.kellyFrac, 0.4);
  assert.equal(bridge.legacyOverrides.dte, 2);
  assert.equal(bridge.legacyOverrides.maxPositions, 5);
  assert.equal(bridge.legacyOverrides.riskStopPolicy, "legacy_halt");
  assert.deepEqual(bridge.legacyOverrides.optionSelectionSpec, {
    targetDte: 2,
    minDte: 2,
    maxDte: 2,
    strikeSlot: 4,
  });
  assert.deepEqual(bridge.positionSizingConfig, {
    kellyLookbackTrades: 40,
    kellyFloorPct: 1.25,
    kellyCeilingPct: 4.5,
    maxPositionPct: 6,
    maxExposurePct: 18,
  });
  assert.deepEqual(bridge.entryGateConfig, {
    edgeRatioSkip: 1.15,
    edgeRatioHalf: 1.35,
    edgeRatio0dteShift: 0.12,
    edgeRatioWeekendShift: 0.18,
    vixConfluenceFloors: {
      low: 0.5,
      mid: 0.68,
      high: 0.82,
      veryHigh: 0.9,
    },
    vix25To30TrendingEdgeShift: 0.11,
    vix30PlusTrendingEdgeShift: 0.21,
    vix25To30ChoppySkip: false,
    vix30PlusChoppySkip: true,
    regimeExpectedMoveMultipliers: {
      trending: 1.4,
      neutral: 1.05,
      choppy: 0.75,
    },
    mtfConfirmUpgradesSizing: false,
    oppositeDirectionSkip: false,
    minConviction: 0.52,
    rayalgoMinQualityScore: 0.47,
    rayalgoTrendChangeMinQualityScore: 0.5,
    rayalgoLongMinQualityScore: 0.46,
    rayalgoShortMinQualityScore: 0.49,
    rayalgoTrendChangeLongMinQualityScore: 0.58,
    rayalgoTrendChangeShortMinQualityScore: 0.57,
    allowShorts: true,
    regimeFilter: "none",
  });
  assert.deepEqual(bridge.riskStopConfig, {
    dailyLossLimitPct: 2.5,
    consecutiveLossCooldownCount: 4,
    consecutiveLossCooldownMinutes: 45,
    drawdownThrottlePct: 4,
    drawdownHaltPct: 9,
    maxConcurrentSameDirection: 1,
    maxPositions: 5,
    postMaxLossCooldownMinutes: 15,
    persistUntilNewEquityHigh: false,
  });
  assert.deepEqual(bridge.layerConfig, {
    layerFractions: [1, 0.6, 0.3],
    edgeBumpMultiplier: 1.35,
    edgeSkipThreshold: 1.2,
    maxLayersPerPosition: 3,
  });
  assert.deepEqual(bridge.exitGovernorConfig, {
    trailActivationAtr0dte: 0.35,
    trailActivationAtr1dte: 0.55,
    trailActivationAtr2to3dte: 0.75,
    trailOptionPnlFloor0dte: 0.14,
    trailOptionPnlFloor1dte: 0.11,
    trailOptionPnlFloor2to3dte: 0.09,
    trailEntryDrawdownPct: 0.16,
    trailLockRatioInitial: 0.45,
    trailLockRatioMax: 0.85,
    thetaTighten0dte30min: 0.05,
    thetaTighten0dte60min: 0.1,
    thetaTighten0dte90min: 0.15,
    thetaTighten1to3dte60min: 0.07,
    thetaTighten1to3dte120min: 0.11,
    todMultipliers: {
      open: 1.25,
      midmorning: 1.05,
      midday: 0.95,
      powerHour: 0.8,
    },
    regimeMultipliers: {
      trending: 1.2,
      neutral: 1,
      choppy: 0.75,
    },
    timeCliff0dteMinutes: 35,
    timeCliff1to3dteEod: false,
    timeCliff5plusSessions: 3,
    timeCliffProfitableOverride: false,
    maxLoss0dtePct: 0.42,
    maxLoss1to3dtePct: 0.31,
    maxLoss5plusPct: 0.22,
    takeProfitPct: 0.62,
    zombieBars: 22,
  });
  assert.deepEqual(bridge.executionPolicyConfig, {
    regimeAdapt: false,
    commPerContract: 0.45,
    slipBps: 90,
    tradeDays: [true, false, true, true, false],
    sessionBlocks: [true, true, false, false, true, false, false, false, true, true, true, false, true],
  });
  assert.deepEqual(bridge.optionSelectionSpec, {
    targetDte: 2,
    minDte: 2,
    maxDte: 2,
    strikeSlot: 4,
  });
  assert.equal(bridge.replaySelectionConfig.dynamicTargetDte, true);
  assert.equal(bridge.support.profileName, "rayalgo_smoke");
  assert.ok(bridge.support.appliedFieldPaths.includes("runSettings.initialCapital"));
  assert.ok(bridge.support.appliedFieldPaths.includes("entryGate.edge_ratio_skip"));
  assert.ok(bridge.support.appliedFieldPaths.includes("layers.max_layers_per_position"));
  assert.ok(bridge.support.appliedFieldPaths.includes("exitGovernor.max_loss_0dte_pct"));
  assert.ok(bridge.support.appliedFieldPaths.includes("exitGovernor.time_cliff_0dte_minutes"));
  assert.ok(bridge.support.appliedFieldPaths.includes("riskWarden.consecutive_loss_cooldown_count"));
  assert.ok(bridge.support.appliedFieldPaths.includes("exitGovernor.trail_lock_ratio_initial"));
  assert.ok(bridge.support.appliedFieldPaths.includes("entryGate.min_conviction"));
  assert.ok(bridge.support.appliedFieldPaths.includes("entryGate.rayalgo_min_quality_score"));
  assert.ok(bridge.support.appliedFieldPaths.includes("riskWarden.max_total_positions"));
  assert.ok(bridge.support.appliedFieldPaths.includes("dteSelection.midday_trending_0dte_confluence"));
  assert.ok(bridge.support.appliedFieldPaths.includes("executionPolicy.slip_bps"));
  assert.ok(bridge.support.appliedFieldPaths.includes("sessionPolicy.block_10"));
  assert.ok(!bridge.support.stagedOnlyFieldPaths.includes("entryGate.edge_ratio_skip"));
  assert.ok(!bridge.support.stagedOnlyFieldPaths.includes("exitGovernor.max_loss_0dte_pct"));
  assert.ok(!bridge.support.stagedOnlyFieldPaths.includes("exitGovernor.time_cliff_0dte_minutes"));
  assert.ok(!bridge.support.stagedOnlyFieldPaths.includes("riskWarden.consecutive_loss_cooldown_count"));
  assert.ok(!bridge.support.stagedOnlyFieldPaths.includes("exitGovernor.trail_lock_ratio_initial"));
  assert.ok(!bridge.support.stagedOnlyFieldPaths.includes("dteSelection.midday_trending_0dte_confluence"));
});

test("resolveBacktestV2CandidateSelection adapts by timeframe, session, regime, and vix", () => {
  const staged = cloneBacktestV2StageDefaults();
  staged.dteSelection.base_dte_2m = 0;
  staged.dteSelection.base_dte_5m_morning = 1;
  staged.dteSelection.base_dte_5m_midday = 0;
  staged.dteSelection.base_dte_5m_power_hour = 3;
  staged.dteSelection.base_dte_15m = 4;
  staged.dteSelection.dte_adj_trending = 0;
  staged.dteSelection.dte_adj_neutral = 0;
  staged.dteSelection.dte_adj_choppy = 1;
  staged.dteSelection.dte_adj_high_vol = -1;
  staged.dteSelection.dte_floor = 0;
  staged.dteSelection.dte_cap = 5;
  staged.dteSelection.midday_trending_0dte_confluence = 0.85;
  staged.dteSelection.strike_slot = "5";

  const trendingMidday = resolveBacktestV2CandidateSelection({
    stageConfig: staged,
    signalTimeframe: "5m",
    regime: { regime: "bull", vix: 17 },
    signal: { scoring: { confluence: 0.7 } },
    entryTs: "2026-03-24T13:15:00Z",
    fallbackStrikeSlot: 3,
  });
  const trendingMiddayHighConfluence = resolveBacktestV2CandidateSelection({
    stageConfig: staged,
    signalTimeframe: "5m",
    regime: { regime: "bull", vix: 17 },
    signal: { scoring: { confluence: 0.92 } },
    entryTs: "2026-03-24T13:15:00Z",
    fallbackStrikeSlot: 3,
  });
  const choppyHighVol = resolveBacktestV2CandidateSelection({
    stageConfig: staged,
    signalTimeframe: "15m",
    regime: { regime: "bear", vix: 28 },
    entryTs: "2026-03-24T19:20:00Z",
    fallbackStrikeSlot: 1,
  });

  assert.deepEqual(trendingMidday, {
    targetDte: 1,
    minDte: 1,
    maxDte: 1,
    strikeSlot: 5,
    selectionMode: "v2_5m_midday_trending",
  });
  assert.deepEqual(trendingMiddayHighConfluence, {
    targetDte: 0,
    minDte: 0,
    maxDte: 0,
    strikeSlot: 5,
    selectionMode: "v2_5m_midday_trending",
  });
  assert.deepEqual(choppyHighVol, {
    targetDte: 4,
    minDte: 4,
    maxDte: 4,
    strikeSlot: 5,
    selectionMode: "v2_15m_power_hour_choppy",
  });
});

test("filterBarsForBacktestV2Window respects the staged date window", () => {
  const bars = [
    { date: "2026-03-17", ts: "before" },
    { date: "2026-03-18", ts: "inside-start" },
    { date: "2026-03-19", ts: "inside-mid" },
    { date: "2026-03-20", ts: "inside-end" },
    { date: "2026-03-21", ts: "after" },
  ];
  const staged = cloneBacktestV2StageDefaults();
  staged.runSettings.startDate = "2026-03-18";
  staged.runSettings.endDate = "2026-03-20";

  const filtered = filterBarsForBacktestV2Window(bars, staged);

  assert.deepEqual(filtered.map((bar) => bar.ts), [
    "inside-start",
    "inside-mid",
    "inside-end",
  ]);
});
