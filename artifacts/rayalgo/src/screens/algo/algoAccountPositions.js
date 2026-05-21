import {
  asRecord,
  formatContractLabel,
  mergeOptionQuoteSnapshot,
  numberFrom,
  optionProviderContractId,
} from "./algoHelpers";

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const isInternalOptionIdentifier = (value) =>
  /^twsopt:/i.test(String(value ?? "").trim());

const firstDisplayText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !isInternalOptionIdentifier(text)) return text;
  }
  return "";
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
};

const normalizeRight = (value) => {
  const text = String(value || "").trim().toLowerCase();
  if (text === "c" || text === "call") return "call";
  if (text === "p" || text === "put") return "put";
  return text;
};

const resolvePositionContract = (position, candidate) => {
  const positionContract = asRecord(position?.selectedContract);
  if (Object.keys(positionContract).length) return positionContract;
  return asRecord(candidate?.selectedContract);
};

const optionContractFromSelection = (position, candidate, selectedContract) => {
  const symbol = firstText(position?.symbol, candidate?.symbol).toUpperCase();
  const underlying = firstText(selectedContract.underlying, symbol).toUpperCase();
  const right = normalizeRight(
    selectedContract.right ||
      selectedContract.cp ||
      position?.optionRight ||
      candidate?.optionRight,
  );
  return {
    ticker: firstDisplayText(
      selectedContract.ticker,
      selectedContract.optionTicker,
      selectedContract.localSymbol,
    ),
    underlying,
    expirationDate: firstText(
      selectedContract.expirationDate,
      selectedContract.exp,
      selectedContract.expiry,
    ),
    strike: firstFiniteNumber(selectedContract.strike),
    right,
    multiplier: firstFiniteNumber(
      selectedContract.multiplier,
      selectedContract.sharesPerContract,
      100,
    ),
    sharesPerContract: firstFiniteNumber(
      selectedContract.sharesPerContract,
      selectedContract.multiplier,
      100,
    ),
    providerContractId: optionProviderContractId(selectedContract) || null,
  };
};

const quoteMid = (quote) => {
  const bid = firstPositiveNumber(quote.bid);
  const ask = firstPositiveNumber(quote.ask);
  if (bid != null && ask != null) return (bid + ask) / 2;
  return null;
};

const optionMarkPrice = (quote, position) =>
  firstPositiveNumber(
    quote.mark,
    quote.mid,
    quoteMid(quote),
    quote.last,
    quote.price,
    position?.lastMarkPrice,
    position?.entryPrice,
  );

const optionDayChange = (quote) =>
  firstFiniteNumber(quote.dayChange, quote.change, quote.netChange);

const optionDayChangePercent = (quote) =>
  firstFiniteNumber(
    quote.dayChangePercent,
    quote.changePercent,
    quote.percentChange,
  );

const underlyingMarketFromPosition = (position, candidate, signal, optionContract) => {
  const symbol = firstText(
    optionContract.underlying,
    position?.symbol,
    candidate?.symbol,
    signal?.symbol,
  ).toUpperCase();
  return {
    symbol,
    price: firstFiniteNumber(
      position?.underlyingPrice,
      candidate?.underlyingPrice,
      candidate?.signalPrice,
      signal?.signalPrice,
      signal?.price,
      signal?.close,
    ),
    bid: firstFiniteNumber(
      position?.underlyingBid,
      candidate?.underlyingBid,
      signal?.bid,
    ),
    ask: firstFiniteNumber(
      position?.underlyingAsk,
      candidate?.underlyingAsk,
      signal?.ask,
    ),
    updatedAt: firstText(
      position?.underlyingUpdatedAt,
      candidate?.underlyingUpdatedAt,
      signal?.updatedAt,
      signal?.signalAt,
      position?.lastMarkedAt,
    ),
  };
};

