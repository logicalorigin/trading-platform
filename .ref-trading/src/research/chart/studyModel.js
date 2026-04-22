import {
  INDICATOR_REGISTRY,
  resolveActiveIndicators,
} from "./indicatorRegistry.js";
import { normalizeRayAlgoSettings } from "../config/rayalgoSettings.js";

const LOWER_PRICE_FORMAT = {
  type: "price",
  precision: 4,
  minMove: 0.0001,
};

function toChartTime(bar) {
  const time = Number(bar?.time);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function computeEma(values, period) {
  if (!values.length) {
    return [];
  }
  const alpha = 2 / (period + 1);
  let current = values[0];
  return values.map((value) => {
    current = alpha * value + (1 - alpha) * current;
    return current;
  });
}

function computeSma(values, period) {
  if (!values.length) {
    return [];
  }
  const output = new Float64Array(values.length);
  let rollingSum = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]) || 0;
    rollingSum += value;
    if (index >= period) {
      rollingSum -= Number(values[index - period]) || 0;
    }
    const divisor = Math.min(index + 1, period);
    output[index] = rollingSum / Math.max(1, divisor);
  }
  return output;
}

function computeTrueRangeSeries(bars) {
  const tr = new Float64Array(bars.length);
  for (let index = 0; index < bars.length; index += 1) {
    const high = Number(bars[index]?.h) || 0;
    const low = Number(bars[index]?.l) || 0;
    if (index === 0) {
      tr[index] = Math.max(0, high - low);
      continue;
    }
    const previousClose = Number(bars[index - 1]?.c) || 0;
    tr[index] = Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );
  }
  return tr;
}

function computeRsi(bars, period = 14) {
  const closes = bars.map((bar) => Number(bar.c) || 0);
  const output = new Float64Array(closes.length);
  if (closes.length <= 1) {
    return output;
  }
  output.fill(50);
  let gainSum = 0;
  let lossSum = 0;
  const seedEnd = Math.min(period, closes.length - 1);
  for (let index = 1; index <= seedEnd; index += 1) {
    const delta = closes[index] - closes[index - 1];
    gainSum += Math.max(delta, 0);
    lossSum += Math.max(-delta, 0);
  }
  let avgGain = gainSum / Math.max(1, seedEnd);
  let avgLoss = lossSum / Math.max(1, seedEnd);
  const firstRsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  output[seedEnd] = firstRsi;
  for (let index = seedEnd + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    output[index] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }
  return output;
}

function computeAtr(bars, period = 14) {
  const tr = computeTrueRangeSeries(bars);
  const output = new Float64Array(bars.length);
  if (!bars.length) {
    return output;
  }
  let seed = 0;
  const seedEnd = Math.min(period - 1, tr.length - 1);
  for (let index = 0; index <= seedEnd; index += 1) {
    seed += tr[index];
    output[index] = tr[index];
  }
  let atr = seed / Math.max(1, seedEnd + 1);
  output[seedEnd] = atr;
  for (let index = seedEnd + 1; index < tr.length; index += 1) {
    atr = ((atr * (period - 1)) + tr[index]) / period;
    output[index] = atr;
  }
  return output;
}

function computeVwapBands(bars) {
  const vwap = new Float64Array(bars.length);
  const upperOne = new Float64Array(bars.length);
  const lowerOne = new Float64Array(bars.length);
  const upperTwo = new Float64Array(bars.length);
  const lowerTwo = new Float64Array(bars.length);

  let cumulativeTpv = 0;
  let cumulativeVolume = 0;
  let cumulativeTpvSquared = 0;
  let previousDate = "";

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar.date !== previousDate) {
      cumulativeTpv = 0;
      cumulativeVolume = 0;
      cumulativeTpvSquared = 0;
      previousDate = bar.date;
    }

    const typicalPrice = (bar.h + bar.l + bar.c) / 3;
    const volume = Math.max(1, Number(bar.v) || 0);
    cumulativeTpv += typicalPrice * volume;
    cumulativeVolume += volume;
    cumulativeTpvSquared += typicalPrice * typicalPrice * volume;

    const currentVwap = cumulativeTpv / cumulativeVolume;
    const variance = Math.max(0, cumulativeTpvSquared / cumulativeVolume - currentVwap * currentVwap);
    const deviation = Math.sqrt(variance);

    vwap[index] = currentVwap;
    upperOne[index] = currentVwap + 1.5 * deviation;
    lowerOne[index] = currentVwap - 1.5 * deviation;
    upperTwo[index] = currentVwap + 2.5 * deviation;
    lowerTwo[index] = currentVwap - 2.5 * deviation;
  }

  return { vwap, upperOne, lowerOne, upperTwo, lowerTwo };
}

