const WORKING_ORDER_STATUSES = new Set([
  "pending_submit",
  "submitted",
  "accepted",
  "partially_filled",
]);

const EMPTY_COVERAGE = {
  underlying: "",
  sharesPerContract: 100,
  matchingLongCallContracts: 0,
  pendingMatchingSellCallContracts: 0,
  availableMatchingLongCallContracts: 0,
  longUnderlyingShares: 0,
  existingShortCallContracts: 0,
  pendingSellCallContracts: 0,
  pendingShortOpeningSellCallContracts: 0,
  pendingUnderlyingSellShares: 0,
  reservedShares: 0,
  coveredCallCapacity: 0,
};

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();

const normalizeAssetClass = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "options") return "option";
  if (normalized === "stocks" || normalized === "stock" || normalized === "shares") {
    return "equity";
  }
  return normalized;
};

const normalizeRight = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "c") return "call";
  if (normalized === "p") return "put";
  return normalized;
};

const dateKey = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
};

const sharesPerContract = (contract) => {
  const shares = toFiniteNumber(contract?.sharesPerContract, NaN);
  if (Number.isFinite(shares) && shares > 0) return shares;
  const multiplier = toFiniteNumber(contract?.multiplier, NaN);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 100;
};

const optionTupleKey = (contract) =>
  [
    normalizeSymbol(contract?.underlying || contract?.ticker),
    dateKey(contract?.expirationDate || contract?.exp),
    String(toFiniteNumber(contract?.strike ?? contract?.k)),
    normalizeRight(contract?.right || contract?.cp),
  ].join(":");

const optionContractsMatch = (left, right) => {
  const leftProvider = String(left?.providerContractId || "");
  const rightProvider = String(right?.providerContractId || "");
  if (leftProvider && rightProvider) {
    return leftProvider === rightProvider;
  }
  return optionTupleKey(left) === optionTupleKey(right);
};

const remainingOrderQuantity = (order) =>
  Math.max(
    0,
    toFiniteNumber(order?.quantity) - toFiniteNumber(order?.filledQuantity),
  );

const isWorkingSellCallForUnderlying = (order, underlying) =>
  WORKING_ORDER_STATUSES.has(String(order?.status || "").toLowerCase()) &&
  String(order?.side || "").toLowerCase() === "sell" &&
  normalizeAssetClass(order?.assetClass) === "option" &&
  normalizeRight(order?.optionContract?.right) === "call" &&
  normalizeSymbol(order?.optionContract?.underlying) === underlying;

const isWorkingSellEquityForUnderlying = (order, underlying) =>
  WORKING_ORDER_STATUSES.has(String(order?.status || "").toLowerCase()) &&
  String(order?.side || "").toLowerCase() === "sell" &&
  normalizeAssetClass(order?.assetClass) === "equity" &&
  !order?.optionContract &&
  normalizeSymbol(order?.symbol) === underlying;

