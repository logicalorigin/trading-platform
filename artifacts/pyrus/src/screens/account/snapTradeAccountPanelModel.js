const COMBINED_ACCOUNT_ID = "combined";
const SHADOW_ACCOUNT_ID = "shadow";

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const sumNullable = (values) => {
  const finiteValues = values
    .map(finiteNumber)
    .filter((value) => value != null);
  if (!finiteValues.length) return null;
  return finiteValues.reduce((sum, value) => sum + value, 0);
};

const roundFinancialNumber = (value) => Number(value.toFixed(6));

const toIso = (value, fallback = new Date()) => {
  const date = value instanceof Date ? value : new Date(value ?? fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
};

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const normalizeTickerSymbol = (value, fallback = "") =>
  normalizeText(value, fallback).toUpperCase();

const normalizeOptionRight = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "call" || normalized === "c") return "call";
  if (normalized === "put" || normalized === "p") return "put";
  return "";
};

const parseOccOptionSymbol = (value) => {
  const compact = normalizeText(value)
    .replace(/^O:/i, "")
    .replace(/\s+/g, "");
  const match = /^([A-Z0-9.]+)(\d{6})([CP])(\d{8})$/i.exec(compact);
  if (!match) return null;

  const [, rawUnderlying, yymmdd, rightCode, rawStrike] = match;
  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const expirationDate = new Date(Date.UTC(year, month - 1, day));
  const strike = Number(rawStrike) / 1000;
  if (
    !rawUnderlying ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    Number.isNaN(expirationDate.getTime()) ||
    expirationDate.getUTCFullYear() !== year ||
    expirationDate.getUTCMonth() !== month - 1 ||
    expirationDate.getUTCDate() !== day ||
    !Number.isFinite(strike)
  ) {
    return null;
  }

  const underlying = normalizeTickerSymbol(rawUnderlying);
  const multiplier = 100;
  return {
    ticker: `${underlying}${yymmdd}${rightCode.toUpperCase()}${rawStrike}`,
    underlying,
    expirationDate: expirationDate.toISOString().slice(0, 10),
    strike,
    right: rightCode.toUpperCase() === "P" ? "put" : "call",
    multiplier,
    sharesPerContract: multiplier,
    providerContractId: null,
    brokerContractId: null,
  };
};

const normalizeOptionContract = (position) => {
  const contract = position?.optionContract;
  if (contract) {
    const underlying = normalizeTickerSymbol(
      contract.underlying,
      position?.symbol || position?.rawSymbol || "",
    );
    const strike = finiteNumber(contract.strike);
    const right = normalizeOptionRight(contract.right);
    const expirationDate =
      contract.expirationDate || contract.exp || contract.expiry;
    if (underlying && expirationDate && strike != null && right) {
      const multiplier =
        finiteNumber(contract.multiplier) ??
        finiteNumber(contract.sharesPerContract) ??
        100;
      return {
        ticker: normalizeText(
          contract.ticker,
          position?.rawSymbol || position?.symbol || "",
        ),
        underlying,
        expirationDate,
        strike,
        right,
        multiplier,
        sharesPerContract:
          finiteNumber(contract.sharesPerContract) ?? multiplier,
        providerContractId: contract.providerContractId ?? null,
        brokerContractId: contract.brokerContractId ?? null,
      };
    }
  }

  if (position?.assetClass !== "option") {
    return null;
  }
  return (
    parseOccOptionSymbol(position?.symbol) ??
    parseOccOptionSymbol(position?.rawSymbol)
  );
};

export const normalizeAccountProvider = (account) => {
  const provider = normalizeText(account?.provider).toLowerCase();
  if (provider === "snaptrade") return "snaptrade";
  if (provider === "robinhood") return "robinhood";
  if (provider === "schwab") return "schwab";
  if (provider === "ibkr") return "ibkr";
  return provider ? "brokerage" : "unknown";
};

export const resolveAccountProviderScope = ({ accountTab, accounts = [] } = {}) => {
  if (accountTab === SHADOW_ACCOUNT_ID) return "shadow";
  if (accountTab && accountTab !== "all") {
    return normalizeAccountProvider(
      accounts.find((account) => account?.id === accountTab),
    );
  }

  const providers = new Set(
    accounts.map(normalizeAccountProvider).filter((provider) => provider !== "unknown"),
  );
  if (!providers.size) return "unknown";
  if (providers.size === 1) return providers.values().next().value;
  return "mixed";
};

