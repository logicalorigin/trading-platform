import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";
import {
  getIbkrBridgeRuntimeConfig,
  onIbkrBridgeRuntimeChanged,
} from "../lib/runtime";
import {
  IbkrBridgeClient,
  type QuoteStreamSignal,
} from "../providers/ibkr/bridge-client";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  isBridgeWorkBackedOff,
  runBridgeWork,
  type BridgeWorkCategory,
} from "./bridge-governor";
import {
  admitMarketDataLeases,
  isMarketDataLeaseActive,
  recordMarketDataFallback,
  recordMarketDataAdmissionIbkrPressure,
  releaseMarketDataLeaseIds,
  releaseMarketDataLeases,
  subscribeMarketDataLeaseChanges,
  type MarketDataFallbackProvider,
  type MarketDataIntent,
  type MarketDataLease,
} from "./market-data-admission";
import { subscribeApiResourcePressureChanges } from "./resource-pressure";
import { isHttpError } from "../lib/errors";

type OptionQuoteWithSource = QuoteSnapshot & {
  source: "ibkr";
};

export type OptionQuoteSnapshotPayload = {
  underlying: string | null;
  quotes: OptionQuoteWithSource[];
  transport: QuoteSnapshot["transport"] | null;
  delayed: boolean;
  fallbackUsed: boolean;
  debug?: {
    totalMs: number;
    upstreamMs: number | null;
    requestedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    returnedCount: number;
    bridgeChunks: number;
    providerMode: string | null;
    liveMarketDataAvailable: boolean | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    blockedReason?: string | null;
    acceptedProviderContractIds: string[];
    missingProviderContractIds: string[];
  };
};

export type BridgeOptionQuoteStreamDiagnostics = {
  activeConsumerCount: number;
  unionProviderContractIdCount: number;
  requestedProviderContractIdCount: number;
  nonLiveProviderContractIdCount: number;
  cachedQuoteCount: number;
  eventCount: number;
  reconnectCount: number;
  activeBridgeStreamCount: number;
  activeBridgeChunkCount: number;
  lastEventAt: string | null;
  lastEventAgeMs: number | null;
  lastSignalAt: string | null;
  lastSignalAgeMs: number | null;
  streamActive: boolean;
  reconnectScheduled: boolean;
  desiredProviderContractIds: string[];
  lastError: string | null;
  lastErrorAt: string | null;
  lastStreamStatus: unknown | null;
  pressure: "normal" | "reconnecting" | "capacity_limited" | "backpressure";
};

type Subscriber = {
  id: number;
  owner: string;
  intent: MarketDataIntent;
  fallbackProvider: MarketDataFallbackProvider;
  requiresGreeks: boolean;
  underlying: string | null;
  providerContractIds: Set<string>;
  onSnapshot: (payload: OptionQuoteSnapshotPayload) => void;
};

type RetainedSnapshotDemand = {
  owner: string;
  intent: MarketDataIntent;
  fallbackProvider: MarketDataFallbackProvider;
  requiresGreeks: boolean;
  underlying: string | null;
  providerContractExpirations: Map<string, number>;
};

