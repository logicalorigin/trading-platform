import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_ROOT_MARGIN = "360px 0px";

const DeferredRender = ({
  children,
  className = "",
  idleDelayMs = null,
  minHeight = 160,
  onActivate,
  rootMargin = DEFAULT_ROOT_MARGIN,
  testId,
}) => {
  const rootRef = useRef(null);
  const activatedRef = useRef(false);
  const onActivateRef = useRef(onActivate);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  const activate = useCallback(() => {
    if (activatedRef.current) {
      return;
    }
    activatedRef.current = true;
    setActivated(true);
    onActivateRef.current?.();
  }, []);

  const scheduleIdleActivation = useCallback(() => {
    if (typeof window === "undefined") {
      return () => {};
    }
    if (!Number.isFinite(idleDelayMs) || idleDelayMs < 0) {
      return () => {};
    }

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(activate, {
        timeout: idleDelayMs,
      });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(activate, idleDelayMs);
    return () => window.clearTimeout(timeoutId);
  }, [activate, idleDelayMs]);

  useEffect(() => {
    if (activated) {
      return undefined;
    }

    const element = rootRef.current;
    if (!element || typeof window === "undefined") {
      activate();
      return undefined;
    }

    if (typeof window.IntersectionObserver === "function") {
      const cancelIdleActivation = scheduleIdleActivation();
      const observer = new window.IntersectionObserver(
        (entries) => {
          if (
            entries.some(
              (entry) => entry.isIntersecting || entry.intersectionRatio > 0,
            )
          ) {
            activate();
            observer.disconnect();
          }
        },
        { rootMargin, threshold: 0 },
      );
      observer.observe(element);
      return () => {
        observer.disconnect();
        cancelIdleActivation();
      };
    }

    if (Number.isFinite(idleDelayMs) && idleDelayMs >= 0) {
      return scheduleIdleActivation();
    }

    activate();
    return undefined;
  }, [activated, activate, idleDelayMs, rootMargin, scheduleIdleActivation]);

  return (
    <div
      ref={rootRef}
      className={["ra-deferred-render", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-deferred-render={activated ? "mounted" : "pending"}
      style={{
        minHeight,
      }}
    >
      {activated ? (
        children
      ) : (
        <div
          aria-hidden="true"
          className="ra-deferred-render__placeholder"
          style={{ minHeight }}
        >
          <span className="ra-deferred-render__skeleton ra-skeleton-shimmer" />
        </div>
      )}
    </div>
  );
};

export default DeferredRender;
