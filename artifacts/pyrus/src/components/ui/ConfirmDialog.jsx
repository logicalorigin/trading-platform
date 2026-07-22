import React, { Fragment, useRef } from "react";
import { Dialog } from "radix-ui";
import { CSS_COLOR, cssColorMix, dim, ELEVATION, FONT_WEIGHTS, fs, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
import { OVERLAY_LAYER } from "../platform/overlayLayers.js";
import { Button } from "./Button.jsx";

export const ConfirmDialog = ({
  open,
  title,
  detail,
  lines = [],
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmTone,
  pending = false,
  requireExplicitDecision = false,
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
  const restoreFocusRef = useRef(null);

  if (!open) return null;

  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending && !requireExplicitDecision) onCancel?.();
      }}
    >
      <Dialog.Portal>
        <div
          data-testid={`${dialogTestId}-backdrop`}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: OVERLAY_LAYER.dialog,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: sp(16),
          }}
        >
          <Dialog.Overlay
            style={{
              position: "absolute",
              inset: 0,
              background: cssColorMix(CSS_COLOR.bg0, 88),
            }}
          />
          <Dialog.Content
            data-testid={dialogTestId}
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              restoreFocusRef.current = document.activeElement;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocusRef.current?.focus?.();
            }}
            onEscapeKeyDown={(event) => {
              if (pending || requireExplicitDecision) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (pending || requireExplicitDecision) event.preventDefault();
            }}
            style={{
              position: "relative",
              zIndex: 1,
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
              <Dialog.Title asChild>
                <span
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
              </Dialog.Title>
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
                {cancelLabel}
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
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
