import React, { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";
import { useNumberTick } from "../../lib/numberTick.js";

const CSS_COLOR = Object.freeze({
  bg1: "var(--ra-surface-1)",
  bg2: "var(--ra-surface-2)",
  bg3: "var(--ra-surface-3)",
  border: "var(--ra-border-default)",
  borderLight: "var(--ra-border-light)",
  text: "var(--ra-text-primary)",
  textSec: "var(--ra-text-secondary)",
  textDim: "var(--ra-text-dim)",
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
  green: "var(--ra-green-500)",
  red: "var(--ra-red-500)",
  amber: "var(--ra-amber-500)",
  blue: "var(--ra-blue-500)",
});

const cssColorMix = (color, percent) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/**
 * Normalize a sparkline data array into a list of finite numeric closes.
 * Accepts raw numbers, { close }, { c }, or { v } shapes — matches what
 * the various market/runtime stores emit.
 */
export const extractSparklineValues = (data = []) =>
  (Array.isArray(data) ? data : [])
    .map((point) => {
      if (typeof point === "number" && Number.isFinite(point)) {
        return point;
      }
      if (typeof point?.close === "number" && Number.isFinite(point.close)) {
        return point.close;
      }
      if (typeof point?.c === "number" && Number.isFinite(point.c)) {
        return point.c;
      }
      if (typeof point?.v === "number" && Number.isFinite(point.v)) {
        return point.v;
      }
      return null;
    })
    .filter((value) => Number.isFinite(value));

/**
 * MicroSparkline — green/red line + soft area fill + compact detail cues.
 * Used in PlatformWatchlist rows and (via RowSparkValue) any row primitive
 * that wants an inline trend indicator.
 *
 *   data       — array of points (any of the shapes extractSparklineValues handles)
 *   positive   — boolean override; null/undefined infers from first-vs-last value
 *   color      — optional stroke/fill tone override for non-P/L sparklines
 *   width/height — SVG viewBox size in dim() units before scaling
 *   style      — optional SVG style overrides for responsive sizing
 *
 * Returns null when fewer than 2 valid points are available so callers
 * don't have to feature-check.
 */
export const MicroSparkline = ({
  data = [],
  positive = null,
  color = null,
  width = 64,
  height = 24,
  style = null,
  className,
  ariaLabel = null,
  ariaHidden,
}) => {
  const values = useMemo(() => extractSparklineValues(data), [data]);
  const uid = useId().replace(/:/g, "");

  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const yPad = Math.min(Math.max(height * 0.12, 1.5), 3);
  const xPad = Math.min(Math.max(width * 0.025, 0.75), 2);
  const drawHeight = Math.max(height - yPad * 2, 1);
  const drawWidth = Math.max(width - xPad * 2, 1);
  const step = drawWidth / Math.max(values.length - 1, 1);
  const inferredPositive = values[values.length - 1] >= values[0];
  const resolvedPositive =
    typeof positive === "boolean" ? positive : inferredPositive;
  const lineColor = color || (resolvedPositive ? CSS_COLOR.green : CSS_COLOR.red);
  const toY = (value) => {
    if (range === 0) {
      return height / 2;
    }
    const normalized = (value - min) / range;
    return height - yPad - normalized * drawHeight;
  };
  const plottedPoints = values.map((value, index) => {
    const x = xPad + index * step;
    const y = toY(value);
    return {
      index,
      value,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    };
  });
  const points = plottedPoints.map(({ x, y }) => `${x},${y}`).join(" ");
  const areaPath = `M ${plottedPoints
    .map(({ x, y }, index) => `${index === 0 ? "" : "L "}${x},${y}`)
    .join(" ")} L ${width},${height} L 0,${height} Z`;
  const tailPoint = plottedPoints[plottedPoints.length - 1];
  const highIndex = values.indexOf(max);
  const lowIndex = values.indexOf(min);
  const extremeIndexes = new Set([lowIndex, highIndex]);
  const detailPoints =
    range === 0
      ? []
      : plottedPoints
          .slice(1, -1)
          .filter((point) => extremeIndexes.has(point.index));
  const baselineValue = min < 0 && max > 0 ? 0 : values[0];
  const baselineY = Number(toY(baselineValue).toFixed(2));
  const extremeDotRadius = Number(
    Math.min(Math.max(height * 0.06, 0.95), 1.3).toFixed(2),
  );
  const tailDotRadius = Number(
    Math.min(Math.max(height * 0.07, 1.05), 1.35).toFixed(2),
  );
  const gradientId = `raSparkGrad-${uid}`;
  const glowId = `raSparkGlow-${uid}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel || undefined}
      role={ariaLabel ? "img" : undefined}
      style={{ display: "block", ...style }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        className="ra-sparkline-area"
        d={areaPath}
        fill={`url(#${gradientId})`}
      />
      <line
        className="ra-sparkline-baseline"
        x1={xPad}
        y1={baselineY}
        x2={width - xPad}
        y2={baselineY}
        stroke={CSS_COLOR.textMuted}
        strokeWidth="0.75"
        strokeOpacity="0.28"
        vectorEffect="non-scaling-stroke"
        shapeRendering="crispEdges"
      />
      <polyline
        className="ra-sparkline-line"
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.65"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {detailPoints.map((point) => {
        return (
          <circle
            key={`${point.index}-${point.x}-${point.y}`}
            className="ra-sparkline-extreme"
            cx={point.x}
            cy={point.y}
            r={extremeDotRadius}
            fill={lineColor}
            fillOpacity="0.88"
            stroke={CSS_COLOR.bg1}
            strokeWidth="0.45"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      <circle
        className="ra-sparkline-tail"
        cx={tailPoint.x}
        cy={tailPoint.y}
        r={tailDotRadius}
        fill={lineColor}
        stroke={CSS_COLOR.bg1}
        strokeWidth="0.65"
        vectorEffect="non-scaling-stroke"
        filter={`url(#${glowId})`}
      />
    </svg>
  );
};

/**
 * RowSparkValue — compact inline row: [value] [delta?] [MicroSparkline].
 * For dense lists where each entry is one numeric value, an optional
 * delta indicator, and a tiny trend. Examples: alert history, broker-
 * position rows, watchlist "mini" view. The watchlist's primary row
 * has its own layout; this primitive is for the simpler patterns.
 *
 *   value       — string or ReactNode (the headline number / label)
 *   delta       — optional ReactNode (signed percent, color-toned)
 *   sparklineData — passed through to MicroSparkline
 *   sparklineWidth / sparklineHeight — sized in dim() before scale
 *   positive    — passed through to MicroSparkline (auto-infer if null)
 *   align       — "start" | "end" (default "end"; positions sparkline on the right)
 *
 * No icon / no identity chip on purpose — those compose outside.
 */
export const RowSparkValue = ({
  value,
  delta,
  sparklineData,
  sparklineWidth = 44,
  sparklineHeight = 18,
  positive = null,
  align = "end",
  className,
  style,
}) => (
  <span
    className={className}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(6),
      minWidth: 0,
      justifyContent: align === "start" ? "flex-start" : "flex-end",
      fontFamily: T.sans,
      fontVariantNumeric: "tabular-nums",
      ...style,
    }}
  >
    {value != null ? (
      <span
        style={{
          color: CSS_COLOR.text,
          fontSize: textSize("paragraph"),
          fontWeight: FONT_WEIGHTS.medium,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    ) : null}
    {delta != null ? (
      <span
        style={{
          color: CSS_COLOR.textDim,
          fontSize: textSize("body"),
          fontWeight: FONT_WEIGHTS.medium,
          whiteSpace: "nowrap",
        }}
      >
        {delta}
      </span>
    ) : null}
    {sparklineData ? (
      <MicroSparkline
        data={sparklineData}
        width={sparklineWidth}
        height={sparklineHeight}
        positive={positive}
      />
    ) : null}
  </span>
);

const finiteGaugeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const roundGaugeMetric = (value) => Number(value.toFixed(3));

const normalizeHexColor = (color) => {
  const raw = String(color || "").trim();
  const shortMatch = raw.match(/^#([0-9a-fA-F]{3})$/);
  if (shortMatch) {
    return `#${shortMatch[1]
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : null;
};

const normalizeGaugeColor = (color) => {
  const raw = String(color || "").trim();
  if (!raw) return null;
  return normalizeHexColor(raw) || raw;
};

const lerpGaugeColor = (start, end, progress) => {
  const startColor = normalizeGaugeColor(start);
  const endColor = normalizeGaugeColor(end);
  if (!startColor || !endColor) return endColor || startColor || String(end || start);
  if (startColor === endColor) return startColor;

  const startHex = normalizeHexColor(startColor);
  const endHex = normalizeHexColor(endColor);
  if (!startHex || !endHex) {
    const mixPercent = roundGaugeMetric(Math.max(0, Math.min(1, progress)) * 100);
    return `color-mix(in srgb, ${endColor} ${mixPercent}%, ${startColor})`;
  }

  const startChannels = startHex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => parseInt(channel, 16));
  const endChannels = endHex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => parseInt(channel, 16));
  const channels = startChannels.map((channel, index) =>
    Math.round(channel + (endChannels[index] - channel) * progress),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
};

const normalizeGaugeColorStops = (colorStops, fallbackTone) => {
  const stops = Array.isArray(colorStops) ? colorStops : [];
  const normalized = stops
    .map((stop) => ({
      offset: Math.max(0, Math.min(1, finiteGaugeNumber(stop?.offset) ?? 0)),
      color: normalizeGaugeColor(stop?.color) || fallbackTone,
    }))
    .sort((a, b) => a.offset - b.offset);
  return normalized.length
    ? normalized
    : [
        { offset: 0, color: CSS_COLOR.blue },
        { offset: 0.5, color: CSS_COLOR.green },
        { offset: 1, color: CSS_COLOR.amber },
      ];
};

const gaugeColorAt = (colorStops, progress) => {
  const t = Math.max(0, Math.min(1, progress));
  if (t <= colorStops[0].offset) return colorStops[0].color;
  const last = colorStops[colorStops.length - 1];
  if (t >= last.offset) return last.color;
  for (let index = 0; index < colorStops.length - 1; index += 1) {
    const start = colorStops[index];
    const end = colorStops[index + 1];
    if (t >= start.offset && t <= end.offset) {
      const span = Math.max(end.offset - start.offset, 0.000001);
      return lerpGaugeColor(start.color, end.color, (t - start.offset) / span);
    }
  }
  return colorStops[0].color;
};

const estimateGaugeTextUnits = (value) =>
  Array.from(String(value ?? "")).reduce((total, char) => {
    if (char === "." || char === "," || char === ":") return total + 0.32;
    if (char === "%" || char === "/" || char === "$") return total + 0.7;
    if (char === "-" || char === "—") return total + 0.74;
    if (/\s/.test(char)) return total + 0.35;
    if (/[1ilI]/.test(char)) return total + 0.42;
    if (/[A-Z]/.test(char)) return total + 0.68;
    return total + 0.58;
  }, 0);

/**
 * RadialStrokeGauge — compact tick-segment gauge with center value text.
 * The ring is built from individual wedge chips, so it matches the
 * radial gauge sample without pulling in chart runtime. Numeric
 * changes animate through useNumberTick, which already honors reduced
 * motion; active ticks reveal through a CSS animation with the same opt-outs.
 */
export const RadialStrokeGauge = ({
  value,
  max = 100,
  size = 76,
  strokeWidth = 7,
  tickWidth,
  tickCount = 48,
  startAngle = -135,
  endAngle,
  sweepAngle,
  innerRadiusRatio = 0.68,
  outerRadiusRatio = 0.95,
  tone = CSS_COLOR.accent,
  trackColor = CSS_COLOR.borderLight,
  gradient = true,
  colorStops,
  glow = true,
  duration = 1.2,
  activeOpacity = 1,
  trackOpacity = 0.54,
  unit = "",
  title,
  label,
  valueLabel,
  valueColor = CSS_COLOR.text,
  labelColor = CSS_COLOR.textMuted,
  levelLabel,
  levelColor,
  ariaLabel,
  animated = true,
  style,
  className,
}) => {
  const uid = useId().replace(/:/g, "");
  const numericMax = finiteGaugeNumber(max);
  const resolvedMax = numericMax != null && numericMax > 0 ? numericMax : 100;
  const numericValue = finiteGaugeNumber(value);
  const clampedValue =
    numericValue == null
      ? null
      : Math.max(0, Math.min(resolvedMax, numericValue));
  const animatedValue = useNumberTick(
    clampedValue,
    animated === false ? 0 : 520,
  );
  const displayValue = animatedValue ?? clampedValue ?? 0;
  const targetProgress =
    clampedValue == null ? 0 : Math.max(0, Math.min(1, clampedValue / resolvedMax));
  const displayProgress =
    clampedValue == null ? 0 : Math.max(0, Math.min(1, displayValue / resolvedMax));
  const resolvedSize = Math.max(36, finiteGaugeNumber(size) ?? 76);
  const resolvedTickWidth = Math.max(
    2,
    Math.min(
      resolvedSize / 3,
      finiteGaugeNumber(tickWidth) ?? finiteGaugeNumber(strokeWidth) ?? 7,
    ),
  );
  const resolvedTickCount = Math.max(
    8,
    Math.min(96, Math.round(finiteGaugeNumber(tickCount) ?? 48)),
  );
  const resolvedStart = finiteGaugeNumber(startAngle) ?? -135;
  const rawSweep =
    finiteGaugeNumber(endAngle) != null
      ? finiteGaugeNumber(endAngle) - resolvedStart
      : finiteGaugeNumber(sweepAngle) ?? 270;
  const sweepDirection = rawSweep < 0 ? -1 : 1;
  const resolvedSweep =
    sweepDirection * Math.max(1, Math.min(359.99, Math.abs(rawSweep)));
  const center = resolvedSize / 2;
  const innerRadius =
    (resolvedSize / 2) *
    Math.max(0.05, Math.min(0.98, finiteGaugeNumber(innerRadiusRatio) ?? 0.68));
  const outerRadius =
    (resolvedSize / 2) *
    Math.max(0.08, Math.min(1, finiteGaugeNumber(outerRadiusRatio) ?? 0.95));
  const tickStep = Math.abs(resolvedSweep) / Math.max(resolvedTickCount - 1, 1);
  const midRadius = (innerRadius + outerRadius) / 2;
  const tickAngle = Math.max(
    0.5,
    Math.min((resolvedTickWidth / Math.max(midRadius, 1)) * (180 / Math.PI), tickStep * 0.72),
  );
  const gaugeId = `raRadialGauge-${uid}`;
  const centerValue = valueLabel ?? (
    clampedValue == null ? "—" : `${Math.round(displayValue)}${unit}`
  );
  const resolvedLabel = label ?? title;
  const hasLevelLabel = Boolean(levelLabel);
  const centerTextWidth = innerRadius * (hasLevelLabel ? 1.58 : 1.65);
  const levelTextUnits = Math.max(1, estimateGaugeTextUnits(levelLabel));
  const valueTextUnits = Math.max(1, estimateGaugeTextUnits(centerValue));
  const labelTextUnits = Math.max(1, estimateGaugeTextUnits(resolvedLabel));
  const levelFontSize = roundGaugeMetric(
    Math.max(7, Math.min(resolvedSize * 0.12, (innerRadius * 1.45) / levelTextUnits)),
  );
  const valueFontSize = roundGaugeMetric(
    Math.max(
      9,
      Math.min(
        resolvedSize * (hasLevelLabel ? 0.22 : 0.16),
        centerTextWidth / valueTextUnits,
      ),
    ),
  );
  const labelFontSize = roundGaugeMetric(
    Math.max(
      7,
      Math.min(
        resolvedSize * (hasLevelLabel ? 0.095 : 0.06),
        (innerRadius * 1.55) / labelTextUnits,
      ),
    ),
  );
  const labelOffset = roundGaugeMetric(
    Math.max(labelFontSize * 2.05, valueFontSize * (hasLevelLabel ? 1.24 : 0.74)),
  );
  const resolvedColorStops = normalizeGaugeColorStops(colorStops, tone);
  const activeCount =
    clampedValue == null ? 0 : Math.round(targetProgress * resolvedTickCount);
  const perTickMs =
    ((finiteGaugeNumber(duration) ?? 1.2) * 1000) / Math.max(activeCount, 1);
  const ticks = useMemo(
    () =>
      Array.from({ length: resolvedTickCount }, (_, index) => {
        const offset = index / Math.max(resolvedTickCount - 1, 1);
        const angleDeg = resolvedStart + offset * resolvedSweep - 90;
        const startTick = ((angleDeg - tickAngle / 2) * Math.PI) / 180;
        const endTick = ((angleDeg + tickAngle / 2) * Math.PI) / 180;
        const outerStart = {
          x: roundGaugeMetric(center + Math.cos(startTick) * outerRadius),
          y: roundGaugeMetric(center + Math.sin(startTick) * outerRadius),
        };
        const outerEnd = {
          x: roundGaugeMetric(center + Math.cos(endTick) * outerRadius),
          y: roundGaugeMetric(center + Math.sin(endTick) * outerRadius),
        };
        const innerEnd = {
          x: roundGaugeMetric(center + Math.cos(endTick) * innerRadius),
          y: roundGaugeMetric(center + Math.sin(endTick) * innerRadius),
        };
        const innerStart = {
          x: roundGaugeMetric(center + Math.cos(startTick) * innerRadius),
          y: roundGaugeMetric(center + Math.sin(startTick) * innerRadius),
        };
        return {
          index,
          offset,
          path: [
            `M ${outerStart.x} ${outerStart.y}`,
            `L ${outerEnd.x} ${outerEnd.y}`,
            `L ${innerEnd.x} ${innerEnd.y}`,
            `L ${innerStart.x} ${innerStart.y}`,
            "Z",
          ].join(" "),
        };
      }),
    [
      center,
      innerRadius,
      outerRadius,
      resolvedStart,
      resolvedSweep,
      resolvedTickCount,
      tickAngle,
    ],
  );

  return (
    <svg
      width={resolvedSize}
      height={resolvedSize}
      viewBox={`0 0 ${resolvedSize} ${resolvedSize}`}
      className={className}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel || undefined}
      focusable="false"
      data-testid="radial-stroke-gauge"
      data-progress={roundGaugeMetric(targetProgress)}
      data-display-progress={roundGaugeMetric(displayProgress)}
      data-active-count={activeCount}
      data-tick-count={resolvedTickCount}
      style={{ display: "block", overflow: "visible", ...style }}
    >
      {glow ? (
        <defs>
          <filter id={gaugeId} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      ) : null}
      {ticks.map((tick) => (
        <path
          key={`track-${tick.index}`}
          className="ra-radial-gauge-track-tick"
          d={tick.path}
          fill={trackColor}
          style={{
            "--ra-radial-gauge-track-opacity": Math.max(
              0,
              Math.min(1, finiteGaugeNumber(trackOpacity) ?? 0.54),
            ),
          }}
        />
      ))}
      {ticks.slice(0, activeCount).map((tick) => (
        <path
          key={`active-${tick.index}`}
          className={
            animated === false
              ? "ra-radial-gauge-active-tick"
              : "ra-radial-gauge-active-tick ra-radial-gauge-active-tick--animate"
          }
          d={tick.path}
          fill={gradient ? gaugeColorAt(resolvedColorStops, tick.offset) : tone}
          pathLength="1"
          filter={glow ? `url(#${gaugeId})` : undefined}
          style={{
            "--ra-radial-gauge-delay": `${Math.round(tick.index * perTickMs)}ms`,
            "--ra-radial-gauge-active-opacity": Math.max(
              0,
              Math.min(1, finiteGaugeNumber(activeOpacity) ?? 1),
            ),
          }}
        />
      ))}
      <text
        x={center}
        y={center - (hasLevelLabel ? valueFontSize * 0.22 : 0)}
        textAnchor="middle"
        dominantBaseline="central"
        fill={valueColor}
        fontFamily={T.sans}
        fontSize={valueFontSize}
        fontWeight={FONT_WEIGHTS.label}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {centerValue}
      </text>
      {levelLabel ? (
        <text
          x={center}
          y={center + valueFontSize * 0.62}
          textAnchor="middle"
          dominantBaseline="central"
          fill={levelColor || tone}
          fontFamily={T.sans}
          fontSize={levelFontSize}
          fontWeight={FONT_WEIGHTS.medium}
        >
          {levelLabel}
        </text>
      ) : null}
      {resolvedLabel ? (
        <text
          x={center}
          y={center + labelOffset}
          textAnchor="middle"
          dominantBaseline="central"
          fill={labelColor}
          fontFamily={T.sans}
          fontSize={labelFontSize}
          fontWeight={FONT_WEIGHTS.regular}
        >
          {resolvedLabel}
        </text>
      ) : null}
    </svg>
  );
};

/**
 * Variant surface helper for Pill / Badge / StatusPill.
 *
 *   "solid"   → tinted background + tone-colored text (default; existing look)
 *   "outline" → transparent bg + 1px tone border + tone text — secondary
 *               emphasis without competing with adjacent solid badges
 *   "ghost"   → transparent bg + no border + tone text — quietest variant,
 *               useful when the badge sits inside an already-tinted cell
 *
 * solidPercent controls the bg alpha for the "solid" variant so different
 * primitives can pick their own visual weight (Pill active is denser than
 * Badge default).
 */
const resolveBadgeVariantSurface = ({ variant, color, solidPercent = 8 }) => {
  if (variant === "outline") {
    return {
      background: "transparent",
      border: `1px solid ${color}`,
      color,
    };
  }
  if (variant === "ghost") {
    return {
      background: "transparent",
      border: "none",
      color,
    };
  }
  return {
    background: cssColorMix(color, solidPercent),
    border: "none",
    color,
  };
};

export const Pill = ({
  children,
  active,
  onClick,
  color,
  variant = "solid",
  ...buttonProps
}) => {
  const accent = color || CSS_COLOR.accent;
  const surface = active
    ? resolveBadgeVariantSurface({ variant, color: accent, solidPercent: 12 })
    : { background: "transparent", border: "none", color: CSS_COLOR.textSec };
  return (
    <button
      {...buttonProps}
      onClick={onClick}
      className={onClick ? "ra-interactive ra-touch-target" : undefined}
      style={{
        ...motionVars({ accent }),
        padding: sp("4px 10px"),
        fontSize: textSize("bodyStrong"),
        fontFamily: T.sans,
        fontWeight: FONT_WEIGHTS.medium,
        borderRadius: dim(RADII.pill),
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.18s ease",
        ...surface,
      }}
    >
      {children}
    </button>
  );
};

export const Badge = ({ children, color = CSS_COLOR.textDim, variant = "solid" }) => (
  <span
    style={{
      display: "inline-block",
      padding: sp("3px 9px"),
      borderRadius: dim(RADII.pill),
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.medium,
      fontFamily: T.sans,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      ...resolveBadgeVariantSurface({ variant, color, solidPercent: 8 }),
    }}
  >
    {children}
  </span>
);

/**
 * StatusPill — sentence-case sibling of Badge for live/runtime status indicators.
 * Use for status text like "Live", "Stale", "Delayed", "Connected" where eyebrow-caps
 * feels wrong. Pairs a small colored dot with the status text.
 */
export const StatusPill = ({
  children,
  color = CSS_COLOR.textMuted,
  dot = true,
  variant = "solid",
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(6),
      padding: sp("4px 10px"),
      borderRadius: dim(RADII.pill),
      fontSize: textSize("body"),
      fontWeight: FONT_WEIGHTS.medium,
      fontFamily: T.sans,
      letterSpacing: 0,
      whiteSpace: "nowrap",
      ...resolveBadgeVariantSurface({ variant, color, solidPercent: 7 }),
    }}
  >
    {dot ? (
      <span
        aria-hidden="true"
        style={{
          width: dim(6),
          height: dim(6),
          borderRadius: dim(RADII.pill),
          background: color,
          flexShrink: 0,
        }}
      />
    ) : null}
    {children}
  </span>
);

