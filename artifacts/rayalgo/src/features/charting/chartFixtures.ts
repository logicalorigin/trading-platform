import { buildResearchChartModel } from "./model";
import type {
  BuildChartModelInput,
  ChartMarker,
  ChartModel,
  IndicatorWindow,
  IndicatorZone,
  MarketBar,
} from "./types";
import { RAY_REPLICA_PINE_SCRIPT_KEY } from "./rayReplicaPineAdapter";

export type ChartParityScenarioId =
  | "core"
  | "panes"
  | "history"
  | "sparse"
  | "rayreplica"
  | "empty";

export type ChartParityScenario = {
  id: ChartParityScenarioId;
  label: string;
  description: string;
  timeframe: string;
  bars: MarketBar[];
  selectedIndicators: string[];
  indicatorMarkers: ChartMarker[];
  indicatorWindows: IndicatorWindow[];
  indicatorZones: IndicatorZone[];
};

type ChartParityFixtureProfile = {
  seed: number;
  basePrice: number;
  amplitude: number;
  trendPerBar: number;
  markerSeed: number;
  includeOverlays?: boolean;
  countByTimeframe: Record<string, number>;
};

const timeframeToStepMs = (timeframe: string): number => (
  ({
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "1d": 86_400_000,
  }[timeframe] || 300_000)
);

const createRng = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
};

const buildFixtureBars = ({
  seed,
  count,
  timeframe,
  startMs,
  basePrice,
  amplitude,
  trendPerBar,
}: {
  seed: number;
  count: number;
  timeframe: string;
  startMs: number;
  basePrice: number;
  amplitude: number;
  trendPerBar: number;
}): MarketBar[] => {
  const rng = createRng(seed);
  const stepMs = timeframeToStepMs(timeframe);
  const bars: MarketBar[] = [];
  let previousClose = basePrice;
  let accumulatedVolume = 0;
  let cumulativeVwapValue = 0;
  let cumulativeVwapVolume = 0;

  for (let index = 0; index < count; index += 1) {
    const ts = startMs + (stepMs * index);
    const cyclical = (Math.sin(index / 8) * amplitude) + (Math.cos(index / 19) * amplitude * 0.7);
    const trend = trendPerBar * index;
    const noise = (rng() - 0.5) * amplitude * 0.75;
    const open = previousClose + ((rng() - 0.5) * amplitude * 0.35);
    const close = basePrice + trend + cyclical + noise;
    const high = Math.max(open, close) + ((0.15 + rng()) * amplitude * 0.4);
    const low = Math.min(open, close) - ((0.15 + rng()) * amplitude * 0.4);
    const volume = Math.max(25_000, Math.round(
      (110_000 + Math.sin(index / 6) * 42_000 + rng() * 55_000) * (1 + Math.abs(close - open) / Math.max(1, amplitude * 2)),
    ));
    const vwap = Number((((high + low + close) / 3)).toFixed(4));

    accumulatedVolume += volume;
    cumulativeVwapValue += vwap * volume;
    cumulativeVwapVolume += volume;

    bars.push({
      timestamp: new Date(ts),
      ts: new Date(ts).toISOString(),
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume,
      vwap,
      sessionVwap: Number((cumulativeVwapValue / Math.max(1, cumulativeVwapVolume)).toFixed(4)),
      accumulatedVolume,
      averageTradeSize: Math.max(45, Math.round(volume / (70 + Math.round(rng() * 120)))),
      source: "chart-parity-fixture",
    });

    previousClose = close;
  }

  return bars;
};

