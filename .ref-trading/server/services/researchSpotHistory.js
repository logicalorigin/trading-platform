import { getMassiveEquityBarsWithCache } from "./massiveClient.js";
import {
  readResearchSpotBars,
  readResearchSpotBarsCoverage,
  readResearchSpotWarmState,
  upsertResearchSpotWarmState,
  writeResearchSpotBars,
} from "./massiveDbCache.js";
import {
  buildResearchBarFromEpochMs,
  getEpochMsForMarketDateTime,
  getMarketDateOffset,
  getMarketTimePartsFromEpochMs,
  isRegularMarketSessionParts,
  MARKET_SESSION_OPEN_MINUTES,
  offsetDateText,
} from "../../src/research/market/time.js";

const BLOCKED_HISTORY_MARKERS = [
  "synthetic",
  "fallback",
  "dry-run",
  "unavailable",
  "anchored",
];
const MAX_CHART_HISTORY_DAYS = 730;
const INITIAL_ONE_MINUTE_WINDOW_DAYS = 45;
const MAX_INITIAL_ONE_MINUTE_WINDOW_DAYS = 125;
const INTRADAY_CHUNK_WINDOW_DAYS = 60;
// Keep minute warm windows below Massive's 50k aggregate cap before regular-session filtering.
const ONE_MINUTE_CHUNK_DAYS = 60;
const MASSIVE_REQUEST_LIMIT = 50000;
const BROKER_ONE_MINUTE_COUNT_BACK = 200000;
const BROKER_INITIAL_ONE_MINUTE_COUNT_BACK = 12000;
const BROKER_CHUNK_ONE_MINUTE_COUNT_BACK = 25000;
const BROKER_FIVE_MINUTE_COUNT_BACK = 50000;
const BROKER_DAILY_COUNT_BACK = 2000;
const BROKER_ONE_MINUTE_BARS_PER_DAY = 410;
const MARKET_DAYS_PER_WEEK = 5;
const CALENDAR_DAYS_PER_WEEK = 7;
const INTRADAY_WINDOW_BUFFER_DAYS = 7;

function resolveChartHistoryWindowDays(days = MAX_CHART_HISTORY_DAYS) {
  return Math.max(1, Math.round(Number(days) || MAX_CHART_HISTORY_DAYS));
}

function resolveChartHistoryStart(days = MAX_CHART_HISTORY_DAYS) {
  return getMarketDateOffset(-(resolveChartHistoryWindowDays(days) - 1));
}

function mergeIntradaySpotBars({ oneMinuteBars = [], fiveMinuteBars = [] } = {}) {
  if (oneMinuteBars.length && fiveMinuteBars.length) {
    const oneMinuteStart = oneMinuteBars[0]?.time || 0;
    const olderBars = fiveMinuteBars.filter((bar) => Number(bar?.time) < oneMinuteStart);
    return [...olderBars, ...oneMinuteBars];
  }
  if (oneMinuteBars.length) {
    return oneMinuteBars;
  }
  if (fiveMinuteBars.length) {
    return fiveMinuteBars;
  }
  return [];
}

function deriveDailyBarsFromIntradayBars(rawBars = []) {
  const dailyBars = [];
  let current = null;

  for (const bar of Array.isArray(rawBars) ? rawBars : []) {
    if (!current || current.date !== bar.date) {
      if (current) {
        dailyBars.push(current);
      }
      current = {
        time: getEpochMsForMarketDateTime(bar.date, 9, 30),
        ts: bar.date,
        date: bar.date,
        hour: 9,
        min: 30,
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: Number(bar.v) || 0,
        vix: bar.vix,
      };
      continue;
    }

    current.h = Math.max(current.h, bar.h);
    current.l = Math.min(current.l, bar.l);
    current.c = bar.c;
    current.v += Number(bar.v) || 0;
    current.vix = bar.vix;
  }

  if (current) {
    dailyBars.push(current);
  }

  return dailyBars;
}

function compareDateText(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function normalizeHistoryMode(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "initial" || normalized === "chunk") {
    return normalized;
  }
  return "full";
}

function normalizePreferredIntradayTf(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "5m" ? "5m" : "1m";
}

function normalizeCursorDate(before) {
  const raw = String(before || "").trim();
  if (!raw) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const epochMs = Number(raw);
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return null;
  }
  const marketTime = getMarketTimePartsFromEpochMs(epochMs);
  return String(marketTime?.date || "").trim() || null;
}

function normalizeInitialWindowDays(initialWindowDays) {
  const numeric = Math.round(Number(initialWindowDays));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return INITIAL_ONE_MINUTE_WINDOW_DAYS;
  }
  return Math.min(
    MAX_INITIAL_ONE_MINUTE_WINDOW_DAYS,
    Math.max(INITIAL_ONE_MINUTE_WINDOW_DAYS, numeric),
  );
}

function expandMarketDaysToCalendarDays(marketDays) {
  const normalizedMarketDays = normalizeInitialWindowDays(marketDays);
  return Math.max(
    normalizedMarketDays,
    Math.ceil((normalizedMarketDays * CALENDAR_DAYS_PER_WEEK) / MARKET_DAYS_PER_WEEK) + INTRADAY_WINDOW_BUFFER_DAYS,
  );
}

function resolveBrokerInitialOneMinuteCountBack(initialWindowDays) {
  const resolvedWindowDays = normalizeInitialWindowDays(initialWindowDays);
  if (resolvedWindowDays <= INITIAL_ONE_MINUTE_WINDOW_DAYS) {
    return BROKER_INITIAL_ONE_MINUTE_COUNT_BACK;
  }
  return Math.min(
    BROKER_ONE_MINUTE_COUNT_BACK,
    Math.max(
      BROKER_INITIAL_ONE_MINUTE_COUNT_BACK,
      resolvedWindowDays * BROKER_ONE_MINUTE_BARS_PER_DAY,
    ),
  );
}