export const MetricChip = ({
  label,
  value,
  tone = CSS_COLOR.textSec,
  title,
  dot = false,
  style = {},
}) => (
  <AppMetricTooltip content={title}>
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: sp(4),
        minWidth: 0,
        padding: sp("3px 5px"),
        border: `1px solid ${cssColorMix(tone, 21)}`,
        background: cssColorMix(tone, 6),
        color: tone,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.regular,
        lineHeight: 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        ...style,
      }}
    >
      {dot ? (
        <span
          aria-hidden="true"
          style={{
            width: dim(5),
            height: dim(5),
            borderRadius: dim(RADII.pill),
            background: tone,
            flexShrink: 0,
          }}
        />
      ) : null}
      {label ? (
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: textSize("caption"),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {label}
        </span>
      ) : null}
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: tone,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </span>
  </AppMetricTooltip>
);

export const SeverityRail = ({ tone = CSS_COLOR.textDim, style = {} }) => (
  <span
    aria-hidden="true"
    style={{
      alignSelf: "stretch",
      width: dim(3),
      minHeight: dim(16),
      background: tone,
      flexShrink: 0,
      ...style,
    }}
  />
);

export const LoadingSpinner = ({ size = 18, color = CSS_COLOR.accent }) => (
  <span
    data-testid="loading-spinner"
    role="status"
    aria-label="Loading"
    style={{
      width: dim(size),
      height: dim(size),
      borderRadius: dim(RADII.pill),
      border: `2px solid ${CSS_COLOR.border}`,
      borderTopColor: color,
      animation: "premiumFlowSpin 820ms linear infinite",
      flexShrink: 0,
    }}
  />
);

