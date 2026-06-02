export type UsEquityMarketSessionKey =
  | "overnight"
  | "pre"
  | "rth"
  | "after"
  | "closed";

export type UsEquityMarketSession = {
  key: UsEquityMarketSessionKey;
  label: "OVN" | "PRE" | "RTH" | "AFT" | "CLSD";
  title: string;
  open: boolean;
};

export type NyseCalendarDay = {
  date: string;
  timeZone: "America/New_York";
  tradingDay: boolean;
  holiday: string | null;
  earlyClose: boolean;
  regularOpenAt: string | null;
  regularCloseAt: string | null;
  extendedOpenAt: string | null;
  extendedCloseAt: string | null;
};

export type NyseHoliday = {
  date: string;
  name: string;
};

export type NyseEarlyClose = {
  date: string;
  regularCloseAt: string;
  extendedCloseAt: string;
  reason: string;
};

export type UsEquityMarketStatus = {
  session: UsEquityMarketSession;
  calendarDay: NyseCalendarDay | null;
  nextOpenAt: string | null;
  nextCloseAt: string | null;
};

type NewYorkClockParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  minutes: number;
};

// NYSE holiday/early-close dates and session times are mirrored from
// https://www.nyse.com/trade/hours-calendars; the pre/open/close/post model
// matches pandas_market_calendars' NYSE calendar terminology:
// https://pandas-market-calendars.readthedocs.io/en/latest/usage.html#market-times
const NEW_YORK_TIME_ZONE = "America/New_York";
const REGULAR_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const EARLY_REGULAR_CLOSE_MINUTES = 13 * 60;
const EXTENDED_OPEN_MINUTES = 4 * 60;
const EXTENDED_CLOSE_MINUTES = 20 * 60;
const EARLY_EXTENDED_CLOSE_MINUTES = 17 * 60;
const OVERNIGHT_OPEN_MINUTES = 20 * 60;
const OVERNIGHT_CLOSE_MINUTES = 3 * 60 + 50;

const NEW_YORK_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK_TIME_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const MARKET_SESSIONS: Record<UsEquityMarketSessionKey, UsEquityMarketSession> = {
  overnight: {
    key: "overnight",
    label: "OVN",
    title: "Overnight",
    open: true,
  },
  pre: {
    key: "pre",
    label: "PRE",
    title: "Premarket",
    open: true,
  },
  rth: {
    key: "rth",
    label: "RTH",
    title: "Regular trading hours",
    open: true,
  },
  after: {
    key: "after",
    label: "AFT",
    title: "After-hours",
    open: true,
  },
  closed: {
    key: "closed",
    label: "CLSD",
    title: "Closed",
    open: false,
  },
};

const dateKey = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const toDateKeyParts = (date: Date) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

const addDaysToDateKeyParts = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
  days: number,
): Pick<NewYorkClockParts, "year" | "month" | "day"> => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKeyParts(date);
};

const getUtcWeekday = (year: number, month: number, day: number): number =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay();

const nthWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number,
  occurrence: number,
): number => {
  const firstWeekday = getUtcWeekday(year, month, 1);
  const offset = (weekday - firstWeekday + 7) % 7;
  return 1 + offset + (occurrence - 1) * 7;
};

const lastWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number,
): number => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekday = getUtcWeekday(year, month, lastDay);
  return lastDay - ((lastWeekday - weekday + 7) % 7);
};

const observedFixedHolidayDateKey = (
  year: number,
  month: number,
  day: number,
  options: { skipSaturdayObservation?: boolean } = {},
): string | null => {
  const weekday = getUtcWeekday(year, month, day);
  if (weekday === 6 && options.skipSaturdayObservation) {
    return null;
  }

  const holiday = new Date(Date.UTC(year, month - 1, day));
  if (weekday === 6) {
    holiday.setUTCDate(holiday.getUTCDate() - 1);
  } else if (weekday === 0) {
    holiday.setUTCDate(holiday.getUTCDate() + 1);
  }
  return dateKey(
    holiday.getUTCFullYear(),
    holiday.getUTCMonth() + 1,
    holiday.getUTCDate(),
  );
};

