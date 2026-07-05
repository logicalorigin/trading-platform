import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
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
  clearBridgeOrderReadSuppression,
  getBridgeOrderReadSuppression,
  markBridgeOrderReadsSuppressed,
  shouldProbeBridgeOrderReadSuppression,
} from "./bridge-order-read-state";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import { subscribeMassiveStockQuoteSnapshots } from "./massive-stock-quote-stream";
import {
  fetchBridgeOptionQuoteSnapshots,
  type OptionQuoteSnapshotPayload,
} from "./bridge-option-quote-stream";
import {
  readIbkrLiveDemandState,
  subscribeIbkrLiveDemand,
} from "./ibkr-live-demand-coordinator";
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
import {
  getOptionChain,
  getQuoteSnapshots,
  OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS,
} from "./platform";

const bridgeClient = new IbkrBridgeClient();
const ORDER_SNAPSHOT_STALE_MS = 120_000;
const ACCOUNT_MONITOR_LEASE_TTL_MS = 15_000;
let nextOptionQuoteDemandStreamId = 1;

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
    mode: "shadow" | "live";
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

function accountMonitorOwner(input: {
  mode: "shadow" | "live";
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
  optionContract?: {
    providerContractId?: unknown;
    underlying?: unknown;
    expirationDate?: unknown;
    strike?: unknown;
    right?: unknown;
    multiplier?: unknown;
    sharesPerContract?: unknown;
  } | null;
}, options: {
  massiveStocksRealtime: boolean;
}): MarketDataLineRequest | null {
  const assetClass =
    input.optionContract ||
    String(input.assetClass ?? "").trim().toLowerCase().startsWith("option")
      ? "option"
      : "equity";
  const symbol = normalizeSymbol(
    String(input.optionContract?.underlying ?? input.symbol ?? ""),
  );

  if (assetClass === "option") {
    const providerContractId =
      structuredOptionProviderContractIdFromInstrument(input) ??
      (typeof input.optionContract?.providerContractId === "string"
        ? input.optionContract.providerContractId.trim()
        : String(input.optionContract?.providerContractId ?? "").trim());
    if (!providerContractId) {
      return options.massiveStocksRealtime
        ? null
        : symbol
          ? { assetClass: "equity", symbol }
          : null;
    }
    return {
      assetClass: "option",
      symbol,
      underlying: symbol,
      providerContractId,
      requiresGreeks: !options.massiveStocksRealtime,
    };
  }

  return symbol ? { assetClass: "equity", symbol } : null;
}

function finiteOptionNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function optionExpirationKey(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10).replaceAll("-", "");
  }
  const text = String(value ?? "").trim();
  if (/^\d{8}$/.test(text)) {
    return text;
  }
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`;
  }
  const parsed = text ? new Date(text) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toISOString().slice(0, 10).replaceAll("-", "")
    : null;
}

function optionRightCode(value: unknown): "C" | "P" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "call" || normalized === "c") {
    return "C";
  }
  if (normalized === "put" || normalized === "p") {
    return "P";
  }
  return null;
}

function normalizeOpraOptionTicker(value: unknown): string | null {
  const normalized =
    typeof value === "string"
      ? value.trim().toUpperCase().replace(/\s+/g, "")
      : "";
  if (!normalized) {
    return null;
  }
  const ticker = normalized.startsWith("O:") ? normalized : `O:${normalized}`;
  return /^O:[A-Z0-9.-]+\d{6}[CP]\d{8}$/.test(ticker) ? ticker : null;
}

function structuredOptionProviderContractIdFromInstrument(input: {
  optionContract?: {
    ticker?: unknown;
    providerContractId?: unknown;
    underlying?: unknown;
    expirationDate?: unknown;
    strike?: unknown;
    right?: unknown;
  } | null;
}): string | null {
  const contract = input.optionContract;
  const explicitTicker =
    normalizeOpraOptionTicker(contract?.providerContractId) ??
    normalizeOpraOptionTicker(contract?.ticker);
  if (explicitTicker) {
    return explicitTicker;
  }
  const underlying = normalizeSymbol(String(contract?.underlying ?? ""));
  const expiration = optionExpirationKey(contract?.expirationDate);
  const strike = finiteOptionNumber(contract?.strike);
  const right = optionRightCode(contract?.right);
  if (!underlying || !expiration || strike === null || !right) {
    return null;
  }
  const opraUnderlying = underlying.replace(/[^A-Z0-9]/g, "");
  const opraExpiration = expiration.length === 8 ? expiration.slice(2) : expiration;
  const strikeKey = String(Math.round(strike * 1000)).padStart(8, "0");
  return opraUnderlying
    ? `O:${opraUnderlying}${opraExpiration}${right}${strikeKey}`
    : null;
}

function refreshAccountMonitorLeases(input: {
  mode: "shadow" | "live";
  accountId?: string;
}): void {
  const key = accountMonitorOwner(input);
  const snapshot = accountMonitorSnapshots.get(key);
  const requestsByKey = new Map<string, MarketDataLineRequest>();
  const massiveStocksRealtime = isMassiveStocksRealtimeConfigured();

  snapshot?.positions.forEach((position) => {
    if (Math.abs(Number(position.quantity ?? 0)) <= 1e-9) {
      return;
    }
    const request = marketDataRequestFromInstrument(position, {
      massiveStocksRealtime,
    });
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
    const request = marketDataRequestFromInstrument(order, {
      massiveStocksRealtime,
    });
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
    fallbackProvider: "cache",
  });
}

function updateAccountMonitorPositions(input: {
  mode: "shadow" | "live";
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
  mode: "shadow" | "live";
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

type QuoteStreamPayload = {
  quotes: Array<QuoteSnapshot & { source: "massive" }>;
};

export async function fetchQuoteSnapshotPayload(
  symbols: string[],
): Promise<QuoteStreamPayload> {
  const payload = await getQuoteSnapshots({ symbols: symbols.join(",") });
  return {
    quotes: payload.quotes.filter(
      (quote): quote is QuoteSnapshot & { source: "massive" } =>
        quote.source === "massive",
    ),
  };
}

export function resolveQuoteStreamSource(): "massive" {
  return "massive";
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
        contracts: (
          await getOptionChain({
            underlying,
            quoteHydration: "metadata",
            allowDelayedSnapshotHydration: false,
            timeoutMs: OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS,
            emptyRetryDelaysMs: [],
          })
        ).contracts,
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
  signal?: AbortSignal;
}): Promise<OptionQuoteSnapshotPayload> {
  return fetchBridgeOptionQuoteSnapshots(input);
}

export function readOptionQuoteDemandSnapshotPayload(input: {
  underlying?: string | null;
  providerContractIds: string[];
  owner?: string | null;
  requiresGreeks?: boolean;
}): OptionQuoteSnapshotPayload {
  const requestedAt = Date.now();
  const state = readIbkrLiveDemandState(input);
  const quotes = state.states.flatMap((item) =>
    item.quote
      ? [{ ...item.quote, source: "massive" as const }]
      : [],
  );
  const missingStates = state.states.filter((item) => !item.quote);
  const rejectedStates = state.states.filter((item) => item.status === "rejected");
  const acceptedProviderContractIds = state.states
    .filter((item) => item.status !== "rejected")
    .map((item) => item.providerContractId);

  return {
    underlying: state.underlying,
    quotes,
    transport: quotes[0]?.transport ?? null,
    delayed: quotes.some((quote) => quote.delayed),
    fallbackUsed: false,
    debug: {
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs: null,
      requestedCount: state.states.length,
      acceptedCount: acceptedProviderContractIds.length,
      rejectedCount: rejectedStates.length,
      returnedCount: quotes.length,
      bridgeChunks: 0,
      providerMode: null,
      liveMarketDataAvailable: null,
      errorMessage: null,
      blockedReason: missingStates[0]?.reason ?? null,
      acceptedProviderContractIds,
      missingProviderContractIds: missingStates.map((item) => item.providerContractId),
    },
  };
}

export async function fetchOrderSnapshotPayload(input: {
  accountId?: string;
  mode: "shadow" | "live";
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

  if (suppression && !shouldProbeBridgeOrderReadSuppression(suppression)) {
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
    clearBridgeOrderReadSuppression("orders_timeout");
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
  mode: "shadow" | "live";
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
  mode?: "shadow" | "live";
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

export function subscribeQuoteSnapshots(
  symbols: string[],
  onSnapshot: (
    payload: QuoteStreamPayload,
    serializeEvent?: () => string,
  ) => void,
): Unsubscribe {
  const normalizedSymbols = Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );

  return subscribeMassiveStockQuoteSnapshots(normalizedSymbols, onSnapshot);
}

export const __bridgeStreamsInternalsForTests = {
  marketDataRequestFromInstrument,
  structuredOptionProviderContractIdFromInstrument,
};

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

  const unsubscribes = normalizedUnderlyings.map((underlying) =>
    createPollingStream({
      intervalMs: 15_000,
      fetchSnapshot: async () => fetchOptionChainSnapshotPayload([underlying]),
      onSnapshot,
    }),
  );

  return () => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
  };
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
  const owner =
    input.owner?.trim() ||
    `bridge-option-live-demand:${nextOptionQuoteDemandStreamId++}`;
  return subscribeIbkrLiveDemand(
    { ...input, owner, intent: input.intent ?? "visible-live" },
    onSnapshot,
  );
}

export function subscribeOrderSnapshots(
  input: {
    accountId?: string;
    mode: "shadow" | "live";
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
    mode: "shadow" | "live";
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
    mode?: "shadow" | "live";
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
