import {
  Activity,
  CheckCircle2,
  CircleAlert,
  RadioTower,
  XCircle,
} from "lucide-react";
import React from "react";
import {
  ELEVATION,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { AppTooltip } from "../../components/ui/tooltip";
import {
  isAlertToastKind,
  normalizeToastKind,
  TOAST_OVERLAY_Z_INDEX,
} from "./toastModel.js";

const CSS_COLOR = Object.freeze({
  bg1: "var(--ra-surface-1)",
  text: "var(--ra-text-primary)",
  textSec: "var(--ra-text-secondary)",
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
  green: "var(--ra-green-500)",
  red: "var(--ra-red-500)",
  amber: "var(--ra-amber-500)",
});

const cssColorMix = (color, percent) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

export const resolveToastVisuals = (kind) => {
  const normalizedKind = normalizeToastKind(kind);
  if (normalizedKind === "success") {
    return { kind: normalizedKind, color: CSS_COLOR.green, Icon: CheckCircle2 };
  }
  if (normalizedKind === "error") {
    return { kind: normalizedKind, color: CSS_COLOR.red, Icon: XCircle };
  }
  if (normalizedKind === "warn") {
    return { kind: normalizedKind, color: CSS_COLOR.amber, Icon: CircleAlert };
  }
  if (normalizedKind === "algo") {
    return { kind: normalizedKind, color: CSS_COLOR.accent, Icon: RadioTower };
  }
  return { kind: normalizedKind, color: CSS_COLOR.accent, Icon: Activity };
};

export const ToastStack = ({ toasts = [], onDismiss, bottomOffset = 20 }) =>
  toasts.length ? (
    <div
      data-testid="toast-stack"
      aria-live="polite"
      aria-relevant="additions text"
      style={{
        position: "fixed",
        bottom: dim(bottomOffset),
        right: dim(20),
        zIndex: TOAST_OVERLAY_Z_INDEX,
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => {
        const { kind, color, Icon: ToastIcon } = resolveToastVisuals(toast.kind);
        return (
          <AppTooltip key={toast.id} content="Click to dismiss">
            <div
              data-testid="toast-item"
              data-toast-kind={kind}
              role={isAlertToastKind(kind) ? "alert" : "status"}
              aria-atomic="true"
              onClick={() => onDismiss?.(toast.id)}
              style={{
                background: CSS_COLOR.bg1,
                border: `1px solid ${cssColorMix(color, 20)}`,
                borderRadius: dim(RADII.xs),
                padding: sp("8px 10px"),
                minWidth: dim(244),
                maxWidth: dim(330),
                boxShadow: ELEVATION.sm,
                animation: toast.leaving
                  ? "toastSlideOut 0.2s ease-in forwards"
                  : "toastSlideIn 0.22s ease-out",
                pointerEvents: "auto",
                cursor: "pointer",
                transition:
                  "background 0.12s ease, transform 0.12s ease, border-color 0.12s ease",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = `${cssColorMix(color, 6)}`;
                event.currentTarget.style.borderColor = `${cssColorMix(color, 33)}`;
                event.currentTarget.style.transform = "translateX(-2px)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = CSS_COLOR.bg1;
                event.currentTarget.style.borderColor = `${cssColorMix(color, 20)}`;
                event.currentTarget.style.transform = "translateX(0)";
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: sp(8),
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: dim(20),
                    height: dim(20),
                    borderRadius: dim(RADII.xs),
                    background: `${cssColorMix(color, 7)}`,
                    color,
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  <ToastIcon size={dim(13)} strokeWidth={2.3} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: textSize("paragraphMuted"),
                      fontWeight: FONT_WEIGHTS.medium,
                      letterSpacing: 0,
                      color: CSS_COLOR.text,
                      marginBottom: toast.body ? sp(2) : 0,
                    }}
                  >
                    {toast.title}
                  </div>
                  {toast.body ? (
                    <div
                      style={{
                        fontSize: textSize("body"),
                        color: CSS_COLOR.textSec,
                        fontFamily: T.sans,
                        lineHeight: 1.35,
                      }}
                    >
                      {toast.body}
                    </div>
                  ) : null}
                </div>
                <span
                  style={{
                    fontSize: textSize("caption"),
                    color: CSS_COLOR.textMuted,
                    fontWeight: FONT_WEIGHTS.medium,
                    opacity: 0.6,
                    marginLeft: sp(4),
                    marginTop: sp(2),
                  }}
                >
                  x
                </span>
              </div>
            </div>
          </AppTooltip>
        );
      })}
    </div>
  ) : null;
