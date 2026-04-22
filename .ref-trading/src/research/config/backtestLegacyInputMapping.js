import { cloneBacktestV2StageDefaults } from "./backtestV2StagingConfig.js";
import { normalizeBacktestV2StageConfig } from "./backtestV2RuntimeBridge.js";

const FIXED_DTE_BASE_PATHS = Object.freeze([
  "dteSelection.base_dte_2m",
  "dteSelection.base_dte_5m_morning",
  "dteSelection.base_dte_5m_midday",
  "dteSelection.base_dte_5m_power_hour",
  "dteSelection.base_dte_15m",
]);

const FIXED_DTE_ADJUSTMENT_PATHS = Object.freeze([
  "dteSelection.dte_adj_trending",
  "dteSelection.dte_adj_neutral",
  "dteSelection.dte_adj_choppy",
  "dteSelection.dte_adj_high_vol",
]);

const SESSION_BLOCK_STAGE_PATHS = Object.freeze([
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

const TRADE_DAY_STAGE_PATHS = Object.freeze([
  "sessionPolicy.trade_day_mon",
  "sessionPolicy.trade_day_tue",
  "sessionPolicy.trade_day_wed",
  "sessionPolicy.trade_day_thu",
  "sessionPolicy.trade_day_fri",
]);

export const LEGACY_BACKTEST_INPUT_MAPPINGS = Object.freeze([
  { legacyKey: "capital", replacementKind: "exact", stagePaths: ["runSettings.initialCapital"] },
  { legacyKey: "kellyFrac", replacementKind: "exact", stagePaths: ["entryGate.kelly_fraction"] },
  {
    legacyKey: "dte",
    replacementKind: "derived",
    stagePaths: [
      ...FIXED_DTE_BASE_PATHS,
      ...FIXED_DTE_ADJUSTMENT_PATHS,
      "dteSelection.dte_floor",
      "dteSelection.dte_cap",
    ],
  },
  {
    legacyKey: "slPct",
    replacementKind: "derived",
    stagePaths: [
      "exitGovernor.max_loss_0dte_pct",
      "exitGovernor.max_loss_1to3dte_pct",
      "exitGovernor.max_loss_5plus_pct",
    ],
  },
  { legacyKey: "tpPct", replacementKind: "exact", stagePaths: ["exitGovernor.take_profit_pct"] },
  {
    legacyKey: "trailStartPct",
    replacementKind: "derived",
    stagePaths: [
      "exitGovernor.trail_option_pnl_floor_0dte",
      "exitGovernor.trail_option_pnl_floor_1dte",
      "exitGovernor.trail_option_pnl_floor_2to3dte",
    ],
  },
  { legacyKey: "trailPct", replacementKind: "exact", stagePaths: ["exitGovernor.trail_entry_drawdown_pct"] },
  { legacyKey: "zombieBars", replacementKind: "exact", stagePaths: ["exitGovernor.zombie_bars"] },
  { legacyKey: "minConviction", replacementKind: "exact", stagePaths: ["entryGate.min_conviction"] },
  { legacyKey: "optionStrikeSlot", replacementKind: "exact", stagePaths: ["dteSelection.strike_slot"] },
  { legacyKey: "maxPos", replacementKind: "exact", stagePaths: ["riskWarden.max_total_positions"] },
  { legacyKey: "regimeFilter", replacementKind: "exact", stagePaths: ["entryGate.regime_filter"] },
  { legacyKey: "regimeAdapt", replacementKind: "exact", stagePaths: ["executionPolicy.regime_adapt"] },
  { legacyKey: "sessionBlocks", replacementKind: "derived", stagePaths: SESSION_BLOCK_STAGE_PATHS },
  { legacyKey: "tradeDays", replacementKind: "derived", stagePaths: TRADE_DAY_STAGE_PATHS },
  { legacyKey: "allowShorts", replacementKind: "exact", stagePaths: ["entryGate.allow_shorts"] },
  { legacyKey: "commPerContract", replacementKind: "exact", stagePaths: ["executionPolicy.comm_per_contract"] },
  { legacyKey: "slipBps", replacementKind: "exact", stagePaths: ["executionPolicy.slip_bps"] },
]);

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function updateNestedValue(target, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!keys.length) {
    return target;
  }
  const next = Array.isArray(target) ? [...target] : { ...(target || {}) };
  let cursor = next;
  let sourceCursor = target || {};
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    const currentValue = sourceCursor?.[key];
    const branch = Array.isArray(currentValue) ? [...currentValue] : { ...(currentValue || {}) };
    cursor[key] = branch;
    cursor = branch;
    sourceCursor = currentValue || {};
  }
  cursor[keys[keys.length - 1]] = value;
  return next;
}

