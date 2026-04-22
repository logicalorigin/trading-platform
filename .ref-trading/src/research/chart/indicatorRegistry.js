import { PINE_STUDY_REFERENCES } from "./pineStudyReferences.js";

export const INDICATOR_CATEGORY_ORDER = [
  "trend",
  "volatility",
  "momentum",
  "volume",
  "structure",
];

export const INDICATOR_CATEGORY_LABELS = {
  trend: "Trend",
  volatility: "Volatility",
  momentum: "Momentum",
  volume: "Volume",
  structure: "Structure",
};

export const INDICATOR_REGISTRY = [
  {
    id: "ema",
    label: "EMA",
    shortLabel: "EMA",
    description: "21-period exponential moving average.",
    category: "trend",
    paneType: "price",
    sourceKind: "local_builtin",
    defaultParams: { period: 21 },
    pineReference: PINE_STUDY_REFERENCES.ema,
  },
  {
    id: "sma",
    label: "SMA",
    shortLabel: "SMA",
    description: "20-period simple moving average.",
    category: "trend",
    paneType: "price",
    sourceKind: "local_builtin",
    defaultParams: { period: 20 },
    pineReference: PINE_STUDY_REFERENCES.sma,
  },
  {
    id: "vwap",
    label: "VWAP",
    shortLabel: "VWAP",
    description: "Session VWAP with standard-deviation bands.",
    category: "trend",
    paneType: "price",
    sourceKind: "local_builtin",
    defaultParams: { bands: true },
    pineReference: PINE_STUDY_REFERENCES.vwap,
  },
  {
    id: "bb",
    label: "Bollinger Bands",
    shortLabel: "BB",
    description: "20-period Bollinger Bands.",
    category: "volatility",
    paneType: "price",
    sourceKind: "local_builtin",
    defaultParams: { period: 20, deviation: 2 },
    pineReference: PINE_STUDY_REFERENCES.bb,
  },
  {
    id: "donchian",
    label: "Donchian Channels",
    shortLabel: "Donchian",
    description: "20-period Donchian Channel.",
    category: "volatility",
    paneType: "price",
    sourceKind: "local_builtin",
    defaultParams: { period: 20 },
    pineReference: PINE_STUDY_REFERENCES.donchian,
  },
  {
    id: "volume",
    label: "Volume",
    shortLabel: "Volume",
    description: "Dedicated lower-pane volume histogram.",
    category: "volume",
    paneType: "lower",
    sourceKind: "local_builtin",
    defaultParams: {},
    pineReference: PINE_STUDY_REFERENCES.volume,
  },
  {
    id: "rsi",
    label: "RSI",
    shortLabel: "RSI",
    description: "14-period relative strength index.",
    category: "momentum",
    paneType: "lower",
    sourceKind: "local_builtin",
    defaultParams: { period: 14 },
    pineReference: PINE_STUDY_REFERENCES.rsi,
  },
  {
    id: "macd",
    label: "MACD",
    shortLabel: "MACD",
    description: "12, 26, 9 MACD histogram and signal lines.",
    category: "momentum",
    paneType: "lower",
    sourceKind: "local_builtin",
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    pineReference: PINE_STUDY_REFERENCES.macd,
  },
  {
    id: "stochastic",
    label: "Stochastic",
    shortLabel: "Stoch",
    description: "14, 3, 3 stochastic oscillator.",
    category: "momentum",
    paneType: "lower",
    sourceKind: "local_builtin",
    defaultParams: { period: 14, smoothK: 3, smoothD: 3 },
    pineReference: PINE_STUDY_REFERENCES.stochastic,
  },
  {
    id: "atr",
    label: "ATR",
    shortLabel: "ATR",
    description: "14-period average true range.",
    category: "volatility",
    paneType: "lower",
    sourceKind: "local_builtin",
    defaultParams: { period: 14 },
    pineReference: PINE_STUDY_REFERENCES.atr,
  },
  {
    id: "adx",
    label: "ADX",
    shortLabel: "ADX",
    description: "14-period ADX with DI lines.",
    category: "trend",
    paneType: "lower",
    sourceKind: "local_builtin",
    defaultParams: { period: 14 },
    pineReference: PINE_STUDY_REFERENCES.adx,
  },
  {
    id: "obv",
    label: "OBV",
    shortLabel: "OBV",
    description: "On-balance volume.",
    category: "volume",
    paneType: "lower",
    sourceKind: "local_builtin",
    defaultParams: {},
    pineReference: PINE_STUDY_REFERENCES.obv,
  },
  {
    id: "mfi",
    label: "MFI",
    shortLabel: "MFI",
    description: "14-period money flow index.",
    category: "volume",
    paneType: "lower",
    sourceKind: "local_builtin",
    defaultParams: { period: 14 },
    pineReference: PINE_STUDY_REFERENCES.mfi,
  },
  {
    id: "smc",
    label: "SMC",
    shortLabel: "SMC",
    description: "Swing structure, BOS, CHoCH, and sweep markers.",
    category: "structure",
    paneType: "price",
    sourceKind: "local_custom",
    defaultParams: {},
    pineReference: PINE_STUDY_REFERENCES.smc,
  },
];

export const INDICATOR_REGISTRY_BY_ID = Object.fromEntries(
  INDICATOR_REGISTRY.map((indicator) => [indicator.id, indicator]),
);

export const DEFAULT_INDICATOR_SELECTIONS = [];

export function normalizeIndicatorSelections(value = []) {
  const rawSelections = Array.isArray(value)
    ? value
    : Object.entries(value || {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([id]) => id);
  const unique = [];
  const seen = new Set();
  for (const entry of rawSelections) {
    const normalizedId = String(entry || "").trim().toLowerCase();
    if (!INDICATOR_REGISTRY_BY_ID[normalizedId] || seen.has(normalizedId)) {
      continue;
    }
    seen.add(normalizedId);
    unique.push(normalizedId);
  }
  return unique;
}

export function resolveActiveIndicators(selections = []) {
  return normalizeIndicatorSelections(selections)
    .map((id) => INDICATOR_REGISTRY_BY_ID[id])
    .filter(Boolean);
}

export function categorizeIndicators(selections = [], searchTerm = "") {
  const normalizedSearch = String(searchTerm || "").trim().toLowerCase();
  const activeSet = new Set(normalizeIndicatorSelections(selections));
  const items = INDICATOR_REGISTRY.map((indicator) => ({
    ...indicator,
    active: activeSet.has(indicator.id),
  })).filter((indicator) => {
    if (!normalizedSearch) {
      return true;
    }
    const haystack = [
      indicator.label,
      indicator.shortLabel,
      indicator.description,
      indicator.pineReference?.tradingViewName,
      indicator.category,
    ].join(" ").toLowerCase();
    return haystack.includes(normalizedSearch);
  });

  return INDICATOR_CATEGORY_ORDER
    .map((category) => ({
      key: category,
      label: INDICATOR_CATEGORY_LABELS[category] || category,
      items: items.filter((indicator) => indicator.category === category),
    }))
    .filter((section) => section.items.length > 0);
}
