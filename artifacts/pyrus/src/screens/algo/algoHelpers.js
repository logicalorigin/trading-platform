import {
  formatEnumLabel,
  formatOptionContractLabel,
  formatSignedPercent,
} from "../../lib/formatters";
import {
  CSS_COLOR,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { resolveConfiguredMtfAlignment } from "../../features/signals/signalsRowModel.js";
import { normalizeTrendSignalDirection } from "../../features/signals/signalStateFreshness.js";

// Classifies an algo deployment by its control surface so the UI can route
// overnight/equity deployments to their own panel instead of the signal-options
// controls (answers the user's "which deployment am I controlling?"). Options =
// explicit signal_options execution mode; overnight/equity = an overnight-spot
// config block (config.overnightSpot -- the block the backend's
// resolveOvernightSpotProfile reads). Type only, independent of enabled/disabled,
// so a paused overnight deployment is still surfaced for control.
export const ALGO_DEPLOYMENT_KIND = {
  SIGNAL_OPTIONS: "signal_options",
  OVERNIGHT_SPOT: "overnight_spot",
  OTHER: "other",
};

export const ALGO_DEPLOYMENT_KIND_LABELS = {
  [ALGO_DEPLOYMENT_KIND.SIGNAL_OPTIONS]: "Options",
  [ALGO_DEPLOYMENT_KIND.OVERNIGHT_SPOT]: "Overnight",
  [ALGO_DEPLOYMENT_KIND.OTHER]: "Algo",
};

export const resolveAlgoDeploymentKind = (deployment) => {
  const config = deployment?.config ?? {};
  const parameters = config?.parameters ?? {};
  if (parameters?.executionMode === "signal_options") {
    return ALGO_DEPLOYMENT_KIND.SIGNAL_OPTIONS;
  }
  // Overnight config lives at config.overnightSpot or, in the parameters block,
  // at overnightSpotTrading (the canonical backend key resolved by
  // resolveOvernightSpotProfile) -- overnightSpot is accepted as a lenient alias.
  if (
    config?.overnightSpot != null ||
    parameters?.overnightSpotTrading != null ||
    parameters?.overnightSpot != null
  ) {
    return ALGO_DEPLOYMENT_KIND.OVERNIGHT_SPOT;
  }
  return ALGO_DEPLOYMENT_KIND.OTHER;
};

export const SIGNAL_OPTIONS_AGGRESSIVE_PROGRESSIVE_TRAIL_STEPS = [
  { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
  { activationPct: 30, minLockedGainPct: 15, givebackPct: 25 },
  { activationPct: 45, minLockedGainPct: 25, givebackPct: 20 },
  { activationPct: 65, minLockedGainPct: 40, givebackPct: 20 },
  { activationPct: 100, minLockedGainPct: 60, givebackPct: 15 },
];

export const SIGNAL_OPTIONS_DEFAULT_WIRE_TRAIL_RUNGS = [
  { activationPct: 35, rung: "wire3" },
  { activationPct: 65, rung: "wire2" },
  { activationPct: 100, rung: "wire1" },
  { activationPct: 200, rung: "trendLine" },
];

export const SIGNAL_OPTIONS_MTF_TIMEFRAMES = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
];

export const SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
];

export const SIGNAL_OPTIONS_MTF_PRESETS = [
  {
    value: "custom",
    label: "Custom",
    timeframes: SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES,
    requiredCount: SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES.length,
  },
  {
    value: "scalp",
    label: "Scalp",
    timeframes: ["1m", "2m", "5m"],
    requiredCount: 3,
  },
  {
    value: "balanced",
    label: "Balanced",
    timeframes: ["5m", "15m", "1h"],
    requiredCount: 3,
  },
  {
    value: "higher_timeframe",
    label: "Higher TF",
    timeframes: ["15m", "1h", "1d"],
    requiredCount: 3,
  },
  {
    value: "six_frame",
    label: "Six",
    timeframes: SIGNAL_OPTIONS_MTF_TIMEFRAMES,
    requiredCount: SIGNAL_OPTIONS_MTF_TIMEFRAMES.length,
  },
];

export const SIGNAL_OPTIONS_DEFAULT_PROFILE = {
  version: "v1",
  mode: "shadow",
  optionSelection: {
    minDte: 1,
    targetDte: 1,
    maxDte: 3,
    allowZeroDte: false,
    callStrikeSlots: [3],
    putStrikeSlots: [2],
    callStrikeSlot: 3,
    putStrikeSlot: 2,
  },
  riskCaps: {
    maxPremiumPerEntry: 1500,
    maxContracts: 3,
    maxOpenSymbols: 10,
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
      requiredCount: SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES.length,
      timeframes: SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES,
      preset: "custom",
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
  },
  fillPolicy: {
    chaseMode: "aggressive",
    ttlSeconds: 20,
    chaseSteps: [0, 0.35, 0.65, 0.9],
  },
  exitPolicy: {
    hardStopPct: -30,
    trailActivationPct: 35,
    minLockedGainPct: 15,
    trailGivebackPct: 20,
    progressiveTrailEnabled: true,
    progressiveTrailSteps: SIGNAL_OPTIONS_AGGRESSIVE_PROGRESSIVE_TRAIL_STEPS,
    wireGreekTrail: {
      enabled: true,
      requireFreshGreeks: true,
      greekMaxAgeMs: 15000,
      deltaSizingEnabled: false,
      runnerPollIntervalSeconds: 20,
      rungByProfit: SIGNAL_OPTIONS_DEFAULT_WIRE_TRAIL_RUNGS,
      deltaLoosenThreshold: 0.05,
      deltaTightenThreshold: -0.1,
      thetaBurdenTightenPct: 8,
      strongGammaMin: 0.05,
      spreadWideningMultiplier: 1.5,
    },
    flipOnOppositeSignal: true,
    earlyExitBars: 8,
    earlyExitLossPct: 25,
    overnightExitEnabled: true,
    overnightMinGainPct: 10,
    overnightRunnerGivebackPct: 15,
    conditionalQualityExitsEnabled: false,
    lowQualityEarlyExitBars: 4,
    lowQualityEarlyExitLossPct: 15,
    highQualityEarlyExitBars: 8,
    highQualityEarlyExitLossPct: 25,
    weakLiquidityTrailGivebackPct: 15,
    strongLiquidityTrailGivebackPct: 25,
    highQualityOvernightMinGainPct: -100,
  },
  riskHaltControls: {
    dailyLossHaltEnabled: true,
    openSymbolCapEnabled: true,
    premiumBudgetEnabled: true,
    tradingAllowanceEnabled: false,
  },
  entryHaltControls: {
    mtfAlignmentEnabled: true,
    inversePutBlocklistEnabled: true,
  },
  liquidityHaltControls: {
    bidAskRequiredEnabled: true,
    freshQuoteRequiredEnabled: true,
    spreadGateEnabled: true,
    minBidGateEnabled: true,
  },
  positionHaltControls: {
    sameDirectionPositionBlockEnabled: true,
    oppositeSignalFlipBlockEnabled: true,
    positionMarkFeedHaltEnabled: true,
  },
  infrastructureHaltControls: {
    gatewayReadinessBlockEnabled: true,
    resourcePressureScanBlockEnabled: true,
    contractResolutionBackoffEnabled: true,
  },
};

export const SIGNAL_OPTIONS_EXPANDED_CAPACITY = {
  maxOpenSymbols: 10,
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

export const MAX_SIGNAL_OPTIONS_STRIKE_SLOTS = 3;

export const normalizeSignalOptionsStrikeSlot = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(5, Math.max(0, Math.round(parsed)));
};

export const normalizeSignalOptionsStrikeSlots = (value, fallback) => {
  const source = Array.isArray(value) ? value : [value];
  const slots = [];
  for (const item of source) {
    const slot = normalizeSignalOptionsStrikeSlot(item);
    if (slot != null && !slots.includes(slot)) {
      slots.push(slot);
    }
    if (slots.length >= MAX_SIGNAL_OPTIONS_STRIKE_SLOTS) break;
  }
  if (slots.length) return slots;
  const fallbackSource = Array.isArray(fallback) ? fallback : [fallback];
  return normalizeSignalOptionsStrikeSlots(fallbackSource, [3]);
};

export const normalizeSignalOptionsProfileStrikeSlots = (profile) => {
  const optionSelection = asRecord(profile?.optionSelection);
  const callStrikeSlots = normalizeSignalOptionsStrikeSlots(
    optionSelection.callStrikeSlots,
    optionSelection.callStrikeSlot ??
      SIGNAL_OPTIONS_DEFAULT_PROFILE.optionSelection.callStrikeSlots,
  );
  const putStrikeSlots = normalizeSignalOptionsStrikeSlots(
    optionSelection.putStrikeSlots,
    optionSelection.putStrikeSlot ??
      SIGNAL_OPTIONS_DEFAULT_PROFILE.optionSelection.putStrikeSlots,
  );
  optionSelection.callStrikeSlots = callStrikeSlots;
  optionSelection.putStrikeSlots = putStrikeSlots;
  optionSelection.callStrikeSlot = callStrikeSlots[0];
  optionSelection.putStrikeSlot = putStrikeSlots[0];
  profile.optionSelection = optionSelection;
  return profile;
};

export const normalizeSignalOptionsMtfTimeframes = (
  value,
  fallback = SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES,
) => {
  const available = new Set(SIGNAL_OPTIONS_MTF_TIMEFRAMES);
  const source = Array.isArray(value) ? value : [];
  const timeframes = [];
  for (const item of source) {
    const timeframe = String(item || "").trim();
    if (available.has(timeframe) && !timeframes.includes(timeframe)) {
      timeframes.push(timeframe);
    }
  }
  return timeframes.length
    ? timeframes
    : [
        ...(Array.isArray(fallback) && fallback.length
          ? fallback
          : SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES),
      ];
};

export const normalizeSignalOptionsMtfPreset = (value) => {
  const preset = String(value || "").trim();
  return SIGNAL_OPTIONS_MTF_PRESETS.some((item) => item.value === preset)
    ? preset
    : "custom";
};

export const signalOptionsMtfPresetDefaults = (value) =>
  SIGNAL_OPTIONS_MTF_PRESETS.find((item) => item.value === value) ??
  SIGNAL_OPTIONS_MTF_PRESETS[0];

export const STRATEGY_SIGNAL_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"];
export const PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS = ["close", "wicks"];

export const DEFAULT_STRATEGY_SIGNAL_SETTINGS = {
  signalTimeframe: "5m",
  timeHorizon: 8,
  bosConfirmation: "wicks",
  chochAtrBuffer: 0,
  chochBodyExpansionAtr: 0,
  chochVolumeGate: 0,
};

export const normalizeStrategySignalTimeframe = (
  value,
  fallback = DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe,
) => {
  const timeframe = String(value || "").trim();
  if (STRATEGY_SIGNAL_TIMEFRAMES.includes(timeframe)) return timeframe;
  const fallbackTimeframe = String(fallback || "").trim();
  return STRATEGY_SIGNAL_TIMEFRAMES.includes(fallbackTimeframe)
    ? fallbackTimeframe
    : DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe;
};

export const normalizeStrategySignalTimeframes = (value, fallback) => {
  const source = Array.isArray(value) ? value : [value];
  const timeframes = [];
  source.forEach((item) => {
    const timeframe = normalizeStrategySignalTimeframe(item, "");
    if (timeframe && !timeframes.includes(timeframe)) {
      timeframes.push(timeframe);
    }
  });
  return timeframes.length
    ? timeframes
    : [normalizeStrategySignalTimeframe(fallback)];
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
  position_mark_feed_degraded: "marking",
  invalid_position_mark: "marking",
  no_contract_for_strike_slot: "contract_resolution",
  no_expiration_in_dte_window: "contract_resolution",
  option_chain_stale: "contract_resolution",
  option_strike_off_money: "contract_resolution",
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
  premium_budget_too_small: "risk",
  quantity_below_minimum: "risk",
  algo_gateway_not_ready: "gateway",
  accounts_unavailable: "gateway",
  bridge_health_unavailable: "gateway",
  ibkr_not_configured: "gateway",
  gateway_login_required: "gateway",
  gateway_socket_disconnected: "gateway",
  gateway_not_ready: "gateway",
  bridge_unavailable: "gateway",
  live_market_data_not_configured: "gateway",
  market_session_quiet: "gateway",
  mtf_not_aligned: "signal_policy",
  inverse_put_blocked: "signal_policy",
  entry_gate_failed: "signal_policy",
  same_direction_position_open: "signal_policy",
  opposite_signal_flip_disabled: "signal_policy",
  candidate_resolution_failed: "signal_policy",
  signal_age_unavailable: "signal_policy",
  signal_too_old: "signal_policy",
  // Data-freshness blockers are feed/session conditions (like
  // market_session_quiet above), not policy verdicts on the signal itself —
  // keeping them out of signal_policy preserves the stale-vs-aged distinction
  // the backend actionability logic enforces.
  data_stale: "gateway",
  market_idle: "gateway",
  market_closed: "gateway",
};

export const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const EMPTY_STA_ACTION_ITEMS = Object.freeze([]);

const normalizeMatchKey = (value) => String(value || "").trim();
const normalizeMatchToken = (value) => normalizeMatchKey(value).toUpperCase();

const staSourceArray = (value) =>
  Array.isArray(value) ? value : EMPTY_STA_ACTION_ITEMS;

const staSourceTimestampMs = (item) => {
  const record = asRecord(item);
  return Math.max(
    Date.parse(record.updatedAt || "") || 0,
    Date.parse(record.createdAt || "") || 0,
    Date.parse(record.generatedAt || "") || 0,
    Date.parse(record.evaluatedAt || "") || 0,
    Date.parse(record.signalAt || "") || 0,
    Date.parse(record.currentSignalAt || "") || 0,
    Date.parse(record.lastEvaluatedAt || "") || 0,
    Date.parse(record.latestBarAt || "") || 0,
  );
};

const staSourceLatestTimestampMs = (source, arrays) =>
  Math.max(
    staSourceTimestampMs(source),
    ...arrays.flatMap((items) => items.map(staSourceTimestampMs)),
  );

const staSourceRowsLatestTimestampMs = (arrays) =>
  Math.max(0, ...arrays.flatMap((items) => items.map(staSourceTimestampMs)));

const buildStaActionSourceSnapshot = (sourceName, source) => {
  const record = asRecord(source);
  const signals = staSourceArray(record.signals);
  const candidates = staSourceArray(record.candidates);
  const activePositions = staSourceArray(record.activePositions);
  const rowCount = signals.length + candidates.length + activePositions.length;
  const reason = normalizeMatchKey(record.reason).toLowerCase();
  // "Served from stored monitor state" (cacheStatus="stale") is the SSE-era
  // default, not a degraded source — it no longer marks a source transient.
  // Genuine failures still surface via record.stale/degraded/refreshing/timeout.
  const transient = Boolean(
    record.stale === true ||
      record.degraded === true ||
      record.refreshing === true ||
      reason.includes("timeout"),
  );
  return {
    source: sourceName,
    signals,
    candidates,
    activePositions,
    rowCount,
    latestMs: staSourceRowsLatestTimestampMs([
      signals,
      candidates,
      activePositions,
    ]),
    hasRows: rowCount > 0,
    transient,
  };
};

const chooseStaActionSourceSnapshot = (snapshots) =>
  snapshots
    .filter((snapshot) => snapshot.hasRows && !snapshot.transient)
    .sort(
      (left, right) =>
        right.latestMs - left.latestMs ||
        right.rowCount - left.rowCount ||
        (left.source === "cockpit" ? -1 : 1),
    )[0] || null;

const staActionSourceHealth = ({
  source,
  stale = false,
  degraded = false,
  failedSources = [],
  currentSource = null,
} = {}) => ({
  source,
  stale: Boolean(stale),
  degraded: Boolean(degraded),
  failedSources,
  currentSource,
});

