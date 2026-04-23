import type { PineScriptRecord } from "@workspace/api-client-react";
import {
  aggregateRayReplicaBarsForTimeframe,
  computeRayReplicaVolatilityScore,
  computeRayReplicaWma,
  evaluateRayReplicaSignals,
  resolveRayReplicaSessionLabel,
  resolveRayReplicaSessionKey,
  resolveRayReplicaTrendDirection,
  type RayReplicaSessionOption as CoreRayReplicaSessionOption,
} from "@workspace/rayreplica-core";
import type {
  ChartBar,
  ChartBarStyle,
  ChartMarker,
  IndicatorEvent,
  IndicatorPlugin,
  IndicatorPluginOutput,
  IndicatorWindow,
  IndicatorZone,
  MarketBar,
  StudyPoint,
  StudySpec,
} from "./types";

export const RAY_REPLICA_PINE_SCRIPT_KEY = "rayalgo-replica-smc-pro-v3";

export type RayReplicaBosConfirmation = "close" | "wicks";
export type RayReplicaLineStyle = "solid" | "dashed" | "dotted";
export type RayReplicaLabelSize = "tiny" | "small" | "normal";
export type RayReplicaTimeframeOption =
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "D";
export type RayReplicaDashboardPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";
export type RayReplicaDashboardSize = "tiny" | "small" | "normal" | "large";
export type RayReplicaPlotKey =
  | "bullMain"
  | "bearMain"
  | "bullWire1"
  | "bullWire2"
  | "bullWire3"
  | "bearWire1"
  | "bearWire2"
  | "bearWire3"
  | "shadowUpper"
  | "shadowLower";
export type RayReplicaPlotOverride = {
  visible?: boolean;
  color?: string;
  lineWidth?: number;
};
export type RayReplicaSessionOption =
  | "new_york"
  | "tokyo"
  | "sydney"
  | "asia"
  | "london"
  | "new_york_am"
  | "new_york_pm";

export type RayReplicaRuntimeSettings = {
  timeHorizon: number;
  structureLineStyle: RayReplicaLineStyle;
  bosConfirmation: RayReplicaBosConfirmation;
  chochAtrBuffer: number;
  chochBodyExpansionAtr: number;
  chochVolumeGate: number;
  basisLength: number;
  atrLength: number;
  atrSmoothing: number;
  volatilityMultiplier: number;
  wireSpread: number;
  shadowLength: number;
  shadowStdDev: number;
  adxLength: number;
  volumeMaLength: number;
  mtf1: RayReplicaTimeframeOption;
  mtf2: RayReplicaTimeframeOption;
  mtf3: RayReplicaTimeframeOption;
  requireMtf1: boolean;
  requireMtf2: boolean;
  requireMtf3: boolean;
  signalFiltersEnabled: boolean;
  requireAdx: boolean;
  adxMin: number;
  requireVolScoreRange: boolean;
  volScoreMin: number;
  volScoreMax: number;
  restrictToSelectedSessions: boolean;
  sessions: RayReplicaSessionOption[];
  signalOffsetAtr: number;
  tp1Rr: number;
  tp2Rr: number;
  tp3Rr: number;
  dashboardPosition: RayReplicaDashboardPosition;
  dashboardSize: RayReplicaDashboardSize;
  showWires: boolean;
  showShadow: boolean;
  showKeyLevels: boolean;
  showStructure: boolean;
  showBos: boolean;
  showChoch: boolean;
  showSwings: boolean;
  showTrendReversal: boolean;
  showOrderBlocks: boolean;
  showSupportResistance: boolean;
  showTpSl: boolean;
  showDashboard: boolean;
  showRegimeWindows: boolean;
  colorCandles: boolean;
  waitForBarClose: boolean;
  trendReversalLengthBars: number;
  trendReversalLineColor: string;
  trendReversalTextColor: string;
  orderBlockMaxActivePerSide: number;
  supportResistancePivotStrength: number;
  supportResistanceMinZoneDistancePercent: number;
  supportResistanceThicknessMultiplier: number;
  supportResistanceMaxZones: number;
  supportResistanceExtensionBars: number;
  keyLevelLineStyle: RayReplicaLineStyle;
  keyLevelLabelSize: RayReplicaLabelSize;
  keyLevelLabelOffsetBars: number;
  showPriorDayHigh: boolean;
  showPriorDayLow: boolean;
  showPriorDayClose: boolean;
  showTodayOpen: boolean;
  showPriorWeekHigh: boolean;
  showPriorWeekLow: boolean;
  bullColor: string;
  bearColor: string;
  orderBlockBullColor: string;
  orderBlockBearColor: string;
  supportZoneColor: string;
  resistanceZoneColor: string;
  keyLevelHighColor: string;
  keyLevelLowColor: string;
  keyLevelCloseColor: string;
  keyLevelOpenColor: string;
  shadowColor: string;
  filteredCandleColor: string;
  showLondonSession: boolean;
  showNewYorkSession: boolean;
  showTokyoSession: boolean;
  showSydneySession: boolean;
  visibleTimeframes: RayReplicaTimeframeOption[];
  showLastBarOnly: boolean;
  plotOverrides: Partial<Record<RayReplicaPlotKey, RayReplicaPlotOverride>>;
};

export const DEFAULT_RAY_REPLICA_SETTINGS: RayReplicaRuntimeSettings = {
  timeHorizon: 10,
  structureLineStyle: "solid",
  bosConfirmation: "close",
  chochAtrBuffer: 0,
  chochBodyExpansionAtr: 0,
  chochVolumeGate: 0,
  basisLength: 80,
  atrLength: 14,
  atrSmoothing: 21,
  volatilityMultiplier: 2,
  wireSpread: 0.5,
  shadowLength: 20,
  shadowStdDev: 2,
  adxLength: 14,
  volumeMaLength: 20,
  mtf1: "1h",
  mtf2: "4h",
  mtf3: "D",
  requireMtf1: false,
  requireMtf2: false,
  requireMtf3: false,
  signalFiltersEnabled: false,
  requireAdx: false,
  adxMin: 20,
  requireVolScoreRange: false,
  volScoreMin: 2,
  volScoreMax: 10,
  restrictToSelectedSessions: false,
  sessions: [],
  signalOffsetAtr: 1.5,
  tp1Rr: 0.5,
  tp2Rr: 1,
  tp3Rr: 1.7,
  dashboardPosition: "bottom-right",
  dashboardSize: "small",
  showWires: true,
  showShadow: true,
  showKeyLevels: true,
  showStructure: true,
  showBos: true,
  showChoch: true,
  showSwings: true,
  showTrendReversal: true,
  showOrderBlocks: true,
  showSupportResistance: false,
  showTpSl: true,
  showDashboard: true,
  showRegimeWindows: true,
  colorCandles: true,
  waitForBarClose: true,
  trendReversalLengthBars: 30,
  trendReversalLineColor: "#ffffffbf",
  trendReversalTextColor: "#ffffff",
  orderBlockMaxActivePerSide: 5,
  supportResistancePivotStrength: 15,
  supportResistanceMinZoneDistancePercent: 0.05,
  supportResistanceThicknessMultiplier: 0.25,
  supportResistanceMaxZones: 7,
  supportResistanceExtensionBars: 100,
  keyLevelLineStyle: "dashed",
  keyLevelLabelSize: "small",
  keyLevelLabelOffsetBars: 8,
  showPriorDayHigh: true,
  showPriorDayLow: true,
  showPriorDayClose: true,
  showTodayOpen: true,
  showPriorWeekHigh: true,
  showPriorWeekLow: true,
  bullColor: "#00bcd4",
  bearColor: "#e91e63",
  orderBlockBullColor: "#00bcd433",
  orderBlockBearColor: "#e91e6333",
  supportZoneColor: "#00bcd440",
  resistanceZoneColor: "#e91e6340",
  keyLevelHighColor: "#ef5350",
  keyLevelLowColor: "#26a69a",
  keyLevelCloseColor: "#9ca3af",
  keyLevelOpenColor: "#facc15",
  shadowColor: "#787b86e6",
  filteredCandleColor: "#787b86",
  showLondonSession: false,
  showNewYorkSession: false,
  showTokyoSession: false,
  showSydneySession: false,
  visibleTimeframes: [],
  showLastBarOnly: false,
  plotOverrides: {},
};
const REACTION_COLOR = "#facc15";
const STOP_LOSS_COLOR = "#ef4444";
const TAKE_PROFIT_COLOR = "#22c55e";
const TREND_REVERSAL_LINE_STYLE = "dashed";
const TP_SL_LINE_STYLE = "dashed";
export const RAY_REPLICA_TIME_HORIZON_OPTIONS = [2, 4, 6, 8, 10, 15, 20] as const;
export const RAY_REPLICA_LINE_STYLE_OPTIONS: ReadonlyArray<RayReplicaLineStyle> = [
  "solid",
  "dashed",
  "dotted",
];
export const RAY_REPLICA_LABEL_SIZE_OPTIONS: ReadonlyArray<RayReplicaLabelSize> = [
  "tiny",
  "small",
  "normal",
];
export const RAY_REPLICA_MTF_OPTIONS: ReadonlyArray<RayReplicaTimeframeOption> = [
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "D",
];
export const RAY_REPLICA_BOS_CONFIRMATION_OPTIONS: ReadonlyArray<RayReplicaBosConfirmation> =
  ["close", "wicks"];
export const RAY_REPLICA_DASHBOARD_POSITION_OPTIONS: ReadonlyArray<RayReplicaDashboardPosition> =
  ["top-left", "top-right", "bottom-left", "bottom-right"];
export const RAY_REPLICA_DASHBOARD_SIZE_OPTIONS: ReadonlyArray<RayReplicaDashboardSize> =
  ["tiny", "small", "normal", "large"];
export const RAY_REPLICA_SESSION_OPTIONS: ReadonlyArray<{
  value: RayReplicaSessionOption;
  label: string;
}> = [
  { value: "london", label: "London" },
  { value: "new_york", label: "New York" },
  { value: "tokyo", label: "Tokyo" },
  { value: "sydney", label: "Sydney" },
];
export const RAY_REPLICA_PLOT_KEYS: ReadonlyArray<RayReplicaPlotKey> = [
  "bullMain",
  "bearMain",
  "bullWire1",
  "bullWire2",
  "bullWire3",
  "bearWire1",
  "bearWire2",
  "bearWire3",
  "shadowUpper",
  "shadowLower",
];
export const RAY_REPLICA_BAND_PROFILE_OPTIONS = [
  {
    value: "classic",
    label: "Classic",
    settings: {
      basisLength: 100,
      atrLength: 14,
      atrSmoothing: 21,
      volatilityMultiplier: 2,
    },
  },
  {
    value: "balanced",
    label: "Balanced",
    settings: {
      basisLength: 21,
      atrLength: 14,
      atrSmoothing: 14,
      volatilityMultiplier: 1.5,
    },
  },
  {
    value: "tight",
    label: "Tight",
    settings: {
      basisLength: 13,
      atrLength: 10,
      atrSmoothing: 10,
      volatilityMultiplier: 1.15,
    },
  },
  {
    value: "wide",
    label: "Wide",
    settings: {
      basisLength: 34,
      atrLength: 21,
      atrSmoothing: 21,
      volatilityMultiplier: 2.1,
    },
  },
] as const;

type RayReplicaNormalizedSettings = {
  marketStructure: {
    timeHorizon: number;
    structureLineStyle: RayReplicaLineStyle;
    bosConfirmation: RayReplicaBosConfirmation;
    chochAtrBuffer: number;
    chochBodyExpansionAtr: number;
    chochVolumeGate: number;
    showBos: boolean;
    showChoch: boolean;
    showSwings: boolean;
    showTrendReversal: boolean;
    trendReversalLengthBars: number;
    trendReversalLineColor: string;
    trendReversalTextColor: string;
  };
  bands: {
    basisLength: number;
    atrLength: number;
    atrSmoothing: number;
    volatilityMultiplier: number;
  };
  confirmation: {
    adxLength: number;
    volumeMaLength: number;
    mtf1: RayReplicaTimeframeOption;
    mtf2: RayReplicaTimeframeOption;
    mtf3: RayReplicaTimeframeOption;
    requireMtf1: boolean;
    requireMtf2: boolean;
    requireMtf3: boolean;
    signalFiltersEnabled: boolean;
    requireAdx: boolean;
    adxMin: number;
    requireVolScoreRange: boolean;
    volScoreMin: number;
    volScoreMax: number;
    restrictToSelectedSessions: boolean;
    sessions: RayReplicaSessionOption[];
  };
  infoPanel: {
    visible: boolean;
    position: RayReplicaDashboardPosition;
    size: RayReplicaDashboardSize;
  };
  risk: {
    showTpSl: boolean;
    tp1Rr: number;
    tp2Rr: number;
    tp3Rr: number;
    signalOffsetAtr: number;
  };
  appearance: {
    waitForBarClose: boolean;
    showWires: boolean;
    showShadow: boolean;
    showKeyLevels: boolean;
    showStructure: boolean;
    showOrderBlocks: boolean;
    showSupportResistance: boolean;
    showDashboard: boolean;
    showRegimeWindows: boolean;
    colorCandles: boolean;
    bullColor: string;
    bearColor: string;
    orderBlockBullColor: string;
    orderBlockBearColor: string;
    supportZoneColor: string;
    resistanceZoneColor: string;
    keyLevelHighColor: string;
    keyLevelLowColor: string;
    keyLevelCloseColor: string;
    keyLevelOpenColor: string;
    shadowColor: string;
    filteredCandleColor: string;
  };
  sessionDisplay: {
    showLondonSession: boolean;
    showNewYorkSession: boolean;
    showTokyoSession: boolean;
    showSydneySession: boolean;
  };
  visibility: {
    visibleTimeframes: RayReplicaTimeframeOption[];
    showLastBarOnly: boolean;
  };
  plotStyle: {
    plotOverrides: Partial<Record<RayReplicaPlotKey, RayReplicaPlotOverride>>;
  };
  keyLevels: {
    showPriorDayHigh: boolean;
    showPriorDayLow: boolean;
    showPriorDayClose: boolean;
    showTodayOpen: boolean;
    showPriorWeekHigh: boolean;
    showPriorWeekLow: boolean;
    lineStyle: RayReplicaLineStyle;
    labelSize: RayReplicaLabelSize;
    labelOffsetBars: number;
  };
  orderBlocks: {
    maxActivePerSide: number;
  };
  supportResistance: {
    pivotStrength: number;
    minZoneDistancePercent: number;
    thicknessMultiplier: number;
    maxZones: number;
    extensionBars: number;
  };
  overlays: {
    wireSpread: number;
    shadowLength: number;
    shadowStdDev: number;
  };
};

const resolveIntegerSetting = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(resolved)));
};

const resolveFloatSetting = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, resolved));
};

const resolveBooleanSetting = (
  value: unknown,
  fallback: boolean,
): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
};

const resolveEnumSetting = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => {
  const resolved = String(value || "").trim() as T;
  return allowed.includes(resolved) ? resolved : fallback;
};

