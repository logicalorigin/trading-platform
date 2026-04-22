import {
  normalizeRayAlgoSettings,
  resolveBandProfile,
} from "../config/rayalgoSettings.js";

const POSITIVE = "#0f766e";
const NEGATIVE = "#b91c1c";
const NEUTRAL = "#64748b";
const ACCENT = "#1d4ed8";

function sortByTime(left, right) {
  const leftKey = String(left?.endTs || left?.startTs || "").trim();
  const rightKey = String(right?.endTs || right?.startTs || "").trim();
  return leftKey.localeCompare(rightKey);
}

function isRayAlgoWindow(indicatorWindow) {
  if (!indicatorWindow) {
    return false;
  }
  const strategies = Array.isArray(indicatorWindow?.meta?.strategies)
    ? indicatorWindow.meta.strategies
    : [indicatorWindow?.strategy];
  return strategies.some((value) => String(value || "").trim().toLowerCase() === "rayalgo");
}

function resolveTrendTone(direction) {
  return direction === "short" ? NEGATIVE : direction === "long" ? POSITIVE : NEUTRAL;
}

function resolveTrendLabel(direction) {
  return direction === "short" ? "Bearish" : direction === "long" ? "Bullish" : "Neutral";
}

function resolveLatestRayAlgoWindow(windows = []) {
  const ordered = (Array.isArray(windows) ? windows : [])
    .filter(isRayAlgoWindow)
    .slice()
    .sort(sortByTime);
  return ordered[ordered.length - 1] || null;
}

function countBarsSince(chartBars = [], startTs = null) {
  const normalizedStart = String(startTs || "").trim();
  if (!normalizedStart) {
    return null;
  }
  const startIndex = chartBars.findIndex((bar) => String(bar?.ts || "").trim() === normalizedStart);
  if (startIndex < 0) {
    return null;
  }
  return Math.max(1, chartBars.length - startIndex);
}

function computeAdxSnapshot(chartBars = [], period = 14) {
  if (!Array.isArray(chartBars) || chartBars.length <= 1) {
    return null;
  }
  const safePeriod = Math.max(2, Math.round(Number(period)) || 14);
  const tr = new Float64Array(chartBars.length);
  const plusDm = new Float64Array(chartBars.length);
  const minusDm = new Float64Array(chartBars.length);

  for (let index = 1; index < chartBars.length; index += 1) {
    const currentHigh = Number(chartBars[index]?.h) || 0;
    const currentLow = Number(chartBars[index]?.l) || 0;
    const previousHigh = Number(chartBars[index - 1]?.h) || 0;
    const previousLow = Number(chartBars[index - 1]?.l) || 0;
    const previousClose = Number(chartBars[index - 1]?.c) || 0;
    const upMove = currentHigh - previousHigh;
    const downMove = previousLow - currentLow;
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[index] = Math.max(
      currentHigh - currentLow,
      Math.abs(currentHigh - previousClose),
      Math.abs(currentLow - previousClose),
    );
  }

  let trSmooth = 0;
  let plusSmooth = 0;
  let minusSmooth = 0;
  const seedEnd = Math.min(safePeriod, chartBars.length - 1);
  for (let index = 1; index <= seedEnd; index += 1) {
    trSmooth += tr[index];
    plusSmooth += plusDm[index];
    minusSmooth += minusDm[index];
  }

  const dx = new Float64Array(chartBars.length);
  const plusDi = new Float64Array(chartBars.length);
  const minusDi = new Float64Array(chartBars.length);
  const adx = new Float64Array(chartBars.length);
  for (let index = seedEnd; index < chartBars.length; index += 1) {
    if (index > seedEnd) {
      trSmooth = trSmooth - (trSmooth / safePeriod) + tr[index];
      plusSmooth = plusSmooth - (plusSmooth / safePeriod) + plusDm[index];
      minusSmooth = minusSmooth - (minusSmooth / safePeriod) + minusDm[index];
    }
    plusDi[index] = trSmooth > 0 ? (100 * plusSmooth) / trSmooth : 0;
    minusDi[index] = trSmooth > 0 ? (100 * minusSmooth) / trSmooth : 0;
    const diSum = plusDi[index] + minusDi[index];
    dx[index] = diSum > 0 ? (100 * Math.abs(plusDi[index] - minusDi[index])) / diSum : 0;
  }

  let adxSeed = 0;
  let adxCount = 0;
  for (let index = seedEnd; index < chartBars.length; index += 1) {
    if (adxCount < safePeriod) {
      adxSeed += dx[index];
      adxCount += 1;
      adx[index] = adxSeed / adxCount;
      continue;
    }
    adx[index] = ((adx[index - 1] * (safePeriod - 1)) + dx[index]) / safePeriod;
  }

  const latestIndex = chartBars.length - 1;
  return {
    value: Number.isFinite(adx[latestIndex]) ? +adx[latestIndex].toFixed(1) : null,
    plus: Number.isFinite(plusDi[latestIndex]) ? +plusDi[latestIndex].toFixed(1) : null,
    minus: Number.isFinite(minusDi[latestIndex]) ? +minusDi[latestIndex].toFixed(1) : null,
  };
}

