import { useEffect, useRef, useState } from "react";

const easeOutQuint = (t) => 1 - (1 - t) ** 5;

const prefersReducedMotion = () => {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
      document?.documentElement?.getAttribute("data-pyrus-reduced-motion") ===
        "on",
  );
};

const resolveAnimationStartValue = (displayedValue, previousTarget, nextTarget) =>
  typeof displayedValue === "number" && Number.isFinite(displayedValue)
    ? displayedValue
    : typeof previousTarget === "number" && Number.isFinite(previousTarget)
      ? previousTarget
      : nextTarget;

/**
 * Animate a numeric value from its previous value to `target` over `durationMs`.
 * Respects prefers-reduced-motion (or the PYRUS reduced-motion opt-in):
 * returns the target instantly when motion is reduced.
 *
 * Returns null when `target` is null/undefined or non-finite — callers can fall
 * back to a placeholder string.
 */
export const useNumberTick = (target, durationMs = 600) => {
  const numericTarget =
    typeof target === "number" && Number.isFinite(target) ? target : null;
  const [value, setValue] = useState(numericTarget);
  const previousRef = useRef(numericTarget);
  const displayedRef = useRef(numericTarget);
  const frameRef = useRef(0);

  useEffect(() => {
    if (numericTarget == null) {
      displayedRef.current = null;
      setValue(null);
      previousRef.current = null;
      return undefined;
    }
    const startValue =
      resolveAnimationStartValue(
        displayedRef.current,
        previousRef.current,
        numericTarget,
      );
    if (
      startValue === numericTarget ||
      durationMs <= 0 ||
      prefersReducedMotion()
    ) {
      previousRef.current = numericTarget;
      displayedRef.current = numericTarget;
      setValue(numericTarget);
      return undefined;
    }
    const startTime =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const tick = (now) => {
      const elapsed = (now ?? Date.now()) - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = easeOutQuint(progress);
      const next = startValue + (numericTarget - startValue) * eased;
      displayedRef.current = next;
      setValue(next);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        previousRef.current = numericTarget;
        displayedRef.current = numericTarget;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [numericTarget, durationMs]);

  return value;
};
