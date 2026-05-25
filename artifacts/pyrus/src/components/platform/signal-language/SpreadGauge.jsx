import { AppTooltip } from "@/components/ui/tooltip";
import { RADII, T, dim } from "../../../lib/uiTokens.jsx";
import { SPREAD_TIGHT_PCT, SPREAD_WIDE_PCT } from "./thresholds.js";
import { spreadTooltip } from "./tooltips.js";
import { getTone } from "./tones.js";

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const resolveSpreadWidthFraction = ({ bid, ask, mid }) => {
  const bidValue = finiteNumber(bid);
  const askValue = finiteNumber(ask);
  const midValue = finiteNumber(mid) ?? (
    bidValue != null && askValue != null ? (bidValue + askValue) / 2 : null
  );
  if (bidValue == null || askValue == null || midValue == null || midValue <= 0) {
    return null;
  }
  return Math.max(0, (askValue - bidValue) / midValue);
};

export const spreadGaugeTone = (widthFraction) => {
  const value = finiteNumber(widthFraction);
  if (value == null) return getTone("dim");
  if (value < SPREAD_TIGHT_PCT) return getTone("buy");
  if (value <= SPREAD_WIDE_PCT) return getTone("warn");
  return getTone("sell");
};

export const SpreadGauge = ({ bid, ask, mid, widthPct, width = 48, height = 6 }) => {
  const bidValue = finiteNumber(bid);
  const askValue = finiteNumber(ask);
  const midValue = finiteNumber(mid) ?? (
    bidValue != null && askValue != null ? (bidValue + askValue) / 2 : null
  );
  if (bidValue == null || askValue == null || midValue == null || askValue <= bidValue) {
    return null;
  }

  const spreadFraction =
    finiteNumber(widthPct) ?? resolveSpreadWidthFraction({ bid, ask, mid: midValue });
  const tone = spreadGaugeTone(spreadFraction);
  const markerPct = Math.max(
    0,
    Math.min(1, (midValue - bidValue) / Math.max(askValue - bidValue, 0.000001)),
  );
  const markerX = 2 + markerPct * (width - 4);
  const label = spreadTooltip({ spreadPct: spreadFraction });

  return (
    <AppTooltip content={label}>
      <span
        data-testid="algo-spread-gauge"
        aria-label={label}
        style={{
          display: "inline-flex",
          width: dim(width),
          height: dim(height),
          minWidth: dim(width),
          borderRadius: dim(RADII.pill),
          overflow: "hidden",
          verticalAlign: "middle",
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          focusable="false"
          style={{ display: "block" }}
        >
          <line
            x1="2"
            y1={height / 2}
            x2={width - 2}
            y2={height / 2}
            stroke={T.borderLight}
            strokeWidth={height}
            strokeLinecap="round"
          />
          <line
            x1="2"
            y1={height / 2}
            x2={width - 2}
            y2={height / 2}
            stroke={`${tone}44`}
            strokeWidth={height}
            strokeLinecap="round"
          />
          <line
            x1={markerX}
            y1="0.75"
            x2={markerX}
            y2={height - 0.75}
            stroke={tone}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </AppTooltip>
  );
};

export default SpreadGauge;
