import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ThemeContext } from "../../features/platform/platformContexts";
import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  Panel,
  ToggleGroup,
  formatAccountSignedMoney,
} from "./accountUtils";
import {
  PNL_CALENDAR_WEEKDAYS,
  addCalendarMonths,
  buildMonthPnlCalendarModel,
  buildYearPnlCalendarModel,
  findLatestCalendarActivityDate,
  formatCalendarPnlValue,
  resolveActivePnlCalendarDay,
} from "./accountPnlCalendarModel.js";
import { AppTooltip } from "@/components/ui/tooltip";


const CALENDAR_VIEW_OPTIONS = [
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

export const msUntilNextLocalDay = (now = new Date()) => {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) return 60_000;
  const nextDay = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() + 1,
    0,
    0,
    0,
    25,
  );
  return Math.max(1_000, nextDay.getTime() - current.getTime());
};

const useLocalToday = () => {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    let timerId;
    const schedule = () => {
      timerId = window.setTimeout(() => {
        setToday(new Date());
        schedule();
      }, msUntilNextLocalDay());
    };
    schedule();
    return () => window.clearTimeout(timerId);
  }, []);
  return today;
};

const calendarThemeStyle = () => {
  return {
    gridLine: CSS_COLOR.borderLight,
    neutralBg: CSS_COLOR.bg1,
    mutedNeutralBg: `${cssColorMix(CSS_COLOR.border, 27)}`,
    dayText: CSS_COLOR.textSec,
    mutedDayText: CSS_COLOR.textMuted,
    zeroValueText: "transparent",
    positive: `${cssColorMix(CSS_COLOR.green, 14)}`,
    negative: `${cssColorMix(CSS_COLOR.red, 14)}`,
    positiveText: CSS_COLOR.green,
    negativeText: CSS_COLOR.red,
    activeText: CSS_COLOR.text,
    activeDayText: CSS_COLOR.text,
    shadow: "none",
    border: CSS_COLOR.border,
    navBg: CSS_COLOR.bg2,
    navText: CSS_COLOR.textSec,
  };
};

const calendarButtonStyle = (style, isPhone = false, compact = false) => ({
  width: dim(compact ? 20 : isPhone ? 32 : 24),
  height: dim(compact ? 20 : isPhone ? 32 : 24),
  minHeight: dim(compact ? 20 : isPhone ? 32 : 24),
  display: "inline-grid",
  placeItems: "center",
  border: `1px solid ${style.border}`,
  borderRadius: dim(RADII.xs),
  background: style.navBg,
  color: style.navText,
  padding: 0,
  cursor: "pointer",
});

const formatCalendarCellValue = (value, maskValues) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return formatCalendarPnlValue(value, maskValues);
};

const calendarCellTone = (value, muted = false, style = calendarThemeStyle()) => {
  const numeric = Number(value || 0);
  if (numeric > 0) {
    return {
      background: style.positive,
      color: style.positiveText,
      dayColor: style.activeDayText,
      borderColor: "transparent",
      boxShadow: style.shadow,
    };
  }
  if (numeric < 0) {
    return {
      background: style.negative,
      color: style.negativeText,
      dayColor: style.activeDayText,
      borderColor: "transparent",
      boxShadow: style.shadow,
    };
  }
  return {
    background: muted ? style.mutedNeutralBg : style.neutralBg,
    color: style.zeroValueText,
    dayColor: muted ? style.mutedDayText : style.dayText,
    borderColor: "transparent",
    boxShadow: "none",
  };
};

const calendarMoneyOrDash = (value, currency, maskValues) =>
  value == null ? "—" : formatAccountSignedMoney(value, currency, true, maskValues);

const calendarPnlSourceLabel = (day) => {
  if (!day) return "—";
  if (day.pnlSource === "account-summary") return "Account page";
  return day.pnlSource === "total" ? "NAV total" : "realized fallback";
};

const dayTooltip = (day, currency, maskValues) => {
  const pnlFmt = formatAccountSignedMoney(day.pnl || 0, currency, true, maskValues);
  const realFmt = formatAccountSignedMoney(day.realized || 0, currency, true, maskValues);
  const totalFmt = calendarMoneyOrDash(day.total, currency, maskValues);
  const unrealFmt = calendarMoneyOrDash(day.unrealized, currency, maskValues);
  const source = calendarPnlSourceLabel(day);
  return [
    day.iso,
    `P&L ${pnlFmt} (${source})`,
    `Total ${totalFmt}`,
    `Realized ${realFmt}`,
    `Unrealized ${unrealFmt}`,
    `${day.trades} trade${day.trades === 1 ? "" : "s"}`,
  ].join("\n");
};

