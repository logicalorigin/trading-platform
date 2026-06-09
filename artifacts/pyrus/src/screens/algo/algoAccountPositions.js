import {
  asRecord,
  formatContractLabel,
  mergeOptionQuoteSnapshot,
  numberFrom,
  optionProviderContractId,
} from "./algoHelpers";
import { normalizeLegacyAlgoBrandText } from "./algoBranding.js";

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

const positionMarketDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateOrNull = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const raw = value.trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return new Date(
      Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), 12),
    );
  }
  const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dashed) {
    return new Date(
      Date.UTC(Number(dashed[1]), Number(dashed[2]) - 1, Number(dashed[3]), 12),
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateOnlyMarketDateKey = (value) => {
  if (typeof value === "string") {
    const raw = value.trim();
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  }
  if (
    value instanceof Date &&
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  ) {
    return value.toISOString().slice(0, 10);
  }
  return null;
};

const marketDateKey = (value) => {
  const dateOnlyKey = dateOnlyMarketDateKey(value);
  if (dateOnlyKey) return dateOnlyKey;
  const date = dateOrNull(value);
  if (!date) return null;
  const parts = positionMarketDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
};

const positionOpenedOnCurrentMarketDay = (openedAt, now = new Date()) => {
  const opened = dateOrNull(openedAt);
  const observedAt = dateOrNull(now);
  if (!opened || !observedAt || opened.getTime() > observedAt.getTime()) {
    return false;
  }
  const openedKey = marketDateKey(opened);
  const nowKey = marketDateKey(observedAt);
  return Boolean(openedKey && nowKey && openedKey === nowKey);
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
    price: firstPositiveNumber(
      position?.underlyingPrice,
      candidate?.underlyingPrice,
      candidate?.signalPrice,
      signal?.signalPrice,
      signal?.price,
      signal?.close,
    ),
    bid: firstPositiveNumber(
      position?.underlyingBid,
      candidate?.underlyingBid,
      signal?.bid,
    ),
    ask: firstPositiveNumber(
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
const normalizeProviderIdentity = (value) => {
  const text = normalizeIdentity(value);
  return text && !/^O:/i.test(text) ? text : "";
};
const normalizeExpirationDateKey = (value) => {
  const text = firstText(value);
  if (!text) return "";
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compactDate) return `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
};

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
          return normalizeProviderIdentity(optionProviderContractId(selectedContract));
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
      runtimeProviderContractIds.has(
        normalizeProviderIdentity(
          optionProviderContractId(row?.optionContract) ||
            asRecord(row?.optionQuote).providerContractId,
        ),
      ),
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
    const signalAt = firstText(position?.signalAt, candidate.signalAt, signal.signalAt);
    const purchasedAt = firstText(
      position?.purchasedAt,
      position?.filledAt,
      position?.openedAt,
      signalAt,
    );
    const sameDayPosition = positionOpenedOnCurrentMarketDay(
      firstText(position?.openedAt, purchasedAt),
    );
    const dayChange =
      sameDayPosition && unrealizedPnl != null
        ? unrealizedPnl
        : perContractDayChange != null
          ? perContractDayChange * quantity * multiplier
          : null;
    const dayChangePercent =
      sameDayPosition && unrealizedPnlPercent != null
        ? unrealizedPnlPercent
        : optionDayChangePercent(optionQuote);
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
      positionType: "option",
      optionContract,
      optionQuote,
      underlyingMarket,
      automationContext: {
        entryPrice: entry,
        peakPrice: firstPositiveNumber(position?.peakPrice),
        stopPrice: firstPositiveNumber(position?.stopPrice),
        premiumAtRisk: firstFiniteNumber(position?.premiumAtRisk),
        purchasedAt,
        openedAt: firstText(position?.openedAt, purchasedAt),
        signalAt,
        barsSinceSignal: firstFiniteNumber(
          position?.barsSinceSignal,
          signal.barsSinceSignal,
          candidate.barsSinceSignal,
        ),
        signalDirection: firstText(position?.direction, candidate.direction, signal.direction),
        lastMarkedAt: firstText(position?.lastMarkedAt),
        timeframe: firstText(
          position?.timeframe,
          candidate.timeframe,
          signal.timeframe,
        ),
        signalScore: firstFiniteNumber(
          position?.signalQuality?.score,
          candidate.signalQuality?.score,
          signal.score,
        ),
        signalTier: firstText(
          position?.signalQuality?.tier,
          candidate.signalQuality?.tier,
        ),
        signalReasons: Array.isArray(position?.signalQuality?.reasons)
          ? position.signalQuality.reasons
          : Array.isArray(candidate.signalQuality?.reasons)
            ? candidate.signalQuality.reasons
            : [],
      },
      sector: "",
      quantity,
      averageCost: entry,
      mark,
      dayChange,
      dayChangePercent,
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
          deploymentName: normalizeLegacyAlgoBrandText(
            firstText(
              position?.deploymentName,
              candidate.deploymentName,
              signal.deploymentName,
              "Algo signal-options",
            ),
          ),
          deploymentId: firstText(
            position?.deploymentId,
            candidate.deploymentId,
            signal.deploymentId,
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

const optionContractIdentityKey = (row) => {
  const contract = asRecord(row?.optionContract);
  const underlying = normalizeSymbol(contract.underlying || row?.symbol);
  const expiration = normalizeExpirationDateKey(
    contract.expirationDate || contract.exp || contract.expiry,
  );
  const strike = firstFiniteNumber(contract.strike);
  const right = normalizeRight(contract.right || contract.cp);
  if (!underlying || !expiration || strike == null || !right) return "";
  return ["contract", underlying, expiration, String(strike), right].join(":");
};

const accountRowIndexKeys = (row) => {
  const contract = asRecord(row?.optionContract);
  const quote = asRecord(row?.optionQuote);
  const providerId = normalizeProviderIdentity(
    optionProviderContractId(contract) || quote.providerContractId,
  );
  return [
    providerId ? `provider:${providerId}` : "",
    optionContractIdentityKey(row),
    normalizeSymbol(row?.symbol) ? `symbol:${normalizeSymbol(row?.symbol)}` : "",
  ].filter(Boolean);
};

const buildAccountRowIndex = (accountRows = []) => {
  const index = new Map();
  const duplicateKeys = new Set();
  accountRows.forEach((row) => {
    accountRowIndexKeys(row).forEach((key) => {
      if (duplicateKeys.has(key)) return;
      if (index.has(key)) {
        index.delete(key);
        duplicateKeys.add(key);
        return;
      }
      index.set(key, row);
    });
  });
  return index;
};

const findMatchingAccountRow = (runtimeRow, accountRowIndex) => {
  for (const key of accountRowIndexKeys(runtimeRow)) {
    const row = accountRowIndex.get(key);
    if (row) return row;
  }
  return null;
};

const mergeAccountOptionContract = (runtimeContract, accountContract, accountQuote) => {
  const runtime = asRecord(runtimeContract);
  const account = asRecord(accountContract);
  const quote = asRecord(accountQuote);
  if (!Object.keys(account).length) return runtimeContract;
  return {
    ...runtime,
    ...account,
    ticker: firstText(account.ticker, account.localSymbol, runtime.ticker, runtime.localSymbol),
    underlying: firstText(account.underlying, runtime.underlying).toUpperCase(),
    expirationDate: firstText(account.expirationDate, runtime.expirationDate),
    right: normalizeRight(account.right || runtime.right),
    providerContractId:
      normalizeProviderIdentity(optionProviderContractId(account)) ||
      normalizeProviderIdentity(quote.providerContractId) ||
      normalizeProviderIdentity(optionProviderContractId(runtime)) ||
      null,
  };
};

const mergeAccountOptionQuote = (runtimeQuote, accountQuote, accountContract) => {
  const runtime = asRecord(runtimeQuote);
  const account = asRecord(accountQuote);
  const contract = asRecord(accountContract);
  if (!Object.keys(account).length) return runtimeQuote;
  return {
    ...runtime,
    ...account,
    providerContractId:
      normalizeProviderIdentity(account.providerContractId) ||
      normalizeProviderIdentity(optionProviderContractId(contract)) ||
      normalizeProviderIdentity(runtime.providerContractId) ||
      null,
    bid: firstFiniteNumber(account.bid, runtime.bid),
    ask: firstFiniteNumber(account.ask, runtime.ask),
    mid: firstFiniteNumber(account.mid, runtime.mid),
    mark: firstFiniteNumber(account.mark, runtime.mark),
    last: firstFiniteNumber(account.last, runtime.last),
    price: firstFiniteNumber(account.price, runtime.price),
  };
};

const mergeAccountPositionQuote = (runtimeQuote, accountQuote) => {
  const runtime = asRecord(runtimeQuote);
  const account = asRecord(accountQuote);
  if (!Object.keys(account).length) return runtimeQuote;
  return {
    ...runtime,
    ...account,
    bid: firstFiniteNumber(account.bid, runtime.bid),
    ask: firstFiniteNumber(account.ask, runtime.ask),
    mid: firstFiniteNumber(account.mid, runtime.mid),
    mark: firstFiniteNumber(account.mark, runtime.mark),
    last: firstFiniteNumber(account.last, runtime.last),
    price: firstFiniteNumber(account.price, runtime.price),
  };
};

const mergeUnderlyingMarket = (runtimeUnderlying, accountUnderlying) => {
  const runtime = asRecord(runtimeUnderlying);
  const account = asRecord(accountUnderlying);
  if (!Object.keys(account).length) return runtimeUnderlying;
  return {
    ...runtime,
    ...account,
    price: firstPositiveNumber(account.price, account.mark, runtime.price, runtime.mark),
    bid: firstPositiveNumber(account.bid, runtime.bid),
    ask: firstPositiveNumber(account.ask, runtime.ask),
    previousClose: firstPositiveNumber(
      account.previousClose,
      account.prevClose,
      runtime.previousClose,
      runtime.prevClose,
    ),
    symbol: firstText(account.symbol, runtime.symbol).toUpperCase(),
  };
};

const mergeAccountRowWithRuntimeSupplement = (accountRow, runtimeRow) => {
  if (!runtimeRow) return accountRow;
  const runtimeAutomation = asRecord(runtimeRow.automationContext);
  const accountAutomation = asRecord(accountRow.automationContext);
  return {
    ...runtimeRow,
    ...accountRow,
    optionContract: mergeAccountOptionContract(
      runtimeRow.optionContract,
      accountRow.optionContract,
      accountRow.optionQuote,
    ),
    optionQuote: mergeAccountOptionQuote(
      runtimeRow.optionQuote,
      accountRow.optionQuote,
      accountRow.optionContract,
    ),
    quote: mergeAccountPositionQuote(runtimeRow.quote, accountRow.quote),
    underlyingMarket: mergeUnderlyingMarket(
      runtimeRow.underlyingMarket,
      accountRow.underlyingMarket,
    ),
    automationContext: {
      ...runtimeAutomation,
      ...accountAutomation,
      tradeManagement: {
        ...asRecord(runtimeAutomation.tradeManagement),
        ...asRecord(accountAutomation.tradeManagement),
      },
    },
    sourceAttribution:
      Array.isArray(accountRow.sourceAttribution) && accountRow.sourceAttribution.length
        ? accountRow.sourceAttribution
        : runtimeRow.sourceAttribution,
    sourceType: accountRow.sourceType || runtimeRow.sourceType,
    strategyLabel: accountRow.strategyLabel || runtimeRow.strategyLabel,
    attributionStatus: accountRow.attributionStatus || runtimeRow.attributionStatus,
  };
};

export const mergeAlgoRuntimeAndAccountPositionRows = ({
  runtimeRows = [],
  accountRows = [],
} = {}) => {
  if (!runtimeRows.length) return accountRows || [];
  if (!accountRows.length) return runtimeRows || [];
  const runtimeRowIndex = buildAccountRowIndex(runtimeRows);
  return accountRows.map((accountRow) =>
    mergeAccountRowWithRuntimeSupplement(
      accountRow,
      findMatchingAccountRow(accountRow, runtimeRowIndex),
    ),
  );
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
