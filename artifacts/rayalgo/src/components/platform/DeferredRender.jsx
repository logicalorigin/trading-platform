import { useEffect, useRef, useState } from "react";

const noopPlaceholder = null;

const defaultPlaceholder = (
  <div
    aria-hidden="true"
    className="ra-skeleton ra-deferred-render__skeleton"
  />
);

const DeferredRender = ({
  children,
  className = "",
  keepMountedOnce = true,
  minHeight = 160,
  placeholder = noopPlaceholder,
  rootMargin = "240px",
  testId,
}) => {
  const rootRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasMountedOnce, setHasMountedOnce] = useState(false);

  useEffect(() => {
    const target = rootRef.current;
    if (!target) {
      return undefined;
    }

    if (
      typeof window === "undefined" ||
      typeof window.IntersectionObserver !== "function"
    ) {
      setIsVisible(true);
      setHasMountedOnce(true);
      return undefined;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        setIsVisible(visible);
        if (visible) {
          setHasMountedOnce(true);
        }
      },
      { rootMargin },
    );
    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [rootMargin]);

  const shouldRender = isVisible || (keepMountedOnce && hasMountedOnce);
  const resolvedPlaceholder = placeholder ?? defaultPlaceholder;

  return (
    <div
      ref={rootRef}
      className={["ra-deferred-render", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-deferred-render={shouldRender ? "mounted" : "pending"}
      style={{ minHeight }}
    >
      {shouldRender ? (
        children
      ) : (
        <div
          className="ra-deferred-render__placeholder"
          style={{ minHeight }}
        >
          {resolvedPlaceholder}
        </div>
      )}
    </div>
  );
};

export default DeferredRender;
