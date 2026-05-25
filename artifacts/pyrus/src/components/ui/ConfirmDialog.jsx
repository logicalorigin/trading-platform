import React, { Fragment, useEffect } from "react";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { Button } from "./Button.jsx";

export const ConfirmDialog = ({
  open,
  title,
  detail,
  lines = [],
  confirmLabel = "Confirm",
  confirmTone,
  pending = false,
  error = null,
  destructive = false,
  onConfirm,
  onCancel,
  eyebrow = "Confirmation",
  note = null,
  dialogTestId = "confirm-dialog",
  errorTestId = "confirm-dialog-error",
}) => {
  const resolvedTone = confirmTone || (destructive ? T.red : T.accent);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !pending) {
        onCancel?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open, pending]);

  if (!open) return null;

  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : null;

  return (
    <div
      data-testid={`${dialogTestId}-backdrop`}
      onClick={(event) => {
        if (!pending && event.target === event.currentTarget) {
          onCancel?.();
        }
      }}
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
        data-testid={dialogTestId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${dialogTestId}-title`}
        style={{
          width: "min(100%, 520px)",
          background: T.bg1,
          border: `1px solid ${resolvedTone}55`,
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
              color: resolvedTone,
              fontFamily: T.sans,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </span>
          <span
            id={`${dialogTestId}-title`}
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
          {detail ? (
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
          ) : null}
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
        {errorMessage ? (
          <div
            data-testid={errorTestId}
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
            {errorMessage}
          </div>
        ) : null}
        {note ? (
          <div
            style={{
              fontSize: fs(12),
              color: T.textMuted,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            {note}
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(10) }}>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={onCancel}
            fullWidth
            style={{ borderRadius: dim(RADII.sm), padding: sp("12px 0") }}
          >
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            color={resolvedTone}
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
            fullWidth
            style={{ borderRadius: dim(RADII.sm), padding: sp("12px 0") }}
          >
            {pending ? "Submitting..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
