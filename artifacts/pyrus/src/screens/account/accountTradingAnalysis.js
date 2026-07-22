import { normalizeLegacyAlgoBrandText } from "../algo/algoBranding.js";

const EMPTY_ARRAY = Object.freeze([]);

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

const arrayValue = (value) => (Array.isArray(value) ? value : EMPTY_ARRAY);

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const normalizeSymbol = (value) => normalizeText(value).toUpperCase();

export const getAccountTradeId = (trade) => {
  if (!trade) return "";
  const fallbackId = [
    trade.symbol,
    trade.openDate,
    trade.closeDate,
    trade.side,
    trade.quantity,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(":");
  return `${normalizeText(trade.source, "TRADE")}:${normalizeText(
    trade.id,
    fallbackId || "unknown",
  )}`;
};

export const resolveAccountTradeContractDetails = (trade) => {
  const optionContract =
    trade?.optionContract &&
    typeof trade.optionContract === "object" &&
    !Array.isArray(trade.optionContract)
      ? trade.optionContract
      : {};
  const selectedContract =
    trade?.selectedContract &&
    typeof trade.selectedContract === "object" &&
    !Array.isArray(trade.selectedContract)
      ? trade.selectedContract
      : {};
  const right = normalizeText(
    trade?.optionRight,
    normalizeText(optionContract.right, normalizeText(selectedContract.right)),
  ).toLowerCase();
  const strike =
    finiteNumber(trade?.strike) ??
    finiteNumber(optionContract.strike) ??
    finiteNumber(selectedContract.strike);
  const expirationDate = normalizeText(
    trade?.expirationDate,
    normalizeText(
      optionContract.expirationDate ?? optionContract.expiry,
      normalizeText(
        selectedContract.expirationDate ?? selectedContract.expiry,
      ),
    ),
  );
  const multiplier =
    positiveNumber(optionContract.multiplier) ??
    positiveNumber(optionContract.sharesPerContract) ??
    positiveNumber(selectedContract.multiplier) ??
    positiveNumber(selectedContract.sharesPerContract);
  const providerContractId = normalizeText(
    optionContract.providerContractId ??
      optionContract.contractId ??
      optionContract.id ??
      optionContract.ticker,
    normalizeText(
      selectedContract.providerContractId ??
        selectedContract.contractId ??
        selectedContract.id ??
        selectedContract.ticker,
    ),
  );

  return {
    expirationDate: expirationDate || null,
    multiplier,
    providerContractId: providerContractId || null,
    right: right || null,
    strike,
  };
};

const tradePnlValue = (trade) =>
  trade?.realizedPnl == null || trade?.realizedPnl === ""
    ? null
    : finiteNumber(trade.realizedPnl);
const tradeHasKnownPnl = (trade) => tradePnlValue(trade) != null;
const tradePnl = (trade) => tradePnlValue(trade) ?? 0;
const tradeFeeValue = (trade) => finiteNumber(trade?.commissions);
const tradeFees = (trade) => tradeFeeValue(trade) ?? 0;
const tradeSourceType = (trade) =>
  normalizeText(trade?.sourceType, normalizeText(trade?.source, "unknown"));

const tradeStrategy = (trade) =>
  normalizeText(
    trade?.strategyLabel,
    normalizeText(
      normalizeLegacyAlgoBrandText(trade?.deploymentName),
      normalizeText(trade?.candidateId, "Unattributed"),
    ),
  );

const tradeSide = (trade) => {
  const side = normalizeText(trade?.side).toLowerCase();
  if (/sell|short/.test(side)) return "sell";
  if (/buy|long/.test(side)) return "buy";
  return side || "unknown";
};

export const holdDurationBucket = (minutes) => {
  const value = finiteNumber(minutes);
  if (value == null) return "unknown";
  if (value <= 30) return "intraday-fast";
  if (value <= 240) return "intraday";
  if (value <= 1_440) return "swing";
  return "multi-day";
};

export const feeDragBucket = (trade) => {
  const feeValue = tradeFeeValue(trade);
  if (feeValue == null) return "unknown";
  const fees = Math.abs(feeValue);
  if (!fees) return "none";
  if (!tradeHasKnownPnl(trade)) return "unknown";
  const pnl = Math.abs(tradePnl(trade));
  if (!pnl) return fees >= 1 ? "high" : "low";
  const ratio = fees / Math.max(pnl, 1);
  if (ratio >= 0.25) return "high";
  if (ratio >= 0.1) return "medium";
  return "low";
};

const bucketLabel = (kind, value) => {
  if (kind === "holdDuration") {
    return {
      "intraday-fast": "<= 30m",
      intraday: "30m-4h",
      swing: "4h-1d",
      "multi-day": "Multi-day",
      unknown: "Unknown hold",
    }[value] || value;
  }
  if (kind === "feeDrag") {
    return {
      none: "No fees",
      low: "Low fee drag",
      medium: "Medium fee drag",
      high: "High fee drag",
      unknown: "Unknown fees",
    }[value] || value;
  }
  if (kind === "exitReason") return normalizeText(value, "unknown").replaceAll("_", " ");
  if (kind === "optionRight") return value === "put" ? "Puts" : value === "call" ? "Calls" : "Unknown right";
  if (kind === "dte") {
    return {
      "0dte": "0 DTE",
      "1dte": "1 DTE",
      "2-3dte": "2-3 DTE",
      "4-7dte": "4-7 DTE",
      "8dte+": "8+ DTE",
      unknown: "Unknown DTE",
    }[value] || value;
  }
  if (kind === "strikeSlot") return value === "unknown" ? "Unknown strike slot" : `Slot ${value}`;
  if (kind === "entryTime") {
    return {
      open: "Market open",
      morning: "Morning",
      midday: "Midday",
      afternoon: "Afternoon",
      unknown: "Unknown entry",
    }[value] || value;
  }
  if (kind === "regime") return value;
  if (kind === "mfeGiveback") {
    return {
      "no-mfe": "No MFE",
      "held-gain": "Held gains",
      "gave-back": "Gave back gains",
      "large-giveback": "Large giveback",
      unknown: "Unknown MFE",
    }[value] || value;
  }
  if (kind === "premiumAtRisk") {
    return {
      "sub-500": "< $500 premium",
      "500-1000": "$500-$1k premium",
      "1000-1500": "$1k-$1.5k premium",
      "1500-plus": "$1.5k+ premium",
      unknown: "Unknown premium",
    }[value] || value;
  }
  if (kind === "pnl") return value === "winners" ? "Winners" : "Losers";
  return value;
};

const summarizeTrades = (trades) => {
  const rows = arrayValue(trades);
  const outcomeRows = rows.filter(tradeHasKnownPnl);
  const hasCompleteOutcomes =
    rows.length > 0 && outcomeRows.length === rows.length;
  const realizedPnl = hasCompleteOutcomes
    ? outcomeRows.reduce((sum, trade) => sum + tradePnl(trade), 0)
    : null;
  const feeRows = rows.filter((trade) => tradeFeeValue(trade) != null);
  const fees = feeRows.reduce((sum, trade) => sum + tradeFees(trade), 0);
  const winners = outcomeRows.filter((trade) => tradePnl(trade) > 0).length;
  const losers = outcomeRows.filter((trade) => tradePnl(trade) < 0).length;
  const grossWins = outcomeRows
    .filter((trade) => tradePnl(trade) > 0)
    .reduce((sum, trade) => sum + tradePnl(trade), 0);
  const grossLosses = Math.abs(
    outcomeRows
      .filter((trade) => tradePnl(trade) < 0)
      .reduce((sum, trade) => sum + tradePnl(trade), 0),
  );
  return {
    count: rows.length,
    outcomeCount: outcomeRows.length,
    feeCount: feeRows.length,
    winners,
    losers,
    realizedPnl,
    commissions:
      rows.length > 0 && feeRows.length === rows.length ? fees : null,
    winRatePercent: hasCompleteOutcomes
      ? (winners / outcomeRows.length) * 100
      : null,
    expectancy: hasCompleteOutcomes
      ? realizedPnl / outcomeRows.length
      : null,
    profitFactor:
      !hasCompleteOutcomes
        ? null
        : grossLosses > 0
          ? grossWins / grossLosses
          : grossWins > 0
            ? null
            : 0,
  };
};

const tradeCloseInstant = (trade) => {
  const raw = trade?.closeDate || trade?.exitDate;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const WATERFALL_LIMIT = 40;
const buildTradeWaterfall = (trades, limit = WATERFALL_LIMIT) => {
  const outcomeRows = arrayValue(trades).filter(tradeHasKnownPnl);
  const rows = outcomeRows
    .map((trade) => ({ trade, t: tradeCloseInstant(trade) }));
  if (rows.some((row) => row.t == null)) return [];
  rows.sort((left, right) => left.t - right.t);
  const sliced = rows.slice(-limit);
  let cumulative = 0;
  return sliced.map(({ trade, t }) => {
    const value = tradePnl(trade);
    cumulative += value;
    return {
      id: getAccountTradeId(trade),
      symbol: trade?.symbol || "",
      side: trade?.side || "",
      pnl: value,
      cumulative,
      closeInstant: t,
      trade,
    };
  });
};

const groupTrades = (trades, kind, resolver) => {
  const groups = new Map();
  arrayValue(trades).forEach((trade) => {
    const key = resolver(trade);
    const rows = groups.get(key) ?? [];
    rows.push(trade);
    groups.set(key, rows);
  });
  return Array.from(groups.entries())
    .map(([key, rows]) => ({
      kind,
      key,
      label: bucketLabel(kind, key),
      trades: rows,
      ...summarizeTrades(rows),
    }))
    .sort(
      (left, right) =>
        Math.abs(right.realizedPnl ?? 0) - Math.abs(left.realizedPnl ?? 0),
    );
};

const dteBucket = (trade) => {
  const dte = finiteNumber(trade?.dte);
  if (dte == null) return "unknown";
  if (dte <= 0) return "0dte";
  if (dte <= 1) return "1dte";
  if (dte <= 3) return "2-3dte";
  if (dte <= 7) return "4-7dte";
  return "8dte+";
};

const strikeSlotBucket = (trade) => {
  const slot = finiteNumber(trade?.strikeSlot);
  return slot == null ? "unknown" : String(Math.round(slot));
};

const regimeBucket = (trade) => {
  const mtf = Array.isArray(trade?.mtfDirections)
    ? trade.mtfDirections.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  const adx = finiteNumber(trade?.adx);
  const mtfLabel = mtf.length
    ? mtf.every((value) => value > 0)
      ? "MTF bullish"
      : mtf.some((value) => value < 0)
        ? "MTF mixed/bearish"
        : "MTF neutral"
    : "MTF unknown";
  const adxLabel = adx == null ? "ADX unknown" : adx >= 25 ? "ADX >= 25" : "ADX < 25";
  return `${mtfLabel} · ${adxLabel}`;
};

const mfeGivebackBucket = (trade) => {
  const mfe = finiteNumber(trade?.mfePercent);
  const giveback = finiteNumber(trade?.givebackPercent);
  if (mfe == null || giveback == null) return "unknown";
  if (mfe <= 0) return "no-mfe";
  const ratio = giveback / Math.max(1, mfe);
  if (ratio >= 0.75) return "large-giveback";
  if (ratio >= 0.35) return "gave-back";
  return "held-gain";
};

const attributionRow = (group) => {
  if (!group) return null;
  const holdRows = arrayValue(group.trades).filter(
    (trade) => finiteNumber(trade?.holdDurationMinutes) != null,
  );
  return {
    kind: group.kind,
    key: group.key,
    label: group.label,
    realizedPnl: group.realizedPnl,
    count: group.count,
    winRatePercent: group.winRatePercent,
    expectancy: group.expectancy,
    profitFactor: group.profitFactor,
    averageHoldMinutes: holdRows.length
      ? holdRows.reduce(
          (sum, trade) => sum + (finiteNumber(trade?.holdDurationMinutes) ?? 0),
          0,
        ) / holdRows.length
      : null,
  };
};

const buildAttributionRows = (groups, limit = 6) =>
  arrayValue(groups)
    .filter(
      (group) =>
        group?.key &&
        group.key !== "unknown" &&
        group.count &&
        group.outcomeCount === group.count,
    )
    .map(attributionRow)
    .filter(Boolean)
    .sort((left, right) => Math.abs(right.realizedPnl || 0) - Math.abs(left.realizedPnl || 0))
    .slice(0, limit);

const buildAccountAttributionModel = ({
  symbol,
  exitReason,
  regime,
}) => {
  const contributionRows = [
    ...buildAttributionRows(symbol, 5),
    ...buildAttributionRows(exitReason, 4),
    ...buildAttributionRows(regime, 4),
  ]
    .sort((left, right) => Math.abs(right.realizedPnl || 0) - Math.abs(left.realizedPnl || 0))
    .slice(0, 10);
  return { contributionRows };
};

const lensForGroup = (group) => {
  if (!group) return { kind: "none", input: {} };
  if (group.kind === "symbol") return { kind: "symbol", input: { symbol: group.key } };
  if (group.kind === "source") {
    return {
      kind: "source",
      input: { sourceType: group.key, label: group.label },
    };
  }
  if (group.kind === "side") return { kind: "side", input: { side: group.key } };
  if (group.kind === "assetClass") {
    return { kind: "assetClass", input: { assetClass: group.key } };
  }
  if (group.kind === "holdDuration") {
    return { kind: "holdDuration", input: { holdDuration: group.key } };
  }
  if (group.kind === "strategy") {
    return { kind: "strategy", input: { strategy: group.key, label: group.label } };
  }
  if (group.kind === "feeDrag") {
    return { kind: "feeDrag", input: { feeDrag: group.key } };
  }
  return { kind: "none", input: {} };
};

const cardForTrade = ({
  key,
  label,
  description,
  trade,
  value = null,
  tone = "default",
}) => {
  if (!trade) return null;
  return {
    key,
    label,
    description,
    value: value ?? tradePnl(trade),
    tone,
    tradeId: getAccountTradeId(trade),
    symbol: normalizeSymbol(trade.symbol),
    lens: { kind: "symbol", input: { symbol: trade.symbol } },
  };
};

const cardForGroup = ({ key, label, description, group, tone = "default" }) => {
  if (!group) return null;
  return {
    key,
    label,
    description,
    value: group.realizedPnl,
    tone,
    tradeId: getAccountTradeId(group.trades?.[0]),
    symbol: normalizeSymbol(group.trades?.[0]?.symbol || group.key),
    lens: lensForGroup(group),
    meta: {
      count: group.count,
      winRatePercent: group.winRatePercent,
      expectancy: group.expectancy,
    },
  };
};

const findTypicalTrade = (trades, expectancy) => {
  const rows = arrayValue(trades);
  if (!rows.length) return null;
  const target = finiteNumber(expectancy) ?? 0;
  return [...rows].sort(
    (left, right) =>
      Math.abs(tradePnl(left) - target) - Math.abs(tradePnl(right) - target),
  )[0];
};

const relatedOrdersForTrade = (trade, orders) => {
  if (!trade) return [];
  if (!Array.isArray(trade.orderIds)) return [];
  const ordersById = new Map(
    arrayValue(orders)
      .map((order) => [normalizeText(order?.id), order])
      .filter(([orderId]) => orderId),
  );
  const seenOrderIds = new Set();
  return trade.orderIds
    .map((orderId) => normalizeText(orderId))
    .filter((orderId) => {
      if (!orderId || seenOrderIds.has(orderId)) return false;
      seenOrderIds.add(orderId);
      return true;
    })
    .map((orderId) => ordersById.get(orderId))
    .filter(Boolean);
};

export const buildAccountTradeLifecycleRows = ({ trade, orders = [] }) => {
  if (!trade) return [];
  const relatedOrders = relatedOrdersForTrade(trade, orders);
  const contract = resolveAccountTradeContractDetails(trade);
  const dte = finiteNumber(trade.dte);
  const holdDurationMinutes = finiteNumber(trade.holdDurationMinutes);
  const rows = [
    {
      key: "source",
      label: "Source",
      at: trade.openDate || trade.closeDate,
      detail: `${tradeStrategy(trade)} via ${tradeSourceType(trade)}`,
    },
    trade.openDate || trade.avgOpen != null
      ? {
          key: "entry",
          label: "Entry",
          at: trade.openDate,
          detail: `${trade.side || "Position"} ${trade.quantity ?? ""} ${trade.symbol || ""}`.trim(),
          value: trade.avgOpen,
        }
      : null,
    contract.right || contract.strike != null || contract.expirationDate || dte != null
      ? {
          key: "contract",
          label: "Contract",
          at: trade.openDate,
          detail: `${normalizeText(contract.right, "option").toUpperCase()} ${
            contract.strike ?? "strike"
          } ${contract.expirationDate || ""}`.trim(),
          value: dte == null ? null : `${Math.round(dte)} DTE`,
        }
      : null,
    trade.adx != null || Array.isArray(trade.mtfDirections)
      ? {
          key: "regime",
          label: "Regime",
          at: trade.openDate,
          detail: regimeBucket(trade),
        }
      : null,
    ...relatedOrders.map((order) => {
      const orderId = normalizeText(order.id, "unknown");
      const filledQuantity =
        finiteNumber(order.filledQuantity) ?? finiteNumber(order.quantity);
      const execution = [
        normalizeText(order.side).toUpperCase(),
        filledQuantity == null ? null : filledQuantity,
      ]
        .filter((value) => value != null && value !== "")
        .join(" ");
      const status = [order.type || "Order", order.status || ""]
        .filter(Boolean)
        .join(" ");
      return {
        key: `order:${orderId}`,
        label: "Order",
        at: order.filledAt || order.placedAt,
        detail: [execution, status, orderId].filter(Boolean).join(" · "),
        value: order.averageFillPrice,
        orderId,
      };
    }),
    {
      key: "hold",
      label: "Hold",
      at: trade.closeDate,
      detail:
        holdDurationMinutes == null
          ? "Hold duration unavailable"
          : `${Math.round(holdDurationMinutes)} minutes`,
    },
    {
      key: "exit",
      label: trade.exitReason ? "Exit Reason" : "Exit",
      at: trade.closeDate,
      detail: trade.exitReason
        ? normalizeText(trade.exitReason).replaceAll("_", " ")
        : `${trade.assetClass || "Trade"} closed`,
      value: trade.avgClose,
    },
    {
      key: "result",
      label: "Result",
      at: trade.closeDate,
      detail: "Realized account impact",
      value: trade.realizedPnl,
      tone:
        tradePnlValue(trade) == null
          ? "neutral"
          : tradePnl(trade) >= 0
            ? "green"
            : "red",
    },
  ];
  return rows.filter((row) => row && normalizeText(row.detail));
};

export const buildAccountTradingAnalysisModel = ({
  trades = [],
  orders = null,
  selectedTradeId = "",
} = {}) => {
  const tradeRows = arrayValue(trades);
  const computedSummary = summarizeTrades(tradeRows);
  const summary = computedSummary;
  const bySymbol = groupTrades(tradeRows, "symbol", (trade) => normalizeSymbol(trade.symbol) || "UNKNOWN");
  const bySource = groupTrades(tradeRows, "source", tradeSourceType);
  const byExitReason = groupTrades(tradeRows, "exitReason", (trade) =>
    normalizeText(trade.exitReason, "unknown"),
  );
  const byDte = groupTrades(tradeRows, "dte", dteBucket);
  const byStrikeSlot = groupTrades(tradeRows, "strikeSlot", strikeSlotBucket);
  const byRegime = groupTrades(tradeRows, "regime", regimeBucket);
  const byMfeGiveback = groupTrades(tradeRows, "mfeGiveback", mfeGivebackBucket);
  const byHoldDuration = groupTrades(tradeRows, "holdDuration", (trade) =>
    holdDurationBucket(trade.holdDurationMinutes),
  );
  const byStrategy = groupTrades(tradeRows, "strategy", tradeStrategy);
  const byFeeDrag = groupTrades(tradeRows, "feeDrag", feeDragBucket);
  const knownOutcomeTradeRows = tradeRows.filter(tradeHasKnownPnl);

  const bestTrade = [...knownOutcomeTradeRows].sort((left, right) => tradePnl(right) - tradePnl(left))[0] ?? null;
  const worstTrade = [...knownOutcomeTradeRows].sort((left, right) => tradePnl(left) - tradePnl(right))[0] ?? null;
  const highestFeeTrade = tradeRows
    .filter((trade) => tradeFeeValue(trade) != null)
    .sort((left, right) => Math.abs(tradeFees(right)) - Math.abs(tradeFees(left)))[0] ?? null;
  const typicalTrade =
    summary.expectancy == null
      ? null
      : findTypicalTrade(knownOutcomeTradeRows, summary.expectancy);
  const worstSymbol = bySymbol.filter((group) => group.realizedPnl < 0)[0] ?? null;
  const worstSource = bySource.filter((group) => group.realizedPnl < 0)[0] ?? null;
  const lowWinRateGroup =
    [...bySymbol, ...bySource, ...byStrategy]
      .filter((group) => group.count >= 2 && group.winRatePercent != null)
      .sort((left, right) => left.winRatePercent - right.winRatePercent)[0] ?? null;
  const highFeeGroup =
    byFeeDrag.find(
      (group) =>
        group.key === "high" &&
        group.realizedPnl != null &&
        group.commissions > 0,
    ) ?? null;
  const negativeExpectancyGroup =
    [...bySymbol, ...bySource, ...byStrategy, ...byHoldDuration]
      .filter((group) => (group.expectancy ?? 0) < 0)
      .sort((left, right) => (left.expectancy ?? 0) - (right.expectancy ?? 0))[0] ??
    null;

  const representativeTrades = [
    cardForTrade({
      key: "best-winner",
      label: "Best Winner",
      description: "Largest realized account gain",
      trade: bestTrade,
      tone: "green",
    }),
    cardForTrade({
      key: "worst-loss",
      label: "Worst Loss",
      description: "Largest realized account loss",
      trade: worstTrade,
      tone: "red",
    }),
    cardForTrade({
      key: "typical",
      label: "Typical Trade",
      description: "Closest trade to account expectancy",
      trade: typicalTrade,
      tone: "cyan",
    }),
    cardForTrade({
      key: "highest-fee",
      label: "Highest Fee",
      description: "Largest commission drag",
      trade: highestFeeTrade,
      value:
        tradeFeeValue(highestFeeTrade) == null
          ? null
          : Math.abs(tradeFeeValue(highestFeeTrade)),
      tone: "amber",
    }),
  ].filter(Boolean);

  const issueCards = [
    cardForGroup({
      key: "worst-symbol",
      label: "Worst Symbol",
      description: "Most negative symbol bucket",
      group: worstSymbol,
      tone: "red",
    }),
    cardForGroup({
      key: "worst-source",
      label: "Worst Source",
      description: "Most negative source bucket",
      group: worstSource,
      tone: "red",
    }),
    cardForGroup({
      key: "negative-expectancy",
      label: "Negative Expectancy",
      description: "Weakest expectancy bucket",
      group: negativeExpectancyGroup,
      tone: "amber",
    }),
    cardForGroup({
      key: "high-fee-drag",
      label: "Fee Drag",
      description: "Fees are large versus realized P&L",
      group: highFeeGroup,
      tone: "amber",
    }),
    cardForGroup({
      key: "low-win-rate",
      label: "Low Win Rate",
      description: "Lowest win-rate bucket with repeat trades",
      group: lowWinRateGroup,
      tone: "red",
    }),
  ].filter(Boolean);

  const selectedTrade =
    tradeRows.find((trade) => getAccountTradeId(trade) === selectedTradeId) ||
    tradeRows.find((trade) => getAccountTradeId(trade) === representativeTrades[0]?.tradeId) ||
    tradeRows[0] ||
    null;
  const waterfall = buildTradeWaterfall(tradeRows);

  return {
    waterfall,
    representativeTrades,
    issueCards,
    bucketGroups: {
      symbol: bySymbol,
      exitReason: byExitReason,
      dte: byDte,
      strikeSlot: byStrikeSlot,
      mfeGiveback: byMfeGiveback,
      holdDuration: byHoldDuration,
    },
    attribution: buildAccountAttributionModel({
      symbol: bySymbol,
      exitReason: byExitReason,
      regime: byRegime,
    }),
    lifecycleRows: buildAccountTradeLifecycleRows({
      trade: selectedTrade,
      orders,
    }),
    lifecycleOrdersKnown: Array.isArray(orders),
  };
};
