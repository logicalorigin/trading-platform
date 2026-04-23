import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";

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

export async function fetchQuoteSnapshotPayload(symbols: string[]): Promise<{
  quotes: Array<
    Awaited<ReturnType<IbkrBridgeClient["getQuoteSnapshots"]>>[number] & {
      source: "ibkr";
    }
  >;
}> {
  const normalizedSymbols = Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );

  return {
    quotes: (await bridgeClient.getQuoteSnapshots(normalizedSymbols)).map(
      (quote) => ({
        ...quote,
        source: "ibkr" as const,
      }),
    ),
  };
}

export async function fetchOptionChainSnapshotPayload(
  underlyings: string[],
): Promise<{
  underlyings: Array<{
    underlying: string;
    contracts: Awaited<ReturnType<IbkrBridgeClient["getOptionChain"]>>;
    updatedAt: string;
  }>;
}> {
  const normalizedUnderlyings = Array.from(
    new Set(
      underlyings.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
    ),
  );

  return {
    underlyings: await Promise.all(
      normalizedUnderlyings.map(async (underlying) => ({
        underlying,
        contracts: await bridgeClient.getOptionChain({
          underlying,
          maxExpirations: 1,
          strikesAroundMoney: 6,
        }),
        updatedAt: new Date().toISOString(),
      })),
    ),
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
  return {
    accounts: await bridgeClient.listAccounts(input.mode),
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

  return createPollingStream({
    intervalMs: 1_000,
    fetchSnapshot: async () => fetchQuoteSnapshotPayload(normalizedSymbols),
    onSnapshot,
  });
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
    intervalMs: 2_500,
    fetchSnapshot: async () =>
      fetchOptionChainSnapshotPayload(normalizedUnderlyings),
    onSnapshot,
  });
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
