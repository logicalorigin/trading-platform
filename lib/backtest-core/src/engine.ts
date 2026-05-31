import {
  getExecutableStrategy,
  getStrategyCatalogItem,
} from "./strategies";
import { calculateBacktestMetrics } from "./analytics";
import {
  defaultConservativeOptionFillPolicy,
  defaultLegacyOptionFillPolicy,
  resolveOptionFill,
  type OptionFillPolicy,
  type OptionFillRejectionReason,
  type OptionFillSide,
} from "./option-fills";
import type {
  BacktestBar,
  BacktestPoint,
  BacktestRunResult,
  BacktestRiskRules,
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

type FillResult =
  | {
      status: "filled";
      price: number;
    }
  | {
      status: "no_fill";
      reason: OptionFillRejectionReason;
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

function resolveExecutionOptionFillPolicy(
  study: StudyDefinition,
): OptionFillPolicy | null {
  const profile = study.executionProfile.optionFillPolicy;
  if (!profile) {
    return null;
  }

  switch (profile.model) {
    case "legacy_open_slippage":
      return {
        ...defaultLegacyOptionFillPolicy,
        ...profile,
      };
    case "conservative_quote":
      return {
        ...defaultConservativeOptionFillPolicy,
        ...profile,
      };
    case "post_and_wait":
      return {
        ...defaultConservativeOptionFillPolicy,
        ...profile,
        model: "post_and_wait",
      };
    default:
      return null;
  }
}

function formatOptionFillWarning(input: {
  symbol: string;
  side: OptionFillSide;
  model: OptionFillPolicy["model"];
  occurredAt: Date;
  reason: OptionFillRejectionReason;
}): string {
  return `${input.model} ${input.side} ${input.symbol} rejected at ${input.occurredAt.toISOString()} (${input.reason}).`;
}

function positivePercent(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function hasRiskRules(rules: BacktestRiskRules | undefined): boolean {
  return Boolean(
    positivePercent(rules?.stopLossPercent) ||
      positivePercent(rules?.takeProfitPercent) ||
      positivePercent(rules?.trailingStopPercent),
  );
}

function resolveRiskExit(
  position: PositionState,
  bar: BacktestBar,
  rules: BacktestRiskRules | undefined,
): { price: number; reason: string } | null {
  if (!hasRiskRules(rules)) {
    return null;
  }

  const stopLossPercent = positivePercent(rules?.stopLossPercent);
  const takeProfitPercent = positivePercent(rules?.takeProfitPercent);
  const trailingStopPercent = positivePercent(rules?.trailingStopPercent);
  const trailingActivationPercent =
    positivePercent(rules?.trailingActivationPercent) ?? 0;
  const highestPrice = Math.max(position.highestPrice ?? position.entryPrice, bar.high);
  position.highestPrice = highestPrice;

  const fixedStop =
    stopLossPercent != null
      ? position.entryPrice * (1 - stopLossPercent / 100)
      : null;
  const takeProfit =
    takeProfitPercent != null
      ? position.entryPrice * (1 + takeProfitPercent / 100)
      : null;
  const trailingActivated =
    trailingStopPercent != null &&
    highestPrice >= position.entryPrice * (1 + trailingActivationPercent / 100);

  if (trailingActivated && trailingStopPercent != null) {
    const nextTrailingStop = highestPrice * (1 - trailingStopPercent / 100);
    position.trailingStopPrice =
      position.trailingStopPrice == null
        ? nextTrailingStop
        : Math.max(position.trailingStopPrice, nextTrailingStop);
  }

  const trailingStop = position.trailingStopPrice ?? null;
  const activeStops = [
    fixedStop ? { price: fixedStop, reason: "stop_loss" } : null,
    trailingStop ? { price: trailingStop, reason: "trailing_stop" } : null,
  ].filter(
    (stop): stop is { price: number; reason: string } =>
      Boolean(stop && Number.isFinite(stop.price)),
  );
  const activeStop = activeStops.sort((left, right) => right.price - left.price)[0] ?? null;
  const triggeredStop =
    activeStop && bar.low <= activeStop.price ? activeStop : null;
  const triggeredTarget =
    takeProfit != null && bar.high >= takeProfit
      ? { price: takeProfit, reason: "take_profit" }
      : null;

  if (triggeredStop) {
    return {
      price:
        bar.open <= triggeredStop.price
          ? bar.open
          : triggeredStop.price,
      reason: triggeredStop.reason,
    };
  }

  if (triggeredTarget) {
    return {
      price: bar.open >= triggeredTarget.price ? bar.open : triggeredTarget.price,
      reason: triggeredTarget.reason,
    };
  }

  return null;
}

function closeTrade(
  position: PositionState,
  exitAt: Date,
  exitPrice: number,
  exitReason: string,
  barsHeld: number,
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
    barsHeld: Math.max(Math.round(barsHeld), 1),
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
  const optionFillPolicy = resolveExecutionOptionFillPolicy(study);

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

  const resolveFill = (
    symbol: string,
    bar: BacktestBar,
    side: "buy" | "sell",
    occurredAt: Date,
    fallbackPrice: number,
  ): FillResult => {
    if (!optionFillPolicy) {
      return {
        status: "filled",
        price: applySlippage(
          fallbackPrice,
          side,
          study.executionProfile.slippageBps,
        ),
      };
    }

    const decision = resolveOptionFill({
      bar,
      side,
      policy: optionFillPolicy,
      occurredAt,
    });
    if (decision.status === "filled") {
      return {
        status: "filled",
        price:
          optionFillPolicy.model === "legacy_open_slippage"
            ? applySlippage(
                decision.fillPrice,
                side,
                study.executionProfile.slippageBps,
              )
            : decision.fillPrice,
      };
    }

    warnings.push(
      formatOptionFillWarning({
        symbol,
        side,
        model: optionFillPolicy.model,
        occurredAt,
        reason: decision.reason,
      }),
    );
    return {
      status: "no_fill",
      reason: decision.reason,
    };
  };

  timestamps.forEach((timestamp) => {
    const occurredAt = new Date(timestamp);

    orderMapKeysAscending(pendingExits).forEach((order) => {
      const bar = barsByTimestamp.get(order.symbol)?.get(timestamp);
      const position = positions.get(order.symbol);
      if (!bar || !position) {
        return;
      }

      const exitFill = resolveFill(order.symbol, bar, "sell", occurredAt, bar.open);
      if (exitFill.status === "no_fill") {
        return;
      }
      const exitPrice = exitFill.price;
      const exitValue = exitPrice * position.quantity;
      const commissionPaid = computeCommission(
        exitValue,
        study.executionProfile.commissionBps,
      );
      const exitFillIndex = (symbolIndexState.get(order.symbol) ?? -1) + 1;

      cash += exitValue - commissionPaid;
      trades.push(
        closeTrade(
          position,
          occurredAt,
          exitPrice,
          order.reason,
          exitFillIndex - position.entryIndex,
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
      const entryFill = resolveFill(order.symbol, bar, "buy", occurredAt, bar.open);
      if (entryFill.status === "no_fill") {
        pendingEntries.delete(order.symbol);
        return;
      }
      const fillPrice = entryFill.price;
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
      const entryFillIndex = (symbolIndexState.get(order.symbol) ?? -1) + 1;
      positions.set(order.symbol, {
        symbol: order.symbol,
        entryAt: occurredAt,
        entryIndex: entryFillIndex,
        entryPrice: fillPrice,
        quantity,
        entryValue,
        commissionPaid,
        highestPrice: fillPrice,
        trailingStopPrice: null,
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
      if (position) {
        const riskExit = resolveRiskExit(position, bar, study.riskRules);
        if (riskExit) {
          const exitFill = resolveFill(
            symbol,
            bar,
            "sell",
            occurredAt,
            riskExit.price,
          );
          if (exitFill.status === "no_fill") {
            return;
          }
          const exitPrice = exitFill.price;
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
              riskExit.reason,
              nextIndex - position.entryIndex,
              commissionPaid,
            ),
          );
          positions.delete(symbol);
          pendingExits.delete(symbol);
          return;
        }
      }
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
    const hadOpenPositions = positions.size > 0;
    [...positions.values()].forEach((position) => {
      const lastBar = barsByTimestamp.get(position.symbol)?.get(lastTimestamp);
      const fallbackPrice = latestCloseBySymbol.get(position.symbol) ?? position.entryPrice;
      const exitFill =
        lastBar != null
          ? resolveFill(position.symbol, lastBar, "sell", lastOccurredAt, fallbackPrice)
          : {
              status: "filled" as const,
              price: applySlippage(
                fallbackPrice,
                "sell",
                study.executionProfile.slippageBps,
              ),
            };
      if (exitFill.status === "no_fill") {
        warnings.push(
          `${position.symbol}: unable to liquidate open position at end of test.`,
        );
        return;
      }
      const exitPrice = exitFill.price;
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
          ((symbolIndexState.get(position.symbol) ?? -1) + 1) - position.entryIndex,
          commissionPaid,
        ),
      );
      positions.delete(position.symbol);
    });

    const remainingGrossExposure = [...positions.values()].reduce((sum, position) => {
      const markPrice = latestCloseBySymbol.get(position.symbol) ?? position.entryPrice;
      return sum + position.quantity * markPrice;
    }, 0);
    const finalEquity = cash + remainingGrossExposure;

    const finalPoint = {
      occurredAt: lastOccurredAt,
      equity: finalEquity,
      cash,
      grossExposure: remainingGrossExposure,
      drawdownPercent:
        peakEquity > 0 ? ((finalEquity - peakEquity) / peakEquity) * 100 : 0,
    };

    if (hadOpenPositions) {
      const lastPoint = points[points.length - 1];
      if (
        lastPoint &&
        lastPoint.occurredAt.getTime() === lastOccurredAt.getTime()
      ) {
        points[points.length - 1] = finalPoint;
      } else {
        points.push(finalPoint);
      }
    }
  }

  return {
    metrics: calculateBacktestMetrics(
      points,
      trades,
      study.portfolioRules.initialCapital,
    ),
    trades,
    points,
    warnings,
  };
}