function computeBollingerBands(bars, period = 20, deviationMultiplier = 2) {
  const closes = bars.map((bar) => Number(bar.c) || 0);
  const middle = new Float64Array(bars.length);
  const upper = new Float64Array(bars.length);
  const lower = new Float64Array(bars.length);

  for (let index = 0; index < bars.length; index += 1) {
    const start = Math.max(0, index - period + 1);
    const window = closes.slice(start, index + 1);
    const average = window.reduce((sum, value) => sum + value, 0) / Math.max(1, window.length);
    const variance = window.reduce((sum, value) => sum + ((value - average) ** 2), 0) / Math.max(1, window.length);
    const deviation = Math.sqrt(variance);
    middle[index] = average;
    upper[index] = average + (deviationMultiplier * deviation);
    lower[index] = average - (deviationMultiplier * deviation);
  }

  return { middle, upper, lower };
}

function computeDonchianChannels(bars, period = 20) {
  const upper = new Float64Array(bars.length);
  const lower = new Float64Array(bars.length);
  const middle = new Float64Array(bars.length);
  for (let index = 0; index < bars.length; index += 1) {
    const start = Math.max(0, index - period + 1);
    let highest = -Infinity;
    let lowest = Infinity;
    for (let cursor = start; cursor <= index; cursor += 1) {
      highest = Math.max(highest, Number(bars[cursor]?.h) || 0);
      lowest = Math.min(lowest, Number(bars[cursor]?.l) || 0);
    }
    upper[index] = highest;
    lower[index] = lowest;
    middle[index] = (highest + lowest) / 2;
  }
  return { upper, lower, middle };
}

function computeMacd(bars) {
  const closes = bars.map((bar) => Number(bar.c) || 0);
  const ema12 = computeEma(closes, 12);
  const ema26 = computeEma(closes, 26);
  const line = new Float64Array(bars.length);
  const signal = new Float64Array(bars.length);
  const histogram = new Float64Array(bars.length);

  for (let index = 0; index < bars.length; index += 1) {
    line[index] = ema12[index] - ema26[index];
  }

  const alpha = 2 / 10;
  let signalValue = line[0] || 0;
  for (let index = 0; index < bars.length; index += 1) {
    signalValue = alpha * line[index] + ((1 - alpha) * signalValue);
    signal[index] = signalValue;
    histogram[index] = line[index] - signalValue;
  }

  return { line, signal, histogram };
}

function computeStochastic(bars, period = 14, smoothK = 3, smoothD = 3) {
  const rawK = new Float64Array(bars.length);
  for (let index = 0; index < bars.length; index += 1) {
    const start = Math.max(0, index - period + 1);
    let highest = -Infinity;
    let lowest = Infinity;
    for (let cursor = start; cursor <= index; cursor += 1) {
      highest = Math.max(highest, Number(bars[cursor]?.h) || 0);
      lowest = Math.min(lowest, Number(bars[cursor]?.l) || 0);
    }
    const close = Number(bars[index]?.c) || 0;
    const range = highest - lowest;
    rawK[index] = range > 0 ? ((close - lowest) / range) * 100 : 50;
  }
  const k = computeSma(Array.from(rawK), smoothK);
  const d = computeSma(Array.from(k), smoothD);
  return { k, d };
}

