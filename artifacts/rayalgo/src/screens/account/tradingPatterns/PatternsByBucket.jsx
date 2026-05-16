import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  toneForValue,
} from "../accountUtils";
import { arrayValue } from "./patternsCommon";

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

export const PatternsByBucket = ({
  bucketGroups,
  currency,
  maskValues,
  selectedLens,
  onLensChange,
}) => {
  const groups = [
    ...arrayValue(bucketGroups?.side),
    ...arrayValue(bucketGroups?.holdDuration),
    ...arrayValue(bucketGroups?.feeDrag),
    ...arrayValue(bucketGroups?.strategy),
  ]
    .filter((group) => group?.key && group.key !== "unknown")
    .sort((left, right) => Math.abs(right.realizedPnl || 0) - Math.abs(left.realizedPnl || 0));
  const rows = groups.filter((group) => group?.count).slice(0, 8);
  if (!rows.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(150)}px, 1fr))`,
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
              border: "none",
              borderRadius: dim(RADII.md),
              background: active ? `${T.cyan}14` : T.bg2,
              padding: sp("7px 9px"),
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
                  fontWeight: FONT_WEIGHTS.regular,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {group.label}
              </span>
              <span style={{ color: pnlTone, fontFamily: T.data, fontSize: textSize("label"), fontWeight: FONT_WEIGHTS.regular }}>
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
  );
};

export default PatternsByBucket;
