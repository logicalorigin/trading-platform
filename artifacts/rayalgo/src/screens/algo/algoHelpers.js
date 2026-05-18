import {
  formatEnumLabel,
  formatOptionContractLabel,
} from "../../lib/formatters";
import {
  MISSING_VALUE,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";

export const SIGNAL_OPTIONS_DEFAULT_PROFILE = {
  version: "v1",
  mode: "shadow",
  optionSelection: {
    minDte: 1,
    targetDte: 1,
    maxDte: 3,
    allowZeroDte: false,
    callStrikeSlot: 3,
    putStrikeSlot: 2,
  },
  riskCaps: {
    maxPremiumPerEntry: 500,
    maxContracts: 3,
    maxOpenSymbols: 5,
    maxDailyLoss: 1000,
  },
  liquidityGate: {
    maxSpreadPctOfMid: 35,
    minBid: 0.01,
    requireBidAsk: true,
    requireFreshQuote: true,
  },
  entryGate: {
    mtfAlignment: {
      enabled: true,
      requiredCount: 2,
    },
    blockedPutSymbols: [
      "SQQQ",
      "SH",
      "PSQ",
      "DOG",
      "SDS",
      "QID",
      "TWM",
      "SPXU",
      "SDOW",
      "TZA",
    ],
    bearishRegime: {
      enabled: true,
      minAdx: 25,
      rejectFullyBullishMtf: true,
    },
  },
  fillPolicy: {
    chaseMode: "aggressive",
    ttlSeconds: 20,
    chaseSteps: [0, 0.35, 0.65, 0.9],
  },
  exitPolicy: {
    hardStopPct: -40,
    trailActivationPct: 40,
    minLockedGainPct: 10,
    trailGivebackPct: 25,
    tightenAtFiveXGivebackPct: 35,
    tightenAtTenXGivebackPct: 25,
    flipOnOppositeSignal: true,
  },
};

export const SIGNAL_OPTIONS_EXPANDED_CAPACITY = {
  maxOpenSymbols: 5,
  maxDailyLoss: 1000,
};

export const SIGNAL_OPTIONS_STRIKE_SLOT_OPTIONS = [
  { value: 0, label: "Lower -2" },
  { value: 1, label: "Lower -1" },
  { value: 2, label: "ATM lower" },
  { value: 3, label: "ATM upper" },
  { value: 4, label: "Upper +1" },
  { value: 5, label: "Upper +2" },
];

export const STRATEGY_SIGNAL_TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"];

export const DEFAULT_STRATEGY_SIGNAL_SETTINGS = {
  signalTimeframe: "5m",
  timeHorizon: 8,
};

export const SIGNAL_OPTIONS_ACTION_LABELS = {
  candidate: "Awaiting Scan",
  blocked: "Blocked",
  shadow_filled: "Shadow Filled",
  partial_shadow: "Partial Shadow",
  manual_override: "Manual Override",
  closed: "Closed",
  mismatch: "Mismatch",
};

export const SIGNAL_OPTIONS_LIQUIDITY_REASON_LABELS = {
  missing_bid_ask: "Missing bid/ask quote",
  bid_below_minimum: "Bid below minimum",
  spread_too_wide: "Spread above max",
  quote_not_fresh: "Quote not fresh",
  missing_mark: "No usable option price",
  liquidity_gate_failed: "Liquidity gate failed",
};

export const SIGNAL_OPTIONS_REASON_CATEGORIES = {
  position_mark_unavailable: "marking",
  position_mark_failed: "marking",
  invalid_position_mark: "marking",
  no_contract_for_strike_slot: "contract_resolution",
  no_expiration_in_dte_window: "contract_resolution",
  option_chain_backoff: "contract_resolution",
  option_expiration_backoff: "contract_resolution",
  historical_option_bars_unavailable: "contract_resolution",
  options_upstream_failure: "contract_resolution",
  missing_bid_ask: "liquidity",
  spread_too_wide: "liquidity",
  bid_below_minimum: "liquidity",
  quote_not_fresh: "liquidity",
  missing_mark: "liquidity",
  liquidity_gate_failed: "liquidity",
  invalid_shadow_order_plan: "liquidity",
  invalid_historical_shadow_order_plan: "liquidity",
  max_open_symbols_reached: "risk",
  daily_loss_halt_active: "risk",
  premium_budget_exceeded: "risk",
  quantity_below_minimum: "risk",
  ibkr_not_configured: "gateway",
  gateway_socket_disconnected: "gateway",
  gateway_not_ready: "gateway",
  bridge_unavailable: "gateway",
  bear_regime_gate_failed: "signal_policy",
  mtf_not_aligned: "signal_policy",
  inverse_put_blocked: "signal_policy",
  entry_gate_failed: "signal_policy",
  same_direction_position_open: "signal_policy",
  opposite_signal_flip_disabled: "signal_policy",
  candidate_resolution_failed: "signal_policy",
};

export const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export const shadowLinkSummary = (shadowLink) => {
  const link = asRecord(shadowLink);
  if (!Object.keys(link).length) return "No Shadow ledger link";
  const parts = [
    link.orderId ? "order linked" : null,
    link.fillId ? "fill linked" : null,
    link.positionId ? "position linked" : null,
    link.attributionStatus ? String(link.attributionStatus).replace(/_/g, " ") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Shadow ledger link pending";
};

export const signalActionLabel = (signal, action) => {
  const signalRecord = asRecord(signal);
  const actionRecord = asRecord(action);
  const direction = signalRecord.direction || actionRecord.signalDirection;
  const optionAction = actionRecord.optionAction;
  if (optionAction) return formatEnumLabel(optionAction).toUpperCase();
  if (direction === "sell") return "BUY PUT";
  if (direction === "buy") return "BUY CALL";
  return MISSING_VALUE;
};

export const signalFreshnessLabel = (signal) => {
  const signalRecord = asRecord(signal);
  if (signalRecord.fresh === true) return "FRESH";
  if (signalRecord.fresh === false) return "STALE";
  return MISSING_VALUE;
};

export const signalBarsSinceLabel = (signal) => {
  const barsSinceSignal = asRecord(signal).barsSinceSignal;
  return Number.isFinite(Number(barsSinceSignal))
    ? `${Number(barsSinceSignal)} bars`
    : MISSING_VALUE;
};

export const signalFilterStateLabel = (signal) => {
  const filterState = asRecord(asRecord(signal).filterState);
  const entries = Object.entries(filterState)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 3)
    .map(([key, value]) => `${formatEnumLabel(key)} ${String(value)}`);
  return entries.length ? entries.join(" / ") : MISSING_VALUE;
};

export const cloneProfile = (profile) =>
  JSON.parse(JSON.stringify(profile || SIGNAL_OPTIONS_DEFAULT_PROFILE));

export const signalOptionsActionLabel = (status) =>
  SIGNAL_OPTIONS_ACTION_LABELS[status] || formatEnumLabel(status || "candidate");

export const formatLiquidityReason = (reason) =>
  SIGNAL_OPTIONS_LIQUIDITY_REASON_LABELS[reason] ||
  formatEnumLabel(reason || "liquidity_gate_failed");

export const formatLiquidityFreshness = (value) => {
  const freshness = String(value || "").trim();
  return freshness ? formatEnumLabel(freshness) : MISSING_VALUE;
};

export const candidateReasonCategory = (candidate) =>
  SIGNAL_OPTIONS_REASON_CATEGORIES[String(asRecord(candidate).reason || "")] ||
  "other";

export const candidateMatchesReasonCategory = (candidate, categories) =>
  categories.includes(candidateReasonCategory(candidate));

export const numberFrom = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const resolveStrategySignalSettings = (deployment, signalMonitorProfile) => {
  const parameters = asRecord(asRecord(deployment?.config).parameters);
  const rayReplicaSettings = asRecord(signalMonitorProfile?.rayReplicaSettings);
  const profileTimeframe = String(signalMonitorProfile?.timeframe || "");
  const configTimeframe = String(parameters.signalTimeframe || "");
  const signalTimeframe = STRATEGY_SIGNAL_TIMEFRAMES.includes(profileTimeframe)
    ? profileTimeframe
    : STRATEGY_SIGNAL_TIMEFRAMES.includes(configTimeframe)
      ? configTimeframe
      : DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe;
  const timeHorizon = Math.min(
    50,
    Math.max(
      2,
      Math.round(
        numberFrom(
          rayReplicaSettings.timeHorizon ?? parameters.timeHorizon,
          DEFAULT_STRATEGY_SIGNAL_SETTINGS.timeHorizon,
        ),
      ),
    ),
  );

  return {
    signalTimeframe,
    timeHorizon,
  };
};

export const mergeSignalOptionsProfile = (source) => {
  const config = asRecord(source);
  const signalOptions = asRecord(config.signalOptions);
  const rawProfile = Object.keys(signalOptions).length ? signalOptions : {};
  const parameters = asRecord(config.parameters);
  const profile = cloneProfile({
    ...SIGNAL_OPTIONS_DEFAULT_PROFILE,
    ...rawProfile,
    optionSelection: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.optionSelection,
      ...asRecord(rawProfile.optionSelection),
    },
    riskCaps: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.riskCaps,
      ...asRecord(rawProfile.riskCaps),
    },
    liquidityGate: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.liquidityGate,
      ...asRecord(rawProfile.liquidityGate),
    },
    entryGate: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate,
      ...asRecord(rawProfile.entryGate),
      mtfAlignment: {
        ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.mtfAlignment,
        ...asRecord(asRecord(rawProfile.entryGate).mtfAlignment),
      },
      bearishRegime: {
        ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.bearishRegime,
        ...asRecord(asRecord(rawProfile.entryGate).bearishRegime),
      },
    },
    fillPolicy: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.fillPolicy,
      ...asRecord(rawProfile.fillPolicy),
    },
    exitPolicy: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy,
      ...asRecord(rawProfile.exitPolicy),
    },
  });

  if (parameters.executionMode === "signal_options") {
    profile.optionSelection.minDte = numberFrom(
      parameters.signalOptionsMinDte,
      profile.optionSelection.minDte,
    );
    profile.optionSelection.maxDte = Math.max(
      profile.optionSelection.minDte,
      numberFrom(parameters.signalOptionsMaxDte, profile.optionSelection.maxDte),
    );
    profile.optionSelection.targetDte = Math.min(
      profile.optionSelection.maxDte,
      Math.max(
        profile.optionSelection.minDte,
        numberFrom(
          parameters.signalOptionsTargetDte,
          profile.optionSelection.targetDte,
        ),
      ),
    );
    profile.optionSelection.callStrikeSlot = numberFrom(
      parameters.signalOptionsCallStrikeSlot,
      profile.optionSelection.callStrikeSlot,
    );
    profile.optionSelection.putStrikeSlot = numberFrom(
      parameters.signalOptionsPutStrikeSlot,
      profile.optionSelection.putStrikeSlot,
    );
    profile.riskCaps.maxPremiumPerEntry = numberFrom(
      parameters.signalOptionsMaxPremium,
      profile.riskCaps.maxPremiumPerEntry,
    );
    profile.riskCaps.maxContracts = numberFrom(
      parameters.signalOptionsMaxContracts,
      profile.riskCaps.maxContracts,
    );
    profile.riskCaps.maxOpenSymbols = numberFrom(
      parameters.signalOptionsMaxOpenSymbols,
      profile.riskCaps.maxOpenSymbols,
    );
    profile.riskCaps.maxDailyLoss = numberFrom(
      parameters.signalOptionsMaxDailyLoss,
      profile.riskCaps.maxDailyLoss,
    );
    profile.liquidityGate.maxSpreadPctOfMid = numberFrom(
      parameters.signalOptionsMaxSpreadPct,
      profile.liquidityGate.maxSpreadPctOfMid,
    );
  }

  return profile;
};

