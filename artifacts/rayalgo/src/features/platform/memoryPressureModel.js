const PRESSURE_RANK = {
  normal: 0,
  watch: 1,
  high: 2,
  critical: 3,
};

const BROWSER_THRESHOLDS_MB = {
  measureUserAgentSpecificMemory: { watch: 320, high: 520, critical: 820 },
  "performance.memory": { watch: 180, high: 280, critical: 420 },
  heuristic: { watch: Number.POSITIVE_INFINITY, high: Number.POSITIVE_INFINITY, critical: Number.POSITIVE_INFINITY },
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
  if (value >= thresholds.critical) return "critical";
  if (value >= thresholds.high) return "high";
  if (value >= thresholds.watch) return "watch";
  return "normal";
};

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

const pushDriver = (drivers, input) => {
  if (!input || !levelAtLeast(input.level, "watch")) {
    return;
  }
  drivers.push(input);
};

const formatDriverDetail = (value, suffix = "") =>
  Number.isFinite(value) ? `${Math.round(value)}${suffix}` : null;

const resolveDominantDrivers = (drivers) =>
  drivers
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
  const apiLevel = !Number.isFinite(apiHeapUsedPercent)
    ? "normal"
    : apiHeapUsedPercent >= 85
      ? "critical"
      : apiHeapUsedPercent >= 78
        ? "high"
        : apiHeapUsedPercent >= 70
          ? "watch"
          : "normal";
  const activeWorkloadCount = Number(input.activeWorkloadCount);
  const pollCount = Number(input.pollCount);
  const streamCount = Number(input.streamCount);
  const chartScopeCount = Number(input.chartScopeCount);
  const prependScopeCount = Number(input.prependScopeCount);
  const queryCount = Number(input.queryCount);
  const heavyQueryCount = Number(input.heavyQueryCount);
  const storeEntryCount = Number(input.storeEntryCount);

  const workloadLevel =
    activeWorkloadCount >= 16 ||
    pollCount >= 7 ||
    streamCount >= 8
      ? "critical"
      : activeWorkloadCount >= 11 ||
          pollCount >= 5 ||
          streamCount >= 5
        ? "high"
        : activeWorkloadCount >= 7 ||
            pollCount >= 3 ||
            streamCount >= 3
          ? "watch"
          : "normal";

  const chartLevel =
    chartScopeCount >= 12 || prependScopeCount >= 4
      ? "high"
      : chartScopeCount >= 7 || prependScopeCount >= 1
        ? "watch"
        : "normal";

  const queryLevel =
    queryCount >= 180 || heavyQueryCount >= 50
      ? "critical"
      : queryCount >= 110 || heavyQueryCount >= 30
        ? "high"
        : queryCount >= 60 || heavyQueryCount >= 12
          ? "watch"
          : "normal";

  const storeLevel =
    storeEntryCount >= 180
      ? "critical"
      : storeEntryCount >= 120
        ? "high"
        : storeEntryCount >= 60
          ? "watch"
          : "normal";

  const drivers = [];
  pushDriver(drivers, {
    kind: "browser-memory",
    label: "Browser memory",
    level: browserLevel,
    detail: formatDriverDetail(browserMemoryMb, " MB"),
    score: browserMemoryMb,
  });
  pushDriver(drivers, {
    kind: "api-heap",
    label: "API heap",
    level: apiLevel,
    detail: formatDriverDetail(apiHeapUsedPercent, "%"),
    score: apiHeapUsedPercent,
  });
  pushDriver(drivers, {
    kind: "workload",
    label: "Active workload",
    level: workloadLevel,
    detail: formatDriverDetail(activeWorkloadCount),
    score: activeWorkloadCount,
  });
  pushDriver(drivers, {
    kind: "chart-hydration",
    label: "Chart hydration",
    level: chartLevel,
    detail: formatDriverDetail(chartScopeCount),
    score: chartScopeCount,
  });
  pushDriver(drivers, {
    kind: "query-cache",
    label: "Query cache",
    level: queryLevel,
    detail: formatDriverDetail(queryCount),
    score: queryCount,
  });
  pushDriver(drivers, {
    kind: "runtime-stores",
    label: "Runtime stores",
    level: storeLevel,
    detail: formatDriverDetail(storeEntryCount),
    score: storeEntryCount,
  });

  const dominantDrivers = resolveDominantDrivers(drivers);
  const rawScore =
    scoreFromLevel(browserLevel, 48) +
    scoreFromLevel(apiLevel, 24) +
    scoreFromLevel(workloadLevel, 12) +
    scoreFromLevel(chartLevel, 8) +
    scoreFromLevel(queryLevel, 5) +
    scoreFromLevel(storeLevel, 3);
  const score = round(clamp(rawScore, 0, 100));
  const baseLevel = maxLevel(
    browserLevel,
    apiLevel,
    workloadLevel,
    chartLevel,
    queryLevel,
    storeLevel,
  );
  let level = baseLevel;
  if (
    previousState &&
    levelAtLeast(previousState.level, "watch") &&
    !levelAtLeast(baseLevel, previousState.level)
  ) {
    const previousScore = Number(previousState.score);
    if (Number.isFinite(previousScore) && score >= previousScore - 10) {
      level = previousState.level;
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
    dominantDrivers,
    observedAt: input.observedAt || new Date().toISOString(),
  };
};

export const isPressureLevelAtLeast = levelAtLeast;
