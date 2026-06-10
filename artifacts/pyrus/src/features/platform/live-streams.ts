import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAccountAllocationQueryKey,
  getGetAccountCashActivityQueryKey,
  getGetAccountClosedTradesQueryKey,
  getGetAccountEquityHistoryQueryKey,
  getGetAccountOrdersQueryKey,
  getGetAccountPositionsQueryKey,
  getGetAccountRiskQueryKey,
  getGetAccountSummaryQueryKey,
  getGetFlexHealthQueryKey,
  getListAlgoDeploymentsQueryKey,
  getListExecutionEventsQueryKey,
  getGetAlgoDeploymentCockpitQueryKey,
  getGetSignalMonitorProfileQueryKey,
  getGetSignalOptionsAutomationStateQueryKey,
  getGetSignalOptionsPerformanceQueryKey,
  getOptionQuoteSnapshots,
} from "@workspace/api-client-react";
import { calculateTransferAdjustedReturnSeries } from "@workspace/account-math";
import {
  recordOptionHydrationMetric,
  setOptionHydrationDiagnostics,
} from "./optionHydrationDiagnostics";
import type {
  AccountAllocationResponse,
  AccountCashActivityResponse,
  AccountClosedTradesResponse,
  AccountOrdersResponse,
  AccountPositionsResponse,
  AccountRiskResponse,
  AccountSummaryResponse,
  AccountEquityHistoryResponse,
  AccountEquityPoint,
  AccountsResponse,
  AlgoCockpitSnapshotResponse,
  AlgoDeploymentsResponse,
  BrokerAccount,
  ExecutionEventsResponse,
  FlexHealthResponse,
  GetAccountClosedTradesParams,
  OptionChainResponse,
  OrdersResponse,
  PositionsResponse,
  QuoteSnapshot,
  QuoteSnapshotsResponse,
  SignalMonitorProfile,
  SignalOptionsAutomationState,
  SignalOptionsPerformanceResponse,
} from "@workspace/api-client-react";

import { freshnessUnchanged, isStreamFresh } from "./streamFreshness";

type StreamMode = "paper" | "live";

type AccountTradeFilters = {
  from: string | null;
  to: string | null;
  symbol: string | null;
  assetClass: string | null;
  pnlSign: GetAccountClosedTradesParams["pnlSign"] | null;
  holdDuration: string | null;
};

type AccountTradeFilterInput = Partial<AccountTradeFilters>;

type QuoteStreamPayload = {
  quotes: QuoteSnapshot[];
};

const QUOTE_STREAM_CACHE_FLUSH_MS = 100;

const scheduleRealtimeFlush = (callback: () => void): ReturnType<typeof setTimeout> | null => {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return null;
  }
  return setTimeout(callback, 0);
};

type AccountStreamPayload = {
  accounts: AccountsResponse["accounts"];
  positions: PositionsResponse["positions"];
};

type LiveAccountEquityHistoryResponse = AccountEquityHistoryResponse & {
  asOf?: string | null;
  latestSnapshotAt?: string | null;
  isStale?: boolean;
  staleReason?: string | null;
  terminalPointSource?: AccountEquityHistoryResponse["terminalPointSource"];
  liveTerminalIncluded?: boolean;
};

type ShadowAccountStreamPayload = {
  summary: AccountSummaryResponse;
  positions: AccountPositionsResponse;
  workingOrders: AccountOrdersResponse;
  historyOrders: AccountOrdersResponse;
  allocation: AccountAllocationResponse;
  risk: AccountRiskResponse;
  updatedAt: string;
};

type AccountPageBootstrapPayload = {
  stream?: "account-page-bootstrap";
  accountId: string;
  mode: StreamMode;
  range?: AccountHistoryRangeValue;
  orderTab: "working" | "history";
  assetClass: string | null;
  tradeFilters: AccountTradeFilters;
  performanceCalendarFrom: string | null;
  updatedAt: string;
  summary: AccountSummaryResponse;
  equityHistory: AccountEquityHistoryResponse;
  intradayEquity: AccountEquityHistoryResponse;
  benchmarkEquityHistory: Partial<Record<"SPY" | "QQQ" | "DIA", AccountEquityHistoryResponse>>;
  performanceCalendarEquity: AccountEquityHistoryResponse;
  performanceCalendarTrades: AccountClosedTradesResponse;
  allocation: AccountAllocationResponse;
  positions: AccountPositionsResponse;
  closedTrades: AccountClosedTradesResponse;
  orders: AccountOrdersResponse;
  risk: AccountRiskResponse;
  cashActivity: AccountCashActivityResponse;
  flexHealth: FlexHealthResponse | null;
};

type AccountPageLivePayload = {
  stream?: "account-page-live";
  accountId: string;
  mode: StreamMode;
  orderTab: "working" | "history";
  assetClass: string | null;
  updatedAt: string;
  summary: AccountSummaryResponse;
  intradayEquity: AccountEquityHistoryResponse;
  allocation: AccountAllocationResponse;
  positions: AccountPositionsResponse;
  orders: AccountOrdersResponse;
  risk: AccountRiskResponse;
};

type AccountPagePrimaryPayload = {
  stream?: "account-page-primary";
  accountId: string;
  mode: StreamMode;
  orderTab: "working" | "history";
  assetClass: string | null;
  updatedAt: string;
  summary: AccountSummaryResponse;
  allocation: AccountAllocationResponse;
  positions: AccountPositionsResponse;
  orders: AccountOrdersResponse;
  risk: AccountRiskResponse;
};

type AccountPageDerivedPayload = {
  stream?: "account-page-derived";
  accountId: string;
  mode: StreamMode;
  range?: AccountHistoryRangeValue;
  tradeFilters: AccountPageBootstrapPayload["tradeFilters"];
  performanceCalendarFrom: string | null;
  updatedAt: string;
  equityHistory: AccountEquityHistoryResponse;
  benchmarkEquityHistory: Partial<Record<"SPY" | "QQQ" | "DIA", AccountEquityHistoryResponse>>;
  performanceCalendarEquity: AccountEquityHistoryResponse;
  performanceCalendarTrades: AccountClosedTradesResponse;
  closedTrades: AccountClosedTradesResponse;
  cashActivity: AccountCashActivityResponse;
  flexHealth: FlexHealthResponse | null;
};

type AlgoCockpitStreamPayload = {
  stream?: "algo-cockpit-bootstrap" | "algo-cockpit-live";
  phase?: "primary" | "full";
  mode: StreamMode;
  deploymentId: string | null;
  updatedAt: string;
  deployments: AlgoDeploymentsResponse;
  focusedDeployment: AlgoDeploymentsResponse["deployments"][number] | null;
  events: ExecutionEventsResponse;
  signalOptionsState: SignalOptionsAutomationState | null;
  cockpit: AlgoCockpitSnapshotResponse | null;
  performance: SignalOptionsPerformanceResponse | null;
  signalMonitorProfile: SignalMonitorProfile | null;
};

type AlgoDeploymentsResponseWithCacheStatus = AlgoDeploymentsResponse & {
  cacheStatus?: "hit" | "stale" | "unavailable" | string;
};

const hasAlgoDeployments = (
  value: AlgoDeploymentsResponse | undefined,
): value is AlgoDeploymentsResponse =>
  Boolean(value && Array.isArray(value.deployments) && value.deployments.length);

const isUnavailableEmptyAlgoDeploymentsResponse = (
  value: AlgoDeploymentsResponse | undefined,
) => {
  const cacheStatus = (value as AlgoDeploymentsResponseWithCacheStatus | undefined)
    ?.cacheStatus;
  return (
    cacheStatus === "unavailable" &&
    (!Array.isArray(value?.deployments) || value.deployments.length === 0)
  );
};

export const resolveAlgoDeploymentsStreamCacheUpdate = (
  current: AlgoDeploymentsResponse | undefined,
  incoming: AlgoDeploymentsResponse,
) => {
  if (
    hasAlgoDeployments(current) &&
    isUnavailableEmptyAlgoDeploymentsResponse(incoming)
  ) {
    return current;
  }
  return incoming;
};

type OrderStreamPayload = {
  orders: OrdersResponse["orders"];
};

type OptionChainStreamPayload = {
  underlyings: Array<{
    underlying: string;
    contracts: OptionChainResponse["contracts"];
    updatedAt: string;
  }>;
};

type LiveOptionQuoteSnapshot = QuoteSnapshot & {
  openInterest?: number | null;
  impliedVolatility?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  underlyingPrice?: number | null;
  status?: string | null;
  reason?: string | null;
  quoteStatus?: string | null;
  quoteReason?: string | null;
  greeksStatus?: string | null;
  greeksReason?: string | null;
  demandStatus?: string | null;
  demandReason?: string | null;
  quoteFreshness?: string | null;
  greeksFreshness?: string | null;
  unavailableDetail?: string | null;
  cacheAgeMs?: number | null;
};

type AccountOptionQuotePatch = Partial<LiveOptionQuoteSnapshot> &
  Record<string, unknown>;

type AccountPositionRowWithOptionQuote =
  AccountPositionsResponse["positions"][number] & {
    optionQuote?: AccountOptionQuotePatch | null;
  };

type LiveOptionQuotePatchSnapshot = LiveOptionQuoteSnapshot &
  AccountOptionQuotePatch & {
    mid?: number | null;
    mark?: number | null;
    last?: number | null;
    spread?: number | null;
    spreadPercent?: number | null;
  };

const hasUsableOptionQuoteData = (quote: LiveOptionQuoteSnapshot): boolean =>
  (isFiniteNumber(quote.bid) && quote.bid > 0) ||
  (isFiniteNumber(quote.ask) && quote.ask > 0) ||
  (isFiniteNumber(quote.price) && quote.price > 0) ||
  (isFiniteNumber(quote.volume) && quote.volume > 0) ||
  (isFiniteNumber(quote.openInterest) && quote.openInterest > 0) ||
  (isFiniteNumber(quote.underlyingPrice) && quote.underlyingPrice > 0) ||
  isFiniteNumber(quote.impliedVolatility) ||
  isFiniteNumber(quote.delta) ||
  isFiniteNumber(quote.gamma) ||
  isFiniteNumber(quote.theta) ||
  isFiniteNumber(quote.vega);

type OptionQuoteStreamPayload = {
  underlying?: string | null;
  quotes: LiveOptionQuoteSnapshot[];
};

type OptionQuoteWebSocketPayload = OptionQuoteStreamPayload & {
  type?: string;
  error?: string;
  requestedCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  returnedCount?: number;
  bufferedAmount?: number;
  degraded?: boolean;
  providerMode?: string | null;
  liveMarketDataAvailable?: boolean | null;
  missingProviderContractIds?: string[];
};

type OptionQuoteStreamIntent =
  | "execution-live"
  | "account-monitor-live"
  | "visible-live"
  | "automation-live"
  | "flow-scanner-live"
  | "delayed-ok"
  | "historical";

const optionQuoteSnapshotsByProviderContractId = new Map<
  string,
  LiveOptionQuoteSnapshot
>();
const optionQuoteStoreListeners = new Set<() => void>();
const optionQuoteStoreListenersByProviderContractId = new Map<
  string,
  Set<() => void>
>();
const optionQuoteStoreVersions = new Map<string, number>();
const pendingOptionQuoteNotifications = new Set<string>();
let optionQuoteNotifyScheduled = false;
let optionQuoteLastFlushAtMs = 0;
// Hard limit on the in-memory option-quote snapshot cache. An option chain for a
// single underlying can have ~100 contracts; a limit of 1024 fits ~10 underlyings'
// worth of chains while protecting against unbounded growth as users browse.
const MAX_OPTION_QUOTE_SNAPSHOTS = 1_024;
const OPTION_QUOTE_REST_FALLBACK_BATCH_SIZE = 100;
const OPTION_QUOTE_WEBSOCKET_ENABLED = true;
export const OPTION_QUOTE_WEBSOCKET_STALL_MS = 45_000;
const OPTION_QUOTE_WEBSOCKET_RECONNECT_MS = 1_000;
const OPTION_QUOTE_SHARED_CLIENT_SOCKET_ENABLED = true;
const ACCOUNT_STREAM_FRESH_MS = 7_000;
const SHADOW_ACCOUNT_STREAM_FRESH_MS = 7_000;
const ACCOUNT_PAGE_STREAM_FRESH_MS = 3_000;
const ACCOUNT_PAGE_DERIVED_STREAM_FRESH_MS = 35_000;
const ALGO_COCKPIT_STREAM_FRESH_MS = 7_000;
const ORDER_INVALIDATION_THROTTLE_MS = 2_000;
const ACCOUNT_DERIVED_INVALIDATION_THROTTLE_MS = 10_000;

type SharedOptionQuoteStreamSubscriber = {
  id: number;
  underlying: string | null;
  providerContractIds: string[];
  owner: string | null;
  intent: OptionQuoteStreamIntent;
  requiresGreeks: boolean;
  onQuotes: (quotes: LiveOptionQuoteSnapshot[]) => void;
};

type SharedOptionQuoteStreamDemand = {
  underlying: string | null;
  providerContractIds: string[];
  owner: string;
  intent: OptionQuoteStreamIntent;
  requiresGreeks: boolean;
};

const OPTION_QUOTE_INTENT_PRIORITY: Record<OptionQuoteStreamIntent, number> = {
  historical: 0,
  "delayed-ok": 1,
  "visible-live": 2,
  "account-monitor-live": 3,
  "automation-live": 4,
  "flow-scanner-live": 5,
  "execution-live": 6,
};

let sharedOptionQuoteSubscriberId = 1;
const sharedOptionQuoteSubscribers = new Map<
  number,
  SharedOptionQuoteStreamSubscriber
>();
let sharedOptionQuoteSocket: WebSocket | null = null;
let sharedOptionQuoteSocketGeneration = 0;
let sharedOptionQuoteReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let sharedOptionQuoteRestFallbackTimer: ReturnType<typeof setInterval> | null = null;
let sharedOptionQuoteStallTimer: ReturnType<typeof setInterval> | null = null;
let sharedOptionQuoteFlushTimer: ReturnType<typeof setTimeout> | null = null;
let sharedOptionQuoteFlushScheduled = false;
let sharedOptionQuoteRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let sharedOptionQuoteActiveSignature = "";
let sharedOptionQuoteFallbackCursor = 0;
let sharedOptionQuoteFirstQuoteStartedAt = Date.now();
let sharedOptionQuoteFirstQuoteRecorded = false;
let sharedOptionQuoteLastWebSocketMessageAt = Date.now();
const sharedQueuedOptionQuotesByProviderContractId = new Map<
  string,
  LiveOptionQuoteSnapshot
>();

const normalizeSharedProviderContractIds = (
  providerContractIds: string[] = [],
): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  providerContractIds.forEach((providerContractId) => {
    const text = String(providerContractId || "").trim();
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    normalized.push(text);
  });
  return normalized;
};

export const resolveSharedOptionQuoteStreamDemand = (
  subscribers: Iterable<
    Pick<
      SharedOptionQuoteStreamSubscriber,
      "underlying" | "providerContractIds" | "intent" | "requiresGreeks"
    >
  >,
): SharedOptionQuoteStreamDemand | null => {
  const providerContractIds: string[] = [];
  const seenProviderContractIds = new Set<string>();
  const underlyings = new Set<string>();
  let intent: OptionQuoteStreamIntent = "visible-live";
  let requiresGreeks = false;

  Array.from(subscribers).forEach((subscriber) => {
    const normalizedUnderlying = String(subscriber.underlying || "")
      .trim()
      .toUpperCase();
    if (normalizedUnderlying) {
      underlyings.add(normalizedUnderlying);
    }
    normalizeSharedProviderContractIds(subscriber.providerContractIds).forEach(
      (providerContractId) => {
        if (seenProviderContractIds.has(providerContractId)) {
          return;
        }
        seenProviderContractIds.add(providerContractId);
        providerContractIds.push(providerContractId);
      },
    );
    if (
      OPTION_QUOTE_INTENT_PRIORITY[subscriber.intent] >
      OPTION_QUOTE_INTENT_PRIORITY[intent]
    ) {
      intent = subscriber.intent;
    }
    if (subscriber.requiresGreeks) {
      requiresGreeks = true;
    }
  });

  if (!providerContractIds.length) {
    return null;
  }

  const underlyingList = Array.from(underlyings).sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    underlying: underlyingList.length === 1 ? underlyingList[0] : null,
    providerContractIds,
    owner: `shared-option-quotes:${providerContractIds.length}-contracts`,
    intent,
    requiresGreeks,
  };
};

const sharedOptionQuoteDemandSignature = (
  demand: SharedOptionQuoteStreamDemand | null,
): string =>
  demand
    ? JSON.stringify({
        underlying: demand.underlying,
        providerContractIds: demand.providerContractIds,
        intent: demand.intent,
        requiresGreeks: demand.requiresGreeks,
      })
    : "";

const stopSharedOptionQuoteRestFallback = () => {
  if (sharedOptionQuoteRestFallbackTimer) {
    clearInterval(sharedOptionQuoteRestFallbackTimer);
    sharedOptionQuoteRestFallbackTimer = null;
  }
};

const stopSharedOptionQuoteStallWatchdog = () => {
  if (sharedOptionQuoteStallTimer) {
    clearInterval(sharedOptionQuoteStallTimer);
    sharedOptionQuoteStallTimer = null;
  }
};

const clearSharedOptionQuoteReconnectTimer = () => {
  if (sharedOptionQuoteReconnectTimer) {
    clearTimeout(sharedOptionQuoteReconnectTimer);
    sharedOptionQuoteReconnectTimer = null;
  }
};

const flushSharedQueuedOptionQuotes = () => {
  sharedOptionQuoteFlushScheduled = false;
  sharedOptionQuoteFlushTimer = null;
  if (!sharedQueuedOptionQuotesByProviderContractId.size) {
    return;
  }
  if (!sharedOptionQuoteFirstQuoteRecorded) {
    sharedOptionQuoteFirstQuoteRecorded = true;
    recordOptionHydrationMetric(
      "firstQuoteMs",
      Math.max(0, Date.now() - sharedOptionQuoteFirstQuoteStartedAt),
    );
  }
  const cachedQuotes = Array.from(
    sharedQueuedOptionQuotesByProviderContractId.values(),
  ).map(cacheOptionQuoteSnapshot);
  sharedQueuedOptionQuotesByProviderContractId.clear();
  sharedOptionQuoteSubscribers.forEach((subscriber) => {
    subscriber.onQuotes(cachedQuotes);
  });
};

const scheduleSharedQueuedOptionQuoteFlush = () => {
  if (sharedOptionQuoteFlushScheduled) {
    return;
  }
  sharedOptionQuoteFlushScheduled = true;
  sharedOptionQuoteFlushTimer = scheduleRealtimeFlush(flushSharedQueuedOptionQuotes);
};

const queueSharedOptionQuotes = (quotes: LiveOptionQuoteSnapshot[]) => {
  quotes.forEach((quote) => {
    const providerContractId = normalizeProviderContractId(
      quote.providerContractId,
    );
    if (!providerContractId) {
      return;
    }
    sharedQueuedOptionQuotesByProviderContractId.set(providerContractId, quote);
  });
  if (sharedQueuedOptionQuotesByProviderContractId.size) {
    scheduleSharedQueuedOptionQuoteFlush();
  }
};

const closeSharedOptionQuoteSocket = () => {
  sharedOptionQuoteSocketGeneration += 1;
  clearSharedOptionQuoteReconnectTimer();
  stopSharedOptionQuoteRestFallback();
  stopSharedOptionQuoteStallWatchdog();
  if (sharedOptionQuoteFlushTimer !== null) {
    clearTimeout(sharedOptionQuoteFlushTimer);
    sharedOptionQuoteFlushTimer = null;
  }
  sharedOptionQuoteFlushScheduled = false;
  sharedQueuedOptionQuotesByProviderContractId.clear();
  sharedOptionQuoteActiveSignature = "";
  if (sharedOptionQuoteSocket) {
    const socket = sharedOptionQuoteSocket;
    sharedOptionQuoteSocket = null;
    socket.close();
  }
};

const nextSharedFallbackProviderContractIds = (
  providerContractIds: string[],
): string[] => {
  if (providerContractIds.length <= OPTION_QUOTE_REST_FALLBACK_BATCH_SIZE) {
    return providerContractIds;
  }
  const start = sharedOptionQuoteFallbackCursor % providerContractIds.length;
  const end = start + OPTION_QUOTE_REST_FALLBACK_BATCH_SIZE;
  const batch =
    end <= providerContractIds.length
      ? providerContractIds.slice(start, end)
      : [
          ...providerContractIds.slice(start),
          ...providerContractIds.slice(0, end - providerContractIds.length),
        ];
  sharedOptionQuoteFallbackCursor =
    (start + OPTION_QUOTE_REST_FALLBACK_BATCH_SIZE) %
    providerContractIds.length;
  return batch;
};

const requestSharedOptionQuoteRestSnapshot = async (
  demand: SharedOptionQuoteStreamDemand,
) => {
  const providerContractIds = nextSharedFallbackProviderContractIds(
    demand.providerContractIds,
  );
  if (!providerContractIds.length) {
    return;
  }
  const startedAt = Date.now();
  try {
    const payload = await getOptionQuoteSnapshots({
      underlying: demand.underlying,
      providerContractIds,
      owner: demand.owner,
      intent: demand.intent,
      requiresGreeks: demand.requiresGreeks,
    });
    recordOptionHydrationMetric(
      "quoteSnapshotMs",
      Math.max(0, Date.now() - startedAt),
    );
    setOptionHydrationDiagnostics({
      fallbackMode: "rest-rotating",
      providerMode: payload.debug?.providerMode ?? undefined,
      returnedQuotes: payload.debug?.returnedCount ?? payload.quotes.length,
      requestedQuotes: demand.providerContractIds.length,
      acceptedQuotes: demand.providerContractIds.length,
      rejectedQuotes: 0,
    });
    queueSharedOptionQuotes(payload.quotes as LiveOptionQuoteSnapshot[]);
  } catch {
    setOptionHydrationDiagnostics({
      fallbackMode: "rest-rotating",
      quoteMode: "rest-fallback-error",
    });
  }
};

const startSharedOptionQuoteRestFallback = (
  demand: SharedOptionQuoteStreamDemand,
) => {
  if (sharedOptionQuoteRestFallbackTimer) {
    return;
  }
  setOptionHydrationDiagnostics({
    quoteMode: "rest-fallback",
    fallbackMode: "rest-rotating",
    requestedQuotes: demand.providerContractIds.length,
    acceptedQuotes: demand.providerContractIds.length,
    rejectedQuotes: 0,
  });
  void requestSharedOptionQuoteRestSnapshot(demand);
  sharedOptionQuoteRestFallbackTimer = setInterval(() => {
    void requestSharedOptionQuoteRestSnapshot(demand);
  }, 3_000);
};

const scheduleSharedOptionQuoteWebSocketReconnect = (
  demand: SharedOptionQuoteStreamDemand,
) => {
  if (sharedOptionQuoteReconnectTimer) {
    return;
  }
  setOptionHydrationDiagnostics({
    wsState: "reconnecting",
    quoteMode: "websocket",
    fallbackMode: null,
  });
  sharedOptionQuoteReconnectTimer = setTimeout(() => {
    sharedOptionQuoteReconnectTimer = null;
    startSharedOptionQuoteWebSocket(demand);
  }, OPTION_QUOTE_WEBSOCKET_RECONNECT_MS);
};

const startSharedOptionQuoteWebSocket = (
  demand: SharedOptionQuoteStreamDemand,
) => {
  const webSocketUrl = OPTION_QUOTE_WEBSOCKET_ENABLED
    ? buildWebSocketUrl("/api/ws/options/quotes")
    : null;
  const signature = sharedOptionQuoteDemandSignature(demand);
  if (
    sharedOptionQuoteSocket &&
    sharedOptionQuoteActiveSignature === signature &&
    (sharedOptionQuoteSocket.readyState === WebSocket.OPEN ||
      sharedOptionQuoteSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  closeSharedOptionQuoteSocket();
  sharedOptionQuoteActiveSignature = signature;
  sharedOptionQuoteFirstQuoteStartedAt = Date.now();
  sharedOptionQuoteFirstQuoteRecorded = false;
  sharedOptionQuoteLastWebSocketMessageAt = Date.now();

  if (!webSocketUrl || typeof window === "undefined" || typeof window.WebSocket === "undefined") {
    startSharedOptionQuoteRestFallback(demand);
    return;
  }

  let ready = false;
  const generation = ++sharedOptionQuoteSocketGeneration;
  setOptionHydrationDiagnostics({
    wsState: "connecting",
    quoteMode: "websocket",
    fallbackMode: null,
    requestedQuotes: demand.providerContractIds.length,
  });

  const socket = new WebSocket(webSocketUrl);
  sharedOptionQuoteSocket = socket;
  sharedOptionQuoteStallTimer = setInterval(() => {
    if (
      generation !== sharedOptionQuoteSocketGeneration ||
      !ready
    ) {
      return;
    }
    const ageMs = Date.now() - sharedOptionQuoteLastWebSocketMessageAt;
    if (ageMs < OPTION_QUOTE_WEBSOCKET_STALL_MS) {
      return;
    }
    setOptionHydrationDiagnostics({
      wsState: "stalled",
      quoteMode: "websocket-stalled",
      degraded: true,
    });
    socket.close();
  }, Math.max(1_000, Math.floor(OPTION_QUOTE_WEBSOCKET_STALL_MS / 2)));

  socket.addEventListener("open", () => {
    if (generation !== sharedOptionQuoteSocketGeneration) {
      socket.close();
      return;
    }
    setOptionHydrationDiagnostics({ wsState: "open" });
    socket.send(
      JSON.stringify({
        type: "subscribe",
        underlying: demand.underlying,
        providerContractIds: demand.providerContractIds,
        owner: demand.owner,
        intent: demand.intent,
        requiresGreeks: demand.requiresGreeks,
      }),
    );
  });

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    if (generation !== sharedOptionQuoteSocketGeneration) {
      return;
    }
    sharedOptionQuoteLastWebSocketMessageAt = Date.now();
    const payload = parseJsonPayload<OptionQuoteWebSocketPayload>(event.data);
    if (!payload) {
      return;
    }
    if (payload.type === "ready") {
      ready = true;
      setOptionHydrationDiagnostics({
        wsState: "ready",
        requestedQuotes:
          payload.requestedCount ?? demand.providerContractIds.length,
        acceptedQuotes:
          payload.acceptedCount ?? demand.providerContractIds.length,
        rejectedQuotes: payload.rejectedCount ?? 0,
      });
      return;
    }
    if (payload.type === "status") {
      setOptionHydrationDiagnostics({
        wsState: ready ? "ready" : "connecting",
        providerMode: payload.providerMode ?? undefined,
        requestedQuotes:
          payload.requestedCount ?? demand.providerContractIds.length,
        acceptedQuotes: payload.acceptedCount,
        rejectedQuotes: payload.rejectedCount,
        returnedQuotes: payload.returnedCount,
        bufferedAmount: payload.bufferedAmount,
        degraded: payload.degraded,
      });
      return;
    }
    if (payload.type === "heartbeat") {
      setOptionHydrationDiagnostics({
        bufferedAmount: payload.bufferedAmount,
        degraded: payload.degraded,
      });
      return;
    }
    if (payload.type === "quotes" && payload.quotes?.length) {
      queueSharedOptionQuotes(payload.quotes as LiveOptionQuoteSnapshot[]);
      return;
    }
    if (payload.type === "error" && !ready) {
      socket.close();
    }
  });

  socket.addEventListener("error", () => {
    if (generation !== sharedOptionQuoteSocketGeneration || ready) {
      return;
    }
    setOptionHydrationDiagnostics({
      wsState: "failed-before-ready",
      quoteMode: "websocket",
      fallbackMode: null,
    });
  });

  socket.addEventListener("close", (event) => {
    if (generation !== sharedOptionQuoteSocketGeneration) {
      return;
    }
    stopSharedOptionQuoteStallWatchdog();
    if (sharedOptionQuoteSocket === socket) {
      sharedOptionQuoteSocket = null;
    }
    setOptionHydrationDiagnostics({
      wsState: ready ? "closed" : "failed-before-ready",
      pauseReason: event.reason || null,
    });
    if (!ready) {
      scheduleSharedOptionQuoteWebSocketReconnect(demand);
      return;
    }
    scheduleSharedOptionQuoteWebSocketReconnect(demand);
  });
};

const refreshSharedOptionQuoteStream = () => {
  sharedOptionQuoteRefreshTimer = null;
  const demand = resolveSharedOptionQuoteStreamDemand(
    sharedOptionQuoteSubscribers.values(),
  );
  if (!demand) {
    closeSharedOptionQuoteSocket();
    return;
  }
  startSharedOptionQuoteWebSocket(demand);
};

const scheduleSharedOptionQuoteStreamRefresh = () => {
  if (sharedOptionQuoteRefreshTimer) {
    return;
  }
  sharedOptionQuoteRefreshTimer = setTimeout(refreshSharedOptionQuoteStream, 0);
};

