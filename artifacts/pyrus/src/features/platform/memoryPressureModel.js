const PRESSURE_RANK = {
  normal: 0,
  watch: 1,
  high: 2,
  critical: 3,
};

export const MEMORY_PRESSURE_THRESHOLDS = {
  browserMemoryMb: {
    measureUserAgentSpecificMemory: { watch: 320, high: 520, critical: 820 },
    "performance.memory": { watch: 180, high: 280, critical: 420 },
    heuristic: { watch: null, high: null, critical: null },
  },
  apiHeapUsedPercent: { watch: 70, high: 78, critical: 85 },
  workload: {
    activeWorkloadCount: { watch: 10, high: 14, critical: 20 },
    pollCount: { watch: 8, high: 12, critical: null },
    streamCount: { watch: 3, high: 5, critical: 8 },
  },
  chartHydration: {
    chartScopeCount: { watch: 18, high: 30, critical: null },
    prependScopeCount: { watch: 1, high: 4, critical: null },
  },
  queryCache: {
    queryCount: { watch: 100, high: 160, critical: 240 },
    heavyQueryCount: { watch: 12, high: 30, critical: 50 },
  },
  runtimeStores: {
    storeEntryCount: { watch: 60, high: 120, critical: 180 },
  },
};

const BROWSER_THRESHOLDS_MB = MEMORY_PRESSURE_THRESHOLDS.browserMemoryMb;

