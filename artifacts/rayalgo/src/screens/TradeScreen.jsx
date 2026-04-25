import {
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useEffect,
  useCallback,
  useMemo,
  memo,
  useState,
  useRef,
} from "react";
import {
  getOptionChain as getOptionChainRequest,
  listFlowEvents as listFlowEventsRequest,
  useGetOptionExpirations,
  useGetQuoteSnapshots,
  useListPositions,
} from "@workspace/api-client-react";
import {
  useIbkrOptionQuoteStream,
  useIbkrQuoteSnapshotStream,
} from "../features/platform/live-streams";
import {
  getTradeOptionChainSnapshot,
  publishTradeOptionChainSnapshot,
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../features/platform/tradeOptionChainStore";
import { useRuntimeWorkloadFlag } from "../features/platform/workloadStats";
import {
  HEAVY_PAYLOAD_GC_MS,
  QUERY_DEFAULTS,
  TickerTabStrip,
  TickerUniverseSearchPanel,
  TradeContractDetailPanel,
  TradeEquityPanel,
  TradeL2Panel,
  TradeOptionsFlowPanel,
  TradeOrderTicket,
  TradePositionsPanel,
  TradeSpotFlowPanel,
  TradeStrategyGreeksPanel,
  TradeTickerHeader,
  _initialState,
  bridgeRuntimeMessage,
  buildOptionChainRowsFromApi,
  daysToExpiration,
  ensureTradeTickerInfo,
  formatExpirationLabel,
  formatRelativeTimeShort,
  getAtmStrikeFromPrice,
  mapFlowEventToUi,
  parseExpirationValue,
  publishRuntimeTickerSnapshot,
  persistState,
  usePositions,
  useToast,
} from "../RayAlgoPlatform";
import { TradeChainPanel } from "../features/trade/TradeChainPanel";
import { publishTradeFlowSnapshot } from "../features/platform/tradeFlowStore";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";

const OPTION_CHAIN_QUERY_DEFAULTS = {
  staleTime: 5 * 60_000,
  refetchInterval: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: 1,
  gcTime: 15 * 60_000,
};

const OPTION_CHAIN_BACKGROUND_CONCURRENCY_LIMIT = 3;

const getExpirationChainKey = (expiration) =>
  expiration?.chainKey || expiration?.isoDate || expiration?.value || null;

const getTradeOptionChainQueryKey = (ticker, chainKey) => [
  "trade-option-chain",
  ticker,
  chainKey || "__empty__",
];

const areStringListsEqual = (left = [], right = []) => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};

const formatOptionExpirationIsoDate = (value, actualDate) => {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (actualDate instanceof Date && !Number.isNaN(actualDate.getTime())) {
    return actualDate.toISOString().slice(0, 10);
  }

  return null;
};

const buildExpirationOptions = (expirations = []) =>
  expirations
    .map((entry) => {
      const actualDate = parseExpirationValue(entry?.expirationDate);
      const value = formatExpirationLabel(entry?.expirationDate);
      const isoDate = formatOptionExpirationIsoDate(
        entry?.expirationDate,
        actualDate,
      );
      return {
        value,
        chainKey: isoDate ? String(isoDate) : value,
        label: value,
        dte: daysToExpiration(actualDate),
        actualDate,
        isoDate,
      };
    })
    .filter((entry) => entry.value && entry.value !== MISSING_VALUE)
    .sort(
      (left, right) =>
        (left.actualDate?.getTime?.() ?? 0) - (right.actualDate?.getTime?.() ?? 0),
    );

const MemoTradeTickerHeader = memo(function MemoTradeTickerHeader(props) {
  return <TradeTickerHeader {...props} />;
});

const MemoTradeEquityPanel = memo(function MemoTradeEquityPanel(props) {
  return <TradeEquityPanel {...props} />;
});

const MemoTradeChainPanel = memo(function MemoTradeChainPanel(props) {
  return <TradeChainPanel {...props} />;
});

const MemoTradeContractDetailPanel = memo(function MemoTradeContractDetailPanel(props) {
  return <TradeContractDetailPanel {...props} />;
});

const MemoTradeSpotFlowPanel = memo(function MemoTradeSpotFlowPanel(props) {
  return <TradeSpotFlowPanel {...props} />;
});

const MemoTradeOptionsFlowPanel = memo(function MemoTradeOptionsFlowPanel(props) {
  return <TradeOptionsFlowPanel {...props} />;
});

const MemoTradeOrderTicket = memo(function MemoTradeOrderTicket(props) {
  return <TradeOrderTicket {...props} />;
});

const MemoTradeStrategyGreeksPanel = memo(function MemoTradeStrategyGreeksPanel(props) {
  return <TradeStrategyGreeksPanel {...props} />;
});

