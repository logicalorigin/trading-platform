import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  formatAccountSignedMoney,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";
import { arrayValue } from "./patternsCommon";

const isKnown = (group) => group?.key && group.key !== "unknown";

export const PatternsExitReasons = ({
  bucketGroups,
  currency,
  maskValues,
}) => {
  const rows = arrayValue(bucketGroups?.exitReason).filter(isKnown);
  if (!rows.length) return null;

  const maxCount = rows.reduce(
    (acc, group) => (group.count > acc ? group.count : acc),
    0,
  ) || 1;
  const totalCount = rows.reduce((sum, group) => sum + group.count, 0);

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
        }}
      >
        <div style={mutedLabelStyle}>EXIT REASONS</div>
        <div
          style={{
            fontSize: textSize("label"),
            fontFamily: T.data,
            color: T.textDim,
          }}
        >
          {formatNumber(totalCount, 0)} trades · {rows.length} reasons
        </div>
      </div>
      <div style={{ display: "grid", gap: sp(2) }}>
        {rows.map((row) => {
          const tone = toneForValue(row.realizedPnl);
          const widthPercent = Math.max(2, (row.count / maxCount) * 100);
          return (
            <div
              key={row.key}
              style={{
                display: "grid",
                gridTemplateColumns: `minmax(70px, 0.7fr) minmax(0, 1fr) auto`,
                alignItems: "center",
                gap: sp(6),
                padding: sp("4px 6px"),
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  color: T.textSec,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  position: "relative",
                  height: dim(8),
                  borderRadius: dim(RADII.xs),
                  background: T.bg0,
                  overflow: "hidden",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${widthPercent}%`,
                    background: `linear-gradient(90deg, ${tone}cc, ${tone}66)`,
                    borderRadius: dim(RADII.xs),
                    boxShadow: `inset 0 1px 0 ${tone}33`,
                  }}
                />
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: sp(5),
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: T.textSec, fontWeight: FONT_WEIGHTS.regular }}>
                  {formatNumber(row.count, 0)}
                </span>
                <span style={{ color: tone, fontWeight: FONT_WEIGHTS.medium }}>
                  {formatAccountSignedMoney(row.realizedPnl, currency, true, maskValues)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PatternsExitReasons;