const resolveColorSetting = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }

  const resolved = value.trim();
  if (!resolved) {
    return fallback;
  }

  return resolved;
};

const resolveSessionSelections = (
  value: unknown,
  fallback: RayReplicaSessionOption[],
): RayReplicaSessionOption[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const allowed = new Set(
    RAY_REPLICA_SESSION_OPTIONS.map((option) => option.value),
  );
  const sessions = value.reduce<RayReplicaSessionOption[]>((acc, entry) => {
    const resolved = String(entry || "").trim() as RayReplicaSessionOption;
    if (!allowed.has(resolved) || acc.includes(resolved)) {
      return acc;
    }
    acc.push(resolved);
    return acc;
  }, []);

  return sessions.length ? sessions : [...fallback];
};

const resolveVisibleTimeframeSelections = (
  value: unknown,
  fallback: RayReplicaTimeframeOption[],
): RayReplicaTimeframeOption[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const allowed = new Set(RAY_REPLICA_MTF_OPTIONS);
  const timeframes = value.reduce<RayReplicaTimeframeOption[]>(
    (acc, entry) => {
      const resolved = String(entry || "").trim() as RayReplicaTimeframeOption;
      if (!allowed.has(resolved) || acc.includes(resolved)) {
        return acc;
      }
      acc.push(resolved);
      return acc;
    },
    [],
  );

  return timeframes;
};

const resolvePlotOverrides = (
  value: unknown,
): Partial<Record<RayReplicaPlotKey, RayReplicaPlotOverride>> => {
  const input = asRecord(value);
  return RAY_REPLICA_PLOT_KEYS.reduce<
    Partial<Record<RayReplicaPlotKey, RayReplicaPlotOverride>>
  >((overrides, key) => {
    const rawOverride = asRecord(input[key]);
    const visible =
      typeof rawOverride.visible === "boolean" ? rawOverride.visible : undefined;
    const color =
      typeof rawOverride.color === "string" && rawOverride.color.trim()
        ? rawOverride.color.trim()
        : undefined;
    const lineWidth = Number(rawOverride.lineWidth);

    if (
      visible === undefined &&
      color === undefined &&
      !Number.isFinite(lineWidth)
    ) {
      return overrides;
    }

    overrides[key] = {
      ...(visible !== undefined ? { visible } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(Number.isFinite(lineWidth)
        ? { lineWidth: Math.min(8, Math.max(1, Math.round(lineWidth))) }
        : {}),
    };
    return overrides;
  }, {});
};

const resolveVolScoreSetting = (
  value: unknown,
  fallback: number,
): number => {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) {
    return fallback;
  }

  const normalized = resolved > 10 ? resolved / 10 : resolved;
  return Number(Math.max(0, Math.min(10, normalized)).toFixed(1));
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const resolveDashboardPositionSetting = (
  value: unknown,
  fallback: RayReplicaDashboardPosition,
): RayReplicaDashboardPosition => {
  if (value === "top_left") {
    return "top-left";
  }
  if (value === "top_right") {
    return "top-right";
  }
  if (value === "bottom_left") {
    return "bottom-left";
  }
  if (value === "bottom_right") {
    return "bottom-right";
  }

  return resolveEnumSetting(
    value,
    RAY_REPLICA_DASHBOARD_POSITION_OPTIONS,
    fallback,
  );
};

const resolveDashboardSizeSetting = (
  value: unknown,
  fallback: RayReplicaDashboardSize,
): RayReplicaDashboardSize => {
  if (value === "compact") {
    return "small";
  }
  if (value === "expanded") {
    return "large";
  }

  return resolveEnumSetting(value, RAY_REPLICA_DASHBOARD_SIZE_OPTIONS, fallback);
};

const withHexAlpha = (color: string, alpha: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;

const resolveSolidHexColor = (color: string, fallback: string): string =>
  /^#[0-9a-fA-F]{6}/.test(color) ? color.slice(0, 7) : fallback;

const formatOverlayPrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const fixed = value.toFixed(Math.abs(value) >= 100 ? 2 : 4);
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

const formatCompactVolume = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "")}B`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(2).replace(/\.?0+$/, "")}K`;
  }

  return value.toFixed(0);
};

