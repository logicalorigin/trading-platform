import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getOptionQuoteSnapshots } from "@workspace/api-client-react";
import { usePageVisible } from "./usePageVisible";
import {
  recordOptionHydrationMetric,
  setOptionHydrationDiagnostics,
} from "./optionHydrationDiagnostics";
import type {
  AccountAllocationResponse,
  AccountOrdersResponse,
  AccountPositionsResponse,
  AccountRiskResponse,
  AccountSummaryResponse,
  AccountEquityHistoryResponse,
  AccountEquityPoint,
  AccountsResponse,
  BrokerAccount,
  OptionChainResponse,
  OrdersResponse,
  PositionsResponse,
  QuoteSnapshot,
  QuoteSnapshotsResponse,
} from "@workspace/api-client-react";

type StreamMode = "paper" | "live";

type QuoteStreamPayload = {
  quotes: QuoteSnapshot[];
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
  terminalPointSource?:
    | "live_account_summary"
    | "persisted_snapshot"
    | "flex"
    | "shadow_ledger"
    | null;
  liveTerminalIncluded?: boolean;
};

type ShadowAccountStreamPayload = {
  summary: AccountSummaryResponse;
  positions: AccountPositionsResponse;
  workingOrders: AccountOrdersResponse;
  historyOrders: AccountOrdersResponse;
  allocation: AccountAllocationResponse;
  risk: AccountRiskResponse;
  equityHistory?: unknown;
  updatedAt: string;
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
};

const hasUsableOptionQuoteData = (quote: LiveOptionQuoteSnapshot): boolean =>
  (isFiniteNumber(quote.bid) && quote.bid > 0) ||
  (isFiniteNumber(quote.ask) && quote.ask > 0) ||
  (isFiniteNumber(quote.price) && quote.price > 0) ||
  (isFiniteNumber(quote.volume) && quote.volume > 0) ||
  (isFiniteNumber(quote.openInterest) && quote.openInterest > 0) ||
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
  | "visible-live"
  | "automation-live"
  | "flow-scanner-live"
  | "convenience-live"
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
// Hard cap on the in-memory option-quote snapshot cache. An option chain for a
// single underlying can have ~100 contracts; a cap of 1024 fits ~10 underlyings'
// worth of chains while protecting against unbounded growth as users browse.
const MAX_OPTION_QUOTE_SNAPSHOTS = 1_024;
const OPTION_QUOTE_REST_FALLBACK_BATCH_SIZE = 100;
const OPTION_QUOTE_WEBSOCKET_ENABLED = true;
const OPTION_QUOTE_WEBSOCKET_STALL_MS = 15_000;

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
  left.updatedAt === right.updatedAt &&
  left.source === right.source &&
  left.transport === right.transport &&
  left.delayed === right.delayed &&
  left.freshness === right.freshness &&
  left.marketDataMode === right.marketDataMode &&
  left.dataUpdatedAt === right.dataUpdatedAt &&
  left.ageMs === right.ageMs;

const normalizeProviderContractId = (
  providerContractId: string | null | undefined,
): string => providerContractId?.trim?.() || "";

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
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(flushOptionQuoteNotifications);
    return;
  }
  setTimeout(flushOptionQuoteNotifications, 0);
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

  const cachedQuote = {
    ...currentQuote,
    ...quote,
    providerContractId: normalizedProviderContractId,
  };

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

