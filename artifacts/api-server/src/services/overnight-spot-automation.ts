import { createHash } from "node:crypto";
import type { PyrusSignalsSignalEvent } from "@workspace/pyrus-signals-core";
import { asNumber, asRecord, asString, normalizeSymbol } from "../lib/values";
import type { PlaceOrderInput } from "../providers/ibkr/client";

export const OVERNIGHT_SPOT_LIVE_ENABLE_ENV =
  "PYRUS_ENABLE_LIVE_OVERNIGHT_SPOT";
export const OVERNIGHT_SPOT_LIVE_CONFIRM_ENV =
  "PYRUS_CONFIRM_LIVE_OVERNIGHT_SPOT";
export const OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE =
  "I_UNDERSTAND_IBKR_OVERNIGHT_RISK";

const DEFAULT_MAX_QUOTE_AGE_MS = 30_000;
const DEFAULT_MAX_SIGNAL_AGE_MS = 5 * 60_000;
const DEFAULT_MAX_SPREAD_PERCENT = 1;
const DEFAULT_LIMIT_OFFSET_BPS = 5;
const DEFAULT_PRICE_TICK = 0.01;
const OVERNIGHT_SPOT_CLIENT_ORDER_PREFIX = "overnight-spot";
const OVERNIGHT_SPOT_EVENT_PREFIX = "overnight_spot";

export type OvernightSpotExecutionMode = "disabled" | "shadow" | "live";
export type OvernightSpotSignalSide = "buy" | "sell";
export type OvernightSpotSignalStage = "entry" | "exit";
export type OvernightSpotTradingSession = "overnight" | "overnight_plus_day";

export type OvernightSpotBlockCode =
  | "overnight_spot_disabled"
  | "overnight_spot_account_required"
  | "overnight_spot_live_deployment_required"
  | "overnight_spot_live_env_disabled"
  | "overnight_spot_live_env_unconfirmed"
  | "overnight_spot_symbol_required"
  | "overnight_spot_signal_not_actionable"
  | "overnight_spot_signal_stale"
  | "overnight_spot_quote_required"
  | "overnight_spot_quote_stale"
  | "overnight_spot_quote_invalid"
  | "overnight_spot_spread_too_wide"
  | "overnight_spot_short_disabled"
  | "overnight_spot_same_direction_position_open"
  | "overnight_spot_exit_position_required"
  | "overnight_spot_quantity_required"
  | "overnight_spot_quantity_cap_exceeded"
  | "overnight_spot_notional_cap_required"
  | "overnight_spot_notional_cap_exceeded"
  | "overnight_spot_limit_price_required"
  | "overnight_spot_session_unsupported";

export type OvernightSpotBlocker = {
  code: OvernightSpotBlockCode;
  message: string;
  detail?: Record<string, unknown>;
};

export type OvernightSpotProfile = {
  enabled: boolean;
  executionMode: OvernightSpotExecutionMode;
  accountId: string | null;
  tradingSession: OvernightSpotTradingSession;
  requireActionableSignal: boolean;
  longOnly: boolean;
  allowFractionalQuantity: boolean;
  defaultOrderNotional: number;
  maxOrderNotional: number;
  maxShareQuantity: number;
  maxQuoteAgeMs: number;
  maxSignalAgeMs: number;
  maxSpreadPercent: number;
  limitOffsetBps: number;
  priceTick: number;
  liveEnableEnv: string;
  liveConfirmEnv: string;
  liveConfirmValue: string;
};

export type OvernightSpotQuote = {
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  last?: number | null;
  mark?: number | null;
  price?: number | null;
  updatedAt?: Date | string | number | null;
  dataUpdatedAt?: Date | string | number | null;
  freshness?: string | null;
  marketDataMode?: string | null;
};

export type OvernightSpotSignal = {
  symbol: string;
  side: OvernightSpotSignalSide;
  stage?: OvernightSpotSignalStage | null;
  signalId?: string | null;
  signalAt?: Date | string | number | null;
  actionable?: boolean | null;
  quantity?: number | null;
  notional?: number | null;
  limitPrice?: number | null;
  referencePrice?: number | null;
  source?: "pyrus" | "manual" | "automation";
  metadata?: Record<string, unknown>;
};

