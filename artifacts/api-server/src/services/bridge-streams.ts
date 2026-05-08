import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";
import { HttpError, isHttpError } from "../lib/errors";
import {
  isBridgeWorkBackedOff,
  isTransientBridgeWorkError,
  runBridgeWork,
} from "./bridge-governor";
import {
  listIbkrAccounts,
  listIbkrExecutions,
  listIbkrPositions,
} from "./ibkr-account-bridge";
import {
  getBridgeOrderReadSuppression,
  markBridgeOrderReadsSuppressed,
} from "./bridge-order-read-state";
import type {
  HistoryBarTimeframe,
  HistoryDataSource,
} from "../providers/ibkr/client";
import {
  fetchBridgeQuoteSnapshots,
  subscribeBridgeQuoteSnapshots,
} from "./bridge-quote-stream";
import {
  fetchBridgeOptionQuoteSnapshots,
  subscribeBridgeOptionQuoteSnapshots,
  type OptionQuoteSnapshotPayload,
} from "./bridge-option-quote-stream";
import type {
  MarketDataFallbackProvider,
  MarketDataIntent,
  MarketDataLineRequest,
} from "./market-data-admission";
import {
  admitMarketDataLeases,
  releaseMarketDataLeases,
} from "./market-data-admission";
import { recordAccountSnapshots } from "./account";
import { getOptionChain } from "./platform";

const bridgeClient = new IbkrBridgeClient();
const ORDER_SNAPSHOT_STALE_MS = 120_000;
const STREAM_RECONNECT_MIN_MS = 1_000;
const STREAM_RECONNECT_MAX_MS = 30_000;
const ACCOUNT_MONITOR_LEASE_TTL_MS = 15_000;

type Unsubscribe = () => void;
type OrderSnapshotPayload = {
  orders: Awaited<ReturnType<IbkrBridgeClient["listOrders"]>>;
};
const orderSnapshotCache = new Map<
  string,
  { payload: OrderSnapshotPayload; cachedAt: number }
>();
const accountMonitorSnapshots = new Map<
  string,
  {
    mode: "paper" | "live";
    accountId?: string;
    positions: Awaited<ReturnType<IbkrBridgeClient["listPositions"]>>;
    orders: Awaited<ReturnType<IbkrBridgeClient["listOrders"]>>;
  }
>();

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function accountStreamIntervalMs(): number {
  return Math.max(
    1_000,
    readPositiveIntegerEnv("IBKR_ACCOUNT_STREAM_INTERVAL_MS", 2_000),
  );
}

export function orderStreamIntervalMs(): number {
  return Math.max(
    1_000,
    readPositiveIntegerEnv("IBKR_ORDER_STREAM_INTERVAL_MS", 2_000),
  );
}

function orderSnapshotTimeoutMs(): number {
  return readPositiveIntegerEnv(
    "IBKR_ORDER_STREAM_TIMEOUT_MS",
    readPositiveIntegerEnv("IBKR_ORDER_READ_TIMEOUT_MS", 5_000),
  );
}

function isOrderSnapshotTimeoutError(error: unknown): boolean {
  if (!isHttpError(error)) {
    return false;
  }
  const cause = error.cause;
  return (
    error.code === "orders_timeout" ||
    (cause instanceof HttpError && cause.code === "orders_timeout")
  );
}

function nextReconnectDelay(attempt: number): number {
  return Math.min(
    STREAM_RECONNECT_MAX_MS,
    STREAM_RECONNECT_MIN_MS * 2 ** Math.max(0, attempt),
  );
}

function accountMonitorOwner(input: {
  mode: "paper" | "live";
  accountId?: string;
}): string {
  return `account-monitor:${input.mode}:${input.accountId?.trim() || "all"}`;
}

function isWorkingOrderStatus(status: unknown): boolean {
  return !["filled", "canceled", "rejected", "expired"].includes(
    String(status || "").toLowerCase(),
  );
}

