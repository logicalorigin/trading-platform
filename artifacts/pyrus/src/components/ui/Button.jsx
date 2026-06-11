import React, { forwardRef } from "react";
import { CSS_COLOR, cssColorMix, dim, ELEVATION, FONT_WEIGHTS, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";

const SIZES = {
  xs: { padding: "3px 9px", font: "caption", icon: 11, gap: 4 },
  sm: { padding: "5px 12px", font: "caption", icon: 12, gap: 5 },
  md: { padding: "7px 16px", font: "paragraphMuted", icon: 14, gap: 6 },
  lg: { padding: "10px 22px", font: "paragraph", icon: 16, gap: 8 },
};

const resolveVariant = (variant, color) => {
  const accent = color || CSS_COLOR.accent;
  switch (variant) {
    case "primary":
      return {
        background: accent,
        color: CSS_COLOR.onAccent,
        hoverBackground: cssColorMix(accent, 90),
        border: "none",
        boxShadow: ELEVATION.sm,
      };
    case "danger":
      return {
        background: CSS_COLOR.red,
        color: CSS_COLOR.onAccent,
        hoverBackground: cssColorMix(CSS_COLOR.red, 90),
        border: "none",
        boxShadow: ELEVATION.sm,
      };
    case "ghost":
      return {
        background: "transparent",
        color: CSS_COLOR.textSec,
        hoverBackground: cssColorMix(CSS_COLOR.accent, 6),
        hoverColor: CSS_COLOR.text,
        border: "none",
        boxShadow: ELEVATION.none,
      };
    case "secondary":
    default:
      return {
        background: CSS_COLOR.bg1,
        color: CSS_COLOR.text,
        hoverBackground: cssColorMix(CSS_COLOR.accent, 3),
        border: `1px solid ${CSS_COLOR.border}`,
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
      borderRadius: dim(RADII.pill),
      border: `2px solid ${cssColorMix(color, 25)}`,
      borderTopColor: color,
      animation: "pyrusBtnSpin 720ms linear infinite",
      flexShrink: 0,
    }}
  />
);

const BUTTON_CSS = `
@keyframes pyrusBtnSpin {
  to { transform: rotate(360deg); }
}
.ra-btn {
  background: var(--ra-btn-bg);
  color: var(--ra-btn-color);
  transition:
    background-color var(--ra-motion-standard) var(--ra-motion-ease),
    color var(--ra-motion-standard) var(--ra-motion-ease),
    box-shadow var(--ra-motion-standard) var(--ra-motion-ease),
    transform var(--ra-motion-micro) var(--ra-motion-ease);
}
.ra-btn:hover:not(:disabled) {
  background: var(--ra-btn-bg-hover, var(--ra-btn-bg));
  color: var(--ra-btn-color-hover, var(--ra-btn-color));
}
.ra-btn:active:not(:disabled) { transform: translateY(0.5px); }
@media (prefers-reduced-motion: reduce) {
  .ra-btn { transition: none; }
  .ra-btn:active:not(:disabled) { transform: none; }
}
`;

const renderButtonIcon = (IconSlot, size) => {
  if (!IconSlot) return null;
  if (React.isValidElement(IconSlot)) return IconSlot;
  const IconComponent = IconSlot;
  return <IconComponent size={size} />;
};

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
        style={{
          display: fullWidth ? "flex" : "inline-flex",
          width: fullWidth ? "100%" : undefined,
          alignItems: "center",
          justifyContent: "center",
          gap: sp(dims.gap),
          padding: sp(dims.padding),
          "--ra-btn-bg": v.background,
          "--ra-btn-bg-hover": v.hoverBackground,
          "--ra-btn-color": v.color,
          "--ra-btn-color-hover": v.hoverColor || v.color,
          background: "var(--ra-btn-bg)",
          color: "var(--ra-btn-color)",
          border: v.border,
          borderRadius: dim(RADII.pill),
          boxShadow: v.boxShadow,
          fontFamily: T.sans,
          fontSize: textSize(dims.font),
          fontWeight: FONT_WEIGHTS.medium,
          letterSpacing: "0.01em",
          cursor: isDisabled ? "not-allowed" : "pointer",
          opacity: isDisabled && !loading ? 0.55 : 1,
          whiteSpace: "nowrap",
          ...style,
        }}
      >
        {loading ? (
          <SpinnerIcon size={dims.icon} color={v.color} />
        ) : (
          renderButtonIcon(LeftIcon, dims.icon)
        )}
        {children}
        {!loading ? renderButtonIcon(RightIcon, dims.icon) : null}
      </button>
    </>
  );
});
