import {
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, cssColorAlpha, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { useNumberTick } from "../../lib/numberTick.js";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  formatNumber,
  toneForValue,
} from "./accountUtils";
import { AppTooltip } from "@/components/ui/tooltip";

const MASKED = "•••••";

const formatMoney = (value, currency, masked) => {
  if (masked) return MASKED;
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return formatAccountMoney(Number(value), currency, true, false);
};

const formatPercent = (value, masked) => {
  if (masked) return MASKED;
  if (value == null || !Number.isFinite(Number(value))) return null;
  return formatAccountPercent(Number(value), 2, false);
};

const formatSignedPercent = (value, digits = 2, masked = false) => {
  if (masked) return MASKED;
  if (value == null || Number.isNaN(Number(value))) return "—";
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
};

const formatRatio = (value, digits = 2, masked = false) => {
  if (masked) return MASKED;
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}x`;
};

const metricTone = (value, fallback = CSS_COLOR.textDim) =>
  value == null || Number.isNaN(Number(value)) ? fallback : toneForValue(value);

const labelCapsStyle = {
  color: CSS_COLOR.textMuted,
  fontSize: textSize("caption"),
  fontFamily: T.sans,
  fontWeight: FONT_WEIGHTS.regular,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  lineHeight: 1.15,
};

const HeroMetricPill = ({ label, value, tone = CSS_COLOR.text, title, first = false }) => (
  <AppTooltip content={title}>
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: sp(2),
        minHeight: dim(18),
        maxWidth: dim(104),
        minWidth: 0,
        flex: "0 0 auto",
        padding: sp("0 5px"),
        borderLeft: first ? "none" : `1px solid ${CSS_COLOR.border}`,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          ...labelCapsStyle,
          flexShrink: 0,
          fontSize: fs(6),
          lineHeight: 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          minWidth: 0,
          color: tone,
          fontSize: fs(9),
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.regular,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
    </span>
  </AppTooltip>
);

export const AccountHeroBlock = ({
  summary,
  returnsModel,
  range,
  currency = "USD",
  maskValues = false,
  shadowMode: _shadowMode = false,
  isPhone = false,
}) => {
  const summaryMetrics = summary?.metrics || {};
  const equity = returnsModel?.equity || {};
  const trades = returnsModel?.trades || {};
  const positions = returnsModel?.positions || {};
  const cash = returnsModel?.cash || {};
  const risk = returnsModel?.risk || {};
  const hasRiskStats = returnsModel?.available?.hasRiskAdjustedStats;
  const netLiquidation = summaryMetrics.netLiquidation?.value;
  const dayPnl = summaryMetrics.dayPnl?.value;
  const dayPnlPercent = summaryMetrics.dayPnlPercent?.value;
  const transferAdjustedPnl = equity.transferAdjustedPnl ?? null;
  const rangeLabel = range || returnsModel?.range || "Range";
  const returnTooltip = equity.returnPercentDiscrepancy
    ? `Transfer-adjusted return over the selected range. API value ${formatSignedPercent(
        equity.providerReturnPercent,
        2,
        maskValues,
      )} differed from recomputed value, so the recomputed value is shown.`
    : "Transfer-adjusted return over the selected equity range. External deposits and withdrawals are excluded.";
  const performanceSummary = [
    {
      label: "Adj return",
      value: formatSignedPercent(equity.returnPercent, 2, maskValues),
      tone: metricTone(equity.returnPercent),
      title: `${returnTooltip}\nRange: ${rangeLabel}`,
    },
    {
      label: "P&L Δ",
      value: formatAccountSignedMoney(transferAdjustedPnl, currency, true, maskValues),
      tone: metricTone(transferAdjustedPnl),
      title:
        "Transfer-adjusted P&L over the selected equity range. External deposits and withdrawals are excluded.",
    },
  ];
  const performanceMetrics = [
    {
      label: "Trades",
      value: formatNumber(trades.count, 0),
      tone: CSS_COLOR.text,
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
          ? CSS_COLOR.textDim
          : trades.winRate >= 50
            ? CSS_COLOR.green
            : CSS_COLOR.amber,
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
          ? CSS_COLOR.textDim
          : trades.profitFactor >= 1
            ? CSS_COLOR.green
            : CSS_COLOR.red,
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
            tone: CSS_COLOR.text,
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
      tone: CSS_COLOR.amber,
      title: "Year-to-date fees and commissions from account cash activity.",
    },
    {
      label: "Div",
      value: formatAccountMoney(cash.dividendsYtd, currency, true, maskValues),
      tone: CSS_COLOR.green,
      title: "Year-to-date dividends.",
    },
    {
      label: "Int",
      value: formatAccountMoney(cash.interestYtd, currency, true, maskValues),
      tone: CSS_COLOR.green,
      title: "Year-to-date interest paid or earned.",
    },
  ];
  const performanceRailMetrics = [...performanceSummary, ...performanceMetrics];

  // Animate the hero net liquidation value when it changes (rAF-driven,
  // respects prefers-reduced-motion). Disabled when masked since the
  // bullets aren't a number.
  const animatedNet = useNumberTick(
    maskValues ? null : Number.isFinite(Number(netLiquidation)) ? Number(netLiquidation) : null,
    520,
  );
  const animatedDayPnl = useNumberTick(
    maskValues ? null : Number.isFinite(Number(dayPnl)) ? Number(dayPnl) : null,
    520,
  );
  const displayNet = animatedNet ?? netLiquidation;
  const displayDayPnl = animatedDayPnl ?? dayPnl;
  const dayPositive = Number.isFinite(Number(dayPnl)) ? Number(dayPnl) >= 0 : null;
  const dayTone =
    dayPositive === null ? CSS_COLOR.textDim : dayPositive ? CSS_COLOR.green : CSS_COLOR.red;
  const DayIcon = dayPositive === false ? TrendingDown : TrendingUp;
  return (
    <section
      data-testid="account-hero-block"
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(isPhone ? 4 : 6),
        padding: sp("1px 3px 1px"),
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        data-testid="account-hero-primary-row"
        style={{
          color: CSS_COLOR.text,
          fontFamily: T.sans,
          fontSize: fs(isPhone ? 16 : 20),
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          fontWeight: FONT_WEIGHTS.label,
          whiteSpace: "nowrap",
          flex: "0 1 auto",
          minWidth: 0,
          maxWidth: isPhone ? "48%" : "36%",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {formatMoney(displayNet, currency, maskValues)}
      </div>
      <div
        className="ra-hide-scrollbar"
        data-testid="account-hero-performance-rail"
        style={{
          display: "flex",
          alignItems: "center",
          flex: "1 1 0",
          minWidth: 0,
          overflowX: "auto",
          overflowY: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {dayPositive !== null ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(3),
              minHeight: dim(18),
              padding: sp("0 5px"),
              border: `1px solid ${cssColorAlpha(dayTone, "40")}`,
              borderRadius: dim(RADII.pill),
              background: cssColorAlpha(dayTone, "12"),
              color: dayTone,
              flex: "0 0 auto",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            <DayIcon size={10} />
            <span style={{ fontWeight: FONT_WEIGHTS.medium, fontVariantNumeric: "tabular-nums" }}>{formatMoney(displayDayPnl, currency, maskValues)}</span>
            {formatPercent(dayPnlPercent, maskValues) ? (
              <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>
                {formatPercent(dayPnlPercent, maskValues)}
              </span>
            ) : null}
            <span style={{ color: CSS_COLOR.textMuted, marginLeft: sp(1) }}>today</span>
          </span>
        ) : null}
        {performanceRailMetrics.map((metric, index) => (
          <HeroMetricPill
            key={metric.label}
            first={dayPositive === null && index === 0}
            {...metric}
          />
        ))}
      </div>
    </section>
  );
};

export default AccountHeroBlock;
