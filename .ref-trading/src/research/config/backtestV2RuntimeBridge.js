import { timeframeToMinutes } from "../chart/timeframeModel.js";
import { cloneBacktestV2StageDefaults } from "./backtestV2StagingConfig.js";

const APPLIED_STAGE_FIELD_PATHS = Object.freeze([
  "runSettings.profileName",
  "runSettings.startDate",
  "runSettings.endDate",
  "runSettings.initialCapital",
  "exitGovernor.trail_activation_atr_0dte",
  "exitGovernor.trail_activation_atr_1dte",
  "exitGovernor.trail_activation_atr_2to3dte",
  "exitGovernor.trail_option_pnl_floor_0dte",
  "exitGovernor.trail_option_pnl_floor_1dte",
  "exitGovernor.trail_option_pnl_floor_2to3dte",
  "exitGovernor.trail_entry_drawdown_pct",
  "exitGovernor.trail_lock_ratio_initial",
  "exitGovernor.trail_lock_ratio_max",
  "exitGovernor.theta_tighten_0dte_30min",
  "exitGovernor.theta_tighten_0dte_60min",
  "exitGovernor.theta_tighten_0dte_90min",
  "exitGovernor.theta_tighten_1to3_60min",
  "exitGovernor.theta_tighten_1to3_120min",
  "exitGovernor.tod_multiplier_open",
  "exitGovernor.tod_multiplier_midmorning",
  "exitGovernor.tod_multiplier_midday",
  "exitGovernor.tod_multiplier_power_hour",
  "exitGovernor.regime_multiplier_trending",
  "exitGovernor.regime_multiplier_neutral",
  "exitGovernor.regime_multiplier_choppy",
  "exitGovernor.time_cliff_0dte_minutes",
  "exitGovernor.time_cliff_1to3dte_eod",
  "exitGovernor.time_cliff_5plus_sessions",
  "exitGovernor.time_cliff_profitable_override",
  "exitGovernor.max_loss_0dte_pct",
  "exitGovernor.max_loss_1to3dte_pct",
  "exitGovernor.max_loss_5plus_pct",
  "exitGovernor.take_profit_pct",
  "exitGovernor.zombie_bars",
  "entryGate.edge_ratio_skip",
  "entryGate.edge_ratio_half",
  "entryGate.edge_ratio_0dte_shift",
  "entryGate.edge_ratio_weekend_shift",
  "entryGate.vix_confluence_floor_low",
  "entryGate.vix_confluence_floor_mid",
  "entryGate.vix_confluence_floor_high",
  "entryGate.vix_confluence_floor_very_high",
  "entryGate.vix_25_30_trending_edge_shift",
  "entryGate.vix_30_plus_trending_edge_shift",
  "entryGate.vix_25_30_choppy_skip",
  "entryGate.vix_30_plus_choppy_skip",
  "entryGate.regime_expected_move_trending",
  "entryGate.regime_expected_move_neutral",
  "entryGate.regime_expected_move_choppy",
  "entryGate.kelly_fraction",
  "entryGate.kelly_floor_pct",
  "entryGate.kelly_ceiling_pct",
  "entryGate.kelly_lookback_trades",
  "entryGate.max_position_pct",
  "entryGate.max_exposure_pct",
  "entryGate.mtf_confirm_upgrades_sizing",
  "entryGate.opposite_direction_skip",
  "entryGate.min_conviction",
  "entryGate.rayalgo_min_quality_score",
  "entryGate.rayalgo_trend_change_min_quality_score",
  "entryGate.rayalgo_long_min_quality_score",
  "entryGate.rayalgo_short_min_quality_score",
  "entryGate.rayalgo_trend_change_long_min_quality_score",
  "entryGate.rayalgo_trend_change_short_min_quality_score",
  "entryGate.allow_shorts",
  "entryGate.regime_filter",
  "riskWarden.daily_loss_limit_pct",
  "riskWarden.consecutive_loss_cooldown_count",
  "riskWarden.consecutive_loss_cooldown_minutes",
  "riskWarden.drawdown_throttle_pct",
  "riskWarden.drawdown_halt_pct",
  "riskWarden.max_concurrent_same_direction",
  "riskWarden.max_total_positions",
  "riskWarden.post_max_loss_cooldown_minutes",
  "riskWarden.persist_until_new_equity_high",
  "layers.l1_fraction",
  "layers.l2_fraction",
  "layers.l3_fraction",
  "layers.edge_bump_multiplier",
  "layers.edge_skip_threshold",
  "layers.max_layers_per_position",
  "dteSelection.base_dte_2m",
  "dteSelection.base_dte_5m_morning",
  "dteSelection.base_dte_5m_midday",
  "dteSelection.base_dte_5m_power_hour",
  "dteSelection.base_dte_15m",
  "dteSelection.dte_adj_trending",
  "dteSelection.dte_adj_neutral",
  "dteSelection.dte_adj_choppy",
  "dteSelection.dte_adj_high_vol",
  "dteSelection.dte_floor",
  "dteSelection.dte_cap",
  "dteSelection.midday_trending_0dte_confluence",
  "dteSelection.strike_slot",
  "executionPolicy.regime_adapt",
  "executionPolicy.comm_per_contract",
  "executionPolicy.slip_bps",
  "sessionPolicy.trade_day_mon",
  "sessionPolicy.trade_day_tue",
  "sessionPolicy.trade_day_wed",
  "sessionPolicy.trade_day_thu",
  "sessionPolicy.trade_day_fri",
  "sessionPolicy.block_0",
  "sessionPolicy.block_1",
  "sessionPolicy.block_2",
  "sessionPolicy.block_3",
  "sessionPolicy.block_4",
  "sessionPolicy.block_5",
  "sessionPolicy.block_6",
  "sessionPolicy.block_7",
  "sessionPolicy.block_8",
  "sessionPolicy.block_9",
  "sessionPolicy.block_10",
  "sessionPolicy.block_11",
  "sessionPolicy.block_12",
]);

const STAGED_ONLY_FIELD_PATHS = Object.freeze([
  "rfCalibrator.n_estimators",
  "rfCalibrator.max_depth",
  "rfCalibrator.min_samples_leaf",
  "rfCalibrator.min_trades_for_training",
  "rfCalibrator.retrain_interval",
  "rfCalibrator.rolling_window_size",
  "rfCalibrator.phase1_threshold",
  "rfCalibrator.phase2_threshold",
]);

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function coerceStageShape(value, defaults) {
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    return defaults;
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultValue]) => {
      const candidate = source[key];
      if (defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
        return [key, coerceStageShape(candidate, defaultValue)];
      }
      if (typeof defaultValue === "number") {
        const numeric = Number(candidate);
        return [key, Number.isFinite(numeric) ? numeric : defaultValue];
      }
      if (typeof defaultValue === "boolean") {
        return [key, candidate == null ? defaultValue : Boolean(candidate)];
      }
      if (typeof defaultValue === "string") {
        return [key, candidate == null ? defaultValue : String(candidate)];
      }
      return [key, candidate == null ? defaultValue : candidate];
    }),
  );
}

