import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ThemeContext } from "../../features/platform/platformContexts";
import { FONT_WEIGHTS, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  ToggleGroup,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  formatNumber,
  mutedLabelStyle,
  panelStyle,
  toneForValue,
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


const formatSignedPercent = (value, digits = 2, maskValues = false) => {
  if (maskValues) return "****";
  if (value == null || Number.isNaN(Number(value))) return "—";
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
};

const formatRatio = (value, digits = 2, maskValues = false) => {
  if (maskValues) return "****";
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}x`;
};

const metricTone = (value, fallback = T.textDim) =>
  value == null || Number.isNaN(Number(value)) ? fallback : toneForValue(value);

const labelCapsStyle = {
  color: T.textMuted,
  fontSize: textSize("caption"),
  fontFamily: T.sans,
  fontWeight: FONT_WEIGHTS.regular,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  lineHeight: 1.25,
};

const MetricCell = ({ label, value, tone = T.text, title }) => (
  <AppTooltip content={title}><div
    style={{
      minWidth: 0,
      display: "grid",
      gridTemplateColumns: `minmax(${dim(42)}px, auto) minmax(0, 1fr)`,
      alignItems: "baseline",
      columnGap: sp(6),
      minHeight: dim(18),
      padding: sp("2px 0"),
      borderTop: `1px solid ${T.border}`,
      overflow: "hidden",
    }}
  >
    <span
      style={{
        ...labelCapsStyle,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
    <span
      style={{
        minWidth: 0,
        color: tone,
        fontSize: textSize("body"),
        fontFamily: T.sans,
        fontWeight: FONT_WEIGHTS.regular,
        lineHeight: 1.25,
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {value}
    </span>
  </div></AppTooltip>
);

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
    gridLine: T.border,
    neutralBg: T.bg1,
    mutedNeutralBg: `${T.border}66`,
    dayText: T.textSec,
    mutedDayText: T.textMuted,
    zeroValueText: "transparent",
    positive: T.greenBg,
    negative: T.redBg,
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
      color: style.activeText,
      dayColor: style.activeDayText,
      borderColor: "transparent",
      boxShadow: style.shadow,
    };
  }
  if (numeric < 0) {
    return {
      background: style.negative,
      color: style.activeText,
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
            fontSize: fs(isPhone ? 6 : 7),
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.regular,
            lineHeight: 1,
            textAlign: "center",
            padding: sp("1px 0 3px"),
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
                minHeight: dim(isPhone ? 28 : 38),
                display: "grid",
                gridTemplateRows: "auto minmax(0, 1fr)",
                alignItems: "stretch",
                gap: sp(isPhone ? 1 : 2),
                padding: sp(isPhone ? "3px 2px 2px" : "4px 4px 3px"),
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
                  fontSize: fs(isPhone ? 6 : 7),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.medium,
                  lineHeight: 1,
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
                  fontSize: fs(isPhone ? 7 : 8),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.regular,
                  lineHeight: 1,
                  textAlign: "center",
                  alignSelf: "end",
                  justifySelf: "center",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  minHeight: dim(9),
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
              borderRadius: RADII.none,
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
                fontSize: fs(isPhone ? 7 : 8),
                fontFamily: T.sans,
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
                fontSize: fs(isPhone ? 7 : 8),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.regular,
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

  return (
    <div data-testid="account-pnl-calendar" style={{ display: "grid", gap: sp(2), minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: isPhone ? "stretch" : "center",
          gap: sp(4),
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <div style={{ minWidth: 0, display: "grid", gap: sp(2) }}>
          <span style={mutedLabelStyle}>P&L Calendar</span>
          <span
            style={{
              color: T.text,
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {activeLabel}
          </span>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            flexWrap: "wrap",
            justifyContent: isPhone ? "space-between" : "flex-end",
            flex: isPhone ? "1 1 100%" : undefined,
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
      </div>
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
  );
};

export const AccountReturnsPanel = ({
  model,
  currency,
  range,
  maskValues = false,
  compact = false,
  isPhone = false,
  tradesData = null,
  equityPoints = null,
}) => {
  const equity = model?.equity || {};
  const trades = model?.trades || {};
  const positions = model?.positions || {};
  const cash = model?.cash || {};
  const risk = model?.risk || {};
  const hasRiskStats = model?.available?.hasRiskAdjustedStats;
  const transferAdjustedPnl = equity.transferAdjustedPnl ?? null;
  const returnTooltip = equity.returnPercentDiscrepancy
    ? `Transfer-adjusted return over the selected range. API value ${formatSignedPercent(
        equity.providerReturnPercent,
        2,
        maskValues,
      )} differed from recomputed value, so the recomputed value is shown.`
    : "Transfer-adjusted return over the selected equity range. External deposits and withdrawals are excluded.";

  const metrics = [
    {
      label: "Trades",
      value: formatNumber(trades.count, 0),
      tone: T.text,
      title: `${formatNumber(trades.winners, 0)} winners / ${formatNumber(
        trades.losers,
        0,
      )} losers`,
    },
    {
      label: "Real",
      value: formatAccountSignedMoney(trades.realizedPnl, currency, true, maskValues),
      tone: metricTone(trades.realizedPnl),
      title: "Realized P&L over the selected closed-trade range.",
    },
    {
      label: "Open",
      value: formatAccountSignedMoney(positions.unrealizedPnl, currency, true, maskValues),
      tone: metricTone(positions.unrealizedPnl),
      title: `${formatNumber(positions.count, 0)} current positions`,
    },
    {
      label: "Win",
      value: formatAccountPercent(trades.winRate, 0, maskValues),
      tone:
        trades.winRate == null || Number.isNaN(Number(trades.winRate))
          ? T.textDim
          : trades.winRate >= 50
            ? T.green
            : T.amber,
      title: `${formatNumber(trades.winners, 0)} winners / ${formatNumber(
        trades.losers,
        0,
      )} losers`,
    },
    {
      label: "PF",
      value: formatRatio(trades.profitFactor, 2, maskValues),
      tone:
        trades.profitFactor == null || Number.isNaN(Number(trades.profitFactor))
          ? T.textDim
          : trades.profitFactor >= 1
            ? T.green
            : T.red,
      title: "Gross profit divided by gross loss.",
    },
    {
      label: "Exp",
      value: formatAccountSignedMoney(trades.expectancy, currency, true, maskValues),
      tone: metricTone(trades.expectancy),
      title: "Average realized P&L per closed trade.",
    },
    {
      label: "MaxDD",
      value: formatSignedPercent(equity.maxDrawdownPercent, 1, maskValues),
      tone: metricTone(equity.maxDrawdownPercent),
      title: formatAccountSignedMoney(
        equity.maxDrawdownAmount,
        currency,
        true,
        maskValues,
      ),
    },
    {
      label: "CurDD",
      value: formatSignedPercent(equity.currentDrawdownPercent, 1, maskValues),
      tone: metricTone(equity.currentDrawdownPercent),
      title: formatAccountSignedMoney(
        equity.currentDrawdownAmount,
        currency,
        true,
        maskValues,
      ),
    },
    ...(hasRiskStats
      ? [
          {
            label: "Vol",
            value: formatAccountPercent(risk.volatilityPercent, 1, maskValues),
            tone: T.text,
            title:
              "Sample standard deviation of point-to-point account equity returns over the selected range, not annualized.",
          },
          {
            label: "Sharpe",
            value: formatRatio(risk.sharpeLike, 2, maskValues),
            tone: metricTone(risk.sharpeLike),
            title:
              "Informational ratio using range point returns and zero risk-free rate. It is not a formal TWR/MWR performance report.",
          },
          {
            label: "Sort",
            value: formatRatio(risk.sortinoLike, 2, maskValues),
            tone: metricTone(risk.sortinoLike),
            title: "Informational downside-risk ratio using range point returns.",
          },
        ]
      : []),
    {
      label: "Fees",
      value: formatAccountMoney(cash.feesYtd, currency, true, maskValues),
      tone: T.amber,
      title: "Year-to-date fees and commissions from account cash activity.",
    },
    {
      label: "Div",
      value: formatAccountMoney(cash.dividendsYtd, currency, true, maskValues),
      tone: T.green,
      title: "Year-to-date dividends.",
    },
    {
      label: "Int",
      value: formatAccountMoney(cash.interestYtd, currency, true, maskValues),
      tone: T.green,
      title: "Year-to-date interest paid or earned.",
    },
  ];
  return (
    <section
      tabIndex={0}
      className="ra-panel-enter"
      style={{
        ...panelStyle,
        minHeight: dim(54),
        display: "grid",
        gap: sp(compact ? 2 : 3),
        padding: compact ? sp("4px 7px") : sp("5px 9px"),
        overflow: "hidden",
        outline: "none",
      }}
    >
      <header
        style={{
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "start",
          gap: sp(8),
        }}
      >
        <div style={{ minWidth: 0, display: "grid", gap: sp(2) }}>
          <AppTooltip content={returnTooltip}><div style={labelCapsStyle}>
            Adj return · {range || model?.range || "Range"}
          </div></AppTooltip>
          <AppTooltip content={returnTooltip}><div
            style={{
              color: metricTone(equity.returnPercent),
              fontSize: fs(compact ? 15 : 17),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {formatSignedPercent(equity.returnPercent, 2, maskValues)}
          </div></AppTooltip>
        </div>
        <div style={{ minWidth: 0, display: "grid", gap: sp(2), textAlign: "right" }}>
          <div style={labelCapsStyle}>
            P&L Δ
          </div>
          <AppTooltip content="Transfer-adjusted P&L over the selected equity range. External deposits and withdrawals are excluded."><div
            style={{
              color: metricTone(transferAdjustedPnl),
              fontSize: fs(compact ? 10 : 11),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              lineHeight: 1.2,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {formatAccountSignedMoney(transferAdjustedPnl, currency, true, maskValues)}
          </div></AppTooltip>
        </div>
      </header>

      <DailyPnlCalendar
        trades={tradesData?.trades || []}
        equityPoints={equityPoints || []}
        currency={currency}
        maskValues={maskValues}
        isPhone={isPhone}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          columnGap: sp(8),
          rowGap: sp(3),
          minWidth: 0,
        }}
      >
        {metrics.map((metric) => (
          <MetricCell key={metric.label} {...metric} />
        ))}
      </div>
    </section>
  );
};

export default AccountReturnsPanel;
