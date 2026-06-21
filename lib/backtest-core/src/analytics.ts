import type {
  BacktestAdvancedMetrics,
  BacktestBar,
  BacktestBenchmarkMetrics,
  BacktestMetrics,
  BacktestMonteCarloMetrics,
  BacktestPoint,
  BacktestTrade,
  BacktestValidationMetrics,
  BacktestValidationWarning,
} from "./types";

type MetricsOptions = {
  trialCount?: number;
  oosWindowCount?: number;
  parameterCount?: number;
  validationWarnings?: string[];
  benchmarks?: BacktestBenchmarkMetrics[];
};

const TRADING_PERIODS_PER_YEAR = 252;
const MONTE_CARLO_SAMPLE_COUNT = 250;
const MONTE_CARLO_SEED = 42_417;
const MIN_TRADE_COUNT_FOR_CONFIDENCE = 30;
const MIN_RETURN_SAMPLE_FOR_ADVANCED_METRICS = 30;
const MANY_TRIALS_THRESHOLD = 50;
const DRAWDOWN_DURATION_MIN_BARS = 8;
const DRAWDOWN_DURATION_FRACTION = 0.5;
const RAW_SHARPE_WARNING_THRESHOLD = 1;
const DEFLATED_SHARPE_PENALTY_THRESHOLD = 0.5;

function mean(values: number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function sampleVariance(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);
  return (
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1)
  );
}

function standardDeviation(values: number[]): number {
  return Math.sqrt(sampleVariance(values));
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x));

  return 0.5 * (1 + sign * erf);
}

export function equityReturns(points: BacktestPoint[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previousEquity = points[index - 1]?.equity ?? 0;
    const currentEquity = points[index]?.equity ?? 0;

    if (previousEquity <= 0) {
      continue;
    }

    returns.push((currentEquity - previousEquity) / previousEquity);
  }

  return returns;
}

export function calculateSharpe(points: BacktestPoint[]): number {
  const returns = equityReturns(points);
  if (returns.length < 2) {
    return 0;
  }

  const deviation = standardDeviation(returns);
  return deviation === 0
    ? 0
    : (mean(returns) / deviation) * Math.sqrt(TRADING_PERIODS_PER_YEAR);
}

function calculateSortino(returns: number[]): number {
  if (returns.length < 2) {
    return 0;
  }

  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = standardDeviation(downside);
  return downsideDeviation === 0
    ? 0
    : (mean(returns) / downsideDeviation) *
        Math.sqrt(TRADING_PERIODS_PER_YEAR);
}

function calculateMoments(returns: number[]): {
  skew: number;
  excessKurtosis: number;
} {
  if (returns.length < 3) {
    return { skew: 0, excessKurtosis: 0 };
  }

  const average = mean(returns);
  const deviation = standardDeviation(returns);
  if (deviation === 0) {
    return { skew: 0, excessKurtosis: 0 };
  }

  const normalized = returns.map((value) => (value - average) / deviation);
  const skew = mean(normalized.map((value) => value ** 3));
  const kurtosis = mean(normalized.map((value) => value ** 4));
  return { skew, excessKurtosis: kurtosis - 3 };
}

function calculateProbabilisticSharpe(
  sharpeRatio: number,
  returns: number[],
  skew: number,
  excessKurtosis: number,
): number {
  if (returns.length < 3 || !Number.isFinite(sharpeRatio)) {
    return 0;
  }

  const kurtosis = excessKurtosis + 3;
  const denominator = Math.sqrt(
    Math.max(
      0.000001,
      1 - skew * sharpeRatio + ((kurtosis - 1) / 4) * sharpeRatio ** 2,
    ),
  );
  const z = (sharpeRatio * Math.sqrt(returns.length - 1)) / denominator;
  return Math.min(1, Math.max(0, normalCdf(z)));
}

function calculateDeflatedSharpe(
  sharpeRatio: number,
  returns: number[],
  trialCount: number,
): number {
  if (returns.length < 2) {
    return 0;
  }

  const effectiveTrials = Math.max(1, trialCount);
  const multipleTrialPenalty =
    Math.sqrt(2 * Math.log(effectiveTrials)) / Math.sqrt(returns.length);
  return sharpeRatio - multipleTrialPenalty;
}

