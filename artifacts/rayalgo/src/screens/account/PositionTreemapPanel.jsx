import { useContext, useMemo, useState } from "react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { ThemeContext } from "../../features/platform/platformContexts";
import {
  EmptyState,
  Panel,
  ToggleGroup,
  formatAccountMoney,
  formatAccountPercent,
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

export const buildTreemapItems = (positions) =>
  (positions || [])
    .map((row, index) => {
      const mv = Number(row?.marketValue);
      if (!Number.isFinite(mv) || mv === 0) return null;
      const symbol = String(row.symbol || "");
      return {
        id: String(row.id || `${symbol}:${row?.assetClass || "position"}:${index}`),
        symbol,
        value: Math.abs(mv),
        marketValue: mv,
        dayChangePercent: Number(row?.dayChangePercent) || 0,
        unrealizedPnlPercent: Number(row?.unrealizedPnlPercent) || 0,
        assetClass: row?.assetClass || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);

export const PositionTreemapPanel = ({
  positions,
  currency = "USD",
  maskValues = false,
  loading = false,
  error = null,
  onRetry,
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
    const clipped = Math.max(-PCT_CLIP, Math.min(PCT_CLIP, pct));
    const intensity = Math.abs(clipped) / PCT_CLIP;
    const alpha = 0.18 + intensity * 0.72;
    return rgba(clipped >= 0 ? T.green : T.red, alpha);
  };

  const { theme } = useContext(ThemeContext);
  const isDarkTheme = theme !== "light";
  const labelFill = isDarkTheme ? "#F2EFE9" : "#19171A";
  const subLabelFill = isDarkTheme ? "rgba(255,255,255,0.85)" : "rgba(15,23,42,0.85)";

  return (
    <Panel
      title="Position Heatmap"
      subtitle={`Sized by |market value| · colored by ${mode === "DAY" ? "day %" : "unrealized %"}`}
      action={
        <ToggleGroup options={TREEMAP_MODES} value={mode} onChange={setMode} />
      }
      loading={loading}
      error={error}
      onRetry={onRetry}
      minHeight={300}
    >
      {!items.length ? (
        <EmptyState
          title="No positions"
          body={emptyBody}
        />
      ) : (
        <div style={{ display: "grid", gap: sp(4) }}>
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
              fontSize: fs(9),
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
                  borderRadius: 1,
                }}
              />
            ))}
            <span>{`+${PCT_CLIP}%`}</span>
          </div>
        </div>
      )}
    </Panel>
  );
};

export default PositionTreemapPanel;
