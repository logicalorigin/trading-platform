import { normalizeAccountCurrency } from "./accountCurrency.js";

const COMBINED_ACCOUNT_ID = "combined";
const SHADOW_ACCOUNT_ID = "shadow";

const finiteNumber = (value) => {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveNumber = (value) => {
  const numeric = finiteNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
};

const sumComplete = (values) => {
  const finiteValues = values.map(finiteNumber);
  return finiteValues.every((value) => value != null)
    ? finiteValues.reduce((sum, value) => sum + value, 0)
    : null;
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

const normalizeCurrency = normalizeAccountCurrency;

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
  return {
    ticker: `${underlying}${yymmdd}${rightCode.toUpperCase()}${rawStrike}`,
    underlying,
    expirationDate: expirationDate.toISOString().slice(0, 10),
    strike,
    right: rightCode.toUpperCase() === "P" ? "put" : "call",
    multiplier: null,
    sharesPerContract: null,
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
      const hasDeclaredEconomics =
        contract.multiplier != null || contract.sharesPerContract != null;
      const multiplier =
        positiveNumber(contract.multiplier) ??
        positiveNumber(contract.sharesPerContract) ??
        (!hasDeclaredEconomics && contract.standardDeliverableVerified === true
          ? 100
          : null);
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
          positiveNumber(contract.sharesPerContract) ?? multiplier,
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
  const quantity = finiteNumber(position?.quantity);
  if (quantity == null) return null;
  return position?.side === "short" ? -Math.abs(quantity) : quantity;
};

const optionMultiplierForSnapTradePosition = (position, optionContract) =>
  position?.assetClass === "option"
    ? optionContract
      ? positiveNumber(optionContract.multiplier) ??
        positiveNumber(optionContract.sharesPerContract)
      : null
    : 1;

const averageCostForSnapTradePosition = (position, optionContract = null) => {
  const explicit = finiteNumber(position?.averagePurchasePrice);
  const signed = signedQuantity(position);
  const quantity = signed == null ? null : Math.abs(signed);
  const multiplier = optionMultiplierForSnapTradePosition(
    position,
    optionContract,
  );
  if (position?.assetClass === "option" && multiplier == null) {
    return null;
  }
  if (explicit != null) return explicit;
  const costBasis = finiteNumber(position?.costBasis);
  if (
    costBasis != null &&
    quantity != null &&
    quantity > 0 &&
    multiplier != null
  ) {
    return roundFinancialNumber(costBasis / quantity / multiplier);
  }
  return null;
};

const marketValueForSnapTradePosition = (position, optionContract = null) => {
  const explicit = finiteNumber(position?.marketValue);
  if (explicit != null) return explicit;
  const quantity = signedQuantity(position);
  const price = finiteNumber(position?.price);
  const multiplier = optionMultiplierForSnapTradePosition(
    position,
    optionContract,
  );
  if (quantity != null && price != null && multiplier != null) {
    return roundFinancialNumber(
      quantity * price * multiplier,
    );
  }
  return null;
};

const unrealizedPnlForSnapTradePosition = (position, optionContract = null) => {
  const explicit = finiteNumber(position?.unrealizedPnl);
  if (explicit != null) return explicit;
  const quantity = signedQuantity(position);
  const averageCost = averageCostForSnapTradePosition(position, optionContract);
  const multiplier = optionMultiplierForSnapTradePosition(
    position,
    optionContract,
  );
  const marketValue = marketValueForSnapTradePosition(position, optionContract);
  if (
    averageCost != null &&
    quantity != null &&
    quantity !== 0 &&
    marketValue != null &&
    multiplier != null
  ) {
    const costBasis = averageCost * quantity * multiplier;
    return roundFinancialNumber(marketValue - costBasis);
  }
  return null;
};

const buildSnapTradePositionRows = ({
  accountId,
  baseCurrency,
  positions = [],
  netLiquidation,
}) =>
  positions.map((position) => {
    const optionContract = normalizeOptionContract(position);
    const currency = normalizeCurrency(position.currency);
    const hasComparableCurrency =
      currency && currency === normalizeCurrency(baseCurrency);
    const displaySymbol =
      optionContract?.underlying ??
      normalizeText(position.symbol, position.rawSymbol || "UNKNOWN");
    const quantity = signedQuantity(position);
    const averageCost = hasComparableCurrency
      ? averageCostForSnapTradePosition(position, optionContract)
      : null;
    const marketValue = hasComparableCurrency
      ? marketValueForSnapTradePosition(position, optionContract)
      : null;
    const unrealizedPnl = hasComparableCurrency
      ? unrealizedPnlForSnapTradePosition(position, optionContract)
      : null;
    const reportedCostBasis = finiteNumber(position?.costBasis);
    const costBasis = hasComparableCurrency
      ? reportedCostBasis ??
        (averageCost != null &&
        quantity != null &&
        quantity !== 0 &&
        optionMultiplierForSnapTradePosition(position, optionContract) != null
        ? averageCost *
          quantity *
          optionMultiplierForSnapTradePosition(position, optionContract)
        : null)
      : null;
    const unrealizedPnlPercent =
      unrealizedPnl != null && costBasis
        ? (unrealizedPnl / Math.abs(costBasis)) * 100
        : null;
    const weightPercent =
      marketValue != null && netLiquidation && netLiquidation !== 0
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
      currency: currency || null,
      positionType: positionTypeForSnapTrade(position),
      optionContract,
      marketDataSymbol:
        optionContract?.underlying ??
        normalizeText(position.symbol, position.rawSymbol || ""),
      sector: "Unknown",
      quantity,
      averageCost,
      mark: hasComparableCurrency ? finiteNumber(position.price) : null,
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
  const normalized = normalizeText(status).toLowerCase().replace(/[\s-]+/g, "_");
  if (["filled", "executed", "complete", "completed"].includes(normalized)) {
    return "filled";
  }
  if (["canceled", "cancelled"].includes(normalized)) return "canceled";
  if (["rejected", "failed"].includes(normalized)) return "rejected";
  if (normalized === "expired") return "expired";
  if (normalized === "pending_cancel") return "pending_cancel";
  if (["partially_filled", "partial_filled"].includes(normalized)) {
    return "partially_filled";
  }
  if (normalized === "submitted") return "submitted";
  if (["pending_submit", "pending", "queued"].includes(normalized)) {
    return "pending_submit";
  }
  if (["accepted", "open", "working"].includes(normalized)) return "accepted";
  return "unknown";
};

const normalizeSnapTradeOrderType = (type) => {
  const normalized = normalizeText(type).toLowerCase().replace(/[\s-]+/g, "_");
  if (["stop_limit", "stoplimit"].includes(normalized)) return "stop_limit";
  if (["stop", "stop_market"].includes(normalized)) return "stop";
  if (normalized === "limit") return "limit";
  if (normalized === "market") return "market";
  return "unknown";
};

const normalizeSnapTradeTimeInForce = (value) => {
  const normalized = normalizeText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["gtc", "good_till_canceled", "good_til_canceled"].includes(normalized)) {
    return "gtc";
  }
  if (["ioc", "immediate_or_cancel"].includes(normalized)) return "ioc";
  if (["fok", "fill_or_kill"].includes(normalized)) return "fok";
  if (["day", "day_only"].includes(normalized)) return "day";
  return "unknown";
};

const normalizeSnapTradeOrderSide = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.includes("sell")) return "sell";
  if (normalized.includes("buy")) return "buy";
  return "unknown";
};

