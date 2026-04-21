import { runBacktest } from "./engine";
import type {
  BacktestBar,
  BacktestMetrics,
  BacktestRunResult,
  OptimizerMode,
  StrategyParameters,
  StudyDefinition,
  SweepDimension,
  WalkForwardWindow,
} from "./types";

export type CandidateResult = {
  parameters: StrategyParameters;
  result: BacktestRunResult;
};

function dedupeCandidates(
  candidates: StrategyParameters[],
): StrategyParameters[] {
  const unique = new Map<string, StrategyParameters>();
  candidates.forEach((candidate) => {
    unique.set(JSON.stringify(candidate), candidate);
  });

  return [...unique.values()];
}

export function buildGridCandidates(
  baseParameters: StrategyParameters,
  dimensions: SweepDimension[],
): StrategyParameters[] {
  let candidates: StrategyParameters[] = [{ ...baseParameters }];

  dimensions.forEach((dimension) => {
    candidates = candidates.flatMap((candidate) =>
      dimension.values.map((value) => ({
        ...candidate,
        [dimension.key]: value,
      })),
    );
  });

  return dedupeCandidates(candidates);
}

export function buildRandomCandidates(
  baseParameters: StrategyParameters,
  dimensions: SweepDimension[],
  budget: number,
): StrategyParameters[] {
  const candidates: StrategyParameters[] = [];
  const safeBudget = Math.max(1, Math.min(budget, 500));

  for (let index = 0; index < safeBudget; index += 1) {
    const nextCandidate: StrategyParameters = { ...baseParameters };
    dimensions.forEach((dimension) => {
      const pickedIndex = Math.floor(Math.random() * dimension.values.length);
      nextCandidate[dimension.key] =
        dimension.values[pickedIndex] ?? dimension.values[0]!;
    });
    candidates.push(nextCandidate);
  }

  return dedupeCandidates(candidates);
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function buildWalkForwardWindows(
  from: Date,
  to: Date,
  trainingMonths: number,
  testMonths: number,
  stepMonths: number,
): WalkForwardWindow[] {
  const windows: WalkForwardWindow[] = [];
  let trainingFrom = new Date(from.getTime());
  let index = 0;

  while (true) {
    const trainingTo = addMonths(trainingFrom, trainingMonths);
    const testFrom = new Date(trainingTo.getTime());
    const testTo = addMonths(testFrom, testMonths);

    if (testTo > to) {
      break;
    }

    windows.push({
      index,
      trainingFrom: new Date(trainingFrom.getTime()),
      trainingTo,
      testFrom,
      testTo,
    });

    trainingFrom = addMonths(trainingFrom, stepMonths);
    index += 1;
  }

  return windows;
}

function rankByPrimaryMetrics(left: BacktestMetrics, right: BacktestMetrics): number {
  if (left.returnOverMaxDrawdown !== right.returnOverMaxDrawdown) {
    return right.returnOverMaxDrawdown - left.returnOverMaxDrawdown;
  }

  if (left.sharpeRatio !== right.sharpeRatio) {
    return right.sharpeRatio - left.sharpeRatio;
  }

  return right.profitFactor - left.profitFactor;
}

export function rankCandidateResults(
  candidates: CandidateResult[],
): CandidateResult[] {
  return candidates
    .slice()
    .sort((left, right) =>
      rankByPrimaryMetrics(left.result.metrics, right.result.metrics),
    );
}

export function runOptimizerCandidates(
  study: StudyDefinition,
  barsBySymbol: Record<string, BacktestBar[]>,
  candidateParameters: StrategyParameters[],
): CandidateResult[] {
  return candidateParameters.map((parameters) => ({
    parameters,
    result: runBacktest(
      {
        ...study,
        parameters,
      },
      barsBySymbol,
    ),
  }));
}

export function scoreWalkForwardCandidates(
  study: StudyDefinition,
  barsBySymbol: Record<string, BacktestBar[]>,
  candidateParameters: StrategyParameters[],
  windows: WalkForwardWindow[],
): CandidateResult[] {
  const topCandidates = rankCandidateResults(
    runOptimizerCandidates(study, barsBySymbol, candidateParameters),
  ).slice(0, 20);

  if (windows.length === 0) {
    return topCandidates;
  }

  return topCandidates.map((candidate) => {
    const outOfSampleResults = windows.map((window) => {
      const windowBars = Object.fromEntries(
        Object.entries(barsBySymbol).map(([symbol, bars]) => [
          symbol,
          bars.filter((bar) => {
            const startsAt = bar.startsAt;
            return startsAt >= window.testFrom && startsAt <= window.testTo;
          }),
        ]),
      ) as Record<string, BacktestBar[]>;

      return runBacktest(
        {
          ...study,
          from: window.testFrom,
          to: window.testTo,
          parameters: candidate.parameters,
        },
        windowBars,
      );
    });

    const mergedMetrics = outOfSampleResults.reduce<BacktestMetrics>(
      (aggregate, result, index) => ({
        netPnl: aggregate.netPnl + result.metrics.netPnl,
        totalReturnPercent:
          aggregate.totalReturnPercent +
          result.metrics.totalReturnPercent / outOfSampleResults.length,
        maxDrawdownPercent:
          index === 0
            ? result.metrics.maxDrawdownPercent
            : Math.min(aggregate.maxDrawdownPercent, result.metrics.maxDrawdownPercent),
        tradeCount: aggregate.tradeCount + result.metrics.tradeCount,
        winRatePercent:
          aggregate.winRatePercent +
          result.metrics.winRatePercent / outOfSampleResults.length,
        profitFactor:
          aggregate.profitFactor +
          result.metrics.profitFactor / outOfSampleResults.length,
        sharpeRatio:
          aggregate.sharpeRatio +
          result.metrics.sharpeRatio / outOfSampleResults.length,
        returnOverMaxDrawdown:
          aggregate.returnOverMaxDrawdown +
          result.metrics.returnOverMaxDrawdown / outOfSampleResults.length,
      }),
      {
        netPnl: 0,
        totalReturnPercent: 0,
        maxDrawdownPercent: 0,
        tradeCount: 0,
        winRatePercent: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        returnOverMaxDrawdown: 0,
      },
    );

    return {
      parameters: candidate.parameters,
      result: {
        metrics: mergedMetrics,
        trades: candidate.result.trades,
        points: candidate.result.points,
        warnings: candidate.result.warnings,
      },
    };
  });
}

export function buildCandidatesForMode(
  optimizerMode: OptimizerMode,
  baseParameters: StrategyParameters,
  dimensions: SweepDimension[],
  randomBudget: number,
): StrategyParameters[] {
  switch (optimizerMode) {
    case "grid":
      return buildGridCandidates(baseParameters, dimensions);
    case "random":
      return buildRandomCandidates(baseParameters, dimensions, randomBudget);
    case "walk_forward": {
      const gridCandidates = buildGridCandidates(baseParameters, dimensions);
      if (gridCandidates.length <= 100) {
        return gridCandidates;
      }

      return buildRandomCandidates(baseParameters, dimensions, randomBudget);
    }
    default:
      return buildGridCandidates(baseParameters, dimensions);
  }
}
