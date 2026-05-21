import { Fragment } from "react";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";

export const formatLiveBrokerActionError = (error) => {
  const message =
    error?.message ||
    "The broker action failed before the platform received a final response.";
  if (/timeout|timed out|504|gateway timeout/i.test(message)) {
    return `${message} If this reached IBKR, the outcome may be unknown. Check open orders and executions before retrying.`;
  }
  return message;
};

export const BrokerActionConfirmDialog = ({
  open,
  title,
  detail,
  lines = [],
  confirmLabel = "CONFIRM LIVE ACTION",
  confirmTone = T.red,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 210,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(16),
        background: `color-mix(in srgb, ${T.bg0} 72%, transparent)`,
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        data-testid="broker-action-confirm-dialog"
        style={{
          width: "min(100%, 520px)",
          background: T.bg1,
          border: `1px solid ${confirmTone}55`,
          borderRadius: dim(RADII.md),
          boxShadow: ELEVATION.lg,
          padding: sp("20px 22px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(14),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: sp(6) }}>
          <span
            style={{
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              color: confirmTone,
              fontFamily: T.sans,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Live IBKR Confirmation
          </span>
          <span
            style={{
              fontSize: fs(20),
              fontWeight: FONT_WEIGHTS.label,
              color: T.text,
              fontFamily: T.sans,
              letterSpacing: 0,
              lineHeight: 1.2,
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: fs(13),
              color: T.textSec,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            {detail}
          </span>
        </div>
        {lines.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: sp(8),
              padding: sp("12px 14px"),
              background: T.bg0,
              border: `1px solid ${T.borderLight}`,
              borderRadius: dim(RADII.sm),
              fontFamily: T.sans,
            }}
          >
            {lines.map((line) => (
              <Fragment key={line.label}>
                <span
                  style={{
                    fontSize: textSize("caption"),
                    color: T.textMuted,
                    letterSpacing: "0.04em",
                    fontWeight: FONT_WEIGHTS.medium,
                    textTransform: "uppercase",
                  }}
                >
                  {line.label}
                </span>
                <span
                  style={{
                    fontSize: fs(11),
                    color: line.valueColor || T.text,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: FONT_WEIGHTS.medium,
                    textAlign: "right",
                  }}
                >
                  {line.value}
                </span>
              </Fragment>
            ))}
          </div>
        )}
        <div
          style={{
            fontSize: fs(12),
            color: T.textMuted,
            fontFamily: T.sans,
            lineHeight: 1.5,
          }}
        >
          This sends a live broker instruction. Review the account,
          instrument, side, size, and price before continuing.
        </div>
        {error ? (
          <div
            data-testid="broker-action-confirm-error"
            role="alert"
            style={{
              background: `${T.red}12`,
              border: `1px solid ${T.red}45`,
              borderRadius: dim(RADII.sm),
              color: T.red,
              fontSize: fs(12),
              fontFamily: T.sans,
              lineHeight: 1.5,
              padding: sp("10px 14px"),
            }}
          >
            {error}
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(10) }}>
          <button
            onClick={onCancel}
            disabled={pending}
            style={{
              padding: sp("12px 0"),
              background: T.bg1,
              border: `1px solid ${T.border}`,
              borderRadius: dim(RADII.sm),
              color: T.textSec,
              fontSize: fs(13),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: 0,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.65 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            style={{
              padding: sp("12px 0"),
              background: confirmTone,
              border: "none",
              borderRadius: dim(RADII.sm),
              color: T.onAccent,
              fontSize: fs(13),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.label,
              letterSpacing: 0,
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.75 : 1,
            }}
          >
            {pending ? "Submitting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
