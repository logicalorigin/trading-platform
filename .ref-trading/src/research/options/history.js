import {
  formatMarketTimestamp,
  getBarMarketTimeParts,
  getBarTimeMs,
} from "../market/time.js";

export function normalizeOptionHistoryBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar) => {
      const time = getBarTimeMs(bar);
      if (!Number.isFinite(time)) {
        return null;
      }
      const marketTime = getBarMarketTimeParts({ ...bar, time });
      if (!marketTime) {
        return null;
      }
      const open = Number(bar?.o);
      const high = Number(bar?.h);
      const low = Number(bar?.l);
      const close = Number(bar?.c);
      if (![open, high, low, close].every(Number.isFinite)) {
        return null;
      }
      return {
        ...bar,
        time,
        ts: String(bar?.ts || formatMarketTimestamp(time)),
        date: String(bar?.date || marketTime.date),
        hour: Number.isFinite(Number(bar?.hour)) ? Number(bar.hour) : marketTime.hour,
        min: Number.isFinite(Number(bar?.min)) ? Number(bar.min) : marketTime.min,
        o: open,
        h: high,
        l: low,
        c: close,
        v: Math.max(0, Math.round(Number(bar?.v) || 0)),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
}

export function findOptionHistoryBar(optionBars, targetBar, maxLagMs = 15 * 60 * 1000) {
  if (!Array.isArray(optionBars) || !optionBars.length || !targetBar) {
    return null;
  }

  const targetTime = getBarTimeMs(targetBar);
  if (!Number.isFinite(targetTime)) {
    return null;
  }

  let low = 0;
  let high = optionBars.length - 1;
  let match = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = optionBars[mid];
    if (candidate.time <= targetTime) {
      match = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (!match) {
    return null;
  }

  if (String(match.date || "") !== String(targetBar.date || "")) {
    return null;
  }

  if (targetTime - match.time > maxLagMs) {
    return null;
  }

  return match;
}
