import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

const SWIPE_DISMISS_RATIO = 0.3;
const SWIPE_DISMISS_VELOCITY = 0.6;

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
  const asideRef = useRef(null);
  const dragStateRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);

  const isRight = side === "right";

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
        return;
      }
      if (event.key !== "Tab") return;
      const container = asideRef.current;
      if (!container) return;
      const focusables = container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
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

  useEffect(() => {
    if (!open) {
      dragStateRef.current = null;
      setDragOffset(0);
    }
  }, [open]);

  const handleDragPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target?.closest?.("[data-swipe-skip]")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
    };
  };

  const handleDragPointerMove = (event) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const raw = event.clientX - state.startX;
    const delta = isRight ? Math.max(0, raw) : Math.min(0, raw);
    const dt = event.timeStamp - state.lastTime;
    if (dt > 0) state.velocity = (event.clientX - state.lastX) / dt;
    state.lastX = event.clientX;
    state.lastTime = event.timeStamp;
    setDragOffset(delta);
  };

  const finishDrag = (event) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const drawerWidth = asideRef.current?.offsetWidth || 1;
    const ratio = Math.abs(dragOffset) / drawerWidth;
    const signedVelocity = isRight ? state.velocity : -state.velocity;
    if (ratio > SWIPE_DISMISS_RATIO || signedVelocity > SWIPE_DISMISS_VELOCITY) {
      onClose?.();
    } else {
      setDragOffset(0);
    }
  };

  if (!open || typeof document === "undefined") return null;

  const isDragging = dragStateRef.current != null;

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
          background: "rgba(25, 23, 26, 0.42)",
          cursor: "pointer",
        }}
      />
      <aside
        ref={asideRef}
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
          borderRight: "none",
          borderLeft: "none",
          boxShadow: ELEVATION.lg,
          fontFamily: T.sans,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: fullBleed || !isRight ? "env(safe-area-inset-left)" : 0,
          paddingRight: fullBleed || isRight ? "env(safe-area-inset-right)" : 0,
          transform: dragOffset ? `translateX(${dragOffset}px)` : undefined,
          transition: isDragging ? "none" : "transform 220ms ease",
          willChange: isDragging ? "transform" : undefined,
        }}
      >
        <div
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          style={{
            height: dim(52),
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(8),
            padding: sp("0 16px"),
            borderBottom: "none",
            background: T.bg0,
            touchAction: "none",
            cursor: isDragging ? "grabbing" : "grab",
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: T.text,
              fontFamily: T.sans,
              fontSize: fs(15),
              fontWeight: FONT_WEIGHTS.label,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            data-swipe-skip
            style={{
              width: dim(32),
              height: dim(32),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${T.border}`,
              borderRadius: dim(RADII.pill),
              background: T.bg1,
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
