import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearChartHydrationScope,
  consumeChartLivePatchPending,
  recordChartHydrationMetric,
} from "./chartHydrationStats";
import { buildResearchChartModelIncremental } from "./model";
import {
  getChartBarLimit,
  getInitialChartBarLimit,
  getMaxChartBarLimit,
} from "./timeframes";

export const buildChartBarScopeKey = (...parts) =>
  parts.filter((part) => part != null && part !== "").join("::");

const nowMs = () =>
  typeof performance !== "undefined" && Number.isFinite(performance.now())
    ? performance.now()
    : Date.now();

const resolveBarTimestampMs = (value) => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

// Trade charts start with a small first-paint slice, warm the deeper target
// window, then expand once the query cache already has it.
export const useProgressiveChartBarLimit = ({
  scopeKey,
  timeframe,
  role = "primary",
  enabled = true,
  warmTargetLimit,
}) => {
  const targetLimit = getChartBarLimit(timeframe, role);
  const initialLimit = getInitialChartBarLimit(timeframe, role);
  const maxLimit = getMaxChartBarLimit(timeframe, role);
  const progressiveKey = `${scopeKey}::${role}::${timeframe}`;
  const activeScopeKeyRef = useRef(progressiveKey);
  const warmingKeyRef = useRef(null);
  const [requestedLimit, setRequestedLimit] = useState(initialLimit);

  useEffect(() => {
    activeScopeKeyRef.current = progressiveKey;
    warmingKeyRef.current = null;
    setRequestedLimit(initialLimit);
  }, [initialLimit, progressiveKey]);

  const hydrateLimit = useCallback(
    (nextRequestedLimit) => {
      const normalizedNextLimit = Math.min(
        maxLimit,
        Math.max(initialLimit, Math.ceil(nextRequestedLimit)),
      );

      if (!enabled || normalizedNextLimit <= requestedLimit) {
        return;
      }

      const warmingKey = `${progressiveKey}::${normalizedNextLimit}`;
      if (warmingKeyRef.current === warmingKey) {
        return;
      }

      warmingKeyRef.current = warmingKey;

      Promise.resolve()
        .then(() => warmTargetLimit(normalizedNextLimit))
        .then(() => {
          if (activeScopeKeyRef.current !== progressiveKey) {
            return;
          }

          startTransition(() => {
            setRequestedLimit((current) =>
              current < normalizedNextLimit ? normalizedNextLimit : current,
            );
          });
        })
        .catch(() => {
          if (
            activeScopeKeyRef.current === progressiveKey &&
            warmingKeyRef.current === warmingKey
          ) {
            warmingKeyRef.current = null;
          }
        });
    },
    [
      enabled,
      initialLimit,
      maxLimit,
      progressiveKey,
      requestedLimit,
      warmTargetLimit,
    ],
  );

  const hydrateFullWindow = useCallback(() => {
    if (!enabled || initialLimit >= targetLimit || requestedLimit >= targetLimit) {
      return;
    }

    hydrateLimit(targetLimit);
  }, [
    enabled,
    hydrateLimit,
    initialLimit,
    requestedLimit,
    targetLimit,
  ]);

  const expandForVisibleRange = useCallback(
    (range, loadedBarCount, options = {}) => {
      if (!enabled || !range) {
        return;
      }

      const visibleBars = Math.max(1, Math.ceil(range.to - range.from));
      const leftEdgeBufferBars = Math.max(
        24,
        Math.min(144, Math.ceil(visibleBars * 0.2)),
      );
      if (range.from > leftEdgeBufferBars) {
        return;
      }

      const resolvedLoadedBarCount = Number.isFinite(loadedBarCount)
        ? Math.ceil(loadedBarCount)
        : 0;
      const canPrependOlderHistory =
        requestedLimit >= targetLimit &&
        resolvedLoadedBarCount < maxLimit &&
        typeof options.prependOlderBars === "function" &&
        Number.isFinite(options.oldestLoadedAtMs);

      if (canPrependOlderHistory) {
        const remainingBars = Math.max(0, maxLimit - resolvedLoadedBarCount);
        const minimumPageSize =
          role === "option"
            ? getInitialChartBarLimit(timeframe, "option")
            : role === "mini"
              ? getInitialChartBarLimit(timeframe, "mini")
              : getInitialChartBarLimit(timeframe, "primary");
        const prependPageSize = Math.max(
          minimumPageSize,
          Math.ceil(visibleBars * 2),
          role === "option" ? 240 : 360,
        );
        if (remainingBars > 0) {
          options.prependOlderBars({
            pageSize: Math.min(remainingBars, prependPageSize),
          });
        }
        return;
      }

      if (requestedLimit >= maxLimit) {
        return;
      }

      const effectiveLoadedBars = Math.max(
        requestedLimit,
        resolvedLoadedBarCount,
        Math.ceil(range.to + 1),
      );
      const nextRequestedLimit = Math.max(
        targetLimit,
        Math.ceil(effectiveLoadedBars * 2),
        effectiveLoadedBars + Math.max(visibleBars * 2, 480),
      );

      hydrateLimit(nextRequestedLimit);
    },
    [
      enabled,
      hydrateLimit,
      maxLimit,
      requestedLimit,
      role,
      targetLimit,
      timeframe,
    ],
  );

  return {
    requestedLimit,
    targetLimit,
    maxLimit,
    isHydratingFullWindow: enabled && requestedLimit < targetLimit,
    hydrateFullWindow,
    expandForVisibleRange,
  };
};