const buildFixtureMarkers = (bars: MarketBar[], seed: number): ChartMarker[] => {
  const rng = createRng(seed);
  const markers: ChartMarker[] = [];
  const steps = [18, 43, 71, 104, 132];

  steps.forEach((barIndex, index) => {
    const bar = bars[barIndex];
    const timeValue = bar?.timestamp instanceof Date
      ? Math.floor(bar.timestamp.getTime() / 1000)
      : typeof bar?.time === "number"
        ? Math.floor(bar.time)
        : null;

    if (!timeValue) {
      return;
    }

    const bullish = rng() > 0.45;
    markers.push({
      id: `fixture-marker-${index}-${timeValue}`,
      time: timeValue,
      barIndex,
      position: bullish ? "belowBar" : "aboveBar",
      shape: bullish ? "arrowUp" : "arrowDown",
      color: bullish ? "#10b981" : "#ef4444",
      text: index % 2 === 0 ? "S" : "",
      size: 1.1,
    });
  });

  return markers;
};

const buildFixtureWindows = (bars: MarketBar[]): IndicatorWindow[] => {
  if (bars.length < 80) {
    return [];
  }

  const windowAStart = bars[16]?.ts;
  const windowAEnd = bars[42]?.ts;
  const windowBStart = bars[78]?.ts;
  const windowBEnd = bars[116]?.ts;

  return [
    {
      id: "fixture-window-bull",
      strategy: "fixture",
      direction: "long",
      startTs: windowAStart || bars[0]?.ts || "",
      endTs: windowAEnd || bars[Math.min(42, bars.length - 1)]?.ts || "",
      tone: "bullish",
      conviction: 74,
      meta: { label: "trend expansion" },
    },
    {
      id: "fixture-window-bear",
      strategy: "fixture",
      direction: "short",
      startTs: windowBStart || bars[0]?.ts || "",
      endTs: windowBEnd || bars[Math.min(116, bars.length - 1)]?.ts || "",
      tone: "bearish",
      conviction: 63,
      meta: { label: "pullback" },
    },
  ];
};

const buildFixtureZones = (bars: MarketBar[]): IndicatorZone[] => {
  if (bars.length < 96) {
    return [];
  }

  const anchorA = bars[24];
  const anchorB = bars[88];
  const anchorC = bars[112];

  if (!anchorA || !anchorB || !anchorC) {
    return [];
  }

  const anchorAClose: number = typeof anchorA.close === "number" && Number.isFinite(anchorA.close)
    ? anchorA.close
    : typeof anchorA.open === "number" && Number.isFinite(anchorA.open)
      ? anchorA.open
      : 0;
  const anchorBClose: number = typeof anchorB.close === "number" && Number.isFinite(anchorB.close)
    ? anchorB.close
    : typeof anchorB.open === "number" && Number.isFinite(anchorB.open)
      ? anchorB.open
      : 0;

  return [
    {
      id: "fixture-zone-demand",
      strategy: "fixture",
      zoneType: "demand",
      direction: "long",
      startTs: anchorA.ts || "",
      endTs: anchorB.ts || "",
      top: Number((anchorAClose * 0.998).toFixed(4)),
      bottom: Number((anchorAClose * 0.989).toFixed(4)),
      label: "demand",
    },
    {
      id: "fixture-zone-supply",
      strategy: "fixture",
      zoneType: "supply",
      direction: "short",
      startTs: anchorB.ts || "",
      endTs: anchorC.ts || "",
      top: Number((anchorBClose * 1.014).toFixed(4)),
      bottom: Number((anchorBClose * 1.006).toFixed(4)),
      label: "supply",
    },
  ];
};

const buildScenario = (
  scenario: Omit<ChartParityScenario, "indicatorMarkers" | "indicatorWindows" | "indicatorZones"> & {
    markerSeed: number;
    includeOverlays?: boolean;
  },
): ChartParityScenario => ({
  ...scenario,
  indicatorMarkers: buildFixtureMarkers(scenario.bars, scenario.markerSeed),
  indicatorWindows: scenario.includeOverlays ? buildFixtureWindows(scenario.bars) : [],
  indicatorZones: scenario.includeOverlays ? buildFixtureZones(scenario.bars) : [],
});

const baseStartMs = Date.UTC(2026, 3, 17, 13, 30, 0);
const fixtureEndAnchorMs = Date.UTC(2026, 3, 22, 20, 0, 0);