function resolveIntradayDateWindow({
  mode,
  before = null,
  historyStart,
  historyEnd,
  initialWindowDays = INITIAL_ONE_MINUTE_WINDOW_DAYS,
}) {
  const resolvedMode = normalizeHistoryMode(mode);
  const finalDate = String(historyEnd || "").trim();
  const firstDate = String(historyStart || "").trim();
  if (!finalDate || !firstDate) {
    return { mode: resolvedMode, from: null, to: null, hasMoreIntraday: false };
  }

  if (resolvedMode === "initial") {
    const resolvedInitialWindowDays = normalizeInitialWindowDays(initialWindowDays);
    const resolvedInitialCalendarDays = expandMarketDaysToCalendarDays(resolvedInitialWindowDays);
    const initialFrom = offsetDateText(finalDate, -(resolvedInitialCalendarDays - 1)) || firstDate;
    const boundedFrom = compareDateText(initialFrom, firstDate) < 0 ? firstDate : initialFrom;
    return {
      mode: resolvedMode,
      from: boundedFrom,
      to: finalDate,
      hasMoreIntraday: compareDateText(boundedFrom, firstDate) > 0,
    };
  }

  if (resolvedMode === "chunk") {
    const cursorDate = normalizeCursorDate(before);
    if (!cursorDate) {
      throw new Error("Chunked spot-history requests require a valid before cursor");
    }
    const chunkTo = offsetDateText(cursorDate, -1);
    if (!chunkTo || compareDateText(chunkTo, firstDate) < 0) {
      return {
        mode: resolvedMode,
        from: null,
        to: null,
        hasMoreIntraday: false,
      };
    }
    const chunkFrom = offsetDateText(chunkTo, -(INTRADAY_CHUNK_WINDOW_DAYS - 1)) || firstDate;
    const boundedFrom = compareDateText(chunkFrom, firstDate) < 0 ? firstDate : chunkFrom;
    return {
      mode: resolvedMode,
      from: boundedFrom,
      to: chunkTo,
      hasMoreIntraday: compareDateText(boundedFrom, firstDate) > 0,
    };
  }

  return {
    mode: resolvedMode,
    from: firstDate,
    to: finalDate,
    hasMoreIntraday: false,
  };
}

export function resolveMassiveFiveMinutePrimaryDateWindow({
  mode = "full",
  historyStart = null,
  dateWindow = null,
} = {}) {
  const resolvedMode = normalizeHistoryMode(mode);
  const from = String(dateWindow?.from || "").trim() || null;
  const to = String(dateWindow?.to || "").trim() || null;
  const normalizedHistoryStart = String(historyStart || "").trim() || null;
  if (!to) {
    return { from: null, to: null };
  }
  if (resolvedMode === "initial" && normalizedHistoryStart) {
    return {
      from: normalizedHistoryStart,
      to,
    };
  }
  return {
    from,
    to,
  };
}

function buildIntradayMeta({
  dataSource,
  intradayBars,
  dailyBars,
  oneMinuteBars = [],
  fiveMinuteBars = [],
  fetchedAt = null,
  hasMoreIntraday = false,
  mode = "full",
}) {
  const coverageStart = intradayBars[0]?.date || null;
  const coverageEnd = intradayBars[intradayBars.length - 1]?.date || null;
  return {
    source: dataSource,
    stale: false,
    dataQuality: "vendor_primary",
    fetchedAt,
    mode,
    hasMoreIntraday,
    nextBefore: hasMoreIntraday ? intradayBars[0]?.time || null : null,
    coverage: {
      intradayStart: coverageStart,
      intradayEnd: coverageEnd,
      oneMinuteStart: oneMinuteBars[0]?.date || coverageStart,
      fiveMinuteStart: fiveMinuteBars[0]?.date || null,
      dailyStart: dailyBars[0]?.date || null,
      dailyEnd: dailyBars[dailyBars.length - 1]?.date || null,
    },
  };
}

function buildDateWindows(fromDate, toDate, chunkDays = ONE_MINUTE_CHUNK_DAYS) {
  const windows = [];
  let cursor = String(fromDate || "").trim();
  const finalDate = String(toDate || "").trim();
  const safeChunkDays = Math.max(1, Math.round(Number(chunkDays) || ONE_MINUTE_CHUNK_DAYS));
  while (cursor && finalDate && compareDateText(cursor, finalDate) <= 0) {
    const chunkEnd = offsetDateText(cursor, safeChunkDays - 1) || finalDate;
    const boundedEnd = compareDateText(chunkEnd, finalDate) > 0 ? finalDate : chunkEnd;
    windows.push({ from: cursor, to: boundedEnd });
    const nextCursor = offsetDateText(boundedEnd, 1);
    if (!nextCursor || compareDateText(nextCursor, boundedEnd) <= 0) {
      break;
    }
    cursor = nextCursor;
  }
  return windows;
}

function buildSeedIntradayWindows(fromDate, toDate) {
  if (!isDateRangeValid(fromDate, toDate)) {
    return [];
  }

  const windows = [];
  const latestWindowFrom = offsetDateText(toDate, -(INITIAL_ONE_MINUTE_WINDOW_DAYS - 1)) || fromDate;
  const boundedLatestWindowFrom = compareDateText(latestWindowFrom, fromDate) < 0 ? fromDate : latestWindowFrom;
  windows.push({
    from: boundedLatestWindowFrom,
    to: toDate,
  });

  let cursor = boundedLatestWindowFrom;
  while (compareDateText(cursor, fromDate) > 0) {
    const chunkTo = offsetDateText(cursor, -1);
    if (!chunkTo || compareDateText(chunkTo, fromDate) < 0) {
      break;
    }
    const chunkFrom = offsetDateText(chunkTo, -(INTRADAY_CHUNK_WINDOW_DAYS - 1)) || fromDate;
    const boundedChunkFrom = compareDateText(chunkFrom, fromDate) < 0 ? fromDate : chunkFrom;
    windows.push({
      from: boundedChunkFrom,
      to: chunkTo,
    });
    cursor = boundedChunkFrom;
  }

  return windows;
}

function buildNextWarmIntradayWindow({ targetStart, targetEnd, nextCursorDate = null }) {
  if (!isDateRangeValid(targetStart, targetEnd)) {
    return null;
  }
  if (!nextCursorDate) {
    const latestWindowFrom = offsetDateText(targetEnd, -(INITIAL_ONE_MINUTE_WINDOW_DAYS - 1)) || targetStart;
    const boundedLatestWindowFrom = compareDateText(latestWindowFrom, targetStart) < 0
      ? targetStart
      : latestWindowFrom;
    return {
      from: boundedLatestWindowFrom,
      to: targetEnd,
      kind: "initial",
    };
  }

  const chunkTo = offsetDateText(nextCursorDate, -1);
  if (!chunkTo || compareDateText(chunkTo, targetStart) < 0) {
    return null;
  }
  const chunkFrom = offsetDateText(chunkTo, -(INTRADAY_CHUNK_WINDOW_DAYS - 1)) || targetStart;
  const boundedChunkFrom = compareDateText(chunkFrom, targetStart) < 0 ? targetStart : chunkFrom;
  return {
    from: boundedChunkFrom,
    to: chunkTo,
    kind: "chunk",
  };
}

