import { useLayoutEffect, useRef, useState } from "react";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";

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

export const DataUnavailableState = ({
  title = "No live data",
  detail = "This panel is waiting on a live provider response.",
  loading = false,
  tone,
  fill = false,
  minHeight = 72,
}) => (
  <div
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
      background: T.bg1,
      border: `1px dashed ${T.border}`,
      borderRadius: dim(RADII.md),
      color: T.textMuted,
      fontFamily: T.sans,
    }}
  >
    <div style={{ maxWidth: dim(320), display: "flex", flexDirection: "column", gap: sp(6) }}>
      {loading ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: sp(4),
          }}
        >
          <LoadingSpinner color={tone || T.accent} />
        </div>
      ) : null}
      <div
        style={{
          fontSize: textSize("paragraphMuted"),
          fontWeight: FONT_WEIGHTS.medium,
          color: tone || T.text,
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
    </div>
  </div>
);

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
        padding: noPad ? 0 : sp(dataZone ? "6px 8px" : "8px 10px"),
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

export const CardTitle = ({ children, right }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: sp(3),
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