function computeObv(bars) {
  const output = new Float64Array(bars.length);
  if (!bars.length) {
    return output;
  }
  let running = 0;
  output[0] = running;
  for (let index = 1; index < bars.length; index += 1) {
    const currentClose = Number(bars[index]?.c) || 0;
    const previousClose = Number(bars[index - 1]?.c) || 0;
    const volume = Number(bars[index]?.v) || 0;
    if (currentClose > previousClose) {
      running += volume;
    } else if (currentClose < previousClose) {
      running -= volume;
    }
    output[index] = running;
  }
  return output;
}

function computeMfi(bars, period = 14) {
  const typicalPrices = bars.map((bar) => ((Number(bar.h) || 0) + (Number(bar.l) || 0) + (Number(bar.c) || 0)) / 3);
  const moneyFlow = bars.map((bar, index) => typicalPrices[index] * (Number(bar.v) || 0));
  const output = new Float64Array(bars.length);
  output.fill(50);
  for (let index = 1; index < bars.length; index += 1) {
    let positive = 0;
    let negative = 0;
    const start = Math.max(1, index - period + 1);
    for (let cursor = start; cursor <= index; cursor += 1) {
      if (typicalPrices[cursor] >= typicalPrices[cursor - 1]) {
        positive += moneyFlow[cursor];
      } else {
        negative += moneyFlow[cursor];
      }
    }
    if (negative === 0) {
      output[index] = 100;
    } else {
      const ratio = positive / negative;
      output[index] = 100 - (100 / (1 + ratio));
    }
  }
  return output;
}

