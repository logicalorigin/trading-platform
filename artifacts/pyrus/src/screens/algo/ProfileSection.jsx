import {
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

export const ProfileSection = ({
  id,
  title,
  summary,
  expanded,
  onToggle,
  children,
}) => {
  return (
    <div
      data-testid={`algo-profile-section-${id}`}
      data-state={expanded ? "expanded" : "collapsed"}
      style={{
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="ra-interactive ra-touch-target"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          padding: sp("9px 11px"),
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          minWidth: 0,
        }}
      >
        {expanded ? (
          <ChevronDown size={13} color={CSS_COLOR.textSec} />
        ) : (
          <ChevronRight size={13} color={CSS_COLOR.textDim} />
        )}
        <span
          style={{
            color: CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: fs(11),
            fontWeight: FONT_WEIGHTS.regular,
            letterSpacing: "0.02em",
            flexShrink: 0,
          }}
        >
          {title}
        </span>
        {summary ? (
          <span
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: fs(8),
              letterSpacing: "0.04em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
              textAlign: "right",
            }}
          >
            {summary}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div
          style={{
            padding: sp("0 11px 11px"),
            display: "grid",
            gap: sp(8),
            minWidth: 0,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};
