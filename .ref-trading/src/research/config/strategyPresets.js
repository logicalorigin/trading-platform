export const EXIT_PRESETS = {
  scalp: { sl: 0.15, tp: 0.20, ts: 0.05, tr: 0.10 },
  tight: { sl: 0.20, tp: 0.28, ts: 0.06, tr: 0.15 },
  moderate: { sl: 0.25, tp: 0.35, ts: 0.08, tr: 0.18 },
  wide: { sl: 0.45, tp: 0.70, ts: 0.12, tr: 0.22 },
  runner: { sl: 0.30, tp: 2.00, ts: 0.20, tr: 0.30 },
  lotto: { sl: 0.60, tp: 5.00, ts: 0.50, tr: 0.50 },
};

export const STRATEGY_PRESETS = {
  rayalgo: {
    dte: 3,
    exit: "moderate",
    mc: 0.40,
    zb: 25,
    rf: "not_bear",
    note: "EMA 9/21 crossover trigger + SMC confluence (CHoCH, BOS, OB, sweeps). Requires fresh cross + structure. Quality-gated.",
  },
  momentum_breakout: {
    dte: 5,
    exit: "wide",
    mc: 0.48,
    zb: 30,
    rf: "not_bear",
    note: "Ride trends with wide stops. 5DTE gives room for multi-day follow-through.",
  },
  sweep_reversal: {
    dte: 3,
    exit: "tight",
    mc: 0.45,
    zb: 25,
    rf: "none",
    note: "Quick reversal capture. Tight exits lock in the snap-back. No regime filter — sweeps work everywhere.",
  },
  vwap_extreme: {
    dte: 1,
    exit: "tight",
    mc: 0.48,
    zb: 15,
    rf: "none",
    note: "Deep dislocation snap-back. 1DTE captures the gamma. Very short zombie — instant resolution or cut.",
  },
  ema_stack: {
    dte: 5,
    exit: "wide",
    mc: 0.48,
    zb: 35,
    rf: "not_bear",
    note: "Pullback in strong trend. Wide exits to ride follow-through. Filter bears — stacks break in selloffs.",
  },
  bb_squeeze: {
    dte: 3,
    exit: "moderate",
    mc: 0.48,
    zb: 25,
    rf: "none",
    note: "Breakout from compression. Moderate exits — direction is clear but magnitude uncertain.",
  },
};

export const DEFAULT_RESEARCH_STRATEGY = "rayalgo";
export const MANUAL_RESEARCH_STRATEGIES = [
  "rayalgo",
  "momentum_breakout",
  "sweep_reversal",
  "vwap_extreme",
  "ema_stack",
  "bb_squeeze",
];

export const STRATEGY_OPTIONS = [
  ["rayalgo", "RayGun"],
  ["momentum_breakout", "Momentum"],
  ["sweep_reversal", "Sweep"],
  ["vwap_extreme", "VWAP-X"],
  ["ema_stack", "EMA Stack"],
  ["bb_squeeze", "BB Squeeze"],
];

export const RECOMMENDATION_COMPUTE_STRATEGIES = [
  "rayalgo",
  "momentum_breakout",
  "sweep_reversal",
  "vwap_extreme",
  "ema_stack",
  "bb_squeeze",
];

export const RECOMMENDATION_DISPLAY_STRATEGIES = [
  "momentum_breakout",
  "sweep_reversal",
  "vwap_extreme",
  "ema_stack",
  "bb_squeeze",
];

export const REGIME_OPTIONS = ["bull", "range", "bear"];

export const STRATEGY_ROLE_LABELS = {
  momentum_breakout: "trend",
  sweep_reversal: "revert",
  vwap_extreme: "revert",
  ema_stack: "trend",
  bb_squeeze: "breakout",
};

export const STRATEGY_LOG_LABELS = {
  rayalgo: "RA",
  momentum_breakout: "mom",
  sweep_reversal: "swp",
  vwap_extreme: "vext",
  ema_stack: "stk",
  bb_squeeze: "bb",
};

export function getStrategyLabel(strategy) {
  return ({
    rayalgo: "RayGun",
    momentum_breakout: "Mom",
    sweep_reversal: "Sweep",
    vwap_extreme: "V-Ext",
    ema_stack: "Stack",
    bb_squeeze: "BB",
    all: "All",
  })[strategy] || strategy;
}

export function normalizeResearchStrategy(strategy) {
  const normalized = String(strategy || "").trim().toLowerCase();
  return MANUAL_RESEARCH_STRATEGIES.includes(normalized)
    ? normalized
    : DEFAULT_RESEARCH_STRATEGY;
}

export function getActiveExitPresetKey(slPct, tpPct) {
  for (const [key, preset] of Object.entries(EXIT_PRESETS)) {
    if (Math.abs(slPct - preset.sl) < 0.005 && Math.abs(tpPct - preset.tp) < 0.005) {
      return key;
    }
  }
  return null;
}