function normalizeFixedLegacyDte(value) {
  return Math.round(clampNumber(value, 0, 10, 5));
}

function normalizeStrikeSlotValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "auto";
  }
  return String(Math.max(0, Math.min(5, Math.round(numeric))));
}

function parseStageStrikeSlot(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return null;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(5, Math.round(numeric))) : null;
}

function normalizeBooleanArray(values, expectedLength, fallback = true) {
  if (!Array.isArray(values) || values.length !== expectedLength) {
    return Array(expectedLength).fill(Boolean(fallback));
  }
  return values.map(Boolean);
}

function normalizeLegacyRegimeFilter(value, fallback = "not_bear") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "none" ? "none" : fallback;
}

function normalizeCompatibleRegimeFilter(value, fallback = "none") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "none" || normalized === "not_bear") {
    return normalized;
  }
  return fallback;
}

function normalizeLegacyRiskStopPolicy(value, fallback = "disabled") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function hasFiniteNumber(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));
}

function normalizeLegacyOptionSelectionSpec(optionSelectionSpec = {}, fallbackDte = 5) {
  const hasMinDte = hasFiniteNumber(optionSelectionSpec?.minDte);
  const hasMaxDte = hasFiniteNumber(optionSelectionSpec?.maxDte);
  const hasTargetDte = hasFiniteNumber(optionSelectionSpec?.targetDte);
  const hasStrikeSlot = hasFiniteNumber(optionSelectionSpec?.strikeSlot);
  const rawMoneyness = String(optionSelectionSpec?.moneyness || "").trim().toLowerCase();
  const hasLegacyMoneyness = ["itm", "atm", "otm"].includes(rawMoneyness);
  const hasLegacyStrikeSteps = hasFiniteNumber(optionSelectionSpec?.strikeSteps);

  let minDte = hasMinDte ? normalizeFixedLegacyDte(optionSelectionSpec?.minDte) : null;
  let maxDte = hasMaxDte ? normalizeFixedLegacyDte(optionSelectionSpec?.maxDte) : null;

  if (minDte == null && maxDte == null && hasTargetDte) {
    const targetDte = normalizeFixedLegacyDte(optionSelectionSpec?.targetDte);
    minDte = targetDte;
    maxDte = targetDte;
  } else {
    if (minDte == null) {
      minDte = maxDte ?? normalizeFixedLegacyDte(fallbackDte);
    }
    if (maxDte == null) {
      maxDte = minDte ?? normalizeFixedLegacyDte(fallbackDte);
    }
  }

  return {
    targetDte: hasTargetDte
      ? normalizeFixedLegacyDte(optionSelectionSpec?.targetDte)
      : normalizeFixedLegacyDte(fallbackDte),
    minDte,
    maxDte: Math.max(minDte, maxDte),
    strikeSlot: hasStrikeSlot
      ? Math.max(0, Math.min(5, Math.round(Number(optionSelectionSpec?.strikeSlot))))
      : null,
    moneyness: hasLegacyMoneyness ? rawMoneyness : null,
    strikeSteps: hasLegacyStrikeSteps
      ? Math.max(0, Math.min(25, Math.round(Number(optionSelectionSpec?.strikeSteps))))
      : null,
  };
}

function cloneNormalizedStageConfig(stageConfig = null) {
  const source = stageConfig == null ? cloneBacktestV2StageDefaults() : stageConfig;
  return normalizeBacktestV2StageConfig(source);
}