const VISIBLE_RANGE_HYDRATION_DEBOUNCE_MS = 120;

export const useDebouncedVisibleRangeExpansion = (
  expandVisibleRange,
  {
    delayMs = VISIBLE_RANGE_HYDRATION_DEBOUNCE_MS,
    resetKey = "",
  } = {},
) => {
  const expandVisibleRangeRef = useRef(expandVisibleRange);
  const latestRangeRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    expandVisibleRangeRef.current = expandVisibleRange;
  }, [expandVisibleRange]);

  const clearScheduledExpansion = useCallback(() => {
    if (timerRef.current == null) {
      return;
    }

    if (typeof window !== "undefined") {
      window.clearTimeout(timerRef.current);
    } else {
      clearTimeout(timerRef.current);
    }
    timerRef.current = null;
    latestRangeRef.current = null;
  }, []);

  useEffect(() => {
    clearScheduledExpansion();
    return clearScheduledExpansion;
  }, [clearScheduledExpansion, resetKey]);

  return useCallback(
    (range) => {
      latestRangeRef.current = range;

      const resolvedDelay = Number.isFinite(delayMs)
        ? Math.max(0, delayMs)
        : VISIBLE_RANGE_HYDRATION_DEBOUNCE_MS;
      if (resolvedDelay === 0) {
        clearScheduledExpansion();
        expandVisibleRangeRef.current?.(range);
        return;
      }

      if (timerRef.current != null) {
        if (typeof window !== "undefined") {
          window.clearTimeout(timerRef.current);
        } else {
          clearTimeout(timerRef.current);
        }
      }

      const setTimer =
        typeof window !== "undefined" ? window.setTimeout : setTimeout;
      timerRef.current = setTimer(() => {
        const nextRange = latestRangeRef.current;
        timerRef.current = null;
        latestRangeRef.current = null;
        expandVisibleRangeRef.current?.(nextRange);
      }, resolvedDelay);
    },
    [clearScheduledExpansion, delayMs],
  );
};

