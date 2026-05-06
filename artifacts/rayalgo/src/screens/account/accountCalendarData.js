const CALENDAR_LOOKBACK_DAYS = 400;
const DAY_MS = 86_400_000;

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