const AppMetricTooltip = ({ content, children }) => {
  if (!content) {
    return children;
  }
  return (
    <span title={content} style={{ display: "inline-flex", minWidth: 0 }}>
      {children}
    </span>
  );
};

/**
 * Semantic variant config for DataUnavailableState. Each variant
 * controls (a) the title color when no explicit `tone` is given, and
 * (b) a soft accent tint at the top of the surface so the variant
 * reads at a glance without needing an icon.
 */
const DATA_STATE_VARIANT_TONES = {
  neutral: null, // falls back to CSS_COLOR.text — no accent wash
  info: () => CSS_COLOR.accent,
  error: () => CSS_COLOR.red,
  warning: () => CSS_COLOR.amber,
};

export const DataUnavailableState = ({
  title = "No live data",
  detail = "This panel is waiting on a live provider response.",
  loading = false,
  tone,
  variant = "neutral",
  icon,
  action,
  fill = false,
  minHeight = 72,
}) => {
  const variantToneFn = DATA_STATE_VARIANT_TONES[variant];
  const variantTone = variantToneFn ? variantToneFn() : null;
  const resolvedTone = tone || variantTone;
  const accentBg =
    variant === "neutral"
      ? CSS_COLOR.bg1
      : `linear-gradient(180deg, ${cssColorMix(variantTone, 5)} 0%, ${CSS_COLOR.bg1} 60%)`;
  const accentBorder =
    variant === "neutral" ? CSS_COLOR.border : cssColorMix(variantTone, 33);
  const titleColor = resolvedTone || CSS_COLOR.text;
  return (
    <div
      role={variant === "error" ? "alert" : undefined}
      className="ra-panel-enter"
      style={{
        width: "100%",
        height: fill ? "100%" : "auto",
        minHeight: dim(minHeight),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp("16px 18px"),
        textAlign: "center",
        background: accentBg,
        border: `1px dashed ${accentBorder}`,
        borderRadius: dim(RADII.md),
        color: CSS_COLOR.textMuted,
        fontFamily: T.sans,
      }}
    >
      <div style={{ maxWidth: dim(320), display: "flex", flexDirection: "column", gap: sp(6) }}>
        {icon ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              color: resolvedTone || CSS_COLOR.textMuted,
              marginBottom: sp(2),
            }}
            aria-hidden="true"
          >
            {icon}
          </div>
        ) : null}
        {loading ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: sp(4),
            }}
          >
            <LoadingSpinner color={resolvedTone || CSS_COLOR.accent} />
          </div>
        ) : null}
        <div
          style={{
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            color: titleColor,
            letterSpacing: 0,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: textSize("body"),
            lineHeight: 1.5,
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
          }}
        >
          {detail}
        </div>
        {action ? (
          <div
            style={{
              marginTop: sp(4),
              display: "flex",
              justifyContent: "center",
              gap: sp(6),
              flexWrap: "wrap",
            }}
          >
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Icon — context-aware lucide-react wrapper.
 *
 * Each "context" pre-fills size + strokeWidth defaults so the app
 * renders icons consistently across nav, inline, and control surfaces.
 * Direct lucide usage is fine for one-offs; reach for <Icon> when the
 * icon is part of a primary visual pattern (nav rail, badge prefix,
 * button leading-icon) where consistency matters.
 *
 *   context="nav"     — 18px, strokeWidth 1.5 (rail icons, primary nav)
 *   context="inline"  — 14px, strokeWidth 2   (badge prefix, status row)
 *   context="control" — 16px, strokeWidth 2   (Button leading / trailing)
 *
 *   as            — a lucide-react icon component (e.g. Search, AlertCircle)
 *   size          — override default
 *   strokeWidth   — override default
 *   color         — override default (inherits from currentColor otherwise)
 *
 * All other props (aria-*, className, style, etc.) forward to the lucide
 * component so it stays accessibility-friendly.
 */
const ICON_CONTEXT_DEFAULTS = {
  nav: { size: 18, strokeWidth: 1.5 },
  inline: { size: 14, strokeWidth: 2 },
  control: { size: 16, strokeWidth: 2 },
};

export const Icon = ({
  as: LucideIcon,
  context = "inline",
  size,
  strokeWidth,
  color,
  className,
  style,
  ...rest
}) => {
  if (!LucideIcon) return null;
  const defaults = ICON_CONTEXT_DEFAULTS[context] || ICON_CONTEXT_DEFAULTS.inline;
  return (
    <LucideIcon
      size={size ?? defaults.size}
      strokeWidth={strokeWidth ?? defaults.strokeWidth}
      color={color}
      className={className}
      style={style}
      {...rest}
    />
  );
};

/**
 * SegmentedControl — iOS / Linear-style toggle group with a sliding
 * indicator that translateX-es between option bounds on change.
 *
 *   options: string[] | { value, label }[] | { value, label, testId }[]
 *   value:   the currently-active option's value
 *   onChange(nextValue)
 *
 * The indicator is absolutely positioned behind the buttons; refs on each
 * button feed offsetLeft + offsetWidth into a useLayoutEffect that updates
 * the indicator's transform. First render hides the indicator until the
 * initial measurement lands, avoiding a 0→target flash.
 *
 * The buttons themselves stay transparent — the indicator carries the
 * "active" affordance. The text color shifts (CSS_COLOR.text vs CSS_COLOR.textDim) so the
 * label still reads as active without the button needing its own fill.
 *
 * Honor prefers-reduced-motion / data-pyrus-reduced-motion via the
 * .ra-segmented-indicator class in index.css; the snap is instant when
 * motion is reduced.
 */
export const SegmentedControl = ({
  options,
  value,
  onChange,
  onOptionIntent,
  ariaLabel,
  buttonTestId,
  radioGroup = false,
}) => {
  const containerRef = useRef(null);
  const buttonRefs = useRef(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const activeButton = buttonRefs.current.get(value);
    if (!container || !activeButton) return undefined;

    const measure = () => {
      setIndicator({
        left: activeButton.offsetLeft,
        width: activeButton.offsetWidth,
        ready: true,
      });
    };
    measure();

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(activeButton);
    observer.observe(container);
    return () => observer.disconnect();
  }, [value, normalizedOptions.length]);

  return (
    <div
      ref={containerRef}
      role={radioGroup ? "radiogroup" : "tablist"}
      aria-label={ariaLabel}
      style={{
        position: "relative",
        display: "inline-flex",
        gap: sp(2),
        padding: sp(2),
        borderRadius: dim(RADII.pill),
        background: CSS_COLOR.bg1,
      }}
    >
      <span
        aria-hidden="true"
        className="ra-segmented-indicator"
        style={{
          position: "absolute",
          top: sp(2),
          bottom: sp(2),
          left: 0,
          width: indicator.width,
          transform: `translateX(${indicator.left}px)`,
          borderRadius: dim(RADII.pill),
          background: CSS_COLOR.bg3,
          boxShadow: ELEVATION.sm,
          opacity: indicator.ready ? 1 : 0,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      {normalizedOptions.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) buttonRefs.current.set(option.value, node);
              else buttonRefs.current.delete(option.value);
            }}
            type="button"
            role={radioGroup ? "radio" : "tab"}
            aria-checked={radioGroup ? active : undefined}
            aria-selected={radioGroup ? undefined : active}
            data-testid={
              buttonTestId
                ? typeof buttonTestId === "function"
                  ? buttonTestId(option.value)
                  : `${buttonTestId}-${option.value}`
                : option.testId
            }
            className="ra-interactive"
            onFocus={() => onOptionIntent?.(option.value)}
            onMouseEnter={() => onOptionIntent?.(option.value)}
            onClick={() => onChange(option.value)}
            style={{
              position: "relative",
              zIndex: 1,
              height: dim(22),
              padding: sp("0 10px"),
              borderRadius: dim(RADII.pill),
              border: "none",
              background: "transparent",
              color: active ? CSS_COLOR.text : CSS_COLOR.textDim,
              fontSize: textSize("control"),
              fontFamily: T.sans,
              fontWeight: active ? FONT_WEIGHTS.label : FONT_WEIGHTS.medium,
              cursor: "pointer",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

/**
 * TextField — labeled <input> wrapper with focus ring, error state,
 * leading-icon / trailing-node slots, and a helper-text line.
 *
 *   label, hint, error: all optional. When error is non-empty it takes
 *   over the helper line and the wrapper switches to the red ring.
 *   leadingIcon, trailingNode: inline-flex slots flanking the input.
 *   size: "sm" (24px, default) | "md" (28px).
 *
 * The wrapper carries .ra-textfield (and conditionally
 * .ra-textfield--error). CSS in index.css handles :focus-within ring,
 * error ring, and transition. The bare <input> inside the wrapper has
 * its native focus ring removed because the wrapper paints it.
 *
 * Compose for date / search / etc. via the `type` prop.
 */
export const TextField = ({
  value,
  onChange,
  type = "text",
  placeholder,
  label,
  hint,
  error,
  leadingIcon,
  trailingNode,
  size = "sm",
  disabled = false,
  required = false,
  id,
  className,
  style,
  inputProps,
}) => {
  const hasError = Boolean(error);
  const helperText = hasError ? error : hint;
  const heightPx = size === "md" ? 28 : 24;
  return (
    <label
      htmlFor={id}
      className={className}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: sp(3),
        fontFamily: T.sans,
        ...style,
      }}
    >
      {label ? (
        <span
          style={{
            fontSize: textSize("label"),
            color: CSS_COLOR.textMuted,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: FONT_WEIGHTS.medium,
          }}
        >
          {label}
          {required ? (
            <span aria-hidden="true" style={{ color: CSS_COLOR.red, marginLeft: sp(2) }}>
              *
            </span>
          ) : null}
        </span>
      ) : null}
      <span
        className={
          hasError ? "ra-textfield ra-textfield--error" : "ra-textfield"
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(5),
          height: dim(heightPx),
          padding: sp("0 10px"),
          borderRadius: dim(RADII.sm),
          background: CSS_COLOR.bg2,
          border: `1px solid transparent`,
          color: disabled ? CSS_COLOR.textMuted : CSS_COLOR.text,
          opacity: disabled ? 0.6 : 1,
          minWidth: 0,
        }}
      >
        {leadingIcon ? (
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              color: CSS_COLOR.textMuted,
              flexShrink: 0,
            }}
          >
            {leadingIcon}
          </span>
        ) : null}
        <input
          {...inputProps}
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            border: "none",
            background: "transparent",
            outline: "none",
            color: "inherit",
            fontSize: textSize("control"),
            fontFamily: T.sans,
            padding: 0,
            ...(inputProps?.style ?? {}),
          }}
        />
        {trailingNode ? (
          <span
            style={{
              display: "inline-flex",
              color: CSS_COLOR.textMuted,
              flexShrink: 0,
            }}
          >
            {trailingNode}
          </span>
        ) : null}
      </span>
      {helperText ? (
        <span
          role={hasError ? "alert" : undefined}
          style={{
            fontSize: textSize("caption"),
            color: hasError ? CSS_COLOR.red : CSS_COLOR.textMuted,
            letterSpacing: "0.01em",
            lineHeight: 1.4,
          }}
        >
          {helperText}
        </span>
      ) : null}
    </label>
  );
};

