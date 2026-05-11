const EMPTY_ARRAY = Object.freeze([]);

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const arrayValue = (value) => (Array.isArray(value) ? value : EMPTY_ARRAY);

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const normalizeSymbol = (value) => normalizeText(value).toUpperCase();

export const getAccountTradeId = (trade) => {
  if (!trade) return "";
  return `${normalizeText(trade.source, "TRADE")}:${normalizeText(trade.id, trade.symbol)}`;
};

const tradePnl = (trade) => finiteNumber(trade?.realizedPnl) ?? 0;
const tradeFees = (trade) => finiteNumber(trade?.commissions) ?? 0;
const tradeQuantity = (trade) => Math.abs(finiteNumber(trade?.quantity) ?? 0);
const tradeMultiplier = (trade) =>
  finiteNumber(trade?.selectedContract?.multiplier) ??
  finiteNumber(trade?.optionContract?.multiplier) ??
  finiteNumber(trade?.selectedContract?.sharesPerContract) ??
  finiteNumber(trade?.optionContract?.sharesPerContract) ??
  100;

const tradeSourceType = (trade) =>
  normalizeText(trade?.sourceType, normalizeText(trade?.source, "unknown"));

const tradeStrategy = (trade) =>
  normalizeText(
    trade?.strategyLabel,
    normalizeText(trade?.deploymentName, normalizeText(trade?.candidateId, "Unattributed")),
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
  const fees = Math.abs(tradeFees(trade));
  const pnl = Math.abs(tradePnl(trade));
  if (!fees) return "none";
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
  if (kind === "pnl") return value === "winners" ? "Winners" : "Losers";
  return value;
};

const summarizeTrades = (trades) => {
  const rows = arrayValue(trades);
  const realizedPnl = rows.reduce((sum, trade) => sum + tradePnl(trade), 0);
  const fees = rows.reduce((sum, trade) => sum + tradeFees(trade), 0);
  const winners = rows.filter((trade) => tradePnl(trade) > 0).length;
  const losers = rows.filter((trade) => tradePnl(trade) < 0).length;
  const grossWins = rows
    .filter((trade) => tradePnl(trade) > 0)
    .reduce((sum, trade) => sum + tradePnl(trade), 0);
  const grossLosses = Math.abs(
    rows
      .filter((trade) => tradePnl(trade) < 0)
      .reduce((sum, trade) => sum + tradePnl(trade), 0),
  );
  return {
    count: rows.length,
    winners,
    losers,
    realizedPnl,
    commissions: fees,
    winRatePercent: rows.length ? (winners / rows.length) * 100 : null,
    expectancy: rows.length ? realizedPnl / rows.length : null,
    profitFactor:
      grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? null : 0,
  };
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
    .sort((left, right) => Math.abs(right.realizedPnl) - Math.abs(left.realizedPnl));
};

const optionRightBucket = (trade) => {
  const right = normalizeText(
    trade?.optionRight,
    normalizeText(trade?.selectedContract?.right, normalizeText(trade?.optionContract?.right)),
  ).toLowerCase();
  return right === "put" || right === "call" ? right : "unknown";
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

const newYorkHour = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return Number.isFinite(hour) ? hour : null;
};

