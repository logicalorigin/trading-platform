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
  getChartBrokerRecentWindowMinutes,
  getInitialChartBarLimit,
  getMaxChartBarLimit,
  normalizeChartTimeframe,
} from "./timeframes";
import {
  expandLocalRollupLimit,
  resolveLocalRollupBaseTimeframe,
} from "./timeframeRollups";
import { useHydrationGate } from "../platform/hydrationCoordinator";

export const buildChartBarScopeKey = (...parts) =>
  parts.filter((part) => part != null && part !== "").join("::");

export const CHART_HYDRATION_ACTION = Object.freeze({
  NONE: "none",
  EXPAND_LIMIT: "expandLimit",
  BACKFILL_UNDERFILLED: "backfillUnderfilled",
  PREPEND_OLDER: "prependOlder",
});

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

const resolveFiniteCount = (value, fallback = 0) =>
  Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : fallback;

export const CHART_HYDRATION_ROLES = Object.freeze([
  "mini",
  "primary",
  "option",
]);

export const normalizeChartHydrationRole = (role) =>
  CHART_HYDRATION_ROLES.includes(role) ? role : "primary";

export const resolveChartHydrationPolicy = ({
  timeframe = "15m",
  role = "primary",
} = {}) => {
  const normalizedRole = normalizeChartHydrationRole(role);
  const normalizedTimeframe = normalizeChartTimeframe(timeframe) || "15m";
  const targetLimit = getChartBarLimit(normalizedTimeframe, normalizedRole);
  const initialLimit = getInitialChartBarLimit(
    normalizedTimeframe,
    normalizedRole,
  );
  const maxLimit = getMaxChartBarLimit(normalizedTimeframe, normalizedRole);
  const baseTimeframe = resolveLocalRollupBaseTimeframe(
    normalizedTimeframe,
    targetLimit,
    normalizedRole,
  );
  const baseInitialLimit = expandLocalRollupLimit(
    initialLimit,
    normalizedTimeframe,
    baseTimeframe,
  );
  const baseTargetLimit = expandLocalRollupLimit(
    targetLimit,
    normalizedTimeframe,
    baseTimeframe,
  );
  const baseMaxLimit = expandLocalRollupLimit(
    maxLimit,
    normalizedTimeframe,
    baseTimeframe,
  );

  return {
    timeframe: normalizedTimeframe,
    role: normalizedRole,
    initialLimit,
    targetLimit,
    maxLimit,
    baseTimeframe,
    baseInitialLimit,
    baseTargetLimit,
    baseMaxLimit,
  };
};

export const resolveChartHydrationRequestPolicy = ({
  timeframe = "15m",
  role = "primary",
  requestedLimit = null,
} = {}) => {
  const policy = resolveChartHydrationPolicy({ timeframe, role });
  const resolvedRequestedLimit = Math.min(
    policy.maxLimit,
    Math.max(
      policy.initialLimit,
      resolveFiniteCount(requestedLimit, policy.targetLimit),
    ),
  );
  const baseLimit = expandLocalRollupLimit(
    resolvedRequestedLimit,
    policy.timeframe,
    policy.baseTimeframe,
  );

  return {
    ...policy,
    requestedLimit: resolvedRequestedLimit,
    baseLimit,
    brokerRecentWindowMinutes: getChartBrokerRecentWindowMinutes(
      policy.baseTimeframe,
      baseLimit,
    ),
  };
};

const resolveMinimumPrependPageSize = (timeframe, role) => {
  return getInitialChartBarLimit(timeframe, normalizeChartHydrationRole(role));
};