function marketDataRequestFromInstrument(input: {
  symbol?: string | null;
  assetClass?: string | null;
  optionContract?: { providerContractId?: unknown; underlying?: unknown } | null;
}): MarketDataLineRequest | null {
  const assetClass = input.assetClass === "option" ? "option" : "equity";
  const symbol = normalizeSymbol(
    String(input.optionContract?.underlying ?? input.symbol ?? ""),
  );

  if (assetClass === "option") {
    const providerContractId =
      typeof input.optionContract?.providerContractId === "string"
        ? input.optionContract.providerContractId.trim()
        : String(input.optionContract?.providerContractId ?? "").trim();
    if (!providerContractId) {
      return symbol ? { assetClass: "equity", symbol } : null;
    }
    return {
      assetClass: "option",
      symbol,
      underlying: symbol,
      providerContractId,
      requiresGreeks: true,
    };
  }

  return symbol ? { assetClass: "equity", symbol } : null;
}

function refreshAccountMonitorLeases(input: {
  mode: "paper" | "live";
  accountId?: string;
}): void {
  const key = accountMonitorOwner(input);
  const snapshot = accountMonitorSnapshots.get(key);
  const requestsByKey = new Map<string, MarketDataLineRequest>();

  snapshot?.positions.forEach((position) => {
    if (Math.abs(Number(position.quantity ?? 0)) <= 1e-9) {
      return;
    }
    const request = marketDataRequestFromInstrument(position);
    if (request) {
      requestsByKey.set(
        `${request.assetClass}:${request.providerContractId ?? request.symbol}`,
        request,
      );
    }
  });

  snapshot?.orders.forEach((order) => {
    if (!isWorkingOrderStatus(order.status)) {
      return;
    }
    const remainingQuantity =
      Number(order.quantity ?? 0) - Number(order.filledQuantity ?? 0);
    if (remainingQuantity <= 1e-9) {
      return;
    }
    const request = marketDataRequestFromInstrument(order);
    if (request) {
      requestsByKey.set(
        `${request.assetClass}:${request.providerContractId ?? request.symbol}`,
        request,
      );
    }
  });

  const requests = Array.from(requestsByKey.values());
  if (!requests.length) {
    releaseMarketDataLeases(key, "account_monitor_empty");
    return;
  }

  admitMarketDataLeases({
    owner: key,
    intent: "account-monitor-live",
    requests,
    ttlMs: ACCOUNT_MONITOR_LEASE_TTL_MS,
    fallbackProvider: "polygon",
  });
}

function updateAccountMonitorPositions(input: {
  mode: "paper" | "live";
  accountId?: string;
  positions: Awaited<ReturnType<IbkrBridgeClient["listPositions"]>>;
}): void {
  const key = accountMonitorOwner(input);
  const current = accountMonitorSnapshots.get(key);
  accountMonitorSnapshots.set(key, {
    mode: input.mode,
    accountId: input.accountId,
    positions: input.positions,
    orders: current?.orders ?? [],
  });
  refreshAccountMonitorLeases(input);
}

function updateAccountMonitorOrders(input: {
  mode: "paper" | "live";
  accountId?: string;
  orders: Awaited<ReturnType<IbkrBridgeClient["listOrders"]>>;
}): void {
  const key = accountMonitorOwner(input);
  const current = accountMonitorSnapshots.get(key);
  accountMonitorSnapshots.set(key, {
    mode: input.mode,
    accountId: input.accountId,
    positions: current?.positions ?? [],
    orders: input.orders,
  });
  refreshAccountMonitorLeases(input);
}

