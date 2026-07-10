import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { resolvePositionWireTrailState } from "./algoHelpers";

// Loosest -> tightest, matching the right-rail band + rung editor vocabulary.
const WIRE_RUNG_DISPLAY = [
  { rung: "wire3", label: "W3" },
  { rung: "wire2", label: "W2" },
  { rung: "wire1", label: "W1" },
  { rung: "trendLine", label: "TL" },
];

const formatWirePrice = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "--";

const formatSignedPct = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
    : "--";

const resolveWireSymbol = (row) => {
  const record = row && typeof row === "object" ? row : {};
  const contract =
    record.optionContract && typeof record.optionContract === "object"
      ? record.optionContract
      : {};
  return contract.underlying || record.underlyingSymbol || record.symbol || "—";
};

// Derive the trade direction (1 long / -1 short) from the sign relationship the
// backend used for distanceToBreakPct, so per-rung "room" reads consistently
// without threading direction separately. Defaults long when ambiguous.
const resolveWireDirection = ({ latestUnderlyingClose, selectedWirePrice, distanceToBreakPct }) => {
  if (
    distanceToBreakPct == null ||
    latestUnderlyingClose == null ||
    selectedWirePrice == null
  ) {
    return 1;
  }
  const rawDiff = latestUnderlyingClose - selectedWirePrice;
  if (rawDiff === 0) return 1;
  return Math.sign(distanceToBreakPct) === Math.sign(rawDiff) ? 1 : -1;
};

