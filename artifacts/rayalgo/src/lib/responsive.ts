import {
  useEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";

type ResponsiveSize = {
  width: number;
  height: number;
};

const getViewportSize = (): ResponsiveSize => {
  if (typeof window === "undefined") {
    return { width: 0, height: 0 };
  }

  const viewport = window.visualViewport;
  return {
    width: Math.round(viewport?.width || window.innerWidth || 0),
    height: Math.round(viewport?.height || window.innerHeight || 0),
  };
};

export const useViewportSize = (): ResponsiveSize => {
  const [size, setSize] = useState<ResponsiveSize>(getViewportSize);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setSize(getViewportSize()));
    };

    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    update();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  return size;
};

export const useElementSize = <TElement extends HTMLElement = HTMLDivElement>(): [
  RefObject<TElement | null>,
  ResponsiveSize,
] => {
  const ref = useRef<TElement | null>(null);
  const [size, setSize] = useState<ResponsiveSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const read = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.round(rect.width || element.clientWidth || 0),
        height: Math.round(rect.height || element.clientHeight || 0),
      });
    };

    read();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = entry?.contentRect?.width;
      const height = entry?.contentRect?.height;
      setSize({
        width: Math.round(Number.isFinite(width) ? width : element.clientWidth || 0),
        height: Math.round(Number.isFinite(height) ? height : element.clientHeight || 0),
      });
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return [ref, size];
};

export const responsiveFlags = (width: number) => ({
  isPhone: width > 0 && width < 768,
  isTablet: width >= 768 && width < 1024,
  isNarrow: width > 0 && width < 1024,
  isDesktop: width >= 1024,
});
