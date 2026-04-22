const MARKET_TIME_ZONE = "America/New_York";
const MARKET_SESSION_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_SESSION_CLOSE_MINUTES = 16 * 60;

const MARKET_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_TO_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function readPart(parts, type) {
  return parts.find((part) => part.type === type)?.value || "";
}

function parseDateText(dateText) {
  const match = String(dateText || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function getDateTextUtcNoonMs(dateText) {
  const parsed = parseDateText(dateText);
  if (!parsed) {
    return null;
  }
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0, 0);
}

export function getDateTextDayOfWeek(dateText) {
  const utcNoonMs = getDateTextUtcNoonMs(dateText);
  if (!Number.isFinite(utcNoonMs)) {
    return null;
  }
  return new Date(utcNoonMs).getUTCDay();
}

export function parseMarketTimestamp(timestampText) {
  // Research/runtime timestamps are emitted as market-local wall-clock strings.
  const match = String(timestampText || "").trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  return getEpochMsForMarketDateTime(match[1], Number(match[2]), Number(match[3]));
}

export function getBarTimeMs(bar) {
  const direct = Number(bar?.time);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.round(direct);
  }

  const parsedTs = parseMarketTimestamp(bar?.ts);
  if (Number.isFinite(parsedTs)) {
    return parsedTs;
  }

  const date = String(bar?.date || "").trim();
  const hour = Number(bar?.hour);
  const minute = Number(bar?.min);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(hour) && Number.isFinite(minute)) {
    const parsed = getEpochMsForMarketDateTime(date, hour, minute);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function getMarketTimePartsFromEpochMs(epochMs) {
  const parts = MARKET_DATE_TIME_FORMATTER.formatToParts(new Date(epochMs));
  const year = Number(readPart(parts, "year"));
  const month = Number(readPart(parts, "month"));
  const day = Number(readPart(parts, "day"));
  const hour = Number(readPart(parts, "hour"));
  const min = Number(readPart(parts, "minute"));
  const weekday = readPart(parts, "weekday");
  return {
    year,
    month,
    day,
    date: `${year}-${pad(month)}-${pad(day)}`,
    hour,
    min,
    weekday,
    dayOfWeek: WEEKDAY_TO_INDEX[weekday] ?? null,
    minutes: hour * 60 + min,
  };
}

export function getEpochMsForMarketDateTime(dateText, hour, minute = 0) {
  const parsed = parseDateText(dateText);
  if (!parsed) {
    return null;
  }
  const { year, month, day } = parsed;
  let guess = Date.UTC(year, month - 1, day, Number(hour) || 0, Number(minute) || 0, 0, 0);

  for (let index = 0; index < 3; index += 1) {
    const current = getMarketTimePartsFromEpochMs(guess);
    const desiredUtc = Date.UTC(year, month - 1, day, Number(hour) || 0, Number(minute) || 0, 0, 0);
    const currentUtc = Date.UTC(
      Number(current.year),
      Number(current.month) - 1,
      Number(current.day),
      Number(current.hour) || 0,
      Number(current.min) || 0,
      0,
      0,
    );
    const deltaMs = desiredUtc - currentUtc;
    if (!deltaMs) {
      break;
    }
    guess += deltaMs;
  }

  return guess;
}

export function getBarMarketTimeParts(bar) {
  const time = getBarTimeMs(bar);
  if (Number.isFinite(time)) {
    return {
      ...getMarketTimePartsFromEpochMs(time),
      time,
    };
  }

  const date = String(bar?.date || "").trim();
  const hour = Number(bar?.hour);
  const min = Number(bar?.min);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(hour) && Number.isFinite(min)) {
    return {
      date,
      hour,
      min,
      minutes: hour * 60 + min,
      dayOfWeek: getDateTextDayOfWeek(date),
      time: null,
    };
  }

  return null;
}

export function offsetDateText(dateText, days) {
  const utcNoonMs = getDateTextUtcNoonMs(dateText);
  if (!Number.isFinite(utcNoonMs)) {
    return null;
  }
  const date = new Date(utcNoonMs);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getMarketDateOffset(days, baseEpochMs = Date.now()) {
  const baseDate = getMarketTimePartsFromEpochMs(baseEpochMs).date;
  return offsetDateText(baseDate, days);
}

export function formatMarketDateLabel(dateText, {
  locale = "en-US",
  includeYear = false,
} = {}) {
  const utcNoonMs = getDateTextUtcNoonMs(dateText);
  if (!Number.isFinite(utcNoonMs)) {
    return String(dateText || "").trim() || "--";
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: MARKET_TIME_ZONE,
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(new Date(utcNoonMs));
}

export function formatMarketTimestamp(epochMs) {
  const parts = getMarketTimePartsFromEpochMs(epochMs);
  return `${parts.date} ${pad(parts.hour)}:${pad(parts.min)}`;
}

export function isRegularMarketSessionParts(parts, { includeClose = true } = {}) {
  if (!parts) {
    return false;
  }
  if (parts.dayOfWeek === 0 || parts.dayOfWeek === 6) {
    return false;
  }
  if (parts.minutes < MARKET_SESSION_OPEN_MINUTES) {
    return false;
  }
  return includeClose
    ? parts.minutes <= MARKET_SESSION_CLOSE_MINUTES
    : parts.minutes < MARKET_SESSION_CLOSE_MINUTES;
}

export function isRegularMarketSessionBar(bar, options = {}) {
  return isRegularMarketSessionParts(getBarMarketTimeParts(bar), options);
}

export function buildResearchBarFromEpochMs(epochMs, values = {}) {
  const parts = getMarketTimePartsFromEpochMs(epochMs);
  return {
    ...values,
    time: Math.round(epochMs),
    ts: String(values.ts || formatMarketTimestamp(epochMs)),
    date: String(values.date || parts.date),
    hour: Number.isFinite(Number(values.hour)) ? Number(values.hour) : parts.hour,
    min: Number.isFinite(Number(values.min)) ? Number(values.min) : parts.min,
  };
}

export {
  MARKET_TIME_ZONE,
  MARKET_SESSION_OPEN_MINUTES,
  MARKET_SESSION_CLOSE_MINUTES,
};
