export const PNL_CALENDAR_WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const startOfCalendarDay = (input) => {
  if (input == null || input === "") return null;
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

export const isoCalendarDay = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const nextWeekdayCalendarDay = (date) => {
  const adjusted = new Date(date);
  const weekday = adjusted.getDay();
  if (weekday === 6) adjusted.setDate(adjusted.getDate() + 2);
  if (weekday === 0) adjusted.setDate(adjusted.getDate() + 1);
  return adjusted;
};

const pnlBucketDay = (input) => {
  const day = startOfCalendarDay(input);
  return day ? nextWeekdayCalendarDay(day) : null;
};

const monthKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export const monthLabel = (date) => `${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;

export const addCalendarMonths = (date, delta) =>
  new Date(date.getFullYear(), date.getMonth() + delta, 1);

export const findLatestCalendarActivityDate = ({
  trades = [],
  equityPoints = [],
} = {}) => {
  let latest = null;
  const consider = (value) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) return;
    if (!latest || date.getTime() > latest.getTime()) {
      latest = date;
    }
  };

  trades.forEach((trade) => {
    const realized = finiteNumber(trade?.realizedPnl) ?? finiteNumber(trade?.pnl);
    if (realized == null) return;
    consider(pnlBucketDay(trade?.closeDate));
  });

  equityPoints.forEach((point) => {
    if (finiteNumber(point?.netLiquidation) == null) return;
    consider(pnlBucketDay(point?.timestamp ?? point?.timestampMs));
  });

  return latest ? startOfCalendarDay(latest) : null;
};

const dayRange = (startDate, endDate) => {
  const start = startOfCalendarDay(startDate);
  const end = startOfCalendarDay(endDate);
  if (!start || !end || start.getTime() > end.getTime()) return [];
  const out = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};

const buildEquityDailyMap = (equityPoints = []) => {
  const byDay = new Map();
  equityPoints.forEach((point) => {
    const parsed = point?.timestamp ?? point?.timestampMs;
    const timestamp = parsed instanceof Date ? new Date(parsed.getTime()) : new Date(parsed);
    const day = pnlBucketDay(timestamp);
    if (!day || Number.isNaN(timestamp.getTime())) return;
    const nav = finiteNumber(point?.netLiquidation);
    if (nav == null) return;
    const key = isoCalendarDay(day);
    const transferDelta =
      (finiteNumber(point?.deposits) ?? 0) - (finiteNumber(point?.withdrawals) ?? 0);
    const current = byDay.get(key) || {
      iso: key,
      eodNav: null,
      eodTs: -Infinity,
      transfers: 0,
    };
    if (timestamp.getTime() >= current.eodTs) {
      current.eodNav = nav;
      current.eodTs = timestamp.getTime();
    }
    current.transfers += transferDelta;
    byDay.set(key, current);
  });
  return byDay;
};

export const buildDailyPnlSeries = ({
  trades = [],
  equityPoints = [],
  startDate,
  endDate,
} = {}) => {
  const tradesByDay = new Map();
  trades.forEach((trade) => {
    const day = pnlBucketDay(trade?.closeDate);
    if (!day) return;
    const realized = finiteNumber(trade?.realizedPnl) ?? finiteNumber(trade?.pnl);
    if (realized == null) return;
    const key = isoCalendarDay(day);
    const current = tradesByDay.get(key) || {
      iso: key,
      realized: 0,
      trades: 0,
    };
    current.realized += realized;
    current.trades += 1;
    tradesByDay.set(key, current);
  });

  const equityByDay = buildEquityDailyMap(equityPoints);
  const sortedEquityDays = Array.from(equityByDay.values())
    .filter((entry) => entry.eodNav != null)
    .sort((a, b) => a.eodTs - b.eodTs);
  const dates = dayRange(startDate, endDate);
  const windowStartIso = dates[0] ? isoCalendarDay(dates[0]) : null;
  let priorNav = null;
  for (const entry of sortedEquityDays) {
    if (windowStartIso && entry.iso < windowStartIso) {
      priorNav = entry.eodNav;
    } else {
      break;
    }
  }

  return dates.map((date) => {
    const iso = isoCalendarDay(date);
    const tradeRow = tradesByDay.get(iso);
    const equityRow = equityByDay.get(iso);
    const realized = tradeRow?.realized ?? 0;
    const tradeCount = tradeRow?.trades ?? 0;
    let total = null;
    if (equityRow?.eodNav != null && priorNav != null) {
      total = equityRow.eodNav - priorNav - (equityRow.transfers || 0);
    }
    if (equityRow?.eodNav != null) {
      priorNav = equityRow.eodNav;
    }
    const pnl = total != null ? total : realized;
    return {
      iso,
      date,
      pnl,
      pnlSource: total != null ? "total" : "realized",
      realized,
      unrealized: total != null ? total - realized : null,
      total,
      trades: tradeCount,
    };
  });
};

const summarizeDays = (days) => {
  const activeDays = days.filter((day) => day.trades > 0 || day.pnl !== 0);
  const pnl = activeDays.reduce((sum, day) => sum + day.pnl, 0);
  const realized = activeDays.reduce((sum, day) => sum + day.realized, 0);
  const wins = activeDays.filter((day) => day.pnl > 0).length;
  const losses = activeDays.filter((day) => day.pnl < 0).length;
  const trades = activeDays.reduce((sum, day) => sum + day.trades, 0);
  const best = activeDays.reduce(
    (acc, day) => (!acc || day.pnl > acc.pnl ? day : acc),
    null,
  );
  const worst = activeDays.reduce(
    (acc, day) => (!acc || day.pnl < acc.pnl ? day : acc),
    null,
  );
  const maxAbs = activeDays.reduce(
    (max, day) => Math.max(max, Math.abs(day.pnl)),
    0,
  );
  return { pnl, realized, wins, losses, trades, best, worst, maxAbs };
};

export const buildMonthPnlCalendarModel = ({
  trades = [],
  equityPoints = [],
  monthDate = new Date(),
  today = new Date(),
} = {}) => {
  const visibleMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const firstOfMonth = new Date(visibleMonth);
  const lastOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));
  const todayIso = isoCalendarDay(startOfCalendarDay(today) ?? new Date());
  const month = monthKey(visibleMonth);
  const days = buildDailyPnlSeries({
    trades,
    equityPoints,
    startDate: gridStart,
    endDate: gridEnd,
  }).map((day) => ({
    ...day,
    inMonth: monthKey(day.date) === month,
    isToday: day.iso === todayIso,
    dayLabel: day.iso === todayIso ? "Today" : String(day.date.getDate()),
  }));
  const monthDays = days.filter((day) => day.inMonth);
  return {
    month,
    label: monthLabel(visibleMonth),
    date: visibleMonth,
    days,
    summary: summarizeDays(monthDays),
  };
};

export const buildYearPnlCalendarModel = ({
  trades = [],
  equityPoints = [],
  year = new Date().getFullYear(),
  today = new Date(),
} = {}) => {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  const todayMonth = monthKey(startOfCalendarDay(today) ?? new Date());
  const days = buildDailyPnlSeries({ trades, equityPoints, startDate, endDate });
  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const date = new Date(year, monthIndex, 1);
    const key = monthKey(date);
    const monthDays = days.filter((day) => monthKey(day.date) === key);
    return {
      key,
      label: MONTH_LABELS[monthIndex],
      date,
      isCurrentMonth: key === todayMonth,
      days: monthDays,
      summary: summarizeDays(monthDays),
    };
  });
  return {
    year,
    label: String(year),
    months,
    summary: summarizeDays(days),
  };
};

export const formatCalendarPnlValue = (value, maskValues = false) => {
  const numeric = finiteNumber(value);
  if (numeric == null || numeric === 0) return "--";
  if (maskValues) return "****";
  const sign = numeric > 0 ? "+" : "-";
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 100) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(2)}`;
};