function drawdownDurationBars(points: BacktestPoint[]): number {
  let maxDuration = 0;
  let currentDuration = 0;

  points.forEach((point) => {
    if (point.drawdownPercent < 0) {
      currentDuration += 1;
      maxDuration = Math.max(maxDuration, currentDuration);
    } else {
      currentDuration = 0;
    }
  });

  return maxDuration;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function quantile(values: number[], percentile: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rawIndex = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(rawIndex);
  const upperIndex = Math.ceil(rawIndex);
  const weight = rawIndex - lowerIndex;
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * weight;
}

function calculatePathMaxDrawdown(values: number[]): number {
  let peak = values[0] ?? 0;
  let maxDrawdown = 0;

  values.forEach((value) => {
    peak = Math.max(peak, value);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, ((value - peak) / peak) * 100);
    }
  });

  return Math.abs(maxDrawdown);
}

function calculateMonteCarlo(
  trades: BacktestTrade[],
  initialCapital: number,
): BacktestMonteCarloMetrics {
  if (trades.length === 0 || initialCapital <= 0) {
    return {
      seed: MONTE_CARLO_SEED,
      sampleCount: 0,
      p05ReturnPercent: 0,
      p50ReturnPercent: 0,
      p95ReturnPercent: 0,
      probabilityOfLossPercent: 0,
      p95MaxDrawdownPercent: 0,
    };
  }

  const random = seededRandom(MONTE_CARLO_SEED);
  const returns: number[] = [];
  const drawdowns: number[] = [];

  for (let sample = 0; sample < MONTE_CARLO_SAMPLE_COUNT; sample += 1) {
    let equity = initialCapital;
    const equityPath = [equity];

    for (let index = 0; index < trades.length; index += 1) {
      const pickedIndex = Math.floor(random() * trades.length);
      equity += trades[pickedIndex]?.netPnl ?? 0;
      equityPath.push(equity);
    }

    returns.push(((equity - initialCapital) / initialCapital) * 100);
    drawdowns.push(calculatePathMaxDrawdown(equityPath));
  }

  return {
    seed: MONTE_CARLO_SEED,
    sampleCount: MONTE_CARLO_SAMPLE_COUNT,
    p05ReturnPercent: quantile(returns, 0.05),
    p50ReturnPercent: quantile(returns, 0.5),
    p95ReturnPercent: quantile(returns, 0.95),
    probabilityOfLossPercent:
      (returns.filter((value) => value < 0).length / returns.length) * 100,
    p95MaxDrawdownPercent: quantile(drawdowns, 0.95),
  };
}

