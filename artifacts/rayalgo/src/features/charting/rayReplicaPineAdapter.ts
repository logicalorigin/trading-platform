import type { PineScriptRecord } from "@workspace/api-client-react";
import type {
  ChartBar,
  ChartBarStyle,
  ChartMarker,
  IndicatorEvent,
  IndicatorPlugin,
  IndicatorPluginOutput,
  IndicatorWindow,
  IndicatorZone,
  StudyPoint,
  StudySpec,
} from "./types";

export const RAY_REPLICA_PINE_SCRIPT_KEY = "rayalgo-replica-smc-pro-v3";

export type RayReplicaBosConfirmation = "close" | "wicks";
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
export type RayReplicaSessionOption =
  | "asia"
  | "london"
  | "new_york_am"
  | "new_york_pm";

export type RayReplicaRuntimeSettings = {
  timeHorizon: number;
  bosConfirmation: RayReplicaBosConfirmation;
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
  requireAdx: boolean;
  adxMin: number;
  requireVolScoreRange: boolean;
  volScoreMin: number;
  volScoreMax: number;
  restrictToSelectedSessions: boolean;
  sessions: RayReplicaSessionOption[];
  tp1Rr: number;
  tp2Rr: number;
  tp3Rr: number;
  dashboardPosition: RayReplicaDashboardPosition;
  dashboardSize: RayReplicaDashboardSize;
  showWires: boolean;
  showShadow: boolean;
  showKeyLevels: boolean;
  showStructure: boolean;
  showOrderBlocks: boolean;
  showSupportResistance: boolean;
  showTpSl: boolean;
  showDashboard: boolean;
  showRegimeWindows: boolean;
  colorCandles: boolean;
  waitForBarClose: boolean;
};

export const DEFAULT_RAY_REPLICA_SETTINGS: RayReplicaRuntimeSettings = {
  timeHorizon: 10,
  bosConfirmation: "close",
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
  requireAdx: false,
  adxMin: 20,
  requireVolScoreRange: false,
  volScoreMin: 25,
  volScoreMax: 85,
  restrictToSelectedSessions: false,
  sessions: ["new_york_am", "new_york_pm"],
  tp1Rr: 0.5,
  tp2Rr: 1,
  tp3Rr: 1.7,
  dashboardPosition: "bottom-right",
  dashboardSize: "small",
  showWires: true,
  showShadow: true,
  showKeyLevels: true,
  showStructure: true,
  showOrderBlocks: true,
  showSupportResistance: false,
  showTpSl: true,
  showDashboard: true,
  showRegimeWindows: true,
  colorCandles: true,
  waitForBarClose: true,
};

const BULL_COLOR = "#00bcd4";
const BEAR_COLOR = "#e91e63";
const SHADOW_COLOR = "#787b86";
const REACTION_COLOR = "#facc15";
const KEY_LEVEL_HIGH_COLOR = "#ef5350";
const KEY_LEVEL_LOW_COLOR = "#26a69a";
const KEY_LEVEL_CLOSE_COLOR = "#9ca3af";
const KEY_LEVEL_OPEN_COLOR = "#facc15";
const ORDER_BLOCK_BULL_COLOR = "#00bcd433";
const ORDER_BLOCK_BEAR_COLOR = "#e91e6333";
const SUPPORT_ZONE_COLOR = "#00bcd440";
const RESISTANCE_ZONE_COLOR = "#e91e6340";
const STOP_LOSS_COLOR = "#ef4444";
const TAKE_PROFIT_COLOR = "#22c55e";
const SHADOW_FILL_COLOR = "#787b8618";
const STRUCTURE_LINE_STYLE = "solid";
const TREND_REVERSAL_LINE_STYLE = "dashed";
const KEY_LEVEL_LINE_STYLE_NAME = "dashed";
const TP_SL_LINE_STYLE = "dashed";
const KEY_LEVEL_LABEL_OFFSET_BARS = 8;
const SUPPORT_RESISTANCE_PIVOT_STRENGTH = 15;
const SUPPORT_RESISTANCE_MIN_ZONE_DISTANCE_PERCENT = 0.05;
const SUPPORT_RESISTANCE_THICKNESS_MULTIPLIER = 0.25;
const SUPPORT_RESISTANCE_MAX_ZONES = 7;
const SUPPORT_RESISTANCE_EXTENSION_BARS = 100;
export const RAY_REPLICA_TIME_HORIZON_OPTIONS = [6, 8, 10, 14, 20] as const;
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
  { value: "asia", label: "Asia" },
  { value: "london", label: "London" },
  { value: "new_york_am", label: "NY AM" },
  { value: "new_york_pm", label: "NY PM" },
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
    bosConfirmation: RayReplicaBosConfirmation;
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

