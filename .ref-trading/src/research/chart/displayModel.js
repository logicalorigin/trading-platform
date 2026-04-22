import {
  MARKET_SESSION_CLOSE_MINUTES,
  MARKET_SESSION_OPEN_MINUTES,
  getBarTimeMs,
  getDateTextDayOfWeek,
  getDateTextUtcNoonMs,
  getEpochMsForMarketDateTime,
  parseMarketTimestamp,
} from "../market/time.js";
import { bsGreeks, calendarDaysTo } from "../engine/runtime.js";
import { getResearchTradeSelectionId } from "../trades/selection.js";
import {
  AUTO_TIMEFRAME_BY_RANGE,
  RANGE_DAYS_BY_KEY,
  isAllCandlesWindowMode,
  resolveRangeDays,
} from "./timeframeModel.js";

export { AUTO_TIMEFRAME_BY_RANGE, RANGE_DAYS_BY_KEY };

const INTRADAY_BUCKET_MINUTES = {
  "2m": 2,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
};

export function deriveChartTfMin(bars = []) {
  if (bars.length < 20) {
    return 5;
  }
  const deltas = [];
  const step = Math.max(1, Math.floor(bars.length / 500));
  for (let index = 0; index < bars.length - 1; index += step) {
    const current = bars[index];
    const next = bars[index + 1];
    if (current.date === next.date) {
      const t1 = current.hour * 60 + (current.min || 0);
      const t2 = next.hour * 60 + (next.min || 0);
      if (t2 > t1 && t2 - t1 <= 30) {
        deltas.push(t2 - t1);
      }
    }
  }
  if (!deltas.length) {
    return 5;
  }
  deltas.sort((left, right) => left - right);
  return Math.max(1, deltas[Math.floor(deltas.length / 2)]);
}

function minutesToHourMinute(totalMinutes) {
  return {
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60,
  };
}

function takeLastUniqueDates(bars, maxDates) {
  const seen = new Set();
  const dates = [];
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const date = String(bars[index]?.date || "");
    if (!date || seen.has(date)) continue;
    seen.add(date);
    dates.push(date);
    if (dates.length >= maxDates) break;
  }
  dates.reverse();
  return dates;
}

function buildRawDateSlice(bars, maxDates) {
  const dates = takeLastUniqueDates(bars, maxDates);
  if (!dates.length) return [];
  const dateSet = new Set(dates);
  return bars.filter((bar) => dateSet.has(String(bar?.date || "")));
}

function inferSourceBarEndMs(sourceBars, sourceIndex, fallbackMinutes) {
  const startMs = getBarTimeMs(sourceBars[sourceIndex]);
  if (!Number.isFinite(startMs)) return null;

  const nextStartMs = getBarTimeMs(sourceBars[sourceIndex + 1]);
  if (Number.isFinite(nextStartMs) && nextStartMs > startMs) {
    return nextStartMs;
  }

  const prevStartMs = getBarTimeMs(sourceBars[sourceIndex - 1]);
  if (Number.isFinite(prevStartMs) && startMs > prevStartMs) {
    return startMs + (startMs - prevStartMs);
  }

  return startMs + Math.max(1, fallbackMinutes) * 60 * 1000;
}

function aggregateDailyBars(rawBars) {
  const out = [];
  let current = null;
  for (const bar of rawBars) {
    if (!current || current.date !== bar.date) {
      if (current) out.push(current);
      current = {
        date: bar.date,
        ts: bar.date,
        time: getEpochMsForMarketDateTime(bar.date, 9, 30),
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v || 0,
        vix: bar.vix,
      };
      continue;
    }
    current.h = Math.max(current.h, bar.h);
    current.l = Math.min(current.l, bar.l);
    current.c = bar.c;
    current.v += bar.v || 0;
    current.vix = bar.vix;
  }
  if (current) out.push(current);
  return out;
}

function aggregateWeeklyBars(dailyBars) {
  if (!dailyBars.length) return [];
  const out = [];
  let current = null;
  for (const bar of dailyBars) {
    const dayOfWeek = getDateTextDayOfWeek(bar.date);
    const dayMs = getDateTextUtcNoonMs(bar.date);
    const currentDayOfWeek = current ? getDateTextDayOfWeek(current.date) : null;
    const currentDayMs = current ? getDateTextUtcNoonMs(current.date) : null;
    if (!current || dayOfWeek <= currentDayOfWeek || (dayMs - currentDayMs) > 6 * 86400000) {
      if (current) out.push(current);
      current = {
        date: bar.date,
        ts: bar.date,
        time: getEpochMsForMarketDateTime(bar.date, 9, 30),
        firstDate: bar.date,
        lastDate: bar.date,
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v,
        vix: bar.vix,
      };
      continue;
    }
    current.lastDate = bar.date;
    current.h = Math.max(current.h, bar.h);
    current.l = Math.min(current.l, bar.l);
    current.c = bar.c;
    current.v += bar.v;
    current.vix = bar.vix;
  }
  if (current) out.push(current);
  return out;
}

function aggregateIntradayBars(rawBars, bucketMinutes, fallbackMinutes) {
  const buckets = [];
  let current = null;

  for (let index = 0; index < rawBars.length; index += 1) {
    const bar = rawBars[index];
    const marketMinutes = Number(bar?.hour) * 60 + Number(bar?.min || 0);
    const bucketOffset = Math.max(0, Math.floor((marketMinutes - MARKET_SESSION_OPEN_MINUTES) / bucketMinutes));
    const bucketStartMinutes = MARKET_SESSION_OPEN_MINUTES + bucketOffset * bucketMinutes;
    const bucketKey = `${bar.date}|${bucketStartMinutes}`;
    const startMs = getBarTimeMs(bar);
    if (!Number.isFinite(startMs)) continue;

    if (!current || current.key !== bucketKey) {
      if (current) buckets.push(current);
      current = {
        key: bucketKey,
        firstSourceIndex: index,
        lastSourceIndex: index,
        firstSourceStartMs: startMs,
        bar: {
          time: startMs,
          ts: bar.ts,
          date: bar.date,
          hour: bar.hour,
          min: bar.min,
          o: bar.o,
          h: bar.h,
          l: bar.l,
          c: bar.c,
          v: bar.v || 0,
          vix: bar.vix,
        },
      };
      continue;
    }

    current.lastSourceIndex = index;
    current.bar.h = Math.max(current.bar.h, bar.h);
    current.bar.l = Math.min(current.bar.l, bar.l);
    current.bar.c = bar.c;
    current.bar.v += bar.v || 0;
    current.bar.vix = bar.vix;
  }

  if (current) buckets.push(current);

  const chartBars = buckets.map((bucket) => bucket.bar);
  const chartBarRanges = buckets.map((bucket, index) => {
    const nextBucket = buckets[index + 1];
    return {
      startMs: bucket.firstSourceStartMs,
      endMs: nextBucket
        ? nextBucket.firstSourceStartMs
        : inferSourceBarEndMs(rawBars, bucket.lastSourceIndex, fallbackMinutes),
    };
  });

  return { chartBars, chartBarRanges };
}

