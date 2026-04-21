import {
  getExecutableStrategy,
  getStrategyCatalogItem,
} from "./strategies";
import type {
  BacktestBar,
  BacktestMetrics,
  BacktestPoint,
  BacktestRunResult,
  BacktestTrade,
  PositionState,
  StudyDefinition,
} from "./types";

type PendingOrder = {
  symbol: string;
  side: "buy" | "sell";
  reason: string;
  signalIndex: number;
};

function orderMapKeysAscending(
  pendingOrders: Map<string, PendingOrder>,
): PendingOrder[] {
  return [...pendingOrders.values()].sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

function computeCommission(value: number, commissionBps: number): number {
  return value * (commissionBps / 10_000);
}

function applySlippage(price: number, side: "buy" | "sell", slippageBps: number): number {
  const multiplier = slippageBps / 10_000;
  return side === "buy" ? price * (1 + multiplier) : price * (1 - multiplier);
}

function calculateSharpe(points: BacktestPoint[]): number {
  if (points.length < 3) {
    return 0;
  }

  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previousEquity = points[index - 1]?.equity ?? 0;
    const currentEquity = points[index]?.equity ?? 0;

    if (previousEquity <= 0) {
      continue;
    }

    returns.push((currentEquity - previousEquity) / previousEquity);
  }

  if (returns.length < 2) {
    return 0;
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1);
  const standardDeviation = Math.sqrt(variance);

  if (standardDeviation === 0) {
    return 0;
  }

  return (mean / standardDeviation) * Math.sqrt(252);
}

function buildMetrics(
  points: BacktestPoint[],
  trades: BacktestTrade[],
  initialCapital: number,
): BacktestMetrics {
  const endingEquity = points[points.length - 1]?.equity ?? initialCapital;
  const netPnl = endingEquity - initialCapital;
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const profitFactor =
    Math.abs(
      wins.reduce((sum, trade) => sum + trade.netPnl, 0) /
        (losses.reduce((sum, trade) => sum + trade.netPnl, 0) || -1),
    ) || 0;
  const maxDrawdownPercent =
    points.reduce(
      (maximum, point) => Math.max(maximum, point.drawdownPercent),
      0,
    ) * -1;
  const totalReturnPercent = initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0;
  const returnOverMaxDrawdown =
    maxDrawdownPercent === 0 ? totalReturnPercent : totalReturnPercent / Math.abs(maxDrawdownPercent);

  return {
    netPnl,
    totalReturnPercent,
    maxDrawdownPercent,
    tradeCount: trades.length,
    winRatePercent: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    profitFactor,
    sharpeRatio: calculateSharpe(points),
    returnOverMaxDrawdown,
  };
}

function closeTrade(
  position: PositionState,
  exitAt: Date,
  exitPrice: number,
  exitReason: string,
  signalIndex: number,
  commissionPaid: number,
): BacktestTrade {
  const exitValue = exitPrice * position.quantity;
  const grossPnl = exitValue - position.entryValue;
  const netPnl = grossPnl - position.commissionPaid - commissionPaid;

  return {
    symbol: position.symbol,
    side: "long",
    entryAt: position.entryAt,
    exitAt,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
    entryValue: position.entryValue,
    exitValue,
    grossPnl,
    netPnl,
    netPnlPercent: position.entryValue > 0 ? (netPnl / position.entryValue) * 100 : 0,
    barsHeld: Math.max(signalIndex, 0),
    commissionPaid: position.commissionPaid + commissionPaid,
    exitReason,
  };
}