function normalizeRayReplicaSettings(
  settings?: Record<string, unknown>,
): RayReplicaNormalizedSettings {
  const input = settings ?? {};
  const marketStructure = asRecord(input.marketStructure);
  const trendReversal = asRecord(input.trendReversal);
  const bands = asRecord(input.bands);
  const confirmation = asRecord(input.confirmation);
  const infoPanel = asRecord(input.infoPanel);
  const risk = asRecord(input.risk);
  const appearance = asRecord(input.appearance);
  const sessionDisplay = asRecord(input.sessionDisplay);
  const visibility = asRecord(input.visibility);
  const plotStyle = asRecord(input.plotStyle);
  const keyLevels = asRecord(input.keyLevels);
  const orderBlocks = asRecord(input.orderBlocks);
  const supportResistance = asRecord(input.supportResistance);
  const showStructureFallback = resolveBooleanSetting(
    appearance.showStructure ?? input.showStructure,
    DEFAULT_RAY_REPLICA_SETTINGS.showStructure,
  );
  const showKeyLevelsFallback = resolveBooleanSetting(
    appearance.showKeyLevels ?? input.showKeyLevels,
    DEFAULT_RAY_REPLICA_SETTINGS.showKeyLevels,
  );

  const volScoreMin = resolveVolScoreSetting(
    confirmation.volScoreMin ?? input.volScoreMin,
    DEFAULT_RAY_REPLICA_SETTINGS.volScoreMin,
  );

  return {
    marketStructure: {
      timeHorizon: resolveIntegerSetting(
        marketStructure.timeHorizon ?? input.timeHorizon,
        DEFAULT_RAY_REPLICA_SETTINGS.timeHorizon,
        2,
        40,
      ),
      structureLineStyle: resolveEnumSetting(
        marketStructure.structureLineStyle ??
          marketStructure.lineStyle ??
          input.structureLineStyle ??
          input.lineStyle,
        RAY_REPLICA_LINE_STYLE_OPTIONS,
        DEFAULT_RAY_REPLICA_SETTINGS.structureLineStyle,
      ),
      bosConfirmation: resolveEnumSetting(
        marketStructure.bosConfirmation ?? input.bosConfirmation,
        RAY_REPLICA_BOS_CONFIRMATION_OPTIONS,
        DEFAULT_RAY_REPLICA_SETTINGS.bosConfirmation,
      ),
      chochAtrBuffer: resolveFloatSetting(
        marketStructure.chochAtrBuffer ??
          marketStructure.atrBuffer ??
          input.chochAtrBuffer ??
          input.atrBuffer,
        DEFAULT_RAY_REPLICA_SETTINGS.chochAtrBuffer,
        0,
        20,
      ),
      chochBodyExpansionAtr: resolveFloatSetting(
        marketStructure.chochBodyExpansionAtr ??
          marketStructure.bodyExpansionAtr ??
          marketStructure.bodyExpansion ??
          input.chochBodyExpansionAtr ??
          input.bodyExpansionAtr ??
          input.bodyExpansion,
        DEFAULT_RAY_REPLICA_SETTINGS.chochBodyExpansionAtr,
        0,
        20,
      ),
      chochVolumeGate: resolveFloatSetting(
        marketStructure.chochVolumeGate ??
          marketStructure.volumeGate ??
          input.chochVolumeGate ??
          input.volumeGate,
        DEFAULT_RAY_REPLICA_SETTINGS.chochVolumeGate,
        0,
        20,
      ),
      showBos: resolveBooleanSetting(
        marketStructure.showBos ?? input.showBos,
        showStructureFallback && DEFAULT_RAY_REPLICA_SETTINGS.showBos,
      ),
      showChoch: resolveBooleanSetting(
        marketStructure.showChoch ?? input.showChoch,
        showStructureFallback && DEFAULT_RAY_REPLICA_SETTINGS.showChoch,
      ),
      showSwings: resolveBooleanSetting(
        marketStructure.showSwings ?? input.showSwings,
        showStructureFallback && DEFAULT_RAY_REPLICA_SETTINGS.showSwings,
      ),
      showTrendReversal: resolveBooleanSetting(
        trendReversal.showTrendReversal ??
          trendReversal.showRev ??
          input.showTrendReversal ??
          input.showRev,
        showStructureFallback && DEFAULT_RAY_REPLICA_SETTINGS.showTrendReversal,
      ),
      trendReversalLengthBars: resolveIntegerSetting(
        trendReversal.trendReversalLengthBars ??
          trendReversal.revBars ??
          input.trendReversalLengthBars ??
          input.revBars,
        DEFAULT_RAY_REPLICA_SETTINGS.trendReversalLengthBars,
        1,
        500,
      ),
      trendReversalLineColor: resolveColorSetting(
        trendReversal.trendReversalLineColor ??
          trendReversal.revLineColor ??
          input.trendReversalLineColor ??
          input.revLineColor,
        DEFAULT_RAY_REPLICA_SETTINGS.trendReversalLineColor,
      ),
      trendReversalTextColor: resolveColorSetting(
        trendReversal.trendReversalTextColor ??
          trendReversal.revTextColor ??
          input.trendReversalTextColor ??
          input.revTextColor,
        DEFAULT_RAY_REPLICA_SETTINGS.trendReversalTextColor,
      ),
    },
    bands: {
      basisLength: resolveIntegerSetting(
        bands.basisLength ?? input.basisLength,
        DEFAULT_RAY_REPLICA_SETTINGS.basisLength,
        1,
        240,
      ),
      atrLength: resolveIntegerSetting(
        bands.atrLength ?? input.atrLength,
        DEFAULT_RAY_REPLICA_SETTINGS.atrLength,
        1,
        100,
      ),
      atrSmoothing: resolveIntegerSetting(
        bands.atrSmoothing ?? input.atrSmoothing,
        DEFAULT_RAY_REPLICA_SETTINGS.atrSmoothing,
        1,
        200,
      ),
      volatilityMultiplier: resolveFloatSetting(
        bands.volatilityMultiplier ?? input.volatilityMultiplier,
        DEFAULT_RAY_REPLICA_SETTINGS.volatilityMultiplier,
        0.1,
        10,
      ),
    },
    confirmation: {
      adxLength: resolveIntegerSetting(
        confirmation.adxLength ?? input.adxLength,
        DEFAULT_RAY_REPLICA_SETTINGS.adxLength,
        1,
        100,
      ),
      volumeMaLength: resolveIntegerSetting(
        confirmation.volumeMaLength ?? input.volumeMaLength,
        DEFAULT_RAY_REPLICA_SETTINGS.volumeMaLength,
        1,
        200,
      ),
      mtf1: resolveEnumSetting(
        confirmation.mtf1 ?? input.mtf1,
        RAY_REPLICA_MTF_OPTIONS,
        DEFAULT_RAY_REPLICA_SETTINGS.mtf1,
      ),
      mtf2: resolveEnumSetting(
        confirmation.mtf2 ?? input.mtf2,
        RAY_REPLICA_MTF_OPTIONS,
        DEFAULT_RAY_REPLICA_SETTINGS.mtf2,
      ),
      mtf3: resolveEnumSetting(
        confirmation.mtf3 ?? input.mtf3,
        RAY_REPLICA_MTF_OPTIONS,
        DEFAULT_RAY_REPLICA_SETTINGS.mtf3,
      ),
      requireMtf1: resolveBooleanSetting(
        confirmation.requireMtf1 ?? input.requireMtf1,
        DEFAULT_RAY_REPLICA_SETTINGS.requireMtf1,
      ),
      requireMtf2: resolveBooleanSetting(
        confirmation.requireMtf2 ?? input.requireMtf2,
        DEFAULT_RAY_REPLICA_SETTINGS.requireMtf2,
      ),
      requireMtf3: resolveBooleanSetting(
        confirmation.requireMtf3 ?? input.requireMtf3,
        DEFAULT_RAY_REPLICA_SETTINGS.requireMtf3,
      ),
      signalFiltersEnabled: resolveBooleanSetting(
        confirmation.signalFiltersEnabled ??
          confirmation.filtersEnabled ??
          input.signalFiltersEnabled,
        DEFAULT_RAY_REPLICA_SETTINGS.signalFiltersEnabled,
      ),
      requireAdx: resolveBooleanSetting(
        confirmation.requireAdx ?? input.requireAdx,
        DEFAULT_RAY_REPLICA_SETTINGS.requireAdx,
      ),
      adxMin: resolveFloatSetting(
        confirmation.adxMin ?? input.adxMin,
        DEFAULT_RAY_REPLICA_SETTINGS.adxMin,
        1,
        100,
      ),
      requireVolScoreRange: resolveBooleanSetting(
        confirmation.requireVolScoreRange ?? input.requireVolScoreRange,
        DEFAULT_RAY_REPLICA_SETTINGS.requireVolScoreRange,
      ),
      volScoreMin,
      volScoreMax: Math.max(
        volScoreMin,
        resolveVolScoreSetting(
          confirmation.volScoreMax ?? input.volScoreMax,
          DEFAULT_RAY_REPLICA_SETTINGS.volScoreMax,
        ),
      ),
      restrictToSelectedSessions: resolveBooleanSetting(
        confirmation.restrictToSelectedSessions ?? input.restrictToSelectedSessions,
        DEFAULT_RAY_REPLICA_SETTINGS.restrictToSelectedSessions,
      ),
      sessions: resolveSessionSelections(
        confirmation.sessions ?? input.sessions,
        DEFAULT_RAY_REPLICA_SETTINGS.sessions,
      ),
    },
    infoPanel: {
      visible: resolveBooleanSetting(
        infoPanel.visible ?? input.showDashboard,
        DEFAULT_RAY_REPLICA_SETTINGS.showDashboard,
      ),
      position: resolveDashboardPositionSetting(
        infoPanel.position ?? input.dashboardPosition,
        DEFAULT_RAY_REPLICA_SETTINGS.dashboardPosition,
      ),
      size: resolveDashboardSizeSetting(
        infoPanel.size ?? input.dashboardSize,
        DEFAULT_RAY_REPLICA_SETTINGS.dashboardSize,
      ),
    },
    risk: {
      showTpSl: resolveBooleanSetting(
        risk.showTpSl ?? input.showTpSl,
        DEFAULT_RAY_REPLICA_SETTINGS.showTpSl,
      ),
      tp1Rr: resolveFloatSetting(
        risk.tp1Rr ?? input.tp1Rr,
        DEFAULT_RAY_REPLICA_SETTINGS.tp1Rr,
        0,
        10,
      ),
      tp2Rr: resolveFloatSetting(
        risk.tp2Rr ?? input.tp2Rr,
        DEFAULT_RAY_REPLICA_SETTINGS.tp2Rr,
        0,
        10,
      ),
      tp3Rr: resolveFloatSetting(
        risk.tp3Rr ?? input.tp3Rr,
        DEFAULT_RAY_REPLICA_SETTINGS.tp3Rr,
        0,
        10,
      ),
      signalOffsetAtr: resolveFloatSetting(
        risk.signalOffsetAtr ?? input.signalOffsetAtr,
        DEFAULT_RAY_REPLICA_SETTINGS.signalOffsetAtr,
        0,
        20,
      ),
    },
    appearance: {
      waitForBarClose: resolveBooleanSetting(
        appearance.waitForBarClose ?? input.waitForBarClose,
        DEFAULT_RAY_REPLICA_SETTINGS.waitForBarClose,
      ),
      showWires: resolveBooleanSetting(
        input.showWires,
        DEFAULT_RAY_REPLICA_SETTINGS.showWires,
      ),
      showShadow: resolveBooleanSetting(
        input.showShadow,
        DEFAULT_RAY_REPLICA_SETTINGS.showShadow,
      ),
      showKeyLevels: showKeyLevelsFallback,
      showStructure: showStructureFallback,
      showOrderBlocks: resolveBooleanSetting(
        orderBlocks.showOrderBlocks ?? input.showOrderBlocks,
        DEFAULT_RAY_REPLICA_SETTINGS.showOrderBlocks,
      ),
      showSupportResistance: resolveBooleanSetting(
        supportResistance.showSupportResistance ?? input.showSupportResistance,
        DEFAULT_RAY_REPLICA_SETTINGS.showSupportResistance,
      ),
      showDashboard: resolveBooleanSetting(
        infoPanel.visible ?? input.showDashboard,
        DEFAULT_RAY_REPLICA_SETTINGS.showDashboard,
      ),
      showRegimeWindows: resolveBooleanSetting(
        input.showRegimeWindows,
        DEFAULT_RAY_REPLICA_SETTINGS.showRegimeWindows,
      ),
      colorCandles: resolveBooleanSetting(
        input.colorCandles,
        DEFAULT_RAY_REPLICA_SETTINGS.colorCandles,
      ),
      bullColor: resolveColorSetting(
        appearance.bullColor ?? input.bullColor,
        DEFAULT_RAY_REPLICA_SETTINGS.bullColor,
      ),
      bearColor: resolveColorSetting(
        appearance.bearColor ?? input.bearColor,
        DEFAULT_RAY_REPLICA_SETTINGS.bearColor,
      ),
      orderBlockBullColor: resolveColorSetting(
        orderBlocks.orderBlockBullColor ??
          orderBlocks.bullColor ??
          input.orderBlockBullColor ??
          input.bullOrderBlockColor,
        DEFAULT_RAY_REPLICA_SETTINGS.orderBlockBullColor,
      ),
      orderBlockBearColor: resolveColorSetting(
        orderBlocks.orderBlockBearColor ??
          orderBlocks.bearColor ??
          input.orderBlockBearColor ??
          input.bearOrderBlockColor,
        DEFAULT_RAY_REPLICA_SETTINGS.orderBlockBearColor,
      ),
      supportZoneColor: resolveColorSetting(
        supportResistance.supportZoneColor ??
          supportResistance.supportColor ??
          input.supportZoneColor ??
          input.supportColor,
        DEFAULT_RAY_REPLICA_SETTINGS.supportZoneColor,
      ),
      resistanceZoneColor: resolveColorSetting(
        supportResistance.resistanceZoneColor ??
          supportResistance.resistanceColor ??
          input.resistanceZoneColor ??
          input.resistanceColor,
        DEFAULT_RAY_REPLICA_SETTINGS.resistanceZoneColor,
      ),
      keyLevelHighColor: resolveColorSetting(
        keyLevels.keyLevelHighColor ??
          keyLevels.highColor ??
          input.keyLevelHighColor ??
          input.highColor,
        DEFAULT_RAY_REPLICA_SETTINGS.keyLevelHighColor,
      ),
      keyLevelLowColor: resolveColorSetting(
        keyLevels.keyLevelLowColor ??
          keyLevels.lowColor ??
          input.keyLevelLowColor ??
          input.lowColor,
        DEFAULT_RAY_REPLICA_SETTINGS.keyLevelLowColor,
      ),
      keyLevelCloseColor: resolveColorSetting(
        keyLevels.keyLevelCloseColor ??
          keyLevels.closeColor ??
          input.keyLevelCloseColor ??
          input.closeColor,
        DEFAULT_RAY_REPLICA_SETTINGS.keyLevelCloseColor,
      ),
      keyLevelOpenColor: resolveColorSetting(
        keyLevels.keyLevelOpenColor ??
          keyLevels.openColor ??
          input.keyLevelOpenColor ??
          input.openColor,
        DEFAULT_RAY_REPLICA_SETTINGS.keyLevelOpenColor,
      ),
      shadowColor: resolveColorSetting(
        appearance.shadowColor ??
          input.shadowColor,
        DEFAULT_RAY_REPLICA_SETTINGS.shadowColor,
      ),
      filteredCandleColor: resolveColorSetting(
        confirmation.filteredCandleColor ??
          confirmation.candleColor ??
          input.filteredCandleColor ??
          input.filterCandleColor,
        DEFAULT_RAY_REPLICA_SETTINGS.filteredCandleColor,
      ),
    },
    sessionDisplay: {
      showLondonSession: resolveBooleanSetting(
        sessionDisplay.showLondonSession ?? input.showLondonSession,
        DEFAULT_RAY_REPLICA_SETTINGS.showLondonSession,
      ),
      showNewYorkSession: resolveBooleanSetting(
        sessionDisplay.showNewYorkSession ?? input.showNewYorkSession,
        DEFAULT_RAY_REPLICA_SETTINGS.showNewYorkSession,
      ),
      showTokyoSession: resolveBooleanSetting(
        sessionDisplay.showTokyoSession ?? input.showTokyoSession,
        DEFAULT_RAY_REPLICA_SETTINGS.showTokyoSession,
      ),
      showSydneySession: resolveBooleanSetting(
        sessionDisplay.showSydneySession ?? input.showSydneySession,
        DEFAULT_RAY_REPLICA_SETTINGS.showSydneySession,
      ),
    },
    visibility: {
      visibleTimeframes: resolveVisibleTimeframeSelections(
        visibility.visibleTimeframes ?? input.visibleTimeframes,
        DEFAULT_RAY_REPLICA_SETTINGS.visibleTimeframes,
      ),
      showLastBarOnly: resolveBooleanSetting(
        visibility.showLastBarOnly ?? input.showLastBarOnly,
        DEFAULT_RAY_REPLICA_SETTINGS.showLastBarOnly,
      ),
    },
    plotStyle: {
      plotOverrides: resolvePlotOverrides(
        plotStyle.plotOverrides ?? input.plotOverrides,
      ),
    },
    keyLevels: {
      showPriorDayHigh: resolveBooleanSetting(
        keyLevels.showPriorDayHigh ?? keyLevels.showPdh ?? input.showPriorDayHigh ?? input.showPdh,
        showKeyLevelsFallback && DEFAULT_RAY_REPLICA_SETTINGS.showPriorDayHigh,
      ),
      showPriorDayLow: resolveBooleanSetting(
        keyLevels.showPriorDayLow ?? keyLevels.showPdl ?? input.showPriorDayLow ?? input.showPdl,
        showKeyLevelsFallback && DEFAULT_RAY_REPLICA_SETTINGS.showPriorDayLow,
      ),
      showPriorDayClose: resolveBooleanSetting(
        keyLevels.showPriorDayClose ?? keyLevels.showPdc ?? input.showPriorDayClose ?? input.showPdc,
        showKeyLevelsFallback && DEFAULT_RAY_REPLICA_SETTINGS.showPriorDayClose,
      ),
      showTodayOpen: resolveBooleanSetting(
        keyLevels.showTodayOpen ?? keyLevels.showTo ?? input.showTodayOpen ?? input.showTo,
        showKeyLevelsFallback && DEFAULT_RAY_REPLICA_SETTINGS.showTodayOpen,
      ),
      showPriorWeekHigh: resolveBooleanSetting(
        keyLevels.showPriorWeekHigh ?? keyLevels.showPwh ?? input.showPriorWeekHigh ?? input.showPwh,
        showKeyLevelsFallback && DEFAULT_RAY_REPLICA_SETTINGS.showPriorWeekHigh,
      ),
      showPriorWeekLow: resolveBooleanSetting(
        keyLevels.showPriorWeekLow ?? keyLevels.showPwl ?? input.showPriorWeekLow ?? input.showPwl,
        showKeyLevelsFallback && DEFAULT_RAY_REPLICA_SETTINGS.showPriorWeekLow,
      ),
      lineStyle: resolveEnumSetting(
        keyLevels.lineStyle ?? input.keyLevelLineStyle,
        RAY_REPLICA_LINE_STYLE_OPTIONS,
        DEFAULT_RAY_REPLICA_SETTINGS.keyLevelLineStyle,
      ),
      labelSize: resolveEnumSetting(
        keyLevels.labelSize ?? input.keyLevelLabelSize,
        RAY_REPLICA_LABEL_SIZE_OPTIONS,
        DEFAULT_RAY_REPLICA_SETTINGS.keyLevelLabelSize,
      ),
      labelOffsetBars: resolveIntegerSetting(
        keyLevels.labelOffsetBars ?? input.keyLevelLabelOffsetBars,
        DEFAULT_RAY_REPLICA_SETTINGS.keyLevelLabelOffsetBars,
        0,
        50,
      ),
    },
    orderBlocks: {
      maxActivePerSide: resolveIntegerSetting(
        orderBlocks.maxActivePerSide ?? input.orderBlockMaxActivePerSide,
        DEFAULT_RAY_REPLICA_SETTINGS.orderBlockMaxActivePerSide,
        1,
        20,
      ),
    },
    supportResistance: {
      pivotStrength: resolveIntegerSetting(
        supportResistance.pivotStrength ?? input.supportResistancePivotStrength,
        DEFAULT_RAY_REPLICA_SETTINGS.supportResistancePivotStrength,
        2,
        100,
      ),
      minZoneDistancePercent: resolveFloatSetting(
        supportResistance.minZoneDistancePercent ??
          input.supportResistanceMinZoneDistancePercent,
        DEFAULT_RAY_REPLICA_SETTINGS.supportResistanceMinZoneDistancePercent,
        0.01,
        10,
      ),
      thicknessMultiplier: resolveFloatSetting(
        supportResistance.thicknessMultiplier ??
          input.supportResistanceThicknessMultiplier,
        DEFAULT_RAY_REPLICA_SETTINGS.supportResistanceThicknessMultiplier,
        0.01,
        10,
      ),
      maxZones: resolveIntegerSetting(
        supportResistance.maxZones ?? input.supportResistanceMaxZones,
        DEFAULT_RAY_REPLICA_SETTINGS.supportResistanceMaxZones,
        1,
        20,
      ),
      extensionBars: resolveIntegerSetting(
        supportResistance.extensionBars ?? input.supportResistanceExtensionBars,
        DEFAULT_RAY_REPLICA_SETTINGS.supportResistanceExtensionBars,
        1,
        1000,
      ),
    },
    overlays: {
      wireSpread: resolveFloatSetting(
        input.wireSpread,
        DEFAULT_RAY_REPLICA_SETTINGS.wireSpread,
        0.01,
        50,
      ),
      shadowLength: resolveIntegerSetting(
        input.shadowLength,
        DEFAULT_RAY_REPLICA_SETTINGS.shadowLength,
        1,
        120,
      ),
      shadowStdDev: resolveFloatSetting(
        input.shadowStdDev,
        DEFAULT_RAY_REPLICA_SETTINGS.shadowStdDev,
        0.001,
        50,
      ),
    },
  };
}

export function resolveRayReplicaRuntimeSettings(
  settings?: Record<string, unknown>,
): RayReplicaRuntimeSettings {
  const normalized = normalizeRayReplicaSettings(settings);

  return {
    timeHorizon: normalized.marketStructure.timeHorizon,
    structureLineStyle: normalized.marketStructure.structureLineStyle,
    bosConfirmation: normalized.marketStructure.bosConfirmation,
    chochAtrBuffer: normalized.marketStructure.chochAtrBuffer,
    chochBodyExpansionAtr: normalized.marketStructure.chochBodyExpansionAtr,
    chochVolumeGate: normalized.marketStructure.chochVolumeGate,
    basisLength: normalized.bands.basisLength,
    atrLength: normalized.bands.atrLength,
    atrSmoothing: normalized.bands.atrSmoothing,
    volatilityMultiplier: normalized.bands.volatilityMultiplier,
    wireSpread: normalized.overlays.wireSpread,
    shadowLength: normalized.overlays.shadowLength,
    shadowStdDev: normalized.overlays.shadowStdDev,
    adxLength: normalized.confirmation.adxLength,
    volumeMaLength: normalized.confirmation.volumeMaLength,
    mtf1: normalized.confirmation.mtf1,
    mtf2: normalized.confirmation.mtf2,
    mtf3: normalized.confirmation.mtf3,
    requireMtf1: normalized.confirmation.requireMtf1,
    requireMtf2: normalized.confirmation.requireMtf2,
    requireMtf3: normalized.confirmation.requireMtf3,
    signalFiltersEnabled: normalized.confirmation.signalFiltersEnabled,
    requireAdx: normalized.confirmation.requireAdx,
    adxMin: normalized.confirmation.adxMin,
    requireVolScoreRange: normalized.confirmation.requireVolScoreRange,
    volScoreMin: normalized.confirmation.volScoreMin,
    volScoreMax: normalized.confirmation.volScoreMax,
    restrictToSelectedSessions: normalized.confirmation.restrictToSelectedSessions,
    sessions: normalized.confirmation.sessions,
    signalOffsetAtr: normalized.risk.signalOffsetAtr,
    tp1Rr: normalized.risk.tp1Rr,
    tp2Rr: normalized.risk.tp2Rr,
    tp3Rr: normalized.risk.tp3Rr,
    dashboardPosition: normalized.infoPanel.position,
    dashboardSize: normalized.infoPanel.size,
    showWires: normalized.appearance.showWires,
    showShadow: normalized.appearance.showShadow,
    showKeyLevels: normalized.appearance.showKeyLevels,
    showStructure: normalized.appearance.showStructure,
    showBos: normalized.marketStructure.showBos,
    showChoch: normalized.marketStructure.showChoch,
    showSwings: normalized.marketStructure.showSwings,
    showTrendReversal: normalized.marketStructure.showTrendReversal,
    showOrderBlocks: normalized.appearance.showOrderBlocks,
    showSupportResistance: normalized.appearance.showSupportResistance,
    showTpSl: normalized.risk.showTpSl,
    showDashboard: normalized.appearance.showDashboard,
    showRegimeWindows: normalized.appearance.showRegimeWindows,
    colorCandles: normalized.appearance.colorCandles,
    waitForBarClose: normalized.appearance.waitForBarClose,
    trendReversalLengthBars: normalized.marketStructure.trendReversalLengthBars,
    trendReversalLineColor: normalized.marketStructure.trendReversalLineColor,
    trendReversalTextColor: normalized.marketStructure.trendReversalTextColor,
    orderBlockMaxActivePerSide: normalized.orderBlocks.maxActivePerSide,
    supportResistancePivotStrength: normalized.supportResistance.pivotStrength,
    supportResistanceMinZoneDistancePercent:
      normalized.supportResistance.minZoneDistancePercent,
    supportResistanceThicknessMultiplier:
      normalized.supportResistance.thicknessMultiplier,
    supportResistanceMaxZones: normalized.supportResistance.maxZones,
    supportResistanceExtensionBars:
      normalized.supportResistance.extensionBars,
    keyLevelLineStyle: normalized.keyLevels.lineStyle,
    keyLevelLabelSize: normalized.keyLevels.labelSize,
    keyLevelLabelOffsetBars: normalized.keyLevels.labelOffsetBars,
    showPriorDayHigh: normalized.keyLevels.showPriorDayHigh,
    showPriorDayLow: normalized.keyLevels.showPriorDayLow,
    showPriorDayClose: normalized.keyLevels.showPriorDayClose,
    showTodayOpen: normalized.keyLevels.showTodayOpen,
    showPriorWeekHigh: normalized.keyLevels.showPriorWeekHigh,
    showPriorWeekLow: normalized.keyLevels.showPriorWeekLow,
    bullColor: normalized.appearance.bullColor,
    bearColor: normalized.appearance.bearColor,
    orderBlockBullColor: normalized.appearance.orderBlockBullColor,
    orderBlockBearColor: normalized.appearance.orderBlockBearColor,
    supportZoneColor: normalized.appearance.supportZoneColor,
    resistanceZoneColor: normalized.appearance.resistanceZoneColor,
    keyLevelHighColor: normalized.appearance.keyLevelHighColor,
    keyLevelLowColor: normalized.appearance.keyLevelLowColor,
    keyLevelCloseColor: normalized.appearance.keyLevelCloseColor,
    keyLevelOpenColor: normalized.appearance.keyLevelOpenColor,
    shadowColor: normalized.appearance.shadowColor,
    filteredCandleColor: normalized.appearance.filteredCandleColor,
    showLondonSession: normalized.sessionDisplay.showLondonSession,
    showNewYorkSession: normalized.sessionDisplay.showNewYorkSession,
    showTokyoSession: normalized.sessionDisplay.showTokyoSession,
    showSydneySession: normalized.sessionDisplay.showSydneySession,
    visibleTimeframes: normalized.visibility.visibleTimeframes,
    showLastBarOnly: normalized.visibility.showLastBarOnly,
    plotOverrides: normalized.plotStyle.plotOverrides,
  };
}