export const buildExpandedSignalOptionsProfile = (profile) => {
  const currentProfile = cloneProfile(profile);
  return {
    ...currentProfile,
    riskCaps: {
      ...asRecord(currentProfile.riskCaps),
      ...SIGNAL_OPTIONS_EXPANDED_CAPACITY,
    },
  };
};

export const signalOptionsApi = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = payload?.detail || payload?.message || payload?.error || message;
    } catch {
      // best effort error body
    }
    throw new Error(message);
  }
  return response.json();
};

export const formatMoney = (value, digits = 0) =>
  Number.isFinite(Number(value))
    ? `$${Number(value).toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })}`
    : MISSING_VALUE;

export const formatPlainPrice = (value, digits = 2) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : MISSING_VALUE;

export const formatPct = (value, digits = 1) =>
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}%` : MISSING_VALUE;

export const formatChaseSteps = (steps) =>
  Array.isArray(steps)
    ? steps.map((step) => `${Math.round(Number(step) * 100)}`).join(", ")
    : "";

export const parseChaseSteps = (value, fallback = []) => {
  const parsed = String(value || "")
    .split(/[,\s/]+/)
    .map((item) => Number(item.trim().replace(/%$/, "")))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.min(1, Math.max(0, item > 1 ? item / 100 : item)));
  return parsed.length ? Array.from(new Set(parsed)).sort((a, b) => a - b) : fallback;
};

export const formatContractLabel = (contract) => {
  const label = formatOptionContractLabel(asRecord(contract), {
    includeSymbol: false,
    fallback: "",
  });
  return label || MISSING_VALUE;
};

export const signalOptionsActionColor = (status) => {
  if (status === "shadow_filled") return T.green;
  if (status === "manual_override" || status === "partial_shadow") return T.amber;
  if (status === "blocked" || status === "mismatch") return T.red;
  if (status === "closed") return T.textDim;
  return T.cyan;
};

export const cockpitStageColor = (status) => {
  if (status === "healthy") return T.green;
  if (status === "running") return T.cyan;
  if (status === "attention" || status === "stale") return T.amber;
  if (status === "blocked") return T.red;
  return T.textDim;
};

export const cockpitAttentionColor = (severity) => {
  if (severity === "critical") return T.red;
  if (severity === "warning") return T.amber;
  return T.cyan;
};

export const PROFILE_NUMBER_FIELDS = [
  ["optionSelection", "minDte", "Min DTE", 1],
  ["optionSelection", "targetDte", "Target DTE", 1],
  ["optionSelection", "maxDte", "Max DTE", 1],
  ["riskCaps", "maxPremiumPerEntry", "Max premium", 25],
  ["riskCaps", "maxContracts", "Max contracts", 1],
  ["riskCaps", "maxOpenSymbols", "Max open symbols", 1],
  ["riskCaps", "maxDailyLoss", "Daily halt", 50],
  ["liquidityGate", "maxSpreadPctOfMid", "Max spread %", 1],
  ["liquidityGate", "minBid", "Min bid", 0.01],
  ["fillPolicy", "ttlSeconds", "Fill TTL seconds", 1],
  ["exitPolicy", "hardStopPct", "Hard stop %", 1],
  ["exitPolicy", "trailActivationPct", "Trail activates %", 5],
  ["exitPolicy", "minLockedGainPct", "Minimum locked gain %", 5],
  ["exitPolicy", "trailGivebackPct", "Trail giveback %", 5],
  ["exitPolicy", "tightenAtFiveXGivebackPct", "5x giveback %", 5],
  ["exitPolicy", "tightenAtTenXGivebackPct", "10x giveback %", 5],
];

export const PROFILE_BOOLEAN_FIELDS = [
  ["optionSelection", "allowZeroDte", "Allow 0DTE"],
  ["liquidityGate", "requireBidAsk", "Require bid/ask"],
  ["liquidityGate", "requireFreshQuote", "Require fresh quote"],
  ["exitPolicy", "flipOnOppositeSignal", "Exit on opposite signal"],
];

export const compactButtonStyle = ({
  active = false,
  color = T.accent,
  fill = false,
  disabled = false,
} = {}) => ({
  padding: sp("6px 12px"),
  borderRadius: dim(RADII.pill),
  border: "none",
  background: active ? color : T.bg2,
  color: active ? T.onAccent : T.text,
  fontSize: textSize("caption"),
  fontFamily: T.sans,
  fontWeight: active ? 600 : 500,
  letterSpacing: "0.02em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  width: fill ? "100%" : "auto",
  whiteSpace: "nowrap",
});
