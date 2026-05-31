export type MarketBar = {
  ts?: string;
  time?: number | string | Date;
  timestamp?: number | string | Date;
  date?: string;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  vwap?: number;
  sessionVwap?: number;
  accumulatedVolume?: number;
  averageTradeSize?: number;
  source?: string;
  freshness?: string;
  marketDataMode?: string | null;
  dataUpdatedAt?: number | string | Date | null;
  ageMs?: number | null;
  delayed?: boolean;
  studyFallback?: boolean;
};

export type ChartBarStyle = {
  color?: string;
  borderColor?: string;
  wickColor?: string;
};

export type ChartBar = {
  time: number;
  ts: string;
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vwap?: number;
  sessionVwap?: number;
  accumulatedVolume?: number;
  averageTradeSize?: number;
  source?: string;
  freshness?: string | null;
  marketDataMode?: string | null;
  dataUpdatedAt?: number | string | Date | null;
  ageMs?: number | null;
  delayed?: boolean;
  color?: string;
  borderColor?: string;
  wickColor?: string;
};

export type ChartFootprintDisplayMode = "split" | "delta" | "total";

export type ChartFootprintContext = {
  symbol: string;
  assetClass: "equity" | "option";
  timeframe: string;
  providerContractId?: string | null;
  optionTicker?: string | null;
  outsideRth?: boolean;
};

export type ChartFootprintLevel = {
  price: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  totalVolume: number;
  delta: number;
  tradeCount: number;
  buyImbalance: boolean;
  sellImbalance: boolean;
};

export type ChartFootprintCandle = {
  time: string;
  endTime: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  delta: number;
  tradeCount: number;
  pocPrice: number | null;
  levels: ChartFootprintLevel[];
  complete: boolean;
  partialReason: string | null;
};

export type ChartFootprintResponse = {
  symbol: string;
  assetClass: "equity" | "option";
  timeframe: string;
  from: string;
  to: string;
  providerContractId: string | null;
  optionTicker: string | null;
  candles: ChartFootprintCandle[];
  complete: boolean;
  partialReason: string | null;
  diagnostics: {
    sourceProvider: string;
    sourcePreference: string;
    classificationMethod: string;
    classifiedVolume: number;
    unknownVolume: number;
    quoteMatchedTradeCount: number;
    tickRuleTradeCount: number;
    unknownTradeCount: number;
    tradeCount: number;
    quoteCount: number;
    bidAskCoveragePercent: number;
    minTick: number;
    minTickSource: string;
    rowSize: number;
    capped: boolean;
  };
};

export type ChartBarRange = {
  startMs: number;
  endMs: number;
};

export type ChartMarker = {
  id: string;
  time: number;
  barIndex: number;
  position: "aboveBar" | "belowBar" | "inBar";
  shape: "circle" | "square" | "arrowUp" | "arrowDown";
  color: string;
  text?: string;
  size?: number;
};

export type TradeThresholdSegment = {
  id: string;
  kind:
    | "take_profit"
    | "stop_loss"
    | "trail_arm"
    | "trail_stop"
    | "exit_trigger";
  startBarIndex: number;
  endBarIndex: number;
  value: number;
  style: "solid" | "dashed" | "dotted";
  hit?: boolean;
  label?: string;
};

export type TradeOverlay = {
  id: string;
  tradeSelectionId: string;
  symbol?: string;
  entryBarIndex: number | null;
  exitBarIndex: number | null;
  entryTs: string;
  exitTs?: string | null;
  dir: "long" | "short";
  strat: string;
  qty: number;
  pnl?: number | null;
  pnlPercent?: number | null;
  er?: string | null;
  profitable?: boolean;
  pricingMode?: "shares" | "options" | "option_history" | string | null;
  chartPriceContext: "spot" | "option";
  entryPrice?: number | null;
  exitPrice?: number | null;
  oe?: number | null;
  ep?: number | null;
  exitFill?: number | null;
  entrySpotPrice?: number | null;
  exitSpotPrice?: number | null;
  entryBasePrice?: number | null;
  exitBasePrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  trailActivationPrice?: number | null;
  lastTrailStopPrice?: number | null;
  exitTriggerPrice?: number | null;
  thresholdPath?: {
    segments: TradeThresholdSegment[];
  };
};

export type TradeMarkerGroup = {
  id: string;
  kind: "entry" | "exit";
  time: number;
  dir: "long" | "short";
  profitable?: boolean;
  barIndex: number | null;
  tradeSelectionIds: string[];
  label?: string;
};

