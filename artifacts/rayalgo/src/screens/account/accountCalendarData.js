const CALENDAR_LOOKBACK_DAYS = 400;
const DAY_MS = 86_400_000;

export const accountDateFilterBoundaryIso = (
  value,
  { endOfDay = false } = {},
) => {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!match) return undefined;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return undefined;
  }
  return date.toISOString();
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