const metric = ({ value, currency, field, updatedAt }) => ({
  value: finiteNumber(value),
  currency: currency ?? null,
  source: "SNAPTRADE_PORTFOLIO",
  field,
  updatedAt,
});

const positionTypeForSnapTrade = (position) =>
  position?.assetClass === "option" ? "option" : "stock";

const assetLabelForSnapTrade = (position) =>
  position?.assetClass === "option"
    ? "Option"
    : position?.cashEquivalent
      ? "Cash"
      : "Stock";

const signedQuantity = (position) => {
  const quantity = finiteNumber(position?.quantity) ?? 0;
  return position?.side === "short" ? -Math.abs(quantity) : quantity;
};

const optionMultiplierForSnapTradePosition = (optionContract) =>
  optionContract
    ? finiteNumber(optionContract.multiplier) ??
      finiteNumber(optionContract.sharesPerContract) ??
      100
    : 1;

const averageCostForSnapTradePosition = (position, optionContract = null) => {
  const explicit = finiteNumber(position?.averagePurchasePrice);
  const quantity = Math.abs(signedQuantity(position));
  const multiplier = optionMultiplierForSnapTradePosition(optionContract);
  if (explicit != null) {
    if (optionContract && multiplier > 1) {
      const costBasis = finiteNumber(position?.costBasis);
      // Compare magnitudes: a short option reports a credit (negative) cost basis, so
      // a signed perContractCost would never match the positive premium and the
      // contract-scaled average would be left un-de-scaled (~100x too large).
      const perContractCost = costBasis != null && quantity > 0
        ? Math.abs(costBasis) / quantity
        : null;
      if (
        perContractCost != null &&
        Math.abs(perContractCost - explicit) <=
          Math.max(0.01, Math.abs(explicit) * 0.0001)
      ) {
        return roundFinancialNumber(explicit / multiplier);
      }
    }
    return explicit;
  }
  const costBasis = finiteNumber(position?.costBasis);
  if (costBasis != null && quantity > 0) {
    return roundFinancialNumber(costBasis / quantity / multiplier);
  }
  return null;
};

const marketValueForSnapTradePosition = (position, optionContract = null) => {
  const quantity = signedQuantity(position);
  const price = finiteNumber(position?.price);
  if (price != null) {
    return roundFinancialNumber(
      quantity * price * optionMultiplierForSnapTradePosition(optionContract),
    );
  }
  const explicit = finiteNumber(position?.marketValue);
  return explicit != null ? explicit : 0;
};

const unrealizedPnlForSnapTradePosition = (position, optionContract = null) => {
  const quantity = signedQuantity(position);
  const averageCost = averageCostForSnapTradePosition(position, optionContract);
  const multiplier = optionMultiplierForSnapTradePosition(optionContract);
  const marketValue = marketValueForSnapTradePosition(position, optionContract);
  if (averageCost != null && quantity !== 0) {
    const costBasis = averageCost * quantity * multiplier;
    return roundFinancialNumber(marketValue - costBasis);
  }
  return finiteNumber(position?.unrealizedPnl);
};

