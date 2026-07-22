import {
  useMemo,
} from "react";
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
import { buildAccountReturnsModel } from "./accountReturnsModel";
import { AppTooltip } from "@/components/ui/tooltip";

const MASKED = "•••••";

const finiteHeroNumber = (value) => {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatMoney = (value, currency, masked) => {
  if (masked) return MASKED;
  const numeric = finiteHeroNumber(value);
  return numeric == null
    ? "—"
    : formatAccountMoney(numeric, currency, true, false);
};

const formatPercent = (value, masked) => {
  if (masked) return MASKED;
  const numeric = finiteHeroNumber(value);
  return numeric == null ? null : formatAccountPercent(numeric, 2, false);
};

const formatSignedPercent = (value, digits = 2, masked = false) => {
  if (masked) return MASKED;
  const numeric = finiteHeroNumber(value);
  if (numeric == null) return "—";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
};

const formatRatio = (value, digits = 2, masked = false) => {
  if (masked) return MASKED;
  const numeric = finiteHeroNumber(value);
  return numeric == null ? "—" : `${numeric.toFixed(digits)}x`;
};

const metricTone = (value, fallback = CSS_COLOR.textDim) =>
  finiteHeroNumber(value) == null ? fallback : toneForValue(value);

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
        maxWidth: dim(138),
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
          fontSize: fs(7),
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
          fontFamily: T.data,
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
  equityHistory,
  positionsResponse,
  tradesResponse,
  cashResponse,
  range,
  currency = "USD",
  maskValues = false,
  isPhone = false,
}) => {
  const returnsModel = useMemo(
    () =>
      buildAccountReturnsModel({
        equityHistory,
        positionsResponse,
        tradesResponse,
        cashResponse,
        range,
      }),
    [
      cashResponse,
      equityHistory,
      positionsResponse,
      range,
      tradesResponse,
    ],
  );
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
  const tradeCount = finiteHeroNumber(trades.count);
  const tradeOutcomeCount = finiteHeroNumber(trades.outcomeCount);
  const tradeOutcomeCoverage =
    tradeCount == null || tradeOutcomeCount == null
      ? "Trade outcome coverage is unavailable."
      : `${formatNumber(tradeOutcomeCount, 0)} of ${formatNumber(
          tradeCount,
          0,
        )} trades have a known realized outcome.`;
  const positionCount = finiteHeroNumber(positions.count);
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
      label: "Adjusted return",
      value: formatSignedPercent(equity.returnPercent, 2, maskValues),
      tone: metricTone(equity.returnPercent),
      title: `${returnTooltip}\nRange: ${rangeLabel}`,
    },
    {
      label: "Transfer P&L",
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
      )} losers. ${tradeOutcomeCoverage}`,
    },
    {
      label: "Realized",
      value: formatAccountSignedMoney(trades.realizedPnl, currency, true, maskValues),
      tone: metricTone(trades.realizedPnl),
      title: `Realized P&L over the selected closed-trade range. ${tradeOutcomeCoverage}`,
    },
    {
      label: "Unrealized",
      value: formatAccountSignedMoney(positions.unrealizedPnl, currency, true, maskValues),
      tone: metricTone(positions.unrealizedPnl),
      title:
        positionCount == null
          ? "Current position population is unavailable."
          : `${formatNumber(positionCount, 0)} current positions`,
    },
    {
      label: "Win rate",
      value: formatAccountPercent(trades.winRate, 0, maskValues),
      tone:
        finiteHeroNumber(trades.winRate) == null
          ? CSS_COLOR.textDim
          : finiteHeroNumber(trades.winRate) >= 50
            ? CSS_COLOR.green
            : CSS_COLOR.amber,
      title: `${formatNumber(trades.winners, 0)} winners / ${formatNumber(
        trades.losers,
        0,
      )} losers. ${tradeOutcomeCoverage}`,
    },
    {
      label: "Profit factor",
      value: formatRatio(trades.profitFactor, 2, maskValues),
      tone:
        finiteHeroNumber(trades.profitFactor) == null
          ? CSS_COLOR.textDim
          : finiteHeroNumber(trades.profitFactor) >= 1
            ? CSS_COLOR.green
            : CSS_COLOR.red,
      title: `Gross profit divided by gross loss. ${tradeOutcomeCoverage}`,
    },
    {
      label: "Expectancy",
      value: formatAccountSignedMoney(trades.expectancy, currency, true, maskValues),
      tone: metricTone(trades.expectancy),
      title: `Average realized P&L per closed trade. ${tradeOutcomeCoverage}`,
    },
    {
      label: "Max drawdown",
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
      label: "Current DD",
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
            label: "Volatility",
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
            label: "Sortino",
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
      label: "Dividends",
      value: formatAccountMoney(cash.dividendsYtd, currency, true, maskValues),
      tone: CSS_COLOR.green,
      title: "Year-to-date dividends.",
    },
    {
      label: "Interest",
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
    maskValues ? null : finiteHeroNumber(netLiquidation),
    520,
  );
  const animatedDayPnl = useNumberTick(
    maskValues ? null : finiteHeroNumber(dayPnl),
    520,
  );
  const displayNet = animatedNet ?? netLiquidation;
  const displayDayPnl = animatedDayPnl ?? dayPnl;
  const numericDayPnl = finiteHeroNumber(dayPnl);
  const dayPositive = numericDayPnl == null ? null : numericDayPnl >= 0;
  const dayTone =
    dayPositive === null ? CSS_COLOR.textDim : dayPositive ? CSS_COLOR.green : CSS_COLOR.red;
  const DayIcon = dayPositive === false ? TrendingDown : TrendingUp;
  return (
    <section
      data-testid="account-hero-block"
      style={{
        display: "grid",
        gap: sp(4),
        padding: sp("2px 3px 3px"),
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        data-testid="account-hero-primary-row"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: sp(isPhone ? 5 : 8),
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.text,
            fontFamily: T.data,
            fontSize: fs(isPhone ? 17 : 22),
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            fontWeight: FONT_WEIGHTS.label,
            whiteSpace: "nowrap",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatMoney(displayNet, currency, maskValues)}
        </span>
        {dayPositive !== null ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(4),
              minHeight: dim(22),
              padding: sp("2px 7px"),
              border: `1px solid ${cssColorAlpha(dayTone, "42")}`,
              borderRadius: dim(RADII.pill),
              background: cssColorAlpha(dayTone, "12"),
              color: dayTone,
              flex: "0 0 auto",
              fontSize: fs(isPhone ? 10 : 12),
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            <DayIcon size={12} />
            <span style={{ fontFamily: T.data, fontWeight: FONT_WEIGHTS.label, fontVariantNumeric: "tabular-nums" }}>{formatMoney(displayDayPnl, currency, maskValues)}</span>
            {formatPercent(dayPnlPercent, maskValues) ? (
              <span style={{ fontFamily: T.data, opacity: 0.82, fontVariantNumeric: "tabular-nums" }}>
                {formatPercent(dayPnlPercent, maskValues)}
              </span>
            ) : null}
            <span style={{ color: CSS_COLOR.textMuted, fontFamily: T.sans, marginLeft: sp(1) }}>today</span>
          </span>
        ) : null}
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
        {performanceRailMetrics.map((metric, index) => (
          <HeroMetricPill
            key={metric.label}
            first={index === 0}
            {...metric}
          />
        ))}
      </div>
    </section>
  );
};

export default AccountHeroBlock;
