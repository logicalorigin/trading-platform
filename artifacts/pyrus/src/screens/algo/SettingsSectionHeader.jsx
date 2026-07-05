import { ChevronRight } from "lucide-react";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  T,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";

const HeaderChevron = ({ open }) => (
  <ChevronRight
    size={11}
    strokeWidth={1.8}
    aria-hidden="true"
    style={{
      flex: "0 0 auto",
      transform: open ? "rotate(90deg)" : "rotate(0deg)",
      transition: "transform var(--ra-motion-fast) ease",
    }}
  />
);

const labelStyle = {
  // Section anchor: outranks field labels (9px textSec) by size + color so the
  // panel chunks into sections at a glance instead of reading as one flat wall.
  color: CSS_COLOR.textSec,
  fontFamily: T.sans,
  fontSize: textSize("bodyStrong"),
  fontWeight: FONT_WEIGHTS.emphasis,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const helperStyle = {
  color: CSS_COLOR.textMuted,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const SettingsSectionHeader = ({
  label,
  helper,
  collapsible = false,
  open = true,
  onToggle,
  controlsId,
}) => {
  if (collapsible && onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controlsId}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(4),
          width: "100%",
          padding: 0,
          paddingBottom: sp(3),
          marginBottom: sp(2),
          border: "none",
          borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span
          style={{
            ...labelStyle,
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            minWidth: 0,
          }}
        >
          <HeaderChevron open={open} />
          {label}
        </span>
        {helper ? <span style={helperStyle}>{helper}</span> : null}
      </button>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: sp(4),
        paddingBottom: sp(3),
        borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
        marginBottom: sp(2),
        minWidth: 0,
      }}
    >
      <span style={labelStyle}>{label}</span>
      {helper ? <span style={helperStyle}>{helper}</span> : null}
    </div>
  );
};

export default SettingsSectionHeader;