function optionalDateText(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function resolveMinutesFromTimestamp(entryTs, fallbackMinuteOfDay = 12 * 60) {
  const fallback = clampNumber(fallbackMinuteOfDay, 0, 23 * 60 + 59, 12 * 60);
  if (!entryTs) {
    return fallback;
  }
  const parsed = new Date(entryTs);
  const timeMs = parsed.getTime();
  if (!Number.isFinite(timeMs)) {
    return fallback;
  }
  return parsed.getUTCHours() * 60 + parsed.getUTCMinutes();
}

function resolveSignalBucket(signalTimeframe = "5m") {
  const tfMin = Math.max(1, timeframeToMinutes(signalTimeframe) || 5);
  if (tfMin <= 2) {
    return "2m";
  }
  if (tfMin <= 5) {
    return "5m";
  }
  return "15m";
}

function resolveSessionBucket(minuteOfDay) {
  if (minuteOfDay < 10 * 60 + 30) {
    return "morning";
  }
  if (minuteOfDay >= 15 * 60) {
    return "power_hour";
  }
  return "midday";
}

function resolveRegimeBucket(regime = {}) {
  const label = String(regime?.regime || "").trim().toLowerCase();
  if (label === "bull") {
    return "trending";
  }
  if (label === "bear") {
    return "choppy";
  }
  return "neutral";
}

function clampDte(value, fallback) {
  return Math.round(clampNumber(value, 0, 60, fallback));
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function normalizeStageRegimeFilter(value, fallback = "not_bear") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "none" || normalized === "not_bear") {
    return normalized;
  }
  return fallback;
}

function normalizeStageStrikeSlot(value, fallback = "auto") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return "auto";
  }
  return String(clampInteger(normalized, 0, 5, clampInteger(fallback, 0, 5, 3)));
}

function hasFiniteNumericValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));
}

function resolveStageStrikeSlot(value, fallback = null) {
  const normalized = normalizeStageStrikeSlot(value);
  if (normalized === "auto") {
    return hasFiniteNumericValue(fallback)
      ? clampInteger(fallback, 0, 5, 3)
      : null;
  }
  return clampInteger(normalized, 0, 5, 3);
}

function buildStageTradeDays(sessionPolicy = {}, fallback = []) {
  const defaults = Array.isArray(fallback) && fallback.length === 5
    ? fallback.map(Boolean)
    : [true, true, true, true, true];
  return [
    sessionPolicy?.trade_day_mon ?? defaults[0],
    sessionPolicy?.trade_day_tue ?? defaults[1],
    sessionPolicy?.trade_day_wed ?? defaults[2],
    sessionPolicy?.trade_day_thu ?? defaults[3],
    sessionPolicy?.trade_day_fri ?? defaults[4],
  ].map(Boolean);
}

function buildStageSessionBlocks(sessionPolicy = {}, fallback = []) {
  const defaults = Array.isArray(fallback) && fallback.length === 13
    ? fallback.map(Boolean)
    : [true, true, true, true, true, false, false, false, false, false, true, true, false];
  return Array.from({ length: 13 }, (_, index) => {
    const key = `block_${index}`;
    return Boolean(sessionPolicy?.[key] ?? defaults[index]);
  });
}