function calculateAdvancedMetrics(
  points: BacktestPoint[],
  trades: BacktestTrade[],
  initialCapital: number,
  baseMetrics: Omit<
    BacktestMetrics,
    "advanced" | "validation" | "dataQuality" | "benchmarks"
  >,
  trialCount: number,
): BacktestAdvancedMetrics {
  const returns = equityReturns(points);
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const deviation = standardDeviation(returns);
  const { skew, excessKurtosis } = calculateMoments(returns);
  const averageWin = mean(wins.map((trade) => trade.netPnl));
  const averageLoss = mean(losses.map((trade) => trade.netPnl));
  const totalEntryValue = trades.reduce(
    (sum, trade) => sum + Math.abs(trade.entryValue),
    0,
  );
  const averageExposure =
    points.length > 0
      ? mean(points.map((point) => Math.abs(point.grossExposure)))
      : 0;

  return {
    annualizedVolatilityPercent:
      deviation * Math.sqrt(TRADING_PERIODS_PER_YEAR) * 100,
    sortinoRatio: calculateSortino(returns),
    calmarRatio:
      baseMetrics.maxDrawdownPercent === 0
        ? baseMetrics.totalReturnPercent
        : baseMetrics.totalReturnPercent / baseMetrics.maxDrawdownPercent,
    expectancy: trades.length > 0 ? baseMetrics.netPnl / trades.length : 0,
    averageWin,
    averageLoss,
    payoffRatio: averageLoss === 0 ? 0 : averageWin / Math.abs(averageLoss),
    exposurePercent:
      initialCapital > 0 ? (averageExposure / initialCapital) * 100 : 0,
    turnover: initialCapital > 0 ? totalEntryValue / initialCapital : 0,
    maxDrawdownDurationBars: drawdownDurationBars(points),
    skew,
    excessKurtosis,
    probabilisticSharpeRatio: calculateProbabilisticSharpe(
      baseMetrics.sharpeRatio,
      returns,
      skew,
      excessKurtosis,
    ),
    deflatedSharpeRatio: calculateDeflatedSharpe(
      baseMetrics.sharpeRatio,
      returns,
      trialCount,
    ),
    monteCarlo: calculateMonteCarlo(trades, initialCapital),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function buildValidationWarningDetails(input: {
  externalWarnings: string[];
  tradeCount: number;
  trialCount: number;
  oosWindowCount: number;
  parameterCount: number;
  points: BacktestPoint[];
  returns: number[];
  sharpeRatio: number;
  advanced: BacktestAdvancedMetrics;
}): BacktestValidationWarning[] {
  const warningDetails: BacktestValidationWarning[] = input.externalWarnings.map(
    (message, index) => ({
      code: "external_validation_warning",
      severity: "info",
      scope: "external",
      message,
      evidence: {
        index,
      },
    }),
  );

  if (input.tradeCount < MIN_TRADE_COUNT_FOR_CONFIDENCE) {
    warningDetails.push({
      code: "low_trade_count",
      severity: "warning",
      scope: "sample",
      message: "Trade count is below 30; statistical confidence is limited.",
      evidence: {
        tradeCount: input.tradeCount,
        minimumTradeCount: MIN_TRADE_COUNT_FOR_CONFIDENCE,
      },
    });
  }

  if (input.trialCount >= MANY_TRIALS_THRESHOLD) {
    warningDetails.push({
      code: "too_many_trials",
      severity: "warning",
      scope: "optimization",
      message:
        "Parameter search tested many candidates; overfitting risk increases with trial count.",
      evidence: {
        trialCount: input.trialCount,
        trialThreshold: MANY_TRIALS_THRESHOLD,
        parameterCount: input.parameterCount,
      },
    });
  }

  if (input.trialCount > 1 && input.oosWindowCount === 0) {
    warningDetails.push({
      code: "missing_out_of_sample_window",
      severity: "warning",
      scope: "optimization",
      message:
        "Multiple tested candidates without an out-of-sample window increase overfitting risk.",
      evidence: {
        trialCount: input.trialCount,
        oosWindowCount: input.oosWindowCount,
      },
    });
  }

  const drawdownDurationThreshold = Math.max(
    DRAWDOWN_DURATION_MIN_BARS,
    Math.ceil(input.points.length * DRAWDOWN_DURATION_FRACTION),
  );
  if (
    input.advanced.maxDrawdownDurationBars >= drawdownDurationThreshold &&
    input.advanced.maxDrawdownDurationBars > 0
  ) {
    warningDetails.push({
      code: "excessive_drawdown_duration",
      severity: "warning",
      scope: "risk",
      message:
        "Drawdown duration is elevated; review recovery time before trusting the strategy.",
      evidence: {
        maxDrawdownDurationBars: input.advanced.maxDrawdownDurationBars,
        drawdownDurationThreshold,
        pointCount: input.points.length,
      },
    });
  }

  const sharpePenalty = Math.abs(
    input.sharpeRatio - input.advanced.deflatedSharpeRatio,
  );
  if (
    input.trialCount > 1 &&
    input.returns.length >= MIN_RETURN_SAMPLE_FOR_ADVANCED_METRICS &&
    Math.abs(input.sharpeRatio) >= RAW_SHARPE_WARNING_THRESHOLD &&
    sharpePenalty >= DEFLATED_SHARPE_PENALTY_THRESHOLD
  ) {
    warningDetails.push({
      code: "unstable_sharpe",
      severity: "warning",
      scope: "metric",
      message:
        "Deflated Sharpe is materially lower than raw Sharpe after trial adjustment.",
      evidence: {
        sharpeRatio: input.sharpeRatio,
        deflatedSharpeRatio: input.advanced.deflatedSharpeRatio,
        sharpePenalty,
        trialCount: input.trialCount,
      },
    });
  }

  if (input.returns.length < MIN_RETURN_SAMPLE_FOR_ADVANCED_METRICS) {
    warningDetails.push({
      code: "insufficient_sample_size",
      severity: "info",
      scope: "sample",
      message:
        "Return sample is below 30 observations; advanced metrics may be unstable.",
      evidence: {
        returnSampleSize: input.returns.length,
        minimumReturnSampleSize: MIN_RETURN_SAMPLE_FOR_ADVANCED_METRICS,
      },
    });
  }

  return warningDetails;
}

export function calculateBacktestMetrics(
  points: BacktestPoint[],
  trades: BacktestTrade[],
  initialCapital: number,
  options: MetricsOptions = {},
): BacktestMetrics {
  const endingEquity = points[points.length - 1]?.equity ?? initialCapital;
  const netPnl = endingEquity - initialCapital;
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = losses.reduce((sum, trade) => sum + trade.netPnl, 0);
  const profitFactor =
    grossLoss === 0 ? (grossProfit > 0 ? grossProfit : 0) : Math.abs(grossProfit / grossLoss);
  const maxDrawdownPercent = Math.abs(
    points.reduce(
      (minimum, point) => Math.min(minimum, point.drawdownPercent),
      0,
    ),
  );
  const totalReturnPercent = initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0;
  const returnOverMaxDrawdown =
    maxDrawdownPercent === 0
      ? totalReturnPercent
      : totalReturnPercent / Math.abs(maxDrawdownPercent);
  const trialCount = Math.max(1, Math.round(options.trialCount ?? 1));
  const oosWindowCount = Math.max(0, Math.round(options.oosWindowCount ?? 0));
  const parameterCount = Math.max(0, Math.round(options.parameterCount ?? 0));
  const baseMetrics = {
    netPnl,
    totalReturnPercent,
    maxDrawdownPercent,
    tradeCount: trades.length,
    winRatePercent: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    profitFactor,
    sharpeRatio: calculateSharpe(points),
    returnOverMaxDrawdown,
  };
  const advanced = calculateAdvancedMetrics(
    points,
    trades,
    initialCapital,
    baseMetrics,
    trialCount,
  );
  const warningDetails = buildValidationWarningDetails({
    externalWarnings: options.validationWarnings ?? [],
    tradeCount: trades.length,
    trialCount,
    oosWindowCount,
    parameterCount,
    points,
    returns: equityReturns(points),
    sharpeRatio: baseMetrics.sharpeRatio,
    advanced,
  });
  const validation: BacktestValidationMetrics = {
    trialCount,
    oosWindowCount,
    parameterCount,
    pboProbabilityPercent: null,
    cpcvFoldCount: null,
    warnings: uniqueStrings(warningDetails.map((warning) => warning.message)),
    warningDetails,
  };

  return {
    ...baseMetrics,
    advanced,
    validation,
    benchmarks: options.benchmarks,
  };
}

export function calculateBenchmarkMetrics(input: {
  symbol: string;
  benchmarkBars: BacktestBar[];
  strategyPoints: BacktestPoint[];
  initialCapital: number;
}): BacktestBenchmarkMetrics | null {
  const firstBar = input.benchmarkBars[0];
  const lastBar = input.benchmarkBars[input.benchmarkBars.length - 1];
  if (!firstBar || !lastBar || firstBar.open <= 0) {
    return null;
  }

  let peak = firstBar.open;
  let maxDrawdown = 0;
  input.benchmarkBars.forEach((bar) => {
    peak = Math.max(peak, bar.close);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, ((bar.close - peak) / peak) * 100);
    }
  });

  const benchmarkReturns: number[] = [];
  for (let index = 1; index < input.benchmarkBars.length; index += 1) {
    const previous = input.benchmarkBars[index - 1]?.close ?? 0;
    const current = input.benchmarkBars[index]?.close ?? 0;
    if (previous > 0) {
      benchmarkReturns.push((current - previous) / previous);
    }
  }

  const strategyReturns = equityReturns(input.strategyPoints).slice(
    -benchmarkReturns.length,
  );
  const alignedBenchmarkReturns = benchmarkReturns.slice(
    -strategyReturns.length,
  );
  const benchmarkVariance = sampleVariance(alignedBenchmarkReturns);
  const strategyMean = mean(strategyReturns);
  const benchmarkMean = mean(alignedBenchmarkReturns);
  const covariance =
    strategyReturns.length > 1
      ? strategyReturns.reduce(
          (sum, value, index) =>
            sum +
            (value - strategyMean) *
              ((alignedBenchmarkReturns[index] ?? 0) - benchmarkMean),
          0,
        ) /
        (strategyReturns.length - 1)
      : 0;
  const strategyDeviation = standardDeviation(strategyReturns);
  const benchmarkDeviation = standardDeviation(alignedBenchmarkReturns);
  const beta =
    benchmarkVariance > 0 ? covariance / benchmarkVariance : null;
  const correlation =
    strategyDeviation > 0 && benchmarkDeviation > 0
      ? covariance / (strategyDeviation * benchmarkDeviation)
      : null;
  const totalReturnPercent =
    ((lastBar.close - firstBar.open) / firstBar.open) * 100;
  const strategyReturnPercent =
    input.initialCapital > 0
      ? (((input.strategyPoints[input.strategyPoints.length - 1]?.equity ??
          input.initialCapital) -
          input.initialCapital) /
          input.initialCapital) *
        100
      : 0;

  return {
    symbol: input.symbol,
    totalReturnPercent,
    maxDrawdownPercent: Math.abs(maxDrawdown),
    beta,
    alphaPercent:
      beta == null
        ? null
        : strategyReturnPercent - beta * totalReturnPercent,
    correlation,
  };
}
