import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";
import {
  IbkrBridgeClient,
  type MutableQuoteStream,
  type QuoteStreamSignal,
} from "../providers/ibkr/bridge-client";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  admitMarketDataLeases,
  isMarketDataLeaseActive,
  releaseMarketDataLeases,
} from "./market-data-admission";

type QuoteWithSource = QuoteSnapshot & {
  source: "ibkr";
};

type QuoteSnapshotPayload = {
  quotes: QuoteWithSource[];
};

export type BridgeQuoteStreamDiagnostics = {
  activeConsumerCount: number;
  unionSymbolCount: number;
  cachedQuoteCount: number;
  eventCount: number;
  reconnectCount: number;
  streamGapCount: number;
  dataGapCount: number;
  recentGapCount: number;
  recentDataGapCount: number;
  maxGapMs: number | null;
  maxDataGapMs: number | null;
  recentMaxGapMs: number | null;
  recentMaxDataGapMs: number | null;
  lastGapMs: number | null;
  lastDataGapMs: number | null;
  lastGapAt: string | null;
  lastDataGapAt: string | null;
  lastGapAgeMs: number | null;
  lastDataGapAgeMs: number | null;
  lastEventAt: string | null;
  lastEventAgeMs: number | null;
  lastSignalAt: string | null;
  lastSignalAgeMs: number | null;
  freshnessAgeMs: number | null;
  dataFreshnessAgeMs: number | null;
  transportFreshnessAgeMs: number | null;
  streamActive: boolean;
  streamSignature: string;
  pendingStreamSignature: string;
  mutableStreamActive: boolean;
  mutableStreamSupported: boolean;
  mutableUpdateCount: number;
  lastMutableUpdateAt: string | null;
  lastMutableUpdateAgeMs: number | null;
  reconnectScheduled: boolean;
  desiredSymbols: string[];
  lastError: string | null;
  lastErrorAt: string | null;
  staleReconnectCount: number;
  lastStallAt: string | null;
  lastStallReason: string | null;
  lastStreamStatus: unknown | null;
  pressure: "normal" | "stale" | "reconnecting" | "capacity_limited" | "backpressure";
};

type Subscriber = {
  id: number;
  owner: string;
  symbols: Set<string>;
  onSnapshot: (payload: QuoteSnapshotPayload) => void;
};

type BridgeQuoteClient = {
  getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]>;
  streamMutableQuoteSnapshots?(
    symbols: string[],
    onQuotes: (quotes: QuoteSnapshot[]) => void,
    onError?: (error: unknown) => void,
    onSignal?: (signal: QuoteStreamSignal) => void,
  ): MutableQuoteStream;
  streamQuoteSnapshots(
    symbols: string[],
    onQuotes: (quotes: QuoteSnapshot[]) => void,
    onError?: (error: unknown) => void,
    onSignal?: (signal: QuoteStreamSignal) => void,
  ): () => void;
};

let bridgeClient: BridgeQuoteClient = new IbkrBridgeClient();
const subscribers = new Map<number, Subscriber>();
const quoteCacheBySymbol = new Map<string, QuoteSnapshot>();
const RECONNECT_DELAY_MIN_MS = 1_000;
const RECONNECT_DELAY_MAX_MS = 30_000;
const STREAM_RECONFIGURE_DEBOUNCE_MS = 150;
const LIVE_QUOTE_STALE_MS = 2_000;
const STREAM_GAP_WARNING_MS = 5_000;
const STREAM_GAP_RECENT_WINDOW_MS = 5 * 60_000;
const QUIET_MARKET_RETRY_MS = Math.max(
  5_000,
  Number.parseInt(process.env["IBKR_QUOTE_STREAM_QUIET_RETRY_MS"] ?? "60000", 10) ||
    60_000,
);
const STREAM_STALL_RECONNECT_MS = Math.max(
  15_000,
  Number.parseInt(process.env["IBKR_QUOTE_STREAM_STALL_MS"] ?? "45000", 10) ||
    45_000,
);