const DRIVER_WEIGHTS = {
  "browser-memory": 48,
  "api-heap": 24,
  workload: 12,
  "chart-hydration": 8,
  "query-cache": 5,
  "runtime-stores": 3,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const round = (value) =>
  Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

const normalizeLevel = (value) => {
  if (value === "critical" || value === "high" || value === "watch") {
    return value;
  }
  return "normal";
};

const levelFromThresholds = (value, thresholds) => {
  if (!Number.isFinite(value)) {
    return "normal";
  }
  if (Number.isFinite(thresholds?.critical) && value >= thresholds.critical) {
    return "critical";
  }
  if (Number.isFinite(thresholds?.high) && value >= thresholds.high) {
    return "high";
  }
  if (Number.isFinite(thresholds?.watch) && value >= thresholds.watch) {
    return "watch";
  }
  return "normal";
};

const levelFromThresholdGroup = (metrics, thresholdGroup) =>
  Object.entries(thresholdGroup || {}).reduce((level, [key, thresholds]) => {
    const metricLevel = levelFromThresholds(Number(metrics?.[key]), thresholds);
    return maxLevel(level, metricLevel);
  }, "normal");

const maxLevel = (...levels) =>
  levels.reduce((current, next) =>
    PRESSURE_RANK[normalizeLevel(next)] > PRESSURE_RANK[normalizeLevel(current)]
      ? normalizeLevel(next)
      : normalizeLevel(current),
  "normal");

const levelAtLeast = (value, minimum) =>
  PRESSURE_RANK[normalizeLevel(value)] >= PRESSURE_RANK[normalizeLevel(minimum)];

const scoreFromLevel = (level, weight) => {
  switch (normalizeLevel(level)) {
    case "critical":
      return weight;
    case "high":
      return weight * 0.72;
    case "watch":
      return weight * 0.42;
    default:
      return 0;
  }
};

const resolveScoreLevel = (score, pressureDrivers) => {
  if (
    pressureDrivers.some((driver) => normalizeLevel(driver.level) === "critical")
  ) {
    return "critical";
  }
  if (score >= 50) {
    return "high";
  }
  if (
    score > 0 ||
    pressureDrivers.some((driver) => levelAtLeast(driver.level, "watch"))
  ) {
    return "watch";
  }
  return "normal";
};

const formatDriverDetail = (value, suffix = "") =>
  Number.isFinite(value) ? `${Math.round(value)}${suffix}` : null;

const buildDriverMetric = ({ key, label, value, unit = "", thresholds, source = null }) => {
  const numericValue = Number(value);
  return {
    key,
    label,
    value: Number.isFinite(numericValue) ? round(numericValue) : null,
    unit,
    level: levelFromThresholds(numericValue, thresholds),
    thresholds: thresholds || null,
    source,
  };
};

const buildPressureDriver = ({ kind, label, level, detail, score, metrics }) => {
  const normalizedLevel = normalizeLevel(level);
  const numericScore = Number(score);
  return {
    kind,
    label,
    level: normalizedLevel,
    detail: detail || null,
    score: Number.isFinite(numericScore) ? round(numericScore) : null,
    contribution: round(scoreFromLevel(normalizedLevel, DRIVER_WEIGHTS[kind] || 0)),
    metrics: Array.isArray(metrics) ? metrics : [],
  };
};

const resolveDominantDrivers = (drivers) =>
  drivers
    .filter((driver) => levelAtLeast(driver.level, "watch"))
    .slice()
    .sort((left, right) => {
      const rankDelta =
        PRESSURE_RANK[normalizeLevel(right.level)] -
        PRESSURE_RANK[normalizeLevel(left.level)];
      if (rankDelta !== 0) return rankDelta;
      return (right.score ?? 0) - (left.score ?? 0);
    })
    .slice(0, 4)
    .map((driver) => ({
      kind: driver.kind,
      label: driver.label,
      level: normalizeLevel(driver.level),
      detail: driver.detail || null,
      score: round(driver.score ?? 0),
      contribution: round(driver.contribution ?? 0),
    }));

const resolveTrend = (history, score) => {
  const values = Array.isArray(history)
    ? history
        .map((entry) => Number(entry?.score))
        .filter((value) => Number.isFinite(value))
    : [];
  if (!values.length || !Number.isFinite(score)) {
    return "steady";
  }
  const first = values[0];
  const last = values[values.length - 1];
  if (score >= first + 12 || last >= first + 10) {
    return "rising";
  }
  if (score <= first - 10 || last <= first - 8) {
    return "recovering";
  }
  return "steady";
};

export const buildMemoryPressureState = (
  input = {},
  { previousState = null, history = [] } = {},
) => {
  const browserMemoryMb = Number(input.browserMemoryMb);
  const browserSource = String(input.browserSource || "heuristic");
  const sourceQuality = String(
    input.sourceQuality ||
      (browserSource === "measureUserAgentSpecificMemory"
        ? "high"
        : browserSource === "performance.memory"
          ? "medium"
          : "low"),
  );
  const browserThresholds =
    BROWSER_THRESHOLDS_MB[browserSource] || BROWSER_THRESHOLDS_MB.heuristic;
  const browserLevel = levelFromThresholds(browserMemoryMb, browserThresholds);
  const apiHeapUsedPercent = Number(input.apiHeapUsedPercent);
  const apiLevel = levelFromThresholds(
    apiHeapUsedPercent,
    MEMORY_PRESSURE_THRESHOLDS.apiHeapUsedPercent,
  );
  const activeWorkloadCount = Number(input.activeWorkloadCount);
  const pollCount = Number(input.pollCount);
  const streamCount = Number(input.streamCount);
  const chartScopeCount = Number(input.chartScopeCount);
  const prependScopeCount = Number(input.prependScopeCount);
  const queryCount = Number(input.queryCount);
  const heavyQueryCount = Number(input.heavyQueryCount);
  const storeEntryCount = Number(input.storeEntryCount);

  const workloadMetrics = { activeWorkloadCount, pollCount, streamCount };
  const chartMetrics = { chartScopeCount, prependScopeCount };
  const queryMetrics = { queryCount, heavyQueryCount };
  const storeMetrics = { storeEntryCount };

  const workloadLevel = levelFromThresholdGroup(
    workloadMetrics,
    MEMORY_PRESSURE_THRESHOLDS.workload,
  );
  const chartLevel = levelFromThresholdGroup(
    chartMetrics,
    MEMORY_PRESSURE_THRESHOLDS.chartHydration,
  );
  const queryLevel = levelFromThresholdGroup(
    queryMetrics,
    MEMORY_PRESSURE_THRESHOLDS.queryCache,
  );
  const storeLevel = levelFromThresholdGroup(
    storeMetrics,
    MEMORY_PRESSURE_THRESHOLDS.runtimeStores,
  );

  const pressureDrivers = [
    buildPressureDriver({
      kind: "browser-memory",
      label: "Browser memory",
      level: browserLevel,
      detail: formatDriverDetail(browserMemoryMb, " MB"),
      score: browserMemoryMb,
      metrics: [
        buildDriverMetric({
          key: "browserMemoryMb",
          label: "Browser estimate",
          value: browserMemoryMb,
          unit: "MB",
          thresholds: browserThresholds,
          source: browserSource,
        }),
      ],
    }),
    buildPressureDriver({
      kind: "api-heap",
      label: "API heap",
      level: apiLevel,
      detail: formatDriverDetail(apiHeapUsedPercent, "%"),
      score: apiHeapUsedPercent,
      metrics: [
        buildDriverMetric({
          key: "apiHeapUsedPercent",
          label: "Heap used",
          value: apiHeapUsedPercent,
          unit: "%",
          thresholds: MEMORY_PRESSURE_THRESHOLDS.apiHeapUsedPercent,
        }),
      ],
    }),
    buildPressureDriver({
      kind: "workload",
      label: "Active workload",
      level: workloadLevel,
      detail: formatDriverDetail(activeWorkloadCount),
      score: activeWorkloadCount,
      metrics: [
        buildDriverMetric({
          key: "activeWorkloadCount",
          label: "Active",
          value: activeWorkloadCount,
          thresholds: MEMORY_PRESSURE_THRESHOLDS.workload.activeWorkloadCount,
        }),
        buildDriverMetric({
          key: "pollCount",
          label: "Polls",
          value: pollCount,
          thresholds: MEMORY_PRESSURE_THRESHOLDS.workload.pollCount,
        }),
        buildDriverMetric({
          key: "streamCount",
          label: "Streams",
          value: streamCount,
          thresholds: MEMORY_PRESSURE_THRESHOLDS.workload.streamCount,
        }),
      ],
    }),
    buildPressureDriver({
      kind: "chart-hydration",
      label: "Chart hydration",
      level: chartLevel,
      detail: formatDriverDetail(chartScopeCount),
      score: chartScopeCount,
      metrics: [
        buildDriverMetric({
          key: "chartScopeCount",
          label: "Chart scopes",
          value: chartScopeCount,
          thresholds: MEMORY_PRESSURE_THRESHOLDS.chartHydration.chartScopeCount,
        }),
        buildDriverMetric({
          key: "prependScopeCount",
          label: "Prepend scopes",
          value: prependScopeCount,
          thresholds: MEMORY_PRESSURE_THRESHOLDS.chartHydration.prependScopeCount,
        }),
      ],
    }),
    buildPressureDriver({
      kind: "query-cache",
      label: "Query cache",
      level: queryLevel,
      detail: formatDriverDetail(queryCount),
      score: queryCount,
      metrics: [
        buildDriverMetric({
          key: "queryCount",
          label: "Queries",
          value: queryCount,
          thresholds: MEMORY_PRESSURE_THRESHOLDS.queryCache.queryCount,
        }),
        buildDriverMetric({
          key: "heavyQueryCount",
          label: "Heavy queries",
          value: heavyQueryCount,
          thresholds: MEMORY_PRESSURE_THRESHOLDS.queryCache.heavyQueryCount,
        }),
      ],
    }),
    buildPressureDriver({
      kind: "runtime-stores",
      label: "Runtime stores",
      level: storeLevel,
      detail: formatDriverDetail(storeEntryCount),
      score: storeEntryCount,
      metrics: [
        buildDriverMetric({
          key: "storeEntryCount",
          label: "Store entries",
          value: storeEntryCount,
          thresholds: MEMORY_PRESSURE_THRESHOLDS.runtimeStores.storeEntryCount,
        }),
      ],
    }),
  ];

  const dominantDrivers = resolveDominantDrivers(pressureDrivers);
  const rawScore =
    scoreFromLevel(browserLevel, DRIVER_WEIGHTS["browser-memory"]) +
    scoreFromLevel(apiLevel, DRIVER_WEIGHTS["api-heap"]) +
    scoreFromLevel(workloadLevel, DRIVER_WEIGHTS.workload) +
    scoreFromLevel(chartLevel, DRIVER_WEIGHTS["chart-hydration"]) +
    scoreFromLevel(queryLevel, DRIVER_WEIGHTS["query-cache"]) +
    scoreFromLevel(storeLevel, DRIVER_WEIGHTS["runtime-stores"]);
  const score = round(clamp(rawScore, 0, 100));
  const baseLevel = resolveScoreLevel(score, pressureDrivers);
  let level = baseLevel;
  const previousLevel = normalizeLevel(previousState?.level);
  const previousScore = Number(previousState?.score);
  if (
    levelAtLeast(previousLevel, "watch") &&
    !levelAtLeast(baseLevel, previousLevel)
  ) {
    if (previousLevel === "critical" && baseLevel !== "critical") {
      level = maxLevel(baseLevel, "high");
    } else if (Number.isFinite(previousScore) && score >= previousScore - 10) {
      level = previousLevel;
    } else if (
      baseLevel === "normal" &&
      Number.isFinite(previousScore) &&
      previousScore >= 10
    ) {
      level = "watch";
    }
  }

  const historyEntries = Array.isArray(history)
    ? [...history.slice(-5), { score, level }]
    : [{ score, level }];

  return {
    level,
    score,
    trend: resolveTrend(historyEntries, score),
    sourceQuality,
    browserMemoryMb: Number.isFinite(browserMemoryMb) ? round(browserMemoryMb) : null,
    browserSource,
    apiHeapUsedPercent: Number.isFinite(apiHeapUsedPercent)
      ? round(apiHeapUsedPercent)
      : null,
    activeWorkloadCount: Number.isFinite(activeWorkloadCount)
      ? activeWorkloadCount
      : 0,
    pollCount: Number.isFinite(pollCount) ? pollCount : 0,
    streamCount: Number.isFinite(streamCount) ? streamCount : 0,
    chartScopeCount: Number.isFinite(chartScopeCount) ? chartScopeCount : 0,
    prependScopeCount: Number.isFinite(prependScopeCount)
      ? prependScopeCount
      : 0,
    queryCount: Number.isFinite(queryCount) ? queryCount : 0,
    heavyQueryCount: Number.isFinite(heavyQueryCount) ? heavyQueryCount : 0,
    storeEntryCount: Number.isFinite(storeEntryCount) ? storeEntryCount : 0,
    pressureDrivers,
    dominantDrivers,
    observedAt: input.observedAt || new Date().toISOString(),
  };
};

export const isPressureLevelAtLeast = levelAtLeast;