const buildPositionId = (position, optionContract) =>
  [
    "algo-option",
    optionContract.underlying,
    optionContract.expirationDate,
    optionContract.strike,
    optionContract.right,
    optionContract.providerContractId || position?.id || position?.candidateId,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(":");

const normalizeIdentity = (value) => String(value ?? "").trim();
const normalizeSymbol = (value) => normalizeIdentity(value).toUpperCase();

export const collectAlgoRuntimeProviderContractIds = (
  positions = [],
  symbolIndex = {},
) =>
  Array.from(
    new Set(
      (positions || [])
        .map((position) => {
          const symbol = normalizeSymbol(position?.symbol);
          const indexed = asRecord(symbolIndex[symbol]);
          const selectedContract = resolvePositionContract(
            position,
            indexed.candidate,
          );
          return optionProviderContractId(selectedContract);
        })
        .filter(Boolean),
    ),
  );

const collectRuntimeSymbols = (positions = [], symbolIndex = {}) =>
  Array.from(
    new Set(
      (positions || [])
        .map((position) => {
          const symbol = normalizeSymbol(position?.symbol);
          const indexed = asRecord(symbolIndex[symbol]);
          const selectedContract = resolvePositionContract(
            position,
            indexed.candidate,
          );
          return normalizeSymbol(
            selectedContract.underlying ||
              position?.symbol ||
              indexed.candidate?.symbol,
          );
        })
        .filter(Boolean),
    ),
  );

const rowDeploymentIds = (row) => {
  const attribution = Array.isArray(row?.sourceAttribution)
    ? row.sourceAttribution
    : [];
  return Array.from(
    new Set(
      [
        row?.deploymentId,
        row?.sourceDeploymentId,
        ...attribution.map((item) => asRecord(item).deploymentId),
      ]
        .map(normalizeIdentity)
        .filter(Boolean),
    ),
  );
};

export const filterAccountPositionRowsForRuntimePositions = ({
  rows = [],
  positions = [],
  symbolIndex = {},
  deploymentId = null,
} = {}) => {
  const deploymentRows = filterAccountPositionRowsForDeployment({
    rows,
    deploymentId,
  });
  const runtimeProviderContractIds = new Set(
    collectAlgoRuntimeProviderContractIds(positions, symbolIndex),
  );
  if (runtimeProviderContractIds.size) {
    return deploymentRows.filter((row) =>
      runtimeProviderContractIds.has(optionProviderContractId(row?.optionContract)),
    );
  }

  const runtimeSymbols = new Set(collectRuntimeSymbols(positions, symbolIndex));
  if (runtimeSymbols.size) {
    return deploymentRows.filter((row) =>
      runtimeSymbols.has(normalizeSymbol(row?.symbol)),
    );
  }

  return deploymentRows;
};

export const filterAccountPositionRowsForDeployment = ({
  rows = [],
  deploymentId = null,
} = {}) => {
  const normalizedDeploymentId = normalizeIdentity(deploymentId);
  return normalizedDeploymentId
    ? (rows || []).filter((row) =>
        rowDeploymentIds(row).includes(normalizedDeploymentId),
      )
    : rows || [];
};

export const buildAlgoAccountPositionRows = ({
  positions = [],
  symbolIndex = {},
  liveQuoteByContractId = {},
} = {}) => {
  const rows = (positions || []).map((position) => {
    const symbol = String(position?.symbol || "").toUpperCase();
    const indexed = asRecord(symbolIndex[symbol]);
    const candidate = asRecord(indexed.candidate);
    const signal = asRecord(indexed.signal);
    const selectedContract = resolvePositionContract(position, candidate);
    const optionContract = optionContractFromSelection(
      position,
      candidate,
      selectedContract,
    );
    const providerContractId = optionContract.providerContractId || "";
    const positionQuote = asRecord(position?.quote);
    const candidateQuote = asRecord(candidate.quote);
    const baseQuote = Object.keys(positionQuote).length
      ? positionQuote
      : candidateQuote;
    const quote = mergeOptionQuoteSnapshot(
      baseQuote,
      liveQuoteByContractId[providerContractId],
    );
    const bid = firstPositiveNumber(quote.bid, asRecord(candidate.liquidity).bid);
    const ask = firstPositiveNumber(quote.ask, asRecord(candidate.liquidity).ask);
    const mid = firstPositiveNumber(
      quote.mid,
      asRecord(candidate.liquidity).mid,
      quoteMid({ bid, ask }),
    );
    const optionQuote = {
      ...quote,
      bid,
      ask,
      mid,
      mark: firstPositiveNumber(quote.mark, mid, quote.last, quote.price),
      spreadPctOfMid: firstFiniteNumber(
        quote.spreadPctOfMid,
        asRecord(candidate.liquidity).spreadPctOfMid,
      ),
      spreadCents: firstFiniteNumber(
        quote.spreadCents,
        asRecord(candidate.liquidity).spreadCents,
      ),
    };
    const entry = firstPositiveNumber(position?.entryPrice);
    const mark = optionMarkPrice(optionQuote, position);
    const quantity = numberFrom(position?.quantity, 0);
    const multiplier = firstFiniteNumber(
      optionContract.multiplier,
      optionContract.sharesPerContract,
      100,
    );
    const marketValue =
      mark != null ? mark * quantity * multiplier : null;
    const costBasis =
      entry != null ? entry * quantity * multiplier : null;
    const perContractDayChange = optionDayChange(optionQuote);
    const unrealizedPnl =
      marketValue != null && costBasis != null ? marketValue - costBasis : null;
    const capitalAtRisk =
      entry != null ? Math.abs(entry * quantity * multiplier) : null;
    const unrealizedPnlPercent =
      unrealizedPnl != null && capitalAtRisk
        ? (unrealizedPnl / capitalAtRisk) * 100
        : null;
    const underlyingMarket = underlyingMarketFromPosition(
      position,
      candidate,
      signal,
      optionContract,
    );
    const rowId = buildPositionId(position, optionContract);
    const description = [
      formatContractLabel(optionContract),
      optionContract.expirationDate,
      providerContractId ? `conid ${providerContractId}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      id: rowId,
      accountId: "ALGO_SHADOW",
      accounts: ["Algo"],
      symbol: optionContract.underlying || symbol,
      description,
      assetClass: "Options",
      optionContract,
      optionQuote,
      underlyingMarket,
      automationContext: {
        entryPrice: entry,
        peakPrice: firstPositiveNumber(position?.peakPrice),
        stopPrice: firstPositiveNumber(position?.stopPrice),
        premiumAtRisk: firstFiniteNumber(position?.premiumAtRisk),
        openedAt: firstText(position?.openedAt, position?.signalAt),
        lastMarkedAt: firstText(position?.lastMarkedAt),
        timeframe: firstText(
          position?.timeframe,
          candidate.timeframe,
          signal.timeframe,
        ),
        signalScore: firstFiniteNumber(signal.score),
      },
      sector: "",
      quantity,
      averageCost: entry,
      mark,
      dayChange:
        perContractDayChange != null
          ? perContractDayChange * quantity * multiplier
          : null,
      dayChangePercent: optionDayChangePercent(optionQuote),
      unrealizedPnl,
      unrealizedPnlPercent,
      marketValue,
      weightPercent: null,
      betaWeightedDelta:
        firstFiniteNumber(optionQuote.delta) != null
          ? firstFiniteNumber(optionQuote.delta) * quantity * multiplier
          : null,
      lots:
        quantity && entry != null
          ? [
              {
                accountId: "Algo",
                quantity,
                averageCost: entry,
                marketValue,
                unrealizedPnl,
              },
            ]
          : [],
      openOrders: [],
      source: "ALGO_SIGNAL_OPTIONS",
      sourceType: "automation",
      strategyLabel: "Signal Options",
      attributionStatus: "attributed",
      sourceAttribution: [
        {
          sourceType: "automation",
          strategyLabel: "Signal Options",
          candidateId: firstText(position?.candidateId, candidate.id),
          sourceEventId: firstText(position?.id, position?.signalId),
          quantity,
          deploymentName: firstText(
            position?.deploymentName,
            candidate.deploymentName,
            signal.deploymentName,
            "Algo signal-options",
          ),
        },
      ],
    };
  });

  const totalAbsMarketValue = rows.reduce(
    (sum, row) => sum + Math.abs(Number(row.marketValue) || 0),
    0,
  );

  return rows.map((row) => ({
    ...row,
    weightPercent:
      totalAbsMarketValue > 0
        ? (Math.abs(Number(row.marketValue) || 0) / totalAbsMarketValue) * 100
        : null,
  }));
};

export const buildAlgoAccountPositionsResponse = (rows = []) => {
  const totals = rows.reduce(
    (acc, row) => {
      const marketValue = Number(row.marketValue);
      const unrealizedPnl = Number(row.unrealizedPnl);
      const dayChange = Number(row.dayChange);
      if (Number.isFinite(marketValue)) {
        acc.netExposure += marketValue;
        if (marketValue >= 0) acc.grossLong += marketValue;
        else acc.grossShort += marketValue;
      }
      if (Number.isFinite(unrealizedPnl)) acc.unrealizedPnl += unrealizedPnl;
      if (Number.isFinite(dayChange)) acc.dayChange += dayChange;
      return acc;
    },
    {
      netExposure: 0,
      grossLong: 0,
      grossShort: 0,
      unrealizedPnl: 0,
      dayChange: 0,
      weightPercent: rows.length ? 100 : null,
    },
  );

  return {
    positions: rows,
    totals,
  };
};
