import { useContext, useMemo, useState } from "react";
import { RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { ThemeContext } from "../../features/platform/platformContexts";
import {
  EmptyState,
  ToggleGroup,
  formatAccountMoney,
  formatAccountPercent,
  mutedLabelStyle,
} from "./accountUtils";

const hexToRgb = (value) => {
  const normalized = String(value || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const rgba = (hex, alpha) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return "transparent";
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const treemapLayout = (items, x, y, w, h) => {
  if (!items.length) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return [];

  let acc = 0;
  let splitIdx = 1;
  for (let i = 0; i < items.length; i += 1) {
    acc += items[i].value;
    if (acc >= total / 2 || i === items.length - 1) {
      splitIdx = Math.max(1, i + (acc > total * 0.75 ? 0 : 1));
      break;
    }
  }
  splitIdx = Math.min(items.length - 1, Math.max(1, splitIdx));

  const left = items.slice(0, splitIdx);
  const right = items.slice(splitIdx);
  const leftSum = left.reduce((sum, item) => sum + item.value, 0);
  const frac = leftSum / total;
  const horizontal = w >= h;
  if (horizontal) {
    const lw = w * frac;
    return [
      ...treemapLayout(left, x, y, lw, h),
      ...treemapLayout(right, x + lw, y, w - lw, h),
    ];
  }
  const lh = h * frac;
  return [
    ...treemapLayout(left, x, y, w, lh),
    ...treemapLayout(right, x, y + lh, w, h - lh),
  ];
};

const TREEMAP_W = 1200;
const TREEMAP_H = 280;
const PCT_CLIP = 5;

const TREEMAP_MODES = [
  { value: "DAY", label: "Day %" },
  { value: "UNREAL", label: "Unreal %" },
];

const finiteNumber = (value) => {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric != null) return numeric;
  }
  return null;
};

const rowMultiplier = (row) =>
  firstFiniteNumber(
    row?.optionContract?.multiplier,
    row?.optionContract?.sharesPerContract,
    1,
  );

const rowCostBasis = (row) => {
  const averageCost = finiteNumber(row?.averageCost);
  const quantity = finiteNumber(row?.quantity);
  const multiplier = rowMultiplier(row);
  if (averageCost != null && quantity != null && multiplier != null) {
    const costBasis = averageCost * quantity * multiplier;
    if (costBasis !== 0) return Math.abs(costBasis);
  }

  const marketValue = finiteNumber(row?.marketValue);
  const unrealizedPnl = finiteNumber(row?.unrealizedPnl);
  if (marketValue != null && unrealizedPnl != null) {
    const costBasis = marketValue - unrealizedPnl;
    if (costBasis !== 0) return Math.abs(costBasis);
  }

  return null;
};

const deriveUnrealizedPnlPercent = (row) => {
  const unrealizedPnl = finiteNumber(row?.unrealizedPnl);
  const costBasis = rowCostBasis(row);
  if (unrealizedPnl != null && costBasis != null) {
    return (unrealizedPnl / costBasis) * 100;
  }
  return finiteNumber(row?.unrealizedPnlPercent);
};

const deriveDayChangePercent = (row) => {
  const provided = finiteNumber(row?.dayChangePercent);
  if (provided != null) return provided;

  const dayChange = finiteNumber(row?.dayChange);
  const marketValue = finiteNumber(row?.marketValue);
  if (dayChange == null || marketValue == null) return null;

  const previousMarketValue = marketValue - dayChange;
  return previousMarketValue !== 0
    ? (dayChange / Math.abs(previousMarketValue)) * 100
    : null;
};

export const buildTreemapItems = (positions) =>
  (positions || [])
    .map((row, index) => {
      const mv = finiteNumber(row?.marketValue);
      if (!Number.isFinite(mv) || mv === 0) return null;
      const symbol = String(row.symbol || "");
      return {
        id: String(row.id || `${symbol}:${row?.assetClass || "position"}:${index}`),
        symbol,
        value: Math.abs(mv),
        marketValue: mv,
        dayChangePercent: deriveDayChangePercent(row),
        unrealizedPnlPercent: deriveUnrealizedPnlPercent(row),
        assetClass: row?.assetClass || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);

export const PositionTreemapContent = ({
  positions,
  currency = "USD",
  maskValues = false,
  emptyBody = "Treemap renders once open positions are streamed from the bridge.",
}) => {
  const [mode, setMode] = useState("DAY");
  const items = useMemo(() => buildTreemapItems(positions), [positions]);
  const rects = useMemo(
    () => treemapLayout(items, 0, 0, TREEMAP_W, TREEMAP_H),
    [items],
  );

  const pctFor = (rect) =>
    mode === "DAY" ? rect.dayChangePercent : rect.unrealizedPnlPercent;

  const colorFor = (pct) => {
    const numeric = finiteNumber(pct);
    if (numeric == null) return rgba(T.textMuted, 0.18);
    const clipped = Math.max(-PCT_CLIP, Math.min(PCT_CLIP, numeric));
    const intensity = Math.abs(clipped) / PCT_CLIP;
    const alpha = 0.18 + intensity * 0.72;
    return rgba(clipped >= 0 ? T.green : T.red, alpha);
  };

  const { theme } = useContext(ThemeContext);
  const isDarkTheme = theme !== "light";
  const labelFill = T.text;
  const subLabelFill = isDarkTheme ? "rgba(242,239,233,0.85)" : "rgba(25,23,26,0.85)";

  if (!items.length) {
    return <EmptyState title="No positions" body={emptyBody} />;
  }

  return (
    <div style={{ display: "grid", gap: sp(4) }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(5),
        }}
      >
        <div style={mutedLabelStyle}>
          Sized by |market value| · colored by {mode === "DAY" ? "day %" : "unrealized %"}
        </div>
        <ToggleGroup options={TREEMAP_MODES} value={mode} onChange={setMode} />
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${TREEMAP_W} ${TREEMAP_H}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        {rects.map((rect) => {
          const pct = pctFor(rect);
          const area = rect.w * rect.h;
          const showLabel = area > 4000;
          const showPct = area > 18000;
          const labelSize = Math.min(22, Math.sqrt(area) * 0.18);
          return (
            <g key={rect.id}>
              <rect
                x={rect.x + 0.5}
                y={rect.y + 0.5}
                width={Math.max(0, rect.w - 1)}
                height={Math.max(0, rect.h - 1)}
                fill={colorFor(pct)}
                stroke={T.bg0}
                strokeWidth={1}
              >
                <title>{`${rect.symbol} · ${formatAccountMoney(
                  rect.marketValue,
                  currency,
                  true,
                  maskValues,
                )} · day ${formatAccountPercent(rect.dayChangePercent, 2, maskValues)} · unreal ${formatAccountPercent(rect.unrealizedPnlPercent, 2, maskValues)}`}</title>
              </rect>
              {showLabel ? (
                <text
                  x={rect.x + rect.w / 2}
                  y={rect.y + rect.h / 2 - (showPct ? 6 : 2)}
                  textAnchor="middle"
                  fontSize={labelSize}
                  fontFamily={T.sans}
                  fontWeight={400}
                  fill={labelFill}
                  style={{ pointerEvents: "none" }}
                >
                  {rect.symbol.length > 16
                    ? `${rect.symbol.slice(0, 14)}…`
                    : rect.symbol}
                </text>
              ) : null}
              {showPct ? (
                <text
                  x={rect.x + rect.w / 2}
                  y={rect.y + rect.h / 2 + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fontFamily={T.mono}
                  fontWeight={400}
                  fill={subLabelFill}
                  style={{ pointerEvents: "none" }}
                >
                  {formatAccountPercent(pct, 2, maskValues)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: sp(4),
          fontSize: textSize("caption"),
          fontFamily: T.sans,
          color: T.textDim,
        }}
      >
        <span>{`-${PCT_CLIP}%`}</span>
        {[-5, -3, -1, 0, 1, 3, 5].map((p) => (
          <div
            key={p}
            style={{
              width: dim(22),
              height: dim(10),
              background: colorFor(p),
              borderRadius: dim(RADII.xs),
            }}
          />
        ))}
        <span>{`+${PCT_CLIP}%`}</span>
      </div>
    </div>
  );
};

export default PositionTreemapContent;