export function applyLegacyTopRailFieldsToStageConfig(stageConfig = null, legacyFields = {}) {
  let nextStageConfig = cloneNormalizedStageConfig(stageConfig);

  if (Number.isFinite(Number(legacyFields?.capital))) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "runSettings.initialCapital",
      Math.round(clampNumber(legacyFields.capital, 100, 100000000, nextStageConfig.runSettings.initialCapital)),
    );
  }

  if (Number.isFinite(Number(legacyFields?.kellyFrac))) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "entryGate.kelly_fraction",
      clampNumber(legacyFields.kellyFrac, 0, 5, nextStageConfig.entryGate.kelly_fraction),
    );
  }

  if (Number.isFinite(Number(legacyFields?.dte))) {
    const fixedDte = normalizeFixedLegacyDte(legacyFields.dte);
    FIXED_DTE_BASE_PATHS.forEach((path) => {
      nextStageConfig = updateNestedValue(nextStageConfig, path, fixedDte);
    });
    FIXED_DTE_ADJUSTMENT_PATHS.forEach((path) => {
      nextStageConfig = updateNestedValue(nextStageConfig, path, 0);
    });
    nextStageConfig = updateNestedValue(nextStageConfig, "dteSelection.dte_floor", fixedDte);
    nextStageConfig = updateNestedValue(nextStageConfig, "dteSelection.dte_cap", fixedDte);
  }

  if (Number.isFinite(Number(legacyFields?.slPct))) {
    const stopLossPct = clampNumber(legacyFields.slPct, 0.01, 10, nextStageConfig.exitGovernor.max_loss_1to3dte_pct);
    [
      "exitGovernor.max_loss_0dte_pct",
      "exitGovernor.max_loss_1to3dte_pct",
      "exitGovernor.max_loss_5plus_pct",
    ].forEach((path) => {
      nextStageConfig = updateNestedValue(nextStageConfig, path, stopLossPct);
    });
  }

  if (Number.isFinite(Number(legacyFields?.tpPct))) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "exitGovernor.take_profit_pct",
      clampNumber(legacyFields.tpPct, 0.01, 10, nextStageConfig.exitGovernor.take_profit_pct),
    );
  }

  if (Number.isFinite(Number(legacyFields?.trailStartPct))) {
    const trailFloorPct = clampNumber(legacyFields.trailStartPct, 0.001, 10, nextStageConfig.exitGovernor.trail_option_pnl_floor_1dte);
    [
      "exitGovernor.trail_option_pnl_floor_0dte",
      "exitGovernor.trail_option_pnl_floor_1dte",
      "exitGovernor.trail_option_pnl_floor_2to3dte",
    ].forEach((path) => {
      nextStageConfig = updateNestedValue(nextStageConfig, path, trailFloorPct);
    });
  }

  if (Number.isFinite(Number(legacyFields?.trailPct))) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "exitGovernor.trail_entry_drawdown_pct",
      clampNumber(legacyFields.trailPct, 0.001, 10, nextStageConfig.exitGovernor.trail_entry_drawdown_pct),
    );
  }

  if (Number.isFinite(Number(legacyFields?.zombieBars))) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "exitGovernor.zombie_bars",
      Math.round(clampNumber(legacyFields.zombieBars, 1, 500, nextStageConfig.exitGovernor.zombie_bars)),
    );
  }

  if (Number.isFinite(Number(legacyFields?.minConviction))) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "entryGate.min_conviction",
      clampNumber(legacyFields.minConviction, 0.01, 1, nextStageConfig.entryGate.min_conviction),
    );
  }

  if (legacyFields?.optionStrikeSlot !== undefined) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "dteSelection.strike_slot",
      normalizeStrikeSlotValue(legacyFields.optionStrikeSlot),
    );
  }

  if (Number.isFinite(Number(legacyFields?.maxPos))) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "riskWarden.max_total_positions",
      Math.round(clampNumber(legacyFields.maxPos, 1, 50, nextStageConfig.riskWarden.max_total_positions)),
    );
  }

  if (legacyFields?.regimeFilter !== undefined) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "entryGate.regime_filter",
      normalizeLegacyRegimeFilter(legacyFields.regimeFilter, nextStageConfig.entryGate.regime_filter),
    );
  }

  if (typeof legacyFields?.regimeAdapt === "boolean") {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "executionPolicy.regime_adapt",
      Boolean(legacyFields.regimeAdapt),
    );
  }

  if (Array.isArray(legacyFields?.sessionBlocks) && legacyFields.sessionBlocks.length === SESSION_BLOCK_STAGE_PATHS.length) {
    SESSION_BLOCK_STAGE_PATHS.forEach((path, index) => {
      nextStageConfig = updateNestedValue(nextStageConfig, path, Boolean(legacyFields.sessionBlocks[index]));
    });
  }

  if (Array.isArray(legacyFields?.tradeDays) && legacyFields.tradeDays.length === TRADE_DAY_STAGE_PATHS.length) {
    TRADE_DAY_STAGE_PATHS.forEach((path, index) => {
      nextStageConfig = updateNestedValue(nextStageConfig, path, Boolean(legacyFields.tradeDays[index]));
    });
  }

  if (typeof legacyFields?.allowShorts === "boolean") {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "entryGate.allow_shorts",
      Boolean(legacyFields.allowShorts),
    );
  }

  if (Number.isFinite(Number(legacyFields?.commPerContract))) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "executionPolicy.comm_per_contract",
      clampNumber(legacyFields.commPerContract, 0, 25, nextStageConfig.executionPolicy.comm_per_contract),
    );
  }

  if (Number.isFinite(Number(legacyFields?.slipBps))) {
    nextStageConfig = updateNestedValue(
      nextStageConfig,
      "executionPolicy.slip_bps",
      Math.round(clampNumber(legacyFields.slipBps, 0, 5000, nextStageConfig.executionPolicy.slip_bps)),
    );
  }

  return normalizeBacktestV2StageConfig(nextStageConfig);
}