export const useUnderfilledChartBackfill = ({
  scopeKey,
  enabled = true,
  loadedBarCount = 0,
  requestedLimit = 0,
  minPageSize = 0,
  isPrependingOlder = false,
  hasExhaustedOlderHistory = false,
  prependOlderBars,
  maxAttempts = 2,
}) => {
  const attemptsRef = useRef({ key: "", count: 0 });

  useEffect(() => {
    const normalizedScopeKey =
      typeof scopeKey === "string" ? scopeKey.trim() : "";
    const desiredLoadedCount = Math.max(
      2,
      Math.ceil(Number.isFinite(requestedLimit) ? requestedLimit : 0),
    );
    const currentLoadedCount = Math.max(
      0,
      Math.floor(Number.isFinite(loadedBarCount) ? loadedBarCount : 0),
    );
    const attemptKey = `${normalizedScopeKey}::${desiredLoadedCount}`;

    if (attemptsRef.current.key !== attemptKey) {
      attemptsRef.current = { key: attemptKey, count: 0 };
    }

    if (
      !enabled ||
      !normalizedScopeKey ||
      typeof prependOlderBars !== "function" ||
      currentLoadedCount <= 0 ||
      currentLoadedCount >= desiredLoadedCount ||
      isPrependingOlder ||
      hasExhaustedOlderHistory ||
      attemptsRef.current.count >= maxAttempts
    ) {
      return;
    }

    attemptsRef.current = {
      key: attemptKey,
      count: attemptsRef.current.count + 1,
    };
    const missingBars = Math.max(0, desiredLoadedCount - currentLoadedCount);
    const pageSize = Math.max(
      Math.ceil(Number.isFinite(minPageSize) ? minPageSize : 0),
      missingBars,
      Math.ceil(desiredLoadedCount * 0.5),
    );

    Promise.resolve(prependOlderBars({ pageSize })).catch(() => {});
  }, [
    enabled,
    hasExhaustedOlderHistory,
    isPrependingOlder,
    loadedBarCount,
    maxAttempts,
    minPageSize,
    prependOlderBars,
    requestedLimit,
    scopeKey,
  ]);
};

export const measureChartBarsRequest = async ({
  scopeKey,
  metric,
  request,
}) => {
  const startedAt = nowMs();
  try {
    return await request();
  } finally {
    recordChartHydrationMetric(metric, nowMs() - startedAt, scopeKey);
  }
};

export const useMeasuredChartModel = ({
  scopeKey,
  bars,
  buildInput,
  deps,
}) => {
  const initialHydrationStartedAtRef = useRef(nowMs());
  const hasRecordedFirstPaintRef = useRef(false);
  const previousBuildStateRef = useRef(null);

  useEffect(() => {
    initialHydrationStartedAtRef.current = nowMs();
    hasRecordedFirstPaintRef.current = false;
    previousBuildStateRef.current = null;
    clearChartHydrationScope(scopeKey);
    return () => clearChartHydrationScope(scopeKey);
  }, [scopeKey]);

  const chartModel = useMemo(() => {
    const startedAt = nowMs();
    const nextResult = buildResearchChartModelIncremental(
      buildInput,
      previousBuildStateRef.current,
    );
    previousBuildStateRef.current = nextResult.state;
    recordChartHydrationMetric("modelBuildMs", nowMs() - startedAt, scopeKey);
    return nextResult.model;
  }, deps);

  const latestBarSignature = useMemo(() => {
    const lastBar = bars[bars.length - 1];
    if (!lastBar) {
      return "empty";
    }

    return [
      bars.length,
      resolveBarTimestampMs(lastBar.timestamp ?? lastBar.time ?? lastBar.ts) ??
        "",
      lastBar.close ?? lastBar.c ?? "",
      lastBar.volume ?? lastBar.v ?? "",
    ].join("|");
  }, [bars]);

  useEffect(() => {
    if (!chartModel.chartBars.length) {
      return;
    }

    const pendingLivePatchStartedAt = consumeChartLivePatchPending(scopeKey);
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      if (!hasRecordedFirstPaintRef.current) {
        recordChartHydrationMetric(
          "firstPaintMs",
          nowMs() - initialHydrationStartedAtRef.current,
          scopeKey,
        );
        hasRecordedFirstPaintRef.current = true;
      }

      if (pendingLivePatchStartedAt !== null) {
        recordChartHydrationMetric(
          "livePatchToPaintMs",
          nowMs() - pendingLivePatchStartedAt,
          scopeKey,
        );
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [chartModel.chartBars.length, latestBarSignature, scopeKey]);

  return chartModel;
};
