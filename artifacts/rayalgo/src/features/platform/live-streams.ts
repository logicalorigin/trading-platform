import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  }, [enabled, onQuotes, queryClient, streamUrl]);
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

      queryClient.setQueryData(
        ["trade-option-chain", normalizedUnderlying],
        {
          underlying: normalizedUnderlying,
          expirationDate: null,
          contracts: nextUnderlying.contracts || [],
        } satisfies OptionChainResponse,
      );
    };

    source.addEventListener("chains", handleChains as EventListener);
    return () => {
      source.removeEventListener("chains", handleChains as EventListener);
      source.close();
    };
  }, [enabled, normalizedUnderlying, queryClient, streamUrl]);
};
