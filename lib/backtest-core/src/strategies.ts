import type {
  BacktestBar,
  BacktestSignal,
  BacktestTimeframe,
  StrategyCatalogItem,
  StrategyParameterDefinition,
  StrategyParameters,
  StrategySignalContext,
  StrategyStatus,
} from "./types";

type ExecutableStrategy = StrategyCatalogItem & {
  evaluate(context: StrategySignalContext): BacktestSignal;
};

function movingAverage(
  bars: BacktestBar[],
  index: number,
  length: number,
): number | null {
  if (length <= 0 || index < length - 1) {
    return null;
  }

  const window = bars.slice(index - length + 1, index + 1);
  if (window.length !== length) {
    return null;
  }

  return window.reduce((sum, bar) => sum + bar.close, 0) / length;
}

function integerParameter(parameters: StrategyParameters, key: string): number {
  const rawValue = parameters[key];
  return typeof rawValue === "number" ? Math.max(1, Math.round(rawValue)) : 1;
}

const sharedTimeframes: BacktestTimeframe[] = ["1m", "5m", "15m", "1h", "1d"];

const trendParameterDefinitions: StrategyParameterDefinition[] = [
  {
    key: "shortWindow",
    label: "Short Window",
    type: "integer",
    defaultValue: 20,
    min: 2,
    max: 200,
    step: 1,
  },
  {
    key: "longWindow",
    label: "Long Window",
    type: "integer",
    defaultValue: 50,
    min: 5,
    max: 300,
    step: 1,
  },
];

const strategies: ExecutableStrategy[] = [
  {
    strategyId: "sma_crossover",
    version: "v1",
    label: "SMA Crossover",
    description: "Long-only moving average crossover baseline for portfolio backtesting.",
    status: "runnable",
    directionMode: "long_only",
    supportedTimeframes: sharedTimeframes,
    compatibilityNotes: [
      "Runnable baseline strategy used to validate the v1 backtest engine.",
    ],
    unsupportedFeatures: [],
    parameterDefinitions: trendParameterDefinitions,
    defaultParameters: {
      shortWindow: 20,
      longWindow: 50,
    },
    evaluate({ bars, index, position, parameters }) {
      const shortWindow = integerParameter(parameters, "shortWindow");
      const longWindow = integerParameter(parameters, "longWindow");

      if (shortWindow >= longWindow) {
        return "hold";
      }

      const currentShort = movingAverage(bars, index, shortWindow);
      const currentLong = movingAverage(bars, index, longWindow);
      const previousShort = movingAverage(bars, index - 1, shortWindow);
      const previousLong = movingAverage(bars, index - 1, longWindow);

      if (
        currentShort === null ||
        currentLong === null ||
        previousShort === null ||
        previousLong === null
      ) {
        return "hold";
      }

      if (!position && previousShort <= previousLong && currentShort > currentLong) {
        return "enter_long";
      }

      if (position && previousShort >= previousLong && currentShort < currentLong) {
        return "exit_long";
      }

      return "hold";
    },
  },
  {
    strategyId: "pine_port",
    version: "pending_v1",
    label: "Pine Port (Pending)",
    description: "Placeholder catalog entry for the forthcoming Pine-derived strategy port.",
    status: "blocked",
    directionMode: "long_only",
    supportedTimeframes: sharedTimeframes,
    compatibilityNotes: [
      "Awaiting Pine script import and compatibility audit.",
    ],
    unsupportedFeatures: [
      "Pine source not imported",
      "Compatibility audit not completed",
    ],
    parameterDefinitions: [],
    defaultParameters: {},
    evaluate() {
      return "hold";
    },
  },
];

export function listStrategies(): StrategyCatalogItem[] {
  return strategies.map(({ evaluate: _evaluate, ...strategy }) => strategy);
}

export function getStrategyCatalogItem(
  strategyId: string,
  version: string,
): StrategyCatalogItem | null {
  const strategy =
    strategies.find(
      (candidate) =>
        candidate.strategyId === strategyId && candidate.version === version,
    ) ?? null;

  if (!strategy) {
    return null;
  }

  const { evaluate: _evaluate, ...catalogItem } = strategy;
  return catalogItem;
}

export function getExecutableStrategy(
  strategyId: string,
  version: string,
): ExecutableStrategy {
  const strategy = strategies.find(
    (candidate) =>
      candidate.strategyId === strategyId && candidate.version === version,
  );

  if (!strategy) {
    throw new Error(`Unknown strategy: ${strategyId}@${version}`);
  }

  if (strategy.status !== "runnable") {
    throw new Error(
      `Strategy ${strategyId}@${version} is ${strategy.status} and cannot run.`,
    );
  }

  return strategy;
}

export function getStrategyStatusSummary(
  strategyId: string,
  version: string,
): StrategyStatus | null {
  return (
    strategies.find(
      (candidate) =>
        candidate.strategyId === strategyId && candidate.version === version,
    )?.status ?? null
  );
}
