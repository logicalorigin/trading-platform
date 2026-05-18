import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";

export const Pill = ({ children, active, onClick, color, ...buttonProps }) => {
  const accent = color || T.accent;
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
        border: "none",
        borderRadius: dim(RADII.pill),
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.18s ease",
        background: active ? `${accent}1f` : "transparent",
        color: active ? accent : T.textSec,
      }}
    >
      {children}
    </button>
  );
};

export const Badge = ({ children, color = T.textDim }) => (
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
      background: `${color}14`,
      color,
      border: "none",
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
export const StatusPill = ({ children, color = T.textMuted, dot = true }) => (
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
      background: `${color}12`,
      color,
      border: "none",
      whiteSpace: "nowrap",
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
