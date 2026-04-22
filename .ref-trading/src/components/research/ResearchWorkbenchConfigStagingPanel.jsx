import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BACKTEST_V2_STAGE_DEFAULTS,
  BACKTEST_V2_STAGE_VISUAL_GROUPS,
} from "../../research/config/backtestV2StagingConfig.js";
import DraftNumberInput from "../shared/DraftNumberInput.jsx";
import { B, F, FS } from "./sidebar/shared.jsx";

const PANEL_BG = "#ffffff";
const PANEL_ALT = "#f7fbff";
const PANEL_SOFT = "#f8fafc";
const BORDER_SUBTLE = "#e2e8f0";
const BORDER_STRONG = "#d6e0ea";
const MUTED = "#5f7287";
const SUBTLE = "#89a0b5";
const SUCCESS = "#059669";
const WARNING = "#d97706";
const CHANGED_BORDER = "#fdba74";
const CHANGED_SURFACE = "#fff8ee";
const SHADOW = "0 1px 2px rgba(15,23,42,0.04)";
const PACKED_GRID_GAP = 6;
const PACKED_ROW_HEIGHT = 4;
const SECTION_GRID_COLUMNS = 6;
const SECTION_STACK_GAP = PACKED_GRID_GAP;
const FIELD_LAYOUT_TO_SPAN = {
  compact: "span 2",
  normal: "span 3",
  wide: "1 / -1",
};
const TONE_PALETTES = {
  setup: { accent: "#0f766e", soft: "#ccfbf1", surface: "#f3fffb", border: "#99f6e4" },
  entry: { accent: "#2563eb", soft: "#dbeafe", surface: "#f8fbff", border: "#bfdbfe" },
  exit: { accent: "#d97706", soft: "#ffedd5", surface: "#fffaf4", border: "#fed7aa" },
  sizing: { accent: "#0f766e", soft: "#ccfbf1", surface: "#f2fffb", border: "#99f6e4" },
  risk: { accent: "#dc2626", soft: "#fee2e2", surface: "#fff8f8", border: "#fecaca" },
  dte: { accent: "#4f46e5", soft: "#e0e7ff", surface: "#f8f8ff", border: "#c7d2fe" },
  neutral: { accent: B, soft: "#e0e7ff", surface: "#ffffff", border: BORDER_SUBTLE },
};
const VISUAL_GROUP_ORDER = [
  "runSetup",
  "entryQualification",
  "volatilityRegime",
  "sizingPlan",
  "accountGuardrails",
  "dtePolicy",
  "exitLogic",
];
const BAND_FIELD_WIDTHS = {
  narrow: 46,
  compact: 52,
  medium: 64,
  wide: 82,
  xwide: 96,
  toggle: 68,
};
const BAND_GRID_COLUMNS = 5;
const BAND_GRID_GAP = 5;
const GROUP_HEADER_TRACK = 104;
const BAND_LABEL_TRACK = 68;
const COMPOSITE_GROUP_SPAN_OVERRIDES = {
  runSetup: 1,
  dtePolicy: 1,
  volatilityRegime: 1,
  sizingPlan: 1,
};
const GROUP_BAND_LAYOUTS = {
  runSetup: [
    {
      key: "run-setup-primary",
      fields: [
        { path: "runSettings.profileName", width: "wide" },
        { path: "runSettings.startDate", width: "medium" },
        { path: "runSettings.endDate", width: "medium" },
        { path: "runSettings.initialCapital", width: "medium" },
      ],
    },
  ],
  entryQualification: [
    {
      key: "entry-thresholds",
      label: "Thresholds",
      fields: [
        { path: "entryGate.edge_ratio_skip", width: "narrow" },
        { path: "entryGate.edge_ratio_half", width: "narrow" },
        { path: "entryGate.edge_ratio_weekend_shift", width: "narrow" },
      ],
    },
    {
      key: "entry-confirmation",
      label: "Confirmation",
      fields: [
        { path: "entryGate.mtf_confirm_upgrades_sizing", width: "toggle" },
        { path: "entryGate.opposite_direction_skip", width: "toggle" },
      ],
    },
  ],
  volatilityRegime: [
    {
      key: "volatility-floors",
      label: "VIX Floors",
      fields: [
        { path: "entryGate.vix_confluence_floor_low", width: "narrow" },
        { path: "entryGate.vix_confluence_floor_mid", width: "narrow" },
        { path: "entryGate.vix_confluence_floor_high", width: "narrow" },
        { path: "entryGate.vix_confluence_floor_very_high", width: "narrow" },
      ],
    },
    {
      key: "volatility-shifts-bias",
      label: "Shifts & Bias",
      fields: [
        { path: "entryGate.vix_25_30_trending_edge_shift", width: "narrow" },
        { path: "entryGate.vix_30_plus_trending_edge_shift", width: "narrow" },
        { path: "entryGate.vix_25_30_choppy_skip", width: "toggle" },
        { path: "entryGate.vix_30_plus_choppy_skip", width: "toggle" },
        { path: "entryGate.regime_expected_move_trending", width: "narrow" },
        { path: "entryGate.regime_expected_move_neutral", width: "narrow" },
        { path: "entryGate.regime_expected_move_choppy", width: "narrow" },
      ],
    },
  ],
  sizingPlan: [
    {
      key: "sizing-kelly-caps",
      label: "Kelly & Caps",
      fields: [
        { path: "entryGate.kelly_fraction", width: "narrow" },
        { path: "entryGate.kelly_floor_pct", width: "narrow" },
        { path: "entryGate.kelly_ceiling_pct", width: "narrow" },
        { path: "entryGate.kelly_lookback_trades", width: "compact" },
        { path: "entryGate.max_position_pct", width: "narrow" },
        { path: "entryGate.max_exposure_pct", width: "narrow" },
      ],
    },
    {
      key: "sizing-layers",
      label: "Layers",
      fields: [
        { path: "layers.l1_fraction", width: "narrow" },
        { path: "layers.l2_fraction", width: "narrow" },
        { path: "layers.l3_fraction", width: "narrow" },
        { path: "layers.edge_bump_multiplier", width: "narrow" },
        { path: "layers.edge_skip_threshold", width: "narrow" },
        { path: "layers.max_layers_per_position", width: "compact" },
      ],
    },
  ],
  accountGuardrails: [
    {
      key: "risk-envelope",
      label: "Loss Envelope",
      fields: [
        { path: "riskWarden.daily_loss_limit_pct", width: "narrow" },
        { path: "riskWarden.drawdown_throttle_pct", width: "narrow" },
        { path: "riskWarden.drawdown_halt_pct", width: "narrow" },
      ],
    },
    {
      key: "risk-cooldown",
      label: "Cooldown",
      fields: [
        { path: "riskWarden.consecutive_loss_cooldown_count", width: "compact" },
        { path: "riskWarden.consecutive_loss_cooldown_minutes", width: "compact" },
        { path: "riskWarden.post_max_loss_cooldown_minutes", width: "compact" },
        { path: "riskWarden.max_concurrent_same_direction", width: "compact" },
        { path: "riskWarden.persist_until_new_equity_high", width: "toggle" },
      ],
    },
  ],
  dtePolicy: [
    {
      key: "dte-overrides",
      label: "Overrides",
      fields: [
        { path: "entryGate.edge_ratio_0dte_shift", width: "narrow" },
        { path: "dteSelection.midday_trending_0dte_confluence", width: "narrow" },
        { path: "dteSelection.dte_floor", width: "compact" },
        { path: "dteSelection.dte_cap", width: "compact" },
      ],
    },
    {
      key: "dte-base",
      label: "Base DTE",
      fields: [
        { path: "dteSelection.base_dte_2m", width: "compact" },
        { path: "dteSelection.base_dte_5m_morning", width: "compact" },
        { path: "dteSelection.base_dte_5m_midday", width: "compact" },
        { path: "dteSelection.base_dte_5m_power_hour", width: "compact" },
        { path: "dteSelection.base_dte_15m", width: "compact" },
      ],
    },
    {
      key: "dte-regime",
      label: "Regime Adj",
      fields: [
        { path: "dteSelection.dte_adj_trending", width: "compact" },
        { path: "dteSelection.dte_adj_neutral", width: "compact" },
        { path: "dteSelection.dte_adj_choppy", width: "compact" },
        { path: "dteSelection.dte_adj_high_vol", width: "compact" },
      ],
    },
  ],
};
const PRIMARY_CONTEXT_BAND_LAYOUTS = {
  runSetup: [
    {
      key: "run-setup-profile",
      label: "Profile",
      fields: [
        { path: "runSettings.profileName", width: "wide" },
        { path: "runSettings.initialCapital", width: "medium" },
      ],
    },
    {
      key: "run-setup-window",
      label: "Window",
      fields: [
        { path: "runSettings.startDate", width: "medium" },
        { path: "runSettings.endDate", width: "medium" },
      ],
    },
  ],
  accountGuardrails: [
    {
      key: "guardrails-limits",
      label: "Limits",
      fields: [
        { path: "riskWarden.daily_loss_limit_pct", width: "narrow" },
        { path: "riskWarden.drawdown_throttle_pct", width: "narrow" },
        { path: "riskWarden.drawdown_halt_pct", width: "narrow" },
        { path: "riskWarden.max_concurrent_same_direction", width: "compact" },
      ],
    },
    {
      key: "guardrails-cooldown",
      label: "Cooldown",
      fields: [
        { path: "riskWarden.consecutive_loss_cooldown_count", width: "compact" },
        { path: "riskWarden.consecutive_loss_cooldown_minutes", width: "compact" },
        { path: "riskWarden.post_max_loss_cooldown_minutes", width: "compact" },
        { path: "riskWarden.persist_until_new_equity_high", width: "toggle" },
      ],
    },
  ],
};
const COMPOSITE_ROW_BAND_LAYOUTS = {
  entryQualification: GROUP_BAND_LAYOUTS.entryQualification,
  dtePolicy: [
    {
      key: "dte-overrides-compact",
      label: "Overrides",
      fields: [
        { path: "entryGate.edge_ratio_0dte_shift", width: "narrow" },
        { path: "dteSelection.midday_trending_0dte_confluence", width: "narrow" },
        { path: "dteSelection.dte_floor", width: "compact" },
        { path: "dteSelection.dte_cap", width: "compact" },
      ],
    },
    {
      key: "dte-selection-compact",
      label: "Selection",
      fields: [
        { path: "dteSelection.base_dte_2m", width: "compact" },
        { path: "dteSelection.base_dte_5m_morning", width: "compact" },
        { path: "dteSelection.base_dte_5m_midday", width: "compact" },
        { path: "dteSelection.base_dte_5m_power_hour", width: "compact" },
        { path: "dteSelection.base_dte_15m", width: "compact" },
        { path: "dteSelection.dte_adj_trending", width: "compact" },
        { path: "dteSelection.dte_adj_neutral", width: "compact" },
        { path: "dteSelection.dte_adj_choppy", width: "compact" },
        { path: "dteSelection.dte_adj_high_vol", width: "compact" },
      ],
    },
  ],
  volatilityRegime: [
    {
      key: "volatility-floors-compact",
      label: "VIX Floors",
      fields: [
        { path: "entryGate.vix_confluence_floor_low", width: "narrow" },
        { path: "entryGate.vix_confluence_floor_mid", width: "narrow" },
        { path: "entryGate.vix_confluence_floor_high", width: "narrow" },
        { path: "entryGate.vix_confluence_floor_very_high", width: "narrow" },
      ],
    },
    {
      key: "volatility-shifts-vetoes-compact",
      label: "Shifts + Vetoes",
      fields: [
        { path: "entryGate.vix_25_30_trending_edge_shift", width: "narrow" },
        { path: "entryGate.vix_30_plus_trending_edge_shift", width: "narrow" },
        { path: "entryGate.vix_25_30_choppy_skip", width: "toggle" },
        { path: "entryGate.vix_30_plus_choppy_skip", width: "toggle" },
      ],
    },
    {
      key: "volatility-bias-compact",
      label: "Bias",
      fields: [
        { path: "entryGate.regime_expected_move_trending", width: "narrow" },
        { path: "entryGate.regime_expected_move_neutral", width: "narrow" },
        { path: "entryGate.regime_expected_move_choppy", width: "narrow" },
      ],
    },
  ],
  sizingPlan: [
    {
      key: "sizing-kelly-compact",
      label: "Kelly",
      fields: [
        { path: "entryGate.kelly_fraction", width: "narrow" },
        { path: "entryGate.kelly_floor_pct", width: "narrow" },
        { path: "entryGate.kelly_ceiling_pct", width: "narrow" },
        { path: "entryGate.kelly_lookback_trades", width: "compact" },
      ],
    },
    {
      key: "sizing-exposure-compact",
      label: "Exposure",
      fields: [
        { path: "entryGate.max_position_pct", width: "narrow" },
        { path: "entryGate.max_exposure_pct", width: "narrow" },
        { path: "layers.max_layers_per_position", width: "compact" },
      ],
    },
    {
      key: "sizing-layers-gates-compact",
      label: "Layers + Gates",
      fields: [
        { path: "layers.l1_fraction", width: "narrow" },
        { path: "layers.l2_fraction", width: "narrow" },
        { path: "layers.l3_fraction", width: "narrow" },
        { path: "layers.edge_bump_multiplier", width: "narrow" },
        { path: "layers.edge_skip_threshold", width: "narrow" },
      ],
    },
  ],
};
const THREE_UP_TOP_ROW_LAYOUTS = {
  runSetup: [
    {
      key: "run-setup-profile",
      label: "Profile",
      fields: [
        { path: "runSettings.profileName", width: "medium" },
        { path: "runSettings.initialCapital", width: "compact" },
      ],
    },
    {
      key: "run-setup-window",
      label: "Window",
      fields: [
        { path: "runSettings.startDate", width: "compact" },
        { path: "runSettings.endDate", width: "compact" },
      ],
    },
  ],
  accountGuardrails: [
    {
      key: "guardrails-limits-top",
      label: "Limits",
      fields: [
        { path: "riskWarden.daily_loss_limit_pct", width: "narrow" },
        { path: "riskWarden.drawdown_throttle_pct", width: "narrow" },
        { path: "riskWarden.drawdown_halt_pct", width: "narrow" },
        { path: "riskWarden.max_concurrent_same_direction", width: "compact" },
      ],
    },
    {
      key: "guardrails-cooldown-top",
      label: "Cooldown",
      fields: [
        { path: "riskWarden.consecutive_loss_cooldown_count", width: "compact" },
        { path: "riskWarden.consecutive_loss_cooldown_minutes", width: "compact" },
        { path: "riskWarden.post_max_loss_cooldown_minutes", width: "compact" },
        { path: "riskWarden.persist_until_new_equity_high", width: "toggle" },
      ],
    },
  ],
  entryQualification: [
    {
      key: "entry-thresholds-top",
      label: "Thresholds",
      fields: [
        { path: "entryGate.edge_ratio_skip", width: "narrow" },
        { path: "entryGate.edge_ratio_half", width: "narrow" },
        { path: "entryGate.edge_ratio_weekend_shift", width: "narrow" },
      ],
    },
    {
      key: "entry-direction-top",
      label: "Direction",
      fields: [
        { path: "entryGate.mtf_confirm_upgrades_sizing", width: "toggle" },
        { path: "entryGate.opposite_direction_skip", width: "toggle" },
      ],
    },
  ],
};
const THREE_UP_SECOND_ROW_LAYOUTS = {
  dtePolicy: [
    {
      key: "dte-policy-overrides",
      label: "Overrides",
      fields: [
        { path: "entryGate.edge_ratio_0dte_shift", width: "narrow" },
        { path: "dteSelection.midday_trending_0dte_confluence", width: "narrow" },
        { path: "dteSelection.dte_floor", width: "compact" },
        { path: "dteSelection.dte_cap", width: "compact" },
      ],
    },
    {
      key: "dte-policy-base",
      label: "Base DTE",
      fields: [
        { path: "dteSelection.base_dte_2m", width: "compact" },
        { path: "dteSelection.base_dte_5m_morning", width: "compact" },
        { path: "dteSelection.base_dte_5m_midday", width: "compact" },
        { path: "dteSelection.base_dte_5m_power_hour", width: "compact" },
        { path: "dteSelection.base_dte_15m", width: "compact" },
      ],
    },
    {
      key: "dte-policy-regime",
      label: "Regime Adj",
      fields: [
        { path: "dteSelection.dte_adj_trending", width: "compact" },
        { path: "dteSelection.dte_adj_neutral", width: "compact" },
        { path: "dteSelection.dte_adj_choppy", width: "compact" },
        { path: "dteSelection.dte_adj_high_vol", width: "compact" },
      ],
    },
  ],
  volatilityRegime: [
    {
      key: "volatility-floors-core",
      label: "VIX Floors",
      fields: [
        { path: "entryGate.vix_confluence_floor_low", width: "narrow" },
        { path: "entryGate.vix_confluence_floor_mid", width: "narrow" },
        { path: "entryGate.vix_confluence_floor_high", width: "narrow" },
        { path: "entryGate.vix_confluence_floor_very_high", width: "narrow" },
      ],
    },
    {
      key: "volatility-bias-core",
      label: "Bias",
      fields: [
        { path: "entryGate.regime_expected_move_trending", width: "narrow" },
        { path: "entryGate.regime_expected_move_neutral", width: "narrow" },
        { path: "entryGate.regime_expected_move_choppy", width: "narrow" },
      ],
    },
    {
      key: "volatility-shifts-core",
      label: "Shifts + Skips",
      fields: [
        { path: "entryGate.vix_25_30_trending_edge_shift", width: "narrow" },
        { path: "entryGate.vix_30_plus_trending_edge_shift", width: "narrow" },
        { path: "entryGate.vix_25_30_choppy_skip", width: "toggle" },
        { path: "entryGate.vix_30_plus_choppy_skip", width: "toggle" },
      ],
    },
  ],
  sizingPlan: [
    {
      key: "sizing-kelly-core",
      label: "Kelly",
      fields: [
        { path: "entryGate.kelly_fraction", width: "narrow" },
        { path: "entryGate.kelly_floor_pct", width: "narrow" },
        { path: "entryGate.kelly_ceiling_pct", width: "narrow" },
        { path: "entryGate.kelly_lookback_trades", width: "compact" },
      ],
    },
    {
      key: "sizing-exposure-core",
      label: "Exposure",
      fields: [
        { path: "entryGate.max_position_pct", width: "narrow" },
        { path: "entryGate.max_exposure_pct", width: "narrow" },
        { path: "layers.max_layers_per_position", width: "compact" },
      ],
    },
    {
      key: "sizing-layers-core",
      label: "Layers",
      fields: [
        { path: "layers.l1_fraction", width: "narrow" },
        { path: "layers.l2_fraction", width: "narrow" },
        { path: "layers.l3_fraction", width: "narrow" },
        { path: "layers.edge_bump_multiplier", width: "narrow" },
        { path: "layers.edge_skip_threshold", width: "narrow" },
      ],
    },
  ],
};
const ALL_GROUPS_BAND_LAYOUTS = {
  ...THREE_UP_TOP_ROW_LAYOUTS,
  ...THREE_UP_SECOND_ROW_LAYOUTS,
  exitLogic: [
    {
      key: "exit-shared",
      fields: [
        { path: "exitGovernor.trail_lock_ratio_initial", width: "narrow" },
        { path: "exitGovernor.trail_lock_ratio_max", width: "narrow" },
        { path: "exitGovernor.tod_multiplier_open", width: "narrow" },
        { path: "exitGovernor.tod_multiplier_midmorning", width: "narrow" },
        { path: "exitGovernor.tod_multiplier_midday", width: "narrow" },
        { path: "exitGovernor.tod_multiplier_power_hour", width: "narrow" },
        { path: "exitGovernor.regime_multiplier_trending", width: "narrow" },
        { path: "exitGovernor.regime_multiplier_neutral", width: "narrow" },
        { path: "exitGovernor.regime_multiplier_choppy", width: "narrow" },
      ],
    },
  ],
};
const DTE_SHARED_BAND_LAYOUTS = [
  {
    key: "dte-shared-trail-locks",
    label: "Trail",
    fields: [
      { path: "exitGovernor.trail_lock_ratio_initial", width: "narrow" },
      { path: "exitGovernor.trail_lock_ratio_max", width: "narrow" },
    ],
  },
  {
    key: "dte-shared-timing-regime",
    label: "Timing + Regime",
    fields: [
      { path: "exitGovernor.tod_multiplier_open", width: "narrow" },
      { path: "exitGovernor.tod_multiplier_midmorning", width: "narrow" },
      { path: "exitGovernor.tod_multiplier_midday", width: "narrow" },
      { path: "exitGovernor.tod_multiplier_power_hour", width: "narrow" },
      { path: "exitGovernor.regime_multiplier_trending", width: "narrow" },
      { path: "exitGovernor.regime_multiplier_neutral", width: "narrow" },
      { path: "exitGovernor.regime_multiplier_choppy", width: "narrow" },
    ],
  },
];
const DTE_PROFILE_ORDER = [
  "zeroDteProfile",
  "oneDteProfile",
  "twoToThreeDteProfile",
  "fivePlusDteProfile",
];
const EXTENDED_ALL_GROUPS_BAND_LAYOUTS = {
  ...ALL_GROUPS_BAND_LAYOUTS,
  exitShared: DTE_SHARED_BAND_LAYOUTS,
};
const DTE_PROFILE_BAND_LAYOUTS = {
  zeroDteProfile: [
    {
      key: "zero-trail",
      label: "Trail / Profit",
      fields: [
        { path: "exitGovernor.trail_activation_atr_0dte", width: "narrow" },
        { path: "exitGovernor.trail_option_pnl_floor_0dte", width: "narrow" },
      ],
    },
    {
      key: "zero-tightening",
      label: "Tightening",
      fields: [
        { path: "exitGovernor.theta_tighten_0dte_30min", width: "narrow" },
        { path: "exitGovernor.theta_tighten_0dte_60min", width: "narrow" },
        { path: "exitGovernor.theta_tighten_0dte_90min", width: "narrow" },
      ],
    },
    {
      key: "zero-cliff-loss",
      label: "Cliff / Loss",
      fields: [
        { path: "exitGovernor.time_cliff_0dte_minutes", width: "compact" },
        { path: "exitGovernor.time_cliff_profitable_override", width: "toggle" },
        { path: "exitGovernor.max_loss_0dte_pct", width: "narrow" },
      ],
    },
  ],
  oneDteProfile: [
    {
      key: "one-trail",
      label: "Trail / Profit",
      fields: [
        { path: "exitGovernor.trail_activation_atr_1dte", width: "narrow" },
        { path: "exitGovernor.trail_option_pnl_floor_1dte", width: "narrow" },
      ],
    },
    {
      key: "one-tightening",
      label: "Tightening",
      fields: [
        { path: "exitGovernor.theta_tighten_1to3_60min", width: "narrow" },
        { path: "exitGovernor.theta_tighten_1to3_120min", width: "narrow" },
      ],
    },
    {
      key: "one-cliff-loss",
      label: "Cliff / Loss",
      fields: [
        { path: "exitGovernor.time_cliff_1to3dte_eod", width: "toggle" },
        { path: "exitGovernor.max_loss_1to3dte_pct", width: "narrow" },
      ],
    },
  ],
  twoToThreeDteProfile: [
    {
      key: "two-three-trail",
      label: "Trail / Profit",
      fields: [
        { path: "exitGovernor.trail_activation_atr_2to3dte", width: "narrow" },
        { path: "exitGovernor.trail_option_pnl_floor_2to3dte", width: "narrow" },
      ],
    },
    {
      key: "two-three-tightening",
      label: "Tightening",
      fields: [
        { path: "exitGovernor.theta_tighten_1to3_60min", width: "narrow" },
        { path: "exitGovernor.theta_tighten_1to3_120min", width: "narrow" },
      ],
    },
    {
      key: "two-three-cliff-loss",
      label: "Cliff / Loss",
      fields: [
        { path: "exitGovernor.time_cliff_1to3dte_eod", width: "toggle" },
        { path: "exitGovernor.max_loss_1to3dte_pct", width: "narrow" },
      ],
    },
  ],
  fivePlusDteProfile: [
    {
      key: "five-plus-cliff-loss",
      label: "Cliff / Loss",
      fields: [
        { path: "exitGovernor.time_cliff_5plus_sessions", width: "compact" },
        { path: "exitGovernor.max_loss_5plus_pct", width: "narrow" },
      ],
    },
  ],
};