export function normalizeBacktestV2StageConfig(stageConfig = null) {
  const defaults = cloneBacktestV2StageDefaults();
  const merged = coerceStageShape(stageConfig, defaults);
  return {
    ...merged,
    runSettings: {
      ...merged.runSettings,
      profileName: normalizeText(merged.runSettings?.profileName, defaults.runSettings.profileName),
      startDate: optionalDateText(merged.runSettings?.startDate),
      endDate: optionalDateText(merged.runSettings?.endDate),
      initialCapital: clampNumber(merged.runSettings?.initialCapital, 100, 100000000, defaults.runSettings.initialCapital),
    },
    exitGovernor: {
      ...merged.exitGovernor,
      trail_activation_atr_0dte: clampNumber(
        merged.exitGovernor?.trail_activation_atr_0dte,
        0.05,
        5,
        defaults.exitGovernor.trail_activation_atr_0dte,
      ),
      trail_activation_atr_1dte: clampNumber(
        merged.exitGovernor?.trail_activation_atr_1dte,
        0.05,
        5,
        defaults.exitGovernor.trail_activation_atr_1dte,
      ),
      trail_activation_atr_2to3dte: clampNumber(
        merged.exitGovernor?.trail_activation_atr_2to3dte,
        0.05,
        5,
        defaults.exitGovernor.trail_activation_atr_2to3dte,
      ),
      trail_option_pnl_floor_0dte: clampNumber(
        merged.exitGovernor?.trail_option_pnl_floor_0dte,
        0,
        5,
        defaults.exitGovernor.trail_option_pnl_floor_0dte,
      ),
      trail_option_pnl_floor_1dte: clampNumber(
        merged.exitGovernor?.trail_option_pnl_floor_1dte,
        0,
        5,
        defaults.exitGovernor.trail_option_pnl_floor_1dte,
      ),
      trail_option_pnl_floor_2to3dte: clampNumber(
        merged.exitGovernor?.trail_option_pnl_floor_2to3dte,
        0,
        5,
        defaults.exitGovernor.trail_option_pnl_floor_2to3dte,
      ),
      trail_entry_drawdown_pct: clampNumber(
        merged.exitGovernor?.trail_entry_drawdown_pct,
        0.001,
        10,
        defaults.exitGovernor.trail_entry_drawdown_pct,
      ),
      trail_lock_ratio_initial: clampNumber(
        merged.exitGovernor?.trail_lock_ratio_initial,
        0,
        1,
        defaults.exitGovernor.trail_lock_ratio_initial,
      ),
      trail_lock_ratio_max: clampNumber(
        merged.exitGovernor?.trail_lock_ratio_max,
        0,
        1,
        defaults.exitGovernor.trail_lock_ratio_max,
      ),
      theta_tighten_0dte_30min: clampNumber(
        merged.exitGovernor?.theta_tighten_0dte_30min,
        0,
        1,
        defaults.exitGovernor.theta_tighten_0dte_30min,
      ),
      theta_tighten_0dte_60min: clampNumber(
        merged.exitGovernor?.theta_tighten_0dte_60min,
        0,
        1,
        defaults.exitGovernor.theta_tighten_0dte_60min,
      ),
      theta_tighten_0dte_90min: clampNumber(
        merged.exitGovernor?.theta_tighten_0dte_90min,
        0,
        1,
        defaults.exitGovernor.theta_tighten_0dte_90min,
      ),
      theta_tighten_1to3_60min: clampNumber(
        merged.exitGovernor?.theta_tighten_1to3_60min,
        0,
        1,
        defaults.exitGovernor.theta_tighten_1to3_60min,
      ),
      theta_tighten_1to3_120min: clampNumber(
        merged.exitGovernor?.theta_tighten_1to3_120min,
        0,
        1,
        defaults.exitGovernor.theta_tighten_1to3_120min,
      ),
      tod_multiplier_open: clampNumber(
        merged.exitGovernor?.tod_multiplier_open,
        0.1,
        5,
        defaults.exitGovernor.tod_multiplier_open,
      ),
      tod_multiplier_midmorning: clampNumber(
        merged.exitGovernor?.tod_multiplier_midmorning,
        0.1,
        5,
        defaults.exitGovernor.tod_multiplier_midmorning,
      ),
      tod_multiplier_midday: clampNumber(
        merged.exitGovernor?.tod_multiplier_midday,
        0.1,
        5,
        defaults.exitGovernor.tod_multiplier_midday,
      ),
      tod_multiplier_power_hour: clampNumber(
        merged.exitGovernor?.tod_multiplier_power_hour,
        0.1,
        5,
        defaults.exitGovernor.tod_multiplier_power_hour,
      ),
      regime_multiplier_trending: clampNumber(
        merged.exitGovernor?.regime_multiplier_trending,
        0.1,
        5,
        defaults.exitGovernor.regime_multiplier_trending,
      ),
      regime_multiplier_neutral: clampNumber(
        merged.exitGovernor?.regime_multiplier_neutral,
        0.1,
        5,
        defaults.exitGovernor.regime_multiplier_neutral,
      ),
      regime_multiplier_choppy: clampNumber(
        merged.exitGovernor?.regime_multiplier_choppy,
        0.1,
        5,
        defaults.exitGovernor.regime_multiplier_choppy,
      ),
      time_cliff_0dte_minutes: clampInteger(
        merged.exitGovernor?.time_cliff_0dte_minutes,
        0,
        390,
        defaults.exitGovernor.time_cliff_0dte_minutes,
      ),
      time_cliff_1to3dte_eod: Boolean(merged.exitGovernor?.time_cliff_1to3dte_eod),
      time_cliff_5plus_sessions: clampInteger(
        merged.exitGovernor?.time_cliff_5plus_sessions,
        0,
        20,
        defaults.exitGovernor.time_cliff_5plus_sessions,
      ),
      time_cliff_profitable_override: Boolean(merged.exitGovernor?.time_cliff_profitable_override),
      max_loss_0dte_pct: clampNumber(
        merged.exitGovernor?.max_loss_0dte_pct,
        0.01,
        10,
        defaults.exitGovernor.max_loss_0dte_pct,
      ),
      max_loss_1to3dte_pct: clampNumber(
        merged.exitGovernor?.max_loss_1to3dte_pct,
        0.01,
        10,
        defaults.exitGovernor.max_loss_1to3dte_pct,
      ),
      max_loss_5plus_pct: clampNumber(
        merged.exitGovernor?.max_loss_5plus_pct,
        0.01,
        10,
        defaults.exitGovernor.max_loss_5plus_pct,
      ),
      take_profit_pct: clampNumber(
        merged.exitGovernor?.take_profit_pct,
        0.01,
        10,
        defaults.exitGovernor.take_profit_pct,
      ),
      zombie_bars: clampInteger(
        merged.exitGovernor?.zombie_bars,
        1,
        500,
        defaults.exitGovernor.zombie_bars,
      ),
    },
    entryGate: {
      ...merged.entryGate,
      edge_ratio_skip: clampNumber(merged.entryGate?.edge_ratio_skip, 0.1, 5, defaults.entryGate.edge_ratio_skip),
      edge_ratio_half: clampNumber(merged.entryGate?.edge_ratio_half, 0.1, 5, defaults.entryGate.edge_ratio_half),
      edge_ratio_0dte_shift: clampNumber(merged.entryGate?.edge_ratio_0dte_shift, -2, 2, defaults.entryGate.edge_ratio_0dte_shift),
      edge_ratio_weekend_shift: clampNumber(merged.entryGate?.edge_ratio_weekend_shift, -2, 2, defaults.entryGate.edge_ratio_weekend_shift),
      vix_confluence_floor_low: clampNumber(merged.entryGate?.vix_confluence_floor_low, 0, 1, defaults.entryGate.vix_confluence_floor_low),
      vix_confluence_floor_mid: clampNumber(merged.entryGate?.vix_confluence_floor_mid, 0, 1, defaults.entryGate.vix_confluence_floor_mid),
      vix_confluence_floor_high: clampNumber(merged.entryGate?.vix_confluence_floor_high, 0, 1, defaults.entryGate.vix_confluence_floor_high),
      vix_confluence_floor_very_high: clampNumber(merged.entryGate?.vix_confluence_floor_very_high, 0, 1, defaults.entryGate.vix_confluence_floor_very_high),
      vix_25_30_trending_edge_shift: clampNumber(
        merged.entryGate?.vix_25_30_trending_edge_shift,
        -2,
        2,
        defaults.entryGate.vix_25_30_trending_edge_shift,
      ),
      vix_30_plus_trending_edge_shift: clampNumber(
        merged.entryGate?.vix_30_plus_trending_edge_shift,
        -2,
        2,
        defaults.entryGate.vix_30_plus_trending_edge_shift,
      ),
      vix_25_30_choppy_skip: Boolean(merged.entryGate?.vix_25_30_choppy_skip),
      vix_30_plus_choppy_skip: Boolean(merged.entryGate?.vix_30_plus_choppy_skip),
      regime_expected_move_trending: clampNumber(
        merged.entryGate?.regime_expected_move_trending,
        0.1,
        5,
        defaults.entryGate.regime_expected_move_trending,
      ),
      regime_expected_move_neutral: clampNumber(
        merged.entryGate?.regime_expected_move_neutral,
        0.1,
        5,
        defaults.entryGate.regime_expected_move_neutral,
      ),
      regime_expected_move_choppy: clampNumber(
        merged.entryGate?.regime_expected_move_choppy,
        0.1,
        5,
        defaults.entryGate.regime_expected_move_choppy,
      ),
      kelly_fraction: clampNumber(merged.entryGate?.kelly_fraction, 0, 5, defaults.entryGate.kelly_fraction),
      kelly_floor_pct: clampNumber(merged.entryGate?.kelly_floor_pct, 0, 25, defaults.entryGate.kelly_floor_pct),
      kelly_ceiling_pct: clampNumber(merged.entryGate?.kelly_ceiling_pct, 0, 25, defaults.entryGate.kelly_ceiling_pct),
      kelly_lookback_trades: clampNumber(merged.entryGate?.kelly_lookback_trades, 5, 200, defaults.entryGate.kelly_lookback_trades),
      max_position_pct: clampNumber(merged.entryGate?.max_position_pct, 0.5, 100, defaults.entryGate.max_position_pct),
      max_exposure_pct: clampNumber(merged.entryGate?.max_exposure_pct, 0.5, 100, defaults.entryGate.max_exposure_pct),
      mtf_confirm_upgrades_sizing: Boolean(merged.entryGate?.mtf_confirm_upgrades_sizing),
      opposite_direction_skip: Boolean(merged.entryGate?.opposite_direction_skip),
      min_conviction: clampNumber(merged.entryGate?.min_conviction, 0.01, 1, defaults.entryGate.min_conviction),
      rayalgo_min_quality_score: hasFiniteNumericValue(merged.entryGate?.rayalgo_min_quality_score)
        ? clampNumber(merged.entryGate?.rayalgo_min_quality_score, 0, 1, defaults.entryGate.rayalgo_min_quality_score)
        : defaults.entryGate.rayalgo_min_quality_score,
      rayalgo_trend_change_min_quality_score: hasFiniteNumericValue(merged.entryGate?.rayalgo_trend_change_min_quality_score)
        ? clampNumber(merged.entryGate?.rayalgo_trend_change_min_quality_score, 0, 1, defaults.entryGate.rayalgo_trend_change_min_quality_score)
        : defaults.entryGate.rayalgo_trend_change_min_quality_score,
      rayalgo_long_min_quality_score: hasFiniteNumericValue(merged.entryGate?.rayalgo_long_min_quality_score)
        ? clampNumber(merged.entryGate?.rayalgo_long_min_quality_score, 0, 1, defaults.entryGate.rayalgo_long_min_quality_score)
        : defaults.entryGate.rayalgo_long_min_quality_score,
      rayalgo_short_min_quality_score: hasFiniteNumericValue(merged.entryGate?.rayalgo_short_min_quality_score)
        ? clampNumber(merged.entryGate?.rayalgo_short_min_quality_score, 0, 1, defaults.entryGate.rayalgo_short_min_quality_score)
        : defaults.entryGate.rayalgo_short_min_quality_score,
      rayalgo_trend_change_long_min_quality_score: hasFiniteNumericValue(merged.entryGate?.rayalgo_trend_change_long_min_quality_score)
        ? clampNumber(merged.entryGate?.rayalgo_trend_change_long_min_quality_score, 0, 1, defaults.entryGate.rayalgo_trend_change_long_min_quality_score)
        : defaults.entryGate.rayalgo_trend_change_long_min_quality_score,
      rayalgo_trend_change_short_min_quality_score: hasFiniteNumericValue(merged.entryGate?.rayalgo_trend_change_short_min_quality_score)
        ? clampNumber(merged.entryGate?.rayalgo_trend_change_short_min_quality_score, 0, 1, defaults.entryGate.rayalgo_trend_change_short_min_quality_score)
        : defaults.entryGate.rayalgo_trend_change_short_min_quality_score,
      allow_shorts: Boolean(merged.entryGate?.allow_shorts),
      regime_filter: normalizeStageRegimeFilter(merged.entryGate?.regime_filter, defaults.entryGate.regime_filter),
    },
    riskWarden: {
      ...merged.riskWarden,
      daily_loss_limit_pct: clampNumber(merged.riskWarden?.daily_loss_limit_pct, 0, 100, defaults.riskWarden.daily_loss_limit_pct),
      consecutive_loss_cooldown_count: clampInteger(
        merged.riskWarden?.consecutive_loss_cooldown_count,
        0,
        20,
        defaults.riskWarden.consecutive_loss_cooldown_count,
      ),
      consecutive_loss_cooldown_minutes: clampInteger(
        merged.riskWarden?.consecutive_loss_cooldown_minutes,
        0,
        1440,
        defaults.riskWarden.consecutive_loss_cooldown_minutes,
      ),
      drawdown_throttle_pct: clampNumber(merged.riskWarden?.drawdown_throttle_pct, 0, 100, defaults.riskWarden.drawdown_throttle_pct),
      drawdown_halt_pct: clampNumber(merged.riskWarden?.drawdown_halt_pct, 0, 100, defaults.riskWarden.drawdown_halt_pct),
      max_concurrent_same_direction: clampNumber(
        merged.riskWarden?.max_concurrent_same_direction,
        1,
        50,
        defaults.riskWarden.max_concurrent_same_direction,
      ),
      max_total_positions: clampInteger(
        merged.riskWarden?.max_total_positions,
        1,
        50,
        defaults.riskWarden.max_total_positions,
      ),
      post_max_loss_cooldown_minutes: clampInteger(
        merged.riskWarden?.post_max_loss_cooldown_minutes,
        0,
        1440,
        defaults.riskWarden.post_max_loss_cooldown_minutes,
      ),
      persist_until_new_equity_high: Boolean(merged.riskWarden?.persist_until_new_equity_high),
    },
    layers: {
      ...merged.layers,
      l1_fraction: clampNumber(merged.layers?.l1_fraction, 0.05, 5, defaults.layers.l1_fraction),
      l2_fraction: clampNumber(merged.layers?.l2_fraction, 0.05, 5, defaults.layers.l2_fraction),
      l3_fraction: clampNumber(merged.layers?.l3_fraction, 0.05, 5, defaults.layers.l3_fraction),
      edge_bump_multiplier: clampNumber(
        merged.layers?.edge_bump_multiplier,
        1,
        5,
        defaults.layers.edge_bump_multiplier,
      ),
      edge_skip_threshold: clampNumber(
        merged.layers?.edge_skip_threshold,
        0.5,
        5,
        defaults.layers.edge_skip_threshold,
      ),
      max_layers_per_position: clampInteger(
        merged.layers?.max_layers_per_position,
        1,
        5,
        defaults.layers.max_layers_per_position,
      ),
    },
    dteSelection: {
      ...merged.dteSelection,
      base_dte_2m: clampDte(merged.dteSelection?.base_dte_2m, defaults.dteSelection.base_dte_2m),
      base_dte_5m_morning: clampDte(merged.dteSelection?.base_dte_5m_morning, defaults.dteSelection.base_dte_5m_morning),
      base_dte_5m_midday: clampDte(merged.dteSelection?.base_dte_5m_midday, defaults.dteSelection.base_dte_5m_midday),
      base_dte_5m_power_hour: clampDte(merged.dteSelection?.base_dte_5m_power_hour, defaults.dteSelection.base_dte_5m_power_hour),
      base_dte_15m: clampDte(merged.dteSelection?.base_dte_15m, defaults.dteSelection.base_dte_15m),
      dte_adj_trending: clampNumber(merged.dteSelection?.dte_adj_trending, -10, 10, defaults.dteSelection.dte_adj_trending),
      dte_adj_neutral: clampNumber(merged.dteSelection?.dte_adj_neutral, -10, 10, defaults.dteSelection.dte_adj_neutral),
      dte_adj_choppy: clampNumber(merged.dteSelection?.dte_adj_choppy, -10, 10, defaults.dteSelection.dte_adj_choppy),
      dte_adj_high_vol: clampNumber(merged.dteSelection?.dte_adj_high_vol, -10, 10, defaults.dteSelection.dte_adj_high_vol),
      dte_floor: clampDte(merged.dteSelection?.dte_floor, defaults.dteSelection.dte_floor),
      dte_cap: clampDte(merged.dteSelection?.dte_cap, defaults.dteSelection.dte_cap),
      midday_trending_0dte_confluence: clampNumber(
        merged.dteSelection?.midday_trending_0dte_confluence,
        0,
        1,
        defaults.dteSelection.midday_trending_0dte_confluence,
      ),
      strike_slot: normalizeStageStrikeSlot(merged.dteSelection?.strike_slot, defaults.dteSelection.strike_slot),
    },
    executionPolicy: {
      ...merged.executionPolicy,
      regime_adapt: Boolean(merged.executionPolicy?.regime_adapt),
      comm_per_contract: clampNumber(
        merged.executionPolicy?.comm_per_contract,
        0,
        25,
        defaults.executionPolicy.comm_per_contract,
      ),
      slip_bps: clampInteger(
        merged.executionPolicy?.slip_bps,
        0,
        5000,
        defaults.executionPolicy.slip_bps,
      ),
    },
    sessionPolicy: {
      ...merged.sessionPolicy,
      trade_day_mon: Boolean(merged.sessionPolicy?.trade_day_mon),
      trade_day_tue: Boolean(merged.sessionPolicy?.trade_day_tue),
      trade_day_wed: Boolean(merged.sessionPolicy?.trade_day_wed),
      trade_day_thu: Boolean(merged.sessionPolicy?.trade_day_thu),
      trade_day_fri: Boolean(merged.sessionPolicy?.trade_day_fri),
      block_0: Boolean(merged.sessionPolicy?.block_0),
      block_1: Boolean(merged.sessionPolicy?.block_1),
      block_2: Boolean(merged.sessionPolicy?.block_2),
      block_3: Boolean(merged.sessionPolicy?.block_3),
      block_4: Boolean(merged.sessionPolicy?.block_4),
      block_5: Boolean(merged.sessionPolicy?.block_5),
      block_6: Boolean(merged.sessionPolicy?.block_6),
      block_7: Boolean(merged.sessionPolicy?.block_7),
      block_8: Boolean(merged.sessionPolicy?.block_8),
      block_9: Boolean(merged.sessionPolicy?.block_9),
      block_10: Boolean(merged.sessionPolicy?.block_10),
      block_11: Boolean(merged.sessionPolicy?.block_11),
      block_12: Boolean(merged.sessionPolicy?.block_12),
    },
  };
}

