import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  formatAccountSignedMoney,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";
import { arrayValue } from "./patternsCommon";

// Account's time-duration order (intraday-fast → multi-day) carries
// semantic meaning the backtest's bar-count buckets don't. Render in
// this order regardless of trade count so users can read the profile
// at a glance.
const HOLD_DURATION_ORDER = ["intraday-fast", "intraday", "swing", "multi-day"];

const HOLD_DURATION_LABEL = {
  "intraday-fast": "≤ 30m",
  intraday: "30m–4h",
  swing: "4h–1d",
  "multi-day": "Multi-day",
};

export const PatternsHoldProfile = ({
  bucketGroups,
  currency,
  maskValues,
  selectedLens,
  onLensChange,
}) => {
  const rawRows = arrayValue(bucketGroups?.holdDuration);
  const byKey = new Map(rawRows.map((row) => [row.key, row]));
  const orderedRows = HOLD_DURATION_ORDER.map((key) => byKey.get(key)).filter(
    Boolean,
  );
  if (!orderedRows.length) return null;

  const totalCount = orderedRows.reduce((sum, row) => sum + row.count, 0);
  const maxCount = orderedRows.reduce(
    (acc, row) => (row.count > acc ? row.count : acc),
    0,
  ) || 1;
  const activeKey =
    selectedLens?.kind === "holdDuration" ? selectedLens.holdDuration : null;

  return (
    <div
      style={{
        display: "grid",
        gap: sp(4),
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
        <div style={mutedLabelStyle}>HOLD PROFILE</div>
        <div
          style={{
            fontSize: textSize("label"),
            fontFamily: T.data,
            color: T.textDim,
          }}
        >
          {formatNumber(totalCount, 0)} closed
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${orderedRows.length}, minmax(0, 1fr))`,
          gap: sp(4),
          alignItems: "end",
        }}
      >
        {orderedRows.map((row) => {
          const active = activeKey === row.key;
          const tone = toneForValue(row.realizedPnl);
          const heightFraction = Math.max(0.06, row.count / maxCount);
          return (
            <button
              key={row.key}
              type="button"
              className="ra-interactive"
              onClick={() =>
                onLensChange?.("holdDuration", { holdDuration: row.key })
              }
              style={{
                display: "grid",
                gap: sp(2),
                padding: sp("6px 4px"),
                border: `1px solid ${active ? T.accent : T.border}`,
                borderRadius: dim(RADII.sm),
                background: active ? `${T.accent}10` : T.bg0,
                color: T.text,
                cursor: "pointer",
                minWidth: 0,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  height: dim(58),
                  position: "relative",
                  borderRadius: dim(RADII.xs),
                  overflow: "hidden",
                  background: `${T.border}33`,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: `${(heightFraction * 100).toFixed(1)}%`,
                    background: `linear-gradient(180deg, ${tone}66, ${tone}cc)`,
                    boxShadow: `inset 0 -1px 0 ${tone}55`,
                  }}
                />
              </div>
              <div
                style={{
                  color: T.textSec,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {HOLD_DURATION_LABEL[row.key] || row.label}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: sp(2),
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span style={{ color: T.textSec, fontWeight: FONT_WEIGHTS.regular }}>
                  {formatNumber(row.count, 0)}
                </span>
                <span style={{ color: tone, fontWeight: FONT_WEIGHTS.medium }}>
                  {formatAccountSignedMoney(row.realizedPnl, currency, true, maskValues)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PatternsHoldProfile;
