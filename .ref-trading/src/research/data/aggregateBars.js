import {
  buildResearchBarFromEpochMs,
  getBarTimeMs,
  getEpochMsForMarketDateTime,
  getMarketTimePartsFromEpochMs,
  isRegularMarketSessionParts,
  MARKET_SESSION_OPEN_MINUTES,
} from "../market/time.js";

function bucketStartEpochMs(epochMs, bucketMinutes) {
  const parts = getMarketTimePartsFromEpochMs(epochMs);
  if (!isRegularMarketSessionParts(parts)) {
    return null;
  }

  const marketMinutes = parts.hour * 60 + parts.min;
  const bucketOffset = Math.max(
    0,
    Math.floor((marketMinutes - MARKET_SESSION_OPEN_MINUTES) / bucketMinutes),
  );
  const bucketStartMinutes = MARKET_SESSION_OPEN_MINUTES + bucketOffset * bucketMinutes;
  const hour = Math.floor(bucketStartMinutes / 60);
  const minute = bucketStartMinutes % 60;
  return getEpochMsForMarketDateTime(parts.date, hour, minute);
}

export function aggregateBarsToMinutes(rawBars = [], bucketMinutes = 5) {
  const output = [];
  let current = null;

  for (const rawBar of Array.isArray(rawBars) ? rawBars : []) {
    const epochMs = getBarTimeMs(rawBar);
    if (!Number.isFinite(epochMs)) {
      continue;
    }

    const bucketStartMs = bucketStartEpochMs(epochMs, bucketMinutes);
    if (!Number.isFinite(bucketStartMs)) {
      continue;
    }

    if (!current || current.time !== bucketStartMs) {
      if (current) {
        output.push(current);
      }
      current = buildResearchBarFromEpochMs(bucketStartMs, {
        o: Number(rawBar.o),
        h: Number(rawBar.h),
        l: Number(rawBar.l),
        c: Number(rawBar.c),
        v: Math.max(0, Math.round(Number(rawBar.v) || 0)),
        vix: Number.isFinite(Number(rawBar.vix)) ? Number(rawBar.vix) : 17.0,
      });
      continue;
    }

    current.h = Math.max(current.h, Number(rawBar.h));
    current.l = Math.min(current.l, Number(rawBar.l));
    current.c = Number(rawBar.c);
    current.v += Math.max(0, Math.round(Number(rawBar.v) || 0));
    current.vix = Number.isFinite(Number(rawBar.vix)) ? Number(rawBar.vix) : current.vix;
  }

  if (current) {
    output.push(current);
  }

  return output;
}
