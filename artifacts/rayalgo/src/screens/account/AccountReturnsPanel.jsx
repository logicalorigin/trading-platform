import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ThemeContext } from "../../features/platform/platformContexts";
import { FONT_WEIGHTS, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
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
    gridLine: T.borderLight,
    neutralBg: T.bg1,
    mutedNeutralBg: `${T.border}44`,
    dayText: T.textSec,
    mutedDayText: T.textMuted,
    zeroValueText: "transparent",
    positive: `${T.green}24`,
    negative: `${T.red}24`,
    positiveText: T.green,
    negativeText: T.red,
    activeText: T.text,
    activeDayText: T.text,
    shadow: "none",
    border: T.border,
    navBg: T.bg2,
    navText: T.textSec,
  };
};

const calendarButtonStyle = (style, isPhone = false) => ({
  width: dim(isPhone ? 32 : 24),
  height: dim(isPhone ? 32 : 24),
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

const dayTooltip = (day, currency, maskValues) => {
  const pnlFmt = formatAccountSignedMoney(day.pnl || 0, currency, true, maskValues);
  const realFmt = formatAccountSignedMoney(day.realized || 0, currency, true, maskValues);
  const totalFmt = calendarMoneyOrDash(day.total, currency, maskValues);
  const unrealFmt = calendarMoneyOrDash(day.unrealized, currency, maskValues);
  const source = day.pnlSource === "total" ? "NAV total" : "realized fallback";
  return [
    day.iso,
    `P&L ${pnlFmt} (${source})`,
    `Total ${totalFmt}`,
    `Realized ${realFmt}`,
    `Unrealized ${unrealFmt}`,
    `${day.trades} trade${day.trades === 1 ? "" : "s"}`,
  ].join("\n");
};

const CalendarNavButton = ({ label, onClick, children, calendarStyle, isPhone = false }) => (
  <AppTooltip content={label}>
    <button
      type="button"
      className="ra-interactive"
      aria-label={label}
      onClick={onClick}
      style={calendarButtonStyle(calendarStyle, isPhone)}
    >
      {children}
    </button>
  </AppTooltip>
);

const MonthCalendarGrid = ({ model, currency, maskValues, calendarStyle, isPhone = false }) => (
  <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gap: sp(isPhone ? 1 : 2),
      }}
    >
      {PNL_CALENDAR_WEEKDAYS.map((day) => (
        <div
          key={day}
          style={{
            color: T.textMuted,
            fontSize: fs(isPhone ? 7 : 8),
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.medium,
            letterSpacing: "0.04em",
            lineHeight: 1,
            textAlign: "center",
            padding: sp("1px 0 4px"),
          }}
        >
          {day}
        </div>
      ))}
    </div>
    <div
      data-testid="account-pnl-calendar-month-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gap: sp(1),
        background: calendarStyle.gridLine,
        borderRadius: dim(RADII.xs),
        overflow: "hidden",
      }}
    >
      {model.days.map((day) => {
        const dayNumber = String(day.date.getDate());
        const displayPnl = day.inMonth ? day.pnl : 0;
        const tone = calendarCellTone(
          displayPnl,
          !day.inMonth,
          calendarStyle,
        );
        return (
          <AppTooltip key={day.iso} content={dayTooltip(day, currency, maskValues)}>
            <div
              style={{
                minWidth: 0,
                minHeight: dim(isPhone ? 32 : 44),
                display: "grid",
                gridTemplateRows: "auto minmax(0, 1fr)",
                alignItems: "stretch",
                gap: sp(isPhone ? 1 : 3),
                padding: sp(isPhone ? "4px 3px 3px" : "5px 5px 4px"),
                border: `1px solid ${tone.borderColor}`,
                borderRadius: dim(RADII.xs),
                background: tone.background,
                boxShadow: tone.boxShadow,
                opacity: day.inMonth ? 1 : 0.5,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  color: tone.dayColor,
                  fontSize: fs(isPhone ? 7 : 9),
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
                  color: tone.color,
                  fontSize: fs(isPhone ? 8 : 10),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.medium,
                  lineHeight: 1,
                  textAlign: "center",
                  alignSelf: "end",
                  justifySelf: "center",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  minHeight: dim(10),
                  overflow: "hidden",
                  textOverflow: "clip",
                }}
              >
                {formatCalendarCellValue(displayPnl, maskValues)}
              </div>
            </div>
          </AppTooltip>
        );
      })}
    </div>
  </div>
);

