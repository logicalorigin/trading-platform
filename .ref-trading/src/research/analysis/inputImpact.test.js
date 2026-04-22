import test from "node:test";
import assert from "node:assert/strict";

import { cloneBacktestV2StageDefaults } from "../config/backtestV2StagingConfig.js";
import { compileBacktestV2RuntimeBridge } from "../config/backtestV2RuntimeBridge.js";
import { resolveLegacyTopRailCompatFields } from "../config/backtestLegacyInputMapping.js";
import {
  buildDefaultInputImpactVariants,
  createInputImpactPayload,
} from "./inputImpact.js";

test("resolveLegacyTopRailCompatFields prefers staged bridge values over divergent legacy fallbacks", () => {
  const staged = cloneBacktestV2StageDefaults();
  staged.runSettings.initialCapital = 52000;
  staged.entryGate.kelly_fraction = 0.37;
  staged.entryGate.min_conviction = 0.57;
  staged.entryGate.allow_shorts = true;
  staged.entryGate.regime_filter = "none";
  staged.exitGovernor.max_loss_0dte_pct = 0.31;
  staged.exitGovernor.max_loss_1to3dte_pct = 0.31;
  staged.exitGovernor.max_loss_5plus_pct = 0.31;
  staged.exitGovernor.take_profit_pct = 0.66;
  staged.exitGovernor.trail_option_pnl_floor_0dte = 0.12;
  staged.exitGovernor.trail_option_pnl_floor_1dte = 0.12;
  staged.exitGovernor.trail_option_pnl_floor_2to3dte = 0.12;
  staged.exitGovernor.trail_entry_drawdown_pct = 0.14;
  staged.exitGovernor.zombie_bars = 16;
  staged.dteSelection.base_dte_2m = 2;
  staged.dteSelection.base_dte_5m_morning = 2;
  staged.dteSelection.base_dte_5m_midday = 2;
  staged.dteSelection.base_dte_5m_power_hour = 2;
  staged.dteSelection.base_dte_15m = 2;
  staged.dteSelection.dte_adj_trending = 0;
  staged.dteSelection.dte_adj_neutral = 0;
  staged.dteSelection.dte_adj_choppy = 0;
  staged.dteSelection.dte_adj_high_vol = 0;
  staged.dteSelection.dte_floor = 2;
  staged.dteSelection.dte_cap = 2;
  staged.dteSelection.strike_slot = "4";
  staged.riskWarden.max_total_positions = 6;
  staged.executionPolicy.regime_adapt = false;
  staged.executionPolicy.comm_per_contract = 0.45;
  staged.executionPolicy.slip_bps = 90;
  staged.sessionPolicy.trade_day_tue = false;
  staged.sessionPolicy.block_2 = false;

  const bridge = compileBacktestV2RuntimeBridge({
    stageConfig: staged,
    signalTimeframe: "5m",
    fallbackCapital: 15000,
    fallbackDte: 8,
    fallbackKellyFrac: 0.1,
    fallbackMaxPositions: 2,
    fallbackRiskStopPolicy: "disabled",
    fallbackOptionSelectionSpec: {
      targetDte: 8,
      strikeSlot: 1,
    },
  });
  const resolved = resolveLegacyTopRailCompatFields({
    runtimeBridge: bridge,
    fallbackFields: {
      capital: 15000,
      dte: 8,
      slPct: 0.1,
      tpPct: 0.2,
      trailStartPct: 0.03,
      trailPct: 0.04,
      zombieBars: 60,
      minConviction: 0.2,
      allowShorts: false,
      kellyFrac: 0.1,
      regimeFilter: "not_bear",
      maxPositions: 2,
      sessionBlocks: Array(13).fill(true),
      tradeDays: [false, true, false, true, false],
      regimeAdapt: true,
      commPerContract: 1.2,
      slipBps: 600,
      riskStopPolicy: "disabled",
      optionSelectionSpec: {
        targetDte: 8,
        strikeSlot: 1,
      },
    },
  });

  assert.equal(resolved.capital, 52000);
  assert.equal(resolved.kellyFrac, 0.37);
  assert.equal(resolved.dte, 2);
  assert.equal(resolved.slPct, 0.31);
  assert.equal(resolved.tpPct, 0.66);
  assert.equal(resolved.trailStartPct, 0.12);
  assert.equal(resolved.trailPct, 0.14);
  assert.equal(resolved.zombieBars, 16);
  assert.equal(resolved.minConviction, 0.57);
  assert.equal(resolved.allowShorts, true);
  assert.equal(resolved.regimeFilter, "none");
  assert.equal(resolved.maxPositions, 6);
  assert.equal(resolved.tradeDays[1], false);
  assert.equal(resolved.sessionBlocks[2], false);
  assert.equal(resolved.regimeAdapt, false);
  assert.equal(resolved.commPerContract, 0.45);
  assert.equal(resolved.slipBps, 90);
  assert.deepEqual(resolved.optionSelectionSpec, {
    targetDte: 2,
    minDte: 2,
    maxDte: 2,
    strikeSlot: 4,
    moneyness: null,
    strikeSteps: null,
  });
});