function dedupeSpotHistoryBars(rawBars = []) {
  const dedupedByTime = new Map();
  for (const bar of Array.isArray(rawBars) ? rawBars : []) {
    const time = Number(bar?.time);
    if (!Number.isFinite(time)) {
      continue;
    }
    dedupedByTime.set(time, bar);
  }
  return [...dedupedByTime.values()].sort((left, right) => Number(left?.time || 0) - Number(right?.time || 0));
}

function isDateRangeValid(fromDate, toDate) {
  return Boolean(fromDate && toDate && compareDateText(fromDate, toDate) <= 0);
}

function buildMissingCoverageWindows({ from, to, coverageStart = null, coverageEnd = null }) {
  if (!isDateRangeValid(from, to)) {
    return [];
  }
  if (!coverageStart || !coverageEnd) {
    return [{ from, to }];
  }

  const windows = [];
  const leftWindowEnd = offsetDateText(coverageStart, -1);
  if (isDateRangeValid(from, leftWindowEnd)) {
    windows.push({
      from,
      to: compareDateText(leftWindowEnd, to) > 0 ? to : leftWindowEnd,
    });
  }

  const rightWindowStart = offsetDateText(coverageEnd, 1);
  if (isDateRangeValid(rightWindowStart, to)) {
    windows.push({
      from: compareDateText(from, rightWindowStart) > 0 ? from : rightWindowStart,
      to,
    });
  }

  return windows.filter((window) => isDateRangeValid(window.from, window.to));
}

export function resolveBootstrappedWarmState({
  existingState = null,
} = {}) {
  return existingState || null;
}

export function hasCoverageForDateWindow({
  coverageStart = null,
  coverageEnd = null,
  from = null,
  to = null,
} = {}) {
  return Boolean(
    coverageStart
    && coverageEnd
    && from
    && to
    && compareDateText(coverageStart, from) <= 0
    && compareDateText(coverageEnd, to) >= 0
  );
}

export function mergeContiguousCoverageWindow({
  currentStart = null,
  currentEnd = null,
  windowFrom = null,
  windowTo = null,
} = {}) {
  if (!isDateRangeValid(windowFrom, windowTo)) {
    return {
      coverageStart: currentStart || null,
      coverageEnd: currentEnd || null,
      merged: false,
    };
  }
  if (!isDateRangeValid(currentStart, currentEnd)) {
    return {
      coverageStart: windowFrom,
      coverageEnd: windowTo,
      merged: true,
    };
  }

  const touchesOrOverlapsCurrentStart = compareDateText(windowTo, offsetDateText(currentStart, -1) || currentStart) >= 0;
  const touchesOrOverlapsCurrentEnd = compareDateText(windowFrom, offsetDateText(currentEnd, 1) || currentEnd) <= 0;
  if (!touchesOrOverlapsCurrentStart || !touchesOrOverlapsCurrentEnd) {
    return {
      coverageStart: currentStart,
      coverageEnd: currentEnd,
      merged: false,
    };
  }

  return {
    coverageStart: compareDateText(windowFrom, currentStart) < 0 ? windowFrom : currentStart,
    coverageEnd: compareDateText(windowTo, currentEnd) > 0 ? windowTo : currentEnd,
    merged: true,
  };
}

export function resolveNextWarmCoverageWindow({
  targetStart,
  targetEnd,
  contiguousCoverageStart = null,
  contiguousCoverageEnd = null,
  nextCursorDate = null,
} = {}) {
  const fullyCovered = Boolean(
    contiguousCoverageStart
    && contiguousCoverageEnd
    && compareDateText(contiguousCoverageStart, targetStart) <= 0
    && compareDateText(contiguousCoverageEnd, targetEnd) >= 0,
  );
  const missingWindows = buildMissingCoverageWindows({
    from: targetStart,
    to: targetEnd,
    coverageStart: contiguousCoverageStart,
    coverageEnd: contiguousCoverageEnd,
  });
  if (missingWindows.length) {
    const newestGap = missingWindows[missingWindows.length - 1];
    return buildNextWarmIntradayWindow({
      targetStart: newestGap.from,
      targetEnd: newestGap.to,
      nextCursorDate: null,
    });
  }
  if (fullyCovered) {
    return null;
  }
  return buildNextWarmIntradayWindow({
    targetStart,
    targetEnd,
    nextCursorDate,
  });
}

async function loadSeededOneMinuteBars({
  symbol,
  from,
  to,
  session = "regular",
}) {
  try {
    const warmState = await readResearchSpotWarmState({
      ticker: symbol,
      session,
      timeframe: "1m",
    });
    const coverage = await readResearchSpotBarsCoverage({
      ticker: symbol,
      session,
      timeframe: "1m",
    });
    const verifiedStart = warmState?.completedAt
      ? warmState?.targetStart
      : warmState?.nextCursorDate || null;
    const verifiedEnd = warmState?.targetEnd || null;
    const hasCoverageWindow = hasCoverageForDateWindow({
      coverageStart: coverage?.coverageStart || null,
      coverageEnd: coverage?.coverageEnd || null,
      from,
      to,
    });
    const hasVerifiedContiguousCoverage = Boolean(
      verifiedStart
      && verifiedEnd
      && compareDateText(verifiedStart, from) <= 0
      && compareDateText(verifiedEnd, to) >= 0,
    );
    const trustCoverageTable = hasCoverageWindow
      && (
        hasVerifiedContiguousCoverage
        || String(coverage?.source || "").trim().toLowerCase() === "massive-equity-history"
      );

    if (!coverage?.coverageStart || !coverage?.coverageEnd || !trustCoverageTable) {
      return {
        bars: [],
        coverage,
        warmState,
        fullyCovered: false,
      };
    }

    const overlapFrom = compareDateText(from, coverage.coverageStart) > 0 ? from : coverage.coverageStart;
    const overlapTo = compareDateText(to, coverage.coverageEnd) < 0 ? to : coverage.coverageEnd;
    const bars = isDateRangeValid(overlapFrom, overlapTo)
      ? await readResearchSpotBars({
        ticker: symbol,
        session,
        from: overlapFrom,
        to: overlapTo,
      })
      : [];

    return {
      bars,
      coverage,
      warmState,
      fullyCovered: true,
    };
  } catch (error) {
    console.warn(`[research-spot-history] Failed to read seeded DB coverage for ${symbol}:`, error?.message || error);
    return {
      bars: [],
      coverage: null,
      warmState: null,
      fullyCovered: false,
    };
  }
}