const buildSnapTradePositionRows = ({ accountId, positions = [], netLiquidation }) =>
  positions.map((position) => {
    const optionContract = normalizeOptionContract(position);
    const displaySymbol =
      optionContract?.underlying ??
      normalizeText(position.symbol, position.rawSymbol || "UNKNOWN");
    const quantity = signedQuantity(position);
    const averageCost = averageCostForSnapTradePosition(position, optionContract);
    const marketValue = marketValueForSnapTradePosition(position, optionContract);
    const unrealizedPnl = unrealizedPnlForSnapTradePosition(
      position,
      optionContract,
    );
    const costBasis =
      averageCost != null && quantity !== 0
        ? averageCost *
          quantity *
          optionMultiplierForSnapTradePosition(optionContract)
        : finiteNumber(position?.costBasis);
    const unrealizedPnlPercent =
      unrealizedPnl != null && costBasis
        ? (unrealizedPnl / Math.abs(costBasis)) * 100
        : null;
    const weightPercent =
      netLiquidation && netLiquidation !== 0
        ? (marketValue / Math.abs(netLiquidation)) * 100
        : null;
    return {
      id: `snaptrade:${position.snapTradePositionId || position.symbol}`,
      accountId,
      accounts: [accountId],
      symbol: displaySymbol,
      description:
        position.description ||
        position.rawSymbol ||
        normalizeText(position.symbol, "SnapTrade position"),
      assetClass: assetLabelForSnapTrade(position),
      positionType: positionTypeForSnapTrade(position),
      optionContract,
      marketDataSymbol:
        optionContract?.underlying ??
        normalizeText(position.symbol, position.rawSymbol || ""),
      sector: "Unknown",
      quantity,
      averageCost,
      mark: finiteNumber(position.price) ?? 0,
      dayChange: null,
      dayChangePercent: null,
      unrealizedPnl,
      unrealizedPnlPercent,
      marketValue,
      brokerMarketValue: marketValue,
      brokerUnrealizedPnl: unrealizedPnl,
      brokerUnrealizedPnlPercent: unrealizedPnlPercent,
      weightPercent,
      accountWeightPercent: weightPercent,
      scopedWeightPercent: weightPercent,
      betaWeightedDelta: null,
      lots: [],
      openOrders: [],
      source: "SNAPTRADE_POSITIONS",
      sourceType: "manual",
      strategyLabel: "Manual",
      attributionStatus: "unknown",
      sourceAttribution: [],
      openedAt: null,
      openedAtSource: null,
      quote: null,
      optionQuote: null,
    };
  });

const bucketRows = (entries, total, source) =>
  Array.from(entries.entries())
    .map(([label, value]) => ({
      label,
      value,
      weightPercent: total && total !== 0 ? (value / Math.abs(total)) * 100 : null,
      source,
    }))
    .filter((row) => Math.abs(row.value) > 1e-9)
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));

const normalizeSnapTradeOrderStatus = (status) => {
  const normalized = normalizeText(status).toLowerCase();
  if (/filled|executed|complete/.test(normalized)) return "filled";
  if (/cancel/.test(normalized)) return "canceled";
  if (/reject|fail/.test(normalized)) return "rejected";
  if (/expir/.test(normalized)) return "expired";
  if (/accept|open|working/.test(normalized)) return "accepted";
  return "submitted";
};

const normalizeSnapTradeOrderType = (type) => {
  const normalized = normalizeText(type).toLowerCase();
  if (/stop.*limit|limit.*stop/.test(normalized)) return "stop_limit";
  if (/stop/.test(normalized)) return "stop";
  if (/limit/.test(normalized)) return "limit";
  return "market";
};

const normalizeSnapTradeTimeInForce = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "gtc" || normalized.includes("good")) return "gtc";
  if (normalized === "ioc" || normalized.includes("immediate")) return "ioc";
  if (normalized === "fok" || normalized.includes("fill")) return "fok";
  return "day";
};

const isTerminalOrderStatus = (status) =>
  ["filled", "canceled", "rejected", "expired"].includes(status);

const buildSnapTradeOrderRows = ({ accountId, orders = [], tab, checkedAt }) =>
  orders
    .map((order) => {
      const status = normalizeSnapTradeOrderStatus(order.status);
      const placedAt = toIso(order.timePlaced || order.timeUpdated || checkedAt);
      const updatedAt = toIso(order.timeUpdated || order.timePlaced || checkedAt);
      return {
        id:
          order.brokerageOrderId ||
          order.brokerageGroupOrderId ||
          `${order.symbol || order.rawSymbol || "snaptrade"}:${placedAt}`,
        accountId,
        symbol: normalizeText(
          order.symbol,
          order.rawSymbol || order.optionTicker || "UNKNOWN",
        ),
        side: /sell/i.test(order.action || "") ? "sell" : "buy",
        type: normalizeSnapTradeOrderType(order.orderType),
        assetClass: order.optionSymbolId || order.optionTicker ? "option" : "equity",
        quantity:
          finiteNumber(order.totalQuantity) ??
          finiteNumber(order.openQuantity) ??
          finiteNumber(order.filledQuantity) ??
          0,
        filledQuantity: finiteNumber(order.filledQuantity) ?? 0,
        limitPrice: finiteNumber(order.limitPrice),
        stopPrice: finiteNumber(order.stopPrice),
        timeInForce: normalizeSnapTradeTimeInForce(order.timeInForce),
        status,
        placedAt,
        filledAt: order.timeExecuted ? toIso(order.timeExecuted) : null,
        updatedAt,
        averageFillPrice: finiteNumber(order.executionPrice),
        commission: null,
        source: "SNAPTRADE_ORDERS",
        sourceType: "manual",
        strategyLabel: "Manual",
        candidateId: null,
        deploymentId: null,
        deploymentName: null,
        sourceEventId: null,
      };
    })
    .filter((order) =>
      tab === "history"
        ? isTerminalOrderStatus(order.status)
        : !isTerminalOrderStatus(order.status),
    );