function createPollingStream<T>({
  intervalMs,
  fetchSnapshot,
  onSnapshot,
  onPollSuccess,
}: {
  intervalMs: number;
  fetchSnapshot: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
  onPollSuccess?: (input: { snapshot: T; changed: boolean }) => void | Promise<void>;
}): Unsubscribe {
  let active = true;
  let inFlight = false;
  let lastSignature = "";

  const tick = async () => {
    if (!active || inFlight) {
      return;
    }

    inFlight = true;

    try {
      const snapshot = await fetchSnapshot();
      if (!active) {
        return;
      }

      const signature = stableStringify(snapshot);
      const changed = signature !== lastSignature;

      if (changed) {
        lastSignature = signature;
        onSnapshot(snapshot);
      }
      await onPollSuccess?.({ snapshot, changed });
    } catch (error) {
      logger.warn({ err: error }, "Bridge stream polling failed");
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  void tick();

  return () => {
    active = false;
    clearInterval(timer);
  };
}

type OptionChainSnapshotPayload = {
  underlyings: Array<{
    underlying: string;
    contracts: Awaited<ReturnType<IbkrBridgeClient["getOptionChain"]>>;
    updatedAt: string;
  }>;
};

type HistoricalBarSnapshotPayload = {
  symbol: string;
  timeframe: HistoryBarTimeframe;
  bar:
    | (Awaited<ReturnType<IbkrBridgeClient["getHistoricalBars"]>>[number] & {
        source: string;
      })
    | null;
};

export async function fetchQuoteSnapshotPayload(symbols: string[]): Promise<{
  quotes: Array<
    Awaited<ReturnType<IbkrBridgeClient["getQuoteSnapshots"]>>[number] & {
      source: "ibkr";
    }
  >;
}> {
  return fetchBridgeQuoteSnapshots(symbols);
}

export async function fetchOptionChainSnapshotPayload(
  underlyings: string[],
): Promise<OptionChainSnapshotPayload> {
  const normalizedUnderlyings = Array.from(
    new Set(
      underlyings.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
    ),
  );

  return {
    underlyings: await Promise.all(
      normalizedUnderlyings.map(async (underlying) => ({
        underlying,
        contracts: (await getOptionChain({ underlying })).contracts,
        updatedAt: new Date().toISOString(),
      })),
    ),
  };
}

export async function fetchOptionQuoteSnapshotPayload(input: {
  underlying?: string | null;
  providerContractIds: string[];
  owner?: string;
  intent?: MarketDataIntent;
  ttlMs?: number;
  fallbackProvider?: MarketDataFallbackProvider;
  requiresGreeks?: boolean;
}): Promise<OptionQuoteSnapshotPayload> {
  return fetchBridgeOptionQuoteSnapshots(input);
}

export async function fetchHistoricalBarSnapshotPayload(input: {
  symbol: string;
  timeframe: HistoryBarTimeframe;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  outsideRth?: boolean;
  source?: HistoryDataSource;
}): Promise<HistoricalBarSnapshotPayload> {
  const bars = await bridgeClient.getHistoricalBars({
    symbol: normalizeSymbol(input.symbol),
    timeframe: input.timeframe,
    limit: 1,
    assetClass: input.assetClass,
    providerContractId: input.providerContractId ?? null,
    outsideRth: input.outsideRth,
    source: input.source,
  });

  return {
    symbol: normalizeSymbol(input.symbol),
    timeframe: input.timeframe,
    bar:
      bars[bars.length - 1] != null
        ? {
            ...bars[bars.length - 1],
            partial: true,
          }
        : null,
  };
}

export async function fetchOrderSnapshotPayload(input: {
  accountId?: string;
  mode: "paper" | "live";
  status?:
    | "pending_submit"
    | "submitted"
    | "accepted"
    | "partially_filled"
    | "filled"
    | "canceled"
    | "rejected"
    | "expired";
}): Promise<OrderSnapshotPayload> {
  const cacheKey = stableStringify({
    accountId: input.accountId ?? null,
    mode: input.mode,
    status: input.status ?? null,
  });
  const cached = orderSnapshotCache.get(cacheKey);
  const suppression = getBridgeOrderReadSuppression();

  if (suppression) {
    return cached && Date.now() - cached.cachedAt <= ORDER_SNAPSHOT_STALE_MS
      ? cached.payload
      : { orders: [] };
  }

  if (isBridgeWorkBackedOff("orders")) {
    if (cached && Date.now() - cached.cachedAt <= ORDER_SNAPSHOT_STALE_MS) {
      return cached.payload;
    }
    return { orders: [] };
  }

  const timeoutMs = orderSnapshotTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new HttpError(504, "IBKR order stream snapshot timed out.", {
        code: "orders_timeout",
        detail: `Order stream snapshot did not respond within ${timeoutMs}ms.`,
      }),
    );
  }, timeoutMs);
  timeout.unref?.();

  try {
    const payload = await runBridgeWork("orders", async () => ({
      orders: (
        await bridgeClient.listOrdersWithMeta({
          ...input,
          signal: controller.signal,
        })
      ).orders,
    }));
    orderSnapshotCache.set(cacheKey, { payload, cachedAt: Date.now() });
    updateAccountMonitorOrders({
      mode: input.mode,
      accountId: input.accountId,
      orders: payload.orders,
    });
    return payload;
  } catch (error) {
    if (isOrderSnapshotTimeoutError(error)) {
      markBridgeOrderReadsSuppressed({
        reason: "orders_timeout",
        message:
          "Open-orders snapshots are paused after the bridge order endpoint did not respond.",
        ttlMs: 60_000,
      });
      logger.warn(
        { timeoutMs },
        "Returning empty order snapshot after order stream timeout",
      );
      return cached && Date.now() - cached.cachedAt <= ORDER_SNAPSHOT_STALE_MS
        ? cached.payload
        : { orders: [] };
    }
    if (
      isTransientBridgeWorkError(error) &&
      cached &&
      Date.now() - cached.cachedAt <= ORDER_SNAPSHOT_STALE_MS
    ) {
      return cached.payload;
    }
    if (isTransientBridgeWorkError(error)) {
      logger.warn({ err: error }, "Returning empty order snapshot after transient bridge failure");
      return { orders: [] };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAccountSnapshotPayload(input: {
  accountId?: string;
  mode: "paper" | "live";
}): Promise<{
  accounts: Awaited<ReturnType<IbkrBridgeClient["listAccounts"]>>;
  positions: Awaited<ReturnType<IbkrBridgeClient["listPositions"]>>;
}> {
  const accounts = await listIbkrAccounts(input.mode);
  void recordAccountSnapshots(accounts).catch((error) => {
    logger.warn({ err: error }, "Failed to record account balance snapshots");
  });
  const positions = await listIbkrPositions(input);
  updateAccountMonitorPositions({
    mode: input.mode,
    accountId: input.accountId,
    positions,
  });

  return {
    accounts,
    positions,
  };
}

export async function fetchExecutionSnapshotPayload(input: {
  accountId?: string;
  days?: number;
  limit?: number;
  symbol?: string;
  providerContractId?: string | null;
}): Promise<{
  executions: Awaited<ReturnType<IbkrBridgeClient["listExecutions"]>>;
}> {
  return {
    executions: await listIbkrExecutions(input),
  };
}

export async function fetchMarketDepthSnapshotPayload(input: {
  accountId?: string;
  symbol: string;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  exchange?: string | null;
}): Promise<{
  depth: Awaited<ReturnType<IbkrBridgeClient["getMarketDepth"]>>;
}> {
  return {
    depth: await bridgeClient.getMarketDepth(input),
  };
}

export function subscribeQuoteSnapshots(
  symbols: string[],
  onSnapshot: (payload: {
    quotes: Array<
      Awaited<ReturnType<IbkrBridgeClient["getQuoteSnapshots"]>>[number] & {
        source: "ibkr";
      }
    >;
  }) => void,
): Unsubscribe {
  const normalizedSymbols = Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );

  return subscribeBridgeQuoteSnapshots(normalizedSymbols, onSnapshot);
}

export function subscribeOptionChains(
  underlyings: string[],
  onSnapshot: (payload: {
    underlyings: Array<{
      underlying: string;
      contracts: Awaited<ReturnType<IbkrBridgeClient["getOptionChain"]>>;
      updatedAt: string;
    }>;
  }) => void,
): Unsubscribe {
  const normalizedUnderlyings = Array.from(
    new Set(underlyings.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );

  return createPollingStream({
    intervalMs: 15_000,
    fetchSnapshot: async () =>
      fetchOptionChainSnapshotPayload(normalizedUnderlyings),
    onSnapshot,
  });
}

export function subscribeOptionQuoteSnapshots(
  input: {
    underlying?: string | null;
    providerContractIds: string[];
    owner?: string;
    intent?: MarketDataIntent;
    fallbackProvider?: MarketDataFallbackProvider;
    requiresGreeks?: boolean;
  },
  onSnapshot: (payload: OptionQuoteSnapshotPayload) => void,
): Unsubscribe {
  return subscribeBridgeOptionQuoteSnapshots(input, onSnapshot);
}

export function subscribeHistoricalBarSnapshots(
  input: {
    symbol: string;
    timeframe: HistoryBarTimeframe;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    outsideRth?: boolean;
    source?: HistoryDataSource;
  },
  onSnapshot: (payload: HistoricalBarSnapshotPayload) => void,
  onStreamError?: (error: unknown) => void,
): Unsubscribe {
  let active = true;
  let unsubscribe: Unsubscribe = () => {};
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;

  const connect = () => {
    unsubscribe = bridgeClient.streamHistoricalBars(
      {
        symbol: normalizeSymbol(input.symbol),
        timeframe: input.timeframe,
        assetClass: input.assetClass,
        providerContractId: input.providerContractId ?? null,
        outsideRth: input.outsideRth,
        source: input.source,
      },
      (bar) => {
        onSnapshot({
          symbol: normalizeSymbol(input.symbol),
          timeframe: input.timeframe,
          bar,
        });
        reconnectAttempt = 0;
      },
      (error) => {
        logger.warn({ err: error }, "Bridge historical bar stream failed");
        onStreamError?.(error);
        unsubscribe();
        if (!active || reconnectTimer) {
          return;
        }

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (active) {
            connect();
          }
        }, nextReconnectDelay(reconnectAttempt));
        reconnectAttempt += 1;
        reconnectTimer.unref?.();
      },
    );
  };

  connect();

  return () => {
    active = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    unsubscribe();
  };
}