async function loadOrFetchSeededMassiveOneMinuteBars({
  symbol,
  from,
  to,
  session = "regular",
  chunkDays = null,
  apiKey,
}) {
  const seeded = await loadSeededOneMinuteBars({
    symbol,
    from,
    to,
    session,
  });
  if (seeded.fullyCovered && seeded.bars.length) {
    return {
      bars: seeded.bars,
      fetchedAt: seeded.coverage?.fetchedAt || null,
      source: "database",
    };
  }

  const missingWindows = buildMissingCoverageWindows({
    from,
    to,
    coverageStart: seeded.fullyCovered ? (seeded.coverage?.coverageStart || null) : null,
    coverageEnd: seeded.fullyCovered ? (seeded.coverage?.coverageEnd || null) : null,
  });

  const fetchedBars = [];
  let fetchedAt = seeded.coverage?.fetchedAt || null;
  for (const window of missingWindows) {
    const payload = await fetchMassiveChunkedEquityBars({
      symbol,
      multiplier: 1,
      timespan: "minute",
      from: window.from,
      to: window.to,
      session,
      chunkDays,
      apiKey,
    });
    fetchedBars.push(...(Array.isArray(payload?.bars) ? payload.bars : []));
    if (payload?.fetchedAt && (!fetchedAt || String(payload.fetchedAt) > String(fetchedAt))) {
      fetchedAt = payload.fetchedAt;
    }
  }

  const dedupedFetchedBars = dedupeSpotHistoryBars(fetchedBars);
  if (dedupedFetchedBars.length) {
    try {
      await writeResearchSpotBars({
        ticker: symbol,
        session,
        bars: dedupedFetchedBars,
        source: "massive-equity-history",
        fetchedAt,
      });
    } catch (error) {
      console.warn(`[research-spot-history] Failed to persist seeded DB minute history for ${symbol}:`, error?.message || error);
    }
  }

  return {
    bars: dedupeSpotHistoryBars([...(seeded.bars || []), ...dedupedFetchedBars]),
    fetchedAt,
    source: dedupedFetchedBars.length ? "mixed" : (seeded.bars.length ? "database" : "remote"),
  };
}

function aggregateResearchBarsByMinutes(rawBars = [], bucketMinutes = 5) {
  const safeBucketMinutes = Math.max(1, Math.round(Number(bucketMinutes) || 5));
  if (safeBucketMinutes <= 1) {
    return dedupeSpotHistoryBars(rawBars);
  }

  const aggregatedBars = [];
  let currentKey = null;
  let currentBar = null;

  for (const rawBar of Array.isArray(rawBars) ? rawBars : []) {
    const time = Number(rawBar?.time);
    const open = Number(rawBar?.o ?? rawBar?.open);
    const high = Number(rawBar?.h ?? rawBar?.high);
    const low = Number(rawBar?.l ?? rawBar?.low);
    const close = Number(rawBar?.c ?? rawBar?.close);
    if (![time, open, high, low, close].every(Number.isFinite)) {
      continue;
    }

    const marketTime = getMarketTimePartsFromEpochMs(time);
    if (!isRegularMarketSessionParts(marketTime)) {
      continue;
    }

    const marketMinutes = Number(marketTime.hour) * 60 + Number(marketTime.min || 0);
    const bucketOffset = Math.max(0, Math.floor((marketMinutes - MARKET_SESSION_OPEN_MINUTES) / safeBucketMinutes));
    const bucketStartMinutes = MARKET_SESSION_OPEN_MINUTES + bucketOffset * safeBucketMinutes;
    const bucketHour = Math.floor(bucketStartMinutes / 60);
    const bucketMinute = bucketStartMinutes % 60;
    const bucketStartMs = getEpochMsForMarketDateTime(marketTime.date, bucketHour, bucketMinute);
    const bucketKey = marketTime.date + '|' + String(bucketStartMinutes);

    if (!currentBar || currentKey !== bucketKey) {
      if (currentBar) {
        aggregatedBars.push(currentBar);
      }
      currentKey = bucketKey;
      currentBar = buildResearchBarFromEpochMs(bucketStartMs, {
        date: marketTime.date,
        hour: bucketHour,
        min: bucketMinute,
        o: +open.toFixed(2),
        h: +high.toFixed(2),
        l: +low.toFixed(2),
        c: +close.toFixed(2),
        v: Math.max(0, Math.round(Number(rawBar?.v ?? rawBar?.volume) || 0)),
        vix: Number.isFinite(Number(rawBar?.vix)) ? Number(rawBar.vix) : 17.0,
      });
      continue;
    }

    currentBar.h = Math.max(currentBar.h, high);
    currentBar.l = Math.min(currentBar.l, low);
    currentBar.c = +close.toFixed(2);
    currentBar.v += Math.max(0, Math.round(Number(rawBar?.v ?? rawBar?.volume) || 0));
    currentBar.vix = Number.isFinite(Number(rawBar?.vix)) ? Number(rawBar.vix) : currentBar.vix;
  }

  if (currentBar) {
    aggregatedBars.push(currentBar);
  }

  return dedupeSpotHistoryBars(aggregatedBars);
}

