import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";
import {
  IbkrBridgeClient,
  type QuoteStreamSignal,
} from "../providers/ibkr/bridge-client";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  isBridgeWorkBackedOff,
  runBridgeWork,
} from "./bridge-governor";
import {
  admitMarketDataLeases,
  isMarketDataLeaseActive,
  releaseMarketDataLeases,
  type MarketDataFallbackProvider,
  type MarketDataIntent,
} from "./market-data-admission";

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
    acceptedProviderContractIds: string[];
    missingProviderContractIds: string[];
  };
};

export type BridgeOptionQuoteStreamDiagnostics = {
  activeConsumerCount: number;
  unionProviderContractIdCount: number;
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
  underlying: string | null;
  providerContractIds: Set<string>;
  onSnapshot: (payload: OptionQuoteSnapshotPayload) => void;
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
const quoteCacheByProviderContractId = new Map<string, QuoteSnapshot>();
const STREAM_RECONFIGURE_DEBOUNCE_MS = 150;
const RECONNECT_DELAY_MIN_MS = 1_000;
const RECONNECT_DELAY_MAX_MS = 30_000;
const LIVE_OPTION_QUOTE_STALE_MS = 2_000;
const OPTION_QUOTE_BRIDGE_CHUNK_SIZE = Math.max(
  1,
  Number.parseInt(process.env["OPTION_QUOTE_BRIDGE_CHUNK_SIZE"] ?? "100", 10) ||
    100,
);

let nextSubscriberId = 1;
let nextSnapshotOwnerId = 1;
let streamSignature = "";
let streamUnsubscribes: Array<() => void> = [];
let refreshTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
let eventCount = 0;
let reconnectCount = 0;
let lastEventAt: Date | null = null;
let lastSignalAt: Date | null = null;
let lastError: string | null = null;
let lastErrorAt: Date | null = null;
let lastStreamStatus: NonNullable<QuoteStreamSignal["status"]> | null = null;
let nowProvider = () => new Date();

function normalizeProviderContractIds(providerContractIds: string[]): string[] {
  return Array.from(
    new Set(
      providerContractIds
        .map((providerContractId) => providerContractId.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function normalizeUnderlying(value: string | null | undefined): string | null {
  const normalized = normalizeSymbol(value ?? "");
  return normalized || null;
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  const normalizedChunkSize = Math.max(1, Math.floor(chunkSize));
  for (let index = 0; index < values.length; index += normalizedChunkSize) {
    chunks.push(values.slice(index, index + normalizedChunkSize));
  }
  return chunks;
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

function isCapacityPressureError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  return (
    message.includes("ibkr_bridge_lane_queue_full") ||
    message.includes("lane queue is full") ||
    message.includes("market data line") ||
    message.includes("max number of tickers") ||
    message.includes("ticker limit") ||
    message.includes("subscription limit")
  );
}

function capacityPressureFromError(
  error: unknown,
): "backpressure" | "capacity_limited" {
  const message = readErrorMessage(error).toLowerCase();
  return message.includes("ibkr_bridge_lane_queue_full") ||
    message.includes("lane queue is full")
    ? "backpressure"
    : "capacity_limited";
}

function getDesiredProviderContractIds(): string[] {
  return normalizeProviderContractIds(
    Array.from(subscribers.values()).flatMap((subscriber) =>
      Array.from(subscriber.providerContractIds).filter((providerContractId) =>
        isMarketDataLeaseActive({
          owner: subscriber.owner,
          assetClass: "option",
          providerContractId,
        }),
      ),
    ),
  );
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
    {
      ...quote,
      providerContractId,
    },
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
  streamUnsubscribes.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch (error) {
      logger.warn({ err: error }, "Bridge option quote stream unsubscribe failed");
    }
  });
  streamUnsubscribes = [];
  streamSignature = "";
}

function scheduleReconnect() {
  if (reconnectTimer || subscribers.size === 0) {
    if (subscribers.size === 0) {
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
    lastStreamStatus = {
      state: capacityPressureFromError(error),
      reason: "ibkr_option_stream_capacity_limited",
      message: readErrorMessage(error),
    };
    lastSignalAt = now;
    lastError = null;
    lastErrorAt = null;
    stopStream();
    scheduleRefreshBridgeOptionQuoteStream(RECONNECT_DELAY_MIN_MS);
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
    streamUnsubscribes = chunks.map((chunk) =>
      bridgeClient.streamOptionQuoteSnapshots(
        {
          providerContractIds: chunk,
        },
        (quotes) => {
          const cachedQuotes = quotes.flatMap((quote) => {
            const cached = cacheQuote(quote);
            return cached ? [cached] : [];
          });
          notifySubscribers(cachedQuotes);
        },
        (error) => handleStreamError(nextSignature, error),
        recordStreamSignal,
      ),
    );
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

function shouldHydrateQuoteSnapshot(
  quote: OptionQuoteWithSource | undefined,
): boolean {
  if (!quote) {
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

export function getCurrentBridgeOptionQuoteSnapshots(input: {
  underlying?: string | null;
  providerContractIds: string[];
}): OptionQuoteWithSource[] {
  return getPayloadForProviderContractIds(
    input.providerContractIds,
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
}): Promise<OptionQuoteSnapshotPayload> {
  const requestedAt = Date.now();
  const underlying = normalizeUnderlying(input.underlying);
  const normalizedProviderContractIds = normalizeProviderContractIds(
    input.providerContractIds,
  );
  const owner =
    input.owner?.trim() || `bridge-option-quote-snapshot:${nextSnapshotOwnerId++}`;
  const intent = input.intent ?? "visible-live";
  const ttlMs = Math.max(1, Math.floor(input.ttlMs ?? 10_000));
  const fallbackProvider = input.fallbackProvider ?? "polygon";
  const requiresGreeks = input.requiresGreeks ?? true;
  const admission = admitMarketDataLeases({
    owner,
    intent,
    requests: normalizedProviderContractIds.map((providerContractId) => ({
      assetClass: "option" as const,
      symbol: underlying,
      underlying,
      providerContractId,
      requiresGreeks,
    })),
    ttlMs,
    fallbackProvider,
  });
  const admittedProviderContractIds = admission.admitted
    .map((lease) => lease.providerContractId)
    .filter((providerContractId): providerContractId is string =>
      Boolean(providerContractId),
    );
  const bridgeChunks = chunkValues(
    admittedProviderContractIds,
    OPTION_QUOTE_BRIDGE_CHUNK_SIZE,
  );
  const providerDebug = await getOptionQuoteProviderDebug();
  const cachedQuotes = getPayloadForProviderContractIds(
    admittedProviderContractIds.length
      ? admittedProviderContractIds
      : normalizedProviderContractIds,
    underlying,
  );
  const cachedQuotesByProviderContractId = new Map(
    cachedQuotes.quotes.map((quote) => [
      quote.providerContractId?.trim?.() || "",
      quote,
    ]),
  );
  const hydrateProviderContractIds = admittedProviderContractIds.filter(
    (providerContractId) =>
      shouldHydrateQuoteSnapshot(
        cachedQuotesByProviderContractId.get(providerContractId),
      ),
  );

  if (isBridgeWorkBackedOff("options")) {
    releaseMarketDataLeases(owner, "snapshot_complete");
    return {
      ...cachedQuotes,
      debug: {
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        requestedCount: normalizedProviderContractIds.length,
        acceptedCount: admittedProviderContractIds.length,
        rejectedCount:
          normalizedProviderContractIds.length - admittedProviderContractIds.length,
        returnedCount: cachedQuotes.quotes.length,
        bridgeChunks: bridgeChunks.length,
        ...providerDebug,
        acceptedProviderContractIds: admittedProviderContractIds,
        missingProviderContractIds: normalizedProviderContractIds.filter(
          (providerContractId) =>
            !cachedQuotesByProviderContractId.has(providerContractId),
        ),
      },
    };
  }

  const upstreamStartedAt = Date.now();
  try {
    if (hydrateProviderContractIds.length > 0) {
      const freshQuotes = (
        await Promise.all(
          chunkValues(
            hydrateProviderContractIds,
            OPTION_QUOTE_BRIDGE_CHUNK_SIZE,
          ).map((providerContractIds) =>
            runBridgeWork("options", () =>
              bridgeClient.getOptionQuoteSnapshots({
                underlying,
                providerContractIds,
              }),
            ),
          ),
        )
      ).flat();
      freshQuotes.forEach(cacheQuote);
    }
  } catch (error) {
    lastError = readErrorMessage(error);
    lastErrorAt = nowProvider();
  } finally {
    releaseMarketDataLeases(owner, "snapshot_complete");
  }

  const payload = getPayloadForProviderContractIds(
    admittedProviderContractIds.length
      ? admittedProviderContractIds
      : normalizedProviderContractIds,
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
      requestedCount: normalizedProviderContractIds.length,
      acceptedCount: admittedProviderContractIds.length,
      rejectedCount:
        normalizedProviderContractIds.length - admittedProviderContractIds.length,
      returnedCount: payload.quotes.length,
      bridgeChunks: bridgeChunks.length,
      ...providerDebug,
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
  },
  onSnapshot: (payload: OptionQuoteSnapshotPayload) => void,
): () => void {
  const normalizedProviderContractIds = normalizeProviderContractIds(
    input.providerContractIds,
  );
  if (!normalizedProviderContractIds.length) {
    return () => {};
  }

  const underlying = normalizeUnderlying(input.underlying);
  const subscriberId = nextSubscriberId;
  nextSubscriberId += 1;
  const owner = `bridge-option-quote-stream:${subscriberId}`;
  const admission = admitMarketDataLeases({
    owner,
    intent: "visible-live",
    requests: normalizedProviderContractIds.map((providerContractId) => ({
      assetClass: "option" as const,
      symbol: underlying,
      underlying,
      providerContractId,
      requiresGreeks: true,
    })),
    fallbackProvider: "polygon",
  });
  const admittedProviderContractIds = admission.admitted
    .map((lease) => lease.providerContractId)
    .filter((providerContractId): providerContractId is string =>
      Boolean(providerContractId),
    );
  if (!admittedProviderContractIds.length) {
    return () => {
      releaseMarketDataLeases(owner, "unsubscribe");
    };
  }

  subscribers.set(subscriberId, {
    id: subscriberId,
    owner,
    underlying,
    providerContractIds: new Set(admittedProviderContractIds),
    onSnapshot,
  });

  const cachedPayload = getPayloadForProviderContractIds(
    admittedProviderContractIds,
    underlying,
  );
  if (cachedPayload.quotes.length > 0) {
    onSnapshot(cachedPayload);
  }

  scheduleRefreshBridgeOptionQuoteStream();

  return () => {
    subscribers.delete(subscriberId);
    releaseMarketDataLeases(owner, "unsubscribe");
    scheduleRefreshBridgeOptionQuoteStream();
  };
}

export function getBridgeOptionQuoteStreamDiagnostics(): BridgeOptionQuoteStreamDiagnostics {
  const desiredProviderContractIds = getDesiredProviderContractIds();
  const now = nowProvider().getTime();
  const lastEventMs = lastEventAt?.getTime() ?? null;
  const lastSignalMs = lastSignalAt?.getTime() ?? null;
  const capacityPressure = isCapacityPressureState(lastStreamStatus?.state)
    ? lastStreamStatus.state
    : null;

  return {
    activeConsumerCount: subscribers.size,
    unionProviderContractIdCount: desiredProviderContractIds.length,
    cachedQuoteCount: quoteCacheByProviderContractId.size,
    eventCount,
    reconnectCount,
    activeBridgeStreamCount: streamUnsubscribes.length,
    activeBridgeChunkCount: streamUnsubscribes.length,
    lastEventAt: lastEventAt?.toISOString() ?? null,
    lastEventAgeMs:
      lastEventMs === null ? null : Math.max(0, now - lastEventMs),
    lastSignalAt: lastSignalAt?.toISOString() ?? null,
    lastSignalAgeMs:
      lastSignalMs === null ? null : Math.max(0, now - lastSignalMs),
    streamActive: Boolean(
      desiredProviderContractIds.length && streamUnsubscribes.length,
    ),
    reconnectScheduled: Boolean(reconnectTimer),
    desiredProviderContractIds: desiredProviderContractIds.slice(0, 100),
    lastError: desiredProviderContractIds.length ? lastError : null,
    lastErrorAt: desiredProviderContractIds.length
      ? (lastErrorAt?.toISOString() ?? null)
      : null,
    lastStreamStatus: desiredProviderContractIds.length
      ? lastStreamStatus
      : null,
    pressure: !desiredProviderContractIds.length
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
}

export function __setBridgeOptionQuoteStreamNowForTests(now: Date | null): void {
  nowProvider = now ? () => new Date(now) : () => new Date();
}

export function __cacheBridgeOptionQuoteForTests(
  quote: QuoteSnapshot,
): QuoteSnapshot | null {
  return cacheQuote(quote);
}

export function __resetBridgeOptionQuoteStreamForTests(): void {
  stopStream();
  clearRefreshTimer();
  clearReconnectTimer();
  Array.from(subscribers.values()).forEach((subscriber) => {
    releaseMarketDataLeases(subscriber.owner, "test_reset");
  });
  subscribers.clear();
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
  nowProvider = () => new Date();
}