const optionalIso = (value) => {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const isTerminalOrderStatus = (status) =>
  ["filled", "canceled", "rejected", "expired"].includes(status);

const buildSnapTradeOrderRows = ({ accountId, orders = [], tab }) =>
  orders
    .map((order, index) => {
      const status = normalizeSnapTradeOrderStatus(order.status);
      const placedAt = optionalIso(order.timePlaced);
      const updatedAt = optionalIso(order.timeUpdated || order.timePlaced);
      const reportedQuantity = finiteNumber(order.totalQuantity);
      const openQuantity = finiteNumber(order.openQuantity);
      const filledQuantity = finiteNumber(order.filledQuantity);
      return {
        id:
          order.brokerageOrderId ||
          order.brokerageGroupOrderId ||
          `snaptrade:${order.symbol || order.rawSymbol || "unknown"}:${index}`,
        brokerOrderId: order.brokerageOrderId || null,
        accountId,
        symbol: normalizeText(
          order.symbol,
          order.rawSymbol || order.optionTicker || "UNKNOWN",
        ),
        side: normalizeSnapTradeOrderSide(order.action),
        type: normalizeSnapTradeOrderType(order.orderType),
        assetClass: order.optionSymbolId || order.optionTicker ? "option" : "equity",
        quantity:
          reportedQuantity ??
          (openQuantity != null && filledQuantity != null
            ? openQuantity + filledQuantity
            : null),
        filledQuantity,
        limitPrice: finiteNumber(order.limitPrice),
        stopPrice: finiteNumber(order.stopPrice),
        timeInForce: normalizeSnapTradeTimeInForce(order.timeInForce),
        status,
        placedAt,
        filledAt: optionalIso(order.timeExecuted),
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
      order.status === "unknown" ||
      (tab === "history"
        ? isTerminalOrderStatus(order.status)
        : !isTerminalOrderStatus(order.status)),
    );

const buildSnapTradePositionsAtDate = ({
  accountId,
  currency,
  positions,
  positionPopulationKnown,
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
  status: positionPopulationKnown ? "available" : "unavailable",
  positions: positionPopulationKnown ? positions : null,
  activity: null,
  totals: {
    count: positionPopulationKnown ? positions.length : null,
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
  orderTab = "working",
  now = new Date(),
} = {}) {
  const accountId = account?.id || portfolio?.account?.id || "";
  const updatedAt = toIso(
    portfolio?.dataFreshness?.asOf || portfolio?.syncedAt || recentOrders?.checkedAt,
    now,
  );
  const currency = [
    portfolio?.account?.baseCurrency,
    account?.currency,
    portfolio?.balances?.[0]?.currency,
  ]
    .map(normalizeCurrency)
    .find((value) => value != null) ?? null;
  const normalizedCurrency = currency;
  const balanceRows = Array.isArray(portfolio?.balances)
    ? portfolio.balances
    : [];
  const positionRows = Array.isArray(portfolio?.positions)
    ? portfolio.positions
    : [];
  const hasPositionPopulation = Array.isArray(portfolio?.positions);
  const balancesInBaseCurrency =
    normalizedCurrency != null &&
    balanceRows.every(
      (balance) => normalizeCurrency(balance.currency) === normalizedCurrency,
    );
  const positionsInBaseCurrency =
    normalizedCurrency != null &&
    positionRows.every(
      (position) => normalizeCurrency(position.currency) === normalizedCurrency,
    );
  const cash = balanceRows.length && balancesInBaseCurrency
    ? sumComplete(balanceRows.map((balance) => balance.cash))
    : balanceRows.length
      ? null
      : normalizedCurrency != null
        ? finiteNumber(portfolio?.totals?.cash)
        : null;
  const buyingPower = balanceRows.length && balancesInBaseCurrency
    ? sumComplete(balanceRows.map((balance) => balance.buyingPower))
    : balanceRows.length
      ? null
      : normalizedCurrency != null
        ? finiteNumber(portfolio?.totals?.buyingPower)
        : null;
  const rawPositionMarketValue = positionRows.length
    ? positionsInBaseCurrency
      ? sumComplete(
          positionRows.map((position) =>
            marketValueForSnapTradePosition(
              position,
              normalizeOptionContract(position),
            ),
          ),
        )
      : null
    : hasPositionPopulation
      ? 0
      : null;
  const positionMarketValue = rawPositionMarketValue;
  const netLiquidation =
    cash != null && rawPositionMarketValue != null
      ? cash + rawPositionMarketValue
      : normalizedCurrency != null && !balanceRows.length && !positionRows.length
        ? finiteNumber(portfolio?.totals?.netLiquidation)
        : null;
  const positions = buildSnapTradePositionRows({
    accountId,
    baseCurrency: normalizedCurrency,
    positions: positionRows,
    netLiquidation,
  });
  const unrealizedPnl = positionRows.length
    ? sumComplete(positions.map((position) => position.unrealizedPnl))
    : hasPositionPopulation
      ? 0
      : null;

  const assetBuckets = new Map();
  const sectorBuckets = new Map();
  const positionValuesComplete =
    hasPositionPopulation &&
    positions.every((position) => position.marketValue != null);
  const assetAllocationComplete = positionValuesComplete && cash != null;
  if (positionValuesComplete) {
    positions.forEach((position) => {
      sectorBuckets.set(
        position.sector,
        (sectorBuckets.get(position.sector) || 0) + position.marketValue,
      );
    });
  }
  if (assetAllocationComplete) {
    positions.forEach((position) => {
      assetBuckets.set(
        position.assetClass,
        (assetBuckets.get(position.assetClass) || 0) + position.marketValue,
      );
    });
    assetBuckets.set("Cash", (assetBuckets.get("Cash") || 0) + cash);
  }

  const exposure = positionValuesComplete
    ? positions.reduce(
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
      )
    : { grossLong: null, grossShort: null, netExposure: null };

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
        rates: currency ? { [currency]: 1 } : {},
        warning:
          !currency
            ? "Base currency is unavailable; monetary totals cannot be normalized."
            : balancesInBaseCurrency && positionsInBaseCurrency
            ? null
            : "Mixed-currency totals are unavailable without authoritative FX rates.",
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
      assetClass: assetAllocationComplete
        ? bucketRows(assetBuckets, netLiquidation, "SNAPTRADE_PORTFOLIO")
        : null,
      sector: positionValuesComplete
        ? bucketRows(sectorBuckets, netLiquidation, "SNAPTRADE_PORTFOLIO")
        : null,
      exposure,
      updatedAt,
    },
    positions: {
      accountId,
      currency,
      positions: hasPositionPopulation ? positions : null,
      totals: {
        count: hasPositionPopulation ? positions.length : null,
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
      orders: Array.isArray(recentOrders?.orders)
        ? buildSnapTradeOrderRows({
            accountId,
            orders: recentOrders.orders,
            tab: orderTab,
          })
        : null,
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
      activities: null,
      dividends: null,
      updatedAt,
    },
    positionsAtDate: buildSnapTradePositionsAtDate({
      accountId,
      currency,
      positions,
      positionPopulationKnown: hasPositionPopulation,
      netLiquidation,
      cash,
      buyingPower,
      positionMarketValue,
      unrealizedPnl,
      updatedAt,
    }),
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