/**
 * Skeleton — animated placeholder for loading content.
 *
 * variant: "shimmer" (default) — solid base + sweeping highlight via the
 * --ra-skeleton-base / --ra-skeleton-highlight CSS vars on a 200% gradient.
 * Use for standalone placeholders (rows, chips, avatars, blocks).
 *
 * variant: "sweep" — transparent body with a ::after pseudo-element that
 * sweeps a subtle white highlight across. Use when the placeholder sits
 * on a custom background you want to keep showing through.
 *
 * Both variants respect prefers-reduced-motion + data-pyrus-reduced-motion.
 *
 * Pass numeric RADII values for radius (defaults to RADII.xs).
 */
export const Skeleton = ({
  width = "100%",
  height = dim(12),
  radius = RADII.xs,
  variant = "shimmer",
  className = "",
  style = {},
  ...rest
}) => (
  <span
    aria-hidden="true"
    className={[
      variant === "sweep" ? "ra-skeleton" : "ra-skeleton-shimmer",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    style={{
      display: "block",
      width,
      height,
      borderRadius: dim(radius),
      ...style,
    }}
    {...rest}
  />
);

export const Card = ({
  children,
  style = {},
  noPad,
  dataZone = false,
  elevated = false,
  className,
  ...props
}) => {
  const luminousClass = elevated
    ? "ra-card-luminous-elevated"
    : "ra-card-luminous";
  const composedClassName = className
    ? `${className} ${luminousClass}`
    : luminousClass;
  return (
    <div
      {...props}
      className={composedClassName}
      style={{
        background: CSS_COLOR.bg1,
        border: `1px solid ${dataZone ? CSS_COLOR.borderLight : CSS_COLOR.border}`,
        borderRadius: dim(dataZone ? RADII.sm : RADII.md),
        padding: noPad ? 0 : sp("6px 8px"),
        overflow: "hidden",
        transition:
          "background-color var(--ra-motion-fast) var(--ra-motion-ease), border-color var(--ra-motion-fast) var(--ra-motion-ease), box-shadow var(--ra-motion-fast) var(--ra-motion-ease)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const SurfacePanel = ({
  title,
  subtitle,
  rightRail,
  action,
  children,
  compact = false,
  noPad = false,
  className,
  style = {},
  bodyStyle = {},
  ...props
}) => (
  <section
    {...props}
    className={className || "ra-panel-enter"}
    style={{
      background: CSS_COLOR.bg1,
      border: "none",
      borderRadius: dim(RADII.md),
      boxShadow: ELEVATION.sm,
      minWidth: 0,
      alignSelf: "start",
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: sp(compact ? 4 : 8),
        padding: sp(compact ? "4px 5px 3px" : "6px 10px 4px"),
        flexWrap: "wrap",
      }}
    >
      <span
        aria-hidden="true"
        className="ra-hairline-h"
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      />
      <div style={{ minWidth: 0, flex: compact ? "1 1 72px" : "1 1 180px" }}>
        <div
          style={{
            color: CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: textSize("bodyStrong"),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: 0,
          }}
        >
          {title}
        </div>
        {subtitle || rightRail ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(5),
              marginTop: sp(1),
              flexWrap: "wrap",
            }}
          >
            {subtitle ? (
              <div
                style={{
                  minWidth: 0,
                  color: CSS_COLOR.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {subtitle}
              </div>
            ) : <span />}
            {rightRail ? (
              <div
                style={{
                  minWidth: 0,
                  maxWidth: "100%",
                  color: CSS_COLOR.textDim,
                  fontFamily: T.data,
                  fontSize: textSize("label"),
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {rightRail}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {action}
    </div>
    <div style={{ padding: noPad ? 0 : sp(compact ? 4 : 6), ...bodyStyle }}>
      {children}
    </div>
  </section>
);

/**
 * ThresholdHistogram — inline distribution bar with a vertical line at
 * the current threshold position. Buckets are normalized to their max
 * count and rendered as variable-height columns. Threshold position is
 * a 0..1 ratio from min to max of the distribution domain.
 */
export const ThresholdHistogram = ({
  buckets = [],
  thresholdPosition = null,
  width = 96,
  height = 18,
}) => {
  if (!buckets.length) return null;
  const maxCount = buckets.reduce((max, count) => Math.max(max, count), 0);
  if (maxCount === 0) return null;
  const bucketWidth = width / buckets.length;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      {buckets.map((count, index) => {
        const barHeight = Math.max(1, (count / maxCount) * (height - 2));
        const x = index * bucketWidth;
        const y = height - barHeight;
        const isBeforeThreshold =
          thresholdPosition != null && index / buckets.length < thresholdPosition;
        return (
          <rect
            key={index}
            x={x + 0.5}
            y={y}
            width={Math.max(1, bucketWidth - 1)}
            height={barHeight}
            fill={isBeforeThreshold ? CSS_COLOR.green : CSS_COLOR.amber}
            opacity={count > 0 ? 0.7 : 0.2}
          />
        );
      })}
      {thresholdPosition != null ? (
        <line
          x1={thresholdPosition * width}
          x2={thresholdPosition * width}
          y1={0}
          y2={height}
          stroke={CSS_COLOR.text}
          strokeWidth="1"
          strokeDasharray="2,2"
        />
      ) : null}
    </svg>
  );
};

/**
 * ScoreBar — inline horizontal heat-bar with a tick at the value.
 * Renders a thin red→neutral→green gradient (clipped to the |value|
 * range) with a vertical tick at the value's position. Used in dense
 * tables where a numeric score is more legible as a visual bar than
 * a digit.
 */
export const ScoreBar = ({
  value,
  min = -3,
  max = 3,
  width = 64,
  height = 14,
  showNumber = true,
}) => {
  if (!Number.isFinite(Number(value))) {
    return (
      <span
        style={{
          color: CSS_COLOR.textDim,
          fontFamily: T.mono,
          fontSize: textSize("caption"),
        }}
      >
        —
      </span>
    );
  }
  const numeric = Number(value);
  const clamped = Math.max(min, Math.min(max, numeric));
  const range = max - min || 1;
  const zeroPos = ((0 - min) / range) * width;
  const valuePos = ((clamped - min) / range) * width;
  const tone =
    numeric > 0.1
      ? CSS_COLOR.green
      : numeric < -0.1
        ? CSS_COLOR.red
        : CSS_COLOR.textMuted;
  const heatGradient = [
    `${cssColorMix(CSS_COLOR.red, 20)} 0%`,
    `${cssColorMix(CSS_COLOR.red, 7)} 35%`,
    `${CSS_COLOR.bg2} 50%`,
    `${cssColorMix(CSS_COLOR.green, 7)} 65%`,
    `${cssColorMix(CSS_COLOR.green, 20)} 100%`,
  ].join(", ");
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width,
        height,
        background: `linear-gradient(to right, ${heatGradient})`,
        borderRadius: dim(RADII.xs),
        border: `1px solid ${CSS_COLOR.border}`,
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: zeroPos,
          width: 1,
          background: CSS_COLOR.border,
        }}
      />
      <span
        style={{
          position: "absolute",
          top: -1,
          bottom: -1,
          left: Math.max(0, Math.min(width - 2, valuePos - 1)),
          width: 2,
          background: tone,
          borderRadius: 1,
        }}
      />
      {showNumber ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: CSS_COLOR.text,
            fontFamily: T.mono,
            fontSize: textSize("caption"),
            lineHeight: 1,
            pointerEvents: "none",
            textShadow: `0 0 2px ${CSS_COLOR.bg1}, 0 0 2px ${CSS_COLOR.bg1}`,
          }}
        >
          {numeric.toFixed(1)}
        </span>
      ) : null}
    </span>
  );
};

/**
 * InlineFilterBar — single-row filter strip with an optional text input
 * on the left and a row of chip toggles on the right. Chips can be a
 * single-select group (`mode="single"`) or multi-select (`mode="multi"`).
 * Designed for table headers / audit logs / any list that needs quick
 * scoping without a full filter modal.
 */
export const InlineFilterBar = ({
  textValue,
  onTextChange,
  textPlaceholder = "Filter",
  chips = [],
  selectedChipIds = [],
  onChipsChange,
  mode = "single",
  right,
  dataTestId,
}) => {
  const selected = new Set(selectedChipIds);
  const toggleChip = (chipId) => {
    if (mode === "multi") {
      const next = new Set(selected);
      if (next.has(chipId)) next.delete(chipId);
      else next.add(chipId);
      onChipsChange?.(Array.from(next));
    } else {
      onChipsChange?.(selected.has(chipId) ? [] : [chipId]);
    }
  };
  return (
    <div
      data-testid={dataTestId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(8),
        flexWrap: "wrap",
        padding: sp("6px 10px"),
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        minWidth: 0,
      }}
    >
      {onTextChange ? (
        <input
          type="text"
          value={textValue || ""}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder={textPlaceholder}
          style={{
            background: CSS_COLOR.bg2,
            border: "none",
            borderRadius: dim(RADII.xs),
            color: CSS_COLOR.text,
            padding: sp("3px 8px"),
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            outline: "none",
            minWidth: 140,
          }}
        />
      ) : null}
      <div
        style={{
          display: "flex",
          gap: sp(3),
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {chips.map((chip) => {
          const isSelected = selected.has(chip.id);
          return (
            <button
              key={chip.id}
              type="button"
              data-testid={dataTestId ? `${dataTestId}-chip-${chip.id}` : undefined}
              data-selected={isSelected ? "true" : "false"}
              onClick={() => toggleChip(chip.id)}
              style={{
                padding: sp("2px 8px"),
                borderRadius: dim(RADII.pill),
                border: `1px solid ${isSelected ? CSS_COLOR.accent : CSS_COLOR.border}`,
                background: isSelected ? cssColorMix(CSS_COLOR.accent, 11) : "transparent",
                color: isSelected ? CSS_COLOR.text : CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                cursor: "pointer",
              }}
            >
              {chip.label}
              {chip.count != null ? (
                <span style={{ color: CSS_COLOR.textMuted, marginLeft: sp(3) }}>
                  {chip.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {right ? (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
          {right}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Inline-expandable table row. Renders the `row` children inside an
 * accessible button so the row itself is the toggle, and renders the
 * `expandedContent` children below when `expanded` is true. The expanded
 * region is height-animated via CSS transition; consumers control the
 * collapsed/expanded height via `rowHeight` and `expandedHeight`.
 */
export const TableExpandableRow = ({
  expanded,
  onToggle,
  rowHeight = 22,
  expandedHeight = 200,
  borderTone = CSS_COLOR.border,
  selectionAccent = CSS_COLOR.accent,
  row,
  rowClassName,
  rowStyle,
  expandedContent,
  dataTestId,
}) => (
  <div
    data-testid={dataTestId}
    data-expanded={expanded ? "true" : "false"}
    style={{
      borderBottom: `1px solid ${borderTone}`,
      minWidth: 0,
    }}
  >
    <div
      role="button"
      tabIndex={0}
      className={rowClassName}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle?.(event);
        }
      }}
      style={{
        height: rowHeight,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        borderLeft: expanded ? `3px solid ${selectionAccent}` : "3px solid transparent",
        background: expanded ? cssColorMix(selectionAccent, 6) : "transparent",
        paddingLeft: expanded ? 0 : 3,
        minWidth: 0,
        transition: "background 120ms ease, border-color 120ms ease",
        ...rowStyle,
      }}
    >
      {row}
    </div>
    <div
      style={{
        overflow: "hidden",
        maxHeight: expanded ? expandedHeight : 0,
        transition: "max-height 180ms ease",
        borderTop: expanded ? `1px solid ${borderTone}` : "none",
        background: cssColorMix(selectionAccent, 2),
      }}
    >
      {expanded ? expandedContent : null}
    </div>
  </div>
);

export const CardTitle = ({ children, right }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: sp(2),
    }}
  >
    <span
      style={{
        fontSize: textSize("bodyStrong"),
        fontWeight: FONT_WEIGHTS.label,
        fontFamily: T.sans,
        color: CSS_COLOR.text,
        letterSpacing: 0,
      }}
    >
      {children}
    </span>
    {right}
  </div>
);

/**
 * Rich tooltip body: title + optional subtitle + optional metric grid +
 * optional inline sparkline + optional caption. Drop into the existing
 * AppTooltip's `content` prop; the surrounding tooltip chrome (background,
 * border, shadow, arrow) is supplied by Radix + .ra-tooltip-content.
 */
export const RichTooltipContent = ({
  title,
  subtitle,
  metrics = [],
  sparkline = null,
  caption,
  width = 220,
}) => (
  <div
    style={{
      display: "grid",
      gap: sp(3),
      minWidth: dim(width),
      maxWidth: dim(width + 80),
      fontFamily: T.sans,
    }}
  >
    {title ? (
      <div
        style={{
          fontSize: textSize("bodyStrong"),
          color: "var(--ra-tooltip-text)",
          fontWeight: FONT_WEIGHTS.medium,
          letterSpacing: 0,
        }}
      >
        {title}
      </div>
    ) : null}
    {subtitle ? (
      <div
        style={{
          fontSize: textSize("caption"),
          color: "var(--ra-tooltip-muted)",
          lineHeight: 1.35,
        }}
      >
        {subtitle}
      </div>
    ) : null}
    {metrics.length ? (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(metrics.length, 3)}, minmax(0, 1fr))`,
          gap: sp(4),
          padding: sp("4px 0 2px"),
          borderTop: "1px solid var(--ra-tooltip-border)",
        }}
      >
        {metrics.map((metric) => (
          <div key={metric.label} style={{ display: "grid", gap: sp(1), minWidth: 0 }}>
            <div
              style={{
                fontSize: textSize("label"),
                color: "var(--ra-tooltip-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: FONT_WEIGHTS.medium,
              }}
            >
              {metric.label}
            </div>
            <div
              style={{
                fontSize: textSize("bodyStrong"),
                color: metric.tone || "var(--ra-tooltip-text)",
                fontVariantNumeric: "tabular-nums",
                fontWeight: FONT_WEIGHTS.medium,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {metric.value}
            </div>
          </div>
        ))}
      </div>
    ) : null}
    {sparkline ? (
      <div style={{ display: "flex", justifyContent: "stretch" }}>{sparkline}</div>
    ) : null}
    {caption ? (
      <div
        style={{
          fontSize: textSize("label"),
          color: "var(--ra-tooltip-muted)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {caption}
      </div>
    ) : null}
  </div>
);
