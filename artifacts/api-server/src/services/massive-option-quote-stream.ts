import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";
import {
  getMassiveRuntimeConfig,
  isMassiveOptionsRealtimeConfigured,
} from "../lib/runtime";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  MassiveMarketDataClient,
  type OptionChainContract as MassiveOptionChainContract,
} from "../providers/massive/market-data";
import {
  admitMarketDataLeases,
  isMarketDataLeaseActive,
  recordMarketDataFallback,
  releaseMarketDataLeaseIds,
  releaseMarketDataLeases,
  subscribeMarketDataLeaseChanges,
  type MarketDataFallbackProvider,
  type MarketDataIntent,
  type MarketDataLease,
} from "./market-data-admission";
import { subscribeApiResourcePressureChanges } from "./resource-pressure";
import { isHttpError } from "../lib/errors";

type QuoteStreamSignal = {
  type: "open" | "ready" | "heartbeat" | "status";
  at: Date;
  status?: {
    state?: string;
    [key: string]: unknown;
  } | null;
};

type OptionQuoteWithSource = QuoteSnapshot & {
  source: "massive";
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
    // Wire-locked legacy key (lib/api-spec/openapi.yaml `bridgeChunks`): counts
    // Massive request chunks; renaming it would break the client contract.
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

export type MassiveOptionQuoteStreamDiagnostics = {
  activeConsumerCount: number;
  unionProviderContractIdCount: number;
  requestedProviderContractIdCount: number;
  nonLiveProviderContractIdCount: number;
  cachedQuoteCount: number;
  eventCount: number;
  reconnectCount: number;
  activeMassiveStreamCount: number;
  activeMassiveChunkCount: number;
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
  pressure: "normal" | "reconnecting";
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

type MassiveOptionQuoteClient = {
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

export type MassiveOptionQuoteSnapshotAdmissionOptions = {
  owner?: string;
  intent?: MarketDataIntent;
  ttlMs?: number;
  fallbackProvider?: MarketDataFallbackProvider;
  requiresGreeks?: boolean;
};

type MassiveOptionQuoteClientFactory = (
  config: NonNullable<ReturnType<typeof getMassiveRuntimeConfig>>,
) => MassiveMarketDataClient;
let massiveOptionQuoteClientFactory: MassiveOptionQuoteClientFactory | null =
  null;
let optionQuoteSnapshotFetcherForTests:
  | ((input: {
      underlying?: string | null;
      providerContractIds: string[];
      signal?: AbortSignal;
      timeoutMs?: number;
    }) => Promise<QuoteSnapshot[]>)
  | null = null;
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
    process.env["MASSIVE_OPTION_QUOTE_STREAM_UNCONFIGURED_RETRY_MS"] ??
      process.env["IBKR_OPTION_QUOTE_STREAM_UNCONFIGURED_RETRY_MS"] ??
      "60000",
    10,
  ) || 60_000,
);
const LIVE_OPTION_QUOTE_STALE_MS = 2_000;
// Freshness of a REST snapshot is about whether WE re-fetched recently, not
// whether the NBBO last CHANGED recently. Massive option snapshots are real-time
// (verified 2026-07-10: liquid SPY contracts return NBBO 2-6s old), so a thinly
// quoted option whose NBBO simply hasn't moved for minutes is still the current
// live market — not stale data. A mark is only stale if our poll has failed to
// refresh it for several cadence cycles (feed/poll stuck), so freshness keys on
// receive-age, not on the NBBO sip_timestamp age. Kept generous relative to the
// ~2s poll so normal poll jitter never flickers a valid mark to "stale".
const OPTION_QUOTE_FETCH_STALE_MS = LIVE_OPTION_QUOTE_STALE_MS * 3;
// Env key predates the Massive migration; kept for deployment compatibility.
const OPTION_QUOTE_CHUNK_SIZE = Math.max(
  1,
  Number.parseInt(process.env["OPTION_QUOTE_BRIDGE_CHUNK_SIZE"] ?? "100", 10) ||
    100,
);
const QUOTE_CACHE_RETAINED_BUFFER_SIZE = 1_000;
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
let massiveRuntimeConfiguredForTests: boolean | null = null;

function normalizeProviderContractIds(providerContractIds: string[]): string[] {
  return Array.from(
    new Set(
      providerContractIds
        .map((providerContractId) => providerContractId.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function normalizeOpraOptionTicker(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }
  const ticker = normalized.startsWith("O:") ? normalized : `O:${normalized}`;
  return /^O:[A-Z0-9.-]+\d{6}[CP]\d{8}$/.test(ticker) ? ticker : null;
}

function opraUnderlying(ticker: string): string | null {
  const normalized = normalizeOpraOptionTicker(ticker);
  if (!normalized) {
    return null;
  }
  const body = normalized.slice(2);
  const match = body.match(/^(.+?)(\d{6}[CP]\d{8})$/);
  return match?.[1] ? normalizeSymbol(match[1]) || null : null;
}

// OCC "adjusted" option roots append a numeric suffix to the base underlying after
// a corporate action (e.g. HON -> HON2). Massive's per-contract snapshot keys on
// the base underlying ASSET, not the adjusted root, and returns 404 "contract and
// underlying don't match" for the adjusted root (verified 2026-07-10: /HON2/ 404s,
// /HON/ 200s). When the derived root ends in digits, offer the digit-stripped base
// symbol as a fallback underlying to retry against.
function opraUnderlyingBaseFallback(underlying: string): string | null {
  const match = underlying.match(/^([A-Za-z]+)\d+$/);
  const base = match?.[1] ? normalizeSymbol(match[1]) : null;
  return base && base !== underlying ? base : null;
}

function normalizeResolvableProviderContractIds(
  providerContractIds: string[],
): string[] {
  return Array.from(
    new Set(
      normalizeProviderContractIds(providerContractIds)
        .map((providerContractId) =>
          normalizeOpraOptionTicker(providerContractId),
        )
        .filter((providerContractId): providerContractId is string =>
          Boolean(providerContractId),
        ),
    ),
  ).sort();
}

function normalizeUnderlying(value: string | null | undefined): string | null {
  const normalized = normalizeSymbol(value ?? "");
  return normalized || null;
}

function isMassiveRuntimeConfigured(): boolean {
  return massiveRuntimeConfiguredForTests ?? Boolean(getMassiveRuntimeConfig());
}

function describeOptionQuoteRuntimeUnavailable(): {
  code: string;
  message: string;
} {
  return {
    code: "massive_not_configured",
    message:
      "Massive options market data is not configured. Set MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY.",
  };
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
    : String(error || "Unknown Massive option quote stream error.");
}

// A generic upstream-unavailable result can happen during provider maintenance
// or transient market-data outages. Keep retrying without turning it into a
// hard option-stream `lastError`; real transport, auth, and capacity problems
// are still reported.
function isUpstreamUnavailableError(error: unknown): boolean {
  if (isHttpError(error)) {
    return (
      error.code === "upstream_request_failed" ||
      error.code === "upstream_http_error"
    );
  }
  return readErrorMessage(error).toLowerCase().includes("upstream request failed");
}

// A transient per-request fault (a 30s `/options/quotes` request timeout or a
// stream stall under load) — recoverable by re-establishing the affected chunk,
// not a reason to tear down every option subscription. Distinguished from
// upstream-unavailable (market closed).
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
  // Time-of-day does not block option-quote / position-mark market data. Trade
  // EXECUTION remains session-gated in signal-options-automation
  // (entry/exit/overnight) and algo-gateway, not here.
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
    pruneQuoteCacheToLiveDemand();
    scheduleRefreshMassiveOptionQuoteStream(0);
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
  scheduleRefreshMassiveOptionQuoteStream(refreshDelayMs);
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
  pruneQuoteCacheToLiveDemand();
  scheduleRefreshMassiveOptionQuoteStream(0);
  scheduleRetainedSnapshotDemandExpiryTimer();
}

function releaseRetainedSnapshotDemandLeases(reason: string): void {
  const owners = Array.from(retainedSnapshotDemands.keys());
  retainedSnapshotDemands.clear();
  clearRetainedSnapshotDemandExpiryTimer();
  owners.forEach((owner) => releaseMarketDataLeases(owner, reason));
  pruneQuoteCacheToLiveDemand();
}

function getRetainedSnapshotDemandValues(): RetainedSnapshotDemand[] {
  pruneRetainedSnapshotDemands();
  return Array.from(retainedSnapshotDemands.values());
}

function hasMassiveOptionQuoteDemand(): boolean {
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

function getLiveQuoteCacheProviderContractIds(): Set<string> {
  const providerContractIds = new Set<string>();
  subscribers.forEach((subscriber) => {
    subscriber.providerContractIds.forEach((providerContractId) => {
      providerContractIds.add(providerContractId);
    });
  });
  getRetainedSnapshotDemandValues().forEach((demand) => {
    demand.providerContractExpirations.forEach((_, providerContractId) => {
      providerContractIds.add(providerContractId);
    });
  });
  return providerContractIds;
}

function hasLiveQuoteCacheDemand(providerContractId: string): boolean {
  if (
    Array.from(subscribers.values()).some((subscriber) =>
      subscriber.providerContractIds.has(providerContractId),
    )
  ) {
    return true;
  }
  return getRetainedSnapshotDemandValues().some((demand) =>
    demand.providerContractExpirations.has(providerContractId),
  );
}

function pruneQuoteCacheToLiveDemand(): void {
  if (quoteCacheByProviderContractId.size === 0) {
    return;
  }
  const liveProviderContractIds = getLiveQuoteCacheProviderContractIds();
  quoteCacheByProviderContractId.forEach((_, providerContractId) => {
    if (!liveProviderContractIds.has(providerContractId)) {
      quoteCacheByProviderContractId.delete(providerContractId);
    }
  });
}

function pruneQuoteCacheToRetainedLimit(): void {
  const liveProviderContractIds = getLiveQuoteCacheProviderContractIds();
  const maxCacheSize =
    liveProviderContractIds.size + QUOTE_CACHE_RETAINED_BUFFER_SIZE;
  if (quoteCacheByProviderContractId.size <= maxCacheSize) {
    return;
  }
  for (const providerContractId of quoteCacheByProviderContractId.keys()) {
    if (quoteCacheByProviderContractId.size <= maxCacheSize) {
      return;
    }
    if (!liveProviderContractIds.has(providerContractId)) {
      quoteCacheByProviderContractId.delete(providerContractId);
    }
  }
}

function admitMassiveOptionSubscriberLeases(subscriber: Subscriber): void {
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

function admitMassiveOptionSubscriberLeasesForRuntime(): void {
  if (!isMassiveRuntimeConfigured()) {
    return;
  }
  subscribers.forEach(admitMassiveOptionSubscriberLeases);
}

function releaseMassiveOptionSubscriberLeases(reason: string): void {
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
  const marketDataUpdatedAt = readTimestampMs(
    quote.dataUpdatedAt ?? quote.updatedAt,
  );
  const hasPrevClose = quote.prevClose != null;
  const ageMs =
    lastReceivedAt === null
      ? null
      : Math.max(0, emittedAt.getTime() - lastReceivedAt);
  const marketDataAgeMs =
    marketDataUpdatedAt === null
      ? finiteNumber(quote.ageMs)
      : Math.max(0, emittedAt.getTime() - marketDataUpdatedAt);
  const freshness =
    ageMs !== null && ageMs > OPTION_QUOTE_FETCH_STALE_MS
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
        change: hasPrevClose
          ? finiteNumber(quote.change)
          : null,
        changePercent: hasPrevClose
          ? finiteNumber(quote.changePercent)
          : null,
        ageMs: marketDataAgeMs,
        cacheAgeMs: ageMs,
        freshness,
      },
      "apiServerEmittedAt",
      emittedAt,
    ),
    source: "massive",
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

function cacheQuote(
  quote: QuoteSnapshot,
  options: { allowUndemanded?: boolean } = {},
): QuoteSnapshot | null {
  const providerContractId = quote.providerContractId?.trim?.() || "";
  if (!providerContractId) {
    return null;
  }
  if (!options.allowUndemanded && !hasLiveQuoteCacheDemand(providerContractId)) {
    quoteCacheByProviderContractId.delete(providerContractId);
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
  quoteCacheByProviderContractId.delete(providerContractId);
  quoteCacheByProviderContractId.set(providerContractId, cached);
  pruneQuoteCacheToRetainedLimit();
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
      logger.warn({ err: error }, "Massive option quote stream unsubscribe failed");
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
        "Massive option quote stream chunk unsubscribe failed",
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
  let stopped = false;
  let pollTimer: NodeJS.Timeout | null = null;
  const poll = () => {
    if (stopped || streamSignature !== signature) {
      return;
    }
    fetchMassiveOptionQuoteSnapshotsUpstream({
      underlying: null,
      providerContractIds: contracts,
    })
      .then((quotes) => {
        if (stopped || streamSignature !== signature) {
          return;
        }
        chunk.reconnectAttempt = 0;
        const cachedQuotes = quotes.flatMap((quote) => {
          const cached = cacheQuote(quote);
          return cached ? [cached] : [];
        });
        notifySubscribers(cachedQuotes);
        lastSignalAt = nowProvider();
        lastStreamStatus = {
          state: "subscribed",
          requestedCount: contracts.length,
          admittedCount: contracts.length,
          rejectedCount: 0,
        };
      })
      .catch((error) => handleChunkStreamError(signature, slot, error))
      .finally(() => {
        // When a transient error already armed the per-chunk backoff reconnect
        // (handleChunkStreamError), do not also re-arm the fixed-cadence poll —
        // otherwise the ~2s poll races ahead of the exponential backoff and
        // defeats it, hammering Massive every ~2s during a sustained outage.
        if (stopped || streamSignature !== signature || chunk.reconnectTimer) {
          return;
        }
        pollTimer = setTimeout(poll, Math.max(1_000, LIVE_OPTION_QUOTE_STALE_MS));
        pollTimer.unref?.();
      });
  };
  chunk.unsubscribe = () => {
    stopped = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };
  poll();
}

// One chunk's Massive refresh failed. For a transient fault, re-establish only
// that chunk with per-chunk backoff, leaving other option quote chunks active.
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
  if (reconnectTimer || !hasMassiveOptionQuoteDemand()) {
    if (!hasMassiveOptionQuoteDemand()) {
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
    refreshMassiveOptionQuoteStream();
  }, delayMs);
  reconnectTimer.unref?.();
}

function handleStreamError(expectedSignature: string, error: unknown) {
  if (streamSignature !== expectedSignature) {
    return;
  }

  const now = nowProvider();
  if (isUpstreamUnavailableError(error)) {
    // Options upstream unavailable (e.g. market closed off-hours). Keep reconnecting
    // 24/7, but do not record a hard connection error — this is data availability, not
    // a transport fault.
    lastSignalAt = now;
    lastError = null;
    lastErrorAt = null;
    logger.info(
      { err: error, providerContractIds: expectedSignature },
      "Massive option quote upstream unavailable; will retry",
    );
    stopStream();
    scheduleReconnect();
    return;
  }

  lastError = readErrorMessage(error);
  lastErrorAt = now;
  logger.warn(
    { err: error, providerContractIds: expectedSignature },
    "Massive option quote stream failed",
  );
  stopStream();
  scheduleReconnect();
}

function refreshMassiveOptionQuoteStream() {
  clearReconnectTimer();
  clearRefreshTimer();

  if (!isMassiveRuntimeConfigured()) {
    const unavailable = describeOptionQuoteRuntimeUnavailable();
    const requestedProviderContractIds = getRequestedProviderContractIds();
    stopStream();
    releaseMassiveOptionSubscriberLeases("runtime_unconfigured");
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
      reason: unavailable.code,
      message: unavailable.message,
      requestedCount: requestedProviderContractIds.length,
      admittedCount: 0,
      rejectedCount: requestedProviderContractIds.length,
      retryDelayMs: UNCONFIGURED_OPTION_STREAM_RETRY_MS,
    };
    scheduleRefreshMassiveOptionQuoteStream(UNCONFIGURED_OPTION_STREAM_RETRY_MS);
    return;
  }

  admitMassiveOptionSubscriberLeasesForRuntime();

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
  const chunks = chunkValues(providerContractIds, OPTION_QUOTE_CHUNK_SIZE);

  try {
    streamChunks = [];
    chunks.forEach((chunk, slot) => {
      subscribeOptionChunk(nextSignature, chunk, slot);
    });
  } catch (error) {
    handleStreamError(nextSignature, error);
  }
}

function scheduleRefreshMassiveOptionQuoteStream(
  delayMs = STREAM_RECONFIGURE_DEBOUNCE_MS,
) {
  clearRefreshTimer();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshMassiveOptionQuoteStream();
  }, Math.max(0, delayMs));
  refreshTimer.unref?.();
}

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
  scheduleRefreshMassiveOptionQuoteStream(0);
});