export function subscribeOrderSnapshots(
  input: {
    accountId?: string;
    mode: "paper" | "live";
    status?: "pending_submit" | "submitted" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
  },
  onSnapshot: (payload: { orders: Awaited<ReturnType<IbkrBridgeClient["listOrders"]>> }) => void,
  options: {
    onPollSuccess?: (input: {
      payload: { orders: Awaited<ReturnType<IbkrBridgeClient["listOrders"]>> };
      changed: boolean;
    }) => void | Promise<void>;
  } = {},
): Unsubscribe {
  return createPollingStream({
    intervalMs: orderStreamIntervalMs(),
    fetchSnapshot: async () => fetchOrderSnapshotPayload(input),
    onSnapshot,
    onPollSuccess: ({ snapshot, changed }) =>
      options.onPollSuccess?.({ payload: snapshot, changed }),
  });
}

export function subscribeAccountSnapshots(
  input: {
    accountId?: string;
    mode: "paper" | "live";
  },
  onSnapshot: (payload: {
    accounts: Awaited<ReturnType<IbkrBridgeClient["listAccounts"]>>;
    positions: Awaited<ReturnType<IbkrBridgeClient["listPositions"]>>;
  }) => void,
  options: {
    onPollSuccess?: (input: {
      payload: {
        accounts: Awaited<ReturnType<IbkrBridgeClient["listAccounts"]>>;
        positions: Awaited<ReturnType<IbkrBridgeClient["listPositions"]>>;
      };
      changed: boolean;
    }) => void | Promise<void>;
  } = {},
): Unsubscribe {
  return createPollingStream({
    intervalMs: accountStreamIntervalMs(),
    fetchSnapshot: async () => fetchAccountSnapshotPayload(input),
    onSnapshot,
    onPollSuccess: ({ snapshot, changed }) =>
      options.onPollSuccess?.({ payload: snapshot, changed }),
  });
}

export function subscribeExecutionSnapshots(
  input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  },
  onSnapshot: (payload: {
    executions: Awaited<ReturnType<IbkrBridgeClient["listExecutions"]>>;
  }) => void,
): Unsubscribe {
  return createPollingStream({
    intervalMs: 1_000,
    fetchSnapshot: async () => fetchExecutionSnapshotPayload(input),
    onSnapshot,
  });
}

export function subscribeMarketDepthSnapshots(
  input: {
    accountId?: string;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  },
  onSnapshot: (payload: {
    depth: Awaited<ReturnType<IbkrBridgeClient["getMarketDepth"]>>;
  }) => void,
): Unsubscribe {
  return createPollingStream({
    intervalMs: 1_000,
    fetchSnapshot: async () => fetchMarketDepthSnapshotPayload(input),
    onSnapshot,
  });
}