export function buildBacktestV2ExitGovernorConfig(stageConfig = null) {
  const normalizedStage = normalizeBacktestV2StageConfig(stageConfig);
  return {
    trailActivationAtr0dte: clampNumber(normalizedStage.exitGovernor?.trail_activation_atr_0dte, 0.05, 5, 0.4),
    trailActivationAtr1dte: clampNumber(normalizedStage.exitGovernor?.trail_activation_atr_1dte, 0.05, 5, 0.6),
    trailActivationAtr2to3dte: clampNumber(normalizedStage.exitGovernor?.trail_activation_atr_2to3dte, 0.05, 5, 0.85),
    trailOptionPnlFloor0dte: clampNumber(normalizedStage.exitGovernor?.trail_option_pnl_floor_0dte, 0, 5, 0.15),
    trailOptionPnlFloor1dte: clampNumber(normalizedStage.exitGovernor?.trail_option_pnl_floor_1dte, 0, 5, 0.1),
    trailOptionPnlFloor2to3dte: clampNumber(normalizedStage.exitGovernor?.trail_option_pnl_floor_2to3dte, 0, 5, 0.08),
    trailEntryDrawdownPct: clampNumber(normalizedStage.exitGovernor?.trail_entry_drawdown_pct, 0.001, 10, 0.18),
    trailLockRatioInitial: clampNumber(normalizedStage.exitGovernor?.trail_lock_ratio_initial, 0, 1, 0.4),
    trailLockRatioMax: clampNumber(normalizedStage.exitGovernor?.trail_lock_ratio_max, 0, 1, 0.8),
    thetaTighten0dte30min: clampNumber(normalizedStage.exitGovernor?.theta_tighten_0dte_30min, 0, 1, 0.1),
    thetaTighten0dte60min: clampNumber(normalizedStage.exitGovernor?.theta_tighten_0dte_60min, 0, 1, 0.2),
    thetaTighten0dte90min: clampNumber(normalizedStage.exitGovernor?.theta_tighten_0dte_90min, 0, 1, 0.3),
    thetaTighten1to3dte60min: clampNumber(normalizedStage.exitGovernor?.theta_tighten_1to3_60min, 0, 1, 0.1),
    thetaTighten1to3dte120min: clampNumber(normalizedStage.exitGovernor?.theta_tighten_1to3_120min, 0, 1, 0.15),
    todMultipliers: {
      open: clampNumber(normalizedStage.exitGovernor?.tod_multiplier_open, 0.1, 5, 1.2),
      midmorning: clampNumber(normalizedStage.exitGovernor?.tod_multiplier_midmorning, 0.1, 5, 1),
      midday: clampNumber(normalizedStage.exitGovernor?.tod_multiplier_midday, 0.1, 5, 0.9),
      powerHour: clampNumber(normalizedStage.exitGovernor?.tod_multiplier_power_hour, 0.1, 5, 0.85),
    },
    regimeMultipliers: {
      trending: clampNumber(normalizedStage.exitGovernor?.regime_multiplier_trending, 0.1, 5, 1.15),
      neutral: clampNumber(normalizedStage.exitGovernor?.regime_multiplier_neutral, 0.1, 5, 1),
      choppy: clampNumber(normalizedStage.exitGovernor?.regime_multiplier_choppy, 0.1, 5, 0.85),
    },
    timeCliff0dteMinutes: clampInteger(
      normalizedStage.exitGovernor?.time_cliff_0dte_minutes,
      0,
        390,
      45,
    ),
    timeCliff1to3dteEod: Boolean(normalizedStage.exitGovernor?.time_cliff_1to3dte_eod),
    timeCliff5plusSessions: clampInteger(
      normalizedStage.exitGovernor?.time_cliff_5plus_sessions,
      0,
      20,
      2,
    ),
    timeCliffProfitableOverride: Boolean(normalizedStage.exitGovernor?.time_cliff_profitable_override),
    maxLoss0dtePct: clampNumber(normalizedStage.exitGovernor?.max_loss_0dte_pct, 0.01, 10, 0.5),
    maxLoss1to3dtePct: clampNumber(normalizedStage.exitGovernor?.max_loss_1to3dte_pct, 0.01, 10, 0.4),
    maxLoss5plusPct: clampNumber(normalizedStage.exitGovernor?.max_loss_5plus_pct, 0.01, 10, 0.3),
    takeProfitPct: clampNumber(normalizedStage.exitGovernor?.take_profit_pct, 0.01, 10, 0.35),
    zombieBars: clampInteger(normalizedStage.exitGovernor?.zombie_bars, 1, 500, 30),
  };
}