export const resolveStableStaActionSnapshot = ({
  cockpit = null,
  signalOptionsState = null,
  cockpitFailed = false,
  signalOptionsStateFailed = false,
} = {}) => {
  const cockpitSnapshot = buildStaActionSourceSnapshot("cockpit", cockpit);
  const stateSnapshot = buildStaActionSourceSnapshot(
    "state",
    signalOptionsState,
  );
  const failedSources = [
    cockpitFailed ? "cockpit" : null,
    signalOptionsStateFailed ? "state" : null,
  ].filter(Boolean);
  const currentSnapshot = chooseStaActionSourceSnapshot(
    [cockpitSnapshot, stateSnapshot].filter(
      (snapshot) => !failedSources.includes(snapshot.source),
    ),
  );
  const staleSources = [cockpitSnapshot, stateSnapshot]
    .filter(
      (snapshot) =>
        !failedSources.includes(snapshot.source) &&
        snapshot.hasRows &&
        snapshot.transient,
    )
    .map((snapshot) => snapshot.source);

  if (currentSnapshot) {
    return {
      source: currentSnapshot.source,
      signals: currentSnapshot.signals,
      candidates: currentSnapshot.candidates,
      activePositions: currentSnapshot.activePositions,
      cacheable: true,
      sourceHealth: staActionSourceHealth({
        source: currentSnapshot.source,
        failedSources,
      }),
    };
  }

  return {
    source: "empty",
    signals: EMPTY_STA_ACTION_ITEMS,
    candidates: EMPTY_STA_ACTION_ITEMS,
    activePositions: EMPTY_STA_ACTION_ITEMS,
    cacheable: !failedSources.length,
    sourceHealth: staActionSourceHealth({
      source: "empty",
      stale: Boolean(staleSources.length),
      degraded: Boolean(failedSources.length || staleSources.length),
      failedSources: [...failedSources, ...staleSources],
    }),
  };
};

const signalRowExactKey = (signal, fallbackId) => {
  const signalRecord = asRecord(signal);
  const signalKey = normalizeMatchKey(signalRecord.signalKey);
  if (signalKey) return `key:${signalKey}`;
  return signalRowIdentityKey(signalRecord, fallbackId);
};

const signalRowIdentityKey = (signal, fallbackId) => {
  const signalRecord = asRecord(signal);
  const identityParts = [
    normalizeMatchToken(signalRecord.symbol),
    normalizeMatchToken(signalRecord.timeframe),
    normalizeMatchToken(signalRecord.direction),
    normalizeMatchKey(signalRecord.signalAt),
  ];
  const identityKey = identityParts.join("|");
  return identityParts[0] && identityParts[3]
    ? identityKey
    : `${identityKey}|${fallbackId ? normalizeMatchKey(fallbackId) : ""}`;
};

const signalRowDedupeKeys = (signal, fallbackId) => {
  const exactKey = signalRowExactKey(signal, fallbackId);
  const identityKey = signalRowIdentityKey(signal, fallbackId);
  return [...new Set([exactKey, identityKey].filter(Boolean))];
};

const signalRowFamilyKey = (signal) => {
  const signalRecord = asRecord(signal);
  const identityParts = [
    normalizeMatchToken(signalRecord.symbol),
    normalizeMatchToken(signalRecord.timeframe),
    normalizeMatchToken(signalRecord.direction),
  ];
  return identityParts.every(Boolean) ? identityParts.join("|") : "";
};

