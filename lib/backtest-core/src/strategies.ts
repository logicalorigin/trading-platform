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
import {
  backtestOptionPresets,
  defaultBacktestOptionPresetId,
} from "./options";
import { defaultSignalOptionsExecutionProfile } from "./signal-options";

type ExecutableStrategy = StrategyCatalogItem & {
  evaluate(context: StrategySignalContext): BacktestSignal;
};

const rayReplicaSignalCache = new WeakMap<
  BacktestBar[],
  Map<string, RayReplicaSignalTape>
>();

export type RayReplicaStructureKind = "bos" | "choch";

export type RayReplicaStructureEvent = {
  id: string;
  kind: RayReplicaStructureKind;
  direction: "long" | "short";
  label: "BOS" | "CHOCH";
  barIndex: number;
  occurredAt: Date;
  sourceBarIndex: number | null;
  sourcePrice: number | null;
};

export type RayReplicaRegimeWindow = {
  id: string;
  direction: "long" | "short";
  tone: "bullish" | "bearish";
  startBarIndex: number;
  endBarIndex: number;
  startAt: Date;
  endAt: Date;
};

export type RayReplicaSignalTape = {
  signals: BacktestSignal[];
  events: RayReplicaStructureEvent[];
  regimeWindows: RayReplicaRegimeWindow[];
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

function integerParameterWithDefault(
  parameters: StrategyParameters,
  key: string,
  defaultValue: number,
): number {
  const rawValue = parameters[key];
  return typeof rawValue === "number"
    ? Math.max(1, Math.round(rawValue))
    : defaultValue;
}

function resolvePivotHigh(
  bars: BacktestBar[],
  pivotIndex: number,
  strength: number,
): number | null {
  if (pivotIndex - strength < 0 || pivotIndex + strength >= bars.length) {
    return null;
  }

  const pivotValue = bars[pivotIndex]?.high;
  if (!Number.isFinite(pivotValue)) {
    return null;
  }

  for (
    let index = pivotIndex - strength;
    index <= pivotIndex + strength;
    index += 1
  ) {
    if (index === pivotIndex) {
      continue;
    }

    if ((bars[index]?.high ?? Number.NEGATIVE_INFINITY) > pivotValue) {
      return null;
    }
  }

  return pivotValue;
}

function resolvePivotLow(
  bars: BacktestBar[],
  pivotIndex: number,
  strength: number,
): number | null {
  if (pivotIndex - strength < 0 || pivotIndex + strength >= bars.length) {
    return null;
  }

  const pivotValue = bars[pivotIndex]?.low;
  if (!Number.isFinite(pivotValue)) {
    return null;
  }

  for (
    let index = pivotIndex - strength;
    index <= pivotIndex + strength;
    index += 1
  ) {
    if (index === pivotIndex) {
      continue;
    }

    if ((bars[index]?.low ?? Number.POSITIVE_INFINITY) < pivotValue) {
      return null;
    }
  }

  return pivotValue;
}

function closeRayReplicaRegimeWindow(
  regimeWindows: RayReplicaRegimeWindow[],
  bars: BacktestBar[],
  direction: "long" | "short",
  startBarIndex: number,
  endBarIndex: number,
): void {
  const startBar = bars[startBarIndex];
  const endBar = bars[endBarIndex];
  if (!startBar || !endBar || endBarIndex < startBarIndex) {
    return;
  }

  regimeWindows.push({
    id: `ray-replica-regime-${direction}-${startBar.startsAt.toISOString()}`,
    direction,
    tone: direction === "long" ? "bullish" : "bearish",
    startBarIndex,
    endBarIndex,
    startAt: startBar.startsAt,
    endAt: endBar.startsAt,
  });
}

export function buildRayReplicaSignalTape(
  bars: BacktestBar[],
  parameters: StrategyParameters,
): RayReplicaSignalTape {
  const timeHorizon = integerParameterWithDefault(parameters, "timeHorizon", 10);
  const cacheKey = JSON.stringify({ timeHorizon });
  const cachedTape = rayReplicaSignalCache.get(bars)?.get(cacheKey);
  if (cachedTape) {
    return cachedTape;
  }

  const signals = new Array<BacktestSignal>(bars.length).fill("hold");
  const events: RayReplicaStructureEvent[] = [];
  const regimeWindows: RayReplicaRegimeWindow[] = [];
  let marketStructureDirection = 0;
  let breakableHigh = Number.NaN;
  let breakableHighBarIndex: number | null = null;
  let breakableLow = Number.NaN;
  let breakableLowBarIndex: number | null = null;
  let activeRegimeDirection: "long" | "short" | null = null;
  let activeRegimeStartIndex: number | null = null;

  for (let index = 0; index < bars.length; index += 1) {
    const pivotIndex = index - timeHorizon;
    if (pivotIndex >= timeHorizon) {
      const pivotHigh = resolvePivotHigh(bars, pivotIndex, timeHorizon);
      if (pivotHigh != null) {
        breakableHigh = pivotHigh;
        breakableHighBarIndex = pivotIndex;
      }

      const pivotLow = resolvePivotLow(bars, pivotIndex, timeHorizon);
      if (pivotLow != null) {
        breakableLow = pivotLow;
        breakableLowBarIndex = pivotIndex;
      }
    }

    const close = bars[index]?.close ?? Number.NaN;

    if (Number.isFinite(breakableHigh) && close > breakableHigh) {
      const kind: RayReplicaStructureKind =
        marketStructureDirection === 1 ? "bos" : "choch";
      const label = kind === "choch" ? "CHOCH" : "BOS";
      events.push({
        id: `ray-replica-long-${label.toLowerCase()}-${bars[index]?.startsAt.toISOString() ?? index}`,
        kind,
        direction: "long",
        label,
        barIndex: index,
        occurredAt: bars[index]?.startsAt ?? new Date(0),
        sourceBarIndex: breakableHighBarIndex,
        sourcePrice: breakableHigh,
      });

      if (kind === "choch") {
        signals[index] = "enter_long";
        if (
          activeRegimeDirection &&
          activeRegimeStartIndex != null &&
          activeRegimeStartIndex <= index - 1
        ) {
          closeRayReplicaRegimeWindow(
            regimeWindows,
            bars,
            activeRegimeDirection,
            activeRegimeStartIndex,
            index - 1,
          );
        }
        activeRegimeDirection = "long";
        activeRegimeStartIndex = index;
        marketStructureDirection = 1;
      }

      breakableHigh = Number.NaN;
      breakableHighBarIndex = null;
    }

    if (Number.isFinite(breakableLow) && close < breakableLow) {
      const kind: RayReplicaStructureKind =
        marketStructureDirection === -1 ? "bos" : "choch";
      const label = kind === "choch" ? "CHOCH" : "BOS";
      events.push({
        id: `ray-replica-short-${label.toLowerCase()}-${bars[index]?.startsAt.toISOString() ?? index}`,
        kind,
        direction: "short",
        label,
        barIndex: index,
        occurredAt: bars[index]?.startsAt ?? new Date(0),
        sourceBarIndex: breakableLowBarIndex,
        sourcePrice: breakableLow,
      });

      if (kind === "choch") {
        signals[index] = "exit_long";
        if (
          activeRegimeDirection &&
          activeRegimeStartIndex != null &&
          activeRegimeStartIndex <= index - 1
        ) {
          closeRayReplicaRegimeWindow(
            regimeWindows,
            bars,
            activeRegimeDirection,
            activeRegimeStartIndex,
            index - 1,
          );
        }
        activeRegimeDirection = "short";
        activeRegimeStartIndex = index;
        marketStructureDirection = -1;
      }

      breakableLow = Number.NaN;
      breakableLowBarIndex = null;
    }
  }

  if (
    activeRegimeDirection &&
    activeRegimeStartIndex != null &&
    activeRegimeStartIndex <= bars.length - 1
  ) {
    closeRayReplicaRegimeWindow(
      regimeWindows,
      bars,
      activeRegimeDirection,
      activeRegimeStartIndex,
      bars.length - 1,
    );
  }

  const tape: RayReplicaSignalTape = {
    signals,
    events,
    regimeWindows,
  };
  const cacheBucket =
    rayReplicaSignalCache.get(bars) ?? new Map<string, RayReplicaSignalTape>();
  cacheBucket.set(cacheKey, tape);
  rayReplicaSignalCache.set(bars, cacheBucket);
  return tape;
}

const sharedTimeframes: BacktestTimeframe[] = ["1m", "5m", "15m", "1h", "1d"];

const trendParameterDefinitions: StrategyParameterDefinition[] = [
  {
    key: "shortWindow",
    label: "Short Window",
    type: "integer",
    defaultValue: 20,
    options: [],
    min: 2,
    max: 200,
    step: 1,
  },
  {
    key: "longWindow",
    label: "Long Window",
    type: "integer",
    defaultValue: 50,
    options: [],
    min: 5,
    max: 300,
    step: 1,
  },
];

const rayReplicaParameterDefinitions: StrategyParameterDefinition[] = [
  {
    key: "executionMode",
    label: "Execution Mode",
    type: "enum",
    defaultValue: "spot",
    options: ["spot", "options", "signal_options"],
  },
  {
    key: "contractPresetId",
    label: "Options Preset",
    type: "enum",
    defaultValue: defaultBacktestOptionPresetId,
    options: backtestOptionPresets.map((preset) => preset.id),
  },
  {
    key: "timeHorizon",
    label: "Time Horizon",
    type: "integer",
    defaultValue: 10,
    options: [],
    min: 2,
    max: 50,
    step: 1,
  },
  {
    key: "signalOptionsMinDte",
    label: "Signal Options Min DTE",
    type: "integer",
    defaultValue: defaultSignalOptionsExecutionProfile.optionSelection.minDte,
    options: [],
    min: 0,
    max: 45,
    step: 1,
  },
  {
    key: "signalOptionsMaxDte",
    label: "Signal Options Max DTE",
    type: "integer",
    defaultValue: defaultSignalOptionsExecutionProfile.optionSelection.maxDte,
    options: [],
    min: 0,
    max: 90,
    step: 1,
  },
  {
    key: "signalOptionsMaxPremium",
    label: "Signal Options Max Premium",
    type: "number",
    defaultValue: defaultSignalOptionsExecutionProfile.riskCaps.maxPremiumPerEntry,
    options: [],
    min: 1,
    max: 100000,
    step: 25,
  },
  {
    key: "signalOptionsMaxContracts",
    label: "Signal Options Max Contracts",
    type: "integer",
    defaultValue: defaultSignalOptionsExecutionProfile.riskCaps.maxContracts,
    options: [],
    min: 1,
    max: 500,
    step: 1,
  },
  {
    key: "signalOptionsMaxSpreadPct",
    label: "Signal Options Max Spread %",
    type: "number",
    defaultValue:
      defaultSignalOptionsExecutionProfile.liquidityGate.maxSpreadPctOfMid,
    options: [],
    min: 0,
    max: 500,
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
    strategyId: "ray_replica_signals",
    version: "v1",
    label: "RayReplica Signals",
    description:
      "Long-only RayReplica signal port that enters on bullish CHOCH and exits on bearish CHOCH.",
    status: "runnable",
    directionMode: "long_only",
    supportedTimeframes: sharedTimeframes,
    compatibilityNotes: [
      "Uses the current JS RayReplica market-structure port, not a full Pine executor.",
      "BUY/SELL events map to bullish and bearish CHOCH transitions.",
      "Spot mode remains the baseline path; options mode is long-premium only and uses preset contract selection.",
      "Signal-options mode shares deployment risk/liquidity defaults with the automation shadow scanner.",
      "BOS, TP/SL, filters, and short-side shares execution remain chart-only for now.",
    ],
    unsupportedFeatures: [],
    parameterDefinitions: rayReplicaParameterDefinitions,
    defaultParameters: {
      executionMode: "spot",
      contractPresetId: defaultBacktestOptionPresetId,
      timeHorizon: 10,
      signalOptionsMinDte:
        defaultSignalOptionsExecutionProfile.optionSelection.minDte,
      signalOptionsMaxDte:
        defaultSignalOptionsExecutionProfile.optionSelection.maxDte,
      signalOptionsMaxPremium:
        defaultSignalOptionsExecutionProfile.riskCaps.maxPremiumPerEntry,
      signalOptionsMaxContracts:
        defaultSignalOptionsExecutionProfile.riskCaps.maxContracts,
      signalOptionsMaxSpreadPct:
        defaultSignalOptionsExecutionProfile.liquidityGate.maxSpreadPctOfMid,
    },
    evaluate({ bars, index, parameters }) {
      const signals = buildRayReplicaSignalTape(bars, parameters).signals;
      return signals[index] ?? "hold";
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