async function loadOrFetchSeededMassiveFiveMinuteBars({
  symbol,
  from,
  to,
  session = "regular",
  apiKey,
}) {
  const seeded = await loadSeededOneMinuteBars({
    symbol,
    from,
    to,
    session,
  });
  const seededFiveMinuteBars = aggregateResearchBarsByMinutes(seeded?.bars || [], 5);
  if (seeded.fullyCovered && seededFiveMinuteBars.length) {
    return {
      bars: seededFiveMinuteBars,
      fetchedAt: seeded.coverage?.fetchedAt || null,
      source: "database",
    };
  }

  const missingWindows = buildMissingCoverageWindows({
    from,
    to,
    coverageStart: seeded.fullyCovered ? (seededFiveMinuteBars[0]?.date || null) : null,
    coverageEnd: seeded.fullyCovered ? (seededFiveMinuteBars[seededFiveMinuteBars.length - 1]?.date || null) : null,
  });

  const fetchedBars = [];
  let fetchedAt = seeded.coverage?.fetchedAt || null;
  for (const window of missingWindows) {
    const payload = await fetchMassiveChunkedEquityBars({
      symbol,
      multiplier: 5,
      timespan: "minute",
      from: window.from,
      to: window.to,
      session,
      // Massive can truncate long 5m ranges well before the requested end date.
      // Keep deep-history 5m fetches chunked so older chart coverage stays continuous.
      chunkDays: INTRADAY_CHUNK_WINDOW_DAYS,
      apiKey,
    });
    fetchedBars.push(...normalizeSpotHistoryBars(payload?.bars || []));
    if (payload?.fetchedAt && (!fetchedAt || String(payload.fetchedAt) > String(fetchedAt))) {
      fetchedAt = payload.fetchedAt;
    }
  }

  const dedupedFetchedBars = dedupeSpotHistoryBars(fetchedBars);
  return {
    bars: dedupeSpotHistoryBars([...(seededFiveMinuteBars || []), ...dedupedFetchedBars]),
    fetchedAt,
    source: dedupedFetchedBars.length ? (seededFiveMinuteBars.length ? "mixed" : "remote") : (seededFiveMinuteBars.length ? "database" : "remote"),
  };
}

async function fetchMassiveChunkedEquityBars({
  symbol,
  multiplier,
  timespan,
  from,
  to,
  session = "regular",
  chunkDays = null,
  apiKey,
}) {
  const windows = chunkDays
    ? buildDateWindows(from, to, chunkDays)
    : [{ from, to }];

  const bars = [];
  let fetchedAt = null;

  for (const window of windows) {
    const payload = await getMassiveEquityBarsWithCache(
      {
        ticker: symbol,
        multiplier,
        timespan,
        from: window.from,
        to: window.to,
        session,
        limit: MASSIVE_REQUEST_LIMIT,
      },
      { apiKey },
    );
    bars.push(...(Array.isArray(payload?.bars) ? payload.bars : []));
    if (payload?.fetchedAt && (!fetchedAt || String(payload.fetchedAt) > String(fetchedAt))) {
      fetchedAt = payload.fetchedAt;
    }
  }

  return {
    bars: dedupeSpotHistoryBars(bars),
    fetchedAt,
  };
}

function hasBlockedHistoryMarker(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return BLOCKED_HISTORY_MARKERS.some((marker) => normalized.includes(marker));
}

function isTrustedHistoricalPayload(payload) {
  if (!payload || !Array.isArray(payload?.bars) || !payload.bars.length) {
    return false;
  }
  return !hasBlockedHistoryMarker(payload?.source) && !hasBlockedHistoryMarker(payload?.dataQuality);
}