test("input-impact payloads and variants stay stage-authoritative when staged config is present", () => {
  const staged = cloneBacktestV2StageDefaults();
  staged.runSettings.initialCapital = 48000;
  staged.exitGovernor.max_loss_0dte_pct = 0.28;
  staged.exitGovernor.max_loss_1to3dte_pct = 0.28;
  staged.exitGovernor.max_loss_5plus_pct = 0.28;
  staged.executionPolicy.slip_bps = 95;
  staged.dteSelection.base_dte_2m = 3;
  staged.dteSelection.base_dte_5m_morning = 3;
  staged.dteSelection.base_dte_5m_midday = 3;
  staged.dteSelection.base_dte_5m_power_hour = 3;
  staged.dteSelection.base_dte_15m = 3;
  staged.dteSelection.dte_adj_trending = 0;
  staged.dteSelection.dte_adj_neutral = 0;
  staged.dteSelection.dte_adj_choppy = 0;
  staged.dteSelection.dte_adj_high_vol = 0;
  staged.dteSelection.dte_floor = 3;
  staged.dteSelection.dte_cap = 3;
  staged.dteSelection.strike_slot = "1";

  const payload = createInputImpactPayload({
    marketSymbol: "SPY",
    signalTimeframe: "5m",
    capital: 12000,
    dte: 8,
    slPct: 0.1,
    slipBps: 500,
    optionSelectionSpec: {
      targetDte: 8,
      strikeSlot: 5,
    },
    backtestV2StageConfig: staged,
  });

  assert.equal(payload.capital, 48000);
  assert.equal(payload.dte, 3);
  assert.equal(payload.slPct, 0.28);
  assert.equal(payload.slipBps, 95);
  assert.deepEqual(payload.optionSelectionSpec, {
    targetDte: 3,
    strikeSlot: 1,
    moneyness: null,
    strikeSteps: null,
  });

  const variants = buildDefaultInputImpactVariants(payload);
  const stopLossVariant = variants.find((variant) => variant.key === "exit_stop_loss");
  const strikeVariant = variants.find((variant) => variant.key === "contract_strike");

  assert.ok(stopLossVariant?.variantInput?.backtestV2StageConfig);
  assert.equal(stopLossVariant.variantInput.slPct, 0.1);
  assert.equal(stopLossVariant.variantInput.backtestV2StageConfig.exitGovernor.max_loss_1to3dte_pct, 0.1);

  assert.ok(strikeVariant?.variantInput?.backtestV2StageConfig);
  assert.equal(strikeVariant.variantInput.optionSelectionSpec.strikeSlot, 5);
  assert.equal(strikeVariant.variantInput.backtestV2StageConfig.dteSelection.strike_slot, "5");
});
