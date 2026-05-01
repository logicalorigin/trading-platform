import { z } from "zod";

export const backtestTimeframes = ["1m", "5m", "15m", "1h", "1d"] as const;
export type BacktestTimeframe = (typeof backtestTimeframes)[number];

export const strategyStatusValues = ["runnable", "blocked"] as const;
export type StrategyStatus = (typeof strategyStatusValues)[number];

export const strategyDirectionValues = ["long_only", "long_short"] as const;
export type StrategyDirection = (typeof strategyDirectionValues)[number];

export const optimizerModeValues = ["grid", "random", "walk_forward"] as const;
export type OptimizerMode = (typeof optimizerModeValues)[number];

export const parameterTypeValues = [
  "integer",
  "number",
  "boolean",
  "enum",
] as const;
export type StrategyParameterType = (typeof parameterTypeValues)[number];

export type ScalarParameterValue = string | number | boolean;
export type StrategyParameters = Record<string, ScalarParameterValue>;

export type StrategyParameterDefinition = {
  key: string;
  label: string;
  type: StrategyParameterType;
  defaultValue: ScalarParameterValue;
  min?: number;
  max?: number;
  step?: number;
  options?: ScalarParameterValue[];
};

export type StrategyCatalogItem = {
  strategyId: string;
  version: string;
  label: string;
  description: string;
  status: StrategyStatus;
  directionMode: StrategyDirection;
  supportedTimeframes: BacktestTimeframe[];
  compatibilityNotes: string[];
  unsupportedFeatures: string[];
  parameterDefinitions: StrategyParameterDefinition[];
  defaultParameters: StrategyParameters;
};

export type BacktestBar = {
  startsAt: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: string;
  delayed?: boolean;
};

export type PositionState = {
  symbol: string;
  entryAt: Date;
  entryIndex: number;
  entryPrice: number;
  quantity: number;
  entryValue: number;
  commissionPaid: number;
  highestPrice?: number;
  trailingStopPrice?: number | null;
};

export type ExecutionProfile = {
  commissionBps: number;
  slippageBps: number;
};

export type PortfolioRules = {
  initialCapital: number;
  positionSizePercent: number;
  maxConcurrentPositions: number;
  maxGrossExposurePercent: number;
};

export type BacktestRiskRules = {
  stopLossPercent?: number | null;
  takeProfitPercent?: number | null;
  trailingStopPercent?: number | null;
  trailingActivationPercent?: number | null;
  basis?: "position_price" | "underlying_price" | "both";
};

export type StudyDefinition = {
  strategyId: string;
  strategyVersion: string;
  symbols: string[];
  timeframe: BacktestTimeframe;
  from: Date;
  to: Date;
  parameters: StrategyParameters;
  riskRules?: BacktestRiskRules;
  executionProfile: ExecutionProfile;
  portfolioRules: PortfolioRules;
};

export type BacktestSignal = "hold" | "enter_long" | "exit_long";

export type StrategySignalContext = {
  symbol: string;
  bars: BacktestBar[];
  index: number;
  position: PositionState | null;
  parameters: StrategyParameters;
};

export type BacktestTrade = {
  symbol: string;
  side: "long";
  entryAt: Date;
  exitAt: Date;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryValue: number;
  exitValue: number;
  grossPnl: number;
  netPnl: number;
  netPnlPercent: number;
  barsHeld: number;
  commissionPaid: number;
  exitReason: string;
};

export type BacktestPoint = {
  occurredAt: Date;
  equity: number;
  cash: number;
  grossExposure: number;
  drawdownPercent: number;
};

export type BacktestMetrics = {
  netPnl: number;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  tradeCount: number;
  winRatePercent: number;
  profitFactor: number;
  sharpeRatio: number;
  returnOverMaxDrawdown: number;
  advanced?: BacktestAdvancedMetrics;
  validation?: BacktestValidationMetrics;
  dataQuality?: BacktestDataQualityMetrics;
  benchmarks?: BacktestBenchmarkMetrics[];
};

export type BacktestMonteCarloMetrics = {
  seed: number;
  sampleCount: number;
  p05ReturnPercent: number;
  p50ReturnPercent: number;
  p95ReturnPercent: number;
  probabilityOfLossPercent: number;
  p95MaxDrawdownPercent: number;
};

export type BacktestAdvancedMetrics = {
  annualizedVolatilityPercent: number;
  sortinoRatio: number;
  calmarRatio: number;
  expectancy: number;
  averageWin: number;
  averageLoss: number;
  payoffRatio: number;
  exposurePercent: number;
  turnover: number;
  maxDrawdownDurationBars: number;
  skew: number;
  excessKurtosis: number;
  probabilisticSharpeRatio: number;
  deflatedSharpeRatio: number;
  monteCarlo: BacktestMonteCarloMetrics;
};

export type BacktestValidationMetrics = {
  trialCount: number;
  oosWindowCount: number;
  parameterCount: number;
  pboProbabilityPercent: number | null;
  cpcvFoldCount: number | null;
  warnings: string[];
};

export type BacktestDataQualityMetrics = {
  sourcePolicy: string;
  primarySource: string;
  ibkrRecentCutoffMinutes: number;
  coveragePercent: number;
  missingBarCount: number;
  delayed: boolean;
  mixedSources: boolean;
};

export type BacktestBenchmarkMetrics = {
  symbol: string;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  beta: number | null;
  alphaPercent: number | null;
  correlation: number | null;
};

export type BacktestRunResult = {
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  points: BacktestPoint[];
  warnings: string[];
};

export type SweepDimension = {
  key: string;
  values: ScalarParameterValue[];
};

export type WalkForwardWindow = {
  index: number;
  trainingFrom: Date;
  trainingTo: Date;
  testFrom: Date;
  testTo: Date;
};

export const scalarParameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

export const strategyParametersSchema = z.record(scalarParameterValueSchema);

export const sweepDimensionSchema = z.object({
  key: z.string().min(1),
  values: z.array(scalarParameterValueSchema).min(1),
});

export const executionProfileSchema = z.object({
  commissionBps: z.number().min(0).max(1_000),
  slippageBps: z.number().min(0).max(1_000),
});

export const portfolioRulesSchema = z.object({
  initialCapital: z.number().positive(),
  positionSizePercent: z.number().positive().max(100),
  maxConcurrentPositions: z.number().int().positive(),
  maxGrossExposurePercent: z.number().positive().max(100),
});