export function projectLegacyTopRailFieldsFromStageConfig(stageConfig = null) {
  const normalizedStageConfig = cloneNormalizedStageConfig(stageConfig);
  const dteValues = FIXED_DTE_BASE_PATHS.map((path) => {
    const keys = path.split(".");
    return keys.reduce((value, key) => value?.[key], normalizedStageConfig);
  });
  const uniqueDteValues = Array.from(new Set(dteValues.map((value) => normalizeFixedLegacyDte(value))));
  const hasZeroAdjustments = FIXED_DTE_ADJUSTMENT_PATHS.every((path) => {
    const keys = path.split(".");
    return Number(keys.reduce((value, key) => value?.[key], normalizedStageConfig) || 0) === 0;
  });
  const fixedDte = uniqueDteValues.length === 1
    && hasZeroAdjustments
    && normalizeFixedLegacyDte(normalizedStageConfig?.dteSelection?.dte_floor) === uniqueDteValues[0]
    && normalizeFixedLegacyDte(normalizedStageConfig?.dteSelection?.dte_cap) === uniqueDteValues[0]
    ? uniqueDteValues[0]
    : null;

  return {
    capital: Math.round(clampNumber(normalizedStageConfig?.runSettings?.initialCapital, 100, 100000000, 25000)),
    kellyFrac: clampNumber(normalizedStageConfig?.entryGate?.kelly_fraction, 0, 5, 0.25),
    dte: fixedDte,
    slPct: clampNumber(normalizedStageConfig?.exitGovernor?.max_loss_1to3dte_pct, 0.01, 10, 0.25),
    tpPct: clampNumber(normalizedStageConfig?.exitGovernor?.take_profit_pct, 0.01, 10, 0.35),
    trailStartPct: clampNumber(normalizedStageConfig?.exitGovernor?.trail_option_pnl_floor_1dte, 0.001, 10, 0.08),
    trailPct: clampNumber(normalizedStageConfig?.exitGovernor?.trail_entry_drawdown_pct, 0.001, 10, 0.18),
    zombieBars: Math.round(clampNumber(normalizedStageConfig?.exitGovernor?.zombie_bars, 1, 500, 30)),
    minConviction: clampNumber(normalizedStageConfig?.entryGate?.min_conviction, 0.01, 1, 0.48),
    optionStrikeSlot: parseStageStrikeSlot(normalizedStageConfig?.dteSelection?.strike_slot),
    maxPos: Math.round(clampNumber(normalizedStageConfig?.riskWarden?.max_total_positions, 1, 50, 4)),
    regimeFilter: normalizeLegacyRegimeFilter(normalizedStageConfig?.entryGate?.regime_filter, "not_bear"),
    regimeAdapt: Boolean(normalizedStageConfig?.executionPolicy?.regime_adapt),
    sessionBlocks: SESSION_BLOCK_STAGE_PATHS.map((path) => {
      const keys = path.split(".");
      return Boolean(keys.reduce((value, key) => value?.[key], normalizedStageConfig));
    }),
    tradeDays: TRADE_DAY_STAGE_PATHS.map((path) => {
      const keys = path.split(".");
      return Boolean(keys.reduce((value, key) => value?.[key], normalizedStageConfig));
    }),
    allowShorts: Boolean(normalizedStageConfig?.entryGate?.allow_shorts),
    commPerContract: clampNumber(normalizedStageConfig?.executionPolicy?.comm_per_contract, 0, 25, 0.65),
    slipBps: Math.round(clampNumber(normalizedStageConfig?.executionPolicy?.slip_bps, 0, 5000, 150)),
  };
}

