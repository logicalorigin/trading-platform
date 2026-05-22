import { useEffect, useMemo, useRef, useState } from "react";

/**
 * PYRUS motion roles.
 *
 * Each motion in the app maps to exactly one role and uses exactly one
 * timing + one easing pair. Inline transitions that don't match a role
 * are bugs — they should either move to a `.ra-*` class that carries
 * the role's tokens, or be removed if the motion isn't communicating
 * anything useful.
 *
 * Tokens are CSS vars on :root in index.css (--ra-motion-micro / -fast
 * / -standard / -slow + --ra-motion-ease / -enter / -exit). Reduced
 * motion is honored at the role-class level: every animation /
 * transition has a `@media (prefers-reduced-motion: reduce)` override
 * AND an `html[data-rayalgo-reduced-motion="on"]` override.
 *
 *   ROLE             TIMING                 EASING                CSS HOOK
 *   ----             ------                 ------                --------
 *   entrance         standard (190ms)       enter (cubic-out)     .ra-panel-enter, .ra-row-enter, .ra-screen-enter, .ra-popover-enter
 *   exit             fast (140ms)           exit (cubic-in)       (not needed today — we don't reverse-animate on unmount)
 *   hover            fast (140ms)           ease (cubic-in-out)   .ra-interactive, .ra-row-hover, default button/a/input rule
 *   active-press     micro (90ms)           ease (cubic-in-out)   .ra-interactive:active
 *   selection-change standard (190ms)       ease (cubic-in-out)   .ra-segmented-indicator (transform+width)
 *   value-flash      620ms                  enter (cubic-out)     .ra-value-flash-up / .ra-value-flash-down
 *   error-shake      micro × 4 (≈ 280ms)    ease                  .ra-error-shake (raErrorShake keyframe)
 *
 * When adding a new motion: if none of the above roles fit, that's a
 * red flag — discuss with the team before introducing a new role.
 */

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
