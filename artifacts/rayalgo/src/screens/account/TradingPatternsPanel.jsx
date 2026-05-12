import { useMemo, useState } from "react";
import { T, dim, sp, textSize } from "../../lib/uiTokens";
import { formatAppDateTime } from "../../lib/timeZone";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  formatNumber,
  mutedLabelStyle,
  secondaryButtonStyle,
  toneForValue,
} from "./accountUtils";
import { buildTradeOutcomeHistogramModel } from "./tradeOutcomeHistogramModel";
import { AppTooltip } from "@/components/ui/tooltip";


const SORT_OPTIONS = [
  { value: "realizedPnl", label: "P&L" },
  { value: "expectancy", label: "Exp" },
  { value: "winRatePercent", label: "Win" },
  { value: "closedTrades", label: "Trades" },
];

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const arrayValue = (value) => (Array.isArray(value) ? value : []);

const PatternMetric = ({ label, value, tone = T.text }) => (
  <div
    style={{
      border: `1px solid ${T.border}`,
      borderRadius: dim(4),
      background: T.bg0,
      padding: sp("5px 6px"),
      minWidth: 0,
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div
      style={{
        color: tone,
        fontFamily: T.data,
        fontWeight: 400,
        fontSize: textSize("metric"),
        lineHeight: 1.15,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </div>
  </div>
);

const toneColor = (tone) =>
  tone === "green"
    ? T.green
    : tone === "red"
      ? T.red
      : tone === "amber"
        ? T.amber
        : tone === "cyan"
          ? T.cyan
          : tone === "pink"
            ? T.pink
            : T.textSec;

const AnalysisCard = ({
  card,
  currency,
  maskValues,
  onActivate,
}) => {
  if (!card) return null;
  const color = toneColor(card.tone);
  const disabled = card.disabled || !card.tradeId;
  return (
    <button
      type="button"
      className="ra-interactive"
      disabled={disabled}
      onClick={() => onActivate?.(card)}
      style={{
        border: `1px solid ${color}55`,
        borderRadius: dim(5),
        background: `${color}12`,
        padding: sp("6px 7px"),
        textAlign: "left",
        display: "grid",
        gap: sp(3),
        color: T.textSec,
        minWidth: 0,
        opacity: disabled ? 0.76 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: sp(6),
          alignItems: "center",
        }}
      >
        <span
          style={{
            color,
            fontFamily: T.data,
            fontWeight: 400,
            fontSize: textSize("control"),
            textTransform: "uppercase",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {card.label}
        </span>
        <span style={{ color: toneForValue(card.value), fontFamily: T.data, fontWeight: 400 }}>
          {formatAccountMoney(card.value, currency, true, maskValues)}
        </span>
      </div>
      <div style={{ fontSize: textSize("caption"), lineHeight: 1.3 }}>
        {card.symbol ? `${card.symbol} · ` : ""}
        {card.description}
      </div>
      {card.meta ? (
        <div style={{ color: T.textDim, fontFamily: T.data, fontSize: textSize("label") }}>
          {formatNumber(card.meta.count || 0, 0)} trades ·{" "}
          {formatAccountPercent(card.meta.winRatePercent, 0, maskValues)}
        </div>
      ) : disabled ? (
        <div style={{ color: T.textDim, fontFamily: T.data, fontSize: textSize("label") }}>
          Waiting for ledger data
        </div>
      ) : null}
    </button>
  );
};

const readinessTone = (state) =>
  state === "ready" ? T.green : state === "waiting" ? T.amber : T.textDim;

const AnalysisReadinessStrip = ({ readiness = [] }) => {
  const rows = arrayValue(readiness);
  if (!rows.length) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
        gap: sp(4),
      }}
    >
      {rows.map((row) => {
        const color = readinessTone(row.state);
        return (
          <div
            key={row.key}
            style={{
              border: `1px solid ${color}44`,
              borderRadius: dim(4),
              background: `${color}0f`,
              padding: sp("4px 5px"),
              display: "grid",
              gap: sp(1),
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(5),
                minWidth: 0,
              }}
            >
              <span style={{ ...mutedLabelStyle, color }}>{row.label}</span>
              <span style={{ color, fontFamily: T.data, fontSize: textSize("label"), fontWeight: 400 }}>
                {formatNumber(row.value || 0, 0)}
              </span>
            </div>
            <div
              style={{
                color: T.textDim,
                fontFamily: T.data,
                fontSize: textSize("label"),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.detail}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const lensInputForBucket = (group) => {
  if (!group) return {};
  if (group.kind === "side") return { side: group.key };
  if (group.kind === "holdDuration") return { holdDuration: group.key };
  if (group.kind === "feeDrag") return { feeDrag: group.key };
  if (group.kind === "strategy") return { strategy: group.key, label: group.label };
  if (group.kind === "assetClass") return { assetClass: group.key };
  return {};
};

const lensMatchesBucket = (lens, group) => {
  if (!lens || !group || lens.kind !== group.kind) return false;
  if (group.kind === "side") return lens.side === group.key;
  if (group.kind === "holdDuration") return lens.holdDuration === group.key;
  if (group.kind === "feeDrag") return lens.feeDrag === group.key;
  if (group.kind === "strategy") return lens.strategy === group.key;
  if (group.kind === "assetClass") return lens.assetClass === group.key;
  return false;
};

const BucketDrilldownStrip = ({
  groups = [],
  currency,
  maskValues,
  selectedLens,
  onLensChange,
}) => {
  const rows = arrayValue(groups).filter((group) => group?.count).slice(0, 8);
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <div style={mutedLabelStyle}>BUCKET DRILLDOWN</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: sp(4),
        }}
      >
        {rows.map((group) => {
          const active = lensMatchesBucket(selectedLens, group);
          const pnlTone = toneForValue(group.realizedPnl);
          return (
            <button
              type="button"
              key={`${group.kind}:${group.key}`}
              className="ra-interactive"
              onClick={() => onLensChange?.(group.kind, lensInputForBucket(group))}
              style={{
                border: `1px solid ${active ? T.cyan : T.border}`,
                borderRadius: dim(4),
                background: active ? `${T.cyan}14` : T.bg0,
                padding: sp("5px 6px"),
                display: "grid",
                gap: sp(2),
                minWidth: 0,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: sp(5),
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: active ? T.cyan : T.text,
                    fontFamily: T.data,
                    fontSize: textSize("control"),
                    fontWeight: 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {group.label}
                </span>
                <span style={{ color: pnlTone, fontFamily: T.data, fontSize: textSize("label"), fontWeight: 400 }}>
                  {formatAccountMoney(group.realizedPnl, currency, true, maskValues)}
                </span>
              </div>
              <div style={{ color: T.textDim, fontFamily: T.data, fontSize: textSize("label") }}>
                {formatNumber(group.count, 0)} trades ·{" "}
                {formatAccountPercent(group.winRatePercent, 0, maskValues)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const OutcomeBreakdownRows = ({ title, groups = [], currency, maskValues }) => {
  const rows = arrayValue(groups).filter((group) => group?.count).slice(0, 6);
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
      <div style={mutedLabelStyle}>{title}</div>
      <div style={{ display: "grid", gap: sp(2) }}>
        {rows.map((row) => (
          <div
            key={`${title}:${row.kind}:${row.key}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto auto",
              gap: sp(5),
              alignItems: "center",
              border: `1px solid ${T.border}`,
              borderRadius: dim(4),
              background: T.bg0,
              padding: sp("4px 5px"),
              fontFamily: T.data,
              fontSize: textSize("label"),
            }}
          >
            <span style={{ color: T.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.label}
            </span>
            <span style={{ color: toneForValue(row.realizedPnl), fontWeight: 400 }}>
              {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
            </span>
            <span style={{ color: T.textDim, textAlign: "right" }}>
              {formatNumber(row.count || 0, 0)} · {formatAccountPercent(row.winRatePercent, 0, maskValues)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const StopScenarioRows = ({ scenarios = [], currency, maskValues }) => {
  const rows = arrayValue(scenarios).slice(0, 5);
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
      <div style={mutedLabelStyle}>STOP SCENARIO VARIANCE</div>
      <div className="ra-hide-scrollbar" style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: dim(520) }}>
          <thead>
            <tr
              style={{
                color: T.textMuted,
                fontFamily: T.data,
                fontSize: textSize("tableHeader"),
                textTransform: "uppercase",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              {["Profile", "P&L", "Delta", "Std", "PF", "Win"].map((column) => (
                <th key={column} style={{ padding: sp("4px 5px"), textAlign: "left" }}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="ra-table-row">
                <td style={{ padding: sp("5px"), color: T.text, fontFamily: T.data, fontWeight: 400 }}>
                  {row.label}
                </td>
                <td style={{ padding: sp("5px"), color: toneForValue(row.realizedPnl), fontFamily: T.data }}>
                  {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
                </td>
                <td style={{ padding: sp("5px"), color: toneForValue(row.deltaPnl), fontFamily: T.data }}>
                  {formatAccountSignedMoney(row.deltaPnl, currency, true, maskValues)}
                </td>
                <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
                  {formatAccountMoney(row.standardDeviation, currency, true, maskValues)}
                </td>
                <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
                  {row.profitFactor == null ? "----" : formatNumber(row.profitFactor, 2)}
                </td>
                <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
                  {formatAccountPercent(row.winRatePercent, 0, maskValues)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const startOfIsoWeek = (input) => {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const dayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayOffset);
  return d;
};

const isoWeekKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

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
  // When every week is exactly flat, show trade-count bars instead so the
  // chart still communicates which weeks were traded rather than rendering
  // a stripe of 1-pixel dashes.
  const maxAbs = flatPnl
    ? weeks.reduce((m, w) => (w.trades > m ? w.trades : m), 0) || 1
    : maxAbsPnl;
  // 4-week rolling expectancy (per-trade) ending at each week
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
        border: `1px solid ${T.border}`,
        borderRadius: dim(5),
        background: T.bg0,
        padding: sp("6px 8px"),
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
          <span style={{ color: toneForValue(totalPnl), fontWeight: 400 }}>
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
          // When every week is flat, draw bars upward in cyan to signal
          // "trade activity, no realized P&L".
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
          fontFamily: T.data,
          color: T.textMuted,
        }}
      >
        <span>{formatAppDateTime(weeks[0].weekStart).slice(0, 10)}</span>
        <span style={{ color: T.cyan }}>
          {flatPnl ? "trade count (no realized P&L)" : "4w rolling expectancy"}
        </span>
        <span>{formatAppDateTime(weeks[weeks.length - 1].weekStart).slice(0, 10)}</span>
      </div>
    </div>
  );
};

const histogramBucketColor = (side) =>
  side === "loss" ? T.red : side === "win" ? T.green : T.textMuted;

const HorizontalPnlHistogram = ({ trades = [], currency, maskValues, lensActive = false }) => {
  const model = useMemo(
    () => buildTradeOutcomeHistogramModel({ trades, metric: "pnl" }),
    [trades],
  );
  const buckets = arrayValue(model?.buckets);
  if (!model.summary?.totalTrades || !buckets.length) {
    return null;
  }
  // Render lows at top → highs at bottom (descending min, so largest losses first).
  const orderedBuckets = [...buckets].sort((left, right) => left.min - right.min).reverse();
  const maxCount = orderedBuckets.reduce((m, b) => (b.count > m ? b.count : m), 0) || 1;
  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: sp(4),
        }}
      >
        <div style={mutedLabelStyle}>P&L DISTRIBUTION</div>
        <div style={{ fontSize: textSize("label"), fontFamily: T.data, color: T.textDim }}>
          {lensActive ? "lens · " : ""}
          {formatNumber(model.summary.totalTrades, 0)} trades
        </div>
      </div>
      <div style={{ display: "grid", gap: 2 }}>
        {orderedBuckets.map((bucket) => {
          const widthPct = (bucket.count / maxCount) * 100;
          const color = histogramBucketColor(bucket.side);
          return (
            <AppTooltip
              key={bucket.id}
              content={`${bucket.label} · ${formatNumber(bucket.count, 0)} trades · total ${formatAccountSignedMoney(
                bucket.total,
                currency,
                true,
                maskValues,
              )}`}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(46px, auto) minmax(0, 1fr) minmax(20px, auto)",
                  alignItems: "center",
                  gap: sp(4),
                  fontFamily: T.data,
                  fontSize: textSize("label"),
                }}
              >
                <span
                  style={{
                    color: color,
                    fontWeight: 400,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {bucket.label}
                </span>
                <div
                  style={{
                    height: dim(10),
                    background: T.bg0,
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(2),
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(2, widthPct)}%`,
                      height: "100%",
                      background: color,
                      opacity: bucket.count ? 0.85 : 0.2,
                    }}
                  />
                </div>
                <span style={{ color: T.textSec, textAlign: "right" }}>
                  {formatNumber(bucket.count, 0)}
                </span>
              </div>
            </AppTooltip>
          );
        })}
      </div>
    </div>
  );
};

const TickerRows = ({
  rows,
  currency,
  maskValues,
  onSymbolSelect,
  selectedSymbol,
}) => (
  <div className="ra-hide-scrollbar" style={{ overflow: "auto", maxHeight: dim(220) }}>
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: dim(720) }}>
      <thead>
        <tr
          style={{
            color: T.textMuted,
            fontFamily: T.data,
            fontSize: textSize("tableHeader"),
            textTransform: "uppercase",
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          {["Symbol", "P&L", "Win", "Exp", "PF", "Trades", "Hold", "Open"].map((column) => (
            <th key={column} style={{ padding: sp("4px 5px"), textAlign: "left" }}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.symbol}
            className="ra-table-row"
            style={{
              background:
                selectedSymbol && row.symbol === selectedSymbol
                  ? `${T.cyan}14`
                  : "transparent",
            }}
          >
            <td style={{ padding: sp("5px"), color: T.text, fontFamily: T.data, fontWeight: 400 }}>
              <button
                type="button"
                onClick={() => onSymbolSelect?.(row.symbol)}
                className="ra-interactive"
                style={{
                  border: "none",
                  background: "transparent",
                  color: T.cyan,
                  fontFamily: T.data,
                  fontWeight: 400,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {row.symbol}
              </button>
            </td>
            <td style={{ padding: sp("5px"), color: toneForValue(row.realizedPnl), fontFamily: T.data }}>
              {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {formatAccountPercent(row.winRatePercent, 0, maskValues)}
            </td>
            <td style={{ padding: sp("5px"), color: toneForValue(row.expectancy), fontFamily: T.data }}>
              {formatAccountMoney(row.expectancy, currency, true, maskValues)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {row.profitFactor == null ? "----" : formatNumber(row.profitFactor, 2)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {formatNumber(row.closedTrades || 0, 0)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {row.averageHoldMinutes == null
                ? "----"
                : `${formatNumber(row.averageHoldMinutes / 60, 1)}h`}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {formatNumber(row.openQuantity || 0, 2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const TradingPatternsPanel = ({
  query,
  snapshotMutation,
  accountId,
  range,
  currency,
  maskValues = false,
  onSymbolSelect,
  selectedLens,
  onLensChange,
  analysis,
  onTradeSelect,
  lensFilteredTrades = null,
}) => {
  const [sortKey, setSortKey] = useState("realizedPnl");
  const [tickerOrder, setTickerOrder] = useState("top");
  const packet = query.data || {};
  const summary = packet.summary || {};
  const snapshot = packet.snapshot || {};
  const tickerRows = useMemo(() => {
    const rows = arrayValue(packet.tickerStats);
    const sortedDesc = [...rows].sort((left, right) => {
      const delta = (finiteNumber(right?.[sortKey]) ?? 0) - (finiteNumber(left?.[sortKey]) ?? 0);
      return delta || String(left?.symbol || "").localeCompare(String(right?.symbol || ""));
    });
    return tickerOrder === "bottom" ? [...sortedDesc].reverse() : sortedDesc;
  }, [packet.tickerStats, sortKey, tickerOrder]);
  const tickerTableRows = tickerRows.slice(0, 8);
  const sourceRows = arrayValue(packet.sourceStats).slice(0, 5);
  const hourRows = arrayValue(packet.timeStats?.byHour).map((row) => ({
    ...row,
    label: row.hour,
  }));
  const loading = query.isLoading || query.isPending;
  const refreshing = snapshotMutation?.isPending;
  const selectedSymbol = selectedLens?.symbol || "";
  const selectedSourceType = selectedLens?.sourceType || "all";
  const selectedCloseHour = selectedLens?.closeHour ?? null;
  const selectSymbol = (symbol) => {
    onSymbolSelect?.(symbol);
    onLensChange?.("symbol", { symbol });
  };
  const activateAnalysisCard = (card) => {
    if (card?.disabled) return;
    if (card?.lens?.kind) {
      onLensChange?.(card.lens.kind, card.lens.input || {});
    }
    if (card?.tradeId) {
      onTradeSelect?.(card.tradeId);
    }
  };
  const representativeCards = arrayValue(analysis?.representativeTrades).slice(0, 4);
  const issueCards = arrayValue(analysis?.issueCards).slice(0, 5);
  const analysisCards = [...representativeCards, ...issueCards];
  const readinessRows = arrayValue(analysis?.readiness);
  const drilldownGroups = [
    ...arrayValue(analysis?.bucketGroups?.side),
    ...arrayValue(analysis?.bucketGroups?.holdDuration),
    ...arrayValue(analysis?.bucketGroups?.feeDrag),
    ...arrayValue(analysis?.bucketGroups?.strategy),
  ]
    .filter((group) => group?.key && group.key !== "unknown")
    .sort((left, right) => Math.abs(right.realizedPnl || 0) - Math.abs(left.realizedPnl || 0));
  const outcomeGroups = [
    ...arrayValue(analysis?.bucketGroups?.exitReason),
    ...arrayValue(analysis?.bucketGroups?.entryTime),
    ...arrayValue(analysis?.bucketGroups?.regime),
    ...arrayValue(analysis?.bucketGroups?.mfeGiveback),
  ].sort((left, right) => Math.abs(right.realizedPnl || 0) - Math.abs(left.realizedPnl || 0));
  const panelEmptyBody = snapshotMutation
    ? "Persist or refresh a Shadow analysis snapshot after trades or a watchlist backtest."
    : "Closed trades will populate account trading analysis once Flex or broker history is available.";

  return (
    <Panel
      title="Trading Analysis"
      rightRail={
        loading
          ? "Loading analysis packet"
          : snapshot.persisted
          ? `Snapshot ${formatAppDateTime(snapshot.createdAt)}`
          : `Live packet · ${formatNumber(summary.closedTrades || summary.count || 0, 0)} closed trades`
      }
      loading={loading}
      error={query.error || snapshotMutation?.error}
      onRetry={query.refetch}
      minHeight={270}
      action={
        <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap", alignItems: "center" }}>
          <ToggleGroup options={SORT_OPTIONS} value={sortKey} onChange={setSortKey} />
          <ToggleGroup
            options={[
              { value: "top", label: "Top" },
              { value: "bottom", label: "Bottom" },
            ]}
            value={tickerOrder}
            onChange={setTickerOrder}
          />
          <button
            type="button"
            className="ra-interactive"
            onClick={() => onLensChange?.("pnl", { pnlSign: "winners" })}
            style={{
              ...secondaryButtonStyle,
              color: selectedLens?.pnlSign === "winners" ? T.green : T.textSec,
              borderColor: selectedLens?.pnlSign === "winners" ? T.green : T.border,
            }}
          >
            Winners
          </button>
          <button
            type="button"
            className="ra-interactive"
            onClick={() => onLensChange?.("pnl", { pnlSign: "losers" })}
            style={{
              ...secondaryButtonStyle,
              color: selectedLens?.pnlSign === "losers" ? T.red : T.textSec,
              borderColor: selectedLens?.pnlSign === "losers" ? T.red : T.border,
            }}
          >
            Losers
          </button>
          {snapshotMutation ? (
            <button
              type="button"
              className="ra-interactive"
              disabled={refreshing}
              onClick={() =>
                snapshotMutation.mutate({
                  accountId,
                  data: { range },
                })
              }
              style={{
                ...secondaryButtonStyle,
                color: refreshing ? T.textMuted : T.pink,
                borderColor: refreshing ? T.border : T.pink,
                cursor: refreshing ? "wait" : "pointer",
              }}
            >
              {refreshing ? "Refreshing" : "Snapshot"}
            </button>
          ) : null}
        </div>
      }
    >
      <div style={{ display: "grid", gap: sp(7) }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))",
            gap: sp(4),
          }}
        >
          <PatternMetric label="Trades" value={formatNumber(summary.closedTrades || 0, 0)} />
          <PatternMetric
            label="P&L"
            value={formatAccountMoney(summary.realizedPnl, currency, true, maskValues)}
            tone={toneForValue(summary.realizedPnl)}
          />
          <PatternMetric
            label="Win"
            value={formatAccountPercent(summary.winRatePercent, 0, maskValues)}
            tone={T.green}
          />
          <PatternMetric
            label="Exp"
            value={formatAccountMoney(summary.expectancy, currency, true, maskValues)}
            tone={toneForValue(summary.expectancy)}
          />
          <PatternMetric
            label="PF"
            value={summary.profitFactor == null ? "----" : formatNumber(summary.profitFactor, 2)}
            tone={T.cyan}
          />
          <PatternMetric label="Events" value={formatNumber(summary.tradeEvents || 0, 0)} tone={T.purple} />
          <PatternMetric label="Open Lots" value={formatNumber(summary.openLots || 0, 0)} tone={T.cyan} />
          <PatternMetric
            label="Anomalies"
            value={formatNumber(summary.anomalies || 0, 0)}
            tone={(summary.anomalies || 0) ? T.amber : T.textSec}
          />
        </div>

        <WeeklyPnlBars
          trades={arrayValue(lensFilteredTrades)}
          currency={currency}
          maskValues={maskValues}
        />

        {analysisCards.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: sp(5),
            }}
          >
            {analysisCards.map((card) => (
              <AnalysisCard
                key={card.key}
                card={card}
                currency={currency}
                maskValues={maskValues}
                onActivate={activateAnalysisCard}
              />
            ))}
          </div>
        ) : null}

        <AnalysisReadinessStrip readiness={readinessRows} />

        <BucketDrilldownStrip
          groups={drilldownGroups}
          currency={currency}
          maskValues={maskValues}
          selectedLens={selectedLens}
          onLensChange={onLensChange}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: sp(7),
          }}
        >
          <OutcomeBreakdownRows
            title="CONTRACT SELECTION"
            groups={[
              ...arrayValue(analysis?.contractBreakdowns?.optionRight),
              ...arrayValue(analysis?.contractBreakdowns?.dte),
              ...arrayValue(analysis?.contractBreakdowns?.strikeSlot),
            ]}
            currency={currency}
            maskValues={maskValues}
          />
          <OutcomeBreakdownRows
            title="OUTCOME DRIVERS"
            groups={outcomeGroups}
            currency={currency}
            maskValues={maskValues}
          />
          <StopScenarioRows
            scenarios={analysis?.stopScenarios}
            currency={currency}
            maskValues={maskValues}
          />
        </div>

        {!tickerRows.length ? (
          <div
            style={{
              border: `1px dashed ${T.border}`,
              borderRadius: dim(5),
              background: T.bg0,
              padding: sp(10),
            }}
          >
            <EmptyState
              title="No trading analysis yet"
              body={panelEmptyBody}
            />
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: sp(7),
            }}
          >
            <div style={{ display: "grid", gap: sp(4), minWidth: 0 }}>
              <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap", alignItems: "center" }}>
                <Pill tone={tickerOrder === "bottom" ? "red" : "green"}>
                  {tickerOrder === "bottom" ? "Bottom Tickers" : "Top Tickers"}
                </Pill>
                <Pill tone="purple">{formatNumber(summary.symbolsTraded || 0, 0)} symbols</Pill>
              </div>
              <TickerRows
                rows={tickerTableRows}
                currency={currency}
                maskValues={maskValues}
                onSymbolSelect={selectSymbol}
                selectedSymbol={selectedSymbol}
              />
            </div>

            <div style={{ display: "grid", gap: sp(5), alignContent: "start" }}>
              <HorizontalPnlHistogram
                trades={arrayValue(lensFilteredTrades)}
                currency={currency}
                maskValues={maskValues}
                lensActive={Boolean(selectedLens && selectedLens.kind && selectedLens.kind !== "none")}
              />
              <div style={{ display: "grid", gap: sp(3) }}>
                <div style={mutedLabelStyle}>SOURCE BREAKDOWN</div>
                {sourceRows.map((row) => (
                  <button
                    type="button"
                    key={row.key || row.label}
                    onClick={() => onLensChange?.("source", row)}
                    className="ra-interactive"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: sp(4),
                      border: `1px solid ${
                        selectedSourceType !== "all" && selectedSourceType === row.sourceType
                          ? T.pink
                          : T.border
                      }`,
                      borderRadius: dim(4),
                      background:
                        selectedSourceType !== "all" && selectedSourceType === row.sourceType
                          ? `${T.pink}14`
                          : "transparent",
                      padding: sp("4px 5px"),
                      color: T.textSec,
                      fontFamily: T.data,
                      fontSize: textSize("tableCell"),
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.label || row.sourceType}
                    </span>
                    <span style={{ color: toneForValue(row.realizedPnl), fontWeight: 400 }}>
                      {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gap: sp(3) }}>
                <div style={mutedLabelStyle}>CLOSE HOUR HEAT</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: sp(2) }}>
                  {hourRows.map((row) => (
                    <AppTooltip key={row.hour} content={`${row.hour}:00 ${formatAccountMoney(row.realizedPnl, currency, true, maskValues)}`}><button
                      type="button"
                      key={row.hour}
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
                        fontWeight: 400,
                        cursor: "pointer",
                      }}
                    >
                      {row.hour}
                    </button></AppTooltip>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
};

export default TradingPatternsPanel;
