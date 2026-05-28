const FINAL_ORDER_STATUSES = new Set(["filled", "canceled", "rejected", "expired"]);

export const TRADE_MANAGEMENT_STATUS = {
  protected: "Protected",
  breached: "Breached",
  targetOnly: "Target only",
  unprotected: "Unprotected",
  unknown: "Unknown",
};

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric != null) return numeric;
  }
  return null;
};

const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

const normalizeSymbol = (value) => String(value ?? "").trim().toUpperCase();

const normalizedRight = (value) => {
  const text = normalizeText(value);
  if (text === "c") return "call";
  if (text === "p") return "put";
  return text;
};

export const sameManagementOptionContract = (left, right) => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  const leftProvider = firstText(left.providerContractId, left.conid);
  const rightProvider = firstText(right.providerContractId, right.conid);
  if (leftProvider && rightProvider) {
    return leftProvider === rightProvider;
  }
  return (
    normalizeSymbol(left.underlying ?? left.ticker) ===
      normalizeSymbol(right.underlying ?? right.ticker) &&
    String(left.expirationDate ?? left.exp ?? "").slice(0, 10) ===
      String(right.expirationDate ?? right.exp ?? "").slice(0, 10) &&
    finiteNumber(left.strike) === finiteNumber(right.strike) &&
    normalizedRight(left.right ?? left.cp) === normalizedRight(right.right ?? right.cp)
  );
};

export const orderMatchesManagementPosition = (position, order) => {
  if (!order) return false;
  const positionSymbol = normalizeSymbol(
    position?.optionContract?.underlying ?? position?.ticker ?? position?.symbol,
  );
  const orderSymbol = normalizeSymbol(
    order?.optionContract?.underlying ?? order?.symbol ?? order?.ticker,
  );
  if (positionSymbol && orderSymbol && positionSymbol !== orderSymbol) {
    return false;
  }
  if (position?.optionContract || order?.optionContract) {
    return sameManagementOptionContract(position?.optionContract, order?.optionContract);
  }
  return true;
};

const isWorkingOrder = (order) => !FINAL_ORDER_STATUSES.has(normalizeText(order?.status));

const positionIsShort = (row, options = {}) => {
  const side = normalizeText(options.side ?? row?.side);
  if (side === "short") return true;
  if (side === "long") return false;
  const quantity = finiteNumber(options.quantity ?? row?.quantity ?? row?.qty);
  return quantity != null ? quantity < 0 : false;
};

const positionExitSide = (row, options = {}) =>
  positionIsShort(row, options) ? "buy" : "sell";

const sortNearestToMark = (levels, mark) => {
  if (mark == null) return levels;
  return [...levels].sort(
    (left, right) => Math.abs(left.price - mark) - Math.abs(right.price - mark),
  );
};

const closeSideOrders = (row, options = {}) => {
  const exitSide = positionExitSide(row, options);
  return (options.openOrders ?? row?.openOrders ?? [])
    .filter(isWorkingOrder)
    .filter((order) => normalizeText(order.side) === exitSide)
    .filter((order) => orderMatchesManagementPosition(row, order));
};

const brokerLevel = ({ row, options, kind, mark }) => {
  const orders = closeSideOrders(row, options);
  const levels = orders
    .flatMap((order) => {
      if (kind === "stop" && ["stop", "stop_limit"].includes(normalizeText(order.type))) {
        const price = finiteNumber(order.stopPrice);
        return price == null ? [] : [{ price, source: "broker", order }];
      }
      if (kind === "target" && normalizeText(order.type) === "limit") {
        const price = finiteNumber(order.limitPrice);
        return price == null ? [] : [{ price, source: "broker", order }];
      }
      return [];
    });
  return sortNearestToMark(levels, mark)[0] ?? null;
};

const managementTradeState = (automation = {}) =>
  automation.tradeManagement || automation.management || automation.stop || {};

const automationStopLevel = (automation = {}) => {
  const state = managementTradeState(automation);
  const price = firstFiniteNumber(state.stopPrice, automation.stopPrice);
  return price == null
    ? null
    : {
        price,
        source: "automation",
        detail: state,
      };
};

const automationTrailLevel = (automation = {}) => {
  const state = managementTradeState(automation);
  const active =
    state.trailActive === true ||
    firstFiniteNumber(state.trailStopPrice) != null ||
    (firstFiniteNumber(automation.entryPrice) != null &&
      firstFiniteNumber(automation.stopPrice) != null &&
      firstFiniteNumber(automation.stopPrice) > firstFiniteNumber(automation.entryPrice));
  if (!active) return null;
  const price = firstFiniteNumber(state.trailStopPrice, automation.stopPrice);
  return price == null
    ? null
    : {
        price,
        source: "automation",
        detail: state,
      };
};

const localLevel = (price, source) => {
  const numeric = finiteNumber(price);
  return numeric == null ? null : { price: numeric, source };
};

const distancePctFromStop = ({ mark, stopPrice, short }) => {
  if (mark == null || stopPrice == null || mark === 0) return null;
  return short
    ? ((stopPrice - mark) / Math.abs(mark)) * 100
    : ((mark - stopPrice) / Math.abs(mark)) * 100;
};

const riskAmountFromStop = ({ mark, stopPrice, quantity, multiplier }) => {
  if (mark == null || stopPrice == null || quantity == null) return null;
  return Math.abs(mark - stopPrice) * Math.abs(quantity) * (multiplier ?? 1);
};

export const buildPositionTradeManagement = (row = {}, options = {}) => {
  const automation = options.automationContext ?? row?.automationContext ?? {};
  const mark = firstFiniteNumber(
    options.mark,
    row?.mark,
    row?.marketPrice,
    row?.quote?.mark,
    row?.optionQuote?.mark,
  );
  const quantity = firstFiniteNumber(options.quantity, row?.quantity, row?.qty);
  const multiplier =
    firstFiniteNumber(
      options.multiplier,
      row?.optionContract?.multiplier,
      row?.optionContract?.sharesPerContract,
    ) ?? 1;
  const short = positionIsShort(row, options);
  const brokerStop = brokerLevel({ row, options, kind: "stop", mark });
  const brokerTarget = brokerLevel({ row, options, kind: "target", mark });
  const stop =
    brokerStop ??
    automationStopLevel(automation) ??
    localLevel(options.localStopLoss ?? row?.stopLoss ?? row?.sl, "local");
  const trail = automationTrailLevel(automation);
  const target =
    brokerTarget ??
    localLevel(options.localTakeProfit ?? row?.takeProfit ?? row?.tp, "local");
  const riskDistancePct = distancePctFromStop({
    mark,
    stopPrice: stop?.price,
    short,
  });
  const riskAmount = riskAmountFromStop({
    mark,
    stopPrice: stop?.price,
    quantity,
    multiplier,
  });
  const status = stop
    ? riskDistancePct != null && riskDistancePct <= 0
      ? "breached"
      : "protected"
    : target
      ? "targetOnly"
      : "unprotected";

  return {
    stop,
    trail,
    target,
    riskDistancePct,
    riskAmount,
    status,
    statusLabel: TRADE_MANAGEMENT_STATUS[status] ?? TRADE_MANAGEMENT_STATUS.unknown,
    source: stop?.source ?? target?.source ?? trail?.source ?? null,
    sortValues: {
      stop: stop?.price ?? null,
      trail: trail?.price ?? null,
      target: target?.price ?? null,
      riskDistance: riskDistancePct,
      riskAmount,
    },
  };
};