const MemoTradeL2Panel = memo(function MemoTradeL2Panel(props) {
  return <TradeL2Panel {...props} />;
});

const MemoTradePositionsPanel = memo(function MemoTradePositionsPanel(props) {
  return <TradePositionsPanel {...props} />;
});

const TradeQuoteRuntime = ({
  ticker,
  enabled,
  stockAggregateStreamingEnabled,
}) => {
  const quoteQuery = useGetQuoteSnapshots(
    { symbols: ticker },
    {
      query: {
        enabled: Boolean(ticker),
        staleTime: 60_000,
        retry: false,
      },
    },
  );

  useIbkrQuoteSnapshotStream({
    symbols: ticker ? [ticker] : [],
    enabled: Boolean(stockAggregateStreamingEnabled && ticker && enabled),
  });

  useEffect(() => {
    const quote = quoteQuery.data?.quotes?.find(
      (item) => item.symbol?.toUpperCase() === ticker,
    );
    if (!quote || !ticker) {
      return;
    }

    const currentInfo = ensureTradeTickerInfo(ticker, ticker);
    publishRuntimeTickerSnapshot(ticker, ticker, {
      name: currentInfo.name || ticker,
      price: quote.price ?? currentInfo.price,
      chg: quote.change ?? currentInfo.chg,
      pct: quote.changePercent ?? currentInfo.pct,
      open: quote.open ?? currentInfo.open ?? null,
      high: quote.high ?? currentInfo.high ?? null,
      low: quote.low ?? currentInfo.low ?? null,
      prevClose: quote.prevClose ?? currentInfo.prevClose ?? null,
      volume: quote.volume ?? currentInfo.volume ?? null,
      updatedAt: quote.updatedAt ?? currentInfo.updatedAt ?? null,
    });
  }, [quoteQuery.data, ticker]);

  return null;
};

const TradeFlowRuntime = ({
  ticker,
  enabled,
}) => {
  const optionChainSnapshot = useTradeOptionChainSnapshot(ticker, {
    subscribe: Boolean(ticker),
  });
  const optionChainHasInitialCoverage =
    optionChainSnapshot.completedExpirationCount > 0 ||
    optionChainSnapshot.loadedExpirationCount > 0 ||
    optionChainSnapshot.status === "live";
  const flowEnabled = Boolean(
    enabled &&
      ticker &&
      optionChainHasInitialCoverage,
  );

  useRuntimeWorkloadFlag("trade:flow", flowEnabled, {
    kind: "poll",
    label: "Trade flow",
    detail: "10s",
    priority: 5,
  });

  const tickerFlowQuery = useQuery({
    queryKey: ["trade-flow", ticker],
    queryFn: () =>
      listFlowEventsRequest({ underlying: ticker, limit: 80 }),
    enabled: flowEnabled,
    staleTime: 10_000,
    refetchInterval: flowEnabled ? 10_000 : false,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });

  useEffect(() => {
    if (!ticker) {
      return;
    }

    const liveEvents =
      tickerFlowQuery.data?.events?.map(mapFlowEventToUi) || [];
    const events = liveEvents.length
      ? liveEvents.sort((left, right) => right.premium - left.premium)
      : [];
    const status = events.length
      ? "live"
      : tickerFlowQuery.isPending
        ? "loading"
        : tickerFlowQuery.isError
          ? "offline"
          : "empty";

    publishTradeFlowSnapshot(ticker, {
      events,
      status,
    });
  }, [
    ticker,
    tickerFlowQuery.data,
    tickerFlowQuery.isError,
    tickerFlowQuery.isPending,
  ]);

  return null;
};