function computeVolumeRatio(chartBars = [], period = 20) {
  if (!Array.isArray(chartBars) || !chartBars.length) {
    return null;
  }
  const safePeriod = Math.max(1, Math.round(Number(period)) || 20);
  const window = chartBars.slice(-safePeriod);
  const averageVolume = window.reduce((sum, bar) => sum + (Number(bar?.v) || 0), 0) / Math.max(1, window.length);
  const latestVolume = Number(chartBars[chartBars.length - 1]?.v) || 0;
  if (!Number.isFinite(averageVolume) || averageVolume <= 0) {
    return null;
  }
  return +(latestVolume / averageVolume).toFixed(2);
}

function computeAtrPercent(chartBars = [], period = 14) {
  if (!Array.isArray(chartBars) || chartBars.length < 2) {
    return null;
  }
  const safePeriod = Math.max(1, Math.round(Number(period)) || 14);
  const ranges = [];
  for (let index = Math.max(1, chartBars.length - safePeriod); index < chartBars.length; index += 1) {
    const currentBar = chartBars[index];
    const previousClose = Number(chartBars[index - 1]?.c) || Number(currentBar?.c) || 0;
    const high = Number(currentBar?.h) || previousClose;
    const low = Number(currentBar?.l) || previousClose;
    ranges.push(Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    ));
  }
  const atr = ranges.reduce((sum, value) => sum + value, 0) / Math.max(1, ranges.length);
  const latestClose = Number(chartBars[chartBars.length - 1]?.c) || 0;
  if (!Number.isFinite(atr) || latestClose <= 0) {
    return null;
  }
  return (atr / latestClose) * 100;
}

function computeVolatilityScore(chartBars = [], period = 14) {
  const atrPercent = computeAtrPercent(chartBars, period);
  if (!Number.isFinite(atrPercent)) {
    return null;
  }
  return Math.max(0, Math.min(100, +(atrPercent * 80).toFixed(1)));
}

function resolveSessionLabel(chartBars = []) {
  const latestTime = Number(chartBars?.[chartBars.length - 1]?.time);
  if (!Number.isFinite(latestTime)) {
    return "Waiting";
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(latestTime));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const minutes = (hour * 60) + minute;
  if (minutes < 570) {
    return "Pre";
  }
  if (minutes < 720) {
    return "NY AM";
  }
  if (minutes < 900) {
    return "Midday";
  }
  if (minutes <= 960) {
    return "NY PM";
  }
  return "Post";
}