export const resolveVisibleRangeHydrationAction = ({
  enabled = true,
  range,
  loadedBarCount = 0,
  requestedLimit = 0,
  targetLimit = 0,
  maxLimit = 0,
  timeframe,
  role = "primary",
  oldestLoadedAtMs = null,
  canPrependOlderHistory = false,
  isPrependingOlder = false,
  isHydratingRequestedWindow = false,
  hasExhaustedOlderHistory = false,
} = {}) => {
  if (!enabled || !range) {
    return { action: CHART_HYDRATION_ACTION.NONE, reason: "disabled" };
  }

  const visibleBars = Math.max(1, Math.ceil(range.to - range.from));
  const leftEdgeBufferBars = Math.max(
    24,
    Math.min(144, Math.ceil(visibleBars * 0.2)),
  );
  if (range.from > leftEdgeBufferBars) {
    return {
      action: CHART_HYDRATION_ACTION.NONE,
      reason: "not-near-left-edge",
      visibleBars,
      leftEdgeBufferBars,
    };
  }

  if (isPrependingOlder) {
    return {
      action: CHART_HYDRATION_ACTION.NONE,
      reason: "prepend-in-flight",
      visibleBars,
      leftEdgeBufferBars,
    };
  }

  if (isHydratingRequestedWindow) {
    return {
      action: CHART_HYDRATION_ACTION.NONE,
      reason: "requested-window-loading",
      visibleBars,
      leftEdgeBufferBars,
    };
  }

  const resolvedRequestedLimit = resolveFiniteCount(requestedLimit);
  const resolvedLoadedBarCount = resolveFiniteCount(loadedBarCount);
  const resolvedTargetLimit = resolveFiniteCount(targetLimit);
  const resolvedMaxLimit = Math.max(
    resolvedTargetLimit,
    resolveFiniteCount(maxLimit, resolvedTargetLimit),
  );

  if (
    resolvedRequestedLimit >= resolvedTargetLimit &&
    resolvedLoadedBarCount < resolvedMaxLimit &&
    canPrependOlderHistory &&
    !hasExhaustedOlderHistory &&
    Number.isFinite(oldestLoadedAtMs)
  ) {
    const remainingBars = Math.max(0, resolvedMaxLimit - resolvedLoadedBarCount);
    const minimumPageSize = resolveMinimumPrependPageSize(timeframe, role);
    const prependPageSize = Math.max(
      minimumPageSize,
      Math.ceil(visibleBars * 2),
      role === "option" ? 240 : 360,
    );

    if (remainingBars > 0) {
      return {
        action: CHART_HYDRATION_ACTION.PREPEND_OLDER,
        reason: "near-left-edge",
        visibleBars,
        leftEdgeBufferBars,
        pageSize: Math.min(remainingBars, prependPageSize),
      };
    }
  }

  if (resolvedRequestedLimit >= resolvedTargetLimit && hasExhaustedOlderHistory) {
    return {
      action: CHART_HYDRATION_ACTION.NONE,
      reason: "older-history-exhausted",
      visibleBars,
      leftEdgeBufferBars,
    };
  }

  if (resolvedRequestedLimit >= resolvedMaxLimit) {
    return {
      action: CHART_HYDRATION_ACTION.NONE,
      reason: hasExhaustedOlderHistory ? "older-history-exhausted" : "max-limit",
      visibleBars,
      leftEdgeBufferBars,
    };
  }

  const effectiveLoadedBars = Math.max(
    resolvedRequestedLimit,
    resolvedLoadedBarCount,
    Math.ceil(range.to + 1),
  );
  const nextRequestedLimit = Math.max(
    resolvedTargetLimit,
    Math.ceil(effectiveLoadedBars * 2),
    effectiveLoadedBars + Math.max(visibleBars * 2, 480),
  );

  return {
    action: CHART_HYDRATION_ACTION.EXPAND_LIMIT,
    reason: "near-left-edge",
    visibleBars,
    leftEdgeBufferBars,
    nextRequestedLimit: Math.min(resolvedMaxLimit, nextRequestedLimit),
  };
};

export const resolveUnderfilledChartBackfillAction = ({
  enabled = true,
  scopeKey = "",
  loadedBarCount = 0,
  requestedLimit = 0,
  minPageSize = 0,
  isPrependingOlder = false,
  hasExhaustedOlderHistory = false,
  hasPrependOlderBars = false,
  attempts = 0,
  maxAttempts = 2,
} = {}) => {
  const normalizedScopeKey =
    typeof scopeKey === "string" ? scopeKey.trim() : "";
  const desiredLoadedCount = Math.max(2, resolveFiniteCount(requestedLimit));
  const currentLoadedCount = resolveFiniteCount(loadedBarCount);

  if (
    !enabled ||
    !normalizedScopeKey ||
    !hasPrependOlderBars ||
    currentLoadedCount <= 0 ||
    currentLoadedCount >= desiredLoadedCount ||
    isPrependingOlder ||
    hasExhaustedOlderHistory ||
    attempts >= maxAttempts
  ) {
    return {
      action: CHART_HYDRATION_ACTION.NONE,
      desiredLoadedCount,
      currentLoadedCount,
    };
  }

  const missingBars = Math.max(0, desiredLoadedCount - currentLoadedCount);
  return {
    action: CHART_HYDRATION_ACTION.BACKFILL_UNDERFILLED,
    desiredLoadedCount,
    currentLoadedCount,
    pageSize: Math.max(
      resolveFiniteCount(minPageSize),
      missingBars,
      Math.ceil(desiredLoadedCount * 0.5),
    ),
  };
};

