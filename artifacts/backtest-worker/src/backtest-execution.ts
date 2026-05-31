import type { StrategyParameters } from "@workspace/backtest-core";

export type BacktestExecutionMode = "spot" | "options" | "signal_options";

export function resolveBacktestExecutionMode(
  parameters: StrategyParameters | null | undefined,
): BacktestExecutionMode {
  const executionMode = parameters?.executionMode;
  return executionMode === "options" || executionMode === "signal_options"
    ? executionMode
    : "spot";
}

export function shouldRunOptionsBacktest(input: {
  strategyId: string;
  parameters: StrategyParameters | null | undefined;
}): boolean {
  return (
    input.strategyId === "pyrus_signals" &&
    resolveBacktestExecutionMode(input.parameters) !== "spot"
  );
}

export function shouldRankWalkForwardCandidatesWithSharedCore(input: {
  sweepMode: string;
  windowsCount: number;
  parameters: StrategyParameters | null | undefined;
}): boolean {
  return (
    input.sweepMode === "walk_forward" &&
    input.windowsCount > 0 &&
    resolveBacktestExecutionMode(input.parameters) === "spot"
  );
}