const TradeOptionChainRuntime = ({
  ticker,
  expirationValue,
}) => {
  const [enabledChainKeys, setEnabledChainKeys] = useState([]);
  const enabledChainTickerRef = useRef(ticker);
  const expirationsQuery = useGetOptionExpirations(
    { underlying: ticker },
    {
      query: {
        enabled: Boolean(ticker),
        ...OPTION_CHAIN_QUERY_DEFAULTS,
      },
    },
  );
  const expirationOptions = useMemo(
    () => buildExpirationOptions(expirationsQuery.data?.expirations || []),
    [expirationsQuery.data?.expirations],
  );
  const activeExpiration = useMemo(() => {
    if (!expirationOptions.length) {
      return null;
    }

    return (
      expirationOptions.find((option) => option.value === expirationValue) ||
      expirationOptions[0]
    );
  }, [expirationOptions, expirationValue]);
  const orderedExpirationOptions = useMemo(() => {
    const activeKey = getExpirationChainKey(activeExpiration);
    if (!activeKey) {
      return expirationOptions;
    }

    return [
      activeExpiration,
      ...expirationOptions.filter(
        (option) => getExpirationChainKey(option) !== activeKey,
      ),
    ];
  }, [activeExpiration, expirationOptions]);

  useEffect(() => {
    if (!ticker || !expirationOptions.length) {
      setEnabledChainKeys([]);
      enabledChainTickerRef.current = ticker;
      return;
    }

    const validKeys = new Set(
      expirationOptions.map(getExpirationChainKey).filter(Boolean),
    );
    const activeKey = getExpirationChainKey(activeExpiration);
    const tickerChanged = enabledChainTickerRef.current !== ticker;
    enabledChainTickerRef.current = ticker;

    setEnabledChainKeys((current) => {
      if (tickerChanged) {
        return activeKey ? [activeKey] : [];
      }

      let next = current.filter((key) => validKeys.has(key));
      if (activeKey && !next.includes(activeKey)) {
        return [activeKey];
      }
      if (activeKey && next[0] !== activeKey) {
        next = [activeKey, ...next.filter((key) => key !== activeKey)];
      }

      return areStringListsEqual(current, next) ? current : next;
    });
  }, [activeExpiration, expirationOptions, orderedExpirationOptions, ticker]);

  const enabledChainKeySet = useMemo(
    () => new Set(enabledChainKeys),
    [enabledChainKeys],
  );
  const optionChainQueries = useQueries({
    queries: expirationOptions.map((expiration) => {
      const chainKey = getExpirationChainKey(expiration);
      return {
        queryKey: getTradeOptionChainQueryKey(ticker, chainKey),
        queryFn: () =>
          getOptionChainRequest({
            underlying: ticker,
            expirationDate: expiration.isoDate || undefined,
          }),
        enabled: Boolean(
          ticker &&
            expiration.isoDate &&
            chainKey &&
            enabledChainKeySet.has(chainKey),
        ),
        ...OPTION_CHAIN_QUERY_DEFAULTS,
      };
    }),
  });
  const optionChainProgressKey = optionChainQueries
    .map((query, index) => {
      const chainKey = getExpirationChainKey(expirationOptions[index]);
      return [
        chainKey,
        query.status,
        query.fetchStatus,
        query.dataUpdatedAt || 0,
        query.errorUpdatedAt || 0,
      ].join(":");
    })
    .join("|");

  useEffect(() => {
    if (!ticker || !expirationOptions.length) {
      return;
    }

    const validKeys = new Set(
      expirationOptions.map(getExpirationChainKey).filter(Boolean),
    );
    const enabledSet = new Set(
      enabledChainKeys.filter((key) => validKeys.has(key)),
    );
    const activeKey = getExpirationChainKey(activeExpiration);
    const terminalKeySet = new Set(
      optionChainQueries
        .map((query, index) => {
          const key = getExpirationChainKey(expirationOptions[index]);
          return key && (query.isSuccess || query.isError) ? key : null;
        })
        .filter(Boolean),
    );
    const activeFetchCount = optionChainQueries.reduce((count, query, index) => {
      const key = getExpirationChainKey(expirationOptions[index]);
      if (
        key &&
        enabledSet.has(key) &&
        (query.isPending || query.fetchStatus === "fetching")
      ) {
        return count + 1;
      }
      return count;
    }, 0);
    if (activeKey && !terminalKeySet.has(activeKey)) {
      return;
    }

    if (enabledSet.size === 0) {
      return;
    }

    const availableSlots = Math.max(
      0,
      OPTION_CHAIN_BACKGROUND_CONCURRENCY_LIMIT - activeFetchCount,
    );

    if (availableSlots <= 0 || enabledSet.size >= validKeys.size) {
      return;
    }

    setEnabledChainKeys((current) => {
      let next = current.filter((key) => validKeys.has(key));
      if (activeKey && !next.includes(activeKey)) {
        next = [activeKey, ...next];
      } else if (activeKey && next[0] !== activeKey) {
        next = [activeKey, ...next.filter((key) => key !== activeKey)];
      }

      let remainingSlots = Math.max(
        0,
        OPTION_CHAIN_BACKGROUND_CONCURRENCY_LIMIT -
          next.filter((key) => !terminalKeySet.has(key)).length,
      );

      for (const option of orderedExpirationOptions) {
        const key = getExpirationChainKey(option);
        if (!key || next.includes(key)) {
          continue;
        }
        next.push(key);
        remainingSlots -= 1;
        if (remainingSlots <= 0) {
          break;
        }
      }

      return areStringListsEqual(current, next) ? current : next;
    });
  }, [
    enabledChainKeys,
    expirationOptions,
    optionChainProgressKey,
    optionChainQueries,
    orderedExpirationOptions,
    ticker,
  ]);

  useEffect(() => {
    if (!ticker) {
      return;
    }

    const currentSnapshot = getTradeOptionChainSnapshot(ticker);
    const validKeys = new Set(
      expirationOptions.map(getExpirationChainKey).filter(Boolean),
    );
    const enabledSet = new Set(
      enabledChainKeys.filter((key) => validKeys.has(key)),
    );
    const validValues = new Set(
      expirationOptions.map((option) => option.value).filter(Boolean),
    );
    const filteredRowsByExpiration = Object.fromEntries(
      Object.entries(currentSnapshot.rowsByExpiration || {}).filter(
        ([expiration]) =>
          validKeys.has(expiration) || validValues.has(expiration),
      ),
    );
    const tickerInfo = ensureTradeTickerInfo(ticker, ticker);
    const rowsByExpiration = { ...filteredRowsByExpiration };

    optionChainQueries.forEach((query, index) => {
      const expiration = expirationOptions[index];
      const chainKey = getExpirationChainKey(expiration);
      if (!chainKey) {
        return;
      }

      if (query.isSuccess && !query.data?.contracts?.length) {
        delete rowsByExpiration[chainKey];
        if (expiration.value) {
          delete rowsByExpiration[expiration.value];
        }
        return;
      }

      if (!query.data?.contracts?.length) {
        return;
      }

      rowsByExpiration[chainKey] = buildOptionChainRowsFromApi(
        query.data.contracts,
        tickerInfo.price,
      );
    });

    const hasRowsForExpiration = (expiration) => {
      const chainKey = getExpirationChainKey(expiration);
      return Boolean(
        (chainKey && rowsByExpiration[chainKey]?.length) ||
          (expiration?.value && rowsByExpiration[expiration.value]?.length),
      );
    };
    const statusByExpiration = Object.fromEntries(
      expirationOptions
        .map((expiration, index) => {
          const chainKey = getExpirationChainKey(expiration);
          if (!chainKey) {
            return null;
          }

          if (hasRowsForExpiration(expiration)) {
            return [chainKey, "loaded"];
          }

          if (!enabledSet.has(chainKey)) {
            return [chainKey, "queued"];
          }

          const query = optionChainQueries[index];
          if (query?.isError) {
            return [chainKey, "failed"];
          }
          if (query?.isSuccess) {
            return [chainKey, "empty"];
          }
          if (query?.fetchStatus === "fetching" || query?.isPending) {
            return [chainKey, "loading"];
          }

          return [chainKey, "queued"];
        })
        .filter(Boolean),
    );
    const statusValues = Object.values(statusByExpiration);
    const loadedExpirationCount = statusValues.filter(
      (value) => value === "loaded",
    ).length;
    const emptyExpirationCount = statusValues.filter(
      (value) => value === "empty",
    ).length;
    const failedExpirationCount = statusValues.filter(
      (value) => value === "failed",
    ).length;
    const loadingExpirations = expirationOptions
      .filter((expiration) => {
        const chainKey = getExpirationChainKey(expiration);
        return chainKey && statusByExpiration[chainKey] === "loading";
      })
      .map(getExpirationChainKey)
      .filter(Boolean);
    const totalExpirationCount = expirationOptions.length;
    const completedExpirationCount =
      loadedExpirationCount + emptyExpirationCount + failedExpirationCount;
    const queuedExpirationCount = statusValues.filter(
      (value) => value === "queued",
    ).length;
    const loadingExpirationCount = loadingExpirations.length;
    const hasAnyChainError = failedExpirationCount > 0;
    const status = expirationsQuery.isPending
      ? "loading"
      : expirationsQuery.isError
        ? "offline"
        : totalExpirationCount === 0
          ? "empty"
          : loadingExpirationCount || queuedExpirationCount
            ? "loading"
            : loadedExpirationCount > 0
              ? "live"
              : hasAnyChainError
                ? "offline"
                : "empty";

    publishTradeOptionChainSnapshot(ticker, {
      expirationOptions,
      rowsByExpiration,
      loadingExpirations,
      statusByExpiration,
      loadedExpirationCount,
      completedExpirationCount,
      emptyExpirationCount,
      failedExpirationCount,
      totalExpirationCount,
      updatedAt: Date.now(),
      status,
    });
  }, [
    enabledChainKeys,
    expirationOptions,
    expirationsQuery.isError,
    expirationsQuery.isPending,
    optionChainProgressKey,
    optionChainQueries,
    ticker,
  ]);

  return null;
};

