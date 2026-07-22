import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  X,
  XCircle,
} from "lucide-react";
import React from "react";
import { CSS_COLOR, cssColorMix, dim, ELEVATION, FONT_WEIGHTS, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
import { AppTooltip } from "../../components/ui/tooltip";
import { BrokerLogoBubbles } from "../../components/brand/BrokerLogoBubbles.jsx";
import {
  isAlertToastKind,
  normalizeToastKind,
  orderToastsForDisplay,
  TOAST_OVERLAY_Z_INDEX,
} from "./toastModel.js";

const KIND_LABELS = {
  success: "Success",
  error: "Error",
  warn: "Warning",
  algo: "Algo",
  info: "Info",
};

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
    return { kind: normalizedKind, color: CSS_COLOR.accent, Icon: Bot };
  }
  return { kind: normalizedKind, color: CSS_COLOR.accent, Icon: Activity };
};

export const ToastStack = ({
  toasts = [],
  onDismiss,
  bottomOffset = 20,
  maxVisible = 3,
}) => {
  const visibleToasts = orderToastsForDisplay(toasts, maxVisible);
  return visibleToasts.length ? (
    <div
      data-testid="toast-stack"
      style={{
        position: "fixed",
        bottom: dim(bottomOffset),
        right: "min(20px, 2vw)",
        maxWidth: "calc(100vw - 16px)",
        zIndex: TOAST_OVERLAY_Z_INDEX,
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        pointerEvents: "none",
      }}
    >
      {visibleToasts.map((toast) => {
        const { kind, color, Icon: ToastIcon } = resolveToastVisuals(toast.kind);
        const kindLabel = KIND_LABELS[kind] || KIND_LABELS.info;
        const dismiss = () => onDismiss?.(toast.id);
        return (
          <AppTooltip key={toast.id} content="Click to dismiss">
            <div
              data-testid="toast-item"
              data-toast-kind={kind}
              role={isAlertToastKind(kind) ? "alert" : "status"}
              aria-atomic="true"
              onClick={dismiss}
              className="ra-h-toast ra-toast-item"
              style={{
                position: "relative",
                overflow: "hidden",
                background: CSS_COLOR.bg1,
                border: `1px solid ${cssColorMix(color, 20)}`,
                "--toast-h-bg": cssColorMix(color, 6),
                "--toast-h-bd": cssColorMix(color, 33),
                borderRadius: dim(RADII.sm),
                padding: sp("8px 10px 8px 13px"),
                minWidth: "min(252px, calc(100vw - 16px))",
                maxWidth: "min(340px, calc(100vw - 16px))",
                boxShadow: ELEVATION.sm,
                animation: toast.leaving
                  ? "toastSlideOut 0.2s ease-in forwards"
                  : "toastSlideIn 0.22s ease-out",
                pointerEvents: "auto",
                cursor: "pointer",
                transition:
                  "background var(--ra-motion-fast) ease, transform var(--ra-motion-fast) ease, border-color var(--ra-motion-fast) ease",
              }}
            >
              {/* kind-colored accent rail */}
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: dim(3),
                  background: color,
                }}
              />
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
                    background: `${cssColorMix(color, 12)}`,
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
                      fontSize: textSize("label"),
                      fontWeight: FONT_WEIGHTS.label,
                      letterSpacing: "0.07em",
                      textTransform: "uppercase",
                      color,
                      marginBottom: sp(1),
                    }}
                  >
                    {kindLabel}
                  </div>
                  <div
                    style={{
                      fontSize: textSize("paragraphMuted"),
                      fontWeight: FONT_WEIGHTS.medium,
                      letterSpacing: 0,
                      color: CSS_COLOR.text,
                      marginBottom: toast.body ? sp(2) : 0,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {toast.title}
                  </div>
                  {toast.body ? (
                    <div
                      className="ra-toast-body"
                      style={{
                        fontSize: textSize("body"),
                        color: CSS_COLOR.textSec,
                        fontFamily: T.sans,
                        lineHeight: 1.35,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {toast.body}
                    </div>
                  ) : null}
                </div>
                <BrokerLogoBubbles
                  brokers={toast.brokers}
                  maxVisible={3}
                  size={16}
                />
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  className="ra-toast-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismiss();
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: dim(18),
                    height: dim(18),
                    flexShrink: 0,
                    marginLeft: sp(2),
                    marginTop: sp(1),
                    padding: 0,
                    border: "none",
                    borderRadius: dim(RADII.xs),
                    background: "transparent",
                    color: CSS_COLOR.textMuted,
                    cursor: "pointer",
                    transition: "background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease",
                  }}
                >
                  <X size={dim(12)} strokeWidth={2.4} />
                </button>
              </div>
              {/* auto-dismiss progress bar (time remaining) */}
              {!toast.leaving && Number.isFinite(toast.duration) && toast.duration > 0 ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: dim(2),
                    background: color,
                    opacity: 0.45,
                    transformOrigin: "left center",
                    animation: `toastProgress ${toast.duration}ms linear forwards`,
                  }}
                />
              ) : null}
            </div>
          </AppTooltip>
        );
      })}
    </div>
  ) : null;
};
