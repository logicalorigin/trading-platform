import { ELEVATION, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
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
        fontWeight: 500,
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
      padding: sp("2px 8px"),
      borderRadius: dim(RADII.pill),
      fontSize: textSize("caption"),
      fontWeight: 500,
      fontFamily: T.sans,
      letterSpacing: "0.02em",
      background: `${color}14`,
      color,
      border: "none",
    }}
  >
    {children}
  </span>
);

export const LoadingSpinner = ({ size = 18, color = T.accent }) => (
  <span
    data-testid="loading-spinner"
    role="status"
    aria-label="Loading"
    style={{
      width: dim(size),
      height: dim(size),
      borderRadius: "50%",
      border: `2px solid ${T.border}`,
      borderTopColor: color,
      animation: "premiumFlowSpin 820ms linear infinite",
      flexShrink: 0,
    }}
  />
);

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
      padding: sp("8px 10px"),
      textAlign: "center",
      background: T.bg0,
      border: `1px dashed ${T.border}`,
      borderRadius: dim(4),
      color: T.textDim,
      fontFamily: T.sans,
    }}
  >
    <div style={{ maxWidth: dim(260) }}>
      {loading ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: sp(8),
          }}
        >
          <LoadingSpinner color={tone || T.accent} />
        </div>
      ) : null}
      <div
        style={{
          fontSize: textSize("body"),
          fontWeight: 400,
          color: tone || T.textSec,
          letterSpacing: "0.04em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: sp(4),
          fontSize: textSize("caption"),
          lineHeight: 1.45,
          fontFamily: T.data,
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
  ...props
}) => (
  <div
    {...props}
    style={{
      background: dataZone ? T.bg2 : T.bg1,
      border: dataZone ? `1px solid ${T.border}` : "none",
      borderRadius: dim(dataZone ? RADII.sm : RADII.md),
      padding: noPad ? 0 : sp(dataZone ? "10px 12px" : "14px 16px"),
      overflow: "hidden",
      boxShadow: elevated ? ELEVATION.sm : ELEVATION.none,
      transition:
        "background-color var(--ra-motion-fast) var(--ra-motion-ease), border-color var(--ra-motion-fast) var(--ra-motion-ease), box-shadow var(--ra-motion-fast) var(--ra-motion-ease)",
      ...style,
    }}
  >
    {children}
  </div>
);

export const CardTitle = ({ children, right }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: sp(6),
    }}
  >
    <span
      style={{
        fontSize: textSize("displaySmall"),
        fontWeight: 500,
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