const resolveEasterSunday = (year: number): { month: number; day: number } => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
};

const goodFridayKey = (year: number): string => {
  const easter = resolveEasterSunday(year);
  const date = new Date(Date.UTC(year, easter.month - 1, easter.day));
  date.setUTCDate(date.getUTCDate() - 2);
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

const buildNyseHolidayRecords = (year: number): NyseHoliday[] => {
  const holidays = new Map<string, string>();
  const add = (date: string | null, name: string) => {
    if (date !== null) {
      holidays.set(date, name);
    }
  };

  const addYear = (holidayYear: number) => {
    add(
      observedFixedHolidayDateKey(holidayYear, 1, 1, {
        skipSaturdayObservation: true,
      }),
      "New Year's Day",
    );
    add(
      dateKey(holidayYear, 1, nthWeekdayOfMonth(holidayYear, 1, 1, 3)),
      "Martin Luther King, Jr. Day",
    );
    add(
      dateKey(holidayYear, 2, nthWeekdayOfMonth(holidayYear, 2, 1, 3)),
      "Washington's Birthday",
    );
    add(goodFridayKey(holidayYear), "Good Friday");
    add(
      dateKey(holidayYear, 5, lastWeekdayOfMonth(holidayYear, 5, 1)),
      "Memorial Day",
    );
    add(
      observedFixedHolidayDateKey(holidayYear, 6, 19),
      "Juneteenth National Independence Day",
    );
    add(
      observedFixedHolidayDateKey(holidayYear, 7, 4),
      "Independence Day",
    );
    add(
      dateKey(holidayYear, 9, nthWeekdayOfMonth(holidayYear, 9, 1, 1)),
      "Labor Day",
    );
    add(
      dateKey(holidayYear, 11, nthWeekdayOfMonth(holidayYear, 11, 4, 4)),
      "Thanksgiving Day",
    );
    add(observedFixedHolidayDateKey(holidayYear, 12, 25), "Christmas Day");
  };

  addYear(year - 1);
  addYear(year);
  addYear(year + 1);
  return [...holidays.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((left, right) => left.date.localeCompare(right.date));
};

const resolveNewYorkClockParts = (value: Date): NewYorkClockParts | null => {
  const parts = NEW_YORK_CLOCK_FORMATTER.formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  const weekday = read("weekday");

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    weekday,
    minutes: hour * 60 + minute,
  };
};

const getNewYorkOffsetMs = (value: Date): number => {
  const parts = resolveNewYorkClockParts(value);
  if (!parts) {
    return 0;
  }

  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      Math.floor(parts.minutes / 60),
      parts.minutes % 60,
    ) - value.getTime()
  );
};

const newYorkDateTimeToIso = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
  minutes: number,
): string => {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(minutes / 60),
    minutes % 60,
  );
  const firstPass = localAsUtc - getNewYorkOffsetMs(new Date(localAsUtc));
  const secondPass = localAsUtc - getNewYorkOffsetMs(new Date(firstPass));
  return new Date(secondPass).toISOString();
};

const resolveNyseHolidayName = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
): string | null => {
  const key = dateKey(parts.year, parts.month, parts.day);
  return (
    buildNyseHolidayRecords(parts.year).find((holiday) => holiday.date === key)
      ?.name ?? null
  );
};

const isWeekday = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
): boolean => {
  const weekday = getUtcWeekday(parts.year, parts.month, parts.day);
  return weekday !== 0 && weekday !== 6;
};

