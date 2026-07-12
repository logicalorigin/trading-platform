import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";
import {
  listIbkrExecutions,
  listIbkrAccounts,
  listIbkrOrders,
  listIbkrPositions,
} from "./ibkr-account-bridge";
import type {
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  OptionChainContract,
  QuoteSnapshot,
} from "../providers/ibkr/client";
import { subscribeMassiveStockQuoteSnapshots } from "./massive-stock-quote-stream";
import {
  fetchMassiveOptionQuoteSnapshots,
  type OptionQuoteSnapshotPayload,
} from "./massive-option-quote-stream";
import {
  readOptionQuoteDemandState,
  subscribeOptionQuoteDemand,
} from "./option-quote-demand-coordinator";
import type {
  MarketDataFallbackProvider,
  MarketDataIntent,
} from "./market-data-admission";
import { recordAccountSnapshots } from "./account";
import {
  getOptionChain,
  getQuoteSnapshots,
  OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS,
} from "./platform";
import { readPositiveIntegerEnv } from "../lib/env";

let nextOptionQuoteDemandStreamId = 1;

type Unsubscribe = () => void;
type OrderSnapshotPayload = {
  orders: BrokerOrderSnapshot[];
};
function stableStringify(value: unknown): string {
  return JSON.stringify(value);
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
    contracts: OptionChainContract[];
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
  return fetchMassiveOptionQuoteSnapshots(input);
}

export function readOptionQuoteDemandSnapshotPayload(input: {
  underlying?: string | null;
  providerContractIds: string[];
  owner?: string | null;
  requiresGreeks?: boolean;
}): OptionQuoteSnapshotPayload {
  const requestedAt = Date.now();
  const state = readOptionQuoteDemandState(input);
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
  return { orders: await listIbkrOrders(input) };
}

export async function fetchAccountSnapshotPayload(input: {
  accountId?: string;
  mode: "shadow" | "live";
}): Promise<{
  accounts: BrokerAccountSnapshot[];
  positions: BrokerPositionSnapshot[];
}> {
  const accounts = await listIbkrAccounts(input.mode);
  void recordAccountSnapshots(accounts).catch((error) => {
    logger.warn({ err: error }, "Failed to record account balance snapshots");
  });
  const positions = await listIbkrPositions(input);

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
  executions: BrokerExecutionSnapshot[];
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

export function subscribeOptionChains(
  underlyings: string[],
  onSnapshot: (payload: {
    underlyings: Array<{
      underlying: string;
      contracts: OptionChainContract[];
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
  return subscribeOptionQuoteDemand(
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
  onSnapshot: (payload: { orders: BrokerOrderSnapshot[] }) => void,
  options: {
    onPollSuccess?: (input: {
      payload: { orders: BrokerOrderSnapshot[] };
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
    accounts: BrokerAccountSnapshot[];
    positions: BrokerPositionSnapshot[];
  }) => void,
  options: {
    onPollSuccess?: (input: {
      payload: {
        accounts: BrokerAccountSnapshot[];
        positions: BrokerPositionSnapshot[];
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
    executions: BrokerExecutionSnapshot[];
  }) => void,
): Unsubscribe {
  return createPollingStream({
    intervalMs: 1_000,
    fetchSnapshot: async () => fetchExecutionSnapshotPayload(input),
    onSnapshot,
  });
}
