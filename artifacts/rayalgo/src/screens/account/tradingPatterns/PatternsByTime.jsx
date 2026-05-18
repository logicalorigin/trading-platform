import { useMemo } from "react";
import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import { formatAppDateTime } from "../../../lib/timeZone";
import {
  formatAccountMoney,
  formatAccountSignedMoney,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";
import { AppTooltip } from "@/components/ui/tooltip";
import { arrayValue, finiteNumber, isoWeekKey, startOfIsoWeek } from "./patternsCommon";

const WEEKS_TO_RENDER = 12;

const WeeklyPnlBars = ({ trades = [], currency, maskValues }) => {
  const weeks = useMemo(() => {
    const byWeek = new Map();
    (trades || []).forEach((trade) => {
      const closeAt = startOfIsoWeek(trade?.closeDate);
      if (!closeAt) return;
      const pnl = finiteNumber(trade?.realizedPnl);
      if (pnl == null) return;
      const key = isoWeekKey(closeAt);
      const current = byWeek.get(key) || { iso: key, weekStart: closeAt, pnl: 0, trades: 0 };
      current.pnl += pnl;
      current.trades += 1;
      byWeek.set(key, current);
    });
    const today = startOfIsoWeek(new Date());
    if (!today) return [];
    const out = [];
    const cursor = new Date(today);
    for (let i = 0; i < WEEKS_TO_RENDER; i += 1) {
      const key = isoWeekKey(cursor);
      const entry = byWeek.get(key);
      out.unshift(entry || { iso: key, weekStart: new Date(cursor), pnl: 0, trades: 0 });
      cursor.setDate(cursor.getDate() - 7);
    }
    return out;
  }, [trades]);

  const totalTradedWeeks = weeks.filter((w) => w.trades > 0).length;
  if (!totalTradedWeeks) return null;

  const totalPnl = weeks.reduce((s, w) => s + w.pnl, 0);
  const maxAbsPnl = weeks.reduce(
    (m, w) => (Math.abs(w.pnl) > m ? Math.abs(w.pnl) : m),
    0,
  );
  const flatPnl = maxAbsPnl === 0;
  const maxAbs = flatPnl
    ? weeks.reduce((m, w) => (w.trades > m ? w.trades : m), 0) || 1
    : maxAbsPnl;
  const rollingExpectancy = weeks.map((_, idx) => {
    const window = weeks.slice(Math.max(0, idx - 3), idx + 1);
    const tradeCount = window.reduce((sum, w) => sum + w.trades, 0);
    if (!tradeCount) return null;
    const pnlSum = window.reduce((sum, w) => sum + w.pnl, 0);
    return pnlSum / tradeCount;
  });
  const expectancyExtent = rollingExpectancy.reduce(
    (m, v) => (v != null && Math.abs(v) > m ? Math.abs(v) : m),
    0,
  ) || 1;

  const W = 600;
  const H = 100;
  const padT = 6;
  const padB = 16;
  const padX = 6;
  const chartW = W - padX * 2;
  const chartH = H - padT - padB;
  const zeroY = padT + chartH / 2;
  const colWidth = chartW / weeks.length;
  const expectancyPoints = rollingExpectancy
    .map((value, idx) => {
      if (value == null) return null;
      const cx = padX + colWidth * (idx + 0.5);
      const cy = zeroY - (value / expectancyExtent) * (chartH / 2 - 2);
      return [cx, cy];
    })
    .filter(Boolean);
  const expectancyPath = expectancyPoints
    .map(([cx, cy], idx) => `${idx === 0 ? "M" : "L"}${cx.toFixed(1)},${cy.toFixed(1)}`)
    .join(" ");

  return (
    <div
      style={{
        display: "grid",
        gap: sp(3),
        border: "none",
        borderRadius: dim(RADII.md),
        background: T.bg1,
        padding: sp("8px 10px"),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: sp(4),
          flexWrap: "wrap",
        }}
      >
        <div style={mutedLabelStyle}>WEEKLY P&L · LAST {WEEKS_TO_RENDER}W</div>
        <div style={{ fontSize: textSize("label"), fontFamily: T.data, color: T.textDim }}>
          {totalTradedWeeks}/{WEEKS_TO_RENDER} traded ·{" "}
          <span style={{ color: toneForValue(totalPnl), fontWeight: FONT_WEIGHTS.regular }}>
            {formatAccountSignedMoney(totalPnl, currency, true, maskValues)}
          </span>
        </div>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <line
          x1={padX}
          x2={W - padX}
          y1={zeroY}
          y2={zeroY}
          stroke={T.border}
          strokeWidth={0.5}
          strokeDasharray="2 2"
        />
        {weeks.map((week, idx) => {
          if (!week.trades) return null;
          const halfChart = chartH / 2 - 2;
          const magnitude = flatPnl ? week.trades : Math.abs(week.pnl);
          const barHeight = Math.max(2, (magnitude / maxAbs) * halfChart);
          const x = padX + colWidth * idx + colWidth * 0.15;
          const w = Math.max(2, colWidth * 0.7);
          const positive = flatPnl ? true : week.pnl >= 0;
          const fill = flatPnl ? T.cyan : positive ? T.green : T.red;
          const y = positive ? zeroY - barHeight : zeroY;
          return (
            <g key={week.iso}>
              <title>
                {`${week.iso} · ${formatAccountSignedMoney(week.pnl, currency, true, maskValues)} · ${week.trades} trades`}
              </title>
              <rect
                x={x}
                y={y}
                width={w}
                height={barHeight}
                fill={fill}
                opacity={0.85}
                rx={1}
              />
            </g>
          );
        })}
        {expectancyPath && !flatPnl ? (
          <path d={expectancyPath} fill="none" stroke={T.cyan} strokeWidth={1.2} opacity={0.85} />
        ) : null}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: sp(4),
          fontSize: textSize("tableHeader"),
          fontFamily: T.sans,
          color: T.textMuted,
        }}
      >
        <span style={{ fontFamily: T.data }}>{formatAppDateTime(weeks[0].weekStart).slice(0, 10)}</span>
        <span style={{ color: T.cyan }}>
          {flatPnl ? "trade count (no realized P&L)" : "4w rolling expectancy"}
        </span>
        <span style={{ fontFamily: T.data }}>{formatAppDateTime(weeks[weeks.length - 1].weekStart).slice(0, 10)}</span>
      </div>
    </div>
  );
};