type BridgeOptionQuoteClient = {
  getHealth(): Promise<{
    transport?: string | null;
    marketDataMode?: string | null;
    liveMarketDataAvailable?: boolean | null;
  }>;
  getOptionQuoteSnapshots(input: {
    underlying?: string | null;
    providerContractIds: string[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<QuoteSnapshot[]>;
  streamOptionQuoteSnapshots(
    input: {
      underlying?: string | null;
      providerContractIds: string[];
    },
    onQuotes: (quotes: QuoteSnapshot[]) => void,
    onError?: (error: unknown) => void,
    onSignal?: (signal: QuoteStreamSignal) => void,
  ): () => void;
};

export type BridgeOptionQuoteSnapshotAdmissionOptions = {
  owner?: string;
  intent?: MarketDataIntent;
  ttlMs?: number;
  fallbackProvider?: MarketDataFallbackProvider;
  requiresGreeks?: boolean;
};

let bridgeClient: BridgeOptionQuoteClient = new IbkrBridgeClient();
const subscribers = new Map<number, Subscriber>();
const retainedSnapshotDemands = new Map<string, RetainedSnapshotDemand>();
const quoteCacheByProviderContractId = new Map<string, QuoteSnapshot>();
const STREAM_RECONFIGURE_DEBOUNCE_MS = 150;
const FLOW_SCANNER_STREAM_RECONFIGURE_DEBOUNCE_MS = 750;
const RECONNECT_DELAY_MIN_MS = 1_000;
const RECONNECT_DELAY_MAX_MS = 30_000;
const UNCONFIGURED_OPTION_STREAM_RETRY_MS = Math.max(
  60_000,
  Number.parseInt(
    process.env["IBKR_OPTION_QUOTE_STREAM_UNCONFIGURED_RETRY_MS"] ?? "60000",
    10,
  ) || 60_000,
);
const LIVE_OPTION_QUOTE_STALE_MS = 2_000;
const OPTION_QUOTE_BRIDGE_CHUNK_SIZE = Math.max(
  1,
  Number.parseInt(process.env["OPTION_QUOTE_BRIDGE_CHUNK_SIZE"] ?? "100", 10) ||
    100,
);
let nextSubscriberId = 1;
let nextSnapshotOwnerId = 1;
let streamSignature = "";
type OptionStreamChunk = {
  contracts: string[];
  unsubscribe: () => void;
  reconnectAttempt: number;
  reconnectTimer: NodeJS.Timeout | null;
};
let streamChunks: OptionStreamChunk[] = [];
let refreshTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let retainedSnapshotDemandExpiryTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
let eventCount = 0;
let reconnectCount = 0;
let lastEventAt: Date | null = null;
let lastSignalAt: Date | null = null;
let lastError: string | null = null;
let lastErrorAt: Date | null = null;
let lastStreamStatus: NonNullable<QuoteStreamSignal["status"]> | null = null;
let nowProvider = () => new Date();
let bridgeRuntimeConfiguredForTests: boolean | null = null;

function normalizeProviderContractIds(providerContractIds: string[]): string[] {
  return Array.from(
    new Set(
      providerContractIds
        .map((providerContractId) => providerContractId.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function isIbkrResolvableOptionProviderContractId(
  providerContractId: string,
): boolean {
  if (providerContractId.startsWith("O:")) {
    return false;
  }
  if (!providerContractId.startsWith("twsopt:")) {
    return true;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(providerContractId.slice("twsopt:".length), "base64url").toString(
        "utf8",
      ),
    ) as Record<string, unknown>;
    return payload["v"] === 1;
  } catch {
    return false;
  }
}

function normalizeResolvableProviderContractIds(
  providerContractIds: string[],
): string[] {
  return normalizeProviderContractIds(providerContractIds).filter(
    isIbkrResolvableOptionProviderContractId,
  );
}

function normalizeUnderlying(value: string | null | undefined): string | null {
  const normalized = normalizeSymbol(value ?? "");
  return normalized || null;
}

function isBridgeRuntimeConfigured(): boolean {
  return bridgeRuntimeConfiguredForTests ?? Boolean(getIbkrBridgeRuntimeConfig());
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  const normalizedChunkSize = Math.max(1, Math.floor(chunkSize));
  for (let index = 0; index < values.length; index += normalizedChunkSize) {
    chunks.push(values.slice(index, index + normalizedChunkSize));
  }
  return chunks;
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new Error("Option quote snapshot aborted.");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function readTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const timestamp = Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "Unknown bridge option quote stream error.");
}

function isCapacityPressureState(
  value: unknown,
): value is "capacity_limited" | "backpressure" {
  return value === "capacity_limited" || value === "backpressure";
}

function isCapacityPressureStatus(
  status: NonNullable<QuoteStreamSignal["status"]> | null,
): boolean {
  return isCapacityPressureState(status?.state);
}

function isIbkrBackpressureMessage(message: string): boolean {
  return (
    message.includes("ibkr_bridge_lane_queue_full") ||
    message.includes("lane queue is full") ||
    message.includes("output exceeded") ||
    message.includes("paced") ||
    message.includes("pacing violation")
  );
}

function isCapacityPressureError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  return (
    isIbkrBackpressureMessage(message) ||
    message.includes("market data line") ||
    message.includes("max number of tickers") ||
    message.includes("ticker limit") ||
    message.includes("subscription limit")
  );
}

// A generic "upstream unavailable" result (HTTP 502 from the bridge proxy) means the
// IBKR options upstream could not be reached — e.g. the options market is closed
// off-hours. Market data legitimately runs 24/7 (quotes flow in all sessions), so this
// is an expected data-availability condition, NOT a connection/transport fault. We keep
// retrying but do not surface it as a hard option-stream `lastError`; real transport,
// auth, and capacity problems are still reported.
function isUpstreamUnavailableError(error: unknown): boolean {
  if (isHttpError(error)) {
    return (
      error.code === "upstream_request_failed" ||
      error.code === "upstream_http_error"
    );
  }
  return readErrorMessage(error).toLowerCase().includes("upstream request failed");
}

function capacityPressureFromError(
  error: unknown,
): "backpressure" | "capacity_limited" {
  const message = readErrorMessage(error).toLowerCase();
  return isIbkrBackpressureMessage(message)
    ? "backpressure"
    : "capacity_limited";
}

// A transient per-request fault (a 30s `/options/quotes` request timeout or a
// stream stall under load) — recoverable by re-establishing the affected chunk,
// not a reason to tear down every option subscription. Distinguished from
// capacity pressure (real line-limit) and upstream-unavailable (market closed).
function isTransientStreamError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("stalled") ||
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}

type LiveOptionQuotePolicy = {
  providerContractIds: string[];
  blockedReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function isAutomationDisplayOrPositionMarkOwner(owner: string): boolean {
  const normalizedOwner = owner.toLowerCase();
  return (
    normalizedOwner.startsWith("algo-operations:") ||
    normalizedOwner.startsWith("signal-options-position-mark:")
  );
}

function resolveLiveOptionQuotePolicy(input: {
  owner: string;
  intent: MarketDataIntent;
  providerContractIds: string[];
}): LiveOptionQuotePolicy {
  // Time-of-day no longer blocks option-quote / position-mark market data: quotes flow in
  // all sessions (the bridge serves frozen/last-known data off-hours). Trade EXECUTION
  // remains session-gated in signal-options-automation (entry/exit/overnight) and
  // algo-gateway, not here. This is a market-data path.
  return {
    providerContractIds: normalizeProviderContractIds(input.providerContractIds),
    blockedReason: null,
    errorCode: null,
    errorMessage: null,
  };
}

function recordBlockedLiveOptionQuoteRequest(input: {
  owner: string;
  intent: MarketDataIntent;
  fallbackProvider: MarketDataFallbackProvider;
  reason: string | null;
  providerContractIds: string[];
  underlying: string | null;
}): void {
  if (!input.reason) {
    return;
  }
  recordMarketDataFallback({
    owner: input.owner,
    intent: input.intent,
    fallbackProvider: input.fallbackProvider,
    reason: input.reason,
    instrumentKey:
      input.providerContractIds.length === 1
        ? `option:${input.providerContractIds[0]}`
        : `option:${input.underlying ?? "unknown"}:${input.providerContractIds.length}`,
  });
}

function clearRetainedSnapshotDemandExpiryTimer(): void {
  if (!retainedSnapshotDemandExpiryTimer) {
    return;
  }
  clearTimeout(retainedSnapshotDemandExpiryTimer);
  retainedSnapshotDemandExpiryTimer = null;
}

function pruneRetainedSnapshotDemands(now = Date.now()): number | null {
  let nextExpiresAt: number | null = null;
  retainedSnapshotDemands.forEach((demand, key) => {
    demand.providerContractExpirations.forEach((expiresAt, providerContractId) => {
      if (expiresAt <= now) {
        demand.providerContractExpirations.delete(providerContractId);
        return;
      }
      nextExpiresAt =
        nextExpiresAt === null ? expiresAt : Math.min(nextExpiresAt, expiresAt);
    });
    if (demand.providerContractExpirations.size === 0) {
      retainedSnapshotDemands.delete(key);
    }
  });
  return nextExpiresAt;
}

function scheduleRetainedSnapshotDemandExpiryTimer(): void {
  clearRetainedSnapshotDemandExpiryTimer();
  const now = Date.now();
  const nextExpiresAt = pruneRetainedSnapshotDemands(now);
  if (nextExpiresAt === null) {
    return;
  }

  retainedSnapshotDemandExpiryTimer = setTimeout(() => {
    retainedSnapshotDemandExpiryTimer = null;
    pruneRetainedSnapshotDemands();
    scheduleRefreshBridgeOptionQuoteStream(0);
    scheduleRetainedSnapshotDemandExpiryTimer();
  }, Math.max(0, nextExpiresAt - now + 1));
  retainedSnapshotDemandExpiryTimer.unref?.();
}

function registerRetainedSnapshotDemand(input: {
  owner: string;
  intent: MarketDataIntent;
  fallbackProvider: MarketDataFallbackProvider;
  requiresGreeks: boolean;
  underlying: string | null;
  admittedLeases: MarketDataLease[];
}): void {
  if (input.admittedLeases.length === 0) {
    return;
  }

  const demand =
    retainedSnapshotDemands.get(input.owner) ??
    {
      owner: input.owner,
      intent: input.intent,
      fallbackProvider: input.fallbackProvider,
      requiresGreeks: input.requiresGreeks,
      underlying: input.underlying,
      providerContractExpirations: new Map<string, number>(),
    };
  demand.intent = input.intent;
  demand.fallbackProvider = input.fallbackProvider;
  demand.requiresGreeks = input.requiresGreeks;
  demand.underlying = input.underlying;

  input.admittedLeases.forEach((lease) => {
    const providerContractId = lease.providerContractId?.trim?.() || "";
    const expiresAt = Date.parse(lease.expiresAt ?? "");
    if (!providerContractId || !Number.isFinite(expiresAt)) {
      return;
    }
    demand.providerContractExpirations.set(
      providerContractId,
      Math.max(
        demand.providerContractExpirations.get(providerContractId) ?? 0,
        expiresAt,
      ),
    );
  });

  if (demand.providerContractExpirations.size === 0) {
    return;
  }

  retainedSnapshotDemands.set(input.owner, demand);
  pruneRetainedSnapshotDemands();
  const refreshDelayMs =
    input.intent === "flow-scanner-live" && streamSignature
      ? FLOW_SCANNER_STREAM_RECONFIGURE_DEBOUNCE_MS
      : 0;
  scheduleRefreshBridgeOptionQuoteStream(refreshDelayMs);
  scheduleRetainedSnapshotDemandExpiryTimer();
}

function removeRetainedSnapshotDemandLeases(input: {
  owner: string;
  admittedLeases: MarketDataLease[];
}): void {
  if (input.admittedLeases.length === 0) {
    return;
  }
  const demand = retainedSnapshotDemands.get(input.owner);
  if (!demand) {
    return;
  }

  input.admittedLeases.forEach((lease) => {
    const providerContractId = lease.providerContractId?.trim?.() || "";
    if (providerContractId) {
      demand.providerContractExpirations.delete(providerContractId);
    }
  });
  if (demand.providerContractExpirations.size === 0) {
    retainedSnapshotDemands.delete(input.owner);
  }
  pruneRetainedSnapshotDemands();
  scheduleRefreshBridgeOptionQuoteStream(0);
  scheduleRetainedSnapshotDemandExpiryTimer();
}

function releaseRetainedSnapshotDemandLeases(reason: string): void {
  const owners = Array.from(retainedSnapshotDemands.keys());
  retainedSnapshotDemands.clear();
  clearRetainedSnapshotDemandExpiryTimer();
  owners.forEach((owner) => releaseMarketDataLeases(owner, reason));
}

function getRetainedSnapshotDemandValues(): RetainedSnapshotDemand[] {
  pruneRetainedSnapshotDemands();
  return Array.from(retainedSnapshotDemands.values());
}

function hasBridgeOptionQuoteDemand(): boolean {
  return subscribers.size > 0 || getRetainedSnapshotDemandValues().length > 0;
}

function getDesiredProviderContractIds(): string[] {
  const retainedDemandProviderContractIds = getRetainedSnapshotDemandValues().flatMap(
    (demand) =>
      Array.from(demand.providerContractExpirations.keys()).filter(
        (providerContractId) =>
          isMarketDataLeaseActive({
            owner: demand.owner,
            assetClass: "option",
            providerContractId,
          }),
      ),
  );
  return normalizeProviderContractIds(
    Array.from(subscribers.values())
      .flatMap((subscriber) =>
        Array.from(subscriber.providerContractIds).filter((providerContractId) =>
          isMarketDataLeaseActive({
            owner: subscriber.owner,
            assetClass: "option",
            providerContractId,
          }),
        ),
      )
      .concat(retainedDemandProviderContractIds),
  );
}

function getRequestedProviderContractIds(): string[] {
  return normalizeProviderContractIds(
    Array.from(subscribers.values())
      .flatMap((subscriber) => Array.from(subscriber.providerContractIds))
      .concat(
        getRetainedSnapshotDemandValues().flatMap((demand) =>
          Array.from(demand.providerContractExpirations.keys()),
        ),
      ),
  );
}

function admitBridgeOptionSubscriberLeases(subscriber: Subscriber): void {
  const policy = resolveLiveOptionQuotePolicy({
    owner: subscriber.owner,
    intent: subscriber.intent,
    providerContractIds: Array.from(subscriber.providerContractIds),
  });
  if (policy.blockedReason) {
    releaseMarketDataLeases(subscriber.owner, policy.blockedReason);
    recordBlockedLiveOptionQuoteRequest({
      owner: subscriber.owner,
      intent: subscriber.intent,
      fallbackProvider: subscriber.fallbackProvider,
      reason: policy.blockedReason,
      providerContractIds: Array.from(subscriber.providerContractIds),
      underlying: subscriber.underlying,
    });
  }
  if (policy.providerContractIds.length === 0) {
    return;
  }

  admitMarketDataLeases({
    owner: subscriber.owner,
    intent: subscriber.intent,
    requests: policy.providerContractIds.map((providerContractId) => ({
      assetClass: "option" as const,
      symbol: subscriber.underlying,
      underlying: subscriber.underlying,
      providerContractId,
      requiresGreeks: subscriber.requiresGreeks,
    })),
    fallbackProvider: subscriber.fallbackProvider,
  });
}

function admitBridgeOptionSubscriberLeasesForRuntime(): void {
  if (!isBridgeRuntimeConfigured()) {
    return;
  }
  subscribers.forEach(admitBridgeOptionSubscriberLeases);
}

function releaseBridgeOptionSubscriberLeases(reason: string): void {
  subscribers.forEach((subscriber) => {
    releaseMarketDataLeases(subscriber.owner, reason);
  });
}

function addApiLatency(
  quote: QuoteSnapshot,
  timestampKey: "apiServerReceivedAt" | "apiServerEmittedAt",
  at = nowProvider(),
): QuoteSnapshot {
  return {
    ...quote,
    latency: {
      ...(quote.latency ?? {}),
      [timestampKey]: at,
    },
  };
}

function toPayloadQuote(quote: QuoteSnapshot): OptionQuoteWithSource {
  const emittedAt = nowProvider();
  const lastReceivedAt = readTimestampMs(quote.latency?.apiServerReceivedAt);
  const ageMs =
    lastReceivedAt === null
      ? null
      : Math.max(0, emittedAt.getTime() - lastReceivedAt);
  const freshness =
    ageMs !== null && ageMs > LIVE_OPTION_QUOTE_STALE_MS
      ? "stale"
      : quote.freshness === "delayed" ||
          quote.freshness === "frozen" ||
          quote.freshness === "delayed_frozen"
        ? quote.freshness
        : quote.freshness ?? "live";
  return {
    ...addApiLatency(
      {
        ...quote,
        cacheAgeMs: ageMs,
        freshness,
      },
      "apiServerEmittedAt",
      emittedAt,
    ),
    source: "ibkr",
  };
}

function shouldPromoteQuote(
  incoming: QuoteSnapshot,
  current: QuoteSnapshot | undefined,
  receivedAt: Date,
): boolean {
  if (!current) {
    return true;
  }

  const incomingUpdatedAt = readTimestampMs(incoming.updatedAt);
  const currentUpdatedAt = readTimestampMs(current.updatedAt);
  if (incomingUpdatedAt !== null && currentUpdatedAt !== null) {
    if (incomingUpdatedAt > currentUpdatedAt) {
      return true;
    }
    if (incomingUpdatedAt < currentUpdatedAt) {
      return false;
    }
  } else if (incomingUpdatedAt === null && currentUpdatedAt !== null) {
    return false;
  } else if (incomingUpdatedAt !== null && currentUpdatedAt === null) {
    return true;
  }

  const currentReceivedAt = readTimestampMs(
    current.latency?.apiServerReceivedAt,
  );
  return (
    currentReceivedAt === null || receivedAt.getTime() >= currentReceivedAt
  );
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function quoteHasAnyGreek(quote: QuoteSnapshot | undefined): boolean {
  return Boolean(
    quote &&
      [quote.delta, quote.gamma, quote.theta, quote.vega].some(
        (value) => finiteNumber(value) !== null,
      ),
  );
}

function midpoint(bid: unknown, ask: unknown): number | null {
  const numericBid = positiveNumber(bid);
  const numericAsk = positiveNumber(ask);
  return numericBid !== null && numericAsk !== null
    ? (numericBid + numericAsk) / 2
    : null;
}

function mergeQuoteForCache(
  quote: QuoteSnapshot,
  current: QuoteSnapshot | undefined,
  providerContractId: string,
): QuoteSnapshot {
  const quoteRecord = quote as QuoteSnapshot & { mark?: unknown; last?: unknown };
  const incomingBid = positiveNumber(quote.bid);
  const incomingAsk = positiveNumber(quote.ask);
  const currentBid = positiveNumber(current?.bid);
  const currentAsk = positiveNumber(current?.ask);
  const incomingHasUsablePrice =
    positiveNumber(quote.price) !== null ||
    positiveNumber(quoteRecord.mark) !== null ||
    positiveNumber(quoteRecord.last) !== null ||
    incomingBid !== null ||
    incomingAsk !== null;
  const incomingFiniteBid = finiteNumber(quote.bid);
  const incomingFiniteAsk = finiteNumber(quote.ask);
  return {
    ...current,
    ...quote,
    providerContractId,
    bid:
      incomingHasUsablePrice && incomingFiniteBid !== null
        ? incomingFiniteBid
        : currentBid ?? quote.bid,
    ask:
      incomingHasUsablePrice && incomingFiniteAsk !== null
        ? incomingFiniteAsk
        : currentAsk ?? quote.ask,
    price:
      positiveNumber(quote.price) ??
      positiveNumber(quoteRecord.mark) ??
      positiveNumber(quoteRecord.last) ??
      midpoint(incomingBid, incomingAsk) ??
      positiveNumber(current?.price) ??
      midpoint(currentBid, currentAsk) ??
      quote.price,
    change: incomingHasUsablePrice ? quote.change : current?.change ?? quote.change,
    changePercent: incomingHasUsablePrice
      ? quote.changePercent
      : current?.changePercent ?? quote.changePercent,
    impliedVolatility:
      finiteNumber(quote.impliedVolatility) ??
      finiteNumber(current?.impliedVolatility) ??
      quote.impliedVolatility,
    delta: finiteNumber(quote.delta) ?? finiteNumber(current?.delta) ?? quote.delta,
    gamma: finiteNumber(quote.gamma) ?? finiteNumber(current?.gamma) ?? quote.gamma,
    theta: finiteNumber(quote.theta) ?? finiteNumber(current?.theta) ?? quote.theta,
    vega: finiteNumber(quote.vega) ?? finiteNumber(current?.vega) ?? quote.vega,
  };
}

function cacheQuote(quote: QuoteSnapshot): QuoteSnapshot | null {
  const providerContractId = quote.providerContractId?.trim?.() || "";
  if (!providerContractId) {
    return null;
  }

  const receivedAt = nowProvider();
  const current = quoteCacheByProviderContractId.get(providerContractId);
  if (!shouldPromoteQuote(quote, current, receivedAt)) {
    return null;
  }

  const cached = addApiLatency(
    mergeQuoteForCache(quote, current, providerContractId),
    "apiServerReceivedAt",
    receivedAt,
  );
  quoteCacheByProviderContractId.set(providerContractId, cached);
  eventCount += 1;
  lastEventAt = receivedAt;
  lastError = null;
  lastErrorAt = null;
  reconnectAttempt = 0;
  return cached;
}

function getPayloadForProviderContractIds(
  providerContractIds: string[],
  underlying: string | null,
): OptionQuoteSnapshotPayload {
  const quotes = normalizeProviderContractIds(providerContractIds).flatMap(
    (providerContractId) => {
      const quote = quoteCacheByProviderContractId.get(providerContractId);
      return quote ? [toPayloadQuote(quote)] : [];
    },
  );

  return {
    underlying,
    quotes,
    transport: quotes[0]?.transport ?? null,
    delayed: quotes.some((quote) => quote.delayed),
    fallbackUsed: false,
  };
}

function notifySubscribers(quotes: QuoteSnapshot[]) {
  subscribers.forEach((subscriber) => {
    const matchedQuotes = quotes
      .filter((quote) =>
        subscriber.providerContractIds.has(
          quote.providerContractId?.trim?.() || "",
        ),
      )
      .map(toPayloadQuote);

    if (matchedQuotes.length > 0) {
      subscriber.onSnapshot({
        underlying: subscriber.underlying,
        quotes: matchedQuotes,
        transport: matchedQuotes[0]?.transport ?? null,
        delayed: matchedQuotes.some((quote) => quote.delayed),
        fallbackUsed: false,
      });
    }
  });
}

function clearRefreshTimer() {
  if (!refreshTimer) {
    return;
  }
  clearTimeout(refreshTimer);
  refreshTimer = null;
}

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function stopStream() {
  streamChunks.forEach((chunk) => {
    if (chunk.reconnectTimer) {
      clearTimeout(chunk.reconnectTimer);
      chunk.reconnectTimer = null;
    }
    try {
      chunk.unsubscribe();
    } catch (error) {
      logger.warn({ err: error }, "Bridge option quote stream unsubscribe failed");
    }
  });
  streamChunks = [];
  streamSignature = "";
}

// Subscribe (or re-subscribe) a single option-quote chunk in its slot. Any prior
// subscription in the slot is torn down first so re-establishment never leaks.
function subscribeOptionChunk(
  signature: string,
  contracts: string[],
  slot: number,
): void {
  const previous = streamChunks[slot];
  if (previous) {
    if (previous.reconnectTimer) {
      clearTimeout(previous.reconnectTimer);
      previous.reconnectTimer = null;
    }
    try {
      previous.unsubscribe();
    } catch (error) {
      logger.warn(
        { err: error },
        "Bridge option quote stream chunk unsubscribe failed",
      );
    }
  }
  const chunk: OptionStreamChunk = {
    contracts,
    unsubscribe: () => {},
    reconnectAttempt: previous?.reconnectAttempt ?? 0,
    reconnectTimer: null,
  };
  streamChunks[slot] = chunk;
  chunk.unsubscribe = bridgeClient.streamOptionQuoteSnapshots(
    { providerContractIds: contracts },
    (quotes) => {
      // A healthy quote batch clears this chunk's transient backoff.
      chunk.reconnectAttempt = 0;
      const cachedQuotes = quotes.flatMap((quote) => {
        const cached = cacheQuote(quote);
        return cached ? [cached] : [];
      });
      notifySubscribers(cachedQuotes);
    },
    (error) => handleChunkStreamError(signature, slot, error),
    recordStreamSignal,
  );
}

// One chunk's bridge stream failed. For a transient fault (request timeout /
// stall) re-establish ONLY that chunk with per-chunk backoff, leaving the other
// chunks — and the live option quotes they carry, including the Trade Options
// Chain — subscribed. Tearing down the whole stream on a single chunk's 30s
// timeout was the self-sustaining flap: every timeout dropped all option lines,
// then the mass re-subscribe under load timed out again. Non-transient faults
// (capacity pressure, upstream-unavailable, fatal) keep stream-wide handling.
function handleChunkStreamError(
  signature: string,
  slot: number,
  error: unknown,
): void {
  if (streamSignature !== signature) {
    return;
  }
  if (!isTransientStreamError(error)) {
    handleStreamError(signature, error);
    return;
  }
  const chunk = streamChunks[slot];
  if (!chunk) {
    return;
  }
  lastError = readErrorMessage(error);
  lastErrorAt = nowProvider();
  reconnectCount += 1;
  const attempt = chunk.reconnectAttempt;
  chunk.reconnectAttempt = attempt + 1;
  const delayMs = Math.min(
    RECONNECT_DELAY_MAX_MS,
    RECONNECT_DELAY_MIN_MS * 2 ** attempt,
  );
  if (chunk.reconnectTimer) {
    clearTimeout(chunk.reconnectTimer);
  }
  chunk.reconnectTimer = setTimeout(() => {
    chunk.reconnectTimer = null;
    if (streamSignature !== signature) {
      return;
    }
    subscribeOptionChunk(signature, chunk.contracts, slot);
  }, delayMs);
  chunk.reconnectTimer.unref?.();
}

function scheduleReconnect() {
  if (reconnectTimer || !hasBridgeOptionQuoteDemand()) {
    if (!hasBridgeOptionQuoteDemand()) {
      reconnectAttempt = 0;
    }
    return;
  }

  reconnectCount += 1;
  const delayMs = Math.min(
    RECONNECT_DELAY_MAX_MS,
    RECONNECT_DELAY_MIN_MS * 2 ** reconnectAttempt,
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    refreshBridgeOptionQuoteStream();
  }, delayMs);
  reconnectTimer.unref?.();
}

function recordStreamSignal(signal: QuoteStreamSignal): void {
  lastSignalAt = signal.at;
  if ("status" in signal) {
    lastStreamStatus = signal.status ?? null;
  }
  if (
    signal.type === "ready" ||
    (signal.type === "status" && !isCapacityPressureStatus(signal.status ?? null))
  ) {
    lastError = null;
    lastErrorAt = null;
  }
}

function handleStreamError(expectedSignature: string, error: unknown) {
  if (streamSignature !== expectedSignature) {
    return;
  }

  const now = nowProvider();
  if (isCapacityPressureError(error)) {
    const state = capacityPressureFromError(error);
    const message = readErrorMessage(error);
    recordMarketDataAdmissionIbkrPressure({
      state,
      reason: message,
      source: "option-stream",
      observedAt: now,
    });
    lastStreamStatus = {
      state,
      reason: "ibkr_option_stream_capacity_limited",
      message,
    };
    lastSignalAt = now;
    lastError = null;
    lastErrorAt = null;
    stopStream();
    scheduleRefreshBridgeOptionQuoteStream(RECONNECT_DELAY_MIN_MS);
    return;
  }

  if (isUpstreamUnavailableError(error)) {
    // Options upstream unavailable (e.g. market closed off-hours). Keep reconnecting
    // 24/7, but do not record a hard connection error — this is data availability, not
    // a transport fault.
    lastSignalAt = now;
    lastError = null;
    lastErrorAt = null;
    logger.info(
      { err: error, providerContractIds: expectedSignature },
      "IBKR bridge option quote upstream unavailable; will retry",
    );
    stopStream();
    scheduleReconnect();
    return;
  }

  lastError = readErrorMessage(error);
  lastErrorAt = now;
  logger.warn(
    { err: error, providerContractIds: expectedSignature },
    "IBKR bridge option quote stream failed",
  );
  stopStream();
  scheduleReconnect();
}

function refreshBridgeOptionQuoteStream() {
  clearReconnectTimer();
  clearRefreshTimer();

  if (!isBridgeRuntimeConfigured()) {
    const requestedProviderContractIds = getRequestedProviderContractIds();
    stopStream();
    releaseBridgeOptionSubscriberLeases("runtime_unconfigured");
    releaseRetainedSnapshotDemandLeases("runtime_unconfigured");
    reconnectAttempt = 0;
    if (!requestedProviderContractIds.length) {
      lastStreamStatus = null;
      lastError = null;
      lastErrorAt = null;
      return;
    }
    const now = nowProvider();
    lastSignalAt = now;
    lastError = null;
    lastErrorAt = null;
    lastStreamStatus = {
      state: "closed",
      reason: "ibkr_bridge_not_configured",
      message: "Interactive Brokers bridge is not configured.",
      requestedCount: requestedProviderContractIds.length,
      admittedCount: 0,
      rejectedCount: requestedProviderContractIds.length,
      retryDelayMs: UNCONFIGURED_OPTION_STREAM_RETRY_MS,
    };
    scheduleRefreshBridgeOptionQuoteStream(UNCONFIGURED_OPTION_STREAM_RETRY_MS);
    return;
  }

  admitBridgeOptionSubscriberLeasesForRuntime();

  const providerContractIds = getDesiredProviderContractIds();
  const nextSignature = providerContractIds.join(",");
  if (nextSignature === streamSignature) {
    return;
  }

  stopStream();
  if (!nextSignature) {
    reconnectAttempt = 0;
    lastStreamStatus = null;
    lastError = null;
    lastErrorAt = null;
    return;
  }

  streamSignature = nextSignature;
  const chunks = chunkValues(providerContractIds, OPTION_QUOTE_BRIDGE_CHUNK_SIZE);

  try {
    streamChunks = [];
    chunks.forEach((chunk, slot) => {
      subscribeOptionChunk(nextSignature, chunk, slot);
    });
  } catch (error) {
    handleStreamError(nextSignature, error);
  }
}

function scheduleRefreshBridgeOptionQuoteStream(
  delayMs = STREAM_RECONFIGURE_DEBOUNCE_MS,
) {
  clearRefreshTimer();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshBridgeOptionQuoteStream();
  }, Math.max(0, delayMs));
  refreshTimer.unref?.();
}

onIbkrBridgeRuntimeChanged(() => {
  scheduleRefreshBridgeOptionQuoteStream(0);
});

subscribeMarketDataLeaseChanges((event) => {
  if (!["released", "demoted", "expired"].includes(event.action)) {
    return;
  }
  if (
    !Array.from(subscribers.values()).some(
      (subscriber) => subscriber.owner === event.owner,
    ) &&
    !retainedSnapshotDemands.has(event.owner)
  ) {
    return;
  }
  scheduleRefreshBridgeOptionQuoteStream(0);
});

subscribeApiResourcePressureChanges(() => {
  if (hasBridgeOptionQuoteDemand()) {
    scheduleRefreshBridgeOptionQuoteStream(0);
  }
});

function shouldHydrateQuoteSnapshot(
  quote: QuoteSnapshot | undefined,
  input: { requiresGreeks?: boolean } = {},
): boolean {
  if (!quote) {
    return true;
  }
  if (input.requiresGreeks && !quoteHasAnyGreek(quote)) {
    return true;
  }
  return (
    quote.freshness === "metadata" ||
    quote.freshness === "pending" ||
    quote.freshness === "stale" ||
    quote.freshness === "unavailable"
  );
}

async function getOptionQuoteProviderDebug(): Promise<{
  providerMode: string | null;
  liveMarketDataAvailable: boolean | null;
}> {
  try {
    const health = await bridgeClient.getHealth();
    const transport = health.transport || null;
    const liveMarketDataAvailable = health.liveMarketDataAvailable ?? null;
    const marketDataMode = health.marketDataMode || "unknown";
    const providerMode =
      transport === "tws" ? `tws-${marketDataMode}` : transport;

    return {
      providerMode,
      liveMarketDataAvailable,
    };
  } catch {
    return {
      providerMode: null,
      liveMarketDataAvailable: null,
    };
  }
}

function buildUnconfiguredOptionQuoteSnapshotPayload(input: {
  underlying: string | null;
  requestedAt: number;
  requestedProviderContractIds: string[];
  normalizedProviderContractIds: string[];
}): OptionQuoteSnapshotPayload {
  return {
    underlying: input.underlying,
    quotes: [],
    transport: null,
    delayed: false,
    fallbackUsed: false,
    debug: {
      totalMs: Math.max(0, Date.now() - input.requestedAt),
      upstreamMs: null,
      requestedCount: input.requestedProviderContractIds.length,
      acceptedCount: 0,
      rejectedCount: input.requestedProviderContractIds.length,
      returnedCount: 0,
      bridgeChunks: 0,
      providerMode: null,
      liveMarketDataAvailable: null,
      errorCode: "ibkr_bridge_not_configured",
      errorMessage: "Interactive Brokers bridge is not configured.",
      acceptedProviderContractIds: [],
      missingProviderContractIds: input.normalizedProviderContractIds,
    },
  };
}

export function getCurrentBridgeOptionQuoteSnapshots(input: {
  underlying?: string | null;
  providerContractIds: string[];
}): OptionQuoteWithSource[] {
  return getPayloadForProviderContractIds(
    normalizeResolvableProviderContractIds(input.providerContractIds),
    normalizeUnderlying(input.underlying),
  ).quotes;
}

export async function fetchBridgeOptionQuoteSnapshots(input: {
  underlying?: string | null;
  providerContractIds: string[];
  owner?: string;
  intent?: MarketDataIntent;
  ttlMs?: number;
  fallbackProvider?: MarketDataFallbackProvider;
  requiresGreeks?: boolean;
  releaseLeasesOnComplete?: boolean;
  releaseLeasesOnAbort?: boolean;
  signal?: AbortSignal;
}): Promise<OptionQuoteSnapshotPayload> {
  const requestedAt = Date.now();
  throwIfAborted(input.signal);
  const underlying = normalizeUnderlying(input.underlying);
  const requestedProviderContractIds = normalizeProviderContractIds(
    input.providerContractIds,
  );
  const normalizedProviderContractIds = requestedProviderContractIds.filter(
    isIbkrResolvableOptionProviderContractId,
  );
  const owner =
    input.owner?.trim() || `bridge-option-quote-snapshot:${nextSnapshotOwnerId++}`;
  const intent = input.intent ?? "visible-live";
  const normalizedOwner = owner.toLowerCase();
  const isAutomationLiveQuoteIntent =
    intent === "automation-live" &&
    (normalizedOwner.startsWith("signal-options-") ||
      normalizedOwner.startsWith("signal-options:") ||
      isAutomationDisplayOrPositionMarkOwner(owner));
  const isLiveQuoteSnapshotIntent =
    intent === "flow-scanner-live" ||
    intent === "account-monitor-live" ||
    isAutomationLiveQuoteIntent;
  const bridgeWorkCategory: BridgeWorkCategory =
    isLiveQuoteSnapshotIntent ? "quotes" : "options";
  const bridgeWorkOptions = isLiveQuoteSnapshotIntent
    ? { recordFailure: false }
    : undefined;
  const bridgeOptionQuoteTimeoutMs =
    intent === "account-monitor-live" || intent === "visible-live" ? 0 : undefined;
  const ttlMs = Math.max(1, Math.floor(input.ttlMs ?? 10_000));
  const fallbackProvider = input.fallbackProvider ?? "massive";
  const requiresGreeks = input.requiresGreeks ?? true;
  const releaseLeasesOnComplete = input.releaseLeasesOnComplete ?? true;
  const releaseLeasesOnAbort = input.releaseLeasesOnAbort ?? true;
  if (!normalizedProviderContractIds.length) {
    return {
      underlying,
      quotes: [],
      transport: null,
      delayed: false,
      fallbackUsed: false,
      debug: {
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        requestedCount: requestedProviderContractIds.length,
        acceptedCount: 0,
        rejectedCount: requestedProviderContractIds.length,
        returnedCount: 0,
        bridgeChunks: 0,
        providerMode: null,
        liveMarketDataAvailable: null,
        errorMessage: requestedProviderContractIds.length
          ? "No IBKR-resolvable option providerContractIds were requested."
          : null,
        acceptedProviderContractIds: [],
        missingProviderContractIds: requestedProviderContractIds,
      },
    };
  }
  if (!isBridgeRuntimeConfigured()) {
    stopStream();
    releaseBridgeOptionSubscriberLeases("runtime_unconfigured");
    releaseRetainedSnapshotDemandLeases("runtime_unconfigured");
    return buildUnconfiguredOptionQuoteSnapshotPayload({
      underlying,
      requestedAt,
      requestedProviderContractIds,
      normalizedProviderContractIds,
    });
  }
  const liveQuotePolicy = resolveLiveOptionQuotePolicy({
    owner,
    intent,
    providerContractIds: normalizedProviderContractIds,
  });
  if (liveQuotePolicy.blockedReason) {
    recordBlockedLiveOptionQuoteRequest({
      owner,
      intent,
      fallbackProvider,
      reason: liveQuotePolicy.blockedReason,
      providerContractIds: normalizedProviderContractIds,
      underlying,
    });
  }
  if (liveQuotePolicy.providerContractIds.length === 0) {
    const cachedQuotes = getPayloadForProviderContractIds(
      normalizedProviderContractIds,
      underlying,
    );
    const cachedQuotesByProviderContractId = new Set(
      cachedQuotes.quotes
        .map((quote) => quote.providerContractId?.trim?.() || "")
        .filter(Boolean),
    );
    return {
      ...cachedQuotes,
      debug: {
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        requestedCount: requestedProviderContractIds.length,
        acceptedCount: 0,
        rejectedCount: requestedProviderContractIds.length,
        returnedCount: cachedQuotes.quotes.length,
        bridgeChunks: 0,
        providerMode: null,
        liveMarketDataAvailable: null,
        errorCode: liveQuotePolicy.errorCode,
        errorMessage: liveQuotePolicy.errorMessage,
        blockedReason: liveQuotePolicy.blockedReason,
        acceptedProviderContractIds: [],
        missingProviderContractIds: normalizedProviderContractIds.filter(
          (providerContractId) =>
            !cachedQuotesByProviderContractId.has(providerContractId),
        ),
      },
    };
  }
  const admission = admitMarketDataLeases({
    owner,
    intent,
    requests: liveQuotePolicy.providerContractIds.map((providerContractId) => ({
      assetClass: "option" as const,
      symbol: underlying,
      underlying,
      providerContractId,
      requiresGreeks,
    })),
    ttlMs,
    fallbackProvider,
    replaceOwnerExisting: false,
  });
  const admittedLeaseIds = admission.admitted.map((lease) => lease.id);
  let retainedDemandRegistered = false;
  let releasedAdmittedLeases = false;
  const releaseAdmittedLeases = (reason: string) => {
    if (releasedAdmittedLeases) {
      return;
    }
    releasedAdmittedLeases = true;
    releaseMarketDataLeaseIds(admittedLeaseIds, reason);
    if (retainedDemandRegistered) {
      removeRetainedSnapshotDemandLeases({
        owner,
        admittedLeases: admission.admitted,
      });
      retainedDemandRegistered = false;
    }
  };
  const releaseOnAbort = () => {
    if (releaseLeasesOnAbort) {
      releaseAdmittedLeases("snapshot_aborted");
    }
  };
  if (input.signal?.aborted) {
    releaseOnAbort();
    throw abortReason(input.signal);
  }
  input.signal?.addEventListener("abort", releaseOnAbort, { once: true });
  const admittedProviderContractIds = admission.admitted
    .map((lease) => lease.providerContractId)
    .filter((providerContractId): providerContractId is string =>
      Boolean(providerContractId),
    );
  if (!releaseLeasesOnComplete && admission.admitted.length > 0) {
    registerRetainedSnapshotDemand({
      owner,
      intent,
      fallbackProvider,
      requiresGreeks,
      underlying,
      admittedLeases: admission.admitted,
    });
    retainedDemandRegistered = true;
  }
  const bridgeChunks = chunkValues(
    admittedProviderContractIds,
    OPTION_QUOTE_BRIDGE_CHUNK_SIZE,
  );
  const providerDebug = await getOptionQuoteProviderDebug();
  const cachedQuotes = getPayloadForProviderContractIds(
    normalizedProviderContractIds,
    underlying,
  );
  const cachedQuotesByProviderContractId = new Map(
    cachedQuotes.quotes.map((quote) => [
      quote.providerContractId?.trim?.() || "",
      quote,
    ]),
  );
  // Read-path guard: a display/monitor read must never synchronously block on a cold
  // bridge fetch when a (stale) cached quote already exists. Serve the cached value and
  // let the durable demand stream refresh it in the background. Synchronous hydration is
  // kept only when (a) there is nothing cached to serve, or (b) the intent/owner is
  // execution-adjacent and needs a fresh quote for order sizing. This is what prevents a
  // stale held-position read from triggering the ~20s cold getMarketDataSnapshot path.
  const requiresFreshSynchronousQuote =
    (intent === "execution-live" || intent === "automation-live") &&
    !isAutomationDisplayOrPositionMarkOwner(owner);
  const servesCachedWithoutBlocking = !requiresFreshSynchronousQuote;
  const hydrateProviderContractIds = admittedProviderContractIds.filter(
    (providerContractId) => {
      const cachedQuote =
        cachedQuotesByProviderContractId.get(providerContractId);
      if (!shouldHydrateQuoteSnapshot(cachedQuote, { requiresGreeks })) {
        return false;
      }
      if (cachedQuote && servesCachedWithoutBlocking) {
        return false;
      }
      return true;
    },
  );

  if (isBridgeWorkBackedOff(bridgeWorkCategory)) {
    input.signal?.removeEventListener("abort", releaseOnAbort);
    if (
      releaseLeasesOnComplete ||
      (input.signal?.aborted && releaseLeasesOnAbort)
    ) {
      releaseAdmittedLeases(
        input.signal?.aborted ? "snapshot_aborted" : "snapshot_complete",
      );
    }
    return {
      ...cachedQuotes,
      debug: {
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        requestedCount: requestedProviderContractIds.length,
        acceptedCount: admittedProviderContractIds.length,
        rejectedCount:
          requestedProviderContractIds.length - admittedProviderContractIds.length,
        returnedCount: cachedQuotes.quotes.length,
        bridgeChunks: bridgeChunks.length,
        ...providerDebug,
        errorMessage: `IBKR bridge ${bridgeWorkCategory} work is backed off.`,
        blockedReason: liveQuotePolicy.blockedReason,
        acceptedProviderContractIds: admittedProviderContractIds,
        missingProviderContractIds: normalizedProviderContractIds.filter(
          (providerContractId) =>
            !cachedQuotesByProviderContractId.has(providerContractId),
        ),
      },
    };
  }

  const upstreamStartedAt = Date.now();
  let upstreamErrorMessage: string | null = null;
  try {
    if (hydrateProviderContractIds.length > 0) {
      const freshQuotes = (
        await Promise.all(
          chunkValues(
            hydrateProviderContractIds,
            OPTION_QUOTE_BRIDGE_CHUNK_SIZE,
          ).map((providerContractIds) =>
            runBridgeWork(bridgeWorkCategory, () =>
              bridgeClient.getOptionQuoteSnapshots({
                underlying,
                providerContractIds,
                signal: input.signal,
                timeoutMs: bridgeOptionQuoteTimeoutMs,
              }),
              { ...(bridgeWorkOptions ?? {}), signal: input.signal },
            ),
          ),
        )
      ).flat();
      freshQuotes.forEach(cacheQuote);
    }
  } catch (error) {
    upstreamErrorMessage = readErrorMessage(error);
    // An upstream-unavailable result (e.g. options market closed off-hours) is expected
    // data unavailability, not a connection fault: keep it in this read's debug payload
    // but do not pollute the option-stream `lastError`. Real errors still surface.
    if (!isUpstreamUnavailableError(error)) {
      lastError = upstreamErrorMessage;
      lastErrorAt = nowProvider();
    }
  } finally {
    input.signal?.removeEventListener("abort", releaseOnAbort);
    if (
      releaseLeasesOnComplete ||
      (input.signal?.aborted && releaseLeasesOnAbort)
    ) {
      releaseAdmittedLeases(
        input.signal?.aborted ? "snapshot_aborted" : "snapshot_complete",
      );
    }
  }

  if (!releasedAdmittedLeases && !retainedDemandRegistered) {
    registerRetainedSnapshotDemand({
      owner,
      intent,
      fallbackProvider,
      requiresGreeks,
      underlying,
      admittedLeases: admission.admitted,
    });
  }

  const payload = getPayloadForProviderContractIds(
    normalizedProviderContractIds,
    underlying,
  );
  const returnedProviderContractIds = new Set(
    payload.quotes
      .map((quote) => quote.providerContractId?.trim?.() || "")
      .filter(Boolean),
  );

  return {
    ...payload,
    debug: {
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs:
        hydrateProviderContractIds.length > 0
          ? Math.max(0, Date.now() - upstreamStartedAt)
          : null,
      requestedCount: requestedProviderContractIds.length,
      acceptedCount: admittedProviderContractIds.length,
      rejectedCount:
        requestedProviderContractIds.length - admittedProviderContractIds.length,
      returnedCount: payload.quotes.length,
      bridgeChunks: bridgeChunks.length,
      ...providerDebug,
      blockedReason: liveQuotePolicy.blockedReason,
      errorMessage: upstreamErrorMessage,
      acceptedProviderContractIds: admittedProviderContractIds,
      missingProviderContractIds: normalizedProviderContractIds.filter(
        (providerContractId) => !returnedProviderContractIds.has(providerContractId),
      ),
    },
  };
}

export function subscribeBridgeOptionQuoteSnapshots(
  input: {
    underlying?: string | null;
    providerContractIds: string[];
    owner?: string;
    intent?: MarketDataIntent;
    fallbackProvider?: MarketDataFallbackProvider;
    requiresGreeks?: boolean;
  },
  onSnapshot: (payload: OptionQuoteSnapshotPayload) => void,
): () => void {
  const normalizedProviderContractIds = normalizeResolvableProviderContractIds(
    input.providerContractIds,
  );
  if (!normalizedProviderContractIds.length) {
    return () => {};
  }

  const underlying = normalizeUnderlying(input.underlying);
  const subscriberId = nextSubscriberId;
  nextSubscriberId += 1;
  const owner =
    input.owner?.trim() || `bridge-option-quote-stream:${subscriberId}`;
  const subscriber: Subscriber = {
    id: subscriberId,
    owner,
    intent: input.intent ?? "visible-live",
    fallbackProvider: input.fallbackProvider ?? "massive",
    requiresGreeks: input.requiresGreeks ?? true,
    underlying,
    providerContractIds: new Set(normalizedProviderContractIds),
    onSnapshot,
  };
  subscribers.set(subscriberId, subscriber);
  if (isBridgeRuntimeConfigured()) {
    admitBridgeOptionSubscriberLeases(subscriber);
  } else {
    onSnapshot(
      buildUnconfiguredOptionQuoteSnapshotPayload({
        underlying,
        requestedAt: Date.now(),
        requestedProviderContractIds: normalizeProviderContractIds(
          input.providerContractIds,
        ),
        normalizedProviderContractIds,
      }),
    );
  }

  const cachedPayload = getPayloadForProviderContractIds(
    normalizedProviderContractIds,
    underlying,
  );
  if (cachedPayload.quotes.length > 0) {
    onSnapshot(cachedPayload);
  }

  scheduleRefreshBridgeOptionQuoteStream();

  return () => {
    subscribers.delete(subscriberId);
    releaseMarketDataLeases(owner, "unsubscribe");
    scheduleRefreshBridgeOptionQuoteStream(0);
  };
}

export function getBridgeOptionQuoteStreamDiagnostics(): BridgeOptionQuoteStreamDiagnostics {
  const desiredProviderContractIds = getDesiredProviderContractIds();
  const requestedProviderContractIds = getRequestedProviderContractIds();
  const hasOptionDemand =
    desiredProviderContractIds.length > 0 || requestedProviderContractIds.length > 0;
  const now = nowProvider().getTime();
  const lastEventMs = lastEventAt?.getTime() ?? null;
  const lastSignalMs = lastSignalAt?.getTime() ?? null;
  const capacityPressure = isCapacityPressureState(lastStreamStatus?.state)
    ? lastStreamStatus.state
    : null;

  return {
    activeConsumerCount: subscribers.size,
    unionProviderContractIdCount: desiredProviderContractIds.length,
    requestedProviderContractIdCount: requestedProviderContractIds.length,
    nonLiveProviderContractIdCount: Math.max(
      0,
      requestedProviderContractIds.length - desiredProviderContractIds.length,
    ),
    cachedQuoteCount: quoteCacheByProviderContractId.size,
    eventCount,
    reconnectCount,
    activeBridgeStreamCount: streamChunks.length,
    activeBridgeChunkCount: streamChunks.length,
    lastEventAt: lastEventAt?.toISOString() ?? null,
    lastEventAgeMs:
      lastEventMs === null ? null : Math.max(0, now - lastEventMs),
    lastSignalAt: lastSignalAt?.toISOString() ?? null,
    lastSignalAgeMs:
      lastSignalMs === null ? null : Math.max(0, now - lastSignalMs),
    streamActive: Boolean(
      desiredProviderContractIds.length && streamChunks.length,
    ),
    reconnectScheduled: Boolean(reconnectTimer),
    desiredProviderContractIds: desiredProviderContractIds.slice(0, 100),
    lastError: hasOptionDemand ? lastError : null,
    lastErrorAt: hasOptionDemand
      ? (lastErrorAt?.toISOString() ?? null)
      : null,
    lastStreamStatus: hasOptionDemand
      ? lastStreamStatus
      : null,
    pressure: !hasOptionDemand
      ? "normal"
      : capacityPressure
        ? capacityPressure
        : reconnectTimer
          ? "reconnecting"
          : "normal",
  };
}

export function __setBridgeOptionQuoteClientForTests(
  client: BridgeOptionQuoteClient | null,
): void {
  bridgeClient = client ?? new IbkrBridgeClient();
  bridgeRuntimeConfiguredForTests = client ? true : null;
}

export function __setBridgeOptionQuoteRuntimeConfiguredForTests(
  configured: boolean | null,
): void {
  bridgeRuntimeConfiguredForTests = configured;
}

export function __setBridgeOptionQuoteStreamNowForTests(now: Date | null): void {
  nowProvider = now ? () => new Date(now) : () => new Date();
}

export function __cacheBridgeOptionQuoteForTests(
  quote: QuoteSnapshot,
): QuoteSnapshot | null {
  return cacheQuote(quote);
}

export function __getBridgeOptionQuoteLastErrorForTests(): string | null {
  return lastError;
}

export function __resetBridgeOptionQuoteStreamForTests(): void {
  stopStream();
  clearRefreshTimer();
  clearReconnectTimer();
  clearRetainedSnapshotDemandExpiryTimer();
  Array.from(subscribers.values()).forEach((subscriber) => {
    releaseMarketDataLeases(subscriber.owner, "test_reset");
  });
  Array.from(retainedSnapshotDemands.keys()).forEach((owner) => {
    releaseMarketDataLeases(owner, "test_reset");
  });
  subscribers.clear();
  retainedSnapshotDemands.clear();
  quoteCacheByProviderContractId.clear();
  nextSubscriberId = 1;
  nextSnapshotOwnerId = 1;
  reconnectAttempt = 0;
  eventCount = 0;
  reconnectCount = 0;
  lastEventAt = null;
  lastSignalAt = null;
  lastError = null;
  lastErrorAt = null;
  lastStreamStatus = null;
  bridgeRuntimeConfiguredForTests = null;
  nowProvider = () => new Date();
}