const signalRowTimestampMs = (...values) => {
  for (const value of values) {
    const parsed = Date.parse(value || "");
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const signalRowSignalTimestampMs = (signal) => {
  const signalRecord = asRecord(signal);
  return Math.max(
    Date.parse(signalRecord.signalAt || "") || 0,
    Date.parse(signalRecord.currentSignalAt || "") || 0,
  );
};

const normalizeStaRowSignalDirection = (direction) => {
  const value = String(direction || "").trim().toLowerCase();
  if (value === "buy" || value === "long" || value === "bullish") return "buy";
  if (value === "sell" || value === "short" || value === "bearish") return "sell";
  return null;
};

// Shared STA row gate: the table and algo monitor sidebar must agree on which
// matrix rows are actionable enough to show after the deployment's MTF filter.
export const staRowPassesMtfAlignment = (
  row,
  signalMatrixBySymbol,
  mtfAlignmentConfig,
) => {
  const signalRecord = asRecord(row?.signal ?? row);
  const symbolUpper = String(signalRecord.symbol || "").trim().toUpperCase();
  const timeframes = Array.isArray(mtfAlignmentConfig?.timeframes)
    ? mtfAlignmentConfig.timeframes
        .map((timeframe) => String(timeframe || "").trim())
        .filter(Boolean)
    : [];
  const rowTimeframe = String(signalRecord.timeframe || "").trim();
  if (
    mtfAlignmentConfig?.enabled !== false &&
    timeframes.length === 1 &&
    timeframes[0] === rowTimeframe &&
    normalizeStaRowSignalDirection(signalRecord.direction)
  ) {
    return true;
  }
  const result = resolveConfiguredMtfAlignment({
    matrixStatesByTimeframe: signalMatrixBySymbol?.[symbolUpper] || {},
    signalDirection: normalizeStaRowSignalDirection(signalRecord.direction),
    timeframes,
    requiredCount: numberFrom(mtfAlignmentConfig?.requiredCount, timeframes.length),
    enabled: mtfAlignmentConfig?.enabled !== false,
  });
  return !(result.applicable && !result.aligned);
};

const signalRowActivityTimestampMs = (signal) => {
  const signalRecord = asRecord(signal);
  return Math.max(
    signalRowSignalTimestampMs(signalRecord),
    Date.parse(signalRecord.latestBarAt || "") || 0,
    Date.parse(signalRecord.updatedAt || "") || 0,
    Date.parse(signalRecord.lastEvaluatedAt || "") || 0,
  );
};

const signalRowsHaveCompatibleSignalAt = (
  signalRecord,
  candidateRecord,
  candidateSignal,
) => {
  const signalMs = signalRowTimestampMs(
    signalRecord.signalAt,
    signalRecord.currentSignalAt,
  );
  const candidateMs = signalRowTimestampMs(
    candidateRecord.signalAt,
    candidateRecord.currentSignalAt,
    candidateSignal.signalAt,
    candidateSignal.currentSignalAt,
  );
  return !signalMs || !candidateMs || signalMs === candidateMs;
};

const staFiniteNumberOrNull = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const staIsoStringOrNull = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? text : null;
};

const signalMonitorEventSignalKey = (event, signalAt) => {
  const eventRecord = asRecord(event);
  const profileId = normalizeMatchKey(eventRecord.profileId);
  const symbol = normalizeMatchToken(eventRecord.symbol);
  const timeframe = normalizeMatchKey(eventRecord.timeframe);
  const direction = normalizeMatchKey(eventRecord.direction);
  if (!profileId || !symbol || !timeframe || !direction || !signalAt) {
    return null;
  }
  return [profileId, symbol, timeframe, direction, signalAt].join(":");
};

const normalizeStaSignalTimeframes = (timeframes = []) => {
  const normalized = Array.from(
    new Set(
      (Array.isArray(timeframes) ? timeframes : [])
        .map((timeframe) => normalizeMatchKey(timeframe))
        .filter((timeframe) => STRATEGY_SIGNAL_TIMEFRAMES.includes(timeframe)),
    ),
  );
  return normalized.length ? normalized : [...STRATEGY_SIGNAL_TIMEFRAMES];
};

const staSignalDirectionOrNull = (value) => {
  const normalized = normalizeMatchKey(value).toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : null;
};

const signalMatrixStateSignalKey = (state, signalAt, direction) => {
  const stateRecord = asRecord(state);
  const existingKey = normalizeMatchKey(stateRecord.signalKey);
  if (existingKey) return existingKey;
  const eventId = normalizeMatchKey(stateRecord.eventId);
  if (eventId) return `event:${eventId}`;
  const symbol = normalizeMatchToken(stateRecord.symbol);
  const timeframe = normalizeMatchKey(stateRecord.timeframe);
  if (!symbol || !timeframe || !direction || !signalAt) return null;
  return [
    normalizeMatchKey(stateRecord.profileId) || "signal-matrix",
    symbol,
    timeframe,
    direction,
    signalAt,
  ].join(":");
};

export const buildStaSignalMatrixRows = ({
  signalMatrixStates,
  universeSymbols,
  timeframes,
} = {}) => {
  const universe = new Set(
    (Array.isArray(universeSymbols) ? universeSymbols : [])
      .map((symbol) => normalizeMatchToken(symbol))
      .filter(Boolean),
  );
  const selectedTimeframes = new Set(normalizeStaSignalTimeframes(timeframes));

  return (Array.isArray(signalMatrixStates) ? signalMatrixStates : [])
    .map((state) => {
      const stateRecord = asRecord(state);
      if (stateRecord.active === false) return null;
      const symbol = normalizeMatchToken(stateRecord.symbol);
      const timeframe = normalizeMatchKey(stateRecord.timeframe);
      if (
        !symbol ||
        !selectedTimeframes.has(timeframe) ||
        (universe.size && !universe.has(symbol))
      ) {
        return null;
      }
      const direction = staSignalDirectionOrNull(
        stateRecord.currentSignalDirection || stateRecord.direction,
      );
      const signalAt =
        staIsoStringOrNull(stateRecord.currentSignalAt) ??
        staIsoStringOrNull(stateRecord.signalAt);
      const latestBarAt =
        staIsoStringOrNull(stateRecord.latestBarAt) ??
        staIsoStringOrNull(stateRecord.lastEvaluatedAt) ??
        signalAt;
      if (!direction || !latestBarAt) {
        return null;
      }

      const status = normalizeMatchKey(
        stateRecord.status || "ok",
      ).toLowerCase();
      const signalLevelPrice =
        staFiniteNumberOrNull(stateRecord.currentSignalPrice) ??
        staFiniteNumberOrNull(stateRecord.signalPrice);
      const signalClose =
        staFiniteNumberOrNull(stateRecord.currentSignalClose) ??
        staFiniteNumberOrNull(stateRecord.signalClose) ??
        staFiniteNumberOrNull(stateRecord.signalBarClose);
      const currentSignalMfePercent = staFiniteNumberOrNull(
        stateRecord.currentSignalMfePercent,
      );
      const currentSignalMaePercent = staFiniteNumberOrNull(
        stateRecord.currentSignalMaePercent,
      );
      // Current price as of the last evaluation (close of the bar at
      // latestBarAt). Lets the Move column render immediately from the matrix
      // state instead of waiting on per-page sparkline hydration, so it stays
      // populated across execution-timeframe changes. Live quote/sparkline
      // snapshots still override this in resolveSignalMove when present.
      const latestBarClose = staFiniteNumberOrNull(stateRecord.latestBarClose);
      const currentPrice =
        staFiniteNumberOrNull(stateRecord.currentPrice) ?? latestBarClose;
      const barsSinceSignal = staFiniteNumberOrNull(
        stateRecord.barsSinceSignal,
      );
      const fresh = stateRecord.fresh === true;
      // Actionability is backend-authored (SSE matrix stream + REST both
      // carry it). A state without the fields is ineligible by default —
      // the safe direction; no client-side age inference remains.
      const actionBlocker = normalizeMatchKey(stateRecord.actionBlocker) || null;
      const actionEligible =
        stateRecord.actionEligible === true && Boolean(direction && signalAt);

      return {
        profileId: normalizeMatchKey(stateRecord.profileId) || null,
        signalKey: signalMatrixStateSignalKey(stateRecord, signalAt, direction),
        source: normalizeMatchKey(stateRecord.source) || "signal-matrix",
        sourceType:
          normalizeMatchKey(stateRecord.sourceType) || "signal_matrix_state",
        eventId: normalizeMatchKey(stateRecord.eventId) || null,
        symbol,
        timeframe,
        direction,
        trendDirection:
          normalizeTrendSignalDirection(stateRecord.trendDirection) ||
          normalizeTrendSignalDirection(
            asRecord(stateRecord.indicatorSnapshot).trendDirection,
          ) ||
          null,
        signalAt,
        currentSignalAt: signalAt,
        signalPrice: signalClose,
        signalClose,
        signalBarClose: signalClose,
        currentSignalClose: signalClose,
        currentSignalMfePercent,
        currentSignalMaePercent,
        signalLevelPrice,
        currentSignalPrice: signalLevelPrice,
        currentPrice,
        latestBarClose: latestBarClose ?? currentPrice,
        latestBarAt,
        barsSinceSignal,
        fresh,
        actionEligible,
        actionBlocker: actionEligible ? null : actionBlocker,
        status,
        // Live SSE deltas carry mtfDirections/adx under indicatorSnapshot.filterState.
        // Stored rows may instead hold it top-level. Source either, else the score
        // falls to its all-defaults fallback (the "every row is 46.4" bug).
        filterState: Object.keys(asRecord(stateRecord.filterState)).length
          ? asRecord(stateRecord.filterState)
          : Object.keys(
                asRecord(asRecord(stateRecord.indicatorSnapshot).filterState),
              ).length
            ? asRecord(asRecord(stateRecord.indicatorSnapshot).filterState)
            : null,
        updatedAt: staIsoStringOrNull(stateRecord.lastEvaluatedAt),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = Date.parse(left.signalAt || "") || 0;
      const rightTime = Date.parse(right.signalAt || "") || 0;
      return rightTime - leftTime;
    });
};

export const buildStaSignalHistoryRows = ({
  signalEvents,
  universeSymbols,
  timeframes,
} = {}) => {
  const universe = new Set(
    (Array.isArray(universeSymbols) ? universeSymbols : [])
      .map((symbol) => normalizeMatchToken(symbol))
      .filter(Boolean),
  );
  const selectedTimeframes = new Set(normalizeStaSignalTimeframes(timeframes));

  return (Array.isArray(signalEvents) ? signalEvents : [])
    .map((event) => {
      const eventRecord = asRecord(event);
      const signalAt = staIsoStringOrNull(eventRecord.signalAt);
      const symbol = normalizeMatchToken(eventRecord.symbol);
      const timeframe = normalizeMatchKey(eventRecord.timeframe) || "5m";
      if (!signalAt || !symbol) {
        return null;
      }
      if (universe.size && !universe.has(symbol)) {
        return null;
      }
      if (!selectedTimeframes.has(timeframe)) {
        return null;
      }

      const payload = asRecord(eventRecord.payload);
      const filterState = asRecord(payload.filterState);
      const signalLevelPrice = staFiniteNumberOrNull(eventRecord.signalPrice);
      const signalClose = staFiniteNumberOrNull(eventRecord.close);
      const latestBarAt =
        staIsoStringOrNull(payload.latestBarAt) ??
        staIsoStringOrNull(payload.signalBarAt) ??
        staIsoStringOrNull(payload.latestBarAnchorAt) ??
        staIsoStringOrNull(eventRecord.emittedAt) ??
        signalAt;
      const eventId = normalizeMatchKey(eventRecord.id);

      return {
        profileId: normalizeMatchKey(eventRecord.profileId) || null,
        signalKey:
          signalMonitorEventSignalKey(eventRecord, signalAt) ||
          (eventId ? `event:${eventId}` : null),
        source: normalizeMatchKey(eventRecord.source) || "pyrus-signals",
        sourceType: "signal_monitor_event",
        eventId: eventId || null,
        symbol,
        timeframe,
        direction: normalizeMatchKey(eventRecord.direction) || null,
        signalAt,
        currentSignalAt: signalAt,
        signalPrice: signalClose,
        signalClose,
        signalBarClose: signalClose,
        currentSignalClose: signalClose,
        signalLevelPrice,
        currentSignalPrice: signalLevelPrice,
        close: signalClose,
        latestBarAt,
        barsSinceSignal: null,
        fresh: false,
        actionEligible: false,
        actionBlocker: "historical_signal",
        status: "history",
        filterState: Object.keys(filterState).length ? filterState : null,
        emittedAt: staIsoStringOrNull(eventRecord.emittedAt),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = Date.parse(left.signalAt || "") || 0;
      const rightTime = Date.parse(right.signalAt || "") || 0;
      return rightTime - leftTime;
    });
};

export const buildVisibleSignalRows = ({
  signalMatrixStates,
  signalTimeframes,
  signalActionTimeframes,
  universeSymbols,
} = {}) => {
  const rows = [];
  const seen = new Set();
  const visibleSignalFamilies = new Set();
  const matrixSignals = buildStaSignalMatrixRows({
    signalMatrixStates,
    universeSymbols,
    timeframes: signalActionTimeframes ?? signalTimeframes,
  });

  const addRow = (signal, fallbackId = null) => {
    const signalRecord = asRecord(signal);
    const keys = signalRowDedupeKeys(signalRecord, fallbackId);
    if (!keys.length || keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    rows.push(signalRecord);
    return true;
  };

  // The live SSE Signal Matrix is the SOLE source of STA action rows (already
  // filtered to the execution/action timeframe, so MTF companions never leak in).
  // Signal-options does NOT produce signals — it only evaluates matrix signals
  // against the algo's rules to find a contract or skip — so every candidate has a
  // backing matrix signal and the poll is never needed as a row source. Each matrix
  // row resolves its tradeable Signal Options candidate at render
  // (findSignalOptionsCandidateForSignal), so the act-on-signal/order path is
  // unaffected. Ranking the poll above the matrix is what made STA lag by minutes.
  matrixSignals.forEach((signal) => {
    const familyKey = signalRowFamilyKey(signal);
    if (familyKey && visibleSignalFamilies.has(familyKey)) return;
    if (addRow(signal)) {
      if (familyKey) visibleSignalFamilies.add(familyKey);
    }
  });

  // Collapse to one row per (symbol, timeframe). The live Signal Matrix owns
  // current/action cells; received history is kept out of this action surface.
  const collapsedByCell = new Map();
  rows.forEach((row) => {
    const symbol = normalizeMatchToken(row.symbol);
    const timeframe = normalizeMatchToken(row.timeframe);
    const cell = symbol && timeframe ? `${symbol}|${timeframe}` : "";
    if (!cell) return;
    const current = collapsedByCell.get(cell);
    if (!current) {
      collapsedByCell.set(cell, row);
      return;
    }
    const rowIsMatrix = row.sourceType === "signal_matrix_state";
    const currentIsMatrix = current.sourceType === "signal_matrix_state";
    if (currentIsMatrix && !rowIsMatrix) return;
    if (
      (rowIsMatrix && !currentIsMatrix) ||
      signalRowSignalTimestampMs(row) > signalRowSignalTimestampMs(current)
    ) {
      collapsedByCell.set(cell, row);
    }
  });

  return Array.from(collapsedByCell.values()).sort(
    (left, right) =>
      signalRowSignalTimestampMs(right) - signalRowSignalTimestampMs(left) ||
      signalRowActivityTimestampMs(right) - signalRowActivityTimestampMs(left) ||
      normalizeMatchToken(left.symbol).localeCompare(normalizeMatchToken(right.symbol)),
  );
};

const hasStaActionPayload = (candidate) =>
  Object.keys(asRecord(asRecord(candidate).action)).length > 0;

const hasStaSelectedContract = (candidate) =>
  Object.keys(asRecord(asRecord(candidate).selectedContract)).length > 0;

const keepPipelineAlertStatus = (status) =>
  ["blocked", "attention", "running", "stale"].includes(status);

const livePipelineStatus = (count, fallbackStatus) =>
  Number(count) > 0 && !keepPipelineAlertStatus(fallbackStatus)
    ? "healthy"
    : fallbackStatus;

const STA_PIPELINE_STAGE_FALLBACKS = Object.freeze({
  scan_universe: {
    id: "scan_universe",
    label: "Signal Symbols",
    status: "waiting",
    count: 0,
  },
  signal_detected: {
    id: "signal_detected",
    label: "Signal Received",
    status: "waiting",
    count: 0,
    detail: "awaiting live STA rows",
  },
  action_mapped: {
    id: "action_mapped",
    label: "Action Mapped",
    status: "waiting",
    count: 0,
    detail: "waiting for buy-call or buy-put mapping",
  },
  contract_selected: {
    id: "contract_selected",
    label: "Contract Selected",
    status: "waiting",
    count: 0,
    detail: "waiting for contract selection",
  },
});

export const mergeStaSignalPipelineStages = ({
  stages = [],
  signalRows = [],
  deploymentSymbolUniverse = [],
  candidates = [],
  scanFallback = {},
  signalMatrixFreshnessDetail = null,
  signalSourcePolicy = null,
} = {}) => {
  const liveSignalRows = Array.isArray(signalRows) ? signalRows : [];
  const candidateRows = Array.isArray(candidates) ? candidates : [];
  const universeCount = Array.isArray(deploymentSymbolUniverse)
    ? deploymentSymbolUniverse.length
    : 0;
  const liveSignalCount = liveSignalRows.length;
  const actionMappedCount = candidateRows.filter(hasStaActionPayload).length;
  const selectedContractCount = candidateRows.filter(
    hasStaSelectedContract,
  ).length;

  const hydrateStage = (stage) => {
    const record = asRecord(stage);
    if (record.id === "scan_universe") {
      return {
        ...record,
        count: universeCount || record.count || 0,
        lastSignalScanAt:
          scanFallback.lastSignalScanAt || record.lastSignalScanAt || null,
        latestSignalBarAt:
          scanFallback.latestSignalBarAt || record.latestSignalBarAt || null,
        latestSignalAt:
          scanFallback.latestSignalAt || record.latestSignalAt || null,
        pollIntervalMs:
          scanFallback.pollIntervalMs ?? record.pollIntervalMs ?? null,
        signalSourcePolicy:
          signalSourcePolicy || record.signalSourcePolicy || null,
        detail: signalMatrixFreshnessDetail || record.detail,
      };
    }
    if (record.id === "signal_detected") {
      return {
        ...record,
        status: livePipelineStatus(liveSignalCount, record.status),
        count: liveSignalCount,
        latestAt: scanFallback.latestSignalAt || record.latestAt || null,
        detail: liveSignalCount
          ? `${liveSignalCount} live STA rows from Signal Matrix`
          : record.detail,
      };
    }
    if (record.id === "action_mapped") {
      return {
        ...record,
        status: livePipelineStatus(actionMappedCount, record.status),
        count: actionMappedCount,
      };
    }
    if (record.id === "contract_selected") {
      return {
        ...record,
        status: livePipelineStatus(selectedContractCount, record.status),
        count: selectedContractCount,
      };
    }
    return record;
  };
  const mergedStages = (Array.isArray(stages) ? stages : []).map(hydrateStage);
  const mergedIds = new Set(mergedStages.map((stage) => asRecord(stage).id));
  [
    "scan_universe",
    "signal_detected",
    "action_mapped",
    "contract_selected",
  ].forEach((stageId) => {
    if (mergedIds.has(stageId)) {
      return;
    }
    mergedStages.push(hydrateStage(STA_PIPELINE_STAGE_FALLBACKS[stageId]));
  });
  return mergedStages;
};

export const findSignalOptionsCandidateForSignal = (candidates, signal) => {
  const signalRecord = asRecord(signal);
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const signalKey = normalizeMatchKey(signalRecord.signalKey);
  if (signalKey) {
    const keyed = candidateList.find((candidate) => {
      const candidateRecord = asRecord(candidate);
      const candidateSignal = asRecord(candidateRecord.signal);
      return [
        candidateSignal.signalKey,
        candidateRecord.signalKey,
        candidateRecord.id,
      ].some((value) => normalizeMatchKey(value) === signalKey);
    });
    if (keyed) return keyed;
  }

  const signalSymbol = normalizeMatchToken(signalRecord.symbol);
  if (!signalSymbol) return null;
  const signalTimeframe = normalizeMatchToken(signalRecord.timeframe);
  const signalDirection = normalizeMatchToken(signalRecord.direction);

  return (
    candidateList.find((candidate) => {
      const candidateRecord = asRecord(candidate);
      const candidateSignal = asRecord(candidateRecord.signal);
      const candidateSymbol = normalizeMatchToken(
        candidateRecord.symbol || candidateSignal.symbol,
      );
      if (candidateSymbol !== signalSymbol) return false;

      const candidateTimeframe = normalizeMatchToken(
        candidateRecord.timeframe || candidateSignal.timeframe,
      );
      if (
        signalTimeframe &&
        candidateTimeframe &&
        signalTimeframe !== candidateTimeframe
      ) {
        return false;
      }

      const candidateDirection = normalizeMatchToken(
        candidateRecord.direction || candidateSignal.direction,
      );
      if (
        signalDirection &&
        candidateDirection &&
        signalDirection !== candidateDirection
      ) {
        return false;
      }

      return signalRowsHaveCompatibleSignalAt(
        signalRecord,
        candidateRecord,
        candidateSignal,
      );
    }) || null
  );
};

export const shadowLinkSummary = (shadowLink) => {
  const link = asRecord(shadowLink);
  if (!Object.keys(link).length) return "No Shadow ledger link";
  const parts = [
    link.orderId ? "order linked" : null,
    link.fillId ? "fill linked" : null,
    link.positionId ? "position linked" : null,
    link.attributionStatus
      ? String(link.attributionStatus).replace(/_/g, " ")
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Shadow ledger link pending";
};

export const signalActionLabel = (signal, action) => {
  const signalRecord = asRecord(signal);
  const actionRecord = asRecord(action);
  const direction = signalRecord.direction || actionRecord.signalDirection;
  const optionAction = actionRecord.optionAction;
  // Direction voice is LONG/SHORT; the instrument (call/put contract) is
  // implementation detail — buy_call/buy_put map onto it rather than echoing
  // the enum.
  if (optionAction === "buy_call") return "LONG";
  if (optionAction === "buy_put") return "SHORT";
  if (optionAction) return formatEnumLabel(optionAction).toUpperCase();
  if (direction === "sell") return "SHORT";
  if (direction === "buy") return "LONG";
  return MISSING_VALUE;
};

export const isMarketIdleSignalRecord = (record) => {
  const status = String(record.status || "")
    .trim()
    .toLowerCase();
  const actionBlocker = String(record.actionBlocker || "")
    .trim()
    .toLowerCase();
  return status === "idle" || actionBlocker === "market_idle";
};

export const signalFreshnessLabel = (signal) => {
  const signalRecord = asRecord(signal);
  if (isMarketIdleSignalRecord(signalRecord)) return "IDLE";
  const actionBlocker = normalizeMatchKey(signalRecord.actionBlocker).toLowerCase();
  // Prefer the row's already-resolved (trend-first) direction so a trending
  // cell with no fresh crossover is not mislabeled "NO SIGNAL".
  const direction = staSignalDirectionOrNull(
    signalRecord.direction || signalRecord.currentSignalDirection,
  );
  if (actionBlocker === "no_signal" && !direction) return "NO SIGNAL";
  if (signalRecord.fresh === true) return "FRESH";
  if (signalRecord.fresh === false) return "STALE";
  return MISSING_VALUE;
};

export const signalBarsSinceLabel = (signal) => {
  // Reject null/"" before coercion: Number(null) === 0 is finite, which would
  // render "0 bars" for a signal that has no crossover bar count at all.
  const barsSinceSignal = asRecord(signal).barsSinceSignal;
  if (barsSinceSignal == null || barsSinceSignal === "") return MISSING_VALUE;
  const bars = Number(barsSinceSignal);
  return Number.isFinite(bars) ? `${bars} bars` : MISSING_VALUE;
};

export const signalFilterStateLabel = (signal) => {
  const filterState = asRecord(asRecord(signal).filterState);
  const entries = Object.entries(filterState)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    )
    .slice(0, 3)
    .map(([key, value]) => `${formatEnumLabel(key)} ${String(value)}`);
  return entries.length ? entries.join(" / ") : MISSING_VALUE;
};

export const cloneProfile = (profile) =>
  JSON.parse(JSON.stringify(profile || SIGNAL_OPTIONS_DEFAULT_PROFILE));

export const signalOptionsActionLabel = (status) =>
  SIGNAL_OPTIONS_ACTION_LABELS[status] ||
  formatEnumLabel(status || "candidate");

export const formatLiquidityReason = (reason) =>
  SIGNAL_OPTIONS_LIQUIDITY_REASON_LABELS[reason] ||
  formatEnumLabel(reason || "liquidity_gate_failed");

export const formatLiquidityFreshness = (value) => {
  const freshness = String(value || "").trim();
  return freshness ? formatEnumLabel(freshness) : MISSING_VALUE;
};

export const candidateBlockerLabel = (candidate) => {
  const reason = String(asRecord(candidate).reason || "").trim();
  return reason ? formatEnumLabel(reason) : MISSING_VALUE;
};

export const signalActionBlockerLabel = (signal) => {
  const reason = String(asRecord(signal).actionBlocker || "").trim();
  return reason ? formatEnumLabel(reason) : MISSING_VALUE;
};

export const candidateLatestActivityLabel = (candidate) => {
  const timeline = Array.isArray(asRecord(candidate).timeline)
    ? asRecord(candidate).timeline
    : [];
  const latest = asRecord(timeline[timeline.length - 1]);
  const summary = String(latest.summary || "").trim();
  if (summary) return summary;
  const type = String(latest.type || "").trim();
  return type ? formatEnumLabel(type) : MISSING_VALUE;
};

export const entryQualityLabel = (quality) => {
  const record = asRecord(quality);
  const tier = String(record.tier || "").trim();
  const score = Number(record.score);
  if (!tier && !Number.isFinite(score)) return MISSING_VALUE;
  const parts = [
    tier ? formatEnumLabel(tier) : null,
    Number.isFinite(score) ? score.toFixed(1) : null,
  ].filter(Boolean);
  return parts.join(" · ");
};

const clampMetric = (value, min, max) => Math.min(max, Math.max(min, value));

const finiteNumberOrNull = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const firstFiniteMetric = (...values) => {
  for (const value of values) {
    const numeric = finiteNumberOrNull(value);
    if (numeric != null) return numeric;
  }
  return null;
};

const finitePresentNumberOrNull = (value) => {
  if (value == null || value === "") return null;
  return finiteNumberOrNull(value);
};

const firstPresentFiniteMetric = (...values) => {
  for (const value of values) {
    const numeric = finitePresentNumberOrNull(value);
    if (numeric != null) return numeric;
  }
  return null;
};

const firstPositivePresentMetric = (...values) => {
  for (const value of values) {
    const numeric = finitePresentNumberOrNull(value);
    if (numeric != null && numeric > 0) return numeric;
  }
  return null;
};

const metricDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatElapsedShort = (value, now = Date.now()) => {
  const date = metricDateOrNull(value);
  if (!date) return MISSING_VALUE;
  const currentMs = now instanceof Date ? now.getTime() : Number(now);
  const deltaMs = Math.max(0, currentMs - date.getTime());
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

export const resolveSignalAge = (signal, { freshWindowBars, now } = {}) => {
  const record = asRecord(signal);
  const barsSinceSignal = finiteNumberOrNull(record.barsSinceSignal);
  const windowBars = clampMetric(
    Math.round(
      finiteNumberOrNull(freshWindowBars ?? record.freshWindowBars) ?? 3,
    ),
    1,
    20,
  );
  const signalAt = record.signalAt ?? record.currentSignalAt;
  const elapsed = formatElapsedShort(signalAt, now);
  const barsLabel =
    barsSinceSignal != null
      ? `${Math.round(barsSinceSignal)}/${windowBars} bars`
      : MISSING_VALUE;
  const freshnessPct =
    barsSinceSignal != null
      ? clampMetric(1 - barsSinceSignal / windowBars, 0, 1) * 100
      : record.fresh === true
        ? 100
        : 0;
  return {
    signalAt: signalAt || null,
    barsSinceSignal,
    freshWindowBars: windowBars,
    freshnessPct,
    label: elapsed,
    elapsedLabel: elapsed,
    barsLabel,
    detail:
      elapsed !== MISSING_VALUE
        ? `${elapsed} since signal`
        : isMarketIdleSignalRecord(record)
          ? "market idle"
        : record.fresh === false
          ? "aged signal"
          : MISSING_VALUE,
  };
};

// Mirrors readSparklineValue in primitives.jsx: a bar's close from a raw
// number, { close }, { c }, or { v } shape. Kept local so this logic module
// does not import the React rendering primitives.
const sparklineBarClose = (point) => {
  if (typeof point === "number" && Number.isFinite(point)) return point;
  if (typeof point?.close === "number" && Number.isFinite(point.close)) {
    return point.close;
  }
  if (typeof point?.c === "number" && Number.isFinite(point.c)) return point.c;
  if (typeof point?.v === "number" && Number.isFinite(point.v)) return point.v;
  return null;
};

// Latest sparkline bar close from the same sources resolveSparklineData reads,
// used as the current-price fallback when no live quote is present so Move can
// still populate (against the most recent bar rather than a live mark).
const latestSparklineClose = (snapshot, record) => {
  const data =
    (Array.isArray(snapshot?.sparkBars) && snapshot.sparkBars) ||
    (Array.isArray(snapshot?.spark) && snapshot.spark) ||
    (Array.isArray(record?.sparkBars) && record.sparkBars) ||
    (Array.isArray(record?.spark) && record.spark) ||
    (Array.isArray(record?.bars) && record.bars) ||
    null;
  if (!data) return null;
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const close = sparklineBarClose(data[index]);
    if (close != null) return close;
  }
  return null;
};

// Single source of truth for the "current" underlying price the STA row both
// DISPLAYS (price column) and MEASURES THE MOVE AGAINST. Resolving these from
// one chain means the price the user sees and the price the Move is computed
// from can never diverge - a divergence is what let stale rows show a confident
// Move against a phantom price the UI never displayed (BFST/FIBK +209%).
// Precedence: live snapshot quote -> last-evaluated bar close (matrix
// latestBarClose / sparkline) -> signal fire price as the last resort.
// `source` reports which tier supplied the value ("quote" live; "bar" the most
// recent bar; "fire" only the fire price; null nothing), and `live` is true only
// for a live snapshot quote.
export const resolveDisplayCurrentPrice = (signal, tickerSnapshot = null) => {
  const record = asRecord(signal);
  const snapshot = asRecord(tickerSnapshot);
  // A genuine live equity/bar price is never exactly 0; a 0 means "no quote".
  // Use the positive-only helper (same one resolveSignalMove uses for the Move
  // basis) so a 0 falls through to the bar-close / fire-price / dash tiers
  // instead of being displayed as "$0.00" - this removes the displayed-price vs
  // Move asymmetry that let a phantom 0 show as a confident price.
  const liveQuote = firstPositivePresentMetric(
    snapshot.price,
    snapshot.last,
    snapshot.mark,
  );
  if (liveQuote != null) {
    return { price: liveQuote, source: "quote", live: true };
  }
  const barClose = firstPositivePresentMetric(
    record.currentPrice,
    record.latestBarClose,
    record.last,
    record.mark,
    latestSparklineClose(snapshot, record),
  );
  if (barClose != null) {
    return { price: barClose, source: "bar", live: false };
  }
  // Positive-only: a 0 (or absent) fire price is "no price", same contract as the
  // live-quote and bar tiers above. Without this the resolver could return price:0
  // and the row rendered "$0.00" instead of a dash for a price it never really had.
  const firePrice = firstPositivePresentMetric(record.signalPrice);
  return {
    price: firePrice,
    source: firePrice == null ? null : "fire",
    live: false,
  };
};

// SINGLE source of truth for "is this STA row's data stale?". The display marker
// and the backend root-cause must agree on what "stale" means, so the canonical
// signal lives here and nowhere else. Per the Signal Monitor model
// (signal-monitor-actionability.ts:45-58 authors actionBlocker `data_stale`
// from status "stale"), staleness is the row's own monitor state - NOT a quote
// freshness/cacheAgeMs heuristic and NOT a market-idle/no-print lane.
const resolveMoveStaleness = (record) => {
  if (record.stale === true) return true;
  if (String(record.actionBlocker || "").toLowerCase() === "data_stale") {
    return true;
  }
  const status = String(record.status || "")
    .trim()
    .toLowerCase();
  return status === "stale";
};

const isSignalMonitorDerivedSignalRecord = (record) => {
  const sourceType = normalizeMatchKey(record.sourceType).toLowerCase();
  const source = normalizeMatchKey(record.source).toLowerCase();
  return (
    sourceType === "signal_matrix_state" ||
    sourceType === "signal_monitor_event" ||
    source === "signal-matrix" ||
    source === "pyrus-signals"
  );
};

const resolveSignalEquityBasisPrice = (record, candidateRecord = {}) => {
  const signalClose = firstPositivePresentMetric(
    record.signalClose,
    record.signalBarClose,
    record.currentSignalClose,
    record.close,
    candidateRecord.signalClose,
    candidateRecord.signalBarClose,
    candidateRecord.currentSignalClose,
    candidateRecord.close,
  );
  const signalLevelPrice = firstPositivePresentMetric(
    record.signalLevelPrice,
    record.currentSignalPrice,
    candidateRecord.signalLevelPrice,
    candidateRecord.currentSignalPrice,
  );
  if (signalClose != null) {
    return {
      price: signalClose,
      source: "signal-close",
      signalLevelPrice,
    };
  }
  if (isSignalMonitorDerivedSignalRecord(record)) {
    return {
      price: null,
      source: null,
      signalLevelPrice,
    };
  }
  const legacyBasis = firstPositivePresentMetric(
    record.signalPrice,
    record.currentSignalPrice,
    record.entryPrice,
    record.basisPrice,
    candidateRecord.signalPrice,
    candidateRecord.currentSignalPrice,
    candidateRecord.entryPrice,
    candidateRecord.basisPrice,
  );
  return {
    price: legacyBasis,
    source: legacyBasis == null ? null : "legacy-signal-price",
    signalLevelPrice,
  };
};

export const resolveSignalMove = (
  signal,
  tickerSnapshot = null,
  candidate = null,
) => {
  const record = asRecord(signal);
  const snapshot = asRecord(tickerSnapshot);
  const candidateRecord = asRecord(candidate);
  const signalBasis = resolveSignalEquityBasisPrice(record, candidateRecord);
  const signalPrice = signalBasis.price;
  // Measure the Move against the SAME price the row displays. Only a real
  // current (live quote or a bar close) yields a Move; a fire-only/absent
  // current leaves it blank rather than fabricating a 0% or a phantom move.
  const current = resolveDisplayCurrentPrice(record, snapshot);
  const currentPrice =
    current.source === "quote" || current.source === "bar"
      ? current.price
      : null;
  if (signalPrice == null || currentPrice == null || signalPrice <= 0) {
    return {
      value: null,
      pct: null,
      label: MISSING_VALUE,
      detail: MISSING_VALUE,
      stale: false,
      basisPrice: null,
      basisSource: signalBasis.source,
      signalLevelPrice: signalBasis.signalLevelPrice ?? null,
      auditDetail: signalBasis.signalLevelPrice
        ? `Signal level ${formatMoney(signalBasis.signalLevelPrice, 2)}`
        : MISSING_VALUE,
    };
  }
  // Direction-adjust so a favorable move reads positive regardless of side: a
  // sell/short signal profits when price falls. This matches the score's and the
  // KPI pipeline's direction-signed convention so the Move column is comparable to
  // the score (the raw price path stays visible in auditDetail below).
  const moveDirection = String(
    record.direction || candidateRecord.direction || "buy",
  ).toLowerCase();
  const moveDirectionSign = moveDirection === "sell" ? -1 : 1;
  const value = (currentPrice - signalPrice) * moveDirectionSign;
  const pct = (value / signalPrice) * 100;
  const signalLevelPrice = signalBasis.signalLevelPrice ?? null;
  const levelDetail = signalLevelPrice
    ? `Level ${formatMoney(signalLevelPrice, 2)}`
    : null;
  return {
    value,
    pct,
    label: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    detail: `${value >= 0 ? "+" : ""}${value.toFixed(2)}`,
    stale: resolveMoveStaleness(record),
    basisPrice: signalPrice,
    basisSource: signalBasis.source,
    signalLevelPrice,
    auditDetail: [
      `${formatMoney(signalPrice, 2)} -> ${formatMoney(currentPrice, 2)}`,
      levelDetail,
    ]
      .filter(Boolean)
      .join(" · "),
  };
};

// Day's move percent for the underlying, sourced from the runtime ticker
// snapshot (runtimeTickerStore/runtimeMarketDataModel already derives `pct`
// from price vs prevClose, falling back to the provider's changePercent). This
// is the intraday session change shown beside the price - distinct from
// resolveSignalMove, which measures price relative to the signal fire price.
// Compact 1-digit label to match the Move column's percent style.
export const resolveSignalDayMove = (tickerSnapshot = null) => {
  const snapshot = asRecord(tickerSnapshot);
  let pct = firstPresentFiniteMetric(snapshot.pct, snapshot.changePercent);
  if (pct == null) {
    const price = firstPresentFiniteMetric(
      snapshot.price,
      snapshot.last,
      snapshot.mark,
    );
    const prevClose = firstPresentFiniteMetric(snapshot.prevClose);
    if (price != null && prevClose != null && prevClose !== 0) {
      pct = ((price - prevClose) / prevClose) * 100;
    }
  }
  if (pct == null) {
    return { pct: null, label: MISSING_VALUE };
  }
  return { pct, label: formatSignedPercent(pct, 1) };
};

const scoreReasonLabel = (reason) =>
  formatEnumLabel(reason)
    .replace(/^Mtf\b/, "MTF")
    .replace(/\bAdx\b/, "ADX")
    .replace(/^Sot Outcome$/, "SOT outcome")
    .replace(/\bSot\b/g, "SOT");

const mtfFrameCount = (mtfDirections) => Math.max(1, mtfDirections.length);

const mtfAlignmentScore = (mtfDirections, mtfMatches) =>
  mtfDirections.length ? (mtfMatches / mtfFrameCount(mtfDirections)) * 25 : 8;

const mtfAlignmentReason = (mtfDirections, mtfMatches) => {
  if (!mtfDirections.length) return null;
  if (mtfMatches === mtfDirections.length) return "mtf_full_alignment";
  if (mtfMatches >= Math.ceil(mtfDirections.length / 2)) {
    return "mtf_partial_alignment";
  }
  return null;
};

const ACTIVE_SIGNAL_SCORE_MODEL_VERSION = "expected-move-v2";
const SOT_BALANCED_SCORE_MAX = 74.9;
const SOT_OUTCOME_SCORE_MAX_CLIENT = 69.9;
const TREND_CONFIRMATION_SCORE_MAX_CLIENT = 89.9;
const EXPECTED_MOVE_SCORE_MAX_CLIENT = 99;

const featureNumber = (features, key, fallback = 0) => {
  const value = finiteNumberOrNull(asRecord(features)[key]);
  return value == null ? fallback : value;
};

const roundScoreComponent = (value) => Number(value.toFixed(1));
// Mirrors roundTo(value, 1) in the backend signal-quality-kpis.ts exactly.
const roundScoreTo1 = (value) => Math.round(value * 10) / 10;

// balanced-sot-v2 -- mirrors scoreFromBalancedSotFeatures in the backend
// signal-quality-kpis.ts (the calibrated active model, recommended by the
// multi-day 1-3 trading-day calibration on the 15m base): 72% SOT reversion +
// 28% trend-confirmation, an extension penalty above the 75th range
// percentile, and volume-expansion support.
const resolveBalancedSotScore = (filterState, entryQuality = null) => {
  const directionalFeatures = asRecord(
    asRecord(filterState).directionalFeatures,
  );
  const rangePosition20 = finiteNumberOrNull(
    directionalFeatures.rangePosition20,
  );
  if (rangePosition20 == null) {
    return null;
  }

  const clampedRange = clampMetric(rangePosition20, 0, 1);
  const mtfAlignment = clampMetric(
    featureNumber(directionalFeatures, "mtfAlignment"),
    -1.5,
    3,
  );
  const adxComponent = clampMetric(
    featureNumber(directionalFeatures, "adxComponent"),
    -1,
    2.5,
  );
  const volatilityComponent = clampMetric(
    featureNumber(directionalFeatures, "volatilityComponent"),
    -0.5,
    1,
  );
  const shortMomentum = clampMetric(
    featureNumber(directionalFeatures, "shortMomentumPct") / 3,
    -2,
    2,
  );
  const riskAdjustedMomentum = clampMetric(
    featureNumber(directionalFeatures, "riskAdjustedMomentum") / 4,
    -2,
    2,
  );
  const volumeExpansion = clampMetric(
    featureNumber(directionalFeatures, "volumeExpansion"),
    -1,
    2,
  );

  // scoreFromDirectionalFeatures (sot-outcome-v1) mirror.
  const reversion = roundScoreTo1(
    clampMetric(
      50 +
        (0.5 - clampedRange) * 45 +
        -mtfAlignment * 3 +
        -adxComponent * 4 +
        volatilityComponent * 8 +
        -shortMomentum * 2 +
        -riskAdjustedMomentum * 2,
      20,
      SOT_OUTCOME_SCORE_MAX_CLIENT,
    ),
  );
  // scoreFromTrendConfirmationFeatures mirror.
  const confirmation = roundScoreTo1(
    clampMetric(
      50 +
        (clampedRange - 0.5) * 28 +
        mtfAlignment * 5 +
        adxComponent * 4 +
        shortMomentum * 2.5 +
        riskAdjustedMomentum * 2 +
        volumeExpansion * 3 +
        volatilityComponent * 2,
      20,
      TREND_CONFIRMATION_SCORE_MAX_CLIENT,
    ),
  );
  const extensionPenalty =
    rangePosition20 > 0.75 ? (rangePosition20 - 0.75) * 24 : 0;
  const volumeSupport = volumeExpansion * 1.5;
  const score = roundScoreTo1(
    clampMetric(
      reversion * 0.72 + confirmation * 0.28 - extensionPenalty + volumeSupport,
      20,
      SOT_BALANCED_SCORE_MAX,
    ),
  );
  const tier = score >= 60 ? "high" : score < 40 ? "low" : "standard";
  const reasons = [
    "balanced_sot_v2",
    rangePosition20 <= 0.5 ? "range_reversion_support" : "extension_risk",
    mtfAlignment >= 1 ? "mtf_confirmation" : null,
    volumeExpansion > 0 ? "volume_expansion_support" : null,
  ].filter(Boolean);
  const entryQualityRecord = asRecord(entryQuality);
  return {
    tier,
    score,
    liquidityTier: String(entryQualityRecord.liquidityTier || "standard"),
    reasons,
    reasonLabels: reasons.slice(0, 3).map(scoreReasonLabel),
    components: {
      reversion: roundScoreComponent(reversion * 0.72),
      confirmation: roundScoreComponent(confirmation * 0.28),
      extensionPenalty: roundScoreComponent(-extensionPenalty),
      volumeSupport: roundScoreComponent(volumeSupport),
      total: score,
    },
    raw: {
      ...directionalFeatures,
      modelVersion: "balanced-sot-v2",
      entryQualityScore: finiteNumberOrNull(entryQualityRecord.score),
      entryQualityTier: entryQualityRecord.tier ?? null,
    },
    label: `Balanced \u00b7 ${score.toFixed(1)}`,
  };
};

// expected-move-v2 -- mirrors scoreFromExpectedMoveV2Features in the backend
// signal-quality-kpis.ts (the calibrated active model as of 2026-07):
// direction proved unpredictable at the 26-bar horizon (directional features
// sign-flip across timeframes/directions) while move magnitude is robustly
// predictable, so this ranks EXPECTED MOVE (volatility regime + volume
// participation + ATR-scaled momentum) with a mild reversion tilt from range
// position, plus a conviction bonus stack on top of the raw expected-move-v1
// score. Conviction conditions mined from 15.6k observations with temporal
// 70/30 split; survivors (train lift >=1.5x AND test >=1.25x in >=4/6
// TF-direction cells): volume spike >=10x, spike+fresh regime flip (<=3
// bars), spike+>=3-ATR thrust; held-out 90+ band P(top-decile MFE) =
// 0.38-0.41 (2.4-3.5x base) at 1.9-9.3% population.
const resolveExpectedMoveScore = (filterState, entryQuality = null) => {
  const directionalFeatures = asRecord(
    asRecord(filterState).directionalFeatures,
  );
  const rangePosition20 = finiteNumberOrNull(
    directionalFeatures.rangePosition20,
  );
  const atrPct = finiteNumberOrNull(directionalFeatures.atrPct);
  const volumeRatio20 = finiteNumberOrNull(directionalFeatures.volumeRatio20);
  if (rangePosition20 == null || atrPct == null || volumeRatio20 == null) {
    return null;
  }

  const atr = Math.max(atrPct, 0.02);
  const vr = Math.max(volumeRatio20, 0.25);
  const riskAdjustedMomentum = featureNumber(
    directionalFeatures,
    "riskAdjustedMomentum",
  );
  const shortMomentumPct = featureNumber(
    directionalFeatures,
    "shortMomentumPct",
  );

  // Tail caps at 2.2/4 (not 3.5/7): the extreme-vol tail is adversely
  // selected on realized return (halted/gapping names) -- beyond ~4.6x median
  // volatility, more vol must not buy more score.
  const volatilityRegime = 5.0 * clampMetric(Math.log2(atr / 0.6), -2, 2.2);
  const volumeParticipation = 3.0 * clampMetric(Math.log2(vr), -2, 4);
  const momentum =
    0.6 * clampMetric(riskAdjustedMomentum, -8, 8) +
    0.5 * clampMetric(shortMomentumPct / atr, -8, 8);
  const reversionTilt = 4.0 * (0.5 - clampMetric(rangePosition20, 0, 1));
  // Conviction bonus stack (expected-move-v2): added to the raw score before
  // the single clamp+round below -- mirrors expectedMoveConvictionBonus in
  // the backend signal-quality-kpis.ts.
  const regimeAgeBars = finiteNumberOrNull(directionalFeatures.regimeAgeBars);
  const volumeSpike = volumeRatio20 >= 10;
  const freshRegime = regimeAgeBars != null && regimeAgeBars <= 3;
  const thrust = shortMomentumPct / atr >= 3;
  const conviction =
    (volumeSpike ? 4 : 0) +
    (volumeSpike && freshRegime ? 9 : 0) +
    (volumeSpike && thrust ? 9 : 0) +
    (volumeSpike && freshRegime && thrust ? 8 : 0);
  const score = roundScoreTo1(
    clampMetric(
      42 +
        volatilityRegime +
        volumeParticipation +
        momentum +
        reversionTilt +
        conviction,
      5,
      EXPECTED_MOVE_SCORE_MAX_CLIENT,
    ),
  );
  const tier = score >= 60 ? "high" : score < 40 ? "low" : "standard";
  const reasons = [
    "expected_move_v2",
    rangePosition20 <= 0.5 ? "range_reversion_support" : "extension_risk",
    volumeRatio20 >= 1 ? "volume_expansion_support" : null,
    conviction >= 13 ? "ignition" : null,
  ].filter(Boolean);
  const entryQualityRecord = asRecord(entryQuality);
  return {
    tier,
    score,
    liquidityTier: String(entryQualityRecord.liquidityTier || "standard"),
    reasons,
    reasonLabels: reasons.slice(0, 3).map(scoreReasonLabel),
    components: {
      volatilityRegime: roundScoreComponent(volatilityRegime),
      volumeParticipation: roundScoreComponent(volumeParticipation),
      momentum: roundScoreComponent(momentum),
      reversionTilt: roundScoreComponent(reversionTilt),
      conviction: roundScoreComponent(conviction),
      total: score,
    },
    raw: {
      ...directionalFeatures,
      modelVersion: ACTIVE_SIGNAL_SCORE_MODEL_VERSION,
      entryQualityScore: finiteNumberOrNull(entryQualityRecord.score),
      entryQualityTier: entryQualityRecord.tier ?? null,
    },
    label: `Expected move \u00b7 ${score.toFixed(1)}`,
  };
};

export const resolveSignalScoreBreakdown = ({
  signal,
  candidate,
  quote,
  liquidity,
} = {}) => {
  const candidateRecord = asRecord(candidate);
  const signalRecord = asRecord(signal ?? candidateRecord.signal);
  const quality = asRecord(candidateRecord.signalQuality);
  const filterState = asRecord(signalRecord.filterState);
  const outcomeScore = resolveExpectedMoveScore(filterState, quality);
  if (outcomeScore) {
    return outcomeScore;
  }
  if (Object.keys(quality).length) {
    const score = finiteNumberOrNull(quality.score);
    return {
      tier: String(quality.tier || "standard"),
      score,
      liquidityTier: String(quality.liquidityTier || "standard"),
      reasons: Array.isArray(quality.reasons) ? quality.reasons : [],
      reasonLabels: (Array.isArray(quality.reasons) ? quality.reasons : [])
        .slice(0, 3)
        .map(scoreReasonLabel),
      components: asRecord(quality.components),
      raw: asRecord(quality.raw),
      label: entryQualityLabel(quality),
    };
  }

  const direction = String(
    candidateRecord.direction || signalRecord.direction || "buy",
  ).toLowerCase();
  const directionSign = direction === "sell" ? -1 : 1;
  const mtfDirections = Array.isArray(filterState.mtfDirections)
    ? filterState.mtfDirections.map(Number).filter(Number.isFinite)
    : [];
  const mtfMatches = mtfDirections.filter(
    (item) => item === directionSign,
  ).length;
  const adx = finiteNumberOrNull(filterState.adx);
  const quoteRecord = asRecord(quote ?? candidateRecord.quote);
  const orderPlanRecord = asRecord(candidateRecord.orderPlan);
  const orderLiquidity = asRecord(orderPlanRecord.liquidity);
  const liquidityRecord = asRecord(liquidity ?? candidateRecord.liquidity);
  const spreadPctOfMid = firstFiniteMetric(
    liquidityRecord.spreadPctOfMid,
    orderLiquidity.spreadPctOfMid,
    quoteRecord.spreadPctOfMid,
  );
  const liquidityTier =
    spreadPctOfMid == null
      ? "standard"
      : spreadPctOfMid <= 15
        ? "strong"
        : spreadPctOfMid >= 30
          ? "weak"
          : "standard";
  const premiumAtRisk = finiteNumberOrNull(orderPlanRecord.premiumAtRisk);
  // No real scoring inputs (no backend signalQuality, no MTF directions, no ADX,
  // no liquidity/premium): every component would collapse to its default and the
  // score would be the misleading all-defaults constant (~46.4). Surface an explicit
  // "no data" instead of a fake score; a real score still computes once any input exists.
  if (
    mtfDirections.length === 0 &&
    adx == null &&
    spreadPctOfMid == null &&
    premiumAtRisk == null
  ) {
    return {
      tier: "unknown",
      score: null,
      liquidityTier: "standard",
      reasons: [],
      reasonLabels: [],
      components: {},
      raw: {},
      label: MISSING_VALUE,
    };
  }
  const mtfAlignment = mtfAlignmentScore(mtfDirections, mtfMatches);
  const trendStrength = adx == null ? 7.5 : clampMetric(adx / 25, 0, 1) * 15;
  const liquidityScore =
    liquidityTier === "strong" ? 20 : liquidityTier === "weak" ? 0 : 12;
  const riskFit = premiumAtRisk != null && premiumAtRisk > 0 ? 10 : 5;
  // Score ignores signal age and quote liveness: only MTF alignment, trend,
  // liquidity, and risk-fit contribute. Rescale the remaining max (70) back to
  // 0-100 so the tier cutoffs and admission gate keep their 0-100 meaning.
  const maxRawScore = 25 + 15 + 20 + 10;
  const scoreScale = 100 / maxRawScore;
  const score =
    (mtfAlignment + trendStrength + liquidityScore + riskFit) * scoreScale;
  const reasons = [
    mtfAlignmentReason(mtfDirections, mtfMatches),
    adx != null && adx >= 25 ? "adx_confirmed" : null,
    liquidityTier === "strong"
      ? "strong_liquidity"
      : liquidityTier === "weak"
        ? "weak_liquidity"
        : null,
    premiumAtRisk != null && premiumAtRisk > 0 ? "risk_sized" : null,
  ].filter(Boolean);
  const roundedScore = Number(score.toFixed(1));
  const tier =
    roundedScore >= 75 && liquidityTier !== "weak"
      ? "high"
      : roundedScore < 50 || liquidityTier === "weak"
        ? "low"
        : "standard";
  return {
    tier,
    score: roundedScore,
    liquidityTier,
    reasons,
    reasonLabels: reasons.slice(0, 3).map(scoreReasonLabel),
    components: {
      mtfAlignment: Number((mtfAlignment * scoreScale).toFixed(1)),
      trendStrength: Number((trendStrength * scoreScale).toFixed(1)),
      liquidity: Number((liquidityScore * scoreScale).toFixed(1)),
      riskFit: Number((riskFit * scoreScale).toFixed(1)),
      total: roundedScore,
    },
    raw: {
      adx,
      mtfMatches,
      mtfDirections,
      spreadPctOfMid,
      premiumAtRisk,
    },
    label: `${formatEnumLabel(tier)} · ${roundedScore.toFixed(1)}`,
  };
};

export const resolveCandidateGateDisplay = (candidate) => {
  const record = asRecord(candidate);
  const reason = String(record.reason || "").trim();
  if (!reason) {
    return {
      category: "clear",
      label: "Gate clear",
      detail: "no blocker",
      tone: CSS_COLOR.green,
    };
  }
  const category = candidateReasonCategory(record);
  return {
    category,
    label: formatEnumLabel(category),
    detail: formatEnumLabel(reason),
    tone:
      category === "risk" || category === "gateway"
        ? CSS_COLOR.red
        : category === "liquidity" ||
            category === "contract_resolution" ||
            category === "marking"
          ? CSS_COLOR.amber
          : CSS_COLOR.textDim,
  };
};

export const resolveCandidateSyncDisplay = (candidate) => {
  const record = asRecord(candidate);
  const shadowLink = asRecord(record.shadowLink);
  const syncStatus = String(record.syncStatus || "").trim();
  const actionStatus = String(
    record.actionStatus || record.status || "",
  ).trim();
  if (syncStatus === "mismatch" || actionStatus === "mismatch") {
    return {
      label: "Mismatch",
      detail: shadowLinkSummary(shadowLink),
      tone: CSS_COLOR.red,
    };
  }
  if (syncStatus === "event_only") {
    return {
      label: "Event only",
      detail: shadowLinkSummary(shadowLink),
      tone: CSS_COLOR.amber,
    };
  }
  if (shadowLink.fillId || shadowLink.orderId || shadowLink.positionId) {
    return {
      label: "Synced",
      detail: shadowLinkSummary(shadowLink),
      tone: CSS_COLOR.green,
    };
  }
  return {
    label: syncStatus ? formatEnumLabel(syncStatus) : "Pending",
    detail: actionStatus
      ? signalOptionsActionLabel(actionStatus)
      : "shadow link pending",
    tone: syncStatus ? CSS_COLOR.textSec : CSS_COLOR.textDim,
  };
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

export const boundedNumberFrom = (value, fallback, min, max) =>
  Math.min(max, Math.max(min, numberFrom(value, fallback)));

export const resolveStrategySignalSettings = (
  deployment,
  signalMonitorProfile,
) => {
  const parameters = asRecord(asRecord(deployment?.config).parameters);
  const pyrusSignalsSettings = asRecord(
    signalMonitorProfile?.pyrusSignalsSettings,
  );
  const marketStructure = asRecord(
    pyrusSignalsSettings.marketStructure ?? parameters.marketStructure,
  );
  const profileTimeframe = String(signalMonitorProfile?.timeframe || "");
  const configTimeframe = String(parameters.signalTimeframe || "");
  const signalTimeframe = STRATEGY_SIGNAL_TIMEFRAMES.includes(profileTimeframe)
    ? profileTimeframe
    : STRATEGY_SIGNAL_TIMEFRAMES.includes(configTimeframe)
      ? configTimeframe
      : DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe;
  const rawBosConfirmation = String(
    marketStructure.bosConfirmation ??
      pyrusSignalsSettings.bosConfirmation ??
      parameters.bosConfirmation ??
      "",
  );
  const bosConfirmation = PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS.includes(
    rawBosConfirmation,
  )
    ? rawBosConfirmation
    : DEFAULT_STRATEGY_SIGNAL_SETTINGS.bosConfirmation;
  const timeHorizon = Math.round(
    boundedNumberFrom(
      marketStructure.timeHorizon ??
        pyrusSignalsSettings.timeHorizon ??
        parameters.timeHorizon,
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.timeHorizon,
      2,
      50,
    ),
  );

  return {
    signalTimeframe,
    timeHorizon,
    bosConfirmation,
    chochAtrBuffer: boundedNumberFrom(
      marketStructure.chochAtrBuffer ??
        pyrusSignalsSettings.chochAtrBuffer ??
        parameters.chochAtrBuffer,
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochAtrBuffer,
      0,
      20,
    ),
    chochBodyExpansionAtr: boundedNumberFrom(
      marketStructure.chochBodyExpansionAtr ??
        pyrusSignalsSettings.chochBodyExpansionAtr ??
        parameters.chochBodyExpansionAtr,
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochBodyExpansionAtr,
      0,
      20,
    ),
    chochVolumeGate: boundedNumberFrom(
      marketStructure.chochVolumeGate ??
        pyrusSignalsSettings.chochVolumeGate ??
        parameters.chochVolumeGate,
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochVolumeGate,
      0,
      20,
    ),
  };
};

export const mergeSignalOptionsProfile = (source) => {
  const config = asRecord(source);
  const signalOptions = asRecord(config.signalOptions);
  const rawProfile = Object.keys(signalOptions).length ? signalOptions : {};
  const rawOptionSelection = asRecord(rawProfile.optionSelection);
  const rawExitPolicy = asRecord(rawProfile.exitPolicy);
  const parameters = asRecord(config.parameters);
  const profile = cloneProfile({
    ...SIGNAL_OPTIONS_DEFAULT_PROFILE,
    ...rawProfile,
    optionSelection: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.optionSelection,
      ...rawOptionSelection,
      callStrikeSlots:
        rawOptionSelection.callStrikeSlots ??
        (rawOptionSelection.callStrikeSlot != null
          ? [rawOptionSelection.callStrikeSlot]
          : SIGNAL_OPTIONS_DEFAULT_PROFILE.optionSelection.callStrikeSlots),
      putStrikeSlots:
        rawOptionSelection.putStrikeSlots ??
        (rawOptionSelection.putStrikeSlot != null
          ? [rawOptionSelection.putStrikeSlot]
          : SIGNAL_OPTIONS_DEFAULT_PROFILE.optionSelection.putStrikeSlots),
    },
    riskCaps: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.riskCaps,
      ...asRecord(rawProfile.riskCaps),
    },
    liquidityGate: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.liquidityGate,
      ...asRecord(rawProfile.liquidityGate),
      // require* controls removed; gate governed by the Quote halt toggles. Force on so a
      // stale stored false can't strand the gate (state is folded into the toggles below).
      requireBidAsk: true,
      requireFreshQuote: true,
    },
    entryGate: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate,
      ...asRecord(rawProfile.entryGate),
      mtfAlignment: {
        ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.mtfAlignment,
        ...asRecord(asRecord(rawProfile.entryGate).mtfAlignment),
        // MTF enable toggles removed; MTF is governed by the SIGNAL FRAMES selection.
        // Force on so it can't strand; disable MTF by collapsing to the single exec frame.
        enabled: true,
      },
    },
    fillPolicy: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.fillPolicy,
      ...asRecord(rawProfile.fillPolicy),
    },
    exitPolicy: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy,
      ...rawExitPolicy,
      wireGreekTrail: {
        ...SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.wireGreekTrail,
        ...asRecord(rawExitPolicy.wireGreekTrail),
      },
    },
    riskHaltControls: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.riskHaltControls,
      ...asRecord(rawProfile.riskHaltControls),
    },
    entryHaltControls: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryHaltControls,
      ...asRecord(rawProfile.entryHaltControls),
      // MTF quick-toggle removed; MTF governed by the SIGNAL FRAMES selection. Force on.
      mtfAlignmentEnabled: true,
    },
    liquidityHaltControls: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.liquidityHaltControls,
      ...asRecord(rawProfile.liquidityHaltControls),
      // Fold the removed liquidityGate.require* duplicates into the kept Quote toggles so
      // the effective gate is preserved (active iff both the old setting and toggle were on).
      bidAskRequiredEnabled:
        asRecord(rawProfile.liquidityGate).requireBidAsk !== false &&
        asRecord(rawProfile.liquidityHaltControls).bidAskRequiredEnabled !== false,
      freshQuoteRequiredEnabled:
        asRecord(rawProfile.liquidityGate).requireFreshQuote !== false &&
        asRecord(rawProfile.liquidityHaltControls).freshQuoteRequiredEnabled !== false,
    },
    positionHaltControls: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.positionHaltControls,
      ...asRecord(rawProfile.positionHaltControls),
    },
    infrastructureHaltControls: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.infrastructureHaltControls,
      ...asRecord(rawProfile.infrastructureHaltControls),
    },
  });

  const mtfAlignment = asRecord(asRecord(profile.entryGate).mtfAlignment);
  const mtfTimeframes = normalizeSignalOptionsMtfTimeframes(
    mtfAlignment.timeframes,
    SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.mtfAlignment.timeframes,
  );
  profile.entryGate.mtfAlignment = {
    ...SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.mtfAlignment,
    ...mtfAlignment,
    timeframes: mtfTimeframes,
    preset: normalizeSignalOptionsMtfPreset(mtfAlignment.preset),
    requiredCount: boundedNumberFrom(
      mtfAlignment.requiredCount,
      mtfTimeframes.length,
      1,
      mtfTimeframes.length,
    ),
  };

  if (parameters.executionMode === "signal_options") {
    profile.optionSelection.minDte = numberFrom(
      parameters.signalOptionsMinDte,
      profile.optionSelection.minDte,
    );
    profile.optionSelection.maxDte = Math.max(
      profile.optionSelection.minDte,
      numberFrom(
        parameters.signalOptionsMaxDte,
        profile.optionSelection.maxDte,
      ),
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
    profile.optionSelection.callStrikeSlots = [
      profile.optionSelection.callStrikeSlot,
    ];
    profile.optionSelection.putStrikeSlot = numberFrom(
      parameters.signalOptionsPutStrikeSlot,
      profile.optionSelection.putStrikeSlot,
    );
    profile.optionSelection.putStrikeSlots = [
      profile.optionSelection.putStrikeSlot,
    ];
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

  return normalizeSignalOptionsProfileStrikeSlots(profile);
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
      message =
        payload?.detail || payload?.message || payload?.error || message;
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
  Number.isFinite(Number(value))
    ? Number(value).toFixed(digits)
    : MISSING_VALUE;

export const formatPct = (value, digits = 1) =>
  Number.isFinite(Number(value))
    ? `${Number(value).toFixed(digits)}%`
    : MISSING_VALUE;

const finiteAverage = (values) => {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) return null;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
};

const medianOf = (values) => {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const count = sorted.length;
  if (count === 0) return null;
  const mid = Math.floor(count / 2);
  return count % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const buildLiveSignalMoveMetrics = (observations, signalCountOverride = null) => {
  const observationCount = observations.length;
  const signalCount =
    Number.isFinite(signalCountOverride) && signalCountOverride >= 0
      ? signalCountOverride
      : observationCount;
  const moveTimeline = buildAverageMoveTimeline(observations);
  if (observationCount === 0) {
    return {
      signalCount,
      observationCount: 0,
      avgMovePct: null,
      avgDirectionalMovePercent: null,
      medianMovePct: null,
      medianDirectionalMovePercent: null,
      correctnessPct: null,
      correctnessPercent: null,
      winCount: 0,
      moveStdDevPct: null,
      consistencyStdDevPercent: null,
      avgWinPct: null,
      avgLossPct: null,
      payoffRatio: null,
      expectancyPct: null,
      expectancyPercent: null,
      mfePct: null,
      maePct: null,
      avgMfePercent: null,
      avgMaePercent: null,
      moveTimeline,
    };
  }
  const moves = observations.map((observation) => observation.movePercent);
  const total = moves.reduce((sum, move) => sum + move, 0);
  const avgMovePct = total / observationCount;
  const medianMovePct = medianOf(moves);
  const wins = moves.filter((move) => move > 0);
  const losses = moves.filter((move) => move < 0);
  const avgWinPct = wins.length
    ? wins.reduce((sum, move) => sum + move, 0) / wins.length
    : 0;
  const avgLossPct = losses.length
    ? Math.abs(losses.reduce((sum, move) => sum + move, 0) / losses.length)
    : 0;
  const hitRate = wins.length / observationCount;
  const variance =
    moves.reduce((sum, move) => sum + (move - avgMovePct) ** 2, 0) /
    observationCount;
  const moveStdDevPct = Math.sqrt(variance);
  const expectancyPct = hitRate * avgWinPct - (1 - hitRate) * avgLossPct;
  const avgMfePercent = finiteAverage(
    observations.map((observation) => observation.mfePercent),
  );
  const avgMaePercent = finiteAverage(
    observations.map((observation) => observation.maePercent),
  );

  return {
    signalCount,
    observationCount,
    avgMovePct,
    avgDirectionalMovePercent: avgMovePct,
    medianMovePct,
    medianDirectionalMovePercent: medianMovePct,
    correctnessPct: hitRate * 100,
    correctnessPercent: hitRate * 100,
    winCount: wins.length,
    moveStdDevPct,
    consistencyStdDevPercent: moveStdDevPct,
    avgWinPct,
    avgLossPct,
    payoffRatio: avgLossPct > 0 ? avgWinPct / avgLossPct : null,
    expectancyPct,
    expectancyPercent: expectancyPct,
    mfePct: avgMfePercent,
    maePct: avgMaePercent,
    avgMfePercent,
    avgMaePercent,
    moveTimeline,
  };
};

const buildAverageMoveTimeline = (observations) => {
  const byBar = new Map();
  for (const observation of observations) {
    const timeline = Array.isArray(observation.moveTimeline)
      ? observation.moveTimeline
      : [];
    for (const point of timeline) {
      const bar = Number(point?.bar);
      const movePercent = Number(point?.movePercent);
      if (!Number.isInteger(bar) || bar <= 0 || !Number.isFinite(movePercent)) {
        continue;
      }
      const bucket = byBar.get(bar) ?? [];
      bucket.push(movePercent);
      byBar.set(bar, bucket);
    }
  }
  return [...byBar.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bar, values]) => ({
      bar,
      observationCount: values.length,
      avgMovePercent: values.reduce((sum, value) => sum + value, 0) / values.length,
    }));
};