export function buildSellCallTicketCoverage({
  selectedContract,
  symbol,
  positions = [],
  orders = [],
} = {}) {
  const contract = selectedContract || {};
  const underlying = normalizeSymbol(contract.underlying || symbol);
  const contractShares = sharesPerContract(contract);
  const selectedContractKey = optionTupleKey(contract);
  const matchingLongCallContracts = positions
    .filter(
      (position) =>
        normalizeAssetClass(position?.assetClass) === "option" &&
        normalizeRight(position?.optionContract?.right) === "call" &&
        toFiniteNumber(position?.quantity) > 0 &&
        optionContractsMatch(position.optionContract, contract),
    )
    .reduce((sum, position) => sum + toFiniteNumber(position.quantity), 0);
  const longCallContractsByKey = new Map();
  positions.forEach((position) => {
    if (
      normalizeAssetClass(position?.assetClass) === "option" &&
      normalizeRight(position?.optionContract?.right) === "call" &&
      normalizeSymbol(position?.optionContract?.underlying) === underlying &&
      toFiniteNumber(position?.quantity) > 0
    ) {
      const key = optionTupleKey(position.optionContract);
      longCallContractsByKey.set(
        key,
        (longCallContractsByKey.get(key) || 0) + toFiniteNumber(position.quantity),
      );
    }
  });
  const longUnderlyingShares = positions
    .filter(
      (position) =>
        normalizeAssetClass(position?.assetClass) === "equity" &&
        !position?.optionContract &&
        normalizeSymbol(position?.symbol) === underlying,
    )
    .reduce(
      (sum, position) => sum + Math.max(0, toFiniteNumber(position.quantity)),
      0,
    );
  const existingShortCallContracts = positions
    .filter(
      (position) =>
        normalizeAssetClass(position?.assetClass) === "option" &&
        normalizeRight(position?.optionContract?.right) === "call" &&
        normalizeSymbol(position?.optionContract?.underlying) === underlying &&
        toFiniteNumber(position?.quantity) < 0,
    )
    .reduce((sum, position) => sum + Math.abs(toFiniteNumber(position.quantity)), 0);
  const pendingSellCallContractsByKey = new Map();
  orders.forEach((order) => {
    if (isWorkingSellCallForUnderlying(order, underlying) && order?.optionContract) {
      const key = optionTupleKey(order.optionContract);
      pendingSellCallContractsByKey.set(
        key,
        (pendingSellCallContractsByKey.get(key) || 0) +
          remainingOrderQuantity(order),
      );
    }
  });
  const pendingSellCallContracts = Array.from(
    pendingSellCallContractsByKey.values(),
  ).reduce((sum, quantity) => sum + quantity, 0);
  const pendingMatchingSellCallContracts =
    pendingSellCallContractsByKey.get(selectedContractKey) || 0;
  const availableMatchingLongCallContracts = Math.max(
    0,
    matchingLongCallContracts - pendingMatchingSellCallContracts,
  );
  const pendingShortOpeningSellCallContracts = Array.from(
    pendingSellCallContractsByKey.entries(),
  ).reduce((sum, [key, pendingQuantity]) => {
    const longQuantity = longCallContractsByKey.get(key) || 0;
    return sum + Math.max(0, pendingQuantity - longQuantity);
  }, 0);
  const pendingUnderlyingSellShares = orders
    .filter((order) => isWorkingSellEquityForUnderlying(order, underlying))
    .reduce((sum, order) => sum + remainingOrderQuantity(order), 0);
  const reservedShares =
    (existingShortCallContracts + pendingShortOpeningSellCallContracts) *
      contractShares +
    pendingUnderlyingSellShares;
  const coveredCallCapacity = Math.max(
    0,
    Math.floor((longUnderlyingShares - reservedShares) / contractShares),
  );

  return {
    underlying,
    sharesPerContract: contractShares,
    matchingLongCallContracts,
    pendingMatchingSellCallContracts,
    availableMatchingLongCallContracts,
    longUnderlyingShares,
    existingShortCallContracts,
    pendingSellCallContracts,
    pendingShortOpeningSellCallContracts,
    pendingUnderlyingSellShares,
    reservedShares,
    coveredCallCapacity,
  };
}

const allowedIntent = ({
  actionLabel,
  intentLabel,
  positionEffect,
  strategyIntent,
  coverage,
}) => ({
  applies: true,
  allowed: true,
  contextPending: false,
  actionLabel,
  intentLabel,
  positionEffect,
  strategyIntent,
  blockedReason: "",
  coverage,
});

const blockedIntent = ({
  actionLabel,
  intentLabel,
  positionEffect = "open",
  strategyIntent = "uncovered_short_call",
  blockedReason,
  contextPending = false,
  coverage,
}) => ({
  applies: true,
  allowed: false,
  contextPending,
  actionLabel,
  intentLabel,
  positionEffect,
  strategyIntent,
  blockedReason,
  coverage,
});

