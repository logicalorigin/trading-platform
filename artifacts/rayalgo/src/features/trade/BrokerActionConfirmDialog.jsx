import { Fragment } from "react";
import { T, dim, fs, sp } from "../../lib/uiTokens";

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
        background: "rgba(4, 10, 18, 0.72)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        data-testid="broker-action-confirm-dialog"
        style={{
          width: "min(100%, 520px)",
          background: T.bg1,
          border: `1px solid ${confirmTone}55`,
          borderRadius: dim(8),
          boxShadow: "0 24px 72px rgba(0,0,0,0.45)",
          padding: sp("14px 16px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(10),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: sp(3) }}>
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 800,
              color: confirmTone,
              fontFamily: T.display,
              letterSpacing: "0.08em",
            }}
          >
            LIVE IBKR CONFIRMATION
          </span>
          <span
            style={{
              fontSize: fs(14),
              fontWeight: 800,
              color: T.text,
              fontFamily: T.sans,
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: fs(9),
              color: T.textSec,
              fontFamily: T.sans,
              lineHeight: 1.45,
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
              gap: sp(6),
              padding: sp("8px 10px"),
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              fontFamily: T.mono,
            }}
          >
            {lines.map((line) => (
              <Fragment key={line.label}>
                <span
                  style={{
                    fontSize: fs(8),
                    color: T.textMuted,
                    letterSpacing: "0.06em",
                  }}
                >
                  {line.label}
                </span>
                <span
                  style={{
                    fontSize: fs(8),
                    color: line.valueColor || T.text,
                    fontWeight: 700,
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
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: sp(10),
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.sans,
            lineHeight: 1.4,
          }}
        >
          <span>
            This sends a live broker instruction. Review the account,
            instrument, side, size, and price before continuing.
          </span>
        </div>
        {error ? (
          <div
            data-testid="broker-action-confirm-error"
            role="alert"
            style={{
              background: `${T.red}12`,
              border: `1px solid ${T.red}45`,
              borderRadius: dim(5),
              color: T.red,
              fontSize: fs(9),
              fontFamily: T.sans,
              lineHeight: 1.4,
              padding: sp("8px 10px"),
            }}
          >
            {error}
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(8) }}>
          <button
            onClick={onCancel}
            disabled={pending}
            style={{
              padding: sp("8px 0"),
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(5),
              color: T.textSec,
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: 700,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.65 : 1,
            }}
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            style={{
              padding: sp("8px 0"),
              background: confirmTone,
              border: "none",
              borderRadius: dim(5),
              color: "#fff",
              fontSize: fs(10),
              fontFamily: T.sans,
              fontWeight: 800,
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.75 : 1,
            }}
          >
            {pending ? "SUBMITTING..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
