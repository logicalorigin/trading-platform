import {
  defaultConservativeOptionFillPolicy,
  resolveOptionFill,
  type BacktestBar,
  type BacktestTimeframe,
  type OptionFillModel,
  type OptionFillPolicy,
  type OptionFillRejectionReason,
  type OptionFillSide,
  type StrategyParameters,
} from "@workspace/backtest-core";

export type WorkerOptionFillResult =
  | {
      status: "filled";
      fillPrice: number;
    }
  | {
      status: "no_fill";
      reason: OptionFillRejectionReason;
    };

function finiteNumberParameter(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function resolveWorkerOptionFillPolicy(
  parameters: StrategyParameters | null | undefined,
): OptionFillPolicy | null {
  const model = parameters?.optionFillModel;
  if (model !== "conservative_quote") {
    return null;
  }

  return {
    ...defaultConservativeOptionFillPolicy,
    model,
    maxSpreadPctOfMid:
      finiteNumberParameter(parameters?.optionFillMaxSpreadPct) ??
      defaultConservativeOptionFillPolicy.maxSpreadPctOfMid,
    maxQuoteAgeMs:
      finiteNumberParameter(parameters?.optionFillMaxQuoteAgeMs) ??
      defaultConservativeOptionFillPolicy.maxQuoteAgeMs,
  };
}

export function isQuoteReplayEligible(
  timeframe: BacktestTimeframe,
  bars: readonly BacktestBar[],
): boolean {
  return (
    timeframe === "1m" &&
    bars.length > 0 &&
    bars.every(
      (bar) =>
        typeof bar.bid === "number" &&
        typeof bar.ask === "number" &&
        bar.quoteAsOf instanceof Date,
    )
  );
}

export function resolveWorkerOptionFill(input: {
  bar: BacktestBar;
  side: OptionFillSide;
  policy: OptionFillPolicy;
  occurredAt?: Date;
  orderAgeBars?: number;
}): WorkerOptionFillResult {
  const decision = resolveOptionFill({
    bar: input.bar,
    side: input.side,
    policy: input.policy,
    occurredAt: input.occurredAt,
    orderAgeBars: input.orderAgeBars,
  });

  return decision.status === "filled"
    ? { status: "filled", fillPrice: decision.fillPrice }
    : { status: "no_fill", reason: decision.reason };
}

export function formatOptionFillNoFillWarning(input: {
  symbol: string;
  optionTicker: string;
  side: OptionFillSide;
  model: OptionFillModel;
  occurredAt: Date;
  reason: OptionFillRejectionReason;
}): string {
  return `${input.symbol}: ${input.optionTicker} ${input.side} ${input.model} fill rejected at ${input.occurredAt.toISOString()} (${input.reason}).`;
}

export function resolveWorkerSameBarConservativeExit(input: {
  entryBar: BacktestBar;
  entryPrice: number;
  hardStopPct: number;
}): { price: number; reason: string } | null {
  const stopPrice = input.entryPrice * (1 + input.hardStopPct / 100);
  if (input.entryBar.low > stopPrice) {
    return null;
  }

  const bid =
    typeof input.entryBar.bid === "number" && Number.isFinite(input.entryBar.bid)
      ? input.entryBar.bid
      : stopPrice;
  return {
    price: Math.min(bid, stopPrice),
    reason: "signal_options_hard_stop_same_bar",
  };
}
