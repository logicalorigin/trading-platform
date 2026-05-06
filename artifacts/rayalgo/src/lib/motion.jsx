import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_FLASH_MS = 680;

const toComparableNumber = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const motionRowStyle = (index = 0, stepMs = 18, maxDelayMs = 180) => ({
  animationDelay: `${Math.min(Math.max(0, index), Math.floor(maxDelayMs / stepMs)) * stepMs}ms`,
});

export const motionVars = ({
  accent,
  up,
  down,
  warn,
} = {}) => ({
  ...(accent ? { "--ra-motion-accent": accent } : null),
  ...(up ? { "--ra-motion-up": up } : null),
  ...(down ? { "--ra-motion-down": down } : null),
  ...(warn ? { "--ra-motion-warn": warn } : null),
});

export const joinMotionClasses = (...classes) =>
  classes.filter(Boolean).join(" ") || undefined;

export function useValueFlash(value, options = {}) {
  const {
    enabled = true,
    durationMs = DEFAULT_FLASH_MS,
    classify,
	  } = options;
	  const previousRef = useRef(undefined);
	  const timerRef = useRef(null);
	  const frameRef = useRef(null);
	  const [flashClassName, setFlashClassName] = useState("");

  useEffect(() => {
    if (!enabled) {
      previousRef.current = value;
      return undefined;
    }

    const previous = previousRef.current;
    previousRef.current = value;

    if (previous === undefined || Object.is(previous, value)) {
      return undefined;
    }

    const direction =
      typeof classify === "function"
        ? classify(value, previous)
        : (() => {
            const nextNumber = toComparableNumber(value);
            const previousNumber = toComparableNumber(previous);
            if (nextNumber == null || previousNumber == null) return null;
            if (nextNumber > previousNumber) return "up";
            if (nextNumber < previousNumber) return "down";
            return null;
          })();

    if (direction !== "up" && direction !== "down") {
      return undefined;
    }

	    const nextClassName =
	      direction === "up" ? "ra-value-flash-up" : "ra-value-flash-down";
	    window.clearTimeout(timerRef.current);
	    window.cancelAnimationFrame(frameRef.current);
	    setFlashClassName("");
	    frameRef.current = window.requestAnimationFrame(() => {
	      setFlashClassName(nextClassName);
	      timerRef.current = window.setTimeout(() => {
	        setFlashClassName("");
	      }, durationMs);
	    });

    return undefined;
  }, [classify, durationMs, enabled, value]);

	  useEffect(
	    () => () => {
	      window.clearTimeout(timerRef.current);
	      window.cancelAnimationFrame(frameRef.current);
	    },
	    [],
	  );

  return flashClassName;
}

export function useListMotionKeys(items, getKey) {
  const previousKeysRef = useRef(new Set());
  return useMemo(() => {
    const previousKeys = previousKeysRef.current;
    const nextKeys = new Set();
    const keyed = (Array.isArray(items) ? items : []).map((item, index) => {
      const key = typeof getKey === "function" ? getKey(item, index) : item?.id ?? index;
      nextKeys.add(key);
      return {
        key,
        isNew: !previousKeys.has(key),
      };
    });
    previousKeysRef.current = nextKeys;
    return keyed;
  }, [getKey, items]);
}
