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

const isNativeRobinhoodOption = (value) =>
  normalizeText(value) === "robinhood_option";

export const sameManagementOptionContract = (left, right) => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  const leftProvider = firstText(left.providerContractId, left.conid);
  const rightProvider = firstText(right.providerContractId, right.conid);
  if (leftProvider || rightProvider) {
    return Boolean(leftProvider && rightProvider && leftProvider === rightProvider);
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
    const orderContract = order?.optionContract
      ? {
          ...order.optionContract,
          providerContractId: firstText(
            order.optionContract.providerContractId,
            order.providerContractId,
          ),
        }
      : null;
    if (
      isNativeRobinhoodOption(position?.providerSecurityType) &&
      (!firstText(position?.optionContract?.providerContractId) ||
        !firstText(orderContract?.providerContractId))
    ) {
      return false;
    }
    return sameManagementOptionContract(position?.optionContract, orderContract);
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

export const positionStopPeakMetrics = (row = {}) => {
  const automation = row?.automationContext || row?.riskOverlay || {};
  const state = managementTradeState(automation);
  const peakPrice = firstFiniteNumber(state.peakPrice, automation.peakPrice);
  const peakEvidenceSource = normalizeText(
    state.peakEvidenceSource ?? automation.peakEvidenceSource,
  ) || null;
  const entryPrice = firstFiniteNumber(
    state.entryPrice,
    automation.entryPrice,
    row?.averageCost,
    row?.averagePrice,
  );
  const comparisonPrice =
    peakEvidenceSource === "executable_bid"
      ? firstFiniteNumber(row?.optionQuote?.bid, row?.quote?.bid, row?.bid)
      : firstFiniteNumber(row?.mark, row?.marketPrice, row?.quote?.mark);
  const accruedProfit =
    peakPrice != null && entryPrice != null ? peakPrice - entryPrice : null;
  const retracePct =
    accruedProfit != null && accruedProfit > 0 && comparisonPrice != null
      ? Math.max(0, ((peakPrice - comparisonPrice) / accruedProfit) * 100)
      : null;
  return {
    peakPrice,
    peakEvidenceSource,
    peakLabel:
      peakEvidenceSource === "executable_bid" ? "Bid peak" : "Peak",
    comparisonPrice,
    retracePct,
    // Compatibility alias for callers not yet migrated to retracement language.
    givebackPct: retracePct,
  };
};

const automationTargetKind = (automation = {}) =>
  normalizeText(managementTradeState(automation).targetKind ?? automation.targetKind);

const automationTargetIsTrailActivation = (automation = {}) =>
  automationTargetKind(automation) === "trail_activation";

const automationTrailIsActive = (automation = {}) => {
  const state = managementTradeState(automation);
  return (
    state.trailActive === true ||
    firstFiniteNumber(state.trailStopPrice) != null ||
    (firstFiniteNumber(automation.entryPrice) != null &&
      firstFiniteNumber(automation.stopPrice) != null &&
      firstFiniteNumber(automation.stopPrice) > firstFiniteNumber(automation.entryPrice))
  );
};

const automationTrailHasTakenOver = (automation = {}) => {
  const state = managementTradeState(automation);
  const activeStopKind = normalizeText(state.activeStopKind ?? automation.activeStopKind);
  if (activeStopKind === "trailing_stop") return true;
  if (activeStopKind === "hard_stop") return false;
  if (state.trailHasTakenOver === true || automation.trailHasTakenOver === true) {
    return true;
  }
  if (!automationTrailIsActive(automation)) return false;
  const trailStopPrice = firstFiniteNumber(state.trailStopPrice, automation.stopPrice);
  const hardStopPrice = firstFiniteNumber(
    state.hardStopPrice,
    automation.stopLossPrice,
    state.stopLossPrice,
  );
  if (trailStopPrice == null) return false;
  return hardStopPrice == null || trailStopPrice > hardStopPrice;
};

const automationStopLevel = (automation = {}) => {
  const state = managementTradeState(automation);
  const trailActive = automationTrailIsActive(automation);
  const price = firstFiniteNumber(
    state.hardStopPrice,
    automation.stopLossPrice,
    state.stopLossPrice,
    trailActive ? null : state.stopPrice,
    trailActive ? null : automation.stopPrice,
    state.stopPrice,
    automation.stopPrice,
  );
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
  if (!automationTrailHasTakenOver(automation)) return null;
  const price = firstFiniteNumber(
    state.trailStopPrice,
    state.activeStopPrice,
    automation.activeStopPrice,
    automation.stopPrice,
  );
  return price == null
    ? null
    : {
        price,
        source: "automation",
        detail: state,
      };
};

const automationTargetLevel = (automation = {}) => {
  if (automationTargetIsTrailActivation(automation)) {
    return null;
  }
  const state = managementTradeState(automation);
  const price = firstFiniteNumber(
    state.takeProfitPrice,
    state.targetPrice,
    state.profitTargetPrice,
    automation.takeProfitPrice,
    automation.targetPrice,
    automation.profitTargetPrice,
  );
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

const projectedReturnPctAtLevel = ({ entry, levelPrice, short }) => {
  if (entry == null || levelPrice == null || entry === 0) return null;
  const priceChange = short ? entry - levelPrice : levelPrice - entry;
  return (priceChange / Math.abs(entry)) * 100;
};

const riskAmountFromStop = ({ mark, stopPrice, quantity, multiplier }) => {
  if (mark == null || stopPrice == null || quantity == null) return null;
  return Math.abs(mark - stopPrice) * Math.abs(quantity) * (multiplier ?? 1);
};

export const buildPositionTradeManagement = (row = {}, options = {}) => {
  const sourceAutomation = options.automationContext ?? row?.automationContext ?? {};
  const riskOverlay =
    row?.riskOverlay && typeof row.riskOverlay === "object" ? row.riskOverlay : null;
  const automation = riskOverlay
    ? {
        ...sourceAutomation,
        entryPrice: sourceAutomation.entryPrice ?? riskOverlay.entryPrice,
        stopPrice: sourceAutomation.stopPrice ?? riskOverlay.stopPrice,
        activeStopPrice: sourceAutomation.activeStopPrice ?? riskOverlay.activeStopPrice,
        activeStopKind: sourceAutomation.activeStopKind ?? riskOverlay.activeStopKind,
        stopLossPrice: sourceAutomation.stopLossPrice ?? riskOverlay.hardStopPrice,
        takeProfitPrice: sourceAutomation.takeProfitPrice ?? riskOverlay.takeProfitPrice,
        tradeManagement: {
          ...riskOverlay,
          ...managementTradeState(sourceAutomation),
        },
      }
    : sourceAutomation;
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
  const entry = firstFiniteNumber(
    options.entry,
    options.entryPrice,
    row?.averageCost,
    row?.averagePrice,
    row?.entryPrice,
    row?.entry,
    automation.entryPrice,
  );
  const brokerStop = brokerLevel({ row, options, kind: "stop", mark });
  const brokerTarget = brokerLevel({ row, options, kind: "target", mark });
  const stop =
    brokerStop ??
    automationStopLevel(automation) ??
    localLevel(options.localStopLoss ?? row?.stopLoss ?? row?.sl, "local");
  const trail = automationTrailLevel(automation);
  const protectiveStop = trail ?? stop;
  const target =
    brokerTarget ??
    automationTargetLevel(automation) ??
    localLevel(
      options.localTakeProfit ??
        (automationTargetIsTrailActivation(automation) ? null : row?.takeProfit ?? row?.tp),
      "local",
    );
  const riskDistancePct = distancePctFromStop({
    mark,
    stopPrice: protectiveStop?.price,
    short,
  });
  const riskAmount = riskAmountFromStop({
    mark,
    stopPrice: protectiveStop?.price,
    quantity,
    multiplier,
  });
  const stopProjectedReturnPct = projectedReturnPctAtLevel({
    entry,
    levelPrice: stop?.price,
    short,
  });
  const trailProjectedReturnPct = projectedReturnPctAtLevel({
    entry,
    levelPrice: trail?.price,
    short,
  });
  const tradeState = managementTradeState(automation);
  const trailActivationPct = firstFiniteNumber(
    tradeState.trailActivationPct,
    riskOverlay?.trailActivationPct,
    automation.trailActivationPct,
  );
  const trailActiveRungPct = firstFiniteNumber(
    tradeState.activeTrailActivationPct,
    riskOverlay?.activeTrailActivationPct,
    automation.activeTrailActivationPct,
    trailActivationPct,
  );
  const trailMinLockedGainPct = firstFiniteNumber(
    tradeState.minLockedGainPct,
    riskOverlay?.minLockedGainPct,
    automation.minLockedGainPct,
  );
  const trailRetracementPct = firstFiniteNumber(
    tradeState.trailRetracementPct,
    riskOverlay?.trailRetracementPct,
    automation.trailRetracementPct,
    tradeState.givebackPct,
    riskOverlay?.givebackPct,
    automation.givebackPct,
  );
  const trailPeakPrice = firstFiniteNumber(
    tradeState.peakPrice,
    riskOverlay?.peakPrice,
    automation.peakPrice,
  );
  const trailPeakReturnPct = projectedReturnPctAtLevel({
    entry,
    levelPrice: trailPeakPrice,
    short,
  });
  const trailPeakEvidenceSource = normalizeText(
    tradeState.peakEvidenceSource ??
      riskOverlay?.peakEvidenceSource ??
      automation.peakEvidenceSource,
  ) || null;
  const status = protectiveStop
    ? riskDistancePct != null && riskDistancePct <= 0
      ? "breached"
      : "protected"
    : target
      ? "targetOnly"
      : "unprotected";

  return {
    stop,
    trail,
    protectiveStop,
    target,
    riskDistancePct,
    riskAmount,
    stopProjectedReturnPct,
    trailProjectedReturnPct,
    trailActivationPct,
    trailActiveRungPct,
    trailMinLockedGainPct,
    trailRetracementPct,
    trailGivebackPct: trailRetracementPct,
    trailPeakPrice,
    trailPeakReturnPct,
    trailPeakEvidenceSource,
    trailPeakLabel:
      trailPeakEvidenceSource === "executable_bid" ? "Bid peak" : "Peak",
    status,
    statusLabel: TRADE_MANAGEMENT_STATUS[status] ?? TRADE_MANAGEMENT_STATUS.unknown,
    source: protectiveStop?.source ?? target?.source ?? null,
    sortValues: {
      stop: stop?.price ?? null,
      trail: trail?.price ?? null,
      target: target?.price ?? null,
      riskDistance: riskDistancePct,
      riskAmount,
    },
  };
};