const buildSnapTradeEquityHistory = ({
  accountId,
  range,
  currency,
  netLiquidation,
  updatedAt,
}) => {
  const normalizedNav = finiteNumber(netLiquidation);
  const timestamp = toIso(updatedAt);
  return {
    accountId,
    range,
    currency,
    flexConfigured: false,
    lastFlexRefreshAt: null,
    benchmark: null,
    asOf: timestamp,
    latestSnapshotAt: timestamp,
    isStale: false,
    staleReason: null,
    terminalPointSource: "snaptrade_portfolio",
    liveTerminalIncluded: normalizedNav != null,
    sourceScope: "manual",
    selectedSnapshotSource: "SNAPTRADE_PORTFOLIO",
    points:
      normalizedNav == null
        ? []
        : [
            {
              timestamp,
              netLiquidation: normalizedNav,
              currency,
              source: "SNAPTRADE_PORTFOLIO",
              deposits: 0,
              withdrawals: 0,
              dividends: 0,
              fees: 0,
              returnPercent: 0,
              benchmarkPercent: null,
            },
          ],
    events: [],
    updatedAt: timestamp,
  };
};

const mergeSnapTradeEquityHistory = ({
  history,
  current,
  currency,
  updatedAt,
}) => {
  const historyPoints = Array.isArray(history?.points) ? history.points : [];
  if (!historyPoints.length) {
    return current;
  }
  const fallbackDate = new Date(updatedAt);
  const fallbackTimestamp = Number.isFinite(fallbackDate.getTime())
    ? fallbackDate
    : new Date();

  const currentPoint = Array.isArray(current?.points) ? current.points[0] : null;
  const pointByTimestamp = new Map();
  historyPoints.forEach((point) => {
    const timestamp = toIso(point?.timestamp, fallbackTimestamp);
    const nav = finiteNumber(point?.netLiquidation);
    if (nav == null) return;
    pointByTimestamp.set(timestamp, {
      ...point,
      timestamp,
      netLiquidation: nav,
      currency: point?.currency || currency,
      source: point?.source || "SNAPTRADE_BALANCE_HISTORY",
      deposits: finiteNumber(point?.deposits) ?? 0,
      withdrawals: finiteNumber(point?.withdrawals) ?? 0,
      dividends: finiteNumber(point?.dividends) ?? 0,
      fees: finiteNumber(point?.fees) ?? 0,
      returnPercent: finiteNumber(point?.returnPercent) ?? 0,
      benchmarkPercent: finiteNumber(point?.benchmarkPercent),
    });
  });

  const currentNav = finiteNumber(currentPoint?.netLiquidation);
  if (currentPoint && currentNav != null) {
    const timestamp = toIso(currentPoint.timestamp || updatedAt, fallbackTimestamp);
    const firstPoint = Array.from(pointByTimestamp.values()).sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    )[0];
    const firstNav = finiteNumber(firstPoint?.netLiquidation);
    pointByTimestamp.set(timestamp, {
      ...currentPoint,
      timestamp,
      netLiquidation: currentNav,
      currency: currentPoint.currency || currency,
      source: currentPoint.source || "SNAPTRADE_PORTFOLIO",
      returnPercent:
        firstNav && firstNav !== 0
          ? roundFinancialNumber(((currentNav - firstNav) / Math.abs(firstNav)) * 100)
          : 0,
    });
  }

  const points = Array.from(pointByTimestamp.values()).sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
  const lastPoint = points[points.length - 1] || null;
  const currentTimestamp = currentPoint
    ? toIso(currentPoint.timestamp || updatedAt, fallbackTimestamp)
    : null;
  const lastIsCurrent = Boolean(lastPoint && currentTimestamp === lastPoint.timestamp);
  return {
    ...current,
    ...history,
    range: current?.range || history?.range || "ALL",
    currency,
    asOf: lastPoint?.timestamp ?? history?.asOf ?? current?.asOf ?? null,
    latestSnapshotAt:
      lastPoint?.timestamp ??
      history?.latestSnapshotAt ??
      current?.latestSnapshotAt ??
      null,
    terminalPointSource: lastIsCurrent
      ? "snaptrade_portfolio"
      : history?.terminalPointSource ?? current?.terminalPointSource ?? null,
    liveTerminalIncluded: Boolean(lastIsCurrent || current?.liveTerminalIncluded),
    selectedSnapshotSource: lastIsCurrent
      ? "SNAPTRADE_PORTFOLIO"
      : history?.selectedSnapshotSource ?? current?.selectedSnapshotSource ?? null,
    points,
    events: Array.isArray(history?.events) ? history.events : [],
    updatedAt: toIso(
      history?.updatedAt || current?.updatedAt || updatedAt,
      fallbackTimestamp,
    ),
  };
};