function computeAdx(bars, period = 14) {
  const plusDi = new Float64Array(bars.length);
  const minusDi = new Float64Array(bars.length);
  const adx = new Float64Array(bars.length);
  if (bars.length <= 1) {
    return { plusDi, minusDi, adx };
  }

  const tr = new Float64Array(bars.length);
  const plusDm = new Float64Array(bars.length);
  const minusDm = new Float64Array(bars.length);

  for (let index = 1; index < bars.length; index += 1) {
    const currentHigh = Number(bars[index]?.h) || 0;
    const currentLow = Number(bars[index]?.l) || 0;
    const previousHigh = Number(bars[index - 1]?.h) || 0;
    const previousLow = Number(bars[index - 1]?.l) || 0;
    const previousClose = Number(bars[index - 1]?.c) || 0;
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
  const seedEnd = Math.min(period, bars.length - 1);
  for (let index = 1; index <= seedEnd; index += 1) {
    trSmooth += tr[index];
    plusSmooth += plusDm[index];
    minusSmooth += minusDm[index];
  }

  const dx = new Float64Array(bars.length);
  for (let index = seedEnd; index < bars.length; index += 1) {
    if (index > seedEnd) {
      trSmooth = trSmooth - (trSmooth / period) + tr[index];
      plusSmooth = plusSmooth - (plusSmooth / period) + plusDm[index];
      minusSmooth = minusSmooth - (minusSmooth / period) + minusDm[index];
    }
    plusDi[index] = trSmooth > 0 ? (100 * plusSmooth) / trSmooth : 0;
    minusDi[index] = trSmooth > 0 ? (100 * minusSmooth) / trSmooth : 0;
    const diSum = plusDi[index] + minusDi[index];
    dx[index] = diSum > 0 ? (100 * Math.abs(plusDi[index] - minusDi[index])) / diSum : 0;
  }

  let adxSeed = 0;
  let adxCount = 0;
  for (let index = seedEnd; index < bars.length; index += 1) {
    if (adxCount < period) {
      adxSeed += dx[index];
      adxCount += 1;
      adx[index] = adxSeed / adxCount;
      continue;
    }
    adx[index] = ((adx[index - 1] * (period - 1)) + dx[index]) / period;
  }

  return { plusDi, minusDi, adx };
}

function buildValueSeries(bars, values, options = {}) {
  return bars
    .map((bar, index) => {
      const time = toChartTime(bar);
      const value = Number(values[index]);
      if (!Number.isFinite(time) || !Number.isFinite(value)) {
        return null;
      }
      const point = { time, value };
      if (typeof options.colorResolver === "function") {
        point.color = options.colorResolver(value, index, bar);
      }
      return point;
    })
    .filter(Boolean);
}

function buildGuideSeries(bars, value) {
  return buildValueSeries(bars, Array.from({ length: bars.length }, () => value));
}

function buildSmcMarkers(bars) {
  if (bars.length < 20) {
    return [];
  }

  const highs = bars.map((bar) => Number(bar.h));
  const lows = bars.map((bar) => Number(bar.l));
  const closes = bars.map((bar) => Number(bar.c));
  const swingWindow = 8;
  const swingHighs = [];
  const swingLows = [];

  for (let index = swingWindow; index < bars.length - swingWindow; index += 1) {
    let isHigh = true;
    let isLow = true;
    for (let cursor = index - swingWindow; cursor <= index + swingWindow; cursor += 1) {
      if (highs[cursor] > highs[index]) {
        isHigh = false;
      }
      if (lows[cursor] < lows[index]) {
        isLow = false;
      }
    }
    if (isHigh) {
      swingHighs.push({ index, value: highs[index] });
    }
    if (isLow) {
      swingLows.push({ index, value: lows[index] });
    }
  }

  const swingLabels = {};
  let previousHigh = null;
  for (const swingHigh of swingHighs) {
    swingLabels[swingHigh.index] = previousHigh && swingHigh.value <= previousHigh.value ? "LH" : "HH";
    previousHigh = swingHigh;
  }

  let previousLow = null;
  for (const swingLow of swingLows) {
    swingLabels[swingLow.index] = previousLow && swingLow.value > previousLow.value ? "HL" : "LL";
    previousLow = swingLow;
  }

  const structureBreaks = [];
  let trend = 0;
  let priorSwingHigh = null;
  let priorSwingLow = null;
  const swings = swingHighs
    .map((entry) => ({ ...entry, kind: "H" }))
    .concat(swingLows.map((entry) => ({ ...entry, kind: "L" })))
    .sort((left, right) => left.index - right.index);

  for (const swing of swings) {
    if (swing.kind === "H") {
      if (priorSwingHigh && swing.value > priorSwingHigh.value) {
        structureBreaks.push({
          index: swing.index,
          dir: 1,
          label: trend === -1 ? "CH" : "BOS",
        });
        trend = 1;
      }
      priorSwingHigh = swing;
      continue;
    }

    if (priorSwingLow && swing.value < priorSwingLow.value) {
      structureBreaks.push({
        index: swing.index,
        dir: -1,
        label: trend === 1 ? "CH" : "BOS",
      });
      trend = -1;
    }
    priorSwingLow = swing;
  }

  const liquiditySweeps = [];
  for (let index = 15; index < bars.length; index += 1) {
    let recentHigh = -Infinity;
    let recentLow = Infinity;
    for (let cursor = index - 15; cursor < index; cursor += 1) {
      recentHigh = Math.max(recentHigh, highs[cursor]);
      recentLow = Math.min(recentLow, lows[cursor]);
    }
    if (lows[index] < recentLow && closes[index] > recentLow) {
      liquiditySweeps.push({ index, dir: 1 });
    }
    if (highs[index] > recentHigh && closes[index] < recentHigh) {
      liquiditySweeps.push({ index, dir: -1 });
    }
  }

  const markers = [];
  for (const swing of swingHighs.slice(-24)) {
    const time = toChartTime(bars[swing.index]);
    if (time == null) continue;
    markers.push({
      id: `smc-high-${swing.index}`,
      barIndex: swing.index,
      time,
      position: "aboveBar",
      shape: "circle",
      color: "#f59e0b",
      text: swingLabels[swing.index] || "HH",
      size: 0.5,
    });
  }
  for (const swing of swingLows.slice(-24)) {
    const time = toChartTime(bars[swing.index]);
    if (time == null) continue;
    markers.push({
      id: `smc-low-${swing.index}`,
      barIndex: swing.index,
      time,
      position: "belowBar",
      shape: "circle",
      color: "#f59e0b",
      text: swingLabels[swing.index] || "LL",
      size: 0.5,
    });
  }
  for (const event of structureBreaks.slice(-18)) {
    const time = toChartTime(bars[event.index]);
    if (time == null) continue;
    markers.push({
      id: `smc-structure-${event.index}`,
      barIndex: event.index,
      time,
      position: event.dir > 0 ? "aboveBar" : "belowBar",
      shape: "square",
      color: event.label === "CH" ? "#ef4444" : "#3b82f6",
      text: event.label,
      size: 0.6,
    });
  }
  for (const sweep of liquiditySweeps.slice(-12)) {
    const time = toChartTime(bars[sweep.index]);
    if (time == null) continue;
    markers.push({
      id: `smc-sweep-${sweep.index}`,
      barIndex: sweep.index,
      time,
      position: sweep.dir > 0 ? "belowBar" : "aboveBar",
      shape: sweep.dir > 0 ? "arrowUp" : "arrowDown",
      color: "#7c3aed",
      text: "SWP",
      size: 0.7,
    });
  }

  return markers;
}

function buildIndicatorVisibility(activeIndicatorIds) {
  const visibility = {};
  for (const indicator of INDICATOR_REGISTRY) {
    visibility[indicator.id] = activeIndicatorIds.has(indicator.id);
  }
  return visibility;
}

function appendLowerGuideSpecs(studySpecs, paneIndex, chartBars, prefix, lower, upper, lineColor = "rgba(100,116,139,0.45)") {
  studySpecs.push(
    {
      key: `${prefix}GuideLower`,
      seriesType: "line",
      paneIndex,
      options: {
        color: lineColor,
        lineWidth: 1,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: LOWER_PRICE_FORMAT,
        visible: true,
      },
      data: buildGuideSeries(chartBars, lower),
    },
    {
      key: `${prefix}GuideUpper`,
      seriesType: "line",
      paneIndex,
      options: {
        color: lineColor,
        lineWidth: 1,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: LOWER_PRICE_FORMAT,
        visible: true,
      },
      data: buildGuideSeries(chartBars, upper),
    },
  );
}

function computeRayAlgoWindowedEmaValue(values, period, endIndex) {
  if (!values || typeof values.length !== "number" || values.length < 1) {
    return 0;
  }
  const safeEndIndex = Math.max(0, Math.min(values.length - 1, Number(endIndex) || 0));
  const safePeriod = Math.max(1, Math.round(Number(period)) || 1);
  if (safeEndIndex + 1 < safePeriod) {
    return Number(values[safeEndIndex]) || 0;
  }
  const startIndex = safeEndIndex - safePeriod + 1;
  const alpha = 2 / (safePeriod + 1);
  let ema = Number(values[startIndex]) || 0;
  for (let index = startIndex + 1; index <= safeEndIndex; index += 1) {
    ema = alpha * (Number(values[index]) || 0) + (1 - alpha) * ema;
  }
  return ema;
}

function resolveRayAlgoBandDirection(chartBars, basisSeries, explicitDirection = null) {
  if (explicitDirection === "long" || explicitDirection === "short") {
    return explicitDirection;
  }
  const lastBar = Array.isArray(chartBars) ? chartBars[chartBars.length - 1] : null;
  const lastBasis = Array.isArray(basisSeries) ? basisSeries[basisSeries.length - 1] : null;
  const close = Number(lastBar?.c);
  const basis = Number(lastBasis?.value);
  if (!Number.isFinite(close) || !Number.isFinite(basis)) {
    return null;
  }
  return close >= basis ? "long" : "short";
}

function buildRayAlgoBandStudySpecs(chartBars, rayalgoSettings, rayalgoTrendDirection = null) {
  if (!Array.isArray(chartBars) || !chartBars.length) {
    return [];
  }

  const normalizedRayAlgoSettings = normalizeRayAlgoSettings(rayalgoSettings || {});
  const basisLength = normalizedRayAlgoSettings.bands.basisLength;
  const atrLength = normalizedRayAlgoSettings.bands.atrLength;
  const atrSmoothing = normalizedRayAlgoSettings.bands.atrSmoothing;
  const volatilityMultiplier = normalizedRayAlgoSettings.bands.volatilityMultiplier;
  const closes = chartBars.map((bar) => Number(bar?.c) || 0);
  const trueRanges = new Float64Array(chartBars.length);
  const atrSeed = new Float64Array(chartBars.length);
  let rollingTrueRangeSum = 0;

  for (let index = 1; index < chartBars.length; index += 1) {
    const currentBar = chartBars[index];
    const previousClose = Number(chartBars[index - 1]?.c) || Number(currentBar?.o) || Number(currentBar?.c) || 0;
    const high = Number(currentBar?.h) || previousClose;
    const low = Number(currentBar?.l) || previousClose;
    const trueRange = Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );
    trueRanges[index] = trueRange;
    rollingTrueRangeSum += trueRange;
    if (index > atrLength) {
      rollingTrueRangeSum -= trueRanges[index - atrLength];
    }
    atrSeed[index] = rollingTrueRangeSum / Math.max(1, Math.min(index, atrLength));
  }

  const basisSeries = [];
  const upperSeries = [];
  const lowerSeries = [];

  for (let index = 0; index < chartBars.length; index += 1) {
    const time = toChartTime(chartBars[index]);
    if (!Number.isFinite(time)) {
      continue;
    }
    const basis = computeRayAlgoWindowedEmaValue(closes, basisLength, index);
    const atr = index === 0
      ? 0
      : computeRayAlgoWindowedEmaValue(atrSeed, atrSmoothing, index);
    const close = Number(chartBars[index]?.c) || basis;
    const bandWidth = Math.max(atr * volatilityMultiplier, Math.abs(close) * 0.0012);
    basisSeries.push({ time, value: basis });
    upperSeries.push({ time, value: basis + bandWidth });
    lowerSeries.push({ time, value: basis - bandWidth });
  }

  const activeDirection = resolveRayAlgoBandDirection(chartBars, basisSeries, rayalgoTrendDirection);
  const showUpperBand = activeDirection === "short";
  const showLowerBand = activeDirection === "long";

  return [
    {
      key: "rayalgoBandBasis",
      seriesType: "line",
      paneIndex: 0,
      options: {
        color: "rgba(30,41,59,0.22)",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: false,
      },
      data: basisSeries,
    },
    {
      key: "rayalgoBandUpper",
      seriesType: "line",
      paneIndex: 0,
      options: {
        color: "rgba(244,114,182,0.78)",
        lineWidth: showUpperBand ? 3 : 2,
        lineStyle: 0,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: showUpperBand,
      },
      data: upperSeries,
    },
    {
      key: "rayalgoBandLower",
      seriesType: "line",
      paneIndex: 0,
      options: {
        color: "rgba(56,189,248,0.78)",
        lineWidth: showLowerBand ? 3 : 2,
        lineStyle: 0,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: showLowerBand,
      },
      data: lowerSeries,
    },
  ];
}

