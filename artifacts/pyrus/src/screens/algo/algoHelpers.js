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
    requiredCount: 2,
  },
  {
    value: "scalp",
    label: "Scalp",
    timeframes: ["1m", "2m", "5m"],
    requiredCount: 2,
  },
  {
    value: "balanced",
    label: "Balanced",
    timeframes: ["5m", "15m", "1h"],
    requiredCount: 2,
  },
  {
    value: "higher_timeframe",
    label: "Higher TF",
    timeframes: ["15m", "1h", "1d"],
    requiredCount: 2,
  },
  {
    value: "six_frame",
    label: "Six",
    timeframes: SIGNAL_OPTIONS_MTF_TIMEFRAMES,
    requiredCount: 3,
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
      requiredCount: 2,
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
    hardStopPct: -30,
    trailActivationPct: 35,
    minLockedGainPct: 15,
    trailGivebackPct: 20,
    tightenAtFiveXGivebackPct: 30,
    tightenAtTenXGivebackPct: 15,
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
    bearishRegimeEnabled: true,
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
  bear_regime_gate_failed: "signal_policy",
  mtf_not_aligned: "signal_policy",
  inverse_put_blocked: "signal_policy",
  entry_gate_failed: "signal_policy",
  same_direction_position_open: "signal_policy",
  opposite_signal_flip_disabled: "signal_policy",
  candidate_resolution_failed: "signal_policy",
  signal_age_unavailable: "signal_policy",
  signal_too_old: "signal_policy",
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
      if (!direction || !signalAt) return null;

      const status = normalizeMatchKey(
        stateRecord.status || "ok",
      ).toLowerCase();
      if (status === "pending" || status === "unknown") return null;
      const signalPrice =
        staFiniteNumberOrNull(stateRecord.currentSignalPrice) ??
        staFiniteNumberOrNull(stateRecord.signalPrice);
      // Current price as of the last evaluation (close of the bar at
      // latestBarAt). Lets the Move column render immediately from the matrix
      // state instead of waiting on per-page sparkline hydration, so it stays
      // populated across execution-timeframe changes. Live quote/sparkline
      // snapshots still override this in resolveSignalMove when present.
      const currentPrice = staFiniteNumberOrNull(stateRecord.latestBarClose);
      const barsSinceSignal = staFiniteNumberOrNull(
        stateRecord.barsSinceSignal,
      );
      const fresh = stateRecord.fresh === true;
      // Actionability is backend-authored (SSE matrix stream + REST both
      // carry it). A state without the fields is ineligible by default —
      // the safe direction; no client-side age inference remains.
      const actionBlocker =
        normalizeMatchKey(stateRecord.actionBlocker) || null;
      const actionEligible = stateRecord.actionEligible === true;

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
        signalAt,
        currentSignalAt: signalAt,
        signalPrice,
        currentSignalPrice: signalPrice,
        currentPrice,
        latestBarAt:
          staIsoStringOrNull(stateRecord.latestBarAt) ??
          staIsoStringOrNull(stateRecord.lastEvaluatedAt) ??
          signalAt,
        barsSinceSignal,
        fresh,
        actionEligible,
        actionBlocker: actionEligible ? null : actionBlocker,
        status,
        filterState: Object.keys(asRecord(stateRecord.filterState)).length
          ? asRecord(stateRecord.filterState)
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
      const signalPrice =
        staFiniteNumberOrNull(eventRecord.signalPrice) ??
        staFiniteNumberOrNull(eventRecord.close);
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
        signalPrice,
        currentSignalPrice: signalPrice,
        close: staFiniteNumberOrNull(eventRecord.close),
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
      signalRowSignalTimestampMs(right) - signalRowSignalTimestampMs(left),
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
  const liveQuote = firstPresentFiniteMetric(
    snapshot.price,
    snapshot.last,
    snapshot.mark,
  );
  if (liveQuote != null) {
    return { price: liveQuote, source: "quote", live: true };
  }
  const barClose = firstPresentFiniteMetric(
    record.currentPrice,
    record.last,
    record.mark,
    latestSparklineClose(snapshot, record),
  );
  if (barClose != null) {
    return { price: barClose, source: "bar", live: false };
  }
  const firePrice = finitePresentNumberOrNull(record.signalPrice);
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
// from status !== "ok"), staleness is the row's own monitor state - NOT a quote
// freshness/cacheAgeMs heuristic (those cannot represent a 15h-stale row).
const resolveMoveStaleness = (record) => {
  if (record.stale === true) return true;
  if (String(record.actionBlocker || "").toLowerCase() === "data_stale") {
    return true;
  }
  const status = String(record.status || "")
    .trim()
    .toLowerCase();
  return status !== "" && status !== "ok";
};

export const resolveSignalMove = (
  signal,
  tickerSnapshot = null,
  candidate = null,
) => {
  const record = asRecord(signal);
  const snapshot = asRecord(tickerSnapshot);
  const candidateRecord = asRecord(candidate);
  const signalPrice = firstPositivePresentMetric(
    record.signalPrice,
    record.currentSignalPrice,
    record.entryPrice,
    record.basisPrice,
    candidateRecord.signalPrice,
    candidateRecord.currentSignalPrice,
    candidateRecord.entryPrice,
    candidateRecord.basisPrice,
  );
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
    };
  }
  const value = currentPrice - signalPrice;
  const pct = (value / signalPrice) * 100;
  return {
    value,
    pct,
    label: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    detail: `${value >= 0 ? "+" : ""}${value.toFixed(2)}`,
    stale: resolveMoveStaleness(record),
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
    .replace(/\bAdx\b/, "ADX");

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

export const resolveSignalScoreBreakdown = ({
  signal,
  candidate,
  quote,
  liquidity,
  freshWindowBars,
} = {}) => {
  const candidateRecord = asRecord(candidate);
  const signalRecord = asRecord(signal ?? candidateRecord.signal);
  const quality = asRecord(candidateRecord.signalQuality);
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

  const filterState = asRecord(signalRecord.filterState);
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
  const signalAge = resolveSignalAge(signalRecord, { freshWindowBars });
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
  const quoteFreshness = firstText(
    quoteRecord.quoteFreshness,
    quoteRecord.freshness,
    orderLiquidity.freshness,
  );
  const marketDataMode = firstText(
    quoteRecord.marketDataMode,
    orderLiquidity.marketDataMode,
  );
  const mtfAlignment = mtfAlignmentScore(mtfDirections, mtfMatches);
  const freshness = (signalAge.freshnessPct / 100) * 20;
  const trendStrength = adx == null ? 7.5 : clampMetric(adx / 25, 0, 1) * 15;
  const liquidityScore =
    liquidityTier === "strong" ? 20 : liquidityTier === "weak" ? 0 : 12;
  const riskFit = premiumAtRisk != null && premiumAtRisk > 0 ? 10 : 5;
  const dataQuality =
    quoteFreshness === "live" || marketDataMode === "live"
      ? 10
      : quoteFreshness || marketDataMode
        ? 7
        : signalRecord.status === "unavailable"
          ? 3
          : 8;
  const score =
    mtfAlignment +
    freshness +
    trendStrength +
    liquidityScore +
    riskFit +
    dataQuality;
  const reasons = [
    mtfAlignmentReason(mtfDirections, mtfMatches),
    signalAge.freshnessPct >= 67
      ? "fresh_signal"
      : signalAge.freshnessPct <= 20
        ? "aging_signal"
        : null,
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
      mtfAlignment: Number(mtfAlignment.toFixed(1)),
      freshness: Number(freshness.toFixed(1)),
      trendStrength: Number(trendStrength.toFixed(1)),
      liquidity: Number(liquidityScore.toFixed(1)),
      riskFit: Number(riskFit.toFixed(1)),
      dataQuality: Number(dataQuality.toFixed(1)),
      total: roundedScore,
    },
    raw: {
      barsSinceSignal: signalAge.barsSinceSignal,
      freshWindowBars: signalAge.freshWindowBars,
      adx,
      mtfMatches,
      mtfDirections,
      spreadPctOfMid,
      premiumAtRisk,
      quoteFreshness,
      marketDataMode,
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
    },
    liquidityHaltControls: {
      ...SIGNAL_OPTIONS_DEFAULT_PROFILE.liquidityHaltControls,
      ...asRecord(rawProfile.liquidityHaltControls),
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
    requiredCount: Math.min(
      mtfTimeframes.length,
      Math.max(1, Math.round(numberFrom(mtfAlignment.requiredCount, 2))),
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
  ["exitPolicy", "tightenAtFiveXGivebackPct", "5x giveback %", 5],
  ["exitPolicy", "tightenAtTenXGivebackPct", "10x giveback %", 5],
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
      {
        id: "mtfAlignment",
        section: "entryHaltControls",
        key: "mtfAlignmentEnabled",
        label: "MTF alignment",
        title:
          "Blocks entries when multi-timeframe alignment is below the configured count.",
        reasons: ["mtf_not_aligned"],
      },
      {
        id: "inversePutBlocklist",
        section: "entryHaltControls",
        key: "inversePutBlocklistEnabled",
        label: "Inverse puts",
        title:
          "Blocks put entries on inverse ETF symbols in the configured blocklist.",
        reasons: ["inverse_put_blocked"],
      },
      {
        id: "bearishRegime",
        section: "entryHaltControls",
        key: "bearishRegimeEnabled",
        label: "Bear regime",
        title:
          "Blocks put entries that fail the configured bearish-regime filter.",
        reasons: [
          "bear_regime_gate_failed",
          "adx_below_minimum",
          "mtf_fully_bullish",
        ],
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