const CloseHourHeat = ({ hourRows, currency, maskValues, selectedCloseHour, onLensChange }) => {
  if (!hourRows?.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <div style={mutedLabelStyle}>CLOSE HOUR HEAT</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: sp(2) }}>
        {hourRows.map((row) => (
          <AppTooltip key={row.hour} content={`${row.hour}:00 ${formatAccountMoney(row.realizedPnl, currency, true, maskValues)}`}>
            <button
              type="button"
              onClick={() => onLensChange?.("hour", row)}
              className="ra-interactive"
              style={{
                minHeight: dim(22),
                border: `1px solid ${
                  selectedCloseHour === row.hour
                    ? T.cyan
                    : (row.realizedPnl ?? 0) >= 0
                      ? `${T.green}55`
                      : `${T.red}55`
                }`,
                borderRadius: dim(3),
                background:
                  selectedCloseHour === row.hour
                    ? `${T.cyan}18`
                    : (row.realizedPnl ?? 0) >= 0
                      ? `${T.green}18`
                      : `${T.red}18`,
                color: (row.realizedPnl ?? 0) >= 0 ? T.green : T.red,
                display: "grid",
                placeItems: "center",
                fontFamily: T.data,
                fontSize: textSize("label"),
                fontWeight: FONT_WEIGHTS.regular,
                cursor: "pointer",
              }}
            >
              {row.hour}
            </button>
          </AppTooltip>
        ))}
      </div>
    </div>
  );
};

export const PatternsByTime = ({
  trades,
  timeStats,
  currency,
  maskValues,
  selectedLens,
  onLensChange,
}) => {
  const hourRows = arrayValue(timeStats?.byHour).map((row) => ({ ...row, label: row.hour }));
  const selectedCloseHour = selectedLens?.closeHour ?? null;
  return (
    <div style={{ display: "grid", gap: sp(5) }}>
      <WeeklyPnlBars trades={arrayValue(trades)} currency={currency} maskValues={maskValues} />
      <CloseHourHeat
        hourRows={hourRows}
        currency={currency}
        maskValues={maskValues}
        selectedCloseHour={selectedCloseHour}
        onLensChange={onLensChange}
      />
    </div>
  );
};

export default PatternsByTime;
