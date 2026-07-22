const CALENDAR_LOOKBACK_DAYS = 400;
const DAY_MS = 86_400_000;
const ACCOUNT_MARKET_TIME_ZONE = "America/New_York";
const ACCOUNT_MARKET_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: ACCOUNT_MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const parseMarketDateKey = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? { year, month, day }
    : null;
};

const marketDateKey = ({ year, month, day }) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const accountMarketClockParts = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = ACCOUNT_MARKET_CLOCK_FORMATTER.formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);
  const result = {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
};

const accountMarketOffsetMs = (value) => {
  const parts = accountMarketClockParts(value);
  if (!parts) return null;
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) -
    (value.getTime() - value.getUTCMilliseconds())
  );
};

const accountMarketWallTimeMs = (parts, hour = 0) => {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour);
  const firstOffset = accountMarketOffsetMs(new Date(localAsUtc));
  if (firstOffset == null) return null;
  const firstPass = localAsUtc - firstOffset;
  const secondOffset = accountMarketOffsetMs(new Date(firstPass));
  return secondOffset == null ? null : localAsUtc - secondOffset;
};

const addMarketDateKeyDays = (parts, days) => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

export const accountMarketDateKey = (value) => {
  const explicit = typeof value === "string" ? parseMarketDateKey(value) : null;
  const parts = explicit || accountMarketClockParts(value);
  return parts ? marketDateKey(parts) : null;
};

export const accountDateFilterBoundaryIso = (
  value,
  { endOfDay = false } = {},
) => {
  if (!value) return undefined;
  const parts = parseMarketDateKey(value);
  if (!parts) return undefined;
  const boundaryMs = accountMarketWallTimeMs(
    endOfDay ? addMarketDateKeyDays(parts, 1) : parts,
  );
  return boundaryMs == null
    ? undefined
    : new Date(boundaryMs - (endOfDay ? 1 : 0)).toISOString();
};

export const accountMarketDateNoonMs = (value) => {
  const parts = parseMarketDateKey(value);
  return parts ? accountMarketWallTimeMs(parts, 12) : null;
};

export const buildPerformanceCalendarParams = (modeParams = {}, nowMs = Date.now()) => ({
  ...modeParams,
  from: new Date(nowMs - CALENDAR_LOOKBACK_DAYS * DAY_MS).toISOString(),
});

export const performanceCalendarQueriesEnabled = (accountQueriesEnabled) =>
  Boolean(accountQueriesEnabled);

export const resolveReturnsCalendarData = ({
  performanceCalendarTradesData = null,
  performanceCalendarEquityData = null,
} = {}) => ({
  tradesData: performanceCalendarTradesData,
  equityPoints: performanceCalendarEquityData?.points,
});
