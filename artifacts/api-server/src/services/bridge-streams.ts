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
import { recordAccountSnapshots } from "./account";
import { getOptionChain } from "./platform";

const bridgeClient = new IbkrBridgeClient();
const ORDER_SNAPSHOT_STALE_MS = 120_000;
const STREAM_RECONNECT_MIN_MS = 1_000;
const STREAM_RECONNECT_MAX_MS = 30_000;

type Unsubscribe = () => void;
type OrderSnapshotPayload = {
  orders: Awaited<ReturnType<IbkrBridgeClient["listOrders"]>>;
};
const orderSnapshotCache = new Map<
  string,
  { payload: OrderSnapshotPayload; cachedAt: number }
>();

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

function createPollingStream<T>({
  intervalMs,
  fetchSnapshot,
  onSnapshot,
}: {
  intervalMs: number;
  fetchSnapshot: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
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

      if (signature !== lastSignature) {
        lastSignature = signature;
        onSnapshot(snapshot);
      }
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

  return {
    accounts,
    positions: await listIbkrPositions(input),
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
): Unsubscribe {
  return createPollingStream({
    intervalMs: 5_000,
    fetchSnapshot: async () => fetchOrderSnapshotPayload(input),
    onSnapshot,
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
): Unsubscribe {
  return createPollingStream({
    intervalMs: 3_000,
    fetchSnapshot: async () => fetchAccountSnapshotPayload(input),
    onSnapshot,
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
