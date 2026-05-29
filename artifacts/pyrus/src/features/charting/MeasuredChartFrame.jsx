import { useEffect, useRef, useState } from "react";
import { CSS_COLOR, FONT_WEIGHTS, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";

const toCssSize = (value) => {
  if (typeof value === "number") {
    return dim(value);
  }
  return value;
};

const elementHasRenderableSize = (element) => {
  if (!element?.getBoundingClientRect) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

export const MeasuredChartFrame = ({
  children,
  className,
  height = "100%",
  minHeight = 120,
  placeholderLabel = "Preparing chart",
  style,
  testId,
}) => {
  const frameRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) {
      return undefined;
    }

    let cancelled = false;
    let animationFrame = null;
    const measure = () => {
      if (cancelled) {
        return;
      }
      setReady(elementHasRenderableSize(element));
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      animationFrame = requestAnimationFrame(measure);
      return () => {
        cancelled = true;
        observer.disconnect();
        if (animationFrame != null) {
          cancelAnimationFrame(animationFrame);
        }
      };
    }

    animationFrame = requestAnimationFrame(measure);
    return () => {
      cancelled = true;
      if (animationFrame != null) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  return (
    <div
      ref={frameRef}
      className={className}
      data-chart-container-ready={ready ? "true" : "false"}
      data-testid={testId}
      style={{
        width: "100%",
        height: toCssSize(height),
        minHeight: toCssSize(minHeight),
        minWidth: 0,
        position: "relative",
        ...style,
      }}
    >
      {ready ? (
        children
      ) : (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: sp(8),
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            textAlign: "center",
          }}
        >
          {placeholderLabel}
        </div>
      )}
    </div>
  );
};

export default MeasuredChartFrame;