export type OvernightSpotOrderRequest = PlaceOrderInput & {
  source: "automation";
  clientOrderId: string;
  payload: Record<string, unknown>;
};

export type OvernightSpotPlanReady = {
  status: "ready";
  profile: OvernightSpotProfile;
  order: OvernightSpotOrderRequest;
  clientOrderId: string;
  eventType: string;
  summary: string;
  facts: OvernightSpotPlanFacts;
};

export type OvernightSpotPlanBlocked = {
  status: "blocked";
  profile: OvernightSpotProfile;
  blockers: OvernightSpotBlocker[];
  facts: OvernightSpotPlanFacts;
};

export type OvernightSpotPlanResult =
  | OvernightSpotPlanReady
  | OvernightSpotPlanBlocked;

export type OvernightSpotPlanFacts = {
  broker: "ibkr";
  assetClass: "equity";
  orderType: "limit";
  timeInForce: "day";
  tradingSession: OvernightSpotTradingSession;
  includeOvernight: true;
  optionsUnsupported: true;
  shortsUnsupported: boolean;
  primaryExchangeResolvedByBridge: true;
  quoteAgeMs: number | null;
  signalAgeMs: number | null;
  spreadPercent: number | null;
  estimatedNotional: number | null;
};

type ResolveProfileInput = {
  config?: unknown;
  providerAccountId?: string | null;
};

type PlanInput = {
  profile?: Partial<OvernightSpotProfile> | null;
  deploymentId?: string | null;
  deploymentMode?: "paper" | "live" | null;
  providerAccountId?: string | null;
  signal: OvernightSpotSignal;
  quote?: OvernightSpotQuote | null;
  existingPositionQuantity?: number | null;
  now?: Date;
  env?: Record<string, string | undefined>;
};

const defaultOvernightSpotProfile: OvernightSpotProfile = {
  enabled: false,
  executionMode: "disabled",
  accountId: null,
  tradingSession: "overnight",
  requireActionableSignal: true,
  longOnly: true,
  allowFractionalQuantity: false,
  defaultOrderNotional: 0,
  maxOrderNotional: 0,
  maxShareQuantity: 0,
  maxQuoteAgeMs: DEFAULT_MAX_QUOTE_AGE_MS,
  maxSignalAgeMs: DEFAULT_MAX_SIGNAL_AGE_MS,
  maxSpreadPercent: DEFAULT_MAX_SPREAD_PERCENT,
  limitOffsetBps: DEFAULT_LIMIT_OFFSET_BPS,
  priceTick: DEFAULT_PRICE_TICK,
  liveEnableEnv: OVERNIGHT_SPOT_LIVE_ENABLE_ENV,
  liveConfirmEnv: OVERNIGHT_SPOT_LIVE_CONFIRM_ENV,
  liveConfirmValue: OVERNIGHT_SPOT_LIVE_CONFIRM_VALUE,
};

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function readNonNegativeNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const numeric = asNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : fallback;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const numeric = asNumber(value);
  return numeric !== null && numeric > 0 ? numeric : fallback;
}

function readExecutionMode(value: unknown, fallback: OvernightSpotExecutionMode) {
  const text = asString(value)?.toLowerCase();
  if (text === "shadow" || text === "paper") {
    return "shadow";
  }
  if (text === "live") {
    return "live";
  }
  if (text === "disabled" || text === "off") {
    return "disabled";
  }
  return fallback;
}

