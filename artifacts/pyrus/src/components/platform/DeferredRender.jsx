import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_ROOT_MARGIN = "360px 0px";

const DeferredRender = ({
  children,
  className = "",
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
    if (activatedRef.current) return;
    activatedRef.current = true;
    setActivated(true);
    onActivateRef.current?.();
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (
      !element ||
      typeof window === "undefined" ||
      typeof window.IntersectionObserver !== "function"
    ) {
      activate();
      return undefined;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        activate();
        observer.disconnect();
      },
      { rootMargin, threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [activate, rootMargin]);

  return (
    <div
      ref={rootRef}
      className={["ra-deferred-render", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-deferred-render={activated ? "mounted" : "pending"}
      style={activated ? undefined : { minHeight }}
    >
      {activated ? children : (
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