const sparklineBarHigh = (point) => {
  const high =
    finiteNumberOrNull(point?.high) ??
    finiteNumberOrNull(point?.h) ??
    sparklineBarClose(point);
  return high;
};

const sparklineBarLow = (point) => {
  const low =
    finiteNumberOrNull(point?.low) ??
    finiteNumberOrNull(point?.l) ??
    sparklineBarClose(point);
  return low;
};

const sparklineBarTimestampMs = (point) => {
  const raw = point?.timestamp ?? point?.time ?? point?.t;
  if (raw instanceof Date) {
    const value = raw.getTime();
    return Number.isFinite(value) ? value : null;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return raw > 0 && raw < 1_000_000_000_000 ? raw * 1000 : raw;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sparklineBarsForSignal = (snapshot, record) =>
  (Array.isArray(snapshot?.sparkBars) && snapshot.sparkBars) ||
  (Array.isArray(snapshot?.spark) && snapshot.spark) ||
  (Array.isArray(record?.sparkBars) && record.sparkBars) ||
  (Array.isArray(record?.spark) && record.spark) ||
  (Array.isArray(record?.bars) && record.bars) ||
  [];

const resolvePersistedSignalExcursionMetrics = (record) => {
  const mfePercent = finiteNumberOrNull(
    record.currentSignalMfePercent ?? record.signalMfePercent,
  );
  const maePercent = finiteNumberOrNull(
    record.currentSignalMaePercent ?? record.signalMaePercent,
  );
  return mfePercent != null || maePercent != null
    ? { mfePercent, maePercent }
    : null;
};

const resolveSignalExcursionMetrics = ({
  record,
  snapshot,
  signalPrice,
  direction,
}) => {
  const signalAtMs = Date.parse(record.signalAt ?? record.currentSignalAt ?? "");
  if (!Number.isFinite(signalAtMs) || signalPrice <= 0) return null;
  const bars = sparklineBarsForSignal(snapshot, record)
    .map((bar) => ({
      bar,
      timeMs: sparklineBarTimestampMs(bar),
      high: sparklineBarHigh(bar),
      low: sparklineBarLow(bar),
    }))
    .filter(
      (entry) =>
        Number.isFinite(entry.timeMs) &&
        entry.timeMs >= signalAtMs &&
        Number.isFinite(entry.high) &&
        Number.isFinite(entry.low),
    );
  if (!bars.length) return null;

  const highest = Math.max(...bars.map((entry) => entry.high));
  const lowest = Math.min(...bars.map((entry) => entry.low));
  if (direction === "sell") {
    return {
      mfePercent: ((signalPrice - lowest) / signalPrice) * 100,
      maePercent: ((signalPrice - highest) / signalPrice) * 100,
    };
  }
  return {
    mfePercent: ((highest - signalPrice) / signalPrice) * 100,
    maePercent: ((lowest - signalPrice) / signalPrice) * 100,
  };
};

const resolveSignalMoveTimeline = ({
  record,
  snapshot,
  signalPrice,
  direction,
  maxBars,
}) => {
  const signalAtMs = Date.parse(record.signalAt ?? record.currentSignalAt ?? "");
  if (!Number.isFinite(signalAtMs) || signalPrice <= 0) return [];
  const limit =
    Number.isInteger(maxBars) && maxBars > 0
      ? Math.min(50, maxBars)
      : 10;
  const bars = sparklineBarsForSignal(snapshot, record)
    .map((bar) => ({
      timeMs: sparklineBarTimestampMs(bar),
      close: sparklineBarClose(bar),
    }))
    .filter(
      (entry) =>
        Number.isFinite(entry.timeMs) &&
        entry.timeMs > signalAtMs &&
        Number.isFinite(entry.close),
    )
    .sort((left, right) => left.timeMs - right.timeMs)
    .slice(0, limit);
  return bars.map((entry, index) => {
    const rawPct = ((entry.close - signalPrice) / signalPrice) * 100;
    return {
      bar: index + 1,
      movePercent: direction === "sell" ? -rawPct : rawPct,
    };
  });
};

// Signal-indicator KPIs computed from the live signal rows already on the page
// (directional move since each signal). This keeps the header cards fed by the
// same Signal Matrix / STA rows the user is looking at.
const resolveScoreBucketKey = (scoreBreakdown) => {
  const tier = String(asRecord(scoreBreakdown).tier || "").trim().toLowerCase();
  return tier === "high" || tier === "standard" || tier === "low"
    ? tier
    : "unknown";
};

export const SIGNAL_SCORE_RANGE_BUCKETS = [
  { key: "90-100", label: "90-100", min: 90, max: 100 },
  { key: "80-90", label: "80-90", min: 80, max: 90 },
  { key: "70-80", label: "70-80", min: 70, max: 80 },
  { key: "60-70", label: "60-70", min: 60, max: 70 },
  { key: "50-60", label: "50-60", min: 50, max: 60 },
  { key: "40-50", label: "40-50", min: 40, max: 50 },
  { key: "30-40", label: "30-40", min: 30, max: 40 },
  { key: "20-30", label: "20-30", min: 20, max: 30 },
  { key: "10-20", label: "10-20", min: 10, max: 20 },
  { key: "0-10", label: "0-10", min: 0, max: 10 },
];

const resolveScoreRangeBucketKey = (scoreBreakdown) => {
  const score = finiteNumberOrNull(asRecord(scoreBreakdown).score);
  if (score == null) return "unknown";
  const clamped = Math.min(100, Math.max(0, score));
  const lower = clamped >= 100 ? 90 : Math.floor(clamped / 10) * 10;
  return `${lower}-${lower + 10}`;
};

export const buildSignalIndicatorMetrics = (
  signalRows,
  { tickerSnapshotsBySymbol = null, timelineBars = 10 } = {},
) => {
  const rows = Array.isArray(signalRows) ? signalRows : [];
  const observations = [];
  const observationsByDirection = {
    buy: [],
    sell: [],
  };
  const signalCountsByDirection = {
    buy: 0,
    sell: 0,
  };
  const observationsByScoreBucket = {
    high: [],
    standard: [],
    low: [],
    unknown: [],
  };
  const observationsByScoreRange = Object.fromEntries(
    SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => [bucket.key, []]),
  );
  observationsByScoreRange.unknown = [];
  const observationsByScoreRangeDirection = Object.fromEntries(
    SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => [
      bucket.key,
      { buy: [], sell: [] },
    ]),
  );
  observationsByScoreRangeDirection.unknown = { buy: [], sell: [] };
  const signalCountsByScoreBucket = {
    high: 0,
    standard: 0,
    low: 0,
    unknown: 0,
  };
  const signalCountsByScoreRange = Object.fromEntries(
    SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => [bucket.key, 0]),
  );
  signalCountsByScoreRange.unknown = 0;
  const signalCountsByScoreRangeDirection = Object.fromEntries(
    SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => [
      bucket.key,
      { buy: 0, sell: 0 },
    ]),
  );
  signalCountsByScoreRangeDirection.unknown = { buy: 0, sell: 0 };
  for (const row of rows) {
    const record = asRecord(row);
    // Count every row into its score bucket (incl. directionless rows) so the
    // per-bucket signalCounts sum to the overall (All) signalCount = rows.length.
    const scoreBucket = resolveScoreBucketKey(record.scoreBreakdown);
    signalCountsByScoreBucket[scoreBucket] += 1;
    const scoreRangeBucket = resolveScoreRangeBucketKey(record.scoreBreakdown);
    signalCountsByScoreRange[scoreRangeBucket] += 1;
    const symbol = String(record.symbol || "").trim().toUpperCase();
    const snapshot = asRecord(tickerSnapshotsBySymbol?.[symbol]);
    const direction = String(record.direction || "").toLowerCase();
    if (direction !== "buy" && direction !== "sell") continue;
    signalCountsByDirection[direction] += 1;
    signalCountsByScoreRangeDirection[scoreRangeBucket][direction] += 1;
    const signalPrice = resolveSignalEquityBasisPrice(record).price;
    const current = resolveDisplayCurrentPrice(record, snapshot);
    const currentPrice =
      current.source === "quote" || current.source === "bar"
        ? current.price
        : null;
    if (signalPrice == null || currentPrice == null) {
      continue;
    }
    const rawPct = ((currentPrice - signalPrice) / signalPrice) * 100;
    const directionalMove = direction === "sell" ? -rawPct : rawPct;
    const excursion = resolveSignalExcursionMetrics({
      record,
      snapshot,
      signalPrice,
      direction,
    });
    const persistedExcursion =
      resolvePersistedSignalExcursionMetrics(record) ?? excursion;
    const observation = {
      movePercent: directionalMove,
      mfePercent: persistedExcursion?.mfePercent ?? null,
      maePercent: persistedExcursion?.maePercent ?? null,
      moveTimeline: resolveSignalMoveTimeline({
        record,
        snapshot,
        signalPrice,
        direction,
        maxBars: timelineBars,
      }),
    };
    observations.push(observation);
    observationsByDirection[direction].push(observation);
    observationsByScoreBucket[scoreBucket].push(observation);
    observationsByScoreRange[scoreRangeBucket].push(observation);
    observationsByScoreRangeDirection[scoreRangeBucket][direction].push(
      observation,
    );
  }

  const byScoreRange = {
    ...Object.fromEntries(
      SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => [
        bucket.key,
        buildLiveSignalMoveMetrics(
          observationsByScoreRange[bucket.key],
          signalCountsByScoreRange[bucket.key],
        ),
      ]),
    ),
    unknown: buildLiveSignalMoveMetrics(
      observationsByScoreRange.unknown,
      signalCountsByScoreRange.unknown,
    ),
  };
  const byScoreRangeDirection = {
    ...Object.fromEntries(
      SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => [
        bucket.key,
        {
          buy: buildLiveSignalMoveMetrics(
            observationsByScoreRangeDirection[bucket.key].buy,
            signalCountsByScoreRangeDirection[bucket.key].buy,
          ),
          sell: buildLiveSignalMoveMetrics(
            observationsByScoreRangeDirection[bucket.key].sell,
            signalCountsByScoreRangeDirection[bucket.key].sell,
          ),
        },
      ]),
    ),
    unknown: {
      buy: buildLiveSignalMoveMetrics(
        observationsByScoreRangeDirection.unknown.buy,
        signalCountsByScoreRangeDirection.unknown.buy,
      ),
      sell: buildLiveSignalMoveMetrics(
        observationsByScoreRangeDirection.unknown.sell,
        signalCountsByScoreRangeDirection.unknown.sell,
      ),
    },
  };
  const scoreBuckets = [
    ...SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => ({
      ...bucket,
      ...(byScoreRange[bucket.key] ?? {}),
      byDirection: byScoreRangeDirection[bucket.key],
    })),
    {
      key: "unknown",
      label: "Unknown",
      min: null,
      max: null,
      ...(byScoreRange.unknown ?? {}),
      byDirection: byScoreRangeDirection.unknown,
    },
  ].filter((bucket) => bucket.signalCount > 0 || bucket.key !== "unknown");

  return {
    ...buildLiveSignalMoveMetrics(observations, rows.length),
    byDirection: {
      buy: buildLiveSignalMoveMetrics(
        observationsByDirection.buy,
        signalCountsByDirection.buy,
      ),
      sell: buildLiveSignalMoveMetrics(
        observationsByDirection.sell,
        signalCountsByDirection.sell,
      ),
    },
    byScoreBucket: {
      high: buildLiveSignalMoveMetrics(
        observationsByScoreBucket.high,
        signalCountsByScoreBucket.high,
      ),
      standard: buildLiveSignalMoveMetrics(
        observationsByScoreBucket.standard,
        signalCountsByScoreBucket.standard,
      ),
      low: buildLiveSignalMoveMetrics(
        observationsByScoreBucket.low,
        signalCountsByScoreBucket.low,
      ),
      unknown: buildLiveSignalMoveMetrics(
        observationsByScoreBucket.unknown,
        signalCountsByScoreBucket.unknown,
      ),
    },
    byScoreRange,
    byScoreRangeDirection,
    scoreBuckets,
    scoreRangeBuckets: SIGNAL_SCORE_RANGE_BUCKETS,
    mtfFilteredOutCount: 0,
    horizonBars: Number.isFinite(Number(timelineBars)) ? Number(timelineBars) : null,
    perSymbol: [],
    source: "live",
  };
};

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
  return parsed.length
    ? Array.from(new Set(parsed)).sort((a, b) => a - b)
    : fallback;
};

