export const DEFAULT_RAYALGO_SETTINGS = {
  marketStructure: {
    timeHorizon: 10,
    bosConfirmation: "close",
  },
  bands: {
    basisLength: 21,
    atrLength: 14,
    atrSmoothing: 14,
    volatilityMultiplier: 1.5,
  },
  confirmation: {
    adxLength: 14,
    volumeMaLength: 20,
    mtf1: "15m",
    mtf2: "1h",
    mtf3: "4h",
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
  },
  infoPanel: {
    visible: true,
    position: "top_left",
    size: "compact",
  },
  risk: {
    showTpSl: true,
    tp1Rr: 1,
    tp2Rr: 2,
    tp3Rr: 3,
  },
  appearance: {
    waitForBarClose: true,
  },
};

export const DEFAULT_RAYALGO_WATCHER = {
  autoRankAndPin: false,
};

export const RAYALGO_TIME_HORIZON_OPTIONS = [6, 8, 10, 14, 20];
export const RAYALGO_BOS_CONFIRMATION_OPTIONS = [
  { value: "close", label: "Close" },
  { value: "wicks", label: "Wicks" },
];
export const RAYALGO_MTF_OPTIONS = ["1m", "2m", "5m", "15m", "30m", "1h", "4h", "D"];
export const RAYALGO_INFO_PANEL_POSITION_OPTIONS = [
  { value: "top_left", label: "Top Left" },
  { value: "top_right", label: "Top Right" },
];
export const RAYALGO_INFO_PANEL_SIZE_OPTIONS = [
  { value: "compact", label: "Compact" },
  { value: "expanded", label: "Expanded" },
];
export const RAYALGO_SESSION_OPTIONS = [
  { value: "asia", label: "Asia" },
  { value: "london", label: "London" },
  { value: "new_york_am", label: "NY AM" },
  { value: "new_york_pm", label: "NY PM" },
];

export const RAYALGO_BAND_PROFILE_OPTIONS = [
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
];

function clampPositiveInt(value, fallback) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function clampPositiveNumber(value, fallback, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return +numeric.toFixed(precision);
}