export function runBacktest(
  study: StudyDefinition,
  barsBySymbol: Record<string, BacktestBar[]>,
): BacktestRunResult {
  const strategy = getExecutableStrategy(study.strategyId, study.strategyVersion);
  const catalogItem = getStrategyCatalogItem(study.strategyId, study.strategyVersion);
  const warnings = [...(catalogItem?.unsupportedFeatures ?? [])];

  const timestamps = [...new Set(
    Object.values(barsBySymbol)
      .flatMap((bars) => bars.map((bar) => bar.startsAt.getTime())),
  )].sort((left, right) => left - right);

  const barsByTimestamp = new Map<string, Map<number, BacktestBar>>();
  Object.entries(barsBySymbol).forEach(([symbol, bars]) => {
    const mapped = new Map<number, BacktestBar>();
    bars
      .slice()
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
      .forEach((bar) => {
        mapped.set(bar.startsAt.getTime(), bar);
      });
    barsByTimestamp.set(symbol, mapped);
  });

  const positions = new Map<string, PositionState>();
  const pendingEntries = new Map<string, PendingOrder>();
  const pendingExits = new Map<string, PendingOrder>();
  const symbolIndexState = new Map<string, number>();
  const latestCloseBySymbol = new Map<string, number>();
  const trades: BacktestTrade[] = [];
  const points: BacktestPoint[] = [];
  let cash = study.portfolioRules.initialCapital;
  let peakEquity = study.portfolioRules.initialCapital;

  timestamps.forEach((timestamp) => {
    const occurredAt = new Date(timestamp);

    orderMapKeysAscending(pendingExits).forEach((order) => {
      const bar = barsByTimestamp.get(order.symbol)?.get(timestamp);
      const position = positions.get(order.symbol);
      if (!bar || !position) {
        return;
      }

      const exitPrice = applySlippage(
        bar.open,
        "sell",
        study.executionProfile.slippageBps,
      );
      const exitValue = exitPrice * position.quantity;
      const commissionPaid = computeCommission(
        exitValue,
        study.executionProfile.commissionBps,
      );

      cash += exitValue - commissionPaid;
      trades.push(
        closeTrade(
          position,
          occurredAt,
          exitPrice,
          order.reason,
          Math.max((symbolIndexState.get(order.symbol) ?? 0) - order.signalIndex, 1),
          commissionPaid,
        ),
      );
      positions.delete(order.symbol);
      pendingExits.delete(order.symbol);
    });

    orderMapKeysAscending(pendingEntries).forEach((order) => {
      const bar = barsByTimestamp.get(order.symbol)?.get(timestamp);
      if (!bar || positions.has(order.symbol)) {
        return;
      }

      if (positions.size >= study.portfolioRules.maxConcurrentPositions) {
        pendingEntries.delete(order.symbol);
        return;
      }

      const targetPositionValue =
        study.portfolioRules.initialCapital *
        (study.portfolioRules.positionSizePercent / 100);
      const fillPrice = applySlippage(
        bar.open,
        "buy",
        study.executionProfile.slippageBps,
      );
      const quantity = Math.floor(targetPositionValue / fillPrice);

      if (quantity <= 0) {
        pendingEntries.delete(order.symbol);
        return;
      }

      const entryValue = quantity * fillPrice;
      const commissionPaid = computeCommission(
        entryValue,
        study.executionProfile.commissionBps,
      );
      const totalCost = entryValue + commissionPaid;

      if (cash < totalCost) {
        pendingEntries.delete(order.symbol);
        return;
      }

      cash -= totalCost;
      positions.set(order.symbol, {
        symbol: order.symbol,
        entryAt: occurredAt,
        entryPrice: fillPrice,
        quantity,
        entryValue,
        commissionPaid,
      });
      pendingEntries.delete(order.symbol);
    });

    study.symbols.forEach((symbol) => {
      const bar = barsByTimestamp.get(symbol)?.get(timestamp);
      if (!bar) {
        return;
      }

      latestCloseBySymbol.set(symbol, bar.close);
      const nextIndex = (symbolIndexState.get(symbol) ?? -1) + 1;
      symbolIndexState.set(symbol, nextIndex);

      const symbolBars = barsBySymbol[symbol] ?? [];
      const position = positions.get(symbol) ?? null;
      const signal = strategy.evaluate({
        symbol,
        bars: symbolBars,
        index: nextIndex,
        position,
        parameters: study.parameters,
      });

      if (signal === "exit_long" && position) {
        pendingExits.set(symbol, {
          symbol,
          side: "sell",
          reason: "strategy_exit",
          signalIndex: nextIndex,
        });
      } else if (signal === "enter_long" && !position) {
        pendingEntries.set(symbol, {
          symbol,
          side: "buy",
          reason: "strategy_entry",
          signalIndex: nextIndex,
        });
      }
    });

    const grossExposure = [...positions.values()].reduce((sum, position) => {
      const markPrice = latestCloseBySymbol.get(position.symbol) ?? position.entryPrice;
      return sum + position.quantity * markPrice;
    }, 0);

    const equity = cash + grossExposure;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPercent =
      peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0;

    points.push({
      occurredAt,
      equity,
      cash,
      grossExposure,
      drawdownPercent,
    });
  });

  const lastTimestamp = timestamps[timestamps.length - 1];
  if (lastTimestamp) {
    const lastOccurredAt = new Date(lastTimestamp);
    [...positions.values()].forEach((position) => {
      const exitPrice = latestCloseBySymbol.get(position.symbol) ?? position.entryPrice;
      const exitValue = exitPrice * position.quantity;
      const commissionPaid = computeCommission(
        exitValue,
        study.executionProfile.commissionBps,
      );

      cash += exitValue - commissionPaid;
      trades.push(
        closeTrade(
          position,
          lastOccurredAt,
          exitPrice,
          "end_of_test",
          Math.max(symbolIndexState.get(position.symbol) ?? 1, 1),
          commissionPaid,
        ),
      );
    });

    positions.clear();

    points.push({
      occurredAt: lastOccurredAt,
      equity: cash,
      cash,
      grossExposure: 0,
      drawdownPercent:
        peakEquity > 0 ? ((cash - peakEquity) / peakEquity) * 100 : 0,
    });
  }

  return {
    metrics: buildMetrics(points, trades, study.portfolioRules.initialCapital),
    trades,
    points,
    warnings,
  };
}