function getTonePalette(tone = "neutral") {
  return TONE_PALETTES[tone] || TONE_PALETTES.neutral;
}

function getPackedColumnCount(viewportWidth = 1440) {
  if (viewportWidth < 900) {
    return 1;
  }
  if (viewportWidth < 1320) {
    return 2;
  }
  if (viewportWidth < 1760) {
    return 3;
  }
  return 4;
}

function getGroupColumnSpan(group, columnCount) {
  if (columnCount <= 1) {
    return 1;
  }
  if (group?.key === "exitLogic") {
    return columnCount;
  }
  if (group?.key === "dtePolicy") {
    return Math.min(2, columnCount);
  }
  if (group?.layout === "pinned_row") {
    if (columnCount >= 4) {
      return 3;
    }
    return Math.min(2, columnCount);
  }
  return 1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function useViewportWidth() {
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === "undefined" ? 1440 : window.innerWidth
  ));

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return viewportWidth;
}

function PackedLayoutItem({
  columnSpan = 1,
  rowHeight = PACKED_ROW_HEIGHT,
  gap = PACKED_GRID_GAP,
  children,
}) {
  const contentRef = useRef(null);
  const [rowSpan, setRowSpan] = useState(1);

  useEffect(() => {
    if (!contentRef.current) {
      return undefined;
    }

    const node = contentRef.current;
    let frameId = null;
    const measure = () => {
      frameId = null;
      const height = node.getBoundingClientRect().height;
      if (!height) {
        return;
      }
      const nextRowSpan = Math.max(1, Math.ceil((height + gap) / (rowHeight + gap)));
      setRowSpan((current) => (current === nextRowSpan ? current : nextRowSpan));
    };
    const queueMeasure = () => {
      if (typeof window === "undefined") {
        measure();
        return;
      }
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(measure);
    };

    queueMeasure();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (typeof window !== "undefined" && frameId != null) {
          window.cancelAnimationFrame(frameId);
        }
      };
    }

    const observer = new ResizeObserver(() => {
      queueMeasure();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (typeof window !== "undefined" && frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [gap, rowHeight]);

  return (
    <div
      style={{
        minWidth: 0,
        gridColumn: `span ${columnSpan}`,
        gridRowEnd: `span ${rowSpan}`,
      }}
    >
      <div ref={contentRef} style={{ minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

function getValueAtPath(state, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current == null ? current : current[key]), state);
}

function collectPanelFieldRefs(panel = null) {
  if (!panel) {
    return [];
  }
  const directFields = Array.isArray(panel.fields) ? panel.fields : [];
  const nestedFields = Array.isArray(panel.sections)
    ? panel.sections.flatMap((section) => Array.isArray(section.fields) ? section.fields : [])
    : [];
  return [...directFields, ...nestedFields];
}

function collectVisualFieldRefs(groups = []) {
  return groups.flatMap((group) => (group.panels || []).flatMap((panel) => collectPanelFieldRefs(panel)));
}

function collectUniqueVisualFieldPaths(groups = []) {
  return Array.from(new Set(
    collectVisualFieldRefs(groups)
      .map((row) => row?.field?.path)
      .filter(Boolean),
  ));
}

function collectUniquePanelFieldPaths(panel = null) {
  return Array.from(new Set(
    collectPanelFieldRefs(panel)
      .map((row) => row?.field?.path)
      .filter(Boolean),
  ));
}

function countChangedFields(state) {
  return collectUniqueVisualFieldPaths(BACKTEST_V2_STAGE_VISUAL_GROUPS).reduce((count, path) => (
    Object.is(
      getValueAtPath(state, path),
      getValueAtPath(BACKTEST_V2_STAGE_DEFAULTS, path),
    )
      ? count
      : count + 1
  ), 0);
}

function formatValuePreview(value) {
  if (typeof value === "boolean") {
    return value ? "On" : "Off";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
  }
  return String(value || "Unset");
}

function formatRangeValue(value, range = {}, { compact = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value ?? "");
  }
  switch (range.format) {
    case "currency_compact":
      if (compact && Math.abs(value) >= 1000) {
        const thousands = value / 1000;
        return `$${Number.isInteger(thousands) ? thousands : thousands.toFixed(1).replace(/\.0$/, "")}k`;
      }
      return `$${Math.round(value).toLocaleString()}`;
    case "ratio":
      return `${value.toFixed(2).replace(/\.?0+$/, "")}x`;
    case "score":
      return value.toFixed(2).replace(/\.?0+$/, "");
    case "percent_decimal":
      return `${(value * 100).toFixed(value * 100 >= 10 ? 0 : 1).replace(/\.0$/, "")}%`;
    case "percent_points":
      return `${value.toFixed(Math.abs(value % 1) > 0 ? 1 : 0).replace(/\.0$/, "")}%`;
    case "minutes":
      return compact ? `${Math.round(value)}m` : `${Math.round(value)} min`;
    case "sessions":
      return compact ? `${Math.round(value)}s` : `${Math.round(value)} sess`;
    case "trades":
      return compact ? `${Math.round(value)}t` : `${Math.round(value)} trades`;
    case "signed_integer":
      return `${value > 0 ? "+" : ""}${Math.round(value)}`;
    case "integer":
      return String(Math.round(value));
    default:
      return formatValuePreview(value);
  }
}

function snapRangeValue(value, range = {}) {
  const min = Number(range.min);
  const max = Number(range.max);
  const step = Number(range.step);
  if (!Number.isFinite(value)) {
    return value;
  }
  const bounded = Number.isFinite(min) && Number.isFinite(max)
    ? clamp(value, min, max)
    : value;
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(min)) {
    return +bounded.toFixed(4);
  }
  const stepped = min + Math.round((bounded - min) / step) * step;
  const precision = Math.max(0, (String(step).split(".")[1] || "").length);
  return +(clamp(stepped, min, max).toFixed(Math.min(precision + 2, 6)));
}

function normalizeRangePosition(value, range = {}) {
  const min = Number(range.min);
  const max = Number(range.max);
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 0;
  }
  const clamped = Math.min(max, Math.max(min, value));
  return (clamped - min) / (max - min);
}

function isFieldChanged(state, path) {
  return !Object.is(
    getValueAtPath(state, path),
    getValueAtPath(BACKTEST_V2_STAGE_DEFAULTS, path),
  );
}

function getPanelChangedCount(panel, state) {
  return collectUniquePanelFieldPaths(panel).reduce((count, path) => (
    isFieldChanged(state, path) ? count + 1 : count
  ), 0);
}

function resolveFieldLayout(field = {}) {
  if (typeof field.layout === "string" && field.layout.trim()) {
    return field.layout;
  }
  if (field.type === "text") {
    return "wide";
  }
  if (field.type === "date" || field.type === "boolean") {
    return "normal";
  }
  return String(field.label || "").trim().length > 18 ? "normal" : "compact";
}

function createSectionKey(prefix, title, index) {
  const normalized = String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${normalized || `section-${index}`}`;
}

function getPanelFieldSections(panel = {}) {
  if (Array.isArray(panel.sections) && panel.sections.length > 0) {
    return panel.sections
      .map((section, index) => ({
        key: section.key || createSectionKey(panel.key || "panel", section.title, index),
        title: section.title || "",
        subtitle: section.subtitle || "",
        layout: section.layout || "",
        columns: section.columns || null,
        fields: Array.isArray(section.fields) ? section.fields : [],
      }))
      .filter((section) => section.fields.length > 0);
  }

  const fields = Array.isArray(panel.fields) ? panel.fields : [];
  if (!fields.some((row) => row?.section)) {
    return [{
      key: `${panel.key || "panel"}-default`,
      title: "",
      subtitle: "",
      layout: "",
      columns: null,
      fields,
    }];
  }

  const groupedSections = [];
  fields.forEach((row, index) => {
    const title = typeof row?.section === "string"
      ? row.section
      : row?.section?.title || "";
    const subtitle = typeof row?.section === "object" && row.section
      ? row.section.subtitle || ""
      : "";
    const key = typeof row?.section === "object" && row.section?.key
      ? row.section.key
      : createSectionKey(panel.key || "panel", title, index);
    const existing = groupedSections.find((section) => section.key === key);
    if (existing) {
      existing.fields.push(row);
      return;
    }
    groupedSections.push({
      key,
      title,
      subtitle,
      layout: typeof row?.section === "object" && row.section ? row.section.layout || "" : "",
      columns: typeof row?.section === "object" && row.section ? row.section.columns || null : null,
      fields: [row],
    });
  });
  return groupedSections;
}

function buildPanelFieldLookup(panel = {}) {
  const lookup = new Map();
  getPanelFieldSections(panel).forEach((section) => {
    section.fields.forEach((row) => {
      const path = row?.field?.path;
      if (!path || lookup.has(path)) {
        return;
      }
      lookup.set(path, {
        row,
        panel,
        section,
      });
    });
  });
  return lookup;
}

function buildGroupFieldLookup(group = {}) {
  const lookup = new Map();
  (group.panels || []).forEach((panel) => {
    buildPanelFieldLookup(panel).forEach((entry, path) => {
      if (!lookup.has(path)) {
        lookup.set(path, entry);
      }
    });
  });
  return lookup;
}

function materializeBandEntries(lookup, descriptors = []) {
  return descriptors
    .map((descriptor) => {
      const entries = (descriptor.fields || [])
        .map((item) => {
          const resolved = lookup.get(item.path);
          if (!resolved) {
            return null;
          }
          return {
            ...resolved,
            width: item.width || null,
          };
        })
        .filter(Boolean);

      if (!entries.length) {
        return null;
      }

      return {
        key: descriptor.key,
        label: descriptor.label || "",
        entries,
        stackFields: descriptor.stackFields === true,
      };
    })
    .filter(Boolean);
}

function buildFallbackBandsFromGroup(group = {}) {
  return (group.panels || []).flatMap((panel) => (
    getPanelFieldSections(panel)
      .map((section, index) => {
        const entries = section.fields.map((row) => ({
          row,
          panel,
          section,
          width: null,
        }));
        if (!entries.length) {
          return null;
        }
        return {
          key: `${panel.key}-${section.key || index}`,
          label: section.title || panel.title || "",
          entries,
        };
      })
      .filter(Boolean)
  ));
}

function resolveGroupBands(group = {}, layoutMap = GROUP_BAND_LAYOUTS) {
  const lookup = buildGroupFieldLookup(group);
  const bands = materializeBandEntries(lookup, layoutMap[group.key] || []);
  return bands.length ? bands : buildFallbackBandsFromGroup(group);
}

function resolveBandFieldWidthToken(entry = {}) {
  if (entry.width && BAND_FIELD_WIDTHS[entry.width]) {
    return entry.width;
  }
  const field = entry.row?.field || {};
  if (field.type === "boolean") {
    return "toggle";
  }
  if (field.type === "date") {
    return "medium";
  }
  if (field.type === "text") {
    return "wide";
  }
  return String(field.label || "").length > 18 ? "compact" : "narrow";
}

function resolveBandFieldWidth(entry = {}) {
  return BAND_FIELD_WIDTHS[resolveBandFieldWidthToken(entry)] || BAND_FIELD_WIDTHS.medium;
}

function resolveBandFieldColumnSpan(entry = {}) {
  switch (resolveBandFieldWidthToken(entry)) {
    case "xwide":
    case "wide":
      return 2;
    default:
      return 1;
  }
}

function getFixedBandTrackCount(band = {}) {
  const totalSpan = (band.entries || []).reduce((sum, entry) => sum + resolveBandFieldColumnSpan(entry), 0);
  return clamp(totalSpan || 1, 1, BAND_GRID_COLUMNS);
}

function formatProfileColumnTitle(title = "") {
  return String(title || "").replace(" / Longer", "");
}

function SummaryChip({ label, value, tone = "default" }) {
  const palette = {
    default: { background: "#ffffff", border: BORDER_STRONG, color: "#1e293b", label: SUBTLE },
    accent: { background: "#f3f9ff", border: "#cfe3f7", color: "#1d4ed8", label: "#7ea3c2" },
    warning: { background: "#fff8ef", border: "#f6cf9c", color: WARNING, label: "#c28b37" },
    success: { background: "#f2fdf7", border: "#b7ead3", color: SUCCESS, label: "#6caa8d" },
  }[tone] || { background: "#ffffff", border: BORDER_STRONG, color: "#1e293b", label: SUBTLE };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        minHeight: 20,
        padding: "0 7px",
        borderRadius: 999,
        background: palette.background,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        fontSize: 9.5,
        fontFamily: F,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: palette.label }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function SectionHeader({ title, subtitle, changedCount, onReset, tone = "neutral" }) {
  const palette = getTonePalette(tone);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 6,
        paddingBottom: 4,
        borderBottom: `1px solid ${BORDER_SUBTLE}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.75, fontFamily: FS, fontWeight: 700, color: "#0f172a", lineHeight: 1.15 }}>{title}</div>
        <div style={{ marginTop: 1, fontSize: 9.25, fontFamily: FS, color: MUTED, lineHeight: 1.25 }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {changedCount > 0 ? (
          <span
            style={{
              flexShrink: 0,
              color: palette.accent,
              fontSize: 9,
              fontFamily: F,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {changedCount} edited
          </span>
        ) : null}
        <button
          type="button"
          onClick={onReset}
          style={{
            flexShrink: 0,
            minHeight: 20,
            padding: "0 7px",
            borderRadius: 999,
            border: `1px solid ${changedCount > 0 ? palette.border : BORDER_STRONG}`,
            background: "#ffffff",
            color: changedCount > 0 ? palette.accent : MUTED,
            fontSize: 9,
            fontFamily: FS,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {changedCount > 0 ? "Reset group" : "Reset"}
        </button>
      </div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder = "", style = null }) {
  return (
    <input
      type="text"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={{
        width: "100%",
        minWidth: 0,
        height: 24,
        padding: "0 6px",
        borderRadius: 7,
        border: `1px solid ${BORDER_SUBTLE}`,
        background: "#ffffff",
        fontSize: 10.5,
        fontFamily: FS,
        color: "#0f172a",
        outline: "none",
        boxSizing: "border-box",
        ...(style || {}),
      }}
    />
  );
}

function SelectInput({ value, onChange, options = [], style = null }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{
        width: "100%",
        minWidth: 0,
        height: 24,
        padding: "0 6px",
        borderRadius: 7,
        border: `1px solid ${BORDER_SUBTLE}`,
        background: "#ffffff",
        fontSize: 10.5,
        fontFamily: FS,
        color: "#0f172a",
        outline: "none",
        boxSizing: "border-box",
        ...(style || {}),
      }}
    >
      {options.map((option) => {
        const optionValue = typeof option === "string" ? option : option.value;
        const optionLabel = typeof option === "string" ? option : option.label;
        return (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        );
      })}
    </select>
  );
}

function NumberInput({ value, onChange, min = null, max = null, step = 0.01, style = null }) {
  return (
    <DraftNumberInput
      value={value}
      onCommit={onChange}
      min={min == null ? undefined : min}
      max={max == null ? undefined : max}
      step={step}
      style={{
        width: "100%",
        minWidth: 0,
        height: 24,
        padding: "0 6px",
        borderRadius: 7,
        border: `1px solid ${BORDER_SUBTLE}`,
        background: "#ffffff",
        fontSize: 10.5,
        fontFamily: F,
        color: "#0f172a",
        outline: "none",
        boxSizing: "border-box",
        ...(style || {}),
      }}
    />
  );
}

function DateInput({ value, onChange, style = null }) {
  return (
    <input
      type="date"
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      style={{
        width: "100%",
        minWidth: 0,
        height: 24,
        padding: "0 6px",
        borderRadius: 7,
        border: `1px solid ${BORDER_SUBTLE}`,
        background: "#ffffff",
        fontSize: 10.5,
        fontFamily: FS,
        color: "#0f172a",
        outline: "none",
        boxSizing: "border-box",
        ...(style || {}),
      }}
    />
  );
}

function BooleanInput({ value, onChange, tone = "neutral" }) {
  const palette = getTonePalette(tone);
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[
        [true, "On"],
        [false, "Off"],
      ].map(([choiceValue, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(choiceValue)}
          style={{
            flex: 1,
            minHeight: 24,
            borderRadius: 7,
            border: `1px solid ${value === choiceValue ? palette.border : BORDER_STRONG}`,
            background: value === choiceValue ? palette.surface : "#ffffff",
            color: value === choiceValue ? palette.accent : MUTED,
            fontSize: 9.5,
            fontFamily: FS,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RangeTrack({ value, range, tone = "neutral" }) {
  const palette = getTonePalette(tone);
  if (!range || typeof value !== "number") {
    return null;
  }
  const isDiscrete = Boolean(range.discrete);
  if (isDiscrete) {
    const step = Number(range.step) || 1;
    const count = Math.max(2, Math.round((Number(range.max) - Number(range.min)) / step) + 1);
    const activeIndex = Math.round((Math.max(Number(range.min), Math.min(Number(range.max), value)) - Number(range.min)) / step);
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap: 3 }}>
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            style={{
              height: 6,
              borderRadius: 999,
              background: index <= activeIndex ? palette.accent : "#e2e8f0",
              opacity: index === activeIndex ? 1 : index < activeIndex ? 0.75 : 1,
            }}
          />
        ))}
      </div>
    );
  }

  const position = normalizeRangePosition(value, range);
  return (
    <div
      style={{
        position: "relative",
        height: 6,
        borderRadius: 999,
        background: "#e2e8f0",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.max(4, position * 100)}%`,
          height: "100%",
          borderRadius: 999,
          background: `linear-gradient(90deg, ${palette.soft}, ${palette.accent})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${position * 100}%`,
          width: 9,
          height: 9,
          borderRadius: 999,
          border: "2px solid #ffffff",
          background: palette.accent,
          boxShadow: "0 0 0 1px rgba(15,23,42,0.08)",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}

function RangeCaption({ range }) {
  if (!range) {
    return null;
  }
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 8.5, fontFamily: F, color: SUBTLE }}>
      <span>{formatRangeValue(range.min, range, { compact: true })}</span>
      <span>{formatRangeValue(range.max, range, { compact: true })}</span>
    </div>
  );
}

function ConfigField({
  field,
  value,
  changed,
  onChange,
  range = null,
  tone = "neutral",
  showRangeTrack = true,
  showRangeCaption = true,
}) {
  const layout = resolveFieldLayout(field);
  const palette = getTonePalette(tone);
  const displayValue = range ? formatRangeValue(value, range) : formatValuePreview(value);
  const showDisplayValue = field.type !== "boolean" && (
    Boolean(range)
    || (field.type !== "text" && field.type !== "date" && field.type !== "select")
  );
  let input = null;

  if (field.type === "text") {
    input = <TextInput value={value} onChange={onChange} placeholder={field.placeholder} />;
  } else if (field.type === "select") {
    input = <SelectInput value={value} onChange={onChange} options={field.options} />;
  } else if (field.type === "date") {
    input = <DateInput value={value} onChange={onChange} />;
  } else if (field.type === "boolean") {
    input = <BooleanInput value={Boolean(value)} onChange={onChange} tone={tone} />;
  } else {
    input = (
      <NumberInput
        value={value}
        onChange={onChange}
        step={range?.step ?? field.step}
        min={range?.min ?? field.min}
        max={range?.max ?? field.max}
      />
    );
  }

  return (
    <div
      style={{
        gridColumn: FIELD_LAYOUT_TO_SPAN[layout] || FIELD_LAYOUT_TO_SPAN.compact,
        display: "grid",
        gap: 3,
        padding: changed ? "4px 5px 6px" : "4px 0 3px",
        borderRadius: 8,
        border: `1px solid ${changed ? CHANGED_BORDER : "transparent"}`,
        background: changed ? CHANGED_SURFACE : "transparent",
        alignContent: "start",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: showDisplayValue ? "space-between" : "flex-start", gap: 6 }}>
        <span style={{ minWidth: 0, fontSize: 9.5, fontFamily: FS, fontWeight: 700, color: "#1e293b", lineHeight: 1.2 }}>{field.label}</span>
        {showDisplayValue ? (
          <span
            style={{
              flexShrink: 0,
              fontSize: 8.75,
              fontFamily: F,
              fontWeight: 700,
              color: changed ? WARNING : palette.accent,
              whiteSpace: "nowrap",
            }}
          >
            {displayValue}
          </span>
        ) : null}
      </div>
      {input}
      {field.type !== "boolean" && range && showRangeTrack ? (
        <>
          <RangeTrack value={Number(value)} range={range} tone={tone} />
          {showRangeCaption ? <RangeCaption range={range} /> : null}
        </>
      ) : null}
    </div>
  );
}

function formatRangeSummary(range = null) {
  if (!range) {
    return "";
  }
  return `${formatRangeValue(range.min, range, { compact: true })} to ${formatRangeValue(range.max, range, { compact: true })}`;
}

function getCompactEditorWidth(field = {}, range = null) {
  if (field.type === "boolean") {
    return 72;
  }
  if (field.type === "date") {
    return 108;
  }
  if (field.type === "text") {
    return field.path === "runSettings.profileName" ? 122 : 98;
  }
  if (field.type === "select") {
    return 96;
  }

  switch (range?.format) {
    case "currency_compact":
      return 92;
    case "minutes":
    case "sessions":
    case "trades":
    case "integer":
    case "signed_integer":
      return 56;
    case "ratio":
    case "score":
    case "percent_decimal":
    case "percent_points":
      return 64;
    default:
      return 62;
  }
}

function getCompactFieldWidth(label, field = {}, range = null, { narrow = false } = {}) {
  const editorWidth = getCompactEditorWidth(field, range);
  const estimatedLabelWidth = clamp(
    String(label || field.label || "").trim().length * (narrow ? 4.15 : 4.45),
    52,
    narrow ? 84 : 100,
  );
  return Math.max(editorWidth, Math.round(estimatedLabelWidth));
}

function estimateInlineMarkerWidth(title = "", { compact = false } = {}) {
  return clamp(
    String(title || "").trim().length * (compact ? 4.3 : 4.7),
    compact ? 44 : 52,
    compact ? 96 : 110,
  );
}

function getPanelBlockMetrics(panel, viewportWidth = 1440) {
  const sections = getPanelFieldSections(panel);
  const fieldCount = collectPanelFieldRefs(panel).length;
  const compactRows = panel?.type === "compare" || panel?.type === "rail_compare" || fieldCount >= 4;
  const rowGap = compactRows ? 6 : 7;
  const widestSection = sections.reduce((maxWidth, section, index) => {
    const fieldsWidth = (section.fields || []).reduce((sum, row) => {
      const effectiveField = {
        ...row.field,
        label: row.label || row.field.label,
      };
      return sum + getCompactFieldWidth(
        effectiveField.label,
        effectiveField,
        row.range || panel.range || null,
        { narrow: compactRows },
      );
    }, 0);
    const fieldGapWidth = Math.max(0, ((section.fields || []).length - 1) * rowGap);
    const markerWidth = estimateInlineMarkerWidth(section.title || panel.title, { compact: compactRows });
    const rangeWidth = panel.range && index === 0 ? 62 : 0;
    return Math.max(maxWidth, markerWidth + rangeWidth + fieldsWidth + fieldGapWidth + 14);
  }, 0);

  const maxBasis = panel?.type === "rail_compare"
    ? (viewportWidth >= 1440 ? 500 : 448)
    : viewportWidth >= 1440 ? 420 : 368;
  const basis = clamp(Math.round(widestSection || 220), 152, maxBasis);
  const minWidth = clamp(
    Math.round(basis * (panel?.type === "rail_compare" ? 0.72 : 0.56)),
    144,
    panel?.type === "rail_compare" ? 288 : 256,
  );

  return { basis, minWidth };
}

function getDteExitColumnCount(viewportWidth = 1440) {
  if (viewportWidth < 900) {
    return 1;
  }
  if (viewportWidth < 1320) {
    return 2;
  }
  return 4;
}

function getDteSectionColumnCount(section, viewportWidth = 1440) {
  const count = Math.max(1, section?.fields?.length || 1);
  const title = String(section?.title || "").toLowerCase();
  if (count <= 1) {
    return 1;
  }
  if (title.includes("tod")) {
    return viewportWidth >= 1440 ? 4 : 2;
  }
  if (title.includes("regime")) {
    return viewportWidth >= 1400 ? 3 : 2;
  }
  if (title.includes("tightening") || title.includes("trail")) {
    return count >= 3 && viewportWidth >= 1400 ? 3 : 2;
  }
  return Math.min(count, 2);
}

function CompactFieldEditor({ field, value, onChange, tone = "neutral", range = null, changed = false }) {
  const inputStyle = {
    height: 20,
    padding: "0 5px",
    borderRadius: 6,
    fontSize: 10.5,
    ...(changed ? {
      border: `1px solid ${CHANGED_BORDER}`,
      background: CHANGED_SURFACE,
    } : {}),
  };

  if (field.type === "text") {
    return <TextInput value={value} onChange={onChange} placeholder={field.placeholder} style={inputStyle} />;
  }
  if (field.type === "select") {
    return <SelectInput value={value} onChange={onChange} options={field.options} style={inputStyle} />;
  }
  if (field.type === "date") {
    return <DateInput value={value} onChange={onChange} style={inputStyle} />;
  }
  if (field.type === "boolean") {
    return (
      <div style={{ borderRadius: 5, boxShadow: changed ? `0 0 0 1px ${CHANGED_BORDER}` : "none" }}>
        <BooleanInput value={Boolean(value)} onChange={onChange} tone={tone} />
      </div>
    );
  }
  return (
    <NumberInput
      value={value}
      onChange={onChange}
      step={range?.step ?? field.step}
      min={range?.min ?? field.min}
      max={range?.max ?? field.max}
      style={inputStyle}
    />
  );
}

function BandedField({
  entry,
  state,
  onFieldChange,
  tone = "neutral",
  compact = false,
  stacked = false,
  stretch = false,
}) {
  const effectiveField = {
    ...entry.row.field,
    label: entry.row.label || entry.row.field.label,
    layout: entry.row.layout || entry.row.field.layout,
  };
  const range = entry.row.range || entry.panel.range || null;
  const value = getValueAtPath(state, entry.row.field.path);
  const changed = isFieldChanged(state, entry.row.field.path);
  const columnSpan = resolveBandFieldColumnSpan(entry);
  const isToggle = effectiveField.type === "boolean";
  const fieldMinWidth = resolveBandFieldWidth(entry);

  return (
    <div
      style={{
        gridColumn: stacked ? "1 / -1" : `span ${columnSpan}`,
        minWidth: stacked || stretch ? 0 : fieldMinWidth,
        maxWidth: stacked || stretch ? "none" : (isToggle ? 78 : 108),
        width: stretch ? "100%" : undefined,
        display: "grid",
        gap: compact ? 2 : 2.5,
        alignContent: "start",
        justifySelf: stretch ? "stretch" : "start",
      }}
    >
      <div
        style={{
          minWidth: 0,
          minHeight: compact ? 14 : 15,
          display: "flex",
          alignItems: "flex-end",
          fontSize: compact ? 8.5 : 9.5,
          fontFamily: FS,
          fontWeight: 700,
          color: changed ? WARNING : "#253245",
          lineHeight: 1.08,
          letterSpacing: compact ? "0.01em" : "0",
        }}
      >
        {effectiveField.label}
      </div>
      <div style={{ width: "100%", minWidth: 0 }}>
        <CompactFieldEditor
          field={effectiveField}
          value={value}
          onChange={(nextValue) => onFieldChange(entry.row.field.path, nextValue)}
          tone={tone}
          range={range}
          changed={changed}
        />
      </div>
    </div>
  );
}

function GroupBandRow({
  band,
  state,
  onFieldChange,
  tone = "neutral",
  showDivider = false,
  labelMode = "side",
  compact = false,
  fixedTracks = true,
}) {
  const hasLabel = Boolean(band.label);
  const stacked = labelMode === "top";
  const stackFields = band.stackFields === true;
  const fixedTrackCount = !stackFields && fixedTracks ? getFixedBandTrackCount(band) : 0;
  const content = (
    <div
      style={{
        minWidth: 0,
        display: stackFields || fixedTracks ? "grid" : "flex",
        gridTemplateColumns: stackFields
          ? "1fr"
          : fixedTracks
            ? `repeat(${fixedTrackCount}, minmax(0, 1fr))`
            : undefined,
        gridAutoFlow: stackFields || fixedTracks ? "row dense" : undefined,
        flexWrap: stackFields || fixedTracks ? undefined : "wrap",
        gap: stackFields
          ? (compact ? 4 : 5)
          : fixedTracks
            ? (compact ? "2px 6px" : "3px 7px")
            : (compact ? `${BAND_GRID_GAP - 1}px ${BAND_GRID_GAP}px` : `${BAND_GRID_GAP}px ${BAND_GRID_GAP + 1}px`),
        justifyContent: stackFields || fixedTracks ? undefined : "start",
        alignItems: "start",
      }}
    >
      {band.entries.map((entry) => (
        <BandedField
          key={entry.row.field.path}
          entry={entry}
          state={state}
          onFieldChange={onFieldChange}
          tone={tone}
          compact={compact}
          stacked={stackFields}
          stretch={fixedTracks && !stackFields}
        />
      ))}
    </div>
  );

  return (
    <div
      style={{
        minWidth: 0,
        paddingTop: showDivider ? (compact ? 1 : 3) : 0,
        borderTop: showDivider && !(hasLabel && stacked) ? `1px solid ${BORDER_SUBTLE}` : "none",
      }}
    >
      {hasLabel ? (
        stacked ? (
          <div style={{ display: "grid", gap: compact ? 2 : 4, minWidth: 0 }}>
            <div
              style={{
                fontSize: 8.5,
                fontFamily: FS,
                fontWeight: 700,
                color: "#52657a",
                lineHeight: 1.08,
              }}
            >
              {band.label}
            </div>
            {content}
          </div>
        ) : (
          <div
            style={{
              minWidth: 0,
              display: "grid",
              gridTemplateColumns: `minmax(${compact ? Math.round(BAND_LABEL_TRACK * 0.82) : BAND_LABEL_TRACK}px, auto) minmax(0, 1fr)`,
              gap: compact ? "2px 6px" : "3px 7px",
              alignItems: "start",
            }}
          >
            <div
              style={{
                paddingTop: 1,
                fontSize: 8.5,
                fontFamily: FS,
                fontWeight: 700,
                color: "#52657a",
                lineHeight: 1.08,
              }}
            >
              {band.label}
            </div>
            {content}
          </div>
        )
      ) : content}
    </div>
  );
}

function StandardGroupBands({
  group,
  state,
  onFieldChange,
  viewportWidth = 1440,
  layoutMap = GROUP_BAND_LAYOUTS,
  compact = false,
  labelModeOverride = null,
  fixedTracks = true,
}) {
  const resolvedBands = resolveGroupBands(group, layoutMap);
  const labelMode = labelModeOverride || (viewportWidth < 1100 ? "top" : "side");

  return (
    <div style={{ minWidth: 0, display: "grid", gap: 0 }}>
      {resolvedBands.map((band, index) => (
        <GroupBandRow
          key={band.key}
          band={band}
          state={state}
          onFieldChange={onFieldChange}
          tone={group.tone}
          showDivider={index > 0}
          labelMode={labelMode}
          compact={compact}
          fixedTracks={fixedTracks}
        />
      ))}
    </div>
  );
}

function DteProfileColumn({
  panel,
  state,
  onFieldChange,
  tone = "neutral",
}) {
  const lookup = buildPanelFieldLookup(panel);
  const bands = materializeBandEntries(lookup, DTE_PROFILE_BAND_LAYOUTS[panel.key] || []);
  const resolvedBands = bands.length
    ? bands
    : getPanelFieldSections(panel).map((section, index) => ({
      key: `${panel.key}-${section.key || index}`,
      label: section.title || "",
      entries: section.fields.map((row) => ({
        row,
        panel,
        section,
        width: null,
      })),
    }));

  return (
    <div style={{ minWidth: 0, display: "grid", gap: 3, alignContent: "start" }}>
      <div
        style={{
          minWidth: 0,
          fontSize: 11,
          fontFamily: FS,
          fontWeight: 700,
          color: "#0f172a",
          lineHeight: 1.05,
        }}
      >
        {formatProfileColumnTitle(panel.title)}
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: 0 }}>
        {resolvedBands.map((band, index) => (
          <GroupBandRow
            key={band.key}
            band={band}
            state={state}
            onFieldChange={onFieldChange}
            tone={tone}
            showDivider={index > 0}
            labelMode="top"
            compact
            fixedTracks={false}
          />
        ))}
      </div>
    </div>
  );
}

function DteExitProfilesMatrix({
  group,
  state,
  onFieldChange,
  viewportWidth = 1440,
  profileMinWidth = 160,
  profileGap = "4px 8px",
  includeSharedBands = true,
}) {
  const lookup = buildGroupFieldLookup(group);
  const sharedBands = includeSharedBands ? materializeBandEntries(lookup, DTE_SHARED_BAND_LAYOUTS) : [];
  const profilePanels = DTE_PROFILE_ORDER
    .map((key) => (group.panels || []).find((panel) => panel.key === key))
    .filter(Boolean);
  const profileColumnCount = Math.max(1, Math.min(getDteExitColumnCount(viewportWidth), profilePanels.length));
  const dockSharedBands = sharedBands.length > 0 && profilePanels.length > 0 && profileColumnCount >= 4 && viewportWidth >= 1320;
  const sharedLabelMode = dockSharedBands ? "top" : viewportWidth < 1100 ? "top" : "side";
  const sharedBandsContent = sharedBands.length > 0 ? (
    <div style={{ minWidth: 0, display: "grid", gap: 0 }}>
      {sharedBands.map((band, index) => (
        <GroupBandRow
          key={band.key}
          band={band}
          state={state}
          onFieldChange={onFieldChange}
          tone={group.tone}
          showDivider={index > 0}
          labelMode={sharedLabelMode}
          compact
          fixedTracks
        />
      ))}
    </div>
  ) : null;
  const profileGrid = (
    <div
      style={{
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${profileColumnCount}, minmax(${profileMinWidth}px, 1fr))`,
        gap: profileGap,
        alignItems: "start",
      }}
    >
      {profilePanels.map((panel) => (
        <DteProfileColumn
          key={panel.key}
          panel={panel}
          state={state}
          onFieldChange={onFieldChange}
          tone={group.tone}
        />
      ))}
      {dockSharedBands && sharedBandsContent ? (
        <div
          style={{
            minWidth: 0,
            gridColumn: `${profileColumnCount} / span 1`,
            gridRow: "2",
            alignSelf: "start",
            display: "grid",
            gap: 3,
            paddingTop: 2,
            borderTop: `1px solid ${BORDER_SUBTLE}`,
          }}
        >
          <div
            style={{
              fontSize: 8.5,
              fontFamily: FS,
              fontWeight: 700,
              color: "#64748b",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              lineHeight: 1.08,
            }}
          >
            Shared
          </div>
          {sharedBandsContent}
        </div>
      ) : null}
    </div>
  );

  return (
    <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
      {dockSharedBands ? (
        profileGrid
      ) : (
        <>
          {sharedBandsContent}

          <div
            style={{
              minWidth: 0,
            }}
          >
            {profileGrid}
          </div>
        </>
      )}
    </div>
  );
}

