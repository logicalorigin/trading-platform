import { useRef } from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import { Icon } from "./primitives.jsx";

export const Drawer = ({
  open,
  onClose,
  side = "left",
  title = "Drawer",
  children,
  width = 344,
  testId = "platform-drawer",
  fullBleed = false,
}) => {
  const restoreFocusRef = useRef(null);

  if (!open || typeof document === "undefined") return null;

  const isRight = side === "right";

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
            zIndex: 260,
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
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              restoreFocusRef.current = document.activeElement;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocusRef.current?.focus?.();
            }}
          >
            <aside
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                [isRight ? "right" : "left"]: 0,
                width: fullBleed
                  ? "100vw"
                  : `min(calc(100vw - ${dim(24)}px), ${dim(width)}px)`,
                maxWidth: "100vw",
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                background: "var(--ra-surface-0)",
                color: "var(--ra-text-primary)",
                borderRight: "none",
                borderLeft: "none",
                boxShadow: ELEVATION.lg,
                fontFamily: T.sans,
              }}
            >
              <div
                style={{
                  height: dim(52),
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: sp(8),
                  padding: sp("0 16px"),
                  borderBottom: "none",
                  background: "var(--ra-surface-0)",
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
                    className="ra-touch-target"
                    aria-label={`Close ${title}`}
                    style={{
                      width: dim(32),
                      height: dim(32),
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
            </aside>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default Drawer;
