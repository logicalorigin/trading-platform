import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ELEVATION, FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

const SWIPE_DISMISS_RATIO = 0.3;
const SWIPE_DISMISS_VELOCITY = 0.6;

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
  const sectionRef = useRef(null);
  const dragStateRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);

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
      const container = sectionRef.current;
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
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
    };
  };

  const handleDragPointerMove = (event) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const delta = Math.max(0, event.clientY - state.startY);
    const dt = event.timeStamp - state.lastTime;
    if (dt > 0) state.velocity = (event.clientY - state.lastY) / dt;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    setDragOffset(delta);
  };

  const finishDrag = (event) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const height = sectionRef.current?.offsetHeight || 1;
    const ratio = dragOffset / height;
    if (ratio > SWIPE_DISMISS_RATIO || state.velocity > SWIPE_DISMISS_VELOCITY) {
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
          background: "rgba(25, 23, 26, 0.42)",
          cursor: "pointer",
        }}
      />
      <section
        ref={sectionRef}
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
          borderTop: "none",
          borderTopLeftRadius: dim(RADII.lg),
          borderTopRightRadius: dim(RADII.lg),
          boxShadow: ELEVATION.lg,
          fontFamily: T.sans,
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          transform: dragOffset ? `translateY(${dragOffset}px)` : undefined,
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
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: sp(8),
            padding: sp("10px 16px 12px"),
            borderBottom: "none",
            background: T.bg0,
            borderTopLeftRadius: dim(RADII.lg),
            borderTopRightRadius: dim(RADII.lg),
            touchAction: "none",
            cursor: isDragging ? "grabbing" : "grab",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: dim(38),
              height: dim(4),
              borderRadius: dim(RADII.pill),
              background: T.textMuted,
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