let nextSubscriberId = 1;
let streamSignature = "";
let streamUnsubscribe: (() => void) | null = null;
let streamMutableControl: MutableQuoteStream | null = null;
let pendingStreamSignature = "";
let pendingStreamUnsubscribe: (() => void) | null = null;
let pendingStreamMutableControl: MutableQuoteStream | null = null;
let pendingStreamStartedAt: Date | null = null;
let pendingReadyAt: Date | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let stallTimer: NodeJS.Timeout | null = null;
let eventCount = 0;
let reconnectCount = 0;
let staleReconnectCount = 0;
let reconnectAttempt = 0;
let mutableQuoteStreamSupported = true;
let mutableUpdateCount = 0;
let lastMutableUpdateAt: Date | null = null;
let streamGapCount = 0;
let maxGapMs = 0;
let lastGapMs: number | null = null;
let lastGapAt: Date | null = null;
const streamGapEvents: { at: Date; gapMs: number }[] = [];
let lastEventAt: Date | null = null;
let lastEventHadActiveDemand = false;
let lastSignalAt: Date | null = null;
let streamStartedAt: Date | null = null;
let lastError: string | null = null;
let lastErrorAt: Date | null = null;
let lastStallAt: Date | null = null;
let lastStallReason: string | null = null;
let lastStreamStatus: NonNullable<QuoteStreamSignal["status"]> | null = null;
let nowProvider = () => new Date();
let nextSnapshotOwnerId = 1;

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  ).sort();
}

function getDesiredSymbols(): string[] {
  return normalizeSymbols(
    Array.from(subscribers.values()).flatMap((subscriber) =>
      Array.from(subscriber.symbols).filter((symbol) =>
        isMarketDataLeaseActive({
          owner: subscriber.owner,
          assetClass: "equity",
          symbol,
        }),
      ),
    ),
  );
}

function addApiLatency(
  quote: QuoteSnapshot,
  timestampKey: "apiServerReceivedAt" | "apiServerEmittedAt",
  at = new Date(),
): QuoteSnapshot {
  return {
    ...quote,
    latency: {
      ...(quote.latency ?? {}),
      [timestampKey]: at,
    },
  };
}