export function buildBacktestV2EntryGateConfig(stageConfig = null) {
  const normalizedStage = normalizeBacktestV2StageConfig(stageConfig);
  return {
    edgeRatioSkip: clampNumber(normalizedStage.entryGate?.edge_ratio_skip, 0.1, 5, 1.1),
    edgeRatioHalf: Math.max(
      clampNumber(normalizedStage.entryGate?.edge_ratio_skip, 0.1, 5, 1.1),
      clampNumber(normalizedStage.entryGate?.edge_ratio_half, 0.1, 5, 1.3),
    ),
    edgeRatio0dteShift: clampNumber(normalizedStage.entryGate?.edge_ratio_0dte_shift, -2, 2, 0.1),
    edgeRatioWeekendShift: clampNumber(normalizedStage.entryGate?.edge_ratio_weekend_shift, -2, 2, 0.15),
    vixConfluenceFloors: {
      low: clampNumber(normalizedStage.entryGate?.vix_confluence_floor_low, 0, 1, 0.55),
      mid: clampNumber(normalizedStage.entryGate?.vix_confluence_floor_mid, 0, 1, 0.7),
      high: clampNumber(normalizedStage.entryGate?.vix_confluence_floor_high, 0, 1, 0.85),
      veryHigh: clampNumber(normalizedStage.entryGate?.vix_confluence_floor_very_high, 0, 1, 0.9),
    },
    vix25To30TrendingEdgeShift: clampNumber(normalizedStage.entryGate?.vix_25_30_trending_edge_shift, -2, 2, 0.1),
    vix30PlusTrendingEdgeShift: clampNumber(normalizedStage.entryGate?.vix_30_plus_trending_edge_shift, -2, 2, 0.2),
    vix25To30ChoppySkip: Boolean(normalizedStage.entryGate?.vix_25_30_choppy_skip),
    vix30PlusChoppySkip: Boolean(normalizedStage.entryGate?.vix_30_plus_choppy_skip),
    regimeExpectedMoveMultipliers: {
      trending: clampNumber(normalizedStage.entryGate?.regime_expected_move_trending, 0.1, 5, 1.3),
      neutral: clampNumber(normalizedStage.entryGate?.regime_expected_move_neutral, 0.1, 5, 1),
      choppy: clampNumber(normalizedStage.entryGate?.regime_expected_move_choppy, 0.1, 5, 0.7),
    },
    mtfConfirmUpgradesSizing: Boolean(normalizedStage.entryGate?.mtf_confirm_upgrades_sizing),
    oppositeDirectionSkip: Boolean(normalizedStage.entryGate?.opposite_direction_skip),
    minConviction: clampNumber(normalizedStage.entryGate?.min_conviction, 0.01, 1, 0.48),
    rayalgoMinQualityScore: hasFiniteNumericValue(normalizedStage.entryGate?.rayalgo_min_quality_score)
      ? clampNumber(normalizedStage.entryGate?.rayalgo_min_quality_score, 0, 1, null)
      : null,
    rayalgoTrendChangeMinQualityScore: hasFiniteNumericValue(normalizedStage.entryGate?.rayalgo_trend_change_min_quality_score)
      ? clampNumber(normalizedStage.entryGate?.rayalgo_trend_change_min_quality_score, 0, 1, null)
      : null,
    rayalgoLongMinQualityScore: hasFiniteNumericValue(normalizedStage.entryGate?.rayalgo_long_min_quality_score)
      ? clampNumber(normalizedStage.entryGate?.rayalgo_long_min_quality_score, 0, 1, null)
      : null,
    rayalgoShortMinQualityScore: hasFiniteNumericValue(normalizedStage.entryGate?.rayalgo_short_min_quality_score)
      ? clampNumber(normalizedStage.entryGate?.rayalgo_short_min_quality_score, 0, 1, null)
      : null,
    rayalgoTrendChangeLongMinQualityScore: hasFiniteNumericValue(normalizedStage.entryGate?.rayalgo_trend_change_long_min_quality_score)
      ? clampNumber(normalizedStage.entryGate?.rayalgo_trend_change_long_min_quality_score, 0, 1, null)
      : null,
    rayalgoTrendChangeShortMinQualityScore: hasFiniteNumericValue(normalizedStage.entryGate?.rayalgo_trend_change_short_min_quality_score)
      ? clampNumber(normalizedStage.entryGate?.rayalgo_trend_change_short_min_quality_score, 0, 1, null)
      : null,
    allowShorts: Boolean(normalizedStage.entryGate?.allow_shorts),
    regimeFilter: normalizeStageRegimeFilter(normalizedStage.entryGate?.regime_filter, "not_bear"),
  };
}