function GroupSectionHeader({
  group,
  state,
  onResetGroup,
  palette,
  compact = false,
}) {
  const changedCount = collectUniqueVisualFieldPaths([group]).reduce((count, path) => (
    isFieldChanged(state, path) ? count + 1 : count
  ), 0);

  return (
    <div
      style={{
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "baseline",
        gap: 6,
      }}
    >
      <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 5 }}>
        <div style={{ fontSize: compact ? 11 : 12, fontFamily: FS, fontWeight: 700, color: "#0f172a", lineHeight: 1.05 }}>
          {group.title}
        </div>
        {changedCount > 0 ? (
          <span
            style={{
              fontSize: 8.5,
              fontFamily: F,
              fontWeight: 700,
              color: palette.accent,
              opacity: 0.78,
              whiteSpace: "nowrap",
            }}
          >
            {changedCount} edited
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onResetGroup(group)}
        style={{
          flexShrink: 0,
          minHeight: compact ? 15 : 17,
          padding: compact ? "0 4px" : "0 5px",
          borderRadius: 999,
          border: `1px solid ${changedCount > 0 ? palette.border : "#dde6ee"}`,
          background: compact ? PANEL_SOFT : "#ffffff",
          color: changedCount > 0 ? palette.accent : "#64748b",
          fontSize: 8.5,
          fontFamily: FS,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Reset
      </button>
    </div>
  );
}

function CompositeGroupRow({
  groups,
  state,
  onFieldChange,
  onResetGroup,
  viewportWidth = 1440,
  showDivider = false,
  layoutMap = PRIMARY_CONTEXT_BAND_LAYOUTS,
  columnTemplate = null,
  stackAt = 1320,
  syncAt = null,
  compact = true,
  syncBands = true,
}) {
  const resolvedGroups = groups.filter(Boolean);
  const resolvedSyncAt = Number.isFinite(Number(syncAt)) ? Number(syncAt) : null;
  const maxColumns = viewportWidth < 1100 ? 3 : viewportWidth < 1600 ? 4 : 6;
  const columnCount = viewportWidth < stackAt
    ? 1
    : resolvedSyncAt && viewportWidth < resolvedSyncAt
      ? Math.min(2, resolvedGroups.length)
      : Math.min(resolvedGroups.length, maxColumns);
  const stacked = columnCount === 1;

  if (!resolvedGroups.length) {
    return null;
  }

  if (syncBands && !stacked && columnCount === resolvedGroups.length && resolvedGroups.length > 1 && resolvedGroups.length <= 4) {
    const resolvedBandSets = resolvedGroups.map((group) => resolveGroupBands(group, layoutMap));
    const maxBandCount = Math.max(...resolvedBandSets.map((bands) => bands.length));
    const palettes = resolvedGroups.map((group) => getTonePalette(group.tone));

    return (
      <section
        style={{
          minWidth: 0,
          paddingTop: showDivider ? 4 : 0,
          borderTop: showDivider ? `1px solid ${BORDER_SUBTLE}` : "none",
        }}
      >
        <div style={{ minWidth: 0, display: "grid", gap: 0 }}>
          <div
            style={{
              minWidth: 0,
              display: "grid",
              gridTemplateColumns: columnTemplate || `repeat(${resolvedGroups.length}, minmax(0, 1fr))`,
              gap: 4,
              alignItems: "start",
            }}
          >
            {resolvedGroups.map((group, index) => (
              <div
                key={`${group.key}-header`}
                style={{
                  minWidth: 0,
                  paddingLeft: index > 0 ? 6 : 0,
                  borderLeft: index > 0 ? `1px solid ${BORDER_SUBTLE}` : "none",
                }}
              >
                <GroupSectionHeader
                  group={group}
                  state={state}
                  onResetGroup={onResetGroup}
                  palette={palettes[index]}
                  compact={compact}
                />
              </div>
            ))}
          </div>

          {Array.from({ length: maxBandCount }, (_, index) => {
            return (
              <div
                key={`${resolvedGroups.map((group) => group.key).join("-")}-band-${index}`}
                style={{
                  minWidth: 0,
                  paddingTop: index === 0 ? 1 : compact ? 2 : 3,
                  borderTop: index > 0 && !compact ? `1px solid ${BORDER_SUBTLE}` : "none",
                  display: "grid",
                  gridTemplateColumns: columnTemplate || `repeat(${resolvedGroups.length}, minmax(0, 1fr))`,
                  gap: 4,
                  alignItems: "start",
                }}
              >
                {resolvedGroups.map((group, groupIndex) => {
                  const band = resolvedBandSets[groupIndex][index] || null;
                  return (
                    <div
                      key={`${group.key}-band-${index}`}
                      style={{
                        minWidth: 0,
                        paddingLeft: groupIndex > 0 ? 6 : 0,
                        borderLeft: groupIndex > 0 ? `1px solid ${BORDER_SUBTLE}` : "none",
                      }}
                    >
                      {band ? (
                        <GroupBandRow
                          band={band}
                          state={state}
                          onFieldChange={onFieldChange}
                          tone={group.tone}
                          labelMode="top"
                          compact={compact}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section
      style={{
        minWidth: 0,
        paddingTop: showDivider ? 4 : 0,
        borderTop: showDivider ? `1px solid ${BORDER_SUBTLE}` : "none",
      }}
    >
      <div
        style={{
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: stacked
            ? "1fr"
            : columnCount === resolvedGroups.length && columnTemplate
              ? columnTemplate
              : `repeat(${columnCount}, minmax(160px, 1fr))`,
          gap: 5,
          alignItems: "start",
        }}
      >
        {resolvedGroups.map((group) => {
          const palette = getTonePalette(group.tone);
          const fieldCount = (layoutMap[group.key] || []).reduce((sum, b) => sum + (b.fields || []).length, 0);
          const preferredSpan = COMPOSITE_GROUP_SPAN_OVERRIDES[group.key];
          const span = !stacked && Number.isFinite(Number(preferredSpan))
            ? Math.max(1, Math.min(columnCount, Number(preferredSpan)))
            : (!stacked && fieldCount > 16 ? Math.min(columnCount, 3) : !stacked && fieldCount > 10 ? Math.min(columnCount, 2) : 1);
          return (
            <div
              key={group.key}
              style={{
                minWidth: 0,
                display: "grid",
                gap: 3,
                alignContent: "start",
                gridColumn: span > 1 ? `span ${span}` : undefined,
              }}
            >
              <GroupSectionHeader
                group={group}
                state={state}
                onResetGroup={onResetGroup}
                palette={palette}
                compact={compact}
              />
              <StandardGroupBands
                group={group}
                state={state}
                onFieldChange={onFieldChange}
                viewportWidth={viewportWidth}
                layoutMap={layoutMap}
                compact={compact}
                labelModeOverride="top"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UnifiedGroupSection({
  group,
  state,
  onFieldChange,
  onResetGroup,
  viewportWidth = 1440,
  showDivider = false,
  compact = false,
  exitProfileMinWidth = 160,
  exitProfileGap = "4px 8px",
  hideExitSharedBands = false,
}) {
  const palette = getTonePalette(group.tone);

  return (
    <section
      style={{
        minWidth: 0,
        paddingTop: showDivider ? 4 : 0,
        borderTop: showDivider ? `1px solid ${BORDER_SUBTLE}` : "none",
      }}
    >
      <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
        <GroupSectionHeader
          group={group}
          state={state}
          onResetGroup={onResetGroup}
          palette={palette}
          compact={compact}
        />
        {group.key === "exitLogic" ? (
          <DteExitProfilesMatrix
            group={group}
            state={state}
            onFieldChange={onFieldChange}
            viewportWidth={viewportWidth}
            profileMinWidth={exitProfileMinWidth}
            profileGap={exitProfileGap}
            includeSharedBands={!hideExitSharedBands}
          />
        ) : (
          <StandardGroupBands
            group={group}
            state={state}
            onFieldChange={onFieldChange}
            viewportWidth={viewportWidth}
            compact={compact}
          />
        )}
      </div>
    </section>
  );
}

function SectionRibbon({ title, tone = "neutral" }) {
  const palette = getTonePalette(tone);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: palette.accent,
        fontSize: 8.5,
        fontFamily: FS,
        fontWeight: 800,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </div>
  );
}

function PanelFieldGrid({ rows = [], panel, state, onFieldChange, tone = "neutral" }) {
  const effectiveRows = rows.map((row) => ({
    ...row,
    effectiveField: {
      ...row.field,
      label: row.label || row.field.label,
      layout: row.layout || row.field.layout || (rows.length === 1 && row.field.type === "text" ? "wide" : undefined),
    },
  }));
  const hasWideField = effectiveRows.some((row) => resolveFieldLayout(row.effectiveField) === "wide");
  const compactGridStyle = !hasWideField && rows.length === 1
    ? { gridTemplateColumns: "minmax(0, 168px)", justifyContent: "start" }
    : !hasWideField && rows.length === 2
      ? { gridTemplateColumns: "repeat(2, minmax(0, 146px))", justifyContent: "start" }
      : { gridTemplateColumns: `repeat(${SECTION_GRID_COLUMNS}, minmax(0, 1fr))` };

  return (
    <div
      style={{
        display: "grid",
        ...compactGridStyle,
        gap: 4,
        alignItems: "start",
      }}
    >
      {effectiveRows.map((row) => {
        const effectiveField = row.effectiveField;
        const value = getValueAtPath(state, row.field.path);
        return (
          <ConfigField
            key={row.field.path}
            field={effectiveField}
            value={value}
            changed={isFieldChanged(state, row.field.path)}
            onChange={(nextValue) => onFieldChange(row.field.path, nextValue)}
            range={row.range || panel.range || null}
            tone={panel.tone || tone}
            showRangeTrack={row.showRangeTrack ?? true}
            showRangeCaption={row.showRangeCaption ?? !panel.range}
          />
        );
      })}
    </div>
  );
}

function CompactInlineField({ row, value, changed, onChange, tone = "neutral" }) {
  const palette = getTonePalette(tone);
  const range = row.range || null;

  return (
    <div
      style={{
        minWidth: 0,
        display: "grid",
        gap: 3,
        alignContent: "start",
      }}
    >
      <div
        style={{
          fontSize: 8.5,
          fontFamily: FS,
          fontWeight: 700,
          color: changed ? WARNING : MUTED,
          lineHeight: 1.1,
          textAlign: "center",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {row.label || row.field.label}
      </div>
      <NumberInput
        value={value}
        onChange={onChange}
        step={range?.step ?? row.field.step}
        min={range?.min ?? row.field.min}
        max={range?.max ?? row.field.max}
        style={{
          height: 24,
          padding: "0 6px",
          borderRadius: 7,
          border: `1px solid ${changed ? CHANGED_BORDER : palette.border}`,
          background: changed ? CHANGED_SURFACE : "#ffffff",
          fontSize: 9.5,
          textAlign: "center",
        }}
      />
    </div>
  );
}

function CompactInlineSection({ section, panel, state, onFieldChange, tone = "neutral" }) {
  const columns = Math.max(1, Number(section.columns) || section.fields.length || 1);
  const columnWidth = columns >= 4 ? 56 : columns === 3 ? 66 : 76;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, ${columnWidth}px))`,
        gap: 5,
        alignItems: "start",
        justifyContent: "start",
      }}
    >
      {section.fields.map((row) => {
        const value = getValueAtPath(state, row.field.path);
        return (
          <CompactInlineField
            key={row.field.path}
            row={row}
            value={value}
            changed={isFieldChanged(state, row.field.path)}
            onChange={(nextValue) => onFieldChange(row.field.path, nextValue)}
            tone={panel.tone || tone}
          />
        );
      })}
    </div>
  );
}

function PanelFieldsBody({ panel, state, onFieldChange, tone = "neutral" }) {
  const sections = getPanelFieldSections(panel);
  const hasNamedSections = sections.some((section) => section.title);

  return (
    <div style={{ display: "grid", gap: hasNamedSections ? 6 : 0 }}>
      {sections.map((section, index) => {
        const showDivider = hasNamedSections && index > 0;
        return (
          <div
            key={section.key}
            style={{
              display: "grid",
              gap: 4,
              paddingTop: showDivider ? 6 : 0,
              borderTop: showDivider ? `1px solid ${BORDER_SUBTLE}` : "none",
            }}
          >
            {section.title ? <SectionRibbon title={section.title} tone={panel.tone || tone} /> : null}
            {section.subtitle ? (
              <div style={{ fontSize: 9.5, fontFamily: FS, color: MUTED, lineHeight: 1.3 }}>
                {section.subtitle}
              </div>
            ) : null}
            {section.layout === "compact_row" ? (
              <CompactInlineSection
                section={section}
                panel={panel}
                state={state}
                onFieldChange={onFieldChange}
                tone={tone}
              />
            ) : (
              <PanelFieldGrid
                rows={section.fields}
                panel={panel}
                state={state}
                onFieldChange={onFieldChange}
                tone={tone}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PanelHeader({ panel, changedCount, tone = "neutral" }) {
  const palette = getTonePalette(panel.tone || tone);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontFamily: FS, fontWeight: 700, color: "#0f172a", lineHeight: 1.15 }}>{panel.title}</div>
        {panel.subtitle ? (
          <div style={{ marginTop: 1, fontSize: 9, fontFamily: FS, color: MUTED, lineHeight: 1.25 }}>{panel.subtitle}</div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 5 }}>
        {panel.range ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 18,
              padding: "0 6px",
              borderRadius: 999,
              background: PANEL_SOFT,
              border: `1px solid ${palette.border}`,
              color: palette.accent,
              fontSize: 8.5,
              fontFamily: F,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {formatRangeValue(panel.range.min, panel.range, { compact: true })} to {formatRangeValue(panel.range.max, panel.range, { compact: true })}
          </div>
        ) : null}
        {changedCount > 0 ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 18,
              padding: "0 6px",
              borderRadius: 999,
              background: "#fff8ef",
              border: "1px solid #f6cf9c",
              color: WARNING,
              fontSize: 8.5,
              fontFamily: F,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {changedCount} changed
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PanelShell({ panel, tone = "neutral", changedCount = 0, children }) {
  const palette = getTonePalette(panel.tone || tone);
  const compareSurface = panel.type === "compare" || panel.type === "rail_compare";
  return (
    <div
      style={{
        border: `1px solid ${compareSurface ? palette.border : BORDER_STRONG}`,
        borderRadius: 12,
        background: compareSurface ? "#fbfdff" : "#ffffff",
        padding: "6px 6px 7px",
        display: "grid",
        gap: 5,
        boxShadow: compareSurface ? "none" : SHADOW,
      }}
    >
      <PanelHeader panel={panel} changedCount={changedCount} tone={tone} />
      {children}
    </div>
  );
}

function RailCompareBody({ panel, state, onFieldChange, tone = "neutral" }) {
  const palette = getTonePalette(panel.tone || tone);
  const railRef = useRef(null);
  const [dragPath, setDragPath] = useState(null);
  const fields = panel.fields || [];
  const trackTop = 41;
  const knobTop = 44;

  const commitRailValue = (path, clientX) => {
    if (!path || !railRef.current || !panel.range) {
      return;
    }
    const rect = railRef.current.getBoundingClientRect();
    if (!rect.width) {
      return;
    }
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const nextValue = snapRangeValue(
      Number(panel.range.min) + ratio * (Number(panel.range.max) - Number(panel.range.min)),
      panel.range,
    );
    onFieldChange(path, nextValue);
  };

  useEffect(() => {
    if (!dragPath) {
      return undefined;
    }
    const handlePointerMove = (event) => {
      commitRailValue(dragPath, event.clientX);
    };
    const handlePointerUp = () => setDragPath(null);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragPath, panel.range]);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ position: "relative", minHeight: 66 }}>
        <div
          ref={railRef}
          style={{
            position: "absolute",
            inset: "0 4px 0 4px",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: trackTop,
              height: 6,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${palette.soft}, ${palette.border})`,
              boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.06)",
            }}
          />
          {fields.map((row, index) => {
            const value = Number(getValueAtPath(state, row.field.path));
            const left = `${normalizeRangePosition(value, panel.range) * 100}%`;
            const labelTop = index % 2 === 0 ? 0 : 13;
            const connectorTop = labelTop + 15;
            const bubbleValue = formatRangeValue(value, row.range || panel.range || {}, { compact: true });
            return (
              <React.Fragment key={row.field.path}>
                <div
                  style={{
                    position: "absolute",
                    left,
                    top: labelTop,
                    transform: "translateX(-50%)",
                    padding: "1px 5px",
                    borderRadius: 999,
                    border: `1px solid ${dragPath === row.field.path ? palette.accent : palette.border}`,
                    background: PANEL_SOFT,
                    color: dragPath === row.field.path ? palette.accent : "#1e293b",
                    fontSize: 8,
                    fontFamily: FS,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: panel.showValueInLabels ? 5 : 0,
                  }}
                >
                  <span>{row.label || row.field.label}</span>
                  {panel.showValueInLabels ? (
                    <span style={{ color: dragPath === row.field.path ? palette.accent : MUTED }}>
                      {bubbleValue}
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    position: "absolute",
                    left,
                    top: connectorTop,
                    width: 1,
                    height: Math.max(9, trackTop - connectorTop),
                    background: palette.border,
                    transform: "translateX(-50%)",
                  }}
                />
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setDragPath(row.field.path);
                    commitRailValue(row.field.path, event.clientX);
                  }}
                  style={{
                    position: "absolute",
                    left,
                    top: knobTop,
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    border: `2px solid ${dragPath === row.field.path ? palette.accent : "#ffffff"}`,
                    background: dragPath === row.field.path ? palette.accent : palette.surface,
                    boxShadow: `0 0 0 1px ${palette.border}, 0 2px 5px rgba(15,23,42,0.12)`,
                    transform: "translate(-50%, -50%)",
                    cursor: "grab",
                  }}
                  aria-label={`Adjust ${row.label || row.field.label}`}
                />
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <RangeCaption range={panel.range} />
      {panel.hideFieldEditors ? null : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 4,
            alignItems: "start",
          }}
        >
          {fields.map((row) => {
            const effectiveField = {
              ...row.field,
              label: row.label || row.field.label,
              layout: "normal",
            };
            const value = getValueAtPath(state, row.field.path);
            return (
              <ConfigField
                key={row.field.path}
                field={effectiveField}
                value={value}
                changed={isFieldChanged(state, row.field.path)}
                onChange={(nextValue) => onFieldChange(row.field.path, nextValue)}
                range={row.range || panel.range || null}
                tone={panel.tone || tone}
                showRangeTrack={false}
                showRangeCaption={false}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function PanelBody({ panel, state, onFieldChange, tone = "neutral" }) {
  if (panel.type === "rail_compare") {
    return <RailCompareBody panel={panel} state={state} onFieldChange={onFieldChange} tone={tone} />;
  }
  return <PanelFieldsBody panel={panel} state={state} onFieldChange={onFieldChange} tone={tone} />;
}

function VisualizationPanel({ panel, state, onFieldChange, tone = "neutral", shell = true }) {
  const changedCount = useMemo(() => getPanelChangedCount(panel, state), [panel, state]);
  const body = (
    <PanelBody
      panel={panel}
      state={state}
      onFieldChange={onFieldChange}
      tone={tone}
    />
  );

  if (!shell) {
    return body;
  }

  return (
    <PanelShell panel={panel} tone={tone} changedCount={changedCount}>
      {body}
    </PanelShell>
  );
}

function InlinePanelSection({
  panel,
  state,
  onFieldChange,
  tone = "neutral",
  showDivider = false,
}) {
  const palette = getTonePalette(panel.tone || tone);
  const changedCount = useMemo(() => getPanelChangedCount(panel, state), [panel, state]);

  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        paddingTop: showDivider ? 6 : 0,
        borderTop: showDivider ? `1px solid ${BORDER_SUBTLE}` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <SectionRibbon title={panel.title} tone={panel.tone || tone} />
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {panel.range ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 18,
                padding: "0 6px",
                borderRadius: 999,
                background: PANEL_SOFT,
                border: `1px solid ${palette.border}`,
                color: palette.accent,
                fontSize: 8.5,
                fontFamily: F,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {formatRangeValue(panel.range.min, panel.range, { compact: true })} to {formatRangeValue(panel.range.max, panel.range, { compact: true })}
            </div>
          ) : null}
          {changedCount > 0 ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 18,
                padding: "0 6px",
                borderRadius: 999,
                background: "#fff8ef",
                border: "1px solid #f6cf9c",
                color: WARNING,
                fontSize: 8.5,
                fontFamily: F,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {changedCount} changed
            </div>
          ) : null}
        </div>
      </div>
      {panel.subtitle ? (
        <div style={{ fontSize: 9, fontFamily: FS, color: MUTED, lineHeight: 1.3 }}>
          {panel.subtitle}
        </div>
      ) : null}
      <VisualizationPanel
        panel={panel}
        state={state}
        onFieldChange={onFieldChange}
        tone={tone}
        shell={false}
      />
    </div>
  );
}

function ConfigSectionCard({ group, state, onFieldChange, onResetGroup, viewportWidth = 1440, columnSpan = 1 }) {
  const palette = getTonePalette(group.tone);
  const changedCount = useMemo(
    () => collectUniqueVisualFieldPaths([group]).reduce((count, path) => (
      isFieldChanged(state, path) ? count + 1 : count
    ), 0),
    [group, state],
  );

  const pinnedLayoutMode = columnSpan <= 1
    ? "carousel"
    : columnSpan >= 3 && viewportWidth >= 1450
      ? "grid"
      : "two_column";

  const groupBody = group.layout === "pinned_row"
    ? (
      <div
        style={
          pinnedLayoutMode === "carousel"
            ? {
              display: "flex",
              gap: 6,
              overflowX: "auto",
              paddingBottom: 3,
              scrollSnapType: "x proximity",
            }
            : {
              display: "grid",
              gridTemplateColumns: pinnedLayoutMode === "two_column"
                ? "repeat(2, minmax(0, 1fr))"
                : `repeat(${Math.min(4, group.panels.length)}, minmax(0, 1fr))`,
              gap: 6,
            }
        }
      >
        {(group.panels || []).map((panel) => {
          const wrapperStyle = pinnedLayoutMode === "carousel"
            ? {
              minWidth: panel.key === "zeroDteProfile" || panel.key === "oneDteProfile" || panel.key === "twoToThreeDteProfile" || panel.key === "fivePlusDteProfile"
                ? 232
                : 208,
              flex: "0 0 auto",
              scrollSnapAlign: "start",
            }
            : {};
          return (
            <div key={panel.key} style={wrapperStyle}>
              <VisualizationPanel
                panel={panel}
                state={state}
                onFieldChange={onFieldChange}
                tone={group.tone}
              />
            </div>
          );
        })}
      </div>
    )
    : group.renderMode === "merged_sections"
      ? (
        <div style={{ display: "grid", gap: 6 }}>
          {(group.panels || []).map((panel, index) => (
            <InlinePanelSection
              key={panel.key}
              panel={panel}
              state={state}
              onFieldChange={onFieldChange}
              tone={group.tone}
              showDivider={index > 0}
            />
          ))}
        </div>
      )
    : (
      <div style={{ display: "grid", gap: 6 }}>
        {(group.panels || []).map((panel) => (
          <VisualizationPanel
            key={panel.key}
            panel={panel}
            state={state}
            onFieldChange={onFieldChange}
            tone={group.tone}
          />
        ))}
      </div>
    );

  return (
    <div
      style={{
        minWidth: 0,
        border: `1px solid ${group.layout === "pinned_row" ? palette.border : BORDER_STRONG}`,
        borderRadius: 12,
        background: PANEL_BG,
        boxShadow: SHADOW,
        padding: 7,
        display: "grid",
        gap: 6,
      }}
    >
      <SectionHeader
        title={group.title}
        subtitle={group.subtitle}
        changedCount={changedCount}
        onReset={() => onResetGroup(group)}
        tone={group.tone}
      />
      {groupBody}
    </div>
  );
}

export default function ResearchWorkbenchConfigStagingPanel({
  stagedConfigModel,
}) {
  const viewportWidth = useViewportWidth();
  const changedCount = useMemo(
    () => countChangedFields(stagedConfigModel.state),
    [stagedConfigModel.state],
  );
  const visualGroups = useMemo(() => {
    const orderLookup = new Map(VISUAL_GROUP_ORDER.map((key, index) => [key, index]));
    return [...BACKTEST_V2_STAGE_VISUAL_GROUPS].sort((left, right) => (
      (orderLookup.get(left.key) ?? Number.MAX_SAFE_INTEGER)
      - (orderLookup.get(right.key) ?? Number.MAX_SAFE_INTEGER)
    ));
  }, []);
  const runSetupGroup = useMemo(
    () => visualGroups.find((group) => group.key === "runSetup") || null,
    [visualGroups],
  );
  const accountGuardrailsGroup = useMemo(
    () => visualGroups.find((group) => group.key === "accountGuardrails") || null,
    [visualGroups],
  );
  const entryQualificationGroup = useMemo(
    () => visualGroups.find((group) => group.key === "entryQualification") || null,
    [visualGroups],
  );
  const dtePolicyGroup = useMemo(
    () => visualGroups.find((group) => group.key === "dtePolicy") || null,
    [visualGroups],
  );
  const volatilityRegimeGroup = useMemo(
    () => visualGroups.find((group) => group.key === "volatilityRegime") || null,
    [visualGroups],
  );
  const sizingPlanGroup = useMemo(
    () => visualGroups.find((group) => group.key === "sizingPlan") || null,
    [visualGroups],
  );
  const exitLogicGroup = useMemo(
    () => visualGroups.find((group) => group.key === "exitLogic") || null,
    [visualGroups],
  );
  const exitSharedGroup = useMemo(() => {
    if (!exitLogicGroup) {
      return null;
    }
    const lookup = buildGroupFieldLookup(exitLogicGroup);
    const rows = Array.from(new Map(
      DTE_SHARED_BAND_LAYOUTS
        .flatMap((band) => (band.fields || []).map((item) => lookup.get(item.path)?.row).filter(Boolean))
        .map((row) => [row.field.path, row]),
    ).values());
    if (!rows.length) {
      return null;
    }
    return {
      key: "exitShared",
      title: "Exit Shared",
      tone: exitLogicGroup.tone,
      panels: [
        {
          key: "exitSharedPanel",
          title: "Exit Shared",
          tone: exitLogicGroup.tone,
          fields: rows,
        },
      ],
    };
  }, [exitLogicGroup]);
  const remainingVisualGroups = useMemo(
    () => visualGroups.filter((group) => ![
      "runSetup",
      "accountGuardrails",
      "entryQualification",
      "dtePolicy",
      "volatilityRegime",
      "sizingPlan",
      "exitLogic",
    ].includes(group.key)),
    [visualGroups],
  );
  const showSecondRowSharedExit = Boolean(exitSharedGroup) && viewportWidth >= 1320;

  const resetVisualGroup = (group) => {
    const resetPaths = Array.from(new Set(collectVisualFieldRefs([group]).map((row) => row.field.path).filter(Boolean)));
    resetPaths.forEach((path) => {
      stagedConfigModel.setField(path, getValueAtPath(BACKTEST_V2_STAGE_DEFAULTS, path));
    });
  };

  return (
    <div
      style={{
        border: `1px solid ${BORDER_STRONG}`,
        borderRadius: 12,
        background: "#ffffff",
        padding: "6px 8px 8px",
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "baseline",
          paddingBottom: 5,
          borderBottom: `1px solid ${BORDER_STRONG}`,
        }}
      >
        <div style={{ minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
          <div
            style={{
              fontSize: 10,
              fontFamily: FS,
              fontWeight: 700,
              color: SUBTLE,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            New Inputs
          </div>
          <div style={{ fontSize: 14, fontFamily: FS, fontWeight: 700, color: "#0f172a", lineHeight: 1.08 }}>
            Workflow-first v2 staging
          </div>
          <div style={{ fontSize: 9.5, fontFamily: FS, color: "#64748b", lineHeight: 1.1 }}>
            Profile {stagedConfigModel.state.runSettings.profileName || "default"}
            {" · "}
            {changedCount > 0 ? `${changedCount} edited` : "default state"}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
          <button
            type="button"
            onClick={stagedConfigModel.resetAll}
            style={{
              minHeight: 18,
              padding: "0 7px",
              borderRadius: 999,
              border: `1px solid ${changedCount > 0 ? CHANGED_BORDER : BORDER_STRONG}`,
              background: "#ffffff",
              color: changedCount > 0 ? WARNING : MUTED,
              fontSize: 9,
              fontFamily: FS,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reset all
          </button>
        </div>
      </div>

      {visualGroups.length > 0 ? (
        <div style={{ display: "grid", gap: 3 }}>
          <CompositeGroupRow
            groups={[runSetupGroup, accountGuardrailsGroup, entryQualificationGroup].filter(Boolean)}
            state={stagedConfigModel.state}
            onFieldChange={stagedConfigModel.setField}
            onResetGroup={resetVisualGroup}
            viewportWidth={viewportWidth}
            layoutMap={ALL_GROUPS_BAND_LAYOUTS}
            stackAt={900}
            compact
            syncBands={false}
          />
          <CompositeGroupRow
            groups={[dtePolicyGroup, volatilityRegimeGroup, sizingPlanGroup, showSecondRowSharedExit ? exitSharedGroup : null].filter(Boolean)}
            state={stagedConfigModel.state}
            onFieldChange={stagedConfigModel.setField}
            onResetGroup={resetVisualGroup}
            viewportWidth={viewportWidth}
            layoutMap={EXTENDED_ALL_GROUPS_BAND_LAYOUTS}
            stackAt={900}
            compact
            syncBands={false}
          />
          {exitLogicGroup ? (
            <UnifiedGroupSection
              group={exitLogicGroup}
              state={stagedConfigModel.state}
              onFieldChange={stagedConfigModel.setField}
              onResetGroup={resetVisualGroup}
              viewportWidth={viewportWidth}
              showDivider
              compact
              exitProfileMinWidth={104}
              exitProfileGap="3px 5px"
              hideExitSharedBands={showSecondRowSharedExit}
            />
          ) : null}
          {remainingVisualGroups.map((group, index) => (
            <UnifiedGroupSection
              key={group.key}
              group={group}
              state={stagedConfigModel.state}
              onFieldChange={stagedConfigModel.setField}
              onResetGroup={resetVisualGroup}
              viewportWidth={viewportWidth}
              showDivider
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