export type TradeMarkerGroups = {
  entryGroups: TradeMarkerGroup[];
  exitGroups: TradeMarkerGroup[];
  interactionGroups: TradeMarkerGroup[];
  timeToTradeIds: Map<string, string[]>;
};

export type TradeSelectionFocus = {
  token: number;
  tradeSelectionId: string | null;
  visibleLogicalRange: { from: number; to: number } | null;
};

export type IndicatorEvent = {
  id: string;
  strategy: string;
  eventType: string;
  ts: string;
  time?: number;
  barIndex?: number;
  direction?: "long" | "short" | null;
  label?: string;
  conviction?: number | null;
  meta?: Record<string, unknown>;
};

export type IndicatorZone = {
  id: string;
  strategy: string;
  zoneType: string;
  direction?: "long" | "short";
  startTs: string;
  endTs: string;
  startBarIndex?: number;
  endBarIndex?: number;
  top: number;
  bottom: number;
  label?: string;
  meta?: Record<string, unknown>;
};

export type IndicatorWindow = {
  id: string;
  strategy: string;
  direction: "long" | "short";
  startTs: string;
  endTs: string;
  startBarIndex?: number;
  endBarIndex?: number;
  tone?: "bullish" | "bearish" | "neutral";
  conviction?: number | null;
  meta?: Record<string, unknown>;
};

export type StudyPoint = {
  time: number;
  value?: number;
  color?: string;
};

export type StudySpec = {
  key: string;
  seriesType: "line" | "histogram";
  paneIndex: number;
  paneKey?: string;
  renderMode?: "default" | "line_breaks";
  options: Record<string, unknown>;
  data: StudyPoint[];
};

export type IndicatorPluginInput = {
  chartBars: ChartBar[];
  chartBarRanges: ChartBarRange[];
  rawBars: MarketBar[];
  dailyBars?: MarketBar[];
  settings?: Record<string, unknown>;
  timeframe: string;
  selectedIndicators: string[];
  sourceSeries?: IndicatorPluginSourceSeries[];
};

export type IndicatorSourceSeriesInput = {
  id: string;
  timeframe: string;
  sourceTimeframe: string;
  bars: MarketBar[];
};

export type IndicatorPluginSourceSeries = {
  id: string;
  timeframe: string;
  sourceTimeframe: string;
  chartBars: ChartBar[];
  chartBarRanges: ChartBarRange[];
  rawBars: MarketBar[];
};

export type IndicatorPluginOutput = {
  studySpecs?: StudySpec[];
  markers?: ChartMarker[];
  events?: IndicatorEvent[];
  zones?: IndicatorZone[];
  windows?: IndicatorWindow[];
  barStyleByIndex?: Array<ChartBarStyle | null>;
};

export type IndicatorPlugin = {
  id: string;
  liveUpdateMode?: "recompute" | "defer-on-tail-patch";
  compute(input: IndicatorPluginInput): IndicatorPluginOutput;
};

export type IndicatorRegistry = Record<string, IndicatorPlugin>;

export type IndicatorCatalogEntry = {
  id: string;
  label: string;
  kind?: "built_in" | "pine";
  paneType?: "price" | "lower";
  description?: string;
};

export type ChartModel = {
  chartBars: ChartBar[];
  chartBarRanges: ChartBarRange[];
  tradeOverlays: TradeOverlay[];
  tradeMarkerGroups: TradeMarkerGroups;
  studySpecs: StudySpec[];
  studyVisibility: Record<string, boolean>;
  studyLowerPaneCount: number;
  indicatorEvents: IndicatorEvent[];
  indicatorZones: IndicatorZone[];
  indicatorWindows: IndicatorWindow[];
  indicatorMarkerPayload: {
    overviewMarkers: ChartMarker[];
    markersByTradeId: Record<string, ChartMarker[]>;
    timeToTradeIds: Map<string, string[]>;
  };
  activeTradeSelectionId?: string | null;
  selectionFocus?: TradeSelectionFocus | null;
  defaultVisibleLogicalRange?: { from: number; to: number } | null;
};

export type BuildChartModelInput = {
  bars: MarketBar[];
  dailyBars?: MarketBar[];
  timeframe: string;
  defaultVisibleBarCount?: number;
  selectedIndicators?: string[];
  indicatorSettings?: Record<string, Record<string, unknown>>;
  indicatorMarkers?: ChartMarker[];
  indicatorSourceSeries?: IndicatorSourceSeriesInput[];
  indicatorRegistry?: IndicatorRegistry;
};