export function buildBacktestV2ExecutionPolicyConfig(stageConfig = null) {
  const normalizedStage = normalizeBacktestV2StageConfig(stageConfig);
  return {
    regimeAdapt: Boolean(normalizedStage.executionPolicy?.regime_adapt),
    commPerContract: clampNumber(normalizedStage.executionPolicy?.comm_per_contract, 0, 25, 0.65),
    slipBps: clampInteger(normalizedStage.executionPolicy?.slip_bps, 0, 5000, 150),
    tradeDays: buildStageTradeDays(normalizedStage.sessionPolicy),
    sessionBlocks: buildStageSessionBlocks(normalizedStage.sessionPolicy),
  };
}

export function buildBacktestV2LayerConfig(stageConfig = null) {
  const normalizedStage = normalizeBacktestV2StageConfig(stageConfig);
  return {
    layerFractions: [
      clampNumber(normalizedStage.layers?.l1_fraction, 0.05, 5, 1),
      clampNumber(normalizedStage.layers?.l2_fraction, 0.05, 5, 0.5),
      clampNumber(normalizedStage.layers?.l3_fraction, 0.05, 5, 0.25),
    ],
    edgeBumpMultiplier: clampNumber(
      normalizedStage.layers?.edge_bump_multiplier,
      1,
      5,
      1.2,
    ),
    edgeSkipThreshold: clampNumber(
      normalizedStage.layers?.edge_skip_threshold,
      0.5,
      5,
      1.1,
    ),
    maxLayersPerPosition: clampInteger(
      normalizedStage.layers?.max_layers_per_position,
      1,
      5,
      3,
    ),
  };
}

