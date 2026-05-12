import type { ChartBar, IndicatorWindow } from "./types";

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

type NewYorkClockParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  minutes: number;
};

const NEW_YORK_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
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

const observedFixedHolidayKey = (
  year: number,
  month: number,
  day: number,
): string => {
  const weekday = getUtcWeekday(year, month, day);
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

const buildNyseFullHolidayKeys = (year: number): Set<string> => {
  const keys = new Set<string>();
  const addYear = (holidayYear: number) => {
    keys.add(observedFixedHolidayKey(holidayYear, 1, 1));
    keys.add(dateKey(holidayYear, 1, nthWeekdayOfMonth(holidayYear, 1, 1, 3)));
    keys.add(dateKey(holidayYear, 2, nthWeekdayOfMonth(holidayYear, 2, 1, 3)));
    keys.add(goodFridayKey(holidayYear));
    keys.add(dateKey(holidayYear, 5, lastWeekdayOfMonth(holidayYear, 5, 1)));
    keys.add(observedFixedHolidayKey(holidayYear, 6, 19));
    keys.add(observedFixedHolidayKey(holidayYear, 7, 4));
    keys.add(dateKey(holidayYear, 9, nthWeekdayOfMonth(holidayYear, 9, 1, 1)));
    keys.add(dateKey(holidayYear, 11, nthWeekdayOfMonth(holidayYear, 11, 4, 4)));
    keys.add(observedFixedHolidayKey(holidayYear, 12, 25));
  };

  addYear(year - 1);
  addYear(year);
  addYear(year + 1);
  return keys;
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

export const isNyseFullHoliday = (value: Date): boolean => {
  const parts = resolveNewYorkClockParts(value);
  if (!parts) {
    return false;
  }
  return buildNyseFullHolidayKeys(parts.year).has(
    dateKey(parts.year, parts.month, parts.day),
  );
};

const isNyseTradingDate = (
  parts: Pick<NewYorkClockParts, "year" | "month" | "day">,
): boolean => {
  const weekday = getUtcWeekday(parts.year, parts.month, parts.day);
  if (weekday === 0 || weekday === 6) {
    return false;
  }
  return !buildNyseFullHolidayKeys(parts.year).has(
    dateKey(parts.year, parts.month, parts.day),
  );
};

const isUsEquityOvernightSession = (parts: NewYorkClockParts): boolean => {
  if (parts.minutes < 3 * 60 + 50) {
    return isNyseTradingDate(parts);
  }
  if (parts.minutes >= 20 * 60) {
    return isNyseTradingDate(addDaysToDateKeyParts(parts, 1));
  }
  return false;
};

export const resolveUsEquityMarketSession = (
  value: Date | number | string = new Date(),
): UsEquityMarketSession => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return MARKET_SESSIONS.closed;
  }

  const parts = resolveNewYorkClockParts(date);
  if (!parts) {
    return MARKET_SESSIONS.closed;
  }

  if (isUsEquityOvernightSession(parts)) {
    return MARKET_SESSIONS.overnight;
  }

  if (!isNyseTradingDate(parts)) {
    return MARKET_SESSIONS.closed;
  }

  if (parts.minutes >= 4 * 60 && parts.minutes < 9 * 60 + 30) {
    return MARKET_SESSIONS.pre;
  }
  if (parts.minutes >= 9 * 60 + 30 && parts.minutes < 16 * 60) {
    return MARKET_SESSIONS.rth;
  }
  if (parts.minutes >= 16 * 60 && parts.minutes < 20 * 60) {
    return MARKET_SESSIONS.after;
  }

  return MARKET_SESSIONS.closed;
};

export const US_EQUITY_EXTENDED_SESSION_WINDOW_STRATEGY =
  "us-equity-extended-session";

export type UsEquityMarketSessionBarCounts = {
  overnight: number;
  pre: number;
  rth: number;
  after: number;
  closed: number;
};

export const countUsEquityMarketSessionBars = (
  chartBars: Pick<ChartBar, "time" | "ts">[],
): UsEquityMarketSessionBarCounts =>
  chartBars.reduce<UsEquityMarketSessionBarCounts>(
    (counts, bar) => {
      const session = resolveUsEquityMarketSession(bar.ts || bar.time * 1000);
      counts[session.key] += 1;
      return counts;
    },
    { overnight: 0, pre: 0, rth: 0, after: 0, closed: 0 },
  );

export const buildUsEquityExtendedSessionWindows = (
  chartBars: Pick<ChartBar, "time" | "ts">[],
): IndicatorWindow[] => {
  const windows: IndicatorWindow[] = [];
  if (!chartBars.length) {
    return windows;
  }

  let activeSession: "overnight" | "pre" | "after" | null = null;
  let segmentStart: number | null = null;

  const pushSegment = (endIndex: number) => {
    if (activeSession == null || segmentStart == null) {
      return;
    }
    const startBar = chartBars[segmentStart];
    const endBar = chartBars[endIndex];
    if (!startBar || !endBar) {
      return;
    }

    windows.push({
      id: `${US_EQUITY_EXTENDED_SESSION_WINDOW_STRATEGY}-${activeSession}-${segmentStart}`,
      strategy: US_EQUITY_EXTENDED_SESSION_WINDOW_STRATEGY,
      direction: "long",
      tone: "neutral",
      startTs: startBar.ts,
      endTs: endBar.ts,
      startBarIndex: segmentStart,
      endBarIndex: endIndex,
      meta: {
        style: "background",
        label:
          activeSession === "overnight"
            ? "Overnight"
            : activeSession === "pre"
              ? "Premarket"
              : "After-hours",
        marketSessionKey: activeSession,
        dataTestId: `chart-extended-session-${activeSession}`,
      },
    });
  };

  chartBars.forEach((bar, index) => {
    const session = resolveUsEquityMarketSession(bar.ts || bar.time * 1000);
    const nextSession =
      session.key === "overnight" ||
      session.key === "pre" ||
      session.key === "after"
        ? session.key
        : null;

    if (nextSession === activeSession) {
      return;
    }

    if (activeSession != null && segmentStart != null) {
      pushSegment(index - 1);
    }
    activeSession = nextSession;
    segmentStart = nextSession != null ? index : null;
  });

  if (activeSession != null && segmentStart != null) {
    pushSegment(chartBars.length - 1);
  }

  return windows;
};