function normalizeEnum(value, allowedValues, fallback) {
  const normalized = String(value || "").trim();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function clampPercentLike(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return +Math.max(0, Math.min(100, numeric)).toFixed(1);
}

function normalizeSessionSelections(value) {
  const fallback = DEFAULT_RAYALGO_SETTINGS.confirmation.sessions;
  if (!Array.isArray(value)) {
    return fallback;
  }
  const allowed = new Set(RAYALGO_SESSION_OPTIONS.map((option) => option.value));
  const unique = [];
  for (const entry of value) {
    const normalized = String(entry || "").trim();
    if (!normalized || !allowed.has(normalized) || unique.includes(normalized)) {
      continue;
    }
    unique.push(normalized);
  }
  return unique.length ? unique : fallback;
}

export function normalizeRayAlgoSettings(settings = {}) {
  const marketStructure = settings?.marketStructure || {};
  const bands = settings?.bands || {};
  const confirmation = settings?.confirmation || {};
  const infoPanel = settings?.infoPanel || {};
  const risk = settings?.risk || {};
  const appearance = settings?.appearance || {};

  return {
    marketStructure: {
      timeHorizon: clampPositiveInt(marketStructure.timeHorizon, DEFAULT_RAYALGO_SETTINGS.marketStructure.timeHorizon),
      bosConfirmation: String(marketStructure.bosConfirmation || DEFAULT_RAYALGO_SETTINGS.marketStructure.bosConfirmation).trim().toLowerCase() === "wicks"
        ? "wicks"
        : "close",
    },
    bands: {
      basisLength: clampPositiveInt(bands.basisLength, DEFAULT_RAYALGO_SETTINGS.bands.basisLength),
      atrLength: clampPositiveInt(bands.atrLength, DEFAULT_RAYALGO_SETTINGS.bands.atrLength),
      atrSmoothing: clampPositiveInt(bands.atrSmoothing, DEFAULT_RAYALGO_SETTINGS.bands.atrSmoothing),
      volatilityMultiplier: clampPositiveNumber(bands.volatilityMultiplier, DEFAULT_RAYALGO_SETTINGS.bands.volatilityMultiplier),
    },
    confirmation: {
      adxLength: clampPositiveInt(confirmation.adxLength, DEFAULT_RAYALGO_SETTINGS.confirmation.adxLength),
      volumeMaLength: clampPositiveInt(confirmation.volumeMaLength, DEFAULT_RAYALGO_SETTINGS.confirmation.volumeMaLength),
      mtf1: normalizeEnum(confirmation.mtf1, RAYALGO_MTF_OPTIONS, DEFAULT_RAYALGO_SETTINGS.confirmation.mtf1),
      mtf2: normalizeEnum(confirmation.mtf2, RAYALGO_MTF_OPTIONS, DEFAULT_RAYALGO_SETTINGS.confirmation.mtf2),
      mtf3: normalizeEnum(confirmation.mtf3, RAYALGO_MTF_OPTIONS, DEFAULT_RAYALGO_SETTINGS.confirmation.mtf3),
      requireMtf1: Boolean(confirmation.requireMtf1),
      requireMtf2: Boolean(confirmation.requireMtf2),
      requireMtf3: Boolean(confirmation.requireMtf3),
      requireAdx: Boolean(confirmation.requireAdx),
      adxMin: clampPositiveNumber(confirmation.adxMin, DEFAULT_RAYALGO_SETTINGS.confirmation.adxMin, 1),
      requireVolScoreRange: Boolean(confirmation.requireVolScoreRange),
      volScoreMin: clampPercentLike(confirmation.volScoreMin, DEFAULT_RAYALGO_SETTINGS.confirmation.volScoreMin),
      volScoreMax: clampPercentLike(
        Math.max(
          Number(confirmation.volScoreMin) || DEFAULT_RAYALGO_SETTINGS.confirmation.volScoreMin,
          Number(confirmation.volScoreMax) || DEFAULT_RAYALGO_SETTINGS.confirmation.volScoreMax,
        ),
        DEFAULT_RAYALGO_SETTINGS.confirmation.volScoreMax,
      ),
      restrictToSelectedSessions: Boolean(confirmation.restrictToSelectedSessions),
      sessions: normalizeSessionSelections(confirmation.sessions),
    },
    infoPanel: {
      visible: infoPanel.visible !== false,
      position: normalizeEnum(infoPanel.position, RAYALGO_INFO_PANEL_POSITION_OPTIONS.map((option) => option.value), DEFAULT_RAYALGO_SETTINGS.infoPanel.position),
      size: normalizeEnum(infoPanel.size, RAYALGO_INFO_PANEL_SIZE_OPTIONS.map((option) => option.value), DEFAULT_RAYALGO_SETTINGS.infoPanel.size),
    },
    risk: {
      showTpSl: risk.showTpSl !== false,
      tp1Rr: clampPositiveNumber(risk.tp1Rr, DEFAULT_RAYALGO_SETTINGS.risk.tp1Rr, 2),
      tp2Rr: clampPositiveNumber(risk.tp2Rr, DEFAULT_RAYALGO_SETTINGS.risk.tp2Rr, 2),
      tp3Rr: clampPositiveNumber(risk.tp3Rr, DEFAULT_RAYALGO_SETTINGS.risk.tp3Rr, 2),
    },
    appearance: {
      waitForBarClose: appearance.waitForBarClose !== false,
    },
  };
}

export function mergeRayAlgoSettings(previous, patch) {
  return normalizeRayAlgoSettings({
    marketStructure: {
      ...previous?.marketStructure,
      ...patch?.marketStructure,
    },
    bands: {
      ...previous?.bands,
      ...patch?.bands,
    },
    confirmation: {
      ...previous?.confirmation,
      ...patch?.confirmation,
    },
    infoPanel: {
      ...previous?.infoPanel,
      ...patch?.infoPanel,
    },
    risk: {
      ...previous?.risk,
      ...patch?.risk,
    },
    appearance: {
      ...previous?.appearance,
      ...patch?.appearance,
    },
  });
}

export function resolveBandProfile(settings = {}) {
  const normalized = normalizeRayAlgoSettings(settings);
  const bands = normalized.bands;
  return RAYALGO_BAND_PROFILE_OPTIONS.find((profile) => (
    profile.settings.basisLength === bands.basisLength
    && profile.settings.atrLength === bands.atrLength
    && profile.settings.atrSmoothing === bands.atrSmoothing
    && profile.settings.volatilityMultiplier === bands.volatilityMultiplier
  )) || null;
}

export function getRayAlgoWatcherCandidateSettings(baseSettings = DEFAULT_RAYALGO_SETTINGS) {
  const normalizedBase = normalizeRayAlgoSettings(baseSettings);
  const timeHorizons = Array.from(new Set([
    normalizedBase.marketStructure.timeHorizon,
    ...RAYALGO_TIME_HORIZON_OPTIONS,
  ])).sort((left, right) => left - right);
  const bosModes = Array.from(new Set([
    normalizedBase.marketStructure.bosConfirmation,
    ...RAYALGO_BOS_CONFIRMATION_OPTIONS.map((option) => option.value),
  ]));
  const bandProfiles = [
    {
      value: "current",
      label: "Current",
      settings: normalizedBase.bands,
    },
    ...RAYALGO_BAND_PROFILE_OPTIONS.filter((profile) => {
      return !(
        profile.settings.basisLength === normalizedBase.bands.basisLength
        && profile.settings.atrLength === normalizedBase.bands.atrLength
        && profile.settings.atrSmoothing === normalizedBase.bands.atrSmoothing
        && profile.settings.volatilityMultiplier === normalizedBase.bands.volatilityMultiplier
      );
    }),
  ];

  return {
    timeHorizons,
    bosModes,
    bandProfiles,
  };
}
