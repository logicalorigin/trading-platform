import { useRef } from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import { Icon } from "./primitives.jsx";

export const BottomSheet = ({
  open,
  onClose,
  title = "Sheet",
  description = null,
  descriptionId = null,
  closeLabel = null,
  initialFocusRef = null,
  children,
  maxHeight = "82dvh",
  testId = "platform-bottom-sheet",
}) => {
  const restoreFocusRef = useRef(null);
  const resolvedDescriptionId =
    descriptionId || `${testId}-description`;

  if (!open || typeof document === "undefined") return null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose?.();
      }}
    >
      <Dialog.Portal>
        <div
          data-testid={testId}
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 270,
          }}
        >
          <Dialog.Overlay
            style={{
              position: "absolute",
              inset: 0,
              background: "color-mix(in srgb, var(--ra-surface-0) 72%, transparent)",
              cursor: "pointer",
            }}
          />
          <Dialog.Content
            asChild
            aria-describedby={description ? resolvedDescriptionId : undefined}
            onOpenAutoFocus={(event) => {
              restoreFocusRef.current = document.activeElement;
              if (initialFocusRef?.current) {
                event.preventDefault();
                initialFocusRef.current?.focus?.();
              }
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocusRef.current?.focus?.();
            }}
          >
            <section
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                maxHeight,
                minHeight: dim(120),
                display: "flex",
                flexDirection: "column",
                background: "var(--ra-surface-0)",
                color: "var(--ra-text-primary)",
                borderTop: "none",
                borderTopLeftRadius: dim(RADII.lg),
                borderTopRightRadius: dim(RADII.lg),
                boxShadow: ELEVATION.lg,
                fontFamily: T.sans,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: sp(8),
                  padding: sp("10px 16px 12px"),
                  borderBottom: "none",
                  background: "var(--ra-surface-0)",
                  borderTopLeftRadius: dim(RADII.lg),
                  borderTopRightRadius: dim(RADII.lg),
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: dim(38),
                    height: dim(4),
                    borderRadius: dim(RADII.pill),
                    background: "var(--ra-text-muted)",
                    opacity: 0.4,
                  }}
                />
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: sp(8),
                  }}
                >
                  <Dialog.Title asChild>
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--ra-text-primary)",
                        fontFamily: T.sans,
                        fontSize: fs(15),
                        fontWeight: FONT_WEIGHTS.label,
                        letterSpacing: 0,
                      }}
                    >
                      {title}
                    </span>
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label={closeLabel || `Close ${title}`}
                      style={{
                        width: dim(44),
                        height: dim(44),
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid var(--ra-border-default)",
                        borderRadius: dim(RADII.pill),
                        background: "var(--ra-surface-1)",
                        color: "var(--ra-text-secondary)",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <Icon as={X} context="control" />
                    </button>
                  </Dialog.Close>
                </div>
                {description ? (
                  <Dialog.Description asChild>
                    <p
                      id={resolvedDescriptionId}
                      style={{
                        width: "100%",
                        margin: 0,
                        color: "var(--ra-text-secondary)",
                        fontFamily: T.sans,
                        fontSize: fs(12),
                        lineHeight: 1.45,
                      }}
                    >
                      {description}
                    </p>
                  </Dialog.Description>
                ) : null}
              </div>
              <div
                className="ra-hide-scrollbar"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                }}
              >
                {children}
              </div>
            </section>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default BottomSheet;