function readTradingSession(
  value: unknown,
  fallback: OvernightSpotTradingSession,
): OvernightSpotTradingSession {
  const text = asString(value)?.toLowerCase();
  if (text === "overnight" || text === "overnight_plus_day") {
    return text;
  }
  return fallback;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 1e11 ? value : value * 1_000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = asString(value);
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addBlocker(
  blockers: OvernightSpotBlocker[],
  code: OvernightSpotBlockCode,
  message: string,
  detail?: Record<string, unknown>,
) {
  blockers.push(detail ? { code, message, detail } : { code, message });
}

function quoteTimestamp(quote: OvernightSpotQuote | null | undefined) {
  return toDate(quote?.dataUpdatedAt ?? quote?.updatedAt);
}

function quoteMidpoint(quote: OvernightSpotQuote | null | undefined) {
  const bid = asNumber(quote?.bid);
  const ask = asNumber(quote?.ask);
  const explicitMid = asNumber(quote?.mid);
  if (explicitMid !== null && explicitMid > 0) {
    return explicitMid;
  }
  if (bid !== null && ask !== null && bid > 0 && ask >= bid) {
    return (bid + ask) / 2;
  }
  return null;
}

function quoteSpreadPercent(quote: OvernightSpotQuote | null | undefined) {
  const bid = asNumber(quote?.bid);
  const ask = asNumber(quote?.ask);
  const mid = quoteMidpoint(quote);
  if (bid === null || ask === null || mid === null || bid <= 0 || ask < bid) {
    return null;
  }
  return ((ask - bid) / mid) * 100;
}

function resolveStage(signal: OvernightSpotSignal): OvernightSpotSignalStage {
  if (signal.stage === "entry" || signal.stage === "exit") {
    return signal.stage;
  }
  return signal.side === "buy" ? "entry" : "exit";
}

function roundLimitPrice(
  value: number,
  tick: number,
  side: OvernightSpotSignalSide,
) {
  const priceTick = tick > 0 ? tick : DEFAULT_PRICE_TICK;
  const rounded =
    side === "buy"
      ? Math.ceil(value / priceTick) * priceTick
      : Math.floor(value / priceTick) * priceTick;
  return Number(rounded.toFixed(6));
}

function resolveLimitPrice(input: {
  profile: OvernightSpotProfile;
  signal: OvernightSpotSignal;
  quote: OvernightSpotQuote | null | undefined;
}) {
  const explicitLimit = asNumber(input.signal.limitPrice);
  if (explicitLimit !== null && explicitLimit > 0) {
    return roundLimitPrice(explicitLimit, input.profile.priceTick, input.signal.side);
  }
  const bid = asNumber(input.quote?.bid);
  const ask = asNumber(input.quote?.ask);
  const reference =
    input.signal.side === "buy"
      ? ask
      : bid;
  if (reference === null || reference <= 0) {
    return null;
  }
  const offset = input.profile.limitOffsetBps / 10_000;
  const raw =
    input.signal.side === "buy"
      ? reference * (1 + offset)
      : reference * Math.max(0, 1 - offset);
  return roundLimitPrice(raw, input.profile.priceTick, input.signal.side);
}

function resolveRequestedQuantity(input: {
  profile: OvernightSpotProfile;
  signal: OvernightSpotSignal;
  referencePrice: number | null;
}) {
  const explicitQuantity = asNumber(input.signal.quantity);
  if (explicitQuantity !== null && explicitQuantity > 0) {
    return explicitQuantity;
  }

  const notional =
    asNumber(input.signal.notional) ?? input.profile.defaultOrderNotional;
  if (
    notional > 0 &&
    input.referencePrice !== null &&
    input.referencePrice > 0
  ) {
    return notional / input.referencePrice;
  }

  return null;
}

function normalizeQuantity(quantity: number, allowFractional: boolean) {
  return allowFractional
    ? Number(quantity.toFixed(6))
    : Math.floor(quantity);
}

function resolveOrderQuantity(input: {
  profile: OvernightSpotProfile;
  requestedQuantity: number | null;
}) {
  if (input.requestedQuantity === null || input.requestedQuantity <= 0) {
    return null;
  }
  return normalizeQuantity(
    input.requestedQuantity,
    input.profile.allowFractionalQuantity,
  );
}

function envValue(env: Record<string, string | undefined> | undefined, key: string) {
  return env ? env[key] : process.env[key];
}

function buildFacts(input: {
  profile: OvernightSpotProfile;
  quoteAgeMs: number | null;
  signalAgeMs: number | null;
  spreadPercent: number | null;
  estimatedNotional: number | null;
}): OvernightSpotPlanFacts {
  return {
    broker: "ibkr",
    assetClass: "equity",
    orderType: "limit",
    timeInForce: "day",
    tradingSession: input.profile.tradingSession,
    includeOvernight: true,
    optionsUnsupported: true,
    shortsUnsupported: input.profile.longOnly,
    primaryExchangeResolvedByBridge: true,
    quoteAgeMs: input.quoteAgeMs,
    signalAgeMs: input.signalAgeMs,
    spreadPercent: input.spreadPercent,
    estimatedNotional: input.estimatedNotional,
  };
}

function profilePayload(profile: OvernightSpotProfile) {
  return {
    enabled: profile.enabled,
    executionMode: profile.executionMode,
    tradingSession: profile.tradingSession,
    longOnly: profile.longOnly,
    defaultOrderNotional: profile.defaultOrderNotional,
    maxOrderNotional: profile.maxOrderNotional,
    maxShareQuantity: profile.maxShareQuantity,
    maxQuoteAgeMs: profile.maxQuoteAgeMs,
    maxSignalAgeMs: profile.maxSignalAgeMs,
    maxSpreadPercent: profile.maxSpreadPercent,
    limitOffsetBps: profile.limitOffsetBps,
  };
}

function quotePayload(quote: OvernightSpotQuote | null | undefined) {
  return {
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    mid: quoteMidpoint(quote),
    last: quote?.last ?? null,
    mark: quote?.mark ?? null,
    updatedAt: quoteTimestamp(quote)?.toISOString() ?? null,
    freshness: quote?.freshness ?? null,
    marketDataMode: quote?.marketDataMode ?? null,
  };
}

function signalPayload(signal: OvernightSpotSignal, signalAt: Date | null) {
  return {
    signalId: signal.signalId ?? null,
    source: signal.source ?? "automation",
    symbol: signal.symbol,
    side: signal.side,
    stage: resolveStage(signal),
    signalAt: signalAt?.toISOString() ?? null,
    actionable: signal.actionable ?? null,
    quantity: signal.quantity ?? null,
    notional: signal.notional ?? null,
    referencePrice: signal.referencePrice ?? null,
    metadata: signal.metadata ?? {},
  };
}

export function resolveOvernightSpotProfile(
  input: ResolveProfileInput = {},
): OvernightSpotProfile {
  const config = asRecord(input.config) ?? {};
  const parameters = asRecord(config.parameters) ?? {};
  const raw =
    asRecord(config.overnightSpot) ??
    asRecord(parameters.overnightSpot) ??
    asRecord(parameters.overnightSpotTrading) ??
    {};
  const enabled = readBoolean(raw.enabled, defaultOvernightSpotProfile.enabled);
  const executionMode = enabled
    ? readExecutionMode(raw.executionMode, "shadow")
    : "disabled";
  const accountId =
    asString(raw.accountId) ??
    asString(raw.providerAccountId) ??
    input.providerAccountId ??
    defaultOvernightSpotProfile.accountId;

  return {
    enabled,
    executionMode,
    accountId,
    tradingSession: readTradingSession(
      raw.tradingSession,
      defaultOvernightSpotProfile.tradingSession,
    ),
    requireActionableSignal: readBoolean(
      raw.requireActionableSignal,
      defaultOvernightSpotProfile.requireActionableSignal,
    ),
    longOnly: readBoolean(raw.longOnly, defaultOvernightSpotProfile.longOnly),
    allowFractionalQuantity: readBoolean(
      raw.allowFractionalQuantity,
      defaultOvernightSpotProfile.allowFractionalQuantity,
    ),
    defaultOrderNotional: readNonNegativeNumber(
      raw.defaultOrderNotional,
      defaultOvernightSpotProfile.defaultOrderNotional,
    ),
    maxOrderNotional: readNonNegativeNumber(
      raw.maxOrderNotional,
      defaultOvernightSpotProfile.maxOrderNotional,
    ),
    maxShareQuantity: readNonNegativeNumber(
      raw.maxShareQuantity,
      defaultOvernightSpotProfile.maxShareQuantity,
    ),
    maxQuoteAgeMs: readPositiveNumber(
      raw.maxQuoteAgeMs,
      defaultOvernightSpotProfile.maxQuoteAgeMs,
    ),
    maxSignalAgeMs: readPositiveNumber(
      raw.maxSignalAgeMs,
      defaultOvernightSpotProfile.maxSignalAgeMs,
    ),
    maxSpreadPercent: readPositiveNumber(
      raw.maxSpreadPercent,
      defaultOvernightSpotProfile.maxSpreadPercent,
    ),
    limitOffsetBps: readNonNegativeNumber(
      raw.limitOffsetBps,
      defaultOvernightSpotProfile.limitOffsetBps,
    ),
    priceTick: readPositiveNumber(
      raw.priceTick,
      defaultOvernightSpotProfile.priceTick,
    ),
    liveEnableEnv:
      asString(raw.liveEnableEnv) ?? defaultOvernightSpotProfile.liveEnableEnv,
    liveConfirmEnv:
      asString(raw.liveConfirmEnv) ?? defaultOvernightSpotProfile.liveConfirmEnv,
    liveConfirmValue:
      asString(raw.liveConfirmValue) ??
      defaultOvernightSpotProfile.liveConfirmValue,
  };
}

export function overnightSpotSignalFromPyrus(input: {
  symbol: string;
  signal: PyrusSignalsSignalEvent;
  quantity?: number | null;
  notional?: number | null;
}): OvernightSpotSignal {
  const side = input.signal.eventType === "buy_signal" ? "buy" : "sell";
  return {
    symbol: normalizeSymbol(input.symbol),
    side,
    stage: side === "buy" ? "entry" : "exit",
    signalId: input.signal.id,
    signalAt: input.signal.ts || input.signal.time,
    actionable: input.signal.actionable && !input.signal.filtered,
    quantity: input.quantity ?? null,
    notional: input.notional ?? null,
    referencePrice: input.signal.price || input.signal.close,
    source: "pyrus",
    metadata: {
      eventType: input.signal.eventType,
      direction: input.signal.direction,
      barIndex: input.signal.barIndex,
      filtered: input.signal.filtered,
      filterState: input.signal.filterState,
    },
  };
}

export function buildOvernightSpotClientOrderId(input: {
  deploymentId?: string | null;
  symbol: string;
  side: OvernightSpotSignalSide;
  stage: OvernightSpotSignalStage;
  signalId?: string | null;
  signalAt?: Date | null;
}) {
  const symbol = normalizeSymbol(input.symbol).toLowerCase();
  const digest = createHash("sha256")
    .update(
      [
        input.deploymentId ?? "manual",
        symbol,
        input.side,
        input.stage,
        input.signalId ?? input.signalAt?.toISOString() ?? "unspecified",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);
  return `${OVERNIGHT_SPOT_CLIENT_ORDER_PREFIX}-${symbol}-${input.stage}-${input.side}-${digest}`;
}

export function planOvernightSpotOrder(input: PlanInput): OvernightSpotPlanResult {
  const profile: OvernightSpotProfile = {
    ...defaultOvernightSpotProfile,
    ...(input.profile ?? {}),
    accountId:
      input.profile?.accountId ??
      input.providerAccountId ??
      defaultOvernightSpotProfile.accountId,
  };
  const now = input.now ?? new Date();
  const signalAt = toDate(input.signal.signalAt);
  const quoteAt = quoteTimestamp(input.quote);
  const quoteAgeMs = quoteAt ? Math.max(0, now.getTime() - quoteAt.getTime()) : null;
  const signalAgeMs = signalAt
    ? Math.max(0, now.getTime() - signalAt.getTime())
    : null;
  const spreadPercent = quoteSpreadPercent(input.quote);
  const stage = resolveStage(input.signal);
  const blockers: OvernightSpotBlocker[] = [];
  const normalizedSymbol = normalizeSymbol(input.signal.symbol || "");
  const limitPrice = resolveLimitPrice({
    profile,
    signal: input.signal,
    quote: input.quote,
  });
  const requestedQuantity = resolveRequestedQuantity({
    profile,
    signal: input.signal,
    referencePrice: limitPrice,
  });
  const quantity = resolveOrderQuantity({
    profile,
    requestedQuantity,
  });
  const estimatedNotional =
    quantity !== null && limitPrice !== null ? quantity * limitPrice : null;

  if (!profile.enabled || profile.executionMode === "disabled") {
    addBlocker(
      blockers,
      "overnight_spot_disabled",
      "Overnight spot automation is disabled by profile.",
    );
  }

  if (!profile.accountId) {
    addBlocker(
      blockers,
      "overnight_spot_account_required",
      "Overnight spot automation requires an IBKR account id.",
    );
  }

  if (!normalizedSymbol) {
    addBlocker(
      blockers,
      "overnight_spot_symbol_required",
      "Overnight spot automation requires a symbol.",
    );
  }

  if (
    profile.tradingSession !== "overnight" &&
    profile.tradingSession !== "overnight_plus_day"
  ) {
    addBlocker(
      blockers,
      "overnight_spot_session_unsupported",
      "Overnight spot automation only supports IBKR overnight stock sessions.",
      { tradingSession: profile.tradingSession },
    );
  }

  if (profile.requireActionableSignal && input.signal.actionable === false) {
    addBlocker(
      blockers,
      "overnight_spot_signal_not_actionable",
      "The Pyrus signal is not actionable.",
    );
  }

  if (signalAgeMs !== null && signalAgeMs > profile.maxSignalAgeMs) {
    addBlocker(
      blockers,
      "overnight_spot_signal_stale",
      "The Pyrus signal is stale for overnight spot automation.",
      { signalAgeMs, maxSignalAgeMs: profile.maxSignalAgeMs },
    );
  }

  if (!input.quote) {
    addBlocker(
      blockers,
      "overnight_spot_quote_required",
      "A live quote is required before building an overnight spot order.",
    );
  }

  if (quoteAgeMs === null) {
    addBlocker(
      blockers,
      "overnight_spot_quote_stale",
      "The quote timestamp is missing.",
    );
  } else if (quoteAgeMs > profile.maxQuoteAgeMs) {
    addBlocker(
      blockers,
      "overnight_spot_quote_stale",
      "The quote is stale for overnight spot automation.",
      { quoteAgeMs, maxQuoteAgeMs: profile.maxQuoteAgeMs },
    );
  }

  if (quoteMidpoint(input.quote) === null || spreadPercent === null) {
    addBlocker(
      blockers,
      "overnight_spot_quote_invalid",
      "The quote must have positive bid and ask prices.",
    );
  } else if (spreadPercent > profile.maxSpreadPercent) {
    addBlocker(
      blockers,
      "overnight_spot_spread_too_wide",
      "The quote spread is wider than the overnight spot profile allows.",
      { spreadPercent, maxSpreadPercent: profile.maxSpreadPercent },
    );
  }

  if (profile.longOnly && input.signal.side === "sell" && stage !== "exit") {
    addBlocker(
      blockers,
      "overnight_spot_short_disabled",
      "Opening short overnight spot orders are disabled.",
    );
  }

  if (profile.longOnly && input.signal.side === "sell" && stage === "exit") {
    const existingQuantity = asNumber(input.existingPositionQuantity) ?? 0;
    if (existingQuantity <= 0) {
      addBlocker(
        blockers,
        "overnight_spot_exit_position_required",
        "A long position is required before sending an overnight spot exit.",
      );
    } else if (quantity !== null && quantity > existingQuantity) {
      addBlocker(
        blockers,
        "overnight_spot_short_disabled",
        "The overnight spot exit quantity would exceed the long position.",
        { quantity, existingPositionQuantity: existingQuantity },
      );
    }
  }

  if (profile.longOnly && input.signal.side === "buy" && stage === "entry") {
    const existingQuantity = asNumber(input.existingPositionQuantity) ?? 0;
    if (existingQuantity > 0) {
      addBlocker(
        blockers,
        "overnight_spot_same_direction_position_open",
        "A long position is already open for this overnight spot entry.",
        { existingPositionQuantity: existingQuantity },
      );
    }
  }

  if (limitPrice === null || limitPrice <= 0) {
    addBlocker(
      blockers,
      "overnight_spot_limit_price_required",
      "Overnight spot automation only creates limit orders.",
    );
  }

  if (profile.maxOrderNotional <= 0) {
    addBlocker(
      blockers,
      "overnight_spot_notional_cap_required",
      "A positive maxOrderNotional cap is required.",
    );
  }

  if (profile.maxShareQuantity <= 0) {
    addBlocker(
      blockers,
      "overnight_spot_quantity_cap_exceeded",
      "A positive maxShareQuantity cap is required.",
    );
  }

  if (quantity === null || quantity <= 0) {
    addBlocker(
      blockers,
      "overnight_spot_quantity_required",
      "A positive order quantity or default order notional is required.",
    );
  } else if (quantity > profile.maxShareQuantity) {
    addBlocker(
      blockers,
      "overnight_spot_quantity_cap_exceeded",
      "The order quantity exceeds the overnight spot share cap.",
      { quantity, maxShareQuantity: profile.maxShareQuantity },
    );
  }

  if (
    estimatedNotional !== null &&
    profile.maxOrderNotional > 0 &&
    estimatedNotional > profile.maxOrderNotional + 0.000001
  ) {
    addBlocker(
      blockers,
      "overnight_spot_notional_cap_exceeded",
      "The order notional exceeds the overnight spot notional cap.",
      { estimatedNotional, maxOrderNotional: profile.maxOrderNotional },
    );
  }

  if (profile.executionMode === "live") {
    if (input.deploymentMode !== "live") {
      addBlocker(
        blockers,
        "overnight_spot_live_deployment_required",
        "Live overnight spot orders require a live deployment.",
      );
    }
    if (envValue(input.env, profile.liveEnableEnv) !== "1") {
      addBlocker(
        blockers,
        "overnight_spot_live_env_disabled",
        "Live overnight spot orders require the live enable environment gate.",
        { env: profile.liveEnableEnv },
      );
    }
    if (envValue(input.env, profile.liveConfirmEnv) !== profile.liveConfirmValue) {
      addBlocker(
        blockers,
        "overnight_spot_live_env_unconfirmed",
        "Live overnight spot orders require the live confirmation environment gate.",
        { env: profile.liveConfirmEnv },
      );
    }
  }

  const facts = buildFacts({
    profile,
    quoteAgeMs,
    signalAgeMs,
    spreadPercent,
    estimatedNotional,
  });

  if (blockers.length > 0) {
    return { status: "blocked", profile, blockers, facts };
  }

  const clientOrderId = buildOvernightSpotClientOrderId({
    deploymentId: input.deploymentId,
    symbol: normalizedSymbol,
    side: input.signal.side,
    stage,
    signalId: input.signal.signalId,
    signalAt,
  });
  const eventType = `${OVERNIGHT_SPOT_EVENT_PREFIX}_${profile.executionMode}_${stage}`;
  const orderMode = profile.executionMode === "live" ? "live" : "paper";
  const summary = `${normalizedSymbol} overnight spot ${profile.executionMode} ${stage} ${input.signal.side} ${quantity} @ ${limitPrice}`;
  const payload = {
    automation: "overnight_spot",
    deploymentId: input.deploymentId ?? null,
    providerAccountId: profile.accountId,
    eventType,
    summary,
    signal: signalPayload(input.signal, signalAt),
    quote: quotePayload(input.quote),
    profile: profilePayload(profile),
    facts,
  };

  return {
    status: "ready",
    profile,
    clientOrderId,
    eventType,
    summary,
    facts,
    order: {
      accountId: profile.accountId as string,
      mode: orderMode,
      confirm: profile.executionMode === "live" ? true : null,
      symbol: normalizedSymbol,
      assetClass: "equity",
      side: input.signal.side,
      type: "limit",
      quantity: quantity as number,
      limitPrice: limitPrice as number,
      stopPrice: null,
      timeInForce: "day",
      optionContract: null,
      tradingSession: profile.tradingSession,
      includeOvernight: true,
      source: "automation",
      clientOrderId,
      payload,
    },
  };
}

export function buildOvernightSpotExecutionEventDraft(
  result: OvernightSpotPlanReady,
  input: {
    deploymentId?: string | null;
    occurredAt?: Date | null;
  } = {},
) {
  return {
    deploymentId: input.deploymentId ?? null,
    providerAccountId: result.order.accountId,
    symbol: result.order.symbol,
    eventType: result.eventType,
    summary: result.summary,
    payload: result.order.payload,
    occurredAt: input.occurredAt ?? new Date(),
  };
}
