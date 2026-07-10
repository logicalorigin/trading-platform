import { AppTooltip } from "@/components/ui/tooltip";
import { CSS_COLOR, cssColorMix, dim, RADII } from "../../../lib/uiTokens.jsx";
import { SPREAD_TIGHT_PCT, SPREAD_WIDE_PCT } from "./thresholds.js";
import { spreadTooltip } from "./tooltips.js";
import { getTone } from "./tones.js";

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const resolveSpreadWidthFraction = ({ bid, ask, mid }) => {
  const bidValue = finiteNumber(bid);
  const askValue = finiteNumber(ask);
  const midValue = finiteNumber(mid) ?? (
    bidValue != null && askValue != null ? (bidValue + askValue) / 2 : null
  );
  if (
    bidValue == null ||
    askValue == null ||
    midValue == null ||
    midValue <= 0 ||
    askValue < bidValue
  ) {
    return null;
  }
  return (askValue - bidValue) / midValue;
};

// Long-dated (LEAP) options structurally quote wider than weeklies, so the fixed
// tight/wide bands flag every long-dated contract red. Widen the bands roughly
// linearly with tenor (capped) so a normal long-dated spread reads "warn" not
// "sell". Short-dated (<= baseline) is unchanged: scale 1 -> identical behavior.
const SPREAD_DTE_BASELINE_DAYS = 21;
const SPREAD_DTE_MAX_SCALE = 4;
export const spreadThresholdScaleForDte = (dte) => {
  const days = Number(dte);
  if (!Number.isFinite(days) || days <= SPREAD_DTE_BASELINE_DAYS) return 1;
  return Math.min(
    SPREAD_DTE_MAX_SCALE,
    1 + (days - SPREAD_DTE_BASELINE_DAYS) / 110,
  );
};

export const spreadGaugeTone = (widthFraction, dte) => {
  const value = finiteNumber(widthFraction);
  if (value == null) return getTone("dim");
  const scale = spreadThresholdScaleForDte(dte);
  if (value < SPREAD_TIGHT_PCT * scale) return getTone("buy");
  if (value <= SPREAD_WIDE_PCT * scale) return getTone("warn");
  return getTone("sell");
};

export const SpreadGauge = ({
  bid,
  ask,
  mid,
  widthPct,
  dte,
  width = 48,
  height = 6,
}) => {
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
  const tone = spreadGaugeTone(spreadFraction, dte);
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
            className="ra-spread-gauge-fill"
            x1="2"
            y1={height / 2}
            x2={width - 2}
            y2={height / 2}
            stroke={CSS_COLOR.borderLight}
            strokeWidth={height}
            strokeLinecap="round"
          />
          <line
            x1="2"
            y1={height / 2}
            x2={width - 2}
            y2={height / 2}
            stroke={cssColorMix(tone, 27)}
            strokeWidth={height}
            strokeLinecap="round"
          />
          <g
            className="ra-spread-gauge-marker"
            style={{ transform: `translateX(${markerX}px)` }}
          >
            <line
              x1="0"
              y1="0.75"
              x2="0"
              y2={height - 0.75}
              stroke={tone}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </span>
    </AppTooltip>
  );
};

export default SpreadGauge;