const TradeContractSelectionRuntime = ({
  ticker,
  contract,
  onPatchContract,
}) => {
  const chainSnapshot = useTradeOptionChainSnapshot(ticker);
  const {
    expirationOptions,
    resolvedExpiration,
    chainRows,
  } = resolveTradeOptionChainSnapshot(chainSnapshot, contract.exp);

  useEffect(() => {
    if (!expirationOptions.length) {
      return;
    }
    if (expirationOptions.some((option) => option.value === contract.exp)) {
      return;
    }

    const nextExpiration = resolvedExpiration || expirationOptions[0];
    const atmRow = (chainRows || []).find((row) => row.isAtm);
    onPatchContract({
      exp: nextExpiration?.value || contract.exp,
      strike: atmRow?.k ?? contract.strike,
    });
  }, [
    chainRows,
    contract.exp,
    contract.strike,
    expirationOptions,
    onPatchContract,
    resolvedExpiration,
  ]);

  useEffect(() => {
    if (!chainRows.length) {
      return;
    }
    if (chainRows.some((row) => row.k === contract.strike)) {
      return;
    }

    const atmRow =
      chainRows.find((row) => row.isAtm) ||
      chainRows[Math.floor(chainRows.length / 2)];
    onPatchContract({ strike: atmRow?.k ?? contract.strike });
  }, [chainRows, contract.strike, onPatchContract]);

  return null;
};