const buildSnapTradePositionsAtDate = ({
  accountId,
  currency,
  positions,
  netLiquidation,
  cash,
  buyingPower,
  positionMarketValue,
  unrealizedPnl,
  updatedAt,
}) => ({
  accountId,
  currency,
  date: toIso(updatedAt).slice(0, 10),
  status: "available",
  positions,
  activity: [],
  totals: {
    count: positions.length,
    marketValue: positionMarketValue,
    unrealizedPnl,
    netLiquidation,
    cash,
    balance: {
      netLiquidation,
      dayPnl: null,
      cash,
      buyingPower,
    },
  },
  updatedAt,
});

export function buildSnapTradeAccountPanelData({
  account,
  portfolio,
  recentOrders,
  history,
  orderTab = "working",
  range = "ALL",
  now = new Date(),
} = {}) {
  const accountId = account?.id || portfolio?.account?.id || "";
  const updatedAt = toIso(
    portfolio?.dataFreshness?.asOf || portfolio?.syncedAt || recentOrders?.checkedAt,
    now,
  );
  const currency =
    portfolio?.account?.baseCurrency ||
    account?.currency ||
    portfolio?.balances?.[0]?.currency ||
    "USD";
  const cash =
    finiteNumber(portfolio?.totals?.cash) ??
    sumNullable((portfolio?.balances || []).map((balance) => balance.cash));
  const buyingPower =
    finiteNumber(portfolio?.totals?.buyingPower) ??
    sumNullable((portfolio?.balances || []).map((balance) => balance.buyingPower));
  const rawPositionMarketValue =
    sumNullable(
      (portfolio?.positions || []).map((position) =>
        marketValueForSnapTradePosition(position, normalizeOptionContract(position)),
      ),
    ) ??
    finiteNumber(portfolio?.totals?.positionMarketValue);
  const positionMarketValue = rawPositionMarketValue ?? 0;
  const netLiquidation =
    cash != null || rawPositionMarketValue != null
      ? (cash ?? 0) + (rawPositionMarketValue ?? 0)
      : finiteNumber(portfolio?.totals?.netLiquidation);
  const positions = buildSnapTradePositionRows({
    accountId,
    positions: portfolio?.positions || [],
    netLiquidation,
  });
  const unrealizedPnl =
    sumNullable(positions.map((position) => position.unrealizedPnl)) ??
    finiteNumber(portfolio?.totals?.unrealizedPnl);

  const assetBuckets = new Map();
  positions.forEach((position) => {
    assetBuckets.set(
      position.assetClass,
      (assetBuckets.get(position.assetClass) || 0) + position.marketValue,
    );
  });
  if (cash != null) {
    assetBuckets.set("Cash", (assetBuckets.get("Cash") || 0) + cash);
  }
  const sectorBuckets = new Map();
  positions.forEach((position) => {
    sectorBuckets.set(
      position.sector,
      (sectorBuckets.get(position.sector) || 0) + position.marketValue,
    );
  });

  const exposure = positions.reduce(
    (totals, position) => {
      if (position.marketValue >= 0) {
        totals.grossLong += position.marketValue;
      } else {
        totals.grossShort += Math.abs(position.marketValue);
      }
      totals.netExposure += position.marketValue;
      return totals;
    },
    { grossLong: 0, grossShort: 0, netExposure: 0 },
  );

  const currentEquityHistory = buildSnapTradeEquityHistory({
    accountId,
    range,
    currency,
    netLiquidation,
    updatedAt,
  });
  const equityHistory = mergeSnapTradeEquityHistory({
    history: history?.equityHistory,
    current: currentEquityHistory,
    currency,
    updatedAt,
  });
  const closedTrades =
    history?.closedTrades && Array.isArray(history.closedTrades.trades)
      ? history.closedTrades
      : {
          accountId,
          currency,
          trades: [],
          summary: {
            count: 0,
            realizedPnl: 0,
            commissions: 0,
          },
          updatedAt,
        };

  return {
    summary: {
      accountId,
      isCombined: accountId === COMBINED_ACCOUNT_ID,
      mode: "live",
      currency,
      accounts: [
        {
          id: accountId,
          displayName:
            portfolio?.account?.displayName ||
            account?.displayName ||
            "SnapTrade account",
          currency,
          live: true,
          accountType: account?.accountType || null,
          updatedAt,
        },
      ],
      updatedAt,
      fx: {
        baseCurrency: currency,
        timestamp: updatedAt,
        rates: { [currency]: 1 },
        warning: null,
      },
      badges: {
        accountTypes: account?.accountType ? [account.accountType] : [],
        provider: "snaptrade",
      },
      metrics: {
        netLiquidation: metric({
          value: netLiquidation,
          currency,
          field: "SnapTradePortfolio.netLiquidation",
          updatedAt,
        }),
        totalCash: metric({
          value: cash,
          currency,
          field: "SnapTradePortfolio.cash",
          updatedAt,
        }),
        buyingPower: metric({
          value: buyingPower,
          currency,
          field: "SnapTradePortfolio.buyingPower",
          updatedAt,
        }),
        settledCash: metric({
          value: cash,
          currency,
          field: "SnapTradePortfolio.cash",
          updatedAt,
        }),
        grossPositionValue: metric({
          value: positionMarketValue,
          currency,
          field: "SnapTradePortfolio.positionMarketValue",
          updatedAt,
        }),
        unrealizedPnl: metric({
          value: unrealizedPnl,
          currency,
          field: "SnapTradePortfolio.unrealizedPnl",
          updatedAt,
        }),
      },
    },
    allocation: {
      accountId,
      currency,
      assetClass: bucketRows(assetBuckets, netLiquidation, "SNAPTRADE_PORTFOLIO"),
      sector: bucketRows(sectorBuckets, netLiquidation, "SNAPTRADE_PORTFOLIO"),
      exposure,
      updatedAt,
    },
    positions: {
      accountId,
      currency,
      positions,
      totals: {
        count: positions.length,
        marketValue: positionMarketValue,
        unrealizedPnl,
        netLiquidation,
        cash,
      },
      updatedAt,
    },
    orders: {
      accountId,
      tab: orderTab,
      currency,
      orders: buildSnapTradeOrderRows({
        accountId,
        orders: recentOrders?.orders || [],
        tab: orderTab,
        checkedAt: recentOrders?.checkedAt || updatedAt,
      }),
      updatedAt: toIso(recentOrders?.checkedAt || updatedAt, now),
    },
    cash: {
      accountId,
      currency,
      settledCash: cash,
      unsettledCash: null,
      totalCash: cash,
      dividendsMonth: null,
      dividendsYtd: null,
      interestPaidEarnedYtd: null,
      feesYtd: null,
      activities: [],
      updatedAt,
    },
    equityHistory,
    positionsAtDate: buildSnapTradePositionsAtDate({
      accountId,
      currency,
      positions,
      netLiquidation,
      cash,
      buyingPower,
      positionMarketValue,
      unrealizedPnl,
      updatedAt,
    }),
    closedTrades,
    risk: null,
  };
}

export const buildIdleAccountQuery = (data = undefined) => ({
  data,
  error: null,
  isLoading: false,
  isFetching: false,
  isPending: false,
  fetchStatus: "idle",
  refetch: () => Promise.resolve({ data }),
});

export const buildProviderAccountQuery = (query, data) => ({
  ...buildIdleAccountQuery(data),
  ...(query || {}),
  data,
  error: query?.error ?? null,
  isLoading: Boolean(
    !data &&
      (query?.isLoading ||
        query?.isFetching ||
        (query?.isPending && query?.fetchStatus !== "idle")),
  ),
  isFetching: Boolean(query?.isFetching),
  isPending: Boolean(query?.isPending),
  fetchStatus: query?.fetchStatus || "idle",
  refetch: query?.refetch || (() => Promise.resolve({ data })),
});