const YearCalendarGrid = ({
  model,
  currency,
  maskValues,
  onSelectMonth,
  calendarStyle,
  isPhone = false,
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
              minHeight: dim(isPhone ? 38 : 43),
              display: "grid",
              alignContent: "center",
              gap: sp(2),
              padding: sp("4px 3px"),
              border: `1px solid ${
                month.isCurrentMonth ? calendarStyle.border : tone.borderColor
              }`,
              borderRadius: dim(RADII.xs),
              background: tone.background,
              color: T.textSec,
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
                      ? T.text
                      : T.textSec,
                fontSize: fs(isPhone ? 8 : 9),
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
                fontSize: fs(isPhone ? 8 : 10),
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
                color: T.textMuted,
                fontSize: textSize("caption"),
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

const CalendarSummary = ({ summary, currency, maskValues, calendarStyle }) => {
  const total =
    summary.trades || summary.pnl !== 0
      ? formatAccountSignedMoney(summary.pnl, currency, true, maskValues)
      : "—";
  const totalTone =
    summary.trades || summary.pnl !== 0
      ? summary.pnl >= 0
        ? calendarStyle.positiveText
        : calendarStyle.negativeText
      : T.textDim;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: sp(1),
        fontSize: textSize("caption"),
        fontFamily: T.sans,
        color: calendarStyle.dayText,
        gap: sp(4),
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
        <span style={{ margin: "0 3px", color: T.textDim }}>/</span>
        <span style={{ color: calendarStyle.negativeText, fontWeight: FONT_WEIGHTS.regular }}>
          {summary.losses}L
        </span>
      </span>
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
    </div>
  );
};

const DailyPnlCalendar = ({
  trades = [],
  equityPoints = [],
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
        monthDate: visibleMonth,
        today,
      }),
    [trades, equityPoints, visibleMonth, today],
  );
  const yearModel = useMemo(
    () =>
      buildYearPnlCalendarModel({
        trades,
        equityPoints,
        year: visibleYear,
        today,
      }),
    [trades, equityPoints, visibleYear, today],
  );
  const activeLabel = view === "month" ? monthModel.label : yearModel.label;
  const activeSummary = view === "month" ? monthModel.summary : yearModel.summary;
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
    if (nextView === "year") {
      setVisibleYear(visibleMonth.getFullYear());
    } else {
      setVisibleMonth((current) => new Date(visibleYear, current.getMonth(), 1));
    }
    setView(nextView);
  };
  const shiftCalendar = (delta) => {
    userSelectedCalendarRef.current = true;
    if (view === "month") {
      setVisibleMonth((current) => addCalendarMonths(current, delta));
      return;
    }
    setVisibleYear((current) => current + delta);
  };
  const selectYearMonth = (date) => {
    userSelectedCalendarRef.current = true;
    setVisibleMonth(date);
    setVisibleYear(date.getFullYear());
    setView("month");
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
        title="P&L Calendar"
        rightRail={periodLabel}
        action={
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(3),
              flexWrap: "wrap",
              justifyContent: isPhone ? "space-between" : "flex-end",
              minWidth: 0,
            }}
          >
            <ToggleGroup options={CALENDAR_VIEW_OPTIONS} value={view} onChange={handleViewChange} />
            <span style={{ display: "inline-flex", gap: sp(1) }}>
              <CalendarNavButton
                label="Previous period"
                onClick={() => shiftCalendar(-1)}
                calendarStyle={calendarStyle}
                isPhone={isPhone}
              >
                <ChevronLeft size={dim(14)} strokeWidth={2.3} />
              </CalendarNavButton>
              <CalendarNavButton
                label="Next period"
                onClick={() => shiftCalendar(1)}
                calendarStyle={calendarStyle}
                isPhone={isPhone}
              >
                <ChevronRight size={dim(14)} strokeWidth={2.3} />
              </CalendarNavButton>
            </span>
          </div>
        }
      >
        <div style={{ display: "grid", gap: sp(2), minWidth: 0 }}>
          {view === "month" ? (
            <MonthCalendarGrid
              model={monthModel}
              currency={currency}
              maskValues={maskValues}
              calendarStyle={calendarStyle}
              isPhone={isPhone}
            />
          ) : (
            <YearCalendarGrid
              model={yearModel}
              currency={currency}
              maskValues={maskValues}
              onSelectMonth={selectYearMonth}
              calendarStyle={calendarStyle}
              isPhone={isPhone}
            />
          )}
          <CalendarSummary
            summary={activeSummary}
            currency={currency}
            maskValues={maskValues}
            calendarStyle={calendarStyle}
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
}) => (
  <DailyPnlCalendar
    trades={tradesData?.trades || []}
    equityPoints={equityPoints || []}
    currency={currency}
    maskValues={maskValues}
    isPhone={isPhone}
  />
);

export default AccountReturnsPanel;