const dayAriaLabel = (day, currency, maskValues) => {
  const pnlFmt = formatAccountSignedMoney(day.pnl || 0, currency, true, maskValues);
  const tradeLabel = `${day.trades} trade${day.trades === 1 ? "" : "s"}`;
  return `${day.iso} P&L ${pnlFmt}, ${tradeLabel}`;
};

const CalendarNavButton = ({ label, onClick, children, calendarStyle, isPhone = false, compact = false }) => (
  <AppTooltip content={label}>
    <button
      type="button"
      className="ra-interactive"
      aria-label={label}
      onClick={onClick}
      style={calendarButtonStyle(calendarStyle, isPhone, compact)}
    >
      {children}
    </button>
  </AppTooltip>
);

const CalendarViewToggle = ({ value, onChange, calendarStyle, compact = false }) => {
  if (!compact) {
    return <ToggleGroup options={CALENDAR_VIEW_OPTIONS} value={value} onChange={onChange} />;
  }

  return (
    <div
      role="tablist"
      aria-label="Calendar view"
      style={{
        display: "inline-flex",
        gap: sp(1),
        padding: sp(1),
        borderRadius: dim(RADII.pill),
        background: CSS_COLOR.bg1,
        minWidth: 0,
      }}
    >
      {CALENDAR_VIEW_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <AppTooltip key={option.value} content={option.label}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="ra-interactive"
              onClick={() => onChange(option.value)}
              style={{
                height: dim(20),
                minHeight: dim(20),
                minWidth: dim(22),
                padding: sp("0 5px"),
                border: "none",
                borderRadius: dim(RADII.pill),
                background: active ? CSS_COLOR.bg3 : "transparent",
                color: active ? CSS_COLOR.text : CSS_COLOR.textDim,
                fontSize: textSize("micro"),
                fontFamily: T.sans,
                fontWeight: active ? FONT_WEIGHTS.label : FONT_WEIGHTS.medium,
                letterSpacing: 0,
                cursor: "pointer",
              }}
            >
              {option.label.slice(0, 1)}
            </button>
          </AppTooltip>
        );
      })}
    </div>
  );
};