export function buildStudyModel({
  chartBars = [],
  indicatorSelections = [],
  strategy = null,
  rayalgoSettings = null,
  rayalgoTrendDirection = null,
} = {}) {
  const activeIndicators = resolveActiveIndicators(indicatorSelections);
  const activeIndicatorIds = new Set(activeIndicators.map((indicator) => indicator.id));
  const lowerIndicators = activeIndicators.filter((indicator) => indicator.paneType === "lower");
  const lowerPaneIndexById = new Map(lowerIndicators.map((indicator, index) => [indicator.id, index + 1]));
  const studyVisibility = buildIndicatorVisibility(activeIndicatorIds);
  const normalizedStrategy = String(strategy || "").trim().toLowerCase();

  if (!chartBars.length) {
    return {
      studyVisibility,
      studySpecs: [],
      smcMarkers: [],
      lowerPaneCount: lowerIndicators.length,
    };
  }

  const closes = chartBars.map((bar) => Number(bar.c) || 0);
  const studySpecs = [];

  if (normalizedStrategy === "rayalgo") {
    studySpecs.push(...buildRayAlgoBandStudySpecs(chartBars, rayalgoSettings, rayalgoTrendDirection));
  }

  for (const indicator of activeIndicators) {
    const paneIndex = indicator.paneType === "lower" ? (lowerPaneIndexById.get(indicator.id) || 1) : 0;

    if (indicator.id === "ema") {
      studySpecs.push({
        key: "ema21",
        seriesType: "line",
        paneIndex: 0,
        options: { color: "#0ea5e9", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
        data: buildValueSeries(chartBars, computeEma(closes, 21)),
      });
      continue;
    }

    if (indicator.id === "sma") {
      studySpecs.push({
        key: "sma20",
        seriesType: "line",
        paneIndex: 0,
        options: { color: "#475569", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
        data: buildValueSeries(chartBars, computeSma(closes, 20)),
      });
      continue;
    }

    if (indicator.id === "vwap") {
      const vwapBands = computeVwapBands(chartBars);
      studySpecs.push(
        {
          key: "vwap",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "#1d4ed8", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, vwapBands.vwap),
        },
        {
          key: "vwapUpperOne",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "rgba(29,78,216,0.35)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, vwapBands.upperOne),
        },
        {
          key: "vwapLowerOne",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "rgba(29,78,216,0.35)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, vwapBands.lowerOne),
        },
        {
          key: "vwapUpperTwo",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "rgba(29,78,216,0.2)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, vwapBands.upperTwo),
        },
        {
          key: "vwapLowerTwo",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "rgba(29,78,216,0.2)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, vwapBands.lowerTwo),
        },
      );
      continue;
    }

    if (indicator.id === "bb") {
      const bollinger = computeBollingerBands(chartBars);
      studySpecs.push(
        {
          key: "bbMid",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "#334155", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, bollinger.middle),
        },
        {
          key: "bbUpper",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "rgba(51,65,85,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, bollinger.upper),
        },
        {
          key: "bbLower",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "rgba(51,65,85,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, bollinger.lower),
        },
      );
      continue;
    }

    if (indicator.id === "donchian") {
      const donchian = computeDonchianChannels(chartBars);
      studySpecs.push(
        {
          key: "donchianUpper",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "#0f766e", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, donchian.upper),
        },
        {
          key: "donchianLower",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "#0f766e", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, donchian.lower),
        },
        {
          key: "donchianMiddle",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "rgba(15,118,110,0.48)", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, visible: true },
          data: buildValueSeries(chartBars, donchian.middle),
        },
      );
      continue;
    }

    if (indicator.id === "volume") {
      studySpecs.push({
        key: "volumeHistogram",
        seriesType: "histogram",
        paneIndex,
        options: { priceFormat: { type: "volume" }, visible: true },
        data: chartBars
          .map((bar) => {
            const time = toChartTime(bar);
            const value = Number(bar?.v);
            if (!Number.isFinite(time) || !Number.isFinite(value)) {
              return null;
            }
            return {
              time,
              value,
              color: (Number(bar?.c) || 0) >= (Number(bar?.o) || 0) ? "rgba(34,197,94,0.52)" : "rgba(239,68,68,0.5)",
            };
          })
          .filter(Boolean),
      });
      continue;
    }

    if (indicator.id === "rsi") {
      const rsi = computeRsi(chartBars, 14);
      appendLowerGuideSpecs(studySpecs, paneIndex, chartBars, "rsi", 30, 70);
      studySpecs.push({
        key: "rsiLine",
        seriesType: "line",
        paneIndex,
        options: {
          color: "#7c3aed",
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          priceFormat: LOWER_PRICE_FORMAT,
          visible: true,
        },
        data: buildValueSeries(chartBars, rsi),
      });
      continue;
    }

    if (indicator.id === "macd") {
      const macd = computeMacd(chartBars);
      studySpecs.push(
        {
          key: "macdHistogram",
          seriesType: "histogram",
          paneIndex,
          options: { priceFormat: LOWER_PRICE_FORMAT, visible: true },
          data: chartBars
            .map((bar, index) => {
              const time = toChartTime(bar);
              const value = Number(macd.histogram[index]);
              if (!Number.isFinite(time) || !Number.isFinite(value)) {
                return null;
              }
              return {
                time,
                value,
                color: value >= 0 ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)",
              };
            })
            .filter(Boolean),
        },
        {
          key: "macdLine",
          seriesType: "line",
          paneIndex,
          options: {
            color: "#0f766e",
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: LOWER_PRICE_FORMAT,
            visible: true,
          },
          data: buildValueSeries(chartBars, macd.line),
        },
        {
          key: "macdSignal",
          seriesType: "line",
          paneIndex,
          options: {
            color: "#b91c1c",
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: LOWER_PRICE_FORMAT,
            visible: true,
          },
          data: buildValueSeries(chartBars, macd.signal),
        },
      );
      continue;
    }

    if (indicator.id === "stochastic") {
      const stochastic = computeStochastic(chartBars, 14, 3, 3);
      appendLowerGuideSpecs(studySpecs, paneIndex, chartBars, "stochastic", 20, 80, "rgba(148,163,184,0.42)");
      studySpecs.push(
        {
          key: "stochasticK",
          seriesType: "line",
          paneIndex,
          options: {
            color: "#0ea5e9",
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: LOWER_PRICE_FORMAT,
            visible: true,
          },
          data: buildValueSeries(chartBars, stochastic.k),
        },
        {
          key: "stochasticD",
          seriesType: "line",
          paneIndex,
          options: {
            color: "#f97316",
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: LOWER_PRICE_FORMAT,
            visible: true,
          },
          data: buildValueSeries(chartBars, stochastic.d),
        },
      );
      continue;
    }

    if (indicator.id === "atr") {
      studySpecs.push({
        key: "atrLine",
        seriesType: "line",
        paneIndex,
        options: {
          color: "#f59e0b",
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          priceFormat: LOWER_PRICE_FORMAT,
          visible: true,
        },
        data: buildValueSeries(chartBars, computeAtr(chartBars, 14)),
      });
      continue;
    }

    if (indicator.id === "adx") {
      const adx = computeAdx(chartBars, 14);
      studySpecs.push(
        {
          key: "adxLine",
          seriesType: "line",
          paneIndex,
          options: {
            color: "#7c3aed",
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: LOWER_PRICE_FORMAT,
            visible: true,
          },
          data: buildValueSeries(chartBars, adx.adx),
        },
        {
          key: "plusDiLine",
          seriesType: "line",
          paneIndex,
          options: {
            color: "#16a34a",
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: LOWER_PRICE_FORMAT,
            visible: true,
          },
          data: buildValueSeries(chartBars, adx.plusDi),
        },
        {
          key: "minusDiLine",
          seriesType: "line",
          paneIndex,
          options: {
            color: "#dc2626",
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: LOWER_PRICE_FORMAT,
            visible: true,
          },
          data: buildValueSeries(chartBars, adx.minusDi),
        },
      );
      continue;
    }

    if (indicator.id === "obv") {
      studySpecs.push({
        key: "obvLine",
        seriesType: "line",
        paneIndex,
        options: {
          color: "#2563eb",
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          priceFormat: LOWER_PRICE_FORMAT,
          visible: true,
        },
        data: buildValueSeries(chartBars, computeObv(chartBars)),
      });
      continue;
    }

    if (indicator.id === "mfi") {
      const mfi = computeMfi(chartBars, 14);
      appendLowerGuideSpecs(studySpecs, paneIndex, chartBars, "mfi", 20, 80, "rgba(148,163,184,0.42)");
      studySpecs.push({
        key: "mfiLine",
        seriesType: "line",
        paneIndex,
        options: {
          color: "#0f766e",
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          priceFormat: LOWER_PRICE_FORMAT,
          visible: true,
        },
        data: buildValueSeries(chartBars, mfi),
      });
    }
  }

  return {
    studyVisibility,
    studySpecs,
    smcMarkers: activeIndicatorIds.has("smc") ? buildSmcMarkers(chartBars) : [],
    lowerPaneCount: lowerIndicators.length,
  };
}
