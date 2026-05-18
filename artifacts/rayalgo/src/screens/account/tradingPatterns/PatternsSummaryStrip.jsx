import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";

const PatternMetric = ({ label, value, tone = T.text, isFirst = false }) => (
  <div
    style={{
      flex: "1 1 auto",
      minWidth: dim(82),
      padding: sp("4px 10px"),
      borderLeft: isFirst ? "none" : `1px solid ${T.border}`,
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div
      style={{
        color: tone,
        fontFamily: T.data,
        fontWeight: FONT_WEIGHTS.regular,
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

const MetricStrip = ({ items }) => (
  <div
    className="ra-hide-scrollbar"
    style={{
      display: "flex",
      flexWrap: "nowrap",
      overflowX: "auto",
      background: T.bg1,
      borderRadius: dim(RADII.md),
      minWidth: 0,
    }}
  >
    {items.map((item, index) => (
      <PatternMetric key={item.label} {...item} isFirst={index === 0} />
    ))}
  </div>
);

const formatRatio = (value) =>
  value == null || !Number.isFinite(value) ? "—" : formatNumber(value, 2);

export const PatternsSummaryStrip = ({
  summary = {},
  riskMetrics = null,
  currency,
  maskValues,
}) => {
  const coreItems = [
    { label: "Trades", value: formatNumber(summary.closedTrades || 0, 0) },
    {
      label: "P&L",
      value: formatAccountMoney(summary.realizedPnl, currency, true, maskValues),
      tone: toneForValue(summary.realizedPnl),
    },
    {
      label: "Win",
      value: formatAccountPercent(summary.winRatePercent, 0, maskValues),
      tone: T.green,
    },
    {
      label: "Exp",
      value: formatAccountMoney(summary.expectancy, currency, true, maskValues),
      tone: toneForValue(summary.expectancy),
    },
    {
      label: "PF",
      value: summary.profitFactor == null ? "—" : formatNumber(summary.profitFactor, 2),
      tone: T.cyan,
    },
    { label: "Events", value: formatNumber(summary.tradeEvents || 0, 0), tone: T.purple },
    { label: "Open Lots", value: formatNumber(summary.openLots || 0, 0), tone: T.cyan },
    {
      label: "Anomalies",
      value: formatNumber(summary.anomalies || 0, 0),
      tone: (summary.anomalies || 0) ? T.amber : T.textSec,
    },
  ];

  const risk = riskMetrics || {};
  const riskItems = [
    {
      label: "Sortino",
      value: formatRatio(risk.sortinoRatio),
      tone: risk.sortinoRatio == null ? T.textSec : risk.sortinoRatio >= 0 ? T.green : T.red,
    },
    {
      label: "Calmar",
      value: formatRatio(risk.calmarRatio),
      tone: risk.calmarRatio == null ? T.textSec : risk.calmarRatio >= 0 ? T.green : T.red,
    },
    {
      label: "Max DD",
      value:
        risk.maxDrawdown == null
          ? "—"
          : formatAccountMoney(-Math.abs(risk.maxDrawdown), currency, true, maskValues),
      tone: risk.maxDrawdown ? T.red : T.textSec,
    },
    {
      label: "MC P05",
      value:
        risk.monteCarloP05Pnl == null
          ? "—"
          : formatAccountMoney(risk.monteCarloP05Pnl, currency, true, maskValues),
      tone: toneForValue(risk.monteCarloP05Pnl),
    },
    {
      label: "Loss Risk",
      value:
        risk.monteCarloLossProbabilityPercent == null
          ? "—"
          : formatAccountPercent(
              risk.monteCarloLossProbabilityPercent,
              0,
              maskValues,
            ),
      tone:
        risk.monteCarloLossProbabilityPercent == null
          ? T.textSec
          : risk.monteCarloLossProbabilityPercent >= 50
            ? T.red
            : risk.monteCarloLossProbabilityPercent >= 20
              ? T.amber
              : T.green,
    },
  ];
  const hasAnyRiskMetric = riskItems.some((item) => item.value !== "—");

  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <MetricStrip items={coreItems} />
      {hasAnyRiskMetric ? <MetricStrip items={riskItems} /> : null}
    </div>
  );
};

export default PatternsSummaryStrip;
