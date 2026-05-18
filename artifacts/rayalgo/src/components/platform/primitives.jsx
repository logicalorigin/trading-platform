import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";

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
 * MicroSparkline — green/red line + soft area fill + glowing tail dot.
 * Used in PlatformWatchlist rows, HeaderKpiStrip, and (via RowSparkValue)
 * any row primitive that wants an inline trend indicator.
 *
 *   data       — array of points (any of the shapes extractSparklineValues handles)
 *   positive   — boolean override; null/undefined infers from first-vs-last value
 *   width/height — SVG viewBox size in dim() units before scaling
 *
 * Returns null when fewer than 2 valid points are available so callers
 * don't have to feature-check.
 */
export const MicroSparkline = ({
  data = [],
  positive = null,
  width = 64,
  height = 24,
}) => {
  const values = useMemo(() => extractSparklineValues(data), [data]);
  const uid = useId().replace(/:/g, "");

  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const inferredPositive = values[values.length - 1] >= values[0];
  const resolvedPositive =
    typeof positive === "boolean" ? positive : inferredPositive;
  const lineColor = resolvedPositive ? T.green : T.red;
  const plottedPoints = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * Math.max(height - 2, 1) - 1;
    return [x.toFixed(2), y.toFixed(2)];
  });
  const points = plottedPoints.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPath = `M ${plottedPoints
    .map(([x, y], index) => `${index === 0 ? "" : "L "}${x},${y}`)
    .join(" ")} L ${width},${height} L 0,${height} Z`;
  const [tailX, tailY] = plottedPoints[plottedPoints.length - 1];
  const gradientId = `raSparkGrad-${uid}`;
  const glowId = `raSparkGlow-${uid}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.32" />
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
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.55"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        className="ra-sparkline-tail"
        cx={tailX}
        cy={tailY}
        r="1.6"
        fill={lineColor}
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
          color: T.text,
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
          color: T.textDim,
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

/**
 * Variant surface helper for Pill / Badge / StatusPill.
 *
 *   "solid"   → tinted background + tone-colored text (default; existing look)
 *   "outline" → transparent bg + 1px tone border + tone text — secondary
 *               emphasis without competing with adjacent solid badges
 *   "ghost"   → transparent bg + no border + tone text — quietest variant,
 *               useful when the badge sits inside an already-tinted cell
 *
 * solidAlpha controls the bg alpha for the "solid" variant so different
 * primitives can pick their own visual weight (Pill active is denser than
 * Badge default).
 */
const resolveBadgeVariantSurface = ({ variant, color, solidAlpha = "14" }) => {
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
    background: `${color}${solidAlpha}`,
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
  const accent = color || T.accent;
  const surface = active
    ? resolveBadgeVariantSurface({ variant, color: accent, solidAlpha: "1f" })
    : { background: "transparent", border: "none", color: T.textSec };
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

export const Badge = ({ children, color = T.textDim, variant = "solid" }) => (
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
      ...resolveBadgeVariantSurface({ variant, color, solidAlpha: "14" }),
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
  color = T.textMuted,
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
      letterSpacing: "-0.005em",
      whiteSpace: "nowrap",
      ...resolveBadgeVariantSurface({ variant, color, solidAlpha: "12" }),
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
  tone = T.textSec,
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
        border: `1px solid ${tone}36`,
        background: `${tone}10`,
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
            color: T.textMuted,
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

export const SeverityRail = ({ tone = T.textDim, style = {} }) => (
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

export const LoadingSpinner = ({ size = 18, color = T.accent }) => (
  <span
    data-testid="loading-spinner"
    role="status"
    aria-label="Loading"
    style={{
      width: dim(size),
      height: dim(size),
      borderRadius: dim(RADII.pill),
      border: `2px solid ${T.border}`,
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
  neutral: null, // falls back to T.text — no accent wash
  info: () => T.accent,
  error: () => T.red,
  warning: () => T.amber,
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
      ? T.bg1
      : `linear-gradient(180deg, ${variantTone}0e 0%, ${T.bg1} 60%)`;
  const accentBorder =
    variant === "neutral" ? T.border : `${variantTone}55`;
  const titleColor = resolvedTone || T.text;
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
        color: T.textMuted,
        fontFamily: T.sans,
      }}
    >
      <div style={{ maxWidth: dim(320), display: "flex", flexDirection: "column", gap: sp(6) }}>
        {icon ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              color: resolvedTone || T.textMuted,
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
            <LoadingSpinner color={resolvedTone || T.accent} />
          </div>
        ) : null}
        <div
          style={{
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            color: titleColor,
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: textSize("body"),
            lineHeight: 1.5,
            color: T.textMuted,
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
 * "active" affordance. The text color shifts (T.text vs T.textDim) so the
 * label still reads as active without the button needing its own fill.
 *
 * Honor prefers-reduced-motion / data-rayalgo-reduced-motion via the
 * .ra-segmented-indicator class in index.css; the snap is instant when
 * motion is reduced.
 */
export const SegmentedControl = ({
  options,
  value,
  onChange,
  ariaLabel,
  buttonTestId,
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
      role="tablist"
      aria-label={ariaLabel}
      style={{
        position: "relative",
        display: "inline-flex",
        gap: sp(2),
        padding: sp(2),
        borderRadius: dim(RADII.pill),
        background: T.bg1,
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
          background: T.bg3,
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
            role="tab"
            aria-selected={active}
            data-testid={
              buttonTestId
                ? typeof buttonTestId === "function"
                  ? buttonTestId(option.value)
                  : `${buttonTestId}-${option.value}`
                : option.testId
            }
            className="ra-interactive"
            onClick={() => onChange(option.value)}
            style={{
              position: "relative",
              zIndex: 1,
              height: dim(22),
              padding: sp("0 10px"),
              borderRadius: dim(RADII.pill),
              border: "none",
              background: "transparent",
              color: active ? T.text : T.textDim,
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
            color: T.textMuted,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: FONT_WEIGHTS.medium,
          }}
        >
          {label}
          {required ? (
            <span aria-hidden="true" style={{ color: T.red, marginLeft: sp(2) }}>
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
          background: T.bg2,
          border: `1px solid transparent`,
          color: disabled ? T.textMuted : T.text,
          opacity: disabled ? 0.6 : 1,
          minWidth: 0,
        }}
      >
        {leadingIcon ? (
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              color: T.textMuted,
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
              color: T.textMuted,
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
            color: hasError ? T.red : T.textMuted,
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
 * Both variants respect prefers-reduced-motion + data-rayalgo-reduced-motion.
 *
 * Pass numeric RADII values for radius (defaults to RADII.xs).
 */
/**
 * Button — single consistent primitive for click targets.
 *
 *   variant: "primary" — accent fill, on-accent text. Default emphasis.
 *   variant: "secondary" — bg2 fill, primary text. Quiet emphasis.
 *   variant: "ghost" — transparent + textSec. Tertiary, inline.
 *   variant: "tonal" — colored tint of `tone` (default accent) with tone text.
 *   variant: "danger" — red fill, white text. Destructive only.
 *
 *   size: "xs" (20px), "sm" (24px), "md" (28px). Default sm.
 *
 *   leftIcon / rightIcon: ReactNode, rendered with a 6px gap on the
 *   appropriate side. Use lucide-react icons sized 14 / 16 / 18.
 *
 *   loading: replaces children with a small LoadingSpinner + sets
 *   aria-busy. The button is disabled while loading.
 *
 *   tone: only meaningful for variant="tonal"; defaults to T.accent.
 *
 * Composes .ra-interactive so hover gets the standard -1px lift + 60ms
 * active press. Forwards any extra props to the underlying <button>.
 */
const BUTTON_SIZES = {
  xs: { height: 20, paddingX: 8, fontKey: "label", iconGap: 5 },
  sm: { height: 24, paddingX: 12, fontKey: "control", iconGap: 6 },
  md: { height: 28, paddingX: 14, fontKey: "bodyStrong", iconGap: 7 },
};

const resolveButtonSurface = ({ variant, tone, disabled }) => {
  if (variant === "primary") {
    return { background: T.accent, color: T.onAccent, border: "none" };
  }
  if (variant === "danger") {
    return { background: T.red, color: T.onAccent, border: "none" };
  }
  if (variant === "secondary") {
    return { background: T.bg2, color: T.text, border: "none" };
  }
  if (variant === "ghost") {
    return { background: "transparent", color: T.textSec, border: "none" };
  }
  // tonal
  return {
    background: `${tone}1f`,
    color: tone,
    border: "none",
  };
};

export const Button = ({
  children,
  variant = "secondary",
  size = "sm",
  tone,
  leftIcon,
  rightIcon,
  loading = false,
  disabled = false,
  type = "button",
  className,
  style,
  onClick,
  ...rest
}) => {
  const resolvedTone = tone || T.accent;
  const sizing = BUTTON_SIZES[size] || BUTTON_SIZES.sm;
  const surface = resolveButtonSurface({
    variant,
    tone: resolvedTone,
    disabled,
  });
  const isDisabled = disabled || loading;
  // primary / danger variants are elevated — base ELEVATION.sm plus the
  // accent-tinted ELEVATION.hover overlay on hover. .ra-button-elevated
  // (in index.css) composes the two via box-shadow's comma list.
  const isElevated = variant === "primary" || variant === "danger";
  return (
    <button
      {...rest}
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "ra-interactive",
        "ra-touch-target",
        isElevated ? "ra-button-elevated" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(sizing.iconGap),
        height: dim(sizing.height),
        padding: sp(`0 ${sizing.paddingX}px`),
        borderRadius: dim(RADII.pill),
        fontSize: textSize(sizing.fontKey),
        fontFamily: T.sans,
        fontWeight: variant === "primary" || variant === "danger"
          ? FONT_WEIGHTS.label
          : FONT_WEIGHTS.medium,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled && !loading ? 0.55 : 1,
        whiteSpace: "nowrap",
        ...surface,
        ...style,
      }}
    >
      {loading ? (
        <LoadingSpinner size={Math.max(10, sizing.height - 10)} color={surface.color} />
      ) : (
        <>
          {leftIcon ? <span aria-hidden="true" style={{ display: "inline-flex" }}>{leftIcon}</span> : null}
          <span>{children}</span>
          {rightIcon ? <span aria-hidden="true" style={{ display: "inline-flex" }}>{rightIcon}</span> : null}
        </>
      )}
    </button>
  );
};

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
        background: T.bg1,
        border: `1px solid ${dataZone ? T.borderLight : T.border}`,
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
            fill={isBeforeThreshold ? T.green : T.amber}
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
          stroke={T.text}
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
          color: T.textDim,
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
  const tone = numeric > 0.1 ? T.green : numeric < -0.1 ? T.red : T.textMuted;
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width,
        height,
        background: `linear-gradient(to right, ${T.red}33 0%, ${T.red}11 35%, ${T.bg2} 50%, ${T.green}11 65%, ${T.green}33 100%)`,
        borderRadius: dim(RADII.xs),
        border: `1px solid ${T.border}`,
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
          background: T.border,
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
            color: T.text,
            fontFamily: T.mono,
            fontSize: textSize("caption"),
            lineHeight: 1,
            pointerEvents: "none",
            textShadow: `0 0 2px ${T.bg1}, 0 0 2px ${T.bg1}`,
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
        background: T.bg1,
        border: `1px solid ${T.border}`,
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
            background: T.bg2,
            border: "none",
            borderRadius: dim(RADII.xs),
            color: T.text,
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
                border: `1px solid ${isSelected ? T.accent : T.border}`,
                background: isSelected ? `${T.accent}1c` : "transparent",
                color: isSelected ? T.text : T.textDim,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                cursor: "pointer",
              }}
            >
              {chip.label}
              {chip.count != null ? (
                <span style={{ color: T.textMuted, marginLeft: sp(3) }}>
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
  borderTone = T.border,
  selectionAccent = T.accent,
  row,
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
        background: expanded ? `${selectionAccent}10` : "transparent",
        paddingLeft: expanded ? 0 : 3,
        minWidth: 0,
        transition: "background 120ms ease, border-color 120ms ease",
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
        background: `${selectionAccent}06`,
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
        fontSize: textSize("displaySmall"),
        fontWeight: FONT_WEIGHTS.medium,
        fontFamily: T.sans,
        color: T.text,
        letterSpacing: "-0.01em",
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
          letterSpacing: "-0.005em",
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