const normalizeParityTimeframe = (timeframe: string): string => (
  timeframe === "1D" ? "1d" : timeframe
);

const chartParityFixtureProfiles: Partial<Record<ChartParityScenarioId, ChartParityFixtureProfile>> = {
  core: {
    seed: 41,
    basePrice: 182.4,
    amplitude: 3.8,
    trendPerBar: 0.028,
    markerSeed: 101,
    includeOverlays: true,
    countByTimeframe: {
      "1m": 300,
      "5m": 156,
      "15m": 120,
      "1h": 72,
      "1d": 90,
    },
  },
  panes: {
    seed: 57,
    basePrice: 247.8,
    amplitude: 4.6,
    trendPerBar: 0.034,
    markerSeed: 222,
    includeOverlays: false,
    countByTimeframe: {
      "1m": 300,
      "5m": 168,
      "15m": 120,
      "1h": 72,
      "1d": 90,
    },
  },
  history: {
    seed: 73,
    basePrice: 411.2,
    amplitude: 7.2,
    trendPerBar: 0.052,
    markerSeed: 303,
    includeOverlays: true,
    countByTimeframe: {
      "1m": 480,
      "5m": 320,
      "15m": 320,
      "1h": 160,
      "1d": 120,
    },
  },
  sparse: {
    seed: 91,
    basePrice: 94.8,
    amplitude: 2.7,
    trendPerBar: -0.013,
    markerSeed: 404,
    includeOverlays: false,
    countByTimeframe: {
      "1m": 90,
      "5m": 72,
      "15m": 56,
      "1h": 36,
      "1d": 30,
    },
  },
  rayreplica: {
    seed: 113,
    basePrice: 138.4,
    amplitude: 5.4,
    trendPerBar: 0.031,
    markerSeed: 505,
    includeOverlays: false,
    countByTimeframe: {
      "1m": 360,
      "5m": 220,
      "15m": 180,
      "1h": 96,
      "1d": 90,
    },
  },
};

const buildScenarioBarsForTimeframe = (
  scenarioId: ChartParityScenarioId,
  timeframe: string,
): MarketBar[] => {
  const profile = chartParityFixtureProfiles[scenarioId];
  if (!profile) {
    return [];
  }

  const normalizedTimeframe = normalizeParityTimeframe(timeframe);
  const count = profile.countByTimeframe[normalizedTimeframe] || profile.countByTimeframe["5m"] || 156;
  const stepMs = timeframeToStepMs(normalizedTimeframe);

  return buildFixtureBars({
    seed: profile.seed,
    count,
    timeframe: normalizedTimeframe,
    startMs: fixtureEndAnchorMs - (stepMs * count),
    basePrice: profile.basePrice,
    amplitude: profile.amplitude,
    trendPerBar: profile.trendPerBar,
  });
};

