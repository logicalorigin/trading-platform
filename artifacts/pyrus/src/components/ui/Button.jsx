import React, { forwardRef } from "react";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";

const CSS_COLOR = {
  bg1: "var(--ra-surface-1)",
  border: "var(--ra-border-default)",
  text: "var(--ra-text-primary)",
  textSec: "var(--ra-text-secondary)",
  accent: "var(--ra-color-accent)",
  red: "var(--ra-red-500)",
  onAccent: "var(--ra-on-accent)",
};

const cssColorMix = (color, percent) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

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
        ) : LeftIcon ? (
          <LeftIcon size={dims.icon} />
        ) : null}
        {children}
        {!loading && RightIcon ? <RightIcon size={dims.icon} /> : null}
      </button>
    </>
  );
});
