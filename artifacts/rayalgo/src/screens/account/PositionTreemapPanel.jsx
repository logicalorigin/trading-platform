import { useEffect, useMemo, useRef, useState } from "react";
import { RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
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
const TREEMAP_LAYOUT_TRANSITION_MS = 900;
const TREEMAP_METRIC_TRANSITION_MS = 420;
const TREEMAP_TARGET_SETTLE_MS = 120;

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

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const lerp = (from, to, amount) => from + (to - from) * amount;

export const easeTreemapTransition = (progress) => {
  const t = clamp01(progress);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const interpolateMaybeNumber = (fromValue, toValue, amount) => {
  const from = finiteNumber(fromValue);
  const to = finiteNumber(toValue);
  if (from != null && to != null) return lerp(from, to, amount);
  return amount >= 1 ? to : from ?? to;
};

const collapsedTreemapRect = (rect) => ({
  ...rect,
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h / 2,
  w: 0,
  h: 0,
  opacity: 0,
});

export const interpolateTreemapRect = (fromRect, toRect, progress) => {
  const amount = clamp01(progress);
  return {
    ...toRect,
    id: toRect.id ?? fromRect.id,
    symbol: toRect.symbol ?? fromRect.symbol,
    assetClass: toRect.assetClass ?? fromRect.assetClass,
    x: lerp(finiteNumber(fromRect.x) ?? 0, finiteNumber(toRect.x) ?? 0, amount),
    y: lerp(finiteNumber(fromRect.y) ?? 0, finiteNumber(toRect.y) ?? 0, amount),
    w: Math.max(
      0,
      lerp(finiteNumber(fromRect.w) ?? 0, finiteNumber(toRect.w) ?? 0, amount),
    ),
    h: Math.max(
      0,
      lerp(finiteNumber(fromRect.h) ?? 0, finiteNumber(toRect.h) ?? 0, amount),
    ),
    value: interpolateMaybeNumber(fromRect.value, toRect.value, amount),
    marketValue: interpolateMaybeNumber(
      fromRect.marketValue,
      toRect.marketValue,
      amount,
    ),
    dayChangePercent: interpolateMaybeNumber(
      fromRect.dayChangePercent,
      toRect.dayChangePercent,
      amount,
    ),
    unrealizedPnlPercent: interpolateMaybeNumber(
      fromRect.unrealizedPnlPercent,
      toRect.unrealizedPnlPercent,
      amount,
    ),
    opacity: lerp(
      finiteNumber(fromRect.opacity) ?? 1,
      finiteNumber(toRect.opacity) ?? 1,
      amount,
    ),
  };
};

const treemapRectMap = (rects) =>
  new Map((rects || []).map((rect) => [String(rect.id), rect]));

const renderableTreemapRect = (rect) => ({
  ...rect,
  opacity: finiteNumber(rect.opacity) ?? 1,
  isLeaving: false,
});

export const buildTreemapTransitionFrame = ({
  fromRects = [],
  toRects = [],
  progress = 1,
  reducedMotion = false,
} = {}) => {
  if (reducedMotion) {
    return (toRects || []).map(renderableTreemapRect);
  }

  const eased = easeTreemapTransition(progress);
  const fromById = treemapRectMap(fromRects);
  const toById = treemapRectMap(toRects);
  const orderedIds = [
    ...(toRects || []).map((rect) => String(rect.id)),
    ...(fromRects || [])
      .map((rect) => String(rect.id))
      .filter((id) => !toById.has(id)),
  ];

  return orderedIds
    .map((id) => {
      const from = fromById.get(id);
      const to = toById.get(id);
      if (from && to) {
        return {
          ...interpolateTreemapRect(from, renderableTreemapRect(to), eased),
          isLeaving: false,
        };
      }
      if (to) {
        return {
          ...interpolateTreemapRect(
            collapsedTreemapRect(to),
            renderableTreemapRect(to),
            eased,
          ),
          isLeaving: false,
        };
      }
      if (from) {
        const leaving = interpolateTreemapRect(
          renderableTreemapRect(from),
          collapsedTreemapRect(from),
          eased,
        );
        return {
          ...leaving,
          isLeaving: true,
        };
      }
      return null;
    })
    .filter((rect) => rect && rect.opacity > 0.001);
};

const signatureNumber = (value) => {
  const numeric = finiteNumber(value);
  return numeric == null ? "" : Math.round(numeric * 100) / 100;
};

const treemapLayoutSignature = (rects) =>
  (rects || [])
    .map((rect) =>
      [rect.id, rect.x, rect.y, rect.w, rect.h]
        .map((value, index) => (index === 0 ? value : signatureNumber(value)))
        .join(":"),
    )
    .join("|");

const treemapRectSignature = (rects) =>
  (rects || [])
    .map((rect) =>
      [
        rect.id,
        signatureNumber(rect.x),
        signatureNumber(rect.y),
        signatureNumber(rect.w),
        signatureNumber(rect.h),
        signatureNumber(rect.marketValue),
        signatureNumber(rect.dayChangePercent),
        signatureNumber(rect.unrealizedPnlPercent),
      ].join(":"),
    )
    .join("|");

const prefersReducedTreemapMotion = () => {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
      (typeof document !== "undefined" &&
        document.documentElement?.getAttribute("data-rayalgo-reduced-motion") ===
          "on"),
  );
};

const scheduleAnimationFrame = (callback) => {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(Date.now()), 16);
};

const cancelScheduledFrame = (frameId) => {
  if (!frameId) return;
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frameId);
    return;
  }
  clearTimeout(frameId);
};