function buildRawSourceRanges(rawBars, fallbackMinutes) {
  return rawBars.map((bar, index) => ({
    startMs: getBarTimeMs(bar),
    endMs: inferSourceBarEndMs(rawBars, index, fallbackMinutes),
  }));
}

function buildDailyRanges(dailyBars) {
  return dailyBars.map((bar) => ({
    startMs: getEpochMsForMarketDateTime(bar.date, 9, 30),
    endMs: getEpochMsForMarketDateTime(bar.date, 16, 1),
  }));
}

function buildWeeklyRanges(weeklyBars) {
  return weeklyBars.map((bar, index) => {
    const nextBar = weeklyBars[index + 1];
    return {
      startMs: getEpochMsForMarketDateTime(bar.firstDate || bar.date, 9, 30),
      endMs: nextBar
        ? getEpochMsForMarketDateTime(nextBar.firstDate || nextBar.date, 9, 30)
        : getEpochMsForMarketDateTime(bar.lastDate || bar.date, 16, 1),
    };
  });
}

function countPresetVisibleBars({
  bars,
  chartRange,
  effectiveTf,
  tfMin,
  resolvedDailyBars,
  weeklyBars,
}) {
  const rangeDays = resolveRangeDays(chartRange);
  if (effectiveTf === "W") {
    return Math.min(weeklyBars.length, rangeDays < 999 ? Math.ceil(rangeDays / 5) : weeklyBars.length);
  }
  if (effectiveTf === "D") {
    return Math.min(resolvedDailyBars.length, rangeDays);
  }

  const rawSlice = buildRawDateSlice(bars, rangeDays);
  if (effectiveTf === "1m") {
    return rawSlice.length;
  }

  const bucketMinutes = INTRADAY_BUCKET_MINUTES[effectiveTf];
  if (!bucketMinutes) {
    return rawSlice.length;
  }
  return aggregateIntradayBars(rawSlice, bucketMinutes, tfMin).chartBars.length;
}

function buildDefaultVisibleLogicalRange(chartBarsLength, visibleBars) {
  if (!chartBarsLength) {
    return null;
  }
  const resolvedVisibleBars = Math.max(1, Math.min(chartBarsLength, Number(visibleBars) || chartBarsLength));
  return {
    from: Math.max(-0.5, chartBarsLength - resolvedVisibleBars - 0.5),
    to: chartBarsLength - 0.5,
  };
}

function findContainingBarIndex(chartBarRanges, epochMs) {
  let low = 0;
  let high = chartBarRanges.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const range = chartBarRanges[mid];
    if (epochMs < range.startMs) {
      high = mid - 1;
    } else if (epochMs >= range.endMs) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return null;
}