export const formatProgressiveTrailSteps = (steps) =>
  Array.isArray(steps)
    ? steps
        .map((step) =>
          [
            Number(step?.activationPct),
            Number(step?.minLockedGainPct),
            Number(step?.givebackPct),
          ]
            .map((part) => (Number.isFinite(part) ? String(part) : ""))
            .join("/"),
        )
        .join(", ")
    : "";

export const formatWireTrailRungs = (steps) =>
  Array.isArray(steps)
    ? steps
        .map((step) => {
          const activationPct = Number(step?.activationPct);
          const rung = String(step?.rung || "").trim();
          return `${Number.isFinite(activationPct) ? activationPct : ""}/${rung}`;
        })
        .join(", ")
    : "";

const WIRE_TRAIL_RUNG_VALUES = new Set([
  "trendLine",
  "wire1",
  "wire2",
  "wire3",
]);
const WIRE_TRAIL_DISPLAY_ORDER = ["wire3", "wire2", "wire1", "trendLine"];
const WIRE_TRAIL_RUNG_LABELS = {
  wire3: "W3",
  wire2: "W2",
  wire1: "W1",
  trendLine: "TL",
};

export const parseWireTrailRungs = (value, fallback = []) => {
  const parsed = String(value || "")
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [activationRaw, rungRaw] = item.split(/[/:|\s]+/);
      const activationPct = Number(
        String(activationRaw || "").replace(/%$/, ""),
      );
      const rung = String(rungRaw || "").trim();
      return {
        activationPct,
        rung: WIRE_TRAIL_RUNG_VALUES.has(rung) ? rung : null,
      };
    })
    .filter((step) => Number.isFinite(step.activationPct) && step.rung)
    .map((step) => ({
      activationPct: Math.min(10_000, Math.max(0, step.activationPct)),
      rung: step.rung,
    }))
    .sort((left, right) => left.activationPct - right.activationPct);
  return parsed.length ? parsed : fallback;
};

const finiteMetricOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const textMetricOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

export const resolvePositionWireTrailState = (position) => {
  const record = asRecord(position);
  const stop = asRecord(record.lastStop ?? record.stop);
  const wireTrail = asRecord(record.lastWireTrail ?? stop.wireTrail);
  const selectedRung = textMetricOrNull(wireTrail.selectedRung);
  const greekFallbackReason = textMetricOrNull(wireTrail.greekFallbackReason);

  return {
    enabled: wireTrail.enabled === true,
    active: wireTrail.active === true,
    selectedRung: WIRE_TRAIL_RUNG_VALUES.has(selectedRung)
      ? selectedRung
      : null,
    selectedRungLabel: WIRE_TRAIL_RUNG_VALUES.has(selectedRung)
      ? WIRE_TRAIL_RUNG_LABELS[selectedRung]
      : MISSING_VALUE,
    selectedWirePrice: finiteMetricOrNull(wireTrail.selectedWirePrice),
    latestUnderlyingClose: finiteMetricOrNull(wireTrail.latestUnderlyingClose),
    structureBreak: wireTrail.structureBreak === true,
    regimeFlipAgainstPosition: wireTrail.regimeFlipAgainstPosition === true,
    greekFresh: wireTrail.greekFresh === true,
    greekAgeMs: finiteMetricOrNull(wireTrail.greekAgeMs),
    greekFallbackReason,
    deltaSizedGiveback: finiteMetricOrNull(wireTrail.deltaSizedGiveback),
  };
};