const resolvePercentLikeSetting = (
  value: unknown,
  fallback: number,
): number => {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) {
    return fallback;
  }

  return Number(Math.max(0, Math.min(100, resolved)).toFixed(1));
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
  const bands = asRecord(input.bands);
  const confirmation = asRecord(input.confirmation);
  const infoPanel = asRecord(input.infoPanel);
  const risk = asRecord(input.risk);
  const appearance = asRecord(input.appearance);

  const volScoreMin = resolvePercentLikeSetting(
    confirmation.volScoreMin ?? input.volScoreMin,
    DEFAULT_RAY_REPLICA_SETTINGS.volScoreMin,
  );

  return {
    marketStructure: {
      timeHorizon: resolveIntegerSetting(
        marketStructure.timeHorizon ?? input.timeHorizon,
        DEFAULT_RAY_REPLICA_SETTINGS.timeHorizon,
        3,
        40,
      ),
      bosConfirmation: resolveEnumSetting(
        marketStructure.bosConfirmation ?? input.bosConfirmation,
        RAY_REPLICA_BOS_CONFIRMATION_OPTIONS,
        DEFAULT_RAY_REPLICA_SETTINGS.bosConfirmation,
      ),
    },
    bands: {
      basisLength: resolveIntegerSetting(
        bands.basisLength ?? input.basisLength,
        DEFAULT_RAY_REPLICA_SETTINGS.basisLength,
        5,
        240,
      ),
      atrLength: resolveIntegerSetting(
        bands.atrLength ?? input.atrLength,
        DEFAULT_RAY_REPLICA_SETTINGS.atrLength,
        2,
        100,
      ),
      atrSmoothing: resolveIntegerSetting(
        bands.atrSmoothing ?? input.atrSmoothing,
        DEFAULT_RAY_REPLICA_SETTINGS.atrSmoothing,
        2,
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
        2,
        100,
      ),
      volumeMaLength: resolveIntegerSetting(
        confirmation.volumeMaLength ?? input.volumeMaLength,
        DEFAULT_RAY_REPLICA_SETTINGS.volumeMaLength,
        2,
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
      requireAdx: resolveBooleanSetting(
        confirmation.requireAdx ?? input.requireAdx,
        DEFAULT_RAY_REPLICA_SETTINGS.requireAdx,
      ),
      adxMin: resolveFloatSetting(
        confirmation.adxMin ?? input.adxMin,
        DEFAULT_RAY_REPLICA_SETTINGS.adxMin,
        0,
        100,
      ),
      requireVolScoreRange: resolveBooleanSetting(
        confirmation.requireVolScoreRange ?? input.requireVolScoreRange,
        DEFAULT_RAY_REPLICA_SETTINGS.requireVolScoreRange,
      ),
      volScoreMin,
      volScoreMax: resolvePercentLikeSetting(
        Math.max(
          volScoreMin,
          Number(confirmation.volScoreMax ?? input.volScoreMax),
        ),
        DEFAULT_RAY_REPLICA_SETTINGS.volScoreMax,
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
        0.25,
        10,
      ),
      tp2Rr: resolveFloatSetting(
        risk.tp2Rr ?? input.tp2Rr,
        DEFAULT_RAY_REPLICA_SETTINGS.tp2Rr,
        0.25,
        10,
      ),
      tp3Rr: resolveFloatSetting(
        risk.tp3Rr ?? input.tp3Rr,
        DEFAULT_RAY_REPLICA_SETTINGS.tp3Rr,
        0.25,
        10,
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
      showKeyLevels: resolveBooleanSetting(
        input.showKeyLevels,
        DEFAULT_RAY_REPLICA_SETTINGS.showKeyLevels,
      ),
      showStructure: resolveBooleanSetting(
        input.showStructure,
        DEFAULT_RAY_REPLICA_SETTINGS.showStructure,
      ),
      showOrderBlocks: resolveBooleanSetting(
        input.showOrderBlocks,
        DEFAULT_RAY_REPLICA_SETTINGS.showOrderBlocks,
      ),
      showSupportResistance: resolveBooleanSetting(
        input.showSupportResistance,
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
    },
    overlays: {
      wireSpread: resolveFloatSetting(
        input.wireSpread,
        DEFAULT_RAY_REPLICA_SETTINGS.wireSpread,
        0.05,
        5,
      ),
      shadowLength: resolveIntegerSetting(
        input.shadowLength,
        DEFAULT_RAY_REPLICA_SETTINGS.shadowLength,
        5,
        120,
      ),
      shadowStdDev: resolveFloatSetting(
        input.shadowStdDev,
        DEFAULT_RAY_REPLICA_SETTINGS.shadowStdDev,
        0.25,
        6,
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
    bosConfirmation: normalized.marketStructure.bosConfirmation,
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
    requireAdx: normalized.confirmation.requireAdx,
    adxMin: normalized.confirmation.adxMin,
    requireVolScoreRange: normalized.confirmation.requireVolScoreRange,
    volScoreMin: normalized.confirmation.volScoreMin,
    volScoreMax: normalized.confirmation.volScoreMax,
    restrictToSelectedSessions: normalized.confirmation.restrictToSelectedSessions,
    sessions: normalized.confirmation.sessions,
    tp1Rr: normalized.risk.tp1Rr,
    tp2Rr: normalized.risk.tp2Rr,
    tp3Rr: normalized.risk.tp3Rr,
    dashboardPosition: normalized.infoPanel.position,
    dashboardSize: normalized.infoPanel.size,
    showWires: normalized.appearance.showWires,
    showShadow: normalized.appearance.showShadow,
    showKeyLevels: normalized.appearance.showKeyLevels,
    showStructure: normalized.appearance.showStructure,
    showOrderBlocks: normalized.appearance.showOrderBlocks,
    showSupportResistance: normalized.appearance.showSupportResistance,
    showTpSl: normalized.risk.showTpSl,
    showDashboard: normalized.appearance.showDashboard,
    showRegimeWindows: normalized.appearance.showRegimeWindows,
    colorCandles: normalized.appearance.colorCandles,
    waitForBarClose: normalized.appearance.waitForBarClose,
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
): StudyPoint[] =>
  chartBars.reduce<StudyPoint[]>((points, bar, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) {
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
): StudySpec => ({
  key,
  seriesType: "line",
  paneIndex: 0,
  options,
  data: buildStudyData(chartBars, values),
});

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

const computeEma = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (!values.length || period <= 0) {
    return result;
  }

  const multiplier = 2 / (period + 1);
  let seedSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      continue;
    }

    if (index < period) {
      seedSum += value;
      if (index === period - 1) {
        result[index] = Number((seedSum / period).toFixed(6));
      }
      continue;
    }

    const previous = result[index - 1];
    if (!Number.isFinite(previous)) {
      continue;
    }

    result[index] = Number(
      (value * multiplier + previous * (1 - multiplier)).toFixed(6),
    );
  }

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

const formatDashboardTimeframe = (timeframe: string): string =>
  timeframe === "D" || timeframe === "1D"
    ? "D1"
    : timeframe === "W" || timeframe === "1W"
      ? "W1"
      : timeframe === "240" || timeframe === "4h"
        ? "H4"
      : timeframe === "120"
        ? "H2"
          : timeframe === "60" || timeframe === "1h"
            ? "H1"
            : /^\d+$/.test(timeframe)
              ? `${timeframe}m`
              : timeframe;

const resolveNewYorkMinutes = (bar: ChartBar): number | null => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(bar.time * 1000));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return hour * 60 + minute;
};

const resolveSessionKey = (
  bar: ChartBar,
): RayReplicaSessionOption | null => {
  const minutes = resolveNewYorkMinutes(bar);
  if (minutes == null) {
    return null;
  }

  if (minutes >= 19 * 60 || minutes < 3 * 60) {
    return "asia";
  }
  if (minutes >= 3 * 60 && minutes < 9 * 60 + 30) {
    return "london";
  }
  if (minutes >= 9 * 60 + 30 && minutes < 12 * 60) {
    return "new_york_am";
  }
  if (minutes >= 15 * 60 && minutes <= 16 * 60) {
    return "new_york_pm";
  }

  return null;
};

const resolveSessionLabel = (bar: ChartBar): string => {
  const minutes = resolveNewYorkMinutes(bar);
  if (minutes == null) {
    return "Waiting";
  }

  if (minutes < 9 * 60 + 30) {
    return "Pre";
  }
  if (minutes < 12 * 60) {
    return "NY AM";
  }
  if (minutes < 15 * 60) {
    return "Midday";
  }
  if (minutes <= 16 * 60) {
    return "NY PM";
  }

  return "Post";
};

const summarizeRequiredSessions = (
  sessions: RayReplicaSessionOption[] = [],
): string => {
  if (!sessions.length) {
    return "All";
  }

  return sessions
    .map((value) =>
      value === "new_york_am"
        ? "NY AM"
        : value === "new_york_pm"
          ? "NY PM"
          : value === "asia"
            ? "Asia"
            : value === "london"
              ? "London"
              : value,
    )
    .join(" · ");
};

const computeVolumeRatioAt = (
  chartBars: ChartBar[],
  index: number,
  period: number,
): number => {
  if (index < 0) {
    return Number.NaN;
  }

  const start = Math.max(0, index - period + 1);
  const window = chartBars.slice(start, index + 1);
  const averageVolume =
    window.reduce((sum, bar) => sum + bar.v, 0) / Math.max(1, window.length);

  if (!Number.isFinite(averageVolume) || averageVolume <= 0) {
    return Number.NaN;
  }

  return Number((chartBars[index].v / averageVolume).toFixed(2));
};

const computeVolatilityScore = (
  atrSeries: number[],
  closes: number[],
): number[] =>
  atrSeries.map((value, index) => {
    const close = closes[index];
    if (!Number.isFinite(value) || !Number.isFinite(close) || close <= 0) {
      return Number.NaN;
    }

    return Number(
      Math.max(0, Math.min(100, ((value / close) * 100 * 80))).toFixed(1),
    );
  });

const resolveBucketStartMs = (timeMs: number, timeframe: string): number => {
  if (/^\d+$/.test(timeframe)) {
    const intervalMs = Number(timeframe) * 60_000;
    return Math.floor(timeMs / intervalMs) * intervalMs;
  }

  if (/^\d+m$/i.test(timeframe)) {
    const intervalMs = Number(timeframe.slice(0, -1)) * 60_000;
    return Math.floor(timeMs / intervalMs) * intervalMs;
  }

  if (/^\d+h$/i.test(timeframe)) {
    const intervalMs = Number(timeframe.slice(0, -1)) * 60 * 60_000;
    return Math.floor(timeMs / intervalMs) * intervalMs;
  }

  const value = new Date(timeMs);
  if (timeframe === "D" || timeframe === "1D") {
    value.setUTCHours(0, 0, 0, 0);
    return value.getTime();
  }

  if (timeframe === "W" || timeframe === "1W") {
    const utcDay = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() - utcDay + 1);
    value.setUTCHours(0, 0, 0, 0);
    return value.getTime();
  }

  return timeMs;
};

const aggregateBarsForTimeframe = (
  chartBars: ChartBar[],
  timeframe: string,
): ChartBar[] => {
  const aggregatedBars: ChartBar[] = [];
  chartBars.forEach((bar) => {
    const bucketStartMs = resolveBucketStartMs(bar.time * 1000, timeframe);
    const bucketTime = Math.floor(bucketStartMs / 1000);
    const lastBar = aggregatedBars[aggregatedBars.length - 1];
    if (!lastBar || lastBar.time !== bucketTime) {
      aggregatedBars.push({
        ...bar,
        time: bucketTime,
        ts: new Date(bucketStartMs).toISOString(),
        date: new Date(bucketStartMs).toISOString().slice(0, 10),
      });
      return;
    }

    lastBar.h = Math.max(lastBar.h, bar.h);
    lastBar.l = Math.min(lastBar.l, bar.l);
    lastBar.c = bar.c;
    lastBar.v += bar.v;
  });

  return aggregatedBars;
};

const resolveTrendDirectionForBars = (
  chartBars: ChartBar[],
  settings: Pick<
    RayReplicaRuntimeSettings,
    | "basisLength"
    | "atrLength"
    | "atrSmoothing"
    | "volatilityMultiplier"
    | "waitForBarClose"
  >,
): number => {
  if (!chartBars.length) {
    return 1;
  }

  const basis = computeEma(
    chartBars.map((bar) => bar.c),
    settings.basisLength,
  );
  const atrRaw = computeAtr(chartBars, settings.atrLength);
  const atrSmoothed = computeSma(atrRaw, settings.atrSmoothing);
  let trendDirection = 0;

  for (let index = 0; index < chartBars.length; index += 1) {
    const bar = chartBars[index];
    const bandBasis = basis[index];
    const bandWidth =
      Number.isFinite(atrSmoothed[index]) && Number.isFinite(bar.c)
        ? Math.max(
            atrSmoothed[index] * settings.volatilityMultiplier,
            Math.abs(bar.c) * 0.0012,
          )
        : Number.NaN;
    const bandUpper =
      Number.isFinite(bandBasis) && Number.isFinite(bandWidth)
        ? bandBasis + bandWidth
        : Number.NaN;
    const bandLower =
      Number.isFinite(bandBasis) && Number.isFinite(bandWidth)
        ? bandBasis - bandWidth
        : Number.NaN;

    if (
      Number.isFinite(bandUpper) &&
      (settings.waitForBarClose ? bar.c > bandUpper : bar.h > bandUpper)
    ) {
      trendDirection = 1;
      continue;
    }

    if (
      Number.isFinite(bandLower) &&
      (settings.waitForBarClose ? bar.c < bandLower : bar.l < bandLower)
    ) {
      trendDirection = -1;
      continue;
    }

    if (!trendDirection && Number.isFinite(bandBasis)) {
      trendDirection = bar.c >= bandBasis ? 1 : -1;
    }
  }

  return trendDirection || 1;
};

const resolveDayKey = (bar: ChartBar): string =>
  new Date(bar.time * 1000).toISOString().slice(0, 10);

const resolveIsoWeekKey = (bar: ChartBar): string => {
  const value = new Date(bar.time * 1000);
  const utcDay = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - utcDay);
  value.setUTCHours(0, 0, 0, 0);
  return value.toISOString().slice(0, 10);
};