const buildNyseEarlyCloseRecords = (year: number): NyseEarlyClose[] => {
  const records: NyseEarlyClose[] = [];
  const addIfTradingDay = (
    parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
    reason: string,
  ) => {
    if (!isWeekday(parts) || resolveNyseHolidayName(parts) !== null) {
      return;
    }

    records.push({
      date: dateKey(parts.year, parts.month, parts.day),
      regularCloseAt: newYorkDateTimeToIso(parts, EARLY_REGULAR_CLOSE_MINUTES),
      extendedCloseAt: newYorkDateTimeToIso(parts, EARLY_EXTENDED_CLOSE_MINUTES),
      reason,
    });
  };

  addIfTradingDay({ year, month: 7, day: 3 }, "Day before Independence Day");
  addIfTradingDay(
    { year, month: 11, day: nthWeekdayOfMonth(year, 11, 4, 4) + 1 },
    "Day after Thanksgiving",
  );
  addIfTradingDay({ year, month: 12, day: 24 }, "Christmas Eve");

  return records.sort((left, right) => left.date.localeCompare(right.date));
};

const resolveNyseEarlyClose = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
): NyseEarlyClose | null => {
  const key = dateKey(parts.year, parts.month, parts.day);
  return (
    buildNyseEarlyCloseRecords(parts.year).find((close) => close.date === key) ??
    null
  );
};

export const listNyseHolidays = (year: number): NyseHoliday[] => {
  if (!Number.isInteger(year)) {
    return [];
  }

  return buildNyseHolidayRecords(year).filter((holiday) =>
    holiday.date.startsWith(`${year}-`),
  );
};

export const listNyseEarlyCloses = (year: number): NyseEarlyClose[] =>
  Number.isInteger(year) ? buildNyseEarlyCloseRecords(year) : [];

const resolveNyseCalendarDayFromParts = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
): NyseCalendarDay => {
  const holiday = resolveNyseHolidayName(parts);
  const tradingDay = isWeekday(parts) && holiday === null;
  const earlyClose = tradingDay ? resolveNyseEarlyClose(parts) : null;
  const regularCloseMinutes = earlyClose
    ? EARLY_REGULAR_CLOSE_MINUTES
    : REGULAR_CLOSE_MINUTES;
  const extendedCloseMinutes = earlyClose
    ? EARLY_EXTENDED_CLOSE_MINUTES
    : EXTENDED_CLOSE_MINUTES;

  return {
    date: dateKey(parts.year, parts.month, parts.day),
    timeZone: NEW_YORK_TIME_ZONE,
    tradingDay,
    holiday,
    earlyClose: earlyClose !== null,
    regularOpenAt: tradingDay
      ? newYorkDateTimeToIso(parts, REGULAR_OPEN_MINUTES)
      : null,
    regularCloseAt: tradingDay
      ? newYorkDateTimeToIso(parts, regularCloseMinutes)
      : null,
    extendedOpenAt: tradingDay
      ? newYorkDateTimeToIso(parts, EXTENDED_OPEN_MINUTES)
      : null,
    extendedCloseAt: tradingDay
      ? newYorkDateTimeToIso(parts, extendedCloseMinutes)
      : null,
  };
};

export const resolveNyseCalendarDay = (
  value: Date | number | string,
): NyseCalendarDay | null => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = resolveNewYorkClockParts(date);
  return parts ? resolveNyseCalendarDayFromParts(parts) : null;
};

export const isNyseFullHoliday = (value: Date | number | string): boolean => {
  return resolveNyseCalendarDay(value)?.holiday != null;
};

const isNyseTradingDate = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
): boolean => {
  return resolveNyseCalendarDayFromParts(parts).tradingDay;
};

const isUsEquityOvernightSession = (parts: NewYorkClockParts): boolean => {
  if (parts.minutes < OVERNIGHT_CLOSE_MINUTES) {
    return isNyseTradingDate(parts);
  }
  if (parts.minutes >= OVERNIGHT_OPEN_MINUTES) {
    return isNyseTradingDate(addDaysToDateKeyParts(parts, 1));
  }
  return false;
};

type SessionInterval = {
  key: Exclude<UsEquityMarketSessionKey, "closed">;
  startAt: string;
  endAt: string;
};