export const deriveWireTrailControlSummary = ({ profile, positions } = {}) => {
  const exitPolicy = asRecord(asRecord(profile).exitPolicy);
  const wireGreekTrail = asRecord(exitPolicy.wireGreekTrail);
  const enabled = wireGreekTrail.enabled === true;
  const positionList = Array.isArray(positions) ? positions : [];
  const states = positionList.map(resolvePositionWireTrailState);
  const openPositions = positionList.length;
  const activePositions = states.filter((state) => state.active).length;
  const floorOnlyPositions = enabled
    ? Math.max(0, openPositions - activePositions)
    : openPositions;
  const missingWireContextPositions = enabled
    ? states.filter(
        (state) =>
          !state.active &&
          state.selectedWirePrice == null &&
          state.latestUnderlyingClose == null,
      ).length
    : 0;
  const greekFallbackPositions = states.filter((state) =>
    Boolean(state.greekFallbackReason),
  ).length;
  const staleGreekPositions = states.filter((state) =>
    /stale/i.test(state.greekFallbackReason || ""),
  ).length;
  const missingGreekPositions = states.filter((state) =>
    /missing|unavailable|absent/i.test(state.greekFallbackReason || ""),
  ).length;
  const freshGreekPositions = states.filter((state) => state.greekFresh).length;
  const structureBreakPositions = states.filter(
    (state) => state.structureBreak,
  ).length;
  const regimeFlipPositions = states.filter(
    (state) => state.regimeFlipAgainstPosition,
  ).length;
  const rungCounts = WIRE_TRAIL_DISPLAY_ORDER.reduce(
    (counts, rung) => ({ ...counts, [rung]: 0 }),
    {},
  );
  for (const state of states) {
    if (state.selectedRung && Object.hasOwn(rungCounts, state.selectedRung)) {
      rungCounts[state.selectedRung] += 1;
    }
  }
  const runnerPollIntervalSeconds = finiteMetricOrNull(
    wireGreekTrail.runnerPollIntervalSeconds,
  );
  const degraded =
    enabled &&
    openPositions > 0 &&
    (missingWireContextPositions > 0 || greekFallbackPositions > 0);
  const status = !enabled
    ? "off"
    : degraded
      ? "degraded"
      : activePositions > 0
        ? "active"
        : "armed";
  const statusLabel = {
    off: "OFF",
    armed: "ARMED",
    active: "ACTIVE",
    degraded: "DEGRADED",
  }[status];
  const rungSummary = WIRE_TRAIL_DISPLAY_ORDER.map(
    (rung) => `${WIRE_TRAIL_RUNG_LABELS[rung]} ${rungCounts[rung] ?? 0}`,
  ).join(" · ");
  const greekSummary = !enabled
    ? MISSING_VALUE
    : openPositions === 0
      ? "ready"
      : greekFallbackPositions > 0
        ? `${freshGreekPositions}/${openPositions} fresh · ${greekFallbackPositions} fallback`
        : `${freshGreekPositions}/${openPositions} fresh`;
  const structureSummary = !enabled
    ? MISSING_VALUE
    : openPositions === 0
      ? "armed"
      : `${activePositions}/${openPositions} wire`;

  return {
    enabled,
    status,
    statusLabel,
    openPositions,
    activePositions,
    floorOnlyPositions,
    missingWireContextPositions,
    freshGreekPositions,
    greekFallbackPositions,
    staleGreekPositions,
    missingGreekPositions,
    structureBreakPositions,
    regimeFlipPositions,
    runnerPollIntervalSeconds,
    rungCounts,
    rungSummary,
    greekSummary,
    structureSummary,
  };
};

export const parseProgressiveTrailSteps = (value, fallback = []) => {
  const parsed = String(value || "")
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [activationPct, minLockedGainPct, givebackPct] = item
        .split(/[/:|\s]+/)
        .map((part) => Number(part.trim().replace(/%$/, "")));
      return {
        activationPct,
        minLockedGainPct,
        givebackPct,
      };
    })
    .filter(
      (step) =>
        Number.isFinite(step.activationPct) &&
        Number.isFinite(step.minLockedGainPct) &&
        Number.isFinite(step.givebackPct),
    )
    .map((step) => ({
      activationPct: Math.min(10_000, Math.max(0, step.activationPct)),
      minLockedGainPct: Math.min(10_000, Math.max(0, step.minLockedGainPct)),
      givebackPct: Math.min(100, Math.max(0, step.givebackPct)),
    }))
    .sort((left, right) => left.activationPct - right.activationPct);
  return parsed.length ? parsed : fallback;
};

export const formatContractLabel = (contract) => {
  const label = formatOptionContractLabel(asRecord(contract), {
    includeSymbol: false,
    fallback: "",
  });
  return label || MISSING_VALUE;
};

export const optionProviderContractId = (contract) =>
  String(
    asRecord(contract).providerContractId || asRecord(contract).conid || "",
  ).trim();

const positiveNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

export const mergeOptionQuoteSnapshot = (quote, liveQuote) => {
  const base = asRecord(quote);
  const live = asRecord(liveQuote);
  if (!Object.keys(live).length) return base;
  const liveLast = positiveNumberOrNull(live.last ?? live.price);
  const liveMark = positiveNumberOrNull(live.mark ?? live.price);
  return {
    ...base,
    bid: positiveNumberOrNull(live.bid) ?? base.bid,
    ask: positiveNumberOrNull(live.ask) ?? base.ask,
    last: liveLast ?? base.last,
    mark: liveMark ?? base.mark,
    impliedVolatility: live.impliedVolatility ?? base.impliedVolatility,
    delta: live.delta ?? base.delta,
    gamma: live.gamma ?? base.gamma,
    theta: live.theta ?? base.theta,
    vega: live.vega ?? base.vega,
    openInterest: live.openInterest ?? base.openInterest,
    volume: live.volume ?? base.volume,
    quoteFreshness:
      live.quoteFreshness ?? live.freshness ?? base.quoteFreshness,
    marketDataMode: live.marketDataMode ?? base.marketDataMode,
    quoteUpdatedAt:
      live.quoteUpdatedAt ?? live.updatedAt ?? base.quoteUpdatedAt,
    dataUpdatedAt: live.dataUpdatedAt ?? base.dataUpdatedAt,
    updatedAt: live.updatedAt ?? base.updatedAt,
    ageMs: live.ageMs ?? live.cacheAgeMs ?? base.ageMs,
  };
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const numeric = positiveNumberOrNull(value);
    if (numeric != null) return numeric;
  }
  return null;
};

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const quoteStateDisplay = (record) => {
  const state = firstText(
    record.quoteFreshness,
    record.freshness,
    record.status,
    record.marketDataMode,
  );
  const reason = firstText(
    record.reason,
    record.blockedReason,
    record.errorMessage,
  );
  if (!state && !reason) return null;
  return {
    main: state ? formatEnumLabel(state) : "Unavailable",
    detail: reason ? formatEnumLabel(reason) : MISSING_VALUE,
  };
};

const formatOptionalMoney = (value, digits = 2) =>
  value === null || value === undefined || value === ""
    ? MISSING_VALUE
    : formatMoney(value, digits);

export const formatCompactMetric = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000)
    return `${(numeric / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000)
    return `${(numeric / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return numeric.toFixed(0);
};

const parseExpirationDate = (value) => {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDteLabel = (expirationDate, now = new Date()) => {
  const expiration = parseExpirationDate(expirationDate);
  const current = now instanceof Date ? now : new Date(now);
  if (!expiration || Number.isNaN(current.getTime())) return MISSING_VALUE;
  const currentDate = new Date(
    Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate(),
    ),
  );
  const days = Math.round(
    (expiration.getTime() - currentDate.getTime()) / 86_400_000,
  );
  return days >= 0 ? `${days}DTE` : `${Math.abs(days)}d exp`;
};

// Numeric days-to-expiry from a contract expiration date, sharing the same
// parser/UTC-floor as formatDteLabel so the Contract column and DTE-aware
// thresholds stay consistent. Returns null when the expiration can't be parsed.
export const resolveDteDays = (expirationDate, now = new Date()) => {
  const expiration = parseExpirationDate(expirationDate);
  const current = now instanceof Date ? now : new Date(now);
  if (!expiration || Number.isNaN(current.getTime())) return null;
  const currentDate = new Date(
    Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate(),
    ),
  );
  return Math.round((expiration.getTime() - currentDate.getTime()) / 86_400_000);
};

export const formatContractProviderLabel = (contract) => {
  const record = asRecord(contract);
  const providerContractId = firstText(record.providerContractId, record.conid);
  if (providerContractId) {
    const compactId =
      providerContractId.length > 18
        ? `${providerContractId.slice(0, 8)}...${providerContractId.slice(-6)}`
        : providerContractId;
    return `conid ${compactId}`;
  }
  const ticker = firstText(
    record.ticker,
    record.optionTicker,
    record.localSymbol,
  );
  return ticker || MISSING_VALUE;
};

export const formatContractDetail = (contract, { now } = {}) => {
  const record = asRecord(contract);
  const main = formatContractLabel(record);
  if (main === MISSING_VALUE) {
    return { main, detail: MISSING_VALUE };
  }
  const multiplier = firstFiniteNumber(
    record.multiplier,
    record.sharesPerContract,
  );
  const provider = formatContractProviderLabel(record);
  const detail = [
    formatDteLabel(record.expirationDate ?? record.exp ?? record.expiry, now),
    multiplier ? `x${multiplier}` : null,
    provider !== MISSING_VALUE ? provider : null,
  ].filter((value) => value && value !== MISSING_VALUE);
  return {
    main,
    detail: detail.length ? detail.join(" · ") : MISSING_VALUE,
  };
};

export const formatQuoteSummary = (quote, liquidity) => {
  const quoteRecord = asRecord(quote);
  const liquidityRecord = asRecord(liquidity);
  const bid = firstPositiveNumber(quoteRecord.bid, liquidityRecord.bid);
  const ask = firstPositiveNumber(quoteRecord.ask, liquidityRecord.ask);
  const mid = firstPositiveNumber(quoteRecord.mid, liquidityRecord.mid);
  const mark = firstPositiveNumber(quoteRecord.mark, liquidityRecord.mark);
  const last = firstPositiveNumber(
    quoteRecord.last,
    quoteRecord.price,
    liquidityRecord.last,
  );
  const spreadPct = firstFiniteNumber(
    quoteRecord.spreadPctOfMid,
    liquidityRecord.spreadPctOfMid,
  );
  const spreadCents =
    firstFiniteNumber(quoteRecord.spreadCents, liquidityRecord.spreadCents) ??
    (bid != null && ask != null ? (ask - bid) * 100 : null);
  const freshness = firstText(
    quoteRecord.quoteFreshness,
    quoteRecord.freshness,
    liquidityRecord.freshness,
  );
  const mode = firstText(
    quoteRecord.marketDataMode,
    liquidityRecord.marketDataMode,
  );
  const main =
    bid != null || ask != null
      ? `${formatOptionalMoney(bid, 2)} / ${formatOptionalMoney(ask, 2)}`
      : mark != null
        ? `mark ${formatOptionalMoney(mark, 2)}`
        : last != null
          ? `last ${formatOptionalMoney(last, 2)}`
          : MISSING_VALUE;
  const stateDisplay = quoteStateDisplay(quoteRecord);
  if (main === MISSING_VALUE && stateDisplay) {
    return stateDisplay;
  }
  const priceDetail = [
    mid != null ? `mid ${formatOptionalMoney(mid, 2)}` : null,
    mark != null ? `mark ${formatOptionalMoney(mark, 2)}` : null,
    last != null && mark == null
      ? `last ${formatOptionalMoney(last, 2)}`
      : null,
  ].filter(Boolean);
  const marketDetail = [
    spreadPct != null
      ? `spr ${formatPct(spreadPct)}`
      : spreadCents != null
        ? `spr ${spreadCents.toFixed(0)}c`
        : null,
    freshness ? formatEnumLabel(freshness) : null,
    mode ? formatEnumLabel(mode) : null,
  ].filter(Boolean);
  const detail = [...priceDetail.slice(0, 2), ...marketDetail.slice(0, 2)];
  return {
    main,
    detail: detail.length ? detail.join(" · ") : MISSING_VALUE,
  };
};

