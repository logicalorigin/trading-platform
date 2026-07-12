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
    case "soft":
      // Neutral utility chip (flat bg2 fill, no border) — the shared form of the
      // former hand-rolled smallButton() default.
      return {
        background: CSS_COLOR.bg2,
        color: CSS_COLOR.text,
        hoverBackground: cssColorMix(CSS_COLOR.accent, 4),
        border: "none",
        boxShadow: ELEVATION.none,
        fontWeight: FONT_WEIGHTS.medium,
      };
    case "soft-selected":
      // Selected/active chip: accent TINT + accent text (selection = accent, never
      // a solid fill; green stays reserved for financial-gain/operational-health).
      return {
        background: CSS_COLOR.accentActiveBg,
        color: CSS_COLOR.accent,
        hoverBackground: CSS_COLOR.accentActiveBg,
        border: "none",
        boxShadow: ELEVATION.none,
        fontWeight: FONT_WEIGHTS.label,
      };
    case "soft-danger":
      // Subtle danger chip: red tint + red text (not the loud solid danger fill).
      return {
        background: cssColorMix(CSS_COLOR.red, 9),
        color: CSS_COLOR.red,
        hoverBackground: cssColorMix(CSS_COLOR.red, 14),
        border: "none",
        boxShadow: ELEVATION.none,
        fontWeight: FONT_WEIGHTS.label,
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
    className="ra-btn-spinner"
    role="status"
    aria-label="Loading"
    style={{
      display: "inline-block",
      width: dim(size),
      height: dim(size),
      borderRadius: dim(RADII.pill),
      border: `2px solid ${cssColorMix(color, 25)}`,
      borderTopColor: color,
      flexShrink: 0,
    }}
  />
);

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
        fontWeight: v.fontWeight || FONT_WEIGHTS.medium,
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
  );
});