export const isQuoteSnapshotAtLeastAsFresh = (
  incoming: QuoteSnapshot,
  current: QuoteSnapshot | undefined,
): boolean => {
  if (!current) {
    return true;
  }

  const incomingUpdatedAt = readQuoteTimestampMs(incoming.updatedAt);
  const currentUpdatedAt = readQuoteTimestampMs(current.updatedAt);

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

  const incomingReceivedAt = readQuoteReceivedAtMs(incoming);
  const currentReceivedAt = readQuoteReceivedAtMs(current);
  return (
    currentReceivedAt === null ||
    incomingReceivedAt === null ||
    incomingReceivedAt >= currentReceivedAt
  );
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
  const externalTransferAmount = (point: AccountEquityPoint): number =>
    (isFiniteNumber(point.deposits) ? point.deposits : 0) -
    (isFiniteNumber(point.withdrawals) ? point.withdrawals : 0);
  const firstPoint = points[0] ?? null;
  const firstPointTransfer = firstPoint ? externalTransferAmount(firstPoint) : 0;
  const initialPreviousNav = firstPoint
    ? firstPointTransfer > 0
      ? Math.max(0, firstPoint.netLiquidation - firstPointTransfer)
      : firstPoint.netLiquidation - firstPointTransfer
    : null;
  const baseline =
    initialPreviousNav !== null && Math.abs(initialPreviousNav) > 0
      ? initialPreviousNav
      : (points.find((point) => Math.abs(Number(point.netLiquidation)) > 0)
          ?.netLiquidation ??
        firstPoint?.netLiquidation ??
        0);
  let previousNav: number | null = initialPreviousNav;
  let cumulativePnl = 0;
  let capitalBase = Math.max(
    Math.abs(baseline),
    Math.abs(firstPoint?.netLiquidation ?? 0),
  );

  return points.map((point, index) => {
    const transfer = externalTransferAmount(point);
    if (index > 0 && transfer > 0) {
      capitalBase += transfer;
    }
    const pnlDelta =
      previousNav === null ? 0 : point.netLiquidation - previousNav - transfer;
    cumulativePnl += pnlDelta;
    previousNav = point.netLiquidation;

    return {
      ...point,
      returnPercent: capitalBase ? (cumulativePnl / capitalBase) * 100 : 0,
    };
  });
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

const shadowPositionsForQuery = (
  positionsResponse: AccountPositionsResponse,
  queryKey: unknown,
): AccountPositionsResponse => {
  const params = readQueryParams(queryKey);
  const requestedAssetClass =
    typeof params?.assetClass === "string" ? params.assetClass : null;
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
    positions: openPositions.filter(
      (position) =>
        String(position.assetClass || "").toLowerCase() ===
        requestedAssetClass.toLowerCase(),
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
      if (!matchesMode(readQueryParams(query.queryKey), "paper")) {
        return;
      }

      const path = queryKeyPath(query.queryKey);
      if (path === "/api/accounts/shadow/summary") {
        queryClient.setQueryData(query.queryKey, payload.summary);
      } else if (path === "/api/accounts/shadow/positions") {
        queryClient.setQueryData(
          query.queryKey,
          shadowPositionsForQuery(payload.positions, query.queryKey),
        );
      } else if (path === "/api/accounts/shadow/orders") {
        queryClient.setQueryData(
          query.queryKey,
          shadowOrdersForQuery(payload, query.queryKey),
        );
      } else if (path === "/api/accounts/shadow/allocation") {
        queryClient.setQueryData(query.queryKey, payload.allocation);
      } else if (path === "/api/accounts/shadow/risk") {
        queryClient.setQueryData(query.queryKey, payload.risk);
      }
    });

  invalidateVisibleAccountDerivedQueries(queryClient, ["shadow"], "paper");
};

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
        queryClient.setQueryData(
          query.queryKey,
          (current: AccountSummaryResponse | undefined) =>
            patchAccountSummaryFromStream(current, payload, summaryAccountId),
        );
        return;
      }

      const equityAccountId = accountIdFromScopedPath(path, "equity-history");
      if (!equityAccountId) {
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

  invalidateVisibleAccountDerivedQueries(
    queryClient,
    accountIdsFromAccountPayload(payload.accounts, input.accountId),
    input.mode,
    { includeEquityHistory: false },
  );
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
      new Date(left.contract.expirationDate).getTime() -
        new Date(right.contract.expirationDate).getTime() ||
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

    const bid = isFiniteNumber(quote.bid) ? quote.bid : contract.bid;
    const ask = isFiniteNumber(quote.ask) ? quote.ask : contract.ask;
    const last = isFiniteNumber(quote.price) ? quote.price : contract.last;
    const mark =
      bid != null && ask != null && bid > 0 && ask > 0
        ? (bid + ask) / 2
        : isFiniteNumber(last)
        ? last
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

const mergeOptionQuotesIntoCache = (
  current: OptionChainResponse | undefined,
  incomingQuotes: LiveOptionQuoteSnapshot[],
  underlying: string,
): OptionChainResponse | undefined => {
  if (!current?.contracts?.length) {
    return current;
  }

  const contracts = patchOptionQuotesIntoContracts(
    current.contracts,
    incomingQuotes,
  );
  if (contracts === current.contracts) {
    return current;
  }

  return {
    underlying,
    expirationDate: current.expirationDate ?? null,
    contracts,
  };
};

export const useIbkrQuoteSnapshotStream = ({
  symbols,
  enabled = true,
  onQuotes,
}: {
  symbols: string[];
  enabled?: boolean;
  onQuotes?: (quotes: QuoteSnapshot[]) => void;
}) => {
  const queryClient = useQueryClient();
  const pageVisible = usePageVisible();
  const normalizedSymbols = useMemo(() => normalizeSymbols(symbols), [symbols]);
  const streamUrl = useMemo(
    () =>
      buildStreamUrl("/api/streams/quotes", {
        symbols: normalizedSymbols.join(","),
      }),
    [normalizedSymbols],
  );

  useEffect(() => {
    if (
      !enabled ||
      !pageVisible ||
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
      const acceptedQuotes = filterAcceptedQuoteSnapshots(
        payload.quotes,
        latestBySymbol,
      );
      if (!acceptedQuotes.length) {
        return;
      }

      onQuotes?.(acceptedQuotes);

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

    source.addEventListener("quotes", handleQuotes as EventListener);
    return () => {
      source.removeEventListener("quotes", handleQuotes as EventListener);
      source.close();
    };
  }, [enabled, onQuotes, pageVisible, queryClient, streamUrl]);
};

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

      applyIbkrAccountPayloadToCache(queryClient, payload, { accountId, mode });
    };

    source.addEventListener("accounts", handleAccounts as EventListener);
    return () => {
      source.removeEventListener("accounts", handleAccounts as EventListener);
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
  const streamUrl = useMemo(
    () => buildStreamUrl("/api/streams/accounts/shadow", {}),
    [],
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
      const payload = parseJsonPayload<ShadowAccountStreamPayload>(event.data);
      if (!payload) {
        return;
      }

      applyShadowAccountPayloadToCache(queryClient, payload);
    };

    source.addEventListener("accounts", handleAccounts as EventListener);
    return () => {
      source.removeEventListener("accounts", handleAccounts as EventListener);
      source.close();
    };
  }, [enabled, queryClient, streamUrl]);
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

      invalidateAccountScopedQueries(
        queryClient,
        [
          "combined",
          ...(accountId ? [accountId] : []),
          ...payload.orders.map((order) => order.accountId).filter(Boolean),
        ],
        mode,
        new Set(["orders", "positions", "summary", "risk"]),
      );
    };

    source.addEventListener("orders", handleOrders as EventListener);
    return () => {
      source.removeEventListener("orders", handleOrders as EventListener);
      source.close();
    };
  }, [enabled, mode, queryClient, streamUrl]);
};