const SectionLabel = ({ children }) => (
  <span
    style={{
      color: CSS_COLOR.textMuted,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.medium,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </span>
);

// Surface B: compact wire-ladder proximity widget. Shows the underlying's
// position relative to every wire rung, the active rung highlighted, and the
// signed % room from the underlying to each level (distance-to-break on the
// active row). Axis-correct by construction (no chart, no premium/underlying mix).
const WireLadderWidget = ({ state, symbol }) => {
  const direction = resolveWireDirection(state);
  const close = state.latestUnderlyingClose;
  const roomPctFor = (level) => {
    if (level == null || close == null || close === 0) return null;
    return direction === 1
      ? ((close - level) / close) * 100
      : ((level - close) / close) * 100;
  };
  return (
    <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: sp(6),
          minWidth: 0,
        }}
      >
        <SectionLabel>Wire ladder</SectionLabel>
        <span
          style={{
            color: CSS_COLOR.textSec,
            fontFamily: T.data,
            fontSize: textSize("label"),
            whiteSpace: "nowrap",
          }}
        >
          {symbol} {formatWirePrice(close)}
        </span>
      </div>
      <div
        role="table"
        aria-label={`Wire ladder for ${symbol}`}
        style={{ display: "grid", gap: sp(1), minWidth: 0 }}
      >
        {WIRE_RUNG_DISPLAY.map(({ rung, label }) => {
          const level = state.wireLevels?.[rung] ?? null;
          const isActive = state.selectedRung === rung;
          const room = roomPctFor(level);
          const rowTone = isActive
            ? state.structureBreak || state.regimeFlipAgainstPosition
              ? CSS_COLOR.amber
              : CSS_COLOR.green
            : CSS_COLOR.textSec;
          return (
            <div
              key={rung}
              role="row"
              data-testid={`algo-wire-ladder-row-${rung}`}
              data-active={isActive ? "true" : undefined}
              style={{
                display: "grid",
                gridTemplateColumns: `${dim(22)}px ${dim(64)}px minmax(0, 1fr)`,
                alignItems: "center",
                gap: sp(4),
                padding: sp("2px 5px"),
                borderRadius: dim(RADII.xs),
                background: isActive ? cssColorMix(rowTone, 8) : "transparent",
                borderLeft: `2px solid ${isActive ? rowTone : "transparent"}`,
              }}
            >
              <span
                style={{
                  color: rowTone,
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  fontWeight: isActive ? FONT_WEIGHTS.emphasis : FONT_WEIGHTS.label,
                }}
              >
                {label}
              </span>
              <span
                className="tnum"
                style={{
                  color: level == null ? CSS_COLOR.textMuted : CSS_COLOR.text,
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  textAlign: "right",
                }}
              >
                {formatWirePrice(level)}
              </span>
              <span
                style={{
                  color: isActive ? rowTone : CSS_COLOR.textMuted,
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  fontWeight: isActive ? FONT_WEIGHTS.emphasis : FONT_WEIGHTS.regular,
                  whiteSpace: "nowrap",
                }}
              >
                {isActive && (state.structureBreak || state.regimeFlipAgainstPosition)
                  ? state.structureBreak
                    ? "structure break"
                    : "regime flip"
                  : `${formatSignedPct(room)}${isActive ? " to break" : ""}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Surface A (lightweight): a compact price "rail" — every wire plotted at its
// true price position with the underlying marked, so the spatial gap to the
// active wire (= room to break) is visible at a glance. Uses only the levels +
// underlying close (no bars subscription, no scale-alignment risk).
const RAIL_HEIGHT = 84;
const RAIL_PAD = 9;

const WireLevelRail = ({ state, symbol }) => {
  const close = state.latestUnderlyingClose;
  const points = [
    { key: "now", label: symbol, price: close, isUnderlying: true },
    ...WIRE_RUNG_DISPLAY.map(({ rung, label }) => ({
      key: rung,
      label,
      price: state.wireLevels?.[rung] ?? null,
      isActive: state.selectedRung === rung,
    })),
  ].filter((point) => typeof point.price === "number" && Number.isFinite(point.price));
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Not enough spread to plot meaningfully — the ladder widget still shows values.
  if (points.length < 2 || max === min) return null;
  const range = max - min;
  const yFor = (price) =>
    RAIL_PAD + ((max - price) / range) * (RAIL_HEIGHT - 2 * RAIL_PAD);

  return (
    <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
      <SectionLabel>Wire rail</SectionLabel>
      <div
        role="img"
        aria-label={`Wire levels for ${symbol}; underlying ${formatWirePrice(close)}`}
        style={{ position: "relative", height: dim(RAIL_HEIGHT), minWidth: 0 }}
      >
        {points.map((point) => {
          const tone = point.isUnderlying
            ? CSS_COLOR.accent
            : point.isActive
              ? state.structureBreak || state.regimeFlipAgainstPosition
                ? CSS_COLOR.amber
                : CSS_COLOR.green
              : CSS_COLOR.textMuted;
          const emphasize = point.isUnderlying || point.isActive;
          return (
            <div
              key={point.key}
              style={{
                position: "absolute",
                top: dim(yFor(point.price)),
                left: 0,
                right: 0,
                transform: "translateY(-50%)",
                display: "flex",
                alignItems: "center",
                gap: sp(3),
                minWidth: 0,
              }}
            >
              <span
                style={{
                  flex: "0 0 auto",
                  width: dim(24),
                  color: tone,
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  fontWeight: emphasize ? FONT_WEIGHTS.emphasis : FONT_WEIGHTS.regular,
                  textAlign: "right",
                }}
              >
                {point.label}
              </span>
              <div
                style={{
                  flex: "1 1 auto",
                  borderTop: `${emphasize ? 2 : 1}px ${
                    point.isUnderlying ? "solid" : "dashed"
                  } ${tone}`,
                  minWidth: 0,
                }}
              />
              <span
                className="tnum"
                style={{
                  flex: "0 0 auto",
                  color: tone,
                  fontFamily: T.data,
                  fontSize: textSize("caption"),
                  fontWeight: emphasize ? FONT_WEIGHTS.emphasis : FONT_WEIGHTS.regular,
                }}
              >
                {formatWirePrice(point.price)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Wire-trail drilldown block: hosts surface B (ladder widget) + surface A-lite
// (the price rail) side by side. Renders a clear empty state when the trail is
// configured on but no live wire context is loaded.
export const WireTrailDetail = ({ row }) => {
  const state = resolvePositionWireTrailState(row);
  if (!state.enabled) return null;
  const symbol = resolveWireSymbol(row);
  const hasContext = state.wireLevels != null || state.selectedWirePrice != null;

  return (
    <section
      data-testid="algo-wire-trail-detail"
      style={{
        display: "grid",
        gap: sp(5),
        padding: sp("7px 9px"),
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
        minWidth: 0,
      }}
    >
      {hasContext ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: sp(8),
            minWidth: 0,
          }}
        >
          <WireLadderWidget state={state} symbol={symbol} />
          <WireLevelRail state={state} symbol={symbol} />
        </div>
      ) : (
        <div style={{ display: "grid", gap: sp(2), minWidth: 0 }}>
          <SectionLabel>Wire trail</SectionLabel>
          <span
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.45,
            }}
          >
            Configured on, but no live wire context is loaded — enable
            PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE to populate the ladder.
          </span>
        </div>
      )}
    </section>
  );
};

export default WireTrailDetail;