export function filterBarsForBacktestV2Window(bars = [], stageConfig = null) {
  const normalizedStage = normalizeBacktestV2StageConfig(stageConfig);
  const startDate = normalizedStage.runSettings.startDate;
  const endDate = normalizedStage.runSettings.endDate;
  if (!startDate && !endDate) {
    return Array.isArray(bars) ? bars : [];
  }
  return (Array.isArray(bars) ? bars : []).filter((bar) => {
    const date = String(bar?.date || "").trim();
    if (!date) {
      return false;
    }
    if (startDate && date < startDate) {
      return false;
    }
    if (endDate && date > endDate) {
      return false;
    }
    return true;
  });
}

export function resolveBacktestV2CandidateSelection({
  stageConfig = null,
  signalTimeframe = "5m",
  regime = null,
  signal = null,
  entryTs = null,
  fallbackMinuteOfDay = 12 * 60,
  fallbackStrikeSlot = null,
} = {}) {
  const normalizedStage = normalizeBacktestV2StageConfig(stageConfig);
  const signalBucket = resolveSignalBucket(signalTimeframe);
  const sessionBucket = resolveSessionBucket(resolveMinutesFromTimestamp(entryTs, fallbackMinuteOfDay));
  let targetDte = normalizedStage.dteSelection.base_dte_15m;
  if (signalBucket === "2m") {
    targetDte = normalizedStage.dteSelection.base_dte_2m;
  } else if (signalBucket === "5m") {
    if (sessionBucket === "power_hour") {
      targetDte = normalizedStage.dteSelection.base_dte_5m_power_hour;
    } else if (sessionBucket === "midday") {
      targetDte = normalizedStage.dteSelection.base_dte_5m_midday;
    } else {
      targetDte = normalizedStage.dteSelection.base_dte_5m_morning;
    }
  }
  const regimeBucket = resolveRegimeBucket(regime);
  if (regimeBucket === "trending") {
    targetDte += normalizedStage.dteSelection.dte_adj_trending;
  } else if (regimeBucket === "choppy") {
    targetDte += normalizedStage.dteSelection.dte_adj_choppy;
  } else {
    targetDte += normalizedStage.dteSelection.dte_adj_neutral;
  }
  const vix = Number(regime?.vix);
  if (Number.isFinite(vix) && vix >= 25) {
    targetDte += normalizedStage.dteSelection.dte_adj_high_vol;
  }
  const dteFloor = normalizedStage.dteSelection.dte_floor;
  const dteCap = Math.max(dteFloor, normalizedStage.dteSelection.dte_cap);
  let clampedTargetDte = Math.min(dteCap, Math.max(dteFloor, Math.round(targetDte)));
  const signalConfluence = Number(
    signal?.scoring?.confluence
    ?? signal?.confluence
    ?? signal?.conviction
    ?? signal?.score,
  );
  if (
    sessionBucket === "midday"
    && regimeBucket === "trending"
    && clampedTargetDte <= 0
    && Number.isFinite(signalConfluence)
    && signalConfluence < normalizedStage.dteSelection.midday_trending_0dte_confluence
  ) {
    clampedTargetDte = Math.min(dteCap, Math.max(dteFloor, 1));
  }
  return {
    targetDte: clampedTargetDte,
    minDte: clampedTargetDte,
    maxDte: clampedTargetDte,
    strikeSlot: resolveStageStrikeSlot(normalizedStage.dteSelection.strike_slot, fallbackStrikeSlot),
    selectionMode: `v2_${signalBucket}_${sessionBucket}_${regimeBucket}`,
  };
}