const buildSessionKeyLevelSeries = (
  chartBars: ChartBar[],
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
  const dayStats = new Map<
    string,
    { open: number; high: number; low: number; close: number }
  >();
  const weekStats = new Map<string, { high: number; low: number }>();
  const orderedDayKeys: string[] = [];
  const orderedWeekKeys: string[] = [];
  const dayStartBarIndexByKey = new Map<string, number>();
  const weekStartBarIndexByKey = new Map<string, number>();

  chartBars.forEach((bar, index) => {
    const dayKey = resolveDayKey(bar);
    if (!dayStats.has(dayKey)) {
      orderedDayKeys.push(dayKey);
      dayStartBarIndexByKey.set(dayKey, index);
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
      weekStartBarIndexByKey.set(weekKey, index);
      weekStats.set(weekKey, { high: bar.h, low: bar.l });
    } else {
      const current = weekStats.get(weekKey);
      if (current) {
        current.high = Math.max(current.high, bar.h);
        current.low = Math.min(current.low, bar.l);
      }
    }
  });

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
  }: {
    idSuffix: string;
    anchorBarIndex: number;
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
    zoneType: "key-level",
    startBarIndex: anchorBarIndex,
    endBarIndex: lastBarIndex,
    price,
    label: `${label} ${formatOverlayPrice(price)}`,
    lineColor: color,
    lineStyle: KEY_LEVEL_LINE_STYLE_NAME,
    labelPosition: "right",
    labelFillColor: withHexAlpha(color, "b3"),
    labelOffsetBars: KEY_LEVEL_LABEL_OFFSET_BARS,
    extendBars: KEY_LEVEL_LABEL_OFFSET_BARS,
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
) => {
  pushLabeledLineZone(zones, chartBars, {
    id: `${RAY_REPLICA_PINE_SCRIPT_KEY}-${structure.kind}-${zones.length}`,
    zoneType: structure.kind,
    direction: structure.direction,
    startBarIndex: structure.sourceBarIndex,
    endBarIndex: structure.eventBarIndex,
    price: structure.sourcePrice,
    label: structure.label,
    lineColor: structure.direction === "short" ? BEAR_COLOR : BULL_COLOR,
    lineStyle: STRUCTURE_LINE_STYLE,
    labelPosition: "center",
    labelFillColor: withHexAlpha(
      structure.direction === "short" ? BEAR_COLOR : BULL_COLOR,
      "66",
    ),
  });
};