function resolveBarIndex(chartBarRanges, epochMs) {
  if (!Number.isFinite(epochMs) || !chartBarRanges.length) {
    return { index: null, usedFallback: false };
  }

  const containedIndex = findContainingBarIndex(chartBarRanges, epochMs);
  if (containedIndex != null) {
    return { index: containedIndex, usedFallback: false };
  }

  const domainStart = chartBarRanges[0].startMs;
  const domainEnd = chartBarRanges[chartBarRanges.length - 1].endMs;
  if (!(epochMs >= domainStart && epochMs < domainEnd)) {
    return { index: null, usedFallback: false };
  }

  let nearestIndex = null;
  let nearestDistance = Infinity;
  for (let index = 0; index < chartBarRanges.length; index += 1) {
    const range = chartBarRanges[index];
    const distance = epochMs < range.startMs
      ? range.startMs - epochMs
      : epochMs >= range.endMs
        ? epochMs - range.endMs
        : 0;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  if (nearestDistance <= 60 * 1000) {
    return { index: nearestIndex, usedFallback: true };
  }

  return { index: null, usedFallback: false };
}

function createEmptyTradeResolutionStats() {
  return {
    entry: {
      exact: 0,
      boundarySnap: 0,
      unresolved: 0,
    },
    exit: {
      exact: 0,
      boundarySnap: 0,
      unresolved: 0,
    },
    totalBoundarySnapCount: 0,
    totalUnresolvedCount: 0,
  };
}

function recordTradeResolution(stats, phase, kind) {
  if (!stats || (phase !== "entry" && phase !== "exit") || !kind) {
    return;
  }
  if (kind === "exact") {
    stats[phase].exact += 1;
    return;
  }
  if (kind === "boundary_snap") {
    stats[phase].boundarySnap += 1;
    stats.totalBoundarySnapCount += 1;
    return;
  }
  if (kind === "unresolved") {
    stats[phase].unresolved += 1;
    stats.totalUnresolvedCount += 1;
  }
}

function resolveTradeBarIndex(chartBarRanges, epochMs) {
  if (!Number.isFinite(epochMs) || !chartBarRanges.length) {
    return { index: null, kind: "unresolved" };
  }

  const containedIndex = findContainingBarIndex(chartBarRanges, epochMs);
  if (containedIndex != null) {
    return { index: containedIndex, kind: "exact" };
  }

  const domainStart = chartBarRanges[0].startMs;
  const domainEnd = chartBarRanges[chartBarRanges.length - 1].endMs;
  if (!(epochMs >= domainStart && epochMs < domainEnd)) {
    return { index: null, kind: "unresolved" };
  }

  let low = 0;
  let high = chartBarRanges.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const range = chartBarRanges[mid];
    if (epochMs < range.startMs) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  const previousIndex = high >= 0 ? high : null;
  const nextIndex = low < chartBarRanges.length ? low : null;
  const candidates = [];
  if (previousIndex != null) {
    const previousRange = chartBarRanges[previousIndex];
    candidates.push({
      index: previousIndex,
      distance: Math.abs(epochMs - Number(previousRange?.endMs)),
    });
  }
  if (nextIndex != null) {
    const nextRange = chartBarRanges[nextIndex];
    candidates.push({
      index: nextIndex,
      distance: Math.abs(Number(nextRange?.startMs) - epochMs),
    });
  }
  candidates.sort((left, right) => left.distance - right.distance);
  const nearestBoundary = candidates[0] || null;
  if (nearestBoundary && nearestBoundary.distance <= 60 * 1000) {
    return {
      index: nearestBoundary.index,
      kind: "boundary_snap",
    };
  }

  return { index: null, kind: "unresolved" };
}

function createTradeOverlayBaseId(trade) {
  return getResearchTradeSelectionId(trade);
}

function compareOverlayOrder(left, right) {
  if (left.entryMs !== right.entryMs) return left.entryMs - right.entryMs;
  if (left.exitMs !== right.exitMs) return left.exitMs - right.exitMs;
  return left.id.localeCompare(right.id);
}

const TRADE_THRESHOLD_EPSILON = 0.0005;
const EXIT_TRIGGER_LOOKBACK_BARS = 2;

function resolveFiniteOverlayPrice(value, min = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min ? numeric : null;
}

function resolveChartBarClose(chartBar) {
  return resolveFiniteOverlayPrice(chartBar?.c, 0);
}

function chartBarContainsPrice(chartBar, price) {
  const numericPrice = Number(price);
  const high = Number(chartBar?.h);
  const low = Number(chartBar?.l);
  if (![numericPrice, high, low].every(Number.isFinite)) {
    return false;
  }
  const min = Math.min(low, high);
  const max = Math.max(low, high);
  return numericPrice >= min && numericPrice <= max;
}

function resolveChartAlignedTradePrice({
  trade = null,
  chartBar = null,
  chartPriceContext = "spot",
  phase = "entry",
} = {}) {
  const normalizedContext = chartPriceContext === "option" ? "option" : "spot";
  const normalizedPhase = phase === "exit" ? "exit" : "entry";
  const closePrice = resolveChartBarClose(chartBar);
  if (normalizedContext === "spot") {
    const spotCandidates = normalizedPhase === "entry"
      ? [trade?.entrySpotPrice, trade?.sp]
      : [trade?.exitSpotPrice];
    for (const candidate of spotCandidates) {
      const numeric = resolveFiniteOverlayPrice(candidate, 0);
      if (Number.isFinite(numeric) && (!chartBar || chartBarContainsPrice(chartBar, numeric))) {
        return numeric;
      }
    }
    return closePrice ?? spotCandidates
      .map((candidate) => resolveFiniteOverlayPrice(candidate, 0))
      .find((candidate) => Number.isFinite(candidate))
      ?? null;
  }

  const optionCandidates = normalizedPhase === "entry"
    ? [trade?.entryBasePrice, trade?.oe]
    : [trade?.exitBasePrice, trade?.ep, trade?.exitTriggerPrice];
  for (const candidate of optionCandidates) {
    const numeric = resolveFiniteOverlayPrice(candidate, 0);
    if (Number.isFinite(numeric) && (!chartBar || chartBarContainsPrice(chartBar, numeric))) {
      return numeric;
    }
  }
  return closePrice ?? optionCandidates
    .map((candidate) => resolveFiniteOverlayPrice(candidate, 0))
    .find((candidate) => Number.isFinite(candidate))
    ?? null;
}

function clampTradeThresholdBarIndex(index, maxBarIndex) {
  const numeric = Number(index);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= maxBarIndex
    ? numeric
    : null;
}

function resolveTradeThresholdIv(trade) {
  const entryIvPct = Number(trade?.entryIV);
  return Number.isFinite(entryIvPct) && entryIvPct > 0 ? entryIvPct / 100 : null;
}

function resolveTradeThresholdDelta({
  trade = null,
  referenceSpotPrice = null,
  referenceBar = null,
} = {}) {
  const spotPrice = resolveFiniteOverlayPrice(referenceSpotPrice, 0);
  const strike = Number(trade?.k);
  const entryIv = resolveTradeThresholdIv(trade);
  const expiryDate = String(trade?.expiryDate || "").trim();
  const actualDteAtEntry = Number(trade?.actualDteAtEntry);
  const isCall = Boolean(trade?.ic);
  if (!Number.isFinite(spotPrice) || !Number.isFinite(strike) || !Number.isFinite(entryIv)) {
    return null;
  }

  let remainingCalendarDte = null;
  if (referenceBar && expiryDate && referenceBar.date) {
    remainingCalendarDte = calendarDaysTo(
      referenceBar.date,
      Number(referenceBar.hour) || 9,
      Number(referenceBar.min) || 30,
      expiryDate,
    );
  } else if (Number.isFinite(actualDteAtEntry) && actualDteAtEntry > 0) {
    remainingCalendarDte = actualDteAtEntry / 365.25;
  }
  if (!Number.isFinite(remainingCalendarDte) || remainingCalendarDte <= 0) {
    return null;
  }

  const greeks = bsGreeks(spotPrice, strike, remainingCalendarDte, entryIv, isCall);
  const delta = Number(greeks?.delta);
  return Number.isFinite(delta) && Math.abs(delta) >= 0.05 ? delta : null;
}

function resolveTradeRealizedSpotSlope(trade) {
  const entrySpotPrice = resolveFiniteOverlayPrice(trade?.entrySpotPrice ?? trade?.sp, 0);
  const exitSpotPrice = resolveFiniteOverlayPrice(trade?.exitSpotPrice, 0);
  const entryOptionPrice = resolveFiniteOverlayPrice(trade?.entryBasePrice ?? trade?.oe, 0);
  const exitOptionPrice = resolveFiniteOverlayPrice(trade?.exitBasePrice ?? trade?.ep ?? trade?.exitTriggerPrice, 0);
  if (![entrySpotPrice, exitSpotPrice, entryOptionPrice, exitOptionPrice].every(Number.isFinite)) {
    return null;
  }
  const optionDelta = exitOptionPrice - entryOptionPrice;
  if (Math.abs(optionDelta) <= TRADE_THRESHOLD_EPSILON) {
    return null;
  }
  return (exitSpotPrice - entrySpotPrice) / optionDelta;
}

function translateOptionThresholdToSpotPrice({
  trade = null,
  optionPrice = null,
  referenceOptionPrice = null,
  referenceSpotPrice = null,
  referenceBar = null,
} = {}) {
  const targetOptionPrice = resolveFiniteOverlayPrice(optionPrice, 0);
  const anchorOptionPrice = resolveFiniteOverlayPrice(referenceOptionPrice, 0);
  const anchorSpotPrice = resolveFiniteOverlayPrice(referenceSpotPrice, 0);
  if (![targetOptionPrice, anchorOptionPrice, anchorSpotPrice].every(Number.isFinite)) {
    return null;
  }

  const delta = resolveTradeThresholdDelta({
    trade,
    referenceSpotPrice: anchorSpotPrice,
    referenceBar,
  });
  if (Number.isFinite(delta) && Math.abs(delta) >= 0.05) {
    return anchorSpotPrice + ((targetOptionPrice - anchorOptionPrice) / delta);
  }

  const realizedSlope = resolveTradeRealizedSpotSlope(trade);
  if (Number.isFinite(realizedSlope)) {
    return anchorSpotPrice + ((targetOptionPrice - anchorOptionPrice) * realizedSlope);
  }

  return null;
}

function normalizeTrailStopHistoryEntries(trailStopHistory = []) {
  const normalized = (Array.isArray(trailStopHistory) ? trailStopHistory : [])
    .map((entry) => ({
      ts: String(entry?.ts || "").trim(),
      value: resolveFiniteOverlayPrice(entry?.value, 0),
      referenceOptionPrice: resolveFiniteOverlayPrice(entry?.referenceOptionPrice, 0),
      referenceSpotPrice: resolveFiniteOverlayPrice(entry?.referenceSpotPrice, 0),
    }))
    .filter((entry) => entry.ts && Number.isFinite(entry.value))
    .sort((left, right) => parseMarketTimestamp(left.ts) - parseMarketTimestamp(right.ts));

  const deduped = [];
  for (const entry of normalized) {
    const previous = deduped[deduped.length - 1] || null;
    if (previous && Math.abs(previous.value - entry.value) <= TRADE_THRESHOLD_EPSILON) {
      continue;
    }
    deduped.push(entry);
  }
  return deduped;
}

function resolveTradeThresholdLabel(kind) {
  switch (kind) {
    case "take_profit":
      return "TP";
    case "stop_loss":
      return "SL";
    case "trail_arm":
      return "ARM";
    case "trail_stop":
      return "TRAIL";
    case "exit_trigger":
      return "EXIT";
    default:
      return "";
  }
}

function resolveTradeThresholdValue({
  trade = null,
  kind = "stop_loss",
  optionPrice = null,
  chartPriceContext = "spot",
  referenceOptionPrice = null,
  referenceSpotPrice = null,
  referenceBar = null,
} = {}) {
  const normalizedContext = chartPriceContext === "option" ? "option" : "spot";
  if (normalizedContext === "option") {
    return resolveFiniteOverlayPrice(optionPrice, 0);
  }
  if (kind === "exit_trigger") {
    const exitSpotPrice = resolveFiniteOverlayPrice(trade?.exitSpotPrice, 0);
    if (Number.isFinite(exitSpotPrice)) {
      return exitSpotPrice;
    }
  }
  return translateOptionThresholdToSpotPrice({
    trade,
    optionPrice,
    referenceOptionPrice,
    referenceSpotPrice,
    referenceBar,
  });
}

function buildTradeThresholdPath({
  trade = null,
  chartBars = [],
  chartBarRanges = [],
  chartPriceContext = "spot",
  entryBarIndex = null,
  exitBarIndex = null,
} = {}) {
  if (!Array.isArray(chartBars) || !chartBars.length || !Array.isArray(chartBarRanges) || !chartBarRanges.length) {
    return { segments: [] };
  }
  const maxBarIndex = chartBars.length - 1;
  const clampedEntryBarIndex = clampTradeThresholdBarIndex(entryBarIndex, maxBarIndex);
  if (clampedEntryBarIndex == null) {
    return { segments: [] };
  }
  const tradeEndIndex = clampTradeThresholdBarIndex(
    Number.isInteger(exitBarIndex) ? exitBarIndex : maxBarIndex,
    maxBarIndex,
  );
  if (tradeEndIndex == null || tradeEndIndex < clampedEntryBarIndex) {
    return { segments: [] };
  }

  const entryBar = chartBars[clampedEntryBarIndex] || null;
  const exitBar = Number.isInteger(exitBarIndex) ? chartBars[tradeEndIndex] || null : null;
  const entryOptionPrice = resolveFiniteOverlayPrice(trade?.entryBasePrice ?? trade?.oe, 0);
  const entrySpotPrice = resolveFiniteOverlayPrice(trade?.entrySpotPrice ?? trade?.sp, 0)
    ?? resolveChartBarClose(entryBar);
  const exitOptionPrice = resolveFiniteOverlayPrice(trade?.exitBasePrice ?? trade?.ep ?? trade?.exitTriggerPrice, 0);
  const exitSpotPrice = resolveFiniteOverlayPrice(trade?.exitSpotPrice, 0)
    ?? resolveChartBarClose(exitBar);
  const segments = [];
  const pushSegment = ({
    kind,
    startBarIndex,
    endBarIndex,
    optionPrice,
    style,
    hit = false,
    label = null,
    showLabel = true,
    referenceOptionPrice = null,
    referenceSpotPrice = null,
    referenceBar = null,
  }) => {
    const start = clampTradeThresholdBarIndex(startBarIndex, maxBarIndex);
    const end = clampTradeThresholdBarIndex(endBarIndex, maxBarIndex);
    if (start == null || end == null || end < start) {
      return;
    }
    const value = resolveTradeThresholdValue({
      trade,
      kind,
      optionPrice,
      chartPriceContext,
      referenceOptionPrice,
      referenceSpotPrice,
      referenceBar,
    });
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    segments.push({
      id: `${kind}:${start}:${end}:${value.toFixed(4)}`,
      kind,
      startBarIndex: start,
      endBarIndex: end,
      value,
      style,
      hit: Boolean(hit),
      label: showLabel ? (label || resolveTradeThresholdLabel(kind)) : "",
      showLabel: Boolean(showLabel),
    });
  };

  pushSegment({
    kind: "take_profit",
    startBarIndex: clampedEntryBarIndex,
    endBarIndex: tradeEndIndex,
    optionPrice: trade?.takeProfitPrice,
    style: "dashed",
    hit: trade?.er === "take_profit",
    referenceOptionPrice: entryOptionPrice,
    referenceSpotPrice: entrySpotPrice,
    referenceBar: entryBar,
  });
  pushSegment({
    kind: "stop_loss",
    startBarIndex: clampedEntryBarIndex,
    endBarIndex: tradeEndIndex,
    optionPrice: trade?.stopLossPrice,
    style: "dashed",
    hit: trade?.er === "stop_loss",
    referenceOptionPrice: entryOptionPrice,
    referenceSpotPrice: entrySpotPrice,
    referenceBar: entryBar,
  });

  let trailEvents = normalizeTrailStopHistoryEntries(trade?.trailStopHistory);
  if (!trailEvents.length) {
    const fallbackTrailStopPrice = resolveFiniteOverlayPrice(trade?.lastTrailStopPrice, 0);
    const fallbackTs = String(trade?.et || trade?.ts || "").trim();
    if (Number.isFinite(fallbackTrailStopPrice) && fallbackTs) {
      trailEvents = [{
        ts: fallbackTs,
        value: fallbackTrailStopPrice,
        referenceOptionPrice: exitOptionPrice ?? entryOptionPrice,
        referenceSpotPrice: exitSpotPrice ?? entrySpotPrice,
      }];
    }
  }
  const resolvedTrailEvents = trailEvents
    .map((entry, index) => {
      const eventMs = parseMarketTimestamp(entry.ts);
      const resolution = Number.isFinite(eventMs)
        ? resolveTradeBarIndex(chartBarRanges, eventMs)
        : { index: null };
      const barIndex = clampTradeThresholdBarIndex(
        resolution?.index != null ? resolution.index : (index === trailEvents.length - 1 ? tradeEndIndex : clampedEntryBarIndex),
        maxBarIndex,
      );
      if (barIndex == null) {
        return null;
      }
      return {
        ...entry,
        barIndex,
        referenceBar: chartBars[barIndex] || null,
      };
    })
    .filter(Boolean);

  const firstTrailStartIndex = resolvedTrailEvents[0]?.barIndex ?? null;
  pushSegment({
    kind: "trail_arm",
    startBarIndex: clampedEntryBarIndex,
    endBarIndex: firstTrailStartIndex != null ? Math.max(clampedEntryBarIndex, firstTrailStartIndex) : tradeEndIndex,
    optionPrice: trade?.trailActivationPrice,
    style: "dotted",
    referenceOptionPrice: entryOptionPrice,
    referenceSpotPrice: entrySpotPrice,
    referenceBar: entryBar,
    showLabel: !resolvedTrailEvents.length,
  });

  for (let index = 0; index < resolvedTrailEvents.length; index += 1) {
    const event = resolvedTrailEvents[index];
    const nextEvent = resolvedTrailEvents[index + 1] || null;
    pushSegment({
      kind: "trail_stop",
      startBarIndex: event.barIndex,
      endBarIndex: nextEvent ? Math.max(event.barIndex, nextEvent.barIndex) : tradeEndIndex,
      optionPrice: event.value,
      style: "solid",
      hit: trade?.er === "trailing_stop" && index === resolvedTrailEvents.length - 1,
      referenceOptionPrice: event.referenceOptionPrice ?? entryOptionPrice,
      referenceSpotPrice: event.referenceSpotPrice ?? entrySpotPrice,
      referenceBar: event.referenceBar,
      showLabel: index === resolvedTrailEvents.length - 1,
    });
  }

  const exitTriggerValue = resolveTradeThresholdValue({
    trade,
    kind: "exit_trigger",
    optionPrice: trade?.exitTriggerPrice,
    chartPriceContext,
    referenceOptionPrice: exitOptionPrice ?? entryOptionPrice,
    referenceSpotPrice: exitSpotPrice ?? entrySpotPrice,
    referenceBar: exitBar,
  });
  const hasMatchingExitThreshold = Number.isFinite(exitTriggerValue)
    && segments.some((segment) => Math.abs(segment.value - exitTriggerValue) <= TRADE_THRESHOLD_EPSILON);
  if (Number.isInteger(exitBarIndex) && Number.isFinite(exitTriggerValue) && !hasMatchingExitThreshold) {
    pushSegment({
      kind: "exit_trigger",
      startBarIndex: Math.max(clampedEntryBarIndex, tradeEndIndex - EXIT_TRIGGER_LOOKBACK_BARS),
      endBarIndex: tradeEndIndex,
      optionPrice: trade?.exitTriggerPrice,
      style: "solid",
      hit: true,
      referenceOptionPrice: exitOptionPrice ?? entryOptionPrice,
      referenceSpotPrice: exitSpotPrice ?? entrySpotPrice,
      referenceBar: exitBar,
    });
  }

  return { segments };
}

function createTradeOverlays(chartBarRanges, trades, pricingMode, chartBars = [], chartPriceContext = "spot") {
  const baseIdCounts = new Map();
  const overlays = [];
  const resolutionStats = createEmptyTradeResolutionStats();

  for (const trade of trades) {
    const entryMs = parseMarketTimestamp(trade?.ts);
    const exitMs = trade?.et ? parseMarketTimestamp(trade.et) : null;
    const entryResolution = resolveTradeBarIndex(chartBarRanges, entryMs);
    const exitResolution = Number.isFinite(exitMs)
      ? resolveTradeBarIndex(chartBarRanges, exitMs)
      : { index: null, kind: null };

    recordTradeResolution(resolutionStats, "entry", entryResolution.kind);
    if (Number.isFinite(exitMs)) {
      recordTradeResolution(resolutionStats, "exit", exitResolution.kind);
    }

    if (entryResolution.index == null && exitResolution.index == null) {
      continue;
    }

    const baseId = createTradeOverlayBaseId(trade);
    const collisionCount = baseIdCounts.get(baseId) || 0;
    baseIdCounts.set(baseId, collisionCount + 1);
    const entryChartBar = Number.isInteger(entryResolution.index)
      ? chartBars[entryResolution.index] || null
      : null;
    const exitChartBar = Number.isInteger(exitResolution.index)
      ? chartBars[exitResolution.index] || null
      : null;
    const entryPrice = resolveChartAlignedTradePrice({
      trade,
      chartBar: entryChartBar,
      chartPriceContext,
      phase: "entry",
    });
    const exitPrice = resolveChartAlignedTradePrice({
      trade,
      chartBar: exitChartBar,
      chartPriceContext,
      phase: "exit",
    });
    const thresholdPath = buildTradeThresholdPath({
      trade,
      chartBars,
      chartBarRanges,
      chartPriceContext,
      entryBarIndex: entryResolution.index,
      exitBarIndex: exitResolution.index,
    });

    overlays.push({
      id: collisionCount ? `${baseId}#${collisionCount + 1}` : baseId,
      tradeSelectionId: baseId,
      entryBarIndex: entryResolution.index,
      exitBarIndex: exitResolution.index,
      entryTs: trade?.ts || "",
      exitTs: trade?.et || null,
      dir: trade?.dir === "short" ? "short" : "long",
      strat: trade?.strat || "",
      qty: Number(trade?.qty) || 0,
      pnl: Number(trade?.pnl) || 0,
      er: trade?.er || null,
      ic: Boolean(trade?.ic),
      k: Number.isFinite(Number(trade?.k)) ? Number(trade.k) : null,
      entryPrice,
      exitPrice,
      chartPriceContext,
      entryResolutionKind: entryResolution.kind,
      exitResolutionKind: exitResolution.kind || null,
      entrySpotPrice: Number.isFinite(Number(trade?.entrySpotPrice)) ? Number(trade.entrySpotPrice) : (Number.isFinite(Number(trade?.sp)) ? Number(trade.sp) : null),
      exitSpotPrice: Number.isFinite(Number(trade?.exitSpotPrice)) ? Number(trade.exitSpotPrice) : null,
      entryBasePrice: Number.isFinite(Number(trade?.entryBasePrice)) ? Number(trade.entryBasePrice) : null,
      oe: Number(trade?.oe) || 0,
      ep: Number.isFinite(Number(trade?.ep)) ? Number(trade.ep) : null,
      exitFill: Number.isFinite(Number(trade?.exitFill)) ? Number(trade.exitFill) : null,
      expiryDate: trade?.expiryDate || null,
      entryIV: Number.isFinite(Number(trade?.entryIV)) ? Number(trade.entryIV) : null,
      targetDteAtEntry: Number.isFinite(Number(trade?.targetDteAtEntry)) ? Number(trade.targetDteAtEntry) : null,
      actualDteAtEntry: Number.isFinite(Number(trade?.actualDteAtEntry)) ? Number(trade.actualDteAtEntry) : null,
      selectionStrikeLabel: trade?.selectionStrikeLabel || null,
      selectionMoneyness: trade?.selectionMoneyness || null,
      selectionSteps: Number.isFinite(Number(trade?.selectionSteps)) ? Number(trade.selectionSteps) : null,
      stopLossPrice: Number.isFinite(Number(trade?.stopLossPrice)) ? Number(trade.stopLossPrice) : null,
      takeProfitPrice: Number.isFinite(Number(trade?.takeProfitPrice)) ? Number(trade.takeProfitPrice) : null,
      trailActivationPrice: Number.isFinite(Number(trade?.trailActivationPrice)) ? Number(trade.trailActivationPrice) : null,
      lastTrailStopPrice: Number.isFinite(Number(trade?.lastTrailStopPrice)) ? Number(trade.lastTrailStopPrice) : null,
      trailStopHistory: normalizeTrailStopHistoryEntries(trade?.trailStopHistory),
      exitTriggerPrice: Number.isFinite(Number(trade?.exitTriggerPrice)) ? Number(trade.exitTriggerPrice) : null,
      thresholdPath,
      pricingMode: trade?.pricingMode || pricingMode || null,
      entryStackIndex: 0,
      exitStackIndex: 0,
      entryMs,
      exitMs: Number.isFinite(exitMs) ? exitMs : Number.POSITIVE_INFINITY,
    });
  }

  overlays.sort(compareOverlayOrder);

  const entriesByBarIndex = {};
  const exitsByBarIndex = {};
  const entryStackCounts = new Map();
  const exitStackCounts = new Map();

  for (const overlay of overlays) {
    if (overlay.entryBarIndex != null) {
      const entryGroup = entriesByBarIndex[overlay.entryBarIndex] || [];
      const entryStackKey = `${overlay.entryBarIndex}|${overlay.dir}`;
      overlay.entryStackIndex = entryStackCounts.get(entryStackKey) || 0;
      entryStackCounts.set(entryStackKey, overlay.entryStackIndex + 1);
      entryGroup.push(overlay);
      entriesByBarIndex[overlay.entryBarIndex] = entryGroup;
    }
    if (overlay.exitBarIndex != null) {
      const exitGroup = exitsByBarIndex[overlay.exitBarIndex] || [];
      const exitStackKey = `${overlay.exitBarIndex}|${overlay.dir}`;
      overlay.exitStackIndex = exitStackCounts.get(exitStackKey) || 0;
      exitStackCounts.set(exitStackKey, overlay.exitStackIndex + 1);
      exitGroup.push(overlay);
      exitsByBarIndex[overlay.exitBarIndex] = exitGroup;
    }
  }

  return {
    tradeOverlays: overlays.map(({ entryMs: _entryMs, exitMs: _exitMs, ...overlay }) => overlay),
    entriesByBarIndex,
    exitsByBarIndex,
    tradeResolutionStats: resolutionStats,
  };
}

function buildTradeSelectionIdsBySignal(trades) {
  const selections = new Map();
  for (const trade of Array.isArray(trades) ? trades : []) {
    const signalTs = String(trade?.signalTs || trade?.ts || "").trim();
    const strategy = String(trade?.strat || "").trim().toLowerCase();
    if (!signalTs || !strategy) {
      continue;
    }
    const key = `${signalTs}|${strategy}`;
    const list = selections.get(key) || [];
    list.push(getResearchTradeSelectionId(trade));
    selections.set(key, list);
  }
  return selections;
}

function collectTradeSelectionIdsForSignalRefs(tradeSelectionIdsBySignal, signalRefs = []) {
  const tradeSelectionIds = [];
  for (const signalRef of Array.isArray(signalRefs) ? signalRefs : []) {
    const signalTs = String(signalRef?.signalTs || "").trim();
    const strategy = String(signalRef?.strategy || "").trim().toLowerCase();
    if (!signalTs || !strategy) {
      continue;
    }
    const candidateIds = tradeSelectionIdsBySignal.get(`${signalTs}|${strategy}`) || [];
    for (const tradeSelectionId of candidateIds) {
      if (tradeSelectionId && !tradeSelectionIds.includes(tradeSelectionId)) {
        tradeSelectionIds.push(tradeSelectionId);
      }
    }
  }
  return tradeSelectionIds;
}

function pushUniqueValues(target, values = []) {
  for (const value of Array.isArray(values) ? values : []) {
    if (value != null && value !== "" && !target.includes(value)) {
      target.push(value);
    }
  }
}

function pushUniqueSignalRefs(target, signalRefs = []) {
  const seen = new Set(target.map((signalRef) => `${signalRef?.signalTs || ""}|${signalRef?.strategy || ""}`));
  for (const signalRef of Array.isArray(signalRefs) ? signalRefs : []) {
    const signalTs = String(signalRef?.signalTs || "").trim();
    const strategy = String(signalRef?.strategy || "").trim().toLowerCase();
    if (!signalTs || !strategy) {
      continue;
    }
    const key = `${signalTs}|${strategy}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    target.push({
      ...signalRef,
      signalTs,
      strategy,
    });
  }
}

function buildCompressedIndicatorWindowId(direction, startMs, endMs, strategy) {
  return [
    String(direction || "").trim().toLowerCase(),
    String(startMs || "").trim(),
    String(endMs || "").trim(),
    String(strategy || "").trim().toLowerCase(),
  ].join("|");
}

function compressIndicatorWindowsToChartBars(chartBarRanges, indicatorWindows) {
  if (!chartBarRanges.length || !indicatorWindows.length) {
    return indicatorWindows;
  }

  const windowsByStrategy = new Map();
  for (const indicatorWindow of indicatorWindows) {
    const strategy = String(indicatorWindow?.strategy || "").trim().toLowerCase() || "all";
    const strategyWindows = windowsByStrategy.get(strategy) || [];
    strategyWindows.push(indicatorWindow);
    windowsByStrategy.set(strategy, strategyWindows);
  }

  const compressedWindows = [];
  const lastChartBarIndex = chartBarRanges.length - 1;

  for (const [strategy, strategyWindows] of windowsByStrategy.entries()) {
    const barStates = Array.from({ length: chartBarRanges.length }, () => ({
      longScore: 0,
      shortScore: 0,
      longConviction: 0,
      shortConviction: 0,
      longTradeSelectionIds: [],
      shortTradeSelectionIds: [],
      longSignalRefs: [],
      shortSignalRefs: [],
      longOpenEnded: false,
      shortOpenEnded: false,
    }));

    for (const indicatorWindow of strategyWindows) {
      const direction = indicatorWindow?.direction === "short" ? "short" : "long";
      const startBarIndex = Math.max(0, Number(indicatorWindow?.startBarIndex) || 0);
      const endBarIndex = Math.min(lastChartBarIndex, Number(indicatorWindow?.endBarIndex) || 0);
      const startMs = Number(indicatorWindow?.startMs);
      const endMs = Number(indicatorWindow?.endMs);
      const weightFloor = Math.max(0.25, Number(indicatorWindow?.conviction) || 0);
      const scoreKey = direction === "short" ? "shortScore" : "longScore";
      const convictionKey = direction === "short" ? "shortConviction" : "longConviction";
      const tradeSelectionIdsKey = direction === "short" ? "shortTradeSelectionIds" : "longTradeSelectionIds";
      const signalRefsKey = direction === "short" ? "shortSignalRefs" : "longSignalRefs";
      const openEndedKey = direction === "short" ? "shortOpenEnded" : "longOpenEnded";

      for (let barIndex = startBarIndex; barIndex <= endBarIndex; barIndex += 1) {
        const chartBarRange = chartBarRanges[barIndex];
        if (!chartBarRange) {
          continue;
        }

        const overlapStartMs = Number.isFinite(startMs)
          ? Math.max(chartBarRange.startMs, startMs)
          : chartBarRange.startMs;
        const overlapEndMs = Number.isFinite(endMs)
          ? Math.min(chartBarRange.endMs, endMs)
          : chartBarRange.endMs;
        const overlapMs = Math.max(1, overlapEndMs - overlapStartMs);
        if (!Number.isFinite(overlapMs) || overlapMs <= 0) {
          continue;
        }

        const barState = barStates[barIndex];
        barState[scoreKey] += overlapMs * weightFloor;
        barState[convictionKey] = Math.max(barState[convictionKey], Number(indicatorWindow?.conviction) || 0);
        pushUniqueValues(barState[tradeSelectionIdsKey], indicatorWindow?.tradeSelectionIds);
        pushUniqueSignalRefs(barState[signalRefsKey], indicatorWindow?.signalRefs);
        barState[openEndedKey] = barState[openEndedKey] || Boolean(indicatorWindow?.openEnded);
      }
    }

    let currentWindow = null;

    const flushWindow = () => {
      if (!currentWindow) {
        return;
      }

      const startRange = chartBarRanges[currentWindow.startBarIndex];
      const endRange = chartBarRanges[currentWindow.endBarIndex];
      if (!startRange || !endRange) {
        currentWindow = null;
        return;
      }

      compressedWindows.push({
        id: buildCompressedIndicatorWindowId(
          currentWindow.direction,
          startRange.startMs,
          endRange.endMs,
          strategy,
        ),
        strategy,
        direction: currentWindow.direction,
        tone: currentWindow.direction === "short" ? "bearish" : "bullish",
        startBarIndex: currentWindow.startBarIndex,
        endBarIndex: currentWindow.endBarIndex,
        startMs: startRange.startMs,
        endMs: endRange.endMs,
        startTs: String(startRange.startMs),
        endTs: String(endRange.endMs),
        conviction: currentWindow.conviction,
        openEnded: currentWindow.endBarIndex === lastChartBarIndex && currentWindow.openEnded,
        tradeSelectionId: currentWindow.tradeSelectionIds[0] || null,
        tradeSelectionIds: currentWindow.tradeSelectionIds,
        signalRefs: currentWindow.signalRefs,
        meta: {
          strategies: [strategy],
          signalCount: currentWindow.signalRefs.length,
        },
      });
      currentWindow = null;
    };

    for (let barIndex = 0; barIndex < barStates.length; barIndex += 1) {
      const barState = barStates[barIndex];
      const longScore = Number(barState.longScore) || 0;
      const shortScore = Number(barState.shortScore) || 0;
      const direction = longScore > 0 || shortScore > 0
        ? (longScore >= shortScore ? "long" : "short")
        : null;

      if (!direction) {
        flushWindow();
        continue;
      }

      const nextTradeSelectionIds = direction === "short"
        ? barState.shortTradeSelectionIds
        : barState.longTradeSelectionIds;
      const nextSignalRefs = direction === "short"
        ? barState.shortSignalRefs
        : barState.longSignalRefs;
      const nextConviction = direction === "short"
        ? barState.shortConviction
        : barState.longConviction;
      const nextOpenEnded = direction === "short"
        ? barState.shortOpenEnded
        : barState.longOpenEnded;

      if (!currentWindow || currentWindow.direction !== direction || barIndex !== currentWindow.endBarIndex + 1) {
        flushWindow();
        currentWindow = {
          direction,
          startBarIndex: barIndex,
          endBarIndex: barIndex,
          conviction: nextConviction,
          openEnded: nextOpenEnded,
          tradeSelectionIds: [...nextTradeSelectionIds],
          signalRefs: [...nextSignalRefs],
        };
        continue;
      }

      currentWindow.endBarIndex = barIndex;
      currentWindow.conviction = Math.max(currentWindow.conviction, nextConviction);
      currentWindow.openEnded = currentWindow.openEnded || nextOpenEnded;
      pushUniqueValues(currentWindow.tradeSelectionIds, nextTradeSelectionIds);
      pushUniqueSignalRefs(currentWindow.signalRefs, nextSignalRefs);
    }

    flushWindow();
  }

  return compressedWindows.sort((left, right) => {
    if (left.startBarIndex !== right.startBarIndex) {
      return left.startBarIndex - right.startBarIndex;
    }
    return String(left.strategy || "").localeCompare(String(right.strategy || ""));
  });
}

function resolveBoundaryBarIndex(chartBarRanges, epochMs, side = "start") {
  if (!Number.isFinite(epochMs) || !chartBarRanges.length) {
    return { index: null, usedFallback: false };
  }

  const firstRange = chartBarRanges[0];
  const lastRange = chartBarRanges[chartBarRanges.length - 1];
  if (epochMs <= firstRange.startMs) {
    return { index: 0, usedFallback: false };
  }
  if (epochMs >= lastRange.endMs) {
    return { index: chartBarRanges.length - 1, usedFallback: false };
  }

  const resolved = resolveBarIndex(chartBarRanges, epochMs);
  if (resolved.index != null) {
    return resolved;
  }

  return {
    index: side === "end" ? chartBarRanges.length - 1 : 0,
    usedFallback: resolved.usedFallback,
  };
}

function createIndicatorOverlayModel(chartBarRanges, indicatorOverlayTape, trades) {
  const eventSource = Array.isArray(indicatorOverlayTape?.events) ? indicatorOverlayTape.events : [];
  const zoneSource = Array.isArray(indicatorOverlayTape?.zones) ? indicatorOverlayTape.zones : [];
  const windowSource = Array.isArray(indicatorOverlayTape?.windows) ? indicatorOverlayTape.windows : [];
  const tradeSelectionIdsBySignal = buildTradeSelectionIdsBySignal(trades);
  const indicatorEvents = [];
  const indicatorZones = [];
  const indicatorWindows = [];
  let fallbackCount = 0;

  for (const event of eventSource) {
    const eventMs = parseMarketTimestamp(event?.ts);
    const resolution = resolveBarIndex(chartBarRanges, eventMs);
    if (resolution.usedFallback) {
      fallbackCount += 1;
    }
    if (resolution.index == null) {
      continue;
    }

    const signalTs = String(event?.signalTs || event?.ts || "").trim();
    const strategy = String(event?.strategy || "").trim().toLowerCase();
    const tradeSelectionIds = tradeSelectionIdsBySignal.get(`${signalTs}|${strategy}`) || [];

    indicatorEvents.push({
      ...event,
      strategy,
      barIndex: resolution.index,
      tradeSelectionId: tradeSelectionIds[0] || null,
      tradeSelectionIds,
    });
  }

  if (!chartBarRanges.length) {
    return {
      indicatorEvents,
      indicatorZones,
      indicatorWindows,
      fallbackCount,
    };
  }

  const domainStart = chartBarRanges[0].startMs;
  const domainEnd = chartBarRanges[chartBarRanges.length - 1].endMs;

  for (const zone of zoneSource) {
    const rawStartMs = parseMarketTimestamp(zone?.startTs);
    const rawEndMs = parseMarketTimestamp(zone?.endTs);
    if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs)) {
      continue;
    }

    if (rawEndMs < domainStart || rawStartMs > domainEnd) {
      continue;
    }

    const startMs = Math.max(rawStartMs, domainStart);
    const endMs = Math.min(rawEndMs, domainEnd);
    const startResolution = resolveBoundaryBarIndex(chartBarRanges, startMs, "start");
    const endResolution = resolveBoundaryBarIndex(chartBarRanges, endMs, "end");
    if (startResolution.usedFallback) fallbackCount += 1;
    if (endResolution.usedFallback) fallbackCount += 1;
    if (startResolution.index == null || endResolution.index == null) {
      continue;
    }

    const signalTs = String(zone?.signalTs || zone?.startTs || "").trim();
    const strategy = String(zone?.strategy || "").trim().toLowerCase();
    const tradeSelectionIds = tradeSelectionIdsBySignal.get(`${signalTs}|${strategy}`) || [];

    indicatorZones.push({
      ...zone,
      strategy,
      startBarIndex: Math.min(startResolution.index, endResolution.index),
      endBarIndex: Math.max(startResolution.index, endResolution.index),
      tradeSelectionId: tradeSelectionIds[0] || null,
      tradeSelectionIds,
    });
  }

  for (const window of windowSource) {
    const rawStartMs = parseMarketTimestamp(window?.startTs);
    const rawEndMs = parseMarketTimestamp(window?.endTs);
    if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs)) {
      continue;
    }

    if (rawEndMs < domainStart || rawStartMs > domainEnd) {
      continue;
    }

    const startMs = Math.max(rawStartMs, domainStart);
    const endMs = Math.min(rawEndMs, domainEnd);
    const startResolution = resolveBoundaryBarIndex(chartBarRanges, startMs, "start");
    const endResolution = resolveBoundaryBarIndex(chartBarRanges, endMs, "end");
    if (startResolution.usedFallback) fallbackCount += 1;
    if (endResolution.usedFallback) fallbackCount += 1;
    if (startResolution.index == null || endResolution.index == null) {
      continue;
    }

    const signalRefs = Array.isArray(window?.signalRefs) && window.signalRefs.length
      ? window.signalRefs
      : [{
        signalTs: window?.signalTs || window?.startTs,
        strategy: window?.strategy,
      }];
    const tradeSelectionIds = collectTradeSelectionIdsForSignalRefs(tradeSelectionIdsBySignal, signalRefs);

    indicatorWindows.push({
      ...window,
      strategy: String(window?.strategy || "").trim().toLowerCase() || "all",
      startBarIndex: Math.min(startResolution.index, endResolution.index),
      endBarIndex: Math.max(startResolution.index, endResolution.index),
      startMs,
      endMs,
      tradeSelectionId: tradeSelectionIds[0] || null,
      tradeSelectionIds,
      signalRefs,
    });
  }

  const compressedIndicatorWindows = compressIndicatorWindowsToChartBars(chartBarRanges, indicatorWindows);

  return {
    indicatorEvents,
    indicatorZones,
    indicatorWindows: compressedIndicatorWindows,
    fallbackCount,
  };
}

export function buildChartSeriesModel({
  bars = [],
  dailyBars = [],
  chartRange = "3M",
  chartWindowMode = "default",
  effectiveTf = "D",
  tfMin = 5,
} = {}) {
  const rawBars = Array.isArray(bars) ? bars : [];
  const resolvedDailyBars = Array.isArray(dailyBars) && dailyBars.length
    ? dailyBars
    : (rawBars.length ? aggregateDailyBars(rawBars) : []);
  if (!rawBars.length && !resolvedDailyBars.length) {
    return {
      chartBars: [],
      chartBarRanges: [],
      defaultVisibleLogicalRange: null,
    };
  }
  const weeklyBars = aggregateWeeklyBars(resolvedDailyBars);

  let chartBars = [];
  let chartBarRanges = [];

  if (effectiveTf === "W") {
    chartBars = weeklyBars;
    chartBarRanges = buildWeeklyRanges(chartBars);
  } else if (effectiveTf === "D") {
    chartBars = resolvedDailyBars;
    chartBarRanges = buildDailyRanges(chartBars);
  } else if (effectiveTf === "1m") {
    chartBars = rawBars;
    chartBarRanges = buildRawSourceRanges(chartBars, 1);
  } else {
    const bucketMinutes = INTRADAY_BUCKET_MINUTES[effectiveTf];
    if (!bucketMinutes) {
      chartBars = rawBars;
      chartBarRanges = buildRawSourceRanges(chartBars, tfMin);
    } else {
      const aggregated = aggregateIntradayBars(rawBars, bucketMinutes, tfMin);
      chartBars = aggregated.chartBars;
      chartBarRanges = aggregated.chartBarRanges;
    }
  }

  const defaultVisibleLogicalRange = buildDefaultVisibleLogicalRange(
    chartBars.length,
    isAllCandlesWindowMode(chartWindowMode)
      ? chartBars.length
      : countPresetVisibleBars({
        bars: rawBars,
        chartRange,
        effectiveTf,
        tfMin,
        resolvedDailyBars,
        weeklyBars,
      }),
  );

  return {
    chartBars,
    chartBarRanges,
    defaultVisibleLogicalRange,
  };
}

export function buildTradeOverlayModel({
  chartBars = [],
  chartBarRanges = [],
  trades = [],
  pricingMode = null,
  chartPriceContext = "spot",
} = {}) {
  if (!chartBarRanges.length) {
    return {
      tradeOverlays: [],
      entriesByBarIndex: {},
      exitsByBarIndex: {},
      tradeResolutionStats: createEmptyTradeResolutionStats(),
      overlayFallbackCount: 0,
    };
  }

  const overlayModel = createTradeOverlays(
    chartBarRanges,
    trades,
    pricingMode,
    chartBars,
    chartPriceContext,
  );

  return {
    tradeOverlays: overlayModel.tradeOverlays,
    entriesByBarIndex: overlayModel.entriesByBarIndex,
    exitsByBarIndex: overlayModel.exitsByBarIndex,
    tradeResolutionStats: overlayModel.tradeResolutionStats,
    overlayFallbackCount: overlayModel.tradeResolutionStats.totalBoundarySnapCount,
  };
}

export function buildIndicatorOverlayModel({
  chartBarRanges = [],
  indicatorOverlayTape = null,
  trades = [],
} = {}) {
  if (!chartBarRanges.length) {
    return {
      indicatorEvents: [],
      indicatorZones: [],
      indicatorWindows: [],
      indicatorOverlayFallbackCount: 0,
    };
  }

  const indicatorOverlayModel = createIndicatorOverlayModel(chartBarRanges, indicatorOverlayTape, trades);

  return {
    indicatorEvents: indicatorOverlayModel.indicatorEvents,
    indicatorZones: indicatorOverlayModel.indicatorZones,
    indicatorWindows: indicatorOverlayModel.indicatorWindows,
    indicatorOverlayFallbackCount: indicatorOverlayModel.fallbackCount,
  };
}

export function buildChartDisplayModel({
  bars = [],
  dailyBars = [],
  chartRange = "3M",
  effectiveTf = "D",
  tfMin = 5,
  trades = [],
  pricingMode = null,
  chartPriceContext = "spot",
  indicatorOverlayTape = null,
} = {}) {
  const baseModel = buildChartSeriesModel({
    bars,
    dailyBars,
    chartRange,
    effectiveTf,
    tfMin,
  });
  const overlayModel = buildTradeOverlayModel({
    chartBars: baseModel.chartBars,
    chartBarRanges: baseModel.chartBarRanges,
    trades,
    pricingMode,
    chartPriceContext,
  });
  const indicatorOverlayModel = buildIndicatorOverlayModel({
    chartBarRanges: baseModel.chartBarRanges,
    indicatorOverlayTape,
    trades,
  });

  return {
    ...baseModel,
    ...overlayModel,
    ...indicatorOverlayModel,
  };
}