export function compileBacktestV2RuntimeBridge({
  stageConfig = null,
  signalTimeframe = "5m",
  fallbackCapital = 25000,
  fallbackDte = 5,
  fallbackKellyFrac = 0.25,
  fallbackMaxPositions = 4,
  fallbackRiskStopPolicy = "disabled",
  fallbackOptionSelectionSpec = null,
} = {}) {
  const hasExplicitStageConfig = Boolean(
    stageConfig
    && typeof stageConfig === "object"
    && !Array.isArray(stageConfig),
  );
  const normalizedStage = normalizeBacktestV2StageConfig(stageConfig);
  const fallbackSelectionSpec = fallbackOptionSelectionSpec && typeof fallbackOptionSelectionSpec === "object"
    ? fallbackOptionSelectionSpec
    : {};
  const legacyFallbackSelection = {
    targetDte: Number.isFinite(Number(fallbackSelectionSpec?.targetDte))
      ? clampDte(fallbackSelectionSpec.targetDte, fallbackDte)
      : clampDte(fallbackDte, 5),
    minDte: Number.isFinite(Number(fallbackSelectionSpec?.minDte))
      ? clampDte(fallbackSelectionSpec.minDte, fallbackDte)
      : null,
    maxDte: Number.isFinite(Number(fallbackSelectionSpec?.maxDte))
      ? clampDte(fallbackSelectionSpec.maxDte, fallbackDte)
      : null,
    strikeSlot: Number.isFinite(Number(fallbackSelectionSpec?.strikeSlot))
      ? Number(fallbackSelectionSpec.strikeSlot)
      : null,
  };
  if (legacyFallbackSelection.minDte == null && legacyFallbackSelection.maxDte == null) {
    legacyFallbackSelection.minDte = legacyFallbackSelection.targetDte;
    legacyFallbackSelection.maxDte = legacyFallbackSelection.targetDte;
  } else {
    if (legacyFallbackSelection.minDte == null) {
      legacyFallbackSelection.minDte = legacyFallbackSelection.maxDte ?? legacyFallbackSelection.targetDte;
    }
    if (legacyFallbackSelection.maxDte == null) {
      legacyFallbackSelection.maxDte = legacyFallbackSelection.minDte ?? legacyFallbackSelection.targetDte;
    }
  }
  const defaultSelection = hasExplicitStageConfig
    ? resolveBacktestV2CandidateSelection({
      stageConfig: normalizedStage,
      signalTimeframe,
      regime: { regime: "range", vix: 17 },
      // Once staged config is present, strike selection comes from v2 config only.
      fallbackStrikeSlot: null,
    })
    : legacyFallbackSelection;
  const positionSizingConfig = hasExplicitStageConfig
    ? {
      kellyLookbackTrades: clampNumber(
        normalizedStage.entryGate.kelly_lookback_trades,
        5,
        200,
        30,
      ),
      kellyFloorPct: clampNumber(
        normalizedStage.entryGate.kelly_floor_pct,
        0.1,
        25,
        0.5,
      ),
      kellyCeilingPct: Math.max(
        clampNumber(normalizedStage.entryGate.kelly_floor_pct, 0.1, 25, 0.5),
        clampNumber(normalizedStage.entryGate.kelly_ceiling_pct, 0.1, 25, 5),
      ),
      maxPositionPct: clampNumber(
        normalizedStage.entryGate.max_position_pct,
        0.5,
        100,
        10,
      ),
      maxExposurePct: Math.max(
        clampNumber(normalizedStage.entryGate.max_position_pct, 0.5, 100, 10),
        clampNumber(normalizedStage.entryGate.max_exposure_pct, 0.5, 100, 15),
      ),
    }
    : {
      kellyLookbackTrades: 30,
      kellyFloorPct: 0.5,
      kellyCeilingPct: 5,
      maxPositionPct: 10,
      maxExposurePct: 100,
    };
  const drawdownThrottlePct = hasExplicitStageConfig
    ? clampNumber(
      normalizedStage.riskWarden.drawdown_throttle_pct,
      0,
      100,
      5,
    )
    : 0;
  const entryGateConfig = hasExplicitStageConfig
    ? buildBacktestV2EntryGateConfig(normalizedStage)
    : null;
  const riskStopConfig = hasExplicitStageConfig
    ? {
      dailyLossLimitPct: clampNumber(
        normalizedStage.riskWarden.daily_loss_limit_pct,
        0,
        100,
        3,
      ),
      consecutiveLossCooldownCount: clampInteger(
        normalizedStage.riskWarden.consecutive_loss_cooldown_count,
        0,
        20,
        3,
      ),
      consecutiveLossCooldownMinutes: clampInteger(
        normalizedStage.riskWarden.consecutive_loss_cooldown_minutes,
        0,
        1440,
        30,
      ),
      drawdownThrottlePct,
      drawdownHaltPct: Math.max(
        drawdownThrottlePct,
        clampNumber(
        normalizedStage.riskWarden.drawdown_halt_pct,
        drawdownThrottlePct,
        100,
        12,
        ),
      ),
      maxConcurrentSameDirection: clampNumber(
        normalizedStage.riskWarden.max_concurrent_same_direction,
        1,
        50,
        2,
      ),
      maxPositions: clampInteger(
        normalizedStage.riskWarden.max_total_positions,
        1,
        50,
        fallbackMaxPositions,
      ),
      postMaxLossCooldownMinutes: clampInteger(
        normalizedStage.riskWarden.post_max_loss_cooldown_minutes,
        0,
        1440,
        10,
      ),
      persistUntilNewEquityHigh: Boolean(normalizedStage.riskWarden.persist_until_new_equity_high),
    }
    : {
      dailyLossLimitPct: 3,
      consecutiveLossCooldownCount: 0,
      consecutiveLossCooldownMinutes: 0,
      drawdownThrottlePct: 0,
      drawdownHaltPct: 12,
      maxConcurrentSameDirection: clampNumber(fallbackMaxPositions, 1, 50, 4),
      maxPositions: clampInteger(fallbackMaxPositions, 1, 50, 4),
      postMaxLossCooldownMinutes: 0,
      persistUntilNewEquityHigh: false,
    };
  const layerConfig = hasExplicitStageConfig
    ? buildBacktestV2LayerConfig(normalizedStage)
    : null;
  const exitGovernorConfig = hasExplicitStageConfig
    ? buildBacktestV2ExitGovernorConfig(normalizedStage)
    : null;
  const executionPolicyConfig = hasExplicitStageConfig
    ? buildBacktestV2ExecutionPolicyConfig(normalizedStage)
    : null;
  const shouldEnableRiskStop = hasExplicitStageConfig
    ? (riskStopConfig.dailyLossLimitPct > 0 || riskStopConfig.drawdownHaltPct > 0)
    : String(fallbackRiskStopPolicy || "").trim().toLowerCase() === "legacy_halt";

  return {
    stageConfig: hasExplicitStageConfig ? normalizedStage : null,
    dateWindow: {
      startDate: hasExplicitStageConfig ? (normalizedStage.runSettings.startDate || null) : null,
      endDate: hasExplicitStageConfig ? (normalizedStage.runSettings.endDate || null) : null,
    },
    legacyOverrides: {
      capital: hasExplicitStageConfig
        ? clampNumber(normalizedStage.runSettings.initialCapital, 100, 100000000, fallbackCapital)
        : clampNumber(fallbackCapital, 100, 100000000, 25000),
      dte: clampDte(defaultSelection.targetDte, fallbackDte),
      kellyFrac: hasExplicitStageConfig
        ? clampNumber(normalizedStage.entryGate.kelly_fraction, 0, 5, fallbackKellyFrac)
        : clampNumber(fallbackKellyFrac, 0, 5, 0.25),
      maxPositions: clampInteger(
        hasExplicitStageConfig ? normalizedStage.riskWarden.max_total_positions : fallbackMaxPositions,
        1,
        50,
        4,
      ),
      riskStopPolicy: shouldEnableRiskStop
        ? "legacy_halt"
        : String(fallbackRiskStopPolicy || "").trim().toLowerCase() || "disabled",
      optionSelectionSpec: {
        ...fallbackSelectionSpec,
        targetDte: defaultSelection.targetDte,
        minDte: defaultSelection.minDte,
        maxDte: defaultSelection.maxDte,
        strikeSlot: defaultSelection.strikeSlot,
      },
    },
    positionSizingConfig,
    entryGateConfig,
    riskStopConfig,
    layerConfig,
    exitGovernorConfig,
    executionPolicyConfig,
    optionSelectionSpec: {
      targetDte: defaultSelection.targetDte,
      minDte: defaultSelection.minDte,
      maxDte: defaultSelection.maxDte,
      strikeSlot: defaultSelection.strikeSlot,
    },
    replaySelectionConfig: {
      dynamicTargetDte: hasExplicitStageConfig,
      fallbackSelection: defaultSelection,
    },
    support: {
      profileName: hasExplicitStageConfig ? normalizedStage.runSettings.profileName : null,
      appliedFieldPaths: hasExplicitStageConfig ? APPLIED_STAGE_FIELD_PATHS : [],
      stagedOnlyFieldPaths: hasExplicitStageConfig ? STAGED_ONLY_FIELD_PATHS : [],
    },
  };
}