const buildSessionIntervalsForTradingDay = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
): SessionInterval[] => {
  const day = resolveNyseCalendarDayFromParts(parts);
  if (!day.tradingDay || !day.regularOpenAt || !day.regularCloseAt) {
    return [];
  }

  const overnightParts = addDaysToDateKeyParts(parts, -1);
  return [
    {
      key: "overnight",
      startAt: newYorkDateTimeToIso(overnightParts, OVERNIGHT_OPEN_MINUTES),
      endAt: newYorkDateTimeToIso(parts, OVERNIGHT_CLOSE_MINUTES),
    },
    {
      key: "pre",
      startAt: day.extendedOpenAt as string,
      endAt: day.regularOpenAt,
    },
    {
      key: "rth",
      startAt: day.regularOpenAt,
      endAt: day.regularCloseAt,
    },
    {
      key: "after",
      startAt: day.regularCloseAt,
      endAt: day.extendedCloseAt as string,
    },
  ];
};

const buildSessionIntervalsNear = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
): SessionInterval[] => {
  const intervals: SessionInterval[] = [];
  for (let offset = -1; offset <= 10; offset += 1) {
    intervals.push(
      ...buildSessionIntervalsForTradingDay(addDaysToDateKeyParts(parts, offset)),
    );
  }

  return intervals.sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt),
  );
};

const resolveUsEquityMarketSessionForParts = (
  parts: NewYorkClockParts,
): UsEquityMarketSession => {
  const calendarDay = resolveNyseCalendarDayFromParts(parts);

  if (isUsEquityOvernightSession(parts)) {
    return MARKET_SESSIONS.overnight;
  }

  if (!calendarDay.tradingDay) {
    return MARKET_SESSIONS.closed;
  }

  const regularCloseMinutes = calendarDay.earlyClose
    ? EARLY_REGULAR_CLOSE_MINUTES
    : REGULAR_CLOSE_MINUTES;
  const extendedCloseMinutes = calendarDay.earlyClose
    ? EARLY_EXTENDED_CLOSE_MINUTES
    : EXTENDED_CLOSE_MINUTES;

  if (
    parts.minutes >= EXTENDED_OPEN_MINUTES &&
    parts.minutes < REGULAR_OPEN_MINUTES
  ) {
    return MARKET_SESSIONS.pre;
  }
  if (
    parts.minutes >= REGULAR_OPEN_MINUTES &&
    parts.minutes < regularCloseMinutes
  ) {
    return MARKET_SESSIONS.rth;
  }
  if (
    parts.minutes >= regularCloseMinutes &&
    parts.minutes < extendedCloseMinutes
  ) {
    return MARKET_SESSIONS.after;
  }

  return MARKET_SESSIONS.closed;
};

export const resolveUsEquityMarketStatus = (
  value: Date | number | string = new Date(),
): UsEquityMarketStatus => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      session: MARKET_SESSIONS.closed,
      calendarDay: null,
      nextOpenAt: null,
      nextCloseAt: null,
    };
  }

  const parts = resolveNewYorkClockParts(date);
  if (!parts) {
    return {
      session: MARKET_SESSIONS.closed,
      calendarDay: null,
      nextOpenAt: null,
      nextCloseAt: null,
    };
  }

  const nowMs = date.getTime();
  const session = resolveUsEquityMarketSessionForParts(parts);
  const intervals = buildSessionIntervalsNear(parts);
  const activeInterval = intervals.find(
    (interval) =>
      Date.parse(interval.startAt) <= nowMs && nowMs < Date.parse(interval.endAt),
  );

  return {
    session,
    calendarDay: resolveNyseCalendarDayFromParts(parts),
    nextOpenAt:
      activeInterval || session.open
        ? null
        : (intervals.find((interval) => Date.parse(interval.startAt) > nowMs)
            ?.startAt ?? null),
    nextCloseAt: activeInterval?.endAt ?? null,
  };
};

export const resolveUsEquityMarketSession = (
  value: Date | number | string = new Date(),
): UsEquityMarketSession => resolveUsEquityMarketStatus(value).session;