// Trade charts start with a small first-paint slice, warm the deeper target
// window, then expand once the query cache already has it.
export const useProgressiveChartBarLimit = ({
  scopeKey,
  timeframe,
  role = "primary",
  enabled = true,
  hydrationPriority = "visible",
  warmTargetLimit,
}) => {
  const policy = useMemo(
    () => resolveChartHydrationPolicy({ timeframe, role }),
    [role, timeframe],
  );
  const targetLimit = policy.targetLimit;
  const initialLimit = policy.initialLimit;
  const maxLimit = policy.maxLimit;
  const normalizedRole = policy.role;
  const normalizedTimeframe = policy.timeframe;
  const hydrationGate = useHydrationGate({
    enabled,
    priority: hydrationPriority,
    family: "chart-bars",
  });
  const progressiveKey = `${scopeKey}::${normalizedRole}::${normalizedTimeframe}`;
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

      if (
        !enabled ||
        !hydrationGate.enabled ||
        normalizedNextLimit <= requestedLimit
      ) {
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
      hydrationGate.enabled,
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
      const hydrationAction = resolveVisibleRangeHydrationAction({
        enabled,
        range,
        loadedBarCount,
        requestedLimit,
        targetLimit,
        maxLimit,
        timeframe: normalizedTimeframe,
        role: normalizedRole,
        oldestLoadedAtMs: options.oldestLoadedAtMs,
        canPrependOlderHistory: typeof options.prependOlderBars === "function",
        isHydratingRequestedWindow: Boolean(options.isHydratingRequestedWindow),
        isPrependingOlder: Boolean(options.isPrependingOlder),
        hasExhaustedOlderHistory: Boolean(options.hasExhaustedOlderHistory),
      });

      if (hydrationAction.action === CHART_HYDRATION_ACTION.PREPEND_OLDER) {
        options.prependOlderBars?.({ pageSize: hydrationAction.pageSize });
      } else if (
        hydrationAction.action === CHART_HYDRATION_ACTION.EXPAND_LIMIT
      ) {
        hydrateLimit(hydrationAction.nextRequestedLimit);
      }
      return hydrationAction;
    },
    [
      enabled,
      hydrateLimit,
      maxLimit,
      normalizedRole,
      normalizedTimeframe,
      requestedLimit,
      targetLimit,
    ],
  );

  return {
    requestedLimit,
    targetLimit,
    maxLimit,
    role: normalizedRole,
    timeframe: normalizedTimeframe,
    initialLimit,
    isHydratingFullWindow:
      enabled && hydrationGate.enabled && requestedLimit < targetLimit,
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
    recheckKey = "",
  } = {},
) => {
  const expandVisibleRangeRef = useRef(expandVisibleRange);
  const latestRangeRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    expandVisibleRangeRef.current = expandVisibleRange;
  }, [expandVisibleRange]);

  const clearScheduledTimer = useCallback(() => {
    if (timerRef.current == null) {
      return;
    }

    if (typeof window !== "undefined") {
      window.clearTimeout(timerRef.current);
    } else {
      clearTimeout(timerRef.current);
    }
    timerRef.current = null;
  }, []);

  const resetScheduledExpansion = useCallback(() => {
    clearScheduledTimer();
    latestRangeRef.current = null;
  }, [clearScheduledTimer]);

  useEffect(() => {
    resetScheduledExpansion();
    return resetScheduledExpansion;
  }, [resetScheduledExpansion, resetKey]);

  useEffect(() => {
    if (!recheckKey || latestRangeRef.current == null || timerRef.current != null) {
      return;
    }

    expandVisibleRangeRef.current?.(latestRangeRef.current);
  }, [recheckKey]);

  return useCallback(
    (range) => {
      latestRangeRef.current = range;

      const resolvedDelay = Number.isFinite(delayMs)
        ? Math.max(0, delayMs)
        : VISIBLE_RANGE_HYDRATION_DEBOUNCE_MS;
      if (resolvedDelay === 0) {
        clearScheduledTimer();
        expandVisibleRangeRef.current?.(range);
        return;
      }

      if (timerRef.current != null) {
        clearScheduledTimer();
      }

      const setTimer =
        typeof window !== "undefined" ? window.setTimeout : setTimeout;
      timerRef.current = setTimer(() => {
        const nextRange = latestRangeRef.current;
        timerRef.current = null;
        expandVisibleRangeRef.current?.(nextRange);
      }, resolvedDelay);
    },
    [clearScheduledTimer, delayMs],
  );
};

export const useUnderfilledChartBackfill = ({
  scopeKey,
  enabled = true,
  hydrationPriority = "visible",
  loadedBarCount = 0,
  requestedLimit = 0,
  minPageSize = 0,
  isPrependingOlder = false,
  hasExhaustedOlderHistory = false,
  prependOlderBars,
  maxAttempts = 2,
}) => {
  const attemptsRef = useRef({ key: "", count: 0 });
  const hydrationGate = useHydrationGate({
    enabled,
    priority: hydrationPriority,
    family: "chart-bars",
  });

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

    const hydrationAction = resolveUnderfilledChartBackfillAction({
      enabled: hydrationGate.enabled,
      scopeKey: normalizedScopeKey,
      loadedBarCount: currentLoadedCount,
      requestedLimit: desiredLoadedCount,
      minPageSize,
      isPrependingOlder,
      hasExhaustedOlderHistory,
      hasPrependOlderBars: typeof prependOlderBars === "function",
      attempts: attemptsRef.current.count,
      maxAttempts,
    });

    if (hydrationAction.action !== CHART_HYDRATION_ACTION.BACKFILL_UNDERFILLED) {
      return;
    }

    attemptsRef.current = {
      key: attemptKey,
      count: attemptsRef.current.count + 1,
    };
    const pageSize = hydrationAction.pageSize;

    Promise.resolve(prependOlderBars({ pageSize })).catch(() => {});
  }, [
    enabled,
    hasExhaustedOlderHistory,
    hydrationGate.enabled,
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