function summarizeRequiredSessions(sessions = []) {
  const normalized = Array.isArray(sessions) ? sessions : [];
  if (!normalized.length) {
    return "All";
  }
  return normalized
    .map((value) => value === "new_york_am"
      ? "NY AM"
      : value === "new_york_pm"
        ? "NY PM"
        : value === "asia"
          ? "Asia"
          : value === "london"
            ? "London"
            : value)
    .join(" · ");
}

function formatNumeric(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "--";
}

function buildTrendBlock({ label, timeframe, direction, required = false }) {
  return {
    label,
    timeframe,
    value: resolveTrendLabel(direction),
    tone: resolveTrendTone(direction),
    required,
  };
}

function formatPineString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildRayAlgoDashboardModel({
  chartBars = [],
  indicatorOverlayTapesByTf = null,
  activeSignalTimeframe = "5m",
  activeShadingTimeframe = "5m",
  rayalgoSettings = null,
} = {}) {
  const settings = normalizeRayAlgoSettings(rayalgoSettings || {});
  const activeBandProfile = resolveBandProfile(settings) || { label: "Custom" };
  const shadingTape = indicatorOverlayTapesByTf?.[activeShadingTimeframe] || null;
  const signalTape = indicatorOverlayTapesByTf?.[activeSignalTimeframe] || null;
  const activeWindow = resolveLatestRayAlgoWindow(shadingTape?.windows);
  const trendBars = countBarsSince(chartBars, activeWindow?.startTs);
  const currentDirection = activeWindow?.direction === "short"
    ? "short"
    : activeWindow?.direction === "long"
      ? "long"
      : "neutral";
  const currentTrendLabel = resolveTrendLabel(currentDirection);
  const currentTrendTone = resolveTrendTone(currentDirection);
  const currentTrendDetail = trendBars ? `${trendBars} bars active` : "No active band trend";
  const adxSnapshot = computeAdxSnapshot(chartBars, settings.confirmation.adxLength);
  const volumeRatio = computeVolumeRatio(chartBars, settings.confirmation.volumeMaLength);
  const volatilityScore = computeVolatilityScore(chartBars, settings.bands.atrLength);
  const mtfTimeframes = [
    settings.confirmation.mtf1,
    settings.confirmation.mtf2,
    settings.confirmation.mtf3,
  ];
  const mtfBlocks = mtfTimeframes.map((timeframe, index) => {
    const tape = indicatorOverlayTapesByTf?.[timeframe] || null;
    const window = resolveLatestRayAlgoWindow(tape?.windows);
    const direction = window?.direction === "short"
      ? "short"
      : window?.direction === "long"
        ? "long"
        : "neutral";
    return buildTrendBlock({
      label: `MTF ${index + 1}`,
      timeframe,
      direction,
      required: Boolean(settings.confirmation[`requireMtf${index + 1}`]),
    });
  });

  const adxValue = adxSnapshot?.value;
  const adxPass = !settings.confirmation.requireAdx || (Number.isFinite(adxValue) && adxValue >= settings.confirmation.adxMin);
  const volatilityPass = !settings.confirmation.requireVolScoreRange
    || (Number.isFinite(volatilityScore)
      && volatilityScore >= settings.confirmation.volScoreMin
      && volatilityScore <= settings.confirmation.volScoreMax);

  return {
    visible: Boolean(settings.infoPanel.visible),
    position: settings.infoPanel.position,
    size: settings.infoPanel.size,
    profileLabel: activeBandProfile.label,
    summaryLabel: `TH ${settings.marketStructure.timeHorizon} · ${settings.marketStructure.bosConfirmation === "wicks" ? "Wicks" : "Close"} BOS · Sig ${activeSignalTimeframe} · Bg ${activeShadingTimeframe}`,
    trend: {
      label: currentTrendLabel,
      tone: currentTrendTone,
      detail: currentTrendDetail,
    },
    adx: {
      label: formatNumeric(adxValue, 1),
      detail: settings.confirmation.requireAdx ? `Gate ${formatNumeric(settings.confirmation.adxMin, 1)}+` : "Gate off",
      tone: adxPass ? POSITIVE : NEGATIVE,
    },
    volume: {
      label: Number.isFinite(volumeRatio) ? `${volumeRatio.toFixed(2)}x` : "--",
      detail: `MA ${settings.confirmation.volumeMaLength}`,
      tone: Number.isFinite(volumeRatio) && volumeRatio >= 1 ? ACCENT : NEUTRAL,
    },
    volatility: {
      label: Number.isFinite(volatilityScore) ? formatNumeric(volatilityScore, 1) : "--",
      detail: settings.confirmation.requireVolScoreRange
        ? `${formatNumeric(settings.confirmation.volScoreMin, 0)}-${formatNumeric(settings.confirmation.volScoreMax, 0)}`
        : "Gate off",
      tone: volatilityPass ? POSITIVE : NEGATIVE,
    },
    session: {
      label: resolveSessionLabel(chartBars),
      detail: settings.confirmation.restrictToSelectedSessions
        ? summarizeRequiredSessions(settings.confirmation.sessions)
        : "All sessions",
      tone: settings.confirmation.restrictToSelectedSessions ? ACCENT : NEUTRAL,
    },
    risk: {
      label: settings.risk.showTpSl
        ? `${formatNumeric(settings.risk.tp1Rr, 1)}/${formatNumeric(settings.risk.tp2Rr, 1)}/${formatNumeric(settings.risk.tp3Rr, 1)}R`
        : "Hidden",
      detail: "TP1 / TP2 / TP3",
      tone: settings.risk.showTpSl ? ACCENT : NEUTRAL,
    },
    mtfBlocks,
  };
}