const TradeOptionQuoteRuntime = ({
  ticker,
  contract,
  heldContracts,
  enabled,
}) => {
  const chainSnapshot = useTradeOptionChainSnapshot(ticker);
  const { chainRows } = resolveTradeOptionChainSnapshot(chainSnapshot, contract.exp);

  const selectedRow = useMemo(
    () => chainRows.find((row) => row.k === contract.strike) || null,
    [chainRows, contract.strike],
  );

  const providerContractIds = useMemo(() => {
    const collected = new Set();

    chainRows.forEach((row) => {
      if (row.cContract?.providerContractId) {
        collected.add(row.cContract.providerContractId);
      }
      if (row.pContract?.providerContractId) {
        collected.add(row.pContract.providerContractId);
      }
    });

    const selectedProviderContractId =
      contract.cp === "C"
        ? selectedRow?.cContract?.providerContractId
        : selectedRow?.pContract?.providerContractId;
    if (selectedProviderContractId) {
      collected.add(selectedProviderContractId);
    }

    heldContracts.forEach((holding) => {
      if (holding.providerContractId) {
        collected.add(holding.providerContractId);
      }
    });

    return Array.from(collected).sort();
  }, [chainRows, contract.cp, heldContracts, selectedRow]);

  useIbkrOptionQuoteStream({
    underlying: ticker,
    providerContractIds,
    enabled: Boolean(enabled && ticker && providerContractIds.length > 0),
  });

  return null;
};

