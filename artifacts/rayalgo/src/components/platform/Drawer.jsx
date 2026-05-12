import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { T, dim, fs, sp } from "../../lib/uiTokens.jsx";

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

  const isRight = side === "right";

  return createPortal(
    <div
      data-testid={testId}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 260,
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
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
          background: T.bg0,
          color: T.text,
          borderRight: isRight ? undefined : `1px solid ${T.border}`,
          borderLeft: isRight ? `1px solid ${T.border}` : undefined,
          boxShadow: isRight
            ? `-18px 0 48px ${T.bg0}cc`
            : `18px 0 48px ${T.bg0}cc`,
          fontFamily: T.sans,
        }}
      >
        <div
          style={{
            height: dim(44),
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(8),
            padding: sp("0 10px"),
            borderBottom: `1px solid ${T.border}`,
            background: T.bg1,
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
    </div>,
    document.body,
  );
};

export default Drawer;