export function resolveSellCallTicketIntent({
  side,
  assetMode,
  selectedContract,
  symbol,
  quantity,
  positions = [],
  orders = [],
  executionMode = "real",
  brokerPositionContextReady = false,
  brokerOrderContextReady = false,
  shadowPositionContextReady = true,
  shadowMatchingQuantity = 0,
} = {}) {
  const sideLabel = String(side || "BUY").toUpperCase();
  const isOptionTicket =
    normalizeAssetClass(assetMode) === "option" || Boolean(selectedContract);
  const isCall = normalizeRight(selectedContract?.right || selectedContract?.cp) === "call";
  const isSellCall = isOptionTicket && sideLabel === "SELL" && isCall;

  if (!isSellCall) {
    return {
      applies: false,
      allowed: true,
      contextPending: false,
      actionLabel: isOptionTicket && sideLabel === "BUY" ? "BUY TO OPEN" : sideLabel,
      intentLabel: isOptionTicket && sideLabel === "BUY" ? "LONG OPTION" : "",
      positionEffect: undefined,
      strategyIntent: undefined,
      blockedReason: "",
      coverage: EMPTY_COVERAGE,
    };
  }

  const requestedQuantity = Math.max(0, toFiniteNumber(quantity));
  const coverage = buildSellCallTicketCoverage({
    selectedContract,
    symbol,
    positions,
    orders,
  });

  if (requestedQuantity <= 0) {
    return allowedIntent({
      actionLabel: "SELL CALL",
      intentLabel: "CALL SALE",
      coverage,
    });
  }

  if (executionMode === "shadow") {
    if (!shadowPositionContextReady) {
      return blockedIntent({
        actionLabel: "SELL CALL CHECKING",
        intentLabel: "CHECKING SHADOW POSITION",
        positionEffect: "close",
        strategyIntent: "sell_to_close",
        blockedReason: "Shadow option exposure is still loading.",
        contextPending: true,
        coverage,
      });
    }
    if (toFiniteNumber(shadowMatchingQuantity) >= requestedQuantity) {
      return allowedIntent({
        actionLabel: "SELL TO CLOSE",
        intentLabel: "SELL TO CLOSE",
        positionEffect: "close",
        strategyIntent: "sell_to_close",
        coverage: {
          ...coverage,
          matchingLongCallContracts: toFiniteNumber(shadowMatchingQuantity),
          availableMatchingLongCallContracts: toFiniteNumber(shadowMatchingQuantity),
        },
      });
    }
    return blockedIntent({
      actionLabel: "SELL CALL BLOCKED",
      intentLabel: "SHORT CALL DISABLED",
      blockedReason:
        "Shadow only supports selling existing long option contracts right now.",
      coverage,
    });
  }

  if (!brokerPositionContextReady) {
    return blockedIntent({
      actionLabel: "SELL CALL CHECKING",
      intentLabel: "CHECKING POSITIONS",
      positionEffect: "close",
      strategyIntent: "sell_to_close",
      blockedReason: "IBKR positions are still loading.",
      contextPending: true,
      coverage,
    });
  }

  if (!brokerOrderContextReady) {
    return blockedIntent({
      actionLabel: "SELL CALL CHECKING",
      intentLabel: "CHECKING OPEN ORDERS",
      positionEffect: "open",
      strategyIntent: "covered_call",
      blockedReason: "IBKR open orders are still loading.",
      contextPending: true,
      coverage,
    });
  }

  if (coverage.availableMatchingLongCallContracts >= requestedQuantity) {
    return allowedIntent({
      actionLabel: "SELL TO CLOSE",
      intentLabel: "SELL TO CLOSE",
      positionEffect: "close",
      strategyIntent: "sell_to_close",
      coverage,
    });
  }

  if (coverage.coveredCallCapacity >= requestedQuantity) {
    return allowedIntent({
      actionLabel: "SELL COVERED CALL",
      intentLabel: "COVERED CALL",
      positionEffect: "open",
      strategyIntent: "covered_call",
      coverage,
    });
  }

  return blockedIntent({
    actionLabel: "SELL CALL BLOCKED",
    intentLabel: "UNCOVERED CALL DISABLED",
    blockedReason:
      "Selling this call would open an uncovered short call. Hold enough shares or sell an existing long call.",
    coverage,
  });
}
