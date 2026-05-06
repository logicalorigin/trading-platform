import { useMemo, useState } from "react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
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
import { buildTradeOutcomeHistogramModel } from "./tradeOutcomeHistogramModel";
import { AppTooltip } from "@/components/ui/tooltip";


const formatSignedPercent = (value, digits = 2, maskValues = false) => {
  if (maskValues) return "****";
  if (value == null || Number.isNaN(Number(value))) return "----";
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
};

const formatRatio = (value, digits = 2, maskValues = false) => {
  if (maskValues) return "****";
  if (value == null || Number.isNaN(Number(value))) return "----";
  return `${Number(value).toFixed(digits)}x`;
};

const metricTone = (value, fallback = T.textDim) =>
  value == null || Number.isNaN(Number(value)) ? fallback : toneForValue(value);

const labelCapsStyle = {
  color: T.textMuted,
  fontSize: fs(7),
  fontFamily: T.sans,
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  lineHeight: 1.25,
};

const MetricCell = ({ label, value, tone = T.text, title }) => (
  <AppTooltip content={title}><div
    style={{
      minWidth: 0,
      display: "grid",
      gridTemplateColumns: "minmax(42px, auto) minmax(0, 1fr)",
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
        fontSize: fs(8),
        fontFamily: T.mono,
        fontWeight: 900,
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

const TRADING_DAY_COUNT = 30;

const startOfDay = (input) => {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
};

const isoDay = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const buildEquityDailyMap = (equityPoints) => {
  // Returns Map<iso-day, { eodNav, transfers }>. Last point of each day wins
  // for eodNav; transfers sum over all points in the day.
  const byDay = new Map();
  (equityPoints || []).forEach((point) => {
    const day = startOfDay(point?.timestamp ?? point?.timestampMs);
    if (!day) return;
    const nav = Number(point?.netLiquidation);
    if (!Number.isFinite(nav)) return;
    const key = isoDay(day);
    const deposits = Number(point?.deposits);
    const withdrawals = Number(point?.withdrawals);
    const transferDelta =
      (Number.isFinite(deposits) ? deposits : 0) -
      (Number.isFinite(withdrawals) ? withdrawals : 0);
    const ts = day.getTime();
    const current = byDay.get(key) || {
      iso: key,
      eodNav: null,
      eodTs: -Infinity,
      transfers: 0,
    };
    if (ts >= current.eodTs) {
      current.eodNav = nav;
      current.eodTs = ts;
    }
    current.transfers += transferDelta;
    byDay.set(key, current);
  });
  return byDay;
};

const buildDailyPnlSeries = (trades, equityPoints) => {
  const tradesByDay = new Map();
  (trades || []).forEach((trade) => {
    const day = startOfDay(trade?.closeDate);
    if (!day) return;
    const pnl = Number(trade?.pnl);
    if (!Number.isFinite(pnl)) return;
    const key = isoDay(day);
    const current = tradesByDay.get(key) || {
      iso: key,
      realized: 0,
      trades: 0,
    };
    current.realized += pnl;
    current.trades += 1;
    tradesByDay.set(key, current);
  });

  const equityByDay = buildEquityDailyMap(equityPoints);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  const cursor = new Date(today);
  // Track previous eod NAV walking *backwards* — we need the prior trading
  // day's NAV to compute today's total P&L. Build the trading-day list
  // forward first so we can walk it forward to compute daily totals.
  const tradingDays = [];
  while (tradingDays.length < TRADING_DAY_COUNT) {
    const dayOfWeek = cursor.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      tradingDays.unshift({ iso: isoDay(cursor), date: new Date(cursor) });
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  // Find the most recent equity point strictly before our window so the
  // first day's total P&L can be anchored.
  const sortedEquityDays = Array.from(equityByDay.values())
    .filter((entry) => entry.eodNav != null)
    .sort((a, b) => a.eodTs - b.eodTs);
  const windowStartIso = tradingDays[0]?.iso;
  let priorNav = null;
  for (const entry of sortedEquityDays) {
    if (entry.iso < windowStartIso) {
      priorNav = entry.eodNav;
    } else {
      break;
    }
  }

  tradingDays.forEach((day) => {
    const tradeRow = tradesByDay.get(day.iso);
    const equityRow = equityByDay.get(day.iso);
    const realized = tradeRow?.realized ?? 0;
    const tradeCount = tradeRow?.trades ?? 0;
    let total = null;
    if (equityRow?.eodNav != null && priorNav != null) {
      total = equityRow.eodNav - priorNav - (equityRow.transfers || 0);
    }
    const unrealized = total != null ? total - realized : null;
    out.push({
      iso: day.iso,
      date: day.date,
      realized,
      unrealized,
      total,
      trades: tradeCount,
    });
    if (equityRow?.eodNav != null) {
      priorNav = equityRow.eodNav;
    }
  });

  return out;
};

const CALENDAR_MODE_OPTIONS = [
  { value: "total", label: "Total" },
  { value: "realized", label: "Real" },
  { value: "unrealized", label: "Unreal" },
];

const valueForMode = (entry, mode) => {
  if (mode === "realized") return entry.realized ?? 0;
  if (mode === "unrealized") return entry.unrealized;
  if (entry.total != null) return entry.total;
  // Fall back to realized when total is unavailable so the chart still draws.
  return entry.realized ?? 0;
};

const bucketColor = (side) => (side === "loss" ? T.red : side === "win" ? T.green : T.textMuted);

const TradeOutcomeBuckets = ({ trades = [], currency, maskValues }) => {
  const model = useMemo(
    () => buildTradeOutcomeHistogramModel({ trades, metric: "pnl" }),
    [trades],
  );
  const buckets = model.buckets || [];
  if (!buckets.length || !model.summary?.totalTrades) {
    return null;
  }
  const maxCount = buckets.reduce((m, b) => (b.count > m ? b.count : m), 0) || 1;
  const summary = model.summary;
  return (
    <AppTooltip content="$ P&L bucket distribution across all closed trades in the recent window.">
      <div
        style={{
          display: "grid",
          gap: sp(3),
          paddingTop: sp(4),
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: sp(6),
          }}
        >
          <span style={mutedLabelStyle}>Outcome Distribution</span>
          <span style={{ fontSize: fs(7), fontFamily: T.mono, color: T.textDim }}>
            {formatNumber(summary.totalTrades, 0)} trades
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
            gap: 1,
            height: dim(28),
            alignItems: "end",
          }}
        >
          {buckets.map((bucket) => {
            const heightPct = (bucket.count / maxCount) * 100;
            return (
              <div
                key={bucket.id}
                title={`${bucket.label} · ${formatNumber(bucket.count, 0)} trades · total ${formatAccountSignedMoney(
                  bucket.total,
                  currency,
                  true,
                  maskValues,
                )}`}
                style={{
                  height: `${Math.max(2, heightPct)}%`,
                  background: bucketColor(bucket.side),
                  opacity: bucket.count ? 0.85 : 0.2,
                  borderRadius: 1,
                }}
              />
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: fs(7),
            fontFamily: T.mono,
            color: T.textMuted,
            gap: sp(3),
            flexWrap: "wrap",
          }}
        >
          <span>
            <span style={{ color: T.green, fontWeight: 800 }}>{summary.winners}W</span>
            <span style={{ margin: "0 3px", color: T.textDim }}>/</span>
            <span style={{ color: T.red, fontWeight: 800 }}>{summary.losers}L</span>
          </span>
          <span>
            μW{" "}
            <span style={{ color: T.green, fontWeight: 800 }}>
              {formatAccountSignedMoney(summary.averageWin, currency, true, maskValues)}
            </span>
          </span>
          <span>
            μL{" "}
            <span style={{ color: T.red, fontWeight: 800 }}>
              {formatAccountSignedMoney(summary.averageLoss, currency, true, maskValues)}
            </span>
          </span>
          <span>
            PF{" "}
            <span
              style={{
                color:
                  summary.profitFactor == null
                    ? T.textDim
                    : summary.profitFactor >= 1
                      ? T.green
                      : T.red,
                fontWeight: 800,
              }}
            >
              {summary.profitFactor == null
                ? "----"
                : `${summary.profitFactor.toFixed(2)}x`}
            </span>
          </span>
        </div>
      </div>
    </AppTooltip>
  );
};

const DailyPnlCalendar = ({
  trades = [],
  equityPoints = [],
  currency,
  maskValues,
}) => {
  const [mode, setMode] = useState("total");
  const days = useMemo(
    () => buildDailyPnlSeries(trades, equityPoints),
    [trades, equityPoints],
  );

  const totalAvailable = days.some((d) => d.total != null);
  const effectiveMode = mode === "total" && !totalAvailable ? "realized" : mode;

  const valueForDay = (d) => valueForMode(d, effectiveMode);

  const wins = days.filter((d) => {
    const v = valueForDay(d);
    return v != null && v > 0;
  }).length;
  const losses = days.filter((d) => {
    const v = valueForDay(d);
    return v != null && v < 0;
  }).length;
  const max =
    days.reduce((m, d) => {
      const v = valueForDay(d);
      return v != null && Math.abs(v) > m ? Math.abs(v) : m;
    }, 0) || 1;
  const best = days.reduce((acc, d) => {
    const v = valueForDay(d);
    if (v == null) return acc;
    if (!acc) return d;
    const av = valueForDay(acc) ?? -Infinity;
    return v > av ? d : acc;
  }, null);
  const worst = days.reduce((acc, d) => {
    const v = valueForDay(d);
    if (v == null) return acc;
    if (!acc) return d;
    const av = valueForDay(acc) ?? Infinity;
    return v < av ? d : acc;
  }, null);

  const hasAnyData = days.some(
    (d) => (d.realized && d.realized !== 0) || d.total != null || d.trades > 0,
  );

  if (!hasAnyData) {
    return (
      <AppTooltip content="30-day P&L calendar will populate once closed trades or NAV snapshots are recorded.">
        <div
          style={{
            border: `1px dashed ${T.border}`,
            borderRadius: dim(4),
            background: T.bg0,
            color: T.textMuted,
            fontSize: fs(8),
            fontFamily: T.mono,
            padding: sp(6),
            textAlign: "center",
          }}
        >
          No P&L in last 30 trading days
        </div>
      </AppTooltip>
    );
  }

  const modeLabel =
    effectiveMode === "realized"
      ? "real"
      : effectiveMode === "unrealized"
        ? "unreal"
        : "total";

  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: fs(8),
          fontFamily: T.mono,
          color: T.textMuted,
          gap: sp(4),
          flexWrap: "wrap",
        }}
      >
        <span>
          <span style={{ color: T.green, fontWeight: 800 }}>{wins}W</span>
          <span style={{ margin: "0 3px", color: T.textDim }}>/</span>
          <span style={{ color: T.red, fontWeight: 800 }}>{losses}L</span>
          <span style={{ marginLeft: sp(4), color: T.textDim }}>{modeLabel}</span>
        </span>
        <ToggleGroup
          options={CALENDAR_MODE_OPTIONS}
          value={effectiveMode}
          onChange={setMode}
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(10, 1fr)",
          gap: 2,
        }}
      >
        {days.map((d) => {
          const value = valueForDay(d);
          const intensity = value != null ? Math.abs(value) / max : 0;
          const baseColor =
            value == null || value === 0
              ? T.bg3
              : value > 0
                ? T.green
                : T.red;
          const opacity = value == null || value === 0 ? 0.2 : 0.25 + intensity * 0.7;
          const realFmt = formatAccountSignedMoney(d.realized || 0, currency, true, maskValues);
          const unrealFmt =
            d.unrealized == null
              ? "----"
              : formatAccountSignedMoney(d.unrealized, currency, true, maskValues);
          const totalFmt =
            d.total == null
              ? "----"
              : formatAccountSignedMoney(d.total, currency, true, maskValues);
          return (
            <div
              key={d.iso}
              title={`${d.iso}\nTotal ${totalFmt}\nReal ${realFmt}\nUnreal ${unrealFmt}\n${d.trades} trade${d.trades === 1 ? "" : "s"}`}
              style={{
                aspectRatio: "1",
                borderRadius: 2,
                background: baseColor,
                opacity,
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: fs(7),
          fontFamily: T.mono,
          color: T.textMuted,
          gap: sp(4),
          flexWrap: "wrap",
        }}
      >
        <span>
          BEST{" "}
          <span style={{ color: T.green, fontWeight: 800 }}>
            {best && valueForDay(best) != null
              ? formatAccountSignedMoney(valueForDay(best), currency, true, maskValues)
              : "----"}
          </span>
        </span>
        <span>
          WORST{" "}
          <span style={{ color: T.red, fontWeight: 800 }}>
            {worst && valueForDay(worst) != null
              ? formatAccountSignedMoney(valueForDay(worst), currency, true, maskValues)
              : "----"}
          </span>
        </span>
      </div>
    </div>
  );
};

export const AccountReturnsPanel = ({
  model,
  currency,
  range,
  maskValues = false,
  compact = false,
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
        gap: sp(compact ? 4 : 5),
        padding: compact ? sp("6px 7px") : sp("8px 9px"),
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
          <div style={labelCapsStyle}>
            Returns · {range || model?.range || "Range"}
          </div>
          <div
            style={{
              color: metricTone(equity.returnPercent),
              fontSize: fs(compact ? 15 : 17),
              fontFamily: T.mono,
              fontWeight: 950,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {formatSignedPercent(equity.returnPercent, 2, maskValues)}
          </div>
        </div>
        <div style={{ minWidth: 0, display: "grid", gap: sp(2), textAlign: "right" }}>
          <div style={labelCapsStyle}>
            P&L Δ
          </div>
          <AppTooltip content="Transfer-adjusted P&L over the selected equity range. External deposits and withdrawals are excluded."><div
            style={{
              color: metricTone(transferAdjustedPnl),
              fontSize: fs(compact ? 10 : 11),
              fontFamily: T.mono,
              fontWeight: 900,
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
      />

      <TradeOutcomeBuckets
        trades={tradesData?.trades || []}
        currency={currency}
        maskValues={maskValues}
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
