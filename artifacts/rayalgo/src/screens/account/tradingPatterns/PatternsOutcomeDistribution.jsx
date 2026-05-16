import { useMemo } from "react";
import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  formatAccountSignedMoney,
  formatNumber,
  mutedLabelStyle,
} from "../accountUtils";
import { buildTradeOutcomeHistogramModel } from "../tradeOutcomeHistogramModel";
import { AppTooltip } from "@/components/ui/tooltip";
import { arrayValue } from "./patternsCommon";

const histogramBucketColor = (side) =>
  side === "loss"
    ? "var(--ra-pnl-negative)"
    : side === "win"
      ? "var(--ra-pnl-positive)"
      : T.textMuted;

export const PatternsOutcomeDistribution = ({
  trades = [],
  currency,
  maskValues,
  lensActive = false,
}) => {
  const model = useMemo(
    () => buildTradeOutcomeHistogramModel({ trades, metric: "pnl" }),
    [trades],
  );
  const buckets = arrayValue(model?.buckets);
  if (!model.summary?.totalTrades || !buckets.length) return null;
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
      <div style={{ display: "grid", gap: sp(2) }}>
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
                  gridTemplateColumns: `minmax(${dim(46)}px, auto) minmax(0, 1fr) minmax(${dim(20)}px, auto)`,
                  alignItems: "center",
                  gap: sp(4),
                  fontFamily: T.data,
                  fontSize: textSize("label"),
                }}
              >
                <span
                  style={{
                    color,
                    fontWeight: FONT_WEIGHTS.regular,
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
                    background: T.bg1,
                    border: "none",
                    borderRadius: dim(RADII.pill),
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

export default PatternsOutcomeDistribution;
