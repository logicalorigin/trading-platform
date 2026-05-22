import { useEffect, useRef } from "react";

const DeferredRender = ({
  children,
  className = "",
  minHeight = 160,
  onActivate,
  testId,
}) => {
  const rootRef = useRef(null);
  const activatedRef = useRef(false);

  useEffect(() => {
    if (activatedRef.current) {
      return;
    }
    activatedRef.current = true;
    onActivate?.();
  }, [onActivate]);

  return (
    <div
      ref={rootRef}
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
