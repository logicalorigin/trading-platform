import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";
import type {
  HistoryBarTimeframe,
  HistoryDataSource,
} from "../providers/ibkr/client";
import {
  fetchBridgeQuoteSnapshots,
  subscribeBridgeQuoteSnapshots,
} from "./bridge-quote-stream";
import { recordAccountSnapshots } from "./account";
import { getOptionChain } from "./platform";

const bridgeClient = new IbkrBridgeClient();

type Unsubscribe = () => void;

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
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

type OptionQuoteSnapshotPayload = {
  underlying: string | null;
  quotes: Array<
    Awaited<ReturnType<IbkrBridgeClient["getOptionQuoteSnapshots"]>>[number] & {
      source: "ibkr";
    }
  >;
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

function normalizeProviderContractIds(providerContractIds: string[]): string[] {
  return Array.from(
    new Set(
      providerContractIds
        .map((providerContractId) => providerContractId.trim())
        .filter(Boolean),
    ),
  ).sort();
}

export async function fetchOptionQuoteSnapshotPayload(input: {
  underlying?: string | null;
  providerContractIds: string[];
}): Promise<OptionQuoteSnapshotPayload> {
  const normalizedProviderContractIds = normalizeProviderContractIds(
    input.providerContractIds,
  );

  return {
    underlying:
      typeof input.underlying === "string" && input.underlying.trim()
        ? normalizeSymbol(input.underlying)
        : null,
    quotes: (
      await bridgeClient.getOptionQuoteSnapshots({
        underlying: input.underlying ?? undefined,
        providerContractIds: normalizedProviderContractIds,
      })
    ).map((quote) => ({
      ...quote,
      source: "ibkr" as const,
    })),
  };
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
}): Promise<{
  orders: Awaited<ReturnType<IbkrBridgeClient["listOrders"]>>;
}> {
  return {
    orders: await bridgeClient.listOrders(input),
  };
}

export async function fetchAccountSnapshotPayload(input: {
  accountId?: string;
  mode: "paper" | "live";
}): Promise<{
  accounts: Awaited<ReturnType<IbkrBridgeClient["listAccounts"]>>;
  positions: Awaited<ReturnType<IbkrBridgeClient["listPositions"]>>;
}> {
  const accounts = await bridgeClient.listAccounts(input.mode);
  void recordAccountSnapshots(accounts).catch((error) => {
    logger.warn({ err: error }, "Failed to record account balance snapshots");
  });

  return {
    accounts,
    positions: await bridgeClient.listPositions(input),
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
    executions: await bridgeClient.listExecutions(input),
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
  const normalizedProviderContractIds = normalizeProviderContractIds(
    input.providerContractIds,
  );

  if (normalizedProviderContractIds.length === 0) {
    return () => {};
  }

  let active = true;
  let unsubscribe: Unsubscribe = () => {};
  let reconnectTimer: NodeJS.Timeout | null = null;

  const connect = () => {
    unsubscribe = bridgeClient.streamOptionQuoteSnapshots(
      {
        underlying: input.underlying ?? undefined,
        providerContractIds: normalizedProviderContractIds,
      },
      (quotes) => {
        onSnapshot({
          underlying:
            typeof input.underlying === "string" && input.underlying.trim()
              ? normalizeSymbol(input.underlying)
              : null,
          quotes: quotes.map((quote) => ({
            ...quote,
            source: "ibkr" as const,
          })),
        });
      },
      (error) => {
        logger.warn({ err: error }, "Bridge option quote stream failed");
        unsubscribe();
        if (!active || reconnectTimer) {
          return;
        }

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (active) {
            connect();
          }
        }, 1_000);
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
): Unsubscribe {
  let active = true;
  let unsubscribe: Unsubscribe = () => {};
  let reconnectTimer: NodeJS.Timeout | null = null;

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
      },
      (error) => {
        logger.warn({ err: error }, "Bridge historical bar stream failed");
        unsubscribe();
        if (!active || reconnectTimer) {
          return;
        }

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (active) {
            connect();
          }
        }, 1_000);
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
    intervalMs: 1_000,
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