export function buildRayAlgoAlertJsonExample() {
  return JSON.stringify({
    secret: "YOUR_SECRET",
    scriptName: "RayAlgo Invite Only",
    strategy: "rayalgo",
    eventType: "signal",
    signalClass: "trend_change",
    signalId: "{{ticker}}-{{interval}}-{{time}}-{{strategy.order.action}}",
    symbol: "{{ticker}}",
    timeframe: "{{interval}}",
    ts: "{{time}}",
    action: "{{strategy.order.action}}",
    price: "{{close}}",
    conviction: "{{plot_0}}",
    regime: "{{plot_1}}",
    components: {
      emaCross: "{{plot_2}}",
      bosRecent: "{{plot_3}}",
      chochRecent: "{{plot_4}}",
      obDir: "{{plot_5}}",
      sweepDir: "{{plot_6}}",
      bandTrend: "{{plot_7}}",
      bandRetest: "{{plot_8}}",
    },
    message: "{{strategy.order.comment}}",
  }, null, 2);
}

export function buildRayAlgoPineScriptTemplate({
  marketSymbol = "SPY",
  signalTimeframe = "5m",
  shadingTimeframe = "5m",
  rayalgoSettings = null,
} = {}) {
  const settings = normalizeRayAlgoSettings(rayalgoSettings || {});
  const alertExample = buildRayAlgoAlertJsonExample()
    .split("\n")
    .map((line) => `// ${line}`)
    .join("\n");
  const lines = [
    "//@version=5",
    'indicator("RayAlgo Bridge Preset", overlay = true, max_labels_count = 500)',
    `// Generated from the app settings for ${formatPineString(marketSymbol)}.`,
    "// Structure, bands, dashboard, and TP/SL settings are mirrored here.",
    "// Replace the placeholder signal/component variables below with your actual RayAlgo Pine variables.",
    "",
    `timeHorizon = input.int(${settings.marketStructure.timeHorizon}, "Time Horizon", minval = 1)`,
    `bosConfirmation = input.string("${settings.marketStructure.bosConfirmation === "wicks" ? "Wicks" : "Close"}", "BOS Confirmation", options = ["Close", "Wicks"])`,
    `bandBasisLength = input.int(${settings.bands.basisLength}, "Band Basis Length", minval = 1)`,
    `bandAtrLength = input.int(${settings.bands.atrLength}, "Band ATR Length", minval = 1)`,
    `bandAtrSmoothing = input.int(${settings.bands.atrSmoothing}, "Band ATR Smoothing", minval = 1)`,
    `bandVolatilityMultiplier = input.float(${settings.bands.volatilityMultiplier}, "Band Volatility Multiplier", step = 0.05, minval = 0.1)`,
    `waitForBarClose = input.bool(${settings.appearance.waitForBarClose ? "true" : "false"}, "Wait For Bar Close")`,
    `adxLength = input.int(${settings.confirmation.adxLength}, "ADX Length", minval = 1)`,
    `volumeMaLength = input.int(${settings.confirmation.volumeMaLength}, "Volume MA Length", minval = 1)`,
    `mtf1 = input.string("${settings.confirmation.mtf1}", "MTF 1", options = ["1m", "2m", "5m", "15m", "30m", "1h", "4h", "D"])`,
    `mtf2 = input.string("${settings.confirmation.mtf2}", "MTF 2", options = ["1m", "2m", "5m", "15m", "30m", "1h", "4h", "D"])`,
    `mtf3 = input.string("${settings.confirmation.mtf3}", "MTF 3", options = ["1m", "2m", "5m", "15m", "30m", "1h", "4h", "D"])`,
    `requireMtf1 = input.bool(${settings.confirmation.requireMtf1 ? "true" : "false"}, "Require MTF 1 Alignment")`,
    `requireMtf2 = input.bool(${settings.confirmation.requireMtf2 ? "true" : "false"}, "Require MTF 2 Alignment")`,
    `requireMtf3 = input.bool(${settings.confirmation.requireMtf3 ? "true" : "false"}, "Require MTF 3 Alignment")`,
    `requireAdx = input.bool(${settings.confirmation.requireAdx ? "true" : "false"}, "Require ADX")`,
    `adxMin = input.float(${settings.confirmation.adxMin}, "ADX Minimum", step = 0.5, minval = 0)`,
    `requireVolScoreRange = input.bool(${settings.confirmation.requireVolScoreRange ? "true" : "false"}, "Require Volatility Score Range")`,
    `volScoreMin = input.float(${settings.confirmation.volScoreMin}, "Volatility Score Min", step = 1, minval = 0, maxval = 100)`,
    `volScoreMax = input.float(${settings.confirmation.volScoreMax}, "Volatility Score Max", step = 1, minval = 0, maxval = 100)`,
    `restrictToSelectedSessions = input.bool(${settings.confirmation.restrictToSelectedSessions ? "true" : "false"}, "Restrict To Selected Sessions")`,
    `allowAsia = input.bool(${settings.confirmation.sessions.includes("asia") ? "true" : "false"}, "Allow Asia Session")`,
    `allowLondon = input.bool(${settings.confirmation.sessions.includes("london") ? "true" : "false"}, "Allow London Session")`,
    `allowNewYorkAm = input.bool(${settings.confirmation.sessions.includes("new_york_am") ? "true" : "false"}, "Allow New York AM")`,
    `allowNewYorkPm = input.bool(${settings.confirmation.sessions.includes("new_york_pm") ? "true" : "false"}, "Allow New York PM")`,
    `showInfoPanel = input.bool(${settings.infoPanel.visible ? "true" : "false"}, "Show Info Panel")`,
    `infoPanelPosition = input.string("${settings.infoPanel.position === "top_right" ? "Top Right" : "Top Left"}", "Info Panel Position", options = ["Top Left", "Top Right"])`,
    `infoPanelSize = input.string("${settings.infoPanel.size === "expanded" ? "Expanded" : "Compact"}", "Info Panel Size", options = ["Compact", "Expanded"])`,
    `showTpSl = input.bool(${settings.risk.showTpSl ? "true" : "false"}, "Show TP / SL Levels")`,
    `tp1Rr = input.float(${settings.risk.tp1Rr}, "TP1 RR", step = 0.25, minval = 0.25)`,
    `tp2Rr = input.float(${settings.risk.tp2Rr}, "TP2 RR", step = 0.25, minval = 0.25)`,
    `tp3Rr = input.float(${settings.risk.tp3Rr}, "TP3 RR", step = 0.25, minval = 0.25)`,
    "",
    `signalTfDisplay = "${formatPineString(signalTimeframe)}"`,
    `shadingTfDisplay = "${formatPineString(shadingTimeframe)}"`,
    "",
    "// Replace these placeholders with your real indicator values.",
    "signalLong = false",
    "signalShort = false",
    "convictionValue = 0.0",
    "regimeValue = 0.0",
    "emaCrossValue = 0",
    "bosRecentValue = 0",
    "chochRecentValue = 0",
    "obDirValue = 0",
    "sweepDirValue = 0",
    "bandTrendValue = 0",
    "bandRetestValue = 0",
    "",
    "buildPayload(action, priceText) =>",
    '    "{"',
    '    + "\\"scriptName\\":\\"RayAlgo Invite Only\\","',
    '    + "\\"strategy\\":\\"rayalgo\\","',
    '    + "\\"eventType\\":\\"signal\\","',
    '    + "\\"signalClass\\":\\"trend_change\\","',
    '    + "\\"signalId\\":\\"" + syminfo.tickerid + "-" + timeframe.period + "-" + str.tostring(time) + "-" + action + "\\","',
    '    + "\\"symbol\\":\\"" + syminfo.tickerid + "\\","',
    '    + "\\"timeframe\\":\\"" + timeframe.period + "\\","',
    '    + "\\"ts\\":\\"" + str.tostring(time) + "\\","',
    '    + "\\"action\\":\\"" + action + "\\","',
    '    + "\\"price\\":\\"" + priceText + "\\","',
    '    + "\\"conviction\\":\\"" + str.tostring(convictionValue) + "\\","',
    '    + "\\"regime\\":\\"" + str.tostring(regimeValue) + "\\","',
    '    + "\\"components\\":{"',
    '    + "\\"emaCross\\":\\"" + str.tostring(emaCrossValue) + "\\","',
    '    + "\\"bosRecent\\":\\"" + str.tostring(bosRecentValue) + "\\","',
    '    + "\\"chochRecent\\":\\"" + str.tostring(chochRecentValue) + "\\","',
    '    + "\\"obDir\\":\\"" + str.tostring(obDirValue) + "\\","',
    '    + "\\"sweepDir\\":\\"" + str.tostring(sweepDirValue) + "\\","',
    '    + "\\"bandTrend\\":\\"" + str.tostring(bandTrendValue) + "\\","',
    '    + "\\"bandRetest\\":\\"" + str.tostring(bandRetestValue) + "\\"}"',
    '    + "}"',
    "",
    "if signalLong",
    '    alert(buildPayload("buy", str.tostring(close)), alert.freq_once_per_bar_close)',
    "if signalShort",
    '    alert(buildPayload("sell", str.tostring(close)), alert.freq_once_per_bar_close)',
    "",
    'plot(convictionValue, "Conviction", display = display.none)',
    'plot(regimeValue, "Regime", display = display.none)',
    'plot(emaCrossValue, "EMA Cross", display = display.none)',
    'plot(bosRecentValue, "BOS Recent", display = display.none)',
    'plot(chochRecentValue, "CHoCH Recent", display = display.none)',
    'plot(obDirValue, "Order Block Dir", display = display.none)',
    'plot(sweepDirValue, "Sweep Dir", display = display.none)',
    'plot(bandTrendValue, "Band Trend", display = display.none)',
    'plot(bandRetestValue, "Band Retest", display = display.none)',
    "",
    "// Webhook payload example:",
    alertExample,
  ];
  return lines.join("\n");
}