export const useIbkrOptionChainStream = ({
  underlying,
  enabled = true,
}: {
  underlying?: string | null;
  enabled?: boolean;
}) => {
  const queryClient = useQueryClient();
  const pageVisible = usePageVisible();
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
      !pageVisible ||
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
  }, [enabled, normalizedUnderlying, pageVisible, queryClient, streamUrl]);
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
  const pageVisible = usePageVisible();
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
      ),
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
      !pageVisible ||
      !normalizedUnderlying ||
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
    let quoteFlushFrame: number | null = null;
    let quoteFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const queuedQuotesByProviderContractId = new Map<
      string,
      LiveOptionQuoteSnapshot
    >();
    let firstQuoteStartedAt = Date.now();
    let firstQuoteRecorded = false;
    let lastWebSocketMessageAt = Date.now();

    const applyQuotesNow = (quotes: LiveOptionQuoteSnapshot[]) => {
      if (!quotes.length) {
        return;
      }
      if (!firstQuoteRecorded) {
        firstQuoteRecorded = true;
        recordOptionHydrationMetric(
          "firstQuoteMs",
          Math.max(0, Date.now() - firstQuoteStartedAt),
        );
      }

      quotes.forEach(cacheOptionQuoteSnapshot);

      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["trade-option-chain", normalizedUnderlying] })
        .forEach((query) => {
          queryClient.setQueryData(
            query.queryKey,
            (current: OptionChainResponse | undefined) =>
              mergeOptionQuotesIntoCache(
                current,
                quotes,
                normalizedUnderlying,
              ),
          );
        });
    };

    const flushQueuedQuotes = () => {
      quoteFlushFrame = null;
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
      if (quoteFlushFrame !== null || quoteFlushTimer !== null) {
        return;
      }
      if (typeof window.requestAnimationFrame === "function") {
        quoteFlushFrame = window.requestAnimationFrame(flushQueuedQuotes);
        return;
      }
      quoteFlushTimer = setTimeout(flushQueuedQuotes, 0);
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

    const startRestFallback = () => {
      if (closed || restFallbackTimer) {
        return;
      }
      let fallbackCursor = 0;
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
      setOptionHydrationDiagnostics({
        quoteMode: "rest-fallback",
        fallbackMode: "rest-rotating",
        requestedQuotes: normalizedProviderContractIds.length,
        acceptedQuotes: normalizedProviderContractIds.length,
        rejectedQuotes: 0,
      });

      const poll = async () => {
        const fallbackProviderContractIds = nextFallbackProviderContractIds();
        if (closed || fallbackProviderContractIds.length === 0) {
          return;
        }
        const startedAt = Date.now();
        try {
          const payload = await getOptionQuoteSnapshots({
            underlying: normalizedUnderlying,
            providerContractIds: fallbackProviderContractIds,
          });
          recordOptionHydrationMetric(
            "quoteSnapshotMs",
            Math.max(0, Date.now() - startedAt),
          );
          setOptionHydrationDiagnostics({
            providerMode: payload.debug?.providerMode ?? undefined,
            returnedQuotes: payload.debug?.returnedCount ?? payload.quotes.length,
            requestedQuotes: normalizedProviderContractIds.length,
            acceptedQuotes: normalizedProviderContractIds.length,
            rejectedQuotes: 0,
          });
          queueQuotes(payload.quotes as LiveOptionQuoteSnapshot[]);
        } catch {
          setOptionHydrationDiagnostics({
            quoteMode: "rest-fallback-error",
            fallbackMode: "rest-rotating",
          });
        }
      };

      void poll();
      restFallbackTimer = setInterval(() => {
        void poll();
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
        socket?.close();
        startRestFallback();
      };

      socket.addEventListener("open", () => {
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
        if (!ready) {
          fallbackToRest();
        }
      });

      socket.addEventListener("close", () => {
        stopStallWatchdog();
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
      if (quoteFlushFrame !== null) {
        window.cancelAnimationFrame(quoteFlushFrame);
        quoteFlushFrame = null;
      }
      if (quoteFlushTimer !== null) {
        clearTimeout(quoteFlushTimer);
        quoteFlushTimer = null;
      }
      queuedQuotesByProviderContractId.clear();
      socket?.close();
    };
  }, [
    enabled,
    intent,
    normalizedProviderContractIds,
    normalizedUnderlying,
    normalizedOwner,
    pageVisible,
    queryClient,
    requiresGreeks,
    webSocketUrl,
  ]);
};
