import { T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";

export const Pill = ({ children, active, onClick, color }) => (
  <button
    onClick={onClick}
    className={onClick ? "ra-interactive" : undefined}
    style={{
      ...motionVars({ accent: color || T.accent }),
      padding: sp("3px 7px"),
      fontSize: textSize("bodyStrong"),
      fontFamily: T.sans,
      fontWeight: 400,
      border: `1px solid ${active ? color || T.accent : T.border}`,
      borderRadius: dim(4),
      cursor: "pointer",
      transition: "all 0.15s",
      background: active ? `${color || T.accent}18` : "transparent",
      color: active ? color || T.accent : T.textDim,
    }}
  >
    {children}
  </button>
);

export const Badge = ({ children, color = T.textDim }) => (
  <span
    style={{
      display: "inline-block",
      padding: sp("1px 6px"),
      borderRadius: dim(3),
      fontSize: textSize("caption"),
      fontWeight: 400,
      fontFamily: T.data,
      letterSpacing: "0.04em",
      background: `${color}18`,
      color,
      border: `1px solid ${color}30`,
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

export const Card = ({ children, style = {}, noPad, ...props }) => (
  <div
    {...props}
    style={{
      background: T.bg1,
      border: `1px solid ${T.border}`,
      borderRadius: 0,
      padding: noPad ? 0 : "8px 10px",
      overflow: "hidden",
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
      marginBottom: 4,
    }}
  >
    <span
      style={{
        fontSize: textSize("body"),
        fontWeight: 400,
        fontFamily: T.display,
        color: T.textSec,
        letterSpacing: "0.03em",
      }}
    >
      {children}
    </span>
    {right}
  </div>
);