export const TradeScreen = ({
  sym,
  symPing,
  session,
  environment,
  accountId,
  brokerConfigured,
  brokerAuthenticated,
  isVisible = false,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const positions = usePositions();
  // Initialize from persisted state, falling back to sym prop or sensible defaults
  const initialTicker = (() => {
    const persistedActive = _initialState.tradeActiveTicker;
    if (persistedActive) {
      ensureTradeTickerInfo(persistedActive, persistedActive);
      return persistedActive;
    }
    if (sym) {
      ensureTradeTickerInfo(sym, sym);
      return sym;
    }
    return "SPY";
  })();
  const initialRecent = (() => {
    const persistedRecent = _initialState.tradeRecentTickers;
    if (Array.isArray(persistedRecent) && persistedRecent.length > 0) {
      const valid = persistedRecent
        .map((ticker) => {
          ensureTradeTickerInfo(ticker, ticker);
          return ticker;
        })
        .filter(Boolean);
      if (valid.length > 0) return valid;
    }
    return [initialTicker, "QQQ", "NVDA"].filter(
      (t, i, a) => a.indexOf(t) === i,
    );
  })();
  const initialContracts = (() => {
    const persistedContracts = _initialState.tradeContracts;
    return persistedContracts && typeof persistedContracts === "object"
      ? persistedContracts
      : {};
  })();
  const [activeTicker, setActiveTicker] = useState(initialTicker);
  const [recentTickers, setRecentTickers] = useState(initialRecent);
  const [contracts, setContracts] = useState(initialContracts);
  const [showUniverseSearch, setShowUniverseSearch] = useState(false);
  const [tradeChainHeatmapEnabled, setTradeChainHeatmapEnabled] = useState(
    Boolean(_initialState.tradeChainHeatmapEnabled),
  );
  const stockAggregateStreamingEnabled = Boolean(
    brokerConfigured && brokerAuthenticated,
  );
  const activeTickerInfo = ensureTradeTickerInfo(activeTicker, activeTicker);
  const contract =
    contracts[activeTicker] ||
    (() => {
      return {
        strike: getAtmStrikeFromPrice(activeTickerInfo.price) ?? null,
        cp: "C",
        exp: "",
      };
    })();
  const optionChainGateSnapshot = useTradeOptionChainSnapshot(activeTicker);
  const optionChainGate = resolveTradeOptionChainSnapshot(
    optionChainGateSnapshot,
    contract.exp,
  );
  const optionChainInitialCoverageReady = Boolean(
    optionChainGateSnapshot.updatedAt &&
      (optionChainGate.loadedExpirationCount > 0 ||
        optionChainGate.completedExpirationCount > 0 ||
        optionChainGateSnapshot.status === "live" ||
        optionChainGateSnapshot.status === "empty" ||
        optionChainGateSnapshot.status === "offline"),
  );
  const optionChainBatchSettled = Boolean(
    optionChainGateSnapshot.updatedAt &&
      (optionChainGate.totalExpirationCount > 0
        ? optionChainGate.completedExpirationCount >=
          optionChainGate.totalExpirationCount
        : optionChainGateSnapshot.status === "empty" ||
          optionChainGateSnapshot.status === "offline" ||
          optionChainGateSnapshot.status === "live"),
  );
  const tradeLiveStreamsEnabled =
    isVisible && !showUniverseSearch && optionChainBatchSettled;
  useRuntimeWorkloadFlag("trade:streams", tradeLiveStreamsEnabled, {
    kind: "stream",
    label: "Trade live streams",
    detail: optionChainBatchSettled
      ? activeTicker
      : `${activeTicker} chain ${optionChainGate.completedExpirationCount}/${optionChainGate.totalExpirationCount || "?"}`,
    priority: 2,
  });
  const updateContract = useCallback(
    (patch) =>
      setContracts((current) => ({
        ...current,
        [activeTicker]: { ...contract, ...patch },
      })),
    [activeTicker, contract],
  );
  const tradePositionsQuery = useListPositions(
    { accountId, mode: environment },
    {
      query: {
        enabled: Boolean(brokerAuthenticated && accountId),
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const heldContracts = useMemo(() => {
    if (brokerConfigured) {
      if (!brokerAuthenticated || !accountId) {
        return [];
      }

      return (tradePositionsQuery.data?.positions || [])
        .filter(
          (position) =>
            position.symbol === activeTicker &&
            position.assetClass === "option" &&
            position.optionContract,
        )
        .map((position) => ({
          strike: position.optionContract.strike,
          cp: position.optionContract.right === "call" ? "C" : "P",
          exp: formatExpirationLabel(position.optionContract.expirationDate),
          providerContractId: position.optionContract.providerContractId,
          entry: position.averagePrice,
          qty: Math.abs(position.quantity),
          pnl: position.unrealizedPnl,
          pct: position.unrealizedPnlPercent,
        }));
    }

    return positions.positions
      .filter(
        (position) =>
          position.kind === "option" && position.ticker === activeTicker,
      )
      .map((position) => ({
        strike: position.strike,
        cp: position.cp,
        exp: position.exp,
        providerContractId: null,
        entry: position.entry,
        qty: position.qty,
        pnl: null,
        pct: null,
      }));
  }, [
    accountId,
    activeTicker,
    brokerAuthenticated,
    brokerConfigured,
    environment,
    positions.positions,
    tradePositionsQuery.data,
  ]);

  // Persist trade state changes
  useEffect(() => {
    persistState({ tradeActiveTicker: activeTicker });
  }, [activeTicker]);
  useEffect(() => {
    persistState({ tradeRecentTickers: recentTickers });
  }, [recentTickers]);
  useEffect(() => {
    persistState({ tradeContracts: contracts });
  }, [contracts]);
  useEffect(() => {
    persistState({ tradeChainHeatmapEnabled });
  }, [tradeChainHeatmapEnabled]);

  // Helper: focus a ticker, and add to recent strip if not present
  const focusTicker = useCallback((ticker, fallbackName = ticker) => {
    const normalized = ticker?.toUpperCase?.() || ticker;
    if (!normalized) return;
    ensureTradeTickerInfo(normalized, fallbackName);
    setActiveTicker(normalized);
    setRecentTickers((prev) =>
      prev.includes(normalized) ? prev : [...prev, normalized].slice(-8),
    );
  }, []);
  const closeTicker = useCallback((ticker) => {
    setRecentTickers((prev) => {
      const filtered = prev.filter((t) => t !== ticker);
      if (ticker === activeTicker && filtered.length > 0)
        setActiveTicker(filtered[0]);
      return filtered;
    });
  }, [activeTicker]);
  const openUniverseSearch = useCallback(() => setShowUniverseSearch(true), []);

  // Watchlist sync
  useEffect(() => {
    if (!symPing || symPing.n === 0) return;
    ensureTradeTickerInfo(symPing.sym, symPing.sym);
    focusTicker(symPing.sym);
    if (symPing.contract) {
      const incoming = symPing.contract;
      setContracts((current) => {
        const info = ensureTradeTickerInfo(symPing.sym, symPing.sym);
        const existing = current[symPing.sym] || {
          strike: getAtmStrikeFromPrice(info.price) ?? null,
          cp: "C",
          exp: incoming.exp || "",
        };

        return {
          ...current,
          [symPing.sym]: {
            ...existing,
            ...incoming,
          },
        };
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symPing && symPing.n]);

  // Strategy → pick a strike near the desired delta on the active ticker's chain
  const applyStrategy = useCallback((strategy) => {
    const snapshot = getTradeOptionChainSnapshot(activeTicker);
    const { expirationOptions, chainRows } = resolveTradeOptionChainSnapshot(
      snapshot,
      contract.exp,
    );
    if (!chainRows.length) {
      toast.push({
        kind: "info",
        title: "Chain still loading",
        body: "Wait for a live option chain before applying a strategy preset.",
      });
      return;
    }
    const chain = chainRows;
    let bestStrike = chain[0].k;
    let bestDist = Infinity;
    for (const row of chain) {
      const d = Math.abs(strategy.cp === "C" ? row.cDelta : row.pDelta);
      const dist = Math.abs(d - strategy.deltaTarget);
      if (dist < bestDist) {
        bestDist = dist;
        bestStrike = row.k;
      }
    }
    const targetExpiration = expirationOptions.length
      ? expirationOptions.reduce(
          (closest, option) =>
            Math.abs(option.dte - strategy.dte) <
            Math.abs(closest.dte - strategy.dte)
              ? option
              : closest,
          expirationOptions[0],
        ).value
      : contract.exp;
    updateContract({
      strike: bestStrike,
      cp: strategy.cp,
      exp: targetExpiration,
    });
  }, [activeTicker, contract.exp, toast, updateContract]);

  // Slot prop adapter for existing components that expect { ticker, strike, cp, exp }
  const slot = useMemo(
    () => ({ ticker: activeTicker, ...contract }),
    [activeTicker, contract],
  );
  const toggleUniverseSearch = useCallback(
    () => setShowUniverseSearch((open) => !open),
    [],
  );
  const closeUniverseSearch = useCallback(
    () => setShowUniverseSearch(false),
    [],
  );
  const handleSelectUniverseTicker = useCallback((result) => {
    ensureTradeTickerInfo(result.ticker, result.name || result.ticker);
    focusTicker(result.ticker, result.name || result.ticker);
    setShowUniverseSearch(false);
  }, [focusTicker]);
  const handleSelectContract = useCallback(
    (strike, cp) => updateContract({ strike, cp }),
    [updateContract],
  );
  const handleChangeExpiration = useCallback(
    (exp) => updateContract({ exp }),
    [updateContract],
  );
  const handleRetryExpiration = useCallback(
    (expiration) => {
      const chainKey = getExpirationChainKey(expiration);
      if (!chainKey) {
        return;
      }

      const queryKey = getTradeOptionChainQueryKey(activeTicker, chainKey);
      queryClient.invalidateQueries({ queryKey, exact: true });
      queryClient.refetchQueries({ queryKey, exact: true, type: "active" });
    },
    [activeTicker, queryClient],
  );
  const handleLoadPosition = useCallback(
    ({ ticker, strike, cp, exp }) => {
      focusTicker(ticker);
      setContracts((current) => ({ ...current, [ticker]: { strike, cp, exp } }));
    },
    [focusTicker],
  );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Tab strip */}
      <TickerTabStrip
        recent={recentTickers}
        active={activeTicker}
        onSelect={focusTicker}
        onClose={closeTicker}
        onAddNew={toggleUniverseSearch}
      />
      <TickerUniverseSearchPanel
        open={showUniverseSearch}
        currentTicker={activeTicker}
        onClose={closeUniverseSearch}
        onSelectTicker={handleSelectUniverseTicker}
      />
      <TradeQuoteRuntime
        ticker={activeTicker}
        enabled={tradeLiveStreamsEnabled}
        stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
      />
      <TradeOptionChainRuntime
        ticker={activeTicker}
        expirationValue={contract.exp}
      />
      <TradeFlowRuntime
        ticker={activeTicker}
        enabled={tradeLiveStreamsEnabled}
      />
      <TradeContractSelectionRuntime
        ticker={activeTicker}
        contract={contract}
        onPatchContract={updateContract}
      />
      <TradeOptionQuoteRuntime
        ticker={activeTicker}
        contract={contract}
        heldContracts={heldContracts}
        enabled={tradeLiveStreamsEnabled}
      />
      {/* Main workspace */}
      <div
        style={{
          flex: 1,
          padding: sp(6),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          overflow: "auto",
        }}
      >
        {/* Compact ticker header */}
        <MemoTradeTickerHeader
          ticker={activeTicker}
          expirationValue={contract.exp}
        />
        {brokerConfigured && !brokerAuthenticated && (
          <div
            style={{
              background: `${T.amber}12`,
              border: `1px solid ${T.amber}35`,
              borderRadius: dim(6),
              padding: sp("8px 10px"),
              display: "flex",
              justifyContent: "space-between",
              gap: sp(12),
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", gap: sp(2) }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.amber,
                  letterSpacing: "0.05em",
                }}
              >
                IBKR BRIDGE ACTION REQUIRED
              </span>
              <span
                style={{
                  fontSize: fs(9),
                  color: T.textSec,
                  fontFamily: T.sans,
                  lineHeight: 1.45,
                }}
              >
                {bridgeRuntimeMessage(session)}
              </span>
            </div>
            <div
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
                textAlign: "right",
              }}
            >
              {session?.ibkrBridge?.competing
                ? "competing session detected"
                : session?.ibkrBridge?.connected
                  ? "bridge online"
                  : "bridge offline"}
              <br />
              {(session?.ibkrBridge?.transport || "bridge").replace(/_/g, " ")}{" "}
              {session?.ibkrBridge?.connectionTarget || MISSING_VALUE}
              {session?.ibkrBridge?.sessionMode
                ? ` · ${session.ibkrBridge.sessionMode}`
                : ""}
              <br />
              last heartbeat{" "}
              {formatRelativeTimeShort(session?.ibkrBridge?.lastTickleAt)}
              {session?.ibkrBridge?.lastRecoveryAttemptAt ? (
                <>
                  <br />
                  recovery{" "}
                  {formatRelativeTimeShort(
                    session.ibkrBridge.lastRecoveryAttemptAt,
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
        {/* Top zone: Equity chart + selected contract chart */}
        <div
          data-testid="trade-top-zone"
          style={{
            display: "grid",
            gridTemplateColumns: "1.45fr minmax(360px, 1fr)",
            gap: sp(6),
            height: dim(398),
            flexShrink: 0,
          }}
        >
          <MemoTradeEquityPanel
            ticker={activeTicker}
            historicalDataEnabled={optionChainBatchSettled}
            stockAggregateStreamingEnabled={
              stockAggregateStreamingEnabled && tradeLiveStreamsEnabled
            }
            onOpenSearch={openUniverseSearch}
          />
          <MemoTradeContractDetailPanel
            ticker={activeTicker}
            contract={contract}
            heldContracts={heldContracts}
            liveDataEnabled={tradeLiveStreamsEnabled}
            onOpenSearch={openUniverseSearch}
          />
        </div>
        {/* Middle zone: options chain + spot flow + options flow */}
        <div
          data-testid="trade-middle-zone"
          style={{
            display: "grid",
            gridTemplateColumns: "1.55fr 0.95fr 1.2fr",
            gap: sp(6),
            height: dim(360),
            flexShrink: 0,
          }}
        >
          <MemoTradeChainPanel
            ticker={activeTicker}
            contract={contract}
            heldContracts={heldContracts}
            onSelectContract={handleSelectContract}
            onChangeExp={handleChangeExpiration}
            onRetryExpiration={handleRetryExpiration}
            heatmapEnabled={tradeChainHeatmapEnabled}
            onToggleHeatmap={() =>
              setTradeChainHeatmapEnabled((current) => !current)
            }
          />
          <MemoTradeSpotFlowPanel ticker={activeTicker} />
          <MemoTradeOptionsFlowPanel ticker={activeTicker} />
        </div>
        {/* Bottom zone: Order ticket + Strategy/Greeks + L2/Tape/Flow tabs + Positions */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(260px, 1fr) minmax(280px, 1fr) minmax(280px, 1fr) minmax(360px, 1.4fr)",
            gap: sp(6),
            height: dim(348),
            flexShrink: 0,
          }}
        >
          <MemoTradeOrderTicket
            slot={slot}
            accountId={accountId}
            environment={environment}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
          />
          <MemoTradeStrategyGreeksPanel
            slot={slot}
            onApplyStrategy={applyStrategy}
          />
          <MemoTradeL2Panel
            slot={slot}
            accountId={accountId}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            streamingPaused={!tradeLiveStreamsEnabled}
          />
          <MemoTradePositionsPanel
            accountId={accountId}
            environment={environment}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            streamingPaused={!tradeLiveStreamsEnabled}
            onLoadPosition={handleLoadPosition}
          />
        </div>
      </div>
    </div>
  );
};

export default TradeScreen;