export function resolveRayReplicaBandProfile(
  settings?: Record<string, unknown> | RayReplicaRuntimeSettings,
) {
  const normalized = resolveRayReplicaRuntimeSettings(settings);
  return (
    RAY_REPLICA_BAND_PROFILE_OPTIONS.find(
      (profile) =>
        profile.settings.basisLength === normalized.basisLength &&
        profile.settings.atrLength === normalized.atrLength &&
        profile.settings.atrSmoothing === normalized.atrSmoothing &&
        profile.settings.volatilityMultiplier ===
          normalized.volatilityMultiplier,
    ) || null
  );
}

type StructureKind = "bos" | "choch";

type StructureRecord = {
  kind: StructureKind;
  direction: "long" | "short";
  sourceBarIndex: number;
  sourcePrice: number;
  eventBarIndex: number;
  label: string;
};

type ActiveOrderBlock = {
  id: string;
  direction: "long" | "short";
  startBarIndex: number;
  endBarIndex: number;
  top: number;
  bottom: number;
  label: string;
};

type SupportResistanceZone = {
  id: string;
  direction: "long" | "short";
  startBarIndex: number;
  endBarIndex: number;
  extendBars: number;
  top: number;
  bottom: number;
  fillColor: string;
  borderColor: string;
};

type ActiveTpSlOverlay = {
  direction: "long" | "short";
  startBarIndex: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
};

const buildStudyData = (
  chartBars: ChartBar[],
  values: number[],
  options: { preserveWhitespace?: boolean } = {},
): StudyPoint[] =>
  chartBars.reduce<StudyPoint[]>((points, bar, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) {
      if (options.preserveWhitespace) {
        points.push({ time: bar.time });
      }
      return points;
    }

    points.push({
      time: bar.time,
      value,
    });
    return points;
  }, []);

const buildLineStudy = (
  key: string,
  chartBars: ChartBar[],
  values: number[],
  options: Record<string, unknown>,
  dataOptions?: {
    preserveWhitespace?: boolean;
    renderMode?: StudySpec["renderMode"];
  },
): StudySpec => ({
  key,
  seriesType: "line",
  paneIndex: 0,
  renderMode: dataOptions?.renderMode,
  options,
  data: buildStudyData(chartBars, values, dataOptions),
});

const normalizeRayReplicaTimeframe = (
  timeframe: string,
): RayReplicaTimeframeOption | null => {
  if (timeframe === "60") {
    return "1h";
  }
  if (timeframe === "240") {
    return "4h";
  }
  if (timeframe === "1D" || timeframe === "1d") {
    return "D";
  }
  return RAY_REPLICA_MTF_OPTIONS.includes(timeframe as RayReplicaTimeframeOption)
    ? (timeframe as RayReplicaTimeframeOption)
    : null;
};

const resolvePlotOverride = (
  overrides: Partial<Record<RayReplicaPlotKey, RayReplicaPlotOverride>>,
  key: RayReplicaPlotKey,
): RayReplicaPlotOverride => overrides[key] || {};

const applyLineStudyOverride = (
  baseOptions: Record<string, unknown>,
  override: RayReplicaPlotOverride,
): Record<string, unknown> => ({
  ...baseOptions,
  ...(override.visible === false ? { visible: false } : {}),
  ...(override.color ? { color: override.color } : {}),
  ...(Number.isFinite(override.lineWidth)
    ? { lineWidth: override.lineWidth }
    : {}),
});

const resolveMedianPositiveBarInterval = (chartBars: ChartBar[]): number => {
  const intervals: number[] = [];
  for (let index = 1; index < chartBars.length; index += 1) {
    const interval = chartBars[index].time - chartBars[index - 1].time;
    if (Number.isFinite(interval) && interval > 0) {
      intervals.push(interval);
    }
  }

  if (!intervals.length) {
    return 0;
  }

  intervals.sort((left, right) => left - right);
  return intervals[Math.floor(intervals.length / 2)] ?? 0;
};

const hasHardBarTimeGap = (
  chartBars: ChartBar[],
  index: number,
  medianInterval: number,
): boolean => {
  if (index <= 0 || medianInterval <= 0) {
    return false;
  }

  return chartBars[index].time - chartBars[index - 1].time > medianInterval * 2;
};

const buildMarker = (
  id: string,
  bar: ChartBar,
  barIndex: number,
  position: ChartMarker["position"],
  shape: ChartMarker["shape"],
  color: string,
  text?: string,
): ChartMarker => ({
  id,
  time: bar.time,
  barIndex,
  position,
  shape,
  color,
  text,
  size: 1,
});

const buildEvent = (
  id: string,
  bar: ChartBar,
  barIndex: number,
  eventType: string,
  direction: "long" | "short",
  label: string,
  meta?: Record<string, unknown>,
): IndicatorEvent => ({
  id,
  strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
  eventType,
  ts: bar.ts,
  time: bar.time,
  barIndex,
  direction,
  label,
  meta,
});

const computeSma = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }

  let rollingSum = 0;
  let validCount = 0;

  values.forEach((value, index) => {
    if (Number.isFinite(value)) {
      rollingSum += value;
      validCount += 1;
    }

    if (index >= period) {
      const dropped = values[index - period];
      if (Number.isFinite(dropped)) {
        rollingSum -= dropped;
        validCount -= 1;
      }
    }

    if (index >= period - 1 && validCount === period) {
      result[index] = Number((rollingSum / period).toFixed(6));
    }
  });

  return result;
};

const computeStandardDeviation = (
  values: number[],
  period: number,
): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }

  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    if (window.some((value) => !Number.isFinite(value))) {
      continue;
    }

    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    result[index] = Number(Math.sqrt(variance).toFixed(6));
  }

  return result;
};

const computeAtr = (chartBars: ChartBar[], period: number): number[] => {
  const trueRange = chartBars.map((bar, index) => {
    if (index === 0) {
      return bar.h - bar.l;
    }

    const previousClose = chartBars[index - 1]?.c ?? bar.c;
    return Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - previousClose),
      Math.abs(bar.l - previousClose),
    );
  });

  const result = new Array<number>(chartBars.length).fill(Number.NaN);
  if (trueRange.length < period || period <= 0) {
    return result;
  }

  let rolling = 0;
  for (let index = 0; index < period; index += 1) {
    rolling += trueRange[index];
  }

  let atr = rolling / period;
  result[period - 1] = Number(atr.toFixed(6));

  for (let index = period; index < trueRange.length; index += 1) {
    atr = (atr * (period - 1) + trueRange[index]) / period;
    result[index] = Number(atr.toFixed(6));
  }

  return result;
};

const computePercentRank = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 1) {
    return result;
  }

  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    const current = values[index];
    if (!Number.isFinite(current) || window.some((value) => !Number.isFinite(value))) {
      continue;
    }

    let lessOrEqual = 0;
    window.forEach((value) => {
      if (value <= current) {
        lessOrEqual += 1;
      }
    });
    result[index] = Number(
      ((((lessOrEqual - 1) / (period - 1)) * 100) || 0).toFixed(6),
    );
  }

  return result;
};

const computeAdx = (chartBars: ChartBar[], period: number): number[] => {
  const length = chartBars.length;
  const result = new Array<number>(length).fill(Number.NaN);
  if (length <= period * 2 || period <= 0) {
    return result;
  }

  const trueRanges = new Array<number>(length).fill(0);
  const plusDm = new Array<number>(length).fill(0);
  const minusDm = new Array<number>(length).fill(0);

  for (let index = 1; index < length; index += 1) {
    const currentBar = chartBars[index];
    const previousBar = chartBars[index - 1];
    const upMove = currentBar.h - previousBar.h;
    const downMove = previousBar.l - currentBar.l;
    trueRanges[index] = Math.max(
      currentBar.h - currentBar.l,
      Math.abs(currentBar.h - previousBar.c),
      Math.abs(currentBar.l - previousBar.c),
    );
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  let smoothedTr = 0;
  let smoothedPlusDm = 0;
  let smoothedMinusDm = 0;
  for (let index = 1; index <= period; index += 1) {
    smoothedTr += trueRanges[index];
    smoothedPlusDm += plusDm[index];
    smoothedMinusDm += minusDm[index];
  }

  const dx = new Array<number>(length).fill(Number.NaN);
  for (let index = period; index < length; index += 1) {
    if (index > period) {
      smoothedTr = smoothedTr - smoothedTr / period + trueRanges[index];
      smoothedPlusDm =
        smoothedPlusDm - smoothedPlusDm / period + plusDm[index];
      smoothedMinusDm =
        smoothedMinusDm - smoothedMinusDm / period + minusDm[index];
    }

    if (!Number.isFinite(smoothedTr) || smoothedTr <= 0) {
      continue;
    }

    const plusDi = (smoothedPlusDm / smoothedTr) * 100;
    const minusDi = (smoothedMinusDm / smoothedTr) * 100;
    const diSum = plusDi + minusDi;
    if (diSum <= 0) {
      continue;
    }

    dx[index] = Math.abs(plusDi - minusDi) / diSum * 100;
  }

  let dxSum = 0;
  let dxCount = 0;
  for (let index = period; index < length && dxCount < period; index += 1) {
    if (Number.isFinite(dx[index])) {
      dxSum += dx[index];
      dxCount += 1;
      if (dxCount === period) {
        result[index] = Number((dxSum / period).toFixed(6));
      }
    }
  }

  for (let index = period * 2; index < length; index += 1) {
    if (!Number.isFinite(dx[index]) || !Number.isFinite(result[index - 1])) {
      continue;
    }

    result[index] = Number(
      (((result[index - 1] * (period - 1) + dx[index]) / period)).toFixed(6),
    );
  }

  return result;
};

const formatDashboardTimeframe = (timeframe: string): string => {
  if (timeframe === "D" || timeframe === "1D") return "D1";
  if (timeframe === "W" || timeframe === "1W") return "W1";
  if (timeframe === "240" || timeframe === "4h") return "H4";
  if (timeframe === "120") return "H2";
  if (timeframe === "60" || timeframe === "1h") return "H1";
  return /^\d+$/.test(timeframe) ? `${timeframe}m` : timeframe;
};

const resolveDayKeyFromEpochSeconds = (time: number): string =>
  new Date(time * 1000).toISOString().slice(0, 10);

const resolveDayKey = (bar: { time: number }): string =>
  resolveDayKeyFromEpochSeconds(bar.time);

const resolveIsoWeekKeyFromEpochSeconds = (time: number): string => {
  const value = new Date(time * 1000);
  const utcDay = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - utcDay);
  value.setUTCHours(0, 0, 0, 0);
  return value.toISOString().slice(0, 10);
};

const resolveIsoWeekKey = (bar: { time: number }): string =>
  resolveIsoWeekKeyFromEpochSeconds(bar.time);