function toPayloadQuote(quote: QuoteSnapshot): QuoteWithSource {
  const emittedAt = nowProvider();
  const lastReceivedAt = readTimestampMs(quote.latency?.apiServerReceivedAt);
  const ageMs =
    lastReceivedAt === null
      ? null
      : Math.max(0, emittedAt.getTime() - lastReceivedAt);
  return {
    ...addApiLatency(
      {
        ...quote,
        cacheAgeMs: ageMs,
        freshness:
          ageMs === null
            ? quote.freshness
            : ageMs <= LIVE_QUOTE_STALE_MS
              ? "live"
              : "stale",
      },
      "apiServerEmittedAt",
      emittedAt,
    ),
    source: "ibkr",
  };
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
    : String(error || "Unknown bridge quote stream error.");
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

function isMutableStreamUnsupportedError(error: unknown): boolean {
  return (
    Boolean(
      error &&
        typeof error === "object" &&
        "statusCode" in error &&
        (error as { statusCode?: unknown }).statusCode === 404,
    ) ||
    readErrorMessage(error).includes("quote stream session not found")
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

function resolveCurrentStreamSignalAt(
  previousSignalAt: Date | null,
  startedAt: Date | null,
): Date | null {
  if (!startedAt) {
    return previousSignalAt;
  }
  if (!previousSignalAt || previousSignalAt.getTime() < startedAt.getTime()) {
    return startedAt;
  }
  return previousSignalAt;
}

function isLikelyUsEquitySession(now = nowProvider()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 25 && minutes <= 16 * 60 + 5;
}

function recordQuoteEvent(receivedAt: Date): void {
  const currentEventHasActiveDemand = hasActiveStreamDemand();
  if (lastEventAt && lastEventHadActiveDemand && currentEventHasActiveDemand) {
    const gapMs = Math.max(0, receivedAt.getTime() - lastEventAt.getTime());
    maxGapMs = Math.max(maxGapMs, gapMs);
    if (gapMs >= STREAM_GAP_WARNING_MS) {
      streamGapCount += 1;
      lastGapMs = gapMs;
      lastGapAt = receivedAt;
      streamGapEvents.push({ at: receivedAt, gapMs });
      pruneRecentGapEvents(receivedAt.getTime());
    }
  }

  eventCount += 1;
  lastEventAt = receivedAt;
  lastEventHadActiveDemand = currentEventHasActiveDemand;
  recordStreamSignal({
    type: "status",
    at: receivedAt,
    status: lastStreamStatus,
  });
}

function pruneRecentGapEvents(nowMs = nowProvider().getTime()): void {
  const cutoff = nowMs - STREAM_GAP_RECENT_WINDOW_MS;
  while (
    streamGapEvents.length &&
    streamGapEvents[0]!.at.getTime() < cutoff
  ) {
    streamGapEvents.shift();
  }
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

function hasUsableQuotePrice(quote: QuoteSnapshot): boolean {
  return [quote.price, quote.bid, quote.ask].some(
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
}

function shouldPromoteQuote(
  incoming: QuoteSnapshot,
  current: QuoteSnapshot | undefined,
  receivedAt: Date,
): boolean {
  if (!hasUsableQuotePrice(incoming) && incoming.freshness !== "pending") {
    return false;
  }
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
  const normalizedSymbol = normalizeSymbol(quote.symbol);
  if (!normalizedSymbol) {
    return null;
  }
  const receivedAt = nowProvider();
  const current = quoteCacheBySymbol.get(normalizedSymbol);
  if (!shouldPromoteQuote(quote, current, receivedAt)) {
    return null;
  }
  recordQuoteEvent(receivedAt);
  lastError = null;
  lastErrorAt = null;
  reconnectAttempt = 0;
  const cached = addApiLatency(
    {
      ...quote,
      symbol: normalizedSymbol,
    },
    "apiServerReceivedAt",
    receivedAt,
  );
  quoteCacheBySymbol.set(normalizedSymbol, cached);
  return cached;
}

function notifySubscribers(quotes: QuoteSnapshot[]) {
  subscribers.forEach((subscriber) => {
    const matchedQuotes = quotes
      .filter((quote) => subscriber.symbols.has(normalizeSymbol(quote.symbol)))
      .map(toPayloadQuote);

    if (matchedQuotes.length > 0) {
      subscriber.onSnapshot({ quotes: matchedQuotes });
    }
  });
}

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function clearRefreshTimer() {
  if (!refreshTimer) {
    return;
  }

  clearTimeout(refreshTimer);
  refreshTimer = null;
}

function stopPendingStream() {
  pendingStreamUnsubscribe?.();
  pendingStreamUnsubscribe = null;
  pendingStreamMutableControl = null;
  pendingStreamSignature = "";
  pendingStreamStartedAt = null;
  pendingReadyAt = null;
}

function stopActiveStream() {
  clearStallTimer();
  streamUnsubscribe?.();
  streamUnsubscribe = null;
  streamMutableControl = null;
  streamSignature = "";
  streamStartedAt = null;
}

function stopStream() {
  clearRefreshTimer();
  stopPendingStream();
  stopActiveStream();
}

function clearInactiveStreamState() {
  lastEventHadActiveDemand = false;
  lastSignalAt = null;
  lastError = null;
  lastErrorAt = null;
  lastStallAt = null;
  lastStallReason = null;
  lastStreamStatus = null;
}

function clearStallTimer() {
  if (!stallTimer) {
    return;
  }

  clearInterval(stallTimer);
  stallTimer = null;
}

function hasActiveStreamDemand(): boolean {
  return Boolean(subscribers.size > 0 && streamUnsubscribe && streamSignature);
}

function startStallTimer(expectedSignature: string) {
  clearStallTimer();
  stallTimer = setInterval(() => {
    if (
      streamSignature !== expectedSignature ||
      !streamUnsubscribe ||
      subscribers.size === 0 ||
      !isLikelyUsEquitySession()
    ) {
      return;
    }

    const currentSignalAt = resolveCurrentStreamSignalAt(
      lastSignalAt,
      streamStartedAt,
    );
    if (!currentSignalAt) {
      return;
    }

    const now = nowProvider();
    const ageMs = Math.max(0, now.getTime() - currentSignalAt.getTime());
    if (ageMs < STREAM_STALL_RECONNECT_MS) {
      return;
    }

    staleReconnectCount += 1;
    lastStallAt = now;
    lastStallReason = `quote_stream_silent_${ageMs}ms`;
    lastError = "IBKR bridge quote stream is open but silent.";
    lastErrorAt = lastStallAt;
    logger.warn(
      { ageMs, symbols: expectedSignature },
      "IBKR bridge quote stream watchdog reconnecting silent stream",
    );
    stopStream();
    scheduleReconnect();
  }, Math.max(1_000, Math.floor(STREAM_STALL_RECONNECT_MS / 2)));
  stallTimer.unref?.();
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
    refreshBridgeQuoteStream();
  }, delayMs);
  reconnectTimer.unref?.();
}

function handleStreamError(expectedSignature: string, error: unknown) {
  const matchesActiveStream = streamSignature === expectedSignature;
  const matchesPendingStream = pendingStreamSignature === expectedSignature;
  if (!matchesActiveStream && !matchesPendingStream) {
    return;
  }

  const now = nowProvider();
  if (matchesPendingStream) {
    stopPendingStream();
  }
  if (isCapacityPressureError(error)) {
    lastStreamStatus = {
      state: capacityPressureFromError(error),
      reason: "ibkr_stream_capacity_limited",
      message: readErrorMessage(error),
    };
    lastSignalAt = now;
    lastError = null;
    lastErrorAt = null;
    if (!matchesActiveStream || streamUnsubscribe) {
      scheduleRefreshBridgeQuoteStream(RECONNECT_DELAY_MIN_MS);
      return;
    }
  }

  const marketSessionActive = isLikelyUsEquitySession(now);
  lastError = readErrorMessage(error);
  lastErrorAt = now;
  if (marketSessionActive) {
    logger.warn(
      { err: error, symbols: expectedSignature },
      "IBKR bridge quote stream failed",
    );
  } else {
    logger.info(
      { err: error, symbols: expectedSignature },
      "IBKR bridge quote stream ended during quiet market",
    );
  }
  if (matchesActiveStream) {
    stopActiveStream();
  }
  if (marketSessionActive) {
    scheduleReconnect();
  } else {
    scheduleRefreshBridgeQuoteStream(QUIET_MARKET_RETRY_MS);
  }
}

function refreshBridgeQuoteStream() {
  clearReconnectTimer();
  clearRefreshTimer();

  const symbols = getDesiredSymbols();
  const nextSignature = symbols.join(",");

  if (
    nextSignature === streamSignature ||
    nextSignature === pendingStreamSignature
  ) {
    return;
  }

  if (!nextSignature) {
    stopStream();
    reconnectAttempt = 0;
    clearInactiveStreamState();
    return;
  }

  if (streamMutableControl && streamUnsubscribe) {
    stopPendingStream();
    mutableUpdateCount += 1;
    lastMutableUpdateAt = nowProvider();
    streamSignature = nextSignature;
    lastSignalAt = lastMutableUpdateAt;
    lastStreamStatus = {
      state: "open",
      reason: "symbols_update_pending",
      requestedCount: symbols.length,
      admittedCount: symbols.length,
      rejectedCount: 0,
    };
    startStallTimer(nextSignature);
    Promise.resolve(streamMutableControl.setSymbols(symbols)).then(
      () => {
        lastError = null;
        lastErrorAt = null;
        reconnectAttempt = 0;
      },
      (error) => {
        if (isMutableStreamUnsupportedError(error)) {
          mutableQuoteStreamSupported = false;
          stopActiveStream();
          scheduleRefreshBridgeQuoteStream(0);
          return;
        }
        handleStreamError(nextSignature, error);
      },
    );
    return;
  }

  stopPendingStream();
  pendingStreamSignature = nextSignature;
  pendingStreamStartedAt = new Date();
  pendingReadyAt = null;

  const activatePendingStream = (readyAt: Date) => {
    if (pendingStreamSignature !== nextSignature) {
      return;
    }
    if (!pendingStreamUnsubscribe) {
      pendingReadyAt = readyAt;
      return;
    }
    const nextUnsubscribe = pendingStreamUnsubscribe;
    const nextMutableControl = pendingStreamMutableControl;
    stopActiveStream();
    streamSignature = nextSignature;
    streamUnsubscribe = nextUnsubscribe;
    streamMutableControl = nextMutableControl;
    streamStartedAt = readyAt;
    pendingStreamSignature = "";
    pendingStreamUnsubscribe = null;
    pendingStreamMutableControl = null;
    pendingStreamStartedAt = null;
    pendingReadyAt = null;
    lastError = null;
    lastErrorAt = null;
    reconnectAttempt = 0;
    startStallTimer(nextSignature);
  };

  try {
    const onQuotes = (quotes: QuoteSnapshot[]) => {
      if (streamSignature !== nextSignature) {
        activatePendingStream(nowProvider());
      }
      const cachedQuotes = quotes.flatMap((quote) => {
        const cached = cacheQuote(quote);
        return cached ? [cached] : [];
      });
      notifySubscribers(cachedQuotes);
    };
    const onError = (error: unknown) => handleStreamError(nextSignature, error);
    const onSignal = (signal: QuoteStreamSignal) => {
      recordStreamSignal(signal);
      const statusState = signal.status?.state;
      if (
        signal.type === "ready" ||
        (streamUnsubscribe === null &&
          (signal.type === "open" ||
            (signal.type === "status" && statusState === "open")))
      ) {
        activatePendingStream(signal.at);
      }
    };
    const nextMutableControl = mutableQuoteStreamSupported
      ? bridgeClient.streamMutableQuoteSnapshots?.(
          symbols,
          onQuotes,
          onError,
          onSignal,
        ) ?? null
      : null;
    const nextUnsubscribe = nextMutableControl
      ? () => nextMutableControl.close()
      : bridgeClient.streamQuoteSnapshots(symbols, onQuotes, onError, onSignal);
    if (!pendingStreamSignature) {
      nextUnsubscribe();
      return;
    }
    pendingStreamUnsubscribe = nextUnsubscribe;
    pendingStreamMutableControl = nextMutableControl;
    if (pendingReadyAt) {
      activatePendingStream(pendingReadyAt);
    } else if (!streamUnsubscribe) {
      activatePendingStream(pendingStreamStartedAt ?? nowProvider());
    }
  } catch (error) {
    handleStreamError(nextSignature, error);
  }
}

function scheduleRefreshBridgeQuoteStream(
  delayMs = STREAM_RECONFIGURE_DEBOUNCE_MS,
) {
  clearRefreshTimer();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshBridgeQuoteStream();
  }, Math.max(0, delayMs));
  refreshTimer.unref?.();
}

export function getCurrentBridgeQuoteSnapshots(symbols: string[]): QuoteWithSource[] {
  return normalizeSymbols(symbols).flatMap((symbol) => {
    const quote = quoteCacheBySymbol.get(symbol);
    return quote ? [toPayloadQuote(quote)] : [];
  });
}

function shouldHydrateQuoteSnapshot(quote: QuoteWithSource | undefined): boolean {
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

export async function fetchBridgeQuoteSnapshots(
  symbols: string[],
): Promise<QuoteSnapshotPayload> {
  const normalizedSymbols = normalizeSymbols(symbols);
  if (!normalizedSymbols.length) {
    return { quotes: [] };
  }
  const owner = `bridge-quote-snapshot:${nextSnapshotOwnerId++}`;
  const admission = admitMarketDataLeases({
    owner,
    intent: "visible-live",
    requests: normalizedSymbols.map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
    ttlMs: 10_000,
    fallbackProvider: "polygon",
  });
  const admittedSymbols = admission.admitted
    .map((lease) => lease.symbol)
    .filter((symbol): symbol is string => Boolean(symbol));

  if (!admittedSymbols.length) {
    releaseMarketDataLeases(owner, "snapshot_complete");
    return {
      quotes: getCurrentBridgeQuoteSnapshots(normalizedSymbols),
    };
  }

  const cachedQuotes = getCurrentBridgeQuoteSnapshots(admittedSymbols);
  const cachedQuotesBySymbol = new Map(
    cachedQuotes.map((quote) => [normalizeSymbol(quote.symbol), quote]),
  );
  const hydrateSymbols = admittedSymbols.filter((symbol) =>
    shouldHydrateQuoteSnapshot(cachedQuotesBySymbol.get(symbol)),
  );

  try {
    if (hydrateSymbols.length > 0) {
      const freshQuotes = await bridgeClient.getQuoteSnapshots(hydrateSymbols);
      freshQuotes.forEach(cacheQuote);
    }
  } finally {
    releaseMarketDataLeases(owner, "snapshot_complete");
  }

  return {
    quotes: getCurrentBridgeQuoteSnapshots(admittedSymbols),
  };
}

export function subscribeBridgeQuoteSnapshots(
  symbols: string[],
  onSnapshot: (payload: QuoteSnapshotPayload) => void,
): () => void {
  const normalizedSymbols = normalizeSymbols(symbols);
  if (!normalizedSymbols.length) {
    return () => {};
  }

  const subscriberId = nextSubscriberId;
  nextSubscriberId += 1;
  const owner = `bridge-quote-stream:${subscriberId}`;
  const admission = admitMarketDataLeases({
    owner,
    intent: "visible-live",
    requests: normalizedSymbols.map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
    fallbackProvider: "polygon",
  });
  const admittedSymbols = admission.admitted
    .map((lease) => lease.symbol)
    .filter((symbol): symbol is string => Boolean(symbol));
  if (!admittedSymbols.length) {
    return () => {
      releaseMarketDataLeases(owner, "unsubscribe");
    };
  }
  subscribers.set(subscriberId, {
    id: subscriberId,
    owner,
    symbols: new Set(admittedSymbols),
    onSnapshot,
  });

  const cachedQuotes = getCurrentBridgeQuoteSnapshots(admittedSymbols);
  if (cachedQuotes.length > 0) {
    onSnapshot({ quotes: cachedQuotes });
  }

  scheduleRefreshBridgeQuoteStream();

  return () => {
    subscribers.delete(subscriberId);
    releaseMarketDataLeases(owner, "unsubscribe");
    scheduleRefreshBridgeQuoteStream();
  };
}

export function getBridgeQuoteStreamDiagnostics(): BridgeQuoteStreamDiagnostics {
  const desiredSymbols = getDesiredSymbols();
  const hasQuoteDemand = desiredSymbols.length > 0;
  const now = nowProvider().getTime();
  pruneRecentGapEvents(now);
  const lastEventMs = lastEventAt?.getTime() ?? null;
  const lastEventAgeMs =
    lastEventMs === null ? null : Math.max(0, now - lastEventMs);
  const lastGapAgeMs = lastGapAt ? Math.max(0, now - lastGapAt.getTime()) : null;
  const lastMutableUpdateAgeMs = lastMutableUpdateAt
    ? Math.max(0, now - lastMutableUpdateAt.getTime())
    : null;
  const recentMaxGapMs =
    streamGapEvents.length > 0
      ? Math.max(...streamGapEvents.map((event) => event.gapMs))
      : null;
  const currentStreamSignalMs = resolveCurrentStreamSignalAt(
    lastSignalAt,
    streamStartedAt,
  )?.getTime() ?? null;
  const currentStreamSignalAgeMs =
    currentStreamSignalMs === null
      ? null
      : Math.max(0, now - currentStreamSignalMs);
  const capacityPressure = isCapacityPressureState(lastStreamStatus?.state)
    ? lastStreamStatus.state
    : null;
  const streamActive = Boolean(
    hasQuoteDemand && streamUnsubscribe && streamSignature,
  );
  const transportFreshnessAgeMs = streamActive ? currentStreamSignalAgeMs : null;
  const dataMaxGapMs = eventCount > 1 ? maxGapMs : null;

  return {
    activeConsumerCount: subscribers.size,
    unionSymbolCount: desiredSymbols.length,
    cachedQuoteCount: quoteCacheBySymbol.size,
    eventCount,
    reconnectCount,
    streamGapCount,
    dataGapCount: streamGapCount,
    recentGapCount: streamGapEvents.length,
    recentDataGapCount: streamGapEvents.length,
    maxGapMs: dataMaxGapMs,
    maxDataGapMs: dataMaxGapMs,
    recentMaxGapMs,
    recentMaxDataGapMs: recentMaxGapMs,
    lastGapMs,
    lastDataGapMs: lastGapMs,
    lastGapAt: lastGapAt?.toISOString() ?? null,
    lastDataGapAt: lastGapAt?.toISOString() ?? null,
    lastGapAgeMs,
    lastDataGapAgeMs: lastGapAgeMs,
    lastEventAt: lastEventAt?.toISOString() ?? null,
    lastEventAgeMs,
    lastSignalAt: lastSignalAt?.toISOString() ?? null,
    lastSignalAgeMs: currentStreamSignalAgeMs,
    freshnessAgeMs: transportFreshnessAgeMs ?? lastEventAgeMs,
    dataFreshnessAgeMs: lastEventAgeMs,
    transportFreshnessAgeMs,
    streamActive,
    streamSignature,
    pendingStreamSignature,
    mutableStreamActive: Boolean(streamMutableControl),
    mutableStreamSupported: mutableQuoteStreamSupported,
    mutableUpdateCount,
    lastMutableUpdateAt: lastMutableUpdateAt?.toISOString() ?? null,
    lastMutableUpdateAgeMs,
    reconnectScheduled: Boolean(reconnectTimer),
    desiredSymbols: desiredSymbols.slice(0, 50),
    lastError: hasQuoteDemand ? lastError : null,
    lastErrorAt: hasQuoteDemand ? (lastErrorAt?.toISOString() ?? null) : null,
    staleReconnectCount,
    lastStallAt: hasQuoteDemand ? (lastStallAt?.toISOString() ?? null) : null,
    lastStallReason: hasQuoteDemand ? lastStallReason : null,
    lastStreamStatus: hasQuoteDemand ? lastStreamStatus : null,
    pressure: !hasQuoteDemand
      ? "normal"
      : capacityPressure
        ? capacityPressure
      : reconnectTimer
      ? "reconnecting"
      : currentStreamSignalAgeMs !== null &&
          currentStreamSignalAgeMs >= STREAM_STALL_RECONNECT_MS
        ? "stale"
        : "normal",
  };
}

export function __setBridgeQuoteClientForTests(
  client: BridgeQuoteClient | null,
): void {
  bridgeClient = client ?? new IbkrBridgeClient();
}

export function __setBridgeQuoteStreamNowForTests(now: Date | null): void {
  nowProvider = now ? () => new Date(now) : () => new Date();
}

export function __cacheBridgeQuoteForTests(
  quote: QuoteSnapshot,
): QuoteSnapshot | null {
  return cacheQuote(quote);
}

export function __resolveCurrentBridgeQuoteStreamSignalAtForTests(
  previousEventAt: Date | null,
  startedAt: Date | null,
): Date | null {
  return resolveCurrentStreamSignalAt(previousEventAt, startedAt);
}

export function __resetBridgeQuoteStreamForTests(): void {
  stopStream();
  clearReconnectTimer();
  clearRefreshTimer();
  clearStallTimer();
  Array.from(subscribers.values()).forEach((subscriber) => {
    releaseMarketDataLeases(subscriber.owner, "test_reset");
  });
  subscribers.clear();
  quoteCacheBySymbol.clear();
  nextSubscriberId = 1;
  nextSnapshotOwnerId = 1;
  eventCount = 0;
  reconnectCount = 0;
  staleReconnectCount = 0;
  mutableQuoteStreamSupported = true;
  mutableUpdateCount = 0;
  lastMutableUpdateAt = null;
  streamGapCount = 0;
  maxGapMs = 0;
  lastGapMs = null;
  lastGapAt = null;
  streamGapEvents.length = 0;
  lastEventAt = null;
  lastEventHadActiveDemand = false;
  lastSignalAt = null;
  streamStartedAt = null;
  lastError = null;
  lastErrorAt = null;
  lastStallAt = null;
  lastStallReason = null;
  lastStreamStatus = null;
  nowProvider = () => new Date();
}
