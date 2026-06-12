import { useEffect, useRef } from "react";

// Render children eagerly. This used to gate mounting on scroll-into-view via an
// IntersectionObserver, which made lower-of-the-fold panels sit as skeletons until
// the user scrolled to them. Content now mounts immediately on render; lazy code
// chunks still load lazily, they just aren't withheld behind the viewport.
const DeferredRender = ({
  children,
  className = "",
  minHeight = 160,
  onActivate,
  testId,
}) => {
  const onActivateRef = useRef(onActivate);

  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    onActivateRef.current?.();
  }, []);

  return (
    <div
      className={["ra-deferred-render", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-deferred-render="mounted"
      style={{
        minHeight,
      }}
    >
      {children}
    </div>
  );
};

export default DeferredRender;