const subscribeSharedOptionQuoteStream = (
  input: Omit<SharedOptionQuoteStreamSubscriber, "id">,
) => {
  const id = sharedOptionQuoteSubscriberId++;
  sharedOptionQuoteSubscribers.set(id, {
    id,
    ...input,
    providerContractIds: normalizeSharedProviderContractIds(
      input.providerContractIds,
    ),
  });
  scheduleSharedOptionQuoteStreamRefresh();
  return () => {
    sharedOptionQuoteSubscribers.delete(id);
    scheduleSharedOptionQuoteStreamRefresh();
  };
};

type BrokerStreamFreshnessSnapshot = {
  accountLastEventAt: number | null;
  orderLastEventAt: number | null;
  accountFresh: boolean;
  orderFresh: boolean;
};

let brokerStreamFreshnessVersion = 0;
let accountLastEventAt: number | null = null;
let orderLastEventAt: number | null = null;
let lastOrderInvalidationAt = 0;
let lastAccountDerivedInvalidationAt = 0;
const brokerStreamFreshnessListeners = new Set<() => void>();

type ShadowAccountStreamFreshnessSnapshot = {
  accountLastEventAt: number | null;
  accountFresh: boolean;
};

let shadowAccountStreamFreshnessVersion = 0;
let shadowAccountLastEventAt: number | null = null;
const shadowAccountStreamFreshnessListeners = new Set<() => void>();

const emitBrokerStreamFreshness = () => {
  brokerStreamFreshnessVersion += 1;
  brokerStreamFreshnessListeners.forEach((listener) => listener());
};

const markBrokerStreamEvent = (kind: "account" | "order") => {
  const now = Date.now();
  if (kind === "account") {
    accountLastEventAt = now;
  } else {
    orderLastEventAt = now;
  }
  emitBrokerStreamFreshness();
};

const emitShadowAccountStreamFreshness = () => {
  shadowAccountStreamFreshnessVersion += 1;
  shadowAccountStreamFreshnessListeners.forEach((listener) => listener());
};

const markShadowAccountStreamEvent = () => {
  shadowAccountLastEventAt = Date.now();
  emitShadowAccountStreamFreshness();
};

const subscribeBrokerStreamFreshness = (listener: () => void) => {
  brokerStreamFreshnessListeners.add(listener);
  return () => brokerStreamFreshnessListeners.delete(listener);
};

const getBrokerStreamFreshnessVersion = () => brokerStreamFreshnessVersion;

const subscribeShadowAccountStreamFreshness = (listener: () => void) => {
  shadowAccountStreamFreshnessListeners.add(listener);
  return () => shadowAccountStreamFreshnessListeners.delete(listener);
};

const getShadowAccountStreamFreshnessVersion = () =>
  shadowAccountStreamFreshnessVersion;

export const getBrokerStreamFreshnessSnapshot =
  (): BrokerStreamFreshnessSnapshot => {
    const now = Date.now();
    return {
      accountLastEventAt,
      orderLastEventAt,
      accountFresh:
        accountLastEventAt != null && now - accountLastEventAt <= ACCOUNT_STREAM_FRESH_MS,
      orderFresh:
        orderLastEventAt != null && now - orderLastEventAt <= ACCOUNT_STREAM_FRESH_MS,
    };
  };

export const getBrokerStreamFreshnessStatus = () => {
  const snapshot = getBrokerStreamFreshnessSnapshot();
  return {
    accountFresh: snapshot.accountFresh,
    orderFresh: snapshot.orderFresh,
  };
};

const getBrokerStreamFreshnessStatusToken = () => {
  const status = getBrokerStreamFreshnessStatus();
  return `${status.accountFresh ? 1 : 0}:${status.orderFresh ? 1 : 0}`;
};

export const useBrokerStreamFreshnessSnapshot =
  (enabled = true): BrokerStreamFreshnessSnapshot => {
    useSyncExternalStore(
      enabled ? subscribeBrokerStreamFreshness : () => () => {},
      enabled ? getBrokerStreamFreshnessVersion : () => 0,
      () => 0,
    );
    useEffect(() => {
      if (!enabled) {
        return undefined;
      }
      const interval = setInterval(emitBrokerStreamFreshness, 1_000);
      return () => clearInterval(interval);
    }, [enabled]);
    return getBrokerStreamFreshnessSnapshot();
  };

export const useBrokerStreamFreshnessStatus = (enabled = true) => {
  const statusToken = useSyncExternalStore(
    enabled ? subscribeBrokerStreamFreshness : () => () => {},
    enabled ? getBrokerStreamFreshnessStatusToken : () => "0:0",
    () => "0:0",
  );
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const interval = setInterval(emitBrokerStreamFreshness, 1_000);
    return () => clearInterval(interval);
  }, [enabled]);
  return useMemo(
    () => ({
      accountFresh: statusToken[0] === "1",
      orderFresh: statusToken[2] === "1",
    }),
    [statusToken],
  );
};

export const getShadowAccountStreamFreshnessSnapshot =
  (): ShadowAccountStreamFreshnessSnapshot => {
    const now = Date.now();
    return {
      accountLastEventAt: shadowAccountLastEventAt,
      accountFresh:
        shadowAccountLastEventAt != null &&
        now - shadowAccountLastEventAt <= SHADOW_ACCOUNT_STREAM_FRESH_MS,
    };
  };

export const useShadowAccountStreamFreshnessSnapshot =
  (enabled = true): ShadowAccountStreamFreshnessSnapshot => {
    useSyncExternalStore(
      enabled ? subscribeShadowAccountStreamFreshness : () => () => {},
      enabled ? getShadowAccountStreamFreshnessVersion : () => 0,
      () => 0,
    );
    useEffect(() => {
      if (!enabled) {
        return undefined;
      }
      const interval = setInterval(emitShadowAccountStreamFreshness, 1_000);
      return () => clearInterval(interval);
    }, [enabled]);
    return getShadowAccountStreamFreshnessSnapshot();
  };

export const getOptionQuoteSnapshotCacheSize = (): number =>
  optionQuoteSnapshotsByProviderContractId.size;

export const getOptionQuoteSnapshotListenerCount = (): number =>
  Array.from(optionQuoteStoreListenersByProviderContractId.values()).reduce(
    (sum, listeners) => sum + listeners.size,
    optionQuoteStoreListeners.size,
  );

const normalizeSymbols = (symbols: string[]): string[] =>
  Array.from(
    new Set(
      symbols
        .map((symbol) => symbol?.trim?.().toUpperCase?.() || "")
        .filter(Boolean),
    ),
  ).sort();

const buildStreamUrl = (
  path: string,
  params: Record<string, string | undefined | null>,
): string | null => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === "string" && value.trim()) {
      normalizedParams.set(key, value.trim());
    }
  });

  const query = normalizedParams.toString();
  if (!query) {
    return null;
  }

  return `${path}?${query}`;
};

export const getShadowAccountStreamUrl = (): string =>
  "/api/streams/accounts/shadow";

export const getAccountPageStreamUrl = ({
  accountId,
  mode,
  range,
  orderTab,
  assetClass,
  tradeFilters = {},
  performanceCalendarFrom,
}: {
  accountId?: string | null;
  mode: StreamMode;
  range?: string | null;
  orderTab?: string | null;
  assetClass?: string | null;
  tradeFilters?: AccountTradeFilterInput;
  performanceCalendarFrom?: string | null;
}): string | null =>
  buildStreamUrl("/api/streams/accounts/page", {
    accountId: accountId ?? undefined,
    mode,
    range: range ?? undefined,
    orderTab: orderTab ?? undefined,
    assetClass: assetClass ?? undefined,
    from: tradeFilters.from ?? undefined,
    to: tradeFilters.to ?? undefined,
    symbol: tradeFilters.symbol ?? undefined,
    tradeAssetClass: tradeFilters.assetClass ?? undefined,
    pnlSign: tradeFilters.pnlSign ?? undefined,
    holdDuration: tradeFilters.holdDuration ?? undefined,
    performanceCalendarFrom: performanceCalendarFrom ?? undefined,
  });

export const getAlgoCockpitStreamUrl = ({
  deploymentId,
  mode,
  eventLimit,
}: {
  deploymentId?: string | null;
  mode: StreamMode;
  eventLimit?: number | null;
}): string | null =>
  buildStreamUrl("/api/streams/algo/cockpit", {
    deploymentId: deploymentId ?? undefined,
    mode,
    eventLimit:
      typeof eventLimit === "number" && Number.isFinite(eventLimit)
        ? String(Math.max(1, Math.floor(eventLimit)))
        : undefined,
  });

const buildWebSocketUrl = (path: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(path, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const parseJsonPayload = <T,>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPositiveFiniteNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value > 0;

const positiveOptionQuotePrice = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (isPositiveFiniteNumber(value)) {
      return value;
    }
  }
  return null;
};

const optionQuoteMidpoint = (
  bid: unknown,
  ask: unknown,
): number | null => {
  if (!isPositiveFiniteNumber(bid) || !isPositiveFiniteNumber(ask)) {
    return null;
  }
  return (bid + ask) / 2;
};

const getUpdatedAtTime = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const areOptionQuoteSnapshotsEquivalent = (
  left: LiveOptionQuoteSnapshot,
  right: LiveOptionQuoteSnapshot,
): boolean =>
  left.symbol === right.symbol &&
  left.price === right.price &&
  left.bid === right.bid &&
  left.ask === right.ask &&
  left.bidSize === right.bidSize &&
  left.askSize === right.askSize &&
  left.change === right.change &&
  left.changePercent === right.changePercent &&
  left.open === right.open &&
  left.high === right.high &&
  left.low === right.low &&
  left.prevClose === right.prevClose &&
  left.volume === right.volume &&
  left.openInterest === right.openInterest &&
  left.impliedVolatility === right.impliedVolatility &&
  left.delta === right.delta &&
  left.gamma === right.gamma &&
  left.theta === right.theta &&
  left.vega === right.vega &&
  left.underlyingPrice === right.underlyingPrice &&
  left.updatedAt === right.updatedAt &&
  left.source === right.source &&
  left.transport === right.transport &&
  left.delayed === right.delayed &&
  left.freshness === right.freshness &&
  left.status === right.status &&
  left.reason === right.reason &&
  left.quoteStatus === right.quoteStatus &&
  left.quoteReason === right.quoteReason &&
  left.greeksStatus === right.greeksStatus &&
  left.greeksReason === right.greeksReason &&
  left.demandStatus === right.demandStatus &&
  left.demandReason === right.demandReason &&
  left.quoteFreshness === right.quoteFreshness &&
  left.greeksFreshness === right.greeksFreshness &&
  left.unavailableDetail === right.unavailableDetail &&
  left.marketDataMode === right.marketDataMode &&
  left.dataUpdatedAt === right.dataUpdatedAt &&
  left.ageMs === right.ageMs &&
  left.cacheAgeMs === right.cacheAgeMs;

const normalizeProviderContractId = (
  providerContractId: string | null | undefined,
): string => providerContractId?.trim?.() || "";

const isOpraOptionTicker = (providerContractId: string | null | undefined): boolean =>
  /^O:/i.test(String(providerContractId ?? "").trim());

const normalizeIbkrProviderContractId = (
  providerContractId: string | number | null | undefined,
): string => {
  const normalized = normalizeProviderContractId(
    providerContractId == null ? null : String(providerContractId),
  );
  return normalized && !isOpraOptionTicker(normalized) ? normalized : "";
};

const uniqueOptionProviderContractIds = (
  providerContractIds: Array<string | null | undefined>,
): string[] =>
  Array.from(
    new Set(
      providerContractIds
        .map((providerContractId) => providerContractId?.trim?.() || "")
        .filter(Boolean),
    ),
  );

const subscribeToOptionQuoteSnapshot = (
  providerContractId: string,
  listener: () => void,
): (() => void) => {
  const normalizedProviderContractId = normalizeProviderContractId(providerContractId);
  if (!normalizedProviderContractId) {
    return () => {};
  }

  const listeners =
    optionQuoteStoreListenersByProviderContractId.get(normalizedProviderContractId) ||
    new Set();
  listeners.add(listener);
  optionQuoteStoreListenersByProviderContractId.set(
    normalizedProviderContractId,
    listeners,
  );

  return () => {
    const currentListeners =
      optionQuoteStoreListenersByProviderContractId.get(normalizedProviderContractId);
    currentListeners?.delete(listener);
    if (currentListeners && currentListeners.size === 0) {
      optionQuoteStoreListenersByProviderContractId.delete(
        normalizedProviderContractId,
      );
    }
  };
};

const getOptionQuoteSnapshotVersion = (providerContractId: string): number =>
  optionQuoteStoreVersions.get(normalizeProviderContractId(providerContractId)) ?? 0;

const flushOptionQuoteNotifications = () => {
  optionQuoteNotifyScheduled = false;
  optionQuoteLastFlushAtMs = Date.now();
  const providerContractIds = Array.from(pendingOptionQuoteNotifications);
  pendingOptionQuoteNotifications.clear();

  providerContractIds.forEach((providerContractId) => {
    optionQuoteStoreVersions.set(
      providerContractId,
      (optionQuoteStoreVersions.get(providerContractId) ?? 0) + 1,
    );
  });
  optionQuoteStoreListeners.forEach((listener) => listener());
  providerContractIds.forEach((providerContractId) => {
    optionQuoteStoreListenersByProviderContractId
      .get(providerContractId)
      ?.forEach((listener) => listener());
  });
};

const scheduleOptionQuoteNotification = (providerContractId: string) => {
  pendingOptionQuoteNotifications.add(providerContractId);
  if (optionQuoteNotifyScheduled) {
    return;
  }

  optionQuoteNotifyScheduled = true;
  // Trailing-edge throttle (mirrors the IBKR latency store). The shared
  // scheduleRealtimeFlush coalesces only within a microtask, which drains
  // between every "quotes" WS message — so a fast option chain drove one React
  // commit per message for each subscribed contract. Cap notifications to one
  // per QUOTE_STREAM_CACHE_FLUSH_MS; the first quote after an idle gap still
  // flushes promptly (delay 0). pendingOptionQuoteNotifications keeps deduping
  // contracts within the window, and listeners read live snapshots at render.
  const delay = Math.max(
    0,
    QUOTE_STREAM_CACHE_FLUSH_MS - (Date.now() - optionQuoteLastFlushAtMs),
  );
  setTimeout(flushOptionQuoteNotifications, delay);
};

const cacheOptionQuoteSnapshot = (
  quote: LiveOptionQuoteSnapshot,
): LiveOptionQuoteSnapshot => {
  const normalizedProviderContractId = normalizeProviderContractId(
    quote.providerContractId,
  );
  if (!normalizedProviderContractId) {
    return quote;
  }

  const currentQuote =
    optionQuoteSnapshotsByProviderContractId.get(normalizedProviderContractId) || null;
  const currentUpdatedAt = getUpdatedAtTime(currentQuote?.updatedAt);
  const nextUpdatedAt = getUpdatedAtTime(quote.updatedAt);

  if (
    currentQuote &&
    currentUpdatedAt != null &&
    nextUpdatedAt != null &&
    nextUpdatedAt < currentUpdatedAt
  ) {
    return currentQuote;
  }

  const cachedQuote = mergeOptionQuoteSnapshotForCache(
    currentQuote,
    quote,
    normalizedProviderContractId,
  );

  if (
    currentQuote &&
    areOptionQuoteSnapshotsEquivalent(currentQuote, cachedQuote)
  ) {
    return currentQuote;
  }

  // LRU touch: re-insert moves the contract to the most-recently-used position.
  optionQuoteSnapshotsByProviderContractId.delete(normalizedProviderContractId);
  optionQuoteSnapshotsByProviderContractId.set(
    normalizedProviderContractId,
    cachedQuote,
  );
  // Evict the oldest snapshots that no longer have any listeners; never drop a
  // snapshot that a component is actively subscribed to.
  while (
    optionQuoteSnapshotsByProviderContractId.size > MAX_OPTION_QUOTE_SNAPSHOTS
  ) {
    let evicted = false;
    for (const evictKey of optionQuoteSnapshotsByProviderContractId.keys()) {
      const stillSubscribed =
        (optionQuoteStoreListenersByProviderContractId.get(evictKey)?.size ?? 0) >
        0;
      if (stillSubscribed) {
        continue;
      }
      optionQuoteSnapshotsByProviderContractId.delete(evictKey);
      optionQuoteStoreVersions.delete(evictKey);
      evicted = true;
      break;
    }
    if (!evicted) {
      break;
    }
  }
  scheduleOptionQuoteNotification(normalizedProviderContractId);

  return cachedQuote;
};

const finiteOptionNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
};

const optionRightCode = (value: unknown): "C" | "P" | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "call" || normalized === "c") {
    return "C";
  }
  if (normalized === "put" || normalized === "p") {
    return "P";
  }
  return null;
};

