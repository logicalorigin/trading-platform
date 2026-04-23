import {
  useQuery,
} from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getOptionChain as getOptionChainRequest,
  listFlowEvents as listFlowEventsRequest,
  useGetQuoteSnapshots,
  useListPositions,
} from "@workspace/api-client-react";
import {
  useIbkrOptionChainStream,
  useIbkrQuoteSnapshotStream,
} from "../features/platform/live-streams";
import {
  HEAVY_PAYLOAD_GC_MS,
  MISSING_VALUE,
  QUERY_DEFAULTS,
  T,
  TickerTabStrip,
  TickerUniverseSearchPanel,
  TradeChainPanel,
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
  dim,
  ensureTradeTickerInfo,
  formatExpirationLabel,
  formatRelativeTimeShort,
  fs,
  getAtmStrikeFromPrice,
  mapFlowEventToUi,
  parseExpirationValue,
  persistState,
  sp,
  usePositions,
  useToast,
} from "../RayAlgoPlatform";

export const TradeScreen = ({
  sym,
  symPing,
  session,
  environment,
  accountId,
  brokerConfigured,
  brokerAuthenticated,
}) => {
  const toast = useToast();
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
  const updateContract = (patch) =>
    setContracts((c) => ({ ...c, [activeTicker]: { ...contract, ...patch } }));
  const activeQuoteQuery = useGetQuoteSnapshots(
    { symbols: activeTicker },
    {
      query: {
        enabled: Boolean(activeTicker),
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  useIbkrQuoteSnapshotStream({
    symbols: activeTicker ? [activeTicker] : [],
    enabled: Boolean(stockAggregateStreamingEnabled && activeTicker),
  });
  const optionChainQuery = useQuery({
    queryKey: ["trade-option-chain", activeTicker],
    queryFn: () => getOptionChainRequest({ underlying: activeTicker }),
    ...QUERY_DEFAULTS,
    refetchInterval: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  useIbkrOptionChainStream({
    underlying: activeTicker,
    enabled: Boolean(stockAggregateStreamingEnabled && activeTicker),
  });
  const expirationOptions = useMemo(() => {
    if (optionChainQuery.data?.contracts?.length) {
      const unique = new Map();
      optionChainQuery.data.contracts.forEach((quote) => {
        const actualDate = parseExpirationValue(quote.contract?.expirationDate);
        const value = formatExpirationLabel(quote.contract?.expirationDate);
        if (!unique.has(value)) {
          unique.set(value, {
            value,
            label: value,
            dte: daysToExpiration(actualDate),
            actualDate,
          });
        }
      });
      return Array.from(unique.values()).sort(
        (left, right) =>
          (left.actualDate?.getTime() ?? 0) -
          (right.actualDate?.getTime() ?? 0),
      );
    }

    return [];
  }, [optionChainQuery.data]);
  const chainRowsByExpiration = useMemo(() => {
    if (optionChainQuery.data?.contracts?.length) {
      const grouped = {};
      optionChainQuery.data.contracts.forEach((quote) => {
        const expiration = formatExpirationLabel(
          quote.contract?.expirationDate,
        );
        if (!grouped[expiration]) grouped[expiration] = [];
        grouped[expiration].push(quote);
      });

      return Object.fromEntries(
        Object.entries(grouped).map(([expiration, quotes]) => [
          expiration,
          buildOptionChainRowsFromApi(
            quotes,
            activeTickerInfo.price,
          ),
        ]),
      );
    }

    return {};
  }, [optionChainQuery.data, activeTickerInfo.price]);
  const activeExpiration = expirationOptions.find(
    (option) => option.value === contract.exp,
  ) ||
    expirationOptions[0] || {
      value: contract.exp,
      label: contract.exp,
      dte: daysToExpiration(contract.exp),
      actualDate: parseExpirationValue(contract.exp),
    };
  const activeChainRows =
    chainRowsByExpiration[activeExpiration.value] ||
    chainRowsByExpiration[contract.exp] ||
    [];
  const optionChainStatus = optionChainQuery.data?.contracts?.length
    ? "live"
    : optionChainQuery.isPending
      ? "loading"
      : optionChainQuery.isError
        ? "offline"
        : "empty";
  const tickerFlowQuery = useQuery({
    queryKey: ["trade-flow", activeTicker],
    queryFn: () =>
      listFlowEventsRequest({ underlying: activeTicker, limit: 80 }),
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  const tickerFlowEvents = useMemo(() => {
    const liveEvents =
      tickerFlowQuery.data?.events?.map(mapFlowEventToUi) || [];
    if (liveEvents.length) {
      return liveEvents.sort((left, right) => right.premium - left.premium);
    }
    return [];
  }, [tickerFlowQuery.data, activeTicker]);
  const tradeFlowStatus = tickerFlowEvents.length
    ? "live"
    : tickerFlowQuery.isPending
      ? "loading"
      : tickerFlowQuery.isError
        ? "offline"
        : "empty";
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
    const quote = activeQuoteQuery.data?.quotes?.find(
      (item) => item.symbol?.toUpperCase() === activeTicker,
    );
    if (!quote) return;

    const tradeInfo = ensureTradeTickerInfo(
      activeTicker,
      activeTickerInfo.name || activeTicker,
    );
    tradeInfo.price = quote.price ?? tradeInfo.price;
    tradeInfo.chg = quote.change ?? tradeInfo.chg;
    tradeInfo.pct = quote.changePercent ?? tradeInfo.pct;
    tradeInfo.open = quote.open ?? tradeInfo.open ?? null;
    tradeInfo.high = quote.high ?? tradeInfo.high ?? null;
    tradeInfo.low = quote.low ?? tradeInfo.low ?? null;
    tradeInfo.prevClose = quote.prevClose ?? tradeInfo.prevClose ?? null;
    tradeInfo.volume = quote.volume ?? tradeInfo.volume ?? null;
    tradeInfo.updatedAt = quote.updatedAt ?? tradeInfo.updatedAt ?? null;
  }, [activeQuoteQuery.data, activeTicker, activeTickerInfo.name]);

  // Helper: focus a ticker, and add to recent strip if not present
  const focusTicker = (ticker, fallbackName = ticker) => {
    const normalized = ticker?.toUpperCase?.() || ticker;
    if (!normalized) return;
    ensureTradeTickerInfo(normalized, fallbackName);
    setActiveTicker(normalized);
    setRecentTickers((prev) =>
      prev.includes(normalized) ? prev : [...prev, normalized].slice(-8),
    );
  };
  const closeTicker = (ticker) => {
    setRecentTickers((prev) => {
      const filtered = prev.filter((t) => t !== ticker);
      if (ticker === activeTicker && filtered.length > 0)
        setActiveTicker(filtered[0]);
      return filtered;
    });
  };

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

  useEffect(() => {
    if (!expirationOptions.length) return;
    if (expirationOptions.some((option) => option.value === contract.exp))
      return;

    const nextExpiration = expirationOptions[0];
    const atmRow = (chainRowsByExpiration[nextExpiration.value] || []).find(
      (row) => row.isAtm,
    );
    updateContract({
      exp: nextExpiration.value,
      strike: atmRow?.k ?? contract.strike,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker, expirationOptions, chainRowsByExpiration]);

  useEffect(() => {
    if (!activeChainRows.length) return;
    if (activeChainRows.some((row) => row.k === contract.strike)) return;

    const atmRow =
      activeChainRows.find((row) => row.isAtm) ||
      activeChainRows[Math.floor(activeChainRows.length / 2)];
    updateContract({ strike: atmRow?.k ?? contract.strike });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker, activeExpiration.value, activeChainRows, contract.strike]);

  // Strategy → pick a strike near the desired delta on the active ticker's chain
  const applyStrategy = (strategy) => {
    if (!activeChainRows.length) {
      toast.push({
        kind: "info",
        title: "Chain still loading",
        body: "Wait for a live option chain before applying a strategy preset.",
      });
      return;
    }
    const chain = activeChainRows;
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
  };

  // Slot prop adapter for existing components that expect { ticker, strike, cp, exp }
  const slot = { ticker: activeTicker, ...contract };

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
        onAddNew={() => setShowUniverseSearch((open) => !open)}
      />
      <TickerUniverseSearchPanel
        open={showUniverseSearch}
        onClose={() => setShowUniverseSearch(false)}
        onSelectTicker={(result) => {
          ensureTradeTickerInfo(result.ticker, result.name || result.ticker);
          focusTicker(result.ticker, result.name || result.ticker);
          setShowUniverseSearch(false);
        }}
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
        <TradeTickerHeader
          ticker={activeTicker}
          chainRows={activeChainRows}
          expiration={activeExpiration}
          chainStatus={optionChainStatus}
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
        {/* Top zone: Equity chart + Options chain side by side */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 1fr",
            gap: sp(6),
            height: dim(340),
            flexShrink: 0,
          }}
        >
          <TradeEquityPanel
            ticker={activeTicker}
            flowEvents={tickerFlowEvents}
            stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
          />
          <TradeChainPanel
            ticker={activeTicker}
            contract={contract}
            chainRows={activeChainRows}
            expirations={expirationOptions}
            heldContracts={heldContracts}
            chainStatus={optionChainStatus}
            onSelectContract={(strike, cp) => updateContract({ strike, cp })}
            onChangeExp={(exp) => updateContract({ exp })}
          />
        </div>
        {/* Middle zone: Contract chart + Spot flow + Options flow */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr 1.5fr",
            gap: sp(6),
            height: dim(260),
            flexShrink: 0,
          }}
        >
          <TradeContractDetailPanel
            ticker={activeTicker}
            contract={contract}
            chainRows={activeChainRows}
            heldContracts={heldContracts}
            chainStatus={optionChainStatus}
          />
          <TradeSpotFlowPanel
            ticker={activeTicker}
            flowEvents={tickerFlowEvents}
          />
          <TradeOptionsFlowPanel
            ticker={activeTicker}
            flowEvents={tickerFlowEvents}
          />
        </div>
        {/* Bottom zone: Order ticket + Strategy/Greeks + L2/Tape/Flow tabs + Positions */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(260px, 1fr) minmax(280px, 1fr) minmax(280px, 1fr) minmax(360px, 1.4fr)",
            gap: sp(6),
            height: dim(290),
            flexShrink: 0,
          }}
        >
          <TradeOrderTicket
            slot={slot}
            chainRows={activeChainRows}
            expiration={activeExpiration}
            accountId={accountId}
            environment={environment}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
          />
          <TradeStrategyGreeksPanel
            slot={slot}
            chainRows={activeChainRows}
            onApplyStrategy={applyStrategy}
          />
          <TradeL2Panel
            slot={slot}
            chainRows={activeChainRows}
            flowEvents={tickerFlowEvents}
            accountId={accountId}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
          />
          <TradePositionsPanel
            accountId={accountId}
            environment={environment}
            brokerConfigured={brokerConfigured}
            brokerAuthenticated={brokerAuthenticated}
            onLoadPosition={({ ticker, strike, cp, exp }) => {
              focusTicker(ticker);
              setContracts((c) => ({ ...c, [ticker]: { strike, cp, exp } }));
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default TradeScreen;