export const chartParityScenarios: ChartParityScenario[] = [
  buildScenario({
    id: "core",
    label: "Core",
    description: "Intraday candles, volume, and price-pane studies for frame comparison.",
    timeframe: "5m",
    bars: buildFixtureBars({
      seed: 41,
      count: 156,
      timeframe: "5m",
      startMs: baseStartMs,
      basePrice: 182.4,
      amplitude: 3.8,
      trendPerBar: 0.028,
    }),
    selectedIndicators: ["ema-21", "ema-55", "vwap"],
    markerSeed: 101,
    includeOverlays: true,
  }),
  buildScenario({
    id: "panes",
    label: "Panes",
    description: "Price-pane studies plus lower-pane RSI and MACD to verify pane behavior.",
    timeframe: "5m",
    bars: buildFixtureBars({
      seed: 57,
      count: 168,
      timeframe: "5m",
      startMs: baseStartMs,
      basePrice: 247.8,
      amplitude: 4.6,
      trendPerBar: 0.034,
    }),
    selectedIndicators: ["ema-21", "ema-55", "vwap", "rsi-14", "macd-12-26-9"],
    markerSeed: 222,
    includeOverlays: false,
  }),
  buildScenario({
    id: "history",
    label: "History",
    description: "Longer history for fit/reset/realtime behavior and dense timescale rendering.",
    timeframe: "15m",
    bars: buildFixtureBars({
      seed: 73,
      count: 320,
      timeframe: "15m",
      startMs: baseStartMs - (timeframeToStepMs("15m") * 240),
      basePrice: 411.2,
      amplitude: 7.2,
      trendPerBar: 0.052,
    }),
    selectedIndicators: ["ema-21", "bb-20", "vwap"],
    markerSeed: 303,
    includeOverlays: true,
  }),
  buildScenario({
    id: "sparse",
    label: "Sparse",
    description: "Shorter sparse dataset to validate compact spacing and placeholder resilience.",
    timeframe: "1h",
    bars: buildFixtureBars({
      seed: 91,
      count: 36,
      timeframe: "1h",
      startMs: baseStartMs - (timeframeToStepMs("1h") * 36),
      basePrice: 94.8,
      amplitude: 2.7,
      trendPerBar: -0.013,
    }),
    selectedIndicators: ["ema-21"],
    markerSeed: 404,
    includeOverlays: false,
  }),
  {
    id: "rayreplica",
    label: "RayReplica",
    description: "Deterministic fixture for the real RayReplica runtime, dashboard, and settings surface.",
    timeframe: "5m",
    bars: buildFixtureBars({
      seed: 113,
      count: 220,
      timeframe: "5m",
      startMs: baseStartMs - (timeframeToStepMs("5m") * 160),
      basePrice: 138.4,
      amplitude: 5.4,
      trendPerBar: 0.031,
    }),
    selectedIndicators: [RAY_REPLICA_PINE_SCRIPT_KEY],
    indicatorMarkers: [],
    indicatorWindows: [],
    indicatorZones: [],
  },
  {
    id: "empty",
    label: "Empty",
    description: "No bars available to validate empty chart states and shell stability.",
    timeframe: "5m",
    bars: [],
    selectedIndicators: ["ema-21", "rsi-14"],
    indicatorMarkers: [],
    indicatorWindows: [],
    indicatorZones: [],
  },
];

export const getChartParityScenario = (scenarioId: string | null | undefined): ChartParityScenario => (
  chartParityScenarios.find((scenario) => scenario.id === scenarioId) || chartParityScenarios[0]
);

export const buildChartParityModel = (
  scenario: ChartParityScenario,
  options?: {
    timeframe?: string;
    selectedIndicators?: string[];
    indicatorSettings?: Record<string, Record<string, unknown>>;
    indicatorRegistry?: BuildChartModelInput["indicatorRegistry"];
  },
): ChartModel => {
  const timeframe = normalizeParityTimeframe(options?.timeframe || scenario.timeframe);
  const selectedIndicators = options?.selectedIndicators || scenario.selectedIndicators;
  const profile = chartParityFixtureProfiles[scenario.id];
  const bars = profile ? buildScenarioBarsForTimeframe(scenario.id, timeframe) : scenario.bars;
  const indicatorMarkers =
    profile && scenario.id !== "rayreplica"
      ? buildFixtureMarkers(bars, profile.markerSeed)
      : scenario.indicatorMarkers;
  const indicatorWindows = profile && profile.includeOverlays ? buildFixtureWindows(bars) : scenario.indicatorWindows;
  const indicatorZones = profile && profile.includeOverlays ? buildFixtureZones(bars) : scenario.indicatorZones;
  const model = buildResearchChartModel({
    bars,
    timeframe,
    selectedIndicators,
    indicatorSettings: options?.indicatorSettings,
    indicatorRegistry: options?.indicatorRegistry,
    indicatorMarkers,
  });

  return {
    ...model,
    indicatorWindows,
    indicatorZones,
  };
};