subscribeApiResourcePressureChanges(() => {
  if (hasMassiveOptionQuoteDemand()) {
    scheduleRefreshMassiveOptionQuoteStream(0);
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
  const config = getMassiveRuntimeConfig();
  if (!config) {
    return {
      providerMode: null,
      liveMarketDataAvailable: null,
    };
  }

  const realtime = isMassiveOptionsRealtimeConfigured(config);
  return {
    providerMode: realtime ? "massive-options-realtime" : "massive-options-delayed",
    liveMarketDataAvailable: realtime,
  };
}

function getMassiveOptionQuoteClient(): MassiveMarketDataClient {
  const config = getMassiveRuntimeConfig();
  if (!config) {
    throw new Error(
      "Massive options market data is not configured. Set MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY.",
    );
  }
  return massiveOptionQuoteClientFactory?.(config) ?? new MassiveMarketDataClient(config);
}

function massiveOptionSnapshotToQuoteSnapshot(
  snapshot: MassiveOptionChainContract,
  providerContractId: string,
  delayed: boolean,
): QuoteSnapshot {
  const bid = finiteNumber(snapshot.bid) ?? 0;
  const ask = finiteNumber(snapshot.ask) ?? 0;
  const last = finiteNumber(snapshot.last);
  const mark =
    positiveNumber(snapshot.mark) ??
    positiveNumber(last) ??
    midpoint(bid, ask) ??
    0;
  const prevClose = finiteNumber(snapshot.prevClose);

  return {
    symbol: providerContractId,
    price: mark,
    last,
    mark,
    bid,
    ask,
    bidSize: 0,
    askSize: 0,
    change:
      prevClose != null
        ? finiteNumber(snapshot.change) ?? 0
        : null,
    changePercent:
      prevClose != null
        ? finiteNumber(snapshot.changePercent) ?? 0
        : null,
    open: null,
    high: null,
    low: null,
    prevClose,
    volume: finiteNumber(snapshot.volume),
    openInterest: finiteNumber(snapshot.openInterest),
    impliedVolatility: finiteNumber(snapshot.impliedVolatility),
    delta: finiteNumber(snapshot.delta),
    gamma: finiteNumber(snapshot.gamma),
    theta: finiteNumber(snapshot.theta),
    vega: finiteNumber(snapshot.vega),
    underlyingPrice: finiteNumber(snapshot.underlyingPrice),
    updatedAt: snapshot.updatedAt,
    providerContractId,
    transport: "massive_rest",
    delayed,
    freshness: delayed ? "delayed" : "live",
    marketDataMode: delayed ? "delayed" : "live",
    dataUpdatedAt: snapshot.updatedAt,
    ageMs: Math.max(0, Date.now() - snapshot.updatedAt.getTime()),
  };
}

async function fetchMassiveOptionQuoteSnapshotsUpstream(input: {
  underlying: string | null;
  providerContractIds: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<QuoteSnapshot[]> {
  if (optionQuoteSnapshotFetcherForTests) {
    return optionQuoteSnapshotFetcherForTests({
      underlying: input.underlying,
      providerContractIds: input.providerContractIds,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
    });
  }

  const config = getMassiveRuntimeConfig();
  if (!config) {
    throw new Error(
      "Massive options market data is not configured. Set MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY.",
    );
  }
  const client = getMassiveOptionQuoteClient();
  const delayed = !isMassiveOptionsRealtimeConfigured(config);
  const providerContractIds = normalizeResolvableProviderContractIds(
    input.providerContractIds,
  );

  const snapshots = await Promise.all(
    providerContractIds.map(async (providerContractId) => {
      const underlying = input.underlying ?? opraUnderlying(providerContractId);
      if (!underlying) {
        return null;
      }
      try {
        const snapshot = await client.getOptionContractSnapshot({
          underlying,
          optionTicker: providerContractId,
          signal: input.signal,
        });
        return snapshot
          ? massiveOptionSnapshotToQuoteSnapshot(
              snapshot,
              providerContractId,
              delayed,
            )
          : null;
      } catch (error) {
        // A single contract's failure must NOT reject the whole chunk. One bad
        // contract — a delisted/expired contract, or an adjusted root that fails
        // even the fallback below — would otherwise reject Promise.all, trip the
        // stream-level upstream-unavailable handler, and wedge the ENTIRE option
        // quote poll into a reconnect loop that starves every held mark. Skip the
        // one bad contract; keep every other contract's quote flowing. Real aborts
        // still propagate so cancellation isn't swallowed.
        if (input.signal?.aborted) {
          throw error;
        }
        // Adjusted-root recovery: an OCC-adjusted contract (e.g. HON2) derives an
        // underlying that 404s "contract and underlying don't match"; retry once
        // against the base underlying asset (HON) before giving up on it.
        const fallbackUnderlying = opraUnderlyingBaseFallback(underlying);
        if (fallbackUnderlying) {
          try {
            const fallbackSnapshot = await client.getOptionContractSnapshot({
              underlying: fallbackUnderlying,
              optionTicker: providerContractId,
              signal: input.signal,
            });
            return fallbackSnapshot
              ? massiveOptionSnapshotToQuoteSnapshot(
                  fallbackSnapshot,
                  providerContractId,
                  delayed,
                )
              : null;
          } catch (fallbackError) {
            if (input.signal?.aborted) {
              throw fallbackError;
            }
            // fall through to skip
          }
        }
        logger.warn(
          { err: error, providerContractId, underlying },
          "Massive option contract snapshot failed; skipping this contract",
        );
        return null;
      }
    }),
  );

  return snapshots.filter((snapshot): snapshot is QuoteSnapshot => snapshot !== null);
}

function buildUnconfiguredOptionQuoteSnapshotPayload(input: {
  underlying: string | null;
  requestedAt: number;
  requestedProviderContractIds: string[];
  normalizedProviderContractIds: string[];
}): OptionQuoteSnapshotPayload {
  const unavailable = describeOptionQuoteRuntimeUnavailable();
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
      errorCode: unavailable.code,
      errorMessage: unavailable.message,
      acceptedProviderContractIds: [],
      missingProviderContractIds: input.normalizedProviderContractIds,
    },
  };
}

export function getCurrentMassiveOptionQuoteSnapshots(input: {
  underlying?: string | null;
  providerContractIds: string[];
}): OptionQuoteWithSource[] {
  return getPayloadForProviderContractIds(
    normalizeResolvableProviderContractIds(input.providerContractIds),
    normalizeUnderlying(input.underlying),
  ).quotes;
}

export async function fetchMassiveOptionQuoteSnapshots(input: {
  underlying?: string | null;
  providerContractIds: string[];
  owner?: string;
  intent?: MarketDataIntent;
  ttlMs?: number;
  fallbackProvider?: MarketDataFallbackProvider;
  requiresGreeks?: boolean;
  hydrateCached?: boolean;
  timeoutMs?: number;
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
  const normalizedProviderContractIds = normalizeResolvableProviderContractIds(
    requestedProviderContractIds,
  );
  const owner =
    input.owner?.trim() || `massive-option-quote-snapshot:${nextSnapshotOwnerId++}`;
  const intent = input.intent ?? "visible-live";
  const hydrateCached = input.hydrateCached === true;
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
          ? "No Massive/OPRA option providerContractIds were requested."
          : null,
        acceptedProviderContractIds: [],
        missingProviderContractIds: requestedProviderContractIds,
      },
    };
  }
  if (!isMassiveRuntimeConfigured()) {
    stopStream();
    releaseMassiveOptionSubscriberLeases("runtime_unconfigured");
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
    OPTION_QUOTE_CHUNK_SIZE,
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
  // Display/monitor reads can serve a cached quote and let the retained demand
  // refresher update it. Execution-adjacent reads still hydrate synchronously.
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
      if (cachedQuote && servesCachedWithoutBlocking && !hydrateCached) {
        return false;
      }
      return true;
    },
  );

  const upstreamStartedAt = Date.now();
  let upstreamErrorMessage: string | null = null;
  try {
    if (hydrateProviderContractIds.length > 0) {
      const freshQuotes = await fetchMassiveOptionQuoteSnapshotsUpstream({
        underlying,
        providerContractIds: hydrateProviderContractIds,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      });
      freshQuotes.forEach((quote) => {
        cacheQuote(quote, { allowUndemanded: true });
      });
    }
  } catch (error) {
    upstreamErrorMessage = readErrorMessage(error);
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

export function subscribeMassiveOptionQuoteSnapshots(
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
    input.owner?.trim() || `massive-option-quote-stream:${subscriberId}`;
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
  if (isMassiveRuntimeConfigured()) {
    admitMassiveOptionSubscriberLeases(subscriber);
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

  scheduleRefreshMassiveOptionQuoteStream();

  return () => {
    subscribers.delete(subscriberId);
    releaseMarketDataLeases(owner, "unsubscribe");
    pruneQuoteCacheToLiveDemand();
    scheduleRefreshMassiveOptionQuoteStream(0);
  };
}

export function getMassiveOptionQuoteStreamDiagnostics(): MassiveOptionQuoteStreamDiagnostics {
  const desiredProviderContractIds = getDesiredProviderContractIds();
  const requestedProviderContractIds = getRequestedProviderContractIds();
  const hasOptionDemand =
    desiredProviderContractIds.length > 0 || requestedProviderContractIds.length > 0;
  const now = nowProvider().getTime();
  const lastEventMs = lastEventAt?.getTime() ?? null;
  const lastSignalMs = lastSignalAt?.getTime() ?? null;

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
    activeMassiveStreamCount: streamChunks.length,
    activeMassiveChunkCount: streamChunks.length,
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
      : reconnectTimer
        ? "reconnecting"
        : "normal",
  };
}

export function __setMassiveOptionQuoteClientForTests(
  client: MassiveOptionQuoteClient | null,
): void {
  optionQuoteSnapshotFetcherForTests = client
    ? (input) => client.getOptionQuoteSnapshots(input)
    : null;
  massiveRuntimeConfiguredForTests = client ? true : null;
}

export function __setMassiveOptionQuoteClientFactoryForTests(
  factory: MassiveOptionQuoteClientFactory | null,
): void {
  massiveOptionQuoteClientFactory = factory;
}

export function __setMassiveOptionQuoteRuntimeConfiguredForTests(
  configured: boolean | null,
): void {
  massiveRuntimeConfiguredForTests = configured;
}

export function __setMassiveOptionQuoteStreamNowForTests(now: Date | null): void {
  nowProvider = now ? () => new Date(now) : () => new Date();
}

export function __cacheMassiveOptionQuoteForTests(
  quote: QuoteSnapshot,
): QuoteSnapshot | null {
  return cacheQuote(quote);
}

export const __massiveOptionSnapshotToQuoteSnapshotForTests =
  massiveOptionSnapshotToQuoteSnapshot;

export function __getMassiveOptionQuoteLastErrorForTests(): string | null {
  return lastError;
}

export function __resetMassiveOptionQuoteStreamForTests(): void {
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
  massiveRuntimeConfiguredForTests = null;
  massiveOptionQuoteClientFactory = null;
  optionQuoteSnapshotFetcherForTests = null;
  nowProvider = () => new Date();
}