const optionExpirationKey = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`;
  }
  if (/^\d{8}$/.test(text)) {
    return text;
  }
  return null;
};

const base64UrlEncode = (value: string): string => {
  const encoded = btoa(value);
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const structuredOptionProviderContractId = (
  contract: AccountPositionRow["optionContract"] | null | undefined,
): string | null => {
  const underlying = String(contract?.underlying ?? "").trim().toUpperCase();
  const expiration = optionExpirationKey(contract?.expirationDate);
  const strike = finiteOptionNumber(contract?.strike);
  const right = optionRightCode(contract?.right);
  if (!underlying || !expiration || strike === null || !right) {
    return null;
  }
  const multiplier = Math.trunc(
    finiteOptionNumber(contract?.multiplier, contract?.sharesPerContract) ?? 100,
  );
  return `twsopt:${base64UrlEncode(
    JSON.stringify({
      v: 1,
      u: underlying,
      e: expiration,
      s: strike,
      r: right,
      x: "SMART",
      tc: underlying,
      m: multiplier > 0 ? multiplier : 100,
    }),
  )}`;
};

const optionPositionProviderContractId = (
  row: AccountPositionRow,
): string => optionPositionProviderContractIds(row)[0] || "";

const optionPositionProviderContractIds = (
  row: AccountPositionRow,
): string[] => {
  const rowWithOptionQuote = row as AccountPositionRowWithOptionQuote;
  const contract = row.optionContract as
    | (NonNullable<AccountPositionRow["optionContract"]> & { conid?: unknown })
    | null
    | undefined;
  const primaryProviderContractId =
    normalizeIbkrProviderContractId(row.optionContract?.providerContractId) ||
    normalizeIbkrProviderContractId(rowWithOptionQuote.optionQuote?.providerContractId) ||
    normalizeIbkrProviderContractId(
      typeof contract?.conid === "string" || typeof contract?.conid === "number"
        ? contract.conid
        : null,
    );
  return uniqueOptionProviderContractIds([
    structuredOptionProviderContractId(row.optionContract),
    primaryProviderContractId,
  ]);
};

const optionQuoteStatusRank = (status: unknown): number => {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "live":
      return 5;
    case "stale":
      return 4;
    case "pending":
      return 3;
    case "unavailable":
      return 2;
    case "rejected":
      return 1;
    default:
      return 0;
  }
};

const optionQuoteSnapshotStatusRank = (
  quote: LiveOptionQuoteSnapshot | null | undefined,
): number =>
  optionQuoteStatusRank(
    quote?.quoteStatus ??
      quote?.status ??
      quote?.quoteFreshness ??
      quote?.freshness,
  );

const optionQuoteSnapshotTimestampMs = (
  quote: LiveOptionQuoteSnapshot | null | undefined,
): number | null =>
  getUpdatedAtTime(
    typeof quote?.dataUpdatedAt === "string" && quote.dataUpdatedAt
      ? quote.dataUpdatedAt
      : quote?.updatedAt,
  );

const compareLiveOptionQuoteSnapshots = (
  left: LiveOptionQuoteSnapshot | null | undefined,
  right: LiveOptionQuoteSnapshot | null | undefined,
): number => {
  if (!left && !right) return 0;
  if (left && !right) return 1;
  if (!left && right) return -1;

  const leftStatusRank = optionQuoteSnapshotStatusRank(left);
  const rightStatusRank = optionQuoteSnapshotStatusRank(right);
  if (leftStatusRank !== rightStatusRank) {
    return leftStatusRank - rightStatusRank;
  }

  const leftFreshnessRank = optionQuoteStatusRank(left?.freshness);
  const rightFreshnessRank = optionQuoteStatusRank(right?.freshness);
  if (leftFreshnessRank !== rightFreshnessRank) {
    return leftFreshnessRank - rightFreshnessRank;
  }

  const leftTimestamp = optionQuoteSnapshotTimestampMs(left);
  const rightTimestamp = optionQuoteSnapshotTimestampMs(right);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  if (leftTimestamp !== null && rightTimestamp === null) return 1;
  if (leftTimestamp === null && rightTimestamp !== null) return -1;

  const leftCacheAge = finiteOptionNumber(left?.cacheAgeMs, left?.ageMs);
  const rightCacheAge = finiteOptionNumber(right?.cacheAgeMs, right?.ageMs);
  if (leftCacheAge !== null && rightCacheAge !== null && leftCacheAge !== rightCacheAge) {
    return rightCacheAge - leftCacheAge;
  }
  if (leftCacheAge !== null && rightCacheAge === null) return 1;
  if (leftCacheAge === null && rightCacheAge !== null) return -1;

  return 0;
};

const freshestOptionQuoteSnapshotForProviderContractIds = (
  providerContractIds: string[],
  quoteByProviderContractId: Map<string, LiveOptionQuoteSnapshot>,
): LiveOptionQuoteSnapshot | null =>
  providerContractIds.reduce<LiveOptionQuoteSnapshot | null>((best, providerContractId) => {
    const quote = quoteByProviderContractId.get(providerContractId) ?? null;
    return compareLiveOptionQuoteSnapshots(quote, best) > 0 ? quote : best;
  }, null);

const optionQuotePositionSource = (
  source: LiveOptionQuoteSnapshot["source"] | undefined,
): NonNullable<AccountPositionRow["quote"]>["source"] =>
  source === "massive" ? "massive" : "option_quote";

const optionQuoteDisplayMark = (
  quote: LiveOptionQuoteSnapshot,
  fallback: unknown,
): number | null =>
  positiveOptionQuotePrice(
    (quote as LiveOptionQuoteSnapshot & { mid?: unknown }).mid,
    optionQuoteMidpoint(quote.bid, quote.ask),
    (quote as LiveOptionQuoteSnapshot & { mark?: unknown }).mark,
    (quote as LiveOptionQuoteSnapshot & { last?: unknown }).last,
    quote.price,
    fallback,
  );

type OptionPricedPosition = {
  assetClass?: unknown;
  positionType?: unknown;
  optionContract?: {
    multiplier?: unknown;
    sharesPerContract?: unknown;
  } | null;
  quantity?: unknown;
  averagePrice?: unknown;
  averageCost?: unknown;
  marketPrice?: unknown;
  mark?: unknown;
  marketValue?: unknown;
  unrealizedPnl?: unknown;
};

const isOptionPricedPosition = (position: OptionPricedPosition): boolean =>
  Boolean(position.optionContract) ||
  normalizeAccountAssetClass(position.positionType) === "option" ||
  ["option", "options"].includes(String(position.assetClass || "").toLowerCase());

const optionPositionMultiplier = (position: OptionPricedPosition): number => {
  if (!isOptionPricedPosition(position)) {
    return 1;
  }
  const multiplier =
    finiteOptionNumber(
      position.optionContract?.multiplier,
      position.optionContract?.sharesPerContract,
    ) ?? 100;
  return multiplier > 0 ? multiplier : 100;
};

const optionPriceLooksContractScaled = (
  position: OptionPricedPosition,
  price: number,
  multiplier: number,
): boolean => {
  if (!isOptionPricedPosition(position) || multiplier <= 1 || price <= 0) {
    return false;
  }

  const quantity = Math.abs(finiteOptionNumber(position.quantity) ?? 0);
  const marketValue = Math.abs(finiteOptionNumber(position.marketValue) ?? 0);
  const unrealizedPnl = finiteOptionNumber(position.unrealizedPnl);
  const rawAveragePrice = finiteOptionNumber(
    position.averagePrice,
    position.averageCost,
  );
  const rawMarketPrice = finiteOptionNumber(position.marketPrice, position.mark);
  const rawPriceIsFlatFallback =
    rawAveragePrice !== null &&
    rawMarketPrice !== null &&
    Math.abs(rawAveragePrice - rawMarketPrice) <= 1e-9 &&
    unrealizedPnl !== null &&
    Math.abs(unrealizedPnl) <= 0.01;
  if (price >= multiplier * 0.5 && rawPriceIsFlatFallback) {
    return true;
  }

  const inferredCostBasis =
    marketValue > 0 && unrealizedPnl !== null
      ? Math.abs(marketValue - unrealizedPnl)
      : null;
  if (
    inferredCostBasis !== null &&
    inferredCostBasis > 1e-9 &&
    quantity > 1e-9
  ) {
    const contractScaledBasis = Math.abs(price * quantity);
    const premiumBasis = Math.abs(price * quantity * multiplier);
    const contractScaledDistance =
      Math.abs(contractScaledBasis - inferredCostBasis) / inferredCostBasis;
    const premiumDistance =
      Math.abs(premiumBasis - inferredCostBasis) / inferredCostBasis;
    if (contractScaledDistance <= 0.02 && premiumDistance > 0.02) {
      return true;
    }
    if (premiumDistance <= 0.02 && contractScaledDistance > 0.02) {
      return false;
    }
  }

  return price >= multiplier * 0.5;
};

const ACCOUNT_POSITION_MARKET_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const accountPositionDateOrNull = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const raw = value.trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return new Date(
      Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), 12),
    );
  }
  const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dashed) {
    return new Date(
      Date.UTC(Number(dashed[1]), Number(dashed[2]) - 1, Number(dashed[3]), 12),
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const accountPositionDateOnlyMarketDateKey = (value: unknown): string | null => {
  if (typeof value === "string") {
    const raw = value.trim();
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  }
  if (
    value instanceof Date &&
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  ) {
    return value.toISOString().slice(0, 10);
  }
  return null;
};

const accountPositionMarketDateKey = (value: unknown): string | null => {
  const dateOnlyKey = accountPositionDateOnlyMarketDateKey(value);
  if (dateOnlyKey) return dateOnlyKey;
  const date = accountPositionDateOrNull(value);
  if (!date) return null;
  const parts = ACCOUNT_POSITION_MARKET_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
};

const accountPositionOpenedOnCurrentMarketDay = (
  openedAt: unknown,
  now: Date = new Date(),
): boolean => {
  const opened = accountPositionDateOrNull(openedAt);
  const observedAt = accountPositionDateOrNull(now);
  if (!opened || !observedAt || opened.getTime() > observedAt.getTime()) {
    return false;
  }
  const openedKey = accountPositionMarketDateKey(openedAt);
  const nowKey = accountPositionMarketDateKey(observedAt);
  return Boolean(openedKey && nowKey && openedKey === nowKey);
};

const normalizeOptionPremiumPrice = (
  position: OptionPricedPosition,
  value: unknown,
): number | null => {
  const price = finiteOptionNumber(value);
  if (price === null) {
    return null;
  }
  const multiplier = optionPositionMultiplier(position);
  return optionPriceLooksContractScaled(position, price, multiplier)
    ? price / multiplier
    : price;
};

const patchAccountPositionRowFromOptionQuote = (
  row: AccountPositionRow,
  quote: LiveOptionQuoteSnapshot,
): AccountPositionRow => {
  const rowWithOptionQuote = row as AccountPositionRowWithOptionQuote;
  const providerContractIds = optionPositionProviderContractIds(row);
  const providerContractId = providerContractIds[0] || "";
  const quoteProviderContractId = normalizeProviderContractId(quote.providerContractId);
  if (
    !providerContractId ||
    !quoteProviderContractId ||
    !providerContractIds.includes(quoteProviderContractId)
  ) {
    return row;
  }

  const mark = optionQuoteDisplayMark(quote, row.mark);
  const quantity = finiteOptionNumber(row.quantity);
  const averageCost = normalizeOptionPremiumPrice(row, row.averageCost);
  const multiplier = optionPositionMultiplier(row);
  const marketValue =
    mark !== null && quantity !== null ? mark * quantity * multiplier : row.marketValue;
  const unrealizedPnl =
    mark !== null && averageCost !== null && quantity !== null
      ? (mark - averageCost) * quantity * multiplier
      : row.unrealizedPnl;
  const costBasis =
    averageCost !== null && quantity !== null
      ? Math.abs(averageCost * quantity * multiplier)
      : null;
  const unrealizedPnlPercent =
    unrealizedPnl !== null && costBasis && costBasis > 0
      ? (unrealizedPnl / costBasis) * 100
      : row.unrealizedPnlPercent;
  const perContractDayChange = finiteOptionNumber(
    (quote as LiveOptionQuoteSnapshot & { dayChange?: unknown }).dayChange,
    quote.change,
  );
  const sameDayPosition = accountPositionOpenedOnCurrentMarketDay(row.openedAt);
  const sameDayUnrealizedPnl = finiteOptionNumber(unrealizedPnl);
  const sameDayUnrealizedPnlPercent = finiteOptionNumber(unrealizedPnlPercent);
  const dayChange =
    sameDayPosition && sameDayUnrealizedPnl !== null
      ? sameDayUnrealizedPnl
      : perContractDayChange !== null && quantity !== null
        ? perContractDayChange * quantity * multiplier
        : row.dayChange;
  const dayChangePercent =
    sameDayPosition && sameDayUnrealizedPnlPercent !== null
      ? sameDayUnrealizedPnlPercent
      : finiteOptionNumber(
          (quote as LiveOptionQuoteSnapshot & { dayChangePercent?: unknown }).dayChangePercent,
          quote.changePercent,
          row.dayChangePercent,
        );
  const bid = finiteOptionNumber(quote.bid);
  const ask = finiteOptionNumber(quote.ask);
  const mid = optionQuoteMidpoint(bid, ask);
  const spread =
    bid !== null && ask !== null ? ask - bid : finiteOptionNumber(row.quote?.spread);
  const spreadPercent =
    spread !== null && mark !== null && mark > 0
      ? (spread / mark) * 100
      : finiteOptionNumber(row.quote?.spreadPercent);
  const source = optionQuotePositionSource(quote.source);
  const updatedAt = quote.dataUpdatedAt ?? quote.updatedAt ?? row.quote?.updatedAt ?? null;
  const last = finiteOptionNumber(
    (quote as LiveOptionQuoteSnapshot & { last?: unknown }).last,
    quote.price,
    row.quote?.last,
  );
  const currentOptionQuote: AccountOptionQuotePatch =
    rowWithOptionQuote.optionQuote || {};
  const currentPositionQuote = row.quote as AccountOptionQuotePatch | null | undefined;
  const optionQuote = {
    ...currentOptionQuote,
    ...quote,
    providerContractId: quoteProviderContractId,
    bid: bid ?? finiteOptionNumber(currentOptionQuote.bid) ?? null,
    ask: ask ?? finiteOptionNumber(currentOptionQuote.ask) ?? null,
    mid: mid ?? finiteOptionNumber(currentOptionQuote.mid) ?? null,
    last: last ?? finiteOptionNumber(currentOptionQuote.last) ?? null,
    price: finiteOptionNumber(quote.price, currentOptionQuote.price) ?? null,
    mark: mark ?? finiteOptionNumber(currentOptionQuote.mark) ?? null,
    spread,
    spreadPercent,
    dayChange:
      perContractDayChange ??
      finiteOptionNumber(currentOptionQuote.dayChange) ??
      null,
    dayChangePercent:
      dayChangePercent ?? finiteOptionNumber(currentOptionQuote.dayChangePercent) ?? null,
    bidSize: finiteOptionNumber(quote.bidSize, currentOptionQuote.bidSize) ?? null,
    askSize: finiteOptionNumber(quote.askSize, currentOptionQuote.askSize) ?? null,
    volume: finiteOptionNumber(quote.volume, currentOptionQuote.volume) ?? null,
    openInterest:
      finiteOptionNumber(quote.openInterest, currentOptionQuote.openInterest) ?? null,
    impliedVolatility:
      finiteOptionNumber(
        quote.impliedVolatility,
        currentOptionQuote.impliedVolatility,
      ) ?? null,
    delta: finiteOptionNumber(quote.delta, currentOptionQuote.delta) ?? null,
    gamma: finiteOptionNumber(quote.gamma, currentOptionQuote.gamma) ?? null,
    theta: finiteOptionNumber(quote.theta, currentOptionQuote.theta) ?? null,
    vega: finiteOptionNumber(quote.vega, currentOptionQuote.vega) ?? null,
    underlyingPrice:
      finiteOptionNumber(quote.underlyingPrice, currentOptionQuote.underlyingPrice) ??
      null,
    freshness: quote.freshness ?? currentOptionQuote.freshness ?? null,
    status: quote.status ?? quote.quoteStatus ?? currentOptionQuote.status ?? null,
    reason: quote.reason ?? quote.quoteReason ?? currentOptionQuote.reason ?? null,
    quoteStatus: quote.quoteStatus ?? quote.status ?? currentOptionQuote.quoteStatus ?? null,
    quoteReason: quote.quoteReason ?? currentOptionQuote.quoteReason ?? null,
    greeksStatus: quote.greeksStatus ?? currentOptionQuote.greeksStatus ?? null,
    greeksReason: quote.greeksReason ?? currentOptionQuote.greeksReason ?? null,
    demandStatus: quote.demandStatus ?? currentOptionQuote.demandStatus ?? null,
    demandReason: quote.demandReason ?? currentOptionQuote.demandReason ?? null,
    quoteFreshness:
      quote.quoteFreshness ??
      quote.freshness ??
      currentOptionQuote.quoteFreshness ??
      currentOptionQuote.freshness ??
      null,
    greeksFreshness: quote.greeksFreshness ?? currentOptionQuote.greeksFreshness ?? null,
    unavailableDetail:
      quote.unavailableDetail ??
      quote.quoteReason ??
      quote.reason ??
      currentOptionQuote.unavailableDetail ??
      null,
    marketDataMode: quote.marketDataMode ?? currentOptionQuote.marketDataMode ?? null,
    updatedAt,
    dataUpdatedAt: quote.dataUpdatedAt ?? currentOptionQuote.dataUpdatedAt ?? null,
    ageMs: finiteOptionNumber(quote.ageMs, currentOptionQuote.ageMs) ?? null,
    cacheAgeMs: finiteOptionNumber(quote.cacheAgeMs, currentOptionQuote.cacheAgeMs) ?? null,
    source,
    transport: quote.transport ?? currentOptionQuote.transport ?? null,
    delayed: quote.delayed ?? currentOptionQuote.delayed ?? null,
  };

  return {
    ...row,
    optionQuote,
    averageCost: averageCost ?? row.averageCost,
    mark: mark ?? row.mark,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPercent,
    dayChange,
    dayChangePercent,
    quote: {
      ...(row.quote || {}),
      bid: bid ?? row.quote?.bid ?? null,
      ask: ask ?? row.quote?.ask ?? null,
      mid: mid ?? row.quote?.mid ?? null,
      last,
      mark: mark ?? row.quote?.mark ?? null,
      spread,
      spreadPercent,
      bidSize: finiteOptionNumber(quote.bidSize, row.quote?.bidSize),
      askSize: finiteOptionNumber(quote.askSize, row.quote?.askSize),
      freshness: quote.freshness ?? row.quote?.freshness ?? null,
      status: quote.status ?? quote.quoteStatus ?? row.quote?.status ?? null,
      reason: quote.reason ?? quote.quoteReason ?? row.quote?.reason ?? null,
      quoteStatus: quote.quoteStatus ?? quote.status ?? row.quote?.quoteStatus ?? null,
      quoteReason: quote.quoteReason ?? row.quote?.quoteReason ?? null,
      greeksStatus: quote.greeksStatus ?? row.quote?.greeksStatus ?? null,
      greeksReason: quote.greeksReason ?? row.quote?.greeksReason ?? null,
      demandStatus: quote.demandStatus ?? row.quote?.demandStatus ?? null,
      demandReason: quote.demandReason ?? row.quote?.demandReason ?? null,
      quoteFreshness:
        quote.quoteFreshness ?? quote.freshness ?? row.quote?.quoteFreshness ?? null,
      greeksFreshness: quote.greeksFreshness ?? row.quote?.greeksFreshness ?? null,
      unavailableDetail:
        quote.unavailableDetail ??
        quote.quoteReason ??
        quote.reason ??
        row.quote?.unavailableDetail ??
        null,
      marketDataMode: quote.marketDataMode ?? row.quote?.marketDataMode ?? null,
      updatedAt,
      dataUpdatedAt: quote.dataUpdatedAt ?? row.quote?.dataUpdatedAt ?? null,
      ageMs: finiteOptionNumber(quote.ageMs, row.quote?.ageMs),
      cacheAgeMs: finiteOptionNumber(quote.cacheAgeMs, row.quote?.cacheAgeMs),
      underlyingPrice:
        optionQuote.underlyingPrice ?? currentPositionQuote?.underlyingPrice ?? null,
      source,
    },
  } as AccountPositionRow;
};

const recomputeAccountPositionTotals = (
  currentTotals: AccountPositionsResponse["totals"] | undefined,
  rows: AccountPositionRow[],
): AccountPositionsResponse["totals"] => ({
  ...(currentTotals || {}),
  weightPercent: rows.reduce((sum, row) => sum + (row.weightPercent ?? 0), 0),
  unrealizedPnl: rows.reduce((sum, row) => sum + (row.unrealizedPnl ?? 0), 0),
  grossLong: rows
    .filter((row) => row.marketValue > 0)
    .reduce((sum, row) => sum + row.marketValue, 0),
  grossShort: Math.abs(
    rows
      .filter((row) => row.marketValue < 0)
      .reduce((sum, row) => sum + row.marketValue, 0),
  ),
  netExposure: rows.reduce((sum, row) => sum + row.marketValue, 0),
});

export const patchAccountPositionsFromOptionQuotes = (
  current: AccountPositionsResponse | undefined,
  quotes: LiveOptionQuoteSnapshot[],
): AccountPositionsResponse | undefined => {
  if (!current?.positions?.length || !quotes.length) {
    return current;
  }
  const quoteByProviderContractId = new Map(
    quotes.flatMap((quote) => {
      const providerContractId = normalizeProviderContractId(quote.providerContractId);
      return providerContractId ? [[providerContractId, quote] as const] : [];
    }),
  );
  if (!quoteByProviderContractId.size) {
    return current;
  }

  let changed = false;
  const positions = current.positions.map((row) => {
    const quote = freshestOptionQuoteSnapshotForProviderContractIds(
      optionPositionProviderContractIds(row),
      quoteByProviderContractId,
    );
    if (!quote) {
      return row;
    }
    const next = patchAccountPositionRowFromOptionQuote(row, quote);
    if (next !== row && !valuesEqualJson(next, row)) {
      changed = true;
      return next;
    }
    return row;
  });

  if (!changed) {
    return current;
  }

  return maybeReuseAccountPositionsResponse(current, {
    ...current,
    positions,
    totals: recomputeAccountPositionTotals(current.totals, positions),
    updatedAt: new Date().toISOString(),
  });
};

export const mergeOptionQuoteSnapshotForCache = (
  currentQuote: LiveOptionQuoteSnapshot | null | undefined,
  quote: LiveOptionQuoteSnapshot,
  providerContractId: string,
): LiveOptionQuoteSnapshot => {
  const currentBid = positiveOptionQuotePrice(currentQuote?.bid);
  const currentAsk = positiveOptionQuotePrice(currentQuote?.ask);
  const incomingBid = positiveOptionQuotePrice(quote.bid);
  const incomingAsk = positiveOptionQuotePrice(quote.ask);
  const incomingUnderlyingPrice = positiveOptionQuotePrice(quote.underlyingPrice);
  const currentUnderlyingPrice = positiveOptionQuotePrice(
    currentQuote?.underlyingPrice,
  );
  const incomingHasUsablePrice =
    positiveOptionQuotePrice(quote.price, quote.bid, quote.ask) != null;
  return {
    ...currentQuote,
    ...quote,
    providerContractId,
    bid: incomingBid ?? currentBid ?? quote.bid,
    ask: incomingAsk ?? currentAsk ?? quote.ask,
    price:
      positiveOptionQuotePrice(quote.price) ??
      optionQuoteMidpoint(incomingBid, incomingAsk) ??
      positiveOptionQuotePrice(currentQuote?.price) ??
      optionQuoteMidpoint(currentBid, currentAsk) ??
      quote.price,
    change: incomingHasUsablePrice ? quote.change : currentQuote?.change ?? quote.change,
    changePercent: incomingHasUsablePrice
      ? quote.changePercent
      : currentQuote?.changePercent ?? quote.changePercent,
    underlyingPrice:
      incomingUnderlyingPrice ??
      currentUnderlyingPrice ??
      quote.underlyingPrice ??
      currentQuote?.underlyingPrice ??
      null,
  };
};

const seedOptionQuoteSnapshotsFromContracts = (
  contracts: OptionChainResponse["contracts"],
) => {
  (contracts || []).forEach((contract) => {
    const providerContractId = normalizeProviderContractId(
      contract.contract?.providerContractId,
    );
    if (!providerContractId) {
      return;
    }
    const hasQuoteData =
      (isFiniteNumber(contract.bid) && contract.bid > 0) ||
      (isFiniteNumber(contract.ask) && contract.ask > 0) ||
      (isFiniteNumber(contract.last) && contract.last > 0) ||
      (isFiniteNumber(contract.mark) && contract.mark > 0);
    if (contract.quoteFreshness === "metadata" && !hasQuoteData) {
      return;
    }

    cacheOptionQuoteSnapshot({
      symbol: contract.contract?.ticker || contract.contract?.underlying || "",
      price:
        isFiniteNumber(contract.last) && contract.last > 0
          ? contract.last
          : isFiniteNumber(contract.mark)
            ? contract.mark
            : 0,
      bid: contract.bid ?? 0,
      ask: contract.ask ?? 0,
      bidSize: 0,
      askSize: 0,
      change: 0,
      changePercent: 0,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: contract.volume ?? null,
      openInterest: contract.openInterest ?? null,
      impliedVolatility: contract.impliedVolatility ?? null,
      delta: contract.delta ?? null,
      gamma: contract.gamma ?? null,
      theta: contract.theta ?? null,
      vega: contract.vega ?? null,
      providerContractId,
      source: "ibkr",
      transport: "tws",
      delayed:
        contract.quoteFreshness === "delayed" ||
        contract.quoteFreshness === "delayed_frozen",
      updatedAt: contract.quoteUpdatedAt || contract.updatedAt,
      freshness: contract.quoteFreshness,
      marketDataMode: contract.marketDataMode,
      dataUpdatedAt: contract.dataUpdatedAt || contract.quoteUpdatedAt || null,
      ageMs: contract.ageMs ?? null,
      cacheAgeMs: contract.ageMs ?? null,
      latency: null,
    });
  });
};

export const getStoredOptionQuoteSnapshot = (
  providerContractId?: string | null,
): LiveOptionQuoteSnapshot | null => {
  const normalizedProviderContractId = normalizeProviderContractId(
    providerContractId,
  );
  if (!normalizedProviderContractId) {
    return null;
  }

  return (
    optionQuoteSnapshotsByProviderContractId.get(normalizedProviderContractId) || null
  );
};

export const useStoredOptionQuoteSnapshot = (
  providerContractId?: string | null,
): LiveOptionQuoteSnapshot | null => {
  const normalizedProviderContractId = normalizeProviderContractId(
    providerContractId,
  );
  useSyncExternalStore(
    (listener) =>
      subscribeToOptionQuoteSnapshot(normalizedProviderContractId, listener),
    () => getOptionQuoteSnapshotVersion(normalizedProviderContractId),
    () => getOptionQuoteSnapshotVersion(normalizedProviderContractId),
  );

  return getStoredOptionQuoteSnapshot(normalizedProviderContractId);
};

export const useStoredOptionQuoteSnapshotVersion = (
  providerContractIds: string[] = [],
): number => {
  const providerContractIdSignature = Array.from(
    new Set(providerContractIds.map(normalizeProviderContractId).filter(Boolean)),
  )
    .sort()
    .join("\u001f");
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!providerContractIdSignature) {
        return () => {};
      }

      const unsubscribe = providerContractIdSignature
        .split("\u001f")
        .map((providerContractId) =>
          subscribeToOptionQuoteSnapshot(providerContractId, listener),
        );
      return () => unsubscribe.forEach((stop) => stop());
    },
    [providerContractIdSignature],
  );
  const getSnapshot = useCallback(() => {
    if (!providerContractIdSignature) {
      return 0;
    }

    return providerContractIdSignature
      .split("\u001f")
      .reduce(
        (version, providerContractId) =>
          version + getOptionQuoteSnapshotVersion(providerContractId),
        0,
      );
  }, [providerContractIdSignature]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

const readQueryParams = (queryKey: unknown): Record<string, unknown> | null => {
  if (!Array.isArray(queryKey) || queryKey.length < 2) {
    return null;
  }

  const params = queryKey[1];
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }

  return params as Record<string, unknown>;
};

const readSymbolsParam = (queryKey: unknown): string[] => {
  const params = readQueryParams(queryKey);
  const rawSymbols = typeof params?.symbols === "string" ? params.symbols : "";
  return normalizeSymbols(rawSymbols.split(","));
};

const readQuoteTimestampMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === "string" || typeof value === "number") {
    const timestamp = Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return null;
};

const readQuoteReceivedAtMs = (quote: QuoteSnapshot | undefined): number | null => {
  const latency = quote?.latency;
  return readQuoteTimestampMs(
    latency && typeof latency === "object"
      ? latency.apiServerReceivedAt ?? latency.apiServerEmittedAt
      : null,
  );
};

const QUOTE_VALUE_FIELDS: Array<keyof QuoteSnapshot> = [
  "price",
  "bid",
  "ask",
  "change",
  "changePercent",
  "open",
  "high",
  "low",
  "prevClose",
  "volume",
  "delayed",
  "freshness",
  "marketDataMode",
  "source",
  "transport",
];

const hasSameTimestampQuoteConflict = (
  incoming: QuoteSnapshot,
  current: QuoteSnapshot,
): boolean =>
  QUOTE_VALUE_FIELDS.some((field) => {
    const currentValue = current[field];
    const incomingValue = incoming[field];
    return (
      currentValue !== undefined &&
      currentValue !== null &&
      incomingValue !== undefined &&
      incomingValue !== null &&
      !Object.is(currentValue, incomingValue)
    );
  });

export const isQuoteSnapshotAtLeastAsFresh = (
  incoming: QuoteSnapshot,
  current: QuoteSnapshot | undefined,
): boolean => {
  if (!current) {
    return true;
  }

  const incomingUpdatedAt =
    readQuoteTimestampMs(incoming.dataUpdatedAt) ??
    readQuoteTimestampMs(incoming.updatedAt);
  const currentUpdatedAt =
    readQuoteTimestampMs(current.dataUpdatedAt) ??
    readQuoteTimestampMs(current.updatedAt);

  if (incomingUpdatedAt !== null && currentUpdatedAt !== null) {
    if (incomingUpdatedAt > currentUpdatedAt) {
      return true;
    }
    if (incomingUpdatedAt < currentUpdatedAt) {
      return false;
    }
    const incomingWrapperUpdatedAt = readQuoteTimestampMs(incoming.updatedAt);
    const currentWrapperUpdatedAt = readQuoteTimestampMs(current.updatedAt);
    if (incomingWrapperUpdatedAt !== null && currentWrapperUpdatedAt !== null) {
      if (incomingWrapperUpdatedAt > currentWrapperUpdatedAt) {
        return true;
      }
      if (incomingWrapperUpdatedAt < currentWrapperUpdatedAt) {
        return false;
      }
    }
  } else if (incomingUpdatedAt === null && currentUpdatedAt !== null) {
    return false;
  } else if (incomingUpdatedAt !== null && currentUpdatedAt === null) {
    return true;
  }

  const incomingReceivedAt = readQuoteReceivedAtMs(incoming);
  const currentReceivedAt = readQuoteReceivedAtMs(current);
  if (incomingReceivedAt !== null && currentReceivedAt !== null) {
    return incomingReceivedAt >= currentReceivedAt;
  }
  return !hasSameTimestampQuoteConflict(incoming, current);
};

const collectLatestCachedQuotesBySymbol = (
  queryClient: ReturnType<typeof useQueryClient>,
): Map<string, QuoteSnapshot> => {
  const latestBySymbol = new Map<string, QuoteSnapshot>();
  queryClient
    .getQueryCache()
    .findAll({ queryKey: ["/api/quotes/snapshot"] })
    .forEach((query) => {
      const data = query.state.data as QuoteSnapshotsResponse | undefined;
      (data?.quotes || []).forEach((quote) => {
        const symbol = quote.symbol?.toUpperCase?.();
        if (!symbol) {
          return;
        }
        const current = latestBySymbol.get(symbol);
        if (isQuoteSnapshotAtLeastAsFresh(quote, current)) {
          latestBySymbol.set(symbol, quote);
        }
      });
    });
  return latestBySymbol;
};

const filterAcceptedQuoteSnapshots = (
  incomingQuotes: QuoteSnapshot[],
  latestBySymbol: Map<string, QuoteSnapshot>,
): QuoteSnapshot[] => (
  incomingQuotes.filter((quote) => {
    const symbol = quote.symbol?.toUpperCase?.();
    if (!symbol) {
      return false;
    }
    return isQuoteSnapshotAtLeastAsFresh(quote, latestBySymbol.get(symbol));
  })
);

const matchesMode = (
  params: Record<string, unknown> | null,
  mode: StreamMode,
): boolean => {
  const requestedMode =
    typeof params?.mode === "string" ? params.mode.toLowerCase() : null;
  return !requestedMode || requestedMode === mode;
};

const queryKeyPath = (queryKey: unknown): string | null =>
  Array.isArray(queryKey) && typeof queryKey[0] === "string"
    ? queryKey[0]
    : null;

const accountScopedPrefix = (accountId: string): string =>
  `/api/accounts/${accountId}`;

const normalizeAccountAssetClass = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "all") return "all";
  if (normalized === "option" || normalized === "options" || normalized === "opt") {
    return "option";
  }
  if (normalized === "etf" || normalized === "etfs" || normalized === "fund") {
    return "etf";
  }
  if (
    normalized === "stock" ||
    normalized === "stocks" ||
    normalized === "stk"
  ) {
    return "stock";
  }
  if (
    normalized === "equity" ||
    normalized === "equities"
  ) {
    return "equity";
  }
  return normalized;
};

const invalidateAccountScopedQueries = (
  queryClient: ReturnType<typeof useQueryClient>,
  accountIds: string[],
  mode: StreamMode,
  resourceNames?: Set<string>,
) => {
  const normalizedAccountIds = Array.from(
    new Set(accountIds.map((accountId) => accountId?.trim?.()).filter(Boolean)),
  );

  if (!normalizedAccountIds.length) {
    return;
  }

  queryClient.invalidateQueries({
    predicate: (query) => {
      const path = queryKeyPath(query.queryKey);
      if (!path) {
        return false;
      }

      const matchedAccountId = normalizedAccountIds.find((accountId) =>
        path.startsWith(`${accountScopedPrefix(accountId)}/`),
      );
      if (!matchedAccountId) {
        return false;
      }

      if (!matchesMode(readQueryParams(query.queryKey), mode)) {
        return false;
      }

      if (!resourceNames?.size) {
        return true;
      }

      const resourceName = path.slice(
        `${accountScopedPrefix(matchedAccountId)}/`.length,
      );
      return resourceNames.has(resourceName);
    },
  });
};

export const invalidateVisibleAccountDerivedQueries = (
  queryClient: ReturnType<typeof useQueryClient>,
  accountIds: string[],
  mode: StreamMode,
  options: { includeEquityHistory?: boolean } = {},
) => {
  const includeEquityHistory = options.includeEquityHistory ?? true;
  invalidateAccountScopedQueries(
    queryClient,
    accountIds,
    mode,
    new Set([
      "summary",
      "positions",
      "orders",
      "allocation",
      "risk",
      "cash-activity",
      "closed-trades",
      ...(includeEquityHistory ? ["equity-history"] : []),
    ]),
  );
};

const accountIdsFromAccountPayload = (
  accounts: AccountsResponse["accounts"],
  requestedAccountId?: string | null,
): string[] => [
  "combined",
  ...(requestedAccountId ? [requestedAccountId] : []),
  ...accounts.map((account) => account.id).filter(Boolean),
];

const ACCOUNT_HISTORY_RANGES = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "ALL",
] as const;

type AccountHistoryRangeValue = (typeof ACCOUNT_HISTORY_RANGES)[number];

const normalizeAccountHistoryRange = (
  value: unknown,
): AccountHistoryRangeValue | null =>
  typeof value === "string" &&
  ACCOUNT_HISTORY_RANGES.includes(value as AccountHistoryRangeValue)
    ? (value as AccountHistoryRangeValue)
    : null;

const accountHistoryRangeStartMs = (
  range: AccountHistoryRangeValue,
  nowMs: number,
): number | null => {
  const start = new Date(nowMs);
  switch (range) {
    case "1D":
      return nowMs - 24 * 60 * 60_000;
    case "1W":
      start.setUTCDate(start.getUTCDate() - 7);
      return start.getTime();
    case "1M":
      start.setUTCMonth(start.getUTCMonth() - 1);
      return start.getTime();
    case "3M":
      start.setUTCMonth(start.getUTCMonth() - 3);
      return start.getTime();
    case "6M":
      start.setUTCMonth(start.getUTCMonth() - 6);
      return start.getTime();
    case "YTD":
      return Date.UTC(start.getUTCFullYear(), 0, 1);
    case "1Y":
      start.setUTCFullYear(start.getUTCFullYear() - 1);
      return start.getTime();
    case "ALL":
      return null;
  }
};

const parseAccountTimestampMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const timestamp = Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
};

const accountsForScopedAccountId = (
  accounts: AccountsResponse["accounts"],
  accountId: string,
): AccountsResponse["accounts"] =>
  accountId === "combined"
    ? accounts
    : accounts.filter(
        (account) =>
          account.id === accountId || account.providerAccountId === accountId,
      );

const sumAccountField = (
  accounts: AccountsResponse["accounts"],
  field: keyof BrokerAccount,
): number | null => {
  const values = accounts
    .map((account) => account[field])
    .filter((value): value is number => isFiniteNumber(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
};

const latestAccountUpdatedAtMs = (
  accounts: AccountsResponse["accounts"],
): number | null =>
  accounts.reduce<number | null>((latest, account) => {
    const timestamp = parseAccountTimestampMs(account.updatedAt);
    if (timestamp === null) {
      return latest;
    }
    return latest === null ? timestamp : Math.max(latest, timestamp);
  }, null);

const accountIdFromScopedPath = (
  path: string | null,
  resourceName: string,
): string | null => {
  const match = path?.match(/^\/api\/accounts\/([^/]+)\/([^/]+)$/);
  return match?.[2] === resourceName ? decodeURIComponent(match[1] || "") : null;
};

const pointTimestampMs = (point: Pick<AccountEquityPoint, "timestamp">): number | null =>
  parseAccountTimestampMs(point.timestamp);

const recomputeEquityReturns = (
  points: AccountEquityPoint[],
): AccountEquityPoint[] => {
  const adjusted = calculateTransferAdjustedReturnSeries(points);
  return points.map((point, index) => ({
    ...point,
    returnPercent: adjusted[index]?.returnPercent ?? 0,
  }));
};

const upsertLiveEquityTerminalPoint = (
  current: LiveAccountEquityHistoryResponse | undefined,
  payload: AccountStreamPayload,
  accountId: string,
  requestedRange: AccountHistoryRangeValue,
): LiveAccountEquityHistoryResponse | undefined => {
  if (!current || current.range !== requestedRange) {
    return current;
  }

  const scopedAccounts = accountsForScopedAccountId(payload.accounts, accountId);
  if (!scopedAccounts.length) {
    return current;
  }

  const netLiquidation = sumAccountField(scopedAccounts, "netLiquidation");
  const timestampMs = latestAccountUpdatedAtMs(scopedAccounts);
  if (netLiquidation === null || timestampMs === null) {
    return current;
  }

  const rangeStartMs = accountHistoryRangeStartMs(requestedRange, timestampMs);
  if (rangeStartMs !== null && timestampMs < rangeStartMs) {
    return current;
  }

  const timestamp = new Date(timestampMs).toISOString();
  const existingPoints = current.points || [];
  const exactMatchIndex = existingPoints.findIndex(
    (point) => pointTimestampMs(point) === timestampMs,
  );
  const lastPoint = existingPoints[existingPoints.length - 1] ?? null;
  const lastPointTimestampMs = lastPoint ? pointTimestampMs(lastPoint) : null;
  if (
    exactMatchIndex < 0 &&
    lastPointTimestampMs !== null &&
    timestampMs < lastPointTimestampMs
  ) {
    return current;
  }

  const currency = scopedAccounts[0]?.currency || current.currency || "USD";
  const previousTerminal =
    exactMatchIndex >= 0
      ? existingPoints[exactMatchIndex]
      : lastPoint?.source === "IBKR_ACCOUNT_SUMMARY"
        ? lastPoint
        : null;
  const livePoint: AccountEquityPoint = {
    timestamp,
    netLiquidation,
    currency,
    source: "IBKR_ACCOUNT_SUMMARY",
    deposits: previousTerminal?.deposits ?? 0,
    withdrawals: previousTerminal?.withdrawals ?? 0,
    dividends: previousTerminal?.dividends ?? 0,
    fees: previousTerminal?.fees ?? 0,
    returnPercent: previousTerminal?.returnPercent ?? 0,
    benchmarkPercent: previousTerminal?.benchmarkPercent ?? null,
  };

  const withoutPreviousTerminal = existingPoints.filter((point, index) => {
    if (exactMatchIndex >= 0) {
      return index !== exactMatchIndex;
    }
    return point !== previousTerminal;
  });
  const nextPoints = recomputeEquityReturns(
    [...withoutPreviousTerminal, livePoint]
      .filter((point) => {
        const pointMs = pointTimestampMs(point);
        return (
          pointMs !== null &&
          (rangeStartMs === null || pointMs >= rangeStartMs)
        );
      })
      .sort((left, right) => {
        const leftMs = pointTimestampMs(left) ?? 0;
        const rightMs = pointTimestampMs(right) ?? 0;
        return leftMs - rightMs;
      }),
  );

  return {
    ...current,
    currency,
    asOf: timestamp,
    isStale: false,
    staleReason: null,
    terminalPointSource: "live_account_summary",
    liveTerminalIncluded: true,
    points: nextPoints,
  };
};

const accountPageEquityPointSource = (
  source: unknown,
): AccountEquityPoint["source"] => {
  if (source === "SHADOW_LEDGER") {
    return "SHADOW_LEDGER";
  }
  if (source === "LOCAL_LEDGER") {
    return "LOCAL_LEDGER";
  }
  if (source === "FLEX") {
    return "FLEX";
  }
  return "IBKR_ACCOUNT_SUMMARY";
};

const accountPageTerminalPointSource = (
  source: AccountEquityPoint["source"],
): AccountEquityHistoryResponse["terminalPointSource"] =>
  source === "SHADOW_LEDGER" ? "shadow_ledger" : "live_account_summary";

const upsertAccountPageLiveEquityTerminalPoint = (
  current: LiveAccountEquityHistoryResponse | undefined,
  payload: AccountPageLivePayload,
  requestedRange: AccountHistoryRangeValue,
): LiveAccountEquityHistoryResponse | undefined => {
  if (!current || current.range !== requestedRange) {
    return current;
  }

  const netLiquidationMetric = payload.summary?.metrics?.netLiquidation;
  const netLiquidation = isFiniteNumber(netLiquidationMetric?.value)
    ? Number(netLiquidationMetric?.value)
    : null;
  const timestampMs =
    parseAccountTimestampMs(netLiquidationMetric?.updatedAt) ??
    parseAccountTimestampMs(payload.summary?.updatedAt) ??
    parseAccountTimestampMs(payload.updatedAt);
  if (netLiquidation === null || timestampMs === null) {
    return current;
  }

  const rangeStartMs = accountHistoryRangeStartMs(requestedRange, timestampMs);
  if (rangeStartMs !== null && timestampMs < rangeStartMs) {
    return current;
  }

  const timestamp = new Date(timestampMs).toISOString();
  const existingPoints = current.points || [];
  const exactMatchIndex = existingPoints.findIndex(
    (point) => pointTimestampMs(point) === timestampMs,
  );
  const lastPoint = existingPoints[existingPoints.length - 1] ?? null;
  const lastPointTimestampMs = lastPoint ? pointTimestampMs(lastPoint) : null;
  if (
    exactMatchIndex < 0 &&
    lastPointTimestampMs !== null &&
    timestampMs < lastPointTimestampMs
  ) {
    return current;
  }

  const currentAsOfMs = parseAccountTimestampMs(current.asOf);
  const previousTerminal =
    exactMatchIndex >= 0
      ? existingPoints[exactMatchIndex]
      : current.liveTerminalIncluded === true &&
          lastPointTimestampMs !== null &&
          currentAsOfMs === lastPointTimestampMs
        ? lastPoint
        : null;
  const source = accountPageEquityPointSource(netLiquidationMetric?.source);
  const terminalPointSource = accountPageTerminalPointSource(source);
  const currency =
    netLiquidationMetric?.currency || payload.summary?.currency || current.currency || "USD";
  const livePoint: AccountEquityPoint = {
    timestamp,
    netLiquidation,
    currency,
    source,
    deposits: previousTerminal?.deposits ?? 0,
    withdrawals: previousTerminal?.withdrawals ?? 0,
    dividends: previousTerminal?.dividends ?? 0,
    fees: previousTerminal?.fees ?? 0,
    returnPercent: previousTerminal?.returnPercent ?? 0,
    benchmarkPercent: previousTerminal?.benchmarkPercent ?? null,
  };

  const withoutPreviousTerminal = existingPoints.filter((point, index) => {
    if (exactMatchIndex >= 0) {
      return index !== exactMatchIndex;
    }
    return point !== previousTerminal;
  });
  const nextPoints = recomputeEquityReturns(
    [...withoutPreviousTerminal, livePoint]
      .filter((point) => {
        const pointMs = pointTimestampMs(point);
        return (
          pointMs !== null &&
          (rangeStartMs === null || pointMs >= rangeStartMs)
        );
      })
      .sort((left, right) => {
        const leftMs = pointTimestampMs(left) ?? 0;
        const rightMs = pointTimestampMs(right) ?? 0;
        return leftMs - rightMs;
      }),
  );

  return {
    ...current,
    currency,
    asOf: timestamp,
    isStale: false,
    staleReason: null,
    terminalPointSource,
    liveTerminalIncluded: true,
    points: nextPoints,
  };
};

const mergeDerivedAccountPageEquityHistory = (
  current: LiveAccountEquityHistoryResponse | undefined,
  incoming: AccountEquityHistoryResponse,
): AccountEquityHistoryResponse => {
  if (!current?.liveTerminalIncluded || current.range !== incoming.range) {
    return reuseEqualJson(current, incoming);
  }

  const currentPoints = current.points || [];
  const incomingPoints = incoming.points || [];
  const terminalPoint = currentPoints[currentPoints.length - 1] ?? null;
  const terminalMs = terminalPoint ? pointTimestampMs(terminalPoint) : null;
  if (terminalMs === null) {
    return reuseEqualJson(current, incoming);
  }

  const incomingMaxMs = incomingPoints.reduce<number | null>((max, point) => {
    const pointMs = pointTimestampMs(point);
    if (pointMs === null) {
      return max;
    }
    return max === null ? pointMs : Math.max(max, pointMs);
  }, null);
  if (incomingMaxMs !== null && incomingMaxMs >= terminalMs) {
    return reuseEqualJson(current, incoming);
  }

  const nextPoints = recomputeEquityReturns(
    [...incomingPoints, terminalPoint]
      .filter((point) => pointTimestampMs(point) !== null)
      .sort((left, right) => {
        const leftMs = pointTimestampMs(left) ?? 0;
        const rightMs = pointTimestampMs(right) ?? 0;
        return leftMs - rightMs;
      }),
  );

  return reuseEqualJson(current, {
    ...incoming,
    currency: incoming.currency || current.currency,
    asOf: current.asOf ?? incoming.asOf,
    isStale: current.isStale ?? incoming.isStale,
    staleReason: current.staleReason ?? incoming.staleReason,
    terminalPointSource: current.terminalPointSource,
    liveTerminalIncluded: true,
    points: nextPoints,
  });
};

const patchAccountSummaryFromStream = (
  current: AccountSummaryResponse | undefined,
  payload: AccountStreamPayload,
  accountId: string,
): AccountSummaryResponse | undefined => {
  if (!current) {
    return current;
  }

  const scopedAccounts = accountsForScopedAccountId(payload.accounts, accountId);
  if (!scopedAccounts.length) {
    return current;
  }

  const timestampMs = latestAccountUpdatedAtMs(scopedAccounts);
  const updatedAt = timestampMs ? new Date(timestampMs).toISOString() : current.updatedAt;
  const currency = scopedAccounts[0]?.currency || current.currency;
  const netLiquidation = sumAccountField(scopedAccounts, "netLiquidation");
  const totalCash = sumAccountField(scopedAccounts, "cash");
  const buyingPower = sumAccountField(scopedAccounts, "buyingPower");

  return {
    ...current,
    currency,
    updatedAt,
    metrics: {
      ...current.metrics,
      ...(netLiquidation !== null
        ? {
            netLiquidation: {
              ...(current.metrics.netLiquidation || {}),
              value: netLiquidation,
              currency,
              source: "IBKR_ACCOUNT_SUMMARY",
              field: "netLiquidation",
              updatedAt,
            },
          }
        : {}),
      ...(totalCash !== null
        ? {
            totalCash: {
              ...(current.metrics.totalCash || {}),
              value: totalCash,
              currency,
              source: "IBKR_ACCOUNT_SUMMARY",
              field: "cash",
              updatedAt,
            },
          }
        : {}),
      ...(buyingPower !== null
        ? {
            buyingPower: {
              ...(current.metrics.buyingPower || {}),
              value: buyingPower,
              currency,
              source: "IBKR_ACCOUNT_SUMMARY",
              field: "buyingPower",
              updatedAt,
            },
          }
        : {}),
    },
  };
};

const filterPositionsForQuery = (
  positions: PositionsResponse["positions"],
  queryKey: unknown,
): PositionsResponse["positions"] => {
  const params = readQueryParams(queryKey);
  const requestedAccountId =
    typeof params?.accountId === "string" ? params.accountId : null;
  return positions.filter(
    (position) => {
      const quantity = Number(position.quantity);
      return (
        (!Number.isFinite(quantity) || Math.abs(quantity) > 1e-9) &&
        (!requestedAccountId || position.accountId === requestedAccountId)
      );
    },
  );
};

const filterOrdersForQuery = (
  orders: OrdersResponse["orders"],
  queryKey: unknown,
): OrdersResponse["orders"] => {
  const params = readQueryParams(queryKey);
  const requestedAccountId =
    typeof params?.accountId === "string" ? params.accountId : null;
  const requestedStatus =
    typeof params?.status === "string" ? params.status : null;
  return orders.filter((order) => {
    if (requestedAccountId && order.accountId !== requestedAccountId) {
      return false;
    }
    if (requestedStatus && order.status !== requestedStatus) {
      return false;
    }
    return true;
  });
};

type StreamPosition = PositionsResponse["positions"][number];
type AccountPositionRow = AccountPositionsResponse["positions"][number];
type StreamOrder = OrdersResponse["orders"][number];
type AccountOrderRow = AccountOrdersResponse["orders"][number];

type AccountLiveSlice = {
  summary: AccountSummaryResponse | null;
  positions: AccountPositionsResponse | null;
  orders: AccountOrdersResponse | null;
  positionRowsById: Map<string, AccountPositionRow>;
  positionRowsBySymbol: Map<string, AccountPositionRow>;
  orderRowsById: Map<string, AccountOrderRow>;
  updatedAt: string | null;
};

type AccountLiveScope = {
  accountId?: string | null;
  mode?: StreamMode | null;
};

type AccountPositionRowSelectorInput = AccountLiveScope & {
  rowId?: string | null;
  symbol?: string | null;
  enabled?: boolean;
};

type AccountOrderRowSelectorInput = AccountLiveScope & {
  rowId?: string | null;
  enabled?: boolean;
};

type AccountSummaryFieldSelectorInput = AccountLiveScope & {
  fieldName?: string | null;
  enabled?: boolean;
};

type BrokerFreshnessForSnapshot = {
  lastEventAt: number | null;
  fresh: boolean;
};

const INTERNAL_SHADOW_ACCOUNT_ID = "shadow";

const isInternalShadowAccountId = (accountId?: string | null): boolean =>
  String(accountId ?? "").trim().toLowerCase() === INTERNAL_SHADOW_ACCOUNT_ID;

const accountLiveSlices = new Map<string, AccountLiveSlice>();
const accountLiveSliceListeners = new Set<() => void>();
const brokerFreshnessForCache = new Map<string, BrokerFreshnessForSnapshot>();

const noopSubscribe = (_listener: () => void) => () => {};

const accountLiveScopeKey = (scope: AccountLiveScope): string | null => {
  if (!scope.accountId || !scope.mode) {
    return null;
  }
  return `${scope.mode}:${scope.accountId}`;
};

const valuesEqualJson = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const reuseEqualJson = <T>(current: T | undefined, next: T): T => {
  if (current !== undefined && valuesEqualJson(current, next)) {
    return current;
  }
  return next;
};

const isDegradedAccountResponse = (value: unknown): boolean =>
  Boolean(
    value &&
      typeof value === "object" &&
      ((value as { degraded?: unknown }).degraded === true ||
        (value as { activityDegraded?: unknown }).activityDegraded === true),
  );

const preferNonDegradedAccountResponse = <T>(current: T | undefined, next: T): T => {
  if (
    isDegradedAccountResponse(next) &&
    current &&
    !isDegradedAccountResponse(current)
  ) {
    return current;
  }
  return reuseEqualJson(current, next);
};

const preferUsableClosedTradesResponse = (
  current: AccountClosedTradesResponse | undefined,
  next: AccountClosedTradesResponse,
): AccountClosedTradesResponse | undefined => {
  if (
    isDegradedAccountResponse(next) &&
    (!Array.isArray(next.trades) || next.trades.length === 0)
  ) {
    return current;
  }
  return reuseEqualJson(current, next);
};

const rowIdOf = (row: { id?: unknown }): string | null => {
  const id = row?.id;
  return id == null ? null : String(id);
};

const mergeStableRowsById = <T extends { id?: unknown }>(
  currentRows: T[] | undefined,
  nextRows: T[] | undefined,
): T[] => {
  const current = currentRows || [];
  const next = nextRows || [];
  if (!current.length) {
    return next;
  }

  const currentById = new Map<string, T>();
  current.forEach((row) => {
    const id = rowIdOf(row);
    if (id) {
      currentById.set(id, row);
    }
  });

  let allRowsUnchangedInPlace = current.length === next.length;
  const merged = next.map((row, index) => {
    const id = rowIdOf(row);
    const previous = id ? currentById.get(id) : undefined;
    const resolved = previous && valuesEqualJson(previous, row) ? previous : row;
    if (resolved !== current[index]) {
      allRowsUnchangedInPlace = false;
    }
    return resolved;
  });

  return allRowsUnchangedInPlace ? current : merged;
};

const quotePatchTimestampMs = (
  quote: AccountOptionQuotePatch | null | undefined,
): number | null =>
  getUpdatedAtTime(
    typeof quote?.dataUpdatedAt === "string" && quote.dataUpdatedAt
      ? quote.dataUpdatedAt
      : typeof quote?.updatedAt === "string"
        ? quote.updatedAt
        : null,
  );

const quotePatchHasUsableOptionData = (
  quote: AccountOptionQuotePatch | null | undefined,
): boolean =>
  Boolean(
    quote &&
      [
        quote.bid,
        quote.ask,
        quote.mid,
        quote.mark,
        quote.last,
        quote.price,
        quote.dayChange,
        quote.dayChangePercent,
        quote.openInterest,
        quote.underlyingPrice,
        quote.volume,
        quote.impliedVolatility,
        quote.delta,
        quote.gamma,
        quote.theta,
        quote.vega,
      ].some((value) => finiteOptionNumber(value) !== null),
  );

const quotePatchHasMarketQuote = (
  quote: AccountOptionQuotePatch | null | undefined,
): boolean =>
  Boolean(
    quote &&
      [quote.bid, quote.ask, quote.mid].some(
        (value) => finiteOptionNumber(value) !== null,
      ),
  );

const quotePatchForPositionRow = (
  row: AccountPositionRow | undefined,
): AccountOptionQuotePatch | null => {
  if (!row) {
    return null;
  }
  const rowWithOptionQuote = row as AccountPositionRowWithOptionQuote;
  const quote = row.quote as AccountOptionQuotePatch | null | undefined;
  const optionQuote = rowWithOptionQuote.optionQuote;
  if (!quote && !optionQuote) {
    return null;
  }
  return {
    ...(quote || {}),
    ...(optionQuote || {}),
  };
};

const pickOptionQuoteNumber = (
  primary: AccountOptionQuotePatch | null | undefined,
  secondary: AccountOptionQuotePatch | null | undefined,
  field: string,
): number | null =>
  finiteOptionNumber(
    primary?.[field as keyof AccountOptionQuotePatch],
    secondary?.[field as keyof AccountOptionQuotePatch],
  );

const pickOptionQuoteValue = (
  primary: AccountOptionQuotePatch | null | undefined,
  secondary: AccountOptionQuotePatch | null | undefined,
  field: string,
): unknown =>
  primary?.[field as keyof AccountOptionQuotePatch] ??
  secondary?.[field as keyof AccountOptionQuotePatch] ??
  null;

const preserveHydratedOptionDayChangeFields = (
  current: AccountPositionRow,
  next: AccountPositionRow,
  candidate: AccountPositionRow,
): AccountPositionRow => {
  const currentDayChange = finiteOptionNumber(current.dayChange);
  const currentDayChangePercent = finiteOptionNumber(current.dayChangePercent);
  if (currentDayChange === null && currentDayChangePercent === null) {
    return candidate;
  }

  const nextDayChange = finiteOptionNumber(next.dayChange);
  const nextDayChangePercent = finiteOptionNumber(next.dayChangePercent);
  const candidateDayChange = finiteOptionNumber(candidate.dayChange);
  const candidateDayChangePercent = finiteOptionNumber(candidate.dayChangePercent);
  const shouldPreserveDayChange =
    candidateDayChange === null &&
    nextDayChange === null &&
    currentDayChange !== null;
  const shouldPreserveDayChangePercent =
    candidateDayChangePercent === null &&
    nextDayChangePercent === null &&
    currentDayChangePercent !== null;

  const currentOptionQuote =
    (current as AccountPositionRowWithOptionQuote).optionQuote ?? null;
  const candidateOptionQuote =
    (candidate as AccountPositionRowWithOptionQuote).optionQuote ?? null;
  const currentOptionDayChange = finiteOptionNumber(currentOptionQuote?.dayChange);
  const currentOptionDayChangePercent = finiteOptionNumber(
    currentOptionQuote?.dayChangePercent,
  );
  const candidateOptionDayChange = finiteOptionNumber(
    candidateOptionQuote?.dayChange,
  );
  const candidateOptionDayChangePercent = finiteOptionNumber(
    candidateOptionQuote?.dayChangePercent,
  );
  const shouldPreserveOptionDayChange =
    candidateOptionDayChange === null && currentOptionDayChange !== null;
  const shouldPreserveOptionDayChangePercent =
    candidateOptionDayChangePercent === null &&
    currentOptionDayChangePercent !== null;

  if (
    !shouldPreserveDayChange &&
    !shouldPreserveDayChangePercent &&
    !shouldPreserveOptionDayChange &&
    !shouldPreserveOptionDayChangePercent
  ) {
    return candidate;
  }

  const optionQuote =
    shouldPreserveOptionDayChange || shouldPreserveOptionDayChangePercent
      ? {
          ...(candidateOptionQuote || {}),
          providerContractId:
            candidateOptionQuote?.providerContractId ??
            currentOptionQuote?.providerContractId ??
            optionPositionProviderContractId(candidate),
          dayChange: shouldPreserveOptionDayChange
            ? currentOptionQuote?.dayChange
            : candidateOptionQuote?.dayChange,
          dayChangePercent: shouldPreserveOptionDayChangePercent
            ? currentOptionQuote?.dayChangePercent
            : candidateOptionQuote?.dayChangePercent,
        }
      : candidateOptionQuote;

  return {
    ...candidate,
    dayChange: shouldPreserveDayChange ? current.dayChange : candidate.dayChange,
    dayChangePercent: shouldPreserveDayChangePercent
      ? current.dayChangePercent
      : candidate.dayChangePercent,
    ...((shouldPreserveOptionDayChange || shouldPreserveOptionDayChangePercent) &&
    optionQuote
      ? { optionQuote }
      : {}),
  } as AccountPositionRow;
};

const preserveAccountPositionOpenDateFields = (
  current: AccountPositionRow,
  next: AccountPositionRow,
): AccountPositionRow => {
  const currentOpenedAt = current.openedAt ?? null;
  const nextOpenedAt = next.openedAt ?? null;
  const openedAt = nextOpenedAt ?? currentOpenedAt;
  const openedAtSource =
    next.openedAtSource ??
    (openedAt === currentOpenedAt ? current.openedAtSource ?? null : null);

  if (openedAt === nextOpenedAt && openedAtSource === next.openedAtSource) {
    return next;
  }

  return {
    ...next,
    openedAt,
    openedAtSource,
  };
};

const mergeLiveOptionQuoteFields = (
  current: AccountPositionRow,
  next: AccountPositionRow,
): AccountPositionRow => {
  const nextWithOpenDate = preserveAccountPositionOpenDateFields(current, next);
  const currentProviderContractId = optionPositionProviderContractId(current);
  const nextProviderContractId = optionPositionProviderContractId(nextWithOpenDate);
  const providerContractId = nextProviderContractId || currentProviderContractId;
  if (
    !providerContractId ||
    (currentProviderContractId &&
      nextProviderContractId &&
      currentProviderContractId !== nextProviderContractId)
  ) {
    return nextWithOpenDate;
  }

  const currentQuote = quotePatchForPositionRow(current);
  if (!quotePatchHasUsableOptionData(currentQuote)) {
    return preserveHydratedOptionDayChangeFields(
      current,
      nextWithOpenDate,
      nextWithOpenDate,
    );
  }

  const nextQuote = quotePatchForPositionRow(nextWithOpenDate);
  const currentTimestamp = quotePatchTimestampMs(currentQuote);
  const nextTimestamp = quotePatchTimestampMs(nextQuote);
  const currentIsNewer =
    currentTimestamp !== null &&
    nextTimestamp !== null &&
    currentTimestamp > nextTimestamp;
  const preferCurrent =
    !quotePatchHasUsableOptionData(nextQuote) || currentIsNewer;
  const primary = preferCurrent ? currentQuote : nextQuote;
  const secondary = preferCurrent ? nextQuote : currentQuote;
  const providerQuote = quotePatchHasMarketQuote(primary)
    ? primary
    : quotePatchHasMarketQuote(secondary)
      ? secondary
      : primary ?? secondary;
  const supportedProviderContractIds = new Set([
    ...optionPositionProviderContractIds(current),
    ...optionPositionProviderContractIds(nextWithOpenDate),
  ]);
  const mergedProviderContractId =
    [
      normalizeProviderContractId(providerQuote?.providerContractId),
      normalizeProviderContractId(primary?.providerContractId),
      normalizeProviderContractId(secondary?.providerContractId),
      nextProviderContractId,
      currentProviderContractId,
    ].find((candidate) => candidate && supportedProviderContractIds.has(candidate)) ||
    providerContractId;
  const updatedAt =
    currentIsNewer || !nextTimestamp
      ? currentQuote?.updatedAt ?? nextQuote?.updatedAt ?? null
      : nextQuote?.updatedAt ?? currentQuote?.updatedAt ?? null;
  const dataUpdatedAt =
    currentIsNewer || !nextTimestamp
      ? currentQuote?.dataUpdatedAt ?? nextQuote?.dataUpdatedAt ?? null
      : nextQuote?.dataUpdatedAt ?? currentQuote?.dataUpdatedAt ?? null;
  const quoteSource = pickOptionQuoteValue(primary, secondary, "source");
  const mergedQuote = {
    ...(secondary || {}),
    ...(primary || {}),
    providerContractId: mergedProviderContractId,
    bid: pickOptionQuoteNumber(primary, secondary, "bid"),
    ask: pickOptionQuoteNumber(primary, secondary, "ask"),
    mid:
      pickOptionQuoteNumber(primary, secondary, "mid") ??
      optionQuoteMidpoint(
        pickOptionQuoteNumber(primary, secondary, "bid"),
        pickOptionQuoteNumber(primary, secondary, "ask"),
      ),
    last: pickOptionQuoteNumber(primary, secondary, "last"),
    price: pickOptionQuoteNumber(primary, secondary, "price"),
    mark: pickOptionQuoteNumber(primary, secondary, "mark"),
    spread: pickOptionQuoteNumber(primary, secondary, "spread"),
    spreadPercent: pickOptionQuoteNumber(primary, secondary, "spreadPercent"),
    dayChange: pickOptionQuoteNumber(primary, secondary, "dayChange"),
    dayChangePercent: pickOptionQuoteNumber(
      primary,
      secondary,
      "dayChangePercent",
    ),
    bidSize: pickOptionQuoteNumber(primary, secondary, "bidSize"),
    askSize: pickOptionQuoteNumber(primary, secondary, "askSize"),
    volume: pickOptionQuoteNumber(primary, secondary, "volume"),
    openInterest: pickOptionQuoteNumber(primary, secondary, "openInterest"),
    impliedVolatility: pickOptionQuoteNumber(
      primary,
      secondary,
      "impliedVolatility",
    ),
    delta: pickOptionQuoteNumber(primary, secondary, "delta"),
    gamma: pickOptionQuoteNumber(primary, secondary, "gamma"),
    theta: pickOptionQuoteNumber(primary, secondary, "theta"),
    vega: pickOptionQuoteNumber(primary, secondary, "vega"),
    underlyingPrice: pickOptionQuoteNumber(primary, secondary, "underlyingPrice"),
    freshness: pickOptionQuoteValue(primary, secondary, "freshness"),
    status:
      pickOptionQuoteValue(primary, secondary, "status") ??
      pickOptionQuoteValue(primary, secondary, "quoteStatus"),
    reason:
      pickOptionQuoteValue(primary, secondary, "reason") ??
      pickOptionQuoteValue(primary, secondary, "quoteReason"),
    quoteStatus:
      pickOptionQuoteValue(primary, secondary, "quoteStatus") ??
      pickOptionQuoteValue(primary, secondary, "status"),
    quoteReason: pickOptionQuoteValue(primary, secondary, "quoteReason"),
    greeksStatus: pickOptionQuoteValue(primary, secondary, "greeksStatus"),
    greeksReason: pickOptionQuoteValue(primary, secondary, "greeksReason"),
    demandStatus: pickOptionQuoteValue(primary, secondary, "demandStatus"),
    demandReason: pickOptionQuoteValue(primary, secondary, "demandReason"),
    quoteFreshness:
      pickOptionQuoteValue(primary, secondary, "quoteFreshness") ??
      pickOptionQuoteValue(primary, secondary, "freshness"),
    greeksFreshness: pickOptionQuoteValue(primary, secondary, "greeksFreshness"),
    unavailableDetail:
      pickOptionQuoteValue(primary, secondary, "unavailableDetail") ??
      pickOptionQuoteValue(primary, secondary, "quoteReason") ??
      pickOptionQuoteValue(primary, secondary, "reason"),
    marketDataMode: pickOptionQuoteValue(primary, secondary, "marketDataMode"),
    source: quoteSource === "massive" ? "massive" : "ibkr",
    transport: pickOptionQuoteValue(primary, secondary, "transport"),
    delayed: pickOptionQuoteValue(primary, secondary, "delayed"),
    ageMs: pickOptionQuoteNumber(primary, secondary, "ageMs"),
    cacheAgeMs: pickOptionQuoteNumber(primary, secondary, "cacheAgeMs"),
    updatedAt,
    dataUpdatedAt,
  } as unknown as LiveOptionQuotePatchSnapshot;

  const patched = patchAccountPositionRowFromOptionQuote(
    nextWithOpenDate,
    mergedQuote,
  );
  if (patched !== nextWithOpenDate || !valuesEqualJson(patched, nextWithOpenDate)) {
    return preserveHydratedOptionDayChangeFields(
      current,
      nextWithOpenDate,
      patched,
    );
  }

  const nextPositionQuote =
    nextWithOpenDate.quote as AccountOptionQuotePatch | null | undefined;
  const fallbackRow = {
    ...nextWithOpenDate,
    optionQuote: mergedQuote,
    quote: {
      ...(nextWithOpenDate.quote || {}),
      bid: mergedQuote.bid ?? nextWithOpenDate.quote?.bid ?? null,
      ask: mergedQuote.ask ?? nextWithOpenDate.quote?.ask ?? null,
      mid: mergedQuote.mid ?? nextWithOpenDate.quote?.mid ?? null,
      mark: mergedQuote.mark ?? nextWithOpenDate.quote?.mark ?? null,
      last: mergedQuote.last ?? nextWithOpenDate.quote?.last ?? null,
      spread: mergedQuote.spread ?? nextWithOpenDate.quote?.spread ?? null,
      spreadPercent:
        mergedQuote.spreadPercent ?? nextWithOpenDate.quote?.spreadPercent ?? null,
      bidSize: mergedQuote.bidSize ?? nextWithOpenDate.quote?.bidSize ?? null,
      askSize: mergedQuote.askSize ?? nextWithOpenDate.quote?.askSize ?? null,
      freshness: mergedQuote.freshness ?? nextWithOpenDate.quote?.freshness ?? null,
      status:
        mergedQuote.status ??
        mergedQuote.quoteStatus ??
        nextWithOpenDate.quote?.status ??
        null,
      reason:
        mergedQuote.reason ??
        mergedQuote.quoteReason ??
        nextWithOpenDate.quote?.reason ??
        null,
      quoteStatus:
        mergedQuote.quoteStatus ??
        mergedQuote.status ??
        nextWithOpenDate.quote?.quoteStatus ??
        null,
      quoteReason:
        mergedQuote.quoteReason ?? nextWithOpenDate.quote?.quoteReason ?? null,
      greeksStatus:
        mergedQuote.greeksStatus ?? nextWithOpenDate.quote?.greeksStatus ?? null,
      greeksReason:
        mergedQuote.greeksReason ?? nextWithOpenDate.quote?.greeksReason ?? null,
      demandStatus:
        mergedQuote.demandStatus ?? nextWithOpenDate.quote?.demandStatus ?? null,
      demandReason:
        mergedQuote.demandReason ?? nextWithOpenDate.quote?.demandReason ?? null,
      quoteFreshness:
        mergedQuote.quoteFreshness ??
        mergedQuote.freshness ??
        nextWithOpenDate.quote?.quoteFreshness ??
        null,
      greeksFreshness:
        mergedQuote.greeksFreshness ??
        nextWithOpenDate.quote?.greeksFreshness ??
        null,
      unavailableDetail:
        mergedQuote.unavailableDetail ??
        mergedQuote.quoteReason ??
        mergedQuote.reason ??
        nextWithOpenDate.quote?.unavailableDetail ??
        null,
      marketDataMode:
        mergedQuote.marketDataMode ?? nextWithOpenDate.quote?.marketDataMode ?? null,
      source: optionQuotePositionSource(mergedQuote.source),
      updatedAt: mergedQuote.updatedAt ?? nextWithOpenDate.quote?.updatedAt ?? null,
      dataUpdatedAt:
        mergedQuote.dataUpdatedAt ?? nextWithOpenDate.quote?.dataUpdatedAt ?? null,
      ageMs: mergedQuote.ageMs ?? nextWithOpenDate.quote?.ageMs ?? null,
      cacheAgeMs:
        mergedQuote.cacheAgeMs ?? nextWithOpenDate.quote?.cacheAgeMs ?? null,
      underlyingPrice:
        mergedQuote.underlyingPrice ?? nextPositionQuote?.underlyingPrice ?? null,
    },
  };
  return preserveHydratedOptionDayChangeFields(
    current,
    nextWithOpenDate,
    fallbackRow as AccountPositionRow,
  );
};

const mergeAccountPositionRowsById = (
  currentRows: AccountPositionRow[] | undefined,
  nextRows: AccountPositionRow[] | undefined,
): AccountPositionRow[] => {
  const current = currentRows || [];
  const next = nextRows || [];
  if (!current.length) {
    return next;
  }

  const currentById = new Map<string, AccountPositionRow>();
  current.forEach((row) => {
    const id = rowIdOf(row);
    if (id) {
      currentById.set(id, row);
    }
  });

  let allRowsUnchangedInPlace = current.length === next.length;
  const merged = next.map((row, index) => {
    const id = rowIdOf(row);
    const previous = id ? currentById.get(id) : undefined;
    const candidate = previous ? mergeLiveOptionQuoteFields(previous, row) : row;
    const resolved =
      previous && valuesEqualJson(previous, candidate) ? previous : candidate;
    if (resolved !== current[index]) {
      allRowsUnchangedInPlace = false;
    }
    return resolved;
  });

  return allRowsUnchangedInPlace ? current : merged;
};

const maybeReuseAccountPositionsResponse = (
  current: AccountPositionsResponse | undefined,
  next: AccountPositionsResponse,
): AccountPositionsResponse => {
  if (!current) {
    return next;
  }
  const positions = mergeAccountPositionRowsById(
    current.positions,
    next.positions,
  );
  const merged =
    positions === next.positions
      ? next
      : {
          ...next,
          positions,
        };
  return reuseEqualJson(current, merged);
};

const maybeReuseAccountOrdersResponse = (
  current: AccountOrdersResponse | undefined,
  next: AccountOrdersResponse,
): AccountOrdersResponse => {
  if (!current) {
    return next;
  }
  const orders = mergeStableRowsById(current.orders, next.orders);
  const merged =
    orders === next.orders
      ? next
      : {
          ...next,
          orders,
        };
  return reuseEqualJson(current, merged);
};

const indexPositionRowsById = (
  rows: AccountPositionRow[] | undefined,
): Map<string, AccountPositionRow> => {
  const indexed = new Map<string, AccountPositionRow>();
  (rows || []).forEach((row) => {
    const id = rowIdOf(row);
    if (id) {
      indexed.set(id, row);
    }
  });
  return indexed;
};

const indexPositionRowsBySymbol = (
  rows: AccountPositionRow[] | undefined,
): Map<string, AccountPositionRow> => {
  const indexed = new Map<string, AccountPositionRow>();
  (rows || []).forEach((row) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (symbol && !indexed.has(symbol)) {
      indexed.set(symbol, row);
    }
  });
  return indexed;
};

const indexOrderRowsById = (
  rows: AccountOrderRow[] | undefined,
): Map<string, AccountOrderRow> => {
  const indexed = new Map<string, AccountOrderRow>();
  (rows || []).forEach((row) => {
    const id = rowIdOf(row);
    if (id) {
      indexed.set(id, row);
    }
  });
  return indexed;
};

const subscribeAccountLiveSlices = (listener: () => void) => {
  accountLiveSliceListeners.add(listener);
  return () => accountLiveSliceListeners.delete(listener);
};

const emitAccountLiveSlices = () => {
  accountLiveSliceListeners.forEach((listener) => listener());
};

const applyAccountLivePayloadToSelectorStore = (
  payload: AccountPagePrimaryPayload | AccountPageLivePayload,
) => {
  const key = accountLiveScopeKey(payload);
  if (!key) {
    return;
  }

  const current = accountLiveSlices.get(key);
  const summary = reuseEqualJson(current?.summary ?? undefined, payload.summary);
  const positions = maybeReuseAccountPositionsResponse(
    current?.positions ?? undefined,
    payload.positions,
  );
  const orders = maybeReuseAccountOrdersResponse(
    current?.orders ?? undefined,
    payload.orders,
  );

  if (
    current &&
    current.summary === summary &&
    current.positions === positions &&
    current.orders === orders &&
    current.updatedAt === payload.updatedAt
  ) {
    return;
  }

  accountLiveSlices.set(key, {
    summary,
    positions,
    orders,
    positionRowsById: indexPositionRowsById(positions.positions),
    positionRowsBySymbol: indexPositionRowsBySymbol(positions.positions),
    orderRowsById: indexOrderRowsById(orders.orders),
    updatedAt: payload.updatedAt,
  });
  emitAccountLiveSlices();
};

export const getAccountPositionRowSnapshot = ({
  accountId,
  mode,
  rowId,
  symbol,
}: AccountPositionRowSelectorInput): AccountPositionRow | null => {
  const key = accountLiveScopeKey({ accountId, mode });
  if (!key) {
    return null;
  }

  const slice = accountLiveSlices.get(key);
  if (!slice) {
    return null;
  }

  if (rowId) {
    return slice.positionRowsById.get(String(rowId)) ?? null;
  }

  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  return normalizedSymbol
    ? slice.positionRowsBySymbol.get(normalizedSymbol) ?? null
    : null;
};

export const getAccountOrderRowSnapshot = ({
  accountId,
  mode,
  rowId,
}: AccountOrderRowSelectorInput): AccountOrderRow | null => {
  const key = accountLiveScopeKey({ accountId, mode });
  if (!key || !rowId) {
    return null;
  }
  return accountLiveSlices.get(key)?.orderRowsById.get(String(rowId)) ?? null;
};

export const getAccountSummaryFieldSnapshot = ({
  accountId,
  mode,
  fieldName,
}: AccountSummaryFieldSelectorInput): unknown => {
  const key = accountLiveScopeKey({ accountId, mode });
  if (!key || !fieldName) {
    return null;
  }
  const summary = accountLiveSlices.get(key)?.summary;
  if (!summary) {
    return null;
  }
  return (
    (summary.metrics as Record<string, unknown> | undefined)?.[fieldName] ??
    (summary as unknown as Record<string, unknown>)[fieldName] ??
    null
  );
};

export const useAccountPositionRow = ({
  accountId,
  mode,
  rowId,
  symbol,
  enabled = true,
}: AccountPositionRowSelectorInput): AccountPositionRow | null => {
  const subscribed = Boolean(enabled && accountLiveScopeKey({ accountId, mode }) && (rowId || symbol));
  const getSnapshot = useCallback(
    () => getAccountPositionRowSnapshot({ accountId, mode, rowId, symbol }),
    [accountId, mode, rowId, symbol],
  );
  return useSyncExternalStore(
    subscribed ? subscribeAccountLiveSlices : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );
};

export const useAccountOrderRow = ({
  accountId,
  mode,
  rowId,
  enabled = true,
}: AccountOrderRowSelectorInput): AccountOrderRow | null => {
  const subscribed = Boolean(enabled && accountLiveScopeKey({ accountId, mode }) && rowId);
  const getSnapshot = useCallback(
    () => getAccountOrderRowSnapshot({ accountId, mode, rowId }),
    [accountId, mode, rowId],
  );
  return useSyncExternalStore(
    subscribed ? subscribeAccountLiveSlices : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );
};

export const useAccountSummaryField = ({
  accountId,
  mode,
  fieldName,
  enabled = true,
}: AccountSummaryFieldSelectorInput): unknown => {
  const subscribed = Boolean(enabled && accountLiveScopeKey({ accountId, mode }) && fieldName);
  const getSnapshot = useCallback(
    () => getAccountSummaryFieldSnapshot({ accountId, mode, fieldName }),
    [accountId, mode, fieldName],
  );
  return useSyncExternalStore(
    subscribed ? subscribeAccountLiveSlices : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );
};

const getBrokerFreshnessForSnapshot = (
  streamId: string,
): BrokerFreshnessForSnapshot => {
  const snapshot = getBrokerStreamFreshnessSnapshot();
  const normalizedStreamId = String(streamId || "").toLowerCase();
  const lastEventAt =
    normalizedStreamId === "order" || normalizedStreamId === "orders"
      ? snapshot.orderLastEventAt
      : snapshot.accountLastEventAt;
  const fresh =
    normalizedStreamId === "order" || normalizedStreamId === "orders"
      ? snapshot.orderFresh
      : snapshot.accountFresh;
  const cached = brokerFreshnessForCache.get(normalizedStreamId);
  if (
    cached &&
    cached.lastEventAt === lastEventAt &&
    cached.fresh === fresh
  ) {
    return cached;
  }
  const next = { lastEventAt, fresh };
  brokerFreshnessForCache.set(normalizedStreamId, next);
  return next;
};

export const useBrokerFreshnessFor = (
  streamId: string,
  enabled = true,
): BrokerFreshnessForSnapshot => {
  const getSnapshot = useCallback(
    () => getBrokerFreshnessForSnapshot(streamId),
    [streamId],
  );
  return useSyncExternalStore(
    enabled ? subscribeBrokerStreamFreshness : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );
};

const ETF_SYMBOLS = new Set([
  "AGG",
  "ARKK",
  "BND",
  "DIA",
  "EEM",
  "EFA",
  "GLD",
  "GOVT",
  "HYG",
  "IAU",
  "IEF",
  "IWM",
  "IVV",
  "IYR",
  "LQD",
  "QQQ",
  "SHY",
  "SLV",
  "SOXX",
  "SPY",
  "SQQQ",
  "TLT",
  "TQQQ",
  "UNG",
  "USO",
  "UUP",
  "VEA",
  "VNQ",
  "VOO",
  "VTI",
  "VWO",
  "VXX",
  "VIXY",
  "XLB",
  "XLC",
  "XLE",
  "XLF",
  "XLI",
  "XLK",
  "XLP",
  "XLU",
  "XLV",
  "XLY",
  "XRT",
]);

type AccountPositionAssetClassLike = {
  assetClass?: unknown;
  positionType?: unknown;
  symbol?: unknown;
  optionContract?: unknown;
};

const streamAccountPositionType = (
  position: AccountPositionAssetClassLike,
): "stock" | "etf" | "option" => {
  const storedType = normalizeAccountAssetClass(position.positionType);
  if (
    storedType === "stock" ||
    storedType === "etf" ||
    storedType === "option"
  ) {
    return storedType;
  }
  if (position.optionContract) {
    return "option";
  }
  const assetClass = normalizeAccountAssetClass(position.assetClass);
  if (assetClass === "option" || assetClass === "etf") {
    return assetClass;
  }
  const symbol = String(position.symbol ?? "").trim().toUpperCase();
  if (symbol && ETF_SYMBOLS.has(symbol)) {
    return "etf";
  }
  return "stock";
};

const accountPositionTypeMatchesAssetClass = (
  position: AccountPositionAssetClassLike,
  requestedAssetClass: unknown,
): boolean => {
  const requested = normalizeAccountAssetClass(requestedAssetClass);
  if (!requested || requested === "all") {
    return true;
  }
  const positionType = streamAccountPositionType(position);
  if (requested === "equity") {
    return positionType === "stock" || positionType === "etf";
  }
  return positionType === requested;
};

const toIsoTimestamp = (value: unknown): string => {
  const timestamp = parseAccountTimestampMs(value);
  return new Date(timestamp ?? Date.now()).toISOString();
};

const dateOnly = (value: unknown): string => {
  const timestamp = parseAccountTimestampMs(value);
  if (timestamp !== null) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
  return String(value ?? "").slice(0, 10);
};

const streamPositionGroupKey = (position: StreamPosition): string => {
  const contract = position.optionContract;
  if (contract) {
    return [
      "option",
      contract.underlying || position.symbol,
      dateOnly(contract.expirationDate),
      contract.strike,
      contract.right,
    ].join(":");
  }
  return `equity:${position.symbol.toUpperCase()}`;
};

const streamPositionDescription = (position: StreamPosition): string => {
  const contract = position.optionContract;
  return contract
    ? `${contract.underlying || position.symbol} ${dateOnly(contract.expirationDate)} ${contract.strike} ${contract.right}`
    : position.symbol;
};

const streamPositionAssetClassLabel = (position: StreamPosition): string => {
  const positionType = streamAccountPositionType(position);
  if (positionType === "option") {
    return "Options";
  }
  if (positionType === "etf") {
    return "ETF";
  }
  return "Stocks";
};

const weightPercentFromNav = (
  marketValue: number,
  payload: AccountStreamPayload,
  accountId: string,
): number | null => {
  const scopedAccounts = accountsForScopedAccountId(payload.accounts, accountId);
  const netLiquidation = sumAccountField(scopedAccounts, "netLiquidation");
  return netLiquidation && Math.abs(netLiquidation) > 1e-9
    ? (marketValue / netLiquidation) * 100
    : null;
};

const streamPositionMark = (position: StreamPosition): number =>
  Number.isFinite(position.marketPrice) && Math.abs(position.marketPrice) > 1e-9
    ? normalizeOptionPremiumPrice(position, position.marketPrice) ?? 0
    : normalizeOptionPremiumPrice(position, position.averagePrice) ?? 0;

const streamPositionAveragePrice = (position: StreamPosition): number =>
  normalizeOptionPremiumPrice(position, position.averagePrice) ?? 0;

const streamPositionMarketValue = (position: StreamPosition): number => {
  const mark = streamPositionMark(position);
  const quantity = finiteOptionNumber(position.quantity);
  const multiplier = optionPositionMultiplier(position);
  return mark !== null && quantity !== null
    ? mark * quantity * multiplier
    : position.marketValue;
};

const streamPositionUnrealizedPnl = (position: StreamPosition): number => {
  const mark = streamPositionMark(position);
  const averagePrice = streamPositionAveragePrice(position);
  const quantity = finiteOptionNumber(position.quantity);
  const multiplier = optionPositionMultiplier(position);
  return mark !== null &&
    averagePrice !== null &&
    quantity !== null &&
    multiplier !== null
    ? (mark - averagePrice) * quantity * multiplier
    : position.unrealizedPnl;
};

const streamPositionUnrealizedPnlPercent = (
  position: StreamPosition,
): number => {
  const unrealizedPnl = streamPositionUnrealizedPnl(position);
  const averagePrice = streamPositionAveragePrice(position);
  const quantity = finiteOptionNumber(position.quantity);
  const multiplier = optionPositionMultiplier(position);
  const costBasis =
    averagePrice !== null && quantity !== null && multiplier !== null
      ? Math.abs(averagePrice * quantity * multiplier)
      : null;
  return unrealizedPnl !== null && costBasis && costBasis > 0
    ? (unrealizedPnl / costBasis) * 100
    : position.unrealizedPnlPercent;
};

const streamPositionOpenedAt = (
  position: StreamPosition,
  current?: AccountPositionRow,
): string | null => position.openedAt ?? current?.openedAt ?? null;

const streamPositionOpenedAtSource = (
  position: StreamPosition,
  current?: AccountPositionRow,
): AccountPositionRow["openedAtSource"] | null =>
  position.openedAtSource ?? current?.openedAtSource ?? null;

const streamPositionQuoteDayChange = (position: StreamPosition): number | null => {
  const perUnitDayChange = finiteOptionNumber(position.quote?.dayChange);
  const quantity = finiteOptionNumber(position.quantity);
  const multiplier = optionPositionMultiplier(position);
  return perUnitDayChange !== null && quantity !== null
    ? perUnitDayChange * quantity * multiplier
    : null;
};

const streamPositionDayChange = (
  position: StreamPosition,
  current: AccountPositionRow | undefined,
  unrealizedPnl: number,
): number | null => {
  const openedAt = streamPositionOpenedAt(position, current);
  const sameDayPosition = accountPositionOpenedOnCurrentMarketDay(openedAt);
  const sameDayUnrealizedPnl = finiteOptionNumber(unrealizedPnl);
  if (sameDayPosition && sameDayUnrealizedPnl !== null) {
    return sameDayUnrealizedPnl;
  }
  return streamPositionQuoteDayChange(position) ?? current?.dayChange ?? null;
};

const streamPositionDayChangePercent = (
  position: StreamPosition,
  current: AccountPositionRow | undefined,
  unrealizedPnlPercent: number,
): number | null => {
  const openedAt = streamPositionOpenedAt(position, current);
  const sameDayPosition = accountPositionOpenedOnCurrentMarketDay(openedAt);
  const sameDayUnrealizedPnlPercent = finiteOptionNumber(unrealizedPnlPercent);
  if (sameDayPosition && sameDayUnrealizedPnlPercent !== null) {
    return sameDayUnrealizedPnlPercent;
  }
  return finiteOptionNumber(position.quote?.dayChangePercent, current?.dayChangePercent);
};

const addNullableStreamTotal = (
  current: number | null,
  next: unknown,
): number | null => {
  const value = finiteOptionNumber(next);
  if (value === null) {
    return current;
  }
  return (current ?? 0) + value;
};

const streamPositionIsFlatCostBasisFallback = (
  position: StreamPosition,
): boolean => {
  const rawAveragePrice = finiteOptionNumber(position.averagePrice);
  const rawMarketPrice = finiteOptionNumber(position.marketPrice);
  const quantity = finiteOptionNumber(position.quantity);
  const marketValue = Math.abs(finiteOptionNumber(position.marketValue) ?? 0);
  const unrealizedPnl = finiteOptionNumber(position.unrealizedPnl);
  if (
    rawAveragePrice === null ||
    rawMarketPrice === null ||
    quantity === null ||
    marketValue <= 0 ||
    unrealizedPnl === null ||
    Math.abs(rawAveragePrice - rawMarketPrice) > 1e-9 ||
    Math.abs(unrealizedPnl) > 0.01
  ) {
    return false;
  }

  const multiplier = optionPositionMultiplier(position);
  const normalizedAveragePrice = streamPositionAveragePrice(position);
  const possibleCostBases = [
    rawAveragePrice * quantity,
    rawAveragePrice * quantity * multiplier,
    normalizedAveragePrice * quantity * multiplier,
  ].map((value) => Math.abs(value));
  return possibleCostBases.some(
    (costBasis) =>
      costBasis > 1e-9 &&
      Math.abs(costBasis - marketValue) / Math.max(costBasis, marketValue) <=
        0.02,
  );
};

const streamPositionHasMarketMark = (position: StreamPosition): boolean => {
  if (streamPositionIsFlatCostBasisFallback(position)) {
    return false;
  }

  const averagePrice = streamPositionAveragePrice(position);
  const reportedMarketPrice = normalizeOptionPremiumPrice(
    position,
    position.marketPrice,
  );
  const multiplier = optionPositionMultiplier(position);
  const hasNonZeroMarketPrice =
    reportedMarketPrice !== null && Math.abs(reportedMarketPrice) > 1e-9;
  const hasNonZeroMarketValue =
    Number.isFinite(position.marketValue) && Math.abs(position.marketValue) > 0.01;
  const costBasisValue = averagePrice * position.quantity * multiplier;
  const marketPriceDiffersFromAverage =
    hasNonZeroMarketPrice &&
    Math.abs((reportedMarketPrice ?? 0) - averagePrice) > 0.005;
  const marketValueDiffersFromCost =
    Math.abs(position.marketValue - costBasisValue) > 0.01;
  return (
    marketPriceDiffersFromAverage ||
    (hasNonZeroMarketPrice && Math.abs(position.unrealizedPnl ?? 0) > 0.01) ||
    (hasNonZeroMarketValue && marketValueDiffersFromCost)
  );
};

const accountPositionsBaseFromStream = (
  current: AccountPositionsResponse | undefined,
  payload: AccountStreamPayload,
  accountId: string,
): AccountPositionsResponse => {
  if (current) {
    return current;
  }

  const scopedAccounts = accountsForScopedAccountId(payload.accounts, accountId);
  const timestampMs = latestAccountUpdatedAtMs(scopedAccounts);
  const cash = sumAccountField(scopedAccounts, "cash");

  return {
    accountId,
    currency: scopedAccounts[0]?.currency || "USD",
    positions: [],
    totals: {
      weightPercent: 0,
      unrealizedPnl: 0,
      grossLong: 0,
      grossShort: 0,
      netExposure: 0,
      cash,
      totalCash: cash,
      buyingPower: sumAccountField(scopedAccounts, "buyingPower"),
      netLiquidation: sumAccountField(scopedAccounts, "netLiquidation"),
    },
    updatedAt: timestampMs
      ? new Date(timestampMs).toISOString()
      : new Date().toISOString(),
  };
};

const accountPositionTotalsFromStreamRows = (
  currentTotals: AccountPositionsResponse["totals"] | undefined,
  rows: AccountPositionRow[],
  payload: AccountStreamPayload,
  accountId: string,
): AccountPositionsResponse["totals"] => {
  const scopedAccounts = accountsForScopedAccountId(payload.accounts, accountId);
  const cash = sumAccountField(scopedAccounts, "cash");
  const buyingPower = sumAccountField(scopedAccounts, "buyingPower");
  const netLiquidation = sumAccountField(scopedAccounts, "netLiquidation");

  return {
    ...(currentTotals || {}),
    weightPercent: rows.reduce((sum, row) => sum + (row.weightPercent ?? 0), 0),
    unrealizedPnl: rows.reduce((sum, row) => sum + (row.unrealizedPnl ?? 0), 0),
    grossLong: rows
      .filter((row) => row.marketValue > 0)
      .reduce((sum, row) => sum + row.marketValue, 0),
    grossShort: Math.abs(
      rows
        .filter((row) => row.marketValue < 0)
        .reduce((sum, row) => sum + row.marketValue, 0),
    ),
    netExposure: rows.reduce((sum, row) => sum + row.marketValue, 0),
    cash: cash ?? currentTotals?.cash ?? null,
    totalCash: cash ?? currentTotals?.totalCash ?? null,
    buyingPower: buyingPower ?? currentTotals?.buyingPower ?? null,
    netLiquidation: netLiquidation ?? currentTotals?.netLiquidation ?? null,
  };
};

const accountPositionMatchesAssetClass = (
  position: Pick<AccountPositionRow, "assetClass" | "positionType" | "symbol" | "optionContract">,
  queryKey: unknown,
): boolean => {
  const params = readQueryParams(queryKey);
  const requestedAssetClass =
    typeof params?.assetClass === "string" ? params.assetClass : null;
  return accountPositionTypeMatchesAssetClass(position, requestedAssetClass);
};

const sortPatchedAccountPositions = (
  currentRows: AccountPositionRow[],
  nextRows: AccountPositionRow[],
): AccountPositionRow[] => {
  const currentOrder = new Map(
    currentRows.map((position, index) => [position.id, index]),
  );
  return nextRows.sort((left, right) => {
    const leftIndex = currentOrder.get(left.id);
    const rightIndex = currentOrder.get(right.id);
    if (leftIndex !== undefined || rightIndex !== undefined) {
      return (leftIndex ?? Number.MAX_SAFE_INTEGER) -
        (rightIndex ?? Number.MAX_SAFE_INTEGER);
    }
    return Math.abs(right.marketValue) - Math.abs(left.marketValue);
  });
};

const accountPositionRowFromStream = (
  position: StreamPosition,
  current: AccountPositionRow | undefined,
  payload: AccountStreamPayload,
  accountId: string,
): AccountPositionRow => {
  const hasMarketMark = streamPositionHasMarketMark(position);
  const averageCost = streamPositionAveragePrice(position);
  const mark = hasMarketMark
    ? streamPositionMark(position)
    : current?.mark ?? streamPositionMark(position);
  const marketValue = hasMarketMark
    ? streamPositionMarketValue(position)
    : current?.marketValue ?? position.marketValue;
  const unrealizedPnl = streamPositionUnrealizedPnl(position);
  const unrealizedPnlPercent = streamPositionUnrealizedPnlPercent(position);
  const dayChange = streamPositionDayChange(position, current, unrealizedPnl);
  const dayChangePercent = streamPositionDayChangePercent(
    position,
    current,
    unrealizedPnlPercent,
  );

  return {
    ...(current || {}),
    id: current?.id ?? position.id,
    accountId: current?.accountId ?? position.accountId,
    accounts: current?.accounts ?? [position.accountId],
    symbol: position.symbol,
    description: current?.description ?? streamPositionDescription(position),
    assetClass: current?.assetClass ?? streamPositionAssetClassLabel(position),
    positionType: current?.positionType ?? streamAccountPositionType(position),
    optionContract: position.optionContract ?? null,
    sector: current?.sector ?? "",
    quantity: position.quantity,
    averageCost,
    mark,
    dayChange,
    dayChangePercent,
    unrealizedPnl: hasMarketMark
      ? unrealizedPnl
      : current?.unrealizedPnl ?? position.unrealizedPnl,
    unrealizedPnlPercent: hasMarketMark
      ? unrealizedPnlPercent
      : current?.unrealizedPnlPercent ?? position.unrealizedPnlPercent,
    marketValue,
    weightPercent: hasMarketMark
      ? weightPercentFromNav(marketValue, payload, accountId)
      : current?.weightPercent ?? weightPercentFromNav(marketValue, payload, accountId),
    betaWeightedDelta: current?.betaWeightedDelta ?? null,
    lots: current?.lots ?? [],
    openOrders: current?.openOrders ?? [],
    source: current?.source ?? "IBKR_POSITIONS",
    sourceType: current?.sourceType ?? "manual",
    strategyLabel: current?.strategyLabel ?? "Manual",
    attributionStatus: current?.attributionStatus ?? "unknown",
    sourceAttribution: current?.sourceAttribution ?? [],
    openedAt: streamPositionOpenedAt(position, current),
    openedAtSource: streamPositionOpenedAtSource(position, current),
  };
};

const patchCombinedAccountPositions = (
  current: AccountPositionsResponse,
  payload: AccountStreamPayload,
  accountId: string,
  queryKey: unknown,
): AccountPositionRow[] => {
  const currentById = new Map(current.positions.map((position) => [position.id, position]));
  const groups = new Map<
    string,
    {
      first: StreamPosition;
      current?: AccountPositionRow;
      accounts: Set<string>;
      quantity: number;
      averageCostAccumulator: number;
      markAccumulator: number;
      averageWeight: number;
      hasMarketMark: boolean;
      marketValue: number;
      unrealizedPnl: number;
      unrealizedPnlPercentAccumulator: number;
      unrealizedWeight: number;
      dayChange: number | null;
      dayChangePercentAccumulator: number;
      dayChangeWeight: number;
    }
  >();

  payload.positions.forEach((position) => {
    const key = streamPositionGroupKey(position);
    const averagePrice = streamPositionAveragePrice(position);
    const mark = streamPositionMark(position);
    const hasMarketMark = streamPositionHasMarketMark(position);
    const currentRow = currentById.get(key);
    if (!hasMarketMark && !currentRow) {
      return;
    }
    const marketValue = streamPositionMarketValue(position);
    const unrealizedPnl = streamPositionUnrealizedPnl(position);
    const unrealizedPnlPercent = streamPositionUnrealizedPnlPercent(position);
    const dayChange = streamPositionDayChange(position, currentRow, unrealizedPnl);
    const dayChangePercent = streamPositionDayChangePercent(
      position,
      currentRow,
      unrealizedPnlPercent,
    );
    const quantityWeight = Math.abs(position.quantity);
    const valueWeight = Math.abs(marketValue);
    const currentGroup = groups.get(key) ?? {
      first: position,
      current: currentRow,
      accounts: new Set<string>(),
      quantity: 0,
      averageCostAccumulator: 0,
      markAccumulator: 0,
      averageWeight: 0,
      hasMarketMark: false,
      marketValue: 0,
      unrealizedPnl: 0,
      unrealizedPnlPercentAccumulator: 0,
      unrealizedWeight: 0,
      dayChange: null,
      dayChangePercentAccumulator: 0,
      dayChangeWeight: 0,
    };

    currentGroup.accounts.add(position.accountId);
    currentGroup.quantity += position.quantity;
    currentGroup.averageCostAccumulator += averagePrice * quantityWeight;
    currentGroup.markAccumulator += mark * quantityWeight;
    currentGroup.averageWeight += quantityWeight;
    currentGroup.hasMarketMark ||= hasMarketMark;
    currentGroup.marketValue += marketValue;
    currentGroup.unrealizedPnl += unrealizedPnl;
    currentGroup.unrealizedPnlPercentAccumulator +=
      (unrealizedPnlPercent ?? 0) * valueWeight;
    currentGroup.unrealizedWeight += valueWeight;
    currentGroup.dayChange = addNullableStreamTotal(
      currentGroup.dayChange,
      dayChange,
    );
    if (dayChangePercent !== null && valueWeight > 0) {
      currentGroup.dayChangePercentAccumulator += dayChangePercent * valueWeight;
      currentGroup.dayChangeWeight += valueWeight;
    }
    groups.set(key, currentGroup);
  });

  return sortPatchedAccountPositions(
    current.positions,
    Array.from(groups.entries())
      .map(([id, group]) => {
        const currentRow = group.current;
        const resolvedMark =
          group.hasMarketMark || !currentRow
            ? group.averageWeight > 0
              ? group.markAccumulator / group.averageWeight
              : 0
            : currentRow.mark;
        const resolvedMarketValue =
          group.hasMarketMark || !currentRow
            ? group.marketValue
            : currentRow.marketValue;
        const row: AccountPositionRow = {
          ...(currentRow || {}),
          id,
          accountId,
          accounts: Array.from(group.accounts),
          symbol: group.first.symbol,
          description:
            currentRow?.description ?? streamPositionDescription(group.first),
          assetClass:
            currentRow?.assetClass ?? streamPositionAssetClassLabel(group.first),
          positionType:
            currentRow?.positionType ?? streamAccountPositionType(group.first),
          optionContract: group.first.optionContract ?? null,
          sector: currentRow?.sector ?? "",
          quantity: group.quantity,
          averageCost:
            group.averageWeight > 0
              ? group.averageCostAccumulator / group.averageWeight
              : 0,
          mark: resolvedMark,
          dayChange: group.dayChange,
          dayChangePercent:
            group.dayChangeWeight > 0
              ? group.dayChangePercentAccumulator / group.dayChangeWeight
              : currentRow?.dayChangePercent ?? null,
          unrealizedPnl: group.hasMarketMark || !currentRow
            ? group.unrealizedPnl
            : currentRow.unrealizedPnl,
          unrealizedPnlPercent:
            !group.hasMarketMark && currentRow
              ? currentRow.unrealizedPnlPercent
              : group.unrealizedWeight > 0
              ? group.unrealizedPnlPercentAccumulator / group.unrealizedWeight
              : 0,
          marketValue: resolvedMarketValue,
          weightPercent: group.hasMarketMark || !currentRow
            ? weightPercentFromNav(resolvedMarketValue, payload, accountId)
            : currentRow.weightPercent,
          betaWeightedDelta: currentRow?.betaWeightedDelta ?? null,
          lots: currentRow?.lots ?? [],
          openOrders: currentRow?.openOrders ?? [],
          source: currentRow?.source ?? "IBKR_POSITIONS",
          sourceType: currentRow?.sourceType ?? "manual",
          strategyLabel: currentRow?.strategyLabel ?? "Manual",
          attributionStatus: currentRow?.attributionStatus ?? "unknown",
          sourceAttribution: currentRow?.sourceAttribution ?? [],
          openedAt: streamPositionOpenedAt(group.first, currentRow),
          openedAtSource: streamPositionOpenedAtSource(group.first, currentRow),
        };
        return row;
      })
      .filter((position) => accountPositionMatchesAssetClass(position, queryKey)),
  );
};

const patchAccountPositionsFromStream = (
  current: AccountPositionsResponse | undefined,
  payload: AccountStreamPayload,
  accountId: string,
  queryKey: unknown,
): AccountPositionsResponse | undefined => {
  const scopedPositions =
    accountId === "combined"
      ? payload.positions
      : payload.positions.filter((position) => position.accountId === accountId);
  if (!current && !scopedPositions.some(streamPositionHasMarketMark)) {
    return current;
  }

  const base = accountPositionsBaseFromStream(current, payload, accountId);
  const positions =
    accountId === "combined"
      ? patchCombinedAccountPositions(base, payload, accountId, queryKey)
      : sortPatchedAccountPositions(
          base.positions,
          payload.positions
            .filter((position) => position.accountId === accountId)
            .filter(
              (position) =>
                streamPositionHasMarketMark(position) ||
                base.positions.some((row) => row.id === position.id),
            )
            .map((position) =>
              accountPositionRowFromStream(
                position,
                base.positions.find((row) => row.id === position.id),
                payload,
                accountId,
              ),
            )
            .filter((position) => accountPositionMatchesAssetClass(position, queryKey)),
        );

  return {
    ...base,
    positions,
    totals: accountPositionTotalsFromStreamRows(
      base.totals,
      positions,
      payload,
      accountId,
    ),
    updatedAt: new Date().toISOString(),
  };
};

const TERMINAL_ORDER_STATUSES = new Set(["filled", "canceled", "rejected", "expired"]);

const orderMatchesAccountTab = (
  order: StreamOrder,
  accountId: string,
  tab: "working" | "history",
): boolean => {
  if (accountId !== "combined" && order.accountId !== accountId) {
    return false;
  }
  const terminal = TERMINAL_ORDER_STATUSES.has(order.status);
  return tab === "history" ? terminal : !terminal;
};

const accountOrderFromStream = (
  order: StreamOrder,
  current: AccountOrderRow | undefined,
): AccountOrderRow => ({
  ...(current || {}),
  id: order.id,
  accountId: order.accountId,
  symbol: order.symbol,
  side: order.side,
  type: order.type,
  assetClass: order.assetClass,
  quantity: order.quantity,
  filledQuantity: order.filledQuantity,
  limitPrice: order.limitPrice,
  stopPrice: order.stopPrice,
  timeInForce: order.timeInForce,
  status: order.status,
  placedAt: toIsoTimestamp(order.placedAt),
  filledAt: order.status === "filled" ? toIsoTimestamp(order.updatedAt) : null,
  updatedAt: toIsoTimestamp(order.updatedAt),
  averageFillPrice: current?.averageFillPrice ?? null,
  commission: current?.commission ?? null,
  source: current?.source ?? "LIVE",
});

const patchAccountOrdersFromStream = (
  current: AccountOrdersResponse | undefined,
  orders: OrdersResponse["orders"],
  accountId: string,
  queryKey: unknown,
): AccountOrdersResponse | undefined => {
  if (!current) {
    return current;
  }
  const params = readQueryParams(queryKey);
  const tab = params?.tab === "history" ? "history" : "working";
  const currentById = new Map(current.orders.map((order) => [order.id, order]));

  return {
    ...current,
    tab,
    orders: orders
      .filter((order) => orderMatchesAccountTab(order, accountId, tab))
      .map((order) => accountOrderFromStream(order, currentById.get(order.id))),
    updatedAt: new Date().toISOString(),
  };
};

const shadowPositionsForQuery = (
  positionsResponse: AccountPositionsResponse,
  queryKey: unknown,
): AccountPositionsResponse => {
  const params = readQueryParams(queryKey);
  const requestedAssetClass = normalizeAccountAssetClass(params?.assetClass);
  const openPositions = positionsResponse.positions.filter((position) => {
    const quantity = Number(position.quantity);
    return !Number.isFinite(quantity) || Math.abs(quantity) > 1e-9;
  });
  if (!requestedAssetClass || requestedAssetClass === "all") {
    return {
      ...positionsResponse,
      positions: openPositions,
    };
  }

  return {
    ...positionsResponse,
    positions: openPositions.filter((position) =>
      accountPositionTypeMatchesAssetClass(position, requestedAssetClass),
    ),
  };
};

const shadowOrdersForQuery = (
  payload: ShadowAccountStreamPayload,
  queryKey: unknown,
): AccountOrdersResponse => {
  const params = readQueryParams(queryKey);
  return params?.tab === "history" ? payload.historyOrders : payload.workingOrders;
};

export const applyShadowAccountPayloadToCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: ShadowAccountStreamPayload,
) => {
  queryClient
    .getQueryCache()
    .findAll({
      predicate: (query) => {
        const path = queryKeyPath(query.queryKey);
        return Boolean(path?.startsWith("/api/accounts/shadow/"));
      },
    })
    .forEach((query) => {
      const params = readQueryParams(query.queryKey);
      if (!matchesMode(params, "paper") || typeof params?.source === "string") {
        return;
      }

      const path = queryKeyPath(query.queryKey);
      if (path === "/api/accounts/shadow/summary") {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountSummaryResponse | undefined) =>
            preferNonDegradedAccountResponse(current, payload.summary),
        );
      } else if (path === "/api/accounts/shadow/positions") {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountPositionsResponse | undefined) =>
            preferNonDegradedAccountResponse(
              current,
              maybeReuseAccountPositionsResponse(
                current,
                shadowPositionsForQuery(payload.positions, query.queryKey),
              ),
            ),
        );
      } else if (path === "/api/accounts/shadow/orders") {
        queryClient.setQueryData(
          query.queryKey,
          shadowOrdersForQuery(payload, query.queryKey),
        );
      } else if (path === "/api/accounts/shadow/allocation") {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountAllocationResponse | undefined) =>
            preferNonDegradedAccountResponse(current, payload.allocation),
        );
      } else if (
        path === "/api/accounts/shadow/risk" &&
        optionalParamMatches(params, "detail", "fast")
      ) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountRiskResponse | undefined) =>
            preferNonDegradedAccountResponse(current, payload.risk),
        );
      }
    });

};

const optionalParamMatches = (
  params: Record<string, unknown> | null,
  key: string,
  expected: string | null | undefined,
): boolean => {
  const current = typeof params?.[key] === "string" ? params[key] : null;
  return expected ? current === expected : current == null || current === "";
};

const assetClassParamMatches = (
  params: Record<string, unknown> | null,
  expected: string | null | undefined,
): boolean => {
  const current = normalizeAccountAssetClass(params?.assetClass);
  const normalizedExpected = normalizeAccountAssetClass(expected);
  return normalizedExpected && normalizedExpected !== "all"
    ? current === normalizedExpected
    : current == null || current === "all";
};

const accountPositionsQueryRequestsLiveQuotes = (
  params: Record<string, unknown> | null,
): boolean => params?.liveQuotes === true || params?.liveQuotes === "true";

const shouldApplyPrimaryAccountPositions = (
  payload: AccountPagePrimaryPayload,
): boolean => Boolean(payload.accountId);

const primaryAccountPositionsUseLiveQuotes = (
  _payload: Pick<AccountPagePrimaryPayload | AccountPageLivePayload, "accountId">,
): boolean => true;

const orderTabParamMatches = (
  params: Record<string, unknown> | null,
  expected: "working" | "history",
): boolean => {
  const current = params?.tab === "history" ? "history" : "working";
  return current === expected;
};

const closedTradeParamsMatch = (
  params: Record<string, unknown> | null,
  filters: AccountPageBootstrapPayload["tradeFilters"],
): boolean =>
  optionalParamMatches(params, "from", filters.from) &&
  optionalParamMatches(params, "to", filters.to) &&
  optionalParamMatches(params, "symbol", filters.symbol) &&
  optionalParamMatches(params, "pnlSign", filters.pnlSign) &&
  optionalParamMatches(params, "holdDuration", filters.holdDuration) &&
  assetClassParamMatches(params, filters.assetClass);

const performanceCalendarParamsMatch = (
  params: Record<string, unknown> | null,
  performanceCalendarFrom: string | null,
): boolean =>
  optionalParamMatches(params, "from", performanceCalendarFrom) &&
  optionalParamMatches(params, "to", null) &&
  optionalParamMatches(params, "symbol", null) &&
  optionalParamMatches(params, "pnlSign", null) &&
  optionalParamMatches(params, "holdDuration", null) &&
  optionalParamMatches(params, "assetClass", null);

const accountModeParams = (mode: StreamMode) => ({ mode });

const accountRiskParams = (mode: StreamMode) => ({
  ...accountModeParams(mode),
  detail: "fast" as const,
});

type SeedAccountPagePrimaryQueryKeysOptions = {
  seedPositions?: boolean;
  positionsLiveQuotes?: boolean;
};

export const ACCOUNT_PERFORMANCE_CALENDAR_EQUITY_PURPOSE =
  "performance-calendar";

export const getAccountPerformanceCalendarEquityQueryKey = (
  accountId: string,
  params: { mode: StreamMode },
) =>
  [
    `/api/accounts/${accountId}/equity-history`,
    {
      mode: params.mode,
      range: "1Y",
      purpose: ACCOUNT_PERFORMANCE_CALENDAR_EQUITY_PURPOSE,
    },
  ] as const;

const isPerformanceCalendarEquityQuery = (
  params: Record<string, unknown> | null,
): boolean => params?.purpose === ACCOUNT_PERFORMANCE_CALENDAR_EQUITY_PURPOSE;

const accountPositionsParams = (
  payload: Pick<AccountPageLivePayload, "mode" | "assetClass">,
  options: Pick<
    SeedAccountPagePrimaryQueryKeysOptions,
    "positionsLiveQuotes"
  > = {},
) => ({
  mode: payload.mode,
  assetClass: payload.assetClass ?? undefined,
  liveQuotes: options.positionsLiveQuotes !== false,
});

const accountClosedTradeParams = (
  payload: AccountPageDerivedPayload,
): GetAccountClosedTradesParams => ({
  mode: payload.mode,
  symbol: payload.tradeFilters.symbol ?? undefined,
  assetClass: payload.tradeFilters.assetClass ?? undefined,
  pnlSign: payload.tradeFilters.pnlSign ?? undefined,
  holdDuration: payload.tradeFilters.holdDuration ?? undefined,
  from: payload.tradeFilters.from ?? undefined,
  to: payload.tradeFilters.to ?? undefined,
});

const setAccountPageQueryData = <TValue>(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: unknown,
  value: TValue | ((current: TValue | undefined) => TValue | undefined),
) => {
  queryClient.setQueryData(queryKey as any, value as any);
};

const seedAccountPagePrimaryQueryKeys = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: AccountPagePrimaryPayload | AccountPageLivePayload,
  options: SeedAccountPagePrimaryQueryKeysOptions = {},
) => {
  const modeParams = accountModeParams(payload.mode);

  setAccountPageQueryData(
    queryClient,
    getGetAccountSummaryQueryKey(payload.accountId, modeParams),
    (current: AccountSummaryResponse | undefined) =>
      preferNonDegradedAccountResponse(current, payload.summary),
  );
  setAccountPageQueryData(
    queryClient,
    getGetAccountAllocationQueryKey(payload.accountId, modeParams),
    (current: AccountAllocationResponse | undefined) =>
      preferNonDegradedAccountResponse(current, payload.allocation),
  );
  setAccountPageQueryData(
    queryClient,
    getGetAccountRiskQueryKey(payload.accountId, accountRiskParams(payload.mode)),
    (current: AccountRiskResponse | undefined) =>
      preferNonDegradedAccountResponse(current, payload.risk),
  );
  if (options.seedPositions !== false) {
    setAccountPageQueryData(
      queryClient,
      getGetAccountPositionsQueryKey(
        payload.accountId,
        accountPositionsParams(payload, options),
      ),
      (current: AccountPositionsResponse | undefined) =>
        preferNonDegradedAccountResponse(
          current,
          maybeReuseAccountPositionsResponse(current, payload.positions),
        ),
    );
  }
  setAccountPageQueryData(
    queryClient,
    getGetAccountOrdersQueryKey(payload.accountId, {
      mode: payload.mode,
      tab: payload.orderTab,
    }),
    (current: AccountOrdersResponse | undefined) =>
      maybeReuseAccountOrdersResponse(current, payload.orders),
  );
};

const seedAccountPageLiveQueryKeys = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: AccountPageLivePayload,
) => {
  seedAccountPagePrimaryQueryKeys(queryClient, payload, {
    positionsLiveQuotes: true,
  });
  setAccountPageQueryData(
    queryClient,
    getGetAccountEquityHistoryQueryKey(payload.accountId, {
      mode: payload.mode,
      range: "1D",
    }),
    (current: AccountEquityHistoryResponse | undefined) =>
      reuseEqualJson(current, payload.intradayEquity),
  );
};

const seedAccountPageDerivedQueryKeys = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: AccountPageDerivedPayload,
) => {
  const range = payload.range ?? "ALL";
  const modeParams = accountModeParams(payload.mode);

  if (range !== "1D") {
    setAccountPageQueryData(
      queryClient,
      getGetAccountEquityHistoryQueryKey(payload.accountId, {
        mode: payload.mode,
        range,
      }),
      (current: LiveAccountEquityHistoryResponse | undefined) =>
        mergeDerivedAccountPageEquityHistory(current, payload.equityHistory),
    );
  }
  (["SPY", "QQQ", "DIA"] as const).forEach((benchmark) => {
    const benchmarkPayload = payload.benchmarkEquityHistory[benchmark];
    if (!benchmarkPayload) {
      return;
    }
    setAccountPageQueryData(
      queryClient,
      getGetAccountEquityHistoryQueryKey(payload.accountId, {
        mode: payload.mode,
        range,
        benchmark,
      }),
      benchmarkPayload,
    );
  });
  setAccountPageQueryData(
    queryClient,
    getAccountPerformanceCalendarEquityQueryKey(payload.accountId, {
      mode: payload.mode,
    }),
    (current: LiveAccountEquityHistoryResponse | undefined) =>
      mergeDerivedAccountPageEquityHistory(
        current,
        payload.performanceCalendarEquity,
      ),
  );
  setAccountPageQueryData(
    queryClient,
    getGetAccountClosedTradesQueryKey(
      payload.accountId,
      accountClosedTradeParams(payload),
    ),
    (current: AccountClosedTradesResponse | undefined) =>
      preferUsableClosedTradesResponse(current, payload.closedTrades),
  );
  if (payload.performanceCalendarFrom) {
    setAccountPageQueryData(
      queryClient,
      getGetAccountClosedTradesQueryKey(payload.accountId, {
        ...modeParams,
        from: payload.performanceCalendarFrom,
      }),
      (current: AccountClosedTradesResponse | undefined) =>
        preferUsableClosedTradesResponse(
          current,
          payload.performanceCalendarTrades,
        ),
    );
  }
  setAccountPageQueryData(
    queryClient,
    getGetAccountCashActivityQueryKey(payload.accountId, modeParams),
    payload.cashActivity,
  );
  if (payload.flexHealth) {
    setAccountPageQueryData(
      queryClient,
      getGetFlexHealthQueryKey(),
      payload.flexHealth,
    );
  }
};

export const applyAccountPagePrimaryPayloadToCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: AccountPagePrimaryPayload,
) => {
  seedAccountPagePrimaryQueryKeys(queryClient, payload, {
    seedPositions: shouldApplyPrimaryAccountPositions(payload),
    positionsLiveQuotes: primaryAccountPositionsUseLiveQuotes(payload),
  });
  queryClient
    .getQueryCache()
    .findAll({
      predicate: (query) => {
        const path = queryKeyPath(query.queryKey);
        return Boolean(path?.startsWith(`/api/accounts/${payload.accountId}/`));
      },
    })
    .forEach((query) => {
      const path = queryKeyPath(query.queryKey);
      const params = readQueryParams(query.queryKey);

      if (!matchesMode(params, payload.mode)) {
        return;
      }
      if (typeof params?.source === "string") {
        return;
      }

      if (path === `/api/accounts/${payload.accountId}/summary`) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountSummaryResponse | undefined) =>
            preferNonDegradedAccountResponse(current, payload.summary),
        );
      } else if (path === `/api/accounts/${payload.accountId}/allocation`) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountAllocationResponse | undefined) =>
            preferNonDegradedAccountResponse(current, payload.allocation),
        );
      } else if (
        path === `/api/accounts/${payload.accountId}/risk` &&
        optionalParamMatches(params, "detail", "fast")
      ) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountRiskResponse | undefined) =>
            preferNonDegradedAccountResponse(current, payload.risk),
        );
      } else if (
        path === `/api/accounts/${payload.accountId}/positions` &&
        shouldApplyPrimaryAccountPositions(payload) &&
        assetClassParamMatches(params, payload.assetClass) &&
        accountPositionsQueryRequestsLiveQuotes(params) ===
          primaryAccountPositionsUseLiveQuotes(payload)
      ) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountPositionsResponse | undefined) =>
            preferNonDegradedAccountResponse(
              current,
              maybeReuseAccountPositionsResponse(current, payload.positions),
            ),
        );
      } else if (
        path === `/api/accounts/${payload.accountId}/orders` &&
        orderTabParamMatches(params, payload.orderTab)
      ) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountOrdersResponse | undefined) =>
            maybeReuseAccountOrdersResponse(current, payload.orders),
        );
      }
    });
  if (shouldApplyPrimaryAccountPositions(payload)) {
    applyAccountLivePayloadToSelectorStore(payload);
  }
};

export const applyAccountPageLivePayloadToCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: AccountPageLivePayload,
) => {
  seedAccountPageLiveQueryKeys(queryClient, payload);
  queryClient
    .getQueryCache()
    .findAll({
      predicate: (query) => {
        const path = queryKeyPath(query.queryKey);
        return Boolean(path?.startsWith(`/api/accounts/${payload.accountId}/`));
      },
    })
    .forEach((query) => {
      const path = queryKeyPath(query.queryKey);
      const params = readQueryParams(query.queryKey);

      if (!matchesMode(params, payload.mode)) {
        return;
      }
      if (typeof params?.source === "string") {
        return;
      }

      if (path === `/api/accounts/${payload.accountId}/summary`) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountSummaryResponse | undefined) =>
            preferNonDegradedAccountResponse(current, payload.summary),
        );
      } else if (path === `/api/accounts/${payload.accountId}/allocation`) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountAllocationResponse | undefined) =>
            preferNonDegradedAccountResponse(current, payload.allocation),
        );
      } else if (
        path === `/api/accounts/${payload.accountId}/risk` &&
        optionalParamMatches(params, "detail", "fast")
      ) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountRiskResponse | undefined) =>
            preferNonDegradedAccountResponse(current, payload.risk),
        );
      } else if (
        path === `/api/accounts/${payload.accountId}/positions` &&
        assetClassParamMatches(params, payload.assetClass)
      ) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountPositionsResponse | undefined) =>
            preferNonDegradedAccountResponse(
              current,
              maybeReuseAccountPositionsResponse(current, payload.positions),
            ),
        );
      } else if (
        path === `/api/accounts/${payload.accountId}/orders` &&
        orderTabParamMatches(params, payload.orderTab)
      ) {
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountOrdersResponse | undefined) =>
            maybeReuseAccountOrdersResponse(current, payload.orders),
        );
      } else if (path === `/api/accounts/${payload.accountId}/equity-history`) {
        const range = normalizeAccountHistoryRange(params?.range) ?? "ALL";
        const benchmark =
          typeof params?.benchmark === "string" && params.benchmark.trim()
            ? params.benchmark.trim().toUpperCase()
            : null;
        if (benchmark) {
          return;
        }
        if (range === "1D") {
          queryClient.setQueryData(
            query.queryKey,
            (current: AccountEquityHistoryResponse | undefined) =>
              reuseEqualJson(current, payload.intradayEquity),
          );
        } else {
          queryClient.setQueryData(
            query.queryKey,
            (current: LiveAccountEquityHistoryResponse | undefined) =>
              upsertAccountPageLiveEquityTerminalPoint(current, payload, range),
          );
        }
      }
    });
  applyAccountLivePayloadToSelectorStore(payload);
};

export const applyAccountPageDerivedPayloadToCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: AccountPageDerivedPayload,
) => {
  seedAccountPageDerivedQueryKeys(queryClient, payload);
  queryClient
    .getQueryCache()
    .findAll({
      predicate: (query) => {
        const path = queryKeyPath(query.queryKey);
        return (
          path === "/api/accounts/flex/health" ||
          Boolean(path?.startsWith(`/api/accounts/${payload.accountId}/`))
        );
      },
    })
    .forEach((query) => {
      const path = queryKeyPath(query.queryKey);
      const params = readQueryParams(query.queryKey);

      if (path === "/api/accounts/flex/health") {
        if (payload.flexHealth) {
          queryClient.setQueryData(query.queryKey, payload.flexHealth);
        }
        return;
      }

      if (!matchesMode(params, payload.mode)) {
        return;
      }
      if (typeof params?.source === "string") {
        return;
      }

      if (path === `/api/accounts/${payload.accountId}/cash-activity`) {
        queryClient.setQueryData(query.queryKey, payload.cashActivity);
      } else if (path === `/api/accounts/${payload.accountId}/closed-trades`) {
        if (closedTradeParamsMatch(params, payload.tradeFilters)) {
          queryClient.setQueryData(
            query.queryKey,
            (current: AccountClosedTradesResponse | undefined) =>
              preferUsableClosedTradesResponse(current, payload.closedTrades),
          );
        } else if (
          performanceCalendarParamsMatch(params, payload.performanceCalendarFrom)
        ) {
          queryClient.setQueryData(
            query.queryKey,
            (current: AccountClosedTradesResponse | undefined) =>
              preferUsableClosedTradesResponse(
                current,
                payload.performanceCalendarTrades,
              ),
          );
        }
      } else if (path === `/api/accounts/${payload.accountId}/equity-history`) {
        const range = normalizeAccountHistoryRange(params?.range) ?? "ALL";
        const performanceCalendarQuery =
          isPerformanceCalendarEquityQuery(params);
        const benchmark =
          typeof params?.benchmark === "string" ? params.benchmark.toUpperCase() : null;

        if (benchmark === "SPY" || benchmark === "QQQ" || benchmark === "DIA") {
          if (range === payload.range && payload.benchmarkEquityHistory[benchmark]) {
            queryClient.setQueryData(
              query.queryKey,
              payload.benchmarkEquityHistory[benchmark],
            );
          }
        } else if (performanceCalendarQuery) {
          if (range === "1Y") {
            queryClient.setQueryData(
              query.queryKey,
              (current: LiveAccountEquityHistoryResponse | undefined) =>
                mergeDerivedAccountPageEquityHistory(
                  current,
                  payload.performanceCalendarEquity,
                ),
            );
          }
        } else if (range === "1D") {
          return;
        } else if (range === payload.range) {
          queryClient.setQueryData(
            query.queryKey,
            (current: LiveAccountEquityHistoryResponse | undefined) =>
              mergeDerivedAccountPageEquityHistory(
                current,
                payload.equityHistory,
              ),
          );
        }
      }
    });
};

export const applyAccountPagePayloadToCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: AccountPageBootstrapPayload,
) => {
  applyAccountPageLivePayloadToCache(queryClient, {
    stream: "account-page-live",
    accountId: payload.accountId,
    mode: payload.mode,
    orderTab: payload.orderTab,
    assetClass: payload.assetClass,
    updatedAt: payload.updatedAt,
    summary: payload.summary,
    intradayEquity: payload.intradayEquity,
    allocation: payload.allocation,
    positions: payload.positions,
    orders: payload.orders,
    risk: payload.risk,
  });
  applyAccountPageDerivedPayloadToCache(queryClient, {
    stream: "account-page-derived",
    accountId: payload.accountId,
    mode: payload.mode,
    range: payload.range,
    tradeFilters: payload.tradeFilters,
    performanceCalendarFrom: payload.performanceCalendarFrom,
    updatedAt: payload.updatedAt,
    equityHistory: payload.equityHistory,
    benchmarkEquityHistory: payload.benchmarkEquityHistory,
    performanceCalendarEquity: payload.performanceCalendarEquity,
    performanceCalendarTrades: payload.performanceCalendarTrades,
    closedTrades: payload.closedTrades,
    cashActivity: payload.cashActivity,
    flexHealth: payload.flexHealth,
  });
};

type QueuedAccountPagePayload =
  | {
      kind: "bootstrap";
      queryClient: ReturnType<typeof useQueryClient>;
      payload: AccountPageBootstrapPayload;
      queueKey: string;
    }
  | {
      kind: "primary";
      queryClient: ReturnType<typeof useQueryClient>;
      payload: AccountPagePrimaryPayload;
      queueKey: string;
    }
  | {
      kind: "live";
      queryClient: ReturnType<typeof useQueryClient>;
      payload: AccountPageLivePayload;
      queueKey: string;
    }
  | {
      kind: "derived";
      queryClient: ReturnType<typeof useQueryClient>;
      payload: AccountPageDerivedPayload;
      queueKey: string;
    };

const pendingAccountPagePayloads: QueuedAccountPagePayload[] = [];
let accountPagePayloadFlushScheduled = false;
let accountPagePayloadFlushTimer: ReturnType<typeof setTimeout> | null = null;

const accountPagePayloadQueueKey = (
  kind: QueuedAccountPagePayload["kind"],
  payload:
    | AccountPageBootstrapPayload
    | AccountPagePrimaryPayload
    | AccountPageLivePayload
    | AccountPageDerivedPayload,
): string => {
  if (kind === "primary" || kind === "live") {
    const livePayload = payload as AccountPagePrimaryPayload | AccountPageLivePayload;
    return [
      kind,
      livePayload.accountId,
      livePayload.mode,
      livePayload.assetClass || "all",
      livePayload.orderTab,
    ].join(":");
  }
  if (kind === "derived") {
    const derivedPayload = payload as AccountPageDerivedPayload;
    return [
      kind,
      derivedPayload.accountId,
      derivedPayload.mode,
      derivedPayload.range || "ALL",
      JSON.stringify(derivedPayload.tradeFilters || {}),
      derivedPayload.performanceCalendarFrom || "",
    ].join(":");
  }
  const bootstrapPayload = payload as AccountPageBootstrapPayload;
  return [
    kind,
    bootstrapPayload.accountId,
    bootstrapPayload.mode,
    bootstrapPayload.range || "ALL",
    bootstrapPayload.assetClass || "all",
    bootstrapPayload.orderTab,
    JSON.stringify(bootstrapPayload.tradeFilters || {}),
    bootstrapPayload.performanceCalendarFrom || "",
  ].join(":");
};

const clearScheduledAccountPagePayloadFlush = () => {
  if (accountPagePayloadFlushTimer !== null) {
    clearTimeout(accountPagePayloadFlushTimer);
  }
  accountPagePayloadFlushTimer = null;
  accountPagePayloadFlushScheduled = false;
};

export const flushAccountPagePayloadQueue = () => {
  clearScheduledAccountPagePayloadFlush();
  const queued = pendingAccountPagePayloads.splice(0);
  queued.forEach((item) => {
    if (item.kind === "bootstrap") {
      applyAccountPagePayloadToCache(item.queryClient, item.payload);
    } else if (item.kind === "primary") {
      applyAccountPagePrimaryPayloadToCache(item.queryClient, item.payload);
    } else if (item.kind === "live") {
      applyAccountPageLivePayloadToCache(item.queryClient, item.payload);
    } else {
      applyAccountPageDerivedPayloadToCache(item.queryClient, item.payload);
    }
  });
};

const scheduleAccountPagePayloadFlush = () => {
  if (accountPagePayloadFlushScheduled) {
    return;
  }
  accountPagePayloadFlushScheduled = true;

  accountPagePayloadFlushTimer = scheduleRealtimeFlush(() => {
    accountPagePayloadFlushTimer = null;
    flushAccountPagePayloadQueue();
  });
};

export function queueAccountPagePayloadToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: "bootstrap",
  payload: AccountPageBootstrapPayload,
): void;
export function queueAccountPagePayloadToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: "primary",
  payload: AccountPagePrimaryPayload,
): void;
export function queueAccountPagePayloadToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: "live",
  payload: AccountPageLivePayload,
): void;
export function queueAccountPagePayloadToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: "derived",
  payload: AccountPageDerivedPayload,
): void;
export function queueAccountPagePayloadToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: QueuedAccountPagePayload["kind"],
  payload:
    | AccountPageBootstrapPayload
    | AccountPagePrimaryPayload
    | AccountPageLivePayload
    | AccountPageDerivedPayload,
) {
  const queueKey = accountPagePayloadQueueKey(kind, payload);
  const item = { kind, queryClient, payload, queueKey } as QueuedAccountPagePayload;
  const existingIndex = pendingAccountPagePayloads.findIndex(
    (pending) =>
      pending.queryClient === queryClient && pending.queueKey === queueKey,
  );
  if (existingIndex >= 0) {
    pendingAccountPagePayloads[existingIndex] = item;
  } else {
    pendingAccountPagePayloads.push(item);
  }
  scheduleAccountPagePayloadFlush();
}

export const applyIbkrAccountPayloadToCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: AccountStreamPayload,
  input: { accountId?: string | null; mode: StreamMode },
) => {
  queryClient
    .getQueryCache()
    .findAll({ queryKey: ["/api/accounts"] })
    .forEach((query) => {
      const params = readQueryParams(query.queryKey);
      if (!matchesMode(params, input.mode)) {
        return;
      }

      queryClient.setQueryData(query.queryKey, {
        accounts: payload.accounts,
      } satisfies AccountsResponse);
    });

  queryClient
    .getQueryCache()
    .findAll({ queryKey: ["/api/positions"] })
    .forEach((query) => {
      const params = readQueryParams(query.queryKey);
      if (!matchesMode(params, input.mode)) {
        return;
      }
      if (isInternalShadowAccountId(params?.accountId as string | null | undefined)) {
        return;
      }

      queryClient.setQueryData(query.queryKey, {
        positions: filterPositionsForQuery(payload.positions, query.queryKey),
      } satisfies PositionsResponse);
    });

  queryClient
    .getQueryCache()
    .findAll({
      predicate: (query) => {
        const path = queryKeyPath(query.queryKey);
        return Boolean(path?.startsWith("/api/accounts/"));
      },
    })
    .forEach((query) => {
      const params = readQueryParams(query.queryKey);
      if (!matchesMode(params, input.mode)) {
        return;
      }

      const path = queryKeyPath(query.queryKey);
      const summaryAccountId = accountIdFromScopedPath(path, "summary");
      if (summaryAccountId) {
        if (isInternalShadowAccountId(summaryAccountId)) {
          return;
        }
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountSummaryResponse | undefined) =>
            patchAccountSummaryFromStream(current, payload, summaryAccountId),
        );
        return;
      }

      const positionsAccountId = accountIdFromScopedPath(path, "positions");
      if (positionsAccountId) {
        if (isInternalShadowAccountId(positionsAccountId)) {
          return;
        }
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountPositionsResponse | undefined) =>
            patchAccountPositionsFromStream(
              current,
              payload,
              positionsAccountId,
              query.queryKey,
            ),
        );
        return;
      }

      const equityAccountId = accountIdFromScopedPath(path, "equity-history");
      if (!equityAccountId) {
        return;
      }
      if (isInternalShadowAccountId(equityAccountId)) {
        return;
      }

      const range = normalizeAccountHistoryRange(params?.range);
      if (!range) {
        return;
      }

      queryClient.setQueryData(
        query.queryKey,
        (current: LiveAccountEquityHistoryResponse | undefined) =>
          upsertLiveEquityTerminalPoint(
            current,
            payload,
            equityAccountId,
            range,
          ),
      );
    });

  const now = Date.now();
  if (now - lastAccountDerivedInvalidationAt >= ACCOUNT_DERIVED_INVALIDATION_THROTTLE_MS) {
    lastAccountDerivedInvalidationAt = now;
    invalidateAccountScopedQueries(
      queryClient,
      accountIdsFromAccountPayload(payload.accounts, input.accountId),
      input.mode,
      new Set(["allocation", "risk", "cash-activity", "closed-trades"]),
    );
  }
};

export const mergeQuotesIntoCache = (
  current: QuoteSnapshotsResponse | undefined,
  incomingQuotes: QuoteSnapshot[],
  requestedSymbols: string[],
): QuoteSnapshotsResponse | undefined => {
  const filteredQuotes = requestedSymbols.length
    ? requestedSymbols.flatMap((symbol) => {
        const nextQuote = incomingQuotes.find(
          (quote) => quote.symbol?.toUpperCase?.() === symbol,
        );
        return nextQuote ? [nextQuote] : [];
      })
    : incomingQuotes;

  if (!filteredQuotes.length && !current) {
    return current;
  }

  const currentBySymbol = new Map(
    (current?.quotes || []).map((quote) => [quote.symbol.toUpperCase(), quote]),
  );
  const acceptedQuotes: QuoteSnapshot[] = [];
  filteredQuotes.forEach((quote) => {
    const symbol = quote.symbol.toUpperCase();
    if (isQuoteSnapshotAtLeastAsFresh(quote, currentBySymbol.get(symbol))) {
      currentBySymbol.set(symbol, quote);
      acceptedQuotes.push(quote);
    }
  });

  const quotes = requestedSymbols.length
    ? requestedSymbols.flatMap((symbol) => {
        const quote = currentBySymbol.get(symbol);
        return quote ? [quote] : [];
      })
    : Array.from(currentBySymbol.values());

  return {
    ...(current || {
      quotes: [],
      transport: null,
      delayed: false,
      fallbackUsed: false,
    }),
    quotes,
    transport: acceptedQuotes[0]?.transport ?? current?.transport ?? null,
    delayed: quotes.some((quote) => quote.delayed),
    fallbackUsed: false,
  };
};

const getOptionExpirationSortTime = (
  expirationDate: string | null | undefined,
): number => {
  const match = String(expirationDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return Number.POSITIVE_INFINITY;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, monthIndex, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === monthIndex &&
    parsed.getUTCDate() === day
    ? timestamp
    : Number.POSITIVE_INFINITY;
};

export const mergeOptionChainContracts = (
  currentContracts: OptionChainResponse["contracts"] | undefined,
  nextContracts: OptionChainResponse["contracts"],
): OptionChainResponse["contracts"] => {
  const currentByProviderContractId = new Map(
    (currentContracts || [])
      .filter((contract) => contract.contract?.providerContractId)
      .map((contract) => [contract.contract.providerContractId || "", contract]),
  );

  const nextProviderContractIds = new Set(
    nextContracts
      .map((contract) => contract.contract?.providerContractId)
      .filter((providerContractId): providerContractId is string =>
        Boolean(providerContractId),
      ),
  );

  const mergedContracts = nextContracts.map((nextContract) => {
    const providerContractId = nextContract.contract?.providerContractId;
    if (!providerContractId) {
      return nextContract;
    }

    const currentContract = currentByProviderContractId.get(providerContractId);
    if (!currentContract) {
      return nextContract;
    }

    const currentUpdatedAt = new Date(currentContract.updatedAt).getTime();
    const nextUpdatedAt = new Date(nextContract.updatedAt).getTime();
    if (currentUpdatedAt <= nextUpdatedAt) {
      return nextContract;
    }

    return {
      ...nextContract,
      bid: currentContract.bid,
      ask: currentContract.ask,
      last: currentContract.last,
      mark: currentContract.mark,
      impliedVolatility: currentContract.impliedVolatility,
      delta: currentContract.delta,
      gamma: currentContract.gamma,
      theta: currentContract.theta,
      vega: currentContract.vega,
      volume: currentContract.volume,
      openInterest: currentContract.openInterest,
      updatedAt: currentContract.updatedAt,
    };
  });

  (currentContracts || []).forEach((currentContract) => {
    const providerContractId = currentContract.contract?.providerContractId;
    if (!providerContractId || nextProviderContractIds.has(providerContractId)) {
      return;
    }
    mergedContracts.push(currentContract);
  });

  return mergedContracts.sort(
    (left, right) =>
      getOptionExpirationSortTime(left.contract.expirationDate) -
        getOptionExpirationSortTime(right.contract.expirationDate) ||
      left.contract.strike - right.contract.strike ||
      left.contract.right.localeCompare(right.contract.right),
  );
};

export const patchOptionQuotesIntoContracts = (
  currentContracts: OptionChainResponse["contracts"] | undefined,
  incomingQuotes: LiveOptionQuoteSnapshot[],
): OptionChainResponse["contracts"] => {
  if (!currentContracts?.length || !incomingQuotes.length) {
    return currentContracts || [];
  }

  const quotesByProviderContractId = new Map(
    incomingQuotes
      .filter((quote) => quote.providerContractId)
      .map((quote) => [
        normalizeProviderContractId(quote.providerContractId),
        quote,
      ]),
  );

  let changed = false;
  const nextContracts = currentContracts.map((contract) => {
    const providerContractId = contract.contract?.providerContractId;
    if (!providerContractId) {
      return contract;
    }

    const quote = quotesByProviderContractId.get(
      normalizeProviderContractId(providerContractId),
    );
    if (!quote) {
      return contract;
    }

    const incomingBid = isPositiveFiniteNumber(quote.bid) ? quote.bid : null;
    const incomingAsk = isPositiveFiniteNumber(quote.ask) ? quote.ask : null;
    const incomingPrice = isPositiveFiniteNumber(quote.price) ? quote.price : null;
    const bid = incomingBid ?? contract.bid;
    const ask = incomingAsk ?? contract.ask;
    const last = incomingPrice ?? contract.last;
    const mark =
      incomingBid != null && incomingAsk != null
        ? (incomingBid + incomingAsk) / 2
        : incomingPrice != null
        ? incomingPrice
        : contract.mark;
    const updatedAt = quote.updatedAt ?? contract.updatedAt;
    const quoteHasUsableData = hasUsableOptionQuoteData(quote);
    const quoteFreshness =
      quote.freshness ??
      (quoteHasUsableData ? "live" : contract.quoteFreshness);
    const marketDataMode = quote.marketDataMode ?? contract.marketDataMode ?? null;
    const quoteUpdatedAt =
      quote.dataUpdatedAt ?? quote.updatedAt ?? contract.quoteUpdatedAt ?? null;
    const dataUpdatedAt =
      quote.dataUpdatedAt ?? quote.updatedAt ?? contract.dataUpdatedAt ?? null;
    const ageMs = quote.ageMs ?? contract.ageMs ?? null;

    if (
      contract.bid === bid &&
      contract.ask === ask &&
      contract.last === last &&
      contract.mark === mark &&
      contract.impliedVolatility ===
        (quote.impliedVolatility ?? contract.impliedVolatility) &&
      contract.delta === (quote.delta ?? contract.delta) &&
      contract.gamma === (quote.gamma ?? contract.gamma) &&
      contract.theta === (quote.theta ?? contract.theta) &&
      contract.vega === (quote.vega ?? contract.vega) &&
      contract.volume === (quote.volume ?? contract.volume) &&
      contract.openInterest === (quote.openInterest ?? contract.openInterest) &&
      contract.updatedAt === updatedAt &&
      contract.quoteFreshness === quoteFreshness &&
      contract.marketDataMode === marketDataMode &&
      contract.quoteUpdatedAt === quoteUpdatedAt &&
      contract.dataUpdatedAt === dataUpdatedAt &&
      contract.ageMs === ageMs
    ) {
      return contract;
    }

    changed = true;

    return {
      ...contract,
      bid,
      ask,
      last,
      mark,
      impliedVolatility: quote.impliedVolatility ?? contract.impliedVolatility,
      delta: quote.delta ?? contract.delta,
      gamma: quote.gamma ?? contract.gamma,
      theta: quote.theta ?? contract.theta,
      vega: quote.vega ?? contract.vega,
      volume: quote.volume ?? contract.volume,
      openInterest: quote.openInterest ?? contract.openInterest,
      updatedAt,
      quoteFreshness,
      marketDataMode,
      quoteUpdatedAt,
      dataUpdatedAt,
      ageMs,
    };
  });

  return changed ? nextContracts : currentContracts;
};

const mergeOptionChainResponse = (
  current: OptionChainResponse | undefined,
  nextContracts: OptionChainResponse["contracts"],
  underlying: string,
  expirationDate: string | null = null,
): OptionChainResponse => ({
  underlying,
  expirationDate: current?.expirationDate ?? expirationDate,
  contracts: mergeOptionChainContracts(current?.contracts, nextContracts),
});

export const getOptionChainContractExpirationKey = (
  contract: OptionChainResponse["contracts"][number],
): string | null => {
  const expirationDate = contract?.contract?.expirationDate;
  if (typeof expirationDate !== "string" || !expirationDate.trim()) {
    return null;
  }

  const match = expirationDate.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

export const groupOptionChainContractsByExpiration = (
  contracts: OptionChainResponse["contracts"],
): Map<string, OptionChainResponse["contracts"]> => {
  const contractsByExpiration = new Map<string, OptionChainResponse["contracts"]>();

  (contracts || []).forEach((contract) => {
    const expirationKey = getOptionChainContractExpirationKey(contract);
    if (!expirationKey) {
      return;
    }

    const current = contractsByExpiration.get(expirationKey) || [];
    current.push(contract);
    contractsByExpiration.set(expirationKey, current);
  });

  return contractsByExpiration;
};

const useQuoteSnapshotStream = ({
  streamPath,
  symbols,
  enabled = true,
  onQuotes,
}: {
  streamPath: string;
  symbols: string[];
  enabled?: boolean;
  onQuotes?: (quotes: QuoteSnapshot[]) => void;
}) => {
  const queryClient = useQueryClient();
  const onQuotesRef = useRef(onQuotes);
  const pendingQuoteStreamSnapshotsRef = useRef(new Map<string, QuoteSnapshot>());
  const quoteStreamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const normalizedSymbols = useMemo(() => normalizeSymbols(symbols), [symbols]);
  const streamUrl = useMemo(
    () =>
      buildStreamUrl(streamPath, {
        symbols: normalizedSymbols.join(","),
      }),
    [normalizedSymbols, streamPath],
  );

  useEffect(() => {
    onQuotesRef.current = onQuotes;
  }, [onQuotes]);

  useEffect(() => {
    const flushQuoteStreamSnapshots = () => {
      if (quoteStreamFlushTimerRef.current != null) {
        clearTimeout(quoteStreamFlushTimerRef.current);
        quoteStreamFlushTimerRef.current = null;
      }

      const acceptedQuotes = Array.from(
        pendingQuoteStreamSnapshotsRef.current.values(),
      );
      pendingQuoteStreamSnapshotsRef.current.clear();
      if (!acceptedQuotes.length) {
        return;
      }

      onQuotesRef.current?.(acceptedQuotes);

      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["/api/quotes/snapshot"] })
        .forEach((query) => {
          queryClient.setQueryData(
            query.queryKey,
            (current: QuoteSnapshotsResponse | undefined) =>
              mergeQuotesIntoCache(
                current,
                acceptedQuotes,
                readSymbolsParam(query.queryKey),
              ),
          );
        });
    };

    const scheduleQuoteStreamFlush = () => {
      if (quoteStreamFlushTimerRef.current != null) {
        return;
      }
      quoteStreamFlushTimerRef.current = setTimeout(
        flushQuoteStreamSnapshots,
        QUOTE_STREAM_CACHE_FLUSH_MS,
      );
    };

    if (
      !enabled ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return;
    }

    const source = new EventSource(streamUrl);
    const handleQuotes = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<QuoteStreamPayload>(event.data);
      if (!payload?.quotes?.length) {
        return;
      }

      const latestBySymbol = collectLatestCachedQuotesBySymbol(queryClient);
      pendingQuoteStreamSnapshotsRef.current.forEach((quote, symbol) => {
        if (isQuoteSnapshotAtLeastAsFresh(quote, latestBySymbol.get(symbol))) {
          latestBySymbol.set(symbol, quote);
        }
      });
      const acceptedQuotes = filterAcceptedQuoteSnapshots(
        payload.quotes,
        latestBySymbol,
      );
      if (!acceptedQuotes.length) {
        return;
      }

      acceptedQuotes.forEach((quote) => {
        const symbol = quote.symbol?.toUpperCase?.();
        if (symbol) {
          pendingQuoteStreamSnapshotsRef.current.set(symbol, quote);
          latestBySymbol.set(symbol, quote);
        }
      });
      scheduleQuoteStreamFlush();
    };

    source.addEventListener("quotes", handleQuotes as EventListener);
    return () => {
      source.removeEventListener("quotes", handleQuotes as EventListener);
      source.close();
      flushQuoteStreamSnapshots();
    };
  }, [enabled, queryClient, streamUrl]);
};

export const useIbkrQuoteSnapshotStream = ({
  symbols,
  enabled = true,
  onQuotes,
}: {
  symbols: string[];
  enabled?: boolean;
  onQuotes?: (quotes: QuoteSnapshot[]) => void;
}) =>
  useQuoteSnapshotStream({
    streamPath: "/api/streams/quotes",
    symbols,
    enabled,
    onQuotes,
  });

export const usePositionQuoteSnapshotStream = ({
  symbols,
  enabled = true,
  onQuotes,
}: {
  symbols: string[];
  enabled?: boolean;
  onQuotes?: (quotes: QuoteSnapshot[]) => void;
}) =>
  useQuoteSnapshotStream({
    streamPath: "/api/streams/position-quotes",
    symbols,
    enabled,
    onQuotes,
  });

export const useIbkrAccountSnapshotStream = ({
  accountId,
  mode,
  enabled = true,
}: {
  accountId?: string | null;
  mode: StreamMode;
  enabled?: boolean;
}) => {
  const queryClient = useQueryClient();
  const streamUrl = useMemo(
    () =>
      buildStreamUrl("/api/streams/accounts", {
        accountId: accountId ?? undefined,
        mode,
      }),
    [accountId, mode],
  );

  useEffect(() => {
    if (
      !enabled ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return;
    }

    const source = new EventSource(streamUrl);
    const handleAccounts = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<AccountStreamPayload>(event.data);
      if (!payload) {
        return;
      }

      markBrokerStreamEvent("account");
      applyIbkrAccountPayloadToCache(queryClient, payload, { accountId, mode });
    };
    const handleFreshness = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<{
        stream?: string;
        kind?: "live" | "derived";
        degraded?: boolean;
        stale?: boolean;
      }>(event.data);
      if (
        !payload ||
        (payload.stream && payload.stream !== "accounts") ||
        payload.degraded ||
        payload.stale
      ) {
        return;
      }
      markBrokerStreamEvent("account");
    };
    const handleReady = () => {
      markBrokerStreamEvent("account");
    };

    source.addEventListener("accounts", handleAccounts as EventListener);
    source.addEventListener("freshness", handleFreshness as EventListener);
    source.addEventListener("ready", handleReady as EventListener);
    return () => {
      source.removeEventListener("accounts", handleAccounts as EventListener);
      source.removeEventListener("freshness", handleFreshness as EventListener);
      source.removeEventListener("ready", handleReady as EventListener);
      source.close();
    };
  }, [accountId, enabled, mode, queryClient, streamUrl]);
};

export const useShadowAccountSnapshotStream = ({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) => {
  const queryClient = useQueryClient();
  const freshness = useShadowAccountStreamFreshnessSnapshot(enabled);
  const streamUrl = getShadowAccountStreamUrl();

  useEffect(() => {
    if (
      !enabled ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return;
    }

    const source = new EventSource(streamUrl);
    const handleAccounts = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<ShadowAccountStreamPayload>(event.data);
      if (!payload) {
        return;
      }

      markShadowAccountStreamEvent();
      applyShadowAccountPayloadToCache(queryClient, payload);
    };
    const handleFreshness = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<{
        stream?: string;
        kind?: "live" | "derived";
        degraded?: boolean;
        stale?: boolean;
      }>(event.data);
      if (
        !payload ||
        (payload.stream && payload.stream !== "shadow-accounts") ||
        payload.degraded ||
        payload.stale
      ) {
        return;
      }
      markShadowAccountStreamEvent();
    };
    const handleReady = () => {
      markShadowAccountStreamEvent();
    };

    source.addEventListener("accounts", handleAccounts as EventListener);
    source.addEventListener("freshness", handleFreshness as EventListener);
    source.addEventListener("ready", handleReady as EventListener);
    return () => {
      source.removeEventListener("accounts", handleAccounts as EventListener);
      source.removeEventListener("freshness", handleFreshness as EventListener);
      source.removeEventListener("ready", handleReady as EventListener);
      source.close();
    };
  }, [enabled, queryClient, streamUrl]);

  return freshness;
};

export const useAccountPageSnapshotStream = ({
  accountId,
  mode,
  range,
  orderTab,
  assetClass,
  tradeFilters,
  performanceCalendarFrom,
  enabled = true,
}: {
  accountId?: string | null;
  mode: StreamMode;
  range?: string | null;
  orderTab?: "working" | "history";
  assetClass?: string | null;
  tradeFilters?: AccountTradeFilterInput;
  performanceCalendarFrom?: string | null;
  enabled?: boolean;
}) => {
  const queryClient = useQueryClient();
  // Event timestamps live in refs, not state: they only feed the staleness
  // comparison, so mutating them must NOT itself re-render. The once-per-second
  // staleness check (recomputeFreshness) is what decides whether to commit, and
  // it only updates state when a fresh/stale boolean actually flips — so the host
  // re-renders on a flip instead of every second.
  const lastEventAtRef = useRef<number | null>(null);
  const lastPrimaryEventAtRef = useRef<number | null>(null);
  const lastLiveEventAtRef = useRef<number | null>(null);
  const lastDerivedEventAtRef = useRef<number | null>(null);
  const [freshness, setFreshness] = useState(() => ({
    accountLastEventAt: null as number | null,
    accountFresh: false,
    accountPrimaryFresh: false,
    accountLiveFresh: false,
    accountDerivedFresh: false,
  }));
  const recomputeFreshness = useCallback(() => {
    const nowMs = Date.now();
    const lastEventAt = lastEventAtRef.current;
    const lastPrimaryEventAt = lastPrimaryEventAtRef.current;
    const lastLiveEventAt = lastLiveEventAtRef.current;
    const lastDerivedEventAt = lastDerivedEventAtRef.current;
    const next = {
      accountLastEventAt: lastEventAt,
      accountFresh: isStreamFresh(lastEventAt, nowMs, ACCOUNT_PAGE_STREAM_FRESH_MS),
      accountPrimaryFresh: isStreamFresh(
        lastPrimaryEventAt,
        nowMs,
        ACCOUNT_PAGE_STREAM_FRESH_MS,
      ),
      accountLiveFresh: isStreamFresh(
        lastLiveEventAt,
        nowMs,
        ACCOUNT_PAGE_STREAM_FRESH_MS,
      ),
      accountDerivedFresh: isStreamFresh(
        lastDerivedEventAt,
        nowMs,
        ACCOUNT_PAGE_DERIVED_STREAM_FRESH_MS,
      ),
    };
    setFreshness((prev) => (freshnessUnchanged(prev, next) ? prev : next));
  }, []);
  const streamUrl = useMemo(
    () =>
      getAccountPageStreamUrl({
        accountId,
        mode,
        range,
        orderTab,
        assetClass,
        tradeFilters,
        performanceCalendarFrom,
      }),
    [
      accountId,
      assetClass,
      mode,
      orderTab,
      performanceCalendarFrom,
      range,
      tradeFilters?.from,
      tradeFilters?.assetClass,
      tradeFilters?.holdDuration,
      tradeFilters?.pnlSign,
      tradeFilters?.symbol,
      tradeFilters?.to,
    ],
  );

  useEffect(() => {
    if (!enabled) {
      lastEventAtRef.current = null;
      lastPrimaryEventAtRef.current = null;
      lastLiveEventAtRef.current = null;
      lastDerivedEventAtRef.current = null;
      recomputeFreshness();
      return undefined;
    }
    const interval = setInterval(recomputeFreshness, 1_000);
    return () => clearInterval(interval);
  }, [enabled, recomputeFreshness]);

  useEffect(() => {
    if (
      !enabled ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    lastEventAtRef.current = null;
    lastPrimaryEventAtRef.current = null;
    lastLiveEventAtRef.current = null;
    lastDerivedEventAtRef.current = null;
    recomputeFreshness();

    const markFresh = (kind: "primary" | "live" | "derived" | "both" = "both") => {
      const timestamp = Date.now();
      lastEventAtRef.current = timestamp;
      if (kind === "primary" || kind === "live" || kind === "both") {
        lastPrimaryEventAtRef.current = timestamp;
      }
      if (kind === "live" || kind === "both") {
        lastLiveEventAtRef.current = timestamp;
      }
      if (kind === "derived" || kind === "both") {
        lastDerivedEventAtRef.current = timestamp;
      }
      recomputeFreshness();
    };
    const source = new EventSource(streamUrl);
    const handleBootstrap = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<AccountPageBootstrapPayload>(event.data);
      if (!payload || payload.stream !== "account-page-bootstrap") {
        return;
      }
      markFresh("both");
      queueAccountPagePayloadToCache(queryClient, "bootstrap", payload);
    };
    const handlePrimary = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<AccountPagePrimaryPayload>(event.data);
      if (!payload || payload.stream !== "account-page-primary") {
        return;
      }
      markFresh("primary");
      queueAccountPagePayloadToCache(queryClient, "primary", payload);
    };
    const handleLive = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<AccountPageLivePayload>(event.data);
      if (!payload || payload.stream !== "account-page-live") {
        return;
      }
      markFresh("live");
      queueAccountPagePayloadToCache(queryClient, "live", payload);
    };
    const handleDerived = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<AccountPageDerivedPayload>(event.data);
      if (!payload || payload.stream !== "account-page-derived") {
        return;
      }
      markFresh("derived");
      queueAccountPagePayloadToCache(queryClient, "derived", payload);
    };
    const handleFreshness = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<{
        stream?: string;
        kind?: "primary" | "live" | "derived";
        degraded?: boolean;
        stale?: boolean;
      }>(event.data);
      if (
        !payload ||
        payload.stream !== "account-page" ||
        payload.degraded ||
        payload.stale
      ) {
        return;
      }
      markFresh(
        payload.kind === "primary" ||
          payload.kind === "live" ||
          payload.kind === "derived"
          ? payload.kind
          : "both",
      );
    };

    source.addEventListener("bootstrap", handleBootstrap as EventListener);
    source.addEventListener("primary", handlePrimary as EventListener);
    source.addEventListener("live", handleLive as EventListener);
    source.addEventListener("derived", handleDerived as EventListener);
    source.addEventListener("freshness", handleFreshness as EventListener);
    return () => {
      source.removeEventListener("bootstrap", handleBootstrap as EventListener);
      source.removeEventListener("primary", handlePrimary as EventListener);
      source.removeEventListener("live", handleLive as EventListener);
      source.removeEventListener("derived", handleDerived as EventListener);
      source.removeEventListener("freshness", handleFreshness as EventListener);
      source.close();
    };
  }, [enabled, queryClient, streamUrl, recomputeFreshness]);

  return freshness;
};

type SignalMatrixStreamState = Record<string, unknown> & {
  symbol?: string;
  timeframe?: string;
};

type SignalMatrixStreamPayload = {
  stream?: string;
  event?: string;
  states?: SignalMatrixStreamState[];
};

export const getSignalMonitorMatrixStreamUrl = ({
  environment,
  symbols,
  timeframes,
}: {
  environment?: string | null;
  symbols?: readonly string[];
  timeframes?: readonly string[];
}): string | null => {
  if (!symbols || symbols.length === 0) {
    return null;
  }
  return buildStreamUrl("/api/signal-monitor/matrix/stream", {
    environment: environment ?? undefined,
    symbols: symbols.join(","),
    timeframes: timeframes && timeframes.length ? timeframes.join(",") : undefined,
    requestOrigin: "signal-matrix-stream",
  });
};

// Push-based signal matrix feed. EventSource delivery is not throttled by the
// browser while the tab is backgrounded (unlike setInterval polling), so the
// signal matrix stays current while hidden and paints instantly on return —
// no freeze-then-catch-up. Runs alongside the REST poll; the merge in the host
// is idempotent (keyed by symbol/timeframe, newest wins).
export const useSignalMonitorMatrixStream = ({
  environment,
  symbols,
  timeframes,
  enabled = true,
  onStates,
}: {
  environment?: string | null;
  symbols?: readonly string[];
  timeframes?: readonly string[];
  enabled?: boolean;
  onStates: (
    states: SignalMatrixStreamState[],
    kind: "bootstrap" | "state-delta",
  ) => void;
}): void => {
  const onStatesRef = useRef(onStates);
  useEffect(() => {
    onStatesRef.current = onStates;
  }, [onStates]);

  const symbolsKey = (symbols ?? []).join(",");
  const timeframesKey = (timeframes ?? []).join(",");
  const streamUrl = useMemo(
    () => getSignalMonitorMatrixStreamUrl({ environment, symbols, timeframes }),
    // symbols/timeframes are arrays; the joined keys are the stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [environment, symbolsKey, timeframesKey],
  );

  useEffect(() => {
    if (
      !enabled ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }
    const source = new EventSource(streamUrl);
    const handleStates =
      (kind: "bootstrap" | "state-delta") =>
      (event: MessageEvent<string>) => {
        const payload = parseJsonPayload<SignalMatrixStreamPayload>(event.data);
        if (
          !payload ||
          payload.stream !== "signal-matrix" ||
          !Array.isArray(payload.states)
        ) {
          return;
        }
        onStatesRef.current(payload.states, kind);
      };
    const handleBootstrap = handleStates("bootstrap");
    const handleDelta = handleStates("state-delta");
    source.addEventListener("bootstrap", handleBootstrap as EventListener);
    source.addEventListener("state-delta", handleDelta as EventListener);
    return () => {
      source.removeEventListener("bootstrap", handleBootstrap as EventListener);
      source.removeEventListener("state-delta", handleDelta as EventListener);
      source.close();
    };
  }, [enabled, streamUrl]);
};

export const applyAlgoCockpitPayloadToCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  payload: AlgoCockpitStreamPayload,
) => {
  queryClient.setQueryData(
    getListAlgoDeploymentsQueryKey(),
    (current: AlgoDeploymentsResponse | undefined) =>
      resolveAlgoDeploymentsStreamCacheUpdate(current, payload.deployments),
  );

  const deploymentId = payload.deploymentId;
  const eventLimit = 20;
  queryClient.setQueryData(
    deploymentId
      ? getListExecutionEventsQueryKey({ deploymentId, limit: eventLimit })
      : getListExecutionEventsQueryKey({ limit: eventLimit }),
    payload.events,
  );

  const canonicalPayload = payload.phase === "full";

  if (canonicalPayload && deploymentId && payload.signalOptionsState) {
    queryClient.setQueryData(
      getGetSignalOptionsAutomationStateQueryKey(deploymentId),
      payload.signalOptionsState,
    );
  }
  if (canonicalPayload && deploymentId && payload.cockpit) {
    queryClient.setQueryData(
      getGetAlgoDeploymentCockpitQueryKey(deploymentId),
      payload.cockpit,
    );
  }
  if (canonicalPayload && deploymentId && payload.performance) {
    queryClient.setQueryData(
      getGetSignalOptionsPerformanceQueryKey(deploymentId),
      payload.performance,
    );
  }
  if (canonicalPayload && payload.signalMonitorProfile) {
    queryClient.setQueryData(
      getGetSignalMonitorProfileQueryKey({ environment: payload.mode }),
      payload.signalMonitorProfile,
    );
  }
};

export const useAlgoCockpitStream = ({
  deploymentId,
  mode,
  eventLimit = 20,
  enabled = true,
  onLiveEvents,
}: {
  deploymentId?: string | null;
  mode: StreamMode;
  eventLimit?: number;
  enabled?: boolean;
  onLiveEvents?: (
    events: ExecutionEventsResponse["events"],
    context: { phase: "primary" | "full" | null },
  ) => void;
}) => {
  const queryClient = useQueryClient();
  // See useAccountPageSnapshotStream: timestamps in refs (mutating them must not
  // re-render); the once-per-second recomputeFreshness commits only when a
  // fresh/stale boolean flips, so the host re-renders on a flip, not every second.
  const lastEventAtRef = useRef<number | null>(null);
  const lastPrimaryEventAtRef = useRef<number | null>(null);
  const lastFullEventAtRef = useRef<number | null>(null);
  const [freshness, setFreshness] = useState(() => ({
    algoLastEventAt: null as number | null,
    algoFresh: false,
    algoPrimaryFresh: false,
    algoFullFresh: false,
  }));
  const recomputeFreshness = useCallback(() => {
    const nowMs = Date.now();
    const lastEventAt = lastEventAtRef.current;
    const lastPrimaryEventAt = lastPrimaryEventAtRef.current;
    const lastFullEventAt = lastFullEventAtRef.current;
    const next = {
      algoLastEventAt: lastEventAt,
      algoFresh: isStreamFresh(lastEventAt, nowMs, ALGO_COCKPIT_STREAM_FRESH_MS),
      algoPrimaryFresh: isStreamFresh(
        lastPrimaryEventAt,
        nowMs,
        ALGO_COCKPIT_STREAM_FRESH_MS,
      ),
      algoFullFresh: isStreamFresh(
        lastFullEventAt,
        nowMs,
        ALGO_COCKPIT_STREAM_FRESH_MS,
      ),
    };
    setFreshness((prev) => (freshnessUnchanged(prev, next) ? prev : next));
  }, []);
  const onLiveEventsRef = useRef(onLiveEvents);
  const streamUrl = useMemo(
    () => getAlgoCockpitStreamUrl({ deploymentId, mode, eventLimit }),
    [deploymentId, eventLimit, mode],
  );

  useEffect(() => {
    onLiveEventsRef.current = onLiveEvents;
  }, [onLiveEvents]);

  useEffect(() => {
    if (!enabled) {
      lastEventAtRef.current = null;
      lastPrimaryEventAtRef.current = null;
      lastFullEventAtRef.current = null;
      recomputeFreshness();
      return undefined;
    }
    const interval = setInterval(recomputeFreshness, 1_000);
    return () => clearInterval(interval);
  }, [enabled, recomputeFreshness]);

  useEffect(() => {
    if (
      !enabled ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return undefined;
    }

    lastEventAtRef.current = null;
    lastPrimaryEventAtRef.current = null;
    lastFullEventAtRef.current = null;
    recomputeFreshness();

    const markFresh = (kind: "primary" | "full" | "heartbeat" = "heartbeat") => {
      const timestamp = Date.now();
      lastEventAtRef.current = timestamp;
      if (kind === "primary" || kind === "full") {
        lastPrimaryEventAtRef.current = timestamp;
      }
      if (kind === "full") {
        lastFullEventAtRef.current = timestamp;
      }
      recomputeFreshness();
    };
    const source = new EventSource(streamUrl);
    const applyPayload = (
      event: MessageEvent<string>,
      expectedStream: AlgoCockpitStreamPayload["stream"],
    ) => {
      const payload = parseJsonPayload<AlgoCockpitStreamPayload>(event.data);
      if (!payload || payload.stream !== expectedStream) {
        return;
      }
      markFresh(payload.phase === "full" ? "full" : "primary");
      applyAlgoCockpitPayloadToCache(queryClient, payload);
      if (expectedStream === "algo-cockpit-live") {
        onLiveEventsRef.current?.(payload.events?.events ?? [], {
          phase: payload.phase ?? null,
        });
      }
    };
    const handleBootstrap = (event: MessageEvent<string>) => {
      applyPayload(event, "algo-cockpit-bootstrap");
    };
    const handleLive = (event: MessageEvent<string>) => {
      applyPayload(event, "algo-cockpit-live");
    };
    const handleFreshness = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<{
        stream?: string;
        phase?: "primary" | "full" | null;
        stale?: boolean;
        degraded?: boolean;
      }>(event.data);
      if (
        !payload ||
        payload.stream !== "algo-cockpit" ||
        payload.stale ||
        payload.degraded
      ) {
        return;
      }
      if (payload.phase === "full") {
        markFresh("full");
      } else if (payload.phase === "primary") {
        markFresh("primary");
      } else {
        markFresh("heartbeat");
      }
    };
    const handleReady = () => {
      markFresh("heartbeat");
    };

    source.addEventListener("bootstrap", handleBootstrap as EventListener);
    source.addEventListener("live", handleLive as EventListener);
    source.addEventListener("freshness", handleFreshness as EventListener);
    source.addEventListener("ready", handleReady as EventListener);
    return () => {
      source.removeEventListener("bootstrap", handleBootstrap as EventListener);
      source.removeEventListener("live", handleLive as EventListener);
      source.removeEventListener("freshness", handleFreshness as EventListener);
      source.removeEventListener("ready", handleReady as EventListener);
      source.close();
    };
  }, [enabled, queryClient, streamUrl, recomputeFreshness]);

  return useMemo(
    () => ({
      deploymentId: deploymentId ?? null,
      deploymentScoped: Boolean(deploymentId),
      ...freshness,
    }),
    [deploymentId, freshness],
  );
};

export const useIbkrOrderSnapshotStream = ({
  accountId,
  mode,
  enabled = true,
}: {
  accountId?: string | null;
  mode: StreamMode;
  enabled?: boolean;
}) => {
  const queryClient = useQueryClient();
  const streamUrl = useMemo(
    () =>
      buildStreamUrl("/api/streams/orders", {
        accountId: accountId ?? undefined,
        mode,
      }),
    [accountId, mode],
  );

  useEffect(() => {
    if (
      !enabled ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return;
    }

    const source = new EventSource(streamUrl);
    const handleOrders = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<OrderStreamPayload>(event.data);
      if (!payload) {
        return;
      }

      markBrokerStreamEvent("order");
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["/api/orders"] })
        .forEach((query) => {
          const params = readQueryParams(query.queryKey);
          if (!matchesMode(params, mode)) {
            return;
          }

          queryClient.setQueryData(query.queryKey, {
            orders: filterOrdersForQuery(payload.orders, query.queryKey),
          } satisfies OrdersResponse);
        });

      queryClient
        .getQueryCache()
        .findAll({
          predicate: (query) => {
            const path = queryKeyPath(query.queryKey);
            return Boolean(path?.startsWith("/api/accounts/"));
          },
        })
        .forEach((query) => {
          const params = readQueryParams(query.queryKey);
          if (!matchesMode(params, mode)) {
            return;
          }

          const accountOrdersAccountId = accountIdFromScopedPath(
            queryKeyPath(query.queryKey),
            "orders",
          );
          if (!accountOrdersAccountId) {
            return;
          }

          queryClient.setQueryData(
            query.queryKey,
            (current: AccountOrdersResponse | undefined) =>
              patchAccountOrdersFromStream(
                current,
                payload.orders,
                accountOrdersAccountId,
                query.queryKey,
              ),
          );
        });

      const now = Date.now();
      if (now - lastOrderInvalidationAt >= ORDER_INVALIDATION_THROTTLE_MS) {
        lastOrderInvalidationAt = now;
        invalidateAccountScopedQueries(
          queryClient,
          [
            "combined",
            ...(accountId ? [accountId] : []),
            ...payload.orders.map((order) => order.accountId).filter(Boolean),
          ],
          mode,
          new Set(["positions", "summary", "risk"]),
        );
      }
    };
    const handleFreshness = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<{
        stream?: string;
        degraded?: boolean;
        stale?: boolean;
      }>(event.data);
      if (
        !payload ||
        (payload.stream && payload.stream !== "orders") ||
        payload.degraded ||
        payload.stale
      ) {
        return;
      }
      markBrokerStreamEvent("order");
    };
    const handleReady = () => {
      markBrokerStreamEvent("order");
    };

    source.addEventListener("orders", handleOrders as EventListener);
    source.addEventListener("freshness", handleFreshness as EventListener);
    source.addEventListener("ready", handleReady as EventListener);
    return () => {
      source.removeEventListener("orders", handleOrders as EventListener);
      source.removeEventListener("freshness", handleFreshness as EventListener);
      source.removeEventListener("ready", handleReady as EventListener);
      source.close();
    };
  }, [accountId, enabled, mode, queryClient, streamUrl]);
};

export const useIbkrOptionChainStream = ({
  underlying,
  enabled = true,
}: {
  underlying?: string | null;
  enabled?: boolean;
}) => {
  const queryClient = useQueryClient();
  const normalizedUnderlying = underlying?.trim?.().toUpperCase?.() || "";
  const streamUrl = useMemo(
    () =>
      buildStreamUrl("/api/streams/options/chains", {
        underlyings: normalizedUnderlying || undefined,
      }),
    [normalizedUnderlying],
  );

  useEffect(() => {
    if (
      !enabled ||
      !normalizedUnderlying ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return;
    }

    const source = new EventSource(streamUrl);
    const handleChains = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<OptionChainStreamPayload>(event.data);
      const nextUnderlying = payload?.underlyings?.find(
        (entry) => entry.underlying?.toUpperCase?.() === normalizedUnderlying,
      );
      if (!nextUnderlying) {
        return;
      }

      const contracts = nextUnderlying.contracts || [];
      seedOptionQuoteSnapshotsFromContracts(contracts);

      groupOptionChainContractsByExpiration(contracts).forEach(
        (expirationContracts, expirationKey) => {
          const fallbackQueryKey = [
            "trade-option-chain",
            normalizedUnderlying,
            expirationKey,
          ];
          const matchingQueries = queryClient
            .getQueryCache()
            .findAll({ queryKey: fallbackQueryKey });
          const nextResponse = (current: OptionChainResponse | undefined) =>
            mergeOptionChainResponse(
              current,
              expirationContracts,
              normalizedUnderlying,
              `${expirationKey}T00:00:00.000Z`,
            );

          matchingQueries.forEach((query) => {
            queryClient.setQueryData(query.queryKey, nextResponse);
          });
          if (!matchingQueries.length) {
            queryClient.setQueryData(fallbackQueryKey, nextResponse);
          }
        },
      );
    };

    source.addEventListener("chains", handleChains as EventListener);
    return () => {
      source.removeEventListener("chains", handleChains as EventListener);
      source.close();
    };
  }, [enabled, normalizedUnderlying, queryClient, streamUrl]);
};

export const useIbkrOptionQuoteStream = ({
  underlying,
  providerContractIds,
  enabled = true,
  owner,
  intent = "visible-live",
  requiresGreeks = true,
}: {
  underlying?: string | null;
  providerContractIds: string[];
  enabled?: boolean;
  owner?: string | null;
  intent?: OptionQuoteStreamIntent;
  requiresGreeks?: boolean;
}) => {
  const queryClient = useQueryClient();
  const normalizedUnderlying = underlying?.trim?.().toUpperCase?.() || "";
  const providerContractIdSignature = providerContractIds
    .map((providerContractId) => providerContractId?.trim?.() || "")
    .filter(Boolean)
    .join("\u001f");
  const normalizedProviderContractIds = useMemo(
    () =>
      Array.from(
        new Set(
          providerContractIdSignature
            ? providerContractIdSignature.split("\u001f")
            : [],
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [providerContractIdSignature],
  );
  const normalizedOwner = owner?.trim?.() || "";
  const webSocketUrl = useMemo(
    () =>
      OPTION_QUOTE_WEBSOCKET_ENABLED
        ? buildWebSocketUrl("/api/ws/options/quotes")
        : null,
    [],
  );

  useEffect(() => {
    if (
      !enabled ||
      normalizedProviderContractIds.length === 0 ||
      typeof window === "undefined"
    ) {
      return;
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let restFallbackTimer: ReturnType<typeof setInterval> | null = null;
    let stallTimer: ReturnType<typeof setInterval> | null = null;
    let quoteFlushScheduled = false;
    let quoteFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const queuedQuotesByProviderContractId = new Map<
      string,
      LiveOptionQuoteSnapshot
    >();
    let firstQuoteStartedAt = Date.now();
    let firstQuoteRecorded = false;
    let lastWebSocketMessageAt = Date.now();
    let socketGeneration = 0;
    let fallbackCursor = 0;

    const applyQuotesNow = (
      quotes: LiveOptionQuoteSnapshot[],
      options: { alreadyCached?: boolean } = {},
    ) => {
      if (!quotes.length) {
        return;
      }
      if (!options.alreadyCached && !firstQuoteRecorded) {
        firstQuoteRecorded = true;
        recordOptionHydrationMetric(
          "firstQuoteMs",
          Math.max(0, Date.now() - firstQuoteStartedAt),
        );
      }

      const cachedQuotes = options.alreadyCached
        ? quotes
        : quotes.map(cacheOptionQuoteSnapshot);
      queryClient
        .getQueryCache()
        .findAll({
          predicate: (query) => {
            const path = queryKeyPath(query.queryKey);
            return Boolean(
              path?.startsWith("/api/accounts/") && path.endsWith("/positions"),
            );
          },
        })
        .forEach((query) => {
          queryClient.setQueryData(
            query.queryKey,
            (current: AccountPositionsResponse | undefined) =>
              patchAccountPositionsFromOptionQuotes(current, cachedQuotes),
          );
        });
    };

    if (OPTION_QUOTE_SHARED_CLIENT_SOCKET_ENABLED) {
      return subscribeSharedOptionQuoteStream({
        underlying: normalizedUnderlying || null,
        providerContractIds: normalizedProviderContractIds,
        owner: normalizedOwner || null,
        intent,
        requiresGreeks,
        onQuotes: (quotes) => applyQuotesNow(quotes, { alreadyCached: true }),
      });
    }

    const flushQueuedQuotes = () => {
      quoteFlushScheduled = false;
      quoteFlushTimer = null;
      if (closed) {
        queuedQuotesByProviderContractId.clear();
        return;
      }

      const quotes = Array.from(queuedQuotesByProviderContractId.values());
      queuedQuotesByProviderContractId.clear();
      applyQuotesNow(quotes);
    };

    const scheduleQueuedQuoteFlush = () => {
      if (quoteFlushScheduled) {
        return;
      }
      quoteFlushScheduled = true;
      quoteFlushTimer = scheduleRealtimeFlush(flushQueuedQuotes);
    };

    const queueQuotes = (quotes: LiveOptionQuoteSnapshot[]) => {
      quotes.forEach((quote) => {
        const providerContractId = normalizeProviderContractId(
          quote.providerContractId,
        );
        if (!providerContractId) {
          return;
        }
        queuedQuotesByProviderContractId.set(providerContractId, quote);
      });
      if (queuedQuotesByProviderContractId.size) {
        scheduleQueuedQuoteFlush();
      }
    };

    const stopRestFallback = () => {
      if (restFallbackTimer) {
        clearInterval(restFallbackTimer);
        restFallbackTimer = null;
      }
    };

    const stopStallWatchdog = () => {
      if (stallTimer) {
        clearInterval(stallTimer);
        stallTimer = null;
      }
    };

    const nextFallbackProviderContractIds = () => {
      if (
        normalizedProviderContractIds.length <=
        OPTION_QUOTE_REST_FALLBACK_BATCH_SIZE
      ) {
        return normalizedProviderContractIds;
      }

      const start = fallbackCursor % normalizedProviderContractIds.length;
      const end = start + OPTION_QUOTE_REST_FALLBACK_BATCH_SIZE;
      const batch =
        end <= normalizedProviderContractIds.length
          ? normalizedProviderContractIds.slice(start, end)
          : [
              ...normalizedProviderContractIds.slice(start),
              ...normalizedProviderContractIds.slice(
                0,
                end - normalizedProviderContractIds.length,
              ),
            ];
      fallbackCursor =
        (start + OPTION_QUOTE_REST_FALLBACK_BATCH_SIZE) %
        normalizedProviderContractIds.length;
      return batch;
    };

    const requestRestSnapshot = async (fallbackMode: "rest-rotating") => {
      const fallbackProviderContractIds = nextFallbackProviderContractIds();
      if (closed || fallbackProviderContractIds.length === 0) {
        return;
      }
      const startedAt = Date.now();
      try {
        const payload = await getOptionQuoteSnapshots({
          underlying: normalizedUnderlying,
          providerContractIds: fallbackProviderContractIds,
          owner: normalizedOwner || undefined,
          intent,
          requiresGreeks,
        });
        recordOptionHydrationMetric(
          "quoteSnapshotMs",
          Math.max(0, Date.now() - startedAt),
        );
        setOptionHydrationDiagnostics({
          fallbackMode,
          providerMode: payload.debug?.providerMode ?? undefined,
          returnedQuotes: payload.debug?.returnedCount ?? payload.quotes.length,
          requestedQuotes: normalizedProviderContractIds.length,
          acceptedQuotes: normalizedProviderContractIds.length,
          rejectedQuotes: 0,
        });
        queueQuotes(payload.quotes as LiveOptionQuoteSnapshot[]);
      } catch {
        setOptionHydrationDiagnostics({
          fallbackMode,
          quoteMode: "rest-fallback-error",
        });
      }
    };

    const startRestFallback = () => {
      if (closed || restFallbackTimer) {
        return;
      }
      setOptionHydrationDiagnostics({
        quoteMode: "rest-fallback",
        fallbackMode: "rest-rotating",
        requestedQuotes: normalizedProviderContractIds.length,
        acceptedQuotes: normalizedProviderContractIds.length,
        rejectedQuotes: 0,
      });

      void requestRestSnapshot("rest-rotating");
      restFallbackTimer = setInterval(() => {
        void requestRestSnapshot("rest-rotating");
      }, 3_000);
    };

    const startWebSocket = () => {
      if (
        closed ||
        !webSocketUrl ||
        typeof window.WebSocket === "undefined"
      ) {
        startRestFallback();
        return;
      }

      let ready = false;
      let fallbackStarted = false;
      const generation = ++socketGeneration;
      firstQuoteStartedAt = Date.now();
      lastWebSocketMessageAt = Date.now();
      setOptionHydrationDiagnostics({
        wsState: "connecting",
        quoteMode: "websocket",
        fallbackMode: null,
        requestedQuotes: normalizedProviderContractIds.length,
      });
      socket = new WebSocket(webSocketUrl);
      stopStallWatchdog();
      stallTimer = setInterval(() => {
        if (closed || !ready || fallbackStarted) {
          return;
        }
        const ageMs = Date.now() - lastWebSocketMessageAt;
        if (ageMs < OPTION_QUOTE_WEBSOCKET_STALL_MS) {
          return;
        }
        setOptionHydrationDiagnostics({
          wsState: "stalled",
          quoteMode: "websocket-stalled",
          degraded: true,
        });
        socket?.close();
      }, Math.max(1_000, Math.floor(OPTION_QUOTE_WEBSOCKET_STALL_MS / 2)));

      const fallbackToRest = () => {
        if (closed || fallbackStarted) {
          return;
        }
        fallbackStarted = true;
        if (socket && socket.readyState === window.WebSocket.OPEN) {
          socket.close();
        }
        if (socket && socket.readyState !== window.WebSocket.OPEN) {
          socket = null;
        }
        startRestFallback();
      };

      socket.addEventListener("open", () => {
        if (closed || generation !== socketGeneration) {
          socket?.close();
          return;
        }
        setOptionHydrationDiagnostics({ wsState: "open" });
        socket?.send(
          JSON.stringify({
            type: "subscribe",
            underlying: normalizedUnderlying,
            providerContractIds: normalizedProviderContractIds,
            owner: normalizedOwner || undefined,
            intent,
            requiresGreeks,
          }),
        );
      });

      socket.addEventListener("message", (event: MessageEvent<string>) => {
        if (closed || generation !== socketGeneration) {
          return;
        }
        lastWebSocketMessageAt = Date.now();
        const payload = parseJsonPayload<OptionQuoteWebSocketPayload>(event.data);
        if (!payload) {
          return;
        }
        if (payload.type === "ready") {
          ready = true;
          setOptionHydrationDiagnostics({
            wsState: "ready",
            requestedQuotes:
              payload.requestedCount ?? normalizedProviderContractIds.length,
            acceptedQuotes:
              payload.acceptedCount ?? normalizedProviderContractIds.length,
            rejectedQuotes: payload.rejectedCount ?? 0,
          });
          return;
        }
        if (payload.type === "status") {
          setOptionHydrationDiagnostics({
            wsState: ready ? "ready" : "connecting",
            providerMode: payload.providerMode ?? undefined,
            requestedQuotes:
              payload.requestedCount ?? normalizedProviderContractIds.length,
            acceptedQuotes: payload.acceptedCount,
            rejectedQuotes: payload.rejectedCount,
            returnedQuotes: payload.returnedCount,
            bufferedAmount: payload.bufferedAmount,
            degraded: payload.degraded,
          });
          return;
        }
        if (payload.type === "heartbeat") {
          setOptionHydrationDiagnostics({
            bufferedAmount: payload.bufferedAmount,
            degraded: payload.degraded,
          });
          return;
        }
        if (payload.type === "quotes" && payload.quotes?.length) {
          queueQuotes(payload.quotes);
          return;
        }
        if (payload.type === "error" && !ready) {
          fallbackToRest();
        }
      });

      socket.addEventListener("error", () => {
        if (generation !== socketGeneration) {
          return;
        }
        if (!ready) {
          fallbackToRest();
        }
      });

      socket.addEventListener("close", (event) => {
        if (generation !== socketGeneration) {
          return;
        }
        stopStallWatchdog();
        setOptionHydrationDiagnostics({
          wsState: ready ? "closed" : "failed-before-ready",
          pauseReason: event.reason || null,
        });
        if (closed || fallbackStarted) {
          return;
        }
        if (!ready) {
          fallbackToRest();
          return;
        }

        setOptionHydrationDiagnostics({ wsState: "reconnecting" });
        reconnectTimer = setTimeout(startWebSocket, 1_000);
      });
    };

    startWebSocket();

    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopRestFallback();
      stopStallWatchdog();
      if (quoteFlushTimer !== null) {
        clearTimeout(quoteFlushTimer);
        quoteFlushTimer = null;
      }
      quoteFlushScheduled = false;
      queuedQuotesByProviderContractId.clear();
      socket?.close();
    };
  }, [
    enabled,
    intent,
    normalizedProviderContractIds,
    normalizedUnderlying,
    normalizedOwner,
    queryClient,
    requiresGreeks,
    webSocketUrl,
  ]);
};

export const __liveStreamsInternalsForTests = {
  accountPositionsParams,
  applyAlgoCockpitPayloadToCache,
  mergeAccountPositionRowsById,
  optionPositionProviderContractIds,
  patchAccountPositionsFromStream,
  patchAccountPositionRowFromOptionQuote,
  primaryAccountPositionsUseLiveQuotes,
  resolveAlgoDeploymentsStreamCacheUpdate,
  resolveSharedOptionQuoteStreamDemand,
};
