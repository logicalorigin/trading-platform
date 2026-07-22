import { externalTransferAmount } from "@workspace/account-math";
import {
  listNyseEarlyCloses,
  previousTradingDayOrSame,
  tradingDaysBetween,
} from "@workspace/market-calendar";

export const PNL_CALENDAR_WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const PNL_MARKET_CALENDAR_NYSE = "nyse";
export const PNL_MARKET_CALENDAR_CONTINUOUS = "continuous";

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

const ACCOUNT_MARKET_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ACCOUNT_MARKET_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const EARLY_CLOSE_AT_BY_YEAR = new Map();

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizePnlMarketCalendar = (value) =>
  value === PNL_MARKET_CALENDAR_CONTINUOUS
    ? PNL_MARKET_CALENDAR_CONTINUOUS
    : PNL_MARKET_CALENDAR_NYSE;

export const resolveAccountPnlMarketCalendar = ({
  accountTab = "all",
  accounts = [],
} = {}) => {
  if (accountTab === "shadow") return PNL_MARKET_CALENDAR_NYSE;
  const scopedAccounts =
    accountTab === "all"
      ? accounts
      : accounts.filter((account) => String(account?.id) === String(accountTab));
  return scopedAccounts.some(
    (account) =>
      String(account?.accountType ?? "").trim().toLowerCase() === "crypto",
  )
    ? PNL_MARKET_CALENDAR_CONTINUOUS
    : PNL_MARKET_CALENDAR_NYSE;
};

export const startOfCalendarDay = (input) => {
  if (input == null || input === "") return null;
  const dateOnly = typeof input === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim())
    : null;
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : input instanceof Date
      ? new Date(input.getTime())
      : new Date(input);
  if (
    Number.isNaN(date.getTime()) ||
    (dateOnly &&
      (date.getFullYear() !== Number(dateOnly[1]) ||
        date.getMonth() !== Number(dateOnly[2]) - 1 ||
        date.getDate() !== Number(dateOnly[3])))
  ) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
};

export const isoCalendarDay = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const pnlBucketDay = (input) => startOfCalendarDay(input);

const monthKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export const monthLabel = (date) => `${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;

export const addCalendarMonths = (date, delta) =>
  new Date(date.getFullYear(), date.getMonth() + delta, 1);

const closedTradeCalendarKey = (trade, index) => {
  const id = String(trade?.id ?? trade?.tradeId ?? "").trim();
  if (!id) return `row:${index}`;
  const source = String(trade?.source ?? "").trim().toUpperCase();
  const accountId = String(trade?.accountId ?? "").trim();
  return `${source || "UNKNOWN"}:${accountId || "unknown"}:${id}`;
};

const tradeActivityDate = (trade) =>
  trade?.closeDate ??
  trade?.exitDate ??
  trade?.filledAt ??
  trade?.executedAt ??
  trade?.updatedAt;

const accountMarketDateKey = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return ACCOUNT_MARKET_DATE_FORMATTER.format(date);
};

const accountMarketMinutes = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = ACCOUNT_MARKET_TIME_FORMATTER.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : null;
};

const isPnlMarketSessionDate = (marketDate, marketCalendar) =>
  marketCalendar === PNL_MARKET_CALENDAR_CONTINUOUS ||
  previousTradingDayOrSame(marketDate) === marketDate;

const calendarDaysBetween = (from, toMarketDate) => {
  const fromMarketDate = accountMarketDateKey(from);
  if (!fromMarketDate) return 0;
  const fromMs = Date.parse(`${fromMarketDate}T00:00:00.000Z`);
  const toMs = Date.parse(`${toMarketDate}T00:00:00.000Z`);
  return Math.max(0, Math.round((toMs - fromMs) / 86_400_000));
};

const pnlMarketSessionsBetween = (from, toMarketDate, marketCalendar) =>
  marketCalendar === PNL_MARKET_CALENDAR_CONTINUOUS
    ? calendarDaysBetween(from, toMarketDate)
    : tradingDaysBetween(from, toMarketDate);

const earlyCloseAt = (marketDate) => {
  const year = Number(marketDate.slice(0, 4));
  let byDate = EARLY_CLOSE_AT_BY_YEAR.get(year);
  if (!byDate) {
    byDate = new Map(
      listNyseEarlyCloses(year).map((close) => [
        close.date,
        Date.parse(close.regularCloseAt),
      ]),
    );
    EARLY_CLOSE_AT_BY_YEAR.set(year, byDate);
  }
  return byDate.get(marketDate) ?? null;
};

const isClosingNavBaseline = (timestamp, source, marketCalendar) => {
  const marketDate = accountMarketDateKey(timestamp);
  if (!marketDate) return false;
  if (marketCalendar === PNL_MARKET_CALENDAR_CONTINUOUS) return true;
  if (!isPnlMarketSessionDate(marketDate, marketCalendar)) return false;
  if (source === "FLEX") return true;
  const minutes = accountMarketMinutes(timestamp);
  if (minutes == null || minutes < 13 * 60) return false;
  if (minutes >= 16 * 60) return true;
  const closeAt = earlyCloseAt(marketDate);
  return closeAt != null && Number.isFinite(closeAt) && timestamp >= closeAt;
};

const explicitAccountActivityTrade = (trade) => {
  const source = String(trade?.source ?? "").trim().toUpperCase();
  if (
    source === "LIVE_EXECUTION" ||
    source === "LIVE_ORDER" ||
    source === "LIVE" ||
    source === "SHADOW"
  ) {
    return true;
  }
  return Boolean(
    trade?.sourceType ||
      trade?.orderStatus ||
      trade?.filledAt ||
      trade?.executedAt,
  );
};

const tradePnlBucketDay = (trade) => {
  const explicitMarketDate =
    typeof trade?.marketDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(trade.marketDate)
      ? trade.marketDate
      : null;
  if (explicitMarketDate) {
    return pnlBucketDay(explicitMarketDate);
  }
  const activityDate = tradeActivityDate(trade);
  const activityDateOnly =
    typeof activityDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(activityDate)
      ? activityDate
      : null;
  if (activityDateOnly) {
    return pnlBucketDay(activityDateOnly);
  }
  const source = String(trade?.source ?? "").trim().toUpperCase();
  if (source === "FLEX" || explicitAccountActivityTrade(trade)) {
    const marketDate = accountMarketDateKey(activityDate);
    if (marketDate) {
      return pnlBucketDay(marketDate);
    }
  }
  return pnlBucketDay(activityDate);
};

const countUnbucketedCalendarTrades = (trades = []) =>
  trades.reduce((count, trade) => {
    const realized = finiteNumber(trade?.realizedPnl) ?? finiteNumber(trade?.pnl);
    return realized != null && !tradePnlBucketDay(trade) ? count + 1 : count;
  }, 0);

export const findLatestCalendarActivityDate = ({
  trades = [],
  equityPoints = [],
  marketCalendar = PNL_MARKET_CALENDAR_NYSE,
} = {}) => {
  const candidateDays = [];
  const considerDay = (day) => {
    if (day) candidateDays.push(day);
  };

  trades.forEach((trade) => {
    const realized = finiteNumber(trade?.realizedPnl) ?? finiteNumber(trade?.pnl);
    if (realized == null) return;
    considerDay(tradePnlBucketDay(trade));
  });

  equityPoints.forEach((point) => {
    if (finiteNumber(point?.netLiquidation) == null) return;
    const timestamp = point?.timestamp ?? point?.timestampMs;
    const marketDate = accountMarketDateKey(timestamp);
    considerDay(pnlBucketDay(marketDate ?? timestamp));
  });

  if (!candidateDays.length) return null;
  const sortedDays = candidateDays.sort((a, b) => a.getTime() - b.getTime());
  const series = buildDailyPnlSeries({
    trades,
    equityPoints,
    startDate: sortedDays[0],
    endDate: sortedDays[sortedDays.length - 1],
    marketCalendar,
  });
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const day = series[index];
    if (day.trades > 0 || day.pnl !== 0) return startOfCalendarDay(day.date);
  }
  return null;
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

const buildEquityDailyMap = (
  equityPoints = [],
  marketCalendar = PNL_MARKET_CALENDAR_NYSE,
) => {
  const byDay = new Map();
  equityPoints.forEach((point) => {
    const parsed = point?.timestamp ?? point?.timestampMs;
    const timestamp = parsed instanceof Date ? new Date(parsed.getTime()) : new Date(parsed);
    const marketDate = accountMarketDateKey(timestamp);
    const day = pnlBucketDay(marketDate ?? timestamp);
    if (!day || Number.isNaN(timestamp.getTime())) return;
    const nav = finiteNumber(point?.netLiquidation);
    if (nav == null) return;
    const source = String(point?.source ?? "").trim().toUpperCase() || null;
    const key = isoCalendarDay(day);
    const transferDelta = externalTransferAmount(point);
    const current = byDay.get(key) || {
      iso: key,
      firstNav: null,
      firstTs: Infinity,
      eodNav: null,
      eodTs: -Infinity,
      eodMarketDate: null,
      eodSource: null,
      closingNav: null,
      closingTs: -Infinity,
      closingSource: null,
      transfers: 0,
      transferRows: [],
      timestampRows: new Map(),
      hasTimestampConflict: false,
      hasTransferConflict: false,
    };
    const timestampMs = timestamp.getTime();
    const existingTimestampRow = current.timestampRows.get(timestampMs);
    if (existingTimestampRow) {
      if (
        existingTimestampRow.nav !== nav ||
        existingTimestampRow.transferDelta !== transferDelta ||
        existingTimestampRow.source !== source
      ) {
        current.hasTimestampConflict = true;
      }
      if (existingTimestampRow.transferDelta !== transferDelta) {
        current.hasTransferConflict = true;
      }
      return;
    }
    current.timestampRows.set(timestampMs, { nav, transferDelta, source });
    if (timestampMs < current.firstTs) {
      current.firstNav = nav;
      current.firstTs = timestampMs;
    }
    if (timestampMs > current.eodTs) {
      current.eodNav = nav;
      current.eodTs = timestampMs;
      current.eodMarketDate = marketDate;
      current.eodSource = source;
    }
    if (
      marketDate === key &&
      timestampMs > current.closingTs &&
      isClosingNavBaseline(timestampMs, source, marketCalendar)
    ) {
      current.closingNav = nav;
      current.closingTs = timestampMs;
      current.closingSource = source;
    }
    current.transfers += transferDelta;
    current.transferRows.push({ timestampMs, transferDelta });
    byDay.set(key, current);
  });
  byDay.forEach((entry) => {
    entry.transfersAfterFirstTs = entry.transferRows.reduce(
      (sum, row) => sum + (row.timestampMs > entry.firstTs ? row.transferDelta : 0),
      0,
    );
    entry.terminalNav = entry.closingNav ?? entry.eodNav;
    entry.terminalTs = entry.closingNav != null ? entry.closingTs : entry.eodTs;
    const forwardBucketTerminal =
      entry.eodMarketDate != null && entry.eodMarketDate !== entry.iso;
    entry.baselineNav =
      entry.closingNav ?? (forwardBucketTerminal ? entry.eodNav : null);
    entry.baselineTs =
      entry.closingNav != null
        ? entry.closingTs
        : forwardBucketTerminal
          ? entry.eodTs
          : null;
    entry.baselineSource =
      entry.closingNav != null
        ? entry.closingSource
        : forwardBucketTerminal
          ? entry.eodSource
          : null;
  });
  return byDay;
};

export const buildDailyPnlSeries = ({
  trades = [],
  equityPoints = [],
  startDate,
  endDate,
  marketCalendar = PNL_MARKET_CALENDAR_NYSE,
} = {}) => {
  const normalizedMarketCalendar =
    normalizePnlMarketCalendar(marketCalendar);
  const tradesByDay = new Map();
  trades.forEach((trade, index) => {
    const day = tradePnlBucketDay(trade);
    if (!day) return;
    const realized = finiteNumber(trade?.realizedPnl) ?? finiteNumber(trade?.pnl);
    const key = isoCalendarDay(day);
    const current = tradesByDay.get(key) || {
      iso: key,
      realized: 0,
      realizedCount: 0,
      trades: 0,
      tradeKeys: new Set(),
    };
    const tradeKey = closedTradeCalendarKey(trade, index);
    if (current.tradeKeys.has(tradeKey)) return;
    current.tradeKeys.add(tradeKey);
    current.trades += 1;
    if (realized != null) {
      current.realized += realized;
      current.realizedCount += 1;
    }
    tradesByDay.set(key, current);
  });

  const equityByDay = buildEquityDailyMap(
    equityPoints,
    normalizedMarketCalendar,
  );
  const sortedEquityDays = Array.from(equityByDay.values())
    .filter((entry) => entry.eodNav != null)
    .sort((a, b) => a.eodTs - b.eodTs);
  const dates = dayRange(startDate, endDate);
  const windowStartIso = dates[0] ? isoCalendarDay(dates[0]) : null;
  let priorNav = null;
  let priorNavTs = null;
  let priorNavSource = null;
  let pendingTransferAdjustment = 0;
  let pendingTransferConflict = false;
  for (const entry of sortedEquityDays) {
    if (windowStartIso && entry.iso < windowStartIso) {
      if (
        !isPnlMarketSessionDate(entry.iso, normalizedMarketCalendar)
      ) {
        pendingTransferAdjustment += entry.transfers || 0;
        pendingTransferConflict ||= entry.hasTransferConflict === true;
        continue;
      }
      if (
        entry.hasTimestampConflict === true ||
        entry.baselineNav == null
      ) {
        priorNav = null;
        priorNavTs = null;
        priorNavSource = null;
      } else {
        priorNav = entry.baselineNav;
        priorNavTs = entry.baselineTs;
        priorNavSource = entry.baselineSource;
      }
      pendingTransferAdjustment = 0;
      pendingTransferConflict = false;
    } else {
      break;
    }
  }

  return dates.map((date) => {
    const iso = isoCalendarDay(date);
    const tradeRow = tradesByDay.get(iso);
    const equityRow = equityByDay.get(iso);
    if (!isPnlMarketSessionDate(iso, normalizedMarketCalendar)) {
      pendingTransferAdjustment += equityRow?.transfers || 0;
      pendingTransferConflict ||=
        equityRow?.hasTransferConflict === true;
      return {
        iso,
        date,
        hasPnlData: false,
        pnl: 0,
        pnlSource: null,
        realized: 0,
        unrealized: null,
        total: null,
        trades: 0,
      };
    }
    const tradeCount = tradeRow?.trades ?? 0;
    const realizedComplete = Boolean(
      tradeRow && tradeRow.realizedCount === tradeRow.trades,
    );
    const realized = realizedComplete ? tradeRow.realized : tradeRow ? null : 0;
    let total = null;
    const intradayBaselineAvailable =
      equityRow?.firstNav != null &&
      equityRow?.terminalNav != null &&
      equityRow.hasTimestampConflict !== true &&
      Number.isFinite(equityRow.firstTs) &&
      Number.isFinite(equityRow.terminalTs) &&
      equityRow.firstTs < equityRow.terminalTs;
    const hasPreviousTradingDayBaseline =
      priorNav != null &&
      priorNavTs != null &&
      equityRow?.terminalTs != null &&
      equityRow.hasTimestampConflict !== true &&
      pendingTransferConflict !== true &&
      isClosingNavBaseline(
        priorNavTs,
        priorNavSource,
        normalizedMarketCalendar,
      ) &&
      pnlMarketSessionsBetween(
        priorNavTs,
        equityRow.iso,
        normalizedMarketCalendar,
      ) === 1;
    const baselineNav = hasPreviousTradingDayBaseline
      ? priorNav
      : intradayBaselineAvailable
        ? equityRow.firstNav
        : null;
    if (equityRow?.terminalNav != null && baselineNav != null) {
      const transferAdjustment = hasPreviousTradingDayBaseline
        ? pendingTransferAdjustment + (equityRow.transfers || 0)
        : equityRow.transfersAfterFirstTs || 0;
      total = equityRow.terminalNav - baselineNav - transferAdjustment;
    }
    if (equityRow?.hasTimestampConflict === true) {
      priorNav = null;
      priorNavTs = null;
      priorNavSource = null;
    } else if (equityRow?.baselineNav != null) {
      priorNav = equityRow.baselineNav;
      priorNavTs = equityRow.baselineTs;
      priorNavSource = equityRow.baselineSource;
    } else if (equityRow?.eodNav != null) {
      priorNav = null;
      priorNavTs = null;
      priorNavSource = null;
    }
    pendingTransferAdjustment = 0;
    pendingTransferConflict = false;
    const hasPnlData = total != null || realizedComplete;
    const pnl = total != null ? total : realized ?? 0;
    return {
      iso,
      date,
      hasPnlData,
      pnl,
      pnlSource: total != null ? "total" : realizedComplete ? "realized" : null,
      realized,
      unrealized: total != null && realized != null ? total - realized : null,
      total,
      trades: tradeCount,
    };
  });
};

const summarizeDays = (days, { unbucketedTrades = 0 } = {}) => {
  const activityDays = days.filter((day) => day.trades > 0 || day.pnl !== 0);
  const pnlComplete =
    unbucketedTrades === 0 && activityDays.every((day) => day.hasPnlData);
  const realizedComplete =
    unbucketedTrades === 0 &&
    days.every((day) => day.trades === 0 || day.realized != null);
  const activeDays = activityDays.filter((day) => day.hasPnlData);
  const pnl = activeDays.reduce((sum, day) => sum + day.pnl, 0);
  const realized = activeDays.reduce((sum, day) => sum + day.realized, 0);
  const wins = activeDays.filter((day) => day.pnl > 0).length;
  const losses = activeDays.filter((day) => day.pnl < 0).length;
  const trades = days.reduce((sum, day) => sum + day.trades, 0);
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
  return {
    pnl,
    pnlComplete,
    realized,
    realizedComplete,
    wins,
    losses,
    trades,
    unbucketedTrades,
    best,
    worst,
    maxAbs,
  };
};

export const buildMonthPnlCalendarModel = ({
  trades = [],
  equityPoints = [],
  monthDate = new Date(),
  today = new Date(),
  marketCalendar = PNL_MARKET_CALENDAR_NYSE,
} = {}) => {
  const visibleMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const firstOfMonth = new Date(visibleMonth);
  const lastOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));
  const todayIso = accountMarketDateKey(today) ?? isoCalendarDay(new Date());
  const month = monthKey(visibleMonth);
  const days = buildDailyPnlSeries({
    trades,
    equityPoints,
    startDate: gridStart,
    endDate: gridEnd,
    marketCalendar,
  }).map((day) => ({
    ...day,
    inMonth: monthKey(day.date) === month,
    isToday: day.iso === todayIso,
    dayLabel: day.iso === todayIso ? "Today" : String(day.date.getDate()),
  }));
  const monthDays = days.filter((day) => day.inMonth);
  const unbucketedTrades = countUnbucketedCalendarTrades(trades);
  return {
    month,
    label: monthLabel(visibleMonth),
    date: visibleMonth,
    days,
    summary: summarizeDays(monthDays, { unbucketedTrades }),
  };
};

export const buildYearPnlCalendarModel = ({
  trades = [],
  equityPoints = [],
  year = new Date().getFullYear(),
  today = new Date(),
  marketCalendar = PNL_MARKET_CALENDAR_NYSE,
} = {}) => {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  const todayMonth =
    accountMarketDateKey(today)?.slice(0, 7) ?? monthKey(new Date());
  const days = buildDailyPnlSeries({
    trades,
    equityPoints,
    startDate,
    endDate,
    marketCalendar,
  });
  const unbucketedTrades = countUnbucketedCalendarTrades(trades);
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
      summary: summarizeDays(monthDays, { unbucketedTrades }),
    };
  });
  return {
    year,
    label: String(year),
    months,
    summary: summarizeDays(days, { unbucketedTrades }),
  };
};

export const findLatestVisiblePnlCalendarDay = (days = []) =>
  days.reduce((latest, day) => {
    if (!day?.inMonth || !(day.trades > 0 || day.pnl !== 0)) return latest;
    if (!latest || day.date.getTime() > latest.date.getTime()) return day;
    return latest;
  }, null);

export const resolveActivePnlCalendarDay = ({
  days = [],
  hoveredDayIso = null,
  pinnedDayIso = null,
} = {}) => {
  const visibleDaysByIso = new Map(
    days.filter((day) => day?.inMonth).map((day) => [day.iso, day]),
  );
  return (
    visibleDaysByIso.get(hoveredDayIso) ||
    visibleDaysByIso.get(pinnedDayIso) ||
    findLatestVisiblePnlCalendarDay(days)
  );
};