const entryTimeBucket = (trade) => {
  const hour = newYorkHour(trade?.openDate);
  if (hour == null) return "unknown";
  if (hour < 10) return "open";
  if (hour < 12) return "morning";
  if (hour < 14) return "midday";
  return "afternoon";
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

const STOP_SCENARIOS = Object.freeze([
  { key: "current", label: "Current", hardStopPct: -50, trailActivationPct: 150, minLockedGainPct: 25, trailGivebackPct: 45 },
  { key: "early-lock", label: "+50 locks +10", hardStopPct: -50, trailActivationPct: 50, minLockedGainPct: 10, trailGivebackPct: 45 },
  { key: "strong-lock", label: "+75 locks +25", hardStopPct: -50, trailActivationPct: 75, minLockedGainPct: 25, trailGivebackPct: 45 },
  { key: "hard-35", label: "Hard -35", hardStopPct: -35, trailActivationPct: 150, minLockedGainPct: 25, trailGivebackPct: 45 },
  { key: "hard-40", label: "Hard -40", hardStopPct: -40, trailActivationPct: 150, minLockedGainPct: 25, trailGivebackPct: 45 },
]);

const estimateScenarioPnl = (trade, scenario) => {
  const entry = finiteNumber(trade?.avgOpen);
  const exit = finiteNumber(trade?.avgClose);
  if (entry == null || entry <= 0 || exit == null) return tradePnl(trade);
  const peak = Math.max(entry, finiteNumber(trade?.peakPrice) ?? entry);
  const peakReturnPct = ((peak - entry) / entry) * 100;
  const hardStop = entry * (1 + scenario.hardStopPct / 100);
  const trailStop =
    peakReturnPct >= scenario.trailActivationPct
      ? Math.max(
          entry * (1 + scenario.minLockedGainPct / 100),
          peak * (1 - scenario.trailGivebackPct / 100),
        )
      : null;
  const scenarioExit = Math.max(exit, hardStop, trailStop ?? hardStop);
  const gross = (scenarioExit - entry) * tradeQuantity(trade) * tradeMultiplier(trade);
  return gross - Math.abs(tradeFees(trade));
};

const summarizeScenarioValues = (values) => {
  const rows = values.filter((value) => Number.isFinite(value));
  const realizedPnl = rows.reduce((sum, value) => sum + value, 0);
  const winners = rows.filter((value) => value > 0);
  const losers = rows.filter((value) => value < 0);
  const expectancy = rows.length ? realizedPnl / rows.length : null;
  const variance =
    rows.length && expectancy != null
      ? rows.reduce((sum, value) => sum + (value - expectancy) ** 2, 0) / rows.length
      : null;
  const grossWins = winners.reduce((sum, value) => sum + value, 0);
  const grossLosses = Math.abs(losers.reduce((sum, value) => sum + value, 0));
  return {
    count: rows.length,
    realizedPnl,
    winners: winners.length,
    losers: losers.length,
    winRatePercent: rows.length ? (winners.length / rows.length) * 100 : null,
    expectancy,
    standardDeviation: variance == null ? null : Math.sqrt(variance),
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? null : 0,
  };
};

const buildStopScenarioAnalysis = (trades) => {
  const rows = arrayValue(trades).filter((trade) => finiteNumber(trade?.avgOpen) != null);
  const actual = summarizeScenarioValues(rows.map(tradePnl));
  return STOP_SCENARIOS.map((scenario) => {
    const summary = summarizeScenarioValues(rows.map((trade) => estimateScenarioPnl(trade, scenario)));
    return {
      ...scenario,
      ...summary,
      deltaPnl: summary.realizedPnl - actual.realizedPnl,
      deltaStdDev:
        summary.standardDeviation != null && actual.standardDeviation != null
          ? summary.standardDeviation - actual.standardDeviation
          : null,
    };
  }).sort((left, right) => {
    const leftRisk = finiteNumber(left.standardDeviation) ?? Number.POSITIVE_INFINITY;
    const rightRisk = finiteNumber(right.standardDeviation) ?? Number.POSITIVE_INFINITY;
    return leftRisk - rightRisk || right.realizedPnl - left.realizedPnl;
  });
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

const cardForTrade = ({ key, label, description, trade, tone = "default" }) => {
  if (!trade) return null;
  return {
    key,
    label,
    description,
    value: tradePnl(trade),
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

export const buildAccountAnalysisReadiness = ({
  trades = [],
  orders = [],
  positions = [],
  bucketGroups = {},
} = {}) => {
  const tradeRows = arrayValue(trades);
  const orderRows = arrayValue(orders);
  const positionRows = arrayValue(positions);
  const symbolBuckets = arrayValue(bucketGroups.symbol);
  const feeRows = tradeRows.filter((trade) => finiteNumber(trade?.commissions) != null);
  return [
    {
      key: "closed-trades",
      label: "Closed Trades",
      value: tradeRows.length,
      state: tradeRows.length ? "ready" : "waiting",
      detail: tradeRows.length ? "Ledger ready" : "Waiting for fills",
    },
    {
      key: "pattern-buckets",
      label: "Buckets",
      value: symbolBuckets.length,
      state: symbolBuckets.length ? "ready" : "waiting",
      detail: symbolBuckets.length ? "Grouped by symbol" : "No repeat groups",
    },
    {
      key: "fee-coverage",
      label: "Fees",
      value: feeRows.length,
      state: tradeRows.length && feeRows.length === tradeRows.length ? "ready" : "optional",
      detail: tradeRows.length && feeRows.length === tradeRows.length ? "Complete" : "Partial",
    },
    {
      key: "order-context",
      label: "Orders",
      value: orderRows.length,
      state: orderRows.length ? "ready" : "optional",
      detail: orderRows.length ? "Context linked" : "No order rows",
    },
    {
      key: "position-context",
      label: "Positions",
      value: positionRows.length,
      state: positionRows.length ? "ready" : "optional",
      detail: positionRows.length ? "Open lots linked" : "No open lots",
    },
  ];
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
  const symbol = normalizeSymbol(trade.symbol);
  const candidateId = normalizeText(trade.candidateId);
  return arrayValue(orders)
    .filter((order) => {
      if (normalizeSymbol(order.symbol) !== symbol) return false;
      if (candidateId && normalizeText(order.candidateId) === candidateId) return true;
      if (tradeSourceType(order) === tradeSourceType(trade)) return true;
      return !candidateId;
    })
    .slice(0, 5);
};

const relatedPositionsForTrade = (trade, positions) => {
  if (!trade) return [];
  const symbol = normalizeSymbol(trade.symbol);
  return arrayValue(positions)
    .filter((position) => normalizeSymbol(position.symbol) === symbol)
    .slice(0, 4);
};

export const buildAccountTradeLifecycleRows = ({ trade, orders = [], positions = [] }) => {
  if (!trade) return [];
  const relatedOrders = relatedOrdersForTrade(trade, orders);
  const relatedPositions = relatedPositionsForTrade(trade, positions);
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
    trade.selectedContract || trade.optionRight || trade.dte != null
      ? {
          key: "contract",
          label: "Contract",
          at: trade.openDate,
          detail: `${normalizeText(trade.optionRight || trade.selectedContract?.right, "option").toUpperCase()} ${
            trade.strike ?? trade.selectedContract?.strike ?? "strike"
          } ${trade.expirationDate || trade.selectedContract?.expirationDate || ""}`.trim(),
          value: trade.dte == null ? null : `${Math.round(Number(trade.dte))} DTE`,
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
    relatedOrders[0]
      ? {
          key: "order",
          label: "Order",
          at: relatedOrders[0].filledAt || relatedOrders[0].placedAt,
          detail: `${relatedOrders[0].type || "Order"} ${relatedOrders[0].status || ""}`.trim(),
          value: relatedOrders[0].averageFillPrice,
        }
      : null,
    {
      key: "hold",
      label: "Hold",
      at: trade.closeDate,
      detail:
        trade.holdDurationMinutes == null
          ? "Hold duration unavailable"
          : `${Math.round(Number(trade.holdDurationMinutes))} minutes`,
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
      tone: tradePnl(trade) >= 0 ? "green" : "red",
    },
    relatedPositions[0]
      ? {
          key: "position",
          label: "After Close",
          at: trade.closeDate,
          detail: `${relatedPositions.length} related open position row${relatedPositions.length === 1 ? "" : "s"}`,
        }
      : null,
  ];
  return rows.filter((row) => row && normalizeText(row.detail));
};

export const buildAccountTradingAnalysisModel = ({
  trades = [],
  orders = [],
  positions = [],
  patternPacket = {},
  selectedTradeId = "",
} = {}) => {
  const tradeRows = arrayValue(trades);
  const computedSummary = summarizeTrades(tradeRows);
  const summary = tradeRows.length
    ? {
        ...(patternPacket?.summary || {}),
        ...computedSummary,
      }
    : {
        ...computedSummary,
        ...(patternPacket?.summary || {}),
      };
  const bySymbol = groupTrades(tradeRows, "symbol", (trade) => normalizeSymbol(trade.symbol) || "UNKNOWN");
  const bySource = groupTrades(tradeRows, "source", tradeSourceType);
  const bySide = groupTrades(tradeRows, "side", tradeSide);
  const byAssetClass = groupTrades(tradeRows, "assetClass", (trade) =>
    normalizeText(trade.assetClass, "Unknown"),
  );
  const byExitReason = groupTrades(tradeRows, "exitReason", (trade) =>
    normalizeText(trade.exitReason, "unknown"),
  );
  const byOptionRight = groupTrades(tradeRows, "optionRight", optionRightBucket);
  const byDte = groupTrades(tradeRows, "dte", dteBucket);
  const byStrikeSlot = groupTrades(tradeRows, "strikeSlot", strikeSlotBucket);
  const byEntryTime = groupTrades(tradeRows, "entryTime", entryTimeBucket);
  const byRegime = groupTrades(tradeRows, "regime", regimeBucket);
  const byMfeGiveback = groupTrades(tradeRows, "mfeGiveback", mfeGivebackBucket);
  const byHoldDuration = groupTrades(tradeRows, "holdDuration", (trade) =>
    holdDurationBucket(trade.holdDurationMinutes),
  );
  const byStrategy = groupTrades(tradeRows, "strategy", tradeStrategy);
  const byFeeDrag = groupTrades(tradeRows, "feeDrag", feeDragBucket);

  const bestTrade = [...tradeRows].sort((left, right) => tradePnl(right) - tradePnl(left))[0] ?? null;
  const worstTrade = [...tradeRows].sort((left, right) => tradePnl(left) - tradePnl(right))[0] ?? null;
  const highestFeeTrade = [...tradeRows].sort((left, right) => tradeFees(right) - tradeFees(left))[0] ?? null;
  const typicalTrade = findTypicalTrade(tradeRows, summary.expectancy);
  const worstSymbol = bySymbol.filter((group) => group.realizedPnl < 0)[0] ?? null;
  const worstSource = bySource.filter((group) => group.realizedPnl < 0)[0] ?? null;
  const lowWinRateGroup =
    [...bySymbol, ...bySource, ...byStrategy]
      .filter((group) => group.count >= 2 && group.winRatePercent != null)
      .sort((left, right) => left.winRatePercent - right.winRatePercent)[0] ?? null;
  const highFeeGroup =
    byFeeDrag.find((group) => group.key === "high" && group.commissions > 0) ?? null;
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
  const selectedTradeDetail = selectedTrade
    ? {
        trade: selectedTrade,
        tradeId: getAccountTradeId(selectedTrade),
        relatedOrders: relatedOrdersForTrade(selectedTrade, orders),
        relatedPositions: relatedPositionsForTrade(selectedTrade, positions),
      }
    : null;

  return {
    summary,
    readiness: buildAccountAnalysisReadiness({
      trades: tradeRows,
      orders,
      positions,
      bucketGroups: {
        symbol: bySymbol,
      },
    }),
    representativeTrades,
    issueCards,
    bucketGroups: {
      symbol: bySymbol,
      source: bySource,
      side: bySide,
      assetClass: byAssetClass,
      exitReason: byExitReason,
      optionRight: byOptionRight,
      dte: byDte,
      strikeSlot: byStrikeSlot,
      entryTime: byEntryTime,
      regime: byRegime,
      mfeGiveback: byMfeGiveback,
      holdDuration: byHoldDuration,
      strategy: byStrategy,
      feeDrag: byFeeDrag,
    },
    stopScenarios: buildStopScenarioAnalysis(tradeRows),
    contractBreakdowns: {
      optionRight: byOptionRight,
      dte: byDte,
      strikeSlot: byStrikeSlot,
    },
    selectedTradeDetail,
    lifecycleRows: buildAccountTradeLifecycleRows({
      trade: selectedTrade,
      orders,
      positions,
    }),
  };
};
