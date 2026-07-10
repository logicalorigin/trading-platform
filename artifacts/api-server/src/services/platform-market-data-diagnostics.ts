import { getMassiveOptionQuoteStreamDiagnostics } from "./massive-option-quote-stream";
import {
  getMassiveProviderIdentity,
  getMassiveRuntimeConfig,
  isMassiveStocksRealtimeConfigured,
} from "../lib/runtime";
import { getMassiveApiDiagnostics } from "../providers/massive/market-data";
import { getMassiveStockQuoteStreamDiagnostics } from "./massive-stock-quote-stream";
import { getMarketDataAdmissionDiagnostics } from "./market-data-admission";
import { getSignalMonitorLocalBarCacheDiagnostics } from "./signal-monitor-local-bar-cache";
import { getSignalMonitorIncrementalEvalStats } from "./signal-monitor";
import { getStockAggregateStreamDiagnostics } from "./stock-aggregate-stream";

export function getRuntimeMarketDataDiagnostics() {
  return {
    massiveStockQuotes: getMassiveStockQuoteStreamDiagnostics(),
    signalMonitorLocalBars: getSignalMonitorLocalBarCacheDiagnostics(),
    signalMonitorIncrementalEval: getSignalMonitorIncrementalEvalStats(),
    optionQuotes: getMassiveOptionQuoteStreamDiagnostics(),
    stockAggregates: getStockAggregateStreamDiagnostics(),
    marketDataAdmission: getMarketDataAdmissionDiagnostics(),
  };
}

function toFiniteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function buildMassiveWebSocketDiagnostics(input: {
  config: ReturnType<typeof getMassiveRuntimeConfig>;
  streams: Pick<
    ReturnType<typeof getRuntimeMarketDataDiagnostics>,
    "massiveStockQuotes" | "stockAggregates"
  >;
}) {
  const providerIdentity = getMassiveProviderIdentity(input.config);
  const configured = providerIdentity === "massive";
  const quote = input.streams.massiveStockQuotes;
  const stockAggregates = input.streams.stockAggregates;
  const aggregate = stockAggregates.massiveDelayedWebSocket;
  const aggregateIsMassive =
    aggregate.providerIdentity === "massive" ||
    stockAggregates.provider === "massive-websocket" ||
    stockAggregates.activeProvider === "massive-websocket";
  const aggregateStreamConfigured = Boolean(
    aggregate.configured ||
      stockAggregates.provider === "massive-websocket" ||
      stockAggregates.activeProvider === "massive-websocket" ||
      stockAggregates.provider === "massive-delayed-websocket" ||
      stockAggregates.activeProvider === "massive-delayed-websocket",
  );
  const aggregateStreamEventCount =
    toFiniteNumber(stockAggregates.eventCount) ??
    (aggregateIsMassive ? (toFiniteNumber(aggregate.eventCount) ?? 0) : 0);
  const aggregateStreamLastMessageAgeMs =
    toFiniteNumber(stockAggregates.lastAggregateAgeMs) ??
    (aggregateIsMassive ? toFiniteNumber(aggregate.lastMessageAgeMs) : null);
  const aggregateStreamLastMessageAt =
    stockAggregates.lastAggregateAt ??
    (aggregateIsMassive ? (aggregate.lastMessageAt ?? null) : null);
  const feeds = [
    {
      id: "stock-quotes",
      label: "Stock quotes/trades",
      configured: Boolean(quote.configured),
      mode: quote.mode ?? "real-time",
      socketHost: quote.socketHost ?? "socket.massive.com",
      availableChannels: asStringArray(quote.availableChannels),
      subscribedChannels: asStringArray(quote.subscribedChannels),
      subscribedSymbolCount: toFiniteNumber(quote.subscribedSymbolCount) ?? 0,
      subscriptionCount: toFiniteNumber(quote.subscriptionCount) ?? 0,
      activeConsumerCount: toFiniteNumber(quote.activeConsumerCount) ?? 0,
      connected: Boolean(quote.connected),
      authState: quote.authState ?? "idle",
      eventCount: toFiniteNumber(quote.eventCount) ?? 0,
      lastMessageAgeMs: toFiniteNumber(quote.lastMessageAgeMs),
      lastMessageAt: quote.lastMessageAt ?? null,
      lastSocketMessageAgeMs: toFiniteNumber(quote.lastSocketMessageAgeMs),
      lastSocketMessageAt: quote.lastSocketMessageAt ?? null,
      reconnectCount: toFiniteNumber(quote.reconnectCount) ?? 0,
      lastProviderStatus: quote.lastProviderStatus ?? null,
      lastProviderMessage: quote.lastProviderMessage ?? null,
      lastProviderStatusAt: quote.lastProviderStatusAt ?? null,
      lastCloseCode: toFiniteNumber(quote.lastCloseCode),
      lastCloseReason: quote.lastCloseReason ?? null,
      lastCloseAt: quote.lastCloseAt ?? null,
      lastError: quote.lastError ?? null,
      lastErrorAt: quote.lastErrorAt ?? null,
    },
    {
      id: "stock-aggregates",
      label: "Stock minute aggregates",
      configured: aggregateStreamConfigured,
      mode: aggregate.mode ?? (configured ? "delayed" : null),
      streamProvider: stockAggregates.activeProvider ?? stockAggregates.provider,
      socketHost: aggregateIsMassive ? aggregate.socketHost : null,
      availableChannels: aggregateIsMassive
        ? asStringArray(aggregate.availableChannels)
        : [],
      subscribedChannels: aggregateIsMassive
        ? asStringArray(aggregate.subscribedChannels)
        : [],
      subscribedSymbolCount: aggregateIsMassive
        ? (toFiniteNumber(stockAggregates.unionSymbolCount) ??
          toFiniteNumber(aggregate.subscribedSymbolCount) ??
          0)
        : 0,
      subscriptionCount: aggregateIsMassive
        ? (toFiniteNumber(aggregate.subscriptionCount) ?? 0)
        : 0,
      activeConsumerCount: aggregateIsMassive
        ? (toFiniteNumber(stockAggregates.activeConsumerCount) ??
          toFiniteNumber(aggregate.activeConsumerCount) ??
          0)
        : 0,
      connected: Boolean(aggregateIsMassive && aggregate.connected),
      authState: aggregate.authState ?? "idle",
      eventCount: aggregateStreamEventCount,
      lastMessageAgeMs: aggregateStreamLastMessageAgeMs,
      lastMessageAt: aggregateStreamLastMessageAt,
      rawWebSocketEventCount: aggregateIsMassive
        ? (toFiniteNumber(aggregate.eventCount) ?? 0)
        : 0,
      rawWebSocketLastMessageAgeMs: aggregateIsMassive
        ? toFiniteNumber(aggregate.lastMessageAgeMs)
        : null,
      rawWebSocketLastMessageAt: aggregateIsMassive
        ? (aggregate.lastMessageAt ?? null)
        : null,
      lastSocketMessageAgeMs: aggregateIsMassive
        ? toFiniteNumber(aggregate.lastSocketMessageAgeMs)
        : null,
      lastSocketMessageAt: aggregateIsMassive
        ? (aggregate.lastSocketMessageAt ?? null)
        : null,
      reconnectCount: aggregateIsMassive
        ? (toFiniteNumber(aggregate.reconnectCount) ?? 0)
        : 0,
      lastProviderStatus: aggregateIsMassive
        ? (aggregate.lastProviderStatus ?? null)
        : null,
      lastProviderMessage: aggregateIsMassive
        ? (aggregate.lastProviderMessage ?? null)
        : null,
      lastProviderStatusAt: aggregateIsMassive
        ? (aggregate.lastProviderStatusAt ?? null)
        : null,
      lastCloseCode: aggregateIsMassive
        ? toFiniteNumber(aggregate.lastCloseCode)
        : null,
      lastCloseReason: aggregateIsMassive
        ? (aggregate.lastCloseReason ?? null)
        : null,
      lastCloseAt: aggregateIsMassive ? (aggregate.lastCloseAt ?? null) : null,
      lastError: aggregateIsMassive ? (aggregate.lastError ?? null) : null,
      lastErrorAt: aggregateIsMassive ? (aggregate.lastErrorAt ?? null) : null,
    },
  ];
  const activeFeeds = feeds.filter(
    (feed) =>
      feed.configured &&
      (feed.connected ||
        feed.subscribedSymbolCount > 0 ||
        feed.activeConsumerCount > 0),
  );
  const lastErrorFeed = feeds.find((feed) => feed.configured && feed.lastError);
  const lastMessageAges = feeds
    .map((feed) => feed.lastMessageAgeMs)
    .filter((value): value is number => Number.isFinite(value));
  const lastMessageTimes = feeds
    .map((feed) =>
      feed.lastMessageAt ? Date.parse(String(feed.lastMessageAt)) : Number.NaN,
    )
    .filter(Number.isFinite);
  const lastSocketMessageAges = feeds
    .map((feed) => feed.lastSocketMessageAgeMs)
    .filter((value): value is number => Number.isFinite(value));
  const lastSocketMessageTimes = feeds
    .map((feed) =>
      feed.lastSocketMessageAt
        ? Date.parse(String(feed.lastSocketMessageAt))
        : Number.NaN,
    )
    .filter(Number.isFinite);
  const lastProviderStatusFeed = feeds.find(
    (feed) => feed.configured && feed.lastProviderStatus,
  );
  const lastCloseFeed = feeds.find(
    (feed) => feed.configured && feed.lastCloseCode !== null,
  );

  return {
    status: !configured
      ? "unconfigured"
      : lastErrorFeed
        ? "degraded"
        : activeFeeds.length
          ? "ok"
          : "idle",
    configured,
    providerIdentity,
    mode:
      activeFeeds.find((feed) => feed.mode)?.mode ??
      (configured
        ? isMassiveStocksRealtimeConfigured(input.config)
          ? "real-time"
          : "delayed"
        : null),
    activeChannels: uniqueStrings(
      activeFeeds.flatMap((feed) => feed.subscribedChannels),
    ),
    availableChannels: uniqueStrings(
      feeds
        .filter((feed) => feed.configured)
        .flatMap((feed) => feed.availableChannels),
    ),
    subscribedSymbolCount: Math.max(
      0,
      ...feeds.map((feed) => feed.subscribedSymbolCount),
    ),
    activeConsumerCount: feeds.reduce(
      (total, feed) => total + feed.activeConsumerCount,
      0,
    ),
    eventCount: feeds.reduce((total, feed) => total + feed.eventCount, 0),
    lastMessageAgeMs: lastMessageAges.length
      ? Math.min(...lastMessageAges)
      : null,
    lastMessageAt: lastMessageTimes.length
      ? new Date(Math.max(...lastMessageTimes)).toISOString()
      : null,
    lastSocketMessageAgeMs: lastSocketMessageAges.length
      ? Math.min(...lastSocketMessageAges)
      : null,
    lastSocketMessageAt: lastSocketMessageTimes.length
      ? new Date(Math.max(...lastSocketMessageTimes)).toISOString()
      : null,
    reconnectCount: Math.max(0, ...feeds.map((feed) => feed.reconnectCount)),
    lastProviderStatus: lastProviderStatusFeed?.lastProviderStatus ?? null,
    lastProviderMessage: lastProviderStatusFeed?.lastProviderMessage ?? null,
    lastProviderStatusAt: lastProviderStatusFeed?.lastProviderStatusAt ?? null,
    lastCloseCode: lastCloseFeed?.lastCloseCode ?? null,
    lastCloseReason: lastCloseFeed?.lastCloseReason ?? null,
    lastCloseAt: lastCloseFeed?.lastCloseAt ?? null,
    lastError: lastErrorFeed?.lastError ?? null,
    lastErrorAt: lastErrorFeed?.lastErrorAt ?? null,
    feeds,
  };
}

export function getRuntimeMassiveProviderDiagnostics(input: {
  streams: Pick<
    ReturnType<typeof getRuntimeMarketDataDiagnostics>,
    "massiveStockQuotes" | "signalMonitorLocalBars" | "stockAggregates"
  >;
  config?: ReturnType<typeof getMassiveRuntimeConfig>;
}) {
  const config = input.config ?? getMassiveRuntimeConfig();
  return {
    ...getMassiveApiDiagnostics(config),
    localBarCache: input.streams.signalMonitorLocalBars,
    websocket: buildMassiveWebSocketDiagnostics({
      config,
      streams: input.streams,
    }),
  };
}
