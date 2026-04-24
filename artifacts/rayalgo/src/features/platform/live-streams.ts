import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePageVisible } from "./usePageVisible";
import type {
  AccountsResponse,
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

type OptionQuoteStreamPayload = {
  underlying?: string | null;
  quotes: LiveOptionQuoteSnapshot[];
};

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
// Hard cap on the in-memory option-quote snapshot cache. An option chain for a
// single underlying can have ~100 contracts; a cap of 1024 fits ~10 underlyings'
// worth of chains while protecting against unbounded growth as users browse.
const MAX_OPTION_QUOTE_SNAPSHOTS = 1_024;

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
  left.delayed === right.delayed;

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
  optionQuoteStoreVersions.set(
    normalizedProviderContractId,
    (optionQuoteStoreVersions.get(normalizedProviderContractId) ?? 0) + 1,
  );
  optionQuoteStoreListeners.forEach((listener) => listener());
  optionQuoteStoreListenersByProviderContractId
    .get(normalizedProviderContractId)
    ?.forEach((listener) => listener());

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

    cacheOptionQuoteSnapshot({
      symbol: contract.contract?.ticker || contract.contract?.underlying || "",
      price:
        isFiniteNumber(contract.last) && contract.last > 0
          ? contract.last
          : isFiniteNumber(contract.mark)
            ? contract.mark
            : 0,
      bid: contract.bid,
      ask: contract.ask,
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
      transport: "client_portal",
      delayed: false,
      updatedAt: contract.updatedAt,
      freshness: undefined,
      cacheAgeMs: null,
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

const matchesMode = (
  params: Record<string, unknown> | null,
  mode: StreamMode,
): boolean => {
  const requestedMode =
    typeof params?.mode === "string" ? params.mode.toLowerCase() : null;
  return !requestedMode || requestedMode === mode;
};

const mergeQuotesIntoCache = (
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
  filteredQuotes.forEach((quote) => {
    currentBySymbol.set(quote.symbol.toUpperCase(), quote);
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
    transport: filteredQuotes[0]?.transport ?? current?.transport ?? null,
    delayed: quotes.some((quote) => quote.delayed),
    fallbackUsed: false,
  };
};

const mergeOptionChainContracts = (
  currentContracts: OptionChainResponse["contracts"] | undefined,
  nextContracts: OptionChainResponse["contracts"],
): OptionChainResponse["contracts"] => {
  const currentByProviderContractId = new Map(
    (currentContracts || [])
      .filter((contract) => contract.contract?.providerContractId)
      .map((contract) => [contract.contract.providerContractId || "", contract]),
  );

  return nextContracts.map((nextContract) => {
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
};

const patchOptionQuotesIntoContracts = (
  currentContracts: OptionChainResponse["contracts"] | undefined,
  incomingQuotes: LiveOptionQuoteSnapshot[],
): OptionChainResponse["contracts"] => {
  if (!currentContracts?.length || !incomingQuotes.length) {
    return currentContracts || [];
  }

  const quotesByProviderContractId = new Map(
    incomingQuotes
      .filter((quote) => quote.providerContractId)
      .map((quote) => [quote.providerContractId || "", quote]),
  );

  return currentContracts.map((contract) => {
    const providerContractId = contract.contract?.providerContractId;
    if (!providerContractId) {
      return contract;
    }

    const quote = quotesByProviderContractId.get(providerContractId);
    if (!quote) {
      return contract;
    }

    const bid = isFiniteNumber(quote.bid) ? quote.bid : contract.bid;
    const ask = isFiniteNumber(quote.ask) ? quote.ask : contract.ask;
    const last = isFiniteNumber(quote.price) ? quote.price : contract.last;
    const mark =
      bid > 0 && ask > 0
        ? (bid + ask) / 2
        : isFiniteNumber(last)
          ? last
          : contract.mark;

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
      updatedAt: quote.updatedAt,
    };
  });
};

const mergeOptionChainResponse = (
  current: OptionChainResponse | undefined,
  nextContracts: OptionChainResponse["contracts"],
  underlying: string,
): OptionChainResponse => ({
  underlying,
  expirationDate: current?.expirationDate ?? null,
  contracts: mergeOptionChainContracts(current?.contracts, nextContracts),
});

const mergeOptionQuotesIntoCache = (
  current: OptionChainResponse | undefined,
  incomingQuotes: LiveOptionQuoteSnapshot[],
  underlying: string,
): OptionChainResponse | undefined => {
  if (!current?.contracts?.length) {
    return current;
  }

  return {
    underlying,
    expirationDate: current.expirationDate ?? null,
    contracts: patchOptionQuotesIntoContracts(current.contracts, incomingQuotes),
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

      onQuotes?.(payload.quotes);

      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["/api/quotes/snapshot"] })
        .forEach((query) => {
          queryClient.setQueryData(
            query.queryKey,
            (current: QuoteSnapshotsResponse | undefined) =>
              mergeQuotesIntoCache(
                current,
                payload.quotes,
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

      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["/api/accounts"] })
        .forEach((query) => {
          const params = readQueryParams(query.queryKey);
          if (!matchesMode(params, mode)) {
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
          if (!matchesMode(params, mode)) {
            return;
          }

          const requestedAccountId =
            typeof params?.accountId === "string" ? params.accountId : null;
          const positions = requestedAccountId
            ? payload.positions.filter(
                (position) => position.accountId === requestedAccountId,
              )
            : payload.positions;

          queryClient.setQueryData(query.queryKey, {
            positions,
          } satisfies PositionsResponse);
        });
    };

    source.addEventListener("accounts", handleAccounts as EventListener);
    return () => {
      source.removeEventListener("accounts", handleAccounts as EventListener);
      source.close();
    };
  }, [enabled, mode, queryClient, streamUrl]);
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

          const requestedAccountId =
            typeof params?.accountId === "string" ? params.accountId : null;
          const requestedStatus =
            typeof params?.status === "string" ? params.status : null;
          const orders = payload.orders.filter((order) => {
            if (requestedAccountId && order.accountId !== requestedAccountId) {
              return false;
            }
            if (requestedStatus && order.status !== requestedStatus) {
              return false;
            }
            return true;
          });

          queryClient.setQueryData(query.queryKey, {
            orders,
          } satisfies OrdersResponse);
        });
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

      seedOptionQuoteSnapshotsFromContracts(nextUnderlying.contracts || []);

      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["trade-option-chain", normalizedUnderlying] })
        .forEach((query) => {
          queryClient.setQueryData(
            query.queryKey,
            (current: OptionChainResponse | undefined) =>
              mergeOptionChainResponse(
                current,
                nextUnderlying.contracts || [],
                normalizedUnderlying,
              ),
          );
        });
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
}: {
  underlying?: string | null;
  providerContractIds: string[];
  enabled?: boolean;
}) => {
  const queryClient = useQueryClient();
  const pageVisible = usePageVisible();
  const normalizedUnderlying = underlying?.trim?.().toUpperCase?.() || "";
  const normalizedProviderContractIds = useMemo(
    () =>
      Array.from(
        new Set(
          providerContractIds
            .map((providerContractId) => providerContractId?.trim?.() || "")
            .filter(Boolean),
        ),
      ).sort(),
    [providerContractIds],
  );
  const streamUrl = useMemo(
    () =>
      buildStreamUrl("/api/streams/options/quotes", {
        underlying: normalizedUnderlying || undefined,
        contracts:
          normalizedProviderContractIds.length > 0
            ? normalizedProviderContractIds.join(",")
            : undefined,
      }),
    [normalizedProviderContractIds, normalizedUnderlying],
  );

  useEffect(() => {
    if (
      !enabled ||
      !pageVisible ||
      !normalizedUnderlying ||
      normalizedProviderContractIds.length === 0 ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return;
    }

    const source = new EventSource(streamUrl);
    const handleQuotes = (event: MessageEvent<string>) => {
      const payload = parseJsonPayload<OptionQuoteStreamPayload>(event.data);
      if (!payload?.quotes?.length) {
        return;
      }

      payload.quotes.forEach(cacheOptionQuoteSnapshot);

      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["trade-option-chain", normalizedUnderlying] })
        .forEach((query) => {
          queryClient.setQueryData(
            query.queryKey,
            (current: OptionChainResponse | undefined) =>
              mergeOptionQuotesIntoCache(
                current,
                payload.quotes,
                normalizedUnderlying,
              ),
          );
        });
    };

    source.addEventListener("quotes", handleQuotes as EventListener);
    return () => {
      source.removeEventListener("quotes", handleQuotes as EventListener);
      source.close();
    };
  }, [
    enabled,
    normalizedProviderContractIds,
    normalizedUnderlying,
    pageVisible,
    queryClient,
    streamUrl,
  ]);
};