const resolveMarketBarTimeSeconds = (bar: MarketBar): number | null => {
  if (typeof bar.time === "number" && Number.isFinite(bar.time)) {
    return bar.time > 1e12 ? Math.floor(bar.time / 1000) : Math.floor(bar.time);
  }
  if (bar.time instanceof Date) {
    return Math.floor(bar.time.getTime() / 1000);
  }
  if (typeof bar.time === "string") {
    const parsed = Date.parse(bar.time);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  if (typeof bar.timestamp === "number" && Number.isFinite(bar.timestamp)) {
    return bar.timestamp > 1e12
      ? Math.floor(bar.timestamp / 1000)
      : Math.floor(bar.timestamp);
  }
  if (bar.timestamp instanceof Date) {
    return Math.floor(bar.timestamp.getTime() / 1000);
  }
  if (typeof bar.timestamp === "string") {
    const parsed = Date.parse(bar.timestamp);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  if (typeof bar.ts === "string") {
    const parsed = Date.parse(bar.ts);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return null;
};

const buildSessionKeyLevelSeries = (
  chartBars: ChartBar[],
  dailyBars?: MarketBar[],
): {
  pdh: number[];
  pdl: number[];
  pdc: number[];
  todayOpen: number[];
  pwh: number[];
  pwl: number[];
  dayStartBarIndex: number[];
  weekStartBarIndex: number[];
} => {
  const dayStartBarIndexByKey = new Map<string, number>();
  const weekStartBarIndexByKey = new Map<string, number>();
  chartBars.forEach((bar, index) => {
    const dayKey = resolveDayKey(bar);
    if (!dayStartBarIndexByKey.has(dayKey)) {
      dayStartBarIndexByKey.set(dayKey, index);
    }
    const weekKey = resolveIsoWeekKey(bar);
    if (!weekStartBarIndexByKey.has(weekKey)) {
      weekStartBarIndexByKey.set(weekKey, index);
    }
  });

  const dayStats = new Map<
    string,
    { open: number; high: number; low: number; close: number }
  >();
  const weekStats = new Map<string, { high: number; low: number }>();
  const orderedDayKeys: string[] = [];
  const orderedWeekKeys: string[] = [];

  const normalizedDailyBars =
    dailyBars?.reduce<
      Array<{ time: number; open: number; high: number; low: number; close: number }>
    >((acc, bar) => {
      const time = resolveMarketBarTimeSeconds(bar);
      const open = bar.o ?? bar.open;
      const high = bar.h ?? bar.high;
      const low = bar.l ?? bar.low;
      const close = bar.c ?? bar.close;
      if (
        time == null ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        return acc;
      }
      acc.push({
        time,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
      });
      return acc;
    }, []) ?? [];

  if (normalizedDailyBars.length) {
    normalizedDailyBars
      .sort((left, right) => left.time - right.time)
      .forEach((bar) => {
        const dayKey = resolveDayKeyFromEpochSeconds(bar.time);
        if (!dayStats.has(dayKey)) {
          orderedDayKeys.push(dayKey);
          dayStats.set(dayKey, {
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          });
        }

        const weekKey = resolveIsoWeekKeyFromEpochSeconds(bar.time);
        if (!weekStats.has(weekKey)) {
          orderedWeekKeys.push(weekKey);
          weekStats.set(weekKey, { high: bar.high, low: bar.low });
        } else {
          const current = weekStats.get(weekKey);
          if (current) {
            current.high = Math.max(current.high, bar.high);
            current.low = Math.min(current.low, bar.low);
          }
        }
      });
  } else {
    chartBars.forEach((bar) => {
      const dayKey = resolveDayKey(bar);
      if (!dayStats.has(dayKey)) {
        orderedDayKeys.push(dayKey);
        dayStats.set(dayKey, {
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
        });
      } else {
        const current = dayStats.get(dayKey);
        if (current) {
          current.high = Math.max(current.high, bar.h);
          current.low = Math.min(current.low, bar.l);
          current.close = bar.c;
        }
      }

      const weekKey = resolveIsoWeekKey(bar);
      if (!weekStats.has(weekKey)) {
        orderedWeekKeys.push(weekKey);
        weekStats.set(weekKey, { high: bar.h, low: bar.l });
      } else {
        const current = weekStats.get(weekKey);
        if (current) {
          current.high = Math.max(current.high, bar.h);
          current.low = Math.min(current.low, bar.l);
        }
      }
    });
  }

  const previousDayStats = new Map<
    string,
    { open: number; high: number; low: number; close: number } | null
  >();
  let lastDay: {
    open: number;
    high: number;
    low: number;
    close: number;
  } | null = null;
  orderedDayKeys.forEach((key) => {
    previousDayStats.set(key, lastDay);
    lastDay = dayStats.get(key) ?? null;
  });

  const previousWeekStats = new Map<
    string,
    { high: number; low: number } | null
  >();
  let lastWeek: { high: number; low: number } | null = null;
  orderedWeekKeys.forEach((key) => {
    previousWeekStats.set(key, lastWeek);
    lastWeek = weekStats.get(key) ?? null;
  });

  return chartBars.reduce(
    (series, bar, index) => {
      const dayKey = resolveDayKey(bar);
      const day = dayStats.get(dayKey) ?? null;
      const previousDay = previousDayStats.get(dayKey) ?? null;
      const weekKey = resolveIsoWeekKey(bar);
      const previousWeek = previousWeekStats.get(weekKey) ?? null;

      series.pdh[index] = previousDay?.high ?? Number.NaN;
      series.pdl[index] = previousDay?.low ?? Number.NaN;
      series.pdc[index] = previousDay?.close ?? Number.NaN;
      series.todayOpen[index] = day?.open ?? Number.NaN;
      series.pwh[index] = previousWeek?.high ?? Number.NaN;
      series.pwl[index] = previousWeek?.low ?? Number.NaN;
      series.dayStartBarIndex[index] =
        dayStartBarIndexByKey.get(dayKey) ?? index;
      series.weekStartBarIndex[index] =
        weekStartBarIndexByKey.get(weekKey) ?? index;
      return series;
    },
    {
      pdh: new Array<number>(chartBars.length).fill(Number.NaN),
      pdl: new Array<number>(chartBars.length).fill(Number.NaN),
      pdc: new Array<number>(chartBars.length).fill(Number.NaN),
      todayOpen: new Array<number>(chartBars.length).fill(Number.NaN),
      pwh: new Array<number>(chartBars.length).fill(Number.NaN),
      pwl: new Array<number>(chartBars.length).fill(Number.NaN),
      dayStartBarIndex: new Array<number>(chartBars.length).fill(0),
      weekStartBarIndex: new Array<number>(chartBars.length).fill(0),
    },
  );
};

const pushFilledBarZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  barIndex: number,
  top: number,
  bottom: number,
  fillColor: string,
) => {
  const bar = chartBars[barIndex];
  if (
    !bar ||
    !Number.isFinite(top) ||
    !Number.isFinite(bottom) ||
    top === bottom
  ) {
    return;
  }

  zones.push({
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-fill-${zones.length}`,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    zoneType: "fill-band",
    startTs: bar.ts,
    endTs: bar.ts,
    startBarIndex: barIndex,
    endBarIndex: barIndex,
    top: Math.max(top, bottom),
    bottom: Math.min(top, bottom),
    meta: {
      style: "fill-band",
      fillColor,
      borderVisible: false,
    },
  });
};

const pushLabeledLineZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  {
    id,
    zoneType,
    direction,
    startBarIndex,
    endBarIndex,
    price,
    label,
    lineColor,
    lineStyle,
    labelPosition = "center",
    labelFillColor,
    labelColor = "#ffffff",
    labelOffsetBars = 0,
    labelSize,
    extendBars = 0,
  }: {
    id: string;
    zoneType: string;
    direction?: "long" | "short";
    startBarIndex: number;
    endBarIndex: number;
    price: number;
    label?: string;
    lineColor: string;
    lineStyle: string;
    labelPosition?: string;
    labelFillColor?: string;
    labelColor?: string;
    labelOffsetBars?: number;
    labelSize?: RayReplicaLabelSize;
    extendBars?: number;
  },
) => {
  const startBar = chartBars[startBarIndex];
  const endBar = chartBars[endBarIndex];
  if (!startBar || !endBar || !Number.isFinite(price)) {
    return;
  }

  zones.push({
    id,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    zoneType,
    direction,
    startTs: startBar.ts,
    endTs: endBar.ts,
    startBarIndex,
    endBarIndex,
    top: price,
    bottom: price,
    label,
    meta: {
      style: "line-overlay",
      lineColor,
      lineStyle,
      labelPosition,
      labelFillColor,
      labelColor,
      labelOffsetBars,
      labelSize,
      extendBars,
      borderWidth: 1,
    },
  });
};

const pushKeyLevelZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  {
    idSuffix,
    anchorBarIndex,
    lastBarIndex,
    price,
    label,
    color,
    lineStyle,
    labelOffsetBars,
    labelSize,
  }: {
    idSuffix: string;
    anchorBarIndex: number;
    lastBarIndex: number;
    price: number;
    label: string;
    color: string;
    lineStyle: RayReplicaLineStyle;
    labelOffsetBars: number;
    labelSize: RayReplicaLabelSize;
  },
) => {
  if (!Number.isFinite(price)) {
    return;
  }

  pushLabeledLineZone(zones, chartBars, {
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-${idSuffix}`,
    zoneType: "key-level",
    startBarIndex: anchorBarIndex,
    endBarIndex: lastBarIndex,
    price,
    label: `${label} ${formatOverlayPrice(price)}`,
    lineColor: color,
    lineStyle,
    labelPosition: "right",
    labelFillColor: withHexAlpha(color, "b3"),
    labelOffsetBars,
    extendBars: labelOffsetBars,
    labelSize,
  });
};

const pushTpSlZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  {
    idSuffix,
    startBarIndex,
    lastBarIndex,
    price,
    label,
    color,
  }: {
    idSuffix: string;
    startBarIndex: number;
    lastBarIndex: number;
    price: number;
    label: string;
    color: string;
  },
) => {
  if (!Number.isFinite(price)) {
    return;
  }

  pushLabeledLineZone(zones, chartBars, {
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-${idSuffix}`,
    zoneType: "tp-sl",
    startBarIndex,
    endBarIndex: lastBarIndex,
    price,
    label,
    lineColor: color,
    lineStyle: TP_SL_LINE_STYLE,
    labelPosition: "right",
    labelFillColor: withHexAlpha(color, "bf"),
  });
};

const pushSupportResistanceZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  supportResistanceZone: SupportResistanceZone,
) => {
  const startBar = chartBars[supportResistanceZone.startBarIndex];
  const endBar = chartBars[supportResistanceZone.endBarIndex];
  if (!startBar || !endBar) {
    return;
  }

  zones.push({
    id: supportResistanceZone.id,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    zoneType: "support-resistance",
    direction: supportResistanceZone.direction,
    startTs: startBar.ts,
    endTs: endBar.ts,
    startBarIndex: supportResistanceZone.startBarIndex,
    endBarIndex: supportResistanceZone.endBarIndex,
    top: supportResistanceZone.top,
    bottom: supportResistanceZone.bottom,
    meta: {
      style: "support-resistance",
      fillColor: supportResistanceZone.fillColor,
      borderColor: supportResistanceZone.borderColor,
      extendBars: supportResistanceZone.extendBars,
      borderWidth: 1,
      radius: 0,
      lineStyle: "solid",
    },
  });
};

const resolvePivotHigh = (
  chartBars: ChartBar[],
  pivotIndex: number,
  strength: number,
): number | null => {
  if (pivotIndex - strength < 0 || pivotIndex + strength >= chartBars.length) {
    return null;
  }

  const pivotValue = chartBars[pivotIndex]?.h;
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

    if ((chartBars[index]?.h ?? Number.NEGATIVE_INFINITY) > pivotValue) {
      return null;
    }
  }

  return pivotValue;
};

const resolvePivotLow = (
  chartBars: ChartBar[],
  pivotIndex: number,
  strength: number,
): number | null => {
  if (pivotIndex - strength < 0 || pivotIndex + strength >= chartBars.length) {
    return null;
  }

  const pivotValue = chartBars[pivotIndex]?.l;
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

    if ((chartBars[index]?.l ?? Number.POSITIVE_INFINITY) < pivotValue) {
      return null;
    }
  }

  return pivotValue;
};

const pushStructureZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  structure: StructureRecord,
  lineStyle: RayReplicaLineStyle,
  bullColor: string,
  bearColor: string,
) => {
  const structureColor = structure.direction === "short" ? bearColor : bullColor;
  pushLabeledLineZone(zones, chartBars, {
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-${structure.kind}-${zones.length}`,
    zoneType: structure.kind,
    direction: structure.direction,
    startBarIndex: structure.sourceBarIndex,
    endBarIndex: structure.eventBarIndex,
    price: structure.sourcePrice,
    label: structure.label,
    lineColor: structureColor,
    lineStyle,
    labelPosition: "center",
    labelFillColor: withHexAlpha(structureColor, "66"),
  });
};

const pushTrendReversalZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  startBarIndex: number | null,
  price: number | null,
  direction: "long" | "short",
  signalLengthBars: number,
  lineColor: string,
  textColor: string,
  bullColor: string,
  bearColor: string,
) => {
  if (startBarIndex == null || price == null || !Number.isFinite(price)) {
    return;
  }

  const endIndex = Math.min(
    chartBars.length - 1,
    startBarIndex + signalLengthBars,
  );
  pushLabeledLineZone(zones, chartBars, {
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-trend-reversal-${zones.length}`,
    zoneType: "trend-reversal",
    direction,
    startBarIndex,
    endBarIndex: endIndex,
    price,
    label: "Trend Reversal",
    lineColor,
    lineStyle: TREND_REVERSAL_LINE_STYLE,
    labelPosition: "center",
    labelFillColor: withHexAlpha(direction === "short" ? bearColor : bullColor, "b3"),
    labelColor: textColor,
  });
};

const buildRegimeWindows = (
  chartBars: ChartBar[],
  regimeDirection: number[],
  bullColor: string,
  bearColor: string,
): IndicatorWindow[] => {
  const windows: IndicatorWindow[] = [];
  if (!chartBars.length) {
    return windows;
  }

  let segmentStart = 0;
  let currentDirection = regimeDirection[0] >= 0 ? 1 : -1;

  for (let index = 1; index < chartBars.length; index += 1) {
    const direction = regimeDirection[index] >= 0 ? 1 : -1;
    if (direction === currentDirection) {
      continue;
    }

    windows.push({
      id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-regime-${windows.length}`,
      strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
      direction: currentDirection === 1 ? "long" : "short",
      startTs: chartBars[segmentStart].ts,
      endTs: chartBars[index - 1].ts,
      startBarIndex: segmentStart,
      endBarIndex: index - 1,
      tone: currentDirection === 1 ? "bullish" : "bearish",
      meta: {
        style: "background",
        fillColor:
          currentDirection === 1
            ? withHexAlpha(bullColor, "14")
            : withHexAlpha(bearColor, "14"),
      },
    });
    segmentStart = index;
    currentDirection = direction;
  }

  windows.push({
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-regime-${windows.length}`,
    strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
    direction: currentDirection === 1 ? "long" : "short",
    startTs: chartBars[segmentStart].ts,
    endTs: chartBars[chartBars.length - 1].ts,
    startBarIndex: segmentStart,
    endBarIndex: chartBars.length - 1,
    tone: currentDirection === 1 ? "bullish" : "bearish",
    meta: {
      style: "background",
      fillColor:
        currentDirection === 1
          ? withHexAlpha(bullColor, "14")
          : withHexAlpha(bearColor, "14"),
    },
  });

  return windows;
};

const SESSION_WINDOW_COLORS: Record<
  "london" | "new_york" | "tokyo" | "sydney",
  { fill: string; border: string }
> = {
  london: { fill: "#60a5fa14", border: "#60a5fa3d" },
  new_york: { fill: "#34d39914", border: "#34d3993d" },
  tokyo: { fill: "#a78bfa14", border: "#a78bfa3d" },
  sydney: { fill: "#f59e0b14", border: "#f59e0b3d" },
};

const buildSessionDisplayWindows = (
  chartBars: ChartBar[],
  visibility: {
    london: boolean;
    new_york: boolean;
    tokyo: boolean;
    sydney: boolean;
  },
): IndicatorWindow[] => {
  const windows: IndicatorWindow[] = [];
  if (!chartBars.length) {
    return windows;
  }

  let segmentStart: number | null = null;
  let activeSession: "london" | "new_york" | "tokyo" | "sydney" | null = null;

  const pushSegment = (endIndex: number) => {
    if (segmentStart == null || activeSession == null) {
      return;
    }
    const startBar = chartBars[segmentStart];
    const endBar = chartBars[endIndex];
    if (!startBar || !endBar) {
      return;
    }
    const palette = SESSION_WINDOW_COLORS[activeSession];
    windows.push({
      id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-session-${activeSession}-${segmentStart}`,
      strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
      direction: "long",
      tone: "neutral",
      startTs: startBar.ts,
      endTs: endBar.ts,
      startBarIndex: segmentStart,
      endBarIndex: endIndex,
      meta: {
        style: "background",
        label: activeSession,
        fillColor: palette.fill,
        borderColor: palette.border,
      },
    });
  };

  chartBars.forEach((bar, index) => {
    const sessionKey = resolveRayReplicaSessionKey(bar);
    const visibleSession =
      sessionKey &&
      (sessionKey === "london" ||
      sessionKey === "new_york" ||
      sessionKey === "tokyo" ||
      sessionKey === "sydney") &&
      visibility[sessionKey]
        ? sessionKey
        : null;

    if (visibleSession === activeSession) {
      return;
    }

    if (activeSession != null && segmentStart != null) {
      pushSegment(index - 1);
    }
    activeSession = visibleSession;
    segmentStart = visibleSession != null ? index : null;
  });

  if (activeSession != null && segmentStart != null) {
    pushSegment(chartBars.length - 1);
  }

  return windows;
};