export function extractLegacyTopRailFieldsFromRuntimePayload(payload = {}) {
  const optionSelectionSpec = payload?.optionSelectionSpec && typeof payload.optionSelectionSpec === "object"
    ? payload.optionSelectionSpec
    : null;
  const next = {};

  if (Object.prototype.hasOwnProperty.call(payload, "capital")) {
    next.capital = payload.capital;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "kellyFrac")) {
    next.kellyFrac = payload.kellyFrac;
  }
  if (Number.isFinite(Number(optionSelectionSpec?.targetDte))) {
    next.dte = optionSelectionSpec.targetDte;
  } else if (Object.prototype.hasOwnProperty.call(payload, "dte")) {
    next.dte = payload.dte;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "slPct")) {
    next.slPct = payload.slPct;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "tpPct")) {
    next.tpPct = payload.tpPct;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "trailStartPct")) {
    next.trailStartPct = payload.trailStartPct;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "trailPct")) {
    next.trailPct = payload.trailPct;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "zombieBars")) {
    next.zombieBars = payload.zombieBars;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "minConviction")) {
    next.minConviction = payload.minConviction;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "allowShorts")) {
    next.allowShorts = payload.allowShorts;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "regimeFilter")) {
    next.regimeFilter = payload.regimeFilter;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "regimeAdapt")) {
    next.regimeAdapt = payload.regimeAdapt;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "sessionBlocks")) {
    next.sessionBlocks = payload.sessionBlocks;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "tradeDays")) {
    next.tradeDays = payload.tradeDays;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "commPerContract")) {
    next.commPerContract = payload.commPerContract;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "slipBps")) {
    next.slipBps = payload.slipBps;
  }
  if (Number.isFinite(Number(optionSelectionSpec?.strikeSlot))) {
    next.optionStrikeSlot = optionSelectionSpec.strikeSlot;
  } else if (Object.prototype.hasOwnProperty.call(payload, "optionStrikeSlot")) {
    next.optionStrikeSlot = payload.optionStrikeSlot;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "maxPositions")) {
    next.maxPos = payload.maxPositions;
  } else if (Object.prototype.hasOwnProperty.call(payload, "maxPos")) {
    next.maxPos = payload.maxPos;
  }

  return next;
}