function normalizeSpotHistoryBars(rawBars = []) {
  return (Array.isArray(rawBars) ? rawBars : [])
    .map((bar) => {
      const time = Number(bar?.time);
      const open = Number(bar?.open ?? bar?.o);
      const high = Number(bar?.high ?? bar?.h);
      const low = Number(bar?.low ?? bar?.l);
      const close = Number(bar?.close ?? bar?.c);
      if (![time, open, high, low, close].every(Number.isFinite)) {
        return null;
      }

      const marketTime = getMarketTimePartsFromEpochMs(time);
      if (!isRegularMarketSessionParts(marketTime)) {
        return null;
      }

      return buildResearchBarFromEpochMs(time, {
        o: +open.toFixed(2),
        h: +high.toFixed(2),
        l: +low.toFixed(2),
        c: +close.toFixed(2),
        v: Math.max(0, Math.round(Number(bar?.volume ?? bar?.v) || 0)),
        vix: 17.0,
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
}

function normalizeDailyHistoryBars(rawBars = []) {
  const dailyBars = [];
  const seenDates = new Set();

  for (const bar of Array.isArray(rawBars) ? rawBars : []) {
    const time = Number(bar?.time);
    const open = Number(bar?.open ?? bar?.o);
    const high = Number(bar?.high ?? bar?.h);
    const low = Number(bar?.low ?? bar?.l);
    const close = Number(bar?.close ?? bar?.c);
    const dateText = String(bar?.date || "");
    if (![open, high, low, close].every(Number.isFinite)) {
      continue;
    }

    const marketTime = Number.isFinite(time)
      ? getMarketTimePartsFromEpochMs(time)
      : null;
    const date = String(dateText || marketTime?.date || "");
    if (!date || seenDates.has(date)) {
      continue;
    }

    seenDates.add(date);
    dailyBars.push({
      time: getEpochMsForMarketDateTime(date, 9, 30),
      ts: date,
      date,
      hour: 9,
      min: 30,
      o: +open.toFixed(2),
      h: +high.toFixed(2),
      l: +low.toFixed(2),
      c: +close.toFixed(2),
      v: Math.max(0, Math.round(Number(bar?.volume ?? bar?.v) || 0)),
      vix: Number.isFinite(Number(bar?.vix)) ? Number(bar.vix) : 17.0,
    });
  }

  return dailyBars.sort((left, right) => left.time - right.time);
}

async function resolveMassiveSpotHistory({
  symbol,
  apiKey,
  mode = "full",
  before = null,
  initialDays = INITIAL_ONE_MINUTE_WINDOW_DAYS,
  preferredTf = "1m",
}) {
  const today = getMarketDateOffset(0);
  const historyStart = resolveChartHistoryStart(MAX_CHART_HISTORY_DAYS);
  const resolvedMode = normalizeHistoryMode(mode);
  const normalizedPreferredTf = normalizePreferredIntradayTf(preferredTf);
  const dateWindow = resolveIntradayDateWindow({
    mode: resolvedMode,
    before,
    historyStart,
    historyEnd: today,
    initialWindowDays: initialDays,
  });
  if (!dateWindow.from || !dateWindow.to) {
    return {
      status: "ready",
      dataSource: "massive",
      intradayBars: [],
      dailyBars: [],
      meta: buildIntradayMeta({
        dataSource: "massive-equity-history",
        intradayBars: [],
        dailyBars: [],
        oneMinuteBars: [],
        fiveMinuteBars: [],
        fetchedAt: null,
        hasMoreIntraday: false,
        mode: resolvedMode,
      }),
      error: null,
    };
  }

  const wantsFiveMinutePrimary = normalizedPreferredTf === "5m";
  const wantsDeepFiveMinute = wantsFiveMinutePrimary;
  let oneMinutePayload = { bars: [], fetchedAt: null, source: null };
  if (dateWindow.from && dateWindow.to && !wantsFiveMinutePrimary) {
    try {
      oneMinutePayload = await loadOrFetchSeededMassiveOneMinuteBars({
        symbol,
        from: dateWindow.from,
        to: dateWindow.to,
        session: "regular",
        chunkDays: resolvedMode === "full" ? ONE_MINUTE_CHUNK_DAYS : null,
        apiKey,
      });
    } catch (error) {
      console.warn("[research-spot-history] 1m Massive history degraded for " + symbol + ":", error?.message || error);
    }
  }

  let fiveMinutePayload = { bars: [], fetchedAt: null, source: null };
  if (wantsDeepFiveMinute) {
    const fiveMinuteDateWindow = resolveMassiveFiveMinutePrimaryDateWindow({
      mode: resolvedMode,
      historyStart,
      dateWindow,
    });
    if (isDateRangeValid(fiveMinuteDateWindow.from, fiveMinuteDateWindow.to)) {
      try {
        fiveMinutePayload = await loadOrFetchSeededMassiveFiveMinuteBars({
          symbol,
          from: fiveMinuteDateWindow.from,
          to: fiveMinuteDateWindow.to,
          session: "regular",
          apiKey,
        });
      } catch (error) {
        console.warn("[research-spot-history] 5m Massive history degraded for " + symbol + ":", error?.message || error);
      }
    }
  }

  const intradayBars = mergeIntradaySpotBars({
    oneMinuteBars: oneMinutePayload?.bars || [],
    fiveMinuteBars: fiveMinutePayload?.bars || [],
  });
  const needsFullDailyHistory = resolvedMode === "initial";
  let dailyBars = deriveDailyBarsFromIntradayBars(intradayBars);
  if (needsFullDailyHistory) {
    const dailyPayload = await fetchMassiveChunkedEquityBars({
      symbol,
      multiplier: 1,
      timespan: "day",
      from: historyStart,
      to: today,
      session: "regular",
      chunkDays: null,
      apiKey,
    });
    dailyBars = normalizeDailyHistoryBars(dailyPayload?.bars || []);
  }

  if (intradayBars.length < 50) {
    throw new Error("Massive returned insufficient intraday bars for " + symbol);
  }

  const combinedSource = [oneMinutePayload?.source, fiveMinutePayload?.source].filter(Boolean);
  const usesSeededDb = combinedSource.includes("database") || combinedSource.includes("mixed");

  return {
    status: "ready",
    dataSource: "massive",
    intradayBars,
    dailyBars: needsFullDailyHistory ? dailyBars : [],
    meta: buildIntradayMeta({
      dataSource: usesSeededDb ? "massive-equity-db-seeded" : "massive-equity-history",
      intradayBars,
      dailyBars: needsFullDailyHistory ? dailyBars : [],
      oneMinuteBars: oneMinutePayload?.bars || [],
      fiveMinuteBars: fiveMinutePayload?.bars || [],
      fetchedAt: fiveMinutePayload?.fetchedAt || oneMinutePayload?.fetchedAt || null,
      hasMoreIntraday: wantsDeepFiveMinute ? false : dateWindow.hasMoreIntraday,
      mode: resolvedMode,
    }),
    error: null,
  };
}

async function resolveBrokerSpotHistory({
  account,
  adapter,
  symbol,
  mode = "full",
  before = null,
  initialDays = INITIAL_ONE_MINUTE_WINDOW_DAYS,
  preferredTf = "1m",
}) {
  if (!account || !adapter?.getBars) {
    throw new Error("Broker market bars are unavailable");
  }

  const today = getMarketDateOffset(0);
  const historyStart = resolveChartHistoryStart(MAX_CHART_HISTORY_DAYS);
  const resolvedMode = normalizeHistoryMode(mode);
  const normalizedPreferredTf = normalizePreferredIntradayTf(preferredTf);
  const cursorEpochMs = Number(before);
  const to = resolvedMode === "chunk" && Number.isFinite(cursorEpochMs) && cursorEpochMs > 0
    ? Math.max(1, Math.floor(cursorEpochMs / 1000) - 60)
    : Math.floor(Date.now() / 1000);
  const oneMinuteCountBack = resolvedMode === "initial"
    ? resolveBrokerInitialOneMinuteCountBack(initialDays)
    : resolvedMode === "chunk"
      ? BROKER_CHUNK_ONE_MINUTE_COUNT_BACK
      : BROKER_ONE_MINUTE_COUNT_BACK;
  const shouldFetchFiveMinute = resolvedMode === "full" || (resolvedMode === "initial" && normalizedPreferredTf === "5m");
  const shouldFetchDaily = resolvedMode !== "chunk";
  const [oneMinutePayload, fiveMinutePayload, dailyPayload] = await Promise.all([
    adapter.getBars(account, {
      symbol,
      resolution: "1",
      to,
      countBack: oneMinuteCountBack,
    }),
    shouldFetchFiveMinute
      ? adapter.getBars(account, {
        symbol,
        resolution: "5",
        to,
        countBack: BROKER_FIVE_MINUTE_COUNT_BACK,
      })
      : Promise.resolve(null),
    shouldFetchDaily
      ? adapter.getBars(account, {
        symbol,
        resolution: "D",
        to: Math.floor(Date.now() / 1000),
        countBack: BROKER_DAILY_COUNT_BACK,
      })
      : Promise.resolve(null),
  ]);

  const trustedOneMinuteBars = normalizeSpotHistoryBars(
    isTrustedHistoricalPayload(oneMinutePayload) ? oneMinutePayload?.bars : [],
  );
  const trustedFiveMinuteBars = normalizeSpotHistoryBars(
    isTrustedHistoricalPayload(fiveMinutePayload) ? fiveMinutePayload?.bars : [],
  );
  const intradayBars = mergeIntradaySpotBars({
    oneMinuteBars: trustedOneMinuteBars,
    fiveMinuteBars: trustedFiveMinuteBars,
  });
  const dailyBars = normalizeDailyHistoryBars(
    isTrustedHistoricalPayload(dailyPayload) ? dailyPayload?.bars : [],
  );

  if (intradayBars.length < 50) {
    throw new Error("Broker returned insufficient trusted intraday bars for " + symbol);
  }

  const hasDeepInitialFiveMinute = resolvedMode === "initial" && normalizedPreferredTf === "5m" && trustedFiveMinuteBars.length > 0;

  return {
    status: "ready",
    dataSource: "market",
    intradayBars,
    dailyBars: shouldFetchDaily
      ? (dailyBars.length ? dailyBars : deriveDailyBarsFromIntradayBars(intradayBars))
      : [],
    meta: {
      source: oneMinutePayload?.source || fiveMinutePayload?.source || "broker-market-bars",
      stale: Boolean(oneMinutePayload?.stale || fiveMinutePayload?.stale || dailyPayload?.stale),
      dataQuality: oneMinutePayload?.dataQuality || fiveMinutePayload?.dataQuality || dailyPayload?.dataQuality || null,
      mode: resolvedMode,
      hasMoreIntraday: hasDeepInitialFiveMinute
        ? false
        : compareDateText(intradayBars[0]?.date || historyStart, historyStart) > 0
          && (resolvedMode === "initial" || resolvedMode === "chunk"),
      nextBefore: hasDeepInitialFiveMinute
        ? null
        : ((resolvedMode === "initial" || resolvedMode === "chunk")
          ? intradayBars[0]?.time || null
          : null),
      coverage: {
        intradayStart: intradayBars[0]?.date || null,
        intradayEnd: intradayBars[intradayBars.length - 1]?.date || null,
        oneMinuteStart: trustedOneMinuteBars[0]?.date || null,
        fiveMinuteStart: trustedFiveMinuteBars[0]?.date || null,
        dailyStart: shouldFetchDaily ? dailyBars[0]?.date || null : null,
        dailyEnd: shouldFetchDaily ? dailyBars[dailyBars.length - 1]?.date || null : null,
      },
    },
    error: null,
  };
}

export function canUseBrokerSpotHistoryFallback({
  account = null,
  adapter = null,
} = {}) {
  return Boolean(account && typeof adapter?.getBars === "function");
}

export async function resolveResearchSpotHistory({
  symbol,
  apiKey = "",
  account = null,
  adapter = null,
  allowBrokerFallback = false,
  mode = "full",
  before = null,
  initialDays = INITIAL_ONE_MINUTE_WINDOW_DAYS,
  preferredTf = "1m",
} = {}) {
  const marketSymbol = String(symbol || "SPY").trim().toUpperCase() || "SPY";
  const failures = [];

  try {
    return await resolveMassiveSpotHistory({
      symbol: marketSymbol,
      apiKey,
      mode,
      before,
      initialDays,
      preferredTf,
    });
  } catch (error) {
    failures.push(`Massive: ${error?.message || "request failed"}`);
  }

  if (allowBrokerFallback && canUseBrokerSpotHistoryFallback({ account, adapter })) {
    try {
      return await resolveBrokerSpotHistory({
        account,
        adapter,
        symbol: marketSymbol,
        mode,
        before,
        initialDays,
        preferredTf,
      });
    } catch (error) {
      failures.push(`Broker: ${error?.message || "request failed"}`);
    }
  }

  return {
    status: "unavailable",
    dataSource: "error",
    intradayBars: [],
    dailyBars: [],
    meta: null,
    error: failures.join(" | ") || `Failed to load spot history for ${marketSymbol}.`,
  };
}

export async function seedResearchSpotHistoryFromMassive({
  symbol,
  apiKey = "",
  from = null,
  to = null,
  days = MAX_CHART_HISTORY_DAYS,
  session = "regular",
  warmDaily = true,
} = {}) {
  const marketSymbol = String(symbol || "SPY").trim().toUpperCase() || "SPY";
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new Error("Massive API key is required to seed spot history");
  }

  const finalDate = String(to || getMarketDateOffset(0)).trim();
  const firstDate = String(from || resolveChartHistoryStart(days)).trim();
  if (!isDateRangeValid(firstDate, finalDate)) {
    throw new Error(`Invalid seed date range for ${marketSymbol}`);
  }

  const seedWindows = buildSeedIntradayWindows(firstDate, finalDate);
  const seededIntradayBars = [];
  let intradayFetchedAt = null;
  for (const window of seedWindows) {
    const payload = await fetchMassiveChunkedEquityBars({
      symbol: marketSymbol,
      multiplier: 1,
      timespan: "minute",
      from: window.from,
      to: window.to,
      session,
      chunkDays: null,
      apiKey: normalizedApiKey,
    });
    seededIntradayBars.push(...(Array.isArray(payload?.bars) ? payload.bars : []));
    if (payload?.fetchedAt && (!intradayFetchedAt || String(payload.fetchedAt) > String(intradayFetchedAt))) {
      intradayFetchedAt = payload.fetchedAt;
    }
  }
  const intradayBars = dedupeSpotHistoryBars(seededIntradayBars);
  const writeResult = await writeResearchSpotBars({
    ticker: marketSymbol,
    session,
    bars: intradayBars,
    source: "massive-equity-history",
    fetchedAt: intradayFetchedAt || null,
  });

  let dailyPayload = null;
  let dailyBars = [];
  if (warmDaily) {
    dailyPayload = await fetchMassiveChunkedEquityBars({
      symbol: marketSymbol,
      multiplier: 1,
      timespan: "day",
      from: firstDate,
      to: finalDate,
      session,
      chunkDays: null,
      apiKey: normalizedApiKey,
    });
    dailyBars = normalizeDailyHistoryBars(dailyPayload?.bars || []);
  }

  const coverage = await readResearchSpotBarsCoverage({
    ticker: marketSymbol,
    session,
    timeframe: "1m",
  });

  return {
    symbol: marketSymbol,
    session,
    from: firstDate,
    to: finalDate,
    intradayBarsSeeded: intradayBars.length,
    dailyBarsWarmed: dailyBars.length,
    intradayFetchedAt: intradayFetchedAt || null,
    dailyFetchedAt: dailyPayload?.fetchedAt || null,
    coverage,
    writeResult,
  };
}

export async function warmResearchSpotHistoryStep({
  symbol,
  apiKey = "",
  from = null,
  to = null,
  days = MAX_CHART_HISTORY_DAYS,
  session = "regular",
  warmDaily = true,
} = {}) {
  const marketSymbol = String(symbol || "SPY").trim().toUpperCase() || "SPY";
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new Error("Massive API key is required to warm spot history");
  }

  const targetEnd = String(to || getMarketDateOffset(0)).trim();
  const targetStart = String(from || resolveChartHistoryStart(days)).trim();
  if (!isDateRangeValid(targetStart, targetEnd)) {
    throw new Error(`Invalid warm date range for ${marketSymbol}`);
  }

  const existingState = await readResearchSpotWarmState({
    ticker: marketSymbol,
    session,
    timeframe: "1m",
  });
  const coverage = await readResearchSpotBarsCoverage({
    ticker: marketSymbol,
    session,
    timeframe: "1m",
  });
  const effectiveState = resolveBootstrappedWarmState({
    existingState,
  });
  const matchesTarget = effectiveState
    && effectiveState.targetStart === targetStart
    && effectiveState.targetEnd === targetEnd;
  const nextWindow = resolveNextWarmCoverageWindow({
    targetStart,
    targetEnd,
    contiguousCoverageStart: matchesTarget ? effectiveState?.targetStart || null : null,
    contiguousCoverageEnd: matchesTarget ? effectiveState?.targetEnd || null : null,
    nextCursorDate: matchesTarget ? effectiveState?.nextCursorDate || null : null,
  });
  const startedAt = new Date().toISOString();

  if (!nextWindow) {
    const persistedTargetStart = effectiveState?.targetStart || targetStart;
    const persistedTargetEnd = effectiveState?.targetEnd || targetEnd;
    let dailyPayload = null;
    if (warmDaily && !effectiveState?.dailyWarmedAt) {
      dailyPayload = await fetchMassiveChunkedEquityBars({
        symbol: marketSymbol,
        multiplier: 1,
        timespan: "day",
        from: targetStart,
        to: targetEnd,
        session,
        chunkDays: null,
        apiKey: normalizedApiKey,
      });
    }
    await upsertResearchSpotWarmState({
      ticker: marketSymbol,
      session,
      timeframe: "1m",
      targetStart: persistedTargetStart,
      targetEnd: persistedTargetEnd,
      nextCursorDate: persistedTargetStart,
      lastWindowFrom: effectiveState?.lastWindowFrom || persistedTargetStart,
      lastWindowTo: effectiveState?.lastWindowTo || persistedTargetEnd,
      lastStatus: "complete",
      lastError: null,
      lastRunAt: startedAt,
      completedAt: effectiveState?.completedAt || startedAt,
      dailyWarmedAt: dailyPayload?.fetchedAt || effectiveState?.dailyWarmedAt || null,
    });
    return {
      ok: true,
      symbol: marketSymbol,
      targetStart: persistedTargetStart,
      targetEnd: persistedTargetEnd,
      completed: true,
      warmedWindow: null,
      dailyWarmed: Boolean(dailyPayload),
    };
  }

  try {
    const payload = await fetchMassiveChunkedEquityBars({
      symbol: marketSymbol,
      multiplier: 1,
      timespan: "minute",
      from: nextWindow.from,
      to: nextWindow.to,
      session,
      chunkDays: null,
      apiKey: normalizedApiKey,
    });
    const bars = Array.isArray(payload?.bars) ? payload.bars : [];
    const writeResult = await writeResearchSpotBars({
      ticker: marketSymbol,
      session,
      bars,
      source: "massive-equity-history",
      fetchedAt: payload?.fetchedAt || null,
    });
    const nextCoverage = await readResearchSpotBarsCoverage({
      ticker: marketSymbol,
      session,
      timeframe: "1m",
    });
    const mergedContiguousCoverage = mergeContiguousCoverageWindow({
      currentStart: matchesTarget ? effectiveState?.targetStart || null : null,
      currentEnd: matchesTarget ? effectiveState?.targetEnd || null : null,
      windowFrom: nextWindow.from,
      windowTo: nextWindow.to,
    });
    const persistedTargetStart = mergedContiguousCoverage.coverageStart || nextWindow.from;
    const persistedTargetEnd = mergedContiguousCoverage.coverageEnd || nextWindow.to;
    const coveredTargetStart = compareDateText(persistedTargetStart, targetStart) <= 0;
    const coveredTargetEnd = compareDateText(persistedTargetEnd, targetEnd) >= 0;
    const nextCursorDate = coveredTargetStart && coveredTargetEnd
      ? persistedTargetStart
      : (compareDateText(nextWindow.from, persistedTargetStart) <= 0 ? persistedTargetStart : nextWindow.from);
    const completed = coveredTargetStart && coveredTargetEnd;
    let dailyPayload = null;
    if (completed && warmDaily && !effectiveState?.dailyWarmedAt) {
      dailyPayload = await fetchMassiveChunkedEquityBars({
        symbol: marketSymbol,
        multiplier: 1,
        timespan: "day",
        from: targetStart,
        to: targetEnd,
        session,
        chunkDays: null,
        apiKey: normalizedApiKey,
      });
    }
    await upsertResearchSpotWarmState({
      ticker: marketSymbol,
      session,
      timeframe: "1m",
      targetStart: persistedTargetStart,
      targetEnd: persistedTargetEnd,
      nextCursorDate,
      lastWindowFrom: nextWindow.from,
      lastWindowTo: nextWindow.to,
      lastStatus: completed ? "complete" : "ready",
      lastError: null,
      lastRunAt: startedAt,
      completedAt: completed ? (effectiveState?.completedAt || startedAt) : effectiveState?.completedAt || null,
      dailyWarmedAt: dailyPayload?.fetchedAt || effectiveState?.dailyWarmedAt || null,
    });
    return {
      ok: true,
      symbol: marketSymbol,
      targetStart: persistedTargetStart,
      targetEnd: persistedTargetEnd,
      completed,
      warmedWindow: nextWindow,
      barsSeeded: bars.length,
      writeResult,
      coverage,
      nextCoverage,
      dailyWarmed: Boolean(dailyPayload),
    };
  } catch (error) {
    await upsertResearchSpotWarmState({
      ticker: marketSymbol,
      session,
      timeframe: "1m",
      targetStart: effectiveState?.targetStart || targetStart,
      targetEnd: effectiveState?.targetEnd || targetEnd,
      nextCursorDate: effectiveState?.nextCursorDate || null,
      lastWindowFrom: nextWindow.from,
      lastWindowTo: nextWindow.to,
      lastStatus: "error",
      lastError: error?.message || "Warm step failed",
      lastRunAt: startedAt,
      completedAt: matchesTarget ? effectiveState?.completedAt || null : null,
      dailyWarmedAt: effectiveState?.dailyWarmedAt || null,
    });
    throw error;
  }
}