export function createRayReplicaPineRuntimeAdapter(
  script: PineScriptRecord,
): IndicatorPlugin {
  return {
    id: script.scriptKey,
    liveUpdateMode: "defer-on-tail-patch",
    compute({ chartBars, dailyBars, settings, timeframe }): IndicatorPluginOutput {
      if (!chartBars.length) {
        return {};
      }

      const {
        timeHorizon,
        structureLineStyle,
        bosConfirmation,
        chochAtrBuffer,
        chochBodyExpansionAtr,
        chochVolumeGate,
        basisLength,
        atrLength,
        atrSmoothing,
        volatilityMultiplier,
        wireSpread,
        shadowLength,
        shadowStdDev,
        adxLength,
        volumeMaLength,
        mtf1,
        mtf2,
        mtf3,
        requireMtf1,
        requireMtf2,
        requireMtf3,
        signalFiltersEnabled,
        requireAdx,
        adxMin,
        requireVolScoreRange,
        volScoreMin,
        volScoreMax,
        restrictToSelectedSessions,
        sessions,
        signalOffsetAtr,
        tp1Rr,
        tp2Rr,
        tp3Rr,
        dashboardPosition,
        dashboardSize,
        showWires,
        showShadow,
        showKeyLevels,
        showBos,
        showChoch,
        showSwings,
        showTrendReversal,
        showOrderBlocks,
        showSupportResistance,
        showTpSl,
        showDashboard,
        showRegimeWindows,
        colorCandles,
        waitForBarClose,
        trendReversalLengthBars,
        trendReversalLineColor,
        trendReversalTextColor,
        orderBlockMaxActivePerSide,
        supportResistancePivotStrength,
        supportResistanceMinZoneDistancePercent,
        supportResistanceThicknessMultiplier,
        supportResistanceMaxZones,
        supportResistanceExtensionBars,
        keyLevelLineStyle,
        keyLevelLabelSize,
        keyLevelLabelOffsetBars,
        showPriorDayHigh,
        showPriorDayLow,
        showPriorDayClose,
        showTodayOpen,
        showPriorWeekHigh,
        showPriorWeekLow,
        bullColor,
        bearColor,
        orderBlockBullColor,
        orderBlockBearColor,
        supportZoneColor,
        resistanceZoneColor,
        keyLevelHighColor,
        keyLevelLowColor,
        keyLevelCloseColor,
        keyLevelOpenColor,
        shadowColor,
        filteredCandleColor,
        showLondonSession,
        showNewYorkSession,
        showTokyoSession,
        showSydneySession,
        visibleTimeframes,
        showLastBarOnly,
        plotOverrides,
      } = resolveRayReplicaRuntimeSettings(settings);
      const normalizedTimeframe = normalizeRayReplicaTimeframe(timeframe);
      if (
        visibleTimeframes.length &&
        (!normalizedTimeframe || !visibleTimeframes.includes(normalizedTimeframe))
      ) {
        return {};
      }
      const closes = chartBars.map((bar) => bar.c);
      const basis = computeRayReplicaWma(closes, basisLength);
      const atrRaw = computeAtr(chartBars, atrLength);
      const atrSmoothed = computeSma(atrRaw, atrSmoothing);
      const adx = computeAdx(chartBars, adxLength);
      const volumeSma = computeSma(
        chartBars.map((bar) => bar.v),
        volumeMaLength,
      );
      const upperBand = basis.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(atrSmoothed[index])
          ? Number(
              (value + atrSmoothed[index] * volatilityMultiplier).toFixed(6),
            )
          : Number.NaN,
      );
      const lowerBand = basis.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(atrSmoothed[index])
          ? Number(
              (value - atrSmoothed[index] * volatilityMultiplier).toFixed(6),
            )
          : Number.NaN,
      );
      const bbMid = computeSma(closes, shadowLength);
      const bbDev = computeStandardDeviation(closes, shadowLength).map(
        (value) =>
          Number.isFinite(value)
            ? Number((value * shadowStdDev).toFixed(6))
            : Number.NaN,
      );
      const bbUpper = bbMid.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(bbDev[index])
          ? Number((value + bbDev[index]).toFixed(6))
          : Number.NaN,
      );
      const bbLower = bbMid.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(bbDev[index])
          ? Number((value - bbDev[index]).toFixed(6))
          : Number.NaN,
      );
      const volatilityScore = computeRayReplicaVolatilityScore(
        chartBars,
        shadowLength,
        shadowStdDev,
      );
      const signalEvaluation = evaluateRayReplicaSignals({
        chartBars,
        settings: {
          timeHorizon,
          bosConfirmation,
          chochAtrBuffer,
          chochBodyExpansionAtr,
          chochVolumeGate,
          basisLength,
          atrLength,
          atrSmoothing,
          volatilityMultiplier,
          shadowLength,
          shadowStdDev,
          adxLength,
          volumeMaLength,
          mtf1,
          mtf2,
          mtf3,
          signalFiltersEnabled,
          requireMtf1,
          requireMtf2,
          requireMtf3,
          requireAdx,
          adxMin,
          requireVolScoreRange,
          volScoreMin,
          volScoreMax,
          restrictToSelectedSessions,
          sessions: sessions as CoreRayReplicaSessionOption[],
          waitForBarClose,
          signalOffsetAtr,
        } as Parameters<typeof evaluateRayReplicaSignals>[0]["settings"],
        includeProvisionalSignals: true,
      });
      const structureEventByBarIndex = new Map(
        signalEvaluation.structureEvents
          .filter(
            (event) =>
              event.eventType === "bullish_choch" ||
              event.eventType === "bearish_choch",
          )
          .map((event) => [`${event.barIndex}:${event.direction}`, event] as const),
      );
      const signalEventByBarIndex = new Map(
        signalEvaluation.signalEvents.map((event) => [event.barIndex, event]),
      );

      const markers: ChartMarker[] = [];
      const events: IndicatorEvent[] = [];
      const fillZones: IndicatorZone[] = [];
      const zones: IndicatorZone[] = [];
      const barStyleByIndex = new Array<ChartBarStyle | null>(
        chartBars.length,
      ).fill(null);
      const regimeDirection = new Array<number>(chartBars.length).fill(1);
      const bullMain = new Array<number>(chartBars.length).fill(Number.NaN);
      const bearMain = new Array<number>(chartBars.length).fill(Number.NaN);
      const bullWires = Array.from({ length: 3 }, () =>
        new Array<number>(chartBars.length).fill(Number.NaN),
      );
      const bearWires = Array.from({ length: 3 }, () =>
        new Array<number>(chartBars.length).fill(Number.NaN),
      );
      const medianBarInterval = resolveMedianPositiveBarInterval(chartBars);

      let trendDirection = 1;
      let marketStructureDirection = 0;
      let lastSwingHigh = Number.NaN;
      let previousSwingHigh = Number.NaN;
      let lastSwingHighBarIndex: number | null = null;
      let lastSwingLow = Number.NaN;
      let previousSwingLow = Number.NaN;
      let lastSwingLowBarIndex: number | null = null;
      let breakableHigh = Number.NaN;
      let breakableHighBarIndex: number | null = null;
      let breakableLow = Number.NaN;
      let breakableLowBarIndex: number | null = null;
      const activeBullOrderBlocks: ActiveOrderBlock[] = [];
      const activeBearOrderBlocks: ActiveOrderBlock[] = [];
      const supportResistanceZones: SupportResistanceZone[] = [];
      let activeTpSlOverlay: ActiveTpSlOverlay | null = null;
      let lastFlipBarIndex = 0;
      let lastHardCutBarIndex = Number.NEGATIVE_INFINITY;
      let previousActiveRegimeDirection: number | null = null;

      const passesChochFilters = (
        index: number,
        direction: "long" | "short",
        pivotLevel: number,
      ) => {
        const currentBar = chartBars[index];
        if (!currentBar || !Number.isFinite(pivotLevel)) {
          return false;
        }

        const currentAtr = atrRaw[index];
        const atrBuffer =
          Number.isFinite(currentAtr) && chochAtrBuffer > 0
            ? currentAtr * chochAtrBuffer
            : 0;
        const breakThreshold =
          direction === "long" ? pivotLevel + atrBuffer : pivotLevel - atrBuffer;
        const hasBufferedBreak =
          direction === "long"
            ? bosConfirmation === "wicks"
              ? currentBar.h > breakThreshold
              : currentBar.c > breakThreshold
            : bosConfirmation === "wicks"
              ? currentBar.l < breakThreshold
              : currentBar.c < breakThreshold;

        if (!hasBufferedBreak) {
          return false;
        }

        if (chochBodyExpansionAtr > 0) {
          if (!Number.isFinite(currentAtr)) {
            return false;
          }
          const candleBody = Math.abs(currentBar.c - currentBar.o);
          if (candleBody < currentAtr * chochBodyExpansionAtr) {
            return false;
          }
        }

        if (chochVolumeGate > 0) {
          const baselineVolume = volumeSma[index];
          if (
            !Number.isFinite(baselineVolume) ||
            currentBar.v < baselineVolume * chochVolumeGate
          ) {
            return false;
          }
        }

        return true;
      };

      const clearBullWiresAt = (index: number) => {
        bullMain[index] = Number.NaN;
        bullWires.forEach((wire) => {
          wire[index] = Number.NaN;
        });
      };

      const clearBearWiresAt = (index: number) => {
        bearMain[index] = Number.NaN;
        bearWires.forEach((wire) => {
          wire[index] = Number.NaN;
        });
      };

      const resetMarketStructureState = () => {
        marketStructureDirection = 0;
        lastSwingHigh = Number.NaN;
        previousSwingHigh = Number.NaN;
        lastSwingHighBarIndex = null;
        lastSwingLow = Number.NaN;
        previousSwingLow = Number.NaN;
        lastSwingLowBarIndex = null;
        breakableHigh = Number.NaN;
        breakableHighBarIndex = null;
        breakableLow = Number.NaN;
        breakableLowBarIndex = null;
        activeBullOrderBlocks.length = 0;
        activeBearOrderBlocks.length = 0;
      };

      for (let index = 0; index < chartBars.length; index += 1) {
        const currentBar = chartBars[index];

        if (hasHardBarTimeGap(chartBars, index, medianBarInterval)) {
          resetMarketStructureState();
          lastHardCutBarIndex = index;
          lastFlipBarIndex = index;
          previousActiveRegimeDirection = null;
          if (Number.isFinite(basis[index])) {
            trendDirection = currentBar.c >= basis[index] ? 1 : -1;
          }
          regimeDirection[index] = trendDirection;
          clearBullWiresAt(index);
          clearBearWiresAt(index);
          continue;
        }

        if (
          index >= 5 &&
          index - lastHardCutBarIndex >= 5 &&
          Number.isFinite(basis[index]) &&
          Number.isFinite(basis[index - 5])
        ) {
          if (basis[index] > basis[index - 5]) {
            trendDirection = 1;
          } else if (basis[index] < basis[index - 5]) {
            trendDirection = -1;
          }
        }

        const pivotIndex = index - timeHorizon;
        if (
          pivotIndex >= timeHorizon &&
          pivotIndex - lastHardCutBarIndex >= timeHorizon
        ) {
          const pivotHigh = resolvePivotHigh(
            chartBars,
            pivotIndex,
            timeHorizon,
          );
          if (pivotHigh != null) {
            const resolvedPivotHigh = pivotHigh;
            previousSwingHigh = lastSwingHigh;
            lastSwingHigh = resolvedPivotHigh;
            lastSwingHighBarIndex = pivotIndex;
            breakableHigh = resolvedPivotHigh;
            breakableHighBarIndex = pivotIndex;

            const bar = chartBars[pivotIndex];
            if (bar && showSwings) {
              const label =
                Number.isFinite(previousSwingHigh) &&
                resolvedPivotHigh > previousSwingHigh
                  ? "HH"
                  : "LH";
              events.push(
                buildEvent(
                  `${script.scriptKey}-swing-high-${pivotIndex}`,
                  bar,
                  pivotIndex,
                  "swing_label",
                  "short",
                  label,
                  {
                    overlay: "badge",
                    variant: "swing",
                    placement: "above",
                    arrow: "down",
                    price: bar.h,
                    background: withHexAlpha("#6b7280", "cc"),
                    borderColor: withHexAlpha("#6b7280", "f2"),
                    textColor: "#ffffff",
                  },
                ),
              );
            }
          }

          const pivotLow = resolvePivotLow(chartBars, pivotIndex, timeHorizon);
          if (pivotLow != null) {
            const resolvedPivotLow = pivotLow;
            previousSwingLow = lastSwingLow;
            lastSwingLow = resolvedPivotLow;
            lastSwingLowBarIndex = pivotIndex;
            breakableLow = resolvedPivotLow;
            breakableLowBarIndex = pivotIndex;

            const bar = chartBars[pivotIndex];
            if (bar && showSwings) {
              const label =
                Number.isFinite(previousSwingLow) &&
                resolvedPivotLow > previousSwingLow
                  ? "HL"
                  : "LL";
              events.push(
                buildEvent(
                  `${script.scriptKey}-swing-low-${pivotIndex}`,
                  bar,
                  pivotIndex,
                  "swing_label",
                  "long",
                  label,
                  {
                    overlay: "badge",
                    variant: "swing",
                    placement: "below",
                    arrow: "up",
                    price: bar.l,
                    background: withHexAlpha("#6b7280", "cc"),
                    borderColor: withHexAlpha("#6b7280", "f2"),
                    textColor: "#ffffff",
                  },
                ),
              );
            }
          }
        }

        if (showSupportResistance) {
          const supportResistancePivotIndex =
            index - supportResistancePivotStrength;
          if (supportResistancePivotIndex >= supportResistancePivotStrength) {
            const currentClose = chartBars[index]?.c ?? Number.NaN;
            const currentAtr = atrRaw[index];
            const thickness = Number.isFinite(currentAtr)
              ? currentAtr * supportResistanceThicknessMultiplier
              : Number.NaN;

            const isTooCloseToExistingZone = (price: number) =>
              supportResistanceZones.some((zone) => {
                const midpoint = (zone.top + zone.bottom) / 2;
                return (
                  Number.isFinite(currentClose) &&
                  currentClose !== 0 &&
                  Math.abs(price - midpoint) / currentClose * 100 <
                    supportResistanceMinZoneDistancePercent
                );
              });

            const pivotResistance = resolvePivotHigh(
              chartBars,
              supportResistancePivotIndex,
              supportResistancePivotStrength,
            );
            if (
              typeof pivotResistance === "number" &&
              Number.isFinite(thickness) &&
              !isTooCloseToExistingZone(pivotResistance)
            ) {
              const targetEndIndex =
                index + supportResistanceExtensionBars;
              supportResistanceZones.push({
                id: `${script.scriptKey}-sr-resistance-${supportResistancePivotIndex}`,
                direction: "short",
                startBarIndex: supportResistancePivotIndex,
                endBarIndex: Math.min(chartBars.length - 1, targetEndIndex),
                extendBars: Math.max(0, targetEndIndex - (chartBars.length - 1)),
                top: Number((pivotResistance + thickness / 2).toFixed(6)),
                bottom: Number((pivotResistance - thickness / 2).toFixed(6)),
                fillColor: resistanceZoneColor,
                borderColor: withHexAlpha(
                  resolveSolidHexColor(resistanceZoneColor, "#ef4444"),
                  "70",
                ),
              });
            }

            const pivotSupport = resolvePivotLow(
              chartBars,
              supportResistancePivotIndex,
              supportResistancePivotStrength,
            );
            if (
              typeof pivotSupport === "number" &&
              Number.isFinite(thickness) &&
              !isTooCloseToExistingZone(pivotSupport)
            ) {
              const targetEndIndex =
                index + supportResistanceExtensionBars;
              supportResistanceZones.push({
                id: `${script.scriptKey}-sr-support-${supportResistancePivotIndex}`,
                direction: "long",
                startBarIndex: supportResistancePivotIndex,
                endBarIndex: Math.min(chartBars.length - 1, targetEndIndex),
                extendBars: Math.max(0, targetEndIndex - (chartBars.length - 1)),
                top: Number((pivotSupport + thickness / 2).toFixed(6)),
                bottom: Number((pivotSupport - thickness / 2).toFixed(6)),
                fillColor: supportZoneColor,
                borderColor: withHexAlpha(
                  resolveSolidHexColor(supportZoneColor, "#22c55e"),
                  "70",
                ),
              });
            }

            while (supportResistanceZones.length > supportResistanceMaxZones) {
              supportResistanceZones.shift();
            }
          }
        }

        let bullishBos = false;
        let bearishBos = false;
        let bullishChoch = false;
        let bearishChoch = false;
        let reversalAnchorBarIndex: number | null = null;
        let reversalAnchorPrice: number | null = null;
        let reversalDirection: "long" | "short" | null = null;

        if (
          Number.isFinite(breakableHigh) &&
          (bosConfirmation === "wicks"
            ? currentBar.h > breakableHigh
            : currentBar.c > breakableHigh)
        ) {
          if (marketStructureDirection === 1) {
            bullishBos = true;
            breakableHigh = Number.NaN;
            breakableHighBarIndex = null;
          } else if (passesChochFilters(index, "long", breakableHigh)) {
            bullishChoch = true;
            lastFlipBarIndex = index;
            reversalAnchorPrice = Number.isFinite(breakableLow)
              ? breakableLow
              : lastSwingLow;
            reversalAnchorBarIndex =
              breakableLowBarIndex ?? lastSwingLowBarIndex;
            reversalDirection = "long";
            marketStructureDirection = 1;
            breakableHigh = Number.NaN;
            breakableHighBarIndex = null;
          }
        }

        if (
          Number.isFinite(breakableLow) &&
          (bosConfirmation === "wicks"
            ? currentBar.l < breakableLow
            : currentBar.c < breakableLow)
        ) {
          if (marketStructureDirection === -1) {
            bearishBos = true;
            breakableLow = Number.NaN;
            breakableLowBarIndex = null;
          } else if (passesChochFilters(index, "short", breakableLow)) {
            bearishChoch = true;
            lastFlipBarIndex = index;
            reversalAnchorPrice = Number.isFinite(breakableHigh)
              ? breakableHigh
              : lastSwingHigh;
            reversalAnchorBarIndex =
              breakableHighBarIndex ?? lastSwingHighBarIndex;
            reversalDirection = "short";
            marketStructureDirection = -1;
            breakableLow = Number.NaN;
            breakableLowBarIndex = null;
          }
        }

        const activeRegimeDirection =
          marketStructureDirection !== 0
            ? marketStructureDirection
            : trendDirection;
        regimeDirection[index] = activeRegimeDirection;
        const structureEvent =
          structureEventByBarIndex.get(`${index}:long`) ??
          structureEventByBarIndex.get(`${index}:short`);
        const signalEvent = signalEventByBarIndex.get(index);
        const passesSignalGates =
          Boolean(structureEvent?.filterState?.passes) &&
          ((bullishChoch && structureEvent?.direction === "long") ||
            (bearishChoch && structureEvent?.direction === "short"));

        if (
          showBos &&
          bullishBos &&
          lastSwingHighBarIndex != null &&
          Number.isFinite(lastSwingHigh)
        ) {
          pushStructureZone(zones, chartBars, {
            kind: "bos",
            direction: "long",
            sourceBarIndex: lastSwingHighBarIndex,
            sourcePrice: lastSwingHigh,
            eventBarIndex: index,
            label: "BOS",
          }, structureLineStyle, bullColor, bearColor);
        }

        if (
          showBos &&
          bearishBos &&
          lastSwingLowBarIndex != null &&
          Number.isFinite(lastSwingLow)
        ) {
          pushStructureZone(zones, chartBars, {
            kind: "bos",
            direction: "short",
            sourceBarIndex: lastSwingLowBarIndex,
            sourcePrice: lastSwingLow,
            eventBarIndex: index,
            label: "BOS",
          }, structureLineStyle, bullColor, bearColor);
        }

        if (
          showChoch &&
          bullishChoch &&
          lastSwingHighBarIndex != null &&
          Number.isFinite(lastSwingHigh)
        ) {
          pushStructureZone(zones, chartBars, {
            kind: "choch",
            direction: "long",
            sourceBarIndex: lastSwingHighBarIndex,
            sourcePrice: lastSwingHigh,
            eventBarIndex: index,
            label: "CHOCH",
          }, structureLineStyle, bullColor, bearColor);
        }

        if (
          showChoch &&
          bearishChoch &&
          lastSwingLowBarIndex != null &&
          Number.isFinite(lastSwingLow)
        ) {
          pushStructureZone(zones, chartBars, {
            kind: "choch",
            direction: "short",
            sourceBarIndex: lastSwingLowBarIndex,
            sourcePrice: lastSwingLow,
            eventBarIndex: index,
            label: "CHOCH",
          }, structureLineStyle, bullColor, bearColor);
        }

        if (showTrendReversal && reversalDirection) {
          pushTrendReversalZone(
            zones,
            chartBars,
            reversalAnchorBarIndex,
            reversalAnchorPrice,
            reversalDirection,
            trendReversalLengthBars,
            trendReversalLineColor,
            trendReversalTextColor,
            bullColor,
            bearColor,
          );
        }

        if (
          (bullishBos || bullishChoch) &&
          Number.isFinite(lastSwingHigh)
        ) {
          events.push(
            buildEvent(
              `${script.scriptKey}-bull-break-${index}`,
              chartBars[index],
              index,
              "bull_break",
              "long",
              "Bull Break",
              {
                overlay: "dot",
                price: lastSwingHigh,
                color: bullColor,
                borderColor: withHexAlpha(bullColor, "f2"),
                size: 8,
              },
            ),
          );
        }

        if (
          (bearishBos || bearishChoch) &&
          Number.isFinite(lastSwingLow)
        ) {
          events.push(
            buildEvent(
              `${script.scriptKey}-bear-break-${index}`,
              chartBars[index],
              index,
              "bear_break",
              "short",
              "Bear Break",
              {
                overlay: "dot",
                price: lastSwingLow,
                color: bearColor,
                borderColor: withHexAlpha(bearColor, "f2"),
                size: 8,
              },
            ),
          );
        }

        if (showBos && bullishBos) {
          events.push(
            buildEvent(
              `${script.scriptKey}-bos-event-long-${index}`,
              chartBars[index],
              index,
              "bullish_bos",
              "long",
              "▲",
              {
                overlay: "badge",
                variant: "triangle",
                placement: "below",
                price: currentBar.l,
                background: withHexAlpha(bullColor, "cc"),
                borderColor: withHexAlpha(bullColor, "f2"),
                textColor: "#ffffff",
              },
            ),
          );
        }

        if (showBos && bearishBos) {
          events.push(
            buildEvent(
              `${script.scriptKey}-bos-event-short-${index}`,
              chartBars[index],
              index,
              "bearish_bos",
              "short",
              "▼",
              {
                overlay: "badge",
                variant: "triangle",
                placement: "above",
                price: currentBar.h,
                background: withHexAlpha(bearColor, "cc"),
                borderColor: withHexAlpha(bearColor, "f2"),
                textColor: "#ffffff",
              },
            ),
          );
        }

        if (signalEvent?.direction === "long" && passesSignalGates) {
          events.push(
            buildEvent(
              `${script.scriptKey}-signal-long-${index}`,
              chartBars[index],
              index,
              "buy_signal",
              "long",
              "BUY",
              {
                overlay: "badge",
                variant: "signal",
                placement: "below",
                arrow: "up",
                price: signalEvent.price,
                background: bullColor,
                borderColor: withHexAlpha(bullColor, "f2"),
                textColor: "#ffffff",
              },
            ),
          );
        }

        if (showChoch && bullishChoch) {
          events.push(
            buildEvent(
              `${script.scriptKey}-choch-event-long-${index}`,
              chartBars[index],
              index,
              "bullish_choch",
              "long",
              passesSignalGates ? "BUY" : "CHOCH",
              passesSignalGates
                ? undefined
                : {
                    gated: true,
                  },
            ),
          );
        }

        if (signalEvent?.direction === "short" && passesSignalGates) {
          events.push(
            buildEvent(
              `${script.scriptKey}-signal-short-${index}`,
              chartBars[index],
              index,
              "sell_signal",
              "short",
              "SELL",
              {
                overlay: "badge",
                variant: "signal",
                placement: "above",
                arrow: "down",
                price: signalEvent.price,
                background: bearColor,
                borderColor: withHexAlpha(bearColor, "f2"),
                textColor: "#ffffff",
              },
            ),
          );
        }

        if (showChoch && bearishChoch) {
          events.push(
            buildEvent(
              `${script.scriptKey}-choch-event-short-${index}`,
              chartBars[index],
              index,
              "bearish_choch",
              "short",
              passesSignalGates ? "SELL" : "CHOCH",
              passesSignalGates
                ? undefined
                : {
                    gated: true,
                  },
            ),
          );
        }

        if (showTpSl && bullishChoch && passesSignalGates) {
          const stopLoss = Number.isFinite(lastSwingLow)
            ? lastSwingLow
            : chartBars[index].l;
          const risk = Math.abs(chartBars[index].c - stopLoss);
          activeTpSlOverlay = {
            direction: "long",
            startBarIndex: index,
            stopLoss,
            takeProfit1: Number((chartBars[index].c + risk * tp1Rr).toFixed(6)),
            takeProfit2: Number((chartBars[index].c + risk * tp2Rr).toFixed(6)),
            takeProfit3: Number((chartBars[index].c + risk * tp3Rr).toFixed(6)),
          };
        }

        if (showTpSl && bearishChoch && passesSignalGates) {
          const stopLoss = Number.isFinite(lastSwingHigh)
            ? lastSwingHigh
            : chartBars[index].h;
          const risk = Math.abs(chartBars[index].c - stopLoss);
          activeTpSlOverlay = {
            direction: "short",
            startBarIndex: index,
            stopLoss,
            takeProfit1: Number((chartBars[index].c - risk * tp1Rr).toFixed(6)),
            takeProfit2: Number((chartBars[index].c - risk * tp2Rr).toFixed(6)),
            takeProfit3: Number((chartBars[index].c - risk * tp3Rr).toFixed(6)),
          };
        }

        if (showOrderBlocks) {
          if (
            (bullishBos || bullishChoch) &&
            lastSwingLowBarIndex != null &&
            chartBars[lastSwingLowBarIndex]
          ) {
            const orderBlockBar = chartBars[lastSwingLowBarIndex];
            activeBullOrderBlocks.push({
              id: `${script.scriptKey}-bull-ob-${index}`,
              direction: "long",
              startBarIndex: lastSwingLowBarIndex,
              endBarIndex: index,
              top: orderBlockBar.h,
              bottom: orderBlockBar.l,
              label: `BULL OB +++ ${formatCompactVolume(orderBlockBar.v)}`,
            });
            while (activeBullOrderBlocks.length > orderBlockMaxActivePerSide) {
              activeBullOrderBlocks.shift();
            }
          }

          if (
            (bearishBos || bearishChoch) &&
            lastSwingHighBarIndex != null &&
            chartBars[lastSwingHighBarIndex]
          ) {
            const orderBlockBar = chartBars[lastSwingHighBarIndex];
            activeBearOrderBlocks.push({
              id: `${script.scriptKey}-bear-ob-${index}`,
              direction: "short",
              startBarIndex: lastSwingHighBarIndex,
              endBarIndex: index,
              top: orderBlockBar.h,
              bottom: orderBlockBar.l,
              label: `BEAR OB +++ ${formatCompactVolume(orderBlockBar.v)}`,
            });
            while (activeBearOrderBlocks.length > orderBlockMaxActivePerSide) {
              activeBearOrderBlocks.shift();
            }
          }

          for (
            let orderBlockIndex = activeBullOrderBlocks.length - 1;
            orderBlockIndex >= 0;
            orderBlockIndex -= 1
          ) {
            const orderBlock = activeBullOrderBlocks[orderBlockIndex];
            orderBlock.endBarIndex = index;
            if (chartBars[index].c < orderBlock.bottom) {
              activeBullOrderBlocks.splice(orderBlockIndex, 1);
            }
          }

          for (
            let orderBlockIndex = activeBearOrderBlocks.length - 1;
            orderBlockIndex >= 0;
            orderBlockIndex -= 1
          ) {
            const orderBlock = activeBearOrderBlocks[orderBlockIndex];
            orderBlock.endBarIndex = index;
            if (chartBars[index].c > orderBlock.top) {
              activeBearOrderBlocks.splice(orderBlockIndex, 1);
            }
          }
        }

        const trendLine =
          activeRegimeDirection === 1 ? lowerBand[index] : upperBand[index];
        const reaction =
          Number.isFinite(trendLine) &&
          chartBars[index].l <= trendLine &&
          chartBars[index].h >= trendLine;

        const wireDirection = activeRegimeDirection === 1 ? -1 : 1;
        const wireStep = Number.isFinite(atrSmoothed[index])
          ? atrSmoothed[index] * wireSpread
          : Number.NaN;
        const regimeFlipped =
          previousActiveRegimeDirection != null &&
          previousActiveRegimeDirection !== activeRegimeDirection;
        if (regimeFlipped) {
          clearBullWiresAt(index);
          clearBearWiresAt(index);
        }

        if (
          !regimeFlipped &&
          activeRegimeDirection === 1 &&
          Number.isFinite(lowerBand[index])
        ) {
          bullMain[index] = lowerBand[index];
          if (Number.isFinite(wireStep)) {
            bullWires[0][index] = Number(
              (trendLine + wireDirection * wireStep).toFixed(6),
            );
            bullWires[1][index] = Number(
              (trendLine + wireDirection * wireStep * 2).toFixed(6),
            );
            bullWires[2][index] = Number(
              (trendLine + wireDirection * wireStep * 3).toFixed(6),
            );
          }
        } else if (
          !regimeFlipped &&
          activeRegimeDirection === -1 &&
          Number.isFinite(upperBand[index])
        ) {
          bearMain[index] = upperBand[index];
          if (Number.isFinite(wireStep)) {
            bearWires[0][index] = Number(
              (trendLine + wireDirection * wireStep).toFixed(6),
            );
            bearWires[1][index] = Number(
              (trendLine + wireDirection * wireStep * 2).toFixed(6),
            );
            bearWires[2][index] = Number(
              (trendLine + wireDirection * wireStep * 3).toFixed(6),
            );
          }
        }
        previousActiveRegimeDirection = activeRegimeDirection;

        if (showShadow) {
          pushFilledBarZone(
            fillZones,
            chartBars,
            index,
            bbUpper[index],
            bbLower[index],
            withHexAlpha(resolveSolidHexColor(shadowColor, "#787b86"), "18"),
          );
        }

        if (
          showWires &&
          reaction &&
          activeRegimeDirection === 1 &&
          Number.isFinite(bullMain[index]) &&
          Number.isFinite(bullWires[0][index])
        ) {
          pushFilledBarZone(
            fillZones,
            chartBars,
            index,
            bullMain[index],
            bullWires[0][index],
            withHexAlpha(bullColor, "38"),
          );
        }

        if (
          showWires &&
          reaction &&
          activeRegimeDirection === -1 &&
          Number.isFinite(bearMain[index]) &&
          Number.isFinite(bearWires[0][index])
        ) {
          pushFilledBarZone(
            fillZones,
            chartBars,
            index,
            bearMain[index],
            bearWires[0][index],
            withHexAlpha(bearColor, "38"),
          );
        }

        if (colorCandles) {
          const filteredSignal =
            Boolean(structureEvent?.filterState?.enabled) &&
            !structureEvent?.filterState?.passes &&
            (bullishChoch || bearishChoch);
          const candleColor = filteredSignal
            ? filteredCandleColor
            : reaction
              ? REACTION_COLOR
              : activeRegimeDirection === 1
                ? bullColor
                : bearColor;
          barStyleByIndex[index] = {
            color: candleColor,
            borderColor: candleColor,
            wickColor: candleColor,
          };
        }
      }

      if (showOrderBlocks) {
        activeBullOrderBlocks.forEach((orderBlock, index) => {
          const startBar = chartBars[orderBlock.startBarIndex];
          const endBar = chartBars[orderBlock.endBarIndex];
          if (!startBar || !endBar) {
            return;
          }

          zones.push({
            id: `${orderBlock.id}-${index}`,
            strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
            zoneType: "order-block",
            direction: orderBlock.direction,
            startTs: startBar.ts,
            endTs: endBar.ts,
            startBarIndex: orderBlock.startBarIndex,
            endBarIndex: orderBlock.endBarIndex,
            top: orderBlock.top,
            bottom: orderBlock.bottom,
            label: orderBlock.label,
            meta: {
              fillColor: orderBlockBullColor,
              borderVisible: false,
              labelPosition: "center",
              labelVariant: "plain",
              labelColor: "#ffffff",
              radius: 0,
            },
          });
        });
        activeBearOrderBlocks.forEach((orderBlock, index) => {
          const startBar = chartBars[orderBlock.startBarIndex];
          const endBar = chartBars[orderBlock.endBarIndex];
          if (!startBar || !endBar) {
            return;
          }

          zones.push({
            id: `${orderBlock.id}-${index}`,
            strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
            zoneType: "order-block",
            direction: orderBlock.direction,
            startTs: startBar.ts,
            endTs: endBar.ts,
            startBarIndex: orderBlock.startBarIndex,
            endBarIndex: orderBlock.endBarIndex,
            top: orderBlock.top,
            bottom: orderBlock.bottom,
            label: orderBlock.label,
            meta: {
              fillColor: orderBlockBearColor,
              borderVisible: false,
              labelPosition: "center",
              labelVariant: "plain",
              labelColor: "#ffffff",
              radius: 0,
            },
          });
        });
      }

      if (showSupportResistance) {
        supportResistanceZones.forEach((zone) =>
          pushSupportResistanceZone(zones, chartBars, zone),
        );
      }

      const windows = showRegimeWindows
        ? buildRegimeWindows(chartBars, regimeDirection, bullColor, bearColor)
        : [];
      const keyLevels = showKeyLevels
        ? buildSessionKeyLevelSeries(chartBars, dailyBars)
        : null;
      const lastBarIndex = chartBars.length - 1;
      if (keyLevels && lastBarIndex >= 0) {
        const dayAnchorBarIndex = keyLevels.dayStartBarIndex[lastBarIndex] ?? 0;
        const weekAnchorBarIndex =
          keyLevels.weekStartBarIndex[lastBarIndex] ?? 0;
        if (showPriorDayHigh) {
          pushKeyLevelZone(zones, chartBars, {
            idSuffix: "pdh",
            anchorBarIndex: dayAnchorBarIndex,
            lastBarIndex,
            price: keyLevels.pdh[lastBarIndex],
            label: "PDH",
            color: keyLevelHighColor,
            lineStyle: keyLevelLineStyle,
            labelOffsetBars: keyLevelLabelOffsetBars,
            labelSize: keyLevelLabelSize,
          });
        }
        if (showPriorDayLow) {
          pushKeyLevelZone(zones, chartBars, {
            idSuffix: "pdl",
            anchorBarIndex: dayAnchorBarIndex,
            lastBarIndex,
            price: keyLevels.pdl[lastBarIndex],
            label: "PDL",
            color: keyLevelLowColor,
            lineStyle: keyLevelLineStyle,
            labelOffsetBars: keyLevelLabelOffsetBars,
            labelSize: keyLevelLabelSize,
          });
        }
        if (showPriorDayClose) {
          pushKeyLevelZone(zones, chartBars, {
            idSuffix: "pdc",
            anchorBarIndex: dayAnchorBarIndex,
            lastBarIndex,
            price: keyLevels.pdc[lastBarIndex],
            label: "PDC",
            color: keyLevelCloseColor,
            lineStyle: keyLevelLineStyle,
            labelOffsetBars: keyLevelLabelOffsetBars,
            labelSize: keyLevelLabelSize,
          });
        }
        if (showTodayOpen) {
          pushKeyLevelZone(zones, chartBars, {
            idSuffix: "open",
            anchorBarIndex: dayAnchorBarIndex,
            lastBarIndex,
            price: keyLevels.todayOpen[lastBarIndex],
            label: "O",
            color: keyLevelOpenColor,
            lineStyle: keyLevelLineStyle,
            labelOffsetBars: keyLevelLabelOffsetBars,
            labelSize: keyLevelLabelSize,
          });
        }
        if (showPriorWeekHigh) {
          pushKeyLevelZone(zones, chartBars, {
            idSuffix: "pwh",
            anchorBarIndex: weekAnchorBarIndex,
            lastBarIndex,
            price: keyLevels.pwh[lastBarIndex],
            label: "PWH",
            color: keyLevelHighColor,
            lineStyle: keyLevelLineStyle,
            labelOffsetBars: keyLevelLabelOffsetBars,
            labelSize: keyLevelLabelSize,
          });
        }
        if (showPriorWeekLow) {
          pushKeyLevelZone(zones, chartBars, {
            idSuffix: "pwl",
            anchorBarIndex: weekAnchorBarIndex,
            lastBarIndex,
            price: keyLevels.pwl[lastBarIndex],
            label: "PWL",
            color: keyLevelLowColor,
            lineStyle: keyLevelLineStyle,
            labelOffsetBars: keyLevelLabelOffsetBars,
            labelSize: keyLevelLabelSize,
          });
        }
      }

      if (showTpSl && activeTpSlOverlay) {
        pushTpSlZone(zones, chartBars, {
          idSuffix: "sl",
          startBarIndex: activeTpSlOverlay.startBarIndex,
          lastBarIndex,
          price: activeTpSlOverlay.stopLoss,
          label: "SL",
          color: STOP_LOSS_COLOR,
        });
        pushTpSlZone(zones, chartBars, {
          idSuffix: "tp1",
          startBarIndex: activeTpSlOverlay.startBarIndex,
          lastBarIndex,
          price: activeTpSlOverlay.takeProfit1,
          label: "TP 1",
          color: TAKE_PROFIT_COLOR,
        });
        pushTpSlZone(zones, chartBars, {
          idSuffix: "tp2",
          startBarIndex: activeTpSlOverlay.startBarIndex,
          lastBarIndex,
          price: activeTpSlOverlay.takeProfit2,
          label: "TP 2",
          color: TAKE_PROFIT_COLOR,
        });
        pushTpSlZone(zones, chartBars, {
          idSuffix: "tp3",
          startBarIndex: activeTpSlOverlay.startBarIndex,
          lastBarIndex,
          price: activeTpSlOverlay.takeProfit3,
          label: "TP 3",
          color: TAKE_PROFIT_COLOR,
        });
      }

      if (showDashboard && lastBarIndex >= 0) {
        const lastBar = chartBars[lastBarIndex];
        const currentAdx = adx[lastBarIndex];
        const currentVolatility = volatilityScore[lastBarIndex];
        const trendAge = Math.max(0, lastBarIndex - lastFlipBarIndex);
        const trendAgeLabel =
          trendAge > 50 ? "OLD" : trendAge > 20 ? "MATURE" : "NEW";
        const strengthText =
          Number.isFinite(currentAdx) && currentAdx >= 25 ? "Strong" : "Weak";
        const volatilityText = Number.isFinite(currentVolatility)
          ? `${Math.round(currentVolatility)}/10`
          : "--/10";
        const mtfConfigs = [
          { timeframe: mtf1, label: formatDashboardTimeframe(mtf1) },
          { timeframe: mtf2, label: formatDashboardTimeframe(mtf2) },
          { timeframe: mtf3, label: formatDashboardTimeframe(mtf3) },
        ].map(({ timeframe: mtfTimeframe, label }) => {
          const mtfBars = aggregateRayReplicaBarsForTimeframe(
            chartBars,
            mtfTimeframe,
          );
          const direction = resolveRayReplicaTrendDirection(
            mtfBars,
            basisLength,
          );
          return {
            label,
            value: direction === 1 ? "BULL" : "BEAR",
            color: direction === 1 ? bullColor : bearColor,
          };
        });

        events.push({
          id: `${script.scriptKey}-dashboard-${lastBarIndex}`,
          strategy: RAY_REPLICA_PINE_SCRIPT_KEY,
          eventType: "rayreplica_dashboard",
          ts: lastBar.ts,
          time: lastBar.time,
          barIndex: lastBarIndex,
          direction: regimeDirection[lastBarIndex] === 1 ? "long" : "short",
          label: "RayReplica Dashboard",
          meta: {
            overlay: "dashboard",
            position: dashboardPosition,
            size: dashboardSize,
            title: "RAYALGO DASHBOARD",
            trendLabel: `${formatDashboardTimeframe(timeframe)} TREND`,
            trendValue:
              regimeDirection[lastBarIndex] === 1 ? "BULLISH" : "BEARISH",
            trendColor:
              regimeDirection[lastBarIndex] === 1 ? bullColor : bearColor,
            rows: [
              {
                label: "STRENGTH",
                value: strengthText,
                color: "#ffffff",
              },
              {
                label: "TREND AGE",
                value: `${trendAgeLabel} (${trendAge})`,
                color: "#ffffff",
              },
              {
                label: "VOLATILITY",
                value: volatilityText,
                color: "#ffffff",
              },
              {
                label: "SESSION",
                value: resolveRayReplicaSessionLabel(lastBar),
                color: "#ffffff",
              },
            ],
            mtf: mtfConfigs,
          },
        });
      }

      const studyPrefix = script.scriptKey;

      return {
        studySpecs: [
          buildLineStudy(
            `${studyPrefix}-bull-main`,
            chartBars,
            bullMain,
            {
              color: bullColor,
              lineWidth: 3,
              priceLineVisible: false,
              lastValueVisible: false,
            },
            { preserveWhitespace: true, renderMode: "line_breaks" },
          ),
          buildLineStudy(
            `${studyPrefix}-bear-main`,
            chartBars,
            bearMain,
            {
              color: bearColor,
              lineWidth: 3,
              priceLineVisible: false,
              lastValueVisible: false,
            },
            { preserveWhitespace: true, renderMode: "line_breaks" },
          ),
          ...(showWires
            ? bullWires.map((values, index) =>
                buildLineStudy(
                  `${studyPrefix}-bull-wire-${index + 1}`,
                  chartBars,
                  values,
                  {
                    color: withHexAlpha(bullColor, "88"),
                    lineWidth: 1,
                    priceLineVisible: false,
                    lastValueVisible: false,
                  },
                  { preserveWhitespace: true, renderMode: "line_breaks" },
                ),
              )
            : []),
          ...(showWires
            ? bearWires.map((values, index) =>
                buildLineStudy(
                  `${studyPrefix}-bear-wire-${index + 1}`,
                  chartBars,
                  values,
                  {
                    color: withHexAlpha(bearColor, "88"),
                    lineWidth: 1,
                    priceLineVisible: false,
                    lastValueVisible: false,
                  },
                  { preserveWhitespace: true, renderMode: "line_breaks" },
                ),
              )
            : []),
          ...(showShadow
            ? [
                buildLineStudy(
                  `${studyPrefix}-shadow-upper`,
                  chartBars,
                  bbUpper,
                  {
                    color: withHexAlpha(
                      resolveSolidHexColor(shadowColor, "#787b86"),
                      "55",
                    ),
                    lineWidth: 1,
                    priceLineVisible: false,
                    lastValueVisible: false,
                  },
                ),
                buildLineStudy(
                  `${studyPrefix}-shadow-lower`,
                  chartBars,
                  bbLower,
                  {
                    color: withHexAlpha(
                      resolveSolidHexColor(shadowColor, "#787b86"),
                      "55",
                    ),
                    lineWidth: 1,
                    priceLineVisible: false,
                    lastValueVisible: false,
                  },
                ),
              ]
            : []),
        ],
        markers,
        events,
        zones: [...fillZones, ...zones],
        windows,
        barStyleByIndex: colorCandles ? barStyleByIndex : undefined,
      };
    },
  };
}