export function resolveLegacyTopRailCompatFields({
  stageConfig = null,
  runtimeBridge = null,
  fallbackFields = {},
} = {}) {
  const bridge = runtimeBridge && typeof runtimeBridge === "object"
    ? runtimeBridge
    : null;
  const stageSource = bridge?.stageConfig || stageConfig || null;
  const hasStageConfig = Boolean(
    stageSource
    && typeof stageSource === "object"
    && !Array.isArray(stageSource),
  );
  const stageProjection = hasStageConfig
    ? projectLegacyTopRailFieldsFromStageConfig(stageSource)
    : null;
  const fallbackDte = Object.prototype.hasOwnProperty.call(fallbackFields, "dte")
    ? fallbackFields.dte
    : (stageProjection?.dte ?? 5);
  const fallbackOptionSelectionSpec = normalizeLegacyOptionSelectionSpec(
    fallbackFields?.optionSelectionSpec,
    fallbackDte,
  );
  const bridgeOptionSelectionSpec = bridge?.optionSelectionSpec || bridge?.legacyOverrides?.optionSelectionSpec || null;
  const optionSelectionSpec = bridgeOptionSelectionSpec
    ? normalizeLegacyOptionSelectionSpec(
      bridgeOptionSelectionSpec,
      bridge?.legacyOverrides?.dte ?? fallbackDte,
    )
    : fallbackOptionSelectionSpec;
  const maxPos = Math.round(clampNumber(
    bridge?.legacyOverrides?.maxPositions,
    1,
    50,
    stageProjection?.maxPos ?? fallbackFields?.maxPos ?? fallbackFields?.maxPositions ?? 4,
  ));

  return {
    capital: Math.round(clampNumber(
      bridge?.legacyOverrides?.capital,
      100,
      100000000,
      stageProjection?.capital ?? fallbackFields?.capital ?? 25000,
    )),
    kellyFrac: clampNumber(
      bridge?.legacyOverrides?.kellyFrac,
      0,
      5,
      stageProjection?.kellyFrac ?? fallbackFields?.kellyFrac ?? 0.25,
    ),
    dte: normalizeFixedLegacyDte(
      bridge?.legacyOverrides?.dte ?? stageProjection?.dte ?? optionSelectionSpec?.targetDte ?? fallbackDte,
    ),
    slPct: clampNumber(
      stageProjection?.slPct,
      0.01,
      10,
      clampNumber(fallbackFields?.slPct, 0.01, 10, 0.25),
    ),
    tpPct: clampNumber(
      stageProjection?.tpPct,
      0.01,
      10,
      clampNumber(fallbackFields?.tpPct, 0.01, 10, 0.35),
    ),
    trailStartPct: clampNumber(
      stageProjection?.trailStartPct,
      0.001,
      10,
      clampNumber(fallbackFields?.trailStartPct, 0.001, 10, 0.08),
    ),
    trailPct: clampNumber(
      stageProjection?.trailPct,
      0.001,
      10,
      clampNumber(fallbackFields?.trailPct, 0.001, 10, 0.18),
    ),
    zombieBars: Math.round(clampNumber(
      stageProjection?.zombieBars,
      1,
      500,
      clampNumber(fallbackFields?.zombieBars, 1, 500, 30),
    )),
    minConviction: clampNumber(
      stageProjection?.minConviction,
      0.01,
      1,
      clampNumber(fallbackFields?.minConviction, 0.01, 1, 0.48),
    ),
    allowShorts: stageProjection?.allowShorts ?? Boolean(fallbackFields?.allowShorts),
    regimeFilter: stageProjection?.regimeFilter ?? normalizeCompatibleRegimeFilter(fallbackFields?.regimeFilter, "none"),
    regimeAdapt: stageProjection?.regimeAdapt ?? Boolean(fallbackFields?.regimeAdapt),
    maxPos,
    maxPositions: maxPos,
    sessionBlocks: stageProjection?.sessionBlocks
      ? stageProjection.sessionBlocks.map(Boolean)
      : normalizeBooleanArray(fallbackFields?.sessionBlocks, SESSION_BLOCK_STAGE_PATHS.length, true),
    tradeDays: stageProjection?.tradeDays
      ? stageProjection.tradeDays.map(Boolean)
      : normalizeBooleanArray(fallbackFields?.tradeDays, TRADE_DAY_STAGE_PATHS.length, true),
    commPerContract: clampNumber(
      stageProjection?.commPerContract,
      0,
      25,
      clampNumber(fallbackFields?.commPerContract, 0, 25, 0.65),
    ),
    slipBps: Math.round(clampNumber(
      stageProjection?.slipBps,
      0,
      5000,
      clampNumber(fallbackFields?.slipBps, 0, 5000, 150),
    )),
    riskStopPolicy: normalizeLegacyRiskStopPolicy(
      bridge?.legacyOverrides?.riskStopPolicy ?? fallbackFields?.riskStopPolicy,
      "disabled",
    ),
    optionSelectionSpec,
  };
}