const MonthCalendarGrid = ({
  model,
  currency,
  maskValues,
  calendarStyle,
  activeDayIso,
  pinnedDayIso,
  onHoverDay,
  onClearHoverDay,
  onPinDay,
  isPhone = false,
  compact = false,
}) => {
  const calendarWeeks = [];
  for (let index = 0; index < model.days.length; index += 7) {
    calendarWeeks.push(model.days.slice(index, index + 7));
  }
  const renderedWeeks = calendarWeeks.filter((week) => week.some((day) => day.inMonth));
  const renderedDays = renderedWeeks.flatMap((week, weekIndex) =>
    week.flatMap((day, dayIndex) =>
      day.inMonth
        ? [{
            day,
            gridColumnStart: dayIndex + 1,
            gridRowStart: weekIndex + 1,
          }]
        : [],
    ),
  );

  const cellHeight = dim(compact ? 21 : isPhone ? 32 : 44);
  const monthGridGap = dim(compact ? 0 : 1);

  return (
    <div style={{ display: "grid", gap: sp(compact ? 1 : 3), minWidth: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: monthGridGap,
        }}
      >
        {PNL_CALENDAR_WEEKDAYS.map((day) => (
          <div
            key={day}
            style={{
              color: CSS_COLOR.textMuted,
              fontSize: compact ? dim(7) : fs(isPhone ? 7 : 8),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: 0,
              lineHeight: 1,
              textAlign: "center",
              padding: sp(compact ? "0 0 1px" : "1px 0 3px"),
            }}
          >
            {compact ? day.slice(0, 1) : day}
          </div>
        ))}
      </div>
      <div
        data-testid="account-pnl-calendar-month-grid"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            onClearHoverDay();
          }
        }}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: monthGridGap,
          borderRadius: dim(RADII.xs),
          overflow: "hidden",
        }}
      >
        {renderedDays.map(({ day, gridColumnStart, gridRowStart }) => {
          const dayNumber = String(day.date.getDate());
          const displayPnl = day.pnl;
          const isActive = activeDayIso === day.iso;
          const isPinned = pinnedDayIso === day.iso;
          const tone = calendarCellTone(
            displayPnl,
            false,
            calendarStyle,
          );
          return (
            <button
              key={day.iso}
              type="button"
              className="ra-interactive"
              data-testid="account-pnl-calendar-day"
              data-active={isActive ? "true" : undefined}
              data-pinned={isPinned ? "true" : undefined}
              aria-label={dayAriaLabel(day, currency, maskValues)}
              aria-pressed={isPinned ? "true" : "false"}
              aria-current={day.isToday ? "date" : undefined}
              title={dayTooltip(day, currency, maskValues)}
              onPointerEnter={() => onHoverDay(day.iso)}
              onFocus={() => onHoverDay(day.iso)}
              onClick={() => onPinDay(day.iso)}
              style={{
                appearance: "none",
                boxSizing: "border-box",
                gridColumnStart,
                gridRowStart,
                minWidth: 0,
                width: "100%",
                minHeight: cellHeight,
                display: "grid",
                gridTemplateRows: "auto minmax(0, 1fr)",
                alignItems: "stretch",
                gap: sp(compact ? 0 : isPhone ? 1 : 3),
                padding: sp(compact ? "2px 0 1px" : isPhone ? "4px 2px 3px" : "5px 4px 4px"),
                border: `1px solid ${isActive ? CSS_COLOR.accent : tone.borderColor}`,
                borderRadius: dim(RADII.xs),
                background: isActive
                  ? `linear-gradient(0deg, ${cssColorMix(CSS_COLOR.accent, 7)}, ${cssColorMix(CSS_COLOR.accent, 7)}), ${tone.background}`
                  : tone.background,
                boxShadow: isPinned
                  ? `inset 0 0 0 1px ${cssColorMix(CSS_COLOR.accent, 53)}`
                  : isActive
                    ? `inset 0 0 0 1px ${cssColorMix(CSS_COLOR.accent, 33)}`
                    : tone.boxShadow,
                overflow: "hidden",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  minWidth: 0,
                  maxWidth: "100%",
                  color: tone.dayColor,
                  fontSize: compact ? dim(8) : fs(isPhone ? 7 : 9),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.medium,
                  lineHeight: 1.1,
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "clip",
                }}
              >
                {dayNumber}
              </div>
              <div
                style={{
                  alignSelf: "end",
                  justifySelf: "center",
                  display: "grid",
                  gap: sp(1),
                  width: "100%",
                  minWidth: 0,
                  maxWidth: "100%",
                  minHeight: dim(10),
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "block",
                    width: "100%",
                    minWidth: 0,
                    maxWidth: "100%",
                    color: tone.color,
                    fontSize: compact ? dim(8) : fs(isPhone ? 8 : 10),
                    fontFamily: T.sans,
                    fontWeight: FONT_WEIGHTS.medium,
                    lineHeight: 1,
                    textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "clip",
                  }}
                >
                  {formatCalendarCellValue(displayPnl, maskValues)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const CalendarDayDetail = ({ day, currency, maskValues, calendarStyle }) => {
  const pnlTone = !day
    ? CSS_COLOR.textDim
    : day.pnl > 0
      ? calendarStyle.positiveText
      : day.pnl < 0
        ? calendarStyle.negativeText
        : CSS_COLOR.textDim;
  const source = calendarPnlSourceLabel(day);
  const detailItemStyle = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: sp(2),
    minWidth: 0,
    whiteSpace: "nowrap",
  };
  const labelStyle = {
    color: CSS_COLOR.textMuted,
    fontSize: textSize("micro"),
    fontFamily: T.sans,
    lineHeight: 1,
  };
  const valueStyle = {
    color: CSS_COLOR.textSec,
    fontSize: textSize("caption"),
    fontFamily: T.sans,
    fontWeight: FONT_WEIGHTS.regular,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  };
  return (
    <div
      data-testid="account-pnl-calendar-day-detail"
      style={{
        minHeight: dim(30),
        display: "flex",
        alignItems: "center",
        gap: sp("4px 10px"),
        flexWrap: "wrap",
        padding: sp("5px 6px"),
        border: `1px solid ${calendarStyle.gridLine}`,
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg1,
        minWidth: 0,
      }}
    >
      <span
        data-testid="account-pnl-calendar-active-date"
        style={{
          color: day ? CSS_COLOR.text : CSS_COLOR.textMuted,
          fontSize: textSize("caption"),
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.medium,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {day?.iso || "No activity"}
      </span>
      <span style={detailItemStyle}>
        <span style={labelStyle}>P&L</span>
        <span style={{ ...valueStyle, color: pnlTone }}>
          {day ? formatAccountSignedMoney(day.pnl || 0, currency, true, maskValues) : "—"}
        </span>
      </span>
      <span style={detailItemStyle}>
        <span style={labelStyle}>Total</span>
        <span style={valueStyle}>{day ? calendarMoneyOrDash(day.total, currency, maskValues) : "—"}</span>
      </span>
      <span style={detailItemStyle}>
        <span style={labelStyle}>Realized</span>
        <span style={valueStyle}>
          {day ? formatAccountSignedMoney(day.realized || 0, currency, true, maskValues) : "—"}
        </span>
      </span>
      <span style={detailItemStyle}>
        <span style={labelStyle}>Unrealized</span>
        <span style={valueStyle}>{day ? calendarMoneyOrDash(day.unrealized, currency, maskValues) : "—"}</span>
      </span>
      <span style={detailItemStyle}>
        <span style={labelStyle}>Trades</span>
        <span style={valueStyle}>{day ? day.trades : "—"}</span>
      </span>
      <span style={detailItemStyle}>
        <span style={labelStyle}>Source</span>
        <span style={valueStyle}>{source}</span>
      </span>
    </div>
  );
};

const YearCalendarGrid = ({
  model,
  currency,
  maskValues,
  onSelectMonth,
  calendarStyle,
  isPhone = false,
  compact = false,
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: sp(1),
      background: calendarStyle.gridLine,
      borderRadius: dim(RADII.xs),
      overflow: "hidden",
      minWidth: 0,
    }}
  >
    {model.months.map((month) => {
      const summary = month.summary;
      const tone = calendarCellTone(
        summary.pnl,
        false,
        calendarStyle,
      );
      const value =
        summary.trades || summary.pnl !== 0
          ? formatAccountSignedMoney(summary.pnl, currency, true, maskValues)
          : "—";
      const realizedValue = formatAccountSignedMoney(
        summary.realized,
        currency,
        true,
        maskValues,
      );
      const tooltip = [
        `${month.label} ${model.year}`,
        `P&L ${value}`,
        `Realized ${realizedValue}`,
        `${summary.wins}W / ${summary.losses}L`,
        `${summary.trades} trade${summary.trades === 1 ? "" : "s"}`,
      ].join("\n");
      return (
        <AppTooltip
          key={month.key}
          content={tooltip}
        >
          <button
            type="button"
            className="ra-interactive"
            onClick={() => onSelectMonth(month.date)}
            style={{
              minWidth: 0,
              minHeight: dim(compact ? 28 : isPhone ? 38 : 43),
              display: "grid",
              alignContent: "center",
              gap: sp(compact ? 1 : 2),
              padding: sp(compact ? "3px 2px" : "4px 3px"),
              border: `1px solid ${
                month.isCurrentMonth ? calendarStyle.border : tone.borderColor
              }`,
              borderRadius: dim(RADII.xs),
              background: tone.background,
              color: CSS_COLOR.textSec,
              boxShadow: tone.boxShadow,
              overflow: "hidden",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                minWidth: 0,
                color:
                  summary.pnl !== 0
                    ? tone.dayColor
                    : month.isCurrentMonth
                      ? CSS_COLOR.text
                      : CSS_COLOR.textSec,
                fontSize: fs(compact ? 7 : isPhone ? 8 : 9),
                fontFamily: T.sans,
                fontWeight: month.isCurrentMonth ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                lineHeight: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "clip",
              }}
            >
              {month.label}
            </span>
            <span
              style={{
                minWidth: 0,
                color: tone.color,
                fontSize: fs(compact ? 7 : isPhone ? 8 : 10),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "clip",
              }}
            >
              {formatCalendarPnlValue(summary.pnl, maskValues)}
            </span>
            <span
              style={{
                minWidth: 0,
                color: CSS_COLOR.textMuted,
                fontSize: compact ? textSize("micro") : textSize("caption"),
                fontFamily: T.sans,
                lineHeight: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "clip",
              }}
            >
              {summary.wins}W/{summary.losses}L
            </span>
          </button>
        </AppTooltip>
      );
    })}
  </div>
);

const CalendarSummary = ({ summary, currency, maskValues, calendarStyle, compact = false }) => {
  const total =
    summary.trades || summary.pnl !== 0
      ? formatAccountSignedMoney(summary.pnl, currency, true, maskValues)
      : "—";
  const totalTone =
    summary.trades || summary.pnl !== 0
      ? summary.pnl >= 0
        ? calendarStyle.positiveText
        : calendarStyle.negativeText
      : CSS_COLOR.textDim;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: sp(compact ? 0 : 1),
        fontSize: compact ? textSize("micro") : textSize("caption"),
        fontFamily: T.sans,
        color: calendarStyle.dayText,
        gap: sp(compact ? 2 : 4),
        flexWrap: "wrap",
      }}
    >
      <span>
        P&L{" "}
        <span style={{ color: totalTone, fontWeight: FONT_WEIGHTS.regular }}>
          {total}
        </span>
      </span>
      <span>
        <span style={{ color: calendarStyle.positiveText, fontWeight: FONT_WEIGHTS.regular }}>{summary.wins}W</span>
        <span style={{ margin: "0 3px", color: CSS_COLOR.textDim }}>/</span>
        <span style={{ color: calendarStyle.negativeText, fontWeight: FONT_WEIGHTS.regular }}>
          {summary.losses}L
        </span>
      </span>
      {compact ? null : (
        <>
          <span>
            BEST{" "}
            <span style={{ color: calendarStyle.positiveText, fontWeight: FONT_WEIGHTS.regular }}>
              {summary.best
                ? formatAccountSignedMoney(summary.best.pnl, currency, true, maskValues)
                : "—"}
            </span>
          </span>
          <span>
            WORST{" "}
            <span style={{ color: calendarStyle.negativeText, fontWeight: FONT_WEIGHTS.regular }}>
              {summary.worst
                ? formatAccountSignedMoney(summary.worst.pnl, currency, true, maskValues)
                : "—"}
            </span>
          </span>
        </>
      )}
    </div>
  );
};

const DailyPnlCalendar = ({
  trades = [],
  equityPoints = [],
  dailyPnl = null,
  currency,
  maskValues,
  isPhone = false,
}) => {
  const { theme } = useContext(ThemeContext);
  const calendarStyle = useMemo(() => calendarThemeStyle(), [theme]);
  const today = useLocalToday();
  const [view, setView] = useState("month");
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [visibleYear, setVisibleYear] = useState(() => today.getFullYear());
  const [hoveredDayIso, setHoveredDayIso] = useState(null);
  const [pinnedDayIso, setPinnedDayIso] = useState(null);
  const userSelectedCalendarRef = useRef(false);
  const latestActivityDate = useMemo(
    () => findLatestCalendarActivityDate({ trades, equityPoints }),
    [trades, equityPoints],
  );
  const monthModel = useMemo(
    () =>
      buildMonthPnlCalendarModel({
        trades,
        equityPoints,
        dailyPnl,
        monthDate: visibleMonth,
        today,
      }),
    [trades, equityPoints, dailyPnl, visibleMonth, today],
  );
  const yearModel = useMemo(
    () =>
      buildYearPnlCalendarModel({
        trades,
        equityPoints,
        dailyPnl,
        year: visibleYear,
        today,
      }),
    [trades, equityPoints, dailyPnl, visibleYear, today],
  );
  const activeLabel = view === "month" ? monthModel.label : yearModel.label;
  const activeSummary = view === "month" ? monthModel.summary : yearModel.summary;
  const activeDay = useMemo(
    () =>
      view === "month"
        ? resolveActivePnlCalendarDay({
            days: monthModel.days,
            hoveredDayIso,
            pinnedDayIso,
          })
        : null,
    [hoveredDayIso, monthModel.days, pinnedDayIso, view],
  );
  const activeDayIso = activeDay?.iso || null;
  useEffect(() => {
    if (!latestActivityDate || userSelectedCalendarRef.current) return;
    const latestMonth = new Date(
      latestActivityDate.getFullYear(),
      latestActivityDate.getMonth(),
      1,
    );
    setVisibleMonth((current) =>
      current.getFullYear() === latestMonth.getFullYear() &&
      current.getMonth() === latestMonth.getMonth()
        ? current
        : latestMonth,
    );
    setVisibleYear((current) =>
      current === latestActivityDate.getFullYear()
        ? current
        : latestActivityDate.getFullYear(),
    );
  }, [latestActivityDate]);
  const handleViewChange = (nextView) => {
    setHoveredDayIso(null);
    setPinnedDayIso(null);
    if (nextView === "year") {
      setVisibleYear(visibleMonth.getFullYear());
    } else {
      setVisibleMonth((current) => new Date(visibleYear, current.getMonth(), 1));
    }
    setView(nextView);
  };
  const shiftCalendar = (delta) => {
    userSelectedCalendarRef.current = true;
    setHoveredDayIso(null);
    setPinnedDayIso(null);
    if (view === "month") {
      setVisibleMonth((current) => addCalendarMonths(current, delta));
      return;
    }
    setVisibleYear((current) => current + delta);
  };
  const selectYearMonth = (date) => {
    userSelectedCalendarRef.current = true;
    setHoveredDayIso(null);
    setPinnedDayIso(null);
    setVisibleMonth(date);
    setVisibleYear(date.getFullYear());
    setView("month");
  };
  const pinDay = (iso) => {
    setPinnedDayIso((current) => (current === iso ? null : iso));
  };
  const periodLabel = (
    <span
      data-testid="account-pnl-calendar-period"
      style={{
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {activeLabel}
    </span>
  );

  return (
    <div
      className="ra-account-pnl-calendar-panel"
      data-testid="account-pnl-calendar"
      style={{ minWidth: 0 }}
    >
      <Panel
        title={isPhone ? "P&L" : "P&L Calendar"}
        rightRail={periodLabel}
        compact={isPhone}
        action={
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(isPhone ? 1 : 3),
              flexWrap: isPhone ? "nowrap" : "wrap",
              justifyContent: isPhone ? "space-between" : "flex-end",
              minWidth: 0,
            }}
          >
            <CalendarViewToggle
              value={view}
              onChange={handleViewChange}
              calendarStyle={calendarStyle}
              compact={isPhone}
            />
            <span style={{ display: "inline-flex", gap: sp(1), flexShrink: 0 }}>
              <CalendarNavButton
                label="Previous period"
                onClick={() => shiftCalendar(-1)}
                calendarStyle={calendarStyle}
                isPhone={isPhone}
                compact={isPhone}
              >
                <ChevronLeft size={dim(isPhone ? 11 : 14)} strokeWidth={2.3} />
              </CalendarNavButton>
              <CalendarNavButton
                label="Next period"
                onClick={() => shiftCalendar(1)}
                calendarStyle={calendarStyle}
                isPhone={isPhone}
                compact={isPhone}
              >
                <ChevronRight size={dim(isPhone ? 11 : 14)} strokeWidth={2.3} />
              </CalendarNavButton>
            </span>
          </div>
        }
      >
        <div
          onPointerLeave={() => setHoveredDayIso(null)}
          style={{ display: "grid", gap: sp(isPhone ? 1 : 2), minWidth: 0 }}
        >
          {view === "month" ? (
            <MonthCalendarGrid
              model={monthModel}
              currency={currency}
              maskValues={maskValues}
              calendarStyle={calendarStyle}
              activeDayIso={activeDayIso}
              pinnedDayIso={pinnedDayIso}
              onHoverDay={setHoveredDayIso}
              onClearHoverDay={() => setHoveredDayIso(null)}
              onPinDay={pinDay}
              isPhone={isPhone}
              compact={isPhone}
            />
          ) : (
            <YearCalendarGrid
              model={yearModel}
              currency={currency}
              maskValues={maskValues}
              onSelectMonth={selectYearMonth}
              calendarStyle={calendarStyle}
              isPhone={isPhone}
              compact={isPhone}
            />
          )}
          {view === "month" && !isPhone ? (
            <CalendarDayDetail
              day={activeDay}
              currency={currency}
              maskValues={maskValues}
              calendarStyle={calendarStyle}
            />
          ) : null}
          <CalendarSummary
            summary={activeSummary}
            currency={currency}
            maskValues={maskValues}
            calendarStyle={calendarStyle}
            compact={isPhone}
          />
        </div>
      </Panel>
    </div>
  );
};

export const AccountReturnsPanel = ({
  currency,
  maskValues = false,
  isPhone = false,
  tradesData = null,
  equityPoints = null,
  dailyPnl = null,
}) => (
  <DailyPnlCalendar
    trades={tradesData?.trades || []}
    equityPoints={equityPoints || []}
    dailyPnl={dailyPnl}
    currency={currency}
    maskValues={maskValues}
    isPhone={isPhone}
  />
);

export default AccountReturnsPanel;
