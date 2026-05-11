import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { T, dim, fs, sp } from "../../lib/uiTokens.jsx";

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
          background: "rgba(2, 6, 23, 0.62)",
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
          background: T.bg0,
          color: T.text,
          borderTop: `1px solid ${T.border}`,
          borderTopLeftRadius: dim(8),
          borderTopRightRadius: dim(8),
          boxShadow: `0 -18px 48px ${T.bg0}cc`,
          fontFamily: T.sans,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: sp(6),
            padding: sp("8px 10px 7px"),
            borderBottom: `1px solid ${T.border}`,
            background: T.bg1,
            borderTopLeftRadius: dim(8),
            borderTopRightRadius: dim(8),
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: dim(38),
              height: dim(4),
              borderRadius: dim(999),
              background: T.borderLight,
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
                color: T.text,
                fontFamily: T.display,
                fontSize: fs(12),
                fontWeight: 400,
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
                width: dim(36),
                height: dim(36),
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${T.border}`,
                borderRadius: dim(4),
                background: T.bg2,
                color: T.textSec,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <X size={16} strokeWidth={2} />
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