const pushTrendReversalZone = (
  zones: IndicatorZone[],
  chartBars: ChartBar[],
  startBarIndex: number | null,
  price: number | null,
  direction: "long" | "short",
  signalLengthBars: number,
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
    lineColor: "#ffffff",
    lineStyle: TREND_REVERSAL_LINE_STYLE,
    labelPosition: "center",
    labelFillColor: withHexAlpha(direction === "short" ? BEAR_COLOR : BULL_COLOR, "b3"),
  });
};

const buildRegimeWindows = (
  chartBars: ChartBar[],
  regimeDirection: number[],
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
    },
  });

  return windows;
};

export function createRayReplicaPineRuntimeAdapter(
  script: PineScriptRecord,
): IndicatorPlugin {
  return {
    id: script.scriptKey,
    compute({ chartBars, settings, timeframe }): IndicatorPluginOutput {
      if (!chartBars.length) {
        return {};
      }

      const {
        timeHorizon,
        bosConfirmation,
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
        requireAdx,
        adxMin,
        requireVolScoreRange,
        volScoreMin,
        volScoreMax,
        restrictToSelectedSessions,
        sessions,
        tp1Rr,
        tp2Rr,
        tp3Rr,
        dashboardPosition,
        dashboardSize,
        showWires,
        showShadow,
        showKeyLevels,
        showStructure,
        showOrderBlocks,
        showSupportResistance,
        showTpSl,
        showDashboard,
        showRegimeWindows,
        colorCandles,
        waitForBarClose,
      } = resolveRayReplicaRuntimeSettings(settings);
      const closes = chartBars.map((bar) => bar.c);
      const basis = computeEma(closes, basisLength);
      const atrRaw = computeAtr(chartBars, atrLength);
      const atrSmoothed = computeSma(atrRaw, atrSmoothing);
      const adx = computeAdx(chartBars, adxLength);
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
      const volatilityScore = computeVolatilityScore(atrRaw, closes);

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

      for (let index = 0; index < chartBars.length; index += 1) {
        const currentBar = chartBars[index];

        if (
          index >= 5 &&
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
        if (pivotIndex >= timeHorizon) {
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
            if (bar && showStructure) {
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
            if (bar && showStructure) {
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
            index - SUPPORT_RESISTANCE_PIVOT_STRENGTH;
          if (supportResistancePivotIndex >= SUPPORT_RESISTANCE_PIVOT_STRENGTH) {
            const currentClose = chartBars[index]?.c ?? Number.NaN;
            const currentAtr = atrRaw[index];
            const thickness = Number.isFinite(currentAtr)
              ? currentAtr * SUPPORT_RESISTANCE_THICKNESS_MULTIPLIER
              : Number.NaN;

            const isTooCloseToExistingZone = (price: number) =>
              supportResistanceZones.some((zone) => {
                const midpoint = (zone.top + zone.bottom) / 2;
                return (
                  Number.isFinite(currentClose) &&
                  currentClose !== 0 &&
                  Math.abs(price - midpoint) / currentClose * 100 <
                    SUPPORT_RESISTANCE_MIN_ZONE_DISTANCE_PERCENT
                );
              });

            const pivotResistance = resolvePivotHigh(
              chartBars,
              supportResistancePivotIndex,
              SUPPORT_RESISTANCE_PIVOT_STRENGTH,
            );
            if (
              typeof pivotResistance === "number" &&
              Number.isFinite(thickness) &&
              !isTooCloseToExistingZone(pivotResistance)
            ) {
              const targetEndIndex =
                index + SUPPORT_RESISTANCE_EXTENSION_BARS;
              supportResistanceZones.push({
                id: `${script.scriptKey}-sr-resistance-${supportResistancePivotIndex}`,
                direction: "short",
                startBarIndex: supportResistancePivotIndex,
                endBarIndex: Math.min(chartBars.length - 1, targetEndIndex),
                extendBars: Math.max(0, targetEndIndex - (chartBars.length - 1)),
                top: Number((pivotResistance + thickness / 2).toFixed(6)),
                bottom: Number((pivotResistance - thickness / 2).toFixed(6)),
                fillColor: RESISTANCE_ZONE_COLOR,
                borderColor: withHexAlpha("#ef4444", "70"),
              });
            }

            const pivotSupport = resolvePivotLow(
              chartBars,
              supportResistancePivotIndex,
              SUPPORT_RESISTANCE_PIVOT_STRENGTH,
            );
            if (
              typeof pivotSupport === "number" &&
              Number.isFinite(thickness) &&
              !isTooCloseToExistingZone(pivotSupport)
            ) {
              const targetEndIndex =
                index + SUPPORT_RESISTANCE_EXTENSION_BARS;
              supportResistanceZones.push({
                id: `${script.scriptKey}-sr-support-${supportResistancePivotIndex}`,
                direction: "long",
                startBarIndex: supportResistancePivotIndex,
                endBarIndex: Math.min(chartBars.length - 1, targetEndIndex),
                extendBars: Math.max(0, targetEndIndex - (chartBars.length - 1)),
                top: Number((pivotSupport + thickness / 2).toFixed(6)),
                bottom: Number((pivotSupport - thickness / 2).toFixed(6)),
                fillColor: SUPPORT_ZONE_COLOR,
                borderColor: withHexAlpha("#22c55e", "70"),
              });
            }

            while (supportResistanceZones.length > SUPPORT_RESISTANCE_MAX_ZONES) {
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
          } else {
            bullishChoch = true;
            lastFlipBarIndex = index;
            reversalAnchorPrice = Number.isFinite(breakableLow)
              ? breakableLow
              : lastSwingLow;
            reversalAnchorBarIndex =
              breakableLowBarIndex ?? lastSwingLowBarIndex;
            reversalDirection = "long";
            marketStructureDirection = 1;
          }

          breakableHigh = Number.NaN;
          breakableHighBarIndex = null;
        }

        if (
          Number.isFinite(breakableLow) &&
          (bosConfirmation === "wicks"
            ? currentBar.l < breakableLow
            : currentBar.c < breakableLow)
        ) {
          if (marketStructureDirection === -1) {
            bearishBos = true;
          } else {
            bearishChoch = true;
            lastFlipBarIndex = index;
            reversalAnchorPrice = Number.isFinite(breakableHigh)
              ? breakableHigh
              : lastSwingHigh;
            reversalAnchorBarIndex =
              breakableHighBarIndex ?? lastSwingHighBarIndex;
            reversalDirection = "short";
            marketStructureDirection = -1;
          }

          breakableLow = Number.NaN;
          breakableLowBarIndex = null;
        }

        const activeRegimeDirection =
          marketStructureDirection !== 0
            ? marketStructureDirection
            : trendDirection;
        regimeDirection[index] = activeRegimeDirection;
        const signalDirection = bullishChoch ? 1 : bearishChoch ? -1 : 0;
        const mtfDirections =
          signalDirection !== 0
            ? [mtf1, mtf2, mtf3].map((mtfTimeframe) =>
                resolveTrendDirectionForBars(
                  aggregateBarsForTimeframe(
                    chartBars.slice(0, index + 1),
                    mtfTimeframe,
                  ),
                  {
                    basisLength,
                    atrLength,
                    atrSmoothing,
                    volatilityMultiplier,
                    waitForBarClose,
                  },
                ),
              )
            : [];
        const currentAdx = adx[index];
        const currentVolatilityScore = volatilityScore[index];
        const currentSessionKey = resolveSessionKey(currentBar);
        const passesSignalGates =
          signalDirection === 0
            ? false
            : (!requireMtf1 || mtfDirections[0] === signalDirection) &&
              (!requireMtf2 || mtfDirections[1] === signalDirection) &&
              (!requireMtf3 || mtfDirections[2] === signalDirection) &&
              (!requireAdx ||
                (Number.isFinite(currentAdx) && currentAdx >= adxMin)) &&
              (!requireVolScoreRange ||
                (Number.isFinite(currentVolatilityScore) &&
                  currentVolatilityScore >= volScoreMin &&
                  currentVolatilityScore <= volScoreMax)) &&
              (!restrictToSelectedSessions ||
                (currentSessionKey != null && sessions.includes(currentSessionKey)));

        if (
          showStructure &&
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
          });
        }

        if (
          showStructure &&
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
          });
        }

        if (
          showStructure &&
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
          });
        }

        if (
          showStructure &&
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
          });
        }

        if (showStructure && reversalDirection) {
          pushTrendReversalZone(
            zones,
            chartBars,
            reversalAnchorBarIndex,
            reversalAnchorPrice,
            reversalDirection,
            30,
          );
        }

        if (
          showStructure &&
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
                color: BULL_COLOR,
                borderColor: withHexAlpha(BULL_COLOR, "f2"),
                size: 8,
              },
            ),
          );
        }

        if (
          showStructure &&
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
                color: BEAR_COLOR,
                borderColor: withHexAlpha(BEAR_COLOR, "f2"),
                size: 8,
              },
            ),
          );
        }

        if (showStructure && bullishBos) {
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
                background: withHexAlpha(BULL_COLOR, "cc"),
                borderColor: withHexAlpha(BULL_COLOR, "f2"),
                textColor: "#ffffff",
              },
            ),
          );
        }

        if (showStructure && bearishBos) {
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
                background: withHexAlpha(BEAR_COLOR, "cc"),
                borderColor: withHexAlpha(BEAR_COLOR, "f2"),
                textColor: "#ffffff",
              },
            ),
          );
        }

        if (showStructure && bullishChoch && passesSignalGates) {
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
                price:
                  chartBars[index].l +
                  -(Number.isFinite(atrRaw[index]) ? atrRaw[index] * 1.5 : 0),
                background: BULL_COLOR,
                borderColor: withHexAlpha(BULL_COLOR, "f2"),
                textColor: "#ffffff",
              },
            ),
          );
        }

        if (showStructure && bullishChoch) {
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

        if (showStructure && bearishChoch && passesSignalGates) {
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
                price:
                  chartBars[index].h +
                  (Number.isFinite(atrRaw[index]) ? atrRaw[index] * 1.5 : 0),
                background: BEAR_COLOR,
                borderColor: withHexAlpha(BEAR_COLOR, "f2"),
                textColor: "#ffffff",
              },
            ),
          );
        }

        if (showStructure && bearishChoch) {
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
            while (activeBullOrderBlocks.length > 5) {
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
            while (activeBearOrderBlocks.length > 5) {
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
        if (activeRegimeDirection === 1 && Number.isFinite(lowerBand[index])) {
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

        if (showShadow) {
          pushFilledBarZone(
            fillZones,
            chartBars,
            index,
            bbUpper[index],
            bbLower[index],
            SHADOW_FILL_COLOR,
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
            withHexAlpha(BULL_COLOR, "38"),
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
            withHexAlpha(BEAR_COLOR, "38"),
          );
        }

        if (colorCandles) {
          const candleColor = reaction
            ? REACTION_COLOR
            : activeRegimeDirection === 1
              ? BULL_COLOR
              : BEAR_COLOR;
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
              fillColor: ORDER_BLOCK_BULL_COLOR,
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
              fillColor: ORDER_BLOCK_BEAR_COLOR,
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
        ? buildRegimeWindows(chartBars, regimeDirection)
        : [];
      const keyLevels = showKeyLevels
        ? buildSessionKeyLevelSeries(chartBars)
        : null;
      const lastBarIndex = chartBars.length - 1;
      if (keyLevels && lastBarIndex >= 0) {
        const dayAnchorBarIndex = keyLevels.dayStartBarIndex[lastBarIndex] ?? 0;
        const weekAnchorBarIndex =
          keyLevels.weekStartBarIndex[lastBarIndex] ?? 0;
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pdh",
          anchorBarIndex: dayAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pdh[lastBarIndex],
          label: "PDH",
          color: KEY_LEVEL_HIGH_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pdl",
          anchorBarIndex: dayAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pdl[lastBarIndex],
          label: "PDL",
          color: KEY_LEVEL_LOW_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pdc",
          anchorBarIndex: dayAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pdc[lastBarIndex],
          label: "PDC",
          color: KEY_LEVEL_CLOSE_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "open",
          anchorBarIndex: dayAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.todayOpen[lastBarIndex],
          label: "O",
          color: KEY_LEVEL_OPEN_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pwh",
          anchorBarIndex: weekAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pwh[lastBarIndex],
          label: "PWH",
          color: KEY_LEVEL_HIGH_COLOR,
        });
        pushKeyLevelZone(zones, chartBars, {
          idSuffix: "pwl",
          anchorBarIndex: weekAnchorBarIndex,
          lastBarIndex,
          price: keyLevels.pwl[lastBarIndex],
          label: "PWL",
          color: KEY_LEVEL_LOW_COLOR,
        });
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
        const currentVolumeRatio = computeVolumeRatioAt(
          chartBars,
          lastBarIndex,
          volumeMaLength,
        );
        const currentSessionKey = resolveSessionKey(lastBar);
        const activeBandProfile = resolveRayReplicaBandProfile(
          resolveRayReplicaRuntimeSettings(settings),
        ) || { label: "Custom" };
        const adxPass =
          !requireAdx ||
          (Number.isFinite(currentAdx) && currentAdx >= adxMin);
        const volatilityPass =
          !requireVolScoreRange ||
          (Number.isFinite(currentVolatility) &&
            currentVolatility >= volScoreMin &&
            currentVolatility <= volScoreMax);
        const sessionPass =
          !restrictToSelectedSessions ||
          (currentSessionKey != null && sessions.includes(currentSessionKey));
        const mtfConfigs = [
          { timeframe: mtf1, required: requireMtf1, label: "MTF 1" },
          { timeframe: mtf2, required: requireMtf2, label: "MTF 2" },
          { timeframe: mtf3, required: requireMtf3, label: "MTF 3" },
        ].map(({ timeframe: mtfTimeframe, required, label }) => {
          const mtfBars = aggregateBarsForTimeframe(chartBars, mtfTimeframe);
          const direction = resolveTrendDirectionForBars(mtfBars, {
            basisLength,
            atrLength,
            atrSmoothing,
            volatilityMultiplier,
            waitForBarClose,
          });
          return {
            label,
            value:
              direction === 1
                ? "Bullish"
                : direction === -1
                  ? "Bearish"
                  : "Neutral",
            color: direction === 1 ? BULL_COLOR : BEAR_COLOR,
            detail: `${formatDashboardTimeframe(mtfTimeframe)}${required ? " · Req" : ""}`,
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
            title: `RAYALGO · ${activeBandProfile.label.toUpperCase()}`,
            subtitle: `TH ${timeHorizon} · ${bosConfirmation === "wicks" ? "Wicks" : "Close"} BOS`,
            trendLabel: `${formatDashboardTimeframe(timeframe)} TREND`,
            trendValue:
              regimeDirection[lastBarIndex] === 1 ? "Bullish" : "Bearish",
            trendColor:
              regimeDirection[lastBarIndex] === 1 ? BULL_COLOR : BEAR_COLOR,
            rows: [
              {
                label: "ADX",
                value: Number.isFinite(currentAdx) ? currentAdx.toFixed(1) : "--",
                detail: requireAdx
                  ? `Gate ${adxMin.toFixed(1)}+`
                  : "Gate off",
                color: adxPass ? BULL_COLOR : BEAR_COLOR,
              },
              {
                label: "VOLUME",
                value: Number.isFinite(currentVolumeRatio)
                  ? `${currentVolumeRatio.toFixed(2)}x`
                  : "--",
                detail: `MA ${volumeMaLength}`,
                color:
                  Number.isFinite(currentVolumeRatio) && currentVolumeRatio >= 1
                    ? BULL_COLOR
                    : "#9ca3af",
              },
              {
                label: "VOLATILITY",
                value: Number.isFinite(currentVolatility)
                  ? currentVolatility.toFixed(1)
                  : "--",
                detail: requireVolScoreRange
                  ? `${volScoreMin.toFixed(0)}-${volScoreMax.toFixed(0)}`
                  : "Gate off",
                color: volatilityPass ? BULL_COLOR : BEAR_COLOR,
              },
              {
                label: "SESSION",
                value: resolveSessionLabel(lastBar),
                detail: restrictToSelectedSessions
                  ? summarizeRequiredSessions(sessions)
                  : "All sessions",
                color: sessionPass ? "#ffffff" : BEAR_COLOR,
              },
              {
                label: "RISK",
                value: showTpSl
                  ? `${tp1Rr.toFixed(1)}/${tp2Rr.toFixed(1)}/${tp3Rr.toFixed(1)}R`
                  : "Hidden",
                detail: "TP1 / TP2 / TP3",
                color: showTpSl ? BULL_COLOR : "#9ca3af",
              },
            ],
            mtf: mtfConfigs,
          },
        });
      }

      const studyPrefix = script.scriptKey;

      return {
        studySpecs: [
          buildLineStudy(`${studyPrefix}-bull-main`, chartBars, bullMain, {
            color: BULL_COLOR,
            lineWidth: 3,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          buildLineStudy(`${studyPrefix}-bear-main`, chartBars, bearMain, {
            color: BEAR_COLOR,
            lineWidth: 3,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
          ...(showWires
            ? bullWires.map((values, index) =>
                buildLineStudy(
                  `${studyPrefix}-bull-wire-${index + 1}`,
                  chartBars,
                  values,
                  {
                    color: `${BULL_COLOR}88`,
                    lineWidth: 1,
                    priceLineVisible: false,
                    lastValueVisible: false,
                  },
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
                    color: `${BEAR_COLOR}88`,
                    lineWidth: 1,
                    priceLineVisible: false,
                    lastValueVisible: false,
                  },
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
                    color: `${SHADOW_COLOR}55`,
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
                    color: `${SHADOW_COLOR}55`,
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
