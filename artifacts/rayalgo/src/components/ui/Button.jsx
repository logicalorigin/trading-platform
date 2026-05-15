import { forwardRef } from "react";
import { ELEVATION, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";

const SIZES = {
  sm: { padding: "5px 12px", font: "caption", icon: 12, gap: 5 },
  md: { padding: "7px 16px", font: "paragraphMuted", icon: 14, gap: 6 },
  lg: { padding: "10px 22px", font: "paragraph", icon: 16, gap: 8 },
};

const resolveVariant = (variant, color) => {
  const accent = color || T.accent;
  switch (variant) {
    case "primary":
      return {
        background: accent,
        color: T.onAccent,
        hoverBackground: `${accent}E6`,
        border: "none",
        boxShadow: ELEVATION.sm,
      };
    case "danger":
      return {
        background: T.red,
        color: T.onAccent,
        hoverBackground: `${T.red}E6`,
        border: "none",
        boxShadow: ELEVATION.sm,
      };
    case "ghost":
      return {
        background: "transparent",
        color: T.textSec,
        hoverBackground: T.bg2,
        hoverColor: T.text,
        border: "none",
        boxShadow: ELEVATION.none,
      };
    case "secondary":
    default:
      return {
        background: T.bg2,
        color: T.text,
        hoverBackground: T.bg3,
        border: "none",
        boxShadow: ELEVATION.none,
      };
  }
};

const SpinnerIcon = ({ size = 14, color = "currentColor" }) => (
  <span
    role="status"
    aria-label="Loading"
    style={{
      display: "inline-block",
      width: dim(size),
      height: dim(size),
      borderRadius: "50%",
      border: `2px solid ${color}40`,
      borderTopColor: color,
      animation: "rayalgoBtnSpin 720ms linear infinite",
      flexShrink: 0,
    }}
  />
);

const BUTTON_CSS = `
@keyframes rayalgoBtnSpin {
  to { transform: rotate(360deg); }
}
.ra-btn { transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.12s ease; }
.ra-btn:active:not(:disabled) { transform: translateY(0.5px); }
@media (prefers-reduced-motion: reduce) {
  .ra-btn { transition: none; }
  .ra-btn:active:not(:disabled) { transform: none; }
}
`;

export const Button = forwardRef(function Button(
  {
    variant = "secondary",
    size = "md",
    color,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    loading = false,
    disabled = false,
    fullWidth = false,
    children,
    style,
    onMouseEnter,
    onMouseLeave,
    dataTestId,
    type = "button",
    ...rest
  },
  ref,
) {
  const dims = SIZES[size] || SIZES.md;
  const v = resolveVariant(variant, color);
  const isDisabled = disabled || loading;

  return (
    <>
      <style>{BUTTON_CSS}</style>
      <button
        {...rest}
        ref={ref}
        type={type}
        disabled={isDisabled}
        data-testid={dataTestId}
        className="ra-btn ra-touch-target"
        onMouseEnter={(event) => {
          if (!isDisabled) {
            event.currentTarget.style.background = v.hoverBackground;
            if (v.hoverColor) event.currentTarget.style.color = v.hoverColor;
          }
          onMouseEnter?.(event);
        }}
        onMouseLeave={(event) => {
          if (!isDisabled) {
            event.currentTarget.style.background = v.background;
            event.currentTarget.style.color = v.color;
          }
          onMouseLeave?.(event);
        }}
        style={{
          display: fullWidth ? "flex" : "inline-flex",
          width: fullWidth ? "100%" : undefined,
          alignItems: "center",
          justifyContent: "center",
          gap: sp(dims.gap),
          padding: sp(dims.padding),
          background: v.background,
          color: v.color,
          border: v.border,
          borderRadius: dim(RADII.pill),
          boxShadow: v.boxShadow,
          fontFamily: T.sans,
          fontSize: textSize(dims.font),
          fontWeight: 500,
          letterSpacing: "0.01em",
          cursor: isDisabled ? "not-allowed" : "pointer",
          opacity: isDisabled && !loading ? 0.55 : 1,
          whiteSpace: "nowrap",
          ...style,
        }}
      >
        {loading ? (
          <SpinnerIcon size={dims.icon} color={v.color} />
        ) : LeftIcon ? (
          <LeftIcon size={dims.icon} />
        ) : null}
        {children}
        {!loading && RightIcon ? <RightIcon size={dims.icon} /> : null}
      </button>
    </>
  );
});
