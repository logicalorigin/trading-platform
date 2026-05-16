import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";

const PatternMetric = ({ label, value, tone = T.text }) => (
  <div
    style={{
      border: "none",
      borderRadius: dim(RADII.md),
      background: T.bg1,
      padding: sp("6px 8px"),
      minWidth: 0,
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

export const PatternsSummaryStrip = ({ summary = {}, currency, maskValues }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(auto-fit, minmax(${dim(88)}px, 1fr))`,
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
      value={summary.profitFactor == null ? "—" : formatNumber(summary.profitFactor, 2)}
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
);

export default PatternsSummaryStrip;
