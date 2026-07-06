import React, { Fragment, useEffect, useRef } from "react";
import { CSS_COLOR, cssColorMix, dim, ELEVATION, FONT_WEIGHTS, fs, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
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
  const resolvedTone = confirmTone || (destructive ? CSS_COLOR.red : CSS_COLOR.accent);
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);

  const getFocusables = () => {
    const node = dialogRef.current;
    if (!node) return [];
    return Array.from(
      node.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
  };

  // Modal a11y (focus): on open, remember the trigger and move focus into the
  // dialog (onto Cancel, the least-destructive control, so the user never lands
  // pre-focused on a live-order confirm); restore focus to the trigger on close.
  // Keyed on `open` only so a mid-dialog `pending` toggle never bounces focus
  // out of the dialog. (WCAG 2.1)
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = getFocusables();
    if (initial.length) {
      initial[0].focus();
    } else {
      dialogRef.current?.focus();
    }
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Modal a11y (keys): Escape to cancel (unless pending), Tab/Shift+Tab trapped
  // within the dialog.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !pending) {
        onCancel?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
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
        background: cssColorMix(CSS_COLOR.bg0, 88),
      }}
    >
      <div
        ref={dialogRef}
        data-testid={dialogTestId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${dialogTestId}-title`}
        tabIndex={-1}
        style={{
          width: "min(100%, 520px)",
          background: CSS_COLOR.bg1,
          border: `1px solid ${cssColorMix(resolvedTone, 33)}`,
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
              color: CSS_COLOR.text,
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
                color: CSS_COLOR.textSec,
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
              background: CSS_COLOR.bg0,
              border: `1px solid ${CSS_COLOR.borderLight}`,
              borderRadius: dim(RADII.sm),
              fontFamily: T.sans,
            }}
          >
            {lines.map((line) => (
              <Fragment key={line.label}>
                <span
                  style={{
                    fontSize: textSize("caption"),
                    color: CSS_COLOR.textMuted,
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
                    color: line.valueColor || CSS_COLOR.text,
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
              background: cssColorMix(CSS_COLOR.red, 7),
              border: `1px solid ${cssColorMix(CSS_COLOR.red, 27)}`,
              borderRadius: dim(RADII.sm),
              color: CSS_COLOR.red,
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
              color: CSS_COLOR.textMuted,
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