const useAnimatedTreemapRects = (
  targetRects,
  durationMs = TREEMAP_LAYOUT_TRANSITION_MS,
) => {
  const [displayRects, setDisplayRects] = useState(() =>
    buildTreemapTransitionFrame({ toRects: targetRects, reducedMotion: true }),
  );
  const displayRectsRef = useRef(displayRects);
  const displaySignatureRef = useRef(treemapRectSignature(displayRects));
  const displayLayoutSignatureRef = useRef(treemapLayoutSignature(displayRects));
  const targetRectsRef = useRef(targetRects);
  const targetSignature = useMemo(
    () => treemapRectSignature(targetRects),
    [targetRects],
  );
  const targetLayoutSignature = useMemo(
    () => treemapLayoutSignature(targetRects),
    [targetRects],
  );

  targetRectsRef.current = targetRects;

  useEffect(() => {
    const nextRects = targetRectsRef.current;
    if (displaySignatureRef.current === targetSignature) {
      return undefined;
    }

    const setFrame = (frame, signature = treemapRectSignature(frame)) => {
      displayRectsRef.current = frame;
      displaySignatureRef.current = signature;
      displayLayoutSignatureRef.current = treemapLayoutSignature(frame);
      setDisplayRects(frame);
    };

    if (durationMs <= 0 || prefersReducedTreemapMotion()) {
      const immediate = buildTreemapTransitionFrame({
        toRects: nextRects,
        reducedMotion: true,
      });
      setFrame(immediate, targetSignature);
      return undefined;
    }

    const transitionMs =
      displayLayoutSignatureRef.current === targetLayoutSignature
        ? TREEMAP_METRIC_TRANSITION_MS
        : durationMs;
    let frameId = 0;
    let settleId = 0;

    const startAnimation = () => {
      const startRects = displayRectsRef.current;
      const startTime =
        typeof performance !== "undefined" ? performance.now() : Date.now();

      const tick = (now) => {
        const elapsed = (now ?? Date.now()) - startTime;
        const progress = clamp01(elapsed / transitionMs);
        const complete = progress >= 1;
        const frame = complete
          ? buildTreemapTransitionFrame({
              toRects: nextRects,
              reducedMotion: true,
            })
          : buildTreemapTransitionFrame({
              fromRects: startRects,
              toRects: nextRects,
              progress,
            });
        setFrame(frame, complete ? targetSignature : undefined);
        if (progress < 1) {
          frameId = scheduleAnimationFrame(tick);
        }
      };

      frameId = scheduleAnimationFrame(tick);
    };

    settleId = setTimeout(startAnimation, TREEMAP_TARGET_SETTLE_MS);
    return () => {
      clearTimeout(settleId);
      cancelScheduledFrame(frameId);
    };
  }, [durationMs, targetLayoutSignature, targetSignature]);

  return displayRects;
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

export const stabilizeTreemapItemOrder = (items = [], previousItems = []) => {
  const currentById = new Map(
    (items || []).map((item) => [String(item.id), item]),
  );
  const used = new Set();
  const ordered = [];

  (previousItems || []).forEach((previous) => {
    const id = typeof previous === "string" ? previous : previous?.id;
    const current = currentById.get(String(id));
    if (!current || used.has(String(current.id))) return;
    ordered.push(current);
    used.add(String(current.id));
  });

  const added = (items || [])
    .filter((item) => !used.has(String(item.id)))
    .sort((a, b) => b.value - a.value);

  return [...ordered, ...added];
};

const smoothStepRange = (value, start, end) => {
  if (end <= start) return value >= end ? 1 : 0;
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};

const treemapTextOpacity = (rect, startArea, endArea) => {
  if (rect?.isLeaving) return 0;
  const w = finiteNumber(rect?.w) ?? 0;
  const h = finiteNumber(rect?.h) ?? 0;
  const area = Math.max(0, w * h);
  return (
    clamp01(finiteNumber(rect?.opacity) ?? 1) *
    smoothStepRange(area, startArea, endArea)
  );
};

export const PositionTreemapContent = ({
  positions,
  currency = "USD",
  maskValues = false,
  emptyBody = "Treemap renders once open positions are streamed from the bridge.",
}) => {
  const [mode, setMode] = useState("DAY");
  const rawItems = useMemo(() => buildTreemapItems(positions), [positions]);
  const previousItemsRef = useRef([]);
  const items = useMemo(
    () => stabilizeTreemapItemOrder(rawItems, previousItemsRef.current),
    [rawItems],
  );
  useEffect(() => {
    previousItemsRef.current = items;
  }, [items]);
  const rects = useMemo(
    () => treemapLayout(items, 0, 0, TREEMAP_W, TREEMAP_H),
    [items],
  );
  const animatedRects = useAnimatedTreemapRects(rects);

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

  const labelFill = T.text;
  const subLabelFill = rgba(T.text, 0.85);

  if (!items.length && !animatedRects.length) {
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
        {animatedRects.map((rect) => {
          const pct = pctFor(rect);
          const area = rect.w * rect.h;
          const opacity = finiteNumber(rect.opacity) ?? 1;
          const labelOpacity = treemapTextOpacity(rect, 3200, 7600);
          const pctOpacity = treemapTextOpacity(rect, 14000, 24000);
          const showLabel = labelOpacity > 0.03;
          const showPct = pctOpacity > 0.03;
          const labelSize = Math.min(22, Math.sqrt(area) * 0.18);
          return (
            <g key={rect.id} opacity={opacity}>
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
                  opacity={labelOpacity}
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
                  opacity={pctOpacity}
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