const formatIvLabel = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  const pct = Math.abs(numeric) <= 3 ? numeric * 100 : numeric;
  return `${pct.toFixed(1)}%`;
};

const formatGreekNumber = (value, digits = 2) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : MISSING_VALUE;
};

export const formatQuoteGreeksSummary = (quote) => {
  const record = asRecord(quote);
  const delta = formatGreekNumber(record.delta, 2);
  const iv = formatIvLabel(record.impliedVolatility);
  const gamma = formatGreekNumber(record.gamma, 3);
  const theta = formatGreekNumber(record.theta, 3);
  const vega = formatGreekNumber(record.vega, 3);
  const openInterest = formatCompactMetric(record.openInterest);
  const volume = formatCompactMetric(record.volume);
  const main = [
    delta !== MISSING_VALUE ? `d ${delta}` : null,
    iv !== MISSING_VALUE ? `IV ${iv}` : null,
  ].filter(Boolean);
  const detail = [
    openInterest !== MISSING_VALUE ? `OI ${openInterest}` : null,
    volume !== MISSING_VALUE ? `Vol ${volume}` : null,
  ].filter(Boolean);
  const full = [
    gamma !== MISSING_VALUE ? `g ${gamma}` : null,
    theta !== MISSING_VALUE ? `th ${theta}` : null,
    vega !== MISSING_VALUE ? `v ${vega}` : null,
  ].filter(Boolean);
  if (!main.length) {
    const stateDisplay = quoteStateDisplay(record);
    if (stateDisplay) {
      return {
        main: firstText(record.reason).includes("greek")
          ? formatEnumLabel(record.reason)
          : "Greeks pending",
        detail: stateDisplay.detail,
        full: MISSING_VALUE,
      };
    }
  }
  return {
    main: main.length ? main.join(" / ") : MISSING_VALUE,
    detail: detail.length ? detail.join(" / ") : MISSING_VALUE,
    full: full.length ? full.join(" / ") : MISSING_VALUE,
  };
};

export const formatContractSelectionSummary = (selection) => {
  const record = asRecord(selection);
  const attempts = Array.isArray(record.attempts) ? record.attempts : [];
  const preferredSlot = firstText(record.preferredSlot);
  const selectedSlot = firstText(record.selectedSlot);
  const main = [
    selectedSlot ? `selected slot ${selectedSlot}` : null,
    preferredSlot && preferredSlot !== selectedSlot
      ? `preferred ${preferredSlot}`
      : null,
  ].filter(Boolean);
  const failedAttempt = attempts.find((attempt) =>
    firstText(asRecord(attempt).reason),
  );
  const detail = [
    record.fallbackUsed === true
      ? "fallback used"
      : attempts.length
        ? "preferred path"
        : null,
    attempts.length
      ? `${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`
      : null,
    failedAttempt ? formatEnumLabel(asRecord(failedAttempt).reason) : null,
  ].filter(Boolean);
  return {
    main: main.length ? main.join(" · ") : MISSING_VALUE,
    detail: detail.length ? detail.join(" · ") : MISSING_VALUE,
  };
};

export const signalOptionsActionColor = (status) => {
  if (status === "shadow_filled") return CSS_COLOR.green;
  if (status === "manual_override" || status === "partial_shadow")
    return CSS_COLOR.amber;
  if (status === "blocked" || status === "mismatch") return CSS_COLOR.red;
  if (status === "closed") return CSS_COLOR.textDim;
  return CSS_COLOR.cyan;
};

export const cockpitStageColor = (status) => {
  if (status === "healthy") return CSS_COLOR.green;
  if (status === "running") return CSS_COLOR.cyan;
  if (status === "idle") return CSS_COLOR.cyan;
  if (status === "attention" || status === "stale") return CSS_COLOR.amber;
  if (status === "blocked") return CSS_COLOR.red;
  return CSS_COLOR.textDim;
};

export const cockpitAttentionColor = (severity) => {
  if (severity === "warning") return CSS_COLOR.red;
  if (severity === "warning") return CSS_COLOR.amber;
  return CSS_COLOR.cyan;
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
  ["exitPolicy", "earlyExitBars", "Early exit bars", 1],
  ["exitPolicy", "earlyExitLossPct", "Early exit loss %", 1],
  ["exitPolicy", "overnightMinGainPct", "Overnight min gain %", 1],
  ["exitPolicy", "overnightRunnerGivebackPct", "Overnight giveback %", 1],
  ["exitPolicy", "lowQualityEarlyExitBars", "Low-quality exit bars", 1],
  ["exitPolicy", "lowQualityEarlyExitLossPct", "Low-quality loss %", 1],
  ["exitPolicy", "highQualityEarlyExitBars", "High-quality exit bars", 1],
  ["exitPolicy", "highQualityEarlyExitLossPct", "High-quality loss %", 1],
  [
    "exitPolicy",
    "weakLiquidityTrailGivebackPct",
    "Weak liquidity giveback %",
    1,
  ],
  [
    "exitPolicy",
    "strongLiquidityTrailGivebackPct",
    "Strong liquidity giveback %",
    1,
  ],
  [
    "exitPolicy",
    "highQualityOvernightMinGainPct",
    "High-quality overnight min %",
    1,
  ],
];

export const PROFILE_BOOLEAN_FIELDS = [
  ["optionSelection", "allowZeroDte", "Allow 0DTE"],
  ["liquidityGate", "requireBidAsk", "Require bid/ask"],
  ["liquidityGate", "requireFreshQuote", "Require fresh quote"],
  ["exitPolicy", "flipOnOppositeSignal", "Exit on opposite signal"],
  ["exitPolicy", "overnightExitEnabled", "Overnight exit enabled"],
  ["exitPolicy", "progressiveTrailEnabled", "Progressive trail enabled"],
  ["exitPolicy", "conditionalQualityExitsEnabled", "Quality exits enabled"],
];

export const SIGNAL_OPTIONS_HALT_CONTROL_GROUPS = [
  {
    id: "risk",
    label: "Risk",
    controls: [
      {
        id: "dailyLoss",
        section: "riskHaltControls",
        key: "dailyLossHaltEnabled",
        label: "Daily loss",
        title:
          "Blocks new entries once daily P&L breaches the configured loss halt.",
        reasons: ["daily_loss_halt_active"],
      },
      {
        id: "openSymbols",
        section: "riskHaltControls",
        key: "openSymbolCapEnabled",
        label: "Open symbols",
        title:
          "Blocks new symbols once open exposure reaches the configured cap.",
        reasons: ["max_open_symbols_reached"],
      },
      {
        id: "premiumBudget",
        section: "riskHaltControls",
        key: "premiumBudgetEnabled",
        label: "Premium budget",
        title:
          "Caps entry quantity by the configured premium-per-entry budget.",
        reasons: ["premium_budget_too_small", "premium_budget_exceeded"],
      },
      {
        id: "tradingAllowance",
        section: "riskHaltControls",
        key: "tradingAllowanceEnabled",
        label: "Allowance",
        title:
          "Caps total open premium per deployment to a virtual sub-account budget (net of fees). Entries size down to fit; positions are never force-closed. Simulation only.",
        reasons: [
          "trading_allowance_exhausted",
          "trading_allowance_sized_down",
        ],
      },
    ],
  },
  {
    id: "signal",
    label: "Signal",
    controls: [
      // MTF alignment quick-toggle removed: MTF is governed by the SIGNAL FRAMES
      // selection (its enable flag is forced on in profile normalization).
      {
        id: "inversePutBlocklist",
        section: "entryHaltControls",
        key: "inversePutBlocklistEnabled",
        label: "Inverse puts",
        title:
          "Blocks put entries on inverse ETF symbols in the configured blocklist.",
        reasons: ["inverse_put_blocked"],
      },
    ],
  },
  {
    id: "quote",
    label: "Quote",
    controls: [
      {
        id: "bidAskRequired",
        section: "liquidityHaltControls",
        key: "bidAskRequiredEnabled",
        label: "Bid/ask",
        title:
          "Blocks entries without a usable bid/ask quote when bid/ask is required.",
        reasons: ["missing_bid_ask"],
      },
      {
        id: "freshQuoteRequired",
        section: "liquidityHaltControls",
        key: "freshQuoteRequiredEnabled",
        label: "Fresh quote",
        title:
          "Blocks entries when the option quote is stale, pending, or unavailable.",
        reasons: ["quote_not_fresh"],
      },
      {
        id: "spreadGate",
        section: "liquidityHaltControls",
        key: "spreadGateEnabled",
        label: "Spread",
        title:
          "Blocks entries when bid/ask spread exceeds the configured percent of mid.",
        reasons: ["spread_too_wide"],
      },
      {
        id: "minBidGate",
        section: "liquidityHaltControls",
        key: "minBidGateEnabled",
        label: "Minimum bid",
        title: "Blocks entries when bid is below the configured minimum.",
        reasons: ["bid_below_minimum"],
      },
    ],
  },
  {
    id: "position",
    label: "Position",
    controls: [
      {
        id: "sameDirectionPosition",
        section: "positionHaltControls",
        key: "sameDirectionPositionBlockEnabled",
        label: "Same direction",
        title:
          "Blocks duplicate same-direction entries for a symbol that already has an active position.",
        reasons: ["same_direction_position_open"],
      },
      {
        id: "oppositeSignalFlip",
        section: "positionHaltControls",
        key: "oppositeSignalFlipBlockEnabled",
        label: "Opposite flip",
        title:
          "Blocks opposite-signal flips when the exit policy has flipping disabled.",
        reasons: ["opposite_signal_flip_disabled"],
      },
      {
        id: "positionMarkFeed",
        section: "positionHaltControls",
        key: "positionMarkFeedHaltEnabled",
        label: "Mark feed",
        title:
          "Blocks new entries while open positions cannot be marked reliably.",
        reasons: ["position_mark_feed_degraded"],
      },
    ],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    controls: [
      {
        id: "gatewayReadiness",
        section: "infrastructureHaltControls",
        key: "gatewayReadinessBlockEnabled",
        label: "Gateway",
        title:
          "Blocks entries when broker/data gateway readiness is not green.",
        reasons: [
          "algo_gateway_not_ready",
          "accounts_unavailable",
          "bridge_health_unavailable",
          "ibkr_not_configured",
          "gateway_login_required",
          "gateway_socket_disconnected",
          "gateway_not_ready",
          "bridge_unavailable",
          "live_market_data_not_configured",
          "market_session_quiet",
        ],
      },
      {
        id: "resourcePressure",
        section: "infrastructureHaltControls",
        key: "resourcePressureScanBlockEnabled",
        label: "Resource load",
        title:
          "Lets API resource-pressure automation skip deployment scans under load.",
        reasons: [],
      },
      {
        id: "contractBackoff",
        section: "infrastructureHaltControls",
        key: "contractResolutionBackoffEnabled",
        label: "Contract backoff",
        title:
          "Lets option-chain and expiration backoff skips suppress repeat contract resolution attempts.",
        reasons: ["option_chain_backoff", "option_expiration_backoff"],
      },
    ],
  },
];

export const signalOptionsHaltControlValue = (profile, control) => {
  const section = asRecord(asRecord(profile)[control.section]);
  const defaults = asRecord(SIGNAL_OPTIONS_DEFAULT_PROFILE[control.section]);
  const value = section[control.key];
  if (typeof value === "boolean") return value;
  const defaultValue = defaults[control.key];
  return typeof defaultValue === "boolean" ? defaultValue : true;
};

const allSignalOptionsHaltControls = () =>
  SIGNAL_OPTIONS_HALT_CONTROL_GROUPS.flatMap((group) => group.controls);

export const signalOptionsHaltControlsChanged = (draft, saved) =>
  allSignalOptionsHaltControls().some(
    (control) =>
      signalOptionsHaltControlValue(draft, control) !==
      signalOptionsHaltControlValue(saved, control),
  );

const incrementHaltReasonCounter = (counter, reason) => {
  const key = String(reason || "").trim();
  if (!key) return;
  counter[key] = (counter[key] || 0) + 1;
};

const signalOptionsHaltReasonCounts = (cockpit) => {
  const record = asRecord(cockpit);
  const counts = { ...asRecord(asRecord(record.diagnostics).skipReasons) };
  (Array.isArray(record.events) ? record.events : []).forEach((event) => {
    const payload = asRecord(asRecord(event).payload);
    incrementHaltReasonCounter(counts, payload.reason || payload.skipReason);
  });
  (Array.isArray(record.candidates) ? record.candidates : []).forEach(
    (candidate) => {
      const candidateRecord = asRecord(candidate);
      incrementHaltReasonCounter(counts, candidateRecord.reason);
      const entryGate = asRecord(candidateRecord.entryGate);
      if (Array.isArray(entryGate.reasons)) {
        entryGate.reasons.forEach((reason) =>
          incrementHaltReasonCounter(counts, reason),
        );
      }
    },
  );
  return counts;
};

const haltReasonCount = (counts, reasons = []) =>
  reasons.reduce((sum, reason) => sum + Number(counts[reason] || 0), 0);

export const deriveSignalOptionsHaltControlStatus = ({
  control,
  profile,
  cockpit,
} = {}) => {
  const enabled = signalOptionsHaltControlValue(profile, control);
  const counts = signalOptionsHaltReasonCounts(cockpit);
  const record = asRecord(cockpit);
  const risk = asRecord(record.risk);
  const kpis = asRecord(record.kpis);
  const readiness = asRecord(record.readiness);
  const reasonCount = haltReasonCount(counts, control?.reasons);
  const openSymbols = Number(risk.openSymbols ?? kpis.openSymbols);
  const maxOpenSymbols = Number(risk.maxOpenSymbols ?? kpis.maxOpenSymbols);
  const gatewayNotReady =
    control?.id === "gatewayReadiness" && readiness.ready === false;
  const breachedDailyLoss =
    control?.id === "dailyLoss" &&
    (risk.dailyHaltActive === true || risk.dailyLossBreached === true);
  const atOpenSymbolCap =
    control?.id === "openSymbols" &&
    Number.isFinite(openSymbols) &&
    Number.isFinite(maxOpenSymbols) &&
    openSymbols >= maxOpenSymbols;
  const active = Boolean(
    reasonCount > 0 || breachedDailyLoss || atOpenSymbolCap || gatewayNotReady,
  );

  if (!enabled && gatewayNotReady) {
    return { state: "forced", label: "FORCED", reasonCount };
  }
  if (!enabled) {
    return { state: "off", label: "OFF", reasonCount };
  }
  if (active) {
    return { state: "active", label: "ACTIVE", reasonCount };
  }
  return { state: "armed", label: "ARMED", reasonCount };
};

export const compactButtonStyle = ({
  active = false,
  color = CSS_COLOR.accent,
  fill = false,
  disabled = false,
} = {}) => ({
  padding: sp("6px 12px"),
  borderRadius: dim(RADII.pill),
  border: "none",
  background: active ? color : CSS_COLOR.bg2,
  color: active ? CSS_COLOR.onAccent : CSS_COLOR.text,
  fontSize: textSize("caption"),
  fontFamily: T.sans,
  fontWeight: active ? 600 : 500,
  letterSpacing: "0.02em",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  width: fill ? "100%" : "auto",
  whiteSpace: "nowrap",
});
