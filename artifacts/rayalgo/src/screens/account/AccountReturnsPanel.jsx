import { T, dim, fs, sp } from "../../lib/uiTokens";
import { formatAppDate } from "../../lib/timeZone";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  formatNumber,
  panelStyle,
  toneForValue,
} from "./accountUtils";

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
  <div
    title={title}
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
  </div>
);

const formatAxisMoney = (value, currency, maskValues) =>
  value === 0
    ? formatAccountMoney(0, currency, true, maskValues)
    : formatAccountSignedMoney(value, currency, true, maskValues);

const niceStep = (rawStep) => {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
};

const buildHistogramScale = (values) => {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const step = niceStep((high - low || Math.max(Math.abs(high), 1)) / 3);
  return {
    min: Math.floor(low / step) * step,
    max: Math.ceil(high / step) * step,
    step,
  };
};

const PnlHistogram = ({ bars = [], currency, maskValues }) => {
  const values = bars
    .map((bar) => Number(bar.value))
    .filter((value) => Number.isFinite(value));
  const { min, max, step } = buildHistogramScale(values.length ? values : [0]);
  const top = 6;
  const right = 238;
  const bottom = 48;
  const left = 38;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const range = max - min || 1;
  const yFor = (value) => top + ((max - value) / range) * plotHeight;
  const zeroY = yFor(0);
  const ticks = [max, 0, min]
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => b - a);
  const barGap = bars.length > 18 ? 1 : 2;
  const barWidth = bars.length
    ? Math.max(1, (plotWidth - barGap * Math.max(0, bars.length - 1)) / bars.length)
    : plotWidth;
  const firstLabel = bars[0]?.timestamp ? formatAppDate(bars[0].timestamp) : "";
  const lastLabel = bars[bars.length - 1]?.timestamp
    ? formatAppDate(bars[bars.length - 1].timestamp)
    : "";

  return (
    <div
      title={
        bars.length
          ? "Transfer-adjusted point-to-point P&L histogram."
          : "P&L path unavailable until the selected range has at least two equity points."
      }
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: dim(4),
        background: T.bg0,
        overflow: "hidden",
      }}
    >
      <svg
        role="img"
        aria-label="Transfer-adjusted account P&L histogram"
        viewBox="0 0 240 62"
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: dim(62) }}
      >
        <rect x="0" y="0" width="240" height="62" fill={T.bg0} />
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={left}
                x2={right}
                y1={y}
                y2={y}
                stroke={tick === 0 ? T.textDim : T.border}
                strokeDasharray={tick === 0 ? "0" : "3 3"}
                strokeWidth={tick === 0 ? 0.9 : 0.55}
                opacity={tick === 0 ? 0.8 : 0.9}
              />
              <text
                x={left - 4}
                y={y + 2.5}
                fill={tick < 0 ? T.red : tick > 0 ? T.green : T.textDim}
                fontFamily={T.mono}
                fontSize="6.5"
                fontWeight="800"
                textAnchor="end"
              >
                {formatAxisMoney(tick, currency, maskValues)}
              </text>
            </g>
          );
        })}
        <line x1={left} x2={left} y1={top} y2={bottom} stroke={T.border} strokeWidth="0.7" />
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke={T.border} strokeWidth="0.7" />
        {bars.map((bar, index) => {
          const value = Number(bar.value);
          const isFiniteValue = Number.isFinite(value);
          const y = isFiniteValue ? yFor(Math.max(value, 0)) : zeroY;
          const height = isFiniteValue ? Math.max(1, Math.abs(yFor(value) - zeroY)) : 1;
          const color = value > 0 ? T.green : value < 0 ? T.red : T.textDim;
          const x = left + index * (barWidth + barGap);
          return (
            <g key={`${bar.timestamp || "point"}-${index}`}>
              <title>
                {`${bar.timestamp || "Point"}\nP&L ${formatAccountSignedMoney(
                  value,
                  currency,
                  true,
                  maskValues,
                )}\nReturn ${formatSignedPercent(bar.returnPercent, 2, maskValues)}`}
              </title>
              <rect
                x={x}
                y={value >= 0 ? y : zeroY}
                width={barWidth}
                height={height}
                fill={color}
                rx="0.8"
                opacity={value === 0 ? 0.45 : 1}
              />
            </g>
          );
        })}
        {step > 0 ? (
          <text
            x={right}
            y={top + 7}
            fill={T.textDim}
            fontFamily={T.mono}
            fontSize="6"
            fontWeight="800"
            textAnchor="end"
          >
            Δ P&L
          </text>
        ) : null}
        <text
          x={left}
          y="58"
          fill={T.textDim}
          fontFamily={T.mono}
          fontSize="6.5"
          fontWeight="800"
          textAnchor="start"
        >
          {firstLabel}
        </text>
        <text
          x={right}
          y="58"
          fill={T.textDim}
          fontFamily={T.mono}
          fontSize="6.5"
          fontWeight="800"
          textAnchor="end"
        >
          {lastLabel}
        </text>
      </svg>
    </div>
  );
};

export const AccountReturnsPanel = ({
  model,
  currency,
  range,
  maskValues = false,
  compact = false,
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
          <div
            title="Transfer-adjusted P&L over the selected equity range. External deposits and withdrawals are excluded."
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
          </div>
        </div>
      </header>

      <PnlHistogram
        bars={equity.pnlBars || []}
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
