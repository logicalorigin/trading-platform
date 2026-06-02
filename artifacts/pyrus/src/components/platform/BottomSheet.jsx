import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import { Icon } from "./primitives.jsx";

export const BottomSheet = ({
  open,
  onClose,
  title = "Sheet",
  children,
  maxHeight = "82dvh",
  testId = "platform-bottom-sheet",
}) => {
  const closeButtonRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    returnFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus?.();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-testid={testId}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 270,
      }}
    >
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "color-mix(in srgb, var(--ra-surface-0) 72%, transparent)",
          cursor: "pointer",
        }}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
            <button
              ref={closeButtonRef}
              type="button"
              aria-label={`Close ${title}`}
              onClick={onClose}
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
          </div>
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
    </div>,
    document.body,
  );
};

export default BottomSheet;
